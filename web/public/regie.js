import {
  ref, get, set, update, push, onValue, serverTimestamp, query, limitToFirst,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { CHOICE_LETTERS } from "./theme.js";
import { writeProof } from "./proof.js";
import { parPertinence } from "./recherche.js";
import { passwordCandidates } from "./secret.js";
import {
  buildSnapshot, showTitle, playable, QUIZ_GAMES, BUILTIN_GAMES, MAX_QUESTIONS, ROUND_TYPES, programRounds, lockedUntil, gameQuestions, insertGame, imageIds, choiceImageIds,
  soundIds, MUSIC_GAMES, playableTracks, STATUES_SEC, PICTO_SEC, isStatuesList, statuesSongs, MAX_STATUES_SONGS,
  isFutureRound, moveRound, removeRound, uniqueRoundTitle, roundQuizIds, roundTirees, roundSeriesQuiz, mimePool, mimeCards, CONTENT_GAMES, activeItems, pictoSeriesOf,
  isArchived, isPhotoTheme, disparuGroup, statuesChoices, quizQuestions, jeuDeLaManche, quizKind,
  launchStates, launchLabel, jourHeure, isoDay,
} from "./show.js";
import { MIME_CATALOG } from "./mime-cards.js";
import {
  RANDOM_TYPES, RANDOM_COUNT, LEVELS, MIME_PER_TEAM, MIME_PER_TEAM_DEFAULT, randomRound, playedKeys, questionType, avoidKey,
  sourceRejouee,
  collectionItems, collectionGroups, mancheGroups, mancheSummary, cleanRound, defaultMancheTitle, COLLECTION_UNIT,
} from "./manches.js";
import { profileForAge } from "./profiles.js";
import { setAwake } from "./awake.js";
import { ouvrirDefis } from "./defis.js";
import { BANQUE, PHOTOS_BANQUE, avecPhoto, resolveBanque, lirePhotoBanque, emojiEnImage, cheminPhotoBanque } from "./banque-photos.js";

// Régie de l'animatrice, ouverte depuis la page des pupitres (bouton « Accès régie »).
// Elle n'écrit que des commandes : la box les vérifie, les applique et répond dans commandStatus/ ;
// l'écran se met à jour en relisant l'état de la partie.

const $ = (id) => document.getElementById(id);
/** Délai au-delà duquel une commande sans réponse signale une box injoignable. */
const BOX_TIMEOUT_MS = 6000;

let db, uid, code, onExit;
let serverOffset = 0;
/** Réaffichage à la fin du décompte de reprise (le bouton principal redevient actif). */
let countdownTimer = null;
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
/** L'animatrice a déjà touché un onglet : la régie ne la renvoie plus d'elle-même vers un autre. */
let tabChosen = false;
/** Prestations publiées par Sarah : null tant qu'elles ne sont pas lues. */
let shows = null;
let loadingShow = null;
/** « Mauvaise prestation ? » : la liste des prestations reste ouverte en pleine partie pour choisir la bonne. */
let wrongShow = false;
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
  setAwake(false);
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  answersUnsub?.();
  answersUnsub = null;
  answersQid = null;
  pumpsUnsub?.();
  pumpsUnsub = null;
  pumpsKey = null;
  clearInterval(timerHandle);
}

/**
 * Confirmation aux couleurs de la régie, à la place de la boîte du navigateur : titre, explication, gros
 * bouton d'action et « Annuler ». [alert] : action qui retire quelque chose (bouton en couleur d'alerte).
 * [line] : ligne en gras sous le titre (âge, date) ; [warn] : avertissement discret ; [danger] : avertissement en rouge.
 * [safe] : « Annuler » a le focus, un appui distrait ne lance rien. [ok] null : rien à faire, un seul bouton « Fermer ».
 * [password] : champ du mot de passe de la régie, passé à [action]. [action] : faite avant de refermer la fenêtre ;
 * elle renvoie un message affiché dans la fenêtre, qui reste ouverte (mot de passe faux…), ou rien si tout va bien.
 * Renvoie une promesse : vrai si l'animatrice confirme (et que l'action a réussi).
 */
function demander({ title, text = "", ok = "Confirmer", alert = false, line = "", warn = "", danger = "", safe = false, password = false, action = null }) {
  return new Promise((resolve) => {
    const box = $("ask");
    const show = (id, value) => { $(id).textContent = value; $(id).hidden = !value; };
    $("ask-title").textContent = title;
    show("ask-text", text);
    show("ask-line", line);
    show("ask-warn", warn);
    show("ask-danger", danger);
    show("ask-error", "");
    $("ask-pass-row").hidden = !password;
    $("ask-pass").value = "";
    const okBtn = $("ask-ok");
    const cancelBtn = $("ask-cancel");
    okBtn.hidden = ok == null;
    okBtn.textContent = ok ?? "";
    okBtn.disabled = false;
    okBtn.classList.toggle("alert", alert);
    cancelBtn.textContent = ok == null ? "Fermer" : "Annuler";
    let busy = false;
    const close = (answer) => {
      if (busy) return;
      box.hidden = true;
      okBtn.onclick = cancelBtn.onclick = box.onclick = $("ask-pass").onkeydown = null;
      resolve(answer);
    };
    okBtn.onclick = async () => {
      if (busy) return;
      if (!action) return close(true);
      busy = true;
      okBtn.disabled = true;
      show("ask-error", "");
      const label = okBtn.textContent;
      okBtn.textContent = "Patientez…";
      const error = await Promise.resolve().then(() => action(password ? $("ask-pass").value : undefined))
        .catch((e) => { console.error(e); return "Pas de réponse : vérifiez Internet sur ce téléphone, puis réessayez."; });
      busy = false;
      okBtn.disabled = false;
      okBtn.textContent = label;
      if (error) return show("ask-error", error);
      close(true);
    };
    cancelBtn.onclick = () => close(false);
    $("ask-pass").onkeydown = (e) => { if (e.key === "Enter") okBtn.click(); };
    // Toucher à côté de la fenêtre = annuler.
    box.onclick = (e) => { if (e.target === box) close(false); };
    box.hidden = false;
    (password ? $("ask-pass") : safe || ok == null ? cancelBtn : okBtn).focus();
  });
}

function listen(path, fn) {
  unsubscribers.push(onValue(ref(db, path), fn, (e) => console.error(path, e)));
}

function control() {
  stopListening();
  live = { state: null, teams: {}, presence: {}, plan: null, answers: {}, requests: {}, media: {}, connected: true };
  tvMuette = null;
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
  tabChosen = false;
  listen(`games/${code}/state`, (s) => {
    live.state = s.val();
    // La TV a fait avancer la partie : elle répond de nouveau, le bandeau « La TV ne répond pas » s'en va.
    if (tvMuette != null && (live.state?.seq ?? 0) !== tvMuette) tvMuette = null;
    watchAnswers();
    watchPumps();
    // En arrivant dans le salon d'attente, la première chose à faire est de charger la prestation.
    if (first && !tabChosen && live.state?.phase === "lobby") switchTab("show");
    first = false;
    render();
  });
  listen(`games/${code}/teams`, (s) => { live.teams = s.val() ?? {}; render(); });
  listen(`games/${code}/presence`, (s) => { live.presence = s.val() ?? {}; render(); });
  listen(`games/${code}/conducteur`, (s) => { live.plan = s.val(); render(); });
  listen(`games/${code}/show/facteurs`, (s) => { live.facteurs = s.val() ?? {}; render(); });
  // Blind test : la box dit, extrait par extrait, s'il est dans son cache (ok), en chargement ou manquant.
  listen(`games/${code}/media`, (s) => { live.media = s.val() ?? {}; render(); });
  listen(`games/${code}/joinRequests`, (s) => { live.requests = s.val() ?? {}; render(); });
  // Notes de Sarah pour l'animatrice, préparées dans l'administration avec la prestation.
  listen(`games/${code}/show/notes`, (s) => {
    const notes = typeof s.val() === "string" ? s.val().trim() : "";
    // Ouvertes à leur arrivée avant la partie ; l'animatrice les replie d'une touche.
    if (notes && notes !== $("c-notes-text").textContent) $("c-notes").open = (live.state?.phase ?? "lobby") === "lobby";
    $("c-notes").hidden = !notes;
    $("c-notes-text").textContent = notes;
  });
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

/** Gonfleur fou : les tapes de chaque équipe (games/<code>/pumps/<clé>), pour suivre la course sur la régie. */
let pumpsUnsub = null;
let pumpsKey = null;
function watchPumps() {
  const key = live.state?.kind === "gonfleur" ? live.state?.pump?.key ?? null : null;
  if (key === pumpsKey) return;
  pumpsUnsub?.();
  pumpsUnsub = null;
  pumpsKey = key;
  live.pumps = {};
  if (!key) return;
  pumpsUnsub = onValue(ref(db, `games/${code}/pumps/${key}`), (s) => { live.pumps = s.val() ?? {}; render(); });
}

/** Jeux au buzzer : la première équipe qui buzze répond à voix haute (ou chante), la régie juge. */
const BUZZ_KINDS = ["flou", "chante", "quisuis", "blind", "disparu"];
/** Blind test : plein tarif seulement pour un buzz dans ces premières millisecondes de l'extrait. */
const BLIND_FAST_MS = 10_000;

const PHASES = {
  lobby: "Salon d'attente",
  question: "Question en cours",
  closed: "Temps écoulé",
  reveal: "Réponse révélée",
  scores: "Scores",
  ended: "Partie terminée",
  intro: "Présentation du jeu",
};

/** Blind test piloté morceau par morceau (TV assez récente pour « Lancer le morceau »). */
function blindMode(st) {
  return st.kind === "blind" && st.blind != null && live.plan?.blindPlay === true;
}

function nextLabel(st, teamCount) {
  if (blindMode(st)) {
    const b = st.blind;
    if (st.phase === "question") return st.buzz?.team ? "Une équipe répond…" : b.waiting ? (b.played ? "▶ Relancer la musique" : "▶ Lancer le morceau") : "⏸ Arrêter la musique";
    if (st.phase === "reveal") return blindHasNext(st) ? "Titre suivant ▶" : "Bilan du blind test";
  }
  switch (st.phase) {
    case "lobby": return teamCount ? "Lancer la fête !" : "En attente des équipes";
    // Écran de présentation du jeu sur la TV : l'animatrice explique les règles, puis lance le jeu.
    case "intro": return "▶ Lancer l'épreuve";
    // Les coffres mystères : ce sont les équipes qui ouvrent les coffres, le bouton principal attend l'explosion.
    case "question": return st.kind === "coffres" ? "Coffres en cours… 🗝️" : st.kind === "gonfleur" ? "⏹ Arrêter la course" : st.kind === "patate" ? "Mèche allumée… 💣" : st.mime ? (st.mime.team ? "Arrêter le tour" : mimeRemaining(st).length ? `Terminer ${st.kind === "pictionary" ? "le Pictionary" : "les mimes"}` : "Voir le classement") : st.kind === "portes" ? "Fermer les choix" : "Arrêter le chrono";
    case "closed": return st.kind === "portes" ? "Aux portes ! 🚪" : "Révéler la réponse";
    // Portes mystères : l'animatrice ouvre les portes une à une, puis montre le classement final.
    case "reveal": return st.kind === "portes" ? ((st.portes?.opened ?? 0) < (st.portes?.count ?? 0) ? "🚪 Ouvrir la porte suivante" : "Classement final 🏆") : "Voir les scores";
    case "scores": {
      if ((st.index ?? 0) + 1 >= (st.total ?? 0)) return "Résultats finaux 🏆";
      // Fin d'un jeu : on annonce le jeu qui commence, jamais une simple « question suivante ».
      const { next, questions } = gamesOf(st);
      return next && next.start === (st.index ?? 0) + 1 ? `Jeu suivant : ${gameName(next, questions)} ▶` : "Question suivante";
    }
    case "ended": {
      const { next, questions } = gamesOf(st);
      return next ? `Jeu suivant : ${gameName(next, questions)} ▶` : "";
    }
    default: return "";
  }
}

let notesFolded = false;

function render() {
  const st = live.state ?? { phase: "lobby" };
  // Partie lancée : les notes se replient d'elles-mêmes, une fois, pour laisser la place aux commandes.
  if (st.phase !== "lobby" && !notesFolded) { $("c-notes").open = false; notesFolded = true; }
  if (st.phase === "lobby") notesFolded = false;
  // Le téléphone de la régie reste allumé pendant toute la partie, puis rend la veille normale à la fin.
  setAwake(st.phase !== "ended");
  const teams = Object.entries(live.teams).sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));
  const q = live.plan?.questions?.[st.index];
  const inQuestion = st.phase !== "lobby" && st.phase !== "ended" && st.index != null && st.index >= 0;
  const intro = st.phase === "intro";

  $("c-step").textContent = intro ? st.game?.title ?? "" : inQuestion && st.mime
    ? (st.kind === "pictionary" ? "Pictionary" : `Mimes · ${st.text ?? ""}`)
    : inQuestion
    ? `${st.game?.label ?? `Question ${st.index + 1}`}${st.double ? ` · ×${st.factor ?? 2}` : ""}`
    : st.phase === "lobby" ? live.plan?.title ?? "" : "";
  $("c-phase").textContent = st.paused ? `En pause · ${PHASES[st.phase] ?? ""}` : PHASES[st.phase] ?? "";
  $("c-phase").classList.toggle("on-hold", st.paused === true);
  renderHold(st, teams);
  renderAlerte(st, teams);
  renderFactor(st);
  renderDoors(st, q);
  $("c-question").textContent = intro ? "La TV présente le jeu. Expliquez les règles, puis lancez l'épreuve." : inQuestion ? st.text ?? q?.text ?? "" : st.phase === "ended" ? (gamesOf(st).next ? "Bravo à toutes les équipes ! Un jeu a été ajouté : la partie peut reprendre." : "Bravo à toutes les équipes ! Pour continuer, ajoutez un jeu (onglet Programme) ou rejouez-en un (⏭ Changer de jeu).") : `${teams.length} équipe${teams.length > 1 ? "s" : ""} inscrite${teams.length > 1 ? "s" : ""}`;

  const portes = (q?.kind ?? st.kind) === "portes";
  // Portes et coffres mystères : aucune réponse à montrer (le contenu des coffres est tiré à l'ouverture).
  const correct = portes || ["coffres", "gonfleur", "patate"].includes(q?.kind ?? st.kind) ? null : q?.correct ?? st.correct;
  const answerBtn = $("c-answer");
  answerBtn.hidden = intro || !inQuestion || (correct == null && !(portes && q?.doors));
  if (portes && q?.doors) {
    // Portes mystères : ce qu'il y a derrière chaque porte, pour l'animatrice seulement (masquable comme une réponse).
    const values = doorValues(q).map((v, k) => `${k + 1} : ${v > 0 ? "+" : "−"}${Math.abs(v)}`).join(" · ");
    answerBtn.textContent = answerMasked ? "Portes masquées · toucher pour voir" : `Derrière les portes · ${values}`;
    answerBtn.classList.toggle("masked", answerMasked);
  } else if (correct != null) {
    const text = (st.choices ?? q?.choices ?? [])[correct] ?? "";
    const number = (q?.kind ?? st.kind) === "number";
    const flou = BUZZ_KINDS.includes(q?.kind ?? st.kind);
    answerBtn.textContent = answerMasked ? "Réponse masquée · toucher pour voir" : number ? `Juste Chiffre · ${correct}` : flou ? `Réponse · ${text}` : `Réponse ${CHOICE_LETTERS[correct]} · ${text}`;
    answerBtn.classList.toggle("masked", answerMasked);
  }
  const answered = Object.keys(live.answers).filter((t) => live.teams[t]).length;
  $("c-answered").textContent = BUZZ_KINDS.includes(st.kind) || st.kind === "statues" || st.kind === "gonfleur" || st.kind === "patate" ? "" : st.phase === "question" || st.phase === "closed" ? `${answered} / ${teams.length} équipes ${portes ? "ont choisi leur porte" : "ont répondu"}` : "";

  renderGames(st);
  renderRequests(st, teams);
  renderTablette(st);
  renderBox();
  renderMime(st, teams);
  renderBlind(st, teams);
  renderFlou(st);
  renderStatues(st, teams);
  renderCoffres(st);
  renderGonfleur(st, teams);
  renderPatate(st);
  renderTeams(st, teams);
  renderPoints();
  renderPlan(st);
  renderShows(st);
  runTimer(st);

  const next = $("c-next");
  next.hidden = st.phase === "ended" && !gamesOf(st).next;
  next.textContent = pending?.advance ? "Envoi…" : nextLabel(st, teams.length);
  next.disabled = !!pending?.advance || (st.phase === "lobby" && teams.length === 0);
  // Pause générale : possible à toute étape d'une partie commencée.
  const pause = $("c-pause");
  pause.textContent = st.paused ? "Reprendre (3, 2, 1)" : "Pause";
  pause.classList.toggle("resume", st.paused === true);
  pause.disabled = st.phase === "lobby" || st.phase === "ended" || !!pending?.advance;
  // Décompte 3, 2, 1 d'une reprise : « Arrêter le chrono » attend la fin du décompte (un appui juste après
  // « Reprendre » fermerait la question avant qu'elle reparte : « Temps écoulé ! » sur la TV).
  const countdown = st.phase === "question" && !st.paused && (st.resumeAt ?? 0) - (Date.now() + serverOffset);
  clearTimeout(countdownTimer);
  if (countdown > 0) countdownTimer = setTimeout(render, countdown + 50);
  next.disabled = next.disabled || st.paused === true || countdown > 0 || ((st.kind === "coffres" || st.kind === "patate") && st.phase === "question") || (blindMode(st) && st.phase === "question" && !!st.buzz?.team);
  // Mimes : le gros bouton « Trouvé » est dans la rubrique ; le bas de l'écran arrête le tour ou la manche.
  if (st.phase === "question" && st.mime) next.classList.toggle("secondary", !!st.mime.team);
  else next.classList.remove("secondary");
  $("c-end").hidden = st.phase === "ended";
}

/**
 * En pause : pourquoi, et qui n'est pas prêt. La reprise reste toujours le choix de l'animatrice,
 * même quand l'équipe déconnectée est revenue.
 */
/** Super Finales dont le multiplicateur de la Régie PC a déjà été envoyé à la TV (une fois chacune). */
const facteursProposes = new Set();

