// The companion: sunflower poses + streamed answer bubble + voice.
import { ensureBridge } from "../shared/dev-stub";
import {
  POSES,
  pixelArtSvg,
  type PixelArt,
} from "../../shared/sunflower-pixels";
import type { CompanionPose, StatePayload } from "../../shared/state";
import { finish, initTts, pushText, stopTts } from "./tts";

ensureBridge();

const flowerSvg = document.getElementById("flower-svg")!;
const bubble = document.getElementById("bubble")!;
const bubbleText = document.getElementById("bubble-text")!;
const stepBadge = document.getElementById("step-badge")!;

/* ~4.25 px per art pixel: the 1a flower is 51×38 for a 12×9 viewBox. */
const SCALE = 4.25;

function renderPose(pose: CompanionPose): void {
  const art: PixelArt = POSES[pose];
  const [vw, vh] = art.vb;
  flowerSvg.innerHTML = pixelArtSvg(
    art,
    Math.round(vw * SCALE),
    Math.round(vh * SCALE),
  );
  flowerSvg.classList.toggle("sway", pose === "idle");
}

window.sunflower.onState((payload: StatePayload) => {
  renderPose(payload.pose);
  if (payload.island === "idle" || payload.island === "listening") {
    bubble.hidden = true;
    bubbleText.textContent = "";
    stepBadge.hidden = true;
    // No idle state may ever coexist with an active voice.
    if (payload.island === "idle") stopTts();
  }
});

window.sunflower.onAnswerReset(() => {
  bubbleText.textContent = "";
  bubble.hidden = true;
  stepBadge.hidden = true;
  stopTts();
});

window.sunflower.onAnswerToken((text) => {
  if (bubble.hidden) bubble.hidden = false;
  bubbleText.textContent = (bubbleText.textContent ?? "") + text;
  bubble.scrollTop = bubble.scrollHeight;
  pushText(text);
});

window.sunflower.onAnswerDone(() => {
  finish();
});

window.sunflower.onTtsStop(() => {
  stopTts();
});

// Étape de guide : la bulle est remplacée (pas ajoutée) et lue à voix haute.
window.sunflower.onGuideStep(({ index, total, text, cut }) => {
  if (cut) stopTts();
  bubble.hidden = false;
  stepBadge.hidden = false;
  stepBadge.textContent = `step ${index} of ${total}`;
  bubbleText.textContent = text;
  bubble.scrollTop = 0;
  pushText(text);
  finish();
});

window.sunflower.onFlip((side) => {
  document.body.classList.toggle("flip", side === "left");
});

initTts(() => window.sunflower.sendTtsEnded());
renderPose("idle");
