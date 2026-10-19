import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth, signInAnonymously, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, onValue, onDisconnect, serverTimestamp, connectDatabaseEmulator,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { TEAM_COLORS, CHOICE_COLORS, CHOICE_LETTERS, MAX_TEAMS } from "./theme.js";
import { hasAccess, loginWithPassword, loginWithPin, startRegie } from "./regie.js";
import { watchVersion, showUpdateBanner } from "./version.js";
import { setAwake, isAwake, onAwakeChange } from "./awake.js";
import { envoyeurDessin } from "./picto.js";
import { creerArdoise, choisirMot } from "./ardoise.js";
import { animationSpectateurs } from "./spectateurs.js";

const $ = (id) => document.getElementById(id);
/** Jeux au buzzer : un seul grand BUZZ, la réponse se donne à voix haute. */
const BUZZ_KINDS = ["flou", "chante", "quisuis", "blind", "disparu"];
const BUZZ_INVITE = {
  flou: "Image floue : buzzez dès que vous la reconnaissez !",
  chante: "Chante le mot ! Buzzez et chantez une chanson avec le mot de la TV !",
  quisuis: "Qui suis-je ? Écoutez les indices de la TV et buzzez dès que vous savez !",
  blind: "Blind test : écoutez la musique et buzzez dès que vous reconnaissez la chanson !",
  disparu: "Qui a disparu ? Buzzez dès que vous savez quel objet manque sur la TV !",
};
const params = new URLSearchParams(location.search);
const code = (params.get("g") || "").toUpperCase();
// Tests automatiques uniquement : l'émulateur Firebase n'est accepté que depuis l'ordinateur de test.
const emulator = params.has("emu") && ["localhost", "127.0.0.1"].includes(location.hostname);

let db, uid, gameRef;
/** Équipe jouée par cet appareil : la sienne, ou celle dont il remplace l'appareil. */
let teamId = null;
let lateJoin = false;
let presenceRef = null;
let chosenColor = TEAM_COLORS[0];
let audio;
let serverOffset = 0;
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
const SAFE_TO_RELOAD = new Set(["play", "result", "ended", "error", "loading", "replaced", "watch"]);
function maybeReload() {
  if (!newVersion) return;
  if (document.body.classList.contains("regie-mode") || !$("regie-login").hidden) {
    return showUpdateBanner("Nouvelle version de la régie en ligne : touchez « Mettre à jour » quand vous voulez (la partie continue).");
  }
  if (SAFE_TO_RELOAD.has(lastScreen)) location.reload();
}
watchVersion(() => { newVersion = true; maybeReload(); });

/** Écrans où l'équipe joue (salon compris) : la tablette reste allumée, même si personne ne la touche. */
const AWAKE_SCREENS = new Set(["waiting", "play", "question", "result", "pick", "draw", "watch"]);
/** Écrans où la partie est finie pour cet appareil : la veille normale d'Android reprend. */
const SLEEP_SCREENS = new Set(["join", "ended", "replaced"]);

