// État de la dernière partie d'une box (ou de la partie [code]), en lecture seule : prestation chargée ou quiz de
// démonstration, intros, phase, nombre d'équipes. Le dépôt est public : aucun nom (ni équipe, ni prestation, ni enfant).
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
  console.log(`${codes.length} parties ; la plus récente : box vue ${new Date(vus[0]?.[1] ?? 0).toISOString()}`);
}
const c = (await get(`games/${code}/conducteur`)) ?? {};
const st = (await get(`games/${code}/state`)) ?? {};
const teams = Object.keys((await get(`games/${code}/teams`, "&shallow=true")) ?? {}).length;
const cherche = (process.env.MOT || "").trim().toLowerCase();
console.log(`Conducteur : ${c.id === "demo" ? "QUIZ DE DÉMONSTRATION" : c.id ? "prestation chargée" : "aucun"}, intros ${c.intros === true ? "oui" : "non"}, ${c.rounds?.length ?? "?"} jeux`);
if (cherche) console.log(`Titre contient le mot cherché : ${String(c.title ?? "").toLowerCase().includes(cherche) ? "oui" : "non"}`);
console.log(`Phase ${st.phase ?? "?"}, question ${st.index ?? "?"}, ${teams} équipes, pause ${st.paused === true ? "oui" : "non"}`);
const equipes = (await get(`games/${code}/teams`)) ?? {};
const presence = (await get(`games/${code}/presence`)) ?? {};
const ordre = Object.entries(equipes).sort((a, b) => (a[1]?.joinedAt ?? 0) - (b[1]?.joinedAt ?? 0)).map(([id]) => id);
const iso = (t) => (typeof t === "number" ? new Date(t).toISOString().slice(11, 19) + "Z" : "?");
const reponses = (await get(`games/${code}/answers`)) ?? {};
ordre.forEach((id, i) => {
  const n = Object.values(reponses).filter((q) => q && q[id]).length;
  console.log(`Équipe ${i + 1} : entrée ${iso(equipes[id]?.joinedAt)}, en ligne ${presence[id]?.online === true ? "oui" : "non"}, appareil ${equipes[id]?.device ? (equipes[id].device === id ? "le sien" : "autre") : "-"}, ${n} réponses`);
});
console.log(`Question en cours ${st.qid ?? "?"} (${st.kind ?? "?"}), fin du chrono ${iso(st.deadline)}, maintenant ${iso(Date.now())}`);
for (const [qid, rs] of Object.entries(reponses)) {
  console.log(`Réponses ${qid} : ${Object.keys(rs ?? {}).map((id) => `équipe ${ordre.indexOf(id) + 1} à ${iso(rs[id]?.at)}`).join(", ")}`);
}
const log = Object.values((await get(`games/${code}/log`, '&orderBy="$key"&limitToLast=40')) ?? {}).sort((a, b) => a.seq - b.seq);
for (const e of log) console.log(`journal ${iso(e.at)} ${e.type}${e.qid ? ` ${e.qid}` : ""}${e.team ? ` équipe ${ordre.indexOf(e.team) + 1}` : ""}`);
const cmds = Object.entries((await get(`games/${code}/commands`, '&orderBy="$key"&limitToLast=60')) ?? {});
const statuts = (await get(`games/${code}/commandStatus`)) ?? {};
const regies = Object.keys((await get(`games/${code}/regie`, "&shallow=true")) ?? {});
for (const [k, c] of cmds.sort((a, b) => (a[1]?.at ?? 0) - (b[1]?.at ?? 0))) {
  const s = statuts[k];
  console.log(`commande ${iso(c?.at)} ${c?.type} seq ${c?.expectSeq} régie ${regies.indexOf(c?.by) + 1 || "?"} → ${s?.status ?? "-"}${s?.reason ? ` (${s.reason})` : ""}`);
}
