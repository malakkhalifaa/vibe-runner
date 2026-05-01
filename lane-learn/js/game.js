import { QUESTION_POOL } from "./content.js";
import * as voice from "./voiceAgent.js";
import { createTrackRenderer } from "./webgl-renderer.js";

const gameHost = document.getElementById("gameHost");
const fxCanvas = document.getElementById("fxCanvas");
const ctx = fxCanvas ? fxCanvas.getContext("2d") : null;

const LANES = 3;
/** Fixed track anchor — do not scale with screen (keeps gate timing stable). */
const PLAYER_WORLD_Y = 610;

let W = 480;
let H = 720;
let ROAD_BOTTOM = H - 10;
let ROAD_W = W * 0.9;
let PLAYER_DRAW_Y = ROAD_BOTTOM - 38;
let LANE_W = W / LANES;

/** @type {ReturnType<createTrackRenderer> | null} */
let track3d = null;
let resizeObs = null;
let lastSpokenQId = "";

const el = {
  score: document.getElementById("score"),
  combo: document.getElementById("combo"),
  lives: document.getElementById("lives"),
  coinsHud: document.getElementById("coinsHud"),
  dist: document.getElementById("dist"),
  playerHud: document.getElementById("playerHud"),
  questionText: document.getElementById("questionText"),
  choicesRow: document.getElementById("choicesRow"),
  voiceReadAloud: document.getElementById("voiceReadAloud"),
  voiceMicBtn: document.getElementById("voiceMicBtn"),
  overlay: document.getElementById("overlay"),
  overlayTitle: document.getElementById("overlayTitle"),
  overlayMsg: document.getElementById("overlayMsg"),
  btnPrimary: document.getElementById("btnPrimary"),
  btnSecondary: document.getElementById("btnSecondary"),
};

/** @type {typeof QUESTION_POOL} */
let activePool = QUESTION_POOL;
/** @type {string} */
let playerName = "Runner";

/** @type {{ lane: number }} */
const player = { lane: 1 };

let scroll = 0;
let speed = 180;
let lastTs = 0;
let raf = 0;

let score = 0;
let combo = 0;
let lives = 3;
/** Gold pickups collected this run (HUD). */
let coinsBank = 0;
/** @type {number} meters-ish run distance for HUD */
let runMeters = 0;

let poolOrder = [];
let poolIndex = 0;

/**
 * @typedef {{ at: number; passed: boolean; question: (typeof QUESTION_POOL)[number] }} Gate
 * @type {Gate[]}
 */
let gates = [];

/**
 * @typedef {{ at: number; lane: number; kind: 'coin' | 'hazard'; collected?: boolean; hit?: boolean }} TrackPickup
 * @type {TrackPickup[]}
 */
let trackPickups = [];

let paused = false;
let gameOver = false;
let inputBound = false;
let voiceUiBound = false;
/** User wants mic on between rounds (paused/game over turns recognition off). */
let micArmed = false;

/** @type {{ text: string; x: number; y: number; life: number; vy: number; hue: string }[]} */
let scorePops = [];
/** @type {{ x: number; y: number; vx: number; vy: number; life: number; color: string }[]} */
let sparks = [];
let cameraShake = 0;

function refreshLayout() {
  if (!gameHost) return;
  const r = gameHost.getBoundingClientRect();
  W = Math.max(280, Math.floor(r.width) || 480);
  H = Math.round(W * 1.5);
  gameHost.style.height = `${H}px`;
  ROAD_BOTTOM = H - 10;
  ROAD_W = W * 0.9;
  PLAYER_DRAW_Y = ROAD_BOTTOM - 38;
  LANE_W = W / LANES;
  if (fxCanvas && ctx) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    fxCanvas.width = Math.floor(W * dpr);
    fxCanvas.height = Math.floor(H * dpr);
    fxCanvas.style.width = `${W}px`;
    fxCanvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  track3d?.resize(W, H);
}

function ensureResizeObserver() {
  if (resizeObs || !gameHost) return;
  resizeObs = new ResizeObserver(() => refreshLayout());
  resizeObs.observe(gameHost);
}

