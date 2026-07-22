// Agents de code en arrière-plan (même famille de boucle qu'Ollama-Code) :
// une file de tâches, un agent à la fois, des tours itératifs contre Ollama
// avec un prompt de codage. Le modèle peut demander à LIRE des fichiers
// (lignes « READ: chemin ») puis termine par des blocs ```file:chemin
// contenant le contenu complet proposé. Le runner en extrait une proposition
// {path, before, after} — JAMAIS écrite sur disque ici : l'application est
// exclusivement déclenchée par decide(), fichier par fichier, depuis la revue.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { checkOllama, ollamaHost } from "../ollama";
import type {
  AgentDecision,
  AgentFileChange,
  AgentRun,
  AgentRunSummary,
  AgentTranscriptEntry,
} from "../../shared/agents";

// ---- Garde-fous --------------------------------------------------------
const MAX_TURNS = 8; // tours modèle par agent
const MAX_READS_PER_TURN = 4; // fichiers servis par tour
const MAX_READ_BYTES = 16_000; // au-delà, contenu tronqué
const MAX_PROPOSAL_FILES = 10; // fichiers max dans une proposition
const MAX_LISTING_ENTRIES = 150; // arborescence initiale
const TURN_TIMEOUT_MS = 300_000; // chargement à froid possible
// Contexte plus large que le tchat écran (8192) : les tours accumulent des
// fichiers. Le runner Ollama redémarre en changeant de num_ctx — acceptable
// pour un travail d'arrière-plan.
const NUM_CTX = 16_384;
const NUM_PREDICT = 2048; // par tour ; borne aussi le coût total (× MAX_TURNS)

const SYSTEM_PROMPT = [
  "You are sunflower's background coding agent. You run fully locally and work in turns on ONE task inside ONE project folder.",
  "You can NEVER touch the disk: you only propose changes, and a human reviews then accepts or denies each file.",
  "To inspect existing files before deciding, reply with ONLY read requests, one per line, nothing else:",
  "READ: relative/path/to/file",
  "When you know exactly what to change, reply with one short sentence explaining the change, followed by one fenced block PER FILE containing the COMPLETE new content of that file (never a fragment, never a diff):",
  "```file:relative/path/to/file",
  "...entire file content...",
  "```",
  "Rules: no shell commands, no tools, no markdown outside the formats above. Paths are relative to the project folder; never use .. or absolute paths. Keep the changes minimal and focused on the task. Never claim the changes are applied.",
].join("\n");

// ---- Parsing des réponses du modèle -------------------------------------
const FILE_BLOCK_RE =
  /```(?:[a-zA-Z0-9_+-]*[ \t]+)?file:[ \t]*([^\n`]+)\n([\s\S]*?)\n?```/g;
const READ_LINE_RE = /^READ:[ \t]*(.+?)[ \t]*$/gm;

function parseFileBlocks(text: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  for (const m of text.matchAll(FILE_BLOCK_RE)) {
    const p = (m[1] ?? "").trim().replace(/^\.\//, "");
    if (p) out.push({ path: p, content: m[2] ?? "" });
  }
  return out;
}

function parseReads(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(READ_LINE_RE)) {
    const p = (m[1] ?? "").trim().replace(/^\.\//, "");
    if (p) out.push(p);
  }
  return out.slice(0, MAX_READS_PER_TURN);
}

/** Supprime les blocs <think>…</think> (réponse non streamée). */
function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

// ---- Sécurité chemins ----------------------------------------------------
/** Résout un chemin relatif DANS le dossier de travail ; null s'il s'en
 *  échappe (.. ou absolu) — même garde-fou qu'Ollama-Code. */
function safeResolve(workdir: string, rel: string): string | null {
  if (path.isAbsolute(rel)) return null;
  const abs = path.resolve(workdir, rel);
  const root = path.resolve(workdir);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "target", "out"]);

/** Arborescence peu profonde pour ancrer le premier tour du modèle. */
function listFiles(workdir: string): string[] {
  const entries: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (entries.length >= MAX_LISTING_ENTRIES || depth > 3) return;
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (entries.length >= MAX_LISTING_ENTRIES) return;
      if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
      const abs = path.join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      const rel = path.relative(workdir, abs);
      if (st.isDirectory()) {
        entries.push(`${rel}/`);
        walk(abs, depth + 1);
      } else {
        entries.push(rel);
      }
    }
  };
  walk(workdir, 0);
  return entries;
}

/** Sert les fichiers demandés par des lignes READ (lecture seule, bornée). */
function renderReads(workdir: string, reads: string[]): string {
  const parts: string[] = [];
  for (const rel of reads) {
    const abs = safeResolve(workdir, rel);
    if (!abs || path.basename(abs) === ".env") {
      parts.push(`READ ${rel}: refused (outside the project folder).`);
      continue;
    }
    if (!existsSync(abs)) {
      parts.push(`READ ${rel}: file not found.`);
      continue;
    }
    try {
      let content = readFileSync(abs, "utf8");
      let note = "";
      if (content.length > MAX_READ_BYTES) {
        content = content.slice(0, MAX_READ_BYTES);
        note = "\n[...truncated...]";
      }
      parts.push(`READ ${rel}:\n\`\`\`\n${content}${note}\n\`\`\``);
    } catch {
      parts.push(`READ ${rel}: unreadable.`);
    }
  }
  return parts.join("\n\n");
}

