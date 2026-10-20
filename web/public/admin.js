import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth, signInAnonymously, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, push, onValue, serverTimestamp, connectDatabaseEmulator,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { passwordHash, newSalt, cleanPassword, passwordCandidates, MIN_PASSWORD_LENGTH } from "./secret.js";
import {
  TEST_ID, TEST_QUIZ, TEST_SHOW, FULL_ID, FULL_KEYS, FULL_QUIZZES, FULL_MIMES, FULL_SHOW, FULL_PHOTOS, photoQuiz, drawPhoto,
  FULL_TUNES, FULL_TUNE_SEC, FULL_NEW_ROUNDS, tunePlaylist, FULL_CHOICE_PHOTOS, imageQuiz,
} from "./test-show.js";
import { writeProof, isAdmin } from "./proof.js";
import { parseQuiz, checkQuestions, geminiPrompt, chatgptUrl, imageKey, wordFromImage, photoQuestions, LETTERS } from "./importer.js";
import { PROFILES, profileForAge, defaultDuration } from "./profiles.js";
import {
  buildSnapshot, estimateMinutes, playable, expressQuestions, zoomQuestions, showTitle, ROUND_TYPES, BUILTIN_GAMES, readiness, upcoming, daysUntil, duplicateShow, isoDay,
  roundFilled, MIME_TURN, MUSIC_GAMES, playableTracks, BLIND_SEC, STATUES_SECONDS, STATUES_SEC, PICTO_SECONDS, PICTO_SEC, PICTO_POINTS, PICTO_RULE,
  blindScale, trackPoints, BLIND_REVEAL_SECONDS, QUIZ_GAMES, CONTENT_GAMES, activeItems, contentExtras, contentSlot, contentImages,
  pictoSeriesOf, pictoSeriesList, pictoRoundSeries, foldLegacyFinale, showMatches,
  roundQuizIds, roundPicks, mimeCards, mimeDraw, MIME_RANDOM, MAX_PICKS,
  isStatuesList, statuesSongs, roundSongs, STATUES_EXTRACTS, STATUES_EXTRACT, MAX_STATUES_SONGS,
} from "./show.js";
import { shuffle } from "./mime-cards.js";
import { PICTO_OWN_SERIES } from "./picto-cards.js";
import { EXTRACT_SECONDS, guessTrack, defaultStart, decodeFile, makeExtract, synthTune, encodeMp3, soundId } from "./audio.js";
import { MIME_CATALOG, MIME_THEMES } from "./mime-cards.js";
import { watchVersion, showUpdateBanner } from "./version.js";
import { compressImage, imageId, cleanEmoji, CHOICE_IMAGE } from "./illustration.js";
import { afficherMotsDePasse } from "./oeil.js";
import { historique, noterEcran } from "./retour.js";

// Petit œil sur les champs de mot de passe : voir ce qu'on tape (majuscules, caractère en trop).
afficherMotsDePasse();

// Nouvelle version publiée pendant que l'administration est ouverte : on propose de recharger, sans rien perdre d'office.
watchVersion(() => showUpdateBanner("Une nouvelle version de l'administration est en ligne. Enregistrez votre travail, puis mettez à jour."));

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
let contents = {};
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

function status(id, text, ok = false) {
  $(id).textContent = text;
  $(id).classList.toggle("ok", ok);
}

const SCREENS = ["login", "home", "shows", "show-edit", "games", "builtin", "quizzes", "import", "review", "settings", "mimes", "mime-edit", "music", "playlist-edit"];
function show(name) {
  // Quiz, mimes et musique se rangent sous « Jeux » dans le menu (cedric) : c'est l'onglet Jeux qui reste allumé.
  if (["home", "shows", "games", "settings"].includes(name)) current = name;
  if (["quizzes", "mimes", "music", "builtin", "import", "review", "mime-edit", "playlist-edit"].includes(name)) current = "games";
  SCREENS.forEach((s) => { $(`screen-${s}`).hidden = s !== name; });
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.screen === current));
  window.scrollTo(0, 0);
  if (name === "home") renderHome();
  if (name === "games") renderGames();
  if (name === "shows") renderShows();
  if (name === "quizzes") renderQuizzes();
  if (name === "mimes") renderMimes();
  if (name === "music") renderPlaylists();
  if (name !== "playlist-edit") stopPreview();
  if (name === "settings") showLastChange();
}
document.querySelectorAll("[data-screen]").forEach((b) => { b.onclick = () => show(b.dataset.screen); });

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
  show("login");
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
  show(current);
}

route();

function refreshLists() {
  if (!$("screen-home").hidden) renderHome();
  if (!$("screen-games").hidden) renderGames();
  if (!$("screen-builtin").hidden) renderBuiltin();
  if (!$("screen-shows").hidden) renderShows();
  if (!$("screen-quizzes").hidden) renderQuizzes();
  if (!$("screen-mimes").hidden) renderMimes();
  if (!$("screen-music").hidden) renderPlaylists();
  if (!$("screen-show-edit").hidden) refreshRounds();
}

const byDate = ([, a], [, b]) => (a.date ?? "9999").localeCompare(b.date ?? "9999");
const dateLabel = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "sans date");
const STATUS_LABELS = { brouillon: "Brouillon", publiee: "Prête", archivee: "Archivée" };

// ---------- Tableau de bord ----------

const shortDate = (d) => {
  const day = new Date(`${d}T12:00:00`);
  return { day: day.getDate(), month: day.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "") };
};
const whenLabel = (d) => {
  const n = daysUntil(d);
  return n === 0 ? "aujourd'hui" : n === 1 ? "demain" : n > 1 ? `dans ${n} jours` : "passée";
};

function renderHome() {
  const coming = upcoming(shows);
  // Les anniversaires passés ne comptent plus : seuls ceux à venir ou encore sans date.
  const today = isoDay();
  const pending = Object.values(shows).filter((s) => !s.date || s.date >= today);
  $("stat-upcoming").textContent = coming.length;
  $("stat-ready").textContent = coming.filter(([, s]) => readiness(s, quizzes, mimes, playlists, contents).level === "prete").length;
  $("stat-todo").textContent = pending.filter((s) => readiness(s, quizzes, mimes, playlists, contents).level === "a-completer").length;
  const box = $("home-upcoming");
  box.replaceChildren(...coming.slice(0, 6).map(([id, s]) => showCard(id, s)));
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
      const { line, actions } = gameInfo(g);
      const open = actions[0]?.[1] ?? (() => openGameCard(g.type));
      return h("button", { class: "tile", "data-game": g.type, ...(GAME_SCREENS[g.type] ? { "data-screen": GAME_SCREENS[g.type] } : {}), onclick: open },
        h("span", { class: "tile-icon", text: g.icon }), h("b", { text: ROUND_TYPES[g.type] }), h("span", { text: line }));
    })))));
}

/** Page de contenu des tuiles principales (repère pour les tests et l'aide). */
const GAME_SCREENS = { quiz: "quizzes", mimes: "mimes", blind: "music" };

/** Fiche d'un jeu sur la page Jeux (jeux sans contenu à préparer), mise en avant. */
function openGameCard(type) {
  show("games");
  const card = document.querySelector(`.game-card[data-game="${type}"]`);
  if (!card) return;
  card.scrollIntoView({ block: "center" });
  card.classList.add("flash");
  setTimeout(() => card.classList.remove("flash"), 1600);
}

/** « 18 questions · 1 manche de mimes » : ce que contient une prestation. */
function contentLabel(snapshot) {
  const items = snapshot.quiz.questions;
  const q = items.filter((x) => x.kind !== "mime" && x.kind !== "pictionary").length;
  const m = items.filter((x) => x.kind === "mime").length;
  const p = items.filter((x) => x.kind === "pictionary").length;
  return [q ? `${q} question${q > 1 ? "s" : ""}` : "", m ? `${m} manche${m > 1 ? "s" : ""} de mimes` : "", p ? `${p} Pictionary` : ""].filter(Boolean).join(" · ");
}
$("home-new").onclick = () => editShow(null);

// ---------- Prestations ----------

/** Carte d'une prestation : date, prénom, âge, état de préparation et actions. */
function showCard(id, s) {
  const r = readiness(s, quizzes, mimes, playlists, contents);
  const { snapshot } = buildSnapshot(id, s, quizzes, mimes, Math.random, playlists, contents);
  const date = s.date ? shortDate(s.date) : null;
  return h("article", { class: `card show-card ${r.level}`, "data-show": id },
    h("div", { class: "date-chip" }, date ? [h("b", { text: `${date.day}` }), h("span", { text: date.month })] : h("span", { text: "sans date" })),
    h("div", { class: "card-body" },
      h("b", { class: "card-title", text: showTitle(s) }),
      h("span", { class: "meta", text: [s.childName, s.age ? `${s.age} ans` : "", s.date ? `${dateLabel(s.date)} (${whenLabel(s.date)})` : ""].filter(Boolean).join(" · ") }),
      snapshot ? h("span", { class: "meta", text: `${contentLabel(snapshot)} · environ ${estimateMinutes(snapshot)} min` }) : null,
      r.level === "prete"
        ? h("span", { class: "pill ok", text: "✓ Prête : visible sur la régie" })
        : r.level === "archivee"
          ? h("span", { class: "pill", text: "Archivée" })
          : h("div", { class: "todo" }, h("span", { class: "pill warn", text: "À compléter" }), h("ul", {}, ...r.todo.map((t) => h("li", { text: t })))),
      h("div", { class: "card-actions" },
        h("button", { class: "btn small", onclick: () => editShow(id), text: "Ouvrir" }),
        h("button", { class: "btn small secondary", onclick: () => editShow(null, s), text: "Dupliquer" }),
        h("button", { class: "btn small secondary", onclick: () => rename(`library/shows/${id}`, showTitle(s), "de la prestation"), text: "Renommer" }),
        s.status === "archivee"
          ? h("button", { class: "btn small secondary", onclick: () => archive(id, false), text: "Désarchiver" })
          : h("button", { class: "btn small secondary", onclick: () => archive(id, true), text: "Archiver" }))));
}

