// Trois anniversaires en même temps, sur trois box dans trois maisons : trois parties, trois régies, leurs tablettes,
// le tout dans la même base Firebase (émulateur). Les régies et les pupitres sont les vraies pages, dans un vrai
// navigateur (Chromium) ; chaque box est simulée par ce script avec son propre compte, comme dans regie.test.js.
// But : prouver qu'aucune équipe, réponse, buzz, commande, pause, point ou média d'une fête ne passe dans une autre,
// y compris quand une tablette ou une régie se recharge et quand une box perd Internet.
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { ref, get, set, update, push, onValue, onDisconnect, goOffline, goOnline, serverTimestamp } from "firebase/database";
import { chromium } from "playwright";
import { loadRules, seedAdmin, allowBox, ADMIN_PASSWORD } from "./rules-loader.js";

const ROOT = new URL("..", import.meta.url).pathname;
const PUBLIC = join(ROOT, "web/public");
const FIREBASE_JS = join(ROOT, "tests/node_modules/firebase");
const PASSWORD = "Licorne-2026";
const SALT = "sel-de-test-0123456789";

const testConfig = JSON.stringify({
  apiKey: "demo-key", authDomain: "demo-lmp.firebaseapp.com",
  databaseURL: "https://demo-lmp.firebaseio.com", projectId: "demo-lmp", appId: "demo",
});
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon" };

/** Les trois fêtes du samedi : chaque box a son compte, sa partie et sa prestation. */
const FETES = [
  { nom: "Léa", code: "FETEA", host: "box-salon-lea" },
  { nom: "Tom", code: "FETEB", host: "box-salle-tom" },
  { nom: "Inès", code: "FETEC", host: "box-jardin-ines" },
];
const [LEA, TOM, INES] = FETES;

/** Photo d'illustration du quiz de Léa, et extraits du quiz musical de Tom : la fête d'Inès n'a aucun média. */
const PHOTO_LION = "1a1a1a1a1a1a1a1a";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const SONS = ["2b2b2b2b2b2b2b2b", "3c3c3c3c3c3c3c3c", "4d4d4d4d4d4d4d4d"];
const MP3 = (i) => `data:audio/mpeg;base64,${Buffer.from(`extrait ${i}`).toString("base64")}`;

const BIBLIOTHEQUE = {
  quizzes: {
    animaux: {
      title: "Animaux", source: "tableur", updatedAt: 1,
      questions: [
        { text: "Roi de la jungle ?", choices: ["Lion", "Tigre", "Zèbre", "Singe"], correct: 0, imageId: PHOTO_LION, status: "validee" },
        { text: "Combien de pattes a une araignée ?", choices: ["6", "8"], correct: 1, status: "validee" },
      ],
    },
  },
  images: { [PHOTO_LION]: PNG },
  sounds: Object.fromEntries(SONS.map((id, i) => [id, MP3(i)])),
  playlists: {
    dessins: {
      title: "Dessins animés", duration: 20, updatedAt: 1,
      tracks: [{ title: "Hakuna Matata", audioId: SONS[0] }, { title: "Libérée, délivrée", audioId: SONS[1] }, { title: "Un jour mon prince viendra", audioId: SONS[2] }],
    },
  },
  shows: {
    lea: { childName: "Léa", age: 7, date: "2099-12-05", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 },
    tom: { childName: "Tom", age: 8, date: "2099-12-05", status: "publiee", rounds: [{ type: "musical", playlistId: "dessins" }], updatedAt: 1 },
    ines: { childName: "Inès", age: 6, date: "2099-12-05", status: "publiee", rounds: [{ type: "chante", count: 3 }], updatedAt: 1 },
  },
};

let env, server, browser, baseUrl;
let boites = [];
let contextes = [];

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-lmp",
    database: { rules: loadRules(), host: "127.0.0.1", port: 9000 },
  });
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/firebase-config.json") return res.end(testConfig);
    const file = normalize(join(PUBLIC, path === "/" ? "index.html" : path));
    if (!file.startsWith(PUBLIC) || !existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearDatabase();
  await seedAdmin(env);
  await allowBox(env, ...FETES.map((f) => f.host));
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.database();
    await set(ref(d, "settings/regie"), { salt: SALT, hash: createHash("sha256").update(`${SALT}:${PASSWORD}`).digest("hex"), updatedAt: 1 });
    await set(ref(d, "library"), BIBLIOTHEQUE);
  });
});

afterEach(async () => {
  boites.forEach((b) => b.stop());
  boites = [];
  await Promise.all(contextes.map((c) => c.close().catch(() => {})));
  contextes = [];
});

/** Lecteur à part pour chaque box (jamais coupé, même quand la box l'est) : ce que contient vraiment sa partie. */
const lecteurs = new Map();
function lecteur(host) {
  if (!lecteurs.has(host)) lecteurs.set(host, env.authenticatedContext(host).database());
  return lecteurs.get(host);
}
const lire = async (fete, path) => (await get(ref(lecteur(fete.host), `games/${fete.code}${path ? `/${path}` : ""}`))).val();