/** Juste avant les dernières questions du quiz : l'animatrice choisit ×2, ×3 ou ×5 (×2 par défaut). */
function renderFactor(st) {
  const choice = st.factorChoice;
  const box = $("c-factor");
  box.hidden = !choice || isDemo();
  if (box.hidden) return;
  // Multiplicateur choisi dans la Régie PC (cedric, 23/10 : ×2 d'office) : proposé une fois, Sarah peut encore le changer.
  const voulu = live.facteurs?.[live.plan?.questions?.[choice.start]?.id];
  const cle = `${live.plan?.id ?? ""}:${choice.start}`;
  if ([3, 5].includes(voulu) && choice.factor !== voulu && !facteursProposes.has(cle)) {
    facteursProposes.add(cle);
    send("factor", { factor: voulu });
  }
  const n = (live.plan?.questions ?? []).slice(choice.start).findIndex((q, k, rest) => !(q.double || q.finale) || (k > 0 && q.round !== rest[0].round));
  const count = n < 0 ? (live.plan?.questions?.length ?? 0) - choice.start : n;
  $("c-factor-text").textContent = `${count > 1 ? `Les ${count} dernières questions du quiz arrivent` : "La dernière question du quiz arrive"} : combien de points ?`;
  box.querySelectorAll("[data-factor]").forEach((b) => {
    const on = Number(b.dataset.factor) === choice.factor;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

/** Portes mystères : valeurs en vigueur derrière les portes (celles changées par l'animatrice comprises). */
function doorValues(q) {
  const changed = live.plan?.doorValues?.[q.id];
  return q.doors.map((v, k) => (typeof changed?.[k] === "number" ? changed[k] : v));
}

/** Valeurs proposées pour une porte (points) ; une valeur tirée au hasard hors de la liste reste choisie. */
const DOOR_CHOICES = [-300, -150, -100, -50, 0, 50, 100, 150, 200, 300, 500];

/**
 * Portes mystères, avant l'ouverture : l'animatrice change la valeur d'une porte pour changer un peu le cours des
 * choses. Replié par défaut, pour que les enfants qui regardent le téléphone ne voient rien.
 */
function renderDoors(st, q) {
  const box = $("c-doors");
  const open = q?.kind === "portes" && Array.isArray(q.doors) && (st.phase === "question" || st.phase === "closed") && live.plan?.portesSet === true;
  box.hidden = !open || isDemo();
  if (box.hidden) return;
  const values = doorValues(q);
  const key = `${q.id}:${values.join(",")}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const sign = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : "0");
  $("c-doors-list").replaceChildren(...values.map((v, k) => {
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Porte ${k + 1}`);
    for (const n of [...new Set([...DOOR_CHOICES, v])].sort((a, b) => a - b)) {
      const o = document.createElement("option");
      o.value = n;
      o.textContent = `${sign(n)} points`;
      o.selected = n === v;
      select.appendChild(o);
    }
    select.onchange = () => send("portes_set", { qid: q.id, door: k, value: Number(select.value) });
    const label = document.createElement("label");
    label.className = "door-value";
    label.append(`🚪 Porte ${k + 1}`, select);
    return label;
  }));
}

/** Bandeau d'alerte : une tablette d'équipe coupée depuis 4 s (comme la pause de la TV), à tout moment de la fête. */
const ALERTE_APRES_MS = 4000;
const REVENUE_MS = 3000;
const horsLigneDepuis = new Map();
let alertees = new Set();
let masquees = new Set();
let revenue = { noms: [], jusqua: 0 };
let alerteTimer = null;

function renderAlerte(st, teams) {
  const box = $("r-alerte");
  clearTimeout(alerteTimer);
  const now = Date.now();
  const name = (id) => live.teams[id]?.name ?? "Une équipe";
  const enLigne = (id) => live.presence[id]?.online === true;
  const ids = new Set(teams.map(([id]) => id));
  for (const id of [...horsLigneDepuis.keys()]) if (!ids.has(id) || enLigne(id)) horsLigneDepuis.delete(id);
  for (const id of ids) if (!enLigne(id) && !horsLigneDepuis.has(id)) horsLigneDepuis.set(id, now);
  masquees = new Set([...masquees].filter((id) => horsLigneDepuis.has(id)));
  // La régie elle-même hors ligne ne sait plus qui est connecté : pas d'alerte. Fête finie : plus d'alerte non plus.
  const coupees = live.connected && st.phase !== "ended"
    ? teams.map(([id]) => id).filter((id) => horsLigneDepuis.has(id) && now - horsLigneDepuis.get(id) >= ALERTE_APRES_MS)
    : [];
  const revenues = [...alertees].filter((id) => ids.has(id) && enLigne(id));
  if (revenues.length) revenue = { noms: revenues.map(name), jusqua: now + REVENUE_MS };
  // Une tablette de plus vient de lâcher : le téléphone vibre (dans la poche ou posé, Sarah le sent).
  if (coupees.some((id) => !alertees.has(id) && !masquees.has(id))) navigator.vibrate?.([200, 100, 200]);
  alertees = new Set(coupees);
  const visibles = coupees.filter((id) => !masquees.has(id));
  const pluriel = visibles.length > 1 ? "s" : "";
  if (visibles.length) {
    box.className = "r-alerte";
    const reconnecter = Object.assign(document.createElement("button"), { type: "button", className: "r-alerte-reconnecter", textContent: "📱 Reconnecter" });
    reconnecter.onclick = ouvrirTablette;
    box.replaceChildren(`📵 Tablette${pluriel} déconnectée${pluriel} : ${visibles.map(name).join(", ")}`,
      Object.assign(document.createElement("small"), { textContent: `${pluriel ? "Elles se reconnectent seules" : "Elle se reconnecte seule"}. Touchez pour masquer.` }),
      reconnecter);
    // Une équipe partie pour de bon : Sarah masque le bandeau ; il revient si une autre tablette lâche.
    box.onclick = () => { masquees = new Set([...masquees, ...visibles]); render(); };
    box.hidden = false;
  } else if (revenue.jusqua > now) {
    box.className = "r-alerte revenue";
    box.replaceChildren(`✓ Tablette${revenue.noms.length > 1 ? "s" : ""} revenue${revenue.noms.length > 1 ? "s" : ""} : ${revenue.noms.join(", ")}`);
    box.onclick = null;
    box.hidden = false;
  } else box.hidden = true;
  // Prochain changement à montrer : une coupure qui atteint 4 s, ou la fin du bandeau vert.
  const prochains = [...horsLigneDepuis.values()].map((t) => t + ALERTE_APRES_MS).filter((t) => t > now);
  if (revenue.jusqua > now) prochains.push(revenue.jusqua);
  if (prochains.length) alerteTimer = setTimeout(render, Math.min(...prochains) - now + 50);
}

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
    const target = r.replace && live.teams[r.replace] ? r.replace : null;
    title.append(swatch, target ? `Une nouvelle tablette veut reprendre « ${live.teams[target].name} »` : `« ${r.name} » demande à entrer`);
    const choices = document.createElement("div");
    choices.className = "choices";
    const same = (t, id) => (target ? id === target : t.name?.trim().toLowerCase() === r.name?.trim().toLowerCase());
    const ordered = [...teams].sort(([ia, a], [ib, b]) => (same(b, ib) - same(a, ia)) || (online(ia) - online(ib)));
    const busy = admitting.has(device) || st.phase === "ended";
    ordered.forEach(([id, t]) => {
      const b = document.createElement("button");
      b.dataset.team = id;
      b.classList.toggle("suggested", same(t, id));
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

async function replaceDevice(device, team) {
  const name = live.teams[team]?.name ?? "l'équipe";
  // Irréversible : l'ancien appareil ne pourra plus jamais jouer dans cette partie.
  if (!await demander({ title: `Confier « ${name} » à ce nouvel appareil ?`, text: "Ses points sont gardés. L'ancien appareil ne pourra plus jouer.", ok: "Confier l'équipe" })) return false;
  return admit(device, "replace", { team }, `« ${name} » continue sur le nouvel appareil, avec ses points.`);
}

/** Vrai si la box a fait entrer l'appareil. */
async function admit(device, type, extra, success) {
  if (admitting.has(device)) return false;
  admitting.add(device);
  render();
  const status = await send(type, { device, ...extra });
  admitting.delete(device);
  const fait = status?.status === "applied";
  if (fait) toast(success);
  render();
  return fait;
}

// ---------- Reconnecter une tablette ----------

/**
 * « Reconnecter une tablette » (cedric, 21/10), comme le menu Retour de la TV mais sur le téléphone : un QR code
 * que la tablette scanne, elle touche le nom de son équipe, et l'animatrice la lui confie ici. Toujours en bas de
 * la régie, et dans le bandeau rouge quand une tablette est coupée.
 */
let tabletteOpen = false;

/** Lien du QR code : la page des pupitres de cette partie, en mode « reprendre une équipe ». */
function lienReprise() {
  const lien = new URL("./", location.href);
  lien.searchParams.set("g", code);
  lien.searchParams.set("reprise", "1");
  const emu = new URLSearchParams(location.search).get("emu");
  if (emu) lien.searchParams.set("emu", emu);
  return lien.href;
}

async function dessinerQr(box, texte) {
  if (box.dataset.texte === texte) return;
  box.dataset.texte = texte;
  const { qrcode } = await import("./vendor/qrcode.js");
  const qr = qrcode(0, "M");
  qr.addData(texte);
  qr.make();
  const n = qr.getModuleCount();
  const marge = 4;
  let trace = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) trace += `M${c + marge} ${r + marge}h1v1h-1z`;
  const svg = (nom, attributs) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", nom);
    for (const [k, v] of Object.entries(attributs)) el.setAttribute(k, v);
    return el;
  };
  const cote = n + 2 * marge;
  const dessin = svg("svg", { viewBox: `0 0 ${cote} ${cote}`, "shape-rendering": "crispEdges" });
  dessin.append(svg("rect", { width: cote, height: cote, fill: "#fff" }), svg("path", { d: trace, fill: "#000" }));
  box.replaceChildren(dessin);
}

