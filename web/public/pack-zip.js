/**
 * Pack importé d'un seul ZIP (cedric, 25/10) : la Régie PC lit elle-même les données du pack et ses images, sans IA ni
 * service extérieur. Les formats restent ceux des importeurs d'avant (packs de quiz, séries de Qui suis-je ?, photos
 * nommées pour Zoom mystère et Image floue) ; seul le ZIP est nouveau. Ici, rien ne touche la base ni les images : on
 * analyse les fichiers et on dit ce qui sera enregistré, ce qui manque (simple alerte) et ce qui empêche de lire le pack.
 */

import { lirePacks } from "./questions.js";
import { checkQuestions, imageKey, photoQuestions, LETTERS } from "./importer.js";
import { CONTENT_GAMES } from "./show.js";

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
  for (const f of images) {
    const cle = imageKey(f.nom);
    if (!exacts.has(cle)) exacts.set(cle, f);
    if (!sans.has(sansExtension(cle))) sans.set(sansExtension(cle), f);
  }
  return (nom) => exacts.get(imageKey(nom)) ?? sans.get(sansExtension(imageKey(nom))) ?? null;
}

const estVraiFaux = (q) => q.kind !== "number" && q.choices?.length === 2 && q.choices.map((c) => `${c}`.toLowerCase()).join("/") === "vrai/faux";

/** Dossier du pack : le dossier englobant commun à ses fichiers, sinon le nom du ZIP. */
function nomDuDossier(fichiers, nomZip) {
  const dossiers = new Set(fichiers.map((f) => (f.chemin.includes("/") ? f.chemin.split("/")[0] : "")));
  const [seul] = dossiers;
  const nom = dossiers.size === 1 && seul ? seul : `${nomZip ?? ""}`.replace(/\.zip$/i, "");
  return nom.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
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

  // Pas de données : une série de photos (Zoom mystère, Image floue), la réponse dans le nom de chaque photo.
  if (!donnees.length) {
    if (!images.length) return { packs, erreurs: ["Ce ZIP ne contient ni données de pack ni photos. Vérifiez que vous avez choisi le bon fichier."], laisses };
    if (images.length > MAX_PHOTOS_SERIE) {
      return { packs, erreurs: [`Ce ZIP contient ${images.length} photos : ${MAX_PHOTOS_SERIE} au plus par série. Faites deux ZIP.`], laisses };
    }
    const triees = [...images].sort((a, b) => a.nom.localeCompare(b.nom, "fr", { numeric: true }));
    const questions = photoQuestions(triees.map((f) => f.nom)).map((q, i) => ({ ...q, photo: triees[i].nom }));
    packs.push({ epreuve: "photos", titre: nomDuDossier(fichiers, nomZip) || "Mes photos", theme: "", ageMin: null, ageMax: null, questions, manquantes: [], aCorriger: [], ignorees: [] });
    return { packs, erreurs, laisses };
  }

  const trouver = chercheurImages(images);
  const servies = new Set();
  for (const f of donnees) {
    const corps = `${f.texte ?? ""}`.replace(/^﻿/, "").replace(/```(?:json)?/gi, "").trim();
    let data;
    try { data = JSON.parse(corps); } catch {
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
      packs.push({ epreuve: "quisuis", titre: noms.join(", ") || "Mes personnages", theme: "", ageMin: null, ageMax: null, personnages, manquantes: [], aCorriger: [], ignorees, fichierDonnees: f.nom });
      continue;
    }
    const lu = lirePacks(corps);
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
      questions.forEach((q, i) => {
        if (q.revealFile) { if (trouver(q.revealFile)) servies.add(imageKey(trouver(q.revealFile).nom)); else manquantes.push({ q: i, case: null, fichier: q.revealFile }); }
        (q.imageFiles ?? []).forEach((nom, k) => {
          if (!nom) return;
          if (trouver(nom)) servies.add(imageKey(trouver(nom).nom));
          else manquantes.push({ q: i, case: k, fichier: nom });
        });
      });
      const verifs = checkQuestions(questions);
      const aCorriger = verifs.map((v, i) => (v.errors.length ? { q: i, messages: v.errors } : null)).filter(Boolean);
      const epreuve = questions.some((q) => (q.imageFiles ?? []).some(Boolean)) ? "illustre"
        : questions.filter((q) => q.kind !== "number").length && questions.every((q) => q.kind === "number" || estVraiFaux(q)) ? "vraifaux" : "quiz";
      packs.push({
        epreuve, titre: p.title || p.theme || nomDuDossier(fichiers, nomZip) || "Pack sans titre", theme: p.theme || "",
        ageMin: p.ageMin ?? null, ageMax: p.ageMax ?? null, questions, manquantes, aCorriger, ignorees, fichierDonnees: f.nom,
      });
    }
  }
  const inutiles = images.filter((f) => !servies.has(imageKey(f.nom)));
  laisses.push(...inutiles.map((f) => f.nom));
  return { packs: erreurs.length ? [] : packs, erreurs, laisses };
}
