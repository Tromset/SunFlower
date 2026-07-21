import { BrowserWindow, app, ipcMain } from "electron";
import { CH, type MicDataPayload, type MicErrorCode } from "../shared/ipc";
import type { PanelData, PermissionId } from "../shared/state";
import { getConfig, setConfig } from "./config-store";
import { hotkeyAvailable, initHotkey, stopHotkey } from "./hotkey";
import { chat, checkOllama, warmModel } from "./ollama";
import {
  permissionStatuses,
  requestPermission,
  screenGranted,
} from "./permissions";
import { captureScreenAtCursor } from "./screenshot";
import {
  createSessionMachine,
  type SessionMachine,
} from "./state-machine";
import {
  ensureStt,
  freeStt,
  onSttChange,
  sttReady,
  sttState,
  transcribe,
} from "./stt";
import { createTray, trayBounds } from "./tray";
import { createTui, type TuiStatusInfo } from "./tui";
import { createCompanionWindow, startCursorFollow } from "./windows/companion";
import { createIslandWindow } from "./windows/island";
import { createOnboardingWindow } from "./windows/onboarding";
import { createPanelWindow, togglePanel } from "./windows/panel";
import {
  createPointerWindow,
  hidePointer,
  showPointerAt,
} from "./windows/pointer";

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  void main();
}

