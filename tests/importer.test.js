// Import des quiz : texte Gemini, tableur, CSV, JSON, et anomalies signalées à la relecture.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseQuiz, checkQuestions, geminiPrompt, resolveCorrect, chatgptImagePrompt, chatgptUrl, imageKey, wordFromImage } from "../web/public/importer.js";
import { MIME_CATALOG } from "../web/public/mime-cards.js";
import { DISPARU_THEMES } from "../web/public/buzz-cards.js";
import { disparuObjects, activeItems, buildSnapshot, estimateMinutes, roundFilled,
  readiness, upcoming, daysUntil, isoDay, duplicateShow, programRounds, lockedUntil, gameQuestions, insertGame, moveRound, removeRound, uniqueRoundTitle,
  soundIds, choiceImageIds, choiceImageList, pictoSeriesList, pictoSeriesOf, foldLegacyFinale,
  roundQuizIds, MIME_RANDOM,
  statuesSongs, statuesChoices, roundSongs, isStatuesList,
} from "../web/public/show.js";
import { PICTO_WORDS, PICTO_SERIES } from "../web/public/picto-cards.js";
import { guessTrack, defaultStart, normalizeLevel } from "../web/public/audio.js";
import { FULL_SHOW, FULL_TUNES, tunePlaylist } from "../web/public/test-show.js";
import { cadrageInitial, borner, zoomer, zoneGardee, BULLES } from "../web/public/cadrage.js";
import { BANQUE_MOTS, QUESTIONS_PETITS, FAMILLES_PETITS, MODELES_PETITS, motBanque, cleMot, reponsesModele, fabriquerPetite, cataloguePetits, tirerPetits } from "../web/public/banque-petits.js";

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
    assert.match(prompt, /Niveau moyen/);
  });

  test("créer un quiz : la difficulté et les réponses en images changent la demande, sans nom d'IA dans la consigne", () => {
    const facile = geminiPrompt({ theme: "La ferme", age: 5, count: 6, difficulty: "facile", answers: "images" });
    assert.match(facile, /Niveau facile/);
    assert.match(facile, /ne savent pas encore lire : chaque proposition est un seul mot simple/);
    assert.match(facile, /jamais de Vrai \/ Faux/);
    assert.match(geminiPrompt({ difficulty: "difficile" }), /Niveau difficile/);
    assert.doesNotMatch(facile, /Gemini|ChatGPT/);
    assert.equal(chatgptUrl("Crée un quiz « La ferme »"), "https://chatgpt.com/?q=Cr%C3%A9e%20un%20quiz%20%C2%AB%20La%20ferme%20%C2%BB");
  });
});

