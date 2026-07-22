import { contextBridge, ipcRenderer } from "electron";
import { CH, type MicErrorCode, type SunflowerBridge } from "../shared/ipc";
import type { PermissionId } from "../shared/state";
import type { SunflowerConfig } from "../shared/config-schema";
import type {
  AgentCommandDecision,
  AgentDecision,
} from "../shared/agents";

function on(
  channel: string,
  cb: (...args: unknown[]) => void,
): () => void {
  const listener = (_event: unknown, ...args: unknown[]) => cb(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const bridge: SunflowerBridge = {
  onState: (cb) => on(CH.state, cb as (...a: unknown[]) => void),
  onMicStart: (cb) => on(CH.micStart, cb),
  onMicStop: (cb) => on(CH.micStop, cb),
  onAnswerReset: (cb) => on(CH.answerReset, cb),
  onAnswerToken: (cb) => on(CH.answerToken, cb as (...a: unknown[]) => void),
  onAnswerDone: (cb) => on(CH.answerDone, cb as (...a: unknown[]) => void),
  onTtsStop: (cb) => on(CH.ttsStop, cb),
  onPointShow: (cb) => on(CH.pointShow, cb),
  onGuideStep: (cb) => on(CH.guideStep, cb as (...a: unknown[]) => void),
  onPanelData: (cb) => on(CH.panelData, cb as (...a: unknown[]) => void),
  onFlip: (cb) => on(CH.flip, cb as (...a: unknown[]) => void),
  sendMicData: (pcm: Float32Array, sampleRate: number) =>
    ipcRenderer.send(CH.micData, { pcm, sampleRate }),
  sendMicError: (code: MicErrorCode) =>
    ipcRenderer.send(CH.micError, { code }),
  sendTtsEnded: () => ipcRenderer.send(CH.ttsEnded),
  getStatus: () => ipcRenderer.invoke(CH.statusGet),
  getPermissions: () => ipcRenderer.invoke(CH.permissionsGet),
  requestPermission: (id: PermissionId) =>
    ipcRenderer.invoke(CH.permissionsRequest, id),
  getConfig: () => ipcRenderer.invoke(CH.configGet),
  setConfig: (patch: Partial<SunflowerConfig>) =>
    ipcRenderer.invoke(CH.configSet, patch),
  downloadWhisper: () => ipcRenderer.invoke(CH.whisperDownload),
  onboardingDone: () => ipcRenderer.invoke(CH.onboardingDone),
  quit: () => ipcRenderer.invoke(CH.appQuit),
  onAgentsChanged: (cb) =>
    on(CH.agentsChanged, cb as (...a: unknown[]) => void),
  onAgentEvent: (cb) => on(CH.agentEvent, cb as (...a: unknown[]) => void),
  onPanelFocusAgents: (cb) => on(CH.panelFocusAgents, cb),
  agentsList: () => ipcRenderer.invoke(CH.agentsList),
  agentStart: (task: string, workdir: string, allowCommands: boolean) =>
    ipcRenderer.invoke(CH.agentStart, task, workdir, allowCommands),
  agentGet: (id: string) => ipcRenderer.invoke(CH.agentGet, id),
  agentDecide: (id: string, path: string, decision: AgentDecision) =>
    ipcRenderer.invoke(CH.agentDecide, id, path, decision),
  agentCommand: (
    id: string,
    commandId: number,
    decision: AgentCommandDecision,
  ) => ipcRenderer.invoke(CH.agentCommand, id, commandId, decision),
  agentCancel: (id: string) => ipcRenderer.invoke(CH.agentCancel, id),
  // Petit rond des agents (voir main/windows/agent-orb.ts).
  onAgentOrbReset: (cb: () => void) =>
    on(CH.agentOrbReset, cb as (...a: unknown[]) => void),
  agentOrbHoverStart: () => ipcRenderer.send(CH.agentOrbHoverStart),
  agentOrbHoverEnd: () => ipcRenderer.send(CH.agentOrbHoverEnd),
  agentOrbDragStart: (screenY: number) =>
    ipcRenderer.send(CH.agentOrbDragStart, screenY),
  agentOrbDragMove: (screenY: number) =>
    ipcRenderer.send(CH.agentOrbDragMove, screenY),
  agentOrbDragEnd: (screenY: number) =>
    ipcRenderer.send(CH.agentOrbDragEnd, screenY),
  agentOrbOpen: () => ipcRenderer.invoke(CH.agentOrbOpen),
  // Compagnon dockable (voir main/windows/companion.ts).
  onCompanionDocked: (cb) =>
    on(CH.companionDocked, cb as (...a: unknown[]) => void),
  companionSetHover: (hovering: boolean) =>
    ipcRenderer.send(CH.companionHover, hovering),
  companionToggleDock: () => ipcRenderer.invoke(CH.companionToggleDock),
};

contextBridge.exposeInMainWorld("sunflower", bridge);
