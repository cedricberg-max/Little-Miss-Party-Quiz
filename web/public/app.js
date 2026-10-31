import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth, signInAnonymously, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, onValue, onDisconnect, serverTimestamp, connectDatabaseEmulator, goOffline, goOnline,
  forceLongPolling,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { CHOICE_COLORS, CHOICE_LETTERS, MAX_TEAMS, numeroTablette } from "./theme.js";
import { hasAccess, loginWithPassword, loginWithPin, startRegie } from "./regie.js";
import { watchVersion, showUpdateBanner } from "./version.js";
import { setAwake, isAwake, onAwakeChange } from "./awake.js";
import { envoyeurDessin } from "./picto.js";
import { creerArdoise, choisirMot } from "./ardoise.js";
import { mesurerHorloge, garder } from "./horloge.js";
import { animationSpectateurs } from "./spectateurs.js";
import { ecranCoffres, REVELATION_MS } from "./coffres.js";
import { ecranGonfleur, ENVOI_MS, plafond } from "./gonfleur.js";
import { ecranPatate } from "./patate.js";
import { ecranSimon, noteSimon } from "./simon.js";
import { afficherMotsDePasse } from "./oeil.js";
import { ouvrirScanner } from "./scanner.js";

// Petit œil sur les champs de mot de passe : voir ce qu'on tape (majuscules, caractère en trop).
afficherMotsDePasse();

const $ = (id) => document.getElementById(id);

// Ponctuation française : jamais un « ! », « ? » ou « : » tout seul au début d'une ligne (cedric, 25/10 : « Zoom
// mystère : regardez la TV » puis « ! » seul dessous). Les textes de la page s'écrivent avec une espace normale, rendue
// insécable à l'affichage, pour tous les textes à venir.
function rendreInsecables(noeud) {
  if (noeud.nodeType === Node.TEXT_NODE) {
    if (/ [!?:;»]|« /.test(noeud.nodeValue) && !noeud.parentElement?.closest("script, style, textarea")) {
      noeud.nodeValue = noeud.nodeValue.replace(/ ([!?:;»])/g, "\u00a0$1").replace(/« /g, "«\u00a0");
    }
    return;
  }
  if (noeud.nodeType !== Node.ELEMENT_NODE) return;
  const textes = document.createTreeWalker(noeud, NodeFilter.SHOW_TEXT);
  while (textes.nextNode()) rendreInsecables(textes.currentNode);
}
// Les écrans des équipes seulement : la régie du téléphone (même page) garde ses textes tels quels.
const insecables = new MutationObserver((changements) => {
  for (const c of changements) {
    if (c.type === "characterData") rendreInsecables(c.target);
    else c.addedNodes.forEach(rendreInsecables);
  }
});
for (const id of ["app", "paused", "resume-count"]) {
  rendreInsecables($(id));
  insecables.observe($(id), { childList: true, subtree: true, characterData: true });
}
/** Jeux au buzzer : un seul grand BUZZ, la réponse se donne à voix haute. */
const BUZZ_KINDS = ["flou", "chante", "quisuis", "blind", "disparu"];
const BUZZ_INVITE = {
  flou: "Image floue : buzzez dès que vous la reconnaissez !",
  chante: "À vos micros ! Buzzez et chantez une chanson avec ce mot !",
  quisuis: "Qui suis-je ? Écoutez les indices de la TV et buzzez dès que vous savez !",
  blind: "Blind test : écoutez la musique et buzzez dès que vous reconnaissez la chanson !",
  disparu: "Qui a disparu ? Buzzez dès que vous savez quel objet manque sur la TV !",
};
const params = new URLSearchParams(location.search);
const code = (params.get("g") || "").toUpperCase();
// QR « Reconnecter la régie » de la TV : la fenêtre du mot de passe s'ouvre d'elle-même.
const regieDirect = params.get("regie") === "1";
// QR « Reconnecter une tablette » de la TV : cette tablette reprend une équipe existante.
const takeover = params.get("reprise") === "1";
// Tests automatiques uniquement : l'émulateur Firebase n'est accepté que depuis l'ordinateur de test.
const emulator = params.has("emu") && ["localhost", "127.0.0.1"].includes(location.hostname);
// Design de la TV (menu Retour) : son QR code ajoute &look=gs ou &look=classique. Un lien sans ce réglage (QR de
// reconnexion de la régie téléphone, écran d'accueil du téléphone) garde le dernier design vu sur cet appareil.
let lookGs = (() => {
  try {
    if (params.has("look")) localStorage.setItem("lmp-look", params.get("look") === "gs" ? "gs" : "classique");
    return localStorage.getItem("lmp-look") === "gs";
  } catch {
    return params.get("look") === "gs";
  }
})();
const LOGO_CLASSIQUE = new Map([...document.querySelectorAll(".logo:not(.small)")].map((l) => [l, l.innerHTML]));
function appliquerLook() {
  document.body.classList.toggle("look-gs", lookGs);
  for (const [logo, classique] of LOGO_CLASSIQUE) {
    logo.innerHTML = lookGs ? '<span class="gs-the">THE</span><span class="gs-titre">GAME SHOW</span><span class="gs-by">by Little Miss Party</span>' : classique;
  }
}
appliquerLook();

/**
 * Le design suit celui de la TV de la partie (games/<code>/public/look), pas seulement le QR : un téléphone rouvert sur
 * un vieil onglet, sans « &look= », gardait l'ancien design (téléphone de Sacha, cedric 26/10). Écouteur à part, jamais
 * débranché par stopListening().
 */
function suivreLook() {
  onValue(ref(db, `games/${code}/public/look`), (s) => {
    const v = s.val();
    if (v !== "gs" && v !== "classique") return;
    try { localStorage.setItem("lmp-look", v); } catch { /* stockage refusé : le design suit quand même */ }
    if ((v === "gs") === lookGs) return;
    lookGs = v === "gs";
    appliquerLook();
    // Les mots de Daft Punk du buzz : chargés dès que la partie passe en Game Show.
    if (lookGs && teamId) {
      try {
        audio ??= new (window.AudioContext || window.webkitAudioContext)();
        chargerMotsEquipes();
      } catch { /* pas de son sur ce navigateur : le jeu continue */ }
    }
  });
}

let db, uid, gameRef;
/** Équipe jouée par cet appareil : la sienne, ou celle dont il remplace l'appareil. */
let teamId = null;
let presenceRef = null;
let audio;
let serverOffset = 0;
let rebuzzHandle = null;
let unsubscribers = [];
let game = { state: null, teams: {}, myAnswer: null, connected: true };
let answerUnsub = null;
let answerQid = null;
let timerHandle = null;
let lastScreen = null;
let pending = null;
let gameExists = false;

/**
 * Nouvelle version du site : le pupitre se recharge tout seul dès qu'il n'y a rien à perdre (jamais pendant une
 * question, une inscription ou une demande d'entrée) ; il retrouve son équipe et ses points. La régie, elle,
 * affiche un bandeau : l'animatrice choisit le moment.
 */
let newVersion = false;
const SAFE_TO_RELOAD = new Set(["gate", "play", "result", "ended", "error", "loading", "replaced", "watch", "affiche"]);
function maybeReload() {
  if (!newVersion) return;
  if (document.body.classList.contains("regie-mode") || !$("regie-login").hidden) {
    return showUpdateBanner("Nouvelle version de la régie en ligne : touchez « Mettre à jour » quand vous voulez (la partie continue).");
  }
  if (SAFE_TO_RELOAD.has(lastScreen)) location.reload();
}
watchVersion(() => { newVersion = true; maybeReload(); });

/** Écrans où l'équipe joue (salon compris) : la tablette reste allumée, même si personne ne la touche. */
const AWAKE_SCREENS = new Set(["waiting", "play", "question", "coffres", "gonfleur", "patate", "simon", "result", "pick", "draw", "watch"]);
/** Écrans où la partie est finie pour cet appareil : la veille normale d'Android reprend. */
const SLEEP_SCREENS = new Set(["gate", "ended", "replaced"]);

function show(name) {
  // « Accès régie » : avant d'entrer dans une équipe (et si la partie est complète), jamais pendant le jeu.
  // Sur l'écran d'avant la régie, c'est son grand bouton qui ouvre l'accès.
  $("regie-open").hidden = !(gameExists && (name === "waiting" || name === "error"));
  // Chargement ou erreur passagère (reconnexion) : on garde l'état d'avant, la tablette ne s'éteint pas pour si peu.
  if (!document.body.classList.contains("regie-mode")) {
    if (AWAKE_SCREENS.has(name)) setAwake(true);
    else if (SLEEP_SCREENS.has(name)) setAwake(false);
  }
  if (lastScreen === name) return;
  lastScreen = name;
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === `screen-${name}`));
  maybeReload();
}

/**
 * Écrans d'arrivée en Game Show (cedric, 31/10) : chaque cas normal (partie complète, pas de réseau, vieille partie,
 * pas encore entré) a sa petite scène en 3D avec Buzzy et des mots doux, jamais un écran d'erreur qui fait peur.
 * Le texte de [fail] reste celui du design classique.
 */
const ARRIVEES = {
  complet: { objet: "porte", buzzy: "pouces", couleur: "rose", titre: "On est déjà au complet\u00a0!", sous: `${MAX_TEAMS} équipes jouent déjà. Venez encourager les autres !` },
  reseau: { objet: "cable", buzzy: "applaudit", couleur: "cyan", titre: "Oups ! Plus de réseau…", sous: "Pas de panique : je reviens tout seul dès que le Wi-Fi revient.", reessayer: true },
  passe: { objet: "hier", buzzy: "applaudit", couleur: "jaune", titre: "Cette partie est déjà terminée\u00a0!", sous: "C'est du passé ! Scannez le QR code de la TV pour la nouvelle fête.", retourne: true },
  attente: { objet: "sablier", buzzy: "batterie", couleur: "rose", titre: "Ça n'a pas encore commencé\u00a0!", sous: "", reessayer: true },
};
let reseauRetour = null;
function fail(message, cas = null) {
  stopListening();
  clearInterval(reseauRetour);
  reseauRetour = null;
  const a = ARRIVEES[cas];
  const ecran = $("screen-error");
  ecran.dataset.cas = a ? cas : "";
  $("arrivee-scene").hidden = !a;
  $("arrivee-titre").hidden = !a;
  if (a) {
    $("arrivee-objet").src = `img/gs/arrivee/${a.objet}.webp`;
    $("arrivee-buzzy").src = `img/gs/buzzy-${a.buzzy}.webp`;
    $("arrivee-buzzy").classList.toggle("retourne", a.retourne === true);
    $("arrivee-titre").textContent = a.titre;
    $("arrivee-titre").className = `arrivee-titre ${a.couleur}`;
    ecran.classList.toggle("sans-reessayer", !a.reessayer);
  } else ecran.classList.remove("sans-reessayer");
  $("error-text").textContent = lookGs && a ? a.sous : message;
  $("error-text").hidden = lookGs && a && !a.sous;
  show("error");
  // Pas de réseau : la tablette réessaie toute seule dès que le Wi-Fi revient (et toutes les 10 s, au cas où).
  if (cas === "reseau") reseauRetour = setInterval(() => { if (lastScreen === "error" && navigator.onLine !== false) start(); }, 10000);
}
window.addEventListener("online", () => { if (lastScreen === "error" && $("screen-error").dataset.cas === "reseau") start(); });

function beep(freq = 880, ms = 180) {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    chargerMotsEquipes();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.25, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + ms / 1000);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + ms / 1000);
  } catch { /* son indisponible : on continue sans */ }
}

/** Demande de plein écran en cours : un même geste (toucher puis clic) ne la fait qu'une fois. */
let pleinEcranDemande = null;
/**
 * Pupitre installé comme une appli (Chrome ⋮ › « Ajouter à l'écran d'accueil », manifeste en plein écran) : il s'ouvre
 * déjà en plein écran et Android l'y garde au retour d'une autre appli. Le redemander ne ferait que ramener le bandeau
 * de Chrome en bas de l'écran à chaque toucher (cedric, 23/10). Lu au chargement, avant toute demande.
 */
const appliInstallee = window.matchMedia?.("(display-mode: fullscreen)").matches === true;
/** Plein écran au premier toucher (l'écran allumé, lui, suit l'état de la partie : voir show()). */
async function keepAwake() {
  if (appliInstallee || document.fullscreenElement || pleinEcranDemande) return;
  try {
    pleinEcranDemande = document.documentElement.requestFullscreen?.();
    await pleinEcranDemande;
  } catch { /* iPhone : Apple ne donne pas le plein écran à un site */ } finally { pleinEcranDemande = null; }
}
// Plein écran perdu (retour d'une autre appli, téléphone tourné, volet des notifications, page rechargée) : le
// navigateur ne le rend que sur un geste, alors chaque geste le redemande (cedric, 21/10) : un toucher n'importe où,
// même sur une réponse déjà verrouillée (elle ne fait pas de clic), un clic ou le gros buzzer USB. Pas pendant la
// frappe d'un nom (le clavier de l'écran se fermerait), ni sur Échap, qui sert justement à en sortir.
const redemanderPleinEcran = (e) => {
  // Son préparé avant le premier toucher (mots du Game Show) : le navigateur ne le laisse jouer qu'après un geste.
  if (audio?.state === "suspended") audio.resume().catch(() => {});
  if (!code || document.fullscreenElement) return;
  if (e.type === "keydown" && (e.key === "Escape" || enFrappe(e))) return;
  keepAwake();
};
for (const type of ["touchend", "click", "keydown"]) document.addEventListener(type, redemanderPleinEcran, true);

