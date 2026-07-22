// Agent orb: mini sunflower badge docked to the right edge, shown while a
// background coding agent runs. Hover expands a status pill; a vertical drag
// repositions it; a plain click opens the panel on the agents tab.
import { ensureBridge } from "../shared/dev-stub";
import { POSES, pixelArtSvg } from "../../shared/sunflower-pixels";
import type {
  AgentEvent,
  AgentRunSummary,
  AgentStatus,
} from "../../shared/agents";

ensureBridge();

const dock = document.getElementById("dock")!;
const orb = document.getElementById("orb")!;
const orbIcon = document.getElementById("orb-icon")!;
const pillTitle = document.getElementById("pill-title")!;
const pillState = document.getElementById("pill-state")!;

// Petite fleur pixel au centre du disque (8×9 → ~24×27).
orbIcon.innerHTML = pixelArtSvg(POSES.idle, 24, 27);

// Mot d'état de repli, quand aucun événement fin n'est encore arrivé.
const STATE_WORD: Record<AgentStatus, string> = {
  queued: "queued",
  running: "coding…",
  "awaiting-command": "command waiting for you",
  "awaiting-review": "review ready",
  done: "done",
  failed: "failed",
};

const ACTIVE: AgentStatus[] = ["queued", "running", "awaiting-command"];

/** Texte dérivé du dernier événement du run en cours (« turn 3/8 · reading
 *  src/foo.ts ») ; null tant qu'aucun événement n'est arrivé. */
let eventText: string | null = null;
let eventRunId: string | null = null;
/** Activité réelle en cours (appel modèle en vol / commande qui tourne) —
 *  l'animation ne tourne QUE là, pas du début à la fin du run. */
let working = false;
let currentRuns: AgentRunSummary[] = [];

const shorten = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

function renderStatus(runs: AgentRunSummary[]): void {
  currentRuns = runs;
  const active = runs.filter((r) => ACTIVE.includes(r.status));
  dock.classList.toggle("active", active.length > 0);
  // Priorité à l'agent en cours ; sinon file d'attente ; sinon le plus récent.
  const current =
    runs.find(
      (r) => r.status === "running" || r.status === "awaiting-command",
    ) ??
    active[0] ??
    runs[0];
  if (!current) {
    pillTitle.textContent = "background agent";
    pillState.textContent = "idle";
    orb.title = "background agent";
    dock.classList.remove("working");
    return;
  }
  if (!ACTIVE.includes(current.status) || eventRunId !== current.id) {
    // Pas (ou plus) d'événement pour ce run : retomber sur le mot d'état.
    eventText = null;
    working = false;
  }
  const word = eventText ?? STATE_WORD[current.status];
  const queued = active.filter((r) => r.status === "queued").length;
  pillTitle.textContent = current.task;
  pillState.textContent =
    queued > 0 && current.status === "running"
      ? `${word} · ${queued} queued`
      : word;
  orb.title = `${current.task} — ${word}`;
  dock.classList.toggle("working", working && ACTIVE.includes(current.status));
}

// Kinds qui témoignent d'une activité réelle (l'animation tourne) ; tout le
// reste est une attente (file, clic humain, revue) : animation au repos.
const WORKING_KINDS = new Set<AgentEvent["kind"]>([
  "turn-start",
  "model-token",
  "model-answer",
  "read",
  "command-start",
  "command-output",
]);

function eventLabel(ev: AgentEvent): string | null {
  const t = `turn ${ev.turn}/${ev.maxTurns}`;
  switch (ev.kind) {
    case "turn-start":
      return `${t} · thinking…`;
    case "model-token":
      return `${t} · writing…`;
    case "model-answer":
      return `${t} · reading the answer…`;
    case "read":
      return `${t} · read ${shorten(ev.detail, 26)}`;
    case "proposal":
      return `proposal ready — ${ev.detail} file(s)`;
    case "command-request":
      return `approve? ${shorten(ev.detail, 28)}`;
    case "command-refused":
      return `blocked: ${shorten(ev.detail, 28)}`;
    case "command-denied":
      return `denied: ${shorten(ev.detail, 28)}`;
    case "command-start":
    case "command-output":
      return `running: ${shorten(ev.detail, 26)}…`;
    case "command-end":
      return shorten(ev.detail, 36);
    case "status":
      return STATE_WORD[ev.detail as AgentStatus] ?? null;
  }
}

window.sunflower.onAgentEvent((ev: AgentEvent) => {
  eventRunId = ev.runId;
  working = WORKING_KINDS.has(ev.kind);
  if (ev.kind === "command-output") {
    // La sortie brute n'est pas un état : garder le « running: … » affiché.
    renderStatus(currentRuns);
    return;
  }
  const label = eventLabel(ev);
  if (label) eventText = label;
  renderStatus(currentRuns);
});

// ---- Survol : demande à main d'élargir la fenêtre pour la pastille --------
let dragging = false;

orb.addEventListener("mouseenter", () => {
  dock.classList.add("expanded");
  window.sunflower.agentOrbHoverStart();
});
orb.addEventListener("mouseleave", () => {
  if (dragging) return; // garder la pastille pendant un glisser
  dock.classList.remove("expanded");
  window.sunflower.agentOrbHoverEnd();
});

// ---- Glisser vertical (reposition) vs clic (ouvre le panneau) -------------
const DRAG_THRESHOLD = 3;
let moved = false;
let startY = 0;

orb.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  dragging = true;
  moved = false;
  startY = e.screenY;
  window.sunflower.agentOrbDragStart(e.screenY);
  e.preventDefault();
});
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  if (Math.abs(e.screenY - startY) > DRAG_THRESHOLD) moved = true;
  window.sunflower.agentOrbDragMove(e.screenY);
});
window.addEventListener("mouseup", (e) => {
  if (!dragging) return;
  dragging = false;
  window.sunflower.agentOrbDragEnd(e.screenY);
  if (!moved) {
    // Clic franc : ouvrir le panneau sur l'onglet agents.
    void window.sunflower.agentOrbOpen();
  } else if (!orb.matches(":hover")) {
    // Relâché hors du disque : replier.
    dock.classList.remove("expanded");
    window.sunflower.agentOrbHoverEnd();
  }
});

window.sunflower.onAgentsChanged(renderStatus);

// La fenêtre est ré-affichée repliée par main (show/hide) : abandonner tout
// état de survol/glisser d'une vie antérieure pour rester synchrone.
window.sunflower.onAgentOrbReset(() => {
  dragging = false;
  moved = false;
  dock.classList.remove("expanded");
});
