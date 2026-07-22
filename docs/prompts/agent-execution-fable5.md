# Prompt — Rendre les agents de code de SunFlower réellement observables et exécutants

> À copier-coller tel quel dans une session Fable 5 (Claude Code) ouverte sur le repo
> `Tromset/SunFlower`. Ce document EST le prompt : donne-le en une fois, pas de résumé.

---

## Contexte (non négociable)

SunFlower est une app **locale, gratuite et open source**. Aucune clé API cloud
(Anthropic, OpenAI, etc.) n'existe ni ne doit exister dans ce repo. Tout appel
modèle passe par **Ollama, en local**, via `apps/electron/src/main/ollama.ts`
(`checkOllama()`, `ollamaHost()`). N'introduis **aucune** dépendance à un
service payant ou à une clé API. N'ajoute que des bibliothèques **MIT/permissives**.

## Ce qui existe aujourd'hui (vérifié dans le code, pas supposé)

- **`apps/electron/src/main/agents/runner.ts`** : une file d'agents (un seul actif
  à la fois, `pump()`), qui fait tourner jusqu'à `MAX_TURNS = 8` échanges avec
  Ollama (`agentChat()`, `stream: false`) contre un système prompt qui interdit
  explicitement toute commande shell (`"Rules: no shell commands, no tools..."`,
  ligne 48). Le modèle ne peut que :
  - demander à lire des fichiers (`READ: chemin`, lues en lecture seule, cap
    16 Ko) ;
  - proposer des fichiers complets (` ```file:chemin ` … ` ``` `), jamais
    écrits sur disque à ce stade.
  - `deps.onUpdate(run)` n'est appelé que **2 fois par run** : au passage à
    `"running"` (ligne 284) et dans le `finally` final (ligne 350). **Rien
    pendant les 8 tours.**
- **`decide()`** (ligne 389) est le **seul point d'écriture disque** de tout le
  système : un humain accepte/refuse fichier par fichier depuis la revue, puis
  `writeFileSync` s'exécute. Ce garde-fou **doit être conservé** : ne rends
  jamais l'écriture de fichier automatique.
- **`apps/electron/src/main/windows/agent-orb.ts`** + **`apps/electron/src/renderer/agent-orb/`** :
  une petite fenêtre toujours au-dessus, ancrée à droite de l'écran. Elle
  affiche un titre + un mot d'état statique (`STATE_WORD` : queued / coding… /
  review ready / done / failed) et une animation CSS (`sfOrbSpin`/`sfOrbPulse`)
  qui tourne à vitesse fixe tant qu'un run est `running`/`queued` — **sans
  aucun rapport avec ce qui se passe réellement** pendant les 8 tours.
- **`apps/electron/src/renderer/panel/panel.ts`** : formulaire de lancement
  (`agent-task`/`agent-dir`), et une vue de revue de diff (`openReview()` /
  `renderReview()`). Pas de vue "en cours d'exécution" avec un vrai flux.
- **Aucun terminal/PTY** dans le repo (pas de `node-pty`, pas de `xterm`).
  Le seul `child_process`/`spawn` existant est `apps/electron/src/main/work/clicker.ts`
  (appel `osascript` pour "Sunflower Work", la fonctionnalité de clics/frappe
  automatisés — **hors sujet ici**, ne pas y toucher).
- **`apps/electron/src/shared/agents.ts`** : les types `AgentRun`,
  `AgentRunSummary`, `AgentStatus`, `AgentFileChange`, `AgentTranscriptEntry`,
  `AgentDecision`.

## Le problème à résoudre

L'utilisateur clique sur l'orb pendant qu'un agent tourne et ne voit qu'un
rond qui tourne pour la forme, sans savoir ce que l'agent fait réellement, et
l'agent ne peut de toute façon rien exécuter (aucune commande shell possible).
Deux manques distincts à combler :

1. **Observabilité** : rien n'est renvoyé à l'UI pendant le travail réel.
2. **Capacité** : l'agent ne peut ni lancer de tests, ni build, ni `git diff`,
   ni aucune commande — il ne fait que proposer des fichiers en aveugle.

