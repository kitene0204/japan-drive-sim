// =========================================================================
// src/traffic.js : 일본 좌측 통행 규칙을 지키는 AI 주행 차량 시스템
// =========================================================================
import * as THREE from 'three';
import { WORLD_CONFIG } from './world.js';

/**
 * 240m 무한 순환 주기 내에서 두 좌표 사이의 최단 상대 거리 계산
 */
function wrappedDelta(a, b, loopSize) {
  let d = a - b;
  const half = loopSize / 2;
  if (d > half) d -= loopSize;
  if (d < -half) d += loopSize;
  return d;
}

/**
 * 3D 일본 스타일 AI 차량 메쉬 생성 (경차/세단/택시)
 */
function createAICarMesh(variant) {
  const group = new THREE.Group();

  const isKei = variant.type === 'kei';
  const isTaxi = variant.type === 'taxi';

  const bodyW = isKei ? 1.55 : 1.78;
  const bodyH = isKei ? 0.68 : 0.62;
  const bodyL = isKei ? 3.4 : 4.2;

  const cabinW = bodyW - 0.12;
  const cabinH = isKei ? 0.78 : 0.56;
  const cabinL = isKei ? 2.15 : 2.1;

  // 1. 차체 하부
  const bodyMat = new THREE.MeshStandardMaterial({
    color: variant.color,
    metalness: 0.25,
    roughness: 0.4,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(bodyW, bodyH, bodyL), bodyMat);
  body.position.y = 0.34 + bodyH / 2;
  group.add(body);

  // 2. 차체 상부 캐빈 (유리창 느낌의 어두운 톤)
  const cabinMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.4,
    roughness: 0.2,
  });
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(cabinW, cabinH, cabinL), cabinMat);
  cabin.position.set(0, 0.34 + bodyH + cabinH / 2 - 0.04, isKei ? 0.05 : 0.15);
  group.add(cabin);

  // 지붕 색상 덮개
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(cabinW - 0.04, 0.08, cabinL - 0.1),
    bodyMat
  );
  roof.position.set(0, 0.34 + bodyH + cabinH, isKei ? 0.05 : 0.15);
  group.add(roof);

  // 일본 택시 지붕 표시등 (노란/주황 램프)
  if (isTaxi) {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.18, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xfacc15 })
    );
    lamp.position.set(0, 0.34 + bodyH + cabinH + 0.12, 0.15);
    group.add(lamp);
  }

  // 3. 앞 헤드라이트 (흰색/연노랑, -Z 방향이 앞쪽!)
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfef9c3 });
  const headGeo = new THREE.BoxGeometry(0.32, 0.16, 0.06);
  const hlLeft = new THREE.Mesh(headGeo, headMat);
  hlLeft.position.set(-bodyW / 2 + 0.28, 0.62, -bodyL / 2 - 0.02);
  group.add(hlLeft);

  const hlRight = new THREE.Mesh(headGeo, headMat);
  hlRight.position.set(bodyW / 2 - 0.28, 0.62, -bodyL / 2 - 0.02);
  group.add(hlRight);

  // 4. 뒤 브레이크등 (빨강, +Z 방향이 뒤쪽)
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const tlLeft = new THREE.Mesh(headGeo, tailMat);
  tlLeft.position.set(-bodyW / 2 + 0.28, 0.64, bodyL / 2 + 0.02);
  group.add(tlLeft);

  const tlRight = new THREE.Mesh(headGeo, tailMat);
  tlRight.position.set(bodyW / 2 - 0.28, 0.64, bodyL / 2 + 0.02);
  group.add(tlRight);

  // 5. 일본 번호판 (경차는 노란 번호판, 일반차는 흰 번호판, 택시는 초록 번호판!)
  const plateColor = isKei ? 0xfacc15 : isTaxi ? 0x15803d : 0xf8fafc;
  const plateMat = new THREE.MeshBasicMaterial({ color: plateColor });
  const plateGeo = new THREE.BoxGeometry(0.38, 0.18, 0.04);
  const frontPlate = new THREE.Mesh(plateGeo, plateMat);
  frontPlate.position.set(0, 0.45, -bodyL / 2 - 0.02);
  group.add(frontPlate);

  const rearPlate = new THREE.Mesh(plateGeo, plateMat);
  rearPlate.position.set(0, 0.48, bodyL / 2 + 0.02);
  group.add(rearPlate);

  // 6. 바퀴 4개
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });

  const wx = bodyW / 2 - 0.05;
  const wz = bodyL / 2 - 0.65;
  [
    [-wx, 0.32, -wz],
    [wx, 0.32, -wz],
    [-wx, 0.32, wz],
    [wx, 0.32, wz],
  ].forEach(([x, y, z]) => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(x, y, z);
    group.add(w);
  });

  return group;
}

