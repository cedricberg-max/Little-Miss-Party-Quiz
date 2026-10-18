import {
  ref, get, set, push, onValue, serverTimestamp, query, limitToFirst,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { CHOICE_LETTERS } from "./theme.js";
import { writeProof } from "./proof.js";
import { passwordCandidates } from "./secret.js";
import {
  buildSnapshot, showTitle, playable, QUIZ_GAMES, BUILTIN_GAMES, MAX_QUESTIONS, ROUND_TYPES, programRounds, lockedUntil, gameQuestions, insertGame, imageIds,
  isFutureRound, moveRound, removeRound, uniqueRoundTitle,
} from "./show.js";
import { profileForAge } from "./profiles.js";

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
/** Bibliothèque de « Ajouter un jeu » (quiz et manches d'anciennes prestations) : null tant qu'elle n'est pas lue. */
let library = null;
/** Jeu choisi dans la bibliothèque, en aperçu avant de l'ajouter. */
let picked = null;
/** Modification du programme envoyée à la TV, en attente de son verdict : une seule à la fois. */
let editing = false;

// ---------- Accès ----------

/** Ce téléphone est-il déjà relié à cette partie (après un rechargement, un écran verrouillé…) ? */
export async function hasAccess(ctx, gameCode) {
  return (await get(ref(ctx.db, `games/${gameCode}/regie/${ctx.uid}`))).exists();
}

/**
 * Mot de passe commun des animatrices. La comparaison est faite par le serveur (règles Firebase) :
 * l'accès à la partie n'est accepté que si l'empreinte envoyée est la bonne.
 * Résultat : "ok", "wrong", "ended" (partie terminée ou inconnue), "refused" (mot de passe bon mais
 * accès refusé deux fois), "unset" (aucun mot de passe enregistré) ou "busy".
 */
export async function loginWithPassword(ctx, gameCode, password) {
  for (const candidate of passwordCandidates(password)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const proof = await writeProof(ctx, "regie", candidate);
      if (proof !== "written") return proof;
      try {
        await set(ref(ctx.db, `games/${gameCode}/regie/${ctx.uid}`), { pairedAt: serverTimestamp(), via: "password" });
        return "ok";
      } catch (e) {
        console.error("Accès régie refusé", e);
      }
      // Refus du serveur : partie terminée ou inconnue (ancien QR code), mauvais mot de passe, ou tour
      // d'essai perdu (réseau lent) : dans ce dernier cas seulement, un second essai suffit.
      const phase = await get(ref(ctx.db, `games/${gameCode}/state/phase`)).then((s) => s.val(), () => null);
      if (phase == null || phase === "ended") return "ended";
      // La bibliothèque ne s'ouvre qu'avec le bon mot de passe de régie : elle dit si c'est lui le problème.
      const accepted = await get(query(ref(ctx.db, "library/shows"), limitToFirst(1))).then(() => true, () => false);
      if (!accepted) break;
      if (attempt === 1) return "refused";
    }
  }
  return "wrong";
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
  library = null;
  closeLibrary();
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

/** Jeux au buzzer : la première équipe qui buzze répond à voix haute (ou chante), la régie juge. */
const BUZZ_KINDS = ["flou", "chante", "quisuis"];

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
    case "question": return st.mime ? (st.mime.team ? "Arrêter le tour" : mimeRemaining(st).length ? "Terminer les mimes" : "Voir le classement") : "Arrêter le chrono";
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

  $("c-step").textContent = inQuestion && st.mime
    ? `Mimes · ${st.text ?? ""}`
    : inQuestion
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
    const number = (q?.kind ?? st.kind) === "number";
    const flou = BUZZ_KINDS.includes(q?.kind ?? st.kind);
    answerBtn.textContent = answerMasked ? "Réponse masquée · toucher pour voir" : number ? `Juste Chiffre · ${correct}` : flou ? `Réponse · ${text}` : `Réponse ${CHOICE_LETTERS[correct]} · ${text}`;
    answerBtn.classList.toggle("masked", answerMasked);
  }
  const answered = Object.keys(live.answers).filter((t) => live.teams[t]).length;
  $("c-answered").textContent = BUZZ_KINDS.includes(st.kind) ? "" : st.phase === "question" || st.phase === "closed" ? `${answered} / ${teams.length} équipes ont répondu` : "";

  renderGames(st);
  renderRequests(st, teams);
  renderMime(st, teams);
  renderFlou(st);
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
  // Mimes : le gros bouton « Trouvé » est dans la rubrique ; le bas de l'écran arrête le tour ou la manche.
  if (st.phase === "question" && st.mime) next.classList.toggle("secondary", !!st.mime.team);
  else next.classList.remove("secondary");
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
  if (st.pauseReason === "network") {
    parts.push("Pause automatique : la box avait perdu Internet, les tablettes ne pouvaient plus répondre.");
  } else if (st.pauseReason === "team" && st.pauseTeam) {
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

// ---------- Mimes ----------

/** Équipe choisie pour le prochain tour de mimes (par défaut : celle qui a le moins joué). */
let mimeTeam = null;

function renderMime(st, teams) {
  const m = st.phase === "question" ? st.mime : null;
  $("mime").hidden = !m;
  document.querySelector(".regie .control").classList.toggle("mime-mode", !!m);
  if (!m) { mimeTeam = null; return; }
  const name = (id) => live.teams[id]?.name ?? "Équipe";
  const counts = m.counts ?? {};
  const turns = m.turns ?? [];
  const playing = m.team;
  const busy = !!pending?.advance || st.paused === true;
  // Pendant un tour, le choix est oublié : à la fin, la régie propose l'équipe qui a le moins joué.
  if (playing) mimeTeam = null;
  else if (!mimeTeam || !live.teams[mimeTeam]) {
    // Ordre d'inscription, en commençant par les équipes qui ont le moins joué (tri stable).
    mimeTeam = [...teams].sort(([a], [b]) => turns.filter((t) => t === a).length - turns.filter((t) => t === b).length)[0]?.[0] ?? null;
  }
  const card = m.card;
  $("mime-now").hidden = !playing || !card;
  if (card) {
    $("mime-now").querySelector(".emoji").textContent = card.image ?? "🎭";
    $("mime-now").querySelector(".word").textContent = card.word;
  }
  const n = (k) => `${k} mime${k > 1 ? "s" : ""}`;
  $("mime-info").textContent = playing
    ? `${name(playing)} joue : ${n(m.found ?? 0)} trouvé${(m.found ?? 0) > 1 ? "s" : ""} · ${m.left} carte${m.left > 1 ? "s" : ""} restante${m.left > 1 ? "s" : ""}`
    : m.last
        ? `Tour terminé : ${name(m.last.team)} a trouvé ${n(m.last.found)}. ${mimeRemaining(st).length ? "Qui joue maintenant ?" : "Toutes les équipes sont passées."}`
        : "Qui commence ? Choisissez l'équipe puis « Top départ ! ».";

  // Équipes déjà passées et celles qui restent : la manche ne se termine qu'après toutes, ou sur décision.
  const remaining = mimeRemaining(st);
  const done = [...new Set(turns)].filter((id) => live.teams[id]).map(name);
  $("mime-progress").textContent = !done.length
    ? `À faire passer : ${remaining.map(name).join(", ") || "aucune équipe"}`
    : remaining.length
      ? `Déjà passées : ${done.join(", ")} · Restent : ${remaining.map(name).join(", ")}`
      : `Toutes les équipes sont passées (${done.join(", ")}) : touchez « Voir le classement ».`;
  const box = $("mime-teams");
  box.hidden = !!playing;
  if (!box.hidden) {
    box.replaceChildren(...teams.map(([id, t]) => {
      const b = document.createElement("button");
      b.className = `mime-team${id === mimeTeam ? " selected" : ""}`;
      b.dataset.team = id;
      b.style.borderLeftColor = t.color;
      const small = document.createElement("small");
      const played = turns.filter((x) => x === id).length;
      small.textContent = `${n(counts[id] ?? 0)} · ${played ? `passée${played > 1 ? ` ${played} fois` : ""}` : "pas encore passée"}`;
      b.classList.toggle("played", played > 0);
      b.append(t.name ?? "Équipe", small);
      b.onclick = () => { mimeTeam = id; render(); };
      return b;
    }));
  }
  const go = $("mime-go");
  go.hidden = !!playing;
  go.textContent = mimeTeam ? `Top départ ! (${name(mimeTeam)})` : "Top départ !";
  go.disabled = busy || !mimeTeam;
  $("mime-found").hidden = !playing;
  $("mime-found").disabled = busy;
  $("mime-row").hidden = !playing;
  $("mime-pass").disabled = busy || (m.left ?? 0) < 2;
  $("mime-minus").disabled = busy || !(m.found > 0);
  // Juste après un tour : corriger le compte de l'équipe qui vient de jouer, sans relancer de chrono.
  const fixable = !playing && m.last;
  $("mime-fix").hidden = !fixable;
  if (fixable) {
    $("mime-fix-minus").textContent = `−1 pour ${name(m.last.team)}`;
    $("mime-fix-plus").textContent = `+1 pour ${name(m.last.team)}`;
    $("mime-fix-minus").disabled = busy || !(counts[m.last.team] > 0);
    $("mime-fix-plus").disabled = busy;
  }
}

/** Jeux au buzzer : qui a buzzé, la réponse attendue, et les deux boutons du verdict. */
function renderFlou(st) {
  const on = st.phase === "question" && BUZZ_KINDS.includes(st.kind);
  $("flou").hidden = !on;
  if (!on) return;
  const b = st.buzz ?? {};
  const name = (id) => live.teams[id]?.name ?? "Équipe";
  const q = live.plan?.questions?.[st.index];
  const answer = q?.choices?.[q?.correct] ?? "";
  const expected = st.kind === "chante" ? `une chanson avec le mot « ${answer} »` : answer;
  const tried = (b.blocked ?? []).filter((id) => live.teams[id]).map(name);
  $("flou-info").textContent = b.team
    ? `${name(b.team)} a buzzé ! Réponse attendue : ${expected || "voir la fiche"}`
    : `En attente d'un buzz…${tried.length ? ` Déjà essayé : ${tried.join(", ")}.` : ""}`;
  $("flou-judge").hidden = !b.team;
  const busy = !!pending?.advance || st.paused === true;
  $("flou-ok").disabled = busy;
  $("flou-ko").disabled = busy;
  $("flou-ok").querySelector("small").textContent = b.team ? `+${(b.blocked ?? []).length ? 100 : 150}${st.double ? " ×2" : ""} pour ${name(b.team)}` : "";
}

$("flou-ok").onclick = () => { navigator.vibrate?.(60); send("buzz_ok", {}, { advance: true }); };
$("flou-ko").onclick = () => send("buzz_ko", {}, { advance: true });

$("mime-go").onclick = () => { if (mimeTeam) send("mime_start", { team: mimeTeam }, { advance: true }); };
$("mime-found").onclick = () => { navigator.vibrate?.(60); send("mime_found", {}, { advance: true }); };
$("mime-pass").onclick = () => send("mime_pass", {}, { advance: true });
$("mime-minus").onclick = () => { const t = live.state?.mime?.team; if (t) send("mime_fix", { team: t, delta: -1 }); };
$("mime-fix-minus").onclick = () => { const t = live.state?.mime?.last?.team; if (t) send("mime_fix", { team: t, delta: -1 }); };
$("mime-fix-plus").onclick = () => { const t = live.state?.mime?.last?.team; if (t) send("mime_fix", { team: t, delta: 1 }); };

/** Équipes inscrites qui ne sont pas encore passées dans la manche de mimes en cours. */
function mimeRemaining(st) {
  const turns = st.mime?.turns ?? [];
  return Object.entries(live.teams)
    .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0))
    .map(([id]) => id)
    .filter((id) => !turns.includes(id));
}

