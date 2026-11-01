// Collections, manches et prestation : la même logique pour tous les jeux.
// - Collection : le contenu brut d'un jeu, rangé par catégories (cartes, mots, personnages, photos, extraits…).
// - Manche : ce qu'on joue, une sélection piochée dans les collections (à la main ou au hasard) et ses réglages,
//   enregistrée dans `library/manches`, épinglable, archivable.
// - Prestation : l'enchaînement des manches d'un anniversaire ; chaque manche y est copiée.
// Fonctions pures, sans Firebase.
import {
  ROUND_TYPES, BUILTIN_GAMES, CONTENT_GAMES, MUSIC_GAMES, activeItems, pictoSeriesOf, playableTracks, isStatuesList,
  statuesSongs, statuesChoices, zoomQuestions, expressQuestions, mimeCards, roundPicks, roundTracks, roundQuizIds, roundSongs,
  pictoRoundSeries, mimePerTeam, teamCount, MIME_TURN, MIME_RANDOM, STATUES_SEC, PICTO_SEC,
  MAX_PICKS, MAX_STATUES_SONGS, quizKind, builtinConcepts, fixedConcepts, isPhotoTheme, disparuGroup, parPalierPhotos,
  illustreQuestions, quizQuestions, jeuDeLaManche, hasFinale, pourLeHasard, roundHasard, roundTirees,
  roundSeriesQuiz, questionsDeLaSerie, questionJouable, FACTEURS_FINALE, MAX_QUESTIONS_MANCHE, playable, estEnSeries,
  estJeuDePhotos, signatureQuestion, questionsDuJeu, zoomRoundQuestions, mimeEquipes, mimeEquipesBrutes, mimeAges, MIME_SOURCES,
  chansonsBrutes, chansonsDe, BLIND_NOMBRES, seriesBlind, MAX_CHANSONS_BLIND, JEUX_DE_CHANSONS, leurresDeLaManche, chansonsStatues,
  estJeuDeMots, seriesMots, motsDuJeu, MAX_MOTS, pictoToursBruts, pictoTours, pictoPropositions, pictoPassages, bombesDe, reglagesDuel, reglagesSimon, reglagesChrono,
  departZoom,
  departFlou,
} from "./show.js";
import { PROFILES } from "./profiles.js";
import { FAMILLES_PETITS } from "./banque-petits.js";
import { MIME_CATALOG, shuffle } from "./mime-cards.js";
import { concepts, questionConcepts, neufsSiPossible } from "./jamais-deux-fois.js";
import { BANQUE, banqueItems, motDeLaBanque } from "./banque-photos.js";

/** Jeux qu'on peut enregistrer en manches, dans l'ordre des tuiles de l'accueil. */
export const MANCHE_TYPES = ["quiz", "illustre", "mimes", "blind", "musical", "statues", "express", "zoom", "flou", "chante", "quisuis", "disparu", "pictionary", "coffres", "patate", "gonfleur", "duel", "simon", "chrono"];

/** Ce que contient la collection d'un jeu (null : jeu sans contenu à choisir). */
export const COLLECTION_UNIT = {
  mimes: ["carte", "cartes"], pictionary: ["mot", "mots"], chante: ["mot", "mots"], quisuis: ["personnage", "personnages"],
  disparu: ["famille", "familles"], zoom: ["photo", "photos"], flou: ["photo", "photos"], blind: ["titre", "titres"],
  musical: ["titre", "titres"], statues: ["chanson", "chansons"], quiz: ["quiz", "quiz"], illustre: ["quiz", "quiz"], express: ["quiz", "quiz"],
};

/** Jeux où « Au hasard » et « Rejouer avec d'autres… » piochent dans la collection. */
export const RANDOM_TYPES = ["mimes", "pictionary", "chante", "quisuis", "disparu", "zoom", "flou", "blind", "musical"];

/** Nombre d'éléments tirés par défaut pour une manche au hasard. */
export const RANDOM_COUNT = { mimes: MIME_RANDOM, pictionary: 24, zoom: 6, flou: 6, blind: 8, musical: 8 };

/** Cartes par équipe proposées pour une manche de mimes. */
export const MIME_PER_TEAM = [2, 3, 4, 5, 6, 8, 10];
export const MIME_PER_TEAM_DEFAULT = 5;

/** Difficultés : facile = éléments simples seulement, difficile = les plus durs d'abord, moyen = tout. */
export const LEVELS = { facile: "Facile", moyen: "Moyen", difficile: "Difficile" };

/** Clé qui regroupe ce qui a été joué : Zoom et Image floue partagent leurs photos, blind test et quiz musical leurs extraits. */
export const avoidKey = (type) => (type === "zoom" || type === "flou" ? "photos" : MUSIC_GAMES[type] ? "tracks" : type);

/**
 * Éléments de la collection d'un jeu : `{ key, label, group, level, value }`, sans doublon (la première occurrence
 * l'emporte). [lib] : `{ mimes, contents, quizzes, playlists }` lus dans la bibliothèque. [hasard] : pour un tirage au
 * hasard, seulement les émojis et la banque de photos libres, jamais une image téléversée (cedric, 21/10).
 */
export function collectionItems(type, lib = {}, { hasard = false } = {}) {
  const out = [];
  const seen = new Set();
  const add = (x) => { if (x.key && !seen.has(x.key)) { seen.add(x.key); out.push(x); } };
  if (type === "mimes") {
    MIME_CATALOG.forEach((c) => add({ key: c.word.toLowerCase(), label: `${c.image ?? ""} ${c.word}`.trim(), group: c.theme, level: c.level ?? 1, value: mimeCards([c])[0] }));
    // Les cartes de Sarah (anciens « paquets ») : une catégorie par paquet. Sa photo d'un mot du catalogue prend la place
    // de l'émoji de ce mot.
    Object.values(lib.mimes ?? {}).filter((d) => d?.title).sort((a, b) => a.title.localeCompare(b.title, "fr"))
      .forEach((d) => mimeCards(d.cards).forEach((c) => {
        // Au hasard : sa carte sans sa photo (l'émoji du catalogue reste en place).
        if (hasard) { const v = pourLeHasard("mimes", c); if (v) add({ key: v.word.toLowerCase(), label: `${v.image ?? ""} ${v.word}`.trim(), group: d.title, level: 1, value: v }); return; }
        const x = { key: c.word.toLowerCase(), label: `${c.imageId ? "📷" : c.image ?? ""} ${c.word}`.trim(), group: d.title, level: 1, value: c };
        const before = c.imageId ? out.findIndex((y) => y.key === x.key && !y.value.imageId) : -1;
        if (before >= 0) out[before] = x;
        else add(x);
      }));
  } else if (CONTENT_GAMES[type]) {
    const game = CONTENT_GAMES[type];
    activeItems(type, lib.contents?.[type]).map((x) => (hasard ? pourLeHasard(type, x) : x)).filter(Boolean).forEach((x) => add({
      key: game.key(x), label: game.label(x), level: x.level ?? 1, value: x,
      group: type === "pictionary" ? pictoSeriesOf(x) : type === "disparu" ? disparuGroup(x) : null,
    }));
  } else if (type === "zoom" || type === "flou") {
    // Au hasard : pas les photos des quiz (téléversées), seulement celles de la banque.
    if (!hasard) Object.values(lib.quizzes ?? {}).filter((q) => q?.title).sort((a, b) => a.title.localeCompare(b.title, "fr"))
      .forEach((qz) => zoomQuestions(qz).forEach((q) => add({ key: q.imageId, label: q.choices?.[q.correct] ?? q.text, group: qz.title, level: 1, value: q })));
    // Puis les photos de la banque, par famille (réponses en images pour ceux qui ne lisent pas encore).
    banqueItems().forEach(add);
  } else if (MUSIC_GAMES[type]) {
    Object.values(lib.playlists ?? {}).filter((p) => p?.title && !isStatuesList(p)).sort((a, b) => a.title.localeCompare(b.title, "fr"))
      .forEach((p) => playableTracks(p).forEach((t) => add({ key: t.audioId, label: t.artist?.trim() ? `${t.title.trim()} (${t.artist.trim()})` : t.title.trim(), group: p.title, level: 1, value: t })));
  } else if (type === "statues") {
    statuesChoices(lib.playlists).forEach((t) => add({ key: t.audioId, label: t.artist?.trim() ? `${t.title.trim()} (${t.artist.trim()})` : t.title.trim(), group: t.list, level: 1, value: t }));
  } else if (type === "quiz" || type === "illustre" || type === "express") {
    const questions = { quiz: quizQuestions, illustre: illustreQuestions, express: expressQuestions }[type];
    Object.entries(lib.quizzes ?? {}).filter(([, q]) => q?.title && questions(q).length)
      .sort((a, b) => a[1].title.localeCompare(b[1].title, "fr"))
      .forEach(([id, q]) => add({ key: id, label: q.title, group: { photo: "Quiz illustré", classique: "Quiz classique", images: "Photos à deviner" }[quizKind(q)], level: 1, value: q }));
  }
  return out;
}

