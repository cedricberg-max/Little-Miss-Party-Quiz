// Règles de sécurité Firebase : ce qu'un pupitre, la box ou un inconnu ont le droit de faire.
// Lancé par `npm test` dans l'émulateur Firebase, jamais sur la vraie base.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadRules, seedAdmin, allowBox, adminHash, ADMIN_PASSWORD, ADMIN_SALT } from "./rules-loader.js";
import { after, before, beforeEach, describe, test } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { ref, get, set, update, serverTimestamp, query, orderByChild, equalTo } from "firebase/database";

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

/** Ancien pupitre (avant le 24/10) : l'équipe et sa couleur réservée dans la même écriture. */
const join = (uid, name, color, team = uid, code = CODE) =>
  update(ref(db(uid), `games/${code}`), { [`teams/${team}`]: { name, color }, [`colors/${color.slice(1).toUpperCase()}`]: uid });
/** La box fait entrer une équipe acceptée par la régie (nom et couleur choisis par l'animatrice). */
const admitByBox = (team, name, color, extra = {}) =>
  update(ref(db(HOST), `games/${CODE}`), {
    [`teams/${team}`]: { name, color, joinedAt: serverTimestamp() }, [`colors/${color.slice(1).toUpperCase()}`]: team,
    [`joinRequests/${team}`]: null, ...extra,
  });