function renderShows() {
  const today = isoDay();
  // Recherche : seules les prestations qui contiennent tous les mots tapés, archives et anniversaires passés compris.
  const query = $("show-search").value.trim();
  const list = Object.entries(shows).filter(([, s]) => s && showMatches(s, query, { quizzes, mimes, playlists })).sort(byDate);
  const active = list.filter(([, s]) => s.status !== "archivee" && (!s.date || s.date >= today));
  const past = list.filter(([, s]) => s.status !== "archivee" && s.date && s.date < today).reverse();
  const archived = list.filter(([, s]) => s.status === "archivee");
  $("show-list").replaceChildren(...active.map(([id, s]) => showCard(id, s)));
  if (!active.length) $("show-list").append(h("p", { class: "hint", text: "Aucune prestation en cours de préparation." }));
  $("show-past").hidden = !past.length;
  $("show-past-count").textContent = past.length;
  $("show-past-list").replaceChildren(...past.map(([id, s]) => showCard(id, s)));
  $("show-archives").hidden = !archived.length;
  $("show-archive-count").textContent = archived.length;
  $("show-archive-list").replaceChildren(...archived.map(([id, s]) => showCard(id, s)));
  if (query) {
    // Les résultats rangés dans les anniversaires passés ou les archives s'ouvrent tout seuls.
    $("show-past").open = past.length > 0;
    $("show-archives").open = archived.length > 0;
    if (!active.length) $("show-list").replaceChildren(h("p", { class: "hint", text: list.length ? "Rien en préparation pour cette recherche : voir plus bas." : "Aucune prestation ne correspond à cette recherche." }));
  }
  $("show-search-count").textContent = query ? `${list.length} prestation${list.length > 1 ? "s" : ""} trouvée${list.length > 1 ? "s" : ""}` : "";
}
$("show-search").addEventListener("input", () => renderShows());

/**
 * « Renommer » : nouveau titre d'une prestation, d'un quiz, d'un paquet de mimes ou d'une playlist, sans rien
 * changer d'autre. Les prestations qui s'en servent affichent tout de suite le nouveau nom.
 */
async function rename(path, current, what) {
  const asked = prompt(`Nouveau nom ${what} :`, current ?? "");
  if (asked === null) return false;
  const title = asked.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!title || title === current) return false;
  try {
    await update(ref(db, path), { title, updatedAt: serverTimestamp() });
    return true;
  } catch (err) {
    console.error(err);
    alert("Renommage refusé : vérifiez Internet ou reconnectez-vous.");
    return false;
  }
}

/** Archiver range la prestation (elle disparaît de la régie) ; désarchiver la remet en brouillon. */
async function archive(id, on) {
  try {
    await update(ref(db, `library/shows/${id}`), { status: on ? "archivee" : "brouillon", updatedAt: serverTimestamp() });
  } catch (err) {
    console.error(err);
    alert("Modification refusée : vérifiez Internet ou reconnectez-vous.");
  }
}

let editing = null; // { id, rounds }
let reuseChoices = new Map(); // manches reprises d'autres prestations, par « prestation/n° »

$("show-profile").append(
  h("option", { value: "", text: "Automatique, selon l'âge" }),
  ...Object.entries(PROFILES).map(([k, p]) => h("option", { value: k, text: p.label })),
);
$("show-new").onclick = () => editShow(null);

/** Ouvre une prestation ; sans identifiant, une nouvelle, vide ou copiée d'une autre (`from`). */
function editShow(id, from = null) {
  const s = id ? shows[id] : from ? duplicateShow(from) : { status: "brouillon", rounds: [] };
  // Une ancienne manche « Super Finale » n'est pas un jeu : elle devient le réglage ×2 du quiz qui la précède.
  const { rounds, folded } = foldLegacyFinale(s.rounds);
  editing = { id, rounds };
  $("show-edit-title").textContent = id ? showTitle(s) : from ? `Copie de « ${showTitle(from)} »` : "Nouvelle prestation";
  $("show-child").value = s.childName ?? "";
  $("show-age").value = s.age ?? "";
  $("show-date").value = s.date ?? "";
  $("show-status").value = s.status ?? "brouillon";
  $("show-title").value = s.title ?? "";
  $("show-profile").value = s.profile ?? "";
  $("show-duration").value = s.durationMin ?? "";
  $("show-themes").value = s.themes ?? "";
  $("show-notes").value = s.notes ?? "";
  $("show-delete").hidden = !id;
  status("show-status-msg", from ? "Copie prête : indiquez le prénom, l'âge et la date du nouvel anniversaire, puis enregistrez."
    : folded ? "L'ancienne manche « Super Finale » est devenue le réglage du quiz (ses dernières questions ×2). Enregistrez pour garder ce changement." : "", !!from || !!folded);
  show("show-edit");
  refreshRounds();
  histPrestation.depart();
  if (from) $("show-child").focus();
}

/** Champs de la fiche d'une prestation, gardés par « Retour » et « Annuler les modifications ». */
const SHOW_FIELDS = ["show-child", "show-age", "show-date", "show-status", "show-title", "show-profile", "show-duration", "show-themes", "show-notes"];
const histPrestation = historique({
  ecran: $("screen-show-edit"),
  capturer: () => ({ rounds: editing?.rounds ?? [], champs: SHOW_FIELDS.map((id) => $(id).value) }),
  restaurer: (e) => {
    SHOW_FIELDS.forEach((id, k) => { $(id).value = e.champs[k]; });
    if (editing) editing.rounds = e.rounds;
    refreshRounds();
  },
});