// Retour dans la page après un passage dans une autre appli (cedric, 21/10, iPhone de Sacha) : le téléphone a pu couper
// la connexion sans que la page le sache. Elle se croit connectée, ne reçoit plus rien et reste figée sur l'écran
// d'avant. On repart donc sur une connexion neuve : la page relit l'état de la partie, la réponse pas encore partie
// est renvoyée, et la présence se remet d'elle-même (« .info/connected »). Un coup d'œil de moins de 2 s ne compte pas.
const RECONNEXION_APRES_MS = 2000;
let cacheeDepuis = null;
function reconnecter() {
  if (!db) return;
  coupureVoulueJusqua = Date.now() + 1000;
  goOffline(db);
  goOnline(db);
}
// Retour sur la page : le toucher qui la ramène tombe sur une grande réponse (cedric, 25/10 : « réponse envoyée » au
// retour, sans avoir répondu). Une seconde sans réponse. Pas au passage en plein écran : il arrive au premier toucher
// d'un jeu, et les touches suivantes (Juste Chiffre) doivent passer tout de suite.
const REPONSES_BLOQUEES_MS = 1000;
let reponsesBloqueesJusqua = 0;
const bloquerReponses = () => { reponsesBloqueesJusqua = Date.now() + REPONSES_BLOQUEES_MS; };
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") bloquerReponses();
  if (document.visibilityState === "hidden") {
    cacheeDepuis = Date.now();
    return;
  }
  if (cacheeDepuis != null && Date.now() - cacheeDepuis >= RECONNEXION_APRES_MS) reconnecter();
  cacheeDepuis = null;
});
// Page gardée telle quelle par le navigateur puis rouverte (bouton retour) : même chose.
window.addEventListener("pageshow", (e) => { if (e.persisted) { bloquerReponses(); reconnecter(); } });

// Connexion de secours (cedric, 24/10 : iPhone 15 sous contrôle parental Qustodio, connecté quelques secondes puis coupé,
// sans fin, quand les autres téléphones tiennent). Ces filtres coupent la connexion continue (WebSocket). Après
// 3 coupures en une minute, page affichée, le pupitre passe aux requêtes successives (« long polling ») : un peu plus
// lentes, mais les filtres les laissent passer. Le choix reste 12 h sur l'appareil : rechargée, la page repart en secours.
const CLE_SECOURS = "lmp-connexion-simple";
const COUPURES_AVANT_SECOURS = 3;
const FENETRE_COUPURES_MS = 60_000;
const SECOURS_GARDE_MS = 12 * 3600_000;
let enSecours = false;
let coupures = [];
let coupureVoulueJusqua = 0;

function secoursRecent() {
  try {
    return Date.now() - Number(localStorage.getItem(CLE_SECOURS) ?? 0) < SECOURS_GARDE_MS;
  } catch {
    return false;
  }
}

function passerEnSecours(relancer) {
  if (enSecours) return;
  enSecours = true;
  forceLongPolling();
  try { localStorage.setItem(CLE_SECOURS, String(Date.now())); } catch { /* navigation privée : seulement pour cette page */ }
  if (relancer) reconnecter();
}

/** Compte les coupures subies (pas celles de reconnecter(), ni celles de la page cachée). */
function suivreCoupures() {
  let connecte = false;
  onValue(ref(db, ".info/connected"), (s) => {
    const maintenant = s.val() === true;
    const t = Date.now();
    if (connecte && !maintenant && document.visibilityState === "visible" && t > coupureVoulueJusqua) {
      coupures = [...coupures.filter((c) => t - c < FENETRE_COUPURES_MS), t];
      if (coupures.length >= COUPURES_AVANT_SECOURS) passerEnSecours(true);
    }
    connecte = maintenant;
  });
}

async function start() {
  show("loading");
  lastScreen = "loading";
  if (!code) return show("affiche");
  try {
    if (!db) {
      const config = await (await fetch("firebase-config.json", { cache: "no-store" })).json();
      const app = initializeApp(config);
      const auth = getAuth(app);
      if (secoursRecent()) passerEnSecours(false);
      db = getDatabase(app);
      if (emulator) {
        connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
        connectDatabaseEmulator(db, "127.0.0.1", 9000);
      }
      // L'identifiant anonyme est conservé par le navigateur : après un rechargement,
      // le pupitre retrouve automatiquement son équipe.
      uid = (await signInAnonymously(auth)).user.uid;
      suivreCoupures();
    }
    gameRef = ref(db, `games/${code}`);
    const host = await get(ref(db, `games/${code}/hostUid`));
    gameExists = host.exists();
    if (!host.exists()) return fail(`La partie ${code} n'existe pas ou est terminée.`, "passe");
    suivreLook();
    // Téléphone de l'animatrice déjà relié : retour direct à la régie (rechargement, écran verrouillé).
    if (await hasAccess({ db, uid }, code)) return enterRegie();
    const teams = (await get(ref(db, `games/${code}/teams`))).val() ?? {};
    const mine = myTeam(teams);
    if (mine && isReplaced(teams, mine)) return showReplaced(teams[mine]);
    if (mine) { teamId = mine; return play(); }
    // Partie commencée : un nouvel appareil n'entre que si la régie l'accepte (nouvelle équipe ou remplaçant).
    const phase = (await get(ref(db, `games/${code}/state/phase`))).val() ?? "lobby";
    if (phase === "ended") {
      if (suivreLaSuite((await get(ref(db, `games/${code}/state/suite`))).val())) return;
      return fail("Cette partie est terminée. Merci d'avoir joué !", "passe");
    }
    if (takeover && !regieDirect && Object.keys(teams).length) return showTakeover();
    if (phase === "lobby" && Object.keys(teams).length >= MAX_TEAMS) {
      fail(`La partie est complète (${MAX_TEAMS} équipes maximum).`, "complet");
    } else showGate();
    if (regieDirect) openRegieLogin();
  } catch (e) {
    console.error(e);
    fail("Connexion impossible. Vérifiez Internet puis réessayez.", "reseau");
  }
}

/**
 * Équipe de cet appareil : celle qui l'a désigné comme remplaçant, sinon celle qu'il a créée.
 * Une équipe dont l'appareil a été remplacé reste « à lui » pour afficher qu'il est désactivé.
 */
function myTeam(teams) {
  return Object.keys(teams).find((t) => teams[t]?.device === uid) ?? (teams[uid] ? uid : null);
}
const isReplaced = (teams, id) => !!teams[id] && (teams[id].device ?? id) !== uid;

/** Ancien appareil d'une équipe : définitivement désactivé, même s'il se reconnecte. */
function showReplaced(team) {
  stopListening();
  clearInterval(timerHandle);
  $("paused").hidden = true;
  $("resume-count").hidden = true;
  if (presenceRef) onDisconnect(presenceRef).cancel().catch(() => {});
  $("replaced-text").textContent = `L'équipe « ${team?.name ?? ""} » continue sur un autre appareil, avec tous ses points. Cet appareil ne joue plus.`;
  show("replaced");
}

/**
 * Entrée d'une tablette (cedric, 24/10) : elle ne tape ni ne choisit rien. Tant que l'animatrice n'a pas ouvert sa
 * régie, elle ne va pas plus loin que l'écran du code régie. Ensuite elle demande à entrer : l'animatrice l'accepte
 * sur son téléphone, lui donne son nom et sa couleur, ou la confie à une équipe existante.
 */
function showGate() {
  stopListening();
  ecouterBienvenue();
  listen(`games/${code}/state/suite`, (s) => { suivreLaSuite(s.val()); });
  let demande = false;
  listen(`games/${code}/regieActive`, (s) => {
    // QR « Reconnecter la régie » : ce téléphone est celui de l'animatrice, il ne demande jamais à entrer.
    if (s.val() !== true || regieDirect) return show("gate");
    if (demande) return;
    demande = true;
    // La régie vient d'être ouverte sur un autre téléphone : la fenêtre du code se referme, la tablette demande à entrer.
    if (!document.body.classList.contains("regie-mode")) $("regie-login").hidden = true;
    setTimeout(askToJoin, 0); // hors de l'écouteur en cours, qui sera débranché par waitForAdmission()
  });
}

/** Prestation chargée par la régie : les équipes sont accueillies avec le prénom de l'enfant fêté. */
function ecouterBienvenue() {
  listen(`games/${code}/public`, (s) => {
    const p = s.val();
    const texte = p?.childName ? `Joyeux anniversaire ${p.childName} !` : p?.title ?? "";
    for (const id of ["join-welcome", "waiting-welcome"]) {
      $(id).textContent = texte;
      $(id).hidden = !texte;
    }
  });
}

async function askToJoin() {
  try {
    await set(ref(db, `games/${code}/joinRequests/${uid}`), { at: serverTimestamp() });
    waitForAdmission();
  } catch (e) {
    console.error(e);
    fail("Impossible d'envoyer la demande. Vérifiez Internet puis réessayez.", "reseau");
  }
}

/** Choix de l'équipe à reprendre ; « C'est une nouvelle équipe » revient à l'inscription habituelle. */
function showTakeover() {
  stopListening();
  listen(`games/${code}/teams`, (s) => {
    const teams = Object.entries(s.val() ?? {}).sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));
    $("takeover-list").replaceChildren(...teams.map(([id, t]) => {
      const b = document.createElement("button");
      b.dataset.team = id;
      b.textContent = t.name ?? "Équipe";
      b.style.borderLeftColor = t.color ?? "#fff";
      b.onclick = () => askTakeover(id, t);
      return b;
    }));
  });
  $("takeover-new").onclick = showGate;
  show("takeover");
}

/** Demande de reprise : l'animatrice la confirme sur la TV (ou la régie), l'équipe garde tout. */
async function askTakeover(id, team) {
  $("takeover-list").querySelectorAll("button").forEach((b) => { b.disabled = true; });
  beep(660, 120);
  keepAwake();
  try {
    await set(ref(db, `games/${code}/joinRequests/${uid}`), { name: team.name, color: team.color, replace: id, at: serverTimestamp() });
    waitForAdmission(`L'animatrice confirme sur son téléphone (ou sur la TV) que cette tablette reprend « ${team.name} ».`);
  } catch (e) {
    console.error(e);
    fail("Impossible d'envoyer la demande. Vérifiez Internet puis réessayez.", "reseau");
  }
}

/** Demande envoyée : on attend que la régie crée l'équipe ou rattache cet appareil à une équipe. */
function waitForAdmission(text = "L'animatrice vous fait entrer dans la partie depuis son téléphone.") {
  stopListening();
  $("waiting-text").textContent = text;
  // Numéro affiché aussi sur la régie : l'animatrice sait quelle tablette elle accepte.
  $("waiting-num").textContent = `Tablette ${numeroTablette(uid)}`;
  $("screen-waiting").dataset.device = uid;
  show("waiting");
  ecouterBienvenue();
  listen(`games/${code}/state/suite`, (s) => { suivreLaSuite(s.val()); });
  let teams = {};
  let refusal = null;
  let done = false;
  const admitted = () => {
    const mine = myTeam(teams);
    if (done || !mine || isReplaced(teams, mine)) return done;
    done = true;
    clearTimeout(refusal);
    teamId = mine;
    setTimeout(play, 0); // hors de l'écouteur en cours, qui sera débranché par play()
    return true;
  };
  listen(`games/${code}/teams`, (s) => { teams = s.val() ?? {}; admitted(); });
  listen(`games/${code}/joinRequests/${uid}`, (s) => {
    if (s.exists()) return;
    // Demande effacée : acceptée (l'équipe arrive dans la même écriture) ou écartée par l'animatrice.
    refusal = setTimeout(() => {
      if (!admitted()) fail("L'animatrice n'a pas fait entrer cet appareil. Réessayez ou demandez-lui.", "attente");
    }, 2000);
  });
}

function stopListening() {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  answerUnsub?.();
  answerUnsub = null;
  answerQid = null;
}

function listen(path, fn) {
  unsubscribers.push(onValue(ref(db, path), fn));
}

// La régie voit si une tablette ne peut pas rester allumée (navigateur sans cette fonction, batterie faible).
onAwakeChange((awake) => {
  if (presenceRef && game.connected && teamId) update(presenceRef, { awake }).catch(() => {});
});

function play() {
  stopListening();
  // Game Show : les mots de Daft Punk se chargent dès l'entrée dans l'équipe, prêts pour le tout premier buzz (la
  // tablette n'est plus touchée avant : l'animatrice l'a fait entrer depuis son téléphone, cedric 24/10).
  if (lookGs) {
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      chargerMotsEquipes();
    } catch { /* pas de son sur ce navigateur : le jeu continue */ }
  }
  game = { state: null, teams: {}, myAnswer: null, connected: true };
  presenceRef = ref(db, `games/${code}/presence/${teamId}`);
  listen(".info/serverTimeOffset", (s) => { serverOffset = s.val() ?? 0; });
  // Présence : la TV et la régie voient si ce pupitre est connecté.
  listen(".info/connected", (s) => {
    game.connected = s.val() === true;
    $("offline").hidden = game.connected;
    if (!game.connected) return;
    const presence = presenceRef;
    onDisconnect(presence).set({ online: false, at: serverTimestamp() })
      .then(() => set(presence, { online: true, at: serverTimestamp(), awake: isAwake() }))
      .catch(() => { /* équipe pas encore inscrite, ou appareil remplacé */ });
  });
  // L'ancien appareil de l'équipe peut encore signaler « hors ligne » en se déconnectant : on corrige.
  listen(`games/${code}/presence/${teamId}`, (s) => {
    if (game.connected && s.val()?.online === false) {
      set(presenceRef, { online: true, at: serverTimestamp(), awake: isAwake() }).catch(() => {});
    }
  });
  listen(`games/${code}/teams`, (s) => { game.teams = s.val() ?? {}; game.teamsLoaded = true; render(); });
  listen(`games/${code}/state`, (s) => {
    game.state = s.val();
    if (suivreLaSuite(game.state?.suite)) return;
    watchMyAnswer();
    render();
  });
}