describe("équipes", () => {
  test("salon d'attente (cedric, 24/10) : une tablette ne crée plus son équipe, elle demande à entrer sans rien choisir", async () => {
    await seed({ phase: "lobby" });
    await assertFails(join("vert", "Les Verts", "#06D6A0"));
    await assertFails(set(ref(db("vert"), `games/${CODE}/teams/vert`), { name: "Les Verts", color: "#06D6A0" }));
    await assertSucceeds(set(ref(db("vert"), `games/${CODE}/joinRequests/vert`), { at: serverTimestamp() }));
    // Une ancienne page encore ouverte envoie aussi un nom et une couleur : toujours accepté (la box les ignore si la régie en donne).
    await assertSucceeds(set(ref(db("jaune"), `games/${CODE}/joinRequests/jaune`), { name: "Les Jaunes", color: "#FFE600", at: serverTimestamp() }));
  });
  test("partie commencée : un nouvel appareil ne crée pas d'équipe seul, il demande à entrer", async () => {
    await seed();
    await assertFails(join("vert", "Les Verts", "#06D6A0"));
    await assertFails(join("rose", "Renommée", "#FF3CAC"));
    await assertSucceeds(set(ref(db("vert"), `games/${CODE}/joinRequests/vert`), { at: serverTimestamp() }));
  });
  test("seule la box inscrit une équipe et réserve sa couleur, jamais la régie ni une tablette", async () => {
    await seed({ phase: "lobby" });
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/tel`), { pairedAt: 1, via: "pin" }));
    await set(ref(db("vert"), `games/${CODE}/joinRequests/vert`), { at: serverTimestamp() });
    await assertFails(update(ref(db("tel"), `games/${CODE}`), { "teams/vert": { name: "Les Verts", color: "#06D6A0" }, "colors/06D6A0": "vert" }));
    await assertFails(join("vert", "Piratée", "#000000", "rose"));
    await assertSucceeds(admitByBox("vert", "Les Verts", "#06D6A0"));
    await assertFails(set(ref(db("vert"), `games/${CODE}/teams/vert/name`), "Renommée"));
    await assertFails(set(ref(db("vert"), `games/${CODE}/colors/06D6A0`), null));
  });
  test("nom vide ou trop long refusé, même pour la box", async () => {
    await seed({ phase: "lobby" });
    await assertFails(admitByBox("vert", "", "#06D6A0"));
    await assertFails(admitByBox("vert", "x".repeat(21), "#06D6A0"));
    await assertSucceeds(admitByBox("vert", "x".repeat(20), "#06D6A0"));
  });
  test("impossible de demander à entrer dans une partie qui n'existe pas", async () => {
    await assertFails(set(ref(db("vert"), "games/ZZZZZ/joinRequests/vert"), { at: serverTimestamp() }));
  });
  test("une couleur ne se réserve qu'avec l'équipe qui la porte", async () => {
    await seed({ phase: "lobby" });
    // Réserver une couleur sans équipe de cette couleur : refusé (pas de couleurs bloquées pour rien).
    await assertFails(set(ref(db(HOST), `games/${CODE}/colors/9B5DE5`), "personne"));
    await assertFails(set(ref(db("violet"), `games/${CODE}/colors/9B5DE5`), "violet"));
    await assertSucceeds(get(ref(db("violet"), `games/${CODE}/colors`)));
    // La box admet une équipe en cours de partie avec sa couleur.
    await assertSucceeds(admitByBox("tard", "En retard", "#9B5DE5"));
    assert.equal((await get(ref(db(HOST), `games/${CODE}/colors/9B5DE5`))).val(), "tard");
  });
  test("« régie ouverte » : publiée par la box seule, lue par toutes les tablettes", async () => {
    await seed({ phase: "lobby" });
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/tel`), { pairedAt: 1, via: "pin" }));
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/regieActive`), false));
    await assertSucceeds(get(ref(db("vert"), `games/${CODE}/regieActive`)));
    await assertFails(get(ref(db(null), `games/${CODE}/regieActive`)));
    await assertFails(set(ref(db("vert"), `games/${CODE}/regieActive`), true));
    await assertFails(set(ref(db("tel"), `games/${CODE}/regieActive`), true));
    await assertFails(set(ref(db(HOST), `games/${CODE}/regieActive`), "oui"));
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/regieActive`), true));
  });
  test("présence du téléphone (cedric, 30/10) : écrite par la régie reliée elle-même, lue par la box et la régie", async () => {
    await seed({ phase: "question" });
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/tel`), { pairedAt: 1, via: "pin" }));
    await assertSucceeds(set(ref(db("tel"), `games/${CODE}/regiePresence/tel`), { online: true, at: serverTimestamp() }));
    await assertSucceeds(get(ref(db(HOST), `games/${CODE}/regiePresence`)));
    await assertSucceeds(get(ref(db("tel"), `games/${CODE}/regiePresence`)));
    // Ni une tablette, ni un téléphone pas relié, ni pour un autre ; rien d'autre que « online » et « at ».
    await assertFails(get(ref(db("vert"), `games/${CODE}/regiePresence`)));
    await assertFails(set(ref(db("vert"), `games/${CODE}/regiePresence/vert`), { online: true, at: serverTimestamp() }));
    await assertFails(set(ref(db("espion"), `games/${CODE}/regiePresence/espion`), { online: true, at: serverTimestamp() }));
    await assertFails(set(ref(db("tel"), `games/${CODE}/regiePresence/autre`), { online: true, at: serverTimestamp() }));
    await assertFails(set(ref(db("tel"), `games/${CODE}/regiePresence/tel`), { online: "oui", at: serverTimestamp() }));
    await assertFails(set(ref(db("tel"), `games/${CODE}/regiePresence/tel`), { online: true, at: serverTimestamp(), nom: "Sarah" }));
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
  test("« 🏁 Fin de la fête » (cedric, 23/10) : la régie appairée envoie « newgame » ; seule la box marque la partie quittée", async () => {
    await paired();
    await assertSucceeds(command(REGIE, { type: "newgame" }));
    await assertFails(command("espion", { type: "newgame" }));
    await assertSucceeds(update(ref(db(HOST), `games/${CODE}/state`), { leftAt: serverTimestamp() }));
    await assertFails(update(ref(db(REGIE), `games/${CODE}/state`), { leftAt: serverTimestamp() }));
  });
  test("« 🏁 Fin de la fête » (cedric, 25/10) : la box relie la régie à la nouvelle partie et pointe la suite ; personne d'autre", async () => {
    await paired();
    const SUITE = "SUIT2";
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${SUITE}`), { hostUid: HOST, state: { phase: "lobby" } }));
    // La box (hôte des deux parties) recopie les régies, mot de passe ou code, puis écrit la suite sur l'ancienne.
    await assertSucceeds(update(ref(db(HOST), `games/${SUITE}`), {
      [`regie/${REGIE}`]: { pairedAt: serverTimestamp(), via: "password" },
      "regie/autre": { pairedAt: serverTimestamp(), via: "pin" },
    }));
    await assertSucceeds(update(ref(db(HOST), `games/${CODE}/state`), { phase: "ended", leftAt: serverTimestamp(), suite: SUITE }));
    await assertSucceeds(get(ref(db(REGIE), `games/${SUITE}/regie/${REGIE}`)));
    // Une régie ou une tablette ne s'ajoute pas seule à la nouvelle partie, ni n'écrit la suite.
    await assertFails(set(ref(db("espion"), `games/${SUITE}/regie/espion`), { pairedAt: serverTimestamp(), via: "pin" }));
    await assertFails(update(ref(db(REGIE), `games/${CODE}/state`), { suite: "PIRAT" }));
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
  test("« Accepter » une tablette (cedric, 24/10) : la régie donne le nom et la couleur de la nouvelle équipe", async () => {
    await paired();
    await assertSucceeds(command(REGIE, { type: "admit", device: "neuf", name: "Les Licornes", color: "#FF2D95" }));
    await assertFails(set(ref(db(REGIE), `games/${CODE}/commands/c2`), { type: "admit", device: "neuf", name: "", color: "#FF2D95", expectSeq: 3, by: REGIE, at: serverTimestamp() }));
    await assertFails(set(ref(db(REGIE), `games/${CODE}/commands/c3`), { type: "admit", device: "neuf", name: "x".repeat(21), color: "#FF2D95", expectSeq: 3, by: REGIE, at: serverTimestamp() }));
    await assertFails(set(ref(db(REGIE), `games/${CODE}/commands/c4`), { type: "admit", device: "neuf", name: "Les Licornes", color: "rose", expectSeq: 3, by: REGIE, at: serverTimestamp() }));
    await assertFails(command("rose", { type: "admit", device: "neuf", name: "Pirates", color: "#FF2D95" }));
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
    // Mimes en file (cedric, 26/10) : « ⏭ Passer » fait tourner les joueurs.
    await assertSucceeds(command(REGIE, { type: "mime_skip" }));
    await assertFails(command("rose", { type: "mime_skip" }));
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
    // Statues du 27/10 : plusieurs gagnantes, ou « Personne » (une liste vide ne s'écrit pas dans Firebase).
    const gagnantes = (id, body) => set(ref(db(REGIE), `games/${CODE}/commands/${id}`), { type: "statues_win", expectSeq: 3, by: REGIE, at: serverTimestamp(), ...body });
    await assertSucceeds(gagnantes("w1", { teams: ["rose", "bleu"] }));
    await assertSucceeds(gagnantes("w2", { personne: true }));
    await assertFails(gagnantes("w3", { personne: false }));
    // « ⛔ Arrêter la partie » (cedric, 29/10) : un « newgame » qui arrête tout, même partie en cours ; rien d'autre.
    const arret = (id, body) => set(ref(db(REGIE), `games/${CODE}/commands/${id}`), { expectSeq: 3, by: REGIE, at: serverTimestamp(), ...body });
    await assertSucceeds(arret("a1", { type: "newgame", arret: true }));
    await assertFails(arret("a2", { type: "newgame", arret: false }));
    await assertFails(arret("a3", { type: "next", arret: true }));
    await assertFails(set(ref(db("rose"), `games/${CODE}/commands/a4`), { type: "newgame", arret: true, expectSeq: 3, by: "rose", at: serverTimestamp() }));
    await assertFails(gagnantes("w4", { teams: ["x".repeat(129)] }));
    await assertFails(gagnantes("w5", { teams: { a: "rose" } }));
    for (const type of ["statues_stop", "statues_play", "statues_song"]) await assertSucceeds(command(REGIE, { type }));
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
  const regieByPin = (uid, code = CODE) => env.withSecurityRulesDisabled((ctx) =>
    set(ref(ctx.database(), `games/${code}/regie/${uid}`), { pairedAt: 1, via: "pin" }));
  /**
   * Comme « Lancer » sur la régie : le programme pour la box et le lancement de la prestation, en une seule écriture
   * (un anniversaire n'est jamais lancé sur deux box). [extra] : autres chemins de la même écriture (libération…).
   */
  const launch = (uid, prestation = "show1", { code = CODE, id = "s1", extra = {} } = {}) => update(ref(db(uid)), {
    [`games/${code}/show`]: { ...SNAPSHOT(uid), id, prestation },
    [`launches/${prestation}`]: { code, by: uid, at: serverTimestamp() },
    ...extra,
  });

  test("préchargement (cedric, 30/10) : une box acceptée lit les prestations du jour et leurs médias, rien d'autre", async () => {
    const AUJOURDHUI = "2026-12-02";
    await env.withSecurityRulesDisabled(async (ctx) => {
      const d = ctx.database();
      await set(ref(d, "library/shows/show1"), { ...SHOW, date: AUJOURDHUI, updatedAt: 1 });
      await set(ref(d, "library/shows/show2"), { ...SHOW, date: "2026-12-03", updatedAt: 1 });
      await set(ref(d, "library/quizzes/q1"), { ...QUIZ, updatedAt: 1 });
      await set(ref(d, "library/sounds/aaaaaaaaaaaaaaa1"), "data:audio/mpeg;base64,AAAA");
      await set(ref(d, "library/images/bbbbbbbbbbbbbbb1"), "data:image/jpeg;base64,AAAA");
      await set(ref(d, "library/entieres/chanson1"), { n: 1, kbps: 96, length: 180, at: 1, p: { 0: "AAAA" } });
      await set(ref(d, "library/songs/chanson1"), { title: "Chanson", audioId: "aaaaaaaaaaaaaaa1", buzz: 20, updatedAt: 1 });
      await set(ref(d, "library/playlists/p1"), { title: "Fête" });
      await set(ref(d, "library/mimes/m1"), { title: "Animaux" });
      await set(ref(d, "library/contents/quisuis/images/mario"), "bbbbbbbbbbbbbbb1");
      await set(ref(d, "library/manches/x1"), { type: "quiz", title: "Série" });
      await set(ref(d, "library/lyrics/chanson1"), "paroles");
    });
    await allowBox(env, "tv1");
    const tv = db("tv1");
    const duJour = await get(query(ref(tv, "library/shows"), orderByChild("date"), equalTo(AUJOURDHUI)));
    assert.deepEqual(Object.keys(duJour.val()), ["show1"], "seulement la prestation du jour");
    for (const chemin of ["library/quizzes/q1", "library/sounds/aaaaaaaaaaaaaaa1", "library/images/bbbbbbbbbbbbbbb1", "library/entieres/chanson1",
      "library/songs/chanson1", "library/playlists/p1", "library/mimes/m1", "library/contents/quisuis/images"]) {
      await assertSucceeds(get(ref(tv, chemin)));
    }
    // Ni les séries, ni les paroles, ni l'écriture : la box ne fait que lire ce qu'elle copie.
    await assertFails(get(ref(tv, "library/manches/x1")));
    await assertFails(get(ref(tv, "library/lyrics/chanson1")));
    await assertFails(get(ref(tv, "library")));
    await assertFails(set(ref(tv, "library/sounds/aaaaaaaaaaaaaaa2"), "data:audio/mpeg;base64,AAAA"));
    await assertFails(set(ref(tv, "library/shows/show1/date"), "2026-12-03"));
    // Une box jamais acceptée, une tablette ou un inconnu ne lisent rien de la bibliothèque.
    for (const qui of ["tv-inconnue", "rose", null]) {
      await assertFails(get(ref(db(qui), "library/shows/show1")));
      await assertFails(get(ref(db(qui), "library/sounds/aaaaaaaaaaaaaaa1")));
    }
  });

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
  test("la régie charge une prestation au salon d'attente ; en partie, la box juge ; après la fin, elle ne modifie que le programme", async () => {
    await seed({ phase: "lobby" });
    await regieByPin("tel");
    // Une prestation se charge toujours avec son lancement : sans lui, le serveur refuse.
    await assertFails(set(ref(db("tel"), `games/${CODE}/show`), SNAPSHOT("tel")));
    await assertFails(set(ref(db("tel"), `games/${CODE}/show`), { ...SNAPSHOT("tel"), prestation: "show1" }));
    await assertSucceeds(launch("tel"));
    await assertSucceeds(get(ref(db("tel"), `games/${CODE}/show`)));
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/state/phase`), "question"));
    // Mauvaise prestation : en pleine partie, une autre prestation passe encore ; la box la refuse si un point a été donné.
    await assertSucceeds(launch("tel", "show2", { id: "s2", extra: { "launches/show1": null } }));
    await assertSucceeds(set(ref(db("tel"), `games/${CODE}/show`), { ...SNAPSHOT("tel"), id: "s3", base: "s2" }));
    await assertFails(set(ref(db("rose"), `games/${CODE}/show`), { ...SNAPSHOT("rose"), id: "s4", base: "s3" }));
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/state/phase`), "ended"));
    // Après la fin, un jeu ajouté au programme permet de reprendre la partie ; recharger une autre prestation, non.
    await assertSucceeds(set(ref(db("tel"), `games/${CODE}/show`), { ...SNAPSHOT("tel"), id: "s5", base: "s3" }));
    await assertFails(launch("tel", "show3", { id: "s6" }));
  });
  test("une équipe ne charge rien et ne lit pas les réponses de la prestation", async () => {
    await seed({ phase: "lobby" });
    await assertFails(launch("rose"));
    await regieByPin("tel");
    await launch("tel");
    await assertFails(get(ref(db("rose"), `games/${CODE}/show`)));
    await assertFails(set(ref(db("tel"), `games/${CODE}/showStatus`), { id: "s1", status: "applied" }));
    await assertFails(update(ref(db("tel")), {
      [`games/${CODE}/show`]: { ...SNAPSHOT("rose"), id: "s7", prestation: "show1" },
      "launches/show1": { code: CODE, by: "tel", at: serverTimestamp() },
    }));
  });
  test("la box publie le titre et le prénom, lisibles par tous les pupitres", async () => {
    await seed({ phase: "lobby" });
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/public`), { title: "L'anniversaire de Léa", childName: "Léa" }));
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/showStatus`), { id: "s1", status: "applied" }));
    await assertSucceeds(get(ref(db("rose"), `games/${CODE}/public`)));
    await assertFails(set(ref(db("rose"), `games/${CODE}/public`), { title: "Pirate" }));
    // La prestation jouée (régie et règles des lancements) ; jamais un texte démesuré.
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/public`), { title: "L'anniversaire de Léa", prestation: "show1" }));
    await assertFails(set(ref(db(HOST), `games/${CODE}/public`), { title: "L'anniversaire de Léa", prestation: "x".repeat(41) }));
  });

  describe("lancements : un anniversaire sur une seule box à la fois", () => {
    const AUTRE = "FGHJK";
    /** Deux salons d'attente, chacun avec sa box et le téléphone de son animatrice (relié par le mot de passe). */
    async function twoLobbies({ prestation = null } = {}) {
      await seed({ phase: "lobby" });
      await env.withSecurityRulesDisabled(async (ctx) => {
        const d = ctx.database();
        await set(ref(d, `games/${AUTRE}`), { hostUid: "box2", state: { phase: "lobby", round: 1 }, public: { title: "Quiz", changeBox: true } });
        if (prestation) await set(ref(d, `games/${CODE}/public`), { title: "Quiz", prestation });
      });
      await regieByPassword("tel");
      await regieByPin("tel2", AUTRE);
    }
    const seeLaunch = async (prestation) => (await get(ref(db("tel"), `launches/${prestation}`))).val();
    const writeRaw = (path, value) => env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), path), value));

    test("lancée sur une partie, la prestation ne se lance pas sur une autre box ; une autre prestation, si", async () => {
      await twoLobbies();
      await assertSucceeds(launch("tel"));
      assert.equal((await seeLaunch("show1")).code, CODE);
      await assertFails(launch("tel2", "show1", { code: AUTRE }));
      await assertSucceeds(launch("tel2", "show2", { code: AUTRE }));
      // Le même téléphone relance sa prestation sur sa propre partie (TV qui n'a pas répondu) : rien ne bloque.
      await assertSucceeds(launch("tel", "show1", { id: "s2" }));
    });

    test("deux régies lancent la même prestation au même instant : une seule écriture passe", async () => {
      await twoLobbies();
      const results = await Promise.allSettled([launch("tel"), launch("tel2", "show1", { code: AUTRE })]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "exactement une box gagne");
      const winner = (await seeLaunch("show1")).code;
      const loser = winner === CODE ? AUTRE : CODE;
      // Écriture refusée en entier : la box perdante ne reçoit jamais le programme.
      await env.withSecurityRulesDisabled(async (ctx) => {
        const d = ctx.database();
        assert.equal((await get(ref(d, `games/${loser}/show`))).exists(), false);
        assert.equal((await get(ref(d, `games/${winner}/show/prestation`))).val(), "show1");
      });
    });

    test("pas de programme sans son lancement, pas de lancement sans son programme, jamais pour la partie d'une autre", async () => {
      await twoLobbies();
      await assertFails(set(ref(db("tel"), "launches/show1"), { code: CODE, by: "tel", at: serverTimestamp() }));
      await assertFails(update(ref(db("tel")), {
        [`games/${CODE}/show`]: { ...SNAPSHOT("tel"), prestation: "show1" },
        "launches/show1": { code: AUTRE, by: "tel", at: serverTimestamp() },
      }));
      await assertFails(update(ref(db("tel")), {
        [`games/${CODE}/show`]: { ...SNAPSHOT("tel"), prestation: "show1" },
        "launches/show2": { code: CODE, by: "tel", at: serverTimestamp() },
      }));
      // Une modification du programme en cours de partie (base) n'a pas besoin de lancement.
      await assertSucceeds(set(ref(db("tel"), `games/${CODE}/show`), { ...SNAPSHOT("tel"), base: "initial" }));
      await assertFails(launch("tel", "x".repeat(41)));
      await assertFails(update(ref(db("tel")), {
        [`games/${CODE}/show`]: { ...SNAPSHOT("tel"), prestation: "show1" },
        "launches/show1": { code: CODE, by: "tel", at: serverTimestamp(), pirate: true },
      }));
    });

    test("remplacer la prestation libère la précédente dans la même écriture ; seule sa partie peut la libérer", async () => {
      await twoLobbies();
      await assertSucceeds(launch("tel"));
      await assertFails(set(ref(db("tel2"), "launches/show1"), null), "pas la partie de ce téléphone");
      await writeRaw(`games/${CODE}/public/prestation`, "show1");
      await assertFails(set(ref(db("tel"), "launches/show1"), null), "la TV la joue encore");
      await assertSucceeds(launch("tel", "show2", { id: "s2", extra: { "launches/show1": null } }));
      assert.equal(await seeLaunch("show1"), null);
      await assertSucceeds(launch("tel2", "show1", { code: AUTRE }));
    });

    test("TV qui refuse : la régie libère la prestation refusée et rend sa place à la précédente", async () => {
      await twoLobbies({ prestation: "show1" });
      await writeRaw("launches/show1", { code: CODE, by: "tel", at: Date.now() });
      await assertSucceeds(launch("tel", "show2", { id: "s2", extra: { "launches/show1": null } }));
      // La TV a refusé (des points avaient été donnés) : elle joue toujours show1.
      await assertSucceeds(update(ref(db("tel")), {
        "launches/show2": null,
        "launches/show1": { code: CODE, by: "tel", at: serverTimestamp() },
      }));
      assert.equal((await seeLaunch("show1")).code, CODE);
      assert.equal(await seeLaunch("show2"), null);
      // Jamais pour une prestation que la TV ne joue pas.
      await assertFails(update(ref(db("tel")), { "launches/show3": { code: CODE, by: "tel", at: serverTimestamp() } }));
    });

    test("une prestation se relance ailleurs quand sa fête est terminée, sa partie effacée, ou son lancement abandonné", async () => {
      await twoLobbies();
      await assertSucceeds(launch("tel"));
      await writeRaw(`games/${CODE}/state/phase`, "ended");
      await assertSucceeds(launch("tel2", "show1", { code: AUTRE }), "fête terminée");
      await writeRaw("launches/show2", { code: "ZZZZZ", by: "tel", at: Date.now() });
      await assertSucceeds(launch("tel2", "show2", { code: AUTRE, id: "s2" }), "partie effacée");
      // Box qui n'a jamais chargé la prestation (éteinte, refus) : libre au bout de 2 minutes, jamais avant.
      await writeRaw(`games/${CODE}/state/phase`, "question");
      await writeRaw("launches/show3", { code: CODE, by: "tel", at: Date.now() - 30_000 });
      await assertFails(launch("tel2", "show3", { code: AUTRE, id: "s3" }));
      await writeRaw("launches/show3/at", Date.now() - 200_000);
      await writeRaw(`games/${CODE}/public`, { title: "Quiz", prestation: "show3" });
      await assertFails(launch("tel2", "show3", { code: AUTRE, id: "s3" }), "la box la joue : fête en cours");
      await writeRaw(`games/${CODE}/public`, { title: "Quiz", prestation: "show9" });
      await assertSucceeds(launch("tel2", "show3", { code: AUTRE, id: "s3" }));
    });

    test("les lancements se lisent par la régie (mot de passe) et la Régie PC ; ni une équipe, ni une box, ni le code de secours", async () => {
      await twoLobbies();
      await launch("tel");
      await assertSucceeds(get(ref(db("tel"), "launches")));
      await assertSucceeds(get(ref(admin(), "launches")));
      await assertFails(get(ref(db("tel2"), "launches")));
      await assertFails(get(ref(db("rose"), "launches/show1")));
      await assertFails(get(ref(db(HOST), "launches")));
    });

    test("présence de la box : seule la box hôte l'écrit, tout le monde la lit ; après un changement de box, l'ancienne n'écrit plus rien", async () => {
      await twoLobbies();
      const here = { online: true, at: serverTimestamp(), uid: HOST };
      await assertSucceeds(set(ref(db(HOST), `games/${CODE}/hostOnline`), here));
      await assertSucceeds(set(ref(db(HOST), `games/${CODE}/hostOnline`), { ...here, online: false, at: Date.now() }));
      await assertFails(set(ref(db(HOST), `games/${CODE}/hostOnline`), { ...here, uid: "box2" }));
      await assertFails(set(ref(db(HOST), `games/${CODE}/hostOnline`), { ...here, pirate: 1 }));
      await assertFails(set(ref(db("rose"), `games/${CODE}/hostOnline`), { ...here, uid: "rose" }));
      await assertFails(set(ref(db("tel"), `games/${CODE}/hostOnline`), { ...here, uid: "tel" }));
      await assertSucceeds(get(ref(db("rose"), `games/${CODE}/hostOnline`)));
      await assertSucceeds(get(ref(db("tel2"), `games/${CODE}/hostOnline`)));
      // La fête a été confiée à la box 2 : l'ancienne box ne pilote plus rien, même sa présence.
      await writeRaw(`games/${CODE}/hostUid`, "box2");
      await assertFails(set(ref(db(HOST), `games/${CODE}/hostOnline`), here));
      await assertFails(set(ref(db(HOST), `games/${CODE}/state/phase`), "question"));
      await assertFails(set(ref(db(HOST), `games/${CODE}/public`), { title: "Quiz", prestation: "show1" }));
      await assertSucceeds(set(ref(db("box2"), `games/${CODE}/hostOnline`), { ...here, uid: "box2" }));
    });
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
  test("paroles des chansons (.lrc) : le fichier rangé par l'administration, les paroles du refrain dans la chanson et ses morceaux", async () => {
    const REFRAIN = "fedcba9876543210";
    const song = (extra = {}) => set(ref(db("sarah"), "library/songs/s1"), { title: "On chante", audioId: ID, buzz: 30, updatedAt: serverTimestamp(), ...extra });
    await assertSucceeds(song({ refrainId: REFRAIN, lrc: true, paroles: "1000|On chante tous ensemble", auto: true }));
    await assertFails(song({ lrc: false }));
    await assertFails(song({ auto: "oui" }));
    await assertFails(song({ paroles: "x".repeat(8001) }));
    const lrc = "[00:20.00]On chante tous ensemble";
    await assertSucceeds(set(ref(db("sarah"), "library/lyrics/s1"), lrc));
    await assertFails(set(ref(db("sarah"), "library/lyrics/s1"), "x".repeat(60001)));
    await assertFails(set(ref(db("sarah"), "library/lyrics/s1"), 12));
    await assertFails(set(ref(db("rose"), "library/lyrics/s2"), lrc));
    await assertFails(get(ref(db("rose"), "library/lyrics/s1")));
    await assertSucceeds(set(ref(db("sarah"), "library/lyrics/s1"), null));
    await assertSucceeds(playlist([{ title: "On chante", audioId: ID, refrainId: REFRAIN, songId: "s1", paroles: "1000|On chante tous ensemble" }]));
    await assertFails(playlist([{ title: "On chante", audioId: ID, paroles: "x".repeat(8001) }]));
  });
  test("chansons entières (21/10) : rangées par l'administration en parts, lues par l'administration et la régie, effacées pour de bon", async () => {
    const PART = "SUQzBAAAAAAA".repeat(1000);
    await assertSucceeds(set(ref(db("sarah"), "library/entieres/s1/p/0"), PART));
    await assertSucceeds(set(ref(db("sarah"), "library/entieres/s1/p/23"), PART));
    await assertSucceeds(update(ref(db("sarah"), "library/entieres/s1"), { n: 2, kbps: 96, length: 213, at: serverTimestamp() }));
    // Une part trop lourde, en trop, vide, ou pas du texte ; un nombre de parts faux ; une date inventée ; un champ inconnu.
    await assertFails(set(ref(db("sarah"), "library/entieres/s1/p/1"), "A".repeat(800001)));
    await assertFails(set(ref(db("sarah"), "library/entieres/s1/p/24"), PART));
    await assertFails(set(ref(db("sarah"), "library/entieres/s1/p/1"), ""));
    await assertFails(set(ref(db("sarah"), "library/entieres/s1/p/1"), 12));
    await assertFails(update(ref(db("sarah"), "library/entieres/s1"), { n: 25 }));
    await assertFails(update(ref(db("sarah"), "library/entieres/s1"), { n: 1.5 }));
    await assertFails(update(ref(db("sarah"), "library/entieres/s1"), { at: 12 }));
    await assertFails(update(ref(db("sarah"), "library/entieres/s1"), { volume: 11 }));
    await assertFails(set(ref(db("sarah"), `library/entieres/${"x".repeat(41)}/p/0`), PART));
    // Personne d'autre n'écrit ; un pupitre ne lit pas.
    await assertFails(set(ref(db("rose"), "library/entieres/s2/p/0"), PART));
    await assertFails(get(ref(db("rose"), "library/entieres/s1")));
    await assertSucceeds(get(ref(db("sarah"), "library/entieres/s1")));
    // « Effacer pour de bon » : la chanson, sa chanson entière, ses paroles et son extrait, d'un coup.
    await assertSucceeds(set(ref(db("sarah"), "library/songs/s1"), { title: "On chante", audioId: ID, buzz: 30, updatedAt: serverTimestamp() }));
    await assertSucceeds(set(ref(db("sarah"), `library/sounds/${ID}`), SOUND));
    await assertSucceeds(update(ref(db("sarah")), { "library/songs/s1": null, "library/entieres/s1": null, "library/lyrics/s1": null, [`library/sounds/${ID}`]: null }));
    assert.equal((await get(ref(db("sarah"), "library/entieres/s1"))).exists(), false);
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
  test("statues : la régie copie une chanson entière dans la partie, part par part, une seule fois ; la box la lit, les pupitres non", async () => {
    await seed({ phase: "lobby" });
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/tel`), { pairedAt: 1, via: "pin" }));
    const PART = "A".repeat(1000);
    const chanson = `games/${CODE}/songs/c-1`;
    await assertFails(set(ref(db("rose"), `${chanson}/p/0`), PART));
    await assertFails(set(ref(db(HOST), `${chanson}/p/0`), PART));
    await assertSucceeds(set(ref(db("tel"), `${chanson}/p/0`), PART));
    await assertSucceeds(set(ref(db("tel"), `${chanson}/p/1`), PART));
    await assertFails(set(ref(db("tel"), `${chanson}/p/2`), "A".repeat(800001)));
    await assertFails(set(ref(db("tel"), `${chanson}/p/24`), PART));
    await assertFails(set(ref(db("tel"), `${chanson}/at`), 1));
    await assertFails(set(ref(db("tel"), `games/${CODE}/songs/${"x".repeat(41)}/p/0`), PART));
    await assertFails(update(ref(db("tel"), chanson), { n: 25, kbps: 96, length: 213 }));
    // `n` écrit en dernier : la copie est finie, plus personne ne la touche.
    await assertSucceeds(update(ref(db("tel"), chanson), { n: 2, kbps: 96, length: 213 }));
    await assertFails(set(ref(db("tel"), `${chanson}/p/0`), "B"));
    await assertFails(set(ref(db("tel"), chanson), null));
    await assertSucceeds(get(ref(db(HOST), chanson)));
    await assertSucceeds(get(ref(db("tel"), chanson)));
    await assertFails(get(ref(db("rose"), chanson)));
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

  test("un renvoi pas encore permis (readyAt), la pause, le décompte de reprise et les autres jeux bloquent l'envoi", async () => {
    // Depuis le 27/10, la box permet le renvoi dès la réception (readyAt = réception) ; la règle reste pour les box d'avant.
    await bombe({ readyAt: Date.now() + 60_000 });
    await assertFails(passe("bleu", "rose"), "renvoi pas encore permis");
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

describe("Le Duel des robots", () => {
  const face = (duel = {}, extra = {}) => seed({
    kind: "duel", qid: "r9d", choices: null, deadline: null,
    duel: { n: 1, teams: ["bleu", "rose"], players: [1, 1], step: "standoff", key: "r9d-1-100", ...duel }, ...extra,
  });
  const buzz = (uid, team = uid, key = "r9d-1-100", data = null) =>
    set(ref(db(uid), `games/${CODE}/duel/${key}/${team}`), data ?? { t: Date.now(), at: serverTimestamp() });
  const troisEquipes = () => env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/teams/vert`), { name: "Les Verts", color: "#7CFF3A" }));

  test("chaque équipe du duel buzze une fois pendant le face-à-face, avec l'heure de son appui", async () => {
    await face();
    await troisEquipes();
    await assertFails(buzz("vert"), "pas dans ce duel");
    await assertFails(buzz("bleu", "rose"), "jamais pour une autre équipe");
    await assertFails(buzz("bleu", "bleu", "r9d-1-99"), "ancien face-à-face");
    await assertFails(buzz("bleu", "bleu", "r9d-1-100", { t: Date.now(), at: 5 }), "heure du serveur obligatoire");
    await assertFails(buzz("bleu", "bleu", "r9d-1-100", { at: serverTimestamp() }), "heure de l'appui obligatoire");
    await assertFails(buzz("bleu", "bleu", "r9d-1-100", { t: Date.now(), at: serverTimestamp(), gagne: true }));
    await assertFails(buzz("bleu", "bleu", "r9d-1-100", { t: Date.now(), at: serverTimestamp(), r: "vite" }), "mesures en nombres");
    // Avec les mesures de l'horloge fine (aller-retour, décalage), pour les rapports de la box.
    await assertSucceeds(buzz("bleu", "bleu", "r9d-1-100", { t: Date.now(), at: serverTimestamp(), r: 42, o: -180 }));
    await assertFails(buzz("bleu"), "un seul buzz par face-à-face");
    await assertSucceeds(buzz("rose"));
    await assertFails(set(ref(db("bleu"), `games/${CODE}/duel`), null));
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/duel`), null));
  });

  test("ni avant le lancement, ni après le bilan, ni en pause, ni dans un autre jeu", async () => {
    await face({ step: "ready" });
    await assertFails(buzz("bleu"), "duel prêt, pas lancé");
    await face({ step: "result" });
    await assertFails(buzz("bleu"), "duel jugé");
    await face({}, { paused: true });
    await assertFails(buzz("bleu"), "pause");
    await seed({ kind: "quiz", duel: { teams: ["bleu", "rose"], step: "standoff", key: "r9d-1-100" } });
    await assertFails(buzz("bleu"), "pas dans ce jeu");
  });

  test("horloge fine : chaque tablette pose l'heure du serveur sous son équipe, la box sous « box », personne d'autre", async () => {
    await face({ step: "ready" });
    const pose = (uid, k, data = { at: serverTimestamp() }) => set(ref(db(uid), `games/${CODE}/horloge/${k}`), data);
    await assertSucceeds(pose("bleu", "bleu"));
    await assertSucceeds(pose("bleu", "bleu"), "plusieurs mesures de suite");
    await assertFails(pose("bleu", "rose"), "jamais pour une autre équipe");
    await assertFails(pose("bleu", "box"));
    await assertSucceeds(pose(HOST, "box"));
    await assertFails(pose("bleu", "bleu", { at: 5 }), "heure du serveur obligatoire");
    await assertFails(pose("bleu", "bleu", { at: serverTimestamp(), x: 1 }));
    await assertFails(set(ref(db("inconnu"), `games/${CODE}/horloge/inconnu`), { at: serverTimestamp() }), "pas une équipe");
    assert.equal(typeof (await get(ref(db("rose"), `games/${CODE}/horloge/bleu/at`))).val(), "number");
  });

  test("tablette remplacée : seul le nouvel appareil buzze ; la régie lance, prépare et arrête les duels", async () => {
    await face();
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/teams/bleu/device`), "tablette2"));
    await assertFails(buzz("bleu"));
    await assertSucceeds(buzz("tablette2", "bleu"));
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/tel`), { pairedAt: 1, via: "pin" }));
    for (const [id, cmd] of [["d1", { type: "duel_start" }], ["d2", { type: "duel_start", teams: ["bleu", "rose"] }], ["d3", { type: "duel_next" }], ["d4", { type: "duel_stop" }]]) {
      await assertSucceeds(set(ref(db("tel"), `games/${CODE}/commands/${id}`), { ...cmd, expectSeq: 3, by: "tel", at: serverTimestamp() }), cmd.type);
    }
  });
});

