// Régie de l'animatrice dans un vrai navigateur (Chromium) branché sur l'émulateur Firebase.
// Ce script joue le rôle de la box : il juge les demandes d'appairage et répond aux commandes.
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { ref, get, set, update, onValue } from "firebase/database";
import { chromium } from "playwright";
import { loadRules, seedAdmin, ADMIN_PASSWORD } from "./rules-loader.js";
import { lockedUntil } from "../web/public/show.js";

const ROOT = new URL("..", import.meta.url).pathname;
const PUBLIC = join(ROOT, "web/public");
const FIREBASE_JS = join(ROOT, "tests/node_modules/firebase");
const CODE = "REGI2";
const HOST = "box";
const PIN = "0427";
const PASSWORD = "Licorne-2026";
const SALT = "sel-de-test-0123456789";

const testConfig = JSON.stringify({
  apiKey: "demo-key", authDomain: "demo-lmp.firebaseapp.com",
  databaseURL: "https://demo-lmp.firebaseio.com", projectId: "demo-lmp", appId: "demo",
});
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon" };

let env, server, browser, baseUrl;
let box = null;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-lmp",
    database: { rules: loadRules(), host: "127.0.0.1", port: 9000 },
  });
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/firebase-config.json") return res.end(testConfig);
    const file = normalize(join(PUBLIC, path === "/" ? "index.html" : path));
    if (!file.startsWith(PUBLIC) || !existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
  await env?.cleanup();
});

const hostDb = () => env.authenticatedContext(HOST).database();
const read = async (path) => (await get(ref(hostDb(), `games/${CODE}/${path}`))).val();
const gameRef = (path = "") => ref(hostDb(), `games/${CODE}${path ? `/${path}` : ""}`);

const QUESTIONS = [
  { text: "Couleur du ciel ?", choices: ["Vert", "Bleu", "Rouge", "Jaune"], correct: 1 },
  { text: "Le soleil est une étoile", choices: ["Vrai", "Faux"], correct: 0 },
];

function questionState(seq, index = 0) {
  const q = QUESTIONS[index];
  return {
    phase: "question", seq, index, total: QUESTIONS.length, qid: `q${index + 1}`, kind: "classic", double: false,
    text: q.text, choices: q.choices, durationMs: 20000, paused: false, deadline: Date.now() + 20000,
    scores: {}, round: 1, buzzOpen: false,
  };
}

/**
 * Box simulée, avec les mêmes décisions que la vraie : PIN comparé côté box, commande
 * d'avancement refusée si expectSeq ne correspond plus, réponse dans commandStatus/.
 */
function startBox({ silent = false, held = false } = {}) {
  /** Verdict imposé à la prochaine modification du programme (pour vérifier ce qu'affiche la régie). */
  let refuseProgram = null;
  const db = hostDb();
  let latest = {};
  let state = { phase: "lobby", seq: 0, total: QUESTIONS.length, scores: {}, round: 1, buzzOpen: true };
  const handled = new Set();
  const stops = [];
  /** Manche de mimes en cours (paquet restant), comme le moteur : MimeRound. */
  let deck = [];
  let allCards = [];
  /** Sauts reçus de la régie (commande goto). */
  const gotos = [];
  stops.push(onValue(ref(db, `games/${CODE}/pairing`), async (s) => {
    for (const [uid, req] of Object.entries(s.val() ?? {})) {
      const ok = req.pin === PIN;
      await update(ref(db, `games/${CODE}`), {
        [`pairing/${uid}`]: null,
        [`pairingResult/${uid}`]: { status: ok ? "ok" : "wrong", at: Date.now() },
        ...(ok ? { [`regie/${uid}`]: { pairedAt: Date.now(), via: "pin" } } : {}),
      });
    }
  }));
  // Une par une, dans l'ordre des clés, comme la box.
  async function process() {
    for (const [id, cmd] of Object.entries(latest).sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (handled.has(id)) continue;
      handled.add(id);
      if (cmd.type === "admit" || cmd.type === "replace") { await admitDevice(id, cmd); continue; }
      const advance = ["next", "close", "end", "pause", "resume", "mime_start", "mime_found", "mime_pass", "mime_stop", "goto", "buzz_ok", "buzz_ko"].includes(cmd.type);
      let status = { status: "applied" };
      if (advance && cmd.expectSeq !== state.seq) status = { status: "stale", reason: "stale" };
      else {
        const seq = state.seq + 1;
        const m = state.mime;
        if (cmd.type === "goto") {
          // Saut de la régie (secours) : même vérification du programme que Command.Goto.
          const plan = (await get(ref(db, `games/${CODE}/conducteur`))).val();
          const q = plan?.questions?.[cmd.index];
          if (!q || q.id !== cmd.qid) status = { status: "refused", reason: "stale_program" };
          else {
            gotos.push({ index: cmd.index, qid: cmd.qid });
            state = q.kind === "mime"
              ? { ...state, seq, phase: "question", index: cmd.index, qid: q.id, kind: "mime", text: q.text, choices: null, deadline: null, paused: false, mime: { team: null, card: null, found: 0, passed: 0, left: q.cards.length, turns: [], counts: {}, points: 50 } }
              : { ...questionState(seq), index: cmd.index, qid: q.id, text: q.text, choices: q.choices, total: plan.questions.length, scores: state.scores, mime: null };
          }
        }
        else if (cmd.type === "buzz_ok" || cmd.type === "buzz_ko") {
          // Image floue : même verdict que BuzzJudged (150 au premier, 100 au rebond ; erreur = équipe bloquée, nouvelle clé).
          const b = state.buzz;
          if (state.phase !== "question" || state.kind !== "flou" || !b?.team || state.paused) status = { status: "refused", reason: "not_now" };
          else if (cmd.type === "buzz_ok") {
            const points = b.blocked.length ? 100 : 150;
            state = { ...state, seq, phase: "reveal", buzzOpen: false, awards: { [b.team]: { correct: true, points, bonus: 0 } }, scores: { ...state.scores, [b.team]: (state.scores[b.team] ?? 0) + points } };
          } else {
            const blocked = [...b.blocked, b.team];
            state = { ...state, seq, buzzOpen: true, round: `${state.qid}-1000-${blocked.length}`, buzz: { team: null, blocked }, buzzBlocked: Object.fromEntries(blocked.map((t) => [t, true])) };
          }
        }
        else if (cmd.type.startsWith("mime_") || (m && ["next", "close"].includes(cmd.type))) {
          const next = mimeStep(state, cmd, seq);
          if (next) state = next; else status = { status: "refused", reason: "not_now" };
        }
        else if (cmd.type === "next" && state.phase === "lobby") state = questionState(seq);
        else if (cmd.type === "close") state = { ...state, seq, phase: "closed", deadline: null };
        else if (cmd.type === "pause" && state.paused) status = { status: "refused", reason: "not_now" };
        else if (cmd.type === "pause") state = { ...state, seq, paused: true, pauseReason: "regie", deadline: null, remainingMs: 15000 };
        else if (cmd.type === "resume") {
          const resumeAt = Date.now() + 3000;
          state = { ...state, seq, paused: false, pauseReason: null, pauseTeam: null, resumeAt, deadline: resumeAt + (state.remainingMs ?? 0), remainingMs: null };
        }
        else if (cmd.type === "next" && state.paused) status = { status: "refused", reason: "paused" };
        else if (cmd.type === "adjust") state = { ...state, seq, scores: { ...state.scores, [cmd.team]: (state.scores[cmd.team] ?? 0) + cmd.delta } };
        else if (cmd.type === "undo") state = { ...state, seq };
        else if (cmd.type === "end") state = { ...state, seq, phase: "ended" };
        else state = { ...state, seq };
        if (status.status === "applied") status.seq = seq;
      }
      await update(ref(db, `games/${CODE}`), { state, [`commandStatus/${id}`]: { ...status, at: Date.now() } });
    }
  }
  /** Mimes : mêmes règles que le moteur (MimeTurnStarted, MimeFound, MimePassed, MimeCorrected, MimeTurnEnded). */
  function mimeStep(st, cmd, seq) {
    const m = st.mime;
    if (!m || st.paused) return null;
    const counts = { ...(m.counts ?? {}) };
    const add = (team, d) => {
      counts[team] = Math.max(0, (counts[team] ?? 0) + d);
      return { ...st.scores, [team]: (st.scores[team] ?? 0) + (counts[team] - (m.counts?.[team] ?? 0)) * 50 };
    };
    const endTurn = (x) => ({ ...x, deadline: null, mime: { ...x.mime, team: null, card: null, found: 0, passed: 0, last: { team: m.team, found: x.mime.found, passed: x.mime.passed } } });
    switch (cmd.type) {
      case "mime_start":
        if (m.team) return null;
        // Paquet épuisé par les équipes précédentes : rebattu pour que chaque équipe ait son tour.
        if (!deck.length) deck = [...allCards];
        return { ...st, seq, deadline: Date.now() + 60000, mime: { ...m, team: cmd.team, card: deck[0], found: 0, passed: 0, turns: [...(m.turns ?? []), cmd.team] } };
      case "mime_found": {
        if (!m.team) return null;
        const scores = add(m.team, 1);
        deck = deck.slice(1);
        const next = { ...st, seq, scores, mime: { ...m, counts, card: deck[0] ?? null, left: deck.length, found: m.found + 1 } };
        return deck.length ? next : endTurn(next);
      }
      case "mime_pass":
        if (!m.team || deck.length < 2) return null;
        deck = [...deck.slice(1), deck[0]];
        return { ...st, seq, mime: { ...m, card: deck[0], passed: m.passed + 1 } };
      case "mime_fix": {
        if ((counts[cmd.team] ?? 0) + cmd.delta < 0) return null;
        const scores = add(cmd.team, cmd.delta);
        const fix = (t) => (t && t.team === cmd.team ? { ...t, found: Math.max(0, t.found + cmd.delta) } : t);
        return { ...st, seq, scores, mime: { ...m, counts, found: m.team === cmd.team ? Math.max(0, m.found + cmd.delta) : m.found, last: fix(m.last) ?? null } };
      }
      case "mime_stop":
      case "close":
        return m.team ? endTurn({ ...st, seq }) : null;
      case "next":
        return m.team ? endTurn({ ...st, seq }) : { ...st, seq, phase: "scores", deadline: null };
      default:
        return null;
    }
  }
  // Appareil arrivé en cours de partie : mêmes vérifications que GameViewModel.admitDevice.
  async function admitDevice(id, cmd) {
    const request = (await get(ref(db, `games/${CODE}/joinRequests/${cmd.device}`))).val();
    const teams = (await get(ref(db, `games/${CODE}/teams`))).val() ?? {};
    const entries = Object.entries(teams);
    const reason = !request ? "gone"
      : entries.some(([t, v]) => t === cmd.device || v.device === cmd.device) ? "busy"
        : cmd.type === "admit" && entries.length >= 8 ? "full"
          : cmd.type === "replace" && !teams[cmd.team] ? "unknown_team" : null;
    const updates = { [`commandStatus/${id}`]: { status: reason ? "refused" : "applied", ...(reason ? { reason } : {}), at: Date.now() } };
    if (!reason) {
      updates[`joinRequests/${cmd.device}`] = null;
      if (cmd.type === "replace") updates[`teams/${cmd.team}/device`] = cmd.device;
      else updates[`teams/${cmd.device}`] = { name: request.name, color: request.color, joinedAt: Date.now() };
    }
    await update(ref(db, `games/${CODE}`), updates);
  }
  // Prestation chargée par la régie, ou programme modifié en cours de partie : mêmes vérifications que
  // GameViewModel.judgeShow (version du programme, manche en cours intouchable), conducteur republié.
  let judgedShow = null;
  if (!silent) stops.push(onValue(ref(db, `games/${CODE}/show`), async (s) => {
    const show = s.val();
    if (!show || show.id === judgedShow) return;
    judgedShow = show.id;
    const plan = (await get(ref(db, `games/${CODE}/conducteur`))).val();
    if (show.base == null) {
      await update(ref(db, `games/${CODE}`), {
        showStatus: { id: show.id, status: "applied", at: Date.now() },
        conducteur: { id: show.quiz.id, title: show.title, rev: show.id, mimes: true, numbers: true, express: true, zoom: true, flou: true, questions: show.quiz.questions },
        public: { title: show.title, childName: show.childName },
      });
      return;
    }
    const index = state.phase === "lobby" ? -1 : state.index;
    const keep = lockedUntil(plan.questions, index);
    const same = (i) => JSON.stringify(show.quiz.questions[i]) === JSON.stringify(plan.questions[i]);
    const reason = refuseProgram ?? (state.phase === "ended" ? "ended" : show.base !== plan.rev ? "stale"
      : show.quiz.questions.length <= keep || ![...Array(keep + 1).keys()].every(same) ? "current_round" : null);
    refuseProgram = null;
    const updates = { showStatus: { id: show.id, status: reason ? "refused" : "applied", ...(reason ? { reason } : {}), at: Date.now() } };
    if (!reason) {
      state = { ...state, total: show.quiz.questions.length };
      Object.assign(updates, { state, conducteur: { ...plan, rev: show.id, questions: show.quiz.questions } });
    }
    await update(ref(db, `games/${CODE}`), updates);
  }));
  // Image floue : le premier buzz écrit sous la clé en cours fige l'image pour son équipe (comme watchBuzz).
  if (!silent) stops.push(onValue(ref(db, `games/${CODE}/buzz`), async (s) => {
    const team = s.val()?.[state.round]?.team;
    if (state.kind !== "flou" || state.phase !== "question" || !team || state.buzz?.team || state.buzz?.blocked.includes(team)) return;
    state = { ...state, seq: state.seq + 1, buzzOpen: false, buzz: { ...state.buzz, team } };
    await update(ref(db, `games/${CODE}`), { state });
  }));
  if (!silent) stops.push(onValue(ref(db, `games/${CODE}/commands`), (s) => {
    latest = s.val() ?? {};
    if (!held) process();
  }));
  return {
    stop: () => stops.forEach((f) => f()),
    release: () => { held = false; return process(); },
    get state() { return state; },
    /** Partie arrivée à une manche de mimes de [cards] (sans tour en cours). */
    async mimes(cards, scores = {}) {
      deck = cards;
      allCards = cards;
      state = {
        ...state, phase: "question", seq: state.seq + 1, index: 2, qid: "m1", kind: "mime", text: "Animaux", durationMs: 60000,
        choices: null, deadline: null, scores, buzzOpen: false,
        mime: { team: null, card: null, found: 0, passed: 0, left: cards.length, turns: [], counts: {}, points: 50 },
      };
      await update(ref(db, `games/${CODE}`), { state });
    },
    refuseNextProgram: (reason) => { refuseProgram = reason; },
    gotos,
    /** Place la partie dans l'état [partial] (question en cours, partie terminée…). */
    async set(partial) {
      state = { ...state, ...partial };
      await update(ref(db, `games/${CODE}`), { state });
    },
  };
}

