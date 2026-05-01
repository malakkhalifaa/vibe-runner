import { startOnboarding } from "./onboarding.js";
import { startGame } from "./game.js";

const app = document.getElementById("app");
const onboarding = document.getElementById("onboarding");

if (!app || !onboarding) {
  throw new Error("Missing #app or #onboarding");
}

startOnboarding((profile) => {
  onboarding.classList.add("hidden");
  app.classList.remove("hidden");
  startGame(profile);
});
