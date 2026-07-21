/** Phases internes de la machine à états (processus main). */
export type AppPhase =
  | "idle"
  | "listening"
  | "processing"
  | "thinking"
  | "responding";

/** États affichés par l'îlot (surface 1c du prototype). */
export type IslandState =
  | "veille"
  | "ecoute"
  | "lecture"
  | "reflexion"
  | "action"
  | "reponse"
  | "erreur";

/** Poses du compagnon tournesol (surface 1d du prototype). */
export type CompanionPose =
  | "veille"
  | "ecoute"
  | "reflexion"
  | "reponse"
  | "pointage";

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
  /** Message d'erreur (état `erreur`) ou libellé d'action. */
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
    /** Progression du téléchargement du modèle, 0..100. */
    progress?: number;
    error?: string;
    model: string;
  };
  hotkeyAvailable: boolean;
  version: string;
}