// ---------- Jeux de la prestation : en cours, suivant, secours ----------

let rescueOpen = false;

/** Jeux (manches) du conducteur, celui en cours et le suivant. */
function gamesOf(st) {
  const questions = live.plan?.questions ?? [];
  const rounds = programRounds(questions);
  const index = st.phase === "lobby" ? -1 : st.index ?? -1;
  const current = st.phase === "ended" ? null : rounds.find((r) => r.start <= index && index <= r.end) ?? null;
  const next = st.phase === "ended" ? null : rounds.find((r) => r.start > index) ?? null;
  return { questions, rounds, index, current, next };
}

function gameName(r, questions) {
  const q = questions[r.start];
  return q?.kind === "mime" ? `Mimes : ${q.text}` : r.title;
}

function gameDetail(r, questions) {
  const q = questions[r.start];
  if (q?.kind === "mime") return `${q.cards?.length ?? 0} cartes · tour de ${q.duration} s par équipe`;
  const n = r.end - r.start + 1;
  return `${n} question${n > 1 ? "s" : ""}`;
}

function renderGames(st) {
  const { questions, rounds, current, next } = gamesOf(st);
  const line = $("c-games");
  line.replaceChildren();
  const add = (label, value) => {
    if (line.childNodes.length) line.append(" · ");
    const b = document.createElement("b");
    b.textContent = value;
    line.append(`${label} `, b);
  };
  if (rounds.length) {
    if (st.phase === "lobby") add("Premier jeu :", gameName(rounds[0], questions));
    else if (current) add("En cours :", gameName(current, questions));
    if (st.phase !== "lobby") {
      if (next) add("Ensuite :", gameName(next, questions));
      else if (st.phase !== "ended") line.append(line.childNodes.length ? " · Dernier jeu" : "Dernier jeu");
    }
  }
  // Le secours n'a de sens qu'une fois la partie commencée (au salon, « Lancer le quiz » suffit).
  $("c-rescue").hidden = st.phase === "lobby" || !rounds.length || !live.plan?.rev;
  if (rescueOpen && $("c-rescue").hidden) rescueOpen = false;
  $("rescue").hidden = !rescueOpen;
  if (rescueOpen) renderRescue(st);
}

