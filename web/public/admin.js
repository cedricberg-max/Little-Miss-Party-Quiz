import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth, signInAnonymously, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, push, onValue, serverTimestamp, connectDatabaseEmulator,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { passwordHash, newSalt, MIN_PASSWORD_LENGTH } from "./secret.js";
import { writeProof, isAdmin } from "./proof.js";
import { parseQuiz, checkQuestions, geminiPrompt, LETTERS } from "./importer.js";
import { PROFILES, profileForAge, defaultDuration } from "./profiles.js";
import {
  buildSnapshot, estimateMinutes, playable, showTitle, ROUND_TYPES, readiness, upcoming, daysUntil, duplicateShow, isoDay,
} from "./show.js";

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

const SCREENS = ["login", "home", "shows", "show-edit", "quizzes", "import", "review", "settings"];
function show(name) {
  if (["home", "shows", "quizzes", "settings"].includes(name)) current = name;
  SCREENS.forEach((s) => { $(`screen-${s}`).hidden = s !== name; });
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.screen === current));
  window.scrollTo(0, 0);
  if (name === "home") renderHome();
  if (name === "shows") renderShows();
  if (name === "quizzes") renderQuizzes();
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
  const r = await writeProof(ctx, "admin", password);
  if (r === "busy") return "Trop d'essais en même temps. Réessayez dans quelques secondes.";
  if (r === "unset") return "Aucun mot de passe administrateur enregistré.";
  return (await isAdmin(ctx)) ? null : "Mot de passe incorrect.";
}

async function savePassword(kind, password) {
  const salt = newSalt();
  await set(ref(db, `settings/${kind}`), { salt, hash: await passwordHash(salt, password), updatedAt: serverTimestamp() });
}

$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  const pw = $("admin-password").value;
  status("login-status", "");
  if (setupMode) {
    if (pw.length < MIN_PASSWORD_LENGTH) return status("login-status", `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`);
    if (pw !== $("admin-password2").value) return status("login-status", "Les deux mots de passe ne sont pas identiques.");
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
  show(current);
}

route();

function refreshLists() {
  if (!$("screen-home").hidden) renderHome();
  if (!$("screen-shows").hidden) renderShows();
  if (!$("screen-quizzes").hidden) renderQuizzes();
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
  $("stat-ready").textContent = coming.filter(([, s]) => readiness(s, quizzes).level === "prete").length;
  $("stat-todo").textContent = pending.filter((s) => readiness(s, quizzes).level === "a-completer").length;
  const box = $("home-upcoming");
  box.replaceChildren(...coming.slice(0, 6).map(([id, s]) => showCard(id, s)));
  if (!coming.length) {
    box.append(h("div", { class: "empty" },
      h("p", { text: "Aucun anniversaire à venir pour l'instant." }),
      h("button", { class: "btn", onclick: () => editShow(null), text: "Créer une prestation" })));
  }
  const n = Object.keys(quizzes).length;
  const ok = Object.values(quizzes).reduce((t, q) => t + playable(q).length, 0);
  $("tile-quiz").textContent = `${n} quiz · ${ok} question${ok > 1 ? "s" : ""} validée${ok > 1 ? "s" : ""}`;
}
$("home-new").onclick = () => editShow(null);
$("home-import").onclick = () => $("quiz-import-open").click();

// ---------- Prestations ----------

/** Carte d'une prestation : date, prénom, âge, état de préparation et actions. */
function showCard(id, s) {
  const r = readiness(s, quizzes);
  const { snapshot } = buildSnapshot(id, s, quizzes);
  const date = s.date ? shortDate(s.date) : null;
  return h("article", { class: `card show-card ${r.level}`, "data-show": id },
    h("div", { class: "date-chip" }, date ? [h("b", { text: `${date.day}` }), h("span", { text: date.month })] : h("span", { text: "sans date" })),
    h("div", { class: "card-body" },
      h("b", { class: "card-title", text: showTitle(s) }),
      h("span", { class: "meta", text: [s.childName, s.age ? `${s.age} ans` : "", s.date ? `${dateLabel(s.date)} (${whenLabel(s.date)})` : ""].filter(Boolean).join(" · ") }),
      snapshot ? h("span", { class: "meta", text: `${snapshot.quiz.questions.length} questions · environ ${estimateMinutes(snapshot)} min` }) : null,
      r.level === "prete"
        ? h("span", { class: "pill ok", text: "✓ Prête : visible sur la régie" })
        : r.level === "archivee"
          ? h("span", { class: "pill", text: "Archivée" })
          : h("div", { class: "todo" }, h("span", { class: "pill warn", text: "À compléter" }), h("ul", {}, ...r.todo.map((t) => h("li", { text: t })))),
      h("div", { class: "card-actions" },
        h("button", { class: "btn small", onclick: () => editShow(id), text: "Ouvrir" }),
        h("button", { class: "btn small secondary", onclick: () => editShow(null, s), text: "Dupliquer" }),
        s.status === "archivee"
          ? h("button", { class: "btn small secondary", onclick: () => archive(id, false), text: "Désarchiver" })
          : h("button", { class: "btn small secondary", onclick: () => archive(id, true), text: "Archiver" }))));
}

