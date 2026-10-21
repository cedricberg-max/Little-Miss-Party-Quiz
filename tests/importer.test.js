// Import des quiz : texte Gemini, tableur, CSV, JSON, et anomalies signalées à la relecture.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { parseQuiz, checkQuestions, geminiPrompt, resolveCorrect, chatgptImagePrompt, chatgptUrl, imageKey, wordFromImage } from "../web/public/importer.js";
import { MIME_CATALOG } from "../web/public/mime-cards.js";
import { DISPARU_THEMES } from "../web/public/buzz-cards.js";
import { disparuObjects, activeItems, buildSnapshot, estimateMinutes, roundFilled,
  readiness, upcoming, daysUntil, isoDay, duplicateShow, etatPrestation, isArchived, ETATS, programRounds, lockedUntil, gameQuestions, insertGame, moveRound, removeRound, uniqueRoundTitle,
  soundIds, choiceImageIds, choiceImageList, pictoSeriesList, pictoSeriesOf, foldLegacyFinale,
  roundQuizIds, MIME_RANDOM, alerteEquipes, EQUIPES_PAR_DEFAUT, PAR_EQUIPE_MIN,
  statuesSongs, statuesChoices, roundSongs, isStatuesList,
} from "../web/public/show.js";
import { PICTO_WORDS, PICTO_SERIES } from "../web/public/picto-cards.js";
import { guessTrack, normalizeLevel } from "../web/public/audio.js";
import { songList, songsRetirees, songMatches, trackFromSong, songUpdates, defaultRefrain, buzzOf, REFRAIN_SEC } from "../web/public/sons.js";
import { lireLrc, refrainDesParoles, debutDesParoles, parolesDuRefrain, associerParoles, nomSimple } from "../web/public/paroles.js";
import { lireId3 } from "../web/public/id3.js";
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
    // Les Portes mystères enregistrées deviennent les Coffres mystères (cedric, 20 octobre).
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

describe("équipes d'une prestation (cedric, 21/10)", () => {
  const mots = (n) => PICTO_WORDS.slice(0, n).map((w) => w.word.toLowerCase());
  const cartes = (n) => MIME_CATALOG.slice(0, n).map((c) => ({ word: c.word, image: c.image }));

  test("4 équipes par défaut, au moins 3 mots ou cartes par équipe", () => {
    assert.equal(EQUIPES_PAR_DEFAUT, 4);
    assert.equal(PAR_EQUIPE_MIN, 3);
  });

  test("Pictionary choisi à la main : alerte sous 3 mots par équipe, jamais pour un tirage au hasard", () => {
    assert.equal(alerteEquipes({ type: "pictionary" }, 8), null, "Mots au hasard : tous les mots actifs");
    assert.equal(alerteEquipes({ type: "pictionary", picks: mots(12) }, 4), null);
    assert.equal(alerteEquipes({ type: "pictionary", picks: mots(11) }, 4), "Pictionary : 11 mots choisis pour 4 équipes, il en faut au moins 12 (3 par équipe).");
    assert.equal(alerteEquipes({ type: "pictionary", picks: mots(1) }, 2), "Pictionary : 1 mot choisi pour 2 équipes, il en faut au moins 6 (3 par équipe).");
    assert.match(alerteEquipes({ type: "pictionary", picks: mots(6) }, null), /pour 4 équipes/, "Nombre non indiqué : 4 équipes");
    assert.equal(alerteEquipes({ type: "pictionary", picks: ["pas-un-mot"] }, 8), null, "Aucun mot actif choisi : tirage au hasard");
  });

  test("Mimes : la liste telle quelle peut manquer, les cartes par équipe se complètent au lancement", () => {
    assert.equal(alerteEquipes({ type: "mimes", cards: cartes(5), perTeam: 3 }, 8), null, "Complétée au hasard au lancement");
    assert.equal(alerteEquipes({ type: "mimes" }, 8), null, `${MIME_RANDOM} cartes au hasard`);
    assert.equal(alerteEquipes({ type: "mimes", cards: cartes(9) }, 3), null);
    assert.equal(alerteEquipes({ type: "mimes", cards: cartes(8) }, 3), "Mimes : 8 cartes pour 3 équipes, il en faut au moins 9 (3 par équipe).");
    const paquet = { p1: { title: "Animaux", cards: cartes(4) } };
    assert.match(alerteEquipes({ type: "mimes", deckId: "p1" }, 2, { mimes: paquet }), /^Mimes : 4 cartes pour 2 équipes/);
  });

  test("Ça va exploser ! : 2 équipes au moins ; les autres jeux n'ont pas d'alerte", () => {
    assert.match(alerteEquipes({ type: "patate" }, 1), /2 équipes au moins/);
    assert.equal(alerteEquipes({ type: "patate" }, 2), null);
    for (const type of ["quiz", "coffres", "gonfleur", "blind", "statues"]) assert.equal(alerteEquipes({ type }, 1), null, type);
  });
});

