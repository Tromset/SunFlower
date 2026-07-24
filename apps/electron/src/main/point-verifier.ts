// Double vérification du pointage : le premier [POINT:…] du modèle n'est
// JAMAIS montré tel quel — c'est une simulation invisible. Avant affichage :
//   1) DOM — si l'app au premier plan expose son HTML (navigateur), le cadre
//      se cale sur la boîte exacte de l'élément (dom-locator) ;
//   2) sinon vision — on recadre un zoom autour de la cible annoncée et le
//      modèle corrige ses propres coordonnées sur ce crop.
// En cas de doute (délai, crop impossible, réponse sans marqueur), le point
// original part tel quel : la vérification améliore, ne bloque jamais.
// Deps injectées (style createSessionMachine) : testable sans Electron.
import type { ChatOptions } from "./ollama";
import {
  parsePointMarker,
  type GuideStep,
  type ParsedGuide,
  type PointEvent,
} from "./guide-parser";
import type { Screenshot } from "./screenshot";
import { snapToElement, type DomSnapshot } from "./dom-locator";

/** Budget du second passage vision. Le POINT arrive en fin de réponse : la
 *  requête de vérification ne fait au pire que la queue derrière les derniers
 *  tokens du flux principal — au-delà, le point original part tel quel. */
const VERIFY_TIMEOUT_MS = 20_000;
/** Le crop envoyé au second passage : boîte annoncée × ce facteur… */
const CROP_EXPAND = 3;
/** …au moins cette fraction de l'écran (assez de contexte pour reconnaître
 *  l'élément)… */
const CROP_MIN_FRAC = 0.2;
/** …au plus cette fraction (sinon le zoom n'apporte plus de précision). */
const CROP_MAX_FRAC = 0.55;
/** Taille supposée de l'élément quand le modèle n'a donné qu'un centre. */
const DEFAULT_BOX_W_PCT = 10;
const DEFAULT_BOX_H_PCT = 6;
/** Réponse attendue : un marqueur seul — plafond de génération serré. */
const VERIFY_NUM_PREDICT = 60;

const VERIFY_SYSTEM_PROMPT = [
  "You are double-checking a screen annotation before it is shown to the user.",
  "The attached image is a zoomed-in CROP of a screenshot. An assistant answered the user's question and pointed at one UI element; that element should be near the centre of this crop.",
  "Reply with EXACTLY one marker and nothing else.",
  "[POINT:x1,y1,x2,y2] — the tight bounding box of that element in THIS image, four integers from 0 to 1000, where 0,0 is the top-left corner and 1000,1000 the bottom-right.",
  "If the element is not visible in this image, reply exactly [MISS].",
].join(" ");

const MISS = /\[MISS\]/i;

export interface CroppedImage {
  b64: string;
  width: number;
  height: number;
}

export interface PointVerifierDeps {
  /** Second passage vision — null : indisponible (ex. SUNFLOWER_FAKE_ANSWER),
   *  la vérification se limite alors au DOM. */
  chat: ((opts: ChatOptions) => Promise<string>) | null;
  /** Instantané HTML de l'app au premier plan (dom-locator), null si absent. */
  readDom(): Promise<DomSnapshot | null>;
  /** Recadre l'image (base64) — null si le décodage/recadrage échoue. */
  crop(
    imageB64: string,
    rect: { x: number; y: number; width: number; height: number },
  ): CroppedImage | null;
  /** Ligne de diagnostic (SUNFLOWER_DEBUG) — jamais montrée/parlée. */
  debug?(line: string): void;
}

export interface PointVerifier {
  /** Point final à afficher : corrigé si possible, original sinon. */
  verifyPoint(
    point: PointEvent,
    shot: Screenshot,
    question: string,
    answer: string,
    signal: AbortSignal,
  ): Promise<PointEvent>;
  /** Cale les étapes visibles d'un guide sur le DOM (un seul instantané,
   *  aucun appel vision : l'exécution des guides reste déterministe). */
  refineGuide(guide: ParsedGuide, shot: Screenshot): Promise<ParsedGuide>;
}

/** Zone de zoom autour de la cible annoncée, bornée à l'image. */
function cropRect(
  point: PointEvent,
  image: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v));
  const cx = (point.xPct / 100) * image.width;
  const cy = (point.yPct / 100) * image.height;
  const boxW = ((point.wPct ?? DEFAULT_BOX_W_PCT) / 100) * image.width;
  const boxH = ((point.hPct ?? DEFAULT_BOX_H_PCT) / 100) * image.height;
  const w = Math.round(
    clamp(boxW * CROP_EXPAND, image.width * CROP_MIN_FRAC, image.width * CROP_MAX_FRAC),
  );
  const h = Math.round(
    clamp(boxH * CROP_EXPAND, image.height * CROP_MIN_FRAC, image.height * CROP_MAX_FRAC),
  );
  return {
    x: Math.round(clamp(cx - w / 2, 0, image.width - w)),
    y: Math.round(clamp(cy - h / 2, 0, image.height - h)),
    width: w,
    height: h,
  };
}

const fmtPt = (p: PointEvent) =>
  `${p.xPct.toFixed(1)},${p.yPct.toFixed(1)}%${
    p.wPct !== undefined && p.hPct !== undefined
      ? ` (${p.wPct.toFixed(1)}×${p.hPct.toFixed(1)}%)`
      : ""
  }`;

