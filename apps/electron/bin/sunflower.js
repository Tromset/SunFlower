#!/usr/bin/env node
// Commande globale `sunflower` (npm link) : build si nécessaire, puis lance Electron.
"use strict";
const { spawn, spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");

let electronBin;
try {
  electronBin = require(require.resolve("electron", { paths: [appRoot] }));
} catch {
  console.error(
    "sunflower : electron est introuvable — lancez d'abord `pnpm install` à la racine du repo.",
  );
  process.exit(1);
}

// dist/.build-ok n'est écrit qu'en toute fin de build : un build partiel
// (interrompu, ou bundle renderer en échec) déclenche une reconstruction.
if (!existsSync(path.join(appRoot, "dist", ".build-ok"))) {
  const build = spawnSync(
    process.execPath,
    [path.join(appRoot, "scripts", "build.mjs")],
    { cwd: appRoot, stdio: "inherit" },
  );
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const child = spawn(electronBin, [appRoot, ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
