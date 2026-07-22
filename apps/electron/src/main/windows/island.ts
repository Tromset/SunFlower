import { screen, type BrowserWindow } from "electron";
import type { IslandState } from "../../shared/state";
import { createOverlayWindow, rendererFile } from "./common";

export const ISLAND_W = 560;
export const ISLAND_H = 110;

/** Délai de grâce avant de masquer la fenêtre au retour à idle : évite le
 *  clignotement quand un état intermédiaire (ex. reading) est très bref. */
const HIDE_GRACE_MS = 2000;

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
  const onMetricsChanged = () => {
    if (!win.isDestroyed()) positionIsland(win);
  };
  screen.on("display-metrics-changed", onMetricsChanged);
  // Le listener sur `screen` (global au process) survivrait sinon à la
  // fenêtre : on le retire explicitement à sa destruction.
  win.once("closed", () => {
    screen.removeListener("display-metrics-changed", onMetricsChanged);
  });
  await win.loadFile(rendererFile("island/island.html"));
  return win;
}

/** Contrôle la visibilité réelle de la fenêtre de l'île : masquée (coût de
 *  compositing nul) tant que l'état est idle, affichée dès qu'on en sort,
 *  avec un court délai de grâce au retour à idle pour éviter le clignotement
 *  entre deux états d'activité très rapprochés. Le fondu (opacité) est géré
 *  côté renderer via island.css, déclenché par le changement de classe d'état. */
export interface IslandVisibility {
  setState(state: IslandState): void;
  dispose(): void;
}

export function createIslandVisibility(win: BrowserWindow): IslandVisibility {
  let hideTimer: NodeJS.Timeout | null = null;

  const clearHideTimer = () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  return {
    setState(state) {
      if (win.isDestroyed()) return;
      if (state === "idle") {
        if (hideTimer) return; // déjà programmé
        hideTimer = setTimeout(() => {
          hideTimer = null;
          if (!win.isDestroyed()) win.hide();
        }, HIDE_GRACE_MS);
        return;
      }
      clearHideTimer();
      if (!win.isVisible()) win.showInactive();
    },
    dispose() {
      clearHideTimer();
    },
  };
}
