// Banque des tout-petits : cherche, pour chaque mot, quelques photos du domaine public (CC0 ou « Public Domain
// Mark ») dans Openverse, puis Wikimedia Commons pour compléter, les recadre en carré 480 px (moins de 45 Ko, la
// taille des vignettes de réponse) et prépare des planches pour choisir la meilleure.
// MOTS=chat,chien node scripts/banque-photos.mjs : seulement ces mots (clés), pour refaire ceux qui sont ratés.
// Lancé par .github/workflows/banque-photos.yml (le conteneur de développement n'a pas accès à ces sites).
// Sortie : banque-candidats/<clé>-<n>.jpg, banque-candidats/sources.json, banque-candidats/planche-<k>.jpg.
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { BANQUE_MOTS } from "../web/public/banque-petits.js";

const OUT = "banque-candidats";
const PAR_MOT = 4;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

let openverseRefuse = false;

async function json(url, essais = 6) {
  for (let essai = 0; essai < essais; essai++) {
    const res = await fetch(url, { headers: { "User-Agent": "little-miss-party-quiz/1.0 (banque d'images pour enfants; https://github.com/cedricberg-max/Little-Miss-Party-Quiz)" } });
    if (res.status === 429) { await pause(15000 * (essai + 1)); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }
  throw new Error(`Trop de refus : ${url}`);
}

/** Openverse : photos CC0 ou domaine public. Après trop de refus (quota du jour), on passe à Commons seul. */
async function openverse(recherche) {
  if (openverseRefuse) return [];
  const q = new URLSearchParams({ q: recherche, license: "cc0,pdm", category: "photograph", mature: "false", page_size: "12" });
  try {
    const r = (await json(`https://api.openverse.org/v1/images/?${q}`, 3)).results ?? [];
    return r.filter((x) => (x.width ?? 0) >= 400 && (x.height ?? 0) >= 300 && Math.max(x.width, x.height) / Math.min(x.width, x.height) <= 2.2)
      .map((x) => ({ urls: [x.thumbnail, x.url].filter(Boolean), titre: x.title, auteur: x.creator, licence: `${x.license} ${x.license_version ?? ""}`.trim(), page: x.foreign_landing_url, source: `openverse/${x.source}` }));
  } catch (e) {
    if (/Trop de refus/.test(e.message)) openverseRefuse = true;
    console.warn("openverse", recherche, e.message);
    return [];
  }
}

/** Wikimedia Commons : fichiers dont la licence est le domaine public ou CC0, en vignette de 640 px. */
async function commons(recherche) {
  const q = new URLSearchParams({
    action: "query", format: "json", generator: "search", gsrnamespace: "6", gsrsearch: `${recherche} filetype:bitmap`, gsrlimit: "30",
    prop: "imageinfo", iiprop: "url|extmetadata|size", iiurlwidth: "640",
  });
  try {
    const pages = Object.values((await json(`https://commons.wikimedia.org/w/api.php?${q}`)).query?.pages ?? {}).sort((a, b) => a.index - b.index);
    return pages.flatMap((p) => {
      const ii = p.imageinfo?.[0];
      const licence = ii?.extmetadata?.LicenseShortName?.value ?? "";
      if (!ii?.thumburl || !/public domain|^pd|cc0/i.test(licence)) return [];
      if (ii.width < 400 || ii.height < 300 || Math.max(ii.width, ii.height) / Math.min(ii.width, ii.height) > 2.2) return [];
      const auteur = (ii.extmetadata?.Artist?.value ?? "").replace(/<[^>]+>/g, "").trim();
      return [{ urls: [ii.thumburl], titre: p.title, auteur, licence, page: ii.descriptionurl, source: "commons" }];
    });
  } catch (e) {
    console.warn("commons", recherche, e.message);
    return [];
  }
}

async function telecharger(url, fichier) {
  for (let essai = 0; essai < 3; essai++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "little-miss-party-quiz" }, redirect: "follow" });
      if (res.status === 429) { await pause(10000); continue; }
      if (!res.ok) return false;
      await writeFile(fichier, Buffer.from(await res.arrayBuffer()));
      return true;
    } catch { await pause(2000); }
  }
  return false;
}

await mkdir(OUT, { recursive: true });
const seulement = new Set((process.env.MOTS ?? "").split(",").map((x) => x.trim()).filter(Boolean));
const MOTS = BANQUE_MOTS.filter((m) => !seulement.size || seulement.has(m.cle));
const sources = {};
const manquants = [];
for (const m of MOTS) {
  let candidats = await openverse(m.recherche);
  if (candidats.length < PAR_MOT + 2) candidats = [...candidats, ...(await commons(m.recherche))];
  sources[m.cle] = [];
  let n = 0;
  for (const r of candidats) {
    if (n >= PAR_MOT) break;
    const brut = `${OUT}/${m.cle}-${n + 1}.orig`;
    let ok = false;
    for (const url of r.urls) if (!ok) ok = await telecharger(url, brut);
    if (!ok) continue;
    try {
      // Carré 480 px, JPEG sous 45 Ko (comme une vignette de réponse rangée par la Régie PC).
      execFileSync("convert", [`${brut}[0]`, "-auto-orient", "-resize", "480x480^", "-gravity", "center", "-extent", "480x480", "-strip",
        "-define", "jpeg:extent=44kb", `${OUT}/${m.cle}-${n + 1}.jpg`]);
    } catch {
      continue;
    }
    n++;
    sources[m.cle].push({ n, titre: r.titre, auteur: r.auteur, licence: r.licence, page: r.page, source: r.source });
    await pause(300);
  }
  if (!n) manquants.push(m.mot);
  console.log(`${m.mot} : ${n} photo(s)`);
  await pause(openverseRefuse ? 600 : 3000);
}
await writeFile(`${OUT}/sources.json`, JSON.stringify({ manquants, sources }, null, 1));

// Planches : 10 mots par planche, une ligne par mot (ses candidates numérotées).
const parPlanche = 10;
for (let k = 0; k * parPlanche < MOTS.length; k++) {
  const fichiers = [];
  for (const m of MOTS.slice(k * parPlanche, (k + 1) * parPlanche)) {
    for (let n = 1; n <= PAR_MOT; n++) {
      const f = `${OUT}/${m.cle}-${n}.jpg`;
      fichiers.push("-label", `${m.cle} ${n}`, (sources[m.cle] ?? []).some((s) => s.n === n) ? f : "xc:white");
    }
  }
  execFileSync("montage", [...fichiers, "-tile", `${PAR_MOT}x`, "-geometry", "180x180+4+4", "-pointsize", "14", `${OUT}/planche-${String(k + 1).padStart(2, "0")}.jpg`]);
}
console.log(`Manquants : ${manquants.join(", ") || "aucun"}`);
