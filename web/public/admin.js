import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth, signInAnonymously, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, push, onValue, serverTimestamp, connectDatabaseEmulator, query, orderByKey, limitToLast,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { passwordHash, newSalt, cleanPassword, passwordCandidates, MIN_PASSWORD_LENGTH } from "./secret.js";
import {
  TEST_ID, TEST_QUIZ, TEST_SHOW, FULL_ID, FULL_KEYS, FULL_QUIZZES, FULL_MIMES, FULL_SHOW, FULL_PHOTOS, photoQuiz, drawPhoto,
  FULL_TUNES, FULL_TUNE_SEC, FULL_NEW_ROUNDS, tunePlaylist, FULL_CHOICE_PHOTOS, imageQuiz, OLD_TEST_TITLES,
} from "./test-show.js";
import { writeProof, isAdmin } from "./proof.js";
import { parseQuiz, checkQuestions, geminiPrompt, chatgptUrl, imageKey, wordFromImage, photoQuestions, LETTERS } from "./importer.js";
import { PROFILES, profileForAge, defaultDuration } from "./profiles.js";
import {
  buildSnapshot, dureeEstimee, playable, expressQuestions, zoomQuestions, showTitle, titreAuto, ROUND_TYPES, BUILTIN_GAMES, readiness, daysUntil, duplicateShow, isoDay, ETATS, etatPrestation,
  roundFilled, MIME_TURN, MUSIC_GAMES, playableTracks, BLIND_SEC, STATUES_SECONDS, STATUES_SEC, PICTO_SECONDS, PICTO_SEC, PICTO_POINTS, PICTO_RULE,
  blindScale, trackPoints, BLIND_REVEAL_SECONDS, QUIZ_GAMES, CONTENT_GAMES, activeItems, contentExtras, contentSlot, contentImages,
  pictoSeriesOf, pictoSeriesList, pictoRoundSeries, foldLegacyFinale, showMatches, isArchived, AUTO_ARCHIVE_DAYS, quizKind,
  roundQuizIds, roundPicks, roundTracks, mimeCards, mimeDraw, MIME_RANDOM, MAX_PICKS,
  isStatuesList, statuesSongs, statuesChoices, roundSongs, STATUES_EXTRACTS, STATUES_EXTRACT, MAX_STATUES_SONGS, builtinConcepts, isPhotoTheme, disparuGroup,
  illustreQuestions, quizQuestions, jeuDeLaManche, hasFinale, alerteEquipes, EQUIPES_PAR_DEFAUT, pourLeHasard, premierQuiz,
  launchStates, launchLabelPc, roundTirees, chiffresDuTirage, MAX_TIREES,
  roundSeriesQuiz, questionsDeLaSerie, questionsDesSeries, questionJouable, FACTEURS_FINALE, SUPER_FINALE_LAST, questionBougies,
  questionsDuQuiz, cleQuestion, placeDesBougies, CLE_BOUGIES,
} from "./show.js";
import { motDeLaBanque, PHOTOS_BANQUE, banqueItems, BANQUE, cheminPhotoBanque } from "./banque-photos.js";
import { shuffle } from "./mime-cards.js";
import {
  MANCHE_TYPES, COLLECTION_UNIT, RANDOM_TYPES, RANDOM_COUNT, MIME_PER_TEAM, MIME_PER_TEAM_DEFAULT, LEVELS, collectionItems, collectionGroups,
  filterItems, drawItems, randomRound, cleanRound, mancheGroups, mancheSummary, defaultMancheTitle, mimeCardsNeeded,
  itemConcepts, usedElsewhere, blocsDeJeu, versSeriesQuiz, fusionnerQuiz,
} from "./manches.js";
import { concepts, neufsSiPossible } from "./jamais-deux-fois.js";
import { PICTO_OWN_SERIES } from "./picto-cards.js";
import { EXTRACT_SECONDS, guessTrack, decodeFile, cutExtract, makeExtract, synthTune, encodeMp3, soundId } from "./audio.js";
import { REFRAIN_SEC, REFRAIN_KBPS, buzzOf, defaultRefrain, songList, songsRetirees, songMatches, trackFromSong, songUpdates, marquerEffacees } from "./sons.js";
import { lireLrc, refrainsDesParoles, debutDesParoles, parolesDuRefrain, associerParoles, nomSimple, ligneAuMoment, MAX_LRC } from "./paroles.js";
import { volumes, explosionDuVolume, refrainAuVolume } from "./volume.js";
import { etiquettesMp3 } from "./id3.js";
import { garderFichier, fichierGarde, oublierFichier } from "./sons-locaux.js";
import { MIME_CATALOG, MIME_THEMES } from "./mime-cards.js";
import { watchVersion, showUpdateBanner } from "./version.js";
import { compressImage, imageId, cleanEmoji, CHOICE_IMAGE } from "./illustration.js";
import { afficherMotsDePasse } from "./oeil.js";
import { historique, noterEcran, barresRetour, quitterEcran, ecranModifie } from "./retour.js";
import { confirmer, avertir, demanderTexte } from "./fenetre.js";
import { ouvrirCadrage } from "./cadrage.js";
import { FAMILLES_PETITS, BANQUE_MOTS, motBanque, cleMot, cataloguePetits, tirerPetits } from "./banque-petits.js";
import { parPertinence, contientTout } from "./recherche.js";
import {
  GROUPES_IMAGES, A_RANGER, POCHETTES, emojisBibliotheque, photosLibres, imagesUtilisees, mesImages, pochettesUtilisees, mesPochettes, nomPochette,
  correspond, categoriesDe, categoriesPerso, ficheImage, motsCles,
} from "./mediatheque.js";
import { DOSSIERS, classerPartie, bilan, effacements, passageAFaire, moDe, texteMo, texteGardees } from "./nettoyage.js";
import { GROUPES_QUESTIONS, questionsClassiquesPretes, questionsIllustreesPretes, mesQuestions, mesPacks, questionsDeTest, questionCorrespond, lirePacks, illustration, retirerQuestions, packsParTheme, estQuizDeTest } from "./questions.js";
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
const contexte = (ecran) => ({ showsEtat, gameType, quizFilter, builtinType, libTab, mediaGroupe, mediaCat, ouvert: EDITEURS[ecran]?.id() ?? null });

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
    quittee.ctx = { ...quittee.ctx, libTab, mediaGroupe, mediaCat, ouvert: EDITEURS[avant]?.id() ?? quittee.ctx.ouvert };
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

