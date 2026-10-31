// Pupitres simulés dans un vrai navigateur (Chromium) branché sur l'émulateur Firebase.
// La box est simulée par ce script : il écrit l'état de la partie comme le ferait la TV.
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { ref, get, set, update } from "firebase/database";
import { chromium } from "playwright";
import { loadRules, allowBox } from "./rules-loader.js";

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

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon" };

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
  await allowBox(env, HOST);
  // Régie déjà ouverte (cedric, 24/10 : sinon les tablettes attendent sur l'écran du code régie).
  await set(ref(hostDb(), `games/${CODE}`), { hostUid: HOST, regieActive: true, state: { phase: "lobby", round: 1, buzzOpen: true, total: 3, scores: {} } });
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
async function openPupitre(extra = "", preparer = null) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await preparer?.(context);
  // Le SDK Firebase est servi depuis les fichiers locaux au lieu du CDN de Google.
  await context.route("https://www.gstatic.com/firebasejs/11.1.0/*", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    route.fulfill({ path: join(FIREBASE_JS, name), contentType: "text/javascript" });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("Erreur page :", e.message));
  // LMP_LOOK=gs : les mêmes tests sur le design « The Game Show » (le QR de la TV ajoute &look=gs).
  const look = process.env.LMP_LOOK ? `&look=${process.env.LMP_LOOK}` : "";
  await page.goto(`${baseUrl}/?g=${CODE}&emu=1${extra}${look}`);
  return page;
}

const TEAM_COLORS = ["#FF2D95", "#FF6B1A", "#39FF14", "#FFE600", "#2B86C5", "#9B5DE5", "#F94144", "#2EE8E0"];

/** Tablette en attente : son identifiant (affiché aussi par son numéro sur la régie). */
async function waitingDevice(page) {
  try {
    await page.locator("#screen-waiting.active").waitFor({ timeout: 8000 });
  } catch (e) {
    console.error("ÉCRAN :", await page.evaluate(() => document.querySelector(".screen.active")?.id + " " + document.getElementById("error-text").textContent));
    throw e;
  }
  const device = await page.locator("#screen-waiting").getAttribute("data-device");
  await waitFor(() => read(`joinRequests/${device}`), "demande de la tablette");
  return device;
}

/**
 * Entrée d'une équipe (cedric, 24/10) : la tablette demande seule, l'animatrice l'accepte sur la régie avec un nom et
 * une couleur, et la box l'inscrit. Ici, l'écriture de la box (la régie est testée dans regie.test.js).
 */
async function joinTeam(page, name, color = null) {
  const device = await waitingDevice(page);
  const taken = Object.values((await read("teams")) ?? {}).map((t) => t.color);
  color ??= TEAM_COLORS.find((c) => !taken.includes(c));
  await update(ref(hostDb(), `games/${CODE}`), {
    [`teams/${device}`]: { name, color, joinedAt: Date.now() },
    [`colors/${color.slice(1)}`]: device,
    [`joinRequests/${device}`]: null,
  });
  await page.locator("#screen-play.active").waitFor();
  return device;
}

const question = (extra = {}) => ({
  phase: "question", index: 0, total: 3, qid: "q1", kind: "classic", double: false,
  text: "Couleur du ciel ?", choices: ["Vert", "Bleu", "Rouge", "Jaune"], durationMs: 20000,
  paused: false, deadline: Date.now() + 20000, scores: {}, round: 1, buzzOpen: false, ...extra,
});

