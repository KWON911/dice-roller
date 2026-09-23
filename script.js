const MIN_DICE = 1;
const MAX_DICE = 6;
const ROLL_DURATION = 920;
const REDUCED_ROLL_DURATION = 240;
const ROLL_INTERVAL = 80;
const SHAKE_THRESHOLD = 19;
const SHAKE_COOLDOWN = 1000;

let diceCount = 2;
let values = [4, 1];
let isRolling = false;
let isSoundEnabled = true;
let audioContext;
let isShakeEnabled = false;
let lastMotion;
let lastShakeAt = 0;
let shakeHintTimer;

const diceArea = document.querySelector('#dice-area');
const countOutput = document.querySelector('#count');
const decreaseButton = document.querySelector('#decrease');
const increaseButton = document.querySelector('#increase');
const rollButton = document.querySelector('#roll-button');
const fullscreenButton = document.querySelector('#fullscreen-button');
const fullscreenIcon = document.querySelector('#fullscreen-icon');
const fullscreenLabel = document.querySelector('#fullscreen-label');
const soundToggle = document.querySelector('#sound-toggle');
const soundIcon = document.querySelector('#sound-icon');
const soundLabel = document.querySelector('#sound-label');
const shakeToggle = document.querySelector('#shake-toggle');
const shakeIcon = document.querySelector('#shake-icon');
const shakeLabel = document.querySelector('#shake-label');
const shakeHint = document.querySelector('#shake-hint');
const appShell = document.querySelector('.app-shell');
const resultValues = document.querySelector('#result-values');
const totalValue = document.querySelector('#total-value');

const pipPositions = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

function randomDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function getAudioContext() {
  if (audioContext) return audioContext;
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return null;
  audioContext = new AudioContextConstructor();
  return audioContext;
}

function playTone(context, frequency, startTime, duration, volume, endFrequency = frequency) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(frequency, startTime);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), startTime + duration);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
}

function safelyPlaySound(playSound) {
  if (!isSoundEnabled) return;
  try {
    const context = getAudioContext();
    if (!context) return;
    if (context.state === 'suspended') context.resume().catch(() => {});
    playSound(context);
  } catch (error) {
    // 효과음이 지원되지 않아도 주사위 기능은 그대로 사용합니다.
  }
}

function primeAudioForShake() {
  if (!isSoundEnabled) return;
  try {
    const context = getAudioContext();
    if (context?.state === 'suspended') context.resume().catch(() => {});
  } catch (error) {
    // 오디오 기능을 사용할 수 없어도 흔들기와 주사위 기능은 계속 사용합니다.
  }
}

function playRollingSound() {
  safelyPlaySound((context) => {
    const start = context.currentTime;
    [150, 118, 165].forEach((frequency, index) => {
      playTone(context, frequency, start + index * 0.07, 0.075, 0.035, frequency * 0.72);
    });
  });
}

function playCompletionSound() {
  safelyPlaySound((context) => {
    const start = context.currentTime;
    playTone(context, 520, start, 0.08, 0.045, 600);
    playTone(context, 720, start + 0.09, 0.12, 0.05, 820);
  });
}

function updateSoundToggle() {
  soundToggle.classList.toggle('is-on', isSoundEnabled);
  soundToggle.setAttribute('aria-pressed', String(isSoundEnabled));
  soundToggle.setAttribute('aria-label', isSoundEnabled ? '효과음 켜짐, 눌러서 끄기' : '효과음 꺼짐, 눌러서 켜기');
  soundIcon.textContent = isSoundEnabled ? '🔊' : '🔇';
  soundLabel.textContent = `효과음 ${isSoundEnabled ? 'ON' : 'OFF'}`;
}

function hasDeviceMotionSupport() {
  return typeof window.DeviceMotionEvent !== 'undefined';
}

function showShakeHint(message) {
  window.clearTimeout(shakeHintTimer);
  shakeHint.textContent = message;
  shakeHint.classList.add('is-visible');
  shakeHintTimer = window.setTimeout(() => {
    shakeHint.classList.remove('is-visible');
  }, 2800);
}

