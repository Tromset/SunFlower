// Transcription locale via smart-whisper (binding N-API de whisper.cpp).
// Tout est chargé défensivement : sans module natif ou sans modèle, l'app
// tourne et le panneau explique quoi faire.
import { app } from "electron";
import { setDefaultResultOrder } from "node:dns";
import { createWriteStream, existsSync, mkdirSync, renameSync } from "node:fs";
import { rm } from "node:fs/promises";
import https from "node:https";
import path from "node:path";

// Certains réseaux résolvent l'IPv6 sans la router — préférer l'IPv4.
try {
  setDefaultResultOrder("ipv4first");
} catch {
  // ordre par défaut conservé
}
import type { SttStatus } from "../shared/state";
import { getConfig } from "./config-store";

interface WhisperSegment {
  text: string;
}
interface WhisperTask {
  result: Promise<WhisperSegment[]>;
}
interface WhisperInstance {
  transcribe(
    pcm: Float32Array,
    options: Record<string, unknown>,
  ): Promise<WhisperTask>;
  free(): Promise<void>;
}
interface SmartWhisperModule {
  Whisper: new (
    modelPath: string,
    options?: Record<string, unknown>,
  ) => WhisperInstance;
}

let status: SttStatus = "loading";
let progress = 0;
let lastError = "";
let instance: WhisperInstance | null = null;
let mod: SmartWhisperModule | null = null;
let onChange: (() => void) | null = null;
let loadPromise: Promise<void> | null = null;

export function sttState(): { status: SttStatus; progress?: number; error?: string } {
  return {
    status,
    ...(status === "downloading" ? { progress } : {}),
    ...(lastError ? { error: lastError } : {}),
  };
}

export function sttReady(): boolean {
  return status === "ready";
}

function setStatus(next: SttStatus, error = ""): void {
  status = next;
  lastError = error;
  onChange?.();
}

function modelPath(): string {
  return path.join(app.getPath("userData"), "models", getConfig().whisperModel);
}

function modelUrl(): string {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${getConfig().whisperModel}`;
}

function loadModule(): boolean {
  if (mod) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("smart-whisper") as SmartWhisperModule;
    return true;
  } catch (err) {
    console.error("[sunflower] smart-whisper unavailable:", err);
    setStatus(
      "disabled",
      "native whisper module unavailable — reinstall with pnpm install.",
    );
    return false;
  }
}

function download(url: string, dest: string, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error("too many redirects"));
      return;
    }
    https
      .get(url, (res) => {
        const { statusCode = 0, headers } = res;
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume();
          download(headers.location, dest, redirects + 1).then(resolve, reject);
          return;
        }
        if (statusCode !== 200) {
          res.resume();
          reject(new Error(`model download: HTTP ${statusCode}`));
          return;
        }
        const total = Number(headers["content-length"] ?? 0);
        let received = 0;
        const file = createWriteStream(dest);
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (total > 0) {
            const next = Math.floor((received / total) * 100);
            if (next !== progress) {
              progress = next;
              onChange?.();
            }
          }
        });
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", reject);
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

/** Télécharge le modèle si absent puis charge whisper (idempotent). */
export function ensureStt(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    if (!loadModule()) return;
    const dest = modelPath();
    if (!existsSync(dest)) {
      mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.part`;
      progress = 0;
      setStatus("downloading");
      try {
        await download(modelUrl(), tmp);
        renameSync(tmp, dest);
      } catch (err) {
        await rm(tmp, { force: true });
        setStatus(
          "absent",
          `couldn't download the voice model: ${String(
            err instanceof Error ? err.message : err,
          )}`,
        );
        loadPromise = null;
        return;
      }
    }
    setStatus("loading");
    try {
      instance = new mod!.Whisper(dest, { offload: 300 });
      // Warm-up : une demi-seconde de silence charge le modèle en mémoire.
      await transcribeRaw(new Float32Array(8000));
      setStatus("ready");
    } catch (err) {
      instance = null;
      setStatus(
        "error",
        `whisper couldn't start: ${String(
          err instanceof Error ? err.message : err,
        )}`,
      );
      loadPromise = null;
    }
  })();
  return loadPromise;
}

async function transcribeRaw(pcm: Float32Array): Promise<string> {
  if (!instance) throw new Error("whisper not loaded");
  const task = await instance.transcribe(pcm, {
    language: "en",
    suppress_blank: true,
  });
  const segments = await task.result;
  return segments
    .map((s) => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ré-échantillonnage linéaire vers 16 kHz. */
function resampleTo16k(pcm: Float32Array, rate: number): Float32Array {
  if (rate === 16000) return pcm;
  const outLength = Math.floor((pcm.length * 16000) / rate);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = (i * rate) / 16000;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, pcm.length - 1);
    const frac = pos - i0;
    out[i] = (pcm[i0] ?? 0) * (1 - frac) + (pcm[i1] ?? 0) * frac;
  }
  return out;
}

export async function transcribe(
  pcm: Float32Array,
  sampleRate: number,
): Promise<string> {
  if (!sttReady()) throw new Error("stt not ready");
  const input = resampleTo16k(pcm, sampleRate);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("transcription took too long")),
      45_000,
    );
  });
  try {
    return await Promise.race([transcribeRaw(input), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function onSttChange(cb: () => void): void {
  onChange = cb;
}

export async function freeStt(): Promise<void> {
  if (instance) {
    try {
      await instance.free();
    } catch {
      // fermeture — rien à faire
    }
    instance = null;
  }
}