/** Catégories d'une collection, dans l'ordre où elles apparaissent. */
export const collectionGroups = (items) => [...new Set(items.map((x) => x.group).filter(Boolean))];

/**
 * Éléments où piocher : catégories cochées (aucune : toutes), difficulté, âge (pas d'élément difficile pour les
 * Petits, sauf difficulté « difficile » demandée).
 */
export function filterItems(items, { groups = null, level = null, profile = null } = {}) {
  const inGroups = groups?.length ? items.filter((x) => groups.includes(x.group)) : items;
  if (level === "facile" || (profile === "PETITS" && level !== "difficile")) return inGroups.filter((x) => (x.level ?? 1) === 1);
  return inGroups;
}

/** Ce que montre un élément de collection (« jamais deux fois ») : son mot, son émoji, sa photo. */
export function itemConcepts(type, value) {
  if (type === "mimes") return concepts(value);
  if (type === "zoom" || type === "flou") return questionConcepts({ ...value, kind: type });
  return builtinConcepts(type, value);
}

/**
 * Tirage au hasard de [count] éléments : jamais un élément de [avoid] (déjà joué pendant la fête). En « difficile »,
 * les éléments les plus durs passent d'abord. `exhausted` : il n'en restait pas assez, la liste est plus courte.
 * [avoidConcepts] (« jamais deux fois ») : ce que montrent déjà les autres activités de la prestation ; évité tant
 * qu'il reste assez d'éléments neufs. [type] : le jeu, pour savoir ce que montre chaque élément.
 */
export function drawItems(items, count, { level = null, avoid = null, avoidConcepts = null, type = null } = {}, random = Math.random) {
  const unplayed = items.filter((x) => !avoid?.has(x.key));
  const fresh = type ? neufsSiPossible(unplayed, (x) => itemConcepts(type, x.value), avoidConcepts, count) : unplayed;
  const mixed = shuffle(fresh, random);
  const ordered = level === "difficile" ? [...mixed.filter((x) => (x.level ?? 1) >= 2), ...mixed.filter((x) => (x.level ?? 1) < 2)] : mixed;
  return { items: ordered.slice(0, count), exhausted: fresh.length < count, left: fresh.length };
}

/**
 * Manche tirée au hasard dans la collection d'un jeu, prête à jouer ou à enregistrer. [opts] : `profile`, `level`,
 * `groups`, `count`, `avoid` (Set des clés déjà jouées), `teams` et `perTeam` (mimes), `duration`, `objects`,
 * `base` (manche dont on garde les réglages : « Rejouer avec d'autres… »). Renvoie `{ round, exhausted, count }` ;
 * `round` est null quand la collection n'a plus rien à proposer.
 */
export function randomRound(type, lib, opts = {}, random = Math.random) {
  const base = opts.base ?? {};
  const settings = roundSettings(type, base, opts);
  // Qui a disparu ? en émojis : pas les familles de photos de la banque.
  // Jamais une image téléversée : seulement les émojis et la banque de photos libres (cedric, 21/10).
  const items = filterItems(collectionItems(type, lib, { hasard: true }), opts).filter((x) => type !== "disparu" || settings.photos || !isPhotoTheme(x.value));
  if (!RANDOM_TYPES.includes(type)) return { round: { type, ...settings }, exhausted: false, count: 0 };
  const perTeam = type === "mimes" ? mimePerTeam({ perTeam: opts.perTeam ?? base.perTeam }) : 0;
  const count = Math.max(1, Math.min(MAX_PICKS, opts.count
    ?? (perTeam ? perTeam * teamCount(opts.teams) : null)
    ?? baseCount(type, base)
    ?? RANDOM_COUNT[type] ?? BUILTIN_GAMES[type]?.count ?? 6));
  // Qui a disparu ? en « 📷 Photos » : les familles qui montrent le plus de photos d'abord (tirées au hasard entre elles).
  const enPhotos = type === "disparu" && settings.photos === true;
  const tirage = drawItems(items, enPhotos ? items.length : count, { ...opts, type }, random);
  const picked = enPhotos ? parPalierPhotos(tirage.items, (x) => x.value?.objects).slice(0, count) : tirage.items;
  const exhausted = enPhotos ? tirage.left < count : tirage.exhausted;
  if (!picked.length) return { round: null, exhausted: true, count: 0 };
  const keys = picked.map((x) => x.key);
  const round = type === "mimes" ? { type, ...settings, cards: picked.map((x) => x.value), ...(perTeam ? { perTeam } : {}) }
    : MUSIC_GAMES[type] ? { type, ...settings, tracks: keys }
    : { type, ...settings, picks: keys, ...(CONTENT_GAMES[type] ? { hasard: keys } : {}), ...(BUILTIN_GAMES[type] ? { count: keys.length } : {}) };
  return { round, exhausted, count: keys.length };
}

/** Nombre d'éléments d'une manche existante (pour la rejouer avec autant d'éléments). */
function baseCount(type, base) {
  if (type === "mimes") return mimeCards(base.cards).length || null;
  if (MUSIC_GAMES[type]) return chansonsDe(base).length || roundTracks(base).length || null;
  if (estJeuDeMots(type) && motsDuJeu(base).length) return motsDuJeu(base).length;
  return roundPicks(base).length || (Number.isInteger(base.count) && base.count > 0 ? base.count : null);
}

