// =========================================================================
// src/main.js : 메인 시뮬레이션 루프 (PC 키보드 + 모바일 멀티터치 지원)
// =========================================================================
import * as THREE from 'three';
import { buildJapanWorld, WORLD_CONFIG } from './world.js';
import { PlayerCar } from './car.js';
import { TrafficManager } from './traffic.js';
import { TurnGuideSystem } from './turnGuide.js';
import { AutopilotController } from './autopilot.js';
import { sound } from './sound.js';

// -------------------------------------------------------------------------
// 1. Three.js 씬, 카메라, 렌더러 초기화 (모바일 세로/가로 화면 비율 자동 대응)
// -------------------------------------------------------------------------
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();

/**
 * 화면 비율에 맞는 시야각(FOV) 계산
 * - 스마트폰 세로 모드(폭 < 높이)에서는 시야각을 넓혀 도로 양옆이 잘 보이게 보정
 */
function getResponsiveFov() {
  const aspect = window.innerWidth / window.innerHeight;
  return aspect < 1 ? 82 : 65;
}

const camera = new THREE.PerspectiveCamera(
  getResponsiveFov(),
  window.innerWidth / window.innerHeight,
  0.1,
  350
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// 무한 일본 도로, 작동하는 신호등, 우핸들 차량, AI 차량, 교차로 회전 가이드 생성
const lightCtrl = buildJapanWorld(scene);
const car = new PlayerCar(scene, camera);
const traffic = new TrafficManager(scene, lightCtrl);
const turnGuide = new TurnGuideSystem(scene);
const autopilot = new AutopilotController();

window.addEventListener('resize', () => {
  camera.fov = getResponsiveFov();
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// -------------------------------------------------------------------------
// 2. UI 요소 참조 및 상태 변수
// -------------------------------------------------------------------------
const speedValueEl = document.getElementById('speed-value');
const gearDisplayEl = document.getElementById('gear-display');
const steeringWheelEl = document.getElementById('steering-wheel');
const indLeftEl = document.getElementById('ind-left');
const indRightEl = document.getElementById('ind-right');
const btnTurnLeft = document.getElementById('btn-turn-left');
const btnTurnRight = document.getElementById('btn-turn-right');
const btnWiper = document.getElementById('btn-wiper');
const wiperLayer = document.getElementById('wiper-layer');
const laneStatusEl = document.getElementById('lane-status');
const laneDotEl = document.getElementById('lane-dot');
const laneTextEl = document.getElementById('lane-text');
const naviTipEl = document.getElementById('navi-tip');
const toastContainer = document.getElementById('toast-container');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

const btnAutopilot = document.getElementById('btn-autopilot');
const btnGuideline = document.getElementById('btn-guideline');
const btnLkaToggle = document.getElementById('btn-lka-toggle');
const btnTiltToggle = document.getElementById('btn-tilt-toggle');
const btnTouchToggle = document.getElementById('btn-touch-toggle');
const btnMute = document.getElementById('btn-mute');
const btnReset = document.getElementById('btn-reset');

const toggleGuideBtn = document.getElementById('toggle-guide-btn');
const guideBody = document.getElementById('guide-body');
toggleGuideBtn.addEventListener('click', () => {
  const collapsed = guideBody.classList.toggle('collapsed');
  toggleGuideBtn.textContent = collapsed ? '펼치기' : '접기';
});

// 키보드, 터치, 기울기 센서 입력을 분리해 관리 (동시 조작 시 충돌 방지)
const keyInput = { forward: false, backward: false, left: false, right: false, brake: false };
const touchInput = { forward: false, backward: false, left: false, right: false, brake: false };
let tiltEnabled = false;
let tiltSteerValue = 0; // -1(오른쪽) ~ +1(왼쪽), car.js의 steerAngle 부호와 일치

let turnSignal = 'none';
let blinkTimer = 0;
let lastBlinkPhase = -1;
let wiperTimer = null;
let lastWrongWayToast = 0;

/**
 * 상단 코칭/경고 토스트 메시지 출력
 */
function showToast(message, type = 'info') {
  while (toastContainer.children.length >= 2) {
    toastContainer.firstChild.remove();
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2800);
}

/**
 * 내비게이션 안내 문구 업데이트
 */
function updateNaviTip(dir) {
  if (!naviTipEl) return;
  if (dir === 'left') {
    naviTipEl.innerHTML =
      '<strong>◀ 좌회전 (소회전)</strong><br />바닥의 <strong>초록 유도선</strong>을 따라 왼쪽 코너를 좁게 도세요!';
  } else if (dir === 'right') {
    naviTipEl.innerHTML =
      '<strong>▶ 우회전 (대회전)</strong><br />바닥의 <strong>파란 유도선</strong>을 따라 중앙을 크게 돌아 왼쪽 차선으로!';
  } else {
    naviTipEl.innerHTML =
      '깜빡이(<strong>O / P</strong>)를 켜면 교차로 바닥에<br /><strong>이상적인 좌·우회전 유도선</strong>이 나타납니다!';
  }
}

/**
 * 방향지시등 설정 (사용자 토글 및 자율주행 자동 제어 공용)
 */
function setTurnSignal(dir, isAuto = false) {
  turnSignal = dir;
  btnTurnLeft.classList.toggle('active', turnSignal === 'left');
  btnTurnRight.classList.toggle('active', turnSignal === 'right');
  lastBlinkPhase = -1;
  updateNaviTip(turnSignal);

  if (turnSignal === 'left') {
    showToast(
      isAuto
        ? '🤖 [자율주행] 좌회전(소회전) 준비 — 왼쪽 코너를 좁게 돕니다!'
        : '◀ 좌회전(소회전) 가이드 ON — 바닥 초록 화살표를 따라 좁게 도세요!',
      'info'
    );
  } else if (turnSignal === 'right') {
    showToast(
      isAuto
        ? '🤖 [자율주행] 우회전(대회전) 준비 — 중앙선을 크게 돕니다!'
        : '▶ 우회전(대회전) 가이드 ON — 바닥 파란 화살표를 따라 크게 도세요!',
      'info'
    );
  }
}

/**
 * 오른쪽 레버: 방향지시등 토글
 */
function toggleTurnSignal(dir) {
  setTurnSignal(turnSignal === dir ? 'none' : dir, false);
}

/**
 * 왼쪽 레버: 와이퍼 작동 (한국인 습관 실수 시뮬레이션)
 */
function triggerWiperMistake() {
  wiperLayer.classList.remove('active');
  void wiperLayer.offsetWidth;
  wiperLayer.classList.add('active');

  sound.playWiperSound();
  showToast('🌧️ 앗! 와이퍼가 켜졌습니다! 일본 차는 깜빡이가 오른쪽입니다!', 'warn');

  clearTimeout(wiperTimer);
  wiperTimer = setTimeout(() => {
    wiperLayer.classList.remove('active');
  }, 1750);
}

/**
 * 처음 위치로 리셋
 */
function resetCarPosition() {
  car.reset();
  showToast('🔄 처음 위치(좌측 차선)로 리셋되었습니다.', 'info');
}

btnTurnLeft.addEventListener('click', () => toggleTurnSignal('left'));
btnTurnRight.addEventListener('click', () => toggleTurnSignal('right'));
btnWiper.addEventListener('click', () => triggerWiperMistake());
btnReset.addEventListener('click', () => resetCarPosition());

// 음소거(효과음 켜기/끄기) 토글 함수
function toggleMuteMode() {
  sound.enabled = !sound.enabled;
  btnMute.classList.toggle('active', sound.enabled);
  btnMute.textContent = sound.enabled ? '🔊 소리 ON' : '🔇 음소거';
  showToast(sound.enabled ? '🔊 주행 효과음이 켜졌습니다.' : '🔇 음소거 모드입니다.', 'info');
}

btnMute.addEventListener('click', () => toggleMuteMode());

// 자율주행(시범 주행) 켜기/끄기 토글 함수
function toggleAutopilotMode() {
  const on = autopilot.toggle();
  btnAutopilot.classList.toggle('active', on);
  btnAutopilot.textContent = on ? '🤖 자율주행 ON' : '🤖 자율주행 OFF';

  if (on) {
    // 자율주행 시 LKA UI도 ON으로 동기화
    car.laneAssistEnabled = true;
    btnLkaToggle.classList.add('active');
    btnLkaToggle.textContent = '🛣️ 차선유지 ON';
    showToast('🤖 자율주행 시범 모드 ON — 좌측 통행 · 신호 정지 · 좌/우회전을 감상하며 눈에 익혀보세요!', 'info');
  } else {
    showToast('🚗 수동 운전 모드로 전환되었습니다!', 'info');
  }
}

btnAutopilot.addEventListener('click', () => toggleAutopilotMode());

// 주행 보조선(직선 좌측 차선 + 교차로 회전 유도선) 켜기/끄기 토글 함수
function toggleGuideLineMode() {
  turnGuide.guideLineEnabled = !turnGuide.guideLineEnabled;
  btnGuideline.classList.toggle('active', turnGuide.guideLineEnabled);
  btnGuideline.textContent = turnGuide.guideLineEnabled ? '✨ 주행보조선 ON' : '✨ 주행보조선 OFF';
  showToast(
    turnGuide.guideLineEnabled
      ? '✨ 주행 보조선 켜짐 — 바닥의 빛나는 화살표를 따라 좌측 차선을 익혀보세요!'
      : '✨ 주행 보조선 꺼짐 — 보조선 없이 실전 감각으로 주행해 보세요!',
    'info'
  );
}

btnGuideline.addEventListener('click', () => toggleGuideLineMode());

// -------------------------------------------------------------------------
// 스마트폰/태블릿 가로·세로 기울기(자이로) 핸들 조향 기능
// -------------------------------------------------------------------------
function handleDeviceOrientation(e) {
  if (!tiltEnabled) return;
  if (e.beta === null || e.gamma === null) return;

  // 현재 화면 회전 각도 감지 (0: 세로, 90: 가로, -90/270: 반대 가로)
  const angle =
    (window.screen && window.screen.orientation && typeof window.screen.orientation.angle === 'number')
      ? window.screen.orientation.angle
      : typeof window.orientation === 'number'
      ? window.orientation
      : window.innerWidth > window.innerHeight
      ? 90
      : 0;

  // 가로 모드에서는 기기를 핸들처럼 좌우로 돌릴 때 beta 값이 변함
  // 세로 모드에서는 기기를 좌우로 기울일 때 gamma 값이 변함
  let rawTiltDeg = 0;
  if (angle === 90) {
    rawTiltDeg = e.beta;        // 오른쪽 기울임(+), 왼쪽 기울임(-)
  } else if (angle === -90 || angle === 270) {
    rawTiltDeg = -e.beta;       // 반대쪽 가로 모드 부호 보정
  } else if (angle === 180) {
    rawTiltDeg = -e.gamma;
  } else {
    rawTiltDeg = e.gamma;       // 세로 모드
  }

  // 데드존(±4도 이내는 직진으로 처리해 손떨림 방지) & 최대 조향 각도(32도)
  const deadzone = 4;
  const maxTilt = 32;
  let normalized = 0;

  if (Math.abs(rawTiltDeg) > deadzone) {
    const sign = Math.sign(rawTiltDeg);
    const mag = Math.min(1, (Math.abs(rawTiltDeg) - deadzone) / (maxTilt - deadzone));
    // car.js 기준: 왼쪽 회전은 +1, 오른쪽 회전은 -1 이므로 부호 반전
    normalized = -sign * mag;
  }

  // 부드러운 로우패스 필터링으로 흔들림 없는 조향감 구현
  tiltSteerValue = tiltSteerValue * 0.65 + normalized * 0.35;
}

window.addEventListener('deviceorientation', handleDeviceOrientation);

btnTiltToggle.addEventListener('click', async () => {
  if (tiltEnabled) {
    tiltEnabled = false;
    tiltSteerValue = 0;
    btnTiltToggle.classList.remove('active');
    btnTiltToggle.textContent = '📐 기울기 OFF';
    showToast('📐 기울기 조향 꺼짐', 'info');
    return;
  }

  // iOS Safari(아이폰/아이패드)의 경우 사용자 탭 시 센서 권한 요청 필수
  if (
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function'
  ) {
    try {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') {
        showToast('⚠️ 기기 동작/방향 센서 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요.', 'warn');
        return;
      }
    } catch {
      showToast('⚠️ 기울기 센서는 HTTPS 환경 또는 모바일 기기에서 지원됩니다.', 'warn');
      return;
    }
  }

  tiltEnabled = true;
  tiltSteerValue = 0;
  btnTiltToggle.classList.add('active');
  btnTiltToggle.textContent = '📐 기울기 ON';
  showToast('📐 기울기 조향 ON! 폰·태블릿을 핸들처럼 좌우로 기울여 운전해 보세요!', 'info');
});

// 차선 유지 보조(LKA) 켜기/끄기 토글 버튼
btnLkaToggle.addEventListener('click', () => {
  car.laneAssistEnabled = !car.laneAssistEnabled;
  btnLkaToggle.classList.toggle('active', car.laneAssistEnabled);
  btnLkaToggle.textContent = car.laneAssistEnabled ? '🛣️ 차선유지 ON' : '🛣️ 차선유지 OFF';
  showToast(
    car.laneAssistEnabled
      ? '🛣️ 차선 유지 보조(LKA) 켜짐 — 직진 시 좌측 차선을 안정적으로 유지합니다!'
      : '🛣️ 차선 유지 보조(LKA) 꺼짐 — 100% 수동 조향 모드입니다.',
    'info'
  );
});

// -------------------------------------------------------------------------
// 3. 모바일 터치 모드 자동 감지 및 멀티터치 버튼 바인딩
// -------------------------------------------------------------------------
function setTouchMode(enabled) {
  document.body.classList.toggle('touch-mode', enabled);
  btnTouchToggle.classList.toggle('active', enabled);
}

// 터치 지원 기기이거나 화면 너비가 900px 이하이면 자동으로 터치패드 활성화!
const isMobileOrTouch =
  'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth <= 900;
setTouchMode(isMobileOrTouch);

btnTouchToggle.addEventListener('click', () => {
  const next = !document.body.classList.contains('touch-mode');
  setTouchMode(next);
  showToast(next ? '📱 모바일 터치 조작 패드 ON' : '⌨️ PC 키보드 모드로 전환', 'info');
});

/**
 * 멀티터치(왼손 조향 + 오른손 페달 동시 입력)를 완벽하게 지원하는 포인터 바인딩 함수
 */
function bindHoldButton(elementId, inputKey) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const activePointers = new Set();

  const press = (e) => {
    e.preventDefault();
    sound.ensureContext(); // 모바일 브라우저에서 첫 터치 시 오디오 잠금 해제
    activePointers.add(e.pointerId);
    if (el.setPointerCapture) {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // 일부 브라우저 예외 무시
      }
    }
    touchInput[inputKey] = true;
    el.classList.add('pressed');
  };

  const release = (e) => {
    e.preventDefault();
    activePointers.delete(e.pointerId);
    if (activePointers.size === 0) {
      touchInput[inputKey] = false;
      el.classList.remove('pressed');
    }
  };

  el.addEventListener('pointerdown', press);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

bindHoldButton('touch-left', 'left');
bindHoldButton('touch-right', 'right');
bindHoldButton('touch-gas', 'forward');
bindHoldButton('touch-brake', 'backward');

// -------------------------------------------------------------------------
// 4. PC 키보드 이벤트 리스너
// -------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  const code = e.code;
  if (code === 'KeyW' || code === 'ArrowUp') keyInput.forward = true;
  if (code === 'KeyS' || code === 'ArrowDown') keyInput.backward = true;
  if (code === 'KeyA' || code === 'ArrowLeft') keyInput.left = true;
  if (code === 'KeyD' || code === 'ArrowRight') keyInput.right = true;
  if (code === 'Space') {
    e.preventDefault();
    keyInput.brake = true;
  }

  if (!e.repeat) {
    if (code === 'KeyO') toggleTurnSignal('left');
    if (code === 'KeyP') toggleTurnSignal('right');
    if (code === 'KeyQ') triggerWiperMistake();
    if (code === 'KeyT') toggleAutopilotMode();
    if (code === 'KeyG') toggleGuideLineMode();
    if (code === 'KeyM') toggleMuteMode();
    if (code === 'KeyR') resetCarPosition();
  }
});