function renderTablette(st) {
  $("c-tablette").disabled = st.phase === "ended";
  if (st.phase === "ended") tabletteOpen = false;
  $("tablette").hidden = !tabletteOpen;
  if (!tabletteOpen) return;
  dessinerQr($("tablette-qr"), lienReprise()).catch((e) => console.error(e));
  // Les tablettes qui ont touché le nom d'une équipe : un toucher (puis la confirmation) la leur confie.
  const demandes = Object.entries(live.requests).filter(([, r]) => r?.replace && live.teams[r.replace])
    .sort((a, b) => (a[1].at ?? 0) - (b[1].at ?? 0));
  $("tablette-attente").hidden = demandes.length > 0;
  const box = $("tablette-demandes");
  const key = JSON.stringify([demandes, [...admitting]]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren(...demandes.map(([device, r]) => {
    const b = document.createElement("button");
    b.className = "btn main";
    b.dataset.device = device;
    b.textContent = `Confier « ${live.teams[r.replace].name} » à la nouvelle tablette`;
    b.disabled = admitting.has(device);
    // Tablette confiée : la fenêtre se referme, comme sur la TV.
    b.onclick = async () => { if (await replaceDevice(device, r.replace)) { tabletteOpen = false; render(); } };
    return b;
  }));
}

function ouvrirTablette(e) {
  e?.stopPropagation();
  tabletteOpen = true;
  render();
}
$("c-tablette").onclick = ouvrirTablette;
$("tablette-close").onclick = () => { tabletteOpen = false; render(); };

// ---------- Changer de box ----------

/**
 * « 📺 Changer de box » (cedric, 21/10) : la box de la fête est en panne, ou ses données ont été effacées. Sarah branche
 * une box de secours (acceptée dans la Régie PC), touche « Nouvelle partie » et tape ici le code de son salon d'attente.
 * La régie confie alors la fête à cette box en une seule écriture, vérifiée par les règles Firebase : nouvel hôte,
 * trace du changement (takeover) et relais vers le salon (handoff). La nouvelle box ferme son salon vide et rouvre la
 * fête là où elle en était (équipes, points et programme sont dans Firebase). Les tablettes ne changent rien et ce
 * téléphone reste sur la même partie. Toujours dans les boutons de la carte, et dans le bandeau « La TV ne répond pas ».
 */
let boxOpen = false;
let boxBusy = false;
/** Numéro d'étape affiché quand la TV s'est tue (commande sans réponse) ; null tant qu'elle répond. */
let tvMuette = null;

/** Codes de partie écrits par les box (sans I, O, 0 ni 1, comme CODE_CHARS de la TV). */
const CODE_PARTIE = /^[A-HJ-NP-Z2-9]{5}$/;

const BOX_MESSAGES = {
  format: "Tapez le code à 5 caractères affiché en bas du QR code, sur la nouvelle TV.",
  activation: "Ce code à 4 caractères est celui d'une box pas encore acceptée : acceptez-la dans la Régie PC (Paramètres > Box TV), puis tapez le code à 5 caractères de sa partie.",
  meme: `C'est le code de cette fête : tapez celui affiché sur la nouvelle TV.`,
  inconnu: "Code inconnu : vérifiez le code affiché sur la nouvelle TV.",
  dejaLa: "Cette TV pilote déjà cette fête : rien à changer.",
  accueil: "Cette TV n'est pas sur son écran d'accueil. Sur la nouvelle box, choisissez « Nouvelle partie », puis tapez le nouveau code.",
  nonAcceptee: "Cette box n'est pas acceptée : acceptez-la dans la Régie PC (Paramètres > Box TV), puis réessayez.",
  autreFete: "Cette box est déjà utilisée pour une autre fête. Vérifiez le code affiché sur la TV de secours.",
  siAcceptee: "Si c'est bien elle, vérifiez qu'elle est acceptée dans la Régie PC (Paramètres > Box TV).",
  prestation: "Une prestation est déjà chargée sur cette box : sur la TV de secours, choisissez « Nouvelle partie », puis tapez le nouveau code ici.",
  ancienne: "Cette box n'a pas la dernière version de l'appli : sur la TV de secours, bouton Retour, « Rechercher une mise à jour », puis réessayez ici.",
  reseau: "Pas d'Internet sur ce téléphone : reconnectez-le, puis réessayez.",
  refus: "Changement refusé : ce téléphone n'est peut-être plus relié à la fête.",
  lent: "Toujours en attente du serveur… Vérifiez Internet sur ce téléphone.",
};

/** Une commande est restée sans réponse : la TV est peut-être en panne (jamais quand c'est ce téléphone qui a perdu Internet). */
function tvSilencieuse() {
  if (!live.connected) return;
  tvMuette = live.state?.seq ?? 0;
  render();
}

function tvRepond() {
  if (tvMuette == null) return;
  tvMuette = null;
  render();
}

function boxStatus(text, info = false) {
  $("box-status").textContent = text;
  $("box-status").classList.toggle("info", info);
}

function renderBox() {
  $("box").hidden = !boxOpen;
  $("box-go").disabled = boxBusy;
  $("box-go").textContent = boxBusy ? "Envoi…" : "Continuer sur cette box";
  $("box-code").disabled = boxBusy;
  // Bandeau « La TV ne répond pas » : rien à dire tant que la TV répond, ou pendant le changement de box.
  const alerte = $("r-tv");
  alerte.hidden = tvMuette == null || boxOpen;
  if (alerte.hidden || alerte.childNodes.length) return;
  const changer = Object.assign(document.createElement("button"), { type: "button", className: "r-alerte-reconnecter", textContent: "📺 Changer de box" });
  changer.onclick = ouvrirBox;
  alerte.replaceChildren("📺 La TV ne répond pas",
    Object.assign(document.createElement("small"), { textContent: "Vérifiez qu'elle est allumée et reliée à Internet. En panne ? La fête continue sur une autre box, avec ses équipes et ses points. Touchez pour masquer." }),
    changer);
  alerte.onclick = () => { tvMuette = null; render(); };
}

function ouvrirBox(e) {
  e?.stopPropagation();
  if (boxBusy) return;
  boxOpen = true;
  $("box-code").value = "";
  boxStatus("");
  render();
  $("box-code").focus();
}

function fermerBox() {
  if (boxBusy) return;
  boxOpen = false;
  render();
}

/**
 * Confie la fête [fete] à la box du salon d'attente [salon], en une seule écriture : nouvel hôte, trace du changement
 * (takeover) et relais vers le salon (handoff). Les règles Firebase refont toutes ces vérifications : partie existante,
 * autre que celle-ci et pilotée par une autre box, salon d'attente sans équipe, sans prestation chargée et sans le
 * téléphone d'une autre animatrice (jamais la box d'une autre fête, même sur une faute de frappe), appli de la box à
 * jour, box acceptée dans la Régie PC quand le verrou est en place. Renvoie null si c'est fait, sinon le message à
 * afficher. [etape] : avancement (« Envoi… », réseau lent). Sert à « 📺 Changer de box » (depuis la fête) comme à
 * « Continuer la fête sur cette TV » (depuis la nouvelle box).
 */
async function confierFete(fete, salon, etape = () => {}) {
  const lire = (path) => get(ref(db, path)).then((s) => s.val());
  /** Salon d'attente vide : la box vient d'être allumée sur « Nouvelle partie », aucune tablette ne l'a rejoint. */
  const salonVide = async () => {
    const [etat, equipes] = await Promise.all([lire(`games/${salon}/state/phase`), lire(`games/${salon}/teams`)]);
    return etat === "lobby" && !Object.keys(equipes ?? {}).length;
  };
  /** Box qui sait reprendre la fête d'une autre : une version plus ancienne n'écouterait pas, la fête resterait sans box. */
  const aJour = async () => (await lire(`games/${salon}/public/changeBox`)) === true;
  /** Ce téléphone est relié à la box de secours (QR scanné par habitude) : il voit si une prestation y est chargée. */
  const prestationChargee = async () =>
    !!await lire(`games/${salon}/regie/${uid}`) && await lire(`games/${salon}/show/id`) != null;
  let hote, ancien;
  /** Box acceptée dans la Régie PC : true, false, ou undefined si ce téléphone ne peut pas le lire (code de secours). */
  let acceptee;
  try {
    [hote, ancien] = await Promise.all([lire(`games/${salon}/hostUid`), lire(`games/${fete}/hostUid`)]);
    if (!hote) return BOX_MESSAGES.inconnu;
    if (hote === ancien) return BOX_MESSAGES.dejaLa;
    if (!await salonVide()) return BOX_MESSAGES.accueil;
    if (await prestationChargee()) return BOX_MESSAGES.prestation;
    if (!await aJour()) return BOX_MESSAGES.ancienne;
    if ((await lire("boxes/lockOn")) === true) {
      // Lisible avec le mot de passe de régie ; refusé à un téléphone relié par le code de secours.
      acceptee = await get(ref(db, `boxes/allowed/${hote}`)).then((s) => s.exists(), (e) => {
        if (e?.code === "PERMISSION_DENIED" || /permission/i.test(e?.message ?? "")) return undefined;
        throw e;
      });
      if (acceptee === false) return BOX_MESSAGES.nonAcceptee;
    }
  } catch (e) {
    console.error(e);
    return BOX_MESSAGES.reseau;
  }
  etape("Envoi…");
  // Réseau très lent : l'écriture part dès que possible ; on le dit sans l'annuler (la fête changerait quand même de box).
  const lent = setTimeout(() => etape(BOX_MESSAGES.lent), 8000);
  try {
    await update(ref(db), {
      [`games/${fete}/hostUid`]: hote,
      [`games/${fete}/takeover`]: { to: salon, from: ancien, by: uid, at: serverTimestamp() },
      [`games/${salon}/handoff`]: fete,
    });
  } catch (e) {
    clearTimeout(lent);
    console.error("Changement de box refusé", e);
    if (e?.code !== "PERMISSION_DENIED") return BOX_MESSAGES.reseau;
    // Refus des règles : le salon a changé entre-temps (une tablette, une prestation), ou une autre animatrice y est
    // reliée (ses données ne se lisent pas d'ici), ou la box n'est pas acceptée (seulement si on n'a pas pu le lire).
    return (async () => {
      if (!await lire(`games/${fete}/regie/${uid}`)) return BOX_MESSAGES.refus;
      if (!await salonVide()) return BOX_MESSAGES.accueil;
      if (await prestationChargee()) return BOX_MESSAGES.prestation;
      if (!await aJour()) return BOX_MESSAGES.ancienne;
      if (!await lire(`games/${salon}/regie/${uid}`)) {
        return acceptee === undefined && (await lire("boxes/lockOn")) === true
          ? `${BOX_MESSAGES.autreFete} ${BOX_MESSAGES.siAcceptee}` : BOX_MESSAGES.autreFete;
      }
      return acceptee === undefined && (await lire("boxes/lockOn")) === true ? BOX_MESSAGES.nonAcceptee : BOX_MESSAGES.refus;
    })().catch(() => BOX_MESSAGES.refus);
  }
  clearTimeout(lent);
  return null;
}

/** Vérifie le code tapé, puis confie la fête à la box de ce salon. */
async function changerDeBox(saisie) {
  const nouveau = saisie.toUpperCase().replace(/[\s-]/g, "");
  if (nouveau === code) return boxStatus(BOX_MESSAGES.meme);
  if (/^[A-Z0-9]{4}$/.test(nouveau)) return boxStatus(BOX_MESSAGES.activation);
  if (!CODE_PARTIE.test(nouveau)) return boxStatus(BOX_MESSAGES.format);
  if (!live.connected) return boxStatus(BOX_MESSAGES.reseau);
  boxBusy = true;
  boxStatus("Vérification…", true);
  render();
  const raison = await confierFete(code, nouveau, (texte) => boxStatus(texte, true));
  boxBusy = false;
  if (raison) {
    boxStatus(raison);
    return render();
  }
  boxOpen = false;
  tvMuette = null;
  render();
  toast("✓ La fête continue sur la nouvelle TV : mêmes équipes, mêmes points. Les tablettes suivent toutes seules.");
}

/** Réponses de loginWithPassword, dans la fenêtre « Continuer la fête sur cette TV ». */
const CONTINUER_MESSAGES = {
  wrong: "Mot de passe de régie incorrect.",
  ended: "Cette fête vient de se terminer : elle ne change plus de box.",
  refused: "Mot de passe correct, mais la fête a refusé l'accès. Réessayez.",
  unset: "Aucun mot de passe de régie n'est enregistré.",
  busy: "Trop d'essais en même temps. Réessayez dans quelques secondes.",
};

/** « L'anniversaire de Chloé », ou le titre de la prestation entre guillemets. */
/** Le prénom d'abord (cedric : « Lancer l'anniversaire de Chloé ? ») ; le titre seulement sans prénom. */
function nomFete(show) {
  return show.childName?.trim() ? `L'anniversaire de ${show.childName.trim()}` : `« ${showTitle(show)} »`;
}

/**
 * L'anniversaire touché est déjà chargé ou en cours sur une autre box (cedric, 21/10) : jamais une seconde fête en
 * parallèle. Box de la fête en panne : « Continuer la fête sur cette TV » la confie à la TV de ce téléphone (le même
 * changement de box, vu depuis la nouvelle box). Ce téléphone devient la régie de la fête (mot de passe redemandé et
 * vérifié par le serveur), la fête reprend ici avec ses équipes et ses points, l'ancienne box ne pilote plus rien.
 * Seulement depuis un salon d'attente neuf : aucune équipe, aucune prestation chargée, appli à jour.
 */
async function continuerIci({ show, run }) {
  const fete = run.code;
  const title = `${nomFete(show)} est déjà ${run.etat === "salon" ? "chargé" : "en cours"} sur une autre box.`;
  const line = launchLabel(run);
  const lire = (path) => get(ref(db, path)).then((s) => s.val(), () => null);
  const salonNeuf = live.state?.phase === "lobby" && !Object.keys(live.teams ?? {}).length
    && await lire(`games/${code}/show/id`) == null && await lire(`games/${code}/public/changeBox`) === true;
  if (!salonNeuf) {
    await demander({
      title, line, ok: null,
      text: "L'autre box est en panne ? Sur cette TV, choisissez « Nouvelle partie », puis touchez à nouveau l'anniversaire ici : la fête continuera sur cette TV.",
    });
    return;
  }
  const ok = await demander({
    title, line, safe: true, password: true, ok: "📺 Continuer la fête sur cette TV",
    text: "La fête continue sur cette TV, avec ses équipes et ses points. L'autre box ne pilotera plus rien.",
    danger: run.online !== false ? "L'autre box est encore allumée et connectée : à faire seulement si elle est en panne." : "",
    action: async (password) => {
      if (!password) return "Tapez le mot de passe de la régie.";
      if (!live.connected) return BOX_MESSAGES.reseau;
      const acces = await loginWithPassword({ db, uid }, fete, password);
      if (acces !== "ok") return CONTINUER_MESSAGES[acces] ?? CONTINUER_MESSAGES.refused;
      return confierFete(fete, code);
    },
  });
  if (!ok) return;
  basculerVers(fete);
  toast("✓ La fête continue sur cette TV : mêmes équipes, mêmes points. Les tablettes suivent toutes seules.");
}

/** Ce téléphone pilote désormais la fête [fete] : même page, autre partie (aussi après un rechargement). */
function basculerVers(fete) {
  code = fete;
  try {
    const url = new URL(location.href);
    url.searchParams.set("g", fete);
    history.replaceState(history.state, "", url);
  } catch (e) {
    console.warn("Adresse de la page non mise à jour", e);
  }
  wrongShow = false;
  rescueOpen = false;
  boxOpen = false;
  control();
}

$("c-box").onclick = ouvrirBox;
$("box-close").onclick = fermerBox;
$("box-form").onsubmit = (e) => {
  e.preventDefault();
  if (!boxBusy) changerDeBox($("box-code").value);
};

// ---------- Mimes ----------

/** Équipe choisie pour le prochain tour de mimes (par défaut : celle qui a le moins joué). */
let mimeTeam = null;
/** L'animatrice a choisi elle-même l'équipe (le Pictionary ne la remplace plus par celle qui voit le mot). */
let mimeChosen = false;
/** Nombre de tours déjà lancés quand le choix a été fait : un tour de plus, et le choix est oublié. */
let mimeTurnsSeen = null;

function renderMime(st, teams) {
  const m = st.phase === "question" ? st.mime : null;
  $("mime").hidden = !m;
  document.querySelector(".regie .control").classList.toggle("mime-mode", !!m);
  if (!m) { mimeTeam = null; mimeChosen = false; mimeTurnsSeen = null; return; }
  const name = (id) => live.teams[id]?.name ?? "Équipe";
  const counts = m.counts ?? {};
  const turns = m.turns ?? [];
  const playing = m.team;
  const busy = !!pending?.advance || st.paused === true;
  // Un tour a été lancé depuis le choix (même si la régie ne l'a pas vu passer : écran éteint, reconnexion) :
  // le choix est oublié, et à la fin du tour la régie propose l'équipe qui a le moins joué.
  if (turns.length !== mimeTurnsSeen) { mimeTeam = null; mimeChosen = false; mimeTurnsSeen = turns.length; }
  if (playing) { mimeTeam = null; mimeChosen = false; }
  else if (!mimeChosen || !live.teams[mimeTeam]) {
    // Ordre d'inscription, en commençant par les équipes qui ont le moins joué (tri stable).
    mimeTeam = [...teams].sort(([a], [b]) => turns.filter((t) => t === a).length - turns.filter((t) => t === b).length)[0]?.[0] ?? null;
  }
  // Pictionary : un mot par tour, d'abord montré sur la tablette de l'équipe (m.secret), puis dessiné (m.team).
  const picto = st.kind === "pictionary";
  const secret = picto ? m.secret : null;
  if (secret && live.teams[secret] && !playing && !mimeChosen) mimeTeam = secret;
  const card = m.card;
  $("mime-now").hidden = !(playing || secret) || !card;
  if (card) {
    $("mime-now").querySelector(".emoji").textContent = card.image ?? "🎭";
    $("mime-now").querySelector(".word").textContent = card.word;
  }
  const n = (k) => (picto ? `${k} dessin${k > 1 ? "s" : ""}` : `${k} mime${k > 1 ? "s" : ""}`);
  $("mime-info").textContent = picto
    ? playing
      ? `${name(playing)} dessine ! Validez dès que l'équipe a trouvé le mot.`
      : secret
        ? m.chosen != null
          ? `Le dessinateur de ${name(secret)} a choisi son mot. Masquez-le pour lancer le dessin et le chrono.`
          : `Sur la tablette de ${name(secret)}, le dessinateur choisit son mot (les autres sont retournés) : ${(m.offer ?? []).map((c) => c.word).join(" · ")}`
        : m.last
          ? `Tour terminé : ${name(m.last.team)} ${m.last.found ? `a trouvé « ${m.last.word ?? "?"} » !` : `n'a pas trouvé « ${m.last.word ?? "?"} ».`} ${mimeRemaining(st).length ? "Qui joue maintenant ?" : "Toutes les équipes sont passées."}`
          : "Qui commence ? Choisissez l'équipe, faites retourner ses coéquipiers, puis montrez le mot au dessinateur."
    : playing
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
  box.classList.toggle("picto", picto);
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
      b.onclick = () => { mimeTeam = id; mimeChosen = true; render(); };
      return b;
    }));
  }
  const go = $("mime-go");
  go.hidden = !!playing;
  go.textContent = !picto ? (mimeTeam ? `Top départ ! (${name(mimeTeam)})` : "Top départ !")
    : secret && secret === mimeTeam ? `🙈 Masquer le mot : on dessine ! (${name(secret)})`
    : mimeTeam ? `👁 Montrer le mot à ${name(mimeTeam)}` : "👁 Montrer le mot";
  // Pictionary : on ne masque qu'une fois le mot choisi par le dessinateur.
  go.disabled = busy || !mimeTeam || (picto && secret && secret === mimeTeam && m.chosen == null);
  $("mime-found").hidden = !playing;
  $("mime-found").disabled = busy;
  $("mime-found").querySelector("small").textContent = picto ? `+${m.points ?? 150} points` : "+1 mime";
  // Pictionary : « Autre mot » tant que le dessinateur découvre le sien ; pas de « Passer » ni de −1 pendant le dessin.
  $("mime-row").hidden = picto ? !secret : !playing;
  $("mime-pass").textContent = picto ? "Proposer 3 autres mots" : "Passer";
  $("mime-pass").disabled = busy || (m.left ?? 0) < (picto ? (m.offer?.length ?? 0) + 1 : 2);
  $("mime-minus").hidden = picto;
  $("mime-minus").disabled = busy || !(m.found > 0);
  // Juste après un tour : corriger le compte de l'équipe qui vient de jouer, sans relancer de chrono.
  const fixable = !playing && m.last;
  $("mime-fix").hidden = !fixable;
  if (fixable) {
    const unit = picto ? `${m.points ?? 150}` : "1";
    $("mime-fix-minus").textContent = `−${unit} pour ${name(m.last.team)}`;
    $("mime-fix-plus").textContent = `+${unit} pour ${name(m.last.team)}`;
    $("mime-fix-minus").disabled = busy || !(counts[m.last.team] > 0);
    $("mime-fix-plus").disabled = busy;
  }
}

// ---------- Blind test ----------

const BLIND_STATUS = { todo: "À jouer", playing: "En cours", found: "Trouvé", revealed: "Révélé", skipped: "Passé" };
const MEDIA_STATUS = { ok: "✓ prêt", loading: "⏳ chargement", missing: "⚠ manquant" };

function blindHasNext(st) {
  const tracks = st.blind?.tracks ?? [];
  const i = tracks.findIndex((t) => t.qid === st.qid);
  return i >= 0 && i < tracks.length - 1;
}

/**
 * Blind test : en-tête (morceau, valeur), ce qui se passe, verdict de la réponse orale, commandes de secours
 * (relancer pour tous, révéler sans points, passer, raccourcir) et playlist avec le statut de chaque morceau.
 */
function renderBlind(st, teams) {
  const on = blindMode(st) && ["question", "reveal", "scores"].includes(st.phase);
  $("blind").hidden = !on;
  document.querySelector(".regie .control").classList.toggle("blind-mode", on);
  if (!on) return;
  const b = st.blind;
  const name = (id) => live.teams[id]?.name ?? "Équipe";
  const tracks = b.tracks ?? [];
  const i = tracks.findIndex((t) => t.qid === st.qid);
  const plan = (qid) => (live.plan?.questions ?? []).find((q) => q.id === qid);
  const title = (qid) => { const q = plan(qid); return q?.choices?.[q?.correct] ?? "?"; };
  const min = Math.min(...tracks.map((t) => t.points));
  const media = (qid) => { const id = plan(qid)?.audioId; return id ? live.media?.[id] ?? "loading" : "missing"; };
  const busy = !!pending?.advance || st.paused === true;
  const q = plan(st.qid);
  const head = $("blind-head");
  head.textContent = st.phase === "scores" ? "Bilan du blind test" : `Morceau ${i + 1} / ${tracks.length} · ${b.points} points`;
  if (st.phase !== "scores" && b.points > min) {
    const tag = document.createElement("span");
    tag.className = "double";
    tag.textContent = "POINTS DOUBLÉS";
    head.append(tag);
  }
  const buzzer = st.buzz?.team;
  const tried = (st.buzz?.blocked ?? []).filter((id) => live.teams[id]).map(name);
  const expected = `« ${title(st.qid)} »${q?.artist ? ` de ${q.artist}` : ""}`;
  const ready = media(st.qid);
  let info;
  if (st.phase === "scores") {
    const found = tracks.filter((t) => t.status === "found");
    info = found.length
      ? `${found.length} morceau${found.length > 1 ? "x" : ""} trouvé${found.length > 1 ? "s" : ""} sur ${tracks.length}. Touchez le bouton du bas pour continuer.`
      : "Aucun morceau trouvé. Touchez le bouton du bas pour continuer.";
  } else if (st.phase === "reveal") {
    const winner = Object.keys(st.awards ?? {}).find((t) => st.awards[t]?.correct);
    info = winner ? `${name(winner)} a trouvé ${expected} : +${st.awards[winner].points} points.` : `Révélé sans points : ${expected}.`;
  } else if (buzzer) {
    info = `${name(buzzer)} a buzzé ! Réponse attendue : ${expected}`;
  } else if (b.waiting) {
    info = !b.played ? `Prêt : ${expected}. Touchez « Lancer le morceau » quand vous voulez.`
      : tried.length ? `Pas trouvé (${tried.join(", ")}). Relancez la musique : les autres buzzent tout de suite, ${tried.length > 1 ? "ces équipes" : tried[0]} 3 s après.`
      : "Musique arrêtée. Relancez-la, révélez ou passez le morceau.";
    if (ready === "missing") info += " ⚠ Extrait introuvable sur la TV : révélez ou passez ce morceau.";
    else if (ready === "loading") info += " ⏳ La TV charge encore l'extrait.";
  } else {
    info = `Musique en cours… En attente d'un buzz.${tried.length ? ` Déjà essayé : ${tried.join(", ")}.` : ""}`;
  }
  $("blind-info").textContent = info;
  $("blind-judge").hidden = !(st.phase === "question" && buzzer);
  $("blind-ok").disabled = busy;
  $("blind-ko").disabled = busy;
  $("blind-ok").querySelector("small").textContent = buzzer ? `+${b.points} pour ${name(buzzer)}` : "";
  const question = st.phase === "question" && !buzzer;
  // Une équipe qui s'est trompée rebuzze d'elle-même 3 s après la reprise ; l'animatrice peut lever cette attente.
  $("blind-unblock").hidden = !(question && tried.length);
  $("blind-reveal").hidden = !question;
  $("blind-skip").hidden = !question;
  $("blind-cut").hidden = !(st.phase === "reveal" && !b.cut);
  ["blind-unblock", "blind-reveal", "blind-skip", "blind-cut"].forEach((id) => { $(id).disabled = busy; });
  $("blind-row").hidden = ["blind-unblock", "blind-reveal", "blind-skip", "blind-cut"].every((id) => $(id).hidden);

  const list = $("blind-tracks");
  const key = JSON.stringify([tracks, st.qid, live.media, live.plan?.rev, Object.keys(live.teams)]);
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.replaceChildren(...tracks.map((t, k) => {
    const li = document.createElement("li");
    li.className = `blind-track${t.qid === st.qid ? " current" : ""}${t.status === "todo" || t.qid === st.qid ? "" : " done"}`;
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = `${k + 1}.`;
    const label = document.createElement("span");
    label.className = "title";
    const artist = document.createElement("small");
    artist.textContent = plan(t.qid)?.artist ?? "";
    label.append(title(t.qid), artist);
    const pts = document.createElement("span");
    pts.className = "pts";
    pts.textContent = `${t.points} pts${t.points > min ? " ×2" : ""}`;
    const status = document.createElement("span");
    status.className = "status";
    status.textContent = t.status === "found" && t.team ? `Trouvé · ${name(t.team)}` : BLIND_STATUS[t.status] ?? "";
    const m = document.createElement("span");
    const state = media(t.qid);
    m.className = `media ${state}`;
    m.textContent = t.status === "todo" || t.status === "playing" ? MEDIA_STATUS[state] ?? "" : "";
    li.append(n, label, pts, status, m);
    return li;
  }));
}

$("blind-ok").onclick = () => { navigator.vibrate?.(60); send("buzz_ok", {}, { advance: true }); };
$("blind-ko").onclick = () => send("buzz_ko", {}, { advance: true });
$("blind-unblock").onclick = () => send("blind_unblock", {}, { advance: true });
$("blind-reveal").onclick = async () => {
  if (await demander({ title: "Révéler ce morceau sans points ?", text: "La TV montre le titre et l'artiste. Aucune équipe ne marque.", ok: "Révéler sans points" })) send("blind_reveal", {}, { advance: true });
};
$("blind-skip").onclick = async () => {
  if (await demander({ title: "Passer ce morceau ?", text: "Il n'est pas révélé et ne rapporte aucun point.", ok: "Passer le morceau" })) send("blind_skip", {}, { advance: true });
};
$("blind-cut").onclick = () => send("blind_cut", {}, { advance: true });

