// Prestation : ce que Sarah prépare dans l'administration (prénom, âge, profil, manches dans l'ordre)
// et que la régie charge sur la TV. Fonctions pures, sans Firebase.
import { PROFILES, profileForAge, defaultDuration } from "./profiles.js";
import { shuffle } from "./mime-cards.js";

export const ROUND_TYPES = { quiz: "Quiz", finale: "Super Finale", mimes: "Mimes" };
/** Durée d'un tour de mimes par défaut (secondes). */
export const MIME_TURN = 60;
export const MAX_QUESTIONS = 200;

export function showTitle(show) {
  return show.title?.trim() || (show.childName?.trim() ? `L'anniversaire de ${show.childName.trim()}` : "Prestation");
}

/** Questions jouables d'un quiz : celles que Sarah a validées et sans anomalie bloquante. */
export function playable(quiz) {
  return (quiz?.questions ?? []).filter((q) => q && q.status === "validee" && q.correct >= 0 && q.correct < (q.choices?.length ?? 0));
}

/** Une manche est-elle complète (quiz choisi, ou paquet de mimes choisi) ? */
export const roundFilled = (round) => !!(round && (round.type === "mimes" ? round.deckId : round.quizId));

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
export function buildSnapshot(showId, show, quizzes, mimes = {}, random = Math.random) {
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
    const quiz = quizzes[round.quizId];
    const label = round.type === "finale" ? ROUND_TYPES.finale : quiz?.title ?? `Manche ${i + 1}`;
    if (!quiz) { problems.push(`Manche ${i + 1} : le quiz n'existe plus dans la bibliothèque.`); return; }
    const list = playable(quiz);
    if (!list.length) { problems.push(`Manche ${i + 1} (${quiz.title}) : aucune question validée.`); return; }
    rounds.push({ title: label, count: list.length });
    list.forEach((q, j) => {
      const yesNo = q.choices.length === 2 && q.choices.map((c) => c.toLowerCase()).join("/") === "vrai/faux";
      questions.push({
        id: `r${i + 1}q${j + 1}`,
        text: q.text,
        choices: q.choices,
        correct: q.correct,
        duration: q.duration ?? defaultDuration(profile),
        kind: yesNo ? "true_false" : "classic",
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
  const sec = snapshot.quiz.questions.reduce((t, q) => t + (q.kind === "mime" ? 2 * q.duration + 60 : q.duration + 30), 0);
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
export function readiness(show, quizzes, mimes = {}) {
  if (show.status === "archivee") return { level: "archivee", todo: [] };
  const todo = [];
  if (!show.date) todo.push("Ajouter la date");
  if (!show.age) todo.push("Indiquer l'âge");
  if (!(show.rounds ?? []).filter(roundFilled).length) todo.push("Ajouter une manche");
  else {
    const { snapshot, problems } = buildSnapshot("x", show, quizzes, mimes);
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
export function gameQuestions(source, quizzes, profile, prefix, mimes = {}) {
  const { snapshot, problems } = buildSnapshot("ajout", { profile, rounds: [source] }, quizzes, mimes);
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

/** Photos d'illustration d'un programme (identifiants sans doublon), à copier dans la partie avant de l'envoyer. */
export function imageIds(questions) {
  return [...new Set((questions ?? []).map((q) => q?.imageId).filter((id) => typeof id === "string" && /^[0-9a-f]{16}$/.test(id)))];
}
