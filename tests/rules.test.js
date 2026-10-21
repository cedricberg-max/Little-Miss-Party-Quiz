// Règles de sécurité Firebase : ce qu'un pupitre, la box ou un inconnu ont le droit de faire.
// Lancé par `npm test` dans l'émulateur Firebase, jamais sur la vraie base.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadRules, seedAdmin, allowBox, adminHash, ADMIN_PASSWORD, ADMIN_SALT } from "./rules-loader.js";
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

/** Comme le pupitre : l'équipe et sa couleur réservée dans la même écriture. */
const join = (uid, name, color, team = uid, code = CODE) =>
  update(ref(db(uid), `games/${code}`), { [`teams/${team}`]: { name, color }, [`colors/${color.slice(1).toUpperCase()}`]: uid });

describe("équipes", () => {
  test("rejoindre une partie existante dans le salon d'attente", async () => {
    await seed({ phase: "lobby" });
    await assertSucceeds(join("vert", "Les Verts", "#06D6A0"));
    // Même tablette qui rejoint deux fois : toujours une seule équipe.
    await assertSucceeds(join("vert", "Les Verts", "#06D6A0"));
  });
  test("partie commencée : un nouvel appareil ne crée pas d'équipe seul, il demande à entrer", async () => {
    await seed();
    await assertFails(join("vert", "Les Verts", "#06D6A0"));
    await assertFails(join("rose", "Renommée", "#FF3CAC"));
    await assertSucceeds(set(ref(db("vert"), `games/${CODE}/joinRequests/vert`), { name: "Les Verts", color: "#06D6A0", at: serverTimestamp() }));
  });
  test("impossible d'inscrire ou de renommer une autre équipe", async () => {
    await seed();
    await assertFails(join("vert", "Piratée", "#000000", "rose"));
  });
  test("nom vide ou trop long refusé", async () => {
    await seed();
    await assertFails(join("vert", "", "#06D6A0"));
    await assertFails(join("vert", "x".repeat(21), "#06D6A0"));
  });
  test("impossible de rejoindre une partie qui n'existe pas", async () => {
    await assertFails(join("vert", "Les Verts", "#06D6A0", "vert", "ZZZZZ"));
  });
  test("une couleur prise n'est plus disponible pour les autres équipes, même en même temps", async () => {
    await seed({ phase: "lobby" });
    // Sans réserver sa couleur, une équipe ne peut pas s'inscrire.
    await assertFails(set(ref(db("vert"), `games/${CODE}/teams/vert`), { name: "Les Verts", color: "#06D6A0" }));
    // Deux tablettes choisissent la même couleur au même moment : une seule passe.
    const results = await Promise.allSettled([join("vert", "Les Verts", "#06D6A0"), join("jaune", "Les Jaunes", "#06d6a0")]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const winner = results[0].status === "fulfilled" ? "vert" : "jaune";
    const loser = winner === "vert" ? "jaune" : "vert";
    assert.equal((await get(ref(db(HOST), `games/${CODE}/colors/06D6A0`))).val(), winner);
    // Le perdant prend une autre couleur ; personne ne vole ni ne libère la couleur d'un autre.
    await assertSucceeds(join(loser, "Les Autres", "#FFD166"));
    await assertFails(set(ref(db(loser), `games/${CODE}/colors/06D6A0`), loser));
    await assertFails(set(ref(db(loser), `games/${CODE}/colors/06D6A0`), null));
    // Réserver une couleur sans équipe de cette couleur : refusé (pas de couleurs bloquées pour rien).
    await assertFails(set(ref(db("violet"), `games/${CODE}/colors/9B5DE5`), "violet"));
    await assertSucceeds(get(ref(db("violet"), `games/${CODE}/colors`)));
    // La box admet une équipe en cours de partie avec sa couleur.
    await assertSucceeds(update(ref(db(HOST), `games/${CODE}`), { "teams/tard": { name: "En retard", color: "#9B5DE5", joinedAt: 1 }, "colors/9B5DE5": "tard" }));
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
    // Reprise d'une équipe (« Reconnecter une tablette ») : seulement une équipe qui existe.
    await assertSucceeds(set(ref(db("neuf3"), `games/${CODE}/joinRequests/neuf3`), { name: "Les Bleus", color: "#2B86C5", replace: "bleu", at: serverTimestamp() }));
    await assertFails(set(ref(db("neuf4"), `games/${CODE}/joinRequests/neuf4`), { name: "x", color: "#000", replace: "inconnue", at: serverTimestamp() }));
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
    await assertFails(join("bleu", "Les Bleus", "#2B86C5"));
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
  test("une box acceptée peut créer une nouvelle partie dont elle est l'hôte, pas pour une autre", async () => {
    await allowBox(env, "box2");
    await assertSucceeds(set(ref(db("box2"), "games/NEW01"), { hostUid: "box2", state: { phase: "lobby" } }));
    await assertFails(set(ref(db("box2"), "games/NEW02"), { hostUid: "autre" }));
  });
  test("une box jamais acceptée ne peut pas créer de partie une fois le verrou en place", async () => {
    await allowBox(env, "box2");
    await assertFails(set(ref(db("inconnue"), "games/NEW03"), { hostUid: "inconnue", state: { phase: "lobby" } }));
  });
  test("tant qu'aucune box n'a été acceptée, les box déjà utilisées continuent de jouer", async () => {
    await assertSucceeds(set(ref(db("tcl"), "games/NEW06"), { hostUid: "tcl", state: { phase: "lobby" } }));
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
  test("Portes mystères : pas de chrono, une porte se choisit tant que les choix sont ouverts ; ailleurs, pas de réponse sans chrono", async () => {
    await seed({ deadline: null });
    await assertFails(answer("rose", 1));
    await seed({ kind: "portes", choices: ["Porte 1", "Porte 2", "Porte 3"], deadline: null });
    await assertSucceeds(answer("rose", 1));
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
  test("image floue : clé de l'essai en cours seulement, la première équipe gagne, rien quand le buzzer est fermé", async () => {
    await seed({ phase: "question", qid: "f1", kind: "flou", buzzOpen: true, round: "f1-1000-0" });
    await assertFails(set(ref(db("rose"), `games/${CODE}/buzz/f1-999-0`), { team: "rose", at: serverTimestamp() }), "ancienne clé");
    await assertSucceeds(set(ref(db("rose"), `games/${CODE}/buzz/f1-1000-0`), { team: "rose", at: serverTimestamp() }));
    await assertFails(set(ref(db("bleu"), `games/${CODE}/buzz/f1-1000-0`), { team: "bleu", at: serverTimestamp() }));
    // Une équipe bloquée après une erreur ne peut pas prendre la place sous la nouvelle clé.
    await seed({ phase: "question", qid: "f1", kind: "flou", buzzOpen: true, round: "f1-1000-1", buzzBlocked: { rose: true } });
    await assertFails(set(ref(db("rose"), `games/${CODE}/buzz/f1-1000-1`), { team: "rose", at: serverTimestamp() }));
    await assertSucceeds(set(ref(db("bleu"), `games/${CODE}/buzz/f1-1000-1`), { team: "bleu", at: serverTimestamp() }));
    // Verdict en attente : le buzzer est fermé, même sous la clé suivante.
    await seed({ phase: "question", qid: "f1", kind: "flou", buzzOpen: false, round: "f1-1000-1" });
    await assertFails(set(ref(db("bleu"), `games/${CODE}/buzz/f1-1000-1`), { team: "bleu", at: serverTimestamp() }));
  });
  test("blind test : l'équipe qui s'est trompée rebuzze seulement à l'heure publiée par la box", async () => {
    await seed({ phase: "question", qid: "b1", kind: "blind", buzzOpen: true, round: "b1-1000-1", buzzBlocked: { rose: Date.now() + 60_000 } });
    await assertFails(set(ref(db("rose"), `games/${CODE}/buzz/b1-1000-1`), { team: "rose", at: serverTimestamp() }), "trop tôt");
    await seed({ phase: "question", qid: "b1", kind: "blind", buzzOpen: true, round: "b1-1000-2", buzzBlocked: { rose: Date.now() - 1_000 } });
    await assertSucceeds(set(ref(db("rose"), `games/${CODE}/buzz/b1-1000-2`), { team: "rose", at: serverTimestamp() }));
  });
  test("accueil : chaque équipe buzze pour s'amuser autant qu'elle veut, jamais pour une autre ni pendant le jeu", async () => {
    await seed({ phase: "lobby", buzzOpen: true, round: 1 });
    const fun = (uid, team) => set(ref(db(uid), `games/${CODE}/fun/${team}`), { at: serverTimestamp() });
    await assertSucceeds(fun("rose", "rose"));
    await assertSucceeds(fun("bleu", "bleu"));
    // Rafale trop rapide (moins d'un quart de seconde) : ignorée, le suivant passe.
    await assertFails(fun("rose", "rose"));
    await new Promise((r) => setTimeout(r, 300));
    await assertSucceeds(fun("rose", "rose"));
    await assertFails(fun("rose", "bleu"));
    await assertFails(set(ref(db("rose"), `games/${CODE}/fun/rose`), { at: serverTimestamp(), extra: 1 }));
    await assertFails(set(ref(db("rose"), `games/${CODE}/fun/rose`), null));
    await assertSucceeds(get(ref(db("bleu"), `games/${CODE}/fun`)));
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/state/phase`), "question"));
    await new Promise((r) => setTimeout(r, 300));
    await assertFails(fun("bleu", "bleu"));
  });
});

describe("Pictionary", () => {
  const picto = (mime) => seed({ kind: "pictionary", qid: "r2p", choices: null, mime });
  const stroke = (uid, key, data = { c: "#1A0B2E", w: 2, p: "10,20 30,40" }) => set(ref(db(uid), `games/${CODE}/drawing/${key}/s${Math.random().toString(36).slice(2)}`), data);
  const choose = (uid, key, i) => set(ref(db(uid), `games/${CODE}/pictoChoice/${key}`), { i, at: serverTimestamp() });

  test("seule l'équipe à qui les mots sont proposés choisit, parmi les trois, sur la proposition en cours", async () => {
    await picto({ secret: "bleu", pickKey: "r2p-100" });
    await assertSucceeds(choose("bleu", "r2p-100", 2));
    await assertSucceeds(choose("bleu", "r2p-100", 0));
    await assertFails(choose("rose", "r2p-100", 1));
    await assertFails(choose("bleu", "r2p-99", 1));
    await assertFails(choose("bleu", "r2p-100", 3));
    await assertFails(set(ref(db("bleu"), `games/${CODE}/pictoChoice/r2p-100`), { i: 1, at: 5 }));
    await assertFails(set(ref(db("bleu"), `games/${CODE}/pictoChoice/r2p-100`), { i: 1, at: serverTimestamp(), points: 500 }));
  });

  test("seule l'équipe qui dessine envoie des traits, sur la clé du tour en cours, jamais en pause", async () => {
    await picto({ team: "rose", drawKey: "r2p-200" });
    await assertSucceeds(stroke("rose", "r2p-200"));
    await assertSucceeds(stroke("rose", "r2p-200", { clear: true }));
    await assertSucceeds(stroke("rose", "r2p-200", { c: "paper", w: 3, p: "0,0" }));
    await assertFails(stroke("bleu", "r2p-200"));
    await assertFails(stroke("rose", "r2p-199"));
    await assertFails(stroke("rose", "r2p-200", { c: "#1A0B2E", w: 9, p: "1,2 3,4" }));
    await assertFails(stroke("rose", "r2p-200", { c: "red", w: 2, p: "1,2 3,4" }));
    await assertFails(stroke("rose", "r2p-200", { c: "#1A0B2E", w: 2, p: "<script>" }));
    await assertFails(stroke("rose", "r2p-200", { c: "#1A0B2E", w: 2, p: "1,2", points: 150 }));
    // Tout le monde voit le dessin en direct (la TV, et les autres tablettes si besoin).
    await assertSucceeds(get(ref(db("bleu"), `games/${CODE}/drawing/r2p-200`)));
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/state/paused`), true));
    await assertFails(stroke("rose", "r2p-200"));
  });

  test("un trait ne se réécrit pas ; la box seule efface les dessins", async () => {
    await picto({ team: "rose", drawKey: "r2p-200" });
    const path = `games/${CODE}/drawing/r2p-200/s1`;
    await assertSucceeds(set(ref(db("rose"), path), { c: "#1A0B2E", w: 1, p: "1,1 2,2" }));
    await assertFails(set(ref(db("rose"), path), { c: "#F94144", w: 1, p: "1,1 2,2" }));
    await assertFails(set(ref(db("rose"), `games/${CODE}/drawing`), null));
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/drawing`), null));
  });

  test("hors Pictionary, rien ne s'écrit", async () => {
    await seed({ mime: { team: "rose", drawKey: "r2p-200", secret: "rose", pickKey: "k" } });
    await assertFails(stroke("rose", "r2p-200"));
    await assertFails(choose("rose", "k", 0));
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
    // Image floue : le verdict vient de la régie, jamais d'un pupitre.
    await assertSucceeds(command(REGIE, { type: "buzz_ok" }));
    await assertSucceeds(command(REGIE, { type: "buzz_ko" }));
    await assertFails(command("rose", { type: "buzz_ok" }));
    // Blind test : bon titre et bon artiste.
    await assertSucceeds(command(REGIE, { type: "buzz_bonus" }));
    await assertFails(command("rose", { type: "buzz_bonus" }));
    // Statues musicales : l'équipe gagnante désignée par la régie.
    await assertSucceeds(command(REGIE, { type: "statues_win", team: "rose" }));
    await assertFails(command("rose", { type: "statues_win", team: "rose" }));
    await assertFails(set(ref(db(REGIE), `games/${CODE}/commands/m-points`), { type: "mime_found", points: 50, expectSeq: 3, by: REGIE, at: serverTimestamp() }));
  });
  test("secours : la régie demande un saut de jeu ; seule la box efface les réponses d'un jeu rejoué", async () => {
    await paired();
    await assertSucceeds(command(REGIE, { type: "goto", index: 2, qid: "a1m" }));
    await assertFails(command(REGIE, { type: "goto", index: -1, qid: "q1" }));
    await assertFails(command(REGIE, { type: "goto", index: 0, qid: 12 }));
    // Dernières questions du quiz : ×2, ×3 ou ×5 seulement.
    await assertFails(command(REGIE, { type: "factor", factor: 4 }));
    await assertFails(command(REGIE, { type: "factor", factor: "5" }));
    await assertSucceeds(command(REGIE, { type: "factor", factor: 3 }));
    // Portes mystères : la valeur d'une porte, dans les bornes seulement.
    await assertSucceeds(command(REGIE, { type: "portes_set", qid: "p1", door: 2, value: -150 }));
    await assertFails(command(REGIE, { type: "portes_set", qid: "p1", door: 9, value: 100 }));
    await assertFails(command(REGIE, { type: "portes_set", qid: "p1", door: 0, value: 5000 }));
    await assertFails(command("rose", { type: "portes_set", qid: "p1", door: 0, value: 300 }));
    await assertSucceeds(answer("rose", 1));
    await assertFails(set(ref(db("rose"), `games/${CODE}/answers/q1`), null));
    await assertFails(set(ref(db(REGIE), `games/${CODE}/answers/q1`), null));
    await assertFails(set(ref(db(HOST), `games/${CODE}/answers/q1/rose`), { choice: 2, at: serverTimestamp() }));
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/answers/q1`), null));
    await assertSucceeds(answer("rose", 2));
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
  test("prestation « À compléter » sans prénom acceptée (brouillon, copie) ; « À venir » sans prénom refusée", async () => {
    const { childName, ...sansPrenom } = SHOW;
    await assertSucceeds(set(ref(admin(), "library/shows/s1"), { ...sansPrenom, status: "brouillon" }));
    await assertSucceeds(set(ref(admin(), "library/shows/s2"), { ...sansPrenom, status: "brouillon", copieDe: "L'anniversaire de Léa" }));
    await assertFails(set(ref(admin(), "library/shows/s3"), { ...sansPrenom, status: "publiee" }));
    await assertFails(set(ref(admin(), "library/shows/s4"), { ...sansPrenom, status: "brouillon", copieDe: "x".repeat(121) }));
  });
  test("contenus intégrés : l'administration retire et ajoute, la régie les lit sans pouvoir les changer", async () => {
    await seed({ phase: "lobby" });
    const ok = { off: ["soleil"], extra: [{ word: "arc-en-ciel" }], updatedAt: serverTimestamp() };
    await assertSucceeds(set(ref(admin(), "library/contents/chante"), ok));
    // Mots du Pictionary réglables comme les autres jeux intégrés ; un jeu inconnu, non.
    await assertSucceeds(set(ref(admin(), "library/contents/pictionary"), ok));
    await assertFails(set(ref(admin(), "library/contents/pirate"), ok));
    await assertFails(set(ref(admin(), "library/contents/chante"), { ...ok, pirate: true }));
    await assertFails(set(ref(admin(), "library/contents/chante"), { ...ok, off: ["x".repeat(81)] }));
    await assertSucceeds(set(ref(admin(), "library/contents/chante"), null));
    await assertSucceeds(set(ref(admin(), "library/contents/quisuis"), { extra: [{ answer: "Le kangourou", clues: ["Australie", "Poche"] }], updatedAt: serverTimestamp() }));
    // Qui suis-je ? : une image par personnage (identifiant de la bibliothèque d'images).
    await assertSucceeds(set(ref(admin(), "library/contents/quisuis"), { extra: [{ answer: "Le kangourou", clues: ["Australie", "Poche"] }], images: { "le kangourou": "0123456789abcdef" }, updatedAt: serverTimestamp() }));
    await assertFails(set(ref(admin(), "library/contents/quisuis"), { images: { "le kangourou": "pas-une-image" }, updatedAt: serverTimestamp() }));
    await regieByPassword("tel");
    await assertSucceeds(get(ref(db("tel"), "library/contents")));
    await assertFails(set(ref(db("tel"), "library/contents/quisuis"), ok));
    await assertFails(get(ref(db("rose"), "library/contents")));
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
  test("la régie charge une prestation au salon d'attente ; en partie et après la fin, elle ne modifie que le programme", async () => {
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
    // Après la fin, un jeu ajouté au programme permet de reprendre la partie ; recharger une autre prestation, non.
    await assertSucceeds(set(ref(db("tel"), `games/${CODE}/show`), { ...SNAPSHOT("tel"), id: "s5", base: "s3" }));
    await assertFails(set(ref(db("tel"), `games/${CODE}/show`), { ...SNAPSHOT("tel"), id: "s6" }));
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

describe("illustrations des questions", () => {
  beforeEach(() => seedAdmin(env, "sarah"));
  const PHOTO = "data:image/jpeg;base64,AAAA";
  const ID = "0123456789abcdef";

  test("l'administration range une photo, jamais remplacée en douce ; personne d'autre n'écrit", async () => {
    await assertSucceeds(set(ref(db("sarah"), `library/images/${ID}`), PHOTO));
    await assertFails(set(ref(db("sarah"), `library/images/${ID}`), "data:image/jpeg;base64,BBBB"));
    await assertFails(set(ref(db("sarah"), "library/images/pas-un-id"), PHOTO));
    await assertFails(set(ref(db("sarah"), "library/images/fedcba9876543210"), "javascript:alert(1)"));
    await assertFails(set(ref(db("sarah"), "library/images/fedcba9876543210"), `data:image/jpeg;base64,${"A".repeat(150001)}`));
    await assertFails(set(ref(db("rose"), "library/images/fedcba9876543210"), PHOTO));
    await assertSucceeds(set(ref(db("sarah"), `library/images/${ID}`), null));
  });
  test("bibliothèque : la fiche d'une image (nom, catégorie, mots-clés, retirée) s'écrit depuis l'administration seule, champs bornés", async () => {
    const fiche = (who, id, f) => set(ref(db(who), `library/medias/${id}`), { updatedAt: serverTimestamp(), ...f });
    await assertSucceeds(fiche("sarah", ID, { name: "Elsa", cat: "Dessins animés", tags: "reine, neige", createdAt: 1 }));
    await assertSucceeds(fiche("sarah", ID, { name: "Elsa", tags: "", hidden: true }));
    await assertFails(fiche("sarah", ID, { name: "" }));
    await assertFails(fiche("sarah", ID, { name: "x".repeat(81) }));
    await assertFails(fiche("sarah", ID, { name: "Elsa", cat: "x".repeat(41) }));
    await assertFails(fiche("sarah", ID, { name: "Elsa", tags: "x".repeat(301) }));
    await assertFails(fiche("sarah", ID, { name: "Elsa", hidden: "oui" }));
    await assertFails(fiche("sarah", ID, { name: "Elsa", data: PHOTO }));
    await assertFails(fiche("sarah", "pas-un-id", { name: "Elsa" }));
    await assertFails(set(ref(db("sarah"), `library/medias/${ID}`), { name: "Elsa", updatedAt: 5 }));
    await assertFails(fiche("rose", ID, { name: "Elsa" }));
    await assertSucceeds(set(ref(db("sarah"), `library/medias/${ID}`), null));
  });
  test("une question garde un émoji court et un identifiant de photo valide", async () => {
    const quiz = (q) => set(ref(db("sarah"), "library/quizzes/z"), {
      title: "Z", updatedAt: serverTimestamp(), questions: [{ text: "?", choices: ["a", "b"], correct: 0, status: "validee", ...q }],
    });
    await assertSucceeds(quiz({ image: "🦁", imageId: ID }));
    await assertFails(quiz({ image: "x".repeat(17) }));
    await assertFails(quiz({ imageId: "../../settings" }));
  });
  test("la régie copie une photo dans la partie ; la box la lit, les pupitres non", async () => {
    await seed({ phase: "lobby" });
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/tel`), { pairedAt: 1, via: "pin" }));
    await assertFails(set(ref(db("rose"), `games/${CODE}/images/${ID}`), PHOTO));
    await assertSucceeds(set(ref(db("tel"), `games/${CODE}/images/${ID}`), PHOTO));
    await assertFails(set(ref(db("tel"), `games/${CODE}/images/${ID}`), "data:image/jpeg;base64,BBBB"));
    await assertSucceeds(get(ref(db(HOST), `games/${CODE}/images/${ID}`)));
    await assertSucceeds(get(ref(db("tel"), `games/${CODE}/images/${ID}`)));
    await assertFails(get(ref(db("rose"), `games/${CODE}/images/${ID}`)));
  });
});

describe("réponses en images", () => {
  beforeEach(() => seedAdmin(env, "sarah"));
  const PHOTO = "data:image/jpeg;base64,AAAA";
  const ID = "0123456789abcdef";

  test("une question range une photo par case A à D, jamais autre chose", async () => {
    const quiz = (q) => set(ref(db("sarah"), "library/quizzes/z"), {
      title: "Z", updatedAt: serverTimestamp(), questions: [{ text: "?", choices: ["a", "b"], correct: 0, status: "validee", ...q }],
    });
    await assertSucceeds(quiz({ choiceImages: { 0: ID, 1: ID } }));
    await assertFails(quiz({ choiceImages: { 4: ID } }));
    await assertFails(quiz({ choiceImages: { 0: "../../settings" } }));
  });
  test("la régie copie les photos des réponses ; la box et les pupitres les lisent, personne d'autre n'écrit", async () => {
    await seed({ phase: "lobby" });
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/tel`), { pairedAt: 1, via: "pin" }));
    await assertFails(set(ref(db("rose"), `games/${CODE}/choiceImages/${ID}`), PHOTO));
    await assertFails(set(ref(db("tel"), `games/${CODE}/choiceImages/pas-un-id`), PHOTO));
    await assertSucceeds(set(ref(db("tel"), `games/${CODE}/choiceImages/${ID}`), PHOTO));
    await assertFails(set(ref(db("tel"), `games/${CODE}/choiceImages/${ID}`), "data:image/jpeg;base64,BBBB"));
    await assertSucceeds(get(ref(db(HOST), `games/${CODE}/choiceImages/${ID}`)));
    await assertSucceeds(get(ref(db("rose"), `games/${CODE}/choiceImages/${ID}`)));
    // Les photos d'illustration, qui peuvent montrer la réponse, restent invisibles aux pupitres.
    await assertFails(get(ref(db("rose"), `games/${CODE}/images/${ID}`)));
  });
});

describe("Le Juste Chiffre", () => {
  test("un nombre entier est accepté comme réponse, une seule fois ; jamais sur une question à propositions", async () => {
    await seed({ kind: "number", choices: null });
    await assertFails(answer("rose", 1.5));
    await assertFails(answer("rose", 1e10));
    await assertSucceeds(answer("rose", 206));
    await assertFails(answer("rose", 207));
    await assertSucceeds(answer("bleu", -3));
  });
  test("Vrai ou Faux express : Vrai ou Faux seulement, une seule fois", async () => {
    await seed({ kind: "express", choices: ["Vrai", "Faux"] });
    await assertFails(answer("rose", 2));
    await assertSucceeds(answer("rose", 1));
    await assertFails(answer("rose", 0));
    await assertSucceeds(answer("bleu", 0));
  });
  test("question à propositions : un nombre hors des propositions reste refusé", async () => {
    await seed({ kind: "classic" });
    await assertFails(answer("rose", 206));
    await assertSucceeds(answer("rose", 3));
  });
  test("l'administration enregistre une question du Juste Chiffre sans propositions", async () => {
    await seedAdmin(env, "sarah");
    await assertSucceeds(set(ref(db("sarah"), "library/quizzes/j"), {
      title: "Juste Chiffre", updatedAt: serverTimestamp(),
      questions: [{ text: "Combien d'os ?", kind: "number", correct: 206, status: "validee" }],
    }));
    await assertFails(set(ref(db("sarah"), "library/quizzes/k"), {
      title: "Cassé", updatedAt: serverTimestamp(), questions: [{ text: "Sans propositions", correct: 0, status: "validee" }],
    }));
  });
});

describe("blind test : extraits musicaux et playlists", () => {
  beforeEach(() => seedAdmin(env, "sarah"));
  const SOUND = "data:audio/mpeg;base64,SUQz";
  const ID = "0123456789abcdef";
  const playlist = (tracks, extra = {}) => set(ref(db("sarah"), "library/playlists/p"), { title: "Dessins animés", duration: 25, tracks, updatedAt: serverTimestamp(), ...extra });

  test("l'administration range un extrait MP3, jamais remplacé en douce ; personne d'autre n'écrit", async () => {
    await assertSucceeds(set(ref(db("sarah"), `library/sounds/${ID}`), SOUND));
    await assertFails(set(ref(db("sarah"), `library/sounds/${ID}`), "data:audio/mpeg;base64,AAAA"));
    await assertFails(set(ref(db("sarah"), "library/sounds/fedcba9876543210"), "data:text/html;base64,PHNjcmlwdD4="));
    await assertFails(set(ref(db("sarah"), "library/sounds/fedcba9876543210"), `data:audio/mpeg;base64,${"A".repeat(900001)}`));
    await assertFails(set(ref(db("rose"), "library/sounds/fedcba9876543210"), SOUND));
    await assertSucceeds(set(ref(db("sarah"), `library/sounds/${ID}`), null));
  });
  test("une playlist : titre, durée d'extrait, morceaux avec titre et extrait ; droits facultatifs", async () => {
    await assertSucceeds(playlist([{ title: "Libérée, délivrée", artist: "La Reine des neiges", audioId: ID, rights: "CD de Sarah" }, { title: "Hakuna Matata", audioId: ID }]));
    await assertFails(playlist([{ title: "", audioId: ID }]));
    await assertFails(playlist([{ title: "Sans extrait" }]));
    await assertFails(playlist([{ title: "Mauvais extrait", audioId: "../../settings" }]));
    await assertFails(playlist([{ title: "Champ en plus", audioId: ID, volume: 5 }]));
    // Blind test : valeur, pochette et durée propres à un morceau, barème de la playlist.
    await assertSucceeds(playlist([{ title: "Final", audioId: ID, points: 300, imageId: "fedcba9876543210", duration: 30 }], { points: 100, finalPoints: 200, finalCount: 3, reveal: 7 }));
    await assertFails(playlist([{ title: "Trop cher", audioId: ID, points: 5000 }]));
    await assertFails(playlist([{ title: "Pochette", audioId: ID, imageId: "../images" }]));
    // Révélation : jusqu'à 60 s, ou 0 = tout l'extrait (le temps de chanter).
    await assertSucceeds(playlist([{ title: "A", audioId: ID }], { reveal: 30 }));
    await assertSucceeds(playlist([{ title: "A", audioId: ID }], { reveal: 0 }));
    await assertFails(playlist([{ title: "A", audioId: ID }], { reveal: 61 }));
    await assertFails(playlist([{ title: "A", audioId: ID }], { reveal: 2 }));
    await assertFails(playlist([{ title: "A", audioId: ID }], { finalPoints: -1 }));
    await assertFails(playlist([{ title: "Trop long", audioId: ID }], { duration: 300 }));
    await assertFails(set(ref(db("rose"), "library/playlists/p"), { title: "X", duration: 25, tracks: [{ title: "A", audioId: ID }], updatedAt: serverTimestamp() }));
  });
  test("chansons des statues musicales : une liste marquée « statues », chansons jusqu'à 90 s, rien d'autre ne change", async () => {
    await assertSucceeds(playlist([{ title: "Danse des canards", audioId: ID }, { title: "Tourner", audioId: ID, duration: 90 }], { use: "statues", duration: 60 }));
    await assertSucceeds(playlist([{ title: "A", audioId: ID }], { use: "statues", duration: 90 }));
    await assertFails(playlist([{ title: "A", audioId: ID }], { use: "statues", duration: 120 }));
    await assertFails(playlist([{ title: "A", audioId: ID, duration: 120 }], { use: "statues", duration: 60 }));
    // Blind test : les extraits restent limités à 45 s ; pas d'autre usage que « statues ».
    await assertFails(playlist([{ title: "A", audioId: ID }], { duration: 60 }));
    await assertFails(playlist([{ title: "A", audioId: ID, duration: 60 }]));
    await assertFails(playlist([{ title: "A", audioId: ID }], { use: "karaoke" }));
  });
  test("bibliothèque des sons : chanson, préréglages et refrain ; les playlists la reprennent et la suivent", async () => {
    const REFRAIN = "fedcba9876543210";
    const song = (extra = {}) => set(ref(db("sarah"), "library/songs/s1"), { title: "Hakuna Matata", audioId: ID, buzz: 30, updatedAt: serverTimestamp(), ...extra });
    await assertSucceeds(song({ artist: "Le Roi lion", refrainId: REFRAIN, start: 12, refrain: 61, length: 214, createdAt: 1, imageId: REFRAIN, rights: "CD" }));
    await assertFails(song({ buzz: 60 }));
    await assertFails(song({ buzz: 5 }));
    await assertFails(song({ refrainId: "../sounds" }));
    await assertFails(song({ refrain: -3 }));
    await assertFails(song({ volume: 11 }));
    // Retirée de la bibliothèque (les playlists la gardent), puis remise.
    await assertSucceeds(song({ retiree: true }));
    await assertFails(song({ retiree: false }));
    await assertSucceeds(song());
    await assertFails(set(ref(db("sarah"), "library/songs/s1"), { title: "Sans date", audioId: ID, buzz: 30 }));
    await assertFails(set(ref(db("rose"), "library/songs/s2"), { title: "X", audioId: ID, buzz: 30, updatedAt: serverTimestamp() }));
    // Morceau de playlist : son refrain et sa chanson.
    await assertSucceeds(playlist([{ title: "Hakuna Matata", audioId: ID, refrainId: REFRAIN, songId: "s1", duration: 30 }]));
    await assertFails(playlist([{ title: "A", audioId: ID, refrainId: "pas-un-son" }]));
    await assertFails(playlist([{ title: "A", audioId: ID, songId: "x".repeat(41) }]));
    // Une chanson changée dans la bibliothèque : ses morceaux suivent, en une écriture avec la date de la playlist.
    await assertSucceeds(update(ref(db("sarah")), {
      "library/playlists/p/tracks/0": { title: "Hakuna Matata", audioId: REFRAIN, refrainId: ID, songId: "s1", duration: 35 },
      "library/playlists/p/updatedAt": serverTimestamp(),
    }));
    await assertSucceeds(set(ref(db("sarah"), "library/songs/s1"), null));
  });
  test("la régie copie un extrait dans la partie une seule fois ; la box le lit, les pupitres non", async () => {
    await seed({ phase: "lobby" });
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/tel`), { pairedAt: 1, via: "pin" }));
    await assertFails(set(ref(db("rose"), `games/${CODE}/sounds/${ID}`), SOUND));
    await assertSucceeds(set(ref(db("tel"), `games/${CODE}/sounds/${ID}`), SOUND));
    await assertFails(set(ref(db("tel"), `games/${CODE}/sounds/${ID}`), "data:audio/mpeg;base64,AAAA"));
    await assertFails(set(ref(db("tel"), `games/${CODE}/sounds/fedcba9876543210`), "data:image/jpeg;base64,AAAA"));
    await assertSucceeds(get(ref(db(HOST), `games/${CODE}/sounds/${ID}`)));
    await assertFails(get(ref(db("rose"), `games/${CODE}/sounds/${ID}`)));
  });
  test("la box dit à la régie si chaque extrait est prêt ; ni la régie ni un pupitre ne l'écrivent", async () => {
    await seed({ phase: "lobby" });
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/tel`), { pairedAt: 1, via: "pin" }));
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/media/${ID}`), "loading"));
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/media/${ID}`), "ok"));
    await assertFails(set(ref(db(HOST), `games/${CODE}/media/${ID}`), "peut-être"));
    await assertFails(set(ref(db(HOST), `games/${CODE}/media/pas-un-id`), "ok"));
    await assertFails(set(ref(db("tel"), `games/${CODE}/media/${ID}`), "missing"));
    await assertFails(set(ref(db("rose"), `games/${CODE}/media/${ID}`), "missing"));
    await assertSucceeds(get(ref(db("tel"), `games/${CODE}/media/${ID}`)));
    await assertFails(get(ref(db("rose"), `games/${CODE}/media/${ID}`)));
  });
  test("blind test : la régie lance, relance, réautorise, révèle, passe et raccourcit ; jamais un pupitre", async () => {
    await seed({ phase: "lobby" });
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/tel`), { pairedAt: 1, via: "pin" }));
    for (const type of ["blind_play", "blind_unblock", "blind_reveal", "blind_skip", "blind_cut"]) {
      await assertSucceeds(set(ref(db("tel"), `games/${CODE}/commands/${type}`), { type, expectSeq: 3, by: "tel", at: serverTimestamp() }));
      await assertFails(set(ref(db("rose"), `games/${CODE}/commands/${type}-rose`), { type, expectSeq: 3, by: "rose", at: serverTimestamp() }));
    }
  });
  test("Pictionary : la régie montre le mot et lance le dessin ; jamais un pupitre", async () => {
    await seed({ phase: "lobby" });
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/tel`), { pairedAt: 1, via: "pin" }));
    for (const type of ["picto_show", "picto_draw"]) {
      await assertSucceeds(set(ref(db("tel"), `games/${CODE}/commands/${type}`), { type, expectSeq: 3, by: "tel", at: serverTimestamp(), ...(type === "picto_show" ? { team: "rose" } : {}) }));
      await assertFails(set(ref(db("rose"), `games/${CODE}/commands/${type}-rose`), { type, expectSeq: 3, by: "rose", at: serverTimestamp() }));
    }
  });
});

