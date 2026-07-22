import { screen, type BrowserWindow, type Rectangle } from "electron";
import { CH } from "../../shared/ipc";
import { createOverlayWindow, rendererFile } from "./common";

export const COMPANION_W = 480;
export const COMPANION_H = 220;
/** Largeur du bloc tournesol dans la fenêtre (voir companion.css). */
const FLOWER_BLOCK = 64;
/** Décalage du tournesol par rapport à la pointe du curseur (prototype 1a). */
const OFFSET_X = 18;
const OFFSET_Y = 20;

/** Badge docké : petit carré garé en bas à droite de la zone de travail. */
export const DOCK_W = 110;
export const DOCK_H = 110;
const DOCK_MARGIN = 16;

/* Cadence du suivi. Tout ce gating existe à cause d'un rapport utilisateur
   « l'app fait chauffer mon ordinateur » : la boucle 60 fps permanente +
   setBounds inconditionnel étaient la première charge toujours-active. */
/** Boucle rapide (curseur en mouvement, vol) : 30 fps suffisent largement. */
const FAST_MS = 33;
/** Boucle lente (curseur immobile) : ~6 Hz, juste pour guetter la reprise. */
const SLOW_MS = 166;
/** Immobilité du curseur avant de rétrograder vers la boucle lente. */
const STILL_AFTER_MS = 3000;

export async function createCompanionWindow(): Promise<BrowserWindow> {
  const win = createOverlayWindow({ width: COMPANION_W, height: COMPANION_H });
  // forward: true → la fenêtre reste traversée par la souris mais le renderer
  // reçoit les mousemove : il détecte le survol de la fleur et demande alors
  // à devenir interactif (double-clic dock/undock). Voir CH.companionHover.
  win.setIgnoreMouseEvents(true, { forward: true });
  await win.loadFile(rendererFile("companion/companion.html"));
  return win;
}

/** Écart entre la cible d'un guide et le bord du bloc tournesol : le
 *  tournesol se gare juste à l'extérieur des crochets (POINTER_W / 2 = 70). */
const PARK_GAP = 78;
/** Centre verticalement le bloc tournesol (70 px) sur la cible. */
const PARK_DY = -35;
/** Durée de vol : proportionnelle à la distance, bornée. */
const FLY_MS_PER_PX = 0.6;
const FLY_MIN_MS = 250;
const FLY_MAX_MS = 900;

export interface CompanionController {
  /** Mode par défaut : le tournesol suit le curseur (comportement historique). */
  follow(): void;
  /** Gel sur place (étape de guide sans cible). */
  hold(): void;
  /** Vole se garer à côté d'une cible (coordonnées écran globales). */
  flyTo(target: { x: number; y: number }): void;
  /** Docké : badge en bas à droite, boucle de suivi entièrement arrêtée. */
  setDocked(docked: boolean): void;
  dispose(): void;
}

