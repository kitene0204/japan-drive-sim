// =========================================================================
// src/world.js : 넓고 쾌적한 14m 도로 + 둥근 교차로 코너 + 무한 순환 일본 마을
// =========================================================================
import * as THREE from 'three';

// -------------------------------------------------------------------------
// 무한 순환 월드 설정
// - 도로 폭을 14m(각 차선 7m)로 넉넉히 넓혀 초보자도 회전과 주행이 훨씬 쾌적합니다!
// - 교차로 코너를 둥글게(반지름 6m) 깎아 좌·우회전이 부드럽게 이어집니다.
// -------------------------------------------------------------------------
export const WORLD_CONFIG = {
  roadSpacing: 80,
  loopSize: 240,                                     // 무한 순환 주기 (240m)
  loopHalf: 120,                                     // 래핑 경계 (±120m)
  roadPositions: [-240, -160, -80, 0, 80, 160, 240], // 7x7 격자 도로
  roadWidth: 14,                                     // 왕복 2차선 전체 폭 (14m -> 넉넉한 폭!)
  laneOffset: 3.5,                                   // 중앙선에서 각 차선 중심까지 거리 (3.5m)
  worldHalfSize: 280,                                // 렌더링 바닥 반경
};

/**
 * 모서리가 둥근 정사각형(Rounded Box) 3D 인도 블록 지오메트리 생성
 * -> 교차로 코너가 직각이 아니라 실제 도로처럼 부드러운 곡선으로 깎입니다!
 */
function createRoundedSidewalkGeometry(size, radius, height) {
  const half = size / 2;
  const r = Math.min(radius, half - 1);
  const shape = new THREE.Shape();

  shape.moveTo(-half + r, -half);
  shape.lineTo(half - r, -half);
  shape.quadraticCurveTo(half, -half, half, -half + r);
  shape.lineTo(half, half - r);
  shape.quadraticCurveTo(half, half, half - r, half);
  shape.lineTo(-half + r, half);
  shape.quadraticCurveTo(-half, half, -half, half - r);
  shape.lineTo(-half, -half + r);
  shape.quadraticCurveTo(-half, -half, -half + r, -half);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 10,
  });
  // ExtrudeGeometry는 XY 평면에서 Z로 돌출되므로 X축 -90도 회전해 바닥에 눕힘
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * 일본 도로 아스팔트 텍스처 생성 (중앙 주황색 실선 + 양쪽 흰색 갓길선)
 */
function createRoadTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#374151';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect(x, y, 2, 2);
  }

  // 양쪽 흰색 갓길선
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(14, 0, 10, 512);
  ctx.fillRect(488, 0, 10, 512);

  // 중앙 주황색 실선
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(251, 0, 10, 512);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/**
 * 넓어진 교차로 아스팔트 + 횡단보도 텍스처 생성
 */
function createIntersectionTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#334155';
  ctx.fillRect(0, 0, 512, 512);

  // 사방 횡단보도 (넓어진 교차로 비율에 맞춤)
  ctx.fillStyle = '#f8fafc';
  const stripeCount = 7;
  const stripeGap = 38;
  const startOffset = 132;

  for (let i = 0; i < stripeCount; i++) {
    const pos = startOffset + i * stripeGap;
    // 위/아래 횡단보도
    ctx.fillRect(pos, 58, 22, 52);
    ctx.fillRect(pos, 402, 22, 52);
    // 좌/우 횡단보도
    ctx.fillRect(58, pos, 52, 22);
    ctx.fillRect(402, pos, 52, 22);
  }

  // 교차로 중앙 유도 점선 (우회전 시 크게 돌도록 돕는 다이아몬드 가이드)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 12]);
  ctx.strokeRect(216, 216, 80, 80);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  return texture;
}

/**
 * 빨간 역삼각형 '止まれ' (토마레) 표지판 공유 텍스처 생성
 */
function createTomareTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);

  ctx.beginPath();
  ctx.moveTo(16, 24);
  ctx.lineTo(240, 24);
  ctx.lineTo(128, 232);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(28, 32);
  ctx.lineTo(228, 32);
  ctx.lineTo(128, 214);
  ctx.closePath();
  ctx.fillStyle = '#dc2626';
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 46px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('止まれ', 128, 86);
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText('STOP', 128, 136);

  return new THREE.CanvasTexture(canvas);
}