/** Jeux au buzzer : qui a buzzé, la réponse attendue, et les deux boutons du verdict. */
function renderFlou(st) {
  const on = st.phase === "question" && BUZZ_KINDS.includes(st.kind) && !blindMode(st);
  $("flou").hidden = !on;
  if (!on) return;
  const b = st.buzz ?? {};
  const name = (id) => live.teams[id]?.name ?? "Équipe";
  const q = live.plan?.questions?.[st.index];
  const answer = q?.choices?.[q?.correct] ?? "";
  const blind = st.kind === "blind";
  const expected = st.kind === "chante" ? `une chanson avec le mot « ${answer} »`
    : blind ? `« ${answer} »${q?.artist ? ` (bonus : ${q.artist})` : ""}` : answer;
  const tried = (b.blocked ?? []).filter((id) => live.teams[id]).map(name);
  const memo = st.kind === "disparu" && st.buzzOpen !== true && !b.team && !st.paused;
  $("flou-info").textContent = b.team
    ? `${name(b.team)} a buzzé ! Réponse attendue : ${expected || "voir la fiche"}`
    : memo ? `Les enfants mémorisent les objets… Celui qui va disparaître : ${answer}.`
    : `En attente d'un buzz…${tried.length ? ` Déjà essayé : ${tried.join(", ")}.` : ""}`;
  $("flou-judge").hidden = !b.team;
  const busy = !!pending?.advance || st.paused === true;
  $("flou-ok").disabled = busy;
  $("flou-ko").disabled = busy;
  // Blind test : le chrono figé au buzz dit où en était l'extrait (plein tarif dans les 10 premières secondes).
  const late = blind && (st.durationMs ?? 0) - (st.remainingMs ?? 0) > BLIND_FAST_MS;
  const base = (b.blocked ?? []).length || late ? 100 : 150;
  const times = st.double ? " ×2" : "";
  $("flou-ok").firstChild.textContent = blind ? "BON TITRE" : "BONNE RÉPONSE";
  $("flou-ok").querySelector("small").textContent = b.team ? `+${base}${times} pour ${name(b.team)}` : "";
  $("flou-bonus").hidden = !blind;
  $("flou-bonus").disabled = busy;
  $("flou-bonus").querySelector("small").textContent = b.team ? `+${base + 50}${times} pour ${name(b.team)}` : "";
}

/** Statues musicales : un gros bouton par équipe pour désigner la gagnante, à la fin ou dès qu'il n'en reste qu'une. */
function renderStatues(st, teams) {
  const on = (st.phase === "question" || st.phase === "closed") && st.kind === "statues";
  $("statues").hidden = !on;
  if (!on) return;
  const busy = !!pending?.advance || st.paused === true;
  $("statues-info").textContent = st.phase === "closed"
    ? "La musique est finie : touchez l'équipe gagnante."
    : "Musique en cours : les enfants dansent et se figent à chaque arrêt. Éliminez ceux qui bougent, puis touchez l'équipe gagnante.";
  const box = $("statues-teams");
  const key = teams.map(([id, t]) => `${id}:${t.name}`).join("|");
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.replaceChildren(...teams.map(([id, t]) => {
      const b = document.createElement("button");
      b.className = "mime-team statues-team";
      b.dataset.team = id;
      b.textContent = `🏆 ${t.name}`;
      b.onclick = () => { navigator.vibrate?.(60); send("statues_win", { team: id }, { advance: true }); };
      return b;
    }));
  }
  box.querySelectorAll("button").forEach((b) => { b.disabled = busy; });
  $("statues-points").textContent = `${st.double ? "600" : "300"} points pour l'équipe gagnante, ${st.double ? "300" : "150"} pour les autres.`;
}

/**
 * Les coffres mystères : à qui le tour, combien de coffres sans danger, ce qui est sorti. Secours : ouvrir un coffre au
 * hasard pour l'équipe qui joue (deux appuis). Jamais de contenu à l'avance : il est tiré par la box à l'ouverture.
 */
let coffresArme = null;
let coffresPret = null;
function renderCoffres(st) {
  const on = st.phase === "question" && st.kind === "coffres";
  $("coffres").hidden = !on;
  if (!on) { clearTimeout(coffresArme); coffresArme = null; return; }
  const c = st.chests ?? {};
  const name = (id) => live.teams[id]?.name ?? "Une équipe";
  const opened = Array.isArray(c.opened) ? c.opened : Object.values(c.opened ?? {});
  $("coffres-info").textContent = c.ready !== true ? "Les coffres arrivent sur la TV…"
    : `Au tour de l'équipe ${name(c.team)} : elle choisit un coffre sur sa tablette. `
      + (!c.danger ? `Encore ${c.safeLeft} coffre${c.safeLeft > 1 ? "s" : ""} sans danger.`
        : `💣 La bombe est cachée dans un des coffres !${c.goldLeft === true ? " ⭐ Le coffre en or (+500) aussi." : ""}`);
  $("coffres-opened").textContent = opened.length
    ? opened.slice(-4).map((o) => `${name(o.team)} : coffre ${o.chest + 1} ${o.bomb ? "💣" : `${o.gold === true ? "⭐ " : ""}${o.delta < 0 ? "−" : "+"}${Math.abs(o.delta)}`}`).join(" · ")
    : `${c.count ?? 0} coffres fermés.`;
  const btn = $("coffres-random");
  const wait = (c.readyAt ?? 0) - (Date.now() + serverOffset);
  btn.disabled = c.ready !== true || !c.team || !!pending?.advance || st.paused === true || wait > 0;
  clearTimeout(coffresPret);
  if (wait > 0) coffresPret = setTimeout(render, wait + 50);
  btn.textContent = coffresArme ? `Touchez encore : coffre au hasard pour ${name(c.team)}` : `🎲 Ouvrir un coffre au hasard pour ${name(c.team)}`;
}
$("coffres-random").onclick = () => {
  if (!coffresArme) {
    coffresArme = setTimeout(() => { coffresArme = null; render(); }, 4000);
    return render();
  }
  clearTimeout(coffresArme);
  coffresArme = null;
  navigator.vibrate?.(60);
  send("chest_random", {}, { advance: true });
};

/** Gonfleur fou : la course en direct, ballon par ballon ; le bouton principal l'arrête (le plus gros ballon gagne). */
function renderGonfleur(st, teams) {
  const on = st.phase === "question" && st.kind === "gonfleur";
  $("gonfleur").hidden = !on;
  if (!on) return;
  const target = st.pump?.target ?? 100;
  const counting = !st.paused && (st.resumeAt ?? 0) > Date.now() + serverOffset;
  $("gonfleur-info").textContent = !st.pump?.key ? "Les ballons arrivent sur la TV…"
    : counting ? "3, 2, 1… Les équipes se préparent à taper."
    : "Les équipes tapent sur leur tablette : le premier ballon qui éclate gagne. « Arrêter la course » donne la victoire au plus gros ballon.";
  const box = $("gonfleur-teams");
  box.replaceChildren(...teams.map(([id, t]) => {
    const n = Math.min(target, live.pumps?.[id]?.n ?? 0);
    const row = document.createElement("div");
    row.className = "gonfleur-team";
    row.style.setProperty("--team", t.color);
    const name = document.createElement("span");
    name.textContent = t.name;
    const bar = document.createElement("span");
    bar.className = "gonfleur-bar";
    const fill = document.createElement("i");
    fill.style.width = `${Math.round((n / target) * 100)}%`;
    bar.appendChild(fill);
    const pct = document.createElement("b");
    pct.textContent = `${Math.round((n / target) * 100)} %`;
    row.append(name, bar, pct);
    return row;
  }));
}

/**
 * « Ça va exploser ! » : chez qui est la bombe, qui l'a déjà eue. Secours (deux appuis) : l'envoyer au hasard quand la
 * tablette de l'équipe ne répond plus. La mèche reste secrète, même pour la régie.
 */
let patateArme = null;
let patatePret = null;
function renderPatate(st) {
  const on = st.phase === "question" && st.kind === "patate";
  $("patate").hidden = !on;
  if (!on) { clearTimeout(patateArme); patateArme = null; return; }
  const p = st.potato ?? {};
  const name = (id) => live.teams[id]?.name ?? "Une équipe";
  const hit = p.hit ?? [];
  const pas = (p.teams ?? []).filter((id) => !hit.includes(id));
  const booms = Array.isArray(p.booms) ? p.booms : Object.values(p.booms ?? {});
  const boom = booms[booms.length - 1];
  const numero = (p.bombs ?? 1) > 1 ? `Bombe ${p.bomb ?? 1} sur ${p.bombs}. ` : "";
  $("patate-info").textContent = p.lit !== true ? "La mèche s'allume sur la TV…"
    : p.exploded === true ? `💥 BOUM chez ${name(boom?.holder)} ! La bombe ${(p.bomb ?? 1) + 1} s'allume…`
      : `${numero}💣 La bombe est chez ${name(p.holder)}${p.from ? ` (envoyée par ${name(p.from)})` : ""}. ${p.passes ?? 0} envoi${(p.passes ?? 0) > 1 ? "s" : ""}.`
        + (pas.length ? ` Pas encore touchées : ${pas.map(name).join(", ")}.` : " Toutes les équipes l'ont eue.")
        + (booms.length ? ` Déjà explosées chez : ${booms.map((x) => name(x.holder)).join(", ")}.` : "");
  const btn = $("patate-random");
  const wait = Math.max(p.readyAt ?? 0, st.resumeAt ?? 0) - (Date.now() + serverOffset);
  btn.disabled = p.lit !== true || p.exploded === true || !!pending?.advance || st.paused === true || wait > 0;
  clearTimeout(patatePret);
  if (wait > 0) patatePret = setTimeout(render, wait + 50);
  btn.textContent = patateArme ? `Touchez encore : la bombe part de chez ${name(p.holder)}` : `🎲 Envoyer la bombe au hasard pour ${name(p.holder)}`;
}
$("patate-random").onclick = () => {
  if (!patateArme) {
    patateArme = setTimeout(() => { patateArme = null; render(); }, 4000);
    return render();
  }
  clearTimeout(patateArme);
  patateArme = null;
  navigator.vibrate?.(60);
  send("potato_random", {}, { advance: true });
};

$("flou-ok").onclick = () => { navigator.vibrate?.(60); send("buzz_ok", {}, { advance: true }); };
$("flou-ko").onclick = () => send("buzz_ko", {}, { advance: true });
$("flou-bonus").onclick = () => { navigator.vibrate?.(60); send("buzz_bonus", {}, { advance: true }); };

$("mime-go").onclick = () => {
  if (!mimeTeam) return;
  const m = live.state?.mime;
  if (live.state?.kind !== "pictionary") send("mime_start", { team: mimeTeam }, { advance: true });
  else if (m?.secret && m.secret === mimeTeam) send("picto_draw", {}, { advance: true });
  else send("picto_show", { team: mimeTeam }, { advance: true });
};
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
  // Après la fin de la partie, un jeu ajouté au programme est encore « à venir » : la partie peut reprendre avec lui.
  const next = rounds.find((r) => r.start > index) ?? null;
  return { questions, rounds, index, current, next };
}

/** Jeu déjà commencé (ou joué) : y aller, c'est le recommencer. */
const played = (r, st, index) => r.start <= index && st.phase !== "lobby";

function gameName(r, questions) {
  const q = questions[r.start];
  return q?.kind === "mime" ? `Mimes : ${q.text}` : q?.kind === "pictionary" ? "Pictionary" : r.title;
}

function gameDetail(r, questions) {
  const q = questions[r.start];
  if (q?.kind === "mime") return `${q.cards?.length ?? 0} cartes · tour de ${q.duration} s par équipe`;
  if (q?.kind === "pictionary") return `un mot par équipe · ${q.duration} s de dessin · ${q.points ?? 150} points`;
  const n = r.end - r.start + 1;
  // Dernières questions du quiz à points ×2 (réglage de la manche, jamais un jeu à part).
  const double = questions.slice(r.start, r.end + 1).filter((x) => x.finale || x.double).length;
  return `${n} question${n > 1 ? "s" : ""}${double ? ` dont ${double === 1 ? "la dernière" : `les ${double} dernières`} à points ×2` : ""}`;
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
    // Au salon : tout le programme que la TV a reçu, pour vérifier d'un coup d'œil qu'aucun jeu ne manque.
    if (st.phase === "lobby") add(`Programme sur la TV (${rounds.length} jeu${rounds.length > 1 ? "x" : ""}) :`, rounds.map((r) => gameName(r, questions)).join(" → "));
    else if (current) add("En cours :", gameName(current, questions));
    if (st.phase !== "lobby") {
      if (next) add("Ensuite :", gameName(next, questions));
      else if (st.phase !== "ended") line.append(line.childNodes.length ? " · Dernier jeu" : "Dernier jeu");
    }
  }
  renderDemo(st);
  // « ＋ Jeu » toujours à portée de main : un jeu oublié s'ajoute sans chercher l'onglet Conducteur.
  $("c-add").hidden = !live.plan?.rev || !rounds.length;
  $("c-add").disabled = editing;
  // « 🔁 Rejouer » (cedric, 21/10) : dès qu'un jeu a été lancé, la liste des jeux de la fête à rejouer.
  $("c-replay").hidden = !live.plan?.rev || !rejouables(st).length;
  $("c-replay").disabled = editing;
  // Le secours n'a de sens qu'une fois la partie commencée (au salon, « Lancer la fête ! » suffit).
  $("c-rescue").hidden = st.phase === "lobby" || !rounds.length || !live.plan?.rev;
  if (rescueOpen && $("c-rescue").hidden) rescueOpen = false;
  $("rescue").hidden = !rescueOpen;
  if (rescueOpen) renderRescue(st);
}

/** La TV joue son quiz de démonstration : aucune prestation n'a été chargée. */
const isDemo = () => live.plan?.id === "demo";

/**
 * Quiz de démonstration en cours : la régie dit clairement qu'aucune prestation n'est chargée et comment
 * en lancer une (une prestation ne se charge qu'au salon d'attente, avant « Lancer la fête ! »).
 */
function renderDemo(st) {
  const box = $("c-demo");
  box.hidden = !isDemo();
  if (box.hidden) return;
  box.textContent = st.phase === "lobby"
    ? "Aucune prestation chargée : la TV jouera son quiz de démonstration. Choisissez la prestation dans l'onglet « Prestation » avant de lancer la fête."
    : "La TV joue son quiz de démonstration, pas une prestation. Pour jouer une prestation : sur la TV, touche Retour → « Terminer et lancer une nouvelle partie », puis choisissez-la dans l'onglet « Prestation » de la régie.";
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
    const done = played(r, st, index);
    row.className = `rescue-game${isCurrent ? " current" : ""}`;
    row.dataset.start = r.start;
    const name = document.createElement("span");
    name.className = "name";
    name.append(gameName(r, questions));
    const small = document.createElement("small");
    small.textContent = `${gameDetail(r, questions)} · ${isCurrent ? "en cours" : done ? "joué" : "à venir"}`;
    name.append(small);
    const b = document.createElement("button");
    b.className = done ? "btn secondary" : "btn";
    // « Recommencer » (mêmes questions, points du jeu retirés), pour ne pas le confondre avec « 🔁 Rejouer » (d'autres questions).
    b.textContent = done ? "Recommencer" : "Aller à ce jeu";
    b.disabled = busy;
    b.onclick = () => jumpTo(r, st);
    row.append(name, b);
    return row;
  }));
  // Mauvaise prestation lancée (cedric, 21/10) : discret, et seulement tant qu'aucun point n'a été donné.
  const wrong = $("rescue-wrong");
  wrong.hidden = !mayReplaceShow(st);
  wrong.onclick = () => {
    rescueOpen = false;
    wrongShow = true;
    tabChosen = true;
    switchTab("show");
  };
}

/** Saut vers le début du jeu [r], après confirmation adaptée (aller plus loin, ou recommencer). */
async function jumpTo(r, st) {
  const { questions, index } = gamesOf(st);
  const name = gameName(r, questions);
  const replay = played(r, st, index);
  const ok = await demander(replay
    ? { title: `Recommencer « ${name} » ?`, text: "Le jeu repart de sa première question, avec les mêmes questions. Les points gagnés dans ce jeu sont retirés puis rejoués : rien n'est compté deux fois. Les équipes et les points des autres jeux sont gardés.", ok: "Recommencer ce jeu", alert: true }
    : { title: `Passer à « ${name} » ?`, text: st.phase === "ended" ? "La partie reprend avec ce jeu. Les équipes et leurs points sont gardés." : `Le jeu en cours s'arrête là, ses points déjà gagnés sont gardés. Si « ${name} » avait déjà été commencé, il repart de zéro sans compter deux fois.`, ok: `Aller à « ${name} »` });
  if (!ok) return;
  // Photos et extraits du jeu recopiés dans la partie s'ils y manquent (copies effacées après la fête, partie reprise
  // sur une autre box) : jamais bloquant, une copie déjà là n'est pas refaite.
  const jeu = questions.slice(r.start, r.end + 1);
  copyImages(jeu).catch((e) => console.warn("Illustrations non recopiées", e));
  copySounds(jeu);
  const status = await send("goto", { index: r.start, qid: questions[r.start].id }, { advance: true });
  if (status?.status === "applied") {
    rescueOpen = false;
    toast(replay ? `« ${name} » recommence.` : `C'est parti pour « ${name} » !`);
    render();
  }
}

$("c-rescue").onclick = () => { rescueOpen = true; render(); };
$("c-add").onclick = () => openLibrary();
$("c-replay").onclick = () => openRejouer();
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
        + '<button class="pts-open">± Points</button>';
      row.querySelector(".pts-open").onclick = () => choosePoints(id);
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
    // Tablette qui ne peut pas rester allumée (navigateur trop ancien, batterie très faible) : Sarah le sait avant de jouer.
    const sleepy = live.presence[id]?.online === true && live.presence[id]?.awake === false ? " · ⚠ l'écran peut se mettre en veille" : "";
    small.textContent = (live.presence[id]?.online === true ? "connectée" : "hors ligne") + sleepy + answeredMark;
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
  // Même après la fin de la partie : un jeu ajouté permet de reprendre, scores gardés (récupération contrôlée).
  const editable = !!plan?.rev;
  if (questions.length) {
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
  // Jeu déjà commencé ou joué : « 🔁 Rejouer » dans tous les jeux (cedric, 21/10). Tiré d'une collection : avec
  // d'autres cartes, mots, photos ou titres ; un quiz : avec d'autres questions ; un mini-jeu : le même, tel quel.
  if (editable && k < 0 && r.start <= index && questionType(questions[r.start])) {
    const again = document.createElement("button");
    again.className = "replay";
    again.textContent = "🔁 Rejouer";
    again.disabled = editing;
    again.onclick = () => rejouerJeu(r, questions);
    head.appendChild(again);
  }
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
  button("Retirer", "remove", rounds.length === 1 && at === 0, async () => {
    if (!await demander({ title: `Retirer « ${r.title} » du programme ?`, text: "Le jeu n'est pas effacé : il reste dans la bibliothèque.", ok: "Retirer du programme", alert: true })) return;
    sendProgram(removeRound(questions, r.start, index), `« ${r.title} » est retirée du programme.`);
  });
  return head;
}