/** Réglages d'une manche (sans son contenu) : durée, objets par grille, séries… repris de [base] ou de [opts]. */
function roundSettings(type, base, opts) {
  const pick = (k) => opts[k] ?? base[k];
  // « 📷 Photos » (mimes, Qui a disparu ?) : les cartes dont le mot est dans la banque montrent sa photo.
  const photos = pick("photos") === true ? { photos: true } : {};
  if (type === "mimes") return { duration: pick("duration") ?? MIME_TURN, ...photos };
  if (type === "pictionary") return { duration: pick("duration") ?? PICTO_SEC, ...(pictoRoundSeries(base) ? { series: pictoRoundSeries(base) } : {}) };
  if (type === "disparu") return { ...(pick("objects") ? { objects: pick("objects") } : {}), ...photos };
  if (type === "statues") return { duration: pick("duration") ?? STATUES_SEC, songs: statuesSongs(opts.playlists ?? {}).map((t) => t.audioId).slice(0, MAX_STATUES_SONGS) };
  return {};
}

/**
 * Tout ce qui a déjà été joué dans un programme (questions de la partie), par clé de [avoidKey] : cartes de mimes,
 * mots, personnages, familles, photos, extraits. La régie s'en sert pour ne jamais rejouer la même chose.
 */
export function playedKeys(questions, contents = {}) {
  const out = {};
  // « Jamais deux fois » : tout ce que montre le programme (mots, émojis, photos), quel que soit le jeu.
  out.concepts = new Set((questions ?? []).flatMap(questionConcepts));
  const add = (k, v) => { if (typeof v === "string" && v) (out[k] ??= new Set()).add(v.toLowerCase()); };
  const themes = activeItems("disparu", contents?.disparu);
  for (const q of questions ?? []) {
    if (!q) continue;
    if (q.kind === "mime") (q.cards ?? []).forEach((c) => add("mimes", c?.word));
    else if (q.kind === "pictionary") (q.cards ?? []).forEach((c) => add("pictionary", c?.word));
    else if (q.kind === "chante") add("chante", q.choices?.[0]);
    else if (q.kind === "quisuis") add("quisuis", q.choices?.[0]);
    else if (q.kind === "disparu") {
      const words = new Set((q.cards ?? []).map((c) => c?.word));
      const theme = themes.find((t) => [...words].every((w) => t.objects.some((o) => o.word === w)));
      add("disparu", theme?.theme);
    } else if (q.kind === "zoom" || q.kind === "flou") {
      add("photos", q.imageId);
      // La même chose en photo de la banque n'est pas retirée non plus (« jamais deux fois »).
      const m = motDeLaBanque(q.choices?.[q.correct]);
      if (m) add("photos", `${BANQUE}${m.cle}`);
    }
    if (q.audioId) add("tracks", q.audioId);
    // Questions de quiz déjà posées (« 🔁 Rejouer » en pose d'autres).
    if (["classic", "number", "true_false", "express"].includes(q.kind)) add("questions", q.text);
  }
  return out;
}

/** Type de jeu d'une question du programme (pour « Rejouer avec d'autres… »), ou null. */
export function questionType(q) {
  if (!q) return null;
  if (q.kind === "mime") return "mimes";
  if (["pictionary", "chante", "quisuis", "disparu", "zoom", "flou", "statues", "coffres", "patate", "gonfleur", "express"].includes(q.kind)) return q.kind;
  if (q.kind === "blind") return "blind";
  if (q.audioId) return "musical";
  return "quiz";
}

/** Jeux relancés tels quels par « 🔁 Rejouer » : rien à tirer, les mêmes réglages. */
export const REJOUES_TELS_QUELS = ["coffres", "patate", "gonfleur", "statues"];

/**
 * « 🔁 Rejouer » sur la régie (cedric, 21/10 : dans tous les jeux), pour un jeu qui ne se tire pas dans les collections :
 * la source du jeu à relancer, d'après ses questions au programme ([played]). Ça va exploser !, Coffres mystères,
 * Gonfleur fou, Statues : le même jeu, mêmes réglages. Quiz, Quiz illustré, Vrai ou Faux : le ou les mêmes quiz
 * (retrouvés par leurs questions), autant de questions, jamais celles déjà posées (la régie passe ce qui est joué).
 * Null quand le quiz n'est plus dans la bibliothèque.
 */
export function sourceRejouee(type, played, quizzes = {}) {
  const q = (played ?? []).find(Boolean);
  if (type === "coffres" || type === "patate" || type === "gonfleur") return { type };
  if (type === "statues") return { type, ...(q?.duration ? { duration: q.duration } : {}), songs: (q?.audioIds ?? []).filter((id) => typeof id === "string") };
  if (type !== "quiz" && type !== "express") return null;
  const textes = new Set((played ?? []).map((x) => x?.text).filter(Boolean));
  const ids = Object.entries(quizzes ?? {}).filter(([, qz]) => (qz?.questions ?? []).some((x) => x && textes.has(x.text))).map(([id]) => id);
  if (!ids.length) return null;
  // Questions reprises par le hasard (`hasard`) : jamais une image téléversée par cedric (voir buildSnapshot).
  return jeuDeLaManche({ type, quizId: ids[0], ...(ids.length > 1 ? { quizIds: ids } : {}), count: (played ?? []).length, hasard: true }, quizzes);
}

/**
 * Manche propre, telle qu'enregistrée dans une prestation ou dans `library/manches` : seulement les champs du jeu,
 * dans leurs limites. [playlists] sert aux chansons des statues. Le lien `mancheId` vers la manche d'origine est gardé.
 */