/**
 * 도로 바닥 '止まれ' 공유 텍스처 생성
 */
function createRoadTextTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 512);

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(10, 15, 236, 26);

  ctx.font = 'bold 76px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  text.split('').forEach((ch, idx) => {
    ctx.fillText(ch, 128, 125 + idx * 115);
  });

  return new THREE.CanvasTexture(canvas);
}

function mod(n, m) {
  return ((n % m) + m) % m;
}

/**
 * 실시간으로 색상이 변하는 일본식 가로형 신호등 제어 클래스
 */
export class TrafficLightController {
  constructor() {
    this.cycleDuration = 29;
    this.greenDuration = 12;
    this.yellowDuration = 2.5;
    this.time = 0;

    this.nsGreenMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
    this.nsYellowMat = new THREE.MeshBasicMaterial({ color: 0x334155 });
    this.nsRedMat = new THREE.MeshBasicMaterial({ color: 0x334155 });

    this.ewGreenMat = new THREE.MeshBasicMaterial({ color: 0x334155 });
    this.ewYellowMat = new THREE.MeshBasicMaterial({ color: 0x334155 });
    this.ewRedMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  }

  getState(axis) {
    const half = this.cycleDuration / 2;
    const t = axis === 'NS' ? this.time : (this.time + half) % this.cycleDuration;
    if (t < this.greenDuration) return 'green';
    if (t < this.greenDuration + this.yellowDuration) return 'yellow';
    return 'red';
  }

  update(dt) {
    this.time = (this.time + dt) % this.cycleDuration;

    const ns = this.getState('NS');
    const ew = this.getState('EW');
    const off = 0x1e293b;

    this.nsGreenMat.color.setHex(ns === 'green' ? 0x22c55e : off);
    this.nsYellowMat.color.setHex(ns === 'yellow' ? 0xfacc15 : off);
    this.nsRedMat.color.setHex(ns === 'red' ? 0xef4444 : off);

    this.ewGreenMat.color.setHex(ew === 'green' ? 0x22c55e : off);
    this.ewYellowMat.color.setHex(ew === 'yellow' ? 0xfacc15 : off);
    this.ewRedMat.color.setHex(ew === 'red' ? 0xef4444 : off);
  }
}

function createJapanTrafficLight(x, z, rotationY, axis, lightCtrl, shared) {
  const group = new THREE.Group();

  const pole = new THREE.Mesh(shared.poleGeo, shared.poleMat);
  pole.position.y = 2.85;
  group.add(pole);

  const arm = new THREE.Mesh(shared.armGeo, shared.poleMat);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(2.1, 5.3, 0);
  group.add(arm);

  const box = new THREE.Mesh(shared.lightBoxGeo, shared.lightBoxMat);
  box.position.set(3.0, 5.3, 0);
  group.add(box);

  const mats =
    axis === 'NS'
      ? [lightCtrl.nsGreenMat, lightCtrl.nsYellowMat, lightCtrl.nsRedMat]
      : [lightCtrl.ewGreenMat, lightCtrl.ewYellowMat, lightCtrl.ewRedMat];

  mats.forEach((mat, idx) => {
    const bulb = new THREE.Mesh(shared.bulbGeo, mat);
    bulb.position.set(2.45 + idx * 0.55, 5.3, 0.19);
    group.add(bulb);
  });

  group.position.set(x, 0, z);
  group.rotation.y = rotationY;
  return group;
}

function createTomareSign(x, z, rotationY, shared) {
  const group = new THREE.Group();

  const pole = new THREE.Mesh(shared.signPoleGeo, shared.poleMat);
  pole.position.y = 1.5;
  group.add(pole);

  const signMesh = new THREE.Mesh(shared.signPlaneGeo, shared.tomareMat);
  signMesh.position.set(0, 2.7, 0.08);
  group.add(signMesh);

  group.position.set(x, 0, z);
  group.rotation.y = rotationY;
  return group;
}

