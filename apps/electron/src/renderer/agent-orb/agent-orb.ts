// Agent orb: mini sunflower badge docked to the right edge, shown while a
// background coding agent runs. Hover expands a status pill; a vertical drag
// repositions it; a plain click opens the panel on the agents tab.
import { ensureBridge } from "../shared/dev-stub";
import { POSES, pixelArtSvg } from "../../shared/sunflower-pixels";
import type { AgentRunSummary, AgentStatus } from "../../shared/agents";

ensureBridge();

const dock = document.getElementById("dock")!;
const orb = document.getElementById("orb")!;
const orbIcon = document.getElementById("orb-icon")!;
const pillTitle = document.getElementById("pill-title")!;
const pillState = document.getElementById("pill-state")!;

// Petite fleur pixel au centre du disque (8×9 → ~24×27).
orbIcon.innerHTML = pixelArtSvg(POSES.idle, 24, 27);

const STATE_WORD: Record<AgentStatus, string> = {
  queued: "queued",
  running: "coding…",
  "awaiting-review": "review ready",
  done: "done",
  failed: "failed",
};

function renderStatus(runs: AgentRunSummary[]): void {
  const active = runs.filter(
    (r) => r.status === "running" || r.status === "queued",
  );
  dock.classList.toggle("active", active.length > 0);
  // Priorité à l'agent en cours ; sinon file d'attente ; sinon le plus récent.
  const current =
    runs.find((r) => r.status === "running") ?? active[0] ?? runs[0];
  if (!current) {
    pillTitle.textContent = "background agent";
    pillState.textContent = "idle";
    orb.title = "background agent";
    return;
  }
  const word = STATE_WORD[current.status];
  const queued = active.filter((r) => r.status === "queued").length;
  pillTitle.textContent = current.task;
  pillState.textContent =
    queued > 0 && current.status === "running"
      ? `${word} · ${queued} queued`
      : word;
  orb.title = `${current.task} — ${word}`;
}

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
