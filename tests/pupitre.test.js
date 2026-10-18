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

  test("une couleur prise est grisée pour les autres, même si deux tablettes la choisissent en même temps", async () => {
    const [a, b, c] = [await openPupitre(), await openPupitre(), await openPupitre()];
    for (const p of [a, b, c]) await p.locator("#screen-join.active").waitFor();
    // Les trois tablettes ont la première couleur présélectionnée ; deux valident en même temps.
    await a.fill("#team-name", "Les Roses");
    await b.fill("#team-name", "Les Bleus");
    await Promise.all([a.click("#join"), b.click("#join")]);
    // Si les deux demandes se croisent vraiment, la tablette perdante le dit, passe sur une couleur libre
    // et il suffit de revalider.
    const loser = await waitFor(async () => {
      for (const p of [a, b]) if (await p.locator("#join-error:not([hidden])").count()) return p;
      return Object.keys((await read("teams")) ?? {}).length === 2 ? "aucune" : null;
    }, "les deux tablettes ont une réponse", 15000);
    if (loser !== "aucune") {
      await loser.locator("#join-error", { hasText: "vient d'être prise" }).waitFor();
      await loser.click("#join");
    }
    await waitFor(async () => Object.keys((await read("teams")) ?? {}).length === 2, "deux équipes inscrites");
    const teams = Object.values(await read("teams"));
    assert.notEqual(teams[0].color, teams[1].color, "jamais deux équipes de la même couleur");
    for (const p of [a, b]) await p.locator("#screen-play.active").waitFor();
    // La troisième voit les deux couleurs prises, grisées et impossibles à choisir.
    for (const t of teams) {
      await c.locator(`#colors button[data-color="${t.color}"]:disabled`).waitFor();
    }
    assert.equal(teams.map((t) => t.color).includes(await c.locator("#colors button.selected").getAttribute("data-color")), false);
    await c.fill("#team-name", "Les Verts");
    await c.click("#join");
    await c.locator("#screen-play.active").waitFor();
    const colors = Object.values(await read("teams")).map((t) => t.color);
    assert.equal(new Set(colors).size, 3);
    for (const p of [a, b, c]) await p.context().close();
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
    await page.context().close();
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

  test("nom d'équipe : champ vide à chaque prestation, saisie et correction libres, gardé à la reconnexion", async () => {
    const page = await openPupitre();
    await page.locator("#screen-join.active").waitFor();
    assert.equal(await page.inputValue("#team-name"), "", "Aucun nom prérempli");
    assert.equal(await page.getAttribute("#team-name", "placeholder"), "Choisissez un nom d'équipe");
    // Saisie clavier puis correction d'une faute, comme sur un téléphone.
    await page.locator("#team-name").pressSequentially("Les Licornez");
    await page.keyboard.press("Backspace");
    await page.locator("#team-name").pressSequentially("s");
    await page.click("#join");
    await page.locator("#screen-play.active").waitFor();
    const uid = Object.keys(await read("teams"))[0];
    assert.equal((await read(`teams/${uid}`)).name, "Les Licornes");

    // Prestation suivante dans le même navigateur : rien n'est repris de l'ancienne équipe.
    await set(ref(hostDb(), "games/TEST2"), { hostUid: HOST, state: { phase: "lobby", round: 1, total: 3, scores: {} } });
    await page.goto(`${baseUrl}/?g=TEST2&emu=1`);
    await page.locator("#screen-join.active").waitFor();
    assert.equal(await page.inputValue("#team-name"), "");

    // Retour sur la première partie : la reconnexion retrouve l'équipe et son nom sans rien retaper.
    await page.goto(`${baseUrl}/?g=${CODE}&emu=1`);
    await page.locator("#screen-play.active").waitFor();
    assert.equal(Object.keys(await read("teams")).length, 1, "Pas de nouvelle équipe");
    assert.equal((await read(`teams/${uid}`)).name, "Les Licornes");
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

  test("la pause générale s'affiche aussi entre deux questions", async () => {
    const page = await openPupitre();
    await joinTeam(page, "Les Roses");
    await hostState(question({ phase: "scores", deadline: null, paused: true, pauseReason: "regie" }));
    await page.locator("#paused:not([hidden])", { hasText: "Pause paillettes !" }).waitFor();
    await hostState(question({ phase: "scores", deadline: null }));
    await page.locator("#paused[hidden]").waitFor({ state: "attached" });
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