window.addEventListener('keyup', (e) => {
  const code = e.code;
  if (code === 'KeyW' || code === 'ArrowUp') keyInput.forward = false;
  if (code === 'KeyS' || code === 'ArrowDown') keyInput.backward = false;
  if (code === 'KeyA' || code === 'ArrowLeft') keyInput.left = false;
  if (code === 'KeyD' || code === 'ArrowRight') keyInput.right = false;
  if (code === 'Space') keyInput.brake = false;
});

// -------------------------------------------------------------------------
// 5. 일본 좌측 통행 준수 여부(역주행) 실시간 판별
// -------------------------------------------------------------------------
function evaluateLeftHandTraffic(now) {
  const { roadSpacing, roadWidth } = WORLD_CONFIG;
  const halfRoad = roadWidth / 2;

  const nearestX = Math.round(car.x / roadSpacing) * roadSpacing;
  const nearestZ = Math.round(car.z / roadSpacing) * roadSpacing;

  const onNSRoad = Math.abs(car.x - nearestX) < halfRoad;
  const onEWRoad = Math.abs(car.z - nearestZ) < halfRoad;

  if (onNSRoad && onEWRoad) {
    setLaneUI('safe', '교차로 통과 중 (좌측 차선 진입!)');
    return;
  }

  if (!onNSRoad && !onEWRoad) {
    setLaneUI('danger', '⚠️ 인도 진입! 도로 위 왼쪽 차선으로 복귀하세요');
    return;
  }

  const fx = -Math.sin(car.heading);
  const fz = -Math.cos(car.heading);
  let isWrongWay = false;

  if (onNSRoad) {
    const offset = car.x - nearestX;
    if (fz < -0.35 && offset > 0.35) isWrongWay = true;
    if (fz > 0.35 && offset < -0.35) isWrongWay = true;
  } else if (onEWRoad) {
    const offset = car.z - nearestZ;
    if (fx > 0.35 && offset > 0.35) isWrongWay = true;
    if (fx < -0.35 && offset < -0.35) isWrongWay = true;
  }

  if (isWrongWay && Math.abs(car.speed) > 0.5) {
    setLaneUI('danger', '🚨 역주행 경고! 왼쪽 차선으로 이동!');
    if (now - lastWrongWayToast > 3000) {
      sound.playWarningBeep();
      showToast('🚨 역주행 중입니다! 일본은 왼쪽 차선 주행!', 'danger');
      lastWrongWayToast = now;
    }
  } else {
    if (autopilot.enabled && autopilot.statusReason) {
      setLaneUI('safe', `🤖 자율주행 · ${autopilot.statusReason}`);
    } else {
      setLaneUI(
        'safe',
        car.isLaneAssistActive ? '좌측 차선 정상 주행 중 (차선유지 보조 작동)' : '좌측 차선 정상 주행 중'
      );
    }
  }
}