/**
 * « 🔁 Rejouer » (cedric, 21/10) : la liste des jeux déjà lancés de la fête ; un jeu touché montre ce qui sera joué
 * (d'autres questions, cartes ou photos, ✕ pour en retirer), puis « ▶ Rejouer maintenant » ou « Après le jeu en cours ».
 * Pas de quiz à cocher ni de réglages du tirage : ceux-là restent dans « ＋ Jeu ».
 */
let libRejouer = false;

/** Jeux de la fête qui ont déjà commencé (ou ont été joués), dans l'ordre du programme, avec leur type. */
function rejouables(st) {
  const { questions, rounds, index } = gamesOf(st);
  return rounds.filter((r) => played(r, st, index) && questionType(questions[r.start]));
}

function openRejouer() {
  picked = null;
  libRejouer = true;
  $("lib").hidden = false;
  if (!library || library.denied || library.error) fetchLibrary();
  else renderLibrary();
}

/** Liste « Rejouer un jeu » : un bouton par jeu déjà lancé. */
function renderRejouables(box) {
  const st = live.state ?? { phase: "lobby" };
  const { questions, current } = gamesOf(st);
  const jeux = rejouables(st);
  if (!jeux.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Aucun jeu n'a encore été lancé.";
    box.appendChild(p);
    return;
  }
  jeux.forEach((r) => {
    const b = document.createElement("button");
    b.className = "show-item rejouable";
    b.dataset.start = r.start;
    const title = document.createElement("b");
    title.textContent = gameName(r, questions);
    const meta = document.createElement("span");
    meta.textContent = r.start === current?.start ? "En cours" : "Déjà joué";
    b.append(title, meta);
    b.onclick = () => rejouerJeu(r, questions);
    box.appendChild(b);
  });
}

/** Un jeu de la fête à rejouer : tiré à nouveau dans ses collections, ou d'autres questions de son quiz. */
function rejouerJeu(r, questions) {
  libRejouer = true;
  const type = questionType(questions[r.start]);
  (RANDOM_TYPES.includes(type) ? replayWithOthers : rejouer)(type, questions.slice(r.start, r.end + 1), r.title);
}

/** Jeu ouvert depuis « 🔁 Rejouer » (ou le conducteur) : écran simplifié. */
const enRejeu = () => libRejouer && !!picked?.game?.key?.startsWith("rejouer/");

/** « Rejouer avec d'autres… » : le même jeu et ses réglages, tiré à nouveau sans rien de ce qui est au programme. */
async function replayWithOthers(type, played, title) {
  const deck = played.find((q) => q.kind === "mime" || q.kind === "pictionary");
  const base = deck ? { duration: deck.duration, ...(type === "pictionary" ? {} : { cards: deck.cards }) } : {};
  const count = deck ? (type === "pictionary" ? deck.cards.length : null) : played.length;
  picked = null;
  $("lib").hidden = false;
  // Jamais l'aperçu du jeu choisi la fois d'avant pendant que le nouveau tirage se prépare.
  $("lib-preview").hidden = true;
  if (!library?.games) await fetchLibrary();
  if (!library?.games) return;
  await pick({ key: `rejouer/${type}`, label: title.replace(/ \(\d+\)$/, ""), random: true, base, source: { type, ...(count ? { count } : {}) } });
}

/**
 * « 🔁 Rejouer » un jeu qui ne se tire pas dans les collections : un mini-jeu ou les Statues tels quels, un quiz ou un
 * Vrai ou Faux avec d'autres questions du même quiz (jamais une question déjà posée pendant la fête).
 */
async function rejouer(type, played, title) {
  picked = null;
  $("lib").hidden = false;
  // Jamais l'aperçu du jeu choisi la fois d'avant (ses questions déjà posées) pendant que les autres se préparent.
  $("lib-preview").hidden = true;
  if (!library?.games) await fetchLibrary();
  if (!library?.games) return;
  const source = sourceRejouee(type, played, library.quizzes);
  const label = title.replace(/ \(\d+\)$/, "");
  if (!source) {
    picked = { game: { key: `rejouer/${type}`, label, source: { type } }, source: { type }, questions: [], problems: ["Ce quiz n'est plus dans la bibliothèque : choisissez-en un autre avec « ＋ Jeu »."] };
    return renderLibrary();
  }
  await pick({ key: `rejouer/${type}`, label, rejouer: true, source });
}

