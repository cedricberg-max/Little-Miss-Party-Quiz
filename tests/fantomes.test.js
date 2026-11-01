// Outil de test « équipes fantômes » (fantomes.html) : des tablettes simulées entrent dans la partie et jouent seules,
// avec les mêmes écritures qu'un vrai pupitre (donc les mêmes règles de la base). La box est simulée par ce script.
import { createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { ref, get, set, update, onChildAdded } from "firebase/database";
import { chromium } from "playwright";
import { loadRules, allowBox } from "./rules-loader.js";

const ROOT = new URL("..", import.meta.url).pathname;
const PUBLIC = join(ROOT, "web/public");
const FIREBASE_JS = join(ROOT, "tests/node_modules/firebase");
const CODE = "FANTO";
const HOST = "box";
const testConfig = JSON.stringify({
  apiKey: "demo-key", authDomain: "demo-lmp.firebaseapp.com",
  databaseURL: "https://demo-lmp.firebaseio.com", projectId: "demo-lmp", appId: "demo",
});
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const COULEURS = ["#FF6B1A", "#39FF14", "#FF2D95", "#FFE600", "#2B86C5"];

let env, server, browser, baseUrl;

before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-lmp", database: { rules: loadRules(), host: "127.0.0.1", port: 9000 } });
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/firebase-config.json") return res.end(testConfig);
    const file = normalize(join(PUBLIC, path));
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
  await set(ref(hostDb(), `games/${CODE}`), {
    hostUid: HOST, regieActive: true, public: { title: "Anniversaire test", childName: "Touktouka" },
    state: { phase: "lobby", seq: 1, round: 1, scores: {} },
  });
});

const hostDb = () => env.authenticatedContext(HOST).database();
const hostState = (state) => set(ref(hostDb(), `games/${CODE}/state`), { seq: 2, round: 1, scores: {}, paused: false, ...state });
const read = async (path) => (await get(ref(hostDb(), `games/${CODE}/${path}`))).val();