beforeEach(async () => {
  await env.clearDatabase();
  await seedAdmin(env);
  await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), "settings/regie"), {
    salt: SALT, hash: createHash("sha256").update(`${SALT}:${PASSWORD}`).digest("hex"), updatedAt: 1,
  }));
  await set(gameRef(), {
    hostUid: HOST,
    state: { phase: "lobby", seq: 0, total: QUESTIONS.length, scores: {}, round: 1, buzzOpen: true },
    conducteur: { id: "demo", title: "Démo", rev: "initial", mimes: true, numbers: true, express: true, zoom: true, flou: true, questions: QUESTIONS.map((q, i) => ({ id: `q${i + 1}`, ...q })) },
  });
});
afterEach(() => { box?.stop(); box = null; });

async function addTeam(uid, name) {
  await env.withSecurityRulesDisabled((ctx) =>
    set(ref(ctx.database(), `games/${CODE}/teams/${uid}`), { name, color: "#FF2D8A", joinedAt: Date.now() }));
}

async function openRegie(context, query = `?g=${CODE}&emu=1`, path = "/") {
  context ??= await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("https://www.gstatic.com/firebasejs/11.1.0/*", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    route.fulfill({ path: join(FIREBASE_JS, name), contentType: "text/javascript" });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("Erreur page :", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.error("Console :", m.text()); });
  // Diagnostic : l'adresse exacte d'une requête refusée (émulateur ou vrai service Google).
  page.on("response", (r) => { if (r.status() >= 400) console.error("Réponse", r.status(), r.url(), "depuis", page.url()); });
  await page.goto(`${baseUrl}${path}${query}`);
  return page;
}

/** Administration : le mot de passe commun, saisi sur le PC familial. */
async function openAdmin() {
  const page = await openRegie(null, "?emu=1", "/admin.html");
  await page.fill("#admin-password", ADMIN_PASSWORD);
  await page.click("#login");
  await page.locator("#screen-home:not([hidden])").waitFor();
  return page;
}

/** L'animatrice scanne le même QR code que les équipes, touche « Accès régie » et tape le mot de passe. */
async function pair(page, password = PASSWORD) {
  await page.locator("#regie-open:not([hidden])").click();
  await page.fill("#regie-password", password);
  await page.click("#regie-go");
}

const inRegie = (page) => page.locator("#regie:not([hidden])").waitFor({ timeout: 10000 });

const commands = async () => Object.values((await read("commands")) ?? {});

async function setPresence(uid, online) {
  await env.withSecurityRulesDisabled((ctx) =>
    set(ref(ctx.database(), `games/${CODE}/presence/${uid}`), { online, at: Date.now() }));
}