function planItem(q, i, current) {
  const item = document.createElement("div");
  item.className = `plan-item${i === current ? " current" : ""}${i < current ? " done" : ""}`;
  if (q.kind === "mime" || q.kind === "pictionary") {
    const title = document.createElement("div");
    title.textContent = q.kind === "pictionary" ? `${i + 1}. Pictionary` : `${i + 1}. Mimes : ${q.text}`;
    const detail = document.createElement("b");
    detail.textContent = q.kind === "pictionary" ? `${q.cards?.length ?? 0} mots · ${q.duration} s de dessin par équipe` : `${q.cards?.length ?? 0} cartes · tour de ${q.duration} s`;
    item.append(title, detail);
    return item;
  }
  const title = document.createElement("div");
  title.textContent = `${i + 1}. ${q.text}${q.double ? " · points ×2" : ""}`;
  const answer = document.createElement("b");
  answer.textContent = q.kind === "patate" ? "bombe de tablette en tablette · mèche secrète" : q.kind === "gonfleur" ? "course de ballons · le premier qui éclate gagne" : q.kind === "coffres" ? "coffres chacun son tour · la bombe arrête le jeu" : q.kind === "portes" ? `${q.choices?.length ?? 0} portes · bonus ou malus` : q.kind === "number" ? `Juste Chiffre · ${q.correct}` : `${CHOICE_LETTERS[q.correct] ?? "?"} · ${q.choices?.[q.correct] ?? ""}`;
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

/**
 * Un Quiz ou un Quiz illustré fait de séries (cedric, 23/10), rejoué tel quel : son jeu, ses séries, l'ordre rangé
 * dans le « Quiz complet », sa Super Finale et son multiplicateur.
 */
const sourceEnSeries = (round) => ({
  type: round.type ?? "quiz", seriesQuiz: roundSeriesQuiz(round),
  ...(Array.isArray(round.ordreQuiz) && round.ordreQuiz.length ? { ordreQuiz: round.ordreQuiz } : {}),
  ...(round.finale > 0 ? { finale: round.finale } : {}), ...(round.facteur ? { facteur: round.facteur } : {}),
});

/** Quiz de la bibliothèque et manches des prestations déjà préparées, lus sans rien modifier. */
async function fetchLibrary() {
  library = { loading: true };
  renderLibrary();
  try {
    const [s, q, m, p, c, sm] = await Promise.all(["shows", "quizzes", "mimes", "playlists", "contents", "manches"].map((k) => get(ref(db, `library/${k}`))));
    const quizzes = q.val() ?? {};
    const mimes = m.val() ?? {};
    const playlists = p.val() ?? {};
    const contents = c.val() ?? {};
    // Manches enregistrées dans la Régie PC (page de chaque jeu) : les épinglées d'abord, jamais les archivées.
    const saved = Object.keys(ROUND_TYPES).flatMap((type) => {
      const { pinned: pins, active } = mancheGroups(sm.val() ?? {}, type, quizzes);
      return [...pins, ...active].map(([id, mc]) => [id, mc, type]);
    }).sort(([, a], [, b]) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
      .map(([id, mc, type]) => ({ key: `manche/${id}`, label: mc.title, from: `${mc.pinned ? "⭐ " : ""}${ROUND_TYPES[type] ?? type}`, manche: true, source: cleanRound(mc.round, playlists) }));
    // Blind test et quiz musical : proposés pour chaque playlist qui a des extraits.
    const music = Object.entries(MUSIC_GAMES).flatMap(([type]) => Object.entries(playlists)
      .filter(([, pl]) => pl?.title && !isStatuesList(pl) && playableTracks(pl).length >= (type === "musical" ? 2 : 1))
      .sort((a, b) => a[1].title.localeCompare(b[1].title, "fr"))
      .map(([id, pl]) => ({ key: `${type}/${id}`, label: `${ROUND_TYPES[type]} : ${pl.title}`, source: { type, playlistId: id } })));
    const decks = Object.entries(mimes)
      .filter(([, d]) => d?.title)
      .sort((a, b) => a[1].title.localeCompare(b[1].title, "fr"))
      .map(([id, d]) => ({ key: `mimes/${id}`, label: d.title, source: { type: "mimes", deckId: id } }));
    // Mimes sans paquet préparé : tirés dans toutes les collections selon l'âge, cartes modifiables avant l'ajout.
    decks.unshift({ key: "mimes/hasard", label: "Mimes au hasard", random: true, source: { type: "mimes", random: true } });
    // Quiz illustré, Vrai ou Faux express, Zoom mystère, Image floue : proposés pour chaque quiz qui a les questions qu'il faut.
    const quizGames = Object.entries(QUIZ_GAMES).flatMap(([type, game]) => Object.entries(quizzes)
      .filter(([, quiz]) => quiz?.title && game.questions(quiz).length)
      .sort((a, b) => a[1].title.localeCompare(b[1].title, "fr"))
      .map(([id, quiz]) => ({ key: `${type}/${id}`, label: `${ROUND_TYPES[type]} : ${quiz.title}`, source: { type, quizId: id } })));
    // Quiz : les quiz classiques (les quiz illustrés sont proposés en Quiz illustré).
    const games = Object.entries(quizzes)
      .filter(([, quiz]) => quiz?.title && quizKind(quiz) !== "photo")
      .sort((a, b) => a[1].title.localeCompare(b[1].title, "fr"))
      .map(([id, quiz]) => ({ key: `quiz/${id}`, label: quiz.title, source: { type: "quiz", quizId: id } }));
    const rounds = Object.entries(s.val() ?? {})
      .filter(([, show]) => show)
      .sort((a, b) => (b[1].date ?? "").localeCompare(a[1].date ?? ""))
      .flatMap(([id, show]) => (show.rounds ?? []).map((r) => jeuDeLaManche(r, quizzes)).filter((r) => r && r.type !== "mimes" && r.type !== "statues" && r.type !== "pictionary" && r.type !== "portes" && r.type !== "coffres" && r.type !== "gonfleur" && r.type !== "patate" && r.type !== "finale" && !BUILTIN_GAMES[r.type] && !MUSIC_GAMES[r.type]).map((round, i) => {
        const series = roundSeriesQuiz(round);
        const title = [...(roundTirees(round).length ? ["Quiz tiré au hasard"] : []), ...roundQuizIds(round).map((q) => quizzes[q]?.title).filter(Boolean)].join(" + ") || `Manche ${i + 1}`;
        // Quiz et Quiz illustré en séries (cedric, 23/10) : le nom du jeu, puis ses séries.
        const label = series.length ? `${ROUND_TYPES[round.type ?? "quiz"]} (${series.length > 1 ? `${series.length} séries` : roundQuizIds(round).map((q) => quizzes[q]?.title).filter(Boolean)[0] ?? "1 série"})`
          : QUIZ_GAMES[round.type] ? `${ROUND_TYPES[round.type]} : ${title}` : title;
        const date = show.date ? ` (${new Date(`${show.date}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })})` : "";
        // Les réglages de la manche suivent (nombre de questions, Super Finale à la fin du quiz).
        // Quiz en séries (cedric, 23/10) : rejoué tel quel, ses séries dans l'ordre, sa Super Finale et son multiplicateur.
        if (series.length) return { key: `show/${id}/${i}`, label, from: `${showTitle(show)}${date}`, source: sourceEnSeries(round) };
        return { key: `show/${id}/${i}`, label, from: `${showTitle(show)}${date}`, source: { type: round.type, quizId: round.quizId, ...(roundQuizIds(round).length > 1 ? { quizIds: roundQuizIds(round) } : {}), ...(roundTirees(round).length ? { tirees: roundTirees(round) } : {}), ...(round.count > 0 ? { count: round.count } : {}), ...(round.finale > 0 ? { finale: round.finale } : {}) } };
      }));
    // Jeux au buzzer intégrés : toujours disponibles, sans rien préparer.
    const builtins = [
      ...Object.entries(BUILTIN_GAMES).map(([type, game]) => ({ key: `builtin/${type}`, label: ROUND_TYPES[type], random: true, source: { type, count: game.count } })),
      // Statues musicales : toutes les chansons de la liste (page du jeu dans la Régie PC), sinon la musique maison.
      { key: "builtin/statues", label: ROUND_TYPES.statues, source: { type: "statues", duration: STATUES_SEC, songs: statuesSongs(playlists).map((t) => t.audioId).slice(0, MAX_STATUES_SONGS) } },
      { key: "builtin/pictionary", label: ROUND_TYPES.pictionary, random: true, source: { type: "pictionary", duration: PICTO_SEC } },
      { key: "builtin/coffres", label: ROUND_TYPES.coffres, source: { type: "coffres" } },
      { key: "builtin/gonfleur", label: ROUND_TYPES.gonfleur, source: { type: "gonfleur" } },
      { key: "builtin/patate", label: ROUND_TYPES.patate, source: { type: "patate" } },
    ];
    // Prestations épinglées (modèles) : chacun de leurs jeux, dans leur ordre, proposé en premier.
    const pinned = Object.entries(s.val() ?? {})
      .filter(([, show]) => show?.pinned && isArchived(show))
      .sort((a, b) => showTitle(a[1]).localeCompare(showTitle(b[1]), "fr"))
      .flatMap(([id, show]) => (show.rounds ?? []).filter(Boolean).map((r) => jeuDeLaManche(r, quizzes)).map((round, i) => {
        const key = `pin/${id}/${i}`;
        const from = showTitle(show);
        const ids = roundQuizIds(round);
        const tirees = roundTirees(round);
        if (roundSeriesQuiz(round).length) return { key, label: ROUND_TYPES[round.type ?? "quiz"], from, source: sourceEnSeries(round) };
        // Questions tirées au 🎲, suivies du quiz choisi en plus s'il y en a un (deuxième ligne).
        const choisis = ids.filter((q) => quizzes[q]);
        if (tirees.length) {
          return { key, label: ["Quiz tiré au hasard", ...choisis.map((q) => quizzes[q].title)].join(" + "), from, source: { type: "quiz", tirees,
            ...(choisis.length ? { quizId: choisis[0], ...(choisis.length > 1 ? { quizIds: choisis } : {}), ...(round.count > 0 ? { count: round.count } : {}) } : {}),
            ...(round.finale > 0 ? { finale: round.finale } : {}) } };
        }
        if (ids.length && round.type !== "mimes" && !MUSIC_GAMES[round.type]) {
          if (!quizzes[ids[0]]) return null;
          const title = ids.map((q) => quizzes[q]?.title).filter(Boolean).join(" + ");
          const label = QUIZ_GAMES[round.type] ? `${ROUND_TYPES[round.type] ?? round.type} : ${title}` : title;
          return { key, label, from, source: { type: round.type, quizId: ids[0], ...(ids.length > 1 ? { quizIds: ids } : {}), ...(round.count > 0 ? { count: round.count } : {}), ...(round.finale > 0 ? { finale: round.finale } : {}) } };
        }
        const same = (g) => g.source.type === round.type;
        const found = round.deckId ? decks.find((g) => same(g) && g.source.deckId === round.deckId)
          : round.playlistId ? music.find((g) => same(g) && g.source.playlistId === round.playlistId)
          : round.type === "mimes" ? decks.find((g) => g.source.random)
          : builtins.find(same);
        return found ? { ...found, key, from } : null;
      }))
      .filter(Boolean);
    // Photos et extraits tirés au hasard dans toutes les collections (jamais une photo ou un titre déjà joué).
    const drawn = ["zoom", "flou", "blind", "musical"]
      .map((type) => ({ type, n: collectionItems(type, { quizzes, playlists }, { hasard: true }).length }))
      .filter(({ n }) => n > 0)
      .map(({ type, n }) => ({ key: `hasard/${type}`, label: `${ROUND_TYPES[type]} au hasard`, random: true, size: n, source: { type } }));
    library = { quizzes, mimes, playlists, contents, games, rounds, decks, quizGames, builtins, music, pinned, saved, drawn };
  } catch (e) {
    console.error(e);
    library = { denied: /permission/i.test(String(e?.message ?? e)) };
  }
  renderLibrary();
}

function openLibrary() {
  picked = null;
  libRejouer = false;
  $("lib").hidden = false;
  if (!library || library.denied || library.error) fetchLibrary();
  else renderLibrary();
}

function closeLibrary() {
  picked = null;
  libRejouer = false;
  $("lib").hidden = true;
}

function renderLibrary() {
  if ($("lib").hidden) return;
  $("lib-title").textContent = libRejouer ? "Rejouer un jeu" : "Ajouter un jeu";
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
  if (libRejouer) return renderRejouables(box);
  const entry = (game, detail) => {
    const b = document.createElement("button");
    b.className = "show-item";
    b.dataset.game = game.key;
    const title = document.createElement("b");
    title.textContent = game.label;
    const meta = document.createElement("span");
    if (game.manche || game.size) {
      meta.textContent = game.manche ? [detail, mancheSummary(game.source, library)].filter(Boolean).join(" · ")
        : `${game.size} ${COLLECTION_UNIT[game.source.type][game.size > 1 ? 1 : 0]} dans les collections · jamais deux fois le même`;
      b.append(title, meta);
      b.onclick = () => pick(game);
      box.appendChild(b);
      return;
    }
    if (game.source.type === "mimes" && game.source.random) {
      meta.textContent = `${MIME_PER_TEAM_DEFAULT} cartes par équipe, selon l'âge · jamais une carte déjà jouée`;
      b.append(title, meta);
      b.onclick = () => pick(game);
      box.appendChild(b);
      return;
    }
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
    if (MUSIC_GAMES[game.source.type]) {
      const pl = library.playlists[game.source.playlistId];
      const count = playableTracks(pl).length;
      meta.textContent = `${count} morceau${count > 1 ? "x" : ""} · extraits de ${pl?.duration ?? 25} s · ${MUSIC_GAMES[game.source.type].rule}`;
      b.append(title, meta);
      b.onclick = () => pick(game);
      box.appendChild(b);
      return;
    }
    if (game.source.type === "pictionary") {
      meta.textContent = `${game.source.duration ?? PICTO_SEC} s de dessin par équipe · un mot par tour · jamais un mot déjà joué`;
      b.append(title, meta);
      b.onclick = () => pick(game);
      box.appendChild(b);
      return;
    }
    if (game.source.type === "coffres") {
      meta.textContent = "un coffre chacun son tour · bonus, malus, puis la bombe · idéal en dernier jeu";
      b.append(title, meta);
      b.onclick = () => pick(game);
      box.appendChild(b);
      return;
    }
    if (game.source.type === "patate") {
      meta.textContent = "la bombe passe de tablette en tablette · 3 s au plus par équipe · mèche secrète · rien à préparer";
      b.append(title, meta);
      b.onclick = () => pick(game);
      box.appendChild(b);
      return;
    }
    if (game.source.type === "gonfleur") {
      meta.textContent = "chaque équipe tapote sa tablette · le premier ballon qui éclate gagne";
      b.append(title, meta);
      b.onclick = () => pick(game);
      box.appendChild(b);
      return;
    }
    if (game.source.type === "statues") {
      const n = game.source.songs?.length ?? 0;
      meta.textContent = `${game.source.duration} s de musique (${n ? `${n} chanson${n > 1 ? "s" : ""}` : "musique de la fête"}) · on se fige à l'arrêt · vous désignez l'équipe gagnante`;
      b.append(title, meta);
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
  if (library.pinned?.length) section("⭐ Prestations épinglées");
  library.pinned?.forEach((g) => entry(g, g.from));
  if (library.saved?.length) section("Manches préparées");
  library.saved?.forEach((g) => entry(g, g.from));
  section("Quiz de la bibliothèque");
  if (!library.games.length) hint("Aucun quiz pour l'instant : Sarah les prépare dans l'administration.");
  library.games.forEach((g) => entry(g, ""));
  if (library.rounds.length) section("Manches d'anciennes prestations");
  library.rounds.forEach((g) => entry(g, g.from));
  section("Mini-jeux et blind tests");
  library.decks.forEach((g) => entry(g, ""));
  library.quizGames.forEach((g) => entry(g, g.source.type === "express" ? "enchaînées toutes seules" : g.source.type === "flou" ? "au buzzer" : "dévoilées au fil du chrono"));
  library.builtins.forEach((g) => entry(g, ""));
  library.drawn?.forEach((g) => entry(g, ""));
  if (!library.music.length) hint("Blind test : aucune playlist pour l'instant (administration, Blind test).");
  library.music.forEach((g) => entry(g, ""));
}

/** Profil d'âge de la prestation chargée : les questions ajoutées prennent le même chrono. */
let profile = null;

async function pick(game) {
  try {
    const show = (await get(ref(db, `games/${code}/show`))).val();
    profile = show?.profile ?? (show?.age != null ? profileForAge(show.age) : null);
  } catch { profile = null; }
  picked = { game, source: { ...game.source } };
  searchText = "";
  if (game.random) picked.random = randomSettings(game.source.type, { count: game.source.count, base: game.base });
  drawPicked();
}

/** Réglages du tirage au hasard d'un jeu : difficulté, catégories, cartes par équipe (mimes), manche à rejouer. */
function randomSettings(type, { count = null, base = null } = {}) {
  // Mimes, Qui a disparu ? : en émojis ou en photos (« Rejouer » garde le choix de la manche jouée).
  const photos = (type === "mimes" || type === "disparu") && (PHOTOS_BANQUE.size || base?.photos === true) ? { photos: base?.photos === true } : {};
  return { type, level: "moyen", groups: [], count, base, perTeam: type === "mimes" && !base ? MIME_PER_TEAM_DEFAULT : null, ...photos };
}

/** Équipes de la partie (pour les cartes de mimes par équipe), null tant qu'il n'y en a aucune. */
const teamsNow = () => Object.keys(live.teams ?? {}).length || null;

/** Ce qui est déjà au programme de la fête (joué ou prévu) : jamais tiré une deuxième fois. */
const alreadyPlayed = () => playedKeys(live.plan?.questions ?? [], library?.contents);

/** Questions du jeu choisi, d'après sa source (quiz cochés, tirage au hasard) : un nouveau tirage à chaque appel. */
function drawPicked() {
  const prefix = `a${Date.now().toString(36)}`;
  const avoid = alreadyPlayed();
  const teams = teamsNow();
  const notes = [];
  if (picked.random) {
    // Tirage dans les collections du jeu, sans rien de ce que la fête a déjà au programme.
    const rnd = picked.random;
    const { round, exhausted, count } = randomRound(rnd.type, library, {
      profile: profile ?? "MOYENS", level: rnd.level, groups: rnd.groups, avoid: avoid[avoidKey(rnd.type)], avoidConcepts: avoid.concepts, teams, base: rnd.base ?? undefined,
      ...(rnd.type === "mimes" && rnd.perTeam ? { perTeam: rnd.perTeam } : rnd.count ? { count: rnd.count } : {}), playlists: library.playlists,
      ...(typeof rnd.photos === "boolean" ? { photos: rnd.photos } : {}),
    });
    if (!round) {
      Object.assign(picked, { questions: [], problems: ["Plus rien de nouveau à tirer : tout a déjà été joué pendant la fête (ou rien dans ces catégories)."] });
      return renderLibrary();
    }
    picked.source = round;
    if (exhausted) notes.push(`Liste plus courte : il ne restait que ${count} ${COLLECTION_UNIT[rnd.type][count > 1 ? 1 : 0]} à tirer pendant cette fête.`);
  }
  // Un paquet, un quiz ou une manche choisis exprès se jouent tels quels ; seul le hasard écarte ce qui est déjà passé
  // (« jamais deux fois » : leurs parties tirées au hasard, comme les objets de Qui a disparu ?, évitent ce que la fête a montré).
  const { questions, problems } = gameQuestions(picked.source, library.quizzes, profile ?? "MOYENS", prefix, library.mimes, library.playlists, library.contents, picked.random || picked.game.rejouer ? avoid : { concepts: avoid.concepts }, teams);
  Object.assign(picked, { questions, problems: [...notes, ...problems] });
  renderLibrary();
}

/** Jeux tirés au hasard (mimes du catalogue, jeux au buzzer intégrés, Pictionary) : « Nouveau tirage » possible. */
const isDrawn = (source) => !!picked?.random || (source.type === "mimes" && source.random) || !!BUILTIN_GAMES[source.type] || source.type === "pictionary";

/** Nom du jeu choisi : avec plusieurs quiz cochés, leurs titres réunis. */
function pickedName() {
  const { game, source } = picked;
  const ids = roundQuizIds(source);
  if (ids.length < 2) return game.label;
  const titles = ids.map((id) => library.quizzes[id]?.title).filter(Boolean).join(" + ");
  return QUIZ_GAMES[source.type] ? `${ROUND_TYPES[source.type]} : ${titles}` : titles;
}

/**
 * Réglages du jeu choisi, avant de l'ajouter : cocher d'autres quiz (jamais de questions tirées au hasard),
 * nouveau tirage, et une carte (ou un mot, un personnage) à ajouter à la main.
 */
function renderPickedEdit(questions) {
  const box = $("lib-edit");
  box.innerHTML = "";
  const { source } = picked;
  const add = (...nodes) => box.append(...nodes);
  // Jeux tirés d'un quiz : les autres quiz qui conviennent, à cocher pour les enchaîner dans le même jeu.
  // Pas pendant un rejeu (cedric, 21/10) : on regarde ce qui sera joué, on retire, on lance.
  const rejeu = enRejeu();
  // Un quiz tiré au hasard dans la Régie PC garde ses questions : pas d'autre quiz à enchaîner.
  if (!rejeu && !roundTirees(source).length && !roundSeriesQuiz(source).length && (source.type === "quiz" || QUIZ_GAMES[source.type])) {
    const kind = QUIZ_GAMES[source.type];
    const ids = roundQuizIds(source);
    const others = Object.entries(library.quizzes)
      .filter(([, q]) => q?.title && (kind ? kind.questions(q) : quizQuestions(q)).length)
      .sort((a, b) => a[1].title.localeCompare(b[1].title, "fr"));
    if (others.length > 1) {
      const p = document.createElement("p");
      p.className = "lib-section";
      p.textContent = "Quiz du jeu (touchez pour en ajouter ou en retirer)";
      const chips = document.createElement("div");
      chips.className = "lib-chips";
      others.forEach(([id, q]) => {
        const on = ids.includes(id);
        const c = document.createElement("button");
        c.className = `lib-chip lib-quiz${on ? " on" : ""}`;
        c.dataset.quiz = id;
        c.setAttribute("aria-pressed", on ? "true" : "false");
        const n = (kind ? kind.questions(q) : quizQuestions(q)).length;
        c.textContent = `${on ? "✓ " : ""}${q.title} (${n})`;
        // Toujours au moins un quiz : le dernier coché ne se retire pas.
        c.disabled = on && ids.length === 1;
        c.onclick = () => {
          const next = on ? ids.filter((x) => x !== id) : [...ids, id];
          picked.source = { ...source, quizId: next[0], quizIds: next };
          drawPicked();
        };
        chips.appendChild(c);
      });
      add(p, chips);
    }
  }
  if (picked.random && !rejeu) add(...randomPanel(picked.random));
  if (isDrawn(source)) {
    const b = document.createElement("button");
    b.id = "lib-draw";
    b.className = "btn secondary";
    b.textContent = "🎲 Nouveau tirage";
    b.onclick = drawPicked;
    add(b);
  }
  const choices = rejeu ? [] : addChoices(questions);
  if (choices.length) {
    const sel = document.createElement("select");
    sel.id = "lib-add";
    sel.className = "lib-add";
    sel.setAttribute("aria-label", "Ajouter à la main");
    const label = source.type === "mimes" || source.type === "pictionary" ? "＋ Ajouter une carte…"
      : source.type === "zoom" || source.type === "flou" ? "＋ Ajouter une photo…"
      : source.type === "statues" ? "＋ Choisir une chanson (jouée en premier)…"
      : MUSIC_GAMES[source.type] ? "＋ Ajouter un titre…" : `＋ Ajouter ${CONTENT_GAMES[source.type]?.unit === "famille" ? "une famille" : `un ${CONTENT_GAMES[source.type]?.unit ?? "élément"}`}…`;
    // Liste remplie selon la recherche (des centaines de photos ou de cartes) : sans accents ni majuscules.
    const fill = (text) => {
      const q = plat(text).trim();
      sel.replaceChildren();
      const shown = parPertinence(choices.map((c, i) => [c, i]).filter(([c]) => !q || plat(`${c.label} ${c.group ?? ""}`).includes(q)), q, ([c]) => c.label, ([c]) => c.group);
      const first = document.createElement("option");
      first.value = "";
      first.textContent = q ? `＋ ${shown.length} trouvé${shown.length > 1 ? "s" : ""} : choisir…` : label;
      sel.appendChild(first);
      const groups = new Map();
      shown.forEach(([c, i]) => {
        let parent = sel;
        if (c.group) {
          if (!groups.has(c.group)) { const g = document.createElement("optgroup"); g.label = c.group; groups.set(c.group, g); sel.appendChild(g); }
          parent = groups.get(c.group);
        }
        const o = document.createElement("option");
        o.value = `${i}`;
        o.textContent = c.label;
        parent.appendChild(o);
      });
    };
    fill(searchText);
    sel.onchange = () => {
      const c = choices[Number(sel.value)];
      if (c) { c.add(); renderLibrary(); }
    };
    if (choices.length > 8) {
      const search = document.createElement("input");
      search.type = "search";
      search.id = "lib-search";
      search.className = "lib-search";
      search.placeholder = "🔎 Chercher…";
      search.setAttribute("aria-label", "Chercher");
      search.value = searchText;
      search.oninput = () => { searchText = search.value; fill(searchText); };
      add(search);
    }
    add(sel);
  }
}

/** Recherche dans « Ajouter à la main », gardée tant que le même jeu est ouvert. */
let searchText = "";
const plat = (t) => `${t ?? ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Réglages du tirage, en puces : difficulté, catégories de la collection, cartes par équipe pour les mimes. */
function randomPanel(rnd) {
  const out = [];
  const chips = (label, items, isOn, toggle, cls) => {
    const p = document.createElement("p");
    p.className = "lib-section";
    p.textContent = label;
    const row = document.createElement("div");
    row.className = "lib-chips";
    items.forEach(([value, text]) => {
      const c = document.createElement("button");
      const on = isOn(value);
      c.className = `lib-chip ${cls}${on ? " on" : ""}`;
      c.dataset.value = `${value}`;
      c.setAttribute("aria-pressed", on ? "true" : "false");
      c.textContent = text;
      c.onclick = () => { toggle(value); drawPicked(); };
      row.appendChild(c);
    });
    out.push(p, row);
  };
  if (rnd.type === "mimes") {
    const teams = teamsNow() ?? 4;
    chips(`Cartes par équipe (${teams} équipe${teams > 1 ? "s" : ""}, plus une réserve)`, [[0, `${RANDOM_COUNT.mimes} cartes`], ...MIME_PER_TEAM.map((n) => [n, `${n}`])],
      (n) => (rnd.perTeam ?? 0) === n, (n) => { rnd.perTeam = n || null; rnd.count = n ? null : RANDOM_COUNT.mimes; }, "lib-per-team");
  }
  if (typeof rnd.photos === "boolean") {
    chips("Images", [[false, "😀 Émojis"], [true, "📷 Photos"]], (v) => rnd.photos === v, (v) => { rnd.photos = v; }, "lib-photos");
  }
  chips("Difficulté", Object.entries(LEVELS), (k) => rnd.level === k, (k) => { rnd.level = k; }, "lib-level");
  // Qui a disparu ? : « Images » (émojis ou photos) suffit, pas de catégories en plus.
  const groups = rnd.type === "disparu" ? [] : collectionGroups(collectionItems(rnd.type, library, { hasard: true }));
  if (groups.length > 1) {
    chips("Catégories (aucune touchée : toutes)", groups.map((g) => [g, g]), (g) => rnd.groups.includes(g),
      (g) => { rnd.groups = rnd.groups.includes(g) ? rnd.groups.filter((x) => x !== g) : [...rnd.groups, g]; }, "lib-group");
  }
  return out;
}

/** Ce qu'on peut ajouter à la main au jeu choisi : cartes de mimes ou mots du Pictionary absents, éléments d'un jeu intégré. */
function addChoices(questions) {
  const { source } = picked;
  const deck = questions[0]?.kind === "mime" || questions[0]?.kind === "pictionary" ? questions[0] : null;
  if (deck) {
    const present = new Set(deck.cards.map((c) => c.word.toLowerCase()));
    const pool = deck.kind === "pictionary"
      ? activeItems("pictionary", library.contents?.pictionary).map((w) => ({ card: { word: w.word, ...(w.image ? { image: w.image } : {}), ...(w.imageId ? { imageId: w.imageId } : {}) }, group: pictoSeriesOf(w) }))
      : source.deckId ? mimePool(source, library.mimes, profile ?? "MOYENS").map((card) => ({ card }))
      : MIME_CATALOG.map((c) => ({ card: mimeCards([c])[0], group: c.theme }));
    // Mimes en photos : la carte ajoutée a la photo de son mot, s'il est dans la banque.
    const photos = deck.kind === "mime" && source.photos === true;
    return pool.filter((x) => !present.has(x.card.word.toLowerCase()))
      .map((x) => ({ label: `${x.card.image ?? ""} ${x.card.word}`.trim(), group: x.group, add: () => { deck.cards.push(photos ? avecPhoto(x.card) : x.card); present.add(x.card.word.toLowerCase()); } }));
  }
  // Le même chemin que la prestation : l'élément choisi devient une question (grille tirée pour Qui a disparu ?).
  const ajoute = (round) => () => {
    const { questions: one } = gameQuestions(round, library.quizzes, profile ?? "MOYENS", `a${Date.now().toString(36)}`, library.mimes, library.playlists, library.contents);
    if (one[0]) questions.push({ ...one[0], id: `${one[0].id}x${questions.length + 1}` });
  };
  // Statues musicales : une chanson cherchée dans toutes les playlists, jouée en premier.
  if (source.type === "statues") {
    const q = questions[0];
    const present = new Set(q?.audioIds ?? []);
    return q ? statuesChoices(library.playlists).filter((t) => !present.has(t.audioId)).map((t) => ({
      label: `${t.title}${t.artist ? ` · ${t.artist}` : ""}`, group: t.list,
      add: () => { q.audioIds = [t.audioId, ...(q.audioIds ?? [])].slice(0, MAX_STATUES_SONGS); },
    })) : [];
  }
  // Blind test, quiz musical : un titre de plus, cherché dans toutes les playlists ; le jeu est refait avec lui
  // (les derniers morceaux gardent leur valeur double).
  if (MUSIC_GAMES[source.type]) {
    const tracks = questions.map((q) => q.audioId).filter(Boolean);
    const present = new Set(tracks);
    return collectionItems(source.type, library).filter((x) => !present.has(x.key)).map((x) => ({
      label: x.label, group: x.group,
      add: () => {
        const next = { ...source, playlistId: null, tracks: [...tracks, x.key] };
        const { questions: all } = gameQuestions(next, library.quizzes, profile ?? "MOYENS", `a${Date.now().toString(36)}`, library.mimes, library.playlists, library.contents);
        if (all.length) { questions.splice(0, questions.length, ...all); picked.source = next; }
      },
    }));
  }
  // Zoom mystère, Image floue : une photo de plus, prise dans les quiz ou dans la banque de photos.
  if (source.type === "zoom" || source.type === "flou") {
    const present = new Set(questions.map((q) => q.imageId ?? (q.banque ? `${BANQUE}${q.banque}` : null)).filter(Boolean));
    return collectionItems(source.type, library).filter((x) => !present.has(x.key))
      .map((x) => ({ label: x.label, group: x.group, add: ajoute({ type: source.type, picks: [x.key] }) }));
  }
  const game = CONTENT_GAMES[source.type];
  if (!BUILTIN_GAMES[source.type] || !game) return [];
  const present = new Set(questions.map((q) => (q.kind === "quisuis" || q.kind === "chante" ? q.choices?.[0] : null)).filter(Boolean).map((x) => x.toLowerCase()));
  // Qui a disparu ? : les familles en photos seulement en mode « 📷 Photos », qui donne aussi leur photo aux autres objets.
  const photos = source.type === "disparu" && source.photos === true;
  return activeItems(source.type, library.contents?.[source.type])
    .filter((x) => !present.has((x.answer ?? x.word ?? "").toLowerCase()) && (source.type !== "disparu" || photos || !isPhotoTheme(x)))
    .map((x) => ({
      label: game.label(x),
      group: source.type === "disparu" ? disparuGroup(x) : undefined,
      add: ajoute({ type: source.type, picks: [game.key(x)], ...(photos ? { photos: true } : {}) }),
    }));
}

/** Statues musicales : combien de chansons, et laquelle passe en premier (choisie avec « Choisir une chanson »). */
function statuesMeta(q) {
  const ids = q.audioIds ?? [];
  if (!ids.length) return "Musique de la fête (aucune chanson choisie)";
  const first = statuesChoices(library.playlists).find((t) => t.audioId === ids[0]);
  return `${ids.length} chanson${ids.length > 1 ? "s" : ""} à la suite${first ? ` · en premier : ${first.title}` : ""}`;
}

function renderPreview() {
  const { game, questions, problems } = picked;
  const st = live.state ?? { phase: "lobby" };
  $("lib-name").textContent = pickedName();
  renderPickedEdit(questions);
  const mime = questions[0]?.kind === "mime" || questions[0]?.kind === "pictionary" ? questions[0] : null;
  $("lib-meta").textContent = mime
    ? `${mime.kind === "pictionary" ? "Pictionary" : "Mimes"} · ${mime.cards.length} ${mime.kind === "pictionary" ? "mots · un mot par équipe" : "cartes"} · tour de ${mime.duration} s par équipe`
    : questions[0]?.kind === "statues" ? statuesMeta(questions[0])
    : [game.from, `${questions.length} question${questions.length > 1 ? "s" : ""}`].filter(Boolean).join(" · ");
  const list = $("lib-questions");
  list.innerHTML = "";
  if (mime) {
    // Toutes les cartes, chacune avec ✕ pour la retirer (il en reste toujours une).
    const li = document.createElement("li");
    li.className = "lib-cards";
    mime.cards.forEach((c, k) => {
      const chip = document.createElement("button");
      chip.className = "lib-chip lib-card";
      chip.dataset.word = c.word;
      chip.textContent = `${`${c.image ?? ""} ${c.word}`.trim()} ✕`;
      chip.setAttribute("aria-label", `Retirer ${c.word}`);
      chip.disabled = mime.cards.length < 2;
      chip.onclick = () => { mime.cards.splice(k, 1); renderLibrary(); };
      li.appendChild(chip);
    });
    list.appendChild(li);
  }
  const removable = questions.length > 1 && !questions.some((q) => q.kind === "patate" || q.kind === "gonfleur" || q.kind === "coffres" || q.kind === "statues");
  (mime ? [] : questions).forEach((q, k) => {
    const li = document.createElement("li");
    // ✕ : la question (le mot, le personnage…) n'est pas ajoutée ; le quiz de la bibliothèque ne change pas.
    if (removable) {
      const x = document.createElement("button");
      x.className = "lib-x";
      x.textContent = "✕";
      x.setAttribute("aria-label", "Retirer");
      x.onclick = () => { questions.splice(k, 1); renderLibrary(); };
      li.appendChild(x);
    }
    const answer = document.createElement("b");
    // Chante le mot : le mot seul ; Qui suis-je : le personnage et son premier indice.
    if (q.kind === "chante") { answer.textContent = q.text; li.append(answer); list.appendChild(li); return; }
    if (q.kind === "patate") { li.textContent = "La bombe passe de tablette en tablette ; une équipe qui la garde plus de 3 secondes la voit exploser. À l'explosion, l'équipe qui la tient perd des points."; list.appendChild(li); return; }
    if (q.kind === "gonfleur") { li.textContent = "Chaque équipe tapote sa tablette pour gonfler son ballon : le premier qui éclate gagne."; list.appendChild(li); return; }
    if (q.kind === "coffres") { li.textContent = "Un coffre chacun son tour, bonus ou malus, puis la bombe qui arrête le jeu."; list.appendChild(li); return; }
    // Blind test et quiz musical : le titre (et l'artiste) de chaque extrait.
    if (q.audioId) { answer.textContent = `♪ ${q.choices?.[q.correct] ?? ""}${q.artist ? ` · ${q.artist}` : ""}`; li.append(answer); list.appendChild(li); return; }
    answer.textContent = ` → ${q.kind === "number" ? q.correct : q.choices?.[q.correct] ?? ""}`;
    // Photos de la banque : leur vignette, pour voir tout de suite que ce sont des photos.
    const vignette = (cle) => {
      const img = document.createElement("img");
      img.className = "lib-thumb";
      img.src = cheminPhotoBanque(cle);
      img.alt = "";
      return img;
    };
    if (q.kind === "disparu") {
      answer.textContent = ` → ${q.image ?? ""} ${q.choices?.[q.correct] ?? ""}`;
      (q.cards ?? []).forEach((c, j) => li.append(j ? " " : "", c.banque ? vignette(c.banque) : c.image ?? c.word));
      li.append(answer);
      list.appendChild(li);
      return;
    }
    if (q.banque) li.append(vignette(q.banque), " ");
    li.append(q.kind === "quisuis" ? `${q.image ?? ""} ${q.cards?.[0]?.word ?? ""}…`.trim() : q.text, answer);
    list.appendChild(li);
  });
  $("lib-problems").hidden = !problems.length;
  $("lib-problems").textContent = problems.join(" ");
  const lobby = st.phase === "lobby";
  const rejeu = enRejeu();
  const after = $("lib-after");
  after.textContent = editing ? "Envoi à la TV…" : rejeu ? "Après le jeu en cours" : lobby ? "Ajouter au début" : "Ajouter après la manche actuelle";
  after.disabled = editing || !questions.length;
  // Rejeu : « ▶ Rejouer maintenant » en premier, « Après le jeu en cours » ensuite (rien à attendre une fois la fête finie).
  after.classList.toggle("main", !rejeu);
  after.classList.toggle("secondary", rejeu);
  after.hidden = rejeu && st.phase === "ended";
  const now = $("lib-now");
  now.hidden = !rejeu;
  now.textContent = editing ? "Envoi à la TV…" : "▶ Rejouer maintenant";
  now.disabled = editing || !questions.length;
  $("lib-end").hidden = rejeu;
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
const OLD_TV_STATUES = "La TV doit être mise à jour pour jouer aux statues musicales : sur la TV, menu Retour → « Rechercher une mise à jour ».";
const OLD_TV_DISPARU = "La TV doit être mise à jour pour jouer à « Qui a disparu ? » : sur la TV, menu Retour → « Rechercher une mise à jour ».";
const OLD_TV_PICTO = "La TV doit être mise à jour pour jouer au Pictionary : sur la TV, menu Retour → « Rechercher une mise à jour ».";
const OLD_TV_COFFRES = "La TV doit être mise à jour pour jouer aux Coffres mystères : sur la TV, menu Retour → « Rechercher une mise à jour ».";
const OLD_TV_GONFLEUR = "La TV doit être mise à jour pour jouer au Gonfleur fou : sur la TV, menu Retour → « Rechercher une mise à jour ».";
const OLD_TV_PATATE = "La TV doit être mise à jour pour jouer à « Ça va exploser ! » : sur la TV, menu Retour → « Rechercher une mise à jour ».";
const OLD_TV_PORTES = "La TV doit être mise à jour pour jouer aux Portes mystères : sur la TV, menu Retour → « Rechercher une mise à jour ».";
const OLD_TV_BLIND = "La TV doit être mise à jour pour jouer au blind test : sur la TV, menu Retour → « Rechercher une mise à jour ».";
/** Jeu que la TV allumée ne sait pas encore jouer (ancienne version) : le message à montrer, sinon null. */
function tvRefuses(questions) {
  if (!live.plan) return null;
  if (live.plan.mimes !== true && questions.some((q) => q?.kind === "mime")) return OLD_TV;
  if (live.plan.pictionary !== true && questions.some((q) => q?.kind === "pictionary")) return OLD_TV_PICTO;
  if (live.plan.numbers !== true && questions.some((q) => q?.kind === "number")) return OLD_TV_NUMBER;
  if (live.plan.express !== true && questions.some((q) => q?.kind === "express")) return OLD_TV_EXPRESS;
  if (live.plan.zoom !== true && questions.some((q) => q?.kind === "zoom")) return OLD_TV_ZOOM;
  if (live.plan.flou !== true && questions.some((q) => q?.kind === "flou")) return OLD_TV_FLOU;
  if (live.plan.chante !== true && questions.some((q) => q?.kind === "chante")) return OLD_TV_CHANTE;
  if (live.plan.quisuis !== true && questions.some((q) => q?.kind === "quisuis")) return OLD_TV_QUISUIS;
  if (live.plan.statues !== true && questions.some((q) => q?.kind === "statues")) return OLD_TV_STATUES;
  if (live.plan.disparu !== true && questions.some((q) => q?.kind === "disparu")) return OLD_TV_DISPARU;
  if (live.plan.portes !== true && questions.some((q) => q?.kind === "portes")) return OLD_TV_PORTES;
  if (live.plan.coffres !== true && questions.some((q) => q?.kind === "coffres")) return OLD_TV_COFFRES;
  if (live.plan.gonfleur !== true && questions.some((q) => q?.kind === "gonfleur")) return OLD_TV_GONFLEUR;
  if (live.plan.patate !== true && questions.some((q) => q?.kind === "patate")) return OLD_TV_PATATE;
  // Quiz musical compris : une ancienne TV le jouerait sans musique.
  if (live.plan.blindPlay !== true && questions.some((q) => q?.kind === "blind")) return OLD_TV_BLIND;
  if (live.plan.blind !== true && questions.some((q) => q?.audioId)) return OLD_TV_BLIND;
  return null;
}

let adding = false;
async function addPicked(where) {
  if (!picked || editing || adding) return;
  const rejeuEnCours = enRejeu();
  const refused = tvRefuses(picked.questions);
  if (refused) { toast(refused); return; }
  // Photos copiées avant l'envoi : la TV les cherche dès qu'elle accepte le programme. Les extraits,
  // plus lourds, suivent ; la TV les attend.
  adding = true;
  let chosen;
  try { chosen = await copyImages(picked.questions); } finally { adding = false; }
  copySounds(chosen);
  if (!picked || editing) return;
  const st = live.state ?? { phase: "lobby" };
  const current = live.plan?.questions ?? [];
  const title = uniqueRoundTitle(current, chosen[0]?.round ?? picked.game.label);
  const added = chosen.map((q) => ({ ...q, round: title }));
  const index = st.phase === "lobby" ? -1 : st.index ?? -1;
  const now = where === "now";
  const program = insertGame(current, added, now ? "after" : where, index);
  const place = where === "end" ? "à la fin du programme" : index < 0 ? "au début du programme" : now || rejeuEnCours ? "après le jeu en cours" : "après la manche en cours";
  const keep = picked.random ? liveManche(picked, title) : null;
  // « ▶ Rejouer maintenant » : le jeu en cours s'arrête là (ses points sont gardés) et la TV ouvre le jeu rejoué.
  const lancer = now ? async () => {
    const start = program.findIndex((q) => q.id === added[0]?.id);
    if (start < 0) return;
    const status = await send("goto", { index: start, qid: added[0].id }, { advance: true });
    if (status?.status === "applied") toast(`C'est reparti pour « ${title} » !`);
  } : null;
  sendProgram(program, now ? `« ${title} » arrive sur la TV…` : `« ${title} » est ajouté ${place}.`, true, () => { keep?.(); lancer?.(); });
}