/**
 * « 🏁 Fin de la fête » : la TV a ouvert une nouvelle partie et l'écrit sur l'ancienne (`state/suite`). La tablette la
 * suit seule, sans rescanner (cedric, 25/10 : « il faut que ça suive tout seul »). true : la page part vers la suite.
 */
function suivreLaSuite(suite) {
  if (typeof suite !== "string" || !/^[A-Z0-9]{4,8}$/.test(suite) || suite === code) return false;
  if (document.body.classList.contains("regie-mode")) return false;
  stopListening();
  const p = new URLSearchParams(location.search);
  p.set("g", suite);
  p.delete("reprise");
  location.replace(`${location.pathname}?${p}`);
  return true;
}

function watchMyAnswer() {
  const qid = game.state?.qid ?? null;
  if (qid === answerQid) return;
  answerUnsub?.();
  answerQid = qid;
  game.myAnswer = null;
  if (!qid) return;
  answerUnsub = onValue(ref(db, `games/${code}/answers/${qid}/${teamId}`), (s) => {
    game.myAnswer = s.val();
    render();
  });
}

function render() {
  const me = game.teams[teamId];
  if (me && isReplaced(game.teams, teamId)) return showReplaced(me);
  if (!me) {
    // Équipe supprimée : retour à l'inscription (seulement une fois la liste des équipes reçue).
    if (game.teamsLoaded) { stopListening(); start(); }
    return;
  }
  document.documentElement.style.setProperty("--team", me.color);
  document.querySelectorAll(".team-label").forEach((e) => { e.textContent = me.name; });
  const st = game.state ?? { phase: "lobby" };
  clearTimeout(rebuzzHandle);
  $("paused").hidden = !st.paused;
  runResumeCountdown(st);
  // Saut vers un autre jeu en plein Pictionary : l'ardoise, les mots et l'animation s'arrêtent.
  if (st.kind !== "pictionary" || !st.mime) stopPicto();
  if (st.kind !== "coffres" || !["question", "closed", "reveal", "scores"].includes(st.phase)) stopCoffres();
  if (st.kind !== "gonfleur" || st.phase !== "question") stopGonfleur();
  if (st.kind !== "patate" || st.phase !== "question") stopPatate();
  if (simon && (st.kind !== "simon" || st.phase !== "question")) clearTimeout(simon.minuterie);
  // Duel des robots : l'habillage du gros bouton (néon western) seulement pendant un duel de l'équipe.
  if (st.kind !== "duel" || st.phase !== "question") {
    delete document.body.dataset.duel;
    $("duel-titre").hidden = true;
    if ($("buzz").textContent !== "BUZZ") $("buzz").textContent = "BUZZ";
  }
  $("play-intro").hidden = true;
  $("chante-mot").hidden = true;
  $("play-status").classList.remove("fete");
  switch (st.phase) {
    case "question":
    case "closed":
      if (st.kind === "coffres") return renderCoffres(st);
      if (st.kind === "gonfleur") return renderGonfleur(st);
      if (st.kind === "patate") return renderPatate(st);
      if (st.kind === "duel") return renderDuel(st);
      if (st.kind === "chrono") return renderChrono(st);
      if (st.kind === "simon") return renderSimon(st);
      return st.mime ? (st.kind === "pictionary" ? renderPicto(st) : renderMime(st)) : st.kind === "statues" ? renderStatues(st) : BUZZ_KINDS.includes(st.kind) ? renderFlou(st) : renderQuestion(st);
    case "reveal":
    case "scores":
      stopPicto();
      if (st.kind === "coffres") return renderCoffres(st);
      return st.mime ? renderMimeResult(st) : renderResult(st);
    case "ended":
      stopPicto();
      return renderEnded(st);
    case "intro":
      stopPicto();
      return renderIntro(st);
    default:
      return renderLobby(st);
  }
}

function renderLobby(st) {
  show("play");
  const buzz = $("buzz");
  buzz.hidden = false;
  // Buzzer de l'accueil : pour s'amuser, autant de fois qu'on veut, sans gagnant ni blocage.
  buzz.disabled = false;
  buzz.classList.remove("winner");
  $("play-status").textContent = "En attendant le quiz\u00a0: buzzez autant que vous voulez !";
  // Message de fête (en design The Game Show, gameshow.css le rend néon et rigolo).
  $("play-status").classList.add("fete");
}

/** Présentation d'un jeu sur la TV : pas de buzzer, l'animatrice explique les règles avant de lancer le jeu. */
function renderIntro(st) {
  show("play");
  $("buzz").hidden = true;
  // Le nom du jeu en grand, comme sur la TV ; les règles, c'est l'animatrice qui les donne.
  $("play-intro-title").textContent = st.game?.title ?? "";
  $("play-intro").hidden = !st.game?.title;
  $("play-status").textContent = "Écoutez bien l'animatrice !";
}

function renderQuestion(st) {
  show("question");
  $("q-number").textContent = st.kind === "express" ? "Vrai ou Faux express !"
    : st.kind === "zoom" ? "Zoom mystère : regardez la TV !"
    // Box à jour : la position dans le jeu en cours (« Quiz · question 5 / 10 »), jamais dans toute la prestation.
    : st.game?.label ?? `Question ${(st.index ?? 0) + 1}`;
  $("q-double").hidden = !st.double;
  $("q-double").textContent = `Points ×${st.factor ?? 2}`;
  if (st.kind === "number") return renderNumber(st);
  const choices = st.choices ?? [];
  const photos = Array.isArray(st.choiceImages) ? st.choiceImages : [];
  const pictures = photos.some((id) => IMAGE_ID.test(id ?? ""));
  const box = $("choices");
  box.classList.remove("number");
  const key = `${st.qid}:${choices.length}:${pictures}`;
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = "";
    box.classList.toggle("two", choices.length === 2);
    // Réponses en images (quiz des petits) : deux colonnes de grandes photos, même couleur et même lettre que sur la TV.
    box.classList.toggle("pictures", pictures);
    choices.forEach((text, i) => {
      const b = document.createElement("button");
      b.className = "choice";
      b.style.setProperty("--choice", CHOICE_COLORS[i]);
      b.innerHTML = `<span class="letter">${CHOICE_LETTERS[i]}</span><span class="text"></span>`;
      b.querySelector(".text").textContent = text;
      if (pictures && IMAGE_ID.test(photos[i] ?? "")) showChoicePhoto(b, photos[i], text);
      b.onclick = () => answer(i);
      box.appendChild(b);
    });
  }
  const mine = game.myAnswer?.choice ?? pending?.choice;
  const locked = mine != null || st.phase !== "question" || st.paused || counting(st);
  box.querySelectorAll(".choice").forEach((b, i) => {
    b.disabled = locked;
    b.classList.toggle("picked", mine === i);
  });
  if (mine != null) $("q-status").textContent = `Réponse ${CHOICE_LETTERS[mine]} envoyée ! Attendez la révélation…`;
  else if (st.phase === "closed") $("q-status").textContent = "Temps écoulé !";
  else $("q-status").textContent = st.kind === "express" ? "Vrai ou faux ? Vite, ça s'enchaîne !" : "Choisissez votre réponse !";
  runTimer(st);
}

const IMAGE_ID = /^[0-9a-f]{16}$/;
/** Photos des réponses déjà lues (identifiant → adresse data:), gardées pour toute la partie. */
const choicePhotos = new Map();

/** Ajoute la photo d'une réponse au bouton ; tant qu'elle n'est pas lue (ou si elle manque), le mot suffit. */
function showChoicePhoto(button, id, text) {
  const img = document.createElement("img");
  img.className = "photo";
  img.alt = text;
  img.hidden = true;
  button.prepend(img);
  button.classList.add("with-photo");
  // Photo lue : elle seule dit la réponse, le nom disparaît (test du 27/10 : « Super Sonic » écrit sous l'image).
  const set_ = (data) => { if (typeof data === "string" && data.startsWith("data:image/")) { img.src = data; img.hidden = false; button.classList.add("photo-seule"); } };
  if (choicePhotos.has(id)) return set_(choicePhotos.get(id));
  get(ref(db, `games/${code}/choiceImages/${id}`)).then((snap) => {
    if (typeof snap.val() === "string") choicePhotos.set(id, snap.val());
    set_(snap.val());
  }).catch((e) => console.warn("Photo de réponse non lue", id, e));
}

/** Le Juste Chiffre : un pavé de chiffres, un nombre envoyé une seule fois, comme une réponse. */
let numberDraft = "";
// Pas de touche « − » (cedric, 31/10 : inutile pour des enfants) : une case vide garde le « 0 » au milieu.
const NUMBER_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
function renderNumber(st) {
  const box = $("choices");
  const key = `${st.qid}:number`;
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    numberDraft = "";
    box.innerHTML = "";
    box.classList.remove("two");
    box.classList.add("number");
    const screen = document.createElement("div");
    screen.className = "number-screen";
    screen.id = "number-screen";
    box.appendChild(screen);
    const pad = document.createElement("div");
    pad.className = "number-pad";
    NUMBER_KEYS.forEach((k) => {
      if (!k) { const vide = document.createElement("span"); vide.className = "number-vide"; pad.appendChild(vide); return; }
      const b = document.createElement("button");
      b.className = "number-key";
      b.textContent = k;
      b.dataset.key = k;
      b.onclick = () => {
        if (k === "⌫") numberDraft = numberDraft.slice(0, -1);
        else if (numberDraft.length < 9) numberDraft = numberDraft === "0" ? k : numberDraft + k;
        beep(1200, 40);
        render();
        // Petit rebond de l'écran à chaque touche (l'animation repart même sur deux touches rapprochées).
        screen.classList.remove("pop");
        void screen.offsetWidth;
        screen.classList.add("pop");
      };
      pad.appendChild(b);
    });
    box.appendChild(pad);
    const send = document.createElement("button");
    send.className = "btn big number-send";
    send.id = "number-send";
    send.textContent = "Valider";
    send.onclick = () => {
      const n = Number(numberDraft);
      if (numberDraft === "" || numberDraft === "-" || !Number.isInteger(n)) return;
      answer(n);
    };
    box.appendChild(send);
  }
  const mine = game.myAnswer?.choice ?? pending?.choice;
  const locked = mine != null || st.phase !== "question" || st.paused || counting(st);
  $("number-screen").textContent = mine != null ? `${mine}` : numberDraft || "…";
  box.querySelectorAll("button").forEach((b) => { b.disabled = locked; });
  $("number-send").disabled = locked || numberDraft === "" || numberDraft === "-";
  if (mine != null) $("q-status").textContent = `Nombre ${mine} envoyé ! Attendez la révélation…`;
  else if (st.phase === "closed") $("q-status").textContent = "Temps écoulé !";
  else $("q-status").textContent = "Tapez votre nombre, puis « Valider » !";
  runTimer(st);
}

/**
 * Image floue : un seul grand BUZZ. La première équipe qui buzze répond à voix haute, l'animatrice valide ;
 * après une erreur, cette équipe peut rebuzzer 3 s plus tard (cedric, 25/10, règle 2).
 */
function renderFlou(st) {
  clearInterval(timerHandle);
  show("play");
  const buzz = $("buzz");
  buzz.hidden = false;
  const b = st.buzz ?? {};
  const tried = (b.blocked ?? []).includes(teamId);
  // Une équipe qui s'est trompée peut rebuzzer 3 s après la reprise (blind test : de la musique ; autres jeux : le
  // verdict). Petite marge pour que la base, à l'heure du serveur, l'accepte à coup sûr.
  const rebuzzIn = tried && typeof b.rebuzzAt === "number" ? b.rebuzzAt + 300 - (Date.now() + serverOffset) : null;
  if (rebuzzIn != null && rebuzzIn > 0) rebuzzHandle = setTimeout(render, rebuzzIn);
  const blocked = tried && !(rebuzzIn != null && rebuzzIn <= 0);
  const open = st.phase === "question" && st.buzzOpen === true && !st.paused && !counting(st) && !b.team && !blocked;
  buzz.disabled = !open;
  // Chante le mot ! : le mot de la TV en grand au-dessus du BUZZ, pour que l'équipe l'ait sous les yeux.
  const mot = st.kind === "chante" && st.phase === "question" ? String(st.text ?? "").trim() : "";
  $("chante-mot").hidden = !mot;
  if ($("chante-mot").textContent !== mot) $("chante-mot").textContent = mot;
  buzz.classList.toggle("winner", b.team === teamId);
  const chante = st.kind === "chante";
  if (b.team === teamId) $("play-status").textContent = chante ? "Vous avez buzzé ! À vous de chanter !" : st.kind === "blind" ? "Vous avez buzzé ! Le titre, à voix haute !" : "Vous avez buzzé ! Donnez votre réponse à voix haute.";
  else if (b.team) $("play-status").textContent = `${game.teams[b.team]?.name ?? "Une équipe"} a buzzé : ${chante ? "écoutez-les chanter" : "écoutez sa réponse"}…`;
  else if (st.phase === "closed") $("play-status").textContent = "Temps écoulé ! Regardez la TV.";
  // Qui a disparu ? : le buzzer s'ouvre quand les objets reviennent sur la TV, après la mémorisation.
  else if (st.kind === "disparu" && st.buzzOpen !== true && !st.paused) $("play-status").textContent = "Regardez la TV et mémorisez bien tous les objets…";
  // Blind test : la musique attend le « Lancer » (ou le « Relancer ») de l'animatrice.
  else if (st.kind === "blind" && st.blind?.waiting && !st.paused) $("play-status").textContent = blocked
    ? "Raté pour cette chanson… Les autres équipes vont tenter leur chance."
    : st.blind.played ? "Musique en pause… Préparez-vous, elle va repartir !" : "Prêts ? La musique va commencer, le doigt sur le buzzer !";
  else if (rebuzzIn != null && !st.paused) $("play-status").textContent = blocked
    ? "Raté… Écoutez bien : vous pourrez retenter votre chance dans un instant !"
    : "Vous pouvez retenter votre chance : buzzez si vous avez trouvé !";
  else if (blocked) $("play-status").textContent = `Raté pour ${st.kind === "flou" ? "cette image" : chante ? "ce mot" : st.kind === "blind" ? "cette chanson" : st.kind === "disparu" ? "cette fois" : "ce personnage"}… Les autres équipes peuvent encore buzzer.`;
  else $("play-status").textContent = BUZZ_INVITE[st.kind] ?? BUZZ_INVITE.flou;
}

