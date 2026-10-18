// Règles de sécurité Firebase : ce qu'un pupitre, la box ou un inconnu ont le droit de faire.
// Lancé par `npm test` dans l'émulateur Firebase, jamais sur la vraie base.
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { ref, get, set, update, serverTimestamp } from "firebase/database";

const HOST = "box";
const CODE = "ABCDE";
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-lmp",
    database: { rules: readFileSync(new URL("../database.rules.json", import.meta.url), "utf8"), host: "127.0.0.1", port: 9000 },
  });
});
after(() => env?.cleanup());
beforeEach(() => env.clearDatabase());

const db = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).database();

/** Prépare une partie avec deux équipes et une question ouverte, sans passer par les règles. */
async function seed(state = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(ctx.database(), `games/${CODE}`), {
      hostUid: HOST,
      teams: { rose: { name: "Les Roses", color: "#FF3CAC" }, bleu: { name: "Les Bleus", color: "#2B86C5" } },
      state: {
        phase: "question", qid: "q1", paused: false, choices: ["a", "b", "c", "d"],
        deadline: Date.now() + 20000, round: 1, buzzOpen: false, ...state,
      },
    });
  });
}

const answer = (uid, choice = 1, qid = "q1") =>
  set(ref(db(uid), `games/${CODE}/answers/${qid}/${uid}`), { choice, at: serverTimestamp() });

describe("lecture", () => {
  test("un inconnu sans connexion ne lit rien", async () => {
    await seed();
    await assertFails(get(ref(db(null), `games/${CODE}`)));
  });
  test("on ne peut pas lister toutes les parties", async () => {
    await seed();
    await assertFails(get(ref(db("rose"), "games")));
  });
  test("une équipe lit l'état, les équipes et le buzzer, pas le reste", async () => {
    await seed();
    await assertSucceeds(get(ref(db("rose"), `games/${CODE}/state`)));
    await assertSucceeds(get(ref(db("rose"), `games/${CODE}/teams`)));
    await assertSucceeds(get(ref(db("rose"), `games/${CODE}/buzz`)));
    await assertFails(get(ref(db("rose"), `games/${CODE}`)));
    await assertFails(get(ref(db("rose"), `games/${CODE}/log`)));
  });
  test("la box lit toute sa partie", async () => {
    await seed();
    await assertSucceeds(get(ref(db(HOST), `games/${CODE}`)));
  });
  test("une équipe voit sa propre réponse, pas celles des autres", async () => {
    await seed();
    await answer("rose", 1);
    await assertSucceeds(get(ref(db("rose"), `games/${CODE}/answers/q1/rose`)));
    await assertFails(get(ref(db("bleu"), `games/${CODE}/answers/q1/rose`)));
    await assertFails(get(ref(db("rose"), `games/${CODE}/answers/q1`)));
  });
});

describe("équipes", () => {
  test("rejoindre une partie existante", async () => {
    await seed();
    await assertSucceeds(set(ref(db("vert"), `games/${CODE}/teams/vert`), { name: "Les Verts", color: "#06D6A0" }));
  });
  test("impossible d'inscrire ou de renommer une autre équipe", async () => {
    await seed();
    await assertFails(set(ref(db("vert"), `games/${CODE}/teams/rose`), { name: "Piratée", color: "#000000" }));
  });
  test("nom vide ou trop long refusé", async () => {
    await seed();
    await assertFails(set(ref(db("vert"), `games/${CODE}/teams/vert`), { name: "", color: "#06D6A0" }));
    await assertFails(set(ref(db("vert"), `games/${CODE}/teams/vert`), { name: "x".repeat(21), color: "#06D6A0" }));
  });
  test("impossible de rejoindre une partie qui n'existe pas", async () => {
    await assertFails(set(ref(db("vert"), "games/ZZZZZ/teams/vert"), { name: "Les Verts", color: "#06D6A0" }));
  });
});