describe("défis de la pause", () => {
  const SALT = "sel-de-test-0123456789";
  const hash = (password) => createHash("sha256").update(`${SALT}:${password}`).digest("hex");
  beforeEach(() => seedAdmin(env, "sarah"));
  async function regieByPassword(uid) {
    await env.withSecurityRulesDisabled((ctx) =>
      set(ref(ctx.database(), "settings/regie"), { salt: SALT, hash: hash("Licorne-2026"), updatedAt: 1 }));
    const d = db(uid);
    await set(ref(d, "regieGate/try"), { uid, at: serverTimestamp() });
    const gateAt = (await get(ref(d, "regieGate/try/at"))).val();
    await set(ref(d, `regieProof/${uid}`), { hash: hash("Licorne-2026"), gateAt, at: serverTimestamp() });
  }
  const DEFIS = { list: ["Tout le monde fait la ola !", "Un tonnerre d'applaudissements pour [prénom] !"], updatedAt: serverTimestamp() };

  test("la régie et l'administration modifient les défis, la TV les lit", async () => {
    await regieByPassword("tel");
    await assertSucceeds(set(ref(db("tel"), "settings/defis"), DEFIS));
    await assertSucceeds(set(ref(db("sarah"), "settings/defis"), { list: ["Dansez !"], updatedAt: serverTimestamp() }));
    // Tout effacer reste permis : la TV reprend alors ses défis intégrés.
    await assertSucceeds(set(ref(db("tel"), "settings/defis"), { updatedAt: serverTimestamp() }));
    await assertSucceeds(get(ref(db(HOST), "settings/defis")));
    await assertFails(get(ref(db(null), "settings/defis")));
  });
  test("un inconnu ou une équipe ne modifie pas les défis", async () => {
    await assertFails(set(ref(db("intrus"), "settings/defis"), DEFIS));
    await assertFails(set(ref(db(null), "settings/defis"), DEFIS));
  });
  test("défis mal formés refusés", async () => {
    await regieByPassword("tel");
    const avec = (list) => set(ref(db("tel"), "settings/defis"), { list, updatedAt: serverTimestamp() });
    await assertFails(avec([""]));
    await assertFails(avec(["x".repeat(121)]));
    await assertFails(avec(Array.from({ length: 31 }, (_, i) => `Défi ${i}`)));
    await assertFails(avec([42]));
    await assertFails(set(ref(db("tel"), "settings/defis"), { ...DEFIS, secret: 1 }));
    await assertFails(set(ref(db("tel"), "settings/defis"), { list: ["Dansez !"], updatedAt: 1 }));
    await assertSucceeds(avec(Array.from({ length: 30 }, (_, i) => `Défi ${i}`)));
  });
});