async function buzzFlou(st) {
  const buzz = $("buzz");
  buzz.disabled = true;
  sonBuzz(() => beep(880, 160));
  navigator.vibrate?.(120);
  try {
    // Le premier qui écrit gagne : les règles refusent les buzz suivants sous la même clé.
    await set(ref(db, `games/${code}/buzz/${st.round}`), { team: teamId, at: serverTimestamp() });
  } catch {
    // Une autre équipe a été plus rapide, ou le buzzer vient de se fermer : l'écran suit l'état de la TV.
  }
}

/**
 * Statues musicales (cedric, 27/10) : rien à toucher, tout le monde danse devant la TV. La tablette suit la chanson :
 * DANSEZ ! ou STATUE !, « Regardez la TV ! » pendant l'annonce des gagnantes, puis les points de la chanson.
 */
let statuesHandle = null;
function renderStatues(st) {
  clearInterval(timerHandle);
  clearTimeout(statuesHandle);
  show("play");
  const buzz = $("buzz");
  buzz.disabled = true;
  buzz.hidden = true;
  const s = st.statues ?? {};
  const r = s.result;
  const status = $("play-status");
  if (r) {
    const reste = r.at + (s.annonceMs ?? 8000) - (Date.now() + serverOffset);
    if (reste > 0) {
      status.textContent = "Et l'équipe gagnante est… Regardez la TV !";
      statuesHandle = setTimeout(() => { if (game.state === st) renderStatues(st); }, Math.min(reste + 50, 10_000));
      return;
    }
    const gain = r.gains?.[teamId] ?? 0;
    const gagnantes = Array.isArray(r.winners) ? r.winners : [];
    status.textContent = gagnantes.includes(teamId) ? `Les meilleures statues ! +${gain} points`
      : gain ? `Bien dansé ! +${gain} points`
      : gagnantes.length ? "Bien dansé ! À la prochaine chanson." : "Personne cette fois ! On se rattrape à la prochaine chanson.";
    return;
  }
  // Un gros mot néon qui bouge, et une petite phrase dessous (cedric, 31/10, choix A : « plus fun, moins sérieux »).
  const danse = !s.ended && s.dancing !== false;
  const mot = document.createElement("span");
  mot.className = `statues-mot ${danse ? "statues-danse" : "statues-fige"}`;
  mot.textContent = danse ? "DANSE !" : "STATUE !";
  const phrase = document.createElement("span");
  phrase.className = "statues-phrase";
  phrase.textContent = s.ended ? "Fin de la chanson ! Plus personne ne bouge…"
    : danse ? "Posez la tablette et bougez comme des robots fous tant que la musique joue !"
    : "Plus personne ne bouge… pas même un cil !";
  // Remplacé seulement s'il change : le mot ne recommence pas son animation à chaque mise à jour.
  const avant = status.querySelector(".statues-mot");
  if (avant?.className !== mot.className || status.querySelector(".statues-phrase")?.textContent !== phrase.textContent) status.replaceChildren(mot, phrase);
}

/**
 * 🤠 Le Duel des robots (cedric, 27/10) : les 2 équipes du duel ont le gros bouton (ou leur buzzer USB), les autres
 * regardent la TV. Rien ne dit quand tombe le PAN : la tablette envoie l'heure de l'appui, la box juge (trop tôt, plus
 * rapide). Un seul buzz par face-à-face.
 */
let duelEnvoye = null;
// Horloge fine du duel ({ rtt, offset } : heure du serveur = performance.now() + offset), mesurée pendant que les
// joueurs se placent ; et l'instant du dernier appui (touche du buzzer USB ou doigt posé), pris par le système.
let horlogeDuel = null;
let horlogeMesuree = null;
let dernierAppui = null;
function mesurerPourLeDuel(cle) {
  if (horlogeMesuree === cle) return;
  horlogeMesuree = cle;
  const chemin = ref(db, `games/${code}/horloge/${teamId}`);
  mesurerHorloge(() => set(chemin, { at: serverTimestamp() }), async () => (await get(chemin)).val()?.at)
    .then((m) => { horlogeDuel = garder(horlogeDuel, m); });
}
/** Heure du serveur à l'instant [p] (performance.now()) : horloge fine si mesurée, sinon celle de Firebase. */
const heureServeur = (p) => Math.round(horlogeDuel ? p + horlogeDuel.offset : performance.timeOrigin + p + serverOffset);
const nomEquipe = (uid) => game.teams[uid]?.name ?? "Une équipe";
function renderDuel(st) {
  clearInterval(timerHandle);
  show("play");
  const buzz = $("buzz");
  const d = st.duel ?? {};
  const equipes = Array.isArray(d.teams) ? d.teams : [];
  const place = equipes.indexOf(teamId);
  const moi = place >= 0;
  const status = $("play-status");
  const face = d.step === "standoff" && !st.paused;
  buzz.hidden = !moi || d.step === "none";
  buzz.disabled = !moi || !face || !d.key || duelEnvoye === d.key;
  buzz.classList.toggle("winner", d.step === "result" && d.result?.winner === teamId);
  document.body.dataset.duel = moi ? d.step ?? "" : "";
  // Pendant que les joueurs se placent : l'horloge de la tablette est calée sur celle du serveur.
  if (moi && d.step === "ready") mesurerPourLeDuel(`${st.qid}-${d.n}`);
  const contre = equipes.length === 2 ? `${nomEquipe(equipes[0])} contre ${nomEquipe(equipes[1])}` : "";
  if (!d.step || d.step === "none") status.textContent = "Le Duel des robots : il faut au moins 2 équipes. Regardez la TV !";
  else if (d.step === "ready") status.textContent = moi
    ? `Duel n° ${d.n} : à toi ! Viens te placer, la main sur le buzzer…`
    : `Duel n° ${d.n} : ${contre}. Regardez la TV !`;
  else if (d.step === "standoff") status.textContent = !moi ? `${contre} : silence, ça va tirer…`
    : duelEnvoye === d.key ? "Buzz envoyé ! Regardez la TV…" : "Attends le PAN ! Pas avant… Buzze dès qu'il apparaît !";
  else {
    const r = d.result ?? {};
    const secondes = typeof r.ms === "number" ? ` en ${(r.ms / 1000).toFixed(2).replace(".", ",")} s` : "";
    status.textContent = !r.winner ? "Personne n'a tiré !"
      : r.winner === teamId ? `BRAVO ! Le plus rapide${secondes} ! +${r.points ?? 100} points`
      : r.early === teamId ? "OUPS, trop tôt ! Il fallait attendre le PAN…"
      : moi ? "Trop lent… La prochaine fois !"
      : r.early ? `${nomEquipe(r.early)} a buzzé trop tôt… ${nomEquipe(r.winner)} gagne le duel !`
      : `${nomEquipe(r.winner)} remporte le duel !`;
  }
  // Les mots du duel en lettre western néon (planche validée par cedric, 27/10) : le titre au-dessus du gros bouton,
  // et « PAN ! », « BRAVO » ou « OUPS » sur le bouton (espaces insécables déjà posées : le texte n'est réécrit
  // que s'il change).
  const res = d.result ?? {};
  const resultat = d.step === "result";
  const [titre, couleur] = !d.step || d.step === "none" ? ["", null]
    : !moi ? (resultat && res.winner ? [`${nomEquipe(res.winner)} gagne\u00a0!`, game.teams[res.winner]?.color] : ["Duel en cours", "#ff7a1a"])
    : !resultat ? ["Main sur le buzzer\u00a0!", null]
    : res.winner === teamId ? ["Le plus rapide\u00a0!", null]
    : res.early === teamId ? ["Trop tôt\u00a0!", "#ff2030"]
    : !res.winner ? ["Personne n'a tiré\u00a0!", "#00f0ff"]
    : ["Trop lent…", "#ff7a1a"];
  const h = $("duel-titre");
  h.hidden = !titre;
  if (h.textContent !== titre) h.textContent = titre;
  h.style.setProperty("--n", couleur ?? "var(--team)");
  // Deux petites étoiles de shérif autour des grands moments (dessinées par le style, pas dans le texte).
  h.classList.toggle("etoiles", ["Duel en cours", "Le plus rapide\u00a0!", "Trop tôt\u00a0!"].includes(titre));
  const mot = resultat && res.winner === teamId ? "BRAVO" : resultat && res.early === teamId ? "OUPS" : "PAN\u00a0!";
  if (buzz.textContent !== mot) buzz.textContent = mot;
  buzz.classList.toggle("oups", resultat && res.early === teamId);
}

async function buzzDuel(st, t) {
  const d = st.duel ?? {};
  if (!d.key || d.step !== "standoff" || !d.teams?.includes(teamId) || duelEnvoye === d.key) return;
  duelEnvoye = d.key;
  const buzz = $("buzz");
  buzz.disabled = true;
  sonBuzz(() => beep(880, 160));
  navigator.vibrate?.(120);
  $("play-status").textContent = "Buzz envoyé ! Regardez la TV…";
  // Pour les rapports de la box : aller-retour et décalage de l'horloge fine (ms), s'ils sont mesurés.
  const mesure = horlogeDuel ? { r: Math.round(horlogeDuel.rtt), o: Math.round(horlogeDuel.offset - performance.timeOrigin) } : {};
  try {
    await set(ref(db, `games/${code}/duel/${d.key}/${teamId}`), { t, at: serverTimestamp(), ...mesure });
  } catch {
    // Face-à-face arrêté ou déjà jugé : l'écran suit l'état de la TV.
  }
}

/**
 * ⏱️ Le Chrono de Buzzy (cedric, 30/10) : la tablette ne montre JAMAIS le temps. Après le décompte de la TV, le gros bouton
 * s'allume : l'équipe compte dans sa tête et buzze une seule fois, à la cible. Comme au Duel, la tablette envoie l'heure
 * de l'appui (heure du serveur, horloge fine mesurée pendant que le tour est prêt), et la box juge.
 */
let chronoEnvoye = null;
let chronoMinuterie = null;
const ecartTexte = (ms) => `${ms > 0 ? "+" : ms < 0 ? "−" : ""}${(Math.abs(ms) / 1000).toFixed(2).replace(".", ",")}\u00a0s`;
function renderChrono(st) {
  clearInterval(timerHandle);
  clearTimeout(chronoMinuterie);
  show("play");
  const buzz = $("buzz");
  const c = st.chrono ?? {};
  const status = $("play-status");
  const equipes = Array.isArray(c.teams) ? c.teams : [];
  const enJeu = c.step === "run" && equipes.includes(teamId);
  const avantZero = enJeu && typeof c.goAt === "number" && Date.now() + serverOffset < c.goAt;
  const envoye = chronoEnvoye === c.key || (Array.isArray(c.buzzed) && c.buzzed.includes(teamId));
  buzz.hidden = c.step !== "run" || !equipes.includes(teamId);
  buzz.disabled = !enJeu || avantZero || !c.key || envoye || st.paused;
  if (buzz.textContent !== "BUZZ") buzz.textContent = "BUZZ";
  const res = c.result ?? {};
  buzz.classList.toggle("winner", c.step === "result" && (res.winners ?? []).includes(teamId));
  // Pendant que le tour est prêt : l'horloge de la tablette est calée sur celle du serveur.
  if (c.step === "ready") mesurerPourLeDuel(`${st.qid}-chrono-${c.tour}`);
  // Le gros bouton s'allume tout seul au 0 du chrono.
  if (avantZero) chronoMinuterie = setTimeout(() => game?.state && render(), Math.max(50, c.goAt - (Date.now() + serverOffset)));
  const cible = `${c.cible ?? 30} secondes`;
  if (!c.step || c.step === "none") status.textContent = "Le Chrono de Buzzy : regardez la TV !";
  else if (c.step === "ready") status.textContent = `Tour ${c.tour ?? 1} : comptez jusqu'à ${cible} ! Regardez la TV…`;
  else if (c.step === "run") status.textContent = !equipes.includes(teamId) ? "Ce tour a commencé sans vous : regardez la TV !"
    : avantZero ? "Prêts ? Le chrono va partir…"
    : envoye ? "Buzz envoyé ! Regardez la TV…"
    : `Comptez dans votre tête… Buzzez à ${cible} pile !`;
  else {
    const e = res.ecarts?.[teamId];
    const gagne = (res.winners ?? []).includes(teamId);
    const gain = res.gains?.[teamId];
    status.textContent = typeof e !== "number" ? "Pas de buzz pour vous ce tour-ci…"
      : gagne ? `BRAVO ! La plus proche : ${ecartTexte(e)} ! +${gain ?? res.points ?? 100} points`
      : gain ? `Votre écart : ${ecartTexte(e)}. Bien joué : +${gain} points !`
      : `Votre écart : ${ecartTexte(e)}. Presque !`;
  }
}

