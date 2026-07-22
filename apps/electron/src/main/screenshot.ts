import { desktopCapturer, screen, type Display } from "electron";
import { getConfig, setConfig } from "./config-store";

export interface Screenshot {
  imageB64: string;
  display: Display;
  /** Vrai si la miniature vient bien de `display` (correspondance par
   *  display_id, ou écran unique). Faux = repli sources[0] : l'image peut
   *  montrer un AUTRE écran que celui du curseur — interdit pour Work. */
  displayMatched: boolean;
}

/** Capture l'écran où se trouve le curseur (JPEG base64, taille en points). */
export async function captureScreenAtCursor(): Promise<Screenshot | null> {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: Math.round(display.size.width),
        height: Math.round(display.size.height),
      },
    });
    const matched = sources.find(
      (s) => s.display_id === String(display.id),
    );
    const source = matched ?? sources[0];
    if (!source || source.thumbnail.isEmpty()) return null;
    // Une capture réussie prouve que « contenu d'écran » fonctionne.
    if (!getConfig().screenCaptureConfirmed) {
      setConfig({ screenCaptureConfirmed: true });
    }
    return {
      imageB64: source.thumbnail.toJPEG(80).toString("base64"),
      display,
      displayMatched: matched !== undefined || sources.length === 1,
    };
  } catch (err) {
    console.error("[sunflower] screen capture failed:", err);
    return null;
  }
}
