/**
 * Pixel-art rects of the sunflower, lifted pixel-perfect from the prototype
 * (SunFlower.dc.html, surfaces 1a/1c/1d/1e). Consumed as SVG on the renderer
 * side and rasterized to PNG on the main side (tray icon).
 */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
  c: string;
}

export interface PixelLayer {
  /** Optional SVG transform (pointing rotation, thinking translation). */
  transform?: string;
  rects: PixelRect[];
}

export interface PixelArt {
  /** [width, height] of the viewBox. */
  vb: [number, number];
  layers: PixelLayer[];
}

const Y = "#FCD232"; // petals
const YD = "#D3B12F"; // dark sparkle
const B = "#8B5A2B"; // core
const G1 = "#458149"; // light stem
const G2 = "#3C6E41"; // dark stem
const G3 = "#325A38"; // base
const O = "#D97757"; // clay accent
const INK = "#141413";
const HL = "#F6E3D7"; // reading glint

/** Base flower (idle pose), viewBox 8×9. */
const BASE: PixelRect[] = [
  { x: 2, y: 0, w: 4, h: 2, c: Y },
  { x: 0, y: 2, w: 8, h: 2, c: Y },
  { x: 2, y: 4, w: 4, h: 1, c: Y },
  { x: 3, y: 2, w: 2, h: 2, c: B },
  { x: 3, y: 5, w: 1, h: 3, c: G1 },
  { x: 4, y: 5, w: 1, h: 3, c: G2 },
  { x: 3, y: 8, w: 2, h: 1, c: G3 },
];

/** Open petals — the island (1c) only opens the top two, the companion
    pose (1d) all four. */
const OPEN_PETALS_TOP: PixelRect[] = [
  { x: 1, y: 1, w: 1, h: 1, c: Y },
  { x: 6, y: 1, w: 1, h: 1, c: Y },
];
const OPEN_PETALS: PixelRect[] = [
  ...OPEN_PETALS_TOP,
  { x: 1, y: 4, w: 1, h: 1, c: Y },
  { x: 6, y: 4, w: 1, h: 1, c: Y },
];

/** Island "listening" icon (surface 1c) — top petals only. */
export const ISLAND_LISTENING: PixelArt = {
  vb: [8, 9],
  layers: [{ rects: [...BASE, ...OPEN_PETALS_TOP] }],
};

/** Speech mark (answering). */
const SPEECH: PixelRect[] = [
  { x: 9, y: 2, w: 1, h: 1, c: O },
  { x: 9, y: 4, w: 1, h: 1, c: O },
  { x: 10, y: 3, w: 1, h: 1, c: O },
];

export const POSES = {
  idle: { vb: [8, 9], layers: [{ rects: BASE }] },
  listening: { vb: [8, 9], layers: [{ rects: [...BASE, ...OPEN_PETALS] }] },
  reading: {
    vb: [8, 9],
    layers: [{ rects: [...BASE, { x: 3, y: 2, w: 1, h: 1, c: HL }] }],
  },
  thinking: {
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
  answering: { vb: [12, 9], layers: [{ rects: [...BASE, ...SPEECH] }] },
  pointing: {
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

/** Orange menu-bar variant (surface 1a). */
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
/** Dark menu bar: an ink core would vanish — use a cream core. */
export const MENUBAR_DARK: PixelArt = menubarArt("#FEF9ED");

/** Field sunflower (footers 1a/1e) — simple stem. */
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

/** Pointing brackets (surface 1a), viewBox 30×18. */
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
