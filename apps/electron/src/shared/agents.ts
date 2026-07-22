/** Agents de code en arrière-plan (onglet « agents » du panneau).
 *  Un agent produit une PROPOSITION de fichiers — jamais appliquée sans
 *  un accept explicite, fichier par fichier, depuis l'interface de revue. */

export type AgentStatus =
  | "queued"
  | "running"
  | "awaiting-review"
  | "done"
  | "failed";

/** Décision de revue pour un fichier proposé. */
export type AgentDecision = "accepted" | "denied";

/** Un fichier proposé par l'agent : contenu avant (disque) / après (modèle). */
export interface AgentFileChange {
  /** Chemin relatif au dossier de travail de l'agent. */
  path: string;
  /** Contenu actuel sur disque ; null si le fichier n'existe pas encore. */
  before: string | null;
  /** Contenu complet proposé par le modèle. */
  after: string;
}

export interface AgentTranscriptEntry {
  role: "system" | "user" | "assistant";
  content: string;
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
  transcript: AgentTranscriptEntry[];
  /** Vide tant que l'agent n'a rien proposé. */
  proposal: AgentFileChange[];
  /** Décisions de revue déjà prises, par chemin relatif. */
  decisions: Record<string, AgentDecision>;
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
