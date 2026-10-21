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
/** Les collections d'un jeu : sa tuile de l'accueil, puis l'onglet Collections de sa page. */
const collections = async (jeu) => {
  await ecran("home");
  await page.locator(`#screen-home .tile[data-game="${jeu}"]`).click();
  await page.click("#game-tabs [data-tab=collections]");
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
/** Une liste de prestations, ouverte par son compteur de l'Accueil (plus d'onglet Prestations). */
const liste = async (etat) => {
  await ecran("home");
  await page.click(`#screen-home [data-etat="${etat}"]`);
  await page.locator("#screen-shows:not([hidden])").waitFor();
};
for (const etat of ["avenir", "acompleter", "archivee"]) {
  await liste(etat);
  await capture(`prestations-${etat}`);
}
await liste("avenir");
const prestations = await page.locator("#screen-shows .show-card").count();
for (let k = 0; k < Math.min(prestations, 2); k++) {
  await liste("avenir");
  await page.locator("#screen-shows .show-card").nth(k).getByRole("button", { name: "Ouvrir" }).click();
  await page.locator("#screen-show-edit:not([hidden])").waitFor({ timeout: 5000 }).catch(() => {});
  await capture(`prestation-${k + 1}`);
}
const SEULS_AUTRES = process.env.AUTRES === "1";
if (COURTE) { await browser.close(); server.close(); await env.cleanup(); process.exit(0); }
// Bibliothèque : l'aperçu des images, chaque groupe, puis les sons.
await ecran("library");
await capture("bibliotheque-images");
for (const groupe of ["emojis", "photos", "miennes"]) {
  await page.click(`#media-groups [data-groupe="${groupe}"]`);
  await capture(`bibliotheque-${groupe}`);
}
await page.click('#library-tabs [data-lib-tab="sons"]');
await capture("bibliotheque-sons");
await page.click('#library-tabs [data-lib-tab="images"]');
await page.click('#media-groups [data-groupe="tout"]');
await ecran("home");
const jeux = SEULS_AUTRES ? [] : await page.locator("#screen-home .tile[data-game]").evaluateAll((els) => els.map((e) => e.dataset.game));
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
// Écrans d'édition : un quiz, la banque des tout-petits, la création d'un quiz, une playlist et le réglage d'une chanson.
const autres = [
  ["quiz-edition", async () => { await collections("quiz"); await page.locator("#quiz-list .item").first().getByRole("button", { name: "Éditer" }).click(); }],
  ["quiz-choisir-dans-la-bibliotheque", async () => { await collections("quiz"); await page.locator("#quiz-list .item").first().getByRole("button", { name: "Éditer" }).click(); await page.getByRole("button", { name: "🖼️ Bibliothèque…" }).first().click(); await page.locator(".choix-boite").waitFor(); }],
  ["banque-des-petits", async () => { await page.keyboard.press("Escape"); await collections("quiz"); await page.click("#banque-open"); }],
  ["creer-un-quiz", async () => { await collections("quiz"); await page.click("#quiz-import-open"); }],
  ["playlist-edition", async () => { await collections("blind"); await page.locator("#screen-music .item").first().getByRole("button", { name: "Éditer" }).click(); }],
  ["chanson-reglages", async () => { await ecran("library"); await page.click('#library-tabs [data-lib-tab="sons"]'); await page.locator("#song-list button", { hasText: "Régler…" }).first().click(); }],
  // Ses propres photos : un paquet de mimes et une famille de Qui a disparu ? (photos de la banque prises comme exemples).
  ["mimes-mes-photos", async () => {
    await ecran("home"); await page.click(".tile[data-screen=mimes]"); await page.click("#game-tabs [data-tab=collections]"); await page.click("#mime-new");
    await page.fill("#mime-title", "Les doudous de Léa");
    await page.locator("#mime-photos").setInputFiles(["chat", "ours", "koala"].map((m) => join(PUBLIC, "banque", `${m}.jpg`)));
    await page.locator("#mime-status", { hasText: "photos ajoutées" }).waitFor();
  }],
  ["disparu-mes-photos", async () => {
    await collections("disparu");
    await page.fill("#bi-theme", "Le panier de Léa");
    await page.locator("#bi-photos").setInputFiles(["pomme", "orange", "cerise", "melon", "ananas"].map((m) => join(PUBLIC, "banque", `${m}.jpg`)));
    await page.click("#builtin-add button[type=submit]");
    await page.locator("#builtin-status", { hasText: "est ajouté au jeu" }).waitFor();
  }],
];
for (const [nom, aller] of autres) {
  try { await aller(); await capture(nom); } catch (e) { erreurs.push(`visite ${nom} : ${e.message.split("\n")[0]}`); }
}
console.log(erreurs.length ? `Erreurs :\n${[...new Set(erreurs)].join("\n")}` : "Aucune erreur dans la page.");
await browser.close();
server.close();
await env.cleanup();