/**
 * Manche tirée en direct, telle que la TV la joue (cartes retirées ou ajoutées comprises) : gardée dans la page du jeu
 * de la Régie PC (« Jouée en direct »), pour la retrouver ou l'épingler. La régie ne peut qu'en créer, jamais modifier.
 */
function liveManche({ random, source, questions }, title) {
  const type = random.type;
  const deck = questions.find((q) => q.kind === "mime" || q.kind === "pictionary");
  let round = { ...source };
  if (type === "mimes" && deck) round = { ...round, cards: deck.cards, duration: deck.duration };
  else if (type === "pictionary" && deck) round = { ...round, picks: deck.cards.map((c) => c.word.toLowerCase()), duration: deck.duration };
  else if (type === "zoom" || type === "flou") round = { ...round, picks: (round.picks ?? []).filter((k) => questions.some((q) => q.imageId === k || (q.banque && `${BANQUE}${q.banque}` === k))) };
  else if (type === "blind" || type === "musical") round = { ...round, tracks: (round.tracks ?? []).filter((k) => questions.some((q) => q.audioId === k)) };
  else if (type === "chante" || type === "quisuis") round = { ...round, picks: questions.map((q) => q.choices?.[0]?.toLowerCase()).filter(Boolean), count: questions.length };
  return () => {
    const showId = typeof live.plan?.id === "string" && live.plan.id.length <= 40 ? { showId: live.plan.id } : {};
    const name = `${title} (en direct, ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "short" })})`.slice(0, 120);
    set(push(ref(db, "library/manches")), {
      type, title: name || defaultMancheTitle(type), round: cleanRound({ ...round, type, perTeam: null }, library?.playlists ?? {}),
      origin: "direct", createdAt: Date.now(), updatedAt: serverTimestamp(), ...showId,
    }).catch((e) => console.warn("manche en direct non gardée", e));
  };
}

/**
 * Envoie le programme modifié à la TV, préparé sur la version affichée (base) : la box refuse s'il a changé
 * entre-temps ou si la manche en cours est touchée, et répond dans showStatus/. Rien n'est écrit dans la
 * bibliothèque : ses quiz restent tels quels.
 */
