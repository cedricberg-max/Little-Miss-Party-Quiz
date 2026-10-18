// Pupitres simulés dans un vrai navigateur (Chromium) branché sur l'émulateur Firebase.
// La box est simulée par ce script : il écrit l'état de la partie comme le ferait la TV.
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { ref, get, set } from "firebase/database";
import { chromium } from "playwright";
import { loadRules } from "./rules-loader.js";

const ROOT = new URL("..", import.meta.url).pathname;
const PUBLIC = join(ROOT, "web/public");
const FIREBASE_JS = join(ROOT, "tests/node_modules/firebase");
const CODE = "TEST1";
const HOST = "box";

// Configuration de test : projet fictif « demo-lmp », même base que celle des tests de règles.
const testConfig = JSON.stringify({
  apiKey: "demo-key", authDomain: "demo-lmp.firebaseapp.com",
  databaseURL: "https://demo-lmp.firebaseio.com", projectId: "demo-lmp", appId: "demo",
});

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/json" };

let env, server, browser, baseUrl;

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

beforeEach(async () => {
  await env.clearDatabase();
  await set(ref(hostDb(), `games/${CODE}`), { hostUid: HOST, state: { phase: "lobby", round: 1, buzzOpen: true, total: 3, scores: {} } });
});

const hostDb = () => env.authenticatedContext(HOST).database();
const hostState = (state) => set(ref(hostDb(), `games/${CODE}/state`), state);
const read = async (path) => (await get(ref(hostDb(), `games/${CODE}/${path}`))).val();

async function waitFor(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Délai dépassé : ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Un pupitre = un navigateur séparé (son propre identifiant d'équipe). */
async function openPupitre() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Le SDK Firebase est servi depuis les fichiers locaux au lieu du CDN de Google.
  await context.route("https://www.gstatic.com/firebasejs/11.1.0/*", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    route.fulfill({ path: join(FIREBASE_JS, name), contentType: "text/javascript" });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("Erreur page :", e.message));
  await page.goto(`${baseUrl}/?g=${CODE}&emu=1`);
  return page;
}

async function joinTeam(page, name) {
  try {
    await page.locator("#screen-join.active").waitFor({ timeout: 8000 });
  } catch (e) {
    console.error("ÉCRAN :", await page.evaluate(() => document.querySelector(".screen.active")?.id + " " + document.getElementById("error-text").textContent));
    throw e;
  }
  await page.fill("#team-name", name);
  await page.click("#join");
  await page.locator("#screen-play.active").waitFor();
}

const question = (extra = {}) => ({
  phase: "question", index: 0, total: 3, qid: "q1", kind: "classic", double: false,
  text: "Couleur du ciel ?", choices: ["Vert", "Bleu", "Rouge", "Jaune"], durationMs: 20000,
  paused: false, deadline: Date.now() + 20000, scores: {}, round: 1, buzzOpen: false, ...extra,
});

describe("pupitre", () => {
  test("trois équipes rejoignent, répondent une seule fois et voient leur résultat", async () => {
    const pages = [await openPupitre(), await openPupitre(), await openPupitre()];
    await joinTeam(pages[0], "Les Roses");
    await joinTeam(pages[1], "Les Bleus");
    await joinTeam(pages[2], "Les Verts");
    const teams = await read("teams");
    assert.equal(Object.keys(teams).length, 3);
    const uidOf = Object.fromEntries(Object.entries(teams).map(([uid, t]) => [t.name, uid]));

    await hostState(question());
    await pages[0].locator("#screen-question.active").waitFor();
    await pages[0].locator(".choice").nth(1).click();
    await pages[1].locator(".choice").nth(0).click();
    await waitFor(async () => Object.keys((await read("answers/q1")) ?? {}).length === 2, "2 réponses enregistrées");
    assert.equal((await read(`answers/q1/${uidOf["Les Roses"]}`)).choice, 1);

    // Une fois répondu, les boutons sont verrouillés : un second toucher n'envoie rien.
    assert.equal(await pages[0].locator(".choice").nth(2).isDisabled(), true);
    await pages[0].locator("#q-status", { hasText: "Réponse B envoyée" }).waitFor();

    await hostState(question({
      phase: "reveal", correct: 1,
      awards: { [uidOf["Les Roses"]]: { correct: true, points: 118, bonus: 18 }, [uidOf["Les Bleus"]]: { correct: false, points: 0, bonus: 0 } },
      scores: { [uidOf["Les Roses"]]: 118 },
    }));
    await pages[0].locator("#r-title", { hasText: "Bravo ! +118 points" }).waitFor();
    await pages[0].locator("#r-total", { hasText: "1re place" }).waitFor();
    await pages[1].locator("#r-title", { hasText: "Raté" }).waitFor();
    await pages[2].locator("#r-title", { hasText: "Pas de réponse" }).waitFor();
    for (const p of pages) await p.context().close();
  });

  test("après un rechargement, le pupitre retrouve son équipe et sa réponse", async () => {
    const page = await openPupitre();
    await joinTeam(page, "Les Roses");
    await hostState(question());
    await page.locator(".choice").nth(2).click();
    await page.locator("#q-status", { hasText: "Réponse C envoyée" }).waitFor();

    await page.reload();
    await page.locator("#screen-question.active").waitFor();
    await page.locator("#q-status", { hasText: "Réponse C envoyée" }).waitFor();
    assert.equal(await page.locator(".choice.picked").count(), 1);
    assert.equal(Object.keys(await read("teams")).length, 1, "Pas de doublon d'équipe après rechargement");
    await page.context().close();
  });

  test("pendant la pause, impossible de répondre", async () => {
    const page = await openPupitre();
    await joinTeam(page, "Les Roses");
    await hostState(question({ paused: true, deadline: null, remainingMs: 12000 }));
    await page.locator("#paused:not([hidden])").waitFor();
    assert.equal(await page.locator(".choice").first().isDisabled(), true);
    await hostState(question());
    await page.locator("#paused[hidden]").waitFor({ state: "attached" });
    assert.equal(await page.locator(".choice").first().isDisabled(), false);
    await page.context().close();
  });

  test("la présence passe hors ligne quand le pupitre se ferme", async () => {
    const page = await openPupitre();
    await joinTeam(page, "Les Roses");
    const uid = Object.keys(await read("teams"))[0];
    await waitFor(async () => (await read(`presence/${uid}`))?.online === true, "pupitre en ligne");
    await page.context().close();
    await waitFor(async () => (await read(`presence/${uid}`))?.online === false, "pupitre hors ligne", 15000);
  });

  test("au-delà de 8 équipes, la partie est complète", async () => {
    const teams = Object.fromEntries([...Array(8)].map((_, i) => [`t${i}`, { name: `Équipe ${i}`, color: "#FF3CAC" }]));
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/teams`), teams));
    const page = await openPupitre();
    await page.locator("#error-text", { hasText: "complète" }).waitFor();
    await page.context().close();
  });

  test("une partie inexistante affiche un message clair", async () => {
    const context = await browser.newContext();
    await context.route("https://www.gstatic.com/firebasejs/11.1.0/*", (route) =>
      route.fulfill({ path: join(FIREBASE_JS, new URL(route.request().url()).pathname.split("/").pop()), contentType: "text/javascript" }));
    const page = await context.newPage();
    await page.goto(`${baseUrl}/?g=ZZZZZ&emu=1`);
    await page.locator("#error-text", { hasText: "n'existe pas" }).waitFor();
    await context.close();
  });
});

