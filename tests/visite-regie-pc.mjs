// Visite de la Régie PC en images : chaque écran (accueil, prestations, chaque jeu et ses onglets, bibliothèques,
// paramètres) en capture d'écran, avec les prestations de test, pour relire l'interface d'un coup d'œil.
// Pas un test : rien n'est vérifié. Les erreurs de la page sont listées à la fin.
// cd tests && npx firebase emulators:exec --project demo-lmp --only database,auth "node visite-regie-pc.mjs <dossier>"
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { chromium } from "playwright";
import { loadRules, seedAdmin, ADMIN_PASSWORD } from "./rules-loader.js";

const OUT = process.argv[2] ?? "visite";
const COURTE = process.env.COURTE === "1";
const LARGEUR = Number(process.env.LARGEUR) || 1440;
const HAUTEUR = Number(process.env.HAUTEUR) || 900;
mkdirSync(OUT, { recursive: true });
const ROOT = new URL("..", import.meta.url).pathname;
const PUBLIC = join(ROOT, "web/public");
const FIREBASE_JS = join(ROOT, "tests/node_modules/firebase");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon" };
const config = JSON.stringify({ apiKey: "demo-key", authDomain: "demo-lmp.firebaseapp.com", databaseURL: "https://demo-lmp.firebaseio.com", projectId: "demo-lmp", appId: "demo" });

const env = await initializeTestEnvironment({ projectId: "demo-lmp", database: { rules: loadRules(), host: "127.0.0.1", port: 9000 } });
await seedAdmin(env);
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/firebase-config.json") return res.end(config);
  const file = normalize(join(PUBLIC, path === "/" ? "index.html" : path));
  if (!file.startsWith(PUBLIC) || !existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: LARGEUR, height: HAUTEUR } });
await context.route("https://www.gstatic.com/firebasejs/11.1.0/*", (route) => {
  route.fulfill({ path: join(FIREBASE_JS, new URL(route.request().url()).pathname.split("/").pop()), contentType: "text/javascript" });
});
const page = await context.newPage();
const erreurs = [];
page.on("pageerror", (e) => erreurs.push(`page : ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/version\.json|404/.test(m.text())) erreurs.push(`console : ${m.text()}`); });

let n = 0;
const capture = async (nom) => {
  await page.waitForTimeout(400);
  const fichier = join(OUT, `${String(++n).padStart(2, "0")}-${nom}.png`);
  await page.screenshot({ path: fichier, fullPage: true });
  console.log(fichier);
};
const ecran = async (id) => {
  await page.click(`#nav button[data-screen=${id}]`);
  await page.locator(`#screen-${id}:not([hidden])`).waitFor();
};

await page.goto(`${base}/admin.html?emu=1`);
await page.fill("#admin-password", ADMIN_PASSWORD);
await page.click("#login");
await page.locator("#screen-home:not([hidden])").waitFor();
// Les deux prestations de test, comme Sarah les ajoute depuis les paramètres.
await ecran("settings");
for (const id of ["test-create", "test-full-create"]) {
  await page.click(`#${id}`);
  await page.locator(`#${id.replace("create", "status")}`).filter({ hasText: /Ajoutée|Mise à jour|déjà/ }).waitFor({ timeout: 60000 }).catch(() => {});
}
await capture("parametres");
await ecran("home");
await capture("accueil");
await ecran("shows");
await capture("prestations");
const prestations = await page.locator("#screen-shows .show-card").count();
for (let k = 0; k < Math.min(prestations, 2); k++) {
  await ecran("shows");
  await page.locator("#screen-shows .show-card").nth(k).getByRole("button", { name: "Ouvrir" }).click();
  await page.locator("#screen-show-edit:not([hidden])").waitFor({ timeout: 5000 }).catch(() => {});
  await capture(`prestation-${k + 1}`);
}
if (COURTE) { await browser.close(); server.close(); await env.cleanup(); process.exit(0); }
await ecran("games");
await capture("jeux");
await ecran("home");
const jeux = await page.locator("#screen-home .tile[data-game]").evaluateAll((els) => els.map((e) => e.dataset.game));
for (const jeu of jeux) {
  await ecran("home");
  await page.locator(`#screen-home .tile[data-game="${jeu}"]`).click();
  await page.waitForTimeout(300);
  const visible = await page.locator(".screen:not([hidden])").first().getAttribute("id");
  await capture(`jeu-${jeu}`);
  if (visible === "screen-game") {
    const onglets = await page.locator("#game-tabs button").count();
    // L'éditeur d'une nouvelle manche.
    await page.click("#manche-new");
    await capture(`jeu-${jeu}-nouvelle-manche`);
    await ecran("home");
    await page.locator(`#screen-home .tile[data-game="${jeu}"]`).click();
    for (let k = 1; k < onglets; k++) {
      await page.locator("#game-tabs button").nth(k).click();
      await page.locator("#banque-galerie:not([hidden]) summary").click({ timeout: 1000 }).catch(() => {});
      await capture(`jeu-${jeu}-onglet-${k + 1}`);
    }
  }
}
console.log(erreurs.length ? `Erreurs :\n${[...new Set(erreurs)].join("\n")}` : "Aucune erreur dans la page.");
await browser.close();
server.close();
await env.cleanup();
