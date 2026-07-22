// Panel: live status (permissions, model, voice), tabs, background agents, quit.
import { ensureBridge } from "../shared/dev-stub";
import { POSES, pixelArtSvg } from "../../shared/sunflower-pixels";
import type { PanelData, PermissionId } from "../../shared/state";
import type {
  AgentDecision,
  AgentRun,
  AgentRunSummary,
  AgentStatus,
} from "../../shared/agents";

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
    // Screen recording needs a relaunch after the macOS grant.
    if (id === "screen") {
      row.title = granted
        ? ""
        : "checked in System Settings? quit and relaunch sunflower.";
    }
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

// ---- Agents de code en arrière-plan ------------------------------------
// Rien n'est écrit sur disque depuis cette vue sans un clic accept explicite,
// fichier par fichier (agentDecide côté main).
const taskInput = document.getElementById("agent-task") as HTMLTextAreaElement;
const dirInput = document.getElementById("agent-dir") as HTMLInputElement;
const runBtn = document.getElementById("agent-run") as HTMLButtonElement;
const formError = document.getElementById("agent-form-error")!;
const agentListEl = document.getElementById("agent-list")!;
const agentsEmptyEl = document.getElementById("agents-empty")!;
const agentsMainEl = document.getElementById("agents-main")!;
const reviewEl = document.getElementById("agent-review")!;
const reviewTaskEl = document.getElementById("review-task")!;
const reviewStatusEl = document.getElementById("review-status")!;
const reviewFilesEl = document.getElementById("review-files")!;

dirInput.value = localStorage.getItem("sf-agent-dir") ?? "";

let agentRuns: AgentRunSummary[] = [];
let reviewedId: string | null = null;

const STATUS_BADGE: Record<AgentStatus, [string, string]> = {
  queued: ["off", "[..] queued"],
  running: ["off", "[..] running"],
  "awaiting-review": ["warn", "[!!] review"],
  done: ["ok", "[ok] done"],
  failed: ["warn", "[--] failed"],
};

function renderAgentList(): void {
  agentsEmptyEl.hidden = agentRuns.length > 0;
  agentListEl.textContent = "";
  for (const run of agentRuns) {
    const row = document.createElement("div");
    row.className = "agent-row";
    const task = document.createElement("span");
    task.className = "agent-task";
    task.textContent = run.task;
    task.title = `${run.task}\n${run.workdir}`;
    const [cls, label] = STATUS_BADGE[run.status];
    const badge = document.createElement("span");
    badge.className = `badge ${cls}`;
    badge.textContent =
      run.status === "awaiting-review"
        ? `[!!] review ${run.decided}/${run.files}`
        : label;
    if (run.error) badge.title = run.error;
    row.append(task, badge);
    if (run.status === "queued" || run.status === "running") {
      const cancel = document.createElement("button");
      cancel.className = "agent-cancel";
      cancel.type = "button";
      cancel.textContent = "✕";
      cancel.title = "cancel";
      cancel.addEventListener("click", (e) => {
        e.stopPropagation();
        void window.sunflower.agentCancel(run.id);
      });
      row.append(cancel);
    }
    row.addEventListener("click", () => void openReview(run.id));
    agentListEl.append(row);
  }
}

async function openReview(id: string): Promise<void> {
  const run = await window.sunflower.agentGet(id);
  if (!run) return;
  reviewedId = id;
  renderReview(run);
  agentsMainEl.hidden = true;
  reviewEl.hidden = false;
}

function closeReview(): void {
  reviewedId = null;
  reviewEl.hidden = true;
  agentsMainEl.hidden = false;
}

const STATUS_TEXT: Record<AgentStatus, string> = {
  queued: "queued…",
  running: "running in the background…",
  "awaiting-review": "review each file — nothing is written until you accept.",
  done: "finished.",
  failed: "failed.",
};