/** Rouvre une page de l'historique telle qu'on l'a laissée. */
function rouvrirPage({ ecran, ctx, defilement = 0, ancre = null }) {
  depuisHistorique = true;
  try {
    ({ showsEtat, gameType, quizFilter, builtinType, libTab, mediaGroupe, mediaCat } = ctx);
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

route();

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
  const r = readiness(s, quizzes, mimes, playlists, contents);
  const etat = etatPrestation(s);
  const { snapshot } = buildSnapshot(id, s, quizzes, mimes, Math.random, playlists, contents);
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
  editing = { id, rounds: reunies, themes: s.themes ?? null };
  $("show-edit-title").textContent = id ? showTitle(s) : "Nouvelle prestation";
  // Fil d'Ariane : la liste de son état (une nouvelle commence « À compléter »).
  showsEtat = id ? etatPrestation(s) : "acompleter";
  $("show-edit-crumb").textContent = LISTES[showsEtat].titre;
  $("show-child").value = s.childName ?? "";
  $("show-age").value = s.age ?? "";
  $("show-teams").value = s.teams ?? "";
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
  status("show-status-msg", s.copieDe && !s.childName ? "Copie : indiquez le prénom, l'âge et la date du nouvel anniversaire, puis enregistrez."
    : folded ? "L'ancienne manche « Super Finale » est devenue le réglage du quiz (ses dernières questions ×2). Enregistrez pour garder ce changement."
    : fusions ? "Les manches Quiz qui se suivaient n'en font plus qu'une (une seule Super Finale, à la fin). Enregistrez pour garder ce changement." : "", !!s.copieDe || !!folded || !!fusions);
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
const SHOW_FIELDS = ["show-child", "show-age", "show-teams", "show-date", "show-status", "show-title", "show-profile", "show-notes"];
const histPrestation = historique({
  ecran: $("screen-show-edit"),
  precedent: pagePrecedente,
  capturer: () => ({ rounds: editing?.rounds ?? [], champs: SHOW_FIELDS.map((id) => $(id).value) }),
  restaurer: (e) => {
    SHOW_FIELDS.forEach((id, k) => { $(id).value = e.champs[k]; });
    $("show-title").dataset.auto = titreAuto($("show-child").value);
    if (editing) editing.rounds = e.rounds;
    refreshRounds();
  },
});
// « Enregistrer » aussi en haut de la fiche (cedric, 21/10) : une retouche de dernière minute sans descendre tout en bas.
$("screen-show-edit").querySelector(".retour-barre.haut")
  .append(h("button", { id: "show-save-haut", class: "btn", type: "button", onclick: () => $("show-save").click(), text: "Enregistrer" }));

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
    teams: num($("show-teams").value),
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
    box.replaceChildren(...[
      h("span", { class: "small", text: n ? `${n} ${unit}${n > 1 ? "s" : ""} choisi${e}${n > 1 ? "s" : ""} : la manche joue exactement cette liste.` : empty }),
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
    class: "grow", "aria-label": k === 0 ? "Quiz de la manche" : `Quiz ${k + 1} de la manche`,
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

/**
 * Statues musicales : les chansons de la liste des statues, puis celles de toutes les playlists, à cocher pour la
 * manche ; jouées dans cet ordre. Aucune cochée : la musique de la fête, sur la TV. Une nouvelle manche part avec
 * les chansons de la liste des statues cochées.
 */
function songsPicker(r) {
  const songs = statuesChoices(playlists);
  if (!Array.isArray(r.songs)) r.songs = statuesSongs(playlists).map((t) => t.audioId).slice(0, MAX_STATUES_SONGS);
  const chosen = new Set(r.songs);
  const manage = h("button", { type: "button", class: "link", text: statuesSongs(playlists).length ? "Gérer les chansons des statues" : "Ajouter des chansons pour les statues", onclick: () => openStatuesSongs() });
  if (!songs.length) return h("p", { class: "hint small statues-songs" }, "Musique de la fête (aucune chanson dans vos playlists). ", manage);
  const count = roundSongs(r, playlists).length;
  const groups = [...new Set(songs.map((t) => t.list))];
  return h("div", { class: "statues-songs" },
    h("p", { class: "hint small", text: !count ? "Aucune chanson cochée : musique de la fête." : count === 1 ? "1 chanson cochée, jouée en boucle :" : `${count} chansons cochées, jouées l'une après l'autre (${MAX_STATUES_SONGS} au plus) :` }),
    ...groups.flatMap((list) => [
      h("p", { class: "statues-list", text: list }),
      ...songs.filter((t) => t.list === list).map((t) => h("label", { class: "inline statues-song" },
        h("input", {
          type: "checkbox", value: t.audioId, checked: chosen.has(t.audioId),
          onchange: (e) => {
            const keep = new Set(r.songs);
            if (e.target.checked) keep.add(t.audioId); else keep.delete(t.audioId);
            r.songs = songs.map((x) => x.audioId).filter((id) => keep.has(id)).slice(0, MAX_STATUES_SONGS);
            roundCtx.refresh();
          },
        }),
        t.artist?.trim() ? `${t.title} (${t.artist.trim()})` : t.title)),
    ]),
    manage);
}

/** Jeux que « ＋ Ajouter un jeu » propose, par famille, dans l'ordre des tuiles de l'Accueil. */
const jeuxProposes = () => GAME_GROUPS.map((g) => ({ title: g.title, games: g.games.filter((x) => ROUND_TYPES[x.type]) }));
// Le « ? » de la tuile du Quiz devient ❓ hors de sa tuile (comme l'écran d'ouverture de la TV).
const iconeJeu = (type) => (type === "quiz" ? "❓" : GAME_GROUPS.flatMap((g) => g.games).find((x) => x.type === type)?.icon ?? "");
const SANS_CONTENU = ["coffres", "patate", "gonfleur"];

/**
 * Prestation (cedric, 21/10) : on ajoute un JEU, puis ses manches. Un bloc = les manches qui se suivent du même jeu,
 * avec « ＋ Manche » ; chaque manche se remplit sur place (reprendre une manche gardée, tirer au hasard, choisir à la
 * main). Les manches restent enregistrées à la suite dans la prestation, comme avant (TV, régie et téléphone inchangés).
 */
function refreshRounds() {
  if (!editing) return;
  roundCtx = prestationCtx;
  const box = $("show-rounds");
  box.innerHTML = "";
  if (!editing.rounds.length) box.append(h("p", { class: "hint small", text: "Ajoutez un premier jeu avec « ＋ Ajouter un jeu »." }));
  // Un Quiz = une seule manche (cedric, 23/10) : en séries, et deux Quiz qui se touchent n'en font plus qu'un.
  const { rounds: reunies, fusions } = fusionnerQuiz(editing.rounds.map((r) => versSeriesQuiz(r, quizzes)));
  editing.rounds = reunies;
  if (fusions) annonce("Les Quiz qui se suivaient n'en font plus qu'un : leurs questions à la suite, une seule Super Finale à la fin.");
  const blocs = blocsDeJeu(editing.rounds);
  blocs.forEach((b, k) => {
    const [debut, fin] = [b.indices[0], b.indices[b.indices.length - 1] + 1];
    // Le bloc passe avant (ou après) le bloc voisin ; deux blocs du même jeu qui se touchent n'en font plus qu'un.
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
      if (remplies && !(await confirmer(`Retirer « ${ROUND_TYPES[b.type]} » et ${remplies > 1 ? `ses ${remplies} manches` : "sa manche"} de la prestation ?`, { ok: "Retirer", danger: true }))) return;
      editing.rounds.splice(debut, fin - debut);
      refreshRounds();
      // Confirmé dans la fenêtre, hors de l'écran : l'action est notée ici (Ctrl+Z, « Annuler les modifications »).
      noterEcran();
    };
    const ajouterManche = () => { editing.rounds.splice(fin, 0, { type: b.type }); refreshRounds(); };
    const n = b.indices.length;
    box.append(h("div", { class: "jeu-bloc", "data-jeu": b.type },
      h("div", { class: "jeu-tete" },
        h("span", { class: "jeu-nom", text: `${iconeJeu(b.type)} ${ROUND_TYPES[b.type]}`.trim() }),
        // Le Quiz est une seule manche (cedric, 23/10) : pas de « ＋ Manche », ses questions s'ajoutent dans la manche.
        b.type === "quiz" ? null : h("span", { class: "jeu-nb", text: n > 1 ? `${n} manches` : "1 manche" }),
        b.type === "quiz" ? null : h("button", { type: "button", class: "chip jeu-plus", text: "＋ Manche", title: `Ajouter une manche de ${ROUND_TYPES[b.type]}`, onclick: ajouterManche }),
        h("button", { type: "button", class: "icon", title: "Monter ce jeu", disabled: k === 0, onclick: () => deplacer(-1), text: "↑" }),
        h("button", { type: "button", class: "icon", title: "Descendre ce jeu", disabled: k === blocs.length - 1, onclick: () => deplacer(1), text: "↓" }),
        h("button", { type: "button", class: "icon", title: "Retirer ce jeu", onclick: retirerJeu, text: "✕" })),
      ...b.indices.map((i) => {
        const r = editing.rounds[i];
        const vide = !roundFilled(r);
        const champs = roundFields(r);
        // Le compteur du Quiz sur la ligne de son numéro (cedric, 23/10).
        const compteur = b.type === "quiz" ? champs.find((x) => x?.classList?.contains("quiz-compteur")) ?? null : null;
        const corps = h("div", { class: "round-body" }, ...champs.filter((x) => x !== compteur));
        // Créer d'abord (les champs ci-dessus), reprendre ensuite (cedric, 23/10). Pas pour le Quiz (cedric, 23/10) :
        // ses questions viennent du 🎲 et du quiz d'une prestation archivée (« Rappeler un de vos quiz »).
        const reprise = SANS_CONTENU.includes(b.type) || b.type === "quiz" ? null : reprendreManche(r, (next) => {
          editing.rounds[i] = next;
          refreshRounds();
        });
        return h("div", { class: "round show-round", "data-manche": i },
          h("div", { class: "round-head" },
            h("span", { class: "num", title: `Manche ${i + 1} de la prestation`, text: `${i + 1}` }),
            compteur ?? (SANS_CONTENU.includes(b.type) ? h("span", { class: "grow hint small", text: n > 1 ? `Partie ${b.indices.indexOf(i) + 1}` : "" })
              : h("span", { class: "grow hint small", text: vide && b.type !== "quiz" ? "Nouvelle manche : choisissez son contenu, ou reprenez une manche déjà faite (plus bas)." : "" })),
            n > 1 ? h("button", { type: "button", class: "icon", title: "Retirer cette manche", onclick: () => { editing.rounds.splice(i, 1); refreshRounds(); }, text: "✕" }) : null),
          corps,
          reprise,
          alerteManche(r));
      })));
  });
  refreshSummary();
}

/** Alerte rouge sous une manche dont le contenu ne suffit pas aux équipes prévues (cedric, 21/10). */
function alerteManche(r) {
  const texte = alerteEquipes(r, ctxTeams(), { mimes, contents, profile: roundCtx.profile?.() });
  return texte ? h("p", { class: "alerte-equipes", role: "alert", text: `⚠ ${texte}` }) : null;
}

/** « ＋ Ajouter un jeu » : les jeux en tuiles, par famille ; un clic ajoute le jeu (une manche) en fin de prestation. */
function ouvrirChoixJeu() {
  const box = $("jeu-choix");
  if (!box.hidden) { box.hidden = true; return; }
  box.replaceChildren(...jeuxProposes().map((g) => h("div", { class: "jeu-famille" },
    h("p", { class: "small", text: g.title }),
    h("div", { class: "jeu-tuiles" }, ...g.games.map((x) => h("button", {
      type: "button", class: "jeu-tuile", "data-jeu": x.type, text: `${iconeJeu(x.type)} ${ROUND_TYPES[x.type]}`,
      onclick: () => {
        box.hidden = true;
        // Un Quiz juste après un Quiz n'en ferait qu'un : on y retourne, ses questions s'ajoutent dans sa manche.
        if (x.type === "quiz" && (editing.rounds[editing.rounds.length - 1]?.type ?? "") === "quiz") {
          annonce("Le Quiz est déjà le dernier jeu : ajoutez-y vos questions (🎲, un ancien quiz, un quiz de votre bibliothèque).");
          $("show-rounds").lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          return;
        }
        editing.rounds.push({ type: x.type });
        refreshRounds();
        $("show-rounds").lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      },
    }))))));
  box.hidden = false;
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

/** Une question jouée (format du quiz) gardée dans une série : 4 réponses avec sa photo ou son émoji, ou Juste Chiffre. */
const versQuestionEnLigne = (q) => (q.kind === "number"
  ? { text: q.text, nombre: true, correct: q.correct }
  : { text: q.text, choices: [...(q.choices ?? [])], correct: q.correct,
    ...(q.banque ? { banque: q.banque } : /^[0-9a-f]{16}$/.test(q.imageId ?? "") ? { imageId: q.imageId }
      : typeof q.image === "string" && q.image && q.image.length <= 16 ? { emoji: q.image } : {}) });

/**
 * « Rappeler un de vos quiz » (cedric, 23/10) : les prestations archivées qui ont un Quiz, la plus récente d'abord, avec
 * toutes les questions de leur Quiz (dans l'ordre joué) et de quoi les retrouver (prénom, âge, date, notes).
 */
function quizArchives() {
  return prestationsRecentes().filter(([, s]) => etatPrestation(s) === "archivee").map(([sid, s]) => {
    const questions = (s.rounds ?? []).map((x) => (x ? versSeriesQuiz(jeuDeLaManche(x, quizzes), quizzes) : null))
      .filter((x) => x && (x.type ?? "quiz") === "quiz" && x.hasard !== true)
      .flatMap((x) => questionsDesSeries(x, quizzes)).map(versQuestionEnLigne).filter(questionJouable)
      // Sa question des bougies était celle de l'enfant de cette fête-là : la nouvelle prestation a la sienne.
      .filter((q) => !(q.nombre && /combien de bougies sur le gâteau/i.test(q.text)));
    const date = s.date ? new Date(`${s.date}T12:00:00`) : null;
    return {
      id: sid, show: s, questions,
      titre: `${showTitle(s)}${date ? ` (${date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })})` : ""}`,
      details: [date ? date.toLocaleDateString("fr-FR") : "", s.age != null && s.age !== "" ? `${s.age} ans` : "", `${questions.length} question${questions.length > 1 ? "s" : ""}`].filter(Boolean).join(" · "),
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
  const champ = h("input", { type: "search", class: "reprendre-cherche", "aria-label": "Chercher une manche", placeholder: "Chercher : mot, prénom, date…" });
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
      remplir(liste, h("p", { class: "reprendre-groupe", text: trouvees.length ? `${trouvees.length} manche${trouvees.length > 1 ? "s" : ""} trouvée${trouvees.length > 1 ? "s" : ""}` : "Aucune manche ne correspond." }), ...trouvees.map(ligne));
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
    h("button", { type: "button", class: "chip reprendre-ouvrir", text: type === "quiz" ? "↺ Reprendre les questions d'une manche déjà faite" : "↺ Reprendre une manche déjà faite", "aria-expanded": "false",
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
const TIRAGE_NOMBRES = Array.from({ length: MAX_TIREES }, (_, k) => k + 1);
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
let questionAFocaliser = null;

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
function piocherQuiz(r, { qcm = 0, chiffres = 0, profil }) {
  const manches = roundCtx === prestationCtx && editing ? editing.rounds.filter(Boolean) : [r];
  const textes = [...new Set([r, ...manches])].flatMap((m) => [...questionsDesSeries(m, quizzes), ...roundTirees(m),
    ...(roundSeriesQuiz(m).length ? [] : roundQuizIds(m).flatMap((id) => playable(quizzes[id])))].map((q) => q?.text));
  const exclus = new Set([...textes, ...casesDuTirage(r).filter((q) => !caseVide(q)).map((q) => q.text), ...(r.ecartees ?? [])].filter(Boolean));
  const niveau = NIVEAU_DU_PROFIL[profil] ?? null;
  return {
    qcm: tirerChiffres(qcm, { niveau, exclus, liste: QCM_TOUT_PRETS }).map(versTiree),
    chiffres: tirerChiffres(chiffres, { niveau, exclus, liste: CHIFFRES_TOUT_PRETS }).map(versTiree),
  };
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
  const nb = chiffresDuTirage(n);
  const { qcm, chiffres } = piocherQuiz(r, { qcm: n - nb, chiffres: nb, profil });
  const liste = [...qcm];
  chiffres.forEach((q, k) => liste.splice(Math.min(liste.length, Math.round(((k + 1) * n) / (chiffres.length + 1)) - 1), 0, q));
  poserTirage(r, liste, profil);
  r.profil = profil;
}

/**
 * Nombre de questions changé après le tirage : moins, les questions retirées (🎲 en attente) partent d'abord, puis
 * les dernières ; plus, de nouvelles questions s'ajoutent à la fin (Juste Chiffre compris, une sur quatre environ).
 */
function changerNombreTirage(r, k, profil) {
  let cases = casesDuTirage(r);
  while (cases.length > k) {
    const vide = cases.map(caseVide).lastIndexOf(true);
    cases = vide >= 0 ? cases.filter((_, i) => i !== vide) : cases.slice(0, k);
  }
  if (cases.length < k) {
    const manque = k - cases.length;
    const nb = Math.min(manque, Math.max(0, chiffresDuTirage(k) - cases.filter((q) => q.nombre).length));
    const { qcm, chiffres } = piocherQuiz(r, { qcm: manque - nb, chiffres: nb, profil });
    cases = [...cases, ...shuffle([...qcm, ...chiffres])];
  }
  poserTirage(r, cases);
}

/** Miniature de l'image de la révélation (cedric, 23/10 : vérifier qu'elle va avec la réponse) : photo, sinon émoji. */
const miniature = (q) => (q.banque ? h("img", { class: "tirage-mini", src: cheminPhotoBanque(q.banque), alt: "", loading: "lazy", title: "Image montrée à la révélation" })
  : q.emoji || (typeof q.image === "string" && q.image && !q.imageId) ? h("span", { class: "tirage-mini emoji", text: q.emoji ?? q.image, title: "Image montrée à la révélation" })
  : q.imageId ? h("span", { class: "tirage-mini emoji", text: "🖼", title: "Une de vos images, montrée à la révélation" }) : null);

/** Petite étiquette des questions de la Super Finale, dans la liste (cedric, 23/10 : une seule, à la fin). */
const etiquetteFinale = (r) => h("span", { class: "badge-finale", text: `🏆 ×${FACTEURS_FINALE.includes(r.facteur) ? r.facteur : FACTEURS_FINALE[0]}`, title: "Question de la Super Finale" });

/** « 19 questions, dont 3 en Super Finale » : le compteur au-dessus de la première ligne (cedric, 23/10). */
function compteurQuiz(r) {
  const total = questionsDesSeries(r, quizzes).length;
  const finale = r.finale > 0 ? Math.min(r.finale, total) : 0;
  const aTirer = casesDuTirage(r).filter(caseVide).length;
  const aFinir = seriesDe(r).filter((x) => x.origine === "main").flatMap((x) => x.questions ?? []).filter((q) => q && !questionJouable(q)).length;
  const bougies = roundCtx === prestationCtx && editing && premierQuiz(editing.rounds, quizzes) === r && questionBougies({ childName: $("show-child").value, age: $("show-age").value }, r);
  return [
    total ? `${total} question${total > 1 ? "s" : ""}` : "Aucune question pour l'instant",
    finale ? `dont ${finale > 1 ? `${finale}` : "la dernière"} en Super Finale` : "",
    bougies && total ? "plus la question des bougies" : "",
  ].filter(Boolean).join(", ") + [aTirer ? ` · ${aTirer} à tirer` : "", aFinir ? ` · ${aFinir} à compléter` : ""].join("");
}

/**
 * Manche Quiz (cedric, 23/10) : un seul jeu, de 1 à 100 questions, fait de séries qui passent dans l'ordre choisi.
 * - En haut, le compteur de toute la manche (dans une prestation : sur la ligne du numéro du jeu).
 * - Les outils de création, ensemble :
 *   - le profil des questions (celui de la prestation d'office, modifiable), leur nombre et le 🎲 qui les tire dans la
 *     banque (pas de ✕ : c'est un outil, la série tirée a la sienne) ;
 *   - « Rappeler un de vos quiz » : tout le Quiz d'une prestation archivée, cherchée par prénom, âge, date… ;
 *   - « Intégrer un quiz de votre bibliothèque » : un quiz de la page Quiz (importé ou écrit), cherché par son titre.
 * - Les séries : chacune se déplie, monte ou descend (↑ ↓) et s'enlève (✕) ; dans une série, ✕ retire une question
 *   (celle tirée au 🎲 laisse un 🎲 à sa place, qui en tire une autre de la même sorte).
 * - Puis la case de la question des bougies (premier Quiz de la prestation, cochée d'office), la Super Finale : oui ou
 *   non, ses dernières questions (3 d'office) et son multiplicateur (×2 d'office) ; en dernière ligne, le « Quiz
 *   complet » : toutes les questions dans l'ordre de passage (les bougies comprises), chacune monte, descend ou
 *   s'enlève, et 🔀 mélange tout.
 */
function mancheQuiz(r) {
  const series = seriesDe(r);
  const cases = casesDuTirage(r);
  const de = serieDuDe(r);
  const profil = PROFILES[de?.profil] ? de.profil : PROFILES[r.profil] ? r.profil : roundCtx.profile?.() ?? "MOYENS";
  const n = cases.length || r.nbTirage || TIRAGE_DEFAUT;
  // Une nouvelle manche part avec la Super Finale sur ses 3 dernières questions, ×2 (cedric, 23/10).
  if (r.finale === undefined && !roundFilled(r)) r.finale = SUPER_FINALE_LAST;
  const assemblage = questionsDuQuiz(r, quizzes);
  const total = assemblage.length;
  const finale = r.finale > 0 ? Math.min(r.finale, total) : 0;
  // Les questions de la Super Finale : les dernières dans l'ordre de passage (celui du « Quiz complet »).
  const clesFinale = new Set(finale ? assemblage.slice(-finale).map((x) => x.cle) : []);
  const compteur = h("p", { class: "quiz-compteur", "aria-live": "polite", text: compteurQuiz(r) });
  const majCompteur = () => { compteur.textContent = compteurQuiz(r); roundCtx.summary(); };
  const changer = () => { roundCtx.refresh(); };

  // Première ligne : profil, nombre, 🎲.
  const tirer = (k, p) => { tirerQuestionsQuiz(r, k, p); changer(); };
  const nombre = h("select", {
    class: "tirage-nombre", "aria-label": "Nombre de questions à tirer",
    onchange: (e) => {
      const k = Number(e.target.value);
      if (!cases.length) { r.nbTirage = k; return; }
      changerNombreTirage(r, k, profil);
      changer();
    },
  }, ...[...new Set([...TIRAGE_NOMBRES, n])].sort((a, b) => a - b).map((k) => h("option", { value: k, selected: k === n, text: k > 1 ? `${k} questions` : "1 question" })));
  const profils = h("select", {
    class: "tirage-profil", "aria-label": "Profil des questions",
    onchange: (e) => { if (cases.length) tirer(cases.length, e.target.value); else r.profil = e.target.value; },
  }, ...Object.entries(PROFILES).map(([k, p]) => h("option", { value: k, selected: k === profil, text: p.label })));
  const ligne = h("div", { class: "tirage-ligne" },
    profils,
    nombre,
    h("button", {
      type: "button", class: "btn tirage-de", text: "🎲", "aria-label": "Tirer les questions au hasard",
      title: "Tirer les questions au hasard dans la banque (les autres séries ne bougent pas)", onclick: () => tirer(Number(nombre.value), profils.value),
    }));

  // Deuxième ligne : « Rappeler un de vos quiz » (cedric, 23/10) : une recherche dans les prestations archivées
  // (prénom, âge, date, notes…) ; celle choisie ajoute tout son Quiz en une série à la fin (questions copiées : la
  // prestation archivée ne change pas).
  const archives = quizArchives();
  const rappel = ligneAjoutQuiz({
    classe: "quiz-rappel", titre: "📚 Rappeler un de vos quiz", label: "Chercher une prestation archivée",
    placeholder: "Prénom, âge, date… d'une prestation archivée", vide: "Aucune prestation archivée avec un Quiz",
    aucun: "Aucune prestation archivée ne correspond.", items: archives, attr: (x) => ({ "data-show": x.id }),
    choisir: (x) => {
      series.push({ id: nouvelId("p"), origine: "reprise", titre: x.titre, questions: JSON.parse(JSON.stringify(x.questions)) });
      changer();
    },
  });

  // Troisième ligne : « Intégrer un quiz de votre bibliothèque » (cedric, 23/10) : un quiz de la page Quiz (importé ou
  // écrit à la main), cherché par son titre ou son thème ; il s'ajoute en entier à la fin (lu dans la bibliothèque).
  // Seulement ses quiz à 4 réponses (cedric, 23/10) : ni ceux des prestations de test, ni ceux d'images (Zoom, Image
  // floue), ni le Quiz illustré, ni un quiz de Vrai ou Faux.
  const dejaLa = new Set(series.filter((x) => x.origine === "quiz").map((x) => x.quizId));
  const quatreReponses = (x) => x.kind === "number" || (x.choices ?? []).filter((c) => `${c ?? ""}`.trim()).length === 4;
  const classiques = Object.entries(quizzes)
    .filter(([qid, q]) => q?.title && !estQuizDeTest(qid) && quizKind(q) === "classique" && quizQuestions(q).some(quatreReponses))
    .sort(([, a], [, b]) => a.title.localeCompare(b.title, "fr"))
    .map(([qid, q]) => {
      const k = quizQuestions(q).length;
      return { id: qid, titre: q.title, details: [`${k} question${k > 1 ? "s" : ""}`, q.theme, dejaLa.has(qid) ? "✓ déjà dans ce Quiz" : ""].filter(Boolean).join(" · "),
        noms: [q.title], autres: [q.theme] };
    });
  const biblio = ligneAjoutQuiz({
    classe: "quiz-biblio", titre: "📗 Intégrer un quiz de votre bibliothèque", label: "Chercher un quiz de la bibliothèque",
    placeholder: "Titre ou thème d'un de vos quiz", vide: "Pas encore de quiz dans votre bibliothèque",
    aucun: "Aucun quiz de la bibliothèque ne correspond.", items: classiques, attr: (x) => ({ "data-quiz": x.id }),
    choisir: (x) => { series.push({ id: nouvelId("q"), origine: "quiz", quizId: x.id }); changer(); },
  });
  const outils = h("div", { class: "quiz-outils" }, ligne, rappel, biblio);

  // Les séries, dans l'ordre choisi ; les questions de la Super Finale y sont marquées.
  const ligneQuestion = (x, q, retirer, extra = null) => {
    const fin = clesFinale.has(cleQuestion(x, q));
    return h("li", { class: `tirage-q${fin ? " en-finale" : ""}` }, h("div", { class: "tirage-q-ligne" },
      h("span", { class: "tirage-texte", text: `${q.nombre || q.kind === "number" ? "🔢 " : ""}${q.text}` }),
      miniature(q),
      fin ? etiquetteFinale(r) : null,
      extra,
      h("button", { type: "button", class: "icon tirage-retirer", text: "✕", "aria-label": "Retirer cette question", title: "Retirer cette question", onclick: retirer })));
  };
  const corps = (x) => {
    if (x.origine === "de") {
      // ✕ : la question part, un 🎲 prend sa place ; il tire une question de la même sorte (Juste Chiffre ou 4 réponses).
      const qs = casesDuTirage(r);
      return qs.map((q, i) => (caseVide(q)
        ? h("li", { class: "tirage-q vide" }, h("div", { class: "tirage-q-ligne" },
          h("button", { type: "button", class: "btn tirage-de petit", text: "🎲", "aria-label": "Tirer une autre question", title: "Tirer une autre question", onclick: () => {
            const { qcm, chiffres } = piocherQuiz(r, { qcm: q.nombre ? 0 : 1, chiffres: q.nombre ? 1 : 0, profil });
            const neuve = qcm[0] ?? chiffres[0];
            if (!neuve) { annonce("Plus aucune question libre de cette sorte pour ce profil : changez le profil, ou baissez le nombre de questions."); return; }
            poserTirage(r, qs.map((y, k) => (k === i ? neuve : y)));
            changer();
          } }),
          h("span", { class: "hint small", text: q.nombre ? "Juste Chiffre à tirer" : "Question à tirer" })))
        : ligneQuestion(x, q, () => {
          r.ecartees = [...(r.ecartees ?? []), q.text];
          poserTirage(r, qs.map((y, k) => (k === i ? { vide: true, ...(q.nombre ? { nombre: true } : {}) } : y)));
          changer();
        })));
    }
    if (x.origine === "quiz") {
      // Quiz rappelé : ✕ retire une question (gardée de côté, « ↺ » la remet) ; le quiz de la bibliothèque ne change pas.
      return questionsDeLaSerie(x, quizzes).map((q) => ligneQuestion(x, q, () => { x.sans = [...(x.sans ?? []), q.text]; changer(); }));
    }
    if (x.origine === "main") {
      return (x.questions ?? []).filter(Boolean).map((q) => questionEcrite(r, x, q, majCompteur, questionJouable(q) && clesFinale.has(cleQuestion(x, q))));
    }
    // Reprise d'une autre manche : ses questions copiées ; ✕ en retire une.
    return (x.questions ?? []).filter(Boolean).map((q) => (questionJouable(q) ? ligneQuestion(x, q, () => { x.questions = x.questions.filter((y) => y !== q); changer(); }) : null));
  };
  const titreSerie = (x) => {
    const k = questionsDeLaSerie(x, quizzes).length;
    const nq = `${k} question${k > 1 ? "s" : ""}`;
    if (x.origine === "de") {
      const vides = casesDuTirage(r).filter(caseVide).length;
      return `🎲 ${nq} tirée${k > 1 ? "s" : ""} au hasard (${PROFILES[x.profil ?? profil]?.label.split(" (")[0] ?? ""})${vides ? `, ${vides} à tirer` : ""}`;
    }
    if (x.origine === "quiz") return quizzes[x.quizId] ? `📚 Quiz « ${quizzes[x.quizId].title} » : ${nq}${x.sans?.length ? ` (${x.sans.length} retirée${x.sans.length > 1 ? "s" : ""})` : ""}` : "📚 Ce quiz n'existe plus dans la bibliothèque";
    if (x.origine === "main") {
      const aFinir = (x.questions ?? []).filter((q) => q && !questionJouable(q)).length;
      return `✍ ${nq} écrite${k > 1 ? "s" : ""} à la main${aFinir ? `, ${aFinir} à compléter` : ""}`;
    }
    return `📅 ${x.titre ?? "Questions reprises"} : ${nq}`;
  };
  const deplacer = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= series.length) return;
    const bougiesRangees = placeDesBougies(r, quizzes);
    [series[i], series[j]] = [series[j], series[i]];
    // Rangé à la main : chaque série garde l'ordre de ses questions, les séries passent dans leur nouvel ordre ; la
    // question des bougies rangée à la main garde sa place.
    if (r.ordreQuiz?.length) {
      const ordre = series.flatMap((y) => assemblage.filter((z) => z.serie.id === y.id).map((z) => z.cle));
      if (bougiesRangees != null) ordre.splice(Math.min(bougiesRangees, ordre.length), 0, CLE_BOUGIES);
      r.ordreQuiz = ordre;
    }
    changer();
  };
  const liste = h("ol", { class: "quiz-series" }, ...series.map((x, i) => {
    const qs = h("ol", { class: "tirage-liste serie-liste" }, ...corps(x).filter(Boolean));
    qs.hidden = !seriesDepliees.has(x);
    const voir = h("button", {
      type: "button", class: "chip tirage-voir serie-voir", "aria-expanded": qs.hidden ? "false" : "true", text: `${qs.hidden ? "▸" : "▾"} ${titreSerie(x)}`,
      title: "Voir ou cacher les questions de cette série",
      onclick: (e) => {
        qs.hidden = !qs.hidden;
        if (qs.hidden) seriesDepliees.delete(x); else seriesDepliees.add(x);
        e.currentTarget.textContent = `${qs.hidden ? "▸" : "▾"} ${titreSerie(x)}`;
        e.currentTarget.setAttribute("aria-expanded", qs.hidden ? "false" : "true");
      },
    });
    const enlever = async () => {
      const k = x.origine === "main" ? (x.questions ?? []).filter(Boolean).length : questionsDeLaSerie(x, quizzes).length;
      if (k && !(await confirmer(`Enlever cette série (${k} question${k > 1 ? "s" : ""}) de la manche ?${x.origine === "quiz" ? " Le quiz reste dans la bibliothèque." : ""}`, { ok: "Enlever", danger: true }))) return;
      r.seriesQuiz = series.filter((y) => y !== x);
      changer();
      noterEcran();
    };
    return h("li", { class: "serie", "data-origine": x.origine },
      h("div", { class: "serie-tete" },
        voir,
        x.origine === "quiz" && x.sans?.length ? h("button", { type: "button", class: "chip serie-remettre", text: "↺ Remettre", title: "Remettre les questions retirées de ce quiz", onclick: () => { x.sans = []; changer(); } }) : null,
        x.origine === "main" ? h("button", { type: "button", class: "chip serie-plus", text: "＋ Une question", onclick: () => {
          const q = { id: nouvelId("e"), text: "", choices: ["", "", "", ""] };
          x.questions = [...(x.questions ?? []), q];
          seriesDepliees.add(x);
          questionAFocaliser = q.id;
          changer();
        } }) : null,
        h("button", { type: "button", class: "icon serie-monter", text: "↑", title: "Passer cette série plus tôt", "aria-label": "Monter cette série", disabled: i === 0, onclick: () => deplacer(i, -1) }),
        h("button", { type: "button", class: "icon serie-descendre", text: "↓", title: "Passer cette série plus tard", "aria-label": "Descendre cette série", disabled: i === series.length - 1, onclick: () => deplacer(i, 1) }),
        h("button", { type: "button", class: "icon serie-enlever", text: "✕", title: "Enlever cette série de la manche", "aria-label": "Enlever cette série", onclick: enlever })),
      qs);
  }));

  // La question des bougies (premier Quiz de la prestation), juste au-dessus de la Super Finale.
  const bougies = roundCtx === prestationCtx && editing && premierQuiz(editing.rounds, quizzes) === r
    ? h("label", { class: "check bougies quiz-bougies", title: "« Combien de bougies sur le gâteau de … cette année ? » : l'âge de l'enfant, au Juste Chiffre. D'office juste avant la Super Finale ; elle se range où vous voulez dans le Quiz complet." },
      h("input", { type: "checkbox", checked: r.bougies !== false, onchange: (e) => { r.bougies = e.target.checked ? null : false; if (!e.target.checked) oublierPlaceBougies(r); changer(); } }),
      "🎂 Question des bougies")
    : null;

  // Dernière ligne : la Super Finale (cedric, 23/10) : oui ou non, combien de dernières questions, le multiplicateur.
  const avec = r.finale > 0;
  const derniere = h("div", { class: "quiz-finale" },
    h("span", { class: "quiz-finale-titre", text: "🏆 Super Finale" }),
    h("select", { class: "finale-oui", "aria-label": "Super Finale", onchange: (e) => { r.finale = e.target.value === "oui" ? (r.finaleAvant > 0 ? r.finaleAvant : SUPER_FINALE_LAST) : null; changer(); } },
      h("option", { value: "oui", selected: avec, text: "Oui" }),
      h("option", { value: "non", selected: !avec, text: "Non" })),
    avec ? h("select", { class: "finale", "aria-label": "Questions de la Super Finale", onchange: (e) => { r.finale = Number(e.target.value) || null; r.finaleAvant = r.finale; changer(); } },
      ...[...new Set([1, 2, 3, 4, 5, 6, 8, 10, r.finale])].sort((a, b) => a - b).map((k) => h("option", { value: k, selected: r.finale === k, text: k === 1 ? "La dernière question" : `Les ${k} dernières questions` })))
      : null,
    avec ? h("select", { class: "finale-facteur", "aria-label": "Multiplicateur de la Super Finale", onchange: (e) => { r.facteur = Number(e.target.value); changer(); } },
      ...FACTEURS_FINALE.map((k) => h("option", { value: k, selected: (FACTEURS_FINALE.includes(r.facteur) ? r.facteur : FACTEURS_FINALE[0]) === k, text: `Points ×${k}` })))
      : null,
    avec ? h("span", { class: "hint small", text: "Sur le téléphone, Sarah peut encore changer le multiplicateur juste avant." }) : null);

  // Une question écrite à la main qui vient d'être créée : le curseur dans son texte.
  if (questionAFocaliser) {
    const id = questionAFocaliser;
    questionAFocaliser = null;
    requestAnimationFrame(() => document.querySelector(`[data-question="${CSS.escape(id)}"] .q-main-texte`)?.focus());
  }
  return [compteur, outils, series.length ? liste : null, bougies, derniere, quizComplet(r, assemblage, clesFinale, changer)];
}

/** Résultats montrés au plus sous une recherche d'ajout du Quiz (cedric, 23/10 : « 5 ou 6 »). */
const QUIZ_AJOUT_MAX = 6;

/**
 * Une ligne d'ajout du Quiz (cedric, 23/10) : une case à gauche (pas un champ), une recherche à droite. Rien tant
 * qu'aucune lettre n'est tapée ; ensuite, à chaque lettre, les QUIZ_AJOUT_MAX meilleurs résultats (prénom, titre,
 * date…), les uns sous les autres, dans une liste posée à droite par-dessus l'écran (rien ne bouge en dessous). Un clic
 * sur un résultat l'ajoute.
 */
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

/** « Quiz complet » déplié (le temps de l'écran), par manche. */
const quizCompletsDeplies = new WeakSet();
// Décochée, la question des bougies oublie sa place : recochée, elle revient juste avant la Super Finale.
const oublierPlaceBougies = (r) => { if (r.ordreQuiz?.length) r.ordreQuiz = r.ordreQuiz.filter((c) => c !== CLE_BOUGIES); };

/**
 * Dernière ligne d'un Quiz (cedric, 23/10) : le « Quiz complet », tout ce qui a été ajouté (🎲, prestation archivée,
 * bibliothèque…) dans l'ordre de passage. Déplié : chaque question monte, descend ou s'enlève ; 🔀 mélange tout.
 * L'ordre rangé ici est gardé dans la manche (`ordreQuiz`). La question des bougies (case cochée) en est une comme les
 * autres : d'office juste avant la Super Finale (sa place suit les ajouts), jusqu'à ce qu'on la déplace ou qu'on mélange.
 */
function quizComplet(r, assemblage, clesFinale, changer) {
  if (!assemblage.length) return null;
  const bougies = roundCtx === prestationCtx && editing && premierQuiz(editing.rounds, quizzes) === r
    && !assemblage.some((x) => x.q.kind === "number" && /bougie/i.test(x.q.text ?? ""))
    ? questionBougies({ childName: $("show-child").value, age: $("show-age").value }, r) : null;
  const rangees = bougies ? placeDesBougies(r, quizzes) : null;
  const vue = [...assemblage];
  if (bougies) vue.splice(rangees != null ? Math.min(rangees, vue.length) : assemblage.length - clesFinale.size, 0, { cle: CLE_BOUGIES, bougies: true, q: bougies });
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
    if (x.bougies) {
      r.bougies = false;
      oublierPlaceBougies(r);
      changer();
      noterEcran();
      return;
    }
    const serie = seriesDe(r).find((y) => y.id === x.serie.id);
    if (!serie) return;
    if (serie.origine === "quiz") serie.sans = [...(serie.sans ?? []), x.q.text];
    else {
      const reste = (serie.questions ?? []).filter(Boolean);
      const k = reste.findIndex((q) => cleQuestion(serie, q) === x.cle);
      if (k < 0) return;
      if (serie.origine === "de") r.ecartees = [...(r.ecartees ?? []), reste[k].text];
      serie.questions = reste.filter((_, i) => i !== k);
      if (!serie.questions.some((q) => !caseVide(q))) r.seriesQuiz = seriesDe(r).filter((y) => y !== serie);
    }
    if (r.ordreQuiz?.length) r.ordreQuiz = cles.filter((c) => c !== x.cle && (c !== CLE_BOUGIES || rangees != null));
    changer();
    noterEcran();
  };
  const melanger = () => {
    let nouvel = shuffle(cles);
    for (let essai = 0; essai < 5 && cles.length > 1 && nouvel.every((c, k) => c === cles[k]); essai++) nouvel = shuffle(cles);
    ranger(nouvel, true);
  };
  const lignes = vue.map((x, k) => h("li", { class: `tirage-q quiz-complet-q${x.bougies ? " quiz-complet-bougies" : ""}${clesFinale.has(x.cle) ? " en-finale" : ""}`, "data-cle": x.cle },
    h("div", { class: "tirage-q-ligne" },
      h("span", { class: "quiz-complet-num", text: `${k + 1}` }),
      h("span", { class: "tirage-texte", text: `${x.bougies ? "🎂 " : ""}${x.q.kind === "number" ? "🔢 " : ""}${x.q.text}` }),
      miniature(x.q),
      clesFinale.has(x.cle) ? etiquetteFinale(r) : null,
      h("button", { type: "button", class: "icon quiz-complet-monter", text: "↑", title: "Passer cette question plus tôt", "aria-label": "Monter cette question", disabled: k === 0, onclick: () => deplacer(k, -1) }),
      h("button", { type: "button", class: "icon quiz-complet-descendre", text: "↓", title: "Passer cette question plus tard", "aria-label": "Descendre cette question", disabled: k === vue.length - 1, onclick: () => deplacer(k, 1) }),
      h("button", { type: "button", class: "icon tirage-retirer", text: "✕", title: x.bougies ? "Enlever la question des bougies (la case se décoche)" : "Enlever cette question du quiz", "aria-label": "Enlever cette question", onclick: () => enlever(x) }))));
  const liste = h("ol", { class: "tirage-liste serie-liste quiz-complet-liste" }, ...lignes);
  liste.hidden = !quizCompletsDeplies.has(r);
  const titre = () => `${liste.hidden ? "▸" : "▾"} 🧩 Quiz complet : ${vue.length} question${vue.length > 1 ? "s" : ""}, dans l'ordre de passage`;
  const voir = h("button", {
    type: "button", class: "chip tirage-voir serie-voir quiz-complet-voir", "aria-expanded": liste.hidden ? "false" : "true", text: titre(),
    title: "Voir toutes les questions du quiz, dans l'ordre",
    onclick: (e) => {
      liste.hidden = !liste.hidden;
      if (liste.hidden) quizCompletsDeplies.delete(r); else quizCompletsDeplies.add(r);
      e.currentTarget.textContent = titre();
      e.currentTarget.setAttribute("aria-expanded", liste.hidden ? "false" : "true");
    },
  });
  return h("div", { class: "serie quiz-complet" },
    h("div", { class: "serie-tete" },
      voir,
      h("button", { type: "button", class: "chip quiz-melanger", text: "🔀 Mélanger", title: "Mélanger toutes les questions du quiz", disabled: vue.length < 2, onclick: melanger })),
    liste);
}

/**
 * Une question écrite à la main (cedric, 23/10) : son texte, puis 4 réponses (on coche la bonne ; 2 au moins) ou un
 * Juste Chiffre (le bon nombre). Pas finie : gardée, mais pas jouée (« à compléter »).
 */
function questionEcrite(r, serie, q, majCompteur, fin = false) {
  const etat = h("span", { class: "q-main-etat small" });
  const majEtat = () => {
    const manque = !q.text?.trim() ? "la question" : q.nombre ? (Number.isInteger(q.correct) ? "" : "le bon nombre")
      : (q.choices ?? []).filter((c) => c?.trim()).length < 2 ? "2 réponses au moins" : !(q.choices?.[q.correct] ?? "").trim() ? "la bonne réponse (cochez-la)" : "";
    etat.textContent = manque ? `À compléter : ${manque}` : "✓ Prête";
    etat.classList.toggle("ok", !manque);
  };
  const changer = () => { majEtat(); majCompteur(); };
  const sorte = (nombre, texte) => h("button", {
    type: "button", class: `chip mode-chip${!!q.nombre === nombre ? " active" : ""}`, "aria-pressed": !!q.nombre === nombre ? "true" : "false", text: texte,
    onclick: () => {
      if (!!q.nombre === nombre) return;
      if (nombre) { q.nombre = true; delete q.choices; delete q.correct; } else { delete q.nombre; q.choices = ["", "", "", ""]; delete q.correct; }
      roundCtx.refresh();
    },
  });
  const reponses = q.nombre
    ? h("label", { class: "q-main-nombre" }, "Le bon nombre",
      h("input", { type: "number", step: "1", value: Number.isInteger(q.correct) ? q.correct : "", "aria-label": "Le bon nombre",
        oninput: (e) => { const v = e.target.value.trim(); q.correct = v === "" || !Number.isInteger(Number(v)) ? null : Number(v); changer(); } }))
    : h("div", { class: "q-main-reponses" }, ...[0, 1, 2, 3].map((k) => h("label", { class: "q-main-reponse" },
      h("input", { type: "radio", name: `bonne-${q.id}`, checked: q.correct === k, "aria-label": `Réponse ${LETTERS[k]} : la bonne`, title: "La bonne réponse",
        onchange: () => { q.correct = k; changer(); } }),
      h("input", { type: "text", maxlength: "120", class: "q-main-choix", value: q.choices?.[k] ?? "", placeholder: `Réponse ${LETTERS[k]}`, "aria-label": `Réponse ${LETTERS[k]}`,
        oninput: (e) => { q.choices = [0, 1, 2, 3].map((j) => (j === k ? e.target.value : q.choices?.[j] ?? "")); changer(); } }))));
  majEtat();
  return h("li", { class: `q-main${fin ? " en-finale" : ""}`, "data-question": q.id },
    h("div", { class: "q-main-haut" },
      h("input", { type: "text", maxlength: "300", class: "q-main-texte", value: q.text ?? "", placeholder: "Écrivez la question…", "aria-label": "La question",
        oninput: (e) => { q.text = e.target.value; changer(); } }),
      fin ? etiquetteFinale(r) : null,
      sorte(false, "4 réponses"),
      sorte(true, "🔢 Juste Chiffre"),
      h("button", { type: "button", class: "icon tirage-retirer", text: "✕", "aria-label": "Retirer cette question", title: "Retirer cette question",
        onclick: () => { serie.questions = (serie.questions ?? []).filter((y) => y !== q); if (!serie.questions.length) r.seriesQuiz = seriesDe(r).filter((y) => y !== serie); roundCtx.refresh(); } })),
    reponses,
    etat);
}

/** Contenu et réglages d'une manche, selon son jeu : les mêmes dans une prestation et dans la page d'un jeu. */
function roundFields(r) {
  const options = Object.entries(quizzes).sort(([, a], [, b]) => a.title.localeCompare(b.title));
  const decks = Object.entries(mimes).sort(([, a], [, b]) => a.title.localeCompare(b.title));
  const lists = Object.entries(playlists).filter(([, p]) => !isStatuesList(p)).sort(([, a], [, b]) => a.title.localeCompare(b.title));
  const photos = r.type === "zoom" || r.type === "flou";
  const quiz = (r.type ?? "quiz") === "quiz";
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
    // Statues musicales : la durée de la musique et les chansons cochées (aucune : la musique de la fête).
    ? h("div", { class: "grow picto-round" },
      h("select", { class: "grow", "aria-label": "Durée", onchange: (e) => { r.duration = Number(e.target.value); roundCtx.summary(); } },
        ...STATUES_SECONDS.map((n) => h("option", { value: n, selected: (r.duration ?? STATUES_SEC) === n, text: `${n} secondes de musique (on danse, on se fige à l'arrêt ; vous désignez l'équipe gagnante)` }))),
      songsPicker(r))
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
    ? h("span", { class: "grow hint small", text: "Rien à préparer : la TV tire la mèche au sort, la bombe part d'une équipe au hasard." })
    : r.type === "gonfleur"
    ? h("span", { class: "grow hint small", text: "Rien à préparer : chaque équipe tapote sa tablette, le premier ballon qui éclate gagne." })
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
    : photos
    // Zoom mystère, Image floue : un quiz entier, ou des photos choisies une par une dans tous les quiz.
    ? h("div", { class: "grow picto-round" },
      modeSwitch(r, roundPicks(r).length > 0 || r.byItem === true, "Les photos d'un quiz", "Des photos au choix", (on) => {
        r.byItem = on;
        if (on) { r.picks = roundQuizIds(r).flatMap((id) => (quizzes[id] ? zoomQuestions(quizzes[id]) : []).map((q) => q.imageId)).slice(0, MAX_PICKS); r.quizId = ""; r.quizIds = null; } else r.picks = null;
      }),
      roundPicks(r).length || r.byItem ? itemSelection(r, "picks") : quizSelection(r, options))
    : quiz ? null : quizSelection(r, options);
  return [
    // Quiz (cedric, 23/10) : une seule manche faite de séries (🎲, quiz rappelés, questions écrites, reprises).
    ...(quiz ? mancheQuiz(r) : [content]),
    // Qui a disparu ? : objets par grille, pour régler la difficulté (par défaut selon l'âge de la prestation).
    r.type === "disparu"
      ? h("select", { class: "count", "aria-label": "Objets par grille", onchange: (e) => { r.objects = Number(e.target.value) || null; roundCtx.summary(); } },
        h("option", { value: "", text: "Objets : selon l'âge" }),
        ...[4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => h("option", { value: n, selected: r.objects === n, text: `${n} objets par grille` })))
      : null,
    // Jeux tirés d'un quiz : toutes ses questions retenues, ou seulement les premières.
    !BUILTIN_GAMES[r.type] && r.type !== "statues" && r.type !== "pictionary" && r.type !== "coffres" && r.type !== "gonfleur" && r.type !== "patate" && r.type !== "mimes" && !MUSIC_GAMES[r.type] && !(photos && (roundPicks(r).length || r.byItem))
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
    SANS_CONTENU.includes(r.type) || quiz ? null : h("label", { class: "manche-note" }, "Note",
      h("input", { type: "text", maxlength: "200", value: r.note ?? "", placeholder: "Pour la retrouver : thème, âge, remarque…", "aria-label": "Note de la manche", oninput: (e) => { r.note = e.target.value; } })),
  ];
}

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
  const { snapshot, problems } = buildSnapshot(editing?.id ?? "nouvelle", s, quizzes, mimes, Math.random, playlists, contents);
  const profile = PROFILES[s.profile] ? s.profile : profileForAge(s.age);
  // Durée estimée toute seule d'après les jeux composés (cedric, 23/10) : elle ne se saisit plus.
  const duree = dureeEstimee(snapshot, s);
  $("show-duration").textContent = duree ? `environ ${duree.minutes} min` : "—";
  $("show-summary").textContent = snapshot
    ? `${contentLabel(snapshot)} jouables · environ ${duree.minutes} min · chrono ${defaultDuration(profile)} s par question ${profile === "NEUTRE" ? "(profil Neutre, tous âges)" : `pour les ${PROFILES[profile].label}`}, sauf durée imposée`
    : "";
  $("show-problems").replaceChildren(...problems.map((p) => h("li", { text: p })));
  const r = readiness(s, quizzes, mimes, playlists, contents);
  $("show-ready").className = `ready-box ${r.level}`;
  $("show-ready").replaceChildren(r.level === "prete"
    ? h("b", { text: "✓ À venir : prête, elle est visible sur la régie." })
    : r.level === "archivee"
      ? h("b", { text: "Prestation archivée : elle n'apparaît plus sur la régie." })
      : h("div", {}, h("b", { text: "Reste à faire avant le jour J :" }), h("ul", {}, ...r.todo.map((t) => h("li", { text: t })))));
}
["show-age", "show-profile", "show-child", "show-title", "show-date", "show-status"].forEach((id) => $(id).addEventListener("input", refreshSummary));
// Le nombre d'équipes change ce qu'il faut prévoir pour les mimes : les manches sont redessinées.
$("show-teams").addEventListener("change", refreshRounds);
$("round-add").onclick = () => ouvrirChoixJeu();

/** Contenu d'une manche (titre du quiz, du paquet, de la playlist), "" pour un jeu sans contenu, null s'il n'existe plus. */
function roundContent(r) {
  if (!r?.type && !r?.quizId) return null;
  if (BUILTIN_GAMES[r.type] || r.type === "statues" || r.type === "pictionary" || r.type === "coffres" || r.type === "portes" || r.type === "gonfleur" || r.type === "patate") return "";
  if (r.type === "mimes") return r.deckId ? mimes[r.deckId]?.title ?? null : "cartes au hasard";
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

$("show-form").onsubmit = async (e) => {
  e.preventDefault();
  const s = formShow();
  // « À compléter » s'enregistre même incomplète (cedric, 21/10). « À venir » = prête pour la régie : s'il manque
  // quelque chose (prénom, âge, date, jeu prêt), elle est gardée « À compléter » et le message dit quoi.
  // Une date passée le dit aussi (sans cela, elle filerait directement dans les archivées).
  const manque = s.status === "publiee" ? readiness({ ...s, keepActive: true }, quizzes, mimes, playlists, contents).todo : [];
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
      ...s, origin: prev.origin ?? "admin", createdAt: prev.createdAt ?? Date.now(),
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
    else dire(s.status === "publiee" ? "Enregistrée « À venir » : elle est visible sur la régie." : "Enregistrée.", true);
  } catch (err) {
    console.error(err);
    dire("Enregistrement refusé : vérifiez les champs ou vos droits d'administration.");
  } finally {
    $("show-save").disabled = false;
  }
};

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
    $("quiz-photos-open").textContent = `Préparation des photos… (${k + 1}/${files.length})`;
    try { kept.push({ ...questions[k], imageId: await storeIllustration(f) }); } catch (err) { console.error(err); }
  }
  $("quiz-photos-open").textContent = "📷 Nouveau quiz de photos à deviner";
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
    status("rv-status", "Réponses en images : ajoutez une image à chaque réponse avec 📷, puis validez.", true);
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
      image: q.image ?? "", imageId: q.imageId ?? null, kind: q.kind === "number" ? "number" : null,
      // Réponses en images : une photo par case A à D (les propositions sont rangées dans l'ordre des cases).
      slotImages: [0, 1, 2, 3].map((k) => (IMAGE_ID.test(q.choiceImages?.[k] ?? "") ? q.choiceImages[k] : null)),
      missingImages: q.missingImages ?? [],
    })),
  };
  $("rv-title").value = quiz.title ?? "";
  $("rv-theme").value = quiz.theme ?? "";
  $("rv-age-min").value = quiz.ageMin ?? "";
  $("rv-age-max").value = quiz.ageMax ?? "";
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
        h("label", { class: "check" }, h("input", { type: "checkbox", class: "q-valid", checked: q.status === "validee", onchange: (e) => { q.status = e.target.checked ? "validee" : "brouillon"; recheck(); } }), "Validée"),
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
  // Repère de préparation, jamais bloquant : sans illustration, la révélation montre seulement la réponse.
  const missing = h("span", { class: "tag missing", text: "illustration manquante" });
  const refreshMissing = () => { missing.hidden = !!(q.imageId || q.image); };
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
  const show_ = () => {
    const id = q.slotImages?.[k];
    thumb.hidden = !id;
    remove.hidden = !id;
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
  return h("span", { class: "choice-photo" }, thumb, remove,
    h("button", { type: "button", class: "icon", title: "Mettre une image à la place du texte", text: "📷", onclick: (e) => { e.preventDefault(); file.click(); } }),
    h("button", {
      type: "button", class: "icon", title: "Choisir l'image dans la bibliothèque (photos libres, vos images, pochettes)", text: "🖼️",
      onclick: async (e) => {
        e.preventDefault();
        const x = await choisirDansBibliotheque({ titre: `Image de la réponse ${LETTERS[k]}`, groupes: ["photos", "miennes", "pochettes"], recherche: slots[k].replace(/^[^\p{L}\p{N}]+/u, "").trim() });
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
async function cadrer(source, forme, garder) {
  if (!source) return;
  try {
    const blob = await ouvrirCadrage(source, forme);
    if (!blob) return;
    await garder(blob);
    noterEcran();
  } catch (err) {
    console.error(err);
    status("rv-status", "Cadrage impossible pour cette image : essayez de la choisir à nouveau.");
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
  let blocked = 0, validated = 0, warned = 0;
  draft.questions.forEach((q, i) => {
    const card = $("rv-list").querySelector(`[data-q="${i}"]`);
    if (!card) return;
    const { errors, warnings } = checks[i];
    if (errors.length) { q.status = "brouillon"; blocked++; }
    if (warnings.length) warned++;
    if (q.status === "validee") validated++;
    const box = card.querySelector(".q-valid");
    box.checked = q.status === "validee";
    box.disabled = errors.length > 0;
    card.classList.toggle("error", errors.length > 0);
    card.classList.toggle("valid", q.status === "validee");
    card.querySelector(".problems").replaceChildren(
      ...errors.map((t) => h("li", { class: "err", text: t })),
      ...warnings.map((t) => h("li", { class: "warn", text: t })),
    );
  });
  const n = draft.questions.length;
  $("rv-summary").textContent = `${n} question${n > 1 ? "s" : ""} · ${validated} validée${validated > 1 ? "s" : ""}`
    + (blocked ? ` · ${blocked} à corriger` : "") + (warned ? ` · ${warned} à vérifier` : "");
}
["rv-age-min"].forEach((id) => $(id).addEventListener("input", recheck));

$("rv-validate-all").onclick = () => {
  const checks = checkQuestions(draft.questions, { profile: profileOfDraft(), existing: existingTexts() });
  draft.questions.forEach((q, i) => { if (!checks[i].errors.length) q.status = "validee"; });
  recheck();
};
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
      title, theme: $("rv-theme").value.trim() || null,
      ageMin: num($("rv-age-min").value), ageMax: num($("rv-age-max").value),
      source: draft.quiz.source ?? "saisie", kind: draft.kind,
      createdAt: draft.quiz.createdAt ?? Date.now(), updatedAt: serverTimestamp(),
      questions: questions.map((q) => ({
        text: q.text.slice(0, 300), choices: q.kind === "number" ? null : q.choices,
        correct: q.kind === "number" ? (Number.isInteger(q.correct) ? q.correct : 0) : q.correct,
        kind: q.kind === "number" ? "number" : null, duration: q.duration, double: q.double, status: q.status,
        image: cleanEmoji(q.image) || null, imageId: q.imageId || null,
        choiceImages: q.kind === "number" ? null : savedChoiceImages(q),
      })),
    });
    draft.id = id;
    histRelecture.enregistre();
    const ok = questions.filter((q) => q.status === "validee").length;
    status("rv-status", `Enregistré : ${ok} question${ok > 1 ? "s" : ""} validée${ok > 1 ? "s" : ""} sur ${questions.length}.`, true);
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
  const [codes, sons, images, maintenant] = await Promise.all([clesDe("games"), clesDe("library/sounds"), clesDe("library/images"), heureServeur()]);
  const bibliotheque = { sounds: new Set(sons), images: new Set(images) };
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
      cellule("Copies", `${nCopies(r.copies.sounds.length, "son", "sons")} · ${nCopies(images, "image", "images")}`),
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
        `${dateHeure(n.at)} · ${n.code} : ${nCopies(n.sounds, "son", "sons")}, ${nCopies(n.images + n.choiceImages, "image", "images")} effacés · environ ${texteMo(n.mo)}${n.gardes ? ` · ${nCopies(n.gardes, "extrait gardé", "extraits gardés")} (chanson plus dans la bibliothèque)` : ""}` }))) : null);
    box.hidden = false;
  } catch (err) {
    console.warn("Journal du nettoyage illisible :", err);
  }
}

