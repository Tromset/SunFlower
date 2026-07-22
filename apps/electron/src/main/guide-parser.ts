// Extraction en flux des marqueurs [POINT:x%,y%], [STEP:…], [DONE] et
// [WORK:…] : le texte affiché/prononcé ne contient jamais de marqueur, même
// coupé entre deux chunks. Avant tout STEP, comportement historique (intro
// streamée + POINT unique) ; dès le premier STEP, le texte alimente le plan
// du guide. [WORK: tâche] signale une corvée que Sunflower Work peut piloter
// (voir work/runner.ts) — capturé une seule fois, jamais affiché.
export interface PointEvent {
  xPct: number;
  yPct: number;
}

export type StepAdvance = "proximity" | "click";

export interface GuideStep {
  xPct?: number;
  yPct?: number;
  advance: StepAdvance;
  text: string;
}

export interface ParsedGuide {
  steps: GuideStep[];
  outro?: string;
}

const POINT =
  /\[POINT:\s*(\d+(?:\.\d+)?)\s*%?\s*,\s*(\d+(?:\.\d+)?)\s*%?\s*\]/i;
const STEP =
  /\[STEP(?::\s*(\d+(?:\.\d+)?)\s*%?\s*,\s*(\d+(?:\.\d+)?)\s*%?)?(?:\s*:\s*(click))?\s*\]/i;
const DONE = /\[DONE\]/i;
const WORK = /\[WORK:\s*([^\]\n]+?)\s*\]/i;
/** Amorces possibles d'un marqueur coupé en fin de chunk (comparées en MAJ). */
const STARTS = ["[POINT:", "[STEP", "[DONE]", "[WORK:"];

/** Étapes max d'un guide — le prompt en demande 6, on tolère un peu plus. */
const MAX_STEPS = 8;
/** Longueur max d'une instruction parlée (coupe au mot). */
const MAX_STEP_CHARS = 140;

const clampPct = (raw: string): number =>
  Math.min(100, Math.max(0, Number(raw)));

/** Nettoie une instruction : retours ligne, ornements de liste, longueur. */
function cleanInstruction(raw: string): string {
  let text = raw
    .replace(/\s+/g, " ")
    .replace(/^\s*(?:\d+[.)]\s*|[-*•]\s*|step\s+\d+\s*:?\s*)/i, "")
    .trim();
  if (text.length > MAX_STEP_CHARS) {
    const cut = text.lastIndexOf(" ", MAX_STEP_CHARS);
    text = text.slice(0, cut > 0 ? cut : MAX_STEP_CHARS).trim();
  }
  return text;
}

/** Longueur max d'une tâche Sunflower Work (défensif). */
const MAX_WORK_CHARS = 200;

export interface AnswerParser {
  push(chunk: string): void;
  flush(): void;
  /** Plan du guide — null avant flush() ou sans étape valide. */
  guide(): ParsedGuide | null;
  /** Tâche Sunflower Work — null avant flush() ou sans marqueur [WORK:…]. */
  work(): string | null;
}

