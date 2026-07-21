import { ensureBridge } from "../shared/dev-stub";
import { BRACKETS, pixelArtSvg } from "../../shared/sunflower-pixels";

ensureBridge();

const brackets = document.getElementById("brackets")!;
brackets.innerHTML = pixelArtSvg(BRACKETS, 100, 60);

window.sunflower.onPointShow(() => {
  brackets.classList.remove("show");
  // Restart the appearance animation.
  void brackets.getBoundingClientRect().width;
  brackets.classList.add("show");
});
