// Encadrement par le DOM : quand l'app au premier plan est un navigateur,
// on lit le HTML réellement affiché (osascript JXA, même approche zéro
// dépendance que work/clicker.ts) et le cadre se cale sur la boîte EXACTE de
// l'élément visé, au lieu de faire confiance au modèle vision au pixel près.
// Hors macOS, app sans HTML accessible, ou navigateur qui refuse l'injection
// (« Allow JavaScript from Apple Events » désactivé) : null, silencieusement —
// le pointage vision garde alors la main.
import { execFile } from "node:child_process";
import type { PointEvent } from "./guide-parser";

/** Élément interactif de la page, boîte en POINTS écran globaux. */
export interface DomElement {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DomSnapshot {
  /** Nom de l'app au premier plan (diagnostic). */
  app: string;
  elements: DomElement[];
}

/** Budget total : spawn osascript + aller-retour AppleEvents ↔ navigateur. */
const DOM_TIMEOUT_MS = 2500;
/** Plafond d'éléments remontés (page géante = bruit + payload obèse). */
const MAX_ELEMENTS = 400;

/** Rayon de raccord : un élément dont le centre est à moins de ce rayon du
 *  point annoncé par le modèle est considéré comme la cible (aligné sur
 *  l'imprécision vision absorbée ailleurs, cf. PROX_RADIUS du guide-runner). */
const SNAP_RADIUS_PX = 90;
/** Rayon élargi quand le libellé de l'élément apparaît dans la réponse : le
 *  texte confirme la cible, la géométrie peut être plus approximative. */
const LABEL_RADIUS_PX = 300;
/** Libellé trop court pour valoir confirmation (« ok », « x »…). */
const MIN_LABEL_CHARS = 3;
/** Bonus de score d'un libellé confirmé (distance effective × ce facteur). */
const LABEL_WEIGHT = 0.35;

// JS injecté dans la page : recense les éléments interactifs visibles avec
// leur boîte en points écran. screenX/screenY placent le viewport ; la
// hauteur du chrome (barre d'outils) est approchée par outerHeight −
// innerHeight moins les bordures latérales — exact à quelques points près,
// largement sous SNAP_RADIUS_PX. Renvoie une chaîne JSON (les deux dialectes
// AppleScript ne sérialisent bien que les primitives).
const PAGE_JS = [
  "(() => {",
  "  const padX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);",
  "  const dx = window.screenX + padX;",
  "  const dy = window.screenY + Math.max(0, window.outerHeight - window.innerHeight - padX);",
  "  const sel = 'a,button,input,select,textarea,summary,[role=\"button\"],[role=\"link\"],[role=\"tab\"],[role=\"menuitem\"],[role=\"option\"],[role=\"checkbox\"],[onclick]';",
  "  const out = [];",
  "  for (const el of document.querySelectorAll(sel)) {",
  "    const r = el.getBoundingClientRect();",
  "    if (r.width < 4 || r.height < 4) continue;",
  "    if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) continue;",
  "    const cs = window.getComputedStyle(el);",
  "    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;",
  "    const label = (el.getAttribute('aria-label') || el.value || el.placeholder || el.innerText || el.title || '')",
  "      .trim().replace(/\\s+/g, ' ').slice(0, 80);",
  `    out.push({ label: label, x: dx + r.left, y: dy + r.top, w: r.width, h: r.height });`,
  `    if (out.length >= ${MAX_ELEMENTS}) break;`,
  "  }",
  "  return JSON.stringify(out);",
  "})()",
].join("\n");

// JXA hôte : identifie l'app au premier plan, et si c'est un navigateur
// pilotable, lui fait exécuter PAGE_JS (reçu en argv, jamais interpolé).
// Safari passe par doJavaScript, les dérivés Chromium par execute — les deux
// exigent d'avoir autorisé « JavaScript from Apple Events » dans le
// navigateur ; sinon l'erreur est absorbée et on renvoie l'app seule.
const LOCATOR_SCRIPT = [
  "function run(argv) {",
  "  var procs = Application('System Events').applicationProcesses.whose({ frontmost: true });",
  "  if (procs.length === 0) return 'null';",
  "  var name = procs[0].name();",
  "  var chromiums = ['Google Chrome', 'Brave Browser', 'Microsoft Edge', 'Arc', 'Vivaldi', 'Opera', 'Chromium'];",
  "  try {",
  "    if (name === 'Safari') {",
  "      var safari = Application('Safari');",
  "      var json = safari.doJavaScript(argv[0], { in: safari.windows[0].currentTab() });",
  "      return JSON.stringify({ app: name, json: json });",
  "    }",
  "    if (chromiums.indexOf(name) !== -1) {",
  "      var chrome = Application(name);",
  "      var out = chrome.windows[0].activeTab.execute({ javascript: argv[0] });",
  "      return JSON.stringify({ app: name, json: out });",
  "    }",
  "  } catch (e) {",
  "    return JSON.stringify({ app: name, error: String(e) });",
  "  }",
  "  return JSON.stringify({ app: name });",
  "}",
].join("\n");

/** Sortie brute du script → instantané validé (exporté pour les tests). */
export function parseSnapshot(raw: string): DomSnapshot | null {
  try {
    const outer = JSON.parse(raw.trim()) as {
      app?: unknown;
      json?: unknown;
    } | null;
    if (!outer || typeof outer.app !== "string") return null;
    if (typeof outer.json !== "string") return null;
    const list = JSON.parse(outer.json) as unknown;
    if (!Array.isArray(list)) return null;
    const elements: DomElement[] = [];
    for (const item of list) {
      const el = item as Partial<DomElement> | null;
      if (
        !el ||
        typeof el.x !== "number" ||
        typeof el.y !== "number" ||
        typeof el.w !== "number" ||
        typeof el.h !== "number" ||
        ![el.x, el.y, el.w, el.h].every(Number.isFinite) ||
        el.w <= 0 ||
        el.h <= 0
      ) {
        continue;
      }
      elements.push({
        label: typeof el.label === "string" ? el.label : "",
        x: el.x,
        y: el.y,
        w: el.w,
        h: el.h,
      });
    }
    if (elements.length === 0) return null;
    return { app: outer.app, elements };
  } catch {
    return null;
  }
}

/** Lit le DOM de l'app au premier plan. Jamais d'exception : null suffit. */
export function readFrontmostDom(): Promise<DomSnapshot | null> {
  if (process.platform !== "darwin") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", LOCATOR_SCRIPT, PAGE_JS],
      { timeout: DOM_TIMEOUT_MS, killSignal: "SIGKILL" },
      (err, stdout) => {
        resolve(err ? null : parseSnapshot(stdout));
      },
    );
  });
}