describe("régie", () => {
  test("mot de passe commun : un mauvais est refusé, le bon ouvre la régie", async () => {
    box = startBox();
    const page = await openRegie();
    await page.locator("#screen-join.active").waitFor();
    await pair(page, "licorne");
    await page.locator("#regie-status", { hasText: "Mot de passe de régie incorrect" }).waitFor();
    assert.equal(await read("regie"), null);
    await page.fill("#regie-password", PASSWORD);
    await page.click("#regie-go");
    await inRegie(page);
    assert.equal(Object.values(await read("regie"))[0].via, "password");
    // Le pupitre ne s'est pas inscrit comme équipe.
    assert.equal(await read("teams"), null);
    await page.context().close();
  });

  test("QR code d'une partie terminée : le bon mot de passe est refusé avec la vraie raison", async () => {
    box = startBox();
    await update(gameRef("state"), { phase: "ended" });
    const page = await openRegie();
    await pair(page);
    await page.locator("#regie-status", { hasText: "Cette partie est terminée. Scannez le QR code affiché en ce moment sur la TV." }).waitFor();
    assert.equal(await read("regie"), null);
    await page.context().close();
  });

  test("code de secours de la TV : un mauvais est refusé, le bon relie le téléphone", async () => {
    box = startBox();
    const page = await openRegie();
    await page.locator("#regie-open:not([hidden])").click();
    await page.click("#regie-use-pin");
    await page.fill("#regie-pin", "1111");
    await page.click("#regie-go");
    await page.locator("#regie-status", { hasText: "Code incorrect" }).waitFor();
    await page.fill("#regie-pin", PIN);
    await page.click("#regie-go");
    await inRegie(page);
    assert.equal(Object.values(await read("regie"))[0].via, "pin");
    await page.context().close();
  });

  test("sans mot de passe enregistré, la page oriente vers le code de la TV", async () => {
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), "settings/regie"), null));
    const page = await openRegie();
    await pair(page);
    await page.locator("#regie-status", { hasText: "Aucun mot de passe" }).waitFor();
    await page.context().close();
  });

  test("le bouton Accès régie disparaît pour une équipe qui joue", async () => {
    const page = await openRegie();
    await page.locator("#regie-open:not([hidden])").waitFor();
    await page.fill("#team-name", "Les Roses");
    await page.click("#join");
    await page.locator("#screen-play.active").waitFor();
    assert.equal(await page.locator("#regie-open").isHidden(), true);
    await page.context().close();
  });

  test("Sarah change le mot de passe dans l'administration : effet immédiat, régie en cours gardée", async () => {
    box = startBox();
    const before = await openRegie();
    await pair(before);
    await inRegie(before);

    const admin = await openAdmin();
    await admin.click("#nav button[data-screen=settings]");
    await admin.locator("#screen-settings:not([hidden])").waitFor();
    await admin.fill("#pw1", "court");
    await admin.fill("#pw2", "court");
    await admin.click("#save");
    await admin.locator("#save-status", { hasText: "au moins 8" }).waitFor();
    await admin.fill("#pw1", "Nouveau-Mdp-42");
    await admin.fill("#pw2", "Nouveau-Mdp-42");
    await admin.click("#save");
    await admin.locator("#save-status", { hasText: "Mot de passe de la régie enregistré" }).waitFor();

    const oldPassword = await openRegie();
    await pair(oldPassword, PASSWORD);
    await oldPassword.locator("#regie-status", { hasText: "Mot de passe de régie incorrect" }).waitFor();
    const newPassword = await openRegie();
    await pair(newPassword, "Nouveau-Mdp-42");
    await inRegie(newPassword);
    // L'animatrice reliée avant le changement pilote toujours.
    await addTeam("rose", "Les Roses");
    await before.locator("#c-next", { hasText: "Lancer le quiz" }).click();
    await before.locator("#c-question", { hasText: "Couleur du ciel ?" }).waitFor();
    for (const p of [before, admin, oldPassword, newPassword]) await p.context().close();
  });

  test("espaces ajoutés par le clavier du téléphone : le mot de passe de régie est quand même accepté", async () => {
    box = startBox();
    const admin = await openAdmin();
    await admin.click("#nav button[data-screen=settings]");
    await admin.locator("#screen-settings:not([hidden])").waitFor();
    await admin.fill("#pw1", "sacha 100111");
    await admin.fill("#pw2", "sacha100111 ");
    await admin.click("#save");
    await admin.locator("#save-status", { hasText: "Mot de passe de la régie enregistré" }).waitFor();
    const phone = await openRegie();
    await pair(phone, "sacha100111 ");
    await inRegie(phone);
    // Un mot de passe enregistré avec un espace avant cette règle s'ouvre encore tel quel.
    const salt = "0123456789abcdef0123";
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), "settings/regie"),
      { salt, hash: createHash("sha256").update(`${salt}:licorne 42`).digest("hex"), updatedAt: Date.now() }));
    const old = await openRegie();
    await pair(old, "licorne 42");
    await inRegie(old);
    for (const p of [admin, phone, old]) await p.context().close();
  });

  test("administration : une connexion ratée à l'ouverture est réessayée seule", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    let failed = 0;
    await context.route("**/accounts:signUp*", (route) => (failed++ ? route.continue() : route.abort("internetdisconnected")));
    const admin = await openRegie(context, "?emu=1", "/admin.html");
    // « Entrer » reste grisé tant que la page n'est pas prête (ici : après le rechargement automatique).
    await admin.locator("#login:enabled").waitFor();
    await admin.fill("#admin-password", ADMIN_PASSWORD);
    await admin.click("#login");
    await admin.locator("#screen-home:not([hidden])").waitFor();
    assert.ok(failed >= 2, "un premier essai refusé, puis un second accepté");
    await context.close();
  });

  test("un mauvais mot de passe administrateur n'ouvre rien", async () => {
    const admin = await openRegie(null, "?emu=1", "/admin.html");
    await admin.fill("#admin-password", "pas-le-bon-mdp");
    await admin.click("#login");
    await admin.locator("#login-status", { hasText: "Mot de passe incorrect" }).waitFor();
    assert.equal(await admin.locator("#screen-settings").isHidden(), true);
    assert.equal(await admin.locator("#nav").isHidden(), true);
    await admin.context().close();
  });

  test("première configuration, appareil reconnu après rechargement, changement du mot de passe administrateur", async () => {
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), "settings/admin"), null));
    const pc = await openRegie(null, "?emu=1", "/admin.html");
    await pc.locator("#login-title", { hasText: "Première configuration" }).waitFor();
    await pc.fill("#admin-password", "Famille-2026");
    await pc.fill("#admin-password2", "Famille-2026");
    await pc.click("#login");
    await pc.locator("#screen-home:not([hidden])").waitFor();
    // Rechargement (ou coupure) : rien à ressaisir.
    await pc.reload();
    await pc.locator("#screen-home:not([hidden])").waitFor();
    // Un second ordinateur entre avec le même mot de passe.
    const portable = await openRegie(null, "?emu=1", "/admin.html");
    await portable.fill("#admin-password", "Famille-2026");
    await portable.click("#login");
    await portable.locator("#screen-home:not([hidden])").waitFor();
    // Changement depuis le PC : il reste connecté, le portable devra le ressaisir.
    await pc.click("#nav button[data-screen=settings]");
    await pc.fill("#admin-pw1", "Nouveau-Famille-1");
    await pc.fill("#admin-pw2", "Nouveau-Famille-1");
    await pc.click("#admin-save");
    await pc.locator("#admin-save-status", { hasText: "Mot de passe administrateur changé" }).waitFor({ timeout: 15000 });
    await portable.reload();
    await portable.locator("#login-title", { hasText: "Connexion" }).waitFor();
    await pc.reload();
    await pc.locator("#screen-home:not([hidden])").waitFor();
    for (const p of [pc, portable]) await p.context().close();
  });

  test("mimes : choisir l'équipe, lancer le tour, trouvé, passer, corriger ; les points vont au classement", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    const cards = [{ word: "Chat", image: "🐱" }, { word: "Pirate", image: "🏴‍☠️" }, { word: "Pizza", image: "🍕" }, { word: "Robot", image: "🤖" }];
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await box.mimes(cards, { rose: 100 });
    await page.locator("#mime:not([hidden])").waitFor();
    await page.locator("#mime-info", { hasText: "Qui commence ?" }).waitFor();
    assert.equal(await page.locator("#mime-found").isHidden(), true, "Pas de « Trouvé » avant le tour");
    await page.locator("#c-next", { hasText: "Terminer les mimes" }).waitFor();
    await page.locator(".mime-team", { hasText: "Les Bleus" }).click();
    await page.locator("#mime-go", { hasText: "Top départ ! (Les Bleus)" }).click();
    await page.locator("#mime-now .word", { hasText: "Chat" }).waitFor();
    await page.locator("#c-next", { hasText: "Arrêter le tour" }).waitFor();
    await page.click("#mime-found");
    await page.locator("#mime-now .word", { hasText: "Pirate" }).waitFor();
    await page.click("#mime-pass");
    await page.locator("#mime-now .word", { hasText: "Pizza" }).waitFor();
    await page.click("#mime-found");
    await page.locator("#mime-info", { hasText: "2 mimes trouvés" }).waitFor();
    await page.click("#mime-minus");
    await page.locator("#mime-info", { hasText: "1 mime trouvé" }).waitFor();
    await page.click("#c-next");
    await page.locator("#mime-info", { hasText: "Les Bleus a trouvé 1 mime" }).waitFor();
    // Juste après le tour : l'animatrice rend le point retiré par erreur.
    await page.click("#mime-fix-plus");
    await page.locator("#mime-info", { hasText: "Les Bleus a trouvé 2 mimes" }).waitFor();
    // L'équipe suivante proposée est celle qui n'a pas encore joué.
    await page.locator(".mime-team.selected", { hasText: "Les Roses" }).waitFor();
    await page.locator("#mime-progress", { hasText: "Déjà passées : Les Bleus · Restent : Les Roses" }).waitFor();
    assert.deepEqual((await commands()).map((c) => c.type), ["mime_start", "mime_found", "mime_pass", "mime_found", "mime_fix", "close", "mime_fix"]);
    assert.deepEqual((await commands()).find((c) => c.type === "mime_start").team, "bleu");
    // Terminer avant que toutes les équipes soient passées : confirmation, et rien n'est envoyé si on renonce.
    let asked = "";
    page.once("dialog", (d) => { asked = d.message(); d.dismiss(); });
    await page.click("#c-next");
    await page.waitForTimeout(300);
    assert.match(asked, /Les Roses n'est pas encore passée/);
    assert.equal((await commands()).length, 7);
    // Les Roses jouent (paquet rebattu au besoin), puis le classement sans confirmation.
    await page.click("#mime-go");
    await page.locator("#mime-found:not([hidden]):not([disabled])").waitFor();
    await page.click("#mime-found");
    await page.locator("#mime-info", { hasText: "Les Roses joue : 1 mime trouvé" }).waitFor();
    await page.click("#c-next");
    await page.locator("#mime-progress", { hasText: "Toutes les équipes sont passées" }).waitFor();
    await page.locator("#c-next", { hasText: "Voir le classement" }).click();
    await page.locator("#c-phase", { hasText: "Scores" }).waitFor();
    assert.deepEqual((await read("state")).scores, { rose: 150, bleu: 100 });
    assert.equal(await page.locator("#mime").isHidden(), true);
    await page.context().close();
  });

  test("Image floue : la régie voit qui a buzzé et la réponse attendue, refuse puis valide le rebond", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    const plan = [{ id: "f1", text: "Qu'est-ce qui se cache sous le flou ?", choices: ["Un lion", "Un chat"], correct: 0, duration: 40, kind: "flou", imageId: "0123456789abcdef", round: "Image floue" }];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, numbers: true, express: true, zoom: true, flou: true, questions: plan });
    await box.set({ ...questionState(1), qid: "f1", kind: "flou", text: plan[0].text, choices: null, total: 1, round: "f1-1000-0", buzzOpen: true, buzz: { team: null, blocked: [] } });
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await page.locator("#flou-info", { hasText: "En attente d'un buzz" }).waitFor();
    assert.equal(await page.locator("#flou-judge").isHidden(), true, "pas de verdict sans buzz");
    // Les Roses buzzent (écriture du pupitre) : la régie affiche l'équipe et la réponse attendue.
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/buzz/f1-1000-0`), { team: "rose", at: Date.now() }));
    await page.locator("#flou-info", { hasText: "Les Roses a buzzé ! Réponse attendue : Un lion" }).waitFor();
    await page.locator("#flou-ok small", { hasText: "+150 pour Les Roses" }).waitFor();
    await page.click("#flou-ko");
    await page.locator("#flou-info", { hasText: "Déjà essayé : Les Roses" }).waitFor();
    assert.deepEqual((await read("state")).buzz.blocked, ["rose"]);
    // Rebond des Bleus, validé : 100 points et révélation.
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/buzz/f1-1000-1`), { team: "bleu", at: Date.now() }));
    await page.locator("#flou-ok small", { hasText: "+100 pour Les Bleus" }).waitFor();
    await page.click("#flou-ok");
    await page.locator("#c-phase", { hasText: "Réponse révélée" }).waitFor();
    assert.deepEqual((await read("state")).scores, { bleu: 100 });
    assert.equal(await page.locator("#flou").isHidden(), true);
    await page.context().close();
  });

  test("secours : jeu en cours et suivant, passer au suivant, rejouer un jeu après confirmation", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const plan = [
      { id: "q1", text: "Couleur du ciel ?", choices: ["Vert", "Bleu"], correct: 1, duration: 20, kind: "classic", round: "Quiz de Léa" },
      { id: "q2", text: "2 + 2 ?", choices: ["4", "5"], correct: 0, duration: 20, kind: "classic", round: "Quiz de Léa" },
      { id: "a1m", text: "Animaux", kind: "mime", duration: 60, round: "Animaux", cards: [{ word: "Chat", image: "🐱" }] },
      { id: "f1", text: "Finale ?", choices: ["A", "B"], correct: 0, duration: 10, kind: "classic", round: "Finale" },
    ];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, numbers: true, express: true, zoom: true, flou: true, questions: plan });
    await box.set({ ...questionState(4), index: 1, qid: "q2", text: "2 + 2 ?", total: 4, scores: { rose: 100 } });
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await page.locator("#c-games", { hasText: "En cours : Quiz de Léa · Ensuite : Mimes : Animaux" }).waitFor();
    await page.click("#c-rescue");
    await page.locator("#rescue:not([hidden])").waitFor();
    await page.locator("#rescue-list .rescue-game.current", { hasText: "Quiz de Léa" }).locator("button", { hasText: "Rejouer" }).waitFor();
    await page.locator("#rescue-list .rescue-game", { hasText: "Finale" }).locator("button", { hasText: "Aller à ce jeu" }).waitFor();
    // Renoncer : rien n'est envoyé.
    page.once("dialog", (d) => d.dismiss());
    await page.click("#rescue-next");
    await page.waitForTimeout(300);
    assert.equal(box.gotos.length, 0);
    // Passer au jeu suivant : les mimes s'ouvrent, les points restent.
    let asked = "";
    page.once("dialog", (d) => { asked = d.message(); d.accept(); });
    await page.locator("#rescue-next", { hasText: "Passer au jeu suivant : Mimes : Animaux" }).click();
    await page.locator("#r-toast", { hasText: "C'est parti pour « Mimes : Animaux » !" }).waitFor();
    assert.match(asked, /points déjà gagnés sont gardés/);
    assert.deepEqual(box.gotos, [{ index: 2, qid: "a1m" }]);
    await page.locator("#mime:not([hidden])").waitFor();
    await page.locator("#c-games", { hasText: "En cours : Mimes : Animaux · Ensuite : Finale" }).waitFor();
    // Rejouer le quiz : confirmation qui dit que ses points sont retirés puis rejoués.
    await page.click("#c-rescue");
    page.once("dialog", (d) => { asked = d.message(); d.accept(); });
    await page.locator("#rescue-list .rescue-game", { hasText: "Quiz de Léa" }).locator("button", { hasText: "Rejouer" }).click();
    await page.locator("#r-toast", { hasText: "« Quiz de Léa » est relancé." }).waitFor();
    assert.match(asked, /rien n'est compté deux fois/);
    assert.deepEqual(box.gotos[1], { index: 0, qid: "q1" });
    // Partie terminée par erreur : un jeu peut encore être relancé.
    await box.set({ phase: "ended", seq: (await read("state")).seq + 1 });
    await page.locator("#c-rescue:not([hidden])").click();
    page.once("dialog", (d) => d.accept());
    await page.locator("#rescue-list .rescue-game", { hasText: "Finale" }).locator("button", { hasText: "Rejouer" }).click();
    await page.locator("#r-toast", { hasText: "« Finale » est relancé." }).waitFor();
    assert.deepEqual(box.gotos[2], { index: 3, qid: "f1" });
    await page.context().close();
  });

  test("mimes en pause : les gros boutons sont figés jusqu'à la reprise", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await box.mimes([{ word: "Chat" }, { word: "Robot" }]);
    await page.locator("#mime-go", { hasText: "Les Roses" }).click();
    await page.locator("#mime-found:not([disabled])").waitFor();
    await page.click("#c-pause");
    await page.locator("#c-phase", { hasText: "En pause" }).waitFor();
    assert.equal(await page.locator("#mime-found").isDisabled(), true);
    assert.equal(await page.locator("#mime-pass").isDisabled(), true);
    await page.click("#c-pause");
    await page.locator("#mime-found:not([disabled])").waitFor();
    await page.context().close();
  });

  test("pupitre pendant les mimes : il dit qui joue, sans rien à toucher", async () => {
    box = startBox();
    const team = await openRegie();
    await team.fill("#team-name", "Les Roses");
    await team.click("#join");
    await team.locator("#screen-play.active").waitFor();
    const rose = Object.keys(await read("teams"))[0];
    await box.mimes([{ word: "Chat" }, { word: "Robot" }]);
    await team.locator("#play-status", { hasText: "L'animatrice choisit l'équipe qui joue" }).waitFor();
    assert.equal(await team.locator("#buzz").isHidden(), true);
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#mime-go", { hasText: "Les Roses" }).click();
    await team.locator("#play-status", { hasText: "C'est votre tour !" }).waitFor();
    assert.equal(await team.locator("body").innerText().then((t) => t.includes("Chat")), false, "Le mot n'apparaît jamais sur le pupitre");
    await regie.click("#mime-found");
    await regie.click("#c-next");
    await regie.locator("#mime-info", { hasText: "Tour terminé" }).waitFor();
    await regie.click("#c-next");
    await team.locator("#r-title", { hasText: "Bravo ! 1 mime trouvé" }).waitFor();
    await team.locator("#r-detail", { hasText: "+50 points" }).waitFor();
    assert.ok(rose);
    for (const p of [team, regie]) await p.context().close();
  });

  test("lancer le quiz, voir la question et sa réponse, arrêter le chrono", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await page.locator("#c-next", { hasText: "En attente des équipes" }).waitFor();
    assert.equal(await page.locator("#c-next").isDisabled(), true);

    await addTeam("rose", "Les Roses");
    await page.locator("#c-next", { hasText: "Lancer le quiz" }).click();
    await page.locator("#c-question", { hasText: "Couleur du ciel ?" }).waitFor();
    await page.locator("#c-answer", { hasText: "Réponse B · Bleu" }).waitFor();
    assert.deepEqual((await commands()).map((c) => [c.type, c.expectSeq]), [["next", 0]]);

    // La bonne réponse se masque d'un toucher, pour qu'aucun enfant ne la lise.
    await page.click("#c-answer");
    await page.locator("#c-answer", { hasText: "masquée" }).waitFor();

    await page.locator("#c-next", { hasText: "Arrêter le chrono" }).click();
    await page.locator("#c-phase", { hasText: "Temps écoulé" }).waitFor();
    assert.deepEqual((await commands()).map((c) => c.type).sort(), ["close", "next"]);
    await page.context().close();
  });

  test("pause générale : la régie fige la partie puis la relance avec le décompte 3, 2, 1", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await setPresence("rose", true);
    const page = await openRegie();
    await pair(page);
    await page.locator("#c-next", { hasText: "Lancer le quiz" }).click();
    await page.locator("#c-question", { hasText: "Couleur du ciel ?" }).waitFor();

    await page.locator("#c-pause", { hasText: "Pause" }).click();
    await page.locator("#c-phase", { hasText: "En pause" }).waitFor();
    await page.locator("#c-hold", { hasText: "chrono, réponses et scores sont figés" }).waitFor();
    await page.locator("#c-hold", { hasText: "Toutes les équipes sont connectées" }).waitFor();
    assert.equal(await page.locator("#c-next").isDisabled(), true, "Suivant bloqué pendant la pause");
    assert.equal(await page.textContent("#c-timer"), "15", "Chrono figé");

    await page.locator("#c-pause", { hasText: "Reprendre (3, 2, 1)" }).click();
    await page.locator("#c-hold").waitFor({ state: "hidden" });
    await page.locator("#c-pause", { hasText: "Pause" }).waitFor();
    assert.equal(await page.locator("#c-next").isDisabled(), false);
    assert.deepEqual((await commands()).map((c) => c.type).sort(), ["next", "pause", "resume"]);
    await page.context().close();
  });

  test("pause automatique : la régie nomme l'équipe déconnectée puis la voit revenir", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    await setPresence("rose", true);
    await setPresence("bleu", false);
    await update(gameRef(), { state: { ...questionState(4), paused: true, pauseReason: "team", pauseTeam: "bleu", deadline: null, remainingMs: 12000 } });
    const page = await openRegie();
    await pair(page);
    await page.locator("#c-hold", { hasText: "« Les Bleus » a perdu la connexion" }).waitFor();
    await page.locator("#c-hold", { hasText: "Pas encore prête : Les Bleus" }).waitFor();
    await setPresence("bleu", true);
    await page.locator("#c-hold", { hasText: "elle est revenue" }).waitFor();
    await page.locator("#c-hold", { hasText: "vous pouvez reprendre" }).waitFor();
    // La reprise reste le choix de l'animatrice : rien n'est envoyé tout seul.
    assert.equal((await commands()).length, 0);
    assert.equal(await page.locator("#c-pause").isDisabled(), false);
    await page.context().close();
  });

  test("pause automatique de la box sans Internet : la régie le dit et laisse la reprise à l'animatrice", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await setPresence("rose", true);
    await update(gameRef(), { state: { ...questionState(4), paused: true, pauseReason: "network", deadline: null, remainingMs: 12000 } });
    const page = await openRegie();
    await pair(page);
    await page.locator("#c-hold", { hasText: "la box avait perdu Internet" }).waitFor();
    await page.locator("#c-hold", { hasText: "vous pouvez reprendre" }).waitFor();
    assert.equal((await commands()).length, 0);
    await page.locator("#c-pause", { hasText: "Reprendre (3, 2, 1)" }).waitFor();
    await page.context().close();
  });

  test("la pause est possible pendant le classement, pas dans le salon d'attente", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    assert.equal(await page.locator("#c-pause").isDisabled(), true, "Salon d'attente");
    await update(gameRef(), { state: { ...questionState(4), phase: "scores", deadline: null } });
    await waitFor(async () => !(await page.locator("#c-pause").isDisabled()), "pause possible au classement");
    await page.context().close();
  });

  test("un double appui sur Suivant n'envoie qu'une commande", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const page = await openRegie();
    await pair(page);
    await page.locator("#c-next", { hasText: "Lancer le quiz" }).waitFor();
    await page.locator("#c-next").dblclick();
    await page.locator("#c-question", { hasText: "Couleur du ciel ?" }).waitFor();
    assert.equal((await commands()).length, 1);
    assert.equal(box.state.seq, 1);
    await page.context().close();
  });

  test("deux téléphones appuient en même temps : la partie n'avance que d'une étape", async () => {
    // La box est occupée : les deux commandes arrivent avant qu'elle ait répondu à la première.
    box = startBox({ held: true });
    await addTeam("rose", "Les Roses");
    const a = await openRegie();
    await pair(a);
    const b = await openRegie();
    await pair(b);
    await a.locator("#c-next", { hasText: "Lancer le quiz" }).waitFor();
    await b.locator("#c-next", { hasText: "Lancer le quiz" }).waitFor();
    await Promise.all([a.click("#c-next"), b.click("#c-next")]);
    await waitFor(async () => (await commands()).length === 2, "deux commandes reçues");
    await box.release();
    await waitFor(async () => Object.values((await read("commandStatus")) ?? {}).length === 2, "deux réponses de la box");
    const statuses = Object.values(await read("commandStatus")).map((s) => s.status).sort();
    assert.deepEqual(statuses, ["applied", "stale"]);
    assert.equal(box.state.seq, 1);
    await a.context().close();
    await b.context().close();
  });

  test("corriger un score puis annuler la correction", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    // Dans le salon d'attente la régie s'ouvre sur les prestations : l'animatrice passe aux équipes.
    await page.click("#tab-teams");
    await page.locator('.team[data-team="rose"] button[data-delta="10"]').click();
    await page.locator(".team .score", { hasText: "10" }).waitFor();
    await page.locator("#undo-text", { hasText: "+10 pour Les Roses" }).waitFor();
    await page.click("#undo-go");
    await waitFor(async () => (await commands()).some((c) => c.type === "undo" && c.target === 1), "annulation envoyée");
    const adjust = (await commands()).find((c) => c.type === "adjust");
    assert.equal(adjust.team, "rose");
    assert.equal(adjust.delta, 10);
    await page.context().close();
  });

  test("le conducteur liste les questions avec leur réponse", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await page.click("#tab-plan");
    await page.locator(".plan-item", { hasText: "Le soleil est une étoile" }).locator("b", { hasText: "A · Vrai" }).waitFor();
    await page.context().close();
  });

  test("terminer la partie exige un appui long", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await page.click("#c-end");
    await page.locator("#r-toast", { hasText: "Gardez le doigt appuyé" }).waitFor();
    assert.equal((await commands()).length, 0);
    const btn = page.locator("#c-end");
    const boxRect = await btn.boundingBox();
    await page.mouse.move(boxRect.x + 10, boxRect.y + 10);
    await page.mouse.down();
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await page.locator("#c-phase", { hasText: "Partie terminée" }).waitFor();
    assert.deepEqual((await commands()).map((c) => c.type), ["end"]);
    await page.context().close();
  });

  test("après un rechargement, le téléphone reste relié sans ressaisir le code", async () => {
    box = startBox();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await openRegie(context);
    await pair(page);
    await inRegie(page);
    await page.reload();
    await inRegie(page);
    assert.equal(await page.textContent("#c-code"), CODE);
    await context.close();
  });

  test("une régie retirée par la TV revient à l'écran d'appairage", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    const [uid] = Object.keys(await read("regie"));
    await update(gameRef(), { [`regie/${uid}`]: null });
    await page.locator("#error-text", { hasText: "n'est plus relié" }).waitFor();
    await page.context().close();
  });

  test("si la box ne répond pas, la régie le dit sans rester bloquée", async () => {
    box = startBox({ silent: true });
    await addTeam("rose", "Les Roses");
    const page = await openRegie();
    await pair(page);
    await page.locator("#c-next", { hasText: "Lancer le quiz" }).click();
    await page.locator("#r-toast", { hasText: "La TV ne répond pas" }).waitFor({ timeout: 10000 });
    assert.equal(await page.locator("#c-next").isDisabled(), false);
    await page.context().close();
  });
});

