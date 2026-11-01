import {
  ref, get, set, update, push, onValue, onDisconnect, serverTimestamp, query, limitToFirst,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { BRACELET_COLORS, CHOICE_LETTERS, MAX_TEAMS, TEAM_COLORS, TEAM_COLOR_NAMES, numeroTablette } from "./theme.js";
import { writeProof } from "./proof.js";
import { parPertinence } from "./recherche.js";
import { passwordCandidates } from "./secret.js";
import {
  buildSnapshot, showTitle, playable, QUIZ_GAMES, BUILTIN_GAMES, MAX_QUESTIONS, ROUND_TYPES, programRounds, lockedUntil, gameQuestions, insertGame, imageIds, choiceImageIds,
  soundIds, MUSIC_GAMES, playableTracks, STATUES_SEC, PICTO_SEC, isStatuesList, statuesSongs, MAX_STATUES_SONGS,
  uniqueRoundTitle, roundQuizIds, roundTirees, roundSeriesQuiz, mimePool, mimeCards, CONTENT_GAMES, activeItems, pictoSeriesOf,
  isArchived, isPhotoTheme, disparuGroup, statuesChoices, quizQuestions, jeuDeLaManche, quizKind,
  launchStates, launchLabel, jourHeure, isoDay, couleurMimeEquipe, chansonJouable, couleursEquipes, MIME_RESERVE,
} from "./show.js";
import { MIME_CATALOG } from "./mime-cards.js";
import {
  RANDOM_TYPES, RANDOM_COUNT, LEVELS, MIME_PER_TEAM, MIME_PER_TEAM_DEFAULT, randomRound, playedKeys, questionType, avoidKey,
  sourceRejouee,
  collectionItems, collectionGroups, mancheGroups, mancheSummary, cleanRound, defaultMancheTitle, COLLECTION_UNIT,
} from "./manches.js";
import { profileForAge } from "./profiles.js";
import { setAwake } from "./awake.js";
import { ouvrirDefis, nettoyerDefis, valeurDefisFete } from "./defis.js";
import { BANQUE, PHOTOS_BANQUE, avecPhoto, resolveBanque, lirePhotoBanque, emojiEnImage, cheminPhotoBanque } from "./banque-photos.js";

// Régie de l'animatrice, ouverte depuis la page des pupitres (bouton « Accès régie »).
// Elle n'écrit que des commandes : la box les vérifie, les applique et répond dans commandStatus/ ;
// l'écran se met à jour en relisant l'état de la partie.

const $ = (id) => document.getElementById(id);
/** Délai au-delà duquel une commande sans réponse signale une box injoignable. */
const BOX_TIMEOUT_MS = 6000;

let db, uid, code, onExit;
let serverOffset = 0;
/** Box d'avant (pas d'outroAt après « ▶ Lancer la fin ») : le bouton s'efface, « Fin de la fête » prend sa place. */
let finSansOutro = false;
/** Réaffichage à la fin du décompte de reprise (le bouton principal redevient actif). */
let countdownTimer = null;
let unsubscribers = [];
let live = { state: null, teams: {}, presence: {}, plan: null, answers: {}, requests: {}, connected: true };
// Coupure du téléphone (cedric, 31/10 : 43 s sans régie, « je n'ai pas quitté l'appli ») : la page dit à la box quand elle
// passe en arrière-plan (appli quittée, écran éteint, autre appli). Une coupure qui suit une page cachée n'est pas le
// réseau ; une coupure page affichée, si. La box l'écrit dans ses rapports.
let presenceRegie = null;
document.addEventListener("visibilitychange", () => {
  if (presenceRegie && live.connected) update(presenceRegie, { cachee: document.visibilityState === "hidden" }).catch(() => {});
});
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

// ---------- Régie « cockpit » (proposition du 25/10) ----------

/**
 * Proposition de régie téléphone plus ergonomique (cedric, 24/10 : « une régie portable un peu plus ergonomique ») :
 * barre du haut fixe (jeu, tablettes coupées en petite pastille, chrono), la scène au milieu, en bas Pause · ☰ Plus ·
 * bouton principal ; tout le reste (secours, Tablette, Terminer, notes, onglets) passe dans « ☰ Plus ». Au buzz, le
 * verdict prend tout l'écran sous la barre du haut, cadré dans la couleur de l'équipe, puis un bandeau de 2 s
 * confirme le verdict. Régie par défaut depuis le choix de cedric (B, 25/10) ; ?cockpit=0 revient à l'ancienne
 * disposition (gardé sur le téléphone), ?cockpit=1 retourne au cockpit.
 */
const COCKPIT = (() => {
  const choix = new URLSearchParams(location.search).get("cockpit");
  try {
    if (choix === "0") localStorage.setItem("lmp-regie-cockpit", "0");
    if (choix === "1") localStorage.removeItem("lmp-regie-cockpit");
    return localStorage.getItem("lmp-regie-cockpit") !== "0";
  } catch {
    return choix !== "0";
  }
})();

/** Range une fois pour toutes les commandes secondaires dans « ☰ Plus ». Leurs actions restent celles d'origine. */
function installerCockpit() {
  const regie = $("regie");
  if (!COCKPIT || regie.classList.contains("cockpit")) return;
  regie.classList.add("cockpit");
  // « ☰ Plus » n'existe qu'en régie « cockpit » : la régie actuelle garde exactement ses boutons.
  const plus = document.createElement("button");
  plus.id = "c-plus";
  plus.className = "btn secondary plus-ouvrir";
  plus.type = "button";
  plus.textContent = "☰ Plus";
  $("c-pause").after(plus);
  const grille = $("plus-grille");
  // « ⏭ Terminer » rangé ici aussi (cedric, 30/10 : trop dangereux sur l'écran principal en pleine partie), juste
  // avant « ⛔ Terminer la partie ».
  // « 📋 Conducteur » (cedric, 30/10) : à la place de « Changer de jeu », il ouvre le conducteur en plein écran.
  const conducteur = document.createElement("button");
  conducteur.id = "c-conducteur";
  conducteur.className = "btn secondary";
  conducteur.type = "button";
  conducteur.innerHTML = '<span class="icone" aria-hidden="true">📋</span>Conducteur';
  conducteur.onclick = ouvrirConducteur;
  $("c-recommencer").after(conducteur);
  for (const id of ["c-add", "c-recommencer", "c-conducteur", "c-points", "c-equipe", "c-tablette", "c-box", "c-end", "c-arret"]) grille.append($(id));
  $("conducteur-corps").append($("panel-plan"));
  $("panel-plan").hidden = false;
  $("tab-plan").hidden = true;
  $("c-end").querySelector(".label").textContent = "⏭ Terminer";
  $("plus-onglets").append($("c-notes"), document.querySelector(".regie .tabs"),
    $("panel-teams"), $("panel-show"), $("panel-defis"));
  // Une commande de « ☰ Plus » qui ouvre sa propre fenêtre referme d'abord la feuille (« Terminer la partie » : appui long, elle reste).
  grille.addEventListener("click", (e) => {
    const bouton = e.target.closest("button");
    if (bouton && bouton.id !== "c-arret") fermerPlus();
  }, true);
  // Le milieu de l'écran (cedric, 25/10) : une tuile par équipe, sous la carte de la question.
  const tuiles = document.createElement("section");
  tuiles.id = "c-tuiles";
  tuiles.className = "tuiles";
  tuiles.setAttribute("aria-label", "Équipes");
  tuiles.hidden = true;
  // Sous les demandes d'entrée : la carte « Nouvelle équipe en attente » reste juste sous la question, bien en vue.
  $("c-requests").after(tuiles);
  $("c-plus").onclick = () => ($("plus").hidden ? ouvrirPlus() : fermerPlus());
  $("plus-fermer").onclick = fermerPlus;
  $("plus-fond").onclick = fermerPlus;
  // Le bas de la régie reste utilisable sous la feuille : Pause, le bouton principal ou « Fin de la fête » la referment.
  for (const id of ["c-pause", "c-next", "c-fin"]) $(id).addEventListener("click", fermerPlus);
}

/**
 * « ☰ Plus » s'arrête au-dessus du bas de la régie : Pause, « ☰ Plus » et le bouton principal (« Lancer la fête ! »)
 * restent visibles et utilisables (test du 25/10 : feuille ouverte, Sarah ne trouvait plus comment lancer la fête).
 */
function caleSurLeBas() {
  if ($("plus").hidden) return;
  const haut = document.querySelector(".regie .actions")?.getBoundingClientRect().top;
  const bas = haut > 0 ? Math.max(0, window.innerHeight - haut) : 0;
  document.documentElement.style.setProperty("--bas-regie", `${Math.round(bas)}px`);
}

// Le bas de la régie grandit parfois feuille ouverte (une ligne d'aide, une tablette coupée) : la feuille suit.
let suiviDuBas = null;

function ouvrirPlus() {
  $("plus").hidden = false;
  $("plus-fond").hidden = false;
  caleSurLeBas();
  const actions = document.querySelector(".regie .actions");
  if (!suiviDuBas && actions && typeof ResizeObserver === "function") (suiviDuBas = new ResizeObserver(caleSurLeBas)).observe(actions);
}

function fermerPlus() {
  $("plus").hidden = true;
  $("plus-fond").hidden = true;
}

function ouvrirConducteur() {
  fermerPlus();
  $("conducteur").hidden = false;
  render();
}

function fermerConducteur() {
  $("conducteur").hidden = true;
}

window.addEventListener("resize", caleSurLeBas);

/**
 * Régie « cockpit » (maquette validée par cedric, 25/10) : la bonne réponse en grand, lettre dans une pastille dorée.
 * Toucher la cache (et la remontre), comme avant.
 */
function grosseReponse(btn, { correct, text, number, flou, prochaine = false }) {
  const lbl = document.createElement("span");
  lbl.className = "rep-lbl";
  lbl.textContent = prochaine ? "Prochaine réponse" : "Bonne réponse";
  const oeil = document.createElement("span");
  oeil.textContent = answerMasked ? "👁 voir" : "👁 cacher";
  lbl.append(oeil);
  const txt = document.createElement("span");
  txt.className = "rep-txt";
  if (answerMasked) txt.textContent = "Réponse cachée";
  else if (number) txt.textContent = String(correct);
  else {
    if (!flou && CHOICE_LETTERS[correct]) txt.append(Object.assign(document.createElement("span"), { className: "rep-lettre", textContent: CHOICE_LETTERS[correct] }));
    txt.append(text);
  }
  btn.replaceChildren(lbl, txt);
}

/** Classement au milieu d'un jeu : la question qui suit, si elle est du même jeu et a une bonne réponse à annoncer. */
function questionSuivante(st) {
  const { questions, next } = gamesOf(st);
  const k = (st.index ?? -1) + 1;
  const q = questions[k];
  if (!q || (next && next.start === k) || st.leaveTo != null) return null;
  if (["coffres", "gonfleur", "patate", "statues", "duel", "simon", "chrono", "mime", "pictionary", "blind"].includes(q.kind)) return null;
  if (q.correct == null) return null;
  return { q, correct: q.correct, text: q.choices?.[q.correct] ?? "", number: q.kind === "number", flou: BUZZ_KINDS.includes(q.kind) };
}

/** Jeux qui ont déjà leur propre écran au milieu de la régie pendant la question (mimes, blind test, statues…). */
const MILIEU_OCCUPE = ["mime", "blind", "statues", "duel", "simon", "chrono", "coffres", "gonfleur", "patate"];

/**
 * Une tuile par équipe (1 à 8) : sa couleur, ses points, ce qu'elle fait (a répondu, réfléchit, sa réponse et ses
 * points une fois révélée, sa place au classement). La toucher ouvre « Bonus ou malus » réglé sur elle ; une tablette
 * coupée passe en rouge et la toucher ouvre le QR pour la reconnecter. Au buzz, le verdict plein écran passe devant.
 */
function renderTuiles(st, teams) {
  const box = $("c-tuiles");
  const occupe = MILIEU_OCCUPE.some((id) => !$(id).hidden) || !!st.buzz?.team;
  box.hidden = !teams.length || occupe;
  if (box.hidden) { box.dataset.cle = ""; return; }
  const scores = st.scores ?? {};
  const tri = teams.map(([id]) => scores[id] ?? 0).sort((a, b) => b - a);
  const place = (id) => tri.indexOf(scores[id] ?? 0) + 1;
  const classement = st.phase === "scores" || st.phase === "ended";
  const enQuestion = (st.phase === "question" || st.phase === "closed") && !BUZZ_KINDS.includes(st.kind);
  const revele = st.phase === "reveal" && st.awards != null;
  const ordre = classement ? [...teams].sort((a, b) => (scores[b[0]] ?? 0) - (scores[a[0]] ?? 0)) : teams;
  // Redessinées seulement quand quelque chose change : un doigt posé sur une tuile ne la perd jamais en route.
  const cle = JSON.stringify([st.phase, st.kind, st.index, ordre.map(([id, t]) => [id, t.name, t.color, scores[id], tablettesCoupees.has(id), live.answers[id] ? live.answers[id].choice ?? true : null, st.awards?.[id] ?? null])]);
  if (box.dataset.cle === cle) return;
  box.dataset.cle = cle;
  box.classList.toggle("une", teams.length === 1);
  box.classList.toggle("serree", teams.length > 4);
  const tuiles = ordre.map(([id, t]) => {
    const coupee = tablettesCoupees.has(id);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tuile";
    b.dataset.team = id;
    b.style.setProperty("--c", t.color ?? "#fff");
    const nom = document.createElement("span");
    nom.className = "t-nom";
    if (classement) nom.append(Object.assign(document.createElement("span"), { className: `t-place${place(id) === 1 ? " premiere" : ""}`, textContent: String(place(id)) }));
    nom.append(t.name ?? "Équipe");
    const score = Object.assign(document.createElement("span"), { className: "t-score", textContent: String(scores[id] ?? 0) });
    const etat = document.createElement("span");
    etat.className = "t-etat";
    const rep = live.answers[id];
    const a = st.awards?.[id];
    if (coupee && st.phase !== "ended") {
      b.classList.add("coupee");
      etat.textContent = "📱 Hors ligne · touchez : QR";
    } else if (st.phase === "lobby") {
      etat.textContent = "connectée";
      etat.classList.add("ok");
    } else if (enQuestion) {
      etat.textContent = rep ? (st.kind === "number" ? `✓ ${rep.choice}` : "✓ a répondu") : "… réfléchit";
      etat.classList.add(rep ? "ok" : "attend");
    } else if (revele && !BUZZ_KINDS.includes(st.kind)) {
      const choix = rep == null ? "pas de réponse" : st.kind === "number" ? String(rep.choice) : CHOICE_LETTERS[rep.choice] ?? "";
      const pts = (a?.points ?? 0) + (a?.bonus ?? 0);
      etat.textContent = `${a?.correct ? "✓" : "✕"} ${choix} · ${pts > 0 ? "+" : ""}${pts}`;
      etat.classList.add(a?.correct ? "ok" : "ko");
    } else if (a && (a.points || a.bonus)) {
      const pts = (a.points ?? 0) + (a.bonus ?? 0);
      etat.textContent = `${pts > 0 ? "+" : ""}${pts}`;
      etat.classList.add(pts > 0 ? "ok" : "ko");
    }
    b.append(nom, score, etat);
    b.setAttribute("aria-label", `${t.name ?? "Équipe"} : ${scores[id] ?? 0} points${etat.textContent ? `, ${etat.textContent}` : ""}`);
    // Bonus et malus seulement par « ± Points » dans ☰ Plus (cedric, 30/10) : une tuile ne réagit que tablette coupée (QR code).
    b.disabled = !coupee;
    if (coupee) b.onclick = ouvrirTablette;
    return b;
  });
  box.replaceChildren(...tuiles);
}

/**
 * Tablettes coupées : une pastille rouge dans la barre du haut (verte un instant au retour) ; la toucher = la reconnecter.
 * Elle dit qui, d'un coup d'œil (cedric, 25/10) : la couleur et le nom de l'équipe, les deux noms pour deux équipes,
 * les couleurs et le nombre au-delà. Rien quand toutes les tablettes sont là.
 */
function pastilleHorsLigne(bandeau, coupees, revenues) {
  bandeau.hidden = true;
  const pastille = $("c-horsligne");
  const ids = coupees.length ? coupees : revenues;
  pastille.hidden = !ids.length;
  pastille.classList.toggle("revenue", !coupees.length);
  const nom = (id) => live.teams[id]?.name ?? "Une équipe";
  const couleurs = ids.slice(0, 3).map((id) => {
    const c = document.createElement("span");
    c.className = "hl-couleur";
    c.style.background = live.teams[id]?.color ?? "#fff";
    return c;
  });
  const noms = document.createElement("span");
  noms.className = ids.length <= 2 ? "hl-noms" : "hl-noms nombre";
  noms.textContent = ids.length <= 2 ? ids.map(nom).join(", ") : String(ids.length);
  const pluriel = ids.length > 1 ? "s" : "";
  pastille.replaceChildren("📱", ...couleurs, noms, coupees.length ? "hors ligne" : `revenue${pluriel}`);
  pastille.title = coupees.length ? `Déconnectée${pluriel} : ${ids.map(nom).join(", ")}` : `Revenue${pluriel} : ${ids.map(nom).join(", ")}`;
  pastille.onclick = coupees.length ? ouvrirTablette : null;
}

/** Après le verdict d'un buzz : un bandeau de 2 s confirme ce qui a été envoyé, puis la scène reprend seule. */
function flashVerdict(bonne) {
  if (!COCKPIT) return;
  const el = $("c-flash");
  const nom = live.teams[live.state?.buzz?.team]?.name ?? "";
  el.textContent = `${bonne ? "✓ Bonne réponse" : "✕ Mauvaise réponse"}${nom ? ` · ${nom}` : ""}`;
  el.className = `flash-verdict ${bonne ? "bonne" : "mauvaise"}`;
  el.style.top = `${Math.round(document.querySelector(".regie .top").getBoundingClientRect().bottom) + 6}px`;
  el.hidden = false;
  clearTimeout(el.minuteur);
  el.minuteur = setTimeout(() => { el.hidden = true; }, 2000);
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
function demander({ title, text = "", ok = "Confirmer", non = "Annuler", alert = false, attention = "", line = "", warn = "", danger = "", safe = false, password = false, action = null }) {
  return new Promise((resolve) => {
    const box = $("ask");
    const show = (id, value) => { $(id).textContent = value; $(id).hidden = !value; };
    $("ask-title").textContent = title;
    $("ask-attention").hidden = !attention;
    $("ask-attention").querySelector("span").textContent = attention;
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
    cancelBtn.textContent = ok == null ? "Fermer" : non;
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

/**
 * Pictogrammes « lecteur » (cedric, 31/10) : le caractère ⏭ des polices a ses deux triangles plus bas que la barre.
 * En tête d'un bouton (ou de son libellé), ⏭ ⏮ ⏩ ⏪ ⏸ ⏯ passent dans un petit span que regie-gs.css dessine proprement
 * (triangles centrés sur la barre) ; le caractère reste dans le texte, invisible (lecture d'écran, tests).
 */
const PICTOS_LECTEUR = { "⏭": "suivant", "⏮": "precedent", "⏩": "avance", "⏪": "recul", "⏸": "pause", "⏯": "lecture-pause" };
const PICTO_EN_TETE = /^([⏭⏮⏩⏪⏸⏯])\uFE0F?/u;

function dessinerPicto(el) {
  const t = el.firstChild;
  if (!t || t.nodeType !== Node.TEXT_NODE) return;
  const m = PICTO_EN_TETE.exec(t.data);
  if (!m) return;
  const picto = document.createElement("span");
  picto.className = `picto picto-${PICTOS_LECTEUR[m[1]]}`;
  picto.textContent = m[0];
  t.data = t.data.slice(m[0].length);
  el.insertBefore(picto, t);
}

function dessinerPictos(racine) {
  if (racine.matches?.("button, .label")) dessinerPicto(racine);
  racine.querySelectorAll?.("button, .label").forEach(dessinerPicto);
}

new MutationObserver((changements) => {
  for (const c of changements) {
    const el = c.target.nodeType === Node.TEXT_NODE ? c.target.parentElement : c.target;
    const bouton = el?.closest?.("button, .label");
    if (bouton) dessinerPicto(bouton);
    for (const n of c.addedNodes) if (n.nodeType === Node.ELEMENT_NODE) dessinerPictos(n);
  }
}).observe($("regie"), { subtree: true, childList: true, characterData: true });
dessinerPictos($("regie"));

function control() {
  installerCockpit();
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
    // Présence du téléphone (cedric, 30/10) : la box compte ses coupures dans ses rapports, comme celles des tablettes.
    if (!live.connected) return;
    const presence = ref(db, `games/${code}/regiePresence/${uid}`);
    presenceRegie = presence;
    onDisconnect(presence).set({ online: false, at: serverTimestamp() })
      .then(() => set(presence, { online: true, at: serverTimestamp(), cachee: document.visibilityState === "hidden" }))
      .catch(() => { /* téléphone plus relié à cette partie */ });
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
    if (first && !tabChosen && live.state?.phase === "lobby") {
      switchTab("show");
      // Arrivée en suivant la TV (« Fin de la fête ») : la liste des prestations s'ouvre d'elle-même.
      if (COCKPIT && arriveeEnSuivant()) ouvrirPlus();
    }
    first = false;
    suivreLaTV(live.state);
    render();
  });
  listen(`games/${code}/teams`, (s) => { live.teams = s.val() ?? {}; render(); });
  listen(`games/${code}/presence`, (s) => { live.presence = s.val() ?? {}; render(); });
  listen(`games/${code}/conducteur`, (s) => { live.plan = s.val(); render(); });
  listen(`games/${code}/show/facteurs`, (s) => { live.facteurs = s.val() ?? {}; render(); });
  // Blind test : la box dit, extrait par extrait, s'il est dans son cache (ok), en chargement ou manquant.
  listen(`games/${code}/media`, (s) => { live.media = s.val() ?? {}; render(); });
  listen(`games/${code}/joinRequests`, (s) => { live.requests = s.val() ?? {}; render(); });
  // Couleurs des bracelets choisies dans la prestation (Régie PC), publiées par la TV : ce sont elles qu'on propose.
  listen(`games/${code}/public/teamColors`, (s) => {
    const planned = Object.values(s.val() ?? {}).filter((c) => typeof c === "string" && /^#[0-9A-Fa-f]{6}$/.test(c));
    live.plannedColors = planned.length ? planned : null;
    render();
  });
  // Notes de Sarah pour l'animatrice, préparées dans l'administration avec la prestation.
  listen(`games/${code}/show/notes`, (s) => {
    const notes = typeof s.val() === "string" ? s.val().trim() : "";
    // Ouvertes à leur arrivée avant la partie ; l'animatrice les replie d'une touche.
    if (notes && notes !== $("c-notes-text").textContent) $("c-notes").open = (live.state?.phase ?? "lobby") === "lobby";
    $("c-notes").hidden = !notes;
    $("c-notes-text").textContent = notes;
  });
}

/**
 * « 🏁 Fin de la fête » ou nouvelle partie lancée sur la TV (cedric, 25/10 : « il faut que ça suive tout seul ») :
 * la box laisse sur l'ancienne partie l'adresse de la nouvelle (state/suite) et y a déjà relié ce téléphone. La régie
 * passe seule à la nouvelle partie, sans QR ni mot de passe, la liste des prestations ouverte. Si la box n'a pas pu
 * relier ce téléphone, la régie le dit et propose d'y aller avec le mot de passe.
 */
let suiteVue = null;
async function suivreLaTV(st) {
  const suite = typeof st?.suite === "string" ? st.suite.toUpperCase() : null;
  if (!st?.leftAt || !suite || !/^[A-Z0-9]{5}$/.test(suite) || suite === code || suiteVue === suite) return;
  suiteVue = suite;
  const partie = code;
  const relie = await hasAccess({ db, uid }, suite).catch(() => false);
  if (code !== partie) return;
  const adresse = new URL(location.href);
  adresse.searchParams.set("g", suite);
  if (relie) {
    adresse.searchParams.set("suivie", "1");
    adresse.searchParams.delete("regie");
    toast("La TV a ouvert une nouvelle partie : la régie la suit…");
    setTimeout(() => location.replace(adresse.href), 600);
    return;
  }
  adresse.searchParams.set("regie", "1");
  adresse.searchParams.delete("suivie");
  const lien = Object.assign(document.createElement("a"), { className: "btn main", href: adresse.href, textContent: "Aller à la nouvelle partie" });
  $("c-suite").replaceChildren("La TV a ouvert une nouvelle partie. Ce téléphone n'a pas pu la suivre seul : touchez ci-dessous, puis tapez le mot de passe.", lien);
  $("c-suite").hidden = false;
}

/** Page ouverte en suivant la TV : une seule fois (un rechargement ne rouvre pas la liste). */
function arriveeEnSuivant() {
  const adresse = new URL(location.href);
  if (adresse.searchParams.get("suivie") !== "1") return false;
  adresse.searchParams.delete("suivie");
  history.replaceState(null, "", adresse.href);
  return true;
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

/** Tout dernier jeu de la prestation : « suivant » lance directement les résultats finaux, sans classement juste avant (cedric, 27/10). */
function derniere(st) {
  return st.total != null && (st.index ?? 0) + 1 >= st.total;
}

/**
 * Vrai ou Faux express : une autre affirmation de la même série suit. La TV enchaîne toute seule et les scores
 * n'arrivent qu'à la fin de la série (cedric, 28/10) : jamais « Voir les scores » entre deux affirmations.
 */
function expressSuivante(st) {
  if (st.kind !== "express") return false;
  const questions = live.plan?.questions ?? [];
  const q = questions[st.index ?? -1];
  const n = questions[(st.index ?? -1) + 1];
  return q != null && n != null && n.kind === "express" && (n.round ?? null) === (q.round ?? null);
}

function versClassement(st, libelle) {
  return derniere(st) ? "Résultats finaux 🏆" : libelle;
}

/**
 * Fin des coffres mystères : pas de tableau des scores, chaque coffre a déjà montré le classement (cedric, 28/10) ;
 * le bouton annonce le jeu suivant, ou les résultats finaux si c'était le dernier jeu.
 */
function finCoffresLabel(st) {
  if (derniere(st)) return "Résultats finaux 🏆";
  const { next, questions } = gamesOf(st);
  return next ? `Jeu suivant : ${gameName(next, questions)} ▶` : "Question suivante";
}

function nextLabel(st, teamCount) {
  if (blindMode(st)) {
    const b = st.blind;
    if (st.phase === "question") return st.buzz?.team ? "Une équipe répond…" : b.waiting ? (b.played ? "▶ Relancer la musique" : "▶ Lancer le morceau") : "⏸ Arrêter la musique";
    if (st.phase === "reveal") return blindHasNext(st) ? "Titre suivant ▶" : versClassement(st, "Bilan du blind test");
  }
  const statues = statuesEtape(st);
  if (statues) return statuesBoutonPrincipal(statues, st);
  const duel = duelEtape(st);
  if (duel) return duelBoutonPrincipal(duel, st);
  const simon = simonEtape(st);
  if (simon) return simonBoutonPrincipal(simon, st);
  const chrono = chronoEtape(st);
  if (chrono) return chronoBoutonPrincipal(chrono, st);
  switch (st.phase) {
    case "lobby": return teamCount ? "Lancer la fête !" : "En attente des équipes";
    // Écran de présentation du jeu sur la TV : l'animatrice explique les règles, puis lance le jeu.
    case "intro": return "▶ Lancer l'épreuve";
    // Les coffres mystères : ce sont les équipes qui ouvrent les coffres, le bouton principal attend l'explosion.
    case "question": return st.kind === "coffres" ? "Coffres en cours… 🗝️" : st.kind === "gonfleur" ? "⏹ Arrêter la course" : st.kind === "patate" ? "Mèche allumée… 💣" : st.mime ? (st.mime.team ? "Arrêter le tour" : mimeRemaining(st).length ? `Terminer ${st.kind === "pictionary" ? "le Pictionary" : "les mimes"}` : versClassement(st, "Voir le classement")) : "Arrêter le chrono";
    case "closed": return "Révéler la réponse";
    case "reveal": return expressSuivante(st) ? "Affirmation suivante ▶" : st.kind === "coffres" ? finCoffresLabel(st) : versClassement(st, "Voir les scores");
    case "scores": {
      const { next, questions } = gamesOf(st);
      // Bilan d'un jeu quitté en cours de route (cedric, 24/10) : « suivant » ouvre le jeu choisi.
      if (st.leaveTo != null && next) return `Jeu suivant : ${gameName(next, questions)} ▶`;
      if ((st.index ?? 0) + 1 >= (st.total ?? 0)) return "Résultats finaux 🏆";
      // Fin d'un jeu : on annonce le jeu qui commence, jamais une simple « question suivante ».
      if (next && next.start === (st.index ?? 0) + 1) return `Jeu suivant : ${gameName(next, questions)} ▶`;
      // Mimes, une manche par équipe : la suivante est celle d'une autre couleur.
      const suivante = questions[(st.index ?? 0) + 1];
      return suivante?.kind === "mime" && couleurMimeEquipe(suivante.text) ? `Au tour de ${lEquipe(suivante.text)} ▶` : "Question suivante";
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
  $("c-question").textContent = intro ? "La TV présente le jeu. Expliquez les règles, puis lancez l'épreuve." : inQuestion ? st.text ?? q?.text ?? ""
    : st.phase === "ended" ? (st.leftAt ? "🏁 Fête terminée. La TV est revenue à l'accueil, prête pour la prochaine fête. Merci !"
      : gamesOf(st).next ? "Bravo à toutes les équipes ! Un jeu a été ajouté : la partie peut reprendre."
      : finAttendue(st) ? "Bravo à toutes les équipes ! Le podium est sur la TV. Parlez aux enfants, puis « ▶ Lancer la fin » : la fusée part, puis l'écran Merci."
      : "Bravo à toutes les équipes ! Pour continuer, ajoutez un jeu (onglet Programme) ou rejouez-en un (⏭ Changer de jeu). Sinon : « 🏁 Fin de la fête ».")
    : `${teams.length} équipe${teams.length > 1 ? "s" : ""} inscrite${teams.length > 1 ? "s" : ""}`;

  // Coffres mystères : aucune réponse à montrer (le contenu des coffres est tiré à l'ouverture).
  const correct = ["coffres", "gonfleur", "patate", "simon", "chrono"].includes(q?.kind ?? st.kind) ? null : q?.correct ?? st.correct;
  const answerBtn = $("c-answer");
  answerBtn.hidden = intro || !inQuestion || correct == null;
  if (correct != null) {
    const text = (st.choices ?? q?.choices ?? [])[correct] ?? "";
    const number = (q?.kind ?? st.kind) === "number";
    const flou = BUZZ_KINDS.includes(q?.kind ?? st.kind);
    answerBtn.textContent = answerMasked ? "Réponse masquée · toucher pour voir" : number ? `Juste Chiffre · ${correct}` : flou ? `Réponse · ${text}` : `Réponse ${CHOICE_LETTERS[correct]} · ${text}`;
    answerBtn.classList.toggle("masked", answerMasked);
    if (COCKPIT) grosseReponse(answerBtn, { correct, text, number, flou });
  }
  // Classement d'un jeu en cours : la réponse de la question qui arrive, en grand, pour l'annoncer sans chercher.
  const suite = COCKPIT && st.phase === "scores" ? questionSuivante(st) : null;
  if (suite) {
    answerBtn.hidden = false;
    $("c-question").textContent = `Question suivante : ${suite.q.text ?? ""}`;
    grosseReponse(answerBtn, { ...suite, prochaine: true });
    answerBtn.classList.toggle("masked", answerMasked);
  }
  answerBtn.classList.toggle("grosse", COCKPIT && !answerBtn.hidden);
  const answered = Object.keys(live.answers).filter((t) => live.teams[t]).length;
  $("c-answered").textContent = BUZZ_KINDS.includes(st.kind) || st.kind === "statues" || st.kind === "duel" || st.kind === "simon" || st.kind === "chrono" || st.kind === "gonfleur" || st.kind === "patate" ? "" : st.phase === "question" || st.phase === "closed" ? `${answered} / ${teams.length} équipes ont répondu` : "";

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
  renderDuel(st, teams);
  renderSimon(st);
  renderChrono(st);
  renderTeams(st, teams);
  if (COCKPIT) renderTuiles(st, teams);
  renderPoints();
  renderPlan(st);
  renderCarte();
  renderShows(st);
  runTimer(st);

  const next = $("c-next");
  next.hidden = st.phase === "ended" && (!gamesOf(st).next || !!st.leftAt);
  // Fin de la partie (cedric, 23/10) : sur l'écran « Merci d'avoir participé », un gros bouton pour quitter la fête ;
  // la TV revient à l'accueil. Une fois la TV partie (leftAt), plus rien à piloter ici.
  // « ▶ Lancer la fin » (cedric, 29/10) : le podium attend Sarah ; la box publie outroAt une fois la fin lancée.
  // Une box d'avant ne publie rien : après sa réponse, place directement à « Fin de la fête ».
  if (st.phase !== "ended") finSansOutro = false;
  const lancer = $("c-lancer-fin");
  lancer.hidden = !finAttendue(st);
  lancer.disabled = !!pending?.advance;
  const fin = $("c-fin");
  fin.hidden = st.phase !== "ended" || !!st.leftAt || !lancer.hidden;
  fin.disabled = !!pending?.advance;
  fin.classList.toggle("secondary", !next.hidden);
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
  const statues = statuesEtape(st);
  if (statues) next.disabled = next.disabled || (!!statues.choix && !statues.choix.personne && !statues.choix.equipes.size) || (!!statues.resultat && statues.annonce > 0);
  const duel = duelEtape(st);
  if (duel) next.disabled = next.disabled || duel.d.step === "standoff" || (!!duel.choix && duel.choix.length !== 2);
  const simon = simonEtape(st);
  if (simon) next.disabled = next.disabled || simon.s.step === "play" || simon.s.step === "none" || simon.verif > 0;
  const chrono = chronoEtape(st);
  if (chrono) next.disabled = next.disabled || (chrono.c.step === "run" && chrono.c.reveler !== true) || chrono.c.step === "none";
  // Mimes : le gros bouton « Trouvé » est dans la rubrique ; le bas de l'écran arrête le tour ou la manche.
  if (st.phase === "question" && st.mime) next.classList.toggle("secondary", !!st.mime.team);
  else next.classList.remove("secondary");
  $("c-end").hidden = st.phase === "ended" || st.phase === "lobby";
  $("c-arret").hidden = st.phase === "lobby" || !!st.leftAt;
  caleSurLeBas();
}

/**
 * En pause : pourquoi, et qui n'est pas prêt. La reprise reste toujours le choix de l'animatrice,
 * même quand l'équipe déconnectée est revenue.
 */
/** Super Finales dont le multiplicateur de la Régie PC a déjà été envoyé à la TV (une fois chacune). */
const facteursProposes = new Set();

/** Juste avant les dernières questions du quiz : l'animatrice choisit ×2, ×3, ×4 ou ×5 (×2 par défaut ; ×4 : cedric, 31/10). */
function renderFactor(st) {
  const choice = st.factorChoice;
  const box = $("c-factor");
  box.hidden = !choice || isDemo();
  if (box.hidden) return;
  // Multiplicateur choisi dans la Régie PC (cedric, 23/10 : ×2 d'office) : proposé une fois, Sarah peut encore le changer.
  const voulu = live.facteurs?.[live.plan?.questions?.[choice.start]?.id];
  const cle = `${live.plan?.id ?? ""}:${choice.start}`;
  if ([3, 4, 5].includes(voulu) && choice.factor !== voulu && !facteursProposes.has(cle)) {
    facteursProposes.add(cle);
    send("factor", { factor: voulu });
  }
  const n = (live.plan?.questions ?? []).slice(choice.start).findIndex((q, k, rest) => !(q.double || q.finale) || (k > 0 && q.round !== rest[0].round));
  const count = n < 0 ? (live.plan?.questions?.length ?? 0) - choice.start : n;
  // Vrai ou Faux express : sa Super Finale aussi (cedric, 23/10), en affirmations.
  const vf = live.plan?.questions?.[choice.start]?.kind === "express";
  const quoi = vf ? ["affirmation", "du Vrai ou Faux"] : ["question", "du quiz"];
  $("c-factor-text").textContent = `${count > 1 ? `Les ${count} dernières ${quoi[0]}s ${quoi[1]} arrivent` : `La dernière ${quoi[0]} ${quoi[1]} arrive`} : combien de points ?`;
  box.querySelectorAll("[data-factor]").forEach((b) => {
    const on = Number(b.dataset.factor) === choice.factor;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

/** Bandeau d'alerte : une tablette d'équipe coupée depuis 4 s (comme la pause de la TV), à tout moment de la fête. */
const ALERTE_APRES_MS = 4000;
const REVENUE_MS = 3000;
const horsLigneDepuis = new Map();
let alertees = new Set();
let masquees = new Set();
/** Équipes coupées depuis plus de 4 s (même délai que la pastille) : leur tuile passe en rouge, toucher = le QR. */
let tablettesCoupees = new Set();
let revenue = { ids: [], noms: [], jusqua: 0 };
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
  if (revenues.length) revenue = { ids: revenues, noms: revenues.map(name), jusqua: now + REVENUE_MS };
  // Une tablette de plus vient de lâcher : le téléphone vibre (dans la poche ou posé, Sarah le sent).
  if (coupees.some((id) => !alertees.has(id) && !masquees.has(id))) navigator.vibrate?.([200, 100, 200]);
  alertees = new Set(coupees);
  const visibles = coupees.filter((id) => !masquees.has(id));
  tablettesCoupees = new Set(coupees);
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
  if (COCKPIT) pastilleHorsLigne(box, visibles, revenue.jusqua > now ? revenue.ids : []);
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

/** Nom et couleur en cours de choix pour chaque tablette en attente : gardés quand la liste se redessine. */
const brouillons = {};

const memeCouleur = (a, b) => a?.toUpperCase() === b?.toUpperCase();
const nomCouleur = (c) => TEAM_COLOR_NAMES[TEAM_COLORS.findIndex((t) => memeCouleur(t, c))] ?? "";

/**
 * Couleurs proposées pour une nouvelle équipe (cedric, 22/10) : celles de la prestation, choisies dans la Régie PC
 * pour les bracelets, ou à défaut les 4 des bracelets ; une de plus seulement quand toutes celles-là sont prises.
 */
function couleursProposees(prises) {
  const offered = [...(live.plannedColors ?? TEAM_COLORS.slice(0, BRACELET_COLORS))];
  for (const c of TEAM_COLORS) {
    if (offered.every((o) => prises.has(o.toUpperCase())) && !offered.some((o) => memeCouleur(o, c))) offered.push(c);
  }
  return offered;
}

/**
 * Tablettes qui attendent (cedric, 24/10) : la tablette ne tape ni ne choisit rien. L'animatrice donne ici le nom et
 * la couleur d'une nouvelle équipe et l'accepte, ou confie la tablette à une équipe existante, ou l'ignore.
 */
function renderRequests(st, teams) {
  const box = $("c-requests");
  const requests = Object.entries(live.requests).sort((a, b) => (a[1].at ?? 0) - (b[1].at ?? 0));
  const online = (id) => live.presence[id]?.online === true;
  for (const d of Object.keys(brouillons)) if (!live.requests[d]) delete brouillons[d];
  const key = JSON.stringify([requests, teams.map(([id, t]) => [id, t.name, t.color, online(id)]), [...admitting], live.plannedColors, st.phase === "ended"]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  // Nom en cours de frappe : la liste redessinée garde le clavier ouvert au même endroit.
  const actif = document.activeElement?.closest?.("#c-requests .request")?.dataset.device;
  const curseur = actif ? document.activeElement.selectionStart : null;
  box.innerHTML = "";
  box.hidden = !requests.length;
  const prises = new Set(teams.map(([, t]) => t.color?.toUpperCase()).filter(Boolean));
  requests.forEach(([device, r]) => {
    const item = document.createElement("div");
    item.className = "request";
    item.dataset.device = device;
    const target = r.replace && live.teams[r.replace] ? r.replace : null;
    const busy = admitting.has(device) || st.phase === "ended";
    const choices = document.createElement("div");
    choices.className = "choices";
    const ignore = document.createElement("button");
    ignore.className = "link";
    ignore.textContent = "Ignorer";
    ignore.disabled = busy;
    ignore.onclick = () => { delete brouillons[device]; set(ref(db, `games/${code}/joinRequests/${device}`), null).catch((e) => console.error(e)); };
    const remplacer = (id, t) => {
      const b = document.createElement("button");
      b.dataset.team = id;
      b.textContent = `Remplace « ${t.name} »${online(id) ? "" : " (hors ligne)"}`;
      b.disabled = busy;
      b.onclick = () => replaceDevice(device, id);
      return b;
    };
    if (target) {
      // « Reconnecter une tablette » : la tablette a touché le nom de son équipe, l'animatrice confirme.
      const title = document.createElement("p");
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = live.teams[target].color;
      title.append(swatch, `Une nouvelle tablette veut reprendre « ${live.teams[target].name} »`);
      const autres = teams.filter(([id]) => id !== target).sort(([ia], [ib]) => online(ia) - online(ib));
      choices.append(remplacer(target, live.teams[target]), ...autres.map(([id, t]) => remplacer(id, t)), ignore);
      choices.firstChild.classList.add("suggested");
      item.append(title, choices);
      box.appendChild(item);
      return;
    }
    const proposees = couleursProposees(prises);
    const autresChoix = new Set(Object.entries(brouillons).filter(([d]) => d !== device).map(([, b]) => b.color?.toUpperCase()));
    const brouillon = brouillons[device] ??= {
      // Anciennes tablettes : elles envoyaient encore un nom et une couleur.
      name: typeof r.name === "string" ? r.name : "",
      color: proposees.find((c) => memeCouleur(c, r.color) && !prises.has(c.toUpperCase()))
        ?? proposees.find((c) => !prises.has(c.toUpperCase()) && !autresChoix.has(c.toUpperCase()))
        ?? proposees.find((c) => !prises.has(c.toUpperCase())) ?? TEAM_COLORS[0],
    };
    // Couleur prise entre-temps par une autre équipe : la première encore libre.
    if (prises.has(brouillon.color?.toUpperCase())) brouillon.color = proposees.find((c) => !prises.has(c.toUpperCase())) ?? brouillon.color;
    const title = document.createElement("p");
    const tag = document.createElement("span");
    tag.className = "tablet-tag";
    tag.textContent = `Tablette ${numeroTablette(device)}`;
    title.append(tag, "Nouvelle équipe en attente");
    const nom = document.createElement("input");
    nom.className = "req-name";
    nom.type = "text";
    nom.maxLength = 20;
    nom.placeholder = "Nom de l'équipe";
    nom.autocomplete = "off";
    nom.setAttribute("autocapitalize", "words");
    nom.setAttribute("enterkeyhint", "done");
    nom.spellcheck = false;
    nom.value = brouillon.name;
    nom.disabled = busy;
    nom.oninput = () => { brouillon.name = nom.value; };
    const couleurs = document.createElement("div");
    couleurs.className = "req-colors";
    for (const c of proposees) {
      const b = document.createElement("button");
      const prise = prises.has(c.toUpperCase());
      b.dataset.color = c;
      b.style.setProperty("--c", c);
      b.textContent = nomCouleur(c);
      b.disabled = busy || prise;
      b.classList.toggle("taken", prise);
      b.classList.toggle("selected", memeCouleur(c, brouillon.color));
      b.setAttribute("aria-label", prise ? `${nomCouleur(c)} (déjà prise)` : nomCouleur(c));
      b.onclick = () => {
        brouillon.color = c;
        couleurs.querySelectorAll("button").forEach((x) => x.classList.toggle("selected", x === b));
      };
      couleurs.appendChild(b);
    }
    const accepter = document.createElement("button");
    accepter.className = "new";
    accepter.textContent = "✓ Accepter";
    accepter.disabled = busy;
    accepter.onclick = async () => {
      const name = brouillon.name.trim();
      if (!name) {
        toast("Tapez d'abord le nom de l'équipe.");
        return nom.focus();
      }
      if (await admit(device, "admit", { name, color: brouillon.color }, `« ${name} » entre dans la partie.`)) delete brouillons[device];
    };
    nom.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); accepter.click(); } };
    choices.append(accepter, ignore);
    item.append(title, nom, couleurs, choices);
    // Tablette qui remplace une équipe (plantée, rechargée sur un autre appareil) : un choix de plus, plus discret.
    if (teams.length) {
      const reprise = document.createElement("div");
      reprise.className = "choices req-replace";
      const label = document.createElement("span");
      label.textContent = "Ou cette tablette remplace :";
      reprise.append(label, ...[...teams].sort(([ia], [ib]) => online(ia) - online(ib)).map(([id, t]) => remplacer(id, t)));
      item.appendChild(reprise);
    }
    box.appendChild(item);
  });
  if (actif) {
    const champ = box.querySelector(`.request[data-device="${CSS.escape(actif)}"] .req-name`);
    if (champ && !champ.disabled) {
      champ.focus();
      if (curseur != null) champ.setSelectionRange(curseur, curseur);
    }
  }
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
/**
 * « ＋ Ajouter une équipe » (test Mi Box de cedric, 26/10 : introuvable en pleine partie) : la même fenêtre, avec un QR
 * qui fait entrer la tablette comme nouvelle équipe, sans passer par « Reprendre une équipe ». Dès que la tablette
 * demande à entrer, la fenêtre se referme sur la carte « Nouvelle équipe en attente » (nom et couleur).
 */
let tabletteMode = "reprise";
/** Demandes d'entrée déjà là à l'ouverture d'« Ajouter une équipe » : seule une nouvelle referme la fenêtre. */
let demandesConnues = new Set();
const nouvellesDemandes = () => Object.entries(live.requests).filter(([, r]) => r && !r.replace).map(([d]) => d);

/** Lien du QR code : la page des pupitres de cette partie, en mode « reprendre une équipe ». */
function lienReprise(nouvelle = false) {
  const lien = new URL("./", location.href);
  lien.searchParams.set("g", code);
  if (!nouvelle) lien.searchParams.set("reprise", "1");
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
  const complet = Object.keys(live.teams).length >= MAX_TEAMS;
  $("c-equipe").disabled = st.phase === "ended" || complet;
  $("c-equipe").title = complet ? `${MAX_TEAMS} équipes au maximum` : "";
  if (st.phase === "ended") tabletteOpen = false;
  const nouvelle = tabletteMode === "nouvelle";
  // La nouvelle tablette a demandé à entrer : place à la carte « Nouvelle équipe en attente ».
  if (tabletteOpen && nouvelle && nouvellesDemandes().some((d) => !demandesConnues.has(d))) {
    tabletteOpen = false;
    toast("Nouvelle tablette : donnez-lui un nom et une couleur.");
  }
  $("tablette").hidden = !tabletteOpen;
  if (!tabletteOpen) return;
  $("tablette-titre").textContent = nouvelle ? "Ajouter une équipe" : "Reconnecter une tablette";
  $("tablette-consigne").textContent = nouvelle
    ? "Scannez ce QR code avec la nouvelle tablette. Elle demande à entrer : vous lui donnez ici son nom et sa couleur. Les points des autres équipes ne bougent pas."
    : "Scannez ce QR code avec la tablette, puis touchez le nom de l'équipe. Elle garde son nom, sa couleur et ses points.";
  $("tablette-qr").setAttribute("aria-label", nouvelle ? "QR code pour ajouter une équipe" : "QR code pour reprendre une équipe");
  $("tablette-qr").dataset.mode = tabletteMode;
  dessinerQr($("tablette-qr"), lienReprise(nouvelle)).catch((e) => console.error(e));
  $("tablette-bloquee").hidden = nouvelle;
  if (nouvelle) {
    $("tablette-attente").hidden = false;
    $("tablette-demandes").replaceChildren();
    $("tablette-demandes").dataset.key = "";
    return;
  }
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
  tabletteMode = "reprise";
  tabletteOpen = true;
  render();
}
$("c-tablette").onclick = ouvrirTablette;
$("c-equipe").onclick = () => {
  tabletteMode = "nouvelle";
  demandesConnues = new Set(nouvellesDemandes());
  tabletteOpen = true;
  render();
};
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
  // Manche d'une seule équipe (cedric, 23/10) : l'équipe de sa couleur est choisie d'office.
  const seule = equipesDeLaCouleur(st);
  const titre = st.text ?? live.plan?.questions?.[st.index]?.text ?? "";
  if (playing) { mimeTeam = null; mimeChosen = false; }
  else if (!mimeChosen || !live.teams[mimeTeam]) {
    // Ordre d'inscription, en commençant par les équipes qui ont le moins joué (tri stable).
    const ordre = [...teams].sort(([a], [b]) => turns.filter((t) => t === a).length - turns.filter((t) => t === b).length);
    mimeTeam = (seule?.length ? ordre.filter(([id]) => seule.includes(id)) : ordre)[0]?.[0] ?? null;
  }
  // Pictionary : un mot par tour, d'abord montré sur la tablette de l'équipe (m.secret), puis dessiné (m.team).
  const picto = st.kind === "pictionary";
  const secret = picto ? m.secret : null;
  if (secret && live.teams[secret] && !playing && !mimeChosen) mimeTeam = secret;
  const card = m.card;
  // Mimes en roulement (cedric, 24/10) : après un mime trouvé, deux autres joueurs prennent le relais ; l'image
  // suivante attend « Image suivante », une fois le nouveau devineur dos à l'écran. Le chrono continue.
  const relais = !picto && !!playing && m.relais != null;
  // Mimes en file (cedric, 26/10) : une manche par couleur, sur une box qui sait faire tourner les joueurs avec « Passer ».
  const enFile = !picto && !!seule && live.plan?.mimesEnFile === true;
  $("mime").classList.toggle("relais", relais);
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
    : relais && enFile
    ? `${name(playing)} : ${n(m.found ?? 0)} trouvé${(m.found ?? 0) > 1 ? "s" : ""} · 🔄 On tourne : le mimeur file au bout, le suivant court face à l'écran. Quand chacun est à sa place, touchez « 👁 Image suivante ».`
    : relais
    ? `${name(playing)} joue : ${n(m.found ?? 0)} trouvé${(m.found ?? 0) > 1 ? "s" : ""} · 🔄 Changement de joueur : dès que le nouveau devineur est dos à l'écran, touchez « Image suivante ».`
    : playing
    ? `${name(playing)} joue : ${n(m.found ?? 0)} trouvé${(m.found ?? 0) > 1 ? "s" : ""} · ${m.left} image${m.left > 1 ? "s" : ""} restante${m.left > 1 ? "s" : ""}`
    : seule && m.last && enFile
      ? `Tour terminé : ${name(m.last.team)} a trouvé ${n(m.last.found)}. Le classement arrive sur la TV ; ensuite, quand l'équipe suivante est en file, lancez-la.`
    : seule && m.last
      ? `Tour terminé : ${name(m.last.team)} a trouvé ${n(m.last.found)}. Touchez « ${versClassement(st, "Voir le classement")} »${derniere(st) ? "." : ", puis passez à l'équipe suivante."}`
    : seule
      ? seule.length
        ? enFile
          ? `Au tour de ${lEquipe(titre)} : ${name(mimeTeam ?? seule[0])}. Tous en file : le mimeur face à l'écran, les autres dos à l'écran, puis « Top départ ! ».`
          : `Au tour de ${lEquipe(titre)} : ${name(mimeTeam ?? seule[0])}. Faites retourner celui qui devine, puis « Top départ ! ».`
        : `Aucune équipe ${titre.replace(/^Équipe /, "")} dans la partie : choisissez l'équipe qui mime ces images, ou passez avec « ${versClassement(st, "Voir le classement")} ».`
    : m.last
        ? `Tour terminé : ${name(m.last.team)} a trouvé ${n(m.last.found)}. ${mimeRemaining(st).length ? "Qui joue maintenant ?" : "Toutes les équipes sont passées."}`
        : "Qui commence ? Choisissez l'équipe puis « Top départ ! ».";

  // Équipes déjà passées et celles qui restent : la manche ne se termine qu'après toutes, ou sur décision.
  const remaining = mimeRemaining(st);
  const done = [...new Set(turns)].filter((id) => live.teams[id]).map(name);
  $("mime-progress").textContent = seule
    ? done.length ? `Manche de ${lEquipe(titre)} jouée : touchez « ${versClassement(st, "Voir le classement")} ».` : `Manche de ${lEquipe(titre)} : ses ${m.left ?? 0} images`
    : !done.length
    ? `À faire passer : ${remaining.map(name).join(", ") || "aucune équipe"}`
    : remaining.length
      ? `Déjà passées : ${done.join(", ")} · Restent : ${remaining.map(name).join(", ")}`
      : `Toutes les équipes sont passées (${done.join(", ")}) : touchez « ${versClassement(st, "Voir le classement")} ».`;
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
  // Pendant le changement de joueur, pas d'image à trouver : un double appui sur « Trouvé » ne compte pas.
  $("mime-found").disabled = busy || relais;
  $("mime-found").querySelector("small").textContent = picto ? `+${m.points ?? 150} points` : "+1 mime";
  // Pictionary : « Autre mot » tant que le dessinateur découvre le sien ; pas de « Passer » ni de −1 pendant le dessin.
  $("mime-row").hidden = picto ? !secret : !playing;
  $("mime-pass").textContent = picto ? "Proposer 3 autres mots" : relais ? (enFile ? "👁 Image suivante" : "▶ Image suivante") : "Image suivante";
  // Mimes en file : « Image suivante » seulement après Trouvé ou Passer, une fois chacun à sa place.
  $("mime-pass").hidden = enFile && !relais;
  // « ⏭ Passer » (cedric, 26/10) : le mimeur abandonne, les joueurs tournent ; à tout moment du tour, sauf pendant
  // qu'ils tournent déjà (il n'y a alors pas d'image à passer).
  $("mime-skip").hidden = !enFile || !playing;
  $("mime-skip").disabled = busy || relais;
  // Changement de joueur : « Image suivante » devient le bouton principal, il montre l'image qui attendait.
  $("mime-pass").classList.toggle("main", relais);
  $("mime-pass").classList.toggle("secondary", !relais);
  $("mime-pass").disabled = busy || (!relais && (m.left ?? 0) < (picto ? (m.offer?.length ?? 0) + 1 : 2));
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
  verdictEnBas("blind-verdict", on && st.phase === "question" && !!st.buzz?.team && st.paused !== true);
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
  if (st.phase === "question" && buzzer) texteBuzz($("blind-info"), name(buzzer), expected);
  else $("blind-info").textContent = info;
  couleurBuzz($("blind-info"), st.phase !== "scores" && st.phase !== "reveal" ? buzzer : null);
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

$("blind-ok").onclick = () => { navigator.vibrate?.(60); flashVerdict(true); send("buzz_ok", {}, { advance: true }); };
$("blind-ko").onclick = () => { flashVerdict(false); send("buzz_ko", {}, { advance: true }); };
$("blind-unblock").onclick = () => send("blind_unblock", {}, { advance: true });
$("blind-reveal").onclick = async () => {
  // Personne n'a trouvé (cedric, 24/10) : sans attendre la fin de l'extrait, la TV passe à la révélation et au refrain.
  if (await demander({ title: "Passer à la révélation ?", text: "La TV montre le titre et l'artiste, et tout le monde chante le refrain. Aucune équipe ne marque.", ok: "🎤 On chante ensemble" })) send("blind_reveal", {}, { advance: true });
};
$("blind-skip").onclick = async () => {
  if (await demander({ title: "Passer ce morceau ?", text: "Il n'est pas révélé et ne rapporte aucun point.", ok: "Passer le morceau" })) send("blind_skip", {}, { advance: true });
};
$("blind-cut").onclick = () => send("blind_cut", {}, { advance: true });

/**
 * Message « X a buzzé ! » dans la couleur de l'équipe (celle de ses bracelets), précédé du nom de la couleur en
 * gros : Sarah sait d'un coup d'œil quelle équipe interroger, sans relire le nom (cedric, 22/10). Appelée juste après
 * avoir écrit le texte ; sans équipe, le message reprend son style habituel.
 */
function couleurBuzz(el, teamId) {
  const color = teamId ? live.teams[teamId]?.color : null;
  el.classList.toggle("buzz-couleur", !!color);
  // Régie « cockpit » : le verdict plein écran est cadré dans la couleur de l'équipe.
  const cadre = el.closest(".verdict");
  if (!color) {
    cadre?.style.removeProperty("--team");
    return el.style.removeProperty("--team");
  }
  el.style.setProperty("--team", color);
  cadre?.style.setProperty("--team", color);
  const nom = TEAM_COLOR_NAMES[TEAM_COLORS.findIndex((c) => c.toUpperCase() === color.toUpperCase())];
  if (nom) {
    const tag = document.createElement("b");
    tag.className = "buzz-nom-couleur";
    tag.textContent = nom.toUpperCase();
    el.prepend(tag);
  }
}

/** Qui a buzzé, puis la réponse attendue sur sa propre ligne, en gros : Sarah voit tout d'un coup d'œil (cedric, 24/10). */
function texteBuzz(el, equipe, attendu) {
  const reponse = document.createElement("span");
  reponse.className = "buzz-reponse";
  const mot = document.createElement("b");
  mot.textContent = attendu;
  reponse.append("Réponse attendue : ", mot);
  el.replaceChildren(`${equipe} a buzzé ! `, reponse);
}

/**
 * Au buzz (cedric, 24/10) : la couleur et le nom de l'équipe, la réponse attendue et les boutons du verdict passent
 * juste au-dessus des commandes du bas, qui restent toujours à l'écran : Sarah juge sans faire défiler, même avec le
 * bandeau des tablettes déconnectées. Le bloc revient à sa place après le verdict.
 */
function verdictEnBas(id, on) {
  const el = $(id);
  const bas = document.querySelector(".regie .actions");
  el.place ??= { parent: el.parentNode, avant: el.nextSibling };
  if (on && el.parentNode !== bas) bas.prepend(el);
  else if (!on && el.parentNode === bas) el.place.parent.insertBefore(el, el.place.avant);
  el.classList.toggle("en-bas", on);
  // Régie « cockpit » : le verdict plein écran commence juste sous la barre du haut (pastille et chrono visibles).
  if (COCKPIT && on) el.style.top = `${Math.round(document.querySelector(".regie .top").getBoundingClientRect().bottom) + 6}px`;
}

/** Jeux au buzzer : qui a buzzé, la réponse attendue, et les deux boutons du verdict. */
function renderFlou(st) {
  const on = st.phase === "question" && BUZZ_KINDS.includes(st.kind) && !blindMode(st);
  $("flou").hidden = !on;
  // En pause, le verdict ne s'affiche pas en plein écran : il cacherait « Reprendre », et la box refuse un verdict en
  // pause (test du 30/10 au soir : Sarah bloquée sur deux boutons inactifs après la coupure d'une tablette).
  verdictEnBas("flou-verdict", on && !!st.buzz?.team && st.paused !== true);
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
  if (b.team && st.paused === true) $("flou-info").textContent = `Partie en pause : appuyez sur « Reprendre », puis jugez la réponse de ${name(b.team)}.`;
  else if (b.team) texteBuzz($("flou-info"), name(b.team), expected || "voir la fiche");
  else $("flou-info").textContent = memo ? `Les enfants mémorisent les objets… Celui qui va disparaître : ${answer}.`
    : `En attente d'un buzz…${tried.length ? ` Déjà essayé : ${tried.join(", ")}.` : ""}`;
  couleurBuzz($("flou-info"), b.team);
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

/**
 * Statues musicales (cedric, 26/10) : Sarah coupe la musique quand elle veut (✋ STATUE ! / 💃 On danse !), puis désigne
 * la ou les gagnantes de chaque chanson (ou « Personne »). La TV fait le suspense et le bilan ; ensuite « ▶ Chanson
 * suivante » ou « Jeu suivant ». Une TV d'avant (sans state.statues) garde l'ancien écran : un bouton par équipe.
 */
const STATUES_ANNONCE_MS = 8000; // suspense + gagnante(s) à la TV avant le bilan ; la box publie la sienne (annonceMs)
let statuesChoix = null; // écran gagnant ouvert : { cle, equipes: Set, personne }
let statuesAnnonce = null;

/** Où en est la chanson : en cours, écran gagnant, annonce de la gagnante à la TV, ou bilan affiché. */
function statuesEtape(st) {
  const s = st.statues;
  if (st.kind !== "statues" || !s || (st.phase !== "question" && st.phase !== "closed")) return null;
  const cle = `${st.index ?? 0}:${s.song ?? 0}`;
  const resultat = s.result && (s.result.song ?? s.song) === s.song ? s.result : null;
  if (resultat || (statuesChoix && statuesChoix.cle !== cle)) statuesChoix = null;
  // Chanson allée au bout toute seule : l'écran gagnant s'ouvre directement.
  if (!resultat && s.ended === true && !statuesChoix) statuesChoix = { cle, equipes: new Set(), personne: false };
  const annonce = resultat ? (resultat.at ?? 0) + (s.annonceMs ?? STATUES_ANNONCE_MS) - (Date.now() + serverOffset) : 0;
  return { s, cle, resultat, choix: resultat ? null : statuesChoix, annonce, encore: (s.song ?? 0) + 1 < (s.songs ?? 1) };
}

function renderStatues(st, teams) {
  const on = (st.phase === "question" || st.phase === "closed") && st.kind === "statues";
  $("statues").hidden = !on;
  clearTimeout(statuesAnnonce);
  if (!on) { statuesChoix = null; return; }
  const e = statuesEtape(st);
  if (!e) return renderStatuesAvant(st, teams);
  const { s, resultat, choix, annonce, encore } = e;
  const busy = !!pending?.advance || st.paused === true;
  const name = (id) => live.teams[id]?.name ?? "Une équipe";
  const titre = s.titles?.[s.song ?? 0];
  const chanson = [(s.songs ?? 1) > 1 ? `Chanson ${(s.song ?? 0) + 1} sur ${s.songs}` : "", titre ? `« ${titre} »` : ""].filter(Boolean).join(" · ");
  const gagnantes = resultat ? (Array.isArray(resultat.winners) ? resultat.winners : Object.values(resultat.winners ?? {})) : [];
  $("statues-info").textContent = resultat
    ? `${gagnantes.length ? `🏆 ${gagnantes.map(name).join(", ")} ${gagnantes.length > 1 ? "gagnent" : "gagne"} la chanson.` : "Personne ne gagne cette chanson."} ${annonce > 0 ? "Annonce sur la TV…" : "Bilan des scores sur la TV."}`
    : choix ? `${s.ended === true ? "La chanson est finie. " : ""}Qui a gagné ? Touchez une ou plusieurs équipes, ou «\u00a0Personne\u00a0».`
      : `${chanson ? `${chanson}. ` : ""}${s.dancing === true ? "💃 Les enfants dansent." : "✋ Statue ! Éliminez ceux qui bougent."}`;
  const bascule = $("statues-bascule");
  bascule.hidden = !!resultat || !!choix;
  bascule.textContent = s.dancing === true ? "✋ STATUE !" : "💃 On danse !";
  bascule.classList.toggle("danse", s.dancing !== true);
  bascule.disabled = busy;
  $("statues-choisir").hidden = !!resultat || !!choix;
  $("statues-choisir").disabled = busy;
  // Écran gagnant : une grosse tuile par équipe dans sa couleur, à cocher, et « Personne ».
  const box = $("statues-teams");
  box.hidden = !choix;
  const key = `choix|${teams.map(([id, t]) => `${id}:${t.name}:${t.color}`).join("|")}`;
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    const personne = document.createElement("button");
    personne.className = "statues-tuile personne";
    personne.dataset.team = "";
    personne.textContent = "Personne";
    personne.onclick = () => basculerGagnante(null);
    box.replaceChildren(...teams.map(([id, t]) => {
      const b = document.createElement("button");
      b.className = "statues-tuile";
      b.dataset.team = id;
      b.style.setProperty("--team", t.color ?? "#fff");
      b.textContent = t.name;
      b.onclick = () => basculerGagnante(id);
      return b;
    }), personne);
  }
  box.classList.toggle("serree", teams.length > 4);
  box.querySelectorAll("button").forEach((b) => {
    const coche = !!choix && (b.dataset.team ? choix.equipes.has(b.dataset.team) : choix.personne);
    b.classList.toggle("cochee", coche);
    b.setAttribute("aria-pressed", String(coche));
    b.disabled = busy;
  });
  $("statues-retour").hidden = !choix || s.ended === true;
  $("statues-suivante").hidden = !resultat || annonce > 0 || !encore;
  $("statues-suivante").disabled = busy;
  if (resultat && annonce > 0) statuesAnnonce = setTimeout(render, annonce + 50);
  $("statues-points").textContent = resultat ? "" : `${st.double ? "600" : "300"} points pour chaque gagnante, ${st.double ? "300" : "150"} pour les autres équipes. «\u00a0Personne\u00a0» : aucun point.`;
}

function basculerGagnante(id) {
  const c = statuesChoix;
  if (!c) return;
  navigator.vibrate?.(30);
  if (id == null) {
    c.personne = !c.personne;
    if (c.personne) c.equipes.clear();
  } else {
    c.personne = false;
    if (c.equipes.has(id)) c.equipes.delete(id);
    else c.equipes.add(id);
  }
  render();
}

$("statues-bascule").onclick = () => {
  const s = live.state?.statues;
  if (!s) return;
  navigator.vibrate?.(80);
  send(s.dancing === true ? "statues_stop" : "statues_play", {}, { advance: true });
};
$("statues-choisir").onclick = () => {
  const e = statuesEtape(live.state ?? {});
  if (!e || e.resultat) return;
  statuesChoix = { cle: e.cle, equipes: new Set(), personne: false };
  render();
};
$("statues-retour").onclick = () => { statuesChoix = null; render(); };
async function validerGagnantes() {
  const c = statuesChoix;
  if (!c || (!c.personne && !c.equipes.size)) return;
  navigator.vibrate?.(60);
  // « Personne » : un tableau vide disparaît dans la base, la box reçoit donc aussi personne: true.
  const r = await send("statues_win", c.personne ? { teams: [], personne: true } : { teams: [...c.equipes] }, { advance: true });
  if (r?.status === "applied" && statuesChoix === c) statuesChoix = null;
  render();
}
$("statues-suivante").onclick = () => { navigator.vibrate?.(60); send("statues_song", {}, { advance: true }); };

/** Bouton principal pendant les statues : passer par l'écran gagnant, attendre l'annonce, puis « Jeu suivant ». */
function statuesBoutonPrincipal(e, st) {
  const c = e.choix;
  if (c) return c.personne ? "✓ Valider : personne" : c.equipes.size > 1 ? `✓ Valider : ${c.equipes.size} gagnantes` : c.equipes.size ? `✓ Valider : ${live.teams[[...c.equipes][0]]?.name ?? "1 gagnante"}` : "Touchez la ou les gagnantes";
  if (!e.resultat) return e.encore ? "⏭ Chanson suivante" : "⏭ Finir la chanson";
  if (e.annonce > 0) return "Annonce sur la TV…";
  // Fin du jeu : le tableau des scores sur la TV, comme après chaque jeu (test du 28/10), puis « Jeu suivant ».
  return versClassement(st, "Voir les scores");
}

/** Ancienne TV : un gros bouton par équipe pour désigner la gagnante, à la fin ou dès qu'il n'en reste qu'une. */
function renderStatuesAvant(st, teams) {
  for (const id of ["statues-bascule", "statues-choisir", "statues-retour", "statues-suivante"]) $(id).hidden = true;
  const busy = !!pending?.advance || st.paused === true;
  $("statues-info").textContent = st.phase === "closed"
    ? "La musique est finie : touchez l'équipe gagnante."
    : "Musique en cours : les enfants dansent et se figent à chaque arrêt. Éliminez ceux qui bougent, puis touchez l'équipe gagnante.";
  const box = $("statues-teams");
  box.hidden = false;
  const key = `avant|${teams.map(([id, t]) => `${id}:${t.name}`).join("|")}`;
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
 * Le Duel des robots (cedric, 27/10) : la box prépare chaque duel (2 équipes, un joueur appelé de chaque) et garde
 * l'heure du PAN secrète, même pour la régie. Sarah lance le face-à-face, puis « ▶ Duel suivant ». Un duel à la volée
 * (2 équipes choisies) sert à une équipe qui n'a pas fini de jouer, ou à rejouer une paire.
 */
let duelChoix = null; // équipes choisies pour un duel à la volée (tableau d'uid), null = pas d'écran de choix
let duelStopArme = null;

function duelEtape(st) {
  const d = st.duel;
  if (st.kind !== "duel" || !d || (st.phase !== "question" && st.phase !== "closed")) return null;
  if (d.step === "standoff") duelChoix = null;
  return { d, choix: d.step === "standoff" ? null : duelChoix, equipes: Object.keys(live.teams ?? {}).length };
}

const duelNom = (id) => live.teams[id]?.name ?? "Une équipe";
const duelTemps = (ms) => `${(ms / 1000).toFixed(2).replace(".", ",")} s`;

function duelResultat(r) {
  if (!r) return "";
  if (r.early && r.winner) return `💥 ${duelNom(r.early)} a tiré trop tôt : ${duelNom(r.winner)} gagne le duel.`;
  if (r.early) return `💥 ${duelNom(r.early)} a tiré trop tôt.`;
  if (r.winner) return `🏆 ${duelNom(r.winner)} gagne le duel${r.ms != null ? ` en ${duelTemps(r.ms)}` : ""} !`;
  return "Personne n'a tiré ! Duel nul, aucun point.";
}

function renderDuel(st, teams) {
  const on = (st.phase === "question" || st.phase === "closed") && st.kind === "duel";
  $("duel").hidden = !on;
  if (!on) { duelChoix = null; clearTimeout(duelStopArme); duelStopArme = null; return; }
  const e = duelEtape(st);
  const d = e?.d ?? {};
  const busy = !!pending?.advance || st.paused === true;
  const paire = Array.isArray(d.teams) ? d.teams : Object.values(d.teams ?? {});
  const joueurs = Array.isArray(d.players) ? d.players : Object.values(d.players ?? {});
  const choix = e?.choix;
  const seule = teams.length < 2;
  $("duel-info").textContent = seule ? "Il faut au moins 2 équipes pour un duel : passez au jeu suivant."
    : choix ? "Qui affronte qui ? La paire proposée est cochée : touchez une équipe pour la changer."
      : d.step === "standoff" ? "🤠 Face-à-face… mains sur les buzzers ! Le PAN tombe quand la TV le décide."
        : d.step === "result" ? (d.allPlayed ? "Tous les joueurs sont passés." : `Duel ${d.n ?? 1} terminé.`)
          : `${d.extra ? "Duel en plus" : `Duel ${d.n ?? 1} sur ${d.total ?? "?"}`} : appelez les deux joueurs.`;
  // Les deux équipes face à face, dans leur couleur, avec le joueur appelé.
  const face = $("duel-face");
  face.hidden = seule || !!choix || !paire.length;
  const cle = JSON.stringify([paire, joueurs, paire.map((id) => [live.teams[id]?.name, live.teams[id]?.color])]);
  if (face.dataset.key !== cle) {
    face.dataset.key = cle;
    const carte = (id, i) => {
      const c = document.createElement("div");
      c.className = "duel-equipe";
      c.style.setProperty("--team", live.teams[id]?.color ?? "#fff");
      const nom = document.createElement("b");
      nom.textContent = duelNom(id);
      // Jamais de « joueur n° » : l'équipe joue, la rotation des enfants se fait entre eux (cedric, 31/10 au soir).
      c.append(nom);
      return c;
    };
    const vs = document.createElement("span");
    vs.className = "duel-vs";
    vs.textContent = "VS";
    face.replaceChildren(...paire.slice(0, 2).flatMap((id, i) => (i ? [vs, carte(id, i)] : [carte(id, i)])));
  }
  face.classList.toggle("en-cours", d.step === "standoff");
  // Résultat : bandeau dans la couleur de la gagnante.
  const res = $("duel-resultat");
  const r = d.step === "result" && !choix ? d.result : null;
  res.hidden = !r;
  res.textContent = duelResultat(r);
  if (r?.winner) res.style.setProperty("--team", live.teams[r.winner]?.color ?? "var(--gold)");
  else res.style.removeProperty("--team");
  // Choix de 2 équipes pour un duel à la volée.
  const box = $("duel-choix");
  box.hidden = !choix;
  const key = teams.map(([id, t]) => `${id}:${t.name}:${t.color}`).join("|");
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.replaceChildren(...teams.map(([id, t]) => {
      const b = document.createElement("button");
      b.className = "statues-tuile";
      b.dataset.team = id;
      b.style.setProperty("--team", t.color ?? "#fff");
      b.textContent = t.name;
      b.onclick = () => {
        if (!duelChoix) return;
        navigator.vibrate?.(30);
        duelChoix = duelChoix.includes(id) ? duelChoix.filter((x) => x !== id) : [...duelChoix, id].slice(-2);
        render();
      };
      return b;
    }));
  }
  box.classList.toggle("serree", teams.length > 4);
  box.querySelectorAll("button").forEach((b) => {
    const coche = !!choix?.includes(b.dataset.team);
    b.classList.toggle("cochee", coche);
    b.setAttribute("aria-pressed", String(coche));
    b.disabled = busy;
  });
  // Arrêter un face-à-face (buzzer en panne, enfant pas prêt) : deux appuis, jamais par erreur au moment du PAN.
  const stop = $("duel-stop");
  stop.hidden = d.step !== "standoff";
  stop.disabled = busy;
  stop.textContent = duelStopArme ? "Touchez encore : arrêter sans points" : "✋ Arrêter le face-à-face";
  if (d.step !== "standoff") { clearTimeout(duelStopArme); duelStopArme = null; }
  const pret = (d.step === "ready" || d.step === "result") && !choix && !seule;
  $("duel-autres").hidden = !pret;
  $("duel-autres").textContent = d.allPlayed && d.step === "result" ? "🤠 Duel en plus : choisir les 2 équipes" : "🎯 Choisir les 2 équipes";
  $("duel-autres").disabled = busy;
  $("duel-retour").hidden = !choix;
  // « Jeu suivant » au milieu (le gros bouton du bas lance les duels) tant qu'il reste des joueurs à faire passer.
  $("duel-fin").hidden = !pret || (d.step === "result" && !!d.allPlayed);
  $("duel-fin").disabled = busy;
  $("duel-points").textContent = `${st.double ? 200 : 100} points par duel gagné. Tirer avant le PAN fait perdre le duel.`;
}

/** Le gros bouton du bas : lancer le duel, puis le suivant ; tous les joueurs passés, le jeu suivant. */
function duelBoutonPrincipal(e, st) {
  const d = e.d;
  if (e.equipes < 2) return finDuelLabel(st);
  if (e.choix) return e.choix.length === 2 ? `🤠 ${duelNom(e.choix[0])} contre ${duelNom(e.choix[1])}` : "Touchez 2 équipes";
  if (d.step === "standoff") return "Face-à-face… 🤠";
  if (d.step === "result") return d.allPlayed ? finDuelLabel(st) : "▶ Duel suivant";
  return "🤠 Lancer le duel";
}

/** Fin du duel ou du Simon : le tableau des scores sur la TV (test du 28/10), puis « Jeu suivant » ; au dernier jeu, les résultats. */
function finDuelLabel(st) {
  return versClassement(st, "Voir les scores");
}

function duelPrincipal(e) {
  const d = e.d;
  navigator.vibrate?.(60);
  if (e.choix) {
    if (e.choix.length !== 2) return;
    const teams = e.choix;
    duelChoix = null;
    return send("duel_start", { teams }, { advance: true });
  }
  if (e.equipes < 2 || (d.step === "result" && d.allPlayed)) return send("next", {}, { advance: true });
  if (d.step === "result") return send("duel_next", {}, { advance: true });
  if (d.step === "ready") return send("duel_start", {}, { advance: true });
}

$("duel-stop").onclick = () => {
  if (!duelStopArme) {
    duelStopArme = setTimeout(() => { duelStopArme = null; render(); }, 4000);
    return render();
  }
  clearTimeout(duelStopArme);
  duelStopArme = null;
  send("duel_stop", {}, { advance: true }).then((r) => { if (r?.status === "applied") toast("Face-à-face arrêté, sans points : relancez quand les joueurs sont prêts."); });
};
$("duel-autres").onclick = () => { duelChoix = pairePropose(live.state?.duel ?? {}); render(); };

/**
 * Paire cochée d'avance dans le choix des équipes (cedric, 27/10) : le duel prêt proposé par la box ; après un duel,
 * comme la box, les 2 équipes qui ont le moins joué, sans redonner la même paire tout de suite. Sarah change si elle veut.
 */
function pairePropose(d) {
  const presentes = Object.keys(live.teams ?? {});
  const paire = (Array.isArray(d.teams) ? d.teams : Object.values(d.teams ?? {})).filter((id) => presentes.includes(id));
  if (d.step === "ready" && paire.length === 2) return paire;
  const joues = d.played ?? {};
  const ordre = presentes.map((id, i) => [id, joues[id] ?? 0, i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([id]) => id);
  if (ordre.length < 2) return [];
  const meme = (a, b) => paire.length === 2 && paire.includes(a) && paire.includes(b);
  for (let i = 0; i < ordre.length; i++) {
    for (let j = i + 1; j < ordre.length; j++) {
      if (ordre.length === 2 || !meme(ordre[i], ordre[j])) return [ordre[i], ordre[j]];
    }
  }
  return ordre.slice(0, 2);
}
$("duel-retour").onclick = () => { duelChoix = null; render(); };
$("duel-fin").onclick = async () => {
  const d = live.state?.duel ?? {};
  const reste = d.allPlayed ? 0 : Math.max(0, (d.total ?? 0) - (d.n ?? 0) + (d.step === "ready" ? 1 : 0));
  const ok = await demander({
    title: "Arrêter les duels ?",
    text: reste ? `${reste} duel${reste > 1 ? "s" : ""} prévu${reste > 1 ? "s" : ""} pas encore joué${reste > 1 ? "s" : ""} : certains joueurs ne seront pas passés.` : "",
    ok: "⏭ Jeu suivant",
  });
  if (ok && duelEtape(live.state ?? {})) send("next", {}, { advance: true });
};

/**
 * Le Simon de Buzzy (cedric, 27/10) : la box tient la suite secrète et juge ; Sarah lance chaque suite, l'arrête si
 * un enfant n'est pas prêt, puis passe à la suite ou au tour suivant. La TV vérifie colonne par colonne avant le
 * bandeau : le bouton suivant attend la fin de cette vérification.
 */
let simonStopArme = null;
let simonMinuteur = null;
const SIMON_COLONNE_MS = 700;
const SIMON_BANDEAU_MS = 1500;
const SIMON_BOULES = { rouge: "🔴", vert: "🟢", bleu: "🔵", jaune: "🟡", orange: "🟠", violet: "🟣", rose: "🩷", blanc: "⚪" };

function simonEtape(st) {
  const s = st.simon;
  if (st.kind !== "simon" || !s || (st.phase !== "question" && st.phase !== "closed")) return null;
  const v = s.verdict;
  const verif = (s.step === "judged" || s.step === "won") && v?.at ? v.at + (v.suite ?? s.suite ?? 0) * SIMON_COLONNE_MS + SIMON_BANDEAU_MS - (Date.now() + serverOffset) : 0;
  return { s, verif };
}

const simonListe = (x) => (Array.isArray(x) ? x : Object.values(x ?? {}));
const simonSuite = (texte) => String(texte ?? "").split(",").filter(Boolean).map((x) => SIMON_BOULES[x.trim()] ?? x.trim()).join(" ");

function renderSimon(st) {
  const on = (st.phase === "question" || st.phase === "closed") && st.kind === "simon";
  $("simon").hidden = !on;
  clearTimeout(simonMinuteur);
  if (!on) { clearTimeout(simonStopArme); simonStopArme = null; return; }
  const e = simonEtape(st);
  const s = e?.s ?? { step: "none" };
  const busy = !!pending?.advance || st.paused === true;
  const name = (id) => live.teams[id]?.name ?? "Une équipe";
  const v = s.verdict;
  const tour = (s.tours ?? 1) > 1 ? `Tour ${s.tour ?? 1} sur ${s.tours}. ` : "";
  const reste = s.step === "play" && s.finAt ? Math.ceil((s.finAt - (Date.now() + serverOffset)) / 1000) : 0;
  $("simon-info").textContent = s.step === "none" ? "Le robot prof prépare sa première suite…"
    : s.step === "ready" ? `${tour}Suite de ${s.suite ?? 1} : appelez le joueur de chaque équipe.`
      : s.step === "play" ? `${tour}🔴 Suite de ${s.suite ?? 1} en cours${reste > 0 ? ` : fin du chrono dans ${reste} s` : ""}.`
        : e.verif > 0 ? "Vérification sur la TV…"
          : s.step === "won" ? `${tour}🏆 ${simonListe(v?.winners).map(name).join(", ") || "Personne"} ${simonListe(v?.winners).length > 1 ? "gagnent" : "gagne"} le tour.`
            : v?.bahAlors ? "Bah alors ! Toutes les équipes se sont trompées : la même suite se rejoue."
              : `${tour}Suite réussie : la suivante aura ${s.suite ?? ""} éléments.`;
  // Bilan de la suite jugée : la bonne suite, et qui s'est trompé.
  const verdict = $("simon-verdict");
  const voir = (s.step === "judged" || s.step === "won") && v && e.verif <= 0;
  verdict.hidden = !voir;
  if (voir) {
    const faux = simonListe(v.wrong);
    verdict.textContent = `Bonne suite : ${simonSuite(v.solution)}${faux.length ? ` · Erreur : ${faux.map(name).join(", ")}` : ""}`;
  }
  // Les équipes du tour : en jeu ou éliminée, et le joueur appelé.
  const out = s.out ?? {};
  const gagnantes = s.step === "won" ? simonListe(v?.winners) : [];
  const lignes = simonListe(s.teams).map((id) => {
    const li = document.createElement("li");
    li.style.setProperty("--team", live.teams[id]?.color ?? "#fff");
    li.classList.toggle("eliminee", out[id] != null);
    const nom = document.createElement("b");
    nom.textContent = name(id);
    const etat = document.createElement("span");
    etat.textContent = gagnantes.includes(id) ? "🏆 gagne le tour"
      : out[id] != null ? `éliminée (suite de ${out[id]})`
        : "en jeu";
    li.append(nom, etat);
    return li;
  });
  const liste = $("simon-equipes");
  const cle = lignes.map((li) => li.textContent + li.className).join("|");
  if (liste.dataset.key !== cle) { liste.dataset.key = cle; liste.replaceChildren(...lignes); }
  // Arrêter une suite (enfant pas prêt, tablette en panne) : deux appuis, personne n'est éliminé.
  const stop = $("simon-stop");
  stop.hidden = s.step !== "play";
  stop.disabled = busy;
  stop.textContent = simonStopArme ? "Touchez encore : arrêter, personne n'est éliminé" : "✋ Arrêter la suite";
  if (s.step !== "play") { clearTimeout(simonStopArme); simonStopArme = null; }
  $("simon-fin").hidden = !["ready", "judged", "won"].includes(s.step) || (s.step === "won" && s.last === true);
  $("simon-fin").disabled = busy;
  $("simon-points").textContent = `${st.double ? 600 : 300} points pour l'équipe qui gagne le tour.`;
  // Chrono qui défile, puis bouton suivant à la fin de la vérification à la TV.
  if (s.step === "play" && reste > 0) simonMinuteur = setTimeout(render, 1000);
  else if (e && e.verif > 0) simonMinuteur = setTimeout(render, e.verif + 50);
}

function simonBoutonPrincipal(e, st) {
  const s = e.s;
  if (s.step === "none") return "Le robot prof se prépare…";
  if (s.step === "play") return "Suite en cours… 🔴";
  if (e.verif > 0) return "Vérification à la TV…";
  if (s.step === "ready") return `▶ Lancer la suite de ${s.suite ?? 1}`;
  if (s.step === "judged") return s.verdict?.bahAlors ? "▶ Relancer la suite" : `▶ Suite suivante (${s.suite ?? ""} éléments)`;
  if (s.step === "won") return s.last === true ? finDuelLabel(st) : `▶ Tour suivant (${(s.tour ?? 1) + 1} / ${s.tours ?? 1})`;
  return finDuelLabel(st);
}

function simonPrincipal(e) {
  const s = e.s;
  if (s.step === "play" || s.step === "none" || e.verif > 0) return;
  navigator.vibrate?.(60);
  if (s.step === "won" && s.last === true) return send("next", {}, { advance: true });
  return send("simon_go", {}, { advance: true });
}

$("simon-stop").onclick = () => {
  if (!simonStopArme) {
    simonStopArme = setTimeout(() => { simonStopArme = null; render(); }, 4000);
    return render();
  }
  clearTimeout(simonStopArme);
  simonStopArme = null;
  send("simon_stop", {}, { advance: true }).then((r) => { if (r?.status === "applied") toast("Suite arrêtée, personne n'est éliminé : relancez quand les joueurs sont prêts."); });
};
$("simon-fin").onclick = async () => {
  const s = live.state?.simon ?? {};
  const restent = Math.max(0, (s.tours ?? 1) - (s.tour ?? 1) + (s.step === "won" ? 0 : 1));
  const ok = await demander({
    title: "Arrêter le Simon de Buzzy ?",
    text: restent ? `${restent} tour${restent > 1 ? "s" : ""} pas encore gagné${restent > 1 ? "s" : ""}.` : "",
    ok: "⏭ Jeu suivant",
  });
  if (ok && simonEtape(live.state ?? {})) send("next", {}, { advance: true });
};

/**
 * ⏱️ Le Chrono de Buzzy (cedric, 30/10) : Sarah règle la cible (− / +) avant chaque tour et lance le chrono ; la box reçoit
 * les buzz et révèle seule quand toutes les équipes ont buzzé (ou 15 s après la cible). La régie ne voit jamais l'heure
 * des buzz avant la révélation, seulement qui a buzzé.
 */
let chronoStopArme = null;
let chronoMinuteur = null;
let chronoCibleEnvoi = null; // cible tapée, pas encore confirmée par la box (plusieurs appuis rapides s'additionnent)
const chronoListe = (x) => (Array.isArray(x) ? x : Object.values(x ?? {}));
const chronoEcart = (ms) => `${ms > 0 ? "+" : ms < 0 ? "−" : ""}${(Math.abs(ms) / 1000).toFixed(2).replace(".", ",")} s`;

function chronoEtape(st) {
  const c = st.chrono;
  if (st.kind !== "chrono" || !c || (st.phase !== "question" && st.phase !== "closed")) return null;
  return { c };
}

function renderChrono(st) {
  const on = (st.phase === "question" || st.phase === "closed") && st.kind === "chrono";
  $("chrono").hidden = !on;
  clearTimeout(chronoMinuteur);
  if (!on) { clearTimeout(chronoStopArme); chronoStopArme = null; chronoCibleEnvoi = null; return; }
  const c = st.chrono ?? { step: "none" };
  if (chronoCibleEnvoi === c.cible || c.step !== "ready") chronoCibleEnvoi = null;
  const cible = chronoCibleEnvoi ?? c.cible ?? 30;
  const busy = !!pending?.advance || st.paused === true;
  const name = (id) => live.teams[id]?.name ?? "Une équipe";
  const tour = (c.tours ?? 1) > 1 ? `Tour ${c.tour ?? 1} sur ${c.tours}. ` : "";
  const maintenant = Date.now() + serverOffset;
  const cibleAt = typeof c.goAt === "number" ? c.goAt + (c.cible ?? 30) * 1000 : null;
  const buzzees = chronoListe(c.buzzed);
  const equipes = chronoListe(c.teams);
  const res = c.result ?? {};
  const gagnantes = chronoListe(res.winners);
  $("chrono-info").textContent = c.step === "none" ? "Le Chrono de Buzzy se prépare…"
    : c.step === "ready" ? `${tour}Cible : ${cible} secondes. Réglez-la, puis lancez le chrono.`
      : c.step === "run" ? (c.goAt > maintenant ? `${tour}3, 2, 1… le chrono part !`
        : c.reveler === true ? `${tour}Toutes les équipes ont buzzé : touchez « 👀 Révéler » quand vous voulez.`
          : `${tour}⏱️ Chrono en cours, cible ${c.cible} s : ${buzzees.length} / ${equipes.length} équipes ont buzzé.`)
        : gagnantes.length ? `${tour}🏆 ${gagnantes.map(name).join(", ")} ${gagnantes.length > 1 ? "gagnent" : "gagne"} le tour.`
          : `${tour}Personne n'a buzzé : aucun point.`;
  // Réglage de la cible, seulement quand le tour est prêt.
  $("chrono-reglage").hidden = c.step !== "ready";
  $("chrono-cible").textContent = `${cible} s`;
  $("chrono-reglage").querySelectorAll("button").forEach((b) => {
    const v = cible + Number(b.dataset.pas);
    b.disabled = busy || v < 10 || v > 90;
  });
  // Les équipes : a buzzé ou pas (jamais l'heure avant la révélation), puis leur écart, la plus proche d'abord.
  const ecarts = res.ecarts ?? {};
  const ids = c.step === "result"
    ? Object.keys(live.teams ?? {}).sort((a, b) => Math.abs(ecarts[a] ?? 1e9) - Math.abs(ecarts[b] ?? 1e9))
    : c.step === "run" ? equipes : [];
  const lignes = ids.map((id) => {
    const li = document.createElement("li");
    li.style.setProperty("--team", live.teams[id]?.color ?? "#fff");
    const nom = document.createElement("b");
    nom.textContent = name(id);
    const etat = document.createElement("span");
    if (c.step === "result") {
      const gain = res.gains?.[id];
      etat.textContent = typeof ecarts[id] === "number" ? `${gagnantes.includes(id) ? "🏆 " : ""}${chronoEcart(ecarts[id])}${gain ? ` · +${gain}` : ""}` : "pas de buzz";
      li.classList.toggle("eliminee", typeof ecarts[id] !== "number");
    } else {
      etat.textContent = buzzees.includes(id) ? "✅ a buzzé" : "compte…";
    }
    li.append(nom, etat);
    return li;
  });
  const liste = $("chrono-equipes");
  const cle = lignes.map((li) => li.textContent + li.className).join("|");
  if (liste.dataset.key !== cle) { liste.dataset.key = cle; liste.replaceChildren(...lignes); }
  // Le bilan attend toujours Sarah (cedric, 31/10) : « 👀 Révéler » en gros bouton quand toutes ont buzzé ; sinon,
  // une fois la cible passée, révéler sans attendre une équipe qui ne buzze pas.
  const reveler = $("chrono-reveler");
  reveler.hidden = c.step !== "run" || c.reveler === true || !cibleAt || maintenant < cibleAt;
  reveler.disabled = busy;
  const stop = $("chrono-stop");
  stop.hidden = c.step !== "run";
  stop.disabled = busy;
  stop.textContent = chronoStopArme ? "Touchez encore : arrêter, sans points" : "✋ Arrêter le tour";
  if (c.step !== "run") { clearTimeout(chronoStopArme); chronoStopArme = null; }
  $("chrono-fin").hidden = !["ready", "result"].includes(c.step) || (c.step === "result" && c.last === true);
  $("chrono-fin").disabled = busy;
  $("chrono-points").textContent = st.double ? "200, 100 et 50 points pour les 3 équipes les plus proches de la cible." : "100, 50 et 25 points pour les 3 équipes les plus proches de la cible.";
  // Le « Révéler » apparaît à l'heure de la cible ; le décompte se met à jour.
  if (c.step === "run") chronoMinuteur = setTimeout(render, 1000);
}

function chronoBoutonPrincipal(e, st) {
  const c = e.c;
  if (c.step === "none") return "Le Chrono de Buzzy se prépare…";
  if (c.step === "run") return c.reveler === true ? "👀 Révéler" : "Chrono en cours… ⏱️";
  if (c.step === "ready") return `⏱️ Lancer le chrono (${chronoCibleEnvoi ?? c.cible ?? 30} s)`;
  if (c.step === "result") return c.last === true ? finDuelLabel(st) : `▶ Tour suivant (${(c.tour ?? 1) + 1} / ${c.tours ?? 1})`;
  return finDuelLabel(st);
}

function chronoPrincipal(e) {
  const c = e.c;
  if ((c.step === "run" && c.reveler !== true) || c.step === "none") return;
  navigator.vibrate?.(60);
  if (c.step === "run") return send("chrono_reveal", {}, { advance: true });
  if (c.step === "result" && c.last === true) return send("next", {}, { advance: true });
  return send("chrono_go", {}, { advance: true });
}

$("chrono-reglage").querySelectorAll("button").forEach((b) => {
  b.onclick = () => {
    const c = live.state?.chrono ?? {};
    if (c.step !== "ready") return;
    const v = Math.min(90, Math.max(10, (chronoCibleEnvoi ?? c.cible ?? 30) + Number(b.dataset.pas)));
    chronoCibleEnvoi = v;
    render();
    send("chrono_cible", { cible: v }, { advance: true }).then((r) => {
      if (r?.status !== "applied" && chronoCibleEnvoi === v) { chronoCibleEnvoi = null; render(); }
    });
  };
});
$("chrono-reveler").onclick = () => {
  send("chrono_reveal", {}, { advance: true }).then((r) => { if (r && r.status !== "applied") toast("Trop tôt : attendez que la cible soit passée."); });
};
$("chrono-stop").onclick = () => {
  if (!chronoStopArme) {
    chronoStopArme = setTimeout(() => { chronoStopArme = null; render(); }, 4000);
    return render();
  }
  clearTimeout(chronoStopArme);
  chronoStopArme = null;
  send("chrono_stop", {}, { advance: true }).then((r) => { if (r?.status === "applied") toast("Tour arrêté, sans points : relancez quand les équipes sont prêtes."); });
};
$("chrono-fin").onclick = async () => {
  const c = live.state?.chrono ?? {};
  const restent = Math.max(0, (c.tours ?? 1) - (c.tour ?? 1) + (c.step === "result" ? 0 : 1));
  const ok = await demander({
    title: "Arrêter le Chrono de Buzzy ?",
    text: restent ? `${restent} tour${restent > 1 ? "s" : ""} pas encore joué${restent > 1 ? "s" : ""}.` : "",
    ok: "⏭ Jeu suivant",
  });
  if (ok && chronoEtape(live.state ?? {})) send("next", {}, { advance: true });
};

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
    ? opened.slice(-4).map((o) => `${name(o.team)} : ${o.bomb ? "💣" : `${o.gold === true ? "⭐ " : ""}${o.delta < 0 ? "−" : "+"}${Math.abs(o.delta)}`}`).join(" · ")
    : `${c.count ?? 0} coffres fermés.`;
  const btn = $("coffres-random");
  const wait = (c.readyAt ?? 0) - (Date.now() + serverOffset);
  btn.disabled = c.ready !== true || !c.team || !!pending?.advance || st.paused === true || wait > 0;
  clearTimeout(coffresPret);
  if (wait > 0) coffresPret = setTimeout(render, wait + 50);
  btn.textContent = coffresArme ? `Touchez encore : coffre au hasard pour ${name(c.team)}` : `🎲 Ouvrir un coffre au hasard pour ${name(c.team)}`;
  // Le gros bouton attend la bombe ; celui-ci passe au jeu suivant tout de suite, après confirmation (points gardés).
  const { next } = gamesOf(st);
  const fin = $("coffres-fin");
  fin.hidden = !next;
  fin.disabled = !!pending?.advance;
  if (next) fin.onclick = () => jumpTo(next, live.state ?? st);
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
  const derniere = (p.bomb ?? 1) >= (p.bombs ?? 1);
  $("patate-info").textContent = p.lit !== true ? "La mèche s'allume sur la TV…"
    : p.exploded === true ? `💥 BOUM chez ${name(boom?.holder)} ! ${derniere ? "C'était la dernière bombe : le bilan arrive." : `La bombe ${(p.bomb ?? 1) + 1} s'allume…`}`
      : `${numero}💣 La bombe est chez ${name(p.holder)}${p.from ? ` (envoyée par ${name(p.from)})` : ""}. ${p.passes ?? 0} envoi${(p.passes ?? 0) > 1 ? "s" : ""}.`
        + (pas.length ? ` Pas encore touchées : ${pas.map(name).join(", ")}.` : " Toutes les équipes l'ont eue.")
        + (booms.length ? ` Déjà explosées chez : ${booms.map((x) => name(x.holder)).join(", ")}.` : "");
  const btn = $("patate-random");
  const wait = Math.max(p.readyAt ?? 0, st.resumeAt ?? 0) - (Date.now() + serverOffset);
  btn.disabled = p.lit !== true || p.exploded === true || !!pending?.advance || st.paused === true || wait > 0;
  clearTimeout(patatePret);
  if (wait > 0) patatePret = setTimeout(render, wait + 50);
  btn.textContent = patateArme ? `Touchez encore : la bombe part de chez ${name(p.holder)}` : `🎲 Envoyer la bombe au hasard pour ${name(p.holder)}`;
  // Finir le jeu sans jouer toutes les bombes (cedric, 26/10), seulement avec une box qui le sait (patateStop).
  // Entre deux bombes (BOUM affiché, ou la suivante allumée mais pas encore partie) : « ⏭ Jeu suivant », bilan tout de
  // suite. Pendant une bombe qui n'est pas la dernière : « 🏁 Dernière bombe ».
  const maintenant = Date.now() + serverOffset;
  const entreDeux = p.lit === true && p.exploded !== true && (p.bomb ?? 1) > 1 && booms.length === (p.bomb ?? 1) - 1 && (p.since ?? 0) > maintenant;
  const apresBoum = p.lit === true && p.exploded === true && !derniere;
  const pendant = p.lit === true && p.exploded !== true && !entreDeux && !derniere;
  const stop = $("patate-stop");
  stop.hidden = live.plan?.patateStop !== true || !(entreDeux || apresBoum || pendant);
  stop.textContent = pendant ? "🏁 Dernière bombe" : "⏭ Jeu suivant";
  stop.disabled = !!pending?.advance || st.paused === true;
  clearTimeout(patateEntreDeux);
  if (entreDeux) patateEntreDeux = setTimeout(render, p.since - maintenant + 50);
}
let patateEntreDeux = null;
$("patate-stop").onclick = async () => {
  const p = live.state?.potato ?? {};
  const dernierePendant = $("patate-stop").textContent.startsWith("🏁");
  navigator.vibrate?.(60);
  const r = await send("potato_stop", {}, { advance: true });
  if (r?.status === "applied") toast(dernierePendant ? `La bombe ${p.bomb ?? ""} est la dernière : bilan après son explosion.` : "Fin du jeu : le bilan s'affiche sur la TV.");
};
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

$("flou-ok").onclick = () => { navigator.vibrate?.(60); flashVerdict(true); send("buzz_ok", {}, { advance: true }); };
$("flou-ko").onclick = () => { flashVerdict(false); send("buzz_ko", {}, { advance: true }); };
$("flou-bonus").onclick = () => { navigator.vibrate?.(60); flashVerdict(true); send("buzz_bonus", {}, { advance: true }); };

$("mime-go").onclick = () => {
  if (!mimeTeam) return;
  const m = live.state?.mime;
  if (live.state?.kind !== "pictionary") send("mime_start", { team: mimeTeam }, { advance: true });
  else if (m?.secret && m.secret === mimeTeam) send("picto_draw", {}, { advance: true });
  else send("picto_show", { team: mimeTeam }, { advance: true });
};
$("mime-found").onclick = () => { navigator.vibrate?.(60); send("mime_found", {}, { advance: true }); };
$("mime-pass").onclick = () => send("mime_pass", {}, { advance: true });
$("mime-skip").onclick = () => { navigator.vibrate?.(30); send("mime_skip", {}, { advance: true }); };
$("mime-minus").onclick = () => { const t = live.state?.mime?.team; if (t) send("mime_fix", { team: t, delta: -1 }); };
$("mime-fix-minus").onclick = () => { const t = live.state?.mime?.last?.team; if (t) send("mime_fix", { team: t, delta: -1 }); };
$("mime-fix-plus").onclick = () => { const t = live.state?.mime?.last?.team; if (t) send("mime_fix", { team: t, delta: 1 }); };

/**
 * Équipes inscrites qui ne sont pas encore passées dans la manche de mimes en cours. Manche d'une seule équipe
 * (« Équipe Rose », cedric 23/10) : seulement l'équipe de cette couleur.
 */
function mimeRemaining(st) {
  const turns = st.mime?.turns ?? [];
  const seule = equipesDeLaCouleur(st);
  return Object.entries(live.teams)
    .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0))
    .map(([id]) => id)
    .filter((id) => !turns.includes(id) && (!seule || seule.includes(id)));
}

/**
 * Mimes, une manche par équipe (cedric, 23/10 : chaque équipe a sa présélection d'images) : les équipes inscrites de la
 * couleur de la manche en cours (« Équipe Rose »), [] si aucune ; null pour une manche de mimes jouée par toutes.
 */
function equipesDeLaCouleur(st) {
  if (st?.kind === "pictionary") return null;
  const c = couleurMimeEquipe(st?.text ?? live.plan?.questions?.[st?.index]?.text);
  if (!c) return null;
  return Object.entries(live.teams).filter(([, t]) => `${t?.color ?? ""}`.toUpperCase() === c.toUpperCase()).map(([id]) => id);
}

/**
 * Mimes en file (cedric, 26/10), une manche par couleur : l'équipe dont le tour part au bouton principal, ou null.
 * Présentation des Mimes (ou manche ouverte sans tour) : celle de la couleur, « ▶ Lancer l'épreuve » montre tout de
 * suite sa première image. Bilan des scores d'une couleur : celle de la couleur suivante, sa manche s'ouvre avec son
 * tour. Sans équipe inscrite de cette couleur : null, le bouton garde son rôle habituel.
 */
function mimeEnFile(st) {
  // Une box d'avant le 26/10 ne sait pas lancer le tour depuis la présentation : déroulé habituel.
  if (!st || st.paused || live.plan?.mimesEnFile !== true) return null;
  const questions = live.plan?.questions ?? [];
  const ici = questions[st.index];
  const equipe = (q) => {
    const c = q?.kind === "mime" ? couleurMimeEquipe(q.text) : null;
    return c ? Object.entries(live.teams).find(([, t]) => `${t?.color ?? ""}`.toUpperCase() === c.toUpperCase())?.[0] ?? null : null;
  };
  if (st.phase === "intro" || (st.phase === "question" && st.mime && !st.mime.team && !(st.mime.turns ?? []).length)) return equipe(ici);
  const suivante = questions[(st.index ?? -1) + 1];
  if (st.phase === "scores" && st.leaveTo == null && ici?.kind === "mime" && couleurMimeEquipe(ici.text) && suivante?.round === ici.round) return equipe(suivante);
  return null;
}

/** « l'équipe Rose » : le titre d'une manche de mimes d'une seule équipe, dans une phrase. */
function lEquipe(text) {
  const t = `${text ?? ""}`;
  return `l'${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}

// ---------- Jeux de la prestation : en cours, suivant, secours ----------


/** Jeux (manches) du conducteur, celui en cours et le suivant. */
function gamesOf(st) {
  const questions = live.plan?.questions ?? [];
  const rounds = programRounds(questions);
  const index = st.phase === "lobby" ? -1 : st.index ?? -1;
  const current = st.phase === "ended" ? null : rounds.find((r) => r.start <= index && index <= r.end) ?? null;
  // Après la fin de la partie, un jeu ajouté au programme est encore « à venir » : la partie peut reprendre avec lui.
  // Bilan d'un jeu quitté en cours de route : la suite est le jeu choisi par la régie.
  const next = (st.phase === "scores" && st.leaveTo != null ? rounds.find((r) => r.start === st.leaveTo) : null)
    ?? rounds.find((r) => r.start > index) ?? null;
  return { questions, rounds, index, current, next };
}

/** Le jeu en cours a commencé (ni présentation, ni classement) : le quitter passe par le bilan des scores sur la TV. */
const jeuEnCours = (st) => ["question", "closed", "reveal"].includes(st.phase);

/** Jeu déjà commencé (ou joué) : y aller, c'est le recommencer. */
const played = (r, st, index) => r.start <= index && st.phase !== "lobby";

function gameName(r, questions) {
  const q = questions[r.start];
  // Mimes, une manche par équipe (cedric, 23/10) : un seul jeu, « Mimes ».
  return q?.kind === "mime" ? (couleurMimeEquipe(q.text) ? "Mimes" : `Mimes : ${q.text}`) : q?.kind === "pictionary" ? "Pictionary" : r.title;
}

function gameDetail(r, questions) {
  const q = questions[r.start];
  if (q?.kind === "mime" && couleurMimeEquipe(q.text)) {
    const k = r.end - r.start + 1;
    return `une manche par équipe (${k}) · ${q.cards?.length ?? 0} images chacune · tour de ${q.duration} s`;
  }
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
  // « ↺ Relancer ce jeu » (cedric, 30/10) : le jeu en cours repart à zéro d'un seul geste, pendant un jeu seulement.
  $("c-recommencer").hidden = st.phase === "lobby" || !current || !live.plan?.rev;
  $("c-recommencer").disabled = editing;
}

/** La TV joue son quiz de démonstration : aucune prestation n'a été chargée. */
const isDemo = () => live.plan?.id === "demo";

/**
 * Quiz de démonstration en cours : la régie dit clairement qu'aucune prestation n'est chargée et comment
 * en lancer une (une prestation ne se charge qu'au salon d'attente, avant « Lancer la fête ! »).
 */
function renderDemo(st) {
  const box = $("c-demo");
  // TV déjà partie vers une nouvelle partie : la régie la suit, plus rien à expliquer ici.
  box.hidden = !isDemo() || !!st.leftAt;
  if (box.hidden) return;
  box.textContent = st.phase === "lobby"
    ? "Aucune prestation chargée : la TV jouera son quiz de démonstration. Choisissez la prestation dans l'onglet « Prestation » avant de lancer la fête."
    : st.phase === "ended"
    ? "La TV a joué son quiz de démonstration. Pour jouer une prestation : « 🏁 Fin de la fête », puis choisissez-la dans la liste qui s'ouvre."
    : "La TV joue son quiz de démonstration, pas une prestation. Pour jouer une prestation : sur la TV, touche Retour → « Terminer et lancer une nouvelle partie », puis choisissez-la dans l'onglet « Prestation » de la régie.";
}

/** Saut vers le début du jeu [r], après confirmation adaptée (aller plus loin, ou recommencer). */
async function jumpTo(r, st, pasCharge = false) {
  const { questions, index, current } = gamesOf(st);
  const name = gameName(r, questions);
  const replay = played(r, st, index);
  // Quitter le jeu en cours pour un autre (cedric, 24/10) : la TV montre d'abord le bilan des scores. Pas pour le jeu en
  // cours qu'on recommence (cedric, 30/10) : ses points sont effacés, il repart directement sur sa présentation.
  const bilan = jeuEnCours(st) && r.start !== current?.start;
  const ok = await demander(replay
    ? { title: `Recommencer « ${name} » ?`, attention: "Ce jeu repart à zéro : les points gagnés pendant ce jeu sont effacés.", text: `Le jeu repart de sa première question, avec les mêmes questions. Les points gagnés dans ce jeu sont retirés puis rejoués : rien n'est compté deux fois. Les équipes et les points des autres jeux sont gardés.${bilan ? " La TV montre d'abord le bilan des scores du jeu en cours." : " La TV repart sur la présentation du jeu, puis « ▶ Lancer l'épreuve »."}`, ok: "Recommencer ce jeu", alert: true }
    // « ▶ Y aller » du Conducteur (cedric, 30/10) : « Êtes-vous sûr ? » Oui / Non.
    : { ...SUR, line: `Vous allez passer à «\u00a0${name}\u00a0».`, warn: pasCharge ? "⚠ Ce jeu n'est pas encore chargé dans la box : des photos ou des musiques peuvent manquer. Lancer quand même ?" : "", text: st.phase === "ended" ? "La partie reprend avec ce jeu. Les équipes et leurs points sont gardés." : `Le jeu en cours s'arrête là, ses points déjà gagnés sont gardés.${bilan ? ` La TV montre le bilan des scores, puis « ${name} » quand vous appuyez sur « Jeu suivant ».` : ""} Si « ${name} » avait déjà été commencé, il repart de zéro sans compter deux fois.` });
  if (!ok) return;
  // Photos et extraits du jeu recopiés dans la partie s'ils y manquent (copies effacées après la fête, partie reprise
  // sur une autre box) : jamais bloquant, une copie déjà là n'est pas refaite.
  const jeu = questions.slice(r.start, r.end + 1);
  copyImages(jeu).catch((e) => console.warn("Illustrations non recopiées", e));
  copySounds(jeu);
  const status = await send("goto", { index: r.start, qid: questions[r.start].id }, { advance: true });
  if (status?.status === "applied") {
    // Retour à la régie : Sarah voit aussitôt le bouton qui lance le jeu choisi.
    fermerConducteur();
    toast(bilan ? `Bilan des scores sur la TV, puis « ${name} ».` : replay ? `« ${name} » recommence.` : `C'est parti pour « ${name} » !`);
    render();
  }
}

$("c-recommencer").onclick = () => {
  const st = live.state ?? {};
  const { current } = gamesOf(st);
  if (current && !pending?.advance) jumpTo(current, st);
};
$("c-add").onclick = () => openLibrary();

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
      // Le second appui d'un double appui sur un montant tombe ici, sous la fenêtre fermée : il ne la rouvre pas.
      row.querySelector(".pts-open").onclick = (e) => { if (e.detail < 2) choosePoints(id); };
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
/**
 * Jeu déjà commencé pendant la partie (jeu en cours compris). Une TV à jour publie la première question de chaque jeu
 * commencé (state.jeuxCommences) : un jeu sauté avec ▶ reste « pas encore joué », même au-dessus du jeu en cours.
 * Sans cette liste (TV d'avant) : tout jeu jusqu'au jeu en cours compte comme commencé.
 */
function jeuCommence(r, questions, st) {
  if (st.phase === "lobby") return false;
  const index = st.index ?? -1;
  if (r.start <= index && index <= r.end && st.phase !== "ended") return true;
  if (Array.isArray(st.jeuxCommences)) return st.jeuxCommences.includes(questions[r.start]?.id);
  return r.start <= lockedUntil(questions, index);
}

/**
 * Voyant d'un jeu du conducteur (cedric, 30/10) : ses photos et musiques sont-elles dans la box ? La box marque chaque
 * média dans games/<code>/media/<id> (« ok », « loading », « missing »). Vert : tout est là (ou rien à charger) ;
 * rouge : il en manque ; orange : en chargement. Une box qui ne marque pas encore les photos : seuls les sons comptent.
 */
function voyantDuJeu(qs) {
  const media = live.media ?? {};
  const sons = (q) => [q.audioId, q.refrainId, ...(Array.isArray(q.audioIds) ? q.audioIds : []), ...(Array.isArray(q.songs) ? q.songs.map((x) => x?.songId) : [])];
  const photos = (q) => [q.imageId, ...(Array.isArray(q.choiceImages) ? q.choiceImages : []), ...(Array.isArray(q.cards) ? q.cards.map((c) => c?.imageId) : [])];
  const marquePhotos = (live.plan?.questions ?? []).some((q) => q && photos(q).some((id) => id && media[id] != null));
  const ids = new Set(qs.filter(Boolean).flatMap((q) => [...sons(q), ...(marquePhotos ? photos(q) : [])]).filter(Boolean));
  const etats = [...ids].map((id) => media[id]);
  if (etats.includes("missing")) return "rouge";
  return etats.every((v) => v === "ok") ? "vert" : "orange";
}

const VOYANTS = { vert: "Photos et musiques chargées dans la box", orange: "Photos et musiques en cours de chargement dans la box", rouge: "Il manque des photos ou des musiques de ce jeu dans la box" };

/** Jeux dépliés dans le conducteur (cedric, 30/10 : tous repliés d'office, ▸ montre les questions). */
const jeuxDeplies = new Set();

function renderPlan(st) {
  const box = $("panel-plan");
  if (glisse) return;
  const plan = live.plan;
  const questions = plan?.questions ?? [];
  const index = st.phase === "lobby" ? -1 : st.index ?? -1;
  const key = JSON.stringify([plan?.title, plan?.rev, questions.map((q) => q.id ?? q.text), index, st.phase, editing, !!pending?.advance, mayReplaceShow(st), [...jeuxDeplies], st.jeuxCommences ?? null,
    programRounds(questions).map((r) => voyantDuJeu(questions.slice(r.start, r.end + 1)))]);
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
      box.insertAdjacentHTML("beforeend", '<p class="hint plan-aide">Appui long sur un jeu à venir pour le déplacer.</p>');
    } else {
      box.insertAdjacentHTML("beforeend", '<p class="hint">Pour ajouter un jeu en cours de partie, mettez à jour l\'appli de la TV.</p>');
    }
  }
  const rounds = programRounds(questions);
  // Jeux jamais commencés (à venir, ou sautés avec ▶) : ceux-là seulement se modifient, se déplacent, se retirent.
  const future = rounds.filter((r) => questions[r.start].round && !jeuCommence(r, questions, st));
  rounds.forEach((r) => {
    const items = [];
    for (let i = r.start; i <= r.end; i++) items.push(planItem(questions[i], i, st.index));
    // Questions sans jeu (quiz de démonstration) : la liste telle quelle.
    if (!questions[r.start].round) return box.append(...items);
    const jeu = document.createElement("div");
    // Deux couleurs seulement (cedric, 30/10) : joué, ou pas encore joué ; le jeu en cours mis en évidence.
    const enCours = r.start <= index && index <= r.end && st.phase !== "ended" && st.phase !== "lobby";
    jeu.className = `plan-jeu${enCours ? " en-cours" : jeuCommence(r, questions, st) ? " joue" : " a-jouer"}`;
    jeu.dataset.start = r.start;
    const liste = document.createElement("div");
    liste.className = "plan-questions";
    liste.hidden = !jeuxDeplies.has(r.title);
    // Choix A (cedric, 30/10) : un jeu pas encore joué se modifie avec la carte de « ＋ Jeu » (celle de la Régie PC).
    if (editable && future.includes(r)) {
      const qs = questions.slice(r.start, r.end + 1);
      const modifier = document.createElement("button");
      modifier.type = "button";
      modifier.className = "btn secondary edit";
      modifier.textContent = "✏️ Modifier ce jeu";
      modifier.disabled = editing;
      modifier.onclick = () => ouvrirCarte(typeDuJeu(qs), { round: roundDuJeu(qs), titre: r.title });
      liste.append(modifier);
    }
    liste.append(...items);
    jeu.append(roundHead(r, rounds, future, questions, index, editable), liste);
    box.appendChild(jeu);
  });
  // Mauvaise prestation lancée (cedric, 21/10) : discret, et seulement tant qu'aucun point n'a été donné.
  if (mayReplaceShow(st)) {
    const wrong = document.createElement("button");
    wrong.id = "plan-wrong";
    wrong.className = "link";
    wrong.textContent = "Mauvaise prestation ?";
    wrong.onclick = () => {
      wrongShow = true;
      tabChosen = true;
      fermerConducteur();
      switchTab("show");
      if (COCKPIT) ouvrirPlus();
    };
    box.appendChild(wrong);
  }
}

function roundHead(r, rounds, future, questions, index, editable) {
  const head = document.createElement("div");
  head.className = "plan-head";
  head.dataset.round = r.title;
  const deplie = jeuxDeplies.has(r.title);
  // ▸ / ▾ et le nom : déplient ou replient les questions du jeu.
  const titre = document.createElement("button");
  titre.type = "button";
  titre.className = "plan-deplier";
  titre.setAttribute("aria-expanded", deplie ? "true" : "false");
  const voyant = voyantDuJeu(questions.slice(r.start, r.end + 1));
  head.dataset.voyant = voyant;
  titre.innerHTML = '<span class="fleche" aria-hidden="true"></span><span class="voyant" role="img"></span><span class="plan-round"></span>';
  titre.querySelector(".fleche").textContent = deplie ? "▾" : "▸";
  titre.querySelector(".voyant").classList.add(voyant);
  titre.querySelector(".voyant").setAttribute("aria-label", VOYANTS[voyant]);
  titre.querySelector(".voyant").title = VOYANTS[voyant];
  titre.querySelector(".plan-round").textContent = r.title;
  titre.onclick = () => {
    // Le lâcher d'un jeu déplacé n'est pas un toucher sur son nom.
    if (Date.now() - glisseFini < 400) return;
    if (jeuxDeplies.has(r.title)) jeuxDeplies.delete(r.title); else jeuxDeplies.add(r.title);
    render();
  };
  head.append(titre);
  const k = future.indexOf(r);
  const button = (label, cls, disabled, action, aria) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.className = cls;
    b.disabled = disabled || editing;
    if (aria) b.setAttribute("aria-label", aria);
    b.onclick = action;
    head.appendChild(b);
  };
  // La ligne (cedric, 30/10) : ▸, le nom, « Retirer » en rouge, puis ▶ ; rien sur le jeu en cours.
  if (editable && k >= 0) {
    button("Retirer", "remove", rounds.length === 1, async () => {
      if (!await demander({ ...SUR, line: `« ${r.title} » sera retiré du programme.` })) return;
      sendProgram([...questions.slice(0, r.start), ...questions.slice(r.end + 1)], `« ${r.title} » est retirée du programme.`);
    }, `Retirer « ${r.title} »`);
  }
  // ▶ (à la place de « ⏭ Changer de jeu ») : aller à ce jeu en arrêtant le jeu en cours, partie commencée ; « Êtes-vous sûr ? ».
  const st = live.state ?? {};
  const enCours = r.start <= index && index <= r.end && st.phase !== "ended";
  if (editable && index >= 0 && !enCours) {
    // Pas encore chargé dans la box (cedric, 30/10) : jamais bloqué (un wifi faible peut ne jamais finir), mais la
    // confirmation le dit.
    button("▶", "go", !!pending?.advance, () => jumpTo(r, live.state ?? {}, voyant !== "vert"), `Aller à « ${r.title} »`);
  }
  // Plus de flèches (cedric, 30/10) : un appui long soulève le jeu, il suit le doigt et se pose quand on lâche.
  if (editable && k >= 0 && !editing && rounds.every((x) => questions[x.start].round)) head.addEventListener("pointerdown", (e) => soulever(e, head, r, rounds, questions, index));
  return head;
}

// ---------- Déplacer un jeu au doigt (cedric, 30/10) ----------

/** Jeu soulevé par un appui long : il suit le doigt (ou la souris) jusqu'au lâcher. */
let glisse = null;
let glisseFini = 0;
const APPUI_LONG_MS = 450;

function soulever(e, head, r, rounds, questions, index) {
  if (e.button > 0 || e.target.closest("button:not(.plan-deplier)")) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  const annuler = () => {
    clearTimeout(minuteur);
    removeEventListener("pointermove", bouge);
    removeEventListener("pointerup", annuler);
    removeEventListener("pointercancel", annuler);
  };
  // Le doigt bouge avant la fin de l'appui : c'est un défilement, pas un déplacement.
  const bouge = (m) => { if (Math.abs(m.clientX - x0) > 10 || Math.abs(m.clientY - y0) > 10) annuler(); };
  const minuteur = setTimeout(() => { annuler(); demarrerGlisse(r, rounds, questions, index, y0); }, APPUI_LONG_MS);
  addEventListener("pointermove", bouge);
  addEventListener("pointerup", annuler);
  addEventListener("pointercancel", annuler);
}

function demarrerGlisse(r, rounds, questions, index, y) {
  const box = $("panel-plan");
  const blocs = rounds.map((x) => box.querySelector(`.plan-jeu[data-start="${x.start}"]`));
  const depart = rounds.indexOf(r);
  if (depart < 0 || blocs.some((b) => !b) || rounds.length < 2) return;
  // Se pose seulement après le jeu en cours (ou le dernier commencé) : avant, il ne serait jamais joué.
  const st = live.state ?? {};
  let dernier = -1;
  rounds.forEach((x, i) => { if (x !== r && x.start <= index && st.phase !== "lobby") dernier = i; });
  const autres = rounds.filter((x) => x !== r);
  const min = dernier < 0 ? 0 : autres.indexOf(rounds[dernier]) + 1;
  navigator.vibrate?.(30);
  const defile = box.closest(".conducteur-corps") ?? document.scrollingElement;
  const milieux = blocs.map((b) => { const rect = b.getBoundingClientRect(); return rect.top + rect.height / 2; });
  glisse = { rounds, r, depart, blocs, milieux, min, questions, index, y0: y, y, defile, scroll0: defile.scrollTop, place: depart, boucle: 0 };
  blocs[depart].classList.add("souleve");
  box.classList.add("en-glisse");
  addEventListener("pointermove", suivreGlisse);
  addEventListener("pointerup", poserGlisse);
  addEventListener("pointercancel", poserGlisse);
  // Le doigt ne fait plus défiler la page pendant le déplacement : c'est la ligne qui bouge.
  addEventListener("touchmove", bloquerDefilement, { passive: false });
  placerGlisse();
  glisse.boucle = requestAnimationFrame(defilerAuBord);
}

function bloquerDefilement(e) { if (glisse) e.preventDefault(); }

function suivreGlisse(e) {
  if (!glisse) return;
  glisse.y = e.clientY;
  placerGlisse();
}

/**
 * La ligne suit le doigt ; les autres jeux s'écartent pour montrer où elle se posera. [place] : son rang parmi les
 * autres jeux une fois posée (jamais avant le jeu en cours).
 */
function placerGlisse() {
  const g = glisse;
  const decalage = g.defile.scrollTop - g.scroll0;
  const dy = g.y - g.y0 + decalage;
  const souleve = g.blocs[g.depart];
  souleve.style.transform = `translateY(${dy}px)`;
  const centre = g.milieux[g.depart] + dy;
  let place = 0;
  g.blocs.forEach((b, i) => { if (i !== g.depart && g.milieux[i] < centre) place++; });
  place = Math.max(place, g.min);
  g.place = place;
  const haut = souleve.offsetHeight + 6;
  let k = 0;
  g.blocs.forEach((b, i) => {
    if (i === g.depart) return;
    b.style.transform = i < g.depart && k >= place ? `translateY(${haut}px)` : i > g.depart && k < place ? `translateY(${-haut}px)` : "";
    k++;
  });
}

/** Près du haut ou du bas de l'écran, la liste défile toute seule. */
function defilerAuBord() {
  const g = glisse;
  if (!g) return;
  const zone = g.defile === document.scrollingElement ? { top: 0, bottom: innerHeight } : g.defile.getBoundingClientRect();
  const marge = 64;
  const vitesse = g.y < zone.top + marge ? -12 : g.y > zone.bottom - marge ? 12 : 0;
  if (vitesse) {
    g.defile.scrollTop += vitesse;
    placerGlisse();
  }
  g.boucle = requestAnimationFrame(defilerAuBord);
}

function poserGlisse() {
  const g = glisse;
  if (!g) return;
  glisse = null;
  glisseFini = Date.now();
  cancelAnimationFrame(g.boucle);
  removeEventListener("pointermove", suivreGlisse);
  removeEventListener("pointerup", poserGlisse);
  removeEventListener("pointercancel", poserGlisse);
  removeEventListener("touchmove", bloquerDefilement);
  g.blocs.forEach((b) => { b.style.transform = ""; });
  g.blocs[g.depart].classList.remove("souleve");
  $("panel-plan").classList.remove("en-glisse");
  if (g.place === g.depart) return render();
  const ordre = g.rounds.filter((x) => x !== g.r);
  ordre.splice(g.place, 0, g.r);
  const program = ordre.flatMap((x) => g.questions.slice(x.start, x.end + 1));
  const ecart = Math.abs(g.place - g.depart);
  sendProgram(program, `« ${g.r.title} » est ${g.place < g.depart ? "avancé" : "reculé"} de ${ecart} place${ecart > 1 ? "s" : ""}.`);
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
  // Toujours relue (cedric, 27/10 en direct) : un jeu préparé dans la Régie PC pendant la fête apparaît aussitôt ;
  // la liste déjà lue reste affichée le temps de la relire.
  if (!library?.games) library = null;
  fetchLibrary();
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
  answer.textContent = q.kind === "patate" ? "bombe de tablette en tablette · mèche secrète" : q.kind === "gonfleur" ? "course de ballons · le premier qui éclate gagne" : q.kind === "coffres" ? "coffres chacun son tour · la bombe arrête le jeu" : q.kind === "number" ? `Juste Chiffre · ${q.correct}` : `${CHOICE_LETTERS[q.correct] ?? "?"} · ${q.choices?.[q.correct] ?? ""}`;
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
  if (!library?.games) {
    library = { loading: true };
    renderLibrary();
  }
  try {
    const [s, q, m, p, c, sm, so] = await Promise.all(["shows", "quizzes", "mimes", "playlists", "contents", "manches", "songs"].map((k) => get(ref(db, `library/${k}`))));
    const quizzes = q.val() ?? {};
    const mimes = m.val() ?? {};
    const playlists = p.val() ?? {};
    const contents = c.val() ?? {};
    // Chansons de la bibliothèque des sons : un blind test tiré au 🎲 dans la Régie PC (cedric, 24/10) se rejoue avec.
    const songs = so.val() ?? {};
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
      .flatMap(([id, show]) => (show.rounds ?? []).map((r) => jeuDeLaManche(r, quizzes)).filter((r) => r && r.type !== "mimes" && r.type !== "statues" && r.type !== "pictionary" && r.type !== "coffres" && r.type !== "gonfleur" && r.type !== "patate" && r.type !== "finale" && !BUILTIN_GAMES[r.type] && !MUSIC_GAMES[r.type]).map((round, i) => {
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
      // Blind test au hasard (cedric, 27/10, en pleine fête) : sans rien préparer, des chansons de la bibliothèque des
      // sons tirées à l'ajout, jamais une chanson déjà au programme de la fête.
      ...(Object.values(songs).some(chansonJouable) ? [{ key: "builtin/blind", label: "Blind test : vos chansons au hasard", hasardBlind: true, source: { type: "blind", chansons: [] } }] : []),
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
    library = { quizzes, mimes, playlists, contents, songs, games, rounds, decks, quizGames, builtins, music, pinned, saved, drawn };
  } catch (e) {
    console.error(e);
    // Relecture ratée (réseau) : la liste déjà lue reste.
    if (!library?.games) library = { denied: /permission/i.test(String(e?.message ?? e)) };
  }
  renderLibrary();
}

function openLibrary() {
  picked = null;
  libRejouer = false;
  $("lib").hidden = false;
  // Toujours relue (cedric, 27/10 en direct) : un jeu préparé dans la Régie PC pendant la fête apparaît aussitôt ;
  // la liste déjà lue reste affichée le temps de la relire.
  if (!library?.games) library = null;
  fetchLibrary();
}

function closeLibrary() {
  picked = null;
  refusAjout = null;
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
  if (library?.loading) return hint("Chargement de la bibliothèque…");
  if (library?.denied) return hint("Pour ouvrir la bibliothèque, entrez dans la régie avec le mot de passe (pas avec le code de la TV).");
  if (!library?.games) return hint("Impossible de lire la bibliothèque. Vérifiez la connexion.");
  if (libRejouer) return renderRejouables(box);
  // « ＋ Jeu » (cedric, 30/10) : une ligne par jeu ; le jeu touché ouvre sa carte de réglage, celle de la Régie PC.
  for (const [type, icone, detail] of JEUX_AJOUT) {
    const b = document.createElement("button");
    b.className = "show-item lib-jeu";
    b.dataset.jeu = type;
    const title = document.createElement("b");
    const ic = document.createElement("span");
    ic.className = "icone";
    ic.textContent = icone;
    title.append(ic, ROUND_TYPES[type]);
    const meta = document.createElement("span");
    meta.textContent = detail;
    b.append(title, meta);
    b.onclick = () => ouvrirCarte(type);
    box.appendChild(b);
  }
}

/** Les jeux de « ＋ Jeu », dans l'ordre de la Régie PC : type, icône, ce qu'on y règle. */
const JEUX_AJOUT = [
  ["quiz", "❓", "🎲, un thème, le nombre de questions, un ancien anniversaire"],
  ["illustre", "📷", "photos de la banque des tout-petits, 🎲 par thème"],
  ["mimes", "🎭", "🎲 cartes par équipe, thème, vos séries"],
  ["blind", "🎵", "🎲 vos chansons, une playlist"],
  ["musical", "🎶", "🎲 vos chansons, une playlist"],
  ["statues", "🗿", "vos chansons"],
  ["express", "✔", "🎲 des affirmations Vrai ou Faux"],
  ["zoom", "🔍", "🎲 des photos, vos images"],
  ["flou", "🌫", "🎲 des photos, vos images"],
  ["chante", "🎤", "🎲 des mots, vos séries"],
  ["quisuis", "🕵", "🎲 des personnages, vos séries"],
  ["disparu", "🎩", "🎲 des grilles, émojis ou photos"],
  ["pictionary", "✏️", "🎲 des mots, le temps de dessin"],
  ["coffres", "🗝️", "rien à préparer"],
  ["patate", "💣", "le nombre de bombes"],
  ["duel", "🤠", "les joueurs, la durée du face-à-face"],
  ["simon", "🔴", "le nombre de tours"],
  ["gonfleur", "🎈", "rien à préparer"],
];

// ---------- La carte d'un jeu (« ＋ Jeu » et « ✏️ Modifier » du Conducteur, cedric, 30/10) ----------

/**
 * Carte ouverte : le jeu réglé dans la page de la Régie PC (mode « carte », dans le cadre), et, pour un jeu à venir
 * modifié depuis le Conducteur, son titre (il garde sa place). [round] : le dernier réglage reçu du cadre.
 */
let carteJeu = null;

/** Ouvre la carte d'un jeu : nouveau ([round] absent), ou un jeu à venir du programme ([titre]) à modifier. */
async function ouvrirCarte(type, { round = null, titre = null } = {}) {
  if (!ROUND_TYPES[type]) return;
  let profil = null;
  try {
    const show = (await get(ref(db, `games/${code}/show`))).val();
    profil = show?.profile ?? (show?.age != null ? profileForAge(show.age) : null);
  } catch { profil = null; }
  carteJeu = { type, depart: round, titre, round: null, plein: false, envoi: false };
  const adresse = new URL("admin.html", location.href);
  adresse.search = "";
  adresse.searchParams.set("carte", type);
  adresse.searchParams.set("g", code);
  if (profil) adresse.searchParams.set("profil", profil);
  if (teamsNow()) adresse.searchParams.set("equipes", `${teamsNow()}`);
  const emu = new URLSearchParams(location.search).get("emu");
  if (emu) adresse.searchParams.set("emu", emu);
  $("carte-titre").textContent = titre ? `✏️ ${titre}` : ROUND_TYPES[type];
  $("carte-info").hidden = true;
  // replace : la page du cadre ne s'ajoute pas à l'historique (le geste « retour » du téléphone ne la rouvre pas).
  $("carte-cadre").contentWindow.location.replace(adresse.href);
  $("carte").hidden = false;
  renderCarte();
  if (!library?.games) fetchLibrary();
}

function fermerCarte() {
  carteJeu = null;
  $("carte").hidden = true;
  $("carte-cadre").contentWindow?.location.replace("about:blank");
}

function renderCarte() {
  if (!carteJeu) return;
  $("carte-envoyer").disabled = !carteJeu.round || carteJeu.envoi || editing;
  $("carte-envoyer").textContent = carteJeu.envoi ? "Envoi…" : carteJeu.titre ? "✓ Enregistrer dans le conducteur" : "✓ Envoyer au conducteur";
}

/** Messages du cadre : prêt (on lui donne le jeu à régler), puis le jeu réglé à chaque changement. */
let attenteCarte = null;
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || !carteJeu || e.source !== $("carte-cadre").contentWindow) return;
  const m = e.data?.lmpCarte;
  if (!m) return;
  if (m.prete) {
    e.source.postMessage({ lmpCarte: { ouvrir: true, round: carteJeu.depart, titre: carteJeu.titre } }, location.origin);
    return;
  }
  if (m.round) {
    carteJeu.round = m.round;
    carteJeu.plein = m.plein === true;
    attenteCarte?.();
    renderCarte();
  }
});

/** Le dernier réglage du cadre, redemandé juste avant l'envoi (une saisie qui n'a encore rien envoyé). */
function reglageDeLaCarte() {
  return new Promise((resolve) => {
    const fini = () => { clearTimeout(t); attenteCarte = null; resolve(carteJeu?.round ?? null); };
    const t = setTimeout(fini, 1500);
    attenteCarte = fini;
    $("carte-cadre").contentWindow?.postMessage({ lmpCarte: "donne" }, location.origin);
  });
}

/** Type d'un jeu du programme, d'après ses questions (Quiz illustré : des réponses en images). */
function typeDuJeu(qs) {
  const q = qs.find(Boolean);
  if (q?.kind === "duel" || q?.kind === "simon") return q.kind;
  if (q && !q.kind?.match?.(/^(express|zoom|flou)$/) && (q.choiceImages || q.choiceBanque)) return "illustre";
  return questionType(q) ?? "quiz";
}

/** Une question du programme, gardée telle quelle dans une série « reprise » de la carte (Quiz, Vrai ou Faux…). */
function questionDeSerie(q, i) {
  return {
    id: `c${i + 1}`, text: q.text,
    ...(q.kind === "number" ? { nombre: true, correct: q.correct } : { choices: q.choices, correct: q.correct }),
    ...(q.banque ? { banque: q.banque } : q.imageId ? { imageId: q.imageId } : q.image ? { emoji: q.image } : {}),
    ...(Array.isArray(q.choiceBanque) ? { choiceBanque: q.choiceBanque } : {}),
    ...(q.choiceImages && typeof q.choiceImages === "object" ? { choiceImages: q.choiceImages } : {}),
  };
}

/** Le réglage d'un jeu à venir, refait d'après ses questions : la carte s'ouvre sur ce qui est prévu. */
function roundDuJeu(qs) {
  const type = typeDuJeu(qs);
  const deck = qs.find((q) => q?.kind === "mime" || q?.kind === "pictionary");
  if (["quiz", "illustre", "express", "zoom", "flou"].includes(type)) {
    const finale = qs.filter((q) => q?.finale === true).length;
    const facteur = qs.find((q) => q?.facteur)?.facteur;
    return { type, seriesQuiz: [{ id: "prevu", origine: "reprise", titre: qs[0]?.round ?? ROUND_TYPES[type], questions: qs.filter(Boolean).map(questionDeSerie) }],
      ...(finale ? { finale } : { finale: null }), ...(facteur ? { facteur } : {}) };
  }
  // Mimes par équipe : chaque équipe retrouve ses images sur son 🎲, sans les images de secours ajoutées au bout.
  const parEquipe = qs.filter((q) => q?.kind === "mime" && q.couleur);
  if (type === "mimes" && parEquipe.length) {
    const equipes = couleursEquipes({ teams: teamsNow() || parEquipe.length }).map((c) => {
      const cartes = parEquipe.find((q) => String(q.couleur).toUpperCase() === c.toUpperCase())?.cards ?? [];
      return cartes.length > MIME_RESERVE ? cartes.slice(0, cartes.length - MIME_RESERVE) : cartes;
    });
    return { type, equipes, duration: parEquipe[0].duration };
  }
  if (type === "mimes" && deck) return { type, cards: deck.cards, duration: deck.duration };
  // Pictionary par équipe : ses passages, les mots dans l'ordre.
  if (type === "pictionary" && Array.isArray(deck?.offres)) {
    return { type, tours: deck.offres.map((ps) => (ps ?? []).map((p) => (p ?? []).map((i) => deck.cards?.[i]).filter(Boolean))), duration: deck.duration, ...(deck.propositions ? { propositions: deck.propositions } : {}) };
  }
  if (type === "pictionary" && deck) return { type, picks: (deck.cards ?? []).map((c) => c?.word?.toLowerCase()).filter(Boolean), duration: deck.duration };
  if (type === "chante" || type === "quisuis") return { type, picks: qs.map((q) => q?.choices?.[0]?.toLowerCase()).filter(Boolean), count: qs.length };
  if (type === "blind" || type === "musical") return { type, tracks: qs.map((q) => q?.audioId).filter(Boolean) };
  if (type === "disparu") return { type, count: qs.length };
  return { type };
}

/** « ✓ Envoyer au conducteur » : le jeu réglé passe juste après le jeu en cours ; modifié, il garde sa place. */
async function envoyerCarte() {
  if (!carteJeu || carteJeu.envoi || editing) return;
  const jeu = carteJeu;
  const info = (texte) => { $("carte-info").textContent = texte; $("carte-info").hidden = !texte; };
  info("");
  jeu.envoi = true;
  renderCarte();
  try {
    const round = await reglageDeLaCarte();
    if (!library?.games) await fetchLibrary();
    if (!round || !library?.games) return info("Le jeu n'est pas encore prêt : réessayez dans un instant.");
    try {
      const show = (await get(ref(db, `games/${code}/show`))).val();
      profile = show?.profile ?? (show?.age != null ? profileForAge(show.age) : null);
    } catch { profile = null; }
    const prefix = `a${Date.now().toString(36)}`;
    const avoid = alreadyPlayed();
    const { questions, problems } = gameQuestions(round, library.quizzes, profile ?? "MOYENS", prefix, library.mimes, library.playlists, library.contents, { concepts: avoid.concepts }, teamsNow(), library.songs);
    if (!questions.length) return info(problems?.[0] ?? "Ce jeu est vide : réglez-le d'abord (🎲).");
    const refuse = tvRefuses(questions);
    if (refuse) return info(refuse);
    let chosen;
    try { chosen = await copyImages(questions); } catch (e) {
      console.warn("Images non copiées", e);
      return info("Les images du jeu n'ont pas pu être copiées (connexion ?) : rien n'a été envoyé, réessayez.");
    }
    copySounds(chosen);
    if (carteJeu !== jeu) return;
    const st = live.state ?? { phase: "lobby" };
    const current = live.plan?.questions ?? [];
    const index = st.phase === "lobby" ? -1 : st.index ?? -1;
    let program;
    let message;
    if (jeu.titre) {
      // Choix A : le jeu à venir est remplacé à sa place, sous le même nom ; commencé entre-temps, il ne change plus.
      const r = programRounds(current).find((x) => x.title === jeu.titre);
      if (!r || jeuCommence(r, current, st)) return info(`« ${jeu.titre} » a commencé entre-temps : il ne peut plus changer.`);
      program = [...current.slice(0, r.start), ...chosen.map((q) => ({ ...q, round: jeu.titre })), ...current.slice(r.end + 1)];
      message = `« ${jeu.titre} » est modifié dans le conducteur.`;
    } else {
      const title = uniqueRoundTitle(current, chosen[0]?.round ?? ROUND_TYPES[jeu.type]);
      program = insertGame(current, chosen.map((q) => ({ ...q, round: title })), "after", index);
      message = `« ${title} » est ajouté ${index < 0 ? "au début du programme" : "après le jeu en cours"}.`;
    }
    await sendProgram(program, message, false, () => { fermerCarte(); closeLibrary(); });
  } finally {
    jeu.envoi = false;
    renderCarte();
  }
}

$("carte-retour").onclick = fermerCarte;
$("carte-envoyer").onclick = envoyerCarte;

/** Profil d'âge de la prestation chargée : les questions ajoutées prennent le même chrono. */
let profile = null;

async function pick(game) {
  try {
    const show = (await get(ref(db, `games/${code}/show`))).val();
    profile = show?.profile ?? (show?.age != null ? profileForAge(show.age) : null);
  } catch { profile = null; }
  refusAjout = null;
  picked = { game, source: { ...game.source } };
  if (game.hasardBlind) picked.source.chansons = tirerChansons();
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

/** Blind test au hasard : combien de chansons, tirées dans la bibliothèque des sons. */
const BLIND_HASARD = 10;

/** Chansons du « Blind test au hasard » : jouables, jamais une déjà au programme de la fête (même extrait), mélangées. */
function tirerChansons(n = BLIND_HASARD) {
  const deja = new Set((live.plan?.questions ?? []).flatMap((q) => [q?.audioId, q?.refrainId]).filter(Boolean));
  const ids = Object.entries(library?.songs ?? {}).filter(([, x]) => chansonJouable(x) && !deja.has(x.audioId)).map(([id]) => id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, n);
}

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
  const { questions, problems } = gameQuestions(picked.source, library.quizzes, profile ?? "MOYENS", prefix, library.mimes, library.playlists, library.contents, picked.random || picked.game.rejouer ? avoid : { concepts: avoid.concepts }, teams, library.songs);
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
    const { questions: one } = gameQuestions(round, library.quizzes, profile ?? "MOYENS", `a${Date.now().toString(36)}`, library.mimes, library.playlists, library.contents, {}, null, library.songs);
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
        const { questions: all } = gameQuestions(next, library.quizzes, profile ?? "MOYENS", `a${Date.now().toString(36)}`, library.mimes, library.playlists, library.contents, {}, null, library.songs);
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
    if (q.kind === "patate") { li.textContent = "La bombe passe de tablette en tablette ; une équipe qui la garde plus de 2 secondes la voit exploser. À l'explosion, l'équipe qui la tient perd des points."; list.appendChild(li); return; }
    if (q.kind === "simon") { li.textContent = "Le robot prof montre une suite de boules qui s'allument ; un joueur de chaque équipe la retape sur sa tablette. Une erreur élimine l'équipe du tour."; list.appendChild(li); return; }
    if (q.kind === "chrono") { li.textContent = `Le chrono part puis se cache sous le drap de Buzzy : chaque équipe buzze quand elle pense être à ${q.cible ?? 30} secondes. La plus proche gagne le tour.`; list.appendChild(li); return; }
    if (q.kind === "duel") { li.textContent = "Deux équipes face à face, un joueur de chaque : la première qui buzze après le PAN gagne, trop tôt elle perd."; list.appendChild(li); return; }
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
  const soucis = [...(refusAjout ? [refusAjout] : []), ...problems];
  $("lib-problems").hidden = !soucis.length;
  $("lib-problems").textContent = soucis.join(" ");
  const lobby = st.phase === "lobby";
  const rejeu = enRejeu();
  const after = $("lib-after");
  after.textContent = editing ? "Envoi à la TV…" : adding ? "Préparation des images…" : rejeu ? "Après le jeu en cours" : lobby ? "Ajouter au début" : "Ajouter après la manche actuelle";
  after.disabled = editing || adding || !questions.length;
  // Rejeu : « ▶ Rejouer maintenant » en premier, « Après le jeu en cours » ensuite (rien à attendre une fois la fête finie).
  after.classList.toggle("main", !rejeu);
  after.classList.toggle("secondary", rejeu);
  after.hidden = rejeu && st.phase === "ended";
  const now = $("lib-now");
  now.hidden = !rejeu;
  now.textContent = editing ? "Envoi à la TV…" : "▶ Rejouer maintenant";
  now.disabled = editing || adding || !questions.length;
  $("lib-end").hidden = rejeu;
  $("lib-end").disabled = editing || adding || !questions.length;
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
const OLD_TV_SIMON = "La TV doit être mise à jour pour jouer au Simon de Buzzy : sur la TV, menu Retour → « Rechercher une mise à jour ».";
const OLD_TV_CHRONO = "La TV doit être mise à jour pour jouer au Chrono de Buzzy : sur la TV, menu Retour → « Rechercher une mise à jour ».";
const OLD_TV_DUEL = "La TV doit être mise à jour pour jouer au Duel des robots : sur la TV, menu Retour → « Rechercher une mise à jour ».";
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
  if (live.plan.coffres !== true && questions.some((q) => q?.kind === "coffres")) return OLD_TV_COFFRES;
  if (live.plan.gonfleur !== true && questions.some((q) => q?.kind === "gonfleur")) return OLD_TV_GONFLEUR;
  if (live.plan.patate !== true && questions.some((q) => q?.kind === "patate")) return OLD_TV_PATATE;
  if (live.plan.duel !== true && questions.some((q) => q?.kind === "duel")) return OLD_TV_DUEL;
  if (live.plan.simon !== true && questions.some((q) => q?.kind === "simon")) return OLD_TV_SIMON;
  if (live.plan.chrono !== true && questions.some((q) => q?.kind === "chrono")) return OLD_TV_CHRONO;
  // Quiz musical compris : une ancienne TV le jouerait sans musique.
  if (live.plan.blindPlay !== true && questions.some((q) => q?.kind === "blind")) return OLD_TV_BLIND;
  if (live.plan.blind !== true && questions.some((q) => q?.audioId)) return OLD_TV_BLIND;
  return null;
}

let adding = false;
/** Refus de la TV au dernier ajout du jeu choisi : montré dans la fenêtre du jeu, effacé au prochain essai. */
let refusAjout = null;
async function addPicked(where) {
  if (!picked || editing || adding) return;
  refusAjout = null;
  const rejeuEnCours = enRejeu();
  const refused = tvRefuses(picked.questions);
  if (refused) { toast(refused); return; }
  // « ▶ Rejouer maintenant » pendant un jeu : « Êtes-vous sûr ? » avant d'arrêter le jeu en cours (cedric, 30/10).
  const enJeu = !["lobby", "ended"].includes(live.state?.phase ?? "lobby");
  if (where === "now" && enJeu) {
    const nom = picked.game?.label ? `«\u00a0${picked.game.label}\u00a0»` : "ce jeu";
    if (!await demander({ ...SUR, line: `Vous allez lancer ${nom} tout de suite.`, text: "Le jeu en cours s'arrête là. Les points déjà gagnés sont gardés." })) return;
    if (!picked || editing || adding) return;
  }
  // Le jeu choisi est gardé : fenêtre fermée pendant la copie des images, l'ajout part quand même (test du 27/10 :
  // la copie des pochettes d'un blind test prenait du temps sans rien montrer, et l'ajout se perdait).
  const choix = picked;
  // Photos copiées avant l'envoi : la TV les cherche dès qu'elle accepte le programme. Les extraits,
  // plus lourds, suivent ; la TV les attend.
  adding = true;
  renderLibrary();
  let chosen;
  try {
    chosen = await copyImages(choix.questions);
  } catch (e) {
    console.warn("Images non copiées", e);
    refusAjout = "⚠ Les images du jeu n'ont pas pu être copiées (connexion ?) : rien n'a été ajouté, réessayez.";
    toast(refusAjout);
    return;
  } finally {
    adding = false;
    renderLibrary();
  }
  copySounds(chosen);
  if (editing) { toast("Un autre changement part vers la TV : réessayez dans un instant."); return; }
  if (picked !== choix) picked = null;
  const st = live.state ?? { phase: "lobby" };
  const current = live.plan?.questions ?? [];
  const title = uniqueRoundTitle(current, chosen[0]?.round ?? choix.game.label);
  const added = chosen.map((q) => ({ ...q, round: title }));
  const index = st.phase === "lobby" ? -1 : st.index ?? -1;
  const now = where === "now";
  const program = insertGame(current, added, now ? "after" : where, index);
  const place = where === "end" ? "à la fin du programme" : index < 0 ? "au début du programme" : now || rejeuEnCours ? "après le jeu en cours" : "après la manche en cours";
  const keep = choix.random ? liveManche(choix, title) : null;
  // « ▶ Rejouer maintenant » : le jeu en cours s'arrête là (ses points sont gardés) et la TV ouvre le jeu rejoué.
  const lancer = now ? async () => {
    const start = program.findIndex((q) => q.id === added[0]?.id);
    if (start < 0) return;
    const bilan = jeuEnCours(live.state ?? {});
    const status = await send("goto", { index: start, qid: added[0].id }, { advance: true });
    if (status?.status === "applied") toast(bilan ? `Bilan des scores sur la TV, puis « ${title} ».` : `C'est reparti pour « ${title} » !`);
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
  else if (type === "chante" || type === "quisuis") round = { ...round, seriesMots: null, ordreMots: null, picks: questions.map((q) => q.choices?.[0]?.toLowerCase()).filter(Boolean), count: questions.length };
  else if (type === "disparu") round = { ...round, seriesMots: null, ordreMots: null, count: questions.length };
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
    // Refus pendant un ajout (test du 27/10 : Sarah n'avait rien vu, la fenêtre se fermait sur un petit message) :
    // le jeu choisi reste ouvert avec la raison bien visible, pour réessayer ou l'ajouter à la fin.
    if (applied || !fromLibrary || !picked) {
      if (applied || fromLibrary) closeLibrary();
      toast(message);
    } else {
      refusAjout = `⚠ ${message} Vous pouvez réessayer, ou « Ajouter à la fin ».`;
      renderLibrary();
    }
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
  // Les chansons de la bibliothèque des sons : celles des blind tests tirés au 🎲 (cedric, 24/10).
  const [s, q, m, p, c, so] = await Promise.all(["shows", "quizzes", "mimes", "playlists", "contents", "songs"].map((k) => get(ref(db, `library/${k}`))));
  const quizzes = q.val() ?? {};
  const mimes = m.val() ?? {};
  const playlists = p.val() ?? {};
  const contents = c.val() ?? {};
  const songs = so.val() ?? {};
  const lire = (path) => get(ref(db, path)).then((x) => x.val(), () => null);
  const launches = await lire("launches") ?? {};
  const runs = await launchStates(launches, lire, { here: code, now: Date.now() + serverOffset });
  const today = new Date().toISOString().slice(0, 10);
  const list = Object.entries(s.val() ?? {})
    .filter(([id, show]) => (show.status === "publiee" && !isArchived(show)) || runs[id]?.etat === "ici" || AILLEURS.includes(runs[id]?.etat))
    .map(([id, show]) => ({ id, show, run: runs[id] ?? { etat: "preparee" }, ...buildSnapshot(id, show, quizzes, mimes, Math.random, playlists, contents, {}, songs) }))
    // Les prestations à venir d'abord, la plus proche en tête ; les passées ensuite.
    .sort((a, b) => {
      const da = a.show.date ?? "9999", dbb = b.show.date ?? "9999";
      const pa = da < today, pb = dbb < today;
      return pa !== pb ? (pa ? 1 : -1) : pa ? dbb.localeCompare(da) : da.localeCompare(dbb);
    });
  return { list, launches };
}

/**
 * Dernière liste des prestations vue sur ce téléphone, affichée tout de suite pendant la relecture (cedric, 25/10 :
 * après un nouveau scan, l'anniversaire test mettait du temps à réapparaître). Sans risque : une prestation touchée
 * est toujours relue à l'instant du lancement.
 */
const CLE_LISTE = "lmp-regie-prestations";
function listeGardee() {
  try {
    const liste = JSON.parse(localStorage.getItem(CLE_LISTE) ?? "null");
    return Array.isArray(liste) ? liste : null;
  } catch {
    return null;
  }
}
function garderListe(list) {
  const resume = (x) => ({
    id: x.id, run: x.run, problems: x.problems ?? [],
    show: { title: x.show.title, childName: x.show.childName, copieDe: x.show.copieDe, age: x.show.age, date: x.show.date },
    jeux: x.snapshot?.rounds.length ?? null,
    questions: x.snapshot?.quiz.questions.filter((q) => q.kind !== "mime" && q.kind !== "pictionary").length ?? 0,
  });
  try { localStorage.setItem(CLE_LISTE, JSON.stringify(list.map(resume))); } catch { /* navigation privée : rien de gardé */ }
}

async function fetchShows() {
  const gardee = shows?.list ?? listeGardee();
  shows = gardee ? { list: gardee, loading: true } : { loading: true };
  render();
  try {
    shows = { list: (await readShows()).list };
    garderListe(shows.list);
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
  if (shows.loading && !shows.list) return hint("⏳ Chargement des prestations…");
  // Liste gardée de la dernière fois : visible tout de suite, la relecture se voit en haut.
  if (shows.loading) hint("⏳ Mise à jour de la liste…");
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
  shows.list.forEach(({ id, show, snapshot, problems, run, jeux, questions }) => {
    const item = document.createElement("button");
    item.className = "show-item";
    item.dataset.show = id;
    const title = document.createElement("b");
    title.textContent = showTitle(show);
    const meta = document.createElement("span");
    const date = show.date ? new Date(`${show.date}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "";
    meta.textContent = [show.childName, show.age ? `${show.age} ans` : "", date].filter(Boolean).join(" · ");
    const detail = document.createElement("span");
    const asked = snapshot ? snapshot.quiz.questions.filter((x) => x.kind !== "mime" && x.kind !== "pictionary").length : questions ?? 0;
    const nbJeux = snapshot ? snapshot.rounds.length : jeux;
    detail.textContent = nbJeux != null
      ? `${nbJeux} jeu${nbJeux > 1 ? "x" : ""}${asked ? ` · ${asked} questions` : ""}`
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
    if (nbJeux != null && problems.length) {
      const warn = document.createElement("span");
      warn.className = "show-warn";
      warn.textContent = `⚠ ${problems.join(" ")}`;
      item.append(warn);
    }
    if (loadingShow === id) detail.textContent = "Chargement sur la TV…";
    item.disabled = nbJeux == null || !!loadingShow;
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
  for (const songId of chansonsEntieres(questions)) {
    try {
      await copierEntiere(songId);
    } catch (e) {
      console.warn("Chanson entière non copiée", songId, e);
    }
  }
}

/** Statues musicales : les chansons de la bibliothèque à jouer en entier (songs: [{ songId, audioId, title }]). */
function chansonsEntieres(questions) {
  const ids = (questions ?? []).filter((q) => q?.kind === "statues")
    .flatMap((q) => (Array.isArray(q.songs) ? q.songs : Object.values(q.songs ?? {})).map((x) => x?.songId))
    .filter((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(id));
  return [...new Set(ids)];
}

/**
 * Chanson entière copiée de library/entieres dans la partie, à l'identique et part par part (800 000 caractères au
 * plus chacune) ; n, kbps et length ensemble en dernier : la box sait qu'elle est complète, et plus rien ne s'écrit
 * dessus ensuite. Absente de la bibliothèque : la box joue l'extrait.
 */
async function copierEntiere(songId) {
  const cible = `games/${code}/songs/${songId}`;
  if (typeof (await get(ref(db, `${cible}/n`))).val() === "number") return;
  const source = `library/entieres/${songId}`;
  const [n, kbps, length] = await Promise.all(["n", "kbps", "length"].map((k) => get(ref(db, `${source}/${k}`)).then((x) => x.val())));
  if (typeof n !== "number" || n < 1) return;
  for (let i = 0; i < n; i++) {
    const part = (await get(ref(db, `${source}/p/${i}`))).val();
    if (typeof part !== "string") return;
    await set(ref(db, `${cible}/p/${i}`), part);
  }
  await update(ref(db, cible), { n, ...(typeof kbps === "number" ? { kbps } : {}), ...(typeof length === "number" ? { length } : {}) });
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
  // Fête à une autre date (date fausse dans la Régie PC, par exemple) : on peut la lancer, mais on le dit (cedric, 30/10).
  const horsDate = !!show.date && show.date !== isoDay();
  const warn = horsDate ? `⚠ Fête initialement prévue le ${date}. Lancer quand même ?` : "";
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
  return { title: `Lancer ${nomDansPhrase(show)} ?`, text: soucis, line, warn, ok: problems.length || horsDate ? "Lancer quand même" : "Lancer", safe: true };
}

/**
 * Défis de la pause en plus préparés dans la fiche de la prestation (Régie PC) : copiés dans la partie au lancement,
 * à la suite de ceux déjà ajoutés sur le téléphone (rien n'est jamais effacé). null : rien à écrire.
 */
async function defisAuLancement(prepares) {
  const enPlus = nettoyerDefis(prepares);
  if (!enPlus.length) return null;
  const deja = await get(ref(db, `games/${code}/defisFete/list`)).then((x) => x.val(), () => null);
  return valeurDefisFete([...nettoyerDefis(deja), ...enPlus]);
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
      // Prestation choisie dans « ☰ Plus » : la feuille se referme, « Lancer la fête ! » est juste là.
      fermerPlus();
      return done(`« ${snapshot.title} » est chargée sur la TV : ${snapshot.rounds.length} jeu${snapshot.rounds.length > 1 ? "x" : ""}.`);
    }
    annuler();
    done(SHOW_MESSAGES[status.reason] ?? "La TV a refusé cette prestation.");
  });
  copySounds(snapshot.quiz?.questions);
  const defisFete = await defisAuLancement(fresh.show?.defis);
  try {
    // Le programme pour la TV et le lancement de la prestation en une seule écriture : si une autre box vient de la
    // lancer, le serveur refuse tout, rien n'arrive sur cette TV.
    await update(ref(db), {
      [`games/${code}/show`]: { ...snapshot, id: showId, prestation: id, by: uid, at: serverTimestamp() },
      [`launches/${id}`]: { code, by: uid, at: serverTimestamp() },
      ...Object.fromEntries(anciennes.map((pid) => [`launches/${pid}`, null])),
      ...(defisFete ? { [`games/${code}/defisFete`]: defisFete } : {}),
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
  just_started: "Le chrono vient de partir : rien n'a été arrêté. Touchez à nouveau pour l'arrêter.",
  scores_just_shown: "Les scores viennent de s'afficher : laissez-les quelques secondes à l'écran, puis touchez à nouveau.",
  bad_factor: "Valeur de points inconnue.",
  not_ended: "La partie n'est pas encore terminée : gardez d'abord le doigt appuyé sur « ⛔ Terminer la partie ».",
  no_name: "Tapez d'abord le nom de l'équipe.",
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
/**
 * [repli] : un refus « not_ended » ou une écriture refusée (règles d'avant) ne s'affiche pas ; l'appelant se replie
 * (« Terminer la partie » sur une TV ou un site d'avant).
 */
async function send(type, extra = {}, { advance = false, repli = false } = {}) {
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
      if (status.status !== "applied" && !(repli && status.reason === "not_ended")) toast(STATUS_MESSAGES[status.reason] ?? STATUS_MESSAGES[status.status] ?? "Commande refusée.");
      done(status);
    });
    set(cmdRef, { type, expectSeq: st.seq ?? 0, by: uid, at: serverTimestamp(), ...extra }).catch((e) => {
      console.error(e);
      if (repli) return done({ status: "refused", reason: "write_denied" });
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
 * ± Points (cedric, 30/10) : la liste des équipes, puis deux blocs, Bonus +50 / +100 / +200 et Malus −50 / −100 / −200.
 * Un seul appui envoie la correction et ferme la fenêtre ; le bandeau « Annuler » reste quelques secondes.
 * Les boutons se bloquent dès le premier appui : un double appui ne compte jamais deux fois.
 */
let points = null;

/** [team] : « ± Points » d'une ligne de l'onglet Équipes, directement sur ses bonus et malus ; null : la liste des équipes. */
function choosePoints(team = null) {
  points = { team: team && live.teams[team] ? team : null, sending: false };
  $("pts").hidden = false;
  renderPoints();
}

function equipesInscrites() {
  return Object.entries(live.teams).sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0));
}

function renderPoints() {
  if (!points) return;
  const { team, sending } = points;
  if (team && !live.teams[team]) points.team = null;
  const t = points.team && live.teams[points.team];
  $("pts-title").textContent = t ? `Points pour ${t.name ?? "l'équipe"}` : "± Points : quelle équipe ?";
  $("pts-teams").hidden = !!t;
  $("pts-montants").hidden = !t;
  if (!t) {
    // Reconstruite seulement quand une équipe ou un score change : un appui ne tombe jamais sur un bouton remplacé.
    const cle = JSON.stringify(equipesInscrites().map(([id, e]) => [id, e.name, e.color, live.state?.scores?.[id] ?? 0]));
    if ($("pts-teams").dataset.key === cle) return;
    $("pts-teams").dataset.key = cle;
    $("pts-teams").replaceChildren(...equipesInscrites().map(([id, e]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.team = id;
      const pastille = document.createElement("span");
      pastille.className = "swatch";
      pastille.style.background = e.color ?? "";
      const nom = document.createElement("span");
      nom.className = "name";
      nom.textContent = e.name ?? "Équipe";
      const score = document.createElement("span");
      score.className = "score";
      score.textContent = String(live.state?.scores?.[id] ?? 0);
      b.append(pastille, nom, score);
      b.onclick = () => { if (points && !points.sending) { points.team = id; renderPoints(); } };
      return b;
    }));
    return;
  }
  $("pts-teams").dataset.key = "";
  $("pts-score").textContent = `Score : ${live.state?.scores?.[points.team] ?? 0}`;
  document.querySelectorAll("#pts [data-delta]").forEach((b) => { b.disabled = sending; });
}

function closePoints() {
  points = null;
  $("pts").hidden = true;
}

async function donnerPoints(delta) {
  if (!points || points.sending || !live.teams[points.team]) return;
  points.sending = true;
  const { team } = points;
  renderPoints();
  closePoints();
  await adjust(team, delta);
}

document.querySelectorAll("#pts [data-delta]").forEach((b) => { b.onclick = () => donnerPoints(Number(b.dataset.delta)); });
$("pts-autre").onclick = () => { if (points && !points.sending) { points.team = null; renderPoints(); } };
$("c-points").onclick = (e) => { if (e.detail > 1) return; if (Object.keys(live.teams).length) choosePoints(); else toast("Aucune équipe inscrite."); };
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

/** « ▶ Lancer la fin » à faire : podium sur la TV, fin pas encore lancée (outroAt), TV toujours sur la fête. */
function finAttendue(st) {
  return st.phase === "ended" && !st.leftAt && st.outroAt == null && !finSansOutro;
}

$("c-lancer-fin").onclick = async () => {
  const st = live.state;
  if (!st || !finAttendue(st) || pending?.advance) return;
  const status = await send("next", {}, { advance: true });
  // La box a répondu sans publier outroAt : box d'avant, « Fin de la fête » prend la place. Sans réponse : réessayer.
  if (status && live.state?.outroAt == null) finSansOutro = true;
  if (status?.status === "applied") toast("▶ Fin lancée : la fusée part sur la TV.");
  render();
};

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
  // Mimes en file : la première image de l'équipe de la couleur, ou la manche de la couleur suivante avec son tour.
  const enFile = mimeEnFile(st);
  if (enFile) {
    send("mime_start", { team: enFile }, { advance: true });
    return;
  }
  // Mimes entre deux tours : « Terminer les mimes » passe au classement, après confirmation s'il reste des équipes.
  const left = st?.phase === "question" && st.mime && !st.mime.team ? mimeRemaining(st) : [];
  if (left.length) {
    const names = left.map((id) => live.teams[id]?.name ?? "Équipe").join(", ");
    const game = st.kind === "pictionary" ? "le Pictionary" : "les mimes";
    if (!await demander({ title: `Terminer ${game} ?`, text: `${names} ${left.length > 1 ? "ne sont" : "n'est"} pas encore ${left.length > 1 ? "passées" : "passée"}.`, ok: `Terminer ${game}` })) return;
  }
  // Statues : une chanson ne finit jamais sans sa gagnante ; après l'annonce, « next » passe au jeu suivant.
  const statues = st ? statuesEtape(st) : null;
  if (statues?.choix) return validerGagnantes();
  const duel = st ? duelEtape(st) : null;
  if (duel) return duelPrincipal(duel, st);
  const simon = st ? simonEtape(st) : null;
  if (simon) return simonPrincipal(simon);
  const chrono = st ? chronoEtape(st) : null;
  if (chrono) return chronoPrincipal(chrono);
  if (statues && !statues.resultat) { $("statues-choisir").click(); return; }
  if (statues) { send("next", {}, { advance: true }); return; }
  // Blind test : « next » lance, relance ou arrête la musique (la box décide selon l'état du morceau).
  send(st?.phase === "question" && !(st.mime && !st.mime.team) && !blindMode(st) ? "close" : "next", {}, { advance: true });
};
$("c-pause").onclick = () => send(live.state?.paused ? "resume" : "pause", {}, { advance: true });
$("c-fin").onclick = async () => {
  const ok = await demander({
    title: "Fin de la fête ?", ok: "🏁 Fin de la fête",
    text: "La TV quitte l'écran de fin et revient à l'accueil, prête pour la prochaine fête. Les équipes et leurs points restent enregistrés.",
  });
  if (!ok || live.state?.phase !== "ended") return;
  const status = await send("newgame", {}, { advance: true });
  if (status?.status === "applied") toast("🏁 Fête terminée : la TV revient à l'accueil.");
};
$("c-answer").onclick = () => { answerMasked = !answerMasked; render(); };

/**
 * Bouton à appui long (cedric, 29/10) : la jauge se remplit pendant [ms] ; lâché avant, c'est un appui court.
 * [court] et [long] sont appelés au lâcher et à la fin de la jauge ; aucun des deux ne part sans « Êtes-vous sûr ? ».
 */
function appuiLong(btn, ms, { court, long }) {
  let hold = null;
  let fired = false;
  btn.style.setProperty("--jauge", `${ms}ms`);
  const cancel = () => { clearTimeout(hold); btn.classList.remove("pressing"); };
  btn.addEventListener("pointerdown", () => {
    fired = false;
    btn.classList.add("pressing");
    hold = setTimeout(() => { fired = true; cancel(); navigator.vibrate?.(80); long(); }, ms);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((e) => btn.addEventListener(e, cancel));
  btn.onclick = () => { if (!fired) court(); fired = false; };
}

// Les trois confirmations ne s'affichent que sur ce téléphone, jamais sur la TV (cedric, 29/10).
const SUR = { title: "Êtes-vous sûr ?", ok: "Oui", non: "Non" };
const SUR_JEU = { ...SUR, title: "Êtes-vous sûr de vouloir terminer le jeu en cours ?" };

/**
 * « ⏭ Terminer » (cedric, 31/10) : un appui court seulement, plus d'appui long ni de menu. « Êtes-vous sûr de vouloir
 * terminer le jeu en cours ? Oui / Non », puis la suite démarre (jeu suivant, ou podium au dernier jeu).
 */
async function terminerLeJeu() {
  const st = live.state ?? {};
  if (st.phase === "lobby" || st.phase === "ended" || pending?.advance) return;
  const { questions, current, next } = gamesOf(st);
  const nom = current ? `« ${gameName(current, questions)} »` : "Le jeu en cours";
  if (!next) {
    if (!await demander({ ...SUR_JEU, line: "Vous allez passer au podium final.", text: `${nom} est le dernier jeu.` })) return;
    return send("end", {}, { advance: true });
  }
  const suivant = gameName(next, questions);
  if (!await demander({ ...SUR_JEU, line: `Vous allez passer au jeu suivant : «\u00a0${suivant}\u00a0».`, text: `${nom} s'arrête ici. Les points déjà gagnés sont gardés.` })) return;
  const jeu = questions.slice(next.start, next.end + 1);
  copyImages(jeu).catch((e) => console.warn("Illustrations non recopiées", e));
  copySounds(jeu);
  const status = await send("goto", { index: next.start, qid: questions[next.start].id }, { advance: true });
  if (status?.status === "applied") toast(jeuEnCours(st) ? `Bilan des scores sur la TV, puis « ${suivant} ».` : `C'est parti pour « ${suivant} » !`);
}

/**
/** « ⛔ Terminer la partie » → « 🏆 Aller au podium » : les résultats finaux, quel que soit le jeu en cours. */
async function allerAuPodium() {
  const st = live.state ?? {};
  if (st.phase === "lobby" || st.phase === "ended" || pending?.advance) return;
  if (!await demander({ ...SUR, line: "Vous allez passer au podium final.", text: "Les jeux qui restent ne seront pas joués." })) return;
  send("end", {}, { advance: true });
}

/**
 * « ⛔ Terminer la partie » → « ⛔ Terminer définitivement la partie » (cedric, 29/10 et 31/10) : tout s'arrête tout de suite, sans podium ; la TV revient à l'accueil et
 * la régie la suit. Une TV ou un site d'avant refuse « arret » : la partie est alors terminée puis quittée.
 */
async function arreterLaPartie() {
  const st = live.state ?? {};
  if (st.phase === "lobby" || st.leftAt || pending?.advance) return;
  if (!await demander({
    ...SUR, alert: true,
    attention: "Ce bouton va mettre fin définitivement à la partie.",
    text: "Pas de podium : la TV revient tout de suite à l'accueil.",
  })) return;
  let r = await send("newgame", { arret: true }, { advance: true, repli: true });
  if (r?.status === "refused" && (r.reason === "not_ended" || r.reason === "write_denied")) {
    const fin = live.state?.phase === "ended" ? { status: "applied" } : await send("end", {}, { advance: true });
    if (fin?.status === "applied") r = await send("newgame", {}, { advance: true });
  }
  if (r?.status === "applied") toast("⛔ Partie arrêtée : la TV revient à l'accueil.");
}

/** Le choix au bout de la jauge de « ⛔ Terminer la partie » (cedric, 31/10) : « podium », « arret », ou null (annulé). */
function choisirLaFin() {
  return new Promise((resolve) => {
    const box = $("fin-choix");
    const close = (choix) => {
      box.hidden = true;
      $("fin-podium").onclick = $("fin-arret").onclick = $("fin-annuler").onclick = box.onclick = null;
      resolve(choix);
    };
    $("fin-podium").onclick = () => close("podium");
    $("fin-arret").onclick = () => close("arret");
    $("fin-annuler").onclick = () => close(null);
    // Toucher à côté de la fenêtre = annuler.
    box.onclick = (e) => { if (e.target === box) close(null); };
    box.hidden = false;
    $("fin-annuler").focus();
  });
}

/**
 * « ⛔ Terminer la partie », jauge pleine (cedric, 31/10) : aller au podium ou terminer définitivement, puis « Êtes-vous
 * sûr ? ». Partie déjà au podium : il ne reste que la fin définitive.
 */
async function finAuChoix() {
  const st = live.state ?? {};
  if (st.phase === "lobby" || st.leftAt || pending?.advance) return;
  fermerPlus(); // le doigt est encore sur le bouton : « ☰ Plus » se referme derrière le choix
  if (st.phase === "ended") return arreterLaPartie();
  const choix = await choisirLaFin();
  if (choix === "podium") return allerAuPodium();
  if (choix === "arret") return arreterLaPartie();
}

$("c-end").onclick = terminerLeJeu;
// Terminer la partie (cedric, 31/10) : seulement en appui long (1,5 s) ; un appui court ne fait rien, la jauge le montre.
appuiLong($("c-arret"), 1500, { court: () => {}, long: finAuChoix });

$("tab-teams").onclick = () => { tabChosen = true; switchTab("teams"); };
$("tab-plan").onclick = () => { tabChosen = true; switchTab("plan"); };
$("conducteur-retour").onclick = fermerConducteur;
$("tab-show").onclick = () => { tabChosen = true; switchTab("show"); };
$("tab-defis").onclick = () => { tabChosen = true; switchTab("defis"); };
function switchTab(name) {
  // Régie « cockpit » : le conducteur a sa page plein écran (cedric, 30/10).
  if (COCKPIT && name === "plan") return ouvrirConducteur();
  tab = name;
  // Liste des prestations relue à chaque ouverture de l'onglet : elle reflète toujours l'administration.
  if (name === "show" && !loadingShow) shows = null;
  for (const t of ["teams", "plan", "show", "defis"]) {
    if (COCKPIT && t === "plan") continue;
    $(`tab-${t}`).classList.toggle("active", tab === t);
    $(`panel-${t}`).hidden = tab !== t;
  }
  // Défis de la pause : relus et affichés à chaque ouverture de l'onglet.
  if (name === "defis") ouvrirDefis(db, code, $("panel-defis"), toast);
  render();
}

// Après le verrouillage du téléphone, Firebase se reconnecte seul et les écouteurs relisent l'état.
