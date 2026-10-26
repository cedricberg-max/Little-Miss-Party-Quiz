/**
 * Pack importé d'un seul ZIP (cedric, 25/10) : la Régie PC lit elle-même les données du pack et ses images, sans IA ni
 * service extérieur. Les formats restent ceux des importeurs d'avant (packs de quiz, séries de Qui suis-je ?, photos
 * nommées pour Zoom mystère et Image floue) ; seul le ZIP est nouveau. Ici, rien ne touche la base ni les images : on
 * analyse les fichiers et on dit ce qui sera enregistré, ce qui manque (simple alerte) et ce qui empêche de lire le pack.
 */

import { lirePacks } from "./questions.js";
import { checkQuestions, imageKey, photoQuestions, questionsDePhotos, LETTERS } from "./importer.js";
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
/** Le nom serré : sans extension, ni espaces, tirets, soulignés, parenthèses… (« Rumi (1).PNG » = « rumi_1.png »). */
const serre = (cle) => sansExtension(cle).replace(/[^a-z0-9]/g, "");
/** Le premier texte non vide parmi [valeurs]. */
const texteDe = (...valeurs) => valeurs.find((v) => typeof v === "string" && v.trim())?.trim() ?? null;

/**
 * Personnages de Qui suis-je ? lus dans des données de pack (cedric, 24/10) : une série ({ serie, personnages }),
 * plusieurs ({ series: [...] }, ou une liste de séries), ou une simple liste de personnages (sa série : [nomFichier]).
 * En français ou en anglais : reponse / answer, indices / clues, emoji.
 */
