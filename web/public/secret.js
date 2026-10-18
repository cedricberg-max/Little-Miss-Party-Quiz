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