function renderRescue(st) {
  const { questions, rounds, index, current, next } = gamesOf(st);
  const busy = !!pending?.advance;
  const nextBtn = $("rescue-next");
  nextBtn.hidden = !next;
  if (next) {
    nextBtn.textContent = busy ? "Envoi…" : `▶ Passer au jeu suivant : ${gameName(next, questions)}`;
    nextBtn.disabled = busy;
    nextBtn.onclick = () => jumpTo(next, st);
  }
  const list = $("rescue-list");
  list.replaceChildren(...rounds.map((r) => {
    const row = document.createElement("div");
    const isCurrent = r === current;
    const played = st.phase === "ended" || r.start <= index;
    row.className = `rescue-game${isCurrent ? " current" : ""}`;
    row.dataset.start = r.start;
    const name = document.createElement("span");
    name.className = "name";
    name.append(gameName(r, questions));
    const small = document.createElement("small");
    small.textContent = `${gameDetail(r, questions)} · ${isCurrent ? "en cours" : played ? "joué" : "à venir"}`;
    name.append(small);
    const b = document.createElement("button");
    b.className = played ? "btn secondary" : "btn";
    b.textContent = played ? "Rejouer" : "Aller à ce jeu";
    b.disabled = busy;
    b.onclick = () => jumpTo(r, st);
    row.append(name, b);
    return row;
  }));
}

