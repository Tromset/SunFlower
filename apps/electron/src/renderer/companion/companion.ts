// The companion: sunflower poses + streamed answer bubble + voice.
import { ensureBridge } from "../shared/dev-stub";
import {
  BEE,
  CODING,
  POSES,
  READING,
  WORKING,
  pixelArtSvg,
  type PixelArt,
} from "../../shared/sunflower-pixels";
import type { CompanionPose, StatePayload } from "../../shared/state";
import { finish, initTts, pushText, stopTts } from "./tts";

ensureBridge();

const flower = document.getElementById("flower")!;
const flowerSvg = document.getElementById("flower-svg")!;
const bubble = document.getElementById("bubble")!;
const bubbleText = document.getElementById("bubble-text")!;
const stepBadge = document.getElementById("step-badge")!;

/* ~4.25 px per art pixel: the 1a flower is 51×38 for a 12×9 viewBox. */
const SCALE = 4.25;

/**
 * Les abeilles « thinking » : 2-3 petites abeilles pixel qui tournent autour
 * de la tête du tournesol. Construites une seule fois ; toute l'animation est
 * en CSS et ne tourne que lorsque #flower porte la classe .thinking (sinon
 * .bees est en display:none, donc aucune boucle/timer ne fuit hors de l'état).
 */
function buildBees(): void {
  const bees = document.createElement("div");
  bees.className = "bees";
  bees.setAttribute("aria-hidden", "true");
  const beeSvg = pixelArtSvg(BEE, 14, 11);
  for (let i = 1; i <= 3; i++) {
    const bee = document.createElement("span");
    bee.className = `bee bee-${i}`;
    const sprite = document.createElement("span");
    sprite.className = "bee-sprite";
    sprite.innerHTML = beeSvg;
    bee.appendChild(sprite);
    bees.appendChild(bee);
  }
  flower.appendChild(bees);
}

/** Pose → art. Les poses de base viennent de POSES ; les vignettes d'activité
    (coding/reading/working) sont des scènes dédiées. L'île garde ses propres
    petites icônes (ICONS), donc ces scènes plus larges ne concernent que le
    companion. */
const POSE_ART: Record<CompanionPose, PixelArt> = {
  idle: POSES.idle,
  listening: POSES.listening,
  thinking: POSES.thinking,
  answering: POSES.answering,
  pointing: POSES.pointing,
  coding: CODING,
  reading: READING,
  working: WORKING,
};

/** Poses dont l'animation est portée par une classe sur #flower : hors de cet
    état la classe disparaît, l'animation CSS s'arrête et aucun timer ne fuit. */
const ACTIVITY_CLASSES = ["coding", "reading", "working"] as const;

function renderPose(pose: CompanionPose): void {
  const art: PixelArt = POSE_ART[pose];
  const [vw, vh] = art.vb;
  flowerSvg.innerHTML = pixelArtSvg(
    art,
    Math.round(vw * SCALE),
    Math.round(vh * SCALE),
  );
  flowerSvg.classList.toggle("sway", pose === "idle");
  // Les abeilles n'apparaissent (et ne s'animent) qu'en état « thinking ».
  flower.classList.toggle("thinking", pose === "thinking");
  // Vignettes d'activité : une seule classe active à la fois.
  for (const cls of ACTIVITY_CLASSES) {
    flower.classList.toggle(cls, pose === cls);
  }
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
buildBees();
renderPose("idle");
