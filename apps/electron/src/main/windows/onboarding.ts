import { BrowserWindow, app } from "electron";
import { preloadPath, rendererFile } from "./common";

export async function createOnboardingWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 620,
    height: 700,
    show: false,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: "#FEF9ED",
    title: "sunflower",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.once("ready-to-show", () => {
    win.show();
    app.focus({ steal: true });
  });
  await win.loadFile(rendererFile("onboarding/onboarding.html"));
  return win;
}