export function cleanRound(r, playlists = {}) {
  const type = r?.type ?? "quiz";
  // Éléments tirés au hasard : notés, pour ne jamais leur montrer d'image téléversée.
  const picks = roundPicks(r).length ? { picks: roundPicks(r), ...(CONTENT_GAMES[type] && roundHasard(r).length ? { hasard: roundHasard(r) } : {}) } : {};
  const link = typeof r?.mancheId === "string" && r.mancheId ? { mancheId: r.mancheId.slice(0, 40) } : {};
  const title = typeof r?.title === "string" && r.title.trim() ? { title: r.title.trim().slice(0, 60) } : {};
  // Note de Sarah sur la manche (cedric, 23/10) : pour s'en souvenir et la retrouver.
  const note = typeof r?.note === "string" && r.note.trim() ? { note: r.note.trim().slice(0, 200) } : {};
  let out;
  const photos = (type === "mimes" || type === "disparu") && r.photos === true ? { photos: true } : {};
  if (BUILTIN_GAMES[type]) {
    // Jeu de mots en séries (cedric, 24/10) : chaque série (🎲, écrits à la main), cases retirées comprises (en attente
    // de leur 🎲), et l'ordre du « complet » s'il a été rangé à la main.
    const series = estJeuDeMots(type) ? seriesMots(r).map((x) => ({
      id: x.id.slice(0, 40), origine: x.origine, mots: x.mots.slice(0, MAX_MOTS),
      // Ancien anniversaire, série de la bibliothèque : son nom.
      ...(typeof x.titre === "string" && x.titre.trim() ? { titre: x.titre.trim().slice(0, 80) } : {}),
      // Qui suis-je ? (cedric, 25/10) : une série piochée dans mes packs garde son dé, le mot tapé et l'âge.
      ...(x.origine === "biblio" && ["hasard", "theme", "recherche"].includes(x.pioche?.mode)
        ? { pioche: { mode: x.pioche.mode, ...(typeof x.pioche.terme === "string" && x.pioche.terme.trim() ? { terme: x.pioche.terme.trim().slice(0, 80) } : {}),
          ...(PROFILES[x.pioche.profil] ? { profil: x.pioche.profil } : {}) } } : {}),
    })).filter((x) => x.mots.length) : [];
    const ordre = series.length && Object.values(r.ordreMots ?? {}).length ? motsDuJeu(r).map((x) => x.cle) : [];
    // Qui a disparu ? (cedric, 27/10) : l'âge choisi dans sa carte (la difficulté des familles) reste.
    out = { type, count: r.count ?? BUILTIN_GAMES[type].count, ...(type === "disparu" && r.objects ? { objects: r.objects } : {}), ...photos,
      ...(type === "disparu" && PROFILES[r.profil] ? { profil: r.profil } : {}),
      // Et la source des images du 🎲 : émojis, images réelles ou mixte.
      ...(type === "disparu" && ["emojis", "reelles", "mixte"].includes(r.images) ? { images: r.images } : {}),
      ...(series.length ? { seriesMots: series, ...(ordre.length ? { ordreMots: ordre } : {}) } : picks) };
  }
  // Mimes : un paquet, ou le catalogue au hasard ; cartes choisies (tirage modifié à la main) gardées dans la manche.
  else if (type === "mimes" && mimeEquipesBrutes(r).some((l) => l.length)) {
    // Une présélection par équipe, tirée au 🎲 (cedric, 23/10) : la source choisie, les images de chaque équipe dans
    // l'ordre des couleurs (cases retirées comprises, en attente de leur 🎲), images par équipe et durée du tour.
    out = {
      type, source: MIME_SOURCES[r.source] ? r.source : "photos", equipes: mimeEquipesBrutes(r),
      ...(mimePerTeam(r) ? { perTeam: mimePerTeam(r) } : {}),
      // La tranche d'âge choisie à la main pour une équipe (cedric, 24/10), par rang d'équipe.
      ...(mimeAges(r).some(Boolean) ? { ages: Object.fromEntries(mimeAges(r).map((p, k) => [k, p]).filter(([, p]) => p)) } : {}),
      ...(Number.isInteger(r.duration) && r.duration >= 15 && r.duration <= 180 ? { duration: r.duration } : {}),
    };
  } else if (type === "mimes") {
    const cards = mimeCards(r.cards).slice(0, 200);
    out = {
      type, ...(r.deckId ? { deckId: r.deckId } : cards.length ? {} : { random: true }), ...(cards.length ? { cards } : {}),
      ...(Number.isInteger(r.duration) && r.duration >= 15 && r.duration <= 180 ? { duration: r.duration } : {}),
      ...(mimePerTeam(r) ? { perTeam: mimePerTeam(r) } : {}), ...photos,
    };
  } else if (type === "statues") {
    // Vos chansons de la bibliothèque des sons (cedric, 24/10), sinon les extraits cochés dans les playlists (avant).
    out = { type, duration: r.duration ?? STATUES_SEC, ...(chansonsStatues(r).length ? { chansons: chansonsStatues(r) }
      : roundSongs(r, playlists).length ? { songs: roundSongs(r, playlists).map((t) => t.audioId) } : {}) };
  }
  // Pictionary préparé par équipe (cedric, 24/10) : les passages de chaque équipe dans l'ordre des couleurs (cases
  // retirées comprises, en attente de leur 🎲), les mots proposés à chaque passage et le nombre de passages du 🎲.
  else if (type === "pictionary" && pictoToursBruts(r).some((ps) => ps.length)) {
    out = { type, duration: r.duration ?? PICTO_SEC, tours: pictoToursBruts(r), propositions: pictoPropositions(r), passages: pictoPassages(r) };
  } else if (type === "pictionary") out = { type, duration: r.duration ?? PICTO_SEC, ...(pictoRoundSeries(r) ? { series: pictoRoundSeries(r) } : {}), ...picks };
  else if (type === "patate") out = { type, ...(Number.isInteger(r.bombs) ? { bombs: bombesDe(r) } : {}) };
  else if (type === "coffres" || type === "gonfleur") out = { type };
  // Le Duel des robots (cedric, 27/10) : joueurs par équipe (environ), durée min / max du face-à-face, longs duels.
  else if (type === "duel") out = { type, ...reglagesDuel(r) };
  // Le Simon de Buzzy (cedric, 27/10) : tours, secondes pour taper une suite, joueurs par équipe (environ).
  else if (type === "simon") out = { type, ...reglagesSimon(r) };
  // Le Chrono de Buzzy (cedric, 30/10) : la cible (secondes) et le nombre de tours.
  else if (type === "chrono") out = { type, ...reglagesChrono(r) };
  // Blind test tiré au 🎲 dans la bibliothèque des sons (cedric, 24/10) : ses chansons dans l'ordre, cases retirées
  // comprises (en attente de leur 🎲), et le nombre demandé.
  else if (JEUX_DE_CHANSONS.includes(type) && chansonsBrutes(r).some(Boolean)) {
    // En séries (cedric, 24/10) : chaque série (🎲, playlist, chansons choisies) et l'ordre du « Blind test complet » ;
    // `chansons` garde aussi l'ordre de passage, lu par les pages d'avant les séries.
    const series = seriesBlind(r).map((x) => ({
      id: x.id.slice(0, 40), origine: x.origine, chansons: x.chansons.slice(0, MAX_CHANSONS_BLIND),
      ...(typeof x.titre === "string" && x.titre.trim() ? { titre: x.titre.trim().slice(0, 120) } : {}),
      ...(typeof x.playlistId === "string" && x.playlistId ? { playlistId: x.playlistId.slice(0, 40) } : {}),
    })).filter((x) => x.chansons.length);
    const ordre = series.length ? chansonsDe(r) : [];
    // Quiz musical : les mauvaises réponses modifiées dans la prestation, par chanson (cedric, 24/10).
    const leurres = leurresDeLaManche(r);
    out = {
      type, chansons: chansonsBrutes(r), ...(BLIND_NOMBRES.includes(r.nbChansons) ? { nbChansons: r.nbChansons } : {}),
      ...(series.length ? { seriesBlind: series, ...(Object.values(r.ordreBlind ?? {}).length ? { ordreBlind: ordre } : {}) } : {}),
      ...(Object.keys(leurres).length ? { leurres } : {}),
    };
  } else if (MUSIC_GAMES[type]) out = roundTracks(r).length ? { type, tracks: roundTracks(r) } : { type, playlistId: r.playlistId };
  else if ((type === "zoom" || type === "flou") && roundPicks(r).length && !roundSeriesQuiz(r).length) out = { type, ...picks };
  else if (estEnSeries(type) && roundSeriesQuiz(r).length) {
    // Manche Quiz faite de séries (cedric, 23/10) : les séries dans l'ordre, une seule Super Finale et son multiplicateur.
    const seriesQuiz = roundSeriesQuiz(r).map(serieNettoyee).filter(Boolean);
    // L'ordre rangé à la main dans le « Quiz complet » (cedric, 23/10) : les clés de ses questions.
    const ordreQuiz = [...new Set((Array.isArray(r.ordreQuiz) ? r.ordreQuiz : Object.values(r.ordreQuiz ?? {})).filter((c) => typeof c === "string" && c && c.length <= 400))]
      .slice(0, 2 * MAX_QUESTIONS_MANCHE);
    // Un seul de ses quiz, en entier : enregistré comme avant les séries (même manche, lue partout pareil).
    const seul = seriesQuiz.length === 1 && seriesQuiz[0].origine === "quiz" && !seriesQuiz[0].sans?.length && !ordreQuiz.length ? seriesQuiz[0].quizId : null;
    out = { type, ...(seul ? { quizId: seul } : seriesQuiz.length ? { seriesQuiz, ...(ordreQuiz.length ? { ordreQuiz } : {}) } : {}),
      ...(hasFinale(type) && r.finale > 0 ? { finale: Math.min(Math.floor(r.finale), 20) } : {}),
      ...(hasFinale(type) && r.finale > 0 && FACTEURS_FINALE.includes(r.facteur) && r.facteur !== FACTEURS_FINALE[0] ? { facteur: r.facteur } : {}),
      ...(type === "quiz" && r.bougies === false ? { bougies: false } : {}),
      // L'âge de la première ligne du Quiz (cedric, 25/10), d'office pour ses dés.
      ...(type === "quiz" && PROFILES[r.profil] ? { profil: r.profil } : {}) };
  } else {
    const ids = roundQuizIds(r);
    // Questions tirées au 🎲 (cedric, 23/10) : gardées dans la manche, avec le profil qui a servi au tirage.
    const tirees = roundTirees(r).map((q) => ({
      ...(typeof q.id === "string" ? { id: q.id.slice(0, 120) } : {}), text: q.text.trim().slice(0, 300),
      ...(q.nombre ? { nombre: true } : { choices: q.choices.map((c) => c.trim().slice(0, 120)) }), correct: q.correct,
      ...(q.nombre ? {} : typeof q.banque === "string" && q.banque ? { banque: q.banque.slice(0, 120) } : typeof q.emoji === "string" && q.emoji ? { emoji: q.emoji.slice(0, 16) } : {}),
    }));
    // Un quiz choisi en plus (deuxième ligne) reste, avec son nombre de questions.
    out = { type, ...(tirees.length ? { tirees, ...(PROFILES[r.profil] ? { profil: r.profil } : {}) } : {}),
      ...(ids.length || !tirees.length ? { quizId: ids[0], ...(ids.length > 1 ? { quizIds: ids } : {}), ...(r.count > 0 ? { count: r.count } : {}) } : {}),
      ...(hasFinale(type) && r.finale > 0 ? { finale: r.finale } : {}),
      // Question des bougies enlevée de ce quiz (elle y est d'office, voir questionBougies).
      ...(type === "quiz" && r.bougies === false ? { bougies: false } : {}),
      // L'âge de la première ligne du Quiz (cedric, 25/10), d'office pour ses dés.
      ...(type === "quiz" && PROFILES[r.profil] ? { profil: r.profil } : {}) };
  }
  return { ...out, ...title, ...note, ...link };
}

