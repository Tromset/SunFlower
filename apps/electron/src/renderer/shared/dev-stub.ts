// Bridge stub to open the surfaces in a plain browser (development/design).
// In Electron, the preload provides the real bridge.
import type { SunflowerBridge } from "../../shared/ipc";
import type { PanelData } from "../../shared/state";

const SAMPLE: PanelData = {
  permissions: {
    microphone: "granted",
    accessibility: "granted",
    screen: "granted",
    screenContent: "granted",
  },
  model: {
    host: "http://localhost:11434",
    name: "qwen3-vl:8b",
    reachable: true,
    pulled: true,
  },
  stt: { status: "ready", model: "ggml-small-q5_1.bin" },
  hotkeyAvailable: true,
  version: "0.1.0",
};

type Listener = (...args: never[]) => void;

export function ensureBridge(): void {
  if (window.sunflower) return;
  const listeners = new Map<string, Listener[]>();
  const sub =
    (name: string) =>
    (cb: Listener): (() => void) => {
      const list = listeners.get(name) ?? [];
      list.push(cb);
      listeners.set(name, list);
      return () => {};
    };
  // Dev console: __sfDev.emit("state", {island:"listening", pose:"listening"})
  (window as unknown as Record<string, unknown>)["__sfDev"] = {
    emit(name: string, ...args: unknown[]) {
      for (const cb of listeners.get(name) ?? []) {
        (cb as (...a: unknown[]) => void)(...args);
      }
    },
  };
  const stub: SunflowerBridge = {
    onState: sub("state"),
    onMicStart: sub("micStart"),
    onMicStop: sub("micStop"),
    onAnswerReset: sub("answerReset"),
    onAnswerToken: sub("answerToken"),
    onAnswerDone: sub("answerDone"),
    onTtsStop: sub("ttsStop"),
    onPointShow: sub("pointShow"),
    onGuideStep: sub("guideStep"),
    onPanelData: sub("panelData"),
    onFlip: sub("flip"),
    sendMicData: () => {},
    sendMicError: () => {},
    sendTtsEnded: () => {},
    getStatus: () => Promise.resolve(SAMPLE),
    getPermissions: () => Promise.resolve(SAMPLE.permissions),
    requestPermission: () => Promise.resolve(),
    getConfig: () =>
      Promise.resolve({
        onboarded: false,
        ollamaHost: "http://localhost:11434",
        ollamaModel: "qwen3-vl:8b",
        whisperModel: "ggml-small-q5_1.bin",
        screenCaptureConfirmed: true,
      }),
    setConfig: (patch) =>
      Promise.resolve({
        onboarded: false,
        ollamaHost: "http://localhost:11434",
        ollamaModel: "qwen3-vl:8b",
        whisperModel: "ggml-small-q5_1.bin",
        screenCaptureConfirmed: true,
        ...patch,
      }),
    downloadWhisper: () => Promise.resolve(),
    onboardingDone: () => Promise.resolve(),
    quit: () => Promise.resolve(),
  };
  window.sunflower = stub;
}