function renderShows() {
  const today = isoDay();
  const list = Object.entries(shows).sort(byDate);
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
  editing = { id, rounds: (s.rounds ?? []).filter(Boolean).map((r) => ({ ...r })) };
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
  status("show-status-msg", from ? "Copie prête : indiquez le prénom, l'âge et la date du nouvel anniversaire, puis enregistrez." : "", !!from);
  show("show-edit");
  refreshRounds();
  if (from) $("show-child").focus();
}

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
    rounds: editing.rounds.filter((r) => r.quizId),
  };
}

function refreshRounds() {
  if (!editing) return;
  refreshReuse();
  const box = $("show-rounds");
  box.innerHTML = "";
  const options = Object.entries(quizzes).sort(([, a], [, b]) => a.title.localeCompare(b.title));
  if (!editing.rounds.length) box.append(h("p", { class: "hint small", text: "Ajoutez au moins une manche." }));
  editing.rounds.forEach((r, i) => {
    const move = (d) => { const [x] = editing.rounds.splice(i, 1); editing.rounds.splice(i + d, 0, x); refreshRounds(); };
    box.append(h("div", { class: "round" },
      h("span", { class: "num", text: `${i + 1}` }),
      h("select", { "aria-label": "Type de manche", onchange: (e) => { r.type = e.target.value; refreshSummary(); } },
        ...Object.entries(ROUND_TYPES).map(([k, label]) => h("option", { value: k, text: label, selected: (r.type ?? "quiz") === k }))),
      h("select", { class: "grow", "aria-label": "Quiz de la manche", onchange: (e) => { r.quizId = e.target.value; refreshSummary(); } },
        h("option", { value: "", text: "Choisir un quiz…" }),
        ...options.map(([qid, q]) => h("option", { value: qid, selected: r.quizId === qid, text: `${q.title} (${playable(q).length} validées)` }))),
      h("button", { type: "button", class: "icon", title: "Monter", disabled: i === 0, onclick: () => move(-1), text: "↑" }),
      h("button", { type: "button", class: "icon", title: "Descendre", disabled: i === editing.rounds.length - 1, onclick: () => move(1), text: "↓" }),
      h("button", { type: "button", class: "icon", title: "Retirer", onclick: () => { editing.rounds.splice(i, 1); refreshRounds(); }, text: "✕" })));
  });
  refreshSummary();
}

function refreshSummary() {
  const s = formShow();
  const { snapshot, problems } = buildSnapshot(editing?.id ?? "nouvelle", s, quizzes);
  const profile = PROFILES[s.profile] ? s.profile : profileForAge(s.age);
  $("show-summary").textContent = snapshot
    ? `${snapshot.quiz.questions.length} questions jouables · environ ${estimateMinutes(snapshot)} min · chrono ${defaultDuration(profile)} s par question (profil ${PROFILES[profile].label}) sauf durée imposée`
    : "";
  $("show-problems").replaceChildren(...problems.map((p) => h("li", { text: p })));
  const r = readiness(s, quizzes);
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
    .flatMap(([id, s]) => (s.rounds ?? []).filter((r) => r?.quizId && quizzes[r.quizId]).map((r, i) => ({
      value: `${id}/${i}`, round: r,
      text: `${showTitle(s)}${s.date ? ` (${new Date(`${s.date}T12:00:00`).toLocaleDateString("fr-FR")})` : ""} · ${r.type === "finale" ? ROUND_TYPES.finale : "Manche"} : ${quizzes[r.quizId].title}`,
    })));
  reuseChoices = new Map(options.map((o) => [o.value, o.round]));
  $("round-reuse").replaceChildren(
    h("option", { value: "", text: options.length ? "Choisir une manche…" : "Aucune autre prestation" }),
    ...options.map((o) => h("option", { value: o.value, text: o.text })));
  $("round-reuse").disabled = !options.length;
}
$("round-reuse").onchange = (e) => {
  const r = reuseChoices.get(e.target.value);
  if (!r) return;
  editing.rounds.push({ type: r.type ?? "quiz", quizId: r.quizId });
  refreshRounds();
};

