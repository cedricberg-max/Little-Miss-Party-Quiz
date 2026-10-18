import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth, signInAnonymously, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import {
  getDatabase, ref, get, set, push, onValue, serverTimestamp, connectDatabaseEmulator,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { CHOICE_LETTERS } from "./theme.js";

// Régie de l'animatrice : elle n'écrit que des commandes. La box les vérifie, les applique
// et répond dans commandStatus/ ; l'écran se met à jour en relisant l'état de la partie.

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const emulator = params.has("emu") && ["localhost", "127.0.0.1"].includes(location.hostname);
const STORE = "lmp-regie-partie";
/** Délai au-delà duquel une commande sans réponse signale une box injoignable. */
const BOX_TIMEOUT_MS = 6000;

let db, uid, code;
let serverOffset = 0;
let unsubscribers = [];
let live = { state: null, teams: {}, presence: {}, plan: null, answers: {}, connected: true };
let answersUnsub = null;
let answersQid = null;
let pending = null;
let timerHandle = null;
let undoTimer = null;
let answerMasked = false;
let tab = "teams";

function show(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === `screen-${name}`));
}

function fail(message) {
  stopListening();
  $("error-text").textContent = message;
  show("error");
}

function remember(c) {
  try { if (c) localStorage.setItem(STORE, c); else localStorage.removeItem(STORE); } catch { /* navigation privée */ }
}
function remembered() {
  try { return localStorage.getItem(STORE); } catch { return null; }
}

async function start() {
  show("loading");
  code = (params.get("g") || remembered() || "").toUpperCase();
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
      // L'identifiant est gardé par le navigateur : un téléphone relié le reste après un rechargement.
      uid = (await signInAnonymously(auth)).user.uid;
    }
    if (code && (await get(ref(db, `games/${code}/regie/${uid}`))).exists()) return control();
    showPair();
  } catch (e) {
    console.error(e);
    fail("Connexion impossible. Vérifiez Internet puis réessayez.");
  }
}

// ---------- Appairage ----------

function showPair(message = "", error = false) {
  stopListening();
  $("pair-code").value = code || "";
  $("pair-status").textContent = message;
  $("pair-status").classList.toggle("error", error);
  show("pair");
  (code ? $("pair-pin") : $("pair-code")).focus();
}

const PAIR_MESSAGES = {
  wrong: "Code incorrect. Regardez le code à 4 chiffres sur la TV.",
  locked: "Trop d'essais. Patientez une minute puis réessayez.",
  full: "Deux régies sont déjà reliées. Retirez-en une depuis la TV.",
};

$("pair-go").onclick = async () => {
  const c = $("pair-code").value.trim().toUpperCase();
  const pin = $("pair-pin").value.trim();
  if (!/^[A-Z0-9]{5}$/.test(c)) return showPair("Le code de la partie a 5 caractères.", true);
  if (!/^[0-9]{4}$/.test(pin)) return showPair("Le code de la TV a 4 chiffres.", true);
  code = c;
  $("pair-go").disabled = true;
  $("pair-status").classList.remove("error");
  $("pair-status").textContent = "Vérification par la TV…";
  try {
    if (!(await get(ref(db, `games/${code}/hostUid`))).exists()) return showPair(`La partie ${code} n'existe pas.`, true);
    const result = await requestPairing(pin);
    if (result === "ok") {
      remember(code);
      $("pair-pin").value = "";
      return control();
    }
    showPair(PAIR_MESSAGES[result] ?? "La TV ne répond pas. Vérifiez qu'elle est allumée et connectée.", true);
  } catch (e) {
    console.error(e);
    showPair("Demande refusée. Vérifiez le code de la partie.", true);
  } finally {
    $("pair-go").disabled = false;
  }
};

/** Dépose la demande puis attend que la box l'ait traitée (elle l'efface et écrit le résultat). */
async function requestPairing(pin) {
  const request = ref(db, `games/${code}/pairing/${uid}`);
  const result = ref(db, `games/${code}/pairingResult/${uid}`);
  await set(request, { pin, at: serverTimestamp() });
  return new Promise((resolve) => {
    let stop = () => {};
    const timeout = setTimeout(() => { stop(); resolve(null); }, 10000);
    stop = onValue(request, async (s) => {
      if (s.exists()) return;
      clearTimeout(timeout);
      stop();
      resolve((await get(result)).val()?.status ?? null);
    });
  });
}

