// Session orchestrator: idle → listening → reading → thinking → answering,
// plus guiding when the model returns a step plan. One flight at a time
// (monotonic sessionId); every async continuation checks it is not stale
// before acting.
import type { Display } from "electron";
import type { AppPhase, StatePayload } from "../shared/state";
import type { GuideStepPayload, MicErrorCode } from "../shared/ipc";
import {
  OllamaFailure,
  OllamaUserInterrupt,
  type ChatOptions,
} from "./ollama";
import {
  createAnswerParser,
  stripMarkers,
  type ParsedGuide,
  type PointEvent,
} from "./guide-parser";
import type { GuideCallbacks } from "./guide-runner";
import type { Screenshot } from "./screenshot";

/** Source d'une question : dictée au micro ou tapée dans le terminal. */
export type QuestionSource = "voice" | "typed";

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
  /** Lance l'exécution scriptée d'un plan de guide (guide-runner). */
  guideStart(guide: ParsedGuide, display: Display, cb: GuideCallbacks): void;
  /** Annule le guide en cours (idempotent). */
  guideCancel(): void;
  /** Étape annoncée : bulle + voix du compagnon, ligne terminal. */
  guideStep(payload: GuideStepPayload): void;
  /** Question prête à partir (affichage terminal). */
  onQuestion?(question: string, source: QuestionSource): void;
  /** Détail d'une erreur de session (diagnostic terminal). */
  onSessionError?(context: "transcription" | "ollama", err: unknown): void;
}

export interface SessionMachine {
  hotkeyDown(): void;
  hotkeyUp(): void;
  onMicData(pcm: Float32Array, sampleRate: number): void;
  onMicError(code: MicErrorCode): void;
  onTtsEnded(): void;
  interrupt(): void;
  /** Question tapée au terminal : capture immédiate puis pipeline partagé
   *  (sans STT). Retourne false si vide ou si une session est en cours —
   *  sauf pendant un guide, qu'elle annule pour repartir normalement. */
  askText(question: string): boolean;
  /** Une session est-elle en cours ? (décision Ctrl+C du terminal) */
  busy(): boolean;
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
    // Voice, pointer and guide must never survive an error.
    deps.guideCancel();
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
    deps.guideCancel();
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
      deps.onSessionError?.("transcription", err);
      if (id === seq) fail("transcription failed.");
      return;
    }
    if (id !== seq) return;
    if (!question) {
      fail("I didn't hear anything.");
      return;
    }
    await runQuestion(id, question, shot, "voice");
  };

  /** Cœur partagé voix/clavier : stream Ollama → parseur POINT → réponse. */
  const runQuestion = async (
    id: number,
    question: string,
    shot: Screenshot,
    source: QuestionSource,
  ) => {
    deps.onQuestion?.(question, source);
    phase = "thinking";
    deps.broadcast({ island: "thinking", pose: "thinking" });
    deps.answerReset();
    abort = new AbortController();
    const parser = createAnswerParser({
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
      deps.answerDone(stripMarkers(full));
      const guide = parser.guide();
      if (guide) {
        // Plan complet reçu : exécution scriptée, plus aucun appel IA.
        phase = "guiding";
        deps.guideStart(guide, shot.display, {
          onStep: (index, total, step, cut) => {
            if (id !== seq) return;
            deps.broadcast({
              island: "guiding",
              pose: "pointing",
              message: `step ${index} of ${total}`,
            });
            deps.guideStep({ index, total, text: step.text, cut });
          },
          onEnd: (reason) => {
            if (id !== seq) return;
            if (reason === "completed") {
              // La clôture emprunte la voie normale de réponse.
              phase = "responding";
              deps.broadcast({ island: "answering", pose: "answering" });
              deps.answerReset();
              const bye = guide.outro ?? "All done.";
              deps.answerToken(bye);
              deps.answerDone(bye);
              failsafeTimer = setTimeout(() => {
                if (id === seq) {
                  deps.ttsStop();
                  toIdle();
                }
              }, TTS_FAILSAFE_MS);
            } else {
              deps.ttsStop();
              toIdle();
            }
          },
        });
        return;
      }
      phase = "responding";
      failsafeTimer = setTimeout(() => {
        if (id === seq) {
          deps.ttsStop();
          toIdle();
        }
      }, TTS_FAILSAFE_MS);
    } catch (err) {
      if (id !== seq || err instanceof OllamaUserInterrupt) return;
      deps.onSessionError?.("ollama", err);
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
    askText(question) {
      const q = question.trim();
      if (!q || (phase !== "idle" && phase !== "guiding")) return false;
      // Une question tapée en plein guide l'annule et repart normalement.
      if (phase === "guiding") interrupt();
      if (!deps.screenGranted()) {
        fail("allow screen recording in the sunflower panel.");
        return true; // pris en charge : l'erreur s'affiche
      }
      const id = ++seq;
      clearTimers();
      phase = "processing";
      deps.broadcast({ island: "reading", pose: "thinking" });
      // Capture immédiate, sans toucher capturePromise/micSeen (voie vocale).
      void (async () => {
        const shot = await deps.capture();
        if (id !== seq) return;
        if (!shot) {
          fail("screen capture failed — check the permission.");
          return;
        }
        await runQuestion(id, q, shot, "typed");
      })();
      return true;
    },
    busy() {
      return phase !== "idle";
    },
  };
}
