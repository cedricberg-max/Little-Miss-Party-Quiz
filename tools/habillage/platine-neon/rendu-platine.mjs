// Rend intro.html image par image : node rendu.mjs <dossier> <sortie> w h debut secondes [fps] [pas]
// Avec "pas" = liste de temps séparés par des virgules au lieu de debut/secondes (images fixes).
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const [DIR, OUT, w, h, debut, sec, fpsArg, liste] = process.argv.slice(2);
mkdirSync(join(OUT, "c"), { recursive: true }); mkdirSync(join(OUT, "m"), { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".ttf": "font/ttf", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const f = normalize(join(DIR, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!existsSync(f)) { res.statusCode = 404; return res.end(); }
  res.setHeader("Content-Type", TYPES[extname(f)] ?? "application/octet-stream"); createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on("pageerror", (e) => console.log("ERR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${server.address().port}/${process.env.PAGE || "intro.html"}?w=${w}&h=${h}&${process.env.QS || ""}`);
await page.waitForFunction(() => window.PRET === true, null, { timeout: 60000 });
const FPS = +(fpsArg || 30);
const temps = liste ? liste.split(",").map(Number) : Array.from({ length: Math.round(+sec * FPS) }, (_, k) => +debut + k / FPS);
const t0 = Date.now();
for (const [k, t] of temps.entries()) {
  const nom = liste ? `s${String(k).padStart(2, "0")}.png` : `f${String(k).padStart(4, "0")}.png`;
  await page.evaluate((t) => window.frame(t, "c"), t); await page.screenshot({ timeout: 180000, path: join(OUT, "c", nom) });
  await page.evaluate((t) => window.frame(t, "m"), t); await page.screenshot({ timeout: 180000, path: join(OUT, "m", nom) });
  if (k % 15 === 0) console.log("image", k, "/", temps.length, ((Date.now() - t0) / 1000 / (k + 1)).toFixed(2), "s/img");
}
await browser.close(); server.close();
