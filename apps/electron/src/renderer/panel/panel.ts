// Panel: live status (permissions, model, voice), tabs, background agents, quit.
import { ensureBridge } from "../shared/dev-stub";
import { POSES, pixelArtSvg } from "../../shared/sunflower-pixels";
import type { PanelData, PermissionId } from "../../shared/state";
import type {
  AgentCommandDecision,
  AgentDecision,
  AgentEvent,
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

// Le rond des agents demande d'ouvrir directement sur l'onglet agents.
window.sunflower.onPanelFocusAgents(() => selectTab(true));

document.getElementById("quit")!.addEventListener("click", () => {
  void window.sunflower.quit();
});

// ---- Compagnon : roam ↔ dock ------------------------------------------
// Même état que le menu du tray et le double-clic sur la fleur ; on passe par
// la bascule partagée (companionToggleDock) pour ne garder qu'une seule source
// de vérité (companionMode dans la config).
const segRoam = document.getElementById("seg-roam")!;
const segDock = document.getElementById("seg-dock")!;

function renderCompanionMode(docked: boolean): void {
  segRoam.classList.toggle("active", !docked);
  segDock.classList.toggle("active", docked);
}

function applyCompanionMode(targetDocked: boolean): void {
  // Déjà dans l'état voulu : ne rien basculer (la bascule est un toggle).
  if (segDock.classList.contains("active") === targetDocked) return;
  void window.sunflower.companionToggleDock().then(async () => {
    // onCompanionDocked ne se déclenche que si la fenêtre du compagnon est
    // vivante ; on relit la config pour refléter l'état dans tous les cas.
    const cfg = await window.sunflower.getConfig();
    renderCompanionMode(cfg.companionMode === "docked");
  });
}

segRoam.addEventListener("click", () => applyCompanionMode(false));
segDock.addEventListener("click", () => applyCompanionMode(true));

// Rester synchro quand la bascule vient d'ailleurs (tray, double-clic).
window.sunflower.onCompanionDocked(renderCompanionMode);
void window.sunflower
  .getConfig()
  .then((cfg) => renderCompanionMode(cfg.companionMode === "docked"));

// ---- Agents de code en arrière-plan ------------------------------------
// Rien n'est écrit sur disque depuis cette vue sans un clic accept explicite,
// fichier par fichier (agentDecide côté main).
const taskInput = document.getElementById("agent-task") as HTMLTextAreaElement;
const dirInput = document.getElementById("agent-dir") as HTMLInputElement;
// Opt-in par run, JAMAIS persistée : décochée à chaque ouverture du panneau.
const allowInput = document.getElementById(
  "agent-allow-run",
) as HTMLInputElement;
const runBtn = document.getElementById("agent-run") as HTMLButtonElement;
const formError = document.getElementById("agent-form-error")!;
const agentListEl = document.getElementById("agent-list")!;
const agentsEmptyEl = document.getElementById("agents-empty")!;
const agentsMainEl = document.getElementById("agents-main")!;
const reviewEl = document.getElementById("agent-review")!;
const reviewTaskEl = document.getElementById("review-task")!;
const reviewStatusEl = document.getElementById("review-status")!;
const reviewCommandsEl = document.getElementById("review-commands")!;
const reviewLiveEl = document.getElementById("review-live")!;
const reviewFilesEl = document.getElementById("review-files")!;

dirInput.value = localStorage.getItem("sf-agent-dir") ?? "";

let agentRuns: AgentRunSummary[] = [];
let reviewedId: string | null = null;
/** Le run affiché est-il encore actif (auto-scroll collant pertinent) ? */
let reviewedActive = false;
/** Réponse modèle en cours d'écriture (tokens streamés du tour courant). */
let livePartial = "";

const STATUS_BADGE: Record<AgentStatus, [string, string]> = {
  queued: ["off", "[..] queued"],
  running: ["off", "[..] running"],
  "awaiting-command": ["warn", "[!!] approve"],
  "awaiting-review": ["warn", "[!!] review"],
  done: ["ok", "[ok] done"],
  failed: ["warn", "[--] failed"],
};

const ACTIVE_STATUSES: AgentStatus[] = [
  "queued",
  "running",
  "awaiting-command",
];

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
    if (ACTIVE_STATUSES.includes(run.status)) {
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
  if (reviewedId !== id) livePartial = "";
  reviewedId = id;
  stickBottom = true;
  renderReview(run);
  agentsMainEl.hidden = true;
  reviewEl.hidden = false;
}

function closeReview(): void {
  reviewedId = null;
  livePartial = "";
  reviewEl.hidden = true;
  agentsMainEl.hidden = false;
}

const STATUS_TEXT: Record<AgentStatus, string> = {
  queued: "queued…",
  running: "running — live transcript below.",
  "awaiting-command":
    "a command is waiting for you — nothing runs without your click.",
  "awaiting-review": "review each file — nothing is written until you accept.",
  done: "finished.",
  failed: "failed.",
};

// ---- Auto-scroll collant de la vue « en cours » --------------------------
// L'onglet agents (#view-agents) est le conteneur qui défile : on suit le
// flux tant que l'utilisateur est en bas ; s'il remonte, on ne le tire plus.
let stickBottom = true;
viewAgents.addEventListener("scroll", () => {
  stickBottom =
    viewAgents.scrollTop + viewAgents.clientHeight >=
    viewAgents.scrollHeight - 24;
});
function stickScroll(): void {
  if (!reviewedId || !reviewedActive || !stickBottom) return;
  viewAgents.scrollTop = viewAgents.scrollHeight;
}

/** Nettoie une sortie de commande pour le pseudo-terminal (pas de PTY :
 *  séquences ANSI retirées, \r isolés normalisés en sauts de ligne). */
function cleanTerminalText(text: string): string {
  return text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "") // séquences CSI
    .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)?/g, "") // OSC (titres…)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function termScrollToEnd(pre: HTMLElement): void {
  pre.scrollTop = pre.scrollHeight;
}

