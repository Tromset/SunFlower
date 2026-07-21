// Orchestrateur de session : idle → écoute → lecture → réflexion → réponse.
// Un seul vol à la fois (sessionId monotone) ; toute continuation async
// vérifie qu'elle n'est pas périmée avant d'agir.
import type { Display } from "electron";
import type { AppPhase, StatePayload } from "../shared/state";
import type { MicErrorCode } from "../shared/ipc";
import {
  OllamaFailure,
  OllamaUserInterrupt,
  type ChatOptions,
} from "./ollama";
import {
  createPointParser,
  stripPointMarkers,
  type PointEvent,
} from "./point-parser";
import type { Screenshot } from "./screenshot";

export interface MachineDeps {
  broadcast(payload: StatePayload): void;
  micStart(): void;
  micStop(): void;
  capture(): Promise<Screenshot | null>;
  transcribe(pcm: Float32Array, sampleRate: number): Promise<string>;
  sttReady(): boolean;
  screenGranted(): boolean;
  chat(opts: ChatOptions): Promise<string>;
  answerReset(): void;
  answerToken(text: string): void;
  answerDone(full: string): void;
  ttsStop(): void;
  showPoint(point: PointEvent, display: Display): void;
  hidePoint(): void;
}

export interface SessionMachine {
  hotkeyDown(): void;
  hotkeyUp(): void;
  onMicData(pcm: Float32Array, sampleRate: number): void;
  onMicError(code: MicErrorCode): void;
  onTtsEnded(): void;
  interrupt(): void;
}

const MIN_HOLD_MS = 300;
const ERROR_MS = 2600;
const TTS_FAILSAFE_MS = 90_000;