describe("Le Chrono de Buzzy", () => {
  const tour = (chrono = {}, extra = {}) => seed({
    kind: "chrono", qid: "r9h", choices: null, deadline: null,
    chrono: { tour: 1, cible: 30, step: "run", key: "r9h-1-100", goAt: Date.now() - 5_000, teams: ["bleu", "rose"], ...chrono }, ...extra,
  });
  const buzz = (uid, team = uid, key = "r9h-1-100", data = null) =>
    set(ref(db(uid), `games/${CODE}/chrono/${key}/${team}`), data ?? { t: Date.now(), at: serverTimestamp() });
  const troisEquipes = () => env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/teams/vert`), { name: "Les Verts", color: "#7CFF3A" }));

  test("chaque équipe du tour buzze une seule fois, avec l'heure de son appui", async () => {
    await tour();
    await troisEquipes();
    await assertFails(buzz("vert"), "arrivée après le lancement du tour");
    await assertFails(buzz("bleu", "rose"), "jamais pour une autre équipe");
    await assertFails(buzz("bleu", "bleu", "r9h-1-99"), "ancien tour");
    await assertFails(buzz("bleu", "bleu", "r9h-1-100", { t: Date.now(), at: 5 }), "heure du serveur obligatoire");
    await assertFails(buzz("bleu", "bleu", "r9h-1-100", { at: serverTimestamp() }), "heure de l'appui obligatoire");
    await assertFails(buzz("bleu", "bleu", "r9h-1-100", { t: Date.now(), at: serverTimestamp(), ecart: 0 }));
    await assertSucceeds(buzz("bleu", "bleu", "r9h-1-100", { t: Date.now(), at: serverTimestamp(), r: 40, o: -12 }));
    await assertFails(buzz("bleu"), "un seul buzz par tour");
    await assertSucceeds(buzz("rose"));
    await assertFails(set(ref(db("bleu"), `games/${CODE}/chrono`), null));
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/chrono`), null));
  });

  test("8 équipes : la huitième buzze aussi", async () => {
    const ids = ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"];
    await tour({ teams: ids });
    await env.withSecurityRulesDisabled((ctx) => { const base = ctx.database(); return Promise.all(ids.map((id) => set(ref(base, `games/${CODE}/teams/${id}`), { name: id, color: "#7CFF3A" }))); });
    await assertSucceeds(buzz("e8"));
    await assertSucceeds(buzz("e1"));
  });

  test("ni avant le lancement, ni après le bilan, ni en pause, ni dans un autre jeu", async () => {
    await tour({ step: "ready" });
    await assertFails(buzz("bleu"), "tour prêt, pas lancé");
    await tour({ step: "result" });
    await assertFails(buzz("bleu"), "tour jugé");
    await tour({}, { paused: true });
    await assertFails(buzz("bleu"), "pause");
    await seed({ kind: "duel", chrono: { teams: ["bleu", "rose"], step: "run", key: "r9h-1-100" } });
    await assertFails(buzz("bleu"), "pas dans ce jeu");
  });

  test("la régie lance, règle la cible (10 à 90 s), révèle et arrête", async () => {
    await tour({ step: "ready" });
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/tel`), { pairedAt: 1, via: "pin" }));
    const envoi = (id, cmd) => set(ref(db("tel"), `games/${CODE}/commands/${id}`), { ...cmd, expectSeq: 3, by: "tel", at: serverTimestamp() });
    for (const [id, cmd] of [["h1", { type: "chrono_go" }], ["h2", { type: "chrono_cible", cible: 45 }], ["h3", { type: "chrono_reveal" }], ["h4", { type: "chrono_stop" }]]) {
      await assertSucceeds(envoi(id, cmd), cmd.type);
    }
    await assertFails(envoi("h5", { type: "chrono_cible", cible: 5 }), "trop court");
    await assertFails(envoi("h6", { type: "chrono_cible", cible: 300 }), "trop long");
    await assertFails(envoi("h7", { type: "next", cible: 30 }), "cible seulement pour chrono_cible");
  });
});

describe("Le Simon de Buzzy", () => {
  const suite = (simon = {}, extra = {}) => seed({
    kind: "simon", qid: "r9s", choices: null, deadline: null,
    simon: {
      tour: 1, suite: 3, step: "play", key: "r9s-1-3-100", players: { bleu: 1, rose: 2 },
      reponseAt: Date.now() - 2_000, finAt: Date.now() + 8_000, ...simon,
    }, ...extra,
  });
  const envoie = (uid, team = uid, data = {}, key = "r9s-1-3-100") =>
    set(ref(db(uid), `games/${CODE}/simon/${key}/${team}`), { items: "rouge,vert", ok: false, at: serverTimestamp(), ...data });
  const troisEquipes = () => env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/teams/vert`), { name: "Les Verts", color: "#7CFF3A" }));

  test("chaque équipe en jeu envoie ce qu'elle tape pendant le chrono, puis valide une fois", async () => {
    await suite();
    await troisEquipes();
    await assertSucceeds(envoie("bleu", "bleu", { items: "" }), "rien tapé encore");
    await assertSucceeds(envoie("bleu", "bleu", { items: "rouge" }), "chaque appui");
    await assertSucceeds(envoie("bleu", "bleu", { items: "rouge,vert,4", ok: true }), "« Valider »");
    await assertFails(envoie("bleu", "bleu", { items: "rouge" }), "plus rien après « Valider »");
    await assertFails(envoie("vert"), "pas de ce tour");
    await assertFails(envoie("bleu", "rose"), "jamais pour une autre équipe");
    await assertFails(envoie("rose", "rose", {}, "r9s-1-2-90"), "ancienne suite");
    await assertFails(envoie("rose", "rose", { at: 5 }), "heure du serveur obligatoire");
    await assertFails(envoie("rose", "rose", { items: "rouge;drop" }), "seulement des éléments");
    await assertFails(envoie("rose", "rose", { ok: "oui" }));
    await assertFails(envoie("rose", "rose", { triche: true }));
    await assertSucceeds(envoie("rose"));
    await assertFails(set(ref(db("bleu"), `games/${CODE}/simon`), null));
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/simon`), null));
  });

  test("ni pendant que le robot montre la suite, ni après le chrono, ni éliminée, ni en pause, ni dans un autre jeu", async () => {
    await suite({ reponseAt: Date.now() + 5_000 });
    await assertFails(envoie("bleu"), "le robot montre encore la suite");
    await suite({ reponseAt: Date.now() - 20_000, finAt: Date.now() - 10_000 });
    await assertFails(envoie("bleu"), "chrono fini");
    await suite({ out: { bleu: 2 } });
    await assertFails(envoie("bleu"), "éliminée du tour");
    await assertSucceeds(envoie("rose"));
    await suite({ step: "judged" });
    await assertFails(envoie("bleu"), "suite jugée");
    await suite({}, { paused: true });
    await assertFails(envoie("bleu"), "pause");
    await seed({ kind: "quiz", simon: { step: "play", key: "r9s-1-3-100", players: { bleu: 1 }, reponseAt: 0, finAt: Date.now() + 8_000 } });
    await assertFails(envoie("bleu"), "pas dans ce jeu");
  });

  test("tablette remplacée : seul le nouvel appareil envoie ; la régie lance et arrête les suites", async () => {
    await suite();
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/teams/bleu/device`), "tablette2"));
    await assertFails(envoie("bleu"));
    await assertSucceeds(envoie("tablette2", "bleu"));
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/regie/tel`), { pairedAt: 1, via: "pin" }));
    for (const [id, cmd] of [["s1", { type: "simon_go" }], ["s2", { type: "simon_stop" }]]) {
      await assertSucceeds(set(ref(db("tel"), `games/${CODE}/commands/${id}`), { ...cmd, expectSeq: 3, by: "tel", at: serverTimestamp() }), cmd.type);
    }
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

describe("changer de box : la fête continue sur une box de secours", () => {
  const SECOURS = "secours";
  const NEW = "SECUR";
  const REGIE = "tel";
  const LOBBY = { phase: "lobby", round: 1, buzzOpen: true };
  /** Publié par une box qui sait reprendre la fête d'une autre (version à jour). */
  const A_JOUR = { title: "Quiz", changeBox: true };
  /** Partie en cours (équipes, journal, scores) reliée à la régie, et le salon d'attente vide de la box de secours. */
  async function prepare({ lobby = { state: LOBBY }, host = SECOURS, to = NEW } = {}) {
    await seed({ phase: "scores", scores: { rose: 100 } });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const d = ctx.database();
      await set(ref(d, `games/${CODE}/regie/${REGIE}`), { pairedAt: 1, via: "password" });
      await set(ref(d, `games/${CODE}/log/000001`), { seq: 1, at: 1, type: "reveal" });
      await set(ref(d, `games/${to}`), { hostUid: host, public: A_JOUR, ...lobby });
    });
  }
  /** Ce que fait la régie : la nouvelle box, la trace du changement et le relais du salon, en une seule écriture. */
  const changer = (uid, { to = NEW, host = SECOURS, from = HOST, by = uid, code = CODE, extra = {} } = {}) =>
    update(ref(db(uid)), {
      [`games/${code}/hostUid`]: host,
      [`games/${code}/takeover`]: { to, from, by, at: serverTimestamp(), ...extra },
      [`games/${to}/handoff`]: code,
    });
  const hote = async (code = CODE) => (await get(ref(db("rose"), `games/${code}/hostUid`))).val();

  test("la régie confie la fête au salon d'une box acceptée : la nouvelle box la pilote, l'ancienne plus du tout", async () => {
    await allowBox(env, HOST, SECOURS);
    await prepare();
    await assertSucceeds(changer(REGIE));
    assert.equal(await hote(), SECOURS);
    // La nouvelle box lit toute la partie (équipes, journal, trace du changement) et le relais de son salon.
    const nouvelle = db(SECOURS);
    const partie = (await get(ref(nouvelle, `games/${CODE}`))).val();
    assert.deepEqual(Object.keys(partie.teams).sort(), ["bleu", "rose"]);
    assert.equal(partie.log["000001"].type, "reveal");
    assert.equal(partie.state.scores.rose, 100);
    assert.deepEqual({ ...partie.takeover, at: typeof partie.takeover.at }, { to: NEW, from: HOST, by: REGIE, at: "number" });
    assert.equal((await get(ref(nouvelle, `games/${NEW}/handoff`))).val(), CODE);
    await assertSucceeds(update(ref(nouvelle, `games/${CODE}`), { "state/phase": "question", "log/000002": { seq: 2, at: 2, type: "open" } }));
    await assertSucceeds(update(ref(nouvelle, `games/${NEW}/state`), { phase: "ended", endedAt: serverTimestamp() }));
    // L'ancienne box, revenue après la panne : elle voit qui pilote, mais ne lit ni n'écrit plus rien.
    const ancienne = db(HOST);
    assert.equal((await get(ref(ancienne, `games/${CODE}/hostUid`))).val(), SECOURS);
    await assertFails(get(ref(ancienne, `games/${CODE}`)));
    await assertFails(set(ref(ancienne, `games/${CODE}/state/phase`), "reveal"));
    await assertFails(set(ref(ancienne, `games/${CODE}/log/000003`), { seq: 3, at: 3, type: "close" }));
    await assertFails(set(ref(ancienne, `games/${CODE}/conducteur`), { title: "Ancien" }));
    await assertFails(set(ref(ancienne, `games/${CODE}/commandStatus/c0`), { status: "applied" }));
    // Seule l'ancienne box apprend que c'est elle qui a été remplacée ; une autre box qui aurait gardé le code, non.
    assert.equal((await get(ref(ancienne, `games/${CODE}/takeover/from`))).val(), HOST);
    await assertFails(get(ref(ancienne, `games/${CODE}/takeover`)));
    await assertFails(get(ref(db("autre-box"), `games/${CODE}/takeover/from`)));
    // La régie commande toujours la même partie ; la trace et le relais ne se lisent que par la box qui pilote.
    await assertSucceeds(set(ref(db(REGIE), `games/${CODE}/commands/c1`), { type: "next", expectSeq: 2, by: REGIE, at: serverTimestamp() }));
    await assertFails(get(ref(db(REGIE), `games/${CODE}/takeover`)));
    await assertFails(get(ref(db("rose"), `games/${NEW}/handoff`)));
    // Ni la trace ni le relais ne s'effacent.
    await assertFails(set(ref(db(REGIE), `games/${CODE}/takeover`), null));
    await assertFails(set(ref(db(REGIE), `games/${NEW}/handoff`), null));
    await assertFails(set(ref(nouvelle, `games/${NEW}/handoff`), null));
  });

  test("seule une régie de la partie la confie, jamais à elle-même ni à un identifiant inventé", async () => {
    await allowBox(env, HOST, SECOURS);
    await seedAdmin(env, "sarah");
    await prepare();
    // Régie d'une autre partie seulement.
    await env.withSecurityRulesDisabled((ctx) =>
      set(ref(ctx.database(), "games/AUTR2"), { hostUid: "tv2", state: LOBBY, regie: { tel2: { pairedAt: 1, via: "pin" } } }));
    for (const uid of ["rose", "tel2", "sarah", HOST, SECOURS, "inconnu"]) await assertFails(changer(uid), uid);
    await assertFails(changer(REGIE, { host: REGIE }), "la régie se déclare hôte");
    await assertFails(changer(REGIE, { host: "pirate" }), "identifiant inventé");
    await assertFails(changer(REGIE, { by: "autre" }), "signée par un autre");
    await assertFails(changer(REGIE, { from: "autre" }), "ancienne box inexacte");
    await assertFails(changer(REGIE, { extra: { scores: 999 } }), "champ en plus");
    await assertFails(update(ref(db(REGIE)), {
      [`games/${CODE}/hostUid`]: SECOURS,
      [`games/${CODE}/takeover`]: { to: NEW, from: HOST, by: REGIE, at: 1 },
      [`games/${NEW}/handoff`]: CODE,
    }), "heure du téléphone");
    await assertFails(set(ref(db("sarah"), `games/${CODE}/hostUid`), SECOURS), "administration");
    await assertFails(set(ref(db(REGIE), `games/${CODE}/hostUid`), REGIE));
    assert.equal(await hote(), HOST);
    // Témoin : la même écriture, faite par la régie de la partie, passe.
    await assertSucceeds(changer(REGIE));
  });

  test("la box de secours montre son salon d'attente vide, avec une appli à jour ; acceptée dans la Régie PC dès que le verrou est en place", async () => {
    await allowBox(env, HOST);
    await prepare({ lobby: { state: { ...LOBBY, phase: "question" } } });
    await assertFails(changer(REGIE), "partie déjà lancée");
    await prepare({ lobby: { state: LOBBY, teams: { vert: { name: "Les Verts", color: "#06D6A0" } } } });
    await assertFails(changer(REGIE), "salon avec une équipe");
    await prepare({ lobby: { state: { ...LOBBY, phase: "ended" } } });
    await assertFails(changer(REGIE), "salon terminé");
    await prepare();
    await assertFails(changer(REGIE, { to: CODE }), "la partie elle-même");
    await assertFails(changer(REGIE, { to: "ZZZZZ" }), "code inconnu");
    await assertFails(changer(REGIE, { to: "SEC/R" }), "code mal formé");
    await assertFails(changer(REGIE), "box pas encore acceptée");
    await allowBox(env, SECOURS);
    // Box d'une version plus ancienne : elle n'écouterait pas son relais, la fête resterait sans box.
    await prepare({ lobby: { state: LOBBY, public: { title: "Quiz" } } });
    await assertFails(changer(REGIE), "appli pas à jour");
    await prepare({ lobby: { state: LOBBY, public: null } });
    await assertFails(changer(REGIE), "appli bien plus ancienne");
    await prepare();
    await assertSucceeds(changer(REGIE));
  });

  test("jamais la box d'une autre fête : salon relié au téléphone d'une autre animatrice, ou prestation déjà chargée", async () => {
    await allowBox(env, HOST, SECOURS);
    const relie = (...uids) => Object.fromEntries(uids.map((uid) => [uid, { pairedAt: 1, via: "password" }]));
    const prestation = { id: "s1", title: "Anniversaire de Léa", quiz: { questions: [{ text: "Couleur ?" }] }, by: "autre", at: 1 };
    await prepare({ lobby: { state: LOBBY, regie: relie("autre") } });
    await assertFails(changer(REGIE), "salon relié à une autre animatrice");
    await prepare({ lobby: { state: LOBBY, regie: relie(REGIE), show: prestation } });
    await assertFails(changer(REGIE), "prestation déjà chargée, même par ce téléphone");
    // Sarah a scanné le QR de la box de secours par habitude : son propre téléphone relié ne gêne pas.
    await prepare({ lobby: { state: LOBBY, regie: relie(REGIE) } });
    await assertSucceeds(changer(REGIE));
  });

  test("une régie entrée avec le mot de passe voit si une box est acceptée ; ni un pupitre, ni une régie par code de secours", async () => {
    const SALT = "sel-de-test-0123456789";
    const hash = createHash("sha256").update(`${SALT}:Licorne-2026`).digest("hex");
    await allowBox(env, SECOURS);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const d = ctx.database();
      await set(ref(d, "settings/regie"), { salt: SALT, hash, updatedAt: 1 });
      await set(ref(d, `regieProof/${REGIE}`), { hash, gateAt: 1, at: 1 });
      await set(ref(d, "regieProof/faux"), { hash: "b".repeat(64), gateAt: 1, at: 1 });
    });
    assert.equal((await get(ref(db(REGIE), `boxes/allowed/${SECOURS}/name`))).val(), `Box ${SECOURS}`);
    await assertSucceeds(get(ref(db(REGIE), "boxes/allowed/inconnue")));
    await assertFails(get(ref(db(REGIE), "boxes/allowed")));
    await assertFails(get(ref(db("faux"), `boxes/allowed/${SECOURS}`)));
    await assertFails(get(ref(db("rose"), `boxes/allowed/${SECOURS}`)));
    await assertFails(set(ref(db(REGIE), "boxes/allowed/tel"), { name: "Pirate", at: 1 }));
  });

  test("tant qu'aucune box n'est acceptée, une box déjà utilisée sert aussi de secours ; jamais la box qui pilote déjà", async () => {
    await prepare({ host: HOST });
    await assertFails(changer(REGIE, { host: HOST }), "même box");
    await prepare();
    await assertSucceeds(changer(REGIE));
  });

  test("jamais en morceaux : ni la box, ni la trace, ni le relais seuls ; un salon de secours ne reçoit qu'une fête", async () => {
    await allowBox(env, HOST, SECOURS);
    await prepare();
    const regie = db(REGIE);
    const trace = { to: NEW, from: HOST, by: REGIE, at: serverTimestamp() };
    await assertFails(set(ref(regie, `games/${CODE}/hostUid`), SECOURS), "box seule");
    await assertFails(update(ref(regie, `games/${CODE}`), { hostUid: SECOURS, takeover: trace }), "sans relais");
    await assertFails(set(ref(regie, `games/${CODE}/takeover`), trace), "trace seule");
    await assertFails(set(ref(regie, `games/${NEW}/handoff`), CODE), "relais seul");
    await assertFails(update(ref(regie), { [`games/${CODE}/takeover`]: trace, [`games/${NEW}/handoff`]: CODE }), "trace et relais sans changer de box");
    await assertFails(update(ref(regie), { [`games/${CODE}/hostUid`]: SECOURS, [`games/${NEW}/handoff`]: CODE }), "box et relais sans trace");
    assert.equal(await hote(), HOST);
    await assertSucceeds(changer(REGIE));
    // Relais vers une partie dont la box n'a pas changé dans cette écriture (même hôte que le salon) : refusé.
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), "games/SALN2"), { hostUid: SECOURS, state: LOBBY }));
    await assertFails(set(ref(regie, "games/SALN2/handoff"), CODE));
    // Une autre fête de la même régie ne peut pas atterrir dans le salon qui a déjà reçu celle-ci.
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), "games/AUTRE"), {
      hostUid: "box3", state: { phase: "question" }, regie: { [REGIE]: { pairedAt: 1, via: "pin" } },
    }));
    await allowBox(env, "box3");
    await assertFails(changer(REGIE, { code: "AUTRE", from: "box3" }));
  });

  test("la fête change de box autant qu'il faut, et peut revenir sur la box d'origine", async () => {
    await allowBox(env, HOST, SECOURS, "box3");
    await prepare();
    await assertSucceeds(changer(REGIE));
    await env.withSecurityRulesDisabled(async (ctx) => {
      const d = ctx.database();
      await set(ref(d, "games/PLAN2"), { hostUid: "box3", state: LOBBY, public: A_JOUR });
      await set(ref(d, "games/RETOU"), { hostUid: HOST, state: LOBBY, public: A_JOUR });
    });
    await assertSucceeds(changer(REGIE, { to: "PLAN2", host: "box3", from: SECOURS }));
    await assertFails(set(ref(db(SECOURS), `games/${CODE}/state/phase`), "reveal"));
    await assertSucceeds(changer(REGIE, { to: "RETOU", host: HOST, from: "box3" }));
    assert.equal(await hote(), HOST);
    await assertSucceeds(set(ref(db(HOST), `games/${CODE}/log/000002`), { seq: 2, at: 2, type: "open" }));
    // Le journal est resté intact d'une box à l'autre.
    assert.equal((await get(ref(db(HOST), `games/${CODE}/log/000001/type`))).val(), "reveal");
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

describe("nettoyage des copies des fêtes terminées (Régie PC, cedric, 21/10)", () => {
  const H = 3600_000;
  const SALT = "sel-de-test-0123456789";
  const hash = (password) => createHash("sha256").update(`${SALT}:${password}`).digest("hex");
  const S = "0123456789abcdef", I = "fedcba9876543210", C = "00112233445566ff";
  const MP3 = "data:audio/mpeg;base64,SUQz", JPG = "data:image/jpeg;base64,/9j/";
  beforeEach(() => seedAdmin(env, "sarah"));

  /** Partie avec ses copies, sa régie, son journal, ses équipes et son programme, sans passer par les règles. */
  async function fete(code, { phase = "ended", endedAt, createdAt, paused } = {}) {
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${code}`), {
      hostUid: HOST, ...(createdAt != null ? { createdAt } : {}),
      state: { phase, seq: 9, scores: { rose: 300 }, ...(endedAt != null ? { endedAt } : {}), ...(paused ? { paused } : {}) },
      regie: { tel: { pairedAt: 1, via: "pin" } },
      teams: { rose: { name: "Les Roses", color: "#FF3CAC" } },
      log: { 1: { seq: 1, at: 1, type: "game_started" } },
      conducteur: { id: "lea", title: "Léa", rev: "r1" },
      show: { id: "s1", title: "Léa", quiz: { questions: [{ text: "?" }] }, by: "tel", at: 1 },
      public: { title: "L'anniversaire de Léa", childName: "Léa" },
      sounds: { [S]: MP3 }, images: { [I]: JPG }, choiceImages: { [C]: JPG },
    }));
  }
  const copies = (code) => ({ [`sounds/${S}`]: null, [`images/${I}`]: null, [`choiceImages/${C}`]: null });
  const effacer = (uid, code) => update(ref(db(uid), `games/${code}`), copies(code));
  const reste = async (path) => {
    let v;
    await env.withSecurityRulesDisabled(async (ctx) => { v = (await get(ref(ctx.database(), path))).val(); });
    return v;
  };

  test("la Régie PC liste les parties ; ni la régie, ni la box, ni une équipe, ni un inconnu", async () => {
    await fete("FETE1", { endedAt: Date.now() - 25 * H });
    await env.withSecurityRulesDisabled((ctx) => update(ref(ctx.database()), {
      "settings/regie": { salt: SALT, hash: hash("Licorne-2026"), updatedAt: 1 },
      "regieProof/mdp": { hash: hash("Licorne-2026"), gateAt: 1, at: 1 },
    }));
    await assertSucceeds(get(ref(db("sarah"), "games")));
    for (const uid of ["tel", "mdp", HOST, "rose", "intrus"]) await assertFails(get(ref(db(uid), "games")));
    await assertFails(get(ref(db(null), "games")));
  });

  test("copies effacées 24 h après la fin notée, ou 48 h après la création sans heure de fin", async () => {
    await fete("FETE1", { endedAt: Date.now() - 25 * H, createdAt: Date.now() - 27 * H });
    await fete("FETE2", { createdAt: Date.now() - 49 * H });
    // Une à une, ou toutes ensemble avec le journal (la même écriture que la Régie PC).
    await assertSucceeds(set(ref(db("sarah"), `games/FETE1/sounds/${S}`), null));
    await assertSucceeds(update(ref(db("sarah")), {
      [`games/FETE1/images/${I}`]: null, [`games/FETE1/choiceImages/${C}`]: null,
      "maintenance/nettoyages/n1": { at: serverTimestamp(), code: "FETE1", sounds: 1, images: 1, choiceImages: 1, mo: 0.73 },
    }));
    await assertSucceeds(effacer("sarah", "FETE2"));
    for (const code of ["FETE1", "FETE2"]) {
      assert.deepEqual([await reste(`games/${code}/sounds`), await reste(`games/${code}/images`), await reste(`games/${code}/choiceImages`)], [null, null, null]);
      // Tout le reste de la partie est là : état, scores, journal, équipes, programme, régie.
      const g = await reste(`games/${code}`);
      assert.deepEqual(Object.keys(g).sort(), ["conducteur", "hostUid", "log", "public", "regie", "show", "state", "teams", ...(g.createdAt ? ["createdAt"] : [])].sort());
      assert.equal(g.state.scores.rose, 300);
    }
  });

  test("journal du nettoyage : le compteur des chansons entières des statues (facultatif, un nombre)", async () => {
    const note = (cle, extra) => set(ref(db("sarah"), `maintenance/nettoyages/${cle}`), { at: serverTimestamp(), code: "FETE1", sounds: 0, images: 0, choiceImages: 0, mo: 6.8, ...extra });
    await assertSucceeds(note("s1", { songs: 2 }));
    await assertSucceeds(note("s2", {}));
    await assertFails(note("s3", { songs: -1 }));
    await assertFails(note("s4", { songs: "2" }));
  });

  test("jamais avant : fin il y a 23 h, partie au salon, en question ou en pause même ancienne, sans heure de fin créée il y a 47 h, sans date", async () => {
    const vieux = Date.now() - 30 * 24 * H;
    await fete("RECEN", { endedAt: Date.now() - 23 * H, createdAt: vieux });
    await fete("SALON", { phase: "lobby", endedAt: vieux, createdAt: vieux });
    await fete("QUEST", { phase: "question", createdAt: vieux });
    await fete("PAUSE", { phase: "question", paused: true, endedAt: vieux, createdAt: vieux });
    await fete("JEUNE", { createdAt: Date.now() - 47 * H });
    await fete("NODAT", {});
    for (const code of ["RECEN", "SALON", "QUEST", "PAUSE", "JEUNE", "NODAT"]) {
      await assertFails(effacer("sarah", code));
      await assertFails(set(ref(db("sarah"), `games/${code}/sounds/${S}`), null));
      assert.equal(await reste(`games/${code}/sounds/${S}`), MP3, `${code} : copie gardée`);
    }
    // Heure de fin plus récente que 24 h, même si la partie a été créée il y a longtemps : c'est la fin qui compte.
    await assertFails(set(ref(db("sarah"), `games/RECEN/choiceImages/${C}`), null));
  });

  test("une prestation archivée dont la date est passée ne compte pas : sa partie interrompue garde ses copies", async () => {
    // Seul l'état de la partie compte (fin définitive notée par la TV), jamais le statut ni la date de la prestation.
    const vieux = Date.now() - 60 * 24 * H;
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), "library/shows/vieille"),
      { childName: "Léa", date: "2026-08-20", status: "archivee", rounds: [{ type: "quiz", quizId: "q" }], updatedAt: 1 }));
    await fete("INTER", { phase: "question", createdAt: vieux });
    await env.withSecurityRulesDisabled((ctx) => update(ref(ctx.database(), "games/INTER"), { "show/id": "vieille", "conducteur/id": "vieille", takeover: { to: "box2", at: 1 } }));
    await assertFails(effacer("sarah", "INTER"));
    for (const path of [`sounds/${S}`, `images/${I}`, `choiceImages/${C}`]) await assertFails(set(ref(db("sarah"), `games/INTER/${path}`), null));
    assert.equal(await reste(`games/INTER/sounds/${S}`), MP3);
  });

  test("la Régie PC n'écrit jamais une copie, ni rien d'autre de la partie, même terminée depuis longtemps", async () => {
    await fete("FETE1", { endedAt: Date.now() - 25 * H, createdAt: Date.now() - 27 * H });
    await assertFails(set(ref(db("sarah"), `games/FETE1/sounds/${S}`), MP3 + "AA"));
    await assertFails(set(ref(db("sarah"), "games/FETE1/sounds/aaaaaaaaaaaaaaaa"), MP3));
    await assertFails(set(ref(db("sarah"), "games/FETE1/images/aaaaaaaaaaaaaaaa"), JPG));
    // Tout un dossier ou toute la partie d'un coup : refusé (une copie à la fois, chacune vérifiée).
    await assertFails(set(ref(db("sarah"), "games/FETE1/sounds"), null));
    await assertFails(set(ref(db("sarah"), "games/FETE1"), null));
    for (const path of ["state", "state/phase", "state/endedAt", "log", "log/1", "teams", "teams/rose", "conducteur", "show", "public", "regie/tel", "hostUid", "createdAt"]) {
      await assertFails(set(ref(db("sarah"), `games/FETE1/${path}`), null));
    }
    await assertFails(set(ref(db("sarah"), "games/FETE1/state/endedAt"), 1));
    await assertFails(set(ref(db("sarah"), "games/FETE1/state/phase"), "ended"));
    // Une copie avec autre chose dans la même écriture : tout est refusé.
    await assertFails(update(ref(db("sarah"), "games/FETE1"), { [`sounds/${S}`]: null, "log/1": null }));
    assert.equal(await reste(`games/FETE1/sounds/${S}`), MP3);
  });

  test("ni la régie, ni la box, ni une équipe n'effacent les copies ; la bibliothèque garde ses règles", async () => {
    await fete("FETE1", { endedAt: Date.now() - 25 * H });
    await env.withSecurityRulesDisabled((ctx) => update(ref(ctx.database()), {
      [`library/sounds/${S}`]: MP3,
      "settings/regie": { salt: SALT, hash: hash("Licorne-2026"), updatedAt: 1 },
      "regieProof/mdp": { hash: hash("Licorne-2026"), gateAt: 1, at: 1 },
    }));
    for (const uid of ["tel", "mdp", HOST, "rose", "intrus"]) {
      await assertFails(effacer(uid, "FETE1"));
      await assertFails(set(ref(db(uid), `library/sounds/${S}`), null));
    }
    assert.equal(await reste(`games/FETE1/sounds/${S}`), MP3);
    // La régie continue de copier une seule fois ; l'administration ne remplace pas un original rangé.
    await assertFails(set(ref(db("tel"), `games/FETE1/sounds/${S}`), MP3));
    await assertSucceeds(set(ref(db("tel"), "games/FETE1/sounds/aaaaaaaaaaaaaaaa"), MP3));
    await assertFails(set(ref(db("sarah"), `library/sounds/${S}`), MP3 + "AA"));
  });

  test("journal du nettoyage : écrit et lu par la Régie PC seule, jamais réécrit ni effacé, bien formé", async () => {
    const entree = (extra = {}) => ({ at: serverTimestamp(), code: "FETE1", sounds: 2, images: 1, choiceImages: 0, mo: 1.28, ...extra });
    const passage = (extra = {}) => ({ at: serverTimestamp(), type: "nettoyage", parties: 6, nettoyees: 2, copies: 7, mo: 2.05, ...extra });
    await assertSucceeds(set(ref(db("sarah"), "maintenance/nettoyages/n1"), entree({ gardes: 1 })));
    // Premier passage : un contrôle, qui n'a rien nettoyé ; puis les nettoyages, avec les copies gardées par raison.
    await assertSucceeds(set(ref(db("sarah"), "maintenance/passages/p1"), passage({ type: "controle", nettoyees: 0, gardees: { enCours: 2, recente: 2, orphelins: 1 } })));
    await assertSucceeds(set(ref(db("sarah"), "maintenance/passages/p2"), passage()));
    await assertSucceeds(get(ref(db("sarah"), "maintenance")));
    // Jamais réécrit ni effacé.
    await assertFails(set(ref(db("sarah"), "maintenance/nettoyages/n1"), entree()));
    await assertFails(set(ref(db("sarah"), "maintenance/nettoyages/n1"), null));
    await assertFails(set(ref(db("sarah"), "maintenance/passages/p1"), null));
    // Mal formé : heure du PC, champ en plus ou manquant, nombres faux, code étrange.
    for (const bad of [entree({ at: 1 }), entree({ pirate: true }), entree({ sounds: -1 }), entree({ mo: "1" }), entree({ code: "../x" }), entree({ gardes: "1" })]) {
      await assertFails(set(ref(db("sarah"), "maintenance/nettoyages/n2"), bad));
    }
    const { images, ...sansImages } = entree();
    await assertFails(set(ref(db("sarah"), "maintenance/nettoyages/n2"), sansImages));
    for (const bad of [passage({ pirate: 1 }), passage({ at: 1 }), passage({ type: "autre" }), passage({ type: "controle" }), passage({ copies: -1 }),
      passage({ gardees: { pirate: 1 } }), passage({ gardees: { enCours: "2" } })]) {
      await assertFails(set(ref(db("sarah"), "maintenance/passages/p3"), bad));
    }
    const { type, ...sansType } = passage();
    await assertFails(set(ref(db("sarah"), "maintenance/passages/p3"), sansType));
    // Personne d'autre.
    for (const uid of ["tel", HOST, "intrus"]) {
      await assertFails(get(ref(db(uid), "maintenance")));
      await assertFails(get(ref(db(uid), "maintenance/nettoyages/n1")));
      await assertFails(set(ref(db(uid), "maintenance/nettoyages/n3"), entree()));
      await assertFails(set(ref(db(uid), "maintenance/passages/p4"), passage()));
    }
  });
});
