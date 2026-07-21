import { shell, systemPreferences } from "electron";
import type { PermissionId, PermissionStatus } from "../shared/state";

const SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security";

function mapMedia(status: string): PermissionStatus {
  if (status === "granted") return "granted";
  if (status === "not-determined") return "not-determined";
  return "denied";
}

export function permissionStatuses(): Record<PermissionId, PermissionStatus> {
  const mic = mapMedia(systemPreferences.getMediaAccessStatus("microphone"));
  const screen = mapMedia(systemPreferences.getMediaAccessStatus("screen"));
  const ax = systemPreferences.isTrustedAccessibilityClient(false)
    ? "granted"
    : "denied";
  return {
    microphone: mic,
    accessibility: ax,
    screen,
    screenContent: screen,
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
      if (systemPreferences.getMediaAccessStatus("screen") !== "granted") {
        await shell.openExternal(`${SETTINGS_URL}?Privacy_ScreenCapture`);
      }
      break;
    }
  }
}