function updateShakeToggle(status = 'ready') {
  const isSupported = hasDeviceMotionSupport();
  const isEnabled = isSupported && isShakeEnabled;
  let label = '흔들어서 주사위 굴리기 활성화';

  if (!isSupported) label = '이 기기에서는 흔들기 기능을 지원하지 않음';
  if (isEnabled) label = '흔들어서 주사위 굴리기 켜짐, 눌러서 끄기';
  if (status === 'denied') label = '흔들기 권한이 필요함, 눌러서 다시 시도';

  shakeToggle.disabled = !isSupported;
  shakeToggle.classList.toggle('is-active', isEnabled);
  shakeToggle.setAttribute('aria-pressed', String(isEnabled));
  shakeToggle.setAttribute('aria-label', label);
  shakeToggle.title = isEnabled ? '흔들기 끄기' : '흔들기 사용';
  shakeIcon.textContent = isEnabled ? '📳' : '📴';
  shakeLabel.textContent = label;
}

function stopShakeDetection() {
  isShakeEnabled = false;
  lastMotion = undefined;
  window.removeEventListener('devicemotion', handleDeviceMotion);
  updateShakeToggle();
}

function handleDeviceMotion(event) {
  if (!isShakeEnabled || document.hidden || isRolling) return;

  const gravityAcceleration = event.accelerationIncludingGravity;
  const acceleration = gravityAcceleration && ['x', 'y', 'z'].every((axis) => Number.isFinite(gravityAcceleration[axis]))
    ? gravityAcceleration
    : event.acceleration;
  if (!acceleration) return;
  const currentMotion = ['x', 'y', 'z'].map((axis) => acceleration[axis]);
  if (!currentMotion.every(Number.isFinite)) return;

  if (!lastMotion) {
    lastMotion = currentMotion;
    return;
  }

  const movement = currentMotion.reduce((total, value, index) => total + Math.abs(value - lastMotion[index]), 0);
  lastMotion = currentMotion;
  const now = Date.now();
  if (movement < SHAKE_THRESHOLD || now - lastShakeAt < SHAKE_COOLDOWN) return;

  lastShakeAt = now;
  rollDice();
}

function startShakeDetection() {
  isShakeEnabled = true;
  lastMotion = undefined;
  window.addEventListener('devicemotion', handleDeviceMotion, { passive: true });
  updateShakeToggle();
  showShakeHint('휴대폰을 흔들어 보세요.');
}

async function toggleShakeDetection() {
  if (!hasDeviceMotionSupport()) {
    updateShakeToggle('unsupported');
    return;
  }
  if (isShakeEnabled) {
    stopShakeDetection();
    return;
  }

  primeAudioForShake();

  const MotionEvent = window.DeviceMotionEvent;
  if (typeof MotionEvent.requestPermission === 'function') {
    try {
      const permission = await MotionEvent.requestPermission();
      if (permission !== 'granted') {
        updateShakeToggle('denied');
        showShakeHint('흔들기 권한이 필요합니다.');
        return;
      }
    } catch (error) {
      updateShakeToggle('denied');
      showShakeHint('흔들기 권한을 확인해 주세요.');
      return;
    }
  }

  startShakeDetection();
}

function createMotionProfile(index) {
  const direction = index % 2 === 0 ? 1 : -1;
  const distance = 8 + ((index * 3) % 7);
  const rotation = 150 + ((index * 29) % 70);
  return {
    delay: (index * 31) % 70,
    x: direction * distance,
    xMid: direction * Math.round(distance * 0.62),
    xLow: direction * Math.round(distance * 0.25),
    rotation: direction * rotation,
    rotationMid: direction * Math.round(rotation * 0.58),
    rotationLow: direction * Math.round(rotation * 0.16),
    settleTilt: direction * (1.5 + (index % 2) * 0.5),
  };
}

function paintDie(die, value, index) {
  die.replaceChildren();
  die.setAttribute('aria-label', `${index + 1}번째 주사위: ${value}`);
  pipPositions[value].forEach((position) => {
    const pip = document.createElement('span');
    pip.className = `pip pip--${position}`;
    pip.setAttribute('aria-hidden', 'true');
    die.append(pip);
  });
}

function updateDiceFaces() {
  diceArea.querySelectorAll('.die').forEach((die, index) => {
    paintDie(die, values[index], index);
  });
}