function createBuilding(x, z, width, depth, height, colorHex, isConbini) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color: isConbini ? 0xffffff : colorHex, roughness: 0.8 })
  );
  body.position.y = height / 2;
  group.add(body);

  if (isConbini) {
    const stripe1 = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.14, 0.7, depth + 0.14),
      new THREE.MeshBasicMaterial({ color: 0x0284c7 })
    );
    stripe1.position.y = height - 0.8;
    group.add(stripe1);

    const stripe2 = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.16, 0.28, depth + 0.16),
      new THREE.MeshBasicMaterial({ color: 0x22c55e })
    );
    stripe2.position.y = height - 1.3;
    group.add(stripe2);
  } else {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.2, 0.4, depth + 0.2),
      new THREE.MeshStandardMaterial({ color: 0x475569 })
    );
    roof.position.y = height + 0.2;
    group.add(roof);
  }

  group.position.set(x, 0, z);
  return group;
}

function createTree(x, z, shared) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(shared.trunkGeo, shared.trunkMat);
  trunk.position.y = 1.1;
  group.add(trunk);

  const leaves = new THREE.Mesh(shared.leavesGeo, shared.leavesMat);
  leaves.position.y = 3.0;
  group.add(leaves);

  group.position.set(x, 0, z);
  return group;
}

/**
 * 전체 3D 무한 순환 일본 마을 월드를 구축하는 메인 함수
 */
