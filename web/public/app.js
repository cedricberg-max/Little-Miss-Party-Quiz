import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth, signInAnonymously, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import {
  getDatabase, ref, get, set, onValue, onDisconnect, serverTimestamp, connectDatabaseEmulator,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { TEAM_COLORS, CHOICE_COLORS, CHOICE_LETTERS, MAX_TEAMS } from "./theme.js";
import { hasAccess, loginWithPassword, loginWithPin, startRegie } from "./regie.js";

const $ = (id) => document.getElementById(id);
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

function show(name) {
  // « Accès régie » : sur l'écran d'inscription (et si la partie est complète), jamais pendant le jeu.
  $("regie-open").hidden = !(gameExists && (name === "join" || name === "error"));
  if (lastScreen === name) return;
  lastScreen = name;
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === `screen-${name}`));
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

let wakeLock = null;
async function keepAwake() {
  try { await document.documentElement.requestFullscreen?.(); } catch { /* iOS : pas de plein écran */ }
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* facultatif */ }
}
// Le navigateur relâche l'écran allumé quand la page passe en arrière-plan : on le redemande au retour.
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && wakeLock) {
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* facultatif */ }
  }
});

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

function showJoin(late = false) {
  lateJoin = late;
  $("join-late").hidden = !late;
  $("join").textContent = late ? "Demander à entrer" : "Rejoindre la partie";
  const box = $("colors");
  box.innerHTML = "";
  TEAM_COLORS.forEach((c) => {
    const b = document.createElement("button");
    b.style.background = c;
    b.setAttribute("aria-label", c);
    b.classList.toggle("selected", c === chosenColor);
    b.onclick = () => {
      chosenColor = c;
      box.querySelectorAll("button").forEach((x) => x.classList.toggle("selected", x === b));
    };
    box.appendChild(b);
  });
  show("join");
  $("team-name").focus();
  // Prestation chargée : on accueille les équipes avec le prénom de l'enfant fêté.
  get(ref(db, `games/${code}/public`)).then((s) => {
    const p = s.val();
    $("join-welcome").textContent = p?.childName ? `Joyeux anniversaire ${p.childName} !` : p?.title ?? "";
    $("join-welcome").hidden = !$("join-welcome").textContent;
  }).catch(() => {});
}

$("join").onclick = async () => {
  const name = $("team-name").value.trim();
  if (!name) return $("team-name").focus();
  $("join").disabled = true;
  beep(660, 120); // débloque le son du navigateur dès le premier toucher
  keepAwake();
  try {
    if (lateJoin) {
      await set(ref(db, `games/${code}/joinRequests/${uid}`), { name, color: chosenColor, at: serverTimestamp() });
      return waitForAdmission();
    }
    await set(ref(db, `games/${code}/teams/${uid}`), { name, color: chosenColor, joinedAt: serverTimestamp() });
    teamId = uid;
    play();
  } catch (e) {
    console.error(e);
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
      .then(() => set(presence, { online: true, at: serverTimestamp() }))
      .catch(() => { /* équipe pas encore inscrite, ou appareil remplacé */ });
  });
  // L'ancien appareil de l'équipe peut encore signaler « hors ligne » en se déconnectant : on corrige.
  listen(`games/${code}/presence/${teamId}`, (s) => {
    if (game.connected && s.val()?.online === false) {
      set(presenceRef, { online: true, at: serverTimestamp() }).catch(() => {});
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
  switch (st.phase) {
    case "question":
    case "closed":
      return st.mime ? renderMime(st) : renderQuestion(st);
    case "reveal":
    case "scores":
      return st.mime ? renderMimeResult(st) : renderResult(st);
    case "ended":
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
  $("q-number").textContent = `Question ${(st.index ?? 0) + 1} / ${st.total ?? "?"}`;
  $("q-double").hidden = !st.double;
  const choices = st.choices ?? [];
  const box = $("choices");
  const key = `${st.qid}:${choices.length}`;
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = "";
    box.classList.toggle("two", choices.length === 2);
    choices.forEach((text, i) => {
      const b = document.createElement("button");
      b.className = "choice";
      b.style.setProperty("--choice", CHOICE_COLORS[i]);
      b.innerHTML = `<span class="letter">${CHOICE_LETTERS[i]}</span><span class="text"></span>`;
      b.querySelector(".text").textContent = text;
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
  else $("q-status").textContent = "Choisissez votre réponse !";
  runTimer(st);
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
  $("r-icon").textContent = n ? "★" : "…";
  $("r-icon").className = `result-icon ${n ? "ok" : "ko"}`;
  $("r-title").textContent = n ? `Bravo ! ${n} mime${n > 1 ? "s" : ""} trouvé${n > 1 ? "s" : ""}` : "Pas de mime trouvé cette fois !";
  $("r-detail").textContent = n ? `+${n * (st.mime?.points ?? 50)} points` : "";
  const { mine, rank } = rankOf(st.scores);
  $("r-total").textContent = `${mine} points · ${rank === 1 ? "1re place" : `${rank}e place`}`;
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

function runTimer(st) {
  clearInterval(timerHandle);
  const el = $("q-timer");
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
  $("r-title").textContent = ok ? `Bravo ! +${award.points} points` : answered ? "Raté pour cette fois !" : "Pas de réponse";
  const correct = st.correct != null ? `${CHOICE_LETTERS[st.correct]} : ${st.choices?.[st.correct] ?? ""}` : "";
  $("r-detail").textContent = (ok && award.bonus > 0 ? `dont ${award.bonus} de bonus rapidité. ` : "") + (correct ? `Bonne réponse : ${correct}` : "");
  const { mine, rank } = rankOf(st.scores);
  $("r-total").textContent = `${mine} points · ${rank === 1 ? "1re place" : `${rank}e place`}`;
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