function renderReview(run: AgentRun): void {
  reviewTaskEl.textContent = run.task;
  reviewStatusEl.textContent = run.error
    ? `${STATUS_TEXT[run.status]} ${run.error}`
    : STATUS_TEXT[run.status];
  reviewFilesEl.textContent = "";
  if (run.proposal.length === 0) {
    const last = [...run.transcript]
      .reverse()
      .find((t) => t.role === "assistant");
    const p = document.createElement("p");
    p.className = "agents-empty";
    p.textContent = last?.content ?? "no proposal.";
    reviewFilesEl.append(p);
    return;
  }
  for (const change of run.proposal) {
    const box = document.createElement("div");
    box.className = "review-file";
    const head = document.createElement("div");
    head.className = "review-file-head";
    const pathEl = document.createElement("span");
    pathEl.className = "review-path";
    pathEl.textContent = change.path;
    pathEl.title = change.path;
    head.append(pathEl);
    const decision = run.decisions[change.path];
    if (decision) {
      const d = document.createElement("span");
      d.className = `review-decision ${decision}`;
      d.textContent = decision === "accepted" ? "accepted" : "denied";
      head.append(d);
    } else if (run.status === "awaiting-review") {
      const actions = document.createElement("div");
      actions.className = "review-actions";
      const accept = document.createElement("button");
      accept.type = "button";
      accept.className = "btn-accept";
      accept.textContent = "accept";
      accept.addEventListener("click", () =>
        void decide(run.id, change.path, "accepted"),
      );
      const deny = document.createElement("button");
      deny.type = "button";
      deny.className = "btn-deny";
      deny.textContent = "deny";
      deny.addEventListener("click", () =>
        void decide(run.id, change.path, "denied"),
      );
      actions.append(accept, deny);
      head.append(actions);
    }
    const diff = document.createElement("div");
    diff.className = "diff";
    for (const line of diffLines(change.before, change.after)) {
      const el = document.createElement("div");
      el.className = `diff-line ${line.type}`;
      el.textContent = line.text;
      diff.append(el);
    }
    box.append(head, diff);
    reviewFilesEl.append(box);
  }
}

async function decide(
  id: string,
  path: string,
  decision: AgentDecision,
): Promise<void> {
  const run = await window.sunflower.agentDecide(id, path, decision);
  if (run && reviewedId === id) renderReview(run);
}

// ---- Diff avant/après (LCS ligne à ligne, bornée) -----------------------
interface DiffLine {
  type: "same" | "add" | "del" | "skip";
  text: string;
}

function splitLines(s: string): string[] {
  const lines = s.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const DIFF_MAX_LINES = 300;

function diffLines(before: string | null, after: string): DiffLine[] {
  const a = before === null ? [] : splitLines(before);
  const b = splitLines(after);
  if (a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES) {
    // Trop gros pour un LCS confortable : avant tronqué puis après tronqué.
    return [
      ...a.slice(0, 60).map((text) => ({ type: "del" as const, text: `- ${text}` })),
      { type: "skip", text: "··· file too large for a full diff ···" },
      ...b.slice(0, 60).map((text) => ({ type: "add" as const, text: `+ ${text}` })),
    ];
  }
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j]
          ? (dp[i + 1]![j + 1] ?? 0) + 1
          : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
    }
  }
  const raw: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ type: "same", text: `  ${a[i]}` });
      i++;
      j++;
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      raw.push({ type: "del", text: `- ${a[i]}` });
      i++;
    } else {
      raw.push({ type: "add", text: `+ ${b[j]}` });
      j++;
    }
  }
  for (; i < n; i++) raw.push({ type: "del", text: `- ${a[i]}` });
  for (; j < m; j++) raw.push({ type: "add", text: `+ ${b[j]}` });
  // Ne garder que 2 lignes de contexte autour des changements.
  const keep = new Array<boolean>(raw.length).fill(false);
  raw.forEach((line, idx) => {
    if (line.type === "same") return;
    for (
      let k = Math.max(0, idx - 2);
      k <= Math.min(raw.length - 1, idx + 2);
      k++
    ) {
      keep[k] = true;
    }
  });
  const out: DiffLine[] = [];
  let skipping = false;
  raw.forEach((line, idx) => {
    if (keep[idx]) {
      out.push(line);
      skipping = false;
    } else if (!skipping) {
      out.push({ type: "skip", text: "···" });
      skipping = true;
    }
  });
  return out;
}

// ---- Formulaire + abonnements -------------------------------------------
runBtn.addEventListener("click", () => {
  const task = taskInput.value.trim();
  const dir = dirInput.value.trim();
  formError.hidden = true;
  if (!task || !dir) {
    formError.textContent = !task
      ? "describe the task first."
      : "give the project folder path.";
    formError.hidden = false;
    return;
  }
  localStorage.setItem("sf-agent-dir", dir);
  runBtn.disabled = true;
  window.sunflower
    .agentStart(task, dir)
    .then((summary) => {
      taskInput.value = "";
      if (summary.status === "failed" && summary.error) {
        formError.textContent = summary.error;
        formError.hidden = false;
      }
    })
    .catch(() => {
      formError.textContent = "couldn't start the agent.";
      formError.hidden = false;
    })
    .finally(() => {
      runBtn.disabled = false;
    });
});

document.getElementById("review-back")!.addEventListener("click", closeReview);

window.sunflower.onAgentsChanged((runs) => {
  agentRuns = runs;
  renderAgentList();
  // La revue ouverte suit l'agent (fin d'exécution, décision ailleurs…).
  if (reviewedId) {
    void window.sunflower.agentGet(reviewedId).then((run) => {
      if (run && reviewedId === run.id) renderReview(run);
    });
  }
});
void window.sunflower.agentsList().then((runs) => {
  agentRuns = runs;
  renderAgentList();
});

window.sunflower.onPanelData(render);
void window.sunflower.getStatus().then(render);
