/** Internal phases of the state machine (main process). */
export type AppPhase =
  | "idle"
  | "listening"
  | "processing"
  | "thinking"
  | "responding";

/** States displayed by the island (prototype surface 1c). */
export type IslandState =
  | "idle"
  | "listening"
  | "reading"
  | "thinking"
  | "acting"
  | "answering"
  | "error";

/** Poses of the sunflower companion (prototype surface 1d). */
export type CompanionPose =
  | "idle"
  | "listening"
  | "thinking"
  | "answering"
  | "pointing";

export type PermissionId =
  | "microphone"
  | "accessibility"
  | "screen"
  | "screenContent";

export type PermissionStatus = "granted" | "denied" | "not-determined";

export type SttStatus =
  | "ready"
  | "loading"
  | "downloading"
  | "absent"
  | "error"
  | "disabled";

export interface StatePayload {
  island: IslandState;
  pose: CompanionPose;
  /** Error message (`error` state) or action label. */
  message?: string;
}

export interface PanelData {
  permissions: Record<PermissionId, PermissionStatus>;
  model: {
    host: string;
    name: string;
    reachable: boolean;
    pulled: boolean;
  };
  stt: {
    status: SttStatus;
    /** Model download progress, 0..100. */
    progress?: number;
    error?: string;
    model: string;
  };
  hotkeyAvailable: boolean;
  version: string;
}