describe("tableau de bord des prestations", () => {
  const QUIZ = { title: "Animaux", questions: [{ text: "Roi ?", choices: ["Lion", "Tigre"], correct: 0, status: "validee" }] };
  const DRAFT = { title: "Brouillon", questions: [{ text: "?", choices: ["A", "B"], correct: 0, status: "brouillon" }] };
  const quizzes = { animaux: QUIZ, draft: DRAFT };

  test("état de préparation : prête seulement quand tout est complet et visible sur la régie", () => {
    const ok = { childName: "Léa", age: 7, date: "2026-12-02", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }] };
    assert.deepEqual(readiness(ok, quizzes), { level: "prete", todo: [] });
    assert.deepEqual(readiness({ ...ok, status: "brouillon" }, quizzes).todo, ["Passer le statut à « À venir »"]);
    assert.deepEqual(readiness({ childName: "Tom", status: "brouillon" }, quizzes).todo, ["Ajouter la date", "Indiquer l'âge", "Ajouter une manche"]);
    const draftOnly = readiness({ ...ok, rounds: [{ type: "quiz", quizId: "draft" }] }, quizzes);
    assert.equal(draftOnly.level, "a-completer");
    assert.match(draftOnly.todo.join(), /aucune question validée/);
    assert.match(readiness({ ...ok, rounds: [{ type: "quiz", quizId: "efface" }] }, quizzes).todo.join(), /n'existe plus/);
    assert.equal(readiness({ ...ok, status: "archivee" }, quizzes).level, "archivee");
  });

  test("trois états, mêmes mots partout : À compléter, À venir, Archivée ; archivée toute seule le lendemain de la fête", () => {
    assert.deepEqual(ETATS, { avenir: "À venir", acompleter: "À compléter", archivee: "Archivée" });
    const fete = { childName: "Léa", date: "2026-10-25", status: "publiee" };
    assert.equal(etatPrestation(fete, "2026-10-24"), "avenir");
    assert.equal(etatPrestation(fete, "2026-10-25"), "avenir", "le jour de la fête, elle reste sur la régie");
    assert.equal(etatPrestation(fete, "2026-10-26"), "archivee", "le lendemain, archivée : plus de trou de 2 jours");
    assert.equal(etatPrestation({ ...fete, status: "brouillon" }, "2026-10-24"), "acompleter");
    assert.equal(etatPrestation({ childName: "Tom", status: "brouillon" }, "2026-10-24"), "acompleter", "sans date : à compléter");
    assert.equal(etatPrestation({ ...fete, status: "archivee" }, "2026-10-01"), "archivee", "archivée à la main avant la date");
    // Désarchivée à la main après sa date : elle ne repart pas toute seule dans les archives.
    assert.equal(isArchived({ ...fete, status: "brouillon", keepActive: true }, "2026-11-30"), false);
    // « À venir » demande une date à venir : une date passée est signalée (sinon elle filerait dans les archives).
    const ok = { childName: "Léa", age: 7, date: "2026-10-20", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }] };
    assert.deepEqual(readiness({ ...ok, keepActive: true }, quizzes, {}, {}, {}, "2026-10-21").todo, ["Choisir une date à venir (celle-ci est passée)"]);
    assert.deepEqual(readiness(ok, quizzes, {}, {}, {}, "2026-10-20"), { level: "prete", todo: [] });
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
    // Avant sa date (elle s'archive toute seule le lendemain de la fête) : prête.
    assert.equal(readiness(TEST_SHOW, quizzes, {}, {}, {}, "2026-10-21").level, "prete");
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
      { title: "Hakuna Matata", artist: "Le Roi lion", audioId: ID(1), refrainId: ID(5), paroles: "0|Hakuna matata" },
      { title: "Sous l'océan", audioId: ID(2), paroles: "0|Sans refrain, pas de paroles" },
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
    // Paroles du refrain : dans la question, seulement avec le refrain.
    assert.equal(blind.find((q) => q.choices[0] === "Hakuna Matata").lyrics, "0|Hakuna matata");
    assert.equal(blind.find((q) => q.choices[0] === "Sous l'océan").lyrics, undefined);
    assert.ok(musical.every((q) => q.choices.length === 4 && new Set(q.choices).size === 4 && q.audioId));
    for (const q of musical) {
      const track = playlist.tracks.find((t) => t.audioId === q.audioId);
      assert.equal(q.choices[q.correct], track.title, "la bonne réponse est le titre de l'extrait joué");
    }
    assert.deepEqual(programRounds(qs).map((r) => r.title), ["Blind test · Dessins animés", "Quiz musical · Dessins animés"]);
    assert.equal(soundIds(qs).length, 5, "4 extraits et 1 refrain");
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
  test("titre et artiste devinés depuis le nom du fichier", () => {
    assert.deepEqual(guessTrack("Stromae - Alors on danse.mp3"), { artist: "Stromae", title: "Alors on danse" });
    assert.deepEqual(guessTrack("03 - Angèle – Balance ton quoi.m4a"), { artist: "Angèle", title: "Balance ton quoi" });
    assert.deepEqual(guessTrack("libérée_délivrée.wav"), { artist: "", title: "libérée délivrée" });
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

describe("Les Coffres mystères", () => {
  const QUIZ = { title: "Quiz", questions: [{ text: "Roi ?", choices: ["Lion", "Tigre"], correct: 0, status: "validee" }] };
  test("rien à préparer, à la suite d'un quiz ; les anciennes Portes mystères se jouent en coffres mystères", () => {
    const show = { childName: "Léa", age: 9, rounds: [{ type: "quiz", quizId: "q" }, { type: "coffres" }, { type: "portes", doors: 3 }] };
    const { snapshot, problems } = buildSnapshot("s", show, { q: QUIZ });
    assert.deepEqual(problems, []);
    assert.deepEqual(snapshot.quiz.questions.map((q) => q.kind), ["classic", "coffres", "coffres"]);
    const bombes = snapshot.quiz.questions.filter((q) => q.kind === "coffres");
    // Exactement ce que lit la TV : pas de propositions, ni de contenu des coffres (tiré à l'ouverture).
    assert.deepEqual(bombes.map((q) => [q.text, q.round, q.correct, q.choices, q.doors]), Array(2).fill(["Les Coffres mystères", "Les Coffres mystères", -1, [], undefined]));
    assert.equal(new Set(snapshot.quiz.questions.map((q) => q.id)).size, snapshot.quiz.questions.length, "identifiants uniques");
    assert.equal(roundFilled({ type: "coffres" }), true, "rien à préparer");
    assert.equal(roundFilled({ type: "portes" }), true);
    assert.ok(estimateMinutes(snapshot) >= 10, "environ 5 minutes par partie de coffres mystères");
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

describe("Ça va exploser !", () => {
  test("rien à préparer : un seul élément, la mèche est tirée au sort par la box", () => {
    const quiz = { title: "Quiz", questions: [{ text: "Roi ?", choices: ["Lion", "Tigre"], correct: 0, status: "validee" }] };
    const { snapshot, problems } = buildSnapshot("s", { childName: "Léa", age: 9, rounds: [{ type: "quiz", quizId: "q" }, { type: "patate" }] }, { q: quiz });
    assert.deepEqual(problems, []);
    const p = snapshot.quiz.questions.at(-1);
    assert.deepEqual([p.kind, p.text, p.round, p.correct, p.choices], ["patate", "Ça va exploser !", "Ça va exploser !", -1, []]);
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

describe("Quiz illustré : un jeu à part, les quiz à réponses en images", async () => {
  const M = await import("../web/public/manches.js");
  const S = await import("../web/public/show.js");
  const T = await import("../web/public/test-show.js");
  const img = (n) => `${n}`.repeat(16);
  const PETITS = { title: "Animaux des petits", kind: "photo", questions: [
    { text: "Où est le chat ?", choices: ["Chat", "Chien", "Vache", "Lion"], correct: 0, status: "validee", choiceImages: [img(1), img(2), img(3), img(4)] },
    { text: "Où est le lion ?", choices: ["Chat", "Chien", "Vache", "Lion"], correct: 3, status: "validee", choiceImages: [img(1), img(2), img(3), img(4)] },
    { text: "Pas relue", choices: ["Chat", "Chien"], correct: 0, status: "brouillon", choiceImages: [img(1), img(2)] },
  ] };
  // Ancien quiz illustré, sans type enregistré : reconnu à ses réponses en images.
  const ANCIEN = { title: "Ancien", questions: [{ text: "Où est le chien ?", choices: ["Chat", "Chien"], correct: 1, status: "validee", choiceImages: { 0: img(1), 1: img(2) } }] };
  const CULTURE = { title: "Culture", questions: [{ text: "Capitale ?", choices: ["Paris", "Rome"], correct: 0, status: "validee", image: "🗼" }] };
  const quizzes = { petits: PETITS, ancien: ANCIEN, culture: CULTURE };

  test("le Quiz illustré ne joue que les quiz illustrés, le Quiz que les autres", () => {
    assert.equal(S.ROUND_TYPES.illustre, "Quiz illustré");
    assert.equal(S.illustreQuestions(PETITS).length, 2);
    assert.equal(S.illustreQuestions(ANCIEN).length, 1);
    assert.equal(S.illustreQuestions(CULTURE).length, 0);
    assert.equal(S.quizQuestions(CULTURE).length, 1);
    assert.equal(S.quizQuestions(PETITS).length, 0);
    assert.deepEqual(M.collectionItems("illustre", { quizzes }).map((x) => x.key), ["ancien", "petits"]);
    assert.deepEqual(M.collectionItems("quiz", { quizzes }).map((x) => x.key), ["culture"]);
    assert.ok(M.MANCHE_TYPES.includes("illustre"));
  });

  test("sur la TV : le jeu s'appelle « Quiz illustré », réponses en images, même barème et Super Finale possible", () => {
    const show = { childName: "Léa", age: 5, rounds: [{ type: "illustre", quizId: "petits", finale: 1 }, { type: "quiz", quizId: "culture" }] };
    const { snapshot, problems } = S.buildSnapshot("s", show, quizzes);
    assert.deepEqual(problems, []);
    assert.deepEqual(snapshot.rounds, [{ title: "Quiz illustré", count: 2, finale: 1 }, { title: "Culture", count: 1 }]);
    const [a, b, c] = snapshot.quiz.questions;
    assert.deepEqual([a.round, a.kind, a.choiceImages.length, a.double], ["Quiz illustré", "classic", 4, false]);
    assert.deepEqual([b.double, b.finale], [true, true]);
    assert.equal(c.round, "Culture");
    // Un quiz classique ne se joue pas en Quiz illustré : le problème est dit, rien n'est joué.
    const faux = S.buildSnapshot("s", { rounds: [{ type: "illustre", quizId: "culture" }] }, quizzes);
    assert.equal(faux.snapshot, null);
    assert.match(faux.problems[0], /choisissez un quiz illustré/);
  });

  test("une ancienne manche « Quiz » faite de quiz illustrés devient un Quiz illustré, les autres ne changent pas", () => {
    assert.deepEqual(S.jeuDeLaManche({ type: "quiz", quizId: "petits", finale: 2 }, quizzes), { type: "illustre", quizId: "petits", finale: 2 });
    assert.deepEqual(S.jeuDeLaManche({ quizIds: ["petits", "ancien"] }, quizzes).type, "illustre");
    assert.deepEqual(S.jeuDeLaManche({ type: "quiz", quizIds: ["petits", "culture"] }, quizzes).type, "quiz");
    assert.deepEqual(S.jeuDeLaManche({ type: "quiz", quizId: "inconnu" }, quizzes).type, "quiz");
    assert.deepEqual(S.jeuDeLaManche({ type: "express", quizId: "petits" }, quizzes).type, "express");
    assert.equal(S.jeuDeLaManche(null, quizzes), null);
    const { snapshot } = S.buildSnapshot("s", { rounds: [{ type: "quiz", quizId: "petits" }] }, quizzes);
    assert.equal(snapshot.rounds[0].title, "Quiz illustré");
    // Recherche par jeu : « illustré » la retrouve.
    assert.equal(S.showMatches({ childName: "Léa", rounds: [{ type: "quiz", quizId: "petits" }] }, "illustré", { quizzes }), true);
    // Page des manches : rangée avec le Quiz illustré.
    const manches = { m1: { type: "quiz", title: "Petits", round: { type: "quiz", quizId: "petits" } }, m2: { type: "quiz", title: "Culture", round: { type: "quiz", quizId: "culture" } } };
    assert.deepEqual(M.mancheGroups(manches, "illustre", quizzes).active.map(([id]) => id), ["m1"]);
    assert.deepEqual(M.mancheGroups(manches, "quiz", quizzes).active.map(([id]) => id), ["m2"]);
    assert.deepEqual(M.cleanRound({ type: "illustre", quizId: "petits", finale: 2, count: 5 }), { type: "illustre", quizId: "petits", count: 5, finale: 2 });
  });

  test("prestation de test « tous les jeux » : le quiz des petits est un Quiz illustré, plus de quiz classique nommé « illustré »", () => {
    assert.ok(T.FULL_SHOW.rounds.some((r) => r.type === "illustre" && r.quizId === T.FULL_KEYS.images));
    assert.equal(T.imageQuiz([[img(1), img(2), img(3), img(4)], [img(1), img(2), img(3), img(4)]]).title, "TEST – Quiz illustré des petits");
    assert.equal(T.FULL_QUIZZES[T.FULL_KEYS.quiz].title, "TEST – Quiz classique de Léa");
    assert.equal(S.quizKind(T.FULL_QUIZZES[T.FULL_KEYS.quiz]), "classique");
    assert.deepEqual(T.OLD_TEST_TITLES, { "TEST – Quiz en images des petits": "TEST – Quiz illustré des petits", "TEST – Quiz illustré de Léa": "TEST – Quiz classique de Léa" });
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

  test("photos (Zoom, Image floue) et extraits (blind test) : toutes les collections, rangées par quiz ou playlist", async () => {
    const zoom = M.collectionItems("zoom", lib);
    assert.deepEqual(zoom.slice(0, 2).map((x) => [x.label, x.group]), [["Lion", "Photos"], ["Chien", "Photos"]], "les photos des quiz d'abord");
    const banque = zoom.slice(2);
    const { PHOTOS_BANQUE } = await import("../web/public/banque-photos.js");
    assert.equal(banque.length, PHOTOS_BANQUE.size, "puis les photos de la banque des petits (celles qui existent)");
    assert.ok(banque.every((x) => x.key.startsWith("banque:") && x.group.startsWith("Photos · ") && x.value.choices.length === 4));
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
    const few = M.randomRound("zoom", lib, { count: 6, groups: ["Photos"] }, seq());
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
    assert.deepEqual([...played.photos], ["a".repeat(16), "banque:lion"], "le lion du quiz : la photo du lion de la banque n'est plus tirée non plus");
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

describe("« jamais deux fois » : ce qu'une activité a montré ne revient pas au hasard dans une autre", async () => {
  const J = await import("../web/public/jamais-deux-fois.js");
  const M = await import("../web/public/manches.js");
  const S = await import("../web/public/show.js");
  const seq = () => { let i = 0; return () => ((i++ * 0.618) % 1); };
  const mots = (cards) => cards.map((c) => J.motCle(c.word));
  const quizzes = { q1: { title: "Photos", questions: [{ text: "Qui est-ce ?", choices: ["Lion", "Tigre"], correct: 0, status: "validee", imageId: "a".repeat(16) }] } };

  test("un même mot au pluriel, avec un article ou des accents est reconnu ; un émoji aussi, avec ou sans variante", () => {
    assert.equal(J.motCle("Les Cerises"), J.motCle("cerise"));
    assert.equal(J.motCle("L\u2019Éléphant"), J.motCle("éléphant"));
    assert.equal(J.motCle("Le Père Noël"), "pere-noel");
    assert.equal(J.emojiCle("🐴\uFE0F"), "🐴");
    assert.equal(J.emojiCle("👍🏽"), "👍");
    assert.deepEqual(J.concepts({ word: "Coq", image: "🐓", imageId: "a".repeat(16) }), ["m:coq", "e:🐓", `i:${"a".repeat(16)}`]);
    assert.deepEqual(J.concepts({ image: `data:image/jpeg;base64,${"x".repeat(40)}` }), [], "une photo n'est pas un émoji");
  });

  test("tirage : les éléments neufs s'il en reste assez, sinon tout (la fête n'est jamais bloquée)", () => {
    const keys = (x) => [`m:${x}`];
    assert.deepEqual(J.neufsSiPossible([1, 2, 3], keys, new Set(["m:1"]), 2), [2, 3]);
    assert.deepEqual(J.neufsSiPossible([1, 2, 3], keys, new Set(["m:1", "m:2"]), 2), [1, 2, 3]);
    assert.deepEqual(J.neufsSiPossible([1, 2, 3], keys, null, 2), [1, 2, 3]);
  });

  test("le petit coq des Mimes et le chat de Chante le mot ne reviennent pas dans Qui a disparu ?", () => {
    const show = { rounds: [
      { type: "mimes", cards: [{ word: "Coq", image: "🐓" }, { word: "Cochon", image: "🐷" }] },
      { type: "chante", picks: ["chat"] },
      { type: "disparu", picks: ["animaux de la ferme"], count: 1, objects: 9 },
    ] };
    for (let n = 0; n < 5; n++) {
      const qs = S.buildSnapshot("s", show, {}, {}, () => Math.random()).snapshot.quiz.questions;
      const grille = qs.find((q) => q.kind === "disparu");
      assert.equal(grille.cards.length, 9);
      assert.ok(mots(grille.cards).every((w) => !["coq", "cochon", "chat"].includes(w)), mots(grille.cards).join());
    }
  });

  test("les mimes au hasard évitent le personnage de Qui suis-je ?, le mot de Chante le mot et la photo du Zoom", () => {
    const show = { rounds: [
      { type: "mimes", random: true, count: 100 },
      { type: "quisuis", picks: ["le lion"] },
      { type: "chante", picks: ["chat"] },
      { type: "zoom", picks: ["a".repeat(16)] },
    ] };
    const cards = S.buildSnapshot("s", show, quizzes, {}, seq()).snapshot.quiz.questions[0].cards;
    assert.equal(cards.length, 100);
    assert.ok(!mots(cards).includes("lion") && !mots(cards).includes("chat"));
  });

  test("ce qu'une manche a tiré au hasard, les suivantes l'évitent aussi", () => {
    const qs = S.buildSnapshot("s", { rounds: [{ type: "chante", count: 30 }, { type: "mimes", random: true, count: 100 }] }, {}, {}, seq()).snapshot.quiz.questions;
    const chantes = new Set(qs.filter((q) => q.kind === "chante").map((q) => J.motCle(q.choices[0])));
    const mime = qs.find((q) => q.kind === "mime");
    assert.ok(mots(mime.cards).every((w) => !chantes.has(w)));
  });

  test("plus assez d'objets neufs : la grille se remplit quand même", () => {
    const ferme = DISPARU_THEMES.find((t) => t.theme === "Animaux de la ferme");
    const show = { rounds: [{ type: "mimes", cards: ferme.objects }, { type: "disparu", picks: ["animaux de la ferme"], count: 1, objects: 9 }] };
    const grille = S.buildSnapshot("s", show, {}, {}, seq()).snapshot.quiz.questions.find((q) => q.kind === "disparu");
    assert.equal(grille.cards.length, 9);
  });

  test("pendant la fête : ce qui a été montré n'est plus tiré pour « ＋ Ajouter un jeu » ou « 🔁 Rejouer avec d'autres »", () => {
    const joue = S.buildSnapshot("s", { rounds: [{ type: "mimes", cards: [{ word: "Chat", image: "🐱" }] }, { type: "zoom", picks: ["a".repeat(16)] }] }, quizzes, {}, seq()).snapshot.quiz.questions;
    const played = M.playedKeys(joue);
    assert.ok(played.concepts.has("m:chat") && played.concepts.has("m:lion") && played.concepts.has(`i:${"a".repeat(16)}`));
    const disparu = S.gameQuestions({ type: "disparu", picks: ["animaux sauvages"], count: 1, objects: 9 }, {}, null, "z", {}, {}, {}, played).questions[0];
    assert.ok(!mots(disparu.cards).includes("lion"), "le lion du Zoom ne revient pas dans la grille");
    const { round } = M.randomRound("mimes", {}, { count: 60, avoid: played.mimes, avoidConcepts: played.concepts }, seq());
    assert.equal(round.cards.length, 60);
    assert.ok(!mots(round.cards).includes("lion") && !mots(round.cards).includes("chat"));
    const tout = new Set(M.collectionItems("mimes", {}).flatMap((x) => M.itemConcepts("mimes", x.value)));
    assert.equal(M.randomRound("mimes", {}, { count: 10, avoidConcepts: tout }, seq()).round.cards.length, 10, "tout déjà vu : on tire quand même");
  });

  test("quiz photo : ses photos et leurs mots comptent aussi", () => {
    const q = { text: "Lequel miaule ?", choices: ["Chat", "Chien", "Vache", "Coq"], correct: 0, choiceImages: { 0: "c".repeat(16), 1: "d".repeat(16) } };
    assert.deepEqual(J.questionConcepts(q), ["m:chat", `i:${"c".repeat(16)}`, "m:chien", `i:${"d".repeat(16)}`]);
    const show = { rounds: [{ type: "mimes", random: true, count: 100 }, { type: "quiz", quizId: "p" }] };
    const cards = S.buildSnapshot("s", show, { p: { title: "Animaux", questions: [{ ...q, status: "validee" }] } }, {}, seq()).snapshot.quiz.questions[0].cards;
    assert.ok(!mots(cards).includes("chat") && !mots(cards).includes("chien"));
  });

  test("choix à la main : permis, mais signalé « déjà utilisé dans … » avec le nom de l'autre jeu", () => {
    const rounds = [
      { type: "mimes", cards: [{ word: "Lion", image: "🦁" }, { word: "Chat", image: "🐱" }] },
      { type: "chante", picks: ["chat"] },
      { type: "zoom", picks: ["a".repeat(16)] },
    ];
    const autres = M.usedElsewhere(rounds, 0, { quizzes });
    assert.equal(autres.get("m:chat"), "Chante le mot !");
    assert.equal(autres.get("m:lion"), "Zoom mystère");
    const conflits = M.conflictsOf("mimes", M.collectionItems("mimes", {}), autres);
    assert.equal(conflits.get("lion"), "Zoom mystère");
    assert.equal(conflits.get("chat"), "Chante le mot !");
    assert.ok(!conflits.has("singe"));
    assert.equal(M.usedElsewhere(rounds, 2, { quizzes }).get("m:lion"), "Mimes", "le Zoom voit le lion des Mimes");
  });
});

describe("paroles (.lrc) et étiquettes des MP3", () => {
  const LRC = [
    "[ar:Les Licornes]", "[ti:On chante]",
    "[00:05.00]Premier couplet ici", "[00:10.00]La suite du couplet",
    "[00:20.00]On chante tous ensemble", "[00:24.00]Tous ensemble ce soir",
    "[00:30.00]Deuxième couplet", "[00:40.00]On chante tous ensemble", "[00:44.00]Tous ensemble ce soir",
    "[00:50.00]", "[01:00.00]<01:00.00>Hey <01:00.50>ho",
  ].join("\n");

  test("un .lrc se lit phrase par phrase, avec les temps des mots quand il en a", () => {
    const l = lireLrc(LRC);
    assert.equal(l.length, 9);
    assert.deepEqual(l.slice(0, 2).map((x) => [x.t, x.text]), [[5, "Premier couplet ici"], [10, "La suite du couplet"]]);
    assert.equal(l[7].text, "", "pause instrumentale");
    assert.deepEqual(l[8].words, [{ t: 60, w: "Hey" }, { t: 60.5, w: "ho" }]);
    // Plusieurs temps sur une ligne, décalage du fichier, BOM et fins de ligne Windows.
    const l2 = lireLrc("\uFEFF[offset:+500]\r\n[00:10.00][00:30.50]Refrain\r\n");
    assert.deepEqual(l2.map((x) => [x.t, x.text]), [[9.5, "Refrain"], [30, "Refrain"]]);
    assert.deepEqual(lireLrc("pas de paroles"), []);
  });

  test("le refrain est le passage le plus répété, à sa première venue", () => {
    assert.equal(refrainDesParoles(lireLrc(LRC)), 20);
    assert.equal(refrainDesParoles(lireLrc("[00:01.00]Une\n[00:02.00]Deux\n[00:03.00]Trois\n[00:04.00]Quatre")), null, "rien ne se répète");
    assert.equal(refrainDesParoles([]), null);
  });

  test("les premiers mots chantés : la première vraie phrase, sans les petits bruits", () => {
    assert.equal(debutDesParoles(lireLrc(LRC)), 5);
    assert.equal(debutDesParoles(lireLrc("[00:02.00]♪\n[00:04.00]Oh\n[00:17.50]Voici les premiers mots")), 17.5);
    assert.equal(debutDesParoles(lireLrc("[00:03.00]♪♪")), null);
    assert.equal(debutDesParoles([]), null);
  });

  test("les paroles de l'extrait du refrain : temps en ms depuis son début, phrase commencée gardée", () => {
    const court = parolesDuRefrain(lireLrc(LRC), 19, 90);
    assert.equal(court.split("\n")[0], "1000|On chante tous ensemble");
    assert.ok(court.includes("41000|Hey ho|41000,41500"), "temps des mots gardés");
    assert.ok(court.split("\n").some((x) => x === "31000|"), "pause gardée");
    // L'extrait commence au milieu d'une phrase : elle est gardée, calée au début.
    assert.equal(parolesDuRefrain(lireLrc(LRC), 31, 10).split("\n")[0], "0|Deuxième couplet");
    assert.equal(parolesDuRefrain(lireLrc(LRC), 200, 90), "", "rien à chanter");
  });

  test("chaque MP3 retrouve son .lrc : « Artiste - Titre.mp3 » et « Artiste_Titre.lrc »", () => {
    const f = (name) => ({ name });
    const { paires, seuls } = associerParoles([
      f("Black Eyed Peas - GIRL LIKE ME.mp3"), f("Betsy_Sigma Boy - Сигма Бой.lrc"), f("Black Eyed Peas_GIRL LIKE ME.lrc"),
      f("Betsy - Sigma Boy - Сигма Бой.mp3"), f("DJ TN Beat - Apaga Luz.mp3"), f("Orpheline.lrc"),
    ]);
    assert.deepEqual(paires.map((p) => [p.musique.name, p.lrc?.name ?? null]), [
      ["Black Eyed Peas - GIRL LIKE ME.mp3", "Black Eyed Peas_GIRL LIKE ME.lrc"],
      ["Betsy - Sigma Boy - Сигма Бой.mp3", "Betsy_Sigma Boy - Сигма Бой.lrc"],
      ["DJ TN Beat - Apaga Luz.mp3", null],
    ]);
    assert.deepEqual(seuls.map((x) => x.name), ["Orpheline.lrc"]);
    assert.equal(nomSimple("Diam's - Confessions Nocturnes.mp3"), nomSimple("Diam's_Confessions Nocturnes.lrc"));
  });

  test("étiquettes ID3 : titre, artiste et pochette de face, en ID3v2.3 et 2.4 ; rien sans étiquettes", () => {
    const enc = (x) => [...Buffer.from(x, "utf8")];
    const utf16 = (x) => [0xff, 0xfe, ...[...Buffer.from(x, "utf16le")]];
    const taille = (n, sur7) => (sur7 ? [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f] : [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
    const cadre = (id, corps, v4) => [...enc(id), ...taille(corps.length, v4), 0, 0, ...corps];
    for (const v of [3, 4]) {
      const image = Array(300).fill(9);
      const corps = [
        ...cadre("TIT2", [1, ...utf16("Сигма Бой")], v === 4),
        ...cadre("TPE1", [3, ...enc("Beyoncé")], v === 4),
        ...cadre("APIC", [0, ...enc("image/png"), 0, 4, ...enc("dos"), 0, ...Array(200).fill(1)], v === 4),
        ...cadre("APIC", [0, ...enc("image/jpeg"), 0, 3, 0, ...image], v === 4),
      ];
      const tag = Uint8Array.from([0x49, 0x44, 0x33, v, 0, 0, ...taille(corps.length + 16, true), ...corps, ...Array(16).fill(0)]);
      const r = lireId3(tag);
      assert.equal(r.title, "Сигма Бой");
      assert.equal(r.artist, "Beyoncé");
      assert.equal(r.picture.mime, "image/jpeg", "la pochette de face passe avant le dos");
      assert.equal(r.picture.data.length, 300);
    }
    assert.deepEqual(lireId3(new Uint8Array(20)), {});
  });
});

describe("bibliothèque des sons du blind test", () => {
  const A = "0123456789abcdef";
  const B = "fedcba9876543210";
  const C = "aaaaaaaaaaaaaaaa";
  const songs = { s1: { title: "Hakuna Matata", artist: "Le Roi lion", audioId: A, refrainId: B, buzz: 35, start: 10, refrain: 70, length: 210 } };
  const playlists = {
    p1: { title: "Disney", tracks: [{ title: "Hakuna Matata", audioId: A, songId: "s1", points: 300 }, { title: "Libérée, délivrée", audioId: C, duration: 25 }] },
    p2: { title: "Anciens tubes", tracks: { 0: { title: "Libérée délivrée (bis)", audioId: C } } },
    st: { title: "Statues", use: "statues", tracks: [{ title: "Danse", audioId: B }] },
  };

  test("une chanson par extrait, avec ses playlists ; les statues restent à part", () => {
    const list = songList(songs, playlists);
    assert.deepEqual(list.map((x) => x.title), ["Hakuna Matata", "Libérée, délivrée"]);
    const [hakuna, liberee] = list;
    assert.equal(hakuna.id, "s1");
    assert.equal(hakuna.refrainId, B);
    assert.equal(hakuna.buzz, 35);
    assert.deepEqual(hakuna.lists, [{ id: "p1", title: "Disney" }]);
    assert.equal(liberee.id, null, "ancien morceau pas encore rangé");
    assert.equal(liberee.buzz, 25);
    assert.deepEqual(liberee.lists.map((l) => l.id), ["p1", "p2"]);
  });

  test("une chanson retirée n'est plus dans la liste, même si une playlist la garde ; elle est dans les retirées", () => {
    const retiree = { ...songs, s1: { ...songs.s1, retiree: true }, s2: { title: "Libérée, délivrée", audioId: C, buzz: 25, retiree: true } };
    assert.deepEqual(songList(retiree, playlists).map((x) => x.title), []);
    assert.deepEqual(songsRetirees(retiree).map((x) => [x.id, x.title]), [["s1", "Hakuna Matata"], ["s2", "Libérée, délivrée"]]);
    assert.deepEqual(songsRetirees(songs), []);
  });

  test("la recherche ignore les accents et cherche aussi le nom des playlists", () => {
    const [hakuna, liberee] = songList(songs, playlists);
    assert.ok(songMatches(liberee, "liberee"));
    assert.ok(songMatches(hakuna, "roi HAKUNA"));
    assert.ok(songMatches(hakuna, "disney"));
    assert.ok(!songMatches(hakuna, "reine"));
    assert.ok(songMatches(hakuna, "  "));
  });

  test("un morceau tiré de la bibliothèque garde extraits, refrain et temps pour buzzer", () => {
    const [hakuna] = songList(songs, playlists);
    assert.deepEqual(trackFromSong(hakuna), { title: "Hakuna Matata", audioId: A, artist: "Le Roi lion", refrainId: B, songId: "s1", duration: 35 });
  });

  test("paroles du refrain : gardées avec la chanson et ses morceaux, seulement avec l'extrait du refrain", () => {
    const avec = { ...songs, s1: { ...songs.s1, lrc: true, paroles: "0|Hakuna matata", auto: true } };
    const [hakuna] = songList(avec, playlists);
    assert.deepEqual([hakuna.lrc, hakuna.paroles, hakuna.auto], [true, "0|Hakuna matata", true]);
    assert.equal(trackFromSong(hakuna).paroles, "0|Hakuna matata");
    assert.equal(trackFromSong({ ...hakuna, refrainId: null }).paroles, undefined, "sans refrain, pas de paroles");
    const [sans] = songList(songs, playlists);
    assert.deepEqual([sans.lrc, sans.paroles, sans.auto], [false, "", false]);
  });

  test("une chanson changée : ses morceaux suivent, points gardés ; anciens morceaux retrouvés par leur extrait", () => {
    const changed = { title: "Hakuna Matata", audioId: C, refrainId: A, buzz: 40 };
    const out = songUpdates("s1", changed, playlists, "maintenant", [C]);
    assert.deepEqual(out["library/playlists/p1/tracks/0"], { title: "Hakuna Matata", audioId: C, refrainId: A, songId: "s1", duration: 40, points: 300 });
    assert.equal(out["library/playlists/p1/tracks/1"].songId, "s1", "ancien morceau avec le même extrait");
    assert.equal(out["library/playlists/p2/tracks/0"].songId, "s1");
    assert.equal(out["library/playlists/p1/updatedAt"], "maintenant");
    assert.ok(!Object.keys(out).some((k) => k.includes("/st/")), "les statues ne changent pas");
    assert.deepEqual(songUpdates("s9", changed, playlists, 1), {});
  });

  test("refrain proposé après l'extrait du buzz, assez tôt pour tenir ; temps pour buzzer borné", () => {
    assert.equal(defaultRefrain(200, 10, 30), 80);
    assert.equal(defaultRefrain(100, 0, 30), 10);
    assert.equal(defaultRefrain(60, 0, 30), 0, "chanson plus courte que le refrain");
    assert.equal(defaultRefrain(Number.NaN), 0);
    assert.ok(defaultRefrain(400, 0, 30) + REFRAIN_SEC <= 400);
    assert.equal(buzzOf(60), 30);
    assert.equal(buzzOf(20), 20);
  });
});

describe("photos de la banque dans les jeux (Mimes, Qui a disparu ?, Zoom mystère, Image floue)", async () => {
  const P = await import("../web/public/banque-photos.js");
  const S = await import("../web/public/show.js");
  const M = await import("../web/public/manches.js");
  const seq = () => { let i = 0; return () => ((i++ * 0.618) % 1); };
  // Comme si toutes les photos de la banque étaient sur le site (la vraie liste suit les photos choisies).
  const avant = new Set(P.PHOTOS_BANQUE);
  before(() => BANQUE_MOTS.forEach((m) => P.PHOTOS_BANQUE.add(m.cle)));
  after(() => { P.PHOTOS_BANQUE.clear(); avant.forEach((k) => P.PHOTOS_BANQUE.add(k)); });

  test("un mot sans photo sur le site garde son émoji : jamais proposé en photo", () => {
    P.PHOTOS_BANQUE.delete("chat");
    try {
      assert.equal(P.avecPhoto({ word: "Chat", image: "🐱" }).banque, undefined);
      assert.ok(!P.banqueItems().some((x) => x.key === "banque:chat"));
      assert.ok(P.disparuPhotos().every((t) => t.objects.every((o) => o.banque !== "chat")));
    } finally {
      P.PHOTOS_BANQUE.add("chat");
    }
    assert.ok(P.banqueItems().some((x) => x.key === "banque:chat"));
  });

  test("question en photo : « Qu'est-ce que c'est ? », 4 réponses en images de la même famille, toujours la même", () => {
    const q = P.questionBanque("vache");
    assert.equal(q.text, "Qu'est-ce que c'est ?");
    assert.equal(q.choices.length, 4);
    assert.equal(new Set(q.choices).size, 4);
    assert.equal(q.choices[q.correct], "🐄 Vache");
    assert.equal(q.banque, "vache");
    const vache = BANQUE_MOTS.find((m) => m.cle === "vache");
    const autres = q.choices.filter((_, k) => k !== q.correct).map((c) => BANQUE_MOTS.find((m) => c.endsWith(m.mot) && c.startsWith(m.emoji)));
    assert.ok(autres.every((m) => m && m.famille === vache.famille), "les fausses réponses viennent de la même famille");
    assert.deepEqual(P.questionBanque("vache"), q, "même mot, même question (aperçu = partie)");
    assert.equal(P.questionBanque("n'existe pas"), null);
    // Aucune question de la banque n'a deux réponses qui se ressemblent trop.
    for (const m of BANQUE_MOTS) {
      const qb = P.questionBanque(m.cle);
      assert.equal(new Set(qb.choices).size, qb.choices.length, m.cle);
      assert.ok(qb.choices.length >= 2, m.cle);
    }
  });

  test("une carte prend la photo de son mot s'il est dans la banque, jamais à la place d'une photo choisie", () => {
    assert.equal(P.avecPhoto({ word: "Chat", image: "🐱" }).banque, "chat");
    assert.equal(P.avecPhoto({ word: "les Chats" }).banque, "chat", "pluriel et article");
    assert.equal(P.avecPhoto({ word: "Dragon volant" }).banque, undefined);
    assert.equal(P.avecPhoto({ word: "Chat", imageId: "a".repeat(16) }).banque, undefined);
    assert.equal(P.motDeLaBanque(""), null);
  });

  test("Qui a disparu ? : familles en photos (5 objets au moins), tirées seulement en mode « 📷 Photos »", () => {
    assert.ok(P.disparuPhotos().length >= 3);
    assert.ok(P.disparuPhotos().every((t) => t.theme.startsWith("Photos · ") && t.objects.length >= 5 && t.objects.every((o) => o.banque && o.image && o.word)));
    const lib = { mimes: {}, quizzes: {}, playlists: {}, contents: {} };
    for (let k = 0; k < 10; k++) {
      const { round } = M.randomRound("disparu", lib, { count: 4 });
      assert.ok(round.picks.every((p) => !p.startsWith("photos")), "en émojis : jamais une famille en photos");
    }
    const tirages = Array.from({ length: 20 }, () => M.randomRound("disparu", lib, { count: 4, photos: true }).round);
    assert.ok(tirages.every((r) => r.photos === true));
    assert.ok(tirages.some((r) => r.picks.some((p) => p.startsWith("photos"))), "en photos : les familles en photos sont tirées");
    // En photos, les objets en émojis dont le mot est dans la banque ont aussi leur photo.
    const fruits = S.buildSnapshot("s", { rounds: [{ type: "disparu", picks: ["fruits"], count: 1, photos: true }] }, {}, {}, seq()).snapshot.quiz.questions[0];
    assert.ok(fruits.cards.some((c) => c.banque));
    const emojis = S.buildSnapshot("s", { rounds: [{ type: "disparu", picks: ["fruits"], count: 1 }] }, {}, {}, seq()).snapshot.quiz.questions[0];
    assert.ok(emojis.cards.every((c) => !c.banque), "en émojis : aucune photo");
    // Tirée au hasard en photos : les grilles tout en photos passent d'abord.
    for (let k = 0; k < 5; k++) {
      const grilles = S.buildSnapshot("s", { rounds: [{ type: "disparu", count: 2, photos: true }] }, {}, {}, Math.random).snapshot.quiz.questions;
      assert.ok(grilles.length === 2 && grilles.every((q) => q.cards.every((c) => c.banque)), "en photos, au hasard : des grilles tout en photos");
    }
  });

  test("Mimes en photos : les cartes de la banque ont leur photo ; le réglage est gardé dans la manche", () => {
    const cards = [{ word: "Chat", image: "🐱" }, { word: "Dragon volant", image: "🐉" }, { word: "Lion", image: "🦁" }];
    const q = S.buildSnapshot("s", { rounds: [{ type: "mimes", cards, photos: true }] }, {}, {}, seq()).snapshot.quiz.questions[0];
    assert.deepEqual(Object.fromEntries(q.cards.map((c) => [c.word, c.banque ?? null])), { Chat: "chat", "Dragon volant": null, Lion: "lion" });
    const sans = S.buildSnapshot("s", { rounds: [{ type: "mimes", cards }] }, {}, {}, seq()).snapshot.quiz.questions[0];
    assert.ok(sans.cards.every((c) => !c.banque));
    assert.equal(M.cleanRound({ type: "mimes", cards, photos: true }).photos, true);
    assert.equal(M.cleanRound({ type: "disparu", picks: ["fruits"], photos: true }).photos, true);
    assert.equal(M.cleanRound({ type: "mimes", cards }).photos, undefined);
    const { round } = M.randomRound("mimes", { mimes: {}, quizzes: {}, playlists: {}, contents: {} }, { count: 6, base: { type: "mimes", photos: true } }, seq());
    assert.equal(round.photos, true, "rejouer garde les photos");
  });

  test("Zoom mystère et Image floue : une photo de la banque choisie se joue, avec ses réponses en images", () => {
    const qs = S.buildSnapshot("s", { rounds: [{ type: "zoom", picks: ["banque:vache", "banque:chat"] }] }, {}).snapshot.quiz.questions;
    assert.deepEqual(qs.map((q) => [q.kind, q.banque, q.choices[q.correct]]), [["zoom", "vache", "🐄 Vache"], ["zoom", "chat", P.questionBanque("chat").choices[P.questionBanque("chat").correct]]]);
    assert.ok(S.roundFilled({ type: "flou", picks: ["banque:vache"] }));
    // Jouée pendant la fête : ni la photo, ni le même mot ne reviennent au hasard.
    const played = M.playedKeys(qs);
    assert.ok(played.photos.has("banque:vache"));
  });

  test("au chargement, la régie copie les photos dans la partie et met leur identifiant ; rien ne bloque si une photo manque", async () => {
    const photos = { chat: "data:image/jpeg;base64,Q0hBVA==", vache: "data:image/jpeg;base64,VkFDSEU=" };
    const lus = [];
    const ecrits = [];
    const questions = [
      { kind: "zoom", text: "Qu'est-ce que c'est ?", banque: "vache", choices: ["a", "b"], correct: 0 },
      { kind: "flou", text: "Qu'est-ce que c'est ?", banque: "lion", choices: ["a", "b"], correct: 0 },
      { kind: "disparu", cards: [{ word: "Chat", banque: "chat" }, { word: "Lion", banque: "lion" }, { word: "Dragon" }] },
      { kind: "mime", cards: [{ word: "Chat", banque: "chat" }] },
      { kind: "qcm", text: "Rien à faire", choices: ["a", "b"], correct: 0 },
    ];
    const avant = JSON.stringify(questions);
    const out = await P.resolveBanque(questions, {
      photo: async (cle) => { lus.push(cle); return photos[cle] ?? null; },
      secours: async (m) => (m ? `data:image/jpeg;base64,${m.cle.toUpperCase()}` : null),
      ecrire: async (dir, id, data) => { ecrits.push([dir, id, data]); },
    });
    assert.equal(JSON.stringify(questions), avant, "les questions d'origine ne sont pas touchées");
    assert.ok(out.every((q) => !q.banque && (q.cards ?? []).every((c) => !c.banque)), "plus aucune clé de la banque");
    assert.match(out[0].imageId, /^[0-9a-f]{16}$/);
    assert.match(out[1].imageId, /^[0-9a-f]{16}$/, "photo absente : l'émoji dessiné la remplace pour un Zoom");
    assert.equal(out[2].cards[0].imageId, out[3].cards[0].imageId, "la même photo pour le même mot");
    assert.equal(out[2].cards[1].imageId, undefined, "carte sans photo : elle garde son émoji");
    assert.deepEqual(out[2].cards[2], { word: "Dragon" });
    assert.equal(out[4], questions[4], "question sans photo de la banque : rendue telle quelle");
    assert.equal(ecrits.filter(([dir]) => dir === "choiceImages").length, 1, "la photo du chat copiée une seule fois");
    assert.deepEqual(ecrits.filter(([dir]) => dir === "images").map(([, , d]) => d).sort(), [photos.vache, "data:image/jpeg;base64,LION"].sort(), "copiées en parallèle : l'ordre ne compte pas");
    const { imageId } = await import("../web/public/illustration.js");
    assert.equal(out[0].imageId, await imageId(photos.vache), "l'identifiant est l'empreinte de la photo");
    // Une erreur d'écriture ne bloque pas : la question part sans photo.
    const casse = await P.resolveBanque([{ kind: "zoom", banque: "chat" }], { photo: async () => photos.chat, ecrire: async () => { throw new Error("hors ligne"); } });
    assert.deepEqual(casse, [{ kind: "zoom" }]);
  });
});

describe("photos à soi sur les cartes de mimes et les objets de Qui a disparu ?", async () => {
  const S = await import("../web/public/show.js");
  const M = await import("../web/public/manches.js");
  const ID = "0123456789abcdef";

  test("une carte de mimes garde sa photo (identifiant valable seulement)", () => {
    assert.deepEqual(S.mimeCards([{ word: " Lapin ", imageId: ID }, { word: "Chat", image: "🐱", imageId: "pas-un-id" }]),
      [{ word: "Lapin", imageId: ID }, { word: "Chat", image: "🐱" }]);
  });

  test("une famille de Qui a disparu ? peut être faite de photos sans émoji ; un objet sans émoji ni photo est écarté", () => {
    const objets = ["Lit", "Lampe", "Poupée", "Tambour", "Ballon"].map((word, k) => ({ word, imageId: `${ID.slice(0, 15)}${k}` }));
    const [famille] = S.contentExtras("disparu", { extra: [{ theme: "La chambre", objects: [...objets, { word: "Rien" }] }] });
    assert.deepEqual(famille.objects, objets);
    assert.equal(S.disparuGroup(famille), "Mes photos");
    assert.equal(S.disparuGroup(DISPARU_THEMES[0]), "Émojis");
    assert.equal(S.contentExtras("disparu", { extra: [{ theme: "Trop peu", objects: objets.slice(0, 4) }] }).length, 0);
    // Tirage en photos : une famille de photos à soi passe avec les familles tout en photos.
    // (famille d'émojis inventée : la banque de photos grandit, une vraie famille peut devenir tout en photos)
    const emojis = { theme: "Formes", objects: ["Zigzag", "Spirale", "Losange", "Pentagone", "Hexagone"].map((word) => ({ word, image: "🔷" })) };
    const rangees = S.parPalierPhotos([emojis, famille], (t) => t.objects);
    assert.equal(rangees[0], famille);
  });

  test("dans « toutes les collections », la photo de Sarah d'un mot du catalogue remplace son émoji", () => {
    const chat = MIME_CATALOG.find((c) => c.word === "Chat");
    const lib = { mimes: { d: { title: "Mes photos", cards: [{ word: "chat", imageId: ID }, { word: "Doudou", imageId: ID }] } } };
    const items = M.collectionItems("mimes", lib);
    const x = items.find((i) => i.key === "chat");
    assert.equal(x.value.imageId, ID);
    assert.equal(x.label, "📷 chat");
    assert.equal(items.filter((i) => i.key === "chat").length, 1);
    assert.ok(items.some((i) => i.key === "doudou" && i.value.imageId === ID));
    assert.ok(chat, "le chat est bien au catalogue");
  });

  test("une carte en photo à soi garde sa photo, même en mode « 📷 Photos » de la banque", async () => {
    const P = await import("../web/public/banque-photos.js");
    const carte = { word: "Chat", image: "🐱", imageId: ID };
    assert.deepEqual(P.avecPhoto(carte), carte);
    assert.deepEqual(S.choiceImageIds([{ kind: "mime", cards: [carte, { word: "Lune" }] }]), [ID]);
  });
});

describe("bibliothèque d'images de la Régie PC (émojis, photos libres, ses images)", async () => {
  const B = await import("../web/public/mediatheque.js");
  const ID = "0123456789abcdef";
  const ID2 = "fedcba9876543210";

  test("les émojis de tous les jeux, une fois chacun, rangés par famille, les autres mots en mots-clés", () => {
    const e = B.emojisBibliotheque();
    const glyphes = e.map((x) => x.emoji.replace(/️/g, ""));
    assert.equal(new Set(glyphes).size, e.length, "pas deux fois le même émoji");
    assert.ok(e.length >= 450, `${e.length} émojis`);
    assert.ok(e.every((x) => x.nom && x.cat && x.groupe === "emojis"));
    // 🐄 de la banque (Vache) : « Animaux de la ferme » de Qui a disparu ? devient un mot-clé.
    const vache = e.find((x) => x.emoji === "🐄");
    assert.equal(vache.nom, "Vache");
    assert.ok(vache.tags.includes("Animaux de la ferme"));
    // Les émojis hors de la banque trouvent une famille lisible (jamais « mime:… »).
    assert.equal(e.find((x) => x.nom === "Fantôme").cat, "Imaginaire");
    assert.equal(e.find((x) => x.nom === "Pompier").cat, "Métiers");
    assert.ok(!B.categoriesDe(e).some((c) => /:/.test(c)));
  });

  test("les photos libres : une par mot de la banque qui a sa photo, avec ses étiquettes lisibles", async () => {
    const { PHOTOS_BANQUE } = await import("../web/public/banque-photos.js");
    const p = B.photosLibres();
    assert.equal(p.length, PHOTOS_BANQUE.size);
    const chat = p.find((x) => x.nom === "Chat");
    assert.deepEqual([chat.id, chat.src, chat.cat], ["banque:chat", "banque/chat.jpg", "Animaux"]);
    assert.ok(chat.tags.includes("4 pattes"));
    assert.ok(p.every((x) => x.tags.every((t) => !/^[gx]-/.test(t))), "pas d'étiquette de tirage");
  });

  test("ses images : celles qui ont une fiche d'abord, puis celles déjà utilisées sans fiche, « À ranger »", () => {
    const lib = {
      quizzes: { a: { title: "Léa", questions: [{ text: "?", choices: ["🐱 chat", "Chien"], correct: 0, imageId: ID, choiceImages: { 1: ID2 } }] } },
      contents: { quisuis: { images: { "le koala": "1111111111111111" } } },
      songs: { s: { title: "Hakuna Matata", imageId: "2222222222222222" } },
    };
    const u = B.imagesUtilisees(lib);
    assert.deepEqual(u.get(ID), { nom: "Chat", ou: ["Quiz « Léa »"] });
    assert.equal(u.get(ID2).nom, "Chien");
    assert.deepEqual(u.get("1111111111111111"), { nom: "Le koala", ou: ["Qui suis-je ?"] });
    assert.deepEqual(u.get("2222222222222222").ou, ["Pochettes des chansons"]);
    const mes = B.mesImages({ [ID2]: { name: "Toutou", cat: "Famille et amis", tags: "chien, doudou", createdAt: 5 }, [ID]: { name: "Minou", hidden: true, createdAt: 9 } }, u);
    assert.deepEqual(mes.map((x) => [x.nom, x.cat, x.retiree, x.fiche]), [
      ["Minou", "À ranger", true, true], ["Toutou", "Famille et amis", false, true],
      ["Le koala", "À ranger", false, false], ["Hakuna Matata", "À ranger", false, false],
    ]);
    assert.deepEqual(mes[1].tags, ["chien", "doudou"]);
    assert.deepEqual(mes[1].ou, ["Quiz « Léa »"]);
  });

  test("la recherche : chaque mot dans le nom, la catégorie ou les mots-clés, sans accents ni majuscules", () => {
    const elsa = { nom: "Elsa", cat: "Dessins animés", tags: ["princesse", "Reine des neiges"], ou: [] };
    assert.ok(B.correspond(elsa, ""));
    assert.ok(B.correspond(elsa, "reine NEIGES"));
    assert.ok(B.correspond(elsa, "dessins anime"));
    assert.ok(!B.correspond(elsa, "princesse pirate"));
  });

  test("la fiche enregistrée : nom obligatoire, mots-clés nettoyés, catégorie « À ranger » jamais écrite", () => {
    assert.equal(B.ficheImage({ nom: "  " }), null);
    const f = B.ficheImage({ nom: "  Elsa   la reine ", cat: "Dessins animés", tags: "princesse, Disney ; princesse,, reine" }, { createdAt: 7 });
    assert.deepEqual(f, { name: "Elsa la reine", cat: "Dessins animés", tags: "princesse, Disney, reine", createdAt: 7 });
    assert.deepEqual(B.ficheImage({ nom: "Toto", cat: B.A_RANGER, tags: [], retiree: true }, { createdAt: 1 }), { name: "Toto", tags: "", hidden: true, createdAt: 1 });
    // Jamais plus long que ce que la base accepte.
    const long = B.ficheImage({ nom: "x".repeat(200), cat: "c".repeat(80), tags: Array.from({ length: 80 }, (_, i) => `mot${i}`).join(",") });
    assert.ok(long.name.length <= B.FICHE.nom && long.cat.length <= B.FICHE.cat && long.tags.length <= B.FICHE.tags);
  });

  test("les catégories proposées : les suggestions, les siennes, « Autres » en dernier ; « À ranger » toujours en tête des filtres", () => {
    const cats = B.categoriesPerso([{ cat: "Pokémon" }, { cat: B.A_RANGER }, { cat: "Dessins animés" }]);
    assert.equal(cats.at(-1), "Autres");
    assert.ok(cats.includes("Pokémon") && cats.includes("Célébrités") && !cats.includes(B.A_RANGER));
    assert.deepEqual(B.categoriesDe([{ cat: "Films et séries" }, { cat: B.A_RANGER }, { cat: "Films et séries" }]), [B.A_RANGER, "Films et séries"]);
  });
});

describe("recherche « filtre » : les meilleurs résultats d'abord, rien de caché", async () => {
  const R = await import("../web/public/recherche.js");

  test("avec « ma » : Maison, puis La marelle, puis Tomate, puis ce qui n'a « ma » que dans ses mots-clés", () => {
    const items = [
      { nom: "Tomate" }, { nom: "Soleil", tags: ["Matin"] }, { nom: "La marelle" }, { nom: "Maison" }, { nom: "Chat", tags: ["animal"] },
    ];
    const ranges = R.parPertinence(items, "ma", (x) => x.nom, (x) => x.tags ?? []).map((x) => x.nom);
    assert.deepEqual(ranges, ["Maison", "La marelle", "Tomate", "Soleil", "Chat"]);
    assert.equal(R.rangRecherche("Maison", "ma"), 0);
    assert.equal(R.rangRecherche("La marelle", "ma"), 1);
    assert.equal(R.rangRecherche("Tomate", "ma"), 2);
    assert.equal(R.rangRecherche("Soleil", "ma", ["Matin"]), 3);
    assert.equal(R.rangRecherche("Soleil", "ma", ["Le Rhum"]), 5);
    assert.equal(R.rangRecherche("Soleil", "ma", ["Le Rhuma"]), 4);
  });

  test("sans accents ni majuscules, au début d'un mot après une apostrophe ou un tiret, plusieurs noms (titre, artiste)", () => {
    assert.equal(R.rangRecherche("Élephant", "ele"), 0);
    assert.equal(R.rangRecherche("L'éléphant", "ELE"), 1);
    assert.equal(R.rangRecherche("Pomme-de-terre", "terre"), 1);
    assert.equal(R.rangRecherche("Œuf", "oeuf"), 0);
    assert.equal(R.rangRecherche(["Dernière danse", "Indila"], "ind"), 0, "l'artiste compte autant que le titre");
    assert.equal(R.rangRecherche("Maison", "  "), 0);
    assert.equal(R.rangRecherche([null, undefined, ""], "ma"), 5);
  });

  test("l'ordre d'origine est gardé entre résultats aussi bons (dates, groupes) ; recherche vide : liste inchangée", () => {
    const items = ["Mardi gras", "Tomates", "Matin calme", "Pommes", "Mamie"];
    assert.deepEqual(R.parPertinence(items, "ma", (x) => x), ["Mardi gras", "Matin calme", "Mamie", "Tomates", "Pommes"]);
    assert.equal(R.parPertinence(items, "", (x) => x), items);
    assert.deepEqual(items, ["Mardi gras", "Tomates", "Matin calme", "Pommes", "Mamie"], "la liste d'origine n'est pas touchée");
  });

  test("contientTout : chaque mot tapé, dans n'importe quel ordre, n'importe où", () => {
    assert.ok(R.contientTout(["Mimes de Léa", "20 cartes · tour de 60 s"], "lea mimes"));
    assert.ok(R.contientTout(["Mimes de Léa"], "  "));
    assert.ok(R.contientTout(["Mimes de Léa", null], "ime"));
    assert.ok(!R.contientTout(["Mimes de Léa"], "lea chat"));
  });
});
