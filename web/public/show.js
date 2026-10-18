// Prestation : ce que Sarah prépare dans l'administration (prénom, âge, profil, manches dans l'ordre)
// et que la régie charge sur la TV. Fonctions pures, sans Firebase.
import { PROFILES, profileForAge, defaultDuration } from "./profiles.js";

export const ROUND_TYPES = { quiz: "Quiz", finale: "Super Finale" };
export const MAX_QUESTIONS = 200;

export function showTitle(show) {
  return show.title?.trim() || (show.childName?.trim() ? `L'anniversaire de ${show.childName.trim()}` : "Prestation");
}

/** Questions jouables d'un quiz : celles que Sarah a validées et sans anomalie bloquante. */
export function playable(quiz) {
  return (quiz?.questions ?? []).filter((q) => q && q.status === "validee" && q.correct >= 0 && q.correct < (q.choices?.length ?? 0));
}

/**
 * Instantané que la box joue : un seul quiz, manches mises bout à bout, chrono du profil pour
 * les questions sans durée imposée, points doublés pour la Super Finale.
 * Renvoie `{ snapshot, problems }` ; `snapshot` est nul si rien n'est jouable.
 */
export function buildSnapshot(showId, show, quizzes) {
  const profile = PROFILES[show.profile] ? show.profile : profileForAge(show.age);
  const problems = [];
  const rounds = [];
  const questions = [];
  (show.rounds ?? []).filter(Boolean).forEach((round, i) => {
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
  const sec = snapshot.quiz.questions.reduce((t, q) => t + q.duration + 30, 0);
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
export function readiness(show, quizzes) {
  if (show.status === "archivee") return { level: "archivee", todo: [] };
  const todo = [];
  if (!show.date) todo.push("Ajouter la date");
  if (!show.age) todo.push("Indiquer l'âge");
  if (!(show.rounds ?? []).filter((r) => r?.quizId).length) todo.push("Ajouter une manche");
  else {
    const { snapshot, problems } = buildSnapshot("x", show, quizzes);
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
