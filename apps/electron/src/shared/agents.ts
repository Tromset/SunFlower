/** Agents de code en arrière-plan (onglet « agents » du panneau).
 *  Un agent produit une PROPOSITION de fichiers — jamais appliquée sans
 *  un accept explicite, fichier par fichier, depuis l'interface de revue.
 *  En opt-in (case au lancement), il peut aussi PROPOSER des commandes
 *  shell — jamais exécutées sans un clic explicite, commande par commande. */

export type AgentStatus =
  | "queued"
  | "running"
  /** Une commande proposée attend le clic exécuter/refuser de l'utilisateur. */
  | "awaiting-command"
  | "awaiting-review"
  | "done"
  | "failed";

/** Décision de revue pour un fichier proposé. */
export type AgentDecision = "accepted" | "denied";

/** Décision de l'utilisateur pour une commande proposée. */
export type AgentCommandDecision = "approved" | "denied";

/** Cycle de vie d'une commande proposée par l'agent. */
export type AgentCommandStatus =
  /** Proposée, en attente du clic exécuter/refuser. */
  | "pending"
  /** Refusée par l'utilisateur (jamais exécutée). */
  | "denied"
  /** Bloquée d'office par la liste noire (jamais exécutée, sans confirmation). */
  | "refused"
  /** En cours d'exécution (stdout/stderr streamés). */
  | "running"
  /** Terminée — exitCode renseigné. */
  | "done"
  /** Spawn impossible ou tuée par le timeout. */
  | "error";

/** Une commande proposée par l'agent (protocole « RUN: … », opt-in). */
export interface AgentCommandRecord {
  /** Index stable dans run.commands (identifiant de décision côté IPC). */
  id: number;
  command: string;
  status: AgentCommandStatus;
  /** stdout+stderr combinés, dans l'ordre d'arrivée, bornés. */
  output: string;
  /** Code de sortie ; null si tuée avant d'en avoir un. */
  exitCode?: number | null;
  /** Motif de refus (liste noire) ou d'erreur (timeout, spawn). */
  note?: string;
}

export interface AgentTranscriptEntry {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Un fichier proposé par l'agent : contenu avant (disque) / après (modèle). */
export interface AgentFileChange {
  /** Chemin relatif au dossier de travail de l'agent. */
  path: string;
  /** Contenu actuel sur disque ; null si le fichier n'existe pas encore. */
  before: string | null;
  /** Contenu complet proposé par le modèle. */
  after: string;
}

/** Session d'agent complète (vue de revue). */
export interface AgentRun {
  id: string;
  task: string;
  /** Dossier de travail (les chemins de la proposition y sont relatifs). */
  workdir: string;
  status: AgentStatus;
  createdAt: number;
  finishedAt?: number;
  /** Message d'erreur quand status === "failed". */
  error?: string;
  /** Exécution de commandes autorisée pour CE run (opt-in au lancement).
   *  Même à true, chaque commande attend un clic explicite avant de tourner. */
  allowCommands: boolean;
  transcript: AgentTranscriptEntry[];
  /** Vide tant que l'agent n'a rien proposé. */
  proposal: AgentFileChange[];
  /** Décisions de revue déjà prises, par chemin relatif. */
  decisions: Record<string, AgentDecision>;
  /** Commandes proposées (et leur sort), dans l'ordre chronologique. */
  commands: AgentCommandRecord[];
}

/** Version allégée pour la liste du panneau (sans transcript ni contenus). */
export interface AgentRunSummary {
  id: string;
  task: string;
  workdir: string;
  status: AgentStatus;
  createdAt: number;
  finishedAt?: number;
  error?: string;
  /** Nombre de fichiers proposés. */
  files: number;
  /** Nombre de fichiers déjà tranchés (acceptés ou refusés). */
  decided: number;
}

/** Événement fin émis pendant un run — assez léger pour être envoyé à chaque
 *  étape (voire à chaque paquet de tokens) sans sérialiser tout l'AgentRun. */
export type AgentEventKind =
  /** Un tour modèle démarre (appel Ollama en vol). */
  | "turn-start"
  /** Paquet de texte partiel streamé par le modèle (detail = le texte). */
  | "model-token"
  /** Réponse complète du tour reçue (detail = début de la réponse). */
  | "model-answer"
  /** Lignes READ servies (detail = chemins, séparés par « , »). */
  | "read"
  /** Proposition de fichiers détectée (detail = nombre de fichiers). */
  | "proposal"
  /** Changement d'état du run (detail = AgentStatus). */
  | "status"
  /** Commande proposée, en attente du clic (detail = la commande). */
  | "command-request"
  /** Commande bloquée par la liste noire (detail = la commande). */
  | "command-refused"
  /** Commande refusée par l'utilisateur (detail = la commande). */
  | "command-denied"
  /** Commande approuvée, exécution lancée (detail = la commande). */
  | "command-start"
  /** Paquet stdout/stderr streamé (detail = le texte brut). */
  | "command-output"
  /** Commande terminée (detail = commande + code de sortie). */
  | "command-end";

export interface AgentEvent {
  runId: string;
  kind: AgentEventKind;
  /** Tour courant (1-based) ; 0 hors des tours. */
  turn: number;
  /** Nombre max de tours (pour afficher « tour 3/8 »). */
  maxTurns: number;
  /** Contenu selon kind — voir AgentEventKind. */
  detail: string;
  /** Renseigné pour les kinds command-* : AgentCommandRecord.id concerné. */
  commandId?: number;
}
