import { BrowserWindow, app, screen } from "electron";
import { preloadPath, rendererFile } from "./common";

export const PANEL_W = 400;
export const PANEL_H = 620;
/** Largeur de la carte visible dans la fenêtre transparente. */
const CARD_W = 320;

/**
 * Sur macOS, cliquer l'icône de tray pendant que le panneau est ouvert
 * déclenche d'abord `blur` (le panneau se cache) puis le clic : sans garde,
 * le panneau se rouvrirait aussitôt au lieu de se fermer.
 */
let hiddenAt = 0;

export async function createPanelWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    focusable: true,
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
  win.setAlwaysOnTop(true, "pop-up-menu");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setContentProtection(true);
  win.on("blur", () => {
    if (win.isVisible()) {
      hiddenAt = Date.now();
      win.hide();
    }
  });
  await win.loadFile(rendererFile("panel/panel.html"));
  return win;
}

export function togglePanel(
  win: BrowserWindow,
  trayBounds: Electron.Rectangle,
): void {
  if (win.isVisible()) {
    hiddenAt = Date.now();
    win.hide();
    return;
  }
  if (Date.now() - hiddenAt < 350) return;
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x + trayBounds.width / 2,
    y: trayBounds.y + trayBounds.height / 2,
  });
  const area = display.workArea;
  const pad = (PANEL_W - CARD_W) / 2;
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - PANEL_W / 2);
  // La carte visible (centrée dans la fenêtre) doit rester dans l'écran.
  x = Math.min(x, area.x + area.width - CARD_W - 8 - pad);
  x = Math.max(x, area.x + 8 - pad);
  const y = area.y + 2;
  win.setBounds({ x, y, width: PANEL_W, height: PANEL_H });
  win.show();
  app.focus({ steal: true });
}
