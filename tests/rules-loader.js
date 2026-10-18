// Règles Firebase utilisées par les tests : on ajoute une adresse administrateur fictive à la liste
// des vraies (Sarah et cedric), pour vérifier ce qu'un administrateur peut faire sans leurs comptes.
import { readFileSync } from "node:fs";

export const ADMIN_EMAIL = "admin@lmp.test";

export function loadRules() {
  const rules = readFileSync(new URL("../database.rules.json", import.meta.url), "utf8");
  const marker = "auth.token.email.matches(/^(";
  if (!rules.includes(marker)) throw new Error("Liste des administrateurs introuvable dans database.rules.json");
  return rules.replaceAll(marker, `${marker}admin@lmp[.]test|`);
}
