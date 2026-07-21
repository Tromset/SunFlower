// Session orchestrator: idle → listening → reading → thinking → answering.
// One flight at a time (monotonic sessionId); every async continuation
// checks it is not stale before acting.
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
  /** Last session whose mic audio was already consumed (one-shot). */
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
    deps.broadcast({ island: "idle", pose: "idle" });
  };

  const fail = (message: string) => {
    const id = ++seq;
    phase = "idle";
    clearTimers();
    // Voice and pointer must never survive an error.
    deps.ttsStop();
    deps.hidePoint();
    deps.broadcast({ island: "error", pose: "idle", message });
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
      fail("screen capture failed — check the permission.");
      return;
    }
    let question: string;
    try {
      question = await deps.transcribe(pcm, sampleRate);
    } catch (err) {
      console.error("[sunflower] transcription:", err);
      if (id === seq) fail("transcription failed.");
      return;
    }
    if (id !== seq) return;
    if (!question) {
      fail("I didn't hear anything.");
      return;
    }
    console.log(`[sunflower] question: ${question}`);
    phase = "thinking";
    deps.broadcast({ island: "thinking", pose: "thinking" });
    deps.answerReset();
    abort = new AbortController();
    const parser = createPointParser({
      onText: (text) => {
        if (id === seq) deps.answerToken(text);
      },
      onPoint: (point) => {
        if (id !== seq) return;
        deps.showPoint(point, shot.display);
        deps.broadcast({ island: "answering", pose: "pointing" });
        if (pointPoseTimer) clearTimeout(pointPoseTimer);
        pointPoseTimer = setTimeout(() => {
          if (id === seq && phase === "responding") {
            deps.broadcast({ island: "answering", pose: "answering" });
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
            deps.broadcast({ island: "answering", pose: "answering" });
          }
          parser.push(text);
        },
      });
      if (id !== seq) return;
      parser.flush();
      if (!full.trim()) {
        fail("I couldn't find anything to say.");
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
      console.error("[sunflower] ollama:", err);
      fail(
        err instanceof OllamaFailure
          ? err.userMessage
          : "something went wrong.",
      );
    }
  };

  return {
    hotkeyDown() {
      if (phase !== "idle" && phase !== "listening") interrupt();
      seq++;
      if (phase === "listening") return;
      if (!deps.sttReady()) {
        fail("voice unavailable — open the sunflower panel.");
        return;
      }
      clearTimers();
      phase = "listening";
      pressedAt = Date.now();
      deps.broadcast({ island: "listening", pose: "listening" });
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
        fail("allow screen recording in the sunflower panel.");
        return;
      }
      // Capture immediately: the screen is still in the state the user describes.
      capturePromise = deps.capture();
      phase = "processing";
      deps.broadcast({ island: "reading", pose: "thinking" });
      deps.micStop();
      const id = seq;
      micTimer = setTimeout(() => {
        if (id === seq && phase === "processing") {
          fail("the mic sent nothing.");
        }
      }, 10_000);
    },
    onMicData(pcm, sampleRate) {
      // One-shot per session: a second micData (a late-cancelled session,
      // a duplicate) must never launch a second runSession with the same seq.
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
          ? "allow the microphone in the sunflower panel."
          : "the mic didn't respond.",
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