describe("remplacement d'un appareil en cours de partie", () => {
  /** Tablette d'équipe : rejoint la partie par le QR code habituel. */
  async function tablet(name) {
    const page = await openRegie();
    await page.locator("#screen-join.active").waitFor();
    await page.fill("#team-name", name);
    await page.click("#join");
    return page;
  }
  async function startedGame() {
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    regie.on("dialog", (d) => d.accept());
    const old = await tablet("Les Bleus");
    await old.locator("#screen-play.active").waitFor();
    await addTeam("rose", "Les Roses");
    await regie.locator("#c-next", { hasText: "Lancer le quiz" }).click();
    await old.locator("#screen-question.active").waitFor();
    const [blue] = Object.entries(await read("teams")).find(([, t]) => t.name === "Les Bleus");
    return { regie, old, blue };
  }

  test("tablette remplacée : l'équipe continue sur le nouvel appareil, l'ancien est désactivé même rechargé", async () => {
    const { regie, old, blue } = await startedGame();
    await regie.locator("#panel-teams [data-team] button[data-delta='10']").first().waitFor();
    await regie.locator(`#panel-teams [data-team="${blue}"] button[data-delta="10"]`).click();
    await waitFor(async () => (await read("state"))?.scores?.[blue] === 10, "points avant le remplacement");

    // Un téléphone de secours scanne le QR code : la partie a commencé, il demande à entrer.
    const fresh = await openRegie();
    await fresh.locator("#join", { hasText: "Demander à entrer" }).waitFor();
    await fresh.fill("#team-name", "les bleus");
    await fresh.click("#join");
    await fresh.locator("#screen-waiting.active").waitFor();
    assert.equal(Object.keys(await read("teams")).length, 2, "aucune équipe créée sans la régie");

    // La régie propose en premier l'équipe du même nom.
    const replaceBtn = regie.locator("#c-requests .request button").first();
    await replaceBtn.filter({ hasText: "Remplace « Les Bleus »" }).waitFor();
    await replaceBtn.click();
    await regie.locator("#r-toast", { hasText: "continue sur le nouvel appareil" }).waitFor();
    await regie.locator("#c-requests").waitFor({ state: "hidden" });

    // Nouvel appareil : même équipe, même couleur, il répond pour elle.
    await fresh.locator("#screen-question.active").waitFor();
    assert.equal(await fresh.locator("#screen-question .team-label").textContent(), "Les Bleus");
    await fresh.locator(".choice").nth(1).click();
    await fresh.locator("#q-status", { hasText: "Réponse B envoyée" }).waitFor();
    assert.equal((await read(`answers/q1/${blue}`))?.choice, 1);
    const teams = await read("teams");
    assert.equal(Object.keys(teams).length, 2, "toujours deux équipes");
    assert.equal((await read("state")).scores[blue], 10, "points gardés");

    // Ancien appareil : désactivé tout de suite, et encore après un rechargement.
    await old.locator("#screen-replaced.active").waitFor();
    assert.match(await old.locator("#replaced-text").textContent(), /Les Bleus.*avec tous ses points/);
    await old.reload();
    await old.locator("#screen-replaced.active").waitFor();

    // Le serveur détecte en retard la coupure de l'ancien appareil et écrit « hors ligne » à sa place :
    // le nouveau corrige aussitôt (pas de fausse pause automatique).
    await old.context().close();
    await setPresence(blue, false);
    await waitFor(async () => (await read(`presence/${blue}`))?.online === true, "présence corrigée par le nouvel appareil");
    for (const p of [regie, fresh]) await p.context().close();
  });

  test("nouvelle équipe en cours de partie, ou demande ignorée", async () => {
    const { regie, old } = await startedGame();
    const late = await tablet("Les Tard-Venus");
    await late.locator("#screen-waiting.active").waitFor();
    await regie.locator("#c-requests button", { hasText: "Nouvelle équipe" }).click();
    await late.locator("#screen-question.active").waitFor();
    assert.equal(await late.locator("#screen-question .team-label").textContent(), "Les Tard-Venus");
    await regie.locator("#c-answered", { hasText: "0 / 3 équipes ont répondu" }).waitFor();

    const intruder = await tablet("Inconnus");
    await intruder.locator("#screen-waiting.active").waitFor();
    await regie.locator("#c-requests button", { hasText: "Ignorer" }).click();
    await intruder.locator("#error-text", { hasText: "n'a pas fait entrer cet appareil" }).waitFor();
    assert.equal(Object.keys(await read("teams")).length, 3);
    for (const p of [regie, old, late, intruder]) await p.context().close();
  });

  test("quiz lancé pendant qu'une équipe tape son nom : elle peut encore demander à entrer", async () => {
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await addTeam("rose", "Les Roses");
    const slow = await openRegie();
    await slow.locator("#screen-join.active").waitFor();
    await regie.locator("#c-next", { hasText: "Lancer le quiz" }).click();
    await waitFor(async () => (await read("state"))?.phase === "question", "quiz lancé");
    await slow.fill("#team-name", "Les Lents");
    await slow.click("#join");
    await slow.locator("#join", { hasText: "Demander à entrer" }).waitFor();
    assert.equal(await slow.inputValue("#team-name"), "Les Lents");
    await slow.click("#join");
    await regie.locator("#c-requests", { hasText: "« Les Lents » demande à entrer" }).waitFor();
    for (const p of [regie, slow]) await p.context().close();
  });

  test("8 équipes : la régie ne peut que remplacer un appareil", async () => {
    const { regie, old } = await startedGame();
    for (let i = 3; i <= 8; i++) await addTeam(`t${i}`, `Équipe ${i}`);
    const extra = await tablet("Les Neuvièmes");
    await extra.locator("#screen-waiting.active").waitFor();
    await regie.locator("#c-requests button", { hasText: "Nouvelle équipe" }).click();
    await regie.locator("#r-toast", { hasText: "8 équipes maximum" }).waitFor();
    assert.equal(Object.keys(await read("teams")).length, 8);
    assert.ok(await read("joinRequests"), "la demande reste en attente");
    for (const p of [regie, old, extra]) await p.context().close();
  });
});

