// Collections, manches et prestation : la même logique pour tous les jeux.
// - Collection : le contenu brut d'un jeu, rangé par catégories (cartes, mots, personnages, photos, extraits…).
// - Manche : ce qu'on joue, une sélection piochée dans les collections (à la main ou au hasard) et ses réglages,
//   enregistrée dans `library/manches`, épinglable, archivable.
// - Prestation : l'enchaînement des manches d'un anniversaire ; chaque manche y est copiée.
// Fonctions pures, sans Firebase.
import {
  ROUND_TYPES, BUILTIN_GAMES, CONTENT_GAMES, MUSIC_GAMES, activeItems, pictoSeriesOf, playableTracks, isStatuesList,
  statuesSongs, statuesChoices, zoomQuestions, expressQuestions, playable, mimeCards, roundPicks, roundTracks, roundQuizIds, roundSongs,
  pictoRoundSeries, mimePerTeam, teamCount, MIME_TURN, MIME_RANDOM, STATUES_SEC, PICTO_SEC,
  MAX_PICKS, MAX_STATUES_SONGS, quizKind, builtinConcepts, fixedConcepts, isPhotoTheme,
} from "./show.js";
import { MIME_CATALOG, shuffle } from "./mime-cards.js";
import { concepts, questionConcepts, neufsSiPossible } from "./jamais-deux-fois.js";
import { BANQUE, banqueItems, motDeLaBanque } from "./banque-photos.js";

/** Jeux qu'on peut enregistrer en manches, dans l'ordre de la page Jeux. */
export const MANCHE_TYPES = ["quiz", "mimes", "blind", "musical", "statues", "express", "zoom", "flou", "chante", "quisuis", "disparu", "pictionary", "coffres", "patate", "gonfleur"];

