import { ref, get, set, onValue, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { passwordHash } from "./secret.js";

// Mots de passe communs (administration et régie), vérifiés par le serveur (règles Firebase) :
// l'appareil n'envoie qu'une empreinte et ne peut jamais relire celle qui est enregistrée.
// Le serveur n'accepte qu'un essai toutes les 2 secondes, tous appareils confondus : on attend son tour.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Écrit l'empreinte du mot de passe saisi pour [kind] ("admin" ou "regie") dans `${kind}Proof/$uid`.
 * Le serveur décide ensuite seul si elle correspond. Résultat : "written", "unset" (aucun mot de
 * passe enregistré) ou "busy" (trop d'essais en même temps).
 */
export async function writeProof(ctx, kind, password) {
  const salt = (await get(ref(ctx.db, `settings/${kind}/salt`))).val();
  if (!salt) return "unset";
  const hash = await passwordHash(salt, password);
  // `.info` ne se lit qu'avec un écouteur, pas avec get().
  const offset = await new Promise((resolve) => {
    const stop = onValue(ref(ctx.db, ".info/serverTimeOffset"), (s) => { resolve(s.val() ?? 0); setTimeout(() => stop()); });
  });
  const gate = ref(ctx.db, "regieGate/try");
  for (let attempt = 0; attempt < 4; attempt++) {
    const last = (await get(gate)).val();
    const wait = last ? last.at + 2100 - (Date.now() + offset) : 0;
    if (wait > 0) await sleep(Math.min(wait, 2500));
    try {
      await set(gate, { uid: ctx.uid, at: serverTimestamp() });
    } catch {
      continue; // un autre appareil vient d'essayer
    }
    const gateAt = (await get(ref(ctx.db, "regieGate/try/at"))).val();
    await set(ref(ctx.db, `${kind}Proof/${ctx.uid}`), { hash, gateAt, at: serverTimestamp() });
    return "written";
  }
  return "busy";
}

/** Cet appareil a-t-il saisi le mot de passe administrateur en vigueur ? (reste vrai après un rechargement) */
export async function isAdmin(ctx) {
  try {
    await get(ref(ctx.db, `adminAccess/${ctx.uid}`));
    return true;
  } catch {
    return false;
  }
}