export function createSessionMachine(deps: MachineDeps): SessionMachine {
  let phase: AppPhase = "idle";
  let seq = 0;
  /** Dernière session dont l'audio micro a déjà été consommé (one-shot). */
  let micSeen = -1;
  let abort: AbortController | null = null;
  let pressedAt = 0;
  let capturePromise: Promise<Screenshot | null> | null = null;
  let errorTimer: NodeJS.Timeout | null = null;
  let failsafeTimer: NodeJS.Timeout | null = null;
  let pointPoseTimer: NodeJS.Timeout | null = null;
  let micTimer: NodeJS.Timeout | null = null;

  const clearTimers = () => {
    for (const t of [errorTimer, failsafeTimer, pointPoseTimer, micTimer]) {
      if (t) clearTimeout(t);
    }
    errorTimer = failsafeTimer = pointPoseTimer = micTimer = null;
  };

  const toIdle = () => {
    phase = "idle";
    clearTimers();
    deps.broadcast({ island: "veille", pose: "veille" });
  };

  const fail = (message: string) => {
    const id = ++seq;
    phase = "idle";
    clearTimers();
    // La voix et le pointeur ne doivent jamais survivre à une erreur.
    deps.ttsStop();
    deps.hidePoint();
    deps.broadcast({ island: "erreur", pose: "veille", message });
    errorTimer = setTimeout(() => {
      if (id === seq) toIdle();
    }, ERROR_MS);
  };

  const interrupt = () => {
    abort?.abort();
    abort = null;
    deps.ttsStop();
    deps.hidePoint();
    clearTimers();
  };

  const runSession = async (
    id: number,
    pcm: Float32Array,
    sampleRate: number,
  ) => {
    const shot = await capturePromise;
    if (id !== seq) return;
    if (!shot) {
      fail("la capture d'écran a échoué — vérifiez la permission.");
      return;
    }
    let question: string;
    try {
      question = await deps.transcribe(pcm, sampleRate);
    } catch (err) {
      console.error("[sunflower] transcription :", err);
      if (id === seq) fail("la transcription a échoué.");
      return;
    }
    if (id !== seq) return;
    if (!question) {
      fail("je n'ai rien entendu.");
      return;
    }
    console.log(`[sunflower] question : ${question}`);
    phase = "thinking";
    deps.broadcast({ island: "reflexion", pose: "reflexion" });
    deps.answerReset();
    abort = new AbortController();
    const parser = createPointParser({
      onText: (text) => {
        if (id === seq) deps.answerToken(text);
      },
      onPoint: (point) => {
        if (id !== seq) return;
        deps.showPoint(point, shot.display);
        deps.broadcast({ island: "reponse", pose: "pointage" });
        if (pointPoseTimer) clearTimeout(pointPoseTimer);
        pointPoseTimer = setTimeout(() => {
          if (id === seq && phase === "responding") {
            deps.broadcast({ island: "reponse", pose: "reponse" });
          }
        }, 4000);
      },
    });
    let first = true;
    try {
      const full = await deps.chat({
        question,
        imageB64: shot.imageB64,
        signal: abort.signal,
        onToken: (text) => {
          if (id !== seq) return;
          if (first) {
            first = false;
            phase = "responding";
            deps.broadcast({ island: "reponse", pose: "reponse" });
          }
          parser.push(text);
        },
      });
      if (id !== seq) return;
      parser.flush();
      if (!full.trim()) {
        fail("je n'ai pas trouvé quoi répondre.");
        return;
      }
      deps.answerDone(stripPointMarkers(full));
      phase = "responding";
      failsafeTimer = setTimeout(() => {
        if (id === seq) {
          deps.ttsStop();
          toIdle();
        }
      }, TTS_FAILSAFE_MS);
    } catch (err) {
      if (id !== seq || err instanceof OllamaUserInterrupt) return;
      console.error("[sunflower] ollama :", err);
      fail(
        err instanceof OllamaFailure
          ? err.userMessage
          : "quelque chose s'est mal passé.",
      );
    }
  };

  return {
    hotkeyDown() {
      if (phase !== "idle" && phase !== "listening") interrupt();
      seq++;
      if (phase === "listening") return;
      if (!deps.sttReady()) {
        fail("voix indisponible — ouvrez le panneau sunflower.");
        return;
      }
      clearTimers();
      phase = "listening";
      pressedAt = Date.now();
      deps.broadcast({ island: "ecoute", pose: "ecoute" });
      deps.micStart();
    },
    hotkeyUp() {
      if (phase !== "listening") return;
      if (Date.now() - pressedAt < MIN_HOLD_MS) {
        seq++;
        deps.micStop();
        toIdle();
        return;
      }
      if (!deps.screenGranted()) {
        seq++;
        deps.micStop();
        fail("autorisez l'enregistrement d'écran dans le panneau sunflower.");
        return;
      }
      // Capture immédiate : l'écran est encore dans l'état que l'utilisateur décrit.
      capturePromise = deps.capture();
      phase = "processing";
      deps.broadcast({ island: "lecture", pose: "reflexion" });
      deps.micStop();
      const id = seq;
      micTimer = setTimeout(() => {
        if (id === seq && phase === "processing") {
          fail("le micro n'a rien envoyé.");
        }
      }, 10_000);
    },
    onMicData(pcm, sampleRate) {
      // One-shot par session : un second micData (session annulée en retard,
      // doublon) ne doit jamais lancer un second runSession avec le même seq.
      if (phase !== "processing" || micSeen === seq) return;
      micSeen = seq;
      if (micTimer) {
        clearTimeout(micTimer);
        micTimer = null;
      }
      void runSession(seq, pcm, sampleRate);
    },
    onMicError(code) {
      if (phase !== "listening" && phase !== "processing") return;
      seq++;
      fail(
        code === "denied"
          ? "autorisez le microphone dans le panneau sunflower."
          : "le micro n'a pas répondu.",
      );
    },
    onTtsEnded() {
      if (phase === "responding") toIdle();
    },
    interrupt() {
      seq++;
      interrupt();
      toIdle();
    },
  };
}
