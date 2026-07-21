// Panel: live status (permissions, model, voice), tabs, quit.
import { ensureBridge } from "../shared/dev-stub";
import { POSES, pixelArtSvg } from "../../shared/sunflower-pixels";
import type { PanelData, PermissionId } from "../../shared/state";

ensureBridge();

document.getElementById("brand-icon")!.innerHTML = pixelArtSvg(
  POSES.idle,
  15,
  17,
);

const liveDot = document.getElementById("live-dot")!;
const liveLabel = document.getElementById("live-label")!;
const modelName = document.getElementById("model-name")!;
const modelBadge = document.getElementById("model-badge")!;
const voiceSub = document.getElementById("voice-sub")!;
const voiceBadge = document.getElementById("voice-badge")!;
const versionEl = document.querySelector(".version")!;

let sttStatus = "loading";

function renderPermissions(data: PanelData): void {
  for (const row of document.querySelectorAll<HTMLElement>(".perm-row")) {
    const id = row.dataset["perm"] as PermissionId;
    const granted = data.permissions[id] === "granted";
    row.classList.toggle("granted", granted);
    row.querySelector(".perm-status")!.innerHTML =
      `<span class="dot"></span>${granted ? "granted" : "not granted"}`;
  }
}

function renderModel(data: PanelData): void {
  modelName.textContent = data.model.name;
  const set = (cls: string, text: string) => {
    modelBadge.className = `badge ${cls}`;
    modelBadge.textContent = text;
  };
  if (!data.model.reachable) set("off", "[--] offline");
  else if (!data.model.pulled) set("warn", "[!!] to download");
  else set("ok", "[ok] local");
}

function renderVoice(data: PanelData): void {
  sttStatus = data.stt.status;
  const short = data.stt.model
    .replace(/^ggml-/, "")
    .replace(/\.bin$/, "")
    .replace(/-q\d.*$/, "");
  voiceSub.textContent = `whisper · ${short}`;
  const set = (cls: string, text: string, action = false) => {
    voiceBadge.className = `badge ${cls}${action ? " action" : ""}`;
    voiceBadge.textContent = text;
  };
  switch (data.stt.status) {
    case "ready":
      set("ok", "[ok] local");
      break;
    case "downloading":
      set("off", `[..] ${data.stt.progress ?? 0}%`);
      break;
    case "loading":
      set("off", "[..] loading");
      break;
    case "absent":
      set("warn", "[--] download", true);
      break;
    default:
      set("warn", "[!!] unavailable");
      if (data.stt.error) voiceBadge.title = data.stt.error;
  }
}

function render(data: PanelData): void {
  liveDot.classList.toggle("off", !data.hotkeyAvailable);
  liveLabel.textContent = data.hotkeyAvailable ? "active" : "waiting";
  versionEl.textContent = `v${data.version.split(".").slice(0, 2).join(".")} · 100% local`;
  renderPermissions(data);
  renderModel(data);
  renderVoice(data);
}

for (const row of document.querySelectorAll<HTMLElement>(".perm-row")) {
  row.addEventListener("click", () => {
    if (!row.classList.contains("granted")) {
      void window.sunflower.requestPermission(
        row.dataset["perm"] as PermissionId,
      );
    }
  });
}

voiceBadge.addEventListener("click", () => {
  if (sttStatus === "absent") void window.sunflower.downloadWhisper();
});

const tabHome = document.getElementById("tab-home")!;
const tabAgents = document.getElementById("tab-agents")!;
const viewHome = document.getElementById("view-home")!;
const viewAgents = document.getElementById("view-agents")!;
function selectTab(agents: boolean): void {
  tabHome.classList.toggle("active", !agents);
  tabAgents.classList.toggle("active", agents);
  (viewHome as HTMLElement).hidden = agents;
  (viewAgents as HTMLElement).hidden = !agents;
}
tabHome.addEventListener("click", () => selectTab(false));
tabAgents.addEventListener("click", () => selectTab(true));

document.getElementById("quit")!.addEventListener("click", () => {
  void window.sunflower.quit();
});

window.sunflower.onPanelData(render);
void window.sunflower.getStatus().then(render);
