// Banque des tout-petits : cherche, pour chaque mot, quelques photos du domaine public (CC0 ou « Public Domain
// Mark ») dans Openverse, puis Wikimedia Commons pour compléter, les recadre en carré 480 px (moins de 45 Ko, la
// taille des vignettes de réponse) et prépare des planches pour choisir la meilleure.
// MOTS=chat,chien node scripts/banque-photos.mjs : seulement ces mots (clés), pour refaire ceux qui sont ratés.
// LISTE=scripts/banque-quiz-recherches.json : une autre liste [{ cle, recherche }] (les photos de révélation du quiz
// classique tout prêt), en 640 × 480 (moins de 60 Ko) au lieu du carré. PARTIE=2/3 : seulement le 2e tiers de la liste
// (trois lots lancés en même temps).
// BUDGET_MIN=90 : au-delà, la recherche s'arrête et publie ce qu'elle a ; les mots restants sont listés (lot suivant).
// Lancé par .github/workflows/banque-photos.yml (le conteneur de développement n'a pas accès à ces sites).
// Sortie : banque-candidats/<clé>-<n>.jpg, banque-candidats/sources.json, banque-candidats/planche-<k>.jpg.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { BANQUE_MOTS } from "../web/public/banque-petits.js";

const OUT = "banque-candidats";
const PAR_MOT = Number(process.env.PAR_MOT) || 4;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// OPENVERSE=non : Commons seul. Sinon, Openverse est abandonné après 3 échecs de suite (quota, serveur saturé).
let openverseRefuse = process.env.OPENVERSE === "non";
let openverseEchecs = 0;
const DEBUT = Date.now();
const BUDGET_MS = (Number(process.env.BUDGET_MIN) || 90) * 60000;
const minutes = () => ((Date.now() - DEBUT) / 60000).toFixed(1);

