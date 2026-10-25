/**
 * Rangement des packs dans la Bibliothèque (cedric, 25/10 : « quelque chose qui respecte une ligne de règles », sans
 * classement qui s'emmêle). Deux étiquettes par pack, pas une de plus : un niveau parmi trois et une famille parmi dix,
 * toujours les mêmes. Le monde précis (« Monster Hunter », « Stitch ») est le nom du pack, pas une étiquette.
 * ChatGPT les écrit dans le pack (« famille », « niveau ») ; la Régie les lit ici, et les demande à l'import si elles
 * manquent. Fonctions pures, testées.
 */

/** Les dix familles, mot pour mot, dans l'ordre de la Bibliothèque ; « Divers » en dernier. */
export const FAMILLES = [
  "Jeux vidéo", "Dessins animés et mangas", "Films et séries", "Musique", "Sport", "Animaux et nature",
  "Sciences et espace", "Histoire et monde", "Célébrités et YouTubeurs", "Divers",
];

/** Émoji de chaque famille, devant son nom. */
export const EMOJI_FAMILLE = {
  "Jeux vidéo": "🎮", "Dessins animés et mangas": "🎨", "Films et séries": "🎬", Musique: "🎵", Sport: "⚽",
  "Animaux et nature": "🦁", "Sciences et espace": "🚀", "Histoire et monde": "🏛️", "Célébrités et YouTubeurs": "⭐", Divers: "📦",
};

/** Les trois niveaux, les mêmes tranches d'âge que la banque de questions, sans chevauchement. */
export const NIVEAUX = ["Facile", "Moyen", "Difficile"];
export const AGES_NIVEAU = { Facile: [5, 8], Moyen: [9, 11], Difficile: [12, 15] };

