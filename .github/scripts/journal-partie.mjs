// Journal complet d'une partie (la plus récente, ou le code donné dans PARTIE), en lecture seule, entre deux heures UTC
// facultatives (FENETRE « 22:00-22:20 »). Le dépôt est public : aucun nom d'équipe ni texte de question, seulement
// « équipe 1, 2… » dans l'ordre d'arrivée, les types d'événements, les heures et les nombres.
// Sert à retrouver le déroulé exact d'un moment signalé (buzz sans son, coupure de la régie, pause…).
import { readFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";

const base = JSON.parse(readFileSync("firebase-config.json", "utf8")).databaseURL.replace(/\/$/, "");
const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/firebase.database", "https://www.googleapis.com/auth/userinfo.email"] });
const token = (await (await auth.getClient()).getAccessToken()).token;
const get = async (path, q = "") => (await fetch(`${base}/${path}.json?access_token=${token}${q}`)).json();

let code = (process.env.PARTIE || "").trim().toUpperCase();
if (!/^[A-Z0-9]{4,6}$/.test(code)) {
  const codes = Object.keys((await get("games", "&shallow=true")) ?? {});
  const vus = await Promise.all(codes.map(async (c) => [c, (await get(`games/${c}/hostOnline/at`)) ?? 0]));
  vus.sort((a, b) => b[1] - a[1]);
  console.log(`${codes.length} parties ; les plus récentes : ${vus.slice(0, 4).map(([c, at]) => `${c} (${new Date(at).toISOString()})`).join(", ")}`);
  code = vus[0]?.[0];
}
console.log(`Partie ${code}`);
console.log(`Branches : ${Object.keys((await get(`games/${code}`, "&shallow=true")) ?? {}).join(", ")}`);

const teams = (await get(`games/${code}/teams`)) ?? {};
const ordre = Object.entries(teams).sort((a, b) => (a[1]?.joinedAt ?? 0) - (b[1]?.joinedAt ?? 0)).map(([id]) => id);
const eq = (id) => (ordre.includes(id) ? `équipe ${ordre.indexOf(id) + 1}` : id);
console.log(`${ordre.length} équipes : ${ordre.map((id, i) => `équipe ${i + 1}${teams[id]?.ghost || teams[id]?.fantome ? " (fantôme)" : ""}`).join(", ")}`);

const [de, a] = (process.env.FENETRE || "").split("-").map((s) => s.trim());
const jour = (at) => new Date(at).toISOString().slice(0, 10);
const dansFenetre = (at) => {
  if (!de && !a) return true;
  const h = new Date(at).toISOString().slice(11, 19);
  return (!de || h >= de.padEnd(8, ":00").slice(0, 8)) && (!a || h <= a.padEnd(8, ":00").slice(0, 8));
};
const heure = (at) => new Date(at).toISOString().slice(11, 23);
// Valeurs sans texte libre : nombres, booléens, identifiants d'équipe traduits, types et codes courts.
const propre = (k, v) => {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return ordre.includes(v) ? eq(v) : /^[a-z_]{1,24}$|^[A-Za-z0-9_-]{1,20}$/.test(v) && !/text|name|nom|label|title/i.test(k) ? v : "…";
  if (Array.isArray(v)) return v.map((x) => propre(k, x));
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).slice(0, 12).map(([kk, vv]) => [ordre.includes(kk) ? eq(kk) : kk, propre(kk, vv)]));
  return "…";
};

const log = Object.values((await get(`games/${code}/log`)) ?? {}).filter((e) => typeof e?.at === "number").sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0) || x.at - y.at);
console.log(`\n== Journal de la box (${log.length} événements${de || a ? `, de ${de || "début"} à ${a || "fin"} UTC` : ""}) ==`);
for (const e of log.filter((e) => dansFenetre(e.at))) {
  const { at, seq, type, ...reste } = e;
  console.log(`${jour(at)} ${heure(at)}  #${seq ?? "-"}  ${type}  ${JSON.stringify(propre("", reste))}`);
}

// Buzz reçus par la base (heure du serveur) : à comparer aux prises de parole du journal.
const buzz = (await get(`games/${code}/buzz`)) ?? {};
const lignes = Object.entries(buzz).filter(([, b]) => typeof b?.at === "number" && dansFenetre(b.at)).sort((x, y) => x[1].at - y[1].at);
console.log(`\n== Buzz écrits dans la base (${lignes.length}) ==`);
for (const [round, b] of lignes) console.log(`${heure(b.at)}  tour ${round}  ${eq(b.team)}  ${JSON.stringify(propre("", { ...b, at: undefined, team: undefined }))}`);

// Présences (box, régie, tablettes) : dernières heures vues.
for (const p of ["hostOnline", "regieOnline", "regie", "presence", "online"]) {
  const v = await get(`games/${code}/${p}`);
  if (v != null) console.log(`\n== ${p} ==\n${JSON.stringify(propre(p, v)).slice(0, 2000)}`);
}
const st = (await get(`games/${code}/state`)) ?? {};
console.log(`\n== État actuel ==\nphase ${st.phase}, index ${st.index}, kind ${st.kind}, paused ${st.paused}, buzzOpen ${st.buzzOpen}`);
