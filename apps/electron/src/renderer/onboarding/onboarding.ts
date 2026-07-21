// Accueil en trois étapes : bienvenue → permissions → modèle.
import { ensureBridge } from "../shared/dev-stub";
import { FIELD, POSES, pixelArtSvg } from "../../shared/sunflower-pixels";
import type { PanelData, PermissionId } from "../../shared/state";

ensureBridge();

document.getElementById("welcome-flower")!.innerHTML = pixelArtSvg(
  POSES.veille,
  44,
  50,
);

// Champ de tournesols du pied de page (tailles du prototype 1e).
const strip = document.getElementById("field-strip")!;
strip.innerHTML = [16, 13, 16, 12, 16, 13]
  .map((w) => pixelArtSvg(FIELD, w, Math.round((w * 9) / 8)))
  .join("");

const steps = [1, 2, 3].map(
  (n) => document.getElementById(`step-${n}`) as HTMLElement,
);
const dots = Array.from(document.querySelectorAll<HTMLElement>(".dot"));
const nextBtn = document.getElementById("next")!;
const nextLabel = document.getElementById("next-label")!;
let current = 0;

function showStep(index: number): void {
  current = index;
  steps.forEach((el, i) => (el.hidden = i !== index));
  dots.forEach((el, i) => el.classList.toggle("active", i === index));
  nextLabel.textContent = index === 2 ? "commencer" : "continuer";
}

nextBtn.addEventListener("click", () => {
  if (current < 2) showStep(current + 1);
  else void window.sunflower.onboardingDone();
});

// ---- permissions (étape 02) --------------------------------------------
for (const item of document.querySelectorAll<HTMLElement>(".perm-item")) {
  item.querySelector(".perm-action")!.addEventListener("click", () => {
    void window.sunflower.requestPermission(
      item.dataset["perm"] as PermissionId,
    );
  });
}

// ---- statuts vivants ----------------------------------------------------
const checkOllama = document.getElementById("check-ollama")!;
const checkModel = document.getElementById("check-model")!;
const checkVoice = document.getElementById("check-voice")!;
const voiceDesc = document.getElementById("voice-desc")!;
const voiceDownload = document.getElementById("voice-download")!;
const voiceCheck = document.getElementById("voice-check")!;
const voiceProgress = document.getElementById("voice-progress")!;
const voiceProgressBar = document.getElementById("voice-progress-bar")!;

voiceDownload.addEventListener("click", () => {
  void window.sunflower.downloadWhisper();
});

function setCheck(item: HTMLElement, ok: boolean, badge: string): void {
  item.classList.toggle("ok", ok);
  const el = item.querySelector(".check-badge") as HTMLElement;
  el.textContent = badge;
}

function render(data: PanelData): void {
  // étape 02
  for (const item of document.querySelectorAll<HTMLElement>(".perm-item")) {
    const id = item.dataset["perm"] as PermissionId;
    const granted = data.permissions[id] === "granted";
    item.classList.toggle("granted", granted);
    const existing = item.querySelector(".perm-status-ok");
    if (granted && !existing) {
      const ok = document.createElement("span");
      ok.className = "perm-status-ok";
      ok.textContent = "accordée";
      item.appendChild(ok);
    } else if (!granted && existing) {
      existing.remove();
    }
  }
  // étape 03
  setCheck(
    checkOllama,
    data.model.reachable,
    data.model.reachable ? "[ok] joignable" : "[--] hors ligne",
  );
  document.getElementById("check-model-name")!.textContent = data.model.name;
  document.getElementById("check-model-cmd")!.textContent =
    `lancez : ollama pull ${data.model.name}`;
  setCheck(
    checkModel,
    data.model.pulled,
    data.model.pulled ? "[ok] présent" : "[--] absent",
  );
  const stt = data.stt.status;
  voiceProgress.hidden = stt !== "downloading";
  voiceDownload.hidden = stt !== "absent";
  voiceCheck.hidden = stt === "absent";
  if (stt === "downloading") {
    const pct = data.stt.progress ?? 0;
    voiceProgressBar.style.width = `${pct}%`;
    voiceDesc.textContent = `téléchargement en cours — ${pct} %`;
    setCheck(checkVoice, false, "[..]");
  } else if (stt === "ready") {
    voiceDesc.textContent = "prête — tout se passe sur votre Mac.";
    setCheck(checkVoice, true, "[ok] prête");
  } else if (stt === "loading") {
    voiceDesc.textContent = "chargement du modèle de voix…";
    setCheck(checkVoice, false, "[..]");
  } else if (stt === "absent") {
    voiceDesc.textContent = "un téléchargement de ~190 Mo, une seule fois.";
  } else {
    voiceDesc.textContent = data.stt.error ?? "voix indisponible.";
    setCheck(checkVoice, false, "[!!]");
  }
}

window.sunflower.onPanelData(render);
void window.sunflower.getStatus().then(render);
showStep(0);
