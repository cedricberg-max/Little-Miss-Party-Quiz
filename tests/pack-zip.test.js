// Import d'un pack en un seul ZIP (cedric, 25/10) : lecture du ZIP dans le navigateur et analyse du pack.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { faireZip } from "./zip-outil.js";
import { lireZip, lireZipEtSesZip, cheminSur, estFichierSysteme } from "../web/public/zip.js";
import { analyserPack, IMAGE_MANQUANTE, MAX_PHOTOS_SERIE, lirePersonnages, chercheurImages, alerteImage, FORMATS_IMAGES, estImage } from "../web/public/pack-zip.js";
import { FAMILLES, NIVEAUX, lireFamille, lireNiveau, niveauDesAges, niveauDuQuiz, familleDuQuiz, parFamille } from "../web/public/rangement.js";

const texte = async (f) => new TextDecoder().decode(await f.lire());

describe("lecture d'un ZIP", () => {
  test("fichiers compressés et rangés tels quels, dans un dossier englobant ou à la racine ; dossiers et fichiers systèmes laissés", async () => {
    const zip = faireZip([
      ["Harry Potter/", ""],
      ["Harry Potter/pack.json", '{"title":"HP"}'],
      ["Harry Potter/hp-q01-revelation.jpg", Buffer.from([0xff, 0xd8, 1, 2, 3]), { stocke: true }],
      ["__MACOSX/Harry Potter/._pack.json", "x"],
      ["Harry Potter/.DS_Store", "x"],
      ["Thumbs.db", "x"],
    ]);
    const fichiers = await lireZip(zip);
    assert.deepEqual(fichiers.map((f) => f.chemin), ["Harry Potter/pack.json", "Harry Potter/hp-q01-revelation.jpg"]);
    assert.equal(await texte(fichiers[0]), '{"title":"HP"}');
    assert.deepEqual([...(await fichiers[1].lire())], [0xff, 0xd8, 1, 2, 3]);
    const racine = await lireZip(faireZip([["pack.json", "{}"]]));
    assert.deepEqual(racine.map((f) => [f.chemin, f.nom]), [["pack.json", "pack.json"]]);
  });

  test("noms avec accents : UTF-8, et ancienne page de code de Windows sans drapeau", async () => {
    const [a] = await lireZip(faireZip([["Élève/château.jpg", "x"]]));
    assert.equal(a.chemin, "Élève/château.jpg");
    const cp437 = Buffer.from([0x63, 0x68, 0x83, 0x74, 0x65, 0x61, 0x75, 0x2e, 0x6a, 0x70, 0x67]); // « châteu.jpg » en CP437 (0x83 = â)
    const zip = faireZip([[cp437.toString("latin1"), "x", { utf8: false }]]);
    const [b] = await lireZip(zip);
    assert.equal(b.nom, "château.jpg");
  });

  test("refus : pas un ZIP, chemin dangereux, mot de passe, compression inconnue, limites", async () => {
    await assert.rejects(() => lireZip(new Uint8Array([1, 2, 3, 4])), /pas un ZIP lisible/);
    await assert.rejects(() => lireZip(new Uint8Array()), /vide/);
    await assert.rejects(() => lireZip(faireZip([["../../evil.json", "{}"]])), /chemin refusé/);
    await assert.rejects(() => lireZip(faireZip([["/etc/passwd", "x"]])), /chemin refusé/);
    await assert.rejects(() => lireZip(faireZip([["C:/x.json", "x"]])), /chemin refusé/);
    await assert.rejects(() => lireZip(faireZip([["a.json", "x", { drapeaux: 1 }]])), /mot de passe/);
    await assert.rejects(() => lireZip(faireZip([["a.json", "x", { stocke: true, methode: 12 }]])), /façon inconnue/);
    const trois = faireZip([["a.jpg", "x"], ["b.jpg", "x"], ["c.jpg", "x"]]);
    await assert.rejects(() => lireZip(trois, { zip: 1e9, fichiers: 2, fichier: 1e9, total: 1e9 }), /plus de 2 fichiers/);
    await assert.rejects(() => lireZip(faireZip([["a.jpg", "x".repeat(100)]]), { zip: 1e9, fichiers: 9, fichier: 50, total: 1e9 }), /au plus par fichier/);
    await assert.rejects(() => lireZip(trois, { zip: 10, fichiers: 9, fichier: 9, total: 9 }), /au plus/);
    assert.equal(cheminSur("a\\b.jpg"), "a/b.jpg");
    assert.equal(cheminSur("a/./b.jpg"), "a/b.jpg");
    assert.equal(cheminSur("a/../b.jpg"), null);
    assert.equal(estFichierSysteme("x/__MACOSX/y"), true);
    assert.equal(estFichierSysteme("x/olaf.jpg"), false);
  });

  test("un ZIP qui contient des ZIP (ChatGPT, 25/10) : chacun ouvert comme un dossier, sur un seul niveau, limites pour le tout", async () => {
    const quiz = (niveau) => JSON.stringify({ title: "K-pop", famille: "Musique", niveau, questions: [{ text: `Question ${niveau} ?`, choices: ["Oui", "Non"], correct: 0 }] });
    const zoom = faireZip([["kpop-zoom/pack.json", JSON.stringify({ title: "K-pop zoom", theme: "K-pop", niveau: "Facile" })], ["kpop-zoom/rumi.jpg", "x"], ["kpop-zoom/mira.jpg", "y"]]);
    const fond = faireZip([["a.zip", "z"]]);
    const zip = faireZip([
      ["kpop/quiz-facile.zip", faireZip([["pack.json", quiz("Facile")]])], ["kpop/quiz-moyen.zip", faireZip([["pack.json", quiz("Moyen")]])],
      ["kpop/zoom.zip", zoom], ["kpop/lisez-moi.txt", "x"], ["kpop/plus-loin.zip", fond], ["__MACOSX/kpop/._zoom.zip", "x"],
    ]);
    const fichiers = await lireZipEtSesZip(zip);
    assert.deepEqual(fichiers.map((f) => f.chemin), ["kpop/quiz-facile/pack.json", "kpop/quiz-moyen/pack.json", "kpop/zoom/kpop-zoom/pack.json",
      "kpop/zoom/kpop-zoom/rumi.jpg", "kpop/zoom/kpop-zoom/mira.jpg", "kpop/lisez-moi.txt", "kpop/plus-loin/a.zip"]);
    assert.equal(await texte(fichiers[0]), quiz("Facile"));
    const lus = await Promise.all(fichiers.map(async (f) => ({ chemin: f.chemin, nom: f.nom, ...(/\.json$/.test(f.nom) ? { texte: await texte(f) } : {}) })));
    const { packs, erreurs, laisses } = analyserPack(lus);
    assert.deepEqual(erreurs, []);
    assert.deepEqual(packs.map((p) => [p.epreuve, p.niveau, p.questions.length]).sort(), [["photos", "Facile", 2], ["quiz", "Facile", 1], ["quiz", "Moyen", 1]]);
    assert.deepEqual(laisses.sort(), ["a.zip", "lisez-moi.txt"], "un ZIP dans un ZIP intérieur n'est pas ouvert");
    assert.equal(packs.find((p) => p.epreuve === "photos").theme, "K-pop", "le thème de la fiche pack.json d'une série de photos est lu");
    // Les limites comptent tous les fichiers, intérieurs compris ; un ZIP intérieur abîmé est nommé.
    await assert.rejects(() => lireZipEtSesZip(zip, { zip: 1e9, fichiers: 4, fichier: 1e9, total: 1e9 }), /plus de 4 fichiers/);
    await assert.rejects(() => lireZipEtSesZip(faireZip([["casse.zip", "pas un zip"]])), /Dans « casse\.zip » : Ce fichier n'est pas un ZIP lisible/);
  });

  test("un fichier dont la taille décompressée dépasse l'annonce est refusé (archive piégée)", async () => {
    const zip = faireZip([["a.json", "x".repeat(5000)]]);
    // Taille annoncée trafiquée à 10 octets dans le répertoire central.
    const vue = new DataView(zip.buffer);
    let o = zip.length - 22;
    const rep = vue.getUint32(o + 16, true);
    vue.setUint32(rep + 24, 10, true);
    const [f] = await lireZip(zip);
    await assert.rejects(() => f.lire(), /abîmé/);
  });
});

const QUIZ = {
  title: "Harry Potter – Moyen", theme: "Harry Potter", ageMin: 9, ageMax: 11,
  questions: [
    { text: "Comment s'appelle la chouette de Harry ?", choices: ["Croûtard", "Hedwige", "Coquecigrue", "Errol"], correct: 1, illustration: "hp-q01-revelation.jpg" },
    { text: "Dans quelle maison est Drago ?", choices: ["Gryffondor", "Poufsouffle", "Serdaigle", "Serpentard"], correct: 3, illustration: "hp-q02-revelation.jpg" },
    { text: "Combien de livres compte la saga ?", choices: [], correct: 7 },
  ],
};
const fichier = (chemin, texteJson) => ({ chemin, nom: chemin.split("/").pop(), ...(texteJson == null ? {} : { texte: texteJson }) });

describe("analyse d'un pack", () => {
  test("Quiz avec ses images : Juste Chiffre compris, une image absente = simple alerte, rien de bloquant", () => {
    const { packs, erreurs, laisses, imagesInutiles } = analyserPack([
      fichier("hp/pack.json", JSON.stringify(QUIZ)), fichier("hp/HP-Q01-Revelation.JPG"), fichier("hp/en-trop.jpg"), fichier("hp/liste.txt"),
    ]);
    assert.deepEqual(erreurs, []);
    assert.equal(packs.length, 1);
    const [p] = packs;
    assert.deepEqual([p.epreuve, p.titre, p.theme, p.ageMin, p.ageMax, p.questions.length], ["quiz", "Harry Potter – Moyen", "Harry Potter", 9, 11, 3]);
    assert.equal(p.questions[2].kind, "number");
    assert.equal(p.questions[2].correct, 7);
    assert.deepEqual(p.manquantes, [{ q: 1, case: null, fichier: "hp-q02-revelation.jpg" }]);
    assert.deepEqual(p.aCorriger, []);
    assert.deepEqual(laisses.sort(), ["liste.txt"]);
    assert.equal(imagesInutiles, 1, "en-trop.jpg : comptée, jamais téléversée");
    assert.equal(IMAGE_MANQUANTE, "Image manquante : ajoutez une illustration.");
  });

  test("Quiz illustré : images des propositions et révélation facultative ; une case sans image reste vide, sans émoji", () => {
    const illustre = {
      title: "Reine des neiges", theme: "Disney", ageMin: 5, ageMax: 8,
      questions: [{ text: "Qui est le bonhomme de neige ?", choices: [{ text: "Sven", image: "rdn-q01-sven.jpg" }, { text: "Olaf", image: "rdn-q01-olaf.jpg" }, { text: "Hans", image: "rdn-q01-hans.jpg" }], correct: 1 }],
    };
    const { packs, erreurs } = analyserPack([fichier("p.json", JSON.stringify(illustre)), fichier("rdn-q01-sven.jpg"), fichier("rdn-q01-olaf.jpg")]);
    assert.deepEqual(erreurs, []);
    assert.equal(packs[0].epreuve, "illustre");
    assert.deepEqual(packs[0].questions[0].imageFiles, ["rdn-q01-sven.jpg", "rdn-q01-olaf.jpg", "rdn-q01-hans.jpg"]);
    assert.deepEqual(packs[0].manquantes, [{ q: 0, case: 2, fichier: "rdn-q01-hans.jpg" }]);
    assert.equal(packs[0].questions[0].image, undefined, "jamais d'émoji ajouté à la place");
    // Toutes les images absentes : toujours un Quiz illustré, chaque case signalée.
    const sans = analyserPack([fichier("p.json", JSON.stringify(illustre))]);
    assert.equal(sans.packs[0].epreuve, "illustre");
    assert.equal(sans.packs[0].manquantes.length, 3);
  });

  test("pack sans images : Vrai ou Faux express reconnu, aucune alerte d'image", () => {
    const vf = { title: "Pokémon – Vrai ou Faux", theme: "Pokémon", questions: [
      { text: "Pikachu est de type Électrik.", choices: ["Vrai", "Faux"], correct: 0 }, { text: "Salamèche évolue en Tortank.", choices: ["Vrai", "Faux"], correct: 1 }] };
    const { packs, erreurs } = analyserPack([fichier("vf/vf.json", JSON.stringify(vf))]);
    assert.deepEqual(erreurs, []);
    assert.deepEqual([packs[0].epreuve, packs[0].questions.length, packs[0].manquantes.length], ["vraifaux", 2, 0]);
  });

  test("série de photos sans données : réponse lue dans le nom, liste.txt laissé de côté, nom du dossier comme titre", () => {
    const { packs, erreurs, laisses } = analyserPack([
      fichier("Disney zoom/olaf.jpg"), fichier("Disney zoom/chateau-de-cendrillon.jpg"), fichier("Disney zoom/buzz-l-eclair.jpg"), fichier("Disney zoom/liste.txt"),
    ], { nomZip: "pack.zip" });
    assert.deepEqual(erreurs, []);
    assert.deepEqual(laisses, ["liste.txt"]);
    const [p] = packs;
    assert.deepEqual([p.epreuve, p.titre, p.questions.length], ["photos", "Disney zoom", 3]);
    assert.deepEqual(p.questions.map((q) => [q.photo, q.choices[q.correct]]),
      [["buzz-l-eclair.jpg", "Buzz l eclair"], ["chateau-de-cendrillon.jpg", "Chateau de cendrillon"], ["olaf.jpg", "Olaf"]]);
    // À la racine du ZIP : le nom du ZIP.
    assert.equal(analyserPack([fichier("olaf.jpg"), fichier("elsa.jpg")], { nomZip: "Reine_des_neiges.zip" }).packs[0].titre, "Reine des neiges");
    const trop = Array.from({ length: MAX_PHOTOS_SERIE + 1 }, (_, i) => fichier(`p${i}.jpg`));
    assert.match(analyserPack(trop).erreurs[0], /au plus par série/);
  });

  test("Qui suis-je ? : réponses, émojis, indices ; un personnage incomplet est signalé, pas bloquant", () => {
    const data = { serie: "Super Mario", personnages: [
      { reponse: "Yoshi", emoji: "🦖", indices: ["Je suis né d'un œuf", "Mario monte sur mon dos", "J'ai une longue langue", "Je suis vert"] },
      { reponse: "Toad", indices: ["Un seul indice"] }] };
    const { packs, erreurs } = analyserPack([fichier("mario.json", JSON.stringify(data))]);
    assert.deepEqual(erreurs, []);
    assert.equal(packs[0].epreuve, "quisuis");
    assert.equal(packs[0].titre, "Super Mario");
    assert.deepEqual(packs[0].personnages.map((p) => [p.answer, p.emoji, p.clues.length, p.serie]), [["Yoshi", "🦖", 4, "Super Mario"]]);
    assert.equal(packs[0].ignorees.length, 1);
    assert.equal(lirePersonnages([{ reponse: "Elsa", indices: ["a", "b"] }], "Disney")[0].serie, "Disney");
  });

  test("erreurs bloquantes, en français : données mal écrites, ZIP vide, aucune question ; rien n'est gardé", () => {
    const casse = analyserPack([fichier("p.json", "{ pas lisible"), fichier("vf.json", JSON.stringify({ questions: [{ text: "A", choices: ["Vrai", "Faux"], correct: 0 }] }))]);
    assert.equal(casse.packs.length, 0, "un pack illisible : rien n'est enregistré");
    assert.match(casse.erreurs[0], /mal écrites/);
    assert.match(analyserPack([fichier("liste.txt")]).erreurs[0], /ni données de pack ni photos/);
    assert.match(analyserPack([fichier("p.json", JSON.stringify({ title: "x", questions: [{ text: "Sans choix" }] }))]).erreurs[0], /aucune question/i);
  });

  test("une question mal faite est importée « à corriger » (bonne réponse introuvable), les autres non", () => {
    const pack = { title: "T", questions: [{ text: "Bonne ?", choices: ["A", "B"], correct: 1 }, { text: "Mauvaise ?", choices: ["A", "B"], correct: 5 }] };
    const { packs } = analyserPack([fichier("p.json", JSON.stringify(pack))]);
    assert.deepEqual(packs[0].aCorriger.map((x) => x.q), [1]);
  });
});

describe("rangement des packs : famille et niveau (cedric, 25/10)", () => {
  test("dix familles et trois niveaux fixes ; lus sans tenir compte des majuscules ni des accents, sinon null", () => {
    assert.deepEqual(FAMILLES, ["Jeux vidéo", "Dessins animés et mangas", "Films et séries", "Musique", "Sport", "Animaux et nature",
      "Sciences et espace", "Histoire et monde", "Célébrités et YouTubeurs", "Divers"]);
    assert.deepEqual(NIVEAUX, ["Facile", "Moyen", "Difficile"]);
    assert.equal(lireFamille("jeux video"), "Jeux vidéo");
    assert.equal(lireFamille("  CÉLÉBRITÉS et youtubeurs "), "Célébrités et YouTubeurs");
    assert.equal(lireFamille("Mangas"), null, "pas de famille inventée");
    assert.equal(lireFamille(undefined), null);
    assert.equal(lireNiveau("moyen"), "Moyen");
    assert.equal(lireNiveau("DIFFICILE"), "Difficile");
    assert.equal(lireNiveau("Très dur"), null);
    assert.deepEqual([niveauDesAges(5, 8), niveauDesAges(9, 11), niveauDesAges(12, 15), niveauDesAges(null, null)], ["Facile", "Moyen", "Difficile", null]);
    // Un quiz enregistré : son niveau, sinon ses âges ; sa famille, sinon Divers.
    assert.equal(niveauDuQuiz({ niveau: "Facile", ageMin: 12, ageMax: 15 }), "Facile");
    assert.equal(niveauDuQuiz({ ageMin: 9, ageMax: 11 }), "Moyen");
    assert.equal(familleDuQuiz({}), "Divers");
    // Rangés par famille (les dix, dans l'ordre), puis Facile, Moyen, Difficile, puis par nom.
    const r = parFamille([{ title: "PSG", famille: "Sport", niveau: "Difficile" }, { title: "Foot", famille: "Sport", niveau: "Moyen" }, { title: "Mario", famille: "Jeux vidéo", niveau: "Facile" }, { title: "Sans", famille: null }]);
    assert.deepEqual(r.map(([f]) => f), FAMILLES);
    assert.deepEqual(r.find(([f]) => f === "Sport")[1].map((c) => c.title), ["Foot", "PSG"]);
    assert.deepEqual(r.find(([f]) => f === "Divers")[1].map((c) => c.title), ["Sans"]);
  });

  test("lus dans le pack : quiz, plusieurs packs, Qui suis-je ?, série de photos avec pack.json ; absents = null (l'import les demande)", () => {
    const quiz = { title: "Monster Hunter", famille: "Jeux vidéo", niveau: "Difficile", ageMin: 12, ageMax: 15, questions: [{ text: "Arme ?", choices: ["Épée", "Fleur"], correct: 0 }] };
    let { packs, erreurs } = analyserPack([fichier("pack.json", JSON.stringify(quiz))]);
    assert.deepEqual(erreurs, []);
    assert.deepEqual([packs[0].famille, packs[0].niveau, packs[0].niveauDeduit], ["Jeux vidéo", "Difficile", false]);
    // Sans niveau : celui des âges, à vérifier ; sans famille ni âges : rien.
    ({ packs } = analyserPack([fichier("pack.json", JSON.stringify({ ...quiz, famille: undefined, niveau: undefined, ageMin: 5, ageMax: 8 }))]));
    assert.deepEqual([packs[0].famille, packs[0].niveau, packs[0].niveauDeduit], [null, "Facile", true]);
    ({ packs } = analyserPack([fichier("pack.json", JSON.stringify({ title: "T", questions: quiz.questions }))]));
    assert.deepEqual([packs[0].famille, packs[0].niveau], [null, null]);
    // { packs: [...] } : chacun les siens, ou ceux du haut du fichier.
    ({ packs } = analyserPack([fichier("pack.json", JSON.stringify({ famille: "Sport", niveau: "Moyen", packs: [{ title: "Foot", questions: quiz.questions }, { title: "PSG", niveau: "Difficile", questions: quiz.questions }] }))]));
    assert.deepEqual(packs.map((p) => [p.titre, p.famille, p.niveau]), [["Foot", "Sport", "Moyen"], ["PSG", "Sport", "Difficile"]]);
    // Qui suis-je ? : en haut de la série.
    ({ packs } = analyserPack([fichier("pack.json", JSON.stringify({ serie: "Marvel", famille: "films et séries", niveau: "moyen", personnages: [{ reponse: "Hulk", indices: ["Vert", "Fort"] }] }))]));
    assert.deepEqual([packs[0].epreuve, packs[0].famille, packs[0].niveau], ["quisuis", "Films et séries", "Moyen"]);
    // Zoom mystère / Image floue : pack.json sans questions = la fiche de la série (nom, famille, niveau).
    ({ packs, erreurs } = analyserPack([fichier("savane/pack.json", JSON.stringify({ title: "Animaux de la savane", famille: "Animaux et nature", niveau: "Facile" })), fichier("savane/lion.jpg"), fichier("savane/zebre.jpg")]));
    assert.deepEqual(erreurs, []);
    assert.deepEqual([packs[0].epreuve, packs[0].titre, packs[0].famille, packs[0].niveau, packs[0].questions.length], ["photos", "Animaux de la savane", "Animaux et nature", "Facile", 2]);
  });

  test("un ZIP pour trois niveaux (et plusieurs jeux) : un pack par fichier ; une image du même nom est prise dans le dossier du pack", () => {
    const pack = (niveau, choices = ["Rumi", "Mira"]) => JSON.stringify({ title: "K-pop Demon Hunters", famille: "Musique", niveau,
      questions: [{ text: `Qui chante ? (${niveau})`, choices, correct: 0, image: "kdh-q01-revelation.jpg" }] });
    const fichiers = [
      fichier("kdh/facile/pack-facile.json", pack("Facile")), fichier("kdh/facile/kdh-q01-revelation.jpg"),
      fichier("kdh/moyen/pack-moyen.json", pack("Moyen")), fichier("kdh/moyen/kdh-q01-revelation.jpg"),
      fichier("kdh/qui/pack-qui-suis-je.json", JSON.stringify({ serie: "K-pop Demon Hunters", famille: "Musique", niveau: "Moyen", personnages: [{ reponse: "Rumi", indices: ["Je chante", "Je chasse"] }] })),
    ];
    const { packs, erreurs, laisses } = analyserPack(fichiers);
    assert.deepEqual(erreurs, []);
    assert.deepEqual(packs.map((p) => [p.epreuve, p.titre, p.niveau]), [["quiz", "K-pop Demon Hunters", "Facile"], ["quiz", "K-pop Demon Hunters", "Moyen"], ["quisuis", "K-pop Demon Hunters", "Moyen"]]);
    assert.deepEqual(laisses, []);
    const trouver = chercheurImages(fichiers.filter((f) => f.nom.endsWith(".jpg")));
    assert.equal(trouver("kdh-q01-revelation.jpg", packs[0].dossier).chemin, "kdh/facile/kdh-q01-revelation.jpg");
    assert.equal(trouver("kdh-q01-revelation.jpg", packs[1].dossier).chemin, "kdh/moyen/kdh-q01-revelation.jpg");
  });

  test("ZIP global (cedric, 25/10) : un dossier par pack, Quiz, Quiz illustré, Vrai ou Faux, Qui suis-je ? et séries de photos ensemble", () => {
    const quiz = (niveau, extra = {}) => JSON.stringify({ title: "K-pop Demon Hunters", famille: "Musique", niveau, ...extra,
      questions: [{ text: `Qui chante ? (${niveau})`, choices: ["Rumi", "Mira", "Zoey", "Jinu"], correct: 0, image: "kdh-q01-revelation.jpg" }] });
    const fichiers = [
      fichier("kdh/quiz-facile/pack.json", quiz("Facile")), fichier("kdh/quiz-facile/kdh-q01-revelation.jpg"),
      fichier("kdh/vraifaux-moyen/pack.json", JSON.stringify({ title: "K-pop Demon Hunters", famille: "Musique", niveau: "Moyen", questions: [{ text: "Rumi chante.", choices: ["Vrai", "Faux"], correct: 0 }] })),
      fichier("kdh/quisuis-difficile/pack.json", JSON.stringify({ serie: "K-pop Demon Hunters", famille: "Musique", niveau: "Difficile", personnages: [{ reponse: "Jinu", indices: ["Je suis un démon", "Je chante"] }] })),
      fichier("kdh/zoom-facile/pack.json", JSON.stringify({ title: "K-pop Demon Hunters", famille: "Musique", niveau: "Facile" })),
      fichier("kdh/zoom-facile/rumi.jpg"), fichier("kdh/zoom-facile/mira.jpg"),
      fichier("kdh/zoom-moyen/pack.json", JSON.stringify({ title: "K-pop Demon Hunters", famille: "Musique", niveau: "Moyen" })),
      fichier("kdh/zoom-moyen/rumi.jpg"), fichier("kdh/zoom-moyen/derby.jpg"), fichier("kdh/zoom-moyen/jinu.jpg"),
      fichier("kdh/liste.txt"),
    ];
    const { packs, erreurs, laisses } = analyserPack(fichiers, { nomZip: "kdh.zip" });
    assert.deepEqual(erreurs, []);
    assert.deepEqual(packs.map((p) => [p.epreuve, p.titre, p.niveau, p.dossier]).sort((a, b) => `${a[3]}`.localeCompare(`${b[3]}`)), [
      ["quiz", "K-pop Demon Hunters", "Facile", "kdh/quiz-facile"],
      ["quisuis", "K-pop Demon Hunters", "Difficile", "kdh/quisuis-difficile"],
      ["vraifaux", "K-pop Demon Hunters", "Moyen", "kdh/vraifaux-moyen"],
      ["photos", "K-pop Demon Hunters", "Facile", "kdh/zoom-facile"],
      ["photos", "K-pop Demon Hunters", "Moyen", "kdh/zoom-moyen"],
    ].sort((a, b) => `${a[3]}`.localeCompare(`${b[3]}`)));
    const zooms = packs.filter((p) => p.epreuve === "photos");
    assert.deepEqual(zooms.map((p) => p.questions.map((q) => q.choices[q.correct])), [["Mira", "Rumi"], ["Derby", "Jinu", "Rumi"]]);
    assert.deepEqual(laisses, ["liste.txt"], "toutes les images servent, rien d'autre n'est laissé");
  });
});

describe("un seul fichier packs.json et le dossier d'images téléchargé (cedric, 25/10)", () => {
  const fichiers = () => [
    fichier("kdh/packs.json", JSON.stringify({ theme: "KPop Demon Hunters", niveau: "Moyen", packs: [
      { title: "KPop Demon Hunters", niveau: "Facile", questions: [{ text: "Qui chante ?", choices: ["Rumi", "Mira", "Zoey", "Jinu"], correct: 0, image: "Rumi Scène (2).PNG" }] },
      { title: "KPop Demon Hunters", questions: [{ text: "Qui est-ce ?", choices: ["Rumi", "Mira", "Zoey", "Jinu"], correct: 1, images: ["rumi_kdh.png", "mira-kdh.webp", "zoey.jpg", "absente.jpg"] }] },
      { serie: "KPop Demon Hunters", personnages: [{ reponse: "Jinu", indices: ["Je suis un démon", "Je chante"], image: "jinu.jpg" }, { reponse: "Derpy", indices: ["Je suis un tigre", "Je suis bleu"], image: "pas-la.png" }] },
      { title: "KPop Demon Hunters", niveau: "Difficile", photos: [{ image: "rumi_kdh.png", reponse: "Rumi" }, { image: "Mira-KDH.webp", reponse: "Mira" }, { image: "fantome.jpg", reponse: "Bobby" }] },
    ] })),
    ...["rumi scene (2).png", "rumi_kdh.png", "mira-kdh.webp", "zoey.jpg", "jinu.jpg", "inutile-1.jpg", "inutile 2.jpg", "IMG_0042.jpeg"].map((n) => fichier(`kdh/images/${n}`)),
  ];

  test("chaque pack de la liste est lu comme seul dans son fichier, avec le thème et le niveau du haut s'il n'a pas les siens", () => {
    const { packs, erreurs } = analyserPack(fichiers());
    assert.deepEqual(erreurs, []);
    assert.deepEqual(packs.map((p) => [p.epreuve, p.theme, p.niveau]).sort(), [
      ["illustre", "KPop Demon Hunters", "Moyen"], ["photos", "KPop Demon Hunters", "Difficile"], ["quisuis", "", "Moyen"], ["quiz", "KPop Demon Hunters", "Facile"]].sort());
  });

  test("les images sont trouvées dans le dossier d'images par leur nom (majuscules, accents, espaces, tirets, parenthèses tolérés) ; les autres comptées, jamais téléversées", () => {
    const f = fichiers();
    const { packs, imagesInutiles, laisses } = analyserPack(f);
    assert.equal(imagesInutiles, 3, "inutile-1, inutile 2, IMG_0042");
    assert.deepEqual(laisses, []);
    const trouver = chercheurImages(f.filter((x) => estImage(x.nom)));
    assert.equal(trouver("Rumi Scène (2).PNG", "kdh").chemin, "kdh/images/rumi scene (2).png");
    assert.equal(trouver("Mira_KDH", "kdh").chemin, "kdh/images/mira-kdh.webp");
    const illus = packs.find((p) => p.epreuve === "illustre");
    assert.deepEqual(illus.manquantes, [{ q: 0, case: 3, fichier: "absente.jpg" }], "image absente : simple alerte");
    // Série de photos listée : la réponse écrite à côté de chaque image ; une image absente, la photo n'est pas importée.
    const zoom = packs.find((p) => p.epreuve === "photos");
    assert.deepEqual(zoom.questions.map((q) => [q.photo, q.choices[q.correct]]), [["rumi_kdh.png", "Rumi"], ["Mira-KDH.webp", "Mira"]]);
    assert.deepEqual(zoom.ignorees, ["« fantome.jpg » (Bobby) : image absente du ZIP, cette photo n'est pas importée."]);
    // Qui suis-je ? : l'image du personnage, facultative ; absente, une alerte.
    const qui = packs.find((p) => p.epreuve === "quisuis");
    assert.deepEqual(qui.personnages.map((x) => [x.answer, x.fichierImage ?? null]), [["Jinu", "jinu.jpg"], ["Derpy", null]]);
    assert.deepEqual(qui.manquantes.map((m) => [m.nom, m.fichier]), [["Derpy", "pas-la.png"]]);
  });

  test("une image de la banque n'est signalée que trop petite (ses proportions sont libres)", () => {
    assert.equal(alerteImage({ largeur: 1920, hauteur: 600, octets: 900_000 }, "revelation", { banque: true }), null);
    assert.match(alerteImage({ largeur: 200, hauteur: 150, octets: 9_000 }, "revelation", { banque: true }), /trop petite/);
    assert.match(alerteImage({ largeur: 1920, hauteur: 600, octets: 900_000 }, "revelation"), /panoramique/);
  });

  test("\"images\" donne un nom à chaque image (cedric, 25/10 : « Yoshi, Toad… ») : citée ou non, elle est gardée ; les autres restent de côté", () => {
    const zip = [
      fichier("mario/packs.json", JSON.stringify({ theme: "Mario", niveau: "Facile",
        images: [{ fichier: "IMG_001.jpg", nom: "Yoshi" }, { fichier: "img-002.PNG", nom: "Toad" }, { fichier: "IMG_003.jpg", nom: "Yoshi" }, { fichier: "absente.jpg", nom: "Bowser" }],
        packs: [{ title: "Zoom Mario", photos: [{ image: "IMG_001.jpg", reponse: "Yoshi" }] }] })),
      ...["IMG_001.jpg", "img_002.png", "IMG_003.jpg", "IMG_004.jpg"].map((n) => fichier(`mario/images/${n}`)),
    ];
    const { packs, erreurs, nommees, nomsAbsents, imagesInutiles } = analyserPack(zip);
    assert.deepEqual(erreurs, []);
    assert.deepEqual(packs.map((p) => [p.epreuve, p.theme, p.questions.length]), [["photos", "Mario", 1]], "la liste des noms n'est pas une série de photos");
    assert.deepEqual(nommees.map((x) => [x.chemin, x.nom, x.theme]), [
      ["mario/images/IMG_001.jpg", "Yoshi", "Mario"], ["mario/images/img_002.png", "Toad", "Mario"], ["mario/images/IMG_003.jpg", "Yoshi 2", "Mario"]], "un nom unique dans le thème");
    assert.deepEqual(nomsAbsents, ["absente.jpg"]);
    assert.equal(imagesInutiles, 1, "IMG_004 : ni citée ni nommée");
  });

  test("un fichier qui ne fait que nommer les images ({ theme, images }) s'importe seul ; une série de photos { image, reponse } reste une série", () => {
    const seul = analyserPack([fichier("noms-images.json", JSON.stringify({ theme: "Super Mario", images: [{ fichier: "a.jpg", nom: "Peach" }, { fichier: "b.jpg", nom: "Daisy", theme: "Princesses" }] })),
      fichier("images/a.jpg"), fichier("images/b.jpg"), fichier("images/c.jpg")]);
    assert.deepEqual([seul.erreurs, seul.packs], [[], []]);
    assert.deepEqual(seul.nommees.map((x) => [x.nom, x.theme]), [["Peach", "Super Mario"], ["Daisy", "Princesses"]]);
    assert.equal(seul.imagesInutiles, 1);
    // Rien de trouvé : aucune série de toutes les photos du ZIP.
    const absentes = analyserPack([fichier("noms-images.json", JSON.stringify({ theme: "Mario", images: [{ fichier: "x.jpg", nom: "X" }] })), fichier("images/a.jpg")]);
    assert.deepEqual([absentes.packs, absentes.nommees, absentes.nomsAbsents], [[], [], ["x.jpg"]]);
    const serie = analyserPack([fichier("pack.json", JSON.stringify({ title: "Disney", images: [{ image: "a.jpg", reponse: "Elsa" }] })), fichier("a.jpg")]);
    assert.deepEqual(serie.packs.map((p) => [p.epreuve, p.questions[0].choices[0]]), [["photos", "Elsa"]]);
    assert.deepEqual(serie.nommees, []);
  });
});

describe("images hors format (alerte, jamais bloquante)", () => {
  test("le bon format passe ; mauvais format, trop petite, trop forte ou trop lourde donnent une alerte claire", () => {
    assert.equal(alerteImage({ largeur: 800, hauteur: 600, octets: 70_000 }, "revelation"), null);
    assert.equal(alerteImage({ largeur: 1024, hauteur: 768, octets: 200_000 }, "photo"), null, "jusqu'au double et 4 fois le poids : acceptable");
    assert.equal(alerteImage({ largeur: 480, hauteur: 480, octets: 30_000 }, "case"), null);
    assert.match(alerteImage({ largeur: 1600, hauteur: 900, octets: 90_000 }, "revelation"), /^Image panoramique \(1600 × 900\) : attendu paysage 4:3, 800 × 600\. Elle sera recadrée/);
    assert.match(alerteImage({ largeur: 600, hauteur: 800, octets: 50_000 }, "photo"), /^Image en hauteur/);
    assert.match(alerteImage({ largeur: 640, hauteur: 480, octets: 30_000 }, "case"), /^Image paysage .* carré, 480 × 480/);
    assert.match(alerteImage({ largeur: 400, hauteur: 300, octets: 20_000 }, "revelation"), /^Image trop petite \(400 × 300\) : floue sur la TV/);
    assert.match(alerteImage({ largeur: 4000, hauteur: 3000, octets: 2_500_000 }, "photo"), /^Résolution trop forte \(4000 × 3000, 2500 Ko\)/);
    assert.match(alerteImage({ largeur: 800, hauteur: 600, octets: 900_000 }, "revelation"), /^Fichier trop lourd \(900 Ko\) : attendu 80 Ko au plus/);
    assert.equal(alerteImage({ largeur: 0, hauteur: 0, octets: 10 }, "photo"), null, "image non mesurée : pas d'alerte");
    assert.equal(alerteImage({ largeur: 800, hauteur: 600, octets: 10 }, "inconnu"), null);
    assert.deepEqual(Object.keys(FORMATS_IMAGES).sort(), ["case", "photo", "revelation"]);
  });
});

describe("thèmes des packs (cedric, 25/10 : la rubrique est le thème)", () => {
  test("le thème : celui du pack, sinon son nom sans le niveau ; deux écritures proches sont le même thème", async () => {
    const R = await import("../web/public/rangement.js");
    assert.equal(R.themeDe("", "Harry Potter – Moyen"), "Harry Potter");
    assert.equal(R.themeDe(null, "K-pop (Facile)"), "K-pop");
    assert.equal(R.themeDe("", "Top 3"), "Top 3", "un chiffre n'est pas un niveau");
    assert.equal(R.themeDe("  Mario  ", "Mario – Facile"), "Mario");
    assert.equal(R.cleTheme("K-Pop  Démon"), R.cleTheme("kpop demon"));
    assert.equal(R.themeExistant("kpop demon hunters", ["K-pop Demon Hunters", "Mario"]), "K-pop Demon Hunters");
    assert.equal(R.themeExistant("Barbie", ["Mario"]), "Barbie");
    // La Régie propose un thème déjà là : le même nom, ou un nom proche ; sinon un nouveau.
    assert.equal(R.themeProche("Kpop", ["K-pop Demon Hunters", "Mario"]), "K-pop Demon Hunters");
    assert.equal(R.themeProche("Super Mario", ["Mario", "Super Mario Bros"]), "Super Mario Bros");
    assert.equal(R.themeProche("Barbie", ["Mario"]), null);
    assert.equal(R.themeProche("Art", ["Arthur"]), null, "trop court pour être proche");
    const rangees = R.parTheme([{ theme: "kpop", title: "a", niveau: "Moyen" }, { theme: "K-pop", title: "b", niveau: "Facile" }, { theme: "K-pop", title: "c" }, { title: "Mario – Facile" }]);
    assert.deepEqual(rangees.map(([t, c]) => [t, c.map((x) => x.title)]), [["K-pop", ["b", "a", "c"]], ["Mario", ["Mario – Facile"]]]);
  });
});
