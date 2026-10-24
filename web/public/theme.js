// Couleurs du pupitre au même endroit. La direction artistique définitive
// (fluo, couleurs des accessoires des équipes) remplacera ces valeurs.

/**
 * Couleurs proposées aux équipes, dans l'ordre. Les 4 premières sont celles des bracelets et des bandeaux
 * (rose, orange, vert, jaune, kit The Game Show) ; bleu, violet, rouge et turquoise servent au-delà de 4 équipes.
 * Mêmes valeurs sur la TV (tv/.../Couleurs.kt).
 */
export const TEAM_COLORS = ["#FF2D95", "#FF6B1A", "#39FF14", "#FFE600", "#2B86C5", "#9B5DE5", "#F94144", "#2EE8E0"];

/** Nom de chaque couleur d'équipe, dans le même ordre (bandeau « a buzzé » de la régie). */
export const TEAM_COLOR_NAMES = ["Rose", "Orange", "Vert", "Jaune", "Bleu", "Violet", "Rouge", "Turquoise"];

/** Nombre de couleurs de bracelets : la régie ne propose qu'elles tant qu'il en reste une de libre. */
export const BRACELET_COLORS = 4;

/** Couleurs des propositions A, B, C, D : distinctes des couleurs d'équipe, identiques à celles de la TV. */
export const CHOICE_COLORS = ["#E63946", "#3A86FF", "#FFBE0B", "#8338EC"];
export const CHOICE_LETTERS = ["A", "B", "C", "D"];

export const MAX_TEAMS = 8;

/**
 * Numéro d'une tablette qui attend d'entrer (100 à 999), tiré de son identifiant : le même sur la tablette et sur la
 * régie, pour que l'animatrice sache laquelle elle accepte.
 */
export function numeroTablette(uid) {
  let h = 0;
  for (const c of String(uid)) h = (h * 31 + c.charCodeAt(0)) % 900;
  return 100 + h;
}