async function sendProgram(questions, success, fromLibrary = false, onApplied = null) {
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
    if (applied) onApplied?.();
    if (applied || fromLibrary) closeLibrary();
    toast(message);
    render();
  };
  let stop = () => {};
  const timeout = setTimeout(() => { stop(); done("La TV ne répond pas. Vérifiez qu'elle est allumée et connectée à Internet.", false); tvSilencieuse(); }, 8000);
  stop = onValue(ref(db, `games/${code}/showStatus`), (s) => {
    const status = s.val();
    if (status?.id !== id) return;
    tvRepond();
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
$("lib-now").onclick = () => addPicked("now");
$("lib-end").onclick = () => addPicked("end");

// ---------- Prestations (salon d'attente) ----------

const SHOW_MESSAGES = {
  not_now: "La partie a déjà commencé : la prestation ne peut plus changer.",
  points: "Des points ont déjà été donnés : la prestation ne peut plus changer. Pour repartir de zéro, choisissez « Nouvelle partie » sur la TV.",
  invalid: "La TV n'a pas pu lire cette prestation. Vérifiez-la dans l'administration.",
};

/** Deux régies ont lancé le même anniversaire au même instant : le serveur n'a gardé que l'autre. */
const SHOW_TAKEN = "Cet anniversaire vient d'être lancé sur une autre box.";

/** États d'une prestation lancée ailleurs : la toucher ne lance jamais une seconde fête en parallèle. */
const AILLEURS = ["salon", "encours", "interrompue"];

/**
 * « Mauvaise prestation ? » (cedric, 21/10) : partie commencée mais aucun point donné, et TV qui sait remplacer
 * la prestation (sinon elle la refuserait). Dès le premier point, la proposition disparaît.
 */
const mayReplaceShow = (st) => st.phase !== "lobby" && st.phase !== "ended" && st.scored !== true && live.plan?.programReset === true;

/**
 * Lit les prestations publiées et la bibliothèque, et prépare le programme de chacune (réservé au mot de
 * passe de régie). Toujours relu depuis la base : une prestation modifiée dans l'administration après
 * l'ouverture de la régie n'est jamais lancée dans son ancienne version. Chacune dit où elle en est (lancements,
 * launches/) ; une prestation archivée ou passée reste dans la liste tant que sa fête n'est pas terminée.
 */
async function readShows() {
  const [s, q, m, p, c] = await Promise.all(["shows", "quizzes", "mimes", "playlists", "contents"].map((k) => get(ref(db, `library/${k}`))));
  const quizzes = q.val() ?? {};
  const mimes = m.val() ?? {};
  const playlists = p.val() ?? {};
  const contents = c.val() ?? {};
  const lire = (path) => get(ref(db, path)).then((x) => x.val(), () => null);
  const launches = await lire("launches") ?? {};
  const runs = await launchStates(launches, lire, { here: code, now: Date.now() + serverOffset });
  const today = new Date().toISOString().slice(0, 10);
  const list = Object.entries(s.val() ?? {})
    .filter(([id, show]) => (show.status === "publiee" && !isArchived(show)) || runs[id]?.etat === "ici" || AILLEURS.includes(runs[id]?.etat))
    .map(([id, show]) => ({ id, show, run: runs[id] ?? { etat: "preparee" }, ...buildSnapshot(id, show, quizzes, mimes, Math.random, playlists, contents) }))
    // Les prestations à venir d'abord, la plus proche en tête ; les passées ensuite.
    .sort((a, b) => {
      const da = a.show.date ?? "9999", dbb = b.show.date ?? "9999";
      const pa = da < today, pb = dbb < today;
      return pa !== pb ? (pa ? 1 : -1) : pa ? dbb.localeCompare(da) : da.localeCompare(dbb);
    });
  return { list, launches };
}

async function fetchShows() {
  shows = { loading: true };
  render();
  try {
    shows = { list: (await readShows()).list };
  } catch (e) {
    console.error(e);
    shows = { denied: /permission/i.test(String(e?.message ?? e)) };
  }
  render();
}

function renderShows(st) {
  const lobby = st.phase === "lobby";
  // Mauvaise prestation : la liste reste ouverte en pleine partie, tant que la TV peut encore la remplacer.
  if (wrongShow && (lobby || !mayReplaceShow(st))) wrongShow = false;
  const open = lobby || wrongShow;
  $("tab-show").hidden = !open;
  if (!open && tab === "show") switchTab("teams");
  if (!open || tab !== "show") return;
  if (shows === null) { fetchShows(); return; }
  const box = $("panel-show");
  const key = JSON.stringify([shows.loading, shows.denied, shows.list?.map((s) => [s.id, s.run]), loadingShow, live.plan?.title, wrongShow]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = "";
  const hint = (text) => { const p = document.createElement("p"); p.className = "hint"; p.textContent = text; box.appendChild(p); };
  if (shows.loading) return hint("Chargement des prestations…");
  if (shows.denied) return hint("Pour charger une prestation, entrez dans la régie avec le mot de passe (pas avec le code de la TV).");
  if (shows.error || !shows.list) return hint("Impossible de lire les prestations. Vérifiez la connexion.");
  if (wrongShow) {
    hint("Mauvaise prestation ? Touchez la bonne : la partie repart du salon d'attente, avec les mêmes équipes.");
    const keep = document.createElement("button");
    keep.className = "link";
    keep.id = "show-keep";
    keep.textContent = "Garder la prestation en cours";
    keep.onclick = () => { wrongShow = false; switchTab("teams"); };
    box.appendChild(keep);
  }
  if (!shows.list.length) hint("Aucune prestation à venir. Sarah les prépare dans l'administration (statut « À venir »).");
  shows.list.forEach(({ id, show, snapshot, problems, run }) => {
    const item = document.createElement("button");
    item.className = "show-item";
    item.dataset.show = id;
    const title = document.createElement("b");
    title.textContent = showTitle(show);
    const meta = document.createElement("span");
    const date = show.date ? new Date(`${show.date}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "";
    meta.textContent = [show.childName, show.age ? `${show.age} ans` : "", date].filter(Boolean).join(" · ");
    const detail = document.createElement("span");
    const asked = snapshot?.quiz.questions.filter((x) => x.kind !== "mime" && x.kind !== "pictionary").length ?? 0;
    detail.textContent = snapshot
      ? `${snapshot.rounds.length} jeu${snapshot.rounds.length > 1 ? "x" : ""}${asked ? ` · ${asked} questions` : ""}`
      : problems[problems.length - 1];
    // Où en est la prestation : préparée, sur cette TV, sur une autre box, interrompue, terminée.
    const where = document.createElement("span");
    where.className = "show-run";
    where.textContent = launchLabel(run);
    item.classList.toggle("ici", run.etat === "ici");
    item.classList.toggle("ailleurs", AILLEURS.includes(run.etat));
    item.dataset.run = run.etat;
    item.append(title, meta, where, detail);
    // Un jeu qui ne peut pas être préparé ne disparaît jamais en silence : la régie le dit avant le lancement.
    if (snapshot && problems.length) {
      const warn = document.createElement("span");
      warn.className = "show-warn";
      warn.textContent = `⚠ ${problems.join(" ")}`;
      item.append(warn);
    }
    if (loadingShow === id) detail.textContent = "Chargement sur la TV…";
    item.disabled = !snapshot || !!loadingShow;
    item.onclick = () => loadShow(id);
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
async function copyImages(list) {
  // Photos de la banque des petits (Zoom, Image floue, Mimes et Qui a disparu ? en photos) : lues sur le site et
  // copiées dans la partie d'abord ; chaque question y gagne son identifiant de photo, comme une photo de la bibliothèque.
  const questions = await resolveBanque(list, {
    photo: lirePhotoBanque,
    secours: emojiEnImage,
    ecrire: async (dir, id, data) => {
      const target = ref(db, `games/${code}/${dir}/${id}`);
      if (!(await get(target)).exists()) await set(target, data);
    },
  });
  // Réponses en images : rangées à part, lisibles par les pupitres (les photos d'illustration, elles, ne le sont pas).
  const all = [...imageIds(questions).map((id) => ["images", id]), ...choiceImageIds(questions).map((id) => ["choiceImages", id])];
  await Promise.all(all.map(async ([dir, id]) => {
    try {
      const target = ref(db, `games/${code}/${dir}/${id}`);
      if ((await get(target)).exists()) return;
      const data = (await get(ref(db, `library/images/${id}`))).val();
      if (typeof data === "string") await set(target, data);
    } catch (e) {
      console.warn("Illustration non copiée", id, e);
    }
  }));
  return questions;
}

/**
 * Extraits musicaux : copiés de la bibliothèque dans la partie ; la TV les range dans son cache et les joue
 * sans Internet. Un par un (quelques centaines de Ko chacun) pour ménager un téléphone en 4G.
 */
async function copySounds(questions) {
  for (const id of soundIds(questions)) {
    try {
      const target = ref(db, `games/${code}/sounds/${id}`);
      if ((await get(target)).exists()) continue;
      const data = (await get(ref(db, `library/sounds/${id}`))).val();
      if (typeof data === "string") await set(target, data);
    } catch (e) {
      console.warn("Extrait non copié", id, e);
    }
  }
}

/** « l'anniversaire de Chloé », ou le titre de la prestation entre guillemets (dans une phrase). */
function nomDansPhrase(show) {
  const nom = nomFete(show);
  return nom.startsWith("L'") ? `l'${nom.slice(2)}` : nom;
}

/**
 * Fenêtre de lancement (cedric, 21/10), sur le téléphone seulement : « Lancer l'anniversaire de Chloé ? », âge et date,
 * date qui n'est pas aujourd'hui signalée sans crier, jeux impossibles à préparer. « Annuler » par défaut. Une
 * prestation déjà sur la TV est remplacée (« Les équipes restent. ») ; une fête terminée se relance depuis le début.
 */
async function confirmationLancement({ show, snapshot, problems, run }) {
  const date = show.date ? new Date(`${show.date}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "";
  const line = [show.age ? `${show.age} ans` : "", date].filter(Boolean).join(" – ");
  const warn = show.date && show.date !== isoDay() ? "⚠ Ce n'est pas la date d'aujourd'hui." : "";
  const soucis = problems.length
    ? `⚠ ${problems.join("\n")}\n\nProgramme qui sera joué : ${snapshot.rounds.map((r) => r.title).join(" → ")}.` : "";
  const st = live.state ?? {};
  if (run?.etat === "terminee") {
    return { title: `Cette fête est terminée${run.at ? ` le ${jourHeure(run.at)}` : ""}.`, text: ["La relancer depuis le début sur cette TV ?", soucis].filter(Boolean).join("\n\n"), line, warn, ok: "Relancer", safe: true };
  }
  // Prestation déjà chargée sur cette TV (salon d'attente), ou mauvaise prestation en pleine partie : elle est remplacée.
  const avant = live.plan?.rev && live.plan.rev !== "initial" && !isDemo()
    ? await get(ref(db, `games/${code}/public`)).then((x) => x.val(), () => null) : null;
  if (avant?.title && run?.etat !== "ici") {
    const ancien = avant.childName ? `l'anniversaire de ${avant.childName}` : `« ${avant.title} »`;
    const nouveau = show.childName?.trim() ? `celui de ${show.childName.trim()}` : `« ${showTitle(show)} »`;
    const suite = st.phase === "lobby" ? "Les équipes restent." : "Les équipes restent, on repart au début.";
    return { title: `Remplacer ${ancien} par ${nouveau} ?`, text: [suite, soucis].filter(Boolean).join("\n\n"), line, warn, ok: "Remplacer", safe: true };
  }
  return { title: `Lancer ${nomDansPhrase(show)} ?`, text: soucis, line, warn, ok: problems.length ? "Lancer quand même" : "Lancer", safe: true };
}

async function loadShow(id) {
  if (loadingShow) return;
  loadingShow = id;
  render();
  // La prestation est relue à l'instant du lancement : jamais la version gardée depuis l'ouverture de la page.
  let fresh, launches;
  try {
    const read = await readShows();
    launches = read.launches;
    fresh = read.list.find((x) => x.id === id);
  } catch (e) {
    console.error(e);
    loadingShow = null;
    toast("Impossible de relire la prestation. Vérifiez la connexion puis réessayez.");
    return render();
  }
  shows = { list: shows?.list?.map((x) => (x.id === id && fresh ? fresh : x)) ?? [] };
  const { snapshot, problems } = fresh ?? {};
  if (!snapshot) {
    loadingShow = null;
    toast(fresh ? problems[problems.length - 1] : "Cette prestation n'est plus prête : vérifiez-la dans l'administration.");
    return render();
  }
  const refused = tvRefuses(snapshot.quiz?.questions ?? []);
  if (refused) { loadingShow = null; toast(refused); return render(); }
  // Déjà sur une autre box (lancée entre-temps, ou liste pas encore à jour) : jamais une seconde fête en parallèle.
  if (AILLEURS.includes(fresh.run.etat)) {
    loadingShow = null;
    render();
    return continuerIci(fresh);
  }
  if (!await demander(await confirmationLancement(fresh))) {
    loadingShow = null;
    return render();
  }
  if (snapshot.quiz) snapshot.quiz = { ...snapshot.quiz, questions: await copyImages(snapshot.quiz.questions) };
  const showId = push(ref(db, `games/${code}/show`)).key;
  // Prestations encore rattachées à cette partie (celle qu'on remplace) : libérées dans la même écriture.
  const anciennes = Object.entries(launches ?? {}).filter(([pid, l]) => l?.code === code && pid !== id).map(([pid]) => pid);
  const done = (message) => { loadingShow = null; if (message) toast(message); render(); };
  /** Refus de la TV : la prestation refusée est libérée, celle que la TV joue encore reprend sa place. */
  const annuler = async () => {
    const joue = await get(ref(db, `games/${code}/public/prestation`)).then((x) => x.val(), () => null);
    if (joue === id) return;
    const retour = { [`launches/${id}`]: null };
    if (joue && anciennes.includes(joue)) retour[`launches/${joue}`] = { code, by: uid, at: serverTimestamp() };
    await update(ref(db), retour).catch((e) => console.warn("Lancement non annulé", e));
  };
  let stop = () => {};
  const timeout = setTimeout(() => { stop(); done("La TV ne répond pas. Vérifiez qu'elle est allumée et connectée à Internet."); tvSilencieuse(); }, 8000);
  stop = onValue(ref(db, `games/${code}/showStatus`), (s) => {
    const status = s.val();
    if (status?.id !== showId) return;
    tvRepond();
    clearTimeout(timeout);
    stop();
    if (status.status === "applied") {
      wrongShow = false;
      // La liste le montre aussitôt : celle-ci sur cette TV, celle qu'elle remplace de nouveau libre.
      if (shows?.list) {
        shows = { list: shows.list.map((x) => (x.id === id ? { ...x, run: { etat: "ici", code } }
          : x.run?.etat === "ici" ? { ...x, run: { etat: "preparee" } } : x)) };
      }
      return done(`« ${snapshot.title} » est chargée sur la TV : ${snapshot.rounds.length} jeu${snapshot.rounds.length > 1 ? "x" : ""}.`);
    }
    annuler();
    done(SHOW_MESSAGES[status.reason] ?? "La TV a refusé cette prestation.");
  });
  copySounds(snapshot.quiz?.questions);
  try {
    // Le programme pour la TV et le lancement de la prestation en une seule écriture : si une autre box vient de la
    // lancer, le serveur refuse tout, rien n'arrive sur cette TV.
    await update(ref(db), {
      [`games/${code}/show`]: { ...snapshot, id: showId, prestation: id, by: uid, at: serverTimestamp() },
      [`launches/${id}`]: { code, by: uid, at: serverTimestamp() },
      ...Object.fromEntries(anciennes.map((pid) => [`launches/${pid}`, null])),
    });
  } catch (e) {
    console.error(e);
    clearTimeout(timeout);
    stop();
    const ailleurs = await get(ref(db, `launches/${id}/code`)).then((x) => x.val(), () => null);
    if (ailleurs && ailleurs !== code) {
      done(SHOW_TAKEN);
      return fetchShows();
    }
    done("Chargement refusé : la partie a peut-être déjà commencé.");
  }
}

function runTimer(st) {
  clearInterval(timerHandle);
  const el = $("c-timer");
  const tick = () => {
    let ms;
    if (st.phase !== "question") ms = null;
    // En pause, ou chrono figé pendant la réponse d'une équipe qui a buzzé : le temps restant publié par la box.
    else if (st.paused || (st.buzz?.team && st.deadline == null)) ms = st.remainingMs ?? 0;
    // Sans chrono en cours (blind test qui attend la relance, mimes entre deux tours) : rien, plutôt qu'un 0 inquiétant.
    else if (st.deadline == null) ms = st.remainingMs ?? null;
    else ms = Math.max(0, st.deadline - Math.max(Date.now() + serverOffset, st.resumeAt ?? 0));
    // Secondes restantes au chrono de la question (ou de l'extrait au blind test).
    el.textContent = ms == null ? "" : `⏱ ${Math.ceil(ms / 1000)} s`;
    el.title = "Temps restant au chrono";
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
  countdown: "La partie reprend (3, 2, 1) : attendez la fin du décompte.",
  bad_factor: "Valeur de points inconnue.",
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
      tvSilencieuse();
    }, BOX_TIMEOUT_MS);
    stop = onValue(ref(db, `games/${code}/commandStatus/${cmdRef.key}`), (s) => {
      const status = s.val();
      if (!status) return;
      tvRepond();
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

/**
 * Bonus ou malus en deux temps. Préparer le montant (montants types, ±1, ±10, saisie, curseur) ne change rien :
 * ni score ni animation. « Valider » envoie une seule correction, du montant exact ; la TV l'annonce une fois.
 * Le bouton se bloque dès le premier appui et la fenêtre se ferme : un double appui ne compte jamais deux fois.
 */
const MAX_POINTS = 500;
let points = null;

/**
 * [pick] : ouvert depuis « ± Points » des mimes, du Pictionary ou du blind test (onglet Équipes masqué) :
 * l'animatrice choisit l'équipe dans la fenêtre même, le montant préparé est gardé.
 */
function choosePoints(team, pick = false) {
  points = { team, sign: 1, amount: 0, sending: false, pick };
  $("pts-input").value = "";
  $("pts").hidden = false;
  renderPoints();
}

/** Équipe à proposer d'abord : celle qui mime, dessine ou a buzzé, sinon la première inscrite. */
function defaultTeam() {
  const st = live.state ?? {};
  const ids = Object.entries(live.teams).sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0)).map(([id]) => id);
  return [st.mime?.team, st.mime?.last?.team, st.buzz?.team].find((id) => id && live.teams[id]) ?? ids[0];
}

function setAmount(n) {
  if (!points || points.sending) return;
  points.amount = Math.max(0, Math.min(MAX_POINTS, Math.round(Number(n) || 0)));
  renderPoints();
}

function renderPoints() {
  if (!points) return;
  const { team, sign, amount, sending, pick } = points;
  const delta = sign * amount;
  $("pts-title").textContent = pick ? "Bonus ou malus" : `Points pour ${live.teams[team]?.name ?? "l'équipe"}`;
  const chips = $("pts-teams");
  chips.replaceChildren(...(pick ? Object.entries(live.teams).sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0)) : []).map(([id, t]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.team = id;
    b.textContent = t.name ?? "Équipe";
    b.classList.toggle("on", id === team);
    b.disabled = sending;
    b.onclick = () => { if (points && !points.sending) { points.team = id; renderPoints(); } };
    return b;
  }));
  const score = live.state?.scores?.[team] ?? 0;
  $("pts-bonus").classList.toggle("on", sign > 0);
  $("pts-malus").classList.toggle("on", sign < 0);
  $("pts-value").textContent = `${sign > 0 ? "+" : "−"}${amount}`;
  $("pts-value").className = `pts-value ${amount ? (sign > 0 ? "bonus" : "malus") : ""}`;
  $("pts-preview").textContent = amount ? `Score : ${score} → ${score + delta}` : `Score : ${score} · choisissez un montant`;
  if (document.activeElement !== $("pts-input")) $("pts-input").value = amount ? String(amount) : "";
  $("pts-range").value = String(amount);
  $("pts-presets").querySelectorAll("[data-set]").forEach((b) => { b.classList.toggle("on", Number(b.dataset.set) === amount); });
  const ok = $("pts-ok");
  ok.disabled = !amount || sending || !live.teams[team];
  ok.textContent = sending ? "Envoi…" : amount ? `Valider ${sign > 0 ? "+" : "−"}${amount} point${amount > 1 ? "s" : ""}` : "Valider";
  ok.classList.toggle("malus", sign < 0);
}

function closePoints() {
  points = null;
  $("pts").hidden = true;
}

async function validatePoints() {
  if (!points || points.sending || !points.amount || !live.teams[points.team]) return;
  points.sending = true;
  const { team, sign, amount } = points;
  renderPoints();
  closePoints();
  await adjust(team, sign * amount);
}

$("pts-bonus").onclick = () => { if (points && !points.sending) { points.sign = 1; renderPoints(); } };
$("pts-malus").onclick = () => { if (points && !points.sending) { points.sign = -1; renderPoints(); } };
$("pts-presets").querySelectorAll("[data-set]").forEach((b) => { b.onclick = () => setAmount(Number(b.dataset.set)); });
document.querySelectorAll("#pts [data-step]").forEach((b) => { b.onclick = () => setAmount((points?.amount ?? 0) + Number(b.dataset.step)); });
$("pts-input").oninput = () => setAmount($("pts-input").value);
$("pts-input").onblur = () => renderPoints();
$("pts-range").oninput = () => setAmount($("pts-range").value);
$("pts-ok").onclick = validatePoints;
$("c-points").onclick = () => { if (Object.keys(live.teams).length) choosePoints(defaultTeam(), true); else toast("Aucune équipe inscrite."); };
$("pts-cancel").onclick = closePoints;
$("pts").onclick = (e) => { if (e.target === $("pts")) closePoints(); };

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

$("c-factor").querySelectorAll("[data-factor]").forEach((b) => {
  b.onclick = () => send("factor", { factor: Number(b.dataset.factor) });
});

$("c-next").onclick = async () => {
  const st = live.state;
  // Partie terminée mais un jeu ajouté ensuite : la partie reprend avec lui, scores gardés.
  if (st?.phase === "ended") {
    const { next } = gamesOf(st);
    if (next) jumpTo(next, st);
    return;
  }
  // Lancer la fête sans prestation chargée : la TV jouerait son quiz de démonstration, on le confirme d'abord.
  if (st?.phase === "lobby" && isDemo() && !await demander({
    title: "Aucune prestation chargée",
    text: "La TV va jouer son quiz de démonstration. Pour jouer une prestation, choisissez-la d'abord dans l'onglet « Prestation ».",
    ok: "Lancer la démonstration",
  })) {
    switchTab("show");
    return;
  }
  // Mimes entre deux tours : « Terminer les mimes » passe au classement, après confirmation s'il reste des équipes.
  const left = st?.phase === "question" && st.mime && !st.mime.team ? mimeRemaining(st) : [];
  if (left.length) {
    const names = left.map((id) => live.teams[id]?.name ?? "Équipe").join(", ");
    const game = st.kind === "pictionary" ? "le Pictionary" : "les mimes";
    if (!await demander({ title: `Terminer ${game} ?`, text: `${names} ${left.length > 1 ? "ne sont" : "n'est"} pas encore ${left.length > 1 ? "passées" : "passée"}.`, ok: `Terminer ${game}` })) return;
  }
  // Blind test : « next » lance, relance ou arrête la musique (la box décide selon l'état du morceau).
  send(st?.phase === "question" && !(st.mime && !st.mime.team) && !blindMode(st) ? "close" : "next", {}, { advance: true });
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

$("tab-teams").onclick = () => { tabChosen = true; switchTab("teams"); };
$("tab-plan").onclick = () => { tabChosen = true; switchTab("plan"); };
$("tab-show").onclick = () => { tabChosen = true; switchTab("show"); };
$("tab-defis").onclick = () => { tabChosen = true; switchTab("defis"); };
function switchTab(name) {
  tab = name;
  // Liste des prestations relue à chaque ouverture de l'onglet : elle reflète toujours l'administration.
  if (name === "show" && !loadingShow) shows = null;
  for (const t of ["teams", "plan", "show", "defis"]) {
    $(`tab-${t}`).classList.toggle("active", tab === t);
    $(`panel-${t}`).hidden = tab !== t;
  }
  // Défis de la pause : relus et affichés à chaque ouverture de l'onglet.
  if (name === "defis") ouvrirDefis(db, $("panel-defis"), toast, demander);
  render();
}

// Après le verrouillage du téléphone, Firebase se reconnecte seul et les écouteurs relisent l'état.
