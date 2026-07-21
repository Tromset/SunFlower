// Exécution déterministe d'un guide : aucun appel IA entre les étapes.
// La progression vient de la géométrie (souris proche de la cible) ou d'un
// clic global ; tout le reste est du minutage. Deps injectées (style
// createSessionMachine) : testable sans Electron.
import type { Display } from "electron";
import type { GuideStep, ParsedGuide } from "./guide-parser";

/** Rayon d'arrivée : absorbe l'imprécision du modèle vision (±1-2 %). */
const PROX_RADIUS_PX = 60;
/** Séjour continu dans le rayon avant d'avancer (pas de passage en coup de vent). */
const DWELL_MS = 250;
/** Proximité ignorée juste après l'annonce : le curseur peut déjà être sur
 *  la cible, sans quoi les étapes défileraient en cascade. */
const ARM_PROX_MS = 600;
/** Clics ignorés juste après l'annonce d'une étape. */
const ARM_CLICK_MS = 1000;
/** Un clic près de la cible PRÉCÉDENTE dans cette fenêtre = l'utilisateur
 *  termine l'action d'avant, pas celle de l'étape courante. */
const PREV_TARGET_GRACE_MS = 2500;
/** Cadence du poll de proximité (getCursorScreenPoint est bon marché). */
const POLL_MS = 50;
/** Sans progression pendant ce délai, le guide s'éteint sans bruit. */
const GUIDE_IDLE_MS = 150_000;
/** Sans hook souris ni cible (question tapée sans Accessibilité) : avance
 *  temporisée pour ne pas bloquer le guide. */
const NO_HOOK_ADVANCE_MS = 6000;
/** Garde défensive — le parseur plafonne déjà. */
const MAX_STEPS = 8;

export interface GuideRunnerDeps {
  cursor(): { x: number; y: number };
  showPoint(xPct: number, yPct: number, bounds: Electron.Rectangle): void;
  hidePoint(): void;
  flyTo(target: { x: number; y: number }): void;
  hold(): void;
  follow(): void;
  onMouseDown(cb: () => void): () => void;
  clicksAvailable(): boolean;
}

export type GuideEndReason = "completed" | "timeout";

export interface GuideCallbacks {
  onStep(index: number, total: number, step: GuideStep, cut: boolean): void;
  onEnd(reason: GuideEndReason): void;
}

export interface GuideRunner {
  /** Lance un guide (annule l'éventuel guide en cours). */
  start(guide: ParsedGuide, display: Display, cb: GuideCallbacks): void;
  /** Idempotent ; pas de onEnd (l'annuleur possède déjà la transition). */
  cancel(): void;
  active(): boolean;
}

interface Target {
  x: number;
  y: number;
  xPct: number;
  yPct: number;
}

export function createGuideRunner(deps: GuideRunnerDeps): GuideRunner {
  let gen = 0;
  let running = false;
  let pollTimer: NodeJS.Timeout | null = null;
  let stepTimer: NodeJS.Timeout | null = null;
  let idleTimer: NodeJS.Timeout | null = null;
  let unsubClick: (() => void) | null = null;

  const clearStepArms = () => {
    if (pollTimer) clearInterval(pollTimer);
    if (stepTimer) clearTimeout(stepTimer);
    pollTimer = stepTimer = null;
    unsubClick?.();
    unsubClick = null;
  };

  /** Arrêt complet : nettoyage + retour du tournesol au curseur. */
  const stop = () => {
    clearStepArms();
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (!running) return;
    running = false;
    deps.hidePoint();
    deps.follow();
  };

  return {
    start(guide, display, cb) {
      gen++;
      stop();
      const id = gen;
      running = true;
      const steps = guide.steps.slice(0, MAX_STEPS);
      const bounds = display.bounds;
      let index = 0;
      let prevTarget: Target | null = null;
      let prevAdvancedAt = 0;

      const targetOf = (step: GuideStep): Target | null =>
        step.xPct === undefined || step.yPct === undefined
          ? null
          : {
              x: bounds.x + (step.xPct / 100) * bounds.width,
              y: bounds.y + (step.yPct / 100) * bounds.height,
              xPct: step.xPct,
              yPct: step.yPct,
            };

      const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (id !== gen || !running) return;
          stop();
          cb.onEnd("timeout");
        }, GUIDE_IDLE_MS);
      };

      const advance = () => {
        if (id !== gen || !running) return;
        const done = steps[index];
        prevTarget = done ? targetOf(done) : null;
        prevAdvancedAt = Date.now();
        clearStepArms();
        index++;
        if (index >= steps.length) {
          stop();
          cb.onEnd("completed");
          return;
        }
        enterStep(index, true);
      };

      const enterStep = (i: number, cut: boolean) => {
        const step = steps[i];
        if (!step) return;
        const target = targetOf(step);
        const announcedAt = Date.now();
        armIdle();
        if (target) {
          deps.showPoint(target.xPct, target.yPct, bounds);
          deps.flyTo(target);
        } else {
          deps.hidePoint();
          deps.hold();
        }
        cb.onStep(i + 1, steps.length, step, cut);
        if (step.advance === "click" && deps.clicksAvailable()) {
          unsubClick = deps.onMouseDown(() => {
            if (id !== gen || !running) return;
            if (Date.now() - announcedAt < ARM_CLICK_MS) return;
            if (prevTarget && Date.now() - prevAdvancedAt < PREV_TARGET_GRACE_MS) {
              const p = deps.cursor();
              const d = Math.hypot(p.x - prevTarget.x, p.y - prevTarget.y);
              if (d <= PROX_RADIUS_PX) return;
            }
            advance();
          });
        } else if (target) {
          // Proximité — aussi le repli des étapes click sans hook souris.
          let withinSince = 0;
          pollTimer = setInterval(() => {
            if (id !== gen || !running) return;
            if (Date.now() - announcedAt < ARM_PROX_MS) return;
            const p = deps.cursor();
            const near =
              Math.hypot(p.x - target.x, p.y - target.y) <= PROX_RADIUS_PX;
            if (!near) {
              withinSince = 0;
              return;
            }
            if (withinSince === 0) {
              withinSince = Date.now();
              return;
            }
            if (Date.now() - withinSince >= DWELL_MS) advance();
          }, POLL_MS);
        } else {
          stepTimer = setTimeout(() => {
            if (id === gen && running) advance();
          }, NO_HOOK_ADVANCE_MS);
        }
      };

      if (steps.length === 0) {
        stop();
        cb.onEnd("completed");
        return;
      }
      enterStep(0, false);
    },
    cancel() {
      gen++;
      stop();
    },
    active() {
      return running;
    },
  };
}
