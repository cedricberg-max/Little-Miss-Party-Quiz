// Règles de sécurité Firebase : ce qu'un pupitre, la box ou un inconnu ont le droit de faire.
// Lancé par `npm test` dans l'émulateur Firebase, jamais sur la vraie base.
import { createHash } from "node:crypto";
import { loadRules, seedAdmin, adminHash, ADMIN_PASSWORD, ADMIN_SALT } from "./rules-loader.js";
import { after, before, beforeEach, describe, test } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { ref, get, set, update, serverTimestamp } from "firebase/database";

const HOST = "box";
const CODE = "ABCDE";
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-lmp",
    database: { rules: loadRules(), host: "127.0.0.1", port: 9000 },
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
  test("rejoindre une partie existante dans le salon d'attente", async () => {
    await seed({ phase: "lobby" });
    await assertSucceeds(set(ref(db("vert"), `games/${CODE}/teams/vert`), { name: "Les Verts", color: "#06D6A0" }));
    // Même tablette qui rejoint deux fois : toujours une seule équipe.
    await assertSucceeds(set(ref(db("vert"), `games/${CODE}/teams/vert`), { name: "Les Verts", color: "#06D6A0" }));
  });
  test("partie commencée : un nouvel appareil ne crée pas d'équipe seul, il demande à entrer", async () => {
    await seed();
    await assertFails(set(ref(db("vert"), `games/${CODE}/teams/vert`), { name: "Les Verts", color: "#06D6A0" }));
    await assertFails(set(ref(db("rose"), `games/${CODE}/teams/rose`), { name: "Renommée", color: "#FF3CAC" }));
    await assertSucceeds(set(ref(db("vert"), `games/${CODE}/joinRequests/vert`), { name: "Les Verts", color: "#06D6A0", at: serverTimestamp() }));
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

describe("remplacement d'un appareil", () => {
  const request = (uid, name = "Les Bleus") =>
    set(ref(db(uid), `games/${CODE}/joinRequests/${uid}`), { name, color: "#2B86C5", at: serverTimestamp() });
  /** La box rattache le téléphone « neuf » à l'équipe « bleu » (son ancien appareil avait l'identifiant « bleu »). */
  const replace = (device = "neuf") => update(ref(db(HOST), `games/${CODE}`), { "teams/bleu/device": device, [`joinRequests/${device}`]: null });

  test("demande d'entrée : l'appareil n'écrit que la sienne, avec l'heure du serveur, sans champ en plus", async () => {
    await seed();
    await assertSucceeds(request("neuf"));
    await assertFails(set(ref(db("neuf"), `games/${CODE}/joinRequests/autre`), { name: "x", color: "#000", at: serverTimestamp() }));
    await assertFails(set(ref(db("neuf2"), `games/${CODE}/joinRequests/neuf2`), { name: "x", color: "#000", at: 1 }));
    await assertFails(set(ref(db("neuf2"), `games/${CODE}/joinRequests/neuf2`), { name: "x", color: "#000", at: serverTimestamp(), score: 9 }));
    await assertFails(set(ref(db("neuf2"), "games/ZZZZZ/joinRequests/neuf2"), { name: "x", color: "#000", at: serverTimestamp() }));
  });
  test("les demandes ne sont lues que par la régie, la box et leur auteur", async () => {
    await seed();
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/tel`), { pairedAt: 1, via: "pin" }));
    await request("neuf");
    await assertSucceeds(get(ref(db("tel"), `games/${CODE}/joinRequests`)));
    await assertSucceeds(get(ref(db(HOST), `games/${CODE}/joinRequests`)));
    await assertSucceeds(get(ref(db("neuf"), `games/${CODE}/joinRequests/neuf`)));
    await assertFails(get(ref(db("rose"), `games/${CODE}/joinRequests`)));
    // La régie peut écarter une demande, pas en créer.
    await assertSucceeds(set(ref(db("tel"), `games/${CODE}/joinRequests/neuf`), null));
    await assertFails(set(ref(db("tel"), `games/${CODE}/joinRequests/neuf`), { name: "x", color: "#000", at: serverTimestamp() }));
  });
  test("seule la box rattache un appareil à une équipe ou crée une équipe en cours de partie", async () => {
    await seed();
    await request("neuf");
    await assertFails(set(ref(db("neuf"), `games/${CODE}/teams/bleu/device`), "neuf"));
    await assertFails(set(ref(db("bleu"), `games/${CODE}/teams/bleu/device`), "neuf"));
    await assertSucceeds(replace());
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/teams/vert`), { name: "Les Verts", color: "#06D6A0", joinedAt: 1 }));
  });
  test("après le remplacement, le nouvel appareil joue pour l'équipe ; l'ancien est désactivé même s'il revient", async () => {
    await seed();
    await replace();
    // Nouvel appareil : présence, réponse (relue ensuite) au nom de l'équipe.
    await assertSucceeds(set(ref(db("neuf"), `games/${CODE}/presence/bleu`), { online: true, at: serverTimestamp() }));
    await assertSucceeds(set(ref(db("neuf"), `games/${CODE}/answers/q1/bleu`), { choice: 2, at: serverTimestamp() }));
    await assertSucceeds(get(ref(db("neuf"), `games/${CODE}/answers/q1/bleu`)));
    // Ancien appareil : plus rien, ni réponse, ni présence, ni relecture, ni réinscription.
    await assertFails(set(ref(db("bleu"), `games/${CODE}/presence/bleu`), { online: false, at: serverTimestamp() }));
    await assertFails(set(ref(db("bleu"), `games/${CODE}/answers/q2/bleu`), { choice: 1, at: serverTimestamp() }));
    await assertFails(get(ref(db("bleu"), `games/${CODE}/answers/q1/bleu`)));
    await assertFails(set(ref(db("bleu"), `games/${CODE}/teams/bleu`), { name: "Les Bleus", color: "#2B86C5" }));
    // Le nouvel appareil ne joue pas pour une autre équipe.
    await assertFails(set(ref(db("neuf"), `games/${CODE}/answers/q1/rose`), { choice: 0, at: serverTimestamp() }));
  });
  test("une seule réponse par équipe, même si l'ancien appareil avait déjà répondu", async () => {
    await seed();
    await assertSucceeds(answer("bleu", 1));
    await replace();
    await assertFails(set(ref(db("neuf"), `games/${CODE}/answers/q1/bleu`), { choice: 2, at: serverTimestamp() }));
  });
  test("remplacé une deuxième fois : seul le dernier appareil compte", async () => {
    await seed();
    await replace("neuf");
    await replace("neuf2");
    await assertFails(answer("neuf"));
    await assertFails(set(ref(db("neuf"), `games/${CODE}/answers/q1/bleu`), { choice: 2, at: serverTimestamp() }));
    await assertSucceeds(set(ref(db("neuf2"), `games/${CODE}/answers/q1/bleu`), { choice: 2, at: serverTimestamp() }));
  });
  test("buzzer : le nouvel appareil buzze pour son équipe, l'ancien plus du tout", async () => {
    await seed({ phase: "question", buzzOpen: true, round: 1 });
    await replace();
    await assertFails(set(ref(db("bleu"), `games/${CODE}/buzz/1`), { team: "bleu", at: serverTimestamp() }));
    await assertFails(set(ref(db("neuf"), `games/${CODE}/buzz/1`), { team: "rose", at: serverTimestamp() }));
    await assertSucceeds(set(ref(db("neuf"), `games/${CODE}/buzz/1`), { team: "bleu", at: serverTimestamp() }));
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
  test("refusée pendant le décompte 3, 2, 1 de la reprise, acceptée juste après", async () => {
    await seed({ resumeAt: Date.now() + 1500, deadline: Date.now() + 15000 });
    await assertFails(answer("rose", 1));
    await new Promise((r) => setTimeout(r, 1700));
    await assertSucceeds(answer("rose", 1));
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
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/${REGIE}`), { pairedAt: 1, via: "pin" }));
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
  test("plus de chemin « compte animatrice »", async () => {
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
      [`pairing/${REGIE}`]: null, [`regie/${REGIE}`]: { pairedAt: 1, via: "pin" }, [`pairingResult/${REGIE}`]: "ok",
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
    await assertSucceeds(command(REGIE, { type: "replace", team: "rose", device: "neuf" }));
    await assertFails(set(ref(db(REGIE), `games/${CODE}/commands/long`), { type: "replace", team: "rose", device: "x".repeat(200), expectSeq: 3, by: REGIE, at: serverTimestamp() }));
    await assertFails(command(REGIE, { type: "adjust", team: "rose", delta: 9999 }));
    await assertFails(command(REGIE, { type: "next", by: "autre" }));
    await assertFails(command(REGIE, { type: "next", at: 1 }));
    await assertFails(command(REGIE, { type: "next", points: 50 }));
    await assertFails(set(ref(db(REGIE), `games/${CODE}/commands/sans-seq`), { type: "next", by: REGIE, at: serverTimestamp() }));
  });
  test("mimes : la régie lance un tour, valide, passe, corrige d'un point et arrête le tour", async () => {
    await paired();
    await assertSucceeds(command(REGIE, { type: "mime_start", team: "rose" }));
    await assertSucceeds(command(REGIE, { type: "mime_found" }));
    await assertSucceeds(command(REGIE, { type: "mime_pass" }));
    await assertSucceeds(command(REGIE, { type: "mime_fix", team: "rose", delta: -1 }));
    await assertSucceeds(command(REGIE, { type: "mime_stop" }));
    await assertFails(command("rose", { type: "mime_found" }));
    await assertFails(set(ref(db(REGIE), `games/${CODE}/commands/m-points`), { type: "mime_found", points: 50, expectSeq: 3, by: REGIE, at: serverTimestamp() }));
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

describe("mot de passe commun de la régie", () => {
  const SALT = "sel-de-test-0123456789";
  const hash = (password) => createHash("sha256").update(`${SALT}:${password}`).digest("hex");
  const admin = () => db("sarah");
  beforeEach(() => seedAdmin(env, "sarah"));
  const setPassword = (password) => env.withSecurityRulesDisabled((ctx) =>
    set(ref(ctx.database(), "settings/regie"), { salt: SALT, hash: hash(password), updatedAt: 1 }));
  /** Ce que fait la page : un essai (au plus toutes les 2 s), une empreinte par essai, puis l'accès. */
  async function enter(uid, password, code = CODE) {
    const d = db(uid);
    await set(ref(d, "regieGate/try"), { uid, at: serverTimestamp() });
    const gateAt = (await get(ref(d, "regieGate/try/at"))).val();
    await set(ref(d, `regieProof/${uid}`), { hash: hash(password), gateAt, at: serverTimestamp() });
    await set(ref(d, `games/${code}/regie/${uid}`), { pairedAt: serverTimestamp(), via: "password" });
  }
  const pause = () => new Promise((r) => setTimeout(r, 2100));

  test("le bon mot de passe donne accès à la régie de la partie", async () => {
    await seed();
    await setPassword("Licorne-2026");
    await assertSucceeds(enter("tel", "Licorne-2026"));
    await assertSucceeds(set(ref(db("tel"), `games/${CODE}/commands/c1`), { type: "next", expectSeq: 0, by: "tel", at: serverTimestamp() }));
  });
  test("un mauvais mot de passe est refusé", async () => {
    await seed();
    await setPassword("Licorne-2026");
    await assertFails(enter("tel", "licorne-2026"));
    await assertFails(get(ref(db("tel"), `games/${CODE}/conducteur`)));
  });
  test("sans mot de passe enregistré, personne n'entre par ce chemin", async () => {
    await seed();
    await assertFails(enter("tel", ""));
  });
  test("un seul essai toutes les 2 secondes, tous téléphones confondus", async () => {
    await seed();
    await setPassword("Licorne-2026");
    await assertFails(enter("pirate", "essai1"));
    await assertFails(enter("tel", "Licorne-2026"));
    await pause();
    await assertSucceeds(enter("tel", "Licorne-2026"));
  });
  test("une seule empreinte par essai : impossible d'enchaîner les mots de passe", async () => {
    await seed();
    await setPassword("Licorne-2026");
    const d = db("pirate");
    await set(ref(d, "regieGate/try"), { uid: "pirate", at: serverTimestamp() });
    const gateAt = (await get(ref(d, "regieGate/try/at"))).val();
    await assertSucceeds(set(ref(d, "regieProof/pirate"), { hash: hash("essai1"), gateAt, at: serverTimestamp() }));
    await assertFails(set(ref(d, `games/${CODE}/regie/pirate`), { pairedAt: serverTimestamp(), via: "password" }));
    await assertFails(set(ref(d, "regieProof/pirate"), { hash: hash("Licorne-2026"), gateAt, at: serverTimestamp() }));
  });
  test("accès impossible sans passer par l'essai (écriture directe)", async () => {
    await seed();
    await setPassword("Licorne-2026");
    await assertFails(set(ref(db("tel"), `games/${CODE}/regie/tel`), { pairedAt: serverTimestamp(), via: "password" }));
  });
  test("l'empreinte et le mot de passe ne se relisent jamais", async () => {
    await seed();
    await setPassword("Licorne-2026");
    await assertSucceeds(get(ref(db("tel"), "settings/regie/salt")));
    await assertFails(get(ref(db("tel"), "settings/regie/hash")));
    await assertFails(get(ref(db("tel"), "settings/regie")));
    await enter("tel", "Licorne-2026");
    await assertFails(get(ref(db("tel"), "regieProof/tel")));
  });
  test("pas d'accès à une partie terminée ou inexistante", async () => {
    await seed({ phase: "ended" });
    await setPassword("Licorne-2026");
    await assertFails(enter("tel", "Licorne-2026"));
    await pause();
    await assertFails(enter("tel", "Licorne-2026", "ZZZZZ"));
  });
  test("seul un administrateur change le mot de passe, la régie déjà reliée reste reliée", async () => {
    await seed();
    await setPassword("Licorne-2026");
    await assertSucceeds(enter("tel", "Licorne-2026"));
    const next = { salt: "nouveau-sel-0123456789", hash: "a".repeat(64), updatedAt: serverTimestamp() };
    await assertFails(set(ref(db("tel"), "settings/regie"), next));
    await assertFails(set(ref(db("intrus"), "settings/regie"), next));
    await assertSucceeds(set(ref(admin(), "settings/regie"), next));
    // L'animatrice en pleine partie n'est pas déconnectée.
    await assertSucceeds(set(ref(db("tel"), `games/${CODE}/commands/c2`), { type: "pause", expectSeq: 0, by: "tel", at: serverTimestamp() }));
  });
  test("mot de passe enregistré mal formé refusé", async () => {
    await assertFails(set(ref(admin(), "settings/regie"), { salt: "court", hash: "a".repeat(64), updatedAt: serverTimestamp() }));
    await assertFails(set(ref(admin(), "settings/regie"), { salt: SALT, hash: "motdepasseenclair", updatedAt: serverTimestamp() }));
  });
});

describe("bibliothèque, prestations et chargement sur la TV", () => {
  const SALT = "sel-de-test-0123456789";
  const hash = (password) => createHash("sha256").update(`${SALT}:${password}`).digest("hex");
  const admin = () => db("sarah");
  beforeEach(() => seedAdmin(env, "sarah"));
  const QUIZ = {
    title: "Animaux", source: "gemini", updatedAt: serverTimestamp(),
    questions: [{ text: "Roi de la jungle ?", choices: ["Lion", "Tigre"], correct: 0, status: "validee" }],
  };
  const SHOW = { childName: "Léa", age: 8, status: "publiee", rounds: [{ type: "quiz", quizId: "q1" }], updatedAt: serverTimestamp() };
  const SNAPSHOT = (uid) => ({
    id: "s1", title: "L'anniversaire de Léa", childName: "Léa", by: uid, at: serverTimestamp(),
    quiz: { id: "show1", title: "L'anniversaire de Léa", questions: [{ id: "r1q1", text: "Roi ?", choices: ["Lion", "Tigre"], correct: 0 }] },
  });
  /** Téléphone relié par le mot de passe commun (même chemin que la page). */
  async function regieByPassword(uid) {
    await env.withSecurityRulesDisabled((ctx) =>
      set(ref(ctx.database(), "settings/regie"), { salt: SALT, hash: hash("Licorne-2026"), updatedAt: 1 }));
    const d = db(uid);
    await set(ref(d, "regieGate/try"), { uid, at: serverTimestamp() });
    const gateAt = (await get(ref(d, "regieGate/try/at"))).val();
    await set(ref(d, `regieProof/${uid}`), { hash: hash("Licorne-2026"), gateAt, at: serverTimestamp() });
    await set(ref(d, `games/${CODE}/regie/${uid}`), { pairedAt: serverTimestamp(), via: "password" });
  }
  const regieByPin = (uid) => env.withSecurityRulesDisabled((ctx) =>
    set(ref(ctx.database(), `games/${CODE}/regie/${uid}`), { pairedAt: 1, via: "pin" }));

  test("seul un administrateur enregistre ou supprime un quiz et une prestation", async () => {
    await assertSucceeds(set(ref(admin(), "library/quizzes/q1"), QUIZ));
    await assertSucceeds(set(ref(admin(), "library/shows/show1"), SHOW));
    await assertFails(set(ref(db("tel"), "library/quizzes/q2"), QUIZ));
    await assertFails(set(ref(db("intrus"), "library/shows/s2"), SHOW));
    // Une empreinte fausse (mauvais mot de passe) ne donne aucun droit.
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), "adminProof/y"), { hash: adminHash("faux"), gateAt: 1, at: 1 }));
    await assertFails(set(ref(db("y"), "library/quizzes/q3"), QUIZ));
    await assertSucceeds(set(ref(admin(), "library/quizzes/q1"), null));
  });
  test("paquet de mimes : enregistré par l'administration, lu par la régie, mal formé refusé", async () => {
    const DECK = { title: "Animaux", duration: 60, updatedAt: serverTimestamp(), cards: [{ word: "Chat", image: "🐱" }, { word: "Robot" }] };
    await assertSucceeds(set(ref(admin(), "library/mimes/m1"), DECK));
    await assertFails(set(ref(db("tel"), "library/mimes/m2"), DECK));
    await assertFails(set(ref(admin(), "library/mimes/m1"), { ...DECK, cards: [] }));
    await assertFails(set(ref(admin(), "library/mimes/m1"), { ...DECK, duration: 600 }));
    await assertFails(set(ref(admin(), "library/mimes/m1"), { ...DECK, cards: [{ word: "" }] }));
    await assertFails(set(ref(admin(), "library/mimes/m1"), { ...DECK, cards: [{ word: "Chat", secret: 1 }] }));
    await seed({ phase: "lobby" });
    await regieByPassword("tel");
    await assertSucceeds(get(ref(db("tel"), "library/mimes")));
    await assertFails(get(ref(db("rose"), "library/mimes")));
  });
  test("quiz ou prestation mal formés refusés", async () => {
    await assertFails(set(ref(admin(), "library/quizzes/q1"), { ...QUIZ, title: "" }));
    await assertFails(set(ref(admin(), "library/quizzes/q1"), { ...QUIZ, questions: [{ ...QUIZ.questions[0], status: "ok" }] }));
    await assertFails(set(ref(admin(), "library/quizzes/q1"), { ...QUIZ, questions: [{ ...QUIZ.questions[0], duration: 600 }] }));
    await assertFails(set(ref(admin(), "library/shows/s1"), { ...SHOW, childName: "" }));
    await assertFails(set(ref(admin(), "library/shows/s1"), { ...SHOW, status: "en ligne" }));
  });
  test("la bibliothèque se lit par l'administration et par une régie entrée avec le mot de passe", async () => {
    await seed({ phase: "lobby" });
    await assertSucceeds(set(ref(admin(), "library/quizzes/q1"), QUIZ));
    await assertSucceeds(get(ref(admin(), "library")));
    await regieByPassword("tel");
    await assertSucceeds(get(ref(db("tel"), "library/shows")));
    await assertSucceeds(get(ref(db("tel"), "library/quizzes/q1")));
    // Le mot de passe commun ne donne aucun droit d'écriture dans la bibliothèque.
    await assertFails(set(ref(db("tel"), "library/quizzes/q1"), QUIZ));
  });
  test("ni une équipe, ni la box, ni une régie entrée par le code de secours ne lisent la bibliothèque", async () => {
    await seed({ phase: "lobby" });
    await regieByPin("secours");
    await assertFails(get(ref(db("rose"), "library")));
    await assertFails(get(ref(db(HOST), "library/quizzes")));
    await assertFails(get(ref(db("secours"), "library/shows")));
  });
  test("la régie charge une prestation au salon d'attente ; en partie, elle ne modifie que le programme", async () => {
    await seed({ phase: "lobby" });
    await regieByPin("tel");
    await assertSucceeds(set(ref(db("tel"), `games/${CODE}/show`), SNAPSHOT("tel")));
    await assertSucceeds(get(ref(db("tel"), `games/${CODE}/show`)));
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/state/phase`), "question"));
    await assertFails(set(ref(db("tel"), `games/${CODE}/show`), { ...SNAPSHOT("tel"), id: "s2" }));
    // En pleine partie, seule une modification du programme (préparée sur une version précise) passe.
    await assertSucceeds(set(ref(db("tel"), `games/${CODE}/show`), { ...SNAPSHOT("tel"), id: "s3", base: "s1" }));
    await assertFails(set(ref(db("rose"), `games/${CODE}/show`), { ...SNAPSHOT("rose"), id: "s4", base: "s3" }));
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/state/phase`), "ended"));
    await assertFails(set(ref(db("tel"), `games/${CODE}/show`), { ...SNAPSHOT("tel"), id: "s5", base: "s3" }));
  });
  test("une équipe ne charge rien et ne lit pas les réponses de la prestation", async () => {
    await seed({ phase: "lobby" });
    await assertFails(set(ref(db("rose"), `games/${CODE}/show`), SNAPSHOT("rose")));
    await regieByPin("tel");
    await set(ref(db("tel"), `games/${CODE}/show`), SNAPSHOT("tel"));
    await assertFails(get(ref(db("rose"), `games/${CODE}/show`)));
    await assertFails(set(ref(db("tel"), `games/${CODE}/showStatus`), { id: "s1", status: "applied" }));
    await assertFails(set(ref(db("tel"), `games/${CODE}/show`), { ...SNAPSHOT("rose") }));
  });
  test("la box publie le titre et le prénom, lisibles par tous les pupitres", async () => {
    await seed({ phase: "lobby" });
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/public`), { title: "L'anniversaire de Léa", childName: "Léa" }));
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/showStatus`), { id: "s1", status: "applied" }));
    await assertSucceeds(get(ref(db("rose"), `games/${CODE}/public`)));
    await assertFails(set(ref(db("rose"), `games/${CODE}/public`), { title: "Pirate" }));
  });
});

describe("mot de passe administrateur commun", () => {
  /** Ce que fait la page d'administration : un essai (au plus toutes les 2 s), puis l'empreinte. */
  async function enterAdmin(uid, password = ADMIN_PASSWORD) {
    const d = db(uid);
    await set(ref(d, "regieGate/try"), { uid, at: serverTimestamp() });
    const gateAt = (await get(ref(d, "regieGate/try/at"))).val();
    await set(ref(d, `adminProof/${uid}`), { hash: adminHash(password), gateAt, at: serverTimestamp() });
  }
  const access = (uid) => get(ref(db(uid), `adminAccess/${uid}`));
  const pause = () => new Promise((r) => setTimeout(r, 2100));
  const settings = (password, salt = ADMIN_SALT) => ({ salt, hash: adminHash(password, salt), updatedAt: serverTimestamp() });

  test("première configuration : le premier mot de passe se choisit librement, une seule fois", async () => {
    await assertSucceeds(set(ref(db("pc"), "settings/admin"), settings(ADMIN_PASSWORD)));
    await assertFails(set(ref(db("intrus"), "settings/admin"), settings("Pirate-2026")));
    await assertFails(set(ref(db("intrus"), "settings/admin"), null));
  });
  test("le bon mot de passe ouvre l'administration, un mauvais non", async () => {
    await seedAdmin(env);
    await assertFails(access("pc"));
    await enterAdmin("pc", "mauvais-mdp");
    await assertFails(access("pc"));
    await pause();
    await enterAdmin("pc");
    await assertSucceeds(access("pc"));
    // Chacun ne vérifie que son propre accès, et personne ne relit les empreintes.
    await assertFails(get(ref(db("tel"), "adminAccess/pc")));
    await assertFails(get(ref(db("pc"), "adminProof/pc")));
    await assertFails(get(ref(db("pc"), "settings/admin/hash")));
  });
  test("un seul essai toutes les 2 secondes, partagé avec la régie", async () => {
    await seedAdmin(env);
    await set(ref(db("pirate"), "regieGate/try"), { uid: "pirate", at: serverTimestamp() });
    await assertFails(enterAdmin("pc"));
  });
  test("tous les droits : bibliothèque, prestations, les deux mots de passe", async () => {
    await seedAdmin(env, "pc");
    await assertSucceeds(set(ref(db("pc"), "library/shows/s1"), { childName: "Léa", status: "brouillon", updatedAt: serverTimestamp() }));
    await assertSucceeds(set(ref(db("pc"), "settings/regie"), settings("Regie-2026", "sel-regie-0123456789")));
    await assertSucceeds(set(ref(db("pc"), "settings/admin"), settings("Nouveau-Admin-1", "nouveau-sel-0123456789")));
  });
  test("après un changement, les autres appareils doivent le saisir à nouveau", async () => {
    await seedAdmin(env, "pc", "portable");
    await set(ref(db("pc"), "settings/admin"), settings("Nouveau-Admin-1", "nouveau-sel-0123456789"));
    await assertFails(access("portable"));
    await assertFails(set(ref(db("portable"), "library/shows/s1"), { childName: "Léa", status: "brouillon", updatedAt: serverTimestamp() }));
  });
  test("le mot de passe de la régie ne donne pas les droits d'administration", async () => {
    await seedAdmin(env);
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), "regieProof/tel"), { hash: adminHash(), gateAt: 1, at: 1 }));
    await assertFails(access("tel"));
    await assertFails(set(ref(db("tel"), "settings/regie"), settings("Regie-2026", "sel-regie-0123456789")));
  });
  test("se déconnecter efface sa propre empreinte, jamais celle d'un autre", async () => {
    await seedAdmin(env, "pc", "portable");
    await assertFails(set(ref(db("pc"), "adminProof/portable"), null));
    await assertSucceeds(set(ref(db("pc"), "adminProof/pc"), null));
    await assertFails(access("pc"));
    await assertSucceeds(access("portable"));
  });
});
