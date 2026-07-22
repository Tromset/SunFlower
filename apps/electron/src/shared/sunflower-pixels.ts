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
  /** Optional SVG transform (pointing rotation). */
  transform?: string;
  /** Optional CSS class on the layer's <g> — used by the companion to animate
      individual parts of an activity vignette (screen glow, magnifier, wrench). */
  cls?: string;
  rects: PixelRect[];
}

export interface PixelArt {
  /** [width, height] of the viewBox. */
  vb: [number, number];
  layers: PixelLayer[];
}

const Y = "#FCD232"; // petals
const B = "#8B5A2B"; // core
const BK = "#141413"; // black (bee stripes)
const G1 = "#458149"; // light stem
const G2 = "#3C6E41"; // dark stem
const G3 = "#325A38"; // base
const O = "#D97757"; // clay accent
const HL = "#F6E3D7"; // reading glint
const DK = "#2B2A28"; // hardware near-black (laptop, wrench, loupe rim)

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
  // Le tournesol de base : les anciens « points » de réflexion sont
  // désormais des abeilles (BEE) que le companion fait tourner autour de la
  // tête en CSS (voir companion.css / companion.ts).
  thinking: { vb: [8, 9], layers: [{ rects: BASE }] },
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

/* ── Vignettes d'activité du companion ─────────────────────────────────
   Petites scènes du tournesol « en train de faire quelque chose », posées à
   côté de la fleur. Chaque scène range ses parties animables dans une couche
   à part (cls) : companion.css les anime uniquement tant que #flower porte la
   classe de la pose (aucune boucle ne fuit hors de l'état). Palette + grille
   identiques au reste du fichier. viewBox large (≤14) pour rester dans #flower. */

/** « coding » : le tournesol tape sur un petit portable, l'écran clignote
    (glow) et la fleur pianote (petit rebond). */
export const CODING: PixelArt = {
  vb: [14, 9],
  layers: [
    // La fleur qui pianote (rebond en CSS via .sf-typer).
    { cls: "sf-typer", rects: BASE },
    // Le portable : châssis + écran + lignes de « code » aux couleurs de la
    // palette (comme une coloration syntaxique).
    {
      rects: [
        { x: 8, y: 7, w: 6, h: 1, c: DK }, // socle / clavier
        { x: 8, y: 2, w: 6, h: 5, c: DK }, // cadre de l'écran
        { x: 9, y: 3, w: 4, h: 3, c: BK }, // dalle
        { x: 9, y: 3, w: 2, h: 1, c: O }, // ligne de code
        { x: 9, y: 4, w: 3, h: 1, c: G1 }, // ligne de code
        { x: 9, y: 5, w: 2, h: 1, c: Y }, // ligne de code
        { x: 12, y: 4, w: 1, h: 1, c: HL }, // curseur
      ],
    },
    // Halo de l'écran (opacité modulée en CSS → scintillement).
    { cls: "sf-glow", rects: [{ x: 9, y: 3, w: 4, h: 3, c: HL }] },
  ],
};

/** « reading » : le tournesol examine un document avec une loupe qui balaie la
    page (analyse de la capture d'écran). */
export const READING: PixelArt = {
  vb: [14, 9],
  layers: [
    { rects: BASE },
    // La feuille et ses lignes de texte.
    {
      rects: [
        { x: 8, y: 5, w: 6, h: 4, c: HL }, // page
        { x: 9, y: 5, w: 3, h: 1, c: B }, // texte
        { x: 9, y: 6, w: 4, h: 1, c: B }, // texte
        { x: 9, y: 7, w: 2, h: 1, c: B }, // texte
      ],
    },
    // La loupe (balayage gauche/droite en CSS via .sf-magnify).
    {
      cls: "sf-magnify",
      rects: [
        { x: 10, y: 3, w: 2, h: 1, c: DK }, // monture haut
        { x: 10, y: 6, w: 2, h: 1, c: DK }, // monture bas
        { x: 9, y: 4, w: 1, h: 2, c: DK }, // monture gauche
        { x: 12, y: 4, w: 1, h: 2, c: DK }, // monture droite
        { x: 10, y: 4, w: 2, h: 2, c: HL }, // verre
        { x: 10, y: 5, w: 2, h: 1, c: B }, // texte grossi
        { x: 12, y: 6, w: 1, h: 1, c: B }, // manche
        { x: 13, y: 7, w: 1, h: 1, c: B }, // manche
      ],
    },
  ],
};

/** « working » : tournesol casqué qui serre un boulon avec une clé (exécution
    d'un outil / d'une action). La clé oscille, une étincelle clignote. */
