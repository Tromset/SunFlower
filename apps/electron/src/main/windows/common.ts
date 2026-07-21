import { BrowserWindow } from "electron";
import path from "node:path";

export function preloadPath(): string {
  return path.join(__dirname, "..", "preload", "index.cjs");
}

export function rendererFile(name: string): string {
  return path.join(__dirname, "..", "renderer", name);
}

/**
 * Fenêtre de superposition : transparente, sans focus, traversée par la
 * souris, toujours au premier plan, exclue des captures d'écran.
 */
export function createOverlayWindow(opts: {
  width: number;
  height: number;
  show?: boolean;
}): BrowserWindow {
  const win = new BrowserWindow({
    width: opts.width,
    height: opts.height,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);
  win.setContentProtection(true);
  return win;
}
