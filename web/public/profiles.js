// Profils d'âge (skill lmp-game-design-enfants, section 2) : la seule table des valeurs qui dépendent
// de l'âge. L'administration, l'import et la composition d'une prestation la lisent ici.

export const PROFILES = {
  PETITS: { label: "Petits (6 à 8 ans)", minAge: 6, maxAge: 8, chronoSec: 25, expressSec: 20, maxWords: 15, maxChoiceWords: 3 },
  MOYENS: { label: "Moyens (9 à 11 ans)", minAge: 9, maxAge: 11, chronoSec: 15, expressSec: 20, maxWords: 20, maxChoiceWords: null },
  GRANDS: { label: "Grands (12 à 15 ans)", minAge: 12, maxAge: 15, chronoSec: 12, expressSec: 20, maxWords: 25, maxChoiceWords: null },
  ADULTES: { label: "Adultes (16 ans et plus)", minAge: 16, maxAge: 99, chronoSec: 10, expressSec: 20, maxWords: 30, maxChoiceWords: null },
  // Neutre (cedric, 23/10) : choisi à la main pour une prestation personnalisée à 100 % ; aucun tirage n'est limité
  // par l'âge (tous les niveaux), chrono du milieu. Jamais choisi d'office d'après l'âge.
  NEUTRE: { label: "Neutre (tous âges)", minAge: 0, maxAge: 99, chronoSec: 15, expressSec: 20, maxWords: null, maxChoiceWords: null },
};

/**
 * Temps de lecture ajouté au chrono du profil : la TV lance encore le chrono dès l'affichage de la
 * question. À retirer quand le départ du chrono après lecture par l'animatrice existera.
 */
export const READING_SEC = 10;

export const MIN_DURATION_SEC = 5;
export const MAX_DURATION_SEC = 120;

export function profileForAge(age) {
  const n = Number(age);
  if (!Number.isFinite(n) || n <= 8) return "PETITS";
  if (n <= 11) return "MOYENS";
  if (n <= 15) return "GRANDS";
  return "ADULTES";
}

/**
 * Chrono d'une affirmation du Vrai ou Faux express, sans temps de lecture ajouté : 20 s à tout âge (cedric, test du
 * 27/10 au soir : à 10 s, « on a à peine le temps de lire la question »).
 */
export function expressDuration(profile) {
  return (PROFILES[profile] ?? PROFILES.MOYENS).expressSec;
}

/** Chrono d'une question sans durée imposée : celui du profil, plus le temps de lecture. */
export function defaultDuration(profile) {
  const p = PROFILES[profile] ?? PROFILES.MOYENS;
  return Math.min(MAX_DURATION_SEC, p.chronoSec + READING_SEC);
}
