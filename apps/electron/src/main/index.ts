import { BrowserWindow, Notification, app, ipcMain, screen } from "electron";
import { CH, type MicDataPayload, type MicErrorCode } from "../shared/ipc";
import type { PanelData, PermissionId, StatePayload } from "../shared/state";
import type {
  AgentCommandDecision,
  AgentDecision,
} from "../shared/agents";
import { createAgentRunner, type AgentRunner } from "./agents/runner";
import {
  createAgentOrbController,
  createAgentOrbWindow,
  type AgentOrbController,
} from "./windows/agent-orb";
import { getConfig, setConfig } from "./config-store";
import { createGuideRunner } from "./guide-runner";
import {
  hotkeyAvailable,
  initHotkey,
  mouseHookAvailable,
  onGlobalMouseDown,
  stopHotkey,
} from "./hotkey";
import { chat, checkOllama, onContextReset, warmModel } from "./ollama";
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
import { createWatchdog } from "./watchdog";
import { createWorkRunner, type WorkRunner } from "./work/runner";
import {
  createCompanionController,
  createCompanionWindow,
  type CompanionController,
} from "./windows/companion";
import { createIslandVisibility, createIslandWindow } from "./windows/island";
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

  // Traceur de ressources (CPU/RSS) en tâche de fond : pour attribuer un
  // futur pic (capture écran, whisper.cpp, fenêtre oubliée, Ollama emballé)
  // au lieu de deviner. Voir watchdog.ts pour les détails.
  const watchdog = createWatchdog();

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
  let islandVisibility: ReturnType<typeof createIslandVisibility> | null =
    null;
  let companion: BrowserWindow | null = null;
  let pointer: BrowserWindow | null = null;
  let panel: BrowserWindow | null = null;
  let onboarding: BrowserWindow | null = null;
  let machine: SessionMachine | null = null;
  let companionCtl: CompanionController | null = null;
  let agentRunner: AgentRunner | null = null;
  let workRunner: WorkRunner | null = null;
  let orb: BrowserWindow | null = null;
  let orbCtl: AgentOrbController | null = null;
  let quitting = false;

  const sendTo = (
    win: BrowserWindow | null,
    channel: string,
    ...args: unknown[]
  ) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  };

  // Clic sur le rond des agents : ouvrir le panneau et le placer sur l'onglet
  // agents (le renderer du panneau est chargé dès le démarrage, même masqué).
  const openPanelOnAgents = () => {
    const bounds = trayBounds();
    if (panel && bounds && !panel.isVisible()) togglePanel(panel, bounds);
    sendTo(panel, CH.panelFocusAgents);
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
  // Budget de contexte atteint : le tchat repart de zéro, dire pourquoi.
  onContextReset((tokens) => tui.contextReset(tokens));

  const showMainSurfaces = () => {
    // L'île reste masquée à idle : sa visibilité est pilotée par les états
    // diffusés (voir broadcastIsland ci-dessous), pas par ce démarrage.
    companion?.showInactive();
    if (!companionCtl && companion) {
      companionCtl = createCompanionController(companion);
      // Mode persisté : redémarrer docké si l'utilisateur l'avait garé.
      if (getConfig().companionMode === "docked") {
        companionCtl.setDocked(true);
      }
    }
  };

  // Dock du compagnon : bascule partagée tray / double-clic sur la fleur,
  // persistée dans la config (survit aux redémarrages).
  const setCompanionDocked = (dockedMode: boolean) => {
    setConfig({ companionMode: dockedMode ? "docked" : "follow" });
    companionCtl?.setDocked(dockedMode);
  };
  const toggleCompanionDock = () => {
    setCompanionDocked(getConfig().companionMode !== "docked");
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
  // Agents de code : toute écriture disque passe par agentDecide (accept),
  // toute exécution de commande par agentCommand (approve) — jamais sans clic.
  ipcMain.handle(CH.agentsList, () => agentRunner?.list() ?? []);
  ipcMain.handle(
    CH.agentStart,
    (_e, task: string, workdir: string, allowCommands: boolean) =>
      agentRunner?.start(String(task), String(workdir), Boolean(allowCommands)),
  );
  ipcMain.handle(CH.agentGet, (_e, id: string) => agentRunner?.get(id) ?? null);
  ipcMain.handle(
    CH.agentDecide,
    (_e, id: string, filePath: string, decision: AgentDecision) =>
      agentRunner?.decide(id, filePath, decision) ?? null,
  );
  ipcMain.handle(
    CH.agentCommand,
    (_e, id: string, commandId: number, decision: AgentCommandDecision) =>
      agentRunner?.decideCommand(
        String(id),
        Number(commandId),
        decision === "approved" ? "approved" : "denied",
      ) ?? null,
  );
  ipcMain.handle(CH.agentCancel, (_e, id: string) => {
    agentRunner?.cancel(id);
  });
  // Rond des agents : survol (élargir), glisser vertical (repositionner),
  // clic (ouvrir le panneau). Voir windows/agent-orb.ts.
  ipcMain.on(CH.agentOrbHoverStart, () => orbCtl?.setExpanded(true));
  ipcMain.on(CH.agentOrbHoverEnd, () => orbCtl?.setExpanded(false));
  ipcMain.on(CH.agentOrbDragStart, (_e, y: number) =>
    orbCtl?.dragStart(Number(y)),
  );
  ipcMain.on(CH.agentOrbDragMove, (_e, y: number) =>
    orbCtl?.dragMove(Number(y)),
  );
  ipcMain.on(CH.agentOrbDragEnd, (_e, y: number) => orbCtl?.dragEnd(Number(y)));
  ipcMain.handle(CH.agentOrbOpen, () => {
    openPanelOnAgents();
  });
  // Compagnon : survol de la fleur → fenêtre interactive (double-clic
  // possible) ; hors survol, elle redevient traversée par la souris.
  ipcMain.on(CH.companionHover, (_e, hovering: boolean) => {
    if (companion && !companion.isDestroyed()) {
      companion.setIgnoreMouseEvents(!hovering, { forward: true });
    }
  });
  ipcMain.handle(CH.companionToggleDock, () => {
    toggleCompanionDock();
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
  islandVisibility = createIslandVisibility(island);
  // Envoi de l'état à l'île + pilotage de sa visibilité (masquée à idle,
  // affichée dès qu'on en sort, avec délai de grâce au retour — voir
  // windows/island.ts). Point de passage unique utilisé par la machine à
  // états et par l'ambiance des agents en arrière-plan.
  const broadcastIsland = (payload: StatePayload) => {
    sendTo(island, CH.state, payload);
    islandVisibility?.setState(payload.island);
  };
  companion = await createCompanionWindow();
  pointer = await createPointerWindow();
  panel = await createPanelWindow();
  panel.on("show", () => {
    void pushStatus();
    ensureStatusLoop();
  });
  // Rond des agents : masqué au repos, affiché le temps qu'un agent tourne
  // (piloté par agentRunner.onRunningChange plus bas).
  orb = await createAgentOrbWindow();
  orbCtl = createAgentOrbController(orb);

  // Exécuteur de guides : purement géométrique, aucun appel IA par étape.
  const guideRunner = createGuideRunner({
    cursor: () => screen.getCursorScreenPoint(),
    showPoint: (xPct, yPct, bounds) => {
      if (pointer) showPointerAt(pointer, xPct, yPct, bounds, { sticky: true });
    },
    hidePoint: () => {
      if (pointer) hidePointer(pointer);
    },
    flyTo: (target) => companionCtl?.flyTo(target),
    hold: () => companionCtl?.hold(),
    follow: () => companionCtl?.follow(),
    onMouseDown: onGlobalMouseDown,
    clicksAvailable: mouseHookAvailable,
  });

  // Dernier état ambiant d'un run de travail : ré-émis quand la session
  // vocale retombe au repos pour que la phase « waiting for you to step
  // away… » (diffusée pendant que la machine est occupée) reste visible.
  let lastWorkAmbient: StatePayload | null = null;
  machine = createSessionMachine({
    broadcast: (payload) => {
      const p =
        payload.island === "idle" && workRunner?.active() && lastWorkAmbient
          ? lastWorkAmbient
          : payload;
      broadcastIsland(p);
      sendTo(companion, CH.state, p);
      tui.state(p);
    },
    micStart: () => sendTo(island, CH.micStart),
    micStop: () => sendTo(island, CH.micStop),
    capture: captureScreenAtCursor,
    transcribe,
    sttReady,
    screenGranted,
    // SUNFLOWER_FAKE_ANSWER (dev) : rejoue un texte comme si le modèle le
    // streamait — test du parseur/guide de bout en bout sans Ollama.
    chat: process.env["SUNFLOWER_FAKE_ANSWER"]
      ? async (opts) => {
          const text = process.env["SUNFLOWER_FAKE_ANSWER"] as string;
          for (const piece of text.match(/.{1,8}/gs) ?? []) {
            opts.onToken(piece);
            await new Promise((r) => setTimeout(r, 25));
          }
          return text;
        }
      : (opts) => chat({ ...opts, onStatus: (s) => tui.chatStatus(s) }),
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
    guideStart: (guide, display, cb) => guideRunner.start(guide, display, cb),
    guideCancel: () => guideRunner.cancel(),
    guideStep: (payload) => {
      sendTo(companion, CH.guideStep, payload);
      tui.guideStep(payload.index, payload.total, payload.text);
    },
    // Sunflower Work : opt-in explicite (tray), pilotage remis au runner.
    workEnabled: () => getConfig().sunflowerWorkEnabled,
    workStart: (task) => workRunner?.start(task) ?? false,
  });

  // ---- Agents de code en arrière-plan ----------------------------------
  // L'île/le compagnon ne sont touchés qu'au repos : dès qu'une session
  // vocale démarre, la machine à états reprend la main sur l'affichage.
  let agentIdleTimer: NodeJS.Timeout | null = null;
  let agentNote: string | null = null;
  const broadcastAmbient = (payload: StatePayload) => {
    broadcastIsland(payload);
    sendTo(companion, CH.state, payload);
  };
  agentRunner = createAgentRunner({
    onUpdate: () => {
      const runs = agentRunner?.list() ?? [];
      sendTo(panel, CH.agentsChanged, runs);
      // Même charge utile pour le rond : il en tire le titre + l'état courant.
      orbCtl?.setStatus(runs);
    },
    // Événements fins (tours, tokens, lectures, commandes) : le panneau
    // streame le transcript/terminal, le rond en dérive son texte d'état.
    onEvent: (ev) => {
      sendTo(panel, CH.agentEvent, ev);
      orbCtl?.pushEvent(ev);
    },
    onRunningChange: (running) => {
      // Le rond suit l'état de la file, indépendamment d'une session vocale.
      if (running) orbCtl?.show();
      else orbCtl?.hide();
      if (agentIdleTimer) {
        clearTimeout(agentIdleTimer);
        agentIdleTimer = null;
      }
      if (machine?.busy()) return;
      if (running) {
        broadcastAmbient({
          island: "acting",
          // Vignette « coding » : tournesol + portable animé.
          pose: "coding",
          message: "coding agent at work…",
        });
      } else if (agentNote) {
        // Petit mot de fin sur l'île, puis retour au repos.
        broadcastAmbient({ island: "acting", pose: "idle", message: agentNote });
        agentNote = null;
        agentIdleTimer = setTimeout(() => {
          if (
            !machine?.busy() &&
            !agentRunner?.running() &&
            !workRunner?.active()
          ) {
            broadcastAmbient({ island: "idle", pose: "idle" });
          }
        }, 4000);
      } else if (!workRunner?.active()) {
        // Un run de travail encore actif garde la main sur l'affichage.
        broadcastAmbient({ island: "idle", pose: "idle" });
      }
    },
    onFinished: (run) => {
      const short =
        run.task.length > 60 ? `${run.task.slice(0, 57)}…` : run.task;
      const body =
        run.status === "awaiting-review"
          ? `"${short}" — ${run.proposal.length} file(s) to review in the panel.`
          : run.status === "failed"
            ? `"${short}" — failed: ${run.error ?? "unknown error"}`
            : `"${short}" — finished, nothing to apply.`;
      agentNote =
        run.status === "awaiting-review"
          ? "agent finished — review in the panel"
          : run.status === "failed"
            ? "agent failed — see the panel"
            : "agent finished";
      if (Notification.isSupported()) {
        const notif = new Notification({ title: "sunflower agent", body });
        notif.on("click", () => {
          const bounds = trayBounds();
          if (panel && bounds && !panel.isVisible()) togglePanel(panel, bounds);
        });
        notif.show();
      }
    },
  });

  // ---- Sunflower Work : pilotage souris/clavier (opt-in, présence gardée)
  // Même politesse d'affichage que les agents : l'île/le compagnon ne sont
  // touchés qu'au repos — une session vocale reprend toujours la main (et,
  // de toute façon, taper le hotkey est une entrée réelle qui annule le run).
  let workIdleTimer: NodeJS.Timeout | null = null;
  workRunner = createWorkRunner({
    enabled: () => getConfig().sunflowerWorkEnabled,
    broadcast: (payload) => {
      // Mémorisé même quand la machine est occupée : sa retombée au repos
      // ré-émettra ce dernier état (voir machine.broadcast plus haut).
      lastWorkAmbient = payload;
      if (machine?.busy()) return;
      broadcastAmbient(payload);
    },
    onLog: (line) => tui.log(line),
    onFinished: (result) => {
      lastWorkAmbient = null;
      const note =
        result.status === "done"
          ? `work finished — ${result.message}`
          : result.status === "aborted"
            ? `work stopped — ${result.message}`
            : `work failed — ${result.message}`;
      if (!machine?.busy()) {
        broadcastAmbient({ island: "acting", pose: "idle", message: note });
        if (workIdleTimer) clearTimeout(workIdleTimer);
        workIdleTimer = setTimeout(() => {
          if (
            !machine?.busy() &&
            !agentRunner?.running() &&
            !workRunner?.active()
          ) {
            broadcastAmbient({ island: "idle", pose: "idle" });
          }
        }, 4000);
      }
      if (Notification.isSupported()) {
        const short =
          result.task.length > 60 ? `${result.task.slice(0, 57)}…` : result.task;
        new Notification({
          title: "sunflower work",
          body: `"${short}" — ${result.message}`,
        }).show();
      }
    },
  });

  // ---- Tray + hotkey ---------------------------------------------------
  createTray({
    onClick: (bounds) => {
      if (panel) togglePanel(panel, bounds);
      ensureStatusLoop();
    },
    onQuit: () => app.quit(),
    isCompanionDocked: () => getConfig().companionMode === "docked",
    onToggleCompanionDock: toggleCompanionDock,
    isWorkEnabled: () => getConfig().sunflowerWorkEnabled,
    onToggleWork: () => {
      const next = !getConfig().sunflowerWorkEnabled;
      setConfig({ sunflowerWorkEnabled: next });
      // Couper l'interrupteur arrête aussi tout run en cours, sur-le-champ.
      if (!next) workRunner?.cancel("switched off from the tray.");
    },
  });
  // Pas de push-to-talk tant que l'accueil n'est pas terminé.
  initHotkey({
    onDown: () => {
      // Le hotkey est une entrée réelle : un run de travail s'efface devant.
      workRunner?.cancel("you pressed the hotkey — all yours.");
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
      interrupt: () => {
        // Ctrl+C au terminal : la session ET un éventuel run de travail.
        workRunner?.cancel("interrupted.");
        machine?.interrupt();
      },
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
    workRunner?.dispose();
    agentRunner?.dispose();
    companionCtl?.dispose();
    orbCtl?.dispose();
    islandVisibility?.dispose();
    stopHotkey();
    watchdog.dispose();
    void freeStt();
  });
}