// ---------- Prestation de test ----------

/** Ajoute la prestation de test et son quiz, seulement s'ils n'existent pas encore : rien n'est jamais remplacé. */
$("test-create").onclick = async () => {
  const btn = $("test-create");
  btn.disabled = true;
  try {
    const [q, s] = await Promise.all([get(ref(db, `library/quizzes/${TEST_ID}`)), get(ref(db, `library/shows/${TEST_ID}`))]);
    if (q.exists() || s.exists()) {
      status("test-status", "Elle existe déjà : retrouvez-la dans les listes de l'Accueil (rien n'a été modifié).", true);
      return;
    }
    const now = Date.now();
    await set(ref(db, `library/quizzes/${TEST_ID}`), { ...TEST_QUIZ, createdAt: now, updatedAt: serverTimestamp() });
    await set(ref(db, `library/shows/${TEST_ID}`), { ...TEST_SHOW, createdAt: now, updatedAt: serverTimestamp() });
    status("test-status", "Ajoutée : « ANNIVERSAIRE TEST – Léa, 9 ans » est dans « À venir » et sur la régie.", true);
  } catch (err) {
    console.error(err);
    status("test-status", "Échec de l'ajout. Vérifiez la connexion puis réessayez.");
  } finally {
    btn.disabled = false;
  }
};

