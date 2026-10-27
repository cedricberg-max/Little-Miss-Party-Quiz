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