/**
 * Une question gardée dans une série, nettoyée pour l'enregistrement. Écrite à la main ([brouillon]) : gardée même pas
 * finie (elle n'est pas jouée tant qu'il lui manque quelque chose), ses 4 cases de réponse à leur place.
 */
function questionNettoyee(q, brouillon) {
  if (!q || q.vide === true || (!brouillon && !questionJouable(q))) return null;
  const texte = (x, n) => (typeof x === "string" ? x.trim().slice(0, n) : "");
  const base = { ...(typeof q.id === "string" ? { id: q.id.slice(0, 120) } : {}), text: texte(q.text, 300) };
  if (q.nombre === true) return { ...base, nombre: true, ...(Number.isInteger(q.correct) ? { correct: q.correct } : {}) };
  const choices = (Array.isArray(q.choices) ? q.choices : Object.values(q.choices ?? {})).slice(0, 4).map((c) => texte(c, 120));
  if (brouillon && !base.text && !choices.some(Boolean)) return null;
  // Quiz illustré : une image par réponse, photo de la banque ({ cle, emoji }) ou image déjà copiée (identifiant).
  const libre = (x) => (x && typeof x === "object" && (typeof x.cle === "string" || typeof x.emoji === "string")
    ? { ...(typeof x.cle === "string" && x.cle ? { cle: x.cle.slice(0, 120) } : {}), ...(typeof x.emoji === "string" && x.emoji ? { emoji: x.emoji.slice(0, 16) } : {}) } : null);
  const banques = Array.isArray(q.choiceBanque) ? q.choiceBanque.slice(0, choices.length).map(libre) : [];
  const images = q.choiceImages && typeof q.choiceImages === "object"
    ? choices.map((_, k) => (typeof q.choiceImages[k] === "string" && /^[0-9a-f]{16}$/.test(q.choiceImages[k]) ? q.choiceImages[k] : "")) : [];
  return {
    ...base, choices, ...(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < choices.length ? { correct: q.correct } : {}),
    ...(typeof q.banque === "string" && q.banque ? { banque: q.banque.slice(0, 120) } : typeof q.imageId === "string" && /^[0-9a-f]{16}$/.test(q.imageId) ? { imageId: q.imageId }
      : typeof q.emoji === "string" && q.emoji ? { emoji: q.emoji.slice(0, 16) } : {}),
    // Toutes les réponses ont leur image (une case vide ne se garderait pas dans la base) : sinon, rien.
    ...(banques.length === choices.length && banques.every(Boolean) ? { choiceBanque: banques } : {}),
    ...(images.some(Boolean) ? { choiceImages: images } : {}),
    // Zoom mystère : le départ du zoom réglé dans la Régie PC (cedric, 31/10).
    ...(departZoom(q.zoomDepart) ? { zoomDepart: departZoom(q.zoomDepart) } : {}),
    // Image floue : le flou de départ réglé dans la Régie PC (cedric, 01/11).
    ...(departFlou(q.flouDepart) ? { flouDepart: departFlou(q.flouDepart) } : {}),
  };
}

/** Une série d'une manche Quiz (ou Quiz illustré), nettoyée ; vide : enlevée. */
function serieNettoyee(x) {
  const base = { id: `${x.id ?? ""}`.slice(0, 40) || `s${Math.random().toString(36).slice(2, 8)}`, origine: x.origine,
    ...(typeof x.titre === "string" && x.titre.trim() ? { titre: x.titre.trim().slice(0, 120) } : {}) };
  if (x.origine === "quiz") {
    const sans = [...new Set(x.sans.map((t) => `${t}`.trim().slice(0, 300)).filter(Boolean))].slice(0, MAX_QUESTIONS_MANCHE);
    return { ...base, quizId: x.quizId.slice(0, 120), ...(sans.length ? { sans } : {}) };
  }
  const questions = x.questions.map((q) => questionNettoyee(q, x.origine === "main")).filter(Boolean).slice(0, MAX_QUESTIONS_MANCHE);
  if (!questions.length) return null;
  // Le réglage du 🎲 : le profil (Quiz) ou le thème (Quiz illustré).
  return { ...base, ...(x.origine === "de" && PROFILES[x.profil] ? { profil: x.profil } : {}),
    ...(x.origine === "de" && typeof x.famille === "string" && /^[a-z]{2,20}$/.test(x.famille) ? { famille: x.famille } : {}),
    // Série piochée dans les packs (« 🎨 Mes thèmes », cedric 25/10) : son dé et le mot tapé, pour la refaire.
    ...(x.origine === "reprise" && ["hasard", "theme", "recherche"].includes(x.pioche?.mode)
      ? { pioche: { mode: x.pioche.mode, ...(typeof x.pioche.terme === "string" && x.pioche.terme.trim() ? { terme: x.pioche.terme.trim().slice(0, 80) } : {}),
        ...(PROFILES[x.pioche.profil] ? { profil: x.pioche.profil } : {}) } } : {}),
    questions };
}

