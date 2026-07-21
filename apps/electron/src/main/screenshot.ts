import { desktopCapturer, screen, type Display } from "electron";

export interface Screenshot {
  imageB64: string;
  display: Display;
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
    const source =
      sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!source || source.thumbnail.isEmpty()) return null;
    return {
      imageB64: source.thumbnail.toJPEG(80).toString("base64"),
      display,
    };
  } catch (err) {
    console.error("[sunflower] screen capture failed:", err);
    return null;
  }
}