// ---------- Pilotage ----------

function stopListening() {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  answersUnsub?.();
  answersUnsub = null;
  answersQid = null;
  clearInterval(timerHandle);
}

function listen(path, fn) {
  unsubscribers.push(onValue(ref(db, path), fn, (e) => {
    console.error(path, e);
    // Accès retiré par la TV (« Retirer les régies ») ou nouvelle partie.
    if (path.endsWith(`regie/${uid}`) || path.endsWith("/commands")) remember(null);
  }));
}

function control() {
  stopListening();
  live = { state: null, teams: {}, presence: {}, plan: null, answers: {}, connected: true };
  show("control");
  $("c-code").textContent = code;
  listen(".info/serverTimeOffset", (s) => { serverOffset = s.val() ?? 0; });
  listen(".info/connected", (s) => {
    live.connected = s.val() === true;
    $("offline").hidden = live.connected;
    $("c-dot").classList.toggle("on", live.connected);
  });
  listen(`games/${code}/regie/${uid}`, (s) => {
    if (s.exists()) return;
    remember(null);
    showPair("Ce téléphone n'est plus relié à la partie.", true);
  });
  listen(`games/${code}/state`, (s) => { live.state = s.val(); watchAnswers(); render(); });
  listen(`games/${code}/teams`, (s) => { live.teams = s.val() ?? {}; render(); });
  listen(`games/${code}/presence`, (s) => { live.presence = s.val() ?? {}; render(); });
  listen(`games/${code}/conducteur`, (s) => { live.plan = s.val(); render(); });
}

function watchAnswers() {
  const qid = live.state?.qid ?? null;
  if (qid === answersQid) return;
  answersUnsub?.();
  answersQid = qid;
  live.answers = {};
  if (!qid) return;
  answersUnsub = onValue(ref(db, `games/${code}/answers/${qid}`), (s) => { live.answers = s.val() ?? {}; render(); });
}

const PHASES = {
  lobby: "Salon d'attente",
  question: "Question en cours",
  closed: "Temps écoulé",
  reveal: "Réponse révélée",
  scores: "Scores",
  ended: "Partie terminée",
};

function nextLabel(st, teamCount) {
  switch (st.phase) {
    case "lobby": return teamCount ? "Lancer le quiz" : "En attente des équipes";
    case "question": return "Arrêter le chrono";
    case "closed": return "Révéler la réponse";
    case "reveal": return "Voir les scores";
    case "scores": return (st.index ?? 0) + 1 >= (st.total ?? 0) ? "Résultats finaux" : "Question suivante";
    default: return "";
  }
}

function render() {
  const st = live.state ?? { phase: "lobby" };
  const teams = Object.entries(live.teams).sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));
  const q = live.plan?.questions?.[st.index];
  const inQuestion = st.phase !== "lobby" && st.phase !== "ended" && st.index != null && st.index >= 0;

  $("c-step").textContent = inQuestion ? `Question ${st.index + 1} / ${st.total ?? "?"}${st.double ? " · ×2" : ""}` : "";
  $("c-phase").textContent = st.phase === "question" && st.paused ? "En pause" : PHASES[st.phase] ?? "";
  $("c-phase").classList.toggle("paused", st.phase === "question" && st.paused === true);
  $("c-question").textContent = inQuestion ? st.text ?? q?.text ?? "" : st.phase === "ended" ? "Bravo à toutes les équipes !" : `${teams.length} équipe${teams.length > 1 ? "s" : ""} inscrite${teams.length > 1 ? "s" : ""}`;

  const correct = q?.correct ?? st.correct;
  const answerBtn = $("c-answer");
  answerBtn.hidden = !inQuestion || correct == null;
  if (correct != null) {
    const text = (st.choices ?? q?.choices ?? [])[correct] ?? "";
    answerBtn.textContent = answerMasked ? "Réponse masquée · toucher pour voir" : `Réponse ${CHOICE_LETTERS[correct]} · ${text}`;
    answerBtn.classList.toggle("masked", answerMasked);
  }
  const answered = Object.keys(live.answers).filter((t) => live.teams[t]).length;
  $("c-answered").textContent = st.phase === "question" || st.phase === "closed" ? `${answered} / ${teams.length} équipes ont répondu` : "";

  renderTeams(st, teams);
  renderPlan(st);
  runTimer(st);

  const next = $("c-next");
  next.hidden = st.phase === "ended";
  next.textContent = pending?.advance ? "Envoi…" : nextLabel(st, teams.length);
  next.disabled = !!pending?.advance || (st.phase === "lobby" && teams.length === 0);
  const pause = $("c-pause");
  pause.textContent = st.paused ? "Reprendre" : "Pause";
  pause.disabled = st.phase !== "question" || !!pending?.advance;
  $("c-end").hidden = st.phase === "ended";
}

