// Profils d'âge (skill lmp-game-design-enfants, section 2) : la seule table des valeurs qui dépendent
// de l'âge. L'administration, l'import et la composition d'une prestation la lisent ici.

export const PROFILES = {
  PETITS: { label: "Petits (6 à 8 ans)", minAge: 6, maxAge: 8, chronoSec: 25, maxWords: 15, maxChoiceWords: 3 },
  MOYENS: { label: "Moyens (9 à 11 ans)", minAge: 9, maxAge: 11, chronoSec: 15, maxWords: 20, maxChoiceWords: null },
  GRANDS: { label: "Grands (12 à 15 ans)", minAge: 12, maxAge: 15, chronoSec: 12, maxWords: 25, maxChoiceWords: null },
  ADULTES: { label: "Adultes (16 ans et plus)", minAge: 16, maxAge: 99, chronoSec: 10, maxWords: 30, maxChoiceWords: null },
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

/** Chrono d'une question sans durée imposée : celui du profil, plus le temps de lecture. */
export function defaultDuration(profile) {
  const p = PROFILES[profile] ?? PROFILES.MOYENS;
  return Math.min(MAX_DURATION_SEC, p.chronoSec + READING_SEC);
}
