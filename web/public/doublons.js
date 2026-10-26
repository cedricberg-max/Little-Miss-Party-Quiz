/**
 * Images en double (cedric, 25/10 : « beaucoup d'images en doublon » dans les images des packs) : la même image
 * téléchargée deux fois sous deux noms de fichier (ou à deux tailles), chacune citée par un pack. On les reconnaît à
 * l'œil : une petite empreinte de couleurs (GRILLE × GRILLE cases) et les proportions. Deux images différentes sur le
 * même fond (« Bill Balle fond noir », « Bob-omb fond noir ») ont des cases très différentes là où est le sujet : elles
 * ne se confondent jamais. Ici, la partie pure (testée) ; l'empreinte se calcule dans le navigateur (empreinteImage).
 */

/** Côté de la grille de l'empreinte. */
export const GRILLE = 16;
/** Écart moyen (0 à 255) au-dessus duquel deux images sont différentes. */
export const ECART_MOYEN = 8;
/** Écart d'une case (0 à 255) qui la dit différente ; au plus PART_CASES de cases différentes. */
export const ECART_CASE = 48;
export const PART_CASES = 0.02;
/** Écart de proportions (largeur / hauteur) toléré, en part. */
export const ECART_RATIO = 0.06;

/**
 * Empreinte de pixels RGBA déjà réduits à GRILLE × GRILLE : `{ px, ratio, taille }` ([px] : RGB, 3 octets par case ;
 * [ratio] et [taille] : ceux de l'image d'origine).
 */
export function empreinteDePixels(rgba, largeur, hauteur) {
  const px = new Uint8Array(GRILLE * GRILLE * 3);
  for (let i = 0; i < GRILLE * GRILLE; i++) {
    px[i * 3] = rgba[i * 4];
    px[i * 3 + 1] = rgba[i * 4 + 1];
    px[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return { px, ratio: largeur / Math.max(1, hauteur), taille: largeur * hauteur };
}

/** Deux empreintes sont-elles la même image (à la taille près) ? */
export function memeImage(a, b) {
  if (!a || !b) return false;
  if (Math.abs(a.ratio - b.ratio) > ECART_RATIO * Math.max(a.ratio, b.ratio)) return false;
  let total = 0;
  let differentes = 0;
  const cases = GRILLE * GRILLE;
  for (let i = 0; i < cases; i++) {
    const e = (Math.abs(a.px[i * 3] - b.px[i * 3]) + Math.abs(a.px[i * 3 + 1] - b.px[i * 3 + 1]) + Math.abs(a.px[i * 3 + 2] - b.px[i * 3 + 2])) / 3;
    total += e;
    if (e > ECART_CASE && ++differentes > PART_CASES * cases) return false;
  }
  return total / cases <= ECART_MOYEN;
}

/**
 * Les groupes de doublons parmi [images] (`{ id, empreinte }`, d'autres champs possibles) : des listes d'au moins deux,
 * la meilleure d'abord (la plus grande à l'origine ; à égalité, la première de la liste). [ensemble](a, b) : deux images
 * qu'on peut fusionner (d'office toutes).
 */
export function groupesDeDoublons(images, ensemble = () => true) {
  const parent = images.map((_, i) => i);
  const racine = (i) => (parent[i] === i ? i : (parent[i] = racine(parent[i])));
  for (let i = 0; i < images.length; i++) {
    for (let j = i + 1; j < images.length; j++) {
      if (racine(i) === racine(j)) continue;
      if (ensemble(images[i], images[j]) && memeImage(images[i].empreinte, images[j].empreinte)) parent[racine(j)] = racine(i);
    }
  }
  const groupes = new Map();
  images.forEach((x, i) => { const r = racine(i); if (!groupes.has(r)) groupes.set(r, []); groupes.get(r).push({ x, i }); });
  return [...groupes.values()].filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => (b.x.empreinte?.taille ?? 0) - (a.x.empreinte?.taille ?? 0) || a.i - b.i).map(({ x }) => x));
}

/**
 * Remplace, partout dans [racine] (les contenus de la bibliothèque : `{ quizzes, shows, … }`), chaque identifiant
 * d'image de [vers] (copie → gardée) : en valeur (imageId, choiceImages, images de Qui suis-je…) comme en clé (alertes
 * d'images par identifiant). Rend les écritures `{ chemin: valeur }` (chemins sous [prefixe]) ; une entrée touchée
 * reçoit aussi [horodatage] dans son updatedAt si [horodater](collection) le veut.
 */
export function repointer(racine, vers, { prefixe = "library", horodatage = null, horodater = () => true } = {}) {
  const out = {};
  const touchees = new Set();
  const parcourir = (x, chemin, entree) => {
    if (!x || typeof x !== "object") return;
    for (const [k, v] of Object.entries(x)) {
      const ici = `${chemin}/${k}`;
      if (vers.has(k)) {
        out[ici] = null;
        out[`${chemin}/${vers.get(k)}`] = typeof v === "string" && vers.has(v) ? vers.get(v) : v;
        touchees.add(entree);
        continue;
      }
      if (typeof v === "string" && vers.has(v)) { out[ici] = vers.get(v); touchees.add(entree); } else if (v && typeof v === "object") parcourir(v, ici, entree);
    }
  };
  for (const [collection, entrees] of Object.entries(racine ?? {})) {
    for (const [id, x] of Object.entries(entrees ?? {})) parcourir(x, `${prefixe}/${collection}/${id}`, `${collection}/${id}`);
  }
  for (const e of touchees) if (horodatage != null && horodater(e.split("/")[0])) out[`${prefixe}/${e}/updatedAt`] = horodatage;
  return out;
}

/**
 * Empreinte d'une image ([src] : son adresse, data: comprise), dans le navigateur : réduite en deux temps (moins de
 * bruit qu'une seule réduction), avec sa taille d'origine.
 */
export function empreinteImage(src) {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => {
      const passe = document.createElement("canvas");
      passe.width = passe.height = GRILLE * 4;
      const c1 = passe.getContext("2d");
      c1.imageSmoothingQuality = "high";
      c1.drawImage(img, 0, 0, passe.width, passe.height);
      const fin = document.createElement("canvas");
      fin.width = fin.height = GRILLE;
      const c2 = fin.getContext("2d", { willReadFrequently: true });
      c2.imageSmoothingQuality = "high";
      c2.drawImage(passe, 0, 0, GRILLE, GRILLE);
      ok(empreinteDePixels(c2.getImageData(0, 0, GRILLE, GRILLE).data, img.naturalWidth, img.naturalHeight));
    };
    img.onerror = () => ko(new Error("image illisible"));
    img.src = src;
  });
}
