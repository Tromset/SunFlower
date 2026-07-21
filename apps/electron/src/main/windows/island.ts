import { screen, type BrowserWindow } from "electron";
import { createOverlayWindow, rendererFile } from "./common";

export const ISLAND_W = 560;
export const ISLAND_H = 110;

export function positionIsland(win: BrowserWindow): void {
  const { workArea } = screen.getPrimaryDisplay();
  win.setBounds({
    x: Math.round(workArea.x + (workArea.width - ISLAND_W) / 2),
    y: workArea.y,
    width: ISLAND_W,
    height: ISLAND_H,
  });
}

export async function createIslandWindow(): Promise<BrowserWindow> {
  const win = createOverlayWindow({ width: ISLAND_W, height: ISLAND_H });
  positionIsland(win);
  screen.on("display-metrics-changed", () => {
    if (!win.isDestroyed()) positionIsland(win);
  });
  await win.loadFile(rendererFile("island/island.html"));
  return win;
}
