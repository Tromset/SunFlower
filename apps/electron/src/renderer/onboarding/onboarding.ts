// Three-step welcome: welcome → permissions → model.
import { ensureBridge } from "../shared/dev-stub";
import { FIELD, POSES, pixelArtSvg } from "../../shared/sunflower-pixels";
import type { PanelData, PermissionId } from "../../shared/state";

ensureBridge();

document.getElementById("welcome-flower")!.innerHTML = pixelArtSvg(
  POSES.idle,
  44,
  50,
);

// Footer sunflower field (sizes from prototype 1e).
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
  nextLabel.textContent = index === 2 ? "get started" : "continue";
}

nextBtn.addEventListener("click", () => {
  if (current < 2) showStep(current + 1);
  else void window.sunflower.onboardingDone();
});

// ---- permissions (step 02) ---------------------------------------------
for (const item of document.querySelectorAll<HTMLElement>(".perm-item")) {
  item.querySelector(".perm-action")!.addEventListener("click", () => {
    void window.sunflower.requestPermission(
      item.dataset["perm"] as PermissionId,
    );
  });
}

// ---- live status --------------------------------------------------------
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
  // step 02
  for (const item of document.querySelectorAll<HTMLElement>(".perm-item")) {
    const id = item.dataset["perm"] as PermissionId;
    const granted = data.permissions[id] === "granted";
    item.classList.toggle("granted", granted);
    const existing = item.querySelector(".perm-status-ok");
    if (granted && !existing) {
      const ok = document.createElement("span");
      ok.className = "perm-status-ok";
      ok.textContent = "granted";
      item.appendChild(ok);
    } else if (!granted && existing) {
      existing.remove();
    }
  }
  // step 03
  setCheck(
    checkOllama,
    data.model.reachable,
    data.model.reachable ? "[ok] reachable" : "[--] offline",
  );
  document.getElementById("check-model-name")!.textContent = data.model.name;
  document.getElementById("check-model-cmd")!.textContent =
    `run: ollama pull ${data.model.name}`;
  setCheck(
    checkModel,
    data.model.pulled,
    data.model.pulled ? "[ok] present" : "[--] missing",
  );
  const stt = data.stt.status;
  voiceProgress.hidden = stt !== "downloading";
  voiceDownload.hidden = stt !== "absent";
  voiceCheck.hidden = stt === "absent";
  if (stt === "downloading") {
    const pct = data.stt.progress ?? 0;
    voiceProgressBar.style.width = `${pct}%`;
    voiceDesc.textContent = `downloading — ${pct}%`;
    setCheck(checkVoice, false, "[..]");
  } else if (stt === "ready") {
    voiceDesc.textContent = "ready — everything happens on your Mac.";
    setCheck(checkVoice, true, "[ok] ready");
  } else if (stt === "loading") {
    voiceDesc.textContent = "loading the voice model…";
    setCheck(checkVoice, false, "[..]");
  } else if (stt === "absent") {
    voiceDesc.textContent = "a ~190 MB download, just once.";
  } else {
    voiceDesc.textContent = data.stt.error ?? "voice unavailable.";
    setCheck(checkVoice, false, "[!!]");
  }
}

window.sunflower.onPanelData(render);
void window.sunflower.getStatus().then(render);
showStep(0);
