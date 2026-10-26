// Journal de « Ça va exploser ! » de la dernière partie d'une box (ou de la partie [code]), en lecture seule.
// Le dépôt est public : aucun nom d'équipe, seulement « équipe 1, 2… » dans l'ordre d'arrivée, et les temps.
import { readFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";

const base = JSON.parse(readFileSync("firebase-config.json", "utf8")).databaseURL.replace(/\/$/, "");
const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/firebase.database", "https://www.googleapis.com/auth/userinfo.email"] });
const token = (await (await auth.getClient()).getAccessToken()).token;
const get = async (path, q = "") => (await fetch(`${base}/${path}.json?access_token=${token}${q}`)).json();

let code = (process.env.PARTIE || "").trim().toUpperCase();
if (!/^[A-Z0-9]{5}$/.test(code)) {
  const codes = Object.keys((await get("games", "&shallow=true")) ?? {});
  const vus = await Promise.all(codes.map(async (c) => [c, (await get(`games/${c}/hostOnline/at`)) ?? 0]));
  vus.sort((a, b) => b[1] - a[1]);
  code = vus[0]?.[0];
  console.log(`${codes.length} parties ; la plus récente : ${code} (box vue ${new Date(vus[0]?.[1] ?? 0).toISOString()})`);
}
const teams = (await get(`games/${code}/teams`)) ?? {};
const ordre = Object.entries(teams).sort((a, b) => (a[1]?.joinedAt ?? 0) - (b[1]?.joinedAt ?? 0)).map(([id]) => id);
const eq = (id) => (id == null ? "-" : `équipe ${ordre.indexOf(id) + 1}`);
const log = Object.values((await get(`games/${code}/log`)) ?? {}).sort((a, b) => a.seq - b.seq);
const potato = log.filter((e) => String(e.type).startsWith("potato"));
if (!potato.length) { console.log("Aucune bombe dans cette partie."); process.exit(0); }
const t0 = potato[0].at;
const s = (ms) => `${(ms / 1000).toFixed(2)} s`;
let go = null, recue = null;
for (const e of log.filter((e) => e.at >= t0 - 1000)) {
  const t = `+${s(e.at - t0).padStart(9)}`;
  if (e.type === "potato") {
    go = e.at + (e.bomb === 1 ? 3500 : 7000);
    recue = go;
    console.log(`${t}  BOMBE ${e.bomb} allumée chez ${eq(e.holder)}, mèche ${s(e.fuseMs)}, part à +${s(go - t0)}, ${e.teams?.length} équipes`);
  } else if (e.type === "potato_pass") {
    console.log(`${t}  envoi ${eq(e.from)} → ${eq(e.to)} (gardée ${s(e.at - recue)})`);
    recue = e.at;
  } else if (e.type === "potato_boom") {
    console.log(`${t}  BOUM chez ${eq(e.holder)} : ${s(e.at - go)} après le départ, gardée ${s(e.at - recue)} depuis la réception`);
  } else if (["pause", "paused", "resume", "resumed"].includes(e.type) || /paus|resum/.test(e.type)) {
    console.log(`${t}  ${e.type}${e.reason ? ` (${e.reason})` : ""}`);
  } else if (/open|jump|close|reveal|next/.test(e.type)) {
    console.log(`${t}  ${e.type}`);
  }
}