/**
 * 전체 AI 차량들을 생성하고 매 프레임 제어하는 매니저 클래스
 */
export class TrafficManager {
  constructor(scene, lightCtrl) {
    this.scene = scene;
    this.lightCtrl = lightCtrl;
    this.vehicles = [];
    this.lastHonkTime = 0;
    this.lastCrashTime = 0;

    this.spawnInitialTraffic();
  }

  /**
   * 240m 순환 주기 내에 20대의 일본 AI 차량 배치
   * (좌측 통행 규칙에 따라 각 도로의 왼쪽 차선에 정확히 배치)
   */
  spawnInitialTraffic() {
    const variants = [
      { type: 'kei', color: 0xf8fafc },   // 흰색 일본 경차
      { type: 'taxi', color: 0x0f172a },  // 검정 일본 택시
      { type: 'sedan', color: 0x94a3b8 }, // 은색 세단
      { type: 'kei', color: 0xfde047 },   // 노란 경차
      { type: 'sedan', color: 0x2563eb }, // 파란 해치백
      { type: 'taxi', color: 0x16a34a },  // 초록 일본 택시
      { type: 'sedan', color: 0xdc2626 }, // 빨간 승용차
      { type: 'kei', color: 0xbae6fd },   // 하늘색 박스카
    ];

    const laneOff = WORLD_CONFIG.laneOffset; // 2.5m
    const roads = [-80, 0, 80];

    // 시작 시 플레이어(X=-2.5, Z=55, 북진) 주변에서 바로 실감나게 보이도록 배치
    const presets = [
      // 중앙 도로(X=0) 반대편 차선(X=+2.5)에서 남쪽으로 마주 오는 차량들!
      { dir: 'S', road: 0, pos: -18, speed: 9.5 },
      { dir: 'S', road: 0, pos: -95, speed: 10.2 },
      { dir: 'S', road: 0, pos: 72, speed: 9.0 },

      // 중앙 도로(X=0) 같은 방향(북진, X=-2.5) 앞쪽 차량
      { dir: 'N', road: 0, pos: -22, speed: 8.8 },
      { dir: 'N', road: 0, pos: -105, speed: 9.5 },

      // 교차로(Z=0)를 가로지르는 동/서 차량
      { dir: 'E', road: 0, pos: -32, speed: 9.2 },
      { dir: 'E', road: 0, pos: 55, speed: 8.5 },
      { dir: 'W', road: 0, pos: 28, speed: 9.8 },
      { dir: 'W', road: 0, pos: -65, speed: 9.0 },

      // 주변 도로(±80)의 남북/동서 차량들
      { dir: 'N', road: -80, pos: 40, speed: 10.0 },
      { dir: 'S', road: -80, pos: -30, speed: 9.2 },
      { dir: 'N', road: 80, pos: -45, speed: 9.6 },
      { dir: 'S', road: 80, pos: 35, speed: 10.5 },
      { dir: 'E', road: -80, pos: -45, speed: 9.0 },
      { dir: 'W', road: -80, pos: 45, speed: 9.8 },
      { dir: 'E', road: 80, pos: 25, speed: 8.8 },
      { dir: 'W', road: 80, pos: -35, speed: 9.4 },
      { dir: 'N', road: 80, pos: 95, speed: 9.1 },
      { dir: 'S', road: -80, pos: 85, speed: 9.5 },
      { dir: 'E', road: -80, pos: 90, speed: 8.7 },
    ];

    presets.forEach((p, idx) => {
      const variant = variants[idx % variants.length];
      const mesh = createAICarMesh(variant);
      this.scene.add(mesh);

      // 방향별 일본 좌측 통행 좌표 및 헤딩 계산
      let x = 0;
      let z = 0;
      let heading = 0;
      let vx = 0;
      let vz = 0;

      if (p.dir === 'N') {
        x = p.road - laneOff;
        z = p.pos;
        heading = 0;
        vz = -1;
      } else if (p.dir === 'S') {
        x = p.road + laneOff;
        z = p.pos;
        heading = Math.PI;
        vz = 1;
      } else if (p.dir === 'E') {
        x = p.pos;
        z = p.road - laneOff;
        heading = -Math.PI / 2;
        vx = 1;
      } else if (p.dir === 'W') {
        x = p.pos;
        z = p.road + laneOff;
        heading = Math.PI / 2;
        vx = -1;
      }

      mesh.position.set(x, 0, z);
      mesh.rotation.y = heading;

      this.vehicles.push({
        mesh,
        dir: p.dir,
        axis: p.dir === 'N' || p.dir === 'S' ? 'NS' : 'EW',
        x,
        z,
        vx,
        vz,
        heading,
        targetSpeed: p.speed,
        speed: p.speed,
      });
    });
  }

