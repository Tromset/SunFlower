import type {
  PanelData,
  PermissionId,
  PermissionStatus,
  StatePayload,
} from "./state";
import type { SunflowerConfig } from "./config-schema";

/** Canaux main → renderer (webContents.send). */
export const CH = {
  state: "sf:state",
  micStart: "sf:mic-start",
  micStop: "sf:mic-stop",
  answerReset: "sf:answer-reset",
  answerToken: "sf:answer-token",
  answerDone: "sf:answer-done",
  ttsStop: "sf:tts-stop",
  pointShow: "sf:point-show",
  panelData: "sf:panel-data",
  flip: "sf:flip",
  // renderer → main (send)
  micData: "sf:mic-data",
  micError: "sf:mic-error",
  ttsEnded: "sf:tts-ended",
  // renderer → main (invoke)
  permissionsGet: "sf:permissions:get",
  permissionsRequest: "sf:permissions:request",
  statusGet: "sf:status:get",
  configGet: "sf:config:get",
  configSet: "sf:config:set",
  whisperDownload: "sf:whisper:download",
  onboardingDone: "sf:onboarding:done",
  appQuit: "sf:app:quit",
} as const;

export interface MicDataPayload {
  pcm: Float32Array;
  sampleRate: number;
}

export type MicErrorCode = "denied" | "failed";

type Unsubscribe = () => void;

/** Surface exposée aux renderers par le preload (window.sunflower). */
export interface SunflowerBridge {
  onState(cb: (s: StatePayload) => void): Unsubscribe;
  onMicStart(cb: () => void): Unsubscribe;
  onMicStop(cb: () => void): Unsubscribe;
  onAnswerReset(cb: () => void): Unsubscribe;
  onAnswerToken(cb: (text: string) => void): Unsubscribe;
  onAnswerDone(cb: (full: string) => void): Unsubscribe;
  onTtsStop(cb: () => void): Unsubscribe;
  onPointShow(cb: () => void): Unsubscribe;
  onPanelData(cb: (d: PanelData) => void): Unsubscribe;
  onFlip(cb: (side: "left" | "right") => void): Unsubscribe;
  sendMicData(pcm: Float32Array, sampleRate: number): void;
  sendMicError(code: MicErrorCode): void;
  sendTtsEnded(): void;
  getStatus(): Promise<PanelData>;
  getPermissions(): Promise<Record<PermissionId, PermissionStatus>>;
  requestPermission(id: PermissionId): Promise<void>;
  getConfig(): Promise<SunflowerConfig>;
  setConfig(patch: Partial<SunflowerConfig>): Promise<SunflowerConfig>;
  downloadWhisper(): Promise<void>;
  onboardingDone(): Promise<void>;
  quit(): Promise<void>;
}

declare global {
  interface Window {
    sunflower: SunflowerBridge;
  }
}