export function createPointVerifier(deps: PointVerifierDeps): PointVerifier {
  const dbg = deps.debug ?? (() => {});

  /** Second passage vision : zoom recadré → marqueur corrigé → coordonnées
   *  écran. Null : pas de correction exploitable (l'original garde la main). */
  const refineByVision = async (
    point: PointEvent,
    shot: Screenshot,
    question: string,
    answer: string,
    signal: AbortSignal,
  ): Promise<PointEvent | null> => {
    if (!deps.chat) return null;
    const rect = cropRect(point, shot.imageSize);
    const cropped = deps.crop(shot.imageB64, rect);
    if (!cropped) {
      dbg("vérification : recadrage impossible, point original conservé");
      return null;
    }
    // Timeout local + abandon de session : l'un ou l'autre annule l'appel.
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), VERIFY_TIMEOUT_MS);
    let full: string;
    try {
      full = await deps.chat({
        question: [
          `Original question: ${question}`,
          `Assistant answer: ${answer}`,
          "Give the corrected bounding box of the element the answer points at.",
        ].join("\n"),
        imageB64: cropped.b64,
        signal: ctrl.signal,
        onToken: () => {},
        system: VERIFY_SYSTEM_PROMPT,
        numPredict: VERIFY_NUM_PREDICT,
      });
    } catch {
      dbg("vérification : second passage en échec/expiré, point original conservé");
      return null;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
    if (MISS.test(full)) {
      dbg("vérification : [MISS] — l'élément n'est pas dans le zoom, point original conservé");
      return null;
    }
    const n = parsePointMarker(
      full,
      { width: cropped.width, height: cropped.height },
      dbg,
    );
    // Boîte couvrant tout le crop : l'élément est censé être ~3× plus petit,
    // c'est un renoncement du modèle, pas une correction.
    if (n === null || n.wholeScreen) {
      dbg(`vérification : réponse inexploitable (${full.slice(0, 60)}…)`);
      return null;
    }
    // Coordonnées du crop → % de l'écran entier.
    const out: PointEvent = {
      xPct: ((rect.x + (n.xPct / 100) * rect.width) / shot.imageSize.width) * 100,
      yPct: ((rect.y + (n.yPct / 100) * rect.height) / shot.imageSize.height) * 100,
    };
    if (n.wPct !== undefined && n.hPct !== undefined) {
      out.wPct = (n.wPct / 100) * (rect.width / shot.imageSize.width) * 100;
      out.hPct = (n.hPct / 100) * (rect.height / shot.imageSize.height) * 100;
    } else if (point.wPct !== undefined && point.hPct !== undefined) {
      // Centre corrigé, taille d'origine : mieux qu'un cadre par défaut.
      out.wPct = point.wPct;
      out.hPct = point.hPct;
    }
    return out;
  };

  return {
    async verifyPoint(point, shot, question, answer, signal) {
      // 1) DOM : vérité terrain quand l'app au premier plan expose son HTML.
      try {
        const dom = await deps.readDom();
        if (signal.aborted) return point;
        if (dom) {
          const snapped = snapToElement(dom, point, shot.display.bounds, answer);
          if (snapped) {
            dbg(
              `pointage calé sur le DOM (${dom.app}) : ${fmtPt(point)} → ${fmtPt(snapped)}`,
            );
            return snapped;
          }
          dbg(
            `DOM lu (${dom.app}, ${dom.elements.length} éléments) mais aucun raccord — passage vision`,
          );
        }
      } catch {
        // lecture DOM en échec : la voie vision reste ouverte
      }
      // 2) Vision : le modèle rejoue son pointage sur un zoom et se corrige.
      const refined = await refineByVision(point, shot, question, answer, signal);
      if (refined) {
        dbg(`pointage corrigé par le second passage : ${fmtPt(point)} → ${fmtPt(refined)}`);
        return refined;
      }
      return point;
    },

    async refineGuide(guide, shot) {
      // Seules les étapes « proximity » ont une cible visible À L'ÉCRAN
      // MAINTENANT ; les étapes « click » visent un élément à venir (menu,
      // dialogue) que le DOM actuel contredirait.
      const eligible = (s: GuideStep) =>
        s.advance === "proximity" &&
        s.xPct !== undefined &&
        s.yPct !== undefined;
      if (!guide.steps.some(eligible)) return guide;
      let dom: DomSnapshot | null = null;
      try {
        dom = await deps.readDom();
      } catch {
        return guide;
      }
      if (!dom) return guide;
      let snappedCount = 0;
      const steps = guide.steps.map((step) => {
        if (!eligible(step)) return step;
        const snapped = snapToElement(
          dom,
          {
            xPct: step.xPct as number,
            yPct: step.yPct as number,
            ...(step.wPct !== undefined && step.hPct !== undefined
              ? { wPct: step.wPct, hPct: step.hPct }
              : {}),
          },
          shot.display.bounds,
          step.text,
        );
        if (!snapped) return step;
        snappedCount++;
        return {
          ...step,
          xPct: snapped.xPct,
          yPct: snapped.yPct,
          wPct: snapped.wPct,
          hPct: snapped.hPct,
        };
      });
      if (snappedCount === 0) return guide;
      dbg(
        `guide calé sur le DOM (${dom.app}) : ${snappedCount}/${guide.steps.length} étapes ajustées`,
      );
      const out: ParsedGuide = { steps };
      if (guide.outro !== undefined) out.outro = guide.outro;
      return out;
    },
  };
}
