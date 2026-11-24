// =========================================================================
// src/car.js : 우핸들 렌트카 3D 차체 + 차선 유지 보조(LKA) & 부드러운 주행 물리
// =========================================================================
import * as THREE from 'three';
import { WORLD_CONFIG } from './world.js';

/**
 * 두 각도(라디안) 사이의 최단 각도 차이(-PI ~ +PI) 계산
 */
function angleDiff(target, current) {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

export class PlayerCar {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;

    // 차량 물리 상태값
    this.x = -WORLD_CONFIG.laneOffset; // 시작 위치: 중앙 도로의 '왼쪽 차선' (X = -2.5)
    this.z = 55;                       // 첫 번째 교차로(Z=0) 남쪽에서 북쪽을 향해 출발
    this.heading = 0;                  // 0 라디안 = 북쪽(-Z 방향)
    this.speed = 0;                    // 현재 속도 (m/s)
    this.steerAngle = 0;               // 현재 핸들 조향각 (-1 ~ +1)
    this.totalDistance = 0;            // 누적 주행 거리 (m)

    // 차선 유지 보조(LKA: Lane Keeping Assist) 기능 상태
    this.laneAssistEnabled = true;
    this.isLaneAssistActive = false;   // 현재 프레임에 실제로 보조가 작동 중인지 여부

    // 차량 주행 성능 상수 (키보드/터치에서 차선 유지가 편하도록 부드럽게 튜닝)
    this.maxSpeed = 18;                // 최고 전진 속도 (약 65 km/h)
    this.maxReverseSpeed = -5.5;       // 최고 후진 속도 (약 20 km/h)
    this.accelRate = 9.0;              // 가속력
    this.brakeRate = 18.0;             // 브레이크 제동력
    this.dragRate = 3.2;               // 자연 감속
    this.steerSpeed = 1.85;            // 핸들 조향 속도 (너무 급격히 꺾이지 않게 완화)
    this.steerReturnSpeed = 5.2;       // 핸들 중앙 자동 복원 속도 (빠르고 안정적)
    this.turnStrength = 1.45;          // 기본 회전력

    // 3D 차체 그룹 (보닛 + 사이드미러 + 슬림 A필러) 생성
    this.mesh = this.createInteriorFrame();
    this.scene.add(this.mesh);

    // 카메라를 차량 내부 '오른쪽 운전석'에 장착 (일본 우핸들)
    this.camera.position.set(0.42, 1.28, 0.22);
    this.camera.rotation.set(-0.04, 0, 0);
    this.mesh.add(this.camera);

    this.syncTransform();
  }

  /**
   * 1인칭 시점에서 보이는 차량 보닛(후드), A필러, 좌/우 사이드미러 생성
   */
  createInteriorFrame() {
    const group = new THREE.Group();

    // 1. 렌트카 앞 보닛 (펄 화이트)
    const hoodMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      metalness: 0.25,
      roughness: 0.35,
    });
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.14, 1.55), hoodMat);
    hood.position.set(0, 0.88, -1.35);
    hood.rotation.x = 0.04;
    group.add(hood);

    const trimMat = new THREE.MeshStandardMaterial({ color: 0x334155 });
    const leftEdge = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 1.5), trimMat);
    leftEdge.position.set(-0.84, 0.95, -1.35);
    group.add(leftEdge);

    const rightEdge = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 1.5), trimMat);
    rightEdge.position.set(0.84, 0.95, -1.35);
    group.add(rightEdge);

    // 2. 좌/우 사이드미러
    const mirrorCaseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b });
    const mirrorGlassMat = new THREE.MeshBasicMaterial({ color: 0x93c5fd });

    const leftMirror = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.1), mirrorCaseMat);
    leftMirror.position.set(-0.98, 1.04, -0.58);
    group.add(leftMirror);

    const leftGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.11), mirrorGlassMat);
    leftGlass.position.set(-0.98, 1.04, -0.52);
    group.add(leftGlass);

    const rightMirror = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.1), mirrorCaseMat);
    rightMirror.position.set(1.02, 1.04, -0.58);
    group.add(rightMirror);

    const rightGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.11), mirrorGlassMat);
    rightGlass.position.set(1.02, 1.04, -0.52);
    group.add(rightGlass);

    // 3. 슬림형 좌/우 A필러
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });
    const leftPillar = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.95, 0.07), pillarMat);
    leftPillar.position.set(-0.88, 1.38, -0.62);
    leftPillar.rotation.x = 0.45;
    leftPillar.rotation.z = -0.1;
    group.add(leftPillar);

    const rightPillar = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.95, 0.07), pillarMat);
    rightPillar.position.set(0.92, 1.38, -0.62);
    rightPillar.rotation.x = 0.45;
    rightPillar.rotation.z = 0.1;
    group.add(rightPillar);

    return group;
  }

  /**
   * 차량을 처음 출발 위치(좌측 차선)로 리셋
   */
  reset() {
    this.x = -WORLD_CONFIG.laneOffset;
    this.z = 55;
    this.heading = 0;
    this.speed = 0;
    this.steerAngle = 0;
    this.syncTransform();
  }

  /**
   * 차선 유지 보조(LKA) 로직:
   * - 운전자가 핸들을 꺾지 않고 직진 주행 중일 때,
   *   1) 차량 각도를 도로와 나란하게 부드럽게 정렬하고
   *   2) 현재 좌측 차선 중앙(±2.5m)을 안정적으로 유지하도록 보조합니다.
   * - 교차로 회전 중이거나 사용자가 의도적으로 핸들을 돌릴 때는 방해하지 않습니다.
   */
  applyLaneKeepingAssist(dt, isSteering) {
    this.isLaneAssistActive = false;
    if (!this.laneAssistEnabled || isSteering || this.speed < 0.8) return;

    const { roadSpacing, roadWidth, laneOffset } = WORLD_CONFIG;
    const halfRoad = roadWidth / 2;

    const nearestX = Math.round(this.x / roadSpacing) * roadSpacing;
    const nearestZ = Math.round(this.z / roadSpacing) * roadSpacing;

    const onNSRoad = Math.abs(this.x - nearestX) < halfRoad;
    const onEWRoad = Math.abs(this.z - nearestZ) < halfRoad;

    // 교차로 내부나 도로 밖에서는 LKA 작동 안 함 (자유로운 좌/우회전 보장)
    if ((onNSRoad && onEWRoad) || (!onNSRoad && !onEWRoad)) return;

    // 차량 진행 방향 벡터
    const fx = -Math.sin(this.heading);
    const fz = -Math.cos(this.heading);

    // 1) 남북 도로 위일 때
    if (onNSRoad) {
      const goingNorth = fz < 0;
      const targetHeading = goingNorth ? 0 : Math.PI;
      const headingErr = angleDiff(targetHeading, this.heading);

      // 도로 방향과 ±24도(0.42 rad) 이내일 때만 직진 정렬 및 차선 유지 작동
      if (Math.abs(headingErr) < 0.42) {
        const targetLaneX = goingNorth ? nearestX - laneOffset : nearestX + laneOffset;
        const lateralErr = targetLaneX - this.x;

        // 정상 좌측 차선 영역(중심에서 ±2.9m 이내)에 있을 때만 차선 중앙으로 부드럽게 보정
        if (Math.abs(lateralErr) < 2.9) {
          this.isLaneAssistActive = true;
          // 각도를 도로와 평행하게 부드럽게 정렬
          this.heading += headingErr * Math.min(1, 3.8 * dt);
          // 차선 중앙 쪽으로 부드럽게 당겨줌
          this.x += lateralErr * Math.min(1, 2.2 * dt);
        }
      }
    }
    // 2) 동서 도로 위일 때
    else if (onEWRoad) {
      const goingEast = fx > 0;
      const targetHeading = goingEast ? -Math.PI / 2 : Math.PI / 2;
      const headingErr = angleDiff(targetHeading, this.heading);

      if (Math.abs(headingErr) < 0.42) {
        const targetLaneZ = goingEast ? nearestZ - laneOffset : nearestZ + laneOffset;
        const lateralErr = targetLaneZ - this.z;

        if (Math.abs(lateralErr) < 2.9) {
          this.isLaneAssistActive = true;
          this.heading += headingErr * Math.min(1, 3.8 * dt);
          this.z += lateralErr * Math.min(1, 2.2 * dt);
        }
      }
    }
  }

  /**
   * 도로 바깥쪽 인도 연석(Curb) 부드러운 가드:
   * - 직선 도로에서 실수로 살짝 치우쳤을 때 바로 건물 속으로 뚫고 들어가지 않도록 방지
   */
  applyCurbGuard() {
    const { roadSpacing, roadWidth } = WORLD_CONFIG;
    const halfRoad = roadWidth / 2;
    const curbLimit = halfRoad - 0.8; // 차폭을 고려한 도로 가장자리 한계

    const nearestX = Math.round(this.x / roadSpacing) * roadSpacing;
    const nearestZ = Math.round(this.z / roadSpacing) * roadSpacing;

    const distX = Math.abs(this.x - nearestX);
    const distZ = Math.abs(this.z - nearestZ);

    // 둥근 교차로 코너 반경(15m 이내)은 여유로운 회전을 위해 통과 허용
    if (distX < 15 && distZ < 15) return;

    // 남북 도로 주행 중 인도 연석에 닿으면 부드럽게 도로 안쪽으로 막아줌
    if (distX < distZ && distX > curbLimit && distX < halfRoad + 2.5) {
      this.x = nearestX + Math.sign(this.x - nearestX) * curbLimit;
      this.speed *= 0.92;
    }
    // 동서 도로 주행 중 인도 연석에 닿으면 부드럽게 막아줌
    else if (distZ <= distX && distZ > curbLimit && distZ < halfRoad + 2.5) {
      this.z = nearestZ + Math.sign(this.z - nearestZ) * curbLimit;
      this.speed *= 0.92;
    }
  }

  /**
   * 매 프레임마다 입력값에 따라 차량의 위치와 방향을 업데이트
   */
  update(dt, input) {
    // 1. 가속 / 감속 / 브레이크 처리
    if (input.brake) {
      if (Math.abs(this.speed) < 0.3) {
        this.speed = 0;
      } else {
        this.speed -= Math.sign(this.speed) * this.brakeRate * 1.4 * dt;
      }
    } else if (input.forward) {
      this.speed += this.accelRate * dt;
    } else if (input.backward) {
      const rate = this.speed > 0.2 ? this.brakeRate : this.accelRate * 0.65;
      this.speed -= rate * dt;
    } else {
      if (Math.abs(this.speed) < 0.12) {
        this.speed = 0;
      } else {
        this.speed -= Math.sign(this.speed) * this.dragRate * dt;
      }
    }

    this.speed = Math.max(this.maxReverseSpeed, Math.min(this.maxSpeed, this.speed));

    // 2. 핸들 조향각 업데이트 (키보드/터치 버튼 또는 태블릿/폰 기울기 아날로그 조향 지원)
    const hasAnalogSteer = typeof input.analogSteer === 'number' && Math.abs(input.analogSteer) > 0.01;
    const isSteering = input.left || input.right || hasAnalogSteer;

    if (input.left) {
      this.steerAngle = Math.min(1, this.steerAngle + this.steerSpeed * dt);
    } else if (input.right) {
      this.steerAngle = Math.max(-1, this.steerAngle - this.steerSpeed * dt);
    } else if (hasAnalogSteer) {
      // 기울기 센서 아날로그 입력: 실제 핸들처럼 부드럽게 목표 각도로 추종
      const clamped = Math.max(-1, Math.min(1, input.analogSteer));
      this.steerAngle += (clamped - this.steerAngle) * Math.min(1, 10 * dt);
    } else {
      if (Math.abs(this.steerAngle) < 0.04) {
        this.steerAngle = 0;
      } else {
        this.steerAngle -= Math.sign(this.steerAngle) * this.steerReturnSpeed * dt;
      }
    }

    // 3. 속도 감응형 차량 회전
    //    - 저속(교차로 회전): 충분히 잘 돌아감
    //    - 고속(직진 주행): 핸들이 과격하게 확 꺾이지 않도록 자동으로 안정화!
    if (Math.abs(this.speed) > 0.08) {
      const direction = this.speed >= 0 ? 1 : -1;
      const lowSpeedRamp = Math.min(1, Math.abs(this.speed) / 4.0);
      const highSpeedDamping = Math.max(0.48, 1 - Math.abs(this.speed) / 30);
      this.heading +=
        this.steerAngle * this.turnStrength * lowSpeedRamp * highSpeedDamping * direction * dt;
    }

    // 4. 전진 이동
    const dx = -Math.sin(this.heading) * this.speed * dt;
    const dz = -Math.cos(this.heading) * this.speed * dt;
    this.x += dx;
    this.z += dz;
    this.totalDistance += Math.hypot(dx, dz);

    // 5. 차선 유지 보조(LKA) 및 인도 연석 가드 적용
    this.applyLaneKeepingAssist(dt, isSteering);
    this.applyCurbGuard();

    // 6. 끊김 없는 무한 순환 래핑 (±120m -> ±240m 주기)
    const { loopHalf, loopSize } = WORLD_CONFIG;
    if (this.x > loopHalf) this.x -= loopSize;
    if (this.x < -loopHalf) this.x += loopSize;
    if (this.z > loopHalf) this.z -= loopSize;
    if (this.z < -loopHalf) this.z += loopSize;

    this.syncTransform();
  }

  /**
   * 물리 좌표를 3D 메시에 반영
   */
  syncTransform() {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
  }

  /**
   * 현재 속도를 km/h 단위 정수로 반환
   */
  getSpeedKmh() {
    return Math.round(Math.abs(this.speed) * 3.6);
  }
}