/**
 * Une manche Quiz d'avant les séries (cedric, 23/10) en séries : ses questions tirées au 🎲 (série « de »), puis chacun
 * de ses quiz (séries « quiz ») ; « les N premières » devient les questions retirées des quiz. Même jeu sur la TV.
 * Une autre manche (ou déjà en séries, ou rejouée au hasard) : telle quelle.
 */
export function versSeriesQuiz(round, quizzes = {}) {
  // Une ancienne manche « Quiz » faite seulement de quiz illustrés est un Quiz illustré.
  round = round ? jeuDeLaManche(round, quizzes) : round;
  if (!round || !estEnSeries(round.type) || round.hasard === true || Array.isArray(round.seriesQuiz) || (round.seriesQuiz && typeof round.seriesQuiz === "object")) return round;
  const { tirees, profil, quizId, quizIds, count, nbTirage, picks, hasard, byItem, ...reste } = round;
  const type = round.type ?? "quiz";
  const seriesQuiz = [];
  const cases = (Array.isArray(tirees) ? tirees : Object.values(tirees ?? {})).filter(Boolean);
  if (cases.length) seriesQuiz.push({ id: "de", origine: "de", ...(PROFILES[profil] ? { profil } : {}), questions: cases });
  // Zoom mystère, Image floue : les photos choisies une par une (banque ou ses quiz) deviennent une série copiée.
  const photos = estJeuDePhotos(type) && roundPicks(round).length ? zoomRoundQuestions({ type, picks }, quizzes) : [];
  if (photos.length) {
    seriesQuiz.push({ id: "photos", origine: "reprise", titre: "Photos choisies", questions: photos.map((q) => ({
      id: signatureQuestion(q, type), text: q.text, choices: [...q.choices], correct: q.correct, ...(q.banque ? { banque: q.banque } : { imageId: q.imageId }) })) });
  }
  let reste2 = count > 0 ? count : Infinity;
  for (const id of photos.length ? [] : roundQuizIds({ type: "quiz", quizId, quizIds })) {
    const toutes = quizzes?.[id] ? questionsDuJeu(type, quizzes[id]) : [];
    const garde = Math.min(reste2, toutes.length);
    if (quizzes?.[id] && garde <= 0) continue;
    reste2 -= garde;
    const sans = toutes.slice(garde).map((q) => signatureQuestion(q, type));
    seriesQuiz.push({ id: `q-${id}`.slice(0, 40), origine: "quiz", quizId: id, ...(sans.length ? { sans } : {}) });
  }
  return { ...reste, ...(PROFILES[profil] && !cases.length ? { profil } : {}), ...(nbTirage ? { nbTirage } : {}), ...(seriesQuiz.length ? { seriesQuiz } : {}) };
}

/**
 * Un Quiz = une seule manche (cedric, 23/10) : les manches Quiz qui se suivent n'en font plus qu'une, leurs séries à la
 * suite, la Super Finale de la dernière (une seule, à la fin), la question des bougies de la première. [fusions] :
 * manches réunies. Les manches doivent déjà être en séries (versSeriesQuiz).
 */
export function fusionnerQuiz(rounds) {
  const out = [];
  let fusions = 0;
  // Le Quiz illustré aussi (cedric, 23/10) : deux Quiz illustrés qui se suivent n'en font qu'un.
  const estQuiz = (r) => r && estEnSeries(r.type) && r.hasard !== true;
  for (const r of rounds ?? []) {
    const prev = out[out.length - 1];
    if (!estQuiz(r) || !estQuiz(prev) || (r.type ?? "quiz") !== (prev.type ?? "quiz")) { out.push(r); continue; }
    fusions++;
    const ids = new Set(roundSeriesQuiz(prev).map((x) => x.id));
    const ajout = roundSeriesQuiz(r).map((x) => {
      // Une seule série du dé (celle de la première ligne) : les autres tirages deviennent des questions reprises.
      const autreDe = x.origine === "de" && roundSeriesQuiz(prev).some((y) => y.origine === "de");
      const id = ids.has(x.id) || autreDe ? `${x.id}-${Math.random().toString(36).slice(2, 7)}` : x.id;
      ids.add(id);
      return autreDe ? { ...x, id, origine: "reprise", titre: x.titre ?? "Tirage au 🎲" } : { ...x, id };
    });
    const { mancheId, ...garde } = prev;
    out[out.length - 1] = {
      ...garde, seriesQuiz: [...roundSeriesQuiz(prev), ...ajout],
      finale: r.finale === undefined ? prev.finale : r.finale, ...(r.facteur ?? prev.facteur ? { facteur: r.facteur ?? prev.facteur } : {}),
      ...(prev.note || r.note ? { note: [prev.note, r.note].filter(Boolean).join(" · ").slice(0, 200) } : {}),
    };
  }
  return { rounds: out, fusions };
}

/**
 * Blind test en séries (cedric, 24/10) : celui d'avant (une liste de chansons) devient la série du 🎲 ; lu dans la base,
 * il redevient des listes. Rien pour un blind test d'une playlist entière préparé à l'ancienne (joué tel quel). Change
 * [r] sur place (les séries gardent leur identité à l'écran) et le rend.
 */
export function versSeriesBlind(r) {
  if (!JEUX_DE_CHANSONS.includes(r?.type)) return r;
  if (Array.isArray(r.seriesBlind) && r.seriesBlind.every((x) => Array.isArray(x?.chansons))) return r;
  const lues = seriesBlind(r);
  const avant = chansonsBrutes({ type: r.type, chansons: r.chansons });
  r.seriesBlind = lues.length ? lues : avant.some(Boolean) ? [{ id: "de", origine: "de", chansons: avant }] : [];
  return r;
}

/**
 * Pas de manches dans un blind test (cedric, 24/10 : « on a juste un nombre de chansons à trouver ») : les blind tests
 * qui se suivent n'en font plus qu'un, leurs séries à la suite (un seul 🎲, une seule série de chansons choisies ; une
 * chanson n'y passe qu'une fois, 50 au plus). Un blind test vide à côté d'un autre part. Un blind test préparé à
 * l'ancienne (une playlist entière, des extraits choisis) reste à part, joué tel quel. [fusions] : blind tests réunis.
 * Les manches doivent déjà être en séries (versSeriesBlind).
 */
