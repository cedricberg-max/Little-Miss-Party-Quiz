/**
 * Pack importé d'un seul ZIP (cedric, 25/10) : la Régie PC lit elle-même les données du pack et ses images, sans IA ni
 * service extérieur. Les formats restent ceux des importeurs d'avant (packs de quiz, séries de Qui suis-je ?, photos
 * nommées pour Zoom mystère et Image floue) ; seul le ZIP est nouveau. Ici, rien ne touche la base ni les images : on
 * analyse les fichiers et on dit ce qui sera enregistré, ce qui manque (simple alerte) et ce qui empêche de lire le pack.
 */

import { lirePacks } from "./questions.js";
import { checkQuestions, imageKey, photoQuestions, LETTERS } from "./importer.js";
import { CONTENT_GAMES } from "./show.js";
import { etiquettes, niveauDesAges } from "./rangement.js";

/** Phrase de l'alerte d'une image attendue mais absente (cedric, 25/10), au mot près. */
export const IMAGE_MANQUANTE = "Image manquante : ajoutez une illustration.";

/** Au plus autant de photos dans une série de Zoom mystère / Image floue. */
export const MAX_PHOTOS_SERIE = 40;

/** Épreuves reconnues dans un pack, avec leur nom à l'écran. */
export const EPREUVES = {
  quiz: "Quiz", illustre: "Quiz illustré", vraifaux: "Vrai ou Faux express", photos: "Zoom mystère / Image floue", quisuis: "Qui suis-je ?",
};

export const estImage = (nom) => /\.(jpe?g|png|webp|gif)$/i.test(nom ?? "");
const estDonnees = (nom) => /\.json$/i.test(nom ?? "");
const sansExtension = (cle) => cle.replace(/\.[a-z0-9]+$/, "");

/**
 * Personnages de Qui suis-je ? lus dans des données de pack (cedric, 24/10) : une série ({ serie, personnages }),
 * plusieurs ({ series: [...] }, ou une liste de séries), ou une simple liste de personnages (sa série : [nomFichier]).
 * En français ou en anglais : reponse / answer, indices / clues, emoji.
 */
export function lirePersonnages(data, nomFichier) {
  const liste = (x) => x?.personnages ?? x?.characters ?? x?.items;
  const perso = (p) => ({ answer: p?.reponse ?? p?.["réponse"] ?? p?.answer ?? p?.nom ?? p?.name, emoji: p?.emoji, clues: p?.indices ?? p?.clues, serie: p?.serie ?? p?.["série"] });
  const serieDe = (x) => ({
    serie: [x?.serie, x?.["série"], x?.titre, x?.title, x?.nom, x?.name].find((v) => typeof v === "string" && v.trim()) ?? nomFichier,
    personnages: liste(x).map(perso),
  });
  const estSerie = (x) => Array.isArray(liste(x));
  if (Array.isArray(data?.series)) return data.series.filter(estSerie).map(serieDe);
  if (estSerie(data)) return [serieDe(data)];
  if (Array.isArray(data) && data.some(estSerie)) return data.filter(estSerie).map(serieDe);
  if (Array.isArray(data) && data.length && data.every((p) => p && typeof p === "object" && (p.indices ?? p.clues))) return [{ serie: nomFichier, personnages: data.map(perso) }];
  return [];
}

/**
 * Retrouve une image par son nom, sans tenir compte des majuscules, des accents, du dossier ni de l'extension
 * (« Q1-Lion.PNG » trouve « q1-lion.jpg »). [images] : les fichiers images du ZIP.
 */
export function chercheurImages(images) {
  const exacts = new Map();
  const sans = new Map();
  const garder = (map, cle, f) => { if (!map.has(cle)) map.set(cle, f); };
  for (const f of images) {
    const cle = imageKey(f.nom);
    const dossier = dossierDe(f.chemin);
    garder(exacts, cle, f);
    garder(sans, sansExtension(cle), f);
    garder(exacts, `${dossier}\u0000${cle}`, f);
    garder(sans, `${dossier}\u0000${sansExtension(cle)}`, f);
  }
  // [dossier] : celui du fichier de données ; ses images passent avant celles d'un autre dossier du même nom (un ZIP
  // qui range plusieurs packs, un dossier chacun).
  return (nom, dossier = null) => {
    const cle = imageKey(nom);
    const ici = dossier == null ? null : exacts.get(`${dossier}\u0000${cle}`) ?? sans.get(`${dossier}\u0000${sansExtension(cle)}`);
    return ici ?? exacts.get(cle) ?? sans.get(sansExtension(cle)) ?? null;
  };
}