export function createAnswerParser(handlers: {
  onText(text: string): void;
  onPoint(point: PointEvent): void;
}): AnswerParser {
  let buffer = "";
  let pointFired = false;
  let mode: "intro" | "steps" | "outro" = "intro";
  let flushed = false;
  const steps: GuideStep[] = [];
  let stepText = "";
  let outro = "";
  /** Tâche [WORK:…] capturée (première occurrence seulement). */
  let workTask: string | null = null;
  /** Texte brut du plan (marqueurs inclus) pour la dégradation en réponse. */
  let planRaw = "";

  const emitText = (text: string) => {
    if (text.length === 0) return;
    if (mode === "intro") handlers.onText(text);
    else if (mode === "steps") {
      stepText += text;
      planRaw += text;
    } else outro += text;
  };

  const emitUpTo = (end: number) => {
    emitText(buffer.slice(0, end));
    buffer = buffer.slice(end);
  };

  const closeStep = () => {
    if (mode !== "steps") return;
    const last = steps[steps.length - 1];
    if (last) last.text = cleanInstruction(stepText);
    stepText = "";
  };

  const process = (final: boolean) => {
    for (;;) {
      const point = POINT.exec(buffer);
      const step = STEP.exec(buffer);
      const done = DONE.exec(buffer);
      const work = WORK.exec(buffer);
      const matches = [point, step, done, work].filter(
        (m): m is RegExpExecArray => m !== null,
      );
      if (matches.length === 0) break;
      const first = matches.reduce((a, b) => (b.index < a.index ? b : a));
      emitUpTo(first.index);
      buffer = buffer.slice(first[0].length);
      if (first === point) {
        // Legacy : un seul POINT, uniquement hors plan (ignoré sinon).
        if (mode === "intro" && !pointFired) {
          pointFired = true;
          handlers.onPoint({
            xPct: clampPct(first[1] as string),
            yPct: clampPct(first[2] as string),
          });
        } else if (mode === "steps") {
          planRaw += first[0];
        }
      } else if (first === step) {
        closeStep();
        mode = "steps";
        planRaw += first[0];
        const hasCoords = first[1] !== undefined && first[2] !== undefined;
        const next: GuideStep = {
          advance: !hasCoords || first[3] !== undefined ? "click" : "proximity",
          text: "",
        };
        if (hasCoords) {
          next.xPct = clampPct(first[1] as string);
          next.yPct = clampPct(first[2] as string);
        }
        steps.push(next);
      } else if (first === work) {
        // [WORK: tâche] : capturé une seule fois, jamais affiché ni prononcé.
        if (workTask === null) {
          const task = (first[1] ?? "").trim();
          if (task) workTask = task.slice(0, MAX_WORK_CHARS);
        }
      } else if (mode === "steps") {
        closeStep();
        planRaw += first[0];
        mode = "outro";
      }
      // [DONE] hors plan : simplement retiré du texte.
    }
    if (final) {
      emitUpTo(buffer.length);
      return;
    }
    // Retenir une éventuelle amorce de marqueur en fin de buffer.
    const open = buffer.lastIndexOf("[");
    if (open === -1) {
      emitUpTo(buffer.length);
      return;
    }
    const tail = buffer.slice(open).toUpperCase();
    const maybeMarker =
      !tail.includes("]") &&
      STARTS.some((s) => s.startsWith(tail) || tail.startsWith(s));
    emitUpTo(maybeMarker ? open : buffer.length);
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      process(false);
    },
    flush() {
      process(true);
      closeStep();
      flushed = true;
      const sawSteps = steps.length > 0;
      const valid = steps.filter((s) => s.text.length > 0).slice(0, MAX_STEPS);
      steps.length = 0;
      steps.push(...valid);
      // Des marqueurs mais aucune étape exploitable : le texte du plan
      // (et l'éventuelle clôture) redevient une réponse ordinaire plutôt
      // que d'être perdu.
      if (sawSteps && valid.length === 0) {
        handlers.onText(stripMarkers(`${planRaw} ${outro}`));
      }
    },
    guide() {
      if (!flushed || steps.length === 0) return null;
      const trimmedOutro = cleanInstruction(outro);
      const result: ParsedGuide = { steps };
      if (trimmedOutro) result.outro = trimmedOutro;
      return result;
    },
    work() {
      return flushed ? workTask : null;
    },
  };
}

/** Retire tout marqueur résiduel d'un texte complet (défensif). */
export function stripMarkers(text: string): string {
  return text
    .replace(new RegExp(POINT.source, "gi"), "")
    .replace(new RegExp(STEP.source, "gi"), "")
    .replace(new RegExp(DONE.source, "gi"), "")
    .replace(new RegExp(WORK.source, "gi"), "")
    .trim();
}