export function fusionnerBlind(rounds) {
  const out = [];
  let fusions = 0;
  // Le Quiz musical aussi (cedric, 24/10) : deux Quiz musicaux qui se suivent n'en font qu'un.
  const blind = (r) => JEUX_DE_CHANSONS.includes(r?.type);
  const ancien = (r) => blind(r) && !seriesBlind(r).length && !!(r.playlistId || roundTracks(r).length);
  const vide = (r) => blind(r) && !ancien(r) && !seriesBlind(r).some((x) => x.chansons.length);
  for (const r of rounds ?? []) {
    const prev = out[out.length - 1];
    if (!blind(r) || !blind(prev) || r.type !== prev.type) { out.push(r); continue; }
    if (vide(r)) continue;
    if (vide(prev)) { out[out.length - 1] = r; continue; }
    if (ancien(r) || ancien(prev)) { out.push(r); continue; }
    fusions++;
    const series = seriesBlind(prev).map((x) => ({ ...x, chansons: [...x.chansons] }));
    const ids = new Set(series.map((x) => x.id));
    let place = MAX_CHANSONS_BLIND - chansonsBrutes(prev).length;
    const deja = new Set(chansonsDe(prev));
    for (const x of seriesBlind(r)) {
      const neuves = x.chansons.filter((id) => !id || (!deja.has(id) && deja.add(id))).slice(0, Math.max(0, place));
      place -= neuves.length;
      if (!neuves.length) continue;
      // Un seul 🎲 et une seule série de chansons choisies : les suivantes s'y ajoutent.
      const meme = x.origine === "playlist" ? null : series.find((y) => y.origine === x.origine);
      if (meme) { meme.chansons.push(...neuves); continue; }
      const id = ids.has(x.id) ? `${x.id}-${Math.random().toString(36).slice(2, 7)}`.slice(0, 40) : x.id;
      ids.add(id);
      series.push({ ...x, id, chansons: neuves });
    }
    const ordre = (y) => listOfIds(y.ordreBlind);
    const { mancheId, ...garde } = prev;
    out[out.length - 1] = {
      ...garde, seriesBlind: series,
      // Rangé à la main dans l'un ou l'autre : l'ordre suit, celui du premier puis celui du second.
      ...(ordre(prev).length || ordre(r).length ? { ordreBlind: [...chansonsDe(prev), ...chansonsDe(r).filter((id) => !chansonsDe(prev).includes(id))] } : {}),
      // Quiz musical : les mauvaises réponses rangées dans l'un ou l'autre suivent leurs chansons.
      ...(prev.leurres || r.leurres ? { leurres: { ...(r.leurres ?? {}), ...(prev.leurres ?? {}) } } : {}),
    };
    out[out.length - 1].chansons = chansonsBrutes(out[out.length - 1]);
  }
  return { rounds: out, fusions };
}
const listOfIds = (x) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : []).filter((id) => typeof id === "string" && id);

/** Nombre de propositions d'une photo à deviner : la bonne et jusqu'à 3 autres. */
const PROPOSITIONS_PHOTO = 4;
const IMAGE_ID = /^[0-9a-f]{16}$/;

/**
 * Zoom mystère, Image floue (cedric, 23/10 : « créer une manche à travers mes images perso ») : ses images de « Mes
 * images » ([{ id, nom }]) en photos à deviner pour la série « ⭐ Vos images ». La réponse est le nom de l'image, tel
 * quel ; les autres propositions (le Zoom mystère en montre 4 sur les pupitres) viennent d'abord de [voisines] (les
 * réponses de la série) et des autres images ajoutées en même temps, puis de [secours] (ses autres images, des mots de
 * la banque). Une image sans nom, ou déjà dans le jeu ([deja] : leurs identifiants), n'en fait pas partie.
 */
export function photosDeMesImages(images, { voisines = [], secours = [], deja = [], random = Math.random } = {}) {
  const pris = new Set(deja);
  const nom = (x) => `${typeof x === "string" ? x : x?.nom ?? ""}`.trim();
  const norm = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const gardees = images.filter((x) => IMAGE_ID.test(x?.id ?? "") && nom(x) && !pris.has(x.id) && pris.add(x.id));
  const proches = [...voisines, ...gardees].map(nom).filter(Boolean);
  const loin = secours.map(nom).filter(Boolean);
  return gardees.map((x) => {
    const reponse = nom(x);
    const vus = new Set([norm(reponse)]);
    const autres = [];
    for (const t of [...shuffle(proches, random), ...shuffle(loin, random)]) {
      if (autres.length >= PROPOSITIONS_PHOTO - 1) break;
      if (vus.has(norm(t))) continue;
      vus.add(norm(t));
      autres.push(t);
    }
    const choices = shuffle([reponse, ...autres], random);
    return { id: `i:${x.id}`, text: "Qu'est-ce que c'est ?", choices, correct: choices.indexOf(reponse), imageId: x.id };
  });
}

/** « 19 questions : 🎲 8 tirées (Grands) · 📚 Animaux (8) · ✍ 3 écrites » : une manche Quiz faite de séries. */
export function resumeDesSeries(round, quizzes = {}) {
  const type = round?.type ?? "quiz";
  const parts = roundSeriesQuiz(round).map((x) => {
    const n = questionsDeLaSerie(x, quizzes, type).length;
    if (x.origine === "de") {
      const sorte = type === "quiz" || type === "express" ? PROFILES[x.profil]?.label.split(" (")[0] ?? "" : FAMILLES_PETITS[x.famille] ?? "";
      return `🎲 ${n} tirée${n > 1 ? "s" : ""}${sorte ? ` (${sorte})` : ""}`;
    }
    if (x.origine === "main") return `✍ ${n} écrite${n > 1 ? "s" : ""}`;
    if (x.origine === "images") return `⭐ ${n} choisie${(x.questions ?? []).filter(Boolean).length > 1 ? "s" : ""} dans la bibliothèque`;
    if (x.origine === "quiz") return `📚 ${quizzes?.[x.quizId]?.title ?? "quiz supprimé"} (${n})`;
    return `📅 ${x.titre ?? "reprise"} (${n})`;
  });
  const total = roundSeriesQuiz(round).reduce((t, x) => t + questionsDeLaSerie(x, quizzes, type).length, 0);
  const unite = estJeuDePhotos(type) ? "photo" : type === "express" ? "affirmation" : "question";
  return `${total} ${unite}${total > 1 ? "s" : ""}${parts.length ? ` : ${parts.join(" · ")}` : ""}`;
}

/**
 * Groupes de la page Manches d'un jeu : épinglées, les autres (plus récentes d'abord), archivées. Avec [quizzes],
 * une ancienne manche « Quiz » faite de quiz illustrés est rangée avec le Quiz illustré (voir jeuDeLaManche).
 */
