const MEDIAPIPE_VERSION = "0.10.21";
const RESULTS_ENDPOINT =
  "https://script.google.com/a/macros/mmpprocesos.com/s/AKfycbwiEmaqaAKbb_8YPQK9GWL5Z4H8SpWOlcKnk_qc_E65TrT6plFHjD7qE3sy9a43qePaKw/exec";
const ACHIEVEMENTS = [
  {
    key: "palm",
    label: "Palma cerrada",
    target: 15,
    instruction: "Cierra la palma 15 veces para desbloquear el siguiente logro.",
  },
  {
    key: "pinch",
    label: "Pinza",
    target: 15,
    instruction: "Une pulgar e indice 15 veces para desbloquear el siguiente logro.",
  },
  {
    key: "thumbPinky",
    label: "Pulgar-menique",
    target: 15,
    instruction: "Une pulgar y menique 15 veces para desbloquear el siguiente logro.",
  },
  {
    key: "okHold",
    label: "OK sostenido",
    target: 5,
    instruction: "Mantén la pinza pulgar-indice 1 segundo y suelta. Repite 5 veces.",
  },
];
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
const companyNameEl = document.getElementById("companyName");
const saveStatusEl = document.getElementById("saveStatus");
const achievementTitleEl = document.getElementById("achievementTitle");
const achievementInstructionEl = document.getElementById("achievementInstruction");
const achievementProgressBarEl = document.getElementById("achievementProgressBar");
const achievementProgressTextEl = document.getElementById("achievementProgressText");
const achievementListEl = document.getElementById("achievementList");
const completionMessageEl = document.getElementById("completionMessage");
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
  activeAchievementIndex: 0,
  savedResult: false,
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

function currentAchievement() {
  return ACHIEVEMENTS[state.activeAchievementIndex] || null;
}

function countForAchievement(key) {
  if (key === "palm") return state.palmCount;
  if (key === "pinch") return state.pinchCount;
  if (key === "thumbPinky") return state.thumbPinkyCount;
  if (key === "okHold") return state.okHoldCount;
  return 0;
}

function sessionComplete() {
  return state.activeAchievementIndex >= ACHIEVEMENTS.length;
}

