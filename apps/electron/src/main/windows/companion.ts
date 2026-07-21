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

export function startCursorFollow(win: BrowserWindow): () => void {
  let last = { x: -1, y: -1 };
  let side: "left" | "right" = "right";
  const timer = setInterval(() => {
    if (win.isDestroyed() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    if (p.x === last.x && p.y === last.y) return;
    last = p;
    const area = screen.getDisplayNearestPoint(p).workArea;
    // Bulle à droite du tournesol par défaut ; à gauche près du bord droit.
    const fitsRight = p.x + OFFSET_X + COMPANION_W <= area.x + area.width;
    const nextSide: "left" | "right" = fitsRight ? "right" : "left";
    if (nextSide !== side) {
      side = nextSide;
      win.webContents.send(CH.flip, side);
    }
    const x =
      side === "right"
        ? p.x + OFFSET_X
        : p.x + OFFSET_X + FLOWER_BLOCK - COMPANION_W;
    const y = Math.min(
      Math.max(p.y + OFFSET_Y, area.y),
      area.y + area.height - COMPANION_H,
    );
    win.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: COMPANION_W,
      height: COMPANION_H,
    });
  }, 16);
  return () => clearInterval(timer);
}