/** Playlist du blind test démo, à clé fixe : un nouveau tirage la remplace. */
const DEMO_PLAYLIST = `${FULL_ID}-blind-demo`;
/**
 * Blind test démo (cedric, 21/10) : 10 chansons de la bibliothèque des sons tirées au hasard, celles qui ont leur
 * refrain d'abord (« on chante tous ensemble » à chaque révélation), en premier jeu de la prestation de test « tous les
 * jeux ». Un nouveau clic tire 10 autres chansons ; rien d'autre de la prestation ne change.
 */
$("test-blind-demo").onclick = async () => {
  const btn = $("test-blind-demo");
  const toutes = songList(songs, {}, isStatuesList);
  if (!toutes.length) return status("test-blind-status", "La bibliothèque des sons est vide : ajoutez d'abord vos chansons (Bibliothèque, onglet Sons).");
  const tirage = [...shuffle(toutes.filter((x) => x.refrainId)), ...shuffle(toutes.filter((x) => !x.refrainId))].slice(0, PLAYLIST_HASARD);
  btn.disabled = true;
  try {
    await set(ref(db, `library/playlists/${DEMO_PLAYLIST}`), {
      title: "TEST – Blind test démo", duration: BLIND_SEC, tracks: tirage.map((x) => trackFromSong(x)),
      createdAt: playlists[DEMO_PLAYLIST]?.createdAt ?? Date.now(), updatedAt: serverTimestamp(),
    });
    const fete = (await get(ref(db, `library/shows/${FULL_ID}`))).val();
    const chansons = `${plural(tirage.length, "chanson")} tirée${tirage.length > 1 ? "s" : ""} au hasard`;
    if (!fete) {
      return status("test-blind-status", `Playlist « TEST – Blind test démo » prête : ${chansons}. Ajoutez la prestation de test « tous les jeux » (bouton au-dessus), puis recliquez ici.`, true);
    }
    const rounds = Array.isArray(fete.rounds) ? fete.rounds : Object.values(fete.rounds ?? {});
    if (!rounds.some((r) => r?.type === "blind" && r.playlistId === DEMO_PLAYLIST)) {
      await set(ref(db, `library/shows/${FULL_ID}`), { ...fete, rounds: [{ type: "blind", playlistId: DEMO_PLAYLIST }, ...rounds], updatedAt: serverTimestamp() });
    }
    status("test-blind-status", `Blind test démo prêt : ${chansons}, en premier jeu de « ${FULL_SHOW.title} ». Rechargez la prestation dans la régie.`, true);
  } catch (err) {
    console.error(err);
    status("test-blind-status", "Échec : vérifiez la connexion puis réessayez.");
  } finally {
    btn.disabled = false;
  }
};

