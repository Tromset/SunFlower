import { app } from "electron";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_CONFIG,
  type SunflowerConfig,
} from "../shared/config-schema";

let cached: SunflowerConfig | null = null;

function configPath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

export function getConfig(): SunflowerConfig {
  if (cached) return cached;
  try {
    const raw = JSON.parse(
      readFileSync(configPath(), "utf8"),
    ) as Partial<SunflowerConfig>;
    cached = { ...DEFAULT_CONFIG, ...raw };
  } catch {
    cached = { ...DEFAULT_CONFIG };
  }
  return cached;
}

export function setConfig(patch: Partial<SunflowerConfig>): SunflowerConfig {
  const next = { ...getConfig(), ...patch };
  cached = next;
  const file = configPath();
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, file);
  return next;
}