// ---- Appel Ollama (non streamé : travail d'arrière-plan) -----------------
async function agentChat(
  messages: AgentTranscriptEntry[],
  signal: AbortSignal,
): Promise<string> {
  const status = await checkOllama();
  if (!status.reachable) {
    throw new Error("ollama can't be reached — run ollama serve.");
  }
  if (!status.pulled) {
    throw new Error(`model missing — ollama pull ${status.name}`);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TURN_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(`${ollamaHost()}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: status.name,
        stream: false,
        think: false,
        keep_alive: "10m",
        options: {
          temperature: 0.2,
          num_ctx: NUM_CTX,
          num_predict: NUM_PREDICT,
        },
        messages,
      }),
    });
    if (!res.ok) throw new Error(`ollama responded ${res.status}.`);
    const data = (await res.json()) as {
      message?: { content?: string };
      error?: string;
    };
    if (data.error) throw new Error(`ollama: ${data.error}`);
    return stripThink(data.message?.content ?? "");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

// ---- Runner ---------------------------------------------------------------
export interface AgentRunnerDeps {
  /** Un agent a changé d'état (liste du panneau à rafraîchir). */
  onUpdate(run: AgentRun): void;
  /** Un agent vient de se terminer (notification + île si repos). */
  onFinished(run: AgentRun): void;
  /** La file est passée active ↔ inactive (pose du compagnon au repos). */
  onRunningChange(running: boolean): void;
}

export interface AgentRunner {
  /** Enfile une tâche ; l'exécution démarre dès que la file est libre. */
  start(task: string, workdir: string): AgentRunSummary;
  list(): AgentRunSummary[];
  get(id: string): AgentRun | null;
  /** Revue explicite : accept ⇒ écrit le fichier ; deny ⇒ rien. */
  decide(id: string, filePath: string, decision: AgentDecision): AgentRun | null;
  /** Annule un agent en file ou en cours (idempotent). */
  cancel(id: string): void;
  running(): boolean;
  dispose(): void;
}

export function createAgentRunner(deps: AgentRunnerDeps): AgentRunner {
  const runs: AgentRun[] = [];
  const aborts = new Map<string, AbortController>();
  let active: AgentRun | null = null;
  let wasRunning = false;
  let counter = 0;

  const summary = (r: AgentRun): AgentRunSummary => ({
    id: r.id,
    task: r.task,
    workdir: r.workdir,
    status: r.status,
    createdAt: r.createdAt,
    ...(r.finishedAt !== undefined ? { finishedAt: r.finishedAt } : {}),
    ...(r.error !== undefined ? { error: r.error } : {}),
    files: r.proposal.length,
    decided: Object.keys(r.decisions).length,
  });

  const setRunning = (running: boolean) => {
    if (running === wasRunning) return;
    wasRunning = running;
    deps.onRunningChange(running);
  };

  const pump = () => {
    if (active) return;
    const next = runs.find((r) => r.status === "queued");
    if (!next) {
      setRunning(false);
      return;
    }
    active = next;
    setRunning(true);
    void execute(next).finally(() => {
      active = null;
      pump();
    });
  };

  const execute = async (run: AgentRun): Promise<void> => {
    const ctrl = new AbortController();
    aborts.set(run.id, ctrl);
    run.status = "running";
    deps.onUpdate(run);
    try {
      const listing = listFiles(run.workdir).join("\n");
      const push = (entry: AgentTranscriptEntry) => run.transcript.push(entry);
      push({ role: "system", content: SYSTEM_PROMPT });
      push({
        role: "user",
        content: `Task: ${run.task}\n\nProject folder listing:\n${listing || "(empty folder)"}`,
      });
      let nudged = false;
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const answer = await agentChat(run.transcript, ctrl.signal);
        if (ctrl.signal.aborted) throw new Error("cancelled");
        push({ role: "assistant", content: answer });
        const blocks = parseFileBlocks(answer);
        if (blocks.length > 0) {
          const proposal: AgentFileChange[] = [];
          for (const b of blocks.slice(0, MAX_PROPOSAL_FILES)) {
            const abs = safeResolve(run.workdir, b.path);
            if (!abs) continue; // chemin hors dossier : ignoré
            const before = existsSync(abs) ? readFileSync(abs, "utf8") : null;
            const after = b.content.endsWith("\n")
              ? b.content
              : `${b.content}\n`;
            proposal.push({ path: b.path, before, after });
          }
          if (proposal.length === 0) {
            run.status = "failed";
            run.error = "the model only proposed paths outside the folder.";
          } else {
            run.proposal = proposal;
            run.status = "awaiting-review";
          }
          return;
        }
        const reads = parseReads(answer);
        if (reads.length > 0) {
          push({ role: "user", content: renderReads(run.workdir, reads) });
          continue;
        }
        if (!nudged && turn < MAX_TURNS - 1) {
          // Un seul rappel de format ; ensuite la réponse libre fait foi.
          nudged = true;
          push({
            role: "user",
            content:
              "Reply ONLY with READ: lines to inspect files, or with ```file:path fenced blocks holding the complete proposed content.",
          });
          continue;
        }
        // Réponse libre assumée : rien à proposer (question, explication…).
        run.status = "done";
        return;
      }
      run.status = "failed";
      run.error = "turn limit reached without a proposal.";
    } catch (err) {
      run.status = "failed";
      run.error = ctrl.signal.aborted
        ? "cancelled."
        : err instanceof Error
          ? err.message
          : "something went wrong.";
    } finally {
      aborts.delete(run.id);
      run.finishedAt = Date.now();
      deps.onUpdate(run);
      deps.onFinished(run);
    }
  };

  return {
    start(task, workdir) {
      const dir = path.resolve(workdir);
      const run: AgentRun = {
        id: `a${Date.now().toString(36)}-${++counter}`,
        task: task.trim(),
        workdir: dir,
        status: "queued",
        createdAt: Date.now(),
        transcript: [],
        proposal: [],
        decisions: {},
      };
      if (!run.task) {
        run.status = "failed";
        run.error = "empty task.";
        run.finishedAt = Date.now();
      } else if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        run.status = "failed";
        run.error = "folder not found.";
        run.finishedAt = Date.now();
      }
      runs.unshift(run);
      deps.onUpdate(run);
      pump();
      return summary(run);
    },
    list() {
      return runs.map(summary);
    },
    get(id) {
      return runs.find((r) => r.id === id) ?? null;
    },
    decide(id, filePath, decision) {
      const run = runs.find((r) => r.id === id);
      if (!run || run.status !== "awaiting-review") return run ?? null;
      const change = run.proposal.find((c) => c.path === filePath);
      if (!change || run.decisions[filePath]) return run;
      if (decision === "accepted") {
        // SEUL point d'écriture disque de tout le système d'agents.
        const abs = safeResolve(run.workdir, change.path);
        if (!abs) return run; // défensif : déjà filtré à la proposition
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, change.after);
      }
      run.decisions[filePath] = decision;
      if (Object.keys(run.decisions).length >= run.proposal.length) {
        run.status = "done";
      }
      deps.onUpdate(run);
      return run;
    },
    cancel(id) {
      const run = runs.find((r) => r.id === id);
      if (!run) return;
      if (run.status === "queued") {
        run.status = "failed";
        run.error = "cancelled.";
        run.finishedAt = Date.now();
        deps.onUpdate(run);
      } else if (run.status === "running") {
        aborts.get(id)?.abort();
      }
    },
    running() {
      return active !== null;
    },
    dispose() {
      for (const ctrl of aborts.values()) ctrl.abort();
    },
  };
}
