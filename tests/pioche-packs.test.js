// « 🎨 Mes thèmes » d'un Quiz (cedric, 25/10) : piocher dans les packs importés, avec trois dés.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { catalogueDesPacks, packsQuiRepondent, piocherDansLesPacks, versQuestionDePack, niveauDesPacks, sourceDuDe } from "../web/public/pioche-packs.js";

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

  test("chaque jeu pioche dans ses packs (cedric, 25/10) : Quiz illustré, Vrai ou Faux, séries de photos", () => {
    const IMG = (k) => `${k}`.repeat(16).slice(0, 16);
    const packs = {
      ...QUIZZES,
      photos: { title: "Zoom K-pop", niveau: "Facile", pack: true, kind: "images", source: "photos",
        questions: ["Rumi", "Mira"].map((nom, k) => ({ text: "Qui est-ce ?", choices: [nom, "Zoey", "Jinu", "Derpy"], correct: 0, imageId: IMG(k + 1), status: "validee" })) },
      illus: { title: "Illustré K-pop", niveau: "Facile", pack: true, kind: "photo",
        questions: [{ text: "Qui chante ?", choices: ["Rumi", "Mira", "Zoey", "Jinu"], correct: 2, choiceImages: { 0: IMG("a"), 1: IMG("b"), 2: IMG("c"), 3: IMG("d") }, imageId: IMG("e"), status: "validee" }] },
    };
    // Un pack illustré sans ses images (cedric, 26/10 : Marvel en texte seul sur la TV) : jamais tiré, ni une question
    // dont une réponse a perdu sa photo.
    const borgne = { text: "Qui vole ?", choices: ["Rumi", "Mira", "Zoey", "Jinu"], correct: 0, choiceImages: { 0: IMG("a"), 1: IMG("b"), 3: IMG("d") }, status: "validee" };
    packs.illus.questions.push(borgne);
    assert.deepEqual(catalogueDesPacks(packs, () => false, "illustre").map((x) => [x.titre, x.q.text]), [["Illustré K-pop", "Qui chante ?"]]);
    packs.illus.questions.pop();
    assert.deepEqual(catalogueDesPacks(packs, () => false, "express").map((x) => x.titre), ["VF"]);
    const zoom = catalogueDesPacks(packs, () => false, "zoom");
    assert.deepEqual(zoom.map((x) => x.cle), [`i:${IMG(1)}`, `i:${IMG(2)}`], "aux photos, une question = sa photo (le texte est le même partout)");
    const main = { title: "Monuments", kind: "images", source: "photos", questions: [{ text: "Qui est-ce ?", choices: ["Tour Eiffel", "Lune", "Chat", "Pont"], correct: 0, imageId: IMG(9), status: "validee" }] };
    assert.deepEqual(catalogueDesPacks({ ...packs, main }, () => false, "flou").map((x) => x.titre), ["Zoom K-pop", "Zoom K-pop", "Monuments"], "aux photos, mes séries faites à la main aussi");
    assert.equal(catalogueDesPacks({ main }, () => false, "quiz").length, 0);
    assert.deepEqual(piocherDansLesPacks(zoom, 5, { exclus: new Set([`i:${IMG(1)}`]) }).map((x) => x.q.choices[0]), ["Mira"]);
    assert.deepEqual(versQuestionDePack(zoom[0], hasard, "flou"), { id: `i:${IMG(1)}`, text: "Qui est-ce ?", choices: ["Rumi", "Zoey", "Jinu", "Derpy"], correct: 0, imageId: IMG(1) });
    const [vf] = catalogueDesPacks(packs, () => false, "express");
    assert.deepEqual(versQuestionDePack(vf, hasard, "express"), { id: `pk-${vf.id}`, text: "Vrai ?", choices: ["Vrai", "Faux"], correct: 0 }, "Vrai / Faux jamais mélangé");
    // Son image montrée à la fin (cedric, 25/10 : « l'image doit être montrée à la fin ») : photo, sinon émoji.
    const vfImage = { ...vf, q: { ...vf.q, imageId: IMG(7) } };
    assert.deepEqual(versQuestionDePack(vfImage, hasard, "express"), { id: `pk-${vf.id}`, text: "Vrai ?", choices: ["Vrai", "Faux"], correct: 0, imageId: IMG(7) });
    assert.equal(versQuestionDePack({ ...vf, q: { ...vf.q, image: "🍄" } }, hasard, "express").emoji, "🍄");
    assert.equal(versQuestionDePack({ ...vf, q: { ...vf.q, imageId: "pas-une-image" } }, hasard, "express").imageId, undefined);
    const illus = catalogueDesPacks(packs, () => false, "illustre").find((x) => x.quizId === "illus");
    for (let k = 0; k < 6; k++) {
      const x = versQuestionDePack(illus, hasard, "illustre");
      assert.equal(x.choices[x.correct], "Zoey");
      assert.deepEqual(x.choices.map((c, i) => [c, x.choiceImages[i]]).sort(), [["Jinu", IMG("d")], ["Mira", IMG("b")], ["Rumi", IMG("a")], ["Zoey", IMG("c")]], "chaque réponse garde son image");
      assert.equal(x.imageId, IMG("e"));
    }
  });
});

