/**
 * Rects pixel-art du tournesol, relevés au pixel près sur le prototype
 * (SunFlower.dc.html, surfaces 1a/1c/1d/1e). Consommés en SVG côté renderer
 * et rasterisés en PNG côté main (icône de tray).
 */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
  c: string;
}

export interface PixelLayer {
  /** Transform SVG optionnel (rotation du pointage, translation de la réflexion). */
  transform?: string;
  rects: PixelRect[];
}

export interface PixelArt {
  /** [largeur, hauteur] du viewBox. */
  vb: [number, number];
  layers: PixelLayer[];
}

const Y = "#FCD232"; // pétales
const YD = "#D3B12F"; // étincelle sombre
const B = "#8B5A2B"; // cœur
const G1 = "#458149"; // tige claire
const G2 = "#3C6E41"; // tige sombre
const G3 = "#325A38"; // base
const O = "#D97757"; // accent argile
const INK = "#141413";
const HL = "#F6E3D7"; // reflet lecture

/** Fleur de base (pose veille), viewBox 8×9. */
const BASE: PixelRect[] = [
  { x: 2, y: 0, w: 4, h: 2, c: Y },
  { x: 0, y: 2, w: 8, h: 2, c: Y },
  { x: 2, y: 4, w: 4, h: 1, c: Y },
  { x: 3, y: 2, w: 2, h: 2, c: B },
  { x: 3, y: 5, w: 1, h: 3, c: G1 },
  { x: 4, y: 5, w: 1, h: 3, c: G2 },
  { x: 3, y: 8, w: 2, h: 1, c: G3 },
];

/** Pétales ouverts — l'îlot (1c) n'ouvre que les deux du haut, la pose
    compagnon (1d) les quatre. */
const OPEN_PETALS_TOP: PixelRect[] = [
  { x: 1, y: 1, w: 1, h: 1, c: Y },
  { x: 6, y: 1, w: 1, h: 1, c: Y },
];
const OPEN_PETALS: PixelRect[] = [
  ...OPEN_PETALS_TOP,
  { x: 1, y: 4, w: 1, h: 1, c: Y },
  { x: 6, y: 4, w: 1, h: 1, c: Y },
];

/** Icône « écoute » de l'îlot (surface 1c) — deux pétales hauts seulement. */
export const ISLAND_ECOUTE: PixelArt = {
  vb: [8, 9],
  layers: [{ rects: [...BASE, ...OPEN_PETALS_TOP] }],
};

/** Marque de parole (réponse). */
const SPEECH: PixelRect[] = [
  { x: 9, y: 2, w: 1, h: 1, c: O },
  { x: 9, y: 4, w: 1, h: 1, c: O },
  { x: 10, y: 3, w: 1, h: 1, c: O },
];

export const POSES = {
  veille: { vb: [8, 9], layers: [{ rects: BASE }] },
  ecoute: { vb: [8, 9], layers: [{ rects: [...BASE, ...OPEN_PETALS] }] },
  lecture: {
    vb: [8, 9],
    layers: [{ rects: [...BASE, { x: 3, y: 2, w: 1, h: 1, c: HL }] }],
  },
  reflexion: {
    vb: [11, 11],
    layers: [
      {
        rects: [
          { x: 8, y: 1, w: 1, h: 1, c: YD },
          { x: 10, y: 0, w: 1, h: 1, c: Y },
        ],
      },
      { transform: "translate(0,2)", rects: BASE },
    ],
  },
  reponse: { vb: [12, 9], layers: [{ rects: [...BASE, ...SPEECH] }] },
  pointage: {
    vb: [12, 11],
    layers: [
      { transform: "rotate(8 4 9)", rects: BASE },
      {
        rects: [
          { x: 9, y: 7, w: 1, h: 1, c: O },
          { x: 10, y: 8, w: 1, h: 1, c: O },
          { x: 11, y: 9, w: 1, h: 1, c: O },
        ],
      },
    ],
  },
} satisfies Record<string, PixelArt>;

/** Variante orange de la barre de menus (surface 1a). */
function menubarArt(core: string): PixelArt {
  return {
    vb: [8, 9],
    layers: [
      {
        rects: [
          { x: 2, y: 0, w: 4, h: 2, c: O },
          { x: 0, y: 2, w: 8, h: 2, c: O },
          { x: 2, y: 4, w: 4, h: 1, c: O },
          { x: 3, y: 2, w: 2, h: 2, c: core },
          { x: 3, y: 5, w: 1, h: 3, c: O },
          { x: 4, y: 5, w: 1, h: 3, c: O },
        ],
      },
    ],
  };
}
export const MENUBAR: PixelArt = menubarArt(INK);
/** Barre de menus sombre : le cœur ink disparaîtrait — cœur crème. */
export const MENUBAR_DARK: PixelArt = menubarArt("#FEF9ED");

/** Tournesol des champs (pieds de page 1a/1e) — tige simple. */
export const FIELD: PixelArt = {
  vb: [8, 9],
  layers: [
    {
      rects: [
        { x: 2, y: 0, w: 4, h: 2, c: Y },
        { x: 0, y: 2, w: 8, h: 2, c: Y },
        { x: 2, y: 4, w: 4, h: 1, c: Y },
        { x: 3, y: 2, w: 2, h: 2, c: B },
        { x: 3, y: 5, w: 1, h: 4, c: G1 },
      ],
    },
  ],
};

/** Crochets de pointage (surface 1a), viewBox 30×18. */
export const BRACKETS: PixelArt = {
  vb: [30, 18],
  layers: [
    {
      rects: [
        { x: 0, y: 0, w: 4, h: 1, c: O },
        { x: 0, y: 0, w: 1, h: 4, c: O },
        { x: 26, y: 0, w: 4, h: 1, c: O },
        { x: 29, y: 0, w: 1, h: 4, c: O },
        { x: 0, y: 17, w: 4, h: 1, c: O },
        { x: 0, y: 14, w: 1, h: 4, c: O },
        { x: 26, y: 17, w: 4, h: 1, c: O },
        { x: 29, y: 14, w: 1, h: 4, c: O },
      ],
    },
  ],
};

export function pixelArtSvg(
  art: PixelArt,
  width: number,
  height: number,
  extraAttrs = "",
): string {
  const [vw, vh] = art.vb;
  const layers = art.layers
    .map((layer) => {
      const rects = layer.rects
        .map(
          (r) =>
            `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.c}"></rect>`,
        )
        .join("");
      return layer.transform
        ? `<g transform="${layer.transform}">${rects}</g>`
        : rects;
    })
    .join("");
  return `<svg viewBox="0 0 ${vw} ${vh}" width="${width}" height="${height}" shape-rendering="crispEdges" aria-hidden="true" ${extraAttrs}>${layers}</svg>`;
}