## Objectif fonctionnel

### A. Observabilité en direct (à faire quel que soit le reste)

1. Appeler `deps.onUpdate(run)` à **chaque étape significative** du tour
   (début de tour, `READ` servi, réponse modèle reçue, proposition détectée),
   pas seulement au début/fin du run.
2. Passer l'appel Ollama en **streaming** (`stream: true` dans `agentChat()`),
   et propager les tokens partiels au fil de l'eau jusqu'au renderer (nouveau
   canal IPC dédié, à ajouter dans `apps/electron/src/main/index.ts` à côté de
   `CH.agentsList`/`agentStart`/etc.), pour que le panneau affiche le texte du
   modèle en train de s'écrire, pas juste un état figé.
3. Ajouter dans `apps/electron/src/shared/agents.ts` un type d'événement fin
   (par ex. `AgentEvent = { runId, kind: "turn-start" | "model-token" |
   "read" | "proposal" | "status", turn, detail }`) pour transporter ces
   mises à jour sans devoir sérialiser tout `AgentRun` (qui contient le
   transcript complet) à chaque frappe.
4. Panneau (`panel.ts`) : ajouter une vue "en cours" sous l'onglet Agents qui
   affiche le transcript live (le champ `transcript` existe déjà sur
   `AgentRun`), avec auto-scroll sauf si l'utilisateur a remonté manuellement.
5. Orb (`agent-orb.ts` + `.css`) : remplacer le mot d'état figé par un texte
   dynamique dérivé du dernier événement (ex. "tour 3/8 · lit src/foo.ts",
   "tour 5/8 · écrit une proposition…", "en attente de ta validation"). Ne
   fais tourner l'animation que pendant une activité réelle (appel modèle en
   cours / commande en cours si tu fais la partie B) — pas en continu du
   début à la fin du run.

### B. Vraie capacité d'exécution (opt-in, garde-fous stricts)

1. **Toujours désactivée par défaut.** Ajoute une case à cocher explicite
   dans le formulaire de lancement d'agent (`panel.ts`, à côté de
   `agent-task`/`agent-dir`) : "autoriser l'exécution de commandes". Si elle
   n'est pas cochée, le comportement actuel (propose-only, aucune commande)
   reste strictement identique à aujourd'hui.
2. **Nouveau protocole texte** dans `SYSTEM_PROMPT` (les petits modèles Ollama
   ne font pas de function-calling fiable) : une ligne `RUN: <commande>`,
   sur le même modèle que `READ:`. Ajoute un `RUN_LINE_RE` au même endroit
   que `READ_LINE_RE`/`FILE_BLOCK_RE`.
3. **Liste noire stricte, non contournable, quel que soit le réglage** :
   refuse sans même demander confirmation toute commande qui matche des
   motifs destructeurs (`rm -rf`, `git push --force`, `git reset --hard`,
   `sudo`, redirection vers un périphérique, `curl|sh`, formatage disque,
   etc.). Une commande refusée doit apparaître dans le transcript comme
   refusée, jamais silencieusement ignorée.
4. **Sandbox d'exécution** : `child_process.spawn` avec `cwd = run.workdir`
   strictement (jamais un autre dossier), timeout par commande (ex. 120 s en
   plus du `TURN_TIMEOUT_MS` existant), capture stdout/stderr en flux.
5. **Validation utilisateur avant exécution réelle**, même quand la case est
   cochée : la commande proposée doit apparaître dans la vue "en cours" avec
   un bouton exécuter/refuser explicite avant de tourner — exactement le même
   principe que l'accept/deny par fichier existant dans `decide()`, appliqué
   cette fois à une commande. N'exécute jamais une commande sans ce clic.
6. **Affichage terminal réel** : ajoute un composant terminal dans le
   renderer pour streamer stdout/stderr au fur et à mesure (bibliothèque
   recommandée : `xterm.js`, licence MIT, aucun coût). `node-pty` donnerait un
   vrai comportement TTY (couleurs, barres de progression) mais ajoute une
   dépendance native à compiler par plateforme dans le packaging Electron —
   documente ce compromis dans le PR, choisis `node-pty` si le build
   `electron-builder` reste simple sur les 3 plateformes (mac/win/linux) que
   couvre le projet, sinon reste sur un `spawn` classique avec capture
   stdout/stderr (moins fidèle mais zéro dépendance native).