describe("Le champ du 🎲 unique du Quiz (cedric, 26/10)", () => {
  const LIBRES = { animaux: "Animaux", corps: "Corps humain", sport: "Sport" };
  test("vide : au hasard dans tout ; « libre » : les libres de droit ; « mes packs » : mes packs", () => {
    for (const t of ["", "  "]) assert.deepEqual(sourceDuDe(t, LIBRES), { sorte: "tout" });
    for (const t of ["libre", "Libres", "libres de droit", "Questions libres de droit", "question libre de droits"]) assert.equal(sourceDuDe(t, LIBRES).sorte, "libres", t);
    for (const t of ["mes packs", "Mes Packs", "packs", "pack"]) assert.equal(sourceDuDe(t, LIBRES).sorte, "packs", t);
  });
  test("un thème : dans mes packs, et le thème libre de droit du même nom s'il y en a un", () => {
    assert.deepEqual(sourceDuDe(" Mario ", LIBRES), { sorte: "theme", terme: "Mario", themeLibre: null });
    assert.deepEqual(sourceDuDe("kpop", LIBRES), { sorte: "theme", terme: "kpop", themeLibre: null });
    assert.equal(sourceDuDe("animaux", LIBRES).themeLibre, "animaux");
    assert.equal(sourceDuDe("Animaux", LIBRES).themeLibre, "animaux");
    assert.equal(sourceDuDe("corps", LIBRES).themeLibre, "corps", "le début du libellé suffit");
    assert.equal(sourceDuDe("co", LIBRES).themeLibre, null, "deux lettres : trop court");
    assert.equal(sourceDuDe("Libre-service", LIBRES).sorte, "theme");
  });
});

describe("Drapeau montré dès la question (cedric, 28/10)", () => {
  test("une question piochée garde l'option avec sa photo, jamais sans photo", () => {
    const avec = versQuestionDePack({ id: "d:0", q: { text: "Ce drapeau ?", choices: ["Japon", "Chine", "Italie", "Canada"], correct: 0, imageId: "0123456789abcdef", imageVisible: true } });
    assert.equal(avec.imageVisible, true);
    assert.equal(avec.choices[avec.correct], "Japon");
    const sans = versQuestionDePack({ id: "d:1", q: { text: "Ce drapeau ?", choices: ["Japon", "Chine"], correct: 0, image: "🇯🇵", imageVisible: true } });
    assert.equal(sans.imageVisible, undefined);
    const avant = versQuestionDePack({ id: "d:2", q: { text: "Capitale ?", choices: ["Paris", "Rome"], correct: 0, imageId: "0123456789abcdef" } });
    assert.equal(avant.imageVisible, undefined, "comme avant : la photo à la révélation");
  });
});
