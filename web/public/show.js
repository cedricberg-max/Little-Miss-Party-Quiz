// Prestation : ce que Sarah prépare dans l'administration (prénom, âge, profil, manches dans l'ordre)
// et que la régie charge sur la TV. Fonctions pures, sans Firebase.
import { PROFILES, profileForAge, defaultDuration, expressDuration } from "./profiles.js";
import { shuffle, MIME_CATALOG } from "./mime-cards.js";
import { CHANTE_WORDS, QUI_SUIS_JE, DISPARU_THEMES } from "./buzz-cards.js";
import { PICTO_WORDS, PICTO_OWN_SERIES } from "./picto-cards.js";
import { concepts, questionConcepts, neufsSiPossible } from "./jamais-deux-fois.js";
import { BANQUE, questionBanque, avecPhoto, disparuPhotos, imageLibre } from "./banque-photos.js";
import { TEAM_COLORS } from "./theme.js";

/**
 * Portes mystères (jeu final) : 3 ou 4 portes, chacune cache un bonus ou un malus qui peut renverser le classement ;
 * un malus ne fait jamais descendre une équipe sous 0 (réglé par le moteur de la TV).
 */
export const PORTES_DOORS = [3, 4];
export const PORTES_DEFAULT = 4;
export const PORTES_SEC = 30;
export const PORTES_VALUES = { 3: [300, 100, -150], 4: [300, 150, 50, -150] };
export const PORTES_RULE = "chaque équipe choisit une porte sur sa tablette : derrière, un bonus ou un malus qui peut tout renverser ! Plusieurs équipes peuvent prendre la même porte";

/**
 * Les coffres mystères (remplacent les Portes mystères) : chaque équipe à son tour ouvre un coffre sur sa tablette, bonus ou
 * malus tirés au sort par la TV à l'ouverture ; après quelques tours sans danger, une bombe se cache dans un coffre et
 * arrête le jeu. Rien à préparer. Les manches « portes » déjà enregistrées se jouent en coffres mystères.
 */
export const COFFRES_RULE = "chaque équipe à son tour ouvre un coffre sur sa tablette : un bonus pour remonter au classement, ou un malus qui fait descendre ! Vers la fin, une bombe se cache dans un des coffres, et un coffre en or qui rapporte 500 points : l'équipe qui ouvre la bombe perd 300 points et le jeu s'arrête";
/**
 * Le Gonfleur fou : chaque équipe tapote sa tablette pour gonfler son ballon sur la TV ; le premier qui éclate gagne.
 * Rien à préparer. GONFLEUR_SEC = chrono de secours (le plus gros ballon gagne s'il arrive au bout).
 */
export const GONFLEUR_RULE = "chaque équipe tapote sa tablette le plus vite possible pour gonfler son ballon sur la TV : le premier qui éclate gagne 300 points, les autres 150";
export const GONFLEUR_SEC = 45;
/**
 * « Ça va exploser ! » : une bombe passe d'équipe en équipe depuis les tablettes, sa mèche (tirée au sort par la TV)
 * reste secrète. Rien à préparer.
 */
export const PATATE_RULE = "la bombe peut exploser à tout moment ! Chaque équipe s'en débarrasse en l'envoyant à une autre depuis sa tablette, en 3 secondes au plus, sinon elle lui explose dans les mains ; à chaque explosion, l'équipe qui la tient perd 100 points et toutes les autres en gagnent 100. Trois bombes par partie";
/** Type de manche joué : les anciennes Portes mystères deviennent les Coffres mystères. */
export const roundType = (type) => (type === "portes" ? "coffres" : type);

/** Jeux dont les dernières questions peuvent compter double (Super Finale) : le Quiz et le Quiz illustré. */
export const hasFinale = (type) => (type ?? "quiz") === "quiz" || type === "illustre";

export const ROUND_TYPES = { quiz: "Quiz", illustre: "Quiz illustré", finale: "Super Finale", express: "Vrai ou Faux express", zoom: "Zoom mystère", flou: "Image floue", chante: "Chante le mot !", quisuis: "Qui suis-je ?", disparu: "Qui a disparu ?", blind: "Blind test", musical: "Quiz musical", statues: "Statues musicales", mimes: "Mimes", pictionary: "Pictionary", coffres: "Les Coffres mystères", portes: "Les Coffres mystères", gonfleur: "Le Gonfleur fou", patate: "Ça va exploser !" };
/** Statues musicales : durées proposées (secondes) et durée par défaut. Sans chanson choisie : musique maison de la TV. */
export const STATUES_SECONDS = [60, 90, 120];
export const STATUES_SEC = 90;
/** Statues musicales : longueur des chansons gardées (secondes) ; plus longues que les extraits du blind test. */
export const STATUES_EXTRACTS = [60, 90];
export const STATUES_EXTRACT = 60;
/** Au plus autant de chansons dans une manche de statues (même limite que la TV). */
export const MAX_STATUES_SONGS = 20;
/** La liste des chansons des statues : une playlist marquée `use: "statues"`, gérée depuis la page du jeu. */
export const isStatuesList = (p) => p?.use === "statues";
/** Toutes les chansons des statues (titre et extrait enregistré), dans l'ordre de la liste. */
export const statuesSongs = (playlists) => Object.values(playlists ?? {}).filter(isStatuesList).flatMap((p) => playableTracks(p));
/**
 * Chansons que les statues peuvent jouer : celles de la liste des statues d'abord, puis celles de toutes les autres
 * playlists (titre de la playlist dans `list`), chacune une seule fois. Une nouvelle manche ne coche que la liste.
 */
export function statuesChoices(playlists) {
  const seen = new Set();
  const lists = Object.values(playlists ?? {}).filter((p) => p?.title || isStatuesList(p))
    .sort((a, b) => (isStatuesList(b) ? 1 : 0) - (isStatuesList(a) ? 1 : 0) || (a.title ?? "").localeCompare(b.title ?? "", "fr"));
  return lists.flatMap((p) => playableTracks(p).map((t) => ({ ...t, list: isStatuesList(p) ? "Chansons des statues" : p.title })))
    .filter((t) => !seen.has(t.audioId) && seen.add(t.audioId));
}
/** Chansons choisies pour une manche, dans l'ordre des listes ; celles retirées des playlists depuis sont ignorées. */
export function roundSongs(round, playlists) {
  const chosen = new Set(Array.isArray(round?.songs) ? round.songs : []);
  return statuesChoices(playlists).filter((t) => chosen.has(t.audioId)).slice(0, MAX_STATUES_SONGS);
}
/**
 * Pictionary : équipe par équipe, un mot par tour ; temps de dessin proposés (secondes), celui par défaut, et
 * points d'un dessin trouvé. Les mots viennent du catalogue intégré (réglable dans la page du jeu).
 */
export const PICTO_SECONDS = [60, 90, 120];
export const PICTO_SEC = 90;
export const PICTO_POINTS = 150;
export const PICTO_RULE = "équipe par équipe, un enfant dessine le mot sur la tablette, son équipe devine en regardant la TV";
/** Jeux musicaux : leurs extraits viennent d'une playlist de la bibliothèque (library/playlists). */
export const MUSIC_GAMES = {
  blind: { rule: "le premier qui buzze donne le titre ; les derniers morceaux valent double" },
  musical: { rule: "4 titres proposés sur les pupitres, toutes les équipes répondent" },
};
/** Durée d'un extrait de blind test par défaut (secondes) : le temps de buzzer, chrono compris. */
export const BLIND_SEC = 30;
/**
 * Barème d'un blind test par défaut : valeur d'un morceau, valeur des derniers morceaux, combien de derniers
 * morceaux valent plus, et secondes de révélation (pochette, titre, extrait rejoué). Réglable par playlist.
 */
export const BLIND_SCALE = { points: 100, finalPoints: 200, finalCount: 3, reveal: 7 };
/** Durée de la révélation d'un morceau du blind test, en secondes ; 0 = tout l'extrait (le temps de chanter). */
export const BLIND_REVEAL_SECONDS = [4, 5, 7, 10, 15, 20, 30, 0];
const bounded = (v, min, max, fallback) => (Number.isInteger(v) && v >= min && v <= max ? v : fallback);

/** Barème d'une playlist, valeurs manquantes ou hors limites remplacées par celles par défaut. */
export function blindScale(playlist) {
  return {
    points: bounded(playlist?.points, 1, 1000, BLIND_SCALE.points),
    finalPoints: bounded(playlist?.finalPoints, 1, 1000, BLIND_SCALE.finalPoints),
    finalCount: bounded(playlist?.finalCount, 0, 20, BLIND_SCALE.finalCount),
    reveal: playlist?.reveal === 0 ? 0 : bounded(playlist?.reveal, 3, 60, BLIND_SCALE.reveal),
  };
}

/** Valeur du morceau [i] sur [n] : celle choisie pour ce morceau, sinon celle des derniers morceaux ou la normale. */
export function trackPoints(playlist, track, i, n) {
  const scale = blindScale(playlist);
  if (Number.isInteger(track?.points) && track.points >= 1 && track.points <= 1000) return track.points;
  return i >= n - scale.finalCount ? scale.finalPoints : scale.points;
}
/** Image floue : temps pour que la photo devienne nette (secondes), le même pour tous les âges. */
export const FLOU_SEC = 40;
/** Durée d'un tour de mimes par défaut (secondes). */
export const MIME_TURN = 60;
export const MAX_QUESTIONS = 200;

/**
 * Titre proposé d'office dans la fiche (cedric, 23/10) : « Anniversaire de Frédéric », « Anniversaire d'Emma » ;
 * rien sans prénom.
 */
export function titreAuto(prenom) {
  const p = prenom?.trim();
  if (!p) return "";
  return /^[aeiouyàâäéèêëîïôöùûüœæ]/i.test(p) ? `Anniversaire d'${p}` : `Anniversaire de ${p}`;
}

/** Nom d'une prestation : son titre, sinon « Anniversaire de » + le prénom (le même que celui proposé dans la fiche). */
export function showTitle(show) {
  return show.title?.trim() || (show.childName?.trim() ? titreAuto(show.childName)
    // Copie pas encore complétée : le nom de son modèle (Dupliquer).
    : show.copieDe?.trim() ? `Copie de « ${show.copieDe.trim()} »` : "Prestation");
}

/** Questions jouables d'un quiz : celles que Sarah a validées et sans anomalie bloquante. */
export function playable(quiz) {
  return (quiz?.questions ?? []).filter((q) => q && q.status === "validee" && (q.kind === "number"
    ? Number.isInteger(q.correct)
    : q.correct >= 0 && q.correct < (q.choices?.length ?? 0)));
}

const isYesNo = (q) => q.kind !== "number" && q.choices?.length === 2 && q.choices.map((c) => c.toLowerCase()).join("/") === "vrai/faux";

/** Affirmations jouables au Vrai ou Faux express : les questions Vrai / Faux validées du quiz. */
export const expressQuestions = (quiz) => playable(quiz).filter(isYesNo);

/**
 * Questions jouables au Quiz illustré (les petits, dès 5 ans) : celles d'un quiz illustré, chaque réponse est une
 * photo avec son mot. Un quiz classique n'en a pas : il se joue au Quiz.
 */
export const illustreQuestions = (quiz) => (quizKind(quiz) === "photo" ? playable(quiz) : []);

/** Questions jouables au Quiz (réponses écrites) : celles d'un quiz qui n'est pas un quiz illustré. */
export const quizQuestions = (quiz) => (quizKind(quiz) === "photo" ? [] : playable(quiz));

/** Questions jouables au Zoom mystère : les questions à propositions validées qui ont une photo. */
export const zoomQuestions = (quiz) => playable(quiz).filter((q) => q.kind !== "number" && /^[0-9a-f]{16}$/.test(q.imageId ?? ""));

/** Mini-jeux construits à partir d'un quiz : les questions retenues et ce qui manque quand il n'y en a pas. */
export const QUIZ_GAMES = {
  illustre: { questions: illustreQuestions, unit: "question", missing: "aucune question validée à réponses en images (choisissez un quiz illustré)" },
  express: { questions: expressQuestions, unit: "affirmation", missing: "aucune question Vrai / Faux validée pour le Vrai ou Faux express" },
  zoom: { questions: zoomQuestions, unit: "photo", missing: "aucune question avec photo pour le Zoom mystère (ajoutez des photos dans le quiz)" },
  flou: { questions: zoomQuestions, unit: "photo", missing: "aucune question avec photo pour l'Image floue (ajoutez des photos dans le quiz)" },
};

/**
 * Type d'un quiz : « photo » (petits : chaque réponse est une photo avec son mot), « images » (photos à deviner,
 * pour l'Image floue et le Zoom mystère) ou « classique » (réponses écrites, petite photo à la révélation).
 * Les quiz enregistrés avant le choix du type le retrouvent d'après leur contenu.
 */