/** Ce que contient la collection d'un jeu (null : jeu sans contenu à choisir). */
export const COLLECTION_UNIT = {
  mimes: ["carte", "cartes"], pictionary: ["mot", "mots"], chante: ["mot", "mots"], quisuis: ["personnage", "personnages"],
  disparu: ["famille", "familles"], zoom: ["photo", "photos"], flou: ["photo", "photos"], blind: ["titre", "titres"],
  musical: ["titre", "titres"], statues: ["chanson", "chansons"], quiz: ["quiz", "quiz"], express: ["quiz", "quiz"],
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
 * l'emporte). [lib] : `{ mimes, contents, quizzes, playlists }` lus dans la bibliothèque.
 */
export function collectionItems(type, lib = {}) {
  const out = [];
  const seen = new Set();
  const add = (x) => { if (x.key && !seen.has(x.key)) { seen.add(x.key); out.push(x); } };
  if (type === "mimes") {
    MIME_CATALOG.forEach((c) => add({ key: c.word.toLowerCase(), label: `${c.image ?? ""} ${c.word}`.trim(), group: c.theme, level: c.level ?? 1, value: mimeCards([c])[0] }));
    // Les cartes de Sarah (anciens « paquets ») : une catégorie par paquet.
    Object.values(lib.mimes ?? {}).filter((d) => d?.title).sort((a, b) => a.title.localeCompare(b.title, "fr"))
      .forEach((d) => mimeCards(d.cards).forEach((c) => add({ key: c.word.toLowerCase(), label: `${c.image ?? ""} ${c.word}`.trim(), group: d.title, level: 1, value: c })));
  } else if (CONTENT_GAMES[type]) {
    const game = CONTENT_GAMES[type];
    activeItems(type, lib.contents?.[type]).forEach((x) => add({
      key: game.key(x), label: game.label(x), level: x.level ?? 1, value: x,
      group: type === "pictionary" ? pictoSeriesOf(x) : type === "disparu" ? (isPhotoTheme(x) ? "Photos de la banque" : "Émojis") : null,
    }));
  } else if (type === "zoom" || type === "flou") {
    Object.values(lib.quizzes ?? {}).filter((q) => q?.title).sort((a, b) => a.title.localeCompare(b.title, "fr"))
      .forEach((qz) => zoomQuestions(qz).forEach((q) => add({ key: q.imageId, label: q.choices?.[q.correct] ?? q.text, group: qz.title, level: 1, value: q })));
    // Puis les photos de la banque, par famille (réponses en images pour ceux qui ne lisent pas encore).
    banqueItems().forEach(add);
  } else if (MUSIC_GAMES[type]) {
    Object.values(lib.playlists ?? {}).filter((p) => p?.title && !isStatuesList(p)).sort((a, b) => a.title.localeCompare(b.title, "fr"))
      .forEach((p) => playableTracks(p).forEach((t) => add({ key: t.audioId, label: t.artist?.trim() ? `${t.title.trim()} (${t.artist.trim()})` : t.title.trim(), group: p.title, level: 1, value: t })));
  } else if (type === "statues") {
    statuesChoices(lib.playlists).forEach((t) => add({ key: t.audioId, label: t.artist?.trim() ? `${t.title.trim()} (${t.artist.trim()})` : t.title.trim(), group: t.list, level: 1, value: t }));
  } else if (type === "quiz" || type === "express") {
    Object.entries(lib.quizzes ?? {}).filter(([, q]) => q?.title && (type === "express" ? expressQuestions(q) : playable(q)).length)
      .sort((a, b) => a[1].title.localeCompare(b[1].title, "fr"))
      .forEach(([id, q]) => add({ key: id, label: q.title, group: { photo: "Quiz photo", classique: "Quiz classique", images: "Photos à deviner" }[quizKind(q)], level: 1, value: q }));
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
  const items = filterItems(collectionItems(type, lib), opts).filter((x) => type !== "disparu" || settings.photos || !isPhotoTheme(x.value));
  if (!RANDOM_TYPES.includes(type)) return { round: { type, ...settings }, exhausted: false, count: 0 };
  const perTeam = type === "mimes" ? mimePerTeam({ perTeam: opts.perTeam ?? base.perTeam }) : 0;
  const count = Math.max(1, Math.min(MAX_PICKS, opts.count
    ?? (perTeam ? perTeam * teamCount(opts.teams) : null)
    ?? baseCount(type, base)
    ?? RANDOM_COUNT[type] ?? BUILTIN_GAMES[type]?.count ?? 6));
  const { items: picked, exhausted } = drawItems(items, count, { ...opts, type }, random);
  if (!picked.length) return { round: null, exhausted: true, count: 0 };
  const keys = picked.map((x) => x.key);
  const round = type === "mimes" ? { type, ...settings, cards: picked.map((x) => x.value), ...(perTeam ? { perTeam } : {}) }
    : MUSIC_GAMES[type] ? { type, ...settings, tracks: keys }
    : { type, ...settings, picks: keys, ...(BUILTIN_GAMES[type] ? { count: keys.length } : {}) };
  return { round, exhausted, count: keys.length };
}

/** Nombre d'éléments d'une manche existante (pour la rejouer avec autant d'éléments). */
function baseCount(type, base) {
  if (type === "mimes") return mimeCards(base.cards).length || null;
  if (MUSIC_GAMES[type]) return roundTracks(base).length || null;
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

/**
 * Manche propre, telle qu'enregistrée dans une prestation ou dans `library/manches` : seulement les champs du jeu,
 * dans leurs limites. [playlists] sert aux chansons des statues. Le lien `mancheId` vers la manche d'origine est gardé.
 */
export function cleanRound(r, playlists = {}) {
  const type = r?.type ?? "quiz";
  const picks = roundPicks(r).length ? { picks: roundPicks(r) } : {};
  const link = typeof r?.mancheId === "string" && r.mancheId ? { mancheId: r.mancheId.slice(0, 40) } : {};
  const title = typeof r?.title === "string" && r.title.trim() ? { title: r.title.trim().slice(0, 60) } : {};
  let out;
  const photos = (type === "mimes" || type === "disparu") && r.photos === true ? { photos: true } : {};
  if (BUILTIN_GAMES[type]) out = { type, count: r.count ?? BUILTIN_GAMES[type].count, ...(type === "disparu" && r.objects ? { objects: r.objects } : {}), ...photos, ...picks };
  // Mimes : un paquet, ou le catalogue au hasard ; cartes choisies (tirage modifié à la main) gardées dans la manche.
  else if (type === "mimes") {
    const cards = mimeCards(r.cards).slice(0, 200);
    out = {
      type, ...(r.deckId ? { deckId: r.deckId } : cards.length ? {} : { random: true }), ...(cards.length ? { cards } : {}),
      ...(Number.isInteger(r.duration) && r.duration >= 15 && r.duration <= 180 ? { duration: r.duration } : {}),
      ...(mimePerTeam(r) ? { perTeam: mimePerTeam(r) } : {}), ...photos,
    };
  } else if (type === "statues") out = { type, duration: r.duration ?? STATUES_SEC, ...(roundSongs(r, playlists).length ? { songs: roundSongs(r, playlists).map((t) => t.audioId) } : {}) };
  else if (type === "pictionary") out = { type, duration: r.duration ?? PICTO_SEC, ...(pictoRoundSeries(r) ? { series: pictoRoundSeries(r) } : {}), ...picks };
  else if (type === "coffres" || type === "gonfleur" || type === "patate") out = { type };
  else if (MUSIC_GAMES[type]) out = roundTracks(r).length ? { type, tracks: roundTracks(r) } : { type, playlistId: r.playlistId };
  else if ((type === "zoom" || type === "flou") && roundPicks(r).length) out = { type, ...picks };
  else {
    const ids = roundQuizIds(r);
    out = { type, quizId: ids[0], ...(ids.length > 1 ? { quizIds: ids } : {}), ...(r.count > 0 ? { count: r.count } : {}), ...(type === "quiz" && r.finale > 0 ? { finale: r.finale } : {}) };
  }
  return { ...out, ...title, ...link };
}

/** Groupes de la page Manches d'un jeu : épinglées, les autres (plus récentes d'abord), archivées. */
export function mancheGroups(manches, type) {
  const list = Object.entries(manches ?? {}).filter(([, m]) => m?.round && (m.type ?? m.round.type) === type)
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
  if (r.type === "mimes") {
    const cards = mimeCards(r.cards).length;
    const deck = r.deckId ? lib.mimes?.[r.deckId] : null;
    return [cards ? n(cards) : deck ? `${deck.title} (${(deck.cards ?? []).length} cartes)` : "cartes au hasard",
      mimePerTeam(r) ? `${mimePerTeam(r)} par équipe` : "", `tour de ${r.duration ?? deck?.duration ?? MIME_TURN} s`, r.photos === true ? "📷 photos" : ""].filter(Boolean).join(" · ");
  }
  if (r.type === "disparu" && r.photos === true) return `${roundPicks(r).length ? n(roundPicks(r).length) : `${r.count ?? BUILTIN_GAMES.disparu.count} au hasard`} · 📷 photos`;
  if (MUSIC_GAMES[r.type]) return roundTracks(r).length ? n(roundTracks(r).length) : lib.playlists?.[r.playlistId]?.title ?? "playlist";
  if (r.type === "statues") return `${r.duration ?? STATUES_SEC} s · ${roundSongs(r, lib.playlists).length ? n(roundSongs(r, lib.playlists).length) : "musique de la fête"}`;
  if (r.type === "pictionary") return [roundPicks(r).length ? n(roundPicks(r).length) : "mots au hasard", `${r.duration ?? PICTO_SEC} s de dessin`].join(" · ");
  if (BUILTIN_GAMES[r.type]) return roundPicks(r).length ? n(roundPicks(r).length) : `${r.count ?? BUILTIN_GAMES[r.type].count} au hasard`;
  if ((r.type === "zoom" || r.type === "flou") && roundPicks(r).length) return n(roundPicks(r).length);
  if (r.type === "coffres" || r.type === "patate" || r.type === "gonfleur") return "rien à préparer";
  const titles = roundQuizIds(r).map((id) => lib.quizzes?.[id]?.title).filter(Boolean);
  return titles.length ? titles.join(" + ") : "quiz à choisir";
}

/** Nom proposé pour une nouvelle manche : « Mimes du 20 octobre ». */
export function defaultMancheTitle(type, date = new Date()) {
  return `${ROUND_TYPES[type] ?? "Manche"} du ${date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;
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
    fixedConcepts(r, lib.quizzes, lib.mimes, lib.contents).forEach((k) => { if (!others.has(k)) others.set(k, ROUND_TYPES[r.type ?? "quiz"] ?? "une autre manche"); });
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