describe("Les Coffres mystères", () => {
  const chests = (extra = {}) => seed({
    kind: "coffres", qid: "r9c", choices: null, deadline: null,
    chests: { ready: true, count: 10, team: "bleu", key: "r9c-100-2", readyAt: Date.now() - 1000, ...extra },
  });
  const open = (uid, key, i, data = null) => set(ref(db(uid), `games/${CODE}/chestChoice/${key}`), data ?? { i, at: serverTimestamp() });

  test("seule l'équipe qui joue ouvre un coffre, une seule fois, sur l'ouverture en cours", async () => {
    await chests();
    await assertFails(open("rose", "r9c-100-2", 1), "pas le tour des Roses");
    await assertFails(open("bleu", "r9c-100-1", 1), "ancienne ouverture");
    await assertFails(open("bleu", "r9c-100-2", 10), "coffre qui n'existe pas");
    await assertFails(open("bleu", "r9c-100-2", 1.5));
    await assertFails(open("bleu", "r9c-100-2", 1, { i: 1, at: 5 }), "heure du serveur obligatoire");
    await assertFails(open("bleu", "r9c-100-2", 1, { i: 1, at: serverTimestamp(), delta: 300 }), "rien d'autre que le coffre choisi");
    await assertSucceeds(open("bleu", "r9c-100-2", 4));
    await assertFails(open("bleu", "r9c-100-2", 5), "un seul coffre par ouverture");
    // La box efface les choix ; personne d'autre.
    await assertFails(set(ref(db("bleu"), `games/${CODE}/chestChoice`), null));
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/chestChoice`), null));
  });

  test("rien ne s'ouvre pendant l'animation du coffre précédent, en pause, au décompte de reprise, ni hors du jeu", async () => {
    await chests({ readyAt: Date.now() + 60_000 });
    await assertFails(open("bleu", "r9c-100-2", 1), "animation pas finie");
    await chests();
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/state/paused`), true));
    await assertFails(open("bleu", "r9c-100-2", 1), "pause");
    await chests();
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/state/resumeAt`), Date.now() + 60_000));
    await assertFails(open("bleu", "r9c-100-2", 1), "décompte 3, 2, 1");
    await chests();
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/state/phase`), "reveal"));
    await assertFails(open("bleu", "r9c-100-2", 1), "bombe déjà ouverte");
    await seed({ kind: "quiz", chests: { team: "bleu", key: "r9c-100-2", readyAt: 0, count: 10 } });
    await assertFails(open("bleu", "r9c-100-2", 1), "pas dans ce jeu");
  });

  test("tablette remplacée : seul le nouvel appareil de l'équipe ouvre", async () => {
    await chests();
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/teams/bleu/device`), "tablette2"));
    await assertFails(open("bleu", "r9c-100-2", 1));
    await assertSucceeds(open("tablette2", "r9c-100-2", 1));
  });

  test("la régie envoie le coffre au hasard de secours", async () => {
    await chests();
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/tel`), { pairedAt: 1, via: "pin" }));
    const cmd = (type) => set(ref(db("tel"), `games/${CODE}/commands/c${Math.random().toString(36).slice(2)}`), { type, expectSeq: 3, by: "tel", at: serverTimestamp() });
    await assertSucceeds(cmd("chest_random"));
    await assertFails(cmd("chest_open"));
  });
});

