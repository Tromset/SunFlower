// Extraction en flux des marqueurs [POINT:…], [STEP:…], [DONE] et
// [WORK:…] : le texte affiché/prononcé ne contient jamais de marqueur, même
// coupé entre deux chunks. Avant tout STEP, comportement historique (intro
// streamée + POINT unique) ; dès le premier STEP, le texte alimente le plan
// du guide. [WORK: tâche] signale une corvée que Sunflower Work peut piloter
// (voir work/runner.ts) — capturé une seule fois, jamais affiché.
//
// Coordonnées : le prompt demande une boîte englobante [POINT:x1,y1,x2,y2]
// en 0–1000 (grounding natif de qwen3-vl), mais le parseur tolère aussi le
// centre seul à 2 nombres (legacy), les pourcentages (suffixe %), les
// fractions 0–1 et les pixels de l'image envoyée — voir normalizeMarker.
export interface PointEvent {
  xPct: number;
  yPct: number;
  /** Taille de l'élément visé (% écran) — absente : cadre par défaut. */
  wPct?: number;
  hPct?: number;
}

export type StepAdvance = "proximity" | "click";

export interface GuideStep {
  xPct?: number;
  yPct?: number;
  /** Taille de l'élément visé (% écran), quand le modèle a donné une boîte. */
  wPct?: number;
  hPct?: number;
  advance: StepAdvance;
  text: string;
}

export interface ParsedGuide {
  steps: GuideStep[];
  outro?: string;
}

/** Un nombre, suffixe % optionnel. */
const NUM = String.raw`\d+(?:\.\d+)?\s*%?`;
/** Liste de 2 à 4 nombres, capturée en UN groupe (splittée en code : les
 *  groupes positionnels rendraient le dispatch fragile). Répétition bornée
 *  {1,3} ancrée par virgules : pas de backtracking pathologique. */
const NUM_LIST = String.raw`(${NUM}(?:\s*,\s*${NUM}){1,3})`;
const POINT = new RegExp(String.raw`\[POINT:\s*${NUM_LIST}\s*\]`, "i");
const STEP = new RegExp(
  String.raw`\[STEP(?::\s*${NUM_LIST})?(?:\s*:\s*(click))?\s*\]`,
  "i",
);
const DONE = /\[DONE\]/i;
const WORK = /\[WORK:\s*([^\]\n]+?)\s*\]/i;
/** Marqueur POINT/STEP malformé ([POINT:abc]…) : absorbé en flux, jamais
 *  affiché ni prononcé. Les regex spécifiques gagnent à indice égal (ordre
 *  du tableau dans process). */
const GARBAGE = /\[(?:POINT|STEP)[^\]\n]*\]/i;
/** Amorces possibles d'un marqueur coupé en fin de chunk (comparées en MAJ). */
const STARTS = ["[POINT:", "[STEP", "[DONE]", "[WORK:"];

/** Étapes max d'un guide — le prompt en demande 6, on tolère un peu plus. */
const MAX_STEPS = 8;
/** Longueur max d'une instruction parlée (coupe au mot). */
const MAX_STEP_CHARS = 140;

/** Boîte couvrant au moins ce % des DEUX dimensions : le modèle encadre
 *  « tout l'écran » au lieu d'un élément — bruit, pas une cible. (Une barre
 *  d'outils pleine largeur mais peu haute reste légitime.) */
const WHOLE_SCREEN_PCT = 85;
/** Sous ce seuil (une des dimensions), la boîte est un point déguisé :
 *  centre gardé, taille jetée (cadre par défaut). */
const DEGENERATE_PCT = 0.4;

export interface NormalizedMarker {
  xPct: number;
  yPct: number;
  wPct?: number;
  hPct?: number;
  /** Boîte « plein écran » : à ignorer (POINT) ou dégrader (STEP). */
  wholeScreen: boolean;
}

/** Premier marqueur [POINT:…] d'un texte COMPLET, normalisé relativement à
 *  `image`. Second passage du point-verifier : la réponse attendue est un
 *  marqueur seul, pas un flux — le parseur incrémental serait surdimensionné. */