export const WORKING: PixelArt = {
  vb: [14, 9],
  layers: [
    // Fleur + casque de chantier (clay).
    {
      rects: [
        ...BASE,
        { x: 2, y: 0, w: 4, h: 1, c: O }, // dôme du casque
        { x: 1, y: 1, w: 6, h: 1, c: O }, // bord du casque
      ],
    },
    // Le boulon serré (fixe, la clé tourne autour).
    { rects: [{ x: 11, y: 3, w: 1, h: 1, c: B }] },
    // La clé (oscillation en CSS via .sf-wrench).
    {
      cls: "sf-wrench",
      rects: [
        { x: 10, y: 4, w: 3, h: 1, c: DK }, // tête
        { x: 10, y: 3, w: 1, h: 1, c: DK }, // mâchoire gauche
        { x: 12, y: 3, w: 1, h: 1, c: DK }, // mâchoire droite
        { x: 11, y: 5, w: 1, h: 1, c: DK }, // col
        { x: 11, y: 6, w: 1, h: 2, c: DK }, // manche
        { x: 11, y: 6, w: 1, h: 1, c: HL }, // reflet
      ],
    },
    // Étincelles de travail (clignotent en CSS via .sf-spark).
    {
      cls: "sf-spark",
      rects: [
        { x: 13, y: 2, w: 1, h: 1, c: HL },
        { x: 9, y: 3, w: 1, h: 1, c: HL },
      ],
    },
  ],
};

/** Petite abeille pixel (animation « thinking » du companion) : corps rayé
    jaune/noir avec une tête sombre et deux ailes claires. viewBox 4×3. */
export const BEE: PixelArt = {
  vb: [4, 3],
  layers: [
    {
      rects: [
        // ailes
        { x: 1, y: 0, w: 1, h: 1, c: HL },
        { x: 2, y: 0, w: 1, h: 1, c: HL },
        // corps : tête sombre puis rayures jaune / noir
        { x: 0, y: 1, w: 1, h: 2, c: BK },
        { x: 1, y: 1, w: 1, h: 2, c: Y },
        { x: 2, y: 1, w: 1, h: 2, c: BK },
        { x: 3, y: 1, w: 1, h: 2, c: Y },
      ],
    },
  ],
};

/** Menu-bar icon using the proper sunflower palette (yellow petals, brown core, green stem). */
function menubarArt(core: string): PixelArt {
  return {
    vb: [8, 9],
    layers: [
      {
        rects: [
          { x: 2, y: 0, w: 4, h: 2, c: Y },
          { x: 0, y: 2, w: 8, h: 2, c: Y },
          { x: 2, y: 4, w: 4, h: 1, c: Y },
          { x: 3, y: 2, w: 2, h: 2, c: core },
          { x: 3, y: 5, w: 1, h: 3, c: G1 },
          { x: 4, y: 5, w: 1, h: 3, c: G2 },
        ],
      },
    ],
  };
}
export const MENUBAR: PixelArt = menubarArt(B);
export const MENUBAR_DARK: PixelArt = menubarArt(B);

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
      if (!layer.transform && !layer.cls) return rects;
      const attrs = [
        layer.cls ? `class="${layer.cls}"` : "",
        layer.transform ? `transform="${layer.transform}"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<g ${attrs}>${rects}</g>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${vw} ${vh}" width="${width}" height="${height}" shape-rendering="crispEdges" aria-hidden="true" ${extraAttrs}>${layers}</svg>`;
}

/** Crochets adaptatifs : quatre coins d'un cadre w×h px, épaisseur de bras
 *  constante (1 cellule de 4 px). Contrairement à `pixelArtSvg(BRACKETS, w, h)`
 *  qui étirerait les bras avec le cadre, la grille reste uniforme : seule la
 *  longueur des bras suit (un quart du petit côté, bornée 12–28 px). */
export function bracketFrameSvg(w: number, h: number): string {
  const u = 4; // px par cellule (grille pixel-art uniforme)
  const cols = Math.max(8, Math.round(w / u));
  const rows = Math.max(6, Math.round(h / u));
  const arm = Math.min(7, Math.max(3, Math.round(Math.min(cols, rows) / 4)));
  const rects: PixelRect[] = [
    // Coin haut-gauche
    { x: 0, y: 0, w: arm, h: 1, c: O },
    { x: 0, y: 0, w: 1, h: arm, c: O },
    // Coin haut-droit
    { x: cols - arm, y: 0, w: arm, h: 1, c: O },
    { x: cols - 1, y: 0, w: 1, h: arm, c: O },
    // Coin bas-gauche
    { x: 0, y: rows - 1, w: arm, h: 1, c: O },
    { x: 0, y: rows - arm, w: 1, h: arm, c: O },
    // Coin bas-droit
    { x: cols - arm, y: rows - 1, w: arm, h: 1, c: O },
    { x: cols - 1, y: rows - arm, w: 1, h: arm, c: O },
  ];
  return pixelArtSvg({ vb: [cols, rows], layers: [{ rects }] }, cols * u, rows * u);
}
