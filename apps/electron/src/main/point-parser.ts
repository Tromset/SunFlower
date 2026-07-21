// Extraction en flux du marqueur [POINT:x%,y%] : le texte affiché/prononcé ne
// contient jamais le marqueur, même coupé entre deux chunks.
export interface PointEvent {
  xPct: number;
  yPct: number;
}

const MARKER =
  /\[POINT:\s*(\d+(?:\.\d+)?)\s*%?\s*,\s*(\d+(?:\.\d+)?)\s*%?\s*\]/;
const START = "[POINT:";

export interface PointParser {
  push(chunk: string): void;
  flush(): void;
}

export function createPointParser(handlers: {
  onText(text: string): void;
  onPoint(point: PointEvent): void;
}): PointParser {
  let buffer = "";
  let fired = false;

  const emitUpTo = (end: number) => {
    if (end > 0) {
      handlers.onText(buffer.slice(0, end));
      buffer = buffer.slice(end);
    }
  };

  const process = (final: boolean) => {
    for (;;) {
      const match = MARKER.exec(buffer);
      if (!match) break;
      emitUpTo(match.index);
      buffer = buffer.slice(match[0].length);
      if (!fired) {
        fired = true;
        const xPct = Math.min(100, Math.max(0, Number(match[1])));
        const yPct = Math.min(100, Math.max(0, Number(match[2])));
        handlers.onPoint({ xPct, yPct });
      }
    }
    if (final) {
      emitUpTo(buffer.length);
      return;
    }
    // Retenir une éventuelle amorce de marqueur en fin de buffer.
    const open = buffer.lastIndexOf("[");
    if (open === -1) {
      emitUpTo(buffer.length);
      return;
    }
    const tail = buffer.slice(open);
    const maybeMarker =
      tail.length <= START.length
        ? START.startsWith(tail)
        : tail.startsWith(START) && !tail.includes("]");
    emitUpTo(maybeMarker ? open : buffer.length);
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      process(false);
    },
    flush() {
      process(true);
    },
  };
}

/** Retire tout marqueur résiduel d'un texte complet (défensif). */
export function stripPointMarkers(text: string): string {
  return text
    .replace(
      /\[POINT:\s*\d+(?:\.\d+)?\s*%?\s*,\s*\d+(?:\.\d+)?\s*%?\s*\]/g,
      "",
    )
    .trim();
}