describe("Le Gonfleur fou", () => {
  const course = (extra = {}) => seed({
    kind: "gonfleur", qid: "r9g", choices: null, resumeAt: Date.now() - 10_000,
    pump: { key: "r9g-100", goAt: Date.now() - 10_000, target: 100 }, ...extra,
  });
  const tape = (uid, n, team = uid, key = "r9g-100", data = null) =>
    set(ref(db(uid), `games/${CODE}/pumps/${key}/${team}`), data ?? { n, at: serverTimestamp() });

  test("chaque équipe envoie ses tapes, qui ne font que monter, sans dépasser l'éclatement", async () => {
    await course();
    await assertSucceeds(tape("bleu", 20));
    await assertSucceeds(tape("bleu", 20), "même nombre renvoyé");
    await assertSucceeds(tape("bleu", 55));
    await assertFails(tape("bleu", 40), "jamais en arrière");
    await assertFails(tape("bleu", 101), "au-delà de l'éclatement");
    await assertFails(tape("bleu", 60.5));
    await assertFails(tape("bleu", 60, "bleu", "r9g-100", { n: 60, at: 5 }), "heure du serveur obligatoire");
    await assertFails(tape("bleu", 60, "bleu", "r9g-100", { n: 60, at: serverTimestamp(), gagne: true }), "rien d'autre que les tapes");
    await assertFails(tape("rose", 30, "bleu"), "pas pour une autre équipe");
    await assertFails(tape("bleu", 30, "bleu", "r9g-99"), "ancienne course");
    await assertSucceeds(tape("bleu", 100));
    await assertSucceeds(tape("rose", 12));
    // La box efface les tapes ; personne d'autre.
    await assertFails(set(ref(db("bleu"), `games/${CODE}/pumps`), null));
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/pumps`), null));
  });

  test("pas plus de 20 tapes par seconde depuis le départ", async () => {
    await course({ pump: { key: "r9g-100", goAt: Date.now() - 1_000, target: 100 } });
    await assertSucceeds(tape("bleu", 25));
    await assertFails(tape("bleu", 60), "impossible en une seconde");
  });

  test("rien ne compte avant le départ, en pause, au décompte de reprise, ni hors de la course", async () => {
    await course({ pump: { key: "r9g-100", goAt: Date.now() + 3_000, target: 100 } });
    await assertFails(tape("bleu", 1), "avant « GONFLEZ ! »");
    await course({ paused: true });
    await assertFails(tape("bleu", 1), "pause");
    await course({ resumeAt: Date.now() + 60_000 });
    await assertFails(tape("bleu", 1), "décompte 3, 2, 1");
    await course({ phase: "reveal" });
    await assertFails(tape("bleu", 1), "course finie");
    await seed({ kind: "quiz", pump: { key: "r9g-100", goAt: 0, target: 100 } });
    await assertFails(tape("bleu", 1), "pas dans ce jeu");
  });

  test("tablette remplacée : seul le nouvel appareil de l'équipe tape", async () => {
    await course();
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/teams/bleu/device`), "tablette2"));
    await assertFails(tape("bleu", 5));
    await assertSucceeds(tape("tablette2", 5, "bleu"));
    await assertFails(tape("intrus", 5), "équipe inconnue");
  });
});