async function buzzChrono(st, t) {
  const c = st.chrono ?? {};
  if (!c.key || c.step !== "run" || !c.teams?.includes(teamId) || chronoEnvoye === c.key) return;
  if (typeof c.goAt === "number" && t < c.goAt) return;
  chronoEnvoye = c.key;
  $("buzz").disabled = true;
  sonBuzz(() => beep(880, 160));
  navigator.vibrate?.(120);
  $("play-status").textContent = "Buzz envoyé ! Regardez la TV…";
  const mesure = horlogeDuel ? { r: Math.round(horlogeDuel.rtt), o: Math.round(horlogeDuel.offset - performance.timeOrigin) } : {};
  try {
    await set(ref(db, `games/${code}/chrono/${c.key}/${teamId}`), { t, at: serverTimestamp(), ...mesure });
  } catch {
    // Tour arrêté ou déjà jugé : l'écran suit l'état de la TV.
  }
}

/** Mimes : rien à toucher sur le pupitre, tout se passe devant la TV ; il dit seulement qui joue. */
function renderMime(st) {
  clearInterval(timerHandle);
  show("play");
  const buzz = $("buzz");
  buzz.disabled = true;
  buzz.hidden = true;
  const m = st.mime;
  const mine = m.counts?.[teamId] ?? 0;
  const found = mine ? ` Déjà ${mine} mime${mine > 1 ? "s" : ""} trouvé${mine > 1 ? "s" : ""} !` : "";
  if (m.team === teamId) {
    // « C'est votre tour ! » en grand néon, la consigne dessous (cedric, 31/10 : « fait penser à un article de journal »).
    const status = $("play-status");
    if (!status.querySelector(".mimes-titre")) {
      const titre = document.createElement("span");
      titre.className = "mimes-titre";
      titre.textContent = "C'est votre tour !";
      const phrase = document.createElement("span");
      phrase.className = "mimes-phrase";
      phrase.textContent = "Le mimeur se met en place, les autres se mettent dos à la TV.";
      status.replaceChildren(titre, phrase);
    }
  } else if (m.team) $("play-status").textContent = `C'est au tour de ${game.teams[m.team]?.name ?? "une autre équipe"} : regardez-les mimer !${found}`;
  else $("play-status").textContent = `Mimes ! L'animatrice choisit l'équipe qui joue.${found}`;
}

function renderMimeResult(st) {
  clearInterval(timerHandle);
  show("result");
  const n = st.mime?.counts?.[teamId] ?? 0;
  const what = st.kind === "pictionary" ? "dessin" : "mime";
  $("r-icon").textContent = n ? "★" : "…";
  $("r-icon").className = `result-icon ${n ? "ok" : "ko"}`;
  $("r-title").textContent = n ? `Bravo ! ${n} ${what}${n > 1 ? "s" : ""} trouvé${n > 1 ? "s" : ""}` : `Pas de ${what} trouvé cette fois !`;
  $("r-detail").textContent = n ? `+${n * (st.mime?.points ?? 50)} points` : "";
  $("r-total").textContent = totalEtPlace(st);
}

// ---------- Pictionary ----------
// L'habillage vient du fil Design (ardoise.js, spectateurs.js) ; ici, seulement quand montrer quoi, et l'envoi.

/** Ardoise du dessinateur (tour de cette équipe) et la clé de son dessin. */
let ardoise = null;
let ardoiseKey = null;
/** Les 3 mots proposés au dessinateur, pour la proposition [choixKey]. */
let choix = null;
let choixKey = null;
/** Animation des tablettes qui regardent, pour l'équipe [spectateursFor]. */
let spectateurs = null;
let spectateursFor = null;

function stopSheet() {
  ardoise?.detruire();
  ardoise = null;
  ardoiseKey = null;
}

function stopPick() {
  choix?.masquer();
  choix = null;
  choixKey = null;
}

function stopWatch() {
  spectateurs?.arreter();
  spectateurs = null;
  spectateursFor = null;
}

function stopPicto() {
  stopSheet();
  stopPick();
  stopWatch();
}

/**
 * Pictionary : le dessinateur de l'équipe qui joue choisit son mot puis dessine ; les autres équipes regardent
 * la TV (animation sur leur tablette) ; entre deux tours, la tablette dit qui va jouer.
 */
function renderPicto(st) {
  clearInterval(timerHandle);
  const m = st.mime;
  const name = (id) => game.teams[id]?.name ?? "une autre équipe";
  if (m.secret === teamId && m.offer?.length && m.pickKey) {
    stopSheet();
    stopWatch();
    return renderPick(m);
  }
  stopPick();
  if (m.team === teamId && m.drawKey) {
    stopWatch();
    return renderDraw(st, m);
  }
  stopSheet();
  if (m.team || m.secret) return renderWatch(m, name);
  stopWatch();
  show("play");
  $("buzz").disabled = true;
  $("buzz").hidden = true;
  const mine = m.counts?.[teamId] ?? 0;
  const found = mine ? ` Déjà ${mine} dessin${mine > 1 ? "s" : ""} trouvé${mine > 1 ? "s" : ""} !` : "";
  $("play-status").textContent = m.last
    ? `« ${m.last.word ?? "?"} » : ${m.last.found ? `bravo ${name(m.last.team)} !` : "pas trouvé cette fois."} L'animatrice choisit l'équipe suivante.${found}`
    : `Pictionary ! L'animatrice choisit l'équipe qui dessine en premier.${found}`;
}

function renderPick(m) {
  show("pick");
  if (choixKey !== m.pickKey) {
    stopPick();
    choixKey = m.pickKey;
    // L'émoji du mot sur la tablette (cedric, 24/10 : la vraie photo, c'est la TV qui la montre quand le dessin est
    // trouvé) ; un mot sans émoji (une de vos images) montre sa photo, quand elle est lue : les cartes se redessinent.
    choix = choisirMot($("pick-host"), m.offer.map((c) => ({ mot: c.word, image: c.image || choicePhotos.get(c.imageId) || "✏️" })), {
      surChoix: (i) => choosePicto(m.pickKey, i),
    });
    const key = m.pickKey;
    for (const id of m.offer.filter((c) => !c.image).map((c) => c.imageId).filter((id) => IMAGE_ID.test(id ?? "") && !choicePhotos.has(id))) {
      get(ref(db, `games/${code}/choiceImages/${id}`)).then((snap) => {
        if (typeof snap.val() !== "string" || !snap.val().startsWith("data:image/")) return;
        choicePhotos.set(id, snap.val());
        if (choixKey === key && game.state?.mime?.chosen == null) { stopPick(); render(); }
      }).catch((e) => console.warn("Photo du mot non lue", id, e));
    }
  }
  $("pick-status").textContent = m.chosen != null
    ? `Tu vas dessiner « ${m.offer[m.chosen]?.word ?? ""} ». Garde le secret ! L'animatrice va masquer le mot, puis tu dessines.`
    : "";
}

async function choosePicto(key, i) {
  if (i == null || !key) return;
  beep(880, 120);
  navigator.vibrate?.(30);
  try {
    await set(ref(db, `games/${code}/pictoChoice/${key}`), { i, at: serverTimestamp() });
  } catch {
    // Refusé (connexion, pause, autres mots proposés entre-temps) : les cartes reviennent pour choisir de nouveau.
    stopPick();
    render();
    $("pick-status").textContent = "Le choix n'est pas parti : vérifie la connexion et choisis encore ton mot.";
  }
}

function renderDraw(st, m) {
  show("draw");
  if (ardoiseKey !== m.drawKey) {
    stopSheet();
    ardoiseKey = m.drawKey;
    $("draw-status").textContent = "";
    const envoi = envoyeurDessin(db, `games/${code}/drawing/${m.drawKey}`, {
      onError: () => { $("draw-status").textContent = "Le dessin n'arrive plus à la TV : vérifiez la connexion."; },
    });
    const mot = m.card?.word ? `Dessine : ${m.card.word} ${m.card.image ?? ""}`.trim() : "À toi de dessiner !";
    ardoise = creerArdoise($("draw-host"), { surTrait: envoi.trait, surEffacer: envoi.effacer, titre: mot });
  }
  // En pause, la feuille se fige (la base refuserait les traits) ; elle repart à la reprise.
  if (st.paused) ardoise.desactiver("Pause ! On reprend dans un instant.");
  else ardoise.activer();
  runTimer(st, $("draw-timer"));
}

function renderWatch(m, name) {
  show("watch");
  $("watch-status").textContent = "";
  const who = m.team ?? m.secret;
  const phase = m.team ? "dessin" : "choix";
  if (spectateursFor !== who) {
    stopWatch();
    spectateursFor = who;
    spectateurs = animationSpectateurs($("watch-host"), { equipe: name(who), phase });
  } else spectateurs.changerPhase(phase);
}

async function answer(choice) {
  const st = game.state;
  if (!st || st.phase !== "question" || st.paused || counting(st) || game.myAnswer || pending) return;
  if (Date.now() < reponsesBloqueesJusqua) return;
  pending = { qid: st.qid, choice };
  beep(990, 150);
  navigator.vibrate?.(80);
  render();
  try {
    await set(ref(db, `games/${code}/answers/${st.qid}/${teamId}`), { choice, at: serverTimestamp() });
  } catch {
    // Refusée par le serveur : chrono fini, pause, ou réponse déjà enregistrée.
    if (!game.myAnswer) $("q-status").textContent = "Trop tard, la réponse n'a pas été prise.";
  } finally {
    pending = null;
    render();
  }
}

/** Décompte 3, 2, 1 de la reprise, calé sur l'heure du serveur comme la TV. */
const counting = (st) => !st.paused && st.resumeAt != null && st.resumeAt > Date.now() + serverOffset;
let countdownHandle = null;
function runResumeCountdown(st) {
  clearInterval(countdownHandle);
  const box = $("resume-count");
  const tick = () => {
    const ms = st.paused || st.resumeAt == null ? 0 : st.resumeAt - (Date.now() + serverOffset);
    box.hidden = ms <= 0;
    if (ms > 0) {
      $("resume-num").textContent = `${Math.min(9, Math.ceil(ms / 1000))}`;
      // Avant les dernières questions multipliées, la TV annonce « × N » : le décompte le dit aussi.
      $("resume-text").textContent = st.intro != null && st.intro === st.resumeAt ? `Points ×${st.factor ?? 2} !`
        : st.kind === "gonfleur" && st.pump?.goAt === st.resumeAt ? "Prêts à gonfler ?"
          : bombeSuivante(st) ? `Bombe ${st.potato.bomb} sur ${st.potato.bombs} !` : "C'est reparti !";
      // « Ça va exploser ! » : la bombe suivante attend la fin de l'explosion pour s'annoncer.
      if (bombeSuivante(st) && ms > PATATE_ANNONCE_MS) box.hidden = true;
    } else { clearInterval(countdownHandle); countdownHandle = null; if (st.phase === "question") render(); }
  };
  const ms = st.paused || st.resumeAt == null ? 0 : st.resumeAt - (Date.now() + serverOffset);
  if (ms <= 0) { box.hidden = true; return; }
  tick();
  countdownHandle = setInterval(tick, 100);
}

function runTimer(st, el = $("q-timer")) {
  clearInterval(timerHandle);
  // Pas de chrono : rien à afficher.
  if (st.phase === "question" && st.deadline == null && st.remainingMs == null) {
    el.textContent = "";
    el.classList.remove("urgent");
    return;
  }
  const tick = () => {
    let ms;
    if (st.phase !== "question") ms = 0;
    else if (st.paused) ms = st.remainingMs ?? 0;
    else ms = Math.max(0, (st.deadline ?? 0) - Math.max(Date.now() + serverOffset, st.resumeAt ?? 0));
    const s = Math.ceil(ms / 1000);
    el.textContent = `${s}`;
    el.classList.toggle("urgent", s <= 5);
    if (ms <= 0 || st.paused) clearInterval(timerHandle);
  };
  tick();
  timerHandle = setInterval(tick, 200);
}

/**
 * « 250 points · 2e place » sous un résultat. Au dernier jeu de la fête, rien du classement : il se découvre sur la TV,
 * jauges au bout et gagnant annoncé (cedric, 26/10).
 */
function totalEtPlace(st) {
  if (Number.isInteger(st.index) && Number.isInteger(st.total) && st.index >= st.total - 1) return "Le classement, c'est sur la télé !";
  const { mine, rank } = rankOf(st.scores);
  return `${mine} points · ${rank === 1 ? "1re place" : `${rank}e place`}`;
}

function rankOf(scores) {
  const mine = scores?.[teamId] ?? 0;
  const others = Object.keys(game.teams).filter((t) => (scores?.[t] ?? 0) > mine).length;
  return { mine, rank: others + 1 };
}

