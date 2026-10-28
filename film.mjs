// node film.mjs <shot> <dossier> <w> <h> <nb images> [u0] [u1]  → images 00000.png… ; une seule page par plan
import { createServer } from "node:http"; import { createReadStream, existsSync, mkdirSync } from "node:fs"; import { extname, join, normalize } from "node:path"; import { chromium } from "playwright";
const DIR = process.cwd(); const [shot, out, w, h, nb, u0 = "0", u1 = "1"] = process.argv.slice(2); mkdirSync(out, { recursive: true });
const srv = createServer((q, s) => { const f = normalize(join(DIR, decodeURIComponent(new URL(q.url, "http://x").pathname))); if (!f.startsWith(DIR) || !existsSync(f)) { s.statusCode = 404; return s.end(); } s.setHeader("Content-Type", { ".html": "text/html", ".js": "text/javascript" }[extname(f)] ?? "application/octet-stream"); createReadStream(f).pipe(s); });
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: +w, height: +h } }); p.on("pageerror", (e) => console.log("ERR", e.message));
await p.goto(`http://127.0.0.1:${srv.address().port}/outro3d.html?shot=${shot}&w=${w}&h=${h}${process.env.IMG ? "&img=" + process.env.IMG : ""}${process.env.Q ?? ""}`); await p.waitForFunction(() => window.PRET === true, null, { timeout: 300000 });
const N = +nb;
for (let i = 0; i < N; i++) { const u = N === 1 ? +u0 : +u0 + (+u1 - +u0) * i / (N - 1); await p.evaluate(async (u) => { if (window.prepSouv) await window.prepSouv(u); window.rend(u); }, u); await p.screenshot({ path: `${out}/${String(i).padStart(5, "0")}.png`, timeout: 240000 }); }
await b.close(); srv.close();
