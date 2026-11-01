// Les noms de tests Kotlin entre accents graves ne peuvent pas contenir « : », « . », « ; », « / », « < », « > »,
// « [ », « ] » ni « \ » : la JVM les refuse et tout l'APK ne se compile plus (build du 1/11, « Name contains illegal
// characters: : » dans SimonEcranTest et HaloDecorTest). Ce test le voit avant la CI Android.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = fileURLToPath(new URL("../tv/src/", import.meta.url));
const INTERDITS = /[.;:\/<>\[\]\\]/;

function fichiersKt(dossier) {
  const out = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) out.push(...fichiersKt(chemin));
    else if (nom.endsWith(".kt")) out.push(chemin);
  }
  return out;
}

test("aucun nom de fonction Kotlin entre accents graves n'a de caractère refusé par la JVM", () => {
  const fautes = [];
  for (const f of fichiersKt(RACINE)) {
    readFileSync(f, "utf8").split("\n").forEach((ligne, i) => {
      const m = /\bfun\s+`([^`]+)`/.exec(ligne);
      if (m && INTERDITS.test(m[1])) fautes.push(`${f.slice(RACINE.length)}:${i + 1} « ${m[1]} »`);
    });
  }
  assert.deepEqual(fautes, []);
});
