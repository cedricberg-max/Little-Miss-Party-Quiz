// Import des quiz : texte Gemini, tableur, CSV, JSON, et anomalies signalées à la relecture.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseQuiz, checkQuestions, geminiPrompt, resolveCorrect } from "../web/public/importer.js";
import { MIME_CATALOG } from "../web/public/mime-cards.js";
import { buildSnapshot, estimateMinutes,
  readiness, upcoming, daysUntil, isoDay, duplicateShow, programRounds, lockedUntil, gameQuestions, insertGame, moveRound, removeRound, uniqueRoundTitle,
} from "../web/public/show.js";

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
