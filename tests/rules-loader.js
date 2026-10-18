// Règles Firebase utilisées par les tests. La liste des adresses administrateur est vide dans le
// fichier déployé (aucun administrateur tant qu'elles ne sont pas fournies) : les tests y mettent
// une adresse fictive pour vérifier ce qu'un administrateur peut faire.
import { readFileSync } from "node:fs";

export const ADMIN_EMAIL = "admin@lmp.test";

export function loadRules() {
  const rules = readFileSync(new URL("../database.rules.json", import.meta.url), "utf8");
  const marker = "auth.token.email.matches(/^$/)";
  if (!rules.includes(marker)) return rules;
  return rules.replaceAll(marker, "auth.token.email.matches(/^admin@lmp[.]test$/)");
}
