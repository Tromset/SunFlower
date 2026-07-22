import type { BrowserWindow } from "electron";
import { CH, type PointShowPayload } from "../../shared/ipc";
import { createOverlayWindow, rendererFile } from "./common";

export const POINTER_W = 140;
export const POINTER_H = 100;
export const POINTER_MS = 4000;

/** Aire de respiration entre l'élément visé et les crochets. */
const FRAME_PAD_PX = 10;
/** Cadre jamais plus petit (cible minuscule ou taille dégénérée)… */
const FRAME_MIN_W = 60;
const FRAME_MIN_H = 48;
/** …ni plus grand que cette fraction de l'écran. */
const FRAME_MAX_FRAC = 0.7;
/** Fenêtre = cadre × 1.15 + marge : l'animation d'apparition (scale 1.15)
 *  déborde du cadre, sans ça les coins seraient rognés pendant le zoom. */
const winSize = (frame: number): number => Math.ceil(frame * 1.15) + 8;

/** Cible de pointage : centre en % de l'écran, taille optionnelle (boîte
 *  englobante du modèle). Sans taille : visuel historique 140×100. */
export interface PointerTarget {
  xPct: number;
  yPct: number;
  wPct?: number;
  hPct?: number;
}

let hideTimer: NodeJS.Timeout | null = null;

export async function createPointerWindow(): Promise<BrowserWindow> {
  // Masqué la plupart du temps : laisser Chromium throttler ses timers en fond.
  const win = createOverlayWindow({
    width: POINTER_W,
    height: POINTER_H,
    backgroundThrottling: true,
    resizable: true,
  });
  await win.loadFile(rendererFile("pointer/pointer.html"));
  return win;
}

export function showPointerAt(
  win: BrowserWindow,
  target: PointerTarget,
  displayBounds: Electron.Rectangle,
  opts?: { sticky?: boolean },
): Electron.Rectangle {
  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v));
  const hasSize = target.wPct !== undefined && target.hPct !== undefined;
  let width = POINTER_W;
  let height = POINTER_H;
  let payload: PointShowPayload = {};
  if (hasSize) {
    // Boîte de l'élément en px écran + padding, bornée min/max.
    const frameW = clamp(
      ((target.wPct as number) / 100) * displayBounds.width + 2 * FRAME_PAD_PX,
      FRAME_MIN_W,
      displayBounds.width * FRAME_MAX_FRAC,
    );
    const frameH = clamp(
      ((target.hPct as number) / 100) * displayBounds.height + 2 * FRAME_PAD_PX,
      FRAME_MIN_H,
      displayBounds.height * FRAME_MAX_FRAC,
    );
    width = winSize(frameW);
    height = winSize(frameH);
    payload = { w: Math.round(frameW), h: Math.round(frameH) };
  }
  // Centrée sur la cible, puis ramenée entièrement dans l'écran (offsets des
  // écrans secondaires compris) : près d'un bord le cadre se décale plutôt
  // que de pendre hors écran comme avant.
  const x = Math.round(
    clamp(
      displayBounds.x + (target.xPct / 100) * displayBounds.width - width / 2,
      displayBounds.x,
      displayBounds.x + displayBounds.width - width,
    ),
  );
  const y = Math.round(
    clamp(
      displayBounds.y + (target.yPct / 100) * displayBounds.height - height / 2,
      displayBounds.y,
      displayBounds.y + displayBounds.height - height,
    ),
  );
  const rect = { x, y, width, height };
  win.setBounds(rect);
  win.webContents.send(CH.pointShow, payload);
  win.showInactive();
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  // sticky (étape de guide) : visible jusqu'à hidePointer explicite.
  if (!opts?.sticky) hideTimer = setTimeout(() => hidePointer(win), POINTER_MS);
  return rect;
}

export function hidePointer(win: BrowserWindow): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (!win.isDestroyed() && win.isVisible()) win.hide();
}
