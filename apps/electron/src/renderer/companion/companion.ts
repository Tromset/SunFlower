// Le compagnon : poses du tournesol + bulle de réponse streamée + voix.
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

/* ~4,25 px par pixel d'art : la fleur de 1a fait 51×38 pour un viewBox 12×9. */
const SCALE = 4.25;

function renderPose(pose: CompanionPose): void {
  const art: PixelArt = POSES[pose];
  const [vw, vh] = art.vb;
  flowerSvg.innerHTML = pixelArtSvg(
    art,
    Math.round(vw * SCALE),
    Math.round(vh * SCALE),
  );
  flowerSvg.classList.toggle("sway", pose === "veille");
}

window.sunflower.onState((payload: StatePayload) => {
  renderPose(payload.pose);
  if (payload.island === "veille" || payload.island === "ecoute") {
    bubble.hidden = true;
    bubbleText.textContent = "";
    // Aucun état de veille ne doit coexister avec une voix active.
    if (payload.island === "veille") stopTts();
  }
});

window.sunflower.onAnswerReset(() => {
  bubbleText.textContent = "";
  bubble.hidden = true;
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

window.sunflower.onFlip((side) => {
  document.body.classList.toggle("flip", side === "left");
});

initTts(() => window.sunflower.sendTtsEnded());
renderPose("veille");