function formShow() {
  const num = (v) => (v === "" ? null : Number(v));
  return {
    childName: $("show-child").value.trim(),
    age: num($("show-age").value),
    date: $("show-date").value || null,
    status: $("show-status").value,
    title: $("show-title").value.trim() || null,
    profile: $("show-profile").value || null,
    durationMin: num($("show-duration").value),
    themes: $("show-themes").value.trim() || null,
    notes: $("show-notes").value.trim() || null,
    rounds: editing.rounds.filter(roundFilled).map((r) => (BUILTIN_GAMES[r.type] ? { type: r.type, count: r.count ?? BUILTIN_GAMES[r.type].count, ...(r.type === "disparu" && r.objects ? { objects: r.objects } : {}), ...picksOf(r) }
      // Mimes : un paquet, ou le catalogue au hasard ; cartes choisies (tirage modifié à la main) gardées dans la manche.
      : r.type === "mimes" ? { type: "mimes", ...(r.deckId ? { deckId: r.deckId } : { random: true }), ...(mimeCards(r.cards).length ? { cards: mimeCards(r.cards).slice(0, 200) } : {}) }
      : r.type === "statues" ? { type: "statues", duration: r.duration ?? STATUES_SEC, ...(roundSongs(r, playlists).length ? { songs: roundSongs(r, playlists).map((t) => t.audioId) } : {}) }
      : r.type === "pictionary" ? { type: "pictionary", duration: r.duration ?? PICTO_SEC, ...(pictoRoundSeries(r) ? { series: pictoRoundSeries(r) } : {}), ...picksOf(r) }
      : r.type === "coffres" ? { type: "coffres" }
      : r.type === "gonfleur" ? { type: "gonfleur" }
      : r.type === "patate" ? { type: "patate" }
      : MUSIC_GAMES[r.type] ? { type: r.type, playlistId: r.playlistId }
      : { type: r.type ?? "quiz", quizId: roundQuizIds(r)[0], ...(roundQuizIds(r).length > 1 ? { quizIds: roundQuizIds(r) } : {}), ...(r.count > 0 ? { count: r.count } : {}), ...((r.type ?? "quiz") === "quiz" && r.finale > 0 ? { finale: r.finale } : {}) })),
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

/** Mots du Pictionary tirés par « Tirer au hasard ». */
const PICTO_DRAW = 24;

/**
 * Sélection modifiable d'une manche à cartes (mimes, mots, personnages, familles) : « Tirer au hasard » remplit la
 * liste, ✕ retire un élément, « Ajouter » en reprend un du catalogue. Liste vide : la box tire au hasard au lancement,
 * comme avant. [items] : tout ce qu'on peut choisir ({ key, label, group }) ; [get]/[set] : les clés choisies.
 */
function selectionEditor({ items, get, set, draw, unit, empty, own }) {
  const box = h("div", { class: "pick-box" });
  const paint = () => {
    const all = items();
    const byKey = new Map(all.map((x) => [x.key, x]));
    const chosen = get();
    const change = (keys) => { set(keys); paint(); refreshSummary(); };
    const groups = [...new Set(all.filter((x) => !chosen.includes(x.key)).map((x) => x.group ?? ""))];
    const e = unit === "carte" || unit === "famille" ? "e" : "";
    const n = chosen.length;
    box.replaceChildren(...[
      h("span", { class: "small", text: n ? `${n} ${unit}${n > 1 ? "s" : ""} choisi${e}${n > 1 ? "s" : ""} : la manche joue exactement cette liste.` : empty }),
      h("button", { type: "button", class: "chip pick-draw", text: "🎲 Tirer au hasard", onclick: () => change(draw()) }),
      chosen.length ? h("button", { type: "button", class: "chip", text: "Tout retirer (tirage au lancement)", onclick: () => change([]) }) : null,
      h("div", { class: "pick-list" }, ...chosen.map((k) => h("button", {
        type: "button", class: "chip pick-item", "data-key": k, title: "Retirer", text: `${byKey.get(k)?.label ?? k} ✕`,
        onclick: () => change(chosen.filter((x) => x !== k)),
      }))),
      chosen.length < MAX_PICKS ? h("select", { class: "pick-add", "aria-label": `Ajouter un ${unit}`, onchange: (ev) => { if (ev.target.value) change([...chosen, ev.target.value]); } },
        h("option", { value: "", text: `＋ Ajouter un${e} ${unit}…` }),
        ...groups.map((g) => {
          const opts = all.filter((x) => (x.group ?? "") === g && !chosen.includes(x.key)).map((x) => h("option", { value: x.key, text: x.label }));
          return g ? h("optgroup", { label: g }, ...opts) : opts;
        })) : null,
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
    const list = deck ? mimeCards(deck.cards).map((c) => ({ card: c })) : MIME_CATALOG.map((c) => ({ card: mimeCards([c])[0], group: c.theme }));
    list.forEach((x) => extra.set(x.card.word.toLowerCase(), extra.get(x.card.word.toLowerCase()) ?? x.card));
    return list;
  };
  return selectionEditor({
    unit: "carte",
    empty: r.deckId ? "Aucune carte choisie : tout le paquet, mélangé au lancement." : `Aucune carte choisie : ${MIME_RANDOM} cartes au hasard au lancement, selon l'âge.`,
    items: () => {
      const list = pool().map((x) => ({ key: x.card.word.toLowerCase(), label: `${x.card.image ?? ""} ${x.card.word}`.trim(), group: x.group }));
      const keys = new Set(list.map((x) => x.key));
      // Cartes ajoutées à la main (absentes du paquet) : elles restent dans la liste.
      mimeCards(r.cards).filter((c) => !keys.has(c.word.toLowerCase())).forEach((c) => list.push({ key: c.word.toLowerCase(), label: `${c.image ?? ""} ${c.word}`.trim(), group: "Mes cartes" }));
      return list;
    },
    get: () => mimeCards(r.cards).map((c) => c.word.toLowerCase()),
    set: (keys) => { r.cards = keys.map((k) => extra.get(k)).filter(Boolean); },
    draw: () => mimeDraw({ deckId: r.deckId }, mimes, formProfile()).map((c) => { extra.set(c.word.toLowerCase(), c); return c.word.toLowerCase(); }),
    own: (word) => {
      const c = mimeCards([{ word }])[0];
      if (!c) return null;
      extra.set(c.word.toLowerCase(), extra.get(c.word.toLowerCase()) ?? c);
      return c.word.toLowerCase();
    },
  });
}

/** Jeux intégrés et Pictionary : éléments choisis un par un parmi ceux de la page Jeux. */
function picksSelection(r) {
  const game = CONTENT_GAMES[r.type];
  const builtin = BUILTIN_GAMES[r.type];
  const unit = r.type === "disparu" ? "famille" : game.unit;
  return selectionEditor({
    unit,
    empty: r.type === "pictionary" ? "Aucun mot choisi : tirage au hasard au lancement, dans les séries cochées." : unit === "famille" ? "Aucune famille choisie : tirage au hasard au lancement." : `Aucun ${unit} choisi : tirage au hasard au lancement.`,
    items: () => activeItems(r.type, contents[r.type]).map((x) => ({ key: game.key(x), label: game.label(x), group: r.type === "pictionary" ? pictoSeriesOf(x) : undefined })),
    get: () => roundPicks(r),
    set: (keys) => {
      const had = roundPicks(r).length > 0;
      r.picks = keys.length ? keys : null;
      // Le nombre d'éléments ne sert qu'au tirage au lancement : caché dès qu'on choisit, remis sinon.
      if (had !== keys.length > 0) queueMicrotask(refreshRounds);
    },
    draw: () => {
      const profile = formProfile();
      if (r.type === "pictionary") {
        const series = pictoRoundSeries(r);
        const words = activeItems("pictionary", contents.pictionary).filter((w) => (profile !== "PETITS" || w.level !== 2) && (!series || series.includes(pictoSeriesOf(w))));
        return shuffle(words).slice(0, PICTO_DRAW).map(game.key);
      }
      return shuffle(builtin.items(profile, Math.random, activeItems(r.type, contents[r.type]), r)).slice(0, r.count ?? builtin.count).map((x) => game.key(r.type === "disparu" ? { theme: x.theme } : x));
    },
  });
}

/** Quiz d'une manche : un ou plusieurs, leurs questions à la suite dans le même jeu (jamais tirées au hasard). */
function quizSelection(r, options) {
  const ids = roundQuizIds(r);
  const label = (q) => (r.type === "express" ? `${q.title} (${expressQuestions(q).length} Vrai / Faux)`
    : r.type === "zoom" || r.type === "flou" ? `${q.title} (${zoomQuestions(q).length} avec photo)` : `${q.title} (${playable(q).length} validées)`);
  const setIds = (list) => {
    const clean = [...new Set(list.filter(Boolean))];
    r.quizId = clean[0] ?? "";
    r.quizIds = clean.length > 1 ? clean : null;
    refreshRounds();
  };
  const select = (current, k) => h("select", {
    class: "grow", "aria-label": k === 0 ? "Quiz de la manche" : `Quiz ${k + 1} de la manche`,
    onchange: (e) => { const next = [...ids]; next[k] = e.target.value; setIds(next); },
  },
  h("option", { value: "", text: "Choisir un quiz…" }),
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
    const set = (list) => { r.series = list.length ? list : null; draw(); refreshSummary(); };
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
 * Statues musicales : les chansons de la liste (page Jeux), à cocher pour la manche ; jouées dans l'ordre de la liste.
 * Aucune cochée : la musique de la fête, sur la TV. Une nouvelle manche part avec toutes les chansons cochées.
 */
function songsPicker(r) {
  const songs = statuesSongs(playlists);
  if (!Array.isArray(r.songs)) r.songs = songs.map((t) => t.audioId).slice(0, MAX_STATUES_SONGS);
  const chosen = new Set(r.songs);
  const manage = h("button", { type: "button", class: "link", text: songs.length ? "Gérer les chansons" : "Ajouter vos chansons (page Jeux)", onclick: () => openStatuesSongs() });
  if (!songs.length) return h("p", { class: "hint small statues-songs" }, "Musique de la fête (aucune chanson dans la liste). ", manage);
  return h("div", { class: "statues-songs" },
    h("p", { class: "hint small", text: !chosen.size ? "Aucune chanson cochée : musique de la fête." : roundSongs(r, playlists).length === 1 ? "1 chanson cochée, jouée en boucle :" : `${roundSongs(r, playlists).length} chansons cochées, jouées l'une après l'autre :` }),
    ...songs.map((t) => h("label", { class: "inline statues-song" },
      h("input", {
        type: "checkbox", value: t.audioId, checked: chosen.has(t.audioId),
        onchange: (e) => {
          const keep = new Set(r.songs);
          if (e.target.checked) keep.add(t.audioId); else keep.delete(t.audioId);
          r.songs = songs.map((x) => x.audioId).filter((id) => keep.has(id)).slice(0, MAX_STATUES_SONGS);
          refreshRounds();
        },
      }),
      t.artist?.trim() ? `${t.title} (${t.artist.trim()})` : t.title)),
    manage);
}

function refreshRounds() {
  if (!editing) return;
  refreshReuse();
  const box = $("show-rounds");
  box.innerHTML = "";
  const options = Object.entries(quizzes).sort(([, a], [, b]) => a.title.localeCompare(b.title));
  const decks = Object.entries(mimes).sort(([, a], [, b]) => a.title.localeCompare(b.title));
  const lists = Object.entries(playlists).filter(([, p]) => !isStatuesList(p)).sort(([, a], [, b]) => a.title.localeCompare(b.title));
  if (!editing.rounds.length) box.append(h("p", { class: "hint small", text: "Ajoutez au moins une manche." }));
  editing.rounds.forEach((r, i) => {
    const move = (d) => { const [x] = editing.rounds.splice(i, 1); editing.rounds.splice(i + d, 0, x); refreshRounds(); };
    box.append(h("div", { class: "round" },
      h("span", { class: "num", text: `${i + 1}` }),
      h("select", { "aria-label": "Type de manche", onchange: (e) => { r.type = e.target.value; refreshRounds(); } },
        // La Super Finale n'est pas un jeu : c'est un réglage de la manche Quiz (ses dernières questions ×2).
        ...Object.entries(ROUND_TYPES).filter(([k]) => k !== "finale" && k !== "portes").map(([k, label]) => h("option", {
          value: k, selected: (r.type ?? "quiz") === k, text: label,
        }))),
      BUILTIN_GAMES[r.type]
        // Jeux au buzzer intégrés : rien à préparer, seulement combien de mots ou de personnages.
        ? h("div", { class: "grow picto-round" },
          roundPicks(r).length ? null : h("select", { class: "grow", "aria-label": "Nombre", onchange: (e) => { r.count = Number(e.target.value); refreshSummary(); } },
            ...[4, 5, 6, 8, 10].map((n) => h("option", {
              value: n, selected: (r.count ?? BUILTIN_GAMES[r.type].count) === n,
              text: `${n} ${BUILTIN_GAMES[r.type].unit}s (${BUILTIN_GAMES[r.type].rule})`,
            }))),
          picksSelection(r))
        : r.type === "statues"
        // Statues musicales : la durée de la musique et les chansons cochées (aucune : la musique de la fête).
        ? h("div", { class: "grow picto-round" },
          h("select", { class: "grow", "aria-label": "Durée", onchange: (e) => { r.duration = Number(e.target.value); refreshSummary(); } },
            ...STATUES_SECONDS.map((n) => h("option", { value: n, selected: (r.duration ?? STATUES_SEC) === n, text: `${n} secondes de musique (on danse, on se fige à l'arrêt ; vous désignez l'équipe gagnante)` }))),
          songsPicker(r))
        : r.type === "pictionary"
        // Pictionary : les mots viennent du catalogue (page Jeux) ; le temps de dessin et les séries de mots.
        ? h("div", { class: "grow picto-round" },
          h("select", { "aria-label": "Temps de dessin", onchange: (e) => { r.duration = Number(e.target.value); refreshSummary(); } },
            ...PICTO_SECONDS.map((n) => h("option", { value: n, selected: (r.duration ?? PICTO_SEC) === n, text: `${n} secondes de dessin par équipe (un mot par tour, ${PICTO_POINTS} points s'il est trouvé)` }))),
          pictoSeriesPicker(r),
          picksSelection(r))
        : r.type === "coffres"
        // La bombe cachée : rien à préparer, le nombre de coffres suit le nombre d'équipes.
        ? h("span", { class: "grow hint small", text: "Rien à préparer : le nombre de coffres suit le nombre d'équipes. Idéal en dernier jeu." })
        : r.type === "patate"
        ? h("span", { class: "grow hint small", text: "Rien à préparer : la TV tire la mèche au sort, la bombe part d'une équipe au hasard." })
        : r.type === "gonfleur"
        ? h("span", { class: "grow hint small", text: "Rien à préparer : chaque équipe tapote sa tablette, le premier ballon qui éclate gagne." })
        : MUSIC_GAMES[r.type]
        ? h("select", { class: "grow", "aria-label": "Playlist", onchange: (e) => { r.playlistId = e.target.value; refreshSummary(); } },
          h("option", { value: "", text: lists.length ? "Choisir une playlist…" : "Aucune playlist : créez-en une dans Blind test" }),
          ...lists.map(([pid, p]) => h("option", { value: pid, selected: r.playlistId === pid, text: `${p.title} (${playableTracks(p).length} morceaux, extraits de ${p.duration ?? BLIND_SEC} s)` })))
        : r.type === "mimes"
        ? h("div", { class: "grow picto-round" },
          h("select", {
            class: "grow", "aria-label": "Paquet de mimes",
            // Changer de paquet repart d'un tirage au lancement : les cartes choisies venaient de l'autre.
            onchange: (e) => { const v = e.target.value; r.random = v === "hasard"; r.deckId = v === "hasard" ? null : v; r.cards = null; refreshRounds(); },
          },
          h("option", { value: "", text: "Choisir un paquet de mimes…" }),
          h("option", { value: "hasard", selected: !r.deckId && r.random === true, text: `🎲 Cartes du catalogue, selon l'âge (${MIME_RANDOM} au hasard, ou choisies ci-dessous)` }),
          ...decks.map(([did, d]) => h("option", { value: did, selected: r.deckId === did, text: `${d.title} (${(d.cards ?? []).length} cartes, tour de ${d.duration ?? MIME_TURN} s)` }))),
          r.deckId || r.random === true || mimeCards(r.cards).length ? mimeSelection(r) : null)
        : quizSelection(r, options),
      // Qui a disparu ? : objets par grille, pour régler la difficulté (par défaut selon l'âge de la prestation).
      r.type === "disparu"
        ? h("select", { class: "count", "aria-label": "Objets par grille", onchange: (e) => { r.objects = Number(e.target.value) || null; refreshSummary(); } },
          h("option", { value: "", text: "Objets : selon l'âge" }),
          ...[4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => h("option", { value: n, selected: r.objects === n, text: `${n} objets par grille` })))
        : null,
      // Jeux tirés d'un quiz : toutes ses questions retenues, ou seulement les premières.
      !BUILTIN_GAMES[r.type] && r.type !== "statues" && r.type !== "pictionary" && r.type !== "coffres" && r.type !== "gonfleur" && r.type !== "patate" && r.type !== "mimes" && !MUSIC_GAMES[r.type]
        ? h("select", { class: "count", "aria-label": "Nombre de questions", onchange: (e) => { r.count = Number(e.target.value) || null; refreshSummary(); } },
          h("option", { value: "", text: "Toutes les questions" }),
          ...[1, 2, 3, 4, 5, 6, 8, 10, 12, 15].map((n) => h("option", { value: n, selected: r.count === n, text: n === 1 ? "La première seulement" : `Les ${n} premières` })))
        : null,
      (r.type ?? "quiz") === "quiz"
        ? h("select", { class: "finale", "aria-label": "Super Finale", onchange: (e) => { r.finale = Number(e.target.value) || null; refreshSummary(); } },
          h("option", { value: "", text: "Sans Super Finale" }),
          ...[1, 2, 3, 4, 5].map((n) => h("option", { value: n, selected: r.finale === n, text: n === 1 ? "Super Finale : la dernière question ×2" : `Super Finale : les ${n} dernières ×2` })))
        : null,
      h("button", { type: "button", class: "icon", title: "Monter", disabled: i === 0, onclick: () => move(-1), text: "↑" }),
      h("button", { type: "button", class: "icon", title: "Descendre", disabled: i === editing.rounds.length - 1, onclick: () => move(1), text: "↓" }),
      h("button", { type: "button", class: "icon", title: "Retirer", onclick: () => { editing.rounds.splice(i, 1); refreshRounds(); }, text: "✕" })));
  });
  refreshSummary();
}

function refreshSummary() {
  const s = formShow();
  const { snapshot, problems } = buildSnapshot(editing?.id ?? "nouvelle", s, quizzes, mimes, Math.random, playlists, contents);
  const profile = PROFILES[s.profile] ? s.profile : profileForAge(s.age);
  $("show-summary").textContent = snapshot
    ? `${contentLabel(snapshot)} jouables · environ ${estimateMinutes(snapshot)} min · chrono ${defaultDuration(profile)} s par question (profil ${PROFILES[profile].label}) sauf durée imposée`
    : "";
  $("show-problems").replaceChildren(...problems.map((p) => h("li", { text: p })));
  const r = readiness(s, quizzes, mimes, playlists, contents);
  $("show-ready").className = `ready-box ${r.level}`;
  $("show-ready").replaceChildren(r.level === "prete"
    ? h("b", { text: "✓ Prestation prête : elle est visible sur la régie." })
    : r.level === "archivee"
      ? h("b", { text: "Prestation archivée : elle n'apparaît plus sur la régie." })
      : h("div", {}, h("b", { text: "Reste à faire avant le jour J :" }), h("ul", {}, ...r.todo.map((t) => h("li", { text: t })))));
}
["show-age", "show-profile", "show-child", "show-title", "show-date", "show-status"].forEach((id) => $(id).addEventListener("input", refreshSummary));
$("round-add").onclick = () => { editing.rounds.push({ type: "quiz", quizId: "" }); refreshRounds(); };

/**
 * Manches des autres prestations, à reprendre telles quelles : la nouvelle manche pointe vers le même
 * quiz de la bibliothèque, l'ancienne prestation et le quiz ne sont pas modifiés.
 */
function refreshReuse() {
  const options = Object.entries(shows)
    .filter(([id]) => id !== editing?.id)
    .sort(([, a], [, b]) => (b.date ?? "").localeCompare(a.date ?? ""))
    // Une ancienne manche « Super Finale » ne se reprend pas : ce n'est pas un jeu.
    .flatMap(([id, s]) => (s.rounds ?? []).map((r, i) => [r, i]).filter(([r]) => r && r.type !== "finale" && roundContent(r) != null).map(([r, i]) => ({
      value: `${id}/${i}`, round: r,
      text: `${showTitle(s)}${s.date ? ` (${new Date(`${s.date}T12:00:00`).toLocaleDateString("fr-FR")})` : ""} · ${ROUND_TYPES[r.type] && r.type !== "quiz" ? ROUND_TYPES[r.type] : "Manche"}${roundContent(r) ? ` : ${roundContent(r)}` : ""}`,
    })));
  reuseChoices = new Map(options.map((o) => [o.value, o.round]));
  $("round-reuse").replaceChildren(
    h("option", { value: "", text: options.length ? "Choisir une manche…" : "Aucune autre prestation" }),
    ...options.map((o) => h("option", { value: o.value, text: o.text })));
  $("round-reuse").disabled = !options.length;
}
/** Contenu d'une manche (titre du quiz, du paquet, de la playlist), "" pour un jeu sans contenu, null s'il n'existe plus. */
function roundContent(r) {
  if (!r?.type && !r?.quizId) return null;
  if (BUILTIN_GAMES[r.type] || r.type === "statues" || r.type === "pictionary" || r.type === "coffres" || r.type === "portes" || r.type === "gonfleur" || r.type === "patate") return "";
  if (r.type === "mimes") return r.deckId ? mimes[r.deckId]?.title ?? null : "cartes au hasard";
  if (MUSIC_GAMES[r.type]) return playlists[r.playlistId]?.title ?? null;
  const titles = roundQuizIds(r).map((id) => quizzes[id]?.title);
  return titles.length && titles.every(Boolean) ? titles.join(" + ") : null;
}
$("round-reuse").onchange = (e) => {
  const r = reuseChoices.get(e.target.value);
  if (!r) return;
  // Copie de la manche (même contenu de la bibliothèque, mêmes réglages) : l'autre prestation ne change pas.
  editing.rounds.push(JSON.parse(JSON.stringify(r)));
  e.target.value = "";
  refreshRounds();
};

$("show-form").onsubmit = async (e) => {
  e.preventDefault();
  const s = formShow();
  if (!s.childName) return status("show-status-msg", "Indiquez le prénom de l'enfant fêté.");
  if (s.status === "publiee") {
    const { snapshot, problems } = buildSnapshot("x", s, quizzes, mimes, Math.random, playlists, contents);
    if (!snapshot) {
      const why = problems.filter((p) => p.startsWith("Manche"));
      return status("show-status-msg", `Elle ne peut pas encore être « Prête » : ${why.length ? why.join(" ") : "ajoutez une manche jouable (quiz avec des questions validées, mimes, musique ou jeu intégré)."}`);
    }
  }
  const id = editing.id ?? push(ref(db, "library/shows")).key;
  const prev = shows[id] ?? {};
  $("show-save").disabled = true;
  try {
    await set(ref(db, `library/shows/${id}`), {
      ...s, origin: prev.origin ?? "admin", createdAt: prev.createdAt ?? Date.now(),
      updatedAt: serverTimestamp(),
    });
    editing.id = id;
    histPrestation.enregistre();
    $("show-delete").hidden = false;
    $("show-edit-title").textContent = showTitle(s);
    status("show-status-msg", s.status === "publiee" ? "Enregistrée. Elle est visible sur la régie." : "Enregistrée.", true);
  } catch (err) {
    console.error(err);
    status("show-status-msg", "Enregistrement refusé : vérifiez les champs ou vos droits d'administration.");
  } finally {
    $("show-save").disabled = false;
  }
};

$("show-delete").onclick = async () => {
  if (!editing?.id || !confirm("Supprimer cette prestation ? Les parties déjà jouées ne changent pas.")) return;
  await set(ref(db, `library/shows/${editing.id}`), null);
  show("shows");
};

// ---------- Bibliothèque de quiz ----------

function renderQuizzes() {
  const box = $("quiz-list");
  box.innerHTML = "";
  const list = Object.entries(quizzes).sort(([, a], [, b]) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  if (!list.length) box.append(h("p", { class: "hint", text: "Aucun quiz pour l'instant : « Créer un quiz » vous guide pas à pas." }));
  list.forEach(([id, q]) => {
    const total = (q.questions ?? []).filter(Boolean).length;
    const ok = playable(q).length;
    const ages = q.ageMin ? `${q.ageMin}${q.ageMax && q.ageMax !== q.ageMin ? ` à ${q.ageMax}` : ""} ans` : "";
    box.append(h("div", { class: "item", "data-quiz": id },
      h("b", { text: q.title }),
      h("span", { text: [q.theme, ages, SOURCES[q.source] ?? ""].filter(Boolean).join(" · ") }),
      h("span", { class: ok < total ? "warn" : "", text: `${total} questions · ${ok} validées` }),
      h("div", { class: "row" },
        h("button", { class: "btn secondary", onclick: () => review(id, q), text: "Éditer" }),
        h("button", { class: "btn secondary", onclick: () => rename(`library/quizzes/${id}`, q.title, "du quiz"), text: "Renommer" }),
        h("button", { class: "btn secondary", onclick: () => duplicateQuiz(q), text: "Dupliquer" }),
        h("button", { class: "btn danger", onclick: () => deleteQuiz(id, q), text: "Supprimer" }))));
  });
}
const SOURCES = { gemini: "texte collé", tableur: "tableur", json: "fichier", saisie: "saisie", photos: "photos" };

/** Copie à relire puis enregistrer comme nouveau quiz : l'original et ses prestations ne changent pas. */
function duplicateQuiz(q) {
  const { createdAt, updatedAt, ...rest } = q;
  review(null, { ...rest, title: `${q.title} (copie)`.slice(0, 120) });
  status("rv-status", "Copie : modifiez-la puis enregistrez-la, l'original ne change pas.", true);
}

async function deleteQuiz(id, q) {
  const used = Object.values(shows).filter((s) => (s.rounds ?? []).some((r) => roundQuizIds(r).includes(id))).map(showTitle);
  const warning = used.length ? `\n\nAttention, il est utilisé par : ${used.join(", ")}.` : "";
  if (!confirm(`Supprimer le quiz « ${q.title} » ?${warning}`)) return;
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
  $("quiz-photos-open").textContent = "📷 Quiz de photos";
  if (!kept.length) return alert("Ces photos n'ont pas pu être lues : essayez des JPEG ou des PNG.");
  review(null, { title: "Mes photos", theme: "", source: "photos", questions: kept });
  status("rv-status", `${kept.length} photo${kept.length > 1 ? "s" : ""} prête${kept.length > 1 ? "s" : ""} : vérifiez chaque réponse, puis enregistrez.`, true);
};

$("quiz-import-open").onclick = () => {
  $("import-text").value = "";
  $("import-file").value = "";
  importImages.clear();
  $("import-images").textContent = "";
  status("import-status", "");
  updatePrompt();
  show("import");
};

/** Réponses du quiz demandé : « texte » ou « images » (des mots simples, images ajoutées ensuite par Sarah). */
const answersMode = () => document.querySelector("input[name=gem-answers]:checked")?.value ?? "texte";

function updatePrompt() {
  $("gem-prompt").value = geminiPrompt({
    theme: $("gem-theme").value, age: $("gem-age").value, count: Number($("gem-count").value) || 8,
    difficulty: $("gem-difficulty").value, answers: answersMode(),
  });
}
["gem-theme", "gem-age", "gem-count"].forEach((id) => $(id).addEventListener("input", updatePrompt));
$("gem-difficulty").addEventListener("change", updatePrompt);
document.querySelectorAll("input[name=gem-answers]").forEach((r) => r.addEventListener("change", updatePrompt));

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
async function attachImportImages(questions) {
  let done = 0;
  const find = (name) => importImages.get(imageKey(name)) ?? importImages.get(imageKey(name).replace(/\.[a-z0-9]+$/, ".png"))
    ?? [...importImages.entries()].find(([key]) => key.replace(/\.[a-z0-9]+$/, "") === imageKey(name).replace(/\.[a-z0-9]+$/, ""))?.[1];
  for (const q of questions) {
    // Image de révélation : rangée comme une photo d'illustration, montrée sur la TV avec la bonne réponse.
    if (q.revealFile) {
      const f = find(q.revealFile);
      q.missingImages ??= [];
      if (!f) q.missingImages.push(q.revealFile);
      else {
        status("import-status", `Préparation des images… (${++done})`, true);
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
      status("import-status", `Préparation des images… (${++done})`, true);
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
  status("rv-status", "");
  show("review");
  renderReview();
  histRelecture.depart();
}

const REVIEW_FIELDS = ["rv-title", "rv-theme", "rv-age-min", "rv-age-max"];
const histRelecture = historique({
  ecran: $("screen-review"),
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
      h("label", { class: "check q-number-toggle" },
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
  const preview = h("img", { class: "q-image", alt: "Photo de la question", hidden: !q.imageId });
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
        noterEcran();
        remove.hidden = false;
        showPreview();
        info.textContent = `Photo prête (${Math.round(data.length / 1365)} Ko). Pensez à enregistrer le quiz.`;
      } catch (err) {
        console.error(err);
        info.textContent = "Photo refusée : essayez une autre image (JPEG ou PNG).";
      }
    },
  });
  showPreview();
  refreshMissing();
  return h("div", { class: "row illustration", "data-illustration": i },
    missing,
    h("label", { class: "inline" }, "Illustration",
      h("input", {
        class: "q-emoji", value: q.image ?? "", maxlength: 16, placeholder: "🦁 émoji",
        oninput: (e) => { q.image = cleanEmoji(e.target.value); refreshMissing(); },
      })),
    h("button", { type: "button", class: "btn small secondary", text: "📷 Photo…", onclick: () => file.click() }),
    file, preview, remove, info);
}

/**
 * Réponse en image (quiz des petits) : « 📷 » choisit une photo sur le PC pour cette case, réduite avant l'envoi.
 * Sur la TV et les tablettes, la photo remplace le texte ; le mot reste dessous, en petit.
 */
function choicePhoto(q, slots, k) {
  const thumb = h("img", { class: "choice-thumb", alt: `Image de la réponse ${LETTERS[k]}`, hidden: true });
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
    file);
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
      source: draft.quiz.source ?? "saisie",
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

// ---------- Prestation de test ----------

/** Ajoute la prestation de test et son quiz, seulement s'ils n'existent pas encore : rien n'est jamais remplacé. */
$("test-create").onclick = async () => {
  const btn = $("test-create");
  btn.disabled = true;
  try {
    const [q, s] = await Promise.all([get(ref(db, `library/quizzes/${TEST_ID}`)), get(ref(db, `library/shows/${TEST_ID}`))]);
    if (q.exists() || s.exists()) {
      status("test-status", "Elle existe déjà : retrouvez-la dans Prestations (rien n'a été modifié).", true);
      return;
    }
    const now = Date.now();
    await set(ref(db, `library/quizzes/${TEST_ID}`), { ...TEST_QUIZ, createdAt: now, updatedAt: serverTimestamp() });
    await set(ref(db, `library/shows/${TEST_ID}`), { ...TEST_SHOW, createdAt: now, updatedAt: serverTimestamp() });
    status("test-status", "Ajoutée : « ANNIVERSAIRE TEST – Léa, 9 ans » est dans Prestations et sur la régie.", true);
  } catch (err) {
    console.error(err);
    status("test-status", "Échec de l'ajout. Vérifiez la connexion puis réessayez.");
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
      const { rounds, folded, converted } = foldLegacyFinale(existing.rounds);
      const missing = FULL_NEW_ROUNDS.filter((m) => !rounds.some((r) => r.type === m.type && (!m.quizId || r.quizId === m.quizId)));
      if (existing.origin !== "test" || (!missing.length && !folded && !converted)) {
        status("test-full-status", "Elle existe déjà : retrouvez-la dans Prestations (rien n'a été modifié).", true);
        return;
      }
      status("test-full-status", "Ajout des nouveaux jeux à la prestation de test…", true);
      if (missing.some((m) => m.playlistId)) await addTunes(Date.now());
      if (missing.some((m) => m.quizId === FULL_KEYS.images)) await addImageQuiz(Date.now());
      // La bombe cachée reste le jeu final : tout à la fin.
      const last = missing.filter((m) => m.type === "coffres");
      const middle = missing.filter((m) => m.type !== "coffres");
      // Bombe cachée déjà là (anciennes Portes mystères comprises) : les nouveaux jeux passent juste avant elle.
      const at = rounds.findIndex((r) => r.type === "coffres");
      const next = [...(at < 0 ? [...rounds, ...middle] : [...rounds.slice(0, at), ...middle, ...rounds.slice(at)]), ...last];
      await set(ref(db, `library/shows/${FULL_ID}`), { ...existing, rounds: next, notes: FULL_SHOW.notes, updatedAt: serverTimestamp() });
      const added = missing.map((m) => (m.quizId === FULL_KEYS.images ? "Quiz en images" : ROUND_TYPES[m.type])).join(", ");
      status("test-full-status", `Mise à jour de « ANNIVERSAIRE TEST – Léa, 9 ans · tous les jeux » :${added ? ` ${added} ajouté(s).` : ""}${folded ? " L'ancienne manche « Super Finale » est retirée : les 3 dernières questions du quiz comptent double." : ""}${converted ? " Les Portes mystères deviennent La bombe cachée." : ""} Rechargez la prestation dans la régie.`, true);
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
    status("test-full-status", "Ajoutée : « ANNIVERSAIRE TEST – Léa, 9 ans · tous les jeux » est dans Prestations et sur la régie.", true);
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
  const list = Object.entries(mimes).sort(([, a], [, b]) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  box.replaceChildren(...list.map(([id, d]) => {
    const cards = (d.cards ?? []).filter(Boolean);
    return h("div", { class: "item", "data-deck": id },
      h("b", { text: d.title }),
      h("span", { text: `${cards.length} carte${cards.length > 1 ? "s" : ""} · tour de ${d.duration ?? MIME_TURN} s` }),
      h("span", { text: cards.slice(0, 8).map((c) => c.image ?? c.word).join(" ") }),
      h("div", { class: "row" },
        h("button", { class: "btn secondary", onclick: () => editDeck(id), text: "Éditer" }),
        h("button", { class: "btn secondary", onclick: () => rename(`library/mimes/${id}`, d.title, "du paquet"), text: "Renommer" }),
        h("button", { class: "btn secondary", onclick: () => editDeck(null, d), text: "Dupliquer" }),
        h("button", { class: "btn danger", onclick: () => deleteDeck(id), text: "Supprimer" })));
  }));
  if (!list.length) box.append(h("p", { class: "hint", text: "Aucun paquet pour l'instant : créez-en un en choisissant des images dans le catalogue." }));
}

let deck = null; // { id, cards: [{word, image}] }
let deckTheme = MIME_THEMES[0];
const sameCard = (a, b) => a.word.toLowerCase() === b.word.toLowerCase();

$("mime-new").onclick = () => editDeck(null);

/** Ouvre un paquet ; sans identifiant, un nouveau, vide ou copié d'un autre (`from`). */
function editDeck(id, from = null) {
  const d = id ? mimes[id] : from ?? {};
  deck = { id, cards: (d.cards ?? []).filter(Boolean).map((c) => ({ word: c.word, ...(c.image ? { image: c.image } : {}) })) };
  $("mime-edit-title").textContent = id ? d.title : from ? `Copie de « ${from.title} »` : "Nouveau paquet";
  $("mime-title").value = from ? `${from.title} (copie)`.slice(0, 120) : d.title ?? "";
  $("mime-duration").value = `${d.duration ?? MIME_TURN}`;
  $("mime-delete").hidden = !id;
  status("mime-status", "");
  show("mime-edit");
  renderDeck();
  histPaquet.depart();
}

const histPaquet = historique({
  ecran: $("screen-mime-edit"),
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
  else deck.cards.push({ word: card.word, ...(card.image ? { image: card.image } : {}) });
  renderDeck();
}

function cardButton(card, on, onclick, extra = null) {
  return h("button", { type: "button", class: `mime-card${on ? " on" : ""}`, onclick, "data-word": card.word },
    h("span", { class: "emoji", text: card.image ?? "🎭" }), h("span", { class: "word", text: card.word }), extra);
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

$("mime-custom").onsubmit = (e) => {
  e.preventDefault();
  const word = $("mime-word").value.trim();
  const image = $("mime-emoji").value.trim();
  if (!word) return;
  if (deck.cards.some((c) => sameCard(c, { word }))) return status("mime-status", `« ${word} » est déjà dans le paquet.`);
  deck.cards.push({ word: word.slice(0, 40), ...(image ? { image: image.slice(0, 16) } : {}) });
  $("mime-word").value = "";
  $("mime-emoji").value = "";
  status("mime-status", "");
  renderDeck();
  $("mime-word").focus();
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
  if (deck?.id && await deleteDeck(deck.id)) show("mimes");
};

async function deleteDeck(id) {
  const used = Object.values(shows).filter((s) => (s.rounds ?? []).some((r) => r?.deckId === id)).map(showTitle);
  const warning = used.length ? `\n\nAttention, il est utilisé par : ${used.join(", ")}.` : "";
  if (!confirm(`Supprimer le paquet « ${mimes[id]?.title ?? ""} » ?${warning}`)) return false;
  await set(ref(db, `library/mimes/${id}`), null);
  return true;
}

// ---------- Blind test : playlists d'extraits musicaux ----------

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

function renderPlaylists() {
  const box = $("playlist-list");
  const list = Object.entries(playlists).filter(([, p]) => !isStatuesList(p)).sort(([, a], [, b]) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  box.replaceChildren(...list.map(([id, p]) => {
    const tracks = playableTracks(p);
    return h("div", { class: "item", "data-playlist": id },
      h("b", { text: p.title }),
      h("span", { text: `${tracks.length} morceau${tracks.length > 1 ? "x" : ""} · extraits de ${p.duration ?? BLIND_SEC} s` }),
      h("span", { text: tracks.slice(0, 5).map((t) => t.title).join(" · ") + (tracks.length > 5 ? " …" : "") }),
      h("div", { class: "row" },
        h("button", { class: "btn secondary", onclick: () => editPlaylist(id), text: "Éditer" }),
        h("button", { class: "btn secondary", onclick: () => rename(`library/playlists/${id}`, p.title, "de la playlist"), text: "Renommer" }),
        h("button", { class: "btn secondary", onclick: () => duplicatePlaylist(id), text: "Dupliquer" }),
        h("button", { class: "btn danger", onclick: () => deletePlaylist(id), text: "Supprimer" })));
  }));
  if (!list.length) box.append(h("p", { class: "hint", text: "Aucune playlist pour l'instant : créez-en une avec vos fichiers musicaux." }));
}

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
 * Chansons des statues musicales (page Jeux) : une seule liste, ouverte dans l'écran des playlists sans le barème
 * du blind test. Elle est créée au premier enregistrement.
 */
function openStatuesSongs() {
  const [found] = Object.entries(playlists).filter(([, p]) => isStatuesList(p)).sort(([, a], [, b]) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  editPlaylist(found ? found[0] : null, { use: "statues", title: "Chansons des statues musicales" });
}

function editPlaylist(id, fresh = {}) {
  const p = id ? playlists[id] : fresh;
  const statues = isStatuesList(p);
  playlist = {
    id, use: statues ? "statues" : null,
    tracks: (p.tracks ?? []).filter(Boolean).map((t) => ({
      title: t.title ?? "", artist: t.artist ?? "", rights: t.rights ?? "", audioId: t.audioId,
      points: t.points ?? null, imageId: t.imageId ?? null, duration: t.duration ?? null,
    })),
  };
  const scale = blindScale(p);
  $("playlist-points").value = `${scale.points}`;
  $("playlist-final-points").value = `${scale.finalPoints}`;
  $("playlist-final-count").value = `${scale.finalCount}`;
  $("playlist-reveal").value = `${scale.reveal}`;
  $("playlist-edit-title").textContent = id || statues ? p.title : "Nouvelle playlist";
  $("playlist-title").value = p.title ?? "";
  // Statues : pas de barème ni de pochette ; le fil d'Ariane ramène à la page Jeux.
  $("playlist-scale").hidden = statues;
  $("statues-hint").hidden = !statues;
  $("playlist-hint").hidden = statues;
  $("playlist-crumb").textContent = statues ? ROUND_TYPES.statues : "Musique";
  $("playlist-crumb").dataset.screen = statues ? "games" : "music";
  $("playlist-title-label").textContent = statues ? "Nom de la liste" : "Nom de la playlist";
  $("playlist-duration-label").textContent = statues ? "Longueur de chaque chanson" : "Durée des extraits";
  $("playlist-count-label").textContent = statues ? "Chansons" : "Morceaux";
  $("playlist-save").textContent = statues ? "Enregistrer les chansons" : "Enregistrer la playlist";
  $("playlist-duration").replaceChildren(...extractChoices().map((n) => h("option", { value: n, text: extractText(n) })));
  $("playlist-duration").value = `${p.duration ?? (statues ? STATUES_EXTRACT : BLIND_SEC)}`;
  $("playlist-delete").hidden = !id;
  status("playlist-status", "");
  show("playlist-edit");
  renderTracks();
  histPlaylist.depart();
}

const PLAYLIST_FIELDS = ["playlist-title", "playlist-duration", "playlist-points", "playlist-final-points", "playlist-final-count", "playlist-reveal"];
const histPlaylist = historique({
  ecran: $("screen-playlist-edit"),
  capturer: () => ({ tracks: playlist?.tracks ?? [], champs: PLAYLIST_FIELDS.map((id) => $(id).value) }),
  restaurer: (e) => {
    stopPreview();
    PLAYLIST_FIELDS.forEach((id, k) => { $(id).value = e.champs[k]; });
    if (playlist) playlist.tracks = e.tracks;
    renderTracks();
  },
});

function stopPreview() {
  if (!preview) return;
  clearTimeout(preview.timer);
  preview.audio.pause();
  if (preview.url) URL.revokeObjectURL(preview.url);
  preview = null;
}

/** Écoute : l'extrait enregistré, ou le fichier à partir du début choisi pendant la durée de l'extrait. */
async function listen(t) {
  stopPreview();
  try {
    if (t.file) {
      const url = URL.createObjectURL(t.file);
      const audio = new Audio(url);
      preview = { audio, url };
      audio.currentTime = t.start;
      await audio.play();
      preview.timer = setTimeout(stopPreview, (t.duration ?? Number($("playlist-duration").value)) * 1000);
    } else {
      const data = (await get(ref(db, `library/sounds/${t.audioId}`))).val();
      if (typeof data !== "string") return status("playlist-status", `Extrait de « ${t.title} » introuvable.`);
      const audio = new Audio(data);
      preview = { audio };
      await audio.play();
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

function renderTracks() {
  $("playlist-count").textContent = playlist.tracks.length;
  const seconds = Number($("playlist-duration").value);
  const scale = scaleInputs();
  const n = playlist.tracks.length;
  $("playlist-tracks").replaceChildren(...playlist.tracks.map((t, i) => {
    const debut = playlist.use === "statues" ? "Début du passage" : "Début de l'extrait";
    const label = h("span", { text: `${debut} : ${mmss(t.start ?? 0)}` });
    const length = t.duration ?? seconds;
    const max = Math.max(0, Math.floor((t.length ?? 0) - length));
    const auto = trackPoints(scale, null, i, n);
    // Durée propre au morceau : seulement avant l'enregistrement (l'extrait est découpé à ce moment-là).
    const duration = t.file ? h("label", { class: "inline" }, "Durée",
      h("select", {
        class: "track-duration", "aria-label": "Durée de l'extrait",
        onchange: (e) => { t.duration = e.target.value ? Number(e.target.value) : null; renderTracks(); },
      },
      h("option", { value: "", text: `comme ${playlist.use === "statues" ? "la liste" : "la playlist"} (${seconds} s)`, selected: t.duration == null }),
      ...extractChoices().map((s) => h("option", { value: s, text: `${s} s`, selected: t.duration === s })))) : null;
    const statues = playlist.use === "statues";
    return h("div", { class: `track${t.file ? "" : " saved"}`, "data-track": i },
      h("input", { type: "text", maxlength: 80, placeholder: statues ? "Titre de la chanson" : "Titre (la réponse)", value: t.title, "aria-label": "Titre", oninput: (e) => { t.title = e.target.value; } }),
      h("input", { type: "text", maxlength: 80, placeholder: statues ? "Artiste (facultatif)" : "Artiste ou dessin animé (bonus, facultatif)", value: t.artist, "aria-label": "Artiste", oninput: (e) => { t.artist = e.target.value; } }),
      h("div", { class: "track-tools" },
        h("button", { type: "button", class: "icon", title: "Plus tôt", disabled: i === 0, onclick: () => moveTrack(i, -1), text: "↑" }),
        h("button", { type: "button", class: "icon", title: "Plus tard", disabled: i === n - 1, onclick: () => moveTrack(i, 1), text: "↓" }),
        h("button", { type: "button", class: "icon", title: "Écouter l'extrait", onclick: () => listen(t), text: "▶" }),
        h("button", { type: "button", class: "icon", title: "Retirer", onclick: () => { stopPreview(); playlist.tracks.splice(i, 1); renderTracks(); }, text: "✕" })),
      h("div", { class: "track-start" }, label,
        h("input", {
          type: "range", min: 0, max, step: 1, value: Math.min(t.start ?? 0, max), "aria-label": "Début de l'extrait",
          oninput: (e) => { t.start = Number(e.target.value); label.textContent = `${debut} : ${mmss(t.start)}`; },
          onchange: () => { if (preview) listen(t); },
        })),
      h("div", { class: "track-extra" },
        h("span", { class: "track-n", text: `${statues ? "Chanson" : "Morceau"} ${i + 1}` }),
        statues ? null : h("label", { class: "inline" }, "Points",
          h("input", {
            type: "number", class: "track-points", min: 1, max: 1000, step: 10, placeholder: `${auto}`, value: t.points ?? "",
            "aria-label": "Points du morceau", title: `Vide : ${auto} points (barème de la playlist)`,
            oninput: (e) => { const v = Number(e.target.value); t.points = e.target.value && Number.isInteger(v) && v >= 1 && v <= 1000 ? v : null; },
          })),
        duration,
        ...(statues ? [] : coverTools(t))),
      statues ? null : h("input", { type: "text", class: "track-note", maxlength: 120, placeholder: "Droits (facultatif, pour information)", value: t.rights, "aria-label": "Droits", oninput: (e) => { t.rights = e.target.value; } }));
  }));
  if (!playlist.tracks.length) $("playlist-tracks").append(h("p", { class: "hint small", text: playlist.use === "statues" ? "Aucune chanson : ajoutez vos fichiers musicaux. Sans chanson, la TV joue la musique de la fête." : "Aucun morceau : ajoutez vos fichiers musicaux." }));
}
$("playlist-duration").onchange = () => renderTracks();

/** Durée d'un fichier, lue par le navigateur sans le décoder en entier. */
function fileDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (d) => { URL.revokeObjectURL(url); resolve(Number.isFinite(d) ? d : 0); };
    audio.onloadedmetadata = () => done(audio.duration);
    audio.onerror = () => done(0);
    audio.src = url;
  });
}

$("playlist-files").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  for (const file of files) {
    const length = await fileDuration(file);
    const { title, artist } = guessTrack(file.name);
    playlist.tracks.push({ title, artist, rights: "", file, length, start: defaultStart(length, Number($("playlist-duration").value)) });
  }
  renderTracks();
  noterEcran();
};

$("playlist-save").onclick = async () => {
  const title = $("playlist-title").value.trim();
  const statues = playlist.use === "statues";
  if (!title) return status("playlist-status", statues ? "Donnez un nom à la liste." : "Donnez un nom à la playlist.");
  if (!playlist.tracks.length) return status("playlist-status", statues ? "Ajoutez au moins une chanson." : "Ajoutez au moins un morceau.");
  const untitled = playlist.tracks.findIndex((t) => !t.title.trim());
  if (untitled >= 0) return status("playlist-status", statues ? `Chanson ${untitled + 1} : indiquez son titre.` : `Morceau ${untitled + 1} : indiquez son titre (c'est la réponse attendue).`);
  stopPreview();
  const seconds = Number($("playlist-duration").value);
  $("playlist-save").disabled = true;
  try {
    // Chaque nouveau morceau : extrait découpé et réencodé ici, rangé une seule fois dans la bibliothèque.
    const fresh = playlist.tracks.filter((t) => t.file);
    for (const [k, t] of fresh.entries()) {
      status("playlist-status", `Préparation de l'extrait ${k + 1} / ${fresh.length} : ${t.title}…`, true);
      let extract;
      try {
        extract = await makeExtract(await decodeFile(t.file), t.start ?? 0, t.duration ?? seconds);
      } catch (err) {
        console.error(err);
        return status("playlist-status", `« ${t.title} » : fichier illisible. Essayez un autre format (MP3 de préférence).`);
      }
      const target = ref(db, `library/sounds/${extract.id}`);
      if (!(await get(target)).exists()) await set(target, extract.data);
      t.audioId = extract.id;
      delete t.file;
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
      })),
      createdAt: playlists[id]?.createdAt ?? Date.now(), updatedAt: serverTimestamp(),
    });
    playlist.id = id;
    histPlaylist.enregistre();
    $("playlist-delete").hidden = false;
    $("playlist-edit-title").textContent = title;
    renderTracks();
    status("playlist-status", statues
      ? `Enregistrée : ${plural(playlist.tracks.length, "chanson")}. Cochez-les dans une manche « Statues musicales » de la prestation.`
      : `Enregistrée : ${playlist.tracks.length} morceau${playlist.tracks.length > 1 ? "x" : ""}. Ajoutez-la à une prestation comme manche « Blind test » ou « Quiz musical ».`, true);
  } catch (err) {
    console.error(err);
    status("playlist-status", "Enregistrement refusé : vérifiez Internet ou reconnectez-vous.");
  } finally {
    $("playlist-save").disabled = false;
  }
};

$("playlist-delete").onclick = async () => {
  if (playlist?.id && await deletePlaylist(playlist.id)) show(playlist.use === "statues" ? "games" : "music");
};

async function deletePlaylist(id) {
  const ids = new Set(playableTracks(playlists[id]).map((t) => t.audioId));
  const used = Object.values(shows).filter((s) => (s.rounds ?? []).some((r) => r?.playlistId === id || (r?.type === "statues" && (r.songs ?? []).some((x) => ids.has(x))))).map(showTitle);
  const warning = used.length ? `\n\nAttention, elle est utilisée par : ${used.join(", ")}.` : "";
  if (!confirm(`Supprimer ${isStatuesList(playlists[id]) ? "la liste des chansons des statues" : "la playlist"} « ${playlists[id]?.title ?? ""} » ?${warning}`)) return false;
  await set(ref(db, `library/playlists/${id}`), null);
  return true;
}

/** Copie d'une playlist (mêmes extraits, déjà enregistrés) : l'originale et ses prestations ne changent pas. */
async function duplicatePlaylist(id) {
  const { createdAt, updatedAt, ...rest } = playlists[id];
  const copy = push(ref(db, "library/playlists")).key;
  await set(ref(db, `library/playlists/${copy}`), { ...rest, title: `${rest.title} (copie)`.slice(0, 120), createdAt: Date.now(), updatedAt: serverTimestamp() });
}

// ---------- Jeux : tous les mini-jeux, leur règle et où gérer leur contenu ----------

const usedIn = (type) => Object.values(shows).filter((s) => s && s.status !== "archivee" && (s.rounds ?? []).some((r) => r?.type === type)).length;
const plural = (n, word, many = `${word}s`) => `${n} ${n > 1 ? many : word}`;

/** Les jeux par famille : ce qui se prépare dans la bibliothèque, ce qui vient d'un quiz, ce qui est intégré. */
const GAME_GROUPS = [
  { title: "Avec vos contenus", hint: "Vous préparez le contenu dans la bibliothèque, une fois, et vous le réutilisez dans toutes les prestations.", games: [
    { type: "quiz", icon: "?", rule: "Questions à 2, 3 ou 4 propositions sur les pupitres ; toutes les équipes qui trouvent marquent. Une question peut aussi être un « Juste Chiffre » (réponse en nombre). Super Finale : dans la prestation, les dernières questions du quiz peuvent compter double.",
      status: () => { const ok = Object.values(quizzes).reduce((t, q) => t + playable(q).length, 0); return `${plural(Object.keys(quizzes).length, "quiz", "quiz")} · ${plural(ok, "question validée", "questions validées")}`; },
      actions: () => [["Gérer les quiz", () => show("quizzes")], ["Créer un quiz", () => $("quiz-import-open").click()]] },
    { type: "mimes", icon: "🎭", rule: "Équipe par équipe : un enfant devine, ses coéquipiers miment l'image. 50 points par mime trouvé.",
      status: () => plural(Object.keys(mimes).length, "paquet de cartes", "paquets de cartes"),
      actions: () => [["Gérer les paquets", () => show("mimes")], ["Nouveau paquet", () => editDeck(null)]] },
    { type: "blind", icon: "🎵", rule: "Les morceaux d'une playlist, dans l'ordre : le premier qui buzze donne le titre à voix haute, vous validez.",
      status: () => plural(Object.values(playlists).filter((p) => !isStatuesList(p)).length, "playlist"),
      actions: () => [["Gérer les playlists", () => show("music")]] },
    { type: "musical", icon: "🎶", rule: "Un extrait d'une playlist et 4 titres sur les pupitres ; même playlist que le blind test.",
      status: () => plural(Object.values(playlists).filter((p) => !isStatuesList(p) && playableTracks(p).length >= 2).length, "playlist utilisable", "playlists utilisables"),
      actions: () => [["Gérer les playlists", () => show("music")]] },
    { type: "statues", icon: "🗿", rule: "Vos chansons jouent sur la TV et s'arrêtent par moments : tout le monde se fige ! Vous désignez l'équipe gagnante depuis la régie. Dans la prestation : la durée et les chansons cochées (aucune : la musique de la fête).",
      status: () => plural(statuesSongs(playlists).length, "chanson"),
      actions: () => [["Gérer les chansons", () => openStatuesSongs()]] },
  ] },
  { title: "Tirés d'un quiz", hint: "Rien de plus à préparer : ces jeux reprennent les questions d'un quiz de la bibliothèque. Dans la prestation, choisissez le quiz et combien de questions.", games: [
    { type: "express", icon: "✔", rule: "Les questions Vrai / Faux d'un quiz, au chrono court du profil.", needs: "Vrai / Faux validées" },
    { type: "zoom", icon: "🔍", rule: "Les questions avec photo d'un quiz : la photo se dévoile peu à peu.", needs: "photos" },
    { type: "flou", icon: "🌫", rule: "Les questions avec photo d'un quiz : l'image devient nette, le premier qui buzze répond.", needs: "photos" },
  ] },
  { title: "Contenu intégré", hint: "Prêts à jouer : la manche tire au hasard dans un catalogue adapté à l'âge. Vous pouvez retirer des éléments et ajouter les vôtres.", games: [
    { type: "chante", icon: "🎤" }, { type: "quisuis", icon: "🕵" }, { type: "disparu", icon: "🎩" },
    { type: "pictionary", icon: "✏️", rule: `Équipe par équipe : vous montrez un mot sur la tablette de l'équipe, un enfant le dessine et le dessin s'affiche en direct sur la TV. ${PICTO_POINTS} points si son équipe trouve avant la fin du chrono. Le temps de dessin se choisit dans la prestation.` },
  ] },
  { title: "Sans contenu", hint: "Rien à préparer.", games: [
    { type: "coffres", icon: "💣", rule: "Chaque équipe à son tour ouvre un coffre sur sa tablette : bonus ou malus, tirés au sort à l'ouverture. Après quelques tours sans danger, une bombe se cache dans un des coffres : l'équipe qui l'ouvre perd 300 points (jamais sous 0) et le jeu s'arrête sur le bilan. Personne ne connaît le contenu des coffres, régie comprise. Idéal en dernier jeu." },
    { type: "patate", icon: "🥔", rule: "Une bombe passe d'équipe en équipe : sur sa tablette, l'équipe qui la tient choisit à qui l'envoyer (jamais tout de suite à l'équipe qui vient de l'envoyer, sauf à 2 équipes ; on ne peut la renvoyer que 2 secondes après l'avoir reçue). La mèche, tirée au sort, reste secrète : à l'explosion, l'équipe qui tient la bombe perd 150 points (jamais sous 0), toutes les autres en gagnent 150." },
    { type: "gonfleur", icon: "🎈", rule: "Chaque équipe tapote sa tablette le plus vite possible pour gonfler son ballon sur la TV ; on peut se relayer. Le premier ballon qui éclate gagne 300 points, les autres équipes 150. Depuis la régie, « Arrêter la course » donne la victoire au plus gros ballon." },
  ] },
];

function renderGames() {
  const box = $("games-list");
  box.replaceChildren(...GAME_GROUPS.map((group) => h("section", { class: "game-group" },
    h("h2", { text: group.title }),
    h("p", { class: "hint small", text: group.hint }),
    h("div", { class: "cards" }, ...group.games.map((g) => {
      const { rule, line, actions } = gameInfo(g);
      const n = usedIn(g.type);
      return h("div", { class: "item game-card", "data-game": g.type },
        h("b", {}, h("span", { class: "game-icon", text: g.icon }), ROUND_TYPES[g.type]),
        h("span", { class: "rule", text: rule }),
        h("span", { text: line }),
        h("span", { class: "small", text: n ? `Dans ${plural(n, "prestation")} en cours` : "Dans aucune prestation en cours" }),
        actions.length ? h("div", { class: "row" }, ...actions.map(([label, fn], k) => h("button", { class: `btn${k ? " secondary" : ""}`, onclick: fn, text: label }))) : null);
    })))));
}

/** Règle, état du contenu et actions d'un jeu : les mêmes sur la page Jeux et sur l'accueil. */
function gameInfo(g) {
  const quizGame = QUIZ_GAMES[g.type];
  const content = CONTENT_GAMES[g.type];
  const rule = g.rule ?? (content ? `${BUILTIN_GAMES[g.type].rule[0].toUpperCase()}${BUILTIN_GAMES[g.type].rule.slice(1)}.` : "");
  const line = g.status ? g.status()
    : quizGame ? `${plural(Object.values(quizzes).filter((q) => (QUIZ_GAMES[g.type]?.questions ?? playable)(q).length).length, "quiz utilisable", "quiz utilisables")} (avec des ${g.needs})`
    : content ? builtinLine(g.type)
    : "Rien à préparer";
  const actions = g.actions ? g.actions()
    : quizGame ? [["Voir les quiz", () => show("quizzes")]]
    : content ? [[`Voir et modifier les ${CONTENT_GAMES[g.type].unit}s`, () => openBuiltin(g.type)]]
    : [];
  return { rule, line, actions };
}

/** « 38 mots actifs dont 2 ajoutés · 3 retirés » */
function builtinLine(type) {
  const game = CONTENT_GAMES[type];
  const active = activeItems(type, contents[type]).length;
  const added = contentExtras(type, contents[type]).length;
  const off = game.catalog.length + added - active;
  return [`${plural(active, `${game.unit} actif`, `${game.unit}s actifs`)}${added ? ` dont ${added} ajouté${added > 1 ? "s" : ""}` : ""}`, off ? `${off} retiré${off > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");
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

/** Page d'un jeu (page Jeux) : chaque touche est enregistrée tout de suite ; Retour et Annuler réenregistrent l'état d'avant. */
const histJeu = historique({
  ecran: $("screen-builtin"),
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
  $("builtin-count").textContent = `${plural(active, `${game.unit} actif`, `${game.unit}s actifs`)} sur ${game.catalog.length + extra.length}`;
  const { images } = builtinState(type);
  const tile = (item, custom) => {
    const key = game.key(item);
    const on = !off.includes(key);
    const detail = type === "quisuis" ? item.clues.join(" · ") : type === "disparu" ? item.objects.map((o) => o.image).join(" ") : "";
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
        detail ? h("span", { class: "detail", text: detail }) : null),
      photo,
      custom ? h("button", {
        type: "button", class: "icon", title: "Supprimer cet ajout", text: "✕",
        onclick: () => {
          if (!confirm(`Supprimer « ${game.label(item)} » ?`)) return;
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
    ];
  form.replaceChildren(h("p", { class: "label wide", text: `Ajouter ${type === "chante" || type === "pictionary" ? "un mot" : type === "quisuis" ? "un personnage" : "une famille d'objets"}` }),
    ...fields, h("div", { class: "wide" }, h("button", { class: "btn", type: "submit", text: "Ajouter" })));
}

$("builtin-add").onsubmit = (e) => {
  e.preventDefault();
  const type = builtinType;
  const game = CONTENT_GAMES[type];
  const val = (id) => $(id)?.value.trim() ?? "";
  const raw = type === "chante" ? { word: val("bi-word") }
    : type === "pictionary" ? { word: val("bi-word"), image: val("bi-emoji"), series: val("bi-series") }
    : type === "quisuis" ? { answer: val("bi-answer"), emoji: val("bi-emoji"), clues: [1, 2, 3, 4].map((n) => val(`bi-clue${n}`)).filter(Boolean) }
    : { theme: val("bi-theme"), objects: val("bi-objects").split("\n").map((line) => {
      const m = line.trim().match(/^(.*\S)\s+(\S+)$/u);
      return m ? { word: m[1], image: m[2] } : null;
    }).filter(Boolean) };
  const item = game.clean(raw);
  if (!item) {
    return status("builtin-status", type === "chante" || type === "pictionary" ? "Écrivez le mot à ajouter."
      : type === "quisuis" ? "Il faut la réponse et au moins 2 indices."
      : "Il faut un nom et au moins 5 objets, chacun avec son émoji (« Poupée 🪆 »).");
  }
  const { off, extra } = builtinState(type);
  const key = game.key(item);
  if ([...game.catalog, ...extra].some((x) => game.key(x) === key)) return status("builtin-status", `« ${game.label(item)} » existe déjà.`);
  saveBuiltin(type, { off, extra: [...extra, item] }, `« ${game.label(item)} » est ajouté au jeu.`);
  e.target.reset();
};