export function lirePersonnages(data, nomFichier) {
  const liste = (x) => x?.personnages ?? x?.characters ?? x?.items;
  const perso = (p) => ({ answer: p?.reponse ?? p?.["réponse"] ?? p?.answer ?? p?.nom ?? p?.name, emoji: p?.emoji, clues: p?.indices ?? p?.clues, serie: p?.serie ?? p?.["série"],
    // Son image de révélation (cedric, 25/10), par son nom dans le dossier d'images du ZIP : facultative.
    image: texteDe(p?.image, p?.photo, p?.fichier, p?.file) });
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
 * Retrouve une image par son nom, dans tout le ZIP (cedric, 25/10 : le dossier d'images téléchargé à côté des packs),
 * sans tenir compte des majuscules, des accents, du dossier ni de l'extension (« Q1-Lion.PNG » trouve « q1-lion.jpg »),
 * en dernier recours ni des espaces, tirets, soulignés ou parenthèses. [images] : les fichiers images du ZIP.
 */
export function chercheurImages(images) {
  const exacts = new Map();
  const sans = new Map();
  const serres = new Map();
  const garder = (map, cle, f) => { if (!map.has(cle)) map.set(cle, f); };
  for (const f of images) {
    const cle = imageKey(f.nom);
    const dossier = dossierDe(f.chemin);
    garder(exacts, cle, f);
    garder(sans, sansExtension(cle), f);
    if (serre(cle)) garder(serres, serre(cle), f);
    garder(exacts, `${dossier}\u0000${cle}`, f);
    garder(sans, `${dossier}\u0000${sansExtension(cle)}`, f);
  }
  // [dossier] : celui du fichier de données ; ses images passent avant celles d'un autre dossier du même nom (un ZIP
  // qui range plusieurs packs, un dossier chacun).
  return (nom, dossier = null) => {
    const cle = imageKey(nom);
    const ici = dossier == null ? null : exacts.get(`${dossier}\u0000${cle}`) ?? sans.get(`${dossier}\u0000${sansExtension(cle)}`);
    return ici ?? exacts.get(cle) ?? sans.get(sansExtension(cle)) ?? (serre(cle) ? serres.get(serre(cle)) : null) ?? null;
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

/** Une entrée de "images" qui donne un nom (`{ fichier, nom }`), pas une photo à deviner (elle aurait sa réponse). */
const estNomDImage = (e) => !!e && typeof e === "object" && !texteDe(e.reponse, e["réponse"], e.answer)
  && !!texteDe(e.fichier, e.file, e.image, e.photo) && !!texteDe(e.nom, e.name);
/** "images" donne des noms d'images (cedric, 25/10) : une liste dont aucune entrée n'est une photo à deviner. */
const estListeDeNoms = (liste) => Array.isArray(liste) && liste.length > 0 && liste.every((e) => estNomDImage(e) || !e || typeof e !== "object");
/** Ce qui fait d'un fichier de données un pack (ou une série) : sans rien de cela, il ne fait que nommer des images. */
const CLES_CONTENU = ["packs", "questions", "personnages", "characters", "items", "series", "photos"];

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
 * Quiz illustré (cedric, 26/10 : six packs Marvel rangés sans une seule image, leurs questions en texte seul sur la TV) :
 * une fois les images du ZIP préparées, une question dont aucune réponse n'a sa photo n'est pas importée, et le dit en
 * rouge ([p].ignorees) ; ses alertes suivent les questions gardées. Sans question gardée, le pack reste vide et n'est
 * pas importé. Une question à qui il ne manque qu'une partie de ses photos reste (simple alerte, à compléter dans
 * « Éditer » ; le 🎲 ne la tire pas d'ici là). Les Juste Chiffre du pack restent. Rend [p], modifié sur place.
 */
export function garderLesQuestionsIllustrees(p) {
  if (p?.epreuve !== "illustre") return p;
  const place = new Map();
  const gardees = [];
  p.questions.forEach((q, i) => {
    const choix = (q.choices ?? []).slice(0, 4);
    if (q.kind === "number" || choix.some((_, k) => q.choiceImages?.[k])) { place.set(i, gardees.length); gardees.push(q); return; }
    const noms = (q.imageFiles ?? []).slice(0, 4).filter(Boolean);
    const quoi = noms.length ? `aucune de ses images n'est dans le ZIP (${noms.join(", ")})` : "aucune réponse n'a d'image";
    p.ignorees.push(`${ouQuestion(i)} : ${quoi}. Elle n'est pas importée : au Quiz illustré, chaque réponse a sa photo.`);
  });
  const suivre = (liste) => (liste ?? []).filter((x) => x.q == null || place.has(x.q)).map((x) => (x.q == null ? x : { ...x, q: place.get(x.q) }));
  p.manquantes = suivre(p.manquantes);
  p.aCorriger = suivre(p.aCorriger);
  if (p.horsFormat) p.horsFormat = suivre(p.horsFormat);
  p.questions = gardees;
  return p;
}

/**
 * Analyse les fichiers d'un ZIP : `[{ chemin, nom, texte? }]`, le texte lu pour les fichiers de données (.json).
 * Renvoie `{ packs, erreurs, laisses }` :
 * - packs : `{ epreuve, titre, theme, ageMin, ageMax, questions | personnages, manquantes, aCorriger, ignorees, fichierDonnees }`,
 *   chaque question gardant ses noms d'images attendus (revealFile, imageFiles) ou, en série de photos, `photo` ;
 * - erreurs : ce qui empêche de lire le pack (rien ne sera enregistré) ;
 * - laisses : fichiers laissés de côté (liste.txt de relecture…) ;
 * - imagesInutiles : le nombre d'images du ZIP qui ne servent à aucun pack ni ne sont nommées (jamais téléversées) ;
 * - nommees : les images nommées par "images" et trouvées dans le ZIP, `{ fichier, chemin, nom, theme }` ;
 * - nomsAbsents : les fichiers nommés par "images" mais absents du ZIP.
 */
export function analyserPack(fichiers, { nomZip = "" } = {}) {
  const images = fichiers.filter((f) => estImage(f.nom));
  const donnees = fichiers.filter((f) => estDonnees(f.nom));
  const autres = fichiers.filter((f) => !estImage(f.nom) && !estDonnees(f.nom));
  const erreurs = [];
  const laisses = autres.map((f) => f.nom);
  const packs = [];

  // Fiche seule (pack.json d'une série de photos, cedric 25/10) : un nom, une famille, un niveau, sans questions.
  // Un seul fichier pour tout un thème (cedric, 25/10 : packs.json = { theme, packs: [ … ] }) : chaque pack de la
  // liste est lu comme s'il était seul dans son fichier (Quiz, Quiz illustré, Vrai / Faux, Qui suis-je ?, série de
  // photos), avec le thème et le niveau du haut du fichier s'il n'a pas les siens.
  //
  // Noms des images (cedric, 25/10 : « que l'IA les renomme toutes, pour que je tape directement Yoshi, Toad… ») :
  // "images": [{ fichier, nom }] au haut de packs.json, ou seul avec son thème (noms-images.json = { theme, images }).
  // Chaque image listée arrive dans la bibliothèque sous ce nom, citée par une question ou non.
  const listes = [];
  const lues = donnees.flatMap((f) => {
    let data = lireJson(f.texte);
    if (data && typeof data === "object" && !Array.isArray(data) && estListeDeNoms(data.images)) {
      const { images: liste, ...reste } = data;
      const theme = texteDe(data.theme, data["thème"], Array.isArray(data.packs) ? texteDe(...data.packs.map((x) => x?.theme ?? x?.["thème"])) : null);
      listes.push({ liste, theme });
      if (!CLES_CONTENU.some((k) => k in reste)) return [];
      data = reste;
      f = { ...f, texte: JSON.stringify(reste) };
    }
    if (!Array.isArray(data?.packs) || !data.packs.some((x) => x && typeof x === "object")) return [{ f, data }];
    const haut = Object.fromEntries(["theme", "thème", "niveau", "famille"].filter((k) => typeof data[k] === "string" && data[k].trim()).map((k) => [k, data[k]]));
    return data.packs.filter((x) => x && typeof x === "object" && !Array.isArray(x)).map((x) => {
      const pack = { ...haut, ...x };
      return { f: { ...f, texte: JSON.stringify(pack) }, data: pack };
    });
  });
  const fiches = lues.filter(({ data }) => estFicheSeule(data));
  const avecContenu = lues.filter((x) => !fiches.includes(x));
  const servies = new Set();
  const trouver = chercheurImages(images);

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
      epreuve: "photos", titre: titre || (avecContenu.length || fiches.length > 1 ? nomDossier : nomDuDossier(fichiers, nomZip)) || "Mes photos",
      theme: typeof fiche?.theme === "string" ? fiche.theme.trim().slice(0, 80) : "",
      ageMin: null, ageMax: null, ...etiquettesDu(fiche), dossier, questions, manquantes: [], aCorriger: [], ignorees: [],
    });
  };
  // Série de photos listée dans sa fiche (cedric, 25/10 : les images dans un dossier téléchargé à part, aux noms
  // d'origine) : chaque photo par son nom, sa réponse écrite à côté ; une photo absente du ZIP n'est pas importée.
  const photosListees = (fiche) => {
    const liste = fiche?.photos ?? fiche?.images;
    return Array.isArray(liste) ? liste : null;
  };
  const serieListee = (liste, fiche, dossier) => {
    const titre = texteDe(fiche?.title, fiche?.titre, fiche?.nom) ?? "Mes photos";
    if (liste.length > MAX_PHOTOS_SERIE) {
      erreurs.push(`« ${titre} » : ${liste.length} photos : ${MAX_PHOTOS_SERIE} au plus par série. Faites deux séries.`);
      return;
    }
    const ignorees = [];
    const gardees = [];
    liste.forEach((p, i) => {
      const nom = texteDe(p?.image, p?.fichier, p?.photo, p?.file);
      const reponse = texteDe(p?.reponse, p?.["réponse"], p?.answer, p?.nom, p?.name);
      if (!nom || !reponse) { ignorees.push(`Photo ${i + 1} : il faut le nom de son image et sa réponse, elle n'est pas importée.`); return; }
      const f = trouver(nom, dossier);
      if (!f) { ignorees.push(`« ${nom} » (${reponse}) : image absente du ZIP, cette photo n'est pas importée.`); return; }
      servies.add(f.chemin);
      gardees.push({ nom, reponse });
    });
    const questions = questionsDePhotos(gardees.map((x) => x.reponse)).map((q, i) => ({ ...q, photo: gardees[i].nom }));
    packs.push({
      epreuve: "photos", titre, theme: typeof fiche?.theme === "string" ? fiche.theme.trim().slice(0, 80) : "",
      ageMin: null, ageMax: null, ...etiquettesDu(fiche), dossier, questions, manquantes: [], aCorriger: [], ignorees,
    });
  };
  // Les images nommées trouvées dans le ZIP : un nom unique par thème (« Yoshi », « Yoshi 2 »), une image une seule fois.
  const nommees = [];
  const nomsAbsents = [];
  const chemins = new Set();
  const pris = new Set();
  for (const { liste, theme } of listes) {
    for (const e of liste) {
      if (!estNomDImage(e)) continue;
      const fichier = texteDe(e.fichier, e.file, e.image, e.photo);
      const base = texteDe(e.nom, e.name).replace(/\s+/g, " ").slice(0, 80);
      const leTheme = texteDe(e.theme, e["thème"], theme)?.slice(0, 80) ?? null;
      const f = trouver(fichier, null);
      if (!f) { nomsAbsents.push(fichier); continue; }
      if (chemins.has(f.chemin)) continue;
      chemins.add(f.chemin);
      servies.add(f.chemin);
      const cle = (n) => `${`${leTheme ?? ""}`.toLowerCase()}\u0000${n.toLowerCase()}`;
      let nom = base;
      for (let k = 2; pris.has(cle(nom)); k++) nom = `${base.slice(0, 76)} ${k}`;
      pris.add(cle(nom));
      nommees.push({ fichier, chemin: f.chemin, nom, theme: leTheme });
    }
  }
  const fin = () => {
    const inutiles = images.filter((f) => !servies.has(f.chemin)).length;
    return { packs: erreurs.length ? [] : packs, erreurs, laisses, imagesInutiles: inutiles, nommees, nomsAbsents };
  };
  // Un ZIP qui ne fait que nommer ses images : rien d'autre à lire.
  if (!lues.length && listes.length) return fin();
  if (!avecContenu.length && fiches.length <= 1 && !photosListees(fiches[0]?.data)) {
    if (!images.length) return { packs, erreurs: ["Ce ZIP ne contient ni données de pack ni photos. Vérifiez que vous avez choisi le bon fichier."], laisses, imagesInutiles: 0, nommees, nomsAbsents };
    serieDePhotos(images, fiches[0]?.data ?? null, fiches[0] ? dossierDe(fiches[0].f.chemin) : null);
    return fin();
  }
  for (const { f, data } of fiches) {
    const dossier = dossierDe(f.chemin);
    if (photosListees(data)) { serieListee(photosListees(data), data, dossier); continue; }
    const photos = images.filter((x) => dossierDe(x.chemin) === dossier);
    if (photos.length) serieDePhotos(photos, data, dossier);
    else laisses.push(f.nom);
  }

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
      const manquantes = [];
      series.forEach(({ serie, personnages: ps }) => ps.forEach((p, i) => {
        const item = jeu.clean({ ...p, serie: p.serie || serie });
        // Son image, par son nom : trouvée, elle sera téléversée ; absente, une simple alerte.
        if (item && p.image) {
          const img = trouver(p.image, dossierDe(f.chemin));
          if (img) { servies.add(img.chemin); item.fichierImage = p.image; } else manquantes.push({ q: personnages.length, case: null, fichier: p.image, nom: item.answer });
        }
        if (item) personnages.push(item);
        else ignorees.push(`Personnage ${i + 1}${p.answer ? ` (« ${p.answer} »)` : ""} : il faut sa réponse et au moins 2 indices.`);
      }));
      if (!personnages.length) { erreurs.push(`Aucun personnage complet dans « ${f.nom} » : chacun a besoin de sa réponse et d'au moins 2 indices.`); continue; }
      const noms = [...new Set(personnages.map((p) => p.serie).filter(Boolean))];
      const parent = Array.isArray(data?.series) ? data.series.find((x) => x?.famille || x?.niveau) : null;
      packs.push({ epreuve: "quisuis", titre: noms.join(", ") || "Mes personnages", theme: "", ageMin: null, ageMax: null, ...etiquettesDu(data, parent), dossier: dossierDe(f.chemin), personnages, manquantes, aCorriger: [], ignorees, fichierDonnees: f.nom });
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
  return fin();
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
export function alerteImage({ largeur, hauteur, octets }, usage, { banque = false } = {}) {
  const f = FORMATS_IMAGES[usage];
  if (!f || !largeur || !hauteur) return null;
  const taille = `${largeur} × ${hauteur}`;
  // Une image de la banque téléchargée à part (cedric, 25/10) : prise telle quelle, de toutes les tailles ; seule une
  // image trop petite (floue sur la TV) est signalée.
  if (banque) return largeur < f.largeur * 0.6 && hauteur < f.hauteur * 0.6 ? `Image trop petite (${taille}) : floue sur la TV. Attendu ${f.nom}.` : null;
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