function renderResult(st) {
  clearInterval(timerHandle);
  show("result");
  const award = st.awards?.[teamId];
  const answered = award != null;
  const ok = award?.correct === true;
  $("r-icon").textContent = ok ? "✓" : answered ? "✗" : "…";
  $("r-icon").className = `result-icon ${ok ? "ok" : "ko"}`;
  const number = st.kind === "number";
  if (st.kind === "patate") {
    // La dernière bombe : chez qui elle a explosé, ce qu'elle a coûté ou rapporté ; puis le total de toutes les bombes.
    const booms = liste(st.potato?.booms);
    const derniere = booms[booms.length - 1];
    const boom = derniere?.holder ?? Object.keys(st.awards ?? {}).find((t) => st.awards[t] && !st.awards[t].correct);
    const pts = award?.points ?? 0;
    const perdu = derniere ? -(derniere.lost ?? 0) : pts;
    const gagne = derniere ? derniere.gain ?? 0 : pts;
    const plusieurs = booms.length > 1;
    $("r-icon").textContent = boom === teamId ? "💥" : "😅";
    $("r-icon").className = `result-icon ${boom === teamId ? "ko" : "ok"}`;
    $("r-title").textContent = boom === teamId ? `BOUM ! La ${plusieurs ? "dernière " : ""}bombe a explosé chez vous${perdu < 0 ? ` : −${-perdu} points` : ""}`
      : `Ouf ! +${gagne} points`;
    $("r-detail").textContent = [
      boom && boom !== teamId ? `Elle a explosé chez l'équipe ${game.teams[boom]?.name ?? "adverse"}.` : "",
      plusieurs ? `Sur les ${booms.length} bombes : ${pts < 0 ? "−" : "+"}${Math.abs(pts)} points.` : "",
    ].filter(Boolean).join(" ");
    $("r-image").hidden = true;
    $("r-total").textContent = totalEtPlace(st);
    return;
  }
  if (st.kind === "gonfleur") {
    const winner = Object.keys(st.awards ?? {}).find((t) => st.awards[t]?.correct);
    $("r-icon").textContent = ok ? "🏆" : "🎈";
    $("r-icon").className = "result-icon ok";
    $("r-title").textContent = ok ? `Votre ballon a gagné ! +${award.points} points`
      : award?.points ? `Bien gonflé ! +${award.points} points` : "Bien gonflé !";
    $("r-detail").textContent = !ok && winner ? `Le ballon des ${game.teams[winner]?.name ?? "autres"} a gagné.` : "";
    $("r-image").hidden = true;
    $("r-total").textContent = totalEtPlace(st);
    return;
  }
  if (st.kind === "statues") {
    $("r-icon").textContent = ok ? "🏆" : "♪";
    $("r-icon").className = "result-icon ok";
    $("r-title").textContent = ok ? `Les meilleures statues ! +${award.points} points` : award?.points ? `Bien dansé ! +${award.points} points` : "Bien dansé !";
  } else if (number) {
    const exact = ok && game.myAnswer?.choice === st.correct;
    $("r-title").textContent = exact ? `Pile le bon nombre ! +${award.points} points` : ok ? `Le plus proche ! +${award.points} points` : answered ? "Raté pour cette fois !" : "Pas de réponse";
  } else if (BUZZ_KINDS.includes(st.kind)) {
    const winner = Object.keys(st.awards ?? {}).find((t) => st.awards[t]?.correct);
    $("r-icon").textContent = ok ? "✓" : "…";
    $("r-title").textContent = ok ? `Bravo ! +${award.points} points` : winner ? `${game.teams[winner]?.name ?? "Une équipe"} a trouvé !` : "Personne n'a trouvé";
  } else {
    $("r-title").textContent = ok ? `Bravo ! +${award.points} points` : answered ? "Raté pour cette fois !" : "Pas de réponse";
  }
  const correct = st.correct == null ? "" : number ? `${st.correct}${game.myAnswer ? ` (vous : ${game.myAnswer.choice})` : ""}`
    : BUZZ_KINDS.includes(st.kind) ? (st.choices?.[st.correct] ?? "") : `${CHOICE_LETTERS[st.correct]} : ${st.choices?.[st.correct] ?? ""}`;
  const said = st.kind === "chante" ? "Le mot" : BUZZ_KINDS.includes(st.kind) ? "C'était" : "Bonne réponse";
  const bonusLabel = st.kind === "blind" ? "bonus artiste" : "bonus rapidité";
  $("r-detail").textContent = (ok && award.bonus > 0 ? `dont ${award.bonus} de ${bonusLabel}. ` : "") + (correct ? `${said} : ${correct}${st.artist ? ` (${st.artist})` : ""}` : "");
  $("r-image").textContent = st.image ?? "";
  $("r-image").hidden = !st.image;
  $("r-total").textContent = totalEtPlace(st);
}

/** Les coffres mystères (écran coffres.js) : { ctl, cle, envoi, tour, alarme } du jeu en cours. */
let coffres = null;
function stopCoffres() {
  if (!coffres) return;
  clearTimeout(coffres.alarme);
  coffres.ctl.detruire();
  coffres = null;
}

/**
 * Les coffres mystères : l'équipe qui joue choisit un coffre et l'ouvre, les autres regardent. Le contenu d'un coffre
 * n'apparaît qu'une fois montré par la TV ; le bilan du jeu arrive après l'explosion.
 */
function renderCoffres(st) {
  clearInterval(timerHandle);
  show("coffres");
  const c = st.chests ?? {};
  coffres ??= { ctl: ecranCoffres($("coffres-host"), { surChoix: chooseChest }), cle: null, envoi: null, tour: null, alarme: null, message: null };
  // Nouvelle ouverture : plus rien d'envoyé.
  if (coffres.cle !== (c.key ?? null)) { coffres.cle = c.key ?? null; coffres.envoi = null; coffres.message = null; }
  const now = Date.now() + serverOffset;
  const equipe = (id) => game.teams[id] ? { nom: game.teams[id].name, couleur: game.teams[id].color } : { nom: "Une équipe", couleur: "#fff" };
  const ouverts = (Array.isArray(c.opened) ? c.opened : Object.values(c.opened ?? {})).map((o) => ({
    ...o, ...equipe(o.team), couleur: equipe(o.team).couleur, visible: now >= (o.at ?? 0) + REVELATION_MS,
  }));
  const dernier = ouverts[ouverts.length - 1];
  const suspense = dernier != null && !dernier.visible;
  const aMoi = st.phase === "question" && c.team === teamId;
  // C'est notre tour (nouvelle ouverture) : la tablette le signale.
  if (aMoi && coffres.tour !== c.key) { coffres.tour = c.key; navigator.vibrate?.([60, 60, 60]); beep(988, 140); }
  const pret = c.ready === true;
  const attente = Math.max(0, (c.readyAt ?? 0) + 300 - now);
  const peutOuvrir = aMoi && !st.paused && !counting(st) && attente === 0;
  const fini = st.phase === "scores" || (c.exploded === true && !suspense);
  const joue = c.team ? equipe(c.team) : null;
  let titre; let texte;
  if (!pret) { titre = "Les Coffres mystères"; texte = "Les coffres arrivent sur la TV…"; }
  else if (fini) { titre = "BOUM ! Le bilan"; texte = `${equipe(dernier?.team).nom} a trouvé la bombe !`; }
  else if (suspense) { titre = "Le coffre s'ouvre…"; texte = `${dernier.nom} ouvre son coffre : regardez la TV !`; }
  else if (st.paused) { titre = "Pause"; texte = "La partie reprend bientôt."; }
  else if (aMoi) {
    titre = `À vous, ${joue.nom} !`;
    texte = coffres.envoi != null ? "Coffre choisi : regardez la TV !"
      : attente > 0 ? "Préparez-vous, la TV termine…" : "Touchez un coffre pour l'ouvrir !";
  } else if (joue) { titre = `Au tour de l'équipe ${joue.nom}`; texte = "Quel coffre va-t-elle choisir ? Regardez bien !"; }
  else { titre = "Les Coffres mystères"; texte = "Regardez la TV !"; }
  if (pret && !fini && !suspense && !st.paused) {
    texte += !c.danger ? ` Encore ${c.safeLeft} coffre${c.safeLeft > 1 ? "s" : ""} sans danger.`
      : c.goldLeft === true ? " Attention, la bombe peut être dans n'importe quel coffre… et le coffre en or (+500) aussi !"
        : " Attention, la bombe peut être dans n'importe quel coffre !";
  }
  if (coffres.message) texte = coffres.message;
  const gains = c.gains ?? {};
  const bilan = fini ? Object.keys(gains).map((id) => ({ ...equipe(id), gain: gains[id] ?? 0, moi: id === teamId })).sort((a, b) => b.gain - a.gain) : null;
  let total = "";
  if (fini) total = totalEtPlace(st);
  coffres.ctl.maj({
    pret, cle: c.key ?? null, count: c.count ?? 0, ouverts, joue, aMoi, peutOuvrir, envoye: coffres.envoi,
    titre, texte, danger: c.danger === true, bilan, total,
  });
  // Prochain moment où l'écran change sans nouvel état : fin de l'animation (bouton) ou contenu montré par la TV.
  clearTimeout(coffres.alarme);
  const prochains = [aMoi && attente > 0 ? attente : null, suspense ? dernier.at + REVELATION_MS - now : null].filter((ms) => ms != null && ms > 0);
  if (prochains.length) coffres.alarme = setTimeout(render, Math.min(...prochains) + 50);
}

async function chooseChest(i) {
  const key = game.state?.chests?.key;
  if (i == null || !key || !coffres) return;
  coffres.envoi = i;
  coffres.message = null;
  beep(660, 120);
  navigator.vibrate?.(40);
  render();
  try {
    await set(ref(db, `games/${code}/chestChoice/${key}`), { i, at: serverTimestamp() });
  } catch {
    // Refusé (connexion, pause, animation pas finie) : on peut toucher un coffre de nouveau.
    if (coffres && game.state?.chests?.key === key) {
      coffres.envoi = null;
      coffres.message = "Le coffre ne s'est pas ouvert : touchez-le de nouveau dans un instant.";
    }
    render();
  }
}

/**
 * Le Gonfleur fou (écran gonfleur.js) : { ctl, cle, n, envoye, envoi, minuterie, ecoute } de la course en cours.
 * [n] = tapes de cette tablette depuis le départ, [envoye] = dernier nombre accepté par la base.
 */
let gonfleur = null;
function stopGonfleur() {
  if (!gonfleur) return;
  clearTimeout(gonfleur.minuterie);
  gonfleur.ecoute?.();
  gonfleur.ctl.detruire();
  gonfleur = null;
}

/** Ballon de l'équipe : tapes comptées ici, envoyées régulièrement ; la box décide du gagnant. */
function renderGonfleur(st) {
  clearInterval(timerHandle);
  show("gonfleur");
  const p = st.pump ?? null;
  gonfleur ??= { ctl: ecranGonfleur($("gonfleur-host"), { surTape: tapeGonfleur }), cle: null, n: 0, envoye: 0, envoi: false, minuterie: null, ecoute: null };
  // Nouvelle course (jeu rejoué) : on repart de zéro, en reprenant ce que la base a déjà reçu (tablette rechargée).
  if (p?.key && gonfleur.cle !== p.key) {
    gonfleur.ecoute?.();
    Object.assign(gonfleur, { cle: p.key, n: 0, envoye: 0 });
    const cle = p.key;
    gonfleur.ecoute = onValue(ref(db, `games/${code}/pumps/${cle}/${teamId}`), (s) => {
      const n = s.val()?.n ?? 0;
      if (!gonfleur || gonfleur.cle !== cle || n <= gonfleur.envoye) return;
      gonfleur.envoye = n;
      gonfleur.n = Math.max(gonfleur.n, n);
      render();
    });
  }
  const cible = p?.target ?? 100;
  const actif = !!p?.key && !st.paused && !counting(st) && gonfleur.n < cible;
  let titre = "Le Gonfleur fou"; let texte;
  if (!p?.key) texte = "Regardez la TV !";
  else if (st.paused) { titre = "Pause"; texte = "La partie reprend bientôt."; }
  else if (counting(st)) texte = "Préparez vos doigts…";
  else if (gonfleur.n >= cible) { titre = "BOUM !"; texte = "Votre ballon a éclaté : regardez la TV !"; }
  else texte = "Tapez le plus vite possible pour gonfler votre ballon. Relayez-vous !";
  gonfleur.ctl.maj({ n: gonfleur.n, cible, actif, titre, texte, couleur: game.teams[teamId]?.color });
}

function tapeGonfleur() {
  const st = game.state ?? {};
  const cible = st.pump?.target ?? 100;
  if (!gonfleur || st.kind !== "gonfleur" || st.paused || counting(st) || gonfleur.n >= cible) return;
  gonfleur.n += 1;
  if (gonfleur.n % 5 === 0) navigator.vibrate?.(8);
  redessinerGonfleur();
  // Ballon éclaté : envoi immédiat ; sinon au plus toutes les ENVOI_MS.
  if (gonfleur.n >= cible) { clearTimeout(gonfleur.minuterie); gonfleur.minuterie = null; envoyerTapes(); }
  else gonfleur.minuterie ??= setTimeout(() => { if (gonfleur) { gonfleur.minuterie = null; envoyerTapes(); } }, ENVOI_MS);
}

/**
 * Après une tape : seul le ballon est redessiné, une fois par image au plus. Redessiner toute la page à chaque tape
 * saturait une tablette modeste au départ de la course : les premières tapes semblaient sans effet, puis le ballon
 * gonflait d'un coup (cedric, 30/10).
 */
