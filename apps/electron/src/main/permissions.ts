import { shell, systemPreferences } from "electron";
import type { PermissionId, PermissionStatus } from "../shared/state";
import { getConfig, setConfig } from "./config-store";
import { captureScreenAtCursor } from "./screenshot";

const SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security";

// macOS n'ajoute une app au volet « Enregistrement d'écran » qu'après une
// première *tentative* de capture, et ce volet n'a pas de bouton « + ».
// Ouvrir les Réglages sans avoir tenté de capture mène donc à une liste vide :
// il faut tenter une capture au premier clic pour y faire apparaître l'app.
let screenPromptAttempted = false;

function mapMedia(status: string): PermissionStatus {
  if (status === "granted") return "granted";
  if (status === "not-determined") return "not-determined";
  return "denied";
}

/** Tente une capture ; en cas de succès, mémorise la preuve durablement. */
async function attemptScreenCapture(): Promise<boolean> {
  const ok = (await captureScreenAtCursor()) !== null;
  if (ok && !getConfig().screenCaptureConfirmed) {
    setConfig({ screenCaptureConfirmed: true });
  }
  return ok;
}

export function permissionStatuses(): Record<PermissionId, PermissionStatus> {
  const mic = mapMedia(systemPreferences.getMediaAccessStatus("microphone"));
  const screen = mapMedia(systemPreferences.getMediaAccessStatus("screen"));
  const ax = systemPreferences.isTrustedAccessibilityClient(false)
    ? "granted"
    : "denied";
  // « contenu d'écran » = l'enregistrement est accordé ET une capture a
  // réellement abouti (sinon on ne sait pas encore qu'elle fonctionne).
  const screenContent: PermissionStatus =
    screen !== "granted"
      ? screen
      : getConfig().screenCaptureConfirmed
        ? "granted"
        : "not-determined";
  return {
    microphone: mic,
    accessibility: ax,
    screen,
    screenContent,
  };
}

export function screenGranted(): boolean {
  return systemPreferences.getMediaAccessStatus("screen") === "granted";
}

export async function requestPermission(id: PermissionId): Promise<void> {
  switch (id) {
    case "microphone": {
      const status = systemPreferences.getMediaAccessStatus("microphone");
      if (status === "not-determined") {
        await systemPreferences.askForMediaAccess("microphone");
      } else if (status !== "granted") {
        await shell.openExternal(`${SETTINGS_URL}?Privacy_Microphone`);
      }
      break;
    }
    case "accessibility": {
      if (!systemPreferences.isTrustedAccessibilityClient(true)) {
        await shell.openExternal(`${SETTINGS_URL}?Privacy_Accessibility`);
      }
      break;
    }
    case "screen":
    case "screenContent": {
      if (systemPreferences.getMediaAccessStatus("screen") === "granted") {
        // Déjà accordé : confirmer que la capture fonctionne vraiment
        // (fait passer « contenu d'écran » au vert).
        await attemptScreenCapture();
      } else if (!screenPromptAttempted) {
        // Premier clic : tenter une capture pour enregistrer l'app auprès de
        // macOS et déclencher son invite système — sans ouvrir les Réglages.
        screenPromptAttempted = true;
        await attemptScreenCapture();
      } else {
        // Clics suivants : l'app figure désormais dans la liste des Réglages.
        await shell.openExternal(`${SETTINGS_URL}?Privacy_ScreenCapture`);
      }
      break;
    }
  }
}