function completeActiveAchievementIfNeeded() {
  const achievement = currentAchievement();
  if (!achievement || countForAchievement(achievement.key) < achievement.target) {
    return;
  }

  state.activeAchievementIndex += 1;
  state.pinchStage = "closed";
  state.palmStage = "closed";
  state.thumbPinkyStage = "closed";
  state.okHoldActiveSince = null;
  state.okHoldLatched = false;

  if (sessionComplete()) {
    statusLine.textContent = "Estado: felicitaciones, completaste todos los logros.";
  }
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
  state.activeAchievementIndex = 0;
  state.savedResult = false;
  saveResultBtn.disabled = false;
  saveResultBtn.textContent = "Guardar resultado";
  saveStatusEl.textContent = "Resultado pendiente por guardar.";
  renderStats({
    pinchDistance: null,
    palmRatio: null,
    thumbPinkyDistance: null,
    okHoldSecs: 0,
  });
  renderAchievements();
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

function renderAchievements() {
  const achievement = currentAchievement();
  const completedCount = Math.min(state.activeAchievementIndex, ACHIEVEMENTS.length);
  const totalCount = ACHIEVEMENTS.length;

  achievementListEl.innerHTML = ACHIEVEMENTS.map((item, index) => {
    let className = "";
    let status = `${Math.min(countForAchievement(item.key), item.target)} / ${item.target}`;

    if (index < state.activeAchievementIndex) {
      className = "completed";
      status = "Completado";
    } else if (index === state.activeAchievementIndex) {
      className = "active";
    } else {
      className = "locked";
      status = "Pendiente";
    }

    return `<li class="${className}"><span>${item.label}</span><strong>${status}</strong></li>`;
  }).join("");

  if (!achievement) {
    achievementTitleEl.textContent = "Todos los logros completados";
    achievementInstructionEl.textContent = "Ya puedes guardar tu resultado final.";
    achievementProgressBarEl.style.width = "100%";
    achievementProgressTextEl.textContent = `${totalCount} / ${totalCount} logros completados`;
    completionMessageEl.hidden = false;
    return;
  }

  const currentCount = Math.min(countForAchievement(achievement.key), achievement.target);
  const progress = Math.round((currentCount / achievement.target) * 100);
  achievementTitleEl.textContent = achievement.label;
  achievementInstructionEl.textContent = achievement.instruction;
  achievementProgressBarEl.style.width = `${progress}%`;
  achievementProgressTextEl.textContent =
    `${currentCount} / ${achievement.target} completadas (${completedCount} / ${totalCount} logros)`;
  completionMessageEl.hidden = true;
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
  if (state.savedResult) {
    return;
  }

  const nombre = participantNameEl.value.trim();
  const empresa = companyNameEl.value.trim();
  if (!nombre) {
    saveStatusEl.textContent = "Escribe el nombre antes de guardar.";
    participantNameEl.focus();
    return;
  }
  if (!empresa) {
    saveStatusEl.textContent = "Escribe la empresa antes de guardar.";
    companyNameEl.focus();
    return;
  }
  if (!sessionComplete()) {
    saveStatusEl.textContent = "Completa todos los logros antes de guardar.";
    return;
  }

  saveResultBtn.disabled = true;
  saveResultBtn.textContent = "Guardando...";
  saveStatusEl.textContent = "Enviando resultado...";

  const payload = {
    fecha: new Date().toISOString(),
    nombre,
    empresa,
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
    state.savedResult = true;
    saveStatusEl.textContent = "Resultado enviado. Revisa la hoja de calculo.";
  } catch (err) {
    console.error(err);
    saveStatusEl.textContent = "No se pudo enviar el resultado. Revisa conexion o Apps Script.";
    saveResultBtn.disabled = false;
    saveResultBtn.textContent = "Guardar resultado";
  } finally {
    if (state.savedResult) {
      saveResultBtn.disabled = true;
      saveResultBtn.textContent = "Resultado guardado";
    }
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
  const achievement = currentAchievement();
  const activeKey = achievement?.key;
  const thumb = handLms[4];
  const index = handLms[8];
  const pinky = handLms[20];

  const pinchDistance = dist2d(index, thumb);
  const thumbPinkyDistance = dist2d(pinky, thumb);
  const palmRatio = palmOpenRatio(handLms);

  if (activeKey === "pinch" && pinchDistance > PINCH_OPEN_T) {
    state.pinchStage = "open";
  }
  if (
    activeKey === "pinch" &&
    pinchDistance < PINCH_CLOSE_T &&
    state.pinchStage === "open"
  ) {
    state.pinchStage = "closed";
    state.pinchCount += 1;
    completeActiveAchievementIfNeeded();
  }

  if (activeKey === "palm" && palmRatio > PALM_OPEN_T) {
    state.palmStage = "open";
  }
  if (
    activeKey === "palm" &&
    palmRatio < PALM_CLOSE_T &&
    state.palmStage === "open"
  ) {
    state.palmStage = "closed";
    state.palmCount += 1;
    completeActiveAchievementIfNeeded();
  }

  if (activeKey === "thumbPinky" && thumbPinkyDistance > THUMB_PINKY_OPEN_T) {
    state.thumbPinkyStage = "open";
  }
  if (
    activeKey === "thumbPinky" &&
    thumbPinkyDistance < THUMB_PINKY_CLOSE_T &&
    state.thumbPinkyStage === "open"
  ) {
    state.thumbPinkyStage = "closed";
    state.thumbPinkyCount += 1;
    completeActiveAchievementIfNeeded();
  }

  let okHoldSecs = 0;
  if (activeKey === "okHold" && pinchDistance < PINCH_CLOSE_T) {
    if (state.okHoldActiveSince == null) {
      state.okHoldActiveSince = nowMs;
    }
    okHoldSecs = (nowMs - state.okHoldActiveSince) / 1000;
    if (okHoldSecs >= OK_HOLD_SECONDS && !state.okHoldLatched) {
      state.okHoldCount += 1;
      state.okHoldLatched = true;
      completeActiveAchievementIfNeeded();
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
    if (sessionComplete()) {
      statusLine.textContent = "Estado: felicitaciones, completaste todos los logros.";
    } else {
      statusLine.textContent = `Estado: logro activo - ${currentAchievement().label}.`;
    }
  } else {
    statusLine.textContent = sessionComplete()
      ? "Estado: felicitaciones, completaste todos los logros."
      : "Estado: sin mano detectada.";
    state.okHoldActiveSince = null;
    state.okHoldLatched = false;
  }
  renderStats(details);
  renderAchievements();
  rafId = requestAnimationFrame(loop);
}

startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);
resetBtn.addEventListener("click", resetSession);
saveResultBtn.addEventListener("click", saveResult);

window.addEventListener("beforeunload", stopCamera);
resetSession();