export function mancheGroups(manches, type, quizzes = null) {
  const jeu = (m) => (quizzes && (m.type ?? m.round.type) === "quiz" ? jeuDeLaManche(m.round, quizzes).type : m.type ?? m.round.type);
  const list = Object.entries(manches ?? {}).filter(([, m]) => m?.round && jeu(m) === type)
    .sort(([, a], [, b]) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
  return {
    pinned: list.filter(([, m]) => m.pinned && !m.archived),
    active: list.filter(([, m]) => !m.pinned && !m.archived),
    archived: list.filter(([, m]) => m.archived),
  };
}

/** « 12 cartes · 3 par équipe · tour de 60 s » : ce que contient une manche, en une ligne. */
export function mancheSummary(round, lib = {}) {
  const r = round ?? {};
  const n = (k, unit) => (k ? `${k} ${COLLECTION_UNIT[r.type]?.[k > 1 ? 1 : 0] ?? unit}` : "");
  if (r.type === "mimes" && mimeEquipes(r).some((l) => l.length)) {
    const equipes = mimeEquipes(r).filter((l) => l.length).length;
    const images = mimeEquipes(r).flat().length;
    return [`${images} image${images > 1 ? "s" : ""} pour ${equipes} équipe${equipes > 1 ? "s" : ""}`, MIME_SOURCES[r.source] ?? MIME_SOURCES.photos,
      `tour de ${r.duration ?? MIME_TURN} s`].join(" · ");
  }
  if (r.type === "mimes") {
    const cards = mimeCards(r.cards).length;
    const deck = r.deckId ? lib.mimes?.[r.deckId] : null;
    return [cards ? n(cards) : deck ? `${deck.title} (${(deck.cards ?? []).length} cartes)` : "cartes au hasard",
      mimePerTeam(r) ? `${mimePerTeam(r)} par équipe` : "", `tour de ${r.duration ?? deck?.duration ?? MIME_TURN} s`, r.photos === true ? "📷 photos" : ""].filter(Boolean).join(" · ");
  }
  if (r.type === "disparu" && r.photos === true) return `${roundPicks(r).length ? n(roundPicks(r).length) : `${r.count ?? BUILTIN_GAMES.disparu.count} au hasard`} · 📷 photos`;
  if (JEUX_DE_CHANSONS.includes(r.type) && chansonsDe(r).length) return `${chansonsDe(r).length} chanson${chansonsDe(r).length > 1 ? "s" : ""}`;
  if (MUSIC_GAMES[r.type]) return roundTracks(r).length ? n(roundTracks(r).length) : lib.playlists?.[r.playlistId]?.title ?? "playlist";
  if (r.type === "statues") {
    const k = chansonsStatues(r).length;
    return k ? `${k} chanson${k > 1 ? "s" : ""}` : roundSongs(r, lib.playlists).length ? n(roundSongs(r, lib.playlists).length) : "musique de la fête";
  }
  if (r.type === "pictionary" && pictoTours(r).some((ps) => ps.length)) {
    // Préparé par équipe (cedric, 24/10) : passages et mots proposés.
    const tours = pictoTours(r);
    const equipes = tours.filter((ps) => ps.length).length;
    const passages = tours.reduce((t, ps) => t + ps.length, 0);
    return [`${passages} passage${passages > 1 ? "s" : ""} pour ${equipes} équipe${equipes > 1 ? "s" : ""}`, `${pictoPropositions(r)} mots proposés`,
      `${r.duration ?? PICTO_SEC} s de dessin`].join(" · ");
  }
  if (r.type === "pictionary") return [roundPicks(r).length ? n(roundPicks(r).length) : "mots au hasard", `${r.duration ?? PICTO_SEC} s de dessin`].join(" · ");
  if (estJeuDeMots(r.type) && motsDuJeu(r).length) return n(motsDuJeu(r).length);
  if (BUILTIN_GAMES[r.type]) return roundPicks(r).length ? n(roundPicks(r).length) : `${r.count ?? BUILTIN_GAMES[r.type].count} au hasard`;
  if ((r.type === "zoom" || r.type === "flou") && roundPicks(r).length) return n(roundPicks(r).length);
  if (r.type === "coffres" || r.type === "patate" || r.type === "gonfleur") return "rien à préparer";
  if (r.type === "chrono") {
    const c = reglagesChrono(r);
    return `${c.tours} tour${c.tours > 1 ? "s" : ""} · cible ${c.cible} s (réglable avant chaque tour)`;
  }
  if (r.type === "simon") {
    const s = reglagesSimon(r);
    return `${s.tours} tour${s.tours > 1 ? "s" : ""} · ${s.reponse} s pour taper une suite · environ ${s.joueurs} joueur${s.joueurs > 1 ? "s" : ""} par équipe`;
  }
  if (r.type === "duel") {
    const d = reglagesDuel(r);
    return `environ ${d.joueurs} joueur${d.joueurs > 1 ? "s" : ""} par équipe · face-à-face de ${d.dureeMin} à ${d.dureeMax} s${d.longs && d.dureeMax < 60 ? ", parfois jusqu'à 60 s" : ""}`;
  }
  if (roundSeriesQuiz(r).length) return resumeDesSeries(r, lib.quizzes ?? {});
  const tirees = roundTirees(r).length;
  const titles = roundQuizIds(r).map((id) => lib.quizzes?.[id]?.title).filter(Boolean);
  if (tirees) return [`${tirees} question${tirees > 1 ? "s" : ""} tirée${tirees > 1 ? "s" : ""} au hasard${PROFILES[r.profil] ? ` (${PROFILES[r.profil].label.split(" (")[0]})` : ""}`, ...titles].join(" + ");
  return titles.length ? titles.join(" + ") : "quiz à choisir";
}

/**
 * Jeux d'une prestation (cedric, 21/10 : on ajoute un jeu, puis ses manches) : les manches qui se suivent du même jeu
 * forment un bloc, { type, indices } (indices des manches dans la prestation, dans l'ordre).
 */
export function blocsDeJeu(rounds) {
  const blocs = [];
  (rounds ?? []).forEach((r, i) => {
    const type = r?.type ?? "quiz";
    const last = blocs[blocs.length - 1];
    if (last && last.type === type) last.indices.push(i);
    else blocs.push({ type, indices: [i] });
  });
  return blocs;
}

/** Nom proposé pour une nouvelle manche : « Mimes du 20 octobre ». */
export function defaultMancheTitle(type, date = new Date()) {
  return `${ROUND_TYPES[type] ?? "Jeu"} du ${date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;
}

/** Cartes à prévoir pour une manche de mimes dans une prestation : par équipe × équipes prévues. */
export const mimeCardsNeeded = (round, teams) => (mimePerTeam(round) ? mimePerTeam(round) * teamCount(teams) : 0);


/**
 * « Jamais deux fois » pour les choix faits à la main : pour la manche [index] d'une prestation, ses éléments déjà
 * utilisés dans une autre manche, `[{ label, other }]` (other : le nom de l'autre jeu). Un choix à la main reste
 * permis : la Régie PC l'affiche en rouge « déjà utilisé dans … ».
 */
export function usedElsewhere(rounds, index, lib = {}) {
  const others = new Map();
  (rounds ?? []).forEach((r, j) => {
    if (j === index || !r) return;
    fixedConcepts(r, lib.quizzes, lib.mimes, lib.contents).forEach((k) => { if (!others.has(k)) others.set(k, ROUND_TYPES[r.type ?? "quiz"] ?? "un autre jeu"); });
  });
  return others;
}

/** Les éléments d'une liste ({ key, value }) déjà utilisés ailleurs ([others] : usedElsewhere) : clé → nom de l'autre jeu. */
export function conflictsOf(type, items, others) {
  const out = new Map();
  if (!others?.size) return out;
  items.forEach((x) => {
    const hit = itemConcepts(type, x.value).find((k) => others.has(k));
    if (hit) out.set(x.key, others.get(hit));
  });
  return out;
}