async function waitFor(fn, what, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Délai dépassé : ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

// ---------- Box simulée (une par fête) ----------

/** Jeux que la TV sait jouer (conducteur publié par la box) : la régie ne refuse aucune prestation. */
const DRAPEAUX = { mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, blind: true, blindPlay: true, statues: true, disparu: true, pictionary: true, portes: true, coffres: true, gonfleur: true, patate: true };
const AU_BUZZER = ["flou", "chante", "quisuis"];
/** Chrono long : la machine de test peut être lente, aucune réponse ne doit arriver après la fin du chrono. */
const DUREE_MS = 90000;
const refus = (reason) => ({ status: "refused", reason });

/**
 * Box d'une fête, avec son propre compte : elle crée sa partie games/<code> (sous les règles, comme la vraie), juge la
 * prestation chargée par sa régie, traite les commandes une par une avec les mêmes décisions que la vraie box pour ce
 * qui sert ici (étape attendue, pause, reprise 3-2-1, points, buzz, révélation), et tient un journal (log/) d'où l'on
 * reconstruit ses scores. Elle ne lit que sa partie : une réponse, un buzz ou une commande d'une autre fête qui lui
 * arriverait se verrait dans ses scores et son état.
 */
async function demarrerBoite({ code, host }) {
  const db = env.authenticatedContext(host).database();
  const partie = (path = "") => ref(db, `games/${code}${path ? `/${path}` : ""}`);
  let state = { phase: "lobby", seq: 0, total: 1, scores: {}, round: 1, buzzOpen: true, paused: false };
  let plan = [];
  let teams = {};
  let jugee = null;
  const traitees = new Set();
  const stops = [];
  let file = Promise.resolve();
  const enFile = (fn) => { file = file.then(fn).catch((e) => console.error(`Box ${code} :`, e)); return file; };
  const journal = (seq, type, extra = {}) => ({ [`log/${String(seq).padStart(6, "0")}`]: { seq, at: Date.now(), type, ...extra } });

  await set(partie(), {
    hostUid: host, createdAt: Date.now(), state,
    conducteur: { id: "demo", title: "Quiz de démonstration", rev: "initial", ...DRAPEAUX, questions: [{ id: "d1", text: "Démonstration", choices: ["Oui", "Non"], correct: 0 }] },
  });

  function question(i, seq) {
    const q = plan[i];
    const buzz = AU_BUZZER.includes(q.kind);
    return {
      phase: "question", seq, index: i, total: plan.length, qid: q.id, kind: q.kind, double: !!q.double, text: q.text,
      choices: buzz ? null : q.choices ?? null, durationMs: DUREE_MS, deadline: Date.now() + DUREE_MS, paused: false,
      scores: state.scores, round: buzz ? `${q.id}-1000-0` : 1, buzzOpen: buzz, ...(buzz ? { buzz: { team: null, blocked: [] } } : {}),
    };
  }

  /** Révélation : les réponses relues dans SA partie, seulement celles de SES équipes (comme collectAnswers). */
  async function reveler(seq) {
    const q = plan[state.index];
    const reponses = (await get(partie(`answers/${q.id}`))).val() ?? {};
    const awards = {};
    const points = {};
    for (const [team, r] of Object.entries(reponses)) {
      if (!teams[team]) continue;
      const ok = r.choice === q.correct;
      awards[team] = { correct: ok, points: ok ? 100 : 0, bonus: 0 };
      if (ok) points[team] = 100;
    }
    const scores = { ...state.scores };
    for (const [t, n] of Object.entries(points)) scores[t] = (scores[t] ?? 0) + n;
    state = { ...state, seq, phase: "reveal", correct: q.correct, awards, scores, deadline: null, buzzOpen: false };
    return journal(seq, "AnswersRevealed", { qid: q.id, points });
  }

  async function traiter(id, cmd) {
    const avance = ["next", "close", "end", "buzz_ok", "buzz_ko"].includes(cmd.type);
    const seq = state.seq + 1;
    let statut = null;
    let extra = {};
    if (avance && cmd.expectSeq !== state.seq) statut = { status: "stale", reason: "stale" };
    else if (state.paused && avance && cmd.type !== "end") statut = refus("paused");
    else if (cmd.type === "close" && state.phase === "question" && (state.resumeAt ?? 0) > Date.now()) statut = refus("countdown");
    else switch (cmd.type) {
      case "next":
        if (state.phase === "lobby") {
          if (!Object.keys(teams).length) statut = refus("no_teams");
          else state = question(0, seq);
        } else if (state.phase === "question") state = { ...state, seq, phase: "closed", deadline: null, buzzOpen: false };
        else if (state.phase === "closed") extra = await reveler(seq);
        else if (state.phase === "reveal") state = { ...state, seq, phase: "scores" };
        else if (state.phase === "scores") state = state.index + 1 < plan.length ? question(state.index + 1, seq) : { ...state, seq, phase: "ended" };
        else statut = refus("not_now");
        break;
      case "close":
        if (state.phase !== "question") statut = refus("not_now");
        else state = { ...state, seq, phase: "closed", deadline: null, buzzOpen: false };
        break;
      case "pause":
        if (state.phase === "lobby" || state.phase === "ended" || state.paused) statut = refus("not_now");
        else state = { ...state, seq, paused: true, pauseReason: "regie", remainingMs: state.deadline ? Math.max(0, state.deadline - Date.now()) : null, deadline: null };
        break;
      case "resume": {
        if (!state.paused) { statut = refus("not_now"); break; }
        const resumeAt = Date.now() + 3000;
        state = { ...state, seq, paused: false, pauseReason: null, resumeAt, deadline: state.remainingMs == null ? null : resumeAt + state.remainingMs, remainingMs: null };
        break;
      }
      case "adjust":
        // Équipe inconnue de cette partie (une équipe d'une autre fête, même du même nom) : refusée, comme Command.Adjust.
        if (!teams[cmd.team]) statut = refus("unknown_team");
        else {
          state = { ...state, seq, scores: { ...state.scores, [cmd.team]: (state.scores[cmd.team] ?? 0) + cmd.delta } };
          extra = journal(seq, "ScoreAdjusted", { team: cmd.team, delta: cmd.delta });
        }
        break;
      case "buzz_ok":
      case "buzz_ko": {
        const b = state.buzz;
        if (state.phase !== "question" || !AU_BUZZER.includes(state.kind) || !b?.team) { statut = refus("not_now"); break; }
        if (cmd.type === "buzz_ok") {
          const points = b.blocked.length ? 100 : 150;
          state = { ...state, seq, phase: "reveal", buzzOpen: false, correct: 0, awards: { [b.team]: { correct: true, points, bonus: 0 } }, scores: { ...state.scores, [b.team]: (state.scores[b.team] ?? 0) + points } };
          extra = journal(seq, "BuzzJudged", { team: b.team, points: { [b.team]: points } });
        } else {
          const blocked = [...b.blocked, b.team];
          state = { ...state, seq, buzzOpen: true, round: `${state.qid}-1000-${blocked.length}`, buzz: { team: null, blocked }, buzzBlocked: Object.fromEntries(blocked.map((t) => [t, true])) };
        }
        break;
      }
      case "end":
        state = { ...state, seq, phase: "ended" };
        break;
      default:
        statut = refus("not_now");
    }
    await update(partie(), {
      ...(statut ? {} : { state, ...journal(seq, cmd.type), ...extra }),
      [`commandStatus/${id}`]: { ...(statut ?? { status: "applied", seq }), at: Date.now() },
    });
  }

  stops.push(onValue(partie("teams"), (s) => { teams = s.val() ?? {}; }));
  // Prestation chargée au salon d'attente par la régie de CETTE partie : acceptée, conducteur et accueil publiés.
  stops.push(onValue(partie("show"), (s) => enFile(async () => {
    const show = s.val();
    if (!show || show.id === jugee) return;
    jugee = show.id;
    plan = show.quiz.questions;
    state = { ...state, total: plan.length };
    await update(partie(), {
      state,
      showStatus: { id: show.id, status: "applied", at: Date.now() },
      conducteur: { id: show.quiz.id, title: show.title, rev: show.id, ...DRAPEAUX, questions: plan },
      public: { title: show.title, childName: show.childName },
    });
  })));
  // Jeux au buzzer : le premier buzz écrit sous la clé en cours, par une équipe de cette partie, fige le jeu pour elle.
  stops.push(onValue(partie("buzz"), (s) => enFile(async () => {
    const team = s.val()?.[state.round]?.team;
    if (!AU_BUZZER.includes(state.kind) || state.phase !== "question" || state.paused || !team || !teams[team] || state.buzz?.team || state.buzz?.blocked?.includes(team)) return;
    state = { ...state, seq: state.seq + 1, buzzOpen: false, buzz: { ...state.buzz, team } };
    await update(partie(), { state, ...journal(state.seq, "Buzzed", { team }) });
  })));
  // Commandes une par une, dans l'ordre des clés, comme la box.
  stops.push(onValue(partie("commands"), (s) => {
    for (const [id, cmd] of Object.entries(s.val() ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (traitees.has(id)) continue;
      traitees.add(id);
      enFile(() => traiter(id, cmd));
    }
  }));

  const boite = {
    code, host,
    get state() { return state; },
    /** La box perd Internet : plus rien n'arrive ni ne part (son état publié reste figé). */
    couper: () => goOffline(db),
    retablir: () => goOnline(db),
    stop: () => stops.forEach((f) => f()),
  };
  boites.push(boite);
  return boite;
}

/** Scores reconstruits à partir du seul journal d'une partie. */
function scoresDuJournal(log) {
  const scores = {};
  for (const e of Object.values(log ?? {})) {
    if (e.type === "ScoreAdjusted") scores[e.team] = (scores[e.team] ?? 0) + e.delta;
    for (const [t, n] of Object.entries(e.points ?? {})) scores[t] = (scores[t] ?? 0) + n;
  }
  return scores;
}

// ---------- Pages (vraies régies, vrais pupitres) et tablettes simulées ----------

async function ouvrirPage(path) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  contextes.push(context);
  await context.route("https://www.gstatic.com/firebasejs/11.1.0/*", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    route.fulfill({ path: join(FIREBASE_JS, name), contentType: "text/javascript" });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("Erreur page :", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.error("Console :", m.text()); });
  await page.goto(`${baseUrl}${path}`);
  return page;
}

/** L'animatrice scanne le QR code de SA TV, touche « Accès régie » et tape le mot de passe commun. */
async function taperMotDePasse(page) {
  await page.locator("#regie-open:not([hidden])").click();
  await page.fill("#regie-password", PASSWORD);
  await page.click("#regie-go");
}
const enRegie = (page, timeout = 30000) => page.locator("#regie:not([hidden])").waitFor({ timeout });

/** Les trois animatrices entrent dans leur régie au même moment (un seul essai de mot de passe chacune). */
async function troisRegies() {
  const regies = await Promise.all(FETES.map((f) => ouvrirPage(`/?g=${f.code}&emu=1`)));
  await Promise.all(regies.map((p) => p.locator("#regie-open:not([hidden])").waitFor()));
  await Promise.all(regies.map(taperMotDePasse));
  await Promise.all(regies.map((p) => enRegie(p)));
  return regies;
}

const uidRegie = async (fete) => Object.keys((await lire(fete, "regie")) ?? {})[0];

/** Chaque animatrice charge la prestation de SA fête, toutes au même moment. */
async function chargerPrestations(regies) {
  await Promise.all(regies.map(async (p, i) => {
    await p.locator("#panel-show:not([hidden]) .show-item", { hasText: FETES[i].nom }).click();
    await p.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
  }));
}

/** Tablette d'équipe simulée : son propre compte, les mêmes écritures que la page des pupitres, sous les règles. */
function tablette(fete, uid) {
  const db = env.authenticatedContext(uid).database();
  const presence = ref(db, `games/${fete.code}/presence/${uid}`);
  const signaler = async () => {
    await onDisconnect(presence).set({ online: false, at: serverTimestamp() });
    await set(presence, { online: true, at: serverTimestamp() });
  };
  return {
    uid, fete,
    async rejoindre(name, color) {
      // Comme le pupitre : l'équipe et sa couleur réservée dans la même écriture.
      await update(ref(db, `games/${fete.code}`), {
        [`teams/${uid}`]: { name, color, joinedAt: serverTimestamp() },
        [`colors/${color.slice(1).toUpperCase()}`]: uid,
      });
      await signaler();
    },
    repondre: (qid, choice) => set(ref(db, `games/${fete.code}/answers/${qid}/${uid}`), { choice, at: serverTimestamp() }),
    buzzer: (round) => set(ref(db, `games/${fete.code}/buzz/${round}`), { team: uid, at: serverTimestamp() }),
    couper: () => goOffline(db),
    async retablir() { goOnline(db); await signaler(); },
  };
}

/** Un pupitre (vraie page) rejoint la partie de sa fête sous le nom [name]. */
async function pupitre(fete, name) {
  const page = await ouvrirPage(`/?g=${fete.code}&emu=1`);
  await page.locator("#screen-join.active").waitFor();
  await page.fill("#team-name", name);
  await page.click("#join");
  await page.locator("#screen-play.active").waitFor();
  return page;
}

/**
 * Les trois fêtes prêtes à jouer : box, régies entrées en même temps, prestations chargées, puis toutes les équipes
 * qui rejoignent au même moment. Deux fêtes ont chacune leurs « Licornes » (même nom, même couleur), la troisième
 * aussi, sur une tablette simulée.
 */
async function troisFetesPretes() {
  await Promise.all(FETES.map(demarrerBoite));
  const regies = await troisRegies();
  await chargerPrestations(regies);
  const t = {
    dragons: tablette(LEA, "lea-dragons"), pirates: tablette(LEA, "lea-pirates"), fusees: tablette(LEA, "lea-fusees"),
    sirenes: tablette(TOM, "tom-sirenes"), ninjas: tablette(TOM, "tom-ninjas"),
    licornesInes: tablette(INES, "ines-licornes"),
  };
  const [pupLea, pupTom, pupInes] = await Promise.all([
    pupitre(LEA, "Licornes"), pupitre(TOM, "Licornes"), pupitre(INES, "Comètes"),
    t.dragons.rejoindre("Dragons", "#FFD166"), t.pirates.rejoindre("Pirates", "#06D6A0"), t.fusees.rejoindre("Fusées", "#2B86C5"),
    t.sirenes.rejoindre("Sirènes", "#FFD166"), t.ninjas.rejoindre("Ninjas", "#06D6A0"),
    t.licornesInes.rejoindre("Licornes", "#FFD166"),
  ]);
  const simulees = new Set(Object.values(t).map((x) => x.uid));
  const equipes = await Promise.all(FETES.map((f) => lire(f, "teams")));
  const pageUid = (i, name) => Object.entries(equipes[i]).find(([uid, e]) => e.name === name && !simulees.has(uid))[0];
  return {
    regies, t, equipes,
    pupitres: [pupLea, pupTom, pupInes],
    uids: { licornesLea: pageUid(0, "Licornes"), licornesTom: pageUid(1, "Licornes"), cometes: pageUid(2, "Comètes") },
    plans: await Promise.all(FETES.map(async (f) => (await lire(f, "conducteur")).questions)),
  };
}

/** Les trois animatrices lancent la fête au même moment ; chaque partie ouvre SA première question. */
async function lancerLesTrois(regies, plans) {
  await Promise.all(regies.map((p) => p.locator("#c-next:not([disabled])", { hasText: "Lancer la fête !" }).click()));
  await Promise.all(FETES.map((f) => waitFor(async () => (await lire(f, "state"))?.phase === "question", `question ouverte chez ${f.nom}`)));
  await Promise.all(regies.map((p, i) => p.locator("#c-question", { hasText: plans[i][0].text }).waitFor()));
}

const commandesDe = async (fete) => Object.values((await lire(fete, "commands")) ?? {});

describe("trois fêtes en même temps sur trois box", () => {
  test("trois animatrices tapent le mot de passe au même moment, et Sarah ouvre la Régie PC : toutes entrent sans retaper, chacune dans sa fête", async () => {
    await Promise.all(FETES.map(demarrerBoite));
    const regies = await Promise.all(FETES.map((f) => ouvrirPage(`/?g=${f.code}&emu=1`)));
    const admin = await ouvrirPage("/admin.html?emu=1");
    await Promise.all(regies.map((p) => p.locator("#regie-open:not([hidden])").waitFor()));
    await admin.locator("#login:enabled").waitFor();
    // Un seul essai de mot de passe toutes les 2 secondes pour tous les appareils (regieGate/try) : quatre appareils
    // tapent au même moment, chacun doit attendre son tour tout seul, jamais « Trop d'essais » ni un mot de passe à retaper.
    const debut = Date.now();
    await Promise.all([
      ...regies.map(taperMotDePasse),
      admin.fill("#admin-password", ADMIN_PASSWORD).then(() => admin.click("#login")),
    ]);
    await Promise.all([...regies.map((p) => enRegie(p, 40000)), admin.locator("#screen-home:not([hidden])").waitFor({ timeout: 40000 })]);
    console.log(`Quatre connexions simultanées : ${Date.now() - debut} ms`);
    for (const p of regies) assert.equal(await p.locator("#regie-status", { hasText: "Trop d'essais" }).count(), 0);

    // Chaque téléphone est relié à SA partie seulement, et à aucune autre.
    const reliees = await Promise.all(FETES.map((f) => lire(f, "regie")));
    reliees.forEach((r, i) => {
      assert.equal(Object.keys(r ?? {}).length, 1, `une seule régie chez ${FETES[i].nom}`);
      assert.equal(Object.values(r)[0].via, "password");
    });
    assert.equal(new Set(reliees.map((r) => Object.keys(r)[0])).size, 3, "trois téléphones différents");
    for (const [i, p] of regies.entries()) {
      assert.equal(await p.textContent("#c-code"), FETES[i].code);
      // Le salon d'attente de sa fête, avec la liste des prestations à charger.
      await p.locator("#panel-show:not([hidden]) .show-item", { hasText: FETES[i].nom }).waitFor();
    }
  });

  test("chaque animatrice charge sa prestation au même moment : programme, prénom, photos et extraits seulement dans sa partie", async () => {
    await Promise.all(FETES.map(demarrerBoite));
    const regies = await troisRegies();
    await chargerPrestations(regies);
    const regieUids = await Promise.all(FETES.map(uidRegie));
    for (const [i, f] of FETES.entries()) {
      const show = await lire(f, "show");
      assert.equal(show.childName, f.nom);
      assert.equal(show.by, regieUids[i], "chargée par la régie de cette fête");
      assert.equal((await lire(f, "showStatus")).id, show.id);
      assert.equal((await lire(f, "conducteur")).title, `L'anniversaire de ${f.nom}`);
      assert.deepEqual(await lire(f, "public"), { title: `L'anniversaire de ${f.nom}`, childName: f.nom });
      await regies[i].locator("#c-step", { hasText: `L'anniversaire de ${f.nom}` }).waitFor();
    }
    const plans = await Promise.all(FETES.map(async (f) => (await lire(f, "conducteur")).questions));
    assert.deepEqual(plans.map((q) => q[0].text), ["Roi de la jungle ?", "Quel est ce titre ?", plans[2][0].text]);
    assert.equal(plans[2][0].kind, "chante");
    // Même identifiant de première question dans les trois parties (r1q1) : seul le code de la partie les sépare.
    assert.deepEqual(plans.map((q) => q[0].id), ["r1q1", "r1q1", "r1q1"]);

    // Médias : la photo du lion seulement chez Léa, les extraits seulement chez Tom, rien chez Inès.
    await waitFor(async () => (await lire(LEA, `images/${PHOTO_LION}`)) === PNG, "photo copiée chez Léa");
    await waitFor(async () => Object.keys((await lire(TOM, "sounds")) ?? {}).length === 3, "extraits copiés chez Tom");
    assert.deepEqual(await lire(TOM, "sounds"), BIBLIOTHEQUE.sounds);
    // Les copies continuent après le verdict de la TV : on laisse le temps à une copie égarée d'arriver.
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await lire(LEA, "sounds"), null, "aucun extrait chez Léa");
    assert.deepEqual(await lire(LEA, "images"), { [PHOTO_LION]: PNG }, "seulement la photo de son quiz chez Léa");
    for (const [f, dir] of [[TOM, "images"], [TOM, "choiceImages"], [INES, "images"], [INES, "sounds"], [INES, "choiceImages"], [LEA, "choiceImages"]]) {
      assert.equal(await lire(f, dir), null, `rien dans ${dir} chez ${f.nom}`);
    }
  });

  test("les trois fêtes jouent au même moment : réponses, buzz, pause, points et commandes ne sortent jamais de leur fête", async () => {
    const { regies, t, pupitres, uids, plans, equipes } = await troisFetesPretes();
    const [regieLea, regieTom, regieInes] = regies;
    const [pupLea, pupTom, pupInes] = pupitres;
    // Chaque partie a ses équipes, et seulement elles (deux « Licornes » de même couleur dans deux fêtes).
    assert.deepEqual(equipes.map((e) => Object.values(e).map((x) => x.name).sort()), [
      ["Dragons", "Fusées", "Licornes", "Pirates"], ["Licornes", "Ninjas", "Sirènes"], ["Comètes", "Licornes"],
    ]);
    const tous = equipes.flatMap((e) => Object.keys(e));
    assert.equal(new Set(tous).size, tous.length, "aucun appareil inscrit dans deux fêtes");
    assert.equal(equipes[0][uids.licornesLea].color, equipes[1][uids.licornesTom].color, "mêmes Licornes roses dans deux fêtes");

    await lancerLesTrois(regies, plans);
    const [qLea, qTom, qInes] = plans.map((p) => p[0]);
    // Chaque pupitre affiche la question de SA fête.
    await pupLea.locator("#screen-question.active .choice", { hasText: "Lion" }).waitFor();
    await pupTom.locator("#screen-question.active .choice", { hasText: "Hakuna Matata" }).waitFor();
    await pupInes.locator("#screen-play.active #buzz:not([disabled])").waitFor();
    const roundInes = (await lire(INES, "state")).round;

    // Toutes les tablettes des trois fêtes répondent ou buzzent au même moment (même identifiant de question partout).
    const fauxTom = (qTom.correct + 1) % qTom.choices.length;
    await Promise.all([
      pupLea.locator(".choice").nth(qLea.correct).click(),
      t.dragons.repondre(qLea.id, qLea.correct),
      t.pirates.repondre(qLea.id, (qLea.correct + 1) % qLea.choices.length),
      pupTom.locator(".choice").nth(fauxTom).click(),
      t.sirenes.repondre(qTom.id, qTom.correct),
      t.ninjas.repondre(qTom.id, qTom.correct),
      // Deux équipes d'Inès buzzent presque ensemble : la plus lente est refusée par la base (le premier gagne), et son
      // bouton se grise dès que la box a retenu l'autre : c'est attendu.
      pupInes.locator("#buzz").click({ timeout: 3000 }).catch(() => "trop tard"),
      new Promise((r) => setTimeout(r, 300)).then(() => t.licornesInes.buzzer(roundInes)).catch(() => "trop tard"),
    ]);
    const reponsesLea = await waitFor(async () => { const a = await lire(LEA, `answers/${qLea.id}`); return Object.keys(a ?? {}).length === 3 && a; }, "3 réponses chez Léa");
    const reponsesTom = await waitFor(async () => { const a = await lire(TOM, `answers/${qTom.id}`); return Object.keys(a ?? {}).length === 3 && a; }, "3 réponses chez Tom");
    assert.deepEqual(Object.keys(reponsesLea).sort(), [uids.licornesLea, "lea-dragons", "lea-pirates"].sort());
    assert.deepEqual(Object.keys(reponsesTom).sort(), [uids.licornesTom, "tom-ninjas", "tom-sirenes"].sort());
    assert.equal(reponsesTom[uids.licornesTom].choice, fauxTom, "les Licornes de Tom gardent leur propre réponse");
    assert.equal(await lire(INES, "answers"), null, "aucune réponse chez Inès (jeu au buzzer)");
    const buzzeur = await waitFor(async () => (await lire(INES, "state"))?.buzz?.team, "buzz retenu chez Inès");
    assert.ok([uids.cometes, "ines-licornes"].includes(buzzeur));
    assert.equal(await lire(LEA, "buzz"), null, "aucun buzz chez Léa");
    assert.equal(await lire(TOM, "buzz"), null, "aucun buzz chez Tom");
    await regieInes.locator("#flou-judge:not([hidden])").waitFor();

    // Les trois animatrices au même moment : +50 aux Licornes de Léa, pause chez Tom, bonne réponse chez Inès.
    const avantLea = await lire(LEA, "state");
    await Promise.all([
      (async () => {
        await regieLea.locator(`#panel-teams [data-team="${uids.licornesLea}"] .pts-open`).click();
        await regieLea.locator("#pts-input").fill("50");
        await regieLea.click("#pts-ok");
      })(),
      regieTom.locator("#c-pause", { hasText: "Pause" }).click(),
      regieInes.locator("#flou-ok").click(),
    ]);
    await waitFor(async () => (await lire(TOM, "state")).paused === true, "pause chez Tom");
    await waitFor(async () => (await lire(LEA, "state")).scores?.[uids.licornesLea] === 50, "+50 chez Léa");
    await waitFor(async () => (await lire(INES, "state")).phase === "reveal", "bonne réponse chez Inès");
    const [lea1, tom1, ines1] = await Promise.all(FETES.map((f) => lire(f, "state")));
    // La pause de Tom n'a figé ni Léa ni Inès ; le chrono de Léa n'a pas bougé.
    assert.equal(lea1.paused, false);
    assert.equal(lea1.deadline, avantLea.deadline, "chrono de Léa intact");
    assert.equal(lea1.remainingMs, undefined);
    assert.equal(lea1.phase, "question");
    assert.equal(ines1.paused, false);
    assert.ok(tom1.remainingMs > 0 && tom1.deadline === undefined, "chrono de Tom figé");
    // Les points des Licornes de Léa ne vont pas aux Licornes de Tom ni d'Inès.
    assert.deepEqual(tom1.scores ?? {}, {});
    assert.deepEqual(ines1.scores, { [buzzeur]: 150 });
    await pupTom.locator("#paused:not([hidden])").waitFor();
    assert.equal(await pupLea.locator("#paused").isHidden(), true, "pupitre de Léa pas en pause");
    assert.equal(await pupInes.locator("#paused").isHidden(), true, "pupitre d'Inès pas en pause");
    await regieTom.locator("#c-phase", { hasText: "En pause" }).waitFor();
    assert.equal(await regieLea.locator("#c-phase").textContent(), "Question en cours");

    // Encore ensemble : Léa arrête le chrono, Tom reprend (3, 2, 1), Inès passe aux scores.
    await Promise.all([
      regieLea.locator("#c-next:not([disabled])", { hasText: "Arrêter le chrono" }).click(),
      regieTom.locator("#c-pause", { hasText: "Reprendre" }).click(),
      regieInes.locator("#c-next:not([disabled])", { hasText: "Voir les scores" }).click(),
    ]);
    await waitFor(async () => (await lire(LEA, "state")).phase === "closed", "chrono arrêté chez Léa");
    const tom2 = await waitFor(async () => { const s = await lire(TOM, "state"); return s.paused === false && s; }, "reprise chez Tom");
    assert.equal(tom2.deadline, tom2.resumeAt + tom1.remainingMs, "Tom repart avec le temps qui lui restait");
    assert.equal(tom2.phase, "question");
    await waitFor(async () => (await lire(INES, "state")).phase === "scores", "scores chez Inès");
    await Promise.all([
      regieLea.locator("#c-next:not([disabled])", { hasText: "Révéler la réponse" }).click(),
      // Après le décompte 3, 2, 1 seulement : le bouton reste grisé pendant le décompte.
      regieTom.locator("#c-next:not([disabled])", { hasText: "Arrêter le chrono" }).click({ timeout: 10000 }),
    ]);
    await regieTom.locator("#c-next:not([disabled])", { hasText: "Révéler la réponse" }).click();
    await waitFor(async () => (await lire(TOM, "state")).phase === "reveal", "réponse révélée chez Tom");
    await waitFor(async () => (await lire(LEA, "state")).phase === "reveal", "réponse révélée chez Léa");

    // Scores : chaque fête n'a compté que ses réponses, publiés par sa box et retrouvés dans son seul journal.
    const attendus = [
      { [uids.licornesLea]: 150, "lea-dragons": 100 },
      { "tom-sirenes": 100, "tom-ninjas": 100 },
      { [buzzeur]: 150 },
    ];
    for (const [i, f] of FETES.entries()) {
      const s = await lire(f, "state");
      assert.deepEqual(s.scores, attendus[i], `scores de ${f.nom}`);
      assert.deepEqual(scoresDuJournal(await lire(f, "log")), attendus[i], `journal de ${f.nom}`);
      for (const team of Object.keys(s.scores)) assert.ok(equipes[i][team], `${team} est une équipe de ${f.nom}`);
    }
    // Les pupitres de même nom voient chacun le résultat de SA fête.
    await pupLea.locator("#r-title", { hasText: "Bravo ! +100 points" }).waitFor();
    await pupTom.locator("#r-title", { hasText: "Raté pour cette fois !" }).waitFor();
    await pupInes.locator("#r-title", { hasText: buzzeur === uids.cometes ? "Bravo ! +150 points" : "Licornes a trouvé !" }).waitFor();

    // Chaque partie n'a reçu que les commandes de SA régie, toutes traitées par SA box.
    const regieUids = await Promise.all(FETES.map(uidRegie));
    const types = [];
    for (const [i, f] of FETES.entries()) {
      const cmds = await commandesDe(f);
      assert.ok(cmds.every((c) => c.by === regieUids[i]), `commandes de ${f.nom} envoyées par sa régie`);
      const statuts = await lire(f, "commandStatus");
      assert.deepEqual(Object.values(statuts).map((s) => s.status), cmds.map(() => "applied"), `commandes de ${f.nom} appliquées`);
      types.push(cmds.map((c) => c.type).sort());
    }
    assert.deepEqual(types, [["adjust", "close", "next", "next"], ["close", "next", "next", "pause", "resume"], ["buzz_ok", "next", "next"]]);
  });

  test("coupures pendant les trois fêtes : tablette et régie rechargées retrouvent leur fête, une box hors ligne ne gêne pas les deux autres", async () => {
    const { regies, t, pupitres, uids, plans } = await troisFetesPretes();
    const [regieLea, regieTom, regieInes] = regies;
    const [, , pupInes] = pupitres;
    await lancerLesTrois(regies, plans);
    const equipesAvant = await Promise.all(FETES.map((f) => lire(f, "teams")));

    // Une tablette d'Inès se recharge (onglet rouvert, page tuée par le téléphone) : elle retrouve son équipe, chez Inès.
    await pupInes.reload();
    await pupInes.locator("#screen-play.active .team-label", { hasText: "Comètes" }).waitFor();
    await pupInes.locator("#buzz:not([disabled])").waitFor();
    assert.deepEqual(await Promise.all(FETES.map((f) => lire(f, "teams"))), equipesAvant, "aucune équipe créée ni perdue");
    await waitFor(async () => (await lire(INES, `presence/${uids.cometes}`))?.online === true, "Comètes de nouveau en ligne");
    for (const f of [LEA, TOM]) assert.equal(await lire(f, `presence/${uids.cometes}`), null, `rien chez ${f.nom}`);

    // Une tablette de Léa perd le Wi-Fi : seule la régie de Léa le signale ; Tom et Inès ne voient rien.
    t.dragons.couper();
    await waitFor(async () => (await lire(LEA, "presence/lea-dragons"))?.online === false, "Dragons hors ligne chez Léa");
    await regieLea.locator("#r-alerte:not([hidden])", { hasText: "Dragons" }).waitFor({ timeout: 10000 });
    assert.equal(await regieTom.locator("#r-alerte").isHidden(), true, "aucune alerte chez Tom");
    assert.equal(await regieInes.locator("#r-alerte").isHidden(), true, "aucune alerte chez Inès");
    await t.dragons.retablir();
    await regieLea.locator("#r-alerte", { hasText: "revenue" }).waitFor();

    // La régie de Tom est rechargée en pleine question : elle reprend SA partie sans mot de passe, et elle seule.
    await regieTom.reload();
    await enRegie(regieTom);
    assert.equal(await regieTom.textContent("#c-code"), TOM.code);
    await regieTom.locator("#c-question", { hasText: plans[1][0].text }).waitFor();
    for (const f of FETES) assert.equal(Object.keys((await lire(f, "regie")) ?? {}).length, 1, `toujours une seule régie chez ${f.nom}`);
    const [lea0, ines0] = await Promise.all([lire(LEA, "state"), lire(INES, "state")]);
    await regieTom.locator("#c-pause", { hasText: "Pause" }).click();
    await waitFor(async () => (await lire(TOM, "state")).paused === true, "pause chez Tom après rechargement");
    assert.deepEqual(await lire(LEA, "state"), lea0, "Léa n'a pas bougé");
    assert.deepEqual(await lire(INES, "state"), ines0, "Inès n'a pas bougé");

    // La box de Léa perd Internet : sa régie le dit, Tom et Inès continuent comme si de rien n'était.
    const boiteLea = boites.find((b) => b.code === LEA.code);
    boiteLea.couper();
    await regieLea.locator("#c-next:not([disabled])", { hasText: "Arrêter le chrono" }).click();
    await Promise.all([
      regieTom.locator("#c-pause", { hasText: "Reprendre" }).click(),
      regieInes.locator("#c-next:not([disabled])", { hasText: "Arrêter le chrono" }).click(),
    ]);
    await waitFor(async () => (await lire(TOM, "state")).paused === false, "reprise chez Tom pendant la coupure de Léa", 5000);
    await waitFor(async () => (await lire(INES, "state")).phase === "closed", "chrono arrêté chez Inès pendant la coupure de Léa", 5000);
    await regieLea.locator("#r-toast", { hasText: "La TV ne répond pas" }).waitFor({ timeout: 10000 });
    assert.deepEqual(await lire(LEA, "state"), lea0, "partie de Léa figée tant que sa box est coupée");
    // Les tablettes des autres fêtes jouent toujours : une réponse chez Tom passe.
    const { resumeAt } = await lire(TOM, "state");
    await new Promise((r) => setTimeout(r, Math.max(0, resumeAt - Date.now() + 200)));
    await t.sirenes.repondre(plans[1][0].id, plans[1][0].correct);

    // Retour d'Internet chez Léa : sa box traite la commande en attente, chez elle seulement.
    const [tom3, ines3] = await Promise.all([lire(TOM, "state"), lire(INES, "state")]);
    boiteLea.retablir();
    await waitFor(async () => (await lire(LEA, "state")).phase === "closed", "commande de Léa traitée au retour du réseau");
    await regieLea.locator("#c-phase", { hasText: "Temps écoulé" }).waitFor();
    assert.deepEqual(await lire(TOM, "state"), tom3, "Tom n'a pas bougé au retour de la box de Léa");
    assert.deepEqual(await lire(INES, "state"), ines3, "Inès n'a pas bougé au retour de la box de Léa");
    assert.deepEqual(await Promise.all(FETES.map((f) => lire(f, "teams"))), equipesAvant, "équipes intactes");
  });
});