  /**
   * 매 프레임 모든 AI 차량 업데이트
   * @param {number} dt - 경과 시간(초)
   * @param {PlayerCar} playerCar - 플레이어 차량
   * @param {number} now - 현재 타임스탬프(ms)
   * @param {object} callbacks - { onHonk, onCrash } 이벤트 콜백
   */
  update(dt, playerCar, now, callbacks = {}) {
    const { loopSize, loopHalf, roadSpacing } = WORLD_CONFIG;

    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      let shouldStop = false;

      // 1. 전방 신호등 확인 (교차로 정지선 앞 7.5m ~ 13.5m 구간에서 빨강/노랑이면 정지)
      const lightState = this.lightCtrl.getState(v.axis);
      if (lightState !== 'green') {
        const coord = v.axis === 'NS' ? v.z : v.x;
        const step = v.axis === 'NS' ? v.vz : v.vx;
        // 가장 가까운 교차로 중심(80의 배수)까지 진행 방향 거리 계산
        const nextInter =
          step > 0
            ? Math.ceil(coord / roadSpacing) * roadSpacing
            : Math.floor(coord / roadSpacing) * roadSpacing;
        const distToInter = Math.abs(nextInter - coord);

        if (distToInter > 11.5 && distToInter < 17.5) {
          shouldStop = true;
        }
      }

      // 2. 앞쪽 다른 AI 차량과의 안전거리 유지
      if (!shouldStop) {
        for (let j = 0; j < this.vehicles.length; j++) {
          if (i === j) continue;
          const other = this.vehicles[j];
          const dx = wrappedDelta(other.x, v.x, loopSize);
          const dz = wrappedDelta(other.z, v.z, loopSize);

          // 내 진행 방향(앞쪽) 투영 거리 및 옆쪽 거리 계산
          const forwardDist = dx * v.vx + dz * v.vz;
          const sideDist = Math.abs(dx * v.vz - dz * v.vx);

          if (forwardDist > 0 && forwardDist < 10.5 && sideDist < 2.2) {
            shouldStop = true;
            break;
          }
        }
      }

      // 3. 플레이어 차량과의 거리 확인 (안전 정지 + 역주행 경적 + 충돌 감지)
      const pdx = wrappedDelta(playerCar.x, v.x, loopSize);
      const pdz = wrappedDelta(playerCar.z, v.z, loopSize);
      const pForward = pdx * v.vx + pdz * v.vz;
      const pSide = Math.abs(pdx * v.vz - pdz * v.vx);
      const pDist = Math.hypot(pdx, pdz);

      // 정면 16m 이내에 플레이어 차가 가로막고 있으면 급정거!
      if (pForward > 0 && pForward < 16 && pSide < 2.3) {
        shouldStop = true;

        // 플레이어가 마주 보고(역주행) 달려오는 경우 경적 울리기!
        const playerFx = -Math.sin(playerCar.heading);
        const playerFz = -Math.cos(playerCar.heading);
        const dot = playerFx * v.vx + playerFz * v.vz; // -1에 가까우면 정면 마주침

        if (dot < -0.5 && pForward < 15 && now - this.lastHonkTime > 2600) {
          this.lastHonkTime = now;
          if (callbacks.onHonk) callbacks.onHonk();
        }
      }

      // 차량 접촉(충돌) 감지
      if (pDist < 2.8 && now - this.lastCrashTime > 2200) {
        this.lastCrashTime = now;
        playerCar.speed *= -0.2; // 살짝 튕기며 감속
        if (callbacks.onCrash) callbacks.onCrash();
      }

      // 4. 부드러운 가속 / 감속 적용
      if (shouldStop) {
        v.speed = Math.max(0, v.speed - 18 * dt);
      } else {
        v.speed = Math.min(v.targetSpeed, v.speed + 6.5 * dt);
      }

      // 5. 이동 및 240m 무한 순환 래핑
      v.x += v.vx * v.speed * dt;
      v.z += v.vz * v.speed * dt;

      if (v.x > loopHalf) v.x -= loopSize;
      if (v.x < -loopHalf) v.x += loopSize;
      if (v.z > loopHalf) v.z -= loopSize;
      if (v.z < -loopHalf) v.z += loopSize;

      // 6. 플레이어 기준으로 가장 가까운 타일 위치에 렌더링 (무한 경계 너머에서도 자연스럽게 보이게!)
      const renderX = playerCar.x + wrappedDelta(v.x, playerCar.x, loopSize);
      const renderZ = playerCar.z + wrappedDelta(v.z, playerCar.z, loopSize);
      v.mesh.position.set(renderX, 0, renderZ);
    }
  }
}
