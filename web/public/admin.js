import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth, signInAnonymously, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, push, onValue, serverTimestamp, connectDatabaseEmulator, query, orderByKey, limitToLast,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { defisDuTexte } from "./defis.js";
import { passwordHash, newSalt, cleanPassword, passwordCandidates, MIN_PASSWORD_LENGTH } from "./secret.js";
import { TEST_PRESTATION, TEST_TITRE, TEST_FICHE, TEST_NOTES, JEUX_DU_TEST, demosAEffacer, nbDemos } from "./test-show.js";
import { writeProof, isAdmin } from "./proof.js";
import { parseQuiz, checkQuestions, geminiPrompt, chatgptUrl, imageKey, wordFromImage, photoQuestions, LETTERS } from "./importer.js";
import { PROFILES, profileForAge, defaultDuration } from "./profiles.js";
import {
  buildSnapshot, dureeEstimee, playable, expressQuestions, zoomQuestions, showTitle, titreAuto, ROUND_TYPES, BUILTIN_GAMES, readiness, daysUntil, duplicateShow, isoDay, ETATS, etatPrestation,
  roundFilled, MIME_TURN, MIME_TURN_MAX, MUSIC_GAMES, playableTracks, BLIND_SEC, PICTO_SECONDS, PICTO_SEC, PICTO_POINTS, PICTO_RULE,
  blindScale, trackPoints, BLIND_REVEAL_SECONDS, QUIZ_GAMES, CONTENT_GAMES, activeItems, contentExtras, contentSlot, contentImages,
  pictoSeriesOf, pictoSeriesList, pictoRoundSeries, foldLegacyFinale, showMatches, isArchived, AUTO_ARCHIVE_DAYS, quizKind,
  roundQuizIds, roundPicks, roundTracks, mimeCards, mimeDraw, MIME_RANDOM, MAX_PICKS, mimeEquipes, mimeEquipesBrutes, mimeAges, MIME_SOURCES, MIME_EQUIPES_MAX, mimePerTeam,
  chansonsBrutes, chansonsDe, chansonJouable, BLIND_NOMBRES, BLIND_NOMBRE_DEFAUT, MAX_CHANSONS_BLIND, seriesBlind,
  isStatuesList, statuesSongs, statuesChoices, roundSongs, chansonsStatues, STATUES_EXTRACTS, STATUES_EXTRACT, MAX_STATUES_SONGS, builtinConcepts, isPhotoTheme, disparuGroup,
  illustreQuestions, quizQuestions, jeuDeLaManche, hasFinale, alerteEquipes, EQUIPES_PAR_DEFAUT, pourLeHasard, premierQuiz,
  launchStates, launchLabelPc, couleursEquipes, teamCount, roundTirees, chiffresDuTirage, trousDuJeu,
  roundSeriesQuiz, questionsDeLaSerie, questionsDesSeries, questionJouable, FACTEURS_FINALE, SUPER_FINALE_LAST, questionBougies,
  questionsDuQuiz, ordreAvecCasesVides, cleQuestion, placeDesBougies, CLE_BOUGIES, estEnSeries, choiceImageList, estJeuDePhotos, signatureQuestion, zoomRoundQuestions,
  estJeuDeMots, seriesMots, cleDuMot, motsDuJeu, MAX_MOTS, pickedItems, roundHasard, disparuObjects, PATATE_BOMBES, bombesDe, bombesParPartie, DUEL_JOUEURS, DUEL_DUREES, reglagesDuel, SIMON_TOURS, SIMON_REPONSES, reglagesSimon, CHRONO_CIBLES, CHRONO_TOURS, reglagesChrono,
  DISPARU_CARTES, famillesPourLAge,
  pictoToursBruts, pictoPropositions, pictoPassages, PICTO_PROPOSITIONS, PICTO_PASSAGES, PICTO_PASSAGES_MAX, leurresDeChanson, parolesDuHook,
} from "./show.js";
import { TEAM_COLORS, TEAM_COLOR_NAMES } from "./theme.js";
import { motDeLaBanque, PHOTOS_BANQUE, banqueItems, BANQUE, cheminPhotoBanque, imageLibre, questionBanque } from "./banque-photos.js";
import { AFFIRMATIONS, tirerAffirmations } from "./banque-vrai-faux.js";
import { shuffle } from "./mime-cards.js";
import {
  MANCHE_TYPES, COLLECTION_UNIT, RANDOM_TYPES, RANDOM_COUNT, MIME_PER_TEAM, MIME_PER_TEAM_DEFAULT, LEVELS, collectionItems, collectionGroups,
  filterItems, drawItems, randomRound, cleanRound, mancheGroups, mancheSummary, defaultMancheTitle, mimeCardsNeeded,
  itemConcepts, usedElsewhere, versSeriesQuiz, fusionnerQuiz, versSeriesBlind, fusionnerBlind, photosDeMesImages,
} from "./manches.js";
import { concepts, neufsSiPossible, questionConcepts } from "./jamais-deux-fois.js";
import { PICTO_OWN_SERIES } from "./picto-cards.js";
import { EXTRACT_SECONDS, guessTrack, decodeFile, cutExtract, makeExtract, encodeMp3, soundId } from "./audio.js";
import { REFRAIN_SEC, REFRAIN_KBPS, buzzOf, defaultRefrain, songList, songsRetirees, songMatches, trackFromSong, songUpdates, marquerEffacees } from "./sons.js";
import { lireLrc, refrainsDesParoles, debutDesParoles, parolesDuRefrain, associerParoles, nomSimple, ligneAuMoment, MAX_LRC, propositionsDeTitre, cle, LEURRE_MAX } from "./paroles.js";
import { volumes, explosionDuVolume, refrainAuVolume } from "./volume.js";
import { etiquettesMp3 } from "./id3.js";
import { garderFichier, fichierGarde, oublierFichier } from "./sons-locaux.js";
import { MIME_CATALOG, MIME_THEMES } from "./mime-cards.js";
import { watchVersion, showUpdateBanner } from "./version.js";
import { compressImage, imageId, cleanEmoji, CHOICE_IMAGE } from "./illustration.js";
import { empreinteImage, groupesDeDoublons, memeImage, repointer } from "./doublons.js";
import { panneauPhotosManquantes, motsSansPhoto } from "./photos-manquantes.js";
import { niveauMime, niveauxPourProfil, etiquetteMime } from "./banque-mimes.js";
import { afficherMotsDePasse } from "./oeil.js";
import { historique, noterEcran, barresRetour, quitterEcran, ecranModifie } from "./retour.js";
import { confirmer, avertir, demanderTexte, apercu } from "./fenetre.js";
import { lireZipEtSesZip } from "./zip.js";
import { catalogueDesPacks, packsQuiRepondent, piocherDansLesPacks, versQuestionDePack, niveauDesPacks, sourceDuDe, avecSesImages } from "./pioche-packs.js";
import { analyserPack, chercheurImages, estImage, ouQuestion, IMAGE_MANQUANTE, EPREUVES, alerteImage, dossierDe, garderLesQuestionsIllustrees } from "./pack-zip.js";
import { ouvrirCadrage } from "./cadrage.js";
import { FAMILLES_PETITS, BANQUE_MOTS, motBanque, cleMot, cataloguePetits, tirerPetits } from "./banque-petits.js";
import { parPertinence, contientTout } from "./recherche.js";
import {
  GROUPES_IMAGES, A_RANGER, POCHETTES, PACKS, catDePack, themeDeFiche, estFicheDePack, imagesDuTheme, imagesOrphelines, imagesCitees, sansImages, imagesDesPacks, mesImagesDePacks, emojisBibliotheque, photosLibres, imagesUtilisees, mesImages, pochettesUtilisees, mesPochettes, nomPochette,
  correspond, categoriesDe, categoriesPerso, ficheImage, motsCles,
} from "./mediatheque.js";
import { DOSSIERS, classerPartie, bilan, effacements, passageAFaire, moDe, texteMo, texteGardees } from "./nettoyage.js";
import { NIVEAUX, AGES_NIVEAU, lireFamille, lireNiveau, niveauDuQuiz, cleTheme, themeDe, themeExistant, themeProche, parTheme } from "./rangement.js";
import { GROUPES_QUESTIONS, questionsClassiquesPretes, questionsIllustreesPretes, questionsVraiFauxPretes, mesQuestions, mesPacks, mesSeriesDePhotos, questionsDeTest, questionCorrespond, illustration, retirerQuestions, estQuizDeTest } from "./questions.js";
import { NIVEAUX_CHIFFRES, libelleNiveau, niveauPourAge, tirerChiffres } from "./banque-chiffres.js";
import { QUESTIONS_TOUT_PRETES, THEMES_TOUT_PRETS, estJusteChiffre } from "./banque-classiques.js";

// Petit œil sur les champs de mot de passe : voir ce qu'on tape (majuscules, caractère en trop).
afficherMotsDePasse();

// Nouvelle version publiée pendant que l'administration est ouverte : on propose de recharger, sans rien perdre d'office.
watchVersion(() => showUpdateBanner("Une nouvelle version de l'administration est en ligne. Enregistrez votre travail, puis mettez à jour."));
// Régie PC d'essai (adresse « …--essai-… », séances en direct avec cedric) : un bandeau le rappelle en permanence.
if (/--essai\b/.test(location.hostname)) document.body.classList.add("essai");

// Administration : un mot de passe commun, sans compte ni adresse e-mail. Toute personne qui le connaît
// a tous les droits. Le serveur (règles Firebase) vérifie l'empreinte envoyée par cet appareil ;
// l'appareil reste reconnu après un rechargement, jusqu'au prochain changement du mot de passe.

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// Tests automatiques uniquement : émulateur Firebase, depuis l'ordinateur de test.
const emulator = params.has("emu") && ["localhost", "127.0.0.1"].includes(location.hostname);

// Tant que la page n'est pas prête, « Entrer » reste grisé et aucun formulaire ne recharge la page
// (un envoi classique du formulaire repartirait sur une adresse sans ses paramètres).
document.querySelectorAll("form").forEach((f) => f.addEventListener("submit", (e) => e.preventDefault()));
const config = await (await fetch("firebase-config.json", { cache: "no-store" })).json();
const app = initializeApp(config);
const auth = getAuth(app);
const db = getDatabase(app);
if (emulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectDatabaseEmulator(db, "127.0.0.1", 9000);
}
/**
 * Mode « carte » (cedric, 30/10) : la régie téléphone ouvre ici, dans sa page « ＋ Jeu », la carte de réglage d'UN jeu,
 * la même que dans une prestation. Rien n'est écrit dans la bibliothèque : le jeu réglé repart au téléphone.
 */
const MODE_CARTE = ROUND_TYPES[new URLSearchParams(location.search).get("carte")] ? new URLSearchParams(location.search).get("carte") : null;
// Connexion anonyme : l'identifiant est gardé par le navigateur, comme pour les pupitres.
const uid = await signIn();

/**
 * Réseau instable au moment d'ouvrir la page : on recharge la page deux fois au plus (nouvel essai
 * complet), puis on le dit au lieu de laisser une page muette.
 */
async function signIn() {
  const tries = () => { try { return Number(sessionStorage.getItem("admin-signin-tries") ?? 0); } catch { return 2; } };
  try {
    const id = (await signInAnonymously(auth)).user.uid;
    try { sessionStorage.removeItem("admin-signin-tries"); } catch { /* facultatif */ }
    return id;
  } catch (e) {
    console.error(e);
    if (tries() < 2) {
      try { sessionStorage.setItem("admin-signin-tries", `${tries() + 1}`); } catch { /* facultatif */ }
      setTimeout(() => location.reload(), 1500);
    } else {
      document.getElementById("login-status").textContent = "Connexion impossible. Vérifiez Internet puis rechargez la page.";
    }
    return new Promise(() => {}); // la page s'arrête ici en attendant le rechargement
  }
}
const ctx = { db, uid };

let quizzes = {};
let shows = {};
let mimes = {};
let playlists = {};
/** Bibliothèque des sons du blind test (library/songs) : chansons et leurs préréglages. */
let songs = {};
let contents = {};
/** Manches enregistrées (page Manches de chaque jeu), par identifiant. */
let manches = {};
/** Fiches des images de la bibliothèque (nom, catégorie, mots-clés, retirée), par identifiant d'image. */
let medias = {};
/** Où en est chaque prestation lancée (launches/ et ce que publie sa partie), par identifiant de prestation. */
let runs = {};
let launches = {};
let runsTimer = null;
let stops = [];
let current = "home";

/** Petit constructeur d'éléments : h("button", { class: "btn", onclick }, "Texte"). */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "value") el.value = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((x) => x != null && x !== false));
  return el;
}

/** Remplace le contenu de [el] ; les morceaux absents (null, false) sont sautés (sinon le navigateur écrit « null »). */
const remplir = (el, ...kids) => el.replaceChildren(...kids.filter((x) => x != null && x !== false));

function status(id, text, ok = false) {
  $(id).textContent = text;
  $(id).classList.toggle("ok", ok);
}

/**
 * Message bien visible quelle que soit la place dans la page, en plus de celui écrit sous le bouton (cedric, 23/10 :
 * avec « Enregistrer » en haut de la fiche, le message du bas ne se voyait pas, on croyait que rien ne s'était passé).
 * Il s'en va tout seul et ne gêne aucun clic.
 */
function annonce(text, ok = false) {
  let el = $("annonce");
  if (!el) {
    el = h("div", { id: "annonce", class: "annonce", role: "status", "aria-live": "polite" });
    document.body.append(el);
  }
  el.textContent = ok ? `✓ ${text}` : text;
  el.classList.toggle("ok", ok);
  el.hidden = false;
  clearTimeout(annonce.minuteur);
  annonce.minuteur = setTimeout(() => { el.hidden = true; }, ok ? 4000 : 9000);
}

const SCREENS = ["login", "home", "shows", "show-edit", "library", "game", "manche-edit", "builtin", "quizzes", "import", "review", "settings", "mimes", "mime-edit", "music", "playlist-edit", "banque"];
/** Écran affiché en ce moment. */
const ecranAffiche = () => SCREENS.find((s) => !$(`screen-${s}`).hidden);

/**
 * Ouvre un écran. Quitter un écran d'édition aux modifications pas enregistrées demande d'abord (cedric, 21/10), dans
 * une fenêtre : renvoie faux tout de suite, et l'écran s'ouvre ensuite si on choisit de quitter. [force] : sans
 * demander (retour à la connexion).
 */
function show(name, { force = false } = {}) {
  const avant = ecranAffiche();
  const defilement = window.scrollY;
  if (avant !== name && !force && !depuisHistorique && ecranModifie()) {
    // Toujours sur l'écran quitté au moment de répondre (pas renvoyé à la connexion entre-temps) : on y va.
    quitterEcran().then((quitter) => { if (quitter && ecranAffiche() === avant) show(name, { force: true }); });
    return false;
  }
  // Les jeux s'ouvrent depuis leur tuile de l'accueil (cedric) : leurs pages gardent l'onglet Accueil allumé ; les
  // réglages des chansons, l'onglet Bibliothèque.
  if (["home", "library", "settings"].includes(name)) current = name;
  if (["shows", "show-edit", "game", "manche-edit", "quizzes", "mimes", "music", "builtin", "import", "review", "mime-edit", "playlist-edit", "banque"].includes(name)) current = "home";
  if (name === "playlist-edit" && playlist?.use === "songs") current = "library";
  // L'accueil remet à zéro le jeu ouvert (plus d'onglets Manches / Collections).
  if (name === "home") gameType = null;
  SCREENS.forEach((s) => { $(`screen-${s}`).hidden = s !== name; });
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.screen === current));
  window.scrollTo(0, 0);
  if (name === "home") renderHome();
  if (name === "library") renderLibrary();
  if (name === "game") renderGame();
  if (name === "shows") renderShows();
  if (name === "quizzes") renderQuizzes();
  if (name === "mimes") renderMimes();
  if (name === "music") renderPlaylists();
  // Retour des réglages d'une chanson du blind test : ses nouveaux réglages (refrain, pochette, paroles) s'affichent.
  if (name === "show-edit" && reglageDepuisPrestation) { reglageDepuisPrestation = false; refreshRounds(); }
  if (["quizzes", "mimes", "music", "builtin"].includes(name)) paintCollectionTabs(name);
  if (name !== "playlist-edit") stopPreview();
  if (name === "settings") { showLastChange(); afficherJournal(); }
  noterPage(name, avant, defilement);
  return true;
}

// ---------- Page précédente ----------

/*
 * Flèche « retour » du navigateur et bouton « ← Retour » des pages d'édition : la page précédente de la Régie PC, au
 * lieu de quitter le site (cedric, 21/10). Chaque écran ouvert est noté dans l'historique du navigateur, avec de quoi
 * le rouvrir tel qu'on l'a laissé : la liste, le jeu, l'onglet, et ce qui était en cours d'édition.
 */
const pages = [];
let pageActuelle = -1;
/**
 * Chanson dont on vient d'ouvrir les réglages depuis la liste des sons, et sa hauteur dans l'écran : au retour
 * (« Enregistrer », « ← Retour »), la liste revient sur elle (cedric, 23/10), même si son nouveau titre l'a déplacée.
 */
let ancreChanson = null; // { cle, haut }
// La Régie PC remet elle-même chaque page à sa place : le navigateur ne la remonte pas après coup.
history.scrollRestoration = "manual";
/** Retour ou avance du navigateur en cours : l'écran rouvert ne fait pas une nouvelle page. */
let depuisHistorique = false;
let ignorerRetour = false;
/** Pages notées depuis l'ouverture de la Régie PC : celles d'avant un rechargement ne sont plus connues. */
const OUVERTURE = Math.random().toString(36).slice(2);

/** Ce qui est en cours d'édition dans chaque écran d'édition, et comment le rouvrir. */
const EDITEURS = {
  "show-edit": { id: () => editing?.id, rouvrir: (id) => shows[id] && editShow(id), parent: "shows" },
  review: { id: () => draft?.id, rouvrir: (id) => quizzes[id] && review(id, quizzes[id]), parent: "quizzes" },
  "manche-edit": { id: () => mancheEdit?.id, rouvrir: (id) => manches[id] && editManche(id), parent: "game" },
  "mime-edit": { id: () => deck?.id, rouvrir: (id) => mimes[id] && editDeck(id), parent: "mimes" },
  "playlist-edit": { id: () => playlist?.id, rouvrir: (id) => playlists[id] && editPlaylist(id), parent: "music" },
};
const contexte = (ecran) => ({ showsEtat, gameType, quizFilter, builtinType, libTab, mediaGroupe, mediaCat, qGroupe, qPack, ouvert: EDITEURS[ecran]?.id() ?? null });
/** Rubrique de la Bibliothèque : son onglet, et le groupe d'images ou de questions (ou le pack) ouvert. */
const rubrique = (ctx) => [ctx.libTab, ctx.libTab === "images" ? ctx.mediaGroupe : null, ctx.libTab === "questions" ? ctx.qGroupe : null, ctx.libTab === "questions" ? ctx.qPack : null].join("|");

function noterPage(name, avant, defilement = 0) {
  const ancre = ancreChanson;
  ancreChanson = null;
  if (name === "login") { pages.length = 0; pageActuelle = -1; return; }
  if (depuisHistorique) return;
  const page = { ecran: name, ctx: contexte(name) };
  // Même écran (autre liste, autre onglet) : la page est mise à jour, pas ajoutée.
  if (pageActuelle >= 0 && pages[pageActuelle].ecran === name) {
    pages[pageActuelle] = page;
    return;
  }
  // La page quittée garde ce qu'on y a fait depuis (onglet de la bibliothèque, enregistrement d'une nouvelle).
  if (pageActuelle >= 0 && pages[pageActuelle].ecran === avant) {
    const quittee = pages[pageActuelle];
    quittee.ctx = { ...quittee.ctx, libTab, mediaGroupe, mediaCat, qGroupe, qPack, ouvert: EDITEURS[avant]?.id() ?? quittee.ctx.ouvert };
    // Elle sera rouverte là où on l'a laissée (cedric, 23/10).
    quittee.defilement = defilement;
    quittee.ancre = ancre;
  }
  pages.length = pageActuelle + 1;
  pages.push(page);
  pageActuelle = pages.length - 1;
  if (pageActuelle === 0) history.replaceState({ page: 0, ouverture: OUVERTURE }, "");
  else history.pushState({ page: pageActuelle, ouverture: OUVERTURE }, "");
}

/**
 * Bibliothèque (cedric, 23/10) : chaque onglet (Images, Sons, Questions) et chaque rubrique ouverte (Émojis, Mes
 * questions en vrac, un pack…) compte comme une page : « ← Retour » et la flèche du navigateur reviennent à la
 * rubrique d'avant, puis à la page d'avant la Bibliothèque. À appeler une fois la rubrique ouverte, avec la hauteur
 * où l'on était dans la rubrique quittée.
 */
function noterRubrique(defilement) {
  if (depuisHistorique || pageActuelle < 0 || pages[pageActuelle].ecran !== "library") return;
  const page = { ecran: "library", ctx: contexte("library") };
  if (rubrique(pages[pageActuelle].ctx) === rubrique(page.ctx)) {
    pages[pageActuelle] = page;
    return;
  }
  pages[pageActuelle].defilement = defilement;
  pages.length = pageActuelle + 1;
  pages.push(page);
  pageActuelle = pages.length - 1;
  history.pushState({ page: pageActuelle, ouverture: OUVERTURE }, "");
}

/** Rouvre une page de l'historique telle qu'on l'a laissée. */
function rouvrirPage({ ecran, ctx, defilement = 0, ancre = null }) {
  depuisHistorique = true;
  try {
    // Une autre rubrique de questions rouverte : ses filtres repartent à zéro, comme quand on l'ouvre.
    if (ctx.qGroupe !== qGroupe || ctx.qPack !== qPack) { qCategorie = qType = qNiveau = null; qSelection.clear(); }
    ({ showsEtat, gameType, quizFilter, builtinType, libTab, mediaGroupe, mediaCat, qGroupe, qPack } = ctx);
    const editeur = EDITEURS[ecran];
    if (editeur && ctx.ouvert && editeur.id() !== ctx.ouvert) {
      // Ce qui était en cours d'édition a été remplacé : on le rouvre tel qu'enregistré (ou sa liste, s'il n'existe plus).
      if (!editeur.rouvrir(ctx.ouvert)) show(editeur.parent);
      return;
    }
    if (ecran === "builtin" && builtinType) openBuiltin(builtinType);
    else show(ecran);
    revenirOuOnEtait(defilement, ancre);
  } finally {
    depuisHistorique = false;
  }
}

/**
 * Page rouverte par « Enregistrer », « ← Retour » ou la flèche du navigateur (cedric, 23/10) : elle revient là où on
 * l'avait laissée, pas en haut de la liste. La chanson qu'on vient de régler reste à la même hauteur de l'écran, et
 * s'éclaire un instant.
 */
function revenirOuOnEtait(defilement, ancre) {
  window.scrollTo(0, defilement);
  const ligne = ancre && [...document.querySelectorAll("#song-list .song-ligne")].find((x) => x.dataset.cle === ancre.cle);
  if (!ligne || ligne.offsetParent === null) return;
  window.scrollBy(0, ligne.getBoundingClientRect().top - ancre.haut);
  ligne.classList.add("song-retour");
}

window.addEventListener("popstate", async (e) => {
  if (ignorerRetour) { ignorerRetour = false; return; }
  if ($("nav").hidden) return;
  const i = e.state?.page;
  const connue = e.state?.ouverture === OUVERTURE && typeof i === "number" && pages[i];
  // Modifications pas enregistrées et on reste : le navigateur revient sur la page affichée.
  if (ecranModifie() && !(await quitterEcran())) {
    if (connue) { ignorerRetour = true; history.go(pageActuelle - i); } else history.pushState({ page: pageActuelle, ouverture: OUVERTURE }, "");
    return;
  }
  if (!connue) {
    // Page d'avant un rechargement : on revient à l'Accueil (la flèche suivante quitte le site).
    depuisHistorique = true;
    try { show("home"); } finally { depuisHistorique = false; }
    return;
  }
  // La page quittée par la flèche sera rouverte là où on l'a laissée (flèche « suivante »).
  if (pages[pageActuelle]) pages[pageActuelle].defilement = window.scrollY;
  pageActuelle = i;
  rouvrirPage(pages[i]);
});

/** « ← Retour » : la page précédente, comme la flèche du navigateur (sinon la page au-dessus, puis l'Accueil). */
function pagePrecedente() {
  if (pageActuelle > 0) return history.back();
  const ecran = ecranAffiche();
  show(EDITEURS[ecran]?.parent ?? "home");
}
document.querySelectorAll("[data-screen]").forEach((b) => { b.onclick = () => show(b.dataset.screen); });
// Le logo ramène à l'Accueil, comme le bouton « Accueil » du menu (rien avant la connexion).
$("brand").onclick = () => { if (!$("nav").hidden) show("home"); };

// ---------- Connexion ----------

let setupMode = false;
/** Changement du mot de passe administrateur en cours depuis cet appareil : pas de retour à la connexion. */
let rekeying = false;

async function route() {
  if (await isAdmin(ctx)) return enter();
  setupMode = !(await get(ref(db, "settings/admin/salt"))).val();
  $("login-title").textContent = setupMode ? "Première configuration" : "Connexion";
  $("login-hint").textContent = setupMode
    ? "Aucun mot de passe administrateur n'existe encore : choisissez-le maintenant (8 caractères au moins)."
    : "Saisissez le mot de passe administrateur.";
  $("admin-confirm").hidden = !setupMode;
  $("login").textContent = setupMode ? "Enregistrer et entrer" : "Entrer";
  $("nav").hidden = true;
  $("logout").hidden = true;
  $("login").disabled = false;
  show("login", { force: true });
  $("admin-password").focus();
}

/** Écrit l'empreinte du mot de passe et vérifie auprès du serveur qu'elle ouvre l'administration. */
async function prove(password) {
  for (const candidate of passwordCandidates(password)) {
    const r = await writeProof(ctx, "admin", candidate);
    if (r === "busy") return "Trop d'essais en même temps. Réessayez dans quelques secondes.";
    if (r === "unset") return "Aucun mot de passe administrateur enregistré.";
    if (await isAdmin(ctx)) return null;
  }
  return "Mot de passe incorrect.";
}

async function savePassword(kind, password) {
  const salt = newSalt();
  await set(ref(db, `settings/${kind}`), { salt, hash: await passwordHash(salt, cleanPassword(password)), updatedAt: serverTimestamp() });
}

$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  const pw = $("admin-password").value;
  status("login-status", "");
  if (setupMode) {
    if (cleanPassword(pw).length < MIN_PASSWORD_LENGTH) return status("login-status", `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`);
    if (cleanPassword(pw) !== cleanPassword($("admin-password2").value)) return status("login-status", "Les deux mots de passe ne sont pas identiques.");
  }
  $("login").disabled = true;
  try {
    if (setupMode) await savePassword("admin", pw);
    const error = await prove(pw);
    if (error) return status("login-status", error);
    $("admin-password").value = "";
    $("admin-password2").value = "";
    enter();
  } catch (err) {
    console.error(err);
    status("login-status", setupMode ? "Un mot de passe vient d'être choisi ailleurs : saisissez-le." : "Connexion impossible. Vérifiez Internet puis réessayez.");
    if (setupMode) route();
  } finally {
    $("login").disabled = false;
  }
};

$("logout").onclick = async () => {
  stops.forEach((s) => s());
  stops = [];
  await set(ref(db, `adminProof/${uid}`), null).catch(() => {});
  route();
};

function enter() {
  stops.forEach((s) => s());
  stops = [];
  $("nav").hidden = false;
  $("logout").hidden = false;
  // Mot de passe changé depuis un autre appareil : retour à l'écran de connexion.
  const lost = (e) => { console.error(e); stops.forEach((s) => s()); stops = []; if (!rekeying) route(); };
  stops.push(onValue(ref(db, "library/quizzes"), (s) => { quizzes = s.val() ?? {}; refreshLists(); }, lost));
  stops.push(onValue(ref(db, "library/shows"), (s) => { shows = s.val() ?? {}; refreshLists(); }, lost));
  stops.push(onValue(ref(db, "library/mimes"), (s) => { mimes = s.val() ?? {}; refreshLists(); }, lost));
  stops.push(onValue(ref(db, "library/playlists"), (s) => { playlists = s.val() ?? {}; refreshLists(); }, lost));
  stops.push(onValue(ref(db, "library/contents"), (s) => { contents = s.val() ?? {}; refreshLists(); }, lost));
  // Bibliothèque des sons : une lecture refusée (règles pas encore publiées) ne ferme pas l'administration.
  stops.push(onValue(ref(db, "library/songs"), (s) => { songs = s.val() ?? {}; refreshLists(); }, (e) => console.error(e)));
  // Manches : une lecture refusée (règles pas encore publiées) ne ferme pas l'administration.
  stops.push(onValue(ref(db, "library/manches"), (s) => { manches = s.val() ?? {}; refreshLists(); }, (e) => console.error(e)));
  // Fiches des images de la bibliothèque : même tolérance (règles pas encore publiées).
  stops.push(onValue(ref(db, "library/medias"), (s) => { medias = s.val() ?? {}; refreshLists(); }, (e) => console.error(e)));
  // Box : une lecture refusée ne doit pas fermer l'administration (règles pas encore publiées).
  stops.push(onValue(ref(db, "boxes/requests"), (s) => { boxRequests = s.val() ?? {}; renderBoxes(); }, (e) => console.error(e)));
  stops.push(onValue(ref(db, "boxes/allowed"), (s) => { boxAllowed = s.val() ?? {}; renderBoxes(); }, (e) => console.error(e)));
  // Cadrages gardés : même tolérance (règles pas encore publiées) ; une prestation ouverte les reprend.
  stops.push(onValue(ref(db, "library/cadrages"), (s) => { cadrages = s.val() ?? {}; if (editing && appliquerCadrages(editing.rounds)) refreshRounds(); }, (e) => console.error(e)));
  // Prestations lancées sur une box (en cours, interrompue, terminée) : une lecture refusée (règles pas encore
  // publiées) ne ferme pas l'administration. Relu chaque minute : une box peut se couper sans que rien d'autre change.
  stops.push(onValue(ref(db, "launches"), (s) => { launches = s.val() ?? {}; refreshRuns(); }, (e) => console.error(e)));
  clearInterval(runsTimer);
  runsTimer = setInterval(refreshRuns, 60_000);
  stops.push(() => clearInterval(runsTimer));
  show(current);
  // Copies des fêtes terminées : effacées en arrière-plan, sans retarder l'ouverture (une fois par heure au plus).
  setTimeout(passageAutomatique, 1500);
}

/** Relit l'état des prestations lancées : quelques petites lectures par partie concernée, jamais toute la partie. */
async function refreshRuns() {
  if (!Object.keys(launches).length && !Object.keys(runs).length) return;
  const lire = (path) => get(ref(db, path)).then((x) => x.val(), () => null);
  const next = await launchStates(launches, lire).catch((e) => { console.error(e); return runs; });
  if (JSON.stringify(next) === JSON.stringify(runs)) return;
  runs = next;
  refreshLists();
}

if (MODE_CARTE) entrerCarte();
else route();

function refreshLists() {
  if (!$("screen-home").hidden) renderHome();
  if (!$("screen-library").hidden) renderLibrary();
  if (!$("screen-builtin").hidden) renderBuiltin();
  if (!$("screen-banque").hidden) renderBanqueMots();
  if (!$("screen-shows").hidden) renderShows();
  if (!$("screen-quizzes").hidden) renderQuizzes();
  if (!$("screen-mimes").hidden) renderMimes();
  if (!$("screen-music").hidden) renderPlaylists();
  if (!$("screen-playlist-edit").hidden && !$("playlist-lib").hidden) renderLibPicker();
  if (!$("screen-show-edit").hidden) refreshRounds();
  if (!$("screen-game").hidden) renderGame();
  if (!$("screen-settings").hidden && document.activeElement !== $("test-theme-choix")) remplirThemesTest();
}

const byDate = ([, a], [, b]) => (a.date ?? "9999").localeCompare(b.date ?? "9999");
const dateLabel = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "sans date");
const STATUS_LABELS = { brouillon: ETATS.acompleter, publiee: ETATS.avenir, archivee: ETATS.archivee };

// ---------- Tableau de bord ----------

const shortDate = (d) => {
  const day = new Date(`${d}T12:00:00`);
  return { day: day.getDate(), month: day.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "") };
};
const whenLabel = (d) => {
  const n = daysUntil(d);
  return n === 0 ? "aujourd'hui" : n === 1 ? "demain" : n > 1 ? `dans ${n} jours` : "passée";
};

/** Les prestations d'un état (« avenir », « acompleter », « archivee »), dans leur ordre de liste. */
function prestationsEtat(etat, today = isoDay()) {
  const list = Object.entries(shows).filter(([, s]) => s && etatPrestation(s, today) === etat).sort(byDate);
  // Archivées : les plus récentes d'abord.
  return etat === "archivee" ? list.reverse() : list;
}

const COMPTEURS = { avenir: ["Anniversaire à venir", "Anniversaires à venir"], acompleter: ["À compléter", "À compléter"], archivee: ["Archivée", "Archivées"] };

function renderHome() {
  for (const [etat, [un, plusieurs]] of Object.entries(COMPTEURS)) {
    const n = prestationsEtat(etat).length;
    $(`stat-${etat}`).textContent = n;
    $(`stat-${etat}`).nextElementSibling.textContent = n > 1 ? plusieurs : un;
  }
  // Prochains anniversaires : les prestations « À venir » (prêtes, sur la régie), les plus proches d'abord.
  const coming = prestationsEtat("avenir");
  const box = $("home-upcoming");
  box.replaceChildren(...coming.slice(0, 6).map(([id, s]) => showCard(id, s, { accueil: true })));
  if (coming.length > 6) box.append(h("button", { type: "button", class: "btn secondary", text: `Voir les ${coming.length} anniversaires à venir`, onclick: () => openShows("avenir") }));
  if (!coming.length) {
    box.append(h("div", { class: "empty" },
      h("p", { text: "Aucun anniversaire à venir pour l'instant." }),
      h("button", { class: "btn", onclick: () => editShow(null), text: "Créer une prestation" })));
  }
  renderHomeGames();
}

/** Accueil : chaque jeu en tuile, par famille ; la tuile mène à son contenu (ou à sa fiche s'il n'y a rien à préparer). */
function renderHomeGames() {
  $("home-games").replaceChildren(...GAME_GROUPS.map((group) => h("div", { class: "home-group" },
    h("h3", { text: group.title }),
    h("div", { class: "tiles" }, ...group.games.map((g) => {
      const { line } = gameInfo(g);
      // Une tuile ouvre la page du jeu : ses manches, et ses collections dans l'onglet voisin.
      const open = () => openGame(g.type);
      return h("button", { class: "tile", "data-game": g.type, ...(GAME_SCREENS[g.type] ? { "data-screen": GAME_SCREENS[g.type] } : {}), onclick: open },
        h("span", { class: "tile-icon", text: g.icon }), h("b", { text: ROUND_TYPES[g.type] }), h("span", { text: line }));
    })))));
}

/** Page de contenu des tuiles principales (repère pour les tests et l'aide). */
const GAME_SCREENS = { quiz: "quizzes", mimes: "mimes", blind: "music" };

/** « 18 questions · 1 manche de mimes » : ce que contient une prestation. */
function contentLabel(snapshot) {
  const items = snapshot.quiz.questions;
  const q = items.filter((x) => x.kind !== "mime" && x.kind !== "pictionary").length;
  const m = items.filter((x) => x.kind === "mime").length;
  const p = items.filter((x) => x.kind === "pictionary").length;
  return [q ? `${q} question${q > 1 ? "s" : ""}` : "", m ? `${m} manche${m > 1 ? "s" : ""} de mimes` : "", p ? `${p} Pictionary` : ""].filter(Boolean).join(" · ");
}
$("home-new").onclick = () => editShow(null);
document.querySelectorAll("#screen-home [data-etat]").forEach((b) => { b.onclick = () => openShows(b.dataset.etat); });

// ---------- Copies ----------

/**
 * « Dupliquer » fait seulement la copie (cedric, 21/10) : rien ne s'ouvre. La copie apparaît en tête de sa liste, mise
 * en avant un moment, libre d'être ouverte, renommée, éditée ou rangée.
 */
let copie = null; // { id, jusqua }
const COPIE_MS = 8000;
const titreCopie = (titre) => `Copie de ${titre}`.slice(0, 120);
const copieRecente = (id) => (copie?.id === id && Date.now() < copie.jusqua ? " copie-recente" : "");
/** La copie récente d'abord ; les autres dans leur ordre. */
const copieEnTete = (list) => [...list.filter(([id]) => copieRecente(id)), ...list.filter(([id]) => !copieRecente(id))];

function signalerCopie(id) {
  copie = { id, jusqua: Date.now() + COPIE_MS };
  requestAnimationFrame(() => document.querySelector(".screen:not([hidden]) .copie-recente")?.scrollIntoView({ block: "center", behavior: "smooth" }));
}

/** Copie d'un élément de la bibliothèque (quiz, collection de cartes, playlist) : l'original ne change pas. */
async function copierDansBibliotheque(dossier, original) {
  const { createdAt, updatedAt, ...rest } = original;
  const id = push(ref(db, `library/${dossier}`)).key;
  try {
    await set(ref(db, `library/${dossier}/${id}`), { ...rest, title: titreCopie(original.title), createdAt: Date.now(), updatedAt: serverTimestamp() });
  } catch (err) {
    console.error(err);
    await avertir("Copie refusée : vérifiez Internet ou reconnectez-vous.");
    return null;
  }
  signalerCopie(id);
  refreshLists();
  return id;
}

// ---------- Prestations ----------

/**
 * Carte d'une prestation : date, prénom, âge, état et actions. [accueil] : la carte des prochains anniversaires,
 * avec seulement Ouvrir, Renommer et Archiver (« Dupliquer » se fait depuis les listes).
 */
function showCard(id, s, { accueil = false } = {}) {
  const r = readiness(s, quizzes, mimes, playlists, contents, undefined, songs);
  const etat = etatPrestation(s);
  const { snapshot } = buildSnapshot(id, s, quizzes, mimes, Math.random, playlists, contents, {}, songs);
  const date = s.date ? shortDate(s.date) : null;
  // Un clic sur la carte (hors de ses boutons) l'ouvre, comme « Ouvrir ».
  return h("article", { class: `card show-card ${r.level}${copieRecente(id)}`, "data-show": id, onclick: (e) => { if (!e.target.closest("button")) editShow(id); } },
    h("div", { class: "date-chip" }, date ? [h("b", { text: `${date.day}` }), h("span", { text: date.month })] : h("span", { text: "sans date" })),
    h("div", { class: "card-body" },
      h("b", { class: "card-title", text: showTitle(s) }),
      h("span", { class: "meta", text: [s.childName, s.age ? `${s.age} ans` : "", s.date ? `${dateLabel(s.date)} (${whenLabel(s.date)})` : ""].filter(Boolean).join(" · ") }),
      snapshot ? h("span", { class: "meta", text: `${contentLabel(snapshot)} · environ ${dureeEstimee(snapshot, s).minutes} min` }) : null,
      s.pinned ? h("span", { class: "pill pin", text: "⭐ Épinglée : ses jeux en premier dans la régie" }) : null,
      // Fête lancée sur une box : en cours, interrompue (reprise possible), terminée. Archiver n'y change rien.
      launchLabelPc(runs[id]) ? h("span", { class: `pill run ${runs[id].etat}`, "data-run": runs[id].etat, text: launchLabelPc(runs[id]) }) : null,
      etat === "archivee"
        ? h("span", { class: "pill", text: "Archivée : plus sur la régie" })
        : etat === "avenir" && r.level === "prete"
          ? h("span", { class: "pill ok", text: "✓ À venir : visible sur la régie" })
          : h("div", { class: "todo" }, h("span", { class: "pill warn", text: etat === "avenir" ? "⚠ Sur la régie, mais il manque :" : "À compléter" }), h("ul", {}, ...r.todo.map((t) => h("li", { text: t })))),
      h("div", { class: "card-actions" },
        h("button", { class: "btn small", onclick: () => editShow(id), text: "Ouvrir" }),
        accueil ? null : h("button", { class: "btn small secondary", onclick: () => duplicatePrestation(s), text: "Dupliquer" }),
        h("button", { class: "btn small secondary", onclick: () => rename(`library/shows/${id}`, showTitle(s), "de la prestation"), text: "Renommer" }),
        isArchived(s) && !accueil ? h("button", { class: "btn small secondary", onclick: () => pin(id, !s.pinned), text: s.pinned ? "☆ Désépingler" : "⭐ Épingler" }) : null,
        // Pas de « Désarchiver » (cedric, 21/10) : une fête archivée se réutilise avec « Dupliquer ».
        isArchived(s) ? null : h("button", { class: "btn small secondary", onclick: () => archiver(id, s), text: "Archiver" }),
        // « Supprimer » seulement sur un brouillon ou une archivée (cedric, 21/10) : une fête annoncée ne s'efface
        // jamais, elle s'archive d'abord.
        (etat === "acompleter" || etat === "archivee") && !accueil
          ? h("button", { class: "btn small danger", onclick: () => supprimerPrestation(id, s), text: "Supprimer" }) : null)));
}

/** Supprime une prestation après confirmation ; renvoie vrai si elle est supprimée. */
async function supprimerPrestation(id, s) {
  if (!(await confirmer(`Supprimer « ${showTitle(s)} » ? Elle sera effacée pour de bon. Les parties déjà jouées ne changent pas.`, { ok: "Supprimer", danger: true }))) return false;
  try {
    await set(ref(db, `library/shows/${id}`), null);
  } catch (err) {
    console.error(err);
    await avertir("Suppression refusée : vérifiez Internet ou reconnectez-vous.");
    return false;
  }
  if (!$("screen-shows").hidden) status("shows-status", `« ${showTitle(s)} » est supprimée.`, true);
  return true;
}

/**
 * Dupliquer une prestation : une copie « À compléter » avec les mêmes manches, sans prénom, âge ni date, nommée
 * « Copie de … » jusqu'à ce qu'on la complète. L'originale ne change pas. La liste « À compléter » s'ouvre, la copie en tête.
 */
async function duplicatePrestation(s) {
  const id = push(ref(db, "library/shows")).key;
  const copiee = { ...duplicateShow(s), copieDe: showTitle(s).slice(0, 120), origin: "admin", createdAt: Date.now() };
  try {
    await set(ref(db, `library/shows/${id}`), { ...copiee, updatedAt: serverTimestamp() });
  } catch (err) {
    console.error(err);
    return avertir("Copie refusée : vérifiez Internet ou reconnectez-vous.");
  }
  signalerCopie(id);
  openShows("acompleter");
  status("shows-status", `« ${showTitle(copiee)} » est ajoutée ici. Ouvrez-la pour indiquer le prénom, l'âge et la date.`, true);
}

/** Liste ouverte : « avenir », « acompleter » ou « archivee ». */
let showsEtat = "avenir";
const LISTES = {
  avenir: { titre: "Anniversaires à venir", hint: "Prêtes : elles sont sur la régie du téléphone, une touche les charge sur la TV. Le lendemain de la fête, elles passent toutes seules dans les archivées.", vide: "Aucun anniversaire à venir : complétez une prestation puis passez son statut à « À venir »." },
  acompleter: { titre: "À compléter", hint: "Brouillons : pas encore sur la régie. Complétez-les, puis passez leur statut à « À venir ».", vide: "Rien à compléter." },
  archivee: { titre: "Archivées", hint: "Fêtes passées ou rangées à la main : elles ne sont plus sur la régie. « Dupliquer » en fait un nouvel anniversaire.", vide: "Aucune prestation archivée." },
};

/** Ouvre une liste ; [garderRecherche] : « Aussi trouvé dans » garde le texte cherché. */
function openShows(etat, garderRecherche = false) {
  if (etat !== showsEtat && !garderRecherche) $("show-search").value = "";
  status("shows-status", "");
  showsEtat = etat;
  show("shows");
}

function renderShows() {
  const today = isoDay();
  const etat = showsEtat;
  const liste = LISTES[etat];
  $("shows-crumb").textContent = liste.titre;
  $("shows-h1").textContent = liste.titre;
  $("shows-hint").textContent = liste.hint;
  const query = $("show-search").value.trim();
  // Recherche : chaque mot tapé (prénom, âge, date, jeu…) ; les titres qui commencent par le texte d'abord.
  const trouve = (e) => parPertinence(prestationsEtat(e, today).filter(([, s]) => showMatches(s, query, { quizzes, mimes, playlists })), query,
    ([, s]) => [showTitle(s), s.childName], ([, s]) => [s.themes, s.notes]);
  $("shows-tabs").replaceChildren(...Object.keys(LISTES).map((e) => h("button", {
    type: "button", class: `chip${e === etat ? " active" : ""}`, "data-etat": e, text: `${LISTES[e].titre} (${prestationsEtat(e, today).length})`,
    onclick: () => openShows(e),
  })));
  const list = copieEnTete(trouve(etat));
  // Archivées : les épinglées (leurs jeux sont proposés en premier dans la régie) en tête.
  const pinned = etat === "archivee" ? list.filter(([, s]) => s.pinned) : [];
  const autres = etat === "archivee" ? list.filter(([, s]) => !s.pinned) : list;
  $("show-pinned").hidden = !pinned.length;
  $("show-pinned-list").replaceChildren(...pinned.map(([id, s]) => showCard(id, s)));
  $("show-list").replaceChildren(...autres.map(([id, s]) => showCard(id, s)));
  if (!list.length) $("show-list").append(h("p", { class: "hint", text: query ? "Aucune prestation de cette liste ne correspond à cette recherche." : liste.vide }));
  // Rien ici ? Les autres listes qui ont des résultats, en un clic.
  const ailleurs = query ? Object.keys(LISTES).filter((e) => e !== etat).map((e) => [e, trouve(e).length]).filter(([, n]) => n) : [];
  $("show-ailleurs").replaceChildren(...(ailleurs.length ? [h("span", { text: "Aussi trouvé dans : " }), ...ailleurs.map(([e, n]) => h("button", {
    type: "button", class: "chip", "data-ailleurs": e, text: `${LISTES[e].titre} (${n})`, onclick: () => openShows(e, true),
  }))] : []));
  $("show-search-count").textContent = query ? `${list.length} prestation${list.length > 1 ? "s" : ""} trouvée${list.length > 1 ? "s" : ""}` : "";
}
$("show-search").addEventListener("input", () => renderShows());

/**
 * « Renommer » : nouveau titre d'une prestation, d'un quiz, d'un paquet de mimes ou d'une playlist, sans rien
 * changer d'autre. Les prestations qui s'en servent affichent tout de suite le nouveau nom.
 */
async function rename(path, current, what) {
  const asked = await demanderTexte(`Nouveau nom ${what} :`, current ?? "", { ok: "Renommer", maxlength: 120 });
  if (asked === null) return false;
  const title = asked.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!title || title === current) return false;
  try {
    await update(ref(db, path), { title, updatedAt: serverTimestamp() });
    return true;
  } catch (err) {
    console.error(err);
    await avertir("Renommage refusé : vérifiez Internet ou reconnectez-vous.");
    return false;
  }
}

// ---------- Box TV ----------

/** Demandes d'activation des box jamais vues, et box acceptées (Paramètres > Box TV). */
let boxRequests = {};
let boxAllowed = {};
/** Nom tapé pour une demande pas encore acceptée : garde la saisie si la liste se redessine. */
const boxNames = {};

const BOX_NAME_MAX = 40;
const boxName = (text) => text.trim().replace(/\s+/g, " ").slice(0, BOX_NAME_MAX);
const sinceLabel = (at) => {
  const min = Math.max(0, Math.round((Date.now() - (at ?? Date.now())) / 60000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const hours = Math.round(min / 60);
  return hours < 48 ? `il y a ${hours} h` : `le ${new Date(at).toLocaleDateString("fr-FR")}`;
};

function renderBoxes() {
  const pending = Object.entries(boxRequests).sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0));
  const allowed = Object.entries(boxAllowed).sort(([, a], [, b]) => (a.at ?? 0) - (b.at ?? 0));
  const n = pending.length;
  $("nav-boxes").hidden = n === 0;
  $("nav-boxes").textContent = n;
  $("home-boxes").hidden = n === 0;
  $("home-boxes").textContent = n === 1
    ? `📺 Une box attend son activation (code ${pending[0][1].code}) : l'accepter dans Paramètres`
    : `📺 ${n} box attendent leur activation : les voir dans Paramètres`;

  $("box-requests").replaceChildren(...(n ? pending.map(([id, r]) => {
    const name = h("input", {
      type: "text", maxlength: BOX_NAME_MAX, "aria-label": "Nom de la box",
      value: boxNames[id] ?? boxName(r.model || "Box"),
      oninput: (e) => { boxNames[id] = e.target.value; },
    });
    return h("div", { class: "box-row", "data-box": id },
      h("span", { class: "box-code", text: r.code }),
      h("div", { class: "box-info" }, h("b", { text: r.model || "Modèle inconnu" }), h("small", { text: `Demande ${sinceLabel(r.at)}` })),
      name,
      h("div", { class: "box-actions" },
        h("button", { class: "btn small", type: "button", text: "Accepter", onclick: () => acceptBox(id, r, name.value) }),
        h("button", { class: "btn small secondary", type: "button", text: "Refuser", onclick: () => refuseBox(id, r) })));
  }) : [h("p", { class: "empty-line", text: "Aucune demande." })]));

  $("box-allowed").replaceChildren(...(allowed.length ? allowed.map(([id, b]) => h("div", { class: "box-row", "data-box": id },
    h("div", { class: "box-info" },
      h("b", { text: b.name }),
      h("small", { text: [b.model, b.at ? `acceptée le ${new Date(b.at).toLocaleDateString("fr-FR")}` : ""].filter(Boolean).join(" · ") })),
    h("div", { class: "box-actions" },
      h("button", { class: "btn small secondary", type: "button", text: "Renommer", onclick: () => renameBox(id, b) }),
      h("button", { class: "btn small secondary", type: "button", text: "Retirer", onclick: () => removeBox(id, b) })))) :
    [h("p", { class: "empty-line", text: "Aucune box autorisée pour l'instant." })]));
}

async function boxWrite(changes, done) {
  try {
    await update(ref(db, "boxes"), changes);
    status("box-status", done, true);
  } catch (err) {
    console.error(err);
    status("box-status", "Refusé : vérifiez Internet ou reconnectez-vous.");
  }
}

function acceptBox(id, r, typed) {
  const name = boxName(typed) || boxName(r.model || "") || "Box";
  delete boxNames[id];
  return boxWrite({
    [`allowed/${id}`]: { name, model: (r.model || "").slice(0, 80), at: serverTimestamp() },
    [`requests/${id}`]: null,
    // Dès la première box acceptée, plus aucune box inconnue ne peut lancer de partie (définitif).
    lockOn: true,
  }, `« ${name} » est activée : elle s'ouvre toute seule.`);
}

async function refuseBox(id, r) {
  if (!(await confirmer(`Refuser la box au code ${r.code} ? Elle restera bloquée.`, { ok: "Refuser", danger: true }))) return;
  delete boxNames[id];
  return boxWrite({ [`requests/${id}`]: null }, `Demande ${r.code} refusée.`);
}

async function renameBox(id, b) {
  const asked = await demanderTexte("Nouveau nom de la box :", b.name ?? "", { ok: "Renommer", maxlength: BOX_NAME_MAX });
  if (asked === null) return;
  const name = boxName(asked);
  if (!name || name === b.name) return;
  return boxWrite({ [`allowed/${id}/name`]: name }, `Box renommée « ${name} ».`);
}

async function removeBox(id, b) {
  if (!(await confirmer(`Retirer « ${b.name} » ? Elle se rebloquera dès qu'elle ne sera plus en pleine partie, et devra être acceptée à nouveau.`, { ok: "Retirer", danger: true }))) return;
  return boxWrite({ [`allowed/${id}`]: null }, `« ${b.name} » est retirée.`);
}

/**
 * Archiver range la prestation, après confirmation : elle disparaît de la régie. Elle ne se désarchive pas depuis sa
 * carte (cedric, 21/10) : « Dupliquer » en fait un nouvel anniversaire ; son statut reste modifiable dans sa fiche.
 */
async function archiver(id, s) {
  if (!(await confirmer(`Archiver « ${showTitle(s)} » ?\n\nElle quittera la régie et rejoindra les « Archivées ». Pour la réutiliser ensuite : « Dupliquer ».`, { ok: "Archiver" }))) return;
  await saveShowFields(id, { status: "archivee", keepActive: null });
}

/** Épingler une prestation archivée : un modèle, dans sa propre rubrique, où piocher des jeux pendant une fête. */
function pin(id, on) {
  return saveShowFields(id, { pinned: on ? true : null });
}

async function saveShowFields(id, fields) {
  try {
    await update(ref(db, `library/shows/${id}`), { ...fields, updatedAt: serverTimestamp() });
  } catch (err) {
    console.error(err);
    await avertir("Modification refusée : vérifiez Internet ou reconnectez-vous.");
  }
}

let editing = null; // { id, rounds }

$("show-profile").append(
  h("option", { value: "", text: "Automatique, selon l'âge" }),
  ...Object.entries(PROFILES).map(([k, p]) => h("option", { value: k, text: p.label })),
);
$("show-new").onclick = () => editShow(null);
// « Anniversaire de » + le prénom se met tout seul dans « Titre affiché » pendant qu'on tape le prénom, sauf si Sarah a
// écrit un autre titre (vidé, il se remet à suivre le prénom).
$("show-child").addEventListener("input", () => {
  const titre = $("show-title");
  if (titre.value.trim() && titre.value !== titre.dataset.auto) return;
  titre.value = titre.dataset.auto = titreAuto($("show-child").value);
});
$("show-edit-crumb").onclick = () => openShows(showsEtat);

/** Ouvre une prestation ; sans identifiant, une nouvelle. */
function editShow(id) {
  // Une nouvelle prestation compte 4 équipes (cedric, 21/10), à changer de 1 à 8.
  const s = id ? shows[id] : { status: "brouillon", rounds: [], teams: EQUIPES_PAR_DEFAUT };
  // Une ancienne manche « Super Finale » n'est pas un jeu : elle devient le réglage ×2 du quiz qui la précède.
  const { rounds, folded } = foldLegacyFinale(s.rounds);
  // Une ancienne manche « Quiz » de quiz illustrés s'affiche (et s'enregistre) en Quiz illustré.
  // Un Quiz = une seule manche (cedric, 23/10) : ses manches Quiz qui se suivent n'en font plus qu'une.
  const { rounds: reunies, fusions } = fusionnerQuiz(rounds.map((r) => versSeriesQuiz(jeuDeLaManche(r, quizzes), quizzes)));
  // Pas de manches dans un blind test (cedric, 24/10) : ceux qui se suivent n'en font plus qu'un.
  const { rounds: blinds, fusions: fusionsBlind } = fusionnerBlind(reunies.map((x) => versSeriesMots(versSeriesBlind(x))));
  editing = { id, rounds: blinds, themes: s.themes ?? null };
  $("show-edit-title").textContent = id ? showTitle(s) : "Nouvelle prestation";
  // Fil d'Ariane : la liste de son état (une nouvelle commence « À compléter »).
  showsEtat = id ? etatPrestation(s) : "acompleter";
  $("show-edit-crumb").textContent = LISTES[showsEtat].titre;
  $("show-child").value = s.childName ?? "";
  $("show-age").value = s.age ?? "";
  $("show-teams").value = s.teams ?? "";
  couleursSaisies = couleursEquipes(s);
  pastilleOuverte = -1;
  renderCouleurs();
  $("show-date").value = s.date ?? "";
  // Le statut montré est son état réel : une fête passée, archivée d'elle-même, se lit « Archivée ».
  $("show-status").value = id && isArchived(s) ? "archivee" : s.status ?? "brouillon";
  montrerArchivee(!!id && isArchived(s));
  // Titre proposé d'office d'après le prénom (cedric, 23/10), tant que Sarah n'en a pas écrit un autre ; l'ancien
  // titre par défaut (« L'anniversaire de … ») devient le nouveau.
  const titre = s.title?.trim() ?? "";
  const suivi = !titre || titre === titreAuto(s.childName) || titre === `L'anniversaire de ${s.childName?.trim()}`;
  $("show-title").value = suivi ? titreAuto(s.childName) : titre;
  $("show-title").dataset.auto = suivi ? titreAuto(s.childName) : "";
  $("show-profile").value = s.profile ?? "";
  $("show-notes").value = s.notes ?? "";
  $("show-defis").value = Array.isArray(s.defis) ? s.defis.join("\n") : "";
  status("show-status-msg", s.copieDe && !s.childName ? "Copie : indiquez le prénom, l'âge et la date du nouvel anniversaire, puis enregistrez."
    : folded ? "L'ancienne manche « Super Finale » est devenue le réglage du quiz (ses dernières questions ×2). Enregistrez pour garder ce changement."
    : fusions ? "Les manches Quiz qui se suivaient n'en font plus qu'une (une seule Super Finale, à la fin). Enregistrez pour garder ce changement."
    : fusionsBlind ? "Les manches de blind test (ou de quiz musical) qui se suivaient n'en font plus qu'une (leurs chansons à la suite). Enregistrez pour garder ce changement." : "", !!s.copieDe || !!folded || !!fusions || !!fusionsBlind);
  show("show-edit");
  refreshRounds();
  histPrestation.depart();
  if (s.copieDe && !s.childName) $("show-child").focus();
}

/**
 * « Archivée » ne se choisit pas dans la fiche (cedric, 23/10) : une fête s'archive d'elle-même le lendemain de sa
 * date, ou par « Archiver » sur sa carte. Le choix n'apparaît que pour une archivée, qu'on peut remettre « À venir »
 * (fête reportée : nouvelle date).
 */
function montrerArchivee(oui) {
  const option = $("show-status").querySelector('option[value="archivee"]');
  option.hidden = !oui;
  option.disabled = !oui;
}

/** Champs de la fiche d'une prestation, gardés par « Retour » et « Annuler les modifications ». */
const SHOW_FIELDS = ["show-child", "show-age", "show-teams", "show-date", "show-status", "show-title", "show-profile", "show-notes", "show-defis"];
const histPrestation = historique({
  ecran: $("screen-show-edit"),
  precedent: pagePrecedente,
  capturer: () => ({ rounds: editing?.rounds ?? [], champs: SHOW_FIELDS.map((id) => $(id).value), couleurs: [...couleursSaisies] }),
  restaurer: (e) => {
    SHOW_FIELDS.forEach((id, k) => { $(id).value = e.champs[k]; });
    $("show-title").dataset.auto = titreAuto($("show-child").value);
    if (editing) {
      // Ctrl+Z, « Annuler les modifications » : les jeux dépliés le restent (rien de ça n'est dans l'historique).
      const ouverts = new Set(editing.rounds.map((r, i) => (r?.[JEU_OUVERT] ? `${i}:${r.type ?? "quiz"}` : null)));
      e.rounds.forEach((r, i) => { if (r && ouverts.has(`${i}:${r.type ?? "quiz"}`)) r[JEU_OUVERT] = true; });
      editing.rounds = e.rounds;
    }
    couleursSaisies = e.couleurs ?? [];
    pastilleOuverte = -1;
    renderCouleurs();
    refreshRounds();
  },
  // « Enregistrer » dans la fenêtre « Des modifications ne sont pas enregistrées » (cedric, 24/10).
  enregistrer: () => ($("show-form").reportValidity() ? enregistrerPrestation() : false),
});
// En bas, « Enregistrer » ouvre la barre qui suit l'écran : Enregistrer · Annuler les modifications · ← Retour, de gauche
// à droite (cedric, 24/10). Le bouton garde son formulaire (attribut form).
$("screen-show-edit").querySelector(".retour-barre.bas").prepend($("show-save"));

function formShow() {
  const num = (v) => (v === "" ? null : Number(v));
  return {
    childName: $("show-child").value.trim() || null,
    age: num($("show-age").value),
    date: $("show-date").value || null,
    status: $("show-status").value,
    title: $("show-title").value.trim() || null,
    profile: $("show-profile").value || null,
    // Plus de case « Thèmes » (cedric, 23/10 : elle ne servait à rien) ; celui d'une ancienne prestation est gardé.
    themes: editing.themes ?? null,
    notes: $("show-notes").value.trim() || null,
    // Défis de la pause en plus (cedric, 31/10) : copiés dans la partie au lancement, jamais repris à la fête suivante.
    defis: defisDuTexte($("show-defis").value).length ? defisDuTexte($("show-defis").value) : null,
    teams: num($("show-teams").value),
    teamColors: [...couleursSaisies],
    rounds: editing.rounds.filter(roundFilled).map((r) => cleanRound(r, playlists)),
  };
}

/** Éléments choisis un par un, à enregistrer dans la manche (rien : tirage au hasard au lancement). */
const picksOf = (r) => (roundPicks(r).length ? { picks: roundPicks(r) } : {});

/** Profil d'âge de la prestation en cours de saisie. */
function formProfile() {
  const v = $("show-profile").value;
  const age = $("show-age").value === "" ? null : Number($("show-age").value);
  return PROFILES[v] ? v : profileForAge(age);
}

/**
 * Écran qui édite des manches (la prestation, ou une manche seule dans la page d'un jeu) : ce que les sélecteurs
 * redessinent quand on change quelque chose, et l'âge qui règle leurs tirages au hasard.
 */
let roundCtx = {
  refresh: () => refreshRounds(), summary: () => refreshSummary(), profile: () => formProfile(),
  // « Jamais deux fois » : ce que montrent les autres manches de la prestation (concept → nom du jeu).
  elsewhere: (r) => (editing ? usedElsewhere(editing.rounds, editing.rounds.indexOf(r), { quizzes, mimes, contents }) : new Map()),
};
const prestationCtx = roundCtx;
/** La carte d'un jeu se règle comme dans la prestation : aussi dans la page « ＋ Jeu » du téléphone (cedric, 30/10). */
const commeEnPrestation = () => roundCtx === prestationCtx || roundCtx.prestation === true;

/** Mots du Pictionary tirés par « Tirer au hasard ». */
const PICTO_DRAW = 24;

/**
 * Sélection modifiable d'une manche à cartes (mimes, mots, personnages, familles) : « Tirer au hasard » remplit la
 * liste, ✕ retire un élément, « Ajouter » en reprend un du catalogue. Liste vide : la box tire au hasard au lancement,
 * comme avant. [items] : tout ce qu'on peut choisir ({ key, label, group }) ; [get]/[set] : les clés choisies.
 * « Jamais deux fois » : [round] et [conceptsOf] (ce que montre un élément, par sa clé) signalent en rouge un élément
 * déjà utilisé dans une autre manche de la prestation ; le choisir reste permis, le tirage au hasard l'évite.
 */
function selectionEditor({ items, get, set, draw, unit, empty, own, round = null, conceptsOf = null }) {
  const box = h("div", { class: "pick-box" });
  // Recherche dans la liste « Ajouter » (des centaines de photos ou de cartes) : gardée d'un dessin à l'autre.
  let cherche = "";
  const plat = (t) => `${t ?? ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const paint = () => {
    const all = items();
    const byKey = new Map(all.map((x) => [x.key, x]));
    const chosen = get();
    const autres = round && conceptsOf ? roundCtx.elsewhere?.(round) ?? new Map() : new Map();
    const ailleurs = (k) => {
      if (!autres.size) return null;
      const hit = conceptsOf(k).find((c) => autres.has(c));
      return hit ? autres.get(hit) : null;
    };
    // Les autres manches lisent aussi ce choix : avec des signalements, toute la prestation se redessine.
    const change = (keys) => { set(keys); if (round && roundCtx.elsewhere) roundCtx.refresh(); else paint(); roundCtx.summary(); };
    const deja = chosen.map((k) => [k, ailleurs(k)]).filter(([, w]) => w);
    const e = unit === "carte" || unit === "famille" ? "e" : "";
    const n = chosen.length;
    const addSelect = () => {
      const q = plat(cherche).trim();
      const libres = parPertinence(all.filter((x) => !chosen.includes(x.key) && (!q || plat(`${x.label} ${x.group ?? ""}`).includes(q))), q, (x) => x.label, (x) => x.group);
      const groupes = [...new Set(libres.map((x) => x.group ?? ""))];
      return h("select", { class: "pick-add", "aria-label": `Ajouter un${e} ${unit}`, onchange: (ev) => { if (ev.target.value) change([...chosen, ev.target.value]); } },
        h("option", { value: "", text: q ? `＋ ${libres.length} trouvé${libres.length > 1 ? "s" : ""} : choisir…` : `＋ Ajouter un${e} ${unit}…` }),
        ...groupes.map((g) => {
          const opts = libres.filter((x) => (x.group ?? "") === g).map((x) => {
            const where = ailleurs(x.key);
            return h("option", { value: x.key, text: where ? `${x.label} (déjà utilisé dans ${where})` : x.label, class: where ? "deja" : null });
          });
          return g ? h("optgroup", { label: g }, ...opts) : opts;
        }));
    };
    remplir(box, ...[
      h("span", { class: "small", text: n ? `${n} ${unit}${n > 1 ? "s" : ""} choisi${e}${n > 1 ? "s" : ""}  : le jeu joue exactement cette liste.` : empty }),
      h("button", { type: "button", class: "chip pick-draw", text: "🎲 Tirer au hasard", onclick: () => change(draw()) }),
      chosen.length ? h("button", { type: "button", class: "chip", text: "Tout retirer (tirage au lancement)", onclick: () => change([]) }) : null,
      h("div", { class: "pick-list" }, ...chosen.map((k) => {
        const where = ailleurs(k);
        return h("button", {
          type: "button", class: `chip pick-item${where ? " deja" : ""}`, "data-key": k, title: where ? `Déjà utilisé dans ${where}. Retirer ?` : "Retirer",
          text: `${byKey.get(k)?.label ?? k} ✕`, onclick: () => change(chosen.filter((x) => x !== k)),
        });
      })),
      deja.length ? h("p", { class: "pick-deja", text: `⚠ ${deja.map(([k, w]) => `${byKey.get(k)?.label ?? k} : déjà utilisé dans ${w}`).join(" · ")}. C'est permis, mais les enfants l'auront déjà vu.` }) : null,
      // La recherche d'abord, puis la liste qu'elle filtre.
      chosen.length < MAX_PICKS && all.length > 8 ? h("input", {
        type: "search", class: "pick-search", placeholder: "🔎 Chercher…", "aria-label": `Chercher un${e} ${unit}`, value: cherche,
        oninput: (ev) => { cherche = ev.target.value; box.querySelector(".pick-add")?.replaceWith(addSelect()); },
      }) : null,
      chosen.length < MAX_PICKS ? addSelect() : null,
      own ? h("span", { class: "pick-own" },
        h("input", { type: "text", maxlength: 40, placeholder: "Ma carte (un mot à mimer)", "aria-label": "Ma carte" }),
        h("button", { type: "button", class: "chip", text: "Ajouter", onclick: (ev) => {
          const input = ev.target.previousElementSibling;
          const k = own(input.value);
          if (k && !chosen.includes(k)) change([...chosen, k]);
        } })) : null,
    ].filter(Boolean));
  };
  paint();
  return box;
}

/** Mimes : cartes de la manche, choisies dans le paquet (ou le catalogue) ; ses propres mots aussi. */
function mimeSelection(r) {
  const extra = new Map(mimeCards(r.cards).map((c) => [c.word.toLowerCase(), c]));
  const pool = () => {
    const deck = r.deckId ? mimes[r.deckId] : null;
    const list = deck ? mimeCards(deck.cards).map((c) => ({ card: c })) : collectionItems("mimes", { mimes }).map((x) => ({ card: x.value, group: x.group }));
    list.forEach((x) => extra.set(x.card.word.toLowerCase(), extra.get(x.card.word.toLowerCase()) ?? x.card));
    return list;
  };
  return selectionEditor({
    unit: "carte",
    round: r,
    conceptsOf: (k) => concepts(extra.get(k) ?? { word: k }),
    empty: r.deckId ? "Aucune carte choisie : tout le paquet, mélangé au lancement." : `Aucune carte choisie : ${MIME_RANDOM} cartes au hasard au lancement, selon l'âge.`,
    items: () => {
      // « 📷 Photos » : les cartes qui auront leur photo sont marquées ; une photo à soi l'est toujours.
      const photo = (c) => (c.imageId || (r.photos === true && motDeLaBanque(c.word)) ? "📷 " : "");
      const list = pool().map((x) => ({ key: x.card.word.toLowerCase(), label: `${photo(x.card)}${x.card.image ?? ""} ${x.card.word}`.trim(), group: x.group }));
      const keys = new Set(list.map((x) => x.key));
      // Cartes ajoutées à la main (absentes du paquet) : elles restent dans la liste.
      mimeCards(r.cards).filter((c) => !keys.has(c.word.toLowerCase())).forEach((c) => list.push({ key: c.word.toLowerCase(), label: `${photo(c)}${c.image ?? ""} ${c.word}`.trim(), group: "Mes cartes" }));
      return list;
    },
    get: () => mimeCards(r.cards).map((c) => c.word.toLowerCase()),
    set: (keys) => { r.cards = keys.map((k) => extra.get(k)).filter(Boolean); },
    draw: () => (r.deckId
      ? mimeDraw({ deckId: r.deckId }, mimes, roundCtx.profile()).map((c) => { extra.set(c.word.toLowerCase(), c); return c.word.toLowerCase(); })
      // Toutes les collections : autant de cartes que les équipes prévues en demandent (sinon le tirage habituel).
      // Au hasard : émojis et banque de photos seulement, jamais une photo téléversée (cedric, 21/10).
      : drawItems(filterItems(collectionItems("mimes", { mimes }, { hasard: true }), { profile: roundCtx.profile() }), mimeCardsNeeded(r, ctxTeams()) || MIME_RANDOM,
        { type: "mimes", avoidConcepts: roundCtx.elsewhere?.(r) }).items
        .map((x) => { extra.set(x.key, x.value); return x.key; })),
    own: (word) => {
      const c = mimeCards([{ word }])[0];
      if (!c) return null;
      extra.set(c.word.toLowerCase(), extra.get(c.word.toLowerCase()) ?? c);
      return c.word.toLowerCase();
    },
  });
}

/**
 * Durées d'un tour de mimes proposées (secondes) : 2 min d'office (cedric, 24/10), de 15 s en 15 s jusqu'à 5 min
 * (cedric, 26/10 : « régler précisément le temps du chrono », une durée pour toutes les équipes).
 */
const MIME_DUREES = Array.from({ length: (MIME_TURN_MAX - 30) / 15 + 1 }, (_, k) => 30 + 15 * k);
/**
 * Images par équipe proposées (cedric, 24/10 : « une vingtaine par équipe par sécurité » ; 26/10 : « des dizaines et
 * des dizaines », pour ne jamais en manquer).
 */
const MIME_IMAGES = [10, 15, 20, 25, 30, 40, 50, 60];
const MIME_IMAGES_DEFAUT = 20;
/** « 2 min », « 1 min 30 », « 45 s ». */
const enMinutes = (sec) => (sec < 60 ? `${sec} s` : sec % 60 ? `${Math.floor(sec / 60)} min ${sec % 60}` : `${sec / 60} min`);
/** Ce que montre une image de mimes, pour « jamais deux fois » : sa photo à soi par son identifiant, sinon son mot et son émoji. */
const conceptsMime = (c) => (c?.imageId ? [`i:${c.imageId}`] : concepts(c ?? {}));
/** Images retirées (✕) d'une manche de mimes pendant la saisie : le 🎲 de leur case ne les redonne pas. */
const mimesRetires = new WeakMap();
/** Lignes d'équipe dépliées (leur liste d'images visible), par manche de mimes : rien n'est enregistré. */
const mimesDeplies = new WeakMap();

/**
 * Les images que le 🎲 des Mimes peut tirer, selon la source choisie par Sarah (cedric, 23/10) : photos libres, émojis
 * ou ses images (« Mes images », exception à la règle du hasard accordée par cedric pour les mimes).
 */
function imagesPourMimes(source) {
  if (source === "emojis") return emojisBibliotheque().map((x) => ({ word: x.nom, image: x.emoji }));
  if (source === "miennes") return groupesImages().miennes.map((x) => ({ word: `${x.nom ?? ""}`.trim() || "Image", imageId: x.id }));
  return photosLibres().map((x) => ({ word: x.nom, image: x.emoji, banque: x.id.slice(BANQUE.length) }));
}

/** Une image de la Bibliothèque (le « ＋ » d'une équipe) en image de mimes. */
const imageDeMime = (x) => mimeCards([x.groupe === "emojis" ? { word: x.nom, image: x.emoji }
  : x.groupe === "photos" ? { word: x.nom, image: x.emoji, banque: x.id.slice(BANQUE.length) }
    : { word: `${x.nom ?? ""}`.trim() || "Image", imageId: x.id }])[0];

/**
 * Pioche [n] images de mimes pour la manche [r], jamais une qui montre déjà quelque chose de [prises] (concepts de la
 * manche, mis à jour) ; d'abord celles qu'aucune autre manche de la prestation ne montre (« jamais deux fois »).
 * Photos libres et émojis (cedric, 24/10) : seulement les images bonnes pour le mime, du niveau du [profil] d'abord
 * (les Petits n'ont que les leurs) ; ses images à soi : tous âges.
 */
function piocherMimes(r, n, prises, profil = null) {
  if (n <= 0) return [];
  const ailleurs = roundCtx.elsewhere?.(r) ?? new Map();
  const images = imagesPourMimes(r.source);
  const paliers = r.source === "miennes" ? [images] : niveauxPourProfil(profil).map((nv) => images.filter((c) => nv.includes(niveauMime(c.word))));
  const toutes = paliers.flatMap((l) => shuffle(l)).map((c) => mimeCards([c])[0]).filter(Boolean);
  const neuves = toutes.filter((c) => !conceptsMime(c).some((k) => ailleurs.has(k)));
  const out = [];
  for (const c of [...neuves, ...toutes.filter((x) => !neuves.includes(x))]) {
    if (out.length >= n) break;
    if (conceptsMime(c).some((k) => prises.has(k))) continue;
    conceptsMime(c).forEach((k) => prises.add(k));
    out.push(c);
  }
  return out;
}

/** Concepts déjà dans la manche de mimes [r] (toutes équipes) et ceux qu'on y a retirés. */
const prisesMimes = (r) => new Set([...mimeEquipes(r).flat().flatMap(conceptsMime), ...(mimesRetires.get(r) ?? [])]);

/**
 * Mimes dans une prestation (cedric, 23/10 puis 24/10) : une ligne par équipe, dans l'ordre des couleurs de la
 * prestation. En haut : la source des images, le nombre d'images par équipe (20 d'office) et la durée du tour (2 min).
 * Chaque ligne : sa tranche d'âge (celle de la prestation d'office), son 🎲 (les images de l'équipe), « ＋ » (des
 * images choisies dans la Bibliothèque), 🔀 (l'ordre joué sur la TV) ; elle se déplie pour montrer ses images. ✕ retire
 * une image et laisse un 🎲 à sa place ; une case laissée sur son 🎲 ne compte pas.
 */
function mancheMimes(r) {
  const couleurs = couleursSaisies.length ? couleursSaisies : couleursEquipes({ teams: ctxTeams() });
  const n = couleurs.length;
  if (!MIME_SOURCES[r.source]) r.source = "photos";
  const par = mimePerTeam(r) || MIME_IMAGES_DEFAUT;
  // Moins d'équipes prévues : les présélections en trop partent.
  if (mimeEquipesBrutes(r).length > n) r.equipes = mimeEquipesBrutes(r).slice(0, n);
  const equipes = mimeEquipesBrutes(r);
  const reelles = (k) => (equipes[k] ?? []).filter((c) => !c.vide);
  const tire = equipes.some((l) => l.length);
  const deplies = mimesDeplies.get(r) ?? new Set();
  mimesDeplies.set(r, deplies);
  const changer = () => roundCtx.refresh();
  const nom = (k) => nomCouleur(couleurs[k]);
  const profilPrestation = roundCtx.profile?.() ?? "MOYENS";
  const age = (k) => mimeAges(r)[k] ?? profilPrestation;
  /** La liste de l'équipe [k] devient [liste] ; les autres ne bougent pas. */
  const poser = (k, liste) => {
    const brutes = mimeEquipesBrutes(r);
    r.equipes = couleurs.map((_, j) => (j === k ? liste : brutes[j] ?? []));
    r.perTeam = par;
    // L'ancienne façon de préparer la manche (paquet, tirage au lancement) laisse la place.
    r.deckId = null; r.random = null; r.cards = null; r.photos = null;
  };
  /** Le 🎲 d'une équipe : [par] images de son âge, jamais une déjà dans la manche ; ses images d'avant sont remplacées. */
  const tirerEquipe = async (k) => {
    const avant = reelles(k).length;
    if (avant && !(await confirmer(`Tirer de nouvelles images pour l'équipe ${nom(k)} ? Ses ${plural(avant, "image")} seront remplacées.`, { ok: "Tirer à nouveau", annuler: "Garder" }))) return;
    const brutes = mimeEquipesBrutes(r);
    const prises = new Set([...brutes.flatMap((l, j) => (j === k ? [] : l.filter((c) => !c.vide))).flatMap(conceptsMime), ...(mimesRetires.get(r) ?? [])]);
    const cartes = piocherMimes(r, par, prises, age(k));
    if (!cartes.length) return annonce(`Plus d'image à tirer pour l'équipe ${nom(k)} dans cette source : choisissez-en une autre, ou « ＋ ».`);
    poser(k, cartes);
    deplies.add(k);
    if (cartes.length < par) annonce(`Seulement ${plural(cartes.length, "image")} à tirer pour l'équipe ${nom(k)} (${PROFILES[age(k)]?.label ?? "cet âge"}) : complétez avec « ＋ ».`);
    changer();
  };
  /** Complète l'équipe [k] jusqu'au nombre choisi : ses cases vides d'abord, puis à la fin. */
  const completer = (k) => {
    const liste = [...(mimeEquipesBrutes(r)[k] ?? [])];
    const nouvelles = piocherMimes(r, Math.max(0, par - liste.filter((c) => !c.vide).length), prisesMimes(r), age(k));
    if (!nouvelles.length) return annonce(`Plus d'image à tirer pour l'équipe ${nom(k)} dans cette source : choisissez-en une autre, ou « ＋ ».`);
    const remplie = liste.map((c) => (c.vide && nouvelles.length ? nouvelles.shift() : c));
    poser(k, [...remplie, ...nouvelles]);
    changer();
  };
  const tirerUne = (k, i) => {
    const liste = [...(mimeEquipesBrutes(r)[k] ?? [])];
    const [c] = piocherMimes(r, 1, prisesMimes(r), age(k));
    if (!c) return annonce("Plus d'image à tirer dans cette source : choisissez-en une autre, ou « ＋ ».");
    liste[i] = c;
    poser(k, liste);
    changer();
  };
  const retirer = (k, i) => {
    const liste = [...(mimeEquipesBrutes(r)[k] ?? [])];
    mimesRetires.set(r, new Set([...(mimesRetires.get(r) ?? []), ...conceptsMime(liste[i])]));
    liste[i] = { vide: true };
    poser(k, liste);
    changer();
  };
  const melanger = (k) => { poser(k, shuffle([...(mimeEquipesBrutes(r)[k] ?? [])])); changer(); };
  /** « ＋ » : des images choisies dans la Bibliothèque, ajoutées à la fin de la liste de l'équipe. */
  const ajouterImages = async (k) => {
    const autres = roundCtx.elsewhere?.(r) ?? new Map();
    const ici = new Map(mimeEquipesBrutes(r).flatMap((l, j) => l.filter((c) => !c.vide).flatMap((c) => conceptsMime(c).map((x) => [x, `ces Mimes (équipe ${nom(j)})`]))));
    const choisies = await choisirDansBibliotheque({
      titre: `Images à mimer pour l'équipe ${nom(k)}`, groupes: ["packs", "photos", "emojis", "miennes"], plusieurs: true,
      deja: (x) => { const c = imageDeMime(x); const hit = c && conceptsMime(c).find((y) => ici.has(y) || autres.has(y)); return hit ? ici.get(hit) ?? autres.get(hit) : null; },
    });
    const cartes = choisies.map(imageDeMime).filter(Boolean);
    if (!cartes.length) return;
    const liste = [...(mimeEquipesBrutes(r)[k] ?? [])];
    const place = Math.max(0, MIME_EQUIPES_MAX - liste.length);
    poser(k, [...liste, ...cartes.slice(0, place)]);
    deplies.add(k);
    annonce(cartes.length > place
      ? `${plural(place, "image ajoutée", "images ajoutées")} à l'équipe ${nom(k)} : ${MIME_EQUIPES_MAX} au plus par équipe.`
      : `${plural(cartes.length, "image ajoutée", "images ajoutées")} à l'équipe ${nom(k)}.`, cartes.length <= place);
    changer();
  };
  const source = h("select", {
    class: "mime-source", "aria-label": "Où prendre les images à mimer", title: "Où le 🎲 de chaque équipe prend ses images",
    onchange: (e) => { r.source = e.target.value; changer(); },
  }, ...Object.entries(MIME_SOURCES).map(([k, label]) => h("option", { value: k, selected: k === r.source, text: `Images : ${label}` })));
  const nombre = h("select", {
    class: "mime-par-equipe", "aria-label": "Images par équipe", title: "Combien d'images le 🎲 tire pour chaque équipe",
    onchange: (e) => { r.perTeam = Number(e.target.value); changer(); },
  }, ...[...new Set([...MIME_IMAGES, par])].sort((a, b) => a - b).map((k) => h("option", { value: k, selected: k === par, text: `${k} images par équipe` })));
  const tour = r.duration ?? MIME_TURN;
  const duree = h("select", {
    class: "mime-duree", "aria-label": "Durée du tour de chaque équipe", title: "Durée du tour de chaque équipe",
    onchange: (e) => { r.duration = Number(e.target.value) === MIME_TURN ? null : Number(e.target.value); roundCtx.summary(); },
  }, ...[...new Set([...MIME_DUREES, tour])].sort((a, b) => a - b).map((k) => h("option", { value: k, selected: k === tour, text: `Tour de ${enMinutes(k)}` })));
  const total = mimeEquipes(r).flat().length;
  const manque = couleurs.reduce((t, _, k) => t + Math.max(0, par - reelles(k).length), 0);
  const compteur = h("p", { class: "quiz-compteur", "aria-live": "polite",
    text: tire ? `${n} équipe${n > 1 ? "s" : ""} · ${plural(total, "image")}${manque ? ` · ${manque} à tirer` : ""}` : "Aucune image pour l'instant : touchez 🎲 sur chaque équipe" });
  const autres = roundCtx.elsewhere?.(r) ?? new Map();
  const ailleurs = (c) => { const k = conceptsMime(c).find((x) => autres.has(x)); return k ? autres.get(k) : null; };
  const vignette = (c) => apercuPhoto(c) ?? h("span", { class: "tirage-mini emoji", text: c.image ?? "🎭" });
  const lignes = couleurs.map((couleur, k) => {
    const liste = equipes[k] ?? [];
    const vraies = reelles(k).length;
    const ouverte = deplies.has(k) && liste.length > 0;
    const manqueIci = vraies ? Math.max(0, par - vraies) : 0;
    const nbDeja = reelles(k).filter((c) => ailleurs(c)).length;
    const choixAge = h("select", {
      class: "mime-age", "aria-label": `Âge des images de l'équipe ${nomCouleur(couleur)}`, title: "Âge des images que tire le 🎲 de cette équipe",
      onchange: (e) => {
        const ages = mimeAges(r);
        ages[k] = e.target.value === profilPrestation ? null : e.target.value;
        r.ages = Object.fromEntries(ages.map((p, j) => [j, p]).filter(([, p]) => p));
        changer();
      },
    }, ...Object.entries(PROFILES).map(([key, p]) => h("option", { value: key, selected: key === age(k), text: p.label })));
    return h("section", { class: `mime-equipe${ouverte ? " ouverte" : ""}`, style: `--c: ${couleur}`, "data-couleur": nomCouleur(couleur) },
      h("div", { class: "mime-equipe-tete" },
        h("button", {
          type: "button", class: "mime-deplier", "aria-expanded": ouverte ? "true" : "false", disabled: !liste.length,
          title: liste.length ? (ouverte ? "Replier la liste des images" : "Voir les images de l'équipe") : "Aucune image : touchez 🎲",
          onclick: () => { if (deplies.has(k)) deplies.delete(k); else deplies.add(k); changer(); },
        }, h("span", { class: "fleche", text: ouverte ? "▾" : "▸" }), h("span", { class: "rond" }), h("b", { text: `Équipe ${nomCouleur(couleur)}` })),
        choixAge,
        h("span", { class: "small hint mime-nombre", text: vraies ? plural(vraies, "image") : "Aucune image" }),
        // Repliée, la ligne dit quand même qu'une de ses images sert déjà dans un autre jeu (« jamais deux fois »).
        nbDeja ? h("span", { class: "mime-deja", text: `⚠ ${nbDeja} déjà dans un autre jeu`, title: [...new Set(reelles(k).map(ailleurs).filter(Boolean))].map((x) => `Déjà utilisée dans ${x}`).join("\n") }) : null,
        h("button", {
          type: "button", class: "btn tirage-de", text: "🎲", "aria-label": `Tirer les images de l'équipe ${nomCouleur(couleur)} au hasard`,
          title: `Tirer ${par} images pour l'équipe ${nomCouleur(couleur)}`, onclick: () => tirerEquipe(k),
        }),
        h("button", {
          type: "button", class: "btn secondary mime-plus", text: "＋", "aria-label": `Ajouter des images de la Bibliothèque à l'équipe ${nomCouleur(couleur)}`,
          title: "Choisir des images dans la Bibliothèque", onclick: () => ajouterImages(k),
        }),
        h("button", {
          type: "button", class: "icon mime-melanger", text: "🔀", "aria-label": `Mélanger les images de l'équipe ${nomCouleur(couleur)}`,
          title: "Mélanger : la TV les montre dans cet ordre", disabled: vraies < 2, onclick: () => melanger(k),
        }),
        manqueIci ? h("button", { type: "button", class: "chip mime-completer", text: `🎲 Tirer ${manqueIci > 1 ? `les ${manqueIci} images` : "l'image"} qui manque${manqueIci > 1 ? "nt" : ""}`, onclick: () => completer(k) }) : null),
      ouverte ? h("ul", { class: "mime-images" }, ...liste.map((c, i) => (c.vide
        ? h("li", { class: "mime-image vide" }, h("button", {
          type: "button", class: "btn tirage-de petit", text: "🎲", "aria-label": `Tirer une autre image pour l'équipe ${nomCouleur(couleur)}`,
          title: "Tirer une autre image", onclick: () => tirerUne(k, i),
        }))
        : h("li", { class: `mime-image${ailleurs(c) ? " deja" : ""}`, title: ailleurs(c) ? `Déjà utilisée dans ${ailleurs(c)}` : c.word },
          imageRecadrable(vignette(c), r, c, changer),
          h("span", { class: "mime-mot", text: c.word }),
          h("button", { type: "button", class: "icon tirage-retirer", text: "✕", "aria-label": `Retirer « ${c.word} »`, title: "Retirer cette image (un 🎲 prend sa place)", onclick: () => retirer(k, i) }))))) : null);
  });
  // Une manche préparée avant (un paquet, un tirage au lancement) : elle se joue encore telle quelle.
  const ancienne = !tire && (r.deckId || r.random === true || mimeCards(r.cards).length)
    ? h("p", { class: "small hint mime-ancienne", text: `Manche préparée à l'ancienne : ${mancheSummary(r, { mimes })}, jouée telle quelle. Le 🎲 d'une équipe la remplace par une présélection pour chaque équipe.` })
    : null;
  return [
    compteur,
    h("div", { class: "quiz-outils" }, h("div", { class: "tirage-ligne" }, source, nombre, duree)),
    ancienne,
    h("div", { class: "mime-equipes" }, ...lignes),
  ].filter(Boolean);
}

/** Mots retirés (✕) d'un Pictionary pendant la saisie : le 🎲 de leur case ne les redonne pas. */
const dessinsRetires = new WeakMap();
/** Équipes dépliées (leurs passages visibles), par Pictionary : rien n'est enregistré. */
const dessinsDeplies = new WeakMap();

/**
 * Mots que le 🎲 du Pictionary propose (cedric, 24/10 : l'émoji sur la tablette, la vraie photo sur la TV quand le
 * dessin est trouvé) : ceux de la banque de photos libres, qui ont chacun leur émoji et leur photo, choisis ensemble.
 * D'abord les mots du jeu (faciles à dessiner), puis le reste de la banque ; jamais un mot du jeu que Sarah a retiré,
 * ni, pour les Petits, un mot marqué « grands ».
 */
function motsPourDessin(profil) {
  const actifs = new Set(activeItems("pictionary", contents.pictionary).map((w) => w.word.toLowerCase()));
  const cle = (w) => motDeLaBanque(w.word)?.cle;
  const exclus = new Set(CONTENT_GAMES.pictionary.catalog.filter((w) => !actifs.has(w.word.toLowerCase()) || (profil === "PETITS" && w.level === 2)).map(cle).filter(Boolean));
  const faciles = new Set(activeItems("pictionary", contents.pictionary).filter((w) => profil !== "PETITS" || w.level !== 2).map(cle).filter(Boolean));
  const photos = photosLibres().map((x) => ({ word: x.nom, image: x.emoji, banque: x.id.slice(BANQUE.length) })).filter((m) => !exclus.has(m.banque));
  return [photos.filter((m) => faciles.has(m.banque)), photos.filter((m) => !faciles.has(m.banque))];
}

/**
 * Pioche [n] mots pour le Pictionary [r], jamais un qui montre déjà quelque chose de [prises] (mots du jeu, mis à
 * jour) ; d'abord ceux qu'aucun autre jeu de la prestation ne montre (« jamais deux fois »), les plus faciles d'abord.
 */
function piocherDessins(r, n, prises, profil) {
  if (n <= 0) return [];
  const ailleurs = roundCtx.elsewhere?.(r) ?? new Map();
  const [faciles, autres] = motsPourDessin(profil);
  const neuf = (m) => !concepts(m).some((k) => ailleurs.has(k));
  const out = [];
  for (const m of [...shuffle(faciles.filter(neuf)), ...shuffle(autres.filter(neuf)), ...shuffle(faciles.filter((x) => !neuf(x))), ...shuffle(autres.filter((x) => !neuf(x)))]) {
    if (out.length >= n) break;
    if (concepts(m).some((k) => prises.has(k))) continue;
    concepts(m).forEach((k) => prises.add(k));
    out.push(m);
  }
  return out;
}

/** Une image de la Bibliothèque (ajout à la main) en mot du Pictionary : son émoji, sa photo libre, ou votre image. */
const imageDeDessin = (x) => motPictoDe(x.groupe === "emojis" ? { word: x.nom, image: x.emoji }
  : x.groupe === "photos" ? { word: x.nom, image: x.emoji, banque: x.id.slice(BANQUE.length) }
    : { word: `${x.nom ?? ""}`.trim() || "Image", imageId: x.id });
const motPictoDe = (m) => (typeof m.word === "string" && m.word.trim() ? m : null);

/**
 * Pictionary dans une prestation (cedric, 24/10 : « à l'image des autres jeux ») : une première ligne avec le nombre de
 * mots proposés au dessinateur, le nombre de passages de chaque équipe, le temps de dessin et le 🎲, qui prépare tous
 * les passages ; une deuxième pour ajouter un passage à la main à une équipe (images de la Bibliothèque). Puis une ligne
 * par équipe, dans la couleur de son bracelet : ses passages, chacun avec ses mots (émoji, vraie photo, nom). ✕ retire un
 * mot et laisse un 🎲 à sa place.
 */
function mancheDessins(r) {
  const couleurs = couleursSaisies.length ? couleursSaisies : couleursEquipes({ teams: ctxTeams() });
  const n = couleurs.length;
  const N = pictoPropositions(r);
  const P = pictoPassages(r);
  const profil = roundCtx.profile?.() ?? "MOYENS";
  // Moins d'équipes prévues : les passages en trop partent.
  if (pictoToursBruts(r).length > n) r.tours = pictoToursBruts(r).slice(0, n);
  const tours = pictoToursBruts(r);
  const reels = (k) => (tours[k] ?? []).map((p) => p.filter((m) => !m.vide)).filter((p) => p.length);
  const tire = tours.some((ps) => ps.length);
  const deplies = dessinsDeplies.get(r) ?? new Set();
  dessinsDeplies.set(r, deplies);
  const changer = () => roundCtx.refresh();
  const nom = (k) => nomCouleur(couleurs[k]);
  const prises = () => new Set([...pictoToursBruts(r).flat(2).filter((m) => !m.vide).flatMap(concepts), ...(dessinsRetires.get(r) ?? [])]);
  /** Les passages de l'équipe [k] deviennent [passages] ; les autres ne bougent pas. */
  const poser = (k, passages) => {
    const brutes = pictoToursBruts(r);
    r.tours = couleurs.map((_, j) => (j === k ? passages : brutes[j] ?? []));
    r.propositions = N;
    r.passages = P;
    // L'ancienne façon (mots ou séries choisis, tirage au lancement) laisse la place.
    r.picks = null; r.hasard = null; r.series = null;
  };
  /** [nb] passages neufs de [N] mots, sans rien de [deja]. */
  const nouveaux = (nb, deja) => Array.from({ length: nb }, () => piocherDessins(r, N, deja, profil)).filter((p) => p.length);
  const plusDeMots = () => annonce("Plus assez de mots à tirer : ajoutez-en à la main (deuxième ligne).");
  /** Le 🎲 du haut : tous les passages de toutes les équipes, tirés à nouveau. */
  const tirerTout = async () => {
    const avant = tours.reduce((t, ps) => t + ps.length, 0);
    if (avant && !(await confirmer(`Tirer de nouveaux mots pour toutes les équipes ? Les ${plural(avant, "passage")} déjà prêts seront remplacés.`, { ok: "Tirer à nouveau", annuler: "Garder" }))) return;
    const deja = new Set(dessinsRetires.get(r) ?? []);
    const tous = couleurs.map(() => nouveaux(P, deja));
    if (!tous.some((ps) => ps.length)) return plusDeMots();
    r.tours = null;
    tous.forEach((ps, k) => poser(k, ps));
    if (tous.some((ps) => ps.length < P || ps.some((p) => p.length < N))) plusDeMots();
    changer();
  };
  /** Le 🎲 d'une équipe : ses passages tirés à nouveau. */
  const tirerEquipe = async (k) => {
    const avant = (tours[k] ?? []).length;
    if (avant && !(await confirmer(`Tirer de nouveaux mots pour l'équipe ${nom(k)} ? Ses ${plural(avant, "passage")} seront remplacés.`, { ok: "Tirer à nouveau", annuler: "Garder" }))) return;
    const deja = new Set([...pictoToursBruts(r).flatMap((ps, j) => (j === k ? [] : ps.flat())).filter((m) => !m.vide).flatMap(concepts), ...(dessinsRetires.get(r) ?? [])]);
    const ps = nouveaux(P, deja);
    if (!ps.length) return plusDeMots();
    poser(k, ps);
    deplies.add(k);
    changer();
  };
  const tirerUn = (k, p, i) => {
    const [m] = piocherDessins(r, 1, prises(), profil);
    if (!m) return plusDeMots();
    const ps = pictoToursBruts(r)[k].map((x) => [...x]);
    ps[p][i] = m;
    poser(k, ps);
    changer();
  };
  const retirerMot = (k, p, i) => {
    const ps = pictoToursBruts(r)[k].map((x) => [...x]);
    dessinsRetires.set(r, new Set([...(dessinsRetires.get(r) ?? []), ...concepts(ps[p][i])]));
    ps[p][i] = { vide: true };
    poser(k, ps);
    changer();
  };
  const retirerPassage = (k, p) => {
    const ps = pictoToursBruts(r)[k].filter((_, j) => j !== p);
    poser(k, ps);
    changer();
  };
  /** Deuxième ligne : des images de la Bibliothèque pour l'équipe [k], [N] par passage, à la suite de ses passages. */
  const ajouterMain = async (k) => {
    const autres = roundCtx.elsewhere?.(r) ?? new Map();
    const ici = new Map(pictoToursBruts(r).flatMap((ps, j) => ps.flat().filter((m) => !m.vide).flatMap((m) => concepts(m).map((x) => [x, `ce Pictionary (équipe ${nom(j)})`]))));
    const choisies = await choisirDansBibliotheque({
      titre: `Mots à dessiner pour l'équipe ${nom(k)} (${N} par passage)`, groupes: ["packs", "photos", "emojis", "miennes"], plusieurs: true,
      deja: (x) => { const m = imageDeDessin(x); const hit = m && concepts(m).find((y) => ici.has(y) || autres.has(y)); return hit ? ici.get(hit) ?? autres.get(hit) : null; },
    });
    const mots = choisies.map(imageDeDessin).filter(Boolean);
    if (!mots.length) return;
    const ps = [...(pictoToursBruts(r)[k] ?? [])];
    const place = Math.max(0, PICTO_PASSAGES_MAX - ps.length);
    const neufs = [];
    for (let i = 0; i < mots.length && neufs.length < place; i += N) neufs.push(mots.slice(i, i + N));
    poser(k, [...ps, ...neufs]);
    deplies.add(k);
    annonce(neufs.length
      ? `${plural(neufs.length, "passage ajouté", "passages ajoutés")} à l'équipe ${nom(k)}${neufs.length * N < mots.length ? ` (${PICTO_PASSAGES_MAX} au plus par équipe)` : ""}.`
      : `${PICTO_PASSAGES_MAX} passages au plus par équipe : retirez-en avant d'en ajouter.`, neufs.length > 0);
    changer();
  };
  /** Moins ou plus de mots proposés, de passages : les passages déjà prêts suivent (le 🎲 complète, la fin part). */
  const regler = (cle, valeur) => {
    r[cle] = valeur;
    if (tire) {
      const nN = pictoPropositions(r);
      const nP = pictoPassages(r);
      const deja = prises();
      r.tours = couleurs.map((_, k) => {
        const ps = (pictoToursBruts(r)[k] ?? []).map((p) => (p.length > nN ? p.slice(0, nN) : [...p, ...piocherDessins(r, nN - p.length, deja, profil)]));
        if (cle === "passages") return ps.length > nP ? ps.slice(0, nP) : [...ps, ...Array.from({ length: nP - ps.length }, () => piocherDessins(r, nN, deja, profil)).filter((p) => p.length)];
        return ps;
      });
    }
    changer();
  };
  const choixN = h("select", {
    class: "picto-propositions", "aria-label": "Mots proposés au dessinateur", title: "Combien de mots le dessinateur voit sur sa tablette, pour en choisir un",
    onchange: (e) => regler("propositions", Number(e.target.value)),
  }, ...PICTO_PROPOSITIONS.map((k) => h("option", { value: k, selected: k === N, text: `${k} mots proposés` })));
  const choixP = h("select", {
    class: "picto-nb-passages", "aria-label": "Passages par équipe", title: "Combien de fois chaque équipe dessine",
    onchange: (e) => regler("passages", Number(e.target.value)),
  }, ...PICTO_PASSAGES.map((k) => h("option", { value: k, selected: k === P, text: `${plural(k, "passage")} par équipe` })));
  const duree = h("select", {
    class: "picto-duree", "aria-label": "Temps de dessin", title: `Temps de dessin à chaque passage (${PICTO_POINTS} points si le dessin est trouvé)`,
    onchange: (e) => { r.duration = Number(e.target.value); roundCtx.summary(); },
  }, ...PICTO_SECONDS.map((k) => h("option", { value: k, selected: k === (r.duration ?? PICTO_SEC), text: `Dessin de ${enMinutes(k)}` })));
  const ligne = h("div", { class: "tirage-ligne" }, choixN, choixP, duree,
    h("button", { type: "button", class: "btn tirage-de picto-de", text: "🎲", "aria-label": "Tirer les mots de toutes les équipes au hasard",
      title: `Tirer ${P} passage${P > 1 ? "s" : ""} de ${N} mots pour chaque équipe`, onclick: tirerTout }));
  const main = h("div", { class: "quiz-ajouts picto-main" },
    h("span", { class: "quiz-ajout-titre", text: "✋ Ajouter un passage à la main, pour l'équipe :" }),
    h("div", { class: "picto-main-equipes" }, ...couleurs.map((c, k) => h("button", {
      type: "button", class: "chip picto-main-equipe", style: `--c: ${c}`, "data-couleur": nomCouleur(c),
      title: `Choisir des images dans la Bibliothèque pour l'équipe ${nomCouleur(c)} (${N} par passage)`, onclick: () => ajouterMain(k),
    }, h("span", { class: "rond" }), nomCouleur(c)))));
  const passages = tours.reduce((t, ps) => t + ps.length, 0);
  const mots = tours.flat(2).filter((m) => !m.vide).length;
  const manque = tours.flat(2).filter((m) => m.vide).length;
  const compteur = h("p", { class: "quiz-compteur", "aria-live": "polite",
    text: tire ? `${plural(n, "équipe")} · ${plural(passages, "passage")} · ${plural(mots, "mot")}${manque ? ` · ${manque} à tirer` : ""}` : "Aucun mot pour l'instant : touchez 🎲" });
  const autres = roundCtx.elsewhere?.(r) ?? new Map();
  const ailleurs = (m) => { const k = concepts(m).find((x) => autres.has(x)); return k ? autres.get(k) : null; };
  const motCase = (k, p, i, m) => (m.vide
    ? h("li", { class: "picto-mot vide" }, h("button", {
      type: "button", class: "btn tirage-de petit", text: "🎲", "aria-label": `Tirer un autre mot pour l'équipe ${nom(k)}`,
      title: "Tirer un autre mot", onclick: () => tirerUn(k, p, i),
    }))
    : h("li", { class: `picto-mot${ailleurs(m) ? " deja" : ""}`, title: ailleurs(m) ? `Déjà utilisé dans ${ailleurs(m)}` : m.word, "data-mot": m.word.toLowerCase() },
      // L'émoji, celui de la tablette ; la vraie photo, celle de la TV quand le dessin est trouvé.
      m.image ? h("span", { class: "picto-emoji", text: m.image }) : null,
      imageRecadrable(apercuPhoto(m), r, m, changer),
      h("span", { class: "picto-nom", text: m.word }),
      h("button", { type: "button", class: "icon tirage-retirer", text: "✕", "aria-label": `Retirer « ${m.word} »`, title: "Retirer ce mot (un 🎲 prend sa place)", onclick: () => retirerMot(k, p, i) })));
  const lignes = couleurs.map((couleur, k) => {
    const ps = tours[k] ?? [];
    const ouverte = deplies.has(k) && ps.length > 0;
    const nbDeja = reels(k).flat().filter(ailleurs).length;
    return h("section", { class: `mime-equipe picto-equipe${ouverte ? " ouverte" : ""}`, style: `--c: ${couleur}`, "data-couleur": nomCouleur(couleur) },
      h("div", { class: "mime-equipe-tete" },
        h("button", {
          type: "button", class: "mime-deplier", "aria-expanded": ouverte ? "true" : "false", disabled: !ps.length,
          title: ps.length ? (ouverte ? "Replier les passages" : "Voir les passages de l'équipe") : "Aucun passage : touchez 🎲",
          onclick: () => { if (deplies.has(k)) deplies.delete(k); else deplies.add(k); changer(); },
        }, h("span", { class: "fleche", text: ouverte ? "▾" : "▸" }), h("span", { class: "rond" }), h("b", { text: `Équipe ${nomCouleur(couleur)}` })),
        h("span", { class: "small hint picto-nombre", text: ps.length ? plural(ps.length, "passage") : "Aucun passage" }),
        nbDeja ? h("span", { class: "mime-deja", text: `⚠ ${nbDeja} déjà dans un autre jeu` }) : null,
        h("button", {
          type: "button", class: "btn tirage-de", text: "🎲", "aria-label": `Tirer les mots de l'équipe ${nomCouleur(couleur)} au hasard`,
          title: `Tirer ${P} passage${P > 1 ? "s" : ""} de ${N} mots pour l'équipe ${nomCouleur(couleur)}`, onclick: () => tirerEquipe(k),
        })),
      ouverte ? h("ol", { class: "picto-passages" }, ...ps.map((p, j) => h("li", { class: "picto-passage" },
        h("span", { class: "picto-passage-num", text: `${j + 1}` }),
        h("ul", { class: "picto-mots" }, ...p.map((m, i) => motCase(k, j, i, m))),
        h("button", { type: "button", class: "icon picto-passage-retirer", text: "✕", "aria-label": `Retirer le passage ${j + 1} de l'équipe ${nomCouleur(couleur)}`, title: "Retirer ce passage", onclick: () => retirerPassage(k, j) })))) : null);
  });
  // Un Pictionary préparé avant (mots ou séries choisis) : il se joue encore tel quel.
  const ancienne = !tire && (roundPicks(r).length || pictoRoundSeries(r))
    ? h("p", { class: "small hint mime-ancienne", text: `Pictionary préparé à l'ancienne : ${mancheSummary(r, {})}, joué tel quel. Le 🎲 le remplace par des mots pour chaque équipe.` })
    : null;
  return [
    compteur,
    h("div", { class: "quiz-outils" }, ligne, main),
    ancienne,
    h("div", { class: "mime-equipes picto-equipes" }, ...lignes),
  ].filter(Boolean);
}

/** Chansons retirées (✕) d'un blind test pendant la saisie : le 🎲 de leur case ne les redonne pas. */
const chansonsRetirees = new WeakMap();
/** Blind tests dont la liste des chansons est dépliée (comme les séries du Quiz). */
const blindsDeplies = new WeakSet();
/** Chanson de chaque blind test dont le petit menu (écouter, régler) est ouvert : un seul à la fois. */
const blindEcoute = new WeakMap();
/** Réglages d'une chanson ouverts depuis la prestation : au retour, sa liste se redessine avec les nouveaux réglages. */
let reglageDepuisPrestation = false;

/**
 * « ⏱ Régler… » une chanson depuis la prestation (cedric, 24/10) : les réglages de la chanson, ceux de Bibliothèque ›
 * Sons ; « Enregistrer les réglages » ou « ← Retour » ramène à la prestation. Des modifications de la prestation pas
 * encore enregistrées : elle l'est d'abord (sinon elles seraient perdues).
 */
async function reglerDepuisPrestation(x) {
  if (histPrestation.modifie) {
    const ok = await confirmer("Pour régler cette chanson, la prestation est d'abord enregistrée (sinon ses modifications seraient perdues).", { ok: "Enregistrer et régler", annuler: "Rester" });
    if (!ok || !(await enregistrerPrestation())) return;
  }
  reglageDepuisPrestation = true;
  editSongs([x]);
  if (ecranAffiche() !== "playlist-edit") reglageDepuisPrestation = false;
}

/**
 * Petit menu d'une chanson du blind test (cedric, 24/10 : vérifier que l'extrait et le hook sont bien placés, sans
 * charger la page) : écouter l'extrait du buzz depuis son début, écouter le refrain de la révélation, avec les paroles
 * qui défilent, et « ⏱ Régler… » pour les déplacer.
 */
function menuChanson(id) {
  const x = songList(songs, {}, isStatuesList).find((s) => s.id === id);
  if (!x) return null;
  const paroles = () => parolesFlottantes(x, "show-rounds");
  const refrain = Number.isFinite(x.refrain) ? ` · ${mmss(x.refrain)}` : "";
  return h("div", { class: "blind-reglage" },
    boutonEcoute({ class: "btn secondary blind-extrait", title: "Écouter l'extrait joué pendant la chanson à trouver, depuis son début", text: `▶ Extrait · ${mmss(x.start ?? 0)}` },
      (b) => listen(x, false, b, paroles)),
    boutonEcoute({
      class: "btn secondary blind-refrain", disabled: !x.refrainId, text: `▶ Refrain${refrain}`,
      title: x.refrainId ? `Écouter le refrain de la révélation (« on chante tous ensemble »), ${x.auto ? "trouvé automatiquement" : "réglé à la main"}` : "Pas encore de refrain : touchez « ⏱ Régler… »",
    }, (b) => listen(x, true, b, paroles)),
    h("span", { class: "hint small blind-hook", text: x.refrainId ? (x.auto ? "Refrain trouvé automatiquement" : "Refrain réglé à la main") : "Refrain pas encore réglé" }),
    h("button", { type: "button", class: "btn blind-regler", title: "Déplacer le début de l'extrait ou le refrain, comme dans Bibliothèque › Sons", text: "⏱ Régler…", onclick: () => reglerDepuisPrestation(x) }));
}

/**
 * « Jamais deux fois » pour les chansons : celles des autres jeux musicaux de la prestation (blind test, quiz musical,
 * statues), par identifiant de chanson et par extrait → nom du jeu.
 */
function chansonsAilleurs(r) {
  // Carte du téléphone : les chansons déjà au programme de la partie.
  const out = roundCtx.chansons?.() ?? new Map();
  (editing?.rounds ?? []).forEach((x) => {
    if (!x || x === r) return;
    const nom = ROUND_TYPES[x.type ?? "quiz"] ?? "une autre manche";
    const noter = (k) => { if (k && !out.has(k)) out.set(k, nom); };
    chansonsDe(x).forEach((id) => { noter(id); noter(songs[id]?.audioId); });
    if (MUSIC_GAMES[x.type]) {
      roundTracks(x).forEach(noter);
      if (x.playlistId) playableTracks(playlists[x.playlistId]).forEach((t) => noter(t.audioId));
    }
    if (x.type === "statues") (Array.isArray(x.songs) ? x.songs : []).forEach(noter);
  });
  return out;
}

/** Paroles d'une chanson sur la TV (karaoké de la révélation) : il faut le fichier .lrc et l'extrait du refrain. */
const parolesSurTv = (song) => !!(song && /^[0-9a-f]{16}$/.test(song.refrainId ?? "") && typeof song.paroles === "string" && song.paroles);

/**
 * Pioche [n] chansons de la bibliothèque des sons pour le blind test [r], jamais une de [prises] (déjà dans la manche ou
 * retirées) : d'abord celles qu'aucun autre jeu de la prestation ne joue, et parmi elles celles qui ont leur pochette et
 * leurs paroles (la plus belle révélation).
 */
function piocherChansons(r, n, prises) {
  if (n <= 0) return [];
  const ailleurs = chansonsAilleurs(r);
  const toutes = Object.entries(songs ?? {}).filter(([id, x]) => chansonJouable(x) && !prises.has(id)).map(([id, x]) => ({ id, ...x }));
  const neuve = (x) => !ailleurs.has(x.id) && !ailleurs.has(x.audioId);
  const complete = (x) => /^[0-9a-f]{16}$/.test(x.imageId ?? "") && parolesSurTv(x);
  return [
    ...shuffle(toutes.filter((x) => neuve(x) && complete(x))),
    ...shuffle(toutes.filter((x) => neuve(x) && !complete(x))),
    ...shuffle(toutes.filter((x) => !neuve(x))),
  ].slice(0, n).map((x) => x.id);
}

/** Mini pochette d'une chanson (cedric, 24/10 : « la certitude que la pochette est présente ») ; 💿 barré si elle manque. */
function miniPochette(song) {
  if (!/^[0-9a-f]{16}$/.test(song?.imageId ?? "")) {
    return h("span", { class: "blind-pochette sans", role: "img", "aria-label": "Pas de pochette", title: "Pas de pochette : ajoutez-la dans Bibliothèque › Sons", text: "💿" });
  }
  const id = song.imageId;
  const img = h("img", { class: "blind-pochette", alt: "Pochette", title: "Pochette présente" });
  if (imageCache[id]) img.src = imageCache[id];
  else get(ref(db, `library/images/${id}`)).then((snap) => { if (typeof snap.val() === "string") { imageCache[id] = snap.val(); img.src = snap.val(); } }).catch(() => {});
  return img;
}

/**
 * Fenêtre « 🎵 Bibliothèque des sons » (cedric, 24/10) : choisir des chansons à la main pour un blind test. Recherche à
 * chaque lettre (titre, artiste ; ce qui commence par le mot d'abord), filtre « avec paroles ». [plusieurs] : un clic
 * coche ou décoche, [cochees] le sont au départ, « ✓ Valider la sélection » rend les chansons cochées (celles d'avant
 * dans leur ordre, puis les nouvelles dans l'ordre des clics) ; sinon un clic choisit une chanson. [prises] : déjà dans
 * ce blind test (non choisissables une à une) ; [deja] : le jeu où une chanson sert déjà (en rouge, permis).
 * Rend la liste (ou l'identifiant) choisie, ou null (Annuler, Échap).
 */
function choisirChansons({ titre, plusieurs = false, cochees = [], prises = new Set(), deja = () => null }) {
  return new Promise((resolve) => {
    const toutes = Object.entries(songs ?? {}).filter(([, x]) => chansonJouable(x)).map(([id, x]) => ({ id, ...x }))
      .sort((a, b) => `${a.artist ?? ""} ${a.title}`.localeCompare(`${b.artist ?? ""} ${b.title}`, "fr", { sensitivity: "base" }));
    const choisies = new Set(cochees.filter((id) => chansonJouable(songs[id])));
    const ordre = [...choisies];
    let filtre = null;
    const champ = h("input", { type: "search", class: "choix-recherche", placeholder: "Rechercher : titre, artiste…", "aria-label": "Rechercher une chanson", autocomplete: "off" });
    const puces = h("div", { class: "chips media-cats" });
    const liste = h("ul", { class: "choix-chansons" });
    const valider = h("button", { type: "button", class: "btn choix-valider", onclick: () => fermer(ordre.filter((id) => choisies.has(id))) });
    const fermer = (x) => { stopPreview(); voile.remove(); resolve(x); };
    const majValider = () => {
      valider.textContent = `✓ Valider la sélection (${choisies.size})`;
    };
    const dessiner = () => {
      const q = champ.value.trim();
      const trouvees = parPertinence(toutes.filter((x) => contientTout([x.title, x.artist], q)), q, (x) => x.title, (x) => [x.artist]);
      const avecParoles = trouvees.filter(parolesSurTv);
      puces.replaceChildren(...[[null, "Toutes", trouvees.length], ["paroles", "✓ Avec paroles", avecParoles.length], ...(plusieurs ? [["cochees", "☑ Cochées", trouvees.filter((x) => choisies.has(x.id)).length]] : [])]
        .map(([k, label, n]) => h("button", { type: "button", class: `chip${filtre === k ? " active" : ""}`, "data-filtre": k ?? "toutes", text: `${label} (${n})`, onclick: () => { filtre = k; dessiner(); } })));
      const montrees = filtre === "paroles" ? avecParoles : filtre === "cochees" ? trouvees.filter((x) => choisies.has(x.id)) : trouvees;
      liste.replaceChildren(...montrees.map((x) => {
        const ou = deja(x.id) ?? deja(x.audioId);
        // Déjà dans ce blind test (une autre série, en sélection : pas cochée ici) : pas choisissable.
        const ici = prises.has(x.id) && !choisies.has(x.id);
        const paroles = parolesSurTv(x);
        const ligne = h("li", {}, h("button", {
          type: "button", class: `choix-chanson${choisies.has(x.id) ? " cochee" : ""}${ou ? " deja" : ""}`, "data-chanson": x.id, disabled: ici,
          title: ici ? "Déjà dans ce blind test" : ou ? `Déjà dans ${ou}` : "",
          ...(plusieurs ? { "aria-pressed": choisies.has(x.id) ? "true" : "false" } : {}),
          onclick: (e) => {
            if (!plusieurs) return fermer(x.id);
            if (choisies.has(x.id)) choisies.delete(x.id);
            else { choisies.add(x.id); if (!ordre.includes(x.id)) ordre.push(x.id); }
            e.currentTarget.classList.toggle("cochee", choisies.has(x.id));
            e.currentTarget.setAttribute("aria-pressed", choisies.has(x.id) ? "true" : "false");
            majValider();
          },
        },
        plusieurs ? h("span", { class: "case", "aria-hidden": "true" }) : null,
        miniPochette(x),
        h("span", { class: "choix-chanson-titre" }, h("b", { text: x.title.trim() }), x.artist?.trim() ? h("span", { class: "hint", text: ` · ${x.artist.trim()}` }) : null),
        ou ? h("span", { class: "choix-chanson-deja", text: `Déjà dans ${ou}` }) : ici ? h("span", { class: "hint small", text: "Déjà dans ce blind test" }) : null,
        h("span", { class: `blind-paroles${paroles ? " ok" : " non"}`, text: paroles ? "✓ Paroles" : "✗ Pas de paroles" })));
        return ligne;
      }));
      if (!montrees.length) liste.append(h("li", { class: "hint", text: toutes.length ? "Aucune chanson pour cette recherche : essayez un autre mot." : "Aucune chanson dans la bibliothèque des sons : ajoutez-en d'abord (Bibliothèque › Sons)." }));
    };
    champ.oninput = dessiner;
    majValider();
    const voile = h("div", {
      class: "cadre-voile choix-voile", onclick: (e) => { if (e.target === voile) fermer(null); },
      onkeydown: (e) => { if (e.key === "Escape") fermer(null); },
    }, h("div", { class: "cadre-boite choix-boite choix-sons", role: "dialog", "aria-label": titre },
      h("p", { class: "label", text: `🎵 ${titre}` }),
      h("p", { class: "hint small", text: plusieurs
        ? "Cherchez par titre ou artiste ; un clic coche ou décoche la chanson ; puis « ✓ Valider la sélection »."
        : "Cherchez par titre ou artiste ; un clic choisit la chanson." }),
      champ, puces, liste,
      h("div", { class: "row" }, h("button", { type: "button", class: "btn secondary", text: "Annuler", onclick: () => fermer(null) }), plusieurs ? valider : null)));
    document.body.append(voile);
    dessiner();
    champ.focus();
  });
}

/** Série du 🎲 d'un blind test, ou null. */
const serieDuDeBlind = (r) => r.seriesBlind.find((x) => x.origine === "de") ?? null;

/** Chansons d'une playlist de la bibliothèque (cedric, 24/10) : celles qui sont encore dans la bibliothèque des sons. */
function chansonsDePlaylist(p) {
  const parExtrait = new Map(Object.entries(songs ?? {}).filter(([, x]) => chansonJouable(x)).map(([id, x]) => [x.audioId, id]));
  const pistes = Array.isArray(p?.tracks) ? p.tracks : Object.values(p?.tracks ?? {});
  return [...new Set(playableTracks({ tracks: pistes }).map((t) => (t.songId && chansonJouable(songs?.[t.songId]) ? t.songId : parExtrait.get(t.audioId))).filter(Boolean))];
}

/** Mauvaises réponses enlevées d'un ✕ pendant l'écran (par manche, puis par chanson) : le ✕ suivant ne les repropose pas. */
const leurresEnleves = new WeakMap();

/**
 * Les 3 mauvaises réponses d'une chanson du Quiz musical (cedric, 24/10) : des mots de son refrain qui pourraient passer
 * pour le titre, proposés d'après le hook réglé et le fichier .lrc. Chacune se modifie en tapant ; ✕ l'enlève et la
 * proposition suivante du refrain prend sa place (plus rien à proposer : la case reste vide, un autre titre est tiré au
 * hasard). Rangées dans la manche (`leurres`, par chanson) ; la bibliothèque des sons ne change pas.
 */
function leurresChanson(r, id, song) {
  const titre = song.title.trim();
  const fixes = () => {
    const x = r.leurres?.[id];
    const liste = Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : null;
    return liste && Array.from({ length: 3 }, (_, k) => (typeof liste[k] === "string" ? liste[k] : ""));
  };
  const actuels = () => fixes() ?? [...leurresDeChanson(song), "", "", ""].slice(0, 3);
  const ranger = (liste) => {
    r.leurres = { ...(r.leurres && typeof r.leurres === "object" ? r.leurres : {}), [id]: liste.map((x) => x.trim().slice(0, LEURRE_MAX)) };
    roundCtx.summary();
    noterEcran();
  };
  const enleves = () => {
    if (!leurresEnleves.has(r)) leurresEnleves.set(r, new Map());
    const m = leurresEnleves.get(r);
    if (!m.has(id)) m.set(id, new Set());
    return m.get(id);
  };
  const propositions = () => propositionsDeTitre(parolesDuHook(song), titre);
  const sansParoles = !propositions().length;
  const cases = actuels().map((valeur, k) => {
    const champ = h("input", {
      type: "text", class: "leurre-texte", value: valeur, maxlength: String(LEURRE_MAX), placeholder: "Un autre titre au hasard",
      "aria-label": `Mauvaise réponse ${k + 1} pour « ${titre} »`,
      oninput: (e) => {
        const liste = actuels();
        liste[k] = e.target.value;
        ranger(liste);
      },
    });
    const enlever = h("button", {
      type: "button", class: "icon leurre-retirer", text: "✕", "aria-label": `Enlever la mauvaise réponse ${k + 1} de « ${titre} »`,
      title: "Enlever cette mauvaise réponse : la proposition suivante du refrain prend sa place",
      onclick: () => {
        const liste = actuels();
        if (liste[k].trim()) enleves().add(cle(liste[k]));
        const pris = new Set([cle(titre), ...liste.filter((x, j) => j !== k && x.trim()).map(cle), ...enleves()]);
        liste[k] = propositions().find((x) => !pris.has(cle(x))) ?? "";
        ranger(liste);
        roundCtx.refresh();
      },
    });
    return h("span", { class: "leurre" }, champ, enlever);
  });
  return h("div", { class: "leurres", "data-chanson": id },
    h("span", { class: "leurres-titre", text: "Mauvaises réponses :", title: "Les 3 réponses proposées à côté du vrai titre sur les pupitres, tirées du refrain de la chanson" }),
    ...cases,
    sansParoles ? h("span", { class: "small hint leurres-aide", text: "Pas de paroles du refrain : tapez vos mauvaises réponses, sinon d'autres titres sont tirés au hasard." }) : null);
}

/** Séries d'un blind test dépliées, et ses « Blind test complet » dépliés (le temps de l'écran). */
const blindsCompletsDeplies = new WeakSet();

/**
 * Blind test dans une prestation (cedric, 24/10) : « exactement comme le Quiz », sans manches.
 * - En haut, le compteur de tout le blind test (dans une prestation : sur la ligne du numéro du jeu).
 * - Les outils de création, ensemble : le nombre de chansons et le 🎲 qui les tire dans la bibliothèque des sons ;
 *   « 🎵 Sélectionner mes chansons » (à la main, cases à cocher) ; « 🎶 Ajouter une playlist » (une de ses playlists,
 *   cherchée par son nom, ajoutée en entier).
 * - Les séries : chacune se déplie, monte ou descend (↑ ↓) et s'enlève (✕). Chaque chanson : sa mini pochette, ses
 *   paroles, 🎧 (écouter l'extrait et le refrain, « ⏱ Régler… ») et ✕ (au 🎲 : un 🎲 prend sa place ; ailleurs elle
 *   part). « ＋ Une chanson » dans une playlist ajoutée.
 * - En dernière ligne, le « Blind test complet » : toutes les chansons dans l'ordre de passage, chacune monte, descend
 *   ou s'enlève, et 🔀 mélange tout.
 * Un blind test préparé avant (une playlist entière, des extraits choisis) se joue encore tel quel.
 */
function mancheBlind(r) {
  versSeriesBlind(r);
  // Le Quiz musical aussi (cedric, 24/10 : « à la manière de tout ce qu'on a déjà fait ») : le 🎲, une playlist, le
  // récapitulatif ; sous chaque chanson, ses 3 mauvaises réponses tirées du refrain (leurresChanson).
  const musical = r.type === "musical";
  const jeu = musical ? "quiz musical" : "blind test";
  const series = r.seriesBlind;
  const deSerie = serieDuDeBlind(r);
  const n = deSerie?.chansons.length || (BLIND_NOMBRES.includes(r.nbChansons) ? r.nbChansons : BLIND_NOMBRE_DEFAUT);
  const changer = () => roundCtx.refresh();
  const pluriel = (k, mot) => `${k} ${mot}${k > 1 ? "s" : ""}`;
  /** Après chaque changement : les séries vides partent, la liste jouée suit (lue aussi par les pages d'avant). */
  const ranger = () => {
    r.seriesBlind = r.seriesBlind.filter((x) => x.chansons.length);
    r.chansons = r.seriesBlind.length ? chansonsBrutes(r) : [];
    // L'ancienne façon de préparer la manche (une playlist, des extraits choisis) laisse la place.
    if (r.seriesBlind.length) { r.playlistId = ""; r.tracks = null; r.byItem = null; }
  };
  const dansLeBlind = (sauf = null) => new Set(r.seriesBlind.filter((x) => x !== sauf).flatMap((x) => x.chansons).filter(Boolean));
  const ecartees = () => new Set([...dansLeBlind(), ...(chansonsRetirees.get(r) ?? [])]);
  const ecarter = (id) => chansonsRetirees.set(r, new Set([...(chansonsRetirees.get(r) ?? []), id]));
  const place = (k) => Math.max(0, Math.min(k, MAX_CHANSONS_BLIND - chansonsBrutes(r).length));

  // Première ligne : le nombre et le 🎲 (il remplace la série du 🎲 ; les autres séries ne bougent pas).
  const tirerTout = (k) => {
    chansonsRetirees.delete(r);
    const sans = dansLeBlind(deSerie);
    const ids = piocherChansons(r, Math.min(k, MAX_CHANSONS_BLIND - sans.size), sans);
    if (!ids.length) return annonce("Aucune chanson dans la bibliothèque des sons : ajoutez-en d'abord (Bibliothèque › Sons).");
    const serie = deSerie ?? { id: "de", origine: "de", chansons: [] };
    if (!deSerie) r.seriesBlind.unshift(serie);
    serie.chansons = ids;
    r.nbChansons = k;
    blindsDeplies.add(serie);
    ranger();
    changer();
  };
  const nombre = h("select", {
    class: "tirage-nombre blind-nombre", "aria-label": "Nombre de chansons à tirer au hasard",
    onchange: (e) => {
      const k = Number(e.target.value);
      r.nbChansons = k;
      // Moins de chansons : les premières restent ; plus : le 🎲 complète sa série.
      if (deSerie) {
        const gardees = deSerie.chansons.slice(0, k);
        deSerie.chansons = [...gardees, ...piocherChansons(r, place(k - gardees.length + (deSerie.chansons.length - gardees.length)), new Set([...ecartees(), ...gardees]))].slice(0, k);
        ranger();
      }
      changer();
    },
  }, ...[...new Set([...BLIND_NOMBRES, n])].sort((a, b) => a - b).map((k) => h("option", { value: k, selected: k === n, text: `${k} chansons au hasard` })));
  const de = h("button", {
    type: "button", class: "btn tirage-de", text: "🎲", "aria-label": "Tirer les chansons au hasard",
    title: "Tirer les chansons au hasard dans la bibliothèque des sons (les autres séries ne bougent pas)", onclick: () => tirerTout(Number(nombre.value)),
  });

  // Deuxième ligne : « 🎵 Sélectionner mes chansons » (cedric, 24/10) : la bibliothèque des sons, cases à cocher ; elles
  // forment la série « choisies à la main » (décochées, elles en partent ; les nouvelles à la fin, dans l'ordre des clics).
  const choix = r.seriesBlind.find((x) => x.origine === "choix") ?? null;
  const selectionner = async () => {
    const avant = choix?.chansons.filter(Boolean) ?? [];
    const ids = await choisirChansons({ titre: "Sélectionner mes chansons", plusieurs: true, cochees: avant, prises: dansLeBlind(choix), deja: (k) => chansonsAilleurs(r).get(k) ?? null });
    if (!ids) return;
    const liste = [...avant.filter((id) => ids.includes(id)), ...ids.filter((id) => !avant.includes(id))];
    const garde = Math.max(0, MAX_CHANSONS_BLIND - dansLeBlind(choix).size - (deSerie?.chansons.filter((id) => !id).length ?? 0));
    if (liste.length > garde) annonce(`${MAX_CHANSONS_BLIND} chansons au plus dans un ${jeu} : les dernières ne sont pas ajoutées.`);
    const serie = choix ?? { id: nouvelId("c"), origine: "choix", chansons: [] };
    if (!choix) r.seriesBlind.push(serie);
    serie.chansons = liste.slice(0, garde);
    blindsDeplies.add(serie);
    ranger();
    changer();
  };
  const nChoisies = choix?.chansons.filter(Boolean).length ?? 0;
  const aLaMain = h("div", { class: "tirage-ligne blind-manuel" },
    h("button", { type: "button", class: "btn secondary blind-selectionner", text: "🎵 Sélectionner mes chansons", title: "Choisir les chansons à la main dans la bibliothèque des sons", onclick: selectionner }),
    h("span", { class: "small hint blind-selection", text: nChoisies ? `${pluriel(nChoisies, "chanson")} sélectionnée${nChoisies > 1 ? "s" : ""}` : "Aucune chanson sélectionnée" }));

  // Troisième ligne (à la place de la note, cedric 24/10) : « 🎶 Ajouter une playlist » : une de ses playlists de la
  // bibliothèque, cherchée par son nom ; ses chansons forment une série à la fin (celles déjà dans le blind test n'y
  // reviennent pas). La playlist de la bibliothèque ne change pas.
  const dejaLa = new Set(r.seriesBlind.filter((x) => x.origine === "playlist").map((x) => x.playlistId));
  const listes = Object.entries(playlists ?? {})
    .filter(([, p]) => p?.title && !isStatuesList(p))
    .map(([id, p]) => [id, p, chansonsDePlaylist(p)])
    .filter(([, , ids]) => ids.length)
    .sort(([, a], [, b]) => a.title.localeCompare(b.title, "fr"))
    .map(([id, p, ids]) => ({ id, titre: p.title, ids, details: [pluriel(ids.length, "chanson"), dejaLa.has(id) ? `✓ déjà dans ce ${jeu}` : ""].filter(Boolean).join(" · "),
      noms: [p.title], autres: ids.slice(0, 40).flatMap((k) => [songs[k]?.title, songs[k]?.artist]) }));
  const ajoutPlaylist = ligneAjoutQuiz({
    classe: "blind-playlist", titre: "🎶 Ajouter une playlist", label: "Chercher une de vos playlists",
    placeholder: "Nom d'une de vos playlists", vide: "Pas encore de playlist : créez-en dans Bibliothèque › Sons",
    aucun: "Aucune playlist ne correspond.", items: listes, attr: (x) => ({ "data-playlist": x.id }),
    choisir: (x) => {
      const deja = dansLeBlind();
      const neuves = x.ids.filter((id) => !deja.has(id));
      const k = place(neuves.length);
      if (!neuves.length) return annonce(`Les chansons de « ${x.titre} » sont déjà toutes dans ce ${jeu}.`);
      const serie = { id: nouvelId("p"), origine: "playlist", playlistId: x.id, titre: x.titre, chansons: neuves.slice(0, k) };
      if (!serie.chansons.length) return annonce(`${MAX_CHANSONS_BLIND} chansons au plus dans un ${jeu} : retirez-en avant d'ajouter « ${x.titre} ».`);
      r.seriesBlind.push(serie);
      blindsDeplies.add(serie);
      ranger();
      const pasLa = x.ids.length - serie.chansons.length;
      if (pasLa) annonce(`« ${x.titre} » ajoutée : ${pluriel(serie.chansons.length, "chanson")}${neuves.length > k ? ` (${MAX_CHANSONS_BLIND} au plus dans un ${jeu})` : ""}${x.ids.length > neuves.length ? `, ${x.ids.length - neuves.length} déjà dans ce ${jeu}` : ""}.`, true);
      changer();
    },
  });

  // Les séries : la ligne de chaque chanson.
  const autres = chansonsAilleurs(r);
  const ligneChanson = (serie, id, i) => {
    const auDe = serie.origine === "de";
    if (!id) {
      return h("li", { class: "tirage-q vide blind-chanson" }, h("div", { class: "tirage-q-ligne" },
        h("button", { type: "button", class: "btn tirage-de petit", text: "🎲", "aria-label": "Tirer une autre chanson", title: "Tirer une autre chanson", onclick: () => {
          const [neuve] = piocherChansons(r, 1, ecartees());
          if (!neuve) return annonce("Plus de chanson à tirer dans la bibliothèque des sons.");
          serie.chansons[i] = neuve;
          ranger();
          changer();
        } }),
        h("button", { type: "button", class: "btn small secondary blind-choisir", text: "🎵 Choisir…", "aria-label": "Choisir la chanson dans la bibliothèque des sons", title: "Choisir la chanson dans la bibliothèque des sons", onclick: async () => {
          const choisie = await choisirChansons({ titre: `Choisir une chanson pour le ${jeu}`, prises: dansLeBlind(), deja: (k) => chansonsAilleurs(r).get(k) ?? null });
          if (!choisie) return;
          serie.chansons[i] = choisie;
          ranger();
          changer();
        } })));
    }
    // ✕ : au 🎲, un 🎲 prend sa place ; dans une playlist ou les chansons choisies, elle part.
    const retirer = () => {
      ecarter(id);
      if (auDe) serie.chansons[i] = "";
      else serie.chansons.splice(i, 1);
      ranger();
      changer();
      noterEcran();
    };
    const titreRetirer = auDe ? "Retirer cette chanson (un 🎲 prend sa place)" : `Retirer cette chanson du ${jeu}`;
    const song = songs[id];
    if (!chansonJouable(song)) {
      return h("li", { class: "tirage-q blind-chanson manquante" }, h("div", { class: "tirage-q-ligne" },
        h("span", { class: "blind-pochette sans", text: "💿" }),
        h("span", { class: "tirage-texte", text: "Chanson supprimée de la bibliothèque" }),
        h("button", { type: "button", class: "icon tirage-retirer", text: "✕", "aria-label": "Retirer cette chanson", title: titreRetirer, onclick: retirer })));
    }
    const deja = autres.get(id) ?? autres.get(song.audioId);
    const ouvert = blindEcoute.get(r) === id;
    return h("li", { class: `tirage-q blind-chanson${deja ? " deja" : ""}${ouvert ? " ouverte" : ""}`, "data-chanson": id, ...(deja ? { title: `Déjà dans ${deja}` } : {}) },
      h("div", { class: "tirage-q-ligne" },
        miniPochette(song),
        h("span", { class: "tirage-texte blind-titre" }, h("b", { text: song.title.trim() }), song.artist?.trim() ? h("span", { class: "hint", text: ` · ${song.artist.trim()}` }) : null),
        pastilleParoles(song),
        boutonCasque(r, id, song, ouvert, changer),
        h("button", { type: "button", class: "icon tirage-retirer", text: "✕", "aria-label": `Retirer « ${song.title.trim()} »`, title: titreRetirer, onclick: retirer })),
      musical ? leurresChanson(r, id, song) : null,
      ouvert ? menuChanson(id) : null);
  };
  const titreSerie = (x) => {
    const k = x.chansons.filter((id) => id && chansonJouable(songs[id])).length;
    const vides = x.chansons.filter((id) => !id).length;
    if (x.origine === "de") return `🎲 ${pluriel(k, "chanson")} tirée${k > 1 ? "s" : ""} au hasard${vides ? `, ${vides} à tirer` : ""}`;
    if (x.origine === "playlist") return `🎶 Playlist « ${x.titre ?? playlists[x.playlistId]?.title ?? "sans nom"} » : ${pluriel(k, "chanson")}`;
    return `🎵 ${pluriel(k, "chanson")} choisie${k > 1 ? "s" : ""} à la main`;
  };
  const ordre = chansonsDe(r);
  const deplacerSerie = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= r.seriesBlind.length) return;
    [r.seriesBlind[i], r.seriesBlind[j]] = [r.seriesBlind[j], r.seriesBlind[i]];
    // Rangé à la main : chaque série garde l'ordre de ses chansons, les séries passent dans leur nouvel ordre.
    if (r.ordreBlind?.length) r.ordreBlind = r.seriesBlind.flatMap((y) => ordre.filter((id) => y.chansons.includes(id)));
    ranger();
    changer();
  };
  const liste = h("ol", { class: "quiz-series blind-series" }, ...r.seriesBlind.map((x, i) => {
    const corps = h("ol", { class: "tirage-liste serie-liste blind-liste" }, ...x.chansons.map((id, k) => ligneChanson(x, id, k)));
    corps.hidden = !blindsDeplies.has(x);
    const voir = h("button", {
      type: "button", class: "chip tirage-voir serie-voir blind-voir", "aria-expanded": corps.hidden ? "false" : "true", text: `${corps.hidden ? "▸" : "▾"} ${titreSerie(x)}`,
      title: "Voir ou cacher les chansons de cette série, avec leur pochette et leurs paroles",
      onclick: (e) => {
        corps.hidden = !corps.hidden;
        if (corps.hidden) blindsDeplies.delete(x); else blindsDeplies.add(x);
        e.currentTarget.textContent = `${corps.hidden ? "▸" : "▾"} ${titreSerie(x)}`;
        e.currentTarget.setAttribute("aria-expanded", corps.hidden ? "false" : "true");
      },
    });
    const manque = x.chansons.filter((id) => !id).length;
    const enlever = async () => {
      const k = x.chansons.filter(Boolean).length;
      if (k && !(await confirmer(`Enlever cette série (${pluriel(k, "chanson")}) du ${jeu} ?${x.origine === "playlist" ? " La playlist reste dans la bibliothèque." : ""}`, { ok: "Enlever", danger: true }))) return;
      r.seriesBlind = r.seriesBlind.filter((y) => y !== x);
      ranger();
      changer();
      noterEcran();
    };
    return h("li", { class: "serie blind-serie", "data-origine": x.origine },
      h("div", { class: "serie-tete" },
        voir,
        manque ? h("button", { type: "button", class: "chip blind-completer", text: `🎲 Tirer ${manque > 1 ? `les ${manque} chansons` : "la chanson"} qui manque${manque > 1 ? "nt" : ""}`, onclick: () => {
          const nouvelles = piocherChansons(r, manque, ecartees());
          x.chansons = x.chansons.map((id) => id || nouvelles.shift() || "");
          ranger();
          changer();
        } }) : null,
        x.origine === "playlist" ? h("button", { type: "button", class: "chip blind-plus", text: "＋ Une chanson", title: "Ajouter une chanson de la bibliothèque des sons à cette série", onclick: async () => {
          if (!place(1)) return annonce(`${MAX_CHANSONS_BLIND} chansons au plus dans un ${jeu}.`);
          const choisie = await choisirChansons({ titre: `Ajouter une chanson au ${jeu}`, prises: dansLeBlind(), deja: (k) => chansonsAilleurs(r).get(k) ?? null });
          if (!choisie) return;
          x.chansons.push(choisie);
          blindsDeplies.add(x);
          ranger();
          changer();
        } }) : null,
        h("button", { type: "button", class: "icon serie-monter", text: "↑", title: "Passer cette série plus tôt", "aria-label": "Monter cette série", disabled: i === 0, onclick: () => deplacerSerie(i, -1) }),
        h("button", { type: "button", class: "icon serie-descendre", text: "↓", title: "Passer cette série plus tard", "aria-label": "Descendre cette série", disabled: i === r.seriesBlind.length - 1, onclick: () => deplacerSerie(i, 1) }),
        h("button", { type: "button", class: "icon serie-enlever", text: "✕", title: `Enlever cette série du ${jeu}`, "aria-label": "Enlever cette série", onclick: enlever })),
      corps);
  }));

  const presentes = ordre.filter((id) => chansonJouable(songs[id]));
  const aTirer = chansonsBrutes(r).filter((id) => !id).length;
  const compteur = h("p", { class: "quiz-compteur", "aria-live": "polite",
    text: presentes.length || aTirer ? `${pluriel(presentes.length, "chanson")} à trouver${aTirer ? ` · ${aTirer} à tirer` : ""}`
      : "Aucune chanson pour l'instant : touchez 🎲, « Sélectionner mes chansons » ou ajoutez une playlist" });
  // Une manche préparée avant (une playlist entière, des extraits choisis) : elle se joue encore telle quelle.
  const ancienne = !r.seriesBlind.length && (r.playlistId || roundTracks(r).length)
    ? h("p", { class: "small hint blind-ancienne", text: `${musical ? "Quiz musical" : "Blind test"} préparé à l'ancienne : ${mancheSummary(r, { playlists })}, joué tel quel. Le 🎲${musical ? "" : ", vos chansons"} ou une playlist le remplacent.` })
    : null;
  return [
    compteur,
    h("div", { class: "quiz-outils" }, h("div", { class: "tirage-ligne" }, nombre, de), aLaMain, ajoutPlaylist),
    ancienne,
    r.seriesBlind.length ? liste : null,
    blindComplet(r, presentes, ranger, changer),
  ].filter(Boolean);
}

/** [liste] avec l'élément de la place [k] passé à la place [j]. */
const deplaceEn = (liste, k, j) => {
  const l = [...liste];
  l.splice(j, 0, ...l.splice(k, 1));
  return l;
};

/**
 * Glisser une ligne d'une liste « … complet » à la souris, plus haut ou plus bas (cedric, 26/10 : « tous les écrans de
 * composition d'un jeu »), en plus de ↑ ↓. [lignes] : ses <li>, dans l'ordre ; [bouger(k, j)] : la ligne [k] passe à la
 * place [j] ; [glissable(k)] : faux pour une place vide (on peut quand même poser une ligne à côté).
 */
function glisserDansLaListe(liste, lignes, bouger, glissable = () => true) {
  let glissee = null;
  const sans = (...classes) => liste.querySelectorAll(classes.map((c) => `.${c}`).join(", ")).forEach((li) => li.classList.remove(...classes));
  const cible = (e) => {
    let li = e.target;
    while (li && !lignes.includes(li)) li = li.parentElement;
    if (!li) return null;
    const { top, height } = li.getBoundingClientRect();
    return { li, k: lignes.indexOf(li), avant: e.clientY < top + height / 2 };
  };
  lignes.forEach((li, k) => {
    if (!glissable(k)) return;
    li.draggable = true;
    li.addEventListener("dragstart", (e) => {
      glissee = k;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", `${k + 1}`);
      li.classList.add("glisse");
    });
    li.addEventListener("dragend", () => { glissee = null; sans("glisse", "depose-avant", "depose-apres"); });
  });
  liste.addEventListener("dragover", (e) => {
    const c = glissee === null ? null : cible(e);
    if (!c) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    sans("depose-avant", "depose-apres");
    c.li.classList.add(c.avant ? "depose-avant" : "depose-apres");
  });
  liste.addEventListener("dragleave", (e) => { if (!liste.contains(e.relatedTarget)) sans("depose-avant", "depose-apres"); });
  liste.addEventListener("drop", (e) => {
    const k = glissee;
    const c = k === null ? null : cible(e);
    glissee = null;
    sans("glisse", "depose-avant", "depose-apres");
    if (!c) return;
    e.preventDefault();
    let j = c.avant ? c.k : c.k + 1;
    if (j > k) j--;
    if (j !== k) bouger(k, j);
  });
}

/**
 * Dernière ligne d'un blind test (cedric, 24/10 : « un récapitulatif global des deux ajouts mélangés ») : le « Blind
 * test complet », toutes les chansons dans l'ordre de passage. Déplié : chacune monte, descend ou s'enlève (de sa
 * série) ; 🔀 mélange tout. L'ordre rangé ici est gardé dans le blind test (`ordreBlind`).
 */
// Quiz musical aussi (cedric, 24/10) : l'extrait pendant la question, le refrain et ses paroles à la révélation.
const pastilleParoles = (song) => {
  const paroles = parolesSurTv(song);
  return h("span", {
    class: `blind-paroles${paroles ? " ok" : " non"}`, text: paroles ? "✓ Paroles" : "✗ Pas de paroles",
    title: paroles ? "Paroles présentes : elles défileront sur la TV à la révélation"
      : song.lrc === true ? "Fichier .lrc présent, mais le refrain n'est pas encore réglé (Bibliothèque › Sons)" : "Pas de fichier .lrc : ajoutez-le dans Bibliothèque › Sons",
  });
};
/** 🎧 d'une chanson du blind test : ouvre ou ferme son petit menu (un seul ouvert à la fois, repéré par [cle]). */
const boutonCasque = (r, cle, song, ouvert, changer) => h("button", {
  type: "button", class: `icon blind-ecouter${ouvert ? " active" : ""}`, text: "🎧", "aria-expanded": ouvert ? "true" : "false",
  "aria-label": `Écouter et régler « ${song.title.trim()} »`, title: "Écouter l'extrait et le refrain, et les régler",
  onclick: () => {
    stopPreview();
    if (ouvert) blindEcoute.delete(r); else blindEcoute.set(r, cle);
    changer();
  },
});

function blindComplet(r, ordre, ranger, changer) {
  if (!ordre.length) return null;
  const tout = chansonsDe(r);
  const poser = (nouvel) => { r.ordreBlind = nouvel; ranger(); changer(); noterEcran(); };
  const deplacer = (k, d) => {
    const j = k + d;
    if (j < 0 || j >= tout.length) return;
    const nouvel = [...tout];
    const [a, b] = [tout.indexOf(ordre[k]), tout.indexOf(ordre[j])];
    [nouvel[a], nouvel[b]] = [nouvel[b], nouvel[a]];
    poser(nouvel);
  };
  const enlever = (id) => {
    const serie = r.seriesBlind.find((x) => x.chansons.includes(id));
    if (!serie) return;
    chansonsRetirees.set(r, new Set([...(chansonsRetirees.get(r) ?? []), id]));
    serie.chansons = serie.chansons.filter((x) => x !== id);
    if (r.ordreBlind?.length) r.ordreBlind = tout.filter((x) => x !== id);
    ranger();
    changer();
    noterEcran();
  };
  const melanger = () => {
    let nouvel = shuffle(tout);
    for (let essai = 0; essai < 5 && tout.length > 1 && nouvel.every((c, k) => c === tout[k]); essai++) nouvel = shuffle(tout);
    poser(nouvel);
  };
  const lignes = ordre.map((id, k) => {
    const song = songs[id];
    // 🎧 et « ✓ Paroles » ici aussi (cedric, 26/10), quelle que soit l'origine de la chanson.
    const ouvert = blindEcoute.get(r) === `complet:${id}`;
    return h("li", { class: `tirage-q blind-complet-q${ouvert ? " ouverte" : ""}`, "data-chanson": id },
      h("div", { class: "tirage-q-ligne" },
        h("span", { class: "quiz-complet-num", text: `${k + 1}` }),
        miniPochette(song),
        h("span", { class: "tirage-texte blind-titre" }, h("b", { text: song.title.trim() }), song.artist?.trim() ? h("span", { class: "hint", text: ` · ${song.artist.trim()}` }) : null),
        pastilleParoles(song),
        boutonCasque(r, `complet:${id}`, song, ouvert, changer),
        h("button", { type: "button", class: "icon quiz-complet-monter", text: "↑", title: "Passer cette chanson plus tôt", "aria-label": "Monter cette chanson", disabled: k === 0, onclick: () => deplacer(k, -1) }),
        h("button", { type: "button", class: "icon quiz-complet-descendre", text: "↓", title: "Passer cette chanson plus tard", "aria-label": "Descendre cette chanson", disabled: k === ordre.length - 1, onclick: () => deplacer(k, 1) }),
        h("button", { type: "button", class: "icon tirage-retirer", text: "✕", title: `Enlever cette chanson du ${r.type === "musical" ? "quiz musical" : "blind test"}`, "aria-label": `Enlever « ${song.title.trim()} »`, onclick: () => enlever(id) })),
      ouvert ? menuChanson(id) : null);
  });
  const liste = h("ol", { class: "tirage-liste serie-liste quiz-complet-liste blind-complet-liste" }, ...lignes);
  // Glissée à la souris : les places des chansons du « complet » dans le blind test gardent leurs voisines d'ailleurs.
  glisserDansLaListe(liste, lignes, (k, j) => {
    const places = ordre.map((id) => tout.indexOf(id));
    const nouvel = [...tout];
    deplaceEn(ordre, k, j).forEach((id, n) => { nouvel[places[n]] = id; });
    poser(nouvel);
  });
  liste.hidden = !blindsCompletsDeplies.has(r);
  const titre = () => `${liste.hidden ? "▸" : "▾"} 🧩 ${r.type === "musical" ? "Quiz musical" : "Blind test"} complet : ${ordre.length} chanson${ordre.length > 1 ? "s" : ""}, dans l'ordre de passage`;
  const voir = h("button", {
    type: "button", class: "chip tirage-voir serie-voir quiz-complet-voir blind-complet-voir", "aria-expanded": liste.hidden ? "false" : "true", text: titre(),
    title: `Voir toutes les chansons du ${r.type === "musical" ? "quiz musical" : "blind test"}, dans l'ordre`,
    onclick: (e) => {
      liste.hidden = !liste.hidden;
      if (liste.hidden) blindsCompletsDeplies.delete(r); else blindsCompletsDeplies.add(r);
      e.currentTarget.textContent = titre();
      e.currentTarget.setAttribute("aria-expanded", liste.hidden ? "false" : "true");
    },
  });
  return h("div", { class: "serie quiz-complet blind-complet" },
    h("div", { class: "serie-tete" },
      voir,
      h("button", { type: "button", class: "chip quiz-melanger blind-melanger", text: "🔀 Mélanger", title: `Mélanger toutes les chansons du ${r.type === "musical" ? "quiz musical" : "blind test"}`, disabled: ordre.length < 2, onclick: melanger })),
    liste);
}

/** Séries de mots dépliées, « Chante le mot ! complet » déplié (le temps de l'écran) ; mots retirés (le 🎲 ne les reprend pas). */
const motsCompletsDeplies = new WeakSet();
/** Qui suis-je ? (cedric, 26/10 : la carte du Quiz) : son « complet » ouvert d'office ; refermé, le temps de l'écran. */
const motsCompletsFermes = new WeakSet();
const motsRetires = new WeakMap();
/** Jeu de mots où un mot vient d'être écrit à la main : le curseur y revient après le rafraîchissement. */
let motAFocaliser = null;
/** Nombres de mots proposés au 🎲 d'un jeu de mots ; Qui a disparu ? : nombres de grilles. */
const MOTS_NOMBRES = [3, 4, 5, 6, 8, 10, 12, 15, 20];
const GRILLES_NOMBRES = [1, 2, 3, 4, 5, 6, 8];
/**
 * Qui a disparu ? (cedric, 27/10) : cartes par tour, 4, 6 ou 8 (deux rangées égales sur la TV) ; d'office selon l'âge
 * de la carte du jeu (4 aux petits, 6 aux moyens, 8 aux grands).
 */
const cartesDe = (r) => (DISPARU_CARTES.includes(r.objects) ? r.objects : disparuObjects({}, ageDuQuiz(r)));
const objetsParGrille = cartesDe;
const GRILLE_MIN = 4;
/** Qui a disparu ? : panneau « ⭐ Composer une grille avec vos images » ouvert, par jeu (recherche, images cochées). */
const panneauxGrille = new WeakMap();

/** Petite image d'un objet de Qui a disparu ? : votre image, sa photo libre, sinon son émoji. */
const vignetteObjet = (o) => (o.imageId ? photoBibliotheque(o.imageId, { class: "grille-vignette", alt: o.word, title: o.word })
  : o.banque ? h("img", { class: "grille-vignette", src: cheminPhotoBanque(o.banque), alt: o.word, title: o.word, loading: "lazy" })
    : h("span", { class: "grille-vignette emoji", text: o.image ?? "❔", title: o.word }));

/**
 * Cadrages mémorisés (cedric, 29/10 : « que la régie enregistre ce dernier choix et le repropose de la même manière la
 * prochaine fois que l'image se représente pour le même jeu avec le même type de cadrage ») : `library/cadrages/{clé}`
 * = { src, crop, at }, la clé = jeu ~ forme (vignette, revelation) ~ image d'origine (identifiant, ou « b-… » pour une
 * photo libre de l'appli). L'image d'origine n'est jamais modifiée : le cadrage est une nouvelle image.
 */
let cadrages = {};
const cleCadrage = (type, forme, src) => `${type}~${forme}~${`${src}`.replace(/[^-\w]/g, "_").slice(0, 80)}`;
/** L'image d'origine d'une image recadrée, sinon null. */
const origineCadree = (id) => Object.values(cadrages).find((c) => c && c.crop === id)?.src ?? null;
/** De quoi ouvrir le cadrage sur une image d'origine : la photo libre de l'appli, ou l'image de la bibliothèque. */
const sourceDuCadrage = (src) => (`${src}`.startsWith("b-") ? Promise.resolve(cheminPhotoBanque(src.slice(2))) : imageDeLaBibliotheque(src));
function memoriserCadrage(type, forme, src, crop) {
  if (!IMAGE_ID.test(crop ?? "") || !src) return;
  const cle = cleCadrage(type, forme, src);
  cadrages[cle] = { src, crop, at: Date.now() };
  set(ref(db, `library/cadrages/${cle}`), { src: `${src}`.slice(0, 120), crop, at: serverTimestamp() }).catch((e) => console.error(e));
}
/** Le cadrage gardé pour cette image dans ce jeu et cette forme (identifiant de l'image recadrée), sinon null. */
const cadrageGarde = (type, forme, src) => (src ? cadrages[cleCadrage(type, forme, src)]?.crop ?? null : null);

/** L'image d'un objet (carte, mot, personnage) : son identifiant, ou « b-… » pour une photo libre de l'appli. */
const sourceImage = (o) => (IMAGE_ID.test(o?.imageId ?? "") ? o.imageId : typeof o?.banque === "string" && o.banque ? `b-${o.banque}` : null);
/** Remplace dans [racine] (un jeu de la prestation, à toute profondeur) chaque objet qui [estCelui] par [neuf](objet). */
function remplacerDans(racine, estCelui, neuf) {
  let n = 0;
  const visiter = (x) => {
    if (!x || typeof x !== "object") return;
    for (const k of Object.keys(x)) {
      const v = x[k];
      if (v && typeof v === "object" && !Array.isArray(v) && estCelui(v)) { x[k] = neuf(v); n++; } else visiter(v);
    }
  };
  visiter(racine);
  return n;
}
/** Jeux à cartes ou à mots avec une image : la forme de son cadre sur la TV, et le nom de l'objet. */
const CADRES_DES_MOTS = { mimes: ["mime", (v) => v.word], pictionary: ["vignette", (v) => v.word], quisuis: ["rond", (v) => v.answer] };
/** L'objet avec son image recadrée [id] (la photo libre d'origine ne sert plus ; l'émoji reste). */
const avecImage = (v, id) => { const { banque: _, ...reste } = v; return { ...reste, imageId: id }; };

/**
 * Petite image recadrable d'une carte des Mimes, d'un mot du Pictionary ou d'un personnage de Qui suis-je ? (cedric,
 * 29/10 : « chaque fois qu'un choix de cadrage se présente ») : un clic ouvre le cadrage à la forme de la TV ; l'objet
 * prend l'image recadrée partout dans ce jeu de la prestation, et le cadrage est gardé pour la prochaine fois.
 */
function imageRecadrable(img, r, o, changer) {
  // Mode carte (régie téléphone) : rien ne s'écrit dans la bibliothèque, donc pas de recadrage.
  if (MODE_CARTE) return img;
  const [forme, nomDe] = CADRES_DES_MOTS[r?.type] ?? [];
  if (img?.tagName !== "IMG" || !forme || !sourceImage(o)) return img;
  img.classList.add("recadrable");
  img.title = `${nomDe(o) ?? ""} · cliquer pour recadrer l'image comme sur la TV (pour cette prestation)`;
  img.addEventListener("click", async (e) => {
    e.stopPropagation();
    const actuelle = sourceImage(o);
    const origine = origineCadree(actuelle) ?? actuelle;
    await cadrer(await sourceDuCadrage(origine), forme, async (blob) => {
      const id = await storeChoiceImage(blob);
      memoriserCadrage(r.type, forme, origine, id);
      remplacerDans(r, (v) => nomDe(v) === nomDe(o) && sourceImage(v) === actuelle, (v) => avecImage(v, id));
      changer();
    });
  });
  return img;
}

/**
 * Repropose les cadrages gardés dans les jeux de la prestation : une image qui revient dans le même jeu, avec la même
 * forme, prend son dernier cadrage (Quiz, Quiz illustré, Vrai ou Faux, Zoom mystère, Image floue : la photo et les
 * réponses en images ; Qui a disparu ? : les cartes). Seulement les questions gardées dans la prestation (jamais un quiz
 * de la Bibliothèque rappelé en entier). Rend true si quelque chose a changé.
 */
function appliquerCadrages(rounds) {
  let change = false;
  const enListe = (x) => (Array.isArray(x) ? x : Object.values(x ?? {}));
  for (const r of rounds ?? []) {
    if (!r) continue;
    if (estEnSeries(r.type)) {
      for (const serie of enListe(r.seriesQuiz)) {
        if (!serie || serie.origine === "quiz") continue;
        for (const q of enListe(serie.questions)) {
          if (!q || q.vide === true) continue;
          const src = IMAGE_ID.test(q.imageId ?? "") ? q.imageId : q.banque ? `b-${q.banque}` : null;
          const crop = cadrageGarde(r.type, "revelation", src);
          if (crop && crop !== q.imageId) {
            // La clé d'une photo sans identifiant vient de son image : elle la garde (sa place dans l'ordre de passage).
            if (!(typeof q.id === "string" && q.id) && estJeuDePhotos(r.type)) q.id = `t:${signatureQuestion(q, r.type)}`;
            q.imageId = crop;
            delete q.banque;
            delete q.emoji;
            change = true;
          }
          const choices = enListe(q.choices);
          const ids = choiceImageList({ choices, choiceImages: q.choiceImages });
          const neuves = ids.map((id) => cadrageGarde(r.type, "vignette", id) ?? id);
          if (neuves.some((id, k) => id !== ids[k])) { q.choiceImages = neuves; change = true; }
        }
      }
    }
    if (CADRES_DES_MOTS[r.type]) {
      const [forme, nomDe] = CADRES_DES_MOTS[r.type];
      const garde = (v) => (typeof nomDe(v) === "string" ? cadrageGarde(r.type, forme, sourceImage(v)) : null);
      if (remplacerDans(r, (v) => { const c = garde(v); return !!c && c !== v.imageId; }, (v) => avecImage(v, garde(v)))) change = true;
    }
    if (r.type === "disparu") {
      for (const serie of enListe(r.seriesMots)) {
        if (!serie) continue;
        serie.mots = enListe(serie.mots).map((m) => {
          if (!m || m.vide === true || !m.objects) return m;
          let touche = false;
          const objects = enListe(m.objects).map((o) => {
            const src = IMAGE_ID.test(o?.imageId ?? "") ? o.imageId : o?.banque ? `b-${o.banque}` : null;
            const crop = cadrageGarde("disparu", "vignette", src);
            if (!crop || crop === o.imageId) return o;
            touche = true;
            const { banque: _, image: __, ...reste } = o;
            return { ...reste, imageId: crop };
          });
          if (!touche) return m;
          change = true;
          return { ...m, objects };
        });
      }
    }
  }
  return change;
}

/**
 * Petite image recadrable d'un objet de Qui a disparu ? (cedric, 29/10 : « réajuster la place précise de la photo dans
 * le carré ») : la carte est carrée sur la TV ; un clic ouvre le même cadrage que les « … complet », et l'image
 * recadrée ne vaut que pour cette prestation. L'objet est remplacé par une copie dans sa série (un objet tiré au 🎲
 * peut venir du catalogue de l'appli, jamais modifié). Un émoji n'a rien à recadrer.
 */
function objetRecadrable(img, r, m, k, changer) {
  // Mode carte (régie téléphone) : rien ne s'écrit dans la bibliothèque, donc pas de recadrage.
  if (MODE_CARTE) return img;
  const o = m.objects?.[k];
  if (img?.tagName !== "IMG" || !o || !(IMAGE_ID.test(o.imageId ?? "") || o.banque)) return img;
  img.classList.add("recadrable");
  img.title = `${o.word ?? ""} · cliquer pour recadrer l'image comme sur la TV (pour cette prestation seulement)`;
  img.addEventListener("click", async (e) => {
    e.stopPropagation();
    const actuelle = IMAGE_ID.test(o.imageId ?? "") ? o.imageId : `b-${o.banque}`;
    const origine = origineCadree(actuelle) ?? actuelle;
    await cadrer(await sourceDuCadrage(origine), "vignette", async (blob) => {
      const id = await storeChoiceImage(blob);
      memoriserCadrage("disparu", "vignette", origine, id);
      // Le « complet » montre des copies : le tour gardé dans sa série se retrouve par sa clé, l'objet par son mot.
      const enListe = (x) => (Array.isArray(x) ? x : Object.values(x ?? {}));
      const cle = CONTENT_GAMES.disparu.key(m);
      const serie = (r.seriesMots ?? []).find((x) => enListe(x?.mots).some((y) => y && y.vide !== true && CONTENT_GAMES.disparu.key(y) === cle));
      if (!serie) return;
      serie.mots = enListe(serie.mots);
      const i = serie.mots.findIndex((y) => y && y.vide !== true && CONTENT_GAMES.disparu.key(y) === cle);
      const tour = serie.mots[i];
      const objets = enListe(tour.objects);
      const j = objets.findIndex((x) => x?.word === o.word);
      if (j < 0) return;
      const { banque: _, image: __, ...reste } = objets[j];
      serie.mots[i] = { ...tour, objects: objets.map((x, n) => (n === j ? { ...reste, imageId: id } : x)) };
      changer();
    });
  });
  return img;
}

/**
 * « ⭐ Composer une grille avec vos images » (Qui a disparu ?, cedric 24/10) : de 5 à 12 de vos images (« Mes images »),
 * cherchées par nom, catégorie ou mot-clé ; le nom de chaque image est le mot à trouver. [ajouterGrille] reçoit les objets.
 */
function ligneGrilleVosImages(r, ajouterGrille, changer) {
  const panneau = panneauxGrille.get(r);
  // Autant d'images que de cartes par tour (cedric, 27/10).
  const N = cartesDe(r);
  const titre = h("button", {
    type: "button", class: "quiz-ajout-titre vos-images-titre grille-images-titre", "aria-expanded": panneau ? "true" : "false",
    text: `${panneau ? "▾" : "▸"} ⭐ Composer un tour avec vos images`,
    onclick: () => {
      if (panneau) panneauxGrille.delete(r);
      else panneauxGrille.set(r, { recherche: "", cochees: [], focus: true });
      changer();
    },
  });
  if (!panneau) return h("div", { class: "quiz-ajouts vos-images grille-images" }, titre,
    h("span", { class: "hint small", text: `${N} de vos images (« Mes images ») pour un tour ; le nom de chaque image est le mot à trouver.` }));
  const { miennes: siennes, packs: desPacks } = groupesImages();
  const images = [...siennes, ...desPacks];
  const cherche = h("input", { type: "search", class: "vos-images-cherche", "aria-label": "Chercher dans vos images", value: panneau.recherche, placeholder: "Nom, catégorie, mot-clé…" });
  const grille = h("div", { class: "media-grid vos-images-grille" });
  const ajouter = h("button", { type: "button", class: "btn vos-images-ajouter grille-images-ajouter" });
  const majAjouter = () => {
    const n = panneau.cochees.length;
    ajouter.disabled = n !== N;
    ajouter.textContent = n > N ? `${N} images par tour (${n} cochées)` : n === N ? `＋ Faire un tour avec ces ${n} images` : `Cochez ${N} images (${n})`;
  };
  const tuile = (x) => {
    const nom = `${x.nom ?? ""}`.trim();
    const on = () => panneau.cochees.includes(x.id);
    const b = h("button", {
      type: "button", class: `media-tile vos-images-tuile${on() ? " on" : ""}`, "data-image": x.id, "aria-pressed": on() ? "true" : "false",
      disabled: !nom, title: nom ? `Cocher « ${nom} »` : "À nommer dans Mes images",
      onclick: () => {
        if (on()) panneau.cochees = panneau.cochees.filter((id) => id !== x.id); else panneau.cochees.push(x.id);
        b.classList.toggle("on", on());
        b.setAttribute("aria-pressed", on() ? "true" : "false");
        majAjouter();
      },
    }, photoBibliotheque(x.id, { loading: "lazy" }), h("span", { text: nom || "Sans nom" }),
    nom ? null : h("small", { class: "vos-images-etat", text: "À nommer dans Mes images" }));
    return b;
  };
  const dessiner = () => {
    const q = panneau.recherche;
    const trouvees = parPertinence(images.filter((x) => contientTout([x.nom, x.cat, ...(x.tags ?? [])].filter(Boolean), q)), q,
      (x) => [x.nom].filter(Boolean), (x) => [x.cat, ...(x.tags ?? [])].filter(Boolean));
    grille.replaceChildren(...(trouvees.length ? trouvees.slice(0, VOS_IMAGES_MAX).map(tuile)
      : [h("p", { class: "hint small", text: images.length ? "Aucune de vos images ne correspond." : "Pas encore d'image dans « Mes images » (Bibliothèque › Images)." })]),
    ...(trouvees.length > VOS_IMAGES_MAX ? [h("p", { class: "hint small", text: `Et ${plural(trouvees.length - VOS_IMAGES_MAX, "autre image", "autres images")} : précisez la recherche.` })] : []));
  };
  cherche.addEventListener("input", () => { panneau.recherche = cherche.value; dessiner(); });
  ajouter.onclick = () => {
    const parId = new Map(images.map((x) => [x.id, x]));
    const objets = panneau.cochees.map((id) => parId.get(id)).filter(Boolean)
      .map((x) => ({ word: `${x.nom ?? ""}`.trim().slice(0, 40) || "Image", imageId: x.id }));
    if (objets.length !== N) return;
    panneauxGrille.delete(r);
    ajouterGrille(objets);
  };
  dessiner();
  majAjouter();
  if (panneau.focus) { panneau.focus = false; requestAnimationFrame(() => cherche.focus()); }
  return h("div", { class: "vos-images vos-images-ouvert grille-images" },
    h("div", { class: "quiz-ajouts" }, titre, h("div", { class: "quiz-ajout-champ" }, cherche)),
    grille,
    h("div", { class: "vos-images-pied" }, ajouter,
      h("button", { type: "button", class: "btn secondary vos-images-fermer", text: "Fermer", onclick: () => { panneauxGrille.delete(r); changer(); } })));
}

/**
 * Un jeu de mots d'avant les séries (mots choisis un par un, cedric 24/10) : ses mots deviennent ses séries (ceux tirés
 * au hasard, la série du 🎲 ; les autres, écrits à la main). Une copie : la prestation lue dans la base ne change pas.
 */
function versSeriesMots(r) {
  if (!estJeuDeMots(r?.type) || Array.isArray(r.seriesMots)) return r;
  const lues = seriesMots(r);
  if (lues.length) return { ...r, seriesMots: lues };
  const game = CONTENT_GAMES[r.type];
  const hasard = new Set(roundHasard(r));
  // Qui a disparu ? : chaque famille choisie devient une grille de ses objets (autant que l'âge en demande).
  const enGrille = (t) => (r.type === "disparu" ? { theme: t.theme, objects: shuffle(t.objects).slice(0, Math.max(GRILLE_MIN, disparuObjects(r, "MOYENS"))) } : t);
  const choisis = pickedItems(r.type, contents[r.type], roundPicks(r)).map(enGrille);
  const tires = choisis.filter((m) => hasard.has(game.key(m))).map((m) => pourLeHasard(r.type, m)).filter(Boolean).map((m) => game.clean(m)).filter(Boolean);
  const main = choisis.filter((m) => !hasard.has(game.key(m))).map((m) => game.clean(m)).filter(Boolean);
  const series = [
    ...(tires.length ? [{ id: "de", origine: "de", mots: tires }] : []),
    ...(main.length ? [{ id: nouvelId("m"), origine: "main", mots: main }] : []),
  ];
  return series.length ? { ...r, seriesMots: series, picks: null, hasard: null } : { ...r, seriesMots: [] };
}

/**
 * « 📚 Rappeler » de Qui suis-je ? (cedric, 24/10) : les prestations archivées qui en ont un, la plus récente d'abord,
 * avec tous leurs personnages (dans l'ordre joué) et de quoi les retrouver (prénom, âge, date, notes).
 */
function motsArchives(type, unite = BUILTIN_GAMES[type].unit) {
  return prestationsRecentes().filter(([, s]) => etatPrestation(s) === "archivee").map(([sid, s]) => {
    const mots = (s.rounds ?? []).filter((x) => x?.type === type).flatMap((x) => motsDuJeu(versSeriesMots(x)).map((y) => y.m));
    const date = s.date ? new Date(`${s.date}T12:00:00`) : null;
    return {
      id: sid, mots,
      titre: `${showTitle(s)}${date ? ` (${date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })})` : ""}`,
      details: [date ? date.toLocaleDateString("fr-FR") : "", s.age != null && s.age !== "" ? `${s.age} ans` : "", plural(mots.length, unite)].filter(Boolean).join(" · "),
      noms: [showTitle(s), s.childName],
      autres: [...datesCherchables(s.date), s.age != null && s.age !== "" ? `${s.age} ans` : "", s.notes, s.themes],
    };
  }).filter((x) => x.mots.length);
}

/** Noms des séries de la bibliothèque d'un jeu (Qui suis-je ?), dans l'ordre alphabétique. */
const nomsDesSeries = (extra) => [...new Set(extra.map((x) => x.serie).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));

/** Séries de la bibliothèque d'un jeu (Qui suis-je ?, cedric 24/10) : [nom, ses éléments avec leur image]. */
function seriesBibliotheque(type) {
  const actifs = activeItems(type, contents[type]).filter((x) => x.serie);
  return nomsDesSeries(actifs).map((nom) => [nom, actifs.filter((x) => x.serie === nom)]);
}

/**
 * Qui suis-je ? (cedric, 25/10 : la carte du Quiz) : l'âge (d'office pour chaque 🎲) et le total ; trois 🎲 dans mes
 * packs (les personnages de mes séries : tout au hasard, un thème pour moitié, un thème à 100 %) et un dans les
 * personnages du jeu, chacun avec son âge et son nombre (1 à 15) ; chaque clic ajoute ses personnages à la suite du
 * « complet », jamais un déjà là. Un personnage retiré laisse ses dés dans le « complet ».
 */
function desPersonnages(r, { piocherBanque, cles, ranger, changer }) {
  const type = r.type;
  const mesPersos = activeItems(type, contents[type]).filter((x) => x.serie);
  const catalogue = mesPersos.map((m, k) => ({ id: `${k}`, quizId: m.serie, titre: m.serie, theme: m.serie, niveau: lireNiveau(m.niveau) ?? "Facile",
    cle: cleDuMot(type, m), q: { text: m.answer, choices: m.clues ?? [] }, m }));
  const retires = () => motsRetires.get(r) ?? new Set();
  const sans = (serie) => new Set([...cles(serie), ...retires()]);
  // Un personnage de mes séries garde son image (celle de mon pack, montrée à la révélation), même pioché au 🎲.
  const versMot = (y) => CONTENT_GAMES[type].clean(y.m) ?? null;
  const nombreDu = (de) => (NOMBRES_DE_QUIZ.includes(reglageDuDe(r, de).n) ? reglageDuDe(r, de).n : BUILTIN_GAMES[type].count);
  const nombreDe = (de) => h("select", { class: `tirage-nombre de-nombre de-nombre-${de}`, "aria-label": "Nombre de personnages de ce 🎲", onchange: (e) => { reglageDuDe(r, de).n = Number(e.target.value); } },
    ...NOMBRES_DE_QUIZ.map((k) => h("option", { value: k, selected: k === nombreDu(de), text: plural(k, "personnage") })));
  const ageDe = (de) => menuAge(ageDuDe(r, de), { class: `tirage-profil de-age de-age-${de}`, "aria-label": "Âge des personnages de ce 🎲" }, (v) => { reglageDuDe(r, de).profil = v; });
  const piocher = (mode, champ) => {
    const terme = champ?.value.trim() ?? "";
    if (champ) reglageDuDe(r, mode).terme = terme;
    if (mode !== "hasard" && !terme) { annonce(mode === "theme" ? "Tapez le thème principal à droite du 🎲." : "Tapez le thème (ou un personnage) à droite du 🎲."); champ.focus(); return; }
    if (!catalogue.length) { annonce(AUCUN_PACK.quisuis); return; }
    const k = nombreDu(mode);
    const profil = ageDuDe(r, mode);
    // Chaque clic ajoute ses personnages à la suite du « complet » (cedric, 25/10), jamais un déjà là.
    if (cles().size >= MAX_MOTS) { annonce(`Déjà ${MAX_MOTS} personnages : c'est le maximum.`); return; }
    const mots = piocherDansLesPacks(catalogue, Math.min(k, MAX_MOTS - cles().size), { mode, terme, niveau: niveauDesPacks(NIVEAU_DU_PROFIL[profil]), exclus: sans(null) }).map(versMot).filter(Boolean);
    if (!mots.length) { annonce(mode === "hasard" ? "Plus aucun personnage libre dans vos packs." : `Aucun personnage libre ne se rapporte à « ${terme} » dans vos packs.`); return; }
    if (mots.length < k) annonce(`Seulement ${plural(mots.length, "personnage libre", "personnages libres")}${mode === "recherche" ? ` sur « ${terme} »` : ""} : les voici.`);
    const x = { id: nouvelId("pk"), origine: "biblio", pioche: { mode, ...(mode === "hasard" ? {} : { terme }), profil } };
    x.titre = `Mes packs : ${sortePioche(x.pioche)}`;
    x.mots = mots;
    aLaSuite(r, () => r.seriesMots.push(x));
    ranger();
    changer();
  };
  const banque = () => {
    const de = r.seriesMots.find((x) => x.origine === "de") ?? null;
    // Chaque clic ajoute ses personnages (cedric, 25/10), jamais un déjà là ni retiré.
    if (cles().size >= MAX_MOTS) { annonce(`Déjà ${MAX_MOTS} personnages : c'est le maximum.`); return; }
    const mots = piocherBanque(Math.min(nombreDu("banque"), MAX_MOTS - cles().size), sans(null), ageDuDe(r, "banque"));
    if (!mots.length) { annonce("Plus aucun personnage libre à tirer : ajoutez-en dans la page du jeu."); return; }
    const serie = de ?? { id: "de", origine: "de", mots: [] };
    if (!de) r.seriesMots.unshift(serie);
    aLaSuite(r, () => { serie.mots = [...(serie.mots ?? []), ...mots]; });
    r.count = serie.mots.length;
    ranger();
    changer();
  };
  const champ = (mode, classe, placeholder, label) => {
    const c = champThemePacks({ classe, placeholder, label, valeur: reglageDuDe(r, mode).terme ?? "", catalogue, exclus: sans(null), entree: () => piocher(mode, c.champ) });
    c.champ.addEventListener("input", () => { reglageDuDe(r, mode).terme = c.champ.value; });
    return c;
  };
  const theme = champ("theme", "packs-theme", "Thème principal pour moitié, le reste au hasard", "Thème principal : la moitié des personnages, le reste au hasard dans mes packs");
  const cherche = champ("recherche", "packs-recherche", "Thème à 100 % (ou un personnage) dans mes packs", "Thème à 100 % : tous les personnages sur ce thème");
  const de = (mode, titre, c = null) => h("button", { type: "button", class: `btn packs-de packs-de-${mode}`, text: "🎲", "aria-label": titre, title: titre, onclick: () => piocher(mode, c) });
  const ligne = (classe, ...enfants) => h("div", { class: `de-ligne ${classe}` }, ...enfants);
  const lignes = [
    ligneAgeQuiz(r, changer, motsDuJeu(r).length, "personnage"),
    h("div", { class: "packs-ligne", "data-packs": String(catalogue.length) },
      h("div", { class: "packs-tete" },
        h("span", { class: "quiz-ajout-titre packs-titre", text: "🎨 Mes packs" }),
        catalogue.length ? null : h("span", { class: "hint small", text: AUCUN_PACK.quisuis })),
      ligne("packs-de-ligne", de("hasard", "Tout au hasard dans mes packs"), h("span", { class: "packs-de-texte", text: "Tout au hasard dans mes packs" }), ageDe("hasard"), nombreDe("hasard")),
      ligne("packs-de-ligne", de("theme", "Thème principal pour moitié, le reste au hasard dans mes packs", theme.champ), theme.bloc, ageDe("theme"), nombreDe("theme")),
      ligne("packs-de-ligne", de("recherche", "Thème à 100 % dans mes packs", cherche.champ), cherche.bloc, ageDe("recherche"), nombreDe("recherche"))),
    h("div", { class: "banque-ligne" },
      ligne("tirage-ligne",
        h("button", { type: "button", class: "btn tirage-de", text: "🎲", "aria-label": "Tout au hasard dans les personnages du jeu", title: "Tout au hasard dans les personnages du jeu (ceux de Qui suis-je ?, hors de mes séries)", onclick: banque }),
        h("span", { class: "packs-de-texte", text: "Tout au hasard dans les personnages du jeu" }), ageDe("banque"), nombreDe("banque"))),
  ];
  // Un personnage retiré : un 🎲 à sa place (deux dans une série de mes packs : au hasard, ou sur le thème tapé).
  const caseVide = (serie, i) => {
    const remplir = (mode, terme = "") => {
      let neuf = null;
      if (!serie.pioche) [neuf] = piocherBanque(1, new Set([...cles(), ...retires()]), ageDuDe(r, "banque"));
      else {
        if (mode === "recherche" && !terme) { annonce("Tapez un thème à droite du second 🎲."); c.focus(); return; }
        const age = PROFILES[serie.pioche.profil] ? serie.pioche.profil : ageDuQuiz(r);
        const [y] = piocherDansLesPacks(catalogue, 1, { mode, terme, niveau: niveauDesPacks(NIVEAU_DU_PROFIL[age]), exclus: new Set([...cles(), ...retires()]) });
        neuf = y ? versMot(y) : null;
      }
      if (!neuf) { annonce("Plus aucun personnage libre à tirer."); return; }
      serie.mots[i] = neuf;
      ranger();
      changer();
    };
    const c = h("input", { type: "search", class: "packs-case-theme", placeholder: "Thème…", "aria-label": "Thème du personnage à piocher", maxlength: "80",
      value: serie.pioche?.terme ?? "", onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); remplir("recherche", c.value.trim()); } } });
    return h("li", { class: `tirage-q vide${serie.pioche ? " packs-case" : ""}` }, h("div", { class: "tirage-q-ligne" },
      ...(serie.pioche ? [
        h("button", { type: "button", class: "btn packs-de petit packs-case-hasard", text: "🎲", "aria-label": "Piocher un personnage au hasard dans mes packs", title: "Un personnage au hasard, n'importe quel thème", onclick: () => remplir("hasard") }),
        h("span", { class: "hint small", text: "ou" }),
        h("button", { type: "button", class: "btn packs-de petit packs-case-theme-de", text: "🎲", "aria-label": "Piocher un personnage sur ce thème", title: "Un personnage sur le thème tapé à droite", onclick: () => remplir("recherche", c.value.trim()) }), c]
        : [h("button", { type: "button", class: "btn tirage-de petit", text: "🎲", "aria-label": "Tirer un autre personnage", title: "Tirer un autre personnage du jeu", onclick: () => remplir() }),
          h("span", { class: "hint small", text: "Personnage à tirer" })])));
  };
  // La carte du Quiz (cedric, 26/10) : une seule ligne de 🎲, à l'âge de la carte. Le champ : vide, au hasard partout
  // (moitié mes packs, moitié les personnages du jeu) ; « libre » : les personnages du jeu ; « mes packs » ; un thème
  // (ou un personnage) : mes packs sur ce mot.
  const libres = { titre: "Personnages libres de droit", details: "Les personnages de Qui suis-je ?, à l'âge choisi", themes: {} };
  const piocherPersos = (k, terme, exclus) => {
    const source = sourceDuDe(terme, {});
    const niveau = niveauDesPacks(NIVEAU_DU_PROFIL[ageDuQuiz(r)]);
    const depuisPacks = (n, mode, t = "", sansPacks = []) => (n > 0 && catalogue.length
      ? piocherDansLesPacks(catalogue, n, { mode, terme: t, niveau, exclus: new Set([...exclus, ...sansPacks.map((y) => y.cle)]) }) : []);
    const duJeu = (n) => (n > 0 ? piocherBanque(n, exclus, ageDuQuiz(r)) : []);
    if (source.sorte === "libres") return { packs: [], libres: duJeu(k), source };
    if (source.sorte === "packs") return { packs: depuisPacks(k, "hasard"), libres: [], source };
    if (source.sorte === "theme") return { packs: depuisPacks(k, "recherche", source.terme), libres: [], source };
    const moitie = !catalogue.length ? 0 : k === 1 ? (Math.random() < 0.5 ? 1 : 0) : Math.ceil(k / 2);
    const packs = depuisPacks(moitie, "hasard");
    const duJeuTires = duJeu(k - packs.length);
    return { packs: [...packs, ...depuisPacks(k - packs.length - duJeuTires.length, "hasard", "", packs)], libres: duJeuTires, source };
  };
  const reglage = reglageDuDe(r, "unique");
  const nombre = () => (NOMBRES_DE_QUIZ.includes(reglage.n) ? reglage.n : BUILTIN_GAMES[type].count);
  const tirer = () => {
    const terme = source.champ.value.trim();
    reglage.terme = terme;
    const place = MAX_MOTS - cles().size;
    if (place <= 0) { annonce(`Déjà ${MAX_MOTS} personnages : c'est le maximum.`); return; }
    const n = nombre();
    const { packs, libres: duJeuTires, source: sorte } = piocherPersos(Math.min(n, place), terme, sans(null));
    const mots = packs.map(versMot).filter(Boolean);
    if (!mots.length && !duJeuTires.length) {
      annonce(sorte.sorte === "packs" && !catalogue.length ? AUCUN_PACK.quisuis : sorte.sorte === "theme" ? `Aucun personnage libre ne se rapporte à « ${terme} » : essayez un autre mot, ou videz le champ.` : "Plus aucun personnage libre ici : changez l'âge, ou videz le champ.");
      return;
    }
    if (mots.length + duJeuTires.length < n) annonce(`Seulement ${plural(mots.length + duJeuTires.length, "personnage libre", "personnages libres")}${sorte.sorte === "theme" ? ` sur « ${terme} »` : ""} : les voici.`);
    aLaSuite(r, () => {
      if (mots.length) {
        const pioche = { mode: sorte.sorte === "theme" ? "recherche" : "hasard", ...(sorte.sorte === "theme" ? { terme: sorte.terme } : {}), profil: ageDuQuiz(r) };
        r.seriesMots.push({ id: nouvelId("pk"), origine: "biblio", pioche, titre: `Mes packs : ${sortePioche(pioche)}`, mots });
      }
      if (duJeuTires.length) {
        let de = r.seriesMots.find((x) => x.origine === "de") ?? null;
        if (!de) { de = { id: "de", origine: "de", mots: [] }; r.seriesMots.unshift(de); }
        de.mots = [...(de.mots ?? []), ...duJeuTires];
        r.count = de.mots.length;
      }
    });
    ranger();
    changer();
  };
  const source = champSourceQuiz({ classe: "de-unique-champ", valeur: reglage.terme ?? "", catalogue, exclus: sans(null), libres, unite: "personnage", entree: tirer });
  source.champ.addEventListener("input", () => { reglage.terme = source.champ.value; });
  const ligneUnique = h("div", { class: "de-ligne de-unique-ligne" },
    h("button", { type: "button", class: "btn packs-de de-unique", text: "🎲", "aria-label": "Tirer les personnages", title: "Tirer les personnages : au hasard, ou sur ce qui est tapé à droite", onclick: tirer }),
    source.bloc,
    h("select", { class: "tirage-nombre de-nombre de-nombre-unique", "aria-label": "Nombre de personnages de ce 🎲", onchange: (e) => { reglage.n = Number(e.target.value); } },
      ...NOMBRES_DE_QUIZ.map((k) => h("option", { value: k, selected: k === nombre(), text: plural(k, "personnage") }))));
  const enTete = menuAge(ageDuQuiz(r), { class: "tirage-profil quiz-age quiz-en-tete", "aria-label": "Âge des personnages" }, (v) => { r.profil = v; changer(); });
  // Un personnage pour une place vide (son petit 🎲 et son champ, mêmes règles) ; null : aucun.
  const unPerso = (terme) => {
    const { packs, libres: duJeuTires } = piocherPersos(1, terme, sans(null));
    return (packs[0] ? versMot(packs[0]) : null) ?? duJeuTires[0] ?? null;
  };
  const champCase = (entree) => champSourceQuiz({ classe: "quiz-case-champ", catalogue, exclus: sans(null), libres, unite: "personnage", placeholder: "Au hasard, ou un thème", entree });
  return { lignes, caseVide, ligneUnique, enTete, unMot: unPerso, champCase };
}

/** Qui a disparu ? : d'où viennent les images du 🎲 (cedric, 27/10 : « émojis, images réelles ou mixte »). */
const SOURCES_DISPARU = { mixte: "Mixte : émojis et images réelles", emojis: "Émojis", reelles: "Images réelles" };
const sourceDisparu = (r) => (SOURCES_DISPARU[r.images] ? r.images : "mixte");
/** Une famille en images réelles : photos libres de droit, ou images des packs. */
const familleReelle = (t) => (t?.objects ?? []).some((o) => o?.banque || o?.imageId);

/**
 * Qui a disparu ? en images réelles (cedric, 27/10) : des familles faites des images des packs, une par thème. Seulement
 * les images carrées d'un personnage bien cadré (480 × 480 à l'import) : les réponses des Quiz illustrés et les
 * personnages de Qui suis-je ?, jamais une photo de Zoom mystère ou d'Image floue ni une image de révélation (des
 * paysages, en 4:3). Le mot à trouver : la réponse, ou le nom du personnage.
 */
function famillesDesPacks() {
  const parTheme = new Map();
  const ajouter = (theme, word, imageId) => {
    const t = `${theme ?? ""}`.trim();
    const w = `${word ?? ""}`.trim();
    if (!t || !w || !IMAGE_ID.test(imageId ?? "")) return;
    const cle = cleTheme(t) || t.toLowerCase();
    const f = parTheme.get(cle) ?? { theme: t.slice(0, 60), objects: [] };
    parTheme.set(cle, f);
    if (f.objects.some((o) => o.imageId === imageId || o.word.toLowerCase() === w.toLowerCase())) return;
    f.objects.push({ word: w.slice(0, 40), imageId });
  };
  for (const [id, q] of Object.entries(quizzes ?? {})) {
    if (!q?.pack || estQuizDeTest(id) || quizKind(q) !== "photo") continue;
    const theme = themeDe(q.theme, q.title);
    for (const x of Object.values(q.questions ?? {})) {
      const choix = Array.isArray(x?.choices) ? x.choices : Object.values(x?.choices ?? {});
      choix.forEach((c, k) => ajouter(theme, c, x?.choiceImages?.[k]));
    }
  }
  for (const x of activeItems("quisuis", contents.quisuis)) if (x.serie) ajouter(x.serie, x.answer, x.imageId);
  return [...parTheme.values()].filter((f) => f.objects.length >= DISPARU_CARTES[0]);
}

/**
 * Le champ du 🎲 de Qui a disparu ? (cedric, 27/10 : « comme pour les quiz ») : on tape librement ; dessous, les
 * familles qui répondent (de la source choisie), filtrées en direct (celles qui commencent par le mot d'abord) ; un
 * clic met son nom dans le champ. Entrée lance le 🎲.
 */
function champFamilles({ classe, valeur = "", placeholder = "Tout au hasard… ou une famille, un objet", familles, entree }) {
  const champ = h("input", { type: "search", class: `quiz-ajout-cherche ${classe}`, placeholder, value: valeur, maxlength: "80",
    "aria-label": "Où piocher : vide, au hasard dans toutes les familles ; ou une famille, un objet" });
  const liste = h("div", { class: "quiz-ajout-liste packs-suggestions" });
  liste.hidden = true;
  liste.addEventListener("mousedown", (e) => e.preventDefault());
  const dessiner = () => {
    const t = champ.value.trim();
    const toutes = familles();
    const items = toutes.map((x) => ({ titre: x.theme, details: `${plural(x.objects.length, "objet")} · ${isPhotoTheme(x) ? "photos libres" : familleReelle(x) ? "images des packs" : "émojis"}`, mots: x.objects.map((o) => o.word) }));
    const trouves = t ? parPertinence(items.filter((x) => contientTout([x.titre, ...(x.mots ?? [])], t)), t, (x) => [x.titre], (x) => x.mots ?? []) : items;
    liste.replaceChildren(...trouves.slice(0, QUIZ_AJOUT_MAX + 2).map((x) => h("button", { type: "button", class: "quiz-ajout-item packs-suggestion", onclick: () => { champ.value = x.titre; champ.dispatchEvent(new Event("input")); liste.hidden = true; } },
      h("b", { text: x.titre }), h("span", { class: "small", text: x.details }))));
    liste.hidden = !trouves.length;
  };
  champ.addEventListener("input", dessiner);
  champ.addEventListener("focus", dessiner);
  champ.addEventListener("blur", () => { liste.hidden = true; });
  champ.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); liste.hidden = true; entree?.(); } });
  return { champ, bloc: h("div", { class: "quiz-ajout-champ" }, champ, liste) };
}

/**
 * Qui a disparu ? (cedric, 27/10 : « comme les autres jeux ») : 1re ligne, l'âge (celui de la prestation d'office ; des
 * familles plus simples pour les petits, plus dures pour les grands), les cartes par tour (4, 6 ou 8) et le nombre de
 * tours du 🎲 ; 2e ligne, le 🎲 et son champ : vide, au hasard dans toutes les familles (émojis et photos libres, jamais
 * « Mes images ») ; « émojis », « photos libres », ou un mot (une famille, un objet). Chaque clic ajoute ses tours à la
 * suite du « complet », jamais une famille déjà là ; leurs objets d'abord parmi ceux qu'aucun autre jeu ne montre.
 */
function desGrilles(r, { sans, ranger, changer, ailleurs }) {
  const type = "disparu";
  const game = CONTENT_GAMES[type];
  const n = cartesDe(r);
  const reglage = reglageDuDe(r, "unique");
  const nombre = () => (GRILLES_NOMBRES.includes(reglage.n) ? reglage.n : BUILTIN_GAMES[type].count);
  // Émojis et photos libres (jamais « Mes images »), puis les images des packs bien cadrées ; selon la source choisie.
  const toutes = () => [...activeItems(type, contents[type]).map((x) => pourLeHasard(type, x)).filter(Boolean), ...famillesDesPacks()];
  const familles = () => {
    const src = sourceDisparu(r);
    return toutes().filter((t) => src === "mixte" || (src === "reelles") === familleReelle(t));
  };
  const repond = (t, terme) => !terme || t.theme.toLowerCase() === terme.toLowerCase() || contientTout([t.theme, ...t.objects.map((o) => o.word)], terme);
  const enTour = (t) => ({ theme: t.theme, objects: shuffle(neufsSiPossible(t.objects, concepts, ailleurs, n)).slice(0, n) });
  const choisir = (k, terme, exclus) => famillesPourLAge(familles().filter((t) => t.objects.length >= n && !exclus.has(game.key(t)) && repond(t, terme)), ageDuQuiz(r))
    .slice(0, k).map(enTour);
  /** Un tour à [k] cartes : coupé, ou complété par d'autres objets de sa famille (un tour de vos images reste tel quel). */
  const ajuster = (m, k = n) => {
    if (!m || m.vide || !Array.isArray(m.objects) || m.objects.length === k) return m;
    if (m.objects.length > k) return { ...m, objects: m.objects.slice(0, k) };
    const famille = toutes().find((t) => t.theme === m.theme);
    const deja = new Set(m.objects.map((o) => o.word));
    const plus = famille ? shuffle(neufsSiPossible(famille.objects.filter((o) => !deja.has(o.word)), concepts, ailleurs, k - m.objects.length)).slice(0, k - m.objects.length) : [];
    return { ...m, objects: [...m.objects, ...plus] };
  };
  const age = menuAge(ageDuQuiz(r), { class: "tirage-profil quiz-age disparu-age", "aria-label": "Âge : des familles plus simples pour les petits, plus dures pour les grands" }, (v) => {
    // Les tours déjà là gardent leurs cartes.
    if (r.seriesMots.length) r.objects = n;
    r.profil = v;
    changer();
  });
  const cartes = h("select", { class: "tirage-nombre disparu-cartes", "aria-label": "Cartes par tour", onchange: (e) => {
    const k = Number(e.target.value);
    r.objects = k;
    for (const x of r.seriesMots) x.mots = x.mots.map((m) => ajuster(m, k));
    const courts = r.seriesMots.flatMap((x) => x.mots).filter((m) => !m.vide && m.objects.length < k);
    if (courts.length) annonce(`${courts.map((m) => `« ${m.theme} »`).join(", ")} : moins de ${k} images, ${courts.length > 1 ? "ils restent" : "il reste"} tel${courts.length > 1 ? "s" : ""} quel${courts.length > 1 ? "s" : ""}.`);
    ranger();
    changer();
    noterEcran();
  } }, ...DISPARU_CARTES.map((k) => h("option", { value: k, selected: k === n, text: `${k} cartes par tour` })));
  const images = h("select", { class: "tirage-nombre disparu-images", "aria-label": "Images du 🎲 : émojis, images réelles ou les deux", onchange: (e) => { r.images = e.target.value; changer(); } },
    ...Object.entries(SOURCES_DISPARU).map(([k, texte]) => h("option", { value: k, selected: k === sourceDisparu(r), text: texte })));
  const tours = h("select", { class: "tirage-nombre de-nombre de-nombre-unique disparu-tours", "aria-label": "Nombre de tours de ce 🎲", onchange: (e) => { reglage.n = Number(e.target.value); } },
    ...GRILLES_NOMBRES.map((k) => h("option", { value: k, selected: k === nombre(), text: plural(k, "tour") })));
  const source = champFamilles({ classe: "de-unique-champ", valeur: reglage.terme ?? "", familles, entree: () => tirer() });
  source.champ.addEventListener("input", () => { reglage.terme = source.champ.value; });
  const tirer = () => {
    const terme = source.champ.value.trim();
    reglage.terme = terme;
    const place = MAX_MOTS - motsDuJeu(r).length;
    if (place <= 0) { annonce(`Déjà ${MAX_MOTS} tours : c'est le maximum.`); return; }
    const k = nombre();
    const neufs = choisir(Math.min(k, place), terme, sans());
    if (!neufs.length) {
      annonce(terme ? `Aucune famille libre ne répond à « ${terme} » en ${SOURCES_DISPARU[sourceDisparu(r)].toLowerCase()} (${n} objets au moins) : essayez un autre mot, une autre source, ou videz le champ.` : "Plus aucune famille libre à tirer : changez la source des images, ou ajoutez-en dans la page du jeu.");
      return;
    }
    if (neufs.length < k) annonce(`Seulement ${plural(neufs.length, "famille libre", "familles libres")}${terme ? ` pour « ${terme} »` : ""} : ${plural(neufs.length, "tour")}.`);
    r.objects = n;
    aLaSuite(r, () => {
      let de = r.seriesMots.find((x) => x.origine === "de");
      if (!de) { de = { id: "de", origine: "de", mots: [] }; r.seriesMots.unshift(de); }
      de.mots = [...de.mots, ...neufs];
      r.count = de.mots.length;
    });
    ranger();
    changer();
    noterEcran();
  };
  const lignes = [
    h("div", { class: "de-ligne disparu-reglages" },
      h("span", { class: "quiz-ajout-titre disparu-age-titre", text: "🎂 Âge" }), age, images, cartes, tours),
    h("div", { class: "de-ligne de-unique-ligne" },
      h("button", { type: "button", class: "btn packs-de de-unique", text: "🎲", "aria-label": "Tirer les tours", title: "Tirer les tours : au hasard, ou sur ce qui est tapé à droite", onclick: tirer }),
      source.bloc),
  ];
  return {
    lignes, ajuster,
    unMot: (terme) => choisir(1, terme, sans())[0] ?? null,
    champCase: (entree) => champFamilles({ classe: "quiz-case-champ", placeholder: "Au hasard, ou une famille", familles, entree }),
  };
}

/**
 * Chante le mot ! dans une prestation (cedric, 24/10 : « à la manière des quiz ») : le 🎲 tire le nombre de mots choisi
 * dans les mots du jeu (selon l'âge, jamais un mot déjà dans la fête tant qu'il en reste) ; une ligne pour écrire un
 * mot à la main ; puis les séries et le « Chante le mot ! complet » (↑ ↓ ✕, 🔀). Un mot n'y passe qu'une fois ; écrit à
 * la main alors qu'il sert déjà ailleurs dans la fête : en rouge, mais possible (« Jamais deux fois »).
 */
function mancheMots(r) {
  if (!Array.isArray(r.seriesMots)) r.seriesMots = seriesMots(r);
  const type = r.type;
  const game = CONTENT_GAMES[type];
  const builtin = BUILTIN_GAMES[type];
  const jeu = ROUND_TYPES[type];
  // Qui a disparu ? (cedric, 27/10) : des tours (une grille de cartes, l'une disparaît, puis la révélation).
  const unite = type === "disparu" ? "tour" : builtin.unit;
  // Qui suis-je ? (cedric, 24/10) : pas de personnage écrit ici (il lui faut ses indices) ; à la place, les personnages
  // d'un ancien anniversaire et les séries de la bibliothèque ; chacun avec sa petite image, celle de la révélation.
  const quisuis = type === "quisuis";
  // Qui suis-je ? (cedric, 26/10) : la carte du Quiz, une seule ligne de 🎲, une place retirée reste à sa place.
  // Qui a disparu ? (cedric, 27/10) : la même carte, chaque tour montre ses cartes en petit.
  const disparu = type === "disparu";
  const unique = (quisuis && deUnique(r)) || disparu;
  const nomDe = (m) => m.word ?? m.answer ?? m.theme ?? "";
  const e = "";
  const ce = "ce";
  const tous = "tous";
  const NOMBRES = disparu ? GRILLES_NOMBRES : MOTS_NOMBRES;
  const nMots = (k) => `${k} ${unite}${k > 1 ? "s" : ""}`;
  const series = r.seriesMots;
  const deSerie = series.find((x) => x.origine === "de") ?? null;
  const n = deSerie?.mots.length || (NOMBRES.includes(r.count) ? r.count : builtin.count);
  const changer = () => roundCtx.refresh();
  const ailleurs = roundCtx.elsewhere?.(r) ?? new Map();
  // Qui a disparu ? : ce que montre une grille, objet par objet.
  const conceptsDe = (m) => (disparu ? (m.objects ?? []).flatMap(concepts) : builtinConcepts(type, m));
  const autreJeu = (m) => conceptsDe(m).map((c) => ailleurs.get(c)).find(Boolean) ?? null;
  /** Après chaque changement : les séries vides partent ; l'ancienne façon (mots choisis un par un) laisse la place. */
  const ranger = () => {
    r.seriesMots = r.seriesMots.filter((x) => x.mots.length);
    if (r.seriesMots.length) { r.picks = null; r.hasard = null; }
  };
  const cles = (sauf = null) => new Set(r.seriesMots.filter((x) => x !== sauf).flatMap((x) => x.mots.map((m) => cleDuMot(type, m))).filter(Boolean));
  const ecartes = () => new Set([...cles(), ...(motsRetires.get(r) ?? [])]);
  const ecarter = (cle) => motsRetires.set(r, new Set([...(motsRetires.get(r) ?? []), cle]));
  const place = () => Math.max(0, MAX_MOTS - motsDuJeu(r).length);
  // Au hasard : émojis et banque de photos seulement, jamais une image téléversée (cedric, 21/10) ; selon l'âge ;
  // « Jamais deux fois » : rien de ce que montrent les autres jeux de la fête, tant qu'il en reste assez.
  // Qui a disparu ? : des familles d'émojis (le 🎲) ou de photos libres ([origine] « photos ») ; chacune donne une grille
  // de ses objets, d'abord ceux qu'aucun autre jeu de la fête ne montre.
  const piocher = (k, sans, origine = "de", age = null) => {
    if (k <= 0) return [];
    // Qui suis-je ? (cedric, 25/10) : le 🎲 des personnages du jeu ; ceux de mes séries (mes packs) ont leurs dés.
    const libres = activeItems(type, contents[type]).filter((m) => !disparu || (origine === "photos") === isPhotoTheme(m)).filter((m) => !quisuis || !m.serie)
      .map((x) => pourLeHasard(type, x)).filter(Boolean).filter((m) => !sans.has(cleDuMot(type, m)));
    if (disparu) {
      const nObjets = objetsParGrille(r);
      return shuffle(libres).slice(0, k).map((t) => ({ theme: t.theme, objects: shuffle(neufsSiPossible(t.objects, concepts, ailleurs, nObjets)).slice(0, nObjets) }));
    }
    const pourAge = builtin.items(age ?? roundCtx.profile?.() ?? "MOYENS", Math.random, libres, r);
    return shuffle(neufsSiPossible(pourAge, (m) => builtinConcepts(type, m), ailleurs, k)).slice(0, k);
  };

  // Première ligne : le nombre et le 🎲 (il remplace la série du 🎲 ; les autres séries ne bougent pas).
  const tirerTout = (k) => {
    motsRetires.delete(r);
    const sans = cles(deSerie);
    const mots = piocher(Math.min(k, MAX_MOTS - sans.size), sans);
    if (!mots.length) return annonce(`Plus aucun${e} ${unite} libre à tirer : ajoutez-en dans la page du jeu${quisuis || disparu ? "" : ", ou écrivez-les à la main"}.`);
    const serie = deSerie ?? { id: "de", origine: "de", mots: [] };
    if (!deSerie) r.seriesMots.unshift(serie);
    serie.mots = mots;
    r.count = k;
    seriesDepliees.add(serie);
    ranger();
    changer();
  };
  const nombre = h("select", {
    class: "tirage-nombre mots-nombre", "aria-label": `Nombre de ${unite}s à tirer au hasard`,
    onchange: (e) => {
      const k = Number(e.target.value);
      r.count = k;
      // Moins de mots : les premiers restent ; plus : le 🎲 complète sa série.
      if (deSerie) {
        const gardes = deSerie.mots.slice(0, k);
        const sans = new Set([...ecartes(), ...gardes.map((m) => cleDuMot(type, m))]);
        deSerie.mots = [...gardes, ...piocher(Math.min(k - gardes.length, MAX_MOTS - cles(deSerie).size - gardes.length), sans)].slice(0, k);
        ranger();
      }
      changer();
    },
  }, ...[...new Set([...NOMBRES, n])].sort((a, b) => a - b).map((k) => h("option", { value: k, selected: k === n, text: `${nMots(k)} au hasard` })));
  const ligne = h("div", { class: "tirage-ligne" },
    nombre,
    h("button", {
      type: "button", class: "btn tirage-de", text: "🎲", "aria-label": `Tirer les ${unite}s au hasard`,
      title: disparu ? "Tirer les grilles au hasard dans les familles d'émojis (les autres séries ne bougent pas)"
        : `Tirer les ${unite}s au hasard, selon l'âge (les ${quisuis ? "autres séries" : `${unite}s écrits à la main`} ne bougent pas)`, onclick: () => tirerTout(Number(nombre.value)),
    }));

  // Deuxième ligne : écrire un mot à la main ; il rejoint la série « écrits à la main », à la fin.
  const champ = h("input", { type: "text", class: "mots-ecrire", maxlength: 40, "aria-label": `Écrire un ${unite}`, placeholder: `Écrire un ${unite} à chanter…` });
  const ajouter = () => {
    const m = game.clean({ word: champ.value });
    if (!m) { champ.focus(); return; }
    const cle = cleDuMot(type, m);
    if (cles().has(cle)) { annonce(`« ${m.word} » est déjà dans ce jeu.`); champ.select(); return; }
    if (!place()) { annonce(`${MAX_MOTS} ${unite}s au plus dans ${jeu} : retirez-en avant d'en ajouter.`); return; }
    let main = r.seriesMots.find((x) => x.origine === "main");
    if (!main) { main = { id: nouvelId("m"), origine: "main", mots: [] }; r.seriesMots.push(main); }
    main.mots.push(m);
    seriesDepliees.add(main);
    ranger();
    motAFocaliser = r;
    changer();
    noterEcran();
  };
  champ.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ajouter(); } });
  const ecrire = h("div", { class: "quiz-ajouts mots-main" },
    h("span", { class: "quiz-ajout-titre mots-main-titre", text: `✍ Écrire un ${unite} à la main` }),
    h("div", { class: "quiz-ajout-champ mots-main-champ" }, champ,
      h("button", { type: "button", class: "btn secondary mots-ajouter", text: "＋ Ajouter", onclick: ajouter })));
  // Qui suis-je ? : une série entière (ancien anniversaire, bibliothèque), copiée à la fin, sans ce qui est déjà dans ce jeu.
  const ajouterSerie = (origine, titre, mots) => {
    const deja = cles();
    const neufs = mots.map((m) => game.clean(m)).filter(Boolean).filter((m) => !deja.has(cleDuMot(type, m)) && deja.add(cleDuMot(type, m))).slice(0, place());
    if (!neufs.length) return annonce(place() ? `Tous ces ${unite}s sont déjà dans ${jeu}.` : `${MAX_MOTS} ${unite}s au plus dans ${jeu} : retirez-en avant d'en ajouter.`);
    const serie = { id: nouvelId(origine === "reprise" ? "p" : "b"), origine, titre, mots: neufs };
    r.seriesMots.push(serie);
    seriesDepliees.add(serie);
    ranger();
    changer();
    noterEcran();
  };
  // Qui a disparu ? : les tours d'un ancien anniversaire, à autant de cartes que les autres.
  const grilles = disparu ? desGrilles(r, { sans: ecartes, ranger, changer, ailleurs }) : null;
  const rappel = quisuis || disparu ? ligneAjoutQuiz({
    classe: "quiz-rappel", titre: `📚 Rappeler les ${disparu ? "tours" : "personnages"} d'un ancien anniversaire`, label: "Chercher une prestation archivée",
    placeholder: "Prénom, âge, date… d'une prestation archivée", vide: "Aucun ancien anniversaire avec ce jeu",
    aucun: "Aucune prestation archivée ne correspond.", items: motsArchives(type, unite), attr: (x) => ({ "data-show": x.id }),
    choisir: (x) => ajouterSerie("reprise", x.titre, disparu ? x.mots.map((m) => grilles.ajuster(m)) : x.mots),
  }) : null;
  // Qui a disparu ? : une grille composée avec vos images rejoint la série « vos images », à la fin.
  const ajouterGrille = (objets) => {
    if (!place()) return annonce(`${MAX_MOTS} tours au plus dans ${jeu} : retirez-en avant d'en ajouter.`);
    let k = 1;
    while (cles().has(`vos images ${k}`)) k++;
    aLaSuite(r, () => {
      let s = r.seriesMots.find((x) => x.origine === "images");
      if (!s) { s = { id: nouvelId("i"), origine: "images", mots: [] }; r.seriesMots.push(s); }
      s.mots.push({ theme: `Vos images ${k}`, objects: objets });
    });
    ranger();
    changer();
    noterEcran();
  };
  const persos = quisuis ? desPersonnages(r, { piocherBanque: (k, sans, age) => piocher(k, sans, "de", age), cles, ranger, changer }) : null;
  // Le petit 🎲 et le champ d'une place vide du « complet » : ceux des personnages, ou des tours.
  const deCase = disparu ? grilles : persos;
  if (unique) rappel.classList.add("fine");
  const outils = disparu ? h("div", { class: "quiz-outils" }, ...grilles.lignes, rappel, ligneGrilleVosImages(r, ajouterGrille, changer))
    : unique ? h("div", { class: "quiz-outils" }, persos.ligneUnique, rappel)
    : quisuis ? h("div", { class: "quiz-outils" }, ...persos.lignes, rappel)
    : h("div", { class: "quiz-outils" }, ligne, ecrire);

  // Qui suis-je ? : la petite image du personnage (cedric, 24/10 : « vérifier qu'elle me convient »), celle que la TV
  // montre à la révélation : son image, sinon son émoji ; tiré au 🎲, jamais une image téléversée.
  const vignette = (m) => (m.imageId ? photoBibliotheque(m.imageId, { class: "tirage-mini", alt: "", title: "Image montrée à la révélation" })
    : h("span", { class: "tirage-mini emoji", text: m.emoji || "❔", title: m.emoji ? "Émoji montré à la révélation" : "Ni image ni émoji : la TV montrera seulement son nom" }));
  // Un mot dans une liste : déjà dans un autre jeu de la fête, en rouge. Un personnage : ses indices dessous.
  const texteMot = (m) => {
    const autre = autreJeu(m);
    return [quisuis ? imageRecadrable(vignette(m), r, m, changer) : null, h("span", { class: "tirage-texte mot-texte" }, nomDe(m),
      quisuis ? h("small", { class: "mot-indices", text: m.clues.join(" · ") }) : null,
      disparu ? h("span", { class: "grille-vignettes" }, ...(m.objects ?? []).map((o, k) => objetRecadrable(vignetteObjet(o), r, m, k, changer))) : null,
      autre ? h("small", { class: "mot-deja", text: `Déjà dans « ${autre} »` }) : null)];
  };
  // ✕ : au 🎲, un 🎲 prend sa place ; écrit à la main, il part.
  const retirer = (serie, i) => {
    const m = serie.mots[i];
    ecarter(cleDuMot(type, m));
    if (unique) {
      // La place garde la clé du personnage : elle reste là où il était dans l'ordre de passage.
      if (!Object.values(r.ordreMots ?? {}).length) r.ordreMots = motsDuJeu(r).map((x) => x.cle);
      serie.mots[i] = { vide: true, cle: cleDuMot(type, m) };
    } else if (serie.origine === "de" || serie.origine === "photos" || serie.pioche) serie.mots[i] = { vide: true };
    else serie.mots.splice(i, 1);
    ranger();
    changer();
    noterEcran();
  };
  const corps = (serie) => serie.mots.map((m, i) => (m.vide
    ? h("li", { class: "tirage-q vide" }, h("div", { class: "tirage-q-ligne" },
      h("button", { type: "button", class: "btn tirage-de petit", text: "🎲", "aria-label": `Tirer ${disparu ? "une autre" : "un autre"} ${unite}`, title: `Tirer ${disparu ? "une autre" : "un autre"} ${unite}`, onclick: () => {
        const [neuf] = piocher(1, ecartes(), serie.origine);
        if (!neuf) return annonce(`Plus aucun${e} ${unite} libre à tirer : ${quisuis || disparu ? "ajoutez-en dans la page du jeu" : "écrivez-le à la main"}.`);
        serie.mots[i] = neuf;
        ranger();
        changer();
      } }),
      h("span", { class: "hint small", text: `${unite[0].toUpperCase()}${unite.slice(1)} à tirer` })))
    : h("li", { class: `tirage-q${quisuis || disparu ? " perso" : ""}${autreJeu(m) ? " deja" : ""}`, "data-mot": cleDuMot(type, m) }, h("div", { class: "tirage-q-ligne" },
      ...texteMot(m),
      h("button", { type: "button", class: "icon tirage-retirer", text: "✕", "aria-label": `Retirer « ${nomDe(m)} »`, title: serie.origine === "de" || serie.origine === "photos" ? `Retirer ${ce} ${unite} (un 🎲 prend sa place)` : `Retirer ${ce} ${unite}`, onclick: () => retirer(serie, i) })))));
  const titreSerie = (x) => {
    const k = x.mots.filter((m) => !m.vide).length;
    const vides = x.mots.length - k;
    if (x.origine === "de") return `🎲 ${nMots(k)} tiré${e}${k > 1 ? "s" : ""} au hasard${disparu ? " (émojis)" : ""}${vides ? `, ${vides} à tirer` : ""}`;
    if (x.origine === "photos") return `📷 ${nMots(k)} de photos libres${vides ? `, ${vides} à tirer` : ""}`;
    if (x.origine === "images") return `⭐ ${nMots(k)} de vos images`;
    if (x.origine === "reprise") return `📅 ${x.titre ?? `${unite[0].toUpperCase()}${unite.slice(1)}s repris`} : ${nMots(k)}`;
    if (x.origine === "biblio") return `📚 Série « ${x.titre ?? "sans nom"} » : ${nMots(k)}`;
    return quisuis || disparu ? `✋ ${nMots(k)} choisi${e}${k > 1 ? "s" : ""} ${disparu ? "une par une" : "un par un"}` : `✍ ${nMots(k)} écrit${k > 1 ? "s" : ""} à la main`;
  };
  const liste = h("ol", { class: "quiz-series" }, ...series.map((x) => {
    const qs = h("ol", { class: "tirage-liste serie-liste" }, ...corps(x));
    qs.hidden = !seriesDepliees.has(x);
    const voir = h("button", {
      type: "button", class: "chip tirage-voir serie-voir", "aria-expanded": qs.hidden ? "false" : "true", text: `${qs.hidden ? "▸" : "▾"} ${titreSerie(x)}`,
      title: `Voir ou cacher les ${unite}s de cette série`,
      onclick: (e) => {
        qs.hidden = !qs.hidden;
        if (qs.hidden) seriesDepliees.delete(x); else seriesDepliees.add(x);
        e.currentTarget.textContent = `${qs.hidden ? "▸" : "▾"} ${titreSerie(x)}`;
        e.currentTarget.setAttribute("aria-expanded", qs.hidden ? "false" : "true");
      },
    });
    const enlever = async () => {
      const k = x.mots.filter((m) => !m.vide).length;
      if (k && !(await confirmer(`Enlever cette série (${nMots(k)}) de ${jeu} ?`, { ok: "Enlever", danger: true }))) return;
      r.seriesMots = r.seriesMots.filter((y) => y !== x);
      ranger();
      changer();
      noterEcran();
    };
    return h("li", { class: "serie", "data-origine": x.origine },
      h("div", { class: "serie-tete" }, voir,
        h("button", { type: "button", class: "icon serie-enlever", text: "✕", title: `Enlever cette série de ${jeu}`, "aria-label": "Enlever cette série", onclick: enlever })),
      qs);
  }));

  // Dernière ligne : « Chante le mot ! complet » : tous les mots dans l'ordre de passage, ↑ ↓ ✕, 🔀 Mélanger.
  const ordre = motsDuJeu(r);
  // Qui suis-je ? : les places vides à leur place (après le personnage qui les précédait dans l'ordre de passage).
  const vue = unique ? (() => {
    const liste = [...ordre];
    const rang = Object.values(r.ordreMots ?? {});
    r.seriesMots.forEach((serie) => serie.mots.forEach((m, i) => {
      if (m?.vide !== true) return;
      const x = { vide: true, serie, i, cle: typeof m.cle === "string" && m.cle ? m.cle : null };
      const k = x.cle ? rang.indexOf(x.cle) : -1;
      const avant = k < 0 ? -1 : liste.findIndex((y) => rang.indexOf(y.cle) > k);
      if (avant < 0) liste.push(x); else liste.splice(avant, 0, x);
    }));
    return liste;
  })() : ordre;
  const nVides = vue.length - ordre.length;
  const poser = (liste) => { r.ordreMots = liste.map((x) => x.cle).filter(Boolean); changer(); noterEcran(); };
  const deplacer = (k, d) => {
    const j = k + d;
    if (j < 0 || j >= vue.length) return;
    const nouvel = [...vue];
    [nouvel[k], nouvel[j]] = [nouvel[j], nouvel[k]];
    poser(nouvel);
  };
  const melanger = () => {
    let nouvel = shuffle(ordre);
    for (let essai = 0; essai < 5 && ordre.length > 1 && nouvel.every((x, k) => x === ordre[k]); essai++) nouvel = shuffle(ordre);
    poser(nouvel);
  };
  // ✕ dans le « complet » : comme dans sa série.
  const enleverDuComplet = (x) => {
    const serie = r.seriesMots.find((y) => y.id === x.serie.id);
    const i = serie ? serie.mots.findIndex((m) => cleDuMot(type, m) === x.cle) : -1;
    if (i >= 0) retirer(serie, i);
  };
  // Une place vide : son petit 🎲 et son champ (mêmes règles que la ligne de 🎲), une ✕ qui la supprime pour de bon.
  const caseVideMot = (x, k) => {
    const changerOrdre = (f) => { if (x.cle && Object.values(r.ordreMots ?? {}).length) r.ordreMots = f(Object.values(r.ordreMots)); };
    const libre = disparu ? "famille libre" : "personnage libre";
    const remplir = (terme) => {
      const neuf = deCase.unMot(terme);
      if (!neuf) { annonce(terme ? `Plus aucun${disparu ? "e" : ""} ${libre} sur « ${terme} » : essayez un autre mot, ou videz le champ.` : `Plus aucun${disparu ? "e" : ""} ${libre} ici : changez l'âge.`); return; }
      x.serie.mots[x.i] = neuf;
      changerOrdre((liste) => liste.map((c) => (c === x.cle ? cleDuMot(type, neuf) : c)));
      ranger();
      changer();
      noterEcran();
    };
    const supprimer = () => {
      x.serie.mots.splice(x.i, 1);
      changerOrdre((liste) => liste.filter((c) => c !== x.cle));
      ranger();
      changer();
      noterEcran();
    };
    const { champ, bloc } = deCase.champCase(() => remplir(champ.value.trim()));
    bloc.classList.add("quiz-case-source");
    return h("li", { class: "tirage-q vide packs-case quiz-case-vide" }, h("div", { class: "tirage-q-ligne" },
      h("span", { class: "quiz-complet-num", text: `${k + 1}` }),
      h("button", { type: "button", class: "btn packs-de petit quiz-case-de", text: "🎲", "aria-label": `Tirer un autre ${unite}`, title: `Un autre ${unite} : au hasard, ou sur ce qui est tapé à côté`, onclick: () => remplir(champ.value.trim()) }),
      bloc,
      h("button", { type: "button", class: "icon tirage-retirer quiz-case-retirer", text: "✕", title: "Supprimer cette place", "aria-label": "Supprimer cette place", onclick: supprimer })));
  };
  const lignesCompletes = vue.map((x, k) => (x.vide ? caseVideMot(x, k) : h("li", { class: `tirage-q quiz-complet-q${quisuis || disparu ? " perso" : ""}${autreJeu(x.m) ? " deja" : ""}`, "data-mot": x.cle },
    h("div", { class: "tirage-q-ligne" },
      h("span", { class: "quiz-complet-num", text: `${k + 1}` }),
      ...texteMot(x.m),
      h("button", { type: "button", class: "icon quiz-complet-monter", text: "↑", title: `Passer ${ce} ${unite} plus tôt`, "aria-label": `Monter « ${nomDe(x.m)} »`, disabled: k === 0, onclick: () => deplacer(k, -1) }),
      h("button", { type: "button", class: "icon quiz-complet-descendre", text: "↓", title: `Passer ${ce} ${unite} plus tard`, "aria-label": `Descendre « ${nomDe(x.m)} »`, disabled: k === vue.length - 1, onclick: () => deplacer(k, 1) }),
      h("button", { type: "button", class: "icon tirage-retirer", text: "✕", title: `Enlever ${ce} ${unite} de ${jeu}`, "aria-label": `Enlever « ${nomDe(x.m)} »`, onclick: () => enleverDuComplet(x) })))));
  const listeComplete = h("ol", { class: "tirage-liste serie-liste quiz-complet-liste" }, ...lignesCompletes);
  glisserDansLaListe(listeComplete, lignesCompletes, (k, j) => poser(deplaceEn(vue, k, j)), (k) => !vue[k].vide);
  listeComplete.hidden = unique ? motsCompletsFermes.has(r) : !motsCompletsDeplies.has(r);
  const titreComplet = () => `${listeComplete.hidden ? "▸" : "▾"} 🧩 ${jeu} complet : ${nMots(ordre.length)}, dans l'ordre de passage${nVides ? ` (${nVides} à tirer)` : ""}`;
  const complet = h("div", { class: "serie quiz-complet mots-complet" },
    h("div", { class: "serie-tete" },
      h("button", {
        type: "button", class: "chip tirage-voir serie-voir quiz-complet-voir", "aria-expanded": listeComplete.hidden ? "false" : "true", text: titreComplet(),
        title: `Voir ${tous} les ${unite}s de ${jeu}, dans l'ordre`,
        onclick: (e) => {
          listeComplete.hidden = !listeComplete.hidden;
          if (listeComplete.hidden) motsCompletsDeplies.delete(r); else motsCompletsDeplies.add(r);
          if (listeComplete.hidden) motsCompletsFermes.add(r); else motsCompletsFermes.delete(r);
          e.currentTarget.textContent = titreComplet();
          e.currentTarget.setAttribute("aria-expanded", listeComplete.hidden ? "false" : "true");
        },
      }),
      h("button", { type: "button", class: "chip quiz-melanger", text: "🔀 Mélanger", title: `Mélanger ${tous} les ${unite}s de ${jeu}`, disabled: ordre.length < 2, onclick: melanger })),
    listeComplete);

  const compteur = h("p", {
    class: "quiz-compteur", "aria-live": "polite",
    text: (ordre.length ? nMots(ordre.length) : `Aucun${e} ${unite} pour l'instant${nVides ? "" : ` : la TV en tirera ${r.count ?? builtin.count} au hasard`}`) + (unique && nVides ? ` · ${nVides} à tirer` : ""),
  });
  // Un mot écrit à la main : le curseur reste dans la case, pour le suivant.
  if (motAFocaliser === r) {
    motAFocaliser = null;
    requestAnimationFrame(() => document.querySelector(`#show-rounds [data-manche="${editing?.rounds.indexOf(r)}"] .mots-ecrire`)?.focus());
  }
  if (unique) return [compteur, persos?.enTete ?? null, outils, vue.length ? complet : null];
  if (quisuis) {
    // Les personnages retirés (tirés au 🎲) : leurs dés en tête du « complet », qui s'ouvre.
    const vides = series.flatMap((x) => x.mots.map((m, i) => (m.vide ? persos.caseVide(x, i) : null)).filter(Boolean));
    if (vides.length) { listeComplete.prepend(...vides); listeComplete.hidden = false; motsCompletsDeplies.add(r); }
    return [compteur, outils, ordre.length || vides.length ? complet : null];
  }
  return [compteur, outils, series.length ? liste : null, ordre.length ? complet : null];
}

/** Jeux intégrés et Pictionary : éléments choisis un par un parmi ceux de la page du jeu. */
function picksSelection(r) {
  const game = CONTENT_GAMES[r.type];
  const builtin = BUILTIN_GAMES[r.type];
  const unit = r.type === "disparu" ? "famille" : game.unit;
  let memo = null;
  const byKey = () => {
    if (!memo || memo.src !== contents[r.type]) memo = { src: contents[r.type], map: new Map(activeItems(r.type, contents[r.type]).map((x) => [game.key(x), x])) };
    return memo.map;
  };
  return selectionEditor({
    unit,
    round: r,
    conceptsOf: (k) => builtinConcepts(r.type, byKey().get(k)),
    empty: r.type === "pictionary" ? "Aucun mot choisi : tirage au hasard au lancement, dans les séries cochées." : unit === "famille" ? "Aucune famille choisie : tirage au hasard au lancement." : `Aucun ${unit} choisi : tirage au hasard au lancement.`,
    // Qui a disparu ? en émojis : les familles en photos n'y sont pas (sauf celles déjà choisies).
    items: () => activeItems(r.type, contents[r.type]).filter((x) => r.type !== "disparu" || r.photos === true || !isPhotoTheme(x) || roundPicks(r).includes(game.key(x)))
      .map((x) => ({ key: game.key(x), label: game.label(x), group: r.type === "pictionary" ? pictoSeriesOf(x) : r.type === "disparu" ? disparuGroup(x) : undefined })),
    get: () => roundPicks(r),
    set: (keys) => {
      const had = roundPicks(r).length > 0;
      r.picks = keys.length ? keys : null;
      // Le nombre d'éléments ne sert qu'au tirage au lancement : caché dès qu'on choisit, remis sinon.
      if (had !== keys.length > 0) queueMicrotask(() => roundCtx.refresh());
    },
    draw: () => {
      const profile = roundCtx.profile();
      // « Jamais deux fois » : rien de ce que montrent les autres manches, tant qu'il en reste assez.
      const autres = roundCtx.elsewhere?.(r);
      const neufs = (list, need) => neufsSiPossible(list, (x) => builtinConcepts(r.type, x), autres, need);
      // Au hasard : émojis et banque de photos seulement, jamais une image téléversée (cedric, 21/10) ; les éléments
      // tirés sont notés dans la manche (`hasard`), ceux ajoutés ensuite à la main gardent leurs images.
      const libres = activeItems(r.type, contents[r.type]).map((x) => pourLeHasard(r.type, x)).filter(Boolean);
      const tires = (keys) => { r.hasard = keys; return keys; };
      if (r.type === "pictionary") {
        const series = pictoRoundSeries(r);
        const words = libres.filter((w) => (profile !== "PETITS" || w.level !== 2) && (!series || series.includes(pictoSeriesOf(w))));
        return tires(shuffle(neufs(words, PICTO_DRAW)).slice(0, PICTO_DRAW).map(game.key));
      }
      const count = r.count ?? builtin.count;
      return tires(shuffle(builtin.items(profile, Math.random, neufs(libres, count), r)).slice(0, count).map((x) => game.key(r.type === "disparu" ? { theme: x.theme } : x)));
    },
  });
}

/** Quiz d'une manche : un ou plusieurs, leurs questions à la suite dans le même jeu (jamais tirées au hasard). */
function quizSelection(r, all) {
  const ids = roundQuizIds(r);
  // Quiz : les quiz classiques ; Quiz illustré : les quiz illustrés (un quiz déjà choisi reste proposé).
  const fits = { quiz: quizQuestions, illustre: illustreQuestions }[r.type ?? "quiz"];
  const options = fits ? all.filter(([qid, q]) => ids.includes(qid) || fits(q).length || !playable(q).length && (quizKind(q) === "photo") === (r.type === "illustre")) : all;
  const label = (q) => (r.type === "express" ? `${q.title} (${expressQuestions(q).length} Vrai / Faux)`
    : r.type === "zoom" || r.type === "flou" ? `${q.title} (${zoomQuestions(q).length} avec photo)` : `${q.title} (${playable(q).length} validées)`);
  const setIds = (list) => {
    const clean = [...new Set(list.filter(Boolean))];
    r.quizId = clean[0] ?? "";
    r.quizIds = clean.length > 1 ? clean : null;
    // Les questions tirées au 🎲 (première ligne) restent : le quiz choisi les suit (cedric, 23/10).
    roundCtx.refresh();
  };
  const select = (current, k) => h("select", {
    class: "grow", "aria-label": k === 0 ? "Quiz du jeu" : `Quiz ${k + 1} du jeu`,
    onchange: (e) => { const next = [...ids]; next[k] = e.target.value; setIds(next); },
  },
  h("option", { value: "", text: options.length ? "Choisir un quiz…" : r.type === "illustre" ? "Aucun quiz illustré : créez-en un dans la page du Quiz illustré" : "Aucun quiz : créez-en un dans la page du Quiz" }),
  ...options.filter(([qid]) => qid === current || !ids.includes(qid)).map(([qid, q]) => h("option", { value: qid, selected: current === qid, text: label(q) })));
  return h("div", { class: "grow quiz-picks" },
    ...(ids.length ? ids : [""]).map((id, k) => (k === 0 ? select(id, 0)
      : h("span", { class: "quiz-more" }, select(id, k), h("button", { type: "button", class: "icon", title: "Retirer ce quiz", text: "✕", onclick: () => setIds(ids.filter((x) => x !== id)) })))),
    ids.length > 0 && ids.length < options.length
      ? h("button", { type: "button", class: "chip quiz-add", text: "＋ Enchaîner un autre quiz", onclick: () => {
        const next = options.find(([qid]) => !ids.includes(qid));
        if (next) setIds([...ids, next[0]]);
      } })
      : null);
}

/** Nombre de séries tirées par « Au hasard ». */
const PICTO_RANDOM_SERIES = 3;

/**
 * Pictionary : les séries de mots de la manche (Animaux, À manger…). Aucune cochée : toutes les séries.
 * « Au hasard » en tire quelques-unes ; le nombre de mots retenus s'affiche.
 */
function pictoSeriesPicker(r) {
  const words = activeItems("pictionary", contents.pictionary);
  const all = pictoSeriesList(words);
  const box = h("div", { class: "picto-series" });
  const draw = () => {
    const chosen = pictoRoundSeries(r) ?? [];
    const count = words.filter((w) => !chosen.length || chosen.includes(pictoSeriesOf(w))).length;
    const set = (list) => { r.series = list.length ? list : null; draw(); roundCtx.summary(); };
    box.replaceChildren(...[
      h("span", { class: "small", text: chosen.length ? `Séries : ${count} mots` : `Toutes les séries : ${count} mots` }),
      ...all.map((name) => h("button", {
        type: "button", class: `chip${chosen.includes(name) ? " active" : ""}`, "aria-pressed": chosen.includes(name) ? "true" : "false",
        text: `${name} (${words.filter((w) => pictoSeriesOf(w) === name).length})`,
        onclick: () => set(chosen.includes(name) ? chosen.filter((x) => x !== name) : [...chosen, name]),
      })),
      h("button", {
        type: "button", class: "chip", text: "🎲 Au hasard",
        title: `Tirer ${PICTO_RANDOM_SERIES} séries au hasard`,
        onclick: () => set([...all].sort(() => Math.random() - 0.5).slice(0, Math.min(PICTO_RANDOM_SERIES, all.length))),
      }),
      chosen.length ? h("button", { type: "button", class: "chip", text: "Toutes", onclick: () => set([]) }) : null,
    ].filter(Boolean));
  };
  draw();
  return box;
}

/** Nombres de chansons proposés au 🎲 des statues. */
const STATUES_NOMBRES = [3, 5, 8, 10];
/** « 🧩 Statues complet » : ouvert d'office ; refermé, le temps de l'écran. */
const statuesCompletsFermes = new WeakSet();
/** « 3:42 » : la durée d'une chanson, en minutes et secondes. */
const minSec = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
/** Chansons des statues dont on vérifie en ce moment si la chanson entière est en ligne. */
const entieresEnCours = new Set();

/** 🎧 des statues : la chanson entière, depuis 0:00 (gardée sur ce PC, sinon téléchargée) ; null si elle n'est pas en ligne. */
async function ecouterEntiere(id, bouton) {
  stopPreview();
  try {
    let f = await fichierGarde(id);
    if (!f) {
      f = await telechargerEntiere(id);
      if (f) await garderFichier(id, f);
    }
    if (!f) return annonce(`La chanson entière de « ${songs[id]?.title?.trim() ?? "cette chanson"} » n'est pas encore en ligne : redéposez son MP3 dans Bibliothèque › Sons.`);
    // Un autre bouton a été touché pendant le téléchargement : c'est lui qui joue.
    if (preview) return;
    const url = URL.createObjectURL(f);
    const audio = new Audio(url);
    preview = { audio, url };
    await audio.play();
    enLecture(audio, bouton);
  } catch (e) {
    console.error(e);
    annonce("Écoute impossible sur cet ordinateur.");
  }
}

/**
 * Statues musicales sur vos chansons (cedric, 24/10 : « je devrais pouvoir entendre des musiques présélectionnées dans
 * ma playlist ») : comme au blind test, le 🎲 dans la bibliothèque des sons, « 🎵 Choisir mes chansons » et « 🎶 Ajouter
 * une playlist » ; la liste dans l'ordre de passage (↑ ↓ ✕). Chaque chanson se joue en entier (cedric, 27/10), l'une après l'autre.
 * Aucune : la musique de la fête. Une manche d'avant garde ses extraits cochés tant qu'aucune chanson n'est choisie ici.
 */
function statuesChansons(r) {
  const ids = chansonsStatues(r);
  const pluriel = (k, mot) => `${k} ${mot}${k > 1 ? "s" : ""}`;
  const ranger = (liste) => {
    r.chansons = [...new Set(liste.filter(Boolean))].slice(0, MAX_STATUES_SONGS);
    // Vos chansons remplacent les extraits cochés avant dans les playlists.
    if (r.chansons.length) r.songs = [];
    roundCtx.refresh();
    noterEcran();
  };
  const n = STATUES_NOMBRES.includes(r.nbChansons) ? r.nbChansons : 5;
  const nombre = h("select", { class: "tirage-nombre statues-nombre", "aria-label": "Nombre de chansons à tirer au hasard", onchange: (e) => { r.nbChansons = Number(e.target.value); } },
    ...STATUES_NOMBRES.map((k) => h("option", { value: k, selected: k === n, text: `${k} chansons au hasard` })));
  const de = h("button", {
    type: "button", class: "btn tirage-de statues-de", text: "🎲", "aria-label": "Tirer les chansons au hasard",
    title: "Tirer des chansons au hasard dans la bibliothèque des sons (elles s'ajoutent à la fin de la liste)",
    // Chaque 🎲 ajoute ses chansons à la suite (cedric, 27/10), jamais une déjà dans la liste.
    onclick: () => {
      r.nbChansons = Number(nombre.value);
      const place = MAX_STATUES_SONGS - ids.length;
      if (place <= 0) return annonce(`Déjà ${MAX_STATUES_SONGS} chansons : c'est le maximum aux statues.`);
      const tirees = piocherChansons(r, Math.min(r.nbChansons, place), new Set(ids));
      if (!tirees.length) return annonce(Object.keys(songs ?? {}).length ? "Toutes les chansons de la bibliothèque des sons sont déjà dans la liste." : "Aucune chanson dans la bibliothèque des sons : ajoutez-en d'abord (Bibliothèque › Sons).");
      if (tirees.length < r.nbChansons) annonce(`Seulement ${pluriel(tirees.length, "chanson")} de plus : les voici.`);
      ranger([...ids, ...tirees]);
    },
  });
  const choisir = h("button", {
    type: "button", class: "btn secondary statues-choisir", text: "🎵 Choisir mes chansons", title: "Cocher les chansons dans la bibliothèque des sons",
    onclick: async () => {
      const choix = await choisirChansons({ titre: "Chansons des statues musicales", plusieurs: true, cochees: ids, deja: (k) => chansonsAilleurs(r).get(k) ?? null });
      if (!choix) return;
      if (choix.length > MAX_STATUES_SONGS) annonce(`${MAX_STATUES_SONGS} chansons au plus aux statues : les dernières ne sont pas ajoutées.`, true);
      ranger([...ids.filter((id) => choix.includes(id)), ...choix.filter((id) => !ids.includes(id))]);
    },
  });
  // Une de vos playlists, cherchée par son nom : ses chansons s'ajoutent à la fin (la playlist ne change pas).
  const listes = Object.entries(playlists ?? {})
    .filter(([, p]) => p?.title && !isStatuesList(p))
    .map(([id, p]) => [id, p, chansonsDePlaylist(p)])
    .filter(([, , liste]) => liste.length)
    .sort(([, a], [, b]) => a.title.localeCompare(b.title, "fr"))
    .map(([id, p, liste]) => ({ id, titre: p.title, ids: liste, details: pluriel(liste.length, "chanson"), noms: [p.title], autres: liste.slice(0, 40).flatMap((k) => [songs[k]?.title, songs[k]?.artist]) }));
  const ajoutPlaylist = ligneAjoutQuiz({
    classe: "statues-playlist", titre: "🎶 Ajouter une playlist", label: "Chercher une de vos playlists",
    placeholder: "Nom d'une de vos playlists", vide: "Pas encore de playlist : créez-en dans Bibliothèque › Sons",
    aucun: "Aucune playlist ne correspond.", items: listes, attr: (x) => ({ "data-playlist": x.id }),
    choisir: (x) => {
      const neuves = x.ids.filter((id) => !ids.includes(id));
      if (!neuves.length) return annonce(`Les chansons de « ${x.titre} » sont déjà toutes dans les statues.`);
      if (ids.length + neuves.length > MAX_STATUES_SONGS) annonce(`${MAX_STATUES_SONGS} chansons au plus aux statues : les dernières ne sont pas ajoutées.`, true);
      ranger([...ids, ...neuves]);
    },
  });
  // « 📚 Rappeler la liste d'un ancien anniversaire » (cedric, 27/10) : les chansons des statues d'une prestation
  // archivée, ajoutées à la fin (sans celles déjà dans la liste ; les chansons supprimées depuis restent dehors).
  const anciens = prestationsRecentes().filter(([, s]) => etatPrestation(s) === "archivee").map(([sid, s]) => {
    const liste = [...new Set((s.rounds ?? []).flatMap((x) => chansonsStatues(x)))].filter((k) => chansonJouable(songs[k]));
    const date = s.date ? new Date(`${s.date}T12:00:00`) : null;
    return {
      id: sid, ids: liste,
      titre: `${showTitle(s)}${date ? ` (${date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })})` : ""}`,
      details: [date ? date.toLocaleDateString("fr-FR") : "", s.age != null && s.age !== "" ? `${s.age} ans` : "", pluriel(liste.length, "chanson")].filter(Boolean).join(" · "),
      noms: [showTitle(s), s.childName],
      autres: [...datesCherchables(s.date), s.age != null && s.age !== "" ? `${s.age} ans` : "", s.notes, s.themes, ...liste.flatMap((k) => [songs[k]?.title, songs[k]?.artist])],
    };
  }).filter((x) => x.ids.length);
  const rappel = ligneAjoutQuiz({
    classe: "quiz-rappel statues-rappel", titre: "📚 Rappeler la liste d'un ancien anniversaire", label: "Chercher une prestation archivée",
    placeholder: "Prénom, âge, date… d'une prestation archivée", vide: "Aucun ancien anniversaire avec des statues",
    aucun: "Aucune prestation archivée ne correspond.", items: anciens, attr: (x) => ({ "data-show": x.id }),
    choisir: (x) => {
      const neuves = x.ids.filter((id) => !ids.includes(id));
      if (!neuves.length) return annonce(`Les chansons de « ${x.titre} » sont déjà toutes dans les statues.`);
      if (ids.length + neuves.length > MAX_STATUES_SONGS) annonce(`${MAX_STATUES_SONGS} chansons au plus aux statues : les dernières ne sont pas ajoutées.`, true);
      ranger([...ids, ...neuves]);
    },
  });
  const ligne = (id, i) => {
    const song = songs[id];
    const enlever = h("button", { type: "button", class: "icon tirage-retirer", text: "✕", title: "Retirer cette chanson des statues", "aria-label": `Retirer « ${song?.title?.trim() ?? "cette chanson"} »`, onclick: () => ranger(ids.filter((x) => x !== id)) });
    if (!chansonJouable(song)) {
      return h("li", { class: "tirage-q blind-chanson statues-chanson manquante", "data-chanson": id }, h("div", { class: "tirage-q-ligne" },
        h("span", { class: "blind-pochette sans", text: "💿" }), h("span", { class: "tirage-texte", text: "Chanson supprimée de la bibliothèque" }), enlever));
    }
    const bouger = (d) => {
      const l = [...ids];
      [l[i], l[i + d]] = [l[i + d], l[i]];
      ranger(l);
    };
    // La chanson se joue en entier (cedric, 27/10) : sa durée et 🎧 pour l'écouter ; ☁ si elle n'est pas entière en ligne.
    const duree = Number.isFinite(song.length) && song.length > 0 ? minSec(song.length) : null;
    return h("li", { class: "tirage-q blind-chanson statues-chanson quiz-complet-q", "data-chanson": id },
      h("div", { class: "tirage-q-ligne" },
        h("span", { class: "quiz-complet-num", text: `${i + 1}` }),
        miniPochette(song),
        h("span", { class: "tirage-texte blind-titre" }, h("b", { text: song.title.trim() }), song.artist?.trim() ? h("span", { class: "hint", text: ` · ${song.artist.trim()}` }) : null),
        entieres.get(id) === false ? h("span", {
          class: "song-nuage statues-nuage", role: "img", "aria-label": "Chanson entière pas en ligne", text: "☁",
          title: "La chanson entière n'est pas encore en ligne : la TV ne pourra pas la jouer en entier. Redéposez son MP3 une fois dans Bibliothèque › Sons (« Ajouter des chansons… »).",
        }) : null,
        duree ? h("span", { class: "hint statues-duree", text: duree, title: "Durée de la chanson, jouée en entier" }) : null,
        boutonEcoute({ class: "icon statues-ecouter", text: "🎧", title: "Écouter la chanson entière, depuis le début", "aria-label": `Écouter « ${song.title.trim()} »` }, (b) => ecouterEntiere(id, b)),
        h("button", { type: "button", class: "icon quiz-complet-monter", text: "↑", title: "Jouer cette chanson plus tôt", "aria-label": "Monter cette chanson", disabled: i === 0, onclick: () => bouger(-1) }),
        h("button", { type: "button", class: "icon quiz-complet-descendre", text: "↓", title: "Jouer cette chanson plus tard", "aria-label": "Descendre cette chanson", disabled: i === ids.length - 1, onclick: () => bouger(1) }),
        enlever));
  };
  const lignes = ids.map(ligne);
  const liste = h("ol", { class: "tirage-liste serie-liste quiz-complet-liste statues-liste" }, ...lignes);
  glisserDansLaListe(liste, lignes, (k, j) => ranger(deplaceEn(ids, k, j)));
  // « 🧩 Statues complet » (cedric, 27/10) : toutes les chansons dans l'ordre de passage ; 🔀 ↑ ↓ glisser ✕.
  liste.hidden = statuesCompletsFermes.has(r);
  const titre = () => `${liste.hidden ? "▸" : "▾"} 🧩 Statues complet : ${pluriel(ids.length, "chanson")}, dans l'ordre de passage`;
  const voir = h("button", {
    type: "button", class: "chip tirage-voir serie-voir quiz-complet-voir statues-complet-voir", "aria-expanded": liste.hidden ? "false" : "true", text: titre(),
    title: "Voir toutes les chansons des statues, dans l'ordre",
    onclick: (e) => {
      liste.hidden = !liste.hidden;
      if (liste.hidden) statuesCompletsFermes.add(r); else statuesCompletsFermes.delete(r);
      e.currentTarget.textContent = titre();
      e.currentTarget.setAttribute("aria-expanded", liste.hidden ? "false" : "true");
    },
  });
  const melanger = () => {
    let nouvel = shuffle(ids);
    for (let essai = 0; essai < 5 && ids.length > 1 && nouvel.every((c, k) => c === ids[k]); essai++) nouvel = shuffle(ids);
    ranger(nouvel);
  };
  const complet = h("div", { class: "serie quiz-complet statues-complet" },
    h("div", { class: "serie-tete" },
      voir,
      h("button", { type: "button", class: "chip quiz-melanger statues-melanger", text: "🔀 Mélanger", title: "Mélanger toutes les chansons des statues", disabled: ids.length < 2, onclick: melanger })),
    liste);
  const avant = ids.length ? [] : roundSongs(r, playlists);
  // Chanson entière en ligne ? Vérifié une fois par chanson et par visite ; un ☁ apparaît sur celles qui manquent.
  const aVerifier = ids.filter((id) => chansonJouable(songs[id]) && !entieres.has(id) && !entieresEnCours.has(id));
  if (aVerifier.length) {
    aVerifier.forEach((id) => entieresEnCours.add(id));
    Promise.all(aVerifier.map(async (id) => entieres.set(id, await entiereEnLigne(id).catch(() => true)))).then(() => {
      aVerifier.forEach((id) => entieresEnCours.delete(id));
      if (aVerifier.some((id) => entieres.get(id) === false)) roundCtx.refresh();
    });
  }
  const resume = ids.length ? `${pluriel(ids.length, "chanson")}, ${ids.length > 1 ? "jouées en entier l'une après l'autre" : "jouée en entier"}.`
    : avant.length ? `Pour l'instant : ${pluriel(avant.length, "extrait")} coché${avant.length > 1 ? "s" : ""} avant dans vos playlists. Ajoutez vos chansons pour les remplacer.`
    : "Aucune chanson : la musique de la fête.";
  return h("div", { class: "statues-chansons" },
    h("div", { class: "tirage-ligne" }, nombre, de, choisir),
    rappel,
    ajoutPlaylist,
    h("p", { class: "hint small statues-resume", text: resume }),
    ids.length ? complet : null);
}

/**
 * « 🤠 Le Duel des robots » dans une prestation (cedric, 27/10) : rien à piocher ; le nombre approximatif de joueurs par
 * équipe (la box en tire le nombre de duels, pour que tout le monde joue), la durée du face-à-face, au moins / au plus,
 * et « de temps en temps un long duel, jusqu'à 60 s ».
 */
function reglagesDuDuel(r) {
  const d = reglagesDuel(r);
  Object.assign(r, d);
  const choix = (classe, label, cle, valeurs, texte) => h("select", { class: `duel-reglage ${classe}`, "aria-label": label, onchange: (e) => {
    r[cle] = Number(e.target.value);
    // Le minimum ne dépasse jamais le maximum : l'autre suit.
    if (cle === "dureeMin" && r.dureeMax < r.dureeMin) r.dureeMax = r.dureeMin;
    if (cle === "dureeMax" && r.dureeMin > r.dureeMax) r.dureeMin = r.dureeMax;
    roundCtx.refresh();
    noterEcran();
  } }, ...valeurs.map((n) => h("option", { value: n, selected: d[cle] === n, text: texte(n) })));
  return h("div", { class: "grow picto-round duel-reglages" },
    choix("duel-joueurs", "Joueurs par équipe, environ", "joueurs", DUEL_JOUEURS, (n) => `Environ ${n} joueur${n > 1 ? "s" : ""} par équipe`),
    choix("duel-min", "Durée du face-à-face, au moins", "dureeMin", DUEL_DUREES, (n) => `Face-à-face : au moins ${n} s`),
    choix("duel-max", "Durée du face-à-face, au plus", "dureeMax", DUEL_DUREES, (n) => `au plus ${n} s`),
    h("label", { class: "inline duel-longs-label", title: d.dureeMax >= 60 ? "Déjà jusqu'à 60 s" : "Environ un duel sur quatre dure alors entre le maximum et 60 s" },
      h("input", { type: "checkbox", class: "duel-longs", checked: d.longs, disabled: d.dureeMax >= 60, onchange: (e) => { r.longs = e.target.checked; roundCtx.summary(); noterEcran(); } }),
      " De temps en temps un long duel, jusqu'à 60 s"),
    h("span", { class: "hint small", text: "Rien d'autre à préparer : l'appli compte assez de duels pour que chaque joueur passe une fois. Pendant la partie, Sarah peut lancer un duel de plus entre deux équipes." }));
}

/**
 * « 🔴 Le Simon de Buzzy » dans une prestation (cedric, 27/10) : rien à piocher ; le nombre de tours, les secondes pour
 * taper une suite et le nombre approximatif de joueurs par équipe.
 */
function reglagesDuSimon(r) {
  const s = reglagesSimon(r);
  Object.assign(r, s);
  const choix = (classe, label, cle, valeurs, texte) => h("select", { class: `simon-reglage ${classe}`, "aria-label": label, onchange: (e) => {
    r[cle] = Number(e.target.value);
    roundCtx.summary();
    noterEcran();
  } }, ...valeurs.map((n) => h("option", { value: n, selected: s[cle] === n, text: texte(n) })));
  return h("div", { class: "grow picto-round simon-reglages" },
    choix("simon-tours", "Nombre de tours", "tours", SIMON_TOURS, (n) => `${n} tour${n > 1 ? "s" : ""} (un gagnant par tour)`),
    choix("simon-reponse", "Secondes pour taper une suite", "reponse", SIMON_REPONSES, (n) => `${n} s pour taper une suite`),
    choix("simon-joueurs", "Joueurs par équipe, environ", "joueurs", DUEL_JOUEURS, (n) => `Environ ${n} joueur${n > 1 ? "s" : ""} par équipe`),
    h("span", { class: "hint small", text: "Rien d'autre à préparer : la suite s'allonge d'une boule à chaque fois (une seconde de plus pour taper au-delà de 4), un autre joueur de chaque équipe à chaque suite." }));
}

/**
 * « ⏱️ Le Chrono de Buzzy » dans une prestation (cedric, 30/10) : rien à piocher ; la cible et le nombre de tours. Sarah
 * peut changer la cible avant chaque tour sur son téléphone. Pour le rejouer, il suffit de le remettre dans la prestation.
 */
function reglagesDuChrono(r) {
  const c = reglagesChrono(r);
  Object.assign(r, c);
  const choix = (classe, label, cle, valeurs, texte) => h("select", { class: `chrono-reglage ${classe}`, "aria-label": label, onchange: (e) => {
    r[cle] = Number(e.target.value);
    roundCtx.summary();
    noterEcran();
  } }, ...valeurs.map((n) => h("option", { value: n, selected: c[cle] === n, text: texte(n) })));
  return h("div", { class: "grow picto-round chrono-reglages" },
    choix("chrono-cible", "Cible en secondes", "cible", CHRONO_CIBLES, (n) => `Cible : ${n} secondes`),
    choix("chrono-tours", "Nombre de tours", "tours", CHRONO_TOURS, (n) => `${n} tour${n > 1 ? "s" : ""} (un gagnant par tour)`),
    h("span", { class: "hint small", text: "Rien d'autre à préparer : le chrono se cache à un moment au hasard (entre 6 et 12 s). Sur son téléphone, Sarah peut changer la cible avant chaque tour." }));
}

/** Jeux que « ＋ Ajouter un jeu » propose, par famille, dans l'ordre des tuiles de l'Accueil. */
const jeuxProposes = () => GAME_GROUPS.map((g) => ({ title: g.title, games: g.games.filter((x) => ROUND_TYPES[x.type]) }));
// Le « ? » de la tuile du Quiz devient ❓ hors de sa tuile (comme l'écran d'ouverture de la TV).
const iconeJeu = (type) => (type === "quiz" ? "❓" : GAME_GROUPS.flatMap((g) => g.games).find((x) => x.type === type)?.icon ?? "");
const SANS_CONTENU = ["coffres", "patate", "gonfleur", "duel", "simon", "chrono"];

/**
 * Prestation (cedric, 21/10) : on ajoute un JEU, puis ses manches. Un bloc = les manches qui se suivent du même jeu,
 * avec « ＋ Manche » ; chaque manche se remplit sur place (reprendre une manche gardée, tirer au hasard, choisir à la
 * main). Les manches restent enregistrées à la suite dans la prestation, comme avant (TV, régie et téléphone inchangés).
 */
/**
 * Jeu replié dans la page d'une prestation (cedric, 23/10) : une seule ligne, ↑ ↓ ✕ toujours là, pour ranger les jeux
 * facilement. Replié d'office en ouvrant une prestation (cedric, 24/10 : « chaque ligne de jeu fermée par défaut ») ;
 * un jeu qu'on vient d'ajouter s'ouvre, pour le remplir. Déplié : noté sur la première manche du jeu, jamais enregistré.
 */
const JEU_OUVERT = Symbol("jeu ouvert");

/**
 * Tests sur l'émulateur seulement : un quiz de la bibliothèque dans le Quiz du jeu [i], comme le faisait « Intégrer un
 * quiz de votre bibliothèque » (retiré du Quiz par cedric le 25/10 ; les prestations qui en ont un le jouent toujours).
 */
if (emulator) window.__integrerQuiz = (i, quizId) => {
  const r = editing?.rounds?.[i];
  if (!r || !quizzes[quizId]) return false;
  seriesDe(r).push({ id: nouvelId("q"), origine: "quiz", quizId });
  refreshRounds();
  return true;
};

function refreshRounds() {
  if (!editing) return;
  roundCtx = prestationCtx;
  const box = $("show-rounds");
  box.innerHTML = "";
  if (!editing.rounds.length) box.append(h("p", { class: "hint small", text: "Ajoutez un premier jeu avec « ＋ Ajouter un jeu »." }));
  // Un Quiz = une seule manche (cedric, 23/10) : en séries, et deux Quiz qui se touchent n'en font plus qu'un.
  const { rounds: reunies, fusions } = fusionnerQuiz(editing.rounds.map((r) => versSeriesQuiz(r, quizzes)));
  // Pas de manches dans un blind test (cedric, 24/10) : deux blind tests qui se touchent n'en font plus qu'un.
  const { rounds: blinds, fusions: fusionsBlind } = fusionnerBlind(reunies.map((x) => versSeriesMots(versSeriesBlind(x))));
  editing.rounds = blinds;
  // Les cadrages gardés pour ces jeux (cedric, 29/10) : une image qui revient prend son dernier cadrage.
  if (appliquerCadrages(editing.rounds)) noterEcran();
  if (fusions) annonce("Les Quiz qui se suivaient n'en font plus qu'un : leurs questions à la suite, une seule Super Finale à la fin.");
  if (fusionsBlind) annonce("Les blind tests (ou quiz musicaux) qui se suivaient n'en font plus qu'un : leurs chansons à la suite.");
  // Plus de manches (cedric, 24/10 : « on abandonne complètement cette notion de manche ») : chaque jeu de la prestation
  // a sa carte, avec son nombre de tours ; deux fois le même jeu, ce sont deux jeux.
  const blocs = editing.rounds.map((r, i) => ({ type: r?.type ?? "quiz", indices: [i] }));
  blocs.forEach((b, k) => {
    const [debut, fin] = [b.indices[0], b.indices[b.indices.length - 1] + 1];
    // Le jeu passe avant (ou après) son voisin.
    const deplacer = (d) => {
      const v = blocs[k + d];
      const [a, z] = [v.indices[0], v.indices[v.indices.length - 1] + 1];
      const rs = editing.rounds;
      editing.rounds = d < 0
        ? [...rs.slice(0, a), ...rs.slice(debut, fin), ...rs.slice(a, debut), ...rs.slice(fin)]
        : [...rs.slice(0, debut), ...rs.slice(fin, z), ...rs.slice(debut, fin), ...rs.slice(z)];
      refreshRounds();
    };
    const retirerJeu = async () => {
      const remplies = b.indices.filter((i) => roundFilled(editing.rounds[i]) && !SANS_CONTENU.includes(b.type)).length;
      if (remplies && !(await confirmer(`Retirer « ${ROUND_TYPES[b.type]} » de la prestation ?`, { ok: "Retirer", danger: true }))) return;
      editing.rounds.splice(debut, fin - debut);
      refreshRounds();
      // Confirmé dans la fenêtre, hors de l'écran : l'action est notée ici (Ctrl+Z, « Annuler les modifications »).
      noterEcran();
    };
    // Jeux en séries (Quiz, blind test, Chante le mot !…) : tout s'ajoute dedans (compteur sur la ligne du numéro, pas
    // de « Reprendre une partie déjà faite »).
    const sansManches = estEnSeries(b.type) || b.type === "blind" || b.type === "musical" || estJeuDeMots(b.type);
    const premiere = editing.rounds[debut];
    const replie = premiere[JEU_OUVERT] !== true;
    const resume = !replie ? "" : estEnSeries(b.type) ? compteurQuiz(premiere)
      : b.indices.map((i) => mancheSummary(editing.rounds[i], { mimes, playlists, quizzes })).filter(Boolean).join(" / ");
    box.append(h("div", { class: `jeu-bloc${replie ? " replie" : ""}`, "data-jeu": b.type },
      h("div", { class: "jeu-tete" },
        h("button", {
          type: "button", class: "icon jeu-replier", text: replie ? "▸" : "▾", "aria-expanded": replie ? "false" : "true",
          title: replie ? "Déplier ce jeu" : "Replier ce jeu", onclick: () => { premiere[JEU_OUVERT] = replie; refreshRounds(); },
        }),
        h("span", { class: "jeu-nom", text: `${iconeJeu(b.type)} ${ROUND_TYPES[b.type]}`.trim() }),
        replie ? h("span", { class: "jeu-resume", text: resume }) : null,
        h("button", { type: "button", class: "icon", title: "Monter ce jeu", disabled: k === 0, onclick: () => deplacer(-1), text: "↑" }),
        h("button", { type: "button", class: "icon", title: "Descendre ce jeu", disabled: k === blocs.length - 1, onclick: () => deplacer(1), text: "↓" }),
        h("button", { type: "button", class: "icon", title: "Retirer ce jeu", onclick: retirerJeu, text: "✕" })),
      // Replié : seulement ses alertes (contenu qui ne suffit pas aux équipes), pour ne rien laisser passer.
      ...(replie ? b.indices.map((i) => alerteManche(editing.rounds[i])) : b.indices.map((i) => {
        const r = editing.rounds[i];
        const vide = !roundFilled(r);
        const champs = roundFields(r);
        // Le compteur du Quiz sur la ligne de son numéro (cedric, 23/10), celui du blind test aussi (cedric, 24/10).
        const compteur = sansManches || b.type === "mimes" || b.type === "pictionary" ? champs.find((x) => x?.classList?.contains("quiz-compteur")) ?? null : null;
        // L'âge du Quiz aussi (cedric, 26/10), au bout de cette ligne.
        const enTete = compteur ? champs.filter((x) => x?.classList?.contains("quiz-en-tete")) : [];
        const corps = h("div", { class: "round-body" }, ...champs.filter((x) => x !== compteur && !enTete.includes(x)));
        // Créer d'abord (les champs ci-dessus), reprendre ensuite (cedric, 23/10). Pas pour le Quiz (cedric, 23/10) :
        // ses questions viennent du 🎲 et du quiz d'une prestation archivée (« Rappeler un de vos quiz »).
        // Ni pour les Mimes (cedric, 23/10 : « uniquement mon bouton dé »), ni pour le blind test (cedric, 24/10 : « je ne
        // veux pas pouvoir rappeler une manche déjà faite »).
        const reprise = SANS_CONTENU.includes(b.type) || sansManches || b.type === "mimes" || b.type === "pictionary" ? null : reprendreManche(r, (next) => {
          editing.rounds[i] = r[JEU_OUVERT] ? { ...next, [JEU_OUVERT]: true } : next;
          refreshRounds();
        });
        return h("div", { class: "round show-round", "data-manche": i },
          h("div", { class: "round-head" },
            h("span", { class: "num", title: `Jeu ${i + 1} de la prestation`, text: `${i + 1}` }),
            ...(compteur ? [compteur, ...enTete] : [SANS_CONTENU.includes(b.type) ? h("span", { class: "grow hint small", text: "" })
              : h("span", { class: "grow hint small", text: vide && !sansManches ? "Choisissez son contenu, ou reprenez une partie déjà faite (plus bas)." : "" })])),
          corps,
          reprise,
          alerteManche(r));
      }))));
  });
  refreshSummary();
}

/**
 * Alerte rouge sous une manche dont le contenu ne suffit pas aux équipes prévues (cedric, 21/10), ou dont une liste a
 * un trou : case laissée sur le 🎲, chanson supprimée de la bibliothèque (cedric, 24/10).
 */
function alerteManche(r) {
  const couleurs = roundCtx === prestationCtx ? couleursSaisies : null;
  const textes = [alerteEquipes(r, ctxTeams(), { mimes, contents, profile: roundCtx.profile?.(), couleurs }),
    ...trousDuJeu(r, { songs, couleurs }).map((t) => `${t[0].toUpperCase()}${t.slice(1)}.`)].filter(Boolean);
  return textes.length ? h("div", { class: "alerte-equipes", role: "alert" }, ...textes.map((t) => h("p", { text: `⚠ ${t}` }))) : null;
}

/**
 * « ＋ Ajouter un jeu » : les jeux en tuiles, par famille ; un clic ajoute le jeu (une manche) en fin de prestation.
 * Deux boutons (cedric, 24/10) : en haut de la page et sous les jeux ; les tuiles s'ouvrent sous celui qu'on a touché.
 */
function ouvrirChoixJeu(place = "bas") {
  const box = $("jeu-choix");
  const lieu = $(`jeu-choix-${place}`);
  if (!box.hidden && box.parentElement === lieu) { box.hidden = true; return; }
  lieu.append(box);
  box.replaceChildren(...jeuxProposes().map((g) => h("div", { class: "jeu-famille" },
    h("p", { class: "small", text: g.title }),
    h("div", { class: "jeu-tuiles" }, ...g.games.map((x) => h("button", {
      type: "button", class: "jeu-tuile", "data-jeu": x.type, text: `${iconeJeu(x.type)} ${ROUND_TYPES[x.type]}`,
      onclick: () => {
        box.hidden = true;
        // Un Quiz juste après un Quiz n'en ferait qu'un : on y retourne, ses questions s'ajoutent dans sa manche.
        const dernier = editing.rounds[editing.rounds.length - 1];
        if (dernier && (estEnSeries(x.type) || x.type === "blind" || x.type === "musical" || estJeuDeMots(x.type)) && (dernier.type ?? "quiz") === x.type) {
          annonce(x.type === "quisuis" ? "« Qui suis-je ? » est déjà le dernier jeu : ajoutez-y vos personnages (🎲, un ancien anniversaire, une de vos séries)."
            : x.type === "disparu" ? "« Qui a disparu ? » est déjà le dernier jeu : ajoutez-y vos grilles (🎲, vos images, les photos libres)."
            : estJeuDeMots(x.type) ? `${ROUND_TYPES[x.type]} est déjà le dernier jeu : ajoutez-y vos mots (🎲, ou écrits à la main).`
            : x.type === "blind" ? "Le Blind test est déjà le dernier jeu : ajoutez-y vos chansons (🎲, « Sélectionner mes chansons », une playlist)."
            : x.type === "musical" ? "Le Quiz musical est déjà le dernier jeu : ajoutez-y vos chansons (🎲, une playlist)."
            : `${x.type === "flou" ? "L'Image floue" : `Le ${ROUND_TYPES[x.type]}`} est déjà le dernier jeu : ajoutez-y vos ${estJeuDePhotos(x.type) ? "photos" : x.type === "express" ? "affirmations" : "questions"} (🎲, un ancien anniversaire, votre bibliothèque).`);
          dernier[JEU_OUVERT] = true;
          refreshRounds();
          $("show-rounds").lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          return;
        }
        editing.rounds.push({ type: x.type, [JEU_OUVERT]: true });
        refreshRounds();
        $("show-rounds").lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      },
    }))))));
  box.hidden = false;
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/** Autres prestations, les plus récentes d'abord : par date (sans date : en dernier, la dernière modifiée d'abord). */
function prestationsRecentes() {
  return Object.entries(shows).filter(([sid, s]) => s && sid !== editing?.id)
    .sort(([, a], [, b]) => (b.date ?? "").localeCompare(a.date ?? "") || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/** Prestations dont les manches sont proposées d'office dans « Reprendre une manche » (cedric, 23/10). */
const REPRISE_RECENTES = 10;

/** « 23/10/2026 », « 2026-10-23 », « 23 octobre 2026 » : une date se cherche comme on l'écrit. */
function datesCherchables(d) {
  if (!d) return [];
  const jour = new Date(`${d}T12:00:00`);
  return [jour.toLocaleDateString("fr-FR"), d, jour.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })];
}

/**
 * Toutes les manches d'un jeu qu'on peut reprendre : celles gardées dans la page du jeu (épinglées, préparées,
 * archivées, et celles de chaque prestation) et les manches des prestations d'avant le 21 octobre, jamais gardées.
 * Celles de la prestation qu'on prépare ne sont pas proposées, ni celles dont le contenu n'existe plus.
 */
function manchesAReprendre(type) {
  const lib = { mimes, playlists, quizzes };
  const recentes = prestationsRecentes();
  const rang = new Map(recentes.map(([sid], k) => [sid, k]));
  const items = [];
  const vues = new Set();
  const { pinned, active, archived } = mancheGroups(manches, type, quizzes);
  for (const [id, m] of [...pinned, ...active, ...archived]) {
    vues.add(id);
    if ((m.showId && (m.showId === editing?.id || !shows[m.showId])) || roundContent(m.round) == null) continue;
    items.push({ cle: id, titre: m.title, round: m.round, show: m.showId ? shows[m.showId] : null, rang: m.showId ? rang.get(m.showId) : null,
      epinglee: !!m.pinned && !m.archived, archivee: !!m.archived, copie: () => ({ ...cleanRound(m.round, playlists), mancheId: id, title: m.title }) });
  }
  for (const [sid, s] of recentes) {
    (s.rounds ?? []).forEach((x0, i) => {
      const x = x0 ? jeuDeLaManche(x0, quizzes) : null;
      // Une ancienne manche « Super Finale » ne se reprend pas : ce n'est pas un jeu.
      if (!x || x.type === "finale" || (x.type ?? "quiz") !== type || !roundFilled(x) || roundContent(x) == null || (x.mancheId && vues.has(x.mancheId))) return;
      items.push({ cle: `${sid}/${i}`, titre: `${ROUND_TYPES[type]} · ${showTitle(s)}`, round: x, show: s, rang: rang.get(sid), copie: () => JSON.parse(JSON.stringify(x)) });
    });
  }
  return items.map((x) => {
    const resume = mancheSummary(x.round, lib);
    const date = x.show?.date ? new Date(`${x.show.date}T12:00:00`).toLocaleDateString("fr-FR") : "";
    return {
      ...x, resume, note: x.round.note ?? "",
      details: [x.show && !x.titre.includes(showTitle(x.show)) ? showTitle(x.show) : "", date, resume, x.archivee ? "archivée" : ""].filter(Boolean).join(" · "),
      noms: [x.titre, x.show?.childName, x.show ? showTitle(x.show) : "", resume],
      autres: [x.round.note, ...datesCherchables(x.show?.date), x.show?.age != null ? `${x.show.age} ans` : "", x.show?.notes],
    };
  });
}

/**
 * Une question jouée (format du quiz) gardée dans une série : 4 réponses avec sa photo ou son émoji, ou Juste Chiffre.
 * Quiz illustré : ses réponses en images (photos de la banque tirées au 🎲, ou images déjà dans la bibliothèque).
 */
const versQuestionEnLigne = (q) => (q.kind === "number"
  ? { text: q.text, nombre: true, correct: q.correct }
  : { text: q.text, choices: [...(q.choices ?? [])], correct: q.correct,
    ...(q.banque ? { banque: q.banque } : /^[0-9a-f]{16}$/.test(q.imageId ?? "") ? { imageId: q.imageId }
      : typeof q.image === "string" && q.image && q.image.length <= 16 ? { emoji: q.image } : {}),
    ...(Array.isArray(q.choiceBanque) ? { choiceBanque: q.choiceBanque.map((x) => ({ ...x })) } : {}),
    ...(choiceImageList(q).length ? { choiceImages: choiceImageList(q) } : {}) });

/**
 * « Rappeler un de vos quiz » (cedric, 23/10) : les prestations archivées qui ont un Quiz (ou un Quiz illustré : [type]),
 * la plus récente d'abord, avec toutes les questions de ce jeu (dans l'ordre joué) et de quoi les retrouver (prénom,
 * âge, date, notes).
 */
function quizArchives(type = "quiz") {
  return prestationsRecentes().filter(([, s]) => etatPrestation(s) === "archivee").map(([sid, s]) => {
    const questions = (s.rounds ?? []).map((x) => (x ? versSeriesQuiz(x, quizzes) : null))
      // Zoom mystère et Image floue : les photos de l'un se rappellent dans l'autre.
      .filter((x) => x && (estJeuDePhotos(type) ? estJeuDePhotos(x.type) : (x.type ?? "quiz") === type) && x.hasard !== true)
      .flatMap((x) => questionsDesSeries(x, quizzes).map((q) => (estJeuDePhotos(type) ? { ...versQuestionEnLigne(q), id: signatureQuestion(q, x.type) } : versQuestionEnLigne(q))))
      .filter(questionJouable)
      // Sa question des bougies était celle de l'enfant de cette fête-là : la nouvelle prestation a la sienne.
      .filter((q) => !(q.nombre && /combien de bougies sur le gâteau/i.test(q.text)));
    const date = s.date ? new Date(`${s.date}T12:00:00`) : null;
    return {
      id: sid, show: s, questions,
      titre: `${showTitle(s)}${date ? ` (${date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })})` : ""}`,
      details: [date ? date.toLocaleDateString("fr-FR") : "", s.age != null && s.age !== "" ? `${s.age} ans` : "", `${questions.length} ${estJeuDePhotos(type) ? "photo" : type === "express" ? "affirmation" : "question"}${questions.length > 1 ? "s" : ""}`].filter(Boolean).join(" · "),
      noms: [showTitle(s), s.childName],
      autres: [...datesCherchables(s.date), s.age != null && s.age !== "" ? `${s.age} ans` : "", s.notes, s.themes],
    };
  }).filter((x) => x.questions.length);
}

/**
 * « ↺ Reprendre une manche déjà faite » (cedric, 23/10), sous les champs de la manche : on crée d'abord, on reprend
 * ensuite. D'office : les manches épinglées ⭐, celles des 10 dernières prestations et celles préparées dans la page
 * du jeu ; la recherche fouille tout, archives comprises (mots, prénom, date, note), à chaque lettre. Un clic remplace
 * la manche par une copie : la manche reprise ne change pas.
 */
function reprendreManche(r, replace) {
  const type = r.type ?? "quiz";
  const items = manchesAReprendre(type);
  if (!items.length) return null;
  const champ = h("input", { type: "search", class: "reprendre-cherche", "aria-label": "Chercher une partie déjà faite", placeholder: "Chercher : mot, prénom, date…" });
  const liste = h("div", { class: "reprendre-liste" });
  const panneau = h("div", { class: "reprendre" });
  panneau.hidden = true;
  const ligne = (x) => h("button", { type: "button", class: "reprise-item", "data-reprise": x.cle, onclick: () => replace(x.copie(), x) },
    h("b", { text: `${x.epinglee ? "⭐ " : ""}${x.titre}` }),
    x.details ? h("span", { class: "small", text: x.details }) : null,
    x.note ? h("span", { class: "reprise-note", text: `📝 ${x.note}` }) : null);
  const dessiner = () => {
    const q = champ.value;
    if (q.trim()) {
      const trouvees = parPertinence(items.filter((x) => contientTout([...x.noms, ...x.autres].filter(Boolean), q)), q, (x) => x.noms.filter(Boolean), (x) => x.autres.filter(Boolean));
      remplir(liste, h("p", { class: "reprendre-groupe", text: trouvees.length ? `${trouvees.length} partie${trouvees.length > 1 ? "s" : ""} trouvée${trouvees.length > 1 ? "s" : ""}` : "Aucune partie ne correspond." }), ...trouvees.map(ligne));
      return;
    }
    const epinglees = items.filter((x) => x.epinglee);
    const recentes = items.filter((x) => !x.epinglee && x.rang != null && x.rang < REPRISE_RECENTES).sort((a, b) => a.rang - b.rang);
    const duJeu = items.filter((x) => !x.epinglee && !x.archivee && !x.show);
    const groupe = (titre, xs) => (xs.length ? [h("p", { class: "reprendre-groupe", text: titre }), ...xs.map(ligne)] : []);
    remplir(liste,
      ...groupe("⭐ Épinglées", epinglees),
      ...groupe(`Des ${REPRISE_RECENTES} dernières prestations`, recentes),
      ...groupe(`Préparées dans la page ${deJeu(ROUND_TYPES[type])}`, duJeu),
      epinglees.length + recentes.length + duJeu.length ? null : h("p", { class: "hint small", text: "Tapez un mot, un prénom ou une date pour chercher dans toutes les prestations." }));
  };
  champ.addEventListener("input", dessiner);
  champ.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); panneau.hidden = true; } });
  panneau.append(
    h("div", { class: "reprendre-haut" }, champ, h("button", { type: "button", class: "btn secondary small", text: "Fermer", onclick: () => { panneau.hidden = true; } })),
    h("p", { class: "hint small", text: "Les plus récentes sont listées ; pour aller plus loin, tapez un mot, un prénom, une date ou une note." }),
    liste);
  return h("div", { class: "reprendre-zone" },
    h("button", { type: "button", class: "chip reprendre-ouvrir", text: type === "quiz" ? "↺ Reprendre les questions d'une partie déjà faite" : "↺ Reprendre une partie déjà faite", "aria-expanded": "false",
      onclick: (e) => {
        panneau.hidden = !panneau.hidden;
        e.currentTarget.setAttribute("aria-expanded", panneau.hidden ? "false" : "true");
        if (!panneau.hidden) { dessiner(); champ.focus(); }
      } }),
    panneau);
}

/** Nombre d'équipes de l'écran en cours (prestation, ou réglage du tirage d'une manche seule). */
const ctxTeams = () => (typeof roundCtx.teams === "function" ? roundCtx.teams() : $("show-teams").value === "" ? null : Number($("show-teams").value));

/** Questions toutes prêtes que le 🎲 d'une manche Quiz tire : à 4 réponses, et Juste Chiffre (une sur quatre environ). */
const QCM_TOUT_PRETS = QUESTIONS_TOUT_PRETES.filter((x) => !estJusteChiffre(x));
const CHIFFRES_TOUT_PRETS = QUESTIONS_TOUT_PRETES.filter(estJusteChiffre);
/** Niveau des questions tirées pour chaque profil ; Neutre : tous les niveaux. */
const NIVEAU_DU_PROFIL = { PETITS: 1, MOYENS: 2, GRANDS: 3, ADULTES: 3, NEUTRE: null };
/** Nombres de questions proposés : tous, de 1 à 20 (cedric : 8 questions, une retirée, puis 7). */
const TIRAGE_DEFAUT = 8;

/**
 * Séries d'une manche Quiz (cedric, 23/10 : un Quiz = une seule manche), dans l'ordre de passage ; le tableau de la
 * manche, qu'on modifie sur place.
 */
function seriesDe(r) {
  if (!Array.isArray(r.seriesQuiz)) r.seriesQuiz = Object.values(r.seriesQuiz ?? {}).filter(Boolean);
  return r.seriesQuiz;
}
/** La série du dé (une seule, réglée par la première ligne). */
const serieDuDe = (r) => seriesDe(r).find((x) => x.origine === "de") ?? null;
/** Les cases du tirage, dans l'ordre : une question, ou une question retirée ({ vide }) qui attend son 🎲. */
const casesDuTirage = (r) => (Array.isArray(serieDuDe(r)?.questions) ? serieDuDe(r).questions : Object.values(serieDuDe(r)?.questions ?? {})).filter(Boolean);
const caseVide = (q) => q?.vide === true;
/** Identifiant d'une nouvelle série ou d'une question écrite à la main. */
const nouvelId = (prefixe) => `${prefixe}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** Séries dépliées, questions écrites à la main dont le texte vient d'être créé (le temps de l'écran). */
const seriesDepliees = new WeakSet();

/** Une question de la banque telle qu'elle est gardée dans la manche (réponses mélangées : la bonne pas toujours la A). */
function versTiree(x) {
  if (estJusteChiffre(x)) return { id: x.id, text: x.text, nombre: true, correct: x.correct };
  const choices = shuffle(x.choices);
  return { id: x.id, text: x.text, choices, correct: choices.indexOf(x.choices[x.correct]), ...(x.photo ? { banque: x.id } : x.emoji ? { emoji: x.emoji } : {}) };
}

/**
 * Pioche [qcm] questions à 4 réponses et [chiffres] Juste Chiffre du niveau de [profil] pour la manche [r] : jamais une
 * question déjà dans la prestation (n'importe quelle série de n'importe quel Quiz), ni retirée de la manche (✕).
 */
function piocherQuiz(r, { qcm = 0, chiffres = 0, profil, theme = null }) {
  const exclus = textesPris(r);
  const niveau = NIVEAU_DU_PROFIL[profil] ?? null;
  return {
    qcm: tirerChiffres(qcm, { niveau, theme, exclus, liste: QCM_TOUT_PRETS }).map(versTiree),
    chiffres: tirerChiffres(chiffres, { niveau, theme, exclus, liste: CHIFFRES_TOUT_PRETS }).map(versTiree),
  };
}

/** Textes des questions déjà dans la prestation (n'importe quelle série de n'importe quel jeu) ou retirées de la manche [r] (✕). */
function textesPris(r) {
  const manches = roundCtx === prestationCtx && editing ? editing.rounds.filter(Boolean) : [r];
  const textes = [...new Set([r, ...manches])].flatMap((m) => [...questionsDesSeries(m, quizzes), ...roundTirees(m),
    ...(roundSeriesQuiz(m).length ? [] : roundQuizIds(m).flatMap((id) => playable(quizzes[id])))].map((q) => q?.text));
  return new Set([...textes, ...casesDuTirage(r).filter((q) => !caseVide(q)).map((q) => q.text), ...(r.ecartees ?? [])].filter(Boolean));
}

/** Thème du 🎲 d'un Quiz illustré (null : tous les thèmes). */
const familleDuDe = (r) => (FAMILLES_PETITS[serieDuDe(r)?.famille] ? serieDuDe(r).famille : FAMILLES_PETITS[r.famille] ? r.famille : null);

/**
 * Une question du Quiz illustré tout prêt telle qu'elle est gardée dans la manche : réponses mélangées, et pour chacune
 * la photo libre de son mot (sinon son émoji), copiée dans la partie au lancement. Null : une réponse sans image libre
 * (au hasard, jamais une image téléversée : cedric, 21/10).
 */
function versIllustree(x) {
  const choices = shuffle(x.choices);
  const choiceBanque = choices.map(imageLibre);
  if (!choiceBanque.every(Boolean)) return null;
  return { id: x.id, text: x.text, choices, correct: choices.indexOf(x.choices[0]), choiceBanque };
}

/**
 * Pioche [n] questions du Quiz illustré tout prêt ([famille] : ce thème seulement) pour la manche [r] : jamais une
 * question déjà dans la prestation ni retirée de la manche (✕) ; « Jamais deux fois » : d'abord celles dont les images
 * ne servent pas déjà dans un autre jeu de la prestation.
 */
function piocherIllustre(r, n, famille) {
  if (n <= 0) return [];
  banqueCatalogue ??= cataloguePetits();
  const tirage = tirerPetits(n * 3 + 4, { famille, exclus: textesPris(r), catalogue: banqueCatalogue }).map(versIllustree).filter(Boolean);
  return neufsSiPossible(tirage, questionConcepts, roundCtx.elsewhere?.(r), n).slice(0, n);
}

/** Tire [n] questions du Quiz illustré tout prêt pour la série du dé (cedric, 23/10) ; les autres séries ne bougent pas. */
function tirerQuestionsIllustre(r, n, famille) {
  const ajoutees = ajouterAuTirage(r, piocherIllustre(r, n, famille));
  const de = serieDuDe(r);
  if (de) { if (famille) de.famille = famille; else delete de.famille; }
  r.famille = famille;
  return ajoutees;
}

/**
 * Photos déjà dans la prestation (Zoom mystère ou Image floue, n'importe quelle série) ou retirées de la manche [r]
 * (✕) : leur signature (« b:vache », « i:<image> »).
 */
function photosPrises(r) {
  const manches = roundCtx === prestationCtx && editing ? editing.rounds.filter(Boolean) : [r];
  const prises = [...new Set([r, ...manches])].filter((m) => estJeuDePhotos(m.type))
    .flatMap((m) => zoomRoundQuestions(m, quizzes).map((q) => signatureQuestion(q, m.type)));
  return new Set([...prises, ...casesDuTirage(r).filter((q) => !caseVide(q)).map((q) => signatureQuestion(q, r.type)), ...(r.ecartees ?? [])]);
}

/** Une photo de la banque telle qu'elle est gardée dans une manche Zoom mystère ou Image floue. */
function versPhotoTiree(cle) {
  const q = questionBanque(cle);
  return q ? { id: `b:${cle}`, text: q.text, choices: [...q.choices], correct: q.correct, banque: cle } : null;
}

/** Thèmes de la banque de photos qui ont des photos (le 🎲 du Zoom mystère et de l'Image floue). */
const famillesPhotos = () => Object.entries(FAMILLES_PETITS).filter(([k]) => banqueItems().some((x) => x.famille === k));

/**
 * Pioche [n] photos de la banque de photos libres ([famille] : ce thème seulement) pour la manche [r] (cedric, 23/10) :
 * jamais une photo déjà dans la prestation ni retirée de la manche ; « Jamais deux fois » : d'abord celles dont le mot
 * ne sert pas déjà dans un autre jeu. Jamais « Mes images » (règle 16).
 */
function piocherPhotos(r, n, famille) {
  if (n <= 0) return [];
  const prises = photosPrises(r);
  const libres = shuffle(banqueItems().filter((x) => (!famille || x.famille === famille) && !prises.has(`b:${x.key.slice(BANQUE.length)}`)))
    .map((x) => versPhotoTiree(x.key.slice(BANQUE.length))).filter(Boolean);
  return neufsSiPossible(libres, (q) => questionConcepts({ ...q, kind: r.type }), roundCtx.elsewhere?.(r), n).slice(0, n);
}

/** Tire [n] photos pour la série du dé du Zoom mystère ou de l'Image floue ; les autres séries ne bougent pas. */
function tirerPhotos(r, n, famille) {
  const ajoutees = ajouterAuTirage(r, piocherPhotos(r, n, famille));
  const de = serieDuDe(r);
  if (de) { if (famille) de.famille = famille; else delete de.famille; }
  r.famille = famille;
  return ajoutees;
}

/** Une affirmation du Vrai ou Faux tout prêt telle qu'elle est gardée dans la manche. */
const versAffirmation = (x) => ({ id: x.id, text: x.text, choices: ["Vrai", "Faux"], correct: x.vrai ? 0 : 1 });

/**
 * Pioche [n] affirmations du Vrai ou Faux tout prêt au niveau de [profil] (cedric, 23/10) : autant de vraies que de
 * fausses à peu près, jamais une déjà dans la prestation ni retirée de la manche (✕).
 */
function piocherAffirmations(r, n, profil) {
  if (n <= 0) return [];
  return tirerAffirmations(n, { niveau: NIVEAU_DU_PROFIL[profil] ?? null, exclus: textesPris(r) }).map(versAffirmation);
}

/** Tire [n] affirmations pour la série du dé du Vrai ou Faux express ; les autres séries ne bougent pas. */
function tirerAffirmationsVF(r, n, profil) {
  const ajoutees = ajouterAuTirage(r, piocherAffirmations(r, n, profil), profil);
  r.profil = profil;
  return ajoutees;
}

/** « Vrai » ou « Faux » : la bonne réponse d'une affirmation, en petit à côté d'elle. */
const reponseVF = (q) => h("span", { class: `tirage-vf ${q.correct === 0 ? "vrai" : "faux"}`, text: q.correct === 0 ? "✓ Vrai" : "✗ Faux", title: "La bonne réponse" });

/**
 * Ce qu'un clic de 🎲 tire ([ajouter], qui rend ce qu'il rend) passe à la fin de l'ordre de passage (cedric, 25/10 :
 * « une ligne de dé vient compléter l'assemblage de toutes les questions »), même dans une série déjà en tête ; la
 * question des bougies garde sa place.
 */
function aLaSuite(r, ajouter) {
  const mots = estJeuDeMots(r.type);
  const ordre = () => {
    if (mots) return motsDuJeu(r).map((x) => x.cle);
    // Le Quiz (cedric, 26/10) : ses cases vides gardent leur place.
    if (deUnique(r)) return clesDuComplet(r);
    const cles = questionsDuQuiz(r, quizzes).map((x) => x.cle);
    const b = placeDesBougies(r, quizzes);
    if (b != null) cles.splice(b, 0, CLE_BOUGIES);
    return cles;
  };
  const avant = ordre();
  const rendu = ajouter();
  const deja = new Set(avant);
  const nouvelles = ordre().filter((c) => !deja.has(c));
  if (avant.length && nouvelles.length) {
    if (mots) r.ordreMots = [...avant, ...nouvelles];
    else r.ordreQuiz = [...avant, ...nouvelles];
  }
  return rendu;
}

/**
 * Ajoute [cases] à la suite de la série du dé (cedric, 25/10 : chaque clic complète le « complet », il ne refait plus
 * sa série) ; rend le nombre ajouté.
 */
function ajouterAuTirage(r, cases, profil) {
  if (!cases.length) return 0;
  const de = serieDuDe(r);
  poserTirage(r, [...(de?.questions ?? []).filter(Boolean), ...cases], profil);
  return cases.length;
}

/** Met [cases] dans la série du dé (créée à la fin des séries s'il n'y en a pas) ; aucune : la série part. */
function poserTirage(r, cases, profil) {
  const series = seriesDe(r);
  let de = serieDuDe(r);
  if (!cases.length) { r.seriesQuiz = series.filter((x) => x !== de); return; }
  if (!de) { de = { id: "de", origine: "de" }; series.unshift(de); }
  de.questions = cases;
  if (profil) de.profil = profil;
}

/**
 * Tire [n] questions pour la série du dé (cedric, 23/10) : environ une sur quatre au Juste Chiffre, réparties (jamais
 * la première). Les autres séries de la manche ne bougent pas.
 */
function tirerQuestionsQuiz(r, n, profil) {
  const ajoutees = ajouterAuTirage(r, questionsLibres(r, n, profil), profil);
  r.profil = profil;
  return ajoutees;
}


/**
 * [n] questions libres de droit ([theme] : ce thème seulement) : environ une sur quatre au Juste Chiffre, réparties
 * (jamais la première). Rien n'est ajouté à la manche.
 */
function questionsLibres(r, n, profil, theme = null) {
  if (n <= 0) return [];
  const nb = chiffresDuTirage(n);
  const { qcm, chiffres } = piocherQuiz(r, { qcm: n - nb, chiffres: nb, profil, theme });
  // Pas assez d'une sorte (un thème sans Juste Chiffre…) : l'autre complète.
  if (qcm.length + chiffres.length < n) {
    const encore = piocherQuiz(r, { qcm: n, chiffres: n, profil, theme });
    const pris = new Set([...qcm, ...chiffres].map((q) => q.text));
    for (const q of [...encore.qcm, ...encore.chiffres]) {
      if (qcm.length + chiffres.length >= n) break;
      if (!pris.has(q.text)) (q.nombre ? chiffres : qcm).push(q);
    }
  }
  const liste = [...qcm];
  chiffres.forEach((q, k) => liste.splice(Math.min(liste.length, Math.round(((k + 1) * n) / (chiffres.length + 1)) - 1), 0, q));
  return liste;
}

/**
 * Le 🎲 unique du Quiz (cedric, 26/10) : ce que donnent [n] questions pour le champ [terme] (sourceDuDe), à l'âge de
 * la carte, sans rien ajouter : `{ packs, libres, mode }` ([packs] : entrées du catalogue de mes packs ; [libres] :
 * questions libres de droit prêtes). Au hasard dans tout : moitié mes packs, moitié libres de droit ; un thème : mes
 * packs d'abord, puis le thème des questions libres de droit du même nom. Jamais une question déjà dans la prestation.
 */
function piocherAuDe(r, n, terme) {
  const libresDuJeu = libresDeDroit(r);
  const source = sourceDuDe(terme, libresDuJeu.themes);
  const profil = ageDuQuiz(r);
  const questionsLibres = (_r, k, _profil, theme = null) => (k > 0 ? libresDuJeu.piocher(k, theme) : []);
  const catalogue = catalogueDuJeu(r);
  const niveau = niveauDesPacks(NIVEAU_DU_PROFIL[profil]);
  const deja = prisesDuJeu(r);
  const depuisPacks = (k, mode, t = "", sans = []) => (k > 0 && catalogue.length
    ? piocherDansLesPacks(catalogue, k, { mode, terme: t, niveau, exclus: new Set([...deja, ...sans.map((x) => x.cle ?? x.q.text)]) }) : []);
  if (source.sorte === "libres") return { packs: [], libres: questionsLibres(r, n, profil), source };
  if (source.sorte === "packs") return { packs: depuisPacks(n, "hasard"), libres: [], source };
  if (source.sorte === "theme") {
    const packs = depuisPacks(n, "recherche", source.terme);
    return { packs, libres: source.themeLibre ? questionsLibres(r, n - packs.length, profil, source.themeLibre) : [], source };
  }
  // Tout au hasard : une seule question, mes packs ou les libres de droit à pile ou face.
  const moitie = !catalogue.length ? 0 : n === 1 ? (Math.random() < 0.5 ? 1 : 0) : Math.ceil(n / 2);
  const packs = depuisPacks(moitie, "hasard");
  const libres = questionsLibres(r, n - packs.length, profil);
  return { packs: [...packs, ...depuisPacks(n - packs.length - libres.length, "hasard", "", packs)], libres, source };
}

/**
 * Un clic sur le 🎲 unique du Quiz (cedric, 26/10) : ses questions à la suite du « complet » (celles de mes packs en
 * une série piochée, les libres de droit dans la série du dé), mêlées entre elles. Rend le nombre ajouté.
 */
function tirerAuDe(r, n, terme) {
  const { packs, libres, source } = piocherAuDe(r, n, terme);
  if (!packs.length && !libres.length) return 0;
  const avant = clesDuComplet(r);
  if (packs.length) {
    const pioche = { mode: source.sorte === "theme" ? "recherche" : "hasard", ...(source.sorte === "theme" ? { terme: source.terme } : {}), profil: ageDuQuiz(r) };
    seriesDe(r).push({ id: nouvelId("pk"), origine: "reprise", pioche, titre: `Mes packs : ${sortePioche(pioche)}`, questions: packs.map((y) => versQuestionDePack(y, Math.random, r.type ?? "quiz")) });
  }
  if (libres.length) ajouterAuTirage(r, libres, ageDuQuiz(r));
  const deja = new Set(avant);
  const nouvelles = clesDuComplet(r).filter((c) => !deja.has(c));
  // Mêlées ; jamais un Juste Chiffre en toute première question.
  const melange = packs.length && libres.length ? shuffle(nouvelles) : nouvelles;
  if (!avant.length) {
    const parCle = new Map(ordreAvecCasesVides(r, quizzes).map((x) => [x.cle, x]));
    const k = melange.findIndex((c) => parCle.get(c)?.q?.kind !== "number");
    if (k > 0) melange.unshift(...melange.splice(k, 1));
  }
  r.ordreQuiz = [...avant, ...melange];
  return packs.length + libres.length;
}

/** Une question pour une case vide du Quiz (son 🎲 et son champ, mêmes règles), telle qu'elle est gardée ; null : aucune. */
function uneAuDe(r, terme) {
  const { packs, libres } = piocherAuDe(r, 1, terme);
  return packs[0] ? versQuestionDePack(packs[0], Math.random, r.type ?? "quiz") : libres[0] ?? null;
}

/**
 * Les contenus libres de droit d'un jeu, pour son 🎲 unique (cedric, 26/10 : la carte du Quiz pour tous) : leur nom dans
 * la petite liste du champ, leurs thèmes (un thème tapé qui en est un les pioche), et comment en piocher [k] (jamais un
 * déjà dans la prestation). Questions et affirmations à l'âge de la carte ; Quiz illustré et photos par thème.
 */
function libresDeDroit(r) {
  const jeu = r.type ?? "quiz";
  if (estJeuDePhotos(jeu)) return { titre: "Photos libres de droit", details: "Photos libres de droit, tous les thèmes", themes: Object.fromEntries(famillesPhotos()), piocher: (k, theme) => piocherPhotos(r, k, theme) };
  if (jeu === "illustre") return { titre: "Questions libres de droit", details: "Quiz illustré tout prêt, tous les thèmes", themes: FAMILLES_PETITS, piocher: (k, theme) => piocherIllustre(r, k, theme) };
  if (jeu === "express") return { titre: "Affirmations libres de droit", details: "Vrai ou Faux tout prêt, à l'âge choisi", themes: {}, piocher: (k) => piocherAffirmations(r, k, ageDuQuiz(r)) };
  return { titre: "Questions libres de droit", details: `${QUESTIONS_TOUT_PRETES.length} questions, à l'âge choisi`, themes: THEMES_TOUT_PRETS, piocher: (k, theme) => questionsLibres(r, k, ageDuQuiz(r), theme) };
}

/** Les clés du « complet » d'un Quiz dans l'ordre : ses questions, ses cases vides, les bougies si rangées à la main. */
const clesDuComplet = (r) => ordreAvecCasesVides(r, quizzes).map((x) => x.cle);

/**
 * Miniature de l'image de la révélation (cedric, 23/10 : vérifier qu'elle va avec la réponse) : photo, sinon émoji. Une
 * image de la bibliothèque (questions des packs) : sa vraie miniature (cedric, 26/10 : pas un cadre 🖼).
 */
const miniature = (q) => (q.banque ? h("img", { class: "tirage-mini", src: cheminPhotoBanque(q.banque), alt: "", loading: "lazy", title: "Image montrée à la révélation" })
  : IMAGE_ID.test(q.imageId ?? "") ? photoBibliotheque(q.imageId, { class: "tirage-mini", loading: "lazy", title: "Image montrée à la révélation" })
  : q.emoji || (typeof q.image === "string" && q.image && !q.imageId) ? h("span", { class: "tirage-mini emoji", text: q.emoji ?? q.image, title: "Image montrée à la révélation" })
  : q.imageId ? h("span", { class: "tirage-mini emoji", text: "🖼", title: "Une de vos images, montrée à la révélation" }) : null);

/**
 * Les réponses d'une question du Quiz illustré, chacune avec sa petite image, la bonne marquée (cedric, 23/10 : vérifier
 * d'un coup d'œil) : photo de la banque, sinon émoji (tirée au 🎲), ou image de la bibliothèque.
 */
function reponsesIllustrees(q, recadrer = (img) => img) {
  const photos = choiceImageList(q);
  const libres = Array.isArray(q.choiceBanque) ? q.choiceBanque : [];
  return h("span", { class: "tirage-reponses" }, ...(q.choices ?? []).map((c, k) => {
    const libre = libres[k];
    const image = photos[k] ? photoBibliotheque(photos[k], { class: "tirage-rep-img", loading: "lazy" })
      : libre?.cle ? h("img", { class: "tirage-rep-img", src: cheminPhotoBanque(libre.cle), alt: "", loading: "lazy" })
      : libre?.emoji ? h("span", { class: "tirage-rep-img emoji", text: libre.emoji }) : null;
    return h("span", { class: `tirage-rep${k === q.correct ? " bonne" : ""}`, title: k === q.correct ? `${c} (la bonne réponse)` : c }, image && recadrer(image, k), h("span", { class: "tirage-rep-mot", text: c }));
  }));
}

/**
 * Une question du Quiz illustré dont une réponse n'a pas sa photo (cedric, 26/10 : une question d'un pack Marvel en texte
 * seul sur la TV) : signalée en rouge dans le « Quiz illustré complet », pour l'enlever (✕) ou la retirer.
 */
const sansSesImages = (q) => !q.bougies && q.kind !== "number" && !Array.isArray(q.choiceBanque) && !avecSesImages(q);
const alerteSansImages = () => h("span", { class: "alerte-sans-images", text: "⚠ Sans images", title: "Une réponse au moins n'a pas sa photo : la TV montrera cette question en texte seul. Enlevez-la (✕), ou réimportez son pack avec ses images." });

/** Zoom mystère, Image floue : la photo à deviner, en petit (banque de photos libres, ou une de vos images). */
const apercuPhoto = (q) => (q.banque ? h("img", { class: "tirage-photo", src: cheminPhotoBanque(q.banque), alt: "", loading: "lazy" })
  : IMAGE_ID.test(q.imageId ?? "") ? photoBibliotheque(q.imageId, { class: "tirage-photo", loading: "lazy" }) : null);
/**
 * Ce qu'il faut trouver sur une photo du Zoom mystère ou de l'Image floue : sa bonne réponse, sans son émoji (cedric,
 * 24/10 : « on exploite exclusivement les photos », la photo est déjà à côté).
 */
const reponsePhoto = (q) => `${q.choices?.[q.correct] ?? q.text ?? ""}`.replace(/^[^\p{L}\p{N}]+/u, "").trim();

/**
 * Le nom d'une photo du Zoom mystère ou de l'Image floue dans son « … complet », avec ✎ pour le renommer (cedric, 26/10 :
 * « les noms des packs ne correspondent pas forcément au nom du personnage que l'on voit »). Le nouveau nom devient la
 * réponse dans ce jeu, et aussi dans la bibliothèque (renommerImage) ; une photo libre de l'appli ne change que dans le jeu.
 */
function nomDePhoto(r, x, changer) {
  const texte = h("span", { class: "tirage-texte", text: reponsePhoto(x.q), title: x.q.text });
  const gardee = questionGardee(r, x);
  if (!gardee) return texte;
  const ouvrir = () => {
    const champ = h("input", { type: "text", class: "photo-nom", maxlength: 60, value: reponsePhoto(gardee), "aria-label": "Nouveau nom de la photo (la réponse à trouver)" });
    let fini = false;
    const finir = (garder) => {
      if (fini) return;
      fini = true;
      const nom = champ.value.replace(/\s+/g, " ").trim();
      if (garder && nom && nom !== reponsePhoto(gardee)) {
        nommerQuestionPhoto(gardee, nom);
        if (IMAGE_ID.test(gardee.imageId ?? "")) renommerImage(gardee.imageId, nom);
        noterEcran();
      }
      changer();
    };
    champ.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finir(true); }
      if (e.key === "Escape") { e.preventDefault(); finir(false); }
    });
    champ.addEventListener("blur", () => finir(true));
    texte.replaceWith(champ);
    bouton.hidden = true;
    // Pas de glisser pendant la saisie : la souris sélectionne le texte.
    const li = champ.closest("li");
    if (li) li.draggable = false;
    champ.focus();
    champ.select();
  };
  const bouton = h("button", { type: "button", class: "icon photo-renommer", text: "✎", title: "Renommer la photo (la réponse à trouver)", "aria-label": `Renommer « ${reponsePhoto(x.q)} »`, onclick: ouvrir });
  return h("span", { class: "photo-nom-bloc" }, texte, bouton);
}

/**
 * La question gardée dans la série de la prestation (tirée au 🎲, piochée dans les packs, écrite à la main), qu'on peut
 * changer pour cette prestation seulement. Celle d'un quiz rappelé en entier reste dans la Bibliothèque : null.
 */
const questionGardee = (r, x) => (x.serie?.origine === "quiz" ? null
  : (x.serie?.questions ?? []).find((q) => q && cleQuestion(x.serie, q, r.type) === x.cle) ?? null);

/** Une image de la bibliothèque, pour le cadrage : celle déjà chargée, sinon lue dans la base. */
async function imageDeLaBibliotheque(id) {
  if (!imageCache[id]) {
    const data = (await get(ref(db, `library/images/${id}`))).val();
    if (typeof data === "string") imageCache[id] = data;
  }
  return imageCache[id] ?? null;
}

/**
 * Miniature d'un « … complet » recadrable (cedric, 28/10 : « que les images soient affichées telles qu'elles sont dans
 * la télé et que je puisse dans les petites miniatures réajuster ») : elle a déjà la forme de la TV (4:3 pour la photo
 * de la révélation, du Zoom mystère et de l'Image floue, carré pour une réponse en image) ; un clic ouvre le cadrage
 * (glisser + zoom). L'image recadrée ne vaut que pour cette prestation : le pack et la Bibliothèque restent tels quels.
 * [k] : la réponse en image recadrée (sinon la photo de la question). Une photo de la banque se recadre dans
 * « 🧸 Photos de la banque », une question d'un quiz rappelé en entier dans la Bibliothèque : rien à cliquer ici.
 */
function recadrable(img, r, x, changer, k = null) {
  // Mode carte (régie téléphone) : rien ne s'écrit dans la bibliothèque, donc pas de recadrage.
  if (MODE_CARTE) return img;
  const gardee = img?.tagName === "IMG" ? questionGardee(r, x) : null;
  if (!gardee) return img;
  const reponse = k !== null;
  const choices = Array.isArray(gardee.choices) ? gardee.choices : Object.values(gardee.choices ?? {});
  const ids = () => choiceImageList({ choices, choiceImages: gardee.choiceImages });
  if (reponse ? !IMAGE_ID.test(ids()[k] ?? "") : !(IMAGE_ID.test(gardee.imageId ?? "") || gardee.banque)) return img;
  img.classList.add("recadrable");
  img.title = "Cliquer pour recadrer l'image comme sur la TV (pour cette prestation seulement)";
  img.addEventListener("click", async (e) => {
    e.stopPropagation();
    const forme = reponse ? "vignette" : "revelation";
    const actuelle = reponse ? ids()[k] : IMAGE_ID.test(gardee.imageId ?? "") ? gardee.imageId : `b-${gardee.banque}`;
    // Toujours depuis l'image d'origine : un cadrage se refait sans perdre de qualité, et se défait.
    const origine = origineCadree(actuelle) ?? actuelle;
    await cadrer(await sourceDuCadrage(origine), forme, async (blob) => {
      let neuve;
      if (reponse) {
        const nouvelles = ids();
        nouvelles[k] = neuve = await storeChoiceImage(blob);
        gardee.choiceImages = nouvelles;
      } else {
        // Au Zoom mystère et à l'Image floue, la clé d'une photo sans identifiant vient de son image : elle la garde
        // (sa place dans l'ordre de passage).
        if (!(typeof gardee.id === "string" && gardee.id) && estJeuDePhotos(r.type)) gardee.id = x.cle.slice(`${x.serie.id ?? ""}|`.length);
        gardee.imageId = neuve = await storeIllustration(blob);
        delete gardee.banque;
        delete gardee.emoji;
      }
      memoriserCadrage(r.type, forme, origine, neuve);
      changer();
    });
  });
  return img;
}

/** La bonne réponse de [q] devient [nom] ; une autre proposition qui s'écrivait déjà ainsi prend l'ancien nom. */
function nommerQuestionPhoto(q, nom) {
  const choices = Array.isArray(q.choices) ? [...q.choices] : Object.values(q.choices ?? {});
  const ancien = choices[q.correct];
  const meme = (t) => `${t ?? ""}`.trim().toLowerCase() === nom.toLowerCase();
  q.choices = choices.map((c, k) => (k === q.correct ? nom : meme(c) ? ancien : c));
}

/**
 * Renomme l'image [id] dans la bibliothèque : sa fiche (Mes images, Images des packs) et la bonne réponse des questions
 * de packs (ou de séries de photos) qui la montrent, pour que les prochains 🎲 donnent le bon nom.
 */
async function renommerImage(id, nom) {
  const chemins = {};
  if (medias?.[id]) Object.assign(chemins, { [`library/medias/${id}/name`]: nom, [`library/medias/${id}/updatedAt`]: serverTimestamp() });
  Object.entries(quizzes ?? {}).forEach(([qid, quiz]) => {
    const qs = quiz?.questions;
    Object.entries(qs && typeof qs === "object" ? qs : {}).forEach(([k, q]) => {
      if (q?.imageId !== id || !Number.isInteger(q.correct)) return;
      const copie = { ...q };
      nommerQuestionPhoto(copie, nom);
      chemins[`library/quizzes/${qid}/questions/${k}/choices`] = copie.choices;
      chemins[`library/quizzes/${qid}/updatedAt`] = serverTimestamp();
    });
  });
  if (!Object.keys(chemins).length) return;
  try { await update(ref(db), chemins); } catch (e) { annonce(`Le nouveau nom n'a pas pu être gardé dans la bibliothèque : ${e.message}`, true); }
}

/** Petite étiquette des questions de la Super Finale, dans la liste (cedric, 23/10 : une seule, à la fin). */
const etiquetteFinale = (r) => h("span", { class: "badge-finale", text: `🏆 ×${FACTEURS_FINALE.includes(r.facteur) ? r.facteur : FACTEURS_FINALE[0]}`, title: "Question de la Super Finale" });

/** « 19 questions, dont 3 en Super Finale » : le compteur au-dessus de la première ligne (cedric, 23/10). */
function compteurQuiz(r) {
  const total = questionsDesSeries(r, quizzes).length;
  const finale = hasFinale(r.type) && r.finale > 0 ? Math.min(r.finale, total) : 0;
  // Zoom mystère, Image floue (cedric, 25/10) : « un compteur global de cartes à deviner ».
  const photos = estJeuDePhotos(r.type);
  const unite = photos ? (deUnique(r) ? "carte" : "photo") : r.type === "express" ? "affirmation" : "question";
  const aTirer = seriesDe(r).flatMap(casesPioche).filter(caseVide).length;
  const aFinir = seriesDe(r).filter((x) => x.origine === "main").flatMap((x) => x.questions ?? []).filter((q) => q && !questionJouable(q)).length;
  const bougies = roundCtx === prestationCtx && editing && premierQuiz(editing.rounds, quizzes) === r && questionBougies({ childName: $("show-child").value, age: $("show-age").value }, r);
  return [
    total ? `${total} ${unite}${total > 1 ? "s" : ""}${photos && deUnique(r) ? " à deviner" : ""}` : `Aucune ${unite} pour l'instant`,
    finale ? `dont ${finale > 1 ? `${finale}` : "la dernière"} en Super Finale` : "",
    bougies && total ? "plus la question des bougies" : "",
  ].filter(Boolean).join(", ") + [aTirer ? ` · ${aTirer} à tirer` : "", aFinir ? ` · ${aFinir} à compléter` : ""].join("");
}

/**
 * « 🎨 Mes thèmes » (cedric, 25/10) : les séries piochées dans les packs importés, une par dé et par thème tapé (le
 * même dé avec le même mot refait la sienne) ; gardées comme des séries reprises (`pioche` : le dé, le mot tapé, l'âge),
 * la TV les joue comme les autres.
 */
const seriesPioche = (r) => seriesDe(r).filter((x) => x.pioche && x.origine === "reprise");
const casesPioche = (x) => (Array.isArray(x?.questions) ? x.questions : Object.values(x?.questions ?? {})).filter(Boolean);
/** Le catalogue des packs jouables dans le jeu de la manche [r] (sans les quiz des prestations de test). */
const catalogueDuJeu = (r) => catalogueDesPacks(quizzes, estQuizDeTest, r.type ?? "quiz");
/** Ce qui est déjà pris dans la prestation pour ce jeu : les photos au Zoom et à l'Image floue, les textes ailleurs. */
const prisesDuJeu = (r) => (estJeuDePhotos(r.type) ? photosPrises(r) : textesPris(r));
/** Une seule ligne de 🎲 (cedric, 26/10) : le Quiz, puis « tout le reste à cette image » (son Go de 10:04). */
const deUnique = (r) => ["quiz", "illustre", "express", "zoom", "flou", "quisuis"].includes(r.type ?? "quiz");
/** L'unité d'un jeu en séries : carte (une photo à deviner, cedric 25/10), affirmation ou question. */
const uniteDuJeu = (r) => (estJeuDePhotos(r.type) ? "carte" : r.type === "express" ? "affirmation" : "question");
/** Ce que dit le titre d'une série piochée : « au hasard », « « Mario » + le reste au hasard », « « K-pop » à 100 % ». */
const sortePioche = (p) => (p?.mode === "theme" ? `« ${p.terme} » pour moitié, le reste au hasard` : p?.mode === "recherche" ? `« ${p.terme} » à 100 %` : "tout au hasard");

/**
 * Un champ de thème (cedric, 25/10) : à droite de son 🎲 ; en tapant, les packs qui répondent (filtre en direct, ceux
 * qui commencent par le mot d'abord) ; un clic met leur nom dans le champ.
 */
function champThemePacks({ classe, placeholder, label, valeur = "", catalogue, exclus, entree }) {
  const champ = h("input", { type: "search", class: `quiz-ajout-cherche ${classe}`, placeholder, "aria-label": label, value: valeur, maxlength: "80" });
  const liste = h("div", { class: "quiz-ajout-liste packs-suggestions" });
  liste.hidden = true;
  liste.addEventListener("mousedown", (e) => e.preventDefault());
  const dessiner = () => {
    const trouves = packsQuiRepondent(catalogue, champ.value, exclus).slice(0, QUIZ_AJOUT_MAX);
    if (!champ.value.trim()) { liste.hidden = true; liste.replaceChildren(); return; }
    liste.replaceChildren(...(trouves.length ? trouves.map((p) => h("button", { type: "button", class: "quiz-ajout-item packs-suggestion", onclick: () => { champ.value = p.titre; liste.hidden = true; } },
      h("b", { text: p.titre }), h("span", { class: "small", text: [plural(p.n, "question libre", "questions libres"), p.theme && p.theme !== p.titre ? p.theme : ""].filter(Boolean).join(" · ") })))
      : [h("p", { class: "hint small", text: "Aucun pack de ce nom : le 🎲 cherche aussi le mot dans les questions et les réponses." })]));
    liste.hidden = false;
  };
  champ.addEventListener("input", dessiner);
  champ.addEventListener("focus", dessiner);
  champ.addEventListener("blur", () => { liste.hidden = true; });
  champ.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); liste.hidden = true; entree?.(); } });
  return { champ, bloc: h("div", { class: "quiz-ajout-champ" }, champ, liste) };
}

/** Nombre de questions d'un dé du Quiz (cedric, 25/10) : de 1 à 15. */
const NOMBRES_DE_QUIZ = Array.from({ length: 15 }, (_, k) => k + 1);
/**
 * Réglages de chaque dé du Quiz, le temps de l'écran (cedric, 25/10) : son âge (d'office celui de la première ligne ;
 * changé sur un dé, il ne vaut que pour lui) et son nombre de questions.
 */
const reglagesDesDes = new WeakMap();
const reglageDuDe = (r, de) => {
  if (!reglagesDesDes.has(r)) reglagesDesDes.set(r, {});
  const tous = reglagesDesDes.get(r);
  return (tous[de] ??= {});
};
/** L'âge de la première ligne du Quiz : celui choisi, sinon celui de la prestation. */
const ageDuQuiz = (r) => (PROFILES[r.profil] ? r.profil : roundCtx.profile?.() ?? "MOYENS");
const ageDuDe = (r, de) => (PROFILES[reglageDuDe(r, de).profil] ? reglageDuDe(r, de).profil : ageDuQuiz(r));
/** Le menu d'âge (« Petits (6 à 8 ans) »…) d'une ligne. */
const menuAge = (valeur, attrs, changer) => h("select", { class: "tirage-profil", ...attrs, onchange: (e) => changer(e.target.value) },
  ...Object.entries(PROFILES).map(([k, p]) => h("option", { value: k, selected: k === valeur, text: p.label })));

/**
 * Première ligne du Quiz (cedric, 25/10) : l'âge des questions, d'office pour chaque 🎲 en dessous (sauf celui dont on a
 * changé l'âge), et le total des questions du Quiz (il compte, il ne se règle pas).
 */
function ligneAgeQuiz(r, changer, total = questionsDesSeries(r, quizzes).length, unite = uniteDuJeu(r)) {
  return h("div", { class: "quiz-age-ligne" },
    h("span", { class: "quiz-ajout-titre quiz-age-titre", text: `🎂 Âge des ${unite}s` }),
    menuAge(ageDuQuiz(r), { class: "tirage-profil quiz-age", "aria-label": `Âge des ${unite}s (d'office pour chaque 🎲)` }, (v) => { r.profil = v; changer(); }),
    // Zoom mystère, Image floue (cedric, 25/10) : « un compteur global de cartes à deviner ».
    h("span", { class: "quiz-total", "aria-live": "polite", title: "Tout le jeu (ça se compte, ça ne se règle pas)", text: `Total : ${plural(total, unite)}${estJeuDePhotos(r.type) ? " à deviner" : ""}` }));
}

/**
 * Les dés du Quiz (cedric, 25/10), une ligne chacun, avec son âge et son nombre de questions (1 à 15) ; chaque clic
 * ajoute ses questions à la suite du « complet », jamais une déjà là (il ne refait plus sa série) :
 * 1. tout au hasard dans mes packs ; 2. un thème principal pour moitié, le reste au hasard dans les autres packs ;
 * 3. un thème à 100 % (thème, personnage…) ; 4. tout au hasard dans les questions libres de droit (Quiz classique tout
 * prêt, Juste Chiffre compris). Jamais une question déjà dans la prestation ni retirée.
 */
function lignesDesQuiz(r, changer) {
  const catalogue = catalogueDuJeu(r);
  const jeu = r.type ?? "quiz";
  const photos = estJeuDePhotos(jeu);
  const unite = uniteDuJeu(r);
  const parTheme = photos || jeu === "illustre";
  const defaut = photos ? RANDOM_COUNT[jeu] ?? TIRAGE_DEFAUT : TIRAGE_DEFAUT;
  const nombreDu = (de) => (NOMBRES_DE_QUIZ.includes(reglageDuDe(r, de).n) ? reglageDuDe(r, de).n : Math.min(defaut, 15));
  const nombreDe = (de) => {
    const n = nombreDu(de);
    return h("select", { class: `tirage-nombre de-nombre de-nombre-${de}`, "aria-label": `Nombre de ${unite}s de ce 🎲`, onchange: (e) => { reglageDuDe(r, de).n = Number(e.target.value); } },
      ...NOMBRES_DE_QUIZ.map((k) => h("option", { value: k, selected: k === n, text: plural(k, unite) })));
  };
  const ageDe = (de) => menuAge(ageDuDe(r, de), { class: `tirage-profil de-age de-age-${de}`, "aria-label": `Âge des ${unite}s de ce 🎲` }, (v) => { reglageDuDe(r, de).profil = v; });
  // Quiz illustré, Zoom mystère, Image floue : leur banque libre se range par thème (pas par âge).
  const familleBanque = () => (FAMILLES_PETITS[reglageDuDe(r, "banque").famille] ? reglageDuDe(r, "banque").famille : familleDuDe(r));
  const themeBanque = () => h("select", { class: "tirage-theme de-theme de-theme-banque", "aria-label": photos ? "Thème des photos libres de droit" : "Thème des questions toutes prêtes",
    onchange: (e) => { reglageDuDe(r, "banque").famille = e.target.value || null; } },
  h("option", { value: "", selected: !familleBanque(), text: "Tous les thèmes" }),
  ...(photos ? famillesPhotos() : Object.entries(FAMILLES_PETITS)).map(([k, label]) => h("option", { value: k, selected: k === familleBanque(), text: label })));
  const piocher = (mode, champ) => {
    const terme = champ?.value.trim() ?? "";
    if (champ) reglageDuDe(r, mode).terme = terme;
    if (mode !== "hasard" && !terme) { annonce(mode === "theme" ? "Tapez le thème principal à droite du 🎲." : "Tapez le thème (ou un personnage) à droite du 🎲."); champ.focus(); return; }
    if (!catalogue.length) { annonce(AUCUN_PACK[jeu] ?? AUCUN_PACK.quiz); return; }
    const k = nombreDu(mode);
    const profil = ageDuDe(r, mode);
    // Chaque clic ajoute ses questions à la suite du « complet » (cedric, 25/10), jamais une déjà là ni retirée.
    const trouvees = piocherDansLesPacks(catalogue, k, { mode, terme, niveau: niveauDesPacks(NIVEAU_DU_PROFIL[profil]), exclus: prisesDuJeu(r) });
    if (!trouvees.length) { annonce(mode === "hasard" ? `Plus aucune ${unite} libre dans vos packs.` : `Aucune ${unite} libre ne se rapporte à « ${terme} » dans vos packs.`); return; }
    if (trouvees.length < k) annonce(`Seulement ${plural(trouvees.length, `${unite} libre`, `${unite}s libres`)}${mode === "recherche" ? ` sur « ${terme} »` : ""} : les voici.`);
    const x = { id: nouvelId("pk"), origine: "reprise", pioche: { mode, ...(mode === "hasard" ? {} : { terme }), profil } };
    x.titre = `Mes packs : ${sortePioche(x.pioche)}`;
    x.questions = trouvees.map((y) => versQuestionDePack(y, Math.random, jeu));
    aLaSuite(r, () => seriesDe(r).push(x));
    changer();
  };
  // Le mot tapé reste dans son champ quand la carte se redessine.
  const theme = champThemePacks({ classe: "packs-theme", placeholder: "Thème principal pour moitié, le reste au hasard", label: "Thème principal : la moitié des questions, le reste au hasard dans mes packs",
    valeur: reglageDuDe(r, "theme").terme ?? "", catalogue, exclus: prisesDuJeu(r), entree: () => piocher("theme", theme.champ) });
  const cherche = champThemePacks({ classe: "packs-recherche", placeholder: "Thème à 100 % (ou un personnage) dans mes packs", label: "Thème à 100 % : toutes les questions sur ce thème",
    valeur: reglageDuDe(r, "recherche").terme ?? "", catalogue, exclus: prisesDuJeu(r), entree: () => piocher("recherche", cherche.champ) });
  theme.champ.addEventListener("input", () => { reglageDuDe(r, "theme").terme = theme.champ.value; });
  cherche.champ.addEventListener("input", () => { reglageDuDe(r, "recherche").terme = cherche.champ.value; });
  const de = (mode, titre, champ = null) => h("button", { type: "button", class: `btn packs-de packs-de-${mode}`, text: "🎲", "aria-label": titre, title: titre, onclick: () => piocher(mode, champ) });
  const ligne = (classe, ...enfants) => h("div", { class: `de-ligne ${classe}` }, ...enfants);
  const banque = () => {
    const n = nombreDu("banque");
    // L'âge de ce dé ne vaut que pour lui : celui de la première ligne ne bouge pas.
    const age = r.profil;
    const ajoutees = aLaSuite(r, () => (photos ? tirerPhotos(r, n, familleBanque())
      : jeu === "illustre" ? tirerQuestionsIllustre(r, n, familleBanque())
        : jeu === "express" ? tirerAffirmationsVF(r, n, ageDuDe(r, "banque"))
          : tirerQuestionsQuiz(r, n, ageDuDe(r, "banque"))));
    if (age === undefined) delete r.profil; else r.profil = age;
    if (!ajoutees) annonce(`Plus aucune ${unite} libre à tirer ici.`);
    else if (ajoutees < n) annonce(`Seulement ${plural(ajoutees, `${unite} libre`, `${unite}s libres`)} : les voici.`);
  };
  const [texteBanque, titreBanque] = BANQUE_DU_JEU[photos ? "photos" : jeu] ?? BANQUE_DU_JEU.quiz;
  return [
    h("div", { class: "packs-ligne", "data-packs": String(catalogue.length) },
      h("div", { class: "packs-tete" },
        h("span", { class: "quiz-ajout-titre packs-titre", text: "🎨 Mes packs" }),
        catalogue.length ? null : h("span", { class: "hint small", text: AUCUN_PACK[jeu] ?? AUCUN_PACK.quiz })),
      ligne("packs-de-ligne", de("hasard", "Tout au hasard dans mes packs"), h("span", { class: "packs-de-texte", text: "Tout au hasard dans mes packs" }), ageDe("hasard"), nombreDe("hasard")),
      ligne("packs-de-ligne", de("theme", "Thème principal pour moitié, le reste au hasard dans mes packs", theme.champ), theme.bloc, ageDe("theme"), nombreDe("theme")),
      ligne("packs-de-ligne", de("recherche", "Thème à 100 % dans mes packs", cherche.champ), cherche.bloc, ageDe("recherche"), nombreDe("recherche"))),
    h("div", { class: "banque-ligne" },
      ligne("tirage-ligne",
        h("button", { type: "button", class: "btn tirage-de", text: "🎲", "aria-label": texteBanque, title: titreBanque, onclick: () => { banque(); changer(); } }),
        h("span", { class: "packs-de-texte", text: texteBanque }), parTheme ? themeBanque() : ageDe("banque"), nombreDe("banque"))),
  ];
}

/**
 * La ligne de 🎲 du Quiz (cedric, 26/10 : « une seule ligne de dé ») : le 🎲, un champ (vide : au hasard dans tout ;
 * « libre » : les questions libres de droit ; « mes packs » ; ou un thème : Mario…), le nombre de questions. L'âge est
 * celui de la carte. Chaque clic ajoute ses questions à la suite du « complet », jamais une déjà là.
 */
function ligneDeQuiz(r, changer) {
  const jeu = r.type ?? "quiz";
  const catalogue = catalogueDuJeu(r);
  const libres = libresDeDroit(r);
  const unite = uniteDuJeu(r);
  const reglage = reglageDuDe(r, "unique");
  const defaut = Math.min(RANDOM_COUNT[jeu] ?? TIRAGE_DEFAUT, 15);
  const nombre = () => (NOMBRES_DE_QUIZ.includes(reglage.n) ? reglage.n : defaut);
  const tirer = () => {
    const terme = source.champ.value.trim();
    const n = nombre();
    reglage.terme = terme;
    const ajoutees = tirerAuDe(r, n, terme);
    const sorte = sourceDuDe(terme, libres.themes).sorte;
    if (!ajoutees) {
      annonce(sorte === "packs" && !catalogue.length ? AUCUN_PACK[jeu] ?? AUCUN_PACK.quiz : sorte === "theme" ? `Aucune ${unite} libre ne se rapporte à « ${terme} » : essayez un autre mot, ou videz le champ.` : `Plus aucune ${unite} libre ici : changez l'âge, ou videz le champ.`);
      return;
    }
    if (ajoutees < n) annonce(`Seulement ${plural(ajoutees, `${unite} libre`, `${unite}s libres`)}${sorte === "theme" ? ` sur « ${terme} »` : ""} : les voici.`);
    changer();
  };
  const source = champSourceQuiz({ classe: "de-unique-champ", valeur: reglage.terme ?? "", catalogue, exclus: prisesDuJeu(r), libres, unite, entree: tirer });
  source.champ.addEventListener("input", () => { reglage.terme = source.champ.value; });
  return h("div", { class: "de-ligne de-unique-ligne" },
    h("button", { type: "button", class: "btn packs-de de-unique", text: "🎲", "aria-label": `Tirer les ${unite}s`, title: `Tirer les ${unite}s : au hasard, ou sur ce qui est tapé à droite`, onclick: tirer }),
    source.bloc,
    h("select", { class: "tirage-nombre de-nombre de-nombre-unique", "aria-label": `Nombre de ${unite}s de ce 🎲`, onchange: (e) => { reglage.n = Number(e.target.value); } },
      ...NOMBRES_DE_QUIZ.map((k) => h("option", { value: k, selected: k === nombre(), text: plural(k, unite) }))));
}

/**
 * Le champ du 🎲 du Quiz (cedric, 26/10) : on tape librement (« Mario », « kpop », « libre ») ; dessous, une petite
 * liste propose les sources possibles (les questions libres de droit, mes packs, mes thèmes, les thèmes des questions
 * libres de droit), filtrée en direct ; un clic met son nom dans le champ. Entrée lance le 🎲.
 */
function champSourceQuiz({ classe, valeur = "", catalogue, exclus, libres, unite = "question", entree, placeholder = "Tout au hasard… ou tapez un thème" }) {
  const champ = h("input", { type: "search", class: `quiz-ajout-cherche ${classe}`, placeholder, value: valeur, maxlength: "80",
    "aria-label": "Où piocher : vide, au hasard partout ; « libre », les questions libres de droit ; « mes packs » ; ou un thème (Mario…)" });
  const liste = h("div", { class: "quiz-ajout-liste packs-suggestions" });
  liste.hidden = true;
  liste.addEventListener("mousedown", (e) => e.preventDefault());
  // Mes thèmes, chacun une fois, avec ses questions encore libres.
  const mesThemes = () => {
    const themes = new Map();
    for (const x of catalogue) {
      if (exclus.has(x.cle ?? x.q.text) || !x.theme) continue;
      const cle = cleTheme(x.theme) || x.theme;
      themes.set(cle, { titre: themes.get(cle)?.titre ?? x.theme, n: (themes.get(cle)?.n ?? 0) + 1 });
    }
    return [...themes.values()];
  };
  const dessiner = () => {
    const t = champ.value.trim();
    const items = [
      { titre: libres.titre, details: libres.details },
      { titre: "Mes packs", details: catalogue.length ? `${plural(catalogue.length, unite)} dans mes packs` : "Aucun pack importé" },
      ...(t ? packsQuiRepondent(catalogue, t, exclus) : mesThemes()).map((p) => ({ titre: p.titre, details: `${plural(p.n, `${unite} libre`, `${unite}s libres`)} dans mes packs` })),
      ...Object.values(libres.themes).map((l) => ({ titre: l, details: libres.titre })),
    ];
    const trouves = t ? parPertinence(items.filter((x) => contientTout([x.titre], t) || x.details.includes("dans mes packs")), t, (x) => [x.titre], () => []) : items;
    liste.replaceChildren(...trouves.slice(0, QUIZ_AJOUT_MAX + 2).map((x) => h("button", { type: "button", class: "quiz-ajout-item packs-suggestion", onclick: () => { champ.value = x.titre; champ.dispatchEvent(new Event("input")); liste.hidden = true; } },
      h("b", { text: x.titre }), h("span", { class: "small", text: x.details }))));
    liste.hidden = !trouves.length;
  };
  champ.addEventListener("input", dessiner);
  champ.addEventListener("focus", dessiner);
  champ.addEventListener("blur", () => { liste.hidden = true; });
  champ.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); liste.hidden = true; entree?.(); } });
  return { champ, bloc: h("div", { class: "quiz-ajout-champ" }, champ, liste) };
}

/** Sans pack pour ce jeu : où les importer. */
const AUCUN_PACK = {
  quisuis: "Aucun personnage de mes packs : Bibliothèque › Questions › « 📦 Importer un pack ZIP », ou une série dans la page du jeu.",
  quiz: "Aucun pack de quiz importé : Bibliothèque › Questions › « 📦 Importer un pack ZIP ».",
  illustre: "Aucun pack de Quiz illustré importé : Bibliothèque › Questions › « 📦 Importer un pack ZIP ».",
  express: "Aucun pack de Vrai ou Faux importé : Bibliothèque › Questions › « 📦 Importer un pack ZIP ».",
  zoom: "Aucune série de photos : Bibliothèque › Questions › « 📦 Importer un pack ZIP » ou « 📷 Nouvelle série de photos ».",
  flou: "Aucune série de photos : Bibliothèque › Questions › « 📦 Importer un pack ZIP » ou « 📷 Nouvelle série de photos ».",
};
/** Le dé des contenus libres de droit de chaque jeu : son texte, son info-bulle. */
const BANQUE_DU_JEU = {
  quiz: ["Tout au hasard dans les questions libres de droit", "Tout au hasard dans les questions libres de droit (Quiz classique tout prêt, Juste Chiffre compris)"],
  illustre: ["Tout au hasard dans le Quiz illustré tout prêt", "Tout au hasard dans le Quiz illustré tout prêt (photos libres de droit, sinon émojis)"],
  express: ["Tout au hasard dans le Vrai ou Faux tout prêt", "Tout au hasard dans le Vrai ou Faux tout prêt (autant de vraies que de fausses)"],
  photos: ["Tout au hasard dans les photos libres de droit", "Tout au hasard dans la banque de photos libres de droit"],
};

/**
 * Une question retirée d'une série piochée (cedric, 25/10) : deux dés à sa place, l'un au hasard dans tous les packs,
 * l'autre sur le thème tapé dans son petit champ (d'office celui de la série) ; à l'âge de la série.
 */
function caseVidePioche(r, x, i, profil, changer) {
  const catalogue = catalogueDuJeu(r);
  const unite = uniteDuJeu(r);
  const age = PROFILES[x.pioche?.profil] ? x.pioche.profil : profil;
  const remplir = (mode, terme = "") => {
    if (mode === "recherche" && !terme) { annonce("Tapez un thème à droite du second 🎲."); champ.focus(); return; }
    const [y] = piocherDansLesPacks(catalogue, 1, { mode, terme, niveau: niveauDesPacks(NIVEAU_DU_PROFIL[age]), exclus: prisesDuJeu(r) });
    if (!y) { annonce(mode === "hasard" ? `Plus aucune ${unite} libre dans vos packs.` : `Plus aucune ${unite} libre sur « ${terme} » dans vos packs.`); return; }
    x.questions = casesPioche(x).map((q, k) => (k === i ? versQuestionDePack(y, Math.random, r.type ?? "quiz") : q));
    changer();
  };
  const champ = h("input", { type: "search", class: "packs-case-theme", placeholder: "Thème…", "aria-label": "Thème de la question à piocher", maxlength: "80",
    value: x.pioche?.terme ?? "", onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); remplir("recherche", champ.value.trim()); } } });
  return h("li", { class: "tirage-q vide packs-case" }, h("div", { class: "tirage-q-ligne" },
    h("button", { type: "button", class: "btn packs-de petit packs-case-hasard", text: "🎲", "aria-label": "Piocher une question au hasard dans mes packs", title: "Une question au hasard, n'importe quel thème", onclick: () => remplir("hasard") }),
    h("span", { class: "hint small", text: "ou" }),
    h("button", { type: "button", class: "btn packs-de petit packs-case-theme-de", text: "🎲", "aria-label": "Piocher une question sur ce thème", title: "Une question sur le thème tapé à droite", onclick: () => remplir("recherche", champ.value.trim()) }),
    champ));
}

/**
 * Manche Quiz (cedric, 23/10) : un seul jeu, de 1 à 100 questions, fait de séries qui passent dans l'ordre choisi.
 * Même carte pour le Quiz illustré, le Vrai ou Faux express, le Zoom mystère et l'Image floue (cedric, 25/10).
 * - En haut, le compteur de toute la manche (dans une prestation : sur la ligne du numéro du jeu).
 * - Les outils de création, ensemble : l'âge (d'office pour chaque 🎲) et le total ; trois 🎲 dans mes packs et un dans
 *   les contenus libres de droit, chacun avec son âge (ou son thème) et son nombre ; « Rappeler un de vos quiz » ; au
 *   Zoom mystère et à l'Image floue, « ⭐ Composer avec vos images ».
 * - Puis la case de la question des bougies (premier Quiz de la prestation, cochée d'office), la Super Finale : oui ou
 *   non, ses dernières questions (3 d'office) et son multiplicateur (×2 d'office) ; en dernière ligne, le « Quiz
 *   complet » : toutes les questions dans l'ordre de passage (les bougies comprises), chacune monte, descend ou
 *   s'enlève, et 🔀 mélange tout ; une question tirée au 🎲 retirée y laisse ses dés.
 */
function mancheQuiz(r) {
  const series = seriesDe(r);
  const de = serieDuDe(r);
  // Quiz illustré : la banque se tire par thème (pas de profil ni de Juste Chiffre) ; pas de question des bougies.
  const illustre = r.type === "illustre";
  // Zoom mystère, Image floue : pareil, avec des photos ; ni Super Finale ni bougies.
  const photos = estJeuDePhotos(r.type);
  // Vrai ou Faux express : des affirmations, au niveau du profil ; sa Super Finale comme au Quiz, pas de bougies.
  const express = r.type === "express";
  const unite = uniteDuJeu(r);
  const unique = deUnique(r);
  const famille = familleDuDe(r);
  const profil = PROFILES[de?.profil] ? de.profil : PROFILES[r.profil] ? r.profil : roundCtx.profile?.() ?? "MOYENS";
  // Une nouvelle manche part avec la Super Finale sur ses 3 dernières questions, ×2 (cedric, 23/10).
  if (hasFinale(r.type) && r.finale === undefined && !roundFilled(r)) r.finale = SUPER_FINALE_LAST;
  const assemblage = questionsDuQuiz(r, quizzes);
  const total = assemblage.length;
  const finale = hasFinale(r.type) && r.finale > 0 ? Math.min(r.finale, total) : 0;
  // Les questions de la Super Finale : les dernières dans l'ordre de passage (celui du « Quiz complet »).
  const clesFinale = new Set(finale ? assemblage.slice(-finale).map((x) => x.cle) : []);
  const compteur = h("p", { class: "quiz-compteur", "aria-live": "polite", text: compteurQuiz(r) });
  const changer = () => { roundCtx.refresh(); };

  // Deuxième ligne : « Rappeler un de vos quiz » (cedric, 23/10) : une recherche dans les prestations archivées
  // (prénom, âge, date, notes…) ; celle choisie ajoute tout son Quiz en une série à la fin (questions copiées : la
  // prestation archivée ne change pas).
  const archives = quizArchives(r.type ?? "quiz");
  const rappel = ligneAjoutQuiz({
    classe: "quiz-rappel", titre: photos ? "📚 Rappeler les photos d'un ancien anniversaire" : express ? "📚 Rappeler les affirmations d'un ancien anniversaire" : illustre ? "📚 Rappeler un de vos quiz illustrés" : unique ? "📚 Rappeler le quiz d'un ancien anniversaire" : "📚 Rappeler un de vos quiz", label: "Chercher une prestation archivée",
    placeholder: unique ? "Prénom, âge, date…" : "Prénom, âge, date… d'une prestation archivée", vide: "Aucun ancien anniversaire avec ce jeu",
    aucun: "Aucune prestation archivée ne correspond.", items: archives, attr: (x) => ({ "data-show": x.id }),
    choisir: (x) => {
      series.push({ id: nouvelId("p"), origine: "reprise", titre: x.titre, questions: JSON.parse(JSON.stringify(x.questions)) });
      changer();
    },
  });
  if (unique) rappel.classList.add("fine");

  // Le Quiz (cedric, 26/10) : l'âge sur la ligne du numéro, puis une seule ligne de 🎲 et le rappel, plus fin.
  const outils = unique ? h("div", { class: "quiz-outils" }, ligneDeQuiz(r, changer), rappel, photos ? ligneVosImages(r, changer) : null)
    : h("div", { class: "quiz-outils" }, ligneAgeQuiz(r, changer), ...lignesDesQuiz(r, changer), rappel, photos ? ligneVosImages(r, changer) : null);
  const enTete = unique ? menuAge(ageDuQuiz(r), { class: "tirage-profil quiz-age quiz-en-tete", "aria-label": `Âge des ${unite}s` }, (v) => { r.profil = v; changer(); }) : null;
  // Une question tirée au 🎲 des contenus libres, retirée : son 🎲 en tire une autre de la même sorte.
  const tirerUne = (q) => {
    const pioche = photos ? { qcm: piocherPhotos(r, 1, famille), chiffres: [] } : illustre ? { qcm: piocherIllustre(r, 1, famille), chiffres: [] }
      : express ? { qcm: piocherAffirmations(r, 1, profil), chiffres: [] } : piocherQuiz(r, { qcm: q.nombre ? 0 : 1, chiffres: q.nombre ? 1 : 0, profil });
    return pioche.qcm[0] ?? pioche.chiffres[0] ?? null;
  };

  // La question des bougies (premier Quiz de la prestation), juste au-dessus de la Super Finale.
  const bougies = roundCtx === prestationCtx && editing && premierQuiz(editing.rounds, quizzes) === r
    ? h("label", { class: "check bougies quiz-bougies", title: "« Combien de bougies sur le gâteau de … cette année ? » : l'âge de l'enfant, au Juste Chiffre. D'office juste avant la Super Finale ; elle se range où vous voulez dans le Quiz complet." },
      h("input", { type: "checkbox", checked: r.bougies !== false, onchange: (e) => { r.bougies = e.target.checked ? null : false; if (!e.target.checked) oublierPlaceBougies(r); changer(); } }),
      unique ? "🎂 Bougies" : "🎂 Question des bougies")
    : null;

  // Dernière ligne : la Super Finale (cedric, 23/10) : oui ou non, combien de dernières questions, le multiplicateur.
  // Pas au Zoom mystère ni à l'Image floue.
  const avec = r.finale > 0;
  const derniere = !hasFinale(r.type) ? null : h("div", { class: "quiz-finale" },
    h("span", { class: "quiz-finale-titre", text: "🏆 Super Finale" }),
    h("select", { class: "finale-oui", "aria-label": "Super Finale", onchange: (e) => { r.finale = e.target.value === "oui" ? (r.finaleAvant > 0 ? r.finaleAvant : SUPER_FINALE_LAST) : null; changer(); } },
      h("option", { value: "oui", selected: avec, text: "Oui" }),
      h("option", { value: "non", selected: !avec, text: "Non" })),
    avec ? h("select", { class: "finale", "aria-label": "Questions de la Super Finale", onchange: (e) => { r.finale = Number(e.target.value) || null; r.finaleAvant = r.finale; changer(); } },
      ...[...new Set([1, 2, 3, 4, 5, 6, 8, 10, r.finale])].sort((a, b) => a - b).map((k) => h("option", { value: k, selected: r.finale === k, text: k === 1 ? `La dernière ${unite}` : `Les ${k} dernières ${unite}s` })))
      : null,
    avec ? h("select", { class: "finale-facteur", "aria-label": "Multiplicateur de la Super Finale", onchange: (e) => { r.facteur = Number(e.target.value); changer(); } },
      ...FACTEURS_FINALE.map((k) => h("option", { value: k, selected: (FACTEURS_FINALE.includes(r.facteur) ? r.facteur : FACTEURS_FINALE[0]) === k, text: `Points ×${k}` })))
      : null,
    avec && !unique ? h("span", { class: "hint small", text: "Sur le téléphone, Sarah peut encore changer le multiplicateur juste avant." }) : null,
    // Le Quiz (cedric, 26/10) : les bougies au bout de la ligne de la Super Finale, tout en bas.
    unique ? bougies : null);

  if (unique) return [compteur, enTete, outils, quizComplet(r, assemblage, clesFinale, changer, { profil, tirerUne: (terme) => uneAuDe(r, terme), unique }), derniere];
  return [compteur, outils, bougies, derniere, quizComplet(r, assemblage, clesFinale, changer, { profil, tirerUne })];
}

/** Résultats montrés au plus sous une recherche d'ajout du Quiz (cedric, 23/10 : « 5 ou 6 »). */
const QUIZ_AJOUT_MAX = 6;

/**
 * Une ligne d'ajout du Quiz (cedric, 23/10) : une case à gauche (pas un champ), une recherche à droite. Rien tant
 * qu'aucune lettre n'est tapée ; ensuite, à chaque lettre, les QUIZ_AJOUT_MAX meilleurs résultats (prénom, titre,
 * date…), les uns sous les autres, dans une liste posée à droite par-dessus l'écran (rien ne bouge en dessous). Un clic
 * sur un résultat l'ajoute.
 */
/** La recherche de « 🖼 Ajouter une image » (le temps de l'écran), par manche : le texte tapé, la main gardée au champ. */
const panneauxVosImages = new WeakMap();
/** Au plus autant d'images montrées à la fois : la recherche trouve les autres. */
const VOS_IMAGES_MAX = 24;

/**
 * Zoom mystère, Image floue : « 🖼 Ajouter une image » (cedric, 26/10 : « une option de recherche qui va piocher dans
 * toute ma bibliothèque […] une seule image qui vient se rajouter au jeu complet »). Une recherche en direct dans toute
 * la bibliothèque d'images : « Mes images », les images des packs, les photos libres (jamais d'émoji : ces jeux ne
 * montrent que des photos ; choisies à la main, jamais au 🎲 : règle 16). Un clic ajoute CETTE image à la fin du
 * « … complet », dans la série « ⭐ Vos images » ; son nom est la réponse à trouver.
 * Une image déjà dans un autre jeu de la fête, ou ailleurs dans ce jeu, est signalée en rouge mais reste possible
 * (« Jamais deux fois » : à Sarah de décider) ; seule celle déjà ajoutée ici ne se reprend pas.
 */
function ligneVosImages(r, changer) {
  const panneau = panneauxVosImages.get(r) ?? { recherche: "", focus: false };
  panneauxVosImages.set(r, panneau);
  const cherche = h("input", {
    type: "search", class: "quiz-ajout-cherche vos-images-cherche", "aria-label": "Chercher une image dans toute la bibliothèque", value: panneau.recherche,
    placeholder: "Toute ma bibliothèque : nom, personnage, thème…",
  });
  const grille = h("div", { class: "media-grid vos-images-grille" });
  const ligne = h("div", { class: "quiz-ajouts vos-images" },
    h("span", { class: "quiz-ajout-titre vos-images-titre", text: "🖼 Ajouter une image" }), h("div", { class: "quiz-ajout-champ" }, cherche));
  const groupes = groupesImages();
  const images = [...groupes.miennes, ...groupes.packs, ...groupes.photos];
  const idImage = (q) => q?.imageId ?? (q?.banque ? `${BANQUE}${q.banque}` : null);
  const dansCeJeu = new Set(questionsDesSeries(r, quizzes).map(idImage).filter(Boolean));
  const dansLaComposition = new Set((seriesDe(r).find((x) => x.origine === "images")?.questions ?? []).map(idImage).filter(Boolean));
  const ailleurs = JSON.stringify((roundCtx === prestationCtx && editing ? editing.rounds : []).filter((m) => m && m !== r));
  const ajouterUne = (x) => {
    const serie = seriesDe(r).find((y) => y.origine === "images");
    // Les autres propositions des pupitres : les réponses de la série, puis ses autres images, puis des mots de la banque.
    const motsBanque = banqueItems().map((y) => y.value?.choices?.[y.value.correct]).filter(Boolean);
    const q = x.id.startsWith(BANQUE) ? versPhotoTiree(x.id.slice(BANQUE.length))
      : photosDeMesImages([x], { voisines: (serie?.questions ?? []).filter(Boolean).map(reponsePhoto), secours: [...groupes.miennes, ...motsBanque], deja: [...dansLaComposition] })[0];
    if (!q) return;
    aLaSuite(r, () => {
      const s = serie ?? { id: nouvelId("m"), origine: "images", questions: [] };
      if (!serie) seriesDe(r).push(s);
      s.questions = [...(s.questions ?? []).filter(Boolean), q];
    });
    panneau.focus = true;
    changer();
  };
  const tuile = (x) => {
    const nom = `${x.nom ?? ""}`.trim();
    const deja = dansLaComposition.has(x.id);
    const libre = x.groupe === "photos";
    const ceJeu = !deja && dansCeJeu.has(x.id);
    const autreJeu = !deja && !ceJeu && (ailleurs.includes(x.id) || (libre && ailleurs.includes(`"${x.id.slice(BANQUE.length)}"`)));
    const etat = deja ? "✓ Déjà dans le jeu" : !nom ? "À nommer dans Mes images" : ceJeu ? "Déjà utilisée dans ce jeu" : autreJeu ? "Déjà utilisée dans la fête" : "";
    return h("button", {
      type: "button", class: "media-tile vos-images-tuile", "data-image": x.id, disabled: deja || !nom, title: etat || `Ajouter « ${nom} » à la fin du jeu`,
      onclick: () => ajouterUne(x),
    }, libre ? h("img", { src: x.src, alt: "", loading: "lazy" }) : photoBibliotheque(x.id, { loading: "lazy" }), h("span", { text: nom || "Sans nom" }),
    etat ? h("small", { class: `vos-images-etat${autreJeu || ceJeu ? " alerte" : ""}`, text: etat }) : null);
  };
  // Rien tant qu'aucune lettre n'est tapée ; ensuite, à chaque lettre, les meilleures images.
  const dessiner = () => {
    const q = panneau.recherche;
    grille.hidden = !q.trim();
    if (grille.hidden) { grille.replaceChildren(); return; }
    const trouvees = parPertinence(images.filter((x) => contientTout([x.nom, x.cat, ...(x.tags ?? []), ...(x.ou ?? [])].filter(Boolean), q)), q,
      (x) => [x.nom].filter(Boolean), (x) => [x.cat, ...(x.tags ?? []), ...(x.ou ?? [])].filter(Boolean));
    grille.replaceChildren(...(trouvees.length ? trouvees.slice(0, VOS_IMAGES_MAX).map(tuile)
      : [h("p", { class: "hint small", text: "Aucune image de la bibliothèque ne correspond." })]),
    ...(trouvees.length > VOS_IMAGES_MAX ? [h("p", { class: "hint small", text: `Et ${plural(trouvees.length - VOS_IMAGES_MAX, "autre image", "autres images")} : précisez la recherche.` })] : []));
  };
  cherche.addEventListener("input", () => { panneau.recherche = cherche.value; dessiner(); });
  dessiner();
  if (panneau.focus) { panneau.focus = false; requestAnimationFrame(() => cherche.focus()); }
  return h("div", { class: "vos-images-bloc" }, ligne, grille);
}

function ligneAjoutQuiz({ classe, titre, label, placeholder, vide, aucun, items, attr, choisir }) {
  const cherche = h("input", { type: "search", class: `quiz-ajout-cherche ${classe}-cherche`, "aria-label": label, placeholder: items.length ? placeholder : vide });
  const resultats = h("div", { class: `quiz-ajout-liste ${classe}-liste` });
  resultats.hidden = true;
  // Un clic dans la liste ne fait pas perdre la main au champ (la liste resterait sinon cachée avant le clic).
  resultats.addEventListener("mousedown", (e) => e.preventDefault());
  const dessiner = () => {
    const q = cherche.value;
    if (!q.trim()) { resultats.hidden = true; resultats.replaceChildren(); return; }
    const trouves = parPertinence(items.filter((x) => contientTout([...x.noms, ...x.autres].filter(Boolean), q)), q, (x) => x.noms.filter(Boolean), (x) => x.autres.filter(Boolean))
      .slice(0, QUIZ_AJOUT_MAX);
    resultats.replaceChildren(...(trouves.length ? trouves.map((x) => h("button", { type: "button", class: `quiz-ajout-item ${classe}-item`, ...attr(x), onclick: () => choisir(x) },
      h("b", { text: x.titre }), h("span", { class: "small", text: x.details }))) : [h("p", { class: "hint small", text: aucun })]));
    resultats.hidden = false;
  };
  cherche.addEventListener("input", dessiner);
  cherche.addEventListener("focus", dessiner);
  cherche.addEventListener("blur", () => { resultats.hidden = true; });
  return h("div", { class: `quiz-ajouts ${classe}` },
    h("span", { class: `quiz-ajout-titre ${classe}-titre`, text: titre }),
    h("div", { class: "quiz-ajout-champ" }, cherche, resultats));
}

/** « Quiz complet » déplié (le temps de l'écran), par manche ; celui du Quiz, ouvert d'office : refermé. */
const quizCompletsDeplies = new WeakSet();
const quizCompletsFermes = new WeakSet();
// Décochée, la question des bougies oublie sa place : recochée, elle revient juste avant la Super Finale.
const oublierPlaceBougies = (r) => { if (r.ordreQuiz?.length) r.ordreQuiz = r.ordreQuiz.filter((c) => c !== CLE_BOUGIES); };

/**
 * Dernière ligne d'un Quiz (cedric, 23/10) : le « Quiz complet », tout ce qui a été ajouté (🎲, prestation archivée,
 * bibliothèque…) dans l'ordre de passage. Déplié : chaque question monte, descend ou s'enlève ; 🔀 mélange tout.
 * L'ordre rangé ici est gardé dans la manche (`ordreQuiz`). La question des bougies (case cochée) en est une comme les
 * autres : d'office juste avant la Super Finale (sa place suit les ajouts), jusqu'à ce qu'on la déplace ou qu'on mélange.
 */
function quizComplet(r, assemblage, clesFinale, changer, des = null) {
  const profilVides = des?.profil ?? null;
  // Le Quiz (cedric, 25/10) : ses séries ne se voient plus qu'ici ; une question tirée au 🎲 (banque ou mes packs)
  // retirée laisse ses dés, en tête de la liste, pour en tirer une autre.
  const avecVides = des != null;
  // Le Quiz (cedric, 26/10) : une question retirée laisse sa place, avec son petit 🎲 et son champ ; une seconde ✕
  // supprime la place pour de bon.
  const unique = des?.unique === true;
  const vides = !avecVides || unique ? [] : [
    ...casesDuTirage(r).map((q, i) => ({ serie: serieDuDe(r), q, i })),
    ...seriesPioche(r).flatMap((x) => casesPioche(x).map((q, i) => ({ serie: x, q, i }))),
  ].filter((v) => caseVide(v.q));
  const avecPlaces = unique ? ordreAvecCasesVides(r, quizzes) : null;
  if (!assemblage.length && !vides.length && !avecPlaces?.some((x) => x.vide)) return null;
  if (vides.length) quizCompletsDeplies.add(r);
  const photos = estJeuDePhotos(r.type);
  const unite = photos ? "photo" : r.type === "express" ? "affirmation" : "question";
  const sig = (q) => (photos ? signatureQuestion(q, r.type) : q.text);
  const bougies = roundCtx === prestationCtx && editing && premierQuiz(editing.rounds, quizzes) === r
    && !assemblage.some((x) => x.q.kind === "number" && /bougie/i.test(x.q.text ?? ""))
    ? questionBougies({ childName: $("show-child").value, age: $("show-age").value }, r) : null;
  const rangees = bougies ? placeDesBougies(r, quizzes) : null;
  const vue = unique ? avecPlaces.filter((x) => !x.bougies || bougies).map((x) => (x.bougies ? { ...x, q: bougies } : x)) : [...assemblage];
  if (bougies && !unique) vue.splice(rangees != null ? Math.min(rangees, vue.length) : assemblage.length - clesFinale.size, 0, { cle: CLE_BOUGIES, bougies: true, q: bougies });
  if (bougies && unique && !vue.some((x) => x.bougies)) {
    // D'office juste avant la Super Finale, les cases vides comptées à leur place.
    const avant = assemblage.length - clesFinale.size;
    let reelles = 0;
    let k = 0;
    for (; k < vue.length && reelles < avant; k++) if (!vue[k].vide) reelles++;
    vue.splice(k, 0, { cle: CLE_BOUGIES, bougies: true, q: bougies });
  }
  const cles = vue.map((x) => x.cle);
  // Les bougies restent d'office juste avant la Super Finale tant qu'on ne les a pas déplacées (ou mélangées) elles-mêmes.
  const ranger = (nouvel, avecBougies) => {
    r.ordreQuiz = avecBougies || rangees != null ? nouvel : nouvel.filter((c) => c !== CLE_BOUGIES);
    changer();
    noterEcran();
  };
  const deplacer = (k, d) => {
    const j = k + d;
    if (j < 0 || j >= cles.length) return;
    const nouvel = [...cles];
    [nouvel[k], nouvel[j]] = [nouvel[j], nouvel[k]];
    ranger(nouvel, vue[k].bougies || vue[j].bougies);
  };
  // Enlever : la question part de sa série (une question tirée au 🎲 ne revient pas au prochain tirage) ; celle des
  // bougies se décoche.
  const enlever = (x) => {
    if (unique) return enleverDuQuiz(x);
    if (x.bougies) {
      r.bougies = false;
      oublierPlaceBougies(r);
      changer();
      noterEcran();
      return;
    }
    const serie = seriesDe(r).find((y) => y.id === x.serie.id);
    if (!serie) return;
    if (serie.origine === "quiz") serie.sans = [...(serie.sans ?? []), sig(x.q)];
    else {
      const reste = (serie.questions ?? []).filter(Boolean);
      const k = reste.findIndex((q) => cleQuestion(serie, q, r.type) === x.cle);
      if (k < 0) return;
      if (serie.origine === "de" || serie.pioche) r.ecartees = [...(r.ecartees ?? []), sig(reste[k])];
      if (avecVides && (serie.origine === "de" || serie.pioche)) serie.questions = reste.map((q, i) => (i === k ? { vide: true, ...(q.nombre ? { nombre: true } : {}) } : q));
      else {
        serie.questions = reste.filter((_, i) => i !== k);
        if (!serie.questions.some((q) => !caseVide(q))) r.seriesQuiz = seriesDe(r).filter((y) => y !== serie);
      }
    }
    if (r.ordreQuiz?.length) r.ordreQuiz = cles.filter((c) => c !== x.cle && (c !== CLE_BOUGIES || rangees != null));
    changer();
    noterEcran();
  };
  // Le Quiz : ✕ laisse une case vide à sa place (la clé de sa question) ; ✕ sur une case vide la supprime.
  const enleverDuQuiz = (x) => {
    if (x.bougies) {
      r.bougies = false;
      oublierPlaceBougies(r);
      changer();
      noterEcran();
      return;
    }
    const serie = seriesDe(r).find((y) => y.id === x.serie.id);
    if (!serie) return;
    const sansBougies = (liste) => (rangees != null ? liste : liste.filter((c) => c !== CLE_BOUGIES));
    if (x.vide) {
      serie.questions = casesPioche(serie).filter((_, i) => i !== x.i);
      if (!serie.questions.length) r.seriesQuiz = seriesDe(r).filter((y) => y !== serie);
      r.ordreQuiz = sansBougies(cles.filter((c) => c !== x.cle));
    } else if (serie.origine === "quiz") {
      serie.sans = [...(serie.sans ?? []), sig(x.q)];
      if (r.ordreQuiz?.length) r.ordreQuiz = cles.filter((c) => c !== x.cle && (c !== CLE_BOUGIES || rangees != null));
    } else {
      const reste = casesPioche(serie);
      const k = reste.findIndex((q) => !caseVide(q) && cleQuestion(serie, q, r.type) === x.cle);
      if (k < 0) return;
      const q = reste[k];
      r.ecartees = [...(r.ecartees ?? []), sig(q)];
      // La case garde la clé de sa question : elle reste à sa place dans l'ordre.
      serie.questions = reste.map((y, i) => (i === k ? { vide: true, id: typeof q.id === "string" && q.id ? q.id : `t:${signatureQuestion(q, r.type)}`, ...(q.nombre ? { nombre: true } : {}) } : y));
      r.ordreQuiz = sansBougies(cles);
    }
    changer();
    noterEcran();
  };
  // Le 🎲 d'une case vide du Quiz : une question à sa place (au hasard, ou sur le thème tapé à côté).
  const remplirCase = (x, terme) => {
    const neuve = des.tirerUne(terme);
    if (!neuve) { annonce(terme ? `Plus aucune ${uniteDuJeu(r)} libre sur « ${terme} » : essayez un autre mot, ou videz le champ.` : `Plus aucune ${uniteDuJeu(r)} libre ici : changez l'âge.`); return; }
    const serie = seriesDe(r).find((y) => y.id === x.serie.id);
    if (!serie) return;
    serie.questions = casesPioche(serie).map((y, i) => (i === x.i ? neuve : y));
    const nouvelle = cleQuestion(serie, neuve, r.type);
    r.ordreQuiz = (rangees != null ? cles : cles.filter((c) => c !== CLE_BOUGIES)).map((c) => (c === x.cle ? nouvelle : c));
    changer();
    noterEcran();
  };
  // Le même champ que le 🎲 du Quiz (cedric, 26/10 : « le champ semble inactif » sans sa petite liste) : mêmes règles.
  const caseVideQuiz = (x, k) => {
    const { champ, bloc } = champSourceQuiz({ classe: "quiz-case-champ", catalogue: catalogueDuJeu(r), exclus: prisesDuJeu(r), libres: libresDeDroit(r), unite: uniteDuJeu(r), placeholder: "Au hasard, ou un thème", entree: () => remplirCase(x, champ.value.trim()) });
    bloc.classList.add("quiz-case-source");
    return h("li", { class: "tirage-q vide packs-case quiz-case-vide", "data-cle": x.cle }, h("div", { class: "tirage-q-ligne" },
      h("span", { class: "quiz-complet-num", text: `${k + 1}` }),
      h("button", { type: "button", class: "btn packs-de petit quiz-case-de", text: "🎲", "aria-label": `Tirer une autre ${unite}`, title: `Une autre ${unite} : au hasard, ou sur ce qui est tapé à côté`, onclick: () => remplirCase(x, champ.value.trim()) }),
      bloc,
      h("button", { type: "button", class: "icon tirage-retirer quiz-case-retirer", text: "✕", title: "Supprimer cette place", "aria-label": "Supprimer cette place", onclick: () => enleverDuQuiz(x) })));
  };
  // Les N dernières places restent la Super Finale (cedric, 26/10) : ni les bougies ni une case vide n'y tombent.
  const reelles = new Set(assemblage.map((x) => x.cle));
  const brasser = () => {
    const vraies = shuffle(cles.filter((c) => reelles.has(c)));
    const fin = vraies.splice(vraies.length - clesFinale.size);
    return [...shuffle([...vraies, ...cles.filter((c) => !reelles.has(c))]), ...fin];
  };
  // Le thème du pack d'où vient la question, juste à gauche de sa photo (cedric, 26/10 : « Pokémon », « Mario », « Roblox »).
  const themeDePack = (cle) => {
    const quiz = quizzes[/\|pk-(.+):\d+$/.exec(cle ?? "")?.[1]];
    return quiz ? h("span", { class: "quiz-complet-theme", text: themeDe(quiz.theme, quiz.title), title: `Question du pack « ${quiz.title ?? ""} »` }) : null;
  };
  const melanger = () => {
    let nouvel = brasser();
    for (let essai = 0; essai < 5 && cles.length > 1 && nouvel.every((c, k) => c === cles[k]); essai++) nouvel = brasser();
    ranger(nouvel, true);
  };
  // Glisser une question à la souris plus haut ou plus bas (cedric, 26/10), en plus de ↑ ↓ : comme au 🔀, les N
  // dernières places restent la Super Finale (les bougies ou une case vide posées là passent juste avant).
  const garderFinale = (liste) => {
    const fin = liste.filter((c) => reelles.has(c)).slice(-clesFinale.size);
    return clesFinale.size ? [...liste.filter((c) => !fin.includes(c)), ...fin] : liste;
  };
  const lignes = vue.map((x, k) => (x.vide ? caseVideQuiz(x, k) : h("li", { class: `tirage-q quiz-complet-q${x.bougies ? " quiz-complet-bougies" : ""}${clesFinale.has(x.cle) ? " en-finale" : ""}`, "data-cle": x.cle },
    h("div", { class: "tirage-q-ligne" },
      h("span", { class: "quiz-complet-num", text: `${k + 1}` }),
      photos ? recadrable(apercuPhoto(x.q), r, x, changer) : null,
      photos ? nomDePhoto(r, x, changer) : h("span", { class: "tirage-texte", text: `${x.bougies ? "🎂 " : ""}${x.q.kind === "number" ? "🔢 " : ""}${x.q.text}` }),
      themeDePack(x.cle),
      photos ? null : r.type === "illustre" ? reponsesIllustrees(x.q, (img, k) => recadrable(img, r, x, changer, k))
        : r.type === "express" ? reponseVF(x.q) : recadrable(miniature(x.q), r, x, changer),
      r.type === "illustre" && sansSesImages(x.q) ? alerteSansImages() : null,
      clesFinale.has(x.cle) ? etiquetteFinale(r) : null,
      h("button", { type: "button", class: "icon quiz-complet-monter", text: "↑", title: `Passer cette ${unite} plus tôt`, "aria-label": `Monter cette ${unite}`, disabled: k === 0, onclick: () => deplacer(k, -1) }),
      h("button", { type: "button", class: "icon quiz-complet-descendre", text: "↓", title: `Passer cette ${unite} plus tard`, "aria-label": `Descendre cette ${unite}`, disabled: k === vue.length - 1, onclick: () => deplacer(k, 1) }),
      h("button", { type: "button", class: "icon tirage-retirer", text: "✕", title: x.bougies ? "Enlever la question des bougies (la case se décoche)" : photos || unite === "affirmation" ? `Enlever cette ${unite} du jeu` : "Enlever cette question du quiz", "aria-label": `Enlever cette ${unite}`, onclick: () => enlever(x) })))));
  const caseVideDe = ({ q, i }) => h("li", { class: "tirage-q vide" }, h("div", { class: "tirage-q-ligne" },
    h("button", { type: "button", class: "btn tirage-de petit", text: "🎲", "aria-label": `Tirer une autre ${unite}`, title: `Tirer une autre ${unite} dans les contenus libres de droit`, onclick: () => {
      const neuve = des.tirerUne(q);
      if (!neuve) { annonce(photos || r.type === "illustre" ? `Plus aucune ${unite} libre dans ce thème : changez de thème, ou baissez le nombre.` : `Plus aucune ${unite} libre de cette sorte pour cet âge : changez l'âge, ou baissez le nombre.`); return; }
      poserTirage(r, casesDuTirage(r).map((y, k) => (k === i ? neuve : y)));
      changer();
    } }),
    h("span", { class: "hint small", text: q.nombre ? "Juste Chiffre à tirer" : photos ? "Photo à tirer" : unite === "affirmation" ? "Affirmation à tirer" : "Question à tirer" })));
  const lignesVides = vides.map((v) => (v.serie?.pioche ? caseVidePioche(r, v.serie, v.i, profilVides, changer) : caseVideDe(v)));
  const liste = h("ol", { class: "tirage-liste serie-liste quiz-complet-liste" }, ...lignesVides, ...lignes);
  glisserDansLaListe(liste, lignes, (k, j) => ranger(garderFinale(deplaceEn(cles, k, j)), vue[k].bougies), (k) => !vue[k].vide);
  // Le Quiz (cedric, 26/10) : son « complet » ouvert d'office.
  liste.hidden = unique ? quizCompletsFermes.has(r) : !quizCompletsDeplies.has(r);
  const nVides = unique ? vue.filter((x) => x.vide).length : vides.length;
  const nom = { illustre: "Quiz illustré complet", zoom: "Zoom mystère complet", flou: "Image floue complète", express: "Vrai ou Faux complet" }[r.type] ?? "Quiz complet";
  const nVue = vue.length - (unique ? nVides : 0);
  const titre = () => `${liste.hidden ? "▸" : "▾"} 🧩 ${nom} : ${nVue} ${unite}${nVue > 1 ? "s" : ""}, dans l'ordre de passage${nVides ? ` (${nVides} à tirer)` : ""}`;
  const voir = h("button", {
    type: "button", class: "chip tirage-voir serie-voir quiz-complet-voir", "aria-expanded": liste.hidden ? "false" : "true", text: titre(),
    title: photos || unite === "affirmation" ? `Voir toutes les ${unite}s du jeu, dans l'ordre` : "Voir toutes les questions du quiz, dans l'ordre",
    onclick: (e) => {
      liste.hidden = !liste.hidden;
      if (liste.hidden) quizCompletsDeplies.delete(r); else quizCompletsDeplies.add(r);
      if (liste.hidden) quizCompletsFermes.add(r); else quizCompletsFermes.delete(r);
      e.currentTarget.textContent = titre();
      e.currentTarget.setAttribute("aria-expanded", liste.hidden ? "false" : "true");
    },
  });
  return h("div", { class: "serie quiz-complet" },
    h("div", { class: "serie-tete" },
      voir,
      h("button", { type: "button", class: "chip quiz-melanger", text: "🔀 Mélanger", title: photos || unite === "affirmation" ? `Mélanger toutes les ${unite}s du jeu` : "Mélanger toutes les questions du quiz", disabled: vue.length < 2, onclick: melanger })),
    liste);
}


/** Contenu et réglages d'une manche, selon son jeu : les mêmes dans une prestation et dans la page d'un jeu. */
function roundFields(r) {
  const options = Object.entries(quizzes).sort(([, a], [, b]) => a.title.localeCompare(b.title));
  const decks = Object.entries(mimes).sort(([, a], [, b]) => a.title.localeCompare(b.title));
  const lists = Object.entries(playlists).filter(([, p]) => !isStatuesList(p)).sort(([, a], [, b]) => a.title.localeCompare(b.title));
  const photos = r.type === "zoom" || r.type === "flou";
  // Quiz et Quiz illustré (cedric, 23/10) : une seule manche faite de séries.
  const quiz = estEnSeries(r.type);
  const content = BUILTIN_GAMES[r.type]
    // Jeux au buzzer intégrés : rien à préparer, seulement combien de mots ou de personnages.
    ? h("div", { class: "grow picto-round" },
      roundPicks(r).length ? null : h("select", { class: "grow", "aria-label": "Nombre", onchange: (e) => { r.count = Number(e.target.value); roundCtx.summary(); } },
        ...[4, 5, 6, 8, 10].map((n) => h("option", {
          value: n, selected: (r.count ?? BUILTIN_GAMES[r.type].count) === n,
          text: `${n} ${BUILTIN_GAMES[r.type].unit}s (${BUILTIN_GAMES[r.type].rule})`,
        }))),
      r.type === "disparu" ? photoSwitch(r) : null,
      picksSelection(r))
    : r.type === "statues"
    // Statues musicales : vos chansons (aucune : la musique de la fête). Plus de durée à régler (cedric, 27/10) :
    // chaque chanson se joue en entier.
    ? h("div", { class: "grow picto-round" }, statuesChansons(r))
    : r.type === "pictionary"
    // Pictionary : les mots viennent du catalogue (page du jeu) ; le temps de dessin et les séries de mots.
    ? h("div", { class: "grow picto-round" },
      h("select", { "aria-label": "Temps de dessin", onchange: (e) => { r.duration = Number(e.target.value); roundCtx.summary(); } },
        ...PICTO_SECONDS.map((n) => h("option", { value: n, selected: (r.duration ?? PICTO_SEC) === n, text: `${n} secondes de dessin par équipe (un mot par tour, ${PICTO_POINTS} points s'il est trouvé)` }))),
      pictoSeriesPicker(r),
      picksSelection(r))
    : r.type === "coffres"
    // Les coffres mystères : rien à préparer, le nombre de coffres suit le nombre d'équipes.
    ? h("span", { class: "grow hint small", text: "Rien à préparer : le nombre de coffres suit le nombre d'équipes. Idéal en dernier jeu." })
    : r.type === "patate"
    // « Ça va exploser ! » : seulement le nombre de bombes (cedric, 26/10, test Mi Box), 3 d'office.
    ? h("div", { class: "grow picto-round" },
      h("select", { class: "patate-bombes", "aria-label": "Nombre de bombes", onchange: (e) => { r.bombs = Number(e.target.value); roundCtx.summary(); } },
        ...PATATE_BOMBES.map((n) => h("option", { value: n, selected: bombesDe(r) === n, text: `${bombesParPartie(n)}${n > 1 ? " (une nouvelle mèche après chaque explosion)" : ""}` }))),
      h("span", { class: "hint small", text: "La TV tire chaque mèche au sort, la bombe part d'une équipe au hasard." }))
    : r.type === "gonfleur"
    ? h("span", { class: "grow hint small", text: "Rien à préparer : chaque équipe tapote sa tablette, le premier ballon qui éclate gagne." })
    : r.type === "duel"
    ? reglagesDuDuel(r)
    : r.type === "simon"
    ? reglagesDuSimon(r)
    : r.type === "chrono"
    ? reglagesDuChrono(r)
    : MUSIC_GAMES[r.type]
    // Blind test, quiz musical : une playlist entière, ou des titres choisis un par un dans toutes les playlists.
    ? h("div", { class: "grow picto-round" },
      modeSwitch(r, roundTracks(r).length > 0 || r.byItem === true, "Une playlist entière", "Des titres au choix", (on) => {
        r.byItem = on;
        if (on) { r.tracks = r.playlistId ? playableTracks(playlists[r.playlistId]).map((t) => t.audioId).slice(0, MAX_PICKS) : []; r.playlistId = ""; } else r.tracks = null;
      }),
      roundTracks(r).length || r.byItem
        ? itemSelection(r, "tracks")
        : h("select", { class: "grow", "aria-label": "Playlist", onchange: (e) => { r.playlistId = e.target.value; roundCtx.summary(); } },
          h("option", { value: "", text: lists.length ? "Choisir une playlist…" : "Aucune playlist : créez-en une dans Blind test" }),
          ...lists.map(([pid, p]) => h("option", { value: pid, selected: r.playlistId === pid, text: `${p.title} (${playableTracks(p).length} morceaux, extraits de ${p.duration ?? BLIND_SEC} s)` }))))
    : r.type === "mimes"
    ? h("div", { class: "grow picto-round" },
      h("select", {
        class: "grow", "aria-label": "Paquet de mimes",
        // Changer de paquet repart d'un tirage au lancement : les cartes choisies venaient de l'autre.
        onchange: (e) => { const v = e.target.value; r.random = v === "hasard"; r.deckId = v === "hasard" ? null : v; r.cards = null; roundCtx.refresh(); },
      },
      h("option", { value: "", text: "Choisir les cartes…" }),
      h("option", { value: "hasard", selected: !r.deckId && (r.random === true || mimeCards(r.cards).length > 0), text: "🎲 Toutes les collections (au hasard selon l'âge, ou choisies ci-dessous)" }),
      ...decks.map(([did, d]) => h("option", { value: did, selected: r.deckId === did, text: `Toutes les cartes de « ${d.title} » (${(d.cards ?? []).length})` }))),
      h("select", { class: "count mime-per-team", "aria-label": "Cartes par équipe", onchange: (e) => { r.perTeam = Number(e.target.value) || null; roundCtx.refresh(); } },
        h("option", { value: "", text: "Cartes par équipe : la liste telle quelle" }),
        ...MIME_PER_TEAM.map((n) => h("option", { value: n, selected: r.perTeam === n, text: `${n} cartes par équipe` }))),
      h("select", { class: "count", "aria-label": "Durée du tour", onchange: (e) => { r.duration = Number(e.target.value) || null; roundCtx.summary(); } },
        h("option", { value: "", text: `Tour : ${r.deckId && mimes[r.deckId]?.duration ? mimes[r.deckId].duration : MIME_TURN} s` }),
        ...[30, 45, 60, 90, 120].map((n) => h("option", { value: n, selected: r.duration === n, text: `Tour de ${n} s par équipe` }))),
      photoSwitch(r),
      mimeNeedLine(r),
      r.deckId || r.random === true || mimeCards(r.cards).length ? mimeSelection(r) : null)
    : quiz ? null
    : photos
    // Zoom mystère, Image floue : un quiz entier, ou des photos choisies une par une dans tous les quiz.
    ? h("div", { class: "grow picto-round" },
      modeSwitch(r, roundPicks(r).length > 0 || r.byItem === true, "Les photos d'un quiz", "Des photos au choix", (on) => {
        r.byItem = on;
        if (on) { r.picks = roundQuizIds(r).flatMap((id) => (quizzes[id] ? zoomQuestions(quizzes[id]) : []).map((q) => q.imageId)).slice(0, MAX_PICKS); r.quizId = ""; r.quizIds = null; } else r.picks = null;
      }),
      roundPicks(r).length || r.byItem ? itemSelection(r, "picks") : quizSelection(r, options))
    : quiz ? null : quizSelection(r, options);
  // Mimes dans une prestation (cedric, 23/10) : le 🎲 seul, une présélection par équipe.
  if (r.type === "mimes" && commeEnPrestation()) return mancheMimes(r);
  // Pictionary dans une prestation (cedric, 24/10) : le 🎲, un passage à la main, une ligne par équipe.
  if (r.type === "pictionary" && commeEnPrestation()) return mancheDessins(r);
  // Blind test dans une prestation (cedric, 24/10) : « à la manière des quiz », le 🎲 tire les chansons.
  // Blind test et Quiz musical (cedric, 24/10) : en séries de chansons de la bibliothèque des sons.
  if ((r.type === "blind" || r.type === "musical") && commeEnPrestation()) return mancheBlind(r);
  // Chante le mot ! dans une prestation (cedric, 24/10) : le 🎲, un mot écrit à la main, le « complet ».
  if (estJeuDeMots(r.type) && commeEnPrestation()) return mancheMots(r);
  return [
    // Quiz, Quiz illustré (cedric, 23/10) : une seule manche faite de séries (🎲, quiz rappelés, questions écrites, reprises).
    ...(quiz ? mancheQuiz(r) : [content]),
    // Qui a disparu ? : cartes par tour (4, 6 ou 8 depuis le 27/10), par défaut selon l'âge de la prestation.
    r.type === "disparu"
      ? h("select", { class: "count", "aria-label": "Cartes par tour", onchange: (e) => { r.objects = Number(e.target.value) || null; roundCtx.summary(); } },
        h("option", { value: "", text: "Cartes : selon l'âge" }),
        ...DISPARU_CARTES.map((n) => h("option", { value: n, selected: r.objects === n, text: `${n} cartes par tour` })))
      : null,
    // Jeux tirés d'un quiz : toutes ses questions retenues, ou seulement les premières.
    !BUILTIN_GAMES[r.type] && r.type !== "statues" && r.type !== "pictionary" && r.type !== "coffres" && r.type !== "gonfleur" && r.type !== "patate" && r.type !== "duel" && r.type !== "simon" && r.type !== "chrono" && r.type !== "mimes" && !MUSIC_GAMES[r.type] && !(photos && (roundPicks(r).length || r.byItem))
      && !quiz
      ? h("select", { class: "count", "aria-label": "Nombre de questions", onchange: (e) => { r.count = Number(e.target.value) || null; roundCtx.summary(); } },
        h("option", { value: "", text: "Toutes les questions" }),
        ...[1, 2, 3, 4, 5, 6, 8, 10, 12, 15].map((n) => h("option", { value: n, selected: r.count === n, text: n === 1 ? "La première seulement" : `Les ${n} premières` })))
      : null,
    hasFinale(r.type) && !quiz
      ? h("select", { class: "finale", "aria-label": "Super Finale", onchange: (e) => { r.finale = Number(e.target.value) || null; roundCtx.summary(); } },
        h("option", { value: "", text: "Sans Super Finale" }),
        ...[1, 2, 3, 4, 5].map((n) => h("option", { value: n, selected: r.finale === n, text: n === 1 ? "Super Finale : la dernière" : `Super Finale : ${n} dernières` })))
      : null,
    // Note de la manche (cedric, 23/10) : pour s'en souvenir, et la retrouver avec « Reprendre une manche ». Pas dans
    // le Quiz (cedric, 23/10 : « n'a pas lieu d'être »).
    SANS_CONTENU.includes(r.type) || quiz ? null : noteManche(r),
  ];
}

/** Note de la manche (cedric, 23/10) : pour s'en souvenir, et la retrouver avec « Reprendre une manche ». */
const noteManche = (r) => h("label", { class: "manche-note" }, "Note",
  h("input", { type: "text", maxlength: "200", value: r.note ?? "", placeholder: "Pour la retrouver : thème, âge, remarque…", "aria-label": "Note de la manche", oninput: (e) => { r.note = e.target.value; } }));

/** Deux façons de remplir une manche (une source entière, ou des éléments au choix) : deux puces. */
function modeSwitch(r, byItem, whole, items, set) {
  const chip = (on, text) => h("button", {
    type: "button", class: `chip mode-chip${byItem === on ? " active" : ""}`, "aria-pressed": byItem === on ? "true" : "false", text,
    onclick: () => { if (byItem !== on) { set(on); roundCtx.refresh(); } },
  });
  return h("div", { class: "chips mode-switch" }, chip(false, whole), chip(true, items));
}

/**
 * Mimes, Qui a disparu ? : cartes en émojis, ou en photos (chaque carte dont le mot est dans la banque de photos
 * montre sa photo ; les autres gardent leur émoji).
 */
function photoSwitch(r) {
  // Pas encore de vraies photos sur le site : rien à choisir.
  if (!PHOTOS_BANQUE.size && r.photos !== true) return null;
  const on = r.photos === true;
  return h("div", { class: "photo-switch" },
    modeSwitch(r, on, "😀 Émojis", "📷 Photos", (photos) => {
      r.photos = photos || null;
      // Retour aux émojis : les familles en photos choisies sont retirées de Qui a disparu ?.
      if (!photos && r.type === "disparu" && roundPicks(r).length) {
        const enPhotos = new Set(activeItems("disparu", contents.disparu).filter(isPhotoTheme).map((x) => CONTENT_GAMES.disparu.key(x)));
        const keep = roundPicks(r).filter((k) => !enPhotos.has(k));
        r.picks = keep.length ? keep : null;
      }
    }),
    on ? h("span", { class: "small hint", text: r.type === "disparu"
      ? "Les familles « Photos » montrent de vraies photos ; dans les autres, chaque objet de la banque de photos a sa photo."
      : "Chaque carte dont le mot est dans la banque de photos (📷) montre sa photo ; les autres gardent leur émoji." }) : null);
}

/** Photos (Zoom, Image floue) ou titres (blind test, quiz musical) choisis un par un dans toutes les collections. */
function itemSelection(r, field) {
  const items = () => collectionItems(r.type, { quizzes, playlists });
  const unit = COLLECTION_UNIT[r.type][0];
  const photos = r.type === "zoom" || r.type === "flou";
  let memo = null;
  const valueOf = (k) => {
    if (!memo || memo.src !== quizzes) memo = { src: quizzes, map: new Map(items().map((x) => [x.key, x.value])) };
    return memo.map.get(k) ?? {};
  };
  return selectionEditor({
    unit,
    round: photos ? r : null,
    conceptsOf: (k) => itemConcepts(r.type, valueOf(k)),
    empty: `Aucun ${unit} choisi : cochez-en, ou « Tirer au hasard ».`,
    items: () => items().map((x) => ({ key: x.key, label: x.label, group: x.group })),
    get: () => (field === "tracks" ? roundTracks(r) : roundPicks(r)),
    set: (keys) => { r[field] = keys; },
    // Au hasard : les photos de la banque seulement, jamais celles des quiz (téléversées).
    draw: () => drawItems(collectionItems(r.type, { quizzes, playlists }, { hasard: true }), RANDOM_COUNT[r.type] ?? 6, { type: r.type, avoidConcepts: photos ? roundCtx.elsewhere?.(r) : null }).items.map((x) => x.key),
  });
}

/** Mimes : combien de cartes prévoir pour les équipes de la prestation, et combien sont choisies. */
function mimeNeedLine(r) {
  const need = mimeCardsNeeded(r, ctxTeams());
  if (!need) return null;
  const chosen = mimeCards(r.cards).length;
  const teams = ctxTeams() ?? 4;
  return h("span", { class: `small mime-need${chosen && chosen < need ? " warn" : ""}`, text: `${r.perTeam} par équipe × ${teams} équipe${teams > 1 ? "s" : ""}${ctxTeams() ? "" : " (nombre non indiqué)"} = ${need} cartes${chosen ? ` · ${chosen} choisies` : ""}${chosen && chosen < need ? " : le reste est tiré au hasard au lancement" : ""} · réserve pour 2 équipes de plus` });
}

function refreshSummary() {
  const s = formShow();
  const { snapshot, problems } = buildSnapshot(editing?.id ?? "nouvelle", s, quizzes, mimes, Math.random, playlists, contents, {}, songs);
  const profile = PROFILES[s.profile] ? s.profile : profileForAge(s.age);
  // Durée estimée toute seule d'après les jeux composés (cedric, 23/10) : elle ne se saisit plus.
  const duree = dureeEstimee(snapshot, s);
  $("show-duration").textContent = duree ? `environ ${duree.minutes} min` : "—";
  $("show-summary").textContent = snapshot
    ? `${contentLabel(snapshot)} jouables · environ ${duree.minutes} min · chrono ${defaultDuration(profile)} s par question ${profile === "NEUTRE" ? "(profil Neutre, tous âges)" : `pour les ${PROFILES[profile].label}`}, sauf durée imposée`
    : "";
  $("show-problems").replaceChildren(...problems.map((p) => h("li", { text: p })));
  const r = readiness(s, quizzes, mimes, playlists, contents, undefined, songs);
  $("show-ready").className = `ready-box ${r.level}`;
  // Un jeu encore vide que la TV remplira au hasard (cedric, 24/10) : une alerte, même quand elle est prête.
  const alertes = r.alertes.map((t) => h("li", { class: "ready-alerte", text: `⚠ ${t}` }));
  $("show-ready").replaceChildren(r.level === "prete"
    ? h("div", {}, h("b", { text: "✓ À venir : prête, elle est visible sur la régie." }),
      alertes.length ? [h("p", { class: "ready-alertes-titre", text: "À vérifier avant le jour J :" }), h("ul", {}, ...alertes)] : null)
    : r.level === "archivee"
      ? h("b", { text: "Prestation archivée : elle n'apparaît plus sur la régie." })
      : h("div", {}, h("b", { text: "Reste à faire avant le jour J :" }), h("ul", {}, ...r.todo.map((t) => h("li", { text: t })), ...alertes)));
}
["show-age", "show-profile", "show-child", "show-title", "show-date", "show-status"].forEach((id) => $(id).addEventListener("input", refreshSummary));
// Le nombre d'équipes change ce qu'il faut prévoir pour les mimes : les manches sont redessinées. Il donne aussi
// le nombre de couleurs d'équipe.
$("show-teams").addEventListener("change", () => { renderCouleurs(); refreshRounds(); });

/** Couleurs des équipes de la prestation en cours de saisie, une par équipe prévue (bracelets et bandeaux). */
let couleursSaisies = [];
/** Pastille dont on choisit la couleur (son rang), -1 si aucune. */
let pastilleOuverte = -1;
const nomCouleur = (c) => TEAM_COLOR_NAMES[TEAM_COLORS.indexOf(c)] ?? c;
const pastille = (c, props, ...kids) => h("button", { type: "button", style: `--c: ${c}`, ...props },
  h("span", { class: "rond" }), h("span", { class: "nom", text: nomCouleur(c) }), ...kids);

/**
 * Couleurs des équipes (cedric, 22/10) : une pastille par équipe prévue, rose, orange, vert, jaune… par défaut. Une
 * pastille touchée montre les 8 couleurs ; une couleur déjà donnée à une autre équipe s'échange avec elle (jamais deux
 * équipes de la même couleur). Les tablettes ne proposent que ces couleurs.
 */
function renderCouleurs() {
  const n = teamCount($("show-teams").value === "" ? null : Number($("show-teams").value));
  couleursSaisies = couleursEquipes({ teams: n, teamColors: couleursSaisies });
  if (pastilleOuverte >= n) pastilleOuverte = -1;
  const i = pastilleOuverte;
  remplir($("show-couleurs"),
    h("div", { class: "pastilles" }, couleursSaisies.map((c, k) => pastille(c, {
      class: `pastille${k === i ? " ouverte" : ""}`, "aria-label": `Équipe ${k + 1} : ${nomCouleur(c)}`, "aria-expanded": String(k === i),
      onclick: () => { pastilleOuverte = k === i ? -1 : k; renderCouleurs(); },
    }, h("span", { class: "rang", text: `Équipe ${k + 1}` })))),
    i >= 0 && h("div", { class: "choix-couleurs", role: "group", "aria-label": `Couleur de l'équipe ${i + 1}` },
      TEAM_COLORS.map((c) => pastille(c, {
        class: `pastille${c === couleursSaisies[i] ? " choisie" : ""}`, "aria-label": nomCouleur(c),
        onclick: () => choisirCouleur(i, c),
      }))),
  );
}

function choisirCouleur(i, c) {
  const j = couleursSaisies.indexOf(c);
  // Déjà donnée à une autre équipe : les deux équipes échangent leurs couleurs.
  if (j >= 0 && j !== i) couleursSaisies[j] = couleursSaisies[i];
  couleursSaisies[i] = c;
  pastilleOuverte = -1;
  renderCouleurs();
  // Les mimes ont une manche par couleur d'équipe : leurs titres suivent.
  if (editing?.rounds?.some((r) => r?.type === "mimes")) refreshRounds();
}
$("round-add").onclick = () => ouvrirChoixJeu("bas");
$("round-add-top").onclick = () => ouvrirChoixJeu("haut");

/** Contenu d'une manche (titre du quiz, du paquet, de la playlist), "" pour un jeu sans contenu, null s'il n'existe plus. */
function roundContent(r) {
  if (!r?.type && !r?.quizId) return null;
  if (BUILTIN_GAMES[r.type] || r.type === "statues" || r.type === "pictionary" || r.type === "coffres" || r.type === "portes" || r.type === "gonfleur" || r.type === "patate" || r.type === "duel" || r.type === "simon" || r.type === "chrono") return "";
  if (r.type === "mimes") return mimeEquipes(r).some((l) => l.length) ? mancheSummary(r, { mimes }) : r.deckId ? mimes[r.deckId]?.title ?? null : "cartes au hasard";
  if (MUSIC_GAMES[r.type]) return playlists[r.playlistId]?.title ?? null;
  if (roundTirees(r).length || roundSeriesQuiz(r).length) return mancheSummary(r, { quizzes });
  const titles = roundQuizIds(r).map((id) => quizzes[id]?.title);
  return titles.length && titles.every(Boolean) ? titles.join(" + ") : null;
}
/**
 * Chaque manche composée dans la prestation est gardée dans la page de son jeu (cedric, 21/10), pour la réutiliser :
 * créée au premier enregistrement, rattachée à la prestation, mise à jour ensuite. Une manche reprise telle quelle ne
 * crée rien ; reprise puis changée, elle devient une nouvelle manche de cette prestation (l'originale ne bouge pas).
 * Les jeux sans contenu ne sont pas gardés. Rend le nombre de manches écrites.
 */
async function garderManches(showId, s) {
  const pareil = (a, b) => JSON.stringify(cleanRound({ ...a, mancheId: null, title: null }, playlists)) === JSON.stringify(cleanRound({ ...b, mancheId: null, title: null }, playlists));
  const parJeu = new Map();
  let n = 0;
  for (const r of editing.rounds) {
    const type = r.type ?? "quiz";
    if (!roundFilled(r) || SANS_CONTENU.includes(type)) continue;
    parJeu.set(type, (parJeu.get(type) ?? 0) + 1);
    const m = r.mancheId ? manches[r.mancheId] : null;
    if (m && pareil(m.round, r)) continue;
    // Déjà gardée pour cette prestation (« Garder comme manche » de l'historique) : le lien suffit.
    const meme = Object.entries(manches).find(([, x]) => x?.showId === showId && x.round && pareil(x.round, r));
    if (meme) { r.mancheId = meme[0]; n++; continue; }
    if (m && m.showId === showId) {
      if (await saveManche(r.mancheId, { ...m, round: r })) n++;
      continue;
    }
    const titre = `${ROUND_TYPES[type]}${parJeu.get(type) > 1 ? ` ${parJeu.get(type)}` : ""} · ${showTitle(s)}`;
    const id = await saveManche(null, { type, title: titre, round: r, showId });
    if (id) { r.mancheId = id; delete r.title; n++; }
  }
  return n;
}

$("show-form").onsubmit = (e) => {
  e.preventDefault();
  enregistrerPrestation();
};

/** Enregistre la prestation ouverte ; rend vrai une fois enregistrée (même gardée « À compléter »). */
async function enregistrerPrestation() {
  await cadrageEnCours;
  const s = formShow();
  // « À compléter » s'enregistre même incomplète (cedric, 21/10). « À venir » = prête pour la régie : s'il manque
  // quelque chose (prénom, âge, date, jeu prêt), elle est gardée « À compléter » et le message dit quoi.
  // Une date passée le dit aussi (sans cela, elle filerait directement dans les archivées).
  const manque = s.status === "publiee" ? readiness({ ...s, keepActive: true }, quizzes, mimes, playlists, contents, undefined, songs).todo : [];
  // Gardée « À compléter » : l'enregistrement dit aussi ce qui cloche dans les jeux (cedric, 24/10 : une chanson oubliée
  // dans le blind test, une case restée sur le 🎲…).
  const aRevoir = s.status === "brouillon" ? buildSnapshot("x", s, quizzes, mimes, Math.random, playlists, contents, {}, songs).problems
    .filter((p) => !p.startsWith("Aucune question jouable")) : [];
  if (manque.length) {
    s.status = "brouillon";
    $("show-status").value = "brouillon";
  }
  const id = editing.id ?? push(ref(db, "library/shows")).key;
  const prev = shows[id] ?? {};
  // Sous le bouton du bas, et en grand où qu'on soit dans la page.
  const dire = (texte, ok = false) => { status("show-status-msg", texte, ok); annonce(texte, ok); };
  $("show-save").disabled = true;
  try {
    // Chaque manche composée ici est aussi gardée dans la page de son jeu ; la prestation garde le lien vers elle.
    if (await garderManches(id, s)) s.rounds = editing.rounds.filter(roundFilled).map((r) => cleanRound(r, playlists));
    const enregistree = {
      ...s, origin: prev.origin ?? editing.origin ?? "admin", createdAt: prev.createdAt ?? Date.now(),
      // L'étoile d'une archivée et le « ne plus archiver toute seule » d'une désarchivée ne se perdent pas.
      ...(s.status === "archivee" && prev.pinned ? { pinned: true } : {}),
      // Seulement tant que sa date est passée : reprogrammée, elle s'archive de nouveau le lendemain de la fête.
      ...(s.status !== "archivee" && prev.keepActive && s.date && daysUntil(s.date) < -AUTO_ARCHIVE_DAYS ? { keepActive: true } : {}),
      // Une copie garde le nom de son modèle (« Copie de … ») tant qu'elle n'a ni prénom ni titre.
      ...(prev.copieDe ? { copieDe: prev.copieDe } : {}),
      updatedAt: serverTimestamp(),
    };
    await set(ref(db, `library/shows/${id}`), enregistree);
    editing.id = id;
    refreshRounds();
    // Le statut montré est son état réel : une fête à la date passée reste (ou part) dans les archivées.
    showsEtat = etatPrestation(enregistree);
    const archivee = showsEtat === "archivee";
    $("show-status").value = archivee ? "archivee" : s.status;
    montrerArchivee(archivee);
    histPrestation.enregistre();
    $("show-edit-title").textContent = showTitle({ ...s, copieDe: prev.copieDe });
    $("show-edit-crumb").textContent = LISTES[showsEtat].titre;
    if (manque.length && archivee) dire(`Toujours dans les « Archivées » : pour la remettre « À venir », il manque : ${manque.join(" · ")}.`);
    else if (manque.length) dire(`Enregistrée en « À compléter » : pour passer en « À venir », il manque : ${manque.join(" · ")}.`);
    else if (archivee && s.status !== "archivee") dire("Enregistrée dans les « Archivées » : sa date est passée. Pour la remettre « À venir », choisissez une date à venir.");
    else if (aRevoir.length) dire(`Enregistrée. À revoir avant le jour J : ${aRevoir.join(" · ")}`);
    else dire(s.status === "publiee" ? "Enregistrée « À venir » : elle est visible sur la régie." : "Enregistrée.", true);
    return true;
  } catch (err) {
    console.error(err);
    dire("Enregistrement refusé : vérifiez les champs ou vos droits d'administration.");
    return false;
  } finally {
    $("show-save").disabled = false;
  }
}

// ---------- Bibliothèque de quiz ----------

/** Filtre de la bibliothèque de quiz : null (tous), « photo » (Quiz illustré), « classique » (Quiz) ou « images » (Image floue, Zoom mystère). */
let quizFilter = null;
const QUIZ_KINDS = { photo: "📷 Quiz illustré", classique: "📝 Quiz classique", images: "🖼️ Image floue et Zoom" };
/** Titre des collections de quiz, selon le jeu dont on vient (chacun ne montre que ses quiz). */
const QUIZ_COLLECTIONS = { photo: "Quiz illustrés", classique: "Quiz à réponses écrites", images: "Photos à deviner" };
const QUIZ_FILTERS = {
  photo: (q) => quizKind(q) === "photo",
  // Le Quiz joue tout ce qui n'est pas un quiz illustré (les photos à deviner aussi).
  classique: (q) => quizKind(q) !== "photo",
  images: (q) => quizKind(q) === "images" || QUIZ_GAMES.zoom.questions(q).length > 0,
};

function showQuizzes(filter) {
  quizFilter = filter;
  show("quizzes");
}

/** Image floue et Zoom mystère : les photos de la banque, toujours disponibles, montrées par famille. */
function renderBanqueGalerie() {
  const items = banqueItems();
  const box = $("banque-galerie");
  box.hidden = !items.length;
  box.querySelector("summary").textContent = `📷 ${plural(items.length, "photo de la banque", "photos de la banque")} : toujours disponibles, à choisir dans les manches`;
  const groupes = [...new Set(items.map((x) => x.group))];
  box.querySelector(".galerie").replaceChildren(...groupes.flatMap((g) => [
    h("h3", { class: "content-series", text: g.replace(/^Photos · /, "") }),
    h("div", { class: "vignettes" }, ...items.filter((x) => x.group === g).map((x) => h("figure", {},
      h("img", { src: `banque/${x.key.slice(BANQUE.length)}.jpg`, alt: "", loading: "lazy" }),
      h("figcaption", { text: x.label.replace(/^📷 \S+ /u, "") })))),
  ]));
}

function renderQuizzes() {
  const box = $("quiz-list");
  box.innerHTML = "";
  const all = Object.entries(quizzes).filter(([, q]) => q).sort(([, a], [, b]) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  // Chaque jeu ne montre que ses quiz : classiques pour le Quiz, illustrés pour le Quiz illustré, photos à deviner
  // pour le Zoom mystère et l'Image floue.
  $("quiz-photos-box").hidden = quizFilter !== "images";
  $("banque-open").hidden = quizFilter !== "photo";
  $("quizzes-crumb").textContent = ROUND_TYPES[gameType] ?? "Quiz";
  document.querySelectorAll(".quizzes-link").forEach((b) => { b.textContent = ROUND_TYPES[gameType] ?? "Quiz"; });
  $("quizzes-h1").textContent = QUIZ_COLLECTIONS[quizFilter] ?? "Tous les quiz";
  if (quizFilter === "images") renderBanqueGalerie();
  const list = copieEnTete(quizFilter ? all.filter(([, q]) => QUIZ_FILTERS[quizFilter](q)) : all);
  if (!list.length) box.append(h("p", { class: "hint", text: "Aucun quiz pour l'instant : « Créer un quiz » vous guide pas à pas." }));
  list.forEach(([id, q]) => {
    const total = (q.questions ?? []).filter(Boolean).length;
    const ok = playable(q).length;
    const ages = q.ageMin ? `${q.ageMin}${q.ageMax && q.ageMax !== q.ageMin ? ` à ${q.ageMax}` : ""} ans` : "";
    box.append(h("div", { class: `item${copieRecente(id)}`, "data-quiz": id, "data-kind": quizKind(q) },
      h("span", { class: "pill", text: QUIZ_KINDS[quizKind(q)] }),
      h("b", { text: q.title }),
      h("span", { text: [q.theme, ages, SOURCES[q.source] ?? ""].filter(Boolean).join(" · ") }),
      h("span", { class: ok < total ? "warn" : "", text: `${total} questions · ${ok} validées` }),
      h("div", { class: "row" },
        h("button", { class: "btn secondary", onclick: () => review(id, q), text: "Éditer" }),
        h("button", { class: "btn secondary", onclick: () => rename(`library/quizzes/${id}`, q.title, "du quiz"), text: "Renommer" }),
        h("button", { class: "btn secondary", onclick: () => copierDansBibliotheque("quizzes", q), text: "Dupliquer" }),
        h("button", { class: "btn danger", onclick: () => deleteQuiz(id, q), text: "Supprimer" }))));
  });
}
const SOURCES = { banque: "banque des tout-petits", gemini: "texte collé", tableur: "tableur", json: "fichier", saisie: "saisie", photos: "photos" };

async function deleteQuiz(id, q) {
  const used = Object.values(shows).filter((s) => (s.rounds ?? []).some((r) => roundQuizIds(r).includes(id))).map(showTitle);
  const warning = used.length ? `\n\nAttention, il est utilisé par : ${used.join(", ")}.` : "";
  if (!(await confirmer(`Supprimer le quiz « ${q.title} » ?${warning}`, { ok: "Supprimer", danger: true }))) return;
  await set(ref(db, `library/quizzes/${id}`), null);
}

/** Au plus autant de photos d'un coup (chacune pèse dans la base). */
const MAX_PHOTOS = 40;

/** Quiz de photos : chaque photo choisie est réduite et rangée, puis le quiz s'ouvre à la relecture avant d'être enregistré. */
$("quiz-photos-open").onclick = () => $("quiz-photos").click();
$("quiz-photos").onchange = async () => {
  const files = [...$("quiz-photos").files].filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.name)).slice(0, MAX_PHOTOS);
  $("quiz-photos").value = "";
  if (!files.length) return;
  const questions = photoQuestions(files.map((f) => f.name));
  const kept = [];
  for (const [k, f] of files.entries()) {
    document.querySelectorAll("#quiz-photos-open, .photos-nouvelle").forEach((b) => { b.textContent = `Préparation des photos… (${k + 1}/${files.length})`; });
    try { kept.push({ ...questions[k], imageId: await storeIllustration(f) }); } catch (err) { console.error(err); }
  }
  $("quiz-photos-open").textContent = "📷 Nouveau quiz de photos à deviner";
  document.querySelectorAll(".photos-nouvelle").forEach((b) => { b.textContent = "📷 Nouvelle série de photos"; });
  if (!kept.length) return avertir("Ces photos n'ont pas pu être lues : essayez des JPEG ou des PNG.");
  review(null, { title: "Mes photos", theme: "", source: "photos", kind: "images", questions: kept });
  status("rv-status", `${kept.length} photo${kept.length > 1 ? "s" : ""} prête${kept.length > 1 ? "s" : ""} : vérifiez chaque réponse, puis enregistrez.`, true);
};

// Créer un quiz et la banque des petits : « ← Retour » en haut et en bas, comme les pages d'édition.
barresRetour($("screen-import"), pagePrecedente);
barresRetour($("screen-banque"), pagePrecedente);
// Pages des jeux, de leurs collections, des listes de prestations, Bibliothèque et Paramètres : « ← Retour » en haut et
// en bas aussi (cedric, 21/10).
["screen-game", "screen-quizzes", "screen-mimes", "screen-music", "screen-shows", "screen-library", "screen-settings"]
  .forEach((id) => barresRetour($(id), pagePrecedente));
// Bibliothèque › Questions (cedric, 25/10) : un gros bouton pour importer un pack, à gauche de « ← Retour », toujours là.
$("screen-library").querySelector(":scope > .retour-barre.haut")?.prepend(h("button", {
  type: "button", id: "q-importer-haut", class: "btn importer-haut", text: "📦 Importer un pack ZIP", hidden: true,
  title: "Choisir le ZIP d'un pack (ou de plusieurs packs) et l'importer",
  onclick: () => { qGroupe = "packs"; qPack = null; qSelection.clear(); renderQuestions(); $("pack-file").click(); },
}));

$("quiz-import-open").onclick = () => {
  $("import-text").value = "";
  $("import-file").value = "";
  importImages.clear();
  $("import-images").textContent = "";
  status("import-status", "");
  // Depuis le Quiz ou le Quiz illustré, le type est déjà choisi : on passe directement à la façon de le créer.
  const kind = { quiz: "classique", express: "classique", illustre: "photo" }[gameType] ?? null;
  $("kind-panel").hidden = !!kind;
  $("import-h1").textContent = kind === "photo" ? "Créer un quiz illustré" : kind ? "Créer un quiz classique" : "Créer un quiz";
  chooseKind(kind);
  updatePrompt();
  show("import");
};

/**
 * Créer un quiz : d'abord le type (quiz illustré des petits ou quiz classique), puis la façon de le créer.
 * Les deux types s'importent aussi en fichier JSON, avec leurs photos.
 */
let creationKind = null;
const CREATION_WAYS = {
  photo: [
    ["banque", "🎲 Piocher dans la banque", "Des questions prêtes, avec leurs photos : un thème, un nombre, puis vous relisez."],
    ["main", "✍️ À la main", "Vous tapez chaque question et ses 4 mots, et déposez une photo pour chaque réponse."],
    ["json", "📄 Importer un fichier JSON", "Le fichier du quiz et ses photos, déposés ensemble."],
  ],
  classique: [
    ["main", "✍️ À la main", "Vous tapez vos questions et vos réponses, et ajoutez les petites photos de révélation."],
    ["chatgpt", "💬 Avec ChatGPT", "La demande est écrite pour vous ; vous collez sa réponse."],
    ["json", "📄 Importer un fichier JSON", "Le fichier du quiz et ses images, déposés ensemble."],
  ],
};

function chooseKind(kind) {
  creationKind = kind;
  document.querySelectorAll("#screen-import .kind-card").forEach((b) => b.classList.toggle("active", b.dataset.kind === kind));
  $("kind-ways").hidden = !kind;
  $("import-gem").hidden = true;
  $("import-paste").hidden = true;
  $("kind-ways-list").replaceChildren(...(CREATION_WAYS[kind] ?? []).map(([way, label, detail]) => h("button", {
    type: "button", class: "kind-way", "data-way": way, onclick: () => chooseWay(way),
  }, h("b", { text: label }), h("span", { text: detail }))));
}
document.querySelectorAll("#screen-import .kind-card").forEach((b) => { b.onclick = () => chooseKind(b.dataset.kind); });

function chooseWay(way) {
  document.querySelectorAll("#kind-ways-list .kind-way").forEach((b) => b.classList.toggle("active", b.dataset.way === way));
  $("import-gem").hidden = way !== "chatgpt";
  $("import-paste").hidden = way !== "chatgpt" && way !== "json";
  if (way === "chatgpt") {
    $("import-paste-label").textContent = "Coller la réponse";
    $("import-paste-hint").textContent = "Collez la réponse de ChatGPT. Vous pouvez aussi coller des lignes d'un tableur (colonnes : Question, Réponse A, Réponse B, Réponse C, Réponse D, Bonne réponse, Durée).";
    updatePrompt();
  }
  if (way === "json") {
    $("import-paste-label").textContent = "Déposer le fichier";
    $("import-paste-hint").textContent = creationKind === "photo"
      ? "Déposez le fichier JSON du quiz et toutes ses photos ensemble : chaque photo est associée à la réponse qui porte son nom."
      : "Déposez le fichier JSON (ou CSV) du quiz et ses images ensemble : chaque image est associée à la question qui porte son nom.";
    $("import-paste").scrollIntoView({ block: "nearest" });
  }
  if (way === "main") {
    review(null, { title: creationKind === "photo" ? "Nouveau quiz illustré" : "Nouveau quiz", theme: "", ageMin: null, ageMax: null, source: "saisie", kind: creationKind, questions: [] });
    $("rv-add").click();
  }
  if (way === "banque") openBanque();
}

/** Réponses du quiz demandé : « images » pour un quiz illustré (des mots simples), sinon « texte ». */
const answersMode = () => (creationKind === "photo" ? "images" : "texte");

function updatePrompt() {
  $("gem-prompt").value = geminiPrompt({
    theme: $("gem-theme").value, age: $("gem-age").value, count: Number($("gem-count").value) || 8,
    difficulty: $("gem-difficulty").value, answers: answersMode(),
  });
}
["gem-theme", "gem-age", "gem-count"].forEach((id) => $(id).addEventListener("input", updatePrompt));
$("gem-difficulty").addEventListener("change", updatePrompt);

/** Copie la demande ; sans accès au presse-papiers, elle est sélectionnée pour un Ctrl+C. */
async function copyPrompt() {
  updatePrompt();
  try {
    await navigator.clipboard.writeText($("gem-prompt").value);
    return true;
  } catch {
    $("gem-prompt").closest("details").open = true;
    $("gem-prompt").select();
    return false;
  }
}
$("gem-copy").onclick = async () => {
  $("gem-copy").textContent = (await copyPrompt()) ? "Demande copiée" : "Sélectionnée : faites Ctrl+C";
  setTimeout(() => { $("gem-copy").textContent = "Copier la demande"; }, 2500);
};
// ChatGPT s'ouvre dans un nouvel onglet avec la demande déjà écrite (et copiée, au cas où).
$("gem-open").onclick = async () => {
  updatePrompt();
  const tab = window.open(chatgptUrl($("gem-prompt").value), "_blank");
  if (tab) tab.opener = null;
  await copyPrompt();
  status("import-status", tab === null ? "Le navigateur a bloqué l'ouverture : ouvrez ChatGPT vous-même et collez la demande (Ctrl+V)." : "", true);
};
/** Images déposées avec le quiz (nom comparable → fichier), associées aux réponses par leur nom à l'analyse. */
const importImages = new Map();

/** Fichiers choisis ou déposés : le texte (JSON, CSV…) va dans la zone de texte, les images sont gardées de côté. */
async function takeImportFiles(files) {
  let texts = 0;
  for (const f of files) {
    if (f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.name)) importImages.set(imageKey(f.name), f);
    else if (!texts++) $("import-text").value = await f.text();
  }
  const n = importImages.size;
  $("import-images").textContent = n ? `${n} image${n > 1 ? "s" : ""} prête${n > 1 ? "s" : ""} à associer aux réponses.` : "";
}
$("import-file").onchange = async () => {
  await takeImportFiles([...$("import-file").files]);
  $("import-file").value = "";
};
const dropZone = $("import-drop");
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("over"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("over"));
dropZone.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropZone.classList.remove("over");
  await takeImportFiles([...(e.dataTransfer?.files ?? [])]);
});

/**
 * Associe les images déposées aux réponses qui les nomment : chaque image est réduite et rangée dans la
 * bibliothèque ; une image introuvable est signalée à la relecture, la réponse reste en texte.
 */
async function attachImportImages(questions, images = importImages, statut = "import-status") {
  let done = 0;
  const find = (name) => images.get(imageKey(name)) ?? images.get(imageKey(name).replace(/\.[a-z0-9]+$/, ".png"))
    ?? [...images.entries()].find(([key]) => key.replace(/\.[a-z0-9]+$/, "") === imageKey(name).replace(/\.[a-z0-9]+$/, ""))?.[1];
  for (const q of questions) {
    // Image de révélation : rangée comme une photo d'illustration, montrée sur la TV avec la bonne réponse.
    if (q.revealFile) {
      const f = find(q.revealFile);
      q.missingImages ??= [];
      if (!f) q.missingImages.push(q.revealFile);
      else {
        status(statut, `Préparation des images… (${++done})`, true);
        try { q.imageId = await storeIllustration(f); } catch (err) { console.error(err); q.missingImages.push(q.revealFile); }
      }
      delete q.revealFile;
    }
    if (!q.imageFiles) continue;
    q.choiceImages = [];
    q.missingImages ??= [];
    for (const [k, name] of q.imageFiles.entries()) {
      if (!name) { q.choiceImages[k] = null; continue; }
      const f = find(name);
      if (!f) { q.choiceImages[k] = null; q.missingImages.push(name); continue; }
      status(statut, `Préparation des images… (${++done})`, true);
      try { q.choiceImages[k] = await storeChoiceImage(f); } catch (err) { console.error(err); q.choiceImages[k] = null; q.missingImages.push(name); }
    }
    delete q.imageFiles;
  }
}

$("import-analyse").onclick = async () => {
  const parsed = parseQuiz($("import-text").value);
  if (!parsed.questions.length) return status("import-status", "Aucune question trouvée. Vérifiez le texte collé.");
  if (parsed.questions.some((q) => q.imageFiles || q.revealFile)) {
    $("import-analyse").disabled = true;
    try { await attachImportImages(parsed.questions); } finally { $("import-analyse").disabled = false; }
  }
  const theme = $("gem-theme").value.trim();
  const age = Number($("gem-age").value) || null;
  review(null, {
    title: parsed.title || theme || "Quiz sans titre",
    theme: parsed.theme || theme || "",
    ageMin: parsed.ageMin ?? age, ageMax: parsed.ageMax ?? age,
    source: parsed.format === "texte" ? "gemini" : parsed.format,
    kind: creationKind ?? undefined,
    questions: parsed.questions.map((q) => ({ ...q, status: "brouillon" })),
  });
  if (answersMode() === "images" && !parsed.questions.some((q) => q.imageFiles)) {
    status("rv-status", "Réponses en images : ajoutez une image à chaque réponse avec 📷, puis enregistrez.", true);
  }
};

// ---------- Éditer un quiz ----------

let draft = null; // { id, quiz, questions }

function review(id, quiz) {
  draft = {
    id,
    quiz,
    kind: quizKind(quiz),
    questions: (quiz.questions ?? []).filter(Boolean).map((q) => ({
      text: q.text ?? "", choices: [...(q.choices ?? [])], correct: q.correct ?? -1,
      duration: q.duration ?? null, double: q.double === true, status: q.status ?? "brouillon", marks: q.marks ?? 0,
      image: q.image ?? "", imageId: q.imageId ?? null, kind: q.kind === "number" ? "number" : null, niveau: lireNiveau(q.niveau),
      // Réponses en images : une photo par case A à D (les propositions sont rangées dans l'ordre des cases).
      slotImages: [0, 1, 2, 3].map((k) => (IMAGE_ID.test(q.choiceImages?.[k] ?? "") ? q.choiceImages[k] : null)),
      missingImages: q.missingImages ?? [],
    })),
  };
  $("rv-title").value = quiz.title ?? "";
  $("rv-theme").value = quiz.theme ?? "";
  $("rv-age-min").value = quiz.ageMin ?? "";
  $("rv-age-max").value = quiz.ageMax ?? "";
  // Un pack (ou une série de photos) : sa famille et son niveau, à corriger ici (cedric, 25/10).
  const pack = estPackOuSerie(quiz);
  // Le thème range le pack (cedric, 25/10) ; la famille n'est plus demandée (gardée telle quelle).
  $("rv-famille-champ").hidden = true;
  $("rv-niveau-champ").hidden = !pack;
  const options = (sel, valeurs, valeur, libelle) => sel.replaceChildren(h("option", { value: "", text: "— À choisir —" }),
    ...valeurs.map((v) => h("option", { value: v, text: libelle(v) })));
  options($("rv-niveau"), NIVEAUX, null, (v) => `${v} (${AGES_NIVEAU[v][0]} à ${AGES_NIVEAU[v][1]} ans)`);
  $("rv-niveau").value = niveauDuQuiz(quiz) ?? "";
  // Quiz illustré : questions de la banque et photo par réponse ; quiz classique : Vrai / Faux et Juste Chiffre.
  $("rv-kind").textContent = QUIZ_KINDS[draft.kind];
  $("rv-banque").hidden = draft.kind !== "photo";
  $("rv-banque-panel").hidden = true;
  $("rv-add-tf").hidden = draft.kind === "photo";
  $("rv-chiffres").hidden = draft.kind === "photo";
  $("rv-chiffres-panel").hidden = true;
  chiffresCoches.clear();
  chiffresRecherche = "";
  chiffresType = null;
  status("rv-status", "");
  show("review");
  renderReview();
  // Un nouveau quiz (importé, photos, banque) n'est pas encore enregistré : le quitter demande d'abord.
  histRelecture.depart({ nouveau: !id });
}

const REVIEW_FIELDS = ["rv-title", "rv-theme", "rv-age-min", "rv-age-max"];
const histRelecture = historique({
  ecran: $("screen-review"),
  precedent: pagePrecedente,
  capturer: () => ({ questions: draft?.questions ?? [], champs: REVIEW_FIELDS.map((id) => $(id).value) }),
  restaurer: (e) => {
    REVIEW_FIELDS.forEach((id, k) => { $(id).value = e.champs[k]; });
    if (draft) draft.questions = e.questions;
    renderReview();
  },
});

function profileOfDraft() {
  const age = Number($("rv-age-min").value);
  return age ? profileForAge(age) : null;
}

function existingTexts() {
  return Object.entries(quizzes).filter(([id]) => id !== draft.id).flatMap(([, q]) => (q.questions ?? []).filter(Boolean).map((x) => x.text));
}

function renderReview() {
  const box = $("rv-list");
  box.innerHTML = "";
  draft.questions.forEach((q, i) => {
    const slots = [0, 1, 2, 3].map((k) => q.choices[k] ?? "");
    const card = h("div", { class: "qcard", "data-q": i },
      h("div", { class: "qhead" },
        h("b", { text: `Question ${i + 1}` }),
        h("button", { type: "button", class: "icon", title: "Monter", text: "↑", disabled: i === 0, onclick: () => { moveQuestion(i, -1); } }),
        h("button", { type: "button", class: "icon", title: "Descendre", text: "↓", disabled: i === draft.questions.length - 1, onclick: () => { moveQuestion(i, 1); } }),
        h("button", { type: "button", class: "icon", title: "Supprimer la question", text: "✕", onclick: () => { draft.questions.splice(i, 1); renderReview(); } })),
      h("textarea", { class: "q-text", rows: 2, value: q.text, oninput: (e) => { q.text = e.target.value.trim(); q.marks = 0; recheck(); } }),
      draft.kind === "photo" && q.kind !== "number" ? null : h("label", { class: "check q-number-toggle" },
        h("input", {
          type: "checkbox", class: "q-is-number", checked: q.kind === "number",
          onchange: (e) => {
            q.kind = e.target.checked ? "number" : null;
            q.correct = e.target.checked ? (Number.isInteger(Number(q.number)) && q.number !== "" ? Number(q.number) : NaN) : -1;
            q.marks = 0;
            renderReview();
          },
        }),
        "Le Juste Chiffre : réponse en nombre (l'équipe la plus proche gagne)"),
      q.kind === "number" ? h("label", { class: "inline q-number-row" }, "Nombre à trouver",
        h("input", {
          type: "number", step: 1, class: "q-number", value: Number.isInteger(q.correct) ? q.correct : "",
          oninput: (e) => { q.number = e.target.value; q.correct = e.target.value === "" ? NaN : Number(e.target.value); recheck(); },
        })) : null,
      q.kind === "number" ? null : h("div", { class: "choices" }, ...slots.map((c, k) => h("label", { class: "choice" },
        h("input", { type: "radio", name: `correct-${i}`, checked: q.correct === k, onchange: () => { q.correct = k; q.marks = 0; syncChoices(q, slots); } }),
        h("span", { class: "letter", text: LETTERS[k] }),
        h("input", { class: "q-choice", value: c, placeholder: k < 2 ? "Proposition" : "Facultatif", oninput: (e) => { slots[k] = e.target.value; syncChoices(q, slots); } }),
        choicePhoto(q, slots, k)))),
      h("div", { class: "row" },
        h("label", { class: "inline" }, "Durée (s)", h("input", { type: "number", min: 5, max: 120, class: "q-duration", value: q.duration ?? "", placeholder: "auto", oninput: (e) => { q.duration = e.target.value === "" ? null : Number(e.target.value); recheck(); } })),
        h("label", { class: "check" }, h("input", { type: "checkbox", checked: q.double, onchange: (e) => { q.double = e.target.checked; } }), "Points ×2")),
      illustrationRow(q, i),
      h("ul", { class: "problems" }));
    box.append(card);
  });
  recheck();
}

const IMAGE_ID = /^[0-9a-f]{16}$/;

/** Photos d'illustration déjà lues (identifiant → image), pour l'aperçu. */
const imageCache = {};

/**
 * Illustration facultative, montrée sur la TV quand la réponse est révélée : un émoji, ou une photo
 * choisie sur le PC (réduite avant l'envoi). Sans illustration, la question se joue comme avant.
 */
function illustrationRow(q, i) {
  // Bulle de la révélation, comme sur la TV (4:3, image qui la remplit) : un clic ouvre le cadrage.
  const preview = h("img", {
    class: "q-image bulle revelation", alt: "Photo de la question", hidden: !q.imageId, title: "Cliquer pour cadrer l'image comme sur la TV",
    onclick: () => cadrer(q.imageFile ?? imageCache[q.imageId], "revelation", async (blob) => {
      q.imageId = await storeIllustration(blob);
      showPreview();
      info.textContent = "Cadrage enregistré. Pensez à enregistrer le quiz.";
    }),
  });
  // Repère de préparation, jamais bloquant : sans illustration, la révélation montre seulement la réponse. Seulement
  // quand l'image est attendue (cedric, 25/10) : pas au Juste Chiffre, au Vrai ou Faux, ni au Quiz illustré (facultative).
  const missing = h("span", { class: "tag missing", text: IMAGE_MANQUANTE });
  const facultative = () => q.kind === "number" || (draft.kind === "photo" && enImages(q)) || (q.choices?.length === 2 && q.choices.join("/").toLowerCase() === "vrai/faux");
  const refreshMissing = () => { missing.hidden = !!(q.imageId || q.image) || facultative(); };
  const showPreview = () => {
    refreshMissing();
    preview.hidden = !q.imageId;
    if (!q.imageId) return;
    if (imageCache[q.imageId]) { preview.src = imageCache[q.imageId]; return; }
    const id = q.imageId;
    get(ref(db, `library/images/${id}`)).then((snap) => {
      if (typeof snap.val() === "string") { imageCache[id] = snap.val(); if (q.imageId === id) preview.src = snap.val(); }
    }).catch(() => {});
  };
  const info = h("span", { class: "hint q-image-info" });
  const remove = h("button", {
    type: "button", class: "link", text: "Retirer la photo", hidden: !q.imageId,
    onclick: () => { q.imageId = null; remove.hidden = true; showPreview(); info.textContent = ""; },
  });
  const file = h("input", {
    type: "file", accept: "image/*", class: "q-photo", hidden: true,
    onchange: async (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      info.textContent = "Préparation de la photo…";
      try {
        const id = await storeIllustration(f);
        const data = imageCache[id];
        q.imageId = id;
        // Le fichier d'origine sert au cadrage (meilleure qualité que la photo réduite).
        q.imageFile = f;
        noterEcran();
        remove.hidden = false;
        showPreview();
        info.textContent = `Photo prête (${Math.round(data.length / 1365)} Ko) : cliquez dessus pour la cadrer. Pensez à enregistrer le quiz.`;
      } catch (err) {
        console.error(err);
        info.textContent = "Photo refusée : essayez une autre image (JPEG ou PNG).";
      }
    },
  });
  showPreview();
  refreshMissing();
  const row = h("div", { class: "row illustration", "data-illustration": i },
    missing,
    h("label", { class: "inline" }, "Illustration",
      h("input", {
        class: "q-emoji", value: q.image ?? "", maxlength: 16, placeholder: "🦁 émoji",
        oninput: (e) => { q.image = cleanEmoji(e.target.value); refreshMissing(); },
      })),
    h("button", { type: "button", class: "btn small secondary", text: "📷 Photo…", onclick: () => file.click() }),
    h("button", {
      type: "button", class: "btn small secondary", text: "🖼️ Bibliothèque…", title: "Choisir un émoji, une photo libre ou une de vos images",
      onclick: async () => {
        const x = await choisirDansBibliotheque({ titre: "Illustration de la question", recherche: nomReponse(q) });
        if (x) await poser(x);
      },
    }),
    // L'image copiée dans la Bibliothèque (« 📋 », cedric 22/10) se pose ici d'un clic.
    imageCopiee ? h("button", {
      type: "button", class: "btn small secondary q-coller", text: `📋 Coller « ${nomCopie(imageCopiee)} »`, title: "L'image copiée dans la Bibliothèque",
      onclick: () => poser(imageCopiee),
    }) : null,
    file, preview, remove, info);
  return row;

  /** Pose une image de la Bibliothèque (choisie ou copiée) : l'émoji dans sa case, une photo comme illustration. */
  async function poser(x) {
    if (x.groupe === "emojis") {
      q.image = cleanEmoji(x.emoji);
      row.querySelector(".q-emoji").value = q.image;
      refreshMissing();
      noterEcran();
      info.textContent = `Émoji ${x.emoji} choisi. Pensez à enregistrer le quiz.`;
      return;
    }
    info.textContent = "Préparation de la photo…";
    try {
      q.imageId = dansLaBase(x) ? x.id : await storeIllustration(await blobDe(x));
      q.imageFile = null;
      noterEcran();
      remove.hidden = false;
      showPreview();
      info.textContent = `« ${x.nom} » choisie dans la bibliothèque : cliquez dessus pour la cadrer. Pensez à enregistrer le quiz.`;
    } catch (err) {
      console.error(err);
      info.textContent = "Image illisible : choisissez-en une autre.";
    }
  }
}

/**
 * Réponse en image (quiz des petits) : « 📷 » choisit une photo sur le PC pour cette case, réduite avant l'envoi.
 * Sur la TV et les tablettes, la photo remplace le texte ; le mot reste dessous, en petit.
 */
/** Question aux réponses en images (au moins une image posée) : au Quiz illustré, chaque réponse attend la sienne. */
const enImages = (q) => (q.slotImages ?? q.choiceImages ?? []).some((id) => IMAGE_ID.test(id ?? ""));

function choicePhoto(q, slots, k) {
  // Vignette comme sur la TV (carré arrondi, image qui le remplit) : un clic ouvre le cadrage.
  const thumb = h("img", {
    class: "choice-thumb bulle vignette", alt: `Image de la réponse ${LETTERS[k]}`, hidden: true, title: "Cliquer pour cadrer l'image comme sur la TV",
    onclick: (e) => {
      e.preventDefault();
      cadrer(q.slotFiles?.[k] ?? imageCache[q.slotImages?.[k]], "vignette", async (blob) => {
        q.slotImages[k] = await storeChoiceImage(blob);
        show_();
        syncChoices(q, slots);
      });
    },
  });
  // Quiz illustré : chaque réponse attend son image ; sans elle, la petite alerte (cedric, 25/10), rien d'autre.
  const manque = h("span", { class: "tag missing case-manquante", text: IMAGE_MANQUANTE, hidden: true });
  const show_ = () => {
    const id = q.slotImages?.[k];
    thumb.hidden = !id;
    remove.hidden = !id;
    manque.hidden = !!id || draft.kind !== "photo" || !enImages(q) || !`${slots[k] ?? ""}`.trim();
    if (!id) return;
    if (imageCache[id]) { thumb.src = imageCache[id]; return; }
    get(ref(db, `library/images/${id}`)).then((snap) => {
      if (typeof snap.val() === "string") { imageCache[id] = snap.val(); if (q.slotImages?.[k] === id) thumb.src = snap.val(); }
    }).catch(() => {});
  };
  const remove = h("button", {
    type: "button", class: "icon", title: "Retirer l'image", text: "✕", hidden: true,
    onclick: (e) => { e.preventDefault(); q.slotImages[k] = null; show_(); syncChoices(q, slots); },
  });
  const file = h("input", {
    type: "file", accept: "image/*", hidden: true,
    onchange: async (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      try {
        const id = await storeChoiceImage(f);
        q.slotImages[k] = id;
        (q.slotFiles ??= [])[k] = f;
        setTimeout(noterEcran, 0);
        if (!slots[k].trim()) {
          slots[k] = wordFromImage(f.name) || LETTERS[k];
          const input = $("rv-list").querySelector(`[data-q="${draft.questions.indexOf(q)}"]`)?.querySelectorAll(".q-choice")[k];
          if (input) input.value = slots[k];
        }
        show_();
        syncChoices(q, slots);
      } catch (err) {
        console.error(err);
        status("rv-status", "Image refusée : essayez une autre image (JPEG ou PNG).");
      }
    },
  });
  show_();
  return h("span", { class: "choice-photo" }, thumb, remove, manque,
    h("button", { type: "button", class: "icon", title: "Mettre une image à la place du texte", text: "📷", onclick: (e) => { e.preventDefault(); file.click(); } }),
    h("button", {
      type: "button", class: "icon", title: "Choisir l'image dans la bibliothèque (photos libres, vos images, images des packs, pochettes)", text: "🖼️",
      onclick: async (e) => {
        e.preventDefault();
        const x = await choisirDansBibliotheque({ titre: `Image de la réponse ${LETTERS[k]}`, groupes: ["packs", "photos", "miennes", "pochettes"], recherche: slots[k].replace(/^[^\p{L}\p{N}]+/u, "").trim() });
        if (x) await poserReponse(x);
      },
    }),
    // La photo copiée dans la Bibliothèque (« 📋 ») ; pas un émoji : une réponse en image est une photo.
    imageCopiee && imageCopiee.groupe !== "emojis" ? h("button", {
      type: "button", class: "icon q-coller", title: `Coller « ${nomCopie(imageCopiee)} » (copiée dans la Bibliothèque)`, text: "📋",
      onclick: (e) => { e.preventDefault(); poserReponse(imageCopiee); },
    }) : null,
    file);
  /** Pose une photo de la Bibliothèque (choisie ou copiée) comme image de la réponse ; son nom si la case est vide. */
  async function poserReponse(x) {
    try {
      (q.slotImages ??= [])[k] = dansLaBase(x) ? x.id : await storeChoiceImage(await blobDe(x));
      if (q.slotFiles) q.slotFiles[k] = null;
      setTimeout(noterEcran, 0);
      if (!slots[k].trim()) {
        slots[k] = x.nom;
        const input = $("rv-list").querySelector(`[data-q="${draft.questions.indexOf(q)}"]`)?.querySelectorAll(".q-choice")[k];
        if (input) input.value = slots[k];
      }
      show_();
      syncChoices(q, slots);
    } catch (err) {
      console.error(err);
      status("rv-status", "Image illisible : choisissez-en une autre.");
    }
  }
}

/**
 * Cadrage d'une image (fichier d'origine ou image déjà rangée) dans sa bulle : [garder] reçoit l'image recadrée.
 * Annuler ne change rien ; un échec est dit dans la barre d'état, jamais bloquant.
 */
/** Le cadrage en cours, jusqu'à l'image rangée : un « Enregistrer » cliqué juste après l'attend (sinon il garderait l'image d'avant). */
let cadrageEnCours = Promise.resolve();

async function cadrer(source, forme, garder) {
  if (!source) return;
  let fini;
  cadrageEnCours = new Promise((r) => (fini = r));
  try {
    const blob = await ouvrirCadrage(source, forme);
    if (!blob) return;
    await garder(blob);
    noterEcran();
  } catch (err) {
    console.error(err);
    status("rv-status", "Cadrage impossible pour cette image : essayez de la choisir à nouveau.");
  } finally {
    fini();
  }
}

/** Réduit une photo d'illustration (révélation) et la range dans la bibliothèque ; renvoie son identifiant. */
async function storeIllustration(fileOrBlob) {
  const data = await compressImage(fileOrBlob);
  const id = await imageId(data);
  const target = ref(db, `library/images/${id}`);
  if (!(await get(target)).exists()) await set(target, data);
  imageCache[id] = data;
  return id;
}

/** Réduit une image de réponse et la range dans la bibliothèque (une seule copie par image) ; renvoie son identifiant. */
async function storeChoiceImage(fileOrBlob) {
  const data = await compressImage(fileOrBlob, CHOICE_IMAGE.budget, CHOICE_IMAGE.width);
  const id = await imageId(data);
  const target = ref(db, `library/images/${id}`);
  if (!(await get(target)).exists()) await set(target, data);
  imageCache[id] = data;
  return id;
}

/** Propositions remplies dans l'ordre ; la bonne réponse et les images suivent leur case. */
function syncChoices(q, slots) {
  const filled = slots.map((c, k) => [c.trim(), k]).filter(([c]) => c);
  const radio = $("rv-list").querySelector(`[data-q="${draft.questions.indexOf(q)}"]`)?.querySelectorAll("input[type=radio]");
  const checkedSlot = radio ? [...radio].findIndex((r) => r.checked) : q.correct;
  q.choices = filled.map(([c]) => c);
  q.correct = filled.findIndex(([, k]) => k === checkedSlot);
  q.choiceImages = filled.map(([, k]) => q.slotImages?.[k] ?? null);
  recheck();
}

function recheck() {
  const checks = checkQuestions(draft.questions, { profile: profileOfDraft(), existing: existingTexts() });
  let blocked = 0, warned = 0;
  draft.questions.forEach((q, i) => {
    const card = $("rv-list").querySelector(`[data-q="${i}"]`);
    if (!card) return;
    const { errors, warnings } = checks[i];
    // Plus de validation à la main (cedric, 26/10) : une question complète se joue, une question à corriger attend.
    q.status = errors.length ? "brouillon" : "validee";
    if (errors.length) blocked++;
    if (warnings.length) warned++;
    card.classList.toggle("error", errors.length > 0);
    card.querySelector(".problems").replaceChildren(
      ...errors.map((t) => h("li", { class: "err", text: t })),
      ...warnings.map((t) => h("li", { class: "warn", text: t })),
    );
  });
  const n = draft.questions.length;
  $("rv-summary").textContent = `${n} question${n > 1 ? "s" : ""}`
    + (blocked ? ` · ${blocked} à corriger` : "") + (warned ? ` · ${warned} à vérifier` : "");
}
["rv-age-min"].forEach((id) => $(id).addEventListener("input", recheck));

$("rv-add").onclick = () => {
  draft.questions.push({ text: "", choices: [], correct: -1, duration: null, double: false, status: "brouillon", marks: 0 });
  renderReview();
  $("rv-list").lastElementChild?.querySelector(".q-text")?.focus();
};
// Vrai / Faux : les deux propositions déjà écrites, il ne reste qu'à taper l'affirmation et cocher la bonne.
$("rv-add-tf").onclick = () => {
  draft.questions.push({ text: "", choices: ["Vrai", "Faux"], correct: -1, duration: null, double: false, status: "brouillon", marks: 0 });
  renderReview();
  $("rv-list").lastElementChild?.querySelector(".q-text")?.focus();
};

// ---------- Banque des tout-petits : questions prêtes, réponses en photos ----------

let banqueFamille = null;
let banqueRecherche = "";
/** Questions cochées : identifiant → question (avec ses 4 réponses, bonne réponse en premier). */
let banqueCoches = new Map();
/** Toutes les questions de la banque ; les mauvaises réponses sont tirées une fois par ouverture de la Régie PC. */
let banqueCatalogue = null;
/** Lignes montrées d'un coup : au-delà, Sarah choisit un thème ou cherche un mot. */
const BANQUE_LIGNES = 300;
/** Image rangée de chaque mot de la banque (mot → identifiant), pour ne la préparer qu'une fois. */
const banqueImages = {};

$("rv-banque").onclick = () => {
  const panel = $("rv-banque-panel");
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderBanque();
};

/** Ouvre un nouveau quiz illustré directement sur la banque (depuis « Créer un quiz »). */
function openBanque() {
  review(null, { title: "Quiz illustré", theme: "", ageMin: null, ageMax: null, source: "banque", kind: "photo", questions: [] });
  $("rv-banque-panel").hidden = false;
  renderBanque();
}

function renderBanque() {
  const panel = $("rv-banque-panel");
  banqueCatalogue ??= cataloguePetits();
  const deja = new Set((draft?.questions ?? []).map((q) => q.text.trim()));
  for (const [id, q] of banqueCoches) if (deja.has(q.text)) banqueCoches.delete(id);
  const cherche = cleMot(banqueRecherche);
  const correspond = (q) => !cherche || cleMot(q.text).includes(cherche) || q.choices.some((c) => cleMot(c).includes(cherche));
  const duTheme = banqueCatalogue.filter((q) => !banqueFamille || q.famille === banqueFamille);
  // Les questions cochées d'abord (même d'un autre thème), puis celles du thème.
  const liste = [...banqueCoches.values(), ...parPertinence(duTheme.filter((q) => !banqueCoches.has(q.id) && correspond(q)), banqueRecherche, (q) => q.choices, (q) => q.text)];
  const montrees = liste.slice(0, BANQUE_LIGNES);
  const chip = (label, famille) => h("button", {
    type: "button", class: `chip${banqueFamille === famille ? " active" : ""}`, text: label,
    onclick: () => { banqueFamille = famille; renderBanque(); },
  });
  const bouton = h("button", { type: "button", id: "rv-banque-add", class: "btn", onclick: () => ajouterBanque() });
  const majBouton = () => {
    const n = banqueCoches.size;
    bouton.disabled = !n;
    bouton.textContent = n ? `Ajouter ${n > 1 ? `les ${n} questions cochées` : "la question cochée"}` : "Cochez des questions";
  };
  majBouton();
  const recherche = h("input", {
    type: "search", id: "rv-banque-cherche", placeholder: "Chercher une question ou un mot (girafe, voler, rouge…)", value: banqueRecherche,
    oninput: (e) => {
      banqueRecherche = e.target.value;
      clearTimeout(recherche.timer);
      recherche.timer = setTimeout(() => { renderBanque(); $("rv-banque-cherche")?.focus(); }, 250);
    },
  });
  panel.replaceChildren(
    h("p", { class: "label", text: "Questions des tout-petits" }),
    h("p", { class: "hint small", text: `L'animatrice lit la question ; chaque réponse est une photo avec son mot. ${banqueCatalogue.length} questions : choisissez un thème, cochez, ou tirez-en 10 au hasard, puis relisez-les dans le quiz.` }),
    h("div", { class: "chips" }, chip(`Tous les thèmes`, null),
      ...Object.entries(FAMILLES_PETITS).map(([k, label]) => chip(label, k))),
    recherche,
    h("div", { class: "row" },
      h("button", {
        type: "button", class: "btn secondary", text: "🎲 10 au hasard",
        onclick: () => {
          const tirage = tirerPetits(10, { famille: banqueFamille, exclus: deja, catalogue: banqueCatalogue });
          banqueCoches = new Map(tirage.map((q) => [q.id, q]));
          banqueRecherche = "";
          renderBanque();
        },
      }),
      bouton,
      h("span", { id: "rv-banque-status", class: "hint small" })),
    h("div", { class: "banque-list" }, ...montrees.map((q) => h("label", { class: `banque-q${deja.has(q.text) ? " deja" : ""}`, "data-banque": q.id },
      h("input", {
        type: "checkbox", checked: banqueCoches.has(q.id), disabled: deja.has(q.text),
        onchange: (e) => { if (e.target.checked) banqueCoches.set(q.id, q); else banqueCoches.delete(q.id); majBouton(); },
      }),
      h("span", { class: "banque-texte", text: q.text }),
      h("span", { class: "banque-mots", text: q.choices.map((c) => `${motBanque(c)?.emoji ?? ""} ${c}`).join(" · ") }),
      deja.has(q.text) ? h("span", { class: "tag", text: "déjà dans le quiz" }) : null)),
      liste.length > montrees.length ? h("p", { class: "hint small", text: `… et ${liste.length - montrees.length} autres : choisissez un thème ou cherchez un mot.` }) : null,
      liste.length ? null : h("p", { class: "hint small", text: "Aucune question ne correspond à cette recherche." })));
}

// ---------- Le quiz classique tout prêt dans un quiz classique (cedric, 22/10) ----------
// Les questions à 4 réponses (avec leur émoji pour la révélation) et les Juste Chiffre (sans émoji : le compteur).

/** Les deux sortes de questions toutes prêtes : une puce chacune. */
const TYPES_TOUT_PRETS = { qcm: ["❓ 4 réponses", (x) => !estJusteChiffre(x)], nombre: ["🔢 Juste Chiffre", estJusteChiffre] };
let chiffresType = null;
let chiffresTheme = null;
let chiffresNiveau = null;
let chiffresRecherche = "";
/** Questions cochées : identifiant → question de la banque, dans l'ordre où elles ont été cochées. */
const chiffresCoches = new Map();

$("rv-chiffres").onclick = () => {
  const panel = $("rv-chiffres-panel");
  panel.hidden = !panel.hidden;
  if (panel.hidden) return;
  // L'âge du quiz, s'il est rempli, choisit d'avance son niveau (Facile, Moyen ou Difficile).
  chiffresNiveau = niveauPourAge(Number.parseInt($("rv-age-min").value, 10));
  renderChiffres();
};

function renderChiffres() {
  const panel = $("rv-chiffres-panel");
  const deja = new Set((draft?.questions ?? []).map((q) => q.text.trim()));
  for (const [id, q] of chiffresCoches) if (deja.has(q.text)) chiffresCoches.delete(id);
  const duType = (x) => !chiffresType || TYPES_TOUT_PRETS[chiffresType][1](x);
  const duNiveau = (x) => !chiffresNiveau || x.niveau === chiffresNiveau;
  // Les thèmes qui ont des questions de cette sorte à ce niveau.
  const pourAge = QUESTIONS_TOUT_PRETES.filter((x) => duType(x) && duNiveau(x));
  const themes = Object.entries(THEMES_TOUT_PRETS).filter(([k]) => pourAge.some((x) => x.theme === k));
  if (chiffresTheme && !themes.some(([k]) => k === chiffresTheme)) chiffresTheme = null;
  const choix = pourAge.filter((x) => !chiffresTheme || x.theme === chiffresTheme);
  const trouvees = parPertinence(choix.filter((x) => contientTout([x.text, ...(x.choices ?? []), THEMES_TOUT_PRETS[x.theme]], chiffresRecherche)),
    chiffresRecherche, (x) => [x.text]);
  // Les questions cochées d'abord (même d'un autre thème), puis les autres.
  const liste = [...chiffresCoches.values(), ...trouvees.filter((x) => !chiffresCoches.has(x.id))];
  const chip = (label, theme) => h("button", {
    type: "button", class: `chip${chiffresTheme === theme ? " active" : ""}`, "data-theme": theme ?? "tous", text: label,
    onclick: () => { chiffresTheme = theme; renderChiffres(); },
  });
  const chipType = (label, type) => h("button", {
    type: "button", class: `chip${chiffresType === type ? " active" : ""}`, "data-type": type ?? "tous", text: label,
    onclick: () => { chiffresType = type; renderChiffres(); },
  });
  const bouton = h("button", { type: "button", id: "rv-chiffres-add", class: "btn", onclick: () => ajouterChiffres() });
  const majBouton = () => {
    const n = chiffresCoches.size;
    bouton.disabled = !n;
    bouton.textContent = n ? `Ajouter ${n > 1 ? `les ${n} questions cochées` : "la question cochée"}` : "Cochez des questions";
  };
  majBouton();
  const recherche = h("input", {
    type: "search", id: "rv-chiffres-cherche", placeholder: "Chercher (pattes, planète, Disney, Paris…)", value: chiffresRecherche,
    oninput: (e) => {
      chiffresRecherche = e.target.value;
      clearTimeout(recherche.timer);
      recherche.timer = setTimeout(() => { renderChiffres(); $("rv-chiffres-cherche")?.focus(); }, 250);
    },
  });
  // Trois niveaux sans chevauchement (cedric, 22/10) : une puce chacun, avec son nombre de questions.
  const chipNiveau = (label, niveau) => h("button", {
    type: "button", class: `chip${chiffresNiveau === niveau ? " active" : ""}`, "data-niveau": niveau ?? "tous",
    text: `${label} (${QUESTIONS_TOUT_PRETES.filter((x) => duType(x) && (!niveau || x.niveau === niveau)).length})`,
    onclick: () => { chiffresNiveau = niveau; renderChiffres(); },
  });
  panel.replaceChildren(
    h("p", { class: "label", text: "Quiz classique tout prêt" }),
    h("p", { class: "hint small", text: `${plural(QUESTIONS_TOUT_PRETES.filter(TYPES_TOUT_PRETS.qcm[1]).length, "question")} à 4 réponses, avec leur image montrée à la révélation, et ${QUESTIONS_TOUT_PRETES.filter(estJusteChiffre).length} Juste Chiffre (chaque équipe tape un nombre, la plus proche gagne ; la TV montre son compteur, sans image). Choisissez la sorte, le niveau et le thème, cochez, ou tirez-en 5 au hasard.` }),
    h("div", { class: "chips" }, chipType("Toutes", null), ...Object.entries(TYPES_TOUT_PRETS).map(([k, [label]]) => chipType(label, k))),
    h("div", { class: "chips niveaux" }, chipNiveau("Tous les niveaux", null), ...Object.keys(NIVEAUX_CHIFFRES).map(Number).map((n) => chipNiveau(libelleNiveau(n), n))),
    h("div", { class: "chips" }, chip("Tous les thèmes", null), ...themes.map(([k, label]) => chip(label, k))),
    h("div", { class: "row" }, recherche),
    h("div", { class: "row" },
      h("button", {
        type: "button", id: "rv-chiffres-hasard", class: "btn secondary", text: "🎲 5 au hasard",
        onclick: () => {
          const tirage = tirerChiffres(5, { theme: chiffresTheme, niveau: chiffresNiveau, exclus: deja, liste: QUESTIONS_TOUT_PRETES.filter(duType) });
          chiffresCoches.clear();
          tirage.forEach((x) => chiffresCoches.set(x.id, x));
          chiffresRecherche = "";
          renderChiffres();
          if (!tirage.length) $("rv-chiffres-status").textContent = "Plus aucune question libre pour ce thème et ce niveau.";
        },
      }),
      bouton,
      h("span", { id: "rv-chiffres-status", class: "hint small" })),
    h("div", { class: "banque-list" }, ...liste.map((x) => h("label", { class: `banque-q${deja.has(x.text) ? " deja" : ""}`, "data-chiffre": x.id },
      h("input", {
        type: "checkbox", checked: chiffresCoches.has(x.id), disabled: deja.has(x.text),
        onchange: (e) => { if (e.target.checked) chiffresCoches.set(x.id, x); else chiffresCoches.delete(x.id); majBouton(); },
      }),
      // Juste Chiffre : 🔢, jamais d'émoji (cedric, 22/10) ; 4 réponses : l'image de la révélation (sa photo, sinon son
      // émoji au niveau Facile) et les réponses, la bonne marquée.
      h("span", { class: "banque-texte" }, x.photo ? h("img", { class: "q-mini", src: x.photo, alt: "", loading: "lazy" }) : null,
        `${estJusteChiffre(x) ? "🔢 " : x.photo ? "" : x.emoji ? `${x.emoji} ` : "⚠ "}${x.text}`),
      h("span", { class: "banque-mots", text: [
        estJusteChiffre(x) ? `Juste Chiffre · réponse : ${x.correct.toLocaleString("fr-FR")}` : x.choices.map((c, k) => (k === x.correct ? `✓ ${c}` : c)).join(" · "),
        THEMES_TOUT_PRETS[x.theme], libelleNiveau(x.niveau)].join(" · ") }),
      deja.has(x.text) ? h("span", { class: "tag", text: "déjà dans le quiz" }) : null)),
      liste.length ? null : h("p", { class: "hint small", text: chiffresRecherche ? "Aucune question ne correspond à cette recherche." : "Aucune question pour ce thème et ce niveau." })));
}

/**
 * Ajoute les questions cochées au quiz, déjà validées (à relire) : un Juste Chiffre sans image ; une question à
 * 4 réponses avec sa photo pour la révélation (rangée une fois dans la bibliothèque des images), sinon son émoji
 * (niveau Facile), ses réponses mélangées (la bonne n'est pas toujours la A).
 */
async function ajouterChiffres() {
  const choisies = [...chiffresCoches.values()];
  if (!choisies.length) return;
  $("rv-chiffres-add").disabled = true;
  if (choisies.some((x) => x.photo)) status("rv-status", "Ajout des photos…", true);
  for (const x of choisies) {
    const nombre = estJusteChiffre(x);
    const choices = nombre ? [] : shuffle(x.choices);
    let imageId = null;
    if (x.photo) {
      try {
        const res = await fetch(x.photo);
        if (res.ok && (res.headers.get("content-type") ?? "").startsWith("image/")) imageId = await storeIllustration(await res.blob());
      } catch (err) { console.error(err); /* sans photo : l'émoji s'il y en a un, sinon l'alerte « Pas d'illustration » */ }
    }
    draft.questions.push({
      text: x.text, choices, correct: nombre ? x.correct : choices.indexOf(x.choices[x.correct]), duration: null, double: false,
      status: "validee", marks: 0, image: nombre || imageId ? "" : x.emoji ?? "", imageId, kind: nombre ? "number" : null,
      slotImages: [null, null, null, null], missingImages: [],
    });
  }
  chiffresCoches.clear();
  renderReview();
  renderChiffres();
  noterEcran();
  status("rv-status", `${plural(choisies.length, "question toute prête ajoutée", "questions toutes prêtes ajoutées")} : relisez-les, puis enregistrez le quiz.`, true);
}

/** Photos de la banque, mot par mot, comme sur la TV ; Sarah peut mettre la sienne (rangée dans library/contents/petits). */
$("banque-open").onclick = () => { show("banque"); renderBanqueMots(); };

const banqueChoisies = () => ({ ...(contents.petits?.images ?? {}) });

async function saveBanqueImages(images, message) {
  try {
    await set(ref(db, "library/contents/petits"), { images: Object.keys(images).length ? images : null, updatedAt: serverTimestamp() });
    // Les prochaines questions ajoutées prennent la nouvelle photo.
    Object.keys(banqueImages).forEach((k) => delete banqueImages[k]);
    status("banque-status", message, true);
  } catch (err) {
    console.error(err);
    status("banque-status", "Enregistrement refusé : vérifiez Internet ou reconnectez-vous.");
  }
}

let banqueMotsFamille = "animaux";

function renderBanqueMots() {
  const box = $("banque-mots");
  if ($("screen-banque").hidden) return;
  const images = banqueChoisies();
  $("banque-themes").replaceChildren(...Object.entries(FAMILLES_PETITS).map(([k, label]) => h("button", {
    type: "button", class: `chip${banqueMotsFamille === k ? " active" : ""}`,
    text: `${label} (${BANQUE_MOTS.filter((m) => m.famille === k).length})`,
    onclick: () => { banqueMotsFamille = k; renderBanqueMots(); },
  })));
  box.replaceChildren(...BANQUE_MOTS.filter((m) => m.famille === banqueMotsFamille).map((m) => {
    const slot = contentSlot(m.cle);
    const id = images[slot];
    const img = h("img", { class: "choice-thumb bulle vignette", alt: m.mot, loading: "lazy", title: "Cliquer pour cadrer la photo comme sur la TV" });
    const montrer = (src) => { img.src = src; };
    if (id) {
      if (imageCache[id]) montrer(imageCache[id]);
      else get(ref(db, `library/images/${id}`)).then((snap) => { if (typeof snap.val() === "string") { imageCache[id] = snap.val(); montrer(snap.val()); } }).catch(() => {});
    } else {
      img.src = `banque/${m.cle}.jpg`;
      img.onerror = () => { img.onerror = null; emojiImage(m.emoji).then((b) => { img.src = URL.createObjectURL(b); }); };
    }
    img.onclick = () => cadrerBanque(m, img.src);
    const file = h("input", {
      type: "file", accept: "image/*", hidden: true,
      onchange: async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        try {
          const newId = await storeChoiceImage(f);
          await saveBanqueImages({ ...banqueChoisies(), [slot]: newId }, `« ${m.mot} » : votre photo est enregistrée. Cliquez dessus pour la cadrer.`);
        } catch (err) {
          console.error(err);
          status("banque-status", "Photo refusée : essayez une autre image (JPEG ou PNG).");
        }
      },
    });
    return h("div", { class: "banque-mot", "data-mot": m.cle }, img, h("b", { text: m.mot }),
      h("span", { class: "row" },
        h("button", { type: "button", class: "icon", title: "Mettre ma photo", text: "📷", onclick: () => file.click() }),
        id ? h("button", {
          type: "button", class: "icon", title: "Remettre la photo de la banque", text: "↺",
          onclick: () => { const { [slot]: _, ...rest } = banqueChoisies(); saveBanqueImages(rest, `« ${m.mot} » : photo de la banque remise.`); },
        }) : null),
      file);
  }));
}

/** Cadrage d'une photo de la banque : le résultat devient la photo choisie pour ce mot. */
function cadrerBanque(m, src) {
  ouvrirCadrage(src, "vignette").then(async (blob) => {
    if (!blob) return;
    const newId = await storeChoiceImage(blob);
    await saveBanqueImages({ ...banqueChoisies(), [contentSlot(m.cle)]: newId }, `« ${m.mot} » : cadrage enregistré.`);
  }).catch((err) => { console.error(err); status("banque-status", "Cadrage impossible pour cette photo."); });
}

/** Image d'un mot : celle choisie par Sarah, sinon la photo de la banque, sinon son émoji dessiné ; rangée une fois. */
async function imageBanque(mot) {
  if (banqueImages[mot]) return banqueImages[mot];
  const m = motBanque(mot);
  const choisie = contents.petits?.images?.[contentSlot(m?.cle ?? cleMot(mot))];
  if (IMAGE_ID.test(choisie ?? "")) return (banqueImages[mot] = choisie);
  let blob = null;
  try {
    const res = await fetch(`banque/${m?.cle ?? cleMot(mot)}.jpg`);
    if (res.ok && (res.headers.get("content-type") ?? "").startsWith("image/")) blob = await res.blob();
  } catch { /* pas de photo : l'émoji */ }
  blob ??= await emojiImage(m?.emoji ?? "❓");
  return (banqueImages[mot] = await storeChoiceImage(blob));
}

/** Un émoji dessiné en grand sur fond blanc (480 px) : la réponse a une image même sans photo. */
function emojiImage(emoji) {
  const c = Object.assign(document.createElement("canvas"), { width: 480, height: 480 });
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 480, 480);
  ctx.font = "320px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, 240, 260);
  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}

/** Ajoute les questions cochées au quiz : propositions mélangées, une image par réponse, déjà validées (à relire). */
async function ajouterBanque() {
  const choisies = [...banqueCoches.values()];
  if (!choisies.length) return;
  $("rv-banque-add").disabled = true;
  $("rv-banque-status").textContent = "Préparation des images…";
  try {
    for (const q of choisies) {
      const choices = shuffle(q.choices);
      const slotImages = await Promise.all(choices.map(imageBanque));
      draft.questions.push({
        text: q.text, choices, correct: choices.indexOf(q.choices[0]), duration: null, double: false, status: "validee", marks: 0,
        image: "", imageId: null, kind: null, slotImages, missingImages: [],
      });
    }
    if (!$("rv-title").value.trim()) $("rv-title").value = "Quiz des tout-petits";
    banqueCoches.clear();
    renderReview();
    renderBanque();
    noterEcran();
    status("rv-status", `${choisies.length} question${choisies.length > 1 ? "s" : ""} ajoutée${choisies.length > 1 ? "s" : ""} : relisez-les, puis enregistrez le quiz.`, true);
  } catch (err) {
    console.error(err);
    $("rv-banque-status").textContent = "Images refusées : vérifiez Internet ou reconnectez-vous, puis réessayez.";
    $("rv-banque-add").disabled = false;
  }
}

/** Ordre de passage des questions dans le quiz. */
function moveQuestion(i, delta) {
  const [q] = draft.questions.splice(i, 1);
  draft.questions.splice(i + delta, 0, q);
  renderReview();
}

$("rv-save").onclick = async () => {
  await cadrageEnCours;
  const title = $("rv-title").value.trim();
  if (!title) return status("rv-status", "Donnez un titre au quiz.");
  const questions = draft.questions.filter((q) => q.text || q.choices.length || q.kind === "number");
  if (!questions.length) return status("rv-status", "Le quiz ne contient aucune question.");
  const empty = questions.findIndex((q) => !q.text || (q.kind !== "number" && !q.choices.length));
  if (empty >= 0) return status("rv-status", `La question ${draft.questions.indexOf(questions[empty]) + 1} n'a pas de texte ou pas de proposition.`);
  const num = (v) => (v === "" ? null : Number(v));
  const id = draft.id ?? push(ref(db, "library/quizzes")).key;
  $("rv-save").disabled = true;
  try {
    await set(ref(db, `library/quizzes/${id}`), {
      // Un pack : son thème écrit comme un thème déjà là s'il s'y confond (« kpop » → « K-pop »).
      title, theme: (estPackOuSerie(draft.quiz) ? themeExistant($("rv-theme").value, themesExistants()) : $("rv-theme").value.trim()) || null,
      ageMin: num($("rv-age-min").value), ageMax: num($("rv-age-max").value),
      source: draft.quiz.source ?? "saisie", kind: draft.kind,
      // Un pack importé le reste (ses images restent dans « Images des packs »), avec sa famille et son niveau.
      ...(draft.quiz.pack === true ? { pack: true } : {}),
      famille: lireFamille(draft.quiz.famille), niveau: lireNiveau($("rv-niveau").value),
      imagesHorsFormat: (() => {
        const utilisees = new Set(questions.flatMap((q) => [q.imageId, ...(q.kind === "number" ? [] : Object.values(savedChoiceImages(q) ?? {}))]));
        const gardees = Object.entries(draft.quiz.imagesHorsFormat ?? {}).filter(([id]) => utilisees.has(id));
        return gardees.length ? Object.fromEntries(gardees) : null;
      })(),
      createdAt: draft.quiz.createdAt ?? Date.now(), updatedAt: serverTimestamp(),
      questions: questions.map((q) => ({
        text: q.text.slice(0, 300), choices: q.kind === "number" ? null : q.choices,
        correct: q.kind === "number" ? (Number.isInteger(q.correct) ? q.correct : 0) : q.correct,
        kind: q.kind === "number" ? "number" : null, duration: q.duration, double: q.double, status: q.status,
        image: cleanEmoji(q.image) || null, imageId: q.imageId || null,
        choiceImages: q.kind === "number" ? null : savedChoiceImages(q),
        // Le niveau changé à la main dans la Bibliothèque (cedric, 25/10) reste.
        niveau: lireNiveau(q.niveau),
      })),
    });
    draft.id = id;
    histRelecture.enregistre();
    const aCorriger = questions.filter((q) => q.status !== "validee").length;
    status("rv-status", `Enregistré : ${plural(questions.length, "question")}${aCorriger ? `, dont ${aCorriger} à corriger (elle${aCorriger > 1 ? "s" : ""} ne se joue${aCorriger > 1 ? "nt" : ""} pas)` : ""}.`, true);
  } catch (err) {
    console.error(err);
    status("rv-status", "Enregistrement refusé : vérifiez les questions ou vos droits d'administration.");
  } finally {
    $("rv-save").disabled = false;
  }
};

/** Images des réponses à enregistrer : { "0": id, "2": id } (cases sans image omises), ou rien. */
function savedChoiceImages(q) {
  const ids = (q.choiceImages ?? q.choices.map((_, k) => q.slotImages?.[k] ?? null)).slice(0, q.choices.length);
  const entries = ids.map((id, k) => [String(k), id]).filter(([, id]) => IMAGE_ID.test(id ?? ""));
  return entries.length ? Object.fromEntries(entries) : null;
}

// ---------- Paramètres : mots de passe ----------

async function showLastChange() {
  const at = (await get(ref(db, "settings/regie/updatedAt"))).val();
  $("last-change").textContent = at
    ? `Dernière modification : ${new Date(at).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}`
    : "Aucun mot de passe de régie enregistré pour l'instant : les animatrices utilisent le code affiché sur la TV.";
}

function passwordForm({ form, pw1, pw2, button, out, kind, done }) {
  $(form).onsubmit = async (e) => {
    e.preventDefault();
    const pw = $(pw1).value;
    if (cleanPassword(pw).length < MIN_PASSWORD_LENGTH) return status(out, `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`);
    if (cleanPassword(pw) !== cleanPassword($(pw2).value)) return status(out, "Les deux mots de passe ne sont pas identiques.");
    $(button).disabled = true;
    status(out, "");
    try {
      if (kind === "admin") rekeying = true;
      await savePassword(kind, pw);
      $(pw1).value = "";
      $(pw2).value = "";
      await done(pw);
    } catch (err) {
      console.error(err);
      status(out, "Enregistrement refusé : reconnectez-vous avec le mot de passe administrateur.");
    } finally {
      rekeying = false;
      $(button).disabled = false;
    }
  };
}

passwordForm({
  form: "password-form", pw1: "pw1", pw2: "pw2", button: "save", out: "save-status", kind: "regie",
  done: async () => {
    status("save-status", "Mot de passe de la régie enregistré. Il est valable dès maintenant.", true);
    await showLastChange();
  },
});

passwordForm({
  form: "admin-form", pw1: "admin-pw1", pw2: "admin-pw2", button: "admin-save", out: "admin-save-status", kind: "admin",
  // L'ancienne empreinte de cet appareil ne vaut plus : on le reconnecte avec le nouveau mot de passe.
  done: async (pw) => {
    const error = await prove(pw);
    if (error) return route();
    enter();
    status("admin-save-status", "Mot de passe administrateur changé. Les autres appareils devront le saisir à nouveau.", true);
  },
});

// ---------- Paramètres : nettoyage des copies des fêtes terminées ----------

/*
 * Les copies des extraits et des photos dans les parties terminées s'effacent toutes seules (cedric, 21/10) : à chaque
 * ouverture de la Régie PC, une fois par heure au plus, un passage en arrière-plan vérifie chaque partie et chaque copie
 * (voir nettoyage.js), puis efface seulement les copies vérifiées. Le tout premier passage ne fait que compter (contrôle,
 * rien d'effacé) ; les suivants effacent. « Vérifier maintenant » montre le détail sans rien effacer.
 */
/** Parties lues en même temps : quelques centaines de parties restent rapides sans charger le PC ni la base. */
const PARTIES_EN_MEME_TEMPS = 4;

/** Adresse de l'API REST de la base de la page (l'émulateur des tests veut en plus le nom de la base). */
function adresseRest(chemin, params) {
  const q = new URLSearchParams(params);
  if (emulator) q.set("ns", new URL(config.databaseURL).hostname.split(".")[0]);
  const base = emulator ? "http://127.0.0.1:9000" : config.databaseURL.replace(/\/+$/, "");
  return `${base}/${chemin.split("/").map(encodeURIComponent).join("/")}.json?${q}`;
}

/**
 * Clés d'un nœud seulement (« shallow » de l'API REST) : jamais les extraits ni les photos eux-mêmes. Le jeton de
 * connexion de cet appareil prouve aux règles qu'il est administrateur.
 */
async function clesDe(chemin) {
  const jeton = await auth.currentUser.getIdToken();
  const reponse = await fetch(adresseRest(chemin, { shallow: "true", auth: jeton }), { cache: "no-store" });
  if (!reponse.ok) throw new Error(`Lecture refusée (${reponse.status}) : ${chemin}`);
  const valeur = await reponse.json();
  return valeur && typeof valeur === "object" ? Object.keys(valeur) : [];
}

/** Heure du serveur Firebase : l'horloge du PC peut avancer ou retarder. */
const heureServeur = () => new Promise((ok) => {
  onValue(ref(db, ".info/serverTimeOffset"), (s) => ok(Date.now() + (Number(s.val()) || 0)), () => ok(Date.now()), { onlyOnce: true });
});

/** [fn] sur chaque élément, [n] à la fois au plus ; les résultats dans l'ordre. */
async function parPaquets(elements, n, fn) {
  const sortie = new Array(elements.length);
  let suivant = 0;
  const ouvrier = async () => {
    while (suivant < elements.length) {
      const i = suivant++;
      sortie[i] = await fn(elements[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, elements.length) }, ouvrier));
  return sortie;
}

/** Une partie : état, dates et titre (de petites valeurs) et les identifiants de ses copies, jamais leur contenu. */
async function lirePartie(code) {
  const enfants = new Set(await clesDe(`games/${code}`));
  const petit = (chemin) => get(ref(db, `games/${code}/${chemin}`)).then((s) => s.val());
  const si = (enfant, lire) => (enfants.has(enfant) ? lire() : null);
  const [phase, endedAt, createdAt, title, childName, ...copies] = await Promise.all([
    si("state", () => petit("state/phase")), si("state", () => petit("state/endedAt")), si("createdAt", () => petit("createdAt")),
    si("public", () => petit("public/title")), si("public", () => petit("public/childName")),
    ...DOSSIERS.map((d) => (enfants.has(d) ? clesDe(`games/${code}/${d}`) : [])),
  ]);
  return { code, phase, endedAt, createdAt, title, childName, ...Object.fromEntries(DOSSIERS.map((d, i) => [d, copies[i]])) };
}

/**
 * Un passage de contrôle : toutes les parties en ligne, chacune classée « à nettoyer » ou « gardée » avec sa raison.
 * Ne touche à rien. [progres](faites, total) pour l'écran.
 */
async function controlerParties(progres = () => {}) {
  const [codes, sons, images, chansons, maintenant] = await Promise.all([clesDe("games"), clesDe("library/sounds"), clesDe("library/images"), clesDe("library/songs"), heureServeur()]);
  const bibliotheque = { sounds: new Set(sons), images: new Set(images), songs: new Set(chansons) };
  let faites = 0;
  progres(0, codes.length);
  return parPaquets(codes, PARTIES_EN_MEME_TEMPS, async (code) => {
    const partie = await lirePartie(code);
    progres(++faites, codes.length);
    return { ...partie, ...classerPartie(partie, { maintenant, bibliotheque }) };
  });
}

const dateHeure = (t) => new Date(t).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
const leA = (t) => `le ${new Date(t).toLocaleDateString("fr-FR")} à ${new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
/**
 * État d'une partie en clair (cedric, 21/10) : seule la fin notée par la TV compte, jamais la date ni l'archivage de la
 * prestation.
 */
const etatPartie = (r) => (r.phase !== "ended" ? "En cours ou interrompue (reprise possible)"
  : typeof r.endedAt === "number" ? `Terminée ${leA(r.endedAt)}` : "Terminée (heure de fin inconnue)");
const nCopies = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

/** Heure de fin de la partie, sinon de sa création (pour ranger le tableau, les plus récentes d'abord). */
const quand = (r) => (typeof r.endedAt === "number" ? r.endedAt : typeof r.createdAt === "number" ? r.createdAt : 0);

/** Bilan du contrôle : chiffres, raisons des parties gardées, puis une ligne par partie qui a des copies. */
function afficherBilan(parties) {
  const b = bilan(parties);
  const sansCopie = parties.filter((r) => !DOSSIERS.some((d) => r.copies[d].length)).length;
  const avec = parties.filter((r) => DOSSIERS.some((d) => r.copies[d].length)).sort((x, y) =>
    (x.decision === y.decision ? 0 : x.decision === "nettoyer" ? -1 : 1) || quand(y) - quand(x));
  const chiffre = (n, texte, cle) => h("div", { class: "nettoyage-chiffre", "data-chiffre": cle }, h("b", { text: n }), h("span", { text: texte }));
  const ligne = (r) => {
    const date = typeof r.createdAt === "number" ? dateHeure(r.createdAt) : "—";
    const images = r.copies.images.length + r.copies.choiceImages.length;
    const cellule = (label, ...contenu) => h("td", { "data-label": label }, h("div", {}, ...contenu));
    return h("tr", { "data-code": r.code, class: r.decision },
      cellule("Créée le", date),
      cellule("Code", h("b", { text: r.code })),
      cellule("Prestation", [r.title, r.childName].filter((x) => typeof x === "string" && x).join(" · ") || "—"),
      cellule("État", etatPartie(r)),
      cellule("Copies", `${nCopies(r.copies.sounds.length, "son", "sons")} · ${nCopies(images, "image", "images")}${r.copies.songs.length ? ` · ${nCopies(r.copies.songs.length, "chanson entière", "chansons entières")}` : ""}`),
      cellule("≈ Mo", texteMo(moDe(r.copies))),
      cellule("Décision",
        h("b", { class: "decision", text: r.decision === "nettoyer" ? "À nettoyer" : "Gardée" }),
        h("small", { class: "raison", text: r.raison }),
        ...r.notes.map((n) => h("small", { class: "note", text: n }))));
  };
  remplir($("nettoyage-bilan"),
    h("div", { class: "nettoyage-chiffres" },
      chiffre(b.parties, b.parties > 1 ? "parties en ligne" : "partie en ligne", "parties"),
      chiffre(b.aNettoyer, "à nettoyer", "a-nettoyer"),
      chiffre(`≈ ${texteMo(b.mo)}`, "à libérer (environ)", "mo")),
    b.gardees.length ? h("ul", { class: "nettoyage-raisons" },
      ...b.gardees.map(([raison, n]) => h("li", { "data-raison": raison }, h("b", { text: `${n} gardée${n > 1 ? "s" : ""}` }), ` : ${raison}`))) : null,
    b.extraitsGardes ? h("p", { class: "hint small", "data-extraits-gardes": b.extraitsGardes, text: `En tout, ${b.extraitsGardes > 1 ? `${b.extraitsGardes} extraits gardés` : "1 extrait gardé"} : la chanson n'est plus dans la bibliothèque.` }) : null,
    b.prochain ? h("p", { class: "hint small", text: `Prochaine fête bonne à nettoyer ${leA(b.prochain)}.` }) : null,
    avec.length ? h("div", { class: "nettoyage-table" }, h("table", {},
      h("thead", {}, h("tr", {}, ...["Créée le", "Code", "Prestation", "État", "Copies", "≈ Mo", "Décision"].map((t) => h("th", { text: t })))),
      h("tbody", {}, ...avec.map(ligne)))) : null,
    sansCopie ? h("p", { class: "hint small", text: "Les parties sans aucune copie ne sont pas dans le tableau." }) : null);
  $("nettoyage-bilan").hidden = false;
}

/** « Vérifier maintenant » : le détail partie par partie, sans rien effacer. */
$("nettoyage-verifier").onclick = async () => {
  const bouton = $("nettoyage-verifier");
  bouton.disabled = true;
  $("nettoyage-bilan").hidden = true;
  status("nettoyage-status", "Vérification en cours…", true);
  try {
    const parties = await controlerParties((faites, total) => status("nettoyage-status", `Vérification en cours : ${faites} / ${total} parties…`, true));
    afficherBilan(parties);
    status("nettoyage-status", "Vérification terminée : rien n'a été effacé.", true);
  } catch (err) {
    console.error(err);
    status("nettoyage-status", "Vérification impossible : vérifiez Internet ou reconnectez-vous, puis recommencez.");
  } finally {
    bouton.disabled = false;
  }
};

/**
 * « 💾 Sauvegarder les prestations » (cedric, 22/10) : avant une séance de travail en direct, un fichier sur le PC avec
 * tout ce qui se fabrique dans la Régie PC. Sans les fichiers des images et des sons (trop lourds, et jamais touchés
 * par ces séances). Lecture seule : rien n'est écrit en ligne.
 */
const A_SAUVEGARDER = ["shows", "manches", "quizzes", "playlists", "mimes", "contents", "songs", "lyrics", "medias"];
const deux = (n) => String(n).padStart(2, "0");
$("sauvegarde").onclick = async () => {
  const bouton = $("sauvegarde");
  bouton.disabled = true;
  status("sauvegarde-status", "Sauvegarde en cours…", true);
  try {
    const at = new Date();
    const lus = await Promise.all(A_SAUVEGARDER.map((n) => get(ref(db, `library/${n}`))));
    const library = Object.fromEntries(A_SAUVEGARDER.map((n, i) => [n, lus[i].val() ?? {}]));
    const texte = JSON.stringify({ app: "little-miss-party-quiz", sauvegarde: 1, at: at.toISOString(), library }, null, 1);
    const nom = `sauvegarde-regie-${isoDay(at)}-${deux(at.getHours())}h${deux(at.getMinutes())}.json`;
    const url = URL.createObjectURL(new Blob([texte], { type: "application/json" }));
    const lien = h("a", { href: url, download: nom, hidden: true });
    document.body.append(lien);
    lien.click();
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    const combien = Object.keys(library.shows).length;
    status("sauvegarde-status", `Sauvegarde téléchargée : ${nom} (${combien} prestation${combien > 1 ? "s" : ""}, ${Math.max(1, Math.round(texte.length / 1024))} Ko), dans le dossier Téléchargements de ce PC.`, true);
  } catch (err) {
    console.error(err);
    status("sauvegarde-status", "Sauvegarde impossible : vérifiez Internet ou reconnectez-vous, puis recommencez.");
  } finally {
    bouton.disabled = false;
  }
};

/** Efface les copies d'une partie et le note dans le journal, en une seule écriture : tout ou rien. */
async function nettoyerPartie(r) {
  const cle = push(ref(db, "maintenance/nettoyages")).key;
  await update(ref(db), {
    ...effacements(r.code, r.effacer),
    [`maintenance/nettoyages/${cle}`]: {
      at: serverTimestamp(), code: r.code, mo: arrondi(r.mo),
      sounds: r.effacer.sounds.length, images: r.effacer.images.length, choiceImages: r.effacer.choiceImages.length,
      // Seulement s'il y en a : le journal d'avant la régie téléphone des statues refuserait ce compteur.
      ...(r.effacer.songs.length ? { songs: r.effacer.songs.length } : {}),
      ...(r.gardes.length ? { gardes: r.gardes.length } : {}),
    },
  });
}

/** Les [n] dernières entrées d'un journal, les plus récentes d'abord. */
async function derniers(chemin, n) {
  const s = await get(query(ref(db, chemin), orderByKey(), limitToLast(n)));
  const liste = [];
  s.forEach((x) => { liste.unshift(x.val()); });
  return liste;
}

/** Où en est le passage automatique de cette ouverture (montré dans Paramètres). */
let passageAuto = null;
let passageLance = false;
const arrondi = (mo) => Math.round(mo * 100) / 100;
const INTERROMPU = "Nettoyage automatique interrompu : il sera refait à la prochaine ouverture de la Régie PC.";

/**
 * Passage automatique, après la connexion, en arrière-plan (l'administration reste utilisable), une fois par heure au
 * plus : les copies d'une fête partent à la première ouverture après les 24 h. Chaque passage vérifie d'abord toutes
 * les parties et chaque copie, puis efface exactement les copies vérifiées, partie par partie, avec leur trace dans le
 * journal. Le tout premier passage (journal vide) est un contrôle : il compte, n'efface rien, et le note. Une erreur
 * reste dans la console : le passage n'est pas noté et se refait à la prochaine ouverture.
 */
async function passageAutomatique() {
  if (passageLance) return;
  passageLance = true;
  try {
    const [[dernier], maintenant] = await Promise.all([derniers("maintenance/passages", 1), heureServeur()]);
    if (!passageAFaire(dernier, maintenant)) { passageAuto = "Nettoyage automatique : déjà fait il y a moins d'une heure."; return; }
    passageAuto = "Nettoyage automatique en cours…";
    afficherJournal();
    const parties = await controlerParties();
    const b = bilan(parties);
    const trace = { at: serverTimestamp(), parties: parties.length, ...(Object.keys(b.copiesGardees).length ? { gardees: b.copiesGardees } : {}) };
    if (!dernier) {
      // Premier passage de contrôle : on compte ce qui serait effacé, rien n'est touché.
      await set(push(ref(db, "maintenance/passages")), { ...trace, type: "controle", nettoyees: 0, copies: b.copiesAEffacer, mo: arrondi(b.mo) });
      passageAuto = `Premier passage de contrôle : ${nCopies(b.copiesAEffacer, "copie", "copies")} à effacer, rien effacé. Le nettoyage commence à la prochaine ouverture, dans une heure au moins.`;
      return;
    }
    const faites = [];
    let refus = 0;
    for (const r of parties.filter((x) => x.decision === "nettoyer")) {
      try {
        await nettoyerPartie(r);
        faites.push(r);
      } catch (err) {
        refus++;
        console.warn("Copies non effacées, réessai à la prochaine ouverture :", r.code, err);
      }
    }
    if (refus) { passageAuto = INTERROMPU; return; }
    const mo = faites.reduce((t, r) => t + r.mo, 0);
    await set(push(ref(db, "maintenance/passages")), { ...trace, type: "nettoyage", nettoyees: faites.length, copies: b.copiesAEffacer, mo: arrondi(mo) });
    passageAuto = faites.length
      ? `Nettoyage automatique fait : ${faites.length > 1 ? `${faites.length} parties nettoyées` : "1 partie nettoyée"}, ${nCopies(b.copiesAEffacer, "copie effacée", "copies effacées")}, environ ${texteMo(mo)} libérés.`
      : "Nettoyage automatique fait : aucune copie à effacer.";
  } catch (err) {
    console.warn("Nettoyage des copies remis à la prochaine ouverture :", err);
    passageAuto = INTERROMPU;
  } finally {
    afficherJournal();
  }
}

/** Un passage du journal, en clair : date, ce qui a été effacé (ou compté au contrôle), copies gardées et pourquoi. */
function lignePassage(p) {
  const fait = p.type === "controle"
    ? `Contrôle : ${nCopies(p.copies ?? 0, "copie", "copies")} à effacer (environ ${texteMo(p.mo ?? 0)}), rien effacé`
    : `${nCopies(p.nettoyees ?? 0, "partie nettoyée", "parties nettoyées")}, ${nCopies(p.copies ?? 0, "copie effacée", "copies effacées")}, environ ${texteMo(p.mo ?? 0)} libérés`;
  const gardees = texteGardees(p.gardees);
  return h("li", { "data-type": p.type ?? "" },
    h("b", { text: dateHeure(p.at) }), ` · ${fait} (${nCopies(p.parties ?? 0, "partie vérifiée", "parties vérifiées")})`,
    gardees ? h("small", { text: `Copies gardées : ${gardees}` }) : null);
}

/** Lecture du journal la plus récente : seule elle s'affiche (deux ouvertures de Paramètres coup sur coup). */
let tourJournal = 0;
/** Journal du nettoyage : où en est cette ouverture, les derniers passages, puis les dernières parties nettoyées. */
async function afficherJournal() {
  const box = $("nettoyage-journal");
  const tour = ++tourJournal;
  try {
    const [passages, nettoyages] = await Promise.all([derniers("maintenance/passages", 5), derniers("maintenance/nettoyages", 10)]);
    if (tour !== tourJournal) return;
    remplir(box,
      h("h3", { text: "Derniers passages" }),
      passageAuto ? h("p", { id: "nettoyage-auto", class: "hint small", text: passageAuto }) : null,
      h("ul", { class: "nettoyage-passages" }, ...(passages.length ? passages.map(lignePassage) : [h("li", { text: "Aucun passage pour l'instant." })])),
      nettoyages.length ? h("h3", { text: "Dernières parties nettoyées" }) : null,
      nettoyages.length ? h("ul", { class: "nettoyage-faits" }, ...nettoyages.map((n) => h("li", { "data-code": n.code, text:
        `${dateHeure(n.at)} · ${n.code} : ${nCopies(n.sounds, "son", "sons")}, ${nCopies(n.images + n.choiceImages, "image", "images")}${n.songs ? `, ${nCopies(n.songs, "chanson entière", "chansons entières")}` : ""} effacés · environ ${texteMo(n.mo)}${n.gardes ? ` · ${nCopies(n.gardes, "extrait gardé", "extraits gardés")} (chanson plus dans la bibliothèque)` : ""}` }))) : null);
    box.hidden = false;
  } catch (err) {
    console.warn("Journal du nettoyage illisible :", err);
  }
}

// ---------- Prestation de test ----------

/** Une ancienne démo effacée par le bouton, dite en clair dans la fenêtre de confirmation. */
function lignesDemos(plan) {
  const n = (k, un, des) => (plan[k].length ? plural(plan[k].length, un, des) : null);
  return [
    plan.shows.length ? `${n("shows", "prestation de test", "prestations de test")} : ${plan.shows.map((id) => `« ${showTitle(shows[id])} »`).join(", ")}` : null,
    [n("quizzes", "quiz de démo", "quiz de démo"), n("mimes", "paquet de mimes de démo", "paquets de mimes de démo"), n("playlists", "playlist de démo", "playlists de démo")]
      .filter(Boolean).join(", ") || null,
    n("manches", "manche gardée pour elles", "manches gardées pour elles"),
    plan.medias.length ? `leurs photos dessinées et comptines (${plural(plan.medias.length, "fichier")})` : null,
  ].filter(Boolean).map((x) => `• ${x}`);
}

const tic = () => new Promise((fin) => setTimeout(fin, 0));

/**
 * Touche une fois le 🎲 de chaque jeu de la prestation ouverte, comme Sarah (celui de chaque équipe aux Mimes) : chaque
 * jeu se remplit avec son propre tirage (âge, équipes, « jamais deux fois » avec les jeux d'avant).
 */
async function toucherLesDes({ packs = false } = {}) {
  const bloc = (i) => $("show-rounds").querySelectorAll(".jeu-bloc")[i];
  const n = $("show-rounds").querySelectorAll(".jeu-bloc").length;
  for (let i = 0; i < n; i++) {
    // Prestation test d'un thème : les jeux à packs touchent leur 🎲 « thème à 100 % » (le thème déjà tapé).
    if (packs && JEUX_A_PACKS.includes(bloc(i)?.dataset.jeu)) {
      (bloc(i).querySelector(".de-unique") ?? bloc(i).querySelector(".packs-de-recherche"))?.click();
      await tic();
      continue;
    }
    // Le Quiz (cedric, 26/10 : un seul 🎲) : la prestation de test pioche dans les questions libres de droit, comme avant.
    const unique = bloc(i)?.querySelector(".de-unique");
    if (unique) {
      // (Qui a disparu ? : son champ ne cherche que des familles ; il reste vide, tout au hasard.)
      const champ = bloc(i).dataset.jeu === "disparu" ? null : bloc(i).querySelector(".de-unique-champ");
      if (champ) { champ.value = "libre"; champ.dispatchEvent(new Event("input")); }
      unique.click();
      await tic();
      continue;
    }
    const equipes = bloc(i)?.dataset.jeu === "mimes" ? bloc(i).querySelectorAll(".mime-equipe").length : 0;
    if (equipes) {
      for (let k = 0; k < equipes; k++) {
        bloc(i)?.querySelectorAll(".mime-equipe")[k]?.querySelector(".tirage-de:not(.petit)")?.click();
        await tic();
      }
    } else {
      bloc(i)?.querySelector(".tirage-de:not(.petit)")?.click();
      await tic();
    }
  }
}

/**
 * « 🧪 Créer la prestation de test » (cedric, 24/10) : un seul bouton. Les anciennes démos s'effacent (demosAEffacer :
 * jamais rien d'autre), puis la prestation s'ouvre comme une nouvelle : une fête de 9 ans à 4 équipes datée du jour,
 * les 16 jeux, chaque 🎲 touché une fois ; elle s'enregistre « À venir » (gardée « À compléter », avec ce qui manque,
 * si un jeu n'a rien pu tirer : bibliothèque des sons vide par exemple).
 */
// Le nom affiché dans Paramètres vient de test-show.js : il suit tout seul un changement de nom (Touktouka, 24/10).
$("test-titre").textContent = TEST_TITRE;
$("test-prestation").onclick = async () => {
  const btn = $("test-prestation");
  const plan = demosAEffacer({ shows, manches, quizzes, mimes, playlists, songs, contents, medias });
  const lignes = lignesDemos(plan);
  const message = [
    "Créer la prestation de test ?",
    `« ${TEST_TITRE} », datée d'aujourd'hui, ${plural(TEST_FICHE.teams, "équipe")} : les ${JEUX_DU_TEST.length} jeux, remplis au 🎲 comme pour une vraie fête.`,
    ...(lignes.length ? [`Effacé pour de bon :\n${lignes.join("\n")}`] : []),
    "Vos prestations, vos quiz et vos chansons ne sont pas touchés.",
  ].join("\n\n");
  if (!(await confirmer(message, { ok: "Créer", danger: lignes.length > 0 }))) return;
  btn.disabled = true;
  try {
    if (nbDemos(plan)) {
      status("test-status", "Effacement des anciennes démos…", true);
      const effacer = {};
      for (const [k, chemin] of [["shows", "shows"], ["manches", "manches"], ["quizzes", "quizzes"], ["mimes", "mimes"], ["playlists", "playlists"]]) {
        for (const id of plan[k]) effacer[`library/${chemin}/${id}`] = null;
      }
      // Une photo ou un extrait : effacé là où il est (l'autre effacement ne trouve rien).
      for (const id of plan.medias) { effacer[`library/images/${id}`] = null; effacer[`library/sounds/${id}`] = null; }
      await update(ref(db), effacer);
    }
    editShow(null);
    editing.id = TEST_PRESTATION;
    editing.origin = "test";
    $("show-child").value = TEST_FICHE.childName;
    $("show-title").value = TEST_TITRE;
    $("show-title").dataset.auto = "";
    $("show-age").value = String(TEST_FICHE.age);
    $("show-teams").value = String(TEST_FICHE.teams);
    $("show-date").value = isoDay();
    $("show-status").value = "publiee";
    $("show-notes").value = TEST_NOTES;
    renderCouleurs();
    editing.rounds = JEUX_DU_TEST.map((type) => ({ type, [JEU_OUVERT]: true }));
    refreshRounds();
    await toucherLesDes();
    // Tout replié, comme une prestation qu'on ouvre : une ligne par jeu.
    editing.rounds.forEach((r) => { if (r) r[JEU_OUVERT] = false; });
    refreshRounds();
    const ok = await enregistrerPrestation();
    status("test-status", ok ? `Créée : « ${TEST_TITRE} »${nbDemos(plan) ? ", anciennes démos effacées" : ""}.` : "Échec de l'enregistrement : vérifiez la connexion puis réessayez.", ok);
  } catch (err) {
    console.error(err);
    status("test-status", "Échec : vérifiez la connexion puis réessayez.");
    annonce("Échec de la prestation de test : vérifiez la connexion puis réessayez.");
  } finally {
    btn.disabled = false;
  }
};

/** Les jeux qui piochent dans les packs importés (leur carte a les dés « 🎨 Mes packs »). */
const JEUX_A_PACKS = ["quiz", "illustre", "express", "zoom", "flou", "quisuis"];
/** Identifiant de la prestation « 🧪 Test packs » d'un thème (une par thème, refaite à chaque fois). */
const PREFIXE_TEST_THEME = "test-packs-";
const idTestDuTheme = (theme) => `${PREFIXE_TEST_THEME}${cleTheme(theme).replace(/[^a-z0-9]/g, "") || "theme"}`;

/**
 * « 🎨 Prestation test d'un thème » (cedric, 25/10 : « une prestation test qui exploite exclusivement les packs, Mario,
 * dans tous les jeux où on peut extraire des séries ») : la fête de test (même âge, mêmes équipes, datée du jour), les
 * jeux à packs remplis par leur 🎲 « thème à 100 % » sur ce thème (un jeu sans rien sur ce thème est retiré), les autres
 * jeux au 🎲 habituel. Rien n'est effacé ; elle se refait à neuf (une par thème).
 */
function remplirThemesTest() {
  const menu = $("test-theme-choix");
  const avant = menu.value;
  const themes = themesExistants();
  menu.replaceChildren(...(themes.length ? themes.map((t) => h("option", { value: t, text: t })) : [h("option", { value: "", text: "Aucun thème : importez d'abord des packs" })]));
  if (themes.includes(avant)) menu.value = avant;
  $("test-theme").disabled = !themes.length;
}
$("test-theme-choix").addEventListener("focus", remplirThemesTest);
document.querySelector('#nav button[data-screen="settings"]').addEventListener("click", () => setTimeout(remplirThemesTest, 0));
$("test-theme").onclick = async () => {
  remplirThemesTest();
  const theme = $("test-theme-choix").value;
  if (!theme) return;
  const titre = `🧪 Test packs ${theme}`.slice(0, 120);
  if (!(await confirmer(`Créer « ${titre} » ?\n\nDatée d'aujourd'hui, ${plural(TEST_FICHE.teams, "équipe")}, ${TEST_FICHE.age} ans : le Quiz, le Quiz illustré, le Vrai ou Faux, le Zoom mystère, l'Image floue et Qui suis-je ? piochent seulement dans « ${theme} » ; les autres jeux gardent leur contenu habituel.\n\nRien n'est effacé.`, { ok: "Créer" }))) return;
  const btn = $("test-theme");
  btn.disabled = true;
  try {
    editShow(null);
    editing.id = idTestDuTheme(theme);
    editing.origin = "test";
    $("show-child").value = TEST_FICHE.childName;
    $("show-title").value = titre;
    $("show-title").dataset.auto = "";
    $("show-age").value = String(TEST_FICHE.age);
    $("show-teams").value = String(TEST_FICHE.teams);
    $("show-date").value = isoDay();
    $("show-status").value = "publiee";
    $("show-notes").value = `Prestation de TEST des packs « ${theme} » : les jeux à packs piochent seulement dans ce thème.`;
    renderCouleurs();
    editing.rounds = JEUX_DU_TEST.map((type) => ({ type, [JEU_OUVERT]: true }));
    refreshRounds();
    // Le thème tapé dans chaque champ « thème à 100 % » (les jeux une fois mis en forme par la carte).
    for (const r of editing.rounds) if (r && JEUX_A_PACKS.includes(r.type)) reglageDuDe(r, deUnique(r) ? "unique" : "recherche").terme = theme;
    refreshRounds();
    await toucherLesDes({ packs: true });
    // Un jeu à packs sans rien sur ce thème : retiré (jamais rempli d'autre chose).
    const rien = (r) => JEUX_A_PACKS.includes(r.type) && !((r.type === "quisuis" ? r.seriesMots : r.seriesQuiz) ?? []).some((x) => x?.pioche?.mode === "recherche");
    const retires = editing.rounds.filter((r) => r && rien(r)).map((r) => ROUND_TYPES[r.type] ?? r.type);
    editing.rounds = editing.rounds.filter((r) => r && !rien(r));
    editing.rounds.forEach((r) => { r[JEU_OUVERT] = false; });
    refreshRounds();
    const ok = await enregistrerPrestation();
    status("test-theme-status", ok ? `Créée : « ${titre} »${retires.length ? ` (rien sur « ${theme} » pour : ${retires.join(", ")} ; ces jeux sont retirés)` : ""}.`
      : "Échec de l'enregistrement : vérifiez la connexion puis réessayez.", ok);
  } catch (err) {
    console.error(err);
    status("test-theme-status", "Échec : vérifiez la connexion puis réessayez.");
  } finally {
    btn.disabled = false;
  }
};

// ---------- Mimes : paquets de cartes ----------

function renderMimes() {
  const box = $("mime-list");
  const list = copieEnTete(Object.entries(mimes).sort(([, a], [, b]) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));
  box.replaceChildren(...list.map(([id, d]) => {
    const cards = (d.cards ?? []).filter(Boolean);
    return h("div", { class: `item${copieRecente(id)}`, "data-deck": id },
      h("b", { text: d.title }),
      h("span", { text: `${cards.length} carte${cards.length > 1 ? "s" : ""} · tour de ${d.duration ?? MIME_TURN} s` }),
      h("span", { text: cards.slice(0, 8).map((c) => (c.imageId ? "📷" : c.image ?? c.word)).join(" ") }),
      h("div", { class: "row" },
        h("button", { class: "btn secondary", onclick: () => editDeck(id), text: "Éditer" }),
        h("button", { class: "btn secondary", onclick: () => rename(`library/mimes/${id}`, d.title, "du paquet"), text: "Renommer" }),
        h("button", { class: "btn secondary", onclick: () => copierDansBibliotheque("mimes", d), text: "Dupliquer" }),
        h("button", { class: "btn danger", onclick: () => deleteDeck(id), text: "Supprimer" })));
  }));
  if (!list.length) box.append(h("p", { class: "hint", text: "Aucun paquet pour l'instant : créez-en un en choisissant des images dans le catalogue." }));
}

let deck = null; // { id, cards: [{word, image, imageId}] }
let deckTheme = MIME_THEMES[0];
const sameCard = (a, b) => a.word.toLowerCase() === b.word.toLowerCase();

$("mime-new").onclick = () => editDeck(null);

/** Ouvre un paquet ; sans identifiant, un nouveau. */
function editDeck(id) {
  const d = id ? mimes[id] : {};
  deck = { id, cards: mimeCards(d.cards) };
  $("mime-edit-title").textContent = id ? d.title : "Nouvelle collection";
  $("mime-title").value = d.title ?? "";
  $("mime-duration").value = `${d.duration ?? MIME_TURN}`;
  $("mime-delete").hidden = !id;
  status("mime-status", "");
  show("mime-edit");
  renderDeck();
  histPaquet.depart();
}

const histPaquet = historique({
  ecran: $("screen-mime-edit"),
  precedent: pagePrecedente,
  capturer: () => ({ cards: deck?.cards ?? [], title: $("mime-title").value, duration: $("mime-duration").value }),
  restaurer: (e) => {
    if (deck) deck.cards = e.cards;
    $("mime-title").value = e.title;
    $("mime-duration").value = e.duration;
    renderDeck();
  },
});

function toggleCard(card) {
  const i = deck.cards.findIndex((c) => sameCard(c, card));
  if (i >= 0) deck.cards.splice(i, 1);
  else deck.cards.push(...mimeCards([card]));
  renderDeck();
}

/** Vignette d'une photo de la bibliothèque : depuis le cache, sinon lue une fois dans la base. */
function photoBibliotheque(id, props = {}) {
  const img = h("img", { alt: "", ...props });
  if (imageCache[id]) img.src = imageCache[id];
  else get(ref(db, `library/images/${id}`)).then((snap) => {
    if (typeof snap.val() === "string") { imageCache[id] = snap.val(); img.src = snap.val(); }
  }).catch(() => {});
  return img;
}

function cardButton(card, on, onclick, extra = null) {
  return h("button", { type: "button", class: `mime-card${on ? " on" : ""}`, onclick, "data-word": card.word },
    // Photo à soi : elle remplace l'émoji, sur la TV comme ici.
    card.imageId ? photoBibliotheque(card.imageId, { class: "mime-photo", alt: card.word }) : h("span", { class: "emoji", text: card.image ?? "🎭" }),
    h("span", { class: "word", text: card.word }), extra);
}

function renderDeck() {
  $("mime-count").textContent = deck.cards.length;
  $("mime-picked").replaceChildren(...deck.cards.map((c) =>
    cardButton(c, false, () => toggleCard(c), h("span", { class: "remove", text: "✕" }))));
  if (!deck.cards.length) $("mime-picked").append(h("p", { class: "hint small", text: "Aucune carte : touchez des images du catalogue ci-dessous." }));
  const themeCards = MIME_CATALOG.filter((c) => c.theme === deckTheme);
  const allOn = themeCards.every((c) => deck.cards.some((x) => sameCard(x, c)));
  $("mime-themes").replaceChildren(
    ...MIME_THEMES.map((t) => h("button", { type: "button", class: `chip${t === deckTheme ? " active" : ""}`, onclick: () => { deckTheme = t; renderDeck(); }, text: t })),
    h("button", { type: "button", class: "chip", onclick: () => {
      themeCards.forEach((c) => { if (allOn === deck.cards.some((x) => sameCard(x, c))) toggleCard(c); });
    }, text: allOn ? "Tout retirer de ce thème" : "Tout ce thème" }));
  $("mime-catalog").replaceChildren(...themeCards.map((c) =>
    cardButton(c, deck.cards.some((x) => sameCard(x, c)), () => toggleCard(c))));
}

/**
 * Carte à soi : un mot, un émoji et/ou une photo. Une photo donnée pour un mot déjà dans le paquet devient la photo
 * de cette carte. Rend le message à afficher.
 */
async function addOwnCard(word, image, file) {
  word = word.trim().slice(0, 40);
  const imageId = file ? await storeChoiceImage(file) : null;
  const card = { word, ...(image ? { image: image.slice(0, 16) } : {}), ...(imageId ? { imageId } : {}) };
  const same = deck.cards.find((c) => sameCard(c, card));
  if (same && !imageId) return `« ${word} » est déjà dans le paquet.`;
  if (same) { same.imageId = imageId; return `Photo ajoutée à « ${same.word} ».`; }
  deck.cards.push(card);
  return "";
}

$("mime-photo").onchange = (e) => {
  const f = e.target.files?.[0];
  $("mime-photo-btn").classList.toggle("chosen", !!f);
  $("mime-photo-label").textContent = f ? "📷 Photo choisie ✓" : "📷 Photo…";
  if (f && !$("mime-word").value.trim()) $("mime-word").value = wordFromImage(f.name);
};

$("mime-custom").onsubmit = async (e) => {
  e.preventDefault();
  const word = $("mime-word").value.trim();
  const file = $("mime-photo").files?.[0] ?? null;
  if (!word) return status("mime-status", "Écrivez le mot de la carte.");
  try {
    status("mime-status", await addOwnCard(word, $("mime-emoji").value.trim(), file));
  } catch (err) {
    console.error(err);
    return status("mime-status", "Photo refusée : essayez une autre image (JPEG ou PNG).");
  }
  e.target.reset();
  $("mime-photo-btn").classList.remove("chosen");
  $("mime-photo-label").textContent = "📷 Photo…";
  renderDeck();
  histPaquet.noter();
  $("mime-word").focus();
};

// Plusieurs photos d'un coup : une carte par photo, le mot tiré du nom du fichier (« tour-eiffel.jpg » → « Tour eiffel »).
$("mime-photos").onchange = async (e) => {
  const files = [...(e.target.files ?? [])];
  e.target.value = "";
  let n = 0;
  for (const [k, f] of files.entries()) {
    status("mime-status", `Photo ${k + 1} / ${files.length}…`, true);
    try { await addOwnCard(wordFromImage(f.name) || `Photo ${deck.cards.length + 1}`, "", f); n++; } catch (err) { console.error(err); }
  }
  renderDeck();
  histPaquet.noter();
  status("mime-status", n === files.length ? `${plural(n, "photo")} ajoutée${n > 1 ? "s" : ""}. Pensez à enregistrer le paquet.`
    : `${n} photo${n > 1 ? "s" : ""} sur ${files.length} ajoutée${n > 1 ? "s" : ""} : les autres sont illisibles (JPEG ou PNG).`, n > 0);
};

$("mime-save").onclick = async () => {
  const title = $("mime-title").value.trim();
  if (!title) return status("mime-status", "Donnez un nom au paquet.");
  if (!deck.cards.length) return status("mime-status", "Choisissez au moins une carte.");
  const id = deck.id ?? push(ref(db, "library/mimes")).key;
  $("mime-save").disabled = true;
  try {
    await set(ref(db, `library/mimes/${id}`), {
      title, duration: Number($("mime-duration").value), cards: deck.cards,
      createdAt: mimes[id]?.createdAt ?? Date.now(), updatedAt: serverTimestamp(),
    });
    deck.id = id;
    histPaquet.enregistre();
    $("mime-delete").hidden = false;
    $("mime-edit-title").textContent = title;
    status("mime-status", `Enregistré : ${deck.cards.length} carte${deck.cards.length > 1 ? "s" : ""}. Ajoutez-le à une prestation comme manche « Mimes ».`, true);
  } catch (err) {
    console.error(err);
    status("mime-status", "Enregistrement refusé : vérifiez Internet ou reconnectez-vous.");
  } finally {
    $("mime-save").disabled = false;
  }
};

$("mime-delete").onclick = async () => {
  if (!deck?.id || !await deleteDeck(deck.id)) return;
  histPaquet.abandonner();
  show("mimes");
};

async function deleteDeck(id) {
  const used = Object.values(shows).filter((s) => (s.rounds ?? []).some((r) => r?.deckId === id)).map(showTitle);
  const warning = used.length ? `\n\nAttention, il est utilisé par : ${used.join(", ")}.` : "";
  if (!(await confirmer(`Supprimer le paquet « ${mimes[id]?.title ?? ""} » ?${warning}`, { ok: "Supprimer", danger: true }))) return false;
  await set(ref(db, `library/mimes/${id}`), null);
  return true;
}

// ---------- Blind test : playlists d'extraits musicaux ----------

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

function renderPlaylists() {
  const box = $("playlist-list");
  const list = copieEnTete(Object.entries(playlists).filter(([, p]) => !isStatuesList(p)).sort(([, a], [, b]) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));
  box.replaceChildren(...list.map(([id, p]) => {
    const tracks = playableTracks(p);
    return h("div", { class: `item${copieRecente(id)}`, "data-playlist": id },
      h("b", { text: p.title }),
      h("span", { text: `${tracks.length} morceau${tracks.length > 1 ? "x" : ""} · extraits de ${p.duration ?? BLIND_SEC} s` }),
      h("span", { text: tracks.slice(0, 5).map((t) => t.title).join(" · ") + (tracks.length > 5 ? " …" : "") }),
      h("div", { class: "row" },
        h("button", { class: "btn secondary", onclick: () => editPlaylist(id), text: "Éditer" }),
        h("button", { class: "btn secondary", onclick: () => rename(`library/playlists/${id}`, p.title, "de la playlist"), text: "Renommer" }),
        h("button", { class: "btn secondary", onclick: () => copierDansBibliotheque("playlists", playlists[id]), text: "Dupliquer" }),
        h("button", { class: "btn danger", onclick: () => deletePlaylist(id), text: "Supprimer" })));
  }));
  if (!list.length) box.append(h("p", { class: "hint", text: "Aucune playlist pour l'instant : créez-en une avec vos fichiers musicaux." }));
}

/** Ligne d'une chanson dans une playlist (ajout depuis la bibliothèque) : titre, réglages, playlists où elle est. */
function songRow(song, tools) {
  const meta = [
    song.artist, `${song.buzz} s pour buzzer`, song.refrainId ? "refrain réglé ✓" : "pas encore de refrain",
    song.lrc ? "paroles ✓" : "",
    song.lists.length ? `dans : ${song.lists.map((l) => l.title).join(", ")}` : "",
  ].filter(Boolean).join(" · ");
  return h("div", { class: "song", "data-song": song.audioId },
    h("div", { class: "song-name" }, h("b", { text: song.title }), h("span", { class: "song-meta", text: meta })),
    h("div", { class: "song-tools" }, ...tools));
}

/** Bibliothèque des sons : on y regarde les chansons supprimées (pour les remettre) au lieu des autres. */
let voirRetirees = false;
/** Chansons cochées (cedric, 21/10 : sélection simple ou multiple, puis « Supprimer »), par clé de chanson. */
const choisies = new Set();
/** Chansons trouvées par la recherche (toutes, pas seulement les affichées), dans l'ordre de la liste. */
let chansonsTrouvees = [];
/** Dernière case cochée : Maj + clic coche tout jusqu'à elle. */
let dernierCoche = null;
const cleChanson = (x) => x.id ?? `a:${x.audioId}`;

/** Ligne d'une chanson de la bibliothèque, de gauche à droite : case, pochette, artiste, titre, paroles, moments. */
function ligneChanson(x, i) {
  const cle = cleChanson(x);
  const vide = !x.imageId && !x.lrc;
  const ligne = h("div", { class: `song song-ligne${choisies.has(cle) ? " choisie" : ""}${vide ? " incomplete" : ""}`, "data-song": x.audioId, "data-cle": cle },
    h("input", {
      type: "checkbox", class: "song-check", checked: choisies.has(cle), "aria-label": `Sélectionner « ${x.title} »`,
      onclick: (e) => cocherChanson(i, e.target.checked, e.shiftKey),
    }),
    cellPochette(x),
    h("span", { class: "song-artiste", text: x.artist || "—" }),
    h("b", { class: "song-titre", text: x.title }),
    cellParoles(x),
    cellMoments(x),
    h("span", { class: "song-alertes" },
      // Ni pochette ni paroles : la révélation du blind test sera pauvre (titre et disque seulement), mais jouable.
      vide ? h("span", { class: "song-alerte", role: "img", "aria-label": "Ni pochette ni paroles", title: "Ni pochette ni paroles : au blind test, la TV montrera seulement le titre et le disque. Ajoutez une pochette ou un fichier .lrc.", text: "⚠" }) : null,
      // Chanson entière pas encore en ligne (rangée avant le 21/10) : ses curseurs attendent son MP3.
      entieres.get(x.id) === false ? h("span", { class: "song-nuage", role: "img", "aria-label": "À redéposer", title: "À redéposer une fois : la chanson entière n'est pas encore en ligne, ses curseurs « Régler » attendent son MP3. Depuis un PC qui a le MP3 : « Ajouter des chansons… ».", text: "☁" }) : null),
    // Les paroles défilent dans une petite fenêtre pendant l'écoute (cedric, 23/10).
    h("div", { class: "song-tools" },
      boutonEcoute({ class: "btn secondary", title: "Écouter l'extrait du buzz", text: "▶ Extrait" }, (b) => listen(ecouteRangee(x), false, b, () => parolesFlottantes(x))),
      x.refrainId ? boutonEcoute({ class: "btn secondary", title: "Écouter le refrain", text: "▶ Refrain" }, (b) => listen(ecouteRangee(x), true, b, () => parolesFlottantes(x))) : null,
      // Supprimer une seule chanson, sans passer par les cases (cedric, 23/10).
      h("button", { type: "button", class: "btn secondary song-suppr", title: "Supprimer cette chanson", "aria-label": `Supprimer « ${x.title} »`, onclick: () => supprimerChansons([x]), text: "🗑" })));
  return ligne;
}

/** Extrait et refrain rangés d'une chanson de la liste des sons, avec leurs moments dans la chanson. */
const ecouteRangee = (x) => ({ audioId: x.audioId, refrainId: x.refrainId, title: x.title, start: x.start, refrain: x.refrain });

/** Pochette : l'image tirée du MP3, ou une case vide où cliquer pour en choisir une. */
function cellPochette(x) {
  const input = h("input", {
    type: "file", accept: "image/*", hidden: true,
    onchange: async (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      try {
        const id = await rangerPochette(f);
        await majChanson(x, { imageId: id });
        status("song-status", `Pochette de « ${x.title} » enregistrée.`, true);
      } catch (err) {
        console.error(err);
        status("song-status", "Pochette refusée : essayez une autre image (JPEG ou PNG), ou vérifiez Internet.");
      }
    },
  });
  const img = h("img", { alt: "", hidden: !x.imageId });
  if (x.imageId) {
    const id = x.imageId;
    if (imageCache[id]) img.src = imageCache[id];
    else get(ref(db, `library/images/${id}`)).then((snap) => { if (typeof snap.val() === "string") { imageCache[id] = snap.val(); img.src = snap.val(); } }).catch(() => {});
  }
  return h("label", { class: `song-pochette${x.imageId ? "" : " vide"}`, title: x.imageId ? "Changer la pochette" : "Pas de pochette dans le MP3 : cliquez pour en choisir une" },
    img, x.imageId ? null : h("span", { text: "＋" }), input);
}

/** Paroles : ✓ quand le fichier .lrc est là, sinon une case où cliquer pour l'ajouter. */
function cellParoles(x) {
  const input = h("input", {
    type: "file", accept: ".lrc,text/plain", hidden: true,
    onchange: async (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      try {
        await attacherParoles(x, (await f.text()).slice(0, MAX_LRC));
        status("song-status", `Paroles de « ${x.title} » enregistrées.`, true);
      } catch (err) {
        console.error(err);
        status("song-status", err.message === "vide" ? `« ${f.name} » ne contient pas de paroles minutées (fichier .lrc attendu).` : "Paroles refusées : vérifiez Internet ou reconnectez-vous.");
      }
    },
  });
  const label = h("label", { class: `song-paroles${x.lrc ? " ok" : ""}`, title: x.lrc ? "Paroles incluses : cliquez pour remplacer le fichier .lrc" : "Cliquez pour ajouter le fichier .lrc des paroles" },
    x.lrc ? "✓ Paroles" : "＋ Paroles (.lrc)", input);
  if (!x.lrc) return label;
  // Un .lrc mis par erreur se retire (cedric, 22/10).
  return h("span", { class: "song-paroles-cellule" }, label,
    h("button", { type: "button", class: "icon song-paroles-retirer", title: "Retirer les paroles", "aria-label": `Retirer les paroles de « ${x.title} »`, onclick: () => retirerParoles([x]), text: "✕" }));
}

/**
 * Retire les paroles de chansons de la bibliothèque (cedric, 22/10 : un .lrc mis par erreur) : le fichier .lrc rangé et
 * les paroles du refrain sont effacés, les playlists qui ont ces chansons suivent. Le début et le hook ne bougent pas.
 */
async function retirerParoles(liste) {
  liste = liste.filter((x) => x.id && x.lrc);
  if (!liste.length) return;
  const nom = liste.length === 1 ? `de « ${liste[0].title} »` : `de ces ${liste.length} chansons`;
  if (!(await confirmer(`Retirer les paroles ${nom} ?\n\nVous pourrez ajouter le bon fichier .lrc ensuite.`, { ok: "Retirer les paroles", danger: true }))) return;
  try {
    const chemins = {};
    liste.forEach((x) => Object.assign(chemins, cheminsChanson(x, { lrc: null, paroles: null })[1], { [`library/lyrics/${x.id}`]: null }));
    await update(ref(db), chemins);
    await followSongs(liste.map((x) => ({ songId: x.id, song: { ...x, lrc: false, paroles: "" }, audioIds: [x.audioId] })), null);
    status("song-status", liste.length === 1 ? `Paroles de « ${liste[0].title} » retirées.` : `Paroles de ${liste.length} chansons retirées.`, true);
  } catch (err) {
    console.error(err);
    status("song-status", "Refusé : vérifiez Internet ou reconnectez-vous.");
  }
}

/**
 * Moments du blind test (début, hook) : une chanson rangée est réglée d'office (cedric, 21/10 : début 2 s avant les
 * premiers mots chantés, hook trouvé dans les paroles). Un clic ouvre ses réglages.
 */
function cellMoments(x) {
  const hook = Number.isFinite(x.refrain) ? ` à ${mmss(x.refrain)}` : "";
  return h("button", {
    type: "button", class: `song-moments${x.refrainId ? " ok" : ""}`,
    title: x.refrainId ? `Début à ${mmss(x.start ?? 0)}, hook${hook} ${x.auto ? "trouvé automatiquement" : "réglé à la main"} : cliquez pour changer le réglage` : "Pas encore de hook : cliquez pour régler",
    onclick: (e) => {
      ancreChanson = { cle: cleChanson(x), haut: e.currentTarget.closest(".song-ligne").getBoundingClientRect().top };
      editSongs([x]);
    },
    text: x.refrainId ? "⏱ Réglé ✓" : "⏱ Régler",
  });
}

/** Coche ou décoche la chanson [i] de la liste ; avec Maj, toutes celles depuis la dernière case cochée. */
function cocherChanson(i, coche, plage) {
  const [a, b] = plage && dernierCoche != null ? [Math.min(dernierCoche, i), Math.max(dernierCoche, i)] : [i, i];
  for (let k = a; k <= b; k++) {
    const x = chansonsTrouvees[k];
    if (!x) continue;
    if (coche) choisies.add(cleChanson(x)); else choisies.delete(cleChanson(x));
  }
  dernierCoche = i;
  renderSongs();
}

/** Coche toutes les chansons trouvées (Ctrl + A), ou les décoche. */
function cocherTout(coche) {
  if (coche) chansonsTrouvees.forEach((x) => choisies.add(cleChanson(x))); else choisies.clear();
  dernierCoche = null;
  renderSongs();
}

/** Barre de la sélection : tout cocher, combien de chansons cochées, désélectionner, supprimer. */
function renderSelection(total) {
  const n = chansonsTrouvees.filter((x) => choisies.has(cleChanson(x))).length;
  const avecParoles = chansonsTrouvees.filter((x) => choisies.has(cleChanson(x)) && x.id && x.lrc).length;
  const tout = h("input", { type: "checkbox", "aria-label": "Tout sélectionner", checked: n > 0 && n === chansonsTrouvees.length, onclick: (e) => cocherTout(e.target.checked) });
  if (n > 0 && n < chansonsTrouvees.length) tout.indeterminate = true;
  $("song-barre").hidden = voirRetirees || !total;
  $("song-barre").replaceChildren(
    h("label", { class: "inline song-tout" }, tout, n ? `${n} sélectionnée${n > 1 ? "s" : ""}` : "Tout sélectionner"),
    n ? h("button", { type: "button", class: "btn small secondary", onclick: () => cocherTout(false), text: "Désélectionner" }) : "",
    h("button", { type: "button", class: "btn small danger", disabled: !n, onclick: () => supprimerChansons(), text: n ? `🗑 Supprimer (${n})` : "🗑 Supprimer" }),
    avecParoles ? h("button", { type: "button", class: "btn small secondary", onclick: () => retirerParoles(chansonsTrouvees.filter((x) => choisies.has(cleChanson(x)))), text: `Retirer les paroles (${avecParoles})` }) : "",
    h("span", { class: "hint small", text: "Maj + clic : plusieurs d'un coup · Ctrl + A : tout · Suppr : supprimer" }));
}

/**
 * Ordre de la liste des sons (cedric, 22/10) : alphabétique par artiste (la première colonne), puis par titre ; un clic
 * sur l'en-tête « Titre » range par titre. Les chansons sans artiste viennent à la fin.
 */
let triSons = "artiste";
const alpha = (a, b) => a.localeCompare(b, "fr", { sensitivity: "base", numeric: true });
function trierSons(liste) {
  const cles = (x) => (triSons === "titre" ? [x.title, x.artist ?? ""] : [x.artist ?? "", x.title]);
  return [...liste].sort((a, b) => {
    const [a1, a2] = cles(a);
    const [b1, b2] = cles(b);
    if (!a1.trim() !== !b1.trim()) return a1.trim() ? -1 : 1;
    return alpha(a1, b1) || alpha(a2, b2);
  });
}
const enteteTri = (tri, nom) => h("button", {
  type: "button", class: `song-tri${triSons === tri ? " actif" : ""}`, "data-tri": tri, title: `Ranger par ${nom.toLowerCase()} (A → Z)`,
  onclick: () => { triSons = tri; renderSongs(); }, text: `${nom}${triSons === tri ? " ▾" : ""}`,
});

/** Bibliothèque des sons (menu Bibliothèque, onglet Sons) : une ligne par chanson, recherche, sélection, suppression. */
function renderSongs() {
  const retirees = songsRetirees(songs);
  if (!retirees.length) voirRetirees = false;
  $("song-retirees").hidden = !retirees.length;
  $("song-retirees").textContent = voirRetirees ? "← Toutes les chansons" : `🗑 Supprimées (${retirees.length})`;
  const all = voirRetirees ? retirees : trierSons(songList(songs, playlists, isStatuesList));
  const found = parPertinence(all.filter((x) => songMatches(x, $("song-search").value)), $("song-search").value, (x) => [x.title, x.artist], (x) => x.lists.map((l) => l.title));
  chansonsTrouvees = voirRetirees ? [] : found;
  // Une chanson qui n'existe plus n'est plus cochée.
  const cles = new Set(all.map(cleChanson));
  [...choisies].forEach((k) => { if (!cles.has(k)) choisies.delete(k); });
  $("song-count").textContent = found.length === all.length ? `${all.length} chanson${all.length > 1 ? "s" : ""}${voirRetirees ? ` supprimée${all.length > 1 ? "s" : ""}` : ""}` : `${found.length} sur ${all.length}`;
  renderSelection(all.length);
  $("song-list").replaceChildren(...(voirRetirees ? (all.length > 1 ? [h("div", { class: "song-effacer-tout" },
    h("button", { type: "button", class: "btn small danger", onclick: () => effacerPourDeBon(all), text: `Tout effacer pour de bon (${all.length})` }),
    h("span", { class: "hint small", text: "Effacées pour de bon, les chansons libèrent leur place en ligne et ne peuvent plus être remises." }))] : []) : found.length ? [h("div", { class: "song song-entete" },
    h("span"), h("span", { text: "Pochette" }), enteteTri("artiste", "Artiste"), enteteTri("titre", "Titre"), h("span", { text: "Paroles" }), h("span", { text: "Moments" }), h("span"), h("span"))] : []),
  // Toutes les chansons, sans limite ni bouton « Tout afficher » : la recherche filtre (cedric, 22/10).
  ...found.map((x, i) => (voirRetirees
    ? h("div", { class: "song", "data-song": x.id },
      h("div", { class: "song-name" }, h("b", { text: x.title }), h("span", { class: "song-meta", text: x.artist })),
      h("div", { class: "song-tools" },
        h("button", { type: "button", class: "btn", onclick: () => remettreChanson(x), text: "Remettre" }),
        h("button", { type: "button", class: "btn danger", onclick: () => effacerPourDeBon([x]), text: "Effacer pour de bon" })))
    : ligneChanson(x, i))));
  if (!all.length && !voirRetirees) {
    $("song-list").append(h("p", { class: "hint", text: retirees.length ? "Toutes vos chansons sont supprimées : « 🗑 Supprimées » pour les remettre."
      : "Aucune chanson pour l'instant : ajoutez vos fichiers musicaux." }));
  }
  // Chansons rangées avant le 21/10 : leur chanson entière n'est pas en ligne, un redépôt suffit (cedric, 21/10).
  const aRedeposer = voirRetirees ? 0 : all.filter((x) => entieres.get(x.id) === false).length;
  $("song-entieres").hidden = !aRedeposer;
  $("song-entieres").textContent = aRedeposer
    ? `☁ ${aRedeposer > 1 ? `${aRedeposer} chansons ne sont pas encore entières en ligne` : "Une chanson n'est pas encore entière en ligne"} : leurs curseurs « Régler » attendent leur MP3. Redéposez-les une seule fois depuis un PC qui a les MP3 : « Ajouter des chansons… », puis Ctrl + A sur les MP3 et les .lrc.`
    : "";
  if (!voirRetirees) verifierEntieres(all);
}
$("song-search").oninput = () => { dernierCoche = null; renderSongs(); };
$("song-retirees").onclick = () => { voirRetirees = !voirRetirees; renderSongs(); };
// Raccourcis de la liste des sons : Ctrl + A coche tout, Échap décoche, Suppr supprime la sélection.
document.addEventListener("keydown", (e) => {
  if ($("song-list").offsetParent === null || voirRetirees) return;
  if (e.target.closest?.("input:not([type=checkbox]), textarea, select, [contenteditable]")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); cocherTout(true); }
  else if (e.key === "Escape" && choisies.size) cocherTout(false);
  else if (e.key === "Delete" && choisies.size) { e.preventDefault(); supprimerChansons(); }
});

/** Écritures d'une chanson : celle de la bibliothèque, ou un ancien morceau de playlist qu'on y range au passage. */
function cheminsChanson(x, champs) {
  if (x.id && songs[x.id]) return [x.id, Object.fromEntries(Object.entries({ ...champs, updatedAt: serverTimestamp() }).map(([k, v]) => [`library/songs/${x.id}/${k}`, v]))];
  const id = push(ref(db, "library/songs")).key;
  const neuve = {
    title: x.title.slice(0, 80), audioId: x.audioId, buzz: x.buzz, createdAt: Date.now(), updatedAt: serverTimestamp(),
    ...(x.artist ? { artist: x.artist.slice(0, 80) } : {}), ...(x.imageId ? { imageId: x.imageId } : {}), ...(x.refrainId ? { refrainId: x.refrainId } : {}),
    ...Object.fromEntries(Object.entries(champs).filter(([, v]) => v != null)),
  };
  return [id, { [`library/songs/${id}`]: neuve }];
}

/** Change une chanson de la bibliothèque (pochette, paroles, moments) ; les playlists qui l'ont suivent. */
async function majChanson(x, champs) {
  const [id, chemins] = cheminsChanson(x, champs);
  await update(ref(db), chemins);
  const song = { ...x, ...Object.fromEntries(Object.entries(champs).map(([k, v]) => [k, v ?? undefined])), id };
  await followSongs([{ songId: id, song, audioIds: [x.audioId] }], null);
  return id;
}

/**
 * Paroles d'une chanson (fichier .lrc) : le fichier entier est rangé (library/lyrics/<chanson>), et le passage de
 * l'extrait du refrain est gardé dans la chanson pour la TV.
 */
async function attacherParoles(x, texte) {
  const lignes = lireLrc(texte);
  if (!lignes.some((l) => l.text)) throw new Error("vide");
  const paroles = x.refrainId && Number.isFinite(x.refrain) ? parolesDuRefrain(lignes, x.refrain, REFRAIN_SEC) : "";
  const [id, chemins] = cheminsChanson(x, { lrc: true, paroles: paroles || null });
  await update(ref(db), { ...chemins, [`library/lyrics/${id}`]: texte });
  await followSongs([{ songId: id, song: { ...x, id, lrc: true, paroles }, audioIds: [x.audioId] }], null);
}

/**
 * Supprime les chansons cochées de la bibliothèque (cedric, 21/10), après confirmation ; toute la bibliothèque cochée :
 * un avertissement clair. Les playlists qui les ont les gardent, aucun extrait n'est effacé, et « 🗑 Supprimées »
 * permet de les remettre.
 */
async function supprimerChansons(seules = null) {
  const toutes = songList(songs, playlists, isStatuesList);
  const liste = seules ?? toutes.filter((x) => choisies.has(cleChanson(x)));
  if (!liste.length) return;
  const nom = liste.length === 1 ? `« ${liste[0].title} »` : `ces ${liste.length} chansons`;
  const message = liste.length === toutes.length && toutes.length > 1
    ? `Attention : cette action va supprimer tous les morceaux de votre bibliothèque (${toutes.length} chansons).\n\nLes playlists déjà faites les gardent. Vous pourrez les remettre depuis « 🗑 Supprimées ».`
    : `Supprimer ${nom} de la bibliothèque des sons ?\n\nLes playlists déjà faites les gardent. Vous pourrez les remettre depuis « 🗑 Supprimées ».`;
  if (!(await confirmer(message, { ok: "Supprimer", danger: true }))) return;
  try {
    const chemins = {};
    liste.forEach((x) => Object.assign(chemins, cheminsChanson(x, { retiree: true })[1]));
    await update(ref(db), chemins);
    if (seules) seules.forEach((x) => choisies.delete(cleChanson(x)));
    else choisies.clear();
    dernierCoche = null;
    status("song-status", liste.length === 1 ? `« ${liste[0].title} » est supprimée de la bibliothèque.` : `${liste.length} chansons supprimées de la bibliothèque.`, true);
  } catch (err) {
    console.error(err);
    status("song-status", "Suppression refusée : vérifiez Internet ou reconnectez-vous.");
  }
}

/**
 * « Effacer pour de bon » des chansons supprimées (cedric, 21/10) : en ligne, la chanson, sa chanson entière et ses
 * paroles sont effacées, et ses extraits aussi, sauf ceux qu'une playlist, une manche, une prestation ou un quiz utilise
 * encore. Le fichier gardé sur ce PC est oublié. On ne peut plus la remettre. Sa pochette reste dans Bibliothèque ›
 * Images › 💿 Pochettes (cedric, 22/10) : elle y reçoit sa fiche, dans la même écriture.
 */
async function effacerPourDeBon(liste) {
  if (!liste.length) return;
  const nom = liste.length === 1 ? `« ${liste[0].title} »` : `ces ${liste.length} chansons`;
  const avecPochette = liste.some((x) => songs[x.id]?.imageId);
  if (!(await confirmer(`Effacer ${nom} pour de bon ?\n\nLa chanson entière, les paroles et les extraits sont effacés en ligne (sauf les extraits qu'une playlist utilise encore). On ne pourra plus ${liste.length === 1 ? "la" : "les"} remettre.${avecPochette ? `\n\n${liste.length === 1 ? "Sa pochette reste" : "Les pochettes restent"} dans Bibliothèque › Images › 💿 Pochettes.` : ""}`, { ok: "Effacer pour de bon", danger: true }))) return;
  const ids = new Set(liste.map((x) => x.id));
  // Extraits encore utilisés ailleurs : toute empreinte d'extrait citée par une playlist, une manche, une prestation,
  // un quiz ou une autre chanson (en trop, un extrait reste ; jamais l'inverse).
  const utilises = new Set(JSON.stringify([playlists, manches, shows, quizzes]).match(/[0-9a-f]{16}/g) ?? []);
  Object.entries(songs).forEach(([id, x]) => { if (!ids.has(id)) [x?.audioId, x?.refrainId].forEach((a) => a && utilises.add(a)); });
  const chemins = {};
  liste.forEach((x) => {
    const song = songs[x.id] ?? {};
    Object.assign(chemins, { [`library/songs/${x.id}`]: null, [`library/lyrics/${x.id}`]: null, [`library/entieres/${x.id}`]: null });
    [song.audioId, song.refrainId].filter((a) => a && !utilises.has(a)).forEach((a) => { chemins[`library/sounds/${a}`] = null; });
    Object.assign(chemins, fichePochetteGardee(song, chemins));
  });
  // Les playlists qui gardent un ancien morceau de ces chansons (sans numéro de chanson) le marquent, pour qu'elles ne
  // reviennent pas dans la liste (cedric, 22/10). Une playlist à la fois : une ancienne refusée ne bloque pas les autres.
  const marques = {};
  liste.forEach((x) => Object.entries(marquerEffacees(x.id, songs[x.id]?.audioId, playlists, serverTimestamp(), isStatuesList))
    .forEach(([chemin, v]) => { (marques[chemin.split("/")[2]] ??= {})[chemin] = v; }));
  try {
    for (const groupe of Object.values(marques)) await update(ref(db), groupe).catch((err) => console.error(err));
    await update(ref(db), chemins);
    for (const x of liste) { sourcesLocales.delete(x.id); await oublierFichier(x.id); }
    status("song-status", liste.length === 1 ? `« ${liste[0].title} » est effacée pour de bon.` : `${liste.length} chansons effacées pour de bon.`, true);
  } catch (err) {
    console.error(err);
    status("song-status", "Effacement refusé : vérifiez Internet ou reconnectez-vous.");
  }
}

/**
 * Pochette d'une chanson effacée pour de bon : sa fiche « Pochettes » (nom « Artiste – Titre », mots-clés), pour qu'elle
 * reste dans la rubrique. Une fiche déjà là garde son nom ; sans catégorie, elle passe dans « Pochettes » ; rangée par
 * Sarah dans une de ses catégories, elle ne bouge pas.
 */
function fichePochetteGardee(song, chemins) {
  const id = song.imageId;
  if (!/^[0-9a-f]{16}$/.test(id ?? "") || `library/medias/${id}` in chemins) return {};
  const avant = medias[id];
  if (avant?.cat) return {};
  if (avant) return { [`library/medias/${id}/cat`]: POCHETTES, [`library/medias/${id}/updatedAt`]: serverTimestamp() };
  const f = ficheImage({ nom: nomPochette(song) || "Pochette", cat: POCHETTES, tags: [song.artist, song.title].filter(Boolean) });
  return { [`library/medias/${id}`]: { ...f, updatedAt: serverTimestamp() } };
}

/** Remet une chanson supprimée dans la bibliothèque des sons. */
async function remettreChanson(x) {
  try {
    await update(ref(db, `library/songs/${x.id}`), { retiree: null, updatedAt: serverTimestamp() });
    status("song-status", `« ${x.title} » est remise dans la bibliothèque.`, true);
  } catch (err) {
    console.error(err);
    status("song-status", "Refusé : vérifiez Internet ou reconnectez-vous.");
  }
}
/**
 * « Ajouter des chansons… » (cedric, 21/10) : il sélectionne toute sa bibliothèque d'un coup (MP3 et .lrc mêlés) ; chaque
 * chanson se range seule, avec ses paroles (le .lrc du même nom) et la pochette de son MP3, sans rien à cliquer de plus.
 * L'écran des réglages montre l'avancement, puis la liste des sons revient avec le bilan. Chaque chanson est réglée
 * d'office (son refrain trouvé dans les paroles) ; « ⏱ Réglé ✓ » permet de changer le réglage.
 */
$("song-files").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  editSongs([]);
  const bilan = await addFiles(files);
  // Envoi coupé (Internet) : on reste sur l'écran, « Enregistrer » reprend là où il s'est arrêté.
  if (playlist.tracks.some((t) => t.file) && !(await enregistrerPlaylist())) return;
  const range = $("playlist-status").textContent;
  show("library", { force: true });
  status("song-status", [bilan, playlist.tracks.length ? range : ""].filter(Boolean).join(" "), !/illisible/.test(range));
};

/** Réglages de chansons de la bibliothèque, dans l'écran des playlists (sans nom ni barème). */
function editSongs(list) {
  // Une seule chanson (« Régler… ») : l'écran porte son nom.
  editPlaylist(null, { use: "songs", single: list.length === 1, title: list.length === 1 ? `Réglages de « ${list[0].title} »` : "Bibliothèque des sons", tracks: list.map((x) => ({ ...trackFromSong(x), start: x.start, refrain: x.refrain, length: x.length, lrc: x.lrc, auto: x.auto })) });
}

/** Playlist : chercher une chanson dans la bibliothèque et l'ajouter avec ses réglages. */
function renderLibPicker() {
  const inList = new Set(playlist?.tracks.map((t) => t.audioId).filter(Boolean));
  const all = songList(songs, playlists, isStatuesList);
  const found = parPertinence(all.filter((x) => songMatches(x, $("playlist-lib-search").value)), $("playlist-lib-search").value, (x) => [x.title, x.artist], (x) => x.lists.map((l) => l.title));
  $("playlist-lib-count").textContent = `${found.length} chanson${found.length > 1 ? "s" : ""}`;
  $("playlist-lib-list").replaceChildren(...found.slice(0, 40).map((x) => songRow(x, [
    boutonEcoute({ class: "btn secondary icon-ecoute", title: "Écouter l'extrait", text: "▶" }, (b) => listen({ audioId: x.audioId, title: x.title, start: x.start }, false, b, () => parolesFlottantes(x, "screen-playlist-edit"))),
    h("button", {
      type: "button", class: "btn", disabled: inList.has(x.audioId), text: inList.has(x.audioId) ? "Déjà dedans" : "Ajouter",
      onclick: () => {
        playlist.tracks.push({ ...trackFromSong(x), artist: x.artist ?? "", rights: x.rights ?? "", points: null, start: x.start, refrain: x.refrain, length: x.length, lrc: x.lrc, auto: x.auto });
        noterEcran();
        renderTracks();
        renderLibPicker();
      },
    }),
  ])));
  if (!all.length) $("playlist-lib-list").append(h("p", { class: "hint small", text: "La bibliothèque est vide : ajoutez des musiques à une playlist, elles y seront rangées." }));
}
$("playlist-from-lib").onclick = () => {
  $("playlist-lib").hidden = !$("playlist-lib").hidden;
  if (!$("playlist-lib").hidden) { renderLibPicker(); $("playlist-lib-search").focus(); }
};
$("playlist-lib-search").oninput = () => renderLibPicker();

/** Chansons tirées par « 🎲 10 au hasard ». */
const PLAYLIST_HASARD = 10;
/**
 * « 🎲 10 au hasard » (cedric, 21/10 : un blind test démo pioché dans la bibliothèque) : dix chansons pas encore dans
 * la playlist, celles qui ont leur refrain d'abord (« on chante tous ensemble » à chaque révélation). On peut ensuite
 * en retirer ou en ajouter avant d'enregistrer.
 */
$("playlist-hasard").onclick = () => {
  const inList = new Set(playlist.tracks.map((t) => t.audioId).filter(Boolean));
  const libres = songList(songs, playlists, isStatuesList).filter((x) => !inList.has(x.audioId));
  const tirage = [...shuffle(libres.filter((x) => x.refrainId)), ...shuffle(libres.filter((x) => !x.refrainId))].slice(0, PLAYLIST_HASARD);
  if (!tirage.length) {
    return status("playlist-status", inList.size ? "Toutes les chansons de la bibliothèque sont déjà dans la playlist." : "La bibliothèque des sons est vide : ajoutez d'abord vos chansons.");
  }
  tirage.forEach((x) => playlist.tracks.push({ ...trackFromSong(x), artist: x.artist ?? "", rights: x.rights ?? "", points: null, start: x.start, refrain: x.refrain, length: x.length, lrc: x.lrc, auto: x.auto }));
  noterEcran();
  renderTracks();
  if (!$("playlist-lib").hidden) renderLibPicker();
  status("playlist-status", `${plural(tirage.length, "chanson")} tirée${tirage.length > 1 ? "s" : ""} au hasard dans la bibliothèque. Retirez-en ou ajoutez-en, puis enregistrez.`, true);
};

let playlist = null; // { id, tracks: [{ title, artist, rights, points?, imageId?, duration?, audioId? | file, length, start }] }
let preview = null; // { audio, url, timer }

/** Longueurs proposées : extraits du blind test, ou chansons des statues (plus longues). */
const extractChoices = () => (playlist?.use === "statues" ? STATUES_EXTRACTS : EXTRACT_SECONDS);
const extractText = (n) => (n >= 60 ? `${n === 60 ? "1 minute" : `1 min ${n - 60}`}` : `${n} secondes`);
$("playlist-reveal").replaceChildren(...BLIND_REVEAL_SECONDS.map((n) => h("option", { value: n, text: n ? `${n} secondes` : "Tout l'extrait (on chante !)" })));
["playlist-points", "playlist-final-points", "playlist-final-count"].forEach((id) => { $(id).oninput = () => renderTracks(); });

/** Barème saisi dans l'écran de la playlist (valeurs hors limites remplacées par celles par défaut). */
function scaleInputs() {
  return blindScale({
    points: Number($("playlist-points").value), finalPoints: Number($("playlist-final-points").value),
    finalCount: Number($("playlist-final-count").value), reveal: Number($("playlist-reveal").value),
  });
}
$("playlist-new").onclick = () => editPlaylist(null);

/**
 * Chansons des statues musicales (page du jeu) : une seule liste, ouverte dans l'écran des playlists sans le barème
 * du blind test. Elle est créée au premier enregistrement.
 */
function openStatuesSongs() {
  gameType = "statues";
  const [found] = Object.entries(playlists).filter(([, p]) => isStatuesList(p)).sort(([, a], [, b]) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  editPlaylist(found ? found[0] : null, { use: "statues", title: "Chansons des statues musicales" });
}

function editPlaylist(id, fresh = {}) {
  const p = id ? playlists[id] : fresh;
  const statues = isStatuesList(p);
  const library = !id && fresh.use === "songs";
  playlist = {
    id, use: statues ? "statues" : library ? "songs" : null,
    tracks: (p.tracks ?? []).filter(Boolean).map((t) => {
      // Réglages gardés par la chanson dans la bibliothèque : ils reviennent quand on rechoisit le fichier.
      const song = t.songId ? songs[t.songId] : null;
      return {
        title: t.title ?? "", artist: t.artist ?? "", rights: t.rights ?? "", audioId: t.audioId,
        points: t.points ?? null, imageId: t.imageId ?? null, duration: t.duration ?? null,
        refrainId: t.refrainId ?? null, songId: t.songId ?? null,
        start: t.start ?? song?.start ?? null, refrain: t.refrain ?? song?.refrain ?? null, length: t.length ?? song?.length ?? null,
        // Paroles du refrain : gardées quand on réenregistre la playlist (sans elles, la TV ne les montrerait plus).
        ...(typeof t.paroles === "string" && t.paroles ? { paroles: t.paroles } : {}),
        lrc: t.lrc ?? song?.lrc === true, auto: t.auto ?? song?.auto === true,
      };
    }),
  };
  // Une seule chanson à régler : ni durée des nouvelles chansons, ni ajout de fichiers.
  const single = library && fresh.single === true;
  playlist.single = single;
  $("playlist-count").closest("p").hidden = single;
  $("playlist-lib").hidden = true;
  $("playlist-from-lib").hidden = statues || library;
  $("playlist-hasard").hidden = statues || library;
  $("playlist-title").closest("label").hidden = library;
  // Bibliothèque des sons : rien à régler côté temps (cedric, 22/10) ; le temps pour buzzer se choisit dans la manche.
  $("playlist-duration").closest(".panel").hidden = single || library;
  $("playlist-files").closest(".row").hidden = single;
  const scale = blindScale(p);
  $("playlist-points").value = `${scale.points}`;
  $("playlist-final-points").value = `${scale.finalPoints}`;
  $("playlist-final-count").value = `${scale.finalCount}`;
  $("playlist-reveal").value = `${scale.reveal}`;
  $("playlist-edit-title").textContent = id || statues || library ? p.title : "Nouvelle playlist";
  $("playlist-title").value = p.title ?? "";
  // Statues : pas de barème ni de pochette ; le fil d'Ariane ramène à la page du jeu. Réglages des chansons : à la
  // bibliothèque des sons.
  $("playlist-scale").hidden = statues || library;
  $("statues-hint").hidden = !statues;
  $("playlist-hint").hidden = statues || single;
  $("playlist-crumb").textContent = statues ? ROUND_TYPES.statues : library ? "Bibliothèque" : "Musique";
  $("playlist-crumb").dataset.screen = statues ? "game" : library ? "library" : "music";
  $("playlist-title-label").textContent = statues ? "Nom de la liste" : "Nom de la playlist";
  $("playlist-duration-label").textContent = statues ? "Longueur de chaque chanson" : library ? "Temps pour buzzer des nouvelles chansons" : "Temps pour buzzer (durée des extraits)";
  $("playlist-count-label").textContent = statues || library ? "Chansons" : "Morceaux";
  $("playlist-save").textContent = statues ? "Enregistrer les chansons" : single ? "Enregistrer les réglages" : library ? "Enregistrer dans la bibliothèque" : "Enregistrer la playlist";
  $("playlist-duration").replaceChildren(...extractChoices().map((n) => h("option", { value: n, text: extractText(n) })));
  $("playlist-duration").value = `${p.duration ?? (statues ? STATUES_EXTRACT : BLIND_SEC)}`;
  $("playlist-delete").hidden = !id;
  status("playlist-status", "");
  show("playlist-edit");
  renderTracks();
  histPlaylist.depart();
  chargerSources();
}

const PLAYLIST_FIELDS = ["playlist-title", "playlist-duration", "playlist-points", "playlist-final-points", "playlist-final-count", "playlist-reveal"];
const histPlaylist = historique({
  ecran: $("screen-playlist-edit"),
  precedent: pagePrecedente,
  capturer: () => ({ tracks: playlist?.tracks ?? [], champs: PLAYLIST_FIELDS.map((id) => $(id).value) }),
  restaurer: (e) => {
    stopPreview();
    PLAYLIST_FIELDS.forEach((id, k) => { $(id).value = e.champs[k]; });
    if (playlist) playlist.tracks = e.tracks;
    renderTracks();
  },
});

/**
 * Chansons entières (cedric, 21/10) : pour que les curseurs « Début » et « Hook » parcourent toute la chanson depuis
 * n'importe quel PC, chaque chanson de la bibliothèque est aussi rangée en entier en ligne (library/entieres/<chanson>,
 * en MP3 mono, coupée en parts sous la taille maximale d'une écriture), à côté de ses deux extraits. Le PC qui
 * l'importe garde en plus le fichier d'origine (sons-locaux.js), et un PC qui la télécharge la garde aussi : elle n'est
 * téléchargée qu'une fois par PC. Les extraits sont redécoupés depuis elle quand un réglage bouge.
 */
const sourcesLocales = new Map();
/** Chansons en cours de téléchargement (écran des réglages). */
const enChargement = new Set();
/** Fichier entier d'un morceau : celui qu'on vient de choisir ou de glisser, sinon la chanson entière déjà chargée. */
const sourceDe = (t) => t.file ?? (t.songId ? sourcesLocales.get(t.songId) : null) ?? null;
const ENTIERE_PART = 800_000;
const ENTIERE_PARTS_MAX = 24;
const ENTIERE_KBPS = [96, 64];

/**
 * Bibliothèque : chansons dont la chanson entière est en ligne (true) ou pas encore (false, rangées avant le 21/10 :
 * « ☁ » sur leur ligne). Vérifié une fois par chanson et par visite.
 */
const entieres = new Map();
let verificationEntieres = false;
async function verifierEntieres(liste) {
  const a = liste.filter((x) => x.id && !entieres.has(x.id));
  if (!a.length || verificationEntieres) return;
  verificationEntieres = true;
  try {
    for (let i = 0; i < a.length; i += 8) {
      await Promise.all(a.slice(i, i + 8).map(async (x) => entieres.set(x.id, await entiereEnLigne(x.id).catch(() => true))));
    }
  } finally {
    verificationEntieres = false;
  }
  renderSongs();
}

/** La chanson entière est-elle déjà en ligne ? */
async function entiereEnLigne(songId) {
  if (!songId) return false;
  return typeof (await get(ref(db, `library/entieres/${songId}/n`))).val() === "number";
}

/** Chanson entière à ranger en ligne : MP3 mono (base64 sans en-tête), ou null si elle est trop longue. */
async function encoderEntiere(buffer) {
  const mono = await cutExtract(buffer, 0, buffer.duration);
  for (const kbps of ENTIERE_KBPS) {
    const data = (await encodeMp3(mono, kbps)).slice("data:audio/mpeg;base64,".length);
    if (data.length <= ENTIERE_PART * ENTIERE_PARTS_MAX) return { data, kbps, length: buffer.duration };
  }
  return null;
}

/** Range la chanson entière en ligne, part après part ; le nombre de parts, écrit en dernier, dit qu'elle est complète. */
async function envoyerEntiere(songId, { data, kbps, length }) {
  const n = Math.ceil(data.length / ENTIERE_PART);
  for (let i = 0; i < n; i++) await set(ref(db, `library/entieres/${songId}/p/${i}`), data.slice(i * ENTIERE_PART, (i + 1) * ENTIERE_PART));
  await update(ref(db, `library/entieres/${songId}`), { n, kbps, length: Math.min(7200, Math.round(length)), at: serverTimestamp() });
  entieres.set(songId, true);
}

/** Chanson entière téléchargée, en fichier MP3 ; null si elle n'est pas (ou pas entièrement) en ligne. */
async function telechargerEntiere(songId) {
  const x = (await get(ref(db, `library/entieres/${songId}`))).val();
  if (!Number.isInteger(x?.n) || !x.p) return null;
  const parts = Array.from({ length: x.n }, (_, i) => x.p[i]);
  if (parts.some((p) => typeof p !== "string")) return null;
  const binaire = atob(parts.join(""));
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return new File([octets], `${songId}.mp3`, { type: "audio/mpeg" });
}

/** Garde sur ce PC le fichier d'une chanson de la bibliothèque. */
async function garderSurCePC(songId, fichier) {
  if (!songId || !fichier || sourcesLocales.get(songId) === fichier) return;
  sourcesLocales.set(songId, fichier);
  await garderFichier(songId, fichier);
}

/**
 * Chanson entière d'un morceau : déjà là, gardée sur ce PC, sinon téléchargée (et gardée sur ce PC pour la prochaine
 * fois). [enLigne] : faux pour regarder seulement sur ce PC. Rend null si elle n'est nulle part.
 */
async function chargerSource(t, enLigne = true) {
  if (sourceDe(t) || !t.songId) return sourceDe(t);
  let f = await fichierGarde(t.songId);
  if (!f && enLigne) {
    try {
      f = await telechargerEntiere(t.songId);
    } catch (e) {
      console.warn("Chanson entière introuvable", e);
    }
    if (f) await garderFichier(t.songId, f);
  }
  if (f) sourcesLocales.set(t.songId, f);
  return f;
}

/** Un réglage a bougé : le morceau sera redécoupé à l'enregistrement, depuis la chanson entière. */
function aRedecouper(t) {
  if (!t.file) t.file = sourceDe(t);
}

/**
 * Écran des playlists ouvert : les chansons entières gardées sur ce PC arrivent, et les curseurs avec elles. Réglages
 * d'une seule chanson : elle est téléchargée si besoin.
 */
async function chargerSources() {
  const p = playlist;
  if (!p || p.use === "statues") return;
  let trouvees = 0;
  for (const t of p.tracks) {
    if (sourceDe(t) || !t.songId) continue;
    if (p.single) { enChargement.add(t.songId); renderTracks(); }
    if (await chargerSource(t, p.single)) trouvees++;
    enChargement.delete(t.songId);
  }
  if (playlist !== p) return;
  // Une chanson sans durée connue (rangée avant le 21/10) : lue dans le fichier, sans compter comme une modification.
  const avant = histPlaylist.modifie;
  let durees = 0;
  for (const t of p.tracks) {
    const f = sourceDe(t);
    if (f && !(t.length > 0)) { t.length = await fileDuration(f); durees++; }
  }
  if (playlist !== p) return;
  if (durees && !avant) histPlaylist.depart();
  if (trouvees || durees || p.single) renderTracks();
}

function stopPreview() {
  if (!preview) return;
  clearTimeout(preview.timer);
  cancelAnimationFrame(preview.raf);
  preview.paroles?.arreter();
  preview.audio.pause();
  if (preview.url) URL.revokeObjectURL(preview.url);
  if (preview.bouton) {
    preview.bouton.textContent = preview.texte;
    preview.bouton.classList.remove("en-lecture");
    preview.bouton.removeAttribute("aria-pressed");
  }
  preview = null;
}

/**
 * Bouton d'écoute (cedric, 21/10 : sinon aucun moyen d'arrêter la chanson) : il lance l'écoute, devient « ⏸ Pause »
 * tant qu'elle joue, et l'arrête au clic suivant. [lancer](bouton) démarre l'écoute.
 */
function boutonEcoute(attrs, lancer) {
  const b = h("button", { type: "button", ...attrs, onclick: () => (preview?.bouton === b ? stopPreview() : lancer(b)) });
  return b;
}

/** L'écoute [audio] vient de partir : son bouton passe en « ⏸ Pause », et la fin du son l'arrête. */
function enLecture(audio, bouton) {
  if (preview?.audio !== audio) return;
  audio.onended = () => { if (preview?.audio === audio) stopPreview(); };
  if (!bouton) return;
  preview.bouton = bouton;
  preview.texte = bouton.textContent;
  bouton.textContent = bouton.classList.contains("icon") || bouton.classList.contains("icon-ecoute") ? "⏸" : "⏸ Pause";
  bouton.classList.add("en-lecture");
  bouton.setAttribute("aria-pressed", "true");
}

/** Durée de l'écoute du refrain avant l'enregistrement (le refrain enregistré, lui, dure jusqu'à 90 s). */
const REFRAIN_PREVIEW_SEC = 20;

/**
 * Fenêtre des paroles (cedric, 23/10) : pendant l'écoute de l'extrait ou du refrain, les paroles importées (.lrc)
 * défilent au rythme de la chanson, la phrase chantée en gras, pour vérifier vite qu'elles sont justes et bien calées.
 * Sobre et lisible, rien de festif. [titre] et [fermer] : la petite fenêtre de la liste des sons.
 */
function fenetreParoles({ titre = "", fermer = null, actions = null } = {}) {
  const defile = h("div", { class: "paroles-defile" });
  const el = h("div", { class: "paroles-fenetre", role: "region", "aria-label": titre ? `Paroles de « ${titre} »` : "Paroles" },
    titre ? h("div", { class: "paroles-tete" },
      h("b", { class: "paroles-titre", text: `Paroles · ${titre}` }),
      fermer ? h("button", { type: "button", class: "icon", title: "Arrêter l'écoute", "aria-label": "Fermer les paroles", onclick: fermer, text: "✕" }) : null) : null,
    defile);
  let lignes = [];
  let actuelle = null; // { i, classe }
  return {
    el,
    /** Les phrases du fichier .lrc ; sans phrase, le texte [vide]. */
    remplir(l, vide = "Chargement des paroles…") {
      lignes = l ?? [];
      actuelle = null;
      defile.replaceChildren(...(lignes.length ? lignes.map((x) => {
        const p = h("p", { class: `paroles-ligne${actions ? " cliquable" : ""}` },
          h("span", { class: "paroles-temps", text: mmss(x.t) }),
          h("span", { class: `paroles-texte${x.text ? "" : " vide"}`, text: x.text || "♪" }));
        // [actions] : cliquer une phrase propose ses boutons juste dessous (cedric, 26/10 : « Début ici », « Hook ici »).
        if (actions) {
          p.title = "Cliquez pour placer le début ou le hook sur cette phrase";
          p.onclick = () => {
            const ouverte = p.classList.contains("choisie");
            defile.querySelectorAll(".choisie").forEach((y) => { y.classList.remove("choisie"); y.querySelector(".paroles-actions")?.remove(); });
            if (ouverte) return;
            p.classList.add("choisie");
            p.append(h("span", { class: "paroles-actions" }, ...actions.map((a) => h("button", {
              type: "button", class: `btn small secondary ${a.classe}`, text: a.texte,
              onclick: (e) => {
                e.stopPropagation();
                p.classList.remove("choisie");
                e.currentTarget.parentElement.remove();
                a.faire(x.t);
              },
            }))));
            // Les boutons restent visibles dans la fenêtre des paroles.
            const bas = p.offsetTop + p.offsetHeight + 6;
            if (bas > defile.scrollTop + defile.clientHeight) defile.scrollTo({ top: bas - defile.clientHeight });
          };
        }
        return p;
      })
        : [h("p", { class: "hint small", text: vide })]));
    },
    /** La phrase du moment [s] (secondes de la chanson), au milieu de la fenêtre : chantée pendant l'écoute, repère sinon. */
    montrer(s, lecture = true) {
      const i = ligneAuMoment(lignes, s);
      const classe = lecture ? "chantee" : "repere";
      if (actuelle?.i === i && actuelle.classe === classe) return;
      defile.querySelectorAll(".chantee, .repere").forEach((x) => x.classList.remove("chantee", "repere"));
      actuelle = { i, classe };
      const p = lignes.length ? defile.children[Math.max(0, i)] : null;
      if (!p) return;
      if (i >= 0) p.classList.add(classe);
      defile.scrollTo({ top: p.offsetTop - defile.clientHeight / 2 + p.offsetHeight / 2, behavior: lecture ? "smooth" : "auto" });
    },
    /** Fin de l'écoute : plus de phrase chantée. */
    arreter() {
      defile.querySelectorAll(".chantee").forEach((x) => x.classList.remove("chantee"));
      actuelle = null;
    },
  };
}

/**
 * Petite fenêtre des paroles de la liste des sons (cedric, 23/10) : elle s'ouvre en bas de l'écran avec « ▶ Extrait »
 * ou « ▶ Refrain » d'une chanson qui a ses paroles, et se ferme quand l'écoute s'arrête. [vue] : l'écran qui l'ouvre
 * (la liste des sons, ou les jeux d'une prestation).
 */
function parolesFlottantes(x, vue = "song-list") {
  if (!x.lrc || !x.id) return null;
  const f = fenetreParoles({ titre: x.title, fermer: () => stopPreview() });
  f.el.classList.add("flottante");
  f.remplir([]);
  const { montrer, arreter } = f;
  // Cachée tant que la liste des sons (ou la prestation) n'est pas à l'écran (réglages ouverts pendant l'écoute).
  f.montrer = (s) => { f.el.hidden = $(vue).offsetParent === null; montrer(s); };
  f.arreter = () => { arreter(); f.el.remove(); };
  document.body.append(f.el);
  get(ref(db, `library/lyrics/${x.id}`))
    .then((snap) => typeof snap.val() === "string" ? lireLrc(snap.val()) : [])
    .catch(() => [])
    .then((l) => { if (f.el.isConnected) f.remplir(l, "Paroles introuvables."); });
  return f;
}

/**
 * Paroles d'un morceau d'une playlist pendant son écoute (cedric, 24/10 : « s'il n'y a pas de paroles, rien ne
 * s'affiche ») : celles de sa chanson de la bibliothèque (même extrait), dans la petite fenêtre de la liste des sons.
 */
function parolesDuMorceau(t) {
  return () => {
    const x = t?.audioId ? songList(songs, {}, isStatuesList).find((s) => s.audioId === t.audioId) : null;
    return x ? parolesFlottantes(x, "screen-playlist-edit") : null;
  };
}

/**
 * La fenêtre [paroles] (ou ce qui l'ouvre) suit l'écoute [audio] ; [base] : moment de la chanson où commence le son
 * écouté.
 */
function suivreParoles(audio, base, ouvrir) {
  if (!ouvrir || preview?.audio !== audio || !Number.isFinite(base)) return;
  const paroles = typeof ouvrir === "function" ? ouvrir() : ouvrir;
  if (!paroles) return;
  preview.paroles = paroles;
  const pas = () => {
    if (preview?.audio !== audio) return;
    paroles.montrer(base + audio.currentTime);
    preview.raf = requestAnimationFrame(pas);
  };
  pas();
}

/**
 * Écoute : l'extrait enregistré, ou le fichier à partir du début choisi pendant la durée de l'extrait.
 * [refrain] : le refrain de la révélation (enregistré, ou le fichier à partir du moment choisi).
 * [paroles] : la fenêtre des paroles qui suit l'écoute, ou ce qui l'ouvre.
 */
async function listen(t, refrain = false, bouton = null, paroles = null) {
  stopPreview();
  try {
    const fichier = sourceDe(t);
    if (fichier) {
      const url = URL.createObjectURL(fichier);
      const audio = new Audio(url);
      preview = { audio, url };
      audio.currentTime = refrain ? t.refrain ?? 0 : t.start;
      await audio.play();
      if (preview?.audio !== audio) return;
      preview.timer = setTimeout(stopPreview, (refrain ? REFRAIN_PREVIEW_SEC : t.duration ?? Number($("playlist-duration").value)) * 1000);
      enLecture(audio, bouton);
      suivreParoles(audio, 0, paroles);
    } else {
      const id = refrain ? t.refrainId : t.audioId;
      if (!id) return status("playlist-status", `« ${t.title} » n'a pas encore de hook : glissez son MP3 sur la chanson pour le régler.`);
      const data = (await get(ref(db, `library/sounds/${id}`))).val();
      if (typeof data !== "string") return status("playlist-status", `Extrait de « ${t.title} » introuvable.`);
      // Un autre bouton a été touché pendant le téléchargement : c'est lui qui joue.
      if (preview) return;
      const audio = new Audio(data);
      preview = { audio };
      await audio.play();
      enLecture(audio, bouton);
      // L'extrait rangé commence au début réglé, le refrain au hook.
      suivreParoles(audio, refrain ? t.refrain : t.start, paroles);
    }
  } catch (e) {
    console.error(e);
    status("playlist-status", "Écoute impossible sur cet ordinateur (le morceau sera quand même enregistré).");
  }
}

/** Déplace un morceau dans l'ordre de passage du blind test. */
function moveTrack(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= playlist.tracks.length) return;
  const [t] = playlist.tracks.splice(i, 1);
  playlist.tracks.splice(j, 0, t);
  renderTracks();
}

/** Pochette facultative d'un morceau : photo réduite et rangée comme les illustrations des quiz. */
function coverTools(t) {
  const img = h("img", { class: "track-cover", alt: "Pochette", hidden: !t.imageId });
  const showCover = () => {
    img.hidden = !t.imageId;
    if (!t.imageId) return;
    const id = t.imageId;
    if (imageCache[id]) { img.src = imageCache[id]; return; }
    get(ref(db, `library/images/${id}`)).then((snap) => {
      if (typeof snap.val() === "string") { imageCache[id] = snap.val(); if (t.imageId === id) img.src = snap.val(); }
    }).catch(() => {});
  };
  const remove = h("button", { type: "button", class: "link", text: "Retirer la pochette", hidden: !t.imageId, onclick: () => { t.imageId = null; remove.hidden = true; showCover(); } });
  const input = h("input", {
    type: "file", accept: "image/*", class: "track-cover-file", hidden: true,
    onchange: async (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      try {
        const data = await compressImage(f);
        const id = await imageId(data);
        const target = ref(db, `library/images/${id}`);
        if (!(await get(target)).exists()) await set(target, data);
        imageCache[id] = data;
        t.imageId = id;
        noterEcran();
        remove.hidden = false;
        showCover();
      } catch (err) {
        console.error(err);
        status("playlist-status", "Pochette refusée : essayez une autre image (JPEG ou PNG).");
      }
    },
  });
  showCover();
  return [img, h("label", { class: "link" }, "Pochette…", input), remove];
}

/** Le hook du morceau est-il celui trouvé automatiquement (pas déplacé à la main) ? */
const hookAuto = (t) => (t.regle === undefined ? t.auto === true : !t.regle);

/** Le morceau [t] accepte qu'on lui glisse son fichier musical, sans passer par l'explorateur de fichiers. */
function deposable(t) {
  const audio = (f) => /^audio\//.test(f.type) || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i.test(f.name);
  return {
    ondragover: (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      e.currentTarget.classList.add("depot");
    },
    ondragleave: (e) => e.currentTarget.classList.remove("depot"),
    ondrop: async (e) => {
      e.currentTarget.classList.remove("depot");
      const f = [...(e.dataTransfer?.files ?? [])].find(audio);
      if (!f) return;
      e.preventDefault();
      e.stopPropagation();
      await chargerParoles(t);
      await mesurerVolume(t, f);
      withFile(t, f, await fileDuration(f));
      noterEcran();
      renderTracks();
    },
  };
}
// Un fichier lâché à côté d'une zone prévue ne remplace pas la Régie PC par le fichier.
["dragover", "drop"].forEach((type) => window.addEventListener(type, (e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); }));

function renderTracks() {
  $("playlist-count").textContent = playlist.tracks.length;
  if (playlist.single) {
    $("playlist-tracks").replaceChildren(...playlist.tracks.map((t) => ecranReglage(t)));
    return;
  }
  const seconds = Number($("playlist-duration").value);
  const scale = scaleInputs();
  const n = playlist.tracks.length;
  $("playlist-tracks").replaceChildren(...playlist.tracks.map((t, i) => {
    const fichier = sourceDe(t);
    const debut = playlist.use === "statues" ? "Début du passage" : "Début de l'extrait";
    const label = h("span", { text: `${debut} : ${mmss(t.start ?? 0)}` });
    const length = t.duration ?? seconds;
    const max = Math.max(0, Math.floor((t.length ?? 0) - length));
    const auto = trackPoints(scale, null, i, n);
    // Durée propre au morceau : seulement avec la chanson entière (l'extrait est redécoupé à l'enregistrement).
    const duration = fichier && playlist.use !== "songs" ? h("label", { class: "inline" }, "Durée",
      h("select", {
        class: "track-duration", "aria-label": "Durée de l'extrait",
        onchange: (e) => { t.duration = e.target.value ? Number(e.target.value) : null; aRedecouper(t); renderTracks(); },
      },
      h("option", { value: "", text: `comme ${playlist.use === "statues" ? "la liste" : "la playlist"} (${seconds} s)`, selected: t.duration == null }),
      ...extractChoices().map((s) => h("option", { value: s, text: `${s} s`, selected: t.duration === s })))) : null;
    const statues = playlist.use === "statues";
    const library = playlist.use === "songs";
    return h("div", { class: `track${fichier ? "" : " saved"}`, "data-track": i, ...deposable(t) },
      h("input", { type: "text", maxlength: 80, placeholder: statues ? "Titre de la chanson" : "Titre (la réponse)", value: t.title, "aria-label": "Titre", oninput: (e) => { t.title = e.target.value; } }),
      h("input", { type: "text", maxlength: 80, placeholder: statues ? "Artiste (facultatif)" : "Artiste ou dessin animé (bonus, facultatif)", value: t.artist, "aria-label": "Artiste", oninput: (e) => { t.artist = e.target.value; } }),
      h("div", { class: "track-tools" },
        // La bibliothèque n'a pas d'ordre : pas de flèches.
        library ? null : h("button", { type: "button", class: "icon", title: "Plus tôt", disabled: i === 0, onclick: () => moveTrack(i, -1), text: "↑" }),
        library ? null : h("button", { type: "button", class: "icon", title: "Plus tard", disabled: i === n - 1, onclick: () => moveTrack(i, 1), text: "↓" }),
        boutonEcoute({ class: "icon", title: "Écouter l'extrait", text: "▶" }, (b) => listen(t, false, b, parolesDuMorceau(t))),
        statues ? null : boutonEcoute({ class: "icon", title: "Écouter le hook", text: "🎤" }, (b) => listen(t, true, b, parolesDuMorceau(t))),
        h("button", { type: "button", class: "icon", title: library ? "Retirer de cet écran (la chanson reste dans la bibliothèque)" : "Retirer", onclick: () => { stopPreview(); playlist.tracks.splice(i, 1); renderTracks(); }, text: "✕" })),
      h("div", { class: "track-start" }, label,
        h("input", {
          type: "range", min: 0, max, step: 1, value: Math.min(t.start ?? 0, max), "aria-label": "Début de l'extrait",
          oninput: (e) => { t.start = Number(e.target.value); t.debutMain = true; aRedecouper(t); label.textContent = `${debut} : ${mmss(t.start)}`; },
          onchange: () => { if (preview) listen(t); },
        })),
      statues ? null : refrainTools(t),
      h("div", { class: "track-extra" },
        library ? null : h("span", { class: "track-n", text: `${statues ? "Chanson" : "Morceau"} ${i + 1}` }),
        statues || library ? null : h("label", { class: "inline" }, "Points",
          h("input", {
            type: "number", class: "track-points", min: 1, max: 1000, step: 10, placeholder: `${auto}`, value: t.points ?? "",
            "aria-label": "Points du morceau", title: `Vide : ${auto} points (barème de la playlist)`,
            oninput: (e) => { const v = Number(e.target.value); t.points = e.target.value && Number.isInteger(v) && v >= 1 && v <= 1000 ? v : null; },
          })),
        duration,
        ...(statues ? [] : coverTools(t)),
        statues ? null : lyricsTools(t)),
      statues ? null : h("input", { type: "text", class: "track-note", maxlength: 120, placeholder: "Droits (facultatif, pour information)", value: t.rights, "aria-label": "Droits", oninput: (e) => { t.rights = e.target.value; } }));
  }));
  if (!playlist.tracks.length) $("playlist-tracks").append(h("p", { class: "hint small", text: playlist.use === "statues"
    ? `Aucune chanson rien qu'aux statues pour l'instant. ${statuesChoices(playlists).length === 1 ? "La chanson de vos playlists est déjà proposée dans les manches de statues."
      : statuesChoices(playlists).length ? `Les ${statuesChoices(playlists).length} chansons de vos playlists sont déjà proposées dans les manches de statues.`
      : "Sans chanson, la TV joue la musique de la fête."}`
    : "Aucun morceau : ajoutez vos fichiers musicaux." }));
}
$("playlist-duration").onchange = () => renderTracks();

/**
 * « Régler… » une chanson (cedric, 21/10) : sa pochette, son titre et son artiste (à renommer si besoin), et deux
 * curseurs sur toute la chanson : le début (d'office 2 s avant les premiers mots chantés) et le hook.
 * Lâcher un curseur joue la chanson à cet endroit. Les curseurs se servent de la chanson entière, rangée en ligne.
 */
/** Fenêtre des paroles de l'écran des réglages affiché (pour « ↺ Réidentifier le hook », qui le redessine). */
let parolesReglage = null;
function ecranReglage(t) {
  const fichier = sourceDe(t);
  const buzz = t.duration ?? Number($("playlist-duration").value);
  const longueur = Math.floor(t.length ?? 0);
  const maxDebut = Math.max(0, longueur - buzz);
  const maxHook = Math.max(0, longueur - 10);
  const [pochette, choisir, retirer] = coverTools(t);
  pochette.classList.add("reglage-pochette");
  const tempsDebut = h("b", { class: "reglage-temps", text: mmss(t.start ?? 0) });
  const tempsHook = h("b", { class: "reglage-temps", text: Number.isFinite(t.refrain) ? mmss(t.refrain) : "—" });
  const origine = h("span", { class: "reglage-origine", text: t.refrainId || fichier ? (hookAuto(t) ? "trouvé automatiquement" : "réglé à la main") : "" });
  const curseur = (nom, valeur, max, bouger, ecouter) => h("input", {
    type: "range", class: "reglage-range", min: 0, max, step: 1, value: Math.min(valeur ?? 0, max), "aria-label": nom, disabled: !fichier,
    oninput: (e) => bouger(Number(e.target.value)), onchange: ecouter,
  });
  const bornes = (max) => h("div", { class: "reglage-bornes", "aria-hidden": "true" }, h("span", { text: "0:00" }), h("span", { text: mmss(max) }));
  // Les paroles défilent pendant l'écoute (cedric, 23/10) ; à l'arrêt, elles montrent le moment du curseur bougé.
  // Cliquer une phrase : « Début de la chanson ici » ou « Hook ici » place le curseur sur son minutage (cedric, 26/10).
  const placerSur = (input, max) => (s) => {
    input.value = `${Math.max(0, Math.min(Math.floor(s), max))}`;
    input.dispatchEvent(new Event("input"));
  };
  const paroles = t.lrc ? fenetreParoles({
    actions: fichier ? [
      { texte: "⏮ Début de la chanson ici", classe: "paroles-debut-ici", faire: (s) => placerSur(curseurDebut, maxDebut)(s) },
      { texte: "🎤 Hook ici", classe: "paroles-hook-ici", faire: (s) => placerSur(curseurHook, maxHook)(s) },
    ] : null,
  }) : null;
  parolesReglage = paroles;
  const reperer = (v) => { if (paroles && preview?.paroles !== paroles) paroles.montrer(v, false); };
  // Lâcher un curseur joue la chanson à cet endroit, et son « ▶ Écouter » devient « ⏸ Pause ».
  const ecouter = (refrain) => boutonEcoute({ class: "btn small secondary", title: refrain ? "Écouter le hook" : "Écouter à partir du début", text: "▶ Écouter" }, (b) => listen(t, refrain, b, paroles));
  const ecouteDebut = ecouter(false);
  const ecouteHook = ecouter(true);
  const curseurDebut = curseur("Début de la chanson", t.start, maxDebut, (v) => { t.start = v; t.debutMain = true; aRedecouper(t); tempsDebut.textContent = mmss(v); reperer(v); }, () => listen(t, false, ecouteDebut, paroles));
  const curseurHook = curseur("Hook", t.refrain, maxHook, (v) => { t.refrain = v; t.regle = true; aRedecouper(t); tempsHook.textContent = mmss(v); origine.textContent = "réglé à la main"; reperer(v); }, () => listen(t, true, ecouteHook, paroles));
  if (paroles) {
    // Au départ, les paroles du hook.
    const placer = () => requestAnimationFrame(() => reperer(t.refrain ?? 0));
    if (t.lignes) { paroles.remplir(t.lignes); placer(); }
    else {
      paroles.remplir([]);
      chargerParoles(t).then(() => { paroles.remplir(t.lignes ?? [], "Paroles introuvables."); placer(); });
    }
  }
  return h("div", { class: `track reglage${fichier ? "" : " sans-fichier"}`, "data-track": 0, ...deposable(t) },
    h("div", { class: "reglage-tete" },
      h("div", { class: "reglage-cadre", title: "Pochette" }, pochette),
      h("div", { class: "reglage-noms" },
        h("label", {}, "Titre",
          h("input", { type: "text", maxlength: 80, value: t.title, placeholder: "Titre (la réponse)", "aria-label": "Titre", oninput: (e) => { t.title = e.target.value; } })),
        h("label", {}, "Artiste",
          h("input", { type: "text", maxlength: 80, value: t.artist, placeholder: "Artiste (facultatif)", "aria-label": "Artiste", oninput: (e) => { t.artist = e.target.value; } })),
        h("div", { class: "reglage-liens" }, choisir, retirer, lyricsTools(t)))),
    h("div", { class: "reglage-curseur", "data-curseur": "debut" },
      h("div", { class: "reglage-ligne" }, h("span", { class: "reglage-nom", text: "Début de la chanson" }), tempsDebut, ecouteDebut),
      curseurDebut,
      bornes(maxDebut),
      h("p", { class: "hint small", text: "Réglé d'office 2 s avant les premiers mots chantés (0:00 sans paroles)." })),
    h("div", { class: "reglage-curseur", "data-curseur": "hook" },
      h("div", { class: "reglage-ligne" }, h("span", { class: "reglage-nom", text: "Hook" }), tempsHook, origine, ecouteHook,
        h("button", {
          type: "button", class: "btn small secondary", disabled: !fichier, onclick: () => reidentifierHook(t), text: "↺ Réidentifier le hook",
          title: "Retrouver le refrain : le passage le plus chanté des paroles, là où la musique devient forte",
        })),
      curseurHook,
      bornes(maxHook),
      h("p", { class: "hint small", text: "Le passage que tout le monde chante à la révélation (« on chante tous ensemble »)." })),
    paroles ? h("div", { class: "reglage-curseur reglage-paroles" },
      h("div", { class: "reglage-ligne" }, h("span", { class: "reglage-nom", text: "Paroles" }), h("span", { class: "hint small", text: "Elles défilent pendant l'écoute du début ou du hook." })),
      paroles.el) : null,
    h("div", { class: "reglage-plus" },
      h("input", { type: "text", class: "track-note", maxlength: 120, placeholder: "Droits (facultatif, pour information)", value: t.rights, "aria-label": "Droits", oninput: (e) => { t.rights = e.target.value; } })),
    fichier ? null : h("p", {
      class: "reglage-manque",
      text: enChargement.has(t.songId) ? "Chargement de la chanson entière…"
        : "Les curseurs attendent la chanson entière, pas encore en ligne : glissez son MP3 ici, ou redéposez-la une fois avec « Ajouter des chansons… ». Le titre, l'artiste et la pochette se changent déjà.",
    }));
}

/**
 * Hook d'un morceau du blind test (chanté à la révélation, « on chante tous ensemble ») : un curseur sur la chanson
 * entière ; sans elle sur ce PC, « ⏱ Changer le réglage » la télécharge (ou on glisse son MP3 sur le morceau).
 */
function refrainTools(t) {
  if (!sourceDe(t)) {
    const charge = enChargement.has(t.songId);
    return h("div", { class: "track-refrain" },
      h("span", {
        class: t.refrainId ? "ok" : "track-sans-hook",
        text: t.refrainId ? `Hook réglé ✓${Number.isFinite(t.refrain) ? ` à ${mmss(t.refrain)}` : ""}${hookAuto(t) ? " (trouvé automatiquement)" : ""}` : "Pas encore de hook pour la révélation.",
      }),
      t.songId ? h("button", {
        type: "button", class: "btn small secondary", disabled: charge, text: charge ? "Chargement…" : "⏱ Changer le réglage",
        title: "Déplacer le début ou le hook, sur la chanson entière",
        onclick: async () => {
          enChargement.add(t.songId);
          renderTracks();
          const f = await chargerSource(t);
          enChargement.delete(t.songId);
          if (!f) status("playlist-status", `« ${t.title} » n'est pas encore entière en ligne : glissez son MP3 sur la chanson, ou redéposez-la une fois avec « Ajouter des chansons… ».`);
          renderTracks();
        },
      }) : h("span", { class: "hint small", text: "Glissez son MP3 ici pour le régler." }));
  }
  const nom = "Hook (chanté à la révélation)";
  const label = h("span", { text: `${nom} : ${mmss(t.refrain ?? 0)}` });
  return h("div", { class: "track-refrain" }, label,
    h("input", {
      type: "range", min: 0, max: Math.max(0, Math.floor((t.length ?? 0) - 10)), step: 1, value: t.refrain ?? 0, "aria-label": "Moment du refrain",
      oninput: (e) => { t.refrain = Number(e.target.value); t.regle = true; aRedecouper(t); label.textContent = `${nom} : ${mmss(t.refrain)}`; },
      onchange: () => { if (preview) listen(t, true); },
    }),
    h("button", {
      type: "button", class: "link", title: "Retrouver le refrain : le passage le plus chanté des paroles, là où la musique devient forte",
      onclick: () => reidentifierHook(t), text: "↺ Réidentifier le hook",
    }));
}

/**
 * « ↺ Réidentifier le hook » : retrouvé dans les paroles (le passage le plus chanté), sinon vers le milieu ; le début
 * de l'extrait est recalé aussi.
 */
async function reidentifierHook(t) {
  if (!sourceDe(t)) return;
  await chargerParoles(t);
  if (!t.volume) await mesurerVolume(t, sourceDe(t));
  aRedecouper(t);
  t.regle = false;
  const buzz = t.duration ?? Number($("playlist-duration").value);
  // Le début est recalé avec le hook (avant les premiers mots chantés).
  if (DEBUT_AVANT_PAROLES) { t.start = debutPropose(t, t.length, buzz); delete t.debutMain; }
  t.refrain = refrainPropose(t, t.length, t.start ?? 0, buzz);
  noterEcran();
  renderTracks();
  listen(t, true, null, playlist.single ? parolesReglage : null);
}

/**
 * Début que la Régie PC proposait avant le 21/10 (le tiers du morceau, 45 s au plus, sans regarder la chanson). Une
 * chanson qui l'a encore reçoit le nouveau début proposé quand son fichier revient.
 */
const ancienDebutPropose = (length, buzz) => Math.max(0, Math.min(Math.floor(Math.min(45, length / 3)), Math.floor(length - buzz)));
const debutAncienPropose = (t, length, buzz) => hookAuto(t) && t.start > 0 && Number.isFinite(length) && Math.abs(t.start - ancienDebutPropose(length, buzz)) <= 1;

/**
 * Où démarre l'extrait du buzz quand la Régie PC règle seule une chanson (cedric, 21/10) : 2 s avant les premiers mots
 * chantés (d'après ses paroles), ou 0:00 sans paroles. Faux : toujours 0:00.
 */
const DEBUT_AVANT_PAROLES = true;

/** Début proposé d'un morceau : avant les premiers mots chantés, sinon 0:00 ; l'extrait tient dans le morceau. */
function debutPropose(t, length, buzz) {
  const mots = DEBUT_AVANT_PAROLES && t.lignes ? debutDesParoles(t.lignes) : null;
  if (mots == null || mots < 3) return 0;
  return Math.max(0, Math.min(Math.floor(mots - 2), Math.floor(length - buzz)));
}

/**
 * Fichier choisi ou glissé pour un morceau : les moments déjà réglés sont gardés s'ils tiennent dans le fichier ; sinon
 * le début et le hook sont proposés (seul cedric décale le début à la main).
 */
function withFile(t, file, length) {
  const buzz = t.duration ?? Number($("playlist-duration").value);
  t.file = file;
  t.length = length;
  if (!(Number.isFinite(t.start) && t.start <= Math.max(0, length - buzz)) || debutAncienPropose(t, length, buzz)) t.start = debutPropose(t, length, buzz);
  // Un hook trouvé tout seul est recherché de nouveau (paroles et volume : la recherche s'améliore) ; un hook réglé à
  // la main est gardé.
  const hookAGarder = Number.isFinite(t.refrain) && t.refrain <= Math.max(0, length - 10) && !hookAuto(t);
  if (playlist.use !== "statues" && !hookAGarder) {
    t.refrain = refrainPropose(t, length, t.start, buzz);
    t.regle = false;
  }
  return t;
}

/**
 * Moment du refrain proposé (cedric, 21/10 : le vrai refrain, « là où ça explose », où qu'il soit) : d'après les paroles
 * (le passage le plus répété), vérifié au volume du MP3 ; sans paroles, là où le volume explose ; sinon vers le milieu.
 */
function refrainPropose(t, length, start, buzz) {
  const fois = t.lignes ? refrainsDesParoles(t.lignes).filter((x) => x < length - 20) : [];
  const r = fois.length ? refrainAuVolume(t.volume, fois) : explosionDuVolume(t.volume, { min: start + buzz, max: length - 25 });
  if (r != null) return Math.max(0, Math.floor(Math.min(r, length - 20)));
  return defaultRefrain(length, start, buzz);
}

/**
 * Volume du fichier d'un morceau, mesuré une fois (pour trouver où la chanson explose) : gardé sur ce PC le temps de
 * l'écran, jamais rangé en ligne. Rien si le fichier est illisible. Rend la durée du fichier décodé (0 si illisible).
 */
async function mesurerVolume(t, file) {
  if (!file || playlist?.use === "statues") return 0;
  try {
    const buffer = await decodeFile(file);
    const canaux = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c));
    t.volume = volumes(canaux, buffer.sampleRate);
    return buffer.duration;
  } catch (e) {
    console.warn("Volume illisible", e);
    delete t.volume;
    return 0;
  }
}

/** Pochette d'une chanson (image du MP3 ou choisie sur le PC) : JPEG léger rangé avec les photos ; rend son identifiant. */
async function rangerPochette(blob) {
  const data = await compressImage(blob, 60_000, 512);
  const id = await imageId(data);
  const target = ref(db, `library/images/${id}`);
  if (!(await get(target)).exists()) await set(target, data);
  imageCache[id] = data;
  return id;
}

/** Paroles d'un morceau, lues dans son fichier .lrc (rangées à l'enregistrement). */
function avecParoles(t, texte) {
  t.lignes = lireLrc(texte);
  if (!t.lignes.some((l) => l.text)) { delete t.lignes; return false; }
  t.lrcTexte = texte;
  t.lrcNeuf = true;
  t.lrc = true;
  return true;
}

/** Paroles déjà rangées d'une chanson de la bibliothèque : pour proposer le refrain et recaler ses paroles. */
async function chargerParoles(t) {
  if (t.lignes || !t.songId || songs[t.songId]?.lrc !== true) return;
  try {
    const texte = (await get(ref(db, `library/lyrics/${t.songId}`))).val();
    if (typeof texte === "string") {
      // Lues dans la bibliothèque, pas changées : « ← Retour » ne demande pas « Quitter sans enregistrer ? ».
      const avant = histPlaylist.modifie;
      t.lignes = lireLrc(texte);
      t.lrcTexte = texte;
      if (!avant && playlist?.tracks.includes(t)) histPlaylist.depart();
    }
  } catch (e) {
    console.warn("Paroles introuvables", e);
  }
}

/** Paroles d'un morceau dans l'écran des playlists : incluses, ou un fichier .lrc à ajouter. */
function lyricsTools(t) {
  const input = h("input", {
    type: "file", accept: ".lrc,text/plain", hidden: true,
    onchange: async (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      if (!avecParoles(t, (await f.text()).slice(0, MAX_LRC))) return status("playlist-status", `« ${f.name} » ne contient pas de paroles minutées (fichier .lrc attendu).`);
      // Paroles arrivées après le fichier : le refrain proposé suit les paroles, tant qu'il n'a pas été réglé.
      if (sourceDe(t) && hookAuto(t)) {
        const buzz = t.duration ?? Number($("playlist-duration").value);
        aRedecouper(t);
        if (!t.debutMain && !(t.start > 0)) t.start = debutPropose(t, t.length, buzz);
        t.refrain = refrainPropose(t, t.length, t.start ?? 0, buzz);
      }
      noterEcran();
      renderTracks();
    },
  });
  return h("label", { class: `link track-paroles${t.lrc ? " ok" : ""}`, title: t.lrc ? "Paroles incluses : cliquez pour remplacer le fichier .lrc" : "Ajouter le fichier .lrc des paroles" },
    t.lrc ? "Paroles ✓" : "Paroles (.lrc)…", input);
}

/**
 * Délai de chaque étape de l'import des chansons, en secondes (cedric, 22/10 : import bloqué à 62 / 204 sur un fichier).
 * Une étape qui ne répond plus (fichier abîmé, Internet coupé) est abandonnée et l'import passe à la suite.
 */
const DELAIS_IMPORT = { etiquettes: 15, duree: 20, paroles: 15, reseau: 30, volume: 90, decodage: 120 };

/** [promesse], ou une erreur si l'étape [etape] dépasse son délai. Les tests raccourcissent les délais (lmpDelaisImport). */
function avantDelai(promesse, etape) {
  const ms = DELAIS_IMPORT[etape] * 1000 * (Number(globalThis.lmpDelaisImport) || 1);
  let minuteur;
  return Promise.race([
    promesse,
    new Promise((_, refus) => { minuteur = setTimeout(() => refus(new Error(`Import : « ${etape} » sans réponse après ${ms / 1000} s`)), ms); }),
  ]).finally(() => clearTimeout(minuteur));
}

const sansAccents = (x) => `${x ?? ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/**
 * Fichiers musicaux ajoutés : une chanson déjà dans la bibliothèque (même titre, même artiste) revient avec ses
 * préréglages ; sinon le début et le refrain sont proposés.
 */
async function addFiles(files) {
  const statues = playlist.use === "statues";
  const library = statues ? [] : songList(songs, {}, isStatuesList);
  // Chaque fichier musical retrouve son .lrc (même nom) ; les .lrc seuls vont aux chansons déjà là.
  const { paires, seuls } = statues
    ? { paires: files.filter((f) => !/\.lrc$/i.test(f.name)).map((musique) => ({ musique, lrc: null })), seuls: [] }
    : associerParoles(files);
  let pochettes = 0;
  let paroles = 0;
  // Bibliothèque des sons : une chanson déjà rangée (extraits et refrain) n'est pas redécoupée quand ses fichiers
  // reviennent (toute la bibliothèque redéposée après un envoi coupé) ; elle prend seulement ses paroles ou sa pochette.
  const enVrac = playlist.use === "songs" && !playlist.single;
  let dejaLa = 0;
  let auDebut = 0;
  for (const [k, { musique: file, lrc }] of paires.entries()) {
    if (paires.length > 2) status("playlist-status", `Lecture des fichiers ${k + 1} / ${paires.length} : ${file.name}…`, true);
    // Titre, artiste et pochette rangés dans le MP3 ; sinon le nom du fichier « Artiste - Titre ».
    const tags = statues ? {} : await avantDelai(etiquettesMp3(file), "etiquettes").catch((e) => { console.warn(file.name, e); return {}; });
    const devine = guessTrack(file.name);
    const title = (tags.title || devine.title || "").slice(0, 80);
    const artist = (tags.artist || devine.artist || "").slice(0, 80);
    const meme = (a, b) => (x) => sansAccents(x.title) === sansAccents(a) && sansAccents(x.artist) === sansAccents(b);
    const known = library.find(meme(title, artist)) ?? library.find(meme(devine.title, devine.artist));
    const already = known && playlist.tracks.find((t) => t.songId === known.id);
    // Une chanson déjà rangée revient : son fichier est gardé sur ce PC ; sans sa chanson entière en ligne, ou avec
    // l'ancien début proposé, elle est préparée de nouveau (les extraits déjà rangés ne sont pas renvoyés).
    if (enVrac && known?.id && known.audioId && known.refrainId && !already) await avantDelai(garderSurCePC(known.id, file), "reseau").catch((e) => console.warn(file.name, e));
    const ancienDebut = Boolean(known) && debutAncienPropose(known, known.length, known.buzz);
    if (ancienDebut && enVrac) auDebut += 1;
    if (enVrac && known?.id && known.audioId && known.refrainId && !already && !ancienDebut && (await avantDelai(entiereEnLigne(known.id), "reseau").catch(() => true))) {
      dejaLa += 1;
      try {
        if (lrc && !known.lrc) { await avantDelai(attacherParoles(known, (await lrc.text()).slice(0, MAX_LRC)), "reseau"); paroles += 1; }
        if (!known.imageId && tags.picture) {
          await avantDelai(majChanson(known, { imageId: await avantDelai(rangerPochette(new Blob([tags.picture.data], { type: tags.picture.mime })), "reseau") }), "reseau");
          pochettes += 1;
        }
      } catch (e) {
        console.warn("Paroles ou pochette refusées", file.name, e);
      }
      continue;
    }
    const length = await avantDelai(fileDuration(file), "duree").catch((e) => { console.warn(file.name, e); return 0; });
    const t = already ?? (known
      ? { ...trackFromSong(known), artist: known.artist ?? "", rights: known.rights ?? "", points: null, start: known.start, refrain: known.refrain ?? undefined, lrc: known.lrc, auto: known.auto }
      : { title, artist, rights: "", points: null });
    if (!statues) {
      const texte = lrc ? await avantDelai(lrc.text(), "paroles").catch(() => "") : "";
      if (texte && avecParoles(t, texte.slice(0, MAX_LRC))) paroles += 1;
      else await avantDelai(chargerParoles(t), "reseau").catch((e) => console.warn(file.name, e));
      if (!t.imageId && tags.picture) {
        try {
          t.imageId = await avantDelai(rangerPochette(new Blob([tags.picture.data], { type: tags.picture.mime })), "reseau");
          pochettes += 1;
        } catch (e) {
          console.warn("Pochette du MP3 illisible", e);
        }
      }
    }
    // Durée illisible par le lecteur du navigateur : celle du fichier décodé pour le volume.
    const lue = statues ? 0 : await avantDelai(mesurerVolume(t, file), "volume").catch((e) => { console.warn(file.name, e); return 0; });
    withFile(t, file, length || lue || 0);
    if (!already) playlist.tracks.push(t);
  }
  const rangees = statues ? 0 : await parolesSeules(seuls);
  renderTracks();
  noterEcran();
  if (!statues && (paires.length || seuls.length)) {
    const bilan = [
      paires.length ? `${plural(paires.length, "fichier musical", "fichiers musicaux")} lu${paires.length > 1 ? "s" : ""}` : "",
      pochettes ? `${plural(pochettes, "pochette")} trouvée${pochettes > 1 ? "s" : ""}` : "",
      paroles ? `paroles de ${plural(paroles, "chanson")}` : "",
      rangees ? `paroles ajoutées à ${plural(rangees, "chanson")} de la bibliothèque` : "",
      seuls.length > rangees ? `${plural(seuls.length - rangees, "fichier .lrc")} sans chanson du même nom` : "",
      dejaLa ? `${plural(dejaLa, "chanson")} déjà dans la bibliothèque` : "",
      auDebut ? `${plural(auDebut, "chanson")} au nouveau début` : "",
    ].filter(Boolean).join(" · ");
    status("playlist-status", `${bilan}.${paires.length > dejaLa && !enVrac ? " Vérifiez, puis enregistrez." : ""}`, true);
    return `${bilan}.`;
  }
  return "";
}

/**
 * Fichiers .lrc déposés sans leur musique : chacun va au morceau de l'écran, ou à la chanson de la bibliothèque, qui
 * porte le même nom (« Artiste - Titre » ou « Artiste_Titre »). Rend le nombre de chansons de la bibliothèque complétées.
 */
async function parolesSeules(fichiers) {
  let n = 0;
  const library = songList(songs, playlists, isStatuesList);
  for (const f of fichiers) {
    const cle = nomSimple(f.name);
    const memeNom = (x) => [nomSimple(`${x.artist ?? ""} ${x.title}`), nomSimple(x.title)].includes(cle);
    const texte = (await f.text()).slice(0, MAX_LRC);
    const piste = playlist.tracks.find(memeNom);
    if (piste) { avecParoles(piste, texte); continue; }
    const song = library.find(memeNom);
    if (!song) continue;
    try {
      await attacherParoles(song, texte);
      n += 1;
    } catch (e) {
      console.warn("Paroles refusées", f.name, e);
    }
  }
  return n;
}

/** Chanson de la bibliothèque tirée d'un morceau enregistré : titre, extraits et préréglages. */
function songData(t, seconds, old = null) {
  const out = { title: t.title.trim().slice(0, 80), audioId: t.audioId, buzz: buzzOf(t.duration ?? seconds) };
  if ((t.lrc ?? old?.lrc) === true) out.lrc = true;
  const paroles = t.paroles ?? old?.paroles;
  if (t.refrainId && typeof paroles === "string" && paroles) out.paroles = paroles.slice(0, 8000);
  if (("auto" in t ? t.auto : old?.auto) === true) out.auto = true;
  if (t.artist?.trim()) out.artist = t.artist.trim().slice(0, 80);
  if (t.rights?.trim()) out.rights = t.rights.trim().slice(0, 120);
  if (t.imageId) out.imageId = t.imageId;
  if (t.refrainId) out.refrainId = t.refrainId;
  [["start", 3600], ["refrain", 3600], ["length", 7200]].forEach(([k, max]) => {
    if (Number.isFinite(t[k])) out[k] = Math.min(max, Math.max(0, Math.round(t[k])));
  });
  return out;
}
const SONG_FIELDS = ["title", "artist", "rights", "imageId", "audioId", "refrainId", "buzz", "start", "refrain", "length", "lrc", "paroles", "auto"];
const sameSong = (a, b) => SONG_FIELDS.every((k) => (a?.[k] ?? null) === (b?.[k] ?? null));

/** Durée d'un fichier, lue par le navigateur sans le décoder en entier. */
function fileDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    // Le lecteur est rendu aussitôt : le navigateur n'en garde qu'un nombre limité à la fois (des centaines de fichiers).
    const done = (d) => {
      audio.onloadedmetadata = audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) ? d : 0);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(audio.duration);
    audio.onerror = () => done(0);
    audio.src = url;
  });
}

$("playlist-files").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  await addFiles(files);
};

$("playlist-save").onclick = async () => {
  if (!(await enregistrerPlaylist()) || !playlist?.single) return;
  // Réglages d'une chanson (cedric, 22/10) : une fois enregistrés, retour à la liste des sons, comme « ← Retour ».
  const titre = playlist.tracks[0]?.title?.trim() ?? "";
  pagePrecedente();
  status("song-status", `Réglages de « ${titre} » enregistrés. Les playlists qui ont cette chanson les suivent.`, true);
};

/** Enregistre l'écran des playlists (extraits découpés ici) ; rend vrai quand tout est rangé. */
async function enregistrerPlaylist() {
  const statues = playlist.use === "statues";
  // Bibliothèque des sons : les chansons seulement, sans playlist à enregistrer.
  const library = playlist.use === "songs";
  const title = library ? "Bibliothèque des sons" : $("playlist-title").value.trim();
  if (!title) return status("playlist-status", statues ? "Donnez un nom à la liste." : "Donnez un nom à la playlist.");
  if (!playlist.tracks.length) return status("playlist-status", statues ? "Ajoutez au moins une chanson." : "Ajoutez au moins un morceau.");
  const untitled = playlist.tracks.findIndex((t) => !t.title.trim());
  if (untitled >= 0) return status("playlist-status", statues ? `Chanson ${untitled + 1} : indiquez son titre.` : `Morceau ${untitled + 1} : indiquez son titre (c'est la réponse attendue).`);
  stopPreview();
  const seconds = Number($("playlist-duration").value);
  $("playlist-save").disabled = true;
  try {
    // Chaque nouveau morceau : extrait découpé et réencodé ici, rangé une seule fois dans la bibliothèque ; au blind
    // test, aussi le refrain de la révélation (90 s, joué en boucle sur la TV).
    const fresh = playlist.tracks.filter((t) => t.file);
    const fichiers = new Map(); // morceau → son fichier entier (gardé sur ce PC une fois la chanson rangée)
    const entieres = new Map(); // morceau → sa chanson entière à ranger en ligne
    const before = new Map(); // morceau → son ancien extrait (pour retrouver les anciens morceaux des autres playlists)
    const changed = [];
    // Un fichier illisible est laissé de côté, les autres continuent (cedric, 21/10 : toute sa bibliothèque d'un coup).
    const illisibles = [];
    // Bibliothèque : chaque chanson est rangée dès qu'elle est prête ; un envoi coupé en route garde les précédentes.
    const deja = library && fresh.length > 1 ? " Les chansons prêtes sont déjà rangées." : "";
    for (const [k, t] of fresh.entries()) {
      status("playlist-status", `Préparation de l'extrait ${k + 1} / ${fresh.length} : ${t.title}…${deja}`, true);
      let extract;
      let refrain = null;
      const refrainAt = t.refrain ?? defaultRefrain(t.length, t.start ?? 0, t.duration ?? seconds);
      // Hook inchangé (seul le début ou le temps pour buzzer a bougé) : son extrait, déjà rangé, n'est pas redécoupé.
      const song = t.songId ? songs[t.songId] : null;
      const hookIntact = !statues && Boolean(t.refrainId) && song?.refrainId === t.refrainId && song.refrain === refrainAt;
      const enLigne = statues || (await entiereEnLigne(t.songId).catch(() => false));
      fichiers.set(t, t.file);
      try {
        const buffer = await avantDelai(decodeFile(t.file), "decodage");
        extract = await makeExtract(buffer, t.start ?? 0, t.duration ?? seconds);
        if (!statues && !hookIntact) {
          status("playlist-status", `Préparation du refrain ${k + 1} / ${fresh.length} : ${t.title}…${deja}`, true);
          refrain = await makeExtract(buffer, refrainAt, REFRAIN_SEC, REFRAIN_KBPS);
        }
        // La chanson entière, rangée en ligne une seule fois : ses réglages se changent depuis n'importe quel PC.
        if (!enLigne) {
          status("playlist-status", `Préparation de la chanson entière ${k + 1} / ${fresh.length} : ${t.title}…${deja}`, true);
          const entiere = await encoderEntiere(buffer);
          if (entiere) entieres.set(t, entiere);
        }
      } catch (err) {
        console.error(err);
        fichiers.delete(t);
        illisibles.push(t);
        continue;
      }
      for (const x of [extract, refrain].filter(Boolean)) {
        const target = ref(db, `library/sounds/${x.id}`);
        if (!(await get(target)).exists()) await set(target, x.data);
      }
      if (t.audioId) before.set(t, t.audioId);
      t.audioId = extract.id;
      if (refrain) {
        t.refrainId = refrain.id;
        // Paroles calées sur ce nouveau refrain (rien si la chanson n'a pas de paroles).
        if (!t.lignes) await chargerParoles(t);
        t.paroles = t.lignes ? parolesDuRefrain(t.lignes, refrainAt, REFRAIN_SEC) : "";
      } else if (hookIntact && t.lrcNeuf && t.lignes) {
        t.paroles = parolesDuRefrain(t.lignes, refrainAt, REFRAIN_SEC);
      }
      // Hook trouvé automatiquement, sauf s'il a été déplacé à la main : la chanson est réglée dans les deux cas.
      if (!statues && t.regle !== undefined) t.auto = !t.regle;
      delete t.file;
      if (library) {
        await rangerChanson(t, seconds, before, changed);
        await rangerEntiere(t, fichiers, entieres, `${k + 1} / ${fresh.length}`);
      }
    }
    // Fichiers illisibles : retirés de l'écran, nommés à la fin.
    const nonLus = illisibles.length
      ? ` ${illisibles.length > 1 ? `${illisibles.length} fichiers illisibles laissés de côté` : "Un fichier illisible laissé de côté"} (essayez un autre format, MP3 de préférence) : ${illisibles.map((t) => `« ${t.title} »`).join(", ")}.`
      : "";
    if (illisibles.length) {
      playlist.tracks = playlist.tracks.filter((t) => !illisibles.includes(t));
      renderTracks();
      if (!playlist.tracks.length) return status("playlist-status", nonLus.trim());
    }
    // Bibliothèque des sons : chaque morceau du blind test y est rangé avec ses préréglages ; une chanson changée
    // met à jour les autres playlists qui la reprennent.
    if (!statues) {
      for (const t of playlist.tracks) await rangerChanson(t, seconds, before, changed);
      const reste = [...fichiers.keys()];
      for (const [k, t] of reste.entries()) await rangerEntiere(t, fichiers, entieres, `${k + 1} / ${reste.length}`);
    }
    if (library) {
      histPlaylist.enregistre();
      renderTracks();
      await followSongs(changed, null);
      status("playlist-status", playlist.single ? "Réglages enregistrés. Les playlists qui ont cette chanson les suivent."
        : `Bibliothèque à jour : ${plural(playlist.tracks.length, "chanson")} rangée${playlist.tracks.length > 1 ? "s" : ""}.${nonLus}`, !illisibles.length);
      return true;
    }
    const id = playlist.id ?? push(ref(db, "library/playlists")).key;
    await set(ref(db, `library/playlists/${id}`), {
      title, duration: seconds, ...(statues ? { use: "statues" } : scaleInputs()),
      tracks: playlist.tracks.map((t) => ({
        title: t.title.trim().slice(0, 80), audioId: t.audioId,
        ...(t.artist.trim() ? { artist: t.artist.trim().slice(0, 80) } : {}),
        ...(t.rights.trim() ? { rights: t.rights.trim().slice(0, 120) } : {}),
        ...(t.points ? { points: t.points } : {}),
        ...(t.imageId ? { imageId: t.imageId } : {}),
        ...(t.duration && t.duration !== seconds ? { duration: t.duration } : {}),
        ...(!statues && t.refrainId ? { refrainId: t.refrainId } : {}),
        ...(!statues && t.refrainId && typeof t.paroles === "string" && t.paroles ? { paroles: t.paroles.slice(0, 8000) } : {}),
        ...(!statues && t.songId ? { songId: t.songId } : {}),
      })),
      createdAt: playlists[id]?.createdAt ?? Date.now(), updatedAt: serverTimestamp(),
    });
    playlist.id = id;
    await followSongs(changed, id);
    histPlaylist.enregistre();
    $("playlist-delete").hidden = false;
    $("playlist-edit-title").textContent = title;
    renderTracks();
    status("playlist-status", (statues
      ? `Enregistrée : ${plural(playlist.tracks.length, "chanson")}. Cochez-les dans une manche « Statues musicales » de la prestation.`
      : `Enregistrée : ${playlist.tracks.length} morceau${playlist.tracks.length > 1 ? "x" : ""}. Ajoutez-la à une prestation comme manche « Blind test » ou « Quiz musical ».`) + nonLus, !illisibles.length);
    return true;
  } catch (err) {
    console.error(err);
    status("playlist-status", "Enregistrement refusé : vérifiez Internet ou reconnectez-vous, puis « Enregistrer » reprend où il s'est arrêté.");
    return false;
  } finally {
    $("playlist-save").disabled = false;
  }
}

/**
 * Chanson rangée dans la bibliothèque : son fichier entier est gardé sur ce PC, et la chanson entière préparée est
 * envoyée en ligne (une seule fois). [ou] : « 3 / 10 », pour l'avancement.
 */
async function rangerEntiere(t, fichiers, entieres, ou) {
  if (!t.songId || !fichiers.has(t)) return;
  const fichier = fichiers.get(t);
  fichiers.delete(t);
  await garderSurCePC(t.songId, fichier);
  const entiere = entieres.get(t);
  if (!entiere) return;
  entieres.delete(t);
  status("playlist-status", `Envoi de la chanson entière ${ou} : ${t.title}…`, true);
  await envoyerEntiere(t.songId, entiere);
}

/**
 * Range un morceau prêt (extraits découpés) dans la bibliothèque des sons : sa chanson est créée ou mise à jour, avec
 * le fichier .lrc entier s'il est nouveau. Sans changement, rien n'est écrit. Note la chanson dans [changed].
 */
async function rangerChanson(t, seconds, before, changed) {
  if (!t.audioId) return;
  const songId = t.songId && songs[t.songId] ? t.songId : push(ref(db, "library/songs")).key;
  const old = songs[songId];
  const song = songData(t, seconds, old);
  // Le fichier .lrc entier, gardé pour recaler les paroles quand le refrain change.
  if (t.lrcNeuf && t.lrcTexte) {
    await set(ref(db, `library/lyrics/${songId}`), t.lrcTexte);
    delete t.lrcNeuf;
  }
  if (!sameSong(old, song)) {
    await set(ref(db, `library/songs/${songId}`), { ...song, ...(old?.retiree === true ? { retiree: true } : {}), createdAt: old?.createdAt ?? Date.now(), updatedAt: serverTimestamp() });
    if (!changed.some((c) => c.songId === songId)) changed.push({ songId, song, audioIds: [before.get(t), t.audioId, old?.audioId].filter(Boolean) });
    else Object.assign(changed.find((c) => c.songId === songId), { song });
  }
  t.songId = songId;
}

/** Chansons changées : les morceaux des autres playlists qui les reprennent suivent (sauf la playlist [exceptId]). */
async function followSongs(changed, exceptId) {
  const others = Object.fromEntries(Object.entries(playlists).filter(([pid]) => pid !== exceptId));
  const paths = {};
  changed.forEach(({ songId, song, audioIds }) => Object.assign(paths, songUpdates(songId, song, others, serverTimestamp(), audioIds, isStatuesList)));
  if (!Object.keys(paths).length) return;
  try {
    await update(ref(db), paths);
  } catch (err) {
    console.error(err);
    status("playlist-status", "Enregistré ; les autres playlists n'ont pas pu suivre ces réglages (Internet ?). Réessayez d'enregistrer.");
  }
}

$("playlist-delete").onclick = async () => {
  if (!playlist?.id || !await deletePlaylist(playlist.id)) return;
  histPlaylist.abandonner();
  show(playlist.use === "statues" ? "game" : "music");
};

async function deletePlaylist(id) {
  const ids = new Set(playableTracks(playlists[id]).map((t) => t.audioId));
  const used = Object.values(shows).filter((s) => (s.rounds ?? []).some((r) => r?.playlistId === id || (r?.type === "statues" && (r.songs ?? []).some((x) => ids.has(x))))).map(showTitle);
  const warning = used.length ? `\n\nAttention, elle est utilisée par : ${used.join(", ")}.` : "";
  if (!(await confirmer(`Supprimer ${isStatuesList(playlists[id]) ? "la liste des chansons des statues" : "la playlist"} « ${playlists[id]?.title ?? ""} » ?${warning}`, { ok: "Supprimer", danger: true }))) return false;
  await set(ref(db, `library/playlists/${id}`), null);
  return true;
}

// ---------- Bibliothèque : images (émojis, photos libres, les siennes) et sons ----------

/** Onglet ouvert de la bibliothèque : « images » ou « sons ». */
let libTab = "images";
/** Groupe d'images ouvert : null (tous en aperçu), « emojis », « photos », « miennes » ou « pochettes ». */
let mediaGroupe = null;
/** Catégorie choisie dans le groupe ouvert (null : toutes) ; RETIREES : ses images retirées. */
let mediaCat = null;
const RETIREES = "retirees";
/** Images montrées par groupe dans l'aperçu ; fiches de ses images montrées d'un coup (la recherche trouve les autres). */
const APERCU = 20;
const MAX_FICHES = 120;
/** Fiches montrées dans la liste ouverte (cedric, 26/10 : voir toutes ses images, page après page), par liste. */
let fichesMontrees = { cle: "", n: MAX_FICHES };
const NOUVELLE_CAT = "＋ Nouvelle catégorie…";
const AUCUNE_IMAGE_PACK = "Aucune image de pack pour l'instant : elles arrivent toutes seules avec les packs importés (Bibliothèque › ❓ Questions, « 📦 Importer un pack ZIP »).";
const AUCUNE_POCHETTE = "Aucune pochette pour l'instant : elles arrivent toutes seules avec les chansons (Bibliothèque › 🎵 Sons).";

function openLibrary(tab) {
  libTab = tab;
  show("library");
}
$("music-songs").onclick = () => openLibrary("sons");
document.querySelectorAll("#library-tabs [data-lib-tab]").forEach((b) => {
  b.onclick = () => { const y = window.scrollY; libTab = b.dataset.libTab; renderLibrary(true); noterRubrique(y); };
});

/** [force] : redessiner même si une fiche est en cours de saisie (choix de Sarah, pas un changement venu de la base). */
function renderLibrary(force = false) {
  document.querySelectorAll("#library-tabs [data-lib-tab]").forEach((b) => {
    const on = b.dataset.libTab === libTab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  $("library-images").hidden = libTab !== "images";
  $("library-sons").hidden = libTab !== "sons";
  $("library-questions").hidden = libTab !== "questions";
  if ($("q-importer-haut")) $("q-importer-haut").hidden = libTab !== "questions";
  if (libTab === "sons") { renderPlaylistsSons(); renderSongs(); }
  else if (libTab === "questions") renderQuestions();
  else renderMedias(force);
}

// ---------- Bibliothèque › Sons : mes playlists (cedric, 24/10) ----------

/** Playlists dépliées dans Bibliothèque › Sons (le temps de l'écran). */
const playlistsDepliees = new Set();
/** Chanson de la bibliothèque d'un morceau de playlist : par son identifiant, sinon par son extrait. */
function chansonDuMorceau(t) {
  if (t?.songId && chansonJouable(songs?.[t.songId])) return t.songId;
  return Object.entries(songs ?? {}).find(([, x]) => chansonJouable(x) && x.audioId === t?.audioId)?.[0] ?? null;
}

/**
 * Change les chansons d'une playlist de la bibliothèque : [ids] (dans l'ordre voulu) remplacent celles d'avant. Les
 * morceaux gardés ne bougent pas (leurs points, leur place), ni ceux d'avant la bibliothèque des sons ; les nouvelles
 * chansons se mettent à la fin. Une playlist garde au moins une chanson.
 */
async function changerChansonsPlaylist(id, ids) {
  const p = playlists[id];
  if (!p) return false;
  const pistes = Array.isArray(p.tracks) ? p.tracks : Object.values(p.tracks ?? {});
  const avant = new Set(chansonsDePlaylist(p));
  const voulues = new Set(ids);
  const gardees = pistes.filter((t) => { const k = chansonDuMorceau(t); return !k || !avant.has(k) || voulues.has(k); });
  const tracks = [...gardees, ...ids.filter((k) => !avant.has(k) && chansonJouable(songs[k])).map((k) => trackFromSong({ ...songs[k], id: k }))];
  if (!tracks.length) {
    await avertir("Une playlist garde au moins une chanson : pour la vider, supprimez-la (« Supprimer »).");
    return false;
  }
  try {
    await update(ref(db, `library/playlists/${id}`), { tracks, updatedAt: serverTimestamp() });
    return true;
  } catch (err) {
    console.error(err);
    await avertir("Playlist pas enregistrée : vérifiez Internet ou reconnectez-vous.");
    return false;
  }
}

/** « ＋ Créer une playlist » : son nom, puis ses chansons cochées dans la bibliothèque des sons. */
async function creerPlaylistSons() {
  const nom = await demanderTexte("Nom de la nouvelle playlist :", "", { ok: "Choisir ses chansons", maxlength: 120 });
  const title = nom?.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!title) return;
  const ids = await choisirChansons({ titre: `Chansons de la playlist « ${title} »`, plusieurs: true });
  if (!ids?.length) return;
  try {
    const nouvelle = push(ref(db, "library/playlists"));
    // Dépliée d'office (avant l'écriture : la liste se redessine dès qu'elle arrive).
    playlistsDepliees.add(nouvelle.key);
    await set(nouvelle, { title, duration: BLIND_SEC, tracks: ids.map((k) => trackFromSong({ ...songs[k], id: k })), updatedAt: serverTimestamp() });
    renderPlaylistsSons();
    status("song-status", `Playlist « ${title} » créée : ${ids.length} chanson${ids.length > 1 ? "s" : ""}.`, true);
  } catch (err) {
    console.error(err);
    await avertir("Playlist pas enregistrée : vérifiez Internet ou reconnectez-vous.");
  }
}
$("sons-playlist-new").onclick = creerPlaylistSons;

/**
 * « 🎶 Mes playlists » en haut de Bibliothèque › Sons : chacune se déplie (ses chansons : pochette, titre, paroles,
 * ✕), « 🎵 Ajouter des chansons » (cases à cocher ; cedric, 24/10 : la playlist existe déjà), « Renommer », « Supprimer ».
 */
function renderPlaylistsSons() {
  const box = $("sons-playlist-list");
  const list = Object.entries(playlists ?? {}).filter(([, p]) => p?.title && !isStatuesList(p))
    .sort(([, a], [, b]) => a.title.localeCompare(b.title, "fr", { sensitivity: "base" }));
  box.replaceChildren(...list.map(([id, p]) => {
    const ids = chansonsDePlaylist(p);
    const ouverte = playlistsDepliees.has(id);
    const autres = playableTracks(p).length - ids.length;
    const texte = `${ouverte ? "▾" : "▸"} 🎶 ${p.title} · ${ids.length} chanson${ids.length > 1 ? "s" : ""}${autres > 0 ? ` (+ ${autres} hors bibliothèque des sons)` : ""}`;
    const lignes = ouverte ? ids.map((k) => {
      const song = songs[k];
      const paroles = parolesSurTv(song);
      return h("li", { class: "tirage-q sons-playlist-chanson", "data-chanson": k },
        h("div", { class: "tirage-q-ligne" },
          miniPochette(song),
          h("span", { class: "tirage-texte" }, h("b", { text: song.title.trim() }), song.artist?.trim() ? h("span", { class: "hint", text: ` · ${song.artist.trim()}` }) : null),
          h("span", { class: `blind-paroles${paroles ? " ok" : " non"}`, text: paroles ? "✓ Paroles" : "✗ Pas de paroles" }),
          h("button", { type: "button", class: "icon tirage-retirer", text: "✕", "aria-label": `Retirer « ${song.title.trim()} » de la playlist`, title: "Retirer cette chanson de la playlist",
            onclick: () => changerChansonsPlaylist(id, ids.filter((x) => x !== k)) })));
    }) : [];
    return h("div", { class: "serie sons-playlist", "data-playlist": id },
      h("div", { class: "serie-tete" },
        h("button", { type: "button", class: "chip tirage-voir serie-voir sons-playlist-voir", "aria-expanded": ouverte ? "true" : "false", text: texte,
          title: "Voir ou cacher les chansons de cette playlist",
          onclick: () => { if (ouverte) playlistsDepliees.delete(id); else playlistsDepliees.add(id); renderPlaylistsSons(); } }),
        h("button", { type: "button", class: "btn small secondary sons-playlist-choisir", text: "🎵 Ajouter des chansons", title: "Cocher ou décocher les chansons de cette playlist",
          onclick: async () => {
            const choix = await choisirChansons({ titre: `Chansons de la playlist « ${p.title} »`, plusieurs: true, cochees: ids });
            if (!choix) return;
            if (await changerChansonsPlaylist(id, choix)) { playlistsDepliees.add(id); renderPlaylistsSons(); }
          } }),
        h("button", { type: "button", class: "btn small secondary", text: "Renommer", onclick: () => rename(`library/playlists/${id}`, p.title, "de la playlist") }),
        h("button", { type: "button", class: "btn small danger", text: "Supprimer", onclick: () => deletePlaylist(id) })),
      ouverte ? h("ol", { class: "tirage-liste serie-liste sons-playlist-liste" }, ...lignes) : null);
  }));
  if (!list.length) box.append(h("p", { class: "hint small", text: "Pas encore de playlist : « ＋ Créer une playlist », puis cochez ses chansons." }));
}

// ---------- Bibliothèque › Questions (cedric, 22/10) ----------

/** Groupe ouvert : null (tous en aperçu) ou une clé de GROUPES_QUESTIONS ; pack ouvert ; famille ou thème choisi. */
let qGroupe = null;
/** Rubriques dépliées dans l'aperçu de Bibliothèque › Questions (toutes repliées à l'ouverture de la page). */
const qOuverts = new Set();
/** Mes thèmes, Mes séries de photos (cedric, 25/10) : thèmes dépliés (leurs clés), et le niveau choisi (null : tous). */
const qThemesOuverts = new Set();
let qNiveauPack = null;
let qPack = null;
let qCategorie = null;
/** Quiz classique tout prêt : toutes, les questions à 4 réponses (« qcm ») ou les Juste Chiffre (« nombre ») ; un niveau. */
let qType = null;
let qNiveau = null;
/** Packs importés à l'instant : encadrés quelques secondes en tête de liste. */
let packsNouveaux = new Set();
/** Questions toutes prêtes du quiz illustré : fabriquées une fois (leurs mauvaises réponses sont tirées au hasard). */
let illustreesCache = null;
const classiquesPretes = questionsClassiquesPretes();
const vraiFauxPrets = questionsVraiFauxPretes();
/** Ses questions cochées (clés « quiz/numéro »), à supprimer ensemble ; celles de la liste affichée. */
const qSelection = new Set();
let qListees = [];
const QUESTIONS_APERCU = 4;
const QUESTIONS_MAX = 300;

function groupesQuestions() {
  illustreesCache ??= questionsIllustreesPretes();
  return { classiques: classiquesPretes, illustrees: illustreesCache, vraifaux: vraiFauxPrets, miennes: mesQuestions(quizzes), packs: mesPacks(quizzes), photos: mesSeriesDePhotos(quizzes), tests: questionsDeTest(quizzes) };
}

/** Vignette de l'illustration : sa photo, son émoji, la photo de la banque de la bonne réponse, sinon « ⚠ ». */
function illustrationQuestion(x) {
  if (x.imageId) return photoBibliotheque(x.imageId, { class: "q-illus" });
  if (x.photo) return h("img", { class: "q-illus", src: x.photo, alt: "", loading: "lazy" });
  if (x.image) return h("span", { class: "q-illus emoji", text: x.image });
  const photo = x.choiceImages?.[x.correct] ?? null;
  if (photo) return photoBibliotheque(photo, { class: "q-illus" });
  if (x.banque?.[0]) return h("img", { class: "q-illus", src: `banque/${x.banque[0]}.jpg`, alt: "", loading: "lazy" });
  if (x.banqueEmojis?.[0]) return h("span", { class: "q-illus emoji", text: x.banqueEmojis[0] });
  // Vrai ou Faux tout prêt : une affirmation, sans image.
  if (x.vraiFaux) return h("span", { class: "q-illus emoji", title: "Vrai ou Faux : sans image", text: "✅" });
  // Juste Chiffre sans émoji : la TV montre son compteur qui tourne.
  if (x.nombre) return h("span", { class: "q-illus emoji compteur", title: "Le compteur du Juste Chiffre", text: "🔢" });
  return h("span", { class: "q-illus vide", title: "Pas d'illustration", text: "⚠" });
}

/** Une réponse : sa petite photo s'il y en a une, son texte ; la bonne réponse est marquée. */
function reponseQuestion(x, c, k) {
  const photo = x.choiceImages?.[k] ? photoBibliotheque(x.choiceImages[k], { class: "q-mini" })
    : x.banque?.[k] ? h("img", { class: "q-mini", src: `banque/${x.banque[k]}.jpg`, alt: "", loading: "lazy" })
      : x.banqueEmojis?.[k] ? h("span", { class: "q-mini emoji", text: x.banqueEmojis[k] }) : null;
  return h("li", { class: k === x.correct ? "juste" : "" }, photo, h("span", { text: `${k === x.correct ? "✓ " : ""}${c}` }));
}

/**
 * Les thèmes de ses packs qui ont des questions pour la banque [groupe] (Quiz classique, Quiz illustré, Vrai ou Faux) :
 * thème → ses questions (tous niveaux, tous ses packs), dans l'ordre des thèmes.
 */
function themesDesPacks(cartes, groupe, filtre) {
  const epreuve = { classiques: "quiz", illustrees: "illustre", vraifaux: "vraifaux" }[groupe];
  const out = new Map();
  if (!epreuve) return out;
  for (const p of [...cartes].sort((a, b) => themeDe(a.theme, a.title).localeCompare(themeDe(b.theme, b.title), "fr"))) {
    if (!quizzes[p.id] || epreuveDuQuiz(quizzes[p.id]) !== epreuve) continue;
    const qs = filtre(p.questions);
    const t = themeExistant(themeDe(p.theme, p.title), [...out.keys()]);
    if (qs.length) out.set(t, [...(out.get(t) ?? []), ...qs]);
  }
  return out;
}

/** Le niveau d'une question de la bibliothèque : le sien, sinon celui de son quiz ; la banque : 1, 2 ou 3 ; null sinon. */
function niveauDeLaQuestion(x) {
  if (x.quizId) return lireNiveau(quizzes[x.quizId]?.questions?.[x.index]?.niveau) ?? niveauDuQuiz(quizzes[x.quizId]);
  if (Number.isInteger(x.niveau)) return NIVEAUX[x.niveau - 1] ?? null;
  return x.groupe === "illustrees" ? "Facile" : null;
}
const agesDuNiveau = (n) => (AGES_NIVEAU[n] ? `${AGES_NIVEAU[n][0]}-${AGES_NIVEAU[n][1]} ans` : "");

/**
 * Pastille du niveau d'une question (cedric, 25/10 : « quelle tranche d'âge elle concerne », modifiable) : sur ses
 * questions (packs, en vrac), un choix qui l'enregistre dans la question ; la banque de l'appli, en lecture seule.
 */
function badgeNiveau(x) {
  const niveau = niveauDeLaQuestion(x);
  if (!x.quizId) return niveau ? h("span", { class: "q-niveau", "data-niveau": niveau, title: "Niveau de la banque de l'appli", text: `${niveau} · ${agesDuNiveau(niveau)}` }) : null;
  return h("select", {
    class: "q-niveau q-niveau-choix", "data-niveau": niveau ?? "", "aria-label": `Niveau de « ${x.text} »`, title: "Changer le niveau de cette question",
    onchange: async (e) => {
      const n = e.target.value;
      e.target.dataset.niveau = n;
      try {
        await update(ref(db, `library/quizzes/${x.quizId}`), { [`questions/${x.index}/niveau`]: n, updatedAt: serverTimestamp() });
        annonce(`« ${x.text.slice(0, 60)} » : ${n} (${agesDuNiveau(n)}).`, true);
      } catch (err) {
        console.error(err);
        annonce("Le niveau n'a pas pu être enregistré : vérifiez la connexion.");
      }
    },
  }, ...(niveau ? [] : [h("option", { value: "", selected: true, disabled: true, text: "Niveau ?" })]),
  ...NIVEAUX.map((n) => h("option", { value: n, selected: n === niveau, text: `${n} · ${agesDuNiveau(n)}` })));
}

function ligneQuestion(x) {
  const quiz = x.quizId ? quizzes[x.quizId] : null;
  // Ses questions (pas celles toutes prêtes de l'appli) se cochent pour être supprimées ensemble.
  const coche = quiz ? h("input", {
    type: "checkbox", class: "q-coche", checked: qSelection.has(x.cle), "aria-label": `Cocher « ${x.text} »`,
    onchange: (e) => { if (e.target.checked) qSelection.add(x.cle); else qSelection.delete(x.cle); barreSelection(); },
  }) : null;
  return h("div", { class: `q-item${x.ok ? "" : " sans-illus"}${qSelection.has(x.cle) ? " cochee" : ""}`, "data-question": x.cle },
    coche,
    illustrationQuestion(x),
    h("div", { class: "q-corps" },
      h("b", { class: "q-texte", text: x.text || "(question sans texte)" }),
      x.nombre ? h("p", { class: "q-nombre", text: `Le Juste Chiffre · réponse : ${x.correct}` })
        : h("ul", { class: "q-reponses" }, ...x.choices.map((c, k) => reponseQuestion(x, c, k))),
      h("div", { class: "q-pied" },
        x.ok ? null : h("span", { class: "q-alerte", text: `⚠ ${x.manque}` }),
        x.validee ? null : h("span", { class: "q-a-valider", text: "À valider" }),
        badgeNiveau(x),
        h("span", { class: "hint small", text: x.source ?? "" }),
        quiz ? h("button", { type: "button", class: "btn small secondary", text: "Éditer", onclick: () => review(x.quizId, quiz) }) : null,
        quiz ? h("button", { type: "button", class: "btn small danger", text: "Supprimer", onclick: () => supprimerQuestions([x]) }) : null)));
}

/** Ses questions, toutes (en vrac, dans les packs, de test) : pour retrouver celles qui sont cochées. */
const toutesMesQuestions = () => [...mesQuestions(quizzes), ...[...mesPacks(quizzes), ...mesSeriesDePhotos(quizzes)].flatMap((p) => p.questions), ...questionsDeTest(quizzes)];

/** Barre des questions cochées : combien, tout cocher ici, tout décocher, supprimer. */
function barreSelection() {
  const mes = new Set(toutesMesQuestions().map((x) => x.cle));
  [...qSelection].filter((k) => !mes.has(k)).forEach((k) => qSelection.delete(k));
  $("q-selection").hidden = !qSelection.size;
  $("q-selection-n").textContent = `${plural(qSelection.size, "question cochée", "questions cochées")}`;
  $("q-tout").hidden = !qListees.length || qListees.every((x) => qSelection.has(x.cle));
  document.querySelectorAll("#q-list .q-item[data-question]").forEach((el) => {
    const on = qSelection.has(el.dataset.question);
    el.classList.toggle("cochee", on);
    const box = el.querySelector(".q-coche");
    if (box) box.checked = on;
  });
}
$("q-tout").onclick = () => { qListees.forEach((x) => qSelection.add(x.cle)); barreSelection(); };
$("q-aucune").onclick = () => { qSelection.clear(); barreSelection(); };
$("q-supprimer").onclick = () => {
  const cles = new Set(qSelection);
  supprimerQuestions(toutesMesQuestions().filter((x) => cles.has(x.cle)));
};

/**
 * Supprime ses questions de leurs quiz, après confirmation. Un quiz qui n'a plus de question est supprimé aussi (la
 * fenêtre le dit, comme les prestations qui l'utilisent). Les images restent dans la Bibliothèque › Images.
 */
async function supprimerQuestions(liste) {
  if (!liste.length) return;
  const { ecritures, vides, n } = retirerQuestions(quizzes, liste);
  if (!n) return status("q-status", "Ces questions ont changé entre-temps : rien n'est supprimé, regardez la liste à jour.");
  const titre = (id) => `« ${quizzes[id]?.title ?? "sans titre"} »`;
  const utilisePar = Object.keys(ecritures).flatMap((id) => Object.values(shows)
    .filter((sh) => (sh.rounds ?? []).some((r) => r && roundQuizIds(r).includes(id))).map((sh) => `${showTitle(sh)} (quiz ${titre(id)})`));
  const message = [
    n === 1 ? `Supprimer la question « ${liste[0].text || "sans texte"} » ?` : `Supprimer ${n} questions ?`,
    vides.length ? `${vides.length > 1 ? "Les quiz" : "Le quiz"} ${vides.map(titre).join(", ")} n'${vides.length > 1 ? "ont" : "a"} plus d'autre question : ${vides.length > 1 ? "ils seront supprimés" : "il sera supprimé"} aussi.` : null,
    utilisePar.length ? `Attention, c'est utilisé par : ${[...new Set(utilisePar)].join(", ")}.` : null,
  ].filter(Boolean).join("\n\n");
  if (!(await confirmer(message, { ok: "Supprimer", danger: true }))) return;
  try {
    for (const [id, questions] of Object.entries(ecritures)) {
      if (questions) await update(ref(db, `library/quizzes/${id}`), { questions, updatedAt: serverTimestamp() });
      else await set(ref(db, `library/quizzes/${id}`), null);
    }
  } catch (err) {
    console.error(err);
    return status("q-status", "Suppression refusée : vérifiez Internet ou reconnectez-vous, puis recommencez.");
  }
  qSelection.clear();
  if (qPack && vides.includes(qPack)) qPack = null;
  status("q-status", `${n === 1 ? "Question supprimée" : `${n} questions supprimées`}${vides.length ? ` (et ${vides.length > 1 ? "les quiz" : "le quiz"} vidé${vides.length > 1 ? "s" : ""})` : ""}.`, true);
  renderQuestions();
}

/** Un pack importé ou une série de photos : rangé par famille et par niveau dans la Bibliothèque. */
const estPackOuSerie = (quiz) => quiz?.pack === true || quiz?.source === "json" || quiz?.source === "photos" || quizKind(quiz ?? {}) === "images";

/**
 * Le jeu d'un pack, écrit sur sa carte (cedric, 25/10 : « qu'est-ce qui fait que c'est relié à un quiz illustré ou à un
 * quiz normal ? ») : reconnu à l'import, et c'est ce jeu-là seulement qui le propose dans une prestation.
 */
function jeuDuPack(quiz) {
  const epreuve = epreuveDuQuiz(quiz);
  return epreuve === "vraifaux" ? "✅ Vrai ou Faux express" : epreuve === "quiz" ? QUIZ_KINDS.classique : QUIZ_KINDS[quizKind(quiz)];
}

/** L'épreuve d'un quiz enregistré, comme à l'import d'un pack : quiz, illustre, vraifaux ou photos. */
function epreuveDuQuiz(quiz) {
  const kind = quizKind(quiz);
  if (kind === "photo") return "illustre";
  if (kind === "images") return "photos";
  const qs = (quiz.questions ?? []).filter((q) => q && q.kind !== "number");
  const vraiFaux = (q) => (q.choices ?? []).map((c) => `${c}`.trim().toLowerCase()).join("/") === "vrai/faux";
  return qs.length && qs.every(vraiFaux) ? "vraifaux" : "quiz";
}

/**
 * Images hors format d'un pack (cedric, 25/10), notées à l'import : celles qu'il montre encore, à leur place
 * (`{ q, case, message }`). Une image remplacée dans « Éditer » emporte son alerte.
 */
function horsFormatDu(quiz) {
  const notes = quiz?.imagesHorsFormat ?? {};
  if (!Object.keys(notes).length) return [];
  return (quiz.questions ?? []).flatMap((q, i) => [
    ...(notes[q?.imageId] ? [{ q: i, case: null, message: notes[q.imageId] }] : []),
    ...Object.entries(q?.choiceImages ?? {}).filter(([, id]) => notes[id]).map(([k, id]) => ({ q: i, case: Number(k), message: notes[id] })),
  ]);
}
const ouImage = (quiz, x) => (quizKind(quiz) === "images" ? `Photo ${x.q + 1}` : ouQuestion(x.q, x.case));

/** Pastille de couleur d'un niveau (vert Facile, bleu Moyen, violet Difficile). */
const pastilleNiveau = (niveau) => h("span", { class: "pastille-niveau", "data-niveau": niveau, "aria-hidden": "true" });

/** Les thèmes de ses packs et séries de photos, tels qu'ils s'écrivent (pour l'import, l'éditeur, le renommage). */
const themesExistants = () => parTheme([...mesPacks(quizzes), ...mesSeriesDePhotos(quizzes)]).map(([t]) => t);

/**
 * Renommer un thème (cedric, 25/10 : créer, renommer, fusionner à la main) : tous ses packs prennent le nouveau nom ;
 * le nom d'un autre thème (« kpop » pour « K-pop ») les y range : les deux thèmes n'en font plus qu'un.
 */
async function renommerTheme(nom, cartes) {
  const tape = await demanderTexte(`Nouveau nom du thème « ${nom} » :\n\nLe nom d'un autre de vos thèmes y range ces ${plural(cartes.length, "pack")} (les deux thèmes n'en font plus qu'un).`, nom, { ok: "Renommer", maxlength: 80 });
  if (tape == null || !tape.trim() || tape.trim() === nom) return;
  const cible = themeExistant(tape, themesExistants().filter((t) => t !== nom));
  const ecritures = Object.fromEntries(cartes.flatMap((c) => [[`library/quizzes/${c.id}/theme`, cible], [`library/quizzes/${c.id}/updatedAt`, serverTimestamp()]]));
  // Ses images nommées à l'import (même celles qu'aucun pack ne cite) suivent le thème.
  for (const [id, f] of Object.entries(medias ?? {})) {
    const t = themeDeFiche(f);
    if (t != null && (f.cat === catDePack(nom) || cleTheme(t) === cleTheme(nom))) Object.assign(ecritures, { [`library/medias/${id}/cat`]: catDePack(cible), [`library/medias/${id}/updatedAt`]: serverTimestamp() });
  }
  try {
    await update(ref(db), ecritures);
    qThemesOuverts.add(cleTheme(cible));
    annonce(cleTheme(cible) !== cleTheme(tape) || themesExistants().some((t) => t !== cible && cleTheme(t) === cleTheme(cible))
      ? `« ${nom} » rangé dans « ${cible} ».` : `Thème renommé : « ${cible} ».`, true);
  } catch (err) {
    console.error(err);
    annonce("Le thème n'a pas pu être renommé : vérifiez la connexion.");
  }
}

/**
 * Les personnages de Qui suis-je ? venus de mes packs (cedric, 26/10 : ils restaient après « 🗑 Supprimer », avec leurs
 * images) : ceux que [retirer](personnage, son image) désigne partent ; rend `{ retires, images, contenu }`, [contenu] :
 * library/contents/quisuis sans eux (null si rien ne part).
 */
function persosARetirer(retirer) {
  const c = contents.quisuis ?? {};
  const jeu = CONTENT_GAMES.quisuis;
  const extra = Array.isArray(c.extra) ? c.extra : Object.values(c.extra ?? {});
  const images = { ...(c.images ?? {}) };
  const retires = extra.filter((x) => x && retirer(x, images[contentSlot(jeu.key(x))] ?? null));
  if (!retires.length) return { retires, images: [], contenu: null };
  const ids = retires.map((x) => images[contentSlot(jeu.key(x))]).filter((id) => typeof id === "string");
  for (const x of retires) delete images[contentSlot(jeu.key(x))];
  const reste = extra.filter((x) => x && !retires.includes(x));
  return { retires, images: ids, contenu: { ...c, extra: reste.length ? reste : null, images: Object.keys(images).length ? images : null, updatedAt: serverTimestamp() } };
}

/**
 * « 🗑 Supprimer ce thème » (cedric, 26/10 : effacer les anciens packs Mario, leurs questions et leurs photos avant
 * d'importer les nouveaux) : tous ses packs et séries de photos, et les images qui ne servent qu'à eux, en un seul envoi.
 * Mes images, les autres thèmes et les séries déjà copiées dans une prestation ne bougent pas.
 */
async function supprimerTheme(nom, bloc = null) {
  const cle = cleTheme(nom) || nom;
  const duNom = parTheme([...mesPacks(quizzes), ...mesSeriesDePhotos(quizzes)]).find(([t]) => (cleTheme(t) || t) === cle)?.[1] ?? [];
  // Un seul bloc du thème (cedric, 26/10 : un jeu, un niveau) : ses packs seulement, le reste du thème ne bouge pas.
  const cartes = bloc ? duNom.filter((c) => bloc.ids.includes(c.id)) : duNom;
  if (!cartes.length) return;
  const ids = new Set(cartes.map((c) => c.id));
  const packs = Object.fromEntries([...ids].map((id) => [id, quizzes[id]]));
  const duTheme = (f) => { const t = themeDeFiche(f); return t != null && (f.cat === catDePack(nom) || (cleTheme(t) || t) === cle); };
  // Sa « 🧪 Test packs » (Paramètres) : une copie pour essayer le thème, qui part avec lui et ne garde pas ses images.
  const test = !bloc && shows[idTestDuTheme(nom)] ? idTestDuTheme(nom) : null;
  const autresShows = Object.fromEntries(Object.entries(shows).filter(([id]) => id !== test));
  // Ses jeux gardés à l'enregistrement (« manches », avec son showId) partent avec elle.
  const manchesTest = bloc ? [] : Object.keys(manches ?? {}).filter((id) => manches[id]?.showId === idTestDuTheme(nom));
  const autresManches = Object.fromEntries(Object.entries(manches ?? {}).filter(([id]) => !manchesTest.includes(id)));
  // Ses personnages de Qui suis-je ? : leur série porte le nom du thème, ou leur image y est rangée.
  const qui = bloc ? persosARetirer(() => false) : persosARetirer((x, img) => (cleTheme(x.serie ?? "") || x.serie) === cle || (img != null && duTheme(medias[img])));
  const resteContents = qui.contenu ? { ...contents, quisuis: qui.contenu } : contents;
  const ailleurs = { quizzes: Object.fromEntries(Object.entries(quizzes).filter(([id]) => !ids.has(id))), shows: autresShows, manches: autresManches, mimes, contents: resteContents, songs, playlists };
  const avecPersos = { ...packs, "\u0000qui": qui.images };
  const images = imagesDuTheme({ packs: avecPersos, medias, duTheme, ailleurs });
  const gardees = imagesDuTheme({ packs: avecPersos, medias, duTheme }).length - images.length;
  const questions = cartes.reduce((t, c) => t + (c.total ?? 0), 0);
  const utilisent = Object.values(autresShows).filter((s) => (s.rounds ?? []).some((r) => roundQuizIds(r).some((id) => ids.has(id)))).map(showTitle);
  const message = (bloc ? `Supprimer « ${bloc.titre} » ?\n\n${plural(questions, bloc.photos ? "photo" : "question")} et ${plural(images.length, "image")} partent de la bibliothèque, pour de bon.`
    : `Supprimer le thème « ${nom} » ?\n\n${plural(cartes.length, "pack")} (${plural(questions, "question")}) et ${plural(images.length, "image")} partent de la bibliothèque, pour de bon.`)
    + (qui.retires.length ? `\n\n${plural(qui.retires.length, "personnage", "personnages")} de Qui suis-je ? ${qui.retires.length > 1 ? "partent" : "part"} aussi.` : "")
    + (test ? `\n\nSa prestation de test « ${showTitle(shows[test])} » part aussi.` : "")
    + (gardees ? `\n\n${plural(gardees, "image reste", "images restent")} : une prestation ou un autre pack s'en sert.` : "")
    + "\n\nMes images, les autres thèmes et les questions déjà copiées dans une prestation ne changent pas."
    + (utilisent.length ? `\n\nAttention, ${utilisent.length > 1 ? "ces prestations utilisent" : "cette prestation utilise"} un de ces packs : ${utilisent.join(", ")}.` : "");
  if (!(await confirmer(message, { ok: bloc ? "Supprimer" : "Supprimer le thème", danger: true }))) return;
  const ecritures = {};
  if (test) ecritures[`library/shows/${test}`] = null;
  for (const id of manchesTest) ecritures[`library/manches/${id}`] = null;
  if (qui.contenu) ecritures["library/contents/quisuis"] = qui.contenu;
  for (const id of ids) ecritures[`library/quizzes/${id}`] = null;
  for (const id of images) { ecritures[`library/images/${id}`] = null; ecritures[`library/medias/${id}`] = null; }
  try {
    await update(ref(db), ecritures);
    if (bloc) annonce(`✓ « ${bloc.titre} » supprimé : ${plural(questions, bloc.photos ? "photo" : "question")} et ${plural(images.length, "image")}.`, true);
    else {
      qThemesOuverts.delete(cle);
      annonce(`✓ Thème « ${nom} » supprimé : ${plural(cartes.length, "pack")} et ${plural(images.length, "image")}.`, true);
    }
  } catch (err) {
    console.error(err);
    annonce("Le thème n'a pas pu être supprimé : vérifiez la connexion. Rien n'a été changé.");
  }
}

/**
 * Packs (ou séries de photos) rangés par thème (cedric, 25/10 : « le nom du thème directement : Mario, Barbie,
 * K-pop ») : une puce par niveau, puis une ligne repliée par thème, avec son nombre et ses pastilles de niveau ;
 * ▸ la déplie, « ✎ Renommer » renomme le thème ou le range dans un autre.
 */
function packsParTheme(cartes, recherche, vide) {
  const parNiveau = (n) => cartes.filter((c) => c.niveau === n).length;
  const choisies = qNiveauPack ? cartes.filter((c) => c.niveau === qNiveauPack) : cartes;
  const puces = h("div", { class: "chips q-niveaux-packs" },
    h("button", { type: "button", class: `chip${qNiveauPack ? "" : " active"}`, "data-niveau": "tous", text: `Tous les niveaux (${cartes.length})`, onclick: () => { qNiveauPack = null; renderQuestions(); } }),
    ...NIVEAUX.map((n) => h("button", {
      type: "button", class: `chip${qNiveauPack === n ? " active" : ""}`, "data-niveau": n, onclick: () => { qNiveauPack = n; renderQuestions(); },
    }, pastilleNiveau(n), ` ${n} (${parNiveau(n)})`)));
  if (!cartes.length) return [puces, h("p", { class: "hint", text: vide })];
  const themes = parTheme(choisies).map(([t, liste]) => {
    const cle = cleTheme(t) || t;
    // Une recherche déplie les thèmes où elle trouve quelque chose.
    const ouvert = qThemesOuverts.has(cle) || !!recherche;
    const resume = NIVEAUX.map((n) => [n, liste.filter((c) => c.niveau === n).length]).filter(([, k]) => k)
      .map(([n, k]) => h("span", { class: "famille-niveau" }, pastilleNiveau(n), `${k}`));
    const plier = h("button", {
      type: "button", class: "q-plier", "aria-expanded": ouvert ? "true" : "false",
      title: ouvert ? "Replier ce thème" : "Déplier ce thème",
      onclick: () => { if (qThemesOuverts.has(cle)) qThemesOuverts.delete(cle); else qThemesOuverts.add(cle); renderQuestions(); },
    }, h("span", { class: "q-plier-fleche", text: ouvert ? "▾" : "▸" }), h("h2", { text: `🎨 ${t} (${liste.length})` }), h("span", { class: "famille-resume" }, ...resume));
    return h("section", { class: `q-groupe q-theme${ouvert ? " ouvert" : " replie"}`, "data-theme": t },
      h("div", { class: "title-row" }, plier,
        h("button", { type: "button", class: "btn small secondary theme-renommer", text: "✎ Renommer", title: "Renommer ce thème, ou le ranger dans un autre", onclick: () => renommerTheme(t, liste) }),
        h("button", { type: "button", class: "btn small danger theme-supprimer", text: "🗑 Supprimer", title: "Supprimer ce thème : ses packs, leurs questions et leurs images", onclick: () => supprimerTheme(t) })),
      ouvert ? h("div", { class: "cards" }, ...blocsDuTheme(t, liste).map(carteBloc)) : null);
  });
  return [puces, h("div", { class: "q-familles q-themes" }, ...themes)];
}

/**
 * Un thème en blocs (cedric, 26/10 : plus de « Disney 1, Disney 2, Disney 3… ») : un bloc par jeu et par niveau
 * (« Quiz classique · Facile »), qui réunit les questions de tous ses packs. Les blocs vus, par identifiant, pour
 * les ouvrir.
 */
const blocsVus = new Map();
const ORDRE_NIVEAUX = { Facile: 0, Moyen: 1, Difficile: 2 };
function blocsDuTheme(theme, cartes) {
  const blocs = new Map();
  for (const c of cartes) {
    const jeu = jeuDuPack(quizzes[c.id] ?? {});
    const id = `bloc:${cleTheme(theme) || theme}|${jeu}|${c.niveau ?? ""}`;
    if (!blocs.has(id)) blocs.set(id, { id, theme, jeu, niveau: c.niveau ?? null, photos: c.kind === "images", ids: [] });
    blocs.get(id).ids.push(c.id);
  }
  const sansEmoji = (jeu) => jeu.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "");
  const liste = [...blocs.values()].sort((a, b) => sansEmoji(a.jeu).localeCompare(sansEmoji(b.jeu)) || (ORDRE_NIVEAUX[a.niveau] ?? 3) - (ORDRE_NIVEAUX[b.niveau] ?? 3));
  for (const b of liste) {
    b.titre = [b.theme, sansEmoji(b.jeu), b.niveau].filter(Boolean).join(" · ");
    blocsVus.set(b.id, b);
  }
  return liste;
}

/** Les cartes d'un bloc, comme un seul pack : toutes ses questions à la suite. */
function packDuBloc(bloc, cartes) {
  const siennes = bloc.ids.map((id) => cartes.find((c) => c.id === id)).filter(Boolean);
  return {
    id: bloc.id, bloc, title: bloc.titre, theme: "", kind: siennes[0]?.kind, ids: siennes.map((c) => c.id),
    total: siennes.reduce((t, c) => t + c.total, 0), sansIllustration: siennes.reduce((t, c) => t + c.sansIllustration, 0),
    questions: siennes.flatMap((c) => c.questions),
  };
}

function carteBloc(b) {
  const p = packDuBloc(b, [...mesPacks(quizzes), ...mesSeriesDePhotos(quizzes)]);
  const horsFormat = p.ids.reduce((t, id) => t + horsFormatDu(quizzes[id]).length, 0);
  return h("div", { class: `item pack pack-bloc${p.ids.some((id) => packsNouveaux.has(id)) ? " copie-recente" : ""}`, "data-bloc": b.id, "data-pack": p.ids.join(" ") },
    h("span", { class: "pill", text: b.jeu }),
    b.niveau ? h("span", { class: "pack-niveau", "data-niveau": b.niveau }, pastilleNiveau(b.niveau), b.niveau) : h("span", { class: "pack-niveau sans", text: "Niveau à choisir dans « Éditer »" }),
    h("b", { text: plural(p.total, b.photos ? "photo" : "question") }),
    p.sansIllustration ? h("span", { class: "q-alerte", text: `⚠ ${p.sansIllustration} sans illustration` }) : h("span", { class: "ok", text: "✓ Toutes illustrées" }),
    horsFormat ? h("span", { class: "q-alerte hors-format", text: `⚠ ${plural(horsFormat, "image hors format", "images hors format")} : « Ouvrir » pour voir` }) : null,
    h("div", { class: "row" },
      h("button", { class: "btn", type: "button", text: "Ouvrir", onclick: () => { const y = window.scrollY; qPack = b.id; qSelection.clear(); status("q-status", ""); renderQuestions(); noterRubrique(y); } }),
      h("button", { class: "btn danger", type: "button", text: "Supprimer", onclick: () => supprimerTheme(b.theme, b) })));
}

function renderQuestions() {
  qListees = [];
  dessinerQuestions();
  barreSelection();
}

function dessinerQuestions() {
  const g = groupesQuestions();
  const recherche = $("q-search").value.trim();
  const filtre = (list) => (recherche ? list.filter((x) => questionCorrespond(x, recherche)) : list);
  // Un pack correspond si son titre, son thème ou une de ses questions correspond.
  const cartesTrouvees = (cartes) => (recherche ? cartes.filter((p) => questionCorrespond({ text: p.title, categorie: p.theme }, recherche) || p.questions.some((x) => questionCorrespond(x, recherche))) : cartes);
  const packsTrouves = cartesTrouvees(g.packs);
  // Ses séries de photos (Zoom mystère, Image floue) : des cartes, comme les packs (cedric, 23/10).
  const seriesTrouvees = cartesTrouvees(g.photos);
  const enCartes = { packs: packsTrouves, photos: seriesTrouvees };
  const compte = Object.fromEntries(Object.keys(GROUPES_QUESTIONS).map((k) => [k, enCartes[k] ? enCartes[k].reduce((n, p) => n + p.total, 0) : filtre(g[k]).length]));
  // « 🧪 Questions de test » n'apparaît que s'il y a une prestation de test dans la bibliothèque.
  const groupes = Object.entries(GROUPES_QUESTIONS).filter(([k]) => k !== "tests" || g.tests.length);
  if (qGroupe === "tests" && !g.tests.length) qGroupe = null;
  if (qPack && !quizzes[qPack] && !blocsVus.get(qPack)?.ids.some((id) => quizzes[id])) qPack = null;
  const chip = (key, label, n) => h("button", {
    type: "button", class: `chip${qGroupe === key ? " active" : ""}`, "data-groupe": key ?? "tout", text: `${label} (${n})`,
    onclick: () => { const y = window.scrollY; qGroupe = key; qPack = null; qCategorie = null; qType = null; qNiveau = null; qSelection.clear(); status("q-status", ""); renderQuestions(); noterRubrique(y); },
  });
  const total = Object.values(compte).reduce((a, b) => a + b, 0);
  $("q-groups").replaceChildren(chip(null, "Tout", total), ...groupes.map(([k, label]) => chip(k, label, compte[k])));
  $("q-count").textContent = recherche ? plural(total, "question trouvée", "questions trouvées") : "";
  // Le ZIP d'un pack s'importe depuis les packs et depuis les séries de photos (cedric, 25/10).
  $("pack-import").hidden = (qGroupe !== "packs" && qGroupe !== "photos") || !!qPack;
  const box = $("q-list");
  const plusQue = (n) => (n > QUESTIONS_MAX ? h("p", { class: "hint small", text: `… et ${n - QUESTIONS_MAX} autres : précisez la recherche.` }) : null);

  // Un pack ouvert : ses questions, chacune avec son illustration ou l'alerte.
  if (qPack) {
    const bloc = blocsVus.get(qPack);
    const p = bloc ? packDuBloc(bloc, [...g.packs, ...g.photos]) : [...g.packs, ...g.photos].find((x) => x.id === qPack);
    const photos = p.kind === "images";
    // Un bloc fait d'un seul pack s'édite d'un coup ; sinon, chaque question a son « Éditer ».
    const seul = bloc ? (p.ids.length === 1 ? p.ids[0] : null) : p.id;
    const alertes = (bloc ? p.ids : [p.id]).flatMap((id) => horsFormatDu(quizzes[id]).map((x) => ({ id, x })));
    const liste = filtre(p.questions);
    qListees = liste;
    remplir(box,
      h("div", { class: "title-row" },
        h("button", { type: "button", class: "btn secondary", text: photos ? "← Toutes les séries de photos" : "← Tous mes thèmes", onclick: () => { const y = window.scrollY; qPack = null; qSelection.clear(); renderQuestions(); noterRubrique(y); } }),
        seul ? h("button", { type: "button", class: "btn secondary", text: photos ? "Éditer la série" : "Éditer le pack", onclick: () => review(seul, quizzes[seul]) }) : null),
      h("h2", { text: p.title }),
      h("p", { class: "hint", text: [p.theme, plural(p.total, photos ? "photo" : "question"), p.sansIllustration ? `⚠ ${p.sansIllustration} sans ${photos ? "photo" : "illustration"}` : photos ? "✓ toutes avec leur photo" : "✓ toutes illustrées"].filter(Boolean).join(" · ") }),
      alertes.length ? h("ul", { class: "pack-apercu-alertes hors-format-liste" },
        ...alertes.map(({ id, x }) => h("li", { class: "pack-alerte", text: `${ouImage(quizzes[id], x)} : ${x.message}` }))) : null,
      liste.length ? h("div", { class: "q-liste" }, ...liste.map(ligneQuestion)) : h("p", { class: "hint", text: "Aucune question ne correspond à cette recherche." }));
    return;
  }

  // Aperçu : les groupes l'un sous l'autre, chacun replié sur une ligne (cedric, 25/10) ; ▸ le déplie (quelques
  // questions ou packs, et « Voir tout »), ▾ le replie. Les rubriques dépliées le restent tant que la page est ouverte.
  if (!qGroupe) {
    box.replaceChildren(...groupes.map(([k, label]) => {
      const ouvert = qOuverts.has(k);
      const plier = h("button", {
        type: "button", class: "q-plier", "aria-expanded": ouvert ? "true" : "false",
        title: ouvert ? "Replier cette rubrique" : "Déplier cette rubrique",
        onclick: () => { if (ouvert) qOuverts.delete(k); else qOuverts.add(k); renderQuestions(); },
      }, h("span", { class: "q-plier-fleche", text: ouvert ? "▾" : "▸" }), h("h2", { text: `${label} (${compte[k]})` }));
      const voir = h("button", { type: "button", class: "btn small secondary", text: "Voir tout", onclick: () => { const y = window.scrollY; qGroupe = k; renderQuestions(); noterRubrique(y); } });
      const contenu = enCartes[k]
        ? (enCartes[k].length ? h("div", { class: "cards" }, ...parTheme(enCartes[k]).flatMap(([t, liste]) => blocsDuTheme(t, liste)).slice(0, QUESTIONS_APERCU).map(carteBloc))
          : recherche ? h("p", { class: "hint small", text: "Rien ici pour cette recherche." })
          : k === "photos" ? h("p", { class: "hint small", text: "Aucune série de photos pour l'instant : « Voir tout », puis « 📷 Nouvelle série de photos »." })
          : h("div", { class: "row" }, h("p", { class: "hint small", text: "Aucun thème pour l'instant." }),
            h("button", { type: "button", class: "btn q-importer-vide", text: "📦 Importer un pack ZIP", onclick: () => $("q-importer-haut").click() })))
        : (filtre(g[k]).length ? h("div", { class: "q-liste" }, ...filtre(g[k]).slice(0, QUESTIONS_APERCU).map(ligneQuestion))
          : h("p", { class: "hint small", text: recherche ? "Rien ici pour cette recherche." : k === "miennes" ? "Aucune question écrite à la main pour l'instant." : "" }));
      return h("section", { class: `q-groupe${ouvert ? " ouvert" : " replie"}`, "data-groupe": k }, h("div", { class: "title-row" }, plier, ouvert ? voir : null), ouvert ? contenu : null);
    }));
    return;
  }

  // Mes séries de photos (cedric, 23/10) : par famille, comme les packs (cedric, 25/10) ; « 📷 Nouvelle série de photos » : vos photos
  // d'un coup, le nom de chaque fichier devient sa réponse.
  if (qGroupe === "photos") {
    box.replaceChildren(
      h("div", { class: "title-row" },
        h("p", { class: "hint small grow", text: "Pour le Zoom mystère et l'Image floue : une série par thème (« Disney », « Animaux »…), rangée par thème et par niveau. Le nom de chaque photo devient sa réponse, à corriger avant d'enregistrer." }),
        h("button", { type: "button", class: "btn photos-nouvelle", text: "📷 Nouvelle série de photos", onclick: () => $("quiz-photos").click() })),
      ...packsParTheme(seriesTrouvees, recherche, recherche ? "Aucune série de photos ne correspond à cette recherche." : "Aucune série de photos pour l'instant."));
    return;
  }

  // Mes thèmes (cedric, 25/10) : une ligne par thème, ses packs dessous, rangés Facile, Moyen, Difficile.
  if (qGroupe === "packs") {
    box.replaceChildren(...packsParTheme(packsTrouves, recherche, recherche ? "Aucun pack ne correspond à cette recherche." : "Aucun thème pour l'instant : « 📦 Importer un pack ZIP », en haut à gauche."));
    return;
  }

  // Toutes prêtes (par thème ou par famille), en vrac ou de test (par thème) : une puce par famille ou par thème, puis la liste.
  // Quiz classique : une puce pour les questions à 4 réponses, une pour les Juste Chiffre (cedric, 22/10).
  const tousTypes = filtre(g[qGroupe]);
  const types = qGroupe === "classiques" ? { qcm: ["❓ Questions à 4 réponses", (x) => !x.nombre], nombre: ["🔢 Juste Chiffre", (x) => x.nombre] } : {};
  if (!types[qType]) qType = null;
  const duType = qType ? tousTypes.filter(types[qType][1]) : tousTypes;
  // Quiz classique et Vrai ou Faux : trois niveaux sans chevauchement (cedric, 22/10), Facile, Moyen et Difficile.
  const parNiveau = qGroupe === "classiques" || qGroupe === "vraifaux";
  if (!parNiveau) qNiveau = null;
  const tout = qNiveau ? duType.filter((x) => x.niveau === qNiveau) : duType;
  const categories = [...new Set(tout.map((x) => x.categorie).filter(Boolean))];
  // Les thèmes de ses packs de ce jeu (cedric, 25/10 : K-pop Demon Hunters, Mario…), en tête des puces.
  const themesPacks = themesDesPacks(g.packs, qGroupe, filtre);
  if (qCategorie && !categories.includes(qCategorie) && !themesPacks.has(qCategorie)) qCategorie = null;
  const liste = themesPacks.has(qCategorie) ? themesPacks.get(qCategorie) : qCategorie ? tout.filter((x) => x.categorie === qCategorie) : tout;
  const sans = liste.filter((x) => !x.ok).length;
  if (qGroupe === "miennes" || qGroupe === "tests") qListees = liste.slice(0, QUESTIONS_MAX);
  remplir(box,
    qGroupe === "classiques" ? h("p", { class: "hint small", text: "Quiz classique : des questions à 4 réponses écrites, avec une seule image, montrée à la révélation de la réponse, et des Juste Chiffre (réponse en nombre : la TV montre son compteur, sans image). Pour en mettre dans un quiz classique : « Éditer », puis « 📝 Questions toutes prêtes »." }) : null,
    Object.keys(types).length ? h("div", { class: "chips q-types" },
      h("button", { type: "button", class: `chip${qType ? "" : " active"}`, "data-type": "tous", text: `Toutes (${tousTypes.length})`, onclick: () => { qType = null; renderQuestions(); } }),
      ...Object.entries(types).map(([k, [label, garde]]) => h("button", {
        type: "button", class: `chip${qType === k ? " active" : ""}`, "data-type": k, text: `${label} (${tousTypes.filter(garde).length})`,
        onclick: () => { qType = k; renderQuestions(); },
      }))) : null,
    qGroupe === "vraifaux" ? h("p", { class: "hint small", text: "Vrai ou Faux express : des affirmations toutes prêtes, à dire vraies ou fausses, sans image. Dans une prestation, le 🎲 de la manche Vrai ou Faux express en tire autant de vraies que de fausses, du niveau choisi." }) : null,
    parNiveau ? h("div", { class: "chips q-niveaux" },
      h("button", { type: "button", class: `chip${qNiveau ? "" : " active"}`, "data-niveau": "tous", text: `Tous les niveaux (${duType.length})`, onclick: () => { qNiveau = null; renderQuestions(); } }),
      ...Object.keys(NIVEAUX_CHIFFRES).map(Number).map((n) => h("button", {
        type: "button", class: `chip${qNiveau === n ? " active" : ""}`, "data-niveau": n, text: `${libelleNiveau(n)} (${duType.filter((x) => x.niveau === n).length})`,
        onclick: () => { qNiveau = n; renderQuestions(); },
      }))) : null,
    qGroupe === "illustrees" ? h("p", { class: "hint small", text: "Quiz illustré des tout-petits : une image par réponse. Une réponse sans photo reçoit l'émoji de son mot, dessiné en image. Pour en mettre dans un quiz illustré : « Éditer », puis « 🎲 Questions de la banque »." }) : null,
    qGroupe === "tests" ? h("p", { class: "hint small", text: "Les questions des prestations de test (Paramètres) : rangées ici pour ne pas se mélanger aux vôtres." }) : null,
    categories.length > 1 || themesPacks.size ? h("div", { class: "chips q-categories" },
      h("button", { type: "button", class: `chip${qCategorie ? "" : " active"}`, text: `Toutes (${tout.length})`, onclick: () => { qCategorie = null; renderQuestions(); } }),
      ...[...themesPacks].map(([t, qs]) => h("button", { type: "button", class: `chip theme-pack${qCategorie === t ? " active" : ""}`, "data-categorie": t, title: "Un thème de vos packs", text: `🎨 ${t} (${qs.length})`, onclick: () => { qCategorie = t; renderQuestions(); } })),
      ...categories.map((c) => h("button", { type: "button", class: `chip${qCategorie === c ? " active" : ""}`, "data-categorie": c, text: `${c} (${tout.filter((x) => x.categorie === c).length})`, onclick: () => { qCategorie = c; renderQuestions(); } }))) : null,
    sans ? h("p", { class: "q-alerte", text: `⚠ ${plural(sans, "question")} sans illustration complète ici.` }) : null,
    liste.length ? h("div", { class: "q-liste" }, ...liste.slice(0, QUESTIONS_MAX).map(ligneQuestion))
      : h("p", { class: "hint", text: recherche ? "Aucune question ne correspond à cette recherche." : qGroupe === "miennes" ? "Aucune question écrite à la main pour l'instant : « Créer un quiz » dans la page du Quiz." : "Aucune question." }),
    plusQue(liste.length));
}
$("q-search").oninput = () => renderQuestions();

/** Durée gardée seulement si la base l'accepte (5 à 120 s) ; sinon la durée du jeu. */
const dureeQuestion = (d) => (Number.isFinite(d) && d >= 5 && d <= 120 ? d : null);

/**
 * « 📦 Importer un pack ZIP » (cedric, 25/10) : un seul ZIP, ouvert ici dans le navigateur, sans IA ni service
 * extérieur. La Régie lit les données du pack, rejoint les images par leur nom, vérifie, montre un aperçu, puis
 * enregistre après confirmation. Rien n'est écrit avant : les images sont préparées en mémoire, rangées seulement au
 * « Enregistrer », et le pack en dernier (un échec ne laisse jamais de pack à moitié). Un pack ne remplace jamais un
 * autre : même nom, il s'appelle « … (2) ». Une image absente reste absente, avec la petite alerte : ni émoji ni autre
 * image à sa place.
 */
const TYPES_IMAGES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

/**
 * Empreintes des images déjà comparées, gardées dans ce navigateur : une image ne change jamais (son identifiant est
 * son contenu), la suivante comparaison ne la retélécharge pas.
 */
const CLE_EMPREINTES = "lmp-empreintes";
let empreintesEnCache = null;
const lireEmpreintes = () => {
  if (empreintesEnCache) return empreintesEnCache;
  try { empreintesEnCache = JSON.parse(localStorage.getItem(CLE_EMPREINTES) ?? "{}") ?? {}; } catch { empreintesEnCache = {}; }
  return empreintesEnCache;
};
function empreinteEnCache(id) {
  const x = lireEmpreintes()[id];
  if (!x?.p) return null;
  try { return { px: Uint8Array.from(atob(x.p), (c) => c.charCodeAt(0)), ratio: x.r, taille: x.t }; } catch { return null; }
}
function garderEmpreinte(id, e) {
  const tout = lireEmpreintes();
  tout[id] = { p: btoa(String.fromCharCode(...e.px)), r: e.ratio, t: e.taille };
  // Écrites d'un coup, une fois la série finie.
  clearTimeout(garderEmpreinte.minuteur);
  garderEmpreinte.minuteur = setTimeout(() => {
    try { localStorage.setItem(CLE_EMPREINTES, JSON.stringify(tout)); } catch { /* plein ou interdit : recalculée la prochaine fois */ }
  }, 1000);
}

async function importerPackZip(zip, statut = "pack-status") {
  if (!zip) return;
  if (!/\.zip$/i.test(zip.name ?? "") && !/zip/.test(zip.type ?? "")) {
    return status(statut, "Choisissez le fichier ZIP du pack (il se termine par .zip), sans le décompresser.");
  }
  status("q-status", "");
  status(statut, "Ouverture du ZIP…", true);
  let analyse, parNom;
  try {
    const fichiers = await lireZipEtSesZip(zip);
    const lus = [];
    for (const f of fichiers) lus.push({ chemin: f.chemin, nom: f.nom, ...(/\.json$/i.test(f.nom) ? { texte: new TextDecoder("utf-8").decode(await f.lire()) } : {}) });
    analyse = analyserPack(lus, { nomZip: zip.name });
    parNom = chercheurImages(fichiers.filter((f) => estImage(f.nom)));
  } catch (err) {
    console.error(err);
    status(statut, "");
    return avertir(`Ce ZIP ne peut pas être importé.\n\n${err?.message || "Il n'a pas pu être ouvert."} Rien n'a été enregistré.`);
  }
  if (analyse.erreurs.length) {
    status(statut, "");
    return avertir(`Ce pack ne peut pas être importé.\n\n${analyse.erreurs.join("\n\n")}\n\nRien n'a été enregistré.`);
  }

  // Images préparées en mémoire (réduites comme partout ailleurs), rangées seulement après confirmation.
  const aRanger = new Map();
  const prets = new Map();
  // Copie en double → image gardée (une du ZIP, ou une déjà dans la bibliothèque).
  const doublons = new Map();
  // Image déjà dans la bibliothèque → image du ZIP, la même en plus grand : elle la remplace partout.
  const remplacees = new Map();
  // Images nommées par "images" (cedric, 25/10) : par chemin dans le ZIP, puis par image préparée (citée ou non).
  const nomDuChemin = new Map(analyse.nommees.map((x) => [x.chemin, x]));
  const nommes = new Map();
  const preparees = new Set();
  // Pour repérer les doublons : l'usage de chaque image préparée et la taille de son original.
  const pourDe = new Map();
  const tailleDe = new Map();
  let n = 0;
  const horsFormat = new Map();
  // Une image hors format : notée sur son pack, à sa place (question, réponse).
  const noterFormat = (p, id, q, k = null) => {
    if (!id || !horsFormat.has(id)) return;
    (p.horsFormat ??= []).push({ id, q, case: k, message: horsFormat.get(id) });
  };
  const preparer = async (nom, pour, dossier = null) => {
    const f = parNom(nom, dossier);
    if (!f) return null;
    const cle = `${pour}:${f.chemin}`;
    if (prets.has(cle)) return prets.get(cle);
    status(statut, `Préparation des images… (${++n})`, true);
    let id = null;
    try {
      const ext = f.nom.split(".").pop().toLowerCase();
      const blob = new Blob([await f.lire()], { type: TYPES_IMAGES[ext] ?? "image/jpeg" });
      // Format, taille et poids de l'original, mesurés avant la réduction (cedric, 25/10 : une petite alerte, jamais bloquante).
      // Hors du dossier du pack : une image de la banque téléchargée à part, aux formats variés.
      const banque = dossier != null && dossierDe(f.chemin) !== dossier;
      let taille = 0;
      const alerte = await createImageBitmap(blob).then((m) => {
        const a = alerteImage({ largeur: m.width, hauteur: m.height, octets: blob.size }, pour, { banque });
        taille = m.width * m.height;
        m.close?.();
        return a;
      }, () => null);
      const data = pour === "case" ? await compressImage(blob, CHOICE_IMAGE.budget, CHOICE_IMAGE.width) : await compressImage(blob);
      id = await imageId(data);
      aRanger.set(id, data);
      imageCache[id] = data;
      if (alerte) horsFormat.set(id, alerte);
      if (nomDuChemin.has(f.chemin) && !nommes.has(id)) nommes.set(id, nomDuChemin.get(f.chemin));
      preparees.add(f.chemin);
      pourDe.set(id, pour);
      if (!tailleDe.has(id) || taille > tailleDe.get(id)) tailleDe.set(id, taille);
    } catch (err) {
      console.error(err);
    }
    prets.set(cle, id);
    return id;
  };
  try {
    for (const p of analyse.packs) {
      if (p.epreuve === "quisuis") {
        // L'image de chaque personnage (cedric, 25/10), carrée comme celles choisies dans la page du jeu.
        for (const x of p.personnages) {
          if (!x.fichierImage) continue;
          const id = await preparer(x.fichierImage, "case", p.dossier);
          if (id) x.imageId = id;
          else p.manquantes.push({ q: null, case: null, fichier: x.fichierImage, nom: x.answer });
          delete x.fichierImage;
        }
        continue;
      }
      if (p.epreuve === "photos") {
        const gardees = [];
        for (const q of p.questions) {
          const id = await preparer(q.photo, "photo", p.dossier);
          if (id) { gardees.push({ ...q, imageId: id }); noterFormat(p, id, gardees.length - 1); }
          else p.ignorees.push(`« ${q.photo} » : photo illisible, elle n'est pas importée (essayez un JPEG).`);
        }
        p.questions = gardees;
        continue;
      }
      for (const [i, q] of p.questions.entries()) {
        if (q.revealFile) {
          const id = await preparer(q.revealFile, "revelation", p.dossier);
          noterFormat(p, id, i);
          if (id) q.imageId = id;
          else if (!p.manquantes.some((m) => m.q === i && m.case == null)) p.manquantes.push({ q: i, case: null, fichier: q.revealFile });
        }
        if (q.imageFiles) {
          q.choiceImages = [];
          for (const [k, nom] of q.imageFiles.slice(0, 4).entries()) {
            const id = nom ? await preparer(nom, "case", p.dossier) : null;
            noterFormat(p, id, i, k);
            q.choiceImages[k] = id;
            if (nom && !id && !p.manquantes.some((m) => m.q === i && m.case === k)) p.manquantes.push({ q: i, case: k, fichier: nom });
          }
        }
      }
      p.manquantes.sort((a, b) => a.q - b.q || (a.case ?? -1) - (b.case ?? -1));
      garderLesQuestionsIllustrees(p);
    }
    // Les images nommées qu'aucune question ne cite : importées aussi, en photo (pour « ⭐ Composer avec vos images »).
    for (const x of analyse.nommees) if (!preparees.has(x.chemin)) await preparer(x.fichier, "photo");
    // Les images des questions laissées de côté (Quiz illustré sans toutes ses photos) : pas téléversées pour rien.
    const citees = new Set(analyse.packs.flatMap((p) => (p.epreuve === "quisuis" ? p.personnages.map((x) => x.imageId) : p.questions.flatMap((q) => [q.imageId, ...(q.choiceImages ?? [])]))));
    for (const id of [...aRanger.keys()]) if (!citees.has(id) && !nommes.has(id)) aRanger.delete(id);
    // Doublons (cedric, 25/10) : la même image sous deux noms de fichier (ou à deux tailles, ou préparée pour une
    // réponse et pour la révélation) ; une seule est gardée, la plus grande, et chaque question pointe vers elle.
    // Sans rien demander (cedric, 26/10 : « une image doit juste être affichée une seule fois »).
    status(statut, "Recherche des images en double…", true);
    const empreintes = [];
    for (const [id, data] of aRanger) {
      try {
        const e = await empreinteImage(data);
        garderEmpreinte(id, e);
        // La plus grande telle qu'enregistrée, puis la plus grande à l'origine.
        empreintes.push({ id, stockee: e.taille, empreinte: { ...e, taille: e.taille * 1e9 + Math.min(tailleDe.get(id) ?? 0, 1e9 - 1) } });
      } catch { /* illisible : gardée telle quelle */ }
    }
    for (const [garde, ...copies] of groupesDeDoublons(empreintes)) {
      for (const c of copies) {
        doublons.set(c.id, garde.id);
        aRanger.delete(c.id);
        if (nommes.has(c.id) && !nommes.has(garde.id)) nommes.set(garde.id, nommes.get(c.id));
        nommes.delete(c.id);
      }
    }
    // Et celles déjà dans les images des packs (cedric, 26/10) : la même n'est jamais rangée deux fois. La plus grande
    // reste : celle de la bibliothèque, sinon celle du ZIP, qui la remplace alors partout.
    const existantes = (() => { const g = groupesImages(); return [...g.packs, ...g[RETIREES].packs]; })().filter((x) => !aRanger.has(x.id));
    const nouvelles = empreintes.filter((x) => aRanger.has(x.id));
    if (nouvelles.length && existantes.length) {
      let k = 0;
      const deja = [];
      for (const x of existantes) {
        status(statut, `Comparaison avec vos images… (${++k} / ${existantes.length})`, true);
        let e = empreinteEnCache(x.id);
        if (!e) {
          try {
            const data = imageCache[x.id] ?? (await get(ref(db, `library/images/${x.id}`))).val();
            if (typeof data !== "string") continue;
            imageCache[x.id] = data;
            e = await empreinteImage(data);
            garderEmpreinte(x.id, e);
          } catch (err) { console.error(err); continue; }
        }
        deja.push({ id: x.id, empreinte: e });
      }
      for (const n of nouvelles) {
        const e = deja.find((y) => !remplacees.has(y.id) && memeImage(n.empreinte, y.empreinte));
        if (!e) continue;
        if (n.stockee > e.empreinte.taille * 1.2) { remplacees.set(e.id, n.id); continue; }
        doublons.set(n.id, e.id);
        aRanger.delete(n.id);
        // Elle garde sa fiche (son nom) : celle du ZIP ne sert plus.
        nommes.delete(n.id);
      }
    }
    if (doublons.size) {
      // Une copie d'une copie : jusqu'à l'image gardée.
      const vers = (id) => { for (let k = 0; doublons.has(id) && k < 10; k++) id = doublons.get(id); return id; };
      for (const p of analyse.packs) {
        if (p.epreuve === "quisuis") { for (const x of p.personnages) if (x.imageId) x.imageId = vers(x.imageId); continue; }
        for (const q of p.questions) {
          if (q.imageId) q.imageId = vers(q.imageId);
          if (q.choiceImages) q.choiceImages = q.choiceImages.map((id) => (id ? vers(id) : id));
        }
        // Une série de photos ne montre jamais deux fois la même image.
        if (p.epreuve === "photos") { const vues = new Set(); p.questions = p.questions.filter((q) => !vues.has(q.imageId) && vues.add(q.imageId)); }
        for (const x of p.horsFormat ?? []) x.id = vers(x.id);
      }
    }
  } finally {
    status(statut, "");
  }
  const vides = analyse.packs.filter((p) => (p.epreuve === "quisuis" ? !p.personnages.length : !p.questions.length));
  if (vides.length === analyse.packs.length && !nommes.size) {
    const absents = analyse.nomsAbsents.length ? `Les images nommées ne sont pas dans le ZIP (${analyse.nomsAbsents.slice(0, 5).join(", ")}${analyse.nomsAbsents.length > 5 ? "…" : ""}) : ajoutez-y le dossier d'images.` : "";
    return avertir(`Ce pack ne peut pas être importé.\n\n${(() => { const t = [...analyse.packs.flatMap((p) => p.ignorees), absents].filter(Boolean); return t.length > 8 ? [...t.slice(0, 8), `… et ${t.length - 8} autres.`].join("\n") : t.join("\n"); })() || "Aucune image n'a pu être lue."}\n\nRien n'a été enregistré.`);
  }
  const packs = analyse.packs.filter((p) => !vides.includes(p));

  // Noms déjà pris : le pack s'ajoute à côté, l'ancien ne change pas. Un même nom à un autre niveau n'est pas un
  // doublon (cedric, 25/10 : « Harry Potter » en Facile, Moyen et Difficile dans un seul ZIP).
  // Ni pour un autre jeu (le Quiz et le Zoom « Harry Potter » d'un ZIP global).
  const cleNom = (titre, niveau, epreuve) => `${`${titre ?? ""}`.trim().toLowerCase()}|${niveau ?? ""}|${epreuve}`;
  const pris = new Set(Object.values(quizzes ?? {}).filter(Boolean).map((q) => cleNom(q.title, niveauDuQuiz(q), epreuveDuQuiz(q))));
  for (const p of packs) {
    if (p.epreuve === "quisuis") continue;
    const base = p.titre.slice(0, 110);
    let titre = base;
    for (let k = 2; pris.has(cleNom(titre, p.niveau, p.epreuve)); k++) titre = `${base} (${k})`;
    if (titre !== base) p.renomme = base;
    p.titre = titre;
    pris.add(cleNom(titre, p.niveau, p.epreuve));
  }
  // Qui suis-je ? : un personnage déjà dans le jeu reste tel quel.
  const jeuQui = CONTENT_GAMES.quisuis;
  const etatQui = builtinState("quisuis");
  const connus = new Set([...jeuQui.catalog, ...etatQui.extra].map((x) => jeuQui.key(x)));
  for (const p of packs.filter((x) => x.epreuve === "quisuis")) {
    p.deja = p.personnages.filter((x) => connus.has(jeuQui.key(x))).length;
    p.personnages = p.personnages.filter((x) => !connus.has(jeuQui.key(x)) && connus.add(jeuQui.key(x)));
  }
  const aEnregistrer = packs.filter((p) => p.epreuve !== "quisuis" || p.personnages.length);
  const existants = themesExistants();
  const fixeurs = new Map();
  const apercus = packs.map((p) => apercuDuPack(p, existants, fixeurs));
  const contenu = h("div", { class: "pack-apercu" },
    themeDeTousLesPacks(fixeurs, existants),
    ...apercus,
    // Un pack du Quiz illustré dont aucune question n'a toutes ses images (cedric, 26/10) : pas importé, dit en rouge.
    ...vides.filter((p) => p.epreuve === "illustre").map((p) => h("div", { class: "pack-apercu-pack pack-refuse" },
      h("h3", { text: p.titre }),
      h("p", { class: "pack-erreur", text: "Pas importé : aucune de ses questions n'a une photo pour chaque réponse dans le ZIP. Ajoutez son dossier d'images au ZIP, puis réimportez-le." }),
      ...p.ignorees.slice(0, 4).map((t) => h("p", { class: "pack-erreur", text: t })))),
    analyse.laisses.length ? h("p", { class: "hint small", text: `Laissé${analyse.laisses.length > 1 ? "s" : ""} de côté : ${analyse.laisses.join(", ")}.` }) : null,
    // Le dossier d'images téléchargé à côté des packs (cedric, 25/10) : seules les images citées sont téléversées.
    // Les images nommées (cedric, 25/10) : rangées sous leur nom, citées ou non, pour les retrouver en tapant.
    nommes.size ? h("p", { class: "hint small pack-images-nommees", text: `🖼 ${plural(nommes.size, "image nommée", "images nommées")} (${[...nommes.values()].slice(0, 4).map((x) => x.nom).join(", ")}${nommes.size > 4 ? "…" : ""}) : ${nommes.size > 1 ? "rangées" : "rangée"} sous ce nom dans Bibliothèque › Images › 📦 Images des packs, au thème du pack. Il suffit de taper le nom pour la retrouver.` }) : null,
    analyse.nomsAbsents.length ? h("p", { class: "hint small pack-noms-absents", text: `${plural(analyse.nomsAbsents.length, "image nommée absente", "images nommées absentes")} du ZIP : ${analyse.nomsAbsents.slice(0, 5).join(", ")}${analyse.nomsAbsents.length > 5 ? "…" : ""}.` }) : null,
    analyse.imagesInutiles ? h("p", { class: "hint small pack-images-inutiles", text: `${plural(analyse.imagesInutiles, "image du ZIP ne sert", "images du ZIP ne servent")} à aucun pack${analyse.nommees.length || analyse.nomsAbsents.length ? (analyse.imagesInutiles > 1 ? " et n'ont pas de nom" : " et n'a pas de nom") : ""} : ${analyse.imagesInutiles > 1 ? "elles ne sont pas téléversées" : "elle n'est pas téléversée"}.` }) : null);
  if (!aEnregistrer.length && !nommes.size) return apercu("Rien de nouveau dans ce pack.", contenu, { ok: "Fermer", annuler: null });
  const titre = !aEnregistrer.length ? `Ranger ${nommes.size > 1 ? `ces ${nommes.size} images` : "cette image"} ?`
    : aEnregistrer.length > 1 ? `Importer ces ${aEnregistrer.length} packs ?` : `Importer « ${aEnregistrer[0].titre} » ?`;
  // Le niveau est obligatoire (cedric, 25/10) : s'il manque au pack, il se choisit dans l'aperçu ; le thème a toujours
  // une valeur (celle du pack, sinon son nom).
  const valider = () => {
    for (const p of aEnregistrer) p.theme = `${p.theme ?? ""}`.trim() || themeDe("", p.titre);
    const sans = aEnregistrer.filter((p) => !p.niveau);
    return sans.length ? `Choisissez le niveau de ${sans.length > 1 ? "chaque pack" : `« ${sans[0].titre} »`} avant d'enregistrer.` : null;
  };
  const ok = !aEnregistrer.length ? "Enregistrer les images" : aEnregistrer.length > 1 ? "Enregistrer les packs" : "Enregistrer le pack";
  if (!(await apercu(titre, contenu, { ok, valider }))) return status(statut, "Import annulé : rien n'a été enregistré.");

  // Le thème de chaque image nommée : celui du pack qui la cite, sinon le sien (suivant le thème choisi dans l'aperçu
  // pour les packs du même thème, écrit comme un thème déjà là), sinon celui du premier pack.
  const existantsApres = themesExistants();
  const themeNomme = (id, x) => {
    const cite = aEnregistrer.find((p) => p.epreuve !== "quisuis" && p.questions.some((q) => q.imageId === id || (q.choiceImages ?? []).includes(id)));
    if (cite) return cite.theme;
    const meme = x.theme && aEnregistrer.find((p) => p.epreuve !== "quisuis" && cleTheme(p.themePropose ?? p.theme) === cleTheme(x.theme));
    if (meme) return meme.theme;
    return x.theme ? themeExistant(x.theme, existantsApres) : aEnregistrer.find((p) => p.theme)?.theme ?? "Sans thème";
  };

  // Enregistrement : les images d'abord (invisibles tant qu'aucun pack ne les nomme), les packs ensuite.
  status(statut, "Enregistrement…", true);
  const faits = [];
  try {
    const liste = [...aRanger];
    for (let k = 0; k < liste.length; k += 6) {
      await Promise.all(liste.slice(k, k + 6).map(async ([id, data]) => {
        const cible = ref(db, `library/images/${id}`);
        if (!(await get(cible)).exists()) await set(cible, data);
      }));
    }
    const qui = aEnregistrer.filter((p) => p.epreuve === "quisuis");
    const ecritures = {};
    for (const p of aEnregistrer.filter((x) => x.epreuve !== "quisuis")) {
      const id = push(ref(db, "library/quizzes")).key;
      ecritures[`library/quizzes/${id}`] = quizDuPack(p);
      faits.push(id);
    }
    if (qui.length) {
      ecritures["library/contents/quisuis"] = {
        off: etatQui.off.length ? etatQui.off : null,
        extra: [...etatQui.extra, ...qui.flatMap((p) => p.personnages.map((x) => ({ ...x, famille: p.famille, niveau: p.niveau })))].map(({ level, imageId, ...x }) => x),
        // Leurs images (cedric, 25/10) : à côté de celles choisies dans la page du jeu.
        images: (() => {
          const toutes = { ...etatQui.images };
          for (const [k, id] of Object.entries(toutes)) if (remplacees.has(id)) toutes[k] = remplacees.get(id);
          for (const p of qui) for (const x of p.personnages) if (x.imageId) toutes[contentSlot(jeuQui.key(x))] = x.imageId;
          return Object.keys(toutes).length ? toutes : null;
        })(),
        updatedAt: serverTimestamp(),
      };
    }
    // Les fiches des images nommées ; une image déjà rangée dans « Mes images » ou les pochettes garde la sienne.
    for (const [id, x] of nommes) {
      const avant = medias[id];
      if (avant && !estFicheDePack(avant)) continue;
      const fiche = ficheImage({ nom: x.nom, cat: catDePack(themeNomme(id, x)), tags: avant?.tags ?? "", retiree: avant?.hidden === true }, avant);
      if (fiche) ecritures[`library/medias/${id}`] = { ...fiche, updatedAt: serverTimestamp() };
    }
    // Une image de la bibliothèque remplacée par la même en plus grand : partout (packs, prestations, jeux gardés…),
    // avec sa fiche si celle du ZIP n'a pas de nom.
    if (remplacees.size) {
      const repointees = repointer({ quizzes, shows, manches, mimes, contents, songs, playlists }, remplacees, { horodatage: serverTimestamp() });
      for (const [chemin, v] of Object.entries(repointees)) if (!(qui.length && chemin.startsWith("library/contents/quisuis/"))) ecritures[chemin] = v;
      for (const [vieille, neuve] of remplacees) {
        if (!ecritures[`library/medias/${neuve}`] && medias[vieille]) ecritures[`library/medias/${neuve}`] = { ...medias[vieille], updatedAt: serverTimestamp() };
        ecritures[`library/medias/${vieille}`] = null;
        ecritures[`library/images/${vieille}`] = null;
      }
    }
    // Un seul envoi : tous les packs, ou aucun.
    await update(ref(db), ecritures);
  } catch (err) {
    console.error(err);
    return status(statut, "Enregistrement refusé : vérifiez Internet ou reconnectez-vous, puis réimportez le ZIP. Rien n'a été enregistré.");
  }
  // Le bilan en une ligne courte, qui s'en va toute seule (cedric, 26/10 : le détail pack par pack était « inutile »).
  const nbPacks = aEnregistrer.filter((p) => p.epreuve !== "quisuis").length;
  const personnages = aEnregistrer.filter((p) => p.epreuve === "quisuis").reduce((t, p) => t + p.personnages.length, 0);
  const images = new Set([...aRanger.keys(), ...nommes.keys()]).size;
  const bilan = [nbPacks ? plural(nbPacks, "pack importé", "packs importés") : "", personnages ? `${plural(personnages, "personnage")} pour Qui suis-je ?` : "",
    images ? plural(images, "image") : ""].filter(Boolean);
  const manquantes = aEnregistrer.reduce((t, p) => t + p.manquantes.length, 0);
  if (builtinType === "quisuis") renderBuiltin();
  if (faits.length) {
    packsNouveaux = new Set(faits);
    // Leurs thèmes s'ouvrent, pour les voir tout de suite.
    for (const p of aEnregistrer) qThemesOuverts.add(cleTheme(p.theme) || p.theme);
    setTimeout(() => { packsNouveaux = new Set(); if (libTab === "questions" && !$("screen-library").hidden) renderQuestions(); }, 6000);
    if (libTab === "questions" && !$("screen-library").hidden) {
      const y = window.scrollY;
      qGroupe = aEnregistrer.every((p) => p.epreuve === "photos") ? "photos" : "packs";
      qPack = null;
      renderQuestions();
      noterRubrique(y);
    }
  }
  const message = `✓ ${bilan.join(", ") || "Importé"}.${manquantes ? ` ${plural(manquantes, "image manquante")} : ajoutez-les dans « Éditer ».` : ""}`;
  status(statut, message, true);
  // Une image manquante reste dite ; sinon la ligne s'efface au bout de 10 s.
  if (!manquantes) setTimeout(() => { if ($(statut).textContent === message) status(statut, ""); }, 10000);
}

/** Le quiz enregistré d'un pack (mêmes champs qu'un quiz fait dans la Régie). */
function quizDuPack(p) {
  const aCorriger = new Set(p.aCorriger.map((x) => x.q));
  const kind = p.epreuve === "illustre" ? "photo" : p.epreuve === "photos" ? "images" : "classique";
  return {
    title: p.titre, theme: p.theme || null, famille: p.famille, niveau: p.niveau,
    // Sans âges dans le pack, ceux de son niveau.
    ageMin: p.ageMin ?? AGES_NIVEAU[p.niveau]?.[0] ?? null, ageMax: p.ageMax ?? AGES_NIVEAU[p.niveau]?.[1] ?? null,
    source: p.epreuve === "photos" ? "photos" : "json", pack: true, kind,
    // Ses images hors format (par image : remplacée, son alerte s'en va avec elle).
    imagesHorsFormat: p.horsFormat?.length ? Object.fromEntries(p.horsFormat.map((x) => [x.id, x.message.slice(0, 200)])) : null, createdAt: Date.now(), updatedAt: serverTimestamp(),
    questions: p.questions.map((q, i) => {
      const nombre = q.kind === "number";
      const choices = nombre ? null : q.choices.slice(0, 4);
      return {
        text: q.text.slice(0, 300), choices, correct: nombre ? (Number.isInteger(q.correct) ? q.correct : 0) : Number.isInteger(q.correct) ? q.correct : -1,
        kind: nombre ? "number" : null, duration: dureeQuestion(q.duration), double: q.double === true,
        status: aCorriger.has(i) ? "brouillon" : "validee", image: cleanEmoji(q.image) || null, imageId: q.imageId || null,
        choiceImages: nombre ? null : savedChoiceImages({ ...q, choices }),
      };
    }),
  };
}

const NOUVEAU_THEME = "\u0000nouveau";
const CHAQUE_THEME = "\u0000chacun";

/**
 * Un choix de thème à l'import (cedric, 25/10) : un de ses thèmes, ou « ＋ Nouveau thème… » et son nom ; [chacun] :
 * « Le thème de chaque pack » en tête (le choix global quand le ZIP mêle plusieurs thèmes). [changer](thème | null).
 */
function choixDeTheme({ existants, valeur, aria, chacun = false, defaut = "", changer }) {
  const etat = h("span", { class: "pack-theme-etat" });
  const nom = h("input", { class: "pack-theme-nom", maxlength: "80", placeholder: "Nom du nouveau thème", "aria-label": `Nom du nouveau thème${aria}` });
  const menu = h("select", { class: "pack-theme", "aria-label": `Thème${aria}` },
    chacun ? h("option", { value: CHAQUE_THEME, text: "— Le thème de chaque pack —" }) : null,
    ...existants.map((t) => h("option", { value: t, text: t })),
    h("option", { value: NOUVEAU_THEME, text: "＋ Nouveau thème…" }));
  // Un nom tapé qui est déjà un de ses thèmes y range le pack.
  const lire = () => (menu.value === CHAQUE_THEME ? null
    : menu.value === NOUVEAU_THEME ? themeExistant(nom.value, existants) || nom.value.trim() || defaut : menu.value);
  const montrer = () => {
    nom.hidden = menu.value !== NOUVEAU_THEME;
    const t = lire();
    etat.hidden = !t;
    const deja = existants.includes(t);
    etat.textContent = deja ? "existant" : "nouveau";
    etat.dataset.etat = deja ? "existant" : "nouveau";
  };
  const fixer = (t) => {
    if (t == null) menu.value = CHAQUE_THEME;
    else if (existants.includes(t)) menu.value = t;
    else { menu.value = NOUVEAU_THEME; nom.value = t; }
    montrer();
  };
  menu.onchange = () => { montrer(); if (menu.value === NOUVEAU_THEME) nom.focus(); changer(lire()); };
  nom.oninput = () => { montrer(); changer(lire()); };
  fixer(valeur);
  return { menu, nom, etat, fixer };
}

/**
 * Thème et niveau d'un pack à importer (cedric, 25/10) : lus dans le pack et modifiables ici ; sans niveau, « À choisir »,
 * et l'enregistrement attend. [fixeurs] : le choix global de l'aperçu y règle le thème de ce pack.
 */
function etiquettesAImporter(p, existants, fixeurs) {
  const alerte = h("p", { class: "pack-alerte pack-etiquettes-manque" });
  const majAlerte = () => {
    alerte.textContent = p.niveau ? "" : "Le pack ne dit pas le niveau : choisissez-le ici.";
    alerte.hidden = !!p.niveau;
  };
  // Le thème (cedric, 25/10) : la Régie propose un de ses thèmes (le même nom, ou un nom proche), sinon un nouveau thème
  // au nom du pack ; elle a la main : un autre de ses thèmes, ou « ＋ Nouveau thème… » avec son nom.
  const sansTheme = !`${p.theme ?? ""}`.trim();
  const propose = themeDe(p.theme, p.titre);
  p.theme = themeProche(propose, existants) ?? propose;
  p.themePropose = p.theme;
  const choix = choixDeTheme({ existants, valeur: p.theme, aria: ` de « ${p.titre} »`, defaut: propose, changer: (t) => { p.theme = t || propose; } });
  if (p.epreuve !== "quisuis") fixeurs?.set(p, (t) => { p.theme = t; choix.fixer(t); });
  const theme = h("label", { class: "pack-etiquette" }, h("span", {}, "Thème ", choix.etat), choix.menu, choix.nom);
  const niveau = h("label", { class: "pack-etiquette" }, "Niveau",
    h("select", {
      class: "pack-niveau", "aria-label": `Niveau de « ${p.titre} »`,
      onchange: (e) => { p.niveau = e.target.value || null; p.niveauDeduit = false; majAlerte(); },
    },
    h("option", { value: "", text: "— À choisir —", selected: !p.niveau }),
    ...NIVEAUX.map((v) => h("option", { value: v, text: `${v} (${AGES_NIVEAU[v][0]} à ${AGES_NIVEAU[v][1]} ans)`, selected: v === p.niveau }))));
  majAlerte();
  return h("div", { class: "pack-etiquettes" },
    // Qui suis-je ? : ses personnages vont dans le jeu, pas dans un thème.
    h("div", { class: "row" }, p.epreuve === "quisuis" ? null : theme, niveau),
    sansTheme && p.epreuve !== "quisuis" && !fixeurs ? h("p", { class: "hint small", text: "Le pack ne dit pas son thème : la Régie le déduit de son nom. Changez-le si besoin." }) : null,
    p.niveauDeduit ? h("p", { class: "hint small", text: `Niveau déduit des âges du pack (${p.ageMin ?? "?"} à ${p.ageMax ?? "?"} ans) : vérifiez-le.` }) : null,
    alerte);
}

/**
 * Le thème de tous les packs d'un ZIP (cedric, 25/10), tout en haut de l'aperçu : proposé d'après les packs (un des
 * siens ou un nouveau), il règle chaque pack d'un coup ; chaque série garde son propre choix pour en changer une seule.
 * Packs de thèmes différents : « Le thème de chaque pack » (rien n'est changé tant qu'on n'en choisit pas un).
 */
function themeDeTousLesPacks(fixeurs, existants) {
  if (fixeurs.size < 2) return null;
  const packs = [...fixeurs.keys()];
  const cles = new Set(packs.map((p) => cleTheme(p.themePropose)));
  const commun = cles.size === 1 ? packs[0].themePropose : null;
  const choix = choixDeTheme({
    existants, valeur: commun, aria: " de tous les packs", chacun: true, defaut: commun ?? "",
    changer: (t) => { for (const [p, fixer] of fixeurs) fixer(t || p.themePropose); },
  });
  return h("div", { class: "pack-theme-global" },
    h("label", { class: "pack-etiquette" }, h("span", {}, "Thème de tous les packs ", choix.etat), choix.menu, choix.nom),
    h("p", { class: "hint small", text: "Il s'applique à toutes les séries ci-dessous ; chacune garde son menu pour changer la sienne." }));
}

/** Récapitulatif d'un pack avant de l'enregistrer : nom, épreuve, âges, nombre, vignettes, alertes. */
function apercuDuPack(p, existants = [], fixeurs = null) {
  const ages = p.ageMin && p.ageMax ? (p.ageMin === p.ageMax ? `${p.ageMin} ans` : `${p.ageMin} à ${p.ageMax} ans`) : p.ageMin ? `dès ${p.ageMin} ans` : p.ageMax ? `jusqu'à ${p.ageMax} ans` : null;
  const nombre = p.epreuve === "quisuis" ? plural(p.personnages.length, "personnage nouveau", "personnages nouveaux")
    : plural(p.questions.length, p.epreuve === "photos" ? "photo" : "question");
  const ids = p.epreuve === "quisuis" ? [] : p.questions.flatMap((q) => [q.imageId, ...(q.choiceImages ?? [])]).filter((id) => id && imageCache[id]);
  const VIGNETTES = 24;
  const lignes = [
    ...p.manquantes.map((m) => [`${m.nom ? `« ${m.nom} » (image « ${m.fichier} »)` : ouQuestion(m.q, m.case)} : ${m.nom ? "image absente du ZIP, il se révélera sans image." : IMAGE_MANQUANTE}`, "pack-alerte"]),
    ...(p.horsFormat ?? []).map((x) => [`${p.epreuve === "photos" ? `Photo ${x.q + 1}` : ouQuestion(x.q, x.case)} : ${x.message}`, "pack-alerte hors-format"]),
    ...p.aCorriger.map((x) => [`${ouQuestion(x.q)} : ${x.messages.join(" ")} Elle arrive « À valider » : corrigez-la dans « Éditer ».`, "pack-erreur"]),
    ...p.ignorees.map((t) => [t, "pack-erreur"]),
  ];
  return h("section", { class: "pack-apercu-pack", "data-epreuve": p.epreuve },
    h("h3", { text: p.titre }),
    h("p", { class: "pack-apercu-infos" },
      h("b", { text: EPREUVES[p.epreuve] }), ages ? ` · ${ages}` : "", ` · ${nombre}`),
    etiquettesAImporter(p, existants, fixeurs),
    p.renomme ? h("p", { class: "hint small", text: `Un pack « ${p.renomme} » existe déjà${p.niveau ? ` en ${p.niveau}` : ""} : celui-ci s'appellera « ${p.titre} », l'ancien ne change pas.` }) : null,
    p.deja ? h("p", { class: "hint small", text: `${plural(p.deja, "personnage était", "personnages étaient")} déjà dans le jeu : laissé${p.deja > 1 ? "s" : ""} tel${p.deja > 1 ? "s" : ""} quel${p.deja > 1 ? "s" : ""}.` }) : null,
    p.epreuve === "quisuis" ? h("ul", { class: "pack-apercu-liste" }, ...p.personnages.slice(0, 12).map((x) => h("li", { text: `${x.emoji ? `${x.emoji} ` : ""}${x.answer} · ${plural(x.clues.length, "indice")}` })),
      ...(p.personnages.length > 12 ? [h("li", { text: `… et ${p.personnages.length - 12} autres` })] : [])) : null,
    ids.length ? h("div", { class: "pack-apercu-vignettes" }, ...ids.slice(0, VIGNETTES).map((id) => h("img", { src: imageCache[id], alt: "" })),
      ...(ids.length > VIGNETTES ? [h("span", { class: "plus", text: `+${ids.length - VIGNETTES}` })] : [])) : null,
    lignes.length ? h("ul", { class: "pack-apercu-alertes" }, ...lignes.map(([t, c]) => h("li", { class: c, text: t }))) : null);
}

$("pack-file").onchange = () => {
  const [zip] = $("pack-file").files;
  $("pack-file").value = "";
  importerPackZip(zip);
};
// Le ZIP se dépose aussi sur le cadre « Importer un pack ».
deposeZip($("pack-import"), (zip) => importerPackZip(zip));

/** Un ZIP glissé sur [zone] : [faire](le fichier). */
function deposeZip(zone, faire) {
  zone.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types ?? [])].includes("Files")) { e.preventDefault(); zone.classList.add("depot"); } });
  zone.addEventListener("dragleave", () => zone.classList.remove("depot"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("depot");
    const [zip] = e.dataTransfer?.files ?? [];
    if (zip) faire(zip);
  });
}

/** Les groupes d'images ; ses images et les pochettes retirées à part ([RETIREES] : par groupe). */
function groupesImages() {
  const utilisees = imagesUtilisees({ quizzes, mimes, contents, songs, playlists });
  const couvertures = pochettesUtilisees({ songs, playlists });
  const desPacks = imagesDesPacks(quizzes);
  const miennes = mesImages(medias, utilisees, couvertures, desPacks);
  const packs = mesImagesDePacks(medias, desPacks, utilisees, couvertures);
  const pochettes = mesPochettes(medias, couvertures, utilisees);
  return {
    emojis: emojisBibliotheque(), photos: photosLibres(),
    miennes: miennes.filter((x) => !x.retiree), packs: packs.filter((x) => !x.retiree), pochettes: pochettes.filter((x) => !x.retiree),
    [RETIREES]: { miennes: miennes.filter((x) => x.retiree), packs: packs.filter((x) => x.retiree), pochettes: pochettes.filter((x) => x.retiree) },
  };
}

/** Image déjà rangée dans la base (une des siennes, une pochette) : choisie telle quelle, sans nouvelle copie. */
const dansLaBase = (x) => x.groupe === "miennes" || x.groupe === "packs" || x.groupe === "pochettes";

/** Ce que la recherche lit d'une image : son nom d'abord, puis sa catégorie, ses mots-clés et où elle sert. */
const nomMedia = (x) => x.nom;
const autresMedia = (x) => [x.cat, ...(x.tags ?? []), ...(x.ou ?? [])];

/**
 * Fiches en cours de saisie ou d'enregistrement : un changement venu de la base attend qu'on quitte la liste pour la
 * redessiner (sinon le champ suivant disparaîtrait sous le curseur).
 */
let mediasEnAttente = false;
let fichesEnregistrement = 0;
const listeOccupee = () => fichesEnregistrement > 0 || ($("media-list").contains(document.activeElement) && document.activeElement !== document.body);
const rattraperMedias = () => { if (mediasEnAttente && !listeOccupee()) { mediasEnAttente = false; renderMedias(true); } };
$("media-list").addEventListener("focusout", () => setTimeout(rattraperMedias, 0));

function renderMedias(force = false) {
  if (!force && listeOccupee()) { mediasEnAttente = true; return; }
  mediasEnAttente = false;
  const g = groupesImages();
  const recherche = $("media-search").value.trim();
  const filtre = (list) => list.filter((x) => correspond(x, recherche));
  const trouve = (list) => parPertinence(filtre(list), recherche, nomMedia, autresMedia);
  const chip = (key, label, n) => h("button", {
    type: "button", class: `chip${mediaGroupe === key ? " active" : ""}`, "data-groupe": key ?? "tout", text: `${label} (${n})`,
    onclick: () => { const y = window.scrollY; mediaGroupe = key; mediaCat = null; renderMedias(true); noterRubrique(y); },
  });
  const total = (k) => filtre(g[k]).length;
  const toutes = Object.keys(GROUPES_IMAGES).reduce((n, k) => n + total(k), 0);
  $("media-groups").replaceChildren(chip(null, "Tout", toutes),
    ...Object.entries(GROUPES_IMAGES).map(([k, label]) => chip(k, label, total(k))));
  $("media-count").textContent = recherche ? `${plural(toutes, "image trouvée", "images trouvées")}` : "";
  $("media-upload").hidden = mediaGroupe !== "miennes";
  if (mediaGroupe === "miennes") remplirCategoriesEnvoi(g.miennes);
  const box = $("media-list");
  // Aperçu : les groupes l'un sous l'autre, quelques images chacun.
  if (!mediaGroupe) {
    $("media-cats").replaceChildren();
    box.replaceChildren(...Object.entries(GROUPES_IMAGES).map(([k, label]) => {
      const list = trouve(g[k]);
      const voir = h("button", { type: "button", class: "btn small secondary", text: recherche ? `Voir les ${plural(list.length, "résultat")}` : `Tout voir (${list.length})`, onclick: () => { const y = window.scrollY; mediaGroupe = k; mediaCat = null; renderMedias(true); noterRubrique(y); } });
      return h("section", { class: "media-group", "data-groupe": k },
        h("div", { class: "title-row" }, h("h2", { text: label }), list.length ? voir : null,
          k === "miennes" && !recherche ? h("button", { type: "button", class: "btn small", text: "＋ Ajouter mes images", onclick: () => { const y = window.scrollY; mediaGroupe = "miennes"; mediaCat = null; renderMedias(true); noterRubrique(y); } }) : null,
          k === "photos" && !recherche && motsSansPhoto().length ? h("button", { type: "button", class: "btn small secondary pm-ouvrir", text: `🧰 Photos manquantes (${motsSansPhoto().length})`, onclick: () => { const y = window.scrollY; mediaGroupe = "photos"; mediaCat = null; renderMedias(true); noterRubrique(y); } }) : null),
        list.length ? h("div", { class: "media-grid" }, ...list.slice(0, APERCU).map((x, i, l) => vignetteMedia(x, i, l)))
          : h("p", { class: "hint small", text: recherche ? "Rien ici pour cette recherche." : k === "miennes" ? "Aucune image à vous pour l'instant : « ＋ Ajouter mes images »." : k === "pochettes" ? AUCUNE_POCHETTE : k === "packs" ? AUCUNE_IMAGE_PACK : "" }));
    }));
    return;
  }
  // Un groupe : ses catégories, puis ses images rangées par catégorie.
  const tout = trouve(g[mediaGroupe]);
  const retirees = trouve(g[RETIREES][mediaGroupe] ?? []);
  const cats = categoriesDe(tout);
  if (mediaCat && mediaCat !== RETIREES && !cats.includes(mediaCat)) mediaCat = null;
  if (mediaCat === RETIREES && !retirees.length) mediaCat = null;
  const catChip = (key, label, n) => h("button", {
    type: "button", class: `chip${mediaCat === key ? " active" : ""}`, "data-cat": key ?? "toutes", text: `${label} (${n})`,
    onclick: () => { mediaCat = key; renderMedias(true); },
  });
  $("media-cats").replaceChildren(...(cats.length > 1 || retirees.length ? [catChip(null, "Toutes", tout.length),
    ...cats.map((c) => catChip(c, c, tout.filter((x) => x.cat === c).length)),
    retirees.length ? catChip(RETIREES, "🚫 Retirées", retirees.length) : null] : []).filter(Boolean));
  const list = mediaCat === RETIREES ? retirees : mediaCat ? tout.filter((x) => x.cat === mediaCat) : tout;
  if (!list.length) {
    box.replaceChildren(h("p", { class: "hint", text: recherche ? "Aucune image ne correspond à cette recherche." : mediaGroupe === "miennes" ? "Aucune image à vous pour l'instant : ajoutez-en avec « Choisir des images sur le PC… »." : mediaGroupe === "pochettes" ? AUCUNE_POCHETTE : mediaGroupe === "packs" ? AUCUNE_IMAGE_PACK : "Aucune image." }));
    return;
  }
  const fiches = mediaGroupe === "miennes" || mediaGroupe === "packs" || mediaGroupe === "pochettes";
  const cleListe = `${mediaGroupe}|${mediaCat ?? ""}|${recherche}`;
  if (fichesMontrees.cle !== cleListe) fichesMontrees = { cle: cleListe, n: MAX_FICHES };
  const montrees = fiches ? list.slice(0, fichesMontrees.n) : list;
  const parCat = mediaCat ? [[mediaCat === RETIREES ? "🚫 Retirées" : mediaCat, montrees]] : categoriesDe(montrees).map((c) => [c, montrees.filter((x) => x.cat === c)]);
  box.replaceChildren(...parCat.flatMap(([c, items]) => [
    h("h3", { class: "content-series", text: `${c} · ${items.length}` }),
    fiches ? h("div", { class: "media-cards" }, ...items.map((x, i) => ficheMedia(x, g.miennes.concat(g[RETIREES].miennes), items, i)))
      : h("div", { class: "media-grid" }, ...items.map((x, i) => vignetteMedia(x, i, items))),
  ]));
  if (list.length > montrees.length) {
    const reste = list.length - montrees.length;
    box.append(h("button", { type: "button", class: "btn secondary fiches-suivantes", text: `Voir les ${plural(Math.min(reste, MAX_FICHES), "image suivante", "images suivantes")} (${montrees.length} sur ${list.length})`,
      onclick: () => { const y = window.scrollY; fichesMontrees.n += MAX_FICHES; renderMedias(true); window.scrollTo(0, y); } }));
  }
  // Menu temporaire (cedric, 24/10) : les mots de la banque sans vraie photo, à compléter avec ses photos.
  if (mediaGroupe === "photos" && !recherche && !mediaCat) { const pm = panneauPhotosManquantes(h, annonce); if (pm) box.prepend(pm); }
  // Les images orphelines (cedric, 26/10) : celles des thèmes supprimés, que plus rien n'utilise.
  if (mediaGroupe === "packs" && !recherche && mediaCat !== RETIREES) {
    box.prepend(h("div", { class: "doublons-outil" },
      h("button", { type: "button", class: "btn small secondary orphelines-nettoyer", text: "🧹 Images orphelines", onclick: nettoyerImagesOrphelines }),
      g.packs.length + g[RETIREES].packs.length ? h("button", { type: "button", class: "btn small danger tout-effacer", text: "🗑 Tout effacer", onclick: effacerImagesDesPacks }) : null,
      h("span", { class: "hint small", text: "Orphelines : les images de thèmes supprimés que plus rien n'utilise." })));
  }
}

/**
 * « 🧹 Images orphelines » (cedric, 26/10 : les photos des thèmes supprimés restaient) : les images que plus rien ne
 * cite, sans fiche ou rangées à un thème qui n'existe plus, et les « 🧪 Test packs » de ces thèmes (des copies pour
 * essayer). Un aperçu, puis un seul envoi. Mes images, les pochettes et tout ce qu'une prestation utilise restent.
 */
async function nettoyerImagesOrphelines() {
  document.activeElement?.blur?.();
  status("media-note", "Recherche des images orphelines…", true);
  let ids;
  try {
    ids = [...await clesDe("library/images"), ...Object.keys(medias ?? {})];
  } catch (err) {
    console.error(err);
    status("media-note", "");
    return annonce("La liste des images n'a pas pu être lue : vérifiez la connexion.");
  }
  status("media-note", "");
  const vivants = new Set([...mesPacks(quizzes), ...mesSeriesDePhotos(quizzes)].map((c) => cleTheme(themeDe(c.theme, c.title))).filter(Boolean));
  const themeVivant = (f) => { const t = themeDeFiche(f); return t != null && (vivants.has(cleTheme(t)) || [...vivants].some((v) => catDePack(v) === f.cat)); };
  const vivantsTest = new Set([...vivants].map((c) => idTestDuTheme(c)));
  const testsMorts = Object.keys(shows).filter((id) => id.startsWith(PREFIXE_TEST_THEME) && !vivantsTest.has(id));
  // Les jeux gardés de ces tests (« manches », cedric, 26/10 : 52 images Mario restaient à cause d'eux), même quand le
  // test lui-même est déjà effacé.
  const manchesMortes = Object.keys(manches ?? {}).filter((id) => {
    const sid = manches[id]?.showId;
    return typeof sid === "string" && sid.startsWith(PREFIXE_TEST_THEME) && (testsMorts.includes(sid) || (!shows[sid] && !vivantsTest.has(sid)));
  });
  const autresManches = Object.fromEntries(Object.entries(manches ?? {}).filter(([id]) => !manchesMortes.includes(id)));
  // Les personnages de Qui suis-je ? d'un thème supprimé : leur image est rangée à ce thème, et leur série n'est pas un thème vivant.
  const qui = persosARetirer((x, img) => img != null && estFicheDePack(medias[img]) && themeDeFiche(medias[img]) != null
    && !themeVivant(medias[img]) && !vivants.has(cleTheme(x.serie ?? "")));
  const resteContents = qui.contenu ? { ...contents, quisuis: qui.contenu } : contents;
  const citees = imagesCitees({ quizzes, shows: Object.fromEntries(Object.entries(shows).filter(([id]) => !testsMorts.includes(id))), manches: autresManches, mimes, contents: resteContents, songs, playlists });
  const orphelines = imagesOrphelines({ ids, medias, citees, themeVivant });
  if (!orphelines.length && !testsMorts.length && !qui.retires.length && !manchesMortes.length) return annonce("Aucune image orpheline : tout ce qui reste sert encore.", true);
  // Une seule phrase sur les images (cedric, 26/10 : « je veux juste qu'il soit marqué effacer 90 images ») ; en petit,
  // ce qui part avec elles, et pourquoi d'autres images de ces thèmes restent (une prestation s'en sert).
  const mortes = (id) => { const f = medias[id]; return estFicheDePack(f) && themeDeFiche(f) != null && !themeVivant(f); };
  const themesMorts = [...new Set([...orphelines.filter(mortes).map((id) => themeDeFiche(medias[id])), ...qui.retires.map((x) => x.serie).filter(Boolean)])];
  const effacees = new Set(orphelines);
  const restent = Object.keys(medias ?? {}).filter((id) => mortes(id) && !effacees.has(id));
  const sertA = (x) => { const c = imagesCitees(x); return restent.some((id) => c.has(id)); };
  const servent = [
    ...Object.entries(shows).filter(([id, x]) => !testsMorts.includes(id) && sertA(x)).map(([, x]) => `la prestation « ${showTitle(x)} »`),
    ...Object.values(autresManches).filter(sertA).map((m) => `le jeu gardé « ${m.title} »`),
  ];
  const MONTREES = 24;
  const contenu = h("div", { class: "doublons-apercu orphelines-apercu" },
    qui.retires.length || testsMorts.length || manchesMortes.length ? h("p", { class: "hint small orphelines-avec", text: "Ce qui s'en servait dans ces thèmes part avec elles. Mes images et les pochettes ne sont jamais touchées." }) : null,
    restent.length ? h("p", { class: "hint small orphelines-restent", text: `${plural(restent.length, "autre image reste", "autres images restent")} : ${servent.length ? `${servent.join(", ")} s'en ${servent.length > 1 ? "servent" : "sert"}` : "quelque chose s'en sert encore"}.` }) : null,
    h("div", { class: "doublons-groupe" }, ...orphelines.slice(0, MONTREES).map((id) => h("figure", { class: "doublon" },
      photoBibliotheque(id, { loading: "lazy" }), h("figcaption", { text: medias[id]?.name ?? "Sans nom" })))),
    orphelines.length > MONTREES ? h("p", { class: "hint small", text: `… et ${orphelines.length - MONTREES} autres.` }) : null);
  const titre = orphelines.length
    ? `Effacer ${orphelines.length > 1 ? `les ${orphelines.length} images` : "1 image"} ${themesMorts.length ? `des thèmes supprimés (${themesMorts.join(", ")})` : orphelines.length > 1 ? "qui ne servent plus" : "qui ne sert plus"} ?`
    : `Nettoyer les thèmes supprimés (${themesMorts.join(", ") || "anciens tests"}) ?`;
  if (!(await apercu(titre, contenu, { ok: "Effacer", danger: true }))) return;
  const ecritures = {};
  for (const id of testsMorts) ecritures[`library/shows/${id}`] = null;
  for (const id of manchesMortes) ecritures[`library/manches/${id}`] = null;
  if (qui.contenu) ecritures["library/contents/quisuis"] = qui.contenu;
  for (const id of orphelines) { ecritures[`library/images/${id}`] = null; ecritures[`library/medias/${id}`] = null; }
  try {
    await update(ref(db), ecritures);
    annonce(`✓ ${plural(orphelines.length, "image effacée", "images effacées")}.`, true);
  } catch (err) {
    console.error(err);
    annonce("Le nettoyage n'a pas pu se faire : vérifiez la connexion. Rien n'a été effacé.");
  }
}

/**
 * « 🗑 Tout effacer » (cedric, 26/10 : « je veux vraiment les effacer et repartir sur une base saine ») : toutes les
 * images des packs, et ce qui les montre dans les prestations et les jeux gardés (la question ou le personnage, la
 * prestation reste), et les personnages de Qui suis-je ? qui les ont. Mes images, les pochettes, les émojis, les photos
 * libres et la banque ne sont pas touchés.
 */
async function effacerImagesDesPacks() {
  document.activeElement?.blur?.();
  const g = groupesImages();
  const ids = new Set([...g.packs, ...g[RETIREES].packs].map((x) => x.id));
  if (!ids.size) return annonce("Aucune image de pack à effacer.", true);
  const qui = persosARetirer((x, img) => img != null && ids.has(img));
  const ecritures = {};
  const touchees = [];
  for (const [collection, liste, titre] of [["shows", shows, (x) => `la prestation « ${showTitle(x)} »`], ["manches", manches ?? {}, (m) => `le jeu gardé « ${m.title} »`]]) {
    for (const [id, x] of Object.entries(liste)) {
      if (!x) continue;
      const { valeur, retires } = sansImages(x, ids);
      if (!retires) continue;
      ecritures[`library/${collection}/${id}`] = { ...valeur, updatedAt: serverTimestamp() };
      touchees.push(titre(x));
    }
  }
  const packs = Object.values(quizzes).filter((q) => q && [...imagesCitees(q)].some((id) => ids.has(id))).map((q) => `« ${q.title} »`);
  const contenu = h("div", { class: "doublons-apercu tout-effacer-apercu" },
    h("p", { class: "hint small", text: "Mes images, les pochettes, les émojis et les photos libres ne sont pas touchés." }),
    touchees.length ? h("p", { class: "hint small tout-effacer-retirees", text: `Les questions qui les montrent sont retirées de : ${touchees.join(", ")}.` }) : null,
    packs.length ? h("p", { class: "hint small tout-effacer-packs", text: `${packs.length > 1 ? "Ces packs perdent" : "Ce pack perd"} leurs images : ${packs.join(", ")}.` }) : null);
  if (!(await apercu(`Effacer les ${plural(ids.size, "image")} des packs ?`, contenu, { ok: "Tout effacer", danger: true }))) return;
  if (qui.contenu) ecritures["library/contents/quisuis"] = qui.contenu;
  for (const id of ids) { ecritures[`library/images/${id}`] = null; ecritures[`library/medias/${id}`] = null; }
  try {
    await update(ref(db), ecritures);
    annonce(`✓ ${plural(ids.size, "image des packs effacée", "images des packs effacées")}.`, true);
  } catch (err) {
    console.error(err);
    annonce("L'effacement n'a pas pu se faire : vérifiez la connexion. Rien n'a été effacé.");
  }
}

$("media-search").oninput = () => renderMedias(true);

/** L'image d'une vignette : l'émoji en grand, la photo libre, ou la sienne lue dans la base. */
const imageDeMedia = (x) => [x.groupe === "emojis" ? h("span", { class: "emoji", text: x.emoji })
  : x.groupe === "photos" ? h("img", { src: x.src, alt: "", loading: "lazy" })
    : photoBibliotheque(x.id, { loading: "lazy" })];

/**
 * Vignette d'une image (émoji, photo libre, la sienne, pochette) : son nom dessous, ses mots-clés au survol. Un clic la
 * montre en grand ([liste] : ses voisines, pour ‹ ›) ; « 📋 » dans le coin la copie pour une question (cedric, 22/10).
 */
function vignetteMedia(x, i = 0, liste = [x]) {
  const titre = [x.cat, ...(x.tags ?? [])].filter(Boolean).join(" · ");
  const [image] = imageDeMedia(x);
  const voir = () => voirEnGrand(liste, i);
  return h("div", {
    class: "media-tile voir", "data-media": x.id, title: `${titre ? `${titre}\n` : ""}Cliquer pour voir en grand`, role: "button", tabindex: "0",
    onclick: voir, onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); voir(); } },
  },
  h("button", {
    type: "button", class: "media-copier", text: "📋", title: "Copier pour une question", "aria-label": `Copier « ${nomCopie(x)} » pour une question`,
    onclick: (e) => { e.stopPropagation(); copierImage(x, "media-note"); },
  }),
  image, h("span", { text: x.nom || "Sans nom" }));
}

/** Image copiée pour une question (« 📋 ») : « 📋 Coller » la pose ensuite dans la question ouverte. */
let imageCopiee = null;
const nomCopie = (x) => x.nom || x.emoji || "l'image";
async function copierImage(x, statut) {
  imageCopiee = x;
  if (x.groupe === "emojis") {
    // Aussi dans le presse-papiers du PC : Ctrl+V le colle dans une case d'émoji ou une carte.
    let pressePapiers = true;
    try { await navigator.clipboard.writeText(x.emoji); } catch { pressePapiers = false; }
    return status(statut, `${x.emoji} copié : dans une question, « 📋 Coller »${pressePapiers ? ", ou Ctrl+V dans la case de l'émoji" : ""}.`, true);
  }
  status(statut, `« ${nomCopie(x)} » copiée : dans une question, « 📋 Coller » à côté de « 🖼️ Bibliothèque… », ou 📋 sur une réponse en image.`, true);
}

/** Image ouverte en grand : ses voisines dans la liste affichée, et sa place. */
let vis = null;
function voirEnGrand(liste, i) {
  vis = { liste, i };
  dessinerVisionneuse();
  if (!$("visionneuse").open) $("visionneuse").showModal();
  $("vis-fermer").focus();
}
function dessinerVisionneuse() {
  const x = vis.liste[vis.i];
  $("vis-image").replaceChildren(x.groupe === "emojis" ? h("span", { class: "emoji", text: x.emoji })
    : x.groupe === "photos" ? h("img", { src: x.src, alt: x.nom ?? "" }) : photoBibliotheque(x.id, { alt: x.nom ?? "" }));
  $("vis-nom").textContent = x.nom || "Sans nom";
  // Bonne pour le mime (cedric, 24/10) : sa tranche d'âge, dans la fiche seulement (photos libres et émojis).
  $("vis-details").textContent = [GROUPES_IMAGES[x.groupe], x.cat, ...(x.tags ?? []),
    x.groupe === "photos" || x.groupe === "emojis" ? etiquetteMime(x.nom) : ""].filter(Boolean).join(" · ");
  $("vis-ou").textContent = x.ou?.length ? `Utilisée dans : ${x.ou.join(", ")}` : "";
  const plusieurs = vis.liste.length > 1;
  $("vis-prec").hidden = !plusieurs;
  $("vis-suiv").hidden = !plusieurs;
  $("vis-pos").textContent = plusieurs ? `${vis.i + 1} / ${vis.liste.length}` : "";
  $("vis-fiche").hidden = !dansLaBase(x) || mediaGroupe === x.groupe;
  status("vis-status", "");
}
const voisine = (d) => {
  if (!vis || vis.liste.length < 2) return;
  vis.i = (vis.i + d + vis.liste.length) % vis.liste.length;
  dessinerVisionneuse();
};
$("vis-prec").onclick = () => voisine(-1);
$("vis-suiv").onclick = () => voisine(1);
$("vis-fermer").onclick = () => $("visionneuse").close();
$("vis-copier").onclick = () => copierImage(vis.liste[vis.i], "vis-status");
// Ses images et les pochettes : « ✏️ Sa fiche » ouvre leur groupe pour changer nom, catégorie, mots-clés.
$("vis-fiche").onclick = () => {
  const x = vis.liste[vis.i];
  $("visionneuse").close();
  const y = window.scrollY;
  mediaGroupe = x.groupe;
  mediaCat = x.groupe === "miennes" ? x.cat : null;
  renderMedias(true);
  noterRubrique(y);
};
$("visionneuse").addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") { e.preventDefault(); voisine(-1); } else if (e.key === "ArrowRight") { e.preventDefault(); voisine(1); }
});
// Un clic à côté de l'image (sur le voile) ferme.
$("visionneuse").addEventListener("click", (e) => { if (e.target === $("visionneuse")) $("visionneuse").close(); });

/**
 * Fiche d'une de ses images ou d'une pochette : nom, catégorie (pas pour une pochette), mots-clés, où elle sert ;
 * chaque champ s'enregistre en le quittant.
 */
function ficheMedia(x, toutes, liste = [x], i = 0) {
  const pochette = x.groupe === "pochettes";
  // Image d'un pack : rangée par thème du pack, sa fiche garde la catégorie réservée (sinon elle passerait dans ses images).
  const dePack = x.groupe === "packs";
  const enregistrer = async (champs, message) => {
    const f = ficheImage({ nom: x.nom, cat: dePack ? (estFicheDePack(medias[x.id]) ? medias[x.id].cat : PACKS) : x.cat, tags: x.tags, retiree: x.retiree, ...champs }, medias[x.id]);
    if (!f) return status("media-note", "Donnez un nom à l'image.");
    fichesEnregistrement++;
    try {
      await set(ref(db, `library/medias/${x.id}`), { ...f, updatedAt: serverTimestamp() });
      Object.assign(x, champs);
      status("media-note", message ?? `« ${f.name} » enregistrée.`, true);
    } catch (err) {
      console.error(err);
      status("media-note", "Enregistrement impossible : vérifiez Internet puis réessayez.");
    } finally {
      fichesEnregistrement--;
    }
    // Retirée ou remise : la fiche change de place tout de suite ; sinon, dès qu'on quitte la liste.
    if ("retiree" in champs) renderMedias(true);
    else rattraperMedias();
  };
  const nom = h("input", {
    class: "media-name", value: x.nom, maxlength: 80, "aria-label": "Nom de l'image", placeholder: "Nom (ex. Elsa)",
    onchange: (e) => { if (e.target.value.trim()) enregistrer({ nom: e.target.value }); else { e.target.value = x.nom; status("media-note", "Une image garde toujours un nom."); } },
  });
  const options = [...(x.cat === A_RANGER ? [A_RANGER] : []), ...categoriesPerso(toutes)];
  if (!options.includes(x.cat)) options.unshift(x.cat);
  const cat = pochette || dePack ? null : h("select", {
    class: "media-cat", "aria-label": "Catégorie",
    onchange: async (e) => {
      const choix = e.target;
      let c = choix.value;
      if (c === NOUVELLE_CAT) {
        c = ((await demanderTexte("Nom de la nouvelle catégorie (ex. Pokémon, Super-héros…) :", "", { ok: "Créer", maxlength: 40 })) ?? "").trim().slice(0, 40);
        if (!c) { choix.value = x.cat; return; }
      }
      enregistrer({ cat: c }, `« ${x.nom} » rangée dans « ${c} ».`);
    },
  }, ...options.map((c) => h("option", { value: c, text: c })), h("option", { value: NOUVELLE_CAT, text: NOUVELLE_CAT }));
  if (cat) cat.value = x.cat;
  const tags = h("input", {
    class: "media-tags", value: x.tags.join(", "), maxlength: 300, "aria-label": "Mots-clés", placeholder: "Mots-clés…", title: "Mots-clés, séparés par des virgules (princesse, Disney…)",
    onchange: (e) => enregistrer({ tags: motsCles(e.target.value) }),
  });
  const ici = pochette ? "les pochettes" : dePack ? "les images des packs" : "vos images";
  const bouton = x.retiree
    ? h("button", { type: "button", class: "btn small", text: "Remettre", onclick: () => enregistrer({ retiree: false }, `« ${x.nom} » est remise dans ${ici}.`) })
    : h("button", { type: "button", class: "btn small secondary", text: "Retirer", title: `Elle disparaît de ${ici} ; les chansons, les quiz et les jeux qui l'utilisent la gardent.`, onclick: () => enregistrer({ retiree: true }, `« ${x.nom} » est retirée : retrouvez-la dans « 🚫 Retirées ». Les chansons, les quiz et les jeux qui l'utilisent la gardent.`) });
  return h("div", { class: `media-card${x.retiree ? " retiree" : ""}`, "data-media": x.id },
    photoBibliotheque(x.id, { loading: "lazy", class: "voir", title: "Voir en grand", onclick: () => voirEnGrand(liste, i) }),
    nom, cat, tags,
    x.ou.length ? h("span", { class: "small", text: `Utilisée dans : ${x.ou.join(", ")}` }) : null,
    h("div", { class: "row" },
      h("button", { type: "button", class: "btn small secondary media-copier-fiche", text: "📋 Copier", title: "Copier pour une question", onclick: () => copierImage(x, "media-note") }),
      bouton));
}

/** Mot à chercher pour illustrer une question : sa bonne réponse, sans émoji (« 🐱 Chat » → « Chat ») ; rien pour Vrai / Faux. */
const nomReponse = (q) => {
  const r = `${q.choices?.[q.correct] ?? ""}`.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  return /^(vrai|faux)$/i.test(r) ? "" : r;
};

/** Octets d'une image de la bibliothèque : une photo libre lue sur le site, une des siennes dans la base. */
async function blobDe(x) {
  if (x.groupe === "photos") return (await fetch(x.src)).blob();
  const data = imageCache[x.id] ?? (await get(ref(db, `library/images/${x.id}`))).val();
  if (typeof data !== "string") throw new Error("Image introuvable");
  imageCache[x.id] = data;
  return (await fetch(data)).blob();
}

/**
 * Fenêtre « 🖼️ Bibliothèque » : la recherche de la page Bibliothèque, pour choisir une image en fabriquant un quiz.
 * [groupes] : ceux proposés ; [recherche] : le mot cherché d'abord. Rend l'image choisie, ou null (Annuler, Échap).
 * [plusieurs] (cedric, 24/10, le « ＋ » des Mimes) : un clic coche ou décoche, les catégories du groupe filtrent aussi,
 * « ＋ Ajouter la sélection » rend les images cochées dans l'ordre (une liste, vide si Annuler). [deja] : pour une
 * image, où elle sert déjà (signalé en rouge, permis) ou rien.
 */
function choisirDansBibliotheque({ titre, groupes = Object.keys(GROUPES_IMAGES), recherche = "", plusieurs = false, deja = null }) {
  return new Promise((resolve) => {
    const g = groupesImages();
    let groupe = null;
    let cat = null;
    const cochees = new Map();
    const champ = h("input", { type: "search", class: "choix-recherche", value: recherche, placeholder: "Rechercher : nom, catégorie, mot-clé…", "aria-label": "Rechercher une image", autocomplete: "off" });
    const puces = h("div", { class: "chips media-cats" });
    const pucesCats = h("div", { class: "chips media-cats choix-cats" });
    const grille = h("div", { class: "media-grid choix-grille" });
    const ajouter = h("button", { type: "button", class: "btn choix-ajouter", onclick: () => fermer([...cochees.values()]) });
    const fermer = (x) => { voile.remove(); resolve(plusieurs ? x ?? [] : x); };
    const majAjouter = () => {
      ajouter.disabled = !cochees.size;
      ajouter.textContent = cochees.size ? `＋ Ajouter la sélection (${cochees.size})` : "＋ Ajouter la sélection";
    };
    const dessiner = () => {
      const q = champ.value.trim();
      const listes = Object.fromEntries(groupes.map((k) => [k, g[k].filter((x) => correspond(x, q))]));
      const n = (k) => (k ? listes[k].length : groupes.reduce((t, x) => t + listes[x].length, 0));
      puces.replaceChildren(...[null, ...groupes].map((k) => h("button", {
        type: "button", class: `chip${groupe === k ? " active" : ""}`, "data-groupe": k ?? "tout", text: `${k ? GROUPES_IMAGES[k] : "Tout"} (${n(k)})`,
        onclick: () => { groupe = k; cat = null; dessiner(); },
      })));
      // Les meilleurs résultats d'abord ; à égalité, les images des packs puis les siennes avant les autres (on y cherche
      // un personnage, un film).
      const rang = (k) => (k === "packs" ? 0 : k === "miennes" ? 1 : 2);
      let items = parPertinence(groupe ? listes[groupe] : [...groupes].sort((a, b) => rang(a) - rang(b)).flatMap((k) => listes[k]), q, nomMedia, autresMedia);
      // Plusieurs à choisir : les catégories du groupe ouvert filtrent aussi (Animaux, À manger…).
      const cats = plusieurs && groupe ? categoriesDe(items) : [];
      if (cat && !cats.includes(cat)) cat = null;
      pucesCats.replaceChildren(...(cats.length > 1 ? [null, ...cats].map((c) => h("button", {
        type: "button", class: `chip${cat === c ? " active" : ""}`, "data-cat": c ?? "toutes", text: `${c ?? "Toutes"} (${c ? items.filter((x) => x.cat === c).length : items.length})`,
        onclick: () => { cat = c; dessiner(); },
      })) : []));
      if (cat) items = items.filter((x) => x.cat === cat);
      items = items.slice(0, plusieurs ? 400 : 120);
      grille.replaceChildren(...items.map((x) => {
        const ou = deja?.(x);
        const tuile = h("button", {
          type: "button", class: `media-tile${cochees.has(x.id) ? " cochee" : ""}${ou ? " deja" : ""}`, "data-media": x.id,
          title: [ou ? `Déjà utilisée dans ${ou}` : null, [x.cat, ...(x.tags ?? [])].filter(Boolean).join(" · ")].filter(Boolean).join("\n"),
          ...(plusieurs ? { "aria-pressed": cochees.has(x.id) ? "true" : "false" } : {}),
          onclick: () => {
            if (!plusieurs) return fermer(x);
            if (cochees.has(x.id)) cochees.delete(x.id); else cochees.set(x.id, x);
            tuile.classList.toggle("cochee", cochees.has(x.id));
            tuile.setAttribute("aria-pressed", cochees.has(x.id) ? "true" : "false");
            majAjouter();
          },
        }, ...imageDeMedia(x), h("span", { text: x.nom || "Sans nom" }));
        return tuile;
      }));
      if (!items.length) grille.append(h("p", { class: "hint", text: q ? "Aucune image pour cette recherche : essayez un autre mot." : "Aucune image." }));
    };
    champ.oninput = dessiner;
    // Rien pour le mot proposé : on montre toutes les images plutôt qu'une fenêtre vide.
    if (recherche && !groupes.some((k) => g[k].some((x) => correspond(x, recherche)))) champ.value = "";
    majAjouter();
    const voile = h("div", {
      class: "cadre-voile choix-voile", onclick: (e) => { if (e.target === voile) fermer(null); },
      onkeydown: (e) => { if (e.key === "Escape") fermer(null); },
    }, h("div", { class: "cadre-boite choix-boite", role: "dialog", "aria-label": titre },
      h("p", { class: "label", text: `🖼️ ${titre}` }),
      h("p", { class: "hint small", text: plusieurs
        ? "Cherchez par nom, catégorie ou mot-clé ; un clic coche ou décoche l'image ; puis « ＋ Ajouter la sélection »."
        : "Cherchez par nom, catégorie ou mot-clé ; un clic choisit l'image. Vos images se rangent dans Bibliothèque › Images." }),
      champ, puces, pucesCats, grille,
      h("div", { class: "row" }, h("button", { type: "button", class: "btn secondary", text: "Annuler", onclick: () => fermer(null) }), plusieurs ? ajouter : null)));
    document.body.append(voile);
    dessiner();
    champ.focus();
  });
}

/** Catégorie des images envoyées : celle ouverte, sinon « À ranger » ; on peut en créer une. */
function remplirCategoriesEnvoi(miennes) {
  const sel = $("media-new-cat");
  const avant = sel.value;
  const cats = categoriesPerso(miennes);
  if (avant && avant !== A_RANGER && avant !== NOUVELLE_CAT && !cats.includes(avant)) cats.unshift(avant);
  sel.replaceChildren(h("option", { value: A_RANGER, text: "À ranger (sans catégorie)" }), ...cats.map((c) => h("option", { value: c, text: c })), h("option", { value: NOUVELLE_CAT, text: NOUVELLE_CAT }));
  sel.value = mediaCat && mediaCat !== RETIREES && mediaCat !== A_RANGER ? mediaCat : avant && avant !== NOUVELLE_CAT ? avant : A_RANGER;
}
$("media-new-cat").onchange = async (e) => {
  const choix = e.target;
  if (choix.value !== NOUVELLE_CAT) return;
  const c = ((await demanderTexte("Nom de la nouvelle catégorie (ex. Pokémon, Super-héros…) :", "", { ok: "Créer", maxlength: 40 })) ?? "").trim().slice(0, 40);
  if (!c) { choix.value = A_RANGER; return; }
  choix.prepend(h("option", { value: c, text: c }));
  choix.value = c;
};

// Ses images : chacune réduite comme une illustration de question, rangée une seule fois, avec sa fiche.
$("media-files").onchange = async (e) => {
  const files = [...(e.target.files ?? [])].filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.name)).slice(0, MAX_PHOTOS);
  e.target.value = "";
  if (!files.length) return;
  const cat = $("media-new-cat").value;
  const tags = motsCles($("media-new-tags").value);
  let n = 0;
  for (const [k, f] of files.entries()) {
    status("media-status", `Image ${k + 1} / ${files.length}…`, true);
    try {
      const data = await compressImage(f);
      const id = await imageId(data);
      const target = ref(db, `library/images/${id}`);
      if (!(await get(target)).exists()) await set(target, data);
      imageCache[id] = data;
      // Une image déjà là garde son nom et sa catégorie ; elle reçoit les nouveaux mots-clés et revient si elle était retirée.
      const avant = medias[id];
      const fiche = ficheImage({ nom: avant?.name ?? (wordFromImage(f.name) || `Image ${n + 1}`), cat: avant?.cat ?? cat, tags: [...motsCles(avant?.tags), ...tags] }, avant);
      await set(ref(db, `library/medias/${id}`), { ...fiche, updatedAt: serverTimestamp() });
      n++;
    } catch (err) {
      console.error(err);
    }
  }
  const ou = cat && cat !== A_RANGER ? ` dans « ${cat} »` : "";
  status("media-status", n === files.length ? `${plural(n, "image ajoutée", "images ajoutées")}${ou}. Vérifiez leur nom et leurs mots-clés ci-dessous.`
    : `${n} image${n > 1 ? "s" : ""} sur ${files.length} ajoutée${n > 1 ? "s" : ""}${ou} : les autres sont illisibles (JPEG ou PNG).`, n > 0);
  mediaCat = n && cat !== A_RANGER ? cat : n ? A_RANGER : mediaCat;
  renderMedias(true);
};

// ---------- Jeux : les mini-jeux par famille (tuiles de l'accueil, page de chaque jeu) ----------

const plural = (n, word, many = `${word}s`) => `${n} ${n > 1 ? many : word}`;

/** Les jeux par famille : ce qui se prépare dans la bibliothèque, ce qui vient d'un quiz, ce qui est intégré. */
const GAME_GROUPS = [
  { title: "Avec vos contenus", hint: "Vous préparez le contenu dans la bibliothèque, une fois, et vous le réutilisez dans toutes les prestations.", games: [
    { type: "quiz", icon: "?", rule: "Questions à 2, 3 ou 4 réponses écrites sur les pupitres ; toutes les équipes qui trouvent marquent. Une question peut aussi être un « Juste Chiffre » (réponse en nombre) et montrer une petite photo à la révélation. Super Finale : dans la prestation, les dernières questions du quiz peuvent compter ×2, ×3, ×4 ou ×5 (choisi en direct sur la régie).",
      status: () => quizTileLine(quizQuestions), },
    { type: "illustre", icon: "📷", rule: "Pour les petits, dès 5 ans : l'animatrice lit la question, chaque réponse est une photo avec son mot, sur la TV et les tablettes. Toutes les équipes qui trouvent marquent, comme au Quiz. Les questions se piochent dans la banque des tout-petits (388 mots en photos) ou se font à la main.",
      status: () => quizTileLine(illustreQuestions), },
    { type: "mimes", icon: "🎭", rule: "Équipe par équipe : un enfant devine, ses coéquipiers miment l'image. 50 points par mime trouvé.",
      status: () => `${plural(Object.keys(mimes).length, "collection perso", "collections perso")} · ${plural(mancheGroups(manches, "mimes").pinned.length + mancheGroups(manches, "mimes").active.length, "manche")}`, },
    { type: "blind", icon: "🎵", rule: "Les morceaux d'une playlist, dans l'ordre : le premier qui buzze donne le titre à voix haute, vous validez.",
      status: () => plural(Object.values(playlists).filter((p) => !isStatuesList(p)).length, "playlist"), },
    { type: "musical", icon: "🎶", rule: "Un extrait sur la TV, et sur les pupitres le vrai titre parmi 3 mots de son refrain (modifiables dans la prestation).",
      status: () => plural(Object.values(playlists).filter((p) => !isStatuesList(p) && playableTracks(p).length >= 2).length, "playlist utilisable", "playlists utilisables"), },
    { type: "statues", icon: "🗿", rule: "Vos chansons jouent sur la TV et s'arrêtent par moments : tout le monde se fige ! Vous désignez l'équipe gagnante depuis la régie. Dans la prestation : la durée et vos chansons (🎲, une playlist ou à la main), dont la TV joue le refrain (aucune : la musique de la fête).",
      status: () => plural(statuesChoices(playlists).length, "chanson disponible", "chansons disponibles"), },
  ] },
  { title: "Tirés d'un quiz", hint: "Rien de plus à préparer : ces jeux reprennent les questions d'un quiz de la bibliothèque. Dans la prestation, choisissez le quiz et combien de questions.", games: [
    { type: "express", icon: "✔", rule: "Des affirmations Vrai / Faux au chrono court du profil : tirées au 🎲 dans le Vrai ou Faux tout prêt, reprises d'un ancien anniversaire ou de vos quiz. Super Finale : les dernières affirmations peuvent compter ×2, ×3, ×4 ou ×5 (choisi en direct sur la régie).", needs: "Vrai / Faux validées" },
    { type: "zoom", icon: "🔍", rule: "Une photo d'un quiz ou de la banque se dévoile peu à peu.", needs: "photos" },
    { type: "flou", icon: "🌫", rule: "Une photo d'un quiz ou de la banque devient nette peu à peu, le premier qui buzze répond.", needs: "photos" },
  ] },
  { title: "Contenu intégré", hint: "Prêts à jouer : la manche tire au hasard dans un catalogue adapté à l'âge. Vous pouvez retirer des éléments et ajouter les vôtres.", games: [
    { type: "chante", icon: "🎤" }, { type: "quisuis", icon: "🕵" }, { type: "disparu", icon: "🎩" },
    { type: "pictionary", icon: "✏️", rule: `Équipe par équipe : vous montrez un mot sur la tablette de l'équipe, un enfant le dessine et le dessin s'affiche en direct sur la TV. ${PICTO_POINTS} points si son équipe trouve avant la fin du chrono. Le temps de dessin se choisit dans la prestation.` },
  ] },
  { title: "Sans contenu", hint: "Rien à préparer.", games: [
    { type: "coffres", icon: "🗝️", rule: "Une chance de se refaire… ou de dégringoler ! Chaque équipe à son tour ouvre un coffre sur sa tablette : bonus ou malus, tirés au sort à l'ouverture (l'équipe la plus en retard commence). Après quelques tours sans danger, une bombe se cache dans un des coffres, et un coffre en or qui rapporte 500 points : l'équipe qui ouvre la bombe perd 300 points (jamais sous 0) et le jeu s'arrête sur le bilan. Le classement s'affiche après chaque coffre. Personne ne connaît le contenu des coffres, régie comprise. Idéal en dernier jeu." },
    { type: "patate", icon: "💣", rule: "La bombe peut exploser à tout moment ! Elle passe d'équipe en équipe : sur sa tablette, l'équipe qui la tient choisit à qui l'envoyer (jamais tout de suite à l'équipe qui vient de l'envoyer, sauf à 2 équipes ; on ne peut la renvoyer que 2 secondes après l'avoir reçue). La mèche, tirée au sort, reste secrète : à chaque explosion, l'équipe qui tient la bombe perd 100 points (jamais sous 0), toutes les autres en gagnent 100. Trois bombes par partie d'office, de 1 à 6 à régler dans la prestation : après chaque explosion, une nouvelle mèche s'allume." },
    { type: "duel", icon: "🤠", rule: "Face-à-face entre un joueur de deux équipes, chacun sur sa tablette : la tension monte, les robots feintent… puis PAN ! Le premier qui tire après le PAN gagne 100 points ; celui qui tire trop tôt perd. L'appli fait passer chaque joueur une fois ; Sarah peut lancer un duel de plus depuis son téléphone." },
    { type: "simon", icon: "🔴", rule: "Le robot prof montre au tableau une suite de boules de couleur qui s'allument une à une, chacune avec sa note. À chaque suite, il en ajoute une. Dès 4 éléments, les chiffres débarquent (rouge vert bleu 4 jaune…). Sur sa tablette, un joueur de chaque équipe (un autre à chaque suite) tape la suite puis « Valider ». La TV montre en direct ce que chaque équipe tape, en « ? ». Une erreur élimine l'équipe du tour, la dernière en jeu gagne le tour (300 points). Si toutes se trompent sur la même suite, la plus avancée gagne, à égalité la plus rapide." },
    { type: "chrono", icon: "⏱️", rule: "Le grand chrono de la TV part de 0… puis Buzzy le cache sous un drap ! Chaque équipe continue de compter dans sa tête et buzze une seule fois, quand elle pense être pile à la cible (30 secondes par exemple). La révélation montre la cible et l'écart de chaque équipe : la plus proche gagne le tour : 100 points, 50 pour la 2e, 25 pour la 3e. Sarah peut changer la cible avant chaque tour sur son téléphone." },
    { type: "gonfleur", icon: "🎈", rule: "Chaque équipe tapote sa tablette le plus vite possible pour gonfler son ballon sur la TV ; on peut se relayer. Le premier ballon qui éclate gagne 300 points, les autres équipes 150. Depuis la régie, « Arrêter la course » donne la victoire au plus gros ballon." },
  ] },
];

/** « 3 quiz · 26 questions validées » : les quiz d'un jeu ([questions] : celles qu'il joue). */
function quizTileLine(questions) {
  const used = Object.values(quizzes).filter((q) => q && questions(q).length);
  const ok = used.reduce((t, q) => t + questions(q).length, 0);
  return `${plural(used.length, "quiz", "quiz")} · ${plural(ok, "question validée", "questions validées")}`;
}

/** Règle et état du contenu d'un jeu : sur sa tuile de l'accueil et sur sa page. */
function gameInfo(g) {
  const quizGame = QUIZ_GAMES[g.type];
  const content = CONTENT_GAMES[g.type];
  const rule = g.rule ?? (content ? `${BUILTIN_GAMES[g.type].rule[0].toUpperCase()}${BUILTIN_GAMES[g.type].rule.slice(1)}.` : "");
  const line = g.status ? g.status()
    : quizGame ? [g.type === "zoom" || g.type === "flou" ? plural(PHOTOS_BANQUE.size, "photo de la banque", "photos de la banque") : "",
      `${plural(Object.values(quizzes).filter((q) => (QUIZ_GAMES[g.type]?.questions ?? playable)(q).length).length, "quiz utilisable", "quiz utilisables")} (avec des ${g.needs})`].filter(Boolean).join(" · ")
    : content ? builtinLine(g.type)
    : "Rien à préparer";
  return { rule, line };
}

/** Accord des mots d'un jeu : « 3 familles actives », « 2 mots ajoutés ». */
const accord = (unit, n, mot) => `${mot}${unit === "famille" ? "e" : ""}${n > 1 ? "s" : ""}`;
const actifs = (unit, n) => `${n} ${unit}${n > 1 ? "s" : ""} ${accord(unit, n, "actif")}`;

/** « 38 mots actifs dont 2 ajoutés · 3 retirés » */
function builtinLine(type) {
  const game = CONTENT_GAMES[type];
  const active = activeItems(type, contents[type]).length;
  const added = contentExtras(type, contents[type]).length;
  const off = game.catalog.length + added - active;
  return [`${actifs(game.unit, active)}${added ? ` dont ${added} ${accord(game.unit, added, "ajouté")}` : ""}`, off ? `${off} ${accord(game.unit, off, "retiré")}` : ""].filter(Boolean).join(" · ");
}

// ---------- Contenu intégré d'un jeu (Chante le mot !, Qui suis-je ?, Qui a disparu ?) ----------

let builtinType = null;

function openBuiltin(type) {
  builtinType = type;
  $("builtin-title").textContent = ROUND_TYPES[type];
  const rule = BUILTIN_GAMES[type]?.rule ?? PICTO_RULE;
  $("builtin-rule").textContent = `${rule[0].toUpperCase()}${rule.slice(1)}. ${type === "pictionary" ? "Chaque tour tire un mot au hasard parmi les mots actifs" : "Chaque manche tire au hasard parmi les éléments actifs ; le nombre se choisit dans la prestation"}. Les éléments marqués « grands » ne sortent pas pour les 6-8 ans.`;
  status("builtin-status", "");
  renderBuiltinForm();
  show("builtin");
  renderBuiltin();
  histJeu.depart();
}

/** Page d'un jeu (page du jeu) : chaque touche est enregistrée tout de suite ; Retour et Annuler réenregistrent l'état d'avant. */
const histJeu = historique({
  ecran: $("screen-builtin"),
  precedent: pagePrecedente,
  enregistreSeul: true,
  capturer: () => (builtinType ? builtinState(builtinType) : null),
  restaurer: (e) => { if (builtinType && e) saveBuiltin(builtinType, e, "Modification annulée."); },
});

/** État enregistré du jeu, en listes simples : clés retirées et ajouts valables. */
function builtinState(type) {
  const c = contents[type] ?? {};
  const off = (Array.isArray(c.off) ? c.off : Object.values(c.off ?? {})).map((k) => `${k}`.toLowerCase());
  return { off, extra: contentExtras(type, c), images: contentImages(c) };
}

async function saveBuiltin(type, next, message) {
  const images = next.images ?? builtinState(type).images;
  try {
    await set(ref(db, `library/contents/${type}`), {
      off: next.off.length ? next.off : null,
      extra: next.extra.length ? next.extra.map(({ level, ...x }) => x) : null,
      images: Object.keys(images).length ? images : null,
      updatedAt: serverTimestamp(),
    });
    status("builtin-status", message, true);
    histJeu.noter();
  } catch (err) {
    console.error(err);
    status("builtin-status", "Enregistrement refusé : vérifiez Internet ou reconnectez-vous.");
  }
}

function renderBuiltin() {
  const type = builtinType;
  if (!type) return;
  const game = CONTENT_GAMES[type];
  const { off, extra } = builtinState(type);
  const active = activeItems(type, contents[type]).length;
  $("builtin-count").textContent = `${actifs(game.unit, active)} sur ${game.catalog.length + extra.length}`;
  const { images } = builtinState(type);
  const tile = (item, custom) => {
    const key = game.key(item);
    const on = !off.includes(key);
    // Qui a disparu ? : une famille avec des photos (de la banque, ou à soi) montre ses photos, les autres leurs émojis.
    const enPhotos = type === "disparu" && (isPhotoTheme(item) || item.objects.some((o) => o.imageId));
    const detail = type === "quisuis" ? item.clues.join(" · ") : type === "disparu" && !enPhotos ? item.objects.map((o) => o.image).join(" ") : "";
    // Au plus deux lignes de vignettes (les familles de la banque ont des dizaines de photos) : la carte garde la
    // hauteur de ses voisines, le reste est compté.
    const VIGNETTES = 14;
    const vignettes = enPhotos
      ? h("span", { class: "detail vignettes" }, ...item.objects.slice(0, VIGNETTES).map((o) => (o.imageId ? photoBibliotheque(o.imageId, { alt: o.word, title: o.word })
        : o.banque ? h("img", { src: `banque/${o.banque}.jpg`, alt: o.word, title: o.word, loading: "lazy" }) : h("span", { title: o.word, text: o.image }))),
        ...(item.objects.length > VIGNETTES ? [h("span", { class: "plus", text: `+${item.objects.length - VIGNETTES}` })] : []))
      : null;
    // Qui suis-je ? : image du personnage ; Pictionary : vraie photo du mot, à la place de son émoji.
    const photo = type === "quisuis" || type === "pictionary" ? contentPhoto(type, item, key, images) : null;
    // Repère de préparation, jamais bloquant : le personnage se révélera sans visuel.
    const missing = type === "quisuis" && !item.emoji && !images[contentSlot(key)];
    return h("div", { class: `content-item${on ? " on" : ""}${custom ? " custom" : ""}`, "data-key": key },
      h("button", {
        type: "button", class: "content-toggle", "aria-pressed": on ? "true" : "false",
        title: on ? "Retirer du jeu" : "Remettre dans le jeu",
        onclick: () => saveBuiltin(type, { off: on ? [...off, key] : off.filter((k) => k !== key), extra },
          on ? `« ${game.label(item)} » est retiré du jeu.` : `« ${game.label(item)} » est remis dans le jeu.`),
      },
        h("b", { text: game.label(item) }),
        item.level === 2 ? h("span", { class: "tag", text: "grands" }) : null,
        custom ? h("span", { class: "tag", text: "ajouté" }) : null,
        missing ? h("span", { class: "tag missing", text: "image ou émoji manquant" }) : null,
        detail ? h("span", { class: "detail", text: detail }) : null,
        vignettes),
      photo,
      custom && type === "quisuis" ? h("button", { type: "button", class: "icon", title: "Modifier ce personnage", "aria-label": "Modifier ce personnage", text: "✏️", onclick: () => modifierPersonnage(item) }) : null,
      custom ? h("button", {
        type: "button", class: "icon", title: "Supprimer cet ajout", text: "✕",
        onclick: async () => {
          if (!(await confirmer(`Supprimer « ${game.label(item)} » ?`, { ok: "Supprimer", danger: true }))) return;
          saveBuiltin(type, { off: off.filter((k) => k !== key), extra: extra.filter((x) => game.key(x) !== key) }, `« ${game.label(item)} » est supprimé.`);
        },
      }) : null);
  };
  const tiles = [...game.catalog.map((x) => [x, false]), ...extra.map((x) => [x, true])];
  // Qui suis-je ? (cedric, 24/10) : les personnages tout prêts, les vôtres, puis vos séries (chacune se renomme ou se
  // supprime d'un coup) ; une série s'appelle dans une prestation (« 📗 Intégrer une de vos séries »).
  if (type === "quisuis") {
    const noms = nomsDesSeries(extra);
    $("bi-serie-list")?.replaceChildren(...noms.map((nom) => h("option", { value: nom })));
    const renommerSerie = async (nom) => {
      const neuf = (await demanderTexte(`Nouveau nom de la série « ${nom} »`, nom, { ok: "Renommer", maxlength: 30 }))?.trim();
      if (!neuf || neuf === nom) return;
      if (noms.includes(neuf)) return status("builtin-status", `La série « ${neuf} » existe déjà.`);
      saveBuiltin(type, { off, extra: extra.map((x) => (x.serie === nom ? { ...x, serie: neuf } : x)) }, `Série « ${nom} » renommée « ${neuf} ».`);
    };
    const supprimerSerie = async (nom, xs) => {
      if (!(await confirmer(`Supprimer la série « ${nom} » ${xs.length > 1 ? `et ses ${xs.length} personnages` : "et son personnage"} ?`, { ok: "Supprimer", danger: true }))) return;
      const cles = new Set(xs.map(([x]) => game.key(x)));
      const { images: imgs } = builtinState(type);
      saveBuiltin(type, {
        off: off.filter((k) => !cles.has(k)), extra: extra.filter((x) => x.serie !== nom),
        images: Object.fromEntries(Object.entries(imgs).filter(([slot]) => ![...cles].some((k) => contentSlot(k) === slot))),
      }, `Série « ${nom} » supprimée.`);
    };
    const groupes = [
      ["Personnages tout prêts", tiles.filter(([, custom]) => !custom), null],
      ["Mes personnages", tiles.filter(([x, custom]) => custom && !x.serie), null],
      ...noms.map((nom) => [nom, tiles.filter(([x, custom]) => custom && x.serie === nom), nom]),
    ].filter(([, xs]) => xs.length);
    $("builtin-items").replaceChildren(...groupes.flatMap(([titre, xs, serie]) => [
      serie ? h("div", { class: "content-series serie-biblio", "data-serie": serie },
        h("h3", { text: `📚 Série « ${serie} » · ${plural(xs.length, "personnage")}` }),
        h("button", { type: "button", class: "btn secondary small", text: "Renommer", onclick: () => renommerSerie(serie) }),
        h("button", { type: "button", class: "btn danger small", text: "Supprimer la série", onclick: () => supprimerSerie(serie, xs) }))
        : h("h3", { class: "content-series", text: titre }),
      ...xs.map(([x, custom]) => tile(x, custom)),
    ]));
    return;
  }
  // Pictionary : les mots rangés par série (Animaux, À manger…, puis « Mes mots »).
  if (type === "pictionary") {
    $("builtin-items").replaceChildren(...pictoSeriesList(tiles.map(([x]) => x)).flatMap((name) => [
      h("h3", { class: "content-series", text: name }),
      ...tiles.filter(([x]) => pictoSeriesOf(x) === name).map(([x, custom]) => tile(x, custom)),
    ]));
    return;
  }
  $("builtin-items").replaceChildren(...tiles.map(([x, custom]) => tile(x, custom)));
}

/**
 * Qui suis-je ? : l'image du personnage (générée par exemple avec ChatGPT) ; Pictionary : une vraie photo du mot.
 * Réduite et rangée comme les images de réponses, elle remplace l'émoji (TV, tablette du dessinateur) ; « ✕ » la retire.
 */
function contentPhoto(type, item, key, images) {
  const name = type === "quisuis" ? item.answer : item.word;
  const slot = contentSlot(key);
  const id = images[slot];
  const thumb = h("img", { class: "choice-thumb", alt: `Image de ${name}`, hidden: !id });
  if (id) {
    if (imageCache[id]) thumb.src = imageCache[id];
    else get(ref(db, `library/images/${id}`)).then((snap) => {
      if (typeof snap.val() === "string") { imageCache[id] = snap.val(); thumb.src = snap.val(); }
    }).catch(() => {});
  }
  const save = (next, message) => {
    const st = builtinState(type);
    saveBuiltin(type, { ...st, images: next }, message);
  };
  const file = h("input", {
    type: "file", accept: "image/*", hidden: true,
    onchange: async (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      try {
        const newId = await storeChoiceImage(f);
        save({ ...builtinState(type).images, [slot]: newId }, `Image de « ${name} » enregistrée.`);
      } catch (err) {
        console.error(err);
        status("builtin-status", "Image refusée : essayez une autre image (JPEG ou PNG).");
      }
    },
  });
  return h("span", { class: "choice-photo" }, thumb,
    id ? h("button", {
      type: "button", class: "icon", title: "Retirer l'image", text: "✕",
      onclick: () => { const { [slot]: _, ...rest } = builtinState(type).images; save(rest, `Image de « ${name} » retirée.`); },
    }) : null,
    h("button", { type: "button", class: "icon", title: type === "quisuis" ? "Choisir une image pour ce personnage" : "Choisir une photo pour ce mot", text: "📷", onclick: () => file.click() }),
    file);
}

/**
 * Qui suis-je ? : modifier un de ses personnages (cedric, 25/10 : réponse, émoji, indices, après un import comme à la
 * main). Une nouvelle réponse garde sa place dans le jeu (retiré ou non) et son image.
 */
async function modifierPersonnage(item) {
  const type = "quisuis";
  const game = CONTENT_GAMES[type];
  const champ = (label, valeur, max) => h("label", {}, label, h("input", { value: valeur ?? "", maxlength: max }));
  const indices = [0, 1, 2, 3].map((k) => champ(`Indice ${k + 1}${k === 0 ? " (le plus difficile)" : k === 3 ? " (le plus facile)" : ""}`, item.clues[k], 120));
  const formulaire = h("div", { class: "form personnage-edit" },
    champ("Réponse", item.answer, 60), champ("Émoji (facultatif)", item.emoji, 16), champ("Série (facultatif)", item.serie, 30), ...indices);
  const lire = (l) => l.querySelector("input").value.trim();
  for (;;) {
    if (!(await apercu(`Modifier « ${item.answer} »`, formulaire, { ok: "Enregistrer" }))) return;
    const [reponse, emoji, serie] = [...formulaire.children].slice(0, 3).map(lire);
    const neuf = game.clean({ answer: reponse, emoji: cleanEmoji(emoji) || "", serie, clues: indices.map(lire).filter(Boolean), ...(item.imageId ? { imageId: item.imageId } : {}), famille: item.famille, niveau: item.niveau });
    const { off, extra, images } = builtinState(type);
    const ancienne = game.key(item);
    if (!neuf) { await avertir("Il faut la réponse et au moins 2 indices."); continue; }
    const cle = game.key(neuf);
    if (cle !== ancienne && [...game.catalog, ...extra].some((x) => game.key(x) === cle)) { await avertir(`« ${neuf.answer} » existe déjà dans le jeu.`); continue; }
    // Nouvelle réponse : la case « retiré du jeu » et l'image suivent le personnage.
    const slots = cle === ancienne ? images : Object.fromEntries(Object.entries(images).map(([slot, id]) => [slot === contentSlot(ancienne) ? contentSlot(cle) : slot, id]));
    return saveBuiltin(type, {
      off: off.map((k) => (k === ancienne ? cle : k)), extra: extra.map((x) => (game.key(x) === ancienne ? neuf : x)), images: slots,
    }, `« ${game.label(neuf)} » est modifié.`);
  }
}

/** Formulaire d'ajout propre à chaque jeu. */
function renderBuiltinForm() {
  const type = builtinType;
  const form = $("builtin-add");
  const field = (label, id, props = {}) => h("label", { class: props.wide ? "wide" : "" }, label, h(props.area ? "textarea" : "input", { id, maxlength: props.max ?? 60, rows: props.rows, placeholder: props.placeholder ?? "" }));
  const fields = type === "chante" ? [field("Nouveau mot", "bi-word", { max: 40, placeholder: "arc-en-ciel" })]
    : type === "pictionary" ? [
      field("Mot à dessiner", "bi-word", { max: 40, placeholder: "Toboggan" }), field("Émoji (facultatif)", "bi-emoji", { max: 16, placeholder: "🛝" }),
      // Série : une existante (liste) ou une nouvelle ; vide = « Mes mots ».
      h("label", {}, "Série (facultatif)", h("input", { id: "bi-series", maxlength: 30, list: "bi-series-list", placeholder: PICTO_OWN_SERIES }),
        h("datalist", { id: "bi-series-list" }, ...pictoSeriesList([...CONTENT_GAMES.pictionary.catalog, ...builtinState(type).extra]).map((name) => h("option", { value: name })))),
    ]
    : type === "quisuis" ? [
      field("Réponse", "bi-answer", { placeholder: "Le kangourou" }), field("Émoji (facultatif)", "bi-emoji", { max: 16, placeholder: "🦘" }),
      // Sa série (cedric, 24/10) : une existante (liste) ou une nouvelle ; vide = « Mes personnages ».
      h("label", {}, "Série (facultatif)", h("input", { id: "bi-serie", maxlength: 30, list: "bi-serie-list", placeholder: "Disney" }),
        h("datalist", { id: "bi-serie-list" }, ...nomsDesSeries(builtinState(type).extra).map((nom) => h("option", { value: nom })))),
      ...[1, 2, 3, 4].map((n) => field(`Indice ${n}${n === 1 ? " (le plus difficile)" : n === 4 ? " (le plus facile)" : ""}`, `bi-clue${n}`, { wide: true, max: 120 })),
      // Ou une série entière d'un coup : le ZIP du pack (cedric, 25/10), le même bouton que dans la Bibliothèque.
      h("div", { class: "wide row" },
        h("label", { class: "btn secondary file-btn" }, "📦 Importer un pack ZIP",
          h("input", {
            id: "bi-zip", type: "file", accept: ".zip,application/zip,application/x-zip-compressed", hidden: true,
            onchange: (e) => { const [zip] = e.target.files ?? []; e.target.value = ""; importerPackZip(zip, "builtin-status"); },
          })),
        h("span", { class: "hint small", text: "Le ZIP d'une série de personnages, sans le décompresser : un aperçu s'affiche avant d'enregistrer." })),
    ]
    : [
      field("Nom de la famille d'objets", "bi-theme", { placeholder: "Les jouets" }),
      field("Objets : un par ligne, le mot puis son émoji (5 à 12)", "bi-objects", { wide: true, area: true, rows: 6, max: 1200, placeholder: "Ours en peluche 🧸\nBallon ⚽\nDé 🎲" }),
      // Ou ses propres photos : un objet par photo, le mot tiré du nom du fichier (« ours-en-peluche.jpg »).
      h("div", { class: "wide row" },
        h("label", { class: "btn secondary file-btn" }, "📷 Photos des objets…",
          h("input", {
            id: "bi-photos", type: "file", accept: "image/*", multiple: true, hidden: true,
            onchange: (e) => { const n = e.target.files?.length ?? 0; $("bi-photos-count").textContent = n ? `${plural(n, "photo choisie", "photos choisies")} : un objet par photo, le mot vient du nom du fichier.` : ""; },
          })),
        h("span", { id: "bi-photos-count", class: "hint small" })),
    ];
  form.replaceChildren(h("p", { class: "label wide", text: `Ajouter ${type === "chante" || type === "pictionary" ? "un mot" : type === "quisuis" ? "un personnage" : "une famille d'objets"}` }),
    ...fields, h("div", { class: "wide" }, h("button", { class: "btn", type: "submit", text: "Ajouter" })));
}

$("builtin-add").onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  const type = builtinType;
  const game = CONTENT_GAMES[type];
  const val = (id) => $(id)?.value.trim() ?? "";
  // Qui a disparu ? : les photos choisies deviennent des objets (rangées d'abord dans la bibliothèque).
  const photos = [];
  for (const f of type === "disparu" ? [...($("bi-photos")?.files ?? [])] : []) {
    status("builtin-status", `Photo ${photos.length + 1}…`, true);
    try { photos.push({ word: wordFromImage(f.name) || `Objet ${photos.length + 1}`, imageId: await storeChoiceImage(f) }); } catch (err) { console.error(err); }
  }
  const raw = type === "chante" ? { word: val("bi-word") }
    : type === "pictionary" ? { word: val("bi-word"), image: val("bi-emoji"), series: val("bi-series") }
    : type === "quisuis" ? { answer: val("bi-answer"), emoji: val("bi-emoji"), serie: val("bi-serie"), clues: [1, 2, 3, 4].map((n) => val(`bi-clue${n}`)).filter(Boolean) }
    : { theme: val("bi-theme"), objects: [...val("bi-objects").split("\n").map((line) => {
      const m = line.trim().match(/^(.*\S)\s+(\S+)$/u);
      return m ? { word: m[1], image: m[2] } : null;
    }).filter(Boolean), ...photos] };
  const item = game.clean(raw);
  if (!item) {
    return status("builtin-status", type === "chante" || type === "pictionary" ? "Écrivez le mot à ajouter."
      : type === "quisuis" ? "Il faut la réponse et au moins 2 indices."
      : "Il faut un nom et au moins 5 objets, chacun avec son émoji (« Poupée 🪆 ») ou sa photo.");
  }
  const { off, extra } = builtinState(type);
  const key = game.key(item);
  if ([...game.catalog, ...extra].some((x) => game.key(x) === key)) return status("builtin-status", `« ${game.label(item)} » existe déjà.`);
  await saveBuiltin(type, { off, extra: [...extra, item] }, `« ${game.label(item)} » est ajouté ${item.serie ? `à la série « ${item.serie} »` : "au jeu"}.`);
  // La série reste choisie, pour le personnage suivant.
  const serie = val("bi-serie");
  form.reset();
  if ($("bi-serie")) $("bi-serie").value = serie;
  if ($("bi-photos-count")) $("bi-photos-count").textContent = "";
};

// ---------- Page d'un jeu : ses manches ----------

/** Jeu dont la page est ouverte (ses manches, ses collections). */
let gameType = null;
/** Manche en cours d'édition : { id, type, round }. */
let mancheEdit = null;

/** Écran des collections d'un jeu (onglet voisin de ses manches), ou null pour un jeu sans contenu. */
const COLLECTION_SCREEN = {
  quiz: () => showQuizzes("classique"), illustre: () => showQuizzes("photo"), express: () => showQuizzes("classique"),
  zoom: () => showQuizzes("images"), flou: () => showQuizzes("images"),
  mimes: () => show("mimes"), blind: () => show("music"), musical: () => show("music"), statues: () => openStatuesSongs(),
  chante: () => openBuiltin("chante"), quisuis: () => openBuiltin("quisuis"), disparu: () => openBuiltin("disparu"), pictionary: () => openBuiltin("pictionary"),
};

/**
 * « de Quiz », « du Gonfleur fou », « des Coffres mystères » : l'article du nom du jeu se contracte. Un nom qui est une
 * phrase (« Ça va exploser ! », « Qui suis-je ? ») reste entre guillemets.
 */
const deJeu = (nom) => (/[!?]$/.test(nom) ? `de « ${nom} »` : nom.startsWith("Le ") ? `du ${nom.slice(3)}`
  : nom.startsWith("La ") ? `de la ${nom.slice(3)}` : nom.startsWith("Les ") ? `des ${nom.slice(4)}` : `de ${nom}`);

/** Les deux onglets d'un jeu : Manches, Collections. [active] : « manches » ou « collections ». */
function gameTabs(type, active) {
  const tab = (key, text, fn) => h("button", { type: "button", class: `chip${active === key ? " active" : ""}`, "data-tab": key, "aria-pressed": active === key ? "true" : "false", text, onclick: fn });
  return [
    tab("manches", `Manches ${deJeu(ROUND_TYPES[type])}`, () => openGame(type)),
    COLLECTION_SCREEN[type] ? tab("collections", `Collections (${COLLECTION_UNIT[type][1]})`, () => { gameType = type; COLLECTION_SCREEN[type](); }) : null,
  ].filter(Boolean);
}

/** Onglets en haut des écrans de collections, quand on y arrive depuis la page d'un jeu. */
function paintCollectionTabs(screen) {
  document.querySelectorAll(`#screen-${screen} [data-tabs]`).forEach((box) => {
    const ok = gameType && COLLECTION_SCREEN[gameType];
    box.hidden = !ok;
    box.replaceChildren(...(ok ? gameTabs(gameType, "collections") : []));
  });
}

function openGame(type) {
  if (type !== gameType) $("manche-search").value = "";
  gameType = type;
  show("game");
  renderGame();
}

function renderGame() {
  const type = gameType;
  if (!type) return;
  const g = GAME_GROUPS.flatMap((x) => x.games).find((x) => x.type === type) ?? { type };
  $("game-title").textContent = ROUND_TYPES[type];
  $("game-h1").textContent = `${g.icon ?? ""} ${ROUND_TYPES[type]}`.trim();
  $("game-rule").textContent = gameInfo(g).rule;
  $("game-tabs").replaceChildren(...gameTabs(type, "manches"));
  // Aperçu de l'écran d'ouverture du jeu sur la TV (vidéo en boucle, l'image en attendant).
  const apercu = $("game-apercu");
  if (apercu.dataset.jeu !== type) {
    apercu.dataset.jeu = type;
    apercu.poster = `apercus-jeux/${type}.webp`;
    apercu.src = `apercus-jeux/${type}.mp4`;
    apercu.play?.()?.catch?.(() => {});
  }
  // Les manches se composent dans les prestations (cedric, 21/10) : ici, celles qui y ont été faites, à réutiliser.
  $("game-manche-hint").textContent = SANS_CONTENU.includes(type)
    ? "Rien à préparer : ajoutez ce jeu à une prestation avec « ＋ Ajouter un jeu »."
    : "Les manches se composent dans une prestation, avec « ＋ Ajouter un jeu ». Chacune est gardée ici toute seule, pour la reprendre dans une autre prestation ; épinglez celles qui marchent bien.";
  // Recherche : chaque mot tapé dans le nom ou le contenu de la manche ; les noms qui commencent par elle d'abord.
  const query = $("manche-search").value.trim();
  const lib = { mimes, playlists, quizzes };
  const trouve = (l) => parPertinence(l.filter(([, m]) => contientTout([m.title, mancheSummary(m.round, lib), m.round?.note], query)), query, ([, m]) => m.title, ([, m]) => [mancheSummary(m.round, lib), m.round?.note]);
  const groupes = mancheGroups(manches, type, quizzes);
  const [pinned, active, archived] = [trouve(groupes.pinned), trouve(groupes.active), trouve(groupes.archived)];
  $("manches-pinned-box").hidden = !pinned.length;
  $("manches-pinned").replaceChildren(...pinned.map(([id, m]) => mancheCard(id, m)));
  $("manches-list").replaceChildren(...(active.length ? active.map(([id, m]) => mancheCard(id, m))
    : [h("p", { class: "hint", text: query ? "Aucune de vos manches ne correspond : voir aussi plus bas." : pinned.length ? "Les autres manches s'afficheront ici."
      : "Aucune manche pour l'instant : elles arrivent ici quand vous composez une prestation." })]));
  $("manches-archived-count").textContent = archived.length;
  $("manches-archived").replaceChildren(...archived.map(([id, m]) => mancheCard(id, m)));
  // Manches déjà placées dans les prestations : on peut les garder comme manches.
  const fromShows = Object.entries(shows).filter(([, s]) => s)
    .sort(([, a], [, b]) => (b.date ?? "").localeCompare(a.date ?? ""))
    .flatMap(([sid, s]) => foldLegacyFinale(s.rounds).rounds.map((r) => jeuDeLaManche(r, quizzes)).filter((r) => (r.type ?? "quiz") === type && roundFilled(r)).map((r) => [sid, s, r]))
    .filter(([, s, r]) => contientTout([showTitle(s), s.date ? dateLabel(s.date) : "", r.title, mancheSummary(r, lib)], query));
  // Les résultats rangés dans les archives ou les prestations s'ouvrent tout seuls.
  if (query) {
    $("manches-archived-box").open = archived.length > 0;
    $("manches-shows-box").open = fromShows.length > 0;
  }
  const n = pinned.length + active.length + archived.length + fromShows.length;
  $("manche-search-count").textContent = query ? plural(n, "manche trouvée", "manches trouvées") : "";
  $("manches-shows-count").textContent = fromShows.length;
  // Historique (cedric, 21/10) : chaque manche jouée dans une prestation, la plus récente d'abord ; gardée ou à garder.
  $("manches-shows").replaceChildren(...fromShows.map(([sid, s, r]) => {
    const gardee = r.mancheId ? manches[r.mancheId] : null;
    return h("div", { class: "item manche-from-show" },
      h("b", { text: showTitle(s) }),
      h("span", { text: [s.date ? dateLabel(s.date) : "", mancheSummary(r, lib)].filter(Boolean).join(" · ") }),
      gardee ? h("span", { class: "small hint", text: `Gardée : « ${gardee.title} »` })
        : SANS_CONTENU.includes(type) ? null
          : h("div", { class: "row" }, h("button", {
            class: "btn secondary", text: "Garder comme manche",
            onclick: async () => {
              const id = await saveManche(null, { type, title: `${ROUND_TYPES[type]} · ${showTitle(s)}`.slice(0, 60), round: cleanRound({ ...r, mancheId: null }, playlists), showId: sid });
              if (id) status("game-status", "Manche ajoutée à vos manches.", true);
            },
          })));
  }));
}

$("manche-search").addEventListener("input", () => renderGame());

/** Carte d'une manche : ce qu'elle contient et ses actions. */
function mancheCard(id, m) {
  const path = `library/manches/${id}`;
  const flag = (field, on, message) => saveManche(id, { ...m, [field]: on || null }).then((ok) => ok && status("game-status", message, true));
  return h("div", { class: `item manche-card${m.pinned ? " pinned" : ""}${copieRecente(id)}`, "data-manche": id },
    m.pinned ? h("span", { class: "pill pin", text: "⭐ Épinglée" }) : m.origin === "direct" ? h("span", { class: "pill", text: "Jouée en direct" }) : null,
    h("b", { text: m.title }),
    h("span", { text: mancheSummary(m.round, { mimes, playlists, quizzes }) }),
    m.round?.note ? h("span", { class: "reprise-note", text: `📝 ${m.round.note}` }) : null,
    h("div", { class: "row" },
      h("button", { class: "btn secondary", text: "Éditer", onclick: () => editManche(id) }),
      h("button", { class: "btn secondary", text: "Renommer", onclick: () => rename(path, m.title, "de la manche") }),
      h("button", { class: "btn secondary", text: "Dupliquer", onclick: () => duplicateManche(m) }),
      m.archived ? null : h("button", { class: "btn secondary", text: m.pinned ? "☆ Désépingler" : "⭐ Épingler", onclick: () => flag("pinned", !m.pinned, m.pinned ? "Manche désépinglée." : "Manche épinglée : elle est proposée en premier.") }),
      h("button", { class: "btn secondary", text: m.archived ? "Désarchiver" : "Archiver", onclick: () => flag("archived", !m.archived, m.archived ? "Manche remise dans vos manches." : "Manche archivée.") }),
      h("button", { class: "btn danger", text: "Supprimer", onclick: () => deleteManche(id, m) })));
}

/** Enregistre une manche (nouvelle si [id] est nul) ; renvoie son identifiant, ou null si c'est refusé. */
async function saveManche(id, m) {
  const key = id ?? push(ref(db, "library/manches")).key;
  const prev = manches[key] ?? {};
  try {
    await set(ref(db, `library/manches/${key}`), {
      type: m.type, title: `${m.title}`.trim().slice(0, 120) || defaultMancheTitle(m.type), round: cleanRound({ ...m.round, mancheId: null, title: null }, playlists),
      origin: m.origin ?? prev.origin ?? "admin", ...(m.pinned ? { pinned: true } : {}), ...(m.archived ? { archived: true } : {}),
      ...(m.showId ? { showId: m.showId } : {}), createdAt: prev.createdAt ?? Date.now(), updatedAt: serverTimestamp(),
    });
    return key;
  } catch (err) {
    console.error(err);
    await avertir("Enregistrement de la manche refusé : vérifiez Internet ou reconnectez-vous.");
    return null;
  }
}

/** Copie d'une manche (même contenu, mêmes réglages), parmi les manches du jeu, ni épinglée ni archivée. */
async function duplicateManche(m) {
  const id = await saveManche(null, { type: m.type, title: titreCopie(m.title), round: JSON.parse(JSON.stringify(m.round)) });
  if (!id) return;
  signalerCopie(id);
  refreshLists();
  status("game-status", `« ${titreCopie(m.title)} » est ajoutée à vos manches.`, true);
}

async function deleteManche(id, m) {
  if (!(await confirmer(`Supprimer la manche « ${m.title} » ? Les prestations qui l'ont chargée gardent leur copie.`, { ok: "Supprimer", danger: true }))) return;
  await set(ref(db, `library/manches/${id}`), null);
  status("game-status", "Manche supprimée.", true);
}

/** Âge et équipes du tirage d'une manche seule (page du jeu). */
const mancheCtx = {
  refresh: () => renderMancheFields(),
  summary: () => histManche.noter(),
  profile: () => profileForAge($("manche-age").value === "" ? null : Number($("manche-age").value)),
  teams: () => Number($("manche-teams").value) || 4,
};

/** Ouvre une manche ; sans identifiant, une nouvelle ([fresh] : son contenu de départ, sinon vide). */
function editManche(id, fresh = null) {
  const saved = id ? manches[id] : fresh ?? { type: gameType, title: "", round: { type: gameType } };
  // Une ancienne manche « Quiz » de quiz illustrés s'ouvre (et s'enregistre) en Quiz illustré.
  const round = versSeriesQuiz(jeuDeLaManche(saved.round ?? { type: saved.type }, quizzes), quizzes);
  const m = { ...saved, type: round.type ?? saved.type, round };
  gameType = m.type;
  mancheEdit = { id, type: m.type, round: JSON.parse(JSON.stringify(m.round)) };
  if (m.type === "mimes" && !id && !fresh?.round?.perTeam && !mimeCards(mancheEdit.round.cards).length) {
    mancheEdit.round.perTeam = MIME_PER_TEAM_DEFAULT;
    mancheEdit.round.random = true;
  }
  $("manche-crumb").textContent = ROUND_TYPES[m.type];
  $("manche-edit-title").textContent = id ? m.title : "Nouvelle manche";
  $("manche-title").value = m.title ?? "";
  $("manche-title").placeholder = defaultMancheTitle(m.type);
  $("manche-delete").hidden = !id;
  status("manche-status", "");
  show("manche-edit");
  paintRandomBox();
  renderMancheFields();
  histManche.depart();
}
$("manche-crumb").onclick = () => openGame(mancheEdit?.type ?? gameType);

const histManche = historique({
  ecran: $("screen-manche-edit"),
  precedent: pagePrecedente,
  capturer: () => (mancheEdit ? { title: $("manche-title").value, round: mancheEdit.round } : null),
  restaurer: (e) => { if (!mancheEdit || !e) return; $("manche-title").value = e.title; mancheEdit.round = e.round; renderMancheFields(); },
});

function renderMancheFields() {
  if (!mancheEdit) return;
  roundCtx = mancheCtx;
  $("manche-fields").replaceChildren(...roundFields(mancheEdit.round).filter(Boolean));
  histManche.noter();
}

/** Le tirage au hasard : catégories de la collection, nombre (cartes par équipe × équipes pour les mimes). */
function paintRandomBox() {
  const type = mancheEdit.type;
  const random = RANDOM_TYPES.includes(type);
  $("manche-random-box").hidden = !random;
  if (!random) return;
  $("manche-count-box").hidden = type === "mimes";
  $("manche-teams-box").hidden = type !== "mimes";
  $("manche-count").value = RANDOM_COUNT[type] ?? BUILTIN_GAMES[type]?.count ?? 6;
  // Qui a disparu ? : le choix émojis ou photos se fait dans « Contenu et réglages », pas de catégories en plus.
  const groups = type === "disparu" ? [] : collectionGroups(collectionItems(type, { mimes, contents, quizzes, playlists }));
  $("manche-groups").replaceChildren(...groups.map((g) => h("button", {
    type: "button", class: "chip", "data-group": g, "aria-pressed": "false", text: g,
    onclick: (e) => { const on = e.target.getAttribute("aria-pressed") !== "true"; e.target.setAttribute("aria-pressed", on ? "true" : "false"); e.target.classList.toggle("active", on); },
  })));
  $("manche-groups").previousElementSibling.hidden = !groups.length;
}

function drawManche() {
  if (!mancheEdit) return;
  const type = mancheEdit.type;
  const groups = [...document.querySelectorAll("#manche-groups [aria-pressed=true]")].map((b) => b.dataset.group);
  const { round, exhausted, count } = randomRound(type, { mimes, contents, quizzes, playlists }, {
    profile: mancheCtx.profile(), level: $("manche-level").value, groups,
    ...(type === "mimes" ? { perTeam: mancheEdit.round.perTeam || MIME_PER_TEAM_DEFAULT, teams: mancheCtx.teams() } : { count: Number($("manche-count").value) || undefined }),
    base: mancheEdit.round, playlists,
  });
  if (!round) return status("manche-status", "Rien à tirer : la collection est vide pour ces catégories et cette difficulté.");
  mancheEdit.round = { ...round, ...(type === "mimes" ? { random: true } : {}) };
  if (!$("manche-title").value.trim()) $("manche-title").value = groups.length === 1 ? `${ROUND_TYPES[type]} · ${groups[0]}` : defaultMancheTitle(type);
  renderMancheFields();
  status("manche-status", exhausted ? `Seulement ${count} trouvés : élargissez les catégories ou la difficulté.` : `Tirage : ${count} ${COLLECTION_UNIT[type][count > 1 ? 1 : 0]} au hasard. Retirez ou ajoutez-en, puis enregistrez.`, !exhausted);
}
$("manche-draw").onclick = drawManche;

$("manche-save").onclick = async () => {
  if (!mancheEdit) return;
  const r = mancheEdit.round;
  if (!roundFilled(r) || (r.type === "mimes" && !r.deckId && !mimeCards(r.cards).length)) {
    return status("manche-status", r.type === "mimes" ? "Choisissez des cartes, ou « Tirer au hasard »." : "La manche est vide : choisissez son contenu.");
  }
  const title = $("manche-title").value.trim() || defaultMancheTitle(mancheEdit.type);
  const prev = mancheEdit.id ? manches[mancheEdit.id] ?? {} : {};
  const id = await saveManche(mancheEdit.id, { ...prev, type: mancheEdit.type, title, round: r });
  if (!id) return;
  mancheEdit.id = id;
  $("manche-title").value = title;
  $("manche-edit-title").textContent = title;
  $("manche-delete").hidden = false;
  histManche.enregistre();
  status("manche-status", "Manche enregistrée : chargez-la dans une prestation (« Charger une manche… »).", true);
};
$("manche-delete").onclick = async () => {
  if (!mancheEdit?.id) return;
  const m = manches[mancheEdit.id];
  if (!m || !(await confirmer(`Supprimer la manche « ${m.title} » ?`, { ok: "Supprimer", danger: true }))) return;
  await set(ref(db, `library/manches/${mancheEdit.id}`), null);
  histManche.abandonner();
  openGame(mancheEdit.type);
};

// ---------- Mode « carte » : la carte d'un jeu pour la régie téléphone (cedric, 30/10) ----------

/** Le jeu réglé dans la carte, le programme de la partie (pour « jamais deux fois ») et ses réglages. */
const carte = { round: null, programme: [], profil: "MOYENS", equipes: EQUIPES_PAR_DEFAUT, titre: null };

const carteCtx = {
  prestation: true,
  refresh: () => peindreCarte(),
  summary: () => envoyerCarte(),
  profile: () => carte.profil,
  teams: () => carte.equipes,
  // « Jamais deux fois » : ce que montrent les autres jeux du programme (concept → nom du jeu) ; le jeu modifié ne compte pas.
  elsewhere: () => {
    const vus = new Map();
    for (const q of carte.programme) {
      if (!q || (carte.titre && q.round === carte.titre)) continue;
      for (const c of questionConcepts(q)) if (!vus.has(c)) vus.set(c, q.round ?? "un autre jeu");
    }
    return vus;
  },
  // Chansons que jouent déjà les autres jeux du programme (le 🎲 du Blind test les prend en dernier).
  chansons: () => {
    const out = new Map();
    for (const q of carte.programme) {
      if (!q || (carte.titre && q.round === carte.titre) || !["blind", "musical", "statues"].includes(q.kind)) continue;
      const noter = (k) => { if (k && !out.has(k)) out.set(k, q.round ?? "un autre jeu"); };
      [q.audioId, ...(Array.isArray(q.audioIds) ? q.audioIds : [])].forEach(noter);
      (Array.isArray(q.songs) ? q.songs : []).forEach((x) => { noter(x?.songId); noter(x?.audioId); });
    }
    return out;
  },
};

/**
 * Ouvre la carte : lit la bibliothèque (preuve de la régie du téléphone, lecture seule) et le programme de la partie,
 * puis attend du téléphone le jeu à régler (nouveau, ou un jeu à venir à modifier).
 */
async function entrerCarte() {
  document.body.classList.add("mode-carte");
  $("screen-login").hidden = true;
  $("screen-carte").hidden = false;
  const params = new URLSearchParams(location.search);
  const code = params.get("g");
  const lire = (path) => get(ref(db, path)).then((x) => x.val(), (e) => { console.error(path, e); return null; });
  const [q, sh, mi, pl, co, so, ma, me, ca, conducteur] = await Promise.all([
    "library/quizzes", "library/shows", "library/mimes", "library/playlists", "library/contents", "library/songs",
    "library/manches", "library/medias", "library/cadrages", /^[A-Z0-9]{5}$/.test(code ?? "") ? `games/${code}/conducteur` : null,
  ].map((path) => (path ? lire(path) : null)));
  quizzes = q ?? {};
  shows = sh ?? {};
  mimes = mi ?? {};
  playlists = pl ?? {};
  contents = co ?? {};
  songs = so ?? {};
  manches = ma ?? {};
  medias = me ?? {};
  cadrages = ca ?? {};
  carte.programme = Array.isArray(conducteur?.questions) ? conducteur.questions : Object.values(conducteur?.questions ?? {});
  carte.profil = PROFILES[params.get("profil")] ? params.get("profil") : "MOYENS";
  carte.equipes = Math.max(1, Math.min(8, Number(params.get("equipes")) || EQUIPES_PAR_DEFAUT));
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || e.source !== parent) return;
    const m = e.data?.lmpCarte;
    if (m?.ouvrir) {
      carte.titre = m.titre ?? null;
      const depart = m.round && typeof m.round === "object" ? JSON.parse(JSON.stringify(m.round)) : { type: MODE_CARTE };
      carte.round = versSeriesMots(versSeriesBlind(versSeriesQuiz({ ...depart, type: depart.type ?? MODE_CARTE }, quizzes)));
      appliquerCadrages([carte.round]);
      peindreCarte();
    } else if (m === "donne") envoyerCarte();
  });
  parent.postMessage({ lmpCarte: { prete: MODE_CARTE } }, location.origin);
}

/** Dessine la carte, comme un jeu déplié de la prestation : en-tête, réglages, reprise, alertes. */
function peindreCarte() {
  const r = carte.round;
  if (!r) return;
  roundCtx = carteCtx;
  const type = r.type ?? "quiz";
  const sansManches = estEnSeries(type) || type === "blind" || type === "musical" || estJeuDeMots(type);
  const champs = roundFields(r).filter(Boolean);
  const compteur = champs.find((x) => x?.classList?.contains("quiz-compteur")) ?? null;
  const enTete = compteur ? champs.filter((x) => x?.classList?.contains("quiz-en-tete")) : [];
  const corps = h("div", { class: "round-body" }, ...champs.filter((x) => x !== compteur && !enTete.includes(x)));
  const reprise = SANS_CONTENU.includes(type) || sansManches || type === "mimes" || type === "pictionary" ? null
    : reprendreManche(r, (next) => { carte.round = next; peindreCarte(); });
  $("carte-jeu").replaceChildren(h("div", { class: "jeu-bloc", "data-jeu": type },
    h("div", { class: "jeu-tete" }, h("span", { class: "jeu-nom", text: `${iconeJeu(type)} ${ROUND_TYPES[type]}`.trim() })),
    h("div", { class: "round show-round" },
      compteur ? h("div", { class: "round-head" }, compteur, ...enTete) : null,
      corps, reprise, alerteManche(r))));
  envoyerCarte();
}

/** Le jeu tel qu'il est réglé, envoyé au téléphone (à chaque changement, et quand il le demande). */
function envoyerCarte() {
  const r = carte.round;
  if (!r) return;
  const round = JSON.parse(JSON.stringify(cleanRound(r, playlists)));
  parent.postMessage({ lmpCarte: { round, plein: roundFilled(r) || SANS_CONTENU.includes(r.type) } }, location.origin);
}