function renderTeams(st, teams) {
  const box = $("panel-teams");
  const scores = st.scores ?? {};
  const key = teams.map(([id]) => id).join(",");
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = "";
    if (!teams.length) box.innerHTML = '<p class="hint">Les équipes apparaissent ici quand elles rejoignent la partie.</p>';
    teams.forEach(([id]) => {
      const row = document.createElement("div");
      row.className = "team";
      row.dataset.team = id;
      row.innerHTML = '<span class="dot"></span><span class="swatch"></span><span class="name"></span><span class="score"></span>'
        + '<button data-delta="-10">−10</button><button data-delta="10">+10</button>';
      row.querySelectorAll("button").forEach((b) => { b.onclick = () => adjust(id, Number(b.dataset.delta)); });
      box.appendChild(row);
    });
  }
  teams.forEach(([id, t]) => {
    const row = box.querySelector(`[data-team="${CSS.escape(id)}"]`);
    if (!row) return;
    row.querySelector(".dot").classList.toggle("on", live.presence[id]?.online === true);
    row.querySelector(".swatch").style.background = t.color;
    const answeredMark = live.answers[id] ? " · a répondu" : "";
    row.querySelector(".name").innerHTML = "";
    row.querySelector(".name").append(t.name ?? "Équipe");
    const small = document.createElement("small");
    small.textContent = (live.presence[id]?.online === true ? "connectée" : "hors ligne") + answeredMark;
    row.querySelector(".name").append(small);
    row.querySelector(".score").textContent = scores[id] ?? 0;
    row.querySelectorAll("button").forEach((b) => { b.disabled = st.phase === "ended"; });
  });
}

