/**
 * Recherche « filtre » de la Régie PC et de la régie : à chaque lettre tapée, la liste ne garde que ce qui contient
 * le texte (n'importe où, sans accents ni majuscules), et les meilleurs résultats passent devant.
 * Avec « ma » : « Maison » (le nom commence par « ma ») avant « La marelle » (un mot commence par « ma ») avant
 * « Tomate » (contient « ma ») avant ce qui ne le contient que dans ses mots-clés. Rien n'est caché, seulement rangé.
 */

export const sansAccent = (x) => `${x ?? ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae");

const nette = (x) => sansAccent(x).trim().replace(/\s+/g, " ");
const lettre = /[\p{L}\p{N}]/u;

/** Où [q] apparaît dans [texte] (déjà sans accents) : 0 au début, 1 au début d'un mot, 2 ailleurs, -1 nulle part. */
function place(texte, q) {
  let i = texte.indexOf(q);
  if (i < 0) return -1;
  if (i === 0) return 0;
  let mieux = 2;
  for (; i >= 0; i = texte.indexOf(q, i + 1)) {
    if (!lettre.test(texte[i - 1])) { mieux = 1; break; }
  }
  return mieux;
}

const liste = (x) => (Array.isArray(x) ? x : [x]).filter((t) => t !== null && t !== undefined && `${t}` !== "");

/**
 * Rang d'un élément pour [recherche] (plus petit = mieux) : 0 à 2 selon la place du texte dans un de ses [noms]
 * (titre, artiste, réponse…), 3 ou 4 s'il n'est que dans le reste ([autres] : catégorie, mots-clés…), 5 sinon.
 */
export function rangRecherche(noms, recherche, autres = []) {
  const q = nette(recherche);
  if (!q) return 0;
  let rang = 5;
  for (const n of liste(noms)) {
    const p = place(nette(n), q);
    if (p >= 0) rang = Math.min(rang, p);
  }
  if (rang < 3) return rang;
  for (const a of liste(autres)) {
    const p = place(nette(a), q);
    if (p >= 0) rang = Math.min(rang, p < 2 ? 3 : 4);
  }
  return rang;
}

/**
 * [items] rangés pour [recherche] : les meilleurs d'abord, l'ordre d'origine gardé entre deux résultats aussi bons
 * (dates, groupes…). [noms] et [autres] : ce qu'on lit d'un élément (un texte ou une liste). Recherche vide : inchangé.
 */
export function parPertinence(items, recherche, noms, autres = () => []) {
  if (!nette(recherche)) return items;
  return items.map((x, i) => [rangRecherche(noms(x), recherche, autres(x)), i, x])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([, , x]) => x);
}

/** Tous les mots tapés se trouvent quelque part dans [textes] (dans n'importe quel ordre). */
export function contientTout(textes, recherche) {
  const mots = nette(recherche).split(" ").filter(Boolean);
  if (!mots.length) return true;
  const tout = sansAccent(liste(textes).join(" \n "));
  return mots.every((m) => tout.includes(m));
}
