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
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

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
  const db = hostDb();
  let latest = {};
  let state = { phase: "lobby", seq: 0, total: QUESTIONS.length, scores: {}, round: 1, buzzOpen: true };
  const handled = new Set();
  const stops = [];
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
      const advance = ["next", "close", "end", "pause", "resume"].includes(cmd.type);
      let status = { status: "applied" };
      if (advance && cmd.expectSeq !== state.seq) status = { status: "stale", reason: "stale" };
      else {
        const seq = state.seq + 1;
        if (cmd.type === "next" && state.phase === "lobby") state = questionState(seq);
        else if (cmd.type === "close") state = { ...state, seq, phase: "closed", deadline: null };
        else if (cmd.type === "pause") state = { ...state, seq, paused: true, deadline: null, remainingMs: 15000 };
        else if (cmd.type === "adjust") state = { ...state, seq, scores: { ...state.scores, [cmd.team]: (state.scores[cmd.team] ?? 0) + cmd.delta } };
        else if (cmd.type === "undo") state = { ...state, seq };
        else if (cmd.type === "end") state = { ...state, seq, phase: "ended" };
        else state = { ...state, seq };
        status.seq = seq;
      }
      await update(ref(db, `games/${CODE}`), { state, [`commandStatus/${id}`]: { ...status, at: Date.now() } });
    }
  }
  // Prestation chargée par la régie : la vraie box vérifie le quiz, republie le conducteur et répond.
  let judgedShow = null;
  if (!silent) stops.push(onValue(ref(db, `games/${CODE}/show`), async (s) => {
    const show = s.val();
    if (!show || show.id === judgedShow) return;
    judgedShow = show.id;
    await update(ref(db, `games/${CODE}`), {
      showStatus: { id: show.id, status: "applied", at: Date.now() },
      conducteur: { title: show.title, questions: show.quiz.questions },
      public: { title: show.title, childName: show.childName },
    });
  }));
  if (!silent) stops.push(onValue(ref(db, `games/${CODE}/commands`), (s) => {
    latest = s.val() ?? {};
    if (!held) process();
  }));
  return {
    stop: () => stops.forEach((f) => f()),
    release: () => { held = false; return process(); },
    get state() { return state; },
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
    conducteur: { title: "Démo", questions: QUESTIONS },
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
  await page.goto(`${baseUrl}${path}${query}`);
  return page;
}

/** Administration : le mot de passe commun, saisi sur le PC familial. */
async function openAdmin() {
  const page = await openRegie(null, "?emu=1", "/admin.html");
  await page.fill("#admin-password", ADMIN_PASSWORD);
  await page.click("#login");
  await page.locator("#screen-shows:not([hidden])").waitFor();
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

describe("régie", () => {
  test("mot de passe commun : un mauvais est refusé, le bon ouvre la régie", async () => {
    box = startBox();
    const page = await openRegie();
    await page.locator("#screen-join.active").waitFor();
    await pair(page, "licorne");
    await page.locator("#regie-status", { hasText: "Mot de passe incorrect" }).waitFor();
    assert.equal(await read("regie"), null);
    await page.fill("#regie-password", PASSWORD);
    await page.click("#regie-go");
    await inRegie(page);
    assert.equal(Object.values(await read("regie"))[0].via, "password");
    // Le pupitre ne s'est pas inscrit comme équipe.
    assert.equal(await read("teams"), null);
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
    await oldPassword.locator("#regie-status", { hasText: "Mot de passe incorrect" }).waitFor();
    const newPassword = await openRegie();
    await pair(newPassword, "Nouveau-Mdp-42");
    await inRegie(newPassword);
    // L'animatrice reliée avant le changement pilote toujours.
    await addTeam("rose", "Les Roses");
    await before.locator("#c-next", { hasText: "Lancer le quiz" }).click();
    await before.locator("#c-question", { hasText: "Couleur du ciel ?" }).waitFor();
    for (const p of [before, admin, oldPassword, newPassword]) await p.context().close();
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
    await pc.locator("#screen-shows:not([hidden])").waitFor();
    // Rechargement (ou coupure) : rien à ressaisir.
    await pc.reload();
    await pc.locator("#screen-shows:not([hidden])").waitFor();
    // Un second ordinateur entre avec le même mot de passe.
    const portable = await openRegie(null, "?emu=1", "/admin.html");
    await portable.fill("#admin-password", "Famille-2026");
    await portable.click("#login");
    await portable.locator("#screen-shows:not([hidden])").waitFor();
    // Changement depuis le PC : il reste connecté, le portable devra le ressaisir.
    await pc.click("#nav button[data-screen=settings]");
    await pc.fill("#admin-pw1", "Nouveau-Famille-1");
    await pc.fill("#admin-pw2", "Nouveau-Famille-1");
    await pc.click("#admin-save");
    await pc.locator("#admin-save-status", { hasText: "Mot de passe administrateur changé" }).waitFor({ timeout: 15000 });
    await portable.reload();
    await portable.locator("#login-title", { hasText: "Connexion" }).waitFor();
    await pc.reload();
    await pc.locator("#screen-shows:not([hidden])").waitFor();
    for (const p of [pc, portable]) await p.context().close();
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
    await page.click("#show-new");
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