describe("pupitres : jamais de points ni de pilotage", () => {
  test("une équipe ne peut pas modifier les scores ni l'état", async () => {
    await seed();
    await assertFails(set(ref(db("rose"), `games/${CODE}/state/scores/rose`), 9999));
    await assertFails(update(ref(db("rose"), `games/${CODE}/state`), { phase: "reveal" }));
  });
  test("une équipe ne peut pas écrire dans le journal", async () => {
    await seed();
    await assertFails(set(ref(db("rose"), `games/${CODE}/log/000001`), { type: "adjust", team: "rose", delta: 500 }));
  });
  test("une équipe ne peut pas se déclarer hôte d'une partie existante", async () => {
    await seed();
    await assertFails(set(ref(db("rose"), `games/${CODE}/hostUid`), "rose"));
  });
  test("la box pilote sa partie : état et journal en une seule écriture", async () => {
    await seed();
    await assertSucceeds(update(ref(db(HOST), `games/${CODE}`), {
      "state/phase": "closed", "log/000001": { seq: 1, at: 1, type: "close" },
    }));
  });
  test("le journal ne se réécrit jamais, même par la box", async () => {
    await seed();
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/log/000001`), { seq: 1, at: 1, type: "adjust" }));
    await assertFails(set(ref(db(HOST), `games/${CODE}/log/000001`), { seq: 1, at: 1, type: "adjust", delta: 999 }));
  });
  test("personne ne peut écraser une partie existante", async () => {
    await seed();
    await assertFails(set(ref(db("rose"), `games/${CODE}`), { hostUid: "rose" }));
    await assertFails(set(ref(db(HOST), `games/${CODE}`), { hostUid: HOST }));
  });
  test("un appareil peut créer une nouvelle partie dont il est l'hôte, pas pour un autre", async () => {
    await assertSucceeds(set(ref(db("box2"), "games/NEW01"), { hostUid: "box2", state: { phase: "lobby" } }));
    await assertFails(set(ref(db("box2"), "games/NEW02"), { hostUid: "autre" }));
  });
});

describe("réponses", () => {
  test("une réponse par équipe et par question", async () => {
    await seed();
    await assertSucceeds(answer("rose", 1));
    await assertFails(answer("rose", 2));
  });
  test("deux équipes répondent chacune", async () => {
    await seed();
    await assertSucceeds(answer("rose", 1));
    await assertSucceeds(answer("bleu", 3));
  });
  test("impossible de répondre à la place d'une autre équipe", async () => {
    await seed();
    await assertFails(set(ref(db("rose"), `games/${CODE}/answers/q1/bleu`), { choice: 0, at: serverTimestamp() }));
  });
  test("un appareil qui n'a pas rejoint la partie ne peut pas répondre", async () => {
    await seed();
    await assertFails(answer("intrus", 1));
  });
  test("refusée pendant la pause", async () => {
    await seed({ paused: true, deadline: null });
    await assertFails(answer("rose", 1));
  });
  test("refusée quand la question est fermée", async () => {
    await seed({ phase: "closed" });
    await assertFails(answer("rose", 1));
  });
  test("refusée pour une autre question que celle en cours", async () => {
    await seed();
    await assertFails(answer("rose", 1, "q2"));
  });
  test("refusée après la fin du chrono", async () => {
    await seed({ deadline: Date.now() - 5000 });
    await assertFails(answer("rose", 1));
  });
  test("proposition inexistante refusée", async () => {
    await seed({ choices: ["Vrai", "Faux"] });
    await assertFails(answer("rose", 2));
    await assertSucceeds(answer("rose", 1));
  });
  test("l'heure de la réponse est celle du serveur, pas celle du téléphone", async () => {
    await seed();
    await assertFails(set(ref(db("rose"), `games/${CODE}/answers/q1/rose`), { choice: 1, at: 1 }));
  });
  test("pas de champ en plus (points, bonus…)", async () => {
    await seed();
    await assertFails(set(ref(db("rose"), `games/${CODE}/answers/q1/rose`), { choice: 1, at: serverTimestamp(), points: 500 }));
  });
});

describe("présence", () => {
  test("une équipe signale sa propre connexion, pas celle des autres", async () => {
    await seed();
    await assertSucceeds(set(ref(db("rose"), `games/${CODE}/presence/rose`), { online: true, at: serverTimestamp() }));
    await assertFails(set(ref(db("rose"), `games/${CODE}/presence/bleu`), { online: false, at: serverTimestamp() }));
  });
});

describe("buzzer", () => {
  test("le premier buzz gagne, le second est refusé", async () => {
    await seed({ phase: "lobby", buzzOpen: true, round: 1 });
    await assertSucceeds(set(ref(db("rose"), `games/${CODE}/buzz/1`), { team: "rose", at: serverTimestamp() }));
    await assertFails(set(ref(db("bleu"), `games/${CODE}/buzz/1`), { team: "bleu", at: serverTimestamp() }));
  });
});

describe("rapports de plantage", () => {
  const report = { kind: "crash", text: "trace", version: "0.1.20", at: serverTimestamp() };
  test("la box envoie un rapport, personne ne peut le relire ni l'écraser", async () => {
    await assertSucceeds(set(ref(db(HOST), "reports/r1"), report));
    await assertFails(get(ref(db(HOST), "reports/r1")));
    await assertFails(set(ref(db("rose"), "reports/r1"), report));
  });
  test("un rapport géant est refusé", async () => {
    await assertFails(set(ref(db(HOST), "reports/r2"), { ...report, text: "x".repeat(20001) }));
  });
});

describe("régie", () => {
  const REGIE = "tel";
  const pair = (uid, body) => set(ref(db(uid), `games/${CODE}/pairing/${uid}`), { ...body, at: serverTimestamp() });
  const command = (uid, body) =>
    set(ref(db(uid), `games/${CODE}/commands/c-${uid}-${body.type}`), { expectSeq: 3, by: uid, at: serverTimestamp(), ...body });
  async function paired() {
    await seed();
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/${REGIE}`), { pairedAt: 1 }));
  }

  test("un téléphone demande l'appairage avec un code à 4 chiffres", async () => {
    await seed();
    await assertSucceeds(pair(REGIE, { pin: "0427" }));
    await assertSucceeds(get(ref(db(REGIE), `games/${CODE}/pairing/${REGIE}`)));
  });
  test("demande mal formée refusée (pas 4 chiffres, heure du téléphone, champ en plus)", async () => {
    await seed();
    await assertFails(pair(REGIE, { pin: "12345" }));
    await assertFails(pair(REGIE, { pin: "12a4" }));
    await assertFails(set(ref(db(REGIE), `games/${CODE}/pairing/${REGIE}`), { pin: "1234", at: 1 }));
    await assertFails(pair(REGIE, { pin: "1234", admin: true }));
  });
  test("chemin compte animatrice fermé tant qu'aucune adresse n'est enregistrée", async () => {
    await seed();
    await assertFails(pair(REGIE, { staff: true }));
  });
  test("personne ne lit la demande d'un autre ni ne s'appaire seul", async () => {
    await seed();
    await pair(REGIE, { pin: "0427" });
    await assertFails(get(ref(db("espion"), `games/${CODE}/pairing/${REGIE}`)));
    await assertFails(get(ref(db("espion"), `games/${CODE}/pairing`)));
    await assertFails(set(ref(db(REGIE), `games/${CODE}/regie/${REGIE}`), { pairedAt: 1 }));
    await assertFails(set(ref(db(REGIE), `games/${CODE}/pairingResult/${REGIE}`), "ok"));
  });
  test("la box juge la demande : elle l'efface et appaire le téléphone", async () => {
    await seed();
    await pair(REGIE, { pin: "0427" });
    await assertSucceeds(update(ref(db(HOST), `games/${CODE}`), {
      [`pairing/${REGIE}`]: null, [`regie/${REGIE}`]: { pairedAt: 1 }, [`pairingResult/${REGIE}`]: "ok",
      pairingLock: { failures: 0 },
    }));
    await assertSucceeds(get(ref(db(REGIE), `games/${CODE}/regie/${REGIE}`)));
    await assertSucceeds(get(ref(db(REGIE), `games/${CODE}/pairingResult/${REGIE}`)));
  });
  test("une régie appairée pilote par commandes et lit le conducteur, le journal et les réponses", async () => {
    await paired();
    await assertSucceeds(command(REGIE, { type: "next" }));
    await assertSucceeds(command(REGIE, { type: "adjust", team: "rose", delta: -10 }));
    await assertSucceeds(get(ref(db(REGIE), `games/${CODE}/conducteur`)));
    await assertSucceeds(get(ref(db(REGIE), `games/${CODE}/log`)));
    await assertSucceeds(get(ref(db(REGIE), `games/${CODE}/answers/q1`)));
    await assertSucceeds(get(ref(db(REGIE), `games/${CODE}/commandStatus`)));
  });
  test("la régie ne touche jamais directement l'état, les scores ni le journal", async () => {
    await paired();
    await assertFails(update(ref(db(REGIE), `games/${CODE}/state`), { phase: "reveal" }));
    await assertFails(set(ref(db(REGIE), `games/${CODE}/log/000001`), { seq: 1, at: 1, type: "adjust" }));
    await assertFails(set(ref(db(REGIE), `games/${CODE}/commandStatus/x`), { status: "applied" }));
  });
  test("une équipe ou un inconnu ne peut ni commander ni lire le conducteur", async () => {
    await paired();
    await assertFails(command("rose", { type: "next" }));
    await assertFails(get(ref(db("rose"), `games/${CODE}/conducteur`)));
    await assertFails(get(ref(db("rose"), `games/${CODE}/commands`)));
  });
  test("commande mal formée refusée", async () => {
    await paired();
    await assertFails(command(REGIE, { type: "tricher" }));
    await assertFails(command(REGIE, { type: "adjust", team: "rose", delta: 9999 }));
    await assertFails(command(REGIE, { type: "next", by: "autre" }));
    await assertFails(command(REGIE, { type: "next", at: 1 }));
    await assertFails(command(REGIE, { type: "next", points: 50 }));
    await assertFails(set(ref(db(REGIE), `games/${CODE}/commands/sans-seq`), { type: "next", by: REGIE, at: serverTimestamp() }));
  });
  test("une commande ne se réécrit pas", async () => {
    await paired();
    await assertSucceeds(command(REGIE, { type: "pause" }));
    await assertFails(command(REGIE, { type: "pause" }));
  });
  test("une régie retirée par la box ne commande plus", async () => {
    await paired();
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/regie/${REGIE}`), null));
    await assertFails(command(REGIE, { type: "next" }));
  });
});