describe("Ça va exploser !", () => {
  const bombe = (potato = {}, extra = {}) => seed({
    kind: "patate", qid: "r9p", choices: null, deadline: null, resumeAt: Date.now() - 10_000,
    potato: { lit: true, holder: "bleu", from: null, canReturn: false, key: "r9p-100", readyAt: Date.now() - 1000, ...potato }, ...extra,
  });
  const passe = (uid, to, key = "r9p-100", data = null) => set(ref(db(uid), `games/${CODE}/potatoPass/${key}`), data ?? { to, at: serverTimestamp() });
  const troisEquipes = () => env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/teams/vert`), { name: "Les Verts", color: "#7CFF3A" }));

  test("seule l'équipe qui tient la bombe l'envoie, une fois, à une autre équipe", async () => {
    await bombe();
    await assertFails(passe("rose", "bleu"), "pas la bombe des Roses");
    await assertFails(passe("bleu", "bleu"), "pas à soi-même");
    await assertFails(passe("bleu", "inconnus"), "équipe qui n'existe pas");
    await assertFails(passe("bleu", "rose", "r9p-99"), "ancienne réception");
    await assertFails(passe("bleu", "rose", "r9p-100", { to: "rose", at: 5 }), "heure du serveur obligatoire");
    await assertFails(passe("bleu", "rose", "r9p-100", { to: "rose", at: serverTimestamp(), boom: true }));
    await assertSucceeds(passe("bleu", "rose"));
    await assertFails(passe("bleu", "rose"), "un seul envoi par réception");
    await assertFails(set(ref(db("bleu"), `games/${CODE}/potatoPass`), null));
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/potatoPass`), null));
  });

  test("pas de retour à l'envoyeur, sauf à 2 équipes", async () => {
    await bombe({ from: "rose" });
    await troisEquipes();
    await assertFails(passe("bleu", "rose"), "retour à l'envoyeur");
    await assertSucceeds(passe("bleu", "vert"));
    await bombe({ from: "rose", canReturn: true });
    await assertSucceeds(passe("bleu", "rose"));
  });

  test("la mèche qui colle, la pause, le décompte de reprise et les autres jeux bloquent l'envoi", async () => {
    await bombe({ readyAt: Date.now() + 60_000 });
    await assertFails(passe("bleu", "rose"), "mèche qui colle");
    await bombe({}, { paused: true });
    await assertFails(passe("bleu", "rose"), "pause");
    await bombe({}, { resumeAt: Date.now() + 60_000 });
    await assertFails(passe("bleu", "rose"), "décompte 3, 2, 1");
    await bombe({}, { phase: "reveal" });
    await assertFails(passe("bleu", "rose"), "déjà explosée");
    await seed({ kind: "quiz", potato: { holder: "bleu", key: "r9p-100", readyAt: 0 } });
    await assertFails(passe("bleu", "rose"), "pas dans ce jeu");
  });

  test("tablette remplacée : seul le nouvel appareil envoie ; la régie a son secours", async () => {
    await bombe();
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/teams/bleu/device`), "tablette2"));
    await assertFails(passe("bleu", "rose"));
    await assertSucceeds(passe("tablette2", "rose"));
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/tel`), { pairedAt: 1, via: "pin" }));
    await assertSucceeds(set(ref(db("tel"), `games/${CODE}/commands/cpot`), { type: "potato_random", expectSeq: 3, by: "tel", at: serverTimestamp() }));
  });
});