async function waitFor(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Délai dépassé : ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

describe("bibliothèque de quiz et prestations", () => {
  const admin = openAdmin;
  const library = async (path) => {
    let value;
    await env.withSecurityRulesDisabled(async (ctx) => { value = (await get(ref(ctx.database(), `library/${path}`))).val(); });
    return value;
  };
  const seedLibrary = (path, value) => env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `library/${path}`), value));
  const ANIMAUX = {
    title: "Animaux", source: "gemini", updatedAt: 1, ageMin: 6, ageMax: 8,
    questions: [
      { text: "Roi de la jungle ?", choices: ["Lion", "Tigre", "Zèbre", "Singe"], correct: 0, status: "validee" },
      { text: "Combien de pattes a une araignée ?", choices: ["6", "8"], correct: 1, status: "validee" },
      { text: "Question pas encore relue", choices: ["Oui", "Non"], correct: 0, status: "brouillon" },
    ],
  };
  const FINALE = {
    title: "Finale", source: "tableur", updatedAt: 1,
    questions: [{ text: "Le Soleil est une étoile", choices: ["Vrai", "Faux"], correct: 0, duration: 15, status: "validee" }],
  };

  test("Sarah colle un quiz Gemini, corrige l'anomalie signalée, valide et enregistre", async () => {
    const page = await admin();
    await page.click("#nav button[data-screen=quizzes]");
    await page.click("#quiz-import-open");
    await page.fill("#gem-theme", "La jungle");
    await page.fill("#gem-age", "8");
    assert.match(await page.inputValue("#gem-prompt"), /thème « La jungle », pour des enfants de 8 ans/);
    await page.fill("#import-text", [
      "Titre : La jungle", "",
      "1. Quel animal est le roi de la jungle ?", "A) Le tigre", "B) Le lion", "C) L'éléphant", "D) Le singe", "Réponse : B", "",
      "2. Combien de pattes a une araignée ?", "A) 6", "B) 8", "C) 10", "D) 4", "", // bonne réponse oubliée
      "3. Le paresseux dort beaucoup.", "A) Vrai", "B) Faux", "Réponse : A",
    ].join("\n"));
    await page.click("#import-analyse");
    await page.locator("#screen-review:not([hidden])").waitFor();
    assert.equal(await page.inputValue("#rv-title"), "La jungle");
    await page.locator("#rv-summary", { hasText: "3 questions · 0 validée · 1 à corriger" }).waitFor();
    await page.locator('[data-q="1"] .problems', { hasText: "Bonne réponse absente" }).waitFor();
    await page.click("#rv-validate-all");
    await page.locator("#rv-summary", { hasText: "2 validées · 1 à corriger" }).waitFor();
    assert.equal(await page.locator('[data-q="1"] .q-valid').isDisabled(), true);
    // Sarah coche la bonne réponse (B) puis valide la question.
    await page.locator('[data-q="1"] input[type=radio]').nth(1).check();
    await page.locator('[data-q="1"] .q-valid').check();
    await page.locator("#rv-summary", { hasText: "3 validées" }).waitFor();
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "3 questions validées sur 3" }).waitFor();
    const saved = Object.values(await library("quizzes"));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].title, "La jungle");
    assert.equal(saved[0].source, "gemini");
    assert.deepEqual(saved[0].questions.map((q) => [q.correct, q.status]), [[1, "validee"], [1, "validee"], [0, "validee"]]);
    await page.click("#nav button[data-screen=quizzes]");
    await page.locator("#quiz-list .item", { hasText: "3 questions · 3 validées" }).waitFor();
    await page.context().close();
  });

  test("Sarah prépare une prestation, l'animatrice la charge sur la TV depuis la régie", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX, finale: FINALE });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "7");
    await page.fill("#show-date", "2026-12-02");
    await page.click("#round-add");
    await page.locator("#show-rounds select.grow").nth(0).selectOption("animaux");
    await page.click("#round-add");
    await page.locator("#show-rounds select").nth(2).selectOption("finale");
    await page.locator("#show-rounds select.grow").nth(1).selectOption("finale");
    await page.locator("#show-summary", { hasText: "3 questions jouables" }).waitFor();
    await page.selectOption("#show-status", "publiee");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    const saved = Object.values(await library("shows"))[0];
    assert.equal(saved.childName, "Léa");
    assert.deepEqual(saved.rounds, [{ type: "quiz", quizId: "animaux" }, { type: "finale", quizId: "finale" }]);
    await page.context().close();

    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    // Dans le salon d'attente, la régie ouvre directement la liste des prestations prêtes.
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "L'anniversaire de Léa" }).click();
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    await regie.locator("#c-step", { hasText: "L'anniversaire de Léa" }).waitFor();
    const show = await read("show");
    assert.equal(show.childName, "Léa");
    assert.equal(show.profile, "PETITS");
    const q = show.quiz.questions;
    // Brouillon écarté, chrono du profil Petits (25 s + 10 s de lecture), durée imposée gardée, finale doublée.
    assert.deepEqual(q.map((x) => [x.id, x.duration, x.double, x.round]), [
      ["r1q1", 35, false, "Animaux"], ["r1q2", 35, false, "Animaux"], ["r2q1", 15, true, "Super Finale"],
    ]);
    await regie.click("#tab-plan");
    await regie.locator("#panel-plan .plan-round", { hasText: "Super Finale" }).waitFor();
    await regie.context().close();
  });

  test("Sarah compose un paquet de mimes, l'ajoute à une prestation ; la régie le charge ou l'ajoute en direct", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    const page = await admin();
    await page.click(".tile[data-screen=mimes]");
    await page.click("#mime-new");
    await page.fill("#mime-title", "Animaux à mimer");
    await page.selectOption("#mime-duration", "45");
    await page.locator("#mime-catalog .mime-card", { hasText: "Chat" }).click();
    await page.locator("#mime-catalog .mime-card", { hasText: "Éléphant" }).click();
    await page.locator("#mime-catalog .mime-card", { hasText: "Lapin" }).click();
    await page.locator("#mime-catalog .mime-card", { hasText: "Lapin" }).click();
    await page.fill("#mime-word", "Le chat de Léa");
    await page.fill("#mime-emoji", "😺");
    await page.locator("#mime-custom button").click();
    await page.locator("#mime-count", { hasText: "3" }).waitFor();
    await page.click("#mime-save");
    await page.locator("#mime-status", { hasText: "Enregistré : 3 cartes" }).waitFor();
    const [deckId, deck] = Object.entries(await library("mimes"))[0];
    assert.equal(deck.duration, 45);
    assert.deepEqual(deck.cards, [{ word: "Chat", image: "🐱" }, { word: "Éléphant", image: "🐘" }, { word: "Le chat de Léa", image: "😺" }]);

    await page.click("#nav button[data-screen=home]");
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    await page.click("#round-add");
    await page.locator("#show-rounds select.grow").nth(0).selectOption("animaux");
    await page.click("#round-add");
    await page.locator("#show-rounds .round").nth(1).locator("select").first().selectOption("mimes");
    await page.locator("#show-rounds .round").nth(1).locator("select.grow").selectOption(deckId);
    await page.locator("#show-summary", { hasText: "2 questions · 1 manche de mimes jouables" }).waitFor();
    await page.selectOption("#show-status", "publiee");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    assert.deepEqual(Object.values(await library("shows"))[0].rounds, [{ type: "quiz", quizId: "animaux" }, { type: "mimes", deckId }]);
    await page.context().close();

    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "L'anniversaire de Léa" }).click();
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const mime = (await read("show")).quiz.questions[2];
    assert.equal(mime.kind, "mime");
    assert.equal(mime.duration, 45);
    assert.equal(mime.round, "Animaux à mimer");
    assert.deepEqual(mime.cards.map((c) => c.word).sort(), ["Chat", "Le chat de Léa", "Éléphant"]);
    await regie.click("#tab-plan");
    await regie.locator("#panel-plan .plan-item", { hasText: "Mimes : Animaux à mimer" }).waitFor();
    // En direct : « Ajouter un jeu » propose le paquet dans les mini-jeux.
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game^='mimes/']", { hasText: "Animaux à mimer" }).click();
    await regie.locator("#lib-meta", { hasText: "Mimes · 3 cartes · tour de 45 s" }).waitFor();
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "est ajouté à la fin du programme" }).waitFor();
    const plan = (await read("conducteur")).questions;
    assert.equal(plan.length, 4);
    assert.equal(plan[3].kind, "mime");
    assert.equal(plan[3].round, "Animaux à mimer · 2");
    await regie.context().close();
  });

  test("TV trop ancienne pour les mimes : la régie le dit au lieu d'envoyer un programme refusé", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    await seedLibrary("mimes", { zoo: { title: "Zoo", duration: 60, cards: [{ word: "Chat", image: "🐱" }], updatedAt: 1 } });
    await seedLibrary("shows", {
      lea: { childName: "Léa", age: 9, status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }, { type: "mimes", deckId: "zoo" }], updatedAt: 1 },
    });
    // Box d'avant les mimes : son conducteur ne les annonce pas.
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/conducteur/mimes`), null));
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Léa" }).click();
    await regie.locator("#r-toast", { hasText: "La TV doit être mise à jour pour jouer aux mimes" }).waitFor();
    assert.equal(await read("show"), null, "Rien n'est envoyé à la TV");
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game^='mimes/']", { hasText: "Zoo" }).click();
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "La TV doit être mise à jour pour jouer aux mimes" }).waitFor();
    assert.equal(await read("show"), null);
    await regie.context().close();
  });

  test("Le Juste Chiffre : préparé dans l'admin, refusé proprement par une TV trop ancienne", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    const page = await admin();
    await page.click("#nav button[data-screen=quizzes]");
    await page.locator('#quiz-list [data-quiz="animaux"]').getByRole("button", { name: "Relire" }).click();
    await page.locator('[data-q="1"] .q-is-number').check();
    await page.locator('[data-q="1"] .q-number').fill("8");
    await page.locator('[data-q="1"] .q-valid:enabled').check();
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "Enregistré" }).waitFor();
    const q = (await library("quizzes")).animaux.questions[1];
    assert.equal(q.kind, "number");
    assert.equal(q.correct, 8);
    assert.equal(q.choices, undefined);
    assert.equal(q.status, "validee");
    await page.context().close();

    await seedLibrary("shows", { lea: { childName: "Léa", age: 9, status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 } });
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/conducteur/numbers`), null));
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Léa" }).click();
    await regie.locator("#r-toast", { hasText: "pour jouer au Juste Chiffre" }).waitFor();
    assert.equal(await read("show"), null, "Rien n'est envoyé à la TV");
    await regie.context().close();
  });

  test("Vrai ou Faux express : manche choisie dans l'admin, affirmations seules, ajout en direct, TV trop ancienne prévenue", async () => {
    const SCIENCES = {
      title: "Sciences", source: "tableur", updatedAt: 1,
      questions: [
        { text: "Le Soleil est une étoile", choices: ["Vrai", "Faux"], correct: 0, status: "validee" },
        { text: "Les poissons respirent hors de l'eau", choices: ["Vrai", "Faux"], correct: 1, status: "validee" },
        { text: "Planète la plus proche du Soleil ?", choices: ["Mercure", "Mars"], correct: 0, status: "validee" },
      ],
    };
    await seedLibrary("quizzes", { sciences: SCIENCES });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    await page.click("#round-add");
    await page.locator("#show-rounds .round").nth(0).locator("select").first().selectOption("express");
    await page.locator("#show-rounds .round").nth(0).locator("select.grow option", { hasText: "Sciences (2 Vrai / Faux)" }).waitFor({ state: "attached" });
    await page.locator("#show-rounds .round").nth(0).locator("select.grow").selectOption("sciences");
    await page.selectOption("#show-status", "publiee");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    assert.deepEqual(Object.values(await library("shows"))[0].rounds, [{ type: "express", quizId: "sciences" }]);
    await page.context().close();

    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "L'anniversaire de Léa" }).click();
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const questions = (await read("show")).quiz.questions;
    assert.deepEqual(questions.map((q) => [q.kind, q.duration, q.round]), [["express", 9, "Vrai ou Faux express"], ["express", 9, "Vrai ou Faux express"]]);
    // En direct : proposé dans les mini-jeux pour chaque quiz qui a des Vrai / Faux.
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game='express/sciences']", { hasText: "Vrai ou Faux express : Sciences" }).locator("span", { hasText: "2 affirmations" }).waitFor();
    // TV d'avant le Vrai ou Faux express : la régie le dit, rien n'est envoyé.
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/conducteur/express`), null));
    const before = (await read("conducteur")).questions.length;
    await regie.locator("#lib-list [data-game='express/sciences']").click();
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "pour jouer au Vrai ou Faux express" }).waitFor();
    assert.equal((await read("conducteur")).questions.length, before);
    await regie.context().close();
  });

  test("Zoom mystère : proposé pour un quiz avec photos, ses photos copiées dans la partie, TV trop ancienne prévenue", async () => {
    const PHOTO = "0123456789abcdef";
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await seedLibrary("quizzes", {
      zoo: { title: "Zoo", source: "tableur", updatedAt: 1, questions: [{ text: "Quel animal ?", choices: ["Chat", "Lion"], correct: 1, imageId: PHOTO, status: "validee" }] },
    });
    await seedLibrary("images", { [PHOTO]: PNG });
    await seedLibrary("shows", { lea: { childName: "Léa", age: 9, status: "publiee", rounds: [{ type: "zoom", quizId: "zoo" }], updatedAt: 1 } });
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Léa" }).click();
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const [q] = (await read("show")).quiz.questions;
    assert.deepEqual([q.kind, q.imageId, q.round], ["zoom", PHOTO, "Zoom mystère"]);
    await waitFor(async () => (await read(`images/${PHOTO}`)) === PNG, "photo copiée dans la partie");
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game='zoom/zoo']", { hasText: "Zoom mystère : Zoo" }).locator("span", { hasText: "1 photo" }).waitFor();
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/conducteur/zoom`), null));
    await regie.locator("#lib-list [data-game='zoom/zoo']").click();
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "pour jouer au Zoom mystère" }).waitFor();
    await regie.context().close();
  });

  test("tableau de bord : anniversaires à venir et leur état, dupliquer sans toucher l'original, archiver", async () => {
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    const LEA = { childName: "Léa", age: 7, date: day(10), status: "publiee", themes: "Licornes", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 };
    await seedLibrary("shows", {
      lea: LEA,
      tom: { childName: "Tom", date: day(3), status: "brouillon", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 },
      vieux: { childName: "Ancien", age: 8, date: "2020-01-01", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 },
    });
    const page = await admin();
    await page.locator("#stat-upcoming", { hasText: "2" }).waitFor();
    assert.equal(await page.textContent("#stat-ready"), "1", "L'anniversaire passé ne compte pas");
    assert.equal(await page.textContent("#stat-todo"), "1");
    // Du plus proche au plus lointain, l'ancien anniversaire n'y est pas.
    assert.deepEqual(await page.locator("#home-upcoming .show-card").evaluateAll((els) => els.map((e) => e.dataset.show)), ["tom", "lea"]);
    const tom = page.locator('#home-upcoming [data-show="tom"]');
    await tom.locator(".todo", { hasText: "Indiquer l'âge" }).waitFor();
    assert.match(await tom.textContent(), /dans 3 jours/);
    await page.locator('#home-upcoming [data-show="lea"] .pill', { hasText: "Prête" }).waitFor();
    // Sur téléphone, rien ne dépasse de l'écran.
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Défilement horizontal sur téléphone");

    // Dupliquer : un nouveau brouillon avec les mêmes manches, l'original ne bouge pas.
    await page.locator('#home-upcoming [data-show="lea"]').getByRole("button", { name: "Dupliquer" }).click();
    await page.locator("#show-edit-title", { hasText: "Copie de « L'anniversaire de Léa »" }).waitFor();
    assert.equal(await page.inputValue("#show-child"), "");
    assert.equal(await page.inputValue("#show-themes"), "Licornes");
    await page.fill("#show-child", "Zoé");
    await page.fill("#show-age", "9");
    await page.fill("#show-date", day(20));
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée." }).waitFor();
    const shows = await library("shows");
    const zoe = Object.values(shows).find((s) => s.childName === "Zoé");
    assert.equal(zoe.status, "brouillon");
    assert.deepEqual(zoe.rounds, LEA.rounds);
    assert.deepEqual(shows.lea, LEA, "Prestation d'origine inchangée");
    await page.locator("#show-ready", { hasText: "Passer le statut à « Prête »" }).waitFor();

    // Archiver : Tom quitte les anniversaires à venir et rejoint les archives.
    await page.click("#nav button[data-screen=home]");
    await page.locator('#home-upcoming [data-show="tom"]').getByRole("button", { name: "Archiver" }).click();
    await page.locator('#home-upcoming [data-show="tom"]').waitFor({ state: "detached" });
    assert.equal((await library("shows/tom/status")), "archivee");
    await page.click("#nav button[data-screen=shows]");
    await page.locator("#show-archives summary", { hasText: "Prestations archivées (1)" }).waitFor();
    assert.equal(await page.locator('#show-list [data-show="tom"]').count(), 0);
    await page.locator("#show-past summary", { hasText: "Anniversaires passés (1)" }).waitFor();
    assert.equal(await page.locator('#show-list [data-show="vieux"]').count(), 0);
    await page.context().close();
  });

  test("reprendre une manche d'une ancienne prestation et dupliquer un quiz, sans toucher aux originaux", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX, finale: FINALE });
    const LEA = { childName: "Léa", age: 7, date: "2026-03-01", status: "archivee", rounds: [{ type: "quiz", quizId: "animaux" }, { type: "finale", quizId: "finale" }], updatedAt: 1 };
    await seedLibrary("shows", { lea: LEA });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await page.locator('#round-reuse option[value="lea/1"]', { hasText: "Super Finale : Finale" }).waitFor({ state: "attached" });
    await page.selectOption("#round-reuse", "lea/1");
    assert.equal(await page.locator("#show-rounds select.grow").inputValue(), "finale");
    assert.equal(await page.locator("#show-rounds select").first().inputValue(), "finale");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée." }).waitFor();
    const shows = await library("shows");
    assert.deepEqual(Object.values(shows).find((s) => s.childName === "Zoé").rounds, [{ type: "finale", quizId: "finale" }]);
    assert.deepEqual(shows.lea, LEA, "Ancienne prestation inchangée");

    // Dupliquer un quiz : la copie se modifie et s'enregistre à part.
    await page.click("#nav button[data-screen=quizzes]");
    await page.locator('#quiz-list [data-quiz="animaux"]').getByRole("button", { name: "Dupliquer" }).click();
    await page.locator("#screen-review:not([hidden])").waitFor();
    assert.equal(await page.inputValue("#rv-title"), "Animaux (copie)");
    await page.locator('[data-q="0"] .q-text').fill("Qui est le roi de la savane ?");
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "Enregistré" }).waitFor();
    const quizzes = await library("quizzes");
    assert.equal(Object.keys(quizzes).length, 3);
    assert.equal(quizzes.animaux.questions[0].text, "Roi de la jungle ?", "Quiz d'origine inchangé");
    const copy = Object.values(quizzes).find((q) => q.title === "Animaux (copie)");
    assert.equal(copy.questions[0].text, "Qui est le roi de la savane ?");
    await page.context().close();
  });

  test("ajouter un jeu en pleine partie, réorganiser les manches futures, sans toucher aux scores ni à la bibliothèque", async () => {
    const DINO = { title: "Dinosaures", source: "tableur", updatedAt: 1, questions: [{ text: "Le T-Rex mangeait de la viande", choices: ["Vrai", "Faux"], correct: 0, status: "validee" }] };
    await seedLibrary("quizzes", { animaux: ANIMAUX, finale: FINALE, dino: DINO });
    await seedLibrary("shows", {
      lea: { childName: "Léa", age: 7, date: "2099-12-02", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }, { type: "finale", quizId: "finale" }], updatedAt: 1 },
      hugo: { childName: "Hugo", age: 9, date: "2025-06-01", status: "archivee", rounds: [{ type: "quiz", quizId: "dino" }], updatedAt: 1 },
    });
    box = startBox();
    await addTeam("rose", "Les Roses");
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator(".show-item", { hasText: "L'anniversaire de Léa" }).click();
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    await regie.click("#c-next");
    await regie.locator("#c-phase", { hasText: "Question en cours" }).waitFor();
    await regie.locator('#panel-teams [data-team="rose"] button[data-delta="10"]').click();
    await waitFor(async () => (await read("state/scores/rose")) === 10, "10 points pour les Roses");
    const rounds = async () => (await read("conducteur")).questions.map((q) => q.round);

    // Un quiz de la bibliothèque, après la manche en cours : aperçu puis ajout.
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    await regie.locator('#lib-list [data-game="quiz/dino"]', { hasText: "1 question" }).click();
    await regie.locator("#lib-questions", { hasText: "Le T-Rex mangeait de la viande" }).waitFor();
    await regie.click("#lib-after");
    await regie.locator("#r-toast", { hasText: "« Dinosaures » est ajouté après la manche en cours." }).waitFor();
    assert.equal(await regie.locator("#lib").isHidden(), true);
    assert.deepEqual(await rounds(), ["Animaux", "Animaux", "Dinosaures", "Super Finale"]);
    assert.equal(await read("state/total"), 4);
    assert.equal(await read("state/index"), 0, "La question en cours ne bouge pas");

    // Une manche d'une ancienne prestation, à la fin : elle garde un titre distinct.
    await regie.click("#plan-add");
    await regie.locator('#lib-list [data-game="show/hugo/0"]', { hasText: "L'anniversaire de Hugo" }).click();
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "« Dinosaures · 2 » est ajouté à la fin du programme." }).waitFor();
    assert.deepEqual(await rounds(), ["Animaux", "Animaux", "Dinosaures", "Super Finale", "Dinosaures · 2"]);

    // La manche en cours n'a ni flèches ni « Retirer » ; une manche future se déplace et se retire.
    assert.equal(await regie.locator('.plan-head[data-round="Animaux"] button').count(), 0);
    await regie.click('.plan-head[data-round="Super Finale"] button.up');
    await regie.locator("#r-toast", { hasText: "« Super Finale » avancée d'un cran." }).waitFor();
    assert.deepEqual(await rounds(), ["Animaux", "Animaux", "Super Finale", "Dinosaures", "Dinosaures · 2"]);
    regie.once("dialog", (d) => d.accept());
    await regie.click('.plan-head[data-round="Dinosaures · 2"] button.remove');
    await regie.locator("#r-toast", { hasText: "« Dinosaures · 2 » est retirée du programme." }).waitFor();
    assert.deepEqual(await rounds(), ["Animaux", "Animaux", "Super Finale", "Dinosaures"]);

    // Un autre téléphone a changé le programme juste avant : la TV refuse, la régie le dit, rien ne bouge.
    box.refuseNextProgram("stale");
    await regie.click('.plan-head[data-round="Dinosaures"] button.up');
    await regie.locator("#r-toast", { hasText: "Le programme venait de changer" }).waitFor();
    assert.deepEqual(await rounds(), ["Animaux", "Animaux", "Super Finale", "Dinosaures"]);

    assert.equal(await read("state/scores/rose"), 10, "Scores gardés");
    const lib = await library("quizzes");
    assert.deepEqual(lib.dino, DINO, "Quiz de la bibliothèque inchangé");
    assert.deepEqual(lib.animaux, ANIMAUX);
    await regie.context().close();
  });

  test("illustration : émoji et photo ajoutés dans l'admin, copiés dans la partie par la régie", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    await seedLibrary("shows", { ines: { childName: "Inès", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 } });
    const page = await admin();
    await page.click("#nav button[data-screen=quizzes]");
    await page.locator('#quiz-list [data-quiz="animaux"]').getByRole("button", { name: "Relire" }).click();
    await page.locator('[data-q="1"]').waitFor();
    await page.locator('[data-q="0"] .q-emoji').fill("🦁");
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.locator('[data-q="1"] .q-photo').setInputFiles({ name: "araignee.png", mimeType: "image/png", buffer: PNG });
    await page.locator('[data-q="1"] .q-image-info', { hasText: "Photo prête" }).waitFor();
    await page.locator('[data-q="1"] .q-image:not([hidden])').waitFor();
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "Enregistré" }).waitFor();
    const saved = (await library("quizzes")).animaux.questions;
    assert.equal(saved[0].image, "🦁");
    assert.equal(saved[0].imageId, undefined);
    assert.match(saved[1].imageId, /^[0-9a-f]{16}$/);
    const id = saved[1].imageId;
    assert.match(await library(`images/${id}`), /^data:image\/jpeg;base64,/);
    // Rouvert : la photo est toujours là, et on peut la retirer.
    await page.reload();
    await page.locator("#screen-home:not([hidden])").waitFor();
    await page.click("#nav button[data-screen=quizzes]");
    await page.locator('#quiz-list [data-quiz="animaux"]').getByRole("button", { name: "Relire" }).click();
    await page.locator('[data-q="1"] .q-image:not([hidden])').waitFor();
    await page.context().close();

    // Régie : la prestation arrive sur la TV avec ses illustrations, la photo est copiée dans la partie.
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator(".show-item", { hasText: "Inès" }).click();
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const q = (await read("show")).quiz.questions;
    assert.equal(q[0].image, "🦁");
    assert.equal(q[1].imageId, id);
    await waitFor(async () => (await read(`images/${id}`))?.startsWith("data:image/jpeg"), "photo copiée dans la partie");
    await regie.context().close();
  });

  test("prestation de test : ajoutée en un clic sans rien remplacer, modifiée dans l'admin, chargée telle quelle sur la TV", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    const INES = { childName: "Inès", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 };
    await seedLibrary("shows", { ines: INES });
    const page = await admin();
    await page.click("#nav button[data-screen=settings]");
    await page.click("#test-create");
    await page.locator("#test-status", { hasText: "Ajoutée" }).waitFor();
    await page.click("#test-create");
    await page.locator("#test-status", { hasText: "existe déjà" }).waitFor();
    const shows = await library("shows");
    assert.deepEqual(Object.keys(shows).sort(), ["ines", "test-lea-9-ans"]);
    assert.deepEqual(shows.ines, INES, "Prestation existante intacte");
    assert.deepEqual((await library("quizzes")).animaux, ANIMAUX, "Quiz existant intact");

    // Dans l'administration : la prestation, puis ses 10 questions, dont Sarah corrige la première.
    await page.click("#nav button[data-screen=shows]");
    await page.locator('#screen-shows [data-show="test-lea-9-ans"]', { hasText: "ANNIVERSAIRE TEST – Léa, 9 ans" }).waitFor({ state: "attached" });
    await page.click("#nav button[data-screen=quizzes]");
    await page.locator('#quiz-list [data-quiz="test-lea-9-ans"]', { hasText: "10 questions · 10 validées" }).getByRole("button", { name: "Relire" }).click();
    await page.locator('[data-q="9"]').waitFor();
    await page.locator('[data-q="0"] .q-text').fill("Quelle est la capitale de la France ? (modifiée dans l'admin)");
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "10 questions validées sur 10" }).waitFor();
    await page.context().close();

    // Sur la régie : la même prestation, chargée sur la TV avec la question modifiée.
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator(".show-item", { hasText: "ANNIVERSAIRE TEST – Léa, 9 ans" }).click();
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const q = (await read("show")).quiz.questions;
    assert.equal(q.length, 10);
    assert.equal(q[0].text, "Quelle est la capitale de la France ? (modifiée dans l'admin)");
    assert.equal(q[9].double, true);
    await regie.context().close();
  });

  test("une prestation en brouillon n'apparaît pas sur la régie ; le code de secours ne donne pas la liste", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    await seedLibrary("shows", {
      a: { childName: "Tom", status: "brouillon", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 },
      b: { childName: "Inès", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 },
    });
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator(".show-item", { hasText: "Inès" }).waitFor();
    assert.equal(await regie.locator(".show-item", { hasText: "Tom" }).count(), 0);
    await regie.context().close();

    const secours = await openRegie();
    await secours.locator("#regie-open:not([hidden])").click();
    await secours.click("#regie-use-pin");
    await secours.fill("#regie-pin", PIN);
    await secours.click("#regie-go");
    await inRegie(secours);
    await secours.locator("#panel-show", { hasText: "entrez dans la régie avec le mot de passe" }).waitFor();
    await secours.context().close();
  });

  test("les équipes voient le prénom de l'enfant fêté en rejoignant la partie", async () => {
    await update(gameRef(), { public: { title: "L'anniversaire de Léa", childName: "Léa" } });
    const page = await openRegie();
    await page.locator("#join-welcome", { hasText: "Joyeux anniversaire Léa !" }).waitFor();
    await page.context().close();
  });
});
