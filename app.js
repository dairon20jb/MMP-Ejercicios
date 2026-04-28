import {
  FilesetResolver,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm";

const PINCH_OPEN_T = 0.09;
const PINCH_CLOSE_T = 0.045;
const PALM_OPEN_T = 1.34;
const PALM_CLOSE_T = 0.9;
const THUMB_PINKY_OPEN_T = 0.22;
const THUMB_PINKY_CLOSE_T = 0.09;
const OK_HOLD_SECONDS = 1.0;

const videoEl = document.getElementById("video");
const canvasEl = document.getElementById("overlay");
const ctx = canvasEl.getContext("2d");

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const resetBtn = document.getElementById("resetBtn");

const statusLine = document.getElementById("statusLine");
const pinchCountEl = document.getElementById("pinchCount");
const palmCountEl = document.getElementById("palmCount");
const thumbPinkyCountEl = document.getElementById("thumbPinkyCount");
const okHoldCountEl = document.getElementById("okHoldCount");
const scoreValueEl = document.getElementById("scoreValue");

const pinchDetailEl = document.getElementById("pinchDetail");
const palmDetailEl = document.getElementById("palmDetail");
const thumbPinkyDetailEl = document.getElementById("thumbPinkyDetail");
const okHoldDetailEl = document.getElementById("okHoldDetail");

let stream = null;
let handLandmarker = null;
let running = false;
let rafId = null;

const state = {
  pinchCount: 0,
  palmCount: 0,
  thumbPinkyCount: 0,
  okHoldCount: 0,
  pinchStage: "open",
  palmStage: "closed",
  thumbPinkyStage: "open",
  okHoldActiveSince: null,
  okHoldLatched: false,
};

function dist2d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function palmOpenRatio(handLms) {
  const wrist = handLms[0];
  const midTip = handLms[12];
  const midMcp = handLms[9];
  const dTip = dist2d(wrist, midTip);
  const dRef = dist2d(wrist, midMcp) + 1e-6;
  return dTip / dRef;
}

function scoreSession() {
  return (
    state.pinchCount * 45 +
    state.palmCount * 40 +
    state.thumbPinkyCount * 55 +
    state.okHoldCount * 65
  );
}

function resetSession() {
  state.pinchCount = 0;
  state.palmCount = 0;
  state.thumbPinkyCount = 0;
  state.okHoldCount = 0;
  state.pinchStage = "open";
  state.palmStage = "closed";
  state.thumbPinkyStage = "open";
  state.okHoldActiveSince = null;
  state.okHoldLatched = false;
  renderStats({
    pinchDistance: null,
    palmRatio: null,
    thumbPinkyDistance: null,
    okHoldSecs: 0,
  });
}

function renderStats(details) {
  pinchCountEl.textContent = String(state.pinchCount);
  palmCountEl.textContent = String(state.palmCount);
  thumbPinkyCountEl.textContent = String(state.thumbPinkyCount);
  okHoldCountEl.textContent = String(state.okHoldCount);
  scoreValueEl.textContent = String(scoreSession());

  pinchDetailEl.textContent =
    details.pinchDistance == null ? "-" : details.pinchDistance.toFixed(3);
  palmDetailEl.textContent =
    details.palmRatio == null ? "-" : details.palmRatio.toFixed(2);
  thumbPinkyDetailEl.textContent =
    details.thumbPinkyDistance == null ? "-" : details.thumbPinkyDistance.toFixed(3);
  okHoldDetailEl.textContent = `${details.okHoldSecs.toFixed(1)} s`;
}

function drawHands(result) {
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  if (!result || !result.landmarks || result.landmarks.length === 0) {
    return;
  }

  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-canvasEl.width, 0);
  ctx.lineWidth = 2;

  for (const hand of result.landmarks) {
    for (const lm of hand) {
      const x = lm.x * canvasEl.width;
      const y = lm.y * canvasEl.height;
      ctx.fillStyle = "rgba(120, 210, 255, 0.85)";
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    const thumb = hand[4];
    const index = hand[8];
    const pinky = hand[20];

    ctx.strokeStyle = "rgba(165, 220, 255, 0.95)";
    ctx.beginPath();
    ctx.moveTo(thumb.x * canvasEl.width, thumb.y * canvasEl.height);
    ctx.lineTo(index.x * canvasEl.width, index.y * canvasEl.height);
    ctx.stroke();

    ctx.strokeStyle = "rgba(220, 160, 255, 0.95)";
    ctx.beginPath();
    ctx.moveTo(thumb.x * canvasEl.width, thumb.y * canvasEl.height);
    ctx.lineTo(pinky.x * canvasEl.width, pinky.y * canvasEl.height);
    ctx.stroke();
  }
  ctx.restore();
}

function processMode6(handLms, nowMs) {
  const thumb = handLms[4];
  const index = handLms[8];
  const pinky = handLms[20];

  const pinchDistance = dist2d(index, thumb);
  const thumbPinkyDistance = dist2d(pinky, thumb);
  const palmRatio = palmOpenRatio(handLms);

  if (pinchDistance > PINCH_OPEN_T) {
    state.pinchStage = "open";
  }
  if (pinchDistance < PINCH_CLOSE_T && state.pinchStage === "open") {
    state.pinchStage = "closed";
    state.pinchCount += 1;
  }

  if (palmRatio > PALM_OPEN_T) {
    state.palmStage = "open";
  }
  if (palmRatio < PALM_CLOSE_T && state.palmStage === "open") {
    state.palmStage = "closed";
    state.palmCount += 1;
  }

  if (thumbPinkyDistance > THUMB_PINKY_OPEN_T) {
    state.thumbPinkyStage = "open";
  }
  if (
    thumbPinkyDistance < THUMB_PINKY_CLOSE_T &&
    state.thumbPinkyStage === "open"
  ) {
    state.thumbPinkyStage = "closed";
    state.thumbPinkyCount += 1;
  }

  let okHoldSecs = 0;
  if (pinchDistance < PINCH_CLOSE_T) {
    if (state.okHoldActiveSince == null) {
      state.okHoldActiveSince = nowMs;
    }
    okHoldSecs = (nowMs - state.okHoldActiveSince) / 1000;
    if (okHoldSecs >= OK_HOLD_SECONDS && !state.okHoldLatched) {
      state.okHoldCount += 1;
      state.okHoldLatched = true;
    }
  } else {
    state.okHoldActiveSince = null;
    state.okHoldLatched = false;
    okHoldSecs = 0;
  }

  return { pinchDistance, palmRatio, thumbPinkyDistance, okHoldSecs };
}

async function ensureLandmarker() {
  if (handLandmarker) return handLandmarker;

  statusLine.textContent = "Estado: cargando modelo de manos...";
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  return handLandmarker;
}

async function startCamera() {
  if (running) return;
  try {
    await ensureLandmarker();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    videoEl.srcObject = stream;
    await videoEl.play();

    canvasEl.width = videoEl.videoWidth || 1280;
    canvasEl.height = videoEl.videoHeight || 720;

    running = true;
    statusLine.textContent = "Estado: camara activa, muestra una mano en el recuadro.";
    loop();
  } catch (err) {
    console.error(err);
    statusLine.textContent =
      "Estado: error al iniciar camara/modelo. Revisa permisos del navegador.";
  }
}

function stopCamera() {
  running = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  videoEl.srcObject = null;
  statusLine.textContent = "Estado: camara detenida.";
}

function loop() {
  if (!running || !handLandmarker || videoEl.readyState < 2) {
    rafId = requestAnimationFrame(loop);
    return;
  }
  const nowMs = performance.now();
  const result = handLandmarker.detectForVideo(videoEl, nowMs);
  drawHands(result);

  let details = {
    pinchDistance: null,
    palmRatio: null,
    thumbPinkyDistance: null,
    okHoldSecs: 0,
  };
  if (result.landmarks && result.landmarks.length > 0) {
    details = processMode6(result.landmarks[0], nowMs);
    statusLine.textContent = "Estado: deteccion activa (modo 6).";
  } else {
    statusLine.textContent = "Estado: sin mano detectada.";
    state.okHoldActiveSince = null;
    state.okHoldLatched = false;
  }
  renderStats(details);
  rafId = requestAnimationFrame(loop);
}

startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);
resetBtn.addEventListener("click", resetSession);

window.addEventListener("beforeunload", stopCamera);
resetSession();