## Ce qu'il ne faut PAS faire

- Ne pas rendre l'écriture de fichier automatique : `decide()` reste le seul
  point d'écriture, sur clic humain.
- Ne pas rendre l'exécution de commande automatique sans clic humain, même
  avec la case cochée (voir B.5).
- N'introduis aucune clé API, aucun appel réseau vers un service cloud, en
  particulier rien vers Anthropic/OpenAI — tout doit continuer de tourner sur
  la machine de l'utilisateur via Ollama.
- Ne touche pas à `apps/electron/src/main/work/` (Sunflower Work / clicker) —
  fonctionnalité distincte, sans rapport.
- Pas de dépendance payante ou sous licence non permissive.

## Fichiers à modifier (liste de départ, ajuste si besoin réel)

- `apps/electron/src/main/agents/runner.ts` — boucle principale, streaming,
  parsing `RUN:`, exécution sandboxée, liste noire.
- `apps/electron/src/shared/agents.ts` — nouveaux types (`AgentEvent`,
  champ d'autorisation d'exécution sur `AgentRun`/au lancement).
- `apps/electron/src/main/index.ts` — nouveaux canaux IPC pour les événements
  live et pour l'exécution/refus de commande.
- `apps/electron/src/renderer/panel/panel.ts` — case à cocher, vue "en
  cours" avec transcript live + terminal, boutons exécuter/refuser par
  commande.
- `apps/electron/src/renderer/agent-orb/agent-orb.ts` et `.css` — état
  dynamique au lieu du mot figé, animation liée à une activité réelle.
- `apps/electron/package.json` — ajout de `xterm` (et `node-pty` seulement si
  retenu, voir A.6/B.6).
- `README.md` (section "Background coding agents", lignes ~118-122) — mettre
  à jour la description pour refléter le nouveau comportement (toujours
  propose-only par défaut ; exécution de commandes disponible en opt-in avec
  validation humaine par commande).

## Critères d'acceptation

1. Case "autoriser l'exécution" décochée (par défaut) → comportement
   strictement identique à l'existant : aucune régression sur le flux
   propose/review/accept actuel.
2. Case cochée → l'agent peut demander `RUN: npm test` (ou équivalent), la
   commande proposée s'affiche, attend un clic explicite, puis son
   stdout/stderr s'affiche en direct dans le terminal du panneau, et l'orb
   reflète l'état ("exécute: npm test…") pendant ce temps.
3. `RUN: rm -rf /` (ou motif équivalent de la liste noire) est refusé
   automatiquement et visiblement dans le transcript, quelle que soit la case.
4. Pendant un run (case cochée ou non), l'orb et le panneau changent d'état
   à chaque tour/lecture/commande — plus jamais un spinner figé pendant
   plusieurs minutes sans aucune information.
5. `pnpm --filter electron build` (ou le script de build existant du repo)
   passe toujours.
6. Aucune clé API, aucun `fetch`/appel réseau ajouté vers autre chose
   qu'Ollama en local.

## Plan de test manuel (pas de suite e2e existante dans le repo)

1. Lancer `ollama serve` en local avec un modèle code-capable déjà pullé
   (voir `sunflower-models` CLI pour en choisir un).
2. Démarrer l'app Electron en dev, ouvrir le panneau, onglet Agents.
3. Lancer un run sans la case cochée sur un petit dossier de test → vérifier
   l'affichage live du transcript et de l'orb, puis le flux accept/deny
   inchangé.
4. Lancer un run avec la case cochée, tâche du type "lance les tests et
   corrige ce qui échoue" → vérifier l'apparition de la commande proposée,
   le clic de validation, le streaming du terminal, et la mise à jour de
   l'orb pendant l'exécution.
5. Tester un cas de liste noire (demander explicitement une commande
   destructrice dans la tâche) → vérifier le refus visible sans exécution.
