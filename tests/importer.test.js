// Import des quiz : texte Gemini, tableur, CSV, JSON, et anomalies signalées à la relecture.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { parseQuiz, checkQuestions, geminiPrompt, resolveCorrect, chatgptImagePrompt, chatgptUrl, imageKey, wordFromImage } from "../web/public/importer.js";
import { MIME_CATALOG } from "../web/public/mime-cards.js";
import { DISPARU_THEMES } from "../web/public/buzz-cards.js";
import { disparuObjects, activeItems, buildSnapshot, estimateMinutes, dureeEstimee, DUREE_ESTIMEE, roundFilled,
  readiness, jeuxVides, upcoming, daysUntil, isoDay, duplicateShow, etatPrestation, isArchived, ETATS, programRounds, lockedUntil, gameQuestions, insertGame, moveRound, removeRound, uniqueRoundTitle,
  soundIds, choiceImageIds, choiceImageList, pictoSeriesList, pictoSeriesOf, foldLegacyFinale,
  roundQuizIds, MIME_RANDOM, alerteEquipes, EQUIPES_PAR_DEFAUT, PAR_EQUIPE_MIN,
  statuesSongs, statuesChoices, roundSongs, isStatuesList, couleursEquipes, mimePool, titreAuto, chiffresDuTirage,
} from "../web/public/show.js";
import { PROFILES, profileForAge, defaultDuration } from "../web/public/profiles.js";
import { PICTO_WORDS, PICTO_SERIES } from "../web/public/picto-cards.js";
import { guessTrack, normalizeLevel } from "../web/public/audio.js";
import { songList, songsRetirees, songMatches, trackFromSong, songUpdates, marquerEffacees, defaultRefrain, buzzOf, REFRAIN_SEC } from "../web/public/sons.js";
import { lireLrc, refrainDesParoles, refrainsDesParoles, debutDesParoles, parolesDuRefrain, associerParoles, nomSimple, ligneAuMoment } from "../web/public/paroles.js";
import { volumes, explosionDuVolume, refrainAuVolume, PAS_VOLUME } from "../web/public/volume.js";
import { lireId3 } from "../web/public/id3.js";
import { demosAEffacer, nbDemos, JEUX_DU_TEST, TEST_PRESTATION } from "../web/public/test-show.js";
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