let imageGonfleur = 0;
function redessinerGonfleur() {
  if (imageGonfleur) return;
  imageGonfleur = requestAnimationFrame(() => {
    imageGonfleur = 0;
    const st = game.state;
    if (gonfleur && st?.kind === "gonfleur" && st.phase === "question") renderGonfleur(st);
  });
}

async function envoyerTapes() {
  const g = gonfleur;
  const p = game.state?.pump;
  if (!g || !p?.key || g.cle !== p.key || g.envoi || g.n <= g.envoye) return;
  // Jamais plus que ce que les règles acceptent maintenant : le reste part à l'envoi suivant.
  const n = Math.min(g.n, plafond(p.goAt ?? 0, Date.now() + serverOffset));
  const relance = () => { if (gonfleur === g && g.n > g.envoye) g.minuterie ??= setTimeout(() => { g.minuterie = null; envoyerTapes(); }, ENVOI_MS); };
  if (n <= g.envoye) return relance();
  g.envoi = true;
  try {
    await set(ref(db, `games/${code}/pumps/${p.key}/${teamId}`), { n, at: serverTimestamp() });
    g.envoye = Math.max(g.envoye, n);
  } catch {
    // Refusé (pause, réseau) : les tapes restent comptées, elles repartent au prochain envoi.
  } finally {
    g.envoi = false;
  }
  relance();
}

/** « Ça va exploser ! » (écran patate.js) : { ctl, cle, envoye, minuterie, message } de la réception en cours. */
let patate = null;
/** « Ça va exploser ! » : l'explosion à la TV (POTATO_BOOM_MS du moteur), puis l'annonce de la bombe suivante. */
const PATATE_BOUM_MS = 3500;
const PATATE_ANNONCE_MS = 3500;
/** Bombe 2 ou 3 allumée, pas encore partie (son départ est le décompte en cours). */
const bombeSuivante = (st) => st.kind === "patate" && (st.potato?.bomb ?? 1) > 1 && st.potato?.exploded !== true && st.potato?.since === st.resumeAt;
const liste = (x) => (Array.isArray(x) ? x : Object.values(x ?? {}));
function stopPatate() {
  if (!patate) return;
  clearTimeout(patate.minuterie);
  patate.ctl.detruire();
  patate = null;
}

/** « Ça va exploser ! » : chez nous, on choisit à qui envoyer la bombe ; sinon, on regarde chez qui elle est. */
function renderPatate(st) {
  clearInterval(timerHandle);
  show("patate");
  const p = st.potato ?? {};
  patate ??= { ctl: ecranPatate($("patate-host"), { surEnvoi: envoyerPatate }), cle: null, envoye: null, minuterie: null, message: null };
  // Nouvelle réception : rien d'envoyé.
  if (patate.cle !== (p.key ?? null)) { patate.cle = p.key ?? null; patate.envoye = null; patate.message = null; }
  const nom = (id) => game.teams[id]?.name ?? "une équipe";
  const now = Date.now() + serverOffset;
  // Plusieurs bombes par partie (3 d'office, réglé dans la Régie PC) : la dernière explosion se montre le temps que la TV la joue (et tant que la suivante n'est
  // pas allumée), puis la bombe suivante s'annonce avant de partir.
  const booms = liste(p.booms);
  const boom = booms[booms.length - 1];
  const finBoum = (boom?.at ?? 0) + PATATE_BOUM_MS;
  const boum = p.lit === true && boom != null && (p.exploded === true || now < finBoum);
  const compteur = p.lit === true && (p.bombs ?? 1) > 1 ? `Bombe ${p.bomb ?? 1} sur ${p.bombs}` : "";
  const aMoi = p.lit === true && !boum && p.holder === teamId && !st.paused && !counting(st);
  // Renvoi permis dès la réception (cedric, 27/10) ; seul le décompte d'une reprise le retient (readyAt = réception,
  // ou 2 s plus tard sur une box d'avant le 27/10).
  const depuis = p.since ?? 0;
  const pret = Math.max(p.readyAt ?? 0, st.resumeAt ?? 0);
  const colle = pret <= now ? 1 : Math.max(0, Math.min(1, (now - depuis) / Math.max(1, pret - depuis)));
  let titre; let texte;
  if (p.lit !== true) { titre = "Ça va exploser !"; texte = "La mèche va s'allumer… Regardez la TV !"; }
  else if (st.paused) { titre = "Pause"; texte = "La partie reprend bientôt."; }
  else if (boum) {
    const chezMoi = boom.holder === teamId;
    // Gardée plus de 2 secondes : elle a explosé avant la fin de la mèche.
    titre = chezMoi ? (boom.held === true ? "💥 BOUM ! Gardée plus de 2 secondes" : "💥 BOUM ! La bombe a explosé chez vous")
      : boom.held === true ? `💥 BOUM ! L'équipe ${nom(boom.holder)} l'a gardée trop longtemps` : `💥 BOUM chez l'équipe ${nom(boom.holder)} !`;
    texte = chezMoi ? ((boom.lost ?? 0) > 0 ? `−${boom.lost} points.` : "Vous n'aviez aucun point à perdre.") : `+${boom.gain ?? 0} points pour vous !`;
    if ((p.bomb ?? 1) < (p.bombs ?? 1) || p.exploded !== true) texte += " Attention, une autre bombe arrive…";
  } else if (bombeSuivante(st) && counting(st)) {
    titre = `💣 Bombe ${p.bomb} sur ${p.bombs} !`;
    texte = p.holder === teamId ? "Elle part de chez vous : préparez-vous à l'envoyer !" : `Elle part de chez l'équipe ${nom(p.holder)}…`;
  } else if (counting(st)) { titre = p.holder === teamId ? "💣 La bombe est chez vous !" : `La bombe est chez l'équipe ${nom(p.holder)}`; texte = "Attention, ça va partir…"; }
  else if (aMoi) {
    titre = "💣 La bombe est chez vous !";
    texte = patate.envoye ? `Envoyée à l'équipe ${nom(patate.envoye)} !` : colle < 1 ? "La mèche colle…" : "Vite, envoyez-la à une autre équipe !";
  } else { titre = `La bombe est chez l'équipe ${nom(p.holder)} !`; texte = (p.hit ?? []).includes(teamId) ? "Attention, elle peut revenir chez vous !" : "Préparez-vous, elle peut arriver chez vous !"; }
  if (patate.message) texte = patate.message;
  // Anti-triche (cedric, 21/10 et 27/10) : 2 secondes pour l'envoyer, sinon elle explose chez nous.
  const decompte = aMoi && colle >= 1 && !patate.envoye && p.holdUntil != null ? Math.min(2, Math.max(1, Math.ceil((p.holdUntil - now) / 1000))) : null;
  const equipes = (p.teams ?? []).filter((id) => id !== teamId && game.teams[id]).map((id) => ({
    id, nom: game.teams[id].name, couleur: game.teams[id].color,
    permise: (p.targets ?? []).includes(id), envoyeur: id === p.from, neuve: !(p.hit ?? []).includes(id),
  }));
  // La mèche brûle (heure de la tablette) : chez nous, le rouge bat et la tablette vibre de plus en plus vite.
  const brule = aMoi && p.burnFrom != null ? p.burnFrom - serverOffset : null;
  patate.ctl.maj({ titre, texte, aMoi, envoye: patate.envoye, colle, equipes, compteur, brule, boum, boumChezMoi: boum && boom.holder === teamId, decompte });
  // Chaque chiffre du 3, 2, 1 sonne, plus aigu au dernier.
  if (decompte != null && patate.chiffre !== decompte) beep(decompte === 1 ? 1320 : 880, 120);
  patate.chiffre = decompte;
  // Elle arrive chez nous : la tablette le signale.
  if (aMoi && patate.vue !== p.key) { patate.vue = p.key; navigator.vibrate?.([80, 60, 80]); beep(988, 160); }
  // Elle explose chez nous : longue vibration.
  if (boum && boom.holder === teamId && patate.boum !== boom.at) { patate.boum = boom.at; navigator.vibrate?.([500]); beep(180, 400); }
  clearTimeout(patate.minuterie);
  if (aMoi && colle < 1) patate.minuterie = setTimeout(render, 100);
  // 3, 2, 1 : la seconde suivante (le dernier chiffre reste jusqu'à l'explosion décidée par la TV).
  else if (decompte != null && p.holdUntil > now) patate.minuterie = setTimeout(render, ((p.holdUntil - now) % 1000 || 1000) + 20);
  // Fin de l'explosion, puis départ de la bombe suivante : l'écran change tout seul.
  else {
    const prochain = [boum ? finBoum : null, counting(st) ? st.resumeAt : null].filter((t) => t != null && t > now);
    if (prochain.length) patate.minuterie = setTimeout(render, Math.min(...prochain) - now + 50);
  }
}

async function envoyerPatate(to) {
  const key = game.state?.potato?.key;
  if (!key || !patate || patate.envoye) return;
  patate.envoye = to;
  patate.message = null;
  beep(660, 120);
  render();
  try {
    await set(ref(db, `games/${code}/potatoPass/${key}`), { to, at: serverTimestamp() });
  } catch {
    // Refusé (pause, décompte de reprise, réseau) : on peut renvoyer.
    if (patate && game.state?.potato?.key === key) {
      patate.envoye = null;
      patate.message = "La bombe n'est pas partie : touchez encore une équipe.";
    }
    render();
  }
}

/**
 * 🔴 Le Simon de Buzzy (écran simon.js) : { ctl, cle, saisie, envoye, minuterie } de la suite en cours. Les étapes se
 * calculent à l'heure du serveur : annonce des chiffres, le robot montre la suite (« Regarde bien la TV… »), le chrono
 * (on tape), puis la vérification de la TV avant de dire « éliminés » ou « gagné » (jamais avant la TV).
 */
let simon = null;
/** Vérification colonne par colonne à la TV (SIMON_VERIF_PAS_MS du moteur par élément, puis le bandeau). */
const SIMON_VERIF_PAS_MS = 700;
const SIMON_VERIF_FIN_MS = 1_500;
const SIMON_REGARDEZ_MS = 2_000;

function renderSimon(st) {
  clearInterval(timerHandle);
  show("simon");
  const sm = st.simon ?? {};
  simon ??= { ctl: ecranSimon($("simon-host"), { surTouche: toucheSimon, surEffacer: effacerSimon, surValider: validerSimon }), cle: null, saisie: [], envoye: false, minuterie: null };
  if (simon.cle !== (sm.key ?? null)) { simon.cle = sm.key ?? null; simon.saisie = []; simon.envoye = false; }
  const now = Date.now() + serverOffset;
  const joueur = sm.players?.[teamId];
  const duTour = joueur != null;
  const sorti = sm.out?.[teamId] != null;
  const v = sm.verdict;
  // La TV vérifie colonne par colonne avant d'annoncer : la tablette attend la fin pour ne rien dévoiler.
  const verifFin = v ? (v.at ?? 0) + (v.suite ?? 1) * SIMON_VERIF_PAS_MS + SIMON_VERIF_FIN_MS : 0;
  const nom = (id) => game.teams[id]?.name ?? "une équipe";
  let etat; let titre; let texte = ""; let chrono = null; let prochain = null;
  // Plus de « joueur n° » sur la tablette (cedric, 31/10 : l'équipe joue, la rotation des enfants se fait entre eux).
  const joueurTexte = "";
  if (st.paused) { etat = "attente"; titre = "Pause"; texte = "La partie reprend bientôt."; }
  else if (sm.step === "play") {
    if (sm.chiffresAt != null && now < sm.montreAt - SIMON_REGARDEZ_MS) { etat = "chiffres"; titre = "Attention, les chiffres débarquent !"; prochain = sm.montreAt - SIMON_REGARDEZ_MS; }
    else if (now < sm.reponseAt) { etat = "regarde"; titre = "Regarde et retiens bien les couleurs…"; texte = `Série n° ${sm.suite}`; prochain = sm.reponseAt; }
    else if (!duTour || sorti) { etat = "spectateur"; titre = "Les autres équipes jouent…"; texte = sorti ? "Éliminé de ce tour : tu rejoueras au prochain." : "Tu joueras au prochain tour."; }
    else if (simon.envoye) { etat = "envoye"; titre = "Couleurs envoyées !"; texte = "Regarde la TV : vérification à la fin du chrono."; }
    else if (now <= sm.finAt) {
      etat = "joue"; titre = "À toi ! Tape les couleurs";
      chrono = (sm.finAt - now) / Math.max(1, sm.finAt - sm.reponseAt);
      prochain = now + 250;
    } else { etat = "envoye"; titre = "Temps écoulé !"; texte = "Regarde la TV."; }
  } else if (v && now < verifFin) { etat = "regarde"; titre = "Vérification…"; texte = "Regarde la TV !"; prochain = verifFin; }
  else if (v && (v.winners ?? []).includes(teamId)) { etat = "gagne"; titre = "Bravo, tu gagnes le tour !"; texte = v.points ? `+${v.points} points` : ""; }
  else if (v && (v.wrong ?? []).includes(teamId)) { etat = "elimine"; titre = "Éliminé du tour…"; texte = sm.step === "won" ? "Le tour est fini." : "Tu rejoueras au prochain tour."; }
  else if (v?.bahAlors) { etat = "attente"; titre = "Bah alors ?!"; texte = "Personne n'a trouvé : on recommence les mêmes couleurs."; }
  else if (sm.step === "won") {
    const gagnants = (v?.winners ?? []).map(nom);
    etat = "attente"; titre = gagnants.length ? `${gagnants.join(" et ")} ${gagnants.length > 1 ? "gagnent" : "gagne"} le tour !` : "Tour terminé";
    texte = sm.last ? "C'était le dernier tour !" : "Le tour suivant arrive…";
  } else if (v && duTour && !sorti) { etat = "attente"; titre = "Bravo, tu continues !"; texte = "La prochaine série aura une couleur de plus."; }
  else if (sm.step === "ready" || sm.step === "judged") {
    etat = "attente"; titre = "Le Simon de Buzzy";
    texte = !duTour ? "Tu joueras au prochain tour." : sorti ? "Éliminé de ce tour : tu rejoueras au prochain." : "Prochaine série : prépare-toi !";
  } else { etat = "attente"; titre = "Le Simon de Buzzy"; texte = "Regarde la TV !"; }
  simon.ctl.maj({
    etat, titre, texte, chrono, joueur: etat === "joue" || etat === "regarde" ? joueurTexte : "",
    chiffres: sm.chiffres === true, saisie: simon.saisie, longueur: sm.suite ?? 0,
  });
  clearTimeout(simon.minuterie);
  if (prochain != null) simon.minuterie = setTimeout(render, Math.max(50, Math.min(1_000, prochain - now + 20)));
}