const CMD_STATE_TEXT = {
  pending: "waiting for you",
  denied: "denied",
  refused: "blocked",
  running: "running…",
  done: "done",
  error: "error",
} as const;

/** Commandes proposées : chacune attend un clic explicite avant de tourner ;
 *  les refus (liste noire ou utilisateur) restent visibles, jamais muets. */
function renderCommands(run: AgentRun): void {
  reviewCommandsEl.textContent = "";
  for (const cmd of run.commands) {
    const box = document.createElement("div");
    box.className = "cmd-box";
    const head = document.createElement("div");
    head.className = "cmd-head";
    const line = document.createElement("span");
    line.className = "cmd-line";
    line.textContent = `$ ${cmd.command}`;
    line.title = cmd.command;
    head.append(line);
    if (cmd.status === "pending" && run.status === "awaiting-command") {
      const actions = document.createElement("div");
      actions.className = "review-actions";
      const approve = document.createElement("button");
      approve.type = "button";
      approve.className = "btn-accept";
      approve.textContent = "run it";
      approve.addEventListener("click", () =>
        decideCommand(run.id, cmd.id, "approved"),
      );
      const deny = document.createElement("button");
      deny.type = "button";
      deny.className = "btn-deny";
      deny.textContent = "deny";
      deny.addEventListener("click", () =>
        decideCommand(run.id, cmd.id, "denied"),
      );
      actions.append(approve, deny);
      head.append(actions);
    } else {
      const state = document.createElement("span");
      state.className = `cmd-state ${cmd.status}`;
      state.textContent =
        cmd.status === "done" && cmd.exitCode !== undefined
          ? `exit ${cmd.exitCode ?? "?"}`
          : CMD_STATE_TEXT[cmd.status];
      if (cmd.note) {
        state.textContent += ` — ${cmd.note}`;
        state.title = cmd.note;
      }
      head.append(state);
    }
    box.append(head);
    if (cmd.output || cmd.status === "running") {
      const pre = document.createElement("pre");
      pre.className = "term";
      pre.dataset["cmd"] = String(cmd.id);
      pre.textContent = cleanTerminalText(cmd.output);
      box.append(pre);
      termScrollToEnd(pre);
    }
    reviewCommandsEl.append(box);
  }
}

const LIVE_USER_MAX = 280;
const LIVE_MODEL_MAX = 1500;

/** Transcript live pendant le run : chaque tour, lecture et réponse du
 *  modèle au fil de l'eau — plus jamais un spinner muet pendant 8 tours. */
