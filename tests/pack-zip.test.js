// Import d'un pack en un seul ZIP (cedric, 25/10) : lecture du ZIP dans le navigateur et analyse du pack.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { faireZip } from "./zip-outil.js";
import { lireZip, cheminSur, estFichierSysteme } from "../web/public/zip.js";
import { analyserPack, IMAGE_MANQUANTE, MAX_PHOTOS_SERIE, lirePersonnages } from "../web/public/pack-zip.js";

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
    const { packs, erreurs, laisses } = analyserPack([
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
    assert.deepEqual(laisses.sort(), ["en-trop.jpg", "liste.txt"]);
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
