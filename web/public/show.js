// Prestation : ce que Sarah prépare dans l'administration (prénom, âge, profil, manches dans l'ordre)
// et que la régie charge sur la TV. Fonctions pures, sans Firebase.
import { PROFILES, profileForAge, defaultDuration, expressDuration } from "./profiles.js";
import { shuffle } from "./mime-cards.js";
import { CHANTE_WORDS, QUI_SUIS_JE, DISPARU_THEMES } from "./buzz-cards.js";

export const ROUND_TYPES = { quiz: "Quiz", finale: "Super Finale", express: "Vrai ou Faux express", zoom: "Zoom mystère", flou: "Image floue", chante: "Chante le mot !", quisuis: "Qui suis-je ?", disparu: "Qui a disparu ?", blind: "Blind test", musical: "Quiz musical", statues: "Statues musicales", mimes: "Mimes" };
/** Statues musicales : durées proposées (secondes) et durée par défaut. Musique maison de la TV, rien à préparer. */
export const STATUES_SECONDS = [60, 90, 120];
export const STATUES_SEC = 90;
/** Jeux musicaux : leurs extraits viennent d'une playlist de la bibliothèque (library/playlists). */
export const MUSIC_GAMES = {
  blind: { rule: "le premier qui buzze donne le titre, bonus pour l'artiste" },
  musical: { rule: "4 titres proposés sur les pupitres, toutes les équipes répondent" },
};
/** Durée d'un extrait de blind test par défaut (secondes). */
export const BLIND_SEC = 25;
/** Image floue : temps pour que la photo devienne nette (secondes), le même pour tous les âges. */
export const FLOU_SEC = 40;
/** Durée d'un tour de mimes par défaut (secondes). */
export const MIME_TURN = 60;
export const MAX_QUESTIONS = 200;