describe("activation des box", () => {
  const admin = () => db("sarah");
  beforeEach(() => seedAdmin(env, "sarah"));
  const demande = (uid, extra = {}) =>
    set(ref(db(uid), `boxes/requests/${uid}`), { code: "KX7P", model: "TCL Android TV", at: serverTimestamp(), ...extra });
  const accepter = (uid) => update(ref(admin(), "boxes"), {
    [`allowed/${uid}`]: { name: "TV du salon", model: "TCL Android TV", at: serverTimestamp() },
    [`requests/${uid}`]: null,
    lockOn: true,
  });

  test("une nouvelle box demande son activation, avec un code court et son modèle", async () => {
    await assertSucceeds(demande("tv1"));
    await assertSucceeds(get(ref(db("tv1"), "boxes/requests/tv1")));
    await assertFails(demande("tv1", { code: "kx7p" }));
    await assertFails(demande("tv1", { code: "KX7PQ" }));
    await assertFails(demande("tv1", { code: "OI00" }));
    await assertFails(demande("tv1", { model: "x".repeat(81) }));
    await assertFails(demande("tv1", { extra: true }));
    await assertFails(set(ref(db("tv1"), "boxes/requests/tv1"), { code: "KX7P", model: "TCL", at: 1 }));
  });
  test("une box ne peut ni demander pour une autre, ni lire les autres demandes", async () => {
    await demande("tv1");
    await assertFails(set(ref(db("tv2"), "boxes/requests/tv1"), { code: "AAAA", model: "Pirate", at: serverTimestamp() }));
    await assertFails(get(ref(db("tv2"), "boxes/requests/tv1")));
    await assertFails(get(ref(db("tv2"), "boxes/requests")));
    await assertFails(set(ref(db("tv1"), "boxes/requests/tv1"), null));
  });
  test("une box ne peut pas s'accepter elle-même", async () => {
    await assertFails(set(ref(db("tv1"), "boxes/allowed/tv1"), { name: "Moi", at: serverTimestamp() }));
    await assertFails(get(ref(db("tv1"), "boxes/allowed")));
  });
  test("la Régie PC voit les demandes, accepte une box, et la box le voit", async () => {
    await demande("tv1");
    await assertSucceeds(get(ref(admin(), "boxes/requests")));
    await assertSucceeds(accepter("tv1"));
    assert.equal((await get(ref(db("tv1"), "boxes/allowed/tv1"))).val().name, "TV du salon");
    assert.equal((await get(ref(admin(), "boxes/requests/tv1"))).val(), null);
    await assertSucceeds(set(ref(db("tv1"), "games/NEW04"), { hostUid: "tv1", state: { phase: "lobby" } }));
  });
  test("la Régie PC refuse une demande, renomme puis retire une box", async () => {
    await demande("tv1");
    await assertSucceeds(set(ref(admin(), "boxes/requests/tv1"), null));
    await demande("tv2");
    await accepter("tv2");
    await assertSucceeds(set(ref(admin(), "boxes/allowed/tv2/name"), "Mi Box de Sarah"));
    await assertFails(set(ref(admin(), "boxes/allowed/tv2/name"), ""));
    await assertSucceeds(set(ref(admin(), "boxes/allowed/tv2"), null));
    await assertFails(set(ref(db("tv2"), "games/NEW05"), { hostUid: "tv2", state: { phase: "lobby" } }));
  });
  test("une box retirée garde sa partie en cours : rien ne s'arrête pendant une fête", async () => {
    await allowBox(env, HOST);
    await seed();
    await assertSucceeds(set(ref(admin(), `boxes/allowed/${HOST}`), null));
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/state/phase`), "reveal"));
  });
  test("sans mot de passe administrateur, personne ne gère les box", async () => {
    await demande("tv1");
    await assertFails(get(ref(db("tel"), "boxes/requests")));
    await assertFails(set(ref(db("tel"), "boxes/requests/tv1"), null));
    await assertFails(set(ref(db("tel"), "boxes/allowed/tel"), { name: "Pirate", at: serverTimestamp() }));
    await assertFails(set(ref(db("tel"), "boxes/lockOn"), true));
  });
  test("le verrou, une fois en place, ne s'enlève pas", async () => {
    await accepter("tv1");
    assert.equal((await get(ref(db("tv1"), "boxes/lockOn"))).val(), true);
    await assertFails(set(ref(admin(), "boxes/lockOn"), null));
    await assertFails(set(ref(admin(), "boxes/lockOn"), false));
    await assertSucceeds(set(ref(admin(), "boxes/allowed/tv1"), null));
    await assertFails(set(ref(db("tv1"), "games/NEW07"), { hostUid: "tv1", state: { phase: "lobby" } }));
  });
});

describe("manches enregistrées (Régie PC et régie)", () => {
  const SALT = "sel-de-test-0123456789";
  const hash = (password) => createHash("sha256").update(`${SALT}:${password}`).digest("hex");
  beforeEach(() => seedAdmin(env, "sarah"));
  async function regieByPassword(uid) {
    await env.withSecurityRulesDisabled((ctx) =>
      set(ref(ctx.database(), "settings/regie"), { salt: SALT, hash: hash("Licorne-2026"), updatedAt: 1 }));
    const d = db(uid);
    await set(ref(d, "regieGate/try"), { uid, at: serverTimestamp() });
    const gateAt = (await get(ref(d, "regieGate/try/at"))).val();
    await set(ref(d, `regieProof/${uid}`), { hash: hash("Licorne-2026"), gateAt, at: serverTimestamp() });
  }
  const manche = (extra = {}) => ({
    type: "mimes", title: "Mimes du 20 octobre", origin: "admin", round: { type: "mimes", cards: [{ word: "Chat" }], perTeam: 3 },
    updatedAt: serverTimestamp(), ...extra,
  });

  test("la Régie PC compose, épingle, archive et supprime une manche", async () => {
    await assertSucceeds(set(ref(db("sarah"), "library/manches/m1"), manche({ createdAt: 1 })));
    await assertSucceeds(set(ref(db("sarah"), "library/manches/m1"), manche({ pinned: true })));
    await assertSucceeds(set(ref(db("sarah"), "library/manches/m1"), manche({ archived: true })));
    await assertSucceeds(set(ref(db("sarah"), "library/manches/m1"), null));
    // Quiz illustré : un jeu à part, ses manches aussi.
    await assertSucceeds(set(ref(db("sarah"), "library/manches/m6"), manche({ type: "illustre", title: "Les petits animaux", round: { type: "illustre", quizId: "petits" } })));
  });

  test("la régie ajoute une manche tirée en direct, sans pouvoir modifier ni effacer", async () => {
    await regieByPassword("tel");
    await assertFails(set(ref(db("tel"), "library/manches/m2"), manche()));
    await assertSucceeds(set(ref(db("tel"), "library/manches/m2"), manche({ origin: "direct" })));
    await assertFails(set(ref(db("tel"), "library/manches/m2"), manche({ origin: "direct", pinned: true })));
    await assertFails(set(ref(db("tel"), "library/manches/m2"), null));
    await assertSucceeds(set(ref(db("sarah"), "library/manches/m3"), manche()));
    await assertFails(set(ref(db("tel"), "library/manches/m3"), manche({ origin: "direct" })));
  });

  test("un inconnu ne lit ni n'écrit les manches ; manche mal formée refusée", async () => {
    await assertFails(set(ref(db("intrus"), "library/manches/m4"), manche({ origin: "direct" })));
    await assertFails(get(ref(db("intrus"), "library/manches")));
    await assertFails(set(ref(db("sarah"), "library/manches/m5"), manche({ type: "inconnu" })));
    await assertFails(set(ref(db("sarah"), "library/manches/m5"), manche({ round: { type: "quiz", quizId: "q" } })));
    await assertFails(set(ref(db("sarah"), "library/manches/m5"), manche({ title: "" })));
    await assertFails(set(ref(db("sarah"), "library/manches/m5"), manche({ pirate: true })));
  });
});
