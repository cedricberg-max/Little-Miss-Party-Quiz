// Cedric, 1/11 au soir : une 0.1.971 identique à la 0.1.969 (seul le site avait changé) a été proposée à la box en
// pleine soirée de test. Une publication qui ne touche que le site ne fabrique plus de nouvelle version TV : la box
// garde la version déjà publiée, même numéro, même fichier.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CI = readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");

test("la CI compare l'appli TV à la dernière version publiée", () => {
  assert.match(CI, /fetch-depth: 0/);
  assert.match(CI, /git diff --quiet "\$derniere" HEAD -- tv engine firebase-config\.json/);
  assert.match(CI, /tv-change: \$\{\{ steps\.tv\.outputs\.change \}\}/);
});

test("site seul : pas de nouvelle release TV, la box garde la version déjà publiée", () => {
  assert.match(CI, /github\.event_name != 'pull_request' && steps\.tv\.outputs\.change != 'false'/);
  assert.match(CI, /gh release download "\$\{\{ needs\.apk\.outputs\.tv-derniere \}\}" -p little-miss-party-quiz-tv\.apk -D apk/);
  assert.match(CI, /then vc="\$\{derniere#tv-v0\.1\.\}"; fi/);
});