async function json(url, essais = 3) {
  for (let essai = 0; essai < essais; essai++) {
    // 20 s au plus par requête : un serveur saturé (Openverse en 504 le 22/10) ne fige pas la recherche.
    const res = await fetch(url, { headers: { "User-Agent": "little-miss-party-quiz/1.0 (banque d'images pour enfants; https://github.com/cedricberg-max/Little-Miss-Party-Quiz)" }, signal: AbortSignal.timeout(20000) });
    // Quota dépassé : on attend un peu, sans jamais bloquer toute la recherche (budget de temps ci-dessous).
    if (res.status === 429) { console.warn(`429 (${minutes()} min) ${url.slice(0, 80)}`); await pause(8000 * (essai + 1)); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }
  throw new Error(`Trop de refus : ${url}`);
}

// Banques de photos soignées sous CC0 (photos de stock, bien cadrées) : cherchées d'abord, avant tout Openverse.
const SOURCES_SOIGNEES = "stocksnap,wordpress,nappy";
// Le titre ou les mots-clés doivent contenir un mot de la recherche : écarte les photos sans rapport.
const parle = (x, recherche) => {
  const texte = `${x.title ?? ""} ${(x.tags ?? []).map((t) => t.name).join(" ")}`.toLowerCase();
  return recherche.toLowerCase().split(/\s+/).some((mot) => mot.length > 2 && texte.includes(mot));
};

/** Openverse : photos CC0 ou domaine public. Après trop de refus (quota du jour), on passe à Commons seul. */
async function openverse(recherche, source = "") {
  if (openverseRefuse) return [];
  const q = new URLSearchParams({ q: recherche, license: "cc0,pdm", category: "photograph", mature: "false", page_size: "20", ...(source ? { source } : {}) });
  try {
    const r = (await json(`https://api.openverse.org/v1/images/?${q}`, 3)).results ?? [];
    openverseEchecs = 0;
    return r.filter((x) => parle(x, recherche))
      .filter((x) => (x.width ?? 0) >= 400 && (x.height ?? 0) >= 300 && Math.max(x.width, x.height) / Math.min(x.width, x.height) <= 2.2)
      .map((x) => ({ urls: [x.thumbnail, x.url].filter(Boolean), titre: x.title, auteur: x.creator, licence: `${x.license} ${x.license_version ?? ""}`.trim(), page: x.foreign_landing_url, source: `openverse/${x.source}` }));
  } catch (e) {
    if (/Trop de refus/.test(e.message) || ++openverseEchecs >= 3) openverseRefuse = true;
    console.warn("openverse", recherche, e.message, openverseRefuse ? "(Openverse abandonné : Commons seul)" : "");
    return [];
  }
}

/** Wikimedia Commons : fichiers dont la licence est le domaine public ou CC0, en vignette de 640 px. */
async function commons(recherche, filtre = "") {
  const q = new URLSearchParams({
    action: "query", format: "json", generator: "search", gsrnamespace: "6", gsrsearch: `${recherche} filetype:bitmap${filtre}`, gsrlimit: "30",
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
const LISTE = process.env.LISTE ? JSON.parse(await readFile(process.env.LISTE, "utf8")).map((x) => ({ mot: x.cle, ...x })) : BANQUE_MOTS;
const [partie, parties] = (process.env.PARTIE || "1/1").split("/").map(Number);
const taille = Math.ceil(LISTE.length / parties);
const MOTS = LISTE.slice((partie - 1) * taille, partie * taille).filter((m) => !seulement.size || seulement.has(m.cle));
// Carré 480 px sous 45 Ko (vignette de réponse) ; 640 × 480 sous 60 Ko pour une photo de révélation.
const [L, H, KO] = process.env.LISTE ? [640, 480, 60] : [480, 480, 44];
const sources = {};
const manquants = [];
const restants = [];
for (const m of MOTS) {
  if (Date.now() - DEBUT > BUDGET_MS) { restants.push(m.cle); continue; }
  // Assez de choix dans les seules banques soignées : on ne va pas plus loin (moins de requêtes, quotas des API).
  let candidats = await openverse(m.recherche, SOURCES_SOIGNEES);
  if (candidats.length < PAR_MOT + 2) candidats = [...candidats, ...(await openverse(m.recherche))];
  if (candidats.length < PAR_MOT + 2) candidats = [...candidats, ...(await commons(m.recherche))];
  // Sujets très photographiés (cygne, Tower Bridge…) : les 30 premiers résultats sont presque tous sous licence CC BY-SA ;
  // on cherche alors parmi les seuls fichiers déclarés CC0 ou domaine public (données structurées de Commons).
  if (candidats.length < PAR_MOT + 2) candidats = [...candidats, ...(await commons(m.recherche, " haswbstatement:P275=Q6938433|P6216=Q19652"))];
  candidats = candidats.filter((c, i) => candidats.findIndex((d) => d.page === c.page) === i);
  sources[m.cle] = [];
  let n = 0;
  for (const r of candidats) {
    if (n >= PAR_MOT) break;
    const brut = `${OUT}/${m.cle}-${n + 1}.orig`;
    let ok = false;
    for (const url of r.urls) if (!ok) ok = await telecharger(url, brut);
    if (!ok) continue;
    try {
      execFileSync("convert", [`${brut}[0]`, "-auto-orient", "-resize", `${L}x${H}^`, "-gravity", "center", "-extent", `${L}x${H}`, "-strip",
        "-define", `jpeg:extent=${KO}kb`, `${OUT}/${m.cle}-${n + 1}.jpg`]);
    } catch {
      continue;
    }
    n++;
    sources[m.cle].push({ n, titre: r.titre, auteur: r.auteur, licence: r.licence, page: r.page, source: r.source });
    await pause(300);
  }
  if (!n) manquants.push(m.mot);
  console.log(`${m.mot} : ${n} photo(s) (${minutes()} min)`);
  await pause(openverseRefuse ? 600 : 3000);
}
await writeFile(`${OUT}/sources.json`, JSON.stringify({ manquants, restants, sources }, null, 1));

// Planches : 10 mots par planche, une ligne par mot (ses candidates numérotées).
const parPlanche = 10;
const FAITS = MOTS.filter((m) => sources[m.cle]);
for (let k = 0; k * parPlanche < FAITS.length; k++) {
  const fichiers = [];
  for (const m of FAITS.slice(k * parPlanche, (k + 1) * parPlanche)) {
    for (let n = 1; n <= PAR_MOT; n++) {
      const f = `${OUT}/${m.cle}-${n}.jpg`;
      fichiers.push("-label", `${m.etiquette ?? m.cle} ${n}`, (sources[m.cle] ?? []).some((s) => s.n === n) ? f : "xc:white");
    }
  }
  execFileSync("montage", [...fichiers, "-tile", `${PAR_MOT}x`, "-geometry", `${Math.round((180 * L) / H)}x180+4+4`, "-pointsize", "14", `${OUT}/planche-${String(k + 1).padStart(2, "0")}.jpg`]);
}
console.log(`Manquants : ${manquants.join(", ") || "aucun"}`);
console.log(`Restants (lot suivant, entrée « mots ») : ${restants.join(",") || "aucun"}`);
