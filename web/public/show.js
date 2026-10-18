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