/** Dossier d'un chemin du ZIP (« » à la racine). */
export const dossierDe = (chemin) => (`${chemin ?? ""}`.includes("/") ? chemin.slice(0, chemin.lastIndexOf("/")) : "");

const estVraiFaux = (q) => q.kind !== "number" && q.choices?.length === 2 && q.choices.map((c) => `${c}`.toLowerCase()).join("/") === "vrai/faux";

/** Dossier du pack : le dossier englobant commun à ses fichiers, sinon le nom du ZIP. */
function nomDuDossier(fichiers, nomZip) {
  const dossiers = new Set(fichiers.map((f) => (f.chemin.includes("/") ? f.chemin.split("/")[0] : "")));
  const [seul] = dossiers;
  const nom = dossiers.size === 1 && seul ? seul : `${nomZip ?? ""}`.replace(/\.zip$/i, "");
  return nom.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

const corpsJson = (texte) => `${texte ?? ""}`.replace(/^\uFEFF/, "").replace(/```(?:json)?/gi, "").trim();
/** Les données d'un fichier .json, ou undefined s'il est mal écrit. */
function lireJson(texte) {
  try { return JSON.parse(corpsJson(texte)); } catch { return undefined; }
}
/** Fiche seule d'une série de photos (pack.json) : un objet avec un nom, une famille ou un niveau, sans questions ni personnages. */
const estFicheSeule = (x) => !!x && typeof x === "object" && !Array.isArray(x)
  && !["questions", "personnages", "characters", "items", "series", "packs"].some((k) => k in x)
  && ["title", "titre", "nom", "famille", "niveau"].some((k) => k in x);

/**
 * Les deux étiquettes d'un pack (cedric, 25/10) : `{ famille, niveau, niveauDeduit }`. Sans niveau écrit, celui de ses
 * âges (niveauDeduit vrai) ; null quand rien ne le dit : l'aperçu d'import le demande alors.
 */
function etiquettesDu(x, parent = null) {
  const { famille, niveau } = etiquettes(x, parent);
  const deduit = niveau ? null : niveauDesAges(x?.ageMin ?? null, x?.ageMax ?? null);
  return { famille, niveau: niveau ?? deduit, niveauDeduit: !niveau && !!deduit };
}

/** « Question 3 », « Question 3, réponse B », pour retrouver l'endroit d'une alerte. */
export const ouQuestion = (i, k = null) => `Question ${i + 1}${k == null ? "" : `, réponse ${LETTERS[k] ?? k + 1}`}`;

/**
 * Analyse les fichiers d'un ZIP : `[{ chemin, nom, texte? }]`, le texte lu pour les fichiers de données (.json).
 * Renvoie `{ packs, erreurs, laisses }` :
 * - packs : `{ epreuve, titre, theme, ageMin, ageMax, questions | personnages, manquantes, aCorriger, ignorees, fichierDonnees }`,
 *   chaque question gardant ses noms d'images attendus (revealFile, imageFiles) ou, en série de photos, `photo` ;
 * - erreurs : ce qui empêche de lire le pack (rien ne sera enregistré) ;
 * - laisses : fichiers laissés de côté (liste.txt de relecture, images qui ne servent à rien…).
 */
export function analyserPack(fichiers, { nomZip = "" } = {}) {
  const images = fichiers.filter((f) => estImage(f.nom));
  const donnees = fichiers.filter((f) => estDonnees(f.nom));
  const autres = fichiers.filter((f) => !estImage(f.nom) && !estDonnees(f.nom));
  const erreurs = [];
  const laisses = autres.map((f) => f.nom);
  const packs = [];

  // Fiche seule (pack.json d'une série de photos, cedric 25/10) : un nom, une famille, un niveau, sans questions.
  const lues = donnees.map((f) => ({ f, data: lireJson(f.texte) }));
  const fiches = lues.filter(({ data }) => estFicheSeule(data));
  const avecContenu = lues.filter((x) => !fiches.includes(x));
  const servies = new Set();

  // Série de photos (Zoom mystère, Image floue) : la réponse dans le nom de chaque photo. Sans aucune donnée, toutes
  // les photos du ZIP ; dans un ZIP global (cedric, 25/10), chaque dossier qui a sa fiche pack.json, avec ses photos.
  const serieDePhotos = (photos, fiche, dossier) => {
    if (photos.length > MAX_PHOTOS_SERIE) {
      erreurs.push(`${fiche?.title ? `« ${fiche.title} » : ` : "Ce ZIP contient "}${photos.length} photos : ${MAX_PHOTOS_SERIE} au plus par série. Faites deux séries.`);
      return;
    }
    const triees = [...photos].sort((a, b) => a.nom.localeCompare(b.nom, "fr", { numeric: true }));
    triees.forEach((f) => servies.add(f.chemin));
    const questions = photoQuestions(triees.map((f) => f.nom)).map((q, i) => ({ ...q, photo: triees[i].nom }));
    const titre = [fiche?.title, fiche?.titre, fiche?.nom].find((v) => typeof v === "string" && v.trim())?.trim();
    const nomDossier = dossier ? dossier.split("/").pop().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() : "";
    packs.push({
      epreuve: "photos", titre: titre || (avecContenu.length || fiches.length > 1 ? nomDossier : nomDuDossier(fichiers, nomZip)) || "Mes photos", theme: "",
      ageMin: null, ageMax: null, ...etiquettesDu(fiche), dossier, questions, manquantes: [], aCorriger: [], ignorees: [],
    });
  };
  if (!avecContenu.length && fiches.length <= 1) {
    if (!images.length) return { packs, erreurs: ["Ce ZIP ne contient ni données de pack ni photos. Vérifiez que vous avez choisi le bon fichier."], laisses };
    serieDePhotos(images, fiches[0]?.data ?? null, fiches[0] ? dossierDe(fiches[0].f.chemin) : null);
    return { packs: erreurs.length ? [] : packs, erreurs, laisses };
  }
  for (const { f, data } of fiches) {
    const dossier = dossierDe(f.chemin);
    const photos = images.filter((x) => dossierDe(x.chemin) === dossier);
    if (photos.length) serieDePhotos(photos, data, dossier);
    else laisses.push(f.nom);
  }

  const trouver = chercheurImages(images);
  for (const { f, data } of avecContenu) {
    if (data === undefined) {
      erreurs.push(`Les données du pack (« ${f.nom} ») sont mal écrites : il manque sans doute une virgule, un guillemet ou une accolade. Faites-les réécrire, puis refaites le ZIP.`);
      continue;
    }
    // Qui suis-je ? : des personnages avec leurs indices, sans image.
    const series = lirePersonnages(data, f.nom.replace(/\.json$/i, ""));
    if (series.length) {
      const jeu = CONTENT_GAMES.quisuis;
      const personnages = [];
      const ignorees = [];
      series.forEach(({ serie, personnages: ps }) => ps.forEach((p, i) => {
        const item = jeu.clean({ ...p, serie: p.serie || serie });
        if (item) personnages.push(item);
        else ignorees.push(`Personnage ${i + 1}${p.answer ? ` (« ${p.answer} »)` : ""} : il faut sa réponse et au moins 2 indices.`);
      }));
      if (!personnages.length) { erreurs.push(`Aucun personnage complet dans « ${f.nom} » : chacun a besoin de sa réponse et d'au moins 2 indices.`); continue; }
      const noms = [...new Set(personnages.map((p) => p.serie).filter(Boolean))];
      const parent = Array.isArray(data?.series) ? data.series.find((x) => x?.famille || x?.niveau) : null;
      packs.push({ epreuve: "quisuis", titre: noms.join(", ") || "Mes personnages", theme: "", ageMin: null, ageMax: null, ...etiquettesDu(data, parent), personnages, manquantes: [], aCorriger: [], ignorees, fichierDonnees: f.nom });
      continue;
    }
    const lu = lirePacks(corpsJson(f.texte));
    if (lu.erreur) { erreurs.push(`« ${f.nom} » : aucune question ni personnage trouvé. Vérifiez que c'est bien un pack de la Régie PC.`); continue; }
    for (const p of lu.packs) {
      const ignorees = [];
      const questions = [];
      p.questions.forEach((q, i) => {
        if (q.kind === "number" || q.choices.length) questions.push({ ...q, rang: i });
        else ignorees.push(`${ouQuestion(i)} : ni propositions ni nombre à trouver, elle n'est pas importée.`);
      });
      if (!questions.length) { erreurs.push(`« ${p.title || f.nom} » : aucune question complète (il faut des propositions, ou un nombre pour le Juste Chiffre).`); continue; }
      // Images attendues : celle de la révélation, celles des propositions ; absentes = simple alerte.
      const manquantes = [];
      const dossier = dossierDe(f.chemin);
      questions.forEach((q, i) => {
        const trouvee = (nom) => trouver(nom, dossier);
        if (q.revealFile) { if (trouvee(q.revealFile)) servies.add(trouvee(q.revealFile).chemin); else manquantes.push({ q: i, case: null, fichier: q.revealFile }); }
        (q.imageFiles ?? []).forEach((nom, k) => {
          if (!nom) return;
          if (trouvee(nom)) servies.add(trouvee(nom).chemin);
          else manquantes.push({ q: i, case: k, fichier: nom });
        });
      });
      const verifs = checkQuestions(questions);
      const aCorriger = verifs.map((v, i) => (v.errors.length ? { q: i, messages: v.errors } : null)).filter(Boolean);
      const epreuve = questions.some((q) => (q.imageFiles ?? []).some(Boolean)) ? "illustre"
        : questions.filter((q) => q.kind !== "number").length && questions.every((q) => q.kind === "number" || estVraiFaux(q)) ? "vraifaux" : "quiz";
      packs.push({
        epreuve, titre: p.title || p.theme || nomDuDossier(fichiers, nomZip) || "Pack sans titre", theme: p.theme || "",
        ageMin: p.ageMin ?? null, ageMax: p.ageMax ?? null, ...etiquettesDu(p), dossier, questions, manquantes, aCorriger, ignorees, fichierDonnees: f.nom,
      });
    }
  }
  const inutiles = images.filter((f) => !servies.has(f.chemin));
  laisses.push(...inutiles.map((f) => f.nom));
  return { packs: erreurs.length ? [] : packs, erreurs, laisses };
}