describe("couleurs des équipes d'une prestation (cedric, 22/10)", () => {
  const [ROSE, ORANGE, VERT, JAUNE, BLEU] = ["#FF2D95", "#FF6B1A", "#39FF14", "#FFE600", "#2B86C5"];
  test("par défaut, une par équipe prévue : rose, orange, vert, jaune, puis bleu…", () => {
    assert.deepEqual(couleursEquipes({ teams: 4 }), [ROSE, ORANGE, VERT, JAUNE]);
    assert.deepEqual(couleursEquipes({}), [ROSE, ORANGE, VERT, JAUNE], "nombre non indiqué : 4");
    assert.deepEqual(couleursEquipes({ teams: 2 }), [ROSE, ORANGE]);
    assert.deepEqual(couleursEquipes({ teams: 5 }), [ROSE, ORANGE, VERT, JAUNE, BLEU]);
    assert.equal(couleursEquipes({ teams: 8 }).length, 8);
  });
  test("les couleurs choisies d'abord, sans doublon ni couleur inconnue, complétées dans l'ordre", () => {
    assert.deepEqual(couleursEquipes({ teams: 2, teamColors: [ORANGE, VERT] }), [ORANGE, VERT]);
    assert.deepEqual(couleursEquipes({ teams: 3, teamColors: [JAUNE] }), [JAUNE, ROSE, ORANGE]);
    assert.deepEqual(couleursEquipes({ teams: 2, teamColors: [VERT.toLowerCase(), VERT, "#123456", "rouge"] }), [VERT, ROSE]);
    assert.deepEqual(couleursEquipes({ teams: 2, teamColors: [ORANGE, VERT, JAUNE] }), [ORANGE, VERT], "moins d'équipes : les premières");
    assert.deepEqual(couleursEquipes({ teams: 2, teamColors: { 0: BLEU, 1: ROSE } }), [BLEU, ROSE], "tableau relu de la base");
  });
  test("le lancement emporte les couleurs de la prestation", () => {
    const quiz = { title: "Q", questions: [{ text: "Capitale ?", choices: ["Paris", "Rome"], correct: 0, status: "validee" }] };
    const { snapshot } = buildSnapshot("s", { teams: 2, teamColors: [ORANGE, VERT], rounds: [{ type: "quiz", quizId: "q" }] }, { q: quiz });
    assert.deepEqual(snapshot.teamColors, [ORANGE, VERT]);
    assert.deepEqual(buildSnapshot("s", { rounds: [{ type: "quiz", quizId: "q" }] }, { q: quiz }).snapshot.teamColors, [ROSE, ORANGE, VERT, JAUNE]);
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
    assert.deepEqual(readiness(ok, quizzes), { level: "prete", todo: [], alertes: [] });
    assert.deepEqual(readiness({ ...ok, status: "brouillon" }, quizzes).todo, ["Passer le statut à « À venir »"]);
    assert.deepEqual(readiness({ childName: "Tom", status: "brouillon" }, quizzes).todo, ["Ajouter la date", "Indiquer l'âge", "Ajouter un jeu"]);
    const draftOnly = readiness({ ...ok, rounds: [{ type: "quiz", quizId: "draft" }] }, quizzes);
    assert.equal(draftOnly.level, "a-completer");
    assert.match(draftOnly.todo.join(), /aucune question validée/);
    assert.match(readiness({ ...ok, rounds: [{ type: "quiz", quizId: "efface" }] }, quizzes).todo.join(), /n'existe plus/);
    assert.equal(readiness({ ...ok, status: "archivee" }, quizzes).level, "archivee");
  });

  test("un jeu ajouté mais encore vide (cedric, 24/10) : à faire s'il ne se joue pas vide, simple alerte si la TV le tire au hasard", () => {
    const ok = { childName: "Léa", age: 7, date: "2026-12-02", status: "publiee", teams: 4, rounds: [{ type: "quiz", quizId: "animaux" }] };
    const avec = (...rounds) => readiness({ ...ok, rounds: [...ok.rounds, ...rounds] }, quizzes, {}, {}, {}, "2026-10-24");
    // Ne se jouent pas vides : la prestation reste « À compléter », et la phrase dit ce qui manque (plus « n'existe plus »).
    for (const [type, texte] of [["quiz", "Quiz (jeu 2) : aucune question choisie pour l'instant."], ["illustre", "Quiz illustré : aucune question choisie pour l'instant."],
      ["express", "Vrai ou Faux express : aucune affirmation choisie pour l'instant."], ["zoom", "Zoom mystère : aucune photo choisie pour l'instant."],
      ["flou", "Image floue : aucune photo choisie pour l'instant."], ["blind", "Blind test : aucune chanson choisie pour l'instant."],
      ["musical", "Quiz musical : aucune chanson choisie pour l'instant."], ["mimes", "Mimes : aucune image tirée pour l'instant."]]) {
      const r = avec({ type });
      assert.equal(r.level, "a-completer", type);
      assert.deepEqual(r.todo, [texte], type);
      assert.deepEqual(r.alertes, [], type);
    }
    // La TV les tire au hasard : prête quand même, avec l'alerte.
    for (const [round, texte] of [[{ type: "pictionary" }, "Pictionary : aucun mot choisi pour l'instant, la TV les tirera au hasard."],
      [{ type: "disparu", count: 3 }, "Qui a disparu ? : aucun tour choisi pour l'instant, la TV en tirera 3 au hasard."],
      [{ type: "chante" }, "Chante le mot ! : aucun mot choisi pour l'instant, la TV en tirera 6 au hasard."],
      [{ type: "quisuis" }, "Qui suis-je ? : aucun personnage choisi pour l'instant, la TV en tirera 5 au hasard."]]) {
      assert.deepEqual(avec(round), { level: "prete", todo: [], alertes: [texte] }, round.type);
    }
    // Rempli : plus rien ; les jeux sans rien à préparer ne sont jamais vides.
    const grille = { theme: "Fruits", objects: ["pomme", "poire", "kiwi", "fraise", "cerise"].map((word) => ({ word, image: "🍎" })) };
    assert.deepEqual(avec({ type: "disparu", seriesMots: [{ id: "de", origine: "de", mots: [grille] }] }).alertes, []);
    assert.deepEqual(avec({ type: "pictionary", series: ["Animaux"] }).alertes, []);
    assert.deepEqual(avec({ type: "statues" }, { type: "coffres" }, { type: "gonfleur" }, { type: "patate" }), { level: "prete", todo: [], alertes: [] });
    assert.deepEqual(jeuxVides({ rounds: [{ type: "statues" }, { type: "chante" }] }).map((x) => [x.i, x.type, x.hasard]), [[1, "chante", true]]);
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
    assert.deepEqual(readiness(ok, quizzes, {}, {}, {}, "2026-10-20"), { level: "prete", todo: [], alertes: [] });
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

describe("prestation de test (cedric, 24/10)", async () => {
  const S = await import("../web/public/show.js");
  test("les 16 jeux, une seule fois chacun, jamais deux fois le même à la suite, les Coffres mystères pour finir", () => {
    assert.equal(JEUX_DU_TEST.length, 16);
    assert.equal(new Set(JEUX_DU_TEST).size, 16);
    assert.deepEqual([...JEUX_DU_TEST].sort(), Object.keys(S.ROUND_TYPES).filter((k) => !["finale", "portes"].includes(k)).sort());
    assert.equal(JEUX_DU_TEST.at(-1), "coffres");
  });

  test("le bouton n'efface que les anciennes démos : jamais une prestation, un quiz, une image ou un son de Sarah, ni une démo qui lui sert encore", () => {
    const h = (c) => c.repeat(16);
    const lib = {
      shows: {
        "test-lea-tous-les-jeux": { origin: "test", rounds: [{ type: "zoom", quizId: "test-lea-tous-les-jeux-zoom" }, { type: "blind", playlistId: "test-lea-tous-les-jeux-comptines" }] },
        "test-lea-9-ans": { origin: "test", rounds: [{ type: "quiz", quizId: "test-lea-9-ans" }] },
        [TEST_PRESTATION]: { origin: "test", rounds: [{ type: "mimes", equipes: [[{ word: "Chat", banque: "chat" }]] }] },
        "-Nautre": { origin: "test", rounds: [] },
        ines: { origin: "admin", rounds: [{ type: "quiz", quizId: "animaux" }] },
        // Une copie de démo que Sarah garde (renommée pour une vraie fête) : son quiz reste.
        tom: { title: "Anniversaire de Tom", copieDe: "test-lea-9-ans", rounds: [{ type: "quiz", quizId: "test-lea-9-ans" }] },
        // Une copie de démo restée telle quelle : c'est un test, elle part (cedric, 24/10 : tout purger).
        copie: { title: "Copie de ANNIVERSAIRE TEST – Léa, 9 ans", copieDe: "test-lea-9-ans", rounds: [{ type: "quiz", quizId: "test-lea-tous-les-jeux-quiz" }] },
      },
      // [d] : une manche de la bibliothèque bâtie sur un quiz de test ; [e] : une vraie manche.
      manches: { a: { showId: "test-lea-9-ans" }, b: { showId: TEST_PRESTATION }, c: { showId: "ines" },
        d: { round: { type: "quiz", quizId: "test-vieux" } }, e: { round: { type: "quiz", quizId: "animaux" } } },
      quizzes: {
        animaux: { title: "Animaux", questions: [{ imageId: h("d") }] },
        "test-lea-9-ans": { title: "TEST", questions: [] },
        "test-lea-tous-les-jeux-quiz": { title: "TEST – Quiz classique de Léa", questions: [] },
        "test-lea-tous-les-jeux-zoom": { title: "TEST", questions: [{ imageId: h("a") }, { imageId: h("d") }, { imageId: h("e") }] },
        // Toute la rubrique « 🧪 Questions de test », même un quiz d'une version plus ancienne encore.
        "test-vieux": { title: "TEST – Quiz illustré des petits", questions: [] },
      },
      mimes: { "test-lea-tous-les-jeux-mimes": { title: "TEST", cards: [{ imageId: h("f") }] }, "test-vieux-mimes": { title: "TEST", cards: [] } },
      playlists: { "test-lea-tous-les-jeux-comptines": { title: "TEST", tracks: [{ audioId: h("b") }, { audioId: h("9") }] } },
      songs: { s: { title: "Chanson", audioId: h("9") } },
      // Rangée par Sarah dans « Mes images ».
      medias: { [h("e")]: { name: "Fusée" } },
    };
    const plan = demosAEffacer(lib);
    assert.deepEqual(plan.shows, ["test-lea-tous-les-jeux", "test-lea-9-ans", TEST_PRESTATION, "-Nautre", "copie"]);
    assert.deepEqual(plan.manches, ["a", "b", "d"]);
    assert.deepEqual(plan.quizzes.sort(), ["test-lea-tous-les-jeux-quiz", "test-lea-tous-les-jeux-zoom", "test-vieux"].sort(), "le quiz de la copie de Tom reste");
    assert.deepEqual(plan.mimes.sort(), ["test-lea-tous-les-jeux-mimes", "test-vieux-mimes"].sort());
    assert.deepEqual(plan.playlists, ["test-lea-tous-les-jeux-comptines"]);
    // Les photos dessinées et la comptine partent ; celle du quiz de Sarah, la rangée et l'extrait d'une chanson restent.
    assert.deepEqual(plan.medias.sort(), [h("a"), h("f"), h("b")].sort());
    assert.equal(nbDemos(plan), 5 + 3 + 3 + 2 + 1 + 3);
    // Rien à effacer.
    assert.equal(nbDemos(demosAEffacer({ shows: { ines: lib.shows.ines }, quizzes: { animaux: lib.quizzes.animaux } })), 0);
    assert.equal(nbDemos(demosAEffacer()), 0);
  });
});

describe("mimes", () => {
  const DECK = { title: "Animaux", duration: 45, cards: [{ word: "Chat", image: "🐱" }, { word: " Robot " }, { word: "" }, null] };
  const QUIZ = { title: "Quiz", questions: [{ text: "Roi ?", choices: ["Lion", "Tigre"], correct: 0, status: "validee" }] };

  test("une manche de mimes devient un seul élément du programme, avec son paquet et la durée d'un tour", () => {
    const show = { age: 9, rounds: [{ type: "quiz", quizId: "q" }, { type: "mimes", deckId: "d" }] };
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
      assert.equal(q.cards.length, 6, "6 cartes chez les Moyens (cedric, 27/10 : un nombre pair)");
      assert.equal(q.correct, 0);
      assert.equal(q.cards.filter((c) => c.word === q.choices[0]).length, 1, "l'objet disparu est dans la grille");
      assert.equal(q.image, q.cards.find((c) => c.word === q.choices[0]).image);
      assert.equal(q.duration, 12 + 3 + 25, "mémorisation (2 s par objet), tour de magie, recherche");
      assert.ok(q.cards.every((c) => c.image && c.word));
    }
    const petits = buildSnapshot("x", { childName: "Tom", age: 6, rounds: [{ type: "disparu", count: 2 }] }, {}).snapshot.quiz.questions;
    assert.deepEqual(petits.map((q) => [q.cards.length, q.duration]), [[4, 38], [4, 38]], "4 cartes et 10 s pour mémoriser chez les Petits");
    assert.equal(roundFilled({ type: "disparu" }), true);
  });
});

describe("Qui a disparu ? (cedric, 27/10) : cartes par tour et difficulté selon l'âge", () => {
  test("4, 6 ou 8 cartes ; les familles du niveau de l'âge d'abord : simples aux petits, qui se ressemblent aux grands", async () => {
    const { DISPARU_CARTES, famillesPourLAge, niveauDeFamille } = await import("../web/public/show.js");
    assert.deepEqual(DISPARU_CARTES, [4, 6, 8]);
    assert.deepEqual(["PETITS", "MOYENS", "GRANDS", "ADULTES", "NEUTRE"].map((p) => disparuObjects({}, p)), [4, 6, 8, 8, 6]);
    const familles = DISPARU_THEMES;
    const niveau = (t) => niveauDeFamille(t);
    assert.equal(niveau(familles.find((t) => t.theme === "Fruits")), 1);
    assert.equal(niveau(familles.find((t) => t.theme === "Les émotions")), 3);
    assert.equal(niveau({ theme: "Photos · Animaux", objects: [{ word: "Chat", banque: "chat" }] }), 1, "les photos libres : simples");
    const n1 = familles.filter((t) => niveau(t) === 1).length;
    const n3 = familles.filter((t) => niveau(t) === 3).length;
    for (let essai = 0; essai < 5; essai++) {
      const petits = famillesPourLAge(familles, "PETITS").map(niveau);
      assert.ok(petits.slice(0, n1).every((x) => x === 1) && petits.at(-1) === 3, "les petits : niveau 1, le 3 en dernier");
      const grands = famillesPourLAge(familles, "GRANDS").map(niveau);
      assert.ok(grands.slice(0, familles.length - n1).every((x) => x >= 2) && grands.slice(-n1).every((x) => x === 1), "les grands : 3 et 2 d'abord");
      assert.equal(famillesPourLAge(familles, "NEUTRE").length, familles.length);
    }
    assert.ok(n3 >= 4);
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
    // Quiz musical (cedric, 24/10) : la révélation du blind test en plus court, avec l'artiste, le refrain et ses paroles.
    const hakuna = musical.find((q) => q.choices[q.correct] === "Hakuna Matata");
    assert.deepEqual([hakuna.artist, hakuna.refrainId, hakuna.lyrics], ["Le Roi lion", ID(5), "0|Hakuna matata"]);
    const ocean = musical.find((q) => q.choices[q.correct] === "Sous l'océan");
    assert.deepEqual([ocean.artist, ocean.refrainId, ocean.lyrics], [undefined, undefined, undefined]);
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
    assert.deepEqual(readiness({ childName: "Tom", age: 8, date: "2026-12-02", status: "publiee", rounds: [{ type: "blind", playlistId: "o" }] }, {}, {}, { o: one }), { level: "prete", todo: [], alertes: [] });
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

  test("vos chansons de la bibliothèque des sons (cedric, 24/10) : la TV joue leur refrain, l'une après l'autre ; une manche d'avant ne change pas", async () => {
    const { chansonsStatues, sonsDesStatues } = await import("../web/public/show.js");
    const M = await import("../web/public/manches.js");
    const hex = (c) => c.repeat(16);
    const songs = {
      a: { title: "Libérée", audioId: hex("a"), refrainId: hex("b") },
      c: { title: "Sous l'océan", audioId: hex("c") },
      r: { title: "Retirée", audioId: hex("d"), refrainId: hex("e"), retiree: true },
    };
    const round = { type: "statues", duration: 60, chansons: ["c", "a", "a", "r", "zz", 3], songs: [hex("f")] };
    assert.deepEqual(chansonsStatues(round), ["c", "a", "r", "zz"]);
    assert.deepEqual(chansonsStatues({ type: "blind", chansons: ["a"] }), []);
    // Le refrain s'il est réglé, sinon l'extrait du début ; une chanson supprimée ou inconnue est sautée.
    assert.deepEqual(sonsDesStatues(round, {}, songs), [hex("c"), hex("b")]);
    const { snapshot } = buildSnapshot("s", { childName: "Léa", age: 7, rounds: [round] }, {}, {}, Math.random, {}, {}, {}, songs);
    assert.deepEqual(snapshot.quiz.questions[0].audioIds, [hex("c"), hex("b")]);
    assert.deepEqual(soundIds(snapshot.quiz.questions), [hex("c"), hex("b")]);
    // Plus aucune chanson jouable : les extraits cochés avant, sinon la musique de la fête.
    const playlists = { p: { title: "P", tracks: [{ title: "F", audioId: hex("f") }] } };
    assert.deepEqual(sonsDesStatues({ ...round, chansons: ["r"] }, playlists, songs), [hex("f")]);
    assert.deepEqual(sonsDesStatues({ type: "statues", chansons: ["r"] }, playlists, songs), []);
    // Enregistrées : vos chansons, à la place des extraits cochés avant.
    assert.deepEqual(M.cleanRound(round, playlists), { type: "statues", duration: 60, chansons: ["c", "a", "r", "zz"] });
    assert.deepEqual(M.cleanRound({ type: "statues", duration: 60, songs: [hex("f")] }, playlists), { type: "statues", duration: 60, songs: [hex("f")] });
    assert.equal(M.mancheSummary({ type: "statues", duration: 60, chansons: ["a", "c"] }, {}), "60 s · 2 chansons");
  });
});

describe("Les Coffres mystères", () => {
  const QUIZ = { title: "Quiz", questions: [{ text: "Roi ?", choices: ["Lion", "Tigre"], correct: 0, status: "validee" }] };
  test("rien à préparer, à la suite d'un quiz ; les anciennes Portes mystères se jouent en coffres mystères", () => {
    const show = { age: 9, rounds: [{ type: "quiz", quizId: "q" }, { type: "coffres" }, { type: "portes", doors: 3 }] };
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
    assert.equal(p.bombs, undefined, "sans réglage : les 3 bombes de la TV");
  });
  test("le nombre de bombes (cedric, 26/10, test Mi Box) : de 1 à 6, 3 d'office, passé à la TV ; la durée estimée et la règle suivent", async () => {
    const { cleanRound } = await import("../web/public/manches.js");
    const { regleDePatate, PATATE_RULE, bombesDe } = await import("../web/public/show.js");
    const bombe = (round) => buildSnapshot("s", { childName: "Léa", age: 9, rounds: [round] }).snapshot.quiz.questions[0];
    assert.equal(bombe({ type: "patate", bombs: 5 }).bombs, 5);
    assert.equal(bombe({ type: "patate", bombs: 9 }).bombs, 6, "ramené dans ses limites");
    assert.equal(bombe({ type: "patate", bombs: 0 }).bombs, 1);
    assert.deepEqual([bombesDe({}), bombesDe({ bombs: 2.5 })], [3, 3]);
    // Environ 50 s par bombe.
    const sec = (round) => estimateMinutes({ quiz: { questions: [bombe(round)] } });
    assert.deepEqual([sec({ type: "patate", bombs: 1 }), sec({ type: "patate" }), sec({ type: "patate", bombs: 6 })], [1, 3, 5]);
    assert.equal(DUREE_ESTIMEE.bombe, 50);
    // Gardé dans la manche enregistrée, dans ses limites.
    assert.deepEqual(cleanRound({ type: "patate", bombs: 4 }), { type: "patate", bombs: 4 });
    assert.deepEqual(cleanRound({ type: "patate", bombs: 12 }), { type: "patate", bombs: 6 });
    assert.deepEqual(cleanRound({ type: "patate", bombs: "4" }), { type: "patate" });
    // La règle dit le vrai nombre.
    assert.match(PATATE_RULE, /Trois bombes par partie$/);
    assert.match(regleDePatate(1), /Une bombe par partie$/);
    assert.match(regleDePatate(6), /Six bombes par partie$/);
  });
});

describe("Super Finale : les dernières questions du quiz, pas un jeu à part", () => {
  const quiz = (title, n) => ({ title, questions: [...Array(n).keys()].map((i) => ({ text: `${title} ${i + 1} ?`, choices: ["Oui", "Non"], correct: 0, status: "validee" })) });
  const LIB = { a: quiz("Animaux", 2), b: quiz("Sport", 1), f: quiz("Finale", 2) };
  const play = (rounds) => buildSnapshot("s", { age: 9, rounds }, LIB, { d: { title: "Mimes", cards: [{ word: "Chat" }] } }, () => 0);

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
    assert.deepEqual(play([{ type: "flou", quizId: "a", finale: 2 }]).snapshot?.quiz.questions.map((q) => q.double ?? false) ?? [], play([{ type: "flou", quizId: "a" }]).snapshot?.quiz.questions.map((q) => q.double ?? false) ?? [], "pas à l'Image floue");
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

describe("fiche d'une prestation (cedric, 23/10)", () => {
  test("profil Neutre : juste sous Adultes, jamais choisi d'après l'âge, aucun tirage limité par l'âge", () => {
    assert.deepEqual(Object.keys(PROFILES), ["PETITS", "MOYENS", "GRANDS", "ADULTES", "NEUTRE"]);
    assert.equal(PROFILES.NEUTRE.label, "Neutre (tous âges)");
    for (const age of [null, 3, 7, 10, 14, 40]) assert.notEqual(profileForAge(age), "NEUTRE");
    assert.equal(defaultDuration("NEUTRE"), defaultDuration("MOYENS"));
    // Les Petits n'ont que les cartes faciles ; le Neutre a tout le catalogue.
    assert.equal(mimePool({}, {}, "NEUTRE").length, MIME_CATALOG.length);
    assert.ok(mimePool({}, {}, "PETITS").length < MIME_CATALOG.length);
    // Pas de limite de mots : une longue question n'est jamais signalée « trop longue pour le profil ».
    const longue = { text: Array(40).fill("mot").join(" ") + " ?", choices: ["a", "b", "c", "d"], correct: 0 };
    assert.ok(!checkQuestions([longue], { profile: "NEUTRE" })[0].warnings.some((w) => /long pour le profil/.test(w)));
  });

  test("titre proposé d'office : « Anniversaire de » + le prénom, « d' » devant une voyelle", () => {
    assert.equal(titreAuto("Frédéric"), "Anniversaire de Frédéric");
    assert.equal(titreAuto("  Emma "), "Anniversaire d'Emma");
    assert.equal(titreAuto("Élise"), "Anniversaire d'Élise");
    assert.equal(titreAuto("Yanis"), "Anniversaire d'Yanis");
    assert.equal(titreAuto("Hugo"), "Anniversaire de Hugo");
    assert.equal(titreAuto(""), "");
    assert.equal(titreAuto(null), "");
  });

  test("manche Quiz : les questions tirées au 🎲 sont gardées dans la manche et jouées telles quelles, photo comprise", async () => {
    const M = await import("../web/public/manches.js");
    const P = await import("../web/public/banque-photos.js");
    const tirees = [
      { id: "qc-a", text: "Quel animal ?", choices: ["Le chat", "Le lion", "Le zèbre", "La vache"], correct: 1, banque: "qc-a" },
      { id: "qc-b", text: "Quelle couleur ?", choices: ["Rouge", "Bleu", "Vert", "Jaune"], correct: 3, emoji: "🌈" },
      { id: "jc-c", text: "Combien de pattes ?", nombre: true, correct: 8 },
      { vide: true, nombre: true }, // retirée, son 🎲 attend : pas jouée, pas gardée
      { text: "", choices: ["a", "b"], correct: 0 }, // vide : écartée
    ];
    const r = { type: "quiz", tirees, profil: "GRANDS", finale: 1, nbTirage: 8 };
    assert.equal(roundFilled(r), true);
    assert.equal(roundFilled({ type: "quiz", tirees: [] }), false);
    assert.equal(roundFilled({ type: "illustre", tirees }), false, "Seul le Quiz se tire au 🎲");
    const propre = M.cleanRound(r);
    assert.deepEqual(propre, { type: "quiz", tirees: tirees.slice(0, 3), profil: "GRANDS", finale: 1 });
    assert.equal(M.mancheSummary(propre), "3 questions tirées au hasard (Grands)");
    const { snapshot, problems } = buildSnapshot("s", { childName: "Léa", age: 13, rounds: [{ ...propre, bougies: false }] }, {});
    assert.deepEqual(problems, []);
    const qs = snapshot.quiz.questions;
    assert.deepEqual(qs.map((q) => [q.text, q.correct, q.kind, q.double, q.banque ?? null, q.image ?? null]),
      [["Quel animal ?", 1, "classic", false, "qc-a", null], ["Quelle couleur ?", 3, "classic", false, null, "🌈"], ["Combien de pattes ?", 8, "number", true, null, null]]);
    assert.equal("choices" in qs[2], false);
    // Une question sur quatre environ au Juste Chiffre (cedric, 23/10).
    assert.deepEqual([4, 5, 6, 8, 10, 12, 15].map(chiffresDuTirage), [1, 1, 1, 2, 2, 3, 4]);
    assert.equal(snapshot.rounds[0].title, "Quiz");
    // La régie copie la photo du quiz tout prêt (banque-quiz/) dans la partie, comme celles des petits (banque/).
    assert.equal(P.cheminPhotoBanque("qc-a"), "banque-quiz/qc-a.jpg");
    assert.equal(P.cheminPhotoBanque("vache"), "banque/vache.jpg");
    const lues = [];
    const [q1] = await P.resolveBanque([qs[0]], { photo: async (cle) => { lues.push(cle); return "data:image/jpeg;base64,AAAA"; }, ecrire: async () => {} });
    assert.deepEqual(lues, ["qc-a"]);
    assert.match(q1.imageId, /^[0-9a-f]{16}$/);
    assert.equal(q1.banque, undefined);
    // Un quiz choisi sur la deuxième ligne en plus (cedric, 23/10) : gardé avec son nombre ; ses N premières questions
    // suivent les questions tirées, la Super Finale termine le tout.
    const animaux = { title: "Animaux", questions: [...Array(5).keys()].map((i) => ({ text: `Animal ${i + 1} ?`, choices: ["Oui", "Non"], correct: 0, status: "validee" })) };
    const deux = M.cleanRound({ ...r, quizId: "animaux", count: 2 });
    assert.deepEqual(deux, { type: "quiz", tirees: tirees.slice(0, 3), profil: "GRANDS", quizId: "animaux", count: 2, finale: 1 });
    assert.equal(M.mancheSummary(deux, { quizzes: { animaux } }), "3 questions tirées au hasard (Grands) + Animaux");
    assert.equal((await import("../web/public/show.js")).jeuDeLaManche(deux, { animaux }).type, "quiz", "Pas un Quiz illustré");
    const ensemble = buildSnapshot("s", { childName: "Léa", age: 13, rounds: [{ ...deux, bougies: false }] }, { animaux });
    assert.deepEqual(ensemble.problems, []);
    assert.deepEqual(ensemble.snapshot.quiz.questions.map((q) => [q.text, q.double]),
      [["Quel animal ?", false], ["Quelle couleur ?", false], ["Combien de pattes ?", false], ["Animal 1 ?", false], ["Animal 2 ?", true]]);
    assert.equal(ensemble.snapshot.rounds[0].title, "Quiz + Animaux");
    // Le quiz choisi a disparu de la bibliothèque : on le dit, les questions tirées restent jouables.
    assert.match(buildSnapshot("s", { childName: "Léa", age: 13, rounds: [deux] }, {}).problems.join(), /le quiz n'existe plus/);
  });
});

describe("durée estimée d'une prestation (cedric, 23/10) : calculée toute seule, jamais saisie", () => {
  const quiz = (title, n) => ({ title, questions: [...Array(n).keys()].map((i) => ({ text: `${title} ${i + 1} ?`, choices: ["Oui", "Non"], correct: 0, status: "validee" })) });
  const LIB = { a: quiz("Animaux", 8), f: quiz("Finale", 2) };
  const MIMES = { d: { title: "Mimes", cards: [...Array(60).keys()].map((i) => ({ word: `Mot ${i + 1}` })) } };
  const D = DUREE_ESTIMEE;
  const play = (rounds, show = {}) => {
    const s = { age: 9, teams: 4, rounds, ...show };
    return { s, snapshot: buildSnapshot("s", s, LIB, MIMES, () => 0).snapshot };
  };
  // Le temps de jeu, plus une minute d'intro par jeu, l'accueil, le podium et 10 % de pauses, aux 5 minutes du dessus.
  const minutes = (jeu, jeux) => Math.ceil(((jeu + jeux * D.presentation + D.accueil + D.podium) * (1 + D.pauses)) / 300) * 5;

  test("chrono et réponse de chaque question, intro de chaque jeu, accueil, podium et pauses, arrondie aux 5 minutes", () => {
    const { s, snapshot } = play([{ type: "quiz", quizId: "a" }, { type: "statues", duration: 60 }]);
    const qs = snapshot.quiz.questions;
    assert.deepEqual(qs.map((q) => q.kind), [...Array(8).fill("classic"), "statues"]);
    const quizSec = qs.filter((q) => q.kind === "classic").reduce((t, q) => t + q.duration + D.apresQuestion, 0);
    assert.deepEqual(dureeEstimee(snapshot, s), { minutes: minutes(quizSec + 60 + D.apresStatues, 2), jeux: 2 });
    assert.equal(dureeEstimee(snapshot, s).minutes, 20, "8 questions à 9 ans et des statues : environ 20 minutes");
    assert.equal(dureeEstimee(null, s), null, "sans programme : rien à estimer");
  });

  test("elle suit ce qui est composé : un jeu de plus l'allonge, la Super Finale ne compte pas un jeu de plus", () => {
    const seul = play([{ type: "quiz", quizId: "a" }]);
    const plus = play([{ type: "quiz", quizId: "a" }, { type: "statues", duration: 90 }, { type: "statues", duration: 90 }]);
    assert.equal(dureeEstimee(seul.snapshot, seul.s).jeux, 1);
    assert.equal(dureeEstimee(plus.snapshot, plus.s).jeux, 3, "deux parties de statues : deux jeux présentés");
    assert.ok(dureeEstimee(plus.snapshot, plus.s).minutes > dureeEstimee(seul.snapshot, seul.s).minutes);
    for (const rounds of [[{ type: "quiz", quizId: "a", finale: 2 }], [{ type: "quiz", quizId: "a" }, { type: "finale", quizId: "f" }]]) {
      const { s, snapshot } = play(rounds);
      assert.ok(snapshot.quiz.questions.some((q) => q.finale));
      assert.equal(dureeEstimee(snapshot, s).jeux, 1, "la Super Finale termine son quiz, sans nouvelle intro");
    }
  });

  test("les mimes comptent chaque passage de chaque équipe : plus d'équipes, plus long", () => {
    const deux = play([{ type: "mimes", deckId: "d", perTeam: 3 }], { teams: 2 });
    const huit = play([{ type: "mimes", deckId: "d", perTeam: 3 }], { teams: 8 });
    const tour = deux.snapshot.quiz.questions[0].duration;
    assert.deepEqual(dureeEstimee(deux.snapshot, deux.s), { minutes: minutes(3 * 2 * (tour + D.apresMime), 1), jeux: 1 });
    assert.deepEqual(dureeEstimee(huit.snapshot, huit.s), { minutes: minutes(3 * 8 * (tour + D.apresMime), 1), jeux: 1 });
    const sansReglage = play([{ type: "mimes", deckId: "d" }], { teams: 4 });
    assert.deepEqual(dureeEstimee(sansReglage.snapshot, sansReglage.s), { minutes: minutes(D.mimesParEquipe * 4 * (tour + D.apresMime), 1), jeux: 1 }, "par défaut : deux mimes par équipe");
  });
});

describe("question des bougies (cedric, 21/10)", () => {
  const quiz = (title, n) => ({ title, questions: [...Array(n).keys()].map((i) => ({ text: `${title} ${i + 1} ?`, choices: ["Oui", "Non"], correct: 0, status: "validee" })) });
  const LIB = { a: quiz("Animaux", 3), b: quiz("Sport", 2), p: { ...quiz("Petits", 2), kind: "photo" } };
  const TEXTE = "Le Juste Chiffre : combien de bougies sur le gâteau de Léa cette année ?";
  const play = (rounds, show = {}) => buildSnapshot("s", { childName: " Léa ", age: 9, rounds, ...show }, LIB, {}, () => 0);
  const bougies = (snapshot) => snapshot.quiz.questions.filter((q) => q.text === TEXTE);

  test("d'office dans le premier Quiz : l'âge au Juste Chiffre, juste avant la Super Finale, sans compter double", () => {
    const { snapshot, problems } = play([{ type: "quiz", quizId: "a", finale: 1 }, { type: "quiz", quizId: "b" }]);
    assert.deepEqual(problems, []);
    assert.deepEqual(snapshot.quiz.questions.map((q) => [q.round, q.text, q.double ?? false]), [
      ["Animaux", "Animaux 1 ?", false], ["Animaux", "Animaux 2 ?", false], ["Animaux", TEXTE, false], ["Animaux", "Animaux 3 ?", true],
      ["Sport", "Sport 1 ?", false], ["Sport", "Sport 2 ?", false],
    ]);
    const [b] = bougies(snapshot);
    assert.deepEqual([b.kind, b.correct, b.duration, b.choices], ["number", 9, 20, undefined]);
    assert.deepEqual(snapshot.rounds[0], { title: "Animaux", count: 4, finale: 1 });
    // Sans Super Finale : la dernière question du quiz.
    assert.equal(play([{ type: "quiz", quizId: "a" }]).snapshot.quiz.questions.at(-1).text, TEXTE);
  });

  test("pas de question des bougies : case décochée, sans prénom ou sans âge, Quiz illustré, ni deux fois", () => {
    assert.deepEqual(bougies(play([{ type: "quiz", quizId: "a", bougies: false }]).snapshot), []);
    assert.deepEqual(bougies(play([{ type: "quiz", quizId: "a" }], { childName: "" }).snapshot), []);
    assert.deepEqual(bougies(play([{ type: "quiz", quizId: "a" }], { age: null }).snapshot), []);
    // Le Quiz illustré (tout-petits) n'est pas le premier Quiz : la question va au Quiz qui suit.
    const apres = play([{ type: "quiz", quizId: "p" }, { type: "quiz", quizId: "b" }]).snapshot;
    assert.deepEqual(apres.quiz.questions.filter((q) => q.text === TEXTE).map((q) => q.round), ["Sport"]);
    // Le quiz a déjà sa question des bougies (prestation de test « tous les jeux ») : pas une deuxième.
    const avec = { ...LIB.b, questions: [...LIB.b.questions, { text: "Combien de bougies pour Léa ?", kind: "number", correct: 9, status: "validee" }] };
    assert.equal(buildSnapshot("s", { childName: "Léa", age: 9, rounds: [{ type: "quiz", quizId: "b" }] }, { b: avec }).snapshot.quiz.questions.filter((q) => /bougie/i.test(q.text)).length, 1);
    // « 🔁 Rejouer » pendant la fête : jamais la question des bougies une deuxième fois.
    assert.deepEqual(bougies(play([{ type: "quiz", quizId: "a", hasard: true }]).snapshot), []);
    const deja = buildSnapshot("s", { childName: "Léa", age: 9, rounds: [{ type: "quiz", quizId: "a" }] }, LIB, {}, () => 0, {}, {}, { questions: [TEXTE.toLowerCase()] });
    assert.deepEqual(bougies(deja.snapshot), []);
  });

  test("la case décochée est enregistrée avec la manche, cochée elle n'est pas écrite", async () => {
    const M = await import("../web/public/manches.js");
    const S = await import("../web/public/show.js");
    assert.equal(M.cleanRound({ type: "quiz", quizId: "a", bougies: false }).bougies, false);
    assert.equal("bougies" in M.cleanRound({ type: "quiz", quizId: "a", bougies: null }), false);
    assert.equal(S.premierQuiz([{ type: "mimes" }, { type: "quiz", quizId: "p" }, { type: "quiz", quizId: "b" }], LIB)?.quizId, "b");
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
    // Choisi à la main : son image part avec lui ; tiré au hasard, jamais une image téléversée (cedric, 21/10).
    const { snapshot } = buildSnapshot("s", { age: 9, rounds: [{ type: "quisuis", picks: ["le koala"] }] }, {}, {}, Math.random, {}, contents);
    assert.equal(snapshot.quiz.questions[0].imageId, "0123456789abcdef");
    assert.equal(snapshot.quiz.questions[0].choices[0], "Le koala");
    const auHasard = buildSnapshot("s", { age: 9, rounds: [{ type: "quisuis" }] }, {}, {}, Math.random, {}, contents).snapshot.quiz.questions[0];
    assert.equal(auHasard.choices[0], "Le koala");
    assert.equal(auHasard.imageId, undefined);
  });

  test("Qui a disparu ? : objets par grille réglés sur la manche, et jamais deux fois la même famille", () => {
    const { snapshot } = buildSnapshot("s", { age: 7, rounds: [{ type: "disparu", count: 4, objects: 11 }, { type: "disparu", count: 4 }] }, {});
    const grids = snapshot.quiz.questions.filter((q) => q.kind === "disparu");
    assert.equal(grids.length, 8);
    assert.ok(grids.slice(0, 4).every((q) => q.cards.length === 11), "11 objets demandés sur la première manche");
    assert.ok(grids.slice(4).every((q) => q.cards.length === 4), "la seconde suit l'âge (6-8 ans : 4)");
    const family = (q) => DISPARU_THEMES.find((t) => q.cards.every((c) => t.objects.some((o) => o.word === c.word))).theme;
    assert.equal(new Set(grids.map(family)).size, 8, "8 familles différentes sur les deux manches");
    assert.equal(disparuObjects({ objects: 40 }, "MOYENS"), 6);
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
    // Mots choisis à la main : leurs photos partent avec eux (au hasard, jamais une photo téléversée).
    const { snapshot } = buildSnapshot("s", { age: 9, rounds: [{ type: "pictionary", picks: ["toboggan", "chat"] }] }, {}, {}, Math.random, {}, contents);
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
    const show = { age: 9, rounds: [{ type: "quiz", quizId: "b", quizIds: ["b", "a"] }] };
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
    const show = { age: 5, rounds: [{ type: "illustre", quizId: "petits", finale: 1 }, { type: "quiz", quizId: "culture" }] };
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

  test("tiré au hasard (« 🔁 Rejouer », cedric, 21/10) : chaque réponse en photo de la banque ou en émoji, jamais une image téléversée ; à la main, ses images", async () => {
    const P = await import("../web/public/banque-photos.js");
    const mes = (n) => [0, 1, 2, 3].map((k) => `${n}${k}`.repeat(8));
    const q = (text, choices, n) => ({ text, choices, correct: 0, status: "validee", choiceImages: mes(n) });
    const LEA = { title: "Les petits de Léa", kind: "photo", questions: [
      q("Où est le chat ?", ["Chat", "Chien", "Vache", "Lion"], 1),
      q("Où est la vache ?", ["Chat", "Chien", "Vache", "Lion"], 2),
      // « Doudou » : ni dans la banque, ni émoji.
      q("Où est le doudou ?", ["Doudou", "Chien", "Vache", "Lion"], 3),
      // « Poisson » : dans la banque sans photo (son émoji) ; « 🦄 Licorne » : l'émoji écrit dans la réponse.
      q("Où est le poisson ?", ["Poisson", "🦄 Licorne", "Cochon", "Lapin"], 4),
      q("Où est le mouton ?", ["Mouton", "Canard", "Poule", "Ours"], 5),
    ] };
    const lib = { lea: LEA };
    const siennes = new Set(LEA.questions.flatMap((x) => x.choiceImages));
    const avait = P.PHOTOS_BANQUE.delete("poisson");
    try {
      // Choisies à la main : ses images, exactement comme il les a mises.
      const main = S.buildSnapshot("s", { rounds: [{ type: "illustre", quizId: "lea", count: 2 }] }, lib).snapshot.quiz.questions;
      assert.deepEqual(main.map((x) => x.choiceImages), [mes(1), mes(2)]);
      assert.ok(main.every((x) => x.choiceBanque === undefined));
      // « 🔁 Rejouer » : 2 autres questions ; celle du doudou (rien de libre à montrer) est sautée, la suivante la remplace.
      const source = M.sourceRejouee("quiz", main, lib);
      assert.deepEqual(source, { type: "illustre", quizId: "lea", count: 2, hasard: true });
      const { questions, problems } = S.gameQuestions(source, lib, "PETITS", "x", {}, {}, {}, M.playedKeys(main));
      assert.deepEqual(problems, []);
      assert.deepEqual(questions.map((x) => x.text), ["Où est le poisson ?", "Où est le mouton ?"]);
      assert.ok(questions.every((x) => x.choiceImages === undefined && x.imageId === undefined && x.round === "Quiz illustré"), "jamais une image téléversée");
      assert.ok(!JSON.stringify(questions).match(new RegExp([...siennes].join("|"))), "aucun identifiant de ses images");
      assert.deepEqual(questions[0].choiceBanque, [{ emoji: "🐟" }, { emoji: "🦄" }, { cle: "cochon", emoji: "🐷" }, { cle: "lapin", emoji: "🐰" }]);
      assert.deepEqual(questions[1].choiceBanque.map((x) => x.cle), ["mouton", "canard", "poule", "ours"]);
      assert.deepEqual(P.imageLibre("Doudou"), null);
      // Plus assez de questions : la liste est plus courte, et le dit.
      const court = S.gameQuestions({ ...source, count: 4 }, lib, "PETITS", "x", {}, {}, {}, M.playedKeys(main));
      assert.deepEqual(court.questions.map((x) => x.text), ["Où est le poisson ?", "Où est le mouton ?"]);
      assert.match(court.problems.join(), /^Liste plus courte : il ne restait que 2 questions à reprendre au hasard \(1 écartée : une réponse en photo sans photo dans la banque ni émoji\)\.$/);
      // Rien de libre à montrer : rien n'est repris, et c'est dit.
      const rien = S.gameQuestions(source, { lea: { ...LEA, questions: [LEA.questions[2]] } }, "PETITS", "x");
      assert.equal(rien.questions.length, 0);
      assert.match(rien.problems.join(), /aucune question à reprendre au hasard/);
      // Le même quiz choisi à la main (même la question du doudou) : ses images.
      const tout = S.buildSnapshot("s", { rounds: [{ type: "illustre", quizId: "lea" }] }, lib).snapshot.quiz.questions;
      assert.deepEqual(tout.map((x) => x.choiceImages), [1, 2, 3, 4, 5].map(mes));
    } finally {
      if (avait) P.PHOTOS_BANQUE.add("poisson");
    }
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
    // Les photos des quiz sont téléversées : jamais tirées au hasard (cedric, 21/10).
    const few = M.randomRound("zoom", lib, { count: 6, groups: ["Photos"] }, seq());
    assert.equal(few.round, null);
    assert.equal(few.exhausted, true, "plus rien à tirer : c'est dit");
  });

  test("hasard (cedric, 21/10) : seulement les émojis et la banque de photos, jamais une image téléversée", () => {
    const photo = "c".repeat(16);
    assert.equal(S.imageTeleversee({ imageId: photo }), true);
    assert.equal(S.imageTeleversee({ banque: "chat" }), false);
    // Une carte perd sa photo et garde son émoji ; sans émoji ni photo de la banque, elle n'est pas tirée.
    assert.deepEqual(S.pourLeHasard("mimes", { word: "Chat", image: "🐱", imageId: photo }), { word: "Chat", image: "🐱" });
    assert.equal(S.pourLeHasard("mimes", { word: "Pochette", imageId: photo }), null);
    assert.deepEqual(S.pourLeHasard("pictionary", { word: "Pochette", imageId: photo }), { word: "Pochette" }, "un mot se dessine sans image");
    assert.equal(S.pourLeHasard("zoom", { text: "?", imageId: photo }), null, "photo d'un quiz : jamais");
    const banque = { text: "?", banque: "chat" };
    assert.equal(S.pourLeHasard("flou", banque), banque);
    const objets = (n, avecPhoto) => Array.from({ length: n }, (_, i) => ({ word: `Objet ${i}`, ...(avecPhoto ? { imageId: photo } : { image: "🍎" }) }));
    assert.equal(S.pourLeHasard("disparu", { theme: "Mes photos", objects: objets(6, true) }), null, "famille faite de mes photos");
    assert.deepEqual(S.pourLeHasard("disparu", { theme: "Mixte", objects: [...objets(5, false), { word: "X", image: "🎁", imageId: photo }] }).objects.at(-1), { word: "X", image: "🎁" });

    // Mimes : la photo de Sarah sur une carte du catalogue n'est jamais tirée, l'émoji du catalogue reste.
    const avecPhotos = { ...lib, mimes: { d: { title: "Mes photos", cards: [{ word: "Chat", imageId: photo }, { word: "Mon chien", imageId: photo }, { word: "Ma fusée", image: "🚀", imageId: photo }] } } };
    assert.ok(M.collectionItems("mimes", avecPhotos).find((x) => x.key === "chat").value.imageId, "à la main : sa photo");
    const auHasard = M.collectionItems("mimes", avecPhotos, { hasard: true });
    assert.ok(auHasard.every((x) => !x.value.imageId));
    assert.equal(auHasard.find((x) => x.key === "chat").value.image, "🐱");
    assert.equal(auHasard.find((x) => x.key === "mon chien"), undefined, "sans émoji : pas tirée");
    assert.deepEqual(auHasard.find((x) => x.key === "ma fusée").value, { word: "Ma fusée", image: "🚀" });
    const tirees = M.randomRound("mimes", avecPhotos, { count: 400 }, seq()).round.cards;
    assert.ok(tirees.length > 50 && tirees.every((c) => !c.imageId));
    // Zoom, Image floue : la banque seulement.
    assert.ok(M.collectionItems("zoom", lib, { hasard: true }).every((x) => x.key.startsWith("banque:")));
    assert.ok(M.randomRound("flou", lib, { count: 6 }, seq()).round.picks.every((k) => k.startsWith("banque:")));
  });

  test("hasard : un mot tiré ne montre pas l'image téléversée, le même mot choisi à la main la garde", () => {
    const photo = "d".repeat(16);
    const contents = { pictionary: { images: { chat: photo, pochette: photo }, extra: [{ word: "Pochette", series: "Mes mots" }] } };
    const libP = { ...lib, contents };
    const { round } = M.randomRound("pictionary", libP, { count: 60, groups: ["Animaux", "Mes mots"] }, seq());
    assert.deepEqual(round.hasard, round.picks, "les mots tirés sont notés");
    assert.ok(round.picks.includes("chat") && round.picks.includes("pochette"));
    const joue = (r) => S.buildSnapshot("s", { rounds: [r] }, {}, {}, seq(), {}, contents).snapshot.quiz.questions[0].cards;
    const auHasard = joue(round);
    assert.ok(auHasard.every((c) => !c.imageId), "aucune image téléversée");
    assert.equal(auHasard.find((c) => c.word === "Chat").image, "🐱");
    const aLaMain = joue({ type: "pictionary", picks: ["chat", "pochette"] });
    assert.ok(aLaMain.every((c) => c.imageId === photo), "choisis à la main : leurs images");
    // Mélange : tiré puis complété à la main.
    const melange = joue({ type: "pictionary", picks: ["chat", "pochette"], hasard: ["chat"] });
    assert.equal(melange.find((c) => c.word === "Chat").imageId, undefined);
    assert.equal(melange.find((c) => c.word === "Pochette").imageId, photo);
    // Tirage au lancement (aucun mot choisi) : jamais d'image téléversée.
    assert.ok(joue({ type: "pictionary" }).every((c) => !c.imageId));
    // Gardé dans la manche enregistrée.
    assert.deepEqual(M.cleanRound({ type: "pictionary", picks: ["chat", "pochette"], hasard: ["chat", "lune"] }).hasard, ["chat"]);
    assert.equal(M.cleanRound({ type: "pictionary", picks: ["chat"] }).hasard, undefined);
    // Qui suis-je ? (jeu intégré) : pareil.
    const qs = { quisuis: { images: Object.fromEntries(S.activeItems("quisuis", {}).map((x) => [S.contentSlot(x.answer.toLowerCase()), photo])) } };
    const builtin = S.buildSnapshot("s", { rounds: [{ type: "quisuis", count: 4 }] }, {}, {}, seq(), {}, qs).snapshot.quiz.questions;
    assert.equal(builtin.length, 4);
    assert.ok(builtin.every((q) => !q.imageId));
  });

  test("« 🔁 Rejouer » dans tous les jeux (cedric, 21/10) : mini-jeux tels quels, quiz avec d'autres questions", () => {
    assert.deepEqual(M.sourceRejouee("patate", [{ kind: "patate" }]), { type: "patate" });
    assert.deepEqual(M.sourceRejouee("coffres", [{ kind: "coffres" }]), { type: "coffres" });
    assert.deepEqual(M.sourceRejouee("gonfleur", [{ kind: "gonfleur" }]), { type: "gonfleur" });
    assert.deepEqual(M.sourceRejouee("statues", [{ kind: "statues", duration: 90, audioIds: ["4".repeat(16)] }]), { type: "statues", duration: 90, songs: ["4".repeat(16)] });
    assert.equal(M.sourceRejouee("mimes", [{ kind: "mime" }]), null, "tiré dans les collections : ailleurs");
    const quizzes = {
      a: { title: "Animaux", questions: Array.from({ length: 6 }, (_, i) => ({ text: `Animal ${i} ?`, choices: ["Oui", "Non"], correct: 0, status: "validee" })) },
      b: { title: "Autre", questions: [{ text: "Autre ?", choices: ["A", "B"], correct: 0, status: "validee" }] },
    };
    const show = { rounds: [{ type: "quiz", quizId: "a", count: 3 }] };
    const joues = S.buildSnapshot("s", show, quizzes).snapshot.quiz.questions;
    const source = M.sourceRejouee("quiz", joues, quizzes);
    assert.deepEqual(source, { type: "quiz", quizId: "a", count: 3, hasard: true });
    const avoid = M.playedKeys(joues);
    assert.deepEqual([...avoid.questions], ["animal 0 ?", "animal 1 ?", "animal 2 ?"]);
    const { questions } = S.gameQuestions(source, quizzes, "MOYENS", "x", {}, {}, {}, avoid);
    assert.deepEqual(questions.map((q) => q.text), ["Animal 3 ?", "Animal 4 ?", "Animal 5 ?"], "d'autres questions du même quiz");
    const tout = M.playedKeys([...joues, ...questions]);
    const fini = S.gameQuestions(source, quizzes, "MOYENS", "x", {}, {}, {}, tout);
    assert.equal(fini.questions.length, 0);
    assert.match(fini.problems.join(), /toutes ses questions ont déjà été posées pendant la fête/);
    // Sans [avoid] (prestation, quiz choisi à la main) : les premières questions, comme avant.
    assert.deepEqual(S.gameQuestions(source, quizzes, "MOYENS", "x").questions.map((q) => q.text), ["Animal 0 ?", "Animal 1 ?", "Animal 2 ?"]);
    assert.equal(M.sourceRejouee("quiz", joues, { b: quizzes.b }), null, "quiz effacé de la bibliothèque");
    assert.ok(M.REJOUES_TELS_QUELS.includes("statues"));
  });

  test("« 🔁 Rejouer » un quiz (cedric, 21/10) : les questions reprises ne montrent jamais ses images, le Quiz illustré prend les photos de la banque", () => {
    const photo = "c".repeat(16);
    const reponses = { 0: "d".repeat(16), 1: "e".repeat(16) };
    const q = (i, choices = ["Oui", "Non"]) => ({ text: `Q${i} ?`, choices, correct: 0, status: "validee", image: "🐶", imageId: photo, choiceImages: reponses });
    const animaux = ["Chat", "Chien"];
    const quizzes = {
      a: { title: "Pochettes", kind: "classique", questions: [q(0), q(1), q(2), q(3)] },
      p: { title: "Les petits", kind: "photo", questions: [q(4, animaux), q(5, animaux), q(6, animaux), q(7, animaux)] },
    };
    // À la main, dans la prestation : ses images, comme il les a mises.
    const main = S.buildSnapshot("s", { rounds: [{ type: "quiz", quizId: "a", count: 2 }] }, quizzes).snapshot.quiz.questions;
    assert.ok(main.every((x) => x.imageId === photo && x.choiceImages?.length === 2));
    const rejoue = S.gameQuestions(M.sourceRejouee("quiz", main, quizzes), quizzes, "MOYENS", "x", {}, {}, {}, M.playedKeys(main)).questions;
    assert.deepEqual(rejoue.map((x) => x.text), ["Q2 ?", "Q3 ?"]);
    assert.ok(rejoue.every((x) => x.imageId === undefined && x.choiceImages === undefined), "ni sa photo ni ses réponses en photos");
    assert.ok(rejoue.every((x) => x.image === "🐶" && x.choices.length === 2), "l'émoji et les réponses écrites restent");
    // Quiz illustré : rejoué comme Quiz illustré, chaque réponse en photo avec la photo libre de son mot dans la banque,
    // jamais celle téléversée (cedric, 21/10).
    const petits = S.buildSnapshot("s", { rounds: [{ type: "illustre", quizId: "p", count: 2 }] }, quizzes).snapshot.quiz.questions;
    assert.ok(petits.every((x) => x.choiceImages?.join() === `${"d".repeat(16)},${"e".repeat(16)}`), "à la main : ses photos");
    const source = M.sourceRejouee("quiz", petits, quizzes);
    assert.equal(source.type, "illustre");
    const illustre = S.gameQuestions(source, quizzes, "PETITS", "x", {}, {}, {}, M.playedKeys(petits)).questions;
    assert.deepEqual(illustre.map((x) => x.text), ["Q6 ?", "Q7 ?"]);
    assert.ok(illustre.every((x) => x.imageId === undefined && x.choiceImages === undefined && x.round === "Quiz illustré"), "jamais ses photos");
    assert.ok(illustre.every((x) => x.choiceBanque.map((c) => c.cle).join() === "chat,chien"), "les photos de la banque");
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

  test("Quiz illustré tiré au hasard : il évite ce que la fête a montré, et ce qu'il montre est évité ensuite", () => {
    const mes = (n) => [0, 1, 2, 3].map((k) => `${n}${k}`.repeat(8));
    const lib = { lea: { title: "Les petits", kind: "photo", questions: [
      { text: "Où est le lapin ?", choices: ["Lapin", "Chat", "Chien", "Vache"], correct: 0, status: "validee", choiceImages: mes(1) },
      { text: "Où est la girafe ?", choices: ["Girafe", "Singe", "Éléphant", "Lion"], correct: 0, status: "validee", choiceImages: mes(2) },
    ] } };
    const hasard = { type: "illustre", quizId: "lea", count: 1, hasard: true };
    assert.deepEqual(S.gameQuestions(hasard, lib, "PETITS", "x").questions.map((q) => q.text), ["Où est le lapin ?"], "rien de vu : dans l'ordre du quiz");
    // Le lapin a été mimé pendant la fête : la question de la girafe passe d'abord.
    const vu = M.playedKeys(S.buildSnapshot("s", { rounds: [{ type: "mimes", cards: [{ word: "Lapin", image: "🐰" }] }] }, {}).snapshot.quiz.questions);
    const [girafe] = S.gameQuestions(hasard, lib, "PETITS", "x", {}, {}, {}, vu).questions;
    assert.equal(girafe.text, "Où est la girafe ?");
    assert.ok(["m:girafe", "e:🦒", "m:lion", "e:🦁"].every((k) => J.questionConcepts(girafe).includes(k)), "ses réponses comptent, avec leurs émojis");
    // Tout est déjà vu : la question vient quand même.
    const tout = new Set([...vu.concepts, "m:girafe"]);
    assert.equal(S.gameQuestions(hasard, lib, "PETITS", "x", {}, {}, {}, { concepts: tout }).questions.length, 1);
    // Dans un même programme : les mimes tirés ensuite ne reprennent pas les animaux de ses réponses.
    const show = { rounds: [{ type: "mimes", cards: [{ word: "Lapin", image: "🐰" }] }, hasard, { type: "mimes", random: true, count: 100 }] };
    const qs = S.buildSnapshot("s", show, lib, {}, seq()).snapshot.quiz.questions;
    assert.equal(qs[1].text, "Où est la girafe ?");
    assert.ok(mots(qs[2].cards).every((w) => !["girafe", "singe", "elephant", "lion", "lapin"].includes(w)), mots(qs[2].cards).join());
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
    // Couplet, pré-refrain (chanté 2 fois), refrain (3 fois) : le hook tombe sur le refrain, pas sur le passage calme
    // juste avant (cedric, 21/10).
    const chanson = (t0, lignes) => lignes.map((x, i) => `[${String(Math.floor((t0 + i * 4) / 60)).padStart(2, "0")}:${String((t0 + i * 4) % 60).padStart(2, "0")}.00]${x}`);
    const pre = ["Le coeur qui bat si fort", "Dans le silence du soir"];
    const refrain = ["Tout le monde chante", "Les mains en l'air ce soir", "Encore une fois"];
    const structure = [
      ...chanson(10, ["Premier couplet ligne un", "Premier couplet ligne deux"]), ...chanson(18, pre), ...chanson(26, refrain),
      ...chanson(60, ["Second couplet ligne un", "Second couplet ligne deux"]), ...chanson(68, pre), ...chanson(76, refrain),
      ...chanson(120, refrain),
    ].join("\n");
    assert.equal(refrainDesParoles(lireLrc(structure)), 26, "le refrain, pas le pré-refrain");
    assert.equal(refrainDesParoles([]), null);
  });

  test("chaque fois que le refrain est chanté : la première phrase du refrain, une fois par refrain", () => {
    const l = (t, text) => ({ t, text });
    const refrain = (t0) => [l(t0, "Tout le monde chante"), l(t0 + 4, "Les mains en l'air"), l(t0 + 8, "Tout le monde chante")];
    const lignes = [l(10, "Premier couplet ici"), l(14, "La suite du couplet"), ...refrain(30), l(50, "Second couplet ici"), ...refrain(70), ...refrain(100)];
    // « Tout le monde chante » est reprise dans le même refrain (4 s après) : comptée une fois par refrain.
    assert.deepEqual(refrainsDesParoles(lignes), [30, 70, 100]);
    assert.equal(refrainDesParoles(lignes), 30);
    assert.deepEqual(refrainsDesParoles([l(1, "Une phrase"), l(2, "Deux phrases")]), []);
  });

  test("volume d'une chanson : là où elle explose (cedric, 21/10 : le vrai refrain, où qu'il soit)", () => {
    // Un son de 90 s mesuré par demi-seconde : [secondes, dB] par passage.
    const son = (...passages) => passages.flatMap(([s, db]) => Array(Math.round(s / PAS_VOLUME)).fill(db));
    // Couplet calme (-30 dB) jusqu'à 40 s, refrain fort (-12 dB) de 40 à 60 s, couplet, refrain de 70 à 90 s.
    const chanson = son([40, -30], [20, -12], [10, -30], [20, -12]);
    assert.equal(explosionDuVolume(chanson, { min: 15, max: 65 }), 40, "le premier refrain fort");
    assert.equal(explosionDuVolume(chanson, { min: 45, max: 65 }), null, "rien qui explose entre 45 et 65 s");
    // Un refrain final encore plus fort : le premier refrain reste choisi s'il sonne presque aussi fort.
    assert.equal(explosionDuVolume(son([40, -30], [20, -13], [10, -30], [20, -12]), { min: 15, max: 65 }), 40);
    // Volume égal partout (rien n'explose) : pas de proposition, la Régie PC prend le milieu.
    assert.equal(explosionDuVolume(son([90, -14]), { min: 15, max: 65 }), null);
    assert.equal(explosionDuVolume([], {}), null);

    // Avec les paroles : le refrain chanté à 30 et 70 s, mais la musique n'explose qu'à 36 et 76 s (les mots du refrain
    // commencent sur une montée douce) : le hook va sur l'explosion, une demi-seconde avant.
    const montee = son([36, -30], [14, -12], [26, -30], [14, -12]);
    assert.equal(refrainAuVolume(montee, [30, 70]), 35.5);
    // La musique explose 1 s avant les mots : le hook part de l'explosion.
    const pile = son([29, -30], [21, -12], [19, -30], [21, -12]);
    assert.equal(refrainAuVolume(pile, [30, 70]), 28.5);
    // Un premier refrain chanté doucement (piano-voix), le second fort : le second.
    const doux = son([30, -30], [20, -24], [20, -30], [20, -12]);
    assert.equal(refrainAuVolume(doux, [30, 70]), 69.5);
    // Sans volume (fichier illisible) : 1 s avant les mots, comme avant.
    assert.equal(refrainAuVolume(null, [30, 70]), 29);
    assert.equal(refrainAuVolume(montee, []), null);
  });

  test("volume d'un son : décibels par demi-seconde, sur tous les canaux", () => {
    const rate = 1000;
    const plein = new Float32Array(rate * 2).fill(0.5);
    const silence = new Float32Array(rate * 2);
    const db = volumes([plein, silence], rate);
    assert.equal(db.length, 4);
    // Moitié des échantillons à 0,5 : RMS 0,354, soit -9 dB.
    assert.ok(db.every((x) => Math.abs(x + 9) < 0.1), JSON.stringify(db));
    assert.deepEqual(volumes([silence], rate), [-90, -90, -90, -90]);
  });

  test("les premiers mots chantés : la première vraie phrase, sans les petits bruits", () => {
    assert.equal(debutDesParoles(lireLrc(LRC)), 5);
    assert.equal(debutDesParoles(lireLrc("[00:02.00]♪\n[00:04.00]Oh\n[00:17.50]Voici les premiers mots")), 17.5);
    assert.equal(debutDesParoles(lireLrc("[00:03.00]♪♪")), null);
    assert.equal(debutDesParoles([]), null);
  });

  test("fenêtre des paroles (cedric, 23/10) : la phrase chantée à un moment de la chanson", () => {
    const lignes = lireLrc("[00:05.00]Un\n[00:09.50]Deux\n[00:20.00]\n[00:21.00]Trois");
    assert.equal(ligneAuMoment(lignes, 0), -1, "avant la première phrase");
    assert.equal(ligneAuMoment(lignes, 5), 0);
    assert.equal(ligneAuMoment(lignes, 9.49), 0);
    assert.equal(ligneAuMoment(lignes, 9.5), 1);
    assert.equal(ligneAuMoment(lignes, 20.5), 2, "le blanc entre deux phrases compte");
    assert.equal(ligneAuMoment(lignes, 300), 3);
    assert.equal(ligneAuMoment([], 10), -1);
    assert.equal(ligneAuMoment(null, 10), -1);
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

  test("une chanson effacée pour de bon ne revient pas par ses playlists ; les comptines des prestations de test non plus", () => {
    // Effacée pour de bon : le morceau garde son numéro de chanson, qui n'existe plus.
    const effacee = { p1: { ...playlists.p1, tracks: [playlists.p1.tracks[0], { ...playlists.p1.tracks[1], songId: "s2" }] }, p2: { title: "Anciens tubes", tracks: { 0: { title: "Libérée délivrée (bis)", audioId: C, songId: "s2" } } } };
    assert.deepEqual(songList(songs, effacee).map((x) => x.title), ["Hakuna Matata"]);
    const test = { ...playlists, "test-lea-tous-les-jeux-comptines": { title: "TEST – Comptines", tracks: [{ title: "Frère Jacques", audioId: "1111111111111111" }, { title: "Hakuna Matata", audioId: A }] } };
    const list = songList(songs, test);
    assert.deepEqual(list.map((x) => x.title), ["Hakuna Matata", "Libérée, délivrée"]);
    assert.deepEqual(list[0].lists.map((l) => l.id), ["p1", "test-lea-tous-les-jeux-comptines"], "une vraie chanson dit toujours où elle est");
    // Les anciens morceaux de son extrait reçoivent le numéro, playlist datée ; ni les statues ni les morceaux déjà rangés.
    const avecStatues = { ...playlists, st: { title: "Statues", use: "statues", tracks: [{ title: "Danse", audioId: C }] } };
    assert.deepEqual(marquerEffacees("s2", C, avecStatues, "maintenant"), {
      "library/playlists/p1/tracks/1/songId": "s2", "library/playlists/p1/updatedAt": "maintenant",
      "library/playlists/p2/tracks/0/songId": "s2", "library/playlists/p2/updatedAt": "maintenant",
    });
    assert.deepEqual(marquerEffacees("s9", A, playlists, "maintenant"), {}, "morceau déjà rangé : rien à marquer");
    assert.deepEqual(marquerEffacees("s9", undefined, playlists, "maintenant"), {});
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

  test("Quiz illustré tiré au hasard : au chargement, chaque réponse prend la photo de la banque ou l'émoji dessiné, rangés avec les réponses en images", async () => {
    const { imageId } = await import("../web/public/illustration.js");
    const photos = { chat: "data:image/jpeg;base64,Q0hBVA==" };
    const ecrits = [];
    const dessins = [];
    const questions = [
      // Le chien en carte de Mimes (sans photo : la carte garde son émoji) et en réponse (sans photo : son émoji dessiné).
      { kind: "mime", cards: [{ word: "Chien", image: "🐶", banque: "chien" }] },
      { kind: "classic", text: "Où est le chat ?", choices: ["Chat", "Chien", "🦄 Licorne", "Bla"], correct: 0,
        choiceBanque: [{ cle: "chat", emoji: "🐱" }, { cle: "chien", emoji: "🐶" }, { emoji: "🦄" }, null] },
    ];
    const avant = JSON.stringify(questions);
    const [carte, out] = await P.resolveBanque(questions, {
      photo: async (cle) => photos[cle] ?? null,
      secours: async (m) => { dessins.push(m.emoji); return `data:image/jpeg;base64,${Buffer.from(m.emoji).toString("base64")}`; },
      ecrire: async (dir, id, data) => { ecrits.push([dir, id, data]); },
    });
    assert.equal(JSON.stringify(questions), avant, "les questions d'origine ne sont pas touchées");
    assert.equal(out.choiceBanque, undefined, "la TV et les pupitres ne reçoivent que des identifiants");
    assert.equal(out.choiceImages.length, 4);
    assert.equal(out.choiceImages[0], await imageId(photos.chat), "la photo du chat de la banque");
    assert.ok(out.choiceImages.slice(0, 3).every((id) => /^[0-9a-f]{16}$/.test(id)));
    assert.equal(out.choiceImages[3], "", "réponse sans image : écrite");
    assert.deepEqual(dessins.sort(), ["🐶", "🦄"].sort(), "photo absente : l'émoji dessiné");
    assert.deepEqual(carte.cards, [{ word: "Chien", image: "🐶" }], "la carte de mimes garde son émoji");
    assert.equal(ecrits.length, 3);
    assert.ok(ecrits.every(([dir]) => dir === "choiceImages"), "rangées avec les réponses en images");
    // Rien à copier : la question reste écrite.
    const [ecrite] = await P.resolveBanque([{ kind: "classic", choices: ["Bla", "Bli"], choiceBanque: [null, null] }], { photo: async () => null, ecrire: async () => {} });
    assert.deepEqual(ecrite, { kind: "classic", choices: ["Bla", "Bli"] });
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
    // 4 au moins (cedric, 27/10 : un tour de 4 cartes).
    assert.equal(S.contentExtras("disparu", { extra: [{ theme: "Juste assez", objects: objets.slice(0, 4) }] }).length, 1);
    assert.equal(S.contentExtras("disparu", { extra: [{ theme: "Trop peu", objects: objets.slice(0, 3) }] }).length, 0);
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
    assert.deepEqual(u.get("2222222222222222").ou, ["Chanson « Hakuna Matata »"]);
    const mes = B.mesImages({ [ID2]: { name: "Toutou", cat: "Famille et amis", tags: "chien, doudou", createdAt: 5 }, [ID]: { name: "Minou", hidden: true, createdAt: 9 } }, u);
    assert.deepEqual(mes.map((x) => [x.nom, x.cat, x.retiree, x.fiche]), [
      ["Minou", "À ranger", true, true], ["Toutou", "Famille et amis", false, true],
      ["Le koala", "À ranger", false, false], ["Hakuna Matata", "À ranger", false, false],
    ]);
    assert.deepEqual(mes[1].tags, ["chien", "doudou"]);
    assert.deepEqual(mes[1].ou, ["Quiz « Léa »"]);
  });

  test("les pochettes (cedric, 22/10) : à part de ses images, celles des chansons toutes seules, gardées après l'effacement", () => {
    const C1 = "c1c1c1c1c1c1c1c1", C2 = "c2c2c2c2c2c2c2c2", C3 = "c3c3c3c3c3c3c3c3", C4 = "c4c4c4c4c4c4c4c4", PERSO = "a5a5a5a5a5a5a5a5";
    const lib = {
      quizzes: { a: { title: "Léa", questions: [{ text: "?", choices: ["Elsa", "Anna"], correct: 0, imageId: PERSO, choiceImages: { 1: C2 } }] } },
      songs: {
        s1: { title: "Libérée, délivrée", artist: "Anaïs Delva", imageId: C1 },
        s2: { title: "Hakuna Matata", artist: "Disney", imageId: C2, retiree: true },
        s3: { title: "Sans pochette" },
      },
      playlists: { p: { title: "Disney", tracks: [{ title: "Libérée, délivrée", artist: "Anaïs Delva", imageId: C1 }, { title: "Un jour mon prince viendra", imageId: C3 }] } },
    };
    const u = B.imagesUtilisees(lib);
    const cov = B.pochettesUtilisees(lib);
    assert.deepEqual([...cov.keys()].sort(), [C1, C2, C3]);
    // Mots-clés séparés aux virgules, comme ceux d'une fiche : la recherche trouve chaque mot.
    assert.deepEqual(cov.get(C1), { nom: "Anaïs Delva – Libérée, délivrée", tags: ["Anaïs Delva", "Libérée", "délivrée"] });
    assert.equal(cov.get(C3).nom, "Un jour mon prince viendra");
    const medias = {
      // Chanson effacée pour de bon : sa pochette garde sa fiche « Pochettes ».
      [C4]: { name: "Aya Nakamura – Djadja", cat: B.POCHETTES, tags: "Aya Nakamura, Djadja", createdAt: 3 },
      // Sa photo à elle, rangée dans ses catégories : elle reste dans « Mes images », même utilisée comme pochette.
      [C3]: { name: "Blanche-Neige", cat: "Dessins animés", createdAt: 4 },
      [PERSO]: { name: "Elsa", cat: "Dessins animés", createdAt: 5 },
    };
    const mes = B.mesImages(medias, u, cov);
    assert.deepEqual(mes.map((x) => x.nom).sort(), ["Blanche-Neige", "Elsa"], "aucune pochette dans « Mes images »");
    const poch = B.mesPochettes(medias, cov, u);
    assert.deepEqual(poch.map((x) => [x.nom, x.groupe, x.cat, x.fiche]), [
      ["Anaïs Delva – Libérée, délivrée", "pochettes", B.POCHETTES, false],
      ["Aya Nakamura – Djadja", "pochettes", B.POCHETTES, true],
      ["Disney – Hakuna Matata", "pochettes", B.POCHETTES, false],
    ], "par artiste ; la chanson supprimée garde sa pochette");
    assert.deepEqual(poch[1].tags, ["Aya Nakamura", "Djadja"]);
    // Une pochette aussi utilisée dans un quiz le dit, et se trouve par l'artiste ou le titre.
    assert.deepEqual(poch[2].ou, ["Quiz « Léa »", "Chanson « Hakuna Matata »"]);
    assert.ok(B.correspond(poch[0], "anais liberee") && B.correspond(poch[1], "djadja") && !B.correspond(poch[1], "elsa"));
    // Une fiche sans catégorie (nommée à la main quand elle était « À ranger ») d'une pochette : dans les pochettes.
    const nommee = B.mesPochettes({ [C1]: { name: "Reine des neiges", hidden: true, createdAt: 1 } }, cov, u);
    assert.deepEqual(nommee.find((x) => x.id === C1), { groupe: "pochettes", id: C1, nom: "Reine des neiges", cat: B.POCHETTES, tags: ["Anaïs Delva", "Libérée", "délivrée"], retiree: true, ou: ["Chanson « Libérée, délivrée »", "Playlist « Disney »"], fiche: true });
    assert.equal(B.mesImages({ [C1]: { name: "Reine des neiges", createdAt: 1 } }, u, cov).some((x) => x.id === C1), false);
    assert.equal(B.nomPochette({ title: " Titre ", artist: "" }), "Titre");
    assert.equal(B.GROUPES_IMAGES.pochettes, "💿 Pochettes");
  });

  test("Images des packs (cedric, 25/10) : à part de « Mes images » et des photos libres, rangées par thème du pack", () => {
    const [P1, P2, P3, MIENNE, RANGEE] = ["a1a1a1a1a1a1a1a1", "a2a2a2a2a2a2a2a2", "a3a3a3a3a3a3a3a3", "b1b1b1b1b1b1b1b1", "a4a4a4a4a4a4a4a4"];
    const quizzes = {
      hp: { title: "Harry Potter – Moyen", theme: "Harry Potter", source: "json", pack: true, questions: [
        { text: "La chouette ?", choices: ["Croûtard", "Hedwige"], correct: 1, imageId: P1 },
        { text: "Qui ?", choices: ["Ron", "Harry"], correct: 0, choiceImages: { 0: P2, 1: RANGEE } }] },
      // Ancien pack importé avant le ZIP (source « json ») : aussi un pack.
      vieux: { title: "Vieux pack", source: "json", questions: [{ text: "?", choices: ["A", "B"], correct: 0, imageId: P3 }] },
      // Son quiz à elle : ses images restent les siennes.
      mien: { title: "Mon quiz", source: "saisie", questions: [{ text: "?", choices: ["A", "B"], correct: 0, imageId: MIENNE }] },
    };
    const lib = { quizzes };
    const u = B.imagesUtilisees(lib);
    const packs = B.imagesDesPacks(quizzes);
    assert.deepEqual([...packs.keys()].sort(), [P1, P2, P3, RANGEE].sort());
    assert.deepEqual(packs.get(P1), { nom: "Hedwige", theme: "Harry Potter", pack: "Harry Potter – Moyen" });
    // Une image de pack qu'elle range dans une de ses catégories passe dans « Mes images ».
    const medias = { [RANGEE]: { name: "Harry", cat: "Films et séries", createdAt: 1 }, [P2]: { name: "Ron", cat: B.PACKS, hidden: true, createdAt: 2 } };
    const mes = B.mesImages(medias, u, new Map(), packs);
    assert.deepEqual(mes.map((x) => x.id).sort(), [MIENNE, RANGEE].sort(), "aucune image de pack dans « Mes images »");
    const dePacks = B.mesImagesDePacks(medias, packs, u, new Map());
    assert.deepEqual(dePacks.map((x) => [x.id, x.groupe, x.cat, x.nom, x.retiree]), [
      [P1, "packs", "Harry Potter", "Hedwige", false], [P2, "packs", "Harry Potter", "Ron", true], [P3, "packs", "Vieux pack", "A", false],
    ]);
    assert.ok(B.correspond(dePacks[0], "harry potter"), "le nom du pack et son thème se cherchent");
    assert.equal(B.estQuizPack(quizzes.mien), false);
    assert.equal(B.GROUPES_IMAGES.packs, "📦 Images des packs");
    assert.deepEqual(Object.keys(B.GROUPES_IMAGES), ["packs", "emojis", "photos", "miennes", "pochettes"], "les images des packs d'abord (cedric, 25/10)");
  });

  test("images nommées à l'import (cedric, 25/10) : leur nom, leur thème même sans pack qui les cite, et le nom se cherche", () => {
    const [CITEE, LIBRE, LONGUE] = ["c1c1c1c1c1c1c1c1", "c2c2c2c2c2c2c2c2", "c3c3c3c3c3c3c3c3"];
    const theme = "Super Mario Bros et tous leurs amis du royaume";
    const quizzes = { m: { title: "Zoom Mario", theme: "Mario", source: "photos", pack: true, kind: "images", questions: [{ text: "?", choices: ["Yoshi"], correct: 0, imageId: CITEE }] },
      l: { title: "Long", theme, source: "json", pack: true, questions: [{ text: "?", choices: ["A", "B"], correct: 0, imageId: "c4c4c4c4c4c4c4c4" }] } };
    assert.equal(B.catDePack("Mario"), "📦 Mario");
    assert.ok(B.catDePack(theme).length <= 40, "catégorie à la limite de la base");
    assert.equal(B.themeDeFiche({ cat: "📦 Mario" }), "Mario");
    assert.equal(B.themeDeFiche({ cat: B.PACKS }), null);
    const medias = {
      [CITEE]: { name: "Yoshi sur son kart", cat: B.catDePack("Mario"), createdAt: 1 },
      [LIBRE]: { name: "Toad", cat: B.catDePack("Mario"), createdAt: 2 },
      [LONGUE]: { name: "Luigi", cat: B.catDePack(theme), createdAt: 3 },
    };
    const packs = B.imagesDesPacks(quizzes);
    const u = B.imagesUtilisees({ quizzes });
    assert.deepEqual(B.mesImages(medias, u, new Map(), packs), [], "aucune dans « Mes images »");
    const dePacks = B.mesImagesDePacks(medias, packs, u, new Map());
    assert.deepEqual(dePacks.filter((x) => x.id !== "c4c4c4c4c4c4c4c4").map((x) => [x.id, x.cat, x.nom]).sort(), [
      [CITEE, "Mario", "Yoshi sur son kart"], [LIBRE, "Mario", "Toad"], [LONGUE, theme, "Luigi"]].sort(), "un thème coupé retrouve celui de son pack");
    assert.ok(B.correspond(dePacks.find((x) => x.id === LIBRE), "toad"));
  });

  test("🗑 Supprimer un thème (cedric, 26/10) : ses images partent avec ses packs, sauf celles que quelque chose d'autre utilise ou rangées dans Mes images", () => {
    const I = (k) => `${k}`.repeat(16).slice(0, 16);
    const packs = {
      p1: { title: "Mario Facile", theme: "Mario", pack: true, questions: [{ text: "Qui ?", choices: ["Yoshi", "Toad", "Luigi", "Peach"], correct: 0, imageId: I(1) }] },
      p2: { title: "Mario illustré", theme: "Mario", pack: true, kind: "photo", questions: [{ text: "Lequel ?", choices: ["A", "B", "C", "D"], correct: 0, choiceImages: { 0: I(2), 1: I(3) }, imageId: I(4) }],
        imagesHorsFormat: { [I(2)]: "trop petite" } },
    };
    const medias = {
      [I(5)]: { name: "Toad", cat: B.catDePack("Mario"), createdAt: 1 }, // nommée à l'import, citée par aucun pack
      [I(6)]: { name: "Bowser", cat: B.catDePack("K-pop"), createdAt: 1 }, // un autre thème
      [I(3)]: { name: "Mon chat", cat: "Animaux", createdAt: 1 }, // dans Mes images
    };
    const ailleurs = {
      quizzes: { kpop: { title: "K-pop", theme: "K-pop", pack: true, questions: [{ text: "Qui ?", choices: ["Rumi", "B", "C", "D"], correct: 0, imageId: I(6) }] } },
      shows: { zoe: { rounds: [{ type: "quiz", seriesQuiz: [{ origine: "biblio", questions: [{ text: "Qui ?", imageId: I(4) }] }] }] } },
    };
    const duTheme = (f) => B.themeDeFiche(f) === "Mario";
    assert.deepEqual(B.imagesDuTheme({ packs, medias, duTheme, ailleurs }), [I(1), I(2), I(5)].sort(),
      "I(3) est dans Mes images, I(4) est copiée dans la prestation de Zoé, I(6) est à un autre thème");
    assert.deepEqual(B.imagesDuTheme({ packs: {}, medias, duTheme }), [I(5)]);
    assert.deepEqual([...B.imagesCitees({ a: { [I(7)]: "x", b: [I(8), "abc"] } })].sort(), [I(7), I(8)]);
    // 🧹 Images orphelines : sans fiche ou d'un thème disparu, que rien ne cite ; jamais Mes images ni un thème vivant.
    const fiches = { [I(1)]: { name: "Woody", cat: B.catDePack("Pixar") }, [I(2)]: { name: "Rumi", cat: B.catDePack("K-pop") },
      [I(3)]: { name: "Chat", cat: "Animaux" }, [I(4)]: { name: "Vieille", cat: B.PACKS } };
    assert.deepEqual(B.imagesOrphelines({ ids: [1, 2, 3, 4, 5, 6].map(I), medias: fiches, citees: new Set([I(6)]), themeVivant: (f) => B.themeDeFiche(f) === "K-pop" }),
      [I(1), I(4), I(5)].sort());
    // 🗑 Tout effacer : la question ou le personnage qui montre une image effacée part de sa liste ; une série vidée
    // part aussi ; le reste de la prestation ne bouge pas.
    const show = { childName: "Lou", rounds: [
      { type: "quiz", seriesQuiz: [
        { id: "a", origine: "biblio", questions: [{ text: "Q1", imageId: I(1) }, { text: "Q2", choiceImages: { 0: I(2), 1: "" } }] },
        { id: "b", origine: "de", questions: [{ text: "Q3", imageId: I(3) }, { text: "Q4", imageId: I(9) }] }], ordreQuiz: ["a:0", "b:1"] },
      { type: "quisuis", seriesMots: [{ id: "c", mots: [{ answer: "Yoshi", imageId: I(1) }, { answer: "Lion" }] }] },
      { type: "statues", duration: 60 }] };
    const { valeur, retires } = B.sansImages(show, new Set([I(1), I(2), I(3)]));
    assert.equal(retires, 4);
    assert.deepEqual(valeur, { childName: "Lou", rounds: [
      { type: "quiz", seriesQuiz: [{ id: "b", origine: "de", questions: [{ text: "Q4", imageId: I(9) }] }], ordreQuiz: ["a:0", "b:1"] },
      { type: "quisuis", seriesMots: [{ id: "c", mots: [{ answer: "Lion" }] }] },
      { type: "statues", duration: 60 }] });
    assert.deepEqual(B.sansImages(show, new Set([I(7)])), { valeur: show, retires: 0 });
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

describe("nettoyage des copies des fêtes terminées (Régie PC, cedric, 21/10)", async () => {
  const N = await import("../web/public/nettoyage.js");
  const H = 3600_000;
  const MAINTENANT = Date.parse("2026-10-21T12:00:00Z");
  const S1 = "1111111111111111", S2 = "2222222222222222", PERDU = "dddddddddddddddd";
  const I1 = "aaaaaaaaaaaaaaaa", BANQUE = "bbbbbbbbbbbbbbbb", C1 = "cccccccccccccccc";
  const bibliotheque = { sounds: new Set([S1, S2]), images: new Set([I1, C1]) };
  const classer = (partie) => N.classerPartie({ code: "FETE1", sounds: [S1], images: [I1], choiceImages: [C1], ...partie }, { maintenant: MAINTENANT, bibliotheque });

  test("24 h après la fin notée, ou 48 h après la création sans heure de fin ; jamais une partie en cours ou interrompue", () => {
    const fin = classer({ phase: "ended", endedAt: MAINTENANT - 25 * H, createdAt: MAINTENANT - 28 * H });
    assert.equal(fin.decision, "nettoyer");
    assert.equal(fin.raison, "Terminée depuis plus de 24 h");
    assert.deepEqual(fin.effacer, { sounds: [S1], images: [I1], choiceImages: [C1] });
    assert.equal(classer({ phase: "ended", createdAt: MAINTENANT - 49 * H }).raison, "Terminée sans heure de fin, créée il y a plus de 48 h");
    // Gardées, avec la raison en clair ; une fête terminée dit quand elle deviendra bonne à nettoyer.
    const recente = classer({ phase: "ended", endedAt: MAINTENANT - 23 * H, createdAt: MAINTENANT - 100 * H });
    assert.deepEqual([recente.decision, recente.raison, recente.mo], ["garder", "Terminée depuis moins de 24 h", 0]);
    assert.equal(recente.prochain, MAINTENANT + H + N.MARGE_MS);
    assert.equal(classer({ phase: "ended", createdAt: MAINTENANT - 47 * H }).raison, "Terminée sans heure de fin, créée il y a moins de 48 h");
    for (const phase of ["lobby", "question", "reveal", null]) {
      const r = classer({ phase, endedAt: MAINTENANT - 30 * 24 * H, createdAt: MAINTENANT - 31 * 24 * H });
      assert.deepEqual([r.decision, r.raison, r.prochain], ["garder", "Partie en cours ou interrompue : elle peut encore être reprise", null], `phase ${phase}`);
    }
    // Prestation archivée, date passée depuis longtemps : sans fin notée par la TV, la partie reste reprenable.
    assert.equal(classer({ phase: "question", createdAt: MAINTENANT - 90 * 24 * H, status: "archivee", date: "2026-07-01", takeover: { to: "box2" } }).raison,
      "Partie en cours ou interrompue : elle peut encore être reprise");
    assert.equal(classer({ phase: "ended" }).raison, "Terminée sans date lisible : gardée par prudence");
    assert.equal(classer({ phase: "ended", endedAt: "hier", createdAt: MAINTENANT - 100 * H }).decision, "garder");
    assert.equal(classer({ phase: "ended", endedAt: MAINTENANT - 25 * H, sounds: [], images: [], choiceImages: [] }).raison, "Aucune copie à effacer");
    // Juste à la limite : la marge laisse au serveur le temps de la trouver assez ancienne lui aussi.
    assert.equal(classer({ phase: "ended", endedAt: MAINTENANT - 24 * H - 60_000 }).decision, "garder");
  });

  test("seulement ce qu'un prochain lancement refera : un extrait dont la chanson a quitté la bibliothèque est gardé", () => {
    const r = classer({ phase: "ended", endedAt: MAINTENANT - 30 * H, sounds: [S1, PERDU], images: [I1, BANQUE], choiceImages: [C1] });
    assert.equal(r.decision, "nettoyer");
    assert.deepEqual(r.effacer, { sounds: [S1], images: [I1, BANQUE], choiceImages: [C1] });
    assert.deepEqual(r.gardes, [PERDU]);
    assert.deepEqual(r.notes, ["1 extrait gardé : la chanson n'est plus dans la bibliothèque",
      "1 photo de la banque du site ou émoji dessiné : refaits au prochain lancement"]);
    assert.equal(r.mo, N.MO_MOYEN.sounds + 2 * N.MO_MOYEN.images + N.MO_MOYEN.choiceImages);
    // Rien d'autre que des extraits orphelins : la partie est gardée, pour cette raison.
    const seuls = classer({ phase: "ended", endedAt: MAINTENANT - 30 * H, sounds: [PERDU, "eeeeeeeeeeeeeeee"], images: [], choiceImages: [] });
    assert.deepEqual([seuls.decision, seuls.raison, seuls.gardes.length], ["garder", "2 extraits gardés : la chanson n'est plus dans la bibliothèque", 2]);
    // Un code que le journal refuserait : gardée.
    assert.equal(classer({ code: "A.B", phase: "ended", endedAt: MAINTENANT - 30 * H }).raison, "Code de partie inattendu : gardée par prudence");
  });

  test("bilan : parties, à nettoyer, Mo environ, gardées par raison, extraits gardés ; une seule écriture par partie", () => {
    const parties = [
      classer({ phase: "ended", endedAt: MAINTENANT - 30 * H }),
      classer({ phase: "ended", createdAt: MAINTENANT - 50 * H, sounds: [S1, PERDU], images: [], choiceImages: [] }),
      classer({ phase: "ended", endedAt: MAINTENANT - 2 * H }),
      classer({ phase: "question" }),
      classer({ phase: "lobby", sounds: [], images: [], choiceImages: [] }),
      classer({ phase: "ended", endedAt: MAINTENANT - 2 * H, sounds: [], images: [], choiceImages: [] }),
    ];
    const b = N.bilan(parties);
    assert.deepEqual({ ...b, mo: Math.round(b.mo * 1000) / 1000 }, {
      parties: 6, aNettoyer: 2, copiesAEffacer: 4, mo: Math.round((2 * N.MO_MOYEN.sounds + N.MO_MOYEN.images + N.MO_MOYEN.choiceImages) * 1000) / 1000,
      gardees: [["Partie en cours ou interrompue : elle peut encore être reprise", 1], ["Terminée depuis moins de 24 h", 1], ["Aucune copie à effacer", 2]],
      copiesGardees: { enCours: 3, recente: 3, orphelins: 1 },
      extraitsGardes: 1, prochain: MAINTENANT + 22 * H + N.MARGE_MS,
    });
    // Journal : les copies gardées en clair, dans l'ordre des raisons.
    assert.equal(N.texteGardees(b.copiesGardees), "3 (partie en cours ou interrompue), 3 (terminée depuis moins de 24 h), 1 (chanson plus dans la bibliothèque)");
    assert.equal(N.texteGardees({ pirate: 2 }), "");
    assert.deepEqual(N.effacements("FETE1", parties[0].effacer), {
      [`games/FETE1/sounds/${S1}`]: null, [`games/FETE1/images/${I1}`]: null, [`games/FETE1/choiceImages/${C1}`]: null,
    });
    assert.equal(N.texteMo(1.3449), "1,3 Mo");
    assert.equal(N.texteMo(0.02), "moins de 0,1 Mo");
    assert.equal(N.texteMo(0), "0,0 Mo");
  });

  test("passage automatique à l'ouverture : une fois par heure au plus, le premier quand le journal est vide", () => {
    assert.equal(N.passageAFaire(undefined, MAINTENANT), true);
    assert.equal(N.passageAFaire({ at: MAINTENANT - 59 * 60_000 }, MAINTENANT), false);
    assert.equal(N.passageAFaire({ at: MAINTENANT - H }, MAINTENANT), true);
  });
});

describe("Bibliothèque › Questions : toutes prêtes, mes questions, mes packs (cedric, 22/10)", async () => {
  const Q = await import("../web/public/questions.js");
  const { PHOTOS_BANQUE } = await import("../web/public/banque-photos.js");
  const LION = "0123456789abcdef", CHAT = "fedcba9876543210";

  test("un pack JSON se lit sous toutes ses formes : un pack, une liste de packs, « packs », une liste de questions", () => {
    const q = { text: "Quel animal rugit ?", choices: ["Lion", "Chat"], correct: 0 };
    const un = Q.lirePacks(JSON.stringify({ titre: "Savane", thème: "Animaux", questions: [q] }));
    assert.deepEqual(un.packs.map((p) => [p.title, p.theme, p.questions.length]), [["Savane", "Animaux", 1]]);
    const liste = Q.lirePacks(JSON.stringify([{ title: "A", questions: [q] }, { nom: "B", categorie: "Espace", questions: [q, q] }]));
    assert.deepEqual(liste.packs.map((p) => [p.title, p.theme, p.questions.length]), [["A", "", 1], ["B", "Espace", 2]]);
    const packs = Q.lirePacks("```json\n" + JSON.stringify({ packs: [{ name: "C", questions: [q] }] }) + "\n```");
    assert.deepEqual(packs.packs.map((p) => p.title), ["C"]);
    const questions = Q.lirePacks(JSON.stringify([q, q]));
    assert.deepEqual(questions.packs.map((p) => [p.title, p.questions.length]), [["", 2]]);
    assert.deepEqual(Q.lirePacks("pas du JSON"), { erreur: "Ce fichier n'est pas un JSON lisible." });
    assert.deepEqual(Q.lirePacks(JSON.stringify({ title: "Vide", questions: [] })), { erreur: "Aucune question trouvée dans ce fichier." });
    assert.deepEqual(Q.lirePacks("{\"a\": 1}"), { erreur: "Aucune question trouvée dans ce fichier." });
  });

  test("pack : émoji d'illustration, image à déposer, Juste Chiffre, réponses en images ; les entrées bizarres sont sautées", () => {
    const { packs: [p] } = Q.lirePacks(JSON.stringify({ title: "Savane", questions: [
      { text: "Trompe ?", choices: ["Éléphant", "Girafe"], correct: 0, illustration: "🐘" },
      null, "texte seul", { text: "Liste ?", choices: "pas une liste", correct: 0 },
      { question: "Combien de pattes a une girafe ?", reponse: "4", emoji: "🦒" },
      { text: "Le roi ?", propositions: ["Hippo", "Lion"], reponse: "Lion", illustration: "lion.png" },
      { text: "Le chat ?", choices: [{ text: "Chat", image: "chat.jpg" }, { image: "chien.jpg" }], correct: 0 },
      { text: "Sans réponse", correct: "Paris" },
    ] }));
    assert.equal(p.questions.length, 6);
    const [trompe, liste, pattes, roi, chat, sans] = p.questions;
    assert.equal(trompe.image, "🐘");
    assert.deepEqual([liste.choices, liste.kind], [[], undefined]);
    assert.deepEqual([pattes.text, pattes.kind, pattes.correct, pattes.choices, pattes.image], ["Combien de pattes a une girafe ?", "number", 4, [], "🦒"]);
    assert.deepEqual([roi.correct, roi.revealFile, roi.image], [1, "lion.png", undefined]);
    assert.deepEqual([chat.choices, chat.imageFiles], [["Chat", "Chien"], ["chat.jpg", "chien.jpg"]]);
    assert.deepEqual([sans.choices, sans.kind, sans.correct], [[], undefined, -1]);
    // Un Juste Chiffre garde sa photo de révélation (cedric, 26/10 : elle ressortait « inutile » à l'import).
    const [vv] = Q.lirePacks(JSON.stringify([{ text: "Combien d'émotions dans Vice-Versa ?", correct: 5, illustration: "vice-versa.jpg" }])).packs[0].questions;
    assert.deepEqual([vv.kind, vv.correct, vv.revealFile, vv.image], ["number", 5, "vice-versa.jpg", undefined]);
    // Un Juste Chiffre à 0 reste 0 (pas une bonne réponse « absente »).
    assert.equal(Q.lirePacks(JSON.stringify([{ text: "Zéro ?", correct: 0 }])).packs[0].questions[0].correct, 0);
  });

  test("illustration : une photo par réponse dans un quiz illustré, sinon une photo ou un émoji à la révélation", () => {
    assert.deepEqual(Q.illustration({ choices: ["A", "B"], image: "🦁" }, "classique"), { ok: true, manque: null });
    assert.deepEqual(Q.illustration({ choices: ["A", "B"], imageId: LION }, "classique"), { ok: true, manque: null });
    assert.deepEqual(Q.illustration({ choices: ["A", "B"], imageId: "pas-un-id" }, "classique"), { ok: false, manque: "Pas d'illustration" });
    assert.deepEqual(Q.illustration({ choices: ["A", "B"], choiceImages: { 0: LION, 1: CHAT } }, "photo"), { ok: true, manque: null });
    assert.deepEqual(Q.illustration({ choices: ["A", "B", "C"], choiceImages: [LION] }, "photo"), { ok: false, manque: "2 réponses sans photo" });
    assert.deepEqual(Q.illustration({ choices: ["A", "B"] }, "photo"), { ok: false, manque: "Pas de photo pour les réponses" });
    // Juste Chiffre dans un quiz illustré : pas de réponses à illustrer, l'émoji suffit.
    assert.deepEqual(Q.illustration({ kind: "number", correct: 4, image: "🦒" }, "photo"), { ok: true, manque: null });
    // Juste Chiffre sans image : la TV montre son compteur (cedric, 22/10), pas d'alerte, dans tout quiz.
    assert.deepEqual(Q.illustration({ kind: "number", correct: 4 }, "classique"), { ok: true, manque: null });
    assert.deepEqual(Q.illustration({ kind: "number", correct: 4 }, "photo"), { ok: true, manque: null });
  });

  test("mes questions et mes packs : séparés par la source du quiz, les plus récents d'abord, alerte comptée", () => {
    const quizzes = {
      main1: { title: "Mon quiz", source: "saisie", updatedAt: 10, questions: [
        { text: "Q1", choices: ["A", "B"], correct: 0, status: "validee", image: "🎈" },
        { text: "Q2", choices: ["A", "B"], correct: 1, status: "brouillon" }] },
      main2: { title: "Photos", source: "photos", kind: "photo", updatedAt: 30, questions: [
        { text: "Où est le chat ?", choices: ["Chat", "Chien"], correct: 0, status: "validee", choiceImages: { 0: CHAT, 1: LION } }] },
      pack1: { title: "Savane", theme: "Animaux", source: "json", updatedAt: 20, questions: [
        { text: "Trompe ?", choices: ["Éléphant", "Girafe"], correct: 0, status: "validee", image: "🐘" },
        { text: "Pattes ?", kind: "number", correct: 4, status: "validee" }] },
      pack2: { title: "Ancien collage", source: "gemini", updatedAt: 40, questions: [{ text: "X", choices: ["a", "b"], correct: 0, status: "validee", imageId: LION }] },
    };
    const miennes = Q.mesQuestions(quizzes);
    assert.deepEqual(miennes.map((x) => [x.cle, x.text, x.ok, x.validee, x.categorie]), [
      ["main2/0", "Où est le chat ?", true, true, "Photos"], ["main1/0", "Q1", true, true, "Mon quiz"], ["main1/1", "Q2", false, false, "Mon quiz"],
    ]);
    assert.deepEqual(miennes[0].choiceImages, [CHAT, LION]);
    const packs = Q.mesPacks(quizzes);
    assert.deepEqual(packs.map((p) => [p.id, p.title, p.total, p.validees, p.sansIllustration]), [["pack2", "Ancien collage", 1, 1, 0], ["pack1", "Savane", 2, 2, 0]]);
    assert.deepEqual(packs[1].questions[1], { ...packs[1].questions[1], nombre: true, choices: [], correct: 4, ok: true, manque: null });
    assert.equal(Q.estPack({ source: "tableur" }), true);
    assert.equal(Q.estPack({ source: "banque" }), false);
  });

  test("toutes prêtes : la banque des tout-petits par famille, avec la photo de chaque réponse ; recherche sans accents", () => {
    const pretes = Q.questionsIllustreesPretes([
      { id: "p001", famille: "animaux", text: "Quel animal fait « miaou » ?", choices: ["Chat", "Chien", "Vache", "Canard"] },
      { famille: "lieux", text: "Où dort-on ?", choices: ["Lit", "Zzzmot-inconnu"] },
    ]);
    assert.equal(pretes[0].cle, "p001");
    assert.equal(pretes[1].cle, "p-1");
    assert.equal(pretes[0].categorie, FAMILLES_PETITS.animaux);
    assert.deepEqual(pretes[0].banque.map((c) => c !== null && PHOTOS_BANQUE.has(c)), [true, true, true, true]);
    assert.deepEqual([pretes[0].ok, pretes[0].correct, pretes[0].validee], [true, 0, true]);
    assert.deepEqual([pretes[1].ok, pretes[1].manque], [false, "1 réponse sans image"]);
    assert.deepEqual(pretes.map((x) => x.groupe), ["illustrees", "illustrees"]);
    // Sans photo, la réponse a l'émoji de son mot (il devient son image dans le quiz) : pas d'alerte (cedric, 22/10).
    const [mer] = Q.questionsIllustreesPretes([{ id: "p002", famille: "animaux", text: "Quel animal dort la tête en bas ?", choices: ["Chauve-souris", "Vache"] }]);
    assert.deepEqual([mer.banque[0], mer.banqueEmojis, mer.ok, mer.manque], [null, ["🦇", null], true, null]);
    assert.equal(Q.questionCorrespond(pretes[0], "MIAOU chat"), true);
    assert.equal(Q.questionCorrespond(pretes[1], "ou dort"), true);
    assert.equal(Q.questionCorrespond(pretes[0], "girafe"), false);
    assert.equal(Q.questionCorrespond({ text: "Le désert", choices: [] }, "desert"), true);
    // Toute la banque se range : chaque question a une famille connue.
    const tout = Q.questionsIllustreesPretes(cataloguePetits(() => 0.3));
    assert.ok(tout.length > 500);
    assert.ok(tout.every((x) => !x.nombre && Object.values(FAMILLES_PETITS).includes(x.categorie)));
    // Toute la banque est illustrée (photo ou émoji pour chaque réponse) : aucune alerte.
    assert.deepEqual(tout.filter((x) => !x.ok).map((x) => x.text), []);
  });
});

describe("Mes questions : supprimer, en vrac par thème, packs rangés par thème (cedric, 22/10)", async () => {
  const Q = await import("../web/public/questions.js");
  const q = (text) => ({ text, choices: ["A", "B"], correct: 0, status: "validee" });

  test("supprimer : seulement les questions encore à leur place, un quiz vidé est supprimé, les autres ne bougent pas", () => {
    const quizzes = {
      a: { title: "A", questions: [q("Un"), q("Deux"), q("Trois")] },
      b: { title: "B", questions: { 0: q("Seule") } },
      c: { title: "C", questions: [q("Garde")] },
    };
    const r = Q.retirerQuestions(quizzes, [
      { quizId: "a", index: 0, text: "Un" }, { quizId: "a", index: 2, text: "Trois" },
      { quizId: "b", index: 0, text: "Seule" },
      { quizId: "c", index: 0, text: "Autre texte" }, { quizId: "z", index: 0, text: "Un" }, { quizId: "a", index: "1", text: "Deux" },
    ]);
    assert.deepEqual(r, { ecritures: { a: [q("Deux")], b: null }, vides: ["b"], n: 3 });
    assert.deepEqual(quizzes.a.questions.map((x) => x.text), ["Un", "Deux", "Trois"], "rien n'est modifié sur place");
    assert.deepEqual(Q.retirerQuestions(quizzes, []), { ecritures: {}, vides: [], n: 0 });
  });

  test("en vrac : le thème du quiz (sinon son titre) sert de catégorie ; les packs se rangent par thème", () => {
    const miennes = Q.mesQuestions({
      m1: { title: "Mes devinettes", theme: " Disney ", source: "saisie", updatedAt: 2, questions: [q("Elsa ?")] },
      m2: { title: "En vrac du lundi", source: "saisie", updatedAt: 1, questions: [q("Pomme ?")] },
    });
    assert.deepEqual(miennes.map((x) => [x.text, x.categorie, x.source]), [["Elsa ?", "Disney", "Mes devinettes"], ["Pomme ?", "En vrac du lundi", "En vrac du lundi"]]);
    const packs = [
      { id: "p1", theme: "Musique" }, { id: "p2", theme: "disney" }, { id: "p3" }, { id: "p4", theme: "Disney" },
      { id: "p5", theme: "  " }, { id: "p6", theme: "Éléphants" }, { id: "p7", theme: "Animaux" },
    ];
    assert.deepEqual(Q.packsParTheme(packs).map(([t, ps]) => [t, ps.map((p) => p.id)]), [
      ["Animaux", ["p7"]], ["disney", ["p2", "p4"]], ["Éléphants", ["p6"]], ["Musique", ["p1"]], [Q.SANS_THEME, ["p3", "p5"]],
    ]);
    assert.deepEqual(Q.packsParTheme([]), []);
    assert.deepEqual(Object.values(Q.GROUPES_QUESTIONS), ["🎨 Mes thèmes", "📝 Quiz classique tout prêt", "🖼️ Quiz illustré tout prêt", "✅ Vrai ou Faux tout prêt", "✍️ Mes questions en vrac", "🔍 Mes séries de photos", "🧪 Questions de test"]);
  });

  test("questions de test : celles des prestations de test (clés « test-… ») sont à part, en vrac comme en pack", () => {
    const quizzes = {
      "-Nmien": { title: "Mon quiz", source: "saisie", updatedAt: 1, questions: [q("À moi ?")] },
      "test-lea-tous-les-jeux-quiz": { title: "TEST – Quiz classique de Léa", theme: "Culture générale (test)", source: "saisie", updatedAt: 3, questions: [q("Test ?"), q("Test 2 ?")] },
      "test-lea-9-ans": { title: "TEST – Quiz de Léa (9 ans)", source: "json", updatedAt: 2, questions: [q("Pack test ?")] },
      "-Npack": { title: "Disney", source: "json", questions: [q("Elsa ?")] },
    };
    assert.deepEqual(Q.mesQuestions(quizzes).map((x) => x.cle), ["-Nmien/0"]);
    assert.deepEqual(Q.mesPacks(quizzes).map((p) => p.id), ["-Npack"]);
    const tests = Q.questionsDeTest(quizzes);
    assert.deepEqual(tests.map((x) => [x.cle, x.groupe, x.categorie]), [
      ["test-lea-tous-les-jeux-quiz/0", "tests", "Culture générale (test)"], ["test-lea-tous-les-jeux-quiz/1", "tests", "Culture générale (test)"],
      ["test-lea-9-ans/0", "tests", "TEST – Quiz de Léa (9 ans)"],
    ]);
    // Elles restent supprimables comme les siennes.
    assert.deepEqual(Q.retirerQuestions(quizzes, [tests[1]]).ecritures, { "test-lea-tous-les-jeux-quiz": [q("Test ?")] });
    assert.equal(Q.estQuizDeTest("test-lea-9-ans"), true);
    assert.equal(Q.estQuizDeTest("-Ntest-lea"), false);
    assert.equal(Q.estQuizDeTest(undefined), false);
  });
});

describe("Zoom mystère et Image floue en séries, comme le Quiz (cedric, 23/10)", async () => {
  const S = await import("../web/public/show.js");
  const M = await import("../web/public/manches.js");
  const Q = await import("../web/public/questions.js");
  const { questionBanque } = await import("../web/public/banque-photos.js");
  const A = "a".repeat(16);
  const B = "b".repeat(16);
  const photo = (imageId, mot) => ({ text: "Qu'est-ce que c'est ?", choices: [mot, "Anna", "Simba", "Nemo"], correct: 0, imageId, status: "validee" });
  const quizzes = { disney: { title: "Disney", kind: "images", source: "photos", questions: [photo(A, "Elsa"), photo(B, "Olaf")] } };
  const vue = (qs) => qs.map((q) => [q.kind, q.imageId ?? q.banque, q.choices[q.correct]]);

  test("photos choisies une par une (avant) : une série copiée, le même jeu sur la TV", () => {
    const avant = { type: "zoom", picks: [B, "banque:vache"] };
    const round = M.versSeriesQuiz(avant, quizzes);
    assert.deepEqual(round.seriesQuiz.map((x) => [x.origine, x.titre]), [["reprise", "Photos choisies"]]);
    assert.deepEqual(round.seriesQuiz[0].questions.map((q) => q.id), [`i:${B}`, "b:vache"]);
    assert.equal(round.picks, undefined);
    const propre = M.cleanRound(round);
    assert.deepEqual(Object.keys(propre).sort(), ["seriesQuiz", "type"]);
    const tv = (r) => S.buildSnapshot("s", { rounds: [r] }, quizzes).snapshot.quiz.questions;
    assert.deepEqual(vue(tv(propre)), vue(tv(avant)));
    assert.deepEqual(vue(tv(propre)), [["zoom", B, "Olaf"], ["zoom", "vache", questionBanque("vache").choices[questionBanque("vache").correct]]]);
    // Une manche du téléphone (photos choisies, sans séries) reste comme avant.
    assert.deepEqual(M.cleanRound({ type: "flou", picks: [A] }), { type: "flou", picks: [A] });
  });

  test("une série de photos entière : gardée comme avant ; ✕ retire une photo par son image (elles disent toutes « Qu'est-ce que c'est ? »)", () => {
    const entiere = M.versSeriesQuiz({ type: "flou", quizId: "disney" }, quizzes);
    assert.deepEqual(entiere.seriesQuiz.map((x) => [x.origine, x.quizId]), [["quiz", "disney"]]);
    assert.deepEqual(M.cleanRound(entiere), { type: "flou", quizId: "disney" });
    const sansElsa = { type: "flou", seriesQuiz: [{ id: "q1", origine: "quiz", quizId: "disney", sans: [S.signatureQuestion(photo(A, "Elsa"), "flou")] }] };
    assert.deepEqual(S.questionsDesSeries(sansElsa, quizzes).map((q) => q.imageId), [B]);
    const { snapshot } = S.buildSnapshot("s", { rounds: [M.cleanRound(sansElsa)] }, quizzes);
    assert.deepEqual(vue(snapshot.quiz.questions), [["flou", B, "Olaf"]]);
    assert.equal(snapshot.quiz.questions[0].round, "Image floue");
    assert.equal(S.signatureQuestion(photo(A, "Elsa"), "zoom"), `i:${A}`);
    assert.equal(S.signatureQuestion({ text: "Qu'est-ce que c'est ?", banque: "vache" }, "flou"), "b:vache");
    assert.equal(S.signatureQuestion({ text: " Capitale ? " }, "quiz"), "capitale ?");
  });

  test("🎲, série de la bibliothèque et ordre rangé : l'ordre du « complet » va jusqu'à la TV, sans Super Finale ; « Jamais deux fois » voit chaque photo", () => {
    const vache = questionBanque("vache");
    const round = {
      type: "zoom", finale: 3, facteur: 3,
      seriesQuiz: [
        { id: "de", origine: "de", famille: "animaux", questions: [{ id: "b:vache", text: vache.text, choices: [...vache.choices], correct: vache.correct, banque: "vache" }] },
        { id: "q1", origine: "quiz", quizId: "disney" },
      ],
      ordreQuiz: [`q1|t:i:${A}`, "de|b:vache", `q1|t:i:${B}`],
    };
    const propre = M.cleanRound(round);
    assert.equal(propre.finale, undefined, "pas de Super Finale au Zoom mystère");
    assert.equal(propre.facteur, undefined);
    assert.equal(propre.seriesQuiz[0].famille, "animaux");
    const qs = S.buildSnapshot("s", { rounds: [propre] }, quizzes).snapshot.quiz.questions;
    assert.deepEqual(qs.map((q) => q.imageId ?? q.banque), [A, "vache", B]);
    assert.ok(qs.every((q) => q.kind === "zoom" && q.double === false));
    assert.equal(M.resumeDesSeries(propre, quizzes), "3 photos : 🎲 1 tirée (Animaux) · 📚 Disney (2)");
    const vus = S.fixedConcepts(propre, quizzes);
    for (const c of [`i:${A}`, `i:${B}`, "m:vache", "m:elsa"]) assert.ok(vus.includes(c), c);
    assert.equal(S.roundFilled(propre), true);
  });

  test("Bibliothèque › Questions : ses séries de photos à part, ni dans ses questions en vrac ni dans ses packs", () => {
    const q = (text) => ({ text, choices: ["Oui", "Non"], correct: 0, status: "validee" });
    const lib = {
      disney: { title: "Disney", theme: "Dessins animés", kind: "images", source: "photos", updatedAt: 3, questions: [photo(A, "Elsa"), photo(B, "Olaf")] },
      importee: { title: "Animaux en photos", kind: "images", source: "json", updatedAt: 2, questions: [photo(A, "Lion")] },
      pack: { title: "Pack", source: "json", updatedAt: 1, questions: [q("Pack ?")] },
      mien: { title: "Mien", source: "saisie", updatedAt: 1, questions: [q("À moi ?")] },
      "test-photos": { title: "TEST – photos", kind: "images", source: "photos", questions: [photo(A, "Test")] },
    };
    assert.deepEqual(Q.mesSeriesDePhotos(lib).map((p) => [p.id, p.total, p.groupe ?? p.questions[0].groupe]), [["disney", 2, "photos"], ["importee", 1, "photos"]]);
    assert.deepEqual(Q.mesPacks(lib).map((p) => p.id), ["pack"]);
    assert.deepEqual(Q.mesQuestions(lib).map((x) => x.cle), ["mien/0"]);
    assert.deepEqual(Q.questionsDeTest(lib).map((x) => x.cle), ["test-photos/0"]);
  });

  test("« ⭐ Composer avec vos images » : leur nom pour réponse, 4 propositions sans doublon, ni image sans nom ni image déjà là ; la TV les joue", () => {
    const [C, D, E, F] = ["c", "d", "e", "f"].map((x) => x.repeat(16));
    const mes = [{ id: C, nom: " Mamie Jo " }, { id: D, nom: "Tigre" }, { id: E, nom: "" }, { id: A, nom: "Elsa" }, { id: "pas-une-image", nom: "Rien" }];
    const graine = (n) => () => ((n = (n * 16807) % 2147483647) - 1) / 2147483646;
    const qs = M.photosDeMesImages(mes, { deja: [A], secours: ["tigre", "Vache", "Chat", "Mamie jo"], random: graine(3) });
    assert.deepEqual(qs.map((q) => [q.id, q.imageId, q.choices[q.correct], q.text]), [
      [`i:${C}`, C, "Mamie Jo", "Qu'est-ce que c'est ?"], [`i:${D}`, D, "Tigre", "Qu'est-ce que c'est ?"]]);
    for (const q of qs) {
      assert.equal(q.choices.length, 4);
      assert.equal(new Set(q.choices.map((c) => c.toLowerCase())).size, 4, `sans doublon : ${q.choices}`);
    }
    // D'abord les autres réponses de la série et du même ajout, avant les mots de secours.
    assert.ok(qs[0].choices.includes("Tigre") && qs[1].choices.includes("Mamie Jo"));
    const fin = M.photosDeMesImages([{ id: F, nom: "Licorne" }], { voisines: ["Mamie Jo", "Tigre"], secours: ["Vache"], random: graine(5) })[0];
    assert.deepEqual([...fin.choices].sort(), ["Licorne", "Mamie Jo", "Tigre", "Vache"]);
    // Une seule image et rien d'autre : jouable quand même s'il y a un mot de secours.
    assert.equal(M.photosDeMesImages([{ id: F, nom: "Licorne" }], { secours: ["Vache"] })[0].choices.length, 2);

    const round = { type: "zoom", seriesQuiz: [{ id: "m1", origine: "images", questions: [...qs, fin] }] };
    const propre = M.cleanRound(round);
    assert.deepEqual(propre.seriesQuiz.map((x) => [x.origine, x.questions.length]), [["images", 3]]);
    assert.equal(M.resumeDesSeries(propre, {}), "3 photos : ⭐ 3 choisies dans la bibliothèque");
    const { snapshot, problems } = S.buildSnapshot("s", { age: 7, rounds: [propre] }, {});
    assert.deepEqual(problems, []);
    assert.deepEqual(snapshot.quiz.questions.map((q) => [q.kind, q.imageId, q.choices[q.correct]]),
      [["zoom", C, "Mamie Jo"], ["zoom", D, "Tigre"], ["zoom", F, "Licorne"]]);
    // « Jamais deux fois » : une image de « Mes images » se reconnaît à son image, comme les séries de photos.
    assert.equal(S.signatureQuestion(qs[0], "flou"), `i:${C}`);
  });
});

describe("Vrai ou Faux express en séries, avec sa banque d'affirmations toutes prêtes (cedric, 23/10)", async () => {
  const VF = await import("../web/public/banque-vrai-faux.js");
  const S = await import("../web/public/show.js");
  const M = await import("../web/public/manches.js");
  const Q = await import("../web/public/questions.js");
  const { NIVEAUX_CHIFFRES } = await import("../web/public/banque-chiffres.js");
  // Hasard rejouable : les mêmes tirages à chaque essai.
  const graine = (n) => () => ((n = (n * 16807) % 2147483647) - 1) / 2147483646;

  test("la banque : des affirmations courtes et uniques, trois niveaux, des thèmes connus, autant de vraies que de fausses à peu près", () => {
    const A = VF.AFFIRMATIONS;
    assert.ok(A.length >= 200, `${A.length} affirmations`);
    assert.equal(new Set(A.map((x) => x.id)).size, A.length, "identifiants uniques");
    assert.equal(new Set(A.map((x) => x.text.toLowerCase())).size, A.length, "textes uniques");
    for (const x of A) {
      assert.ok(VF.THEMES_VRAI_FAUX[x.theme], `${x.text} : thème ${x.theme}`);
      assert.ok([1, 2, 3].includes(x.niveau), x.text);
      assert.deepEqual([x.ageMin, x.ageMax], NIVEAUX_CHIFFRES[x.niveau]);
      assert.deepEqual(x.choices, ["Vrai", "Faux"]);
      assert.equal(x.correct, x.vrai ? 0 : 1);
      assert.match(x.text, /^[A-ZÀ-ÖØ-Ý0-9].*\.$/u, `${x.text} : une phrase`);
      assert.ok(x.text.split(/\s+/).length <= 16, `${x.text} : trop longue`);
      assert.ok(x.id.length <= 64 && /^vf-[a-z0-9-]+$/.test(x.id), x.id);
    }
    for (const niveau of [1, 2, 3]) {
      const du = A.filter((x) => x.niveau === niveau);
      const vraies = du.filter((x) => x.vrai).length;
      assert.ok(du.length >= 50, `niveau ${niveau} : ${du.length}`);
      assert.ok(vraies >= du.length * 0.35 && vraies <= du.length * 0.65, `niveau ${niveau} : ${vraies} vraies sur ${du.length}`);
    }
    // Elles se jouent telles quelles au Vrai ou Faux express.
    assert.equal(S.expressQuestions({ questions: A.map((x) => ({ ...x, status: "validee" })) }).length, A.length);
  });

  test("le tirage : du niveau demandé, moitié vraies moitié fausses, jamais une affirmation déjà prise, ni deux fois la même", () => {
    for (const n of [1, 6, 7, 10]) {
      const t = VF.tirerAffirmations(n, { niveau: 2, rng: graine(n) });
      assert.equal(t.length, n);
      assert.ok(t.every((x) => x.niveau === 2));
      assert.equal(new Set(t.map((x) => x.id)).size, n);
      const vraies = t.filter((x) => x.vrai).length;
      assert.ok(Math.abs(vraies - (n - vraies)) <= 1, `${n} : ${vraies} vraies`);
    }
    const premier = VF.tirerAffirmations(10, { niveau: 1, rng: graine(3) });
    const second = VF.tirerAffirmations(10, { niveau: 1, rng: graine(3), exclus: new Set(premier.map((x) => x.text)) });
    assert.equal(second.length, 10);
    assert.ok(second.every((x) => !premier.some((y) => y.text === x.text)), "jamais deux fois");
    // Plus assez d'un côté : complété de l'autre ; plus rien de libre : rien.
    const liste = VF.AFFIRMATIONS.filter((x) => x.niveau === 3).filter((x, k, all) => x.vrai || all.filter((y) => !y.vrai).indexOf(x) < 1);
    assert.equal(VF.tirerAffirmations(6, { liste, rng: graine(5) }).length, 6);
    assert.deepEqual(VF.tirerAffirmations(4, { niveau: 1, exclus: new Set(VF.AFFIRMATIONS.map((x) => x.text)) }), []);
  });

  test("une manche en séries : 🎲, Vrai / Faux d'un de ses quiz, ordre rangé ; la TV les joue dans cet ordre, Super Finale sur les dernières", () => {
    const quizzes = {
      sciences: { title: "Sciences", source: "tableur", questions: [
        { text: "Le Soleil est une étoile", choices: ["Vrai", "Faux"], correct: 0, status: "validee" },
        { text: "Planète la plus proche ?", choices: ["Mercure", "Mars"], correct: 0, status: "validee" },
        { text: "Les poissons volent", choices: ["Vrai", "Faux"], correct: 1, status: "validee" },
      ] },
    };
    const [a, b] = VF.tirerAffirmations(2, { niveau: 2, rng: graine(7) });
    const enLigne = (x) => ({ id: x.id, text: x.text, choices: ["Vrai", "Faux"], correct: x.correct });
    const round = {
      type: "express", finale: 2, facteur: 3,
      seriesQuiz: [
        { id: "de", origine: "de", profil: "MOYENS", questions: [enLigne(a), enLigne(b)] },
        { id: "q1", origine: "quiz", quizId: "sciences", sans: ["les poissons volent"] },
      ],
      ordreQuiz: [`de|${b.id}`, "q1|t:le soleil est une étoile", `de|${a.id}`],
    };
    const propre = M.cleanRound(round);
    // Super Finale comme au Quiz (cedric, 23/10 : « à l'image du quiz principal ») : les 2 dernières, ×3.
    assert.equal(propre.finale, 2);
    assert.equal(propre.facteur, 3);
    assert.equal(propre.seriesQuiz[0].profil, "MOYENS");
    assert.deepEqual(propre.seriesQuiz[0].questions.map((q) => q.id), [a.id, b.id]);
    const { snapshot, problems } = S.buildSnapshot("s", { childName: "Léa", age: 9, rounds: [propre] }, quizzes);
    assert.deepEqual(problems, []);
    const qs = snapshot.quiz.questions;
    assert.deepEqual(qs.map((q) => q.text), [b.text, "Le Soleil est une étoile", a.text]);
    assert.ok(qs.every((q) => q.kind === "express" && q.round === "Vrai ou Faux express"));
    assert.deepEqual(qs.map((q) => q.double), [false, true, true]);
    assert.deepEqual(qs.map((q) => q.finale === true), [false, true, true]);
    assert.deepEqual(snapshot.facteurs, { [qs[1].id]: 3 }, "le téléphone propose ×3 juste avant");
    assert.deepEqual(snapshot.rounds.map((x) => x.finale), [2]);
    assert.deepEqual(qs.map((q) => q.choices[q.correct]), [b.vrai ? "Vrai" : "Faux", "Vrai", a.vrai ? "Vrai" : "Faux"]);
    assert.equal(M.resumeDesSeries(propre, quizzes), "3 affirmations : 🎲 2 tirées (Moyens) · 📚 Sciences (1)");
    // Une ancienne manche (un quiz, ses N premières) : les mêmes affirmations, en séries ; seule, gardée comme avant.
    const ancienne = { type: "express", quizId: "sciences", count: 1 };
    const enSeries = M.versSeriesQuiz(ancienne, quizzes);
    assert.deepEqual(enSeries.seriesQuiz, [{ id: "q-sciences", origine: "quiz", quizId: "sciences", sans: ["les poissons volent"] }]);
    const tv = (r) => S.buildSnapshot("s", { age: 9, rounds: [r] }, quizzes).snapshot.quiz.questions.map((q) => q.text);
    assert.deepEqual(tv(M.cleanRound(enSeries)), tv(ancienne));
    assert.deepEqual(M.cleanRound(M.versSeriesQuiz({ type: "express", quizId: "sciences" }, quizzes)), { type: "express", quizId: "sciences" });
  });

  test("Bibliothèque › Questions : « ✅ Vrai ou Faux tout prêt », par niveau et par thème, sans alerte d'illustration", () => {
    const items = Q.questionsVraiFauxPretes();
    assert.equal(items.length, VF.AFFIRMATIONS.length);
    assert.ok(items.every((x) => x.groupe === "vraifaux" && x.ok && x.validee && x.vraiFaux && x.choices.join("/") === "Vrai/Faux"));
    const lune = items.find((x) => x.text === "La Lune tourne autour de la Terre.");
    assert.deepEqual([lune.correct, lune.niveau, lune.categorie, lune.source], [0, 1, "Espace et sciences", "Vrai ou Faux tout prêt · Facile · 5 à 8 ans"]);
    assert.ok(Q.questionCorrespond(lune, "lune"));
  });
});

describe("Le quiz classique tout prêt : Juste Chiffre et questions à 4 réponses (cedric, 22/10)", async () => {
  const B = await import("../web/public/banque-chiffres.js");
  const C = await import("../web/public/banque-classiques.js");
  const Q = await import("../web/public/questions.js");
  const { cleanEmoji } = await import("../web/public/illustration.js");
  const rng = (graine) => () => { graine = (graine * 16807) % 2147483647; return (graine - 1) / 2147483646; };
  // Émojis plus récents qu'Android 9 (Mi Box, Emoji 11) : la TV montrerait un carré vide.
  const tropRecent = (e) => [...e].some((ch) => {
    const c = ch.codePointAt(0);
    return (c >= 0x1fa70 && c <= 0x1faff) || (c >= 0x1f7e0 && c <= 0x1f7eb) || [0x1f6d5, 0x1f6d6, 0x1f6d7, 0x1f6fa, 0x1f6fb, 0x1f6fc, 0x1f90c, 0x1f90d, 0x1f90e, 0x1f90f,
      0x1f971, 0x1f972, 0x1f977, 0x1f978, 0x1f97b, 0x1f9a3, 0x1f9a4, 0x1f9a5, 0x1f9a6, 0x1f9a7, 0x1f9a8, 0x1f9a9, 0x1f9aa, 0x1f9ab, 0x1f9ac, 0x1f9ad, 0x1f9ae, 0x1f9af,
      0x1f9ba, 0x1f9bb, 0x1f9bc, 0x1f9bd, 0x1f9be, 0x1f9bf, 0x1f9c3, 0x1f9c4, 0x1f9c5, 0x1f9c6, 0x1f9c7, 0x1f9c8, 0x1f9c9, 0x1f9ca, 0x1f9cb, 0x1f9cd, 0x1f9ce, 0x1f9cf].includes(c);
  });

  test("le Juste Chiffre : plus de 100 questions, chacune avec son thème, son niveau, un nombre entier et aucun émoji", () => {
    const liste = B.QUESTIONS_CHIFFRES;
    assert.ok(liste.length >= 100, `${liste.length} questions`);
    assert.equal(new Set(liste.map((x) => x.id)).size, liste.length, "identifiants uniques");
    assert.equal(new Set(liste.map((x) => x.text)).size, liste.length, "pas deux fois la même question");
    for (const x of liste) {
      assert.ok(B.THEMES_CHIFFRES[x.theme], `thème de « ${x.text} »`);
      assert.deepEqual([x.ageMin, x.ageMax], B.NIVEAUX_CHIFFRES[x.niveau], `âges du niveau de « ${x.text} »`);
      assert.ok(Number.isInteger(x.correct) && Math.abs(x.correct) <= 999999999, `réponse de « ${x.text} » (9 chiffres au plus sur le pupitre)`);
      assert.ok(x.text.length <= 120 && x.text.endsWith(" ?"), `texte de « ${x.text} »`);
      // Pas d'émoji (cedric, 22/10 : « c'est juste une animation avec les chiffres ») : la TV montre son compteur.
      assert.equal(x.emoji, undefined, `pas d'émoji pour « ${x.text} »`);
      assert.equal(C.estJusteChiffre(x), true);
    }
    // Chaque niveau a de quoi jouer.
    for (const n of [1, 2, 3]) assert.ok(liste.filter((x) => x.niveau === n).length >= 25, B.NOMS_NIVEAUX[n]);
    assert.equal(B.chiffreConvient(liste[0], null), true);
    assert.equal(tropRecent("🪐"), true);
    assert.equal(tropRecent("🕷️"), false);
  });

  test("trois niveaux sans chevauchement (cedric, 22/10) : Facile 5 à 8 ans, Moyen 9 à 11 ans, Difficile 12 à 15 ans", () => {
    assert.deepEqual(B.NIVEAUX_CHIFFRES, { 1: [5, 8], 2: [9, 11], 3: [12, 15] });
    assert.deepEqual(Object.values(B.NOMS_NIVEAUX), ["Facile", "Moyen", "Difficile"]);
    assert.equal(B.libelleNiveau(2), "Moyen · 9 à 11 ans");
    // Chaque âge tombe dans un seul niveau ; avant 5 ans Facile, après 15 ans Difficile ; sans âge, aucun.
    assert.deepEqual([4, 5, 8, 9, 11, 12, 15, 16].map(B.niveauPourAge), [1, 1, 1, 2, 2, 3, 3, 3]);
    assert.equal(B.niveauPourAge(Number.NaN), null);
    for (let age = 5; age <= 15; age++) {
      const niveaux = Object.entries(B.NIVEAUX_CHIFFRES).filter(([, [a, b]]) => age >= a && age <= b);
      assert.equal(niveaux.length, 1, `${age} ans`);
    }
    // Une question convient à un âge seulement si elle est de son niveau.
    const x = C.QUESTIONS_TOUT_PRETES.find((q) => q.niveau === 2);
    assert.deepEqual([7, 9, 11, 12].map((age) => B.chiffreConvient(x, age)), [false, true, true, false]);
  });

  test("les questions à 4 réponses : plus de 600, surtout au niveau Moyen, quatre réponses différentes et courtes, la bonne en premier ; un émoji au niveau Facile, de vraies photos seulement aux niveaux Moyen et Difficile", () => {
    const liste = C.QUESTIONS_CLASSIQUES;
    assert.ok(liste.length >= 600, `${liste.length} questions`);
    assert.equal(new Set(liste.map((x) => x.id)).size, liste.length, "identifiants uniques");
    const textes = [...liste, ...B.QUESTIONS_CHIFFRES].map((x) => x.text);
    assert.equal(new Set(textes).size, textes.length, "pas deux fois la même question, Juste Chiffre compris");
    for (const x of liste) {
      assert.ok(C.THEMES_TOUT_PRETS[x.theme], `thème de « ${x.text} »`);
      assert.deepEqual([x.ageMin, x.ageMax], B.NIVEAUX_CHIFFRES[x.niveau], `âges du niveau de « ${x.text} »`);
      assert.ok(x.text.length <= 120 && /[?…]$/.test(x.text), `texte de « ${x.text} »`);
      assert.equal(x.choices.length, 4, `4 réponses pour « ${x.text} »`);
      assert.equal(new Set(x.choices.map((c) => c.toLowerCase())).size, 4, `4 réponses différentes pour « ${x.text} »`);
      assert.ok(x.choices.every((c) => c.trim() === c && c.length >= 1 && c.length <= 30), `réponses courtes pour « ${x.text} »`);
      assert.equal(x.correct, 0, "la bonne réponse est écrite en premier");
      assert.equal(C.estJusteChiffre(x), false);
      if (x.niveau === 1) {
        assert.ok(x.emoji && cleanEmoji(x.emoji) === x.emoji, `émoji de « ${x.text} » gardé tel quel à l'enregistrement`);
        assert.equal(tropRecent(x.emoji), false, `émoji de « ${x.text} » trop récent pour la Mi Box`);
      } else {
        // « On abandonne les emoji. Je ne veux voir que des vrais images » (cedric, 22/10).
        assert.equal(x.emoji, undefined, `pas d'émoji pour « ${x.text} »`);
        assert.ok(x.recherche, `recherche de la photo de « ${x.text} »`);
      }
      if (x.photo) assert.equal(x.photo, `banque-quiz/${x.id}.jpg`);
    }
    // « Charge à mort les questions moyennes » : le niveau Moyen est le plus fourni, et chaque niveau a de quoi jouer.
    const parNiveau = [1, 2, 3].map((n) => liste.filter((x) => x.niveau === n).length);
    assert.ok(parNiveau[1] >= 400 && parNiveau[1] > parNiveau[0] + parNiveau[2], `${parNiveau}`);
    assert.ok(parNiveau[0] >= 100 && parNiveau[2] >= 100, `${parNiveau}`);
    // Ensemble, thème par thème : les questions à 4 réponses, puis les Juste Chiffre du même thème.
    const tout = C.QUESTIONS_TOUT_PRETES;
    assert.equal(tout.length, liste.length + B.QUESTIONS_CHIFFRES.length);
    const ordre = Object.keys(C.THEMES_TOUT_PRETS);
    assert.ok(tout.every((x, i) => !i || ordre.indexOf(tout[i - 1].theme) <= ordre.indexOf(x.theme)), "rangées par thème");
    assert.deepEqual(tout.slice(0, 2).map((x) => x.id), [liste[0].id, liste[1].id]);
  });

  test("les photos de révélation du quiz classique : chacune est sur le site, d'une question de la banque, libre de droits, et les niveaux Moyen et Difficile en ont toutes une", async () => {
    const { PHOTOS_QUIZ } = await import("../web/public/banque-quiz/liste.js");
    const { readFile, stat } = await import("node:fs/promises");
    const ids = new Set(C.QUESTIONS_CLASSIQUES.map((x) => x.id));
    assert.equal(new Set(PHOTOS_QUIZ).size, PHOTOS_QUIZ.length, "une photo par question");
    const sources = PHOTOS_QUIZ.length ? JSON.parse(await readFile(new URL("../web/public/banque-quiz/sources.json", import.meta.url), "utf8")) : {};
    for (const id of PHOTOS_QUIZ) {
      assert.ok(ids.has(id), `question de la photo ${id}`);
      const { size } = await stat(new URL(`../web/public/banque-quiz/${id}.jpg`, import.meta.url));
      assert.ok(size > 5000 && size <= 64 * 1024, `taille de ${id}.jpg : ${size}`);
      assert.match(`${sources[id]?.licence ?? ""}`, /cc0|pdm|public domain|^pd/i, `licence de ${id}`);
    }
    const sansPhoto = C.QUESTIONS_CLASSIQUES.filter((x) => x.niveau > 1 && !x.photo);
    assert.deepEqual(sansPhoto.map((x) => x.text), [], "questions Moyen ou Difficile sans photo");
    // Au niveau Facile, un mélange : des photos et des émojis.
    const faciles = C.QUESTIONS_CLASSIQUES.filter((x) => x.niveau === 1);
    assert.ok(faciles.some((x) => x.photo) && faciles.some((x) => !x.photo), "Facile : photos et émojis");
  });

  test("tirer au hasard : le thème, l'âge ou le niveau, jamais ce qui est déjà dans le quiz, des réponses variées, aussi en mélangeant les deux sortes", () => {
    for (let graine = 1; graine <= 30; graine++) {
      const t = B.tirerChiffres(5, { theme: "animaux", age: 7, exclus: new Set(["Combien de pattes a une araignée ?"]), rng: rng(graine) });
      assert.equal(t.length, 5);
      assert.ok(t.every((x) => x.theme === "animaux" && B.chiffreConvient(x, 7)));
      assert.ok(!t.some((x) => x.text === "Combien de pattes a une araignée ?"));
      assert.equal(new Set(t.map((x) => x.id)).size, 5);
      assert.equal(new Set(t.map((x) => x.correct)).size, 5, "cinq réponses différentes quand c'est possible");
      // Les deux sortes ensemble : jamais deux fois la même bonne réponse ni le même émoji.
      const m = B.tirerChiffres(8, { theme: "espace", liste: C.QUESTIONS_TOUT_PRETES, rng: rng(graine) });
      assert.equal(m.length, 8);
      assert.ok(m.every((x) => x.theme === "espace"));
      const emojis = m.filter((x) => x.emoji).map((x) => x.emoji);
      assert.equal(new Set(emojis).size, emojis.length, "émojis variés");
      const reponses = m.map((x) => (C.estJusteChiffre(x) ? `n:${x.correct}` : `t:${x.choices[0]}`));
      assert.equal(new Set(reponses).size, 8, "réponses variées");
    }
    // Pas assez de réponses différentes : on complète quand même ; plus rien de libre : rien.
    const liste = [
      { id: "a", theme: "x", niveau: 1, text: "A ?", correct: 4, emoji: "🐶" },
      { id: "b", theme: "x", niveau: 1, text: "B ?", correct: 4, emoji: "🐱" },
      { id: "c", theme: "x", niveau: 3, text: "C ?", correct: 2, emoji: "🐭" },
    ];
    assert.deepEqual(B.tirerChiffres(5, { liste, rng: rng(3) }).map((x) => x.id).sort(), ["a", "b", "c"]);
    assert.deepEqual(B.tirerChiffres(5, { liste, age: 6, rng: rng(3) }).map((x) => x.id).sort(), ["a", "b"]);
    assert.deepEqual(B.tirerChiffres(5, { liste, niveau: 3, rng: rng(3) }).map((x) => x.id), ["c"]);
    assert.deepEqual(B.tirerChiffres(5, { liste, age: 10, rng: rng(3) }), [], "aucune question Moyen ici");
    assert.deepEqual(B.tirerChiffres(5, { liste, age: 6, exclus: new Set(["A ?", "B ?"]) }), []);
    assert.equal(B.tirerChiffres(200).length, B.QUESTIONS_CHIFFRES.length);
  });

  test("rubrique « Quiz classique tout prêt » : les questions à 4 réponses avec leur photo (ou leur émoji au niveau Facile), les Juste Chiffre sans émoji, par thème et par niveau, sans alerte", () => {
    const pretes = Q.questionsClassiquesPretes();
    assert.equal(pretes.length, C.QUESTIONS_CLASSIQUES.length + B.QUESTIONS_CHIFFRES.length);
    assert.deepEqual(pretes.filter((x) => !x.ok).map((x) => x.text), [], "sans alerte");
    assert.ok(pretes.every((x) => x.groupe === "classiques" && x.validee && [1, 2, 3].includes(x.niveau)));
    const a = { ...C.QUESTIONS_CLASSIQUES.find((x) => x.niveau === 1), photo: undefined };
    const [qcm] = Q.questionsClassiquesPretes([a]);
    assert.deepEqual([qcm.text, qcm.nombre, qcm.choices, qcm.correct, qcm.image, qcm.photo, qcm.categorie, qcm.manque, qcm.niveau],
      [a.text, false, a.choices, 0, a.emoji, null, C.THEMES_TOUT_PRETS[a.theme], null, 1]);
    assert.equal(qcm.source, "❓ Question à 4 réponses toute prête · Facile · 5 à 8 ans");
    assert.notEqual(qcm.choices, a.choices, "une copie : la banque ne bouge pas");
    // Sa photo passe avant son émoji.
    const [avecPhoto] = Q.questionsClassiquesPretes([{ ...a, photo: "banque-quiz/x.jpg" }]);
    assert.deepEqual([avecPhoto.photo, avecPhoto.image, avecPhoto.ok], ["banque-quiz/x.jpg", null, true]);
    const jc = pretes.find((x) => x.cle === B.QUESTIONS_CHIFFRES[0].id);
    const b = B.QUESTIONS_CHIFFRES[0];
    assert.deepEqual([jc.text, jc.nombre, jc.correct, jc.image, jc.photo, jc.categorie, jc.choices], [b.text, true, b.correct, null, null, B.THEMES_CHIFFRES[b.theme], []]);
    assert.equal(jc.source, `🔢 Juste Chiffre tout prêt · ${B.libelleNiveau(b.niveau)}`);
    assert.equal(Q.questionCorrespond(jc, "juste chiffre animaux"), true);
    assert.equal(Q.questionCorrespond(qcm, a.choices[1]), true, "on cherche aussi dans les réponses");
    assert.equal(Q.questionCorrespond(qcm, "juste chiffre"), false);
    // Une question Moyen sans photo aurait son alerte (jamais d'émoji à ce niveau).
    const [sans] = Q.questionsClassiquesPretes([{ ...C.QUESTIONS_CLASSIQUES.find((x) => x.niveau === 2), photo: undefined }]);
    assert.deepEqual([sans.ok, sans.manque, sans.image, sans.photo], [false, "Pas d'illustration", null, null]);
  });
});

describe("Mimes : une manche par équipe, sa présélection tirée au 🎲 (cedric, 23/10)", async () => {
  const S = await import("../web/public/show.js");
  const M = await import("../web/public/manches.js");
  const B = await import("../web/public/banque-photos.js");
  const { TEAM_COLORS } = await import("../web/public/theme.js");
  const carte = (word, extra = {}) => ({ word, ...extra });
  // Équipes rose, vert, orange (ordre choisi dans la prestation) : chacune ses images.
  const round = {
    type: "mimes", source: "photos", perTeam: 3, duration: 45,
    equipes: [
      [carte("Vache", { image: "🐄", banque: "vache" }), carte("Chat", { image: "🐱", banque: "chat" }), { vide: true }],
      [carte("Lion", { image: "🦁" }), carte("Ma tata", { imageId: "0123456789abcdef" }), carte("Pomme", { image: "🍎" })],
      [carte("Vélo", { image: "🚲" })],
    ],
  };
  const show = { title: "Fête de Zoé", age: 9, teams: 3, teamColors: [TEAM_COLORS[0], TEAM_COLORS[2], TEAM_COLORS[1]], rounds: [round] };

  test("titre d'une manche d'équipe ↔ sa couleur, pour les 8 couleurs ; une manche de mimes ordinaire n'a pas de couleur", () => {
    TEAM_COLORS.forEach((c) => assert.equal(S.couleurMimeEquipe(S.titreMimeEquipe(c)), c));
    assert.equal(S.titreMimeEquipe(TEAM_COLORS[1]), "Équipe Orange");
    assert.equal(S.couleurMimeEquipe("Équipe turquoise"), TEAM_COLORS[7]);
    for (const t of ["Mimes", "Mimes au hasard", "Équipe des Licornes", "Équipe", "", null]) assert.equal(S.couleurMimeEquipe(t), null, `${t}`);
  });

  test("enregistrée : source, images par équipe (dans l'ordre des couleurs, cases retirées comprises), durée ; lue par rang", () => {
    const propre = M.cleanRound({ ...round, deckId: "vieux", cards: [carte("Vieille")], random: true, photos: true });
    assert.deepEqual(Object.keys(propre).sort(), ["duration", "equipes", "perTeam", "source", "type"]);
    assert.equal(propre.equipes.length, 3);
    assert.deepEqual(propre.equipes[0][2], { vide: true });
    assert.deepEqual(propre.equipes[0][0], { word: "Vache", image: "🐄", banque: "vache" });
    assert.deepEqual(propre.equipes[1][1], { word: "Ma tata", imageId: "0123456789abcdef" });
    // Source inconnue : les photos libres.
    assert.equal(M.cleanRound({ ...round, source: "pirate" }).source, "photos");
    // La base garde une équipe sans images comme un trou : la 3e équipe reste la 3e.
    const relue = { ...round, equipes: { 0: round.equipes[0], 3: round.equipes[2] } };
    assert.equal(S.mimeEquipes(relue).length, 4);
    assert.deepEqual(S.mimeEquipes(relue)[1], []);
    assert.equal(S.mimeEquipes(relue)[3][0].word, "Vélo");
    assert.ok(S.roundFilled(round));
    assert.equal(M.mancheSummary(round), "6 images pour 3 équipes · 📷 Photos libres · tour de 45 s");
    // Sans aucune image : rien à jouer, la manche n'est pas gardée.
    assert.ok(!S.roundFilled({ type: "mimes", source: "emojis", equipes: [[{ vide: true }]] }));
  });

  test("la TV : une manche par équipe, dans l'ordre des couleurs de la prestation, sous un seul jeu « Mimes » (une seule présentation)", () => {
    const { snapshot, problems } = S.buildSnapshot("zoe", show, {}, {}, () => 0.5);
    // La case retirée de l'équipe Rose ne se joue pas ; « Reste à faire » la signale (cedric, 24/10).
    assert.deepEqual(problems, ["Manche 1 (Mimes) : il manque 1 image (case 🎲 vide) : Équipe Rose."]);
    const qs = snapshot.quiz.questions;
    assert.deepEqual(qs.map((q) => q.text), ["Équipe Rose", "Équipe Vert", "Équipe Orange"]);
    assert.deepEqual(qs.map((q) => q.id), ["r1m1", "r1m2", "r1m3"]);
    assert.ok(qs.every((q) => q.kind === "mime" && q.round === "Mimes" && q.duration === 45));
    assert.deepEqual(snapshot.rounds.map((r) => [r.title, r.count]), [["Mimes", 3]]);
    // Chaque équipe ne mime que ses images ; une case retirée ne se joue pas.
    assert.deepEqual(qs[0].cards.map((c) => c.word).sort(), ["Chat", "Vache"]);
    assert.deepEqual(qs[1].cards.map((c) => c.word).sort(), ["Lion", "Ma tata", "Pomme"]);
    assert.equal(qs[1].cards.find((c) => c.word === "Ma tata").imageId, "0123456789abcdef");
    // Photos libres : copiées dans la partie par la régie au lancement.
    assert.deepEqual(B.banqueRefs(qs).map((x) => x.cle).sort(), ["chat", "vache"]);
    // La régie copie aussi ses images à elle.
    assert.ok(S.choiceImageIds(qs).includes("0123456789abcdef"));
  });

  test("une équipe prévue sans images : signalée (programme, alerte rouge), les autres jouent", () => {
    const sans = { ...show, teams: 4, teamColors: [...show.teamColors, TEAM_COLORS[3]] };
    const { snapshot, problems } = S.buildSnapshot("zoe", sans, {}, {}, () => 0.5);
    assert.equal(snapshot.quiz.questions.length, 3);
    assert.match(problems.join(" "), /équipe jaune sans images/);
    assert.equal(S.alerteEquipes(round, 4, { couleurs: sans.teamColors }), "Mimes : équipe jaune sans images (touchez 🎲).");
    assert.equal(S.alerteEquipes(round, 3, { couleurs: show.teamColors }), null);
  });

  test("durée estimée : un tour par équipe ; « jamais deux fois » : les images des mimes comptent dans toute la prestation", () => {
    const { snapshot } = S.buildSnapshot("zoe", show, {}, {}, () => 0.5);
    const D = S.DUREE_ESTIMEE;
    const seul = { ...show, rounds: [] };
    const avec = S.dureeEstimee(snapshot, show);
    // 3 tours de 45 s, chacun suivi du changement d'équipe, et une présentation de jeu (pas trois).
    const jeu = 3 * (45 + D.apresMime) + D.presentation;
    const attendu = Math.ceil(((jeu + D.accueil + D.podium) * (1 + D.pauses)) / 300) * 5;
    assert.equal(avec.minutes, attendu);
    assert.equal(avec.jeux, 1);
    assert.equal(S.dureeEstimee(null, seul), null);
    const ailleurs = M.usedElsewhere([round, { type: "pictionary" }], 1);
    for (const mot of ["vache", "lion", "velo"]) assert.ok([...ailleurs.keys()].some((k) => k.includes(mot)), mot);
    assert.ok(ailleurs.has("i:0123456789abcdef"));
  });

  test("Banque (cedric, 24/10) : les images bonnes pour le mime, par âge ; chaque mot existe ; le 🎲 des Petits n'en tire que de faciles", async () => {
    const { MIMES_BANQUE, niveauMime, niveauxPourProfil, etiquetteMime } = await import("../web/public/banque-mimes.js");
    const { mimeAges } = await import("../web/public/show.js");
    const mots = new Set(BANQUE_MOTS.map((m) => m.mot));
    assert.deepEqual([...MIMES_BANQUE.keys()].filter((m) => !mots.has(m)), [], "chaque mot de mime est dans la banque");
    for (const m of ["Voiture", "Maison", "Chat", "Avion", "Brosse à dents"]) assert.equal(niveauMime(m), 1, m);
    for (const m of ["Poireau", "Règle", "Nez", "Table"]) assert.equal(niveauMime(m), 0, `${m} ne se mime pas`);
    assert.equal(niveauMime("Pompier"), 1, "carte de mimes facile");
    assert.equal(niveauMime("Vampire"), 2, "carte de mimes plus dure");
    assert.ok([...MIMES_BANQUE.values()].filter((n) => n === 1).length >= 75, "assez d'images faciles pour les Petits");
    assert.deepEqual(niveauxPourProfil("PETITS"), [[1]]);
    assert.deepEqual(niveauxPourProfil("MOYENS"), [[2], [1]]);
    assert.deepEqual(niveauxPourProfil("GRANDS"), [[3], [2], [1]]);
    assert.deepEqual(niveauxPourProfil("NEUTRE"), [[1, 2, 3]]);
    assert.equal(etiquetteMime("Voiture"), "🎭 Mime : Petits (6 à 8 ans)");
    assert.equal(etiquetteMime("Poireau"), "");
    // L'âge de chaque équipe : celui choisi à la main, sinon null (celui de la prestation).
    assert.deepEqual(mimeAges({ type: "mimes", ages: { 2: "GRANDS", 3: "FAUX" } }).slice(0, 4), [null, null, "GRANDS", null]);
    assert.deepEqual(mimeAges({ type: "quiz", ages: { 0: "GRANDS" } })[0], null);
  });

  test("Prestation (cedric, 24/10) : une chanson oubliée dans le blind test, une case restée sur le 🎲 : rien ne plante, mais « Reste à faire » le dit", async () => {
    const { trousDuJeu } = await import("../web/public/show.js");
    const son = (title) => ({ title, artist: "Test", audioId: "0123456789abcdef", start: 0 });
    const songs = { a: son("Alpha"), b: son("Bravo"), parti: { ...son("Partie"), retiree: true } };
    const blind = { type: "blind", nbChansons: 5, chansons: ["a", "", "b", "parti", ""] };
    assert.deepEqual(trousDuJeu(blind, { songs }), ["il manque 2 chansons (cases 🎲 vides) et 1 chanson supprimée de la bibliothèque des sons : 2 jouées au lieu de 5"]);
    assert.deepEqual(trousDuJeu({ ...blind, chansons: ["a", "", "b"] }, { songs }), ["il manque 1 chanson (case 🎲 vide) : 2 jouées au lieu de 3"]);
    assert.deepEqual(trousDuJeu({ ...blind, chansons: ["a", "b"] }, { songs }), [], "rien ne manque");
    assert.deepEqual(trousDuJeu({ ...blind, chansons: ["a", "", "parti"] }), ["il manque 1 chanson (case 🎲 vide) : 2 jouées au lieu de 3"], "bibliothèque pas encore lue : seulement les cases vides");
    const show = { childName: "Zoé", age: 8, date: "2099-01-01", status: "publiee", teams: 2, rounds: [{ ...blind, chansons: ["a", "", "b"] }] };
    const { snapshot, problems } = buildSnapshot("x", show, {}, {}, Math.random, {}, {}, {}, songs);
    assert.equal(snapshot.quiz.questions.length, 2, "le blind test se joue avec 2 chansons, sans trou");
    assert.deepEqual(problems, ["Manche 1 (Blind test) : il manque 1 chanson (case 🎲 vide) : 2 jouées au lieu de 3."]);
    const r = readiness(show, {}, {}, {}, {}, "2026-10-24", songs);
    assert.equal(r.level, "a-completer");
    assert.deepEqual(r.todo, ["Manche 1 (Blind test) : il manque 1 chanson (case 🎲 vide) : 2 jouées au lieu de 3."]);
    assert.equal(readiness({ ...show, rounds: [{ ...blind, chansons: ["a", "b"] }] }, {}, {}, {}, {}, "2026-10-24", songs).level, "prete");
    // Quiz (et les jeux en séries) : les questions retirées par ✕ en attente de leur 🎲.
    const q = (text) => ({ id: text, text, choices: ["Un", "Deux", "Trois", "Quatre"], correct: 0 });
    assert.deepEqual(trousDuJeu({ type: "quiz", seriesQuiz: [{ origine: "de", questions: [q("A ?"), { vide: true }, q("B ?")] }] }), ["il manque 1 question (case 🎲 vide)"]);
    assert.deepEqual(trousDuJeu({ type: "zoom", seriesQuiz: [{ origine: "de", questions: [{ vide: true }, { vide: true }, q("C ?")] }] }), ["il manque 2 photos (cases 🎲 vides)"]);
    assert.deepEqual(trousDuJeu({ type: "quiz", seriesQuiz: [{ origine: "quiz", quizId: "k" }] }), []);
    // Mimes : les équipes qui ont un trou ; une équipe sans aucune image est signalée à part.
    const couleurs = couleursEquipes({ teams: 3 });
    const mimes = { type: "mimes", equipes: [[{ word: "Chat" }, { vide: true }, { vide: true }], [{ vide: true }], [{ word: "Lion" }]] };
    assert.deepEqual(trousDuJeu(mimes, { couleurs }), ["il manque 2 images (cases 🎲 vides) : Équipe Rose"]);
    assert.deepEqual(trousDuJeu(mimes), ["il manque 2 images (cases 🎲 vides)"]);
    assert.deepEqual(trousDuJeu({ type: "statues" }), []);
  });

  test("Blind test (cedric, 24/10) : plus de manches ; séries 🎲, playlist, chansons choisies, l'ordre du « Blind test complet », ce qui est enregistré", async () => {
    const { seriesBlind, chansonsBrutes, chansonsDe, trousDuJeu, MAX_CHANSONS_BLIND } = await import("../web/public/show.js");
    const M = await import("../web/public/manches.js");
    const son = (title) => ({ title, artist: "Test", audioId: "0123456789abcdef", start: 0 });
    const songs = Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((k) => [k, son(k.toUpperCase())]));
    const blind = {
      type: "blind", nbChansons: 5, seriesBlind: [
        { id: "de", origine: "de", chansons: ["a", "", "b"] },
        { id: "p-1", origine: "playlist", playlistId: "pl", titre: "Années 80", chansons: ["c", "d"] },
        { id: "c-1", origine: "choix", chansons: { 0: "e", 1: "a" } },
        { id: "x", origine: "inconnue", chansons: ["f"] },
      ],
    };
    // Série après série (une chanson n'y passe qu'une fois), les cases du 🎲 à tirer à la fin ; une série inconnue est ignorée.
    assert.deepEqual(seriesBlind(blind).map((x) => x.origine), ["de", "playlist", "choix"]);
    assert.deepEqual(chansonsBrutes(blind), ["a", "b", "c", "d", "e", ""]);
    assert.deepEqual(chansonsDe(blind), ["a", "b", "c", "d", "e"]);
    // Rangé à la main ou mélangé (« Blind test complet ») : cet ordre, puis celles qui n'y sont pas encore.
    const range = { ...blind, ordreBlind: ["d", "zz", "a", "d"] };
    assert.deepEqual(chansonsBrutes(range), ["d", "a", "b", "c", "e", ""]);
    assert.deepEqual(trousDuJeu(range, { songs }), ["il manque 1 chanson (case 🎲 vide) : 5 jouées au lieu de 6"]);
    // La TV joue cet ordre.
    const show = { childName: "Zoé", age: 8, date: "2099-01-01", status: "publiee", teams: 2, rounds: [{ ...range, seriesBlind: range.seriesBlind.slice(0, 3) }] };
    const { snapshot } = buildSnapshot("x", show, {}, {}, Math.random, {}, {}, {}, songs);
    assert.deepEqual(snapshot.quiz.questions.map((q) => q.choices[0]), ["D", "A", "B", "C", "E"]);
    // Enregistré : les séries, l'ordre et `chansons` (lu par les pages d'avant les séries).
    const propre = M.cleanRound({ ...range, note: "x", seriesBlind: [...range.seriesBlind.slice(0, 3), { id: "vide", origine: "choix", chansons: [] }] });
    assert.deepEqual(propre.chansons, ["d", "a", "b", "c", "e", ""]);
    assert.deepEqual(propre.ordreBlind, ["d", "a", "b", "c", "e"]);
    assert.deepEqual(propre.seriesBlind.map((x) => [x.id, x.origine, x.chansons, x.titre ?? null, x.playlistId ?? null]), [
      ["de", "de", ["a", "", "b"], null, null], ["p-1", "playlist", ["c", "d"], "Années 80", "pl"], ["c-1", "choix", ["e", "a"], null, null]]);
    assert.equal(M.cleanRound({ ...blind, ordreBlind: undefined }).ordreBlind, undefined, "pas rangé à la main : pas d'ordre");
    // 50 chansons au plus.
    const beaucoup = { type: "blind", seriesBlind: [{ id: "c", origine: "choix", chansons: Array.from({ length: 70 }, (_, k) => `s${k}`) }] };
    assert.equal(chansonsBrutes(beaucoup).length, MAX_CHANSONS_BLIND);
    // Un blind test d'avant (une liste) devient la série du 🎲 ; une playlist entière préparée à l'ancienne ne change pas.
    assert.deepEqual(M.versSeriesBlind({ type: "blind", chansons: ["a", "", "b"] }).seriesBlind, [{ id: "de", origine: "de", chansons: ["a", "", "b"] }]);
    assert.deepEqual(M.versSeriesBlind({ type: "blind", playlistId: "pl" }).seriesBlind, []);
    assert.equal(M.versSeriesBlind({ type: "quiz" }).seriesBlind, undefined);
    // Les blind tests qui se suivent n'en font plus qu'un : un seul 🎲 et une seule série choisie, sans doublon.
    const deux = [
      { type: "quiz", quizId: "q" },
      { type: "blind", nbChansons: 5, seriesBlind: [{ id: "de", origine: "de", chansons: ["a", "b"] }] },
      { type: "blind" },
      { type: "blind", seriesBlind: [{ id: "de", origine: "de", chansons: ["b", "c"] }, { id: "p-1", origine: "playlist", playlistId: "pl", chansons: ["d"] }] },
      { type: "blind", seriesBlind: [{ id: "p-1", origine: "playlist", playlistId: "pl2", chansons: ["e"] }] },
      { type: "blind", playlistId: "ancienne" },
      { type: "blind" },
    ];
    const { rounds, fusions } = M.fusionnerBlind(deux.map(M.versSeriesBlind));
    assert.equal(fusions, 2);
    assert.deepEqual(rounds.map((r) => r.type), ["quiz", "blind", "blind"]);
    assert.deepEqual(rounds[1].seriesBlind.map((x) => [x.origine, x.chansons]), [["de", ["a", "b", "c"]], ["playlist", ["d"]], ["playlist", ["e"]]]);
    assert.equal(new Set(rounds[1].seriesBlind.map((x) => x.id)).size, 3, "des séries aux identifiants différents");
    assert.deepEqual(rounds[1].chansons, ["a", "b", "c", "d", "e"]);
    assert.equal(rounds[1].nbChansons, 5);
    assert.equal(rounds[2].playlistId, "ancienne", "préparé à l'ancienne : à part, joué tel quel");
    // Un blind test vide avant un autre laisse la place.
    assert.deepEqual(M.fusionnerBlind([{ type: "blind", seriesBlind: [] }, { type: "blind", seriesBlind: [{ id: "de", origine: "de", chansons: ["a"] }] }].map(M.versSeriesBlind)).rounds.map((r) => chansonsDe(r)), [["a"]]);
  });

  test("Quiz musical (cedric, 24/10) : les 3 mauvaises réponses sont des mots du refrain, modifiables dans la prestation", async () => {
    const { propositionsDeTitre, cle, LEURRE_MAX, LEURRES_FENETRE_SEC } = await import("../web/public/paroles.js");
    const { leurresDeChanson, leurresDeLaManche } = await import("../web/public/show.js");
    const M = await import("../web/public/manches.js");
    const refrain = (lignes) => lignes.map(([s, t]) => `${s * 1000}|${t}`).join("\n");
    const titre = "Libérée, délivrée";
    const libere = refrain([[0, "Libérée, délivrée"], [3, "Je ne mentirai plus jamais"], [7, "Libérée, délivrée"], [10, "C'est décidé, je m'en vais"],
      [14, "J'ai laissé mon enfance en été"], [18, "Perdue dans l'hiver"], [LEURRES_FENETRE_SEC + 2, "Le froid est pour moi le prix de la liberté"]]);
    const p = propositionsDeTitre(libere, titre);
    assert.ok(p.length >= 3);
    // Jamais le titre, ni une phrase qui le contient ; une majuscule, et pas trop long pour une carte de la TV.
    assert.ok(p.every((x) => cle(x) !== cle(titre) && !cle(x).includes(cle(titre)) && x.length <= LEURRE_MAX && x[0] === x[0].toUpperCase()), p.join(" / "));
    // Pris dans les 30 premières secondes du refrain réglé pour le hook.
    assert.ok(!p.some((x) => /froid|liberté/i.test(x)), p.join(" / "));
    assert.ok(p.includes("C'est décidé") && p.includes("Perdue dans l'hiver") && p.includes("Je ne mentirai plus jamais"), p.join(" / "));
    // Jamais deux propositions dont l'une contient l'autre, et un seul bout du titre (« Libérée »).
    for (const a of p) for (const b of p) if (a !== b) assert.ok(!cle(a).includes(cle(b)), `${a} / ${b}`);
    assert.ok(p.filter((x) => cle(titre).includes(cle(x))).length <= 1);
    // Bruits chantés et petits mots de liaison : jamais seuls, jamais à la fin.
    const bruits = propositionsDeTitre(refrain([[0, "Oh oh oh, na na na"], [2, "Je danse dans la rue"]]), "Danse");
    assert.ok(!bruits.some((x) => /^(oh|na)\b/i.test(x) || /\b(dans|la|le|de)$/i.test(x)), bruits.join(" / "));
    assert.ok(bruits.includes("Dans la rue"));
    // Un refrain qui ne dit que le titre : tout l'extrait du refrain sert.
    assert.ok(propositionsDeTitre(refrain([[0, "Around the world, around the world"], [40, "Paris est magique"]]), "Around the World").includes("Paris est magique"));
    assert.deepEqual(propositionsDeTitre("", "X"), []);
    assert.deepEqual(propositionsDeTitre(undefined, "X"), []);

    // Le hook doit être réglé : sans refrain, pas de leurres tirés des paroles.
    const ID = (n) => `${n}123456789abcdef`;
    const songs = {
      a: { title: titre, audioId: ID(1), refrainId: ID(2), paroles: libere },
      b: { title: "Hakuna Matata", audioId: ID(3), paroles: refrain([[0, "Quel chant fantastique"]]) },
      c: { title: "Sous l'océan", audioId: ID(4) },
      d: { title: "Ce rêve bleu", audioId: ID(5) },
      e: { title: "Je voudrais déjà être roi", audioId: ID(6) },
    };
    assert.deepEqual(leurresDeChanson(songs.a), p.slice(0, 3));
    assert.deepEqual(leurresDeChanson(songs.b), []);
    // Rangées dans la prestation : une case vidée, un doublon ou le titre lui-même laissent la place à un autre titre.
    assert.deepEqual(leurresDeChanson(songs.a, ["Il fait froid", "", "il fait froid !"]), ["Il fait froid"]);
    assert.deepEqual(leurresDeChanson(songs.a, ["Libérée délivrée", "Reine des neiges", "Elsa"]), ["Reine des neiges", "Elsa"]);

    const round = (leurres) => ({ type: "musical", seriesBlind: [{ id: "c1", origine: "choix", chansons: ["a", "b"] }], ...(leurres ? { leurres } : {}) });
    const jouer = (r) => buildSnapshot("x", { childName: "Zoé", age: 8, teams: 2, rounds: [r] }, {}, {}, Math.random, {}, {}, {}, songs).snapshot.quiz.questions;
    const [qa, qb] = jouer(round());
    // Le vrai titre et ses 3 leurres du refrain, mélangés ; sans paroles réglées, d'autres titres comme avant.
    assert.deepEqual([...qa.choices].sort(), [titre, ...p.slice(0, 3)].sort());
    assert.equal(qa.choices[qa.correct], titre);
    assert.equal(qb.choices.length, 4);
    assert.equal(qb.choices[qb.correct], "Hakuna Matata");
    assert.ok(qb.choices.every((x) => Object.values(songs).some((s) => s.title === x)), "d'autres titres de la bibliothèque");
    // Modifiés dans la prestation : ceux-là ; une case vide prend un autre titre.
    const [qa2] = jouer(round({ a: ["Il fait froid", "", "Reine des neiges"] }));
    assert.equal(qa2.choices.length, 4);
    assert.ok(qa2.choices.includes("Il fait froid") && qa2.choices.includes("Reine des neiges") && qa2.choices.includes(titre));
    assert.ok(qa2.choices.some((x) => ["Hakuna Matata", "Sous l'océan", "Ce rêve bleu", "Je voudrais déjà être roi"].includes(x)));

    // Enregistrés avec la manche, 3 cases par chanson encore dans la manche ; pas pour un blind test.
    const propre = M.cleanRound(round({ a: ["  Il fait froid ", "", "x".repeat(60)], zz: ["Partie", "", ""] }));
    assert.deepEqual(propre.leurres, { a: ["Il fait froid", "", "x".repeat(LEURRE_MAX)] });
    assert.equal(M.cleanRound(round()).leurres, undefined);
    assert.deepEqual(leurresDeLaManche({ ...round({ a: ["A"] }), type: "blind" }), {});
    // Deux Quiz musicaux qui se suivent n'en font qu'un : leurs leurres suivent leurs chansons.
    const deux = M.fusionnerBlind([round({ a: ["A", "B", "C"] }), { type: "musical", seriesBlind: [{ id: "c2", origine: "choix", chansons: ["d"] }], leurres: { d: ["D", "E", "F"] } }].map(M.versSeriesBlind));
    assert.deepEqual(M.cleanRound(deux.rounds[0]).leurres, { a: ["A", "B", "C"], d: ["D", "E", "F"] });
  });
});
