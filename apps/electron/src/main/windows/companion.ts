import { screen, type BrowserWindow } from "electron";
import { CH } from "../../shared/ipc";
import { createOverlayWindow, rendererFile } from "./common";

export const COMPANION_W = 480;
export const COMPANION_H = 220;
/** Largeur du bloc tournesol dans la fenêtre (voir companion.css). */
const FLOWER_BLOCK = 64;
/** Décalage du tournesol par rapport à la pointe du curseur (prototype 1a). */
const OFFSET_X = 18;
const OFFSET_Y = 20;

export async function createCompanionWindow(): Promise<BrowserWindow> {
  const win = createOverlayWindow({ width: COMPANION_W, height: COMPANION_H });
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
  dispose(): void;
}

export function createCompanionController(
  win: BrowserWindow,
): CompanionController {
  let mode: "follow" | "fly" | "hold" = "follow";
  let last = { x: -1, y: -1 };
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

  const place = (x: number, y: number) => {
    win.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: COMPANION_W,
      height: COMPANION_H,
    });
  };

  const followTick = () => {
    const p = screen.getCursorScreenPoint();
    if (p.x === last.x && p.y === last.y) return;
    last = p;
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

  const timer = setInterval(() => {
    if (win.isDestroyed() || !win.isVisible()) return;
    if (mode === "follow") followTick();
    else if (mode === "fly") flyTick();
  }, 16);

  return {
    follow() {
      mode = "follow";
      last = { x: -1, y: -1 };
    },
    hold() {
      mode = "hold";
    },
    flyTo(target) {
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
    },
    dispose() {
      clearInterval(timer);
    },
  };
}
