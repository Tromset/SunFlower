import { ensureBridge } from "../shared/dev-stub";
import {
  BRACKETS,
  bracketFrameSvg,
  pixelArtSvg,
} from "../../shared/sunflower-pixels";

ensureBridge();

const brackets = document.getElementById("brackets")!;

// Visuel historique exact (payload sans taille : POINT legacy à 2 nombres).
const DEFAULT_SVG = pixelArtSvg(BRACKETS, 100, 60);

/** Clé de la dernière taille dessinée — évite de reconstruire le SVG quand
 *  deux pointages consécutifs partagent la même taille. */
let drawn = "";
const draw = (p?: { w?: number; h?: number }) => {
  const w = p?.w;
  const h = p?.h;
  const sized = w !== undefined && h !== undefined;
  const key = sized ? `${w}x${h}` : "default";
  if (key === drawn) return;
  drawn = key;
  brackets.innerHTML = sized ? bracketFrameSvg(w, h) : DEFAULT_SVG;
};
draw();

window.sunflower.onPointShow((p) => {
  draw(p);
  brackets.classList.remove("show");
  // Restart the appearance animation.
  void brackets.getBoundingClientRect().width;
  brackets.classList.add("show");
});
