// « 🎨 Mes thèmes » d'un Quiz (cedric, 25/10) : piocher dans les packs importés, avec trois dés.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { catalogueDesPacks, packsQuiRepondent, piocherDansLesPacks, versQuestionDePack, niveauDesPacks } from "../web/public/pioche-packs.js";

const q = (text, extra = {}) => ({ text, choices: ["A", "B", "C", "D"], correct: 1, status: "validee", ...extra });
const pack = (title, niveau, n, extra = {}) => ({ title, niveau, famille: "Divers", pack: true, kind: "classique",
  questions: Array.from({ length: n }, (_, k) => q(`${title} ${niveau} ${k + 1} ?`)), ...extra });
const QUIZZES = {
  kpopF: pack("K-pop Demon Hunters", "Facile", 6),
  kpopM: pack("K-pop Demon Hunters", "Moyen", 4),
  marioF: pack("Mario", "Facile", 6),
  pokeF: pack("Pokémon", "Facile", 6, { theme: "Jeux vidéo" }),
  // Pas des packs de Quiz : ni un quiz écrit, ni un Quiz illustré, ni un Vrai / Faux, ni une question à 3 réponses.
  ecrit: { ...pack("Écrit", "Facile", 3), pack: undefined },
  illustre: pack("Illustré", "Facile", 2, { kind: "photo" }),
  vf: { ...pack("VF", "Facile", 0), questions: [{ text: "Vrai ?", choices: ["Vrai", "Faux"], correct: 0, status: "validee" }] },
  trois: { ...pack("Trois", "Facile", 0), questions: [q("Trois réponses ?", { choices: ["A", "B", "C"] }), q("Pas validée ?", { status: "a_valider" })] },
  chiffre: { ...pack("Chiffres Mario", "Facile", 0), questions: [{ text: "Combien de frères Mario ?", kind: "number", correct: 2, status: "validee" }] },
};
const hasard = (() => { let x = 7; return () => (x = (x * 9301 + 49297) % 233280) / 233280; })();

describe("pioche dans mes packs", () => {
  const catalogue = catalogueDesPacks(QUIZZES);

  test("seuls les packs de Quiz comptent (4 réponses ou Juste Chiffre, validées)", () => {
    assert.deepEqual([...new Set(catalogue.map((x) => x.titre))].sort(), ["Chiffres Mario", "K-pop Demon Hunters", "Mario", "Pokémon"]);
    assert.equal(catalogue.length, 6 + 4 + 6 + 6 + 1);
    assert.equal(catalogueDesPacks(QUIZZES, (id) => id === "marioF").some((x) => x.quizId === "marioF"), false, "quiz exclus (prestations de test)");
  });

  test("dé 1 : au hasard dans tous les packs, au niveau de la prestation d'abord, jamais une question déjà prise", () => {
    const exclus = new Set(["Mario Facile 1 ?"]);
    const tirees = piocherDansLesPacks(catalogue, 8, { niveau: "Facile", exclus }, hasard);
    assert.equal(tirees.length, 8);
    assert.ok(tirees.every((x) => x.niveau === "Facile"));
    assert.ok(!tirees.some((x) => exclus.has(x.q.text)));
    assert.equal(new Set(tirees.map((x) => x.q.text)).size, 8);
    // Plus que le niveau n'en a : les autres niveaux complètent.
    const toutes = piocherDansLesPacks(catalogue, 30, { niveau: "Moyen" }, hasard);
    assert.equal(toutes.length, 23);
    assert.ok(toutes.slice(0, 4).every((x) => x.niveau === "Moyen"));
  });

  test("dé 2 : la moitié sur le thème principal, le reste dans les autres packs ; le thème complète s'il en manque", () => {
    const tirees = piocherDansLesPacks(catalogue, 8, { mode: "theme", terme: "kpop", niveau: null }, hasard);
    assert.equal(tirees.length, 8);
    assert.equal(tirees.filter((x) => x.titre === "K-pop Demon Hunters").length, 4);
    const seul = catalogueDesPacks({ a: QUIZZES.kpopF });
    assert.equal(piocherDansLesPacks(seul, 5, { mode: "theme", terme: "k-pop" }, hasard).length, 5, "une seule série : il pioche dedans");
  });

  test("dé 3 : seulement ce qui se rapporte au mot (titre, thème, question, réponses), même dans une seule série", () => {
    const kpop = piocherDansLesPacks(catalogue, 20, { mode: "recherche", terme: "demon" }, hasard);
    assert.equal(kpop.length, 10);
    assert.ok(kpop.every((x) => x.titre === "K-pop Demon Hunters"));
    assert.deepEqual(piocherDansLesPacks(catalogue, 9, { mode: "recherche", terme: "jeux video" }, hasard).map((x) => x.titre).sort()[0], "Pokémon", "le thème du pack compte, accents ignorés");
    assert.deepEqual(piocherDansLesPacks(catalogue, 9, { mode: "recherche", terme: "frères" }, hasard).map((x) => x.q.text), ["Combien de frères Mario ?"]);
    assert.deepEqual(piocherDansLesPacks(catalogue, 9, { mode: "recherche", terme: "zelda" }, hasard), []);
  });

  test("le champ propose les packs en direct, ceux qui commencent par le mot d'abord ; questions libres comptées", () => {
    assert.deepEqual(packsQuiRepondent(catalogue, "mar").map((p) => [p.titre, p.n]), [["Mario", 6], ["Chiffres Mario", 1]]);
    assert.deepEqual(packsQuiRepondent(catalogue, "k-pop", new Set(["K-pop Demon Hunters Facile 1 ?"])).map((p) => p.n), [9]);
    assert.deepEqual(packsQuiRepondent(catalogue, " "), []);
  });

  test("une question piochée : réponses mélangées, bonne réponse suivie, image de révélation gardée ; Juste Chiffre", () => {
    const x = { id: "p:0", q: q("Qui ?", { choices: ["Rumi", "Mira", "Zoey", "Jinu"], correct: 2, imageId: "0123456789abcdef" }) };
    const v = versQuestionDePack(x, hasard);
    assert.equal(v.choices[v.correct], "Zoey");
    assert.deepEqual([...v.choices].sort(), ["Jinu", "Mira", "Rumi", "Zoey"]);
    assert.deepEqual([v.id, v.imageId], ["pk-p:0", "0123456789abcdef"]);
    assert.deepEqual(versQuestionDePack({ id: "c:0", q: QUIZZES.chiffre.questions[0] }), { id: "pk-c:0", text: "Combien de frères Mario ?", nombre: true, correct: 2 });
    assert.deepEqual([1, 2, 3, null].map(niveauDesPacks), ["Facile", "Moyen", "Difficile", null]);
  });
});