/** Saut vers le début du jeu [r], après confirmation adaptée (aller plus loin, ou rejouer). */
async function jumpTo(r, st) {
  const { questions, index } = gamesOf(st);
  const name = gameName(r, questions);
  const replay = st.phase === "ended" || r.start <= index;
  const message = replay
    ? `Rejouer « ${name} » depuis le début ?\n\nLes points gagnés dans ce jeu sont retirés puis rejoués : rien n'est compté deux fois. Les équipes et les points des autres jeux sont gardés.`
    : `Passer directement à « ${name} » ?\n\nLe jeu en cours s'arrête là ; les points déjà gagnés sont gardés.`;
  if (!confirm(message)) return;
  const status = await send("goto", { index: r.start, qid: questions[r.start].id }, { advance: true });
  if (status?.status === "applied") {
    rescueOpen = false;
    toast(replay ? `« ${name} » est relancé.` : `C'est parti pour « ${name} » !`);
    render();
  }
}

$("c-rescue").onclick = () => { rescueOpen = true; render(); };
$("rescue-close").onclick = () => { rescueOpen = false; render(); };

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
    // Juste Chiffre : l'animatrice voit le nombre de chaque équipe pour l'annoncer.
    const answeredMark = live.answers[id] ? (st.kind === "number" ? ` · ${live.answers[id].choice}` : " · a répondu") : "";
    row.querySelector(".name").innerHTML = "";
    row.querySelector(".name").append(t.name ?? "Équipe");
    const small = document.createElement("small");
    small.textContent = (live.presence[id]?.online === true ? "connectée" : "hors ligne") + answeredMark;
    row.querySelector(".name").append(small);
    row.querySelector(".score").textContent = scores[id] ?? 0;
    row.querySelectorAll("button").forEach((b) => { b.disabled = st.phase === "ended"; });
  });
}

/**
 * Conducteur : le programme en vigueur sur la TV, manche par manche. Pendant la partie, l'animatrice peut
 * ajouter un jeu, déplacer ou retirer une manche pas encore commencée ; la manche en cours ne bouge jamais.
 */
function renderPlan(st) {
  const box = $("panel-plan");
  const plan = live.plan;
  const questions = plan?.questions ?? [];
  const index = st.phase === "lobby" ? -1 : st.index ?? -1;
  const key = JSON.stringify([plan?.title, plan?.rev, questions.map((q) => q.id ?? q.text), index, st.phase, editing]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = "";
  if (!questions.length) box.innerHTML = '<p class="hint">Le conducteur s\'affiche quand la TV l\'a publié.</p>';
  const editable = !!plan?.rev && st.phase !== "ended";
  if (questions.length && st.phase !== "ended") {
    if (editable) {
      const add = document.createElement("button");
      add.id = "plan-add";
      add.className = "btn plan-add";
      add.textContent = editing ? "Envoi à la TV…" : "＋ Ajouter un jeu";
      add.disabled = editing;
      add.onclick = openLibrary;
      box.appendChild(add);
    } else {
      box.insertAdjacentHTML("beforeend", '<p class="hint">Pour ajouter un jeu en cours de partie, mettez à jour l\'appli de la TV.</p>');
    }
  }
  const rounds = programRounds(questions);
  const future = rounds.filter((r) => questions[r.start].round && isFutureRound(r, questions, index));
  rounds.forEach((r) => {
    if (questions[r.start].round) box.appendChild(roundHead(r, rounds, future, questions, index, editable));
    for (let i = r.start; i <= r.end; i++) box.appendChild(planItem(questions[i], i, st.index));
  });
}

function roundHead(r, rounds, future, questions, index, editable) {
  const head = document.createElement("div");
  head.className = "plan-head";
  head.dataset.round = r.title;
  const title = document.createElement("p");
  title.className = "plan-round";
  title.textContent = r.title;
  const state = document.createElement("span");
  state.className = "state";
  state.textContent = r.end < index ? "jouée" : r.start <= index ? "en cours" : "";
  head.append(title, state);
  const k = future.indexOf(r);
  if (!editable || k < 0) return head;
  const button = (label, cls, disabled, action) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.className = cls;
    b.disabled = disabled || editing;
    b.onclick = action;
    head.appendChild(b);
  };
  const at = rounds.indexOf(r);
  button("↑", "up", k === 0, () => sendProgram(moveRound(questions, r.start, -1, index), `« ${r.title} » avancée d'un cran.`));
  button("↓", "down", k === future.length - 1, () => sendProgram(moveRound(questions, r.start, 1, index), `« ${r.title} » reculée d'un cran.`));
  button("Retirer", "remove", rounds.length === 1 && at === 0, () => {
    if (!confirm(`Retirer « ${r.title} » du programme ? Le quiz reste dans la bibliothèque.`)) return;
    sendProgram(removeRound(questions, r.start, index), `« ${r.title} » est retirée du programme.`);
  });
  return head;
}