export function quizKind(quiz) {
  if (["photo", "classique", "images"].includes(quiz?.kind)) return quiz.kind;
  if (quiz?.source === "photos") return "images";
  const photoAnswers = (quiz?.questions ?? []).some((q) => q?.choiceImages && Object.values(q.choiceImages).some(Boolean));
  return quiz?.source === "banque" || photoAnswers ? "photo" : "classique";
}

/**
 * Une manche « Quiz » faite seulement de quiz illustrés (préparée avant que le Quiz illustré ait sa tuile, le
 * 21 octobre) est un Quiz illustré : même écran d'ouverture sur la TV, même page dans la Régie PC. Les autres
 * manches sont rendues telles quelles.
 */
export function jeuDeLaManche(round, quizzes = {}) {
  const ids = roundQuizIds(round);
  if (!round || (round.type ?? "quiz") !== "quiz" || !ids.length || roundTirees(round).length || roundSeriesQuiz(round).length) return round;
  return ids.every((id) => quizzes?.[id] && quizKind(quizzes[id]) === "photo") ? { ...round, type: "illustre" } : round;
}

/**
 * Question des bougies (cedric, 21/10) : « Combien de bougies sur le gâteau de Léa cette année ? », au Juste Chiffre,
 * mise d'office dans le premier Quiz de chaque prestation (réponse : l'âge de l'enfant fêté). Une case de la manche
 * l'enlève ([round].bougies false). Sans prénom ou sans âge, pas de question.
 */
export const BOUGIES_SEC = 20;
export const texteBougies = (prenom) => `Le Juste Chiffre : combien de bougies sur le gâteau de ${prenom} cette année ?`;

/** Le premier Quiz (classique) de la prestation : celui qui reçoit la question des bougies. */
export const premierQuiz = (rounds, quizzes = {}) => (rounds ?? []).find((r) => r && jeuDeLaManche(r, quizzes).type === "quiz") ?? null;

/** La question des bougies de [show], ou null (pas de prénom ou d'âge, case décochée). */
export function questionBougies(show, round) {
  const prenom = show?.childName?.trim();
  const age = Number(show?.age);
  if (!prenom || !Number.isInteger(age) || age < 1 || age > 99 || round?.bougies === false) return null;
  return { text: texteBougies(prenom), kind: "number", correct: age, duration: BOUGIES_SEC, status: "validee", bougies: true };
}

/**
 * Jeux au buzzer à contenu intégré (inspirés de « Vendredi tout est permis ») : rien à préparer, la
 * manche tire [count] éléments au hasard dans le catalogue, adaptés à l'âge (level 2 : pas pour les Petits).
 */
export const BUILTIN_GAMES = {
  chante: {
    unit: "mot", count: 6, duration: 30, rule: "le premier qui buzze chante une chanson avec ce mot",
    items: (profile, random, list, round, chosen) => (chosen ? list : list.filter((w) => profile !== "PETITS" || w.level === 1)),
    question: (w) => ({ text: w.word, choices: [w.word], correct: 0, kind: "chante" }),
  },
  quisuis: {
    unit: "personnage", count: 5, duration: 40, rule: "un indice de plus toutes les 10 secondes",
    items: (profile, random, list, round, chosen) => (chosen ? list : list.filter((p) => profile !== "PETITS" || p.level === 1)),
    // Le personnage se montre à la révélation : son image (préparée dans l'administration), sinon son émoji.
    question: (p) => ({ text: "Qui suis-je ?", choices: [p.answer], correct: 0, kind: "quisuis", cards: p.clues.map((word) => ({ word })), image: p.emoji, ...(p.imageId ? { imageId: p.imageId } : {}) }),
  },
  disparu: {
    unit: "grille", count: 4, duration: 45, rule: "on mémorise les objets, puis l'un d'eux disparaît",
    // Nombre d'objets par grille : réglé sur la manche (4 à 12), sinon selon l'âge.
    items: (profile, random, list, round, chosen, pris) => list.map((t) => disparuGrid(t, disparuObjects(round, profile), random, pris, round?.photos === true)),
    // Objet en photo à soi, sans émoji : pas d'émoji de réponse (la TV montre sa photo).
    question: (g) => ({ text: "Qui a disparu ?", choices: [g.missing.word], correct: 0, kind: "disparu", cards: g.objects, ...(g.missing.image ? { image: g.missing.image } : {}), duration: g.duration }),
  },
};

/**
 * Contenus des jeux intégrés réglables dans l'administration (page du jeu) : `library/contents/<jeu>` garde
 * les éléments du catalogue retirés (`off`, leurs clés) et les ajouts de Sarah (`extra`). Le catalogue du
 * code n'est jamais modifié ; un ajout mal formé est ignoré, il n'empêche jamais de jouer.
 */
export const CONTENT_GAMES = {
  chante: {
    unit: "mot", catalog: CHANTE_WORDS, key: (w) => w.word.toLowerCase(), label: (w) => w.word,
    clean: (x) => (typeof x?.word === "string" && x.word.trim() ? { word: x.word.trim().slice(0, 40), level: 1 } : null),
  },
  quisuis: {
    unit: "personnage", catalog: QUI_SUIS_JE, key: (p) => p.answer.toLowerCase(), label: (p) => `${p.emoji ?? ""} ${p.answer}`.trim(),
    clean: (x) => {
      const clues = (Array.isArray(x?.clues) ? x.clues : []).filter((c) => typeof c === "string" && c.trim()).map((c) => c.trim().slice(0, 120)).slice(0, 4);
      if (typeof x?.answer !== "string" || !x.answer.trim() || clues.length < 2) return null;
      return { answer: x.answer.trim().slice(0, 60), emoji: typeof x.emoji === "string" ? x.emoji.trim().slice(0, 16) : "", clues, level: 1 };
    },
  },
  pictionary: {
    unit: "mot", catalog: PICTO_WORDS, key: (w) => w.word.toLowerCase(), label: (w) => `${w.image ?? ""} ${w.word}`.trim(),
    clean: (x) => (typeof x?.word === "string" && x.word.trim()
      ? {
        word: x.word.trim().slice(0, 40), ...(typeof x.image === "string" && x.image.trim() ? { image: x.image.trim().slice(0, 16) } : {}), level: 1,
        ...(typeof x.series === "string" && x.series.trim() ? { series: x.series.trim().slice(0, 30) } : {}),
      }
      : null),
  },
  disparu: {
    // Familles en émojis, puis celles de la banque de photos (« Photos · Animaux »).
    unit: "famille", get catalog() { return [...DISPARU_THEMES, ...disparuPhotos()]; }, key: (t) => t.theme.toLowerCase(), label: (t) => t.theme,
    clean: (x) => {
      // Chaque objet : son émoji, ou une photo à soi (choisie dans la Régie PC), ou les deux.
      const photo = (o) => typeof o?.imageId === "string" && /^[0-9a-f]{16}$/.test(o.imageId);
      const emoji = (o) => typeof o?.image === "string" && o.image.trim();
      const objects = (Array.isArray(x?.objects) ? x.objects : [])
        .filter((o) => typeof o?.word === "string" && o.word.trim() && (emoji(o) || photo(o)))
        .map((o) => ({ word: o.word.trim().slice(0, 40), ...(emoji(o) ? { image: o.image.trim().slice(0, 16) } : {}), ...(photo(o) ? { imageId: o.imageId } : {}) })).slice(0, 12);
      if (typeof x?.theme !== "string" || !x.theme.trim() || objects.length < 5) return null;
      return { theme: x.theme.trim().slice(0, 60), objects };
    },
  },
};

/** Ajouts valables de Sarah pour un jeu intégré (les éléments mal formés sont écartés). */
export function contentExtras(type, content) {
  const game = CONTENT_GAMES[type];
  return (Array.isArray(content?.extra) ? content.extra : Object.values(content?.extra ?? {})).map(game.clean).filter(Boolean);
}