function playerTrackPos() {
  return PLAYER_WORLD_Y + scroll;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function roadEdgesAtT(t) {
  const half = (ROAD_W / 2) * t;
  return { left: W / 2 - half, right: W / 2 + half };
}

function laneToX(lane, t) {
  const { left, right } = roadEdgesAtT(t);
  const span = right - left;
  return left + ((lane + 0.5) / LANES) * span;
}

function takeQuestion() {
  const pool = activePool.length ? activePool : QUESTION_POOL;
  if (poolIndex >= poolOrder.length) {
    poolOrder = shuffle(pool.map((_, i) => i));
    poolIndex = 0;
  }
  return pool[poolOrder[poolIndex++]];
}

function activeGate() {
  return gates
    .filter((g) => !g.passed)
    .sort((a, b) => a.at - b.at)[0] ?? null;
}

const LANE_TAGS = ["Left", "Center", "Right"];

function syncChoiceHighlight() {
  if (!el.choicesRow) return;
  el.choicesRow.querySelectorAll("button.choice-pill").forEach((btn, i) => {
    const on = i === player.lane;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function announceQuestion(g) {
  if (!el.voiceReadAloud?.checked) return;
  const id = g.question.id;
  if (id === lastSpokenQId) return;
  lastSpokenQId = id;
  // Mic + TTS together often cut the voice off in Chrome/Edge — pause STT until the read finishes.
  if (micArmed && voice.canUseRecognition()) voice.stopListening();
  voice.speakQuestion(g.question.prompt, g.question.choices, () => {
    resumeVoiceIfNeeded();
  });
}

function syncQuestionPanel() {
  const g = activeGate();
  if (!g) return;
  el.questionText.textContent = g.question.prompt;
  el.choicesRow.innerHTML = "";
  g.question.choices.forEach((text, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice-pill";
    btn.dataset.lane = String(i);
    btn.setAttribute("aria-label", `${LANE_TAGS[i]} lane: ${text}`);

    const tag = document.createElement("span");
    tag.className = "choice-lane-tag";
    tag.textContent = LANE_TAGS[i];

    const body = document.createElement("span");
    body.className = "choice-pill-text";
    body.textContent = text;

    btn.appendChild(tag);
    btn.appendChild(body);
    btn.addEventListener("click", () => setLane(i));
    el.choicesRow.appendChild(btn);
  });
  syncChoiceHighlight();
  announceQuestion(g);
}

function silenceVoice() {
  voice.stopListening();
  voice.stopSpeaking();
  micArmed = false;
  if (el.voiceMicBtn) {
    el.voiceMicBtn.classList.remove("is-live");
    el.voiceMicBtn.setAttribute("aria-pressed", "false");
  }
}

function resumeVoiceIfNeeded() {
  if (!micArmed || paused || gameOver) return;
  if (!voice.canUseRecognition()) return;
  voice.startListening(
    () => activeGate()?.question?.choices ?? [],
    (lane) => setLane(lane)
  );
}

function updateMicButtonEnabled() {
  if (el.voiceMicBtn) el.voiceMicBtn.disabled = !voice.canUseRecognition();
}

function wireVoiceUi() {
  if (voiceUiBound) return;
  voiceUiBound = true;
  updateMicButtonEnabled();

  el.voiceMicBtn?.addEventListener("click", () => {
    if (!voice.canUseRecognition()) return;
    if (gameOver || paused) return;
    micArmed = !micArmed;
    if (micArmed) {
      const ok = voice.startListening(
        () => activeGate()?.question?.choices ?? [],
        (lane) => setLane(lane)
      );
      if (!ok) micArmed = false;
    } else {
      voice.stopListening();
    }
    el.voiceMicBtn?.classList.toggle("is-live", micArmed);
    el.voiceMicBtn?.setAttribute("aria-pressed", micArmed ? "true" : "false");
  });

  el.voiceReadAloud?.addEventListener("change", () => {
    const g = activeGate();
    if (el.voiceReadAloud?.checked && g) {
      lastSpokenQId = "";
      announceQuestion(g);
    } else {
      voice.stopSpeaking();
      resumeVoiceIfNeeded();
    }
  });
}

function spawnPickupsBetween(fromAt, toAt) {
  let cursor = fromAt + 40;
  const end = toAt - 40;
  while (cursor < end - 24) {
    const roll = Math.random();
    if (roll < 0.62) {
      trackPickups.push({
        at: cursor,
        lane: Math.floor(Math.random() * LANES),
        kind: "coin",
        collected: false,
      });
    } else if (roll < 0.72) {
      trackPickups.push({
        at: cursor,
        lane: Math.floor(Math.random() * LANES),
        kind: "hazard",
        hit: false,
      });
    }
    cursor += 72 + Math.random() * 100;
  }
}

function seedPickupsForAllSegments() {
  trackPickups = [];
  const pw = playerTrackPos();
  if (gates.length === 0) return;
  if (gates[0].at > pw + 65) spawnPickupsBetween(pw + 35, gates[0].at - 40);
  for (let i = 0; i < gates.length - 1; i++) {
    const lo = gates[i].at + 40;
    const hi = gates[i + 1].at - 40;
    if (hi - lo > 55) spawnPickupsBetween(lo, hi);
  }
}

function appendGate() {
  const lastAt = gates[gates.length - 1].at;
  const gap = 320 + Math.random() * 140;
  const newAt = lastAt + gap;
  if (newAt - lastAt > 90) spawnPickupsBetween(lastAt + 40, newAt - 40);
  gates.push({
    at: newAt,
    passed: false,
    question: takeQuestion(),
  });
}

function initRun() {
  scroll = 0;
  speed = 200;
  score = 0;
  combo = 0;
  lives = 3;
  coinsBank = 0;
  runMeters = 0;
  player.lane = 1;
  gates = [];
  trackPickups = [];
  scorePops = [];
  sparks = [];
  cameraShake = 0;
  lastSpokenQId = "";
  silenceVoice();
  const pool = activePool.length ? activePool : QUESTION_POOL;
  poolOrder = shuffle(pool.map((_, i) => i));
  poolIndex = 0;

  let at = playerTrackPos() + 200 + Math.random() * 80;
  for (let i = 0; i < 2; i++) {
    gates.push({
      at,
      passed: false,
      question: takeQuestion(),
    });
    at += 320 + Math.random() * 140;
  }
  seedPickupsForAllSegments();
  syncQuestionPanel();
  updateHud();
}

function updateHud() {
  el.score.textContent = String(score);
  el.combo.textContent = String(combo);
  el.lives.textContent = String(lives);
  if (el.coinsHud) el.coinsHud.textContent = String(coinsBank);
  if (el.dist) el.dist.textContent = String(Math.floor(runMeters));
  if (el.playerHud) el.playerHud.textContent = playerName;
}

function showOverlay(title, msg, primaryLabel, onPrimary, showRestart = true) {
  el.overlayTitle.textContent = title;
  el.overlayMsg.textContent = msg;
  el.btnPrimary.textContent = primaryLabel;
  el.btnSecondary.style.display = showRestart ? "inline-block" : "none";
  el.overlay.classList.remove("hidden");
  el.btnPrimary.onclick = onPrimary;
  el.btnSecondary.onclick = () => {
    hideOverlay();
    initRun();
    paused = false;
    gameOver = false;
    lastTs = 0;
    raf = requestAnimationFrame(loop);
  };
}

function hideOverlay() {
  el.overlay.classList.add("hidden");
}

function laneFromClientX(clientX) {
  if (!gameHost) return 1;
  const rect = gameHost.getBoundingClientRect();
  const scaleX = W / Math.max(1, rect.width);
  const x = (clientX - rect.left) * scaleX;
  return Math.max(0, Math.min(LANES - 1, Math.floor(x / LANE_W)));
}

function setLane(lane) {
  if (gameOver || paused) return;
  player.lane = Math.max(0, Math.min(LANES - 1, lane));
  syncChoiceHighlight();
}

function moveLane(delta) {
  setLane(player.lane + delta);
}

function onKeyDown(e) {
  if (e.code === "ArrowLeft" || e.code === "KeyA") {
    e.preventDefault();
    moveLane(-1);
  }
  if (e.code === "ArrowRight" || e.code === "KeyD") {
    e.preventDefault();
    moveLane(1);
  }
  if (e.code === "Digit1" || e.code === "Numpad1") {
    e.preventDefault();
    setLane(0);
  }
  if (e.code === "Digit2" || e.code === "Numpad2") {
    e.preventDefault();
    setLane(1);
  }
  if (e.code === "Digit3" || e.code === "Numpad3") {
    e.preventDefault();
    setLane(2);
  }
  if (e.code === "Escape" || e.code === "KeyP") {
    e.preventDefault();
    if (gameOver) return;
    paused = !paused;
    if (paused) {
      cancelAnimationFrame(raf);
      voice.stopListening();
      voice.stopSpeaking();
      showOverlay("Paused", "Take a breath. Your combo is safe.", "Continue", () => {
        hideOverlay();
        paused = false;
        lastTs = 0;
        raf = requestAnimationFrame(loop);
        resumeVoiceIfNeeded();
      });
    }
  }
}

/** @type {number | null} */
let pointerDragStartX = null;
/** @type {number | null} */
let activeRoadPointerId = null;

function onRoadPointerDown(ev) {
  if (!ev.isPrimary) return;
  if (ev.pointerType === "mouse" && ev.button !== 0) return;
  pointerDragStartX = ev.clientX;
  activeRoadPointerId = ev.pointerId;
  try {
    gameHost?.setPointerCapture(ev.pointerId);
  } catch {
    /* ignore */
  }
}

function onRoadPointerUp(ev) {
  if (!ev.isPrimary || activeRoadPointerId !== ev.pointerId) return;
  if (pointerDragStartX == null) return;
  const startX = pointerDragStartX;
  pointerDragStartX = null;
  activeRoadPointerId = null;
  try {
    gameHost?.releasePointerCapture(ev.pointerId);
  } catch {
    /* ignore */
  }
  const endX = ev.clientX;
  const dx = endX - startX;
  if (Math.abs(dx) < 24) {
    setLane(laneFromClientX(endX));
    return;
  }
  if (dx < 0) moveLane(-1);
  else moveLane(1);
}

function onRoadPointerCancel(ev) {
  if (activeRoadPointerId !== ev.pointerId) return;
  pointerDragStartX = null;
  activeRoadPointerId = null;
}

function spawnScorePop(text, x, y, hue = "#fbbf24") {
  scorePops.push({
    text,
    x,
    y,
    life: 1,
    vy: -95,
    hue,
  });
}

function spawnSparks(x, y, good) {
  const color = good ? "#5eead4" : "#fb7185";
  const n = good ? 14 : 8;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const sp = 90 + Math.random() * 140;
    sparks.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - (good ? 40 : 20),
      life: 0.35 + Math.random() * 0.25,
      color,
    });
  }
}

/** @returns {boolean} true if game over */
function loseLife(popLabel) {
  combo = 0;
  lives -= 1;
  cameraShake = 0.32;
  const px = laneToX(player.lane, 1);
  const py = PLAYER_DRAW_Y;
  spawnScorePop(popLabel, px, py - 28, "#fb7185");
  spawnSparks(px, py - 6, false);
  if (lives <= 0) {
    gameOver = true;
    cancelAnimationFrame(raf);
    silenceVoice();
    showOverlay(
      "Run complete",
      `${playerName}, you scored ${score} pts over ${Math.floor(runMeters)} m. Again?`,
      "Play again",
      () => {
        hideOverlay();
        initRun();
        gameOver = false;
        lastTs = 0;
        raf = requestAnimationFrame(loop);
      }
    );
    return true;
  }
  updateHud();
  return false;
}

function processPickups() {
  const pw = playerTrackPos();
  for (const p of trackPickups) {
    if (Math.abs(pw - p.at) > 19) continue;
    if (player.lane !== p.lane) continue;

    if (p.kind === "coin") {
      if (p.collected) continue;
      p.collected = true;
      const add = 6 + Math.min(combo, 12);
      score += add;
      coinsBank += 1;
      const px = laneToX(player.lane, 1);
      spawnScorePop(`+${add}`, px, PLAYER_DRAW_Y - 32, "#fbbf24");
      spawnSparks(px, PLAYER_DRAW_Y - 8, true);
      updateHud();
    } else if (p.kind === "hazard" && !p.hit) {
      p.hit = true;
      if (loseLife("hit!")) return;
    }
  }

  trackPickups = trackPickups.filter((p) => {
    if (p.kind === "coin" && p.collected) return false;
    if (p.kind === "hazard" && p.hit) return false;
    return p.at > pw - 180;
  });
}

/**
 * @param {Gate} gate
 */
function resolveGate(gate) {
  gate.passed = true;
  const ok = player.lane === gate.question.correctLane;
  const px = laneToX(player.lane, 1);
  const py = PLAYER_DRAW_Y;

  if (ok) {
    const add = 10 + Math.min(combo, 20);
    score += add;
    combo += 1;
    spawnScorePop(`+${add} pts`, px, py - 28);
    spawnSparks(px, py - 6, true);
  } else {
    if (loseLife("miss")) return;
  }
  updateHud();
  appendGate();
  gates = gates.filter((g) => g.at > scroll - 400);
  syncQuestionPanel();
}

function updateFx(dt) {
  scorePops = scorePops.filter((p) => {
    p.life -= dt * 0.9;
    p.y += p.vy * dt;
    p.vy *= 0.92;
    return p.life > 0;
  });
  sparks = sparks.filter((s) => {
    s.life -= dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += 220 * dt;
    return s.life > 0;
  });
  if (cameraShake > 0) cameraShake = Math.max(0, cameraShake - dt);
}

function loop(ts) {
  if (paused || gameOver) return;
  if (!lastTs) lastTs = ts;
  const dt = Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;

  scroll += speed * dt;
  speed = Math.min(360, speed + 3.5 * dt);
  runMeters += (speed * dt) / 18;
  if (el.dist) el.dist.textContent = String(Math.floor(runMeters));

  const playerWorldY = PLAYER_WORLD_Y + scroll;
  processPickups();
  if (gameOver) {
    draw();
    return;
  }

  const next = activeGate();
  if (next && !next.passed && playerWorldY >= next.at - 12 && playerWorldY <= next.at + 28) {
    resolveGate(next);
  }

  updateFx(dt);
  draw();
  raf = requestAnimationFrame(loop);
}

function drawFx(shakeX, shakeY) {
  if (!ctx) return;
  ctx.save();
  ctx.translate(shakeX, shakeY);
  for (const s of sparks) {
    ctx.globalAlpha = Math.max(0, s.life * 3);
    ctx.fillStyle = s.color;
    ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;

  for (const p of scorePops) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.font = `700 ${16 + Math.floor((1 - p.life) * 8)}px "DM Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = p.hue;
    ctx.strokeStyle = "rgba(12,15,20,0.6)";
    ctx.lineWidth = 3;
    ctx.strokeText(p.text, p.x, p.y);
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawFxOverlay() {
  if (!ctx || !fxCanvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const mag = cameraShake > 0 ? cameraShake * 10 : 0;
  const shakeX = mag ? (Math.random() - 0.5) * mag : 0;
  const shakeY = mag ? (Math.random() - 0.5) * mag : 0;
  drawFx(shakeX, shakeY);
}

function draw() {
  if (track3d) {
    track3d.sync({
      playerTrackPos: playerTrackPos(),
      playerLane: player.lane,
      scroll,
      gates,
      trackPickups,
      cameraShake,
    });
  }
  drawFxOverlay();
}

el.btnPrimary.onclick = () => {
  hideOverlay();
  paused = false;
  lastTs = 0;
  raf = requestAnimationFrame(loop);
  resumeVoiceIfNeeded();
};

/**
 * @param {{ playerName: string; goalText: string; topics: string[]; questionPool: typeof QUESTION_POOL }} profile
 */
export function startGame(profile) {
  activePool = profile.questionPool?.length ? profile.questionPool : QUESTION_POOL;
  playerName = profile.playerName?.trim() || "Runner";
  cancelAnimationFrame(raf);
  paused = false;
  gameOver = false;
  lastTs = 0;

  if (!inputBound) {
    window.addEventListener("keydown", onKeyDown);
    const surface = gameHost || fxCanvas;
    surface?.addEventListener("pointerdown", onRoadPointerDown);
    surface?.addEventListener("pointerup", onRoadPointerUp);
    surface?.addEventListener("pointercancel", onRoadPointerCancel);
    inputBound = true;
  }

  if (!track3d && gameHost) {
    track3d = createTrackRenderer(gameHost);
  }
  ensureResizeObserver();
  refreshLayout();
  requestAnimationFrame(() => refreshLayout());

  wireVoiceUi();
  updateMicButtonEnabled();

  hideOverlay();
  initRun();
  raf = requestAnimationFrame(loop);
}
