// Import des quiz : texte Gemini, tableur, CSV, JSON, et anomalies signalées à la relecture.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseQuiz, checkQuestions, geminiPrompt, resolveCorrect, chatgptImagePrompt, imageKey, wordFromImage } from "../web/public/importer.js";
import { MIME_CATALOG } from "../web/public/mime-cards.js";
import { DISPARU_THEMES } from "../web/public/buzz-cards.js";
import { disparuObjects, activeItems, buildSnapshot, estimateMinutes, roundFilled,
  readiness, upcoming, daysUntil, isoDay, duplicateShow, programRounds, lockedUntil, gameQuestions, insertGame, moveRound, removeRound, uniqueRoundTitle,
  soundIds, choiceImageIds, choiceImageList, pictoSeriesList, pictoSeriesOf, foldLegacyFinale,
} from "../web/public/show.js";
import { PICTO_WORDS, PICTO_SERIES } from "../web/public/picto-cards.js";
import { guessTrack, defaultStart, normalizeLevel } from "../web/public/audio.js";
import { FULL_SHOW, FULL_TUNES, tunePlaylist } from "../web/public/test-show.js";

const GEMINI = `Titre : Les animaux de la jungle

1. Quel animal est surnommé le roi de la jungle ?
A) Le tigre
B) Le lion
C) L'éléphant
D) Le singe
Réponse : B

2. Combien de pattes a une araignée ?
A) 6
B) 8
C) 10
D) 4
Réponse : 8

3. Le paresseux dort beaucoup.
A) Vrai
B) Faux
Réponse : A
`;

describe("import d'un quiz", () => {
  test("texte Gemini produit avec la consigne fournie", () => {
    const quiz = parseQuiz(GEMINI);
    assert.equal(quiz.format, "texte");
    assert.equal(quiz.title, "Les animaux de la jungle");
    assert.equal(quiz.questions.length, 3);
    assert.deepEqual(quiz.questions[0], {
      text: "Quel animal est surnommé le roi de la jungle ?",
      choices: ["Le tigre", "Le lion", "L'éléphant", "Le singe"], correct: 1, duration: null, double: false, marks: 0,
    });
    // « 8 » désigne la proposition « 8 », pas la 8e proposition.
    assert.equal(quiz.questions[1].correct, 1);
    assert.deepEqual(quiz.questions[2].choices, ["Vrai", "Faux"]);
    assert.equal(quiz.questions[2].correct, 0);
    assert.ok(checkQuestions(quiz.questions).every((c) => c.errors.length === 0));
  });

  test("variantes de Gemini : gras, « Question 1 : », coche, marque Super Finale", () => {
    const quiz = parseQuiz(`**Titre : Spécial Disney**
**Question 1 : Comment s'appelle le bonhomme de neige de « La Reine des neiges » ? (x2)**
- A. Sven
- B. Olaf ✅
- C. Kristoff
- D. Hans

**Question 2 : Quelle couleur a Bourriquet ?**
a) Gris
b) Rose
c) Vert
d) Bleu
**Bonne réponse : a) Gris**
Durée : 15`);
    assert.equal(quiz.title, "Spécial Disney");
    assert.equal(quiz.questions.length, 2);
    assert.equal(quiz.questions[0].text, "Comment s'appelle le bonhomme de neige de « La Reine des neiges » ?");
    assert.equal(quiz.questions[0].double, true);
    assert.equal(quiz.questions[0].correct, 1);
    assert.equal(quiz.questions[1].correct, 0);
    assert.equal(quiz.questions[1].duration, 15);
  });

  test("lignes copiées d'un tableur, avec en-tête", () => {
    const quiz = parseQuiz([
      "Question\tRéponse A\tRéponse B\tRéponse C\tRéponse D\tBonne réponse\tDurée",
      "Capitale de l'Italie ?\tMilan\tVenise\tRome\tNaples\tC\t20",
      "La tomate est un fruit\tVrai\tFaux\t\t\tVrai\t",
    ].join("\n"));
    assert.equal(quiz.format, "tableur");
    assert.equal(quiz.questions.length, 2);
    assert.deepEqual(quiz.questions[0].choices, ["Milan", "Venise", "Rome", "Naples"]);
    assert.equal(quiz.questions[0].correct, 2);
    assert.equal(quiz.questions[0].duration, 20);
    assert.deepEqual(quiz.questions[1].choices, ["Vrai", "Faux"]);
    assert.equal(quiz.questions[1].correct, 0);
  });

  test("fichier CSV sans en-tête, guillemets et point-virgule", () => {
    const quiz = parseQuiz([
      '"Quel est le plus long fleuve de France ?";"La Seine";"La Loire";"Le Rhône";"La Garonne";"B"',
      '"Il dit ""miaou"" : qui est-ce ?";Le chien;Le chat;La vache;Le coq;2',
    ].join("\n"));
    assert.equal(quiz.questions.length, 2);
    assert.equal(quiz.questions[0].correct, 1);
    assert.equal(quiz.questions[1].text, 'Il dit "miaou" : qui est-ce ?');
    assert.equal(quiz.questions[1].correct, 1);
  });

  test("JSON, au format du projet ou dans un bloc de code", () => {
    const quiz = parseQuiz('```json\n{"title":"Démo","questions":[{"text":"Le Soleil est une étoile","choices":["Vrai","Faux"],"correct":0,"duration":10}]}\n```');
    assert.equal(quiz.format, "json");
    assert.equal(quiz.title, "Démo");
    assert.equal(quiz.questions[0].correct, 0);
    assert.equal(quiz.questions[0].duration, 10);
  });

  test("anomalies : bonne réponse absente ou double, propositions identiques, trop long, doublons", () => {
    const quiz = parseQuiz(`1. Question sans réponse ?
A) Un
B) Deux

2. Deux bonnes réponses ?
A) Oui ✅
B) Non ✅

3. Propositions identiques ?
A) Pomme
B) pomme
Réponse : A

4. Est-ce que cette question beaucoup trop longue pour des petits enfants de six ans contient vraiment plus de quinze mots ?
A) Oui
B) Non
Réponse : A

5. Question sans réponse ?
A) Un
B) Deux
Réponse : B`);
    const checks = checkQuestions(quiz.questions, { profile: "PETITS", existing: ["Question sans réponse ?"] });
    assert.match(checks[0].errors.join(), /Bonne réponse absente/);
    assert.match(checks[1].errors.join(), /Plusieurs propositions/);
    assert.match(checks[2].errors.join(), /identiques/);
    assert.equal(checks[3].errors.length, 0);
    assert.match(checks[3].warnings.join(), /long pour le profil/);
    assert.match(checks[4].warnings.join(), /Même question que la n° 1/);
    assert.match(checks[4].warnings.join(), /existe déjà dans la bibliothèque/);
  });

  test("bonne réponse par lettre, numéro ou texte", () => {
    const choices = ["Le lion", "Le tigre", "Le zèbre"];
    assert.equal(resolveCorrect("B", choices), 1);
    assert.equal(resolveCorrect("b) Le tigre", choices), 1);
    assert.equal(resolveCorrect("3", choices), 2);
    assert.equal(resolveCorrect("le zebre", choices), 2);
    assert.equal(resolveCorrect("D", choices), -1);
    assert.equal(resolveCorrect("", choices), -1);
  });

  test("la consigne Gemini reprend le thème, l'âge et le nombre de questions", () => {
    const prompt = geminiPrompt({ theme: "Pokémon", age: 9, count: 10 });
    assert.match(prompt, /10 questions sur le thème « Pokémon », pour des enfants de 9 ans/);
    assert.match(prompt, /Réponse : <lettre/);
  });
});

