#!/usr/bin/env node
// Global `sunflower` command (npm link): build if needed, then launch Electron.
"use strict";
const { spawn, spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

// `sunflower models [...]` : sous-commande autonome, zéro build/Electron requis.
if (process.argv[2] === "models") {
  const child = spawn(
    process.execPath,
    [path.join(__dirname, "sunflower-models.js"), ...process.argv.slice(3)],
    { stdio: "inherit" },
  );
  child.on("exit", (code) => process.exit(code ?? 0));
  return;
}

const appRoot = path.resolve(__dirname, "..");
// stderr filtré : le bruit natif whisper.cpp/ggml part dans un fichier de
// log, le terminal ne garde que le dialogue (SUNFLOWER_DEBUG=1 = tout brut).
const { spawnQuiet } = require(
  path.join(appRoot, "scripts", "native-log-filter.cjs"),
);

let electronBin;
try {
  electronBin = require(require.resolve("electron", { paths: [appRoot] }));
} catch {
  console.error(
    "sunflower: electron not found — run `pnpm install` at the repo root first.",
  );
  process.exit(1);
}

// dist/.build-ok is only written at the very end of a build: a partial build
// (interrupted, or a failed renderer bundle) triggers a rebuild.
if (!existsSync(path.join(appRoot, "dist", ".build-ok"))) {
  const build = spawnSync(
    process.execPath,
    [path.join(appRoot, "scripts", "build.mjs")],
    { cwd: appRoot, stdio: "inherit" },
  );
  if (build.status !== 0) process.exit(build.status ?? 1);
}

spawnQuiet(electronBin, [appRoot, ...process.argv.slice(2)], {
  onClose: (code) => process.exit(code),
});