describe("Super Finale", () => {
  test("une ancienne manche « Super Finale » devient le réglage ×2 du quiz qui la précède, jamais une manche à part", () => {
    const old = [{ type: "quiz", quizId: "a" }, { type: "chante", count: 3 }, { type: "finale", quizId: "f" }, { type: "portes", doors: 4 }];
    // Les Portes mystères enregistrées deviennent La bombe cachée (cedric, 20 octobre).
    assert.deepEqual(foldLegacyFinale(old), { rounds: [{ type: "quiz", quizId: "a", finale: 3 }, { type: "chante", count: 3 }, { type: "coffres" }], folded: 1, converted: 1 });
    assert.equal(old[0].finale, undefined, "l'original n'est pas modifié");
    // Un réglage déjà choisi est gardé ; sans quiz avant elle, elle devient une manche Quiz ordinaire.
    assert.deepEqual(foldLegacyFinale([{ type: "quiz", quizId: "a", finale: 2 }, { type: "finale", quizId: "f" }]).rounds, [{ type: "quiz", quizId: "a", finale: 2 }]);
    assert.deepEqual(foldLegacyFinale([{ type: "finale", quizId: "f" }]).rounds, [{ type: "quiz", quizId: "f", finale: 3 }]);
    assert.deepEqual(foldLegacyFinale([{ type: "mimes", deckId: "d" }, null]), { rounds: [{ type: "mimes", deckId: "d" }], folded: 0, converted: 0 });
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
    assert.equal(snapshot.quiz.intros, true, "chaque jeu de la prestation s'ouvre sur son écran de présentation");
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
  test("chansons cochées dans la liste des statues ou dans toutes les playlists : jouées dans l'ordre, à copier dans la partie ; retirées, ignorées", () => {
    const A = "0123456789abcdef", B = "fedcba9876543210", C = "00000000000000aa";
    const playlists = {
      danse: { title: "Chansons des statues musicales", use: "statues", duration: 60, tracks: [{ title: "Canards", audioId: A }, { title: "Tourner", audioId: B }, { title: "Pirates", audioId: C }] },
      blind: { title: "Dessins animés", duration: 25, tracks: [{ title: "Hakuna", audioId: "1111111111111111" }] },
    };
    const { snapshot } = buildSnapshot("s", { childName: "Léa", age: 7, rounds: [
      { type: "statues", duration: 90, songs: ["1111111111111111", C, A, "2222222222222222"] },
      { type: "statues", duration: 60, songs: [] },
    ] }, {}, {}, Math.random, playlists);
    const [avec, sans] = snapshot.quiz.questions;
    assert.deepEqual(avec.audioIds, [A, C, "1111111111111111"], "la liste des statues d'abord, puis les playlists ; une chanson retirée ignorée");
    assert.equal(sans.audioIds, undefined, "aucune chanson : la musique de la fête");
    assert.deepEqual(soundIds(snapshot.quiz.questions), [A, C, "1111111111111111"]);
    assert.deepEqual(statuesSongs(playlists).map((t) => t.title), ["Canards", "Tourner", "Pirates"], "cochées d'office : la liste des statues seule");
    assert.deepEqual(statuesChoices(playlists).map((t) => [t.title, t.list]), [
      ["Canards", "Chansons des statues"], ["Tourner", "Chansons des statues"], ["Pirates", "Chansons des statues"], ["Hakuna", "Dessins animés"],
    ], "au choix : toutes les playlists, chaque chanson une fois");
    assert.equal(isStatuesList(playlists.blind), false);
    assert.deepEqual(roundSongs({ songs: [B] }, playlists).map((t) => t.title), ["Tourner"]);
  });
});

describe("La bombe cachée", () => {
  const QUIZ = { title: "Quiz", questions: [{ text: "Roi ?", choices: ["Lion", "Tigre"], correct: 0, status: "validee" }] };
  test("rien à préparer, à la suite d'un quiz ; les anciennes Portes mystères se jouent en bombe cachée", () => {
    const show = { childName: "Léa", age: 9, rounds: [{ type: "quiz", quizId: "q" }, { type: "coffres" }, { type: "portes", doors: 3 }] };
    const { snapshot, problems } = buildSnapshot("s", show, { q: QUIZ });
    assert.deepEqual(problems, []);
    assert.deepEqual(snapshot.quiz.questions.map((q) => q.kind), ["classic", "coffres", "coffres"]);
    const bombes = snapshot.quiz.questions.filter((q) => q.kind === "coffres");
    // Exactement ce que lit la TV : pas de propositions, ni de contenu des coffres (tiré à l'ouverture).
    assert.deepEqual(bombes.map((q) => [q.text, q.round, q.correct, q.choices, q.doors]), Array(2).fill(["La bombe cachée", "La bombe cachée", -1, [], undefined]));
    assert.equal(new Set(snapshot.quiz.questions.map((q) => q.id)).size, snapshot.quiz.questions.length, "identifiants uniques");
    assert.equal(roundFilled({ type: "coffres" }), true, "rien à préparer");
    assert.equal(roundFilled({ type: "portes" }), true);
    assert.ok(estimateMinutes(snapshot) >= 10, "environ 5 minutes par bombe cachée");
  });
});

describe("Le Gonfleur fou", () => {
  test("rien à préparer : un seul élément, lu tel quel par la TV", () => {
    const quiz = { title: "Quiz", questions: [{ text: "Roi ?", choices: ["Lion", "Tigre"], correct: 0, status: "validee" }] };
    const { snapshot, problems } = buildSnapshot("s", { childName: "Léa", age: 9, rounds: [{ type: "quiz", quizId: "q" }, { type: "gonfleur" }] }, { q: quiz });
    assert.deepEqual(problems, []);
    const g = snapshot.quiz.questions.at(-1);
    assert.deepEqual([g.kind, g.text, g.round, g.correct, g.choices, g.duration], ["gonfleur", "Le Gonfleur fou", "Le Gonfleur fou", -1, [], 45]);
    assert.equal(roundFilled({ type: "gonfleur" }), true);
  });
});

describe("La Patate chaude", () => {
  test("rien à préparer : un seul élément, la mèche est tirée au sort par la box", () => {
    const quiz = { title: "Quiz", questions: [{ text: "Roi ?", choices: ["Lion", "Tigre"], correct: 0, status: "validee" }] };
    const { snapshot, problems } = buildSnapshot("s", { childName: "Léa", age: 9, rounds: [{ type: "quiz", quizId: "q" }, { type: "patate" }] }, { q: quiz });
    assert.deepEqual(problems, []);
    const p = snapshot.quiz.questions.at(-1);
    assert.deepEqual([p.kind, p.text, p.round, p.correct, p.choices], ["patate", "La Patate chaude", "La Patate chaude", -1, []]);
    assert.equal(roundFilled({ type: "patate" }), true);
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

describe("cartes et quiz choisis (à la volée et dans la Régie PC)", () => {
  const A = { title: "Animaux", questions: [
    { text: "Roi ?", choices: ["Lion", "Tigre"], correct: 0, status: "validee" },
    { text: "Le chat miaule", choices: ["Vrai", "Faux"], correct: 0, status: "validee" },
  ] };
  const B = { title: "Espace", questions: [{ text: "La Lune est une planète", choices: ["Vrai", "Faux"], correct: 1, status: "validee" }] };

  test("plusieurs quiz dans un même jeu : leurs questions à la suite, dans l'ordre choisi, jamais au hasard", () => {
    const show = { childName: "Léa", age: 9, rounds: [{ type: "quiz", quizId: "b", quizIds: ["b", "a"] }] };
    for (let k = 0; k < 3; k++) {
      const { snapshot, problems } = buildSnapshot("s", show, { a: A, b: B });
      assert.deepEqual(problems, []);
      assert.deepEqual(snapshot.quiz.questions.map((q) => [q.text, q.round]), [
        ["La Lune est une planète", "Espace + Animaux"], ["Roi ?", "Espace + Animaux"], ["Le chat miaule", "Espace + Animaux"]]);
      assert.deepEqual(snapshot.rounds, [{ title: "Espace + Animaux", count: 3 }]);
    }
    // Vrai ou Faux express sur deux quiz : les affirmations des deux ; « les N premières » compte sur l'ensemble.
    const vf = buildSnapshot("s", { age: 9, rounds: [{ type: "express", quizIds: ["a", "b"], count: 2 }] }, { a: A, b: B }).snapshot.quiz.questions;
    assert.deepEqual(vf.map((q) => [q.kind, q.text]), [["express", "Le chat miaule"], ["express", "La Lune est une planète"]]);
    assert.deepEqual(roundQuizIds({ quizId: "a" }), ["a"]);
    assert.deepEqual(roundQuizIds({ quizId: "a", quizIds: { 0: "a", 1: "b", 2: "a" } }), ["a", "b"], "Lu dans la base (objet), sans doublon");
    assert.equal(roundFilled({ type: "zoom", quizIds: ["a"] }), true);
  });

  test("un des quiz choisis supprimé : signalé, les autres se jouent quand même", () => {
    const { snapshot, problems } = buildSnapshot("s", { age: 9, rounds: [{ type: "quiz", quizIds: ["a", "parti"] }] }, { a: A });
    assert.match(problems[0], /un des quiz choisis n'existe plus/);
    assert.equal(snapshot.quiz.questions.length, 2);
  });

  test("Mimes au hasard : cartes du catalogue selon l'âge, sans paquet à préparer", () => {
    const petits = buildSnapshot("s", { age: 7, rounds: [{ type: "mimes", random: true }] }, {}, {}).snapshot.quiz.questions[0];
    assert.equal(petits.kind, "mime");
    assert.equal(petits.round, "Mimes");
    assert.equal(petits.cards.length, MIME_RANDOM);
    const easy = new Set(MIME_CATALOG.filter((c) => c.level === 1).map((c) => c.word));
    assert.ok(petits.cards.every((c) => easy.has(c.word)), "Pas de carte difficile pour les Petits");
    assert.equal(new Set(petits.cards.map((c) => c.word)).size, MIME_RANDOM, "Pas de doublon");
    assert.equal(roundFilled({ type: "mimes", random: true }), true);
    assert.equal(roundFilled({ type: "mimes" }), false);
  });

  test("cartes de mimes choisies : la manche joue exactement celles-là, même si le paquet a disparu", () => {
    const cards = [{ word: "Chat", image: "🐱" }, { word: "Le chat de Léa" }, { word: " " }];
    const one = buildSnapshot("s", { age: 9, rounds: [{ type: "mimes", random: true, cards }] }, {}, {}).snapshot.quiz.questions[0];
    assert.deepEqual(one.cards.map((c) => c.word).sort(), ["Chat", "Le chat de Léa"]);
    const lost = buildSnapshot("s", { age: 9, rounds: [{ type: "mimes", deckId: "parti", cards }] }, {}, {});
    assert.deepEqual(lost.problems, []);
    assert.equal(lost.snapshot.quiz.questions[0].cards.length, 2);
  });

  test("jeux intégrés : éléments choisis un par un, joués dans cet ordre (même un mot « grands » chez les Petits)", () => {
    const show = { age: 7, rounds: [{ type: "chante", count: 6, picks: ["Bonheur", "soleil", "inconnu"] }] };
    const { snapshot, problems } = buildSnapshot("s", show, {}, {});
    assert.deepEqual(problems, []);
    assert.deepEqual(snapshot.quiz.questions.map((q) => q.text), ["bonheur", "soleil"]);
    // Plus rien de choisi n'existe : tirage au hasard comme avant, la fête n'est jamais bloquée.
    const lost = buildSnapshot("s", { age: 9, rounds: [{ type: "chante", count: 4, picks: ["inconnu"] }] }, {}, {}).snapshot.quiz.questions;
    assert.equal(lost.length, 4);
    const disparu = buildSnapshot("s", { age: 9, rounds: [{ type: "disparu", picks: [DISPARU_THEMES[1].theme.toLowerCase()] }] }, {}, {}).snapshot.quiz.questions;
    assert.equal(disparu.length, 1);
    assert.ok(DISPARU_THEMES[1].objects.some((o) => o.word === disparu[0].choices[0]));
  });

  test("Pictionary : mots choisis un par un, les seuls du paquet", () => {
    const words = PICTO_WORDS.slice(0, 3).map((w) => w.word.toLowerCase());
    const q = buildSnapshot("s", { age: 9, rounds: [{ type: "pictionary", series: ["Rien"], picks: words }] }, {}, {}).snapshot.quiz.questions[0];
    assert.deepEqual(q.cards.map((c) => c.word.toLowerCase()).sort(), [...words].sort());
  });

  test("à la volée : un jeu ajouté depuis la régie suit les mêmes règles", () => {
    const { questions } = gameQuestions({ type: "flou", quizIds: ["a", "b"] }, {
      a: { title: "A", questions: [{ text: "Qui ?", choices: ["Chat", "Chien"], correct: 0, status: "validee", imageId: "0123456789abcdef" }] },
      b: { title: "B", questions: [{ text: "Quoi ?", choices: ["Tour", "Pont"], correct: 1, status: "validee", imageId: "fedcba9876543210" }] },
    }, "MOYENS", "x");
    assert.deepEqual(questions.map((q) => [q.kind, q.id, q.imageId]), [["flou", "xq1", "0123456789abcdef"], ["flou", "xq2", "fedcba9876543210"]]);
    const mimes = gameQuestions({ type: "mimes", random: true }, {}, "GRANDS", "x").questions;
    assert.equal(mimes[0].cards.length, MIME_RANDOM);
  });
});

describe("cadrage des images comme sur la TV", () => {
  test("l'image remplit toujours la bulle, centrée ; on ne peut pas la sortir de la bulle", () => {
    // Photo en paysage 1200 × 600 dans une vignette carrée de 300 px : hauteur ajustée, centrée en largeur.
    const c = cadrageInitial(1200, 600, 300, 300);
    assert.equal(c.base, 0.5);
    assert.deepEqual([c.x, c.y], [-150, 0]);
    assert.deepEqual(zoneGardee(c, 300, 300), { sx: 300, sy: 0, sw: 600, sh: 600 });
    // Glissée trop loin : arrêtée au bord, jamais de vide dans la bulle.
    const loin = borner({ ...c, x: 200, y: 50 }, 1200, 600, 300, 300);
    assert.deepEqual([loin.x, loin.y], [0, 0]);
    const autre = borner({ ...c, x: -1000 }, 1200, 600, 300, 300);
    assert.equal(autre.x, -300);
    assert.deepEqual(zoneGardee(autre, 300, 300), { sx: 600, sy: 0, sw: 600, sh: 600 });
  });
  test("zoom autour de la souris, entre 1 et 4 fois ; bulle de révélation en 4:3", () => {
    const c = cadrageInitial(800, 600, 400, 300);
    const z = zoomer(c, 2, 200, 150, 800, 600, 400, 300);
    assert.equal(z.zoom, 2);
    assert.deepEqual(zoneGardee(z, 400, 300), { sx: 200, sy: 150, sw: 400, sh: 300 }, "le centre reste au centre");
    assert.equal(zoomer(c, 10, 0, 0, 800, 600, 400, 300).zoom, 4);
    assert.equal(zoomer(c, 0.2, 0, 0, 800, 600, 400, 300).zoom, 1);
    assert.equal(BULLES.revelation.ratio, 4 / 3);
    assert.equal(BULLES.vignette.width, BULLES.vignette.height);
  });
});

describe("banque des tout-petits", () => {
  test("chaque réponse est un mot de la banque, 4 réponses différentes, pas de question en double", () => {
    assert.ok(QUESTIONS_PETITS.length >= 100, `${QUESTIONS_PETITS.length} questions`);
    for (const q of QUESTIONS_PETITS) {
      assert.equal(new Set(q.choices).size, 4, q.text);
      assert.ok(q.choices.every((c) => motBanque(c)), `${q.text} : ${q.choices.filter((c) => !motBanque(c))}`);
      assert.ok(FAMILLES_PETITS[q.famille], q.famille);
    }
    assert.equal(new Set(QUESTIONS_PETITS.map((q) => q.text)).size, QUESTIONS_PETITS.length);
    assert.equal(new Set(QUESTIONS_PETITS.map((q) => q.id)).size, QUESTIONS_PETITS.length);
    assert.equal(new Set(BANQUE_MOTS.map((m) => m.cle)).size, BANQUE_MOTS.length, "un nom de photo par mot");
    assert.ok(BANQUE_MOTS.length >= 380, `${BANQUE_MOTS.length} mots`);
    assert.ok(BANQUE_MOTS.every((m) => FAMILLES_PETITS[m.famille] && ["le", "la", "l'", "les"].includes(m.article) && m.emoji && m.recherche), "mot complet");
    assert.equal(cleMot("Pomme de terre"), "pomme-de-terre");
    assert.equal(cleMot("Œuf"), "oeuf");
    assert.equal(cleMot("Éléphant"), "elephant");
  });

  test("questions fabriquées : chaque modèle a ses bonnes et mauvaises réponses, jamais deux mots trop proches", () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (const md of MODELES_PETITS) {
      const { bonnes, mauvaises } = reponsesModele(md);
      assert.ok(bonnes.length >= 2 && mauvaises.length >= 3, md.id);
      for (const m of bonnes) {
        const q = fabriquerPetite(md.id, m, rng);
        assert.ok(q, `${md.id} : ${m.mot}`);
        assert.equal(new Set(q.choices).size, 4);
        // Aucune mauvaise réponse ne répond aussi à la question.
        assert.ok(q.choices.slice(1).every((c) => !bonnes.includes(motBanque(c))), `${q.text} ${q.choices}`);
      }
    }
    // Les vrais pièges sont exclus : le manchot ne vole pas, le canard n'est ni l'un ni l'autre.
    const vole = reponsesModele(MODELES_PETITS.find((md) => md.id === "vole"));
    assert.ok(vole.bonnes.some((m) => m.mot === "Avion") && vole.mauvaises.some((m) => m.mot === "Manchot"));
    assert.ok(![...vole.bonnes, ...vole.mauvaises].some((m) => m.mot === "Canard"));
    // « Où est … ? » pour chaque mot, avec le bon article, et jamais avec un mot qui lui ressemble trop.
    assert.equal(fabriquerPetite("ou", motBanque("Éléphant"), rng).text, "Où est l'éléphant ?");
    assert.equal(fabriquerPetite("ou", motBanque("Frites"), rng).text, "Où sont les frites ?");
    assert.equal(fabriquerPetite("ou", motBanque("Pomme de terre"), rng).text, "Où est la pomme de terre ?");
    for (let i = 0; i < 30; i++) {
      const q = fabriquerPetite("ou", motBanque("Chaussure"), rng);
      assert.ok(!q.choices.some((c) => ["Bottes", "Sandales", "Pantoufles"].includes(c)), q.choices.join());
    }
    for (const m of BANQUE_MOTS) assert.ok(fabriquerPetite("ou", m, rng), m.mot);
    const catalogue = cataloguePetits(rng);
    assert.ok(catalogue.length >= 2000, `${catalogue.length} questions`);
    assert.equal(new Set(catalogue.map((q) => q.id)).size, catalogue.length);
    assert.ok(catalogue.every((q) => q.choices.length === 4 && q.choices.every((c) => motBanque(c)) && FAMILLES_PETITS[q.famille]));
  });

  test("10 au hasard : variées, sans doublon de texte ni de bonne réponse, dans le thème choisi, sans ce qui est déjà pris", () => {
    let seed = 11;
    const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const catalogue = cataloguePetits(rng);
    for (let i = 0; i < 50; i++) {
      const tirage = tirerPetits(10, { rng, catalogue });
      assert.equal(tirage.length, 10);
      assert.equal(new Set(tirage.map((q) => q.text)).size, 10);
      assert.equal(new Set(tirage.map((q) => q.choices[0])).size, 10);
    }
    const sortes = new Set(Array.from({ length: 20 }, () => tirerPetits(10, { rng, catalogue })).flat()
      .map((q) => (!q.fabriquee ? "rédigée" : q.id.startsWith("g-ou-") ? "où" : "modèle")));
    assert.deepEqual([...sortes].sort(), ["modèle", "où", "rédigée"]);
    for (const famille of Object.keys(FAMILLES_PETITS)) {
      const tirage = tirerPetits(10, { famille, rng, catalogue });
      assert.ok(tirage.length >= 8 && tirage.every((q) => q.famille === famille), famille);
    }
    const exclus = new Set(QUESTIONS_PETITS.map((q) => q.text));
    assert.ok(tirerPetits(10, { exclus, rng, catalogue }).every((q) => q.fabriquee));
  });
});

describe("collections, manches et prestation", async () => {
  const M = await import("../web/public/manches.js");
  const S = await import("../web/public/show.js");
  const seq = () => { let i = 0; return () => ((i++ * 0.618) % 1); };
  const lib = {
    mimes: { d1: { title: "Mes animaux", duration: 60, cards: [{ word: "Dragon volant", image: "🐉" }, { word: "Chat", image: "🐱" }] } },
    quizzes: {
      q1: { title: "Photos", questions: [
        { text: "Qui est-ce ?", choices: ["Lion", "Tigre"], correct: 0, status: "validee", imageId: "a".repeat(16) },
        { text: "Et lui ?", choices: ["Chat", "Chien"], correct: 1, status: "validee", imageId: "b".repeat(16) },
      ] },
    },
    playlists: {
      p1: { title: "Disney", duration: 20, points: 120, tracks: [{ title: "Libérée", audioId: "1".repeat(16) }, { title: "Hakuna", audioId: "2".repeat(16), duration: 30 }] },
      p2: { title: "Années 80", duration: 25, tracks: [{ title: "Thriller", audioId: "3".repeat(16) }] },
      s: { title: "Statues", use: "statues", duration: 60, tracks: [{ title: "Danse", audioId: "4".repeat(16) }] },
    },
    contents: {},
  };

  test("la collection des mimes : le catalogue par catégories, puis les cartes de Sarah, sans doublon", () => {
    const items = M.collectionItems("mimes", lib);
    assert.ok(M.collectionGroups(items).includes("Animaux"));
    assert.ok(M.collectionGroups(items).includes("Mes animaux"));
    assert.equal(items.filter((x) => x.key === "chat").length, 1, "le Chat du paquet n'est pas compté deux fois");
    assert.equal(items.find((x) => x.key === "dragon volant").group, "Mes animaux");
  });

  test("photos (Zoom, Image floue) et extraits (blind test) : toutes les collections, rangées par quiz ou playlist", () => {
    assert.deepEqual(M.collectionItems("zoom", lib).map((x) => [x.label, x.group]), [["Lion", "Photos"], ["Chien", "Photos"]]);
    const tracks = M.collectionItems("blind", lib);
    assert.deepEqual(tracks.map((x) => x.group), ["Années 80", "Disney", "Disney"], "les chansons des statues n'y sont pas");
    // Statues : la liste des statues d'abord, puis les chansons de toutes les playlists.
    assert.deepEqual(M.collectionItems("statues", lib).map((x) => [x.label, x.group]),
      [["Danse", "Chansons des statues"], ["Thriller", "Années 80"], ["Libérée", "Disney"], ["Hakuna", "Disney"]]);
  });

  test("manche au hasard : catégories, difficulté, jamais un élément déjà joué, collection épuisée signalée", () => {
    const { round } = M.randomRound("mimes", lib, { groups: ["Animaux"], level: "facile", count: 8 }, seq());
    assert.equal(round.cards.length, 8);
    const animaux = new Set(MIME_CATALOG.filter((c) => c.theme === "Animaux" && c.level === 1).map((c) => c.word));
    assert.ok(round.cards.every((c) => animaux.has(c.word)));
    const avoid = new Set(round.cards.map((c) => c.word.toLowerCase()));
    const next = M.randomRound("mimes", lib, { groups: ["Animaux"], level: "facile", count: 8, avoid }, seq());
    assert.ok(next.round.cards.every((c) => !avoid.has(c.word.toLowerCase())), "rejouer : d'autres cartes");
    const all = new Set(M.collectionItems("mimes", lib).map((x) => x.key));
    const none = M.randomRound("mimes", lib, { avoid: all }, seq());
    assert.equal(none.round, null);
    assert.equal(none.exhausted, true);
    const few = M.randomRound("zoom", lib, { count: 6 }, seq());
    assert.equal(few.count, 2);
    assert.equal(few.exhausted, true, "seulement 2 photos : c'est dit");
  });

  test("Petits : pas de carte difficile ; « difficile » met les plus dures d'abord", () => {
    const petits = M.randomRound("mimes", lib, { profile: "PETITS", count: 40 }, seq()).round.cards;
    const hard = new Set(MIME_CATALOG.filter((c) => c.level === 2).map((c) => c.word));
    assert.ok(petits.every((c) => !hard.has(c.word)));
    const dur = M.randomRound("mimes", lib, { level: "difficile", count: 3 }, seq()).round.cards;
    assert.ok(dur.every((c) => hard.has(c.word)));
  });

  test("mimes : cartes par équipe × équipes prévues, plus une réserve pour deux équipes de plus, aucune en double", () => {
    const round = { type: "mimes", cards: MIME_CATALOG.slice(0, 12).map((c) => ({ word: c.word, image: c.image })), perTeam: 3 };
    const { snapshot } = S.buildSnapshot("s", { teams: 4, rounds: [round] }, {}, {}, seq());
    const cards = snapshot.quiz.questions[0].cards;
    assert.equal(cards.length, 3 * (4 + 2));
    assert.equal(new Set(cards.map((c) => c.word)).size, cards.length);
    assert.ok(round.cards.every((c) => cards.slice(0, 12).some((x) => x.word === c.word)), "les cartes choisies passent d'abord");
    const sans = S.buildSnapshot("s", { rounds: [{ type: "mimes", cards: round.cards }] }, {}, {}, seq()).snapshot.quiz.questions[0].cards;
    assert.equal(sans.length, 12, "sans cartes par équipe : la liste telle quelle");
  });

  test("photos choisies une par une et extraits de plusieurs playlists se jouent", () => {
    const zoom = S.buildSnapshot("s", { rounds: [{ type: "flou", picks: ["b".repeat(16), "a".repeat(16)] }] }, lib.quizzes).snapshot.quiz.questions;
    assert.deepEqual(zoom.map((q) => [q.kind, q.choices[q.correct]]), [["flou", "Chien"], ["flou", "Lion"]]);
    const blind = S.buildSnapshot("s", { rounds: [{ type: "blind", tracks: ["3".repeat(16), "2".repeat(16)] }] }, {}, {}, seq(), lib.playlists).snapshot.quiz.questions;
    assert.deepEqual(blind.map((q) => [q.choices[0], q.duration]), [["Thriller", 25], ["Hakuna", 30]]);
    assert.ok(S.roundFilled({ type: "blind", tracks: ["3".repeat(16)] }));
    assert.ok(S.roundFilled({ type: "zoom", picks: ["a".repeat(16)] }));
  });

  test("ce qui a été joué pendant la fête n'est plus tiré, jeu par jeu", () => {
    const show = { rounds: [{ type: "mimes", cards: [{ word: "Chat" }, { word: "Lion" }] }, { type: "chante", picks: ["soleil", "maman"] }, { type: "flou", picks: ["a".repeat(16)] }, { type: "blind", tracks: ["1".repeat(16)] }] };
    const played = M.playedKeys(S.buildSnapshot("s", show, lib.quizzes, {}, seq(), lib.playlists).snapshot.quiz.questions);
    assert.deepEqual([...played.mimes].sort(), ["chat", "lion"]);
    assert.deepEqual([...played.chante].sort(), ["maman", "soleil"]);
    assert.deepEqual([...played.photos], ["a".repeat(16)]);
    assert.deepEqual([...played.tracks], ["1".repeat(16)]);
    const chante = S.gameQuestions({ type: "chante", count: 30 }, {}, null, "z", {}, {}, {}, played).questions;
    assert.ok(chante.every((q) => !played.chante.has(q.choices[0].toLowerCase())));
    const disparu = S.buildSnapshot("s", { rounds: [{ type: "disparu", picks: ["fruits"], count: 1 }] }, {}, {}, seq()).snapshot.quiz.questions;
    assert.deepEqual([...M.playedKeys(disparu).disparu], ["fruits"]);
  });

  test("rejouer avec d'autres : mêmes réglages, autant d'éléments, rien de déjà joué", () => {
    const base = { type: "pictionary", duration: 60, series: ["Animaux"], picks: ["chat", "chien", "poisson"] };
    const { round } = M.randomRound("pictionary", lib, { base, avoid: new Set(base.picks) }, seq());
    assert.equal(round.duration, 60);
    assert.deepEqual(round.series, ["Animaux"]);
    assert.equal(round.picks.length, 3);
    assert.ok(round.picks.every((k) => !base.picks.includes(k)));
  });

  test("manche propre : seulement les champs du jeu, le lien vers la manche d'origine gardé", () => {
    assert.deepEqual(M.cleanRound({ type: "mimes", cards: [{ word: " Chat ", image: "🐱", x: 1 }], perTeam: 3, duration: 45, mancheId: "m1", junk: true }),
      { type: "mimes", cards: [{ word: "Chat", image: "🐱" }], perTeam: 3, duration: 45, mancheId: "m1" });
    assert.deepEqual(M.cleanRound({ type: "blind", tracks: ["1".repeat(16), "bad"], playlistId: "p1" }), { type: "blind", tracks: ["1".repeat(16)] });
    assert.deepEqual(M.cleanRound({ type: "zoom", picks: ["A".repeat(16)], quizId: "q1" }), { type: "zoom", picks: ["a".repeat(16)] });
    assert.deepEqual(M.cleanRound({ type: "quiz", quizIds: ["q1", "q2"], finale: 3 }), { type: "quiz", quizId: "q1", quizIds: ["q1", "q2"], finale: 3 });
    assert.deepEqual(M.cleanRound({ type: "patate", count: 9 }), { type: "patate" });
  });

  test("page Manches d'un jeu : épinglées, puis les plus récentes, puis les archivées", () => {
    const g = M.mancheGroups({
      a: { type: "mimes", round: { type: "mimes" }, updatedAt: 1 },
      b: { type: "mimes", round: { type: "mimes" }, updatedAt: 3 },
      c: { type: "mimes", round: { type: "mimes" }, pinned: true, updatedAt: 2 },
      d: { type: "mimes", round: { type: "mimes" }, archived: true },
      e: { type: "quiz", round: { type: "quiz" } },
    }, "mimes");
    assert.deepEqual([g.pinned, g.active, g.archived].map((l) => l.map(([id]) => id)), [["c"], ["b", "a"], ["d"]]);
    assert.equal(M.mancheSummary({ type: "mimes", cards: [{ word: "A" }, { word: "B" }], perTeam: 3, duration: 45 }), "2 cartes · 3 par équipe · tour de 45 s");
    assert.equal(M.questionType({ kind: "classic", audioId: "1".repeat(16) }), "musical");
    assert.equal(M.questionType({ kind: "mime" }), "mimes");
  });
});