const simple = (v) => `${v ?? ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const PAR_FAMILLE = new Map(FAMILLES.map((f) => [simple(f), f]));
const PAR_NIVEAU = new Map([...NIVEAUX.map((n) => [simple(n), n]), ["1", "Facile"], ["2", "Moyen"], ["3", "Difficile"]]);

/** La famille écrite dans un pack, ramenée à l'une des dix (majuscules et accents ignorés), sinon null. */
export const lireFamille = (v) => PAR_FAMILLE.get(simple(v)) ?? null;

/** Le niveau écrit dans un pack (« Facile », « moyen », « DIFFICILE »…), sinon null. */
export const lireNiveau = (v) => PAR_NIVEAU.get(simple(v)) ?? null;

/** Le niveau que donnent des âges (le milieu de la tranche), sinon null. */
export function niveauDesAges(ageMin, ageMax) {
  const a = Number.isFinite(ageMin) ? ageMin : null;
  const b = Number.isFinite(ageMax) ? ageMax : null;
  if (a == null && b == null) return null;
  const milieu = a != null && b != null ? (a + b) / 2 : a ?? b;
  return milieu <= 8 ? "Facile" : milieu <= 11 ? "Moyen" : "Difficile";
}

/** Le niveau d'un quiz enregistré : le sien, sinon celui de ses âges, sinon null. */
export const niveauDuQuiz = (quiz) => lireNiveau(quiz?.niveau) ?? niveauDesAges(quiz?.ageMin ?? null, quiz?.ageMax ?? null);

/** La famille d'un quiz enregistré : la sienne, sinon « Divers ». */
export const familleDuQuiz = (quiz) => lireFamille(quiz?.famille) ?? "Divers";

/** Les étiquettes lues dans des données de pack : `{ famille, niveau }` (null si absentes ou mal écrites). */
export function etiquettes(x, parent = null) {
  const famille = lireFamille(x?.famille) ?? lireFamille(parent?.famille);
  const niveau = lireNiveau(x?.niveau) ?? lireNiveau(x?.["difficulté"] ?? x?.difficulte) ?? lireNiveau(parent?.niveau);
  return { famille, niveau };
}

/** [cartes] (des packs) rangées par famille, dans l'ordre des dix : `[[famille, cartes]]`, familles vides comprises. */
export function parFamille(cartes = []) {
  const ordre = { Facile: 0, Moyen: 1, Difficile: 2 };
  return FAMILLES.map((f) => [f, cartes.filter((c) => (c.famille ?? "Divers") === f)
    .sort((a, b) => (ordre[a.niveau] ?? 3) - (ordre[b.niveau] ?? 3) || `${a.title}`.localeCompare(`${b.title}`, "fr", { sensitivity: "base" }))]);
}

/*
 * Thèmes (cedric, 25/10, 12 h 35 : « les rubriques devraient être le nom du thème directement : Mario, Barbie, K-pop »).
 * La Bibliothèque range ses packs par thème, plus par famille : le thème est le champ « theme » du pack ; sans lui,
 * son nom sans le niveau (« Harry Potter – Moyen » → « Harry Potter »). Deux écritures proches (« kpop », « K-pop »,
 * « K Pop ») sont le même thème. La famille d'un pack reste lue et gardée, mais ne range plus rien.
 */

/** La clé d'un thème : lettres et chiffres seulement, sans accents ni majuscules (« K-pop » = « kpop »). */
export const cleTheme = (t) => simple(t).replace(/ /g, "");

/** Fin d'un nom qui dit le niveau : « – Facile », « (Moyen) », « - niveau 3 ». */
const NIVEAU_EN_FIN = /\s*[-–—:(,]*\s*(?:niveau\s*[123]|facile|moyen|difficile)\s*\)?\s*$/i;

/** Le thème d'un pack : [theme], sinon [titre] sans son niveau, sinon « Sans thème ». */
export function themeDe(theme, titre) {
  const t = `${theme ?? ""}`.replace(/\s+/g, " ").trim();
  if (t) return t;
  const sansNiveau = `${titre ?? ""}`.replace(NIVEAU_EN_FIN, "").replace(/\s+/g, " ").trim();
  return sansNiveau || `${titre ?? ""}`.trim() || "Sans thème";
}

/** Le thème d'un quiz enregistré. */
export const themeDuQuiz = (quiz) => themeDe(quiz?.theme, quiz?.title);

/** [nom] écrit comme le thème déjà là qui se confond avec lui (« kpop » → « K-pop Demon Hunters » si c'est sa clé), sinon tel quel. */
export function themeExistant(nom, existants = []) {
  const cle = cleTheme(nom);
  return (cle && existants.find((t) => cleTheme(t) === cle)) || `${nom ?? ""}`.replace(/\s+/g, " ").trim();
}

/**
 * [cartes] (des packs `{ theme, title, niveau }`) rangées par thème : `[[thème, cartes]]`, thèmes dans l'ordre
 * alphabétique ; un thème s'écrit comme la plupart de ses packs l'écrivent ; dans un thème, Facile, Moyen, Difficile.
 */
export function parTheme(cartes = []) {
  const groupes = new Map();
  for (const c of cartes) {
    const nom = themeDe(c.theme, c.title);
    const cle = cleTheme(nom) || nom;
    if (!groupes.has(cle)) groupes.set(cle, { noms: new Map(), cartes: [] });
    const g = groupes.get(cle);
    g.noms.set(nom, (g.noms.get(nom) ?? 0) + 1);
    g.cartes.push(c);
  }
  const ordre = { Facile: 0, Moyen: 1, Difficile: 2 };
  return [...groupes.values()]
    .map((g) => [[...g.noms].sort((a, b) => b[1] - a[1])[0][0], g.cartes.sort((a, b) => (ordre[a.niveau] ?? 3) - (ordre[b.niveau] ?? 3)
      || `${a.title}`.localeCompare(`${b.title}`, "fr", { sensitivity: "base" }))])
    .sort(([a], [b]) => a.localeCompare(b, "fr", { sensitivity: "base" }));
}

/**
 * Le thème déjà là où ranger un pack nommé [nom] (cedric, 25/10 : « la Régie me propose sur quel thème elle a prévu de
 * joindre ce pack ») : la même clé, sinon un thème dont la clé contient la sienne ou l'inverse (« kpop » et « K-pop
 * Demon Hunters »), le plus proche en longueur ; null : un nouveau thème.
 */
export function themeProche(nom, existants = []) {
  const cle = cleTheme(nom);
  if (!cle) return null;
  const exact = existants.find((t) => cleTheme(t) === cle);
  if (exact) return exact;
  const proches = existants.filter((t) => {
    const c = cleTheme(t);
    return Math.min(c.length, cle.length) >= 4 && (c.includes(cle) || cle.includes(c));
  });
  return proches.sort((a, b) => Math.abs(cleTheme(a).length - cle.length) - Math.abs(cleTheme(b).length - cle.length))[0] ?? null;
}