describe("pupitre", () => {
  test("« Reconnecter une tablette » : la nouvelle tablette choisit l'équipe, l'ancienne s'arrête, l'équipe garde tout", async () => {
    const old = await openPupitre();
    await joinTeam(old, "Les Bleus");
    const [bleu] = Object.keys(await read("teams"));
    await hostState(question({ scores: { [bleu]: 300 } }));
    await old.locator("#screen-question.active").waitFor();
    // QR « Reconnecter une tablette » de la TV.
    const neuf = await openPupitre("&reprise=1");
    await neuf.locator("#screen-takeover.active").waitFor();
    await neuf.locator(`#takeover-list button[data-team="${bleu}"]`, { hasText: "Les Bleus" }).click();
    await neuf.locator("#waiting-text", { hasText: "reprend « Les Bleus »" }).waitFor();
    const [[device, demande]] = Object.entries(await waitFor(() => read("joinRequests"), "demande de reprise"));
    assert.equal(demande.replace, bleu);
    // La box confie l'équipe (confirmation à la télécommande) : même écriture que pour la régie.
    await update(ref(hostDb(), `games/${CODE}`), { [`teams/${bleu}/device`]: device, [`joinRequests/${device}`]: null });
    await neuf.locator("#screen-question.active").waitFor();
    await old.locator("#screen-replaced.active").waitFor();
    for (const p of [old, neuf]) await p.context().close();
  });

  test("QR « Reconnecter la régie » : la fenêtre du mot de passe de la régie s'ouvre d'elle-même", async () => {
    const page = await openPupitre("&regie=1");
    await page.locator("#regie-login:not([hidden])").waitFor();
    await page.locator("#regie-password:not([hidden])").waitFor();
    await page.context().close();
  });

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

  test("« 🏁 Fin de la fête » (cedric, 25/10) : les tablettes suivent seules la nouvelle partie de la TV, sans rescanner", async () => {
    const equipe = await openPupitre();
    await joinTeam(equipe, "Les Roses");
    const attente = await openPupitre();
    await waitingDevice(attente);
    const SUITE = "SUIT2";
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${SUITE}`), {
      hostUid: HOST, regieActive: true, state: { phase: "lobby", round: 1, buzzOpen: true, total: 3, scores: {} },
    }));
    // La TV quitte la fête : l'ancienne partie est terminée et pointe vers la nouvelle.
    await hostState({ phase: "ended", round: 1, total: 3, scores: {}, leftAt: Date.now(), suite: SUITE });
    const suit = async (p) => {
      await p.waitForURL((u) => u.searchParams.get("g") === SUITE, { timeout: 8000 });
      assert.equal(new URL(p.url()).searchParams.get("emu"), "1");
      await p.locator("#screen-waiting.active").waitFor({ timeout: 8000 });
      const device = await p.locator("#screen-waiting").getAttribute("data-device");
      await waitFor(async () => (await get(ref(hostDb(), `games/${SUITE}/joinRequests/${device}`))).val(), "demande sur la nouvelle partie");
    };
    await suit(equipe);
    await suit(attente);
    // Une tablette ouverte plus tard sur l'ancien QR va aussi sur la nouvelle partie.
    const tard = await openPupitre();
    await suit(tard);
    for (const p of [equipe, attente, tard]) await p.context().close();
  });

  test("entrée (cedric, 24/10) : rien à taper ni à choisir ; avant la régie, seulement le code régie ; ensuite la demande part seule", async () => {
    await set(ref(hostDb(), `games/${CODE}/regieActive`), false);
    const page = await openPupitre();
    await page.locator("#screen-gate.active #gate-regie").waitFor();
    assert.equal(await page.locator("input:visible").count(), 0, "aucun champ");
    assert.equal(await page.locator("#colors").count(), 0, "aucune couleur à choisir");
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await read("joinRequests"), null, "pas de demande avant la régie");
    // Le bouton ouvre l'accès régie (mot de passe ou code de la TV).
    await page.click("#gate-regie");
    await page.locator("#regie-login:not([hidden])").waitFor();
    // La régie s'ouvre sur un autre téléphone : la fenêtre se referme et la tablette demande à entrer.
    await set(ref(hostDb(), `games/${CODE}/regieActive`), true);
    const device = await waitingDevice(page);
    await page.locator("#regie-login").waitFor({ state: "hidden" });
    const demande = await read(`joinRequests/${device}`);
    assert.deepEqual(Object.keys(demande), ["at"], "ni nom ni couleur");
    assert.match(await page.locator("#waiting-num").textContent(), /^Tablette \d{3}$/);
    // Rechargée en attendant : toujours une seule demande, toujours en attente.
    await page.reload();
    await waitingDevice(page);
    assert.equal(Object.keys(await read("joinRequests")).length, 1);
    assert.equal(await read("teams"), null);
    // Le téléphone de l'animatrice décroche un instant : la tablette reste en attente, sans bouton régie.
    await set(ref(hostDb(), `games/${CODE}/regieActive`), false);
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(await page.locator("#screen-waiting.active").count(), 1);
    assert.ok(await read(`joinRequests/${device}`), "demande gardée");
    await set(ref(hostDb(), `games/${CODE}/regieActive`), true);
    // Acceptée : elle joue avec le nom et la couleur donnés par l'animatrice.
    await joinTeam(page, "Les Licornes", "#39FF14");
    assert.equal(await page.locator("#screen-play .team-label").textContent(), "Les Licornes");
    await page.context().close();
  });

  test("QR « Reconnecter la régie » : ce téléphone ne demande jamais à entrer comme une équipe", async () => {
    const page = await openPupitre("&regie=1");
    await page.locator("#regie-login:not([hidden])").waitFor();
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await read("joinRequests"), null);
    await page.context().close();
  });

  test("nouvelle version du site : le pupitre se recharge hors question et retrouve son équipe", async () => {
    const page = await openPupitre();
    let version = "0.1.1";
    await page.route("**/version.json*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ web: version }) }));
    await page.reload();
    await joinTeam(page, "Les Roses");
    await page.locator(".web-version", { hasText: "Version 0.1.1" }).waitFor();
    // Pendant une question, rien ne bouge.
    await hostState(question());
    await page.locator("#screen-question.active").waitFor();
    version = "0.1.2";
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await new Promise((r) => setTimeout(r, 800));
    await page.locator(".web-version", { hasText: "Version 0.1.1" }).waitFor();
    // Question terminée : le pupitre se met à jour tout seul et reste dans son équipe.
    const reloaded = page.waitForEvent("load");
    await hostState(question({ phase: "reveal", correct: 1, awards: {}, scores: {} }));
    await reloaded;
    await page.locator(".web-version", { hasText: "Version 0.1.2" }).waitFor();
    await page.locator("#screen-result.active").waitFor();
    await page.context().close();
  });

  test("réponses en images : grandes photos sur la tablette, une case reste en texte, la réponse part comme un QCM", async () => {
    const LION = "0123456789abcdef", CHIEN = "fedcba9876543210", VACHE = "00112233445566ff";
    // Petit carré PNG valable : la photo s'affiche vraiment dans le bouton.
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/choiceImages`), { [LION]: PNG, [CHIEN]: PNG, [VACHE]: PNG }));
    const page = await openPupitre();
    await joinTeam(page, "Les Petits");
    const uid = Object.keys(await read("teams"))[0];
    await hostState(question({ text: "Qui court le plus vite ?", choices: ["Lion", "Baleine", "Chien", "Vache"], choiceImages: [LION, "", CHIEN, VACHE] }));
    await page.locator("#screen-question.active").waitFor();
    await page.locator("#choices.pictures").waitFor();
    await waitFor(async () => (await page.locator(".choice.with-photo img.photo:not([hidden])").count()) === 3, "3 photos affichées");
    assert.equal(await page.locator(".choice").nth(1).locator("img").count(), 0, "Baleine reste en texte");
    await page.locator(".choice").nth(1).locator(".text", { hasText: "Baleine" }).waitFor();
    // Une réponse en photo ne dit pas son nom : seule l'image permet de reconnaître la réponse (test du 27/10).
    assert.equal(await page.locator(".choice").nth(2).locator(".text").isVisible(), false, "« Chien » n'est pas écrit sous sa photo");
    assert.equal(await page.locator(".choice").nth(2).locator(".letter").isVisible(), true, "la lettre C reste");
    await page.locator(".choice").nth(2).click();
    await waitFor(async () => (await read(`answers/q1/${uid}`))?.choice === 2, "réponse C enregistrée");
    await page.locator("#q-status", { hasText: "Réponse C envoyée" }).waitFor();
    // Question suivante en texte : la tablette revient aux boutons habituels.
    await hostState(question({ qid: "q2", index: 1, text: "Couleur du ciel ?" }));
    await page.locator(".choice .text", { hasText: "Bleu" }).waitFor();
    assert.equal(await page.locator("#choices.pictures").count(), 0);
    await page.context().close();
  });

  test("Portes mystères : choix secret d'une porte, résultat caché jusqu'à l'ouverture de sa porte sur la TV", async () => {
    const page = await openPupitre();
    await joinTeam(page, "Les Roses");
    const uid = Object.keys(await read("teams"))[0];
    const portes = { qid: "pm", kind: "portes", text: "Portes mystères", choices: ["Porte 1", "Porte 2", "Porte 3"], correct: null };
    await hostState(question({ ...portes, portes: { count: 3 } }));
    await page.locator("#q-number", { hasText: "Portes mystères !" }).waitFor();
    assert.equal(await page.locator("#portes-host .pm-mini").count(), 3);
    assert.equal(await page.locator("#choices").isVisible(), false);
    await page.locator("#portes-host .pm-mini").nth(1).click();
    await page.click("#portes-host .pm-choisir");
    await waitFor(async () => (await read(`answers/pm/${uid}`))?.choice === 1, "porte 2 enregistrée");
    await page.locator("#portes-host .pm-titre", { hasText: "Porte 2 choisie" }).waitFor();
    // Porte 1 ouverte, pas encore la sienne : rien n'est dit.
    const award = { [uid]: { choice: 1, correct: false, points: -150, bonus: 0 } };
    const reveal = (opened, values) => hostState(question({ ...portes, phase: "reveal", awards: award, scores: { [uid]: 50 }, portes: { count: 3, order: [0, 1, 2], opened, values } }));
    await reveal(1, { 0: 300 });
    await page.locator("#r-title", { hasText: "Porte 2… suspense !" }).waitFor();
    await page.locator("#r-total", { hasText: "Classement à la fin des portes" }).waitFor();
    // Sa porte s'ouvre : la tuile, points exacts ; le total arrive quand toutes les portes sont ouvertes.
    await reveal(2, { 0: 300, 1: -150 });
    await page.locator("#r-portes .pm-titre", { hasText: "Aïe, la tuile !" }).waitFor();
    await page.locator("#r-portes .pm-points", { hasText: "−150 POINTS" }).waitFor();
    assert.equal(await page.locator("#r-title").isVisible(), false);
    await reveal(3, { 0: 300, 1: -150, 2: 150 });
    await page.locator("#r-total", { hasText: "50 points · 1re place" }).waitFor();
    // Question suivante ordinaire : les boutons habituels reviennent.
    await hostState(question({ qid: "q9", text: "Couleur du ciel ?" }));
    await page.locator(".choice .text", { hasText: "Bleu" }).waitFor();
    assert.equal(await page.locator("#portes-host").isVisible(), false);
    await page.context().close();
  });

  test("Les coffres mystères : l'équipe qui joue ouvre un coffre, les autres regardent, le contenu attend la TV, puis le bilan", async () => {
    const roses = await openPupitre();
    await joinTeam(roses, "Les Roses");
    const bleus = await openPupitre();
    await joinTeam(bleus, "Les Bleus");
    const teams = await read("teams");
    const r = Object.keys(teams).find((id) => teams[id].name === "Les Roses");
    const b = Object.keys(teams).find((id) => teams[id].name === "Les Bleus");
    const base = { qid: "bc", kind: "coffres", text: "Les Coffres mystères", choices: null, correct: null, deadline: null, game: { title: "Les Coffres mystères" } };
    const chests = (extra) => ({ ready: true, count: 10, order: [r, b], safe: 6, danger: false, exploded: false, opened: [], gains: { [r]: 0, [b]: 0 }, ...extra });
    await hostState(question({ ...base, chests: chests({ team: r, turn: 0, safeLeft: 6, key: "bc-1-0", readyAt: Date.now() - 1000 }) }));
    await roses.locator("#coffres-host .bc-titre", { hasText: "À vous, Les Roses !" }).waitFor();
    await bleus.locator("#coffres-host .bc-titre", { hasText: "Au tour de l'équipe Les Roses" }).waitFor();
    await bleus.locator(".bc-texte", { hasText: "Encore 6 coffres sans danger" }).waitFor();
    assert.equal(await roses.locator(".bc-case").count(), 10);
    // Sans numéros (cedric, 29/10) : les coffres aux mêmes places que sur la TV, 2 rangées de 5 pour 10 coffres.
    assert.deepEqual(await roses.locator(".bc-rangee").evaluateAll((rs) => rs.map((r) => r.querySelectorAll(".bc-case").length)), [5, 5]);
    assert.equal((await roses.locator(".bc-plaque").allTextContents()).join(""), "", "aucun numéro sur les coffres");
    const { repartitionCoffres } = await import("../web/public/coffres.js");
    assert.deepEqual([6, 7, 12, 13, 20].map(repartitionCoffres), [[6], [3, 4], [6, 6], [4, 4, 5], [6, 7, 7]], "mêmes rangées que la TV");
    assert.equal(await bleus.locator(".bc-case:not([disabled])").count(), 0, "seule l'équipe qui joue ouvre");
    // Plus de bouton « Ouvrir » (cedric, 27/10 au soir) : toucher le coffre 3 l'ouvre tout de suite.
    assert.equal(await roses.locator(".bc-ouvrir").count(), 0);
    await roses.locator(".bc-texte", { hasText: "Touchez un coffre pour l'ouvrir !" }).waitFor();
    // Double toucher (deux coffres très vite) : un seul coffre part, le premier.
    await roses.evaluate(() => { const c = document.querySelectorAll(".bc-case"); c[2].click(); c[4].click(); });
    await waitFor(async () => (await read("chestChoice/bc-1-0"))?.i === 2, "coffre 3 envoyé à la box");
    await roses.locator(".bc-texte", { hasText: "Coffre choisi : regardez la TV !" }).waitFor();
    assert.equal(await roses.locator(".bc-case:not([disabled])").count(), 0, "plus rien à toucher une fois le coffre envoyé");
    await new Promise((res) => setTimeout(res, 500));
    assert.equal((await read("chestChoice/bc-1-0"))?.i, 2, "le deuxième toucher n'a rien changé");
    // La box l'ouvre : +150 pour les Roses, montré sur la tablette seulement quand la TV l'a montré.
    const at = Date.now();
    const ouvert = { team: r, chest: 2, delta: 150, bomb: false, at };
    // (La bombe est arrivée : le coffre en or, pas encore trouvé, se cache avec elle.)
    await hostState(question({ ...base, chests: chests({ team: b, turn: 1, safeLeft: 0, danger: true, goldLeft: true, key: "bc-1-1", readyAt: at + 4000, opened: [ouvert], gains: { [r]: 150, [b]: 0 } }) }));
    await bleus.locator(".bc-case.bc-attente").waitFor();
    assert.equal(await bleus.locator(".bc-case").nth(2).locator(".bc-contenu").textContent(), "?", "suspense pendant l'animation de la TV");
    await bleus.locator(".bc-titre", { hasText: "Le coffre s'ouvre…" }).waitFor();
    await bleus.locator(".bc-case.bc-plus .bc-contenu", { hasText: "+150" }).waitFor({ timeout: 5000 });
    // Au tour des Bleus : le bouton attend la fin de l'animation sur la TV.
    await bleus.locator(".bc-titre", { hasText: "À vous, Les Bleus !" }).waitFor();
    await roses.locator(".bc-texte", { hasText: "la bombe peut être dans n'importe quel coffre… et le coffre en or (+500) aussi !" }).waitFor();
    if (Date.now() < at + 3500) assert.equal(await bleus.locator(".bc-case").nth(5).isDisabled(), true, "pas avant la fin de l'animation");
    await waitFor(() => bleus.locator(".bc-case").nth(5).isEnabled(), "coffres prêts après l'animation", 8000);
    assert.equal(await bleus.locator(".bc-case").nth(2).isDisabled(), true, "un coffre ouvert ne se rouvre pas");
    await bleus.locator(".bc-case").nth(5).click();
    await waitFor(async () => (await read("chestChoice/bc-1-1"))?.i === 5, "coffre 6 envoyé à la box");
    // Le coffre 6 était le coffre en or : +500 pour les Bleus, une pastille dorée sur toutes les tablettes.
    const or = { team: b, chest: 5, delta: 500, bomb: false, gold: true, at: Date.now() - 3000 };
    await hostState(question({ ...base, chests: chests({ team: r, turn: 2, safeLeft: 0, danger: true, goldLeft: false, key: "bc-1-2", readyAt: Date.now() + 60000, opened: [ouvert, or], gains: { [r]: 150, [b]: 500 } }) }));
    await roses.locator(".bc-case.bc-or .bc-contenu", { hasText: "⭐ +500" }).waitFor();
    await bleus.locator(".bc-texte", { hasText: "Attention, la bombe peut être dans n'importe quel coffre !" }).waitFor();
    assert.equal(await bleus.locator(".bc-texte", { hasText: "coffre en or" }).count(), 0, "le coffre en or est trouvé");
    // La bombe : bilan du jeu sur les deux tablettes, une fois l'explosion montrée par la TV.
    const bombe = { team: r, chest: 7, delta: -150, bomb: true, at: Date.now() - 3000 };
    await hostState(question({ ...base, phase: "reveal", scores: { [r]: 0, [b]: 500 }, chests: chests({ team: null, key: null, turn: 3, safeLeft: 0, danger: true, exploded: true, opened: [ouvert, or, bombe], gains: { [r]: 0, [b]: 500 } }) }));
    for (const page of [roses, bleus]) {
      await page.locator(".bc-titre", { hasText: "BOUM ! Le bilan" }).waitFor();
      await page.locator(".bc-texte", { hasText: "Les Roses a trouvé la bombe" }).waitFor();
      assert.deepEqual(await page.locator(".bc-ligne").allTextContents(), ["Les Bleus+500", "Les Roses0"]);
    }
    await bleus.locator(".bc-total", { hasText: "500 points · 1re place" }).waitFor();
    // Classement, puis jeu suivant ordinaire : les boutons habituels reviennent.
    await hostState(question({ ...base, phase: "scores", scores: { [r]: 0, [b]: 500 }, chests: chests({ team: null, exploded: true, opened: [ouvert, or, bombe], gains: { [r]: 0, [b]: 500 } }) }));
    await roses.locator(".bc-total", { hasText: "0 points · 2e place" }).waitFor();
    await hostState(question({ qid: "q9", text: "Couleur du ciel ?" }));
    await roses.locator(".choice .text", { hasText: "Bleu" }).waitFor();
    assert.equal(await roses.locator("#coffres-host .bc").count(), 0, "écran des coffres retiré");
    await roses.context().close();
    await bleus.context().close();
  });

  test("Le Gonfleur fou : les tapes attendent le départ, partent régulièrement, s'arrêtent à l'éclatement, puis le résultat", async () => {
    const page = await openPupitre();
    await joinTeam(page, "Les Roses");
    const uid = Object.keys(await read("teams"))[0];
    const base = { qid: "gf", kind: "gonfleur", text: "Le Gonfleur fou", choices: null, correct: null, game: { title: "Le Gonfleur fou" } };
    // Départ dans 3 s : le bouton attend « GONFLEZ ! », comme la TV.
    const goAt = Date.now() + 3000;
    await hostState(question({ ...base, resumeAt: goAt, deadline: goAt + 45000, pump: { key: "gf-1", goAt, target: 12 } }));
    await page.locator("#gonfleur-host .gf-texte", { hasText: "Préparez vos doigts" }).waitFor();
    assert.equal(await page.locator(".gf-pompe").isDisabled(), true, "pas avant le départ");
    await waitFor(() => page.locator(".gf-pompe").isEnabled(), "départ", 8000);
    // Dix tapes : envoyées à la base peu après, sans attendre chaque tape.
    for (let i = 0; i < 10; i++) await page.locator(".gf-pompe").click();
    await waitFor(async () => (await read(`pumps/gf-1/${uid}`))?.n === 10, "10 tapes reçues");
    // Le ballon éclate à 12 : au-delà, plus rien ne compte et le bouton disparaît.
    for (let i = 0; i < 2; i++) await page.locator(".gf-pompe").click();
    await waitFor(async () => (await read(`pumps/gf-1/${uid}`))?.n === 12, "ballon éclaté envoyé tout de suite");
    await page.locator(".gf-titre", { hasText: "BOUM !" }).waitFor();
    assert.equal(await page.locator(".gf-pompe").isVisible(), false);
    // La box termine la course : le ballon des Roses a gagné.
    await hostState(question({ ...base, phase: "reveal", pump: { key: "gf-1", goAt, target: 12 }, awards: { [uid]: { correct: true, points: 300, bonus: 0 } }, scores: { [uid]: 300 } }));
    await page.locator("#r-title", { hasText: "Votre ballon a gagné ! +300 points" }).waitFor();
    await page.locator("#r-total", { hasText: "300 points · 1re place" }).waitFor();
    // Jeu rejoué depuis la régie : nouvelle course, tablette remise à zéro.
    const go2 = Date.now() - 1000;
    await hostState(question({ ...base, resumeAt: go2, pump: { key: "gf-2", goAt: go2, target: 12 } }));
    await waitFor(() => page.locator(".gf-pompe").isEnabled(), "nouvelle course");
    await page.locator(".gf-pompe").click();
    await waitFor(async () => (await read(`pumps/gf-2/${uid}`))?.n === 1, "on repart de zéro");
    // Tapes en rafale (cedric, 30/10 : les premières semblaient sans effet, puis tout d'un coup) : le ballon les montre
    // toutes dès l'image suivante, sans redessiner toute la page à chaque tape.
    const rafale = await page.evaluate(() => new Promise((ok) => {
      const pompe = document.querySelector(".gf-pompe");
      let pages = 0;
      const surveille = new MutationObserver((m) => { pages += m.filter((x) => x.target === document.getElementById("paused")).length; });
      surveille.observe(document.body, { attributes: true, subtree: true });
      for (let i = 0; i < 5; i++) pompe.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      requestAnimationFrame(() => requestAnimationFrame(() => {
        surveille.disconnect();
        ok({ p: getComputedStyle(document.querySelector(".gf-ballon")).getPropertyValue("--p").trim(), jauge: document.querySelector(".gf-plein").style.width, pages });
      }));
    }));
    assert.deepEqual({ p: rafale.p, jauge: rafale.jauge }, { p: "0.500", jauge: "50%" }, "6 tapes sur 12 : ballon à moitié, tout de suite");
    assert.equal(rafale.pages, 0, "la page entière n'est pas redessinée à chaque tape");
    await waitFor(async () => (await read(`pumps/gf-2/${uid}`))?.n === 6, "rafale envoyée");
    await hostState(question({ qid: "q9", text: "Couleur du ciel ?" }));
    await page.locator(".choice .text", { hasText: "Bleu" }).waitFor();
    assert.equal(await page.locator("#gonfleur-host .gf").count(), 0, "écran du Gonfleur retiré");
    await page.context().close();
  });

  test("« Ça va exploser ! » : la bombe se renvoie d'un appui, la mèche colle, pas de retour à l'envoyeur, trois bombes puis le bilan", async () => {
    const roses = await openPupitre();
    await joinTeam(roses, "Les Roses");
    const bleus = await openPupitre();
    await joinTeam(bleus, "Les Bleus");
    const verts = await openPupitre();
    await joinTeam(verts, "Les Verts");
    const teams = await read("teams");
    const id = (name) => Object.keys(teams).find((t) => teams[t].name === name);
    const [r, b, v] = [id("Les Roses"), id("Les Bleus"), id("Les Verts")];
    const base = { qid: "pt", kind: "patate", text: "Ça va exploser !", choices: null, correct: null, deadline: null, durationMs: null, game: { title: "Ça va exploser !" } };
    const potato = (extra) => ({ lit: true, teams: [r, b, v], canReturn: false, passes: 0, from: null, ...extra });
    // Avant l'allumage : tout le monde regarde la TV.
    await hostState(question({ ...base, potato: { lit: false } }));
    await bleus.locator("#patate-host .pc-texte", { hasText: "La mèche va s'allumer" }).waitFor();
    // La bombe démarre chez les Roses : elles choisissent à qui l'envoyer, les équipes pas encore touchées brillent.
    let now = Date.now();
    await hostState(question({ ...base, potato: potato({ holder: r, since: now - 3000, readyAt: now - 1000, targets: [b, v], hit: [r], key: "pt-a" }) }));
    await roses.locator(".pc-titre", { hasText: "La bombe est chez vous !" }).waitFor();
    await bleus.locator(".pc-titre", { hasText: "La bombe est chez l'équipe Les Roses !" }).waitFor();
    assert.equal(await bleus.locator(".pc-equipe").count(), 0, "seule l'équipe qui tient la bombe l'envoie");
    assert.equal(await roses.locator(".pc-equipe.pc-neuve").count(), 2);
    await roses.locator(".pc-equipe", { hasText: "Les Bleus" }).click();
    await waitFor(async () => (await read("potatoPass/pt-a"))?.to === b, "envoi aux Bleus reçu par la box");
    await roses.locator(".pc-texte", { hasText: "Envoyée à l'équipe Les Bleus !" }).waitFor();
    // Chez les Bleus : plus de mèche qui colle (cedric, 27/10), seuls les Verts sont permis tout de suite (pas de retour
    // aux Roses).
    now = Date.now();
    await hostState(question({ ...base, potato: potato({ holder: b, from: r, since: now, readyAt: now, holdUntil: now + 2000, targets: [v], hit: [r, b], passes: 1, key: "pt-b" }) }));
    await bleus.locator(".pc-texte", { hasText: "Vite, envoyez-la à une autre équipe !" }).waitFor();
    assert.equal(await bleus.locator(".pc-colle:not([hidden])").count(), 0, "plus de barre de mèche qui colle");
    assert.equal(await bleus.locator(".pc-equipe", { hasText: "Les Verts" }).isEnabled(), true, "Verts permis dès la réception");
    await bleus.locator(".pc-equipe", { hasText: "Les Roses" }).locator("small", { hasText: "vient de vous l'envoyer" }).waitFor();
    assert.equal(await bleus.locator(".pc-equipe", { hasText: "Les Roses" }).isDisabled(), true, "pas de retour à l'envoyeur");
    // Le doigt touche l'écran (sans se relever) : la bombe part déjà.
    await bleus.locator(".pc-equipe", { hasText: "Les Verts" }).dispatchEvent("pointerdown", { button: 0, pointerType: "touch", isPrimary: true });
    await waitFor(async () => (await read("potatoPass/pt-b"))?.to === v, "envoi aux Verts reçu par la box, dès le doigt posé");
    await bleus.locator(".pc-texte", { hasText: "Envoyée à l'équipe Les Verts !" }).waitFor();
    // Le doigt se relève : le clic qui suit n'envoie rien de plus.
    await bleus.locator(".pc-equipe", { hasText: "Les Verts" }).dispatchEvent("click");
    assert.equal((await read("potatoPass/pt-b"))?.to, v);
    // La première bombe explose chez les Verts : ils perdent 100, les autres gagnent 100, et une autre bombe arrive.
    now = Date.now();
    const boom1 = { holder: v, at: now, lost: 100, gain: 100 };
    await hostState(question({ ...base, potato: potato({ holder: v, from: b, since: now - 5000, readyAt: now - 3000, targets: [r], hit: [r, b, v], passes: 2, key: null, bomb: 1, bombs: 3, exploded: true, booms: [boom1] }) }));
    await verts.locator(".pc-titre", { hasText: "BOUM ! La bombe a explosé chez vous" }).waitFor();
    await verts.locator(".pc-texte", { hasText: "−100 points. Attention, une autre bombe arrive…" }).waitFor();
    await verts.locator(".pc.pc-boum.pc-boum-moi").waitFor();
    await roses.locator(".pc-titre", { hasText: "BOUM chez l'équipe Les Verts !" }).waitFor();
    await roses.locator(".pc-texte", { hasText: "+100 points pour vous !" }).waitFor();
    assert.equal(await verts.locator(".pc-equipe").count(), 0, "plus rien ne s'envoie");
    // La bombe 2 s'allume chez les Roses (jamais chez les Verts qui viennent d'exploser) et part après l'annonce.
    now = Date.now();
    const go = now + 2500;
    await hostState(question({ ...base, resumeAt: go, potato: potato({ holder: r, since: go, readyAt: go + 2000, targets: [b, v], hit: [r], key: "pt-c", bomb: 2, bombs: 3, exploded: false, booms: [{ ...boom1, at: now - 4000 }] }) }));
    await roses.locator(".pc-titre", { hasText: "Bombe 2 sur 3 !" }).waitFor();
    await roses.locator(".pc-texte", { hasText: "Elle part de chez vous" }).waitFor();
    await bleus.locator(".pc-texte", { hasText: "Elle part de chez l'équipe Les Roses" }).waitFor();
    await roses.locator(".pc-compteur", { hasText: "Bombe 2 sur 3" }).waitFor();
    // Elle part : chez les Roses, le rouge bat et la tablette vibre, de plus en plus vite pendant que la mèche brûle.
    await roses.evaluate(() => {
      window.vibrations = [];
      Object.defineProperty(navigator, "vibrate", { configurable: true, value: (ms) => { if (typeof ms === "number") window.vibrations.push(ms); return true; } });
    });
    await hostState(question({ ...base, resumeAt: go, potato: potato({ holder: r, since: go, readyAt: go + 2000, targets: [b, v], hit: [r], key: "pt-c", bomb: 2, bombs: 3, exploded: false, burnFrom: go - 40000, booms: [{ ...boom1, at: now - 4000 }] }) }));
    await roses.locator(".pc-titre", { hasText: "La bombe est chez vous !" }).waitFor({ timeout: 6000 });
    await roses.locator(".pc.pc-chez-moi.pc-bat").waitFor();
    await waitFor(() => roses.evaluate(() => window.vibrations.length >= 3), "la tablette vibre à chaque coup", 4000);
    // 40 s de mèche déjà brûlés : les coups sont serrés (moins d'une demi-seconde) et les vibrations plus longues.
    assert.ok(await roses.evaluate(() => window.vibrations.every((ms) => ms >= 100)), "vibrations fortes au bout de la mèche");
    assert.equal(await bleus.locator(".pc.pc-bat").count(), 0, "seule l'équipe qui tient la bombe bat");
    // La troisième bombe explose chez les Verts : le bilan des trois bombes.
    const booms = [boom1, { holder: b, at: now - 2000, lost: 100, gain: 100 }, { holder: v, at: Date.now(), lost: 100, gain: 100 }];
    await hostState(question({ ...base, phase: "reveal", potato: potato({ holder: v, from: b, since: now, readyAt: now, targets: [r], hit: [r, b, v], passes: 2, key: null, bomb: 3, bombs: 3, exploded: true, booms }),
      awards: { [v]: { correct: false, points: -100, bonus: 0 }, [r]: { correct: true, points: 300, bonus: 0 }, [b]: { correct: true, points: 100, bonus: 0 } },
      scores: { [r]: 600, [b]: 300, [v]: 100 } }));
    await verts.locator("#r-title", { hasText: "BOUM ! La dernière bombe a explosé chez vous : −100 points" }).waitFor();
    await verts.locator("#r-detail", { hasText: "Sur les 3 bombes : −100 points." }).waitFor();
    await roses.locator("#r-title", { hasText: "Ouf ! +100 points" }).waitFor();
    await roses.locator("#r-detail", { hasText: "Elle a explosé chez l'équipe Les Verts. Sur les 3 bombes : +300 points." }).waitFor();
    await roses.locator("#r-total", { hasText: "600 points · 1re place" }).waitFor();
    await hostState(question({ qid: "q9", text: "Couleur du ciel ?" }));
    await bleus.locator(".choice .text", { hasText: "Bleu" }).waitFor();
    assert.equal(await bleus.locator("#patate-host .pc").count(), 0, "écran de la patate retiré");
    for (const p of [roses, bleus, verts]) await p.context().close();
  });

  test("« Ça va exploser ! » : 2 secondes pour l'envoyer dès la réception, un gros 2, 1 sur la tablette, sinon BOUM « Gardée plus de 2 secondes » (cedric, 21/10 et 27/10)", async () => {
    const roses = await openPupitre();
    await joinTeam(roses, "Les Roses");
    const bleus = await openPupitre();
    await joinTeam(bleus, "Les Bleus");
    const teams = await read("teams");
    const id = (name) => Object.keys(teams).find((t) => teams[t].name === name);
    const [r, b] = [id("Les Roses"), id("Les Bleus")];
    const base = { qid: "pt", kind: "patate", text: "Ça va exploser !", choices: null, correct: null, deadline: null, durationMs: null, game: { title: "Ça va exploser !" } };
    const potato = (extra) => ({ lit: true, teams: [r, b], canReturn: true, passes: 0, from: null, targets: [b], hit: [r], bomb: 1, bombs: 3, ...extra });
    const chiffre = (page) => page.locator(".pc-decompte:not([hidden])");
    // Chaque chiffre affiché est noté (la machine de test peut être lente : on ne rate aucun chiffre).
    await roses.evaluate(() => {
      window.chiffres = [];
      new MutationObserver(() => {
        const c = document.querySelector(".pc-decompte");
        const t = c && !c.hidden ? c.textContent : "";
        if (t && window.chiffres.at(-1) !== t) window.chiffres.push(t);
      }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    // Elle arrive : 2, 1 en grand sur la bombe tout de suite, chez les Roses seulement (un peu plus de 2 s : la machine de
    // test peut être lente).
    let now = Date.now();
    await hostState(question({ ...base, potato: potato({ holder: r, since: now, readyAt: now, holdUntil: now + 2500, key: "pt-a" }) }));
    await chiffre(roses).waitFor({ timeout: 2000 });
    if (process.env.CAPTURES) await roses.screenshot({ path: `${process.env.CAPTURES}/patate-decompte-portrait.png` });
    assert.equal(await chiffre(bleus).count(), 0, "seule l'équipe qui tient la bombe voit le décompte");
    await roses.setViewportSize({ width: 1280, height: 800 });
    await chiffre(roses).filter({ hasText: /^1$/ }).waitFor({ timeout: 6000 });
    assert.deepEqual(await roses.evaluate(() => window.chiffres), ["2", "1"], "2, 1 dans l'ordre");
    if (process.env.CAPTURES) await roses.screenshot({ path: `${process.env.CAPTURES}/patate-decompte-paysage.png` });
    // Le chiffre reste dans la bombe, entier, et ne cache pas les équipes.
    const cadre = await roses.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const c = r(".pc-decompte"); const bombe = r(".pc-bombe"); const eq = r(".pc-equipe");
      return { dedans: c.left >= bombe.left - 1 && c.right <= bombe.right + 1 && c.top >= bombe.top - 1 && c.bottom <= bombe.bottom + 1, chevauche: !(c.right <= eq.left || c.left >= eq.right || c.bottom <= eq.top || c.top >= eq.bottom) };
    });
    assert.deepEqual(cadre, { dedans: true, chevauche: false });
    // En pause : plus de décompte (la TV redonne 2 secondes à la reprise).
    await hostState(question({ ...base, paused: true, potato: potato({ holder: r, since: now, readyAt: now, holdUntil: null, key: "pt-a" }) }));
    await waitFor(async () => (await chiffre(roses).count()) === 0, "plus de décompte en pause");
    // Gardée trop longtemps : BOUM chez les Roses, avant la fin de la mèche.
    now = Date.now();
    await hostState(question({ ...base, potato: potato({ holder: r, since: now - 6000, readyAt: now - 4000, key: null, exploded: true, booms: [{ holder: r, at: now, lost: 0, gain: 100, held: true }] }) }));
    await roses.locator(".pc-titre", { hasText: "BOUM ! Gardée plus de 2 secondes" }).waitFor();
    await bleus.locator(".pc-titre", { hasText: "BOUM ! L'équipe Les Roses l'a gardée trop longtemps" }).waitFor();
    await bleus.locator(".pc-texte", { hasText: "+100 points pour vous !" }).waitFor();
    assert.equal(await chiffre(roses).count(), 0);
    for (const p of [roses, bleus]) await p.context().close();
  });

  test("Le Juste Chiffre : l'équipe tape son nombre une seule fois et voit si elle est la plus proche", async () => {
    const page = await openPupitre();
    await joinTeam(page, "Les Roses");
    const uid = Object.keys(await read("teams"))[0];
    await hostState(question({ qid: "n1", kind: "number", choices: null, text: "Combien d'os ?" }));
    await page.locator("#screen-question.active .number-pad").waitFor();
    assert.equal(await page.locator("#number-send").isDisabled(), true, "rien à envoyer tant que rien n'est tapé");
    for (const k of ["2", "0", "7", "⌫", "6"]) await page.click(`.number-key[data-key="${k}"]`);
    await page.locator("#number-screen", { hasText: "206" }).waitFor();
    await page.click("#number-send");
    await waitFor(async () => (await read(`answers/n1/${uid}`))?.choice === 206, "nombre enregistré");
    await page.locator("#q-status", { hasText: "Nombre 206 envoyé" }).waitFor();
    assert.equal(await page.locator(".number-key").first().isDisabled(), true);
    await hostState(question({ qid: "n1", kind: "number", choices: null, phase: "reveal", correct: 206, awards: { [uid]: { correct: true, points: 150, bonus: 0 } }, scores: { [uid]: 150 } }));
    await page.locator("#r-title", { hasText: "Pile le bon nombre ! +150 points" }).waitFor();
    await page.locator("#r-detail", { hasText: "206 (vous : 206)" }).waitFor();
    await page.context().close();
  });

  test("Statues musicales (cedric, 27/10) : DANSEZ !, STATUE !, « Regardez la TV ! » pendant l'annonce, puis les points de la chanson", async () => {
    const page = await openPupitre();
    await joinTeam(page, "Les Roses");
    const uid = Object.keys(await read("teams"))[0];
    const statues = (s) => question({ qid: "s1", kind: "statues", choices: null, text: "Statues musicales", statues: { songs: 3, annonceMs: 8000, song: 0, dancing: true, playedMs: 0, ended: false, ...s } });
    await hostState(statues({ since: Date.now() }));
    await page.locator("#play-status", { hasText: "DANSEZ !" }).waitFor();
    assert.equal(await page.locator("#buzz").isVisible(), false, "rien à toucher");
    await hostState(statues({ dancing: false, playedMs: 12000 }));
    await page.locator("#play-status", { hasText: "STATUE !" }).waitFor();
    await hostState(statues({ dancing: false, ended: true }));
    await page.locator("#play-status", { hasText: "Fin de la chanson !" }).waitFor();
    // Gagnantes désignées : la TV fait le suspense (la tablette ne dit rien), puis la tablette montre ses points.
    await hostState(statues({ dancing: false, result: { song: 0, winners: [uid], gains: { [uid]: 300 }, at: Date.now() - 6500 } }));
    await page.locator("#play-status", { hasText: "Regardez la TV" }).waitFor();
    await page.locator("#play-status", { hasText: "Les meilleures statues ! +300 points" }).waitFor({ timeout: 5000 });
    await hostState(statues({ song: 1, dancing: false, result: { song: 1, gains: {}, at: Date.now() - 9000 } }));
    await page.locator("#play-status", { hasText: "Personne cette fois" }).waitFor();
    await page.context().close();
  });

  test("Le Duel des robots (cedric, 27/10) : seules les 2 équipes du duel buzzent, une fois, avec l'heure de l'appui ; bravo, trop tôt, trop lent", async () => {
    const roses = await openPupitre();
    await joinTeam(roses, "Les Roses");
    const bleus = await openPupitre();
    await joinTeam(bleus, "Les Bleus");
    const verts = await openPupitre();
    await joinTeam(verts, "Les Verts");
    const teams = await read("teams");
    const id = (name) => Object.keys(teams).find((t) => teams[t].name === name);
    const [r, b] = [id("Les Roses"), id("Les Bleus")];
    const duel = (d) => question({ qid: "d1", kind: "duel", text: "Le Duel des robots", choices: null, deadline: null, durationMs: null,
      duel: { n: 3, total: 6, teams: [r, b], players: [2, 1], step: "ready", key: null, ...d } });
    await hostState(duel({}));
    await roses.locator("#play-status", { hasText: "Duel n° 3 : à toi, joueur n° 2 !" }).waitFor();
    await bleus.locator("#play-status", { hasText: "à toi, joueur n° 1 !" }).waitFor();
    await verts.locator("#play-status", { hasText: "Duel n° 3 : Les Roses contre Les Bleus. Regardez la TV !" }).waitFor();
    assert.equal(await verts.locator("#buzz").isVisible(), false, "les autres équipes regardent");
    assert.equal(await roses.locator("#buzz").isDisabled(), true, "pas avant le lancement du duel");
    // Les mots en lettre western néon (planche validée) : titre au-dessus du gros bouton « PAN ! ».
    await roses.locator("#duel-titre", { hasText: "Main sur le buzzer !" }).waitFor();
    assert.equal(await roses.locator("#buzz").textContent(), "PAN\u00a0!");
    await verts.locator("#duel-titre", { hasText: "Duel en cours" }).waitFor();
    // Pendant que les joueurs se placent, chaque tablette du duel cale son horloge sur celle du serveur.
    await waitFor(async () => typeof (await read(`horloge/${r}`))?.at === "number", "horloge des Roses mesurée");
    await waitFor(async () => typeof (await read(`horloge/${b}`))?.at === "number", "horloge des Bleus mesurée");
    assert.equal(await read(`horloge/${id("Les Verts")}`), null, "pas les équipes qui regardent");
    await roses.waitForTimeout(1_500);
    // Face-à-face : rien ne dit quand tombe le PAN ; un appui envoie l'heure de l'appui (heure du serveur).
    await hostState(duel({ step: "standoff", key: "d1-3-100" }));
    await roses.locator("#play-status", { hasText: "Attends le PAN !" }).waitFor();
    await verts.locator("#play-status", { hasText: "silence, ça va tirer" }).waitFor();
    const avant = Date.now();
    await roses.click("#buzz");
    await waitFor(async () => typeof (await read(`duel/d1-3-100/${r}`))?.t === "number", "buzz des Roses enregistré");
    const envoi = await read(`duel/d1-3-100/${r}`);
    assert.ok(Math.abs(envoi.t - avant) < 5_000, "heure de l'appui proche de maintenant");
    assert.equal(typeof envoi.at, "number");
    assert.ok(envoi.t <= envoi.at + 50, "l'appui est avant l'arrivée");
    assert.equal(typeof envoi.r, "number", "aller-retour de l'horloge fine, pour les rapports");
    assert.equal(typeof envoi.o, "number", "décalage de l'horloge fine");
    await roses.locator("#play-status", { hasText: "Buzz envoyé !" }).waitFor();
    assert.equal(await roses.locator("#buzz").isDisabled(), true, "un seul buzz par face-à-face");
    // Gros buzzer USB des Bleus : une touche.
    await bleus.keyboard.press("Enter");
    await waitFor(async () => typeof (await read(`duel/d1-3-100/${b}`))?.t === "number", "buzz des Bleus au buzzer USB");
    await hostState(duel({ step: "result", result: { winner: r, loser: b, early: null, ms: 312, points: 100 } }));
    await roses.locator("#play-status", { hasText: "BRAVO ! Le plus rapide en 0,31 s ! +100 points" }).waitFor();
    await bleus.locator("#play-status", { hasText: "Trop lent" }).waitFor();
    await roses.locator("#duel-titre", { hasText: "Le plus rapide !" }).waitFor();
    assert.equal(await roses.locator("#buzz").textContent(), "BRAVO");
    await bleus.locator("#duel-titre", { hasText: "Trop lent" }).waitFor();
    await verts.locator("#play-status", { hasText: "Les Roses remporte le duel !" }).waitFor();
    await hostState(duel({ step: "result", result: { winner: r, loser: b, early: b, ms: null, points: 100 } }));
    await bleus.locator("#play-status", { hasText: "OUPS, trop tôt !" }).waitFor();
    await bleus.locator("#duel-titre", { hasText: "Trop tôt !" }).waitFor();
    assert.equal(await bleus.locator("#buzz").textContent(), "OUPS");
    await verts.locator("#play-status", { hasText: "Les Bleus a buzzé trop tôt… Les Roses gagne le duel !" }).waitFor();
    await hostState(duel({ step: "result", result: { winner: null, loser: null, early: null, ms: null, points: 0 } }));
    await roses.locator("#play-status", { hasText: "Personne n'a tiré !" }).waitFor();
    // Nouveau face-à-face : nouvelle clé, on peut rebuzzer.
    await hostState(duel({ step: "standoff", key: "d1-4-200", n: 4 }));
    await waitFor(async () => !(await roses.locator("#buzz").isDisabled()), "bouton de nouveau actif");
    assert.equal(await roses.locator("#buzz").textContent(), "PAN\u00a0!");
    // Jeu suivant (image floue) : le bouton redevient « BUZZ », plus de titre western.
    await hostState(question({ qid: "f1", kind: "flou", choices: null, text: "Qu'est-ce qui se cache sous le flou ?", round: "f1-1000-1", buzzOpen: true }));
    await waitFor(async () => (await roses.locator("#buzz").textContent()) === "BUZZ", "bouton « BUZZ » de retour");
    assert.equal(await roses.locator("#duel-titre").isVisible(), false);
    for (const p of [roses, bleus, verts]) await p.context().close();
  });

  test("Le Chrono de Buzzy (cedric, 30/10) : on compte dans sa tête, un seul buzz après le 0, jamais l'heure à l'écran ; écart et points au bilan", async () => {
    const capt = async (page, nom) => { if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/${nom}.png` }); };
    const roses = await openPupitre();
    await joinTeam(roses, "Les Roses");
    const bleus = await openPupitre();
    await joinTeam(bleus, "Les Bleus");
    const verts = await openPupitre();
    await joinTeam(verts, "Les Verts");
    await roses.setViewportSize({ width: 1280, height: 800 });
    const teams = await read("teams");
    const id = (name) => Object.keys(teams).find((t) => teams[t].name === name);
    const [r, b, v] = [id("Les Roses"), id("Les Bleus"), id("Les Verts")];
    const chrono = (c) => question({ qid: "ch", kind: "chrono", text: "Le Chrono de Buzzy", choices: null, deadline: null, durationMs: null,
      chrono: { tour: 1, tours: 3, cible: 30, step: "ready", key: "ch-1-0", teams: null, ...c } });
    await hostState(chrono({}));
    await roses.locator("#play-status", { hasText: "Tour 1 : comptez jusqu'à 30" }).waitFor();
    assert.equal(await roses.locator("#buzz").isDisabled(), true, "pas de buzz avant le départ");
    await capt(roses, "tablette-pret");
    await capt(verts, "telephone-tablette-pret");
    // Départ dans 1,5 s : le bouton s'allume au 0, l'heure n'est jamais écrite.
    const goAt = Date.now() + 1_500;
    await hostState(chrono({ step: "run", key: "ch-1-100", goAt, cacheMs: 8000, teams: [r, b] }));
    await roses.locator("#play-status", { hasText: "Prêts ? Le chrono va partir" }).waitFor();
    await verts.locator("#play-status", { hasText: "Ce tour a commencé sans vous" }).waitFor();
    await waitFor(async () => !(await roses.locator("#buzz").isDisabled()), "buzz permis après le 0", 5_000);
    await roses.locator("#play-status", { hasText: "Buzzez à 30 secondes pile" }).waitFor();
    assert.doesNotMatch(await roses.locator("#screen-play").innerText(), /\d+,\d\d/, "aucun temps affiché");
    await capt(roses, "tablette-compte");
    // Game Show : le gros bouton respire sans arrêt (jamais « stable » pour Playwright).
    await roses.click("#buzz", { force: true });
    await waitFor(async () => typeof (await read(`chrono/ch-1-100/${r}`))?.t === "number", "buzz des Roses enregistré");
    const envoi = await read(`chrono/ch-1-100/${r}`);
    assert.ok(envoi.t <= envoi.at + 50, "l'appui est avant l'arrivée");
    await roses.locator("#play-status", { hasText: "Buzz envoyé !" }).waitFor();
    assert.equal(await roses.locator("#buzz").isDisabled(), true, "un seul buzz par tour");
    await capt(roses, "tablette-buzz-envoye");
    await bleus.keyboard.press("Enter");
    await waitFor(async () => typeof (await read(`chrono/ch-1-100/${b}`))?.t === "number", "buzz des Bleus au buzzer USB");
    // Bilan : écart de chacune, 100 à la plus proche, 50 à la 2e.
    await hostState(chrono({ step: "result", key: "ch-1-100", teams: [r, b],
      result: { ecarts: { [r]: -380, [b]: 1240 }, winners: [r], points: 100, gains: { [r]: 100, [b]: 50 }, at: Date.now() } }));
    await roses.locator("#play-status", { hasText: "BRAVO ! La plus proche : −0,38" }).waitFor();
    await bleus.locator("#play-status", { hasText: "Bien joué : +50 points !" }).waitFor();
    await verts.locator("#play-status", { hasText: "Pas de buzz pour vous ce tour-ci" }).waitFor();
    await capt(roses, "tablette-gagne");
    await capt(bleus, "telephone-tablette-deuxieme");
    for (const p of [roses, bleus, verts]) await p.context().close();
  });

  test("Le Simon de Buzzy (cedric, 27/10) : on regarde la TV, puis le joueur appelé tape la suite et valide ; éliminés ou gagné après la vérification", async () => {
    const roses = await openPupitre();
    await joinTeam(roses, "Les Roses");
    const bleus = await openPupitre();
    await joinTeam(bleus, "Les Bleus");
    const verts = await openPupitre();
    await joinTeam(verts, "Les Verts");
    const teams = await read("teams");
    const id = (name) => Object.keys(teams).find((t) => teams[t].name === name);
    const [r, b, v] = [id("Les Roses"), id("Les Bleus"), id("Les Verts")];
    const simon = (sm) => question({ qid: "s1", kind: "simon", text: "Le Simon de Buzzy", choices: null, deadline: null, durationMs: null,
      simon: { tour: 1, tours: 3, suite: 4, step: "ready", key: null, teams: [r, b], players: { [r]: 2, [b]: 1 }, chiffres: false, ...sm } });
    await hostState(simon({}));
    await roses.locator(".sm-texte", { hasText: "Prochaine série : joueur 2, prépare-toi !" }).waitFor();
    await verts.locator(".sm-texte", { hasText: "Vous jouerez au prochain tour." }).waitFor();
    // Les chiffres débarquent, puis le robot montre la suite : on regarde la TV, rien à toucher.
    const t = Date.now();
    await hostState(simon({ step: "play", key: "s1-1-4-100", startAt: t, chiffresAt: t, montreAt: t + 2_500, reponseAt: t + 4_500, finAt: t + 60_000, chiffres: true }));
    await roses.locator(".sm-titre", { hasText: "Attention, les chiffres débarquent !" }).waitFor();
    await roses.locator(".sm-titre", { hasText: "Regarde et retiens bien les couleurs…" }).waitFor({ timeout: 5_000 });
    assert.equal(await roses.locator(".sm-pave").isVisible(), false, "rien à toucher pendant que le robot montre");
    // Le chrono part : le joueur appelé tape, chaque appui part en direct vers la TV.
    await roses.locator(".sm-titre", { hasText: "À toi ! Tape les couleurs" }).waitFor({ timeout: 5_000 });
    await roses.locator(".sm-joueur", { hasText: "C'est au tour du joueur 2" }).waitFor();
    assert.equal(await roses.locator(".sm-chiffres").isVisible(), true, "les chiffres sont là");
    assert.equal(await verts.locator(".sm-pave").isVisible(), false, "pas du tour : on regarde");
    await verts.locator(".sm-titre", { hasText: "Les autres équipes jouent…" }).waitFor();
    assert.equal(await roses.locator(".sm-valider").isDisabled(), true, "suite pas complète");
    await roses.locator(".sm-boule[data-item=rouge]").dispatchEvent("pointerdown");
    await waitFor(async () => (await read(`simon/s1-1-4-100/${r}`))?.items === "rouge", "premier appui envoyé");
    await roses.locator(".sm-boule[data-item=bleu]").dispatchEvent("pointerdown");
    await roses.locator(".sm-effacer").dispatchEvent("pointerdown");
    for (const item of ["vert", "jaune", "4"]) await roses.locator(`.sm-touche[data-item="${item}"]`).dispatchEvent("pointerdown");
    await roses.locator(".sm-compte", { hasText: "Tes couleurs (4/4)" }).waitFor();
    assert.equal(await roses.locator(".sm-touche[data-item=orange]").isDisabled(), true, "suite complète : plus d'appui");
    await roses.locator(".sm-valider").dispatchEvent("pointerdown");
    await waitFor(async () => (await read(`simon/s1-1-4-100/${r}`))?.ok === true, "suite validée");
    const envoi = await read(`simon/s1-1-4-100/${r}`);
    assert.equal(envoi.items, "rouge,vert,jaune,4");
    assert.equal(typeof envoi.at, "number");
    await roses.locator(".sm-titre", { hasText: "Couleurs envoyées !" }).waitFor();
    // Jugée : la TV vérifie colonne par colonne, la tablette attend avant de dire le résultat.
    const verdict = { suite: 4, solution: "rouge,vert,jaune,4", wrong: [b], winners: [r], points: 300, at: Date.now() };
    await hostState(simon({ step: "won", out: { [b]: 4 }, verdict }));
    await bleus.locator(".sm-titre", { hasText: "Vérification…" }).waitFor();
    await roses.locator(".sm-titre", { hasText: "Bravo, vous gagnez le tour !" }).waitFor({ timeout: 8_000 });
    await roses.locator(".sm-texte", { hasText: "+300 points" }).waitFor();
    await bleus.locator(".sm-titre", { hasText: "Éliminés du tour…" }).waitFor();
    await verts.locator(".sm-titre", { hasText: "Les Roses gagne le tour !" }).waitFor();
    // Toutes en erreur dès la première suite : « Bah alors ?! ».
    await hostState(simon({ step: "judged", suite: 1, verdict: { suite: 1, bahAlors: true, points: 0, at: Date.now() - 10_000 } }));
    await roses.locator(".sm-titre", { hasText: "Bah alors ?!" }).waitFor();
    // Nouvelle suite : nouvelle clé, la saisie repart de zéro.
    const t2 = Date.now();
    await hostState(simon({ step: "play", suite: 1, key: "s1-1-1-200", startAt: t2 - 4_000, montreAt: t2 - 2_000, reponseAt: t2 - 1_000, finAt: t2 + 60_000 }));
    await roses.locator(".sm-compte", { hasText: "Tes couleurs (0/1)" }).waitFor();
    // Que des couleurs (cedric, 29/10) : pas de chiffres, les 8 boules prennent la place, entières, droit comme couché.
    assert.equal(await roses.locator(".sm-chiffres").isVisible(), false, "plus de chiffres");
    const FORMATS = { "téléphone droit": [390, 844, 70], "téléphone couché": [844, 390, 60], "tablette posée": [1280, 800, 150], "tablette droite": [800, 1280, 150] };
    for (const [format, [width, height, mini]] of Object.entries(FORMATS)) {
      await roses.setViewportSize({ width, height });
      await roses.waitForTimeout(300);
      if (process.env.LMP_SHOTS) await roses.screenshot({ path: `${process.env.LMP_SHOTS}/simon-couleurs-${width}x${height}.png` });
      const cadres = await roses.evaluate(() => [...document.querySelectorAll(".sm-boules .sm-boule, .sm-effacer, .sm-valider")].map((el) => {
        const r = el.getBoundingClientRect();
        return { c: el.className, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width };
      }));
      assert.equal(cadres.length, 10, format);
      for (const k of cadres) assert.ok(k.l >= -1 && k.t >= -1 && k.r <= width + 1 && k.b <= height + 1, `${format} : ${JSON.stringify(k)} dépasse`);
      const boule = Math.min(...cadres.filter((k) => k.c.includes("sm-boule")).map((k) => k.w));
      assert.ok(boule >= mini, `${format} : boules de ${Math.round(boule)} px (au moins ${mini})`);
    }
    for (const p of [roses, bleus, verts]) await p.context().close();
  });

  test("blind test : après une erreur, l'équipe attend 3 s après la reprise de la musique puis peut rebuzzer", async () => {
    const page = await openPupitre();
    await joinTeam(page, "Les Roses");
    const uid = Object.entries(await read("teams")).find(([, t]) => t.name === "Les Roses")[0];
    const rebuzzAt = Date.now() + 1_500;
    await hostState(question({
      qid: "b1", kind: "blind", choices: null, text: "Quel est ce titre ?", round: "b1-1000-1", buzzOpen: true,
      blind: { waiting: false, played: true }, buzz: { blocked: [uid], rebuzzAt }, buzzBlocked: { [uid]: rebuzzAt },
    }));
    await page.locator("#play-status", { hasText: "vous pourrez retenter votre chance dans un instant" }).waitFor();
    assert.equal(await page.locator("#buzz").isDisabled(), true, "bouton grisé pendant les 3 s");
    await page.locator("#play-status", { hasText: "Vous pouvez retenter votre chance" }).waitFor({ timeout: 5_000 });
    assert.equal(await page.locator("#buzz").isDisabled(), false);
    await page.click("#buzz");
    await waitFor(async () => (await read("buzz/b1-1000-1"))?.team === uid, "rebuzz accepté par la base");
    await page.context().close();
  });

  test("image floue : après une erreur, l'équipe peut rebuzzer 3 s après le verdict (règle 2)", async () => {
    const page = await openPupitre();
    await joinTeam(page, "Les Roses");
    const uid = Object.entries(await read("teams")).find(([, t]) => t.name === "Les Roses")[0];
    const rebuzzAt = Date.now() + 1_500;
    await hostState(question({
      qid: "f9", kind: "flou", choices: null, text: "Qu'est-ce qui se cache sous le flou ?", round: "f9-1000-1", buzzOpen: true,
      buzz: { blocked: [uid], rebuzzAt }, buzzBlocked: { [uid]: rebuzzAt },
    }));
    await page.locator("#play-status", { hasText: "vous pourrez retenter votre chance dans un instant" }).waitFor();
    assert.equal(await page.locator("#buzz").isDisabled(), true, "bouton grisé pendant les 3 s");
    await page.locator("#play-status", { hasText: "Vous pouvez retenter votre chance" }).waitFor({ timeout: 5_000 });
    assert.equal(await page.locator("#buzz").isDisabled(), false);
    await page.click("#buzz");
    await waitFor(async () => (await read("buzz/f9-1000-1"))?.team === uid, "rebuzz accepté par la base");
    await page.context().close();
  });

  test("Fin de la fête : ni place ni points sur la tablette avant que la TV annonce le gagnant ; rien du classement au dernier jeu", async () => {
    // cedric, 26/10 : la place s'affichait sur les tablettes pendant le suspense des jauges.
    const page = await openPupitre("&look=classique");
    const uid = await joinTeam(page, "Sacha");
    // Dernier jeu de la fête (index = total - 1) : son résultat ne dit rien du classement.
    await hostState(question({ phase: "reveal", index: 2, total: 3, scores: { [uid]: 250 }, awards: { [uid]: { points: 100, correct: true } } }));
    await page.locator("#r-total", { hasText: "Le classement, c'est sur la télé" }).waitFor();
    assert.equal(await page.locator("#r-total", { hasText: "place" }).count(), 0);
    // Classique : gagnant annoncé 7 s après la fin, + 1,5 s de marge ; la fin date d'il y a 6,5 s → 2 s de suspense.
    await hostState(question({ phase: "ended", index: 2, total: 3, scores: { [uid]: 250 }, endedAt: Date.now() - 6_500 }));
    await page.locator("#screen-ended.active.suspense #e-rank", { hasText: "Le grand gagnant est" }).waitFor();
    assert.match(await page.locator("#e-total").textContent(), /^Regardez la télé\s!$/);
    assert.doesNotMatch(await page.locator("#screen-ended").textContent(), /250|place|gagné/);
    await page.locator("#e-rank", { hasText: "Vous avez gagné" }).waitFor({ timeout: 6_000 });
    assert.equal(await page.locator("#e-total").textContent(), "250 points");
    assert.equal(await page.locator("#screen-ended.suspense").count(), 0);
    // Tablette rouverte bien après la fin : le résultat tout de suite.
    await page.reload();
    await page.locator("#e-rank", { hasText: "Vous avez gagné" }).waitFor();
    await page.context().close();
  });

  test("Le design suit celui de la TV de la partie, même ouvert sans le QR (vieil onglet resté en Classique)", async () => {
    // Téléphone de Sacha (cedric, 26/10) : un vieil onglet sans « &look=gs » gardait l'ancien design violet.
    await set(ref(hostDb(), `games/${CODE}/public`), { title: "Fête", look: "gs" });
    const page = await openPupitre("&look=classique");
    await page.waitForFunction(() => document.body.classList.contains("look-gs"));
    await joinTeam(page, "Sacha");
    assert.equal(await page.evaluate(() => localStorage.getItem("lmp-look")), "gs", "retenu pour le prochain lien sans réglage");
    // La TV repasse en Classique (menu Retour) : le pupitre suit en direct.
    await set(ref(hostDb(), `games/${CODE}/public/look`), "classique");
    await page.waitForFunction(() => !document.body.classList.contains("look-gs"));
    assert.equal(await page.locator(".logo .gs-titre").count(), 0, "logo Classique remis");
    await page.context().close();
  });

  test("Game Show : au buzz, la tablette joue le mot de Daft Punk de son équipe, comme la TV ; en Classique, le petit air", async () => {
    const espion = (ctx) => ctx.addInitScript(() => {
      window.__sons = [];
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...x) { window.__sons.push(this.buffer?.duration); return start.apply(this, x); };
    });
    const premiere = await openPupitre("&look=gs", espion);
    await joinTeam(premiere, "Les Roses");
    const seconde = await openPupitre("&look=gs", espion);
    const demandes = [];
    seconde.on("request", (r) => { if (r.url().includes("/sons-gs/")) demandes.push(r.url().split("/").pop()); });
    await joinTeam(seconde, "Les Bleus");
    await waitFor(async () => demandes.length === 8, "les 8 mots demandés dès l'entrée dans l'équipe, sans toucher");
    await hostState(question({ qid: "b2", kind: "blind", choices: null, text: "Quel est ce titre ?", round: "b2-1000-0", buzzOpen: true, blind: { waiting: false, played: true }, buzz: { blocked: [] } }));
    await seconde.locator("#play-status", { hasText: "buzzez" }).waitFor();
    // Les mots sont décodés en arrière-plan : on attend qu'ils soient prêts avant d'appuyer.
    await seconde.waitForTimeout(800);
    // Buzzer du Game Show animé en continu (« Réacteur ») : jamais « immobile » pour Playwright, on clique quand même.
    await seconde.click("#buzz", { force: true });
    await waitFor(async () => (await seconde.evaluate(() => window.__sons.length)) === 1, "un mot joué");
    // 2e équipe arrivée = 2e mot, pas celui de la 1re (leurs durées diffèrent).
    const [joue, mot1, mot2] = await seconde.evaluate(async () => {
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const d = async (k) => (await ctx.decodeAudioData(await (await fetch(`sons-gs/equipe-${k}.mp3`)).arrayBuffer())).duration;
      return [window.__sons[0], await d(1), await d(2)];
    });
    assert.ok(Math.abs(joue - mot2) < 0.002 && Math.abs(joue - mot1) > 0.01, `mot joué ${joue} s (mot 1 : ${mot1}, mot 2 : ${mot2})`);
    const classique = await openPupitre("&look=classique", espion);
    await joinTeam(classique, "Les Verts");
    await hostState(question({ qid: "b3", kind: "blind", choices: null, text: "Quel est ce titre ?", round: "b3-1000-0", buzzOpen: true, blind: { waiting: false, played: true }, buzz: { blocked: [] } }));
    await classique.locator("#play-status", { hasText: "buzzez" }).waitFor();
    await classique.click("#buzz");
    await waitFor(async () => (await read("buzz/b3-1000-0"))?.team, "buzz enregistré");
    assert.equal(await classique.evaluate(() => window.__sons.length), 0, "Classique : pas de mot de Daft Punk");
    for (const p of [premiere, seconde, classique]) await p.context().close();
  });

  test("Image floue : deux équipes buzzent en même temps, une seule a la main ; après une erreur elle est bloquée", async () => {
    const pages = [await openPupitre(), await openPupitre()];
    await joinTeam(pages[0], "Les Roses");
    await joinTeam(pages[1], "Les Bleus");
    const uids = Object.fromEntries(Object.entries(await read("teams")).map(([uid, t]) => [t.name, uid]));
    const flou = (extra = {}) => question({ qid: "f1", kind: "flou", choices: null, text: "Qu'est-ce qui se cache sous le flou ?", round: "f1-1000-0", buzzOpen: true, buzz: { blocked: [] }, ...extra });
    await hostState(flou());
    for (const p of pages) {
      await p.locator("#play-status", { hasText: "buzzez dès que vous la reconnaissez" }).waitFor();
      assert.equal(await p.locator("#buzz").isDisabled(), false);
    }
    // Les deux appuient presque en même temps : la base garde le premier, l'autre est refusé.
    await Promise.all(pages.map((p) => p.click("#buzz")));
    await waitFor(async () => (await read("buzz/f1-1000-0"))?.team, "un buzz enregistré");
    const first = (await read("buzz/f1-1000-0")).team;
    assert.ok([uids["Les Roses"], uids["Les Bleus"]].includes(first));
    const [winner, other] = first === uids["Les Roses"] ? [pages[0], pages[1]] : [pages[1], pages[0]];
    // La box fige l'image pour cette équipe.
    await hostState(flou({ buzzOpen: false, deadline: null, remainingMs: 25000, buzz: { team: first, blocked: [] } }));
    await winner.locator("#play-status", { hasText: "Vous avez buzzé" }).waitFor();
    await other.locator("#play-status", { hasText: "a buzzé : écoutez sa réponse" }).waitFor();
    assert.equal(await other.locator("#buzz").isDisabled(), true);
    // Mauvaise réponse : nouvelle clé, l'équipe qui s'est trompée ne peut plus buzzer, l'autre si.
    await hostState(flou({ round: "f1-1000-1", buzz: { blocked: [first] } }));
    await winner.locator("#play-status", { hasText: "Raté pour cette image" }).waitFor();
    assert.equal(await winner.locator("#buzz").isDisabled(), true);
    // Chaque pupitre reçoit le nouvel état de son côté : on attend que l'autre l'ait affiché.
    await other.locator("#play-status", { hasText: "buzzez dès que vous la reconnaissez" }).waitFor();
    assert.equal(await other.locator("#buzz").isDisabled(), false);
    await other.click("#buzz");
    const second = first === uids["Les Roses"] ? uids["Les Bleus"] : uids["Les Roses"];
    await waitFor(async () => (await read("buzz/f1-1000-1"))?.team === second, "rebond enregistré");
    // Révélation : la réponse et l'équipe gagnante sur chaque pupitre.
    await hostState(flou({ phase: "reveal", choices: ["Un lion", "Un chat"], correct: 0, buzzOpen: false, awards: { [second]: { correct: true, points: 100, bonus: 0 } }, scores: { [second]: 100 }, buzz: { team: second, blocked: [first] } }));
    await other.locator("#r-title", { hasText: "Bravo ! +100 points" }).waitFor();
    await other.locator("#r-detail", { hasText: "C'était : Un lion" }).waitFor();
    await winner.locator("#r-title", { hasText: "a trouvé !" }).waitFor();
    for (const p of pages) await p.context().close();
  });

  test("gros buzzer USB (vu comme un clavier) : un appui buzze comme l'écran, seulement quand le BUZZ est là", async () => {
    const pages = [await openPupitre(), await openPupitre()];
    // Buzzer déjà branché pendant l'attente : appuyer n'envoie rien.
    await waitingDevice(pages[0]);
    await pages[0].keyboard.press("Space");
    await joinTeam(pages[0], "Les Roses");
    assert.equal(await read("fun"), null, "attendre son entrée ne buzze pas");
    await joinTeam(pages[1], "Les Bleus");
    const uids = Object.fromEntries(Object.entries(await read("teams")).map(([uid, t]) => [t.name, uid]));
    // Salon : le gros bouton fait le petit air, comme un toucher.
    await pages[0].keyboard.press("Space");
    await waitFor(async () => (await read("fun"))?.[uids["Les Roses"]]?.at, "buzz de l'accueil au gros bouton");
    // Question à 4 réponses : pas de BUZZ à l'écran, le gros bouton ne fait rien, même sur une réponse restée
    // sélectionnée (le gros bouton est souvent réglé sur Entrée).
    await hostState(question());
    await pages[0].locator("#screen-question.active").waitFor();
    await pages[0].locator(".choice").nth(1).focus();
    await pages[0].keyboard.press("Space");
    await pages[0].keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(await read("answers"), null, "aucune réponse envoyée par le gros bouton");
    // Image floue : le gros bouton des Roses (touche maintenue : un seul appui), puis celui des Bleus, refusé.
    await hostState(question({ qid: "f1", kind: "flou", choices: null, text: "Qu'est-ce qui se cache sous le flou ?", round: "f1-1000-0", buzzOpen: true, buzz: { blocked: [] } }));
    for (const p of pages) await p.locator("#play-status", { hasText: "buzzez dès que vous la reconnaissez" }).waitFor();
    await pages[0].keyboard.down("Space");
    await pages[0].keyboard.down("Space");
    await pages[0].keyboard.up("Space");
    await waitFor(async () => (await read("buzz/f1-1000-0"))?.team === uids["Les Roses"], "buzz des Roses au gros bouton");
    await pages[0].locator("#buzz[disabled]").waitFor({ state: "attached" });
    await pages[1].keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 400));
    assert.equal((await read("buzz/f1-1000-0")).team, uids["Les Roses"], "la base garde le premier buzz");
    // Buzzer réglé en usine comme un clic de souris : un clic à côté du BUZZ compte aussi.
    await hostState(question({ qid: "f3", kind: "flou", choices: null, text: "Qu'est-ce qui se cache sous le flou ?", round: "f3-1000-0", buzzOpen: true, buzz: { blocked: [] } }));
    await pages[0].locator("#buzz:not([disabled])").waitFor();
    await pages[0].mouse.click(12, 12);
    await waitFor(async () => (await read("buzz/f3-1000-0"))?.team === uids["Les Roses"], "buzz des Roses au clic de souris");
    // Sans gros bouton, le BUZZ de l'écran marche comme avant.
    await hostState(question({ qid: "f2", kind: "flou", choices: null, text: "Qu'est-ce qui se cache sous le flou ?", round: "f2-1000-0", buzzOpen: true, buzz: { blocked: [] } }));
    await pages[1].locator("#buzz:not([disabled])").waitFor();
    await pages[1].click("#buzz");
    await waitFor(async () => (await read("buzz/f2-1000-0"))?.team === uids["Les Bleus"], "buzz des Bleus à l'écran");
    for (const p of pages) await p.context().close();
  });

  test("Chante le mot ! et Qui suis-je ? : le même grand BUZZ, la consigne du jeu, puis le mot ou le personnage", async () => {
    const page = await openPupitre();
    await joinTeam(page, "Les Roses");
    const uid = Object.keys(await read("teams"))[0];
    const jeu = (extra) => question({ choices: null, buzzOpen: true, buzz: { blocked: [] }, ...extra });
    await hostState(jeu({ qid: "c1", kind: "chante", text: "soleil", round: "c1-1000-0" }));
    await page.locator("#play-status", { hasText: "chantez une chanson avec le mot de la TV" }).waitFor();
    await page.click("#buzz");
    await waitFor(async () => (await read("buzz/c1-1000-0"))?.team === uid, "buzz enregistré");
    await hostState(jeu({ qid: "c1", kind: "chante", text: "soleil", round: "c1-1000-0", buzzOpen: false, buzz: { team: uid, blocked: [] } }));
    await page.locator("#play-status", { hasText: "À vous de chanter" }).waitFor();
    await hostState(jeu({ qid: "c1", kind: "chante", text: "soleil", phase: "reveal", choices: ["soleil"], correct: 0, buzzOpen: false, awards: { [uid]: { correct: true, points: 150, bonus: 0 } }, scores: { [uid]: 150 } }));
    await page.locator("#r-detail", { hasText: "Le mot : soleil" }).waitFor();
    await hostState(jeu({ qid: "p1", kind: "quisuis", text: "Qui suis-je ?", round: "p1-1000-0" }));
    await page.locator("#play-status", { hasText: "Écoutez les indices de la TV" }).waitFor();
    assert.equal(await page.locator("#buzz").isDisabled(), false);
    // Qui a disparu ? : pas de buzz pendant qu'on mémorise, puis le buzzer s'ouvre quand l'objet a disparu.
    await hostState(jeu({ qid: "d1", kind: "disparu", text: "Qui a disparu ?", round: "d1-1000-0", buzzOpen: false }));
    await page.locator("#play-status", { hasText: "mémorisez bien tous les objets" }).waitFor();
    assert.equal(await page.locator("#buzz").isDisabled(), true);
    await hostState(jeu({ qid: "d1", kind: "disparu", text: "Qui a disparu ?", round: "d1-1000-0" }));
    await page.locator("#play-status", { hasText: "quel objet manque sur la TV" }).waitFor();
    assert.equal(await page.locator("#buzz").isDisabled(), false);
    await page.context().close();
  });

  test("Pictionary : le dessinateur choisit 1 mot sur 3 puis dessine sur l'ardoise ; l'autre équipe a son animation", async () => {
    const [licornes, dragons] = [await openPupitre(), await openPupitre()];
    await joinTeam(licornes, "Licornes");
    await joinTeam(dragons, "Dragons");
    const uidOf = Object.fromEntries(Object.entries(await read("teams")).map(([uid, t]) => [t.name, uid]));
    const L = uidOf.Licornes;
    const offer = [{ word: "Soleil", image: "☀️" }, { word: "Maison", image: "🏠" }, { word: "Bateau", image: "⛵" }];
    const picto = (mime, extra = {}) => question({
      qid: "r1p", kind: "pictionary", text: "Pictionary", choices: null, deadline: null,
      mime: { team: null, found: 0, passed: 0, left: 10, turns: [], counts: {}, points: 150, ...mime }, ...extra,
    });

    // Sarah montre 3 mots aux Licornes : seul leur dessinateur les voit, les fait défiler et choisit.
    await hostState(picto({ secret: L, offer, chosen: null, pickKey: "r1p-100" }));
    await licornes.locator("#screen-pick.active").waitFor();
    assert.equal(await licornes.locator("#pick-host .choix-carte").count(), 3);
    await dragons.locator("#watch-host .sp-bandeau", { hasText: "Licornes » choisit son mot secret" }).waitFor();
    assert.equal(await dragons.locator(".choix-carte").count(), 0, "l'autre équipe ne voit pas les mots");
    await licornes.click(".choix-fleche[data-sens='1']");
    await licornes.click(".choix-valider");
    await waitFor(async () => (await read("pictoChoice/r1p-100"))?.i === 1, "choix enregistré");
    await licornes.locator(".choix-valider", { hasText: "C'est noté" }).waitFor();
    await hostState(picto({ secret: L, offer, chosen: 1, pickKey: "r1p-100" }));
    await licornes.locator("#pick-status", { hasText: "Tu vas dessiner « Maison »" }).waitFor();
    // Tour suivant : toucher directement la carte choisit le mot, comme le bouton.
    await hostState(picto({ secret: L, offer, chosen: null, pickKey: "r1p-150" }));
    await licornes.locator("#pick-host .choix-valider:not([disabled])").waitFor();
    await licornes.click(".choix-fleche[data-sens='-1']");
    await licornes.locator("#pick-host .choix-carte").nth(2).click();
    await waitFor(async () => (await read("pictoChoice/r1p-150"))?.i === 2, "choix par toucher de la carte enregistré");
    await licornes.locator(".choix-valider", { hasText: "C'est noté" }).waitFor();
    // Sur la tablette, l'émoji du mot (cedric, 24/10 : la vraie photo, c'est la TV qui la montre quand le dessin est
    // trouvé) ; seul un mot sans émoji (une image à soi) montre sa photo.
    const PHOTO = "0123456789abcdef";
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/choiceImages/${PHOTO}`),
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="));
    await hostState(picto({ secret: L, offer: [{ ...offer[0], imageId: PHOTO }, { word: "Doudou", imageId: PHOTO }, offer[2]], chosen: null, pickKey: "r1p-160" }));
    await licornes.locator('#pick-host .choix-carte .mot-secret-image img[src^="data:image/png"]').waitFor({ state: "attached" });
    assert.equal(await licornes.locator("#pick-host .choix-carte .mot-secret-image img").count(), 1, "la photo seulement pour le mot sans émoji");
    assert.match(await licornes.locator("#pick-host .choix-carte").nth(0).textContent(), /☀️/);

    // On dessine sur l'ardoise : les traits partent vers la TV par petits paquets ; « Tout effacer » aussi.
    await hostState(picto({ team: L, card: offer[1], drawKey: "r1p-200", turns: [L] }, { deadline: Date.now() + 60000 }));
    await licornes.locator("#screen-draw.active").waitFor();
    await licornes.locator(".ardoise-titre", { hasText: "Maison" }).waitFor();
    await dragons.locator(".sp-bandeau", { hasText: "Licornes » dessine" }).waitFor();
    const canvas = licornes.locator("#draw-host canvas");
    const box = await waitFor(async () => { const b = await canvas.boundingBox(); return b && b.height > 50 ? b : null; }, "feuille à sa taille");
    await licornes.mouse.move(box.x + 20, box.y + 20);
    await licornes.mouse.down();
    for (let k = 1; k <= 12; k++) {
      await licornes.mouse.move(box.x + 20 + k * 15, box.y + 20 + k * 10);
      await licornes.waitForTimeout(25);
    }
    await licornes.mouse.up();
    const strokes = await waitFor(async () => {
      const all = Object.values((await read("drawing/r1p-200")) ?? {}).filter((s) => s.p);
      return all.length >= 2 ? all : null;
    }, "traits reçus");
    assert.equal(strokes[0].c, "#1B1035", "crayon noir au départ");
    assert.equal(strokes[0].w, 2, "trait moyen au départ");
    const pts = strokes.map((s) => s.p.split(" ").map((xy) => xy.split(",").map(Number)));
    assert.ok(pts.flat().every(([x, y]) => x >= 0 && x <= 1000 && y >= 0 && y <= 1000), "coordonnées de 0 à 1000");
    // Chaque paquet reprend le dernier point du précédent : la TV relie le trait sans trou.
    for (let i = 1; i < pts.length; i++) assert.deepEqual(pts[i][0], pts[i - 1].at(-1));
    // Gomme : efface juste un morceau ; le trait part vers la TV en couleur papier.
    await licornes.click(".ardoise-gomme");
    assert.equal(await licornes.getAttribute(".ardoise-gomme", "aria-checked"), "true");
    await licornes.mouse.move(box.x + 60, box.y + 45);
    await licornes.mouse.down();
    await licornes.mouse.move(box.x + 90, box.y + 65);
    await licornes.mouse.up();
    await waitFor(async () => Object.values((await read("drawing/r1p-200")) ?? {}).some((s) => s.c === "paper"), "trait de gomme envoyé");
    await licornes.click(".ardoise-feutre >> nth=1");
    assert.equal(await licornes.getAttribute(".ardoise-gomme", "aria-checked"), "false", "un feutre repose la gomme");
    await licornes.click(".ardoise-effacer");
    await licornes.click(".ardoise-effacer");
    await waitFor(async () => Object.values((await read("drawing/r1p-200")) ?? {}).some((s) => s.clear), "effacement envoyé");

    // Fin du tour : chacun retrouve l'écran d'attente, avec le mot.
    await hostState(picto({ turns: [L], counts: { [L]: 1 }, last: { team: L, found: 1, passed: 0, word: "Maison" } }));
    await licornes.locator("#play-status", { hasText: "« Maison » : bravo Licornes" }).waitFor();
    await dragons.locator("#play-status", { hasText: "« Maison » : bravo Licornes" }).waitFor();
    await licornes.context().close();
    await dragons.context().close();
  });

  test("accueil : deux équipes buzzent à répétition, rien ne se bloque ni ne change d'écran", async () => {
    const pages = [await openPupitre(), await openPupitre()];
    await joinTeam(pages[0], "Les Roses");
    await joinTeam(pages[1], "Les Bleus");
    const uids = Object.fromEntries(Object.entries(await read("teams")).map(([uid, t]) => [t.name, uid]));
    const seen = [];
    for (let i = 0; i < 3; i++) {
      for (const p of pages) {
        assert.equal(await p.locator("#buzz").isDisabled(), false, "le buzzer de l'accueil n'est jamais bloqué");
        await p.click("#buzz");
      }
      await waitFor(async () => {
        const fun = (await read("fun")) ?? {};
        return fun[uids["Les Roses"]]?.at && fun[uids["Les Bleus"]]?.at && fun[uids["Les Roses"]].at !== seen.at(-1);
      }, "buzz des deux équipes");
      seen.push((await read("fun"))[uids["Les Roses"]].at);
      await new Promise((r) => setTimeout(r, 350));
    }
    assert.equal(new Set(seen).size, 3, "chaque appui est bien parti");
    for (const p of pages) {
      await p.locator("#screen-play.active").waitFor();
      await p.locator("#play-status", { hasText: "buzzez autant que vous voulez" }).waitFor();
    }
    // Le quiz commence : le buzzer de l'accueil disparaît.
    await hostState(question());
    await pages[0].locator("#screen-question.active").waitFor();
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

  test("reconnexion : la tablette retrouve son équipe sans rien redemander ; nouvelle prestation, nouvelle demande", async () => {
    const page = await openPupitre();
    const uid = await joinTeam(page, "Les Licornes");

    // Prestation suivante dans le même navigateur : rien n'est repris de l'ancienne équipe, la tablette redemande.
    await set(ref(hostDb(), "games/TEST2"), { hostUid: HOST, regieActive: true, state: { phase: "lobby", round: 1, total: 3, scores: {} } });
    await page.goto(`${baseUrl}/?g=TEST2&emu=1`);
    await page.locator("#screen-waiting.active").waitFor();
    await waitFor(async () => (await get(ref(hostDb(), `games/TEST2/joinRequests/${uid}`))).exists(), "nouvelle demande");

    // Retour sur la première partie : la reconnexion retrouve l'équipe et son nom.
    await page.goto(`${baseUrl}/?g=${CODE}&emu=1`);
    await page.locator("#screen-play.active").waitFor();
    assert.equal(Object.keys(await read("teams")).length, 1, "Pas de nouvelle équipe");
    assert.equal((await read(`teams/${uid}`)).name, "Les Licornes");
    assert.equal(await read("joinRequests"), null, "pas de demande pour une équipe déjà là");
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

  test("portrait et paysage : chaque écran tient sur un téléphone et une tablette, dans les deux sens, sans rien couper", async () => {
    const FORMATS = { "téléphone droit": [390, 844], "téléphone couché": [844, 390], "tablette posée": [1280, 800], "tablette droite": [800, 1280] };
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const IDS = ["0123456789abcdef", "fedcba9876543210", "00112233445566ff", "ffeeddccbbaa9988"];
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/choiceImages`), Object.fromEntries(IDS.map((id) => [id, PNG]))));
    await set(ref(hostDb(), `games/${CODE}/regieActive`), false);
    const page = await openPupitre();
    const shots = process.env.LMP_SHOTS;
    /** Rien ne dépasse : ni l'écran actif, ni ses boutons, ni ses textes (sinon un enfant ne peut pas répondre). */
    const tient = async (nom) => {
      for (const [format, [width, height]] of Object.entries(FORMATS)) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(450);
        if (shots) await page.screenshot({ path: `${shots}/${nom}-${width}x${height}.png` });
        const trop = await page.evaluate(() => {
          const ecran = document.querySelector(".screen.active");
          const out = [];
          if (ecran.scrollHeight > ecran.clientHeight + 2) out.push(`écran ${ecran.scrollHeight} > ${ecran.clientHeight}`);
          for (const el of ecran.querySelectorAll("button, input, .choice, .team-banner, .hint, canvas, .ardoise-outils, .intro-jeu")) {
            const r = el.getBoundingClientRect();
            if (!r.width || el.closest("[hidden]")) continue;
            if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`${el.className || el.tagName} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
          }
          return out;
        });
        assert.deepEqual(trop, [], `${nom}, ${format} (${width}×${height})`);
      }
    };
    await page.locator("#screen-gate.active").waitFor();
    await tient("avant-la-regie");
    await set(ref(hostDb(), `games/${CODE}/regieActive`), true);
    await page.locator("#screen-waiting.active").waitFor();
    await tient("attente");
    await page.setViewportSize({ width: 390, height: 844 });
    await joinTeam(page, "Les Licornes");
    const uid = Object.keys(await read("teams"))[0];
    await page.locator("#screen-play.active").waitFor();
    await tient("buzzer");
    await hostState({ phase: "intro", seq: 5, total: 4, scores: {}, round: 1, buzzOpen: false, paused: false, index: 0, qid: "f0", kind: "flou", deadline: null, game: { title: "Image floue", n: 1, of: 3, label: "Image floue · 1 / 3" } });
    await page.locator("#play-intro:not([hidden])", { hasText: "Image floue" }).waitFor();
    await tient("presentation");
    await hostState(question({ text: "Quel animal est le plus rapide ?", choices: ["Le guépard", "La tortue des Galápagos", "Le paresseux", "L'escargot de Bourgogne"] }));
    await page.locator("#screen-question.active .choice").first().waitFor();
    await tient("quatre-reponses");
    await hostState(question({ qid: "q2", kind: "express", choices: ["Vrai", "Faux"] }));
    await page.locator("#choices.two").waitFor();
    await tient("vrai-faux");
    await hostState(question({ qid: "q3", choices: ["Lion", "Chien", "Vache", "Chat"], choiceImages: IDS }));
    await page.locator("#choices.pictures img.photo:not([hidden])").first().waitFor();
    await tient("reponses-en-images");
    await hostState(question({ qid: "q4", kind: "number", choices: null }));
    await page.locator(".number-key").first().waitFor();
    await tient("juste-chiffre");
    await hostState(question({ qid: "q4", phase: "reveal", correct: 1, awards: { [uid]: 100 }, scores: { [uid]: 100 } }));
    await page.locator("#screen-result.active").waitFor();
    await tient("resultat");
    const picto = (mime, extra = {}) => question({ qid: "r1p", kind: "pictionary", text: "Pictionary", choices: null, deadline: null,
      mime: { team: null, found: 0, passed: 0, left: 10, turns: [], counts: {}, points: 150, ...mime }, ...extra });
    const offer = [{ word: "Soleil", image: "☀️" }, { word: "Maison", image: "🏠" }, { word: "Bateau", image: "⛵" }];
    await hostState(picto({ secret: uid, offer, chosen: null, pickKey: "r1p-100" }));
    await page.locator("#screen-pick.active .choix-carte").first().waitFor();
    await tient("pictionary-choix");
    await hostState(picto({ team: uid, card: offer[1], drawKey: "r1p-200", turns: [uid] }, { deadline: Date.now() + 60000 }));
    await page.locator("#screen-draw.active canvas").waitFor();
    await tient("pictionary-ardoise");
    // Paysage : la feuille en grand, les outils à côté d'elle, pas dessous.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(450);
    const [feuille, outils] = await Promise.all([".ardoise-feuille", ".ardoise-outils"].map((sel) => page.locator(sel).boundingBox()));
    assert.ok(outils.x >= feuille.x + feuille.width - 1, `outils à droite de la feuille : ${JSON.stringify({ feuille, outils })}`);
    assert.ok(feuille.height > 560, `feuille en grand : ${feuille.height}`);
    await hostState(question({ phase: "ended", scores: { [uid]: 1200 } }));
    await page.locator("#screen-ended.active").waitFor();
    await tient("fin");
    await page.context().close();
  });

  test("réponse choisie : son anneau blanc tient dans l'écran (tous les quiz à réponses, portrait et paysage), jamais un « ! » seul sur sa ligne", async () => {
    const FORMATS = { "petit téléphone": [320, 640], "téléphone droit": [390, 844], "téléphone couché": [844, 390], "tablette posée": [1280, 800], "tablette droite": [800, 1280] };
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const IDS = ["0123456789abcdef", "fedcba9876543210", "00112233445566ff", "ffeeddccbbaa9988"];
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/choiceImages`), Object.fromEntries(IDS.map((id) => [id, PNG]))));
    for (const look of ["gs", "classique"]) {
      await hostState(null);
      // Pas de vrai plein écran ici : la fenêtre du navigateur de test ne changerait plus de taille.
      const page = await openPupitre(`&look=${look}`, (context) => context.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.resolve(); }));
      await joinTeam(page, `Les Zooms ${look}`);
      const jeux = [
        ["quiz", question({ qid: `${look}1`, choices: ["Le guépard", "La tortue des Galápagos", "Le paresseux", "L'escargot de Bourgogne"] })],
        ["zoom mystère", question({ qid: `${look}2`, kind: "zoom", text: "Qu'est-ce que c'est ?", choices: ["Roi Boo", "Skelerex", "Mallow", "Chomp enchaîné"] })],
        ["réponses en images", question({ qid: `${look}3`, choices: ["Lion", "Chien", "Vache", "Chat"], choiceImages: IDS })],
        ["vrai ou faux", question({ qid: `${look}4`, kind: "express", choices: ["Vrai", "Faux"] })],
      ];
      for (const [jeu, etat] of jeux) {
        await page.setViewportSize({ width: 390, height: 844 });
        await hostState(etat);
        await page.locator(`#screen-question.active .choice >> nth=${etat.choices.length - 1}`).waitFor();
        // La dernière réponse, celle du bas (ou de droite), là où l'anneau dépassait.
        await page.locator(".choice").nth(etat.choices.length - 1).click();
        await page.locator(".choice.picked").waitFor();
        for (const [format, [width, height]] of Object.entries(FORMATS)) {
          await page.setViewportSize({ width, height });
          await page.waitForTimeout(400);
          const dehors = await page.evaluate(() => {
            const ecran = document.querySelector(".screen.active");
            const e = ecran.getBoundingClientRect();
            const out = [];
            for (const choix of ecran.querySelectorAll(".choice")) {
              // Anneau blanc de 4 px autour de la réponse choisie : il doit rester dans l'écran qui défile.
              const r = choix.getBoundingClientRect();
              const bord = choix.classList.contains("picked") ? 4 : 0;
              if (r.left - bord < Math.max(e.left, 0) - 0.5 || r.right + bord > Math.min(e.right, innerWidth) + 0.5) {
                out.push(`${choix.textContent} ${Math.round(r.left)}→${Math.round(r.right)} dans ${Math.round(e.left)}→${Math.round(e.right)}`);
              }
            }
            // Le titre : sa dernière ligne n'est jamais faite que d'un signe de ponctuation.
            const titre = document.getElementById("q-number");
            const texte = titre.firstChild;
            if (texte?.nodeType === Node.TEXT_NODE && /[!?:]$/.test(texte.nodeValue) && texte.nodeValue.length > 2) {
              const haut = (i) => { const r = document.createRange(); r.setStart(texte, i); r.setEnd(texte, i + 1); return r.getBoundingClientRect().top; };
              const n = texte.nodeValue.length;
              if (Math.abs(haut(n - 1) - haut(n - 3)) > 2) out.push(`« ${texte.nodeValue.slice(-1)} » seul sur sa ligne : ${texte.nodeValue}`);
            }
            return out;
          });
          assert.deepEqual(dehors, [], `${look}, ${jeu}, ${format} (${width}×${height})`);
        }
      }
      await page.context().close();
    }
  });

  test("retour sur la page (autre appli, plein écran qui bascule) : le toucher qui la ramène ne répond pas à la place de l'équipe", async () => {
    const page = await openPupitre("", (context) => context.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.resolve(); }));
    const equipe = await joinTeam(page, "Les Revenants");
    await hostState(question({ qid: "retour1" }));
    await page.locator("#screen-question.active .choice").first().waitFor();
    // La page revient au premier plan (cedric, 25/10 : « réponse envoyée » au retour, sans avoir répondu).
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.locator(".choice").nth(2).click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator(".choice.picked").count(), 0, "pas de réponse dans la seconde du retour");
    assert.equal(await read(`answers/retour1/${equipe}`), null);
    // Une seconde plus tard, l'équipe répond normalement.
    await page.waitForTimeout(800);
    await page.locator(".choice").nth(1).click();
    await waitFor(async () => (await read(`answers/retour1/${equipe}`))?.choice === 1, "réponse B enregistrée");
    await page.context().close();
  });

  test("présentation d'un jeu sur la TV : pas de buzzer ni de question, la tablette dit d'écouter l'animatrice", async () => {
    const page = await openPupitre();
    await joinTeam(page, "Les Roses");
    await hostState({ phase: "intro", seq: 5, total: 4, scores: {}, round: 1, buzzOpen: false, paused: false, index: 2, qid: "f1", kind: "flou", deadline: null, game: { title: "Image floue", n: 1, of: 3, label: "Image floue · 1 / 3" } });
    await page.locator("#play-intro:not([hidden])", { hasText: "Prochain jeu" }).waitFor();
    assert.equal(await page.locator("#play-intro-title").textContent(), "Image floue");
    assert.equal(await page.locator("#play-status").textContent(), "Écoutez bien l'animatrice\u00a0!", "espace insécable : le « ! » ne part jamais seul à la ligne");
    assert.equal(await page.locator("#buzz").isVisible(), false, "pas de buzzer pendant la présentation");
    assert.equal(await page.locator("#screen-question").isVisible(), false);
    await hostState(question({ qid: "f1", kind: "flou", choices: null, buzzOpen: true, buzz: { blocked: [] }, round: "f1-1000-0" }));
    await page.locator("#buzz:not([hidden])").waitFor();
    assert.equal(await page.locator("#play-intro").isVisible(), false, "le nom du jeu s'efface quand l'épreuve est lancée");
    await page.context().close();
  });

  test("la pause générale s'affiche aussi entre deux questions", async () => {
    const page = await openPupitre();
    await joinTeam(page, "Les Roses");
    await hostState(question({ phase: "scores", deadline: null, paused: true, pauseReason: "regie" }));
    await page.locator("#paused:not([hidden])", { hasText: "Pause fun !" }).waitFor();
    // Sur un téléphone, le texte reste centré avec des marges : jamais collé aux bords de l'écran.
    await page.setViewportSize({ width: 390, height: 844 });
    const texte = await page.locator("#paused p").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { gauche: r.left, droite: innerWidth - r.right, align: getComputedStyle(el).textAlign };
    });
    assert.ok(texte.gauche >= 20 && texte.droite >= 20, `marges du texte de pause : ${JSON.stringify(texte)}`);
    assert.equal(texte.align, "center");
    const titre = await page.locator("#paused div").evaluate((el) => el.scrollWidth <= el.clientWidth);
    assert.ok(titre, "le titre « Pause fun ! » tient sur l'écran");
    await hostState(question({ phase: "scores", deadline: null }));
    await page.locator("#paused[hidden]").waitFor({ state: "attached" });
    await page.context().close();
  });

  test("plein écran perdu (retour d'une autre appli, notification) : redemandé au toucher, même sur une réponse verrouillée, au clic et au gros buzzer", async () => {
    const page = await openPupitre();
    // Le navigateur de test n'a pas de vrai plein écran : on compte les demandes, sans jamais l'obtenir.
    await page.evaluate(() => { window.demandes = 0; Element.prototype.requestFullscreen = function () { window.demandes++; return Promise.resolve(); }; });
    const demandes = () => page.evaluate(() => window.demandes);
    await joinTeam(page, "Les Lys");
    // Le premier toucher, n'importe où, demande le plein écran.
    await page.locator("#screen-play").click({ position: { x: 20, y: 300 } });
    await waitFor(async () => (await demandes()) >= 1, "plein écran demandé au premier toucher");
    await hostState(question());
    await page.locator(".choice").nth(1).click();
    await waitFor(async () => page.locator(".choice").first().isDisabled(), "réponses verrouillées après l'envoi");
    // Un doigt sur une réponse verrouillée ne fait pas de clic : le toucher seul suffit.
    let avant = await demandes();
    await page.locator(".choice").first().dispatchEvent("touchend");
    await waitFor(async () => (await demandes()) > avant, "plein écran redemandé au toucher d'une réponse verrouillée");
    // Le gros buzzer USB (une touche de clavier) aussi ; Échap, lui, sert à sortir du plein écran.
    avant = await demandes();
    await page.keyboard.press("Enter");
    await waitFor(async () => (await demandes()) > avant, "plein écran redemandé au gros buzzer");
    avant = await demandes();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    assert.equal(await demandes(), avant, "Échap ne redemande pas le plein écran");
    await page.context().close();
  });

  test("pupitre installé comme une appli (déjà en plein écran) : aucune demande de plein écran, donc pas de bandeau de Chrome au retour", async () => {
    const page = await openPupitre("", (context) => context.addInitScript(() => {
      window.demandes = 0;
      Element.prototype.requestFullscreen = function () { window.demandes++; return Promise.resolve(); };
      const vrai = window.matchMedia.bind(window);
      window.matchMedia = (q) => (q === "(display-mode: fullscreen)" ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : vrai(q));
    }));
    const demandes = () => page.evaluate(() => window.demandes);
    await joinTeam(page, "Les Lys");
    await hostState(question());
    await page.locator(".choice").nth(1).click();
    await waitFor(async () => page.locator(".choice").first().isDisabled(), "réponses verrouillées après l'envoi");
    await page.locator(".choice").first().dispatchEvent("touchend");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    assert.equal(await demandes(), 0);
    await page.context().close();
  });

  test("retour d'une autre appli : la connexion coupée en douce par le téléphone est refaite, l'écran suit de nouveau la partie", async () => {
    // Le téléphone coupe la connexion sans prévenir la page (iPhone de Sacha, 21/10) : plus rien ne passe, ni dans un
    // sens ni dans l'autre, mais la page se croit toujours connectée. Une nouvelle connexion, elle, passe.
    const gelees = new Set();
    let courante = null;
    const page = await openPupitre("", (context) => context.routeWebSocket(/\/\.ws/, (ws) => {
      const id = {};
      courante = id;
      const serveur = ws.connectToServer();
      ws.onMessage((m) => { if (!gelees.has(id)) serveur.send(m); });
      serveur.onMessage((m) => { if (!gelees.has(id)) ws.send(m); });
    }));
    await joinTeam(page, "Les Iris");
    const uid = Object.keys(await read("teams"))[0];
    await hostState(question());
    await page.locator("#screen-question.active .choice", { hasText: "Bleu" }).waitFor();
    gelees.add(courante);
    await hostState(question({ qid: "q2", index: 1, choices: ["Vénus", "Jupiter", "Mars", "Saturne"] }));
    await page.waitForTimeout(1500);
    assert.equal(await page.locator(".choice", { hasText: "Vénus" }).count(), 0, "connexion figée : la page ne voit pas la question suivante");
    const visibilite = (etat) => page.evaluate((etat) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => etat });
      document.dispatchEvent(new Event("visibilitychange"));
    }, etat);
    // Un coup d'œil de moins de 2 s ailleurs ne refait pas la connexion.
    await visibilite("hidden");
    await page.waitForTimeout(300);
    await visibilite("visible");
    await page.waitForTimeout(1500);
    assert.equal(await page.locator(".choice", { hasText: "Vénus" }).count(), 0);
    // Deux minutes dans une autre appli (ici 2,5 s), puis retour : connexion neuve, question en cours, présence remise.
    await visibilite("hidden");
    await page.waitForTimeout(2500);
    await visibilite("visible");
    await page.locator("#screen-question.active .choice", { hasText: "Vénus" }).waitFor({ timeout: 8000 });
    // Le toucher qui ramène la page ne répond pas : la réponse se donne une seconde après le retour.
    await page.waitForTimeout(1000);
    await page.locator(".choice").nth(2).click();
    await waitFor(async () => (await read(`answers/q2/${uid}`))?.choice === 2, "réponse envoyée sur la nouvelle connexion");
    await waitFor(async () => (await read(`presence/${uid}`))?.online === true, "présence remise");
    await page.context().close();
  });

  test("contrôle parental (iPhone 15, 24/10) : coupée sans cesse, la tablette passe seule à la connexion de secours et tient", async () => {
    // Le filtre (Qustodio, Temps d'écran) laisse chaque connexion continue vivre un instant, puis la coupe.
    let ouvertes = 0;
    const page = await openPupitre("", (context) => context.routeWebSocket(/\/\.ws/, (ws) => {
      ouvertes += 1;
      ws.connectToServer();
      setTimeout(() => ws.close().catch(() => {}), 1500);
    }));
    await waitFor(() => page.evaluate(() => localStorage.getItem("lmp-connexion-simple")), "connexion de secours choisie", 30000);
    const avant = ouvertes;
    assert.ok(avant >= 3, `au moins 3 coupures avant le secours : ${avant}`);
    await joinTeam(page, "Les Iris");
    const uid = Object.keys(await read("teams"))[0];
    await hostState(question());
    await page.locator("#screen-question.active .choice", { hasText: "Bleu" }).waitFor();
    await page.waitForTimeout(3000);
    assert.equal(ouvertes, avant, "plus aucune connexion continue");
    assert.equal(await page.locator("#offline").isHidden(), true, "pas de « Connexion perdue »");
    await page.locator(".choice").nth(1).click();
    await waitFor(async () => (await read(`answers/q1/${uid}`))?.choice === 1, "réponse envoyée par la connexion de secours");
    await waitFor(async () => (await read(`presence/${uid}`))?.online === true, "présence en ligne");
    // Rechargée : elle repart directement en secours.
    await page.reload();
    await page.locator("#screen-question.active").waitFor();
    await page.waitForTimeout(2000);
    assert.equal(ouvertes, avant, "rechargée, toujours sans connexion continue");
    await page.context().close();
  });

  test("à la reprise, le décompte 3, 2, 1 bloque les réponses puis les rouvre", async () => {
    const page = await openPupitre();
    await joinTeam(page, "Les Roses");
    const resumeAt = Date.now() + 2500;
    await hostState(question({ resumeAt, deadline: resumeAt + 12000 }));
    await page.locator("#resume-count:not([hidden])").waitFor();
    assert.equal(await page.locator(".choice").first().isDisabled(), true, "Pas de réponse pendant le décompte");
    await page.locator("#resume-count[hidden]").waitFor({ state: "attached", timeout: 6000 });
    await waitFor(async () => !(await page.locator(".choice").first().isDisabled()), "réponses rouvertes après le décompte");
    await page.locator(".choice").nth(1).click();
    const uid = Object.keys(await read("teams"))[0];
    await waitFor(async () => (await read(`answers/q1/${uid}`))?.choice === 1, "réponse acceptée après le décompte");
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