/**
 * Prestation de test « tous les jeux » : photos dessinées ici, puis quiz, paquet de mimes et enfin la
 * prestation. Chaque contenu déjà présent est gardé tel quel : rien n'est jamais remplacé.
 */
$("test-full-create").onclick = async () => {
  const btn = $("test-full-create");
  btn.disabled = true;
  const addIfMissing = async (path, value) => {
    if ((await get(ref(db, path))).exists()) return;
    await set(ref(db, path), value);
  };
  /** Comptines du blind test : fabriquées ici, rangées une seule fois dans la bibliothèque. */
  const addTunes = async (now) => {
    const ids = [];
    for (const tune of FULL_TUNES) {
      const data = await encodeMp3(await synthTune(tune.melody, FULL_TUNE_SEC), 96);
      const id = await soundId(data);
      await addIfMissing(`library/sounds/${id}`, data);
      ids.push(id);
    }
    await addIfMissing(`library/playlists/${FULL_KEYS.playlist}`, { ...tunePlaylist(ids), createdAt: now, updatedAt: serverTimestamp() });
  };
  /** Quiz en images des petits : une photo dessinée par réponse, rangée une seule fois dans la bibliothèque. */
  const addImageQuiz = async (now) => {
    const ids = [];
    for (const q of FULL_CHOICE_PHOTOS) {
      const row = [];
      for (const c of q.choices) {
        const data = drawPhoto(c);
        const id = await imageId(data);
        await addIfMissing(`library/images/${id}`, data);
        row.push(id);
      }
      ids.push(row);
    }
    await addIfMissing(`library/quizzes/${FULL_KEYS.images}`, { ...imageQuiz(ids), createdAt: now, updatedAt: serverTimestamp() });
  };
  try {
    const existing = (await get(ref(db, `library/shows/${FULL_ID}`))).val();
    if (existing) {
      // Prestation de test d'une version précédente : on lui ajoute seulement les jeux qui lui manquent
      // (avant la Super Finale), sans rien retirer ni modifier d'autre.
      // L'ancienne manche « Super Finale » disparaît : les dernières questions du quiz comptent double à la place.
      const { rounds: anciennes, folded, converted } = foldLegacyFinale(existing.rounds);
      // Le quiz en images des petits devient un Quiz illustré, avec son écran d'ouverture.
      const illustre = anciennes.some((r) => (r.type ?? "quiz") === "quiz" && r.quizId === FULL_KEYS.images);
      const rounds = anciennes.map((r) => ((r.type ?? "quiz") === "quiz" && r.quizId === FULL_KEYS.images ? { ...r, type: "illustre" } : r));
      // Anciens noms des quiz de test (« Quiz illustré » ne désigne plus que le jeu des réponses en images).
      const renommer = [FULL_KEYS.quiz, FULL_KEYS.images].filter((k) => OLD_TEST_TITLES[quizzes[k]?.title]);
      const missing = FULL_NEW_ROUNDS.filter((m) => !rounds.some((r) => r.type === m.type && (!m.quizId || r.quizId === m.quizId)));
      if (existing.origin !== "test" || (!missing.length && !folded && !converted && !illustre && !renommer.length)) {
        status("test-full-status", "Elle existe déjà : retrouvez-la dans les listes de l'Accueil (rien n'a été modifié).", true);
        return;
      }
      status("test-full-status", "Ajout des nouveaux jeux à la prestation de test…", true);
      for (const k of renommer) await update(ref(db, `library/quizzes/${k}`), { title: OLD_TEST_TITLES[quizzes[k].title], updatedAt: serverTimestamp() });
      if (missing.some((m) => m.playlistId)) await addTunes(Date.now());
      if (missing.some((m) => m.quizId === FULL_KEYS.images)) await addImageQuiz(Date.now());
      // Les coffres mystères restent le jeu final : tout à la fin.
      const last = missing.filter((m) => m.type === "coffres");
      const middle = missing.filter((m) => m.type !== "coffres");
      // Coffres mystères déjà là (anciennes Portes mystères comprises) : les nouveaux jeux passent juste avant eux.
      const at = rounds.findIndex((r) => r.type === "coffres");
      const next = [...(at < 0 ? [...rounds, ...middle] : [...rounds.slice(0, at), ...middle, ...rounds.slice(at)]), ...last];
      await set(ref(db, `library/shows/${FULL_ID}`), { ...existing, rounds: next, notes: FULL_SHOW.notes, updatedAt: serverTimestamp() });
      const added = missing.map((m) => ROUND_TYPES[m.type]).join(", ");
      status("test-full-status", `Mise à jour de « ANNIVERSAIRE TEST – Léa, 9 ans · tous les jeux » :${added ? ` ${added} ajouté(s).` : ""}${folded ? " L'ancienne manche « Super Finale » est retirée : les 3 dernières questions du quiz comptent double." : ""}${converted ? " Les Portes mystères deviennent les Coffres mystères." : ""}${illustre ? " Le quiz en images des petits devient un Quiz illustré." : ""}${renommer.length ? " Quiz de test renommés : « TEST – Quiz classique de Léa » et « TEST – Quiz illustré des petits »." : ""} Rechargez la prestation dans la régie.`, true);
      return;
    }
    status("test-full-status", "Préparation des photos, des musiques et des jeux…", true);
    const now = Date.now();
    await addTunes(now);
    await addImageQuiz(now);
    for (const kind of ["zoom", "flou"]) {
      const ids = [];
      for (const photo of FULL_PHOTOS[kind]) {
        const data = drawPhoto(photo);
        const id = await imageId(data);
        await addIfMissing(`library/images/${id}`, data);
        ids.push(id);
      }
      await addIfMissing(`library/quizzes/${FULL_KEYS[kind]}`, { ...photoQuiz(kind, ids), createdAt: now, updatedAt: serverTimestamp() });
    }
    for (const [id, quiz] of Object.entries(FULL_QUIZZES)) {
      await addIfMissing(`library/quizzes/${id}`, { ...quiz, createdAt: now, updatedAt: serverTimestamp() });
    }
    await addIfMissing(`library/mimes/${FULL_KEYS.mimes}`, { ...FULL_MIMES, createdAt: now, updatedAt: serverTimestamp() });
    await set(ref(db, `library/shows/${FULL_ID}`), { ...FULL_SHOW, createdAt: now, updatedAt: serverTimestamp() });
    status("test-full-status", "Ajoutée : « ANNIVERSAIRE TEST – Léa, 9 ans · tous les jeux » est dans « À venir » et sur la régie.", true);
  } catch (err) {
    console.error(err);
    status("test-full-status", "Échec de l'ajout. Vérifiez la connexion puis réessayez.");
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
    boutonEcoute({ class: "btn secondary icon-ecoute", title: "Écouter l'extrait", text: "▶" }, (b) => listen({ audioId: x.audioId, title: x.title }, false, b)),
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
function fenetreParoles({ titre = "", fermer = null } = {}) {
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
      defile.replaceChildren(...(lignes.length ? lignes.map((x) => h("p", { class: "paroles-ligne" },
        h("span", { class: "paroles-temps", text: mmss(x.t) }),
        h("span", { class: `paroles-texte${x.text ? "" : " vide"}`, text: x.text || "♪" })))
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
 * ou « ▶ Refrain » d'une chanson qui a ses paroles, et se ferme quand l'écoute s'arrête.
 */
function parolesFlottantes(x) {
  if (!x.lrc || !x.id) return null;
  const f = fenetreParoles({ titre: x.title, fermer: () => stopPreview() });
  f.el.classList.add("flottante");
  f.remplir([]);
  const { montrer, arreter } = f;
  // Cachée tant que la liste des sons n'est pas à l'écran (réglages ouverts pendant l'écoute).
  f.montrer = (s) => { f.el.hidden = $("song-list").offsetParent === null; montrer(s); };
  f.arreter = () => { arreter(); f.el.remove(); };
  document.body.append(f.el);
  get(ref(db, `library/lyrics/${x.id}`))
    .then((snap) => typeof snap.val() === "string" ? lireLrc(snap.val()) : [])
    .catch(() => [])
    .then((l) => { if (f.el.isConnected) f.remplir(l, "Paroles introuvables."); });
  return f;
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
        boutonEcoute({ class: "icon", title: "Écouter l'extrait", text: "▶" }, (b) => listen(t, false, b)),
        statues ? null : boutonEcoute({ class: "icon", title: "Écouter le hook", text: "🎤" }, (b) => listen(t, true, b)),
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
  const paroles = t.lrc ? fenetreParoles() : null;
  parolesReglage = paroles;
  const reperer = (v) => { if (paroles && preview?.paroles !== paroles) paroles.montrer(v, false); };
  // Lâcher un curseur joue la chanson à cet endroit, et son « ▶ Écouter » devient « ⏸ Pause ».
  const ecouter = (refrain) => boutonEcoute({ class: "btn small secondary", title: refrain ? "Écouter le hook" : "Écouter à partir du début", text: "▶ Écouter" }, (b) => listen(t, refrain, b, paroles));
  const ecouteDebut = ecouter(false);
  const ecouteHook = ecouter(true);
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
      curseur("Début de la chanson", t.start, maxDebut, (v) => { t.start = v; t.debutMain = true; aRedecouper(t); tempsDebut.textContent = mmss(v); reperer(v); }, () => listen(t, false, ecouteDebut, paroles)),
      bornes(maxDebut),
      h("p", { class: "hint small", text: "Réglé d'office 2 s avant les premiers mots chantés (0:00 sans paroles)." })),
    h("div", { class: "reglage-curseur", "data-curseur": "hook" },
      h("div", { class: "reglage-ligne" }, h("span", { class: "reglage-nom", text: "Hook" }), tempsHook, origine, ecouteHook,
        h("button", {
          type: "button", class: "btn small secondary", disabled: !fichier, onclick: () => reidentifierHook(t), text: "↺ Réidentifier le hook",
          title: "Retrouver le refrain : le passage le plus chanté des paroles, là où la musique devient forte",
        })),
      curseur("Hook", t.refrain, maxHook, (v) => { t.refrain = v; t.regle = true; aRedecouper(t); tempsHook.textContent = mmss(v); origine.textContent = "réglé à la main"; reperer(v); }, () => listen(t, true, ecouteHook, paroles)),
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
    if (typeof texte === "string") { t.lignes = lireLrc(texte); t.lrcTexte = texte; }
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
const NOUVELLE_CAT = "＋ Nouvelle catégorie…";
const AUCUNE_POCHETTE = "Aucune pochette pour l'instant : elles arrivent toutes seules avec les chansons (Bibliothèque › 🎵 Sons).";

function openLibrary(tab) {
  libTab = tab;
  show("library");
}
$("music-songs").onclick = () => openLibrary("sons");
document.querySelectorAll("#library-tabs [data-lib-tab]").forEach((b) => { b.onclick = () => { libTab = b.dataset.libTab; renderLibrary(true); }; });

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
  if (libTab === "sons") renderSongs();
  else if (libTab === "questions") renderQuestions();
  else renderMedias(force);
}

// ---------- Bibliothèque › Questions (cedric, 22/10) ----------

/** Groupe ouvert : null (tous en aperçu) ou une clé de GROUPES_QUESTIONS ; pack ouvert ; famille ou thème choisi. */
let qGroupe = null;
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
/** Ses questions cochées (clés « quiz/numéro »), à supprimer ensemble ; celles de la liste affichée. */
const qSelection = new Set();
let qListees = [];
const QUESTIONS_APERCU = 4;
const QUESTIONS_MAX = 300;
const EXEMPLE_PACK = {
  packs: [{
    title: "Les animaux de la savane", theme: "Animaux",
    questions: [
      { text: "Quel animal a une très longue trompe ?", choices: ["Éléphant", "Girafe", "Lion", "Zèbre"], correct: 0, illustration: "🐘" },
      { text: "Quel animal est le roi de la savane ?", choices: ["Hippopotame", "Lion", "Gazelle", "Autruche"], correct: 1, illustration: "lion.png" },
      { text: "Combien de pattes a une girafe ?", correct: 4, illustration: "🦒" },
    ],
  }],
};
$("pack-exemple").textContent = JSON.stringify(EXEMPLE_PACK, null, 2);

function groupesQuestions() {
  illustreesCache ??= questionsIllustreesPretes();
  return { classiques: classiquesPretes, illustrees: illustreesCache, miennes: mesQuestions(quizzes), packs: mesPacks(quizzes), tests: questionsDeTest(quizzes) };
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
        h("span", { class: "hint small", text: x.source ?? "" }),
        quiz ? h("button", { type: "button", class: "btn small secondary", text: "Éditer", onclick: () => review(x.quizId, quiz) }) : null,
        quiz ? h("button", { type: "button", class: "btn small danger", text: "Supprimer", onclick: () => supprimerQuestions([x]) }) : null)));
}

/** Ses questions, toutes (en vrac, dans les packs, de test) : pour retrouver celles qui sont cochées. */
const toutesMesQuestions = () => [...mesQuestions(quizzes), ...mesPacks(quizzes).flatMap((p) => p.questions), ...questionsDeTest(quizzes)];

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

function cartePack(p) {
  return h("div", { class: `item pack${packsNouveaux.has(p.id) ? " copie-recente" : ""}`, "data-pack": p.id },
    h("span", { class: "pill", text: QUIZ_KINDS[p.kind] ?? "📝 Quiz classique" }),
    h("b", { text: p.title }),
    h("span", { text: [p.theme, SOURCES[p.source] ?? ""].filter(Boolean).join(" · ") }),
    h("span", { text: `${plural(p.total, "question")} · ${p.validees} validée${p.validees > 1 ? "s" : ""}` }),
    p.sansIllustration ? h("span", { class: "q-alerte", text: `⚠ ${p.sansIllustration} sans illustration` }) : h("span", { class: "ok", text: "✓ Toutes illustrées" }),
    h("div", { class: "row" },
      h("button", { class: "btn", type: "button", text: "Ouvrir", onclick: () => { qPack = p.id; qSelection.clear(); status("q-status", ""); renderQuestions(); } }),
      h("button", { class: "btn secondary", type: "button", text: "Éditer", onclick: () => review(p.id, quizzes[p.id]) }),
      h("button", { class: "btn secondary", type: "button", text: "Renommer", onclick: () => rename(`library/quizzes/${p.id}`, p.title, "du pack") }),
      h("button", { class: "btn danger", type: "button", text: "Supprimer", onclick: () => deleteQuiz(p.id, quizzes[p.id]) })));
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
  const packsTrouves = recherche ? g.packs.filter((p) => questionCorrespond({ text: p.title, categorie: p.theme }, recherche) || p.questions.some((x) => questionCorrespond(x, recherche))) : g.packs;
  const compte = Object.fromEntries(Object.keys(GROUPES_QUESTIONS).map((k) => [k, k === "packs" ? packsTrouves.reduce((n, p) => n + p.total, 0) : filtre(g[k]).length]));
  // « 🧪 Questions de test » n'apparaît que s'il y a une prestation de test dans la bibliothèque.
  const groupes = Object.entries(GROUPES_QUESTIONS).filter(([k]) => k !== "tests" || g.tests.length);
  if (qGroupe === "tests" && !g.tests.length) qGroupe = null;
  if (qPack && !quizzes[qPack]) qPack = null;
  const chip = (key, label, n) => h("button", {
    type: "button", class: `chip${qGroupe === key ? " active" : ""}`, "data-groupe": key ?? "tout", text: `${label} (${n})`,
    onclick: () => { qGroupe = key; qPack = null; qCategorie = null; qType = null; qNiveau = null; qSelection.clear(); status("q-status", ""); renderQuestions(); },
  });
  const total = Object.values(compte).reduce((a, b) => a + b, 0);
  $("q-groups").replaceChildren(chip(null, "Tout", total), ...groupes.map(([k, label]) => chip(k, label, compte[k])));
  $("q-count").textContent = recherche ? plural(total, "question trouvée", "questions trouvées") : "";
  $("pack-import").hidden = qGroupe !== "packs" || !!qPack;
  const box = $("q-list");
  const plusQue = (n) => (n > QUESTIONS_MAX ? h("p", { class: "hint small", text: `… et ${n - QUESTIONS_MAX} autres : précisez la recherche.` }) : null);

  // Un pack ouvert : ses questions, chacune avec son illustration ou l'alerte.
  if (qPack) {
    const p = g.packs.find((x) => x.id === qPack);
    const liste = filtre(p.questions);
    qListees = liste;
    box.replaceChildren(
      h("div", { class: "title-row" },
        h("button", { type: "button", class: "btn secondary", text: "← Tous les packs", onclick: () => { qPack = null; qSelection.clear(); renderQuestions(); } }),
        h("button", { type: "button", class: "btn secondary", text: "Éditer le pack", onclick: () => review(p.id, quizzes[p.id]) })),
      h("h2", { text: p.title }),
      h("p", { class: "hint", text: [p.theme, plural(p.total, "question"), p.sansIllustration ? `⚠ ${p.sansIllustration} sans illustration` : "✓ toutes illustrées"].filter(Boolean).join(" · ") }),
      liste.length ? h("div", { class: "q-liste" }, ...liste.map(ligneQuestion)) : h("p", { class: "hint", text: "Aucune question ne correspond à cette recherche." }));
    return;
  }

  // Aperçu : les groupes l'un sous l'autre, quelques questions (ou packs) chacun.
  if (!qGroupe) {
    box.replaceChildren(...groupes.map(([k, label]) => {
      const voir = h("button", { type: "button", class: "btn small secondary", text: "Voir tout", onclick: () => { qGroupe = k; renderQuestions(); } });
      const contenu = k === "packs"
        ? (packsTrouves.length ? h("div", { class: "cards" }, ...packsTrouves.slice(0, QUESTIONS_APERCU).map(cartePack))
          : h("p", { class: "hint small", text: recherche ? "Rien ici pour cette recherche." : "Aucun pack pour l'instant : « Voir tout », puis « 📥 Importer des packs JSON… »." }))
        : (filtre(g[k]).length ? h("div", { class: "q-liste" }, ...filtre(g[k]).slice(0, QUESTIONS_APERCU).map(ligneQuestion))
          : h("p", { class: "hint small", text: recherche ? "Rien ici pour cette recherche." : k === "miennes" ? "Aucune question écrite à la main pour l'instant." : "" }));
      return h("section", { class: "q-groupe", "data-groupe": k }, h("div", { class: "title-row" }, h("h2", { text: label }), voir), contenu);
    }));
    return;
  }

  // Mes packs par thème : un titre par thème (« Disney », « Musique »…), ses packs dessous.
  if (qGroupe === "packs") {
    box.replaceChildren(packsTrouves.length
      ? h("div", { class: "q-themes" }, ...packsParTheme(packsTrouves).map(([theme, packs]) => h("section", { class: "q-theme", "data-theme": theme },
        h("h3", { text: `${theme} · ${plural(packs.length, "pack")}` }),
        h("div", { class: "cards" }, ...packs.map(cartePack)))))
      : h("p", { class: "hint", text: recherche ? "Aucun pack ne correspond à cette recherche." : "Aucun pack pour l'instant : importez votre premier fichier JSON." }));
    return;
  }

  // Toutes prêtes (par thème ou par famille), en vrac ou de test (par thème) : une puce par famille ou par thème, puis la liste.
  // Quiz classique : une puce pour les questions à 4 réponses, une pour les Juste Chiffre (cedric, 22/10).
  const tousTypes = filtre(g[qGroupe]);
  const types = qGroupe === "classiques" ? { qcm: ["❓ Questions à 4 réponses", (x) => !x.nombre], nombre: ["🔢 Juste Chiffre", (x) => x.nombre] } : {};
  if (!types[qType]) qType = null;
  const duType = qType ? tousTypes.filter(types[qType][1]) : tousTypes;
  // Quiz classique : trois niveaux sans chevauchement (cedric, 22/10), Facile, Moyen et Difficile.
  if (qGroupe !== "classiques") qNiveau = null;
  const tout = qNiveau ? duType.filter((x) => x.niveau === qNiveau) : duType;
  const categories = [...new Set(tout.map((x) => x.categorie).filter(Boolean))];
  if (qCategorie && !categories.includes(qCategorie)) qCategorie = null;
  const liste = qCategorie ? tout.filter((x) => x.categorie === qCategorie) : tout;
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
    qGroupe === "classiques" ? h("div", { class: "chips q-niveaux" },
      h("button", { type: "button", class: `chip${qNiveau ? "" : " active"}`, "data-niveau": "tous", text: `Tous les niveaux (${duType.length})`, onclick: () => { qNiveau = null; renderQuestions(); } }),
      ...Object.keys(NIVEAUX_CHIFFRES).map(Number).map((n) => h("button", {
        type: "button", class: `chip${qNiveau === n ? " active" : ""}`, "data-niveau": n, text: `${libelleNiveau(n)} (${duType.filter((x) => x.niveau === n).length})`,
        onclick: () => { qNiveau = n; renderQuestions(); },
      }))) : null,
    qGroupe === "illustrees" ? h("p", { class: "hint small", text: "Quiz illustré des tout-petits : une image par réponse. Une réponse sans photo reçoit l'émoji de son mot, dessiné en image. Pour en mettre dans un quiz illustré : « Éditer », puis « 🎲 Questions de la banque »." }) : null,
    qGroupe === "tests" ? h("p", { class: "hint small", text: "Les questions des prestations de test (Paramètres) : rangées ici pour ne pas se mélanger aux vôtres." }) : null,
    categories.length > 1 ? h("div", { class: "chips q-categories" },
      h("button", { type: "button", class: `chip${qCategorie ? "" : " active"}`, text: `Toutes (${tout.length})`, onclick: () => { qCategorie = null; renderQuestions(); } }),
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
 * « 📥 Importer des packs JSON… » : chaque pack devient un quiz de la bibliothèque (source « fichier »), jouable dans
 * le Quiz comme les autres. Les images déposées avec le fichier rejoignent les questions qui les nomment. Une question
 * sans défaut est validée d'office ; les autres restent « À valider », à corriger dans « Éditer ».
 */
$("pack-file").onchange = async () => {
  const fichiers = [...$("pack-file").files];
  $("pack-file").value = "";
  const images = new Map();
  const jsons = [];
  for (const f of fichiers) {
    if (f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.name)) images.set(imageKey(f.name), f);
    else jsons.push(f);
  }
  status("q-status", "");
  if (!jsons.length) return status("pack-status", "Choisissez au moins un fichier JSON (avec ses images s'il en a).");
  const erreurs = [];
  const packs = [];
  for (const f of jsons) {
    const lu = lirePacks(await f.text());
    if (lu.erreur) erreurs.push(`${f.name} : ${lu.erreur}`);
    else lu.packs.forEach((p) => packs.push({ ...p, fichier: f.name.replace(/\.json$/i, "") }));
  }
  if (!packs.length) return status("pack-status", erreurs.join(" "));
  const faits = [];
  let questionsFaites = 0, aValider = 0, sansIllus = 0, ignorees = 0;
  try {
    for (const p of packs) {
      await attachImportImages(p.questions, images, "pack-status");
      const verifs = checkQuestions(p.questions);
      const gardees = p.questions.map((q, i) => ({ q, ok: !verifs[i].errors.length })).filter(({ q }) => q.kind === "number" || q.choices.length);
      ignorees += p.questions.length - gardees.length;
      if (!gardees.length) continue;
      // Une photo par case A à D au plus (la base n'en garde pas d'autres).
      gardees.forEach(({ q }) => { if (q.choiceImages) q.choiceImages = q.choiceImages.slice(0, 4); });
      const kind = gardees.some(({ q }) => (q.choiceImages ?? []).some(Boolean)) ? "photo" : "classique";
      const questions = gardees.map(({ q, ok }) => ({
        text: q.text.slice(0, 300), choices: q.kind === "number" ? null : q.choices,
        correct: Number.isInteger(q.correct) ? q.correct : -1, kind: q.kind === "number" ? "number" : null,
        duration: dureeQuestion(q.duration), double: q.double === true, status: ok ? "validee" : "brouillon",
        image: cleanEmoji(q.image) || null, imageId: q.imageId || null, choiceImages: q.kind === "number" ? null : savedChoiceImages(q),
      }));
      const id = push(ref(db, "library/quizzes")).key;
      const title = (p.title || p.theme || p.fichier || "Pack sans titre").slice(0, 120);
      await set(ref(db, `library/quizzes/${id}`), {
        title, theme: p.theme || null, ageMin: p.ageMin ?? null, ageMax: p.ageMax ?? null, source: "json", kind,
        createdAt: Date.now(), updatedAt: serverTimestamp(), questions,
      });
      faits.push(id);
      questionsFaites += questions.length;
      aValider += questions.filter((q) => q.status !== "validee").length;
      sansIllus += questions.filter((q) => !illustration(q, kind).ok).length;
    }
  } catch (err) {
    console.error(err);
    erreurs.push("Import interrompu : vérifiez Internet ou reconnectez-vous, puis recommencez avec les packs manquants.");
  }
  packsNouveaux = new Set(faits);
  setTimeout(() => { packsNouveaux = new Set(); if (libTab === "questions" && !$("screen-library").hidden) renderQuestions(); }, 6000);
  qGroupe = "packs";
  qPack = null;
  renderQuestions();
  const bilan = faits.length
    ? [`${plural(faits.length, "pack importé", "packs importés")} : ${plural(questionsFaites, "question")}`,
      aValider ? `${aValider} à valider dans « Éditer »` : null, sansIllus ? `⚠ ${sansIllus} sans illustration` : null,
      ignorees ? `${ignorees} ignorée${ignorees > 1 ? "s" : ""} (sans réponses)` : null].filter(Boolean).join(", ") + "."
    : "Aucun pack importé.";
  status("pack-status", [bilan, ...erreurs].join(" "), faits.length > 0 && !erreurs.length);
};

/** Les groupes d'images ; ses images et les pochettes retirées à part ([RETIREES] : par groupe). */
function groupesImages() {
  const utilisees = imagesUtilisees({ quizzes, mimes, contents, songs, playlists });
  const couvertures = pochettesUtilisees({ songs, playlists });
  const miennes = mesImages(medias, utilisees, couvertures);
  const pochettes = mesPochettes(medias, couvertures, utilisees);
  return {
    emojis: emojisBibliotheque(), photos: photosLibres(),
    miennes: miennes.filter((x) => !x.retiree), pochettes: pochettes.filter((x) => !x.retiree),
    [RETIREES]: { miennes: miennes.filter((x) => x.retiree), pochettes: pochettes.filter((x) => x.retiree) },
  };
}

/** Image déjà rangée dans la base (une des siennes, une pochette) : choisie telle quelle, sans nouvelle copie. */
const dansLaBase = (x) => x.groupe === "miennes" || x.groupe === "pochettes";

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
    onclick: () => { mediaGroupe = key; mediaCat = null; renderMedias(true); },
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
      const voir = h("button", { type: "button", class: "btn small secondary", text: recherche ? `Voir les ${plural(list.length, "résultat")}` : `Tout voir (${list.length})`, onclick: () => { mediaGroupe = k; mediaCat = null; renderMedias(true); } });
      return h("section", { class: "media-group", "data-groupe": k },
        h("div", { class: "title-row" }, h("h2", { text: label }), list.length ? voir : null,
          k === "miennes" && !recherche ? h("button", { type: "button", class: "btn small", text: "＋ Ajouter mes images", onclick: () => { mediaGroupe = "miennes"; mediaCat = null; renderMedias(true); } }) : null),
        list.length ? h("div", { class: "media-grid" }, ...list.slice(0, APERCU).map((x, i, l) => vignetteMedia(x, i, l)))
          : h("p", { class: "hint small", text: recherche ? "Rien ici pour cette recherche." : k === "miennes" ? "Aucune image à vous pour l'instant : « ＋ Ajouter mes images »." : k === "pochettes" ? AUCUNE_POCHETTE : "" }));
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
    box.replaceChildren(h("p", { class: "hint", text: recherche ? "Aucune image ne correspond à cette recherche." : mediaGroupe === "miennes" ? "Aucune image à vous pour l'instant : ajoutez-en avec « Choisir des images sur le PC… »." : mediaGroupe === "pochettes" ? AUCUNE_POCHETTE : "Aucune image." }));
    return;
  }
  const fiches = mediaGroupe === "miennes" || mediaGroupe === "pochettes";
  const montrees = fiches ? list.slice(0, MAX_FICHES) : list;
  const parCat = mediaCat ? [[mediaCat === RETIREES ? "🚫 Retirées" : mediaCat, montrees]] : categoriesDe(montrees).map((c) => [c, montrees.filter((x) => x.cat === c)]);
  box.replaceChildren(...parCat.flatMap(([c, items]) => [
    h("h3", { class: "content-series", text: `${c} · ${items.length}` }),
    fiches ? h("div", { class: "media-cards" }, ...items.map((x, i) => ficheMedia(x, g.miennes.concat(g[RETIREES].miennes), items, i)))
      : h("div", { class: "media-grid" }, ...items.map((x, i) => vignetteMedia(x, i, items))),
  ]));
  if (list.length > montrees.length) box.append(h("p", { class: "hint small", text: `… et ${list.length - montrees.length} autres : précisez la recherche.` }));
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
  $("vis-details").textContent = [GROUPES_IMAGES[x.groupe], x.cat, ...(x.tags ?? [])].filter(Boolean).join(" · ");
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
  mediaGroupe = x.groupe;
  mediaCat = x.groupe === "miennes" ? x.cat : null;
  renderMedias(true);
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
  const enregistrer = async (champs, message) => {
    const f = ficheImage({ nom: x.nom, cat: x.cat, tags: x.tags, retiree: x.retiree, ...champs }, medias[x.id]);
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
  const cat = pochette ? null : h("select", {
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
  const ici = pochette ? "les pochettes" : "vos images";
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
 */
function choisirDansBibliotheque({ titre, groupes = Object.keys(GROUPES_IMAGES), recherche = "" }) {
  return new Promise((resolve) => {
    const g = groupesImages();
    let groupe = null;
    const champ = h("input", { type: "search", class: "choix-recherche", value: recherche, placeholder: "Rechercher : nom, catégorie, mot-clé…", "aria-label": "Rechercher une image", autocomplete: "off" });
    const puces = h("div", { class: "chips media-cats" });
    const grille = h("div", { class: "media-grid choix-grille" });
    const fermer = (x) => { voile.remove(); resolve(x); };
    const dessiner = () => {
      const q = champ.value.trim();
      const listes = Object.fromEntries(groupes.map((k) => [k, g[k].filter((x) => correspond(x, q))]));
      const n = (k) => (k ? listes[k].length : groupes.reduce((t, x) => t + listes[x].length, 0));
      puces.replaceChildren(...[null, ...groupes].map((k) => h("button", {
        type: "button", class: `chip${groupe === k ? " active" : ""}`, "data-groupe": k ?? "tout", text: `${k ? GROUPES_IMAGES[k] : "Tout"} (${n(k)})`,
        onclick: () => { groupe = k; dessiner(); },
      })));
      // Les meilleurs résultats d'abord ; à égalité, ses images avant les autres (on y cherche un personnage, un film).
      const items = parPertinence(groupe ? listes[groupe] : [...groupes].sort((a, b) => (b === "miennes") - (a === "miennes")).flatMap((k) => listes[k]), q, nomMedia, autresMedia).slice(0, 120);
      grille.replaceChildren(...items.map((x) => h("button", { type: "button", class: "media-tile", "data-media": x.id, title: [x.cat, ...(x.tags ?? [])].filter(Boolean).join(" · "), onclick: () => fermer(x) },
        ...imageDeMedia(x), h("span", { text: x.nom || "Sans nom" }))));
      if (!items.length) grille.append(h("p", { class: "hint", text: q ? "Aucune image pour cette recherche : essayez un autre mot." : "Aucune image." }));
    };
    champ.oninput = dessiner;
    // Rien pour le mot proposé : on montre toutes les images plutôt qu'une fenêtre vide.
    if (recherche && !groupes.some((k) => g[k].some((x) => correspond(x, recherche)))) champ.value = "";
    const voile = h("div", {
      class: "cadre-voile choix-voile", onclick: (e) => { if (e.target === voile) fermer(null); },
      onkeydown: (e) => { if (e.key === "Escape") fermer(null); },
    }, h("div", { class: "cadre-boite choix-boite", role: "dialog", "aria-label": titre },
      h("p", { class: "label", text: `🖼️ ${titre}` }),
      h("p", { class: "hint small", text: "Cherchez par nom, catégorie ou mot-clé ; un clic choisit l'image. Vos images se rangent dans Bibliothèque › Images." }),
      champ, puces, grille,
      h("div", { class: "row" }, h("button", { type: "button", class: "btn secondary", text: "Annuler", onclick: () => fermer(null) }))));
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
    { type: "quiz", icon: "?", rule: "Questions à 2, 3 ou 4 réponses écrites sur les pupitres ; toutes les équipes qui trouvent marquent. Une question peut aussi être un « Juste Chiffre » (réponse en nombre) et montrer une petite photo à la révélation. Super Finale : dans la prestation, les dernières questions du quiz peuvent compter ×2, ×3 ou ×5 (choisi en direct sur la régie).",
      status: () => quizTileLine(quizQuestions), },
    { type: "illustre", icon: "📷", rule: "Pour les petits, dès 5 ans : l'animatrice lit la question, chaque réponse est une photo avec son mot, sur la TV et les tablettes. Toutes les équipes qui trouvent marquent, comme au Quiz. Les questions se piochent dans la banque des tout-petits (388 mots en photos) ou se font à la main.",
      status: () => quizTileLine(illustreQuestions), },
    { type: "mimes", icon: "🎭", rule: "Équipe par équipe : un enfant devine, ses coéquipiers miment l'image. 50 points par mime trouvé.",
      status: () => `${plural(Object.keys(mimes).length, "collection perso", "collections perso")} · ${plural(mancheGroups(manches, "mimes").pinned.length + mancheGroups(manches, "mimes").active.length, "manche")}`, },
    { type: "blind", icon: "🎵", rule: "Les morceaux d'une playlist, dans l'ordre : le premier qui buzze donne le titre à voix haute, vous validez.",
      status: () => plural(Object.values(playlists).filter((p) => !isStatuesList(p)).length, "playlist"), },
    { type: "musical", icon: "🎶", rule: "Un extrait d'une playlist et 4 titres sur les pupitres ; même playlist que le blind test.",
      status: () => plural(Object.values(playlists).filter((p) => !isStatuesList(p) && playableTracks(p).length >= 2).length, "playlist utilisable", "playlists utilisables"), },
    { type: "statues", icon: "🗿", rule: "Vos chansons jouent sur la TV et s'arrêtent par moments : tout le monde se fige ! Vous désignez l'équipe gagnante depuis la régie. Dans la prestation : la durée et les chansons cochées (aucune : la musique de la fête).",
      status: () => plural(statuesChoices(playlists).length, "chanson disponible", "chansons disponibles"), },
  ] },
  { title: "Tirés d'un quiz", hint: "Rien de plus à préparer : ces jeux reprennent les questions d'un quiz de la bibliothèque. Dans la prestation, choisissez le quiz et combien de questions.", games: [
    { type: "express", icon: "✔", rule: "Les questions Vrai / Faux d'un quiz, au chrono court du profil.", needs: "Vrai / Faux validées" },
    { type: "zoom", icon: "🔍", rule: "Une photo d'un quiz ou de la banque se dévoile peu à peu.", needs: "photos" },
    { type: "flou", icon: "🌫", rule: "Une photo d'un quiz ou de la banque devient nette peu à peu, le premier qui buzze répond.", needs: "photos" },
  ] },
  { title: "Contenu intégré", hint: "Prêts à jouer : la manche tire au hasard dans un catalogue adapté à l'âge. Vous pouvez retirer des éléments et ajouter les vôtres.", games: [
    { type: "chante", icon: "🎤" }, { type: "quisuis", icon: "🕵" }, { type: "disparu", icon: "🎩" },
    { type: "pictionary", icon: "✏️", rule: `Équipe par équipe : vous montrez un mot sur la tablette de l'équipe, un enfant le dessine et le dessin s'affiche en direct sur la TV. ${PICTO_POINTS} points si son équipe trouve avant la fin du chrono. Le temps de dessin se choisit dans la prestation.` },
  ] },
  { title: "Sans contenu", hint: "Rien à préparer.", games: [
    { type: "coffres", icon: "🗝️", rule: "Une chance de se refaire… ou de dégringoler ! Chaque équipe à son tour ouvre un coffre sur sa tablette : bonus ou malus, tirés au sort à l'ouverture (l'équipe la plus en retard commence). Après quelques tours sans danger, une bombe se cache dans un des coffres, et un coffre en or qui rapporte 500 points : l'équipe qui ouvre la bombe perd 300 points (jamais sous 0) et le jeu s'arrête sur le bilan. Le classement s'affiche après chaque coffre. Personne ne connaît le contenu des coffres, régie comprise. Idéal en dernier jeu." },
    { type: "patate", icon: "💣", rule: "La bombe peut exploser à tout moment ! Elle passe d'équipe en équipe : sur sa tablette, l'équipe qui la tient choisit à qui l'envoyer (jamais tout de suite à l'équipe qui vient de l'envoyer, sauf à 2 équipes ; on ne peut la renvoyer que 2 secondes après l'avoir reçue). La mèche, tirée au sort, reste secrète : à chaque explosion, l'équipe qui tient la bombe perd 100 points (jamais sous 0), toutes les autres en gagnent 100. Trois bombes par partie : après chaque explosion, une nouvelle mèche s'allume." },
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
      custom ? h("button", {
        type: "button", class: "icon", title: "Supprimer cet ajout", text: "✕",
        onclick: async () => {
          if (!(await confirmer(`Supprimer « ${game.label(item)} » ?`, { ok: "Supprimer", danger: true }))) return;
          saveBuiltin(type, { off: off.filter((k) => k !== key), extra: extra.filter((x) => game.key(x) !== key) }, `« ${game.label(item)} » est supprimé.`);
        },
      }) : null);
  };
  const tiles = [...game.catalog.map((x) => [x, false]), ...extra.map((x) => [x, true])];
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
      ...[1, 2, 3, 4].map((n) => field(`Indice ${n}${n === 1 ? " (le plus difficile)" : n === 4 ? " (le plus facile)" : ""}`, `bi-clue${n}`, { wide: true, max: 120 })),
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
    : type === "quisuis" ? { answer: val("bi-answer"), emoji: val("bi-emoji"), clues: [1, 2, 3, 4].map((n) => val(`bi-clue${n}`)).filter(Boolean) }
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
  await saveBuiltin(type, { off, extra: [...extra, item] }, `« ${game.label(item)} » est ajouté au jeu.`);
  form.reset();
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