function renderPlan(st) {
  const box = $("panel-plan");
  const questions = live.plan?.questions ?? [];
  const key = `${questions.length}:${st.index}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = "";
  if (!questions.length) box.innerHTML = '<p class="hint">Le conducteur s\'affiche quand la TV l\'a publié.</p>';
  questions.forEach((q, i) => {
    const item = document.createElement("div");
    item.className = `plan-item${i === st.index ? " current" : ""}${i < st.index ? " done" : ""}`;
    const title = document.createElement("div");
    title.textContent = `${i + 1}. ${q.text}${q.double ? " (×2)" : ""}`;
    const answer = document.createElement("b");
    answer.textContent = `${CHOICE_LETTERS[q.correct] ?? "?"} · ${q.choices?.[q.correct] ?? ""}`;
    item.append(title, answer);
    box.appendChild(item);
  });
}

function runTimer(st) {
  clearInterval(timerHandle);
  const el = $("c-timer");
  const tick = () => {
    let ms;
    if (st.phase !== "question") ms = null;
    else if (st.paused) ms = st.remainingMs ?? 0;
    else ms = Math.max(0, (st.deadline ?? 0) - (Date.now() + serverOffset));
    el.textContent = ms == null ? "" : `${Math.ceil(ms / 1000)}`;
    el.classList.toggle("urgent", ms != null && ms <= 5000);
  };
  tick();
  if (st.phase === "question" && !st.paused) timerHandle = setInterval(tick, 250);
}

// ---------- Commandes ----------

const STATUS_MESSAGES = {
  stale: "La partie avait déjà avancé : rien n'a été fait, l'écran est à jour.",
  no_teams: "Aucune équipe n'a encore rejoint la partie.",
  unknown_team: "Équipe inconnue.",
  not_now: "Pas possible à cette étape.",
};

function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(t.timer);
  t.timer = setTimeout(() => { t.hidden = true; }, 4000);
}

/**
 * Envoie une commande avec le numéro d'étape affiché (expectSeq). La box refuse une commande
 * d'avancement si la partie a bougé entre-temps : un double appui n'avance jamais de deux étapes.
 */
async function send(type, extra = {}, { advance = false } = {}) {
  const st = live.state;
  if (!st || (advance && pending?.advance)) return null;
  const cmdRef = push(ref(db, `games/${code}/commands`));
  const mine = { id: cmdRef.key, advance };
  if (advance) pending = mine;
  render();
  return new Promise((resolve) => {
    let stop = () => {};
    const done = (status) => {
      clearTimeout(timeout);
      stop();
      if (pending === mine) pending = null;
      render();
      resolve(status);
    };
    const timeout = setTimeout(() => {
      toast("La TV ne répond pas. Vérifiez qu'elle est allumée et connectée à Internet.");
      done(null);
    }, BOX_TIMEOUT_MS);
    stop = onValue(ref(db, `games/${code}/commandStatus/${cmdRef.key}`), (s) => {
      const status = s.val();
      if (!status) return;
      if (status.status !== "applied") toast(STATUS_MESSAGES[status.reason] ?? STATUS_MESSAGES[status.status] ?? "Commande refusée.");
      done(status);
    });
    set(cmdRef, { type, expectSeq: st.seq ?? 0, by: uid, at: serverTimestamp(), ...extra }).catch((e) => {
      console.error(e);
      toast("Commande refusée : ce téléphone n'est peut-être plus relié.");
      done(null);
    });
  });
}

async function adjust(team, delta) {
  const status = await send("adjust", { team, delta });
  if (status?.status !== "applied") return;
  const name = live.teams[team]?.name ?? "l'équipe";
  showUndo(`${delta > 0 ? "+" : "−"}${Math.abs(delta)} pour ${name}`, status.seq);
}

/** Bandeau « Annuler » pendant 10 secondes après une correction. */
function showUndo(text, seq) {
  clearTimeout(undoTimer);
  $("undo-text").textContent = text;
  $("undo").hidden = false;
  $("undo-go").onclick = async () => {
    $("undo").hidden = true;
    const status = await send("undo", { target: seq });
    if (status?.status === "applied") toast("Correction annulée.");
  };
  undoTimer = setTimeout(() => { $("undo").hidden = true; }, 10000);
}

$("c-next").onclick = () => {
  const phase = live.state?.phase;
  send(phase === "question" ? "close" : "next", {}, { advance: true });
};
$("c-pause").onclick = () => send(live.state?.paused ? "resume" : "pause", {}, { advance: true });
$("c-answer").onclick = () => { answerMasked = !answerMasked; render(); };

// « Terminer la partie » : appui long d'une seconde, pour ne jamais finir une partie par erreur.
(() => {
  const btn = $("c-end");
  let hold = null;
  let fired = false;
  const cancel = () => { clearTimeout(hold); btn.classList.remove("pressing"); };
  btn.addEventListener("pointerdown", () => {
    fired = false;
    btn.classList.add("pressing");
    hold = setTimeout(() => { fired = true; cancel(); send("end", {}, { advance: true }); }, 1000);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((e) => btn.addEventListener(e, cancel));
  btn.onclick = () => { if (!fired) toast("Gardez le doigt appuyé une seconde pour terminer la partie."); fired = false; };
})();

$("tab-teams").onclick = () => switchTab("teams");
$("tab-plan").onclick = () => switchTab("plan");
function switchTab(name) {
  tab = name;
  $("tab-teams").classList.toggle("active", tab === "teams");
  $("tab-plan").classList.toggle("active", tab === "plan");
  $("panel-teams").hidden = tab !== "teams";
  $("panel-plan").hidden = tab !== "plan";
}

$("retry").onclick = start;
// Après le verrouillage du téléphone, Firebase se reconnecte seul et les écouteurs relisent l'état.
start();
