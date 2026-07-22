import type {
  PanelData,
  PermissionId,
  PermissionStatus,
  StatePayload,
} from "./state";
import type { SunflowerConfig } from "./config-schema";
import type {
  AgentDecision,
  AgentRun,
  AgentRunSummary,
} from "./agents";

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
  guideStep: "sf:guide-step",
  panelData: "sf:panel-data",
  flip: "sf:flip",
  agentsChanged: "sf:agents-changed",
  // Le rond des agents demande au panneau de s'ouvrir sur l'onglet agents.
  panelFocusAgents: "sf:panel-focus-agents",
  // Le compagnon passe en badge docké (ou en sort) : le renderer compacte
  // sa mise en page (voir renderer/companion + windows/companion.ts).
  companionDocked: "sf:companion:docked",
  // renderer → main (send)
  micData: "sf:mic-data",
  micError: "sf:mic-error",
  ttsEnded: "sf:tts-ended",
  // Survol de la fleur : la fenêtre du compagnon (sinon traversée par la
  // souris) devient interactive le temps du survol, pour le double-clic.
  companionHover: "sf:companion:hover",
  // main → rond des agents : replie pastille/glisser (fenêtre re-affichée).
  agentOrbReset: "sf:agent-orb:reset",
  // Glisser vertical du rond des agents (voir windows/agent-orb.ts).
  agentOrbHoverStart: "sf:agent-orb:hover-start",
  agentOrbHoverEnd: "sf:agent-orb:hover-end",
  agentOrbDragStart: "sf:agent-orb:drag-start",
  agentOrbDragMove: "sf:agent-orb:drag-move",
  agentOrbDragEnd: "sf:agent-orb:drag-end",
  // renderer → main (invoke)
  permissionsGet: "sf:permissions:get",
  permissionsRequest: "sf:permissions:request",
  statusGet: "sf:status:get",
  configGet: "sf:config:get",
  configSet: "sf:config:set",
  whisperDownload: "sf:whisper:download",
  onboardingDone: "sf:onboarding:done",
  appQuit: "sf:app:quit",
  agentsList: "sf:agents:list",
  agentStart: "sf:agents:start",
  agentGet: "sf:agents:get",
  agentDecide: "sf:agents:decide",
  agentCancel: "sf:agents:cancel",
  agentOrbOpen: "sf:agent-orb:open",
  // Double-clic sur la fleur : bascule follow ↔ docked (persisté en config).
  companionToggleDock: "sf:companion:toggle-dock",
} as const;

export interface MicDataPayload {
  pcm: Float32Array;
  sampleRate: number;
}

export type MicErrorCode = "denied" | "failed";

/** Taille intérieure du cadre de crochets (px fenêtre), envoyée avec
 *  CH.pointShow. Absente : visuel historique par défaut (100×60). */
export interface PointShowPayload {
  w?: number;
  h?: number;
}

/** Étape de guide annoncée au compagnon (bulle + voix). */
export interface GuideStepPayload {
  index: number;
  total: number;
  text: string;
  /** L'utilisateur a déjà agi : couper la voix en cours avant de parler. */
  cut: boolean;
}

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
  onPointShow(cb: (p?: PointShowPayload) => void): Unsubscribe;
  onGuideStep(cb: (p: GuideStepPayload) => void): Unsubscribe;
  onPanelData(cb: (d: PanelData) => void): Unsubscribe;
  onFlip(cb: (side: "left" | "right") => void): Unsubscribe;
  onAgentsChanged(cb: (runs: AgentRunSummary[]) => void): Unsubscribe;
  onPanelFocusAgents(cb: () => void): Unsubscribe;
  /** Le compagnon vient d'être docké (true) ou libéré (false). */
  onCompanionDocked(cb: (docked: boolean) => void): Unsubscribe;
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
  // Agents de code en arrière-plan (revue accept/deny obligatoire).
  agentsList(): Promise<AgentRunSummary[]>;
  agentStart(task: string, workdir: string): Promise<AgentRunSummary>;
  agentGet(id: string): Promise<AgentRun | null>;
  agentDecide(
    id: string,
    path: string,
    decision: AgentDecision,
  ): Promise<AgentRun | null>;
  agentCancel(id: string): Promise<void>;
  // Petit rond des agents en arrière-plan (docké au bord droit de l'écran,
  // visible uniquement le temps qu'un agent tourne — voir windows/agent-orb.ts).
  /** Fenêtre du rond ré-affichée repliée : resynchroniser l'état visuel. */
  onAgentOrbReset(cb: () => void): void;
  agentOrbHoverStart(): void;
  agentOrbHoverEnd(): void;
  agentOrbDragStart(screenY: number): void;
  agentOrbDragMove(screenY: number): void;
  agentOrbDragEnd(screenY: number): void;
  /** Clic (sans glisser) : ouvre le panneau sur l'onglet agents. */
  agentOrbOpen(): Promise<void>;
  /** Survol de la fleur (companion) : rend la fenêtre interactive ou non. */
  companionSetHover(hovering: boolean): void;
  /** Double-clic sur la fleur : bascule follow ↔ docked. */
  companionToggleDock(): Promise<void>;
}

declare global {
  interface Window {
    sunflower: SunflowerBridge;
  }
}