export function showTitle(show) {
  return show.title?.trim() || (show.childName?.trim() ? `L'anniversaire de ${show.childName.trim()}` : "Prestation");
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

/** Questions jouables au Zoom mystère : les questions à propositions validées qui ont une photo. */
export const zoomQuestions = (quiz) => playable(quiz).filter((q) => q.kind !== "number" && /^[0-9a-f]{16}$/.test(q.imageId ?? ""));

/** Mini-jeux construits à partir d'un quiz : les questions retenues et ce qui manque quand il n'y en a pas. */
export const QUIZ_GAMES = {
  express: { questions: expressQuestions, unit: "affirmation", missing: "aucune question Vrai / Faux validée pour le Vrai ou Faux express" },
  zoom: { questions: zoomQuestions, unit: "photo", missing: "aucune question avec photo pour le Zoom mystère (ajoutez des photos dans le quiz)" },
  flou: { questions: zoomQuestions, unit: "photo", missing: "aucune question avec photo pour l'Image floue (ajoutez des photos dans le quiz)" },
};

/**
 * Jeux au buzzer à contenu intégré (inspirés de « Vendredi tout est permis ») : rien à préparer, la
 * manche tire [count] éléments au hasard dans le catalogue, adaptés à l'âge (level 2 : pas pour les Petits).
 */
export const BUILTIN_GAMES = {
  chante: {
    unit: "mot", count: 6, duration: 30, rule: "le premier qui buzze chante une chanson avec ce mot",
    items: (profile) => CHANTE_WORDS.filter((w) => profile !== "PETITS" || w.level === 1),
    question: (w) => ({ text: w.word, choices: [w.word], correct: 0, kind: "chante" }),
  },
  quisuis: {
    unit: "personnage", count: 5, duration: 40, rule: "un indice de plus toutes les 10 secondes",
    items: (profile) => QUI_SUIS_JE.filter((p) => profile !== "PETITS" || p.level === 1),
    question: (p) => ({ text: "Qui suis-je ?", choices: [p.answer], correct: 0, kind: "quisuis", cards: p.clues.map((word) => ({ word })), image: p.emoji }),
  },
  disparu: {
    unit: "grille", count: 4, duration: 45, rule: "on mémorise les objets, puis l'un d'eux disparaît",
    items: (profile, random) => DISPARU_THEMES.map((t) => disparuGrid(t, DISPARU_OBJECTS[profile] ?? 7, random)),
    question: (g) => ({ text: "Qui a disparu ?", choices: [g.missing.word], correct: 0, kind: "disparu", cards: g.objects, image: g.missing.image, duration: g.duration }),
  },
};

/** Qui a disparu ? : objets par grille selon l'âge, et temps de recherche après la mémorisation. */
const DISPARU_OBJECTS = { PETITS: 5, MOYENS: 7, GRANDS: 9, ADULTES: 9 };
const DISPARU_SEARCH_SEC = 25;

/**
 * Une grille de Qui a disparu ? : [n] objets de la famille et celui qui disparaîtra. La durée suit le
 * moteur de la TV : 2 s de mémorisation par objet (10 à 18 s), 3 s de tour de magie, puis la recherche.
 */
function disparuGrid(theme, n, random) {
  const objects = shuffle(theme.objects, random).slice(0, n);
  const missing = objects[Math.floor(random() * objects.length)];
  const memo = Math.min(18, Math.max(10, objects.length * 2));
  return { objects, missing, duration: memo + 3 + DISPARU_SEARCH_SEC };
}

/** Une manche est-elle complète (quiz choisi, ou paquet de mimes choisi) ? Les jeux intégrés le sont toujours. */
export const roundFilled = (round) => !!(round && (BUILTIN_GAMES[round.type] || round.type === "statues" ? true : round.type === "mimes" ? round.deckId : MUSIC_GAMES[round.type] ? round.playlistId : round.quizId));

/** Morceaux jouables d'une playlist : un titre et un extrait enregistré. */
export const playableTracks = (playlist) => (playlist?.tracks ?? []).filter((t) => t?.title?.trim() && /^[0-9a-f]{16}$/.test(t.audioId ?? ""));

/**
 * Questions d'un jeu musical. Blind test : un buzz par morceau, réponse à voix haute (le titre, bonus pour
 * l'artiste). Quiz musical : le bon titre parmi trois autres titres de la même playlist, sur les pupitres.
 */
function musicQuestions(type, playlist, prefix, random) {
  const tracks = shuffle(playableTracks(playlist), random);
  const titles = [...new Set(tracks.map((t) => t.title.trim()))];
  // Le type dans le titre : blind test et quiz musical d'une même playlist restent deux manches distinctes.
  const label = playlist.title?.trim() ? `${ROUND_TYPES[type]} · ${playlist.title.trim()}` : ROUND_TYPES[type];
  return tracks.map((t, j) => {
    const title = t.title.trim();
    const base = { id: `${prefix}${j + 1}`, double: false, round: label, audioId: t.audioId, duration: playlist.duration ?? BLIND_SEC };
    if (type === "blind") {
      return { ...base, text: "Quel est ce titre ?", choices: [title], correct: 0, kind: "blind", ...(t.artist?.trim() ? { artist: t.artist.trim() } : {}) };
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
function mimeItem(round, deck, i, random) {
  const cards = (deck.cards ?? []).filter((c) => c?.word?.trim()).map((c) => (c.image ? { word: c.word.trim(), image: c.image } : { word: c.word.trim() }));
  return {
    id: `r${i + 1}m`,
    text: deck.title,
    kind: "mime",
    duration: round.duration ?? deck.duration ?? MIME_TURN,
    cards: shuffle(cards, random),
    round: deck.title,
  };
}

/**
 * Instantané que la box joue : un seul quiz, manches mises bout à bout, chrono du profil pour
 * les questions sans durée imposée, points doublés pour la Super Finale ; une manche de mimes y est
 * un seul élément qui porte son paquet de cartes.
 * Renvoie `{ snapshot, problems }` ; `snapshot` est nul si rien n'est jouable.
 */
export function buildSnapshot(showId, show, quizzes, mimes = {}, random = Math.random, playlists = {}) {
  const profile = PROFILES[show.profile] ? show.profile : profileForAge(show.age);
  const problems = [];
  const rounds = [];
  const questions = [];
  (show.rounds ?? []).filter(Boolean).forEach((round, i) => {
    if (round.type === "mimes") {
      const deck = mimes[round.deckId];
      if (!deck) { problems.push(`Manche ${i + 1} : le paquet de mimes n'existe plus dans la bibliothèque.`); return; }
      const item = mimeItem(round, deck, i, random);
      if (!item.cards.length) { problems.push(`Manche ${i + 1} (${deck.title}) : aucune carte.`); return; }
      rounds.push({ title: deck.title, count: 1, kind: "mime" });
      questions.push(item);
      return;
    }
    if (round.type === "statues") {
      // Un seul élément : la musique joue et s'arrête par moments, l'animatrice désigne l'équipe gagnante.
      const duration = STATUES_SECONDS.includes(round.duration) ? round.duration : STATUES_SEC;
      rounds.push({ title: ROUND_TYPES.statues, count: 1 });
      questions.push({ id: `r${i + 1}s`, text: ROUND_TYPES.statues, kind: "statues", duration, double: false, round: ROUND_TYPES.statues });
      return;
    }
    if (MUSIC_GAMES[round.type]) {
      const playlist = playlists[round.playlistId];
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
      const picked = shuffle(builtin.items(profile, random), random).slice(0, count);
      rounds.push({ title: ROUND_TYPES[round.type], count: picked.length });
      picked.forEach((item, j) => questions.push({
        id: `r${i + 1}q${j + 1}`, duration: builtin.duration, double: false, round: ROUND_TYPES[round.type], ...builtin.question(item),
      }));
      return;
    }
    const quiz = quizzes[round.quizId];
    const express = round.type === "express";
    const zoom = round.type === "zoom";
    const flou = round.type === "flou";
    const game = QUIZ_GAMES[round.type];
    const label = round.type === "finale" || game ? ROUND_TYPES[round.type] : quiz?.title ?? `Manche ${i + 1}`;
    if (!quiz) { problems.push(`Manche ${i + 1} : le quiz n'existe plus dans la bibliothèque.`); return; }
    const list = game ? game.questions(quiz) : playable(quiz);
    if (!list.length) {
      problems.push(`Manche ${i + 1} (${quiz.title}) : ${game?.missing ?? "aucune question validée"}.`);
      return;
    }
    rounds.push({ title: label, count: list.length });
    list.forEach((q, j) => {
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
        double: round.type === "finale" || q.double === true,
        round: label,
        // Illustration facultative montrée à la révélation (émoji, ou photo copiée dans la partie par la régie).
        ...(q.image ? { image: q.image } : {}),
        ...(q.imageId ? { imageId: q.imageId } : {}),
      });
    });
  });
  if (questions.length > MAX_QUESTIONS) {
    problems.push(`${questions.length} questions : seules les ${MAX_QUESTIONS} premières seront jouées.`);
    questions.length = MAX_QUESTIONS;
  }
  if (!questions.length) {
    problems.push("Aucune question jouable : ajoutez une manche avec des questions validées.");
    return { snapshot: null, problems };
  }
  const title = showTitle(show);
  return {
    snapshot: {
      showId, title, childName: show.childName?.trim() ?? "", age: show.age ?? null, profile, rounds,
      quiz: { id: showId, title, questions },
    },
    problems,
  };
}

/** Durée approximative d'une prestation, pour l'aider à composer : chrono + révélation et scores. */
export function estimateMinutes(snapshot) {
  if (!snapshot) return 0;
  // Mimes : deux tours d'équipe environ, plus les changements d'équipe.
  const sec = snapshot.quiz.questions.reduce((t, q) => t + (q.kind === "mime" ? 2 * q.duration + 60 : q.kind === "express" ? q.duration + 5 : q.duration + 30), 0);
  return Math.round(sec / 60);
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
 * État de préparation d'une prestation, pour le tableau de bord : « prete » quand elle est
 * complète et visible sur la régie, sinon la liste de ce qui reste à faire.
 */
export function readiness(show, quizzes, mimes = {}, playlists = {}) {
  if (show.status === "archivee") return { level: "archivee", todo: [] };
  const todo = [];
  if (!show.date) todo.push("Ajouter la date");
  if (!show.age) todo.push("Indiquer l'âge");
  if (!(show.rounds ?? []).filter(roundFilled).length) todo.push("Ajouter une manche");
  else {
    const { snapshot, problems } = buildSnapshot("x", show, quizzes, mimes, Math.random, playlists);
    todo.push(...problems.filter((p) => snapshot || !p.startsWith("Aucune question jouable")));
    if (!snapshot && !problems.some((p) => p.startsWith("Manche"))) todo.push("Valider des questions");
  }
  if (!todo.length && show.status !== "publiee") todo.push("Passer le statut à « Prête »");
  return { level: todo.length ? "a-completer" : "prete", todo };
}

/** Anniversaires à venir (aujourd'hui compris), du plus proche au plus lointain, archives exclues. */
export function upcoming(shows, today = isoDay()) {
  return Object.entries(shows)
    .filter(([, s]) => s && s.status !== "archivee" && s.date && s.date >= today)
    .sort(([, a], [, b]) => a.date.localeCompare(b.date));
}

/**
 * Copie d'une prestation pour un nouvel anniversaire : mêmes manches (les quiz de la bibliothèque
 * sont repris tels quels, sans être modifiés), prénom, date et âge à saisir, en brouillon.
 */
export function duplicateShow(show) {
  const { childName, age, date, title, status, createdAt, updatedAt, origin, ...rest } = show;
  return { ...rest, status: "brouillon", rounds: (show.rounds ?? []).filter(Boolean).map((r) => ({ ...r })) };
}

// ---------- Programme modifié pendant la partie (régie) ----------
// Mêmes règles que la box (engine Program.kt) : la question en cours et la fin de sa manche ne bougent pas.

/** Manches du programme : suites de questions de même titre, avec leurs bornes. */
export function programRounds(questions) {
  const list = [];
  questions.forEach((q, i) => {
    const last = list[list.length - 1];
    if (last && q.round && last.title === q.round) last.end = i;
    else list.push({ title: q.round || "Questions", start: i, end: i });
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
export function gameQuestions(source, quizzes, profile, prefix, mimes = {}, playlists = {}) {
  const { snapshot, problems } = buildSnapshot("ajout", { profile, rounds: [source] }, quizzes, mimes, Math.random, playlists);
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
  return [...new Set((questions ?? []).map((q) => q?.audioId).filter((id) => typeof id === "string" && /^[0-9a-f]{16}$/.test(id)))];
}

/** Photos d'illustration d'un programme (identifiants sans doublon), à copier dans la partie avant de l'envoyer. */
export function imageIds(questions) {
  return [...new Set((questions ?? []).map((q) => q?.imageId).filter((id) => typeof id === "string" && /^[0-9a-f]{16}$/.test(id)))];
}
