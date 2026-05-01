import { QUESTION_POOL } from "./content.js";
import { classifyLearningGoals, buildPersonalizedPool, humanizeTopics } from "./topics.js";
import { fetchCoachEncouragement, getStoredApiKey, setStoredApiKey } from "./llm.js";

const steps = {
  ASK_NAME: "ask_name",
  ASK_GOAL: "ask_goal",
  WRAP_UP: "wrap_up",
};

/**
 * @param {(profile: { playerName: string; goalText: string; topics: string[]; questionPool: typeof QUESTION_POOL }) => void} onDone
 */
export function startOnboarding(onDone) {
  const chat = document.getElementById("coachChat");
  const form = document.getElementById("coachForm");
  const input = document.getElementById("coachInput");
  const keyInput = document.getElementById("openaiKey");
  const saveKeyBtn = document.getElementById("saveKey");
  const startBtn = document.getElementById("btnStartRun");
  const typing = document.getElementById("coachTyping");

  if (!chat || !form || !input) {
    console.error("Onboarding DOM missing");
    onDone(fallbackProfile());
    return;
  }

  let phase = steps.ASK_NAME;
  /** @type {{ name: string; goal: string }} */
  const answers = { name: "", goal: "" };

  function fallbackProfile() {
    return {
      playerName: "Runner",
      goalText: "",
      topics: [],
      questionPool: [...QUESTION_POOL],
    };
  }

  function scrollChat() {
    chat.scrollTop = chat.scrollHeight;
  }

  function addBubble(text, who) {
    const row = document.createElement("div");
    row.className = `coach-row ${who}`;
    const bubble = document.createElement("div");
    bubble.className = `coach-bubble ${who}`;
    bubble.textContent = text;
    row.appendChild(bubble);
    chat.appendChild(row);
    scrollChat();
  }

  function setTyping(on) {
    if (typing) typing.classList.toggle("hidden", !on);
    scrollChat();
  }

  function showStart() {
    if (startBtn) {
      startBtn.classList.remove("hidden");
      startBtn.focus();
    }
    input.disabled = true;
    form.querySelector("button[type='submit']")?.setAttribute("disabled", "true");
  }

  botOpen();

  function botOpen() {
    addBubble(
      "Hey — I'm Lane Coach. Two quick questions, then I’ll line up gates from what you type — coding, math, assembly, science, and more.",
      "bot"
    );
    addBubble("First: what should I call you?", "bot");
    input.placeholder = "Your name…";
    input.disabled = false;
    input.focus();
  }

  async function afterGoal() {
    phase = steps.WRAP_UP;
    const { topics } = classifyLearningGoals(answers.goal);
    const topicLine = humanizeTopics(topics, answers.goal);
    const pool = buildPersonalizedPool(QUESTION_POOL, topics.length ? topics : null);

    addBubble(
      `Got it. From what you wrote, I’ll weight questions toward ${topicLine}.`,
      "bot"
    );

    setTyping(true);
    const ai = await fetchCoachEncouragement(answers.name, answers.goal, topicLine);
    setTyping(false);

    if (ai) addBubble(ai, "bot");
    else
      addBubble(
        "When you’re ready, hit Start run — stay in the lane that matches the answer. You’ve got this.",
        "bot"
      );

    showStart();

    if (startBtn) {
      startBtn.onclick = () => {
        onDone({
          playerName: answers.name.trim() || "Runner",
          goalText: answers.goal.trim(),
          topics,
          questionPool: pool,
        });
      };
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = input.value.trim();
    if (!raw) return;

    addBubble(raw, "user");
    input.value = "";

    if (phase === steps.ASK_NAME) {
      answers.name = raw.slice(0, 48);
      phase = steps.ASK_GOAL;
      addBubble(`Nice to meet you, ${answers.name}. What do you want to learn or level up in?`, "bot");
      input.placeholder = "e.g. Maths, assembly, Python, physics…";
      return;
    }

    if (phase === steps.ASK_GOAL) {
      answers.goal = raw.slice(0, 500);
      void afterGoal();
    }
  });

  saveKeyBtn?.addEventListener("click", () => {
    const v = keyInput?.value?.trim() || "";
    if (v) setStoredApiKey(v);
    else setStoredApiKey("");
    addBubble(
      getStoredApiKey()
        ? "API key saved in this browser for coach replies."
        : "Cleared API key — I’ll use offline tips only.",
      "bot"
    );
  });
}
