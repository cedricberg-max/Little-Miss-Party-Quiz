// Icône et bannière Android TV « THE GAME SHOW » (cedric, 23/10), dessinées comme le logo néon
// (/mnt/project-files/the-game-show/logo/source/logo.html : mêmes polices, mêmes couleurs, mêmes lueurs).
//
// Usage, depuis la racine du dépôt : node --experimental-default-type=module tools/habillage/icone_tv_gs.mjs
// (Playwright est celui de tests/node_modules). Produit :
//   tv/src/main/res/drawable-xhdpi/banner.png            bannière 320×180 dp, avec la signature « by Little Miss Party »
//   tv/src/main/res/mipmap-xxxhdpi/ic_launcher_*.png     icône adaptative 108 dp : fond nuit + logo empilé dans le
//                                                        cercle sûr de 66 dp (THE / GAME / SHOW)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { chromium } = createRequire(join(RACINE, "tests", "package.json"))("playwright");
const RES = join(RACINE, "tv/src/main/res");
const data = (chemin, type) => `data:${type};base64,${readFileSync(chemin).toString("base64")}`;
const BUNGEE = data(join(RES, "font/lmp_gs_bungee.ttf"), "font/ttf");
const ORBITRON = data(join(RES, "font/lmp_gs_orbitron_black.ttf"), "font/ttf");
const RAJDHANI = data(join(RES, "font/lmp_gs_rajdhani_bold.ttf"), "font/ttf");
const LMP = data(join(RACINE, "tools/habillage/gs/logo-lmp.webp"), "image/webp");

// Échelle 1 = le logo de référence (GAME SHOW en 300 px) ; chaque rendu le dessine à sa taille finale, net.
const style = `
@font-face{font-family:Bungee;src:url(${BUNGEE})}
@font-face{font-family:Orbitron;src:url(${ORBITRON});font-weight:900}
@font-face{font-family:Rajdhani;src:url(${RAJDHANI});font-weight:700}
html,body{margin:0;background:transparent;overflow:hidden}
.scene{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}
.nuit{background:radial-gradient(ellipse at 50% 45%,#1d1238 0%,#0d0720 45%,#05010d 100%)}
.the{font-family:Orbitron;font-weight:900;color:#00f0ff;line-height:1;
  text-shadow:0 0 calc(10px*var(--k)) #00f0ff,0 0 calc(34px*var(--k)) #00f0ff,0 0 calc(70px*var(--k)) rgba(0,240,255,.5)}
.gs{position:relative;font-family:Bungee;line-height:1;letter-spacing:.02em;white-space:nowrap;text-align:center}
.gs .lueur{position:absolute;inset:0;color:#ff2d95;
  text-shadow:0 0 calc(8px*var(--k)) #ff5ab4,0 0 calc(30px*var(--k)) #ff2d95,0 0 calc(80px*var(--k)) #ff2d95,0 0 calc(150px*var(--k)) #8b2cff}
.gs .face{position:relative;background:linear-gradient(180deg,#ffd6ee 0%,#ff8fcb 30%,#ff4fae 62%,#ff2d95 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent}
.by{display:flex;align-items:center;font-family:Rajdhani;font-weight:700;color:rgba(244,241,255,.92);
  text-shadow:0 0 calc(18px*var(--k)) rgba(255,45,149,.55)}
.by img{filter:drop-shadow(0 0 calc(22px*var(--k)) rgba(255,45,149,.6))}
`;

/** Bannière : le logo signé, comme l'écran d'accueil de la TV (moment de présentation). */
const banniere = (w, h) => {
  const k = w / 2300; // le logo signé fait ~2200 px de large à l'échelle 1 : marge sur les côtés
  return `<div class="scene nuit" style="width:${w}px;height:${h}px;--k:${k}">
    <div class="the" style="font-size:${130 * k}px;letter-spacing:.55em;margin-right:-.55em">THE</div>
    <div class="gs" style="font-size:${300 * k}px;margin-top:${10 * k}px"><div class="lueur">GAME SHOW</div><div class="face">GAME SHOW</div></div>
    <div class="by" style="font-size:${96 * k}px;gap:${34 * k}px;margin-top:${32 * k}px">by <img src="${LMP}" style="height:${200 * k}px"></div>
  </div>`;
};

/** Premier plan de l'icône : THE / GAME / SHOW empilés, dans le cercle sûr (66 dp sur 108). */
const iconeFace = (c) => {
  const k = c / 1850;
  return `<div class="scene" style="width:${c}px;height:${c}px;--k:${k}">
    <div class="the" style="font-size:${150 * k}px;letter-spacing:.45em;margin-right:-.45em">THE</div>
    <div class="gs" style="font-size:${300 * k}px;margin-top:${26 * k}px"><div class="lueur">GAME</div><div class="face">GAME</div></div>
    <div class="gs" style="font-size:${300 * k}px;margin-top:${4 * k}px"><div class="lueur">SHOW</div><div class="face">SHOW</div></div>
  </div>`;
};
const iconeFond = (c) => `<div class="scene nuit" style="width:${c}px;height:${c}px"></div>`;

const navigateur = await chromium.launch();
const page = await navigateur.newPage({ viewport: { width: 1200, height: 800 } });
async function rendre(html, sortie, transparent) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".scene").screenshot({ path: sortie, omitBackground: transparent });
  console.log(sortie);
}
await rendre(banniere(640, 360), join(RES, "drawable-xhdpi/banner.png"), false);
await rendre(iconeFace(432), join(RES, "mipmap-xxxhdpi/ic_launcher_foreground.png"), true);
await rendre(iconeFond(432), join(RES, "mipmap-xxxhdpi/ic_launcher_background.png"), false);
await navigateur.close();
