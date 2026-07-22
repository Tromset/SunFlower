// Watchdog de ressources : échantillonne CPU/RSS à intervalle régulier et
// journalise en JSONL dans ~/Library/Application Support/sunflower/watchdog/
// — objectif : si la machine chauffe/rame, on a une trace de quel processus
// (capture écran, whisper.cpp, fenêtre BrowserWindow oubliée, Ollama qui
// s'emballe) au lieu de deviner après coup.
//
// Contraintes : overhead quasi nul (un seul timer, écriture disque async
// tamponnée — jamais de fs synchrone sur le chemin chaud), ne doit jamais
// lever d'exception, et ne doit pas retenir le process en vie à la sortie
// (timer .unref() + arrêt explicite sur before-quit).
import { BrowserWindow, app } from "electron";
import {
  appendFile,
  mkdir,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";

const SAMPLE_INTERVAL_MS = 5_000;
const HIGH_CPU_PCT = 300; // % cumulé (100 = un cœur plein) façon app.getAppMetrics
const HIGH_CPU_SUSTAIN_MS = 30_000;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // ~5 Mo tous fichiers confondus
const MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // quelques jours d'historique
const PRUNE_EVERY_N_FLUSHES = 12; // ~1 min à 5 s/échantillon

interface WatchdogHandle {
  dispose(): void;
}

function watchdogDir(): string {
  return path.join(app.getPath("userData"), "watchdog");
}

function activeLogFile(): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(watchdogDir(), `watchdog-${today}.jsonl`);
}

/** Supprime les fichiers trop vieux ou en trop pour rester sous le budget. */
async function pruneOldFiles(): Promise<void> {
  try {
    const dir = watchdogDir();
    const names = (await readdir(dir)).filter(
      (n) => n.startsWith("watchdog-") && n.endsWith(".jsonl"),
    );
    const entries = await Promise.all(
      names.map(async (name) => {
        const full = path.join(dir, name);
        try {
          const s = await stat(full);
          return { full, size: s.size, mtimeMs: s.mtimeMs };
        } catch {
          return null;
        }
      }),
    );
    const files = entries.filter((e): e is NonNullable<typeof e> => e !== null);
    files.sort((a, b) => b.mtimeMs - a.mtimeMs); // plus récent d'abord

    const now = Date.now();
    let total = 0;
    for (const f of files) {
      const tooOld = now - f.mtimeMs > MAX_AGE_MS;
      const overBudget = total + f.size > MAX_TOTAL_BYTES;
      if (tooOld || overBudget) {
        await rm(f.full, { force: true });
        continue;
      }
      total += f.size;
    }
  } catch {
    // le nettoyage n'est qu'une optimisation d'espace disque — jamais bloquant
  }
}

interface ProcessSample {
  type: string;
  name?: string;
  pid: number;
  cpuPct: number;
  memMB: number;
}

function sampleProcesses(): { processes: ProcessSample[]; totalCpuPct: number } {
  const metrics = app.getAppMetrics();
  let totalCpuPct = 0;
  const processes: ProcessSample[] = metrics.map((m) => {
    totalCpuPct += m.cpu.percentCPUUsage;
    return {
      type: m.type,
      ...(m.name ? { name: m.name } : {}),
      pid: m.pid,
      cpuPct: Math.round(m.cpu.percentCPUUsage * 10) / 10,
      memMB: Math.round((m.memory.workingSetSize / 1024) * 10) / 10,
    };
  });
  return { processes, totalCpuPct };
}

export function createWatchdog(): WatchdogHandle {
  const dir = watchdogDir();
  let buffer: string[] = [];
  let flushing = false;
  let flushCount = 0;
  let highCpuSinceMs: number | null = null;
  let warnedForCurrentSpike = false;
  let disposed = false;

  const enqueue = (line: Record<string, unknown>) => {
    try {
      buffer.push(JSON.stringify(line));
    } catch {
      // jamais bloquer l'échantillonnage pour un souci de sérialisation
    }
  };

  const flush = () => {
    if (flushing || buffer.length === 0) return;
    const lines = buffer;
    buffer = [];
    flushing = true;
    void appendFile(activeLogFile(), lines.join("\n") + "\n", "utf8")
      .catch(() => {
        // panne disque/permissions : on perd ces lignes, tant pis, on continue
      })
      .finally(() => {
        flushing = false;
        flushCount++;
        if (flushCount % PRUNE_EVERY_N_FLUSHES === 0) void pruneOldFiles();
      });
  };

  const tick = () => {
    try {
      const { processes, totalCpuPct } = sampleProcesses();
      const mainRssMB =
        Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
      const now = Date.now();

      enqueue({
        ts: new Date(now).toISOString(),
        level: "info",
        totalCpuPct: Math.round(totalCpuPct * 10) / 10,
        mainRssMB,
        processes,
      });

      // CPU haute et soutenue : on consigne un WARN avec de quoi identifier
      // le coupable (nb de fenêtres ouvertes + détail des process) plutôt
      // que d'attendre un rapport "ça a tué mon ordi" sans piste.
      if (totalCpuPct >= HIGH_CPU_PCT) {
        if (highCpuSinceMs === null) highCpuSinceMs = now;
        const sustainedMs = now - highCpuSinceMs;
        if (sustainedMs >= HIGH_CPU_SUSTAIN_MS && !warnedForCurrentSpike) {
          warnedForCurrentSpike = true;
          enqueue({
            ts: new Date(now).toISOString(),
            level: "warn",
            msg: `sustained high CPU (${Math.round(totalCpuPct)}% for ${Math.round(sustainedMs / 1000)}s)`,
            totalCpuPct: Math.round(totalCpuPct * 10) / 10,
            mainRssMB,
            browserWindowCount: BrowserWindow.getAllWindows().length,
            processes,
          });
        }
      } else {
        highCpuSinceMs = null;
        warnedForCurrentSpike = false;
      }

      flush();
    } catch {
      // le watchdog ne doit jamais faire tomber l'app hôte
    }
  };

  let timer: NodeJS.Timeout | null = null;

  // Création du dossier + premier flush : au démarrage seulement, pas sur
  // le chemin chaud récurrent.
  void mkdir(dir, { recursive: true })
    .then(() => {
      console.log(`[sunflower] watchdog: logging resource samples to ${dir}`);
      if (disposed) return;
      timer = setInterval(tick, SAMPLE_INTERVAL_MS);
      timer.unref();
    })
    .catch((err: unknown) => {
      console.error("[sunflower] watchdog: could not start (log dir unavailable):", err);
    });

  return {
    dispose(): void {
      disposed = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      flush(); // dernier lot en best-effort, sans bloquer la sortie
    },
  };
}