$("show-form").onsubmit = async (e) => {
  e.preventDefault();
  const s = formShow();
  if (!s.childName) return status("show-status-msg", "Indiquez le prénom de l'enfant fêté.");
  if (s.status === "publiee" && !buildSnapshot("x", s, quizzes).snapshot) {
    return status("show-status-msg", "Une prestation prête doit contenir au moins une question validée.");
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
  if (!list.length) box.append(h("p", { class: "hint", text: "Aucun quiz pour l'instant : importez-en un depuis Gemini ou un tableur." }));
  list.forEach(([id, q]) => {
    const total = (q.questions ?? []).filter(Boolean).length;
    const ok = playable(q).length;
    const ages = q.ageMin ? `${q.ageMin}${q.ageMax && q.ageMax !== q.ageMin ? ` à ${q.ageMax}` : ""} ans` : "";
    box.append(h("div", { class: "item", "data-quiz": id },
      h("b", { text: q.title }),
      h("span", { text: [q.theme, ages, SOURCES[q.source] ?? ""].filter(Boolean).join(" · ") }),
      h("span", { class: ok < total ? "warn" : "", text: `${total} questions · ${ok} validées` }),
      h("div", { class: "row" },
        h("button", { class: "btn secondary", onclick: () => review(id, q), text: "Relire" }),
        h("button", { class: "btn secondary", onclick: () => duplicateQuiz(q), text: "Dupliquer" }),
        h("button", { class: "btn danger", onclick: () => deleteQuiz(id, q), text: "Supprimer" }))));
  });
}
const SOURCES = { gemini: "Gemini", tableur: "tableur", json: "fichier", saisie: "saisie" };

/** Copie à relire puis enregistrer comme nouveau quiz : l'original et ses prestations ne changent pas. */
function duplicateQuiz(q) {
  const { createdAt, updatedAt, ...rest } = q;
  review(null, { ...rest, title: `${q.title} (copie)`.slice(0, 120) });
  status("rv-status", "Copie : modifiez-la puis enregistrez-la, l'original ne change pas.", true);
}

async function deleteQuiz(id, q) {
  const used = Object.values(shows).filter((s) => (s.rounds ?? []).some((r) => r?.quizId === id)).map(showTitle);
  const warning = used.length ? `\n\nAttention, il est utilisé par : ${used.join(", ")}.` : "";
  if (!confirm(`Supprimer le quiz « ${q.title} » ?${warning}`)) return;
  await set(ref(db, `library/quizzes/${id}`), null);
}

$("quiz-import-open").onclick = () => {
  $("import-text").value = "";
  $("import-file").value = "";
  status("import-status", "");
  updatePrompt();
  show("import");
};

function updatePrompt() {
  $("gem-prompt").value = geminiPrompt({ theme: $("gem-theme").value, age: $("gem-age").value, count: Number($("gem-count").value) || 8 });
}
["gem-theme", "gem-age", "gem-count"].forEach((id) => $(id).addEventListener("input", updatePrompt));
$("gem-copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("gem-prompt").value);
    $("gem-copy").textContent = "Consigne copiée";
  } catch {
    $("gem-prompt").select();
    $("gem-copy").textContent = "Sélectionnée : faites Ctrl+C";
  }
  setTimeout(() => { $("gem-copy").textContent = "Copier la consigne"; }, 2500);
};
$("import-file").onchange = async () => {
  const file = $("import-file").files[0];
  if (file) $("import-text").value = await file.text();
};

$("import-analyse").onclick = () => {
  const parsed = parseQuiz($("import-text").value);
  if (!parsed.questions.length) return status("import-status", "Aucune question trouvée. Vérifiez le texte collé.");
  const theme = $("gem-theme").value.trim();
  const age = Number($("gem-age").value) || null;
  review(null, {
    title: parsed.title || theme || "Quiz sans titre",
    theme: parsed.theme || theme || "",
    ageMin: parsed.ageMin ?? age, ageMax: parsed.ageMax ?? age,
    source: parsed.format === "texte" ? "gemini" : parsed.format,
    questions: parsed.questions.map((q) => ({ ...q, status: "brouillon" })),
  });
};

