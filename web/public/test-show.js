// Prestation de test (cedric, 24/10) : un seul bouton dans Paramètres, « 🧪 Créer la prestation de test ». Il efface
// les anciennes démos (prestations de test, leurs quiz, mimes et playlists, leurs photos dessinées et leurs comptines)
// et refait une prestation à jour : les 16 jeux, remplis par leurs 🎲 comme Sarah le ferait.

/** Clé fixe de la prestation de test : un nouveau clic la refait à neuf, jamais en double. */
export const TEST_PRESTATION = "test-prestation";
export const TEST_TITRE = "ANNIVERSAIRE TEST – Touktouka, 9 ans";
/** La fiche : une fête de 9 ans à 4 équipes, datée du jour (voir creerPrestationDeTest dans admin.js). */
export const TEST_FICHE = { childName: "Touktouka", age: 9, teams: 4 };
export const TEST_NOTES = "Prestation de TEST : les 16 jeux, remplis au 🎲 comme pour une vraie fête. "
  + "« 🧪 Créer la prestation de test » (Paramètres) la refait à neuf.";

/** Les 16 jeux, dans l'ordre d'une vraie fête ; les Coffres mystères pour finir. Jamais deux fois le même à la suite. */
export const JEUX_DU_TEST = [
  "quiz", "mimes", "blind", "zoom", "chante", "express", "illustre", "quisuis",
  "flou", "disparu", "musical", "statues", "pictionary", "gonfleur", "duel", "patate", "simon", "coffres",
];

/**
 * Le pack « Drapeaux et pays » (cedric, 28/10 : « des questions de drapeau en plus des questions des différents packs ») :
 * une fois importé, la prestation de test en pioche aussi au Quiz, au Zoom mystère et à l'Image floue.
 */
export const THEME_DRAPEAUX = "Drapeaux et pays";
export const JEUX_DRAPEAUX = ["quiz", "zoom", "flou"];

/** Clés des anciennes démos (boutons de test d'avant le 24/10), effacées par le nouveau bouton. */
export const ANCIENNES_DEMOS = {
  shows: ["test-lea-9-ans", "test-lea-tous-les-jeux"],
  quizzes: ["test-lea-9-ans", ...["quiz", "vrai-faux", "zoom", "flou", "images"].map((k) => `test-lea-tous-les-jeux-${k}`)],
  mimes: ["test-lea-tous-les-jeux-mimes"],
  playlists: ["test-lea-tous-les-jeux-comptines", "test-lea-tous-les-jeux-blind-demo"],
};

const MEDIA = /^[0-9a-f]{16}$/;

/** Clé d'un contenu de test (« 🧪 Questions de test » de la Bibliothèque) : elle commence par « test- ». */
const DE_TEST = (id) => `${id ?? ""}`.startsWith("test-");
/** Titre d'une prestation de test, copies comprises (« Copie de ANNIVERSAIRE TEST – … ») : cedric, 24/10, tout purger. */
const TITRE_DE_TEST = /ANNIVERSAIRE TEST/i;

/** Identifiants d'images et de sons (16 chiffres hexadécimaux) cités n'importe où dans [x]. */
function mediasCites(x, out = new Set()) {
  if (typeof x === "string") { if (MEDIA.test(x)) out.add(x); } else if (x && typeof x === "object") for (const v of Object.values(x)) mediasCites(v, out);
  return out;
}

/**
 * Ce que le bouton efface (rien d'autre n'est touché) : les prestations de test (origine « test », clé « test-… »,
 * titre « ANNIVERSAIRE TEST », copies comprises) et les manches gardées pour elles ou bâties sur un contenu de test ;
 * les quiz, mimes et playlists de test (anciennes démos, clés « test-… » : toute la rubrique « 🧪 Questions de test »),
 * sauf s'ils servent encore dans une autre prestation ou manche ; leurs photos dessinées et comptines, seulement quand
 * plus rien ne s'en sert, et jamais une image rangée par Sarah (avec sa fiche dans « Mes images »). La fenêtre du
 * bouton liste tout avant d'effacer.
 * Rend { shows, manches, quizzes, mimes, playlists, medias } : des listes de clés ; [medias] : identifiants d'images
 * et de sons, effacés dans les deux (l'un des deux effacements ne trouve rien).
 */
export function demosAEffacer({ shows = {}, manches = {}, quizzes = {}, mimes = {}, playlists = {}, songs = {}, contents = {}, medias = {} } = {}) {
  const showIds = Object.keys(shows).filter((id) => shows[id] && (shows[id].origin === "test" || ANCIENNES_DEMOS.shows.includes(id)
    || id === TEST_PRESTATION || DE_TEST(id) || TITRE_DE_TEST.test(shows[id].title ?? "")));
  const manchesIds = Object.keys(manches).filter((id) => manches[id] && (showIds.includes(manches[id].showId) || DE_TEST(id)
    || /"test-/.test(JSON.stringify(manches[id].round ?? null))));
  const restent = (lib, sans) => Object.entries(lib).filter(([id, x]) => x && !sans.includes(id)).map(([, x]) => x);
  // Ce qui reste des prestations et des manches : un contenu de démo qui y sert encore est gardé.
  const encore = JSON.stringify([restent(shows, showIds), restent(manches, manchesIds)]);
  const pris = (lib, anciens) => [...new Set([...anciens, ...Object.keys(lib).filter(DE_TEST)])].filter((id) => lib[id] && !encore.includes(`"${id}"`));
  const out = {
    shows: showIds, manches: manchesIds,
    quizzes: pris(quizzes, ANCIENNES_DEMOS.quizzes), mimes: pris(mimes, ANCIENNES_DEMOS.mimes), playlists: pris(playlists, ANCIENNES_DEMOS.playlists),
  };
  // Photos dessinées, comptines : celles des contenus effacés, que rien de ce qui reste ne cite.
  const effaces = [["shows", shows], ["manches", manches], ["quizzes", quizzes], ["mimes", mimes], ["playlists", playlists]]
    .map(([k, lib]) => out[k].map((id) => lib[id]));
  const gardes = mediasCites([restent(shows, out.shows), restent(manches, out.manches), restent(quizzes, out.quizzes),
    restent(mimes, out.mimes), restent(playlists, out.playlists), songs, contents]);
  return { ...out, medias: [...mediasCites(effaces)].filter((id) => !gardes.has(id) && !medias[id]) };
}

/** Le nombre de choses que le bouton efface (0 : aucune ancienne démo). */
export const nbDemos = (plan) => ["shows", "manches", "quizzes", "mimes", "playlists", "medias"].reduce((t, k) => t + (plan?.[k]?.length ?? 0), 0);
