// Empreinte du mot de passe commun de la régie : SHA-256 de « sel:mot de passe », en hexadécimal.
// Le serveur garde l'empreinte hors de portée des téléphones et compare lui-même (règles Firebase).

export async function passwordHash(salt, password) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${password}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newSalt() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Les espaces ne comptent pas (claviers de téléphone qui en ajoutent après une suggestion) :
 * on enregistre le mot de passe sans espaces, et à la saisie on essaie d'abord sans espaces,
 * puis tel quel pour un mot de passe enregistré avant cette règle.
 */
export function cleanPassword(password) {
  return password.replace(/\s+/g, "");
}

export function passwordCandidates(password) {
  return [...new Set([cleanPassword(password), password])];
}