/** Simon de Buzzy : envoie ce que l'équipe a tapé (à chaque appui, pour la TV en direct), [ok] = « Valider ». */
async function envoyerSimon(ok = false) {
  const key = game.state?.simon?.key;
  if (!key || !simon || simon.cle !== key || simon.envoye) return;
  if (ok) simon.envoye = true;
  render();
  try {
    await set(ref(db, `games/${code}/simon/${key}/${teamId}`), { items: simon.saisie.join(","), ok, at: serverTimestamp() });
  } catch {
    // Refusé (chrono fini, pause, réseau) : on peut revalider tant que la suite joue.
    if (ok && simon?.cle === key) simon.envoye = false;
    render();
  }
}

function toucheSimon(item) {
  const sm = game.state?.simon;
  if (!simon || simon.envoye || simon.saisie.length >= (sm?.suite ?? 0)) return;
  simon.saisie = [...simon.saisie, item];
  beep(noteSimon(item), 160);
  envoyerSimon(false);
}

function effacerSimon() {
  if (!simon || simon.envoye || !simon.saisie.length) return;
  simon.saisie = simon.saisie.slice(0, -1);
  envoyerSimon(false);
}

function validerSimon() {
  if (!simon || simon.envoye || simon.saisie.length < (game.state?.simon?.suite ?? 0)) return;
  beep(1046, 120);
  envoyerSimon(true);
}

/**
 * Fin de la fête : la place et les points n'arrivent sur la tablette qu'une fois le gagnant annoncé à la TV (jauges au
 * bout, solo de Digital Love en Game Show ; impact en Classique), pas avant (cedric, 26/10). D'ici là : du suspense.
 */
const ANNONCE_GAGNANT_MS = { gs: 15_444, classique: 7_000 };
const MARGE_ANNONCE_MS = 1_500;
let finHandle = null;
function renderEnded(st) {
  clearInterval(timerHandle);
  clearTimeout(finHandle);
  show("ended");
  const annonce = (st.endedAt ?? 0) + (lookGs ? ANNONCE_GAGNANT_MS.gs : ANNONCE_GAGNANT_MS.classique) + MARGE_ANNONCE_MS;
  const reste = annonce - (Date.now() + serverOffset);
  const attente = st.endedAt != null && reste > 0;
  $("screen-ended").classList.toggle("suspense", attente);
  if (attente) {
    $("e-rank").textContent = "Le grand gagnant est…";
    $("e-total").textContent = "Regardez la télé !";
    finHandle = setTimeout(() => { if (game.state === st) renderEnded(st); }, reste + 50);
    return;
  }
  const { mine, rank } = rankOf(st.scores);
  $("e-rank").textContent = rank === 1 ? "Vous avez gagné !" : `${rank}e place`;
  $("e-total").textContent = `${mine} points`;
}

/** Petit air rigolo, jamais le même deux fois de suite : trois notes qui montent ou qui descendent. */
const FUN_TUNES = [[523, 659, 784], [784, 659, 523], [659, 880, 1047], [392, 523, 392], [880, 698, 1175]];
let funTune = 0;
function funSound() {
  funTune = (funTune + 1 + Math.floor(Math.random() * (FUN_TUNES.length - 1))) % FUN_TUNES.length;
  FUN_TUNES[funTune].forEach((f, i) => setTimeout(() => beep(f, 110), i * 90));
}

/**
 * Design The Game Show : au buzz, la tablette joue le même mot de Daft Punk que la TV pour son équipe (« Work it »…
 * « Stronger », cedric 24/10). La place de l'équipe se compte comme sur la TV : ordre d'arrivée, 8 équipes au plus.
 * Les 8 mots (100 Ko en tout) se chargent dès l'entrée dans l'équipe ; tant qu'ils ne sont pas prêts, le petit air
 * habituel.
 */
const motsEquipes = [];
let motsDemandes = false;
function chargerMotsEquipes() {
  if (!lookGs || motsDemandes || !audio) return;
  motsDemandes = true;
  for (let k = 0; k < 8; k++) {
    fetch(`sons-gs/equipe-${k + 1}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((b) => audio.decodeAudioData(b)).then((buf) => { motsEquipes[k] = buf; }).catch(() => {});
  }
}
function placeEquipe() {
  return Object.entries(game.teams).filter(([, t]) => t?.name).sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0))
    .slice(0, 8).findIndex(([id]) => id === teamId);
}
/** Son du buzz : le mot de l'équipe en Game Show, sinon (ou pas encore chargé) le son d'avant. */
function sonBuzz(sinon) {
  const buf = lookGs ? motsEquipes[placeEquipe()] : null;
  if (!buf || !audio) return sinon();
  try {
    const src = audio.createBufferSource();
    src.buffer = buf; src.connect(audio.destination); src.start();
  } catch { sinon(); }
}

$("buzz").onclick = async () => {
  // Duel des robots : l'heure de l'appui (heure du serveur) : celle où la touche ou le doigt est descendu, pas celle du
  // clic (doigt relevé), prise avant tout le reste.
  const p = dernierAppui != null && performance.now() - dernierAppui < 1_000 ? dernierAppui : performance.now();
  dernierAppui = null;
  const appui = heureServeur(p);
  const buzz = $("buzz");
  if (buzz.disabled) return;
  if (game?.state?.kind === "duel" && game.state.phase === "question") return buzzDuel(game.state, appui);
  if (game?.state?.kind === "chrono" && game.state.phase === "question") return buzzChrono(game.state, appui);
  if (BUZZ_KINDS.includes(game?.state?.kind) && game.state.phase === "question") return buzzFlou(game.state);
  sonBuzz(funSound);
  navigator.vibrate?.(60);
  buzz.classList.remove("bump");
  void buzz.offsetWidth;
  buzz.classList.add("bump");
  try {
    await set(ref(db, `games/${code}/fun/${teamId}`), { at: serverTimestamp() });
  } catch {
    // Appuis trop rapprochés : la base ignore celui-ci, le suivant passera.
  }
};

// Gros buzzer USB branché sur la tablette : elle le voit comme un clavier d'une seule touche. Un appui sur n'importe
// quelle touche fait comme un toucher du BUZZ de l'écran, seulement quand il est affiché ; sans buzzer, rien ne change.
// Au Gonfleur fou, chaque appui gonfle le ballon comme une tape sur le bouton (cedric, 31/10 : « vérifie dans tous les jeux »).
const buzzAffiche = () => !$("buzz").hidden && $("screen-play").classList.contains("active");
const gonfleurAffiche = () => !!gonfleur && $("screen-gonfleur").classList.contains("active");
const TOUCHES_SYSTEME = /^(Shift|Control|Alt|Meta|OS|Fn|Hyper|Super|CapsLock|NumLock|ScrollLock|Tab|Escape|Unidentified|Dead|Process|Audio|Media|Browser|Launch|Power|Brightness|Volume|Help|ContextMenu|PrintScreen)/;
const enFrappe = (e) => e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]");
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey || TOUCHES_SYSTEME.test(e.key)) return;
  // Un nom d'équipe ou un mot de passe en cours de frappe : la touche sert à écrire. La régie n'a pas de gros bouton.
  if (enFrappe(e) || document.body.classList.contains("regie-mode")) return;
  // Le gros bouton est souvent réglé sur Entrée : il n'appuie jamais sur le bouton de l'écran touché en dernier
  // (une réponse, une équipe à qui passer la patate…), ni deux fois si on le garde enfoncé.
  e.preventDefault();
  if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
  if (!e.repeat && buzzAffiche()) {
    dernierAppui = e.timeStamp || performance.now();
    $("buzz").click();
  } else if (!e.repeat && gonfleurAffiche()) gonfleur.ctl.appuyer();
});
// Espace appuie sur un bouton au relâché : même garde.
document.addEventListener("keyup", (e) => { if (e.key === " " && !enFrappe(e) && !document.body.classList.contains("regie-mode")) e.preventDefault(); });
// Buzzer réglé en usine comme un clic de souris : un clic n'importe où sur l'écran du BUZZ compte (sur le BUZZ lui-même,
// c'est déjà un clic normal). Les doigts sur l'écran ne sont pas concernés.
document.addEventListener("pointerdown", (e) => {
  // Duel des robots : le doigt posé sur le BUZZ compte tout de suite (pas au doigt relevé).
  if (e.target instanceof Element && e.target.closest("#buzz") && buzzAffiche()) {
    dernierAppui = e.timeStamp || performance.now();
    if (["duel", "chrono"].includes(game?.state?.kind) && !$("buzz").disabled) $("buzz").click();
    return;
  }
  if (e.pointerType !== "mouse" || !buzzAffiche()) return;
  e.preventDefault();
  $("buzz").click();
}, true);
document.addEventListener("contextmenu", (e) => { if (buzzAffiche()) e.preventDefault(); });

// ---------- Accès régie ----------

let usePin = false;

function regieStatus(text, info = false) {
  $("regie-status").textContent = text;
  $("regie-status").classList.toggle("info", info);
}

function openRegieLogin() {
  usePin = false;
  $("regie-password").hidden = false;
  $("regie-pin").hidden = true;
  $("regie-use-pin").hidden = false;
  $("regie-password").value = "";
  $("regie-pin").value = "";
  regieStatus("");
  $("regie-login").hidden = false;
  $("regie-password").focus();
}

$("regie-open").onclick = openRegieLogin;
$("gate-regie").onclick = openRegieLogin;
$("regie-cancel").onclick = () => { $("regie-login").hidden = true; };
$("regie-use-pin").onclick = () => {
  usePin = true;
  $("regie-password").hidden = true;
  $("regie-pin").hidden = false;
  $("regie-use-pin").hidden = true;
  regieStatus("Sur la TV : bouton Retour de la télécommande, puis « Code de secours de la régie ».", true);
  $("regie-pin").focus();
};

const LOGIN_MESSAGES = {
  wrong: "Mot de passe de régie incorrect (ce n'est pas celui de l'administration). Il se change dans l'administration, Paramètres.",
  ended: "Cette partie est terminée. Scannez le QR code affiché en ce moment sur la TV.",
  refused: "Mot de passe correct, mais la partie a refusé l'accès. Rechargez la page et réessayez.",
  unset: "Aucun mot de passe de régie n'est encore enregistré. Utilisez le code affiché sur la TV.",
  busy: "Trop d'essais en même temps. Réessayez dans quelques secondes.",
  pinWrong: "Code incorrect. Regardez le code à 4 chiffres sur la TV.",
  locked: "Trop d'essais. Patientez une minute puis réessayez.",
  full: "Deux téléphones sont déjà reliés par code. Retirez-les depuis la TV.",
};

$("regie-form").onsubmit = async (e) => {
  e.preventDefault();
  const password = $("regie-password").value;
  const pin = $("regie-pin").value.trim();
  if (usePin && !/^[0-9]{4}$/.test(pin)) return regieStatus("Le code de la TV a 4 chiffres.");
  if (!usePin && !password) return regieStatus("Saisissez le mot de passe de régie.");
  $("regie-go").disabled = true;
  regieStatus("Vérification…", true);
  try {
    const result = usePin ? await loginWithPin({ db, uid }, code, pin) : await loginWithPassword({ db, uid }, code, password);
    if (result === "ok") return enterRegie();
    regieStatus(LOGIN_MESSAGES[usePin && result === "wrong" ? "pinWrong" : result]
      ?? "La TV ne répond pas. Vérifiez qu'elle est allumée et connectée.");
  } catch (err) {
    console.error(err);
    regieStatus("Connexion impossible. Vérifiez Internet puis réessayez.");
  } finally {
    $("regie-go").disabled = false;
  }
};

function enterRegie() {
  stopListening();
  clearInterval(timerHandle);
  // Le téléphone de l'animatrice avait peut-être demandé à entrer comme une tablette : sa demande disparaît.
  if (code && uid) set(ref(db, `games/${code}/joinRequests/${uid}`), null).catch(() => {});
  $("regie-login").hidden = true;
  $("regie").hidden = false;
  document.body.classList.add("regie-mode");
  startRegie({ db, uid }, code, exitRegie);
}

function exitRegie(message) {
  document.body.classList.remove("regie-mode");
  $("regie").hidden = true;
  fail(message);
}

$("retry").onclick = start;
$("affiche-photo").onclick = () => ouvrirScanner();
start();
