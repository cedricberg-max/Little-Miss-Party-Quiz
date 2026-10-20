// Règles Firebase utilisées par les tests, et un administrateur prêt à l'emploi : l'administration
// s'ouvre avec un mot de passe commun, vérifié par les règles (empreinte dans adminProof/$uid).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ref, set } from "firebase/database";

export const ADMIN_PASSWORD = "Admin-Lmp-2026";
export const ADMIN_SALT = "sel-admin-0123456789";
export const adminHash = (password = ADMIN_PASSWORD, salt = ADMIN_SALT) =>
  createHash("sha256").update(`${salt}:${password}`).digest("hex");

export function loadRules() {
  return readFileSync(new URL("../database.rules.json", import.meta.url), "utf8");
}

/** Enregistre le mot de passe administrateur et, pour chaque uid donné, la preuve qu'il l'a saisi. */
export async function seedAdmin(env, ...uids) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.database();
    await set(ref(d, "settings/admin"), { salt: ADMIN_SALT, hash: adminHash(), updatedAt: 1 });
    for (const uid of uids) await set(ref(d, `adminProof/${uid}`), { hash: adminHash(), gateAt: 1, at: 1 });
  });
}

/** Box acceptées dans la Régie PC : seules elles peuvent créer une partie. */
export async function allowBox(env, ...uids) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.database();
    await set(ref(d, "boxes/lockOn"), true);
    for (const uid of uids) await set(ref(d, `boxes/allowed/${uid}`), { name: `Box ${uid}`, at: 1 });
  });
}