describe("règles : d'une fête à l'autre, rien ne passe", () => {
  /** Deux parties en pleine question, avec la même question r1q1 et chacune ses « Licornes », sa régie, ses médias. */
  const partie = (fete, licornes, regie) => ({
    hostUid: fete.host,
    state: { phase: "question", seq: 3, index: 0, total: 3, qid: "r1q1", kind: "classic", text: "Roi de la jungle ?", choices: ["Lion", "Tigre", "Zèbre", "Singe"], deadline: Date.now() + 600000, paused: false, round: "r1q1-1000-0", buzzOpen: true, scores: {} },
    teams: { [licornes]: { name: "Licornes", color: "#FF3CAC", joinedAt: 1 } },
    colors: { FF3CAC: licornes },
    regie: { [regie]: { pairedAt: 1, via: "password" } },
    conducteur: { id: "q", title: `L'anniversaire de ${fete.nom}`, rev: "r", questions: [{ id: "r1q1", text: "Roi de la jungle ?", choices: ["Lion", "Tigre"], correct: 0 }] },
    commands: { c1: { type: "next", expectSeq: 0, by: regie, at: 1 } },
    commandStatus: { c1: { status: "applied", seq: 1, at: 1 } },
    log: { "000001": { seq: 1, at: 1, type: "QuestionOpened" } },
    answers: { r1q1: { [licornes]: { choice: 0, at: 1 } } },
    joinRequests: { "tablette-en-retard": { name: "Retard", color: "#9B5DE5", at: 1 } },
    show: { id: "s1", title: `L'anniversaire de ${fete.nom}`, quiz: { questions: [{ id: "r1q1" }] }, by: regie, at: 1 },
    showStatus: { id: "s1", status: "applied", at: 1 },
    images: { [PHOTO_LION]: PNG },
    sounds: { [SONS[0]]: MP3(0) },
    media: { [SONS[0]]: "ok" },
    public: { title: `L'anniversaire de ${fete.nom}`, childName: fete.nom },
  });

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const d = ctx.database();
      await set(ref(d, `games/${LEA.code}`), partie(LEA, "lea-licornes", "regie-lea"));
      await set(ref(d, `games/${TOM.code}`), partie(TOM, "tom-licornes", "regie-tom"));
    });
  });

  const db = (uid) => env.authenticatedContext(uid).database();
  const chez = (fete, path) => `games/${fete.code}/${path}`;
  /** La même opération : permise dans sa propre fête, refusée dans l'autre. */
  async function seulementChezSoi(qui, operation) {
    await assertSucceeds(operation(db(qui), LEA));
    await assertFails(operation(db(qui), TOM));
  }

  test("la régie de Léa ne commande, ne charge, ne copie et ne lit rien chez Tom", async () => {
    const commande = { type: "pause", expectSeq: 3, by: "regie-lea", at: serverTimestamp() };
    await seulementChezSoi("regie-lea", (d, f) => set(push(ref(d, chez(f, "commands"))), commande));
    await seulementChezSoi("regie-lea", (d, f) => set(push(ref(d, chez(f, "commands"))), { type: "adjust", team: `${f === LEA ? "lea" : "tom"}-licornes`, delta: 50, expectSeq: 3, by: "regie-lea", at: serverTimestamp() }));
    await seulementChezSoi("regie-lea", (d, f) => set(ref(d, chez(f, "show")), { id: "s2", base: "r", title: "Programme", quiz: { questions: [{ id: "x" }] }, by: "regie-lea", at: serverTimestamp() }));
    await seulementChezSoi("regie-lea", (d, f) => set(ref(d, chez(f, "images/0123456789abcdef")), PNG));
    await seulementChezSoi("regie-lea", (d, f) => set(ref(d, chez(f, "sounds/0123456789abcdef")), MP3(9)));
    await seulementChezSoi("regie-lea", (d, f) => set(ref(d, chez(f, "joinRequests/tablette-en-retard")), null));
    for (const path of ["conducteur", "commands", "commandStatus", "log", "answers/r1q1", "joinRequests", "show", "showStatus", `images/${PHOTO_LION}`, `sounds/${SONS[0]}`, "media"]) {
      await seulementChezSoi("regie-lea", (d, f) => get(ref(d, chez(f, path))));
    }
    // Elle ne lit pas la régie de Tom, et ne s'inscrit pas chez Tom sans retaper le mot de passe.
    await assertFails(get(ref(db("regie-lea"), chez(TOM, "regie/regie-tom"))));
    await assertFails(set(ref(db("regie-lea"), chez(TOM, "regie/regie-lea")), { pairedAt: serverTimestamp(), via: "password" }));
  });

  test("une tablette de Léa ne répond, ne buzze et ne se signale jamais chez Tom, même avec le même nom d'équipe et la même question", async () => {
    await seulementChezSoi("lea-licornes", (d, f) => set(ref(d, chez(f, "presence/lea-licornes")), { online: true, at: serverTimestamp() }));
    // Personne n'a encore répondu : la tablette répond sous son identifiant, puis sous celui des Licornes de Tom.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const d = ctx.database();
      for (const f of [LEA, TOM]) await set(ref(d, chez(f, "answers")), null);
    });
    await seulementChezSoi("lea-licornes", (d, f) => set(ref(d, chez(f, "answers/r1q1/lea-licornes")), { choice: 0, at: serverTimestamp() }));
    await assertFails(set(ref(db("lea-licornes"), chez(TOM, "answers/r1q1/tom-licornes")), { choice: 1, at: serverTimestamp() }));
    await seulementChezSoi("lea-licornes", (d, f) => set(ref(d, chez(f, "buzz/r1q1-1000-0")), { team: "lea-licornes", at: serverTimestamp() }));
    await assertFails(set(ref(db("lea-licornes"), chez(TOM, "buzz/r1q1-1000-0")), { team: "tom-licornes", at: serverTimestamp() }));
    await assertFails(get(ref(db("lea-licornes"), chez(TOM, "answers/r1q1/tom-licornes"))));
    // Chez Tom, ni réponse ni buzz : la question reste entière pour ses équipes.
    let tom;
    await env.withSecurityRulesDisabled(async (ctx) => { tom = (await get(ref(ctx.database(), `games/${TOM.code}`))).val(); });
    assert.equal(tom.answers, undefined);
    assert.equal(tom.buzz, undefined);
    assert.equal(tom.presence, undefined);
    // La tablette de Tom, elle, répond normalement.
    await assertSucceeds(set(ref(db("tom-licornes"), chez(TOM, "answers/r1q1/tom-licornes")), { choice: 1, at: serverTimestamp() }));
  });

  test("la box de Léa n'écrit ni ne lit rien de privé dans la partie de Tom, et ne peut pas prendre son code", async () => {
    const hote = LEA.host;
    await seulementChezSoi(hote, (d, f) => update(ref(d, chez(f, "state")), { paused: true }));
    await seulementChezSoi(hote, (d, f) => set(ref(d, chez(f, "log/000002")), { seq: 2, at: 2, type: "ScoreAdjusted", team: "x", delta: 500 }));
    await seulementChezSoi(hote, (d, f) => set(ref(d, chez(f, "teams/intrus")), { name: "Intrus", color: "#123456" }));
    await seulementChezSoi(hote, (d, f) => set(ref(d, chez(f, "commandStatus/c2")), { status: "applied", at: 2 }));
    await seulementChezSoi(hote, (d, f) => set(ref(d, chez(f, "conducteur/title")), "Autre"));
    await seulementChezSoi(hote, (d, f) => set(ref(d, chez(f, "public")), { title: "Autre" }));
    await seulementChezSoi(hote, (d, f) => set(ref(d, chez(f, `media/${SONS[1]}`)), "ok"));
    await seulementChezSoi(hote, (d, f) => set(ref(d, chez(f, "answers/r1q1")), null));
    await seulementChezSoi(hote, (d, f) => set(ref(d, chez(f, `regie/${f === LEA ? "regie-lea" : "regie-tom"}`)), null));
    for (const path of ["log", "conducteur", "answers/r1q1", "commands", "show", `sounds/${SONS[0]}`]) {
      await seulementChezSoi(hote, (d, f) => get(ref(d, chez(f, path))));
    }
    await assertFails(get(ref(db(hote), `games/${TOM.code}`)));
    // Code déjà pris par la fête de Tom : la box de Léa ne peut pas réécrire la partie.
    await assertFails(set(ref(db(hote), `games/${TOM.code}`), { hostUid: hote, state: { phase: "lobby" } }));
    let hoteTom;
    await env.withSecurityRulesDisabled(async (ctx) => { hoteTom = (await get(ref(ctx.database(), chez(TOM, "hostUid")))).val(); });
    assert.equal(hoteTom, TOM.host);
  });
});
