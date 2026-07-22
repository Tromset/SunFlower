export interface SunflowerConfig {
  onboarded: boolean;
  ollamaHost: string;
  ollamaModel: string;
  /** Nom du fichier ggml sur huggingface (ggerganov/whisper.cpp). */
  whisperModel: string;
  /** Vrai dès qu'une capture d'écran a réussi — survit au redémarrage exigé
   *  par macOS après l'octroi de l'enregistrement d'écran. */
  screenCaptureConfirmed: boolean;
  /** Position verticale (0..1, du haut vers le bas de l'écran principal) du
   *  petit rond des agents, ancré au bord droit — persistée après un glisser
   *  (voir main/windows/agent-orb.ts). */
  agentOrbY: number;
  /** Compagnon : « follow » (suit le curseur, historique) ou « docked »
   *  (petit badge garé en bas à droite — regarder une vidéo sans tournesol
   *  au milieu de l'écran). Voir main/windows/companion.ts. */
  companionMode: "follow" | "docked";
  /** Sunflower Work (expérimental) : autoriser la fleur à piloter souris et
   *  clavier pour une corvée demandée, quand l'utilisateur s'est éloigné.
   *  FAUX par défaut — opt-in explicite via le menu du tray.
   *  Voir main/work/runner.ts. */
  sunflowerWorkEnabled: boolean;
}

export const DEFAULT_CONFIG: SunflowerConfig = {
  onboarded: false,
  ollamaHost: "http://localhost:11434",
  ollamaModel: "qwen3-vl:8b",
  whisperModel: "ggml-small-q5_1.bin",
  screenCaptureConfirmed: false,
  agentOrbY: 0.5,
  companionMode: "follow",
  sunflowerWorkEnabled: false,
};