describe("Super Finale", () => {
  test("une ancienne manche « Super Finale » devient le réglage ×2 du quiz qui la précède, jamais une manche à part", () => {
    const old = [{ type: "quiz", quizId: "a" }, { type: "chante", count: 3 }, { type: "finale", quizId: "f" }, { type: "portes", doors: 4 }];
    assert.deepEqual(foldLegacyFinale(old), { rounds: [{ type: "quiz", quizId: "a", finale: 3 }, { type: "chante", count: 3 }, { type: "portes", doors: 4 }], folded: 1 });
    assert.equal(old[0].finale, undefined, "l'original n'est pas modifié");
    // Un réglage déjà choisi est gardé ; sans quiz avant elle, elle devient une manche Quiz ordinaire.
    assert.deepEqual(foldLegacyFinale([{ type: "quiz", quizId: "a", finale: 2 }, { type: "finale", quizId: "f" }]).rounds, [{ type: "quiz", quizId: "a", finale: 2 }]);
    assert.deepEqual(foldLegacyFinale([{ type: "finale", quizId: "f" }]).rounds, [{ type: "quiz", quizId: "f", finale: 3 }]);
    assert.deepEqual(foldLegacyFinale([{ type: "mimes", deckId: "d" }, null]), { rounds: [{ type: "mimes", deckId: "d" }], folded: 0 });
  });
});

describe("quiz en images (ChatGPT)", () => {
  const LION = "0123456789abcdef", CHIEN = "fedcba9876543210";
  test("JSON de ChatGPT : chaque réponse garde son texte et le nom de son image ; sans texte, le mot vient du nom", () => {
    const { questions } = parseQuiz("```json\n" + JSON.stringify({ title: "Petits", questions: [
      { text: "Qui court vite ?", illustration: "q1-revelation.png", choices: [{ text: "Lion", image: "q1-lion.png" }, { image: "q1-baleine.png" }, "Chien", { text: "Vache", image: "images/Q1-Vache.PNG" }], correct: 0 },
      { text: "Capitale ?", image: "🗼", choices: ["Paris", "Rome"], correct: 0 },
    ] }) + "\n```");
    // Image de révélation par question ; un émoji sous « image » n'est pas un fichier.
    assert.equal(questions[0].revealFile, "q1-revelation.png");
    assert.equal(questions[1].revealFile, undefined);
    assert.deepEqual(questions[0].choices, ["Lion", "Baleine", "Chien", "Vache"]);
    assert.deepEqual(questions[0].imageFiles, ["q1-lion.png", "q1-baleine.png", null, "images/Q1-Vache.PNG"]);
    assert.equal(questions[1].imageFiles, undefined, "question en texte");
    assert.equal(imageKey("images/Q1-Vache.PNG"), "q1-vache.png");
    assert.equal(wordFromImage("q12_poisson-rouge.png"), "Poisson rouge");
    const report = checkQuestions([{ ...questions[0], missingImages: ["q1-vache.png"] }]);
    assert.deepEqual(report[0].errors, []);
    assert.match(report[0].warnings.join(" "), /introuvable.*q1-vache\.png/);
    assert.match(chatgptImagePrompt({ theme: "les animaux", count: 5 }), /5 questions sur le thème « les animaux ».*\n[\s\S]*"image": "q1-lion\.png"/);
    assert.match(chatgptImagePrompt({}), /"illustration": "q1-revelation\.png"/);
  });
  test("prestation : les photos suivent leurs réponses, seulement pour un quiz à propositions", () => {
    const quiz = { title: "Petits", questions: [
      { text: "Qui court vite ?", choices: ["Lion", "Baleine", "Chien"], correct: 0, status: "validee", choiceImages: { 0: LION, 2: CHIEN } },
      { text: "Capitale ?", choices: ["Paris", "Rome"], correct: 0, status: "validee" },
    ] };
    const { snapshot, problems } = buildSnapshot("s", { rounds: [{ type: "quiz", quizId: "p" }] }, { p: quiz });
    assert.deepEqual(problems, []);
    const [a, b] = snapshot.quiz.questions;
    assert.deepEqual(a.choiceImages, [LION, "", CHIEN]);
    assert.equal(b.choiceImages, undefined);
    assert.deepEqual(choiceImageIds(snapshot.quiz.questions), [LION, CHIEN]);
    assert.deepEqual(choiceImageList({ choices: ["a", "b"], choiceImages: [null, "../x"] }), [], "aucune photo valable : texte");
  });
});

describe("tableau de bord des prestations", () => {
  const QUIZ = { title: "Animaux", questions: [{ text: "Roi ?", choices: ["Lion", "Tigre"], correct: 0, status: "validee" }] };
  const DRAFT = { title: "Brouillon", questions: [{ text: "?", choices: ["A", "B"], correct: 0, status: "brouillon" }] };
  const quizzes = { animaux: QUIZ, draft: DRAFT };

  test("état de préparation : prête seulement quand tout est complet et visible sur la régie", () => {
    const ok = { childName: "Léa", age: 7, date: "2026-12-02", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }] };
    assert.deepEqual(readiness(ok, quizzes), { level: "prete", todo: [] });
    assert.deepEqual(readiness({ ...ok, status: "brouillon" }, quizzes).todo, ["Passer le statut à « Prête »"]);
    assert.deepEqual(readiness({ childName: "Tom", status: "brouillon" }, quizzes).todo, ["Ajouter la date", "Indiquer l'âge", "Ajouter une manche"]);
    const draftOnly = readiness({ ...ok, rounds: [{ type: "quiz", quizId: "draft" }] }, quizzes);
    assert.equal(draftOnly.level, "a-completer");
    assert.match(draftOnly.todo.join(), /aucune question validée/);
    assert.match(readiness({ ...ok, rounds: [{ type: "quiz", quizId: "efface" }] }, quizzes).todo.join(), /n'existe plus/);
    assert.equal(readiness({ ...ok, status: "archivee" }, quizzes).level, "archivee");
  });

  test("anniversaires à venir : du plus proche au plus lointain, sans les passés ni les archivés", () => {
    const shows = {
      passe: { date: "2026-10-01", status: "publiee" }, loin: { date: "2026-12-20", status: "brouillon" },
      jour: { date: "2026-10-18", status: "publiee" }, archive: { date: "2026-11-01", status: "archivee" },
      sansDate: { status: "brouillon" }, proche: { date: "2026-10-25", status: "brouillon" },
    };
    assert.deepEqual(upcoming(shows, "2026-10-18").map(([id]) => id), ["jour", "proche", "loin"]);
    assert.equal(daysUntil("2026-12-02", "2026-10-18"), 45);
    assert.equal(daysUntil("2026-10-18", "2026-10-18"), 0);
    assert.equal(isoDay(new Date(2026, 0, 5)), "2026-01-05");
  });

  test("dupliquer : mêmes manches en brouillon, prénom et date à saisir, original intact", () => {
    const original = { childName: "Léa", age: 7, date: "2026-12-02", title: "Léa 7 ans", status: "publiee", profile: "PETITS", themes: "Licornes", rounds: [{ type: "quiz", quizId: "animaux" }], createdAt: 1, updatedAt: 2 };
    const copy = duplicateShow(original);
    assert.deepEqual(copy, { profile: "PETITS", themes: "Licornes", status: "brouillon", rounds: [{ type: "quiz", quizId: "animaux" }] });
    copy.rounds[0].quizId = "autre";
    assert.equal(original.rounds[0].quizId, "animaux");
  });
});

