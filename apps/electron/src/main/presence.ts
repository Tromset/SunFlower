// Garde de présence pour Sunflower Work : sait depuis combien de temps
// l'utilisateur n'a pas touché sa machine, et prévient dès qu'il revient.
// Alimenté par hotkey.ts (uiohook, seul point d'écoute globale) — les
// événements que NOTRE clicker synthétise sont ignorés : chaque salve
// d'osascript est encadrée par beginSelfInput(kind), avec une petite grâce
// après coup (les CGEvents arrivent avec un léger retard dans le hook).
// La suppression est PAR FAMILLE d'entrée : une salve souris ne rend pas la
// garde sourde au clavier (et inversement), sinon un utilisateur qui revient
// pendant une frappe System Events de plusieurs secondes ne serait détecté
// qu'après coup — le retour réel doit annuler le run à l'instant.
const SELF_GRACE_MS = 350;

export type InputKind = "mouse" | "keyboard";

/** Au démarrage, l'utilisateur est réputé présent : le travail devra
 *  attendre sa vraie période d'inactivité, jamais l'inverse. */
let lastRealInputAt = Date.now();
/** Salves d'entrées synthétiques en cours (clicker), par famille — compteur,
 *  pas booléen : un clic et une frappe peuvent se chevaucher à l'annulation. */
const selfDepth: Record<InputKind, number> = { mouse: 0, keyboard: 0 };
const selfGraceUntil: Record<InputKind, number> = { mouse: 0, keyboard: 0 };
const subs = new Set<() => void>();

/**
 * À appeler juste avant de poster des entrées synthétiques de la famille
 * donnée ; la fonction retournée clôt la salve (idempotente) et ouvre la
 * fenêtre de grâce de cette famille.
 */
export function beginSelfInput(kind: InputKind): () => void {
  selfDepth[kind]++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    selfDepth[kind]--;
    selfGraceUntil[kind] = Date.now() + SELF_GRACE_MS;
  };
}

/** Chaque événement clavier/souris global passe ici (voir hotkey.ts). */
export function noteGlobalInput(kind: InputKind): void {
  const now = Date.now();
  if (selfDepth[kind] > 0 || now < selfGraceUntil[kind]) return; // notre clicker
  lastRealInputAt = now;
  if (subs.size > 0) {
    for (const cb of subs) cb();
  }
}

/** Millisecondes depuis la dernière entrée RÉELLE de l'utilisateur. */
export function idleMs(): number {
  return Date.now() - lastRealInputAt;
}

/** Abonnement aux entrées réelles (abandon immédiat d'un run de travail). */
export function onRealInput(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