export function createCompanionController(
  win: BrowserWindow,
): CompanionController {
  let mode: "follow" | "fly" | "hold" = "follow";
  let docked = false;
  let last = { x: -1, y: -1 };
  let lastMoveAt = Date.now();
  let side: "left" | "right" = "right";
  let from = { x: 0, y: 0 };
  let to = { x: 0, y: 0 };
  let t0 = 0;
  let duration = 0;

  const setSide = (next: "left" | "right") => {
    if (next !== side) {
      side = next;
      win.webContents.send(CH.flip, side);
    }
  };

  /** Derniers bounds appliqués : setBounds sauté si la cible est inchangée. */
  let placed = { x: NaN, y: NaN, w: NaN, h: NaN };
  const place = (
    x: number,
    y: number,
    w = COMPANION_W,
    h = COMPANION_H,
  ) => {
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (
      rx === placed.x &&
      ry === placed.y &&
      w === placed.w &&
      h === placed.h
    ) {
      return;
    }
    placed = { x: rx, y: ry, w, h };
    win.setBounds({ x: rx, y: ry, width: w, height: h });
  };

  // ---- Boucle unique, à cadence variable (voir FAST_MS/SLOW_MS ci-dessus).
  // Arrêtée net quand il n'y a rien à suivre : docké, masqué, ou mode hold.
  let timer: NodeJS.Timeout | null = null;
  let timerMs = 0;
  const setLoop = (ms: number | null) => {
    if (ms === null) {
      if (timer) clearInterval(timer);
      timer = null;
      timerMs = 0;
      return;
    }
    if (timer && timerMs === ms) return;
    if (timer) clearInterval(timer);
    timerMs = ms;
    timer = setInterval(tick, ms);
  };

  const followTick = () => {
    const p = screen.getCursorScreenPoint();
    if (p.x === last.x && p.y === last.y) {
      // Curseur immobile : après quelques secondes, sondage lent (~6 Hz)
      // qui repassera en 30 fps dès le premier mouvement détecté.
      if (Date.now() - lastMoveAt >= STILL_AFTER_MS) setLoop(SLOW_MS);
      return;
    }
    last = p;
    lastMoveAt = Date.now();
    setLoop(FAST_MS);
    const area = screen.getDisplayNearestPoint(p).workArea;
    // Bulle à droite du tournesol par défaut ; à gauche près du bord droit.
    const fitsRight = p.x + OFFSET_X + COMPANION_W <= area.x + area.width;
    setSide(fitsRight ? "right" : "left");
    const x =
      side === "right"
        ? p.x + OFFSET_X
        : p.x + OFFSET_X + FLOWER_BLOCK - COMPANION_W;
    const y = Math.min(
      Math.max(p.y + OFFSET_Y, area.y),
      area.y + area.height - COMPANION_H,
    );
    place(x, y);
  };

  const easeInOutCubic = (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  const flyTick = () => {
    const t = duration <= 0 ? 1 : Math.min(1, (Date.now() - t0) / duration);
    const k = easeInOutCubic(t);
    place(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
    if (t >= 1) mode = "hold";
  };

  const tick = () => {
    if (win.isDestroyed()) {
      setLoop(null);
      return;
    }
    if (docked || !win.isVisible()) {
      setLoop(null);
      return;
    }
    if (mode === "follow") followTick();
    else if (mode === "fly") flyTick();
    else setLoop(null); // hold : rien à animer, on ne tourne pas à vide.
  };

  const startFollowLoop = () => {
    last = { x: -1, y: -1 };
    lastMoveAt = Date.now();
    if (!win.isDestroyed() && win.isVisible()) setLoop(FAST_MS);
  };

  /** Gare le badge en bas à droite de la zone de travail donnée. */
  const parkAt = (area: Rectangle) => {
    setLoop(null);
    place(
      area.x + area.width - DOCK_W - DOCK_MARGIN,
      area.y + area.height - DOCK_H - DOCK_MARGIN,
      DOCK_W,
      DOCK_H,
    );
  };
  const park = () => {
    const p = screen.getCursorScreenPoint();
    parkAt(screen.getDisplayNearestPoint(p).workArea);
  };

  // Docké : suivre les reconfigurations d'écran (résolution, écran débranché).
  const onMetricsChanged = () => {
    if (docked && !win.isDestroyed()) {
      parkAt(screen.getDisplayMatching(win.getBounds()).workArea);
    }
  };
  screen.on("display-metrics-changed", onMetricsChanged);

  // Fenêtre masquée : boucle coupée ; reprise au retour à l'écran.
  const onShow = () => {
    if (!docked && (mode === "follow" || mode === "fly")) startFollowLoop();
  };
  const onHide = () => setLoop(null);
  win.on("show", onShow);
  win.on("hide", onHide);

  if (win.isVisible()) startFollowLoop();

  return {
    follow() {
      if (docked) {
        // Docké : le suivi reste désactivé, le badge garde son coin.
        park();
        return;
      }
      mode = "follow";
      startFollowLoop();
    },
    hold() {
      if (docked) return;
      mode = "hold";
      setLoop(null);
    },
    flyTo(target) {
      // Docké : pas de vol — rien ne doit flotter au milieu de l'écran ;
      // le pointer continue de montrer la cible, le badge reste au coin.
      if (docked) return;
      const area = screen.getDisplayNearestPoint(target).workArea;
      // Garage symétrique : le bord du bloc tournesol à PARK_GAP de la cible.
      const fitsRight =
        target.x + PARK_GAP + COMPANION_W <= area.x + area.width;
      setSide(fitsRight ? "right" : "left");
      const x =
        side === "right"
          ? target.x + PARK_GAP
          : target.x - PARK_GAP - COMPANION_W;
      const y = Math.min(
        Math.max(target.y + PARK_DY, area.y),
        area.y + area.height - COMPANION_H,
      );
      const bounds = win.getBounds();
      from = { x: bounds.x, y: bounds.y };
      to = { x: Math.round(x), y: Math.round(y) };
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      duration = Math.min(
        FLY_MAX_MS,
        Math.max(FLY_MIN_MS, dist * FLY_MS_PER_PX),
      );
      t0 = Date.now();
      mode = "fly";
      if (!win.isDestroyed() && win.isVisible()) setLoop(FAST_MS);
    },
    setDocked(next) {
      if (docked === next || win.isDestroyed()) return;
      docked = next;
      if (next) {
        mode = "hold";
        park();
        win.webContents.send(CH.companionDocked, true);
      } else {
        win.webContents.send(CH.companionDocked, false);
        mode = "follow";
        startFollowLoop();
      }
    },
    dispose() {
      setLoop(null);
      screen.removeListener("display-metrics-changed", onMetricsChanged);
      if (!win.isDestroyed()) {
        win.removeListener("show", onShow);
        win.removeListener("hide", onHide);
      }
    },
  };
}