export function buildJapanWorld(scene) {
  const { roadPositions, roadWidth, laneOffset, worldHalfSize } = WORLD_CONFIG;
  const totalLength = worldHalfSize * 2;
  const lightCtrl = new TrafficLightController();

  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 85, 225);

  scene.add(new THREE.AmbientLight(0xffffff, 0.74));
  const sunLight = new THREE.DirectionalLight(0xfffbeb, 0.92);
  sunLight.position.set(70, 120, 60);
  scene.add(sunLight);

  // 기본 바닥 (아스팔트 톤과 자연스럽게 어우러지도록 설정)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(totalLength + 120, totalLength + 120),
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);

  const shared = {
    poleGeo: new THREE.CylinderGeometry(0.11, 0.13, 5.7, 8),
    armGeo: new THREE.CylinderGeometry(0.08, 0.08, 4.4, 8),
    poleMat: new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.4 }),
    lightBoxGeo: new THREE.BoxGeometry(1.8, 0.55, 0.35),
    lightBoxMat: new THREE.MeshStandardMaterial({ color: 0x1e293b }),
    bulbGeo: new THREE.CircleGeometry(0.16, 12),
    signPoleGeo: new THREE.CylinderGeometry(0.06, 0.06, 3.0, 8),
    signPlaneGeo: new THREE.PlaneGeometry(1.15, 1.15),
    tomareMat: new THREE.MeshBasicMaterial({
      map: createTomareTexture(),
      transparent: true,
      side: THREE.DoubleSide,
    }),
    roadStopMat: new THREE.MeshBasicMaterial({
      map: createRoadTextTexture('止まれ'),
      transparent: true,
    }),
    roadStopGeo: new THREE.PlaneGeometry(4.4, 6.8),
    trunkGeo: new THREE.CylinderGeometry(0.18, 0.24, 2.2, 6),
    trunkMat: new THREE.MeshStandardMaterial({ color: 0x78350f }),
    leavesGeo: new THREE.DodecahedronGeometry(1.4, 0),
    leavesMat: new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.9 }),
  };

  // 도로 (14m 폭으로 넓게!)
  const nsTex = createRoadTexture();
  nsTex.repeat.set(1, totalLength / 16);
  const nsMat = new THREE.MeshStandardMaterial({ map: nsTex, roughness: 0.85 });

  const ewTex = createRoadTexture();
  ewTex.repeat.set(1, totalLength / 16);
  const ewMat = new THREE.MeshStandardMaterial({ map: ewTex, roughness: 0.85 });

  roadPositions.forEach((pos) => {
    const nsRoad = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, totalLength), nsMat);
    nsRoad.rotation.x = -Math.PI / 2;
    nsRoad.position.set(pos, 0.005, 0);
    scene.add(nsRoad);

    const ewRoad = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, totalLength), ewMat);
    ewRoad.rotation.x = -Math.PI / 2;
    ewRoad.rotation.z = Math.PI / 2;
    ewRoad.position.set(0, 0.008, pos);
    scene.add(ewRoad);
  });

  // 넓은 교차로 바닥 (둥근 코너 아래까지 여유 있게 덮는 26m x 26m!)
  const interMat = new THREE.MeshStandardMaterial({
    map: createIntersectionTexture(),
    roughness: 0.85,
  });
  const interGeo = new THREE.PlaneGeometry(roadWidth + 12, roadWidth + 12);

  roadPositions.forEach((rx) => {
    roadPositions.forEach((rz) => {
      const inter = new THREE.Mesh(interGeo, interMat);
      inter.rotation.x = -Math.PI / 2;
      inter.position.set(rx, 0.015, rz);
      scene.add(inter);

      // 넓어진 교차로와 둥근 코너 바깥쪽에 신호등 배치 (회전 시 절대 안 걸림!)
      scene.add(createJapanTrafficLight(rx - 9.8, rz - 9.8, 0, 'NS', lightCtrl, shared));
      scene.add(createJapanTrafficLight(rx + 9.8, rz + 9.8, Math.PI, 'NS', lightCtrl, shared));
      scene.add(createJapanTrafficLight(rx + 9.8, rz - 9.8, -Math.PI / 2, 'EW', lightCtrl, shared));
      scene.add(createJapanTrafficLight(rx - 9.8, rz + 9.8, Math.PI / 2, 'EW', lightCtrl, shared));

      const gx = mod(Math.round(rx / 80), 3);
      const gz = mod(Math.round(rz / 80), 3);
      if ((gx + gz) % 2 === 0) {
        const stopMark = new THREE.Mesh(shared.roadStopGeo, shared.roadStopMat);
        stopMark.rotation.x = -Math.PI / 2;
        stopMark.position.set(rx - laneOffset, 0.03, rz + 14.2);
        scene.add(stopMark);
        scene.add(createTomareSign(rx - 8.8, rz + 13.5, 0, shared));
      }
    });
  });

  // 도로 사이 블록: 80m 간격 - 14m 도로폭 = 66m -> 64m 크기 + 모서리 반지름 7m 둥근 인도!
  const blockCoords = [-200, -120, -40, 40, 120, 200];
  const roundedCurbGeo = createRoundedSidewalkGeometry(64, 7.5, 0.18);
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.8 });
  const palette = [0xe2e8f0, 0xf1f5f9, 0xd6d3d1, 0xfef3c7, 0xcbd5e1];

  blockCoords.forEach((bx) => {
    blockCoords.forEach((bz) => {
      const px = mod(Math.floor((bx + 40) / 80), 3);
      const pz = mod(Math.floor((bz + 40) / 80), 3);

      const sidewalk = new THREE.Mesh(roundedCurbGeo, curbMat);
      sidewalk.position.set(bx, 0, bz);
      scene.add(sidewalk);

      // 가로수는 둥근 코너에서 살짝 안쪽에 배치
      const treeOff = 26.5;
      scene.add(createTree(bx - treeOff, bz - treeOff, shared));
      scene.add(createTree(bx + treeOff, bz - treeOff, shared));
      scene.add(createTree(bx - treeOff, bz + treeOff, shared));
      scene.add(createTree(bx + treeOff, bz + treeOff, shared));

      const seed = px * 3 + pz;
      const isConbini = seed % 3 === 0;
      const h1 = isConbini ? 5.2 : 7 + (seed * 3) % 10;
      const h2 = 6 + (seed * 5) % 9;
      const c1 = palette[seed % palette.length];
      const c2 = palette[(seed + 2) % palette.length];

      scene.add(createBuilding(bx - 12, bz - 10, 17, 15, h1, c1, isConbini));
      scene.add(createBuilding(bx + 12, bz + 10, 15, 17, h2, c2, false));
    });
  });

  return lightCtrl;
}
