/**
 * Browser voice agent: TTS for questions + Web Speech API for lane commands.
 * Works best in Chromium (Chrome/Edge). Requires HTTPS or localhost.
 */

const Rec =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

/** @type {SpeechRecognition | null} */
let recInstance = null;
let wantListen = false;

export function canUseRecognition() {
  return !!Rec;
}

export function canUseTTS() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Prefer a natural English female voice when the OS/browser exposes one.
 */
function pickFemaleEnglishVoice() {
  const list = speechSynthesis.getVoices();
  if (!list.length) return null;
  const score = (v) => {
    const n = `${v.name} ${v.voiceURI}`.toLowerCase();
    const en = /^en/i.test(v.lang) || v.lang === "";
    if (!en) return 0;
    if (/female|woman|zira|samantha|karen|susan|victoria|emma|joanna|nicole|amy|hazel|sarah|catherine|fiona|aria|jenny|linda|heather|sonia|lisa|ivy|kimberly/.test(n))
      return 3;
    if (/microsoft.*desktop|google.*english|samantha|victoria/.test(n)) return 2;
    return 1;
  };
  const ranked = [...list].sort((a, b) => score(b) - score(a));
  return ranked.find((v) => score(v) >= 2) || ranked.find((v) => /^en/i.test(v.lang)) || list[0];
}

function ensureVoicesLoaded() {
  if (!canUseTTS()) return;
  speechSynthesis.getVoices();
}

/** Fired when the current (or canceled) question read finishes — e.g. resume mic. */
let speakDoneCallback = null;
/** True while an utterance from speakQuestion should be treated as active (avoids double onDone). */
let ttsUtteranceLive = false;

export function stopSpeaking() {
  const done = speakDoneCallback;
  speakDoneCallback = null;
  ttsUtteranceLive = false;
  try {
    window.speechSynthesis.cancel();
  } catch (_) {}
  done?.();
}

/**
 * @param {string} transcript
 * @param {string[]} choices
 * @returns {number | null} lane index
 */
export function parseLaneFromSpeech(transcript, choices) {
  const t = transcript.toLowerCase().replace(/[.,!?]/g, " ").trim();
  if (!t) return null;

  if (/\bleft\b|^a\b|\bfirst\b|\bone\b(?!\s*(plus|and|or))|lane\s*(one|1)\b/.test(t)) return 0;
  if (/\bcenter\b|\bmiddle\b|^b\b|\bsecond\b|\btwo\b|lane\s*(two|2)\b/.test(t)) return 1;
  if (/\bright\b|^c\b|\bthird\b|\bthree\b|lane\s*(three|3)\b/.test(t)) return 2;

  const words = t.split(/\s+/).filter(Boolean);
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i].toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    if (!c) continue;
    const tokens = c.split(/\s+/).filter((w) => w.length > 1);
    for (const w of tokens) {
      if (w.length > 2 && t.includes(w)) return i;
    }
    if (c.length <= 10 && t.includes(c)) return i;
  }

  for (const w of words) {
    for (let i = 0; i < choices.length; i++) {
      const c = choices[i].toLowerCase();
      if (c.includes(w) && w.length > 2) return i;
    }
  }

  return null;
}

/**
 * Read the full prompt, then lane choices (extra wording helps TTS pause clearly).
 * @param {string} prompt
 * @param {string[]} choices
 * @param {() => void} [onDone] when this read finishes, errors, or is canceled
 */
export function speakQuestion(prompt, choices, onDone) {
  if (!canUseTTS()) {
    onDone?.();
    return;
  }
  stopSpeaking();
  speakDoneCallback = onDone ?? null;
  ttsUtteranceLive = true;
  ensureVoicesLoaded();
  let voicePick = pickFemaleEnglishVoice();
  if (!voicePick) {
    speechSynthesis.getVoices();
    voicePick = pickFemaleEnglishVoice();
  }
  const laneNames = ["Left", "Center", "Right"];
  const bits = choices.map((c, i) => `${laneNames[i]}, ${c}`);
  const text = `${prompt}. — Now the three answer lanes — ${bits.join(" — ")}.`;
  const u = new SpeechSynthesisUtterance(text);
  if (voicePick) u.voice = voicePick;
  u.rate = 0.84;
  u.pitch =
    voicePick && /male|david|mark|fred|daniel|james/i.test(voicePick.name) ? 1.18 : 1.08;
  const finish = () => {
    if (!ttsUtteranceLive) return;
    ttsUtteranceLive = false;
    const cb = speakDoneCallback;
    speakDoneCallback = null;
    cb?.();
  };
  u.onend = finish;
  u.onerror = finish;
  window.speechSynthesis.speak(u);
}

/**
 * @param {() => string[] | null | undefined} getChoices
 * @param {(lane: number) => void} onLane
 */
export function startListening(getChoices, onLane) {
  if (!Rec) return false;
  stopListening();
  wantListen = true;
  const rec = new Rec();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  const boot = () => {
    if (!wantListen) return;
    try {
      rec.start();
    } catch (_) {
      /* already running */
    }
  };

  rec.onend = () => {
    if (wantListen) setTimeout(boot, 100);
  };

  rec.onresult = (e) => {
    const chunk = [];
    for (let i = e.resultIndex; i < e.results.length; i++) {
      chunk.push(e.results[i][0].transcript);
    }
    const said = chunk.join(" ").trim();
    const choices = getChoices() || [];
    const lane = parseLaneFromSpeech(said, choices);
    if (lane !== null) onLane(lane);
  };

  rec.onerror = (err) => {
    if (err.error === "no-speech" || err.error === "aborted") return;
    console.warn("Speech recognition:", err.error);
  };

  recInstance = rec;
  boot();
  return true;
}

export function stopListening() {
  wantListen = false;
  if (recInstance) {
    try {
      recInstance.stop();
    } catch (_) {}
    recInstance.onend = null;
    recInstance = null;
  }
}

export function isListening() {
  return wantListen;
}
