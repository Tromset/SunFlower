// Interface terminal de sunflower : bannière, phases, réponse streamée et
// prompt de saisie clavier. Zéro dépendance, ANSI fait main ; module sans
// electron (imports runtime : node:readline) donc testable en node pur.
// Sans TTY (app packagée, sortie redirigée), retombe sur des lignes de log
// préfixées [sunflower] — le contrat historique des logs.
import { createInterface, type Interface } from "node:readline";
import type { StatePayload, SttStatus } from "../shared/state";
import type { ChatStatus } from "./ollama";
import type { QuestionSource } from "./state-machine";

export interface TuiStatusInfo {
  host: string;
  model: string;
  reachable: boolean;
  pulled: boolean;
  whisperModel: string;
  sttStatus: SttStatus;
  hotkeyAvailable: boolean;
  version: string;
}

export interface SttInfo {
  status: SttStatus;
  progress?: number;
  error?: string;
}

export interface ReplHandlers {
  /** Question soumise (non vide). false = refusée (occupé), un hint s'affiche. */
  submit(question: string): boolean;
  interrupt(): void;
  quit(): void;
  isBusy(): boolean;
}

export interface Tui {
  /** Bannière de démarrage : tournesol + bloc statut. */
  banner(info: TuiStatusInfo): void;
  /** Ligne d'état voix (téléchargement/chargement whisper), sur transition. */
  refreshStt(stt: SttInfo): void;
  /** Branché sur broadcast() : phases, erreurs, retour au prompt à idle. */
  state(payload: StatePayload): void;
  /** Question prête (la version tapée est déjà visible au prompt). */
  question(text: string, source: QuestionSource): void;
  /** Statut du chat (ex. chargement à froid du modèle). */
  chatStatus(status: ChatStatus): void;
  /** Token de réponse, streamé brut vers le terminal. */
  answerToken(text: string): void;
  /** Fin de réponse : ligne de durée. */
  answerDone(): void;
  /** Budget de contexte atteint : un tchat neuf démarre. */
  contextReset(tokens: number): void;
  /** Étape de guide annoncée (le prompt reste actif pendant un guide). */
  guideStep(index: number, total: number, text: string): void;
  /** Détail d'erreur — visible seulement avec SUNFLOWER_DEBUG=1. */
  sessionError(context: string, err: unknown): void;
  /** Ligne libre, écrite proprement au-dessus du prompt/spinner. */
  log(line: string): void;
  /** Démarre le prompt de saisie (no-op sans TTY). */
  startRepl(handlers: ReplHandlers): void;
  /** Stoppe spinner + readline, restaure le curseur. */
  dispose(): void;
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const CLEAR_LINE = "\r\x1b[2K";

export function createTui(streams?: {
  out?: NodeJS.WriteStream;
  input?: NodeJS.ReadStream;
}): Tui {
  const out = streams?.out ?? process.stdout;
  const input = streams?.input ?? process.stdin;
  const fancy = out.isTTY === true && process.env["NO_COLOR"] === undefined;
  const debug = process.env["SUNFLOWER_DEBUG"] === "1";

  const paint = (code: string) => (s: string) =>
    fancy ? `\x1b[${code}m${s}\x1b[0m` : s;
  const yellow = paint("33");
  const green = paint("32");
  const red = paint("31");
  const cyan = paint("36");
  const dim = paint("2");
  const bold = paint("1");

  let rl: Interface | null = null;
  let handlers: ReplHandlers | null = null;
  let disposed = false;
  /** Une session occupe le terminal : pas de prompt tant que vrai. */
  let busyUi = false;
  let lastIsland: StatePayload["island"] | null = null;
  let lastStt: SttStatus | null = null;
  /** Réponse en cours d'écriture brute (pas de retour ligne encore). */
  let streaming = false;
  /** Préfixe « sunflower — » déjà écrit pour cette réponse. */
  let sawToken = false;
  /** Départ du chrono de réponse (phase thinking). */
  let t0 = 0;
  /** Tokens bufferisés en mode non-TTY, vidés à answerDone. */
  let pending = "";

  // ---- Spinner ---------------------------------------------------------
  let spinnerTimer: NodeJS.Timeout | null = null;
  let spinnerLabel = "";
  let spinnerStart = 0;
  let frameIdx = 0;

  const renderSpinner = () => {
    const frame = FRAMES[frameIdx % FRAMES.length] ?? "⠋";
    frameIdx++;
    const secs = ((Date.now() - spinnerStart) / 1000).toFixed(1);
    out.write(`${CLEAR_LINE}${yellow(frame)} ${spinnerLabel} ${dim(`${secs}s`)}`);
  };
  const startSpinner = (label: string) => {
    spinnerLabel = label;
    if (!fancy || spinnerTimer) return;
    spinnerStart = Date.now();
    out.write("\x1b[?25l"); // cacher le curseur
    spinnerTimer = setInterval(renderSpinner, 80);
    renderSpinner();
  };
  const stopSpinner = () => {
    if (!spinnerTimer) return;
    clearInterval(spinnerTimer);
    spinnerTimer = null;
    out.write(`${CLEAR_LINE}\x1b[?25h`);
  };

  // ---- Écriture unique : préserve spinner, prompt et stream ------------
  const showPrompt = () => {
    if (rl && !busyUi && !disposed) rl.prompt(true);
  };
  const writeLine = (line: string) => {
    if (disposed) return;
    if (!fancy) {
      out.write(`${line}\n`);
      return;
    }
    if (streaming) {
      out.write("\n"); // termine proprement la ligne streamée
      streaming = false;
    } else {
      out.write(CLEAR_LINE); // efface spinner ou ligne de prompt
    }
    out.write(`${line}\n`);
    if (spinnerTimer) renderSpinner();
    else showPrompt();
  };

  // ---- Bannière --------------------------------------------------------
  const banner = (info: TuiStatusInfo) => {
    if (!fancy) {
      out.write(
        `[sunflower] v${info.version} — ${info.model} @ ${info.host}` +
          ` (${info.reachable ? "reachable" : "unreachable"})\n`,
      );
      return;
    }
    const art = [
      yellow("      \\ | /"),
      `${yellow("    ── (")}${bold(yellow("✿"))}${yellow(") ──")}`,
      yellow("      / | \\"),
      green("        |"),
    ];
    const head = [
      "",
      `${bold("sunflower")} ${dim(`v${info.version}`)}`,
      dim("your 100 % local screen companion"),
      "",
    ];
    const lines = art.map((a, i) => `${a}\x1b[16G${head[i] ?? ""}`);
    const kv = (key: string, value: string) =>
      `   ${dim(key.padEnd(8))}${value}`;
    const modelNote = info.pulled
      ? green("ok")
      : red(`missing — run: ollama pull ${info.model}`);
    const ollamaNote = info.reachable
      ? green("ok")
      : red("not running — run: ollama serve");
    const hotkeyNote = info.hotkeyAvailable
      ? "hold ⌃⌥ and speak — or type a question below"
      : red("unavailable — grant accessibility in the panel");
    out.write(
      [
        "",
        ...lines,
        "",
        kv("model", `${info.model} ${dim("·")} ${modelNote}`),
        kv("ollama", `${info.host} ${dim("·")} ${ollamaNote}`),
        kv("voice", `${info.whisperModel} ${dim("·")} ${sttLabel(info.sttStatus)}`),
        kv("hotkey", hotkeyNote),
        "",
        "",
      ].join("\n"),
    );
    showPrompt();
  };

  const sttLabel = (status: SttStatus): string => {
    switch (status) {
      case "ready":
        return green("ready");
      case "loading":
        return "loading…";
      case "downloading":
        return "downloading…";
      case "absent":
        return red("model missing");
      case "error":
        return red("error");
      case "disabled":
        return red("unavailable");
    }
  };

  // ---- Voix (whisper) --------------------------------------------------
  const refreshStt = (stt: SttInfo) => {
    if (!fancy || stt.status === lastStt) return;
    lastStt = stt.status;
    switch (stt.status) {
      case "downloading":
        writeLine(`${cyan("◐")} voice — downloading the whisper model…`);
        break;
      case "ready":
        writeLine(`${green("●")} voice ready — hold ⌃⌥ and speak`);
        break;
      case "absent":
      case "error":
      case "disabled":
        writeLine(`${red("✗")} voice — ${stt.error ?? "unavailable"}`);
        break;
      case "loading":
        break; // transitoire, pas d'affichage
    }
  };

  // ---- Phases de session ----------------------------------------------
  const state = (payload: StatePayload) => {
    if (disposed) return;
    const island = payload.island;
    if (!fancy) {
      busyUi = island !== "idle";
      if (island === "error") {
        out.write(
          `[sunflower] error: ${payload.message ?? "something went wrong."}\n`,
        );
      }
      lastIsland = island;
      return;
    }
    if (island === lastIsland && island !== "error") return;
    lastIsland = island;
    switch (island) {
      case "idle":
        busyUi = false;
        stopSpinner();
        if (streaming) {
          out.write("\n");
          streaming = false;
        }
        sawToken = false;
        showPrompt();
        break;
      case "listening":
        busyUi = true;
        stopSpinner();
        writeLine(`${cyan("●")} listening…`);
        break;
      case "reading":
        busyUi = true;
        writeLine(`${cyan("◐")} looking at your screen…`);
        break;
      case "thinking":
        busyUi = true;
        t0 = Date.now();
        sawToken = false;
        pending = "";
        startSpinner("thinking…");
        break;
      case "answering":
        busyUi = true;
        stopSpinner(); // le préfixe s'écrit au premier token
        break;
      case "acting":
        busyUi = true;
        break;
      case "guiding":
        // Prompt actif : taper une question annule le guide en cours.
        busyUi = false;
        stopSpinner();
        if (streaming) {
          out.write("\n");
          streaming = false;
        }
        sawToken = false;
        showPrompt();
        break;
      case "error": {
        busyUi = true; // l'idle qui suit ramènera le prompt
        stopSpinner();
        writeLine(`${red("✗")} ${payload.message ?? "something went wrong."}`);
        break;
      }
    }
  };

  // ---- Question et réponse --------------------------------------------
  const question = (text: string, source: QuestionSource) => {
    if (!fancy) {
      out.write(`[sunflower] question: ${text}\n`);
      return;
    }
    // Tapée : déjà visible, c'est la ligne échoée au prompt.
    if (source === "voice") {
      writeLine(`${yellow("❯")} ${bold("you")} ${dim("—")} ${text}`);
    }
  };

  const chatStatus = (status: ChatStatus) => {
    if (status !== "loading-model") return;
    if (!fancy) {
      out.write("[sunflower] waking the model…\n");
      return;
    }
    spinnerLabel = "waking the model…";
    if (!spinnerTimer) startSpinner(spinnerLabel);
  };

  const answerToken = (text: string) => {
    if (disposed) return;
    if (!fancy) {
      pending += text;
      return;
    }
    if (!sawToken) {
      sawToken = true;
      stopSpinner();
      out.write(`${yellow("sunflower")} ${dim("—")} `);
      streaming = true;
    }
    out.write(text);
  };

  const answerDone = () => {
    if (disposed) return;
    if (!fancy) {
      out.write(`[sunflower] answer: ${pending}\n`);
      pending = "";
      return;
    }
    stopSpinner(); // défensif : réponse sans aucun token affiché
    if (streaming) {
      out.write("\n");
      streaming = false;
    }
    sawToken = false;
    const secs = t0 > 0 ? ((Date.now() - t0) / 1000).toFixed(1) : "?";
    writeLine(dim(`✓ answered in ${secs}s`));
  };

  const contextReset = (tokens: number) => {
    const label = `${(tokens / 1000).toFixed(1)}k context tokens — starting a fresh chat`;
    if (!fancy) {
      out.write(`[sunflower] ${label}\n`);
      return;
    }
    writeLine(`${yellow("✦")} ${dim(label)}`);
  };

  const guideStep = (index: number, total: number, text: string) => {
    if (disposed) return;
    if (!fancy) {
      out.write(`[sunflower] step ${index}/${total}: ${text}\n`);
      return;
    }
    writeLine(`${yellow("➤")} ${dim(`step ${index}/${total}`)} ${text}`);
  };

  const sessionError = (context: string, err: unknown) => {
    // Le message utilisateur arrive via l'état « error » ; ici, seulement
    // le détail technique, sur demande.
    if (!debug) return;
    const detail =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    writeLine(dim(`[debug] ${context}: ${detail}`));
  };

  // ---- REPL ------------------------------------------------------------
  const startRepl = (h: ReplHandlers) => {
    if (disposed || rl) return;
    if (input.isTTY !== true || out.isTTY !== true) return;
    handlers = h;
    rl = createInterface({
      input,
      output: out,
      prompt: `${yellow("❯")} `,
      terminal: true,
    });
    rl.on("line", (raw) => {
      const q = raw.trim();
      if (!q) {
        showPrompt();
        return;
      }
      if (!handlers?.submit(q)) {
        writeLine(
          dim("sunflower is busy — wait for the answer (Ctrl+C interrupts)."),
        );
      }
    });
    rl.on("SIGINT", () => {
      if (handlers?.isBusy()) {
        handlers.interrupt();
        writeLine(dim("interrupted."));
      } else {
        writeLine(dim("bye."));
        handlers?.quit();
      }
    });
    // Ctrl+D : fermer proprement l'app, sauf si c'est nous qui fermons.
    rl.on("close", () => {
      if (!disposed) handlers?.quit();
    });
    showPrompt();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
    if (fancy) out.write(`${CLEAR_LINE}\x1b[?25h`);
    rl?.close();
    rl = null;
  };

  return {
    banner,
    refreshStt,
    state,
    question,
    chatStatus,
    answerToken,
    answerDone,
    contextReset,
    guideStep,
    sessionError,
    log: (line: string) => writeLine(line),
    startRepl,
    dispose,
  };
}
