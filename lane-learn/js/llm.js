/**
 * Optional OpenAI-compatible chat for coach dialogue.
 * Key: localStorage "vibe_openai_key" (browser only — fine for local dev, not for public prod).
 */

const STORAGE_KEY = "vibe_openai_key";

export function getStoredApiKey() {
  return localStorage.getItem(STORAGE_KEY) || "";
}

export function setStoredApiKey(value) {
  const v = (value || "").trim();
  if (v) localStorage.setItem(STORAGE_KEY, v);
  else localStorage.removeItem(STORAGE_KEY);
}

/**
 * @param {string} playerName
 * @param {string} goalText
 * @param {string} topicSummary human-readable topic line from classifier
 * @returns {Promise<string | null>}
 */
export async function fetchCoachEncouragement(playerName, goalText, topicSummary) {
  const key = getStoredApiKey();
  if (!key) return null;

  const body = {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are Lane Coach, a brief upbeat coding mentor. Reply in at most 2 short sentences. No markdown or bullet lists.",
      },
      {
        role: "user",
        content: `Student: "${playerName}". They want to learn: "${goalText}". I will emphasize: ${topicSummary}. Encourage them and mention one concrete habit for practice.`,
      },
    ],
    max_tokens: 120,
    temperature: 0.75,
  };

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn("Coach API error:", res.status, err);
      return null;
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (e) {
    console.warn("Coach API failed:", e);
    return null;
  }
}
