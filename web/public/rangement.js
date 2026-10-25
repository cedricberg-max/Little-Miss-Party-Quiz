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