function renderDice(rolling = false, motionProfiles = []) {
  diceArea.replaceChildren(...values.map((value, index) => {
    const die = document.createElement('div');
    die.className = `die${rolling ? ' rolling' : ''}`;
    die.setAttribute('role', 'img');
    const profile = motionProfiles[index];
    if (profile) {
      die.style.setProperty('--roll-delay', `${profile.delay}ms`);
      die.style.setProperty('--roll-x', `${profile.x}px`);
      die.style.setProperty('--roll-x-mid', `${profile.xMid}px`);
      die.style.setProperty('--roll-x-low', `${profile.xLow}px`);
      die.style.setProperty('--roll-rotation', `${profile.rotation}deg`);
      die.style.setProperty('--roll-rotation-mid', `${profile.rotationMid}deg`);
      die.style.setProperty('--roll-rotation-low', `${profile.rotationLow}deg`);
      die.style.setProperty('--settle-tilt', `${profile.settleTilt}deg`);
      die.style.setProperty('--settle-tilt-reverse', `${-profile.settleTilt * 0.55}deg`);
    }
    paintDie(die, value, index);
    return die;
  }));
}

function updateResult() {
  resultValues.textContent = values.join(' · ');
  totalValue.textContent = String(values.reduce((sum, value) => sum + value, 0));
}

function updateCount() {
  countOutput.textContent = `${diceCount}개`;
  decreaseButton.disabled = diceCount === MIN_DICE || isRolling;
  increaseButton.disabled = diceCount === MAX_DICE || isRolling;
}

function changeDiceCount(amount) {
  if (isRolling) return;
  diceCount = Math.max(MIN_DICE, Math.min(MAX_DICE, diceCount + amount));
  values = values.slice(0, diceCount);
  while (values.length < diceCount) values.push(randomDie());
  updateCount();
  renderDice();
  updateResult();
}

function rollDice() {
  if (isRolling) return;
  playRollingSound();
  isRolling = true;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rollDuration = reducedMotion ? REDUCED_ROLL_DURATION : ROLL_DURATION;
  const finalValues = Array.from({ length: diceCount }, randomDie);
  const motionProfiles = Array.from({ length: diceCount }, (_, index) => createMotionProfile(index));
  rollButton.disabled = true;
  rollButton.innerHTML = '<span aria-hidden="true">🎲</span> 굴리는 중…';
  updateCount();

  values = Array.from({ length: diceCount }, randomDie);
  renderDice(true, motionProfiles);

  const interval = window.setInterval(() => {
    values = Array.from({ length: diceCount }, randomDie);
    updateDiceFaces();
  }, ROLL_INTERVAL);

  window.setTimeout(() => {
    window.clearInterval(interval);
    values = finalValues;
    updateDiceFaces();
    diceArea.querySelectorAll('.die').forEach((die) => {
      die.classList.remove('rolling');
      die.removeAttribute('style');
    });
    isRolling = false;
    updateResult();
    playCompletionSound();
    updateCount();
    rollButton.disabled = false;
    rollButton.innerHTML = '<span aria-hidden="true">🎲</span> 굴리기';
  }, rollDuration);
}

function updateFullscreenButton() {
  const isFullscreen = document.fullscreenElement === appShell;
  const label = isFullscreen ? '전체화면 종료' : '전체화면';
  fullscreenButton.setAttribute('aria-pressed', String(isFullscreen));
  fullscreenButton.setAttribute('aria-label', isFullscreen ? '전체화면 종료' : '전체화면으로 전환');
  fullscreenButton.title = label;
  fullscreenIcon.textContent = isFullscreen ? '×' : '⛶';
  fullscreenLabel.textContent = label;
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await appShell.requestFullscreen();
    }
  } catch (error) {
    console.warn('전체화면 모드를 사용할 수 없습니다.', error);
  }
}

decreaseButton.addEventListener('click', () => changeDiceCount(-1));
increaseButton.addEventListener('click', () => changeDiceCount(1));
rollButton.addEventListener('click', rollDice);
soundToggle.addEventListener('click', () => {
  isSoundEnabled = !isSoundEnabled;
  updateSoundToggle();
});
shakeToggle.addEventListener('click', toggleShakeDetection);
fullscreenButton.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) lastMotion = undefined;
});

document.addEventListener('keydown', (event) => {
  const target = event.target;
  const isTyping = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  if (event.code === 'Space' && !isTyping) {
    event.preventDefault();
    rollDice();
  }
});

renderDice();
updateCount();
updateResult();
updateFullscreenButton();
updateSoundToggle();
updateShakeToggle();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}
