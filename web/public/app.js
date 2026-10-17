import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import {
  getDatabase, ref, get, set, onValue, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";

const COLORS = ["#FF3CAC", "#FFD166", "#06D6A0", "#2B86C5", "#9B5DE5", "#F15BB5", "#FF7F11", "#00BBF9"];

const $ = (id) => document.getElementById(id);
const code = (new URLSearchParams(location.search).get("g") || "").toUpperCase();

let db, uid, gameRef, unsubscribe;
let chosenColor = COLORS[0];
let audio;

function show(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === `screen-${name}`));
}

function fail(message) {
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

async function keepAwake() {
  try { await document.documentElement.requestFullscreen?.(); } catch { /* iOS : pas de plein écran */ }
  try { await navigator.wakeLock?.request("screen"); } catch { /* facultatif */ }
}

async function start() {
  show("loading");
  if (!code) return fail("Scannez le QR code affiché sur la TV pour rejoindre une partie.");
  try {
    const config = await (await fetch("firebase-config.json", { cache: "no-store" })).json();
    const app = initializeApp(config);
    uid = (await signInAnonymously(getAuth(app))).user.uid;
    db = getDatabase(app);
    gameRef = ref(db, `games/${code}`);
    const game = await get(gameRef);
    if (!game.child("hostUid").exists()) return fail(`La partie ${code} n'existe pas ou est terminée.`);
    if (game.child(`teams/${uid}`).exists()) return play();
    showJoin();
  } catch (e) {
    console.error(e);
    fail("Connexion impossible. Vérifiez Internet puis réessayez.");
  }
}

function showJoin() {
  const box = $("colors");
  box.innerHTML = "";
  COLORS.forEach((c) => {
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
}

$("join").onclick = async () => {
  const name = $("team-name").value.trim();
  if (!name) return $("team-name").focus();
  $("join").disabled = true;
  beep(660, 120); // débloque le son du navigateur dès le premier toucher
  keepAwake();
  try {
    await set(ref(db, `games/${code}/teams/${uid}`), { name, color: chosenColor, joinedAt: serverTimestamp() });
    play();
  } catch (e) {
    console.error(e);
    fail("Impossible de rejoindre la partie.");
  } finally {
    $("join").disabled = false;
  }
};

function play() {
  show("play");
  unsubscribe?.();
  unsubscribe = onValue(gameRef, (snap) => {
    const me = snap.child(`teams/${uid}`).val();
    if (!me) return showJoin();
    document.documentElement.style.setProperty("--team", me.color);
    $("team-label").textContent = me.name;

    const round = snap.child("state/round").val() ?? 1;
    const open = snap.child("state/buzzOpen").val() === true;
    const first = snap.child(`buzz/${round}/team`).val();
    const buzz = $("buzz");
    buzz.classList.toggle("winner", first === uid);
    buzz.disabled = !open || !!first;
    buzz.dataset.round = round;

    if (first === uid) $("play-status").textContent = "Vous avez buzzé en premier !";
    else if (first) $("play-status").textContent = `Trop tard ! ${snap.child(`teams/${first}/name`).val() ?? "Une équipe"} a été plus rapide.`;
    else if (open) $("play-status").textContent = "Prêts ? Buzzez !";
    else $("play-status").textContent = "Regardez la TV !";
  });
}

$("buzz").onclick = async () => {
  const buzz = $("buzz");
  if (buzz.disabled) return;
  buzz.disabled = true;
  beep(990, 250);
  navigator.vibrate?.(200);
  try {
    await set(ref(db, `games/${code}/buzz/${buzz.dataset.round}`), { team: uid, at: serverTimestamp() });
  } catch {
    // Une autre équipe a été plus rapide : la base refuse le second buzz.
  }
};

$("retry").onclick = start;
start();