/** Écran (points globaux) — structurel pour rester testable sans Electron. */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Cale un point annoncé par le modèle sur l'élément HTML le plus plausible :
 * élément contenant le point, sinon centre le plus proche dans SNAP_RADIUS_PX
 * — rayon élargi à LABEL_RADIUS_PX quand le libellé de l'élément apparaît
 * dans le texte de la réponse (la confirmation textuelle pardonne une plus
 * grosse erreur de géométrie). Null : aucun élément assez convaincant.
 */
export function snapToElement(
  snapshot: DomSnapshot,
  point: PointEvent,
  screen: ScreenRect,
  answerText: string,
): PointEvent | null {
  const px = screen.x + (point.xPct / 100) * screen.width;
  const py = screen.y + (point.yPct / 100) * screen.height;
  const answer = answerText.toLowerCase();
  let best: { el: DomElement; score: number; area: number } | null = null;
  for (const el of snapshot.elements) {
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    const inside =
      px >= el.x && px <= el.x + el.w && py >= el.y && py <= el.y + el.h;
    const d = Math.hypot(px - cx, py - cy);
    const labelHit =
      el.label.length >= MIN_LABEL_CHARS &&
      answer.includes(el.label.toLowerCase());
    // « Dedans » rend éligible (grand élément visé par son bord) mais le
    // score reste la distance au centre : un bouton confirmé par son libellé
    // bat un grand conteneur qui contient le point par accident.
    if (!inside && d > (labelHit ? LABEL_RADIUS_PX : SNAP_RADIUS_PX)) continue;
    const score = labelHit ? d * LABEL_WEIGHT : d;
    const area = el.w * el.h;
    // Score égal (éléments concentriques) : la plus petite boîte gagne.
    if (!best || score < best.score || (score === best.score && area < best.area)) {
      best = { el, score, area };
    }
  }
  if (!best) return null;
  const clampPct = (v: number) => Math.min(100, Math.max(0, v));
  const el = best.el;
  return {
    xPct: clampPct(((el.x + el.w / 2 - screen.x) / screen.width) * 100),
    yPct: clampPct(((el.y + el.h / 2 - screen.y) / screen.height) * 100),
    wPct: Math.min(100, (el.w / screen.width) * 100),
    hPct: Math.min(100, (el.h / screen.height) * 100),
  };
}
