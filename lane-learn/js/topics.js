/**
 * Lightweight topic classification from free-text goals (keyword / pattern scores).
 * Works offline; optional LLM adds richer coaching copy in onboarding only.
 */
const TOPIC_PATTERNS = {
  python: [/\bpython\b/i, /\bpy\b/i, /\bdjango\b/i, /\bpandas\b/i, /\bflask\b/i],
  javascript: [/\bjavascript\b/i, /\bjs\b/i, /\bnode\.?js\b/i, /\breact\b/i, /\btypescript\b/i, /\bts\b/i, /\bfrontend\b/i],
  git: [/\bgit\b/i, /\bgithub\b/i, /\bversion control\b/i, /\bbranch\b/i, /\bcommit\b/i],
  algorithms: [/\balgorithm/i, /\bdata struct/i, /\bleetcode\b/i, /\binterview\b/i, /\bbig ?o\b/i, /\bcomplexity\b/i],
  web: [/\bhttp\b/i, /\brest\b/i, /\bapi\b/i, /\bhtml\b/i, /\bcss\b/i, /\bweb\b/i],
  sql: [/\bsql\b/i, /\bpostgres/i, /\bmysql\b/i, /\bquery\b/i, /\bdatabase\b/i, /\bdb\b/i],
  math: [
    /\bmaths?\b/i,
    /\balgebra\b/i,
    /\bcalculus\b/i,
    /\bgeometry\b/i,
    /\btrigonometry\b/i,
    /\barithmetic\b/i,
    /\blinear algebra\b/i,
    /\bstatistics\b/i,
    /\bprobability\b/i,
    /\bdiscrete math\b/i,
    /\bpre-?calc\b/i,
    /\bnumber theory\b/i,
  ],
  assembly: [
    /\bassembly\b/i,
    /\basm\b/i,
    /\bx86\b/i,
    /\barm\b/i,
    /\bmips\b/i,
    /\bmachine code\b/i,
    /\bassembler\b/i,
    /\bnasm\b/i,
    /\bgas\b/i,
    /\blow-?level\b/i,
    /\bregisters?\b/i,
    /\binstruction set\b/i,
  ],
  systems: [
    /\bc\+\+\b/i,
    /\boperating system\b/i,
    /\bos kernels?\b/i,
    /\bmemory management\b/i,
    /\brust\b/i,
    /\bgolang\b/i,
    /\bembedded\b/i,
    /\bfirmware\b/i,
  ],
  science: [/\bphysics\b/i, /\bchemistry\b/i, /\bbiolog/i, /\bastro/i],
};

const TOPIC_LABELS = {
  python: "Python",
  javascript: "JavaScript",
  git: "Git",
  algorithms: "Algorithms",
  web: "Web / HTTP",
  sql: "SQL",
  math: "Math",
  assembly: "Assembly / low-level",
  systems: "Systems / C++ / Rust",
  science: "Science",
};

/**
 * @param {string} text
 * @returns {{ topics: string[]; scores: Record<string, number> }}
 */
export function classifyLearningGoals(text) {
  const raw = (text || "").trim();
  const scores = /** @type {Record<string, number>} */ ({});
  for (const topic of Object.keys(TOPIC_PATTERNS)) {
    scores[topic] = 0;
    for (const re of TOPIC_PATTERNS[topic]) {
      if (re.test(raw)) scores[topic] += 1;
    }
  }
  const topics = Object.entries(scores)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);
  return { topics, scores };
}

/**
 * @param {readonly { topic: string }[]} fullPool
 * @param {string[] | null} topics matched topic ids, or null/empty for mixed
 */
export function buildPersonalizedPool(fullPool, topics) {
  if (!topics || topics.length === 0) return [...fullPool];
  let filtered = fullPool.filter((q) => topics.includes(q.topic));
  if (filtered.length >= 6) return filtered;
  const need = 8 - filtered.length;
  const rest = fullPool.filter((q) => !topics.includes(q.topic));
  const extra = shuffle(rest).slice(0, Math.max(0, need));
  return shuffle([...filtered, ...extra]);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * @param {string[]} topics matched topic ids
 * @param {string} [goalHint] raw user goal — used when nothing matched so we echo their words
 */
export function humanizeTopics(topics, goalHint = "") {
  if (topics.length) return topics.map((t) => TOPIC_LABELS[t] || t).join(", ");
  const g = (goalHint || "").trim().replace(/\s+/g, " ");
  if (g) {
    const clip = g.length > 96 ? `${g.slice(0, 93)}…` : g;
    return `your goals (“${clip}”) — mixed quiz gates`;
  }
  return "a mixed practice run";
}
