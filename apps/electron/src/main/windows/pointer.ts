import type { BrowserWindow } from "electron";
import { CH } from "../../shared/ipc";
import { createOverlayWindow, rendererFile } from "./common";

export const POINTER_W = 140;
export const POINTER_H = 100;
export const POINTER_MS = 4000;

let hideTimer: NodeJS.Timeout | null = null;

export async function createPointerWindow(): Promise<BrowserWindow> {
  const win = createOverlayWindow({ width: POINTER_W, height: POINTER_H });
  await win.loadFile(rendererFile("pointer/pointer.html"));
  return win;
}

export function showPointerAt(
  win: BrowserWindow,
  xPct: number,
  yPct: number,
  displayBounds: Electron.Rectangle,
): void {
  const x = Math.round(
    displayBounds.x + (xPct / 100) * displayBounds.width - POINTER_W / 2,
  );
  const y = Math.round(
    displayBounds.y + (yPct / 100) * displayBounds.height - POINTER_H / 2,
  );
  win.setBounds({ x, y, width: POINTER_W, height: POINTER_H });
  win.webContents.send(CH.pointShow);
  win.showInactive();
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => hidePointer(win), POINTER_MS);
}

export function hidePointer(win: BrowserWindow): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (!win.isDestroyed() && win.isVisible()) win.hide();
}