// ---------- Relecture d'un quiz ----------

let draft = null; // { id, quiz, questions }

function review(id, quiz) {
  draft = {
    id,
    quiz,
    questions: (quiz.questions ?? []).filter(Boolean).map((q) => ({
      text: q.text ?? "", choices: [...(q.choices ?? [])], correct: q.correct ?? -1,
      duration: q.duration ?? null, double: q.double === true, status: q.status ?? "brouillon", marks: q.marks ?? 0,
    })),
  };
  $("rv-title").value = quiz.title ?? "";
  $("rv-theme").value = quiz.theme ?? "";
  $("rv-age-min").value = quiz.ageMin ?? "";
  $("rv-age-max").value = quiz.ageMax ?? "";
  status("rv-status", "");
  show("review");
  renderReview();
}

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
        h("label", { class: "check" }, h("input", { type: "checkbox", class: "q-valid", checked: q.status === "validee", onchange: (e) => { q.status = e.target.checked ? "validee" : "brouillon"; recheck(); } }), "Validée"),
        h("button", { type: "button", class: "icon", title: "Supprimer la question", text: "✕", onclick: () => { draft.questions.splice(i, 1); renderReview(); } })),
      h("textarea", { class: "q-text", rows: 2, value: q.text, oninput: (e) => { q.text = e.target.value.trim(); q.marks = 0; recheck(); } }),
      h("div", { class: "choices" }, ...slots.map((c, k) => h("label", { class: "choice" },
        h("input", { type: "radio", name: `correct-${i}`, checked: q.correct === k, onchange: () => { q.correct = k; q.marks = 0; syncChoices(q, slots); } }),
        h("span", { class: "letter", text: LETTERS[k] }),
        h("input", { class: "q-choice", value: c, placeholder: k < 2 ? "Proposition" : "Facultatif", oninput: (e) => { slots[k] = e.target.value; syncChoices(q, slots); } })))),
      h("div", { class: "row" },
        h("label", { class: "inline" }, "Durée (s)", h("input", { type: "number", min: 5, max: 120, class: "q-duration", value: q.duration ?? "", placeholder: "auto", oninput: (e) => { q.duration = e.target.value === "" ? null : Number(e.target.value); recheck(); } })),
        h("label", { class: "check" }, h("input", { type: "checkbox", checked: q.double, onchange: (e) => { q.double = e.target.checked; } }), "Points ×2")),
      h("ul", { class: "problems" }));
    box.append(card);
  });
  recheck();
}

/** Propositions remplies dans l'ordre ; la bonne réponse suit la case cochée. */
function syncChoices(q, slots) {
  const filled = slots.map((c, k) => [c.trim(), k]).filter(([c]) => c);
  const radio = $("rv-list").querySelector(`[data-q="${draft.questions.indexOf(q)}"]`)?.querySelectorAll("input[type=radio]");
  const checkedSlot = radio ? [...radio].findIndex((r) => r.checked) : q.correct;
  q.choices = filled.map(([c]) => c);
  q.correct = filled.findIndex(([, k]) => k === checkedSlot);
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

$("rv-save").onclick = async () => {
  const title = $("rv-title").value.trim();
  if (!title) return status("rv-status", "Donnez un titre au quiz.");
  const questions = draft.questions.filter((q) => q.text || q.choices.length);
  if (!questions.length) return status("rv-status", "Le quiz ne contient aucune question.");
  const empty = questions.findIndex((q) => !q.text || !q.choices.length);
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
        text: q.text.slice(0, 300), choices: q.choices, correct: q.correct, duration: q.duration, double: q.double, status: q.status,
      })),
    });
    draft.id = id;
    const ok = questions.filter((q) => q.status === "validee").length;
    status("rv-status", `Enregistré : ${ok} question${ok > 1 ? "s" : ""} validée${ok > 1 ? "s" : ""} sur ${questions.length}.`, true);
  } catch (err) {
    console.error(err);
    status("rv-status", "Enregistrement refusé : vérifiez les questions ou vos droits d'administration.");
  } finally {
    $("rv-save").disabled = false;
  }
};

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
    if (pw.length < MIN_PASSWORD_LENGTH) return status(out, `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`);
    if (pw !== $(pw2).value) return status(out, "Les deux mots de passe ne sont pas identiques.");
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