function renderLive(run: AgentRun): void {
  reviewLiveEl.textContent = "";
  if (!ACTIVE_STATUSES.includes(run.status)) return;
  for (const entry of run.transcript) {
    if (entry.role === "system") continue;
    const div = document.createElement("div");
    div.className = `tr-entry ${entry.role}`;
    const role = document.createElement("span");
    role.className = "tr-role";
    role.textContent = entry.role === "assistant" ? "model" : "context";
    const text = document.createElement("div");
    text.className = "tr-text";
    const max = entry.role === "assistant" ? LIVE_MODEL_MAX : LIVE_USER_MAX;
    text.textContent =
      entry.content.length > max
        ? `${entry.content.slice(0, max)}\n[…]`
        : entry.content;
    div.append(role, text);
    reviewLiveEl.append(div);
  }
  // Réponse en cours d'écriture (tokens streamés) — remplie par les
  // événements model-token, vidée quand la réponse complète est au transcript.
  const partial = document.createElement("div");
  partial.className = "tr-entry assistant streaming";
  partial.id = "live-partial";
  partial.hidden = livePartial.length === 0;
  const role = document.createElement("span");
  role.className = "tr-role";
  role.textContent = "model";
  const text = document.createElement("div");
  text.className = "tr-text";
  text.id = "live-partial-text";
  text.textContent =
    livePartial.length > LIVE_MODEL_MAX
      ? `[…]\n${livePartial.slice(-LIVE_MODEL_MAX)}`
      : livePartial;
  partial.append(role, text);
  reviewLiveEl.append(partial);
}

function renderReview(run: AgentRun): void {
  reviewedActive = ACTIVE_STATUSES.includes(run.status);
  reviewTaskEl.textContent = run.task;
  reviewStatusEl.textContent = run.error
    ? `${STATUS_TEXT[run.status]} ${run.error}`
    : STATUS_TEXT[run.status];
  renderCommands(run);
  renderLive(run);
  reviewFilesEl.textContent = "";
  if (run.proposal.length === 0) {
    if (!reviewedActive) {
      const last = [...run.transcript]
        .reverse()
        .find((t) => t.role === "assistant");
      const p = document.createElement("p");
      p.className = "agents-empty";
      p.textContent = last?.content ?? "no proposal.";
      reviewFilesEl.append(p);
    }
    stickScroll();
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

/** Clic exécuter/refuser sur une commande : le runner reprend la main et
 *  rediffuse l'état (onAgentsChanged) — pas de re-render optimiste ici. */
function decideCommand(
  id: string,
  commandId: number,
  decision: AgentCommandDecision,
): void {
  void window.sunflower.agentCommand(id, commandId, decision);
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
    .agentStart(task, dir, allowInput.checked)
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

// Événements fins du run affiché : tokens du modèle au fil de l'eau et
// sortie de commande streamée — les autres kinds passent par onAgentsChanged
// (le runner fait un onUpdate à chaque étape), qui re-render la revue.
window.sunflower.onAgentEvent((ev: AgentEvent) => {
  if (ev.runId !== reviewedId) return;
  if (ev.kind === "model-token") {
    livePartial += ev.detail;
    const el = document.getElementById("live-partial");
    const text = document.getElementById("live-partial-text");
    if (el && text) {
      el.hidden = false;
      text.textContent =
        livePartial.length > LIVE_MODEL_MAX
          ? `[…]\n${livePartial.slice(-LIVE_MODEL_MAX)}`
          : livePartial;
    }
    stickScroll();
  } else if (
    ev.kind === "model-answer" ||
    ev.kind === "turn-start" ||
    ev.kind === "read" ||
    ev.kind === "proposal"
  ) {
    // La réponse complète (ou l'étape suivante) est au transcript : le
    // prochain renderReview la montre, le partiel repart de zéro.
    livePartial = "";
  } else if (ev.kind === "command-output" && ev.commandId !== undefined) {
    const pre = reviewCommandsEl.querySelector<HTMLElement>(
      `pre.term[data-cmd="${ev.commandId}"]`,
    );
    if (pre) {
      pre.textContent += cleanTerminalText(ev.detail);
      termScrollToEnd(pre);
      stickScroll();
    }
  }
});
void window.sunflower.agentsList().then((runs) => {
  agentRuns = runs;
  renderAgentList();
});

window.sunflower.onPanelData(render);
void window.sunflower.getStatus().then(render);