function planItem(q, i, current) {
  const item = document.createElement("div");
  item.className = `plan-item${i === current ? " current" : ""}${i < current ? " done" : ""}`;
  if (q.kind === "mime") {
    const title = document.createElement("div");
    title.textContent = `${i + 1}. Mimes : ${q.text}`;
    const detail = document.createElement("b");
    detail.textContent = `${q.cards?.length ?? 0} cartes · tour de ${q.duration} s`;
    item.append(title, detail);
    return item;
  }
  const title = document.createElement("div");
  title.textContent = `${i + 1}. ${q.text}${q.double ? " (×2)" : ""}`;
  const answer = document.createElement("b");
  answer.textContent = q.kind === "number" ? `Juste Chiffre · ${q.correct}` : `${CHOICE_LETTERS[q.correct] ?? "?"} · ${q.choices?.[q.correct] ?? ""}`;
  item.append(title, answer);
  return item;
}

// ---------- Ajouter un jeu (pendant la partie) ----------

const PROGRAM_MESSAGES = {
  stale: "Le programme venait de changer (autre téléphone ?) : rien n'a été fait, le conducteur est à jour.",
  current_round: "La manche en cours ne peut pas changer : rien n'a été fait.",
  ended: "La partie est terminée : le programme ne change plus.",
  not_now: "Pas possible à cette étape.",
  invalid: "La TV n'a pas pu lire ce programme : rien n'a été fait.",
};

