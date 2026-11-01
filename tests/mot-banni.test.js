// Le mot « manche » est banni de tout ce qui s'affiche (règle permanente de cedric ; point 45 du 31/10 : il restait dans
// la Régie PC, sur le téléphone de Sarah et dans les alertes « Manche 18 : … »). Seules les clés internes le gardent
// (« manches », « manche/… », « data-manche », ids « manche-… »), jamais montrées à l'écran.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const DOSSIER = new URL("../web/public/", import.meta.url);
const MOT = /(?<![\w/-])manches?(?![\w/-])/i;
// Une clé interne : un seul mot, sans espace ni majuscule.
const cle = (texte) => /^[a-z/_-]*manches?[a-z/_-]*$/.test(texte.trim());
// Les questions des banques parlent d'autre chose (le manche d'une poêle, la Manche sous l'Eurostar).
const fichiers = readdirSync(DOSSIER).filter((f) => /\.(js|html)$/.test(f) && !f.startsWith("banque-"));

/** Les textes d'une ligne de code : chaînes entre guillemets, apostrophes ou accents graves. */
function chaines(ligne) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(ligne))) out.push(m[3] !== undefined ? sansCode(m[3]) : m[1] ?? m[2]);
  return out;
}

/** Le texte d'un gabarit `…${…}…` sans ses morceaux de code. */
function sansCode(gabarit) {
  let out = "", prof = 0;
  for (let i = 0; i < gabarit.length; i++) {
    if (prof === 0 && gabarit[i] === "$" && gabarit[i + 1] === "{") { prof = 1; i++; continue; }
    if (prof > 0) { if (gabarit[i] === "{") prof++; else if (gabarit[i] === "}") prof--; continue; }
    out += gabarit[i];
  }
  return out;
}

test("aucun texte de la Régie PC, du téléphone ni des tablettes ne montre le mot « manche »", () => {
  const fautes = [];
  for (const f of fichiers) {
    readFileSync(new URL(f, DOSSIER), "utf8").split("\n").forEach((ligne, i) => {
      const code = ligne.trim();
      if (/^(\/\/|\*|\/\*)/.test(code)) return;
      if (f.endsWith(".html")) {
        // Texte visible et attributs lus par l'écran (placeholder, aria-label, title) ; commentaires et ids exclus.
        const visible = code.replace(/<!--.*?-->/g, "").replace(/\s(id|class|for|data-[\w-]+)="[^"]*"/g, "");
        if (MOT.test(visible.replace(/<[^>]*>/g, " ")) || /(placeholder|aria-label|title)="[^"]*\bmanches?\b/i.test(visible)) fautes.push(`${f}:${i + 1}`);
        return;
      }
      const sansCommentaire = code.replace(/\s\/\/\s.*$/, "");
      for (const t of chaines(sansCommentaire)) if (MOT.test(t) && !cle(t)) fautes.push(`${f}:${i + 1} « ${t.slice(0, 80)} »`);
    });
  }
  assert.deepEqual(fautes, []);
});