async function main(): Promise<void> {
  await app.whenReady();
  if (process.platform === "darwin") app.dock?.hide();

  // Interface terminal (bannière, phases, saisie clavier). Sans TTY, simple
  // logs préfixés — l'app packagée ne change pas.
  const tui = createTui();
  const tuiInfo = (d: PanelData): TuiStatusInfo => ({
    host: d.model.host,
    model: d.model.name,
    reachable: d.model.reachable,
    pulled: d.model.pulled,
    whisperModel: d.stt.model,
    sttStatus: d.stt.status,
    hotkeyAvailable: d.hotkeyAvailable,
    version: d.version,
  });

  let island: BrowserWindow | null = null;
  let companion: BrowserWindow | null = null;
  let pointer: BrowserWindow | null = null;
  let panel: BrowserWindow | null = null;
  let onboarding: BrowserWindow | null = null;
  let machine: SessionMachine | null = null;
  let stopFollow: (() => void) | null = null;
  let quitting = false;

  const sendTo = (
    win: BrowserWindow | null,
    channel: string,
    ...args: unknown[]
  ) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  };

  // ---- Statut agrégé (panneau + onboarding) ----------------------------
  const buildPanelData = async (): Promise<PanelData> => ({
    permissions: permissionStatuses(),
    model: await checkOllama(),
    stt: { ...sttState(), model: getConfig().whisperModel },
    hotkeyAvailable: hotkeyAvailable(),
    version: app.getVersion(),
  });

  let statusTimer: NodeJS.Timeout | null = null;
  const pushStatus = async () => {
    const targets = [panel, onboarding].filter(
      (w): w is BrowserWindow => !!w && !w.isDestroyed() && w.isVisible(),
    );
    if (targets.length === 0) return;
    const data = await buildPanelData();
    for (const w of targets) sendTo(w, CH.panelData, data);
  };
  const ensureStatusLoop = () => {
    if (statusTimer) return;
    statusTimer = setInterval(() => {
      void pushStatus();
      const anyVisible =
        (panel?.isVisible() ?? false) || (onboarding?.isVisible() ?? false);
      if (!anyVisible && statusTimer) {
        clearInterval(statusTimer);
        statusTimer = null;
      }
    }, 3000);
  };
  // onSttChange est mono-abonné : étendre CE callback, pas en ajouter un.
  onSttChange(() => {
    void pushStatus();
    tui.refreshStt(sttState());
  });

  const showMainSurfaces = () => {
    island?.showInactive();
    companion?.showInactive();
    if (!stopFollow && companion) stopFollow = startCursorFollow(companion);
  };

  // ---- IPC : enregistré AVANT les fenêtres (les renderers appellent
  // getStatus dès leur chargement) -------------------------------------
  ipcMain.on(CH.micData, (_e, payload: MicDataPayload) => {
    const pcm =
      payload.pcm instanceof Float32Array
        ? payload.pcm
        : new Float32Array(payload.pcm);
    machine?.onMicData(pcm, payload.sampleRate);
  });
  ipcMain.on(CH.micError, (_e, payload: { code: MicErrorCode }) =>
    machine?.onMicError(payload.code),
  );
  ipcMain.on(CH.ttsEnded, () => machine?.onTtsEnded());
  ipcMain.handle(CH.permissionsGet, () => permissionStatuses());
  ipcMain.handle(CH.permissionsRequest, async (_e, id: PermissionId) => {
    await requestPermission(id);
    void pushStatus();
  });
  ipcMain.handle(CH.statusGet, () => buildPanelData());
  ipcMain.handle(CH.configGet, () => getConfig());
  ipcMain.handle(CH.configSet, (_e, patch) => setConfig(patch));
  ipcMain.handle(CH.whisperDownload, () => {
    void ensureStt();
  });
  ipcMain.handle(CH.appQuit, () => {
    app.quit();
  });
  ipcMain.handle(CH.onboardingDone, () => {
    setConfig({ onboarded: true });
    if (onboarding && !onboarding.isDestroyed()) {
      onboarding.removeAllListeners("closed");
      onboarding.close();
      onboarding = null;
    }
    showMainSurfaces();
    void ensureStt();
  });

  // ---- Fenêtres --------------------------------------------------------
  island = await createIslandWindow();
  companion = await createCompanionWindow();
  pointer = await createPointerWindow();
  panel = await createPanelWindow();
  panel.on("show", () => {
    void pushStatus();
    ensureStatusLoop();
  });

  machine = createSessionMachine({
    broadcast: (payload) => {
      sendTo(island, CH.state, payload);
      sendTo(companion, CH.state, payload);
      tui.state(payload);
    },
    micStart: () => sendTo(island, CH.micStart),
    micStop: () => sendTo(island, CH.micStop),
    capture: captureScreenAtCursor,
    transcribe,
    sttReady,
    screenGranted,
    chat: (opts) => chat({ ...opts, onStatus: (s) => tui.chatStatus(s) }),
    answerReset: () => sendTo(companion, CH.answerReset),
    answerToken: (text) => {
      sendTo(companion, CH.answerToken, text);
      tui.answerToken(text);
    },
    answerDone: (full) => {
      sendTo(companion, CH.answerDone, full);
      tui.answerDone();
    },
    ttsStop: () => sendTo(companion, CH.ttsStop),
    onQuestion: (q, source) => tui.question(q, source),
    onSessionError: (ctx, err) => tui.sessionError(ctx, err),
    showPoint: (point, display) => {
      if (pointer) showPointerAt(pointer, point.xPct, point.yPct, display.bounds);
    },
    hidePoint: () => {
      if (pointer) hidePointer(pointer);
    },
  });

  // ---- Tray + hotkey ---------------------------------------------------
  createTray({
    onClick: (bounds) => {
      if (panel) togglePanel(panel, bounds);
      ensureStatusLoop();
    },
    onQuit: () => app.quit(),
  });
  // Pas de push-to-talk tant que l'accueil n'est pas terminé.
  initHotkey({
    onDown: () => {
      if (!onboarding) {
        // Le modèle se charge pendant que l'utilisateur parle.
        warmModel();
        machine?.hotkeyDown();
      }
    },
    onUp: () => {
      if (!onboarding) machine?.hotkeyUp();
    },
  });

  // ---- Premier lancement ----------------------------------------------
  if (!getConfig().onboarded) {
    onboarding = await createOnboardingWindow();
    onboarding.on("show", () => {
      void pushStatus();
      ensureStatusLoop();
    });
    // Fermer l'accueil sans le terminer = quitter l'app.
    onboarding.on("closed", () => {
      if (!getConfig().onboarded) app.quit();
    });
    ensureStatusLoop();
  } else {
    showMainSurfaces();
    void ensureStt();
  }

  // ---- Terminal : bannière, préchauffage du modèle, prompt -------------
  void (async () => {
    const data = await buildPanelData();
    tui.banner(tuiInfo(data));
    if (data.model.reachable && data.model.pulled) warmModel();
    tui.startRepl({
      submit: (q) => (onboarding ? false : (machine?.askText(q) ?? false)),
      interrupt: () => machine?.interrupt(),
      quit: () => app.quit(),
      isBusy: () => machine?.busy() ?? false,
    });
  })();

  // ---- Cycle de vie ----------------------------------------------------
  app.on("second-instance", () => {
    const bounds = trayBounds();
    if (panel && bounds && !panel.isVisible()) togglePanel(panel, bounds);
  });
  app.on("window-all-closed", () => {
    // App accessoire : elle vit dans la barre de menus.
  });
  app.on("before-quit", () => {
    if (quitting) return;
    quitting = true;
    tui.dispose();
    machine?.interrupt();
    stopFollow?.();
    stopHotkey();
    void freeStt();
  });
}