async function waitFor(fn, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Délai dépassé : ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** La page des fantômes, réglée sur [nombre] fantômes, en vitesse rapide ; [auto] = mot de passe régie. */
async function ouvrirFantomes(nombre, auto = null) {
  const context = await browser.newContext();
  await context.route("https://www.gstatic.com/firebasejs/11.1.0/*", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    route.fulfill({ path: join(FIREBASE_JS, name), contentType: "text/javascript" });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("Erreur page :", e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${baseUrl}/fantomes.html?g=${CODE}&emu=1`);
  await page.selectOption("#nombre", String(nombre));
  await page.selectOption("#vitesse", "rapide");
  if (auto) {
    await page.check("#auto");
    await page.fill("#mdp", auto);
    // Le petit œil montre le mot de passe tapé, puis le masque à nouveau.
    const oeil = page.locator(".oeil-champ:has(#mdp) .oeil-bouton");
    assert.equal(await oeil.getAttribute("aria-label"), "Afficher le mot de passe");
    await oeil.click();
    assert.equal(await page.getAttribute("#mdp", "type"), "text");
    await oeil.click();
    assert.equal(await page.getAttribute("#mdp", "type"), "password");
  }
  await page.click("#lancer");
  return page;
}

/** La box fait entrer chaque tablette qui le demande (comme après « ✓ Accepter » sur le téléphone). */
async function admettreTout(nombre) {
  const demandes = await waitFor(async () => {
    const d = (await read("joinRequests")) ?? {};
    return Object.keys(d).length >= nombre && d;
  }, `${nombre} demandes d'entrée`);
  const maj = {};
  Object.keys(demandes).forEach((uid, i) => {
    maj[`teams/${uid}`] = { name: `Fantôme ${i + 1}`, color: COULEURS[i], joinedAt: Date.now() };
    maj[`joinRequests/${uid}`] = null;
  });
  await update(ref(hostDb(), `games/${CODE}`), maj);
  await waitFor(async () => Object.values((await read("presence")) ?? {}).filter((p) => p.online).length >= nombre, "fantômes en ligne");
  return Object.keys(demandes);
}

describe("équipes fantômes", () => {
  /** La TV termine la partie (« Fin de la fête ») et ouvre la suivante : [suite] existe, l'ancienne pointe vers elle. */
  async function finDeFeteVers(suite) {
    await set(ref(hostDb(), `games/${suite}`), {
      hostUid: HOST, regieActive: true, public: { title: "Nouvelle fête" },
      state: { phase: "lobby", seq: 1, round: 1, scores: {} },
    });
    await update(ref(hostDb(), `games/${CODE}/state`), { phase: "ended", endedAt: Date.now(), leftAt: Date.now(), suite });
  }
  const lireSuite = async (suite, path) => (await get(ref(hostDb(), `games/${suite}/${path}`))).val();

  test("fin de la fête : les fantômes ne suivent JAMAIS la nouvelle partie tout seuls (cedric, 1/11)", async () => {
    const page = await ouvrirFantomes(2);
    try {
      await admettreTout(2);
      await finDeFeteVers("SUITE1");
      await waitFor(async () => (await page.evaluate(() => window.fantomes().map((f) => f.statut))).every((t) => t.startsWith("partie terminée")),
        "les fantômes s'arrêtent à la fin de la partie");
      await new Promise((r) => setTimeout(r, 2500));
      assert.equal(await lireSuite("SUITE1", "joinRequests"), null, "aucune demande d'entrée dans la nouvelle partie");
      assert.equal(await lireSuite("SUITE1", "teams"), null, "aucune équipe fantôme dans la nouvelle partie");
      assert.equal(await page.inputValue("#code"), CODE, "le code tapé ne change pas tout seul");
    } finally {
      await page.context().close();
    }
  });

  test("« Arrêter les fantômes » puis fin de la fête et nouvelle partie : aucun robot nulle part, même une demande en attente", async () => {
    const page = await ouvrirFantomes(2);
    try {
      // Les deux fantômes demandent à entrer, personne ne les a encore acceptés.
      await waitFor(async () => Object.keys((await read("joinRequests")) ?? {}).length >= 2, "2 demandes d'entrée");
      await page.click("#arreter");
      await waitFor(async () => (await read("joinRequests")) === null, "les demandes en attente sont retirées");
      await finDeFeteVers("SUITE2");
      await new Promise((r) => setTimeout(r, 2500));
      assert.equal(await read("teams"), null, "aucune équipe fantôme dans l'ancienne partie");
      assert.equal(await lireSuite("SUITE2", "joinRequests"), null, "aucune demande dans la nouvelle partie");
      assert.equal(await lireSuite("SUITE2", "teams"), null, "aucune équipe fantôme dans la nouvelle partie");
      assert.ok((await page.evaluate(() => window.fantomes().length)) === 0, "plus aucun fantôme sur la page");
    } finally {
      await page.context().close();
    }
  });

  test("3 fantômes entrent, répondent au quiz, buzzent, gonflent, se passent la bombe, ouvrent un coffre et dessinent", async () => {
    const page = await ouvrirFantomes(3);
    const ids = await admettreTout(3);
    const [a, b, c] = ids;

    // Quiz : les fantômes répondent avant la fin du chrono (une réponse par équipe au plus).
    await hostState({ phase: "question", kind: "classic", qid: "q1", choices: ["A", "B", "C", "D"], deadline: Date.now() + 20000 });
    await waitFor(async () => Object.keys((await read("answers/q1")) ?? {}).length >= 2, "réponses au quiz");
    // Juste chiffre : un nombre entier.
    await hostState({ phase: "question", kind: "number", qid: "q2", choices: null, deadline: Date.now() + 20000 });
    const nombres = await waitFor(async () => { const r = await read("answers/q2"); return r && Object.keys(r).length >= 2 && r; }, "réponses au juste chiffre");
    assert.ok(Object.values(nombres).every((r) => Number.isInteger(r.choice)));

    // Image floue : un buzz (le premier gagne), sur un ou plusieurs tours.
    let buzz = null;
    for (let round = 2; round < 6 && !buzz; round++) {
      await hostState({ phase: "question", kind: "flou", qid: `f${round}`, round, buzzOpen: true, choices: null, deadline: null });
      buzz = await waitFor(() => read(`buzz/${round}`), "buzz", 6000).catch(() => null);
    }
    assert.ok(ids.includes(buzz?.team), "un fantôme a buzzé");

    // Gonfleur fou : les tapes arrivent, jamais plus que le plafond des règles.
    const goAt = Date.now();
    await hostState({ phase: "question", kind: "gonfleur", qid: "g1", choices: null, deadline: goAt + 45000, pump: { key: "gf-1", goAt, target: 30 } });
    await waitFor(async () => Object.keys((await read("pumps/gf-1")) ?? {}).length === 3, "tapes des 3 ballons");

    // Ça va exploser ! : le fantôme qui tient la bombe l'envoie à une équipe permise.
    let now = Date.now();
    await hostState({ phase: "question", kind: "patate", qid: "pt", choices: null, deadline: null,
      potato: { lit: true, teams: ids, canReturn: false, passes: 0, from: null, holder: a, since: now - 3000, readyAt: now - 1000, targets: [b, c], hit: [a], key: "pt-a" } });
    const passe = await waitFor(() => read("potatoPass/pt-a"), "bombe envoyée");
    assert.ok([b, c].includes(passe.to));

    // Coffres mystères : le fantôme dont c'est le tour ouvre un coffre.
    await hostState({ phase: "question", kind: "coffres", qid: "bc", choices: null, deadline: null,
      chests: { ready: true, count: 10, order: [b, c], safe: 6, danger: false, exploded: false, opened: [{ chest: 3, team: c, at: now }], gains: {}, team: b, turn: 0, safeLeft: 6, key: "bc-1-0", readyAt: Date.now() - 1000 } });
    const coffre = await waitFor(() => read("chestChoice/bc-1-0"), "coffre choisi");
    assert.notEqual(coffre.i, 3, "jamais un coffre déjà ouvert");

    // Pictionary : le dessinateur fantôme choisit son mot, puis dessine.
    const picto = (mime, extra = {}) => hostState({ phase: "question", qid: "r1p", kind: "pictionary", choices: null, deadline: null,
      mime: { team: null, found: 0, passed: 0, left: 10, turns: [], counts: {}, points: 150, ...mime }, ...extra });
    const offer = [{ word: "Soleil", image: "☀️" }, { word: "Maison", image: "🏠" }, { word: "Bateau", image: "⛵" }];
    await picto({ secret: c, offer, chosen: null, pickKey: "r1p-100" });
    await waitFor(() => read("pictoChoice/r1p-100"), "mot choisi");
    await picto({ team: c, card: offer[1], drawKey: "r1p-200", turns: [c] }, { deadline: Date.now() + 60000 });
    await waitFor(async () => Object.keys((await read("drawing/r1p-200")) ?? {}).length >= 2, "traits du dessin");

    // Pause : plus rien ne part.
    await hostState({ phase: "question", kind: "classic", qid: "q9", choices: ["A", "B"], deadline: Date.now() + 20000, paused: true });
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(await read("answers/q9"), null, "aucune réponse pendant la pause");

    // « Couper le wifi » sur un fantôme : la TV le voit hors ligne, puis de retour.
    const premier = await page.evaluate(() => window.fantomes()[0].teamId);
    await page.locator("#fantomes tr").first().locator("button").click();
    await waitFor(async () => (await read(`presence/${premier}`))?.online === false, "fantôme hors ligne");
    await page.locator("#fantomes tr").first().locator("button").click();
    await waitFor(async () => (await read(`presence/${premier}`))?.online === true, "fantôme de retour");

    // Arrêter : toutes les équipes fantômes passent hors ligne.
    await page.click("#arreter");
    await waitFor(async () => Object.values((await read("presence")) ?? {}).every((p) => !p.online), "fantômes hors ligne");
    await page.context().close();
  });

  test("avec le mot de passe régie, les fantômes entrent tout seuls (commande admit, comme le téléphone)", async () => {
    const SALT = "0123456789abcdef0123";
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), "settings/regie"),
      { salt: SALT, hash: createHash("sha256").update(`${SALT}:licorne42`).digest("hex"), updatedAt: Date.now() }));
    // La box : chaque commande « admit » crée l'équipe et répond « applied ».
    const stop = onChildAdded(ref(hostDb(), `games/${CODE}/commands`), async (s) => {
      const cmd = s.val();
      if (cmd.type !== "admit") return;
      const n = Object.keys((await read("teams")) ?? {}).length;
      await update(ref(hostDb(), `games/${CODE}`), {
        [`teams/${cmd.device}`]: { name: cmd.name, color: COULEURS[n], joinedAt: Date.now() },
        [`joinRequests/${cmd.device}`]: null,
        [`commandStatus/${s.key}`]: { status: "applied", at: Date.now() },
      });
    });
    const page = await ouvrirFantomes(2, "licorne 42");
    await waitFor(async () => Object.values((await read("presence")) ?? {}).filter((p) => p.online).length === 2, "2 fantômes entrés seuls", 25000);
    const noms = Object.values(await read("teams")).map((t) => t.name).sort();
    assert.deepEqual(noms, ["Fantôme 1", "Fantôme 2"]);
    stop();

    // 🤠 Duel des robots (vu le 27/10 au soir : les fantômes ne tiraient jamais) : avec le mot de passe régie, la page
    // lit l'heure secrète du PAN dans le journal de la box, et chaque fantôme du duel tire autour du PAN.
    const ids = Object.keys(await read("teams"));
    const panAt = Date.now() + 2500;
    await set(ref(hostDb(), `games/${CODE}/log/7`), { seq: 7, at: Date.now(), type: "duel_start", qid: "d1", n: 1, panAt });
    await hostState({ phase: "question", kind: "duel", qid: "d1", choices: null, deadline: null,
      duel: { n: 1, total: 1, teams: ids, players: [1, 1], step: "standoff", key: "d1-1-1" } });
    const tirs = await waitFor(async () => { const t = await read("duel/d1-1-1"); return t && Object.keys(t).length === 2 && t; }, "les 2 fantômes tirent", 15000);
    for (const tir of Object.values(tirs)) {
      assert.ok(Math.abs(tir.t - panAt) < 7000, `tir près du PAN (écart ${tir.t - panAt} ms)`);
    }

    // 🔴 Simon de Buzzy : la suite secrète est dans le journal dès le début du tour ; chaque joueur fantôme la tape,
    // élément par élément, puis valide avant la fin du chrono (une fois sur dix il se trompe d'un élément).
    await set(ref(hostDb(), `games/${CODE}/log/8`), { seq: 8, at: Date.now(), type: "simon_tour", qid: "s1", tour: 1, sequence: "rouge,vert,bleu,jaune,4", teams: ids });
    const debut = Date.now();
    await hostState({ phase: "question", kind: "simon", qid: "s1", choices: null, deadline: null,
      simon: { tour: 1, tours: 3, suite: 3, step: "play", key: "s1-1-3-1", startAt: debut, montreAt: debut, reponseAt: debut, finAt: debut + 12000,
        chiffres: false, teams: ids, players: Object.fromEntries(ids.map((id) => [id, 1])) } });
    const suites = await waitFor(async () => {
      const r = await read("simon/s1-1-3-1");
      return r && Object.values(r).filter((x) => x.ok === true).length === 2 && r;
    }, "les 2 fantômes valident leur suite", 15000);
    for (const r of Object.values(suites)) {
      const items = r.items.split(",");
      assert.equal(items.length, 3, "autant d'éléments que la suite");
      assert.ok(items.filter((x, k) => x === ["rouge", "vert", "bleu"][k]).length >= 2, `suite ${r.items} presque juste`);
    }
    // Plus de case « ne se trompent jamais » (cedric, 1/11 : capacités humaines normales).
    assert.equal(await page.locator("#simon-fort").count(), 0);

    // Pendant la pause, aucun tir.
    await hostState({ phase: "question", kind: "duel", qid: "d1", choices: null, deadline: null, paused: true,
      duel: { n: 2, total: 2, teams: ids, players: [2, 2], step: "standoff", key: "d1-2-1" } });
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(await read("duel/d1-2-1"), null, "aucun tir pendant la pause");
    await page.context().close();
  });
});
