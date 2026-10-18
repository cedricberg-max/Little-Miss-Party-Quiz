import {
  ref, get, set, push, onValue, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { CHOICE_LETTERS } from "./theme.js";
import { writeProof } from "./proof.js";
import { buildSnapshot, showTitle } from "./show.js";

// Régie de l'animatrice, ouverte depuis la page des pupitres (bouton « Accès régie »).
// Elle n'écrit que des commandes : la box les vérifie, les applique et répond dans commandStatus/ ;
// l'écran se met à jour en relisant l'état de la partie.

const $ = (id) => document.getElementById(id);
/** Délai au-delà duquel une commande sans réponse signale une box injoignable. */
const BOX_TIMEOUT_MS = 6000;

let db, uid, code, onExit;
let serverOffset = 0;
let unsubscribers = [];
let live = { state: null, teams: {}, presence: {}, plan: null, answers: {}, requests: {}, connected: true };
/** Appareils dont la demande d'entrée est en cours de traitement par la box. */
const admitting = new Set();
let answersUnsub = null;
let answersQid = null;
let pending = null;
let timerHandle = null;
let undoTimer = null;
let answerMasked = false;
let tab = "teams";
/** Prestations publiées par Sarah : null tant qu'elles ne sont pas lues. */
let shows = null;
let loadingShow = null;

// ---------- Accès ----------

/** Ce téléphone est-il déjà relié à cette partie (après un rechargement, un écran verrouillé…) ? */
export async function hasAccess(ctx, gameCode) {
  return (await get(ref(ctx.db, `games/${gameCode}/regie/${ctx.uid}`))).exists();
}

/**
 * Mot de passe commun des animatrices. La comparaison est faite par le serveur (règles Firebase) :
 * l'accès à la partie n'est accepté que si l'empreinte envoyée est la bonne.
 * Résultat : "ok", "wrong", "unset" (aucun mot de passe enregistré) ou "busy".
 */
export async function loginWithPassword(ctx, gameCode, password) {
  const proof = await writeProof(ctx, "regie", password);
  if (proof !== "written") return proof;
  try {
    await set(ref(ctx.db, `games/${gameCode}/regie/${ctx.uid}`), { pairedAt: serverTimestamp(), via: "password" });
    return "ok";
  } catch {
    return "wrong";
  }
}

/**
 * Secours : code à 4 chiffres affiché sur la TV. La box compare le code, limite les essais,
 * efface la demande et publie son verdict. Résultat : "ok", "wrong", "locked", "full" ou null (TV muette).
 */
export async function loginWithPin(ctx, gameCode, pin) {
  const request = ref(ctx.db, `games/${gameCode}/pairing/${ctx.uid}`);
  const result = ref(ctx.db, `games/${gameCode}/pairingResult/${ctx.uid}`);
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

/** Ouvre l'interface de régie. [exit] est appelé si la TV retire ce téléphone. */
export function startRegie(ctx, gameCode, exit) {
  db = ctx.db;
  uid = ctx.uid;
  code = gameCode;
  onExit = exit;
  control();
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
  unsubscribers.push(onValue(ref(db, path), fn, (e) => console.error(path, e)));
}

function control() {
  stopListening();
  live = { state: null, teams: {}, presence: {}, plan: null, answers: {}, requests: {}, connected: true };
  shows = null;
  $("c-code").textContent = code;
  listen(".info/serverTimeOffset", (s) => { serverOffset = s.val() ?? 0; });
  listen(".info/connected", (s) => {
    live.connected = s.val() === true;
    $("r-offline").hidden = live.connected;
    $("c-dot").classList.toggle("on", live.connected);
  });
  listen(`games/${code}/regie/${uid}`, (s) => {
    if (s.exists()) return;
    stopListening();
    onExit?.("Ce téléphone n'est plus relié à la régie de la partie.");
  });
  let first = true;
  listen(`games/${code}/state`, (s) => {
    live.state = s.val();
    watchAnswers();
    // En arrivant dans le salon d'attente, la première chose à faire est de charger la prestation.
    if (first && live.state?.phase === "lobby") switchTab("show");
    first = false;
    render();
  });
  listen(`games/${code}/teams`, (s) => { live.teams = s.val() ?? {}; render(); });
  listen(`games/${code}/presence`, (s) => { live.presence = s.val() ?? {}; render(); });
  listen(`games/${code}/conducteur`, (s) => { live.plan = s.val(); render(); });
  listen(`games/${code}/joinRequests`, (s) => { live.requests = s.val() ?? {}; render(); });
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

  $("c-step").textContent = inQuestion
    ? `Question ${st.index + 1} / ${st.total ?? "?"}${st.double ? " · ×2" : ""}`
    : st.phase === "lobby" ? live.plan?.title ?? "" : "";
  $("c-phase").textContent = st.paused ? `En pause · ${PHASES[st.phase] ?? ""}` : PHASES[st.phase] ?? "";
  $("c-phase").classList.toggle("on-hold", st.paused === true);
  renderHold(st, teams);
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

  renderRequests(st, teams);
  renderTeams(st, teams);
  renderPlan(st);
  renderShows(st);
  runTimer(st);

  const next = $("c-next");
  next.hidden = st.phase === "ended";
  next.textContent = pending?.advance ? "Envoi…" : nextLabel(st, teams.length);
  next.disabled = !!pending?.advance || (st.phase === "lobby" && teams.length === 0);
  // Pause générale : possible à toute étape d'une partie commencée.
  const pause = $("c-pause");
  pause.textContent = st.paused ? "Reprendre (3, 2, 1)" : "Pause";
  pause.classList.toggle("resume", st.paused === true);
  pause.disabled = st.phase === "lobby" || st.phase === "ended" || !!pending?.advance;
  next.disabled = next.disabled || st.paused === true;
  $("c-end").hidden = st.phase === "ended";
}

/**
 * En pause : pourquoi, et qui n'est pas prêt. La reprise reste toujours le choix de l'animatrice,
 * même quand l'équipe déconnectée est revenue.
 */
function renderHold(st, teams) {
  const box = $("c-hold");
  box.hidden = !st.paused;
  if (!st.paused) return;
  const name = (id) => live.teams[id]?.name ?? "Une équipe";
  const offline = teams.filter(([id]) => live.presence[id]?.online !== true).map(([id]) => name(id));
  const parts = [];
  if (st.pauseReason === "team" && st.pauseTeam) {
    parts.push(live.presence[st.pauseTeam]?.online === true
      ? `Pause automatique : « ${name(st.pauseTeam)} » avait perdu la connexion, elle est revenue.`
      : `Pause automatique : « ${name(st.pauseTeam)} » a perdu la connexion. Son appareil se reconnecte seul.`);
  } else {
    parts.push("Partie en pause : chrono, réponses et scores sont figés.");
  }
  parts.push(offline.length
    ? `Pas encore prête${offline.length > 1 ? "s" : ""} : ${offline.join(", ")}.`
    : "Toutes les équipes sont connectées : vous pouvez reprendre.");
  box.textContent = parts.join(" ");
}

/**
 * Appareil arrivé en cours de partie (tablette déchargée, téléphone de secours…) : l'animatrice choisit
 * d'en faire une nouvelle équipe ou de lui confier une équipe existante, qui garde ses points.
 * Les équipes du même nom ou hors ligne sont proposées en premier.
 */
function renderRequests(st, teams) {
  const box = $("c-requests");
  const requests = Object.entries(live.requests).sort((a, b) => (a[1].at ?? 0) - (b[1].at ?? 0));
  const online = (id) => live.presence[id]?.online === true;
  const key = JSON.stringify([requests, teams.map(([id, t]) => [id, t.name, online(id)]), [...admitting]]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = "";
  box.hidden = !requests.length;
  requests.forEach(([device, r]) => {
    const item = document.createElement("div");
    item.className = "request";
    item.dataset.device = device;
    const title = document.createElement("p");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = r.color;
    title.append(swatch, `« ${r.name} » demande à entrer`);
    const choices = document.createElement("div");
    choices.className = "choices";
    const same = (t) => t.name?.trim().toLowerCase() === r.name?.trim().toLowerCase();
    const ordered = [...teams].sort(([ia, a], [ib, b]) => (same(b) - same(a)) || (online(ia) - online(ib)));
    const busy = admitting.has(device) || st.phase === "ended";
    ordered.forEach(([id, t]) => {
      const b = document.createElement("button");
      b.dataset.team = id;
      b.classList.toggle("suggested", same(t));
      b.textContent = `Remplace « ${t.name} »${online(id) ? "" : " (hors ligne)"}`;
      b.disabled = busy;
      b.onclick = () => replaceDevice(device, id);
      choices.appendChild(b);
    });
    const add = document.createElement("button");
    add.className = "new";
    add.textContent = "Nouvelle équipe";
    add.disabled = busy;
    add.onclick = () => admit(device, "admit", {}, `« ${r.name} » entre dans la partie.`);
    const ignore = document.createElement("button");
    ignore.className = "link";
    ignore.textContent = "Ignorer";
    ignore.disabled = busy;
    ignore.onclick = () => set(ref(db, `games/${code}/joinRequests/${device}`), null).catch((e) => console.error(e));
    choices.append(add, ignore);
    item.append(title, choices);
    box.appendChild(item);
  });
}

function replaceDevice(device, team) {
  const name = live.teams[team]?.name ?? "l'équipe";
  // Irréversible : l'ancien appareil ne pourra plus jamais jouer dans cette partie.
  if (!confirm(`Confier « ${name} » à ce nouvel appareil ? Ses points sont gardés, l'ancien appareil ne pourra plus jouer.`)) return;
  admit(device, "replace", { team }, `« ${name} » continue sur le nouvel appareil, avec ses points.`);
}

async function admit(device, type, extra, success) {
  if (admitting.has(device)) return;
  admitting.add(device);
  render();
  const status = await send(type, { device, ...extra });
  admitting.delete(device);
  if (status?.status === "applied") toast(success);
  render();
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
  const key = `${live.plan?.title}:${questions.length}:${st.index}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = "";
  if (!questions.length) box.innerHTML = '<p class="hint">Le conducteur s\'affiche quand la TV l\'a publié.</p>';
  questions.forEach((q, i) => {
    const item = document.createElement("div");
    item.className = `plan-item${i === st.index ? " current" : ""}${i < st.index ? " done" : ""}`;
    if (q.round && q.round !== questions[i - 1]?.round) {
      const round = document.createElement("p");
      round.className = "plan-round";
      round.textContent = q.round;
      box.appendChild(round);
    }
    const title = document.createElement("div");
    title.textContent = `${i + 1}. ${q.text}${q.double ? " (×2)" : ""}`;
    const answer = document.createElement("b");
    answer.textContent = `${CHOICE_LETTERS[q.correct] ?? "?"} · ${q.choices?.[q.correct] ?? ""}`;
    item.append(title, answer);
    box.appendChild(item);
  });
}

// ---------- Prestations (salon d'attente) ----------

const SHOW_MESSAGES = {
  not_now: "La partie a déjà commencé : la prestation ne peut plus changer.",
  invalid: "La TV n'a pas pu lire cette prestation. Vérifiez-la dans l'administration.",
};

/** Lit les prestations publiées et les quiz qu'elles utilisent (réservé au mot de passe de régie). */
async function fetchShows() {
  shows = { loading: true };
  render();
  try {
    const [s, q] = await Promise.all([get(ref(db, "library/shows")), get(ref(db, "library/quizzes"))]);
    const quizzes = q.val() ?? {};
    const today = new Date().toISOString().slice(0, 10);
    const list = Object.entries(s.val() ?? {})
      .filter(([, show]) => show.status === "publiee")
      .map(([id, show]) => ({ id, show, ...buildSnapshot(id, show, quizzes) }))
      // Les prestations à venir d'abord, la plus proche en tête ; les passées ensuite.
      .sort((a, b) => {
        const da = a.show.date ?? "9999", dbb = b.show.date ?? "9999";
        const pa = da < today, pb = dbb < today;
        return pa !== pb ? (pa ? 1 : -1) : pa ? dbb.localeCompare(da) : da.localeCompare(dbb);
      });
    shows = { list };
  } catch (e) {
    console.error(e);
    shows = { denied: /permission/i.test(String(e?.message ?? e)) };
  }
  render();
}

function renderShows(st) {
  const lobby = st.phase === "lobby";
  $("tab-show").hidden = !lobby;
  if (!lobby && tab === "show") switchTab("teams");
  if (!lobby || tab !== "show") return;
  if (shows === null) { fetchShows(); return; }
  const box = $("panel-show");
  const key = JSON.stringify([shows.loading, shows.denied, shows.list?.map((s) => s.id), loadingShow, live.plan?.title]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = "";
  const hint = (text) => { const p = document.createElement("p"); p.className = "hint"; p.textContent = text; box.appendChild(p); };
  if (shows.loading) return hint("Chargement des prestations…");
  if (shows.denied) return hint("Pour charger une prestation, entrez dans la régie avec le mot de passe (pas avec le code de la TV).");
  if (shows.error || !shows.list) return hint("Impossible de lire les prestations. Vérifiez la connexion.");
  if (!shows.list.length) hint("Aucune prestation prête. Sarah les prépare dans l'administration (statut « Prête »).");
  shows.list.forEach(({ id, show, snapshot, problems }) => {
    const item = document.createElement("button");
    item.className = "show-item";
    item.dataset.show = id;
    const title = document.createElement("b");
    title.textContent = showTitle(show);
    const meta = document.createElement("span");
    const date = show.date ? new Date(`${show.date}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "";
    meta.textContent = [show.childName, show.age ? `${show.age} ans` : "", date].filter(Boolean).join(" · ");
    const detail = document.createElement("span");
    detail.textContent = snapshot
      ? `${snapshot.rounds.length} manche${snapshot.rounds.length > 1 ? "s" : ""} · ${snapshot.quiz.questions.length} questions`
      : problems[problems.length - 1];
    item.append(title, meta, detail);
    if (loadingShow === id) detail.textContent = "Chargement sur la TV…";
    item.disabled = !snapshot || !!loadingShow;
    item.onclick = () => loadShow(id, snapshot);
    box.appendChild(item);
  });
  const refresh = document.createElement("button");
  refresh.className = "link";
  refresh.textContent = "Actualiser la liste";
  refresh.onclick = () => fetchShows();
  box.appendChild(refresh);
}

/** Envoie l'instantané de la prestation à la TV, qui le vérifie et répond dans showStatus/. */
async function loadShow(id, snapshot) {
  if (loadingShow) return;
  loadingShow = id;
  render();
  const showId = push(ref(db, `games/${code}/show`)).key;
  const done = (message) => { loadingShow = null; if (message) toast(message); render(); };
  let stop = () => {};
  const timeout = setTimeout(() => { stop(); done("La TV ne répond pas. Vérifiez qu'elle est allumée et connectée à Internet."); }, 8000);
  stop = onValue(ref(db, `games/${code}/showStatus`), (s) => {
    const status = s.val();
    if (status?.id !== showId) return;
    clearTimeout(timeout);
    stop();
    done(status.status === "applied" ? `« ${snapshot.title} » est chargée sur la TV.` : SHOW_MESSAGES[status.reason] ?? "La TV a refusé cette prestation.");
  });
  try {
    await set(ref(db, `games/${code}/show`), { ...snapshot, id: showId, by: uid, at: serverTimestamp() });
  } catch (e) {
    console.error(e);
    clearTimeout(timeout);
    stop();
    done("Chargement refusé : la partie a peut-être déjà commencé.");
  }
}

function runTimer(st) {
  clearInterval(timerHandle);
  const el = $("c-timer");
  const tick = () => {
    let ms;
    if (st.phase !== "question") ms = null;
    else if (st.paused) ms = st.remainingMs ?? 0;
    else ms = Math.max(0, (st.deadline ?? 0) - Math.max(Date.now() + serverOffset, st.resumeAt ?? 0));
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
  paused: "La partie est en pause : touchez d'abord « Reprendre ».",
  full: "8 équipes maximum : confiez plutôt à cet appareil une équipe existante.",
  busy: "Cet appareil joue déjà pour une équipe.",
  gone: "Cette demande n'existe plus : l'appareil a peut-être quitté la page.",
};

function toast(message) {
  const t = $("r-toast");
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
$("tab-show").onclick = () => switchTab("show");
function switchTab(name) {
  tab = name;
  for (const t of ["teams", "plan", "show"]) {
    $(`tab-${t}`).classList.toggle("active", tab === t);
    $(`panel-${t}`).hidden = tab !== t;
  }
  render();
}

// Après le verrouillage du téléphone, Firebase se reconnecte seul et les écouteurs relisent l'état.