describe("programme modifié pendant la partie", () => {
  const q = (id, round) => ({ id, text: `${id} ?`, choices: ["A", "B"], correct: 0, duration: 20, round });
  const PLAN = [q("r1q1", "Animaux"), q("r1q2", "Animaux"), q("r2q1", "Espace"), q("r3q1", "Super Finale")];
  const ids = (list) => list.map((x) => x.id);

  test("la manche en cours est verrouillée jusqu'à sa dernière question", () => {
    assert.equal(lockedUntil(PLAN, -1), -1);
    assert.equal(lockedUntil(PLAN, 0), 1);
    assert.equal(lockedUntil(PLAN, 2), 2);
    assert.equal(lockedUntil([q("a"), q("b")], 0), 0, "Sans manches, seule la question en cours");
    assert.deepEqual(programRounds(PLAN).map((r) => [r.title, r.start, r.end]), [["Animaux", 0, 1], ["Espace", 2, 2], ["Super Finale", 3, 3]]);
  });

  test("quiz de démonstration (questions sans manche) : un seul jeu « Quiz », pas un jeu par question", () => {
    const demo = [q("a"), q("b"), { ...q("c"), double: true }];
    assert.deepEqual(programRounds(demo).map((r) => [r.title, r.start, r.end]), [["Quiz", 0, 2]]);
    // Un jeu ajouté ensuite reste un jeu à part.
    assert.deepEqual(programRounds([...demo, q("m", "Mimes")]).map((r) => [r.title, r.start, r.end]), [["Quiz", 0, 2], ["Mimes", 3, 3]]);
  });

  test("ajouter un jeu après la manche actuelle ou à la fin, avec des identifiants neufs", () => {
    const quizzes = { dino: { title: "Dinosaures", questions: [{ text: "T-Rex ?", choices: ["Oui", "Non"], correct: 0, status: "validee" }] } };
    const { questions } = gameQuestions({ type: "quiz", quizId: "dino" }, quizzes, "GRANDS", "e9");
    assert.deepEqual(questions.map((x) => [x.id, x.round, x.duration]), [["e9q1", "Dinosaures", 22]]);
    assert.deepEqual(ids(insertGame(PLAN, questions, "after", 0)), ["r1q1", "r1q2", "e9q1", "r2q1", "r3q1"]);
    assert.deepEqual(ids(insertGame(PLAN, questions, "end", 0)), ["r1q1", "r1q2", "r2q1", "r3q1", "e9q1"]);
    assert.deepEqual(ids(insertGame(PLAN, questions, "after", -1)), ["e9q1", "r1q1", "r1q2", "r2q1", "r3q1"], "Au salon : en premier");
    const finale = gameQuestions({ type: "finale", quizId: "dino" }, quizzes, null, "e10");
    assert.equal(finale.questions[0].double, true);
    assert.equal(gameQuestions({ type: "quiz", quizId: "efface" }, quizzes, null, "x").questions.length, 0);
  });

  test("déplacer ou retirer seulement les manches pas encore commencées", () => {
    assert.deepEqual(ids(moveRound(PLAN, 3, -1, 0)), ["r1q1", "r1q2", "r3q1", "r2q1"]);
    assert.equal(moveRound(PLAN, 2, -1, 0), null, "Impossible de passer devant la manche en cours");
    assert.equal(moveRound(PLAN, 3, 1, 0), null);
    assert.deepEqual(ids(removeRound(PLAN, 2, 0)), ["r1q1", "r1q2", "r3q1"]);
    assert.equal(removeRound(PLAN, 0, 0), null, "La manche en cours reste");
    assert.equal(removeRound([q("a", "A")], 0, -1), null, "Le programme ne peut pas devenir vide");
  });

  test("un jeu ajouté deux fois garde des manches distinctes", () => {
    assert.equal(uniqueRoundTitle(PLAN, "Dinosaures"), "Dinosaures");
    assert.equal(uniqueRoundTitle(PLAN, "Animaux"), "Animaux · 2");
    assert.equal(uniqueRoundTitle([...PLAN, q("x", "Animaux · 2")], "Animaux"), "Animaux · 3");
  });
});

describe("prestation de test", () => {
  test("10 questions jouables pour 9 ans, chronos imposés, finale ×2, prête pour la régie", async () => {
    const { TEST_ID, TEST_QUIZ, TEST_SHOW } = await import("../web/public/test-show.js");
    const quizzes = { [TEST_ID]: TEST_QUIZ };
    const { snapshot, problems } = buildSnapshot(TEST_ID, TEST_SHOW, quizzes);
    assert.deepEqual(problems, []);
    assert.equal(snapshot.title, "ANNIVERSAIRE TEST – Léa, 9 ans");
    assert.equal(snapshot.profile, "MOYENS");
    const q = snapshot.quiz.questions;
    assert.equal(q.length, 10);
    assert.deepEqual(q.map((x) => x.duration), [20, 20, 15, 20, 20, 20, 15, 20, 20, 25]);
    assert.deepEqual(q.map((x) => x.double), [false, false, false, false, false, false, false, false, false, true]);
    assert.equal(q.filter((x) => x.kind === "true_false").length, 2);
    const report = checkQuestions(TEST_QUIZ.questions, { profile: "MOYENS" });
    assert.deepEqual(report.flatMap((r) => [...r.errors, ...r.warnings]), []);
    assert.equal(readiness(TEST_SHOW, quizzes).level, "prete");
  });
});