function setLaneUI(state, text) {
  laneTextEl.textContent = text;
  if (state === 'danger') {
    laneStatusEl.classList.add('danger');
    laneDotEl.className = 'status-dot danger';
  } else {
    laneStatusEl.classList.remove('danger');
    laneDotEl.className = 'status-dot safe';
  }
}

// -------------------------------------------------------------------------
// 6. 차량 중심 추적형 내비게이션 미니맵
// -------------------------------------------------------------------------
function drawMinimap() {
  const size = minimapCanvas.width;
  const half = size / 2;
  const viewRadius = 105;
  const scale = half / viewRadius;
  const { roadSpacing, loopSize } = WORLD_CONFIG;

  minimapCtx.fillStyle = '#1e293b';
  minimapCtx.fillRect(0, 0, size, size);

  const startGridX = Math.floor((car.x - viewRadius) / roadSpacing) * roadSpacing;
  const endGridX = Math.ceil((car.x + viewRadius) / roadSpacing) * roadSpacing;
  const startGridZ = Math.floor((car.z - viewRadius) / roadSpacing) * roadSpacing;
  const endGridZ = Math.ceil((car.z + viewRadius) / roadSpacing) * roadSpacing;

  minimapCtx.strokeStyle = '#64748b';
  minimapCtx.lineWidth = 9;
  for (let gx = startGridX; gx <= endGridX; gx += roadSpacing) {
    const mx = half + (gx - car.x) * scale;
    minimapCtx.beginPath();
    minimapCtx.moveTo(mx, 0);
    minimapCtx.lineTo(mx, size);
    minimapCtx.stroke();
  }
  for (let gz = startGridZ; gz <= endGridZ; gz += roadSpacing) {
    const my = half + (gz - car.z) * scale;
    minimapCtx.beginPath();
    minimapCtx.moveTo(0, my);
    minimapCtx.lineTo(size, my);
    minimapCtx.stroke();
  }

  minimapCtx.strokeStyle = '#f59e0b';
  minimapCtx.lineWidth = 1.2;
  for (let gx = startGridX; gx <= endGridX; gx += roadSpacing) {
    const mx = half + (gx - car.x) * scale;
    minimapCtx.beginPath();
    minimapCtx.moveTo(mx, 0);
    minimapCtx.lineTo(mx, size);
    minimapCtx.stroke();
  }
  for (let gz = startGridZ; gz <= endGridZ; gz += roadSpacing) {
    const my = half + (gz - car.z) * scale;
    minimapCtx.beginPath();
    minimapCtx.moveTo(0, my);
    minimapCtx.lineTo(size, my);
    minimapCtx.stroke();
  }

  // 주변 주행 중인 AI 차량들 표시 (주황 점)
  traffic.vehicles.forEach((v) => {
    let dx = v.x - car.x;
    let dz = v.z - car.z;
    if (dx > loopSize / 2) dx -= loopSize;
    if (dx < -loopSize / 2) dx += loopSize;
    if (dz > loopSize / 2) dz -= loopSize;
    if (dz < -loopSize / 2) dz += loopSize;

    const mx = half + dx * scale;
    const my = half + dz * scale;
    if (mx >= -5 && mx <= size + 5 && my >= -5 && my <= size + 5) {
      minimapCtx.fillStyle = '#fb923c';
      minimapCtx.beginPath();
      minimapCtx.arc(mx, my, 3.2, 0, Math.PI * 2);
      minimapCtx.fill();
    }
  });

  // 내 차량 화살표
  minimapCtx.save();
  minimapCtx.translate(half, half);
  minimapCtx.rotate(-car.heading);

  minimapCtx.fillStyle = '#38bdf8';
  minimapCtx.beginPath();
  minimapCtx.moveTo(0, -8);
  minimapCtx.lineTo(5.5, 6);
  minimapCtx.lineTo(0, 3);
  minimapCtx.lineTo(-5.5, 6);
  minimapCtx.closePath();
  minimapCtx.fill();
  minimapCtx.restore();
}

