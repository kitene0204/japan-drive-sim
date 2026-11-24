// =========================================================================
// src/turnGuide.js : 일본 교차로 좌회전(소회전) · 우회전(대회전) 3D 가이드 & 회전 보조
// =========================================================================
import * as THREE from 'three';
import { WORLD_CONFIG } from './world.js';

/**
 * 두 각도 사이의 최단 차이(-PI ~ +PI) 계산
 */
function angleDiff(target, current) {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/**
 * 2차 베지어 곡선 위의 점(t: 0~1)과 접선(진행 방향) 계산
 */
function evalQuadBezier(p0, p1, p2, t) {
  const u = 1 - t;
  const x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
  const z = u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z;

  // 미분값(접선 벡터)
  const dx = 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
  const dz = 2 * u * (p1.z - p0.z) + 2 * t * (p2.z - p1.z);
  const len = Math.hypot(dx, dz) || 1;

  return { x, z, tx: dx / len, tz: dz / len };
}

/**
 * 바닥에 빛나는 화살표(쉐브론) 유도선 텍스처 생성
 */
function createArrowRibbonTexture(colorHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);

  // 반투명 발광 배경
  ctx.fillStyle = colorHex === 'left' ? 'rgba(34, 197, 94, 0.28)' : 'rgba(56, 189, 248, 0.28)';
  ctx.fillRect(14, 0, 100, 128);

  // 선명한 화살표 쉐브론(▲)
  ctx.strokeStyle = colorHex === 'left' ? '#4ade80' : '#38bdf8';
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(28, 92);
  ctx.lineTo(64, 34);
  ctx.lineTo(100, 92);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export class TurnGuideSystem {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // 좌회전(초록) / 우회전(하늘) 화살표 재질
    this.leftTex = createArrowRibbonTexture('left');
    this.rightTex = createArrowRibbonTexture('right');

    this.leftMat = new THREE.MeshBasicMaterial({
      map: this.leftTex,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    this.rightMat = new THREE.MeshBasicMaterial({
      map: this.rightTex,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });

    // 유도선을 구성할 16개의 빛나는 바닥 타일(교차로 회전용 화살표 패드) 미리 생성
    this.tiles = [];
    const tileGeo = new THREE.PlaneGeometry(2.4, 2.0);
    tileGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < 16; i++) {
      const tile = new THREE.Mesh(tileGeo, this.leftMat);
      tile.visible = false;
      this.group.add(tile);
      this.tiles.push(tile);
    }

    // 직선 도로용 '좌측 차선 중앙 주행 보조선' (상시 켜고 끌 수 있음)
    this.guideLineEnabled = true;
    this.laneGuideTex = createArrowRibbonTexture('left');
    this.laneGuideMat = new THREE.MeshBasicMaterial({
      map: this.laneGuideTex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.laneGuideTiles = [];
    const laneTileGeo = new THREE.PlaneGeometry(1.5, 3.2);
    laneTileGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < 10; i++) {
      const tMesh = new THREE.Mesh(laneTileGeo, this.laneGuideMat);
      tMesh.visible = false;
      this.group.add(tMesh);
      this.laneGuideTiles.push(tMesh);
    }

    // 현재 활성화된 회전 가이드 정보
    this.activeTurn = null; // { dir, p0, p1, p2, ix, iz, nfx, nfz, started }
    this.animOffset = 0;
  }

  /**
   * 직선 도로 주행 중 내 앞쪽 '정상 좌측 차선 중앙'을 따라 빛나는 3D 주행 보조선 표시
   */
  updateStraightLaneGuide(car) {
    if (!this.guideLineEnabled || (this.activeTurn && this.activeTurn.started)) {
      for (const t of this.laneGuideTiles) t.visible = false;
      return;
    }

    const { roadSpacing, roadWidth, laneOffset } = WORLD_CONFIG;
    const halfRoad = roadWidth / 2;

    const nearestX = Math.round(car.x / roadSpacing) * roadSpacing;
    const nearestZ = Math.round(car.z / roadSpacing) * roadSpacing;

    const onNSRoad = Math.abs(car.x - nearestX) < halfRoad + 1.5;
    const onEWRoad = Math.abs(car.z - nearestZ) < halfRoad + 1.5;

    // 도로 밖이면 숨김
    if (!onNSRoad && !onEWRoad) {
      for (const t of this.laneGuideTiles) t.visible = false;
      return;
    }

    const fx = -Math.sin(car.heading);
    const fz = -Math.cos(car.heading);

    // 주행 축 결정 (가장 가까운 4방위)
    let axisFx = 0;
    let axisFz = 0;
    if (onNSRoad && (!onEWRoad || Math.abs(fz) >= Math.abs(fx))) {
      axisFz = fz <= 0 ? -1 : 1;
    } else {
      axisFx = fx >= 0 ? 1 : -1;
    }

    // 좌측 차선 중심 좌표 계산
    const laneX = axisFz !== 0 ? nearestX + (axisFz < 0 ? -laneOffset : laneOffset) : null;
    const laneZ = axisFx !== 0 ? nearestZ + (axisFx > 0 ? -laneOffset : laneOffset) : null;
    const rotY = Math.atan2(-axisFx, -axisFz);

    for (let i = 0; i < this.laneGuideTiles.length; i++) {
      const dist = 5.5 + i * 4.4;
      const tile = this.laneGuideTiles[i];
      if (axisFz !== 0) {
        tile.position.set(laneX, 0.038, car.z + axisFz * dist);
      } else {
        tile.position.set(car.x + axisFx * dist, 0.038, laneZ);
      }
      tile.rotation.y = rotY;
      tile.visible = true;
    }
  }

  /**
   * 현재 차량 위치와 방향을 기준으로 가장 가까운 앞쪽 교차로 중심 계산
   */
  findUpcomingIntersection(car) {
    const { roadSpacing } = WORLD_CONFIG;
    const fx = -Math.sin(car.heading);
    const fz = -Math.cos(car.heading);

    // 가장 가까운 4방위 축(북/남/동/서) 결정
    let axisFx = 0;
    let axisFz = 0;
    if (Math.abs(fz) >= Math.abs(fx)) {
      axisFz = fz < 0 ? -1 : 1;
    } else {
      axisFx = fx > 0 ? 1 : -1;
    }

    let ix, iz;
    if (axisFz !== 0) {
      // 남북 도로 주행 중
      ix = Math.round(car.x / roadSpacing) * roadSpacing;
      // 진행 방향 앞쪽 교차로 (교차로 안쪽 6m까지는 현재 교차로 유지)
      iz =
        axisFz < 0
          ? Math.floor((car.z + 6) / roadSpacing) * roadSpacing
          : Math.ceil((car.z - 6) / roadSpacing) * roadSpacing;
    } else {
      // 동서 도로 주행 중
      iz = Math.round(car.z / roadSpacing) * roadSpacing;
      ix =
        axisFx > 0
          ? Math.ceil((car.x - 6) / roadSpacing) * roadSpacing
          : Math.floor((car.x + 6) / roadSpacing) * roadSpacing;
    }

    const dist = Math.hypot(ix - car.x, iz - car.z);
    return { ix, iz, fx: axisFx, fz: axisFz, dist };
  }

  /**
   * 일본 좌측 통행 규칙에 따른 완벽한 좌회전(소회전) / 우회전(대회전) 베지어 곡선 생성
   */
  computeTurnCurve(ix, iz, fx, fz, turnDir) {
    const L = WORLD_CONFIG.laneOffset; // 3.5m (넓어진 좌측 차선 중심)
    const entryDist = 17.0;            // 완만하고 여유로운 회전 곡선 반경

    // 현재 진행 방향의 왼쪽 벡터 (lx, lz)
    const lx = fz;
    const lz = -fx;

    // P0: 현재 내 차선(왼쪽 차선)에서 교차로 진입 시작점
    const p0 = {
      x: ix - fx * entryDist + lx * L,
      z: iz - fz * entryDist + lz * L,
    };

    let nfx, nfz, p1;
    if (turnDir === 'left') {
      // 좌회전 (소회전): 둥근 왼쪽 코너를 따라 완만하게 좁게 돌아 왼쪽 차선 진입!
      nfx = lx;
      nfz = lz;
      p1 = {
        x: ix - fx * (L + 0.5) + lx * (L + 0.5),
        z: iz - fz * (L + 0.5) + lz * (L + 0.5),
      };
    } else {
      // 우회전 (대회전): 교차로 중앙 너머까지 깊숙이 들어가 크게 돌아 왼쪽 차선 진입!
      nfx = -lx;
      nfz = -lz;
      p1 = {
        x: ix + fx * (L + 0.5) + lx * (L + 0.5),
        z: iz + fz * (L + 0.5) + lz * (L + 0.5),
      };
    }

    // 새 진행 방향의 왼쪽 벡터 (nlx, nlz)
    const nlx = nfz;
    const nlz = -nfx;

    // P2: 회전 후 들어가야 할 교차 도로의 '왼쪽 차선' 출구점
    const p2 = {
      x: ix + nfx * entryDist + nlx * L,
      z: iz + nfz * entryDist + nlz * L,
    };

    return { dir: turnDir, ix, iz, p0, p1, p2, nfx, nfz, started: false };
  }

  /**
   * 3D 바닥 화살표 타일들을 베지어 곡선 위에 배치
   */
  renderCurve(curve) {
    const mat = curve.dir === 'left' ? this.leftMat : this.rightMat;
    const count = this.tiles.length;

    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const pt = evalQuadBezier(curve.p0, curve.p1, curve.p2, t);
      const tile = this.tiles[i];
      tile.material = mat;
      tile.position.set(pt.x, 0.045, pt.z);
      // 텍스처 화살표가 진행 방향(tx, tz)을 가리키도록 회전
      tile.rotation.y = Math.atan2(-pt.tx, -pt.tz);
      tile.visible = true;
    }
  }

  hideAll() {
    for (const tile of this.tiles) {
      tile.visible = false;
    }
  }

  /**
   * 매 프레임 회전 가이드 표시, 회전 궤적 보조, 회전 완료 판정 수행
   * @param {number} dt
   * @param {PlayerCar} car
   * @param {string} turnSignal - 'none' | 'left' | 'right'
   * @param {object} callbacks - { onTurnComplete }
   */
  update(dt, car, turnSignal, callbacks = {}) {
    // 화살표 반짝임/흐름 애니메이션
    this.animOffset = (this.animOffset + dt * 1.4) % 1;
    this.leftTex.offset.y = -this.animOffset;
    this.rightTex.offset.y = -this.animOffset;
    this.laneGuideTex.offset.y = -this.animOffset;

    // 직선 좌측 차선 주행 보조선 업데이트
    this.updateStraightLaneGuide(car);

    // 1. 깜빡이가 켜져 있고 아직 회전 궤적이 고정되지 않았으면 앞쪽 교차로 유도선 계산
    if (turnSignal !== 'none') {
      if (!this.activeTurn || (!this.activeTurn.started && this.activeTurn.dir !== turnSignal)) {
        const inter = this.findUpcomingIntersection(car);
        // 앞쪽 55m 이내 교차로에 유도선 표시
        if (inter.dist < 55) {
          this.activeTurn = this.computeTurnCurve(
            inter.ix,
            inter.iz,
            inter.fx,
            inter.fz,
            turnSignal
          );
        } else {
          this.activeTurn = null;
        }
      }
    } else if (this.activeTurn && !this.activeTurn.started) {
      // 회전 시작 전에 깜빡이를 껐으면 가이드 숨김
      this.activeTurn = null;
    }

    if (!this.activeTurn) {
      this.hideAll();
      return;
    }

    const curve = this.activeTurn;

    // 2. 유도선 렌더링 (주행 보조선이 켜져 있을 때만 표시, 단 회전 보조 로직은 유지)
    if (this.guideLineEnabled) {
      this.renderCurve(curve);
    } else {
      this.hideAll();
    }

    // 3. 차량과 교차로 중심 거리 및 곡선 상 가장 가까운 지점(t) 계산
    const distToInter = Math.hypot(car.x - curve.ix, car.z - curve.iz);
    if (distToInter < 18) {
      curve.started = true;
    }

    // 회전이 시작되었고 차선유지 보조(LKA)가 켜져 있으며 전진 중일 때:
    // 교차로 안에서 이상적인 곡선을 따라 부드럽게 조향을 도와줌!
    if (curve.started && car.laneAssistEnabled && car.speed > 0.6) {
      let bestT = 0;
      let bestDist = Infinity;
      let bestPt = null;

      for (let step = 0; step <= 24; step++) {
        const t = step / 24;
        const pt = evalQuadBezier(curve.p0, curve.p1, curve.p2, t);
        const d = Math.hypot(pt.x - car.x, pt.z - car.z);
        if (d < bestDist) {
          bestDist = d;
          bestT = t;
          bestPt = pt;
        }
      }

      // 곡선 근처(반경 5.5m 이내)에서 주행 중이면 앞쪽 목표점(bestT + 0.14)을 향해 부드럽게 유도!
      if (bestDist < 5.5 && bestT < 0.96) {
        const lookT = Math.min(1, bestT + 0.14);
        const lookPt = evalQuadBezier(curve.p0, curve.p1, curve.p2, lookT);
        const desiredHeading = Math.atan2(-(lookPt.x - car.x), -(lookPt.z - car.z));
        const hErr = angleDiff(desiredHeading, car.heading);

        // 부드럽게 각도와 위치를 이상적인 궤적 쪽으로 보조
        car.heading += hErr * Math.min(1, 3.4 * dt);
        car.x += (bestPt.x - car.x) * Math.min(1, 2.0 * dt);
        car.z += (bestPt.z - car.z) * Math.min(1, 2.0 * dt);
        car.syncTransform();
      }

      // 4. 회전 완료 판정 (출구 끝점 P2 근처 도달 + 새 도로 방향과 정렬 완료)
      const distToExit = Math.hypot(car.x - curve.p2.x, car.z - curve.p2.z);
      const targetExitHeading = Math.atan2(-curve.nfx, -curve.nfz);
      const exitAngleErr = Math.abs(angleDiff(targetExitHeading, car.heading));

      if (distToExit < 5.0 && exitAngleErr < 0.48) {
        const completedDir = curve.dir;
        this.activeTurn = null;
        this.hideAll();
        if (callbacks.onTurnComplete) {
          callbacks.onTurnComplete(completedDir);
        }
        return;
      }
    }

    // 교차로에서 너무 멀어졌으면(회전 취소/직진 통과) 가이드 정리
    if (curve.started && distToInter > 28) {
      this.activeTurn = null;
      this.hideAll();
    }
  }
}