describe("mimes", () => {
  const DECK = { title: "Animaux", duration: 45, cards: [{ word: "Chat", image: "🐱" }, { word: " Robot " }, { word: "" }, null] };
  const QUIZ = { title: "Quiz", questions: [{ text: "Roi ?", choices: ["Lion", "Tigre"], correct: 0, status: "validee" }] };

  test("une manche de mimes devient un seul élément du programme, avec son paquet et la durée d'un tour", () => {
    const show = { childName: "Léa", age: 9, rounds: [{ type: "quiz", quizId: "q" }, { type: "mimes", deckId: "d" }] };
    const { snapshot, problems } = buildSnapshot("s", show, { q: QUIZ }, { d: DECK }, () => 0);
    assert.deepEqual(problems, []);
    const mime = snapshot.quiz.questions[1];
    assert.equal(snapshot.quiz.questions.length, 2);
    assert.deepEqual({ ...mime, cards: undefined }, { id: "r2m", text: "Animaux", kind: "mime", duration: 45, cards: undefined, round: "Animaux" });
    assert.deepEqual(mime.cards.map((c) => c.word).sort(), ["Chat", "Robot"], "Cartes vides écartées, mots nettoyés");
    assert.deepEqual(snapshot.rounds[1], { title: "Animaux", count: 1, kind: "mime" });
    assert.ok(estimateMinutes(snapshot) >= 3);
  });

  test("paquet supprimé ou vide : la manche est signalée, la prestation n'est pas prête", () => {
    const show = { childName: "Léa", age: 9, date: "2026-12-02", status: "publiee", rounds: [{ type: "mimes", deckId: "absent" }] };
    assert.match(buildSnapshot("s", show, {}, {}).problems[0], /paquet de mimes n'existe plus/);
    assert.match(buildSnapshot("s", { ...show, rounds: [{ type: "mimes", deckId: "d" }] }, {}, { d: { title: "Vide", cards: [] } }).problems[0], /aucune carte/);
    assert.equal(readiness({ ...show, rounds: [{ type: "mimes", deckId: "d" }] }, {}, { d: DECK }).level, "prete");
  });

  test("les cartes du catalogue ont un mot, une image et un thème, sans doublon", () => {
    const words = MIME_CATALOG.map((c) => c.word.toLowerCase());
    assert.equal(new Set(words).size, words.length);
    assert.ok(MIME_CATALOG.length >= 100);
    assert.ok(MIME_CATALOG.every((c) => c.word && c.image && c.image.length <= 16 && c.theme));
  });
});

describe("Vrai ou Faux express", () => {
  const QUIZ = {
    title: "Sciences",
    questions: [
      { text: "Le Soleil est une étoile", choices: ["Vrai", "Faux"], correct: 0, duration: 30, status: "validee" },
      { text: "Planète la plus proche ?", choices: ["Mercure", "Mars", "Vénus", "Terre"], correct: 0, status: "validee" },
      { text: "Les poissons volent", choices: ["vrai", "faux"], correct: 1, status: "validee" },
      { text: "Pas encore relue", choices: ["Vrai", "Faux"], correct: 0, status: "brouillon" },
    ],
  };

  test("seules les affirmations Vrai / Faux validées, au chrono court du profil, s'enchaînent dans une seule manche", () => {
    const show = { childName: "Léa", age: 7, rounds: [{ type: "express", quizId: "s" }, { type: "quiz", quizId: "s" }] };
    const { snapshot, problems } = buildSnapshot("x", show, { s: QUIZ });
    assert.deepEqual(problems, []);
    const express = snapshot.quiz.questions.filter((q) => q.kind === "express");
    assert.deepEqual(express.map((q) => [q.text, q.duration, q.round]), [
      ["Le Soleil est une étoile", 12, "Vrai ou Faux express"],
      ["Les poissons volent", 12, "Vrai ou Faux express"],
    ]);
    // Le même quiz en manche normale garde ses chronos et son type.
    assert.equal(snapshot.quiz.questions[2].kind, "true_false");
    assert.equal(snapshot.quiz.questions[2].duration, 30);
    assert.ok(estimateMinutes({ quiz: { questions: express } }) <= 1);
  });

  test("quiz sans Vrai / Faux : la manche est signalée, rien n'est inventé", () => {
    const quiz = { title: "Capitales", questions: [{ text: "Capitale ?", choices: ["Paris", "Rome"], correct: 0, status: "validee" }] };
    const { snapshot, problems } = buildSnapshot("x", { childName: "Léa", age: 9, rounds: [{ type: "express", quizId: "c" }] }, { c: quiz });
    assert.equal(snapshot, null);
    assert.match(problems[0], /aucune question Vrai \/ Faux validée pour le Vrai ou Faux express/);
  });
});

describe("Zoom mystère", () => {
  const PHOTO = "0123456789abcdef";
  const QUIZ = {
    title: "Animaux",
    questions: [
      { text: "Quel animal ?", choices: ["Chat", "Lion"], correct: 1, imageId: PHOTO, status: "validee" },
      { text: "Sans photo ?", choices: ["Oui", "Non"], correct: 0, status: "validee" },
      { text: "Combien ?", kind: "number", correct: 4, imageId: PHOTO, status: "validee" },
    ],
  };

  test("seules les questions à propositions avec photo, chrono du profil, points du quiz", () => {
    const { snapshot, problems } = buildSnapshot("x", { childName: "Léa", age: 9, rounds: [{ type: "zoom", quizId: "a" }] }, { a: QUIZ });
    assert.deepEqual(problems, []);
    assert.deepEqual(snapshot.quiz.questions.map((q) => [q.kind, q.imageId, q.round, q.double]), [["zoom", PHOTO, "Zoom mystère", false]]);
    assert.equal(snapshot.quiz.questions[0].duration, 25);
  });

  test("quiz sans photo : la manche est signalée", () => {
    const quiz = { title: "Vide", questions: [{ text: "?", choices: ["a", "b"], correct: 0, status: "validee" }] };
    assert.match(buildSnapshot("x", { childName: "Léa", age: 9, rounds: [{ type: "zoom", quizId: "v" }] }, { v: quiz }).problems[0], /aucune question avec photo/);
  });
});

describe("Image floue", () => {
  const PHOTO = "0123456789abcdef";
  test("les questions avec photo, 40 secondes pour que l'image devienne nette, sans propositions à l'écran", () => {
    const quiz = { title: "Animaux", questions: [
      { text: "Quel animal ?", choices: ["Chat", "Lion"], correct: 1, imageId: PHOTO, status: "validee" },
      { text: "Sans photo ?", choices: ["Oui", "Non"], correct: 0, status: "validee" },
    ] };
    const { snapshot, problems } = buildSnapshot("x", { childName: "Léa", age: 7, rounds: [{ type: "flou", quizId: "a" }] }, { a: quiz });
    assert.deepEqual(problems, []);
    assert.deepEqual(snapshot.quiz.questions.map((q) => [q.kind, q.imageId, q.round, q.duration, q.choices[q.correct]]), [["flou", PHOTO, "Image floue", 40, "Lion"]]);
  });

  test("quiz sans photo : la manche est signalée", () => {
    const quiz = { title: "Vide", questions: [{ text: "?", choices: ["a", "b"], correct: 0, status: "validee" }] };
    assert.match(buildSnapshot("x", { childName: "Léa", age: 9, rounds: [{ type: "flou", quizId: "v" }] }, { v: quiz }).problems[0], /aucune question avec photo pour l'Image floue/);
  });
});

describe("Jeux au buzzer intégrés (Chante le mot !, Qui suis-je ?)", () => {
  test("rien à préparer : le nombre demandé, sans doublon, une seule réponse attendue, des indices pour Qui suis-je", () => {
    const { snapshot, problems } = buildSnapshot("x", { childName: "Léa", age: 9, rounds: [{ type: "chante", count: 4 }, { type: "quisuis" }] }, {});
    assert.deepEqual(problems, []);
    const qs = snapshot.quiz.questions;
    const chante = qs.filter((q) => q.kind === "chante");
    const quiSuis = qs.filter((q) => q.kind === "quisuis");
    assert.equal(chante.length, 4);
    assert.equal(new Set(chante.map((q) => q.text)).size, 4, "jamais deux fois le même mot");
    assert.ok(chante.every((q) => q.choices.length === 1 && q.choices[0] === q.text && q.correct === 0 && q.duration === 30 && q.round === "Chante le mot !"));
    assert.equal(quiSuis.length, 5);
    assert.ok(quiSuis.every((q) => q.choices.length === 1 && q.cards.length === 4 && q.image && q.duration === 40 && q.round === "Qui suis-je ?"));
    assert.equal(new Set(qs.map((q) => q.id)).size, qs.length);
  });

  test("Petits : seulement les mots faciles ; une manche intégrée compte comme remplie", () => {
    const { snapshot } = buildSnapshot("x", { childName: "Tom", age: 6, rounds: [{ type: "chante", count: 10 }] }, {}, {}, () => 0.5);
    const hard = ["bonheur", "liberté", "rêve", "monde", "ange", "toujours", "jamais"];
    assert.ok(snapshot.quiz.questions.every((q) => !hard.includes(q.text)));
    assert.equal(roundFilled({ type: "quisuis" }), true);
  });
});

describe("Qui a disparu ?", () => {
  test("des grilles d'objets d'une même famille, l'objet disparu en fait partie, la durée suit l'âge", () => {
    const { snapshot, problems } = buildSnapshot("x", { childName: "Léa", age: 9, rounds: [{ type: "disparu" }] }, {});
    assert.deepEqual(problems, []);
    const qs = snapshot.quiz.questions;
    assert.equal(qs.length, 4);
    assert.equal(new Set(qs.map((q) => q.cards.map((c) => c.word).join())).size, 4, "quatre grilles différentes");
    for (const q of qs) {
      assert.equal(q.kind, "disparu");
      assert.equal(q.round, "Qui a disparu ?");
      assert.equal(q.cards.length, 7, "7 objets chez les Moyens");
      assert.equal(q.correct, 0);
      assert.equal(q.cards.filter((c) => c.word === q.choices[0]).length, 1, "l'objet disparu est dans la grille");
      assert.equal(q.image, q.cards.find((c) => c.word === q.choices[0]).image);
      assert.equal(q.duration, 14 + 3 + 25, "mémorisation (2 s par objet), tour de magie, recherche");
      assert.ok(q.cards.every((c) => c.image && c.word));
    }
    const petits = buildSnapshot("x", { childName: "Tom", age: 6, rounds: [{ type: "disparu", count: 2 }] }, {}).snapshot.quiz.questions;
    assert.deepEqual(petits.map((q) => [q.cards.length, q.duration]), [[5, 38], [5, 38]], "5 objets et 10 s pour mémoriser chez les Petits");
    assert.equal(roundFilled({ type: "disparu" }), true);
  });
});

describe("Le Juste Chiffre", () => {
  test("une question sans propositions avec un nombre pour réponse devient une question du Juste Chiffre", () => {
    const { questions } = parseQuiz("1. Combien d'os dans le corps humain ?\nRéponse : 206\n\n2. Hauteur de la tour Eiffel en mètres ?\nRéponse : 1 000\n\n3. Sans réponse ?\nRéponse : beaucoup");
    assert.equal(questions[0].kind, "number");
    assert.equal(questions[0].correct, 206);
    assert.deepEqual(questions[0].choices, []);
    assert.equal(questions[1].correct, 1000);
    assert.equal(questions[2].kind, undefined);
    const checks = checkQuestions(questions);
    assert.deepEqual(checks[0].errors, []);
    assert.ok(checks[2].errors.length > 0, "une réponse qui n'est pas un nombre reste à corriger");
  });
  test("tableur : une ligne sans propositions avec un nombre, mélangée aux questions à propositions", () => {
    const { questions } = parseQuiz("Question;Réponse A;Réponse B;Bonne réponse\nCombien de pattes a une araignée ?;;;8\nCapitale ?;Paris;Lyon;A");
    assert.equal(questions.length, 2);
    assert.equal(questions[0].kind, "number");
    assert.equal(questions[0].correct, 8);
    assert.equal(questions[1].kind, undefined);
    assert.equal(questions[1].correct, 0);
  });
  test("dans une prestation, la question garde son type et son nombre, sans propositions", () => {
    const quiz = { title: "Nombres", questions: [{ text: "Combien d'os ?", kind: "number", correct: 206, status: "validee" }] };
    const { snapshot } = buildSnapshot("s", { childName: "Léa", age: 9, rounds: [{ type: "quiz", quizId: "n" }] }, { n: quiz });
    const q = snapshot.quiz.questions[0];
    assert.equal(q.kind, "number");
    assert.equal(q.correct, 206);
    assert.equal(q.choices, undefined);
  });
});

describe("blind test et quiz musical", () => {
  const ID = (n) => `${n}123456789abcdef`;
  const playlist = {
    title: "Dessins animés", duration: 25,
    tracks: [
      { title: "Libérée, délivrée", artist: "La Reine des neiges", audioId: ID(0) },
      { title: "Hakuna Matata", artist: "Le Roi lion", audioId: ID(1) },
      { title: "Sous l'océan", audioId: ID(2) },
      { title: "Je voudrais déjà être roi", audioId: ID(3) },
      { title: "Sans extrait" },
    ],
  };
  test("une playlist donne un blind test au buzzer et un quiz musical à 4 titres, en deux manches distinctes", () => {
    const show = { childName: "Léa", age: 9, rounds: [{ type: "blind", playlistId: "p" }, { type: "musical", playlistId: "p" }] };
    const { snapshot, problems } = buildSnapshot("s", show, {}, {}, Math.random, { p: playlist });
    assert.deepEqual(problems, []);
    const qs = snapshot.quiz.questions;
    const blind = qs.filter((q) => q.kind === "blind");
    const musical = qs.filter((q) => q.kind === "classic");
    assert.equal(blind.length, 4, "un morceau sans extrait n'est pas joué");
    assert.equal(musical.length, 4);
    assert.ok(blind.every((q) => q.choices.length === 1 && q.correct === 0 && q.duration === 25 && /^[0-9]123456789abcdef$/.test(q.audioId)));
    assert.equal(blind.find((q) => q.choices[0] === "Hakuna Matata").artist, "Le Roi lion");
    assert.ok(musical.every((q) => q.choices.length === 4 && new Set(q.choices).size === 4 && q.audioId));
    for (const q of musical) {
      const track = playlist.tracks.find((t) => t.audioId === q.audioId);
      assert.equal(q.choices[q.correct], track.title, "la bonne réponse est le titre de l'extrait joué");
    }
    assert.deepEqual(programRounds(qs).map((r) => r.title), ["Blind test · Dessins animés", "Quiz musical · Dessins animés"]);
    assert.equal(soundIds(qs).length, 4);
    assert.equal(roundFilled({ type: "blind" }), false);
    assert.equal(roundFilled({ type: "blind", playlistId: "p" }), true);
  });
  test("blind test : morceaux dans l'ordre de la playlist, les 3 derniers à 200, valeur et pochette propres à un morceau", () => {
    const tracks = Array.from({ length: 6 }, (_, k) => ({ title: `Titre ${k + 1}`, audioId: ID(k) }));
    tracks[1] = { ...tracks[1], points: 150, imageId: "fedcba9876543210", duration: 30 };
    const show = { childName: "Léa", age: 9, rounds: [{ type: "blind", playlistId: "p" }] };
    const run = (p) => buildSnapshot("s", show, {}, {}, Math.random, { p }).snapshot.quiz.questions;
    const qs = run({ title: "Tubes", duration: 25, tracks });
    assert.deepEqual(qs.map((q) => q.choices[0]), tracks.map((t) => t.title), "jamais mélangés : Sarah choisit l'ordre");
    assert.deepEqual(qs.map((q) => q.points), [100, 150, 100, 200, 200, 200]);
    assert.ok(qs.every((q) => q.reveal === 7));
    assert.equal(qs[1].imageId, "fedcba9876543210");
    assert.equal(qs[1].duration, 30);
    assert.equal(qs[0].imageId, undefined);
    // Barème choisi dans l'administration.
    const custom = run({ title: "Tubes", duration: 25, tracks, points: 50, finalPoints: 500, finalCount: 1, reveal: 10 });
    assert.deepEqual(custom.map((q) => q.points), [50, 150, 50, 50, 50, 500]);
    assert.ok(custom.every((q) => q.reveal === 10));
    // Révélation longue, ou tout l'extrait (0) pour chanter le refrain.
    assert.ok(run({ title: "Tubes", duration: 25, tracks, reveal: 30 }).every((q) => q.reveal === 30));
    assert.ok(run({ title: "Tubes", duration: 25, tracks, reveal: 0 }).every((q) => q.reveal === 0));
    // Barème abîmé : les valeurs par défaut.
    assert.deepEqual(run({ title: "Tubes", duration: 25, tracks, points: -3, finalCount: 99 }).map((q) => q.points), [100, 150, 100, 200, 200, 200]);
  });
  test("playlist effacée ou trop courte : la manche est signalée, jamais jouée à moitié", () => {
    const one = { title: "Solo", duration: 20, tracks: [{ title: "A", audioId: ID(0) }] };
    const gone = buildSnapshot("s", { childName: "Tom", age: 8, rounds: [{ type: "blind", playlistId: "x" }] }, {}, {}, Math.random, {});
    assert.equal(gone.snapshot, null);
    assert.match(gone.problems.join(), /playlist n'existe plus/);
    const musical = buildSnapshot("s", { childName: "Tom", age: 8, rounds: [{ type: "musical", playlistId: "o" }] }, {}, {}, Math.random, { o: one });
    assert.match(musical.problems.join(), /au moins 2 morceaux/);
    const blind = buildSnapshot("s", { childName: "Tom", age: 8, rounds: [{ type: "blind", playlistId: "o" }] }, {}, {}, Math.random, { o: one });
    assert.equal(blind.snapshot.quiz.questions.length, 1);
    assert.deepEqual(readiness({ childName: "Tom", age: 8, date: "2026-12-02", status: "publiee", rounds: [{ type: "blind", playlistId: "o" }] }, {}, {}, { o: one }), { level: "prete", todo: [] });
  });
  test("titre et artiste devinés depuis le nom du fichier, début d'extrait proposé dans le morceau", () => {
    assert.deepEqual(guessTrack("Stromae - Alors on danse.mp3"), { artist: "Stromae", title: "Alors on danse" });
    assert.deepEqual(guessTrack("03 - Angèle – Balance ton quoi.m4a"), { artist: "Angèle", title: "Balance ton quoi" });
    assert.deepEqual(guessTrack("libérée_délivrée.wav"), { artist: "", title: "libérée délivrée" });
    assert.equal(defaultStart(210, 25), 45);
    assert.equal(defaultStart(60, 25), 20);
    assert.equal(defaultStart(20, 25), 0);
  });
  test("chaque extrait est mis au même niveau sonore, sans jamais dépasser la pleine échelle", () => {
    const sine = (amp) => Float32Array.from({ length: 44_100 }, (_, i) => amp * Math.sin(i / 7));
    const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
    const calme = sine(0.1), fort = sine(0.45);
    assert.ok(normalizeLevel(calme) > 1);
    assert.ok(normalizeLevel(fort) < 1);
    for (const a of [calme, fort]) {
      assert.ok(Math.abs(rms(a) - 0.2) < 0.03, `niveau ${rms(a)}`);
      assert.ok(a.every((x) => Math.abs(x) < 1));
    }
    // Un pic isolé dans un morceau très calme : le gain s'arrête avant d'écrêter, le pic est adouci.
    const pic = sine(0.02); pic[100] = 0.9;
    normalizeLevel(pic);
    assert.ok(pic.every((x) => Math.abs(x) < 1));
    const silence = new Float32Array(1000);
    assert.equal(normalizeLevel(silence), 1);
    assert.ok(silence.every((x) => x === 0));
  });
  test("la prestation de test « tous les jeux » a un blind test et un quiz musical de comptines du domaine public", () => {
    const pl = tunePlaylist(FULL_TUNES.map((_, i) => ID(i)));
    const { snapshot, problems } = buildSnapshot("t", FULL_SHOW, {}, {}, Math.random, { [FULL_SHOW.rounds.find((r) => r.type === "blind").playlistId]: pl });
    assert.ok(pl.tracks.every((t) => t.rights === "Domaine public"));
    const kinds = snapshot.quiz.questions.map((q) => q.kind);
    assert.equal(kinds.filter((k) => k === "blind").length, FULL_TUNES.length);
    assert.ok(problems.every((p) => !/playlist|morceau/.test(p)));
  });
});

describe("statues musicales", () => {
  test("une manche sans rien à préparer : un seul élément, durée choisie, musique de la TV", () => {
    const { snapshot, problems } = buildSnapshot("s", { childName: "Léa", age: 7, rounds: [{ type: "statues", duration: 60 }, { type: "statues", duration: 999 }] }, {});
    assert.deepEqual(problems, []);
    const qs = snapshot.quiz.questions;
    assert.deepEqual(qs.map((q) => [q.kind, q.duration, q.choices, q.round]), [["statues", 60, undefined, "Statues musicales"], ["statues", 90, undefined, "Statues musicales"]]);
    assert.equal(roundFilled({ type: "statues" }), true);
    assert.equal(estimateMinutes(snapshot), 4);
  });
});

describe("Portes mystères", () => {
  const QUIZ = { title: "Quiz", questions: [{ text: "Roi ?", choices: ["Lion", "Tigre"], correct: 0, status: "validee" }] };
  test("le jeu final : 3 ou 4 portes, contenus mélangés, à la suite d'un quiz sans rien bloquer", () => {
    const show = { childName: "Léa", age: 9, rounds: [{ type: "quiz", quizId: "q" }, { type: "portes", doors: 3 }, { type: "portes" }, { type: "portes", doors: 9 }] };
    const { snapshot, problems } = buildSnapshot("s", show, { q: QUIZ });
    assert.deepEqual(problems, []);
    const doors = snapshot.quiz.questions.filter((q) => q.kind === "portes");
    assert.equal(doors.length, 3);
    assert.deepEqual(doors.map((q) => q.choices.length), [3, 4, 4], "4 portes par défaut ou si le nombre est invalide");
    assert.deepEqual([...doors[0].doors].sort((a, b) => a - b), [-150, 100, 300]);
    assert.deepEqual([...doors[1].doors].sort((a, b) => a - b), [-150, 50, 150, 300]);
    assert.deepEqual(doors.map((q) => [q.text, q.round, q.correct, q.duration]), Array(3).fill(["Portes mystères", "Portes mystères", -1, 30]));
    assert.equal(new Set(snapshot.quiz.questions.map((q) => q.id)).size, snapshot.quiz.questions.length, "identifiants uniques");
    assert.equal(roundFilled({ type: "portes" }), true, "rien à préparer");
  });
});

describe("Super Finale : les dernières questions du quiz, pas un jeu à part", () => {
  const quiz = (title, n) => ({ title, questions: [...Array(n).keys()].map((i) => ({ text: `${title} ${i + 1} ?`, choices: ["Oui", "Non"], correct: 0, status: "validee" })) });
  const LIB = { a: quiz("Animaux", 2), b: quiz("Sport", 1), f: quiz("Finale", 2) };
  const play = (rounds) => buildSnapshot("s", { childName: "Léa", age: 9, rounds }, LIB, { d: { title: "Mimes", cards: [{ word: "Chat" }] } }, () => 0);

  test("réglage de la manche Quiz : ses N dernières questions comptent double, dans le même jeu", () => {
    const two = play([{ type: "quiz", quizId: "a", finale: 2 }, { type: "mimes", deckId: "d" }]).snapshot;
    assert.deepEqual(two.quiz.questions.map((q) => [q.round, q.double ?? false, q.finale ?? false]), [
      ["Animaux", true, true], ["Animaux", true, true], ["Mimes", false, false],
    ]);
    assert.deepEqual(two.rounds.map((r) => [r.title, r.count, r.finale]), [["Animaux", 2, 2], ["Mimes", 1, undefined]]);
    const one = play([{ type: "quiz", quizId: "a", finale: 1 }]).snapshot;
    assert.deepEqual(one.quiz.questions.map((q) => q.double ?? false), [false, true]);
    assert.deepEqual(play([{ type: "quiz", quizId: "a", finale: 9 }]).snapshot.quiz.questions.map((q) => q.double), [true, true], "jamais plus que le quiz");
    assert.deepEqual(play([{ type: "quiz", quizId: "a" }]).snapshot.quiz.questions.map((q) => q.double), [false, false], "sans réglage : rien ×2");
    assert.deepEqual(play([{ type: "express", quizId: "a", finale: 2 }]).snapshot?.quiz.questions.map((q) => q.double ?? false) ?? [], play([{ type: "express", quizId: "a" }]).snapshot?.quiz.questions.map((q) => q.double ?? false) ?? [], "seulement pour le Quiz");
  });

  test("après un quiz : ses questions ×2 terminent ce quiz, sous son titre", () => {
    const { snapshot, problems } = play([{ type: "quiz", quizId: "a" }, { type: "mimes", deckId: "d" }, { type: "finale", quizId: "f" }]);
    assert.deepEqual(problems, []);
    assert.deepEqual(snapshot.quiz.questions.map((q) => [q.round, q.double ?? false, q.finale ?? false]), [
      ["Animaux", false, false], ["Animaux", false, false], ["Animaux", true, true], ["Animaux", true, true], ["Mimes", false, false],
    ]);
    assert.deepEqual(snapshot.rounds.map((r) => [r.title, r.count, r.finale]), [["Animaux", 4, 2], ["Mimes", 1, undefined]]);
  });

  test("le quiz le plus proche avant la finale l'accueille ; à défaut, le premier quiz après", () => {
    const before = play([{ type: "quiz", quizId: "a" }, { type: "quiz", quizId: "b" }, { type: "finale", quizId: "f" }]).snapshot;
    assert.deepEqual(before.quiz.questions.map((q) => q.round), ["Animaux", "Animaux", "Sport", "Sport", "Sport"]);
    const first = play([{ type: "finale", quizId: "f" }, { type: "mimes", deckId: "d" }, { type: "quiz", quizId: "b" }]).snapshot;
    assert.deepEqual(first.quiz.questions.map((q) => [q.round, q.double ?? false]), [["Mimes", false], ["Sport", false], ["Sport", true], ["Sport", true]]);
  });

  test("sans aucun quiz : la finale reste jouable seule, ×2", () => {
    const { snapshot, problems } = play([{ type: "mimes", deckId: "d" }, { type: "finale", quizId: "f" }]);
    assert.deepEqual(problems, []);
    assert.deepEqual(snapshot.quiz.questions.map((q) => [q.round, q.double ?? false]), [["Mimes", false], ["Super Finale", true], ["Super Finale", true]]);
  });
});

describe("Régie PC : contenus intégrés réglés, nombre de questions, notes", () => {
  const quiz = { title: "Animaux", questions: [1, 2, 3, 4].map((n) => ({ text: `Q${n} ?`, choices: ["Oui", "Non"], correct: 0, status: "validee" })) };

  test("un élément retiré ne sort plus, un ajout peut sortir, un ajout mal formé est ignoré", () => {
    const contents = {
      chante: { off: ["soleil", "Maman"], extra: [{ word: " arc-en-ciel " }, { word: "" }, null] },
      quisuis: { extra: [{ answer: "Le kangourou", emoji: "🦘", clues: ["Australie", "Poche"] }, { answer: "Seul", clues: ["un indice"] }] },
      disparu: { off: ["fruits"], extra: [{ theme: "Jouets", objects: [["Ours", "🧸"], ["Ballon", "⚽"], ["Dé", "🎲"], ["Cerf-volant", "🪁"], ["Toupie", "🎯"]].map(([word, image]) => ({ word, image })) }] },
    };
    const words = activeItems("chante", contents.chante).map((w) => w.word);
    assert.ok(!words.includes("soleil") && !words.includes("maman"));
    assert.equal(words.at(-1), "arc-en-ciel");
    assert.deepEqual(activeItems("quisuis", contents.quisuis).at(-1), { answer: "Le kangourou", emoji: "🦘", clues: ["Australie", "Poche"], level: 1 });
    assert.equal(activeItems("quisuis", contents.quisuis).filter((p) => p.answer === "Seul").length, 0);
    const themes = activeItems("disparu", contents.disparu).map((t) => t.theme);
    assert.ok(!themes.includes("Fruits") && themes.includes("Jouets"));
    // Un seul mot actif : la manche ne joue que lui.
    const only = { chante: { off: activeItems("chante", {}).map((w) => w.word.toLowerCase()), extra: [{ word: "arc-en-ciel" }] } };
    const { snapshot } = buildSnapshot("s", { age: 9, rounds: [{ type: "chante", count: 6 }] }, {}, {}, Math.random, {}, only);
    assert.deepEqual(snapshot.quiz.questions.map((q) => q.text), ["arc-en-ciel"]);
  });

  test("Qui suis-je ? : l'image d'un personnage préparée dans l'administration part avec la question", () => {
    const contents = { quisuis: { off: activeItems("quisuis", {}).map((p) => p.answer.toLowerCase()), extra: [{ answer: "Le koala", clues: ["Eucalyptus", "Australie"] }], images: { "le koala": "0123456789abcdef", autre: "pas-un-id" } } };
    const { snapshot } = buildSnapshot("s", { age: 9, rounds: [{ type: "quisuis" }] }, {}, {}, Math.random, {}, contents);
    assert.equal(snapshot.quiz.questions[0].imageId, "0123456789abcdef");
    assert.equal(snapshot.quiz.questions[0].choices[0], "Le koala");
  });

  test("Qui a disparu ? : objets par grille réglés sur la manche, et jamais deux fois la même famille", () => {
    const { snapshot } = buildSnapshot("s", { age: 7, rounds: [{ type: "disparu", count: 4, objects: 11 }, { type: "disparu", count: 4 }] }, {});
    const grids = snapshot.quiz.questions.filter((q) => q.kind === "disparu");
    assert.equal(grids.length, 8);
    assert.ok(grids.slice(0, 4).every((q) => q.cards.length === 11), "11 objets demandés sur la première manche");
    assert.ok(grids.slice(4).every((q) => q.cards.length === 5), "la seconde suit l'âge (6-8 ans : 5)");
    const family = (q) => DISPARU_THEMES.find((t) => q.cards.every((c) => t.objects.some((o) => o.word === c.word))).theme;
    assert.equal(new Set(grids.map(family)).size, 8, "8 familles différentes sur les deux manches");
    assert.equal(disparuObjects({ objects: 40 }, "MOYENS"), 7);
  });

  test("Pictionary : mots rangés en séries, la manche garde seulement les séries choisies", () => {
    assert.ok(PICTO_WORDS.every((w) => PICTO_SERIES.includes(w.series)), "chaque mot intégré a sa série");
    assert.ok(PICTO_SERIES.length >= 5);
    const contents = { pictionary: { extra: [{ word: "Toboggan", image: "🛝", series: "Au parc" }, { word: "Doudou" }] } };
    assert.deepEqual(pictoSeriesList(activeItems("pictionary", contents.pictionary)).slice(-2), ["Au parc", "Mes mots"]);
    const deck = (series) => buildSnapshot("s", { age: 9, rounds: [{ type: "pictionary", series }] }, {}, {}, Math.random, {}, contents);
    const animaux = deck(["Animaux", "Au parc"]).snapshot.quiz.questions[0].cards.map((c) => c.word);
    const attendus = [...PICTO_WORDS.filter((w) => w.series === "Animaux").map((w) => w.word), "Toboggan"];
    assert.deepEqual([...animaux].sort(), attendus.sort(), "Animaux et la série ajoutée, rien d'autre");
    assert.equal(deck(null).snapshot.quiz.questions[0].cards.length, PICTO_WORDS.length + 2, "aucune série choisie : toutes");
    assert.equal(pictoSeriesOf({ word: "X" }), "Mes mots");
    const vide = deck(["Série effacée"]);
    assert.equal(vide.snapshot, null);
    assert.match(vide.problems[0], /aucun mot actif dans les séries choisies/);
  });

  test("Pictionary : la vraie photo d'un mot part avec sa carte et se copie avec les réponses en images", () => {
    const contents = { pictionary: { extra: [{ word: "Toboggan", image: "🛝" }], images: { toboggan: "0123456789abcdef", chat: "pas-une-photo" } } };
    const { snapshot } = buildSnapshot("s", { age: 9, rounds: [{ type: "pictionary" }] }, {}, {}, Math.random, {}, contents);
    const cards = snapshot.quiz.questions[0].cards;
    assert.deepEqual(cards.find((c) => c.word === "Toboggan"), { word: "Toboggan", image: "🛝", imageId: "0123456789abcdef" });
    assert.equal(cards.find((c) => c.word === "Chat")?.imageId, undefined, "une photo mal formée est ignorée");
    assert.deepEqual(choiceImageIds(snapshot.quiz.questions), ["0123456789abcdef"]);
  });

  test("tout retiré : la manche est signalée, jamais jouée vide", () => {
    const none = { quisuis: { off: activeItems("quisuis", {}).map((p) => p.answer.toLowerCase()) } };
    const { snapshot, problems } = buildSnapshot("s", { age: 9, rounds: [{ type: "quisuis" }] }, {}, {}, Math.random, {}, none);
    assert.equal(snapshot, null);
    assert.match(problems[0], /aucun personnage actif/);
  });

  test("nombre de questions : les premières du quiz ; sans nombre, tout le quiz", () => {
    const { snapshot } = buildSnapshot("s", { age: 9, rounds: [{ type: "quiz", quizId: "a", count: 2 }, { type: "finale", quizId: "a", count: 1 }] }, { a: quiz });
    assert.deepEqual(snapshot.quiz.questions.map((q) => [q.text, q.double]), [["Q1 ?", false], ["Q2 ?", false], ["Q1 ?", true]]);
    assert.equal(buildSnapshot("s", { age: 9, rounds: [{ type: "quiz", quizId: "a" }] }, { a: quiz }).snapshot.quiz.questions.length, 4);
  });

  test("les notes de la prestation partent avec le programme, pour la régie", () => {
    assert.equal(buildSnapshot("s", { age: 9, notes: "  Gâteau à 16 h  ", rounds: [{ type: "quiz", quizId: "a" }] }, { a: quiz }).snapshot.notes, "Gâteau à 16 h");
    assert.equal("notes" in buildSnapshot("s", { age: 9, rounds: [{ type: "quiz", quizId: "a" }] }, { a: quiz }).snapshot, false);
  });
});