// -------------------------------------------------------------------------
// 7. 메인 애니메이션 루프 (60fps)
// -------------------------------------------------------------------------
let prevTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);

  const dt = Math.min((now - prevTime) / 1000, 0.05);
  prevTime = now;

  // 자율주행 입력 계산 (켜져 있을 때만 동작)
  const autoInput = autopilot.update(
    dt,
    car,
    lightCtrl,
    traffic,
    turnGuide,
    turnSignal,
    setTurnSignal
  );

  // 키보드, 터치, 자율주행, 기울기 센서 입력을 합쳐서 차량 물리에 전달
  const mergedInput = {
    forward: keyInput.forward || touchInput.forward || autoInput.forward,
    backward: keyInput.backward || touchInput.backward || autoInput.backward,
    left: keyInput.left || touchInput.left || autoInput.left,
    right: keyInput.right || touchInput.right || autoInput.right,
    brake: keyInput.brake || touchInput.brake || autoInput.brake,
    analogSteer: tiltEnabled && !autopilot.enabled ? tiltSteerValue : 0,
  };

  lightCtrl.update(dt);
  car.update(dt, mergedInput);

  // 교차로 좌·우회전 3D 유도선 및 궤적 보조 업데이트
  turnGuide.update(dt, car, turnSignal, {
    onTurnComplete: (completedDir) => {
      // 실제 자동차처럼 회전 완료 시 깜빡이 자동 소등!
      turnSignal = 'none';
      btnTurnLeft.classList.remove('active');
      btnTurnRight.classList.remove('active');
      updateNaviTip('none');

      if (completedDir === 'left') {
        showToast('✅ 완벽한 좌회전(소회전)! 왼쪽 차선 진입 성공!', 'info');
      } else {
        showToast('✅ 완벽한 우회전(대회전)! 중앙선을 크게 돌아 왼쪽 차선 진입 성공!', 'info');
      }
    },
  });

  traffic.update(dt, car, now, {
    onHonk: () => {
      sound.playHorn();
      showToast('📯 빵빵! 마주 오는 차량입니다! 왼쪽 차선으로 피하세요!', 'danger');
    },
    onCrash: () => {
      sound.playWarningBeep();
      showToast('💥 다른 차량과 접촉했습니다! 안전거리를 유지하세요.', 'danger');
    },
  });

  // 대시보드 UI 업데이트
  speedValueEl.textContent = car.getSpeedKmh();
  if (car.speed < -0.1) {
    gearDisplayEl.textContent = 'R';
    gearDisplayEl.style.color = '#f87171';
  } else if (Math.abs(car.speed) < 0.1) {
    gearDisplayEl.textContent = 'P';
    gearDisplayEl.style.color = '#94a3b8';
  } else {
    gearDisplayEl.textContent = 'D';
    gearDisplayEl.style.color = '#4ade80';
  }

  steeringWheelEl.style.transform = `rotate(${-car.steerAngle * 140}deg)`;

  blinkTimer += dt;
  const blinkPhase = Math.floor(blinkTimer / 0.42) % 2;
  const blinkOn = blinkPhase === 0;
  indLeftEl.classList.toggle('on', turnSignal === 'left' && blinkOn);
  indRightEl.classList.toggle('on', turnSignal === 'right' && blinkOn);

  if (turnSignal !== 'none' && blinkPhase !== lastBlinkPhase) {
    lastBlinkPhase = blinkPhase;
    sound.playTurnTick(blinkOn);
  }

  evaluateLeftHandTraffic(now);
  drawMinimap();
  renderer.render(scene, camera);
}

showToast(
  isMobileOrTouch
    ? '📱 모바일 모드! 왼손으로 조향, 오른손으로 엑셀/브레이크를 조작하세요.'
    : '🇯🇵 무한 일본 도로 & AI 차량 주행 시작! (상단 📱 버튼으로 터치패드 체험 가능)',
  'info'
);
requestAnimationFrame(animate);