/** Quiz de la bibliothèque et manches des prestations déjà préparées, lus sans rien modifier. */
async function fetchLibrary() {
  library = { loading: true };
  renderLibrary();
  try {
    const [s, q, m] = await Promise.all([get(ref(db, "library/shows")), get(ref(db, "library/quizzes")), get(ref(db, "library/mimes"))]);
    const quizzes = q.val() ?? {};
    const mimes = m.val() ?? {};
    const decks = Object.entries(mimes)
      .filter(([, d]) => d?.title)
      .sort((a, b) => a[1].title.localeCompare(b[1].title, "fr"))
      .map(([id, d]) => ({ key: `mimes/${id}`, label: d.title, source: { type: "mimes", deckId: id } }));
    // Vrai ou Faux express et Zoom mystère : proposés pour chaque quiz qui a les questions qu'il faut.
    const quizGames = Object.entries(QUIZ_GAMES).flatMap(([type, game]) => Object.entries(quizzes)
      .filter(([, quiz]) => quiz?.title && game.questions(quiz).length)
      .sort((a, b) => a[1].title.localeCompare(b[1].title, "fr"))
      .map(([id, quiz]) => ({ key: `${type}/${id}`, label: `${ROUND_TYPES[type]} : ${quiz.title}`, source: { type, quizId: id } })));
    const games = Object.entries(quizzes)
      .filter(([, quiz]) => quiz?.title)
      .sort((a, b) => a[1].title.localeCompare(b[1].title, "fr"))
      .map(([id, quiz]) => ({ key: `quiz/${id}`, label: quiz.title, source: { type: "quiz", quizId: id } }));
    const rounds = Object.entries(s.val() ?? {})
      .filter(([, show]) => show)
      .sort((a, b) => (b[1].date ?? "").localeCompare(a[1].date ?? ""))
      .flatMap(([id, show]) => (show.rounds ?? []).filter((r) => r && r.type !== "mimes" && !BUILTIN_GAMES[r.type]).map((round, i) => {
        const title = quizzes[round.quizId]?.title ?? `Manche ${i + 1}`;
        const label = round.type === "finale" ? ROUND_TYPES.finale : QUIZ_GAMES[round.type] ? `${ROUND_TYPES[round.type]} : ${title}` : title;
        const date = show.date ? ` (${new Date(`${show.date}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })})` : "";
        return { key: `show/${id}/${i}`, label, from: `${showTitle(show)}${date}`, source: { type: round.type, quizId: round.quizId } };
      }));
    // Jeux au buzzer intégrés : toujours disponibles, sans rien préparer.
    const builtins = Object.entries(BUILTIN_GAMES).map(([type, game]) => ({ key: `builtin/${type}`, label: ROUND_TYPES[type], source: { type, count: game.count } }));
    library = { quizzes, mimes, games, rounds, decks, quizGames, builtins };
  } catch (e) {
    console.error(e);
    library = { denied: /permission/i.test(String(e?.message ?? e)) };
  }
  renderLibrary();
}

function openLibrary() {
  picked = null;
  $("lib").hidden = false;
  if (!library || library.denied || library.error) fetchLibrary();
  else renderLibrary();
}

function closeLibrary() {
  picked = null;
  $("lib").hidden = true;
}

function renderLibrary() {
  if ($("lib").hidden) return;
  $("lib-list").hidden = !!picked;
  $("lib-preview").hidden = !picked;
  if (picked) return renderPreview();
  const box = $("lib-list");
  box.innerHTML = "";
  const hint = (text) => { const p = document.createElement("p"); p.className = "hint"; p.textContent = text; box.appendChild(p); };
  const section = (text) => { const p = document.createElement("p"); p.className = "lib-section"; p.textContent = text; box.appendChild(p); };
  if (library?.loading) return hint("Chargement de la bibliothèque…");
  if (library?.denied) return hint("Pour ouvrir la bibliothèque, entrez dans la régie avec le mot de passe (pas avec le code de la TV).");
  if (!library?.games) return hint("Impossible de lire la bibliothèque. Vérifiez la connexion.");
  const entry = (game, detail) => {
    const b = document.createElement("button");
    b.className = "show-item";
    b.dataset.game = game.key;
    const title = document.createElement("b");
    title.textContent = game.label;
    const meta = document.createElement("span");
    if (game.source.type === "mimes") {
      const deck = library.mimes[game.source.deckId];
      const count = (deck?.cards ?? []).filter(Boolean).length;
      meta.textContent = `Mimes · ${count} carte${count > 1 ? "s" : ""} · tour de ${deck?.duration ?? 60} s`;
      b.append(title, meta);
      b.disabled = !count;
      b.onclick = () => pick(game);
      box.appendChild(b);
      return;
    }
    const builtin = BUILTIN_GAMES[game.source.type];
    if (builtin) {
      meta.textContent = `${game.source.count} ${builtin.unit}s · ${builtin.rule} · au buzzer`;
      b.append(title, meta);
      b.onclick = () => pick(game);
      box.appendChild(b);
      return;
    }
    const quiz = library.quizzes[game.source.quizId];
    const kind = QUIZ_GAMES[game.source.type];
    const count = (kind ? kind.questions(quiz) : playable(quiz)).length;
    const unit = kind?.unit ?? "question";
    meta.textContent = [detail, count ? `${count} ${unit}${count > 1 ? "s" : ""}` : "aucune question validée"].filter(Boolean).join(" · ");
    b.append(title, meta);
    b.disabled = !count;
    b.onclick = () => pick(game);
    box.appendChild(b);
  };
  section("Quiz de la bibliothèque");
  if (!library.games.length) hint("Aucun quiz pour l'instant : Sarah les prépare dans l'administration.");
  library.games.forEach((g) => entry(g, ""));
  if (library.rounds.length) section("Manches d'anciennes prestations");
  library.rounds.forEach((g) => entry(g, g.from));
  section("Mini-jeux et blind tests");
  if (!library.decks.length) hint("Mimes : aucun paquet de cartes pour l'instant (administration, Mimes).");
  library.decks.forEach((g) => entry(g, ""));
  library.quizGames.forEach((g) => entry(g, g.source.type === "express" ? "enchaînées toutes seules" : g.source.type === "flou" ? "au buzzer" : "dévoilées au fil du chrono"));
  library.builtins.forEach((g) => entry(g, ""));
  for (const label of ["Blind test"]) {
    const b = document.createElement("button");
    b.className = "show-item";
    b.disabled = true;
    const title = document.createElement("b");
    title.textContent = label;
    const soon = document.createElement("span");
    soon.className = "soon";
    soon.textContent = "Bientôt";
    b.append(title, soon);
    box.appendChild(b);
  }
}

/** Profil d'âge de la prestation chargée : les questions ajoutées prennent le même chrono. */
let profile = null;

async function pick(game) {
  try {
    const show = (await get(ref(db, `games/${code}/show`))).val();
    profile = show?.profile ?? (show?.age != null ? profileForAge(show.age) : null);
  } catch { profile = null; }
  const prefix = `a${Date.now().toString(36)}`;
  const { questions, problems } = gameQuestions(game.source, library.quizzes, profile ?? "MOYENS", prefix, library.mimes);
  picked = { game, questions, problems };
  renderLibrary();
}

function renderPreview() {
  const { game, questions, problems } = picked;
  const st = live.state ?? { phase: "lobby" };
  $("lib-name").textContent = game.label;
  const mime = questions[0]?.kind === "mime" ? questions[0] : null;
  $("lib-meta").textContent = mime
    ? `Mimes · ${mime.cards.length} cartes · tour de ${mime.duration} s par équipe`
    : [game.from, `${questions.length} question${questions.length > 1 ? "s" : ""}`].filter(Boolean).join(" · ");
  const list = $("lib-questions");
  list.innerHTML = "";
  if (mime) {
    const li = document.createElement("li");
    li.textContent = mime.cards.slice(0, 12).map((c) => `${c.image ?? ""} ${c.word}`.trim()).join(" · ") + (mime.cards.length > 12 ? " …" : "");
    list.appendChild(li);
  }
  (mime ? [] : questions).slice(0, 5).forEach((q) => {
    const li = document.createElement("li");
    const answer = document.createElement("b");
    // Chante le mot : le mot seul ; Qui suis-je : le personnage et son premier indice.
    if (q.kind === "chante") { answer.textContent = q.text; li.append(answer); list.appendChild(li); return; }
    answer.textContent = ` → ${q.kind === "number" ? q.correct : q.choices?.[q.correct] ?? ""}`;
    li.append(q.kind === "quisuis" ? `${q.image ?? ""} ${q.cards?.[0]?.word ?? ""}…`.trim() : q.text, answer);
    list.appendChild(li);
  });
  if (questions.length > 5) list.insertAdjacentHTML("beforeend", `<li class="hint">… et ${questions.length - 5} autres</li>`);
  $("lib-problems").hidden = !problems.length;
  $("lib-problems").textContent = problems.join(" ");
  const lobby = st.phase === "lobby";
  const after = $("lib-after");
  after.textContent = editing ? "Envoi à la TV…" : lobby ? "Ajouter au début" : "Ajouter après la manche actuelle";
  after.disabled = editing || !questions.length;
  $("lib-end").disabled = editing || !questions.length;
}

/**
 * Une TV d'avant les mimes refuse tout programme qui en contient : la régie le dit avant d'envoyer.
 * La box à jour l'annonce dans son conducteur (`mimes: true`).
 */
const OLD_TV = "La TV doit être mise à jour pour jouer aux mimes : sur la TV, menu Retour → « Rechercher une mise à jour ».";
const OLD_TV_NUMBER = "La TV doit être mise à jour pour jouer au Juste Chiffre : sur la TV, menu Retour → « Rechercher une mise à jour ».";
const OLD_TV_EXPRESS = "La TV doit être mise à jour pour jouer au Vrai ou Faux express : sur la TV, menu Retour → « Rechercher une mise à jour ».";
const OLD_TV_ZOOM = "La TV doit être mise à jour pour jouer au Zoom mystère : sur la TV, menu Retour → « Rechercher une mise à jour ».";
const OLD_TV_FLOU = "La TV doit être mise à jour pour jouer à l'Image floue : sur la TV, menu Retour → « Rechercher une mise à jour ».";
const OLD_TV_CHANTE = "La TV doit être mise à jour pour jouer à « Chante le mot ! » : sur la TV, menu Retour → « Rechercher une mise à jour ».";
const OLD_TV_QUISUIS = "La TV doit être mise à jour pour jouer à « Qui suis-je ? » : sur la TV, menu Retour → « Rechercher une mise à jour ».";
/** Jeu que la TV allumée ne sait pas encore jouer (ancienne version) : le message à montrer, sinon null. */
function tvRefuses(questions) {
  if (!live.plan) return null;
  if (live.plan.mimes !== true && questions.some((q) => q?.kind === "mime")) return OLD_TV;
  if (live.plan.numbers !== true && questions.some((q) => q?.kind === "number")) return OLD_TV_NUMBER;
  if (live.plan.express !== true && questions.some((q) => q?.kind === "express")) return OLD_TV_EXPRESS;
  if (live.plan.zoom !== true && questions.some((q) => q?.kind === "zoom")) return OLD_TV_ZOOM;
  if (live.plan.flou !== true && questions.some((q) => q?.kind === "flou")) return OLD_TV_FLOU;
  if (live.plan.chante !== true && questions.some((q) => q?.kind === "chante")) return OLD_TV_CHANTE;
  if (live.plan.quisuis !== true && questions.some((q) => q?.kind === "quisuis")) return OLD_TV_QUISUIS;
  return null;
}

function addPicked(where) {
  if (!picked || editing) return;
  const refused = tvRefuses(picked.questions);
  if (refused) { toast(refused); return; }
  const st = live.state ?? { phase: "lobby" };
  const current = live.plan?.questions ?? [];
  const title = uniqueRoundTitle(current, picked.questions[0]?.round ?? picked.game.label);
  const added = picked.questions.map((q) => ({ ...q, round: title }));
  copyImages(added);
  const index = st.phase === "lobby" ? -1 : st.index ?? -1;
  const place = where === "end" ? "à la fin du programme" : index < 0 ? "au début du programme" : "après la manche en cours";
  sendProgram(insertGame(current, added, where, index), `« ${title} » est ajouté ${place}.`, true);
}

/**
 * Envoie le programme modifié à la TV, préparé sur la version affichée (base) : la box refuse s'il a changé
 * entre-temps ou si la manche en cours est touchée, et répond dans showStatus/. Rien n'est écrit dans la
 * bibliothèque : ses quiz restent tels quels.
 */
async function sendProgram(questions, success, fromLibrary = false) {
  const plan = live.plan;
  if (editing || !questions || !plan?.rev) return;
  if (questions.length > MAX_QUESTIONS) { toast(`${MAX_QUESTIONS} questions au maximum dans une partie.`); return; }
  editing = true;
  render();
  if (fromLibrary) renderLibrary();
  const showRef = ref(db, `games/${code}/show`);
  const id = push(showRef).key;
  let previous = {};
  try { previous = (await get(showRef)).val() ?? {}; } catch { previous = {}; }
  // Prénom, âge et profil de la prestation sont gardés ; ses manches d'origine ne décrivent plus le programme.
  const { rounds, base, quiz, ...keep } = previous;
  const done = (message, applied) => {
    editing = false;
    if (applied || fromLibrary) closeLibrary();
    toast(message);
    render();
  };
  let stop = () => {};
  const timeout = setTimeout(() => { stop(); done("La TV ne répond pas. Vérifiez qu'elle est allumée et connectée à Internet.", false); }, 8000);
  stop = onValue(ref(db, `games/${code}/showStatus`), (s) => {
    const status = s.val();
    if (status?.id !== id) return;
    clearTimeout(timeout);
    stop();
    const applied = status.status === "applied";
    done(applied ? success : PROGRAM_MESSAGES[status.reason] ?? "La TV a refusé ce changement.", applied);
  });
  try {
    await set(showRef, {
      ...keep, id, base: plan.rev, title: plan.title || keep.title || "Programme",
      quiz: { id: plan.id, title: plan.title || keep.title || "Programme", questions }, by: uid, at: serverTimestamp(),
    });
  } catch (e) {
    console.error(e);
    clearTimeout(timeout);
    stop();
    done("Changement refusé : la partie est peut-être terminée.", false);
  }
}

$("lib-close").onclick = closeLibrary;
$("lib-back").onclick = () => { picked = null; renderLibrary(); };
$("lib-after").onclick = () => addPicked("after");
$("lib-end").onclick = () => addPicked("end");

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
    const [s, q, m] = await Promise.all([get(ref(db, "library/shows")), get(ref(db, "library/quizzes")), get(ref(db, "library/mimes"))]);
    const quizzes = q.val() ?? {};
    const mimes = m.val() ?? {};
    const today = new Date().toISOString().slice(0, 10);
    const list = Object.entries(s.val() ?? {})
      .filter(([, show]) => show.status === "publiee")
      .map(([id, show]) => ({ id, show, ...buildSnapshot(id, show, quizzes, mimes) }))
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
    const asked = snapshot?.quiz.questions.filter((x) => x.kind !== "mime").length ?? 0;
    detail.textContent = snapshot
      ? `${snapshot.rounds.length} manche${snapshot.rounds.length > 1 ? "s" : ""}${asked ? ` · ${asked} questions` : ""}`
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
/**
 * Photos d'illustration : copiées de la bibliothèque dans la partie, où la TV les lit à la révélation.
 * Jamais bloquant : une photo qui manque laisse simplement la question sans illustration.
 */
async function copyImages(questions) {
  await Promise.all(imageIds(questions).map(async (id) => {
    try {
      const target = ref(db, `games/${code}/images/${id}`);
      if ((await get(target)).exists()) return;
      const data = (await get(ref(db, `library/images/${id}`))).val();
      if (typeof data === "string") await set(target, data);
    } catch (e) {
      console.warn("Illustration non copiée", id, e);
    }
  }));
}

async function loadShow(id, snapshot) {
  if (loadingShow) return;
  const refused = tvRefuses(snapshot.quiz?.questions ?? []);
  if (refused) { toast(refused); return; }
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
  copyImages(snapshot.quiz?.questions);
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
  stale_program: "Le programme venait de changer : rien n'a été fait, la liste des jeux est à jour.",
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
  const st = live.state;
  // Mimes entre deux tours : « Terminer les mimes » passe au classement, après confirmation s'il reste des équipes.
  const left = st?.phase === "question" && st.mime && !st.mime.team ? mimeRemaining(st) : [];
  if (left.length) {
    const names = left.map((id) => live.teams[id]?.name ?? "Équipe").join(", ");
    if (!confirm(`${names} ${left.length > 1 ? "ne sont" : "n'est"} pas encore ${left.length > 1 ? "passées" : "passée"}. Terminer les mimes quand même ?`)) return;
  }
  send(st?.phase === "question" && !(st.mime && !st.mime.team) ? "close" : "next", {}, { advance: true });
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