function show(name) {
  // « Accès régie » : sur l'écran d'inscription (et si la partie est complète), jamais pendant le jeu.
  $("regie-open").hidden = !(gameExists && (name === "join" || name === "error"));
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

function fail(message) {
  stopListening();
  $("error-text").textContent = message;
  show("error");
}

function beep(freq = 880, ms = 180) {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
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

/** Plein écran au premier toucher (l'écran allumé, lui, suit l'état de la partie : voir show()). */
async function keepAwake() {
  try { await document.documentElement.requestFullscreen?.(); } catch { /* iOS : pas de plein écran */ }
}

async function start() {
  show("loading");
  lastScreen = "loading";
  if (!code) return fail("Scannez le QR code affiché sur la TV pour rejoindre une partie.");
  try {
    if (!db) {
      const config = await (await fetch("firebase-config.json", { cache: "no-store" })).json();
      const app = initializeApp(config);
      const auth = getAuth(app);
      db = getDatabase(app);
      if (emulator) {
        connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
        connectDatabaseEmulator(db, "127.0.0.1", 9000);
      }
      // L'identifiant anonyme est conservé par le navigateur : après un rechargement,
      // le pupitre retrouve automatiquement son équipe.
      uid = (await signInAnonymously(auth)).user.uid;
    }
    gameRef = ref(db, `games/${code}`);
    const host = await get(ref(db, `games/${code}/hostUid`));
    gameExists = host.exists();
    if (!host.exists()) return fail(`La partie ${code} n'existe pas ou est terminée.`);
    // Téléphone de l'animatrice déjà relié : retour direct à la régie (rechargement, écran verrouillé).
    if (await hasAccess({ db, uid }, code)) return enterRegie();
    const teams = (await get(ref(db, `games/${code}/teams`))).val() ?? {};
    const mine = myTeam(teams);
    if (mine && isReplaced(teams, mine)) return showReplaced(teams[mine]);
    if (mine) { teamId = mine; return play(); }
    // Partie commencée : un nouvel appareil n'entre que si la régie l'accepte (nouvelle équipe ou remplaçant).
    const phase = (await get(ref(db, `games/${code}/state/phase`))).val() ?? "lobby";
    if (phase === "ended") return fail("Cette partie est terminée. Merci d'avoir joué !");
    if (phase === "lobby" && Object.keys(teams).length >= MAX_TEAMS) return fail(`La partie est complète (${MAX_TEAMS} équipes maximum).`);
    showJoin(phase !== "lobby");
  } catch (e) {
    console.error(e);
    fail("Connexion impossible. Vérifiez Internet puis réessayez.");
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

// Nouvelle page, nouvelle prestation : on part d'un champ vide, même si le navigateur a gardé un ancien nom.
$("team-name").value = "";

/** Couleurs déjà prises par une autre équipe : réservées dans la base, ou portées par une équipe déjà inscrite. */
let takenColors = new Set();
const colorKey = (c) => c.slice(1).toUpperCase();

function showJoin(late = false) {
  lateJoin = late;
  stopListening();
  $("join-late").hidden = !late;
  $("join-error").hidden = true;
  $("join").textContent = late ? "Demander à entrer" : "Rejoindre la partie";
  let reserved = {};
  let teams = {};
  const refresh = () => {
    takenColors = new Set([
      ...Object.entries(reserved).filter(([, owner]) => owner !== uid).map(([k]) => k),
      ...Object.entries(teams).filter(([id]) => id !== uid).map(([, t]) => t?.color && colorKey(t.color)).filter(Boolean),
    ]);
    // Couleur choisie prise entre-temps : on passe à la première libre.
    if (takenColors.has(colorKey(chosenColor))) chosenColor = TEAM_COLORS.find((c) => !takenColors.has(colorKey(c))) ?? chosenColor;
    renderColors();
  };
  listen(`games/${code}/colors`, (snap) => { reserved = snap.val() ?? {}; refresh(); });
  listen(`games/${code}/teams`, (snap) => { teams = snap.val() ?? {}; refresh(); });
  renderColors();
  show("join");
  $("team-name").focus();
  // Prestation chargée : on accueille les équipes avec le prénom de l'enfant fêté.
  get(ref(db, `games/${code}/public`)).then((s) => {
    const p = s.val();
    $("join-welcome").textContent = p?.childName ? `Joyeux anniversaire ${p.childName} !` : p?.title ?? "";
    $("join-welcome").hidden = !$("join-welcome").textContent;
  }).catch(() => {});
}

function renderColors() {
  const box = $("colors");
  box.innerHTML = "";
  TEAM_COLORS.forEach((c) => {
    const b = document.createElement("button");
    const taken = takenColors.has(colorKey(c));
    b.style.background = c;
    b.setAttribute("aria-label", taken ? `${c} (déjà prise)` : c);
    b.dataset.color = c;
    b.disabled = taken;
    b.classList.toggle("taken", taken);
    b.classList.toggle("selected", c === chosenColor);
    b.onclick = () => {
      chosenColor = c;
      $("join-error").hidden = true;
      box.querySelectorAll("button").forEach((x) => x.classList.toggle("selected", x === b));
    };
    box.appendChild(b);
  });
}

$("join").onclick = async () => {
  const name = $("team-name").value.trim();
  if (!name) return $("team-name").focus();
  $("join").disabled = true;
  // La couleur demandée à l'appui : l'écouteur des couleurs peut en changer pendant l'écriture.
  const wanted = chosenColor;
  beep(660, 120); // débloque le son du navigateur dès le premier toucher
  keepAwake();
  try {
    if (lateJoin) {
      await set(ref(db, `games/${code}/joinRequests/${uid}`), { name, color: wanted, at: serverTimestamp() });
      return waitForAdmission();
    }
    // L'équipe et sa couleur dans la même écriture : la base refuse une couleur déjà réservée par une autre équipe.
    await update(ref(db, `games/${code}`), {
      [`teams/${uid}`]: { name, color: wanted, joinedAt: serverTimestamp() },
      [`colors/${colorKey(wanted)}`]: uid,
    });
    teamId = uid;
    play();
  } catch (e) {
    console.error(e);
    // Une autre équipe vient de prendre cette couleur : on le dit et on propose les couleurs encore libres.
    const owner = !lateJoin && (await get(ref(db, `games/${code}/colors/${colorKey(wanted)}`)).catch(() => null))?.val();
    if (owner && owner !== uid) {
      $("join-error").textContent = "Cette couleur vient d'être prise par une autre équipe : choisissez-en une autre.";
      $("join-error").hidden = false;
      takenColors.add(colorKey(wanted));
      if (chosenColor === wanted) chosenColor = TEAM_COLORS.find((c) => !takenColors.has(colorKey(c))) ?? chosenColor;
      renderColors();
      return;
    }
    // Refusé le plus souvent parce que le quiz vient d'être lancé : on repasse par l'accueil, qui propose
    // alors de demander à entrer (le nom tapé et la couleur restent).
    if (!lateJoin) return start();
    fail("Impossible de rejoindre la partie.");
  } finally {
    $("join").disabled = false;
  }
};

/** Demande envoyée : on attend que la régie crée l'équipe ou rattache cet appareil à une équipe. */
function waitForAdmission() {
  stopListening();
  show("waiting");
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
      if (!admitted()) fail("L'animatrice n'a pas fait entrer cet appareil. Réessayez ou demandez-lui.");
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
  listen(`games/${code}/state`, (s) => { game.state = s.val(); watchMyAnswer(); render(); });
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
  $("paused").hidden = !st.paused;
  runResumeCountdown(st);
  // Saut vers un autre jeu en plein Pictionary : l'ardoise, les mots et l'animation s'arrêtent.
  if (st.kind !== "pictionary" || !st.mime) stopPicto();
  switch (st.phase) {
    case "question":
    case "closed":
      return st.mime ? (st.kind === "pictionary" ? renderPicto(st) : renderMime(st)) : st.kind === "statues" ? renderStatues(st) : BUZZ_KINDS.includes(st.kind) ? renderFlou(st) : renderQuestion(st);
    case "reveal":
    case "scores":
      stopPicto();
      return st.mime ? renderMimeResult(st) : renderResult(st);
    case "ended":
      stopPicto();
      return renderEnded(st);
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
  $("play-status").textContent = "En attendant le quiz : buzzez autant que vous voulez !";
}

function renderQuestion(st) {
  show("question");
  $("q-number").textContent = st.kind === "express" ? "Vrai ou Faux express !"
    : st.kind === "zoom" ? "Zoom mystère : regardez la TV !" : st.kind === "portes" ? "Portes mystères !" : `Question ${(st.index ?? 0) + 1} / ${st.total ?? "?"}`;
  $("q-double").hidden = !st.double;
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
      b.innerHTML = `<span class="letter">${st.kind === "portes" ? "🚪" : CHOICE_LETTERS[i]}</span><span class="text"></span>`;
      if (st.kind === "portes") b.classList.add("door");
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
  if (st.kind === "portes") {
    // Portes mystères : un seul choix, en secret ; les portes s'ouvrent ensuite une à une sur la TV.
    $("q-status").textContent = mine != null ? `${choices[mine] ?? "Porte choisie"}… suspense ! Regardez la TV.`
      : st.phase === "closed" ? "Les choix sont fermés !" : "Choisissez une porte : derrière, un bonus… ou un malus !";
  } else if (mine != null) $("q-status").textContent = `Réponse ${CHOICE_LETTERS[mine]} envoyée ! Attendez la révélation…`;
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
  const set_ = (data) => { if (typeof data === "string" && data.startsWith("data:image/")) { img.src = data; img.hidden = false; } };
  if (choicePhotos.has(id)) return set_(choicePhotos.get(id));
  get(ref(db, `games/${code}/choiceImages/${id}`)).then((snap) => {
    if (typeof snap.val() === "string") choicePhotos.set(id, snap.val());
    set_(snap.val());
  }).catch((e) => console.warn("Photo de réponse non lue", id, e));
}

/** Le Juste Chiffre : un pavé de chiffres, un nombre envoyé une seule fois, comme une réponse. */
let numberDraft = "";
const NUMBER_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "−", "0", "⌫"];
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
      const b = document.createElement("button");
      b.className = "number-key";
      b.textContent = k;
      b.dataset.key = k;
      b.onclick = () => {
        if (k === "⌫") numberDraft = numberDraft.slice(0, -1);
        else if (k === "−") numberDraft = numberDraft.startsWith("-") ? numberDraft.slice(1) : `-${numberDraft}`;
        else if (numberDraft.replace("-", "").length < 9) numberDraft = numberDraft === "0" ? k : numberDraft === "-0" ? `-${k}` : numberDraft + k;
        beep(1200, 40);
        render();
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
 * après une erreur, cette équipe ne rebuzze plus sur cette image et les autres peuvent tenter leur chance.
 */
function renderFlou(st) {
  clearInterval(timerHandle);
  show("play");
  const buzz = $("buzz");
  buzz.hidden = false;
  const b = st.buzz ?? {};
  const blocked = (b.blocked ?? []).includes(teamId);
  const open = st.phase === "question" && st.buzzOpen === true && !st.paused && !counting(st) && !b.team && !blocked;
  buzz.disabled = !open;
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
  else if (blocked) $("play-status").textContent = `Raté pour ${st.kind === "flou" ? "cette image" : chante ? "ce mot" : st.kind === "blind" ? "cette chanson" : st.kind === "disparu" ? "cette fois" : "ce personnage"}… Les autres équipes peuvent encore buzzer.`;
  else $("play-status").textContent = BUZZ_INVITE[st.kind] ?? BUZZ_INVITE.flou;
}

async function buzzFlou(st) {
  const buzz = $("buzz");
  buzz.disabled = true;
  beep(880, 160);
  navigator.vibrate?.(120);
  try {
    // Le premier qui écrit gagne : les règles refusent les buzz suivants sous la même clé.
    await set(ref(db, `games/${code}/buzz/${st.round}`), { team: teamId, at: serverTimestamp() });
  } catch {
    // Une autre équipe a été plus rapide, ou le buzzer vient de se fermer : l'écran suit l'état de la TV.
  }
}

/** Statues musicales : rien à toucher, tout le monde danse devant la TV et se fige quand la musique s'arrête. */
function renderStatues(st) {
  clearInterval(timerHandle);
  show("play");
  const buzz = $("buzz");
  buzz.disabled = true;
  buzz.hidden = true;
  $("play-status").textContent = st.phase === "closed"
    ? "Fin de la musique ! L'animatrice désigne l'équipe gagnante."
    : "Statues musicales ! Posez la tablette et dansez tant que la musique joue. Quand elle s'arrête : STATUE !";
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
  if (m.team === teamId) $("play-status").textContent = "C'est votre tour ! Celui qui devine se met dos à la TV, les autres miment.";
  else if (m.team) $("play-status").textContent = `C'est au tour de ${game.teams[m.team]?.name ?? "une autre équipe"} : regardez-les mimer !${found}`;
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
  const { mine, rank } = rankOf(st.scores);
  $("r-total").textContent = `${mine} points · ${rank === 1 ? "1re place" : `${rank}e place`}`;
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
    choix = choisirMot($("pick-host"), m.offer.map((c) => ({ mot: c.word, image: c.image ?? "✏️" })), {
      surChoix: (i) => choosePicto(m.pickKey, i),
    });
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
    if (ms > 0) $("resume-num").textContent = `${Math.min(9, Math.ceil(ms / 1000))}`;
    else { clearInterval(countdownHandle); countdownHandle = null; if (st.phase === "question") render(); }
  };
  const ms = st.paused || st.resumeAt == null ? 0 : st.resumeAt - (Date.now() + serverOffset);
  if (ms <= 0) { box.hidden = true; return; }
  tick();
  countdownHandle = setInterval(tick, 100);
}

function runTimer(st, el = $("q-timer")) {
  clearInterval(timerHandle);
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
  if (st.kind === "portes") return renderPortesResult(st, award);
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
  const { mine, rank } = rankOf(st.scores);
  $("r-total").textContent = `${mine} points · ${rank === 1 ? "1re place" : `${rank}e place`}`;
}

/**
 * Portes mystères : le résultat de l'équipe n'apparaît qu'au moment où sa porte s'ouvre sur la TV (sinon la
 * tablette gâcherait le suspense), le total et la place seulement une fois toutes les portes ouvertes.
 */
function renderPortesResult(st, award) {
  const p = st.portes ?? {};
  const door = award?.choice;
  const opened = (p.order ?? []).slice(0, p.opened ?? 0);
  const mineOpen = door != null && opened.includes(door);
  const all = st.phase === "scores" || (p.opened ?? 0) >= (p.count ?? 0);
  const name = door != null ? st.choices?.[door] ?? `Porte ${door + 1}` : null;
  $("r-icon").className = `result-icon ${mineOpen && award.points > 0 ? "ok" : "ko"}`;
  $("r-icon").textContent = !mineOpen ? "🚪" : award.points > 0 ? "🎁" : award.points < 0 ? "🐢" : "🫧";
  $("r-title").textContent = door == null ? "Pas de porte choisie"
    : !mineOpen ? `${name}… suspense !`
    : award.points > 0 ? `BONUS ! +${award.points} points` : award.points < 0 ? `Aïe, un malus ! −${-award.points} points` : "Ouf, le malus ne vous retire rien !";
  $("r-detail").textContent = door == null ? "" : mineOpen ? `Derrière la ${name.toLowerCase()}` : "Les portes s'ouvrent une à une sur la TV…";
  $("r-image").hidden = true;
  if (all) {
    const { mine, rank } = rankOf(st.scores);
    $("r-total").textContent = `${mine} points · ${rank === 1 ? "1re place" : `${rank}e place`}`;
  } else $("r-total").textContent = "Classement à la fin des portes !";
}

function renderEnded(st) {
  clearInterval(timerHandle);
  show("ended");
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

$("buzz").onclick = async () => {
  const buzz = $("buzz");
  if (buzz.disabled) return;
  if (BUZZ_KINDS.includes(game?.state?.kind) && game.state.phase === "question") return buzzFlou(game.state);
  funSound();
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
start();
