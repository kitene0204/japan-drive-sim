// =========================================================================
// src/autopilot.js : 일본 좌측 통행 모범 자율주행(시범 주행) 컨트롤러
// - 초보자가 일본 도로 감각(우핸들 시야, 좌측 차선, 소회전 좌회전, 대회전 우회전,
//   신호등 정지)을 눈으로 편하게 익힐 수 있도록 모범 주행을 자동으로 수행합니다.
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
    this.decidedIntersectionKey = null; // 같은 교차로에서 중복 결정 방지
    this.turnCycleIndex = 0;            // 좌회전 -> 우회전 -> 직진 순서로 다양하게 시범!
  }

  toggle() {
    this.enabled = !this.enabled;
    this.decidedIntersectionKey = null;
    return this.enabled;
  }

  /**
   * 매 프레임 자율주행 판단 및 차량 제어 입력(input) 생성
   * @returns {object} { forward, backward, left, right, brake }
   */
  update(dt, car, lightCtrl, traffic, turnGuide, currentTurnSignal, setTurnSignal) {
    const cmd = { forward: false, backward: false, left: false, right: false, brake: false };
    if (!this.enabled) return cmd;

    // 자율주행 시 차선유지 보조(LKA)가 항상 함께 작동하도록 보장
    car.laneAssistEnabled = true;

    const { roadSpacing, loopSize } = WORLD_CONFIG;
    const inter = turnGuide.findUpcomingIntersection(car);
    const interKey = `${inter.ix},${inter.iz}`;

    // 1. 교차로 접근 시(22m ~ 48m 앞) 다음 행동(좌회전 / 우회전 / 직진) 미리 결정 & 깜빡이 ON
    if (inter.dist < 48 && inter.dist > 22 && this.decidedIntersectionKey !== interKey) {
      this.decidedIntersectionKey = interKey;

      // 사용자가 골고루 익힐 수 있도록: 우회전(대회전) -> 좌회전(소회전) -> 직진 순환!
      const pattern = ['right', 'left', 'straight'];
      const action = pattern[this.turnCycleIndex % pattern.length];
      this.turnCycleIndex++;

      if (action === 'left' || action === 'right') {
        if (currentTurnSignal !== action) {
          setTurnSignal(action, true); // 자율주행 시범 깜빡이 ON
        }
      } else if (currentTurnSignal !== 'none') {
        setTurnSignal('none', true);
      }
    }

    // 2. 전방 신호등 확인 (교차로 정지선 앞 11.5m ~ 19.5m 구간에서 빨강/노랑이면 정지)
    const axis = inter.fz !== 0 ? 'NS' : 'EW';
    const lightState = lightCtrl.getState(axis);
    let mustStop = false;

    if (lightState !== 'green' && inter.dist > 11.5 && inter.dist < 19.5) {
      mustStop = true;
    }

    // 3. 전방 다른 AI 차량과의 안전거리 확인 (13m 이내 앞차 있으면 감속/정지)
    const fx = -Math.sin(car.heading);
    const fz = -Math.cos(car.heading);

    if (!mustStop) {
      for (const v of traffic.vehicles) {
        const dx = wrappedDelta(v.x, car.x, loopSize);
        const dz = wrappedDelta(v.z, car.z, loopSize);
        const forwardDist = dx * fx + dz * fz;
        const sideDist = Math.abs(dx * fz - dz * fx);

        if (forwardDist > 0 && forwardDist < 13.5 && sideDist < 2.6) {
          mustStop = true;
          break;
        }
      }
    }

    // 4. 목표 속도 결정
    //    - 정지 필요 시: 0
    //    - 교차로 회전 진입/진행 중: 안전 속도 약 23 km/h (6.4 m/s)
    //    - 일반 직진 도로: 쾌적한 시내 속도 약 40 km/h (11.2 m/s)
    let targetSpeed = 11.2;
    const isTurning = turnGuide.activeTurn && (turnGuide.activeTurn.started || inter.dist < 22);
    if (mustStop) {
      targetSpeed = 0;
    } else if (isTurning) {
      targetSpeed = 6.4;
    }

    // 5. 목표 속도에 맞춰 부드럽게 가속 / 감속
    if (mustStop) {
      if (car.speed > 0.3) cmd.brake = true;
    } else if (car.speed < targetSpeed - 0.5) {
      cmd.forward = true;
    } else if (car.speed > targetSpeed + 1.2) {
      cmd.backward = true; // 부드러운 감속
    }

    // 6. 시각적 리얼리티: 회전 중일 때 대시보드 핸들도 회전 방향에 맞춰 살짝 돌아가게 연출
    if (turnGuide.activeTurn && turnGuide.activeTurn.started) {
      const visualSteer = turnGuide.activeTurn.dir === 'left' ? 0.52 : -0.45;
      car.steerAngle += (visualSteer - car.steerAngle) * Math.min(1, 4 * dt);
    }

    return cmd;
  }
}