export function parsePointMarker(
  text: string,
  image: { width: number; height: number } | undefined,
  dbg?: (line: string) => void,
): NormalizedMarker | null {
  const m = POINT.exec(text);
  if (!m) return null;
  return normalizeMarker(m[1] as string, image, dbg);
}

/** Convertit la liste de nombres d'un marqueur en centre (+ taille) en % de
 *  l'écran. Tolérant aux conventions des différents modèles vision :
 *  % explicite → pourcents ; tout ≤ 1 → fractions 0–1 ; tout ≤ 1000 →
 *  0–1000 (grounding natif qwen) ; au-delà → pixels de l'image envoyée.
 *  Retourne null si inexploitable (rien ne doit alors s'afficher). */
function normalizeMarker(
  list: string,
  image: { width: number; height: number } | undefined,
  dbg?: (line: string) => void,
): NormalizedMarker | null {
  const parts = list.split(",").map((p) => p.trim());
  const hasPercent = parts.some((p) => p.endsWith("%"));
  const values = parts.map((p) => Number(p.replace(/\s*%$/, "")));
  if (values.length < 2 || values.some((v) => !Number.isFinite(v))) {
    dbg?.(`marqueur inexploitable: ${list}`);
    return null;
  }
  let branch: string;
  let toPct: (v: number, axis: "x" | "y") => number;
  if (hasPercent) {
    branch = "pourcents";
    toPct = (v) => v;
  } else if (values.every((v) => v <= 1)) {
    branch = "fractions 0-1";
    toPct = (v) => v * 100;
  } else if (values.every((v) => v <= 1000)) {
    branch = "0-1000";
    toPct = (v) => v / 10;
  } else if (image) {
    branch = "pixels image";
    toPct = (v, axis) =>
      (v / (axis === "x" ? image.width : image.height)) * 100;
  } else {
    dbg?.(`marqueur en pixels sans dimensions d'image: ${list}`);
    return null;
  }
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  // Indices pairs = x, impairs = y (x,y ou x1,y1,x2,y2).
  const pct = values.map((v, i) => clamp(toPct(v, i % 2 === 0 ? "x" : "y")));
  if (pct.length < 4) {
    if (pct.length === 3) dbg?.(`marqueur à 3 nombres, 3e ignoré: ${list}`);
    const out: NormalizedMarker = {
      xPct: pct[0] as number,
      yPct: pct[1] as number,
      wholeScreen: false,
    };
    dbg?.(`marqueur ${list} → ${branch}, centre ${out.xPct.toFixed(1)},${out.yPct.toFixed(1)}%`);
    return out;
  }
  // Boîte englobante : réordonner (le modèle peut inverser les coins).
  const x1 = Math.min(pct[0] as number, pct[2] as number);
  const x2 = Math.max(pct[0] as number, pct[2] as number);
  const y1 = Math.min(pct[1] as number, pct[3] as number);
  const y2 = Math.max(pct[1] as number, pct[3] as number);
  const wPct = x2 - x1;
  const hPct = y2 - y1;
  const out: NormalizedMarker = {
    xPct: (x1 + x2) / 2,
    yPct: (y1 + y2) / 2,
    wholeScreen: wPct >= WHOLE_SCREEN_PCT && hPct >= WHOLE_SCREEN_PCT,
  };
  if (!out.wholeScreen && wPct >= DEGENERATE_PCT && hPct >= DEGENERATE_PCT) {
    out.wPct = wPct;
    out.hPct = hPct;
  }
  dbg?.(
    `marqueur ${list} → ${branch}, boîte ${wPct.toFixed(1)}×${hPct.toFixed(1)}% @ ${out.xPct.toFixed(1)},${out.yPct.toFixed(1)}%${out.wholeScreen ? " (plein écran)" : ""}`,
  );
  return out;
}

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