/** Clé d'un élément utilisable dans la base (sans . # $ [ ] /) : images des personnages de Qui suis-je ?. */
export const contentSlot = (key) => `${key}`.replace(/[.#$[\]/]/g, "_").slice(0, 80);

/** Images choisies dans l'administration pour les éléments d'un jeu (Qui suis-je ?), par clé d'élément. */
export function contentImages(content) {
  const out = {};
  for (const [k, id] of Object.entries(content?.images ?? {})) if (typeof id === "string" && /^[0-9a-f]{16}$/.test(id)) out[k] = id;
  return out;
}

/** Éléments jouables d'un jeu intégré : le catalogue sans les éléments retirés, plus les ajouts, avec leur image. */
export function activeItems(type, content) {
  const game = CONTENT_GAMES[type];
  const off = new Set((Array.isArray(content?.off) ? content.off : Object.values(content?.off ?? {})).map((k) => `${k}`.toLowerCase()));
  const images = contentImages(content);
  return [...game.catalog, ...contentExtras(type, content)].filter((x) => !off.has(game.key(x)))
    .map((x) => (images[contentSlot(game.key(x))] ? { ...x, imageId: images[contentSlot(game.key(x))] } : x));
}

/**
 * Qui a disparu ? en « 📷 Photos » : au tirage, les grilles tout en photos d'abord (familles de la banque), puis celles
 * qui en montrent au moins 3, puis les autres ; le hasard décide dans chaque groupe. Les autres jeux : inchangé.
 */
function parPhotos(round, grilles) {
  if (round?.type !== "disparu" || round.photos !== true) return grilles;
  return parPalierPhotos(grilles, (g) => g.objects);
}

/**
 * Familles ou grilles de Qui a disparu ? rangées pour le mode « 📷 Photos » : tout en photos d'abord, puis au moins
 * 3 photos, puis les autres ; l'ordre de départ (le hasard) est gardé dans chaque groupe. [objets](x) : ses objets.
 */
export function parPalierPhotos(liste, objets) {
  const palier = (x) => {
    const tous = objets(x) ?? [];
    const n = tous.filter((o) => o?.banque || o?.imageId || avecPhoto(o)?.banque).length;
    return n && n === tous.length ? 2 : n >= 3 ? 1 : 0;
  };
  return liste.map((x, k) => [x, k, palier(x)]).sort(([, i, a], [, j, b]) => b - a || i - j).map(([x]) => x);
}

/** Famille de Qui a disparu ? faite de photos de la banque. */
export const isPhotoTheme = (t) => (t?.objects ?? []).some((o) => o?.banque);

/** Catégorie d'une famille de Qui a disparu ? dans les listes : photos de la banque, photos à soi, ou émojis. */
export const disparuGroup = (t) => (isPhotoTheme(t) ? "Photos de la banque" : (t?.objects ?? []).some((o) => o?.imageId) ? "Mes photos" : "Émojis");

/** Qui a disparu ? : objets par grille selon l'âge, et temps de recherche après la mémorisation. */
const DISPARU_OBJECTS = { PETITS: 5, MOYENS: 7, GRANDS: 9, ADULTES: 9 };
const DISPARU_SEARCH_SEC = 25;

/** Objets par grille d'une manche Qui a disparu ? : le réglage de la manche (4 à 12), sinon celui de l'âge. */
export const disparuObjects = (round, profile) =>
  Number.isInteger(round?.objects) && round.objects >= 4 && round.objects <= 12 ? round.objects : DISPARU_OBJECTS[profile] ?? 7;

/**
 * Une grille de Qui a disparu ? : [n] objets de la famille et celui qui disparaîtra. La durée suit le
 * moteur de la TV : 2 s de mémorisation par objet (10 à 18 s), 3 s de tour de magie, puis la recherche.
 */
function disparuGrid(theme, n, random, pris = null, photos = false) {
  // « Jamais deux fois » : pas d'objet déjà montré ailleurs dans la prestation, tant que la famille en a assez.
  // « 📷 Photos » : chaque objet dont le mot est dans la banque montre sa photo (copiée dans la partie par la régie).
  const objects = shuffle(neufsSiPossible(theme.objects, concepts, pris, n), random).slice(0, n).map((o) => (photos ? avecPhoto(o) : o));
  const missing = objects[Math.floor(random() * objects.length)];
  const memo = Math.min(18, Math.max(10, objects.length * 2));
  return { theme: theme.theme, objects, missing, duration: memo + 3 + DISPARU_SEARCH_SEC };
}

/** Une manche est-elle complète (quiz choisi, ou paquet de mimes choisi) ? Les jeux intégrés le sont toujours. */
/** Série d'un mot du Pictionary ; un mot ajouté sans série va dans « Mes mots ». */
export const pictoSeriesOf = (w) => (typeof w?.series === "string" && w.series.trim() ? w.series.trim() : PICTO_OWN_SERIES);

/** Les séries de ces mots, dans l'ordre où elles apparaissent. */
export const pictoSeriesList = (words) => [...new Set(words.map(pictoSeriesOf))];

/** Super Finale : nombre de dernières questions du quiz à ×2 quand une ancienne manche est convertie. */
export const SUPER_FINALE_LAST = 3;

/**
 * Ancienne manche « Super Finale » (avant la 0.1.271) : ce n'est pas un jeu. Elle disparaît de la liste et
 * devient le réglage du quiz qui la précède (ses dernières questions ×2). Sans quiz avant elle, elle devient
 * une manche Quiz ordinaire dont les dernières questions comptent double. [folded] : manches converties.
 */
export function foldLegacyFinale(list) {
  const rounds = [];
  let folded = 0;
  let converted = 0;
  for (const r of (list ?? []).filter(Boolean)) {
    // Les Portes mystères sont remplacées par les Coffres mystères (cedric, 20 octobre).
    if (r.type === "portes") { rounds.push({ type: "coffres" }); converted++; continue; }
    if (r.type !== "finale") { rounds.push({ ...r }); continue; }
    folded++;
    const host = [...rounds].reverse().find((x) => (x.type ?? "quiz") === "quiz");
    if (host) { if (!(host.finale > 0)) host.finale = SUPER_FINALE_LAST; }
    else rounds.push({ type: "quiz", quizId: r.quizId, finale: SUPER_FINALE_LAST });
  }
  return { rounds, folded, converted };
}

/** Séries retenues pour une manche de Pictionary, ou null pour toutes. */
export const pictoRoundSeries = (round) => {
  const list = Array.isArray(round?.series) ? round.series.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : [];
  return list.length ? list : null;
};

export const roundFilled = (round) => !!(round && (BUILTIN_GAMES[round.type] || round.type === "statues" || round.type === "pictionary" || round.type === "portes" || round.type === "coffres" || round.type === "gonfleur" || round.type === "patate" ? true
  : round.type === "mimes" ? round.deckId || round.random === true || mimeCards(round.cards).length
  : MUSIC_GAMES[round.type] ? round.playlistId || roundTracks(round).length
  : (round.type === "zoom" || round.type === "flou") && roundPicks(round).length ? true
  : roundSeriesQuiz(round).some((x) => x.origine === "quiz" || questionsEnLigne(x.questions).length) || roundTirees(round).length || roundQuizIds(round).length));

/** Au plus autant de questions tirées au 🎲 dans une manche Quiz. */
export const MAX_TIREES = 20;

/**
 * Questions du quiz classique tout prêt tirées au 🎲 dans une manche Quiz (cedric, 23/10), gardées dans la manche :
 * à 4 réponses { id, text, choices (déjà mélangées), correct, banque (clé de sa photo) ou emoji }, ou Juste Chiffre
 * { id, text, nombre: true, correct (le nombre) }. Jouées dans cet ordre ; une question retirée ({ vide: true }, en
 * attente de son 🎲) n'est pas jouée.
 */
export const roundTirees = (round) => ((round?.type ?? "quiz") === "quiz" ? questionsEnLigne(round?.tirees) : []).slice(0, MAX_TIREES);

/**
 * Questions gardées dans la manche (tirées au 🎲, écrites à la main, reprises d'une autre manche), jouables : texte,
 * 2 à 4 réponses et la bonne, ou Juste Chiffre et son nombre. Une case vide ou une question pas finie est sautée.
 */
const questionsEnLigne = (list) => listOf(list)
  .filter((q) => q && q.vide !== true && typeof q.text === "string" && q.text.trim())
  .map((q) => {
    if (q.nombre === true) return { ...q, choices: [] };
    // Une réponse laissée vide (question écrite à la main) ne compte pas ; la bonne garde sa place.
    const brutes = listOf(q.choices);
    const gardees = brutes.map((c, k) => [c, k]).filter(([c]) => typeof c === "string" && c.trim());
    return { ...q, choices: gardees.map(([c]) => c), correct: gardees.findIndex(([, k]) => k === q.correct) };
  })
  .filter((q) => (q.nombre === true ? Number.isInteger(q.correct) : q.choices.length >= 2 && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.choices.length));
/** Une question gardée dans la manche est-elle jouable (texte, réponses, la bonne) ? */
export const questionJouable = (q) => questionsEnLigne([q]).length === 1;

/** Au plus autant de questions dans une manche Quiz (cedric, 23/10 : « 8, 10, 15, 20, 30, 50, 100 questions »). */
export const MAX_QUESTIONS_MANCHE = 100;
/** Multiplicateurs de la Super Finale ; le premier est celui d'office (comme sur la régie). */
export const FACTEURS_FINALE = [2, 3, 5];
/** Origines d'une série de questions d'une manche Quiz. */
export const ORIGINES_SERIE = ["de", "quiz", "main", "reprise"];
/**
 * Jeux dont une manche est faite de séries, comme le Quiz (cedric, 23/10 : « exactement la même architecture ») : 🎲,
 * séries rappelées d'un ancien anniversaire, séries de la bibliothèque, Super Finale, « Quiz complet ».
 */
export const JEUX_EN_SERIES = ["quiz", "illustre", "zoom", "flou", "express"];
export const estEnSeries = (type) => JEUX_EN_SERIES.includes(type ?? "quiz");
/** Jeux de photos à deviner (Zoom mystère, Image floue) : une photo par question, la réponse à trouver. */
export const JEUX_DE_PHOTOS = ["zoom", "flou"];
export const estJeuDePhotos = (type) => JEUX_DE_PHOTOS.includes(type);
/**
 * Ce qui reconnaît une question dans sa série : son texte ; au Zoom mystère et à l'Image floue, sa photo (leurs
 * questions disent toutes « Qu'est-ce que c'est ? »).
 */
export const signatureQuestion = (q, type) => (estJeuDePhotos(type) && (IMAGE_ID.test(q?.imageId ?? "") || q?.banque)
  ? (IMAGE_ID.test(q?.imageId ?? "") ? `i:${q.imageId}` : `b:${q.banque}`) : `${q?.text ?? ""}`.trim().toLowerCase());
/**
 * Questions d'un quiz de la bibliothèque jouables dans un jeu en séries : ses photos au Zoom et à l'Image floue, ses
 * Vrai / Faux au Vrai ou Faux express.
 */
export const questionsDuJeu = (type, quiz) => (estJeuDePhotos(type) ? zoomQuestions(quiz) : type === "express" ? expressQuestions(quiz) : playable(quiz));

/**
 * Séries d'une manche Quiz (cedric, 23/10 : un Quiz = une seule manche, quelle que soit l'origine de ses questions),
 * dans l'ordre de passage : { id, origine, titre? } et, selon l'origine,
 * - « de » : questions tirées au 🎲 dans la banque, gardées dans la série (`questions`, `profil` du tirage) ;
 * - « main » : questions écrites à la main dans la manche (`questions`) ;
 * - « reprise » : questions d'une autre manche, copiées (`questions`) ;
 * - « quiz » : un quiz de la bibliothèque rappelé (`quizId`), lu au lancement, sans ses questions retirées (`sans`,
 *   leurs textes) ; s'il est changé dans la bibliothèque, la manche suit.
 */
export const roundSeriesQuiz = (round) => (estEnSeries(round?.type) ? listOf(round?.seriesQuiz) : [])
  .filter((x) => x && ORIGINES_SERIE.includes(x.origine) && (x.origine === "quiz" ? typeof x.quizId === "string" && x.quizId : true))
  .map((x) => (x.origine === "quiz"
    ? { ...x, sans: listOf(x.sans).filter((t) => typeof t === "string") }
    : { ...x, questions: listOf(x.questions).filter(Boolean) }));

/**
 * Clé d'une question dans sa série, pour l'ordre du « Quiz complet » (`ordreQuiz`) : la série, puis l'identifiant de la
 * question gardée dans la série, sinon son texte (celles d'un quiz rappelé, comme leurs questions retirées).
 */
export const cleQuestion = (serie, q, type) => `${serie?.id ?? ""}|${serie?.origine !== "quiz" && typeof q?.id === "string" && q.id ? q.id : `t:${signatureQuestion(q, type)}`}`;

/** Questions jouées d'une série d'une manche de [type], avec leur clé : { cle, q } (q au format d'une question de quiz). */
function itemsDeLaSerie(serie, quizzes = {}, type = "quiz") {
  if (serie?.origine === "quiz") {
    const quiz = quizzes?.[serie.quizId];
    const sans = new Set(listOf(serie.sans).map((t) => `${t}`.trim().toLowerCase()));
    return quiz ? questionsDuJeu(type, quiz).filter((q) => !sans.has(signatureQuestion(q, type))).map((q) => ({ cle: cleQuestion(serie, q, type), q })) : [];
  }
  return questionsEnLigne(serie?.questions).map((q) => ({ cle: cleQuestion(serie, q, type), q: q.nombre
    ? { text: q.text, kind: "number", correct: q.correct, status: "validee" }
    : { text: q.text, choices: q.choices, correct: q.correct, status: "validee",
      ...(q.banque ? { banque: q.banque } : q.imageId ? { imageId: q.imageId } : q.emoji ? { image: q.emoji } : {}),
      // Quiz illustré : réponses en photos de la banque (tirées au 🎲) ou en images déjà copiées (série reprise).
      ...(Array.isArray(q.choiceBanque) ? { choiceBanque: q.choiceBanque } : {}),
      ...(q.choiceImages && typeof q.choiceImages === "object" ? { choiceImages: q.choiceImages } : {}) } }));
}

/**
 * Questions jouées d'une série, au format d'une question de quiz (validées) : celles gardées dans la série, ou celles du
 * quiz rappelé (validées, sans celles retirées). Un quiz qui n'existe plus : aucune.
 */
export const questionsDeLaSerie = (serie, quizzes = {}, type = "quiz") => itemsDeLaSerie(serie, quizzes, type).map((x) => x.q);

/** Clé de la question des bougies dans l'ordre du « Quiz complet », une fois qu'elle y a été rangée à la main. */
export const CLE_BOUGIES = "bougies";

/**
 * L'ordre de passage d'une manche Quiz faite de séries : ses questions { cle, q, serie } et, rangée à la main, la place
 * de la question des bougies ({ cle: CLE_BOUGIES, bougies: true }).
 */
function ordreDuQuiz(round, quizzes) {
  const parSerie = roundSeriesQuiz(round).map((serie) => itemsDeLaSerie(serie, quizzes, round?.type ?? "quiz").map((x) => ({ ...x, serie })));
  const rang = new Map();
  listOf(round?.ordreQuiz).forEach((c, k) => { if (typeof c === "string" && !rang.has(c)) rang.set(c, k); });
  if (!rang.size) return parSerie.flat();
  const places = [...parSerie.flat(), ...(rang.has(CLE_BOUGIES) ? [{ cle: CLE_BOUGIES, bougies: true }] : [])];
  const out = places.filter((x) => rang.has(x.cle)).sort((a, b) => rang.get(a.cle) - rang.get(b.cle));
  parSerie.forEach((liste, s) => liste.forEach((x, k) => {
    if (rang.has(x.cle)) return;
    const avant = liste.slice(0, k).reverse().find((y) => out.includes(y));
    const apres = avant ? null : liste.slice(k + 1).find((y) => out.includes(y));
    out.splice(avant ? out.indexOf(avant) + 1 : apres ? out.indexOf(apres) : s === 0 ? 0 : out.length, 0, x);
  }));
  return out;
}

/**
 * Toutes les questions d'une manche Quiz faite de séries, dans l'ordre de passage : { cle, q, serie } (au plus
 * MAX_QUESTIONS_MANCHE). D'office, les séries à la suite ; rangées à la main dans le « Quiz complet » (cedric, 23/10 :
 * ↑ ↓, 🔀), dans l'ordre gardé (`ordreQuiz`, leurs clés). Une question arrivée ensuite se met à côté de sa voisine de
 * série ; une série toute nouvelle, au début si c'est la première (le 🎲), sinon à la fin.
 */
export const questionsDuQuiz = (round, quizzes = {}) => ordreDuQuiz(round, quizzes).filter((x) => !x.bougies).slice(0, MAX_QUESTIONS_MANCHE);

/**
 * Place de la question des bougies rangée à la main dans le « Quiz complet » (cedric, 23/10 : ↑ ↓, 🔀) : le nombre de
 * questions qui passent avant elle. null : pas rangée, elle se met d'elle-même juste avant la Super Finale.
 */
export function placeDesBougies(round, quizzes = {}) {
  const k = ordreDuQuiz(round, quizzes).findIndex((x) => x.bougies);
  return k < 0 ? null : k;
}

/** Toutes les questions jouées d'une manche Quiz faite de séries, dans l'ordre de passage (au plus MAX_QUESTIONS_MANCHE). */
export const questionsDesSeries = (round, quizzes = {}) => questionsDuQuiz(round, quizzes).map((x) => x.q);

/**
 * Juste Chiffre parmi [n] questions tirées au 🎲 (cedric, 23/10 : « dans les quiz traditionnels il doit y avoir
 * certaines questions avec des chiffres ») : environ une sur quatre, jamais la première ; 8 questions → 2.
 */
export const chiffresDuTirage = (n) => Math.max(0, Math.floor((n + 1) / 4));

/** Extraits choisis un par un pour un blind test ou un quiz musical (`tracks`, leurs identifiants), dans plusieurs playlists. */
export const roundTracks = (round) => [...new Set(listOf(round?.tracks).filter((id) => typeof id === "string" && /^[0-9a-f]{16}$/.test(id)))].slice(0, MAX_PICKS);

/** Liste lue dans la base : un tableau, ou un objet indexé (tableau à trous). */
const listOf = (x) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : []);

/**
 * Quiz d'une manche tirée de quiz (Quiz, Vrai ou Faux, Zoom, Image floue) : un ou plusieurs, choisis par Sarah
 * (`quizIds`), sinon le seul `quizId`. Leurs questions s'enchaînent dans cet ordre ; jamais de tirage au hasard.
 */
export const roundQuizIds = (round) => [...new Set((roundSeriesQuiz(round).length ? roundSeriesQuiz(round).filter((x) => x.origine === "quiz").map((x) => x.quizId)
  : listOf(round?.quizIds).length ? listOf(round.quizIds) : [round?.quizId])
  .filter((id) => typeof id === "string" && id))];

/** Cartes de mimes valables (un mot, une image facultative). */
export const mimeCards = (list) => listOf(list).filter((c) => typeof c?.word === "string" && c.word.trim())
  .map((c) => ({
    word: c.word.trim().slice(0, 40),
    ...(typeof c.image === "string" && c.image.trim() ? { image: c.image.trim().slice(0, 16) } : {}),
    // Photo à soi, choisie dans la Régie PC : elle remplace l'émoji sur la TV.
    ...(typeof c.imageId === "string" && /^[0-9a-f]{16}$/.test(c.imageId) ? { imageId: c.imageId } : {}),
  }));

/** Cartes tirées par « Mimes au hasard » quand Sarah n'a rien précisé. */
export const MIME_RANDOM = 30;

/** Cartes où piocher une manche de mimes : celles du paquet choisi, sinon le catalogue adapté à l'âge (pas de cartes difficiles pour les Petits). */
export function mimePool(round, mimes, profile) {
  const deck = round?.deckId ? mimes?.[round.deckId] : null;
  if (deck) return mimeCards(deck.cards);
  return mimeCards(MIME_CATALOG.filter((c) => profile !== "PETITS" || c.level === 1));
}

/** Tirage au hasard d'une manche de mimes : tout le paquet mélangé, ou [MIME_RANDOM] cartes du catalogue. */
export function mimeDraw(round, mimes, profile, random = Math.random, avoid = null, pris = null) {
  const deck = round?.deckId && mimes?.[round.deckId];
  const count = Number.isInteger(round?.count) && round.count > 0 ? round.count : MIME_RANDOM;
  const fresh = mimePool(round, mimes, profile).filter((c) => !avoid?.has(c.word.toLowerCase()));
  // Un paquet choisi se joue en entier ; un tirage dans le catalogue évite ce que montrent les autres activités.
  const pool = shuffle(deck ? fresh : neufsSiPossible(fresh, concepts, pris, count), random);
  return deck ? pool : pool.slice(0, count);
}

/** Au plus autant d'éléments choisis à la main dans une manche. */
export const MAX_PICKS = 60;

/** Éléments choisis un par un pour un jeu intégré ou le Pictionary (`picks`, leurs clés), dans l'ordre de Sarah. */
export const roundPicks = (round) => [...new Set(listOf(round?.picks).filter((k) => typeof k === "string" && k).map((k) => k.toLowerCase()))].slice(0, MAX_PICKS);

/** Clés d'une manche tirées au hasard (`hasard`) parmi ses éléments choisis : elles ne montrent jamais d'image téléversée. */
export const roundHasard = (round) => {
  const picks = new Set(roundPicks(round));
  return [...new Set(listOf(round?.hasard).filter((k) => typeof k === "string" && k).map((k) => k.toLowerCase()))].filter((k) => picks.has(k));
};

/** Image téléversée (« Mes images », photo d'un quiz ou d'une carte), par opposition aux émojis et à la banque de photos. */
export const imageTeleversee = (x) => /^[0-9a-f]{16}$/.test(x?.imageId ?? "");

/** Objets au moins d'une famille de Qui a disparu ?. */
const DISPARU_MIN_OBJETS = 5;

/**
 * Ce qu'un tirage au hasard peut montrer (cedric, 21/10) : les émojis et la banque de photos libres, jamais une image
 * téléversée (une pochette d'album, une image très spécifique). L'élément perd son image téléversée et garde son émoji ;
 * sans rien d'autre à montrer, il n'est pas tiré (null). Une photo de quiz (Zoom, Image floue) n'est jamais tirée ; une
 * famille de Qui a disparu ? garde ses objets en émojis ou en photos de la banque, s'il lui en reste assez. Choisis à
 * la main, les éléments gardent leurs images.
 */
export function pourLeHasard(type, x) {
  if (!x) return null;
  if (type === "zoom" || type === "flou") return imageTeleversee(x) ? null : x;
  if (type === "disparu" && Array.isArray(x.objects)) {
    const objects = x.objects.map((o) => pourLeHasard("objet", o)).filter(Boolean);
    if (objects.length < DISPARU_MIN_OBJETS) return null;
    return objects.length === x.objects.length && objects.every((o, i) => o === x.objects[i]) ? x : { ...x, objects };
  }
  if (!imageTeleversee(x)) return x;
  const { imageId, ...reste } = x;
  // Une carte de mimes ou un objet se montrent en image (émoji ou photo de la banque) ; un mot ou un personnage, non.
  return (type === "mimes" || type === "objet") && !reste.image && !reste.banque ? null : reste;
}

/**
 * Question d'un quiz reprise par le hasard (« 🔁 Rejouer », cedric, 21/10) : jamais une image téléversée. Sa photo de
 * révélation part (l'émoji reste) et ses réponses en photos aussi. Au Quiz illustré ([illustre]), qui ne se joue pas
 * sans elles, chaque réponse en photo prend la photo libre de son mot dans la banque, sinon son émoji (`choiceBanque`,
 * copiés dans la partie par la régie au chargement) ; une réponse qui n'a ni l'une ni l'autre : la question n'est pas
 * reprise (null). Choisies à la main, les questions gardent leurs images.
 */
export function questionAuHasard(q, illustre = false) {
  if (!q) return null;
  const { imageId, choiceImages, ...reste } = q;
  const photos = illustre ? choiceImageList(q) : [];
  if (!photos.length) return reste;
  const libres = (q.choices ?? []).map((c, k) => (photos[k] ? imageLibre(c) : null));
  return libres.every((x, k) => x || !photos[k]) ? { ...reste, choiceBanque: libres } : null;
}

/** Les éléments actifs d'un jeu (page du jeu) qui correspondent aux clés choisies, dans l'ordre des clés. */
export function pickedItems(type, content, picks) {
  const game = CONTENT_GAMES[type];
  const byKey = new Map(activeItems(type, content).map((x) => [game.key(x), x]));
  return picks.map((k) => byKey.get(k)).filter(Boolean);
}

/** Mots du Pictionary qu'on garde neufs (jamais montrés ailleurs) avant de reprendre tout le paquet. */
const PICTO_MIN_FRESH = 24;

/** Ce que montre un élément d'un jeu intégré ou du Pictionary (Qui a disparu ? : objet par objet, dans sa grille). */
export function builtinConcepts(type, x) {
  if (type === "chante") return concepts({ word: x?.word });
  if (type === "quisuis") return concepts({ word: x?.answer, image: x?.emoji, imageId: x?.imageId });
  if (type === "pictionary") return concepts(x);
  return [];
}

/** Questions d'une manche Zoom mystère ou Image floue : les photos choisies une par une, sinon celles des quiz choisis. */
export function zoomRoundQuestions(round, quizzes) {
  // En séries (cedric, 23/10) : toutes ses photos, dans l'ordre de passage.
  if (roundSeriesQuiz(round).length) return questionsDesSeries(round, quizzes);
  if (roundPicks(round).length) {
    const byImage = new Map();
    Object.values(quizzes ?? {}).forEach((qz) => (qz ? zoomQuestions(qz) : []).forEach((q) => { if (!byImage.has(q.imageId)) byImage.set(q.imageId, q); }));
    // « banque:vache » : une photo de la banque, avec ses réponses en images (émoji + mot).
    return roundPicks(round).map((id) => (id.startsWith(BANQUE) ? questionBanque(id.slice(BANQUE.length)) : byImage.get(id))).filter(Boolean);
  }
  return roundQuizIds(round).flatMap((id) => (quizzes?.[id] ? zoomQuestions(quizzes[id]) : []));
}

/**
 * « Jamais deux fois » : ce que montrent les contenus choisis à la main dans une manche (cartes de mimes, mots,
 * personnages, photos du Zoom, de l'Image floue et des quiz illustrés). Les tirages au hasard des autres manches l'évitent.
 */
export function fixedConcepts(round, quizzes = {}, mimes = {}, contents = {}) {
  const type = round?.type;
  if (type === "mimes") {
    const deck = round.deckId ? mimes?.[round.deckId] : null;
    return [...mimeCards(round.cards), ...(deck ? mimeCards(deck.cards) : [])].flatMap(concepts);
  }
  if (type === "chante" || type === "quisuis" || type === "pictionary") {
    return pickedItems(type, contents?.[type], roundPicks(round)).flatMap((x) => builtinConcepts(type, x));
  }
  if (type === "zoom" || type === "flou") return zoomRoundQuestions(round, quizzes).flatMap((q) => questionConcepts({ ...q, kind: type }));
  // Quiz choisi : les photos de ses réponses (quiz illustré) et ses illustrations. Ses questions reprises au hasard
  // (« 🔁 Rejouer ») ne sont pas choisies à la main : elles comptent une fois tirées.
  // Quiz ou Quiz illustré en séries (cedric, 23/10) : toutes ses questions, celles tirées au 🎲 comprises (elles comptent
  // une fois tirées, gardées dans la manche).
  if (estEnSeries(type) && round.hasard !== true && roundSeriesQuiz(round).length) return questionsDesSeries(round, quizzes).flatMap(questionConcepts);
  if ((type === "quiz" || type === "illustre" || type === "express") && round.hasard !== true) return roundQuizIds(round).flatMap((id) => Object.values(quizzes?.[id]?.questions ?? {})).flatMap(questionConcepts);
  return [];
}

/** Morceaux jouables d'une playlist : un titre et un extrait enregistré. */
export const playableTracks = (playlist) => (playlist?.tracks ?? []).filter((t) => t?.title?.trim() && /^[0-9a-f]{16}$/.test(t.audioId ?? ""));

/**
 * Playlist d'une manche faite d'extraits choisis un par un (`tracks`), pris dans toutes les playlists (sauf les
 * chansons des statues) : chaque extrait garde sa durée, son barème est celui de la première playlist trouvée.
 * Null si aucun extrait n'existe plus.
 */
export function tracksPlaylist(ids, playlists, title = "") {
  const found = new Map();
  Object.values(playlists ?? {}).filter((p) => p && !isStatuesList(p)).forEach((p) => playableTracks(p).forEach((t) => {
    if (!found.has(t.audioId)) found.set(t.audioId, { track: { ...t, duration: t.duration ?? p.duration ?? BLIND_SEC }, playlist: p });
  }));
  const picked = ids.map((id) => found.get(id)).filter(Boolean);
  if (!picked.length) return null;
  const first = picked[0].playlist;
  return {
    title: typeof title === "string" ? title.trim().slice(0, 60) : "", duration: first.duration ?? BLIND_SEC, tracks: picked.map((x) => x.track),
    ...Object.fromEntries(["points", "finalPoints", "finalCount", "reveal"].filter((k) => first[k] != null).map((k) => [k, first[k]])),
  };
}

/**
 * Questions d'un jeu musical. Blind test : les morceaux dans l'ordre de la playlist, un buzz par morceau,
 * réponse à voix haute, chaque morceau avec sa valeur, sa pochette et sa durée de révélation. Quiz musical : le bon
 * titre parmi trois autres titres de la même playlist, sur les pupitres, morceaux mélangés.
 */
function musicQuestions(type, playlist, prefix, random) {
  const tracks = type === "blind" ? playableTracks(playlist) : shuffle(playableTracks(playlist), random);
  const scale = blindScale(playlist);
  const titles = [...new Set(tracks.map((t) => t.title.trim()))];
  // Le type dans le titre : blind test et quiz musical d'une même playlist restent deux manches distinctes.
  const label = playlist.title?.trim() ? `${ROUND_TYPES[type]} · ${playlist.title.trim()}` : ROUND_TYPES[type];
  return tracks.map((t, j) => {
    const title = t.title.trim();
    const base = { id: `${prefix}${j + 1}`, double: false, round: label, audioId: t.audioId, duration: t.duration ?? playlist.duration ?? BLIND_SEC };
    if (type === "blind") {
      return {
        ...base, text: "Quel est ce titre ?", choices: [title], correct: 0, kind: "blind",
        points: trackPoints(playlist, t, j, tracks.length), reveal: scale.reveal,
        ...(t.artist?.trim() ? { artist: t.artist.trim() } : {}),
        ...(/^[0-9a-f]{16}$/.test(t.imageId ?? "") ? { imageId: t.imageId } : {}),
        // Refrain (environ 90 s) : joué en boucle à la révélation, « on chante tous ensemble ».
        ...(/^[0-9a-f]{16}$/.test(t.refrainId ?? "") ? { refrainId: t.refrainId } : {}),
        // Paroles du refrain (cedric, 21/10) : elles apparaissent sur la TV au rythme de la chanson.
        ...(/^[0-9a-f]{16}$/.test(t.refrainId ?? "") && typeof t.paroles === "string" && t.paroles ? { lyrics: t.paroles.slice(0, 8000) } : {}),
      };
    }
    const others = shuffle(titles.filter((x) => x !== title), random).slice(0, 3);
    const choices = shuffle([title, ...others], random);
    return { ...base, text: "Quel est ce titre ?", choices, correct: choices.indexOf(title), kind: "classic" };
  });
}

/**
 * Manche de mimes : un seul élément du programme, avec le paquet de cartes mélangé (chaque prestation
 * a son ordre) et la durée d'un tour. Le paquet de la bibliothèque n'est pas modifié.
 */
function mimeItem(round, deck, i, random, profile, mimes, teams, avoid, pris = null) {
  // Cartes choisies dans la Régie PC (gardées dans la manche) ; sinon le paquet, ou un tirage dans le catalogue.
  const fixed = mimeCards(round.cards).slice(0, 200);
  const title = deck?.title ?? (typeof round.title === "string" && round.title.trim() ? round.title.trim().slice(0, 60) : ROUND_TYPES.mimes);
  const cards = fixed.length ? shuffle(fixed, random) : mimeDraw(round, mimes, profile, random, avoid, pris);
  // Cartes par équipe : de quoi jouer pour les équipes prévues, plus une réserve tirée au hasard pour deux équipes de plus
  // le jour J (jouée seulement si besoin). Jamais une carte déjà jouée pendant la fête, jamais deux fois la même.
  const perTeam = mimePerTeam(round);
  if (perTeam) {
    const need = perTeam * (teamCount(teams) + MIME_SPARE_TEAMS);
    const taken = new Set(cards.map((c) => c.word.toLowerCase()));
    const spare = neufsSiPossible(shuffle(mimeCards(MIME_CATALOG.filter((c) => profile !== "PETITS" || c.level === 1)), random)
      .filter((c) => !taken.has(c.word.toLowerCase()) && !avoid?.has(c.word.toLowerCase())), concepts, pris, need - cards.length);
    cards.push(...spare.slice(0, Math.max(0, need - cards.length)));
  }
  return {
    id: `r${i + 1}m`,
    text: title,
    kind: "mime",
    duration: round.duration ?? deck?.duration ?? MIME_TURN,
    // « 📷 Photos » : chaque carte dont le mot est dans la banque montre sa photo (copiée dans la partie par la régie).
    cards: cards.slice(0, 200).map((c) => (round.photos === true ? avecPhoto(c) : c)),
    round: title,
  };
}

/** Cartes par équipe d'une manche de mimes (1 à 20), ou 0 quand la manche joue sa liste telle quelle. */
export const mimePerTeam = (round) => (Number.isInteger(round?.perTeam) && round.perTeam >= 1 && round.perTeam <= 20 ? round.perTeam : 0);

/** Équipes de rechange prévues par la réserve de cartes des mimes. */
export const MIME_SPARE_TEAMS = 2;

/** Nombre d'équipes de la prestation (1 à 8), 4 quand il n'est pas indiqué. */
export const teamCount = (teams) => (Number.isInteger(teams) && teams >= 1 && teams <= 8 ? teams : 4);

/** Nombre d'équipes d'une nouvelle prestation (cedric, 21/10). */
export const EQUIPES_PAR_DEFAUT = 4;

/**
 * Couleurs des équipes d'une prestation, une par équipe prévue (4 si le nombre n'est pas indiqué) : celles choisies
 * dans la Régie PC pour les bracelets et les bandeaux, sans doublon, complétées dans l'ordre des couleurs d'équipe
 * (rose, orange, vert, jaune, bleu…). Les tablettes ne proposent qu'elles (cedric, 22/10).
 */
export function couleursEquipes(show) {
  const n = teamCount(show?.teams);
  const choisies = Object.values(show?.teamColors ?? {})
    .map((c) => TEAM_COLORS.find((t) => t.toUpperCase() === String(c).toUpperCase()))
    .filter(Boolean);
  const couleurs = [...new Set(choisies)].slice(0, n);
  for (const c of TEAM_COLORS) if (couleurs.length < n && !couleurs.includes(c)) couleurs.push(c);
  return couleurs;
}

/** Mots ou cartes à prévoir au moins par équipe, aux jeux joués équipe par équipe. */
export const PAR_EQUIPE_MIN = 3;

/**
 * Alerte rouge d'une manche quand son contenu ne suffit pas aux équipes prévues (cedric, 21/10). Aucun jeu ne demande
 * une manche par équipe : aux Mimes et au Pictionary, les équipes jouent à tour de rôle dans la même manche, en piochant
 * dans le même paquet. Il faut donc assez de mots ou de cartes pour toutes. Un tirage au hasard au lancement suffit
 * toujours (tous les mots actifs, ou de quoi jouer pour chaque équipe) ; seule une liste faite à la main peut manquer.
 * Rend le message, ou null.
 */
export function alerteEquipes(round, teams, { mimes = {}, contents = {}, profile = null } = {}) {
  const n = teamCount(teams);
  const besoin = PAR_EQUIPE_MIN * n;
  const pour = `pour ${n} équipe${n > 1 ? "s" : ""}, il en faut au moins ${besoin} (${PAR_EQUIPE_MIN} par équipe)`;
  if (round?.type === "patate" && n < 2) return "« Ça va exploser ! » se joue à 2 équipes au moins : une seule équipe est prévue.";
  if (round?.type === "pictionary") {
    const mots = pickedItems("pictionary", contents?.pictionary, roundPicks(round)).length;
    if (mots && mots < besoin) return `Pictionary : ${mots} mot${mots > 1 ? "s" : ""} choisi${mots > 1 ? "s" : ""} ${pour}.`;
  }
  if (round?.type === "mimes" && !mimePerTeam(round)) {
    // Liste telle quelle : les cartes choisies, sinon le paquet entier ; sans l'une ni l'autre, le tirage suffit.
    const cartes = mimeCards(round.cards).length || (round.deckId ? mimePool(round, mimes, profile).length : 0);
    if (cartes && cartes < besoin) return `Mimes : ${cartes} carte${cartes > 1 ? "s" : ""} ${pour}.`;
  }
  return null;
}

/**
 * Instantané que la box joue : un seul quiz, manches mises bout à bout, chrono du profil pour
 * les questions sans durée imposée, points doublés pour la Super Finale ; une manche de mimes y est
 * un seul élément qui porte son paquet de cartes.
 * Renvoie `{ snapshot, problems }` ; `snapshot` est nul si rien n'est jouable.
 */
export function buildSnapshot(showId, show, quizzes, mimes = {}, random = Math.random, playlists = {}, contents = {}, avoid = {}) {
  const profile = PROFILES[show.profile] ? show.profile : profileForAge(show.age);
  const problems = [];
  // Un bloc par manche préparée : la Super Finale rejoint ensuite le quiz qu'elle termine.
  const blocks = [];
  let rounds, questions;
  /** Éléments des jeux intégrés déjà tirés dans cette prestation (ou déjà joués pendant la fête : [avoid]), par jeu. */
  const used = Object.fromEntries(Object.entries(avoid ?? {}).map(([k, v]) => [k, new Set(v)]));
  // « Jamais deux fois » : ce que montrent les contenus choisis à la main dans toute la prestation et ce qui a déjà
  // été joué pendant la fête ([avoid].concepts) ; chaque tirage au hasard l'évite, et chaque manche construite s'y ajoute.
  const pris = new Set(avoid?.concepts ?? []);
  (show.rounds ?? []).filter(Boolean).forEach((round) => fixedConcepts(round, quizzes, mimes, contents).forEach((k) => pris.add(k)));
  const begin = (type) => {
    questions?.forEach((q) => questionConcepts(q).forEach((k) => pris.add(k)));
    rounds = []; questions = []; blocks.push({ type, rounds, questions });
  };
  const quizDesBougies = premierQuiz(show.rounds, quizzes);
  (show.rounds ?? []).filter(Boolean).map((r) => [r, jeuDeLaManche(r, quizzes)]).forEach(([prepare, round], i) => {
    begin(round.type);
    if (round.type === "mimes") {
      const deck = round.deckId ? mimes[round.deckId] : null;
      if (!deck && round.random !== true && !mimeCards(round.cards).length) { problems.push(`Manche ${i + 1} : le paquet de mimes n'existe plus dans la bibliothèque.`); return; }
      const item = mimeItem(round, deck, i, random, profile, mimes, show.teams, used.mimes, pris);
      if (!item.cards.length) { problems.push(`Manche ${i + 1} (${item.text}) : aucune carte.`); return; }
      rounds.push({ title: item.text, count: 1, kind: "mime" });
      questions.push(item);
      return;
    }
    if (round.type === "statues") {
      // Un seul élément : la musique joue et s'arrête par moments, l'animatrice désigne l'équipe gagnante.
      const duration = STATUES_SECONDS.includes(round.duration) ? round.duration : STATUES_SEC;
      // Chansons choisies dans la prestation, jouées l'une après l'autre ; aucune : la musique maison de la TV.
      const songs = roundSongs(round, playlists).map((t) => t.audioId);
      rounds.push({ title: ROUND_TYPES.statues, count: 1 });
      questions.push({ id: `r${i + 1}s`, text: ROUND_TYPES.statues, kind: "statues", duration, double: false, round: ROUND_TYPES.statues, ...(songs.length ? { audioIds: songs } : {}) });
      return;
    }
    if (round.type === "coffres" || round.type === "portes") {
      // Un seul élément : la TV distribue les coffres selon le nombre d'équipes et tire chaque contenu à l'ouverture.
      // Les Portes mystères déjà enregistrées se jouent en coffres mystères (cedric, 20 octobre).
      rounds.push({ title: ROUND_TYPES.coffres, count: 1 });
      questions.push({ id: `r${i + 1}c`, text: ROUND_TYPES.coffres, kind: "coffres", choices: [], correct: -1, duration: 20, double: false, round: ROUND_TYPES.coffres });
      return;
    }
    if (round.type === "patate") {
      // Un seul élément : la TV tire la mèche au sort et la bombe part d'une équipe au hasard.
      rounds.push({ title: ROUND_TYPES.patate, count: 1 });
      questions.push({ id: `r${i + 1}p`, text: ROUND_TYPES.patate, kind: "patate", choices: [], correct: -1, duration: 40, double: false, round: ROUND_TYPES.patate });
      return;
    }
    if (round.type === "gonfleur") {
      // Un seul élément : la course de ballons, le chrono de secours en durée.
      rounds.push({ title: ROUND_TYPES.gonfleur, count: 1 });
      questions.push({ id: `r${i + 1}g`, text: ROUND_TYPES.gonfleur, kind: "gonfleur", choices: [], correct: -1, duration: GONFLEUR_SEC, double: false, round: ROUND_TYPES.gonfleur });
      return;
    }
    if (round.type === "pictionary") {
      // Un seul élément : le paquet de mots mélangé (adapté à l'âge), joué équipe par équipe, un mot par tour.
      // Séries choisies pour la manche (aucune : toutes les séries).
      const series = pictoRoundSeries(round);
      // Mots choisis un par un dans la Régie PC : ceux-là seulement (les séries et l'âge ne filtrent plus).
      // Mots tirés au hasard (dans la Régie PC, sur la régie ou au lancement) : sans image téléversée (cedric, 21/10).
      const hasard = new Set(roundHasard(round));
      const chosen = pickedItems("pictionary", contents?.pictionary, roundPicks(round))
        .map((w) => (hasard.has(w.word.toLowerCase()) ? pourLeHasard("pictionary", w) : w)).filter(Boolean);
      const fresh = (w) => !used.pictionary?.has(w.word.toLowerCase());
      const all = activeItems("pictionary", contents?.pictionary)
        .filter((w) => (profile !== "PETITS" || w.level !== 2) && (!series || series.includes(pictoSeriesOf(w))))
        .map((w) => pourLeHasard("pictionary", w)).filter(Boolean);
      const words = chosen.length ? chosen : neufsSiPossible(all.some(fresh) ? all.filter(fresh) : all, concepts, pris, PICTO_MIN_FRESH);
      if (!words.length) { problems.push(`Manche ${i + 1} (Pictionary) : aucun mot actif${series ? " dans les séries choisies" : ""} (page du jeu dans l'administration).`); return; }
      const duration = PICTO_SECONDS.includes(round.duration) ? round.duration : PICTO_SEC;
      rounds.push({ title: ROUND_TYPES.pictionary, count: 1, kind: "pictionary" });
      questions.push({
        id: `r${i + 1}p`, text: ROUND_TYPES.pictionary, kind: "pictionary", duration, double: false, round: ROUND_TYPES.pictionary,
        points: PICTO_POINTS, cards: shuffle(words, random).slice(0, 200).map((w) => ({ word: w.word, ...(w.image ? { image: w.image } : {}), ...(w.imageId ? { imageId: w.imageId } : {}) })),
      });
      return;
    }
    if (MUSIC_GAMES[round.type]) {
      const playlist = roundTracks(round).length ? tracksPlaylist(roundTracks(round), playlists, round.title) : playlists[round.playlistId];
      if (!playlist) { problems.push(`Manche ${i + 1} : la playlist n'existe plus dans la bibliothèque.`); return; }
      const list = musicQuestions(round.type, playlist, `r${i + 1}q`, random);
      if (round.type === "musical" && new Set(list.map((q) => q.choices[q.correct])).size < 2) {
        problems.push(`Manche ${i + 1} (${playlist.title}) : il faut au moins 2 morceaux pour proposer des titres.`);
        return;
      }
      if (!list.length) { problems.push(`Manche ${i + 1} (${playlist.title}) : aucun morceau avec un extrait.`); return; }
      const label = list[0].round;
      rounds.push({ title: label, count: list.length });
      questions.push(...list);
      return;
    }
    const builtin = BUILTIN_GAMES[round.type];
    if (builtin) {
      const count = Math.max(1, Math.min(12, round.count ?? builtin.count));
      // Deux manches du même jeu dans une prestation : pas deux fois le même mot, personnage ou famille, tant qu'il en reste.
      const game = CONTENT_GAMES[round.type];
      const seen = (used[round.type] ??= new Set());
      // Qui a disparu ? en émojis : le hasard ne prend pas les familles de photos de la banque.
      // Et seulement des émojis ou des photos de la banque, jamais une image téléversée (cedric, 21/10).
      const all = activeItems(round.type, contents?.[round.type]).filter((x) => round.type !== "disparu" || round.photos === true || !isPhotoTheme(x))
        .map((x) => pourLeHasard(round.type, x)).filter(Boolean);
      const fresh = all.filter((x) => !seen.has(game.key(x)));
      // Et rien de ce que montrent les autres activités (les familles de Qui a disparu ? trient leurs objets une à une).
      const pool = neufsSiPossible(fresh.length >= Math.min(count, all.length) ? fresh : all, (x) => builtinConcepts(round.type, x), pris, count);
      // Éléments choisis un par un dans la Régie PC : ceux-là, dans cet ordre ; sinon le tirage au hasard.
      // Choisis à la main : avec leurs images ; tirés au hasard (Régie PC ou régie) : sans image téléversée.
      const hasard = new Set(roundHasard(round));
      const chosen = pickedItems(round.type, contents?.[round.type], roundPicks(round))
        .map((x) => (hasard.has(game.key(x)) ? pourLeHasard(round.type, x) : x)).filter(Boolean);
      const picked = chosen.length
        ? builtin.items(profile, random, chosen, round, true, pris)
        : parPhotos(round, shuffle(builtin.items(profile, random, pool, round, false, pris), random)).slice(0, count);
      picked.forEach((x) => seen.add(game.key(x)));
      if (!picked.length) {
        problems.push(`Manche ${i + 1} (${ROUND_TYPES[round.type]}) : aucun ${CONTENT_GAMES[round.type].unit} actif (page du jeu dans l'administration).`);
        return;
      }
      rounds.push({ title: ROUND_TYPES[round.type], count: picked.length });
      picked.forEach((item, j) => questions.push({
        id: `r${i + 1}q${j + 1}`, duration: builtin.duration, double: false, round: ROUND_TYPES[round.type], ...builtin.question(item),
      }));
      return;
    }
    if (estJeuDePhotos(round.type) && (roundPicks(round).length || roundSeriesQuiz(round).length)) {
      // Photos choisies une par une, dans tous les quiz (la même photo n'est jouée qu'une fois) ; ou en séries
      // (cedric, 23/10 : 🎲, ancien anniversaire, ses séries de photos), dans l'ordre de passage.
      const list = zoomRoundQuestions(round, quizzes);
      if (!list.length) { problems.push(`Manche ${i + 1} (${ROUND_TYPES[round.type]}) : ${roundSeriesQuiz(round).length ? "aucune photo" : "les photos choisies n'existent plus"}.`); return; }
      const label = ROUND_TYPES[round.type];
      rounds.push({ title: label, count: list.length });
      list.forEach((q, j) => questions.push({
        id: `r${i + 1}q${j + 1}`, text: q.text, choices: q.choices, correct: q.correct,
        duration: round.type === "flou" ? FLOU_SEC : q.duration ?? defaultDuration(profile),
        kind: round.type, double: false, round: label, ...(q.image ? { image: q.image } : {}),
        // Photo de la banque : copiée dans la partie par la régie au chargement, qui met alors son identifiant.
        ...(q.banque ? { banque: q.banque } : { imageId: q.imageId }),
      }));
      return;
    }
    // Questions tirées au 🎲 (cedric, 23/10) : un quiz à elles seules, déjà validées ; la photo de la révélation est
    // copiée dans la partie par la régie au chargement (comme les photos de la banque des petits), sinon l'émoji.
    // Un quiz choisi en plus (deuxième ligne) : ses questions suivent les questions tirées.
    // Manche Quiz faite de séries (cedric, 23/10) : un seul jeu, toutes ses questions à la suite, dans l'ordre des
    // séries ; une seule Super Finale à la fin.
    const series = roundSeriesQuiz(round);
    const tirees = series.length ? [] : roundTirees(round);
    const ids = roundQuizIds(round);
    const choisis = ids.map((id) => quizzes[id]).filter(Boolean);
    // Titre : celui de ses quiz quand elle n'est faite que de quiz de la bibliothèque (comme avant les séries), sinon « Quiz ».
    const titreSeries = series.length && series.every((x) => x.origine === "quiz") && choisis.length ? choisis.map((q) => q.title).join(" + ") : ROUND_TYPES[round.type ?? "quiz"];
    const found = series.length ? [{ title: titreSeries, questions: questionsDesSeries(round, quizzes), ...(round.type === "illustre" ? { kind: "photo" } : {}) }] : [...(tirees.length
      ? [{ title: ROUND_TYPES.quiz, questions: tirees.map((q) => (q.nombre ? { text: q.text, kind: "number", correct: q.correct, status: "validee" }
        : { text: q.text, choices: q.choices, correct: q.correct, status: "validee", ...(q.banque ? { banque: q.banque } : q.emoji ? { image: q.emoji } : {}) })) }]
      : []), ...choisis];
    // Plusieurs quiz : un seul jeu, leurs questions à la suite, sous les titres réunis.
    const quiz = found.length > 1
      ? { title: found.map((x) => x.title).join(" + "), questions: found.flatMap((x) => (x.questions ?? []).filter(Boolean)) }
      : found[0];
    const express = round.type === "express";
    const zoom = round.type === "zoom";
    const flou = round.type === "flou";
    const game = QUIZ_GAMES[round.type];
    const label = round.type === "finale" || game ? ROUND_TYPES[round.type] : quiz?.title ?? `Manche ${i + 1}`;
    if (choisis.length < ids.length) problems.push(`Manche ${i + 1} : ${ids.length > 1 ? "un des quiz choisis" : "le quiz"} n'existe plus dans la bibliothèque.`);
    if (series.length && !found[0].questions.length) { problems.push(`Manche ${i + 1} (${ROUND_TYPES[round.type ?? "quiz"]}) : aucune question.`); return; }
    if (!quiz) { if (!ids.length) problems.push(`Manche ${i + 1} : le quiz n'existe plus dans la bibliothèque.`); return; }
    // Nombre de questions choisi dans la prestation : les premières du quiz, dans son ordre. « 🔁 Rejouer » sur la
    // régie (cedric, 21/10) : jamais une question déjà posée pendant la fête ([avoid].questions).
    const toutes = game ? game.questions(quiz) : playable(quiz);
    // Questions reprises par le hasard (« 🔁 Rejouer », cedric, 21/10) : jamais ses images téléversées (photo de la
    // réponse, réponses en photos), les émojis restent. Le Quiz illustré, qui ne se joue pas sans ses réponses en
    // photos, prend pour chacune la photo libre de son mot dans la banque, sinon son émoji ; une question dont une
    // réponse n'a ni l'une ni l'autre est sautée, la suivante la remplace.
    const sansMesImages = round.hasard === true;
    const illustre = found.every((x) => quizKind(x) === "photo");
    const reprises = sansMesImages ? toutes.map((q) => questionAuHasard(q, illustre && !express && !zoom && !flou)).filter(Boolean) : toutes;
    const posees = used.questions;
    const restantes = posees ? reprises.filter((q) => !posees.has(`${q.text ?? ""}`.toLowerCase())) : reprises;
    // « Jamais deux fois » : au hasard, d'abord les questions qui ne montrent rien de ce que la fête a déjà montré,
    // s'il y en a assez ; sinon les suivantes, comme avant.
    // Le nombre choisi pour le quiz de la deuxième ligne ne compte que ses questions, après les questions tirées.
    const limite = round.count > 0 && !series.length ? tirees.length + round.count : 0;
    const voulues = limite || restantes.length;
    const list = (sansMesImages ? neufsSiPossible(restantes, questionConcepts, pris, voulues) : restantes).slice(0, limite || undefined);
    if (!list.length) {
      problems.push(`Manche ${i + 1} (${quiz.title}) : ${!toutes.length ? game?.missing ?? "aucune question validée"
        : !reprises.length ? "aucune question à reprendre au hasard : au hasard, chaque réponse en photo doit avoir sa photo dans la banque ou son émoji (jamais vos images)"
        : "toutes ses questions ont déjà été posées pendant la fête"}.`);
      return;
    }
    if (sansMesImages && list.length < voulues) {
      const ecartees = toutes.length - reprises.length;
      problems.push(`Liste plus courte : il ne restait que ${list.length} question${list.length > 1 ? "s" : ""} à reprendre au hasard${ecartees
        ? ` (${ecartees} écartée${ecartees > 1 ? "s" : ""} : une réponse en photo sans photo dans la banque ni émoji)` : ""}.`);
    }
    // Super Finale : réglage d'une manche Quiz (ou Quiz illustré), ses N dernières questions comptent double (ce n'est pas un jeu à part).
    const finale = hasFinale(round.type) ? Math.max(0, Math.min(list.length, Math.floor(Number(round.finale) || 0))) : 0;
    // Les bougies, juste avant les questions de la Super Finale (elles ne comptent pas double), ou à la place choisie
    // dans le « Quiz complet » (cedric, 23/10). Pas deux fois : ni si le quiz a déjà sa question des bougies, ni si
    // elle a déjà été posée pendant la fête.
    const bougies = prepare === quizDesBougies && !round.hasard ? questionBougies(show, round) : null;
    const dejaLa = (q) => q.kind === "number" && /bougie/i.test(q.text ?? "");
    if (bougies && !list.some(dejaLa) && !posees?.has(bougies.text.toLowerCase())) {
      const rangee = series.length ? placeDesBougies(round, quizzes) : null;
      // Avant aussi les dernières questions marquées ×2 une par une dans le quiz (l'ancienne façon de finir en finale).
      let place = list.length - finale;
      while (place > 0 && list[place - 1].double === true) place--;
      list.splice(rangee != null ? Math.min(rangee, list.length) : place, 0, bougies);
    }
    // La Super Finale : les N dernières questions, jamais celle des bougies (où qu'elle soit).
    const enFinale = new Set(finale ? list.filter((q) => q !== bougies).slice(-finale) : []);
    rounds.push({ title: label, count: list.length, ...(finale ? { finale } : {}) });
    list.forEach((q, j) => {
      const last = enFinale.has(q);
      const number = q.kind === "number";
      const yesNo = isYesNo(q);
      questions.push({
        id: `r${i + 1}q${j + 1}`,
        text: q.text,
        ...(number ? {} : { choices: q.choices }),
        correct: q.correct,
        // Express : le chrono court du profil, toujours (c'est le jeu).
        // Image floue : le temps que la photo devienne nette ; la réponse se donne à voix haute après un buzz.
        duration: express ? expressDuration(profile) : flou ? FLOU_SEC : q.duration ?? defaultDuration(profile),
        kind: express ? "express" : zoom ? "zoom" : flou ? "flou" : number ? "number" : yesNo ? "true_false" : "classic",
        double: round.type === "finale" || last || q.double === true,
        ...(last ? { finale: true } : {}),
        // Multiplicateur choisi dans la Régie PC (×2 d'office) : la régie le propose quand la Super Finale arrive.
        ...(last && FACTEURS_FINALE.includes(round.facteur) && round.facteur !== FACTEURS_FINALE[0] ? { facteur: round.facteur } : {}),
        round: label,
        // Illustration facultative montrée à la révélation (émoji, ou photo copiée dans la partie par la régie).
        ...(q.image ? { image: q.image } : {}),
        ...(q.imageId && !sansMesImages ? { imageId: q.imageId } : {}),
        ...(q.banque ? { banque: q.banque } : {}),
        // Réponses en images (QCM et Vrai / Faux) : une photo par proposition, "" pour une proposition en texte.
        ...(!number && !express && !zoom && !flou && !sansMesImages && choiceImageList(q).length ? { choiceImages: choiceImageList(q) } : {}),
        // Quiz illustré au hasard : la photo de la banque ou l'émoji de chaque réponse, remplacés par leur identifiant
        // (choiceImages) quand la régie les copie dans la partie.
        ...(!number && !express && !zoom && !flou && Array.isArray(q.choiceBanque) ? { choiceBanque: q.choiceBanque } : {}),
      });
    });
  });
  ({ rounds, questions } = assemble(blocks));
  if (questions.length > MAX_QUESTIONS) {
    problems.push(`${questions.length} questions : seules les ${MAX_QUESTIONS} premières seront jouées.`);
    questions.length = MAX_QUESTIONS;
  }
  if (!questions.length) {
    problems.push("Aucune question jouable : ajoutez une manche avec des questions validées.");
    return { snapshot: null, problems };
  }
  // Multiplicateur de chaque Super Finale choisi dans la Régie PC (cedric, 23/10), par sa première question : la régie le
  // propose quand elle arrive (la TV, qui ne le connaît pas, part de ×2).
  const facteurs = {};
  questions.forEach((q, k) => { if (q.facteur && !questions[k - 1]?.facteur) facteurs[q.id] = q.facteur; });
  questions.forEach((q) => { delete q.facteur; });
  const title = showTitle(show);
  return {
    snapshot: {
      showId, title, childName: show.childName?.trim() ?? "", age: show.age ?? null, profile, rounds,
      // Couleurs proposées aux équipes sur les tablettes : la TV les publie pour l'accueil.
      teamColors: couleursEquipes(show),
      ...(Object.keys(facteurs).length ? { facteurs } : {}),
      // Notes de Sarah pour l'animatrice, lues sur la régie le jour J (la TV les ignore).
      ...(show.notes?.trim() ? { notes: show.notes.trim().slice(0, 2000) } : {}),
      // Chaque jeu s'ouvre sur son écran de présentation, que l'animatrice lance depuis la régie.
      quiz: { id: showId, title, questions, intros: true },
    },
    problems,
  };
}

/**
 * Programme final : les manches dans l'ordre, sauf la Super Finale, qui n'est pas un jeu à part mais les
 * dernières questions du quiz (règle de cedric) : ses questions (×2) suivent celles du quiz qui la précède,
 * sous le même titre de jeu. Sans quiz avant elle, elle termine le premier quiz qui la suit ; sans aucun
 * quiz, elle reste seule sous le titre « Super Finale ».
 */
function assemble(blocks) {
  const isQuiz = (b) => b.type === "quiz" && b.questions.length > 0;
  const kept = blocks.filter((b) => b.questions.length > 0);
  kept.forEach((b, k) => {
    if (b.type !== "finale") return;
    const host = kept.slice(0, k).reverse().find(isQuiz) ?? kept.slice(k + 1).find(isQuiz);
    if (!host) return;
    const title = host.rounds[0].title;
    host.questions.push(...b.questions.map((q) => ({ ...q, round: title, finale: true })));
    host.rounds[0].count += b.questions.length;
    host.rounds[0].finale = (host.rounds[0].finale ?? 0) + b.questions.length;
    b.merged = true;
  });
  const used = kept.filter((b) => !b.merged);
  return { rounds: used.flatMap((b) => b.rounds), questions: used.flatMap((b) => b.questions) };
}

/**
 * Durée estimée d'une prestation (cedric, 23/10) : calculée toute seule d'après les jeux composés, jamais saisie. Chaque
 * élément du programme compte son temps de jeu ; chaque jeu, une minute pour son intro et l'explication des règles ;
 * puis l'accueil des équipes, le podium, et 10 % de pauses. Temps en secondes.
 */
export const DUREE_ESTIMEE = {
  // Après le chrono d'une question (lecture comprise) : la réponse, l'explication et les scores.
  apresQuestion: 20, apresExpress: 10,
  // Blind test et quiz musical : après l'extrait, le buzz, la réponse et le refrain chanté ensemble.
  apresTitre: 40,
  // Mimes : passages par équipe (sauf nombre réglé dans la manche), et le changement d'équipe après chacun.
  mimesParEquipe: 2, apresMime: 15,
  // Pictionary : un dessin par équipe ; statues : la durée choisie ; coffres : un tour par équipe.
  apresDessin: 30, apresStatues: 30, coffreParEquipe: 60, coffres: 60, gonfleur: 90, patate: 120,
  presentation: 60, accueil: 180, podium: 120, pauses: 0.1,
};

/** Temps de jeu d'un élément du programme, en secondes, pour [equipes] équipes ([parEquipe] : mimes par équipe). */
function secondesDeJeu(q, equipes, parEquipe = 0) {
  const D = DUREE_ESTIMEE;
  if (q.kind === "mime") return (parEquipe || D.mimesParEquipe) * equipes * (q.duration + D.apresMime);
  if (q.kind === "pictionary") return equipes * (q.duration + D.apresDessin);
  if (q.kind === "statues") return q.duration + D.apresStatues;
  if (q.kind === "coffres" || q.kind === "portes") return equipes * D.coffreParEquipe + D.coffres;
  if (q.kind === "gonfleur") return D.gonfleur;
  if (q.kind === "patate") return D.patate;
  if (q.kind === "express") return q.duration + D.apresExpress;
  return q.duration + (q.audioId ? D.apresTitre : D.apresQuestion);
}

/** Temps de jeu d'une prestation, en minutes : ses questions et ses jeux, sans intros, accueil ni pauses. */
export function estimateMinutes(snapshot, teams = null) {
  if (!snapshot) return 0;
  return Math.round(snapshot.quiz.questions.reduce((t, q) => t + secondesDeJeu(q, teamCount(teams)), 0) / 60);
}

/**
 * Durée estimée d'une prestation [show] (son programme [snapshot]) : { minutes (arrondies aux 5 minutes du dessus),
 * jeux (combien de jeux présentés) }, ou null sans programme.
 */
export function dureeEstimee(snapshot, show = {}) {
  if (!snapshot) return null;
  const D = DUREE_ESTIMEE;
  const equipes = teamCount(show?.teams);
  const manches = (show?.rounds ?? []).filter(Boolean);
  const questions = snapshot.quiz.questions;
  // Une manche de mimes « r3m » est la 3e manche de la prestation : son nombre de mimes par équipe.
  const parEquipe = (q) => mimePerTeam(manches[Number(/^r(\d+)m$/.exec(q.id ?? "")?.[1]) - 1]);
  const jeu = questions.reduce((t, q) => t + secondesDeJeu(q, equipes, q.kind === "mime" ? parEquipe(q) : 0), 0);
  // Un jeu commence à chaque nouvelle manche (« r3… » : la 3e), sauf la Super Finale, jouée à la suite de son quiz.
  const manche = (q) => /^r(\d+)/.exec(q.id ?? "")?.[1];
  const jeux = questions.filter((q, k) => k === 0 || (!q.finale && manche(q) !== manche(questions[k - 1]))).length;
  const total = (jeu + jeux * D.presentation + D.accueil + D.podium) * (1 + D.pauses);
  return { minutes: Math.ceil(total / 300) * 5, jeux };
}

/** Date du jour au format des prestations (AAAA-MM-JJ), à l'heure locale. */
export function isoDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Nombre de jours entre aujourd'hui et la date de la prestation (négatif si elle est passée). */
export function daysUntil(date, today = isoDay()) {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
}

/**
 * Jours après la date au-delà desquels une prestation passée se range d'elle-même dans les archives : 0, elle
 * passe de « À venir » à « Archivée » le lendemain de la fête (cedric, 21 octobre). Une fête en cours n'est pas
 * coupée : la TV garde son programme jusqu'au bout.
 */
export const AUTO_ARCHIVE_DAYS = 0;

/**
 * Archivée : à la main, ou d'elle-même le lendemain de sa date. Une prestation désarchivée à la main après sa date
 * ne s'archive plus toute seule. Une archivée peut être épinglée (`pinned`) : un modèle où piocher des jeux.
 */
export function isArchived(show, today = isoDay()) {
  if (!show) return false;
  if (show.status === "archivee") return true;
  if (show.keepActive) return false;
  return !!show.date && daysUntil(show.date, today) < -AUTO_ARCHIVE_DAYS;
}

/**
 * Les trois états d'une prestation, avec les mêmes mots partout (cedric, 21 octobre) : « À compléter » (brouillon,
 * pas sur la régie), « À venir » (prête, sur la régie et dans les prochains anniversaires), « Archivée » (passée ou
 * rangée à la main, plus sur la régie). Les valeurs enregistrées ne changent pas : brouillon, publiee, archivee.
 */
export const ETATS = { avenir: "À venir", acompleter: "À compléter", archivee: "Archivée" };
export const STATUT_ETAT = { brouillon: "acompleter", publiee: "avenir", archivee: "archivee" };

/** État d'une prestation : « archivee », « avenir » ou « acompleter ». */
export function etatPrestation(show, today = isoDay()) {
  if (isArchived(show, today)) return "archivee";
  return show?.status === "publiee" ? "avenir" : "acompleter";
}

/**
 * Lancement abandonné (la box n'a jamais chargé la prestation : TV éteinte, refus) : la prestation redevient libre au
 * bout de ce délai. Même valeur dans les règles Firebase (launches/).
 */
export const LAUNCH_STALE_MS = 120_000;

/**
 * Où en est une prestation de la bibliothèque (cedric, 21/10), d'après son lancement ([launch] : launches/<id>, code
 * de la partie et heure) et ce que publie sa partie ([game] : état, prestation jouée, box hôte et sa présence).
 * Mêmes états sur la régie et dans la Régie PC ; archiver une prestation n'y change rien. Une date passée ne veut
 * jamais dire « terminée » : seule la fin de la partie le dit. [here] : la partie de ce téléphone.
 * - « preparee » : jamais lancée, ou lancement qui ne tient plus (partie effacée, box qui ne l'a jamais chargée) ;
 * - « ici » : sur la TV de ce téléphone ;
 * - « salon » : chargée sur une autre box, au salon d'attente ;
 * - « encours » : partie commencée, box en ligne (ou présence inconnue : box d'une version plus ancienne) ;
 * - « interrompue » : partie commencée, box muette (reprise possible avec « Changer de box ») ;
 * - « terminee » : partie terminée ([at] : heure de la fin).
 * [online] : la box hôte est en ligne (true), muette (false) ou on ne sait pas (null).
 */
export function launchState(id, launch, game, { here = null, now = Date.now() } = {}) {
  if (!launch?.code) return { etat: "preparee" };
  const code = launch.code;
  if (game?.state?.phase === "ended") return { etat: "terminee", code, at: game.state.endedAt ?? null };
  if (code === here) return { etat: "ici", code };
  if (!game?.hostUid) return { etat: "preparee" };
  if (game.prestation !== id && now - (launch.at ?? 0) > LAUNCH_STALE_MS) return { etat: "preparee" };
  // Seule la présence écrite par la box hôte actuelle compte (après un changement de box, l'ancienne se tait).
  const presence = game.hostOnline?.uid === game.hostUid ? game.hostOnline : null;
  const online = presence ? presence.online === true : null;
  if (!game.state || game.state.phase === "lobby") return { etat: "salon", code, online };
  if (online === false) return { etat: "interrompue", code, online, at: presence.at ?? null };
  return { etat: "encours", code, online, at: launch.at ?? null };
}

/** États des prestations lancées (launches/) : quelques petites lectures par partie concernée, jamais toute la partie. */
export async function launchStates(launches, lire, { here = null, now = Date.now() } = {}) {
  const games = new Map();
  const gameOf = (code) => {
    if (!games.has(code)) {
      const paths = ["state/phase", "state/endedAt", "public/prestation", "hostOnline", "hostUid"];
      games.set(code, Promise.all(paths.map((p) => lire(`games/${code}/${p}`)))
        .then(([phase, endedAt, prestation, hostOnline, hostUid]) => ({ state: phase ? { phase, endedAt } : null, prestation, hostOnline, hostUid })));
    }
    return games.get(code);
  };
  const out = {};
  await Promise.all(Object.entries(launches ?? {}).map(async ([id, launch]) => {
    if (typeof launch?.code !== "string") return;
    out[id] = launchState(id, launch, launch.code === here ? null : await gameOf(launch.code), { here, now });
  }));
  return out;
}

/** « 14 h 05 » */
export function heureCourte(ms) {
  const d = new Date(ms);
  return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
}

/** « 24 octobre à 17 h 10 » */
export function jourHeure(ms) {
  return `${new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} à ${heureCourte(ms)}`;
}

/** Ce que la régie affiche pour un état de [launchState]. */
export function launchLabel(run) {
  switch (run?.etat) {
    case "ici": return "✓ Sur cette TV";
    case "salon": return "📺 Chargée sur une autre box (salon d'attente)";
    case "encours": return `🟢 En cours sur une autre box${run.at ? ` depuis ${heureCourte(run.at)}` : ""}`;
    case "interrompue": return `⏸ Interrompue : l'autre box ne répond plus${run.at ? ` depuis ${heureCourte(run.at)}` : ""}`;
    case "terminee": return `✓ Terminée${run.at ? ` le ${jourHeure(run.at)}` : ""}`;
    default: return "Préparée";
  }
}

/** Ce que la Régie PC affiche sur la carte d'une prestation lancée ; rien pour une prestation seulement préparée. */
export function launchLabelPc(run) {
  switch (run?.etat) {
    case "ici":
    case "salon": return "📺 Chargée sur une box (salon d'attente)";
    case "encours": return "🟢 En cours";
    case "interrompue": return "⏸ Interrompue (reprise possible)";
    case "terminee": return `✓ Terminée${run.at ? ` le ${jourHeure(run.at)}` : ""}`;
    default: return "";
  }
}

/**
 * État de préparation d'une prestation, pour le tableau de bord : « prete » quand elle est
 * complète et visible sur la régie, sinon la liste de ce qui reste à faire.
 */
export function readiness(show, quizzes, mimes = {}, playlists = {}, contents = {}, today = isoDay()) {
  if (isArchived(show, today)) return { level: "archivee", todo: [] };
  const todo = [];
  if (!show.childName?.trim()) todo.push("Indiquer le prénom de l'enfant");
  if (!show.date) todo.push("Ajouter la date");
  else if (show.date < today) todo.push("Choisir une date à venir (celle-ci est passée)");
  if (!show.age) todo.push("Indiquer l'âge");
  if (!(show.rounds ?? []).filter(roundFilled).length) todo.push("Ajouter une manche");
  else {
    const { snapshot, problems } = buildSnapshot("x", show, quizzes, mimes, Math.random, playlists, contents);
    todo.push(...problems.filter((p) => snapshot || !p.startsWith("Aucune question jouable")));
    if (!snapshot && !problems.some((p) => p.startsWith("Manche"))) todo.push("Valider des questions");
  }
  if (!todo.length && show.status !== "publiee") todo.push("Passer le statut à « À venir »");
  return { level: todo.length ? "a-completer" : "prete", todo };
}

const sansAccent = (x) => `${x ?? ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const MOIS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/**
 * Recherche dans les prestations (Régie PC) : chaque mot tapé doit se retrouver dans la prestation, sans tenir compte
 * des accents ni des majuscules. On cherche dans le titre, le prénom, l'âge (« 9 », « 9 ans »), la date (« 25/10 »,
 * « 25 octobre », « 2026-10-25 », « octobre », « samedi »), le statut, les thèmes, les notes et les jeux (titres des quiz,
 * paquets et playlists). Un nombre seul doit correspondre à un nombre entier (« 9 » ne trouve pas « 2019 »).
 */
export function showMatches(show, query, library = {}) {
  const words = sansAccent(query).split(/[\s,;]+/).filter(Boolean);
  if (!words.length) return true;
  const parts = [showTitle(show), show.childName, show.title, show.themes, show.notes, show.age != null ? `${show.age} ans` : ""];
  if (show.date) {
    const [y, m, d] = show.date.split("-").map(Number);
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const dd = `${d}`.padStart(2, "0"), mm = `${m}`.padStart(2, "0");
    parts.push(show.date, `${dd}/${mm}/${y}`, `${d}/${m}/${y}`, `${d} ${MOIS[m - 1]} ${y}`, JOURS[day]);
  }
  parts.push({ publiee: "a venir prete", brouillon: "a completer brouillon", archivee: "archivee archive" }[show.status] ?? "");
  if (show.status !== "archivee" && isArchived(show)) parts.push("archivee archive");
  if (show.pinned) parts.push("epinglee");
  for (const r of (show.rounds ?? []).filter(Boolean).map((x) => jeuDeLaManche(x, library.quizzes))) {
    parts.push(ROUND_TYPES[r.type ?? "quiz"] ?? "");
    roundQuizIds(r).forEach((id) => parts.push(library.quizzes?.[id]?.title));
    if (r.deckId) parts.push(library.mimes?.[r.deckId]?.title);
    if (r.playlistId) parts.push(library.playlists?.[r.playlistId]?.title);
  }
  const text = sansAccent(parts.filter(Boolean).join(" \n "));
  const numbers = new Set(text.match(/\d+/g) ?? []);
  return words.every((w) => (/^\d+$/.test(w) ? numbers.has(w) || numbers.has(w.replace(/^0+/, "")) : text.includes(w)));
}

/** Anniversaires à venir (aujourd'hui compris), du plus proche au plus lointain, archives exclues. */
export function upcoming(shows, today = isoDay()) {
  return Object.entries(shows)
    .filter(([, s]) => s && !isArchived(s, today) && s.date && s.date >= today)
    .sort(([, a], [, b]) => a.date.localeCompare(b.date));
}

/**
 * Copie d'une prestation pour un nouvel anniversaire : mêmes manches (les quiz de la bibliothèque
 * sont repris tels quels, sans être modifiés), prénom, date et âge à saisir, en brouillon.
 */
export function duplicateShow(show) {
  const { childName, age, date, title, status, createdAt, updatedAt, origin, pinned, keepActive, copieDe, ...rest } = show;
  return { ...rest, status: "brouillon", rounds: (show.rounds ?? []).filter(Boolean).map((r) => ({ ...r })) };
}

// ---------- Programme modifié pendant la partie (régie) ----------
// Mêmes règles que la box (engine Program.kt) : la question en cours et la fin de sa manche ne bougent pas.

/** Manches du programme : suites de questions de même titre, avec leurs bornes. */
export function programRounds(questions) {
  const list = [];
  questions.forEach((q, i) => {
    const last = list[list.length - 1];
    // Questions sans titre de manche (quiz de démonstration) : un seul jeu « Quiz », comme l'annonce la TV.
    if (last && (q.round ? last.title === q.round : last.untitled)) last.end = i;
    else list.push(q.round ? { title: q.round, start: i, end: i } : { title: "Quiz", start: i, end: i, untitled: true });
  });
  return list;
}

/** Dernière question verrouillée : celle en cours et la fin de sa manche (-1 au salon d'attente). */
export function lockedUntil(questions, index) {
  if (index == null || index < 0) return -1;
  const round = questions[index]?.round;
  if (!round) return index;
  let end = index;
  while (questions[end + 1]?.round === round) end++;
  return end;
}

/**
 * Questions d'un jeu choisi dans la bibliothèque (quiz ou manche d'une ancienne prestation), prêtes à
 * insérer : chrono du profil de la prestation, identifiants nouveaux (préfixe [prefix]) pour ne jamais
 * croiser une question déjà jouée. Le quiz de la bibliothèque n'est pas modifié.
 */
export function gameQuestions(source, quizzes, profile, prefix, mimes = {}, playlists = {}, contents = {}, avoid = {}, teams = null) {
  const { snapshot, problems } = buildSnapshot("ajout", { profile, teams, rounds: [source] }, quizzes, mimes, Math.random, playlists, contents, avoid);
  if (!snapshot) return { questions: [], problems };
  return { questions: snapshot.quiz.questions.map((q, j) => ({ ...q, id: `${prefix}${q.kind === "mime" ? "m" : "q"}${j + 1}` })), problems };
}

/** Insère un jeu après la manche en cours (au début, au salon d'attente) ou à la fin du programme. */
export function insertGame(questions, added, where, index) {
  const at = where === "end" ? questions.length : lockedUntil(questions, index) + 1;
  return [...questions.slice(0, at), ...added, ...questions.slice(at)];
}

/** Manche pas encore commencée : la seule qu'on peut déplacer ou retirer. */
export function isFutureRound(round, questions, index) {
  return round.start > lockedUntil(questions, index);
}

/** Déplace une manche future d'un cran (delta -1 ou +1) parmi les manches futures ; null si impossible. */
export function moveRound(questions, start, delta, index) {
  const all = programRounds(questions);
  const k = all.findIndex((r) => r.start === start);
  const other = all[k + delta];
  if (k < 0 || !other || !isFutureRound(all[k], questions, index) || !isFutureRound(other, questions, index)) return null;
  const order = all.map((_, i) => i);
  [order[k], order[k + delta]] = [order[k + delta], order[k]];
  return order.flatMap((i) => questions.slice(all[i].start, all[i].end + 1));
}

/** Retire une manche future ; null si elle a commencé ou si le programme deviendrait vide. */
export function removeRound(questions, start, index) {
  const r = programRounds(questions).find((x) => x.start === start);
  if (!r || !isFutureRound(r, questions, index)) return null;
  const next = [...questions.slice(0, r.start), ...questions.slice(r.end + 1)];
  return next.length ? next : null;
}

/** Titre de manche libre dans le programme (« Animaux · 2 »…) : deux manches ne se confondent jamais. */
export function uniqueRoundTitle(questions, title) {
  const taken = new Set(questions.map((q) => q.round));
  if (!taken.has(title)) return title;
  let n = 2;
  while (taken.has(`${title} · ${n}`)) n++;
  return `${title} · ${n}`;
}

/** Extraits musicaux d'un programme (identifiants sans doublon), à copier dans la partie avant de l'envoyer. */
export function soundIds(questions) {
  return [...new Set((questions ?? []).flatMap((q) => [q?.audioId, q?.refrainId, ...(Array.isArray(q?.audioIds) ? q.audioIds : [])]).filter((id) => typeof id === "string" && /^[0-9a-f]{16}$/.test(id)))];
}

const IMAGE_ID = /^[0-9a-f]{16}$/;

/**
 * Photos des propositions d'une question de la bibliothèque, alignées sur ses propositions ("" pour une
 * proposition en texte) ; vide si aucune photo valable. La base les range en table ({ "0": id, "2": id }).
 */
export function choiceImageList(q) {
  const raw = q?.choiceImages;
  if (!raw || typeof raw !== "object") return [];
  const list = (q.choices ?? []).map((_, k) => (IMAGE_ID.test(raw[k] ?? "") ? raw[k] : ""));
  return list.some(Boolean) ? list : [];
}

/** Réponses en images d'un programme (identifiants sans doublon), à copier dans la partie avant de l'envoyer. */
export function choiceImageIds(questions) {
  // Rangées avec les réponses en images : aussi les photos des mots du Pictionary (lues par la tablette du dessinateur).
  return [...new Set((questions ?? []).flatMap((q) => [...(Array.isArray(q?.choiceImages) ? q.choiceImages : []), ...(Array.isArray(q?.cards) ? q.cards.map((c) => c?.imageId) : [])])
    .filter((id) => typeof id === "string" && IMAGE_ID.test(id)))];
}

/** Photos d'illustration d'un programme (identifiants sans doublon), à copier dans la partie avant de l'envoyer. */
export function imageIds(questions) {
  return [...new Set((questions ?? []).map((q) => q?.imageId).filter((id) => typeof id === "string" && /^[0-9a-f]{16}$/.test(id)))];
}
