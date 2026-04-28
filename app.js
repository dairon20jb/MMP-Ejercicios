const MEDIAPIPE_VERSION = "0.10.21";
const RESULTS_ENDPOINT =
  "https://script.google.com/a/macros/mmpprocesos.com/s/AKfycbwiEmaqaAKbb_8YPQK9GWL5Z4H8SpWOlcKnk_qc_E65TrT6plFHjD7qE3sy9a43qePaKw/exec";
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
const saveResultBtn = document.getElementById("saveResultBtn");

const statusLine = document.getElementById("statusLine");
const participantNameEl = document.getElementById("participantName");
const saveStatusEl = document.getElementById("saveStatus");
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
let mediaPipeTasksPromise = null;
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
  saveStatusEl.textContent = "Resultado pendiente por guardar.";
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

async function loadMediaPipeTasks() {
  if (!mediaPipeTasksPromise) {
    mediaPipeTasksPromise = import(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/+esm`
    ).catch((err) => {
      mediaPipeTasksPromise = null;
      throw err;
    });
  }
  return mediaPipeTasksPromise;
}

function cameraStartErrorMessage(err) {
  if (!window.isSecureContext) {
    return "Estado: la camara requiere HTTPS. Abre la URL https de Vercel.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "Estado: este navegador no permite usar camara desde esta pagina.";
  }
  if (err?.name === "NotAllowedError") {
    return "Estado: permiso de camara bloqueado. Autoriza la camara en el navegador.";
  }
  if (err?.name === "NotFoundError") {
    return "Estado: no se encontro una camara disponible.";
  }
  return `Estado: error al iniciar camara/modelo: ${err?.message || "revisa permisos del navegador."}`;
}

async function saveResult() {
  const nombre = participantNameEl.value.trim();
  if (!nombre) {
    saveStatusEl.textContent = "Escribe el nombre antes de guardar.";
    participantNameEl.focus();
    return;
  }

  saveResultBtn.disabled = true;
  saveResultBtn.textContent = "Guardando...";
  saveStatusEl.textContent = "Enviando resultado...";

  const payload = {
    fecha: new Date().toISOString(),
    nombre,
    pinza: state.pinchCount,
    palma: state.palmCount,
    pulgarMenique: state.thumbPinkyCount,
    okSostenido: state.okHoldCount,
    puntaje: scoreSession(),
  };

  try {
    await fetch(RESULTS_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(payload),
    });
    saveStatusEl.textContent = "Resultado enviado. Revisa la hoja de calculo.";
  } catch (err) {
    console.error(err);
    saveStatusEl.textContent = "No se pudo enviar el resultado. Revisa conexion o Apps Script.";
  } finally {
    saveResultBtn.disabled = false;
    saveResultBtn.textContent = "Guardar resultado";
  }
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
  const { FilesetResolver, HandLandmarker } = await loadMediaPipeTasks();
  const vision = await FilesetResolver.forVisionTasks(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
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
  startBtn.disabled = true;
  startBtn.textContent = "Iniciando...";
  try {
    statusLine.textContent = "Estado: preparando camara...";
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
    statusLine.textContent = cameraStartErrorMessage(err);
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "Iniciar camara";
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
saveResultBtn.addEventListener("click", saveResult);

window.addEventListener("beforeunload", stopCamera);
resetSession();