export function createAnswerParser(
  handlers: {
    onText(text: string): void;
    onPoint(point: PointEvent): void;
  },
  opts?: {
    /** Dimensions de l'image envoyée au modèle (repli pixels absolus). */
    imageSize?: { width: number; height: number };
    /** Ligne de diagnostic (SUNFLOWER_DEBUG) — jamais montrée/parlée. */
    debug?: (line: string) => void;
  },
): AnswerParser {
  const dbg = opts?.debug;
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
      const garbage = GARBAGE.exec(buffer);
      const matches = [point, step, done, work, garbage].filter(
        (m): m is RegExpExecArray => m !== null,
      );
      if (matches.length === 0) break;
      const first = matches.reduce((a, b) => (b.index < a.index ? b : a));
      emitUpTo(first.index);
      buffer = buffer.slice(first[0].length);
      if (first === point) {
        // Un seul POINT, uniquement hors plan (ignoré sinon).
        if (mode === "intro" && !pointFired) {
          const n = normalizeMarker(first[1] as string, opts?.imageSize, dbg);
          if (n === null || n.wholeScreen) {
            // Marqueur inexploitable ou « plein écran » : rien n'est montré,
            // et un POINT valide ultérieur garde sa chance (pointFired non
            // consommé) — mieux qu'un cadre absurde au milieu de l'écran.
            dbg?.(`POINT ignoré: ${first[0]}`);
          } else {
            pointFired = true;
            const ev: PointEvent = { xPct: n.xPct, yPct: n.yPct };
            if (n.wPct !== undefined && n.hPct !== undefined) {
              ev.wPct = n.wPct;
              ev.hPct = n.hPct;
            }
            handlers.onPoint(ev);
          }
        } else if (mode === "steps") {
          planRaw += first[0];
        }
      } else if (first === step) {
        closeStep();
        mode = "steps";
        planRaw += first[0];
        const n =
          first[1] !== undefined
            ? normalizeMarker(first[1] as string, opts?.imageSize, dbg)
            : null;
        // Coordonnées inexploitables ou « plein écran » : étape dégradée en
        // avance au clic sans cible (chemin « pas de position » existant) —
        // surtout pas un repli au centre de l'écran.
        const hasCoords = n !== null && !n.wholeScreen;
        const next: GuideStep = {
          advance: !hasCoords || first[2] !== undefined ? "click" : "proximity",
          text: "",
        };
        if (hasCoords) {
          next.xPct = n.xPct;
          next.yPct = n.yPct;
          if (n.wPct !== undefined && n.hPct !== undefined) {
            next.wPct = n.wPct;
            next.hPct = n.hPct;
          }
        }
        steps.push(next);
      } else if (first === work) {
        // [WORK: tâche] : capturé une seule fois, jamais affiché ni prononcé.
        if (workTask === null) {
          const task = (first[1] ?? "").trim();
          if (task) workTask = task.slice(0, MAX_WORK_CHARS);
        }
      } else if (first === garbage) {
        // Marqueur malformé : retiré du flux (ni affiché ni prononcé).
        dbg?.(`marqueur malformé absorbé: ${first[0]}`);
        if (mode === "steps") planRaw += first[0];
      } else if (mode === "steps") {
        closeStep();
        planRaw += first[0];
        mode = "outro";
      }
      // [DONE] hors plan : simplement retiré du texte.
    }
    if (final) {
      // Amorce de marqueur jamais fermée (réponse tronquée par num_predict) :
      // jetée plutôt qu'affichée/prononcée.
      const open = buffer.lastIndexOf("[");
      if (open !== -1) {
        const tail = buffer.slice(open).toUpperCase();
        if (
          !tail.includes("]") &&
          STARTS.some((s) => s.startsWith(tail) || tail.startsWith(s))
        ) {
          dbg?.(`amorce tronquée jetée au flush: ${buffer.slice(open)}`);
          buffer = buffer.slice(0, open);
        }
      }
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
  return (
    text
      .replace(new RegExp(POINT.source, "gi"), "")
      .replace(new RegExp(STEP.source, "gi"), "")
      .replace(new RegExp(DONE.source, "gi"), "")
      .replace(new RegExp(WORK.source, "gi"), "")
      // Marqueur malformé ([POINT:abc]…) : jamais affiché ni prononcé.
      .replace(/\[(?:POINT|STEP)[^\]\n]*\]/gi, "")
      .trim()
  );
}
