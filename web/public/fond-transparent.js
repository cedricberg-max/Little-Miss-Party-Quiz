/**
 * Images à fond transparent (cedric, 25/10 : « si l'image représente un petit espace de la zone et que son fond est
 * transparent, l'agrandir pour occuper un maximum d'espace et mettre un fond dans l'esprit du décor ; la couleur du
 * fond ne doit pas se fondre avec l'image »). Avant, la transparence devenait du blanc et le sujet restait petit.
 * Ici, la partie pure (testée) : repérer le sujet (ses pixels visibles), choisir le fond Game Show qui contraste le
 * mieux avec son contour, et placer le sujet en grand dans le cadre. Le dessin se fait dans illustration.js.
 */

/** Opacité (0 à 255) à partir de laquelle un pixel fait partie du sujet. */
const VISIBLE = 24;
/** Une image « à fond transparent » : au moins cette part de ses pixels est transparente. */
const PART_TRANSPARENTE = 0.02;

/**
 * Les fonds possibles, dans l'esprit du décor Game Show de la TV (nuit violette, bleu néon, ou clairs pour un sujet
 * sombre) : `centre` derrière le sujet, `bord` dans les coins, `halo` la lueur derrière lui. Le premier est préféré à
 * contraste égal (c'est le décor de la TV).
 */
export const FONDS = [
  { nom: "violet", centre: [58, 15, 122], bord: [14, 8, 32], halo: [139, 44, 255], rayons: [255, 45, 149], ombre: [0, 0, 0] },
  { nom: "bleu", centre: [10, 61, 107], bord: [4, 16, 31], halo: [0, 240, 255], rayons: [0, 240, 255], ombre: [0, 0, 0] },
  { nom: "lavande", centre: [244, 241, 255], bord: [201, 184, 255], halo: [255, 255, 255], rayons: [139, 44, 255], ombre: [58, 15, 122] },
  { nom: "or", centre: [255, 246, 218], bord: [246, 204, 114], halo: [255, 255, 255], rayons: [255, 107, 26], ombre: [90, 40, 0] },
];

/** Écart de couleur à peu près comme l'œil le voit (« redmean »), de 0 à environ 765. */
export function ecartCouleur([r1, g1, b1], [r2, g2, b2]) {
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}
/** En dessous, le contour du sujet se fond dans le fond. */
export const ECART_MIN = 150;

/** Luminance relative (0 noir, 1 blanc), comme pour le contraste d'un texte. */
const luminance = (c) => {
  const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Contraste de clarté entre deux couleurs (1 : aucun, 21 : noir sur blanc). */
export const contraste = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
/** En dessous, même de couleurs différentes, le contour se perd (noir sur violet nuit, blanc sur crème…). */
export const CONTRASTE_MIN = 4;
/** Un pixel du contour se confond avec la couleur [d] du fond. */
export const seConfond = (c, d) => ecartCouleur(c, d) < ECART_MIN || contraste(c, d) < CONTRASTE_MIN;

/**
 * Regarde les pixels [data] (RGBA, largeur [w], hauteur [h]) : null si l'image n'a pas de fond transparent (ou rien de
 * visible) ; sinon le cadre du sujet `{ x, y, l, h }` et les couleurs de son contour (pixels visibles qui touchent la
 * transparence : ce sont eux qui se fondraient dans le fond).
 */
export function analyserTransparence(data, w, h) {
  let transparents = 0;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  const alpha = (x, y) => data[(y * w + x) * 4 + 3];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alpha(x, y);
      if (a < 200) transparents++;
      if (a >= VISIBLE) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0 || transparents < PART_TRANSPARENTE * w * h) return null;
  const contour = [];
  const pas = Math.max(1, Math.round(Math.sqrt((w * h) / 40_000)));
  for (let y = y0; y <= y1; y += pas) {
    for (let x = x0; x <= x1; x += pas) {
      if (alpha(x, y) < 128) continue;
      const bord = x === 0 || y === 0 || x === w - 1 || y === h - 1
        || alpha(x - 1, y) < VISIBLE || alpha(x + 1, y) < VISIBLE || alpha(x, y - 1) < VISIBLE || alpha(x, y + 1) < VISIBLE;
      if (bord) {
        const i = (y * w + x) * 4;
        contour.push([data[i], data[i + 1], data[i + 2]]);
      }
    }
  }
  return { x: x0, y: y0, l: x1 - x0 + 1, h: y1 - y0 + 1, contour };
}

/** Ce qui est juste derrière le contour du sujet : le centre du fond, éclairé par son halo. */
const derriere = (f) => f.centre.map((c, k) => Math.round(c * 0.7 + f.halo[k] * 0.3));

/**
 * Le fond qui contraste le mieux avec le contour du sujet : celui où le moins de pixels du contour se confondent
 * avec lui (à égalité, le violet du décor).
 */
export function choisirFond(contour) {
  if (!contour?.length) return FONDS[0];
  let meilleur = FONDS[0], pire = Infinity;
  for (const f of FONDS) {
    const d = derriere(f);
    const confondus = contour.filter((c) => seConfond(c, d)).length / contour.length;
    if (confondus < pire - 0.02) { meilleur = f; pire = confondus; }
  }
  return meilleur;
}

/**
 * Où dessiner le sujet (cadre [sujet] de l'original) dans un cadre [largeur] × [hauteur] : le plus grand possible,
 * centré, avec une marge pour que la TV (qui recadre l'image à sa case) ne le coupe jamais : [margeX] et [margeY] de
 * chaque côté, en part du cadre.
 */
export function placerSujet(sujet, largeur, hauteur, { margeX = 0.08, margeY = 0.08 } = {}) {
  const k = Math.min((largeur * (1 - 2 * margeX)) / sujet.l, (hauteur * (1 - 2 * margeY)) / sujet.h);
  const l = sujet.l * k, h = sujet.h * k;
  return { x: (largeur - l) / 2, y: (hauteur - h) / 2, l, h };
}
