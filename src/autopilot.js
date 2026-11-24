// =========================================================================
// src/autopilot.js : 일본 좌측 통행 모범 자율주행(시범 주행) 컨트롤러
// - 신호등 준수 + 앞차 안전거리/속도 추종(ACC)
// - 우회전 시 맞은편 직진 차량 양보 대기 + 교차로 내 측면 차량 충돌 방지
// - 좌회전(소회전) / 우회전(대회전) / 직진 모범 주행 자동 수행
// =========================================================================
import { WORLD_CONFIG } from './world.js';

function wrappedDelta(a, b, loopSize) {
  let d = a - b;
  const half = loopSize / 2;
  if (d > half) d -= loopSize;
  if (d < -half) d += loopSize;
  return d;
}

export class AutopilotController {
  constructor() {
    this.enabled = false;
    this.decidedIntersectionKey = null;
    this.turnCycleIndex = 0; // 우회전 -> 좌회전 -> 직진 순환 시범
    this.statusReason = '';  // 현재 자율주행 판단 사유 (양보/정지 안내용)
  }

  toggle() {
    this.enabled = !this.enabled;
    this.decidedIntersectionKey = null;
    this.statusReason = '';
    return this.enabled;
  }

  /**
   * 매 프레임 자율주행 판단 및 차량 제어 입력(input) 생성
   */
  update(dt, car, lightCtrl, traffic, turnGuide, currentTurnSignal, setTurnSignal) {
    const cmd = { forward: false, backward: false, left: false, right: false, brake: false };
    this.statusReason = '';
    if (!this.enabled) return cmd;

    // 자율주행 시 차선유지 보조(LKA) 항상 활성화
    car.laneAssistEnabled = true;

    const { loopSize } = WORLD_CONFIG;
    const inter = turnGuide.findUpcomingIntersection(car);
    const interKey = `${inter.ix},${inter.iz}`;

    // 1. 교차로 접근 시(22m ~ 48m 앞) 다음 행동(우회전 / 좌회전 / 직진) 미리 결정 & 깜빡이 ON
    if (inter.dist < 48 && inter.dist > 22 && this.decidedIntersectionKey !== interKey) {
      this.decidedIntersectionKey = interKey;

      const pattern = ['right', 'left', 'straight'];
      const action = pattern[this.turnCycleIndex % pattern.length];
      this.turnCycleIndex++;

      if (action === 'left' || action === 'right') {
        if (currentTurnSignal !== action) {
          setTurnSignal(action, true);
        }
      } else if (currentTurnSignal !== 'none') {
        setTurnSignal('none', true);
      }
    }

    // 2. 기본 목표 속도 설정 (직진 약 40 km/h, 교차로 회전 약 23 km/h)
    const isTurning = turnGuide.activeTurn && (turnGuide.activeTurn.started || inter.dist < 22);
    let targetSpeed = isTurning ? 6.4 : 11.2;
    let mustStop = false;

    // 3. 전방 신호등 확인 (교차로 정지선 앞 11.5m ~ 19.5m 구간에서 빨강/노랑이면 정지)
    const axis = inter.fz !== 0 ? 'NS' : 'EW';
    const lightState = lightCtrl.getState(axis);

    if (lightState !== 'green' && inter.dist > 11.5 && inter.dist < 19.5) {
      mustStop = true;
      this.statusReason = '신호등 정지 대기 중';
    }

    // 4. 주변 모든 AI 차량 종합 인식 (앞차 추종 + 우회전 맞은편 양보 + 교차로 충돌 회피)
    const fx = -Math.sin(car.heading);
    const fz = -Math.cos(car.heading);

    for (const v of traffic.vehicles) {
      const dx = wrappedDelta(v.x, car.x, loopSize);
      const dz = wrappedDelta(v.z, car.z, loopSize);
      const dist = Math.hypot(dx, dz);

      // 내 진행 방향 기준 앞쪽 거리(forwardDist)와 좌우 거리(sideDist)
      const forwardDist = dx * fx + dz * fz;
      const sideDist = Math.abs(dx * fz - dz * fx);

      // 두 차량 진행 방향 내적 (+1: 같은 방향, -1: 반대편 마주 오는 방향, 0: 수직 교차)
      const dirDot = fx * v.vx + fz * v.vz;

      // (A) 같은 차선 앞차 추종 (ACC: Adaptive Cruise Control)
      if (forwardDist > 0 && forwardDist < 24 && sideDist < 2.8 && dirDot > 0.5) {
        if (forwardDist < 11.5) {
          mustStop = true;
          this.statusReason = '앞차 안전거리 정지';
        } else {
          // 앞차 속도에 맞춰 부드럽게 감속
          const safeSpeed = Math.max(0, v.speed - 0.8);
          if (safeSpeed < targetSpeed) {
            targetSpeed = safeSpeed;
            this.statusReason = '앞차 속도 맞춰 서행';
          }
        }
      }

      // (B) 전방 근접 가로막힘(어떤 방향이든 내 바로 앞 12m 이내에 차가 있으면 즉시 정지!)
      if (forwardDist > 0.5 && forwardDist < 12.5 && sideDist < 3.0) {
        mustStop = true;
        this.statusReason = '전방 차량 양보 정지';
      }

      // (C) 일본 우회전(대회전) 시 맞은편 직진 차량 양보 대기!
      //     우회전 예정이거나 회전 중이고 교차로 근처일 때, 반대편에서 다가오는 차가 있으면 대기
      const isRightTurn =
        (turnGuide.activeTurn && turnGuide.activeTurn.dir === 'right') ||
        currentTurnSignal === 'right';

      if (isRightTurn && inter.dist < 20 && dirDot < -0.5) {
        // 맞은편 차량이 교차로 중심에서 다가오고 있고 아직 교차로를 지나지 않았다면 양보!
        const vToInterX = wrappedDelta(inter.ix, v.x, loopSize);
        const vToInterZ = wrappedDelta(inter.iz, v.z, loopSize);
        const vApproaching = vToInterX * v.vx + vToInterZ * v.vz; // 양수면 교차로로 다가오는 중
        const vDistToInter = Math.hypot(vToInterX, vToInterZ);

        if (vApproaching > -3 && vDistToInter < 28 && dist < 34) {
          mustStop = true;
          this.statusReason = '우회전 · 맞은편 직진 차량 양보 중';
        }
      }

      // (D) 교차로 진입 직전/내부에서 수직으로 가로지르는 차량(꼬리물기 등) 확인
      if (inter.dist < 18 && Math.abs(dirDot) < 0.4) {
        const vDistToInter = Math.hypot(
          wrappedDelta(inter.ix, v.x, loopSize),
          wrappedDelta(inter.iz, v.z, loopSize)
        );
        if (vDistToInter < 13.5 && forwardDist > -2 && dist < 18) {
          mustStop = true;
          this.statusReason = '교차로 통과 차량 양보 중';
        }
      }
    }

    if (mustStop) {
      targetSpeed = 0;
    }

    // 5. 목표 속도에 맞춰 부드럽게 가속 / 감속 / 정지
    if (mustStop) {
      if (car.speed > 0.25) cmd.brake = true;
    } else if (car.speed < targetSpeed - 0.5) {
      cmd.forward = true;
    } else if (car.speed > targetSpeed + 1.0) {
      cmd.backward = true;
    }

    // 6. 회전 중 대시보드 핸들 자연스러운 연출
    if (turnGuide.activeTurn && turnGuide.activeTurn.started && car.speed > 0.5) {
      const visualSteer = turnGuide.activeTurn.dir === 'left' ? 0.52 : -0.45;
      car.steerAngle += (visualSteer - car.steerAngle) * Math.min(1, 4 * dt);
    }

    return cmd;
  }
}