/**
 * Formats attendus des images d'un pack (ceux du prompt ChatGPT) : révélation du Quiz et photo de Zoom mystère /
 * Image floue en paysage 4:3, 800 × 600 ; réponse du Quiz illustré en carré, 480 × 480.
 */
export const FORMATS_IMAGES = {
  revelation: { largeur: 800, hauteur: 600, octets: 80_000, nom: "paysage 4:3, 800 × 600" },
  photo: { largeur: 800, hauteur: 600, octets: 80_000, nom: "paysage 4:3, 800 × 600" },
  case: { largeur: 480, hauteur: 480, octets: 35_000, nom: "carré, 480 × 480" },
};

const ko = (n) => `${Math.round(n / 1000)} Ko`;

/**
 * Alerte d'une image hors des règles (cedric, 25/10), sinon null ; jamais bloquante. Acceptable : le bon format à 10 %
 * près, au moins 60 % de la taille attendue, au plus le double, et un fichier d'au plus 4 fois le poids attendu
 * (la Régie réduit de toute façon chaque image à l'import : la place reste maîtrisée, l'alerte vise la qualité).
 */
export function alerteImage({ largeur, hauteur, octets }, usage) {
  const f = FORMATS_IMAGES[usage];
  if (!f || !largeur || !hauteur) return null;
  const taille = `${largeur} × ${hauteur}`;
  const ecart = (largeur / hauteur) / (f.largeur / f.hauteur);
  if (ecart > 1.1 || ecart < 1 / 1.1) {
    const forme = largeur / hauteur > 1.1 ? (largeur / hauteur > 1.5 ? "panoramique" : "paysage") : largeur / hauteur < 1 / 1.1 ? "en hauteur" : "carrée";
    return `Image ${forme} (${taille}) : attendu ${f.nom}. Elle sera recadrée sur la TV.`;
  }
  if (largeur < f.largeur * 0.6) return `Image trop petite (${taille}) : floue sur la TV. Attendu ${f.nom}.`;
  if (largeur > f.largeur * 2) return `Résolution trop forte (${taille}${octets ? `, ${ko(octets)}` : ""}) : attendu ${f.nom}. La Régie la réduit, mais demandez la bonne taille.`;
  if (octets > f.octets * 4) return `Fichier trop lourd (${ko(octets)}) : attendu ${ko(f.octets)} au plus. La Régie le réduit, mais demandez la bonne taille.`;
  return null;
}
