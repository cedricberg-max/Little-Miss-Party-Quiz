// Régie de l'animatrice dans un vrai navigateur (Chromium) branché sur l'émulateur Firebase.
// Ce script joue le rôle de la box : il juge les demandes d'appairage et répond aux commandes.
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { ref, get, set, update, push, onValue, serverTimestamp } from "firebase/database";
import { chromium } from "playwright";
import { loadRules, seedAdmin, allowBox, ADMIN_PASSWORD } from "./rules-loader.js";
import { lockedUntil, isoDay, heureCourte, jourHeure } from "../web/public/show.js";
import { FULL_SHOW, FULL_KEYS, FULL_QUIZZES } from "../web/public/test-show.js";

const ROOT = new URL("..", import.meta.url).pathname;

/** Petite image PNG d'une seule couleur (8 × 8), pour déposer des images différentes dans l'administration. */
function png([r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.concat(Array.from({ length: 8 }, () => Buffer.from([0, ...Array.from({ length: 8 }, () => [r, g, b]).flat()])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
/** Image PNG [w] × [h] : moitié gauche de la couleur [left], moitié droite de la couleur [right]. */
function pngHalves(w, h, left, right) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.from([0, ...Array.from({ length: w }, (_, x) => (x < w / 2 ? left : right)).flat()]);
  const rows = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
const PUBLIC = join(ROOT, "web/public");
const FIREBASE_JS = join(ROOT, "tests/node_modules/firebase");
const CODE = "REGI2";
const HOST = "box";
const PIN = "0427";
const PASSWORD = "Licorne-2026";
const SALT = "sel-de-test-0123456789";

const testConfig = JSON.stringify({
  apiKey: "demo-key", authDomain: "demo-lmp.firebaseapp.com",
  databaseURL: "https://demo-lmp.firebaseio.com", projectId: "demo-lmp", appId: "demo",
});
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon" };

let env, server, browser, baseUrl;
let box = null;

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

const hostDb = () => env.authenticatedContext(HOST).database();
const read = async (path) => (await get(ref(hostDb(), `games/${CODE}/${path}`))).val();
const gameRef = (path = "") => ref(hostDb(), `games/${CODE}${path ? `/${path}` : ""}`);

const QUESTIONS = [
  { text: "Couleur du ciel ?", choices: ["Vert", "Bleu", "Rouge", "Jaune"], correct: 1 },
  { text: "Le soleil est une étoile", choices: ["Vrai", "Faux"], correct: 0 },
];

function questionState(seq, index = 0) {
  const q = QUESTIONS[index];
  return {
    phase: "question", seq, index, total: QUESTIONS.length, qid: `q${index + 1}`, kind: "classic", double: false,
    text: q.text, choices: q.choices, durationMs: 20000, paused: false, deadline: Date.now() + 20000,
    scores: {}, round: 1, buzzOpen: false,
  };
}

/**
 * Box simulée, avec les mêmes décisions que la vraie : PIN comparé côté box, commande
 * d'avancement refusée si expectSeq ne correspond plus, réponse dans commandStatus/.
 * [host] : la box qui pilote (une box de secours après « Changer de box »), qui reprend la partie à l'état
 * [from] ; les commandes [seen], restées sans réponse avant le changement de box, ne sont jamais rejouées.
 */
function startBox({ silent = false, held = false, host = HOST, from = null, seen = [] } = {}) {
  /** Verdict imposé à la prochaine modification du programme (pour vérifier ce qu'affiche la régie). */
  let refuseProgram = null;
  const db = env.authenticatedContext(host).database();
  const read = async (path) => (await get(ref(db, `games/${CODE}/${path}`))).val();
  let latest = {};
  let state = from ?? { phase: "lobby", seq: 0, total: QUESTIONS.length, scores: {}, round: 1, buzzOpen: true };
  const handled = new Set(seen);
  const stops = [];
  /** Manche de mimes en cours (paquet restant), comme le moteur : MimeRound. */
  let deck = [];
  let allCards = [];
  /** Sauts reçus de la régie (commande goto). */
  const gotos = [];
  stops.push(onValue(ref(db, `games/${CODE}/pairing`), async (s) => {
    for (const [uid, req] of Object.entries(s.val() ?? {})) {
      const ok = req.pin === PIN;
      await update(ref(db, `games/${CODE}`), {
        [`pairing/${uid}`]: null,
        [`pairingResult/${uid}`]: { status: ok ? "ok" : "wrong", at: Date.now() },
        ...(ok ? { [`regie/${uid}`]: { pairedAt: Date.now(), via: "pin" } } : {}),
      });
    }
  }));
  // Une par une, dans l'ordre des clés, comme la box.
  async function process() {
    for (const [id, cmd] of Object.entries(latest).sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (handled.has(id)) continue;
      handled.add(id);
      if (cmd.type === "admit" || cmd.type === "replace") { await admitDevice(id, cmd); continue; }
      const advance = ["next", "close", "end", "pause", "resume", "mime_start", "mime_found", "mime_pass", "mime_stop", "goto", "buzz_ok", "buzz_ko", "picto_show", "picto_draw"].includes(cmd.type);
      let status = { status: "applied" };
      if (advance && cmd.expectSeq !== state.seq) status = { status: "stale", reason: "stale" };
      else {
        const seq = state.seq + 1;
        const m = state.mime;
        if (cmd.type === "goto") {
          // Saut de la régie (secours) : même vérification du programme que Command.Goto.
          const plan = (await read("conducteur")) ?? { questions: [] };
          const q = plan?.questions?.[cmd.index];
          if (!q || q.id !== cmd.qid) status = { status: "refused", reason: "stale_program" };
          else {
            gotos.push({ index: cmd.index, qid: cmd.qid });
            state = q.kind === "mime"
              ? { ...state, seq, phase: "question", index: cmd.index, qid: q.id, kind: "mime", text: q.text, choices: null, deadline: null, paused: false, mime: { team: null, card: null, found: 0, passed: 0, left: q.cards.length, turns: [], counts: {}, points: 50 } }
              : { ...questionState(seq), index: cmd.index, qid: q.id, text: q.text, choices: q.choices, total: plan.questions.length, scores: state.scores, mime: null };
          }
        }
        else if (cmd.type === "buzz_ok" || cmd.type === "buzz_ko") {
          // Image floue : même verdict que BuzzJudged (150 au premier, 100 au rebond ; erreur = équipe bloquée, nouvelle clé).
          const b = state.buzz;
          if (state.phase !== "question" || !["flou", "chante", "quisuis"].includes(state.kind) || !b?.team || state.paused) status = { status: "refused", reason: "not_now" };
          else if (cmd.type === "buzz_ok") {
            const points = b.blocked.length ? 100 : 150;
            state = { ...state, seq, phase: "reveal", buzzOpen: false, awards: { [b.team]: { correct: true, points, bonus: 0 } }, scores: { ...state.scores, [b.team]: (state.scores[b.team] ?? 0) + points } };
          } else {
            const blocked = [...b.blocked, b.team];
            state = { ...state, seq, buzzOpen: true, round: `${state.qid}-1000-${blocked.length}`, buzz: { team: null, blocked }, buzzBlocked: Object.fromEntries(blocked.map((t) => [t, true])) };
          }
        }
        else if (cmd.type.startsWith("mime_") || cmd.type.startsWith("picto_") || (m && ["next", "close"].includes(cmd.type))) {
          const next = state.kind === "pictionary" ? pictoStep(state, cmd, seq) : mimeStep(state, cmd, seq);
          if (next) state = next; else status = { status: "refused", reason: "not_now" };
        }
        else if (cmd.type === "next" && state.phase === "lobby") state = questionState(seq);
        else if (cmd.type === "close") state = { ...state, seq, phase: "closed", deadline: null };
        else if (cmd.type === "pause" && state.paused) status = { status: "refused", reason: "not_now" };
        else if (cmd.type === "pause") state = { ...state, seq, paused: true, pauseReason: "regie", deadline: null, remainingMs: 15000 };
        else if (cmd.type === "resume") {
          const resumeAt = Date.now() + 3000;
          state = { ...state, seq, paused: false, pauseReason: null, pauseTeam: null, resumeAt, deadline: resumeAt + (state.remainingMs ?? 0), remainingMs: null };
        }
        else if (cmd.type === "next" && state.paused) status = { status: "refused", reason: "paused" };
        else if (cmd.type === "adjust") state = { ...state, seq, scored: true, scores: { ...state.scores, [cmd.team]: (state.scores[cmd.team] ?? 0) + cmd.delta } };
        else if (cmd.type === "undo") state = { ...state, seq };
        else if (cmd.type === "factor") {
          // Dernières questions du quiz : même règle que Command.Factor (entre deux questions seulement).
          if (!state.factorChoice) status = { status: "refused", reason: "not_now" };
          else state = { ...state, seq, factorChoice: { ...state.factorChoice, factor: cmd.factor } };
        }
        else if (cmd.type === "end") state = { ...state, seq, phase: "ended" };
        else state = { ...state, seq };
        if (status.status === "applied") status.seq = seq;
      }
      await update(ref(db, `games/${CODE}`), { state, [`commandStatus/${id}`]: { ...status, at: Date.now() } });
    }
  }
  /** Mimes : mêmes règles que le moteur (MimeTurnStarted, MimeFound, MimePassed, MimeCorrected, MimeTurnEnded). */
  function mimeStep(st, cmd, seq) {
    const m = st.mime;
    if (!m || st.paused) return null;
    const counts = { ...(m.counts ?? {}) };
    const add = (team, d) => {
      counts[team] = Math.max(0, (counts[team] ?? 0) + d);
      return { ...st.scores, [team]: (st.scores[team] ?? 0) + (counts[team] - (m.counts?.[team] ?? 0)) * 50 };
    };
    const endTurn = (x) => ({ ...x, deadline: null, mime: { ...x.mime, team: null, card: null, found: 0, passed: 0, last: { team: m.team, found: x.mime.found, passed: x.mime.passed } } });
    switch (cmd.type) {
      case "mime_start":
        if (m.team) return null;
        // Paquet épuisé par les équipes précédentes : rebattu pour que chaque équipe ait son tour.
        if (!deck.length) deck = [...allCards];
        return { ...st, seq, deadline: Date.now() + 60000, mime: { ...m, team: cmd.team, card: deck[0], found: 0, passed: 0, turns: [...(m.turns ?? []), cmd.team] } };
      case "mime_found": {
        if (!m.team) return null;
        const scores = add(m.team, 1);
        deck = deck.slice(1);
        const next = { ...st, seq, scores, mime: { ...m, counts, card: deck[0] ?? null, left: deck.length, found: m.found + 1 } };
        return deck.length ? next : endTurn(next);
      }
      case "mime_pass":
        if (!m.team || deck.length < 2) return null;
        deck = [...deck.slice(1), deck[0]];
        return { ...st, seq, mime: { ...m, card: deck[0], passed: m.passed + 1 } };
      case "mime_fix": {
        if ((counts[cmd.team] ?? 0) + cmd.delta < 0) return null;
        const scores = add(cmd.team, cmd.delta);
        const fix = (t) => (t && t.team === cmd.team ? { ...t, found: Math.max(0, t.found + cmd.delta) } : t);
        return { ...st, seq, scores, mime: { ...m, counts, found: m.team === cmd.team ? Math.max(0, m.found + cmd.delta) : m.found, last: fix(m.last) ?? null } };
      }
      case "mime_stop":
      case "close":
        return m.team ? endTurn({ ...st, seq }) : null;
      case "next":
        return m.team ? endTurn({ ...st, seq }) : { ...st, seq, phase: "scores", deadline: null };
      default:
        return null;
    }
  }
  /** Pictionary : mêmes règles que le moteur (PictoShown, PictoChosen, MimeTurnStarted, MimeFound, MimePassed, MimeTurnEnded). */
  function pictoStep(st, cmd, seq) {
    const m = st.mime;
    if (!m || st.paused) return null;
    const endTurn = (x, found) => {
      const counts = { ...(m.counts ?? {}) };
      if (found) counts[m.team] = (counts[m.team] ?? 0) + 1;
      deck = deck.filter((c) => c !== m.card);
      return { ...x, seq, deadline: null, scores: found ? { ...st.scores, [m.team]: (st.scores[m.team] ?? 0) + 150 } : st.scores,
        mime: { ...m, counts, team: null, card: null, drawKey: null, left: deck.length, last: { team: m.team, found: found ? 1 : 0, passed: 0, word: m.card.word } } };
    };
    switch (cmd.type) {
      case "picto_show":
        if (m.team || m.secret === cmd.team) return null;
        if (!deck.length) deck = [...allCards];
        return { ...st, seq, mime: { ...m, secret: cmd.team, offer: deck.slice(0, 3), chosen: null, card: null, pickKey: `${st.qid}-${seq}` } };
      case "picto_draw":
        if (!m.secret || m.chosen == null) return null;
        return { ...st, seq, deadline: Date.now() + 60000, mime: { ...m, team: m.secret, secret: null, offer: null, chosen: null, pickKey: null, drawKey: `${st.qid}-${seq}`, turns: [...(m.turns ?? []), m.secret] } };
      case "mime_pass":
        if (!m.secret || deck.length < 4) return null;
        deck = [...deck.slice(3), ...deck.slice(0, 3)];
        return { ...st, seq, mime: { ...m, offer: deck.slice(0, 3), chosen: null, card: null, pickKey: `${st.qid}-${seq}` } };
      case "mime_found":
        return m.team ? endTurn(st, true) : null;
      case "mime_stop":
      case "close":
        return m.team ? endTurn(st, false) : null;
      case "next":
        return m.team ? endTurn(st, false) : { ...st, seq, phase: "scores", deadline: null };
      default:
        return null;
    }
  }
  // Appareil arrivé en cours de partie : mêmes vérifications que GameViewModel.admitDevice.
  async function admitDevice(id, cmd) {
    const request = (await get(ref(db, `games/${CODE}/joinRequests/${cmd.device}`))).val();
    const teams = (await get(ref(db, `games/${CODE}/teams`))).val() ?? {};
    const entries = Object.entries(teams);
    const reason = !request ? "gone"
      : entries.some(([t, v]) => t === cmd.device || v.device === cmd.device) ? "busy"
        : cmd.type === "admit" && entries.length >= 8 ? "full"
          : cmd.type === "replace" && !teams[cmd.team] ? "unknown_team" : null;
    const updates = { [`commandStatus/${id}`]: { status: reason ? "refused" : "applied", ...(reason ? { reason } : {}), at: Date.now() } };
    if (!reason) {
      updates[`joinRequests/${cmd.device}`] = null;
      if (cmd.type === "replace") updates[`teams/${cmd.team}/device`] = cmd.device;
      else updates[`teams/${cmd.device}`] = { name: request.name, color: request.color, joinedAt: Date.now() };
    }
    await update(ref(db, `games/${CODE}`), updates);
  }
  // Prestation chargée par la régie, ou programme modifié en cours de partie : mêmes vérifications que
  // GameViewModel.judgeShow (version du programme, manche en cours intouchable), conducteur republié.
  let judgedShow = null;
  if (!silent) stops.push(onValue(ref(db, `games/${CODE}/show`), async (s) => {
    const show = s.val();
    if (!show || show.id === judgedShow) return;
    judgedShow = show.id;
    const plan = (await read("conducteur")) ?? { questions: [] };
    if (show.base == null) {
      // Mauvaise prestation : partie commencée, remplacée seulement si aucun point n'a été donné (retour au salon).
      const started = state.phase !== "lobby";
      if (started && (state.scored || state.phase === "ended")) {
        await update(ref(db, `games/${CODE}`), { showStatus: { id: show.id, status: "refused", reason: state.scored ? "points" : "not_now", at: Date.now() } });
        return;
      }
      if (started) state = { phase: "lobby", seq: state.seq + 1, total: show.quiz.questions.length, scores: {}, round: 1, buzzOpen: true };
      await update(ref(db, `games/${CODE}`), {
        showStatus: { id: show.id, status: "applied", at: Date.now() },
        conducteur: { id: show.quiz.id, title: show.title, rev: show.id, mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, blind: true, blindPlay: true, statues: true, disparu: true, pictionary: true, portes: true, coffres: true, gonfleur: true, patate: true, programReset: true, questions: show.quiz.questions },
        public: { title: show.title, ...(show.childName ? { childName: show.childName } : {}), ...(show.prestation ? { prestation: show.prestation } : {}) },
        ...(started ? { state } : {}),
      });
      return;
    }
    const index = state.phase === "lobby" ? -1 : state.index;
    const keep = lockedUntil(plan.questions, index);
    const same = (i) => JSON.stringify(show.quiz.questions[i]) === JSON.stringify(plan.questions[i]);
    const reason = refuseProgram ?? (show.base !== plan.rev ? "stale"
      : show.quiz.questions.length <= keep || ![...Array(keep + 1).keys()].every(same) ? "current_round" : null);
    refuseProgram = null;
    const updates = { showStatus: { id: show.id, status: reason ? "refused" : "applied", ...(reason ? { reason } : {}), at: Date.now() } };
    if (!reason) {
      state = { ...state, total: show.quiz.questions.length };
      Object.assign(updates, { state, conducteur: { ...plan, rev: show.id, questions: show.quiz.questions } });
    }
    await update(ref(db, `games/${CODE}`), updates);
  }));
  // Image floue : le premier buzz écrit sous la clé en cours fige l'image pour son équipe (comme watchBuzz).
  if (!silent) stops.push(onValue(ref(db, `games/${CODE}/buzz`), async (s) => {
    const team = s.val()?.[state.round]?.team;
    if (!["flou", "chante", "quisuis"].includes(state.kind) || state.phase !== "question" || !team || state.buzz?.team || state.buzz?.blocked.includes(team)) return;
    state = { ...state, seq: state.seq + 1, buzzOpen: false, buzz: { ...state.buzz, team } };
    await update(ref(db, `games/${CODE}`), { state });
  }));
  if (!silent) stops.push(onValue(ref(db, `games/${CODE}/commands`), (s) => {
    latest = s.val() ?? {};
    if (!held) process();
  }));
  return {
    stop: () => stops.forEach((f) => f()),
    release: () => { held = false; return process(); },
    get state() { return state; },
    /** Partie arrivée à une manche de mimes de [cards] (sans tour en cours). */
    async mimes(cards, scores = {}) {
      deck = cards;
      allCards = cards;
      state = {
        ...state, phase: "question", seq: state.seq + 1, index: 2, qid: "m1", kind: "mime", text: "Animaux", durationMs: 60000,
        choices: null, deadline: null, scores, buzzOpen: false,
        mime: { team: null, card: null, found: 0, passed: 0, left: cards.length, turns: [], counts: {}, points: 50 },
      };
      await update(ref(db, `games/${CODE}`), { state });
    },
    async picto(cards, scores = {}) {
      deck = cards;
      allCards = cards;
      state = {
        ...state, phase: "question", seq: state.seq + 1, index: 2, qid: "r3p", kind: "pictionary", text: "Pictionary", durationMs: 60000,
        choices: null, deadline: null, scores, buzzOpen: false,
        mime: { team: null, card: null, found: 0, passed: 0, left: cards.length, turns: [], counts: {}, points: 150 },
      };
      await update(ref(db, `games/${CODE}`), { state });
    },
    /** Pictionary : le dessinateur touche le mot [i] sur sa tablette (PictoChosen). */
    async pictoChoose(i) {
      state = { ...state, seq: state.seq + 1, mime: { ...state.mime, chosen: i, card: state.mime.offer[i] } };
      deck = [state.mime.card, ...deck.filter((c) => c !== state.mime.card)];
      await update(ref(db, `games/${CODE}`), { state });
    },
    refuseNextProgram: (reason) => { refuseProgram = reason; },
    gotos,
    /** Place la partie dans l'état [partial] (question en cours, partie terminée…). */
    async set(partial) {
      state = { ...state, ...partial };
      await update(ref(db, `games/${CODE}`), { state });
    },
  };
}

beforeEach(async () => {
  await env.clearDatabase();
  await seedAdmin(env);
  await allowBox(env, HOST);
  await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), "settings/regie"), {
    salt: SALT, hash: createHash("sha256").update(`${SALT}:${PASSWORD}`).digest("hex"), updatedAt: 1,
  }));
  await set(gameRef(), {
    hostUid: HOST,
    state: { phase: "lobby", seq: 0, total: QUESTIONS.length, scores: {}, round: 1, buzzOpen: true },
    conducteur: { id: "essai", title: "Démo", rev: "initial", mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, blind: true, blindPlay: true, statues: true, disparu: true, pictionary: true, portes: true, coffres: true, gonfleur: true, patate: true, questions: QUESTIONS.map((q, i) => ({ id: `q${i + 1}`, ...q })) },
  });
});
afterEach(() => { box?.stop(); box = null; });

async function addTeam(uid, name) {
  await env.withSecurityRulesDisabled((ctx) =>
    set(ref(ctx.database(), `games/${CODE}/teams/${uid}`), { name, color: "#FF2D8A", joinedAt: Date.now() }));
}

/**
 * Capture d'écran pour relire une page à l'œil, seulement si CAPTURES=<dossier> est donné (rien n'est vérifié).
 * [pleinePage] : toute la page ; sinon, ce qu'on voit dans l'écran (une fenêtre ouverte, par exemple).
 */
async function capture(page, nom, { pleinePage = true } = {}) {
  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/${nom}.png`, fullPage: pleinePage });
}

async function openRegie(context, query = `?g=${CODE}&emu=1`, path = "/") {
  context ??= await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("https://www.gstatic.com/firebasejs/11.1.0/*", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    route.fulfill({ path: join(FIREBASE_JS, name), contentType: "text/javascript" });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("Erreur page :", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.error("Console :", m.text()); });
  // Diagnostic : l'adresse exacte d'une requête refusée (émulateur ou vrai service Google).
  page.on("response", (r) => { if (r.status() >= 400) console.error("Réponse", r.status(), r.url(), "depuis", page.url()); });
  await page.goto(`${baseUrl}${path}${query}`);
  return page;
}

/** Statut « À venir » (prête pour la régie) : il lui faut une date à venir, sinon elle resterait « À compléter ». */
async function aVenir(page) {
  if (!(await page.inputValue("#show-date"))) await page.fill("#show-date", "2099-12-02");
  await page.selectOption("#show-status", "publiee");
}

/** Prestation : « ＋ Ajouter un jeu », puis la tuile du jeu (cedric, 21/10) ; le jeu arrive avec une manche. */
async function ajouterJeu(page, type = "quiz") {
  await page.click("#round-add");
  await page.click(`#jeu-choix .jeu-tuile[data-jeu="${type}"]`);
}

/** « ↺ Reprendre une manche déjà faite » (cedric, 23/10) : ouvre la liste sous la manche, puis prend la manche [cle]. */
async function reprendre(round, cle) {
  await round.locator(".reprendre-ouvrir").click();
  await round.locator(`.reprise-item[data-reprise="${cle}"]`).click();
}

/** Administration : le mot de passe commun, saisi sur le PC familial. */
async function openAdmin() {
  const page = await openRegie(null, "?emu=1", "/admin.html");
  await page.fill("#admin-password", ADMIN_PASSWORD);
  await page.click("#login");
  await page.locator("#screen-home:not([hidden])").waitFor();
  return page;
}

/** L'animatrice scanne le même QR code que les équipes, touche « Accès régie » et tape le mot de passe. */
/** Bonus de [amount] points pour une équipe, en deux temps : préparer le montant, puis valider. */
async function givePoints(page, team, amount) {
  await page.locator(`#panel-teams [data-team="${team}"] .pts-open`).click();
  await page.locator("#pts-input").fill(String(Math.abs(amount)));
  if (amount < 0) await page.click("#pts-malus");
  await page.click("#pts-ok");
}

async function pair(page, password = PASSWORD) {
  await page.locator("#regie-open:not([hidden])").click();
  await page.fill("#regie-password", password);
  await page.click("#regie-go");
}

const inRegie = (page) => page.locator("#regie:not([hidden])").waitFor({ timeout: 10000 });

const commands = async () => Object.values((await read("commands")) ?? {});

async function setPresence(uid, online) {
  await env.withSecurityRulesDisabled((ctx) =>
    set(ref(ctx.database(), `games/${CODE}/presence/${uid}`), { online, at: Date.now() }));
}

describe("régie", () => {
  test("mot de passe commun : un mauvais est refusé, le bon ouvre la régie", async () => {
    box = startBox();
    const page = await openRegie();
    await page.locator("#screen-join.active").waitFor();
    await pair(page, "licorne");
    await page.locator("#regie-status", { hasText: "Mot de passe de régie incorrect" }).waitFor();
    assert.equal(await read("regie"), null);
    await page.fill("#regie-password", PASSWORD);
    await page.click("#regie-go");
    await inRegie(page);
    assert.equal(Object.values(await read("regie"))[0].via, "password");
    // Le pupitre ne s'est pas inscrit comme équipe.
    assert.equal(await read("teams"), null);
    await page.context().close();
  });

  test("QR code d'une partie terminée : le bon mot de passe est refusé avec la vraie raison", async () => {
    box = startBox();
    await update(gameRef("state"), { phase: "ended" });
    const page = await openRegie();
    await pair(page);
    await page.locator("#regie-status", { hasText: "Cette partie est terminée. Scannez le QR code affiché en ce moment sur la TV." }).waitFor();
    assert.equal(await read("regie"), null);
    await page.context().close();
  });

  test("code de secours de la TV : un mauvais est refusé, le bon relie le téléphone", async () => {
    box = startBox();
    const page = await openRegie();
    await page.locator("#regie-open:not([hidden])").click();
    await page.click("#regie-use-pin");
    await page.fill("#regie-pin", "1111");
    await page.click("#regie-go");
    await page.locator("#regie-status", { hasText: "Code incorrect" }).waitFor();
    await page.fill("#regie-pin", PIN);
    await page.click("#regie-go");
    await inRegie(page);
    assert.equal(Object.values(await read("regie"))[0].via, "pin");
    await page.context().close();
  });

  test("sans mot de passe enregistré, la page oriente vers le code de la TV", async () => {
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), "settings/regie"), null));
    const page = await openRegie();
    await pair(page);
    await page.locator("#regie-status", { hasText: "Aucun mot de passe" }).waitFor();
    await page.context().close();
  });

  test("le bouton Accès régie disparaît pour une équipe qui joue", async () => {
    const page = await openRegie();
    await page.locator("#regie-open:not([hidden])").waitFor();
    await page.fill("#team-name", "Les Roses");
    await page.click("#join");
    await page.locator("#screen-play.active").waitFor();
    assert.equal(await page.locator("#regie-open").isHidden(), true);
    await page.context().close();
  });

  test("Sarah change le mot de passe dans l'administration : effet immédiat, régie en cours gardée", async () => {
    box = startBox();
    const before = await openRegie();
    await pair(before);
    await inRegie(before);

    const admin = await openAdmin();
    await admin.click("#nav button[data-screen=settings]");
    await admin.locator("#screen-settings:not([hidden])").waitFor();
    await admin.fill("#pw1", "court");
    await admin.fill("#pw2", "court");
    await admin.click("#save");
    await admin.locator("#save-status", { hasText: "au moins 8" }).waitFor();
    await admin.fill("#pw1", "Nouveau-Mdp-42");
    await admin.fill("#pw2", "Nouveau-Mdp-42");
    await admin.click("#save");
    await admin.locator("#save-status", { hasText: "Mot de passe de la régie enregistré" }).waitFor();

    const oldPassword = await openRegie();
    await pair(oldPassword, PASSWORD);
    await oldPassword.locator("#regie-status", { hasText: "Mot de passe de régie incorrect" }).waitFor();
    const newPassword = await openRegie();
    await pair(newPassword, "Nouveau-Mdp-42");
    await inRegie(newPassword);
    // L'animatrice reliée avant le changement pilote toujours.
    await addTeam("rose", "Les Roses");
    await before.locator("#c-next", { hasText: "Lancer la fête !" }).click();
    await before.locator("#c-question", { hasText: "Couleur du ciel ?" }).waitFor();
    for (const p of [before, admin, oldPassword, newPassword]) await p.context().close();
  });

  test("espaces ajoutés par le clavier du téléphone : le mot de passe de régie est quand même accepté", async () => {
    box = startBox();
    const admin = await openAdmin();
    await admin.click("#nav button[data-screen=settings]");
    await admin.locator("#screen-settings:not([hidden])").waitFor();
    await admin.fill("#pw1", "licorne 2468");
    await admin.fill("#pw2", "licorne2468 ");
    await admin.click("#save");
    await admin.locator("#save-status", { hasText: "Mot de passe de la régie enregistré" }).waitFor();
    const phone = await openRegie();
    await pair(phone, "licorne2468 ");
    await inRegie(phone);
    // Un mot de passe enregistré avec un espace avant cette règle s'ouvre encore tel quel.
    const salt = "0123456789abcdef0123";
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), "settings/regie"),
      { salt, hash: createHash("sha256").update(`${salt}:licorne 42`).digest("hex"), updatedAt: Date.now() }));
    const old = await openRegie();
    await pair(old, "licorne 42");
    await inRegie(old);
    for (const p of [admin, phone, old]) await p.context().close();
  });

  test("administration : une connexion ratée à l'ouverture est réessayée seule", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    let failed = 0;
    await context.route("**/accounts:signUp*", (route) => (failed++ ? route.continue() : route.abort("internetdisconnected")));
    const admin = await openRegie(context, "?emu=1", "/admin.html");
    // « Entrer » reste grisé tant que la page n'est pas prête (ici : après le rechargement automatique).
    await admin.locator("#login:enabled").waitFor();
    await admin.fill("#admin-password", ADMIN_PASSWORD);
    await admin.click("#login");
    await admin.locator("#screen-home:not([hidden])").waitFor();
    assert.ok(failed >= 2, "un premier essai refusé, puis un second accepté");
    await context.close();
  });

  test("un mauvais mot de passe administrateur n'ouvre rien", async () => {
    const admin = await openRegie(null, "?emu=1", "/admin.html");
    await admin.fill("#admin-password", "pas-le-bon-mdp");
    await admin.click("#login");
    await admin.locator("#login-status", { hasText: "Mot de passe incorrect" }).waitFor();
    assert.equal(await admin.locator("#screen-settings").isHidden(), true);
    assert.equal(await admin.locator("#nav").isHidden(), true);
    await admin.context().close();
  });

  test("le petit œil montre le mot de passe tapé, puis le masque à nouveau ; masqué après l'envoi", async () => {
    const admin = await openRegie(null, "?emu=1", "/admin.html");
    await admin.fill("#admin-password", "LICORNE-majuscules");
    const oeil = admin.locator(".oeil-champ:has(#admin-password) .oeil-bouton");
    assert.equal(await oeil.getAttribute("aria-label"), "Afficher le mot de passe");
    await oeil.click();
    assert.equal(await admin.locator("#admin-password").getAttribute("type"), "text", "caractères visibles");
    assert.equal(await admin.locator("#admin-password").inputValue(), "LICORNE-majuscules", "rien de perdu");
    assert.equal(await oeil.getAttribute("aria-label"), "Masquer le mot de passe");
    await oeil.click();
    assert.equal(await admin.locator("#admin-password").getAttribute("type"), "password");
    await oeil.click();
    await admin.click("#login");
    await admin.locator("#login-status", { hasText: "Mot de passe incorrect" }).waitFor();
    assert.equal(await admin.locator("#admin-password").getAttribute("type"), "password", "masqué après l'envoi");
    // Tous les champs de mot de passe de la page ont leur œil.
    assert.equal(await admin.locator('input[type="password"]:not(.oeil-champ > input)').count(), 0);
    await admin.context().close();
  });

  test("première configuration, appareil reconnu après rechargement, changement du mot de passe administrateur", async () => {
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), "settings/admin"), null));
    const pc = await openRegie(null, "?emu=1", "/admin.html");
    await pc.locator("#login-title", { hasText: "Première configuration" }).waitFor();
    await pc.fill("#admin-password", "Famille-2026");
    await pc.fill("#admin-password2", "Famille-2026");
    await pc.click("#login");
    await pc.locator("#screen-home:not([hidden])").waitFor();
    // Rechargement (ou coupure) : rien à ressaisir.
    await pc.reload();
    await pc.locator("#screen-home:not([hidden])").waitFor();
    // Un second ordinateur entre avec le même mot de passe.
    const portable = await openRegie(null, "?emu=1", "/admin.html");
    await portable.fill("#admin-password", "Famille-2026");
    await portable.click("#login");
    await portable.locator("#screen-home:not([hidden])").waitFor();
    // Changement depuis le PC : il reste connecté, le portable devra le ressaisir.
    await pc.click("#nav button[data-screen=settings]");
    await pc.fill("#admin-pw1", "Nouveau-Famille-1");
    await pc.fill("#admin-pw2", "Nouveau-Famille-1");
    await pc.click("#admin-save");
    await pc.locator("#admin-save-status", { hasText: "Mot de passe administrateur changé" }).waitFor({ timeout: 15000 });
    await portable.reload();
    await portable.locator("#login-title", { hasText: "Connexion" }).waitFor();
    await pc.reload();
    await pc.locator("#screen-home:not([hidden])").waitFor();
    for (const p of [pc, portable]) await p.context().close();
  });

  test("mimes : après le tour d'une équipe, la régie propose celle qui n'est pas passée, même sans avoir vu le tour", async () => {
    box = startBox();
    await addTeam("touk", "Touk");
    await addTeam("touka", "Touka");
    const plan = [{ id: "a1m", text: "Animaux", kind: "mime", duration: 60, round: "Animaux", cards: [{ word: "Chat", image: "🐱" }] }];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, questions: plan });
    const mime = (extra) => ({ ...questionState(2), index: 0, qid: "a1m", kind: "mime", text: "Animaux", choices: null, total: 1, deadline: null, mime: { team: null, card: null, found: 0, passed: 0, left: 13, turns: [], counts: {}, points: 50, ...extra } });
    await box.set(mime({}));
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    // Sarah choisit Touk ; le tour se joue pendant que l'écran du téléphone est éteint (la régie ne le voit pas).
    await page.locator(".mime-team[data-team=\"touk\"]").click();
    await page.locator("#mime-go", { hasText: "Top départ ! (Touk)" }).waitFor();
    await box.set(mime({ turns: ["touk"], counts: { touk: 13 }, last: { team: "touk", found: 13, passed: 0 } }));
    await page.locator("#mime-info", { hasText: "Tour terminé : Touk" }).waitFor();
    await page.locator("#mime-go", { hasText: "Top départ ! (Touka)" }).waitFor();
    // Faire rejouer Touk reste possible si Sarah la choisit exprès.
    await page.locator(".mime-team[data-team=\"touk\"]").click();
    await page.locator("#mime-go", { hasText: "Top départ ! (Touk)" }).waitFor();
    await page.context().close();
  });

  test("mimes : choisir l'équipe, lancer le tour, trouvé, passer, corriger ; les points vont au classement", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    const cards = [{ word: "Chat", image: "🐱" }, { word: "Pirate", image: "🏴‍☠️" }, { word: "Pizza", image: "🍕" }, { word: "Robot", image: "🤖" }];
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await box.mimes(cards, { rose: 100 });
    await page.locator("#mime:not([hidden])").waitFor();
    await page.locator("#mime-info", { hasText: "Qui commence ?" }).waitFor();
    assert.equal(await page.locator("#mime-found").isHidden(), true, "Pas de « Trouvé » avant le tour");
    await page.locator("#c-next", { hasText: "Terminer les mimes" }).waitFor();
    await page.locator(".mime-team", { hasText: "Les Bleus" }).click();
    await page.locator("#mime-go", { hasText: "Top départ ! (Les Bleus)" }).click();
    await page.locator("#mime-now .word", { hasText: "Chat" }).waitFor();
    await page.locator("#c-next", { hasText: "Arrêter le tour" }).waitFor();
    await page.click("#mime-found");
    await page.locator("#mime-now .word", { hasText: "Pirate" }).waitFor();
    await page.click("#mime-pass");
    await page.locator("#mime-now .word", { hasText: "Pizza" }).waitFor();
    await page.click("#mime-found");
    await page.locator("#mime-info", { hasText: "2 mimes trouvés" }).waitFor();
    await page.click("#mime-minus");
    await page.locator("#mime-info", { hasText: "1 mime trouvé" }).waitFor();
    await page.click("#c-next");
    await page.locator("#mime-info", { hasText: "Les Bleus a trouvé 1 mime" }).waitFor();
    // Juste après le tour : l'animatrice rend le point retiré par erreur.
    await page.click("#mime-fix-plus");
    await page.locator("#mime-info", { hasText: "Les Bleus a trouvé 2 mimes" }).waitFor();
    // L'équipe suivante proposée est celle qui n'a pas encore joué.
    await page.locator(".mime-team.selected", { hasText: "Les Roses" }).waitFor();
    await page.locator("#mime-progress", { hasText: "Déjà passées : Les Bleus · Restent : Les Roses" }).waitFor();
    assert.deepEqual((await commands()).map((c) => c.type), ["mime_start", "mime_found", "mime_pass", "mime_found", "mime_fix", "close", "mime_fix"]);
    assert.deepEqual((await commands()).find((c) => c.type === "mime_start").team, "bleu");
    // Terminer avant que toutes les équipes soient passées : confirmation, et rien n'est envoyé si on renonce.
    await page.click("#c-next");
    const asked = await respond(page, false);
    await page.waitForTimeout(300);
    assert.match(asked, /Les Roses n'est pas encore passée/);
    assert.equal((await commands()).length, 7);
    // Les Roses jouent (paquet rebattu au besoin), puis le classement sans confirmation.
    await page.click("#mime-go");
    await page.locator("#mime-found:not([hidden]):not([disabled])").waitFor();
    await page.click("#mime-found");
    await page.locator("#mime-info", { hasText: "Les Roses joue : 1 mime trouvé" }).waitFor();
    await page.click("#c-next");
    await page.locator("#mime-progress", { hasText: "Toutes les équipes sont passées" }).waitFor();
    await page.locator("#c-next", { hasText: "Voir le classement" }).click();
    await page.locator("#c-phase", { hasText: "Scores" }).waitFor();
    assert.deepEqual((await read("state")).scores, { rose: 150, bleu: 100 });
    assert.equal(await page.locator("#mime").isHidden(), true);
    await page.context().close();
  });

  for (const [width, height] of [[360, 640], [390, 780]]) {
    test(`petit téléphone ${width}×${height} : pendant un buzz en pause automatique, Reprendre et le bouton principal restent à l'écran`, async () => {
      box = startBox();
      await addTeam("rose", "Les Roses");
      await addTeam("bleu", "Les Bleus");
      const plan = [{ id: "c1", text: "Amour", kind: "chante", duration: 40, round: "Chante le mot !" }];
      await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, questions: plan });
      await box.set({ ...questionState(1), qid: "c1", kind: "chante", text: "Amour", choices: null, total: 1, round: "c1-1000-0", buzzOpen: false, buzz: { team: "rose", blocked: [] }, paused: true, pauseReason: "team", pauseTeam: "bleu", deadline: null, remainingMs: 20000 });
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await openRegie(context);
      await pair(page);
      await inRegie(page);
      await page.locator("#c-hold", { hasText: "Les Bleus" }).waitFor();
      await page.locator("#flou-judge:not([hidden])").waitFor();
      // Chaque bouton du bas est entièrement dans l'écran et c'est bien lui qu'un doigt touche.
      for (const id of ["c-pause", "c-end", "c-next"]) {
        const visible = await page.evaluate((id) => {
          const el = document.getElementById(id);
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.height > 0 && (hit === el || el.contains(hit));
        }, id);
        assert.ok(visible, `#${id} visible et touchable en ${width}×${height}`);
      }
      // Le reste se lit en faisant défiler la régie : les boutons de jugement sont atteignables.
      await page.locator("#flou-ko").scrollIntoViewIfNeeded();
      assert.ok(await page.locator("#flou-ko").isVisible());
      await page.locator("#c-pause", { hasText: "Reprendre (3, 2, 1)" }).click();
      await waitFor(async () => (await commands()).some((c) => c.type === "resume"), "reprise envoyée");
      await page.context().close();
    });
  }

  test("Image floue : la régie voit qui a buzzé et la réponse attendue, refuse puis valide le rebond", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    const plan = [{ id: "f1", text: "Qu'est-ce qui se cache sous le flou ?", choices: ["Un lion", "Un chat"], correct: 0, duration: 40, kind: "flou", imageId: "0123456789abcdef", round: "Image floue" }];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, questions: plan });
    await box.set({ ...questionState(1), qid: "f1", kind: "flou", text: plan[0].text, choices: null, total: 1, round: "f1-1000-0", buzzOpen: true, buzz: { team: null, blocked: [] } });
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await page.locator("#flou-info", { hasText: "En attente d'un buzz" }).waitFor();
    assert.equal(await page.locator("#flou-judge").isHidden(), true, "pas de verdict sans buzz");
    // Les Roses buzzent (écriture du pupitre) : la régie affiche l'équipe et la réponse attendue.
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/buzz/f1-1000-0`), { team: "rose", at: Date.now() }));
    await page.locator("#flou-info", { hasText: "Les Roses a buzzé ! Réponse attendue : Un lion" }).waitFor();
    await page.locator("#flou-ok small", { hasText: "+150 pour Les Roses" }).waitFor();
    await page.click("#flou-ko");
    await page.locator("#flou-info", { hasText: "Déjà essayé : Les Roses" }).waitFor();
    assert.deepEqual((await read("state")).buzz.blocked, ["rose"]);
    // Rebond des Bleus, validé : 100 points et révélation.
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/buzz/f1-1000-1`), { team: "bleu", at: Date.now() }));
    await page.locator("#flou-ok small", { hasText: "+100 pour Les Bleus" }).waitFor();
    await page.click("#flou-ok");
    await page.locator("#c-phase", { hasText: "Réponse révélée" }).waitFor();
    assert.deepEqual((await read("state")).scores, { bleu: 100 });
    assert.equal(await page.locator("#flou").isHidden(), true);
    await page.context().close();
  });

  test("blind test : playlist et statuts, lancer, juger, relancer pour les autres, passer, raccourcir, titre suivant", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    const track = (id, title, artist, audioId, points) => ({ id, text: "Quel est ce titre ?", choices: [title], correct: 0, duration: 25, kind: "blind", artist, audioId, points, round: "Blind test · Dessins animés" });
    const plan = [
      track("b1", "Libérée, délivrée", "La Reine des neiges", "0123456789abcdef", 100),
      track("b2", "Hakuna Matata", "Le Roi lion", "fedcba9876543210", 100),
      track("b3", "Un jour mon prince viendra", "Blanche-Neige", "00112233445566ff", 200),
    ];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, blind: true, blindPlay: true, statues: true, disparu: true, pictionary: true, portes: true, coffres: true, gonfleur: true, patate: true, questions: plan });
    // Comme la box : un état par extrait.
    for (const [id, status] of [["0123456789abcdef", "ok"], ["fedcba9876543210", "missing"], ["00112233445566ff", "ok"]]) await set(gameRef(`media/${id}`), status);
    const tracks = (statuses, team) => plan.map((t, k) => ({ qid: t.id, points: t.points, status: statuses[k], ...(statuses[k] === "found" ? { team } : {}) }));
    const blindState = (extra) => ({ points: 100, waiting: true, played: false, cut: false, tracks: tracks(["playing", "todo", "todo"]), ...extra });
    await box.set({ ...questionState(1), qid: "b1", kind: "blind", text: "Quel est ce titre ?", choices: null, total: 3, durationMs: 25000, deadline: null, round: "b1-1000-0", buzzOpen: false, buzz: { team: null, blocked: [] }, blind: blindState() });
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    const commands = async () => Object.values((await read("commands")) ?? {}).map((c) => c.type);
    // Le morceau s'annonce : la régie voit sa valeur, le titre attendu, et l'état des extraits de la playlist.
    await page.locator("#blind-head", { hasText: "Morceau 1 / 3 · 100 points" }).waitFor();
    await page.locator("#blind-info", { hasText: "Prêt : « Libérée, délivrée » de La Reine des neiges" }).waitFor();
    await page.locator("#c-next", { hasText: "Lancer le morceau" }).waitFor();
    assert.equal(await page.locator("#blind-tracks li").count(), 3);
    await page.locator("#blind-tracks li", { hasText: "Hakuna Matata" }).locator(".media", { hasText: "manquant" }).waitFor();
    await page.locator("#blind-tracks li", { hasText: "Un jour mon prince viendra" }).locator(".pts", { hasText: "200 pts ×2" }).waitFor();
    assert.equal(await page.locator("#flou").isVisible(), false, "l'ancien panneau des jeux au buzzer reste caché");
    await page.click("#c-next");
    await waitFor(async () => (await commands()).includes("next"), "« Lancer le morceau » envoyé");

    // Les Roses buzzent : verdict à la régie, le bouton principal attend.
    await box.set({ ...(await read("state")), buzz: { team: "rose", blocked: [] }, blind: blindState({ waiting: false, played: true }) });
    await page.locator("#blind-info", { hasText: "Les Roses a buzzé ! Réponse attendue : « Libérée, délivrée » de La Reine des neiges" }).waitFor();
    await page.locator("#blind-ok small", { hasText: "+100 pour Les Roses" }).waitFor();
    assert.equal(await page.locator("#c-next").isDisabled(), true);
    await page.click("#blind-ko");
    await waitFor(async () => (await commands()).includes("buzz_ko"), "mauvaise réponse envoyée");

    // Musique arrêtée après l'erreur : relancer (l'équipe ratée rebuzzera 3 s après, ou tout de suite), révéler ou passer.
    await box.set({ ...(await read("state")), buzz: { team: null, blocked: ["rose"] }, blind: blindState({ played: true }) });
    await page.locator("#blind-info", { hasText: "Pas trouvé (Les Roses). Relancez la musique : les autres buzzent tout de suite, Les Roses 3 s après." }).waitFor();
    await page.locator("#c-next", { hasText: "Relancer la musique" }).waitFor();
    // L'équipe ratée rebuzze 3 s après la reprise ; l'animatrice peut lever cette attente.
    await page.locator("#blind-unblock", { hasText: "Laisser rebuzzer tout de suite" }).click();
    await waitFor(async () => (await commands()).includes("blind_unblock"), "rebuzz immédiat envoyé");
    await page.click("#blind-skip");
    assert.match(await respond(page), /Passer ce morceau/);
    await waitFor(async () => (await commands()).includes("blind_skip"), "passer le morceau envoyé");

    // Révélation : qui a trouvé et combien, « Raccourcir », puis « Titre suivant ».
    await box.set({ ...(await read("state")), phase: "reveal", choices: ["Libérée, délivrée"], correct: 0, awards: { bleu: { correct: true, points: 100, bonus: 0 } }, buzz: { team: null, blocked: ["rose"] }, blind: blindState({ played: true, tracks: tracks(["found", "todo", "todo"], "bleu") }) });
    await page.locator("#blind-info", { hasText: "Les Bleus a trouvé « Libérée, délivrée » de La Reine des neiges : +100 points." }).waitFor();
    await page.locator("#blind-tracks li", { hasText: "Libérée, délivrée" }).locator(".status", { hasText: "Trouvé · Les Bleus" }).waitFor();
    await page.locator("#c-next", { hasText: "Titre suivant" }).waitFor();
    await page.click("#blind-cut");
    await waitFor(async () => (await commands()).includes("blind_cut"), "raccourcir envoyé");
    // Dernier morceau, à double valeur : le bouton mène au bilan.
    await box.set({ ...(await read("state")), qid: "b3", index: 2, blind: blindState({ points: 200, played: true, tracks: tracks(["found", "skipped", "revealed"], "bleu") }) });
    await page.locator("#blind-head", { hasText: "Morceau 3 / 3 · 200 points" }).locator(".double", { hasText: "POINTS DOUBLÉS" }).waitFor();
    await page.locator("#c-next", { hasText: "Bilan du blind test" }).waitFor();
    await page.context().close();
  });

  test("blind test sur une TV d'avant « Lancer le morceau » : la régie garde l'ancien panneau", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const plan = [{ id: "b1", text: "Quel est ce titre ?", choices: ["Libérée, délivrée"], correct: 0, duration: 25, kind: "blind", artist: "La Reine des neiges", audioId: "0123456789abcdef", round: "Blind test · Dessins animés" }];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, blind: true, questions: plan });
    await box.set({ ...questionState(1), qid: "b1", kind: "blind", text: plan[0].text, choices: null, total: 1, durationMs: 25000, round: "b1-1000-0", buzzOpen: true, buzz: { team: null, blocked: [] } });
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await page.locator("#flou-info", { hasText: "En attente d'un buzz" }).waitFor();
    assert.equal(await page.locator("#blind").isVisible(), false);
    await page.context().close();
  });

  test("statues musicales : un gros bouton par équipe désigne la gagnante", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    const plan = [{ id: "s1", text: "Statues musicales", duration: 60, kind: "statues", round: "Statues musicales" }];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, blind: true, statues: true, disparu: true, pictionary: true, portes: true, coffres: true, gonfleur: true, patate: true, questions: plan });
    await box.set({ ...questionState(1), qid: "s1", kind: "statues", text: plan[0].text, choices: null, total: 1, durationMs: 60000 });
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await page.locator("#statues-info", { hasText: "Musique en cours" }).waitFor();
    await page.locator("#statues-points", { hasText: "300 points pour l'équipe gagnante, 150 pour les autres" }).waitFor();
    assert.equal(await page.locator("#c-answered").textContent(), "");
    await page.locator(".statues-team", { hasText: "Les Bleus" }).click();
    await waitFor(async () => Object.values((await read("commands")) ?? {}).some((c) => c.type === "statues_win" && c.team === "bleu"), "gagnante envoyée");
    await page.context().close();
  });

  test("secours : jeu en cours et suivant, passer au suivant, recommencer un jeu après confirmation", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const plan = [
      { id: "q1", text: "Couleur du ciel ?", choices: ["Vert", "Bleu"], correct: 1, duration: 20, kind: "classic", round: "Quiz de Léa" },
      { id: "q2", text: "2 + 2 ?", choices: ["4", "5"], correct: 0, duration: 20, kind: "classic", round: "Quiz de Léa" },
      { id: "a1m", text: "Animaux", kind: "mime", duration: 60, round: "Animaux", cards: [{ word: "Chat", image: "🐱" }] },
      { id: "f1", text: "Finale ?", choices: ["A", "B"], correct: 0, duration: 10, kind: "classic", round: "Finale" },
    ];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, questions: plan });
    await box.set({ ...questionState(4), index: 1, qid: "q2", text: "2 + 2 ?", total: 4, scores: { rose: 100 } });
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await page.locator("#c-games", { hasText: "En cours : Quiz de Léa · Ensuite : Mimes : Animaux" }).waitFor();
    await page.click("#c-rescue");
    await page.locator("#rescue:not([hidden])").waitFor();
    await page.locator("#rescue-list .rescue-game.current", { hasText: "Quiz de Léa" }).locator("button", { hasText: "Recommencer" }).waitFor();
    await page.locator("#rescue-list .rescue-game", { hasText: "Finale" }).locator("button", { hasText: "Aller à ce jeu" }).waitFor();
    // Renoncer : rien n'est envoyé.
    await page.click("#rescue-next");
    await respond(page, false);
    await page.waitForTimeout(300);
    assert.equal(box.gotos.length, 0);
    // Passer au jeu suivant : les mimes s'ouvrent, les points restent.
    await page.locator("#rescue-next", { hasText: "Passer au jeu suivant : Mimes : Animaux" }).click();
    let asked = await respond(page);
    await page.locator("#r-toast", { hasText: "C'est parti pour « Mimes : Animaux » !" }).waitFor();
    assert.match(asked, /points déjà gagnés sont gardés/);
    assert.deepEqual(box.gotos, [{ index: 2, qid: "a1m" }]);
    await page.locator("#mime:not([hidden])").waitFor();
    await page.locator("#c-games", { hasText: "En cours : Mimes : Animaux · Ensuite : Finale" }).waitFor();
    // Recommencer le quiz (« Rejouer » avant le 21/10) : confirmation qui dit que ses points sont retirés puis rejoués.
    await page.click("#c-rescue");
    await page.locator("#rescue-list .rescue-game", { hasText: "Quiz de Léa" }).locator("button", { hasText: "Recommencer" }).click();
    asked = await respond(page);
    await page.locator("#r-toast", { hasText: "« Quiz de Léa » recommence." }).waitFor();
    assert.match(asked, /rien n'est compté deux fois/);
    assert.deepEqual(box.gotos[1], { index: 0, qid: "q1" });
    // Partie terminée par erreur pendant les mimes : la finale jamais jouée reste à venir, la partie peut reprendre.
    await box.set({ phase: "ended", index: 2, qid: "a1m", mime: null, seq: (await read("state")).seq + 1 });
    await page.locator("#c-next:not([hidden])", { hasText: "Jeu suivant : Finale" }).waitFor();
    await page.locator("#c-rescue:not([hidden])").click();
    await page.locator("#rescue-list .rescue-game", { hasText: "Finale" }).locator("button", { hasText: "Aller à ce jeu" }).click();
    assert.match(await respond(page), /La partie reprend avec ce jeu/);
    await page.locator("#r-toast", { hasText: "C'est parti pour « Finale » !" }).waitFor();
    assert.deepEqual(box.gotos[2], { index: 3, qid: "f1" });
    await page.context().close();
  });

  test("Pictionary : Sarah montre 3 mots, voit le choix du dessinateur, masque le mot puis valide ; 150 points", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    const cards = [{ word: "Chat", image: "🐱" }, { word: "Pirate", image: "🏴‍☠️" }, { word: "Pizza", image: "🍕" }, { word: "Robot", image: "🤖" }, { word: "Glace", image: "🍦" }];
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await box.picto(cards);
    await page.locator("#mime:not([hidden])").waitFor();
    await page.locator("#mime-info", { hasText: "Qui commence ?" }).waitFor();
    await page.locator("#c-next", { hasText: "Terminer le Pictionary" }).waitFor();
    await page.locator(".mime-team", { hasText: "Les Bleus" }).click();
    await page.locator("#mime-go", { hasText: "Montrer le mot à Les Bleus" }).click();
    await page.locator("#mime-info", { hasText: "Chat · Pirate · Pizza" }).waitFor();
    // Tant que le dessinateur n'a pas choisi, impossible de lancer le dessin ; Sarah peut proposer 3 autres mots.
    await page.locator("#mime-go[disabled]", { hasText: "Masquer le mot" }).waitFor();
    await page.click("#mime-pass");
    await page.locator("#mime-info", { hasText: "Robot · Glace · Chat" }).waitFor();
    // Le choix fait sur la tablette s'affiche sur la régie.
    await box.pictoChoose(1);
    await page.locator("#mime-info", { hasText: "a choisi son mot" }).waitFor();
    await page.locator("#mime-now .word", { hasText: "Glace" }).waitFor();
    await page.locator("#mime-go:not([disabled])", { hasText: "Masquer le mot : on dessine ! (Les Bleus)" }).click();
    await page.locator("#mime-info", { hasText: "Les Bleus dessine !" }).waitFor();
    await page.locator("#mime-found small", { hasText: "+150 points" }).waitFor();
    assert.equal(await page.locator("#mime-row").isHidden(), true, "ni « Passer » ni −1 pendant le dessin");
    await page.click("#mime-found");
    await page.locator("#mime-info", { hasText: "Tour terminé : Les Bleus a trouvé « Glace » !" }).waitFor();
    await page.locator("#mime-fix-plus", { hasText: "+150 pour Les Bleus" }).waitFor();
    await page.locator(".mime-team.selected", { hasText: "Les Roses" }).waitFor();
    assert.deepEqual((await commands()).map((c) => c.type), ["picto_show", "mime_pass", "picto_draw", "mime_found"]);
    assert.equal((await commands()).find((c) => c.type === "picto_show").team, "bleu");
    assert.equal((await read("state")).scores.bleu, 150);
    await page.context().close();
  });

  test("mimes en pause : les gros boutons sont figés jusqu'à la reprise", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await box.mimes([{ word: "Chat" }, { word: "Robot" }]);
    await page.locator("#mime-go", { hasText: "Les Roses" }).click();
    await page.locator("#mime-found:not([disabled])").waitFor();
    await page.click("#c-pause");
    await page.locator("#c-phase", { hasText: "En pause" }).waitFor();
    assert.equal(await page.locator("#mime-found").isDisabled(), true);
    assert.equal(await page.locator("#mime-pass").isDisabled(), true);
    await page.click("#c-pause");
    await page.locator("#mime-found:not([disabled])").waitFor();
    await page.context().close();
  });

  test("pupitre pendant les mimes : il dit qui joue, sans rien à toucher", async () => {
    box = startBox();
    const team = await openRegie();
    await team.fill("#team-name", "Les Roses");
    await team.click("#join");
    await team.locator("#screen-play.active").waitFor();
    const rose = Object.keys(await read("teams"))[0];
    await box.mimes([{ word: "Chat" }, { word: "Robot" }]);
    await team.locator("#play-status", { hasText: "L'animatrice choisit l'équipe qui joue" }).waitFor();
    assert.equal(await team.locator("#buzz").isHidden(), true);
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#mime-go", { hasText: "Les Roses" }).click();
    await team.locator("#play-status", { hasText: "C'est votre tour !" }).waitFor();
    assert.equal(await team.locator("body").innerText().then((t) => t.includes("Chat")), false, "Le mot n'apparaît jamais sur le pupitre");
    await regie.click("#mime-found");
    await regie.click("#c-next");
    await regie.locator("#mime-info", { hasText: "Tour terminé" }).waitFor();
    await regie.click("#c-next");
    await team.locator("#r-title", { hasText: "Bravo ! 1 mime trouvé" }).waitFor();
    await team.locator("#r-detail", { hasText: "+50 points" }).waitFor();
    assert.ok(rose);
    for (const p of [team, regie]) await p.context().close();
  });

  test("lancer le quiz, voir la question et sa réponse, arrêter le chrono", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await page.locator("#c-next", { hasText: "En attente des équipes" }).waitFor();
    assert.equal(await page.locator("#c-next").isDisabled(), true);

    await addTeam("rose", "Les Roses");
    await page.locator("#c-next", { hasText: "Lancer la fête !" }).click();
    await page.locator("#c-question", { hasText: "Couleur du ciel ?" }).waitFor();
    await page.locator("#c-answer", { hasText: "Réponse B · Bleu" }).waitFor();
    assert.deepEqual((await commands()).map((c) => [c.type, c.expectSeq]), [["next", 0]]);

    // La bonne réponse se masque d'un toucher, pour qu'aucun enfant ne la lise.
    await page.click("#c-answer");
    await page.locator("#c-answer", { hasText: "masquée" }).waitFor();

    await page.locator("#c-next", { hasText: "Arrêter le chrono" }).click();
    await page.locator("#c-phase", { hasText: "Temps écoulé" }).waitFor();
    assert.deepEqual((await commands()).map((c) => c.type).sort(), ["close", "next"]);
    await page.context().close();
  });

  test("pause générale : la régie fige la partie puis la relance avec le décompte 3, 2, 1", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await setPresence("rose", true);
    const page = await openRegie();
    await pair(page);
    await page.locator("#c-next", { hasText: "Lancer la fête !" }).click();
    await page.locator("#c-question", { hasText: "Couleur du ciel ?" }).waitFor();

    await page.locator("#c-pause", { hasText: "Pause" }).click();
    await page.locator("#c-phase", { hasText: "En pause" }).waitFor();
    await page.locator("#c-hold", { hasText: "chrono, réponses et scores sont figés" }).waitFor();
    await page.locator("#c-hold", { hasText: "Toutes les équipes sont connectées" }).waitFor();
    assert.equal(await page.locator("#c-next").isDisabled(), true, "Suivant bloqué pendant la pause");
    assert.equal(await page.textContent("#c-timer"), "⏱ 15 s", "Chrono figé");

    await page.locator("#c-pause", { hasText: "Reprendre (3, 2, 1)" }).click();
    await page.locator("#c-hold").waitFor({ state: "hidden" });
    await page.locator("#c-pause", { hasText: "Pause" }).waitFor();
    // Pendant le décompte 3, 2, 1, « Arrêter le chrono » attend : un appui réflexe ne ferme pas la question.
    assert.equal(await page.locator("#c-next").isDisabled(), true, "Arrêt du chrono bloqué pendant le décompte");
    await page.locator("#c-next:not([disabled])", { hasText: "Arrêter le chrono" }).waitFor({ timeout: 5000 });
    assert.deepEqual((await commands()).map((c) => c.type).sort(), ["next", "pause", "resume"]);
    await page.context().close();
  });

  test("pause automatique : la régie nomme l'équipe déconnectée puis la voit revenir", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    await setPresence("rose", true);
    await setPresence("bleu", false);
    await update(gameRef(), { state: { ...questionState(4), paused: true, pauseReason: "team", pauseTeam: "bleu", deadline: null, remainingMs: 12000 } });
    const page = await openRegie();
    await pair(page);
    await page.locator("#c-hold", { hasText: "« Les Bleus » a perdu la connexion" }).waitFor();
    await page.locator("#c-hold", { hasText: "Pas encore prête : Les Bleus" }).waitFor();
    await setPresence("bleu", true);
    await page.locator("#c-hold", { hasText: "elle est revenue" }).waitFor();
    await page.locator("#c-hold", { hasText: "vous pouvez reprendre" }).waitFor();
    // La reprise reste le choix de l'animatrice : rien n'est envoyé tout seul.
    assert.equal((await commands()).length, 0);
    assert.equal(await page.locator("#c-pause").isDisabled(), false);
    await page.context().close();
  });

  test("tablette déconnectée (cedric, 21/10) : bandeau rouge en haut de la régie dans tous les jeux, vert à son retour, masquable", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    await setPresence("rose", true);
    await setPresence("bleu", true);
    // Blind test en cours, sans pause : rien ne prévenait Sarah avant.
    await update(gameRef(), { state: { ...questionState(4), kind: "blind" } });
    const page = await openRegie();
    await pair(page);
    const alerte = page.locator("#r-alerte");
    assert.equal(await alerte.isHidden(), true);
    await setPresence("bleu", false);
    // Une micro-coupure (moins de 4 s) ne dit rien ; au-delà, le bandeau nomme l'équipe.
    await page.waitForTimeout(2000);
    assert.equal(await alerte.isHidden(), true, "pas d'alerte avant 4 s");
    await page.locator("#r-alerte:not(.revenue)", { hasText: "📵 Tablette déconnectée : Les Bleus" }).waitFor({ timeout: 6000 });
    // Le bas de la régie (Pause, Tablette, Terminer, gros bouton) reste dans l'écran sous le bandeau (audit du 21/10 :
    // il sortait de l'écran de la hauteur du bandeau, « Reprendre » caché pendant une pause).
    const basDansEcran = async (quand) => {
      const bas = await page.locator(".control .actions").boundingBox();
      assert.ok(bas && bas.y + bas.height <= 844 + 1, `${quand} : bas de la régie hors de l'écran ${JSON.stringify(bas)}`);
    };
    await basDansEcran("bandeau rouge");
    await update(gameRef(), { state: { ...questionState(4), kind: "blind", paused: true, pauseReason: "team", pauseTeam: "bleu", deadline: null, remainingMs: 12000 } });
    await page.getByRole("button", { name: /Reprendre/ }).first().waitFor();
    await basDansEcran("pause automatique avec le bandeau");
    assert.ok(await page.getByRole("button", { name: /Reprendre/ }).first().isVisible());
    await update(gameRef(), { state: { ...questionState(4), kind: "blind" } });
    // Il reste en haut de l'écran même quand Sarah descend dans la page.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const haut = await alerte.boundingBox();
    assert.ok(haut && haut.y >= -1 && haut.y < 40, `bandeau visible en haut : ${JSON.stringify(haut)}`);
    await setPresence("bleu", true);
    await page.locator("#r-alerte.revenue", { hasText: "✓ Tablette revenue : Les Bleus" }).waitFor();
    await alerte.waitFor({ state: "hidden", timeout: 6000 });
    // Deux équipes coupées : les deux noms ; un toucher masque le bandeau (une équipe partie pour de bon).
    await setPresence("bleu", false);
    await setPresence("rose", false);
    await page.locator("#r-alerte", { hasText: "📵 Tablettes déconnectées : Les Roses, Les Bleus" }).waitFor({ timeout: 8000 });
    await alerte.click();
    await alerte.waitFor({ state: "hidden" });
    // Fête finie : plus d'alerte.
    await update(gameRef(), { state: { ...questionState(4), phase: "ended" } });
    await setPresence("rose", true);
    await page.waitForTimeout(500);
    await setPresence("rose", false);
    await page.waitForTimeout(5000);
    assert.equal(await alerte.isHidden(), true, "pas d'alerte une fois la fête finie");
    await page.context().close();
  });

  test("pause automatique de la box sans Internet : la régie le dit et laisse la reprise à l'animatrice", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await setPresence("rose", true);
    await update(gameRef(), { state: { ...questionState(4), paused: true, pauseReason: "network", deadline: null, remainingMs: 12000 } });
    const page = await openRegie();
    await pair(page);
    await page.locator("#c-hold", { hasText: "la box avait perdu Internet" }).waitFor();
    await page.locator("#c-hold", { hasText: "vous pouvez reprendre" }).waitFor();
    assert.equal((await commands()).length, 0);
    await page.locator("#c-pause", { hasText: "Reprendre (3, 2, 1)" }).waitFor();
    await page.context().close();
  });

  test("la pause est possible pendant le classement, pas dans le salon d'attente", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    assert.equal(await page.locator("#c-pause").isDisabled(), true, "Salon d'attente");
    await update(gameRef(), { state: { ...questionState(4), phase: "scores", deadline: null } });
    await waitFor(async () => !(await page.locator("#c-pause").isDisabled()), "pause possible au classement");
    await page.context().close();
  });

  test("un double appui sur Suivant n'envoie qu'une commande", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const page = await openRegie();
    await pair(page);
    await page.locator("#c-next", { hasText: "Lancer la fête !" }).waitFor();
    await page.locator("#c-next").dblclick();
    await page.locator("#c-question", { hasText: "Couleur du ciel ?" }).waitFor();
    assert.equal((await commands()).length, 1);
    assert.equal(box.state.seq, 1);
    await page.context().close();
  });

  test("deux téléphones appuient en même temps : la partie n'avance que d'une étape", async () => {
    // La box est occupée : les deux commandes arrivent avant qu'elle ait répondu à la première.
    box = startBox({ held: true });
    await addTeam("rose", "Les Roses");
    const a = await openRegie();
    await pair(a);
    const b = await openRegie();
    await pair(b);
    await a.locator("#c-next", { hasText: "Lancer la fête !" }).waitFor();
    await b.locator("#c-next", { hasText: "Lancer la fête !" }).waitFor();
    await Promise.all([a.click("#c-next"), b.click("#c-next")]);
    await waitFor(async () => (await commands()).length === 2, "deux commandes reçues");
    await box.release();
    await waitFor(async () => Object.values((await read("commandStatus")) ?? {}).length === 2, "deux réponses de la box");
    const statuses = Object.values(await read("commandStatus")).map((s) => s.status).sort();
    assert.deepEqual(statuses, ["applied", "stale"]);
    assert.equal(box.state.seq, 1);
    await a.context().close();
    await b.context().close();
  });

  test("corriger un score puis annuler la correction", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    // Dans le salon d'attente la régie s'ouvre sur les prestations : l'animatrice passe aux équipes.
    await page.click("#tab-teams");
    await givePoints(page, "rose", 10);
    await page.locator(".team .score", { hasText: "10" }).waitFor();
    await page.locator("#undo-text", { hasText: "+10 pour Les Roses" }).waitFor();
    await page.click("#undo-go");
    await waitFor(async () => (await commands()).some((c) => c.type === "undo" && c.target === 1), "annulation envoyée");
    const adjust = (await commands()).find((c) => c.type === "adjust");
    assert.equal(adjust.team, "rose");
    assert.equal(adjust.delta, 10);
    await page.context().close();
  });

  test("« ± Points » reste accessible pendant les mimes (onglets masqués) : choix de l'équipe dans la fenêtre", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    const plan = [{ id: "a1m", text: "Animaux", kind: "mime", duration: 60, round: "Animaux", cards: [{ word: "Chat", image: "🐱" }] }];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, questions: plan });
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await page.click("#tab-teams");
    // Hors mimes et blind test, « ± Points » passe par l'onglet Équipes : pas de bouton en double.
    assert.equal(await page.locator("#c-points").isVisible(), false);
    await box.set({ ...questionState(2), index: 0, qid: "a1m", kind: "mime", text: "Animaux", choices: null, total: 1, deadline: null, mime: { team: "rose", card: { word: "Chat", image: "🐱" }, found: 0, passed: 0, left: 1, turns: ["rose"], counts: {}, points: 50 } });
    await page.locator("#mime:not([hidden])").waitFor();
    assert.equal(await page.locator(".tabs").isVisible(), false);
    await page.click("#c-points");
    // L'équipe qui mime est proposée d'abord ; l'animatrice choisit une autre équipe, le montant reste.
    await page.locator("#pts-teams button.on", { hasText: "Les Roses" }).waitFor();
    await page.click('#pts [data-set="50"]');
    await page.click('#pts-teams button[data-team="bleu"]');
    await page.locator("#pts-teams button.on", { hasText: "Les Bleus" }).waitFor();
    await page.locator("#pts-ok", { hasText: "Valider +50 points" }).click();
    await page.locator("#undo-text", { hasText: "+50 pour Les Bleus" }).waitFor();
    const adjust = (await commands()).filter((c) => c.type === "adjust");
    assert.deepEqual(adjust.map((c) => [c.team, c.delta]), [["bleu", 50]]);
    await page.context().close();
  });

  test("bonus et malus en deux temps : préparer ne change rien, une validation = un seul envoi du montant exact", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await page.click("#tab-teams");
    await page.locator('.team[data-team="rose"] .pts-open').click();
    await page.locator("#pts-title", { hasText: "Points pour Les Roses" }).waitFor();
    assert.equal(await page.locator("#pts-ok").isDisabled(), true, "rien à valider tant qu'aucun montant n'est choisi");
    // L'animatrice hésite : montants types, ±10, ±1, saisie, curseur… rien ne part vers la TV.
    await page.click('#pts [data-set="100"]');
    await page.click('#pts [data-step="10"]');
    await page.click('#pts [data-step="10"]');
    await page.click('#pts [data-step="-1"]');
    await page.locator("#pts-value", { hasText: "+119" }).waitFor();
    await page.locator("#pts-input").fill("520");
    await page.locator("#pts-value", { hasText: "+500" }).waitFor();
    await page.locator("#pts-range").fill("200");
    await page.locator("#pts-value", { hasText: "+200" }).waitFor();
    await page.click('#pts [data-set="150"]');
    await page.locator("#pts-preview", { hasText: "Score : 0 → 150" }).waitFor();
    await page.locator("#pts-ok", { hasText: "Valider +150 points" }).waitFor();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await commands()).length, 0, "préparer n'envoie rien");
    // Double appui sur « Valider » : une seule correction.
    await page.locator("#pts-ok").dblclick();
    await page.locator("#undo-text", { hasText: "+150 pour Les Roses" }).waitFor();
    await page.locator('.team[data-team="rose"] .score', { hasText: "150" }).waitFor();
    assert.equal(await page.locator("#pts").isHidden(), true);
    // Malus : on bascule le signe, on valide.
    await page.locator('.team[data-team="rose"] .pts-open').click();
    await page.locator("#pts-value", { hasText: "+0" }).waitFor();
    await page.click("#pts-malus");
    await page.click('#pts [data-set="50"]');
    await page.locator("#pts-ok", { hasText: "Valider −50 points" }).click();
    await page.locator("#undo-text", { hasText: "−50 pour Les Roses" }).waitFor();
    // Annuler sans valider : rien n'est envoyé.
    await page.locator('.team[data-team="rose"] .pts-open').click();
    await page.click('#pts [data-set="300"]');
    await page.click("#pts-cancel");
    await page.locator('.team[data-team="rose"] .score', { hasText: "100" }).waitFor();
    await new Promise((r) => setTimeout(r, 300));
    const deltas = (await commands()).filter((c) => c.type === "adjust").map((c) => c.delta);
    assert.deepEqual(deltas, [150, -50]);
    assert.equal(box.state.scores.rose, 100);
    await page.context().close();
  });

  test("quiz de démonstration : la régie le dit, demande confirmation avant de le lancer et l'affiche comme un seul jeu", async () => {
    box = startBox();
    await set(gameRef("conducteur"), { ...(await read("conducteur")), id: "demo", title: "Quiz de démonstration" });
    await addTeam("rose", "Les Roses");
    const page = await openRegie();
    await pair(page);
    await page.locator("#c-demo", { hasText: "Aucune prestation chargée" }).waitFor();
    // « Lancer la fête ! » sans prestation : confirmation ; « Annuler » ouvre l'onglet Prestation sans rien lancer.
    await page.locator("#c-next", { hasText: "Lancer la fête !" }).click();
    await page.locator("#ask-title", { hasText: "Aucune prestation chargée" }).waitFor();
    await page.click("#ask-cancel");
    await page.locator("#panel-show:not([hidden])").waitFor();
    assert.equal((await read("state")).phase, "lobby");
    await page.locator("#c-next", { hasText: "Lancer la fête !" }).click();
    await page.click("#ask-ok");
    await page.locator("#c-demo", { hasText: "Terminer et lancer une nouvelle partie" }).waitFor();
    // Les questions sans manche forment un seul jeu, et les points ×2 ne sont jamais présentés comme un jeu.
    await page.click("#c-rescue");
    assert.equal(await page.locator("#rescue-list .rescue-game").count(), 1);
    const text = await page.locator("#rescue-list").textContent();
    assert.ok(!text.includes("Super Finale"), text);
    await page.context().close();
  });

  test("le conducteur liste les questions avec leur réponse", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await page.click("#tab-plan");
    await page.locator(".plan-item", { hasText: "Le soleil est une étoile" }).locator("b", { hasText: "A · Vrai" }).waitFor();
    await page.context().close();
  });

  test("juste avant les dernières questions du quiz, l'animatrice choisit ×2, ×3 ou ×5", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    assert.equal(await page.locator("#c-factor").isHidden(), true);
    await box.set({ ...questionState(1), phase: "scores", factorChoice: { start: 1, factor: 2 } });
    await page.locator("#c-factor:not([hidden])", { hasText: "combien de points" }).waitFor();
    await page.locator("#c-factor [data-factor='2'].on").waitFor();
    await page.click("#c-factor [data-factor='3']");
    await waitFor(async () => (await commands()).find((c) => c.type === "factor" && c.factor === 3), "commande ×3");
    await page.locator("#c-factor [data-factor='3'].on").waitFor();
    // Question multipliée lancée : plus de choix, la régie affiche la valeur.
    await box.set({ ...questionState(box.state.seq + 1, 1), double: true, factor: 3, factorChoice: null, game: { label: "Quiz · question 2 / 2" } });
    await page.locator("#c-step", { hasText: "Quiz · question 2 / 2 · ×3" }).waitFor();
    assert.equal(await page.locator("#c-factor").isHidden(), true);
    await page.context().close();
  });

  test("Portes mystères : l'animatrice change ce qu'il y a derrière une porte avant l'ouverture, sans chrono", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    const plan = (await read("conducteur")) ?? { questions: [] };
    const portes = { id: "p1", text: "Portes mystères", kind: "portes", choices: ["Porte 1", "Porte 2", "Porte 3"], correct: -1, doors: [300, -150, 50], round: "Portes mystères" };
    await set(gameRef("conducteur"), { ...plan, portesSet: true, questions: [...plan.questions, portes] });
    await box.set({ ...questionState(box.state.seq + 1, 0), index: 2, qid: "p1", kind: "portes", text: "Portes mystères", choices: portes.choices, deadline: null, total: 3 });
    await page.locator("#c-doors:not([hidden])").waitFor();
    // Replié : les enfants qui regardent le téléphone ne voient pas les valeurs.
    assert.equal(await page.locator("#c-doors-list select").first().isVisible(), false);
    await page.click("#c-doors summary");
    assert.equal(await page.locator("#c-doors-list select").count(), 3);
    assert.equal(await page.locator("#c-doors-list select").nth(1).inputValue(), "-150");
    await page.locator("#c-doors-list select").nth(1).selectOption("200");
    await waitFor(async () => (await commands()).find((c) => c.type === "portes_set" && c.qid === "p1" && c.door === 1 && c.value === 200), "commande portes_set");
    // La box publie la nouvelle valeur : la régie l'affiche.
    await set(gameRef("conducteur/doorValues/p1"), [300, 200, 50]);
    await page.locator("#c-answer", { hasText: "2 : +200" }).waitFor();
    // Pas de chrono pour les portes.
    assert.equal(await page.locator("#c-timer").isVisible(), false);
    // Portes ouvertes : plus de changement possible.
    await box.set({ ...box.state, seq: box.state.seq + 1, phase: "reveal", portes: { count: 3, order: [0, 1, 2], opened: 0, values: {} } });
    await page.locator("#c-doors[hidden]").waitFor({ state: "attached" });
    await page.context().close();
  });

  test("Les coffres mystères : la régie suit les coffres sans jamais voir leur contenu, et ouvre un coffre au hasard en secours", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    const plan = (await read("conducteur")) ?? { questions: [] };
    const bombe = { id: "b1", text: "Les Coffres mystères", kind: "coffres", choices: [], correct: -1, round: "Les Coffres mystères" };
    await set(gameRef("conducteur"), { ...plan, coffres: true, questions: [...plan.questions, bombe] });
    const chests = { ready: true, count: 10, order: ["bleu", "rose"], team: "bleu", turn: 0, safe: 6, safeLeft: 6, danger: false, exploded: false, key: "b1-1-0", readyAt: Date.now() + 2500, opened: [], gains: { bleu: 0, rose: 0 } };
    await box.set({ ...questionState(box.state.seq + 1, 0), index: 2, qid: "b1", kind: "coffres", text: "Les Coffres mystères", choices: null, deadline: null, total: 3, chests });
    await page.locator("#coffres-info", { hasText: "Au tour de l'équipe Les Bleus" }).waitFor();
    await page.locator("#coffres-info", { hasText: "Encore 6 coffres sans danger" }).waitFor();
    // Le bouton principal n'ouvre jamais de coffre : ce sont les équipes qui jouent.
    await page.locator("#c-next", { hasText: "Coffres en cours" }).waitFor();
    assert.equal(await page.locator("#c-next").isDisabled(), true);
    assert.equal(await page.locator("#c-answer").isVisible(), false, "aucun contenu à montrer : il est tiré à l'ouverture");
    assert.equal(await page.locator("#c-timer").isVisible(), false, "pas de chrono");
    // Secours : désactivé pendant l'animation de la TV, puis deux appuis pour ouvrir au hasard.
    assert.equal(await page.locator("#coffres-random").isDisabled(), true);
    await waitFor(() => page.locator("#coffres-random").isEnabled(), "secours prêt après l'animation", 6000);
    await page.click("#coffres-random");
    await page.locator("#coffres-random", { hasText: "Touchez encore" }).waitFor();
    assert.equal((await commands()).filter((c) => c.type === "chest_random").length, 0, "un seul appui n'ouvre rien");
    await page.click("#coffres-random");
    await waitFor(async () => (await commands()).filter((c) => c.type === "chest_random").length === 1, "coffre au hasard envoyé");
    // Coffres ouverts : la régie résume ce qui est sorti.
    const opened = [{ team: "bleu", chest: 4, delta: 150, bomb: false, at: Date.now() }];
    await box.set({ ...box.state, seq: box.state.seq + 1, chests: { ...chests, team: "rose", turn: 1, safeLeft: 5, key: "b1-1-1", opened } });
    await page.locator("#coffres-opened", { hasText: "Les Bleus : coffre 5 +150" }).waitFor();
    // La bombe arrive, cachée avec le coffre en or ; puis les Roses trouvent le coffre en or.
    await box.set({ ...box.state, seq: box.state.seq + 1, chests: { ...chests, team: "bleu", turn: 6, safeLeft: 0, danger: true, goldLeft: true, key: "b1-1-6", opened } });
    await page.locator("#coffres-info", { hasText: "La bombe est cachée dans un des coffres ! ⭐ Le coffre en or (+500) aussi." }).waitFor();
    const or = { team: "rose", chest: 8, delta: 500, bomb: false, gold: true, at: Date.now() };
    await box.set({ ...box.state, seq: box.state.seq + 1, chests: { ...chests, team: "bleu", turn: 7, safeLeft: 0, danger: true, goldLeft: false, key: "b1-1-7", opened: [...opened, or] } });
    await page.locator("#coffres-opened", { hasText: "Les Roses : coffre 9 ⭐ +500" }).waitFor();
    assert.equal(await page.locator("#coffres-info", { hasText: "coffre en or" }).count(), 0, "le coffre en or est trouvé");
    // La bombe : jeu fini, le bouton principal mène au classement.
    await box.set({ ...box.state, seq: box.state.seq + 1, phase: "reveal", chests: { ...chests, team: null, key: null, exploded: true, opened: [...opened, { team: "rose", chest: 1, delta: -300, bomb: true, at: Date.now() }] } });
    await page.locator("#coffres[hidden]").waitFor({ state: "attached" });
    await page.locator("#c-next", { hasText: "Voir les scores" }).waitFor();
    await page.context().close();
  });

  test("Le Gonfleur fou : la régie suit la course ballon par ballon et peut l'arrêter", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    const plan = (await read("conducteur")) ?? { questions: [] };
    const ballon = { id: "g1", text: "Le Gonfleur fou", kind: "gonfleur", choices: [], correct: -1, round: "Le Gonfleur fou" };
    await set(gameRef("conducteur"), { ...plan, gonfleur: true, questions: [...plan.questions, ballon] });
    const goAt = Date.now() - 2000;
    await box.set({ ...questionState(box.state.seq + 1, 0), index: 2, qid: "g1", kind: "gonfleur", text: "Le Gonfleur fou", choices: null, total: 3, resumeAt: goAt, pump: { key: "g1-1", goAt, target: 100 } });
    await page.locator("#gonfleur-info", { hasText: "le premier ballon qui éclate gagne" }).waitFor();
    assert.equal(await page.locator("#c-answer").isVisible(), false, "rien à révéler");
    // Les tapes des tablettes arrivent : la régie montre où en est chaque ballon.
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/pumps/g1-1`), { rose: { n: 40, at: Date.now() }, bleu: { n: 75, at: Date.now() } }));
    await page.locator(".gonfleur-team", { hasText: "Les Bleus" }).locator("b", { hasText: "75 %" }).waitFor();
    await page.locator(".gonfleur-team", { hasText: "Les Roses" }).locator("b", { hasText: "40 %" }).waitFor();
    // Le bouton principal arrête la course : la box donnera la victoire au plus gros ballon.
    await page.locator("#c-next", { hasText: "Arrêter la course" }).click();
    await waitFor(async () => (await commands()).some((c) => c.type === "close"), "arrêt envoyé à la box");
    await box.set({ ...box.state, seq: box.state.seq + 1, phase: "reveal", awards: { bleu: { correct: true, points: 300, bonus: 0 }, rose: { correct: false, points: 150, bonus: 0 } } });
    await page.locator("#gonfleur[hidden]").waitFor({ state: "attached" });
    await page.locator("#c-next", { hasText: "Voir les scores" }).waitFor();
    await page.context().close();
  });

  test("« Ça va exploser ! » : la régie voit chez qui est la bombe et peut l'envoyer au hasard en deux appuis", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    const plan = (await read("conducteur")) ?? { questions: [] };
    const bombe = { id: "p1", text: "Ça va exploser !", kind: "patate", choices: [], correct: -1, round: "Ça va exploser !" };
    await set(gameRef("conducteur"), { ...plan, patate: true, questions: [...plan.questions, bombe] });
    const now = Date.now();
    const potato = { lit: true, holder: "rose", from: null, since: now - 3000, readyAt: now - 1000, canReturn: true, targets: ["bleu"], teams: ["rose", "bleu"], hit: ["rose"], passes: 0, key: "p1-1" };
    await box.set({ ...questionState(box.state.seq + 1, 0), index: 2, qid: "p1", kind: "patate", text: "Ça va exploser !", choices: null, deadline: null, total: 3, potato });
    await page.locator("#patate-info", { hasText: "La bombe est chez Les Roses" }).waitFor();
    await page.locator("#patate-info", { hasText: "Pas encore touchées : Les Bleus" }).waitFor();
    assert.equal(await page.locator("#c-next").isDisabled(), true, "la mèche décide de la fin, pas la régie");
    assert.equal(await page.locator("#c-answer").isVisible(), false, "rien à révéler");
    // Tablette en panne : premier appui pour armer, second pour envoyer.
    await page.locator("#patate-random", { hasText: "Envoyer la bombe au hasard pour Les Roses" }).click();
    await page.locator("#patate-random", { hasText: "Touchez encore" }).click();
    await waitFor(async () => (await commands()).some((c) => c.type === "potato_random"), "envoi au hasard demandé à la box");
    // Trois bombes : la première explose chez les Roses, le secours attend la bombe suivante.
    const boom = { holder: "rose", at: Date.now(), lost: 100, gain: 100 };
    await box.set({ ...box.state, seq: box.state.seq + 1, potato: { ...potato, bomb: 1, bombs: 3, exploded: true, key: null, booms: [boom] } });
    await page.locator("#patate-info", { hasText: "BOUM chez Les Roses ! La bombe 2 s'allume…" }).waitFor();
    assert.equal(await page.locator("#patate-random").isDisabled(), true, "rien à envoyer entre deux bombes");
    const go = Date.now() - 3000;
    await box.set({ ...box.state, seq: box.state.seq + 1, potato: { ...potato, holder: "bleu", targets: ["rose"], hit: ["bleu"], since: go, readyAt: go + 2000, bomb: 2, bombs: 3, exploded: false, key: "p1-2", booms: [boom] } });
    await page.locator("#patate-info", { hasText: "Bombe 2 sur 3. 💣 La bombe est chez Les Bleus" }).waitFor();
    await page.locator("#patate-info", { hasText: "Déjà explosées chez : Les Roses." }).waitFor();
    await waitFor(() => page.locator("#patate-random").isEnabled(), "secours prêt pour la bombe 2", 6000);
    await box.set({ ...box.state, seq: box.state.seq + 1, phase: "reveal", awards: { rose: { correct: false, points: -100, bonus: 0 }, bleu: { correct: true, points: 100, bonus: 0 } } });
    await page.locator("#patate[hidden]").waitFor({ state: "attached" });
    await page.locator("#c-next", { hasText: "Voir les scores" }).waitFor();
    await page.context().close();
  });

  test("présentation d'un jeu : la régie propose « ▶ Lancer l'épreuve » et c'est elle qui lance le jeu", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    const { text, choices, ...ouverte } = questionState(box.state.seq + 1, 0);
    await box.set({ ...ouverte, phase: "intro", deadline: null, game: { title: "Image floue", n: 1, of: 3, label: "Image floue · 1 / 3" } });
    await page.locator("#c-next", { hasText: "▶ Lancer l'épreuve" }).waitFor();
    assert.equal(await page.textContent("#c-step"), "Image floue");
    assert.match(await page.textContent("#c-question"), /Expliquez les règles, puis lancez l'épreuve/);
    assert.equal(await page.locator("#c-answer").isVisible(), false, "pas de réponse affichée pendant la présentation");
    assert.equal(await page.textContent("#c-phase"), "Présentation du jeu");
    await page.click("#c-next");
    await waitFor(async () => (await commands()).some((c) => c.type === "next"), "lancement envoyé");
    assert.equal((await commands()).filter((c) => c.type === "close").length, 0, "jamais « Arrêter le chrono » pendant la présentation");
    await page.context().close();
  });

  test("terminer la partie exige un appui long", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await page.click("#c-end");
    await page.locator("#r-toast", { hasText: "Gardez le doigt appuyé" }).waitFor();
    assert.equal((await commands()).length, 0);
    const btn = page.locator("#c-end");
    const boxRect = await btn.boundingBox();
    await page.mouse.move(boxRect.x + 10, boxRect.y + 10);
    await page.mouse.down();
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await page.locator("#c-phase", { hasText: "Partie terminée" }).waitFor();
    assert.deepEqual((await commands()).map((c) => c.type), ["end"]);
    await page.context().close();
  });

  test("après un rechargement, le téléphone reste relié sans ressaisir le code", async () => {
    box = startBox();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await openRegie(context);
    await pair(page);
    await inRegie(page);
    await page.reload();
    await inRegie(page);
    assert.equal(await page.textContent("#c-code"), CODE);
    await context.close();
  });

  test("une régie retirée par la TV revient à l'écran d'appairage", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    const [uid] = Object.keys(await read("regie"));
    await update(gameRef(), { [`regie/${uid}`]: null });
    await page.locator("#error-text", { hasText: "n'est plus relié" }).waitFor();
    await page.context().close();
  });

  test("si la box ne répond pas, la régie le dit sans rester bloquée", async () => {
    box = startBox({ silent: true });
    await addTeam("rose", "Les Roses");
    const page = await openRegie();
    await pair(page);
    await page.locator("#c-next", { hasText: "Lancer la fête !" }).click();
    await page.locator("#r-toast", { hasText: "La TV ne répond pas" }).waitFor({ timeout: 10000 });
    assert.equal(await page.locator("#c-next").isDisabled(), false);
    await page.context().close();
  });
});

describe("changer de box (box en panne)", () => {
  const NEW = "NEUVB";
  const SECOURS = "secours";
  const LOBBY = { phase: "lobby", seq: 0, round: 1, buzzOpen: true };
  /** Box de secours allumée sur « Nouvelle partie » : son salon d'attente, vide (ou déjà pris par une autre fête). */
  const salon = (state = LOBBY, extra = {}) =>
    env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${NEW}`), {
      hostUid: SECOURS, state, public: { title: "Quiz", changeBox: true }, ...extra,
    }));
  const lireComme = async (uid, path) => (await get(ref(env.authenticatedContext(uid).database(), path))).val();
  async function essayer(page, saisie, message) {
    await page.fill("#box-code", saisie);
    await page.click("#box-go");
    await page.locator("#box-status", { hasText: message }).waitFor();
  }

  test("la TV ne répond plus : « 📺 Changer de box », code du salon de secours, la fête continue avec ses équipes et ses points", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    const [tel] = Object.keys(await read("regie"));
    await page.locator("#c-next", { hasText: "Lancer la fête !" }).click();
    await page.locator("#c-phase", { hasText: "Question en cours" }).waitFor();
    await page.click("#tab-teams");
    await givePoints(page, "rose", 100);
    await page.locator('#panel-teams [data-team="rose"] .score', { hasText: "100" }).waitFor();
    // Panne : la box ne répond plus. La régie le dit en haut de l'écran et propose de changer de box.
    box.stop();
    assert.equal(await page.locator("#r-tv").isHidden(), true);
    await page.click("#c-pause");
    const alerte = page.locator("#r-tv", { hasText: "La TV ne répond pas" });
    await alerte.waitFor({ timeout: 10000 });
    await capture(page, "changer-de-box-alerte");
    await alerte.getByRole("button", { name: "📺 Changer de box" }).click();
    await page.locator("#box:not([hidden])", { hasText: "« Nouvelle partie »" }).waitFor();
    // Codes faux : rien n'est écrit, un message clair.
    await essayer(page, "ZZZZZ", "Code inconnu");
    await essayer(page, CODE, "C'est le code de cette fête");
    await essayer(page, "KX7P", "pas encore acceptée");
    await essayer(page, "AB", "code à 5 caractères");
    // Box de secours qui n'est pas sur son salon d'attente (une partie y est déjà lancée).
    await salon({ ...LOBBY, phase: "question", seq: 3 });
    await essayer(page, NEW, "pas sur son écran d'accueil");
    // Salon d'attente, mais box jamais acceptée dans la Régie PC (verrou en place).
    await salon();
    await essayer(page, NEW, "Cette box n'est pas acceptée");
    await allowBox(env, SECOURS);
    // Box restée sur une ancienne version de l'appli : elle n'écouterait pas, la fête resterait sans box.
    await salon(LOBBY, { public: { title: "Quiz" } });
    await essayer(page, NEW, "Cette box n'a pas la dernière version de l'appli");
    // Jamais la box d'une autre fête : une autre animatrice y est reliée (refus des règles), ou une prestation y est
    // chargée (ici depuis ce téléphone, relié aussi à la box de secours).
    await salon(LOBBY, { regie: { autre: { pairedAt: 1, via: "password" } } });
    await essayer(page, NEW, "Cette box est déjà utilisée pour une autre fête. Vérifiez le code affiché sur la TV de secours.");
    await salon(LOBBY, {
      regie: { [tel]: { pairedAt: 1, via: "password" } },
      show: { id: "s1", title: "Anniversaire de Léa", quiz: { questions: [{ text: "?" }] }, by: tel, at: 1 },
    });
    await essayer(page, NEW, "Une prestation est déjà chargée sur cette box");
    assert.equal(await read("hostUid"), HOST);
    // Salon tout neuf d'une box acceptée (ce téléphone y est relié par habitude) : la fête change de box.
    await salon(LOBBY, { regie: { [tel]: { pairedAt: 1, via: "password" } } });
    await page.fill("#box-code", "neu vb");
    await capture(page, "changer-de-box-code", { pleinePage: false });
    await page.click("#box-go");
    await page.locator("#r-toast", { hasText: "La fête continue sur la nouvelle TV" }).waitFor();
    assert.equal(await page.locator("#box").isHidden(), true);
    assert.equal(await page.locator("#r-tv").isHidden(), true);
    assert.equal(await read("hostUid"), SECOURS);
    const partie = await lireComme(SECOURS, `games/${CODE}`);
    assert.deepEqual({ ...partie.takeover, at: typeof partie.takeover.at }, { to: NEW, from: HOST, by: tel, at: "number" });
    assert.equal(await lireComme(SECOURS, `games/${NEW}/handoff`), CODE);
    assert.deepEqual(Object.keys(partie.teams).sort(), ["bleu", "rose"]);
    assert.equal(partie.state.scores.rose, 100);
    // Le téléphone reste sur la même partie : la box de secours reçoit ses commandes et les applique.
    assert.equal(await page.textContent("#c-code"), CODE);
    box = startBox({ host: SECOURS, from: partie.state, seen: Object.keys(partie.commands ?? {}) });
    await page.click("#c-pause");
    await page.locator("#c-phase", { hasText: "En pause" }).waitFor();
    const pauses = Object.values(await lireComme(SECOURS, `games/${CODE}/commands`)).filter((c) => c.type === "pause" && c.by === tel);
    assert.equal(pauses.length, 2, "la pause restée sans réponse, puis celle appliquée par la box de secours");
    await page.context().close();
  });

  test("« 📺 Changer de box » est toujours dans la carte ; sans Internet sur le téléphone rien n'est envoyé, puis le changement passe", async () => {
    box = startBox();
    await allowBox(env, SECOURS);
    await salon();
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await page.click("#c-box");
    await page.locator("#box:not([hidden])").waitFor();
    await page.click("#box-close");
    await page.locator("#box").waitFor({ state: "hidden" });
    await page.click("#c-box");
    await page.context().setOffline(true);
    await page.locator("#r-offline").waitFor();
    await essayer(page, NEW, "Pas d'Internet sur ce téléphone");
    assert.equal(await read("hostUid"), HOST);
    await page.context().setOffline(false);
    await page.locator("#r-offline").waitFor({ state: "hidden", timeout: 15000 });
    await page.click("#box-go");
    await page.locator("#r-toast", { hasText: "La fête continue sur la nouvelle TV" }).waitFor();
    assert.equal(await read("hostUid"), SECOURS);
    await page.context().close();
  });
});

describe("lancement des prestations : un anniversaire sur une seule box (cedric, 21/10)", () => {
  const seedLib = (path, value) => env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `library/${path}`), value));
  const raw = async (path) => {
    let value;
    await env.withSecurityRulesDisabled(async (ctx) => { value = (await get(ref(ctx.database(), path))).val(); });
    return value;
  };
  const writeRaw = (path, value) => env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), path), value));
  const QUIZ = {
    title: "Animaux", source: "gemini", updatedAt: 1,
    questions: [
      { text: "Roi de la jungle ?", choices: ["Lion", "Tigre"], correct: 0, status: "validee" },
      { text: "Combien de pattes a une araignée ?", choices: ["6", "8"], correct: 1, status: "validee" },
    ],
  };
  // Chloé porte un titre à elle : la fenêtre de lancement dit quand même le prénom (cedric : « Lancer l'anniversaire de Chloé ? »).
  const prestation = (childName, date, extra = {}) =>
    ({ childName, age: 7, date, status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1, ...extra });
  async function seedShows(shows) {
    await seedLib("quizzes/animaux", QUIZ);
    await seedLib("shows", shows);
  }
  const item = (page, text) => page.locator("#panel-show:not([hidden]) .show-item", { hasText: text });
  /** Autre partie, sur une autre box : son état, la prestation qu'elle joue, sa box et la présence de celle-ci. */
  const autrePartie = (code, { phase = "question", prestation: p, host = `box-${code}`, online, at = Date.now(), endedAt } = {}) =>
    writeRaw(`games/${code}`, {
      hostUid: host,
      state: { phase, round: 1, ...(endedAt ? { endedAt } : {}) },
      public: { title: "Quiz", changeBox: true, ...(p ? { prestation: p } : {}) },
      ...(online == null ? {} : { hostOnline: { online, at, uid: host } }),
    });
  /** Petite box qui accepte toute prestation chargée sur sa partie [code] (comme GameViewModel.judgeShow au salon). */
  function boxAuSalon(code, host) {
    const d = env.authenticatedContext(host).database();
    return onValue(ref(d, `games/${code}/show`), async (s) => {
      const show = s.val();
      if (!show) return;
      await update(ref(d, `games/${code}`), {
        showStatus: { id: show.id, status: "applied", at: Date.now() },
        conducteur: { id: show.quiz.id, title: show.title, rev: show.id, questions: show.quiz.questions },
        public: { title: show.title, prestation: show.prestation },
      });
    });
  }

  test("lancer : la fenêtre du téléphone dit prénom, âge et date ; « Annuler » n'envoie rien ; au salon, une autre prestation remplace la première", async () => {
    box = startBox();
    await seedShows({ lea: prestation("Léa", isoDay()), chloe: prestation("Chloé", "2099-10-24", { title: "ANNIVERSAIRE – Chloé" }) });
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await item(regie, "Chloé").locator(".show-run", { hasText: "Préparée" }).waitFor();

    // Chloé : sa fête n'est pas aujourd'hui, la fenêtre le signale sans crier ; « Annuler » a le focus.
    await item(regie, "Chloé").click();
    await regie.locator("#ask:not([hidden])").waitFor();
    assert.equal(await regie.textContent("#ask-title"), "Lancer l'anniversaire de Chloé ?");
    const date = new Date("2099-10-24T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    assert.equal(await regie.textContent("#ask-line"), `7 ans – ${date}`);
    assert.equal(await regie.textContent("#ask-warn"), "⚠ Ce n'est pas la date d'aujourd'hui.");
    assert.equal(await regie.textContent("#ask-ok"), "Lancer");
    assert.equal(await regie.evaluate(() => document.activeElement?.id), "ask-cancel");
    await capture(regie, "lancement-fenetre", { pleinePage: false });
    await regie.click("#ask-cancel");
    await regie.locator("#ask").waitFor({ state: "hidden" });
    assert.equal(await read("show"), null, "Annuler : rien n'est envoyé à la TV");
    assert.equal(await raw("launches"), null);

    // Léa : c'est aujourd'hui, pas d'avertissement. « Lancer » : programme et lancement en une seule écriture.
    await item(regie, "Léa").click();
    await regie.locator("#ask:not([hidden])").waitFor();
    assert.equal(await regie.textContent("#ask-title"), "Lancer l'anniversaire de Léa ?");
    assert.equal(await regie.locator("#ask-warn").isHidden(), true);
    await regie.click("#ask-ok");
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    assert.equal((await read("show")).prestation, "lea");
    assert.equal((await raw("launches/lea")).code, CODE);
    await item(regie, "Léa").locator(".show-run", { hasText: "✓ Sur cette TV" }).waitFor();

    // Au salon d'attente, Chloé remplace Léa : la prestation de Léa est libérée dans la même écriture.
    await addTeam("rose", "Les Roses");
    await item(regie, "Chloé").click();
    assert.equal(await respond(regie), "Remplacer l'anniversaire de Léa par celui de Chloé ? Les équipes restent.");
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    assert.equal((await read("show")).prestation, "chloe");
    assert.equal(await raw("launches/lea"), null);
    assert.equal((await raw("launches/chloe")).code, CODE);
    assert.ok(await read("teams/rose"), "les équipes restent");
    await item(regie, "Léa").locator(".show-run", { hasText: "Préparée" }).waitFor();
    await regie.context().close();
  });

  test("mauvaise prestation : première question ouverte sans point, la bonne la remplace et la fête repart du salon ; après un point, plus rien", async () => {
    box = startBox();
    await seedShows({ lea: prestation("Léa", isoDay()), chloe: prestation("Chloé", isoDay()) });
    await addTeam("rose", "Les Roses");
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await item(regie, "Léa").click();
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    await regie.locator("#c-next", { hasText: "Lancer la fête !" }).click();
    await regie.locator("#c-phase", { hasText: "Question en cours" }).waitFor();

    // Aucun point : « Mauvaise prestation ? », discret, dans les jeux de la prestation.
    await regie.click("#c-rescue");
    await regie.locator("#rescue-wrong:not([hidden])").click();
    await regie.locator("#panel-show:not([hidden]) .hint", { hasText: "Mauvaise prestation ?" }).waitFor();
    await item(regie, "Chloé").click();
    assert.equal(await respond(regie), "Remplacer l'anniversaire de Léa par celui de Chloé ? Les équipes restent, on repart au début.");
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    assert.equal(await read("state/phase"), "lobby", "la fête repart du salon d'attente");
    assert.equal((await read("public")).childName, "Chloé");
    assert.equal((await raw("launches/chloe")).code, CODE);
    assert.equal(await raw("launches/lea"), null);
    assert.ok(await read("teams/rose"), "les équipes restent");

    // Un point donné : « Mauvaise prestation ? » disparaît.
    await regie.locator("#c-next", { hasText: "Lancer la fête !" }).click();
    await regie.locator("#c-phase", { hasText: "Question en cours" }).waitFor();
    await regie.click("#tab-teams");
    await givePoints(regie, "rose", 10);
    await waitFor(async () => (await read("state/scored")) === true, "point compté par la box");
    await regie.click("#c-rescue");
    await regie.locator("#rescue:not([hidden])").waitFor();
    assert.equal(await regie.locator("#rescue-wrong").isHidden(), true);
    await regie.click("#rescue-close");

    // Point donné au même instant (l'écran ne le savait pas encore) : la box refuse, le téléphone le dit simplement.
    await writeRaw(`games/${CODE}/state/scored`, null);
    await regie.click("#c-rescue");
    await regie.locator("#rescue-wrong:not([hidden])").click();
    await item(regie, "Léa").click();
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "Des points ont déjà été donnés : la prestation ne peut plus changer. Pour repartir de zéro, choisissez « Nouvelle partie » sur la TV." }).waitFor();
    await waitFor(async () => (await raw("launches/lea")) === null && (await raw("launches/chloe"))?.code === CODE, "la prestation de Chloé reprend sa place");
    assert.equal((await read("public")).prestation, "chloe");
    await regie.context().close();
  });

  test("la liste dit où en est chaque prestation ; une archivée encore en cours y reste ; une fête terminée se relance", async () => {
    box = startBox();
    const debut = Date.now() - 3_600_000;
    const coupure = Date.now() - 600_000;
    const fin = Date.now() - 86_400_000;
    await seedShows({
      ici: prestation("Inès", isoDay()),
      salon: prestation("Sacha", isoDay()),
      cours: prestation("Chloé", isoDay()),
      // Fête d'hier, rangée dans les archives, mais la partie n'est pas finie : elle reste dans la liste.
      pause: prestation("Malo", "2020-01-05", { status: "archivee" }),
      finie: prestation("Tom", isoDay()),
      vieille: prestation("Zoé", "2020-01-05", { status: "archivee" }),
      abandon: prestation("Lou", isoDay()),
    });
    await autrePartie("SALO2", { phase: "lobby", prestation: "salon", online: true });
    await autrePartie("COUR2", { prestation: "cours", online: true });
    await autrePartie("PAUS2", { prestation: "pause", online: false, at: coupure });
    await autrePartie("FINI2", { phase: "ended", prestation: "finie", endedAt: fin });
    await autrePartie("ABAN2", { phase: "lobby", prestation: "autre" });
    await writeRaw("launches", {
      ici: { code: CODE, by: "x", at: debut },
      salon: { code: "SALO2", by: "x", at: debut },
      cours: { code: "COUR2", by: "x", at: debut },
      pause: { code: "PAUS2", by: "x", at: debut },
      finie: { code: "FINI2", by: "x", at: debut },
      // Box qui n'a jamais chargé la prestation : son lancement ne tient plus.
      abandon: { code: "ABAN2", by: "x", at: debut },
    });
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    const etat = async (text) => {
      const el = item(regie, text);
      await el.waitFor();
      return [await el.getAttribute("data-run"), await el.locator(".show-run").textContent()];
    };
    assert.deepEqual(await etat("Inès"), ["ici", "✓ Sur cette TV"]);
    assert.deepEqual(await etat("Sacha"), ["salon", "📺 Chargée sur une autre box (salon d'attente)"]);
    assert.deepEqual(await etat("Chloé"), ["encours", `🟢 En cours sur une autre box depuis ${heureCourte(debut)}`]);
    assert.deepEqual(await etat("Malo"), ["interrompue", `⏸ Interrompue : l'autre box ne répond plus depuis ${heureCourte(coupure)}`]);
    assert.deepEqual(await etat("Tom"), ["terminee", `✓ Terminée le ${jourHeure(fin)}`]);
    assert.deepEqual(await etat("Lou"), ["preparee", "Préparée"]);
    assert.equal(await item(regie, "Zoé").count(), 0, "archivée et jamais lancée : pas sur la régie");
    await capture(regie, "liste-etats");

    // En cours ailleurs : jamais une seconde fête ; ce salon a déjà sa prestation, la fenêtre dit quoi faire.
    await item(regie, "Chloé").click();
    await regie.locator("#ask:not([hidden])").waitFor();
    assert.equal(await regie.textContent("#ask-title"), "L'anniversaire de Chloé est déjà en cours sur une autre box.");
    assert.equal(await regie.locator("#ask-ok").isHidden(), true);
    assert.match(await regie.textContent("#ask-text"), /« Nouvelle partie »/);
    await regie.click("#ask-cancel");
    assert.equal((await raw("launches/cours")).code, "COUR2");

    // Fête terminée : elle se relance depuis le début sur cette TV.
    await item(regie, "Tom").click();
    await regie.locator("#ask:not([hidden])").waitFor();
    assert.equal(await regie.textContent("#ask-title"), `Cette fête est terminée le ${jourHeure(fin)}.`);
    assert.equal(await regie.textContent("#ask-text"), "La relancer depuis le début sur cette TV ?");
    await regie.click("#ask-ok");
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    assert.equal((await raw("launches/finie")).code, CODE);
    assert.equal(await raw("launches/ici"), null, "la prestation remplacée est libérée");
    // Lancement abandonné : la prestation se lance ici comme une autre.
    await item(regie, "Lou").click();
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    assert.equal((await raw("launches/abandon")).code, CODE);
    await regie.context().close();
  });

  test("deux régies lancent le même anniversaire au même instant : une seule TV le reçoit, l'autre téléphone le dit", async () => {
    box = startBox();
    const AUTRE = "DEUX2";
    await allowBox(env, "box2");
    await writeRaw(`games/${AUTRE}`, { hostUid: "box2", state: { phase: "lobby", seq: 0, round: 1 }, public: { title: "Quiz", changeBox: true } });
    const stopAutre = boxAuSalon(AUTRE, "box2");
    await seedShows({ lea: prestation("Léa", isoDay()) });
    const [a, b] = [await openRegie(), await openRegie(null, `?g=${AUTRE}&emu=1`)];
    for (const page of [a, b]) {
      await pair(page);
      await inRegie(page);
      await item(page, "Léa").click();
      await page.locator("#ask:not([hidden])").waitFor();
    }
    await Promise.all([a.click("#ask-ok"), b.click("#ask-ok")]);
    const verdict = async (page) => {
      const toast = page.locator("#r-toast:not([hidden])");
      await toast.waitFor();
      return toast.textContent();
    };
    const textes = await Promise.all([verdict(a), verdict(b)]);
    const gagnant = (await raw("launches/lea")).code;
    const [g, p] = gagnant === CODE ? [0, 1] : [1, 0];
    assert.match(textes[g], /est chargée sur la TV/);
    assert.equal(textes[p], "Cet anniversaire vient d'être lancé sur une autre box.");
    assert.equal(await raw(`games/${gagnant === CODE ? AUTRE : CODE}/show`), null, "la TV perdante ne reçoit rien");
    // Le téléphone perdant voit aussitôt la fête chargée sur l'autre box.
    await item([a, b][p], "Léa").locator(".show-run", { hasText: "Chargée sur une autre box" }).waitFor();
    stopAutre();
    await a.context().close();
    await b.context().close();
  });

  test("« Continuer la fête sur cette TV » : la fête d'une box en panne reprend sur le salon de ce téléphone ; l'ancienne box ne pilote plus rien", async () => {
    const NEW = "NEUVB";
    const SECOURS = "secours";
    await allowBox(env, SECOURS);
    await seedShows({ lea: prestation("Léa", isoDay()) });
    // La fête de Léa tourne sur la box CODE : deux équipes, des points, sa box encore en ligne.
    await addTeam("rose", "Les Roses");
    await writeRaw(`games/${CODE}/state`, { ...questionState(4), scores: { rose: 150 } });
    await writeRaw(`games/${CODE}/public`, { title: "L'anniversaire de Léa", childName: "Léa", changeBox: true, prestation: "lea" });
    await writeRaw(`games/${CODE}/hostOnline`, { online: true, at: Date.now(), uid: HOST });
    await writeRaw("launches/lea", { code: CODE, by: "x", at: Date.now() - 3_600_000 });
    // Ce téléphone est sur le salon d'attente tout neuf d'une box de secours.
    await writeRaw(`games/${NEW}`, { hostUid: SECOURS, state: { phase: "lobby", seq: 0, round: 1 }, public: { title: "Quiz", changeBox: true } });
    const regie = await openRegie(null, `?g=${NEW}&emu=1`);
    await pair(regie);
    await inRegie(regie);
    await item(regie, "Léa").locator(".show-run", { hasText: "🟢 En cours sur une autre box" }).waitFor();

    // Box encore allumée : avertissement en rouge.
    await item(regie, "Léa").click();
    await regie.locator("#ask:not([hidden])").waitFor();
    assert.equal(await regie.textContent("#ask-title"), "L'anniversaire de Léa est déjà en cours sur une autre box.");
    assert.equal(await regie.textContent("#ask-danger"), "L'autre box est encore allumée et connectée : à faire seulement si elle est en panne.");
    assert.equal(await regie.textContent("#ask-ok"), "📺 Continuer la fête sur cette TV");
    await capture(regie, "continuer-ici-alerte", { pleinePage: false });
    await regie.click("#ask-cancel");
    assert.equal(await read("hostUid"), HOST);

    // La box tombe en panne : plus d'avertissement ; un mauvais mot de passe laisse la fenêtre ouverte.
    await writeRaw(`games/${CODE}/hostOnline`, { online: false, at: Date.now(), uid: HOST });
    await regie.click("#panel-show button.link:has-text('Actualiser la liste')");
    await item(regie, "Léa").locator(".show-run", { hasText: "⏸ Interrompue" }).waitFor();
    await item(regie, "Léa").click();
    await regie.locator("#ask:not([hidden])").waitFor();
    assert.equal(await regie.locator("#ask-danger").isHidden(), true);
    await regie.fill("#ask-pass", "Pas-le-bon");
    await regie.click("#ask-ok");
    await regie.locator("#ask-error", { hasText: "Mot de passe de régie incorrect." }).waitFor({ timeout: 15000 });
    assert.equal(await read("hostUid"), HOST);
    await regie.fill("#ask-pass", PASSWORD);
    await regie.click("#ask-ok");
    await regie.locator("#r-toast", { hasText: "La fête continue sur cette TV" }).waitFor({ timeout: 15000 });

    // La fête est confiée à la box de secours (même écriture que « Changer de box ») ; ce téléphone la pilote.
    assert.equal(await raw(`games/${CODE}/hostUid`), SECOURS);
    assert.equal((await raw(`games/${CODE}/takeover`)).to, NEW);
    assert.equal(await raw(`games/${NEW}/handoff`), CODE);
    await regie.locator("#c-code", { hasText: CODE }).waitFor();
    assert.equal(new URL(regie.url()).searchParams.get("g"), CODE);
    assert.equal((await raw(`games/${CODE}/state/scores`)).rose, 150, "les points restent");
    // L'ancienne box ne pilote plus rien, même sa présence.
    const ancienne = env.authenticatedContext(HOST).database();
    await assert.rejects(set(ref(ancienne, `games/${CODE}/state/phase`), "ended"));
    await assert.rejects(set(ref(ancienne, `games/${CODE}/hostOnline`), { online: true, at: Date.now(), uid: HOST }));
    await regie.context().close();
  });

  test("« Recommencer » ou « Aller à ce jeu » recopie dans la partie les photos et extraits du jeu qui y manquent", async () => {
    box = startBox();
    const PHOTO = "abcdef0123456789";
    const SON = "0123456789abcdef";
    const PNG = `data:image/png;base64,${png([200, 40, 90]).toString("base64")}`;
    const MP3 = "data:audio/mpeg;base64,SUQz";
    await seedLib(`images/${PHOTO}`, PNG);
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `library/sounds/${SON}`), MP3));
    await set(gameRef("conducteur"), {
      id: "p", title: "L'anniversaire de Léa", rev: "s1", mimes: true, programReset: true,
      questions: [
        { id: "q1", text: "Couleur du ciel ?", choices: ["Vert", "Bleu"], correct: 1, round: "Couleurs" },
        { id: "q2", text: "Qui rugit ?", choices: ["Lion", "Chat"], correct: 0, round: "Animaux", imageId: PHOTO, audioId: SON },
      ],
    });
    await box.set(questionState(2));
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.click("#c-rescue");
    await regie.locator('#rescue-list [data-start="1"] button', { hasText: "Aller à ce jeu" }).click();
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "C'est parti pour « Animaux »" }).waitFor();
    await waitFor(async () => (await read(`images/${PHOTO}`)) === PNG && (await read(`sounds/${SON}`)) === MP3, "photo et extrait recopiés dans la partie");
    await regie.context().close();
  });
});

describe("remplacement d'un appareil en cours de partie", () => {
  /** Tablette d'équipe : rejoint la partie par le QR code habituel. */
  async function tablet(name) {
    const page = await openRegie();
    await page.locator("#screen-join.active").waitFor();
    await page.fill("#team-name", name);
    await page.click("#join");
    return page;
  }
  async function startedGame() {
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    const old = await tablet("Les Bleus");
    await old.locator("#screen-play.active").waitFor();
    await addTeam("rose", "Les Roses");
    await regie.locator("#c-next", { hasText: "Lancer la fête !" }).click();
    await old.locator("#screen-question.active").waitFor();
    const [blue] = Object.entries(await read("teams")).find(([, t]) => t.name === "Les Bleus");
    return { regie, old, blue };
  }

  test("tablette remplacée : l'équipe continue sur le nouvel appareil, l'ancien est désactivé même rechargé", async () => {
    const { regie, old, blue } = await startedGame();
    await regie.locator("#panel-teams [data-team] .pts-open").first().waitFor();
    await givePoints(regie, blue, 10);
    await waitFor(async () => (await read("state"))?.scores?.[blue] === 10, "points avant le remplacement");

    // Un téléphone de secours scanne le QR code : la partie a commencé, il demande à entrer.
    const fresh = await openRegie();
    await fresh.locator("#join", { hasText: "Demander à entrer" }).waitFor();
    await fresh.fill("#team-name", "les bleus");
    await fresh.click("#join");
    await fresh.locator("#screen-waiting.active").waitFor();
    assert.equal(Object.keys(await read("teams")).length, 2, "aucune équipe créée sans la régie");

    // La régie propose en premier l'équipe du même nom.
    const replaceBtn = regie.locator("#c-requests .request button").first();
    await replaceBtn.filter({ hasText: "Remplace « Les Bleus »" }).waitFor();
    await replaceBtn.click();
    assert.match(await respond(regie), /Confier « Les Bleus » à ce nouvel appareil/);
    await regie.locator("#r-toast", { hasText: "continue sur le nouvel appareil" }).waitFor();
    await regie.locator("#c-requests").waitFor({ state: "hidden" });

    // Nouvel appareil : même équipe, même couleur, il répond pour elle.
    await fresh.locator("#screen-question.active").waitFor();
    assert.equal(await fresh.locator("#screen-question .team-label").textContent(), "Les Bleus");
    await fresh.locator(".choice").nth(1).click();
    await fresh.locator("#q-status", { hasText: "Réponse B envoyée" }).waitFor();
    assert.equal((await read(`answers/q1/${blue}`))?.choice, 1);
    const teams = await read("teams");
    assert.equal(Object.keys(teams).length, 2, "toujours deux équipes");
    assert.equal((await read("state")).scores[blue], 10, "points gardés");

    // Ancien appareil : désactivé tout de suite, et encore après un rechargement.
    await old.locator("#screen-replaced.active").waitFor();
    assert.match(await old.locator("#replaced-text").textContent(), /Les Bleus.*avec tous ses points/);
    await old.reload();
    await old.locator("#screen-replaced.active").waitFor();

    // Le serveur détecte en retard la coupure de l'ancien appareil et écrit « hors ligne » à sa place :
    // le nouveau corrige aussitôt (pas de fausse pause automatique).
    await old.context().close();
    await setPresence(blue, false);
    await waitFor(async () => (await read(`presence/${blue}`))?.online === true, "présence corrigée par le nouvel appareil");
    for (const p of [regie, fresh]) await p.context().close();
  });

  test("« 📱 Reconnecter » sur le téléphone régie (cedric, 21/10) : QR code, la tablette touche son équipe, Sarah la lui confie ; aussi depuis le bandeau rouge", async () => {
    const { regie, old, blue } = await startedGame();
    await regie.locator("#panel-teams [data-team] .pts-open").first().waitFor();
    await givePoints(regie, blue, 10);
    await waitFor(async () => (await read("state"))?.scores?.[blue] === 10, "points avant la reconnexion");

    // Toujours en bas de la régie, entre Pause et Terminer : le QR code de la partie, en mode « reprendre une équipe ».
    assert.deepEqual(await regie.locator(".actions .row .btn").evaluateAll((l) => l.map((b) => b.getAttribute("aria-label") ?? b.innerText)), ["Pause", "Reconnecter une tablette", "Terminer"]);
    await regie.click("#c-tablette");
    await regie.locator("#tablette:not([hidden]) #tablette-qr svg path").waitFor();
    const lien = await regie.locator("#tablette-qr").getAttribute("data-texte");
    assert.equal(lien, `${baseUrl}/?g=${CODE}&reprise=1&emu=1`);
    assert.ok((await regie.locator("#tablette-qr path").getAttribute("d")).split("M").length > 200, "un vrai QR code");
    const qr = await regie.locator("#tablette-qr").boundingBox();
    assert.ok(qr.width >= 250 && qr.width === qr.height, `QR code carré et grand : ${JSON.stringify(qr)}`);
    await regie.locator("#tablette-attente", { hasText: "En attente de la tablette" }).waitFor();
    await capture(regie, "regie-reconnecter-tablette");

    // La nouvelle tablette scanne, touche « Les Bleus » ; Sarah la lui confie depuis cette fenêtre, qui se referme.
    const fresh = await openRegie(null, new URL(lien).search);
    await fresh.locator("#screen-takeover.active").waitFor();
    await fresh.locator("#takeover-list button", { hasText: "Les Bleus" }).click();
    await fresh.locator("#waiting-text", { hasText: "sur son téléphone" }).waitFor();
    await regie.locator("#tablette-demandes button", { hasText: "Confier « Les Bleus » à la nouvelle tablette" }).click();
    assert.match(await respond(regie), /Confier « Les Bleus » à ce nouvel appareil/);
    await regie.locator("#r-toast", { hasText: "continue sur le nouvel appareil" }).waitFor();
    await regie.locator("#tablette").waitFor({ state: "hidden" });
    await fresh.locator("#screen-question.active").waitFor();
    assert.equal(await fresh.locator("#screen-question .team-label").textContent(), "Les Bleus");
    await old.locator("#screen-replaced.active").waitFor();
    assert.equal((await read("state")).scores[blue], 10, "points gardés");

    // Une tablette coupée : le bandeau rouge a son bouton « 📱 Reconnecter » (le bandeau, lui, reste affiché).
    await old.context().close();
    const [rose] = Object.entries(await read("teams")).find(([, t]) => t.name === "Les Roses");
    await setPresence(rose, true);
    await setPresence(rose, false);
    const bouton = regie.locator("#r-alerte .r-alerte-reconnecter", { hasText: "📱 Reconnecter" });
    await bouton.waitFor({ timeout: 8000 });
    await capture(regie, "regie-bandeau-reconnecter");
    await bouton.click();
    // La fenêtre passe au-dessus du bandeau (qui cachait « Fermer ») ; refermée, le bandeau est toujours là.
    await regie.locator("#tablette:not([hidden])").waitFor();
    await regie.click("#tablette-close");
    await regie.locator("#tablette").waitFor({ state: "hidden" });
    assert.equal(await regie.locator("#r-alerte:not(.revenue)").isVisible(), true, "le bandeau n'est pas masqué par le bouton");
    // Petit téléphone (360 px), partie en pause : « Reprendre (3, 2, 1) », « 📱 Tablette » et « Terminer » tiennent sur la ligne.
    await regie.setViewportSize({ width: 360, height: 740 });
    await regie.click("#c-pause");
    await regie.locator("#c-pause", { hasText: "Reprendre (3, 2, 1)" }).waitFor();
    const boutons = await regie.locator(".actions .row .btn").evaluateAll((l) => l.map((b) => {
      const r = b.getBoundingClientRect();
      return { texte: b.innerText, deborde: b.scrollWidth > b.clientWidth + 1, gauche: r.left, droite: r.right };
    }));
    assert.ok(boutons.every((b) => !b.deborde && b.gauche >= 0 && b.droite <= 360), `boutons du bas : ${JSON.stringify(boutons)}`);
    await capture(regie, "regie-bas-360-pause");
    for (const p of [regie, fresh]) await p.context().close();
  });

  test("nouvelle équipe en cours de partie, ou demande ignorée", async () => {
    const { regie, old } = await startedGame();
    const late = await tablet("Les Tard-Venus");
    await late.locator("#screen-waiting.active").waitFor();
    await regie.locator("#c-requests button", { hasText: "Nouvelle équipe" }).click();
    await late.locator("#screen-question.active").waitFor();
    assert.equal(await late.locator("#screen-question .team-label").textContent(), "Les Tard-Venus");
    await regie.locator("#c-answered", { hasText: "0 / 3 équipes ont répondu" }).waitFor();

    const intruder = await tablet("Inconnus");
    await intruder.locator("#screen-waiting.active").waitFor();
    await regie.locator("#c-requests button", { hasText: "Ignorer" }).click();
    await intruder.locator("#error-text", { hasText: "n'a pas fait entrer cet appareil" }).waitFor();
    assert.equal(Object.keys(await read("teams")).length, 3);
    for (const p of [regie, old, late, intruder]) await p.context().close();
  });

  test("quiz lancé pendant qu'une équipe tape son nom : elle peut encore demander à entrer", async () => {
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await addTeam("rose", "Les Roses");
    const slow = await openRegie();
    await slow.locator("#screen-join.active").waitFor();
    await regie.locator("#c-next", { hasText: "Lancer la fête !" }).click();
    await waitFor(async () => (await read("state"))?.phase === "question", "quiz lancé");
    await slow.fill("#team-name", "Les Lents");
    await slow.click("#join");
    await slow.locator("#join", { hasText: "Demander à entrer" }).waitFor();
    assert.equal(await slow.inputValue("#team-name"), "Les Lents");
    await slow.click("#join");
    await regie.locator("#c-requests", { hasText: "« Les Lents » demande à entrer" }).waitFor();
    for (const p of [regie, slow]) await p.context().close();
  });

  test("8 équipes : la régie ne peut que remplacer un appareil", async () => {
    const { regie, old } = await startedGame();
    for (let i = 3; i <= 8; i++) await addTeam(`t${i}`, `Équipe ${i}`);
    const extra = await tablet("Les Neuvièmes");
    await extra.locator("#screen-waiting.active").waitFor();
    await regie.locator("#c-requests button", { hasText: "Nouvelle équipe" }).click();
    await regie.locator("#r-toast", { hasText: "8 équipes maximum" }).waitFor();
    assert.equal(Object.keys(await read("teams")).length, 8);
    assert.ok(await read("joinRequests"), "la demande reste en attente");
    for (const p of [regie, old, extra]) await p.context().close();
  });
});

/** Fichier WAV mono 22 kHz : un bip de [hz] pendant [seconds] secondes, pour simuler un morceau importé. */
function wav(hz, seconds) {
  const rate = 22050, n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * hz * i) / rate)), 44 + i * 2);
  return buf;
}

/** Fichier WAV mono 22 kHz fait de passages [secondes, amplitude] d'un bip de [hz] : une chanson calme puis forte. */
function wavPassages(hz, passages) {
  const rate = 22050, n = rate * passages.reduce((s, [sec]) => s + sec, 0);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  let i = 0;
  for (const [sec, amp] of passages) {
    for (const fin = i + rate * sec; i < fin; i++) buf.writeInt16LE(Math.round(amp * Math.sin((2 * Math.PI * hz * i) / rate)), 44 + i * 2);
  }
  return buf;
}

/** Confirmation de la régie (fenêtre à ses couleurs) : renvoie la question posée, puis confirme ou renonce. */
async function respond(page, accept = true) {
  await page.locator("#ask:not([hidden])").waitFor();
  const text = `${await page.locator("#ask-title").textContent()} ${await page.locator("#ask-text").textContent()}`;
  await page.click(accept ? "#ask-ok" : "#ask-cancel");
  await page.locator("#ask").waitFor({ state: "hidden" });
  return text;
}

/**
 * Fenêtre de la Régie PC (aux couleurs du site, plus la fenêtre grise du navigateur) : attend qu'elle s'ouvre, rend son
 * message (paragraphes séparés par une ligne vide, comme avant), remplit le champ si [texte] est donné, puis choisit
 * OK ([accepter]) ou Annuler, et attend qu'elle soit fermée.
 */
async function repondreFenetre(page, { accepter = true, texte } = {}) {
  const fenetre = page.locator("dialog[data-fenetre][open]");
  await fenetre.waitFor();
  const ouverte = await fenetre.elementHandle();
  const message = await fenetre.locator(".fenetre-message").innerText();
  if (texte !== undefined) await fenetre.locator("[data-fenetre-texte]").fill(texte);
  await fenetre.locator(accepter ? "[data-fenetre-ok]" : "[data-fenetre-annuler]").click();
  await ouverte.waitForElementState("hidden");
  await ouverte.dispose();
  return message;
}

/**
 * Régie PC : la page d'un jeu s'ouvre depuis sa tuile de l'accueil (plus de page Jeux dans le menu) ; l'onglet
 * « collections » mène à son contenu.
 */
async function openGamePage(page, type, tab = null) {
  await page.click("#nav button[data-screen=home]");
  await page.locator(`#screen-home .tile[data-game="${type}"]`).click();
  await page.locator("#screen-game:not([hidden])").waitFor();
  if (tab) await page.click(`#game-tabs [data-tab=${tab}]`);
}

/** Régie PC : les quiz d'un jeu, onglet Collections de sa page (le Quiz, ou le Quiz illustré). */
async function openQuizzes(page, type = "quiz") {
  await openGamePage(page, type, "collections");
  await page.locator("#screen-quizzes:not([hidden])").waitFor();
}

async function waitFor(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Délai dépassé : ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

describe("bibliothèque de quiz et prestations", () => {
  const admin = openAdmin;
  const library = async (path) => {
    let value;
    await env.withSecurityRulesDisabled(async (ctx) => { value = (await get(ref(ctx.database(), `library/${path}`))).val(); });
    return value;
  };
  const seedLibrary = (path, value) => env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `library/${path}`), value));
  // Une manche faite dans une prestation est gardée dans la page de son jeu (`mancheId`, cedric, 21/10) : vérifié, puis
  // retiré pour comparer le contenu.
  const sansManche = async (rounds) => {
    const gardees = (await library("manches")) ?? {};
    return rounds.map(({ mancheId, ...r }) => {
      assert.ok(gardees[mancheId], `manche ${r.type} gardée dans la page de son jeu`);
      return r;
    });
  };
  const ANIMAUX = {
    title: "Animaux", source: "gemini", updatedAt: 1, ageMin: 6, ageMax: 8,
    questions: [
      { text: "Roi de la jungle ?", choices: ["Lion", "Tigre", "Zèbre", "Singe"], correct: 0, status: "validee" },
      { text: "Combien de pattes a une araignée ?", choices: ["6", "8"], correct: 1, status: "validee" },
      { text: "Question pas encore relue", choices: ["Oui", "Non"], correct: 0, status: "brouillon" },
    ],
  };
  const FINALE = {
    title: "Finale", source: "tableur", updatedAt: 1,
    questions: [{ text: "Le Soleil est une étoile", choices: ["Vrai", "Faux"], correct: 0, duration: 15, status: "validee" }],
  };

  test("Sarah colle un quiz Gemini, corrige l'anomalie signalée, valide et enregistre", async () => {
    const page = await admin();
    // Le type de quiz vient du jeu : Quiz illustré (banque, à la main, fichier), Quiz (ChatGPT en plus).
    await openQuizzes(page, "illustre");
    await page.click("#quiz-import-open");
    assert.equal(await page.locator("#kind-panel").isHidden(), true);
    assert.equal(await page.textContent("#import-h1"), "Créer un quiz illustré");
    assert.deepEqual(await page.locator("#kind-ways-list .kind-way").evaluateAll((b) => b.map((x) => x.dataset.way)), ["banque", "main", "json"]);
    await openQuizzes(page);
    await page.click("#quiz-import-open");
    assert.equal(await page.locator("#kind-panel").isHidden(), true);
    assert.equal(await page.textContent("#import-h1"), "Créer un quiz classique");
    assert.equal(await page.locator("#import-gem").isHidden(), true);
    assert.deepEqual(await page.locator("#kind-ways-list .kind-way").evaluateAll((b) => b.map((x) => x.dataset.way)), ["main", "chatgpt", "json"]);
    await page.click('#kind-ways-list [data-way=chatgpt]');
    await page.fill("#gem-theme", "La jungle");
    await page.fill("#gem-age", "8");
    assert.match(await page.inputValue("#gem-prompt"), /thème « La jungle », pour des enfants de 8 ans/);
    // Difficulté : la demande suit ; « Ouvrir ChatGPT » l'emporte, déjà écrite.
    await page.selectOption("#gem-difficulty", "facile");
    assert.match(await page.inputValue("#gem-prompt"), /Niveau facile/);
    assert.doesNotMatch(await page.inputValue("#gem-prompt"), /ne savent pas encore lire/);
    await page.context().route("https://chatgpt.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>ChatGPT</p>" }));
    const [tab] = await Promise.all([page.context().waitForEvent("page"), page.click("#gem-open")]);
    await tab.waitForLoadState();
    assert.match(decodeURIComponent(new URL(tab.url()).searchParams.get("q")), /thème « La jungle »[\s\S]*Niveau facile/);
    await tab.close();
    await page.fill("#import-text", [
      "Titre : La jungle", "",
      "1. Quel animal est le roi de la jungle ?", "A) Le tigre", "B) Le lion", "C) L'éléphant", "D) Le singe", "Réponse : B", "",
      "2. Combien de pattes a une araignée ?", "A) 6", "B) 8", "C) 10", "D) 4", "", // bonne réponse oubliée
      "3. Le paresseux dort beaucoup.", "A) Vrai", "B) Faux", "Réponse : A",
    ].join("\n"));
    await page.click("#import-analyse");
    await page.locator("#screen-review:not([hidden])").waitFor();
    assert.equal(await page.inputValue("#rv-title"), "La jungle");
    await page.locator("#rv-summary", { hasText: "3 questions · 0 validée · 1 à corriger" }).waitFor();
    await page.locator('[data-q="1"] .problems', { hasText: "Bonne réponse absente" }).waitFor();
    await page.click("#rv-validate-all");
    await page.locator("#rv-summary", { hasText: "2 validées · 1 à corriger" }).waitFor();
    assert.equal(await page.locator('[data-q="1"] .q-valid').isDisabled(), true);
    // Sarah coche la bonne réponse (B) puis valide la question.
    await page.locator('[data-q="1"] input[type=radio]').nth(1).check();
    await page.locator('[data-q="1"] .q-valid').check();
    await page.locator("#rv-summary", { hasText: "3 validées" }).waitFor();
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "3 questions validées sur 3" }).waitFor();
    const saved = Object.values(await library("quizzes"));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].title, "La jungle");
    assert.equal(saved[0].source, "gemini");
    assert.equal(saved[0].kind, "classique");
    assert.deepEqual(saved[0].questions.map((q) => [q.correct, q.status]), [[1, "validee"], [1, "validee"], [0, "validee"]]);
    await openQuizzes(page);
    await page.locator("#quiz-list .item", { hasText: "3 questions · 3 validées" }).waitFor();
    await page.context().close();
  });

  test("Sarah prépare une prestation, l'animatrice la charge sur la TV depuis la régie", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX, finale: FINALE });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "7");
    await page.fill("#show-date", "2026-12-02");
    // « ＋ Ajouter un jeu » : les jeux en tuiles. La Super Finale n'en est pas un : c'est un réglage de la manche Quiz.
    await page.click("#round-add");
    assert.equal(await page.locator('#jeu-choix .jeu-tuile[data-jeu="finale"]').count(), 0);
    assert.equal(await page.locator("#jeu-choix .jeu-tuile").count(), 16);
    await page.click('#jeu-choix .jeu-tuile[data-jeu="quiz"]');
    await page.locator("#jeu-choix").waitFor({ state: "hidden" });
    await page.locator('#show-rounds .jeu-bloc[data-jeu="quiz"] .jeu-nom', { hasText: "Quiz" }).waitFor();
    await page.locator("#show-rounds select.grow").nth(0).selectOption("animaux");
    await page.locator("#show-rounds select.finale").selectOption("1");
    // La question des bougies (cedric, 21/10) : cochée d'office dans le premier Quiz ; la décocher l'enlève.
    const bougies = page.locator("#show-rounds label.bougies input");
    assert.equal(await bougies.isChecked(), true);
    await page.locator("#show-summary", { hasText: "3 questions jouables" }).waitFor();
    await bougies.uncheck();
    await page.locator("#show-summary", { hasText: "2 questions jouables" }).waitFor();
    await bougies.check();
    await page.locator("#show-summary", { hasText: "3 questions jouables" }).waitFor();
    // Sur le téléphone (390 px), le menu Super Finale et la case des bougies restent dans le cadre (cedric, 21/10, 19 h 50).
    const largeur = page.viewportSize().width;
    const debords = await page.locator("#show-rounds select.finale, #show-rounds label.bougies, #show-rounds .show-round").evaluateAll((l, w) =>
      l.map((e) => ({ el: e.className, droite: Math.round(e.getBoundingClientRect().right) })).filter((x) => x.droite > w), largeur);
    assert.deepEqual(debords, [], "rien ne dépasse à droite");
    // Le texte choisi dans chaque menu du jeu tient en entier dans son menu (pas de « la dernière qu… »).
    const coupes = await page.locator("#show-rounds select").evaluateAll((l) => {
      const ctx = document.createElement("canvas").getContext("2d");
      return l.flatMap((e) => [...e.options].map((o) => {
        const cs = getComputedStyle(e);
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const place = e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return { texte: o.text, place: Math.round(place), besoin: Math.round(ctx.measureText(o.text).width) };
      })).filter((x) => x.besoin > x.place);
    });
    assert.deepEqual(coupes, [], "aucun texte de menu coupé");
    await capture(page, "prestation-super-finale-telephone");
    await aVenir(page);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    const saved = Object.values(await library("shows"))[0];
    assert.equal(saved.childName, "Léa");
    assert.deepEqual(await sansManche(saved.rounds), [{ type: "quiz", quizId: "animaux", finale: 1 }]);
    await page.context().close();

    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    // Dans le salon d'attente, la régie ouvre directement la liste des prestations prêtes.
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Anniversaire de Léa" }).click();
    // Fenêtre de lancement, sur le téléphone seulement : « Lancer » confirme.
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    await regie.locator("#c-step", { hasText: "Anniversaire de Léa" }).waitFor();
    const show = await read("show");
    assert.equal(show.childName, "Léa");
    assert.equal(show.profile, "PETITS");
    const q = show.quiz.questions;
    // Brouillon écarté, chrono du profil Petits (25 s + 10 s de lecture),
    // Super Finale : la dernière question du quiz compte double, dans le même jeu. Juste avant : les bougies de Léa.
    assert.deepEqual(q.map((x) => [x.id, x.duration, x.double, x.round]), [
      ["r1q1", 35, false, "Animaux"], ["r1q2", 20, false, "Animaux"], ["r1q3", 35, true, "Animaux"],
    ]);
    assert.deepEqual([q[1].kind, q[1].text, q[1].correct], ["number", "Le Juste Chiffre : combien de bougies sur le gâteau de Léa cette année ?", 7]);
    await regie.locator("#c-games", { hasText: "Programme sur la TV (1 jeu)" }).waitFor();
    await regie.click("#tab-plan");
    assert.equal(await regie.locator("#panel-plan .plan-round").count(), 1);
    await regie.locator("#panel-plan .plan-item", { hasText: "points ×2" }).waitFor();
    await regie.context().close();
  });

  test("Régie PC (cedric, 23/10) : la durée de la prestation se calcule toute seule d'après les jeux composés, elle ne se saisit plus", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "7");
    const duree = page.locator("#show-duration");
    assert.equal(await duree.evaluate((e) => e.tagName), "OUTPUT", "un résultat affiché, pas une case à remplir");
    assert.equal(await page.locator("#screen-show-edit input#show-duration").count(), 0);
    const minutes = () => page.evaluate(() => Number(document.querySelector("#show-duration").textContent.match(/^environ (\d+) min$/)?.[1] ?? NaN));
    await page.click("#round-add");
    await page.click('#jeu-choix .jeu-tuile[data-jeu="quiz"]');
    await page.locator("#jeu-choix").waitFor({ state: "hidden" });
    await page.locator("#show-rounds select.grow").nth(0).selectOption("animaux");
    await duree.filter({ hasText: /^environ \d+ min$/ }).waitFor();
    const quizSeul = await minutes();
    assert.ok(quizSeul >= 5 && quizSeul % 5 === 0, `arrondie aux 5 minutes : ${quizSeul}`);
    await page.locator("#show-summary", { hasText: `environ ${quizSeul} min` }).waitFor();
    // Un jeu de plus : l'estimation s'allonge aussitôt ; retiré, elle revient.
    await page.click("#round-add");
    await page.click('#jeu-choix .jeu-tuile[data-jeu="statues"]');
    await page.locator("#jeu-choix").waitFor({ state: "hidden" });
    await waitFor(async () => (await minutes()) > quizSeul, "les statues allongent la prestation");
    await capture(page, "prestation-duree-estimee");
    await page.locator('#show-rounds .jeu-bloc[data-jeu="statues"] button[title="Retirer ce jeu"]').click();
    await repondreFenetre(page);
    await waitFor(async () => (await minutes()) === quizSeul, "jeu retiré : la durée revient");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée." }).waitFor();
    const saved = Object.values(await library("shows"))[0];
    assert.equal("durationMin" in saved, false, "rien à enregistrer : elle se recalcule à chaque ouverture");
    await page.context().close();
  });

  test("Régie PC : l'accueil montre chaque jeu, un contenu intégré se règle, une prestation choisit son nombre de questions et ses notes arrivent en régie", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    const page = await admin();
    // Le menu : Accueil, Bibliothèque, Paramètres (plus de page Jeux ni Prestations : tout part de l'Accueil).
    assert.deepEqual(await page.locator("#nav button").allInnerTexts(), ["Accueil", "Bibliothèque", "Paramètres"]);
    // 16 jeux (dont le Quiz illustré, le Pictionary, les Coffres mystères, le Gonfleur fou et Ça va exploser !) : la Super Finale n'en est pas un, c'est la fin du quiz (réglage de la manche Quiz).
    const tile = (type) => page.locator(`#screen-home .tile[data-game="${type}"]`);
    assert.equal(await page.locator("#screen-home .tile[data-game]").count(), 16);
    await tile("illustre").waitFor();
    await tile("patate").waitFor();
    await tile("gonfleur").waitFor();
    await tile("pictionary").waitFor();
    await page.locator('#screen-home .tile[data-game="quiz"]', { hasText: "1 quiz · 2 questions validées" }).waitFor();
    assert.equal(await tile("finale").count(), 0);
    await openGamePage(page, "quiz");
    await page.locator("#game-rule", { hasText: "les dernières questions du quiz peuvent compter ×2, ×3 ou ×5" }).waitFor();
    // Les pages d'un jeu gardent l'onglet Accueil allumé ; son fil d'Ariane y ramène.
    assert.equal(await page.locator("#nav button.active").textContent(), "Accueil");
    // Mimes : l'onglet Collections mène aux collections de cartes (ce que Sarah ne trouvait pas).
    await openGamePage(page, "mimes", "collections");
    await page.locator("#screen-mimes:not([hidden])").waitFor();
    await page.click("#screen-mimes .crumbs button[data-screen=home]");
    await page.locator("#screen-home:not([hidden])").waitFor();

    // Chante le mot ! : un mot du catalogue retiré, un mot à soi ajouté, puis remis et supprimé.
    await openGamePage(page, "chante", "collections");
    await page.locator('#builtin-items .content-item.on[data-key="soleil"] .content-toggle').click();
    await page.locator("#builtin-status", { hasText: "« soleil » est retiré du jeu." }).waitFor();
    await page.fill("#bi-word", "arc-en-ciel");
    await page.click("#builtin-add button[type=submit]");
    await page.locator("#builtin-status", { hasText: "« arc-en-ciel » est ajouté au jeu." }).waitFor();
    await page.locator('#builtin-items .content-item.custom[data-key="arc-en-ciel"]').waitFor();
    let chante = await library("contents");
    assert.deepEqual(chante.chante.off, ["soleil"]);
    assert.deepEqual(chante.chante.extra, [{ word: "arc-en-ciel" }]);
    await page.fill("#bi-word", "Soleil");
    await page.click("#builtin-add button[type=submit]");
    await page.locator("#builtin-status", { hasText: "« Soleil » existe déjà." }).waitFor();
    // Qui suis-je ? : un personnage sans assez d'indices est refusé avec la raison.
    await openGamePage(page, "quisuis", "collections");
    await page.fill("#bi-answer", "Le koala");
    await page.fill("#bi-clue1", "Je dors dans les eucalyptus");
    await page.click("#builtin-add button[type=submit]");
    await page.locator("#builtin-status", { hasText: "au moins 2 indices" }).waitFor();
    await page.fill("#bi-clue2", "Je ressemble à un petit ours gris");
    await page.click("#builtin-add button[type=submit]");
    await page.locator("#builtin-status", { hasText: "« Le koala » est ajouté au jeu." }).waitFor();
    // Ni émoji ni image : un repère discret, jamais bloquant ; une image (ChatGPT) le remplace.
    const koala = page.locator('#builtin-items .content-item[data-key="le koala"]');
    await koala.locator(".tag.missing", { hasText: "image ou émoji manquant" }).waitFor();
    await koala.locator(".choice-photo input[type=file]").setInputFiles({ name: "koala.png", mimeType: "image/png", buffer: png([120, 120, 130]) });
    await page.locator("#builtin-status", { hasText: "Image de « Le koala » enregistrée." }).waitFor();
    await koala.locator(".choice-thumb:not([hidden])").waitFor();
    assert.equal(await koala.locator(".tag.missing").count(), 0);
    const portrait = (await library("contents")).quisuis.images["le koala"];
    assert.match(portrait, /^[0-9a-f]{16}$/);
    assert.equal(typeof (await library(`images/${portrait}`)), "string");
    // Pictionary : un mot à soi s'enregistre comme pour les autres jeux.
    await openGamePage(page, "pictionary", "collections");
    await page.fill("#bi-word", "Toboggan");
    await page.click("#builtin-add button[type=submit]");
    await page.locator("#builtin-status", { hasText: "« Toboggan » est ajouté au jeu." }).waitFor();
    assert.deepEqual((await library("contents")).pictionary.extra, [{ word: "Toboggan" }]);
    await page.click("#nav button[data-screen=home]");
    await page.locator('#screen-home .tile[data-game="chante"]', { hasText: "dont 1 ajouté · 1 retiré" }).waitFor();

    // Prestation : la première question seulement du quiz, 4 mots, et des notes pour l'animatrice.
    await page.click("#nav button[data-screen=home]");
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    await page.fill("#show-date", "2026-12-02");
    await ajouterJeu(page);
    await page.locator("#show-rounds select.quiz-rappel").selectOption("animaux");
    // La première question seulement : la seconde retirée de la série du quiz (cedric, 23/10).
    const serieAnimaux = page.locator('#show-rounds li.serie[data-origine="quiz"]');
    await serieAnimaux.locator("button.serie-voir").click();
    await serieAnimaux.locator(".serie-liste li", { hasText: "Combien de pattes" }).locator("button.tirage-retirer").click();
    await page.locator('#show-rounds li.serie[data-origine="quiz"] button.serie-voir', { hasText: "1 question (1 retirée)" }).waitFor();
    await ajouterJeu(page, "chante");
    await page.locator("#show-rounds .round").nth(1).locator("select.grow").selectOption("4");
    await page.fill("#show-notes", "Gâteau à 16 h.\nLéa adore les licornes.");
    // 1 question du quiz + celle des bougies (Léa, 9 ans) + 4 mots.
    await page.locator("#show-summary", { hasText: "6 questions" }).waitFor();
    await aVenir(page);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    const [rounds0] = Object.values(await library("shows"))[0].rounds;
    assert.deepEqual(await sansManche(Object.values(await library("shows"))[0].rounds), [{ type: "quiz", seriesQuiz: [{ id: rounds0.seriesQuiz[0].id, origine: "quiz", quizId: "animaux", sans: ["Combien de pattes a une araignée ?"] }], finale: 3 }, { type: "chante", count: 4 }], "Une nouvelle manche Quiz part avec la Super Finale sur 3 questions (cedric, 23/10)");
    await page.context().close();

    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Anniversaire de Léa" }).click();
    // Fenêtre de lancement, sur le téléphone seulement : « Lancer » confirme.
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const show = await read("show");
    assert.deepEqual(show.quiz.questions.map((q) => q.round), ["Animaux", "Animaux", "Chante le mot !", "Chante le mot !", "Chante le mot !", "Chante le mot !"]);
    // Les bougies juste avant la Super Finale (d'office sur 3 questions, ici la seule question du quiz).
    assert.equal(show.quiz.questions[0].text, "Le Juste Chiffre : combien de bougies sur le gâteau de Léa cette année ?");
    assert.equal(show.quiz.questions[1].finale, true);
    assert.ok(!show.quiz.questions.some((q) => q.text === "soleil"), "Un mot retiré ne sort plus");
    await regie.locator("#c-notes:not([hidden])", { hasText: "Léa adore les licornes." }).waitFor();
    await regie.context().close();
  });

  test("Régie PC : Pictionary rangé en séries, un mot à soi dans sa série, une manche choisit ses séries ou les tire au hasard", async () => {
    const page = await admin();
    await openGamePage(page, "pictionary", "collections");
    await page.locator("#builtin-items h3.content-series", { hasText: "Animaux" }).waitFor();
    await page.locator("#builtin-items h3.content-series", { hasText: "À manger" }).waitFor();
    await page.fill("#bi-word", "Toboggan");
    await page.fill("#bi-series", "Au parc");
    await page.click("#builtin-add button[type=submit]");
    await page.locator("#builtin-status", { hasText: "« Toboggan » est ajouté au jeu." }).waitFor();
    await page.locator("#builtin-items h3.content-series", { hasText: "Au parc" }).waitFor();
    assert.deepEqual((await library("contents")).pictionary.extra, [{ word: "Toboggan", series: "Au parc" }]);
    // Une vraie photo pour un mot : elle remplace l'émoji sur la tablette du dessinateur et sur la TV.
    const toboggan = page.locator('#builtin-items .content-item[data-key="toboggan"]');
    await toboggan.locator(".choice-photo input[type=file]").setInputFiles({ name: "toboggan.png", mimeType: "image/png", buffer: png([200, 120, 40]) });
    await page.locator("#builtin-status", { hasText: "Image de « Toboggan » enregistrée." }).waitFor();
    await toboggan.locator(".choice-thumb:not([hidden])").waitFor();
    assert.match((await library("contents")).pictionary.images.toboggan, /^[0-9a-f]{16}$/);

    await page.click("#nav button[data-screen=home]");
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    await ajouterJeu(page, "pictionary");
    const picker = page.locator("#show-rounds .picto-series");
    await picker.locator("span", { hasText: "Toutes les séries : 77 mots" }).waitFor();
    await picker.locator("button", { hasText: "🎲 Au hasard" }).click();
    assert.equal(await picker.locator("button.chip.active").count(), 3);
    await picker.locator("button", { hasText: "Toutes" }).click();
    assert.equal(await picker.locator("button.chip.active").count(), 0);
    await picker.locator("button", { hasText: "Animaux (18)" }).click();
    await picker.locator("button", { hasText: "Au parc (1)" }).click();
    await picker.locator("span", { hasText: "Séries : 19 mots" }).waitFor();
    await aVenir(page);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    assert.deepEqual(await sansManche(Object.values(await library("shows"))[0].rounds), [{ type: "pictionary", duration: 90, series: ["Animaux", "Au parc"] }]);
    await page.context().close();
  });

  test("Sarah compose un paquet de mimes, l'ajoute à une prestation ; la régie le charge ou l'ajoute en direct", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    const page = await admin();
    await page.click(".tile[data-screen=mimes]");
    await page.click("#game-tabs [data-tab=collections]");
    await page.click("#mime-new");
    await page.fill("#mime-title", "Animaux à mimer");
    await page.selectOption("#mime-duration", "45");
    await page.locator("#mime-catalog .mime-card", { hasText: "Chat" }).click();
    await page.locator("#mime-catalog .mime-card", { hasText: "Éléphant" }).click();
    await page.locator("#mime-catalog .mime-card", { hasText: "Lapin" }).click();
    await page.locator("#mime-catalog .mime-card", { hasText: "Lapin" }).click();
    await page.fill("#mime-word", "Le chat de Léa");
    await page.fill("#mime-emoji", "😺");
    await page.locator("#mime-custom button").click();
    await page.locator("#mime-count", { hasText: "3" }).waitFor();
    await page.click("#mime-save");
    await page.locator("#mime-status", { hasText: "Enregistré : 3 cartes" }).waitFor();
    const [deckId, deck] = Object.entries(await library("mimes"))[0];
    assert.equal(deck.duration, 45);
    assert.deepEqual(deck.cards, [{ word: "Chat", image: "🐱" }, { word: "Éléphant", image: "🐘" }, { word: "Le chat de Léa", image: "😺" }]);

    await page.click("#nav button[data-screen=home]");
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    await ajouterJeu(page);
    await page.locator("#show-rounds select.grow").nth(0).selectOption("animaux");
    await ajouterJeu(page, "mimes");
    await page.locator("#show-rounds .round").nth(1).locator("select.grow").selectOption(deckId);
    await page.locator("#show-summary", { hasText: "3 questions · 1 manche de mimes jouables" }).waitFor();
    await aVenir(page);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    assert.deepEqual(await sansManche(Object.values(await library("shows"))[0].rounds), [{ type: "quiz", quizId: "animaux", finale: 3 }, { type: "mimes", deckId }]);
    await page.context().close();

    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Anniversaire de Léa" }).click();
    // Fenêtre de lancement, sur le téléphone seulement : « Lancer » confirme.
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const mime = (await read("show")).quiz.questions[3];
    assert.equal(mime.kind, "mime");
    assert.equal(mime.duration, 45);
    assert.equal(mime.round, "Animaux à mimer");
    assert.deepEqual(mime.cards.map((c) => c.word).sort(), ["Chat", "Le chat de Léa", "Éléphant"]);
    await regie.click("#tab-plan");
    await regie.locator("#panel-plan .plan-item", { hasText: "Mimes : Animaux à mimer" }).waitFor();
    // En direct : « ＋ Jeu », toujours sur l'écran principal, ouvre le même « Ajouter un jeu » que le conducteur.
    assert.equal(await regie.locator("#c-add").isVisible(), true);
    await regie.click("#c-add");
    await regie.locator("#lib-list [data-game^='mimes/']", { hasText: "Animaux à mimer" }).click();
    await regie.locator("#lib-meta", { hasText: "Mimes · 3 cartes · tour de 45 s" }).waitFor();
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "est ajouté à la fin du programme" }).waitFor();
    const plan = (await read("conducteur")).questions;
    assert.equal(plan.length, 5);
    assert.equal(plan[4].kind, "mime");
    assert.equal(plan[4].round, "Animaux à mimer · 2");
    await regie.context().close();
  });

  test("Régie PC : la Bibliothèque range ses images (nom, catégorie, mots-clés) et les retrouve avec les émojis et les photos libres", async () => {
    // Une photo déjà utilisée dans un quiz, d'avant la bibliothèque : elle apparaît « À ranger ».
    const ancienne = "0123456789abcdef";
    await seedLibrary(`images/${ancienne}`, `data:image/png;base64,${png([90, 160, 90]).toString("base64")}`);
    await seedLibrary("quizzes/doudous", { title: "Les doudous", updatedAt: 1, questions: [
      { text: "Qui est-ce ?", choices: ["🐰 Pinpin", "Nounours"], correct: 0, status: "validee", imageId: ancienne },
    ] });
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.locator("#library-images:not([hidden])").waitFor();
    assert.equal(await page.locator("#nav button.active").textContent(), "Bibliothèque");
    // Aperçu : les trois groupes ; les émojis et les photos libres de la banque sont là d'office.
    await page.locator('#media-list .media-group[data-groupe="emojis"] .media-tile').first().waitFor();
    await page.locator('#media-list .media-group[data-groupe="photos"] .media-tile img').first().waitFor();
    await page.locator('#media-list .media-group[data-groupe="miennes"] .media-tile', { hasText: "Pinpin" }).waitFor();

    // Ses images : une catégorie et des mots-clés pour tout l'envoi, le nom de chacune tiré de son fichier.
    await page.click('#media-groups [data-groupe="miennes"]');
    await page.locator('.media-card[data-media="0123456789abcdef"]', { hasText: "Utilisée dans : Quiz « Les doudous »" }).waitFor();
    await page.selectOption("#media-new-cat", "Dessins animés");
    await page.fill("#media-new-tags", "princesse, Disney");
    await page.setInputFiles("#media-files", [
      { name: "elsa-reine.png", mimeType: "image/png", buffer: png([120, 180, 230]) },
      { name: "raiponce.png", mimeType: "image/png", buffer: png([230, 200, 90]) },
    ]);
    await page.locator("#media-status", { hasText: "2 images ajoutées dans « Dessins animés »" }).waitFor();
    const fiches = Object.entries(await library("medias")).sort(([, a], [, b]) => a.name.localeCompare(b.name));
    assert.deepEqual(fiches.map(([, f]) => [f.name, f.cat, f.tags]), [["Elsa reine", "Dessins animés", "princesse, Disney"], ["Raiponce", "Dessins animés", "princesse, Disney"]]);
    const [[elsa], [raiponce]] = fiches;
    for (const id of [elsa, raiponce]) assert.match(await library(`images/${id}`), /^data:image\/jpeg;base64,/);

    // Une fiche se corrige : nom, mots-clés, nouvelle catégorie ; chaque champ s'enregistre en le quittant.
    const carte = page.locator(`.media-card[data-media="${elsa}"]`);
    await carte.locator(".media-name").fill("Elsa");
    await carte.locator(".media-tags").fill("princesse, Disney, reine des neiges");
    await page.locator("#screen-library h1").click();
    await waitFor(async () => (await library(`medias/${elsa}`))?.tags === "princesse, Disney, reine des neiges", "mots-clés enregistrés");
    assert.equal((await library(`medias/${elsa}`)).name, "Elsa");
    await carte.locator(".media-cat").selectOption("＋ Nouvelle catégorie…");
    assert.equal(await repondreFenetre(page, { texte: "Reines et princesses" }), "Nom de la nouvelle catégorie (ex. Pokémon, Super-héros…) :");
    await waitFor(async () => (await library(`medias/${elsa}`))?.cat === "Reines et princesses", "nouvelle catégorie");
    await page.locator('#media-cats [data-cat="Reines et princesses"]').waitFor();

    // Une seule recherche pour les trois groupes, sans accents ni majuscules.
    await page.click('#media-groups [data-groupe="tout"]');
    await page.fill("#media-search", "reine des neiges");
    await page.locator('#media-list .media-group[data-groupe="miennes"] .media-tile', { hasText: "Elsa" }).waitFor();
    assert.equal(await page.locator('#media-list .media-group[data-groupe="miennes"] .media-tile').count(), 1);
    await page.fill("#media-search", "PRINCESSE");
    await page.locator('#media-list .media-group[data-groupe="emojis"] .media-tile', { hasText: "Princesse" }).waitFor();
    await waitFor(async () => await page.locator('#media-list .media-group[data-groupe="miennes"] .media-tile').count() === 2, "ses deux princesses trouvées");
    await page.fill("#media-search", "elephant");
    await page.locator('#media-list .media-group[data-groupe="photos"] .media-tile', { hasText: "Éléphant" }).waitFor();
    await page.locator('#media-list .media-group[data-groupe="emojis"] .media-tile', { hasText: "Éléphant" }).waitFor();

    // Retirer cache l'image sans l'effacer (les quiz qui l'utilisent la gardent) ; « Remettre » la rend.
    await page.fill("#media-search", "");
    await page.click('#media-groups [data-groupe="miennes"]');
    await page.locator(`.media-card[data-media="${raiponce}"]`).getByRole("button", { name: "Retirer" }).click();
    await page.locator("#media-note", { hasText: "« Raiponce » est retirée" }).waitFor();
    await waitFor(async () => (await library(`medias/${raiponce}`))?.hidden === true, "image retirée");
    assert.match(await library(`images/${raiponce}`), /^data:image\//);
    await page.click('#media-cats [data-cat="retirees"]');
    await page.locator(`.media-card.retiree[data-media="${raiponce}"]`).getByRole("button", { name: "Remettre" }).click();
    await waitFor(async () => (await library(`medias/${raiponce}`))?.hidden === undefined, "image remise");

    // Onglet Sons : la bibliothèque des chansons.
    await page.click('#library-tabs [data-lib-tab="sons"]');
    await page.locator("#library-sons:not([hidden]) #song-list", { hasText: "Aucune chanson pour l'instant" }).waitFor();
    await page.context().close();
  });

  test("Régie PC : les pochettes à part de « Mes images » (cedric, 22/10), et gardées quand la chanson est effacée pour de bon", async () => {
    const COUV = "c0c0c0c0c0c0c0c0";
    const AUTRE = "c1c1c1c1c1c1c1c1";
    const PERSO = "a0a0a0a0a0a0a0a0";
    for (const [id, rgb] of [[COUV, [200, 60, 60]], [AUTRE, [60, 60, 200]], [PERSO, [60, 200, 60]]]) {
      await seedLibrary(`images/${id}`, `data:image/png;base64,${png(rgb).toString("base64")}`);
    }
    await seedLibrary("medias", { [PERSO]: { name: "Elsa", cat: "Dessins animés", tags: "princesse", createdAt: 1, updatedAt: 1 } });
    await seedLibrary("quizzes/reines", { title: "Les reines", updatedAt: 1, questions: [
      { text: "Qui est-ce ?", choices: ["Elsa", "Anna"], correct: 0, status: "validee", imageId: PERSO },
    ] });
    await seedLibrary("songs", {
      s1: { title: "Djadja", artist: "Aya Nakamura", imageId: COUV, audioId: "0123456789abcdef", buzz: 30, retiree: true, updatedAt: 1 },
      s2: { title: "Hakuna Matata", artist: "Le Roi lion", imageId: AUTRE, audioId: "fedcba9876543210", buzz: 30, updatedAt: 1 },
    });
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.locator("#library-images:not([hidden])").waitFor();
    // Aperçu : une rubrique « 💿 Pochettes » ; aucune pochette dans « Mes images ».
    await page.locator('#media-groups [data-groupe="pochettes"]', { hasText: "💿 Pochettes (2)" }).waitFor();
    await page.locator('#media-list .media-group[data-groupe="pochettes"] .media-tile', { hasText: "Aya Nakamura – Djadja" }).waitFor();
    await page.locator('#media-list .media-group[data-groupe="miennes"] .media-tile', { hasText: "Elsa" }).waitFor();
    assert.equal(await page.locator('#media-list .media-group[data-groupe="miennes"] .media-tile').count(), 1, "seulement ses images");
    // La recherche trouve une pochette par l'artiste.
    await page.fill("#media-search", "nakamura");
    await page.locator('#media-list .media-group[data-groupe="pochettes"] .media-tile', { hasText: "Djadja" }).waitFor();
    assert.equal(await page.locator('#media-list .media-group[data-groupe="pochettes"] .media-tile').count(), 1);
    await page.fill("#media-search", "");
    // La rubrique : une fiche par pochette, par artiste ; nom et mots-clés, pas de catégorie à choisir.
    await page.click('#media-groups [data-groupe="pochettes"]');
    const djadja = page.locator(`.media-card[data-media="${COUV}"]`);
    await djadja.locator(".media-name").waitFor();
    assert.deepEqual(await page.locator("#media-list .media-card .media-name").evaluateAll((l) => l.map((x) => x.value)), ["Aya Nakamura – Djadja", "Le Roi lion – Hakuna Matata"]);
    assert.equal(await djadja.locator(".media-cat").count(), 0);
    await djadja.locator(".small", { hasText: "Utilisée dans : Chanson « Djadja »" }).waitFor();
    assert.equal(await page.locator("#media-upload").isHidden(), true, "on n'envoie pas ses images dans les pochettes");
    await capture(page, "bibliotheque-pochettes");

    // La chanson supprimée est effacée pour de bon : sa pochette reste, avec sa fiche « Pochettes ».
    await page.click('#library-tabs [data-lib-tab="sons"]');
    await page.locator("#song-retirees", { hasText: "🗑 Supprimées (1)" }).click();
    const question = repondreFenetre(page);
    await page.locator("#song-list .song", { hasText: "Djadja" }).getByRole("button", { name: "Effacer pour de bon" }).click();
    assert.match(await question, /Sa pochette reste dans Bibliothèque › Images › 💿 Pochettes\.$/);
    await waitFor(async () => (await library("songs/s1")) == null, "chanson effacée");
    const fiche = await library(`medias/${COUV}`);
    assert.deepEqual([fiche.name, fiche.cat, fiche.tags], ["Aya Nakamura – Djadja", "Pochettes", "Aya Nakamura, Djadja"]);
    assert.match(await library(`images/${COUV}`), /^data:image\//);
    await page.click('#library-tabs [data-lib-tab="images"]');
    await page.click('#media-groups [data-groupe="pochettes"]');
    await page.locator(`.media-card[data-media="${COUV}"]`).waitFor();
    await waitFor(async () => await page.locator(`#media-list .media-card[data-media="${COUV}"]`, { hasText: "Utilisée dans" }).count() === 0, "plus utilisée nulle part, mais gardée");

    // Une pochette se retire de la rubrique (sans toucher la chanson) et se remet.
    await page.locator(`.media-card[data-media="${AUTRE}"]`).getByRole("button", { name: "Retirer" }).click();
    await page.locator("#media-note", { hasText: "« Le Roi lion – Hakuna Matata » est retirée" }).waitFor();
    await waitFor(async () => (await library(`medias/${AUTRE}`))?.hidden === true, "pochette retirée");
    assert.equal((await library(`medias/${AUTRE}`)).cat, "Pochettes");
    assert.equal((await library("songs/s2")).imageId, AUTRE, "la chanson garde sa pochette");
    await page.click('#media-cats [data-cat="retirees"]');
    await page.locator(`.media-card.retiree[data-media="${AUTRE}"]`).getByRole("button", { name: "Remettre" }).click();
    await waitFor(async () => (await library(`medias/${AUTRE}`))?.hidden === undefined, "pochette remise");
    await page.locator('#media-groups [data-groupe="miennes"]', { hasText: "⭐ Mes images (1)" }).waitFor();
    await page.context().close();
  });

  test("Sons (cedric, 22/10) : la liste est rangée par artiste de A à Z, puis par titre ; « Titre » la range par titre", async () => {
    const A = "0123456789abcdef";
    const chanson = (title, artist, n) => ({ title, ...(artist ? { artist } : {}), audioId: `${A.slice(0, 15)}${n}`, buzz: 30, updatedAt: 1 });
    await seedLibrary("songs", {
      a: chanson("Les sunlights des tropiques", "Gilbert Montagné", 1),
      b: chanson("Alexandrie Alexandra", "Claude François", 2),
      c: chanson("Zombie", "the Cranberries", 3),
      d: chanson("Sans artiste", "", 4),
      e: chanson("Belle", "Claude François", 5),
      f: chanson("Éléphant", "Bénabar", 6),
    });
    const page = await admin();
    // Sur le PC : l'en-tête des colonnes est visible.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="sons"]');
    await page.locator("#song-list .song-ligne").nth(5).waitFor();
    assert.deepEqual(await page.locator("#song-list .song-ligne .song-titre").allInnerTexts(),
      ["Éléphant", "Alexandrie Alexandra", "Belle", "Les sunlights des tropiques", "Zombie", "Sans artiste"]);
    await page.locator('#song-list .song-tri[data-tri="titre"]').click();
    assert.deepEqual(await page.locator("#song-list .song-ligne .song-titre").allInnerTexts(),
      ["Alexandrie Alexandra", "Belle", "Éléphant", "Les sunlights des tropiques", "Sans artiste", "Zombie"]);
    await page.locator('#song-list .song-tri[data-tri="artiste"]').click();
    assert.equal(await page.locator("#song-list .song-ligne .song-titre").first().innerText(), "Éléphant");
    await page.context().close();
  });

  test("Sons (cedric, 22/10) : toutes les chansons sont affichées, sans limite, et la recherche les filtre", async () => {
    const chansons = {};
    // 210 chansons, d'« Artiste 000 » à « Artiste 209 » : avant, la liste s'arrêtait aux 60 premières.
    for (let n = 0; n < 210; n++) {
      const k = String(n).padStart(3, "0");
      chansons[`s${k}`] = { title: `Chanson ${k}`, artist: `Artiste ${k}`, audioId: n.toString(16).padStart(16, "0"), buzz: 30, updatedAt: 1 };
    }
    await seedLibrary("songs", chansons);
    const page = await admin();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="sons"]');
    await page.locator("#song-list .song-ligne").nth(209).waitFor({ state: "attached" });
    assert.equal(await page.locator("#song-list .song-ligne").count(), 210);
    assert.equal(await page.locator("#song-list .song-ligne .song-titre").last().innerText(), "Chanson 209");
    assert.equal(await page.locator("#song-list", { hasText: "précisez la recherche" }).count(), 0);
    assert.equal(await page.locator("#song-count").innerText(), "210 chansons");
    // La recherche filtre en direct.
    await page.fill("#song-search", "Artiste 205");
    await page.waitForFunction(() => document.querySelectorAll("#song-list .song-ligne").length === 1);
    assert.equal(await page.locator("#song-list .song-ligne .song-titre").innerText(), "Chanson 205");
    assert.equal(await page.locator("#song-count").innerText(), "1 sur 210");
    await page.fill("#song-search", "");
    await page.waitForFunction(() => document.querySelectorAll("#song-list .song-ligne").length === 210);
    await page.context().close();
  });

  test("Sons (cedric, 23/10) : après « Enregistrer » ou « ← Retour », la liste revient sur la chanson réglée, même renommée ; 🗑 sur une ligne supprime cette chanson seule", async () => {
    const chansons = {};
    for (let n = 0; n < 60; n++) {
      const k = String(n).padStart(3, "0");
      chansons[`s${k}`] = { title: `Chanson ${k}`, artist: `Artiste ${k}`, audioId: n.toString(16).padStart(16, "0"), refrainId: (n + 100).toString(16).padStart(16, "0"), start: 0, refrain: 40, buzz: 30, updatedAt: 1 };
    }
    await seedLibrary("songs", chansons);
    const page = await admin();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="sons"]');
    await page.locator("#song-list .song-ligne").nth(59).waitFor({ state: "attached" });
    const ligne = (titre) => page.locator("#song-list .song-ligne", { hasText: titre });
    const haut = (titre) => ligne(titre).evaluate((e) => Math.round(e.getBoundingClientRect().top));
    const defilement = () => page.evaluate(() => window.scrollY);
    /** Ouvre les réglages de [titre] depuis le bas de la liste ; rend sa hauteur dans l'écran et le défilement. */
    const regler = async (titre) => {
      // La chanson au milieu de l'écran, loin du haut de la liste, et qui y reste un instant : centrée de nouveau si la
      // page n'a pas suivi (vu sur GitHub : la page restée tout en haut juste après l'ouverture de la liste).
      await page.waitForFunction((t) => {
        const e = [...document.querySelectorAll("#song-list .song-ligne")].find((x) => x.querySelector(".song-titre")?.textContent === t);
        if (!e || e.offsetParent === null) return false;
        if (window.scrollY > 300 && Math.abs(e.getBoundingClientRect().top + e.offsetHeight / 2 - window.innerHeight / 2) <= 40) return true;
        e.scrollIntoView({ block: "center" });
        return false;
      }, titre, { polling: 250, timeout: 15000 });
      const avant = { haut: await haut(titre), defilement: await defilement() };
      const etat = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, lignes: document.querySelectorAll("#song-list .song-ligne").length, ecran: [...document.querySelectorAll(".screen")].find((e) => !e.hidden)?.id, dialogue: !!document.querySelector("dialog[open]") }));
      assert.ok(avant.defilement > 300, `${titre} est loin du haut de la liste : ${JSON.stringify({ ...avant, ...etat })}`);
      await ligne(titre).getByRole("button", { name: "⏱ Réglé ✓" }).click();
      await page.locator("#playlist-edit-title", { hasText: `Réglages de « ${titre} »` }).waitFor();
      await page.locator(".track.reglage").waitFor();
      return avant;
    };

    // « Enregistrer » : la liste revient là où était la chanson (avant : tout en haut), et l'éclaire un instant.
    let avant = await regler("Chanson 045");
    await page.click("#playlist-save");
    await page.locator("#song-status", { hasText: "Réglages de « Chanson 045 » enregistrés." }).waitFor({ timeout: 30000 });
    await page.locator("#library-sons:not([hidden])").waitFor();
    await ligne("Chanson 045").waitFor();
    // (Le message « enregistrés » s'affiche au-dessus de la liste : c'est la chanson qui reste à sa place.)
    assert.ok(Math.abs((await haut("Chanson 045")) - avant.haut) <= 4, "même hauteur dans l'écran");
    assert.ok((await defilement()) > avant.defilement - 4, "pas remontée en haut");

    // Renommée (son artiste la range plus bas) : la liste la suit à sa nouvelle place, à la même hauteur dans l'écran.
    avant = await regler("Chanson 030");
    await page.locator(".track.reglage input[aria-label=Artiste]").fill("Artiste 055 bis");
    await page.click("#playlist-save");
    await page.locator("#song-status", { hasText: "Réglages de « Chanson 030 » enregistrés." }).waitFor({ timeout: 30000 });
    await waitFor(async () => (await library("songs/s030")).artist === "Artiste 055 bis", "artiste renommé");
    await page.waitForFunction(() => [...document.querySelectorAll("#song-list .song-ligne .song-titre")].findIndex((e) => e.textContent === "Chanson 030") === 55);
    await page.waitForFunction((h) => {
      const e = [...document.querySelectorAll("#song-list .song-ligne")].find((x) => x.querySelector(".song-titre").textContent === "Chanson 030");
      return Math.abs(e.getBoundingClientRect().top - h) <= 4;
    }, avant.haut);
    assert.ok((await defilement()) > avant.defilement + 500, "la liste a suivi la chanson plus bas");

    // « ← Retour » sans rien changer : pareil.
    avant = await regler("Chanson 012");
    await page.locator("#screen-playlist-edit .retour-barre.haut").getByRole("button", { name: "← Retour" }).click();
    await page.locator("#library-sons:not([hidden])").waitFor();
    await page.waitForFunction((d) => Math.abs(window.scrollY - d) <= 4, avant.defilement);
    assert.ok(Math.abs((await haut("Chanson 012")) - avant.haut) <= 4);

    // 🗑 sur une ligne : cette chanson seule (après confirmation) ; la chanson cochée reste cochée.
    await ligne("Chanson 001").locator(".song-check").check();
    await page.locator("#song-barre", { hasText: "1 sélectionnée" }).waitFor();
    let question = repondreFenetre(page, { accepter: false });
    await ligne("Chanson 010").getByRole("button", { name: "Supprimer « Chanson 010 »" }).click();
    assert.match(await question, /^Supprimer « Chanson 010 » de la bibliothèque des sons \?\n\nLes playlists déjà faites les gardent\./);
    assert.equal((await library("songs/s010")).retiree, undefined, "rien n'est supprimé sans confirmation");
    question = repondreFenetre(page);
    await ligne("Chanson 010").getByRole("button", { name: "Supprimer « Chanson 010 »" }).click();
    await question;
    await page.locator("#song-status", { hasText: "« Chanson 010 » est supprimée de la bibliothèque." }).waitFor();
    await waitFor(async () => (await library("songs/s010")).retiree === true, "Chanson 010 supprimée");
    const reste = await library("songs");
    assert.deepEqual(Object.keys(reste).filter((k) => reste[k].retiree), ["s010"], "les autres chansons restent");
    await page.waitForFunction(() => document.querySelectorAll("#song-list .song-ligne").length === 59);
    await page.locator("#song-barre", { hasText: "1 sélectionnée" }).waitFor();
    assert.equal(await ligne("Chanson 001").locator(".song-check").isChecked(), true);
    await page.context().close();
  });

  test("Sons (cedric, 22/10) : des paroles mises par erreur se retirent (✕ sur la ligne, ou plusieurs chansons cochées) ; les playlists suivent", async () => {
    const A = "0123456789abcdef";
    const B = "fedcba9876543210";
    const C = "00112233445566ff";
    const chanson = (title, artist, audioId) => ({ title, artist, audioId, refrainId: C, refrain: 40, buzz: 30, lrc: true, paroles: "40000|La la", updatedAt: 1 });
    await seedLibrary("songs", { s1: chanson("Belle", "Claude François", A), s2: chanson("Zombie", "The Cranberries", B), s3: { title: "Sans paroles", audioId: C, buzz: 30, updatedAt: 1 } });
    await seedLibrary("lyrics", { s1: "[00:40.00]La la", s2: "[00:40.00]La la" });
    await seedLibrary("playlists", { p1: { title: "Années 70", duration: 30, tracks: [{ title: "Belle", artist: "Claude François", audioId: A, songId: "s1", refrainId: C, paroles: "40000|La la" }], updatedAt: 1 } });
    const page = await admin();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="sons"]');
    const belle = page.locator("#song-list .song-ligne", { hasText: "Belle" });
    await belle.locator(".song-paroles.ok").waitFor();
    assert.equal(await page.locator("#song-list .song-ligne", { hasText: "Sans paroles" }).locator(".song-paroles-retirer").count(), 0);
    let question = repondreFenetre(page, { accepter: false });
    await belle.getByRole("button", { name: "Retirer les paroles de « Belle »" }).click();
    assert.match(await question, /^Retirer les paroles de « Belle » \?/);
    assert.equal((await library("songs/s1")).lrc, true, "rien n'est retiré sans confirmation");
    question = repondreFenetre(page);
    await belle.getByRole("button", { name: "Retirer les paroles de « Belle »" }).click();
    await question;
    await page.locator("#song-status", { hasText: "Paroles de « Belle » retirées." }).waitFor();
    await belle.locator(".song-paroles:not(.ok)", { hasText: "＋ Paroles (.lrc)" }).waitFor();
    const s1 = await library("songs/s1");
    assert.deepEqual([s1.lrc, s1.paroles, s1.audioId, s1.refrain], [undefined, undefined, A, 40], "le reste de la chanson ne bouge pas");
    assert.equal(await library("lyrics/s1"), null);
    await waitFor(async () => (await library("playlists/p1/tracks/0")).paroles === undefined, "la playlist suit");
    // Plusieurs chansons cochées : « Retirer les paroles (n) ».
    await page.locator("#song-list .song-ligne", { hasText: "Zombie" }).locator(".song-check").check();
    question = repondreFenetre(page);
    await page.locator("#song-barre").getByRole("button", { name: "Retirer les paroles (1)" }).click();
    assert.match(await question, /^Retirer les paroles de « Zombie » \?/);
    await waitFor(async () => (await library("songs/s2")).lrc === undefined && (await library("lyrics/s2")) == null, "paroles de Zombie retirées");
    await page.context().close();
  });

  test("Sons : une ligne par chanson ; cocher (un, Maj + clic, Ctrl + A) puis « Supprimer » (les playlists les gardent) et les remettre ; « ← Retour » sur la page d'un jeu", async () => {
    const A = "0123456789abcdef";
    const B = "fedcba9876543210";
    await seedLibrary("songs", { s1: { title: "Hakuna Matata", artist: "Le Roi lion", audioId: A, refrainId: B, refrain: 61, start: 12, buzz: 30, updatedAt: 1 } });
    await seedLibrary("playlists", {
      p1: { title: "Disney", duration: 30, tracks: [{ title: "Hakuna Matata", audioId: A, songId: "s1" }, { title: "Libérée, délivrée", audioId: B }], updatedAt: 1 },
      "test-lea-tous-les-jeux-comptines": { title: "TEST – Comptines", duration: 20, tracks: [{ title: "Frère Jacques", audioId: "1111111111111111" }], updatedAt: 1 },
    });
    const page = await admin();
    // Page d'un jeu ouverte depuis l'Accueil : « ← Retour » en haut et en bas y ramène.
    await openGamePage(page, "coffres");
    assert.deepEqual(await page.locator("#screen-game .retour-barre.haut button").allInnerTexts(), ["← Retour"]);
    await page.locator("#screen-game .retour-barre.bas .retour-page").click();
    await page.locator("#screen-home:not([hidden])").waitFor();

    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="sons"]');
    const hakuna = page.locator("#song-list .song-ligne", { hasText: "Hakuna Matata" });
    const liberee = page.locator("#song-list .song-ligne", { hasText: "Libérée, délivrée" });
    // De gauche à droite : case, pochette (vide : à cliquer), artiste, titre, paroles, moments ; ni pochette ni
    // paroles : signalé en rouge.
    await hakuna.locator(".song-pochette.vide").waitFor();
    // Les comptines de la prestation de test ne sont pas dans la bibliothèque (cedric, 22/10).
    assert.equal(await page.locator("#song-list .song-ligne", { hasText: "Frère Jacques" }).count(), 0);
    assert.equal(await hakuna.locator(".song-artiste").innerText(), "Le Roi lion");
    assert.equal(await hakuna.locator(".song-paroles").innerText(), "＋ Paroles (.lrc)");
    assert.equal(await hakuna.locator(".song-alerte").count(), 1);
    // Plus de bouton « Régler… » : « ⏱ Réglé ✓ » ouvre les réglages. Sans chanson entière en ligne (rangée avant le
    // 21/10), les curseurs attendent son MP3 ; le titre se renomme déjà, et la playlist suit.
    assert.equal(await hakuna.getByRole("button", { name: "Régler…" }).count(), 0);
    await hakuna.getByRole("button", { name: "⏱ Réglé ✓" }).click();
    await page.locator("#playlist-edit-title", { hasText: "Réglages de « Hakuna Matata »" }).waitFor();
    const reglage = page.locator(".track.reglage");
    await reglage.locator(".reglage-manque", { hasText: "Les curseurs attendent la chanson entière" }).waitFor();
    await capture(page, "reglage-sans-chanson-entiere");
    assert.deepEqual(await reglage.locator(".reglage-temps").allInnerTexts(), ["0:12", "1:01"]);
    assert.equal(await reglage.locator(".reglage-origine").innerText(), "réglé à la main");
    assert.equal(await reglage.locator('input[aria-label="Début de la chanson"]').isDisabled(), true);
    assert.equal(await reglage.locator('input[aria-label="Hook"]').isDisabled(), true);
    await reglage.locator("input[aria-label=Titre]").fill("Hakuna Matata !");
    await page.click("#playlist-save");
    // Enregistrer ramène à la liste des sons, comme « ← Retour » (cedric, 22/10).
    await page.locator("#song-status", { hasText: "Réglages de « Hakuna Matata ! » enregistrés." }).waitFor({ timeout: 30000 });
    await page.locator("#library-sons:not([hidden])").waitFor();
    await waitFor(async () => (await library("songs/s1")).title === "Hakuna Matata !" && (await library("playlists/p1")).tracks[0].title === "Hakuna Matata !", "titre renommé, la playlist suit");
    assert.deepEqual([(await library("songs/s1")).start, (await library("songs/s1")).refrain, (await library("songs/s1")).audioId], [12, 61, A]);
    // Une case, puis Maj + clic : toutes les chansons entre les deux ; « Désélectionner ».
    await hakuna.locator(".song-check").click();
    await page.locator("#song-barre", { hasText: "1 sélectionnée" }).waitFor();
    await liberee.locator(".song-check").click({ modifiers: ["Shift"] });
    await page.locator("#song-barre", { hasText: "2 sélectionnées" }).waitFor();
    await page.locator("#song-barre").getByRole("button", { name: "Désélectionner" }).click();
    await page.locator("#song-barre", { hasText: "Tout sélectionner" }).waitFor();
    // Supprimer demande d'abord ; « Annuler » ne touche à rien.
    await hakuna.locator(".song-check").click();
    let question = repondreFenetre(page, { accepter: false });
    await page.locator("#song-barre").getByRole("button", { name: "🗑 Supprimer (1)" }).click();
    assert.match(await question, /^Supprimer « Hakuna Matata ! » de la bibliothèque des sons \?\n\nLes playlists déjà faites les gardent\./);
    assert.equal((await library("songs/s1")).retiree, undefined);
    // Ctrl + A coche toute la bibliothèque : l'avertissement le dit clairement ; la touche Suppr supprime.
    await page.keyboard.press("Control+a");
    await page.locator("#song-barre", { hasText: "2 sélectionnées" }).waitFor();
    question = repondreFenetre(page);
    await page.keyboard.press("Delete");
    assert.match(await question, /^Attention : cette action va supprimer tous les morceaux de votre bibliothèque \(2 chansons\)\./);
    await page.locator("#song-list", { hasText: "Toutes vos chansons sont supprimées" }).waitFor();
    assert.equal((await library("songs/s1")).retiree, true);
    assert.equal((await library("playlists/p1")).tracks.length, 2, "la playlist garde ses morceaux");
    // Un ancien morceau de playlist pas encore rangé : il est rangé dans la bibliothèque, supprimé.
    const rangee = Object.values(await library("songs")).find((s) => s.audioId === B);
    assert.deepEqual([rangee.title, rangee.retiree], ["Libérée, délivrée", true]);
    // « 🗑 Supprimées » : on les remet.
    await page.locator("#song-retirees", { hasText: "🗑 Supprimées (2)" }).click();
    await page.locator("#song-list .song", { hasText: "Hakuna Matata" }).getByRole("button", { name: "Remettre" }).click();
    await waitFor(async () => (await library("songs/s1")).retiree === undefined, "chanson remise");
    await page.click("#song-retirees");
    await page.locator("#song-list .song", { hasText: "Hakuna Matata" }).getByRole("button", { name: "⏱ Réglé ✓" }).waitFor();
    assert.equal(await page.locator("#song-list .song", { hasText: "Libérée" }).count(), 0);

    // « Effacer pour de bon » (cedric, 21/10) : depuis « 🗑 Supprimées », après confirmation ; la chanson, sa chanson
    // entière, ses paroles et ses extraits sont effacés en ligne, sauf un extrait qu'une playlist ou une chanson utilise.
    const C = "00112233445566ff";
    for (const x of [A, B, C]) await seedLibrary(`sounds/${x}`, "data:audio/mpeg;base64,SUQz");
    await seedLibrary("songs/s3", { title: "Vieille chanson", audioId: C, buzz: 30, retiree: true, updatedAt: 1 });
    await seedLibrary("entieres/s3", { n: 1, kbps: 96, length: 60, at: 1, p: ["SUQz"] });
    await seedLibrary("lyrics/s3", "[00:01.00]La la");
    await page.locator("#song-retirees", { hasText: "🗑 Supprimées (2)" }).click();
    await page.locator("#song-list .song-effacer-tout").getByRole("button", { name: "Tout effacer pour de bon (2)" }).waitFor();
    await capture(page, "sons-supprimees");
    question = repondreFenetre(page, { accepter: false });
    await page.locator("#song-list .song", { hasText: "Vieille chanson" }).getByRole("button", { name: "Effacer pour de bon" }).click();
    assert.match(await question, /^Effacer « Vieille chanson » pour de bon \?\n\nLa chanson entière, les paroles et les extraits sont effacés en ligne/);
    assert.equal((await library("songs/s3")).title, "Vieille chanson", "rien n'est effacé sans confirmation");
    question = repondreFenetre(page);
    await page.locator("#song-list .song", { hasText: "Vieille chanson" }).getByRole("button", { name: "Effacer pour de bon" }).click();
    await question;
    await page.locator("#song-status", { hasText: "« Vieille chanson » est effacée pour de bon." }).waitFor();
    await waitFor(async () => (await library("songs/s3")) == null, "chanson effacée");
    assert.deepEqual([await library("entieres/s3"), await library("lyrics/s3"), await library(`sounds/${C}`)], [null, null, null]);
    // « Libérée, délivrée » effacée : son extrait reste, la playlist « Disney » et Hakuna Matata (son refrain) s'en servent.
    const [rangeeId] = Object.entries(await library("songs")).find(([, s]) => s.audioId === B);
    question = repondreFenetre(page);
    await page.locator("#song-list .song", { hasText: "Libérée" }).getByRole("button", { name: "Effacer pour de bon" }).click();
    await question;
    await waitFor(async () => !Object.values((await library("songs")) ?? {}).some((x) => x.title === "Libérée, délivrée"), "chanson effacée");
    assert.ok(await library(`sounds/${B}`), "extrait encore utilisé : gardé");
    assert.ok(await library(`sounds/${A}`), "extrait d'une chanson gardée : gardé");
    assert.equal((await library("playlists/p1")).tracks.length, 2);
    // Elle ne revient pas dans la liste (cedric, 22/10) : le morceau gardé par « Disney » reçoit son numéro de chanson.
    assert.deepEqual((await library("playlists/p1")).tracks[1], { title: "Libérée, délivrée", audioId: B, songId: rangeeId });
    await page.locator("#song-list .song", { hasText: "Hakuna Matata" }).getByRole("button", { name: "⏱ Réglé ✓" }).waitFor();
    assert.equal(await page.locator("#song-list .song", { hasText: "Libérée" }).count(), 0);
    assert.equal(await page.locator("#song-retirees").isHidden(), true);
    await page.context().close();
  });

  test("Sons : MP3 et .lrc sélectionnés ensemble se rangent seuls ; refrain deviné par les paroles, paroles du refrain gardées ; un .lrc ajouté plus tard ; la pochette se choisit", async () => {
    const LRC = ["[00:05.00]Premier couplet ici", "[00:10.00]La suite du couplet", "[00:20.00]On chante tous ensemble", "[00:24.00]Tous ensemble ce soir",
      "[00:30.00]Deuxième couplet", "[00:40.00]On chante tous ensemble", "[00:44.00]Tous ensemble ce soir"].join("\n");
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="sons"]');
    await page.setInputFiles("#song-files", [
      { name: "Les Licornes - On chante.wav", mimeType: "audio/wav", buffer: wav(440, 60) },
      { name: "Les Licornes_On chante.lrc", mimeType: "text/plain", buffer: Buffer.from(LRC) },
      { name: "Les Dragons - Instrumental.wav", mimeType: "audio/wav", buffer: wav(330, 40) },
    ]);
    // Tout se range seul (cedric, 21/10 : rien à cliquer de plus) ; la liste des sons revient avec le bilan.
    await page.locator("#song-status", { hasText: "2 fichiers musicaux lus · paroles de 1 chanson. Bibliothèque à jour : 2 chansons rangées." }).waitFor({ timeout: 60000 });
    assert.equal(await page.locator("#screen-library").isVisible(), true);
    const songs = await library("songs");
    const [id, song] = Object.entries(songs).find(([, x]) => x.title === "On chante");
    // Le refrain proposé : la phrase la plus répétée (20 s), une seconde avant ; le début, 2 s avant les premiers mots
    // chantés (5 s), et 0:00 sans paroles.
    assert.deepEqual([song.artist, song.refrain, song.lrc, song.auto, song.start, song.length], ["Les Licornes", 19, true, true, 3, 60]);
    assert.equal(song.paroles.split("\n")[0], "1000|On chante tous ensemble");
    assert.equal(await library(`lyrics/${id}`), LRC);
    const [idInstru, instru] = Object.entries(songs).find(([, x]) => x.title === "Instrumental");
    assert.deepEqual([instru.lrc, instru.start], [undefined, 0]);
    // Les chansons entières sont rangées en ligne (cedric, 21/10), pour les régler depuis n'importe quel PC.
    for (const x of [id, idInstru]) {
      const entiere = await library(`entieres/${x}`);
      assert.deepEqual([entiere.kbps, Object.values(entiere.p).length], [96, entiere.n]);
    }
    assert.equal((await library(`entieres/${id}`)).length, 60);

    // La bibliothèque : paroles ✓ ; la chanson est réglée d'office (cedric, 21/10), son hook trouvé automatiquement ;
    // l'instrumental signalé (ni pochette ni paroles).
    const ligne = page.locator("#song-list .song-ligne", { hasText: "On chante" });
    await ligne.locator(".song-paroles.ok", { hasText: "✓ Paroles" }).waitFor();
    await capture(page, "sons-liste");
    if (process.env.CAPTURES) {
      const taille = page.viewportSize();
      await page.setViewportSize({ width: 1366, height: 900 });
      await capture(page, "sons-liste-pc");
      await page.setViewportSize(taille);
    }
    // « ⏱ Réglé ✓ » ouvre les réglages : pochette, titre, artiste et deux curseurs sur toute la chanson, sans rechoisir
    // le fichier. Le hook déplacé : la chanson est réglée à la main, ses paroles suivent le nouveau hook.
    await ligne.getByRole("button", { name: "⏱ Réglé ✓" }).click();
    await page.locator("#playlist-edit-title", { hasText: "Réglages de « On chante »" }).waitFor();
    const reglage = page.locator(".track.reglage");
    const debut = reglage.locator('input[aria-label="Début de la chanson"]');
    const hook = reglage.locator('input[aria-label="Hook"]');
    await reglage.locator('input[aria-label="Hook"]:not([disabled])').waitFor();
    assert.equal(await reglage.locator(".reglage-manque").count(), 0);
    assert.deepEqual([await reglage.locator("input[aria-label=Titre]").inputValue(), await reglage.locator("input[aria-label=Artiste]").inputValue()], ["On chante", "Les Licornes"]);
    assert.deepEqual([await debut.inputValue(), await debut.getAttribute("max"), await hook.inputValue(), await hook.getAttribute("max")], ["3", "30", "19", "50"]);
    assert.equal(await reglage.locator(".reglage-origine").innerText(), "trouvé automatiquement");
    assert.deepEqual(await reglage.locator(".reglage-bornes").allInnerTexts(), ["0:00\n0:30", "0:00\n0:50"]);
    await capture(page, "reglage-chanson");
    if (process.env.CAPTURES) {
      const taille = page.viewportSize();
      await page.setViewportSize({ width: 1366, height: 900 });
      await capture(page, "reglage-chanson-pc");
      await page.setViewportSize(taille);
    }
    await hook.fill("30");
    assert.deepEqual([await reglage.locator(".reglage-temps").nth(1).innerText(), await reglage.locator(".reglage-origine").innerText()], ["0:30", "réglé à la main"]);
    await reglage.locator("input[aria-label=Titre]").fill("On chante fort");
    await page.click("#playlist-save");
    await page.locator("#song-status", { hasText: "Réglages de « On chante fort » enregistrés." }).waitFor({ timeout: 30000 });
    await waitFor(async () => (await library(`songs/${id}`)).refrain === 30, "hook réglé à la main");
    const reglee = await library(`songs/${id}`);
    assert.deepEqual([reglee.title, reglee.auto, reglee.start, reglee.audioId], ["On chante fort", undefined, 3, song.audioId], "début inchangé : même extrait du buzz");
    assert.notEqual(reglee.refrainId, song.refrainId);
    assert.equal(reglee.paroles.split("\n")[0], "0|Deuxième couplet");
    await page.context().close();

    // Depuis un autre PC : la chanson entière est téléchargée, les curseurs marchent. « ↺ Réidentifier le hook » le
    // retrouve dans les paroles et recale le début de l'extrait.
    const autre = await admin();
    await autre.click("#nav button[data-screen=library]");
    await autre.click('#library-tabs [data-lib-tab="sons"]');
    await autre.locator("#song-list .song-ligne", { hasText: "On chante fort" }).getByRole("button", { name: "⏱ Réglé ✓" }).click();
    const ailleurs = autre.locator(".track.reglage");
    await ailleurs.locator('input[aria-label="Hook"]:not([disabled])').waitFor({ timeout: 30000 });
    assert.equal(await ailleurs.locator('input[aria-label="Hook"]').inputValue(), "30");
    await ailleurs.locator('input[aria-label="Début de la chanson"]').fill("8");
    assert.equal(await ailleurs.locator(".reglage-temps").first().innerText(), "0:08");
    assert.equal(await ailleurs.locator(".reglage-origine").innerText(), "réglé à la main");
    await ailleurs.getByRole("button", { name: "↺ Réidentifier le hook" }).click();
    await ailleurs.locator(".reglage-origine", { hasText: "trouvé automatiquement" }).waitFor();
    assert.deepEqual([await ailleurs.locator('input[aria-label="Hook"]').inputValue(), await ailleurs.locator('input[aria-label="Début de la chanson"]').inputValue()], ["19", "3"]);
    await autre.click("#playlist-save");
    await autre.locator("#song-status", { hasText: "Réglages de « On chante fort » enregistrés." }).waitFor({ timeout: 30000 });
    await waitFor(async () => (await library(`songs/${id}`)).refrain === 19, "hook retrouvé");
    assert.equal((await library(`songs/${id}`)).auto, true);
    assert.equal((await library(`songs/${id}`)).paroles.split("\n")[0], "1000|On chante tous ensemble");
    // Rouverte, le début déplacé à la main, puis enregistré : un nouvel extrait du buzz.
    await autre.locator("#song-list .song-ligne", { hasText: "On chante fort" }).getByRole("button", { name: "⏱ Réglé ✓" }).click();
    await ailleurs.locator('input[aria-label="Début de la chanson"]:not([disabled])').waitFor({ timeout: 30000 });
    await ailleurs.locator('input[aria-label="Début de la chanson"]').fill("10");
    await autre.click("#playlist-save");
    await waitFor(async () => (await library(`songs/${id}`)).start === 10, "début réglé à la main");
    assert.notEqual((await library(`songs/${id}`)).audioId, song.audioId);
    assert.equal((await library(`songs/${id}`)).refrain, 19);
    await autre.locator("#library-sons:not([hidden])").waitFor();
    const ligneInstru = autre.locator("#song-list .song-ligne", { hasText: "Instrumental" });
    await ligneInstru.locator(".song-alerte").waitFor();
    // Un .lrc ajouté plus tard, en cliquant dans la case des paroles.
    await ligneInstru.locator(".song-paroles input[type=file]").setInputFiles({ name: "instrumental.lrc", mimeType: "text/plain", buffer: Buffer.from("[00:01.00]La la la\n[00:15.00]Encore") });
    await autre.locator("#song-status", { hasText: "Paroles de « Instrumental » enregistrées." }).waitFor();
    await waitFor(async () => (await library(`songs/${idInstru}`)).lrc === true, "paroles ajoutées");
    assert.match(await library(`lyrics/${idInstru}`), /La la la/);
    // La pochette se choisit en cliquant sur la case vide ; l'alerte rouge disparaît.
    await ligneInstru.locator(".song-pochette input[type=file]").setInputFiles({ name: "pochette.png", mimeType: "image/png", buffer: png([200, 80, 160]) });
    await waitFor(async () => /^[0-9a-f]{16}$/.test((await library(`songs/${idInstru}`)).imageId ?? ""), "pochette enregistrée");
    await ligneInstru.locator(".song-pochette img").waitFor();
    assert.equal(await ligneInstru.locator(".song-alerte").count(), 0);
    await autre.context().close();
  });

  test("Sons : toute la bibliothèque d'un coup ; un fichier illisible laissé de côté, les chansons déjà là pas redécoupées ; « 🎲 10 au hasard » dans une playlist", async () => {
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="sons"]');
    const avant = Object.keys((await library("songs")) ?? {}).length;
    await page.setInputFiles("#song-files", [
      { name: "Les Comètes - Premier.wav", mimeType: "audio/wav", buffer: wav(392, 40) },
      { name: "Les Pirates - Abîmé.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("pas une musique du tout") },
      { name: "Les Ninjas - Deuxième.wav", mimeType: "audio/wav", buffer: wav(294, 40) },
    ]);
    await page.locator("#song-status", { hasText: "Bibliothèque à jour : 2 chansons rangées. Un fichier illisible laissé de côté" }).waitFor({ timeout: 60000 });
    await page.locator("#song-status", { hasText: "« Abîmé »" }).waitFor();
    let songs = await library("songs");
    assert.equal(Object.keys(songs).length, avant + 2);
    const premier = Object.values(songs).find((x) => x.title === "Premier");
    assert.match(premier.refrainId, /^[0-9a-f]{16}$/);
    // Redéposée avec son .lrc : rien n'est redécoupé, les paroles s'ajoutent à la chanson déjà rangée.
    await page.setInputFiles("#song-files", [
      { name: "Les Comètes - Premier.wav", mimeType: "audio/wav", buffer: wav(392, 40) },
      { name: "Les Comètes_Premier.lrc", mimeType: "text/plain", buffer: Buffer.from("[00:02.00]Un deux trois\n[00:20.00]Soleil") },
    ]);
    await page.locator("#song-status", { hasText: "1 fichier musical lu · paroles de 1 chanson · 1 chanson déjà dans la bibliothèque." }).waitFor({ timeout: 30000 });
    songs = await library("songs");
    assert.equal(Object.keys(songs).length, avant + 2);
    const encore = Object.values(songs).find((x) => x.title === "Premier");
    assert.deepEqual([encore.audioId, encore.refrainId, encore.lrc], [premier.audioId, premier.refrainId, true]);

    // Une playlist du blind test : « 🎲 10 au hasard » pioche dans la bibliothèque (ici, moins de 10 chansons).
    await page.click("#nav button[data-screen=home]");
    await page.click(".tile[data-screen=music]");
    await page.click("#game-tabs [data-tab=collections]");
    await page.click("#playlist-new");
    await page.fill("#playlist-title", "Blind test démo");
    await page.click("#playlist-hasard");
    const tirees = avant + 2;
    await page.locator("#playlist-status", { hasText: `${tirees} chansons tirées au hasard dans la bibliothèque` }).waitFor();
    assert.equal(await page.locator(".track").count(), tirees);
    // Une seconde fois : toutes sont déjà dedans.
    await page.click("#playlist-hasard");
    await page.locator("#playlist-status", { hasText: "Toutes les chansons de la bibliothèque sont déjà dans la playlist." }).waitFor();
    await page.click("#playlist-save");
    await page.locator("#playlist-status", { hasText: `Enregistrée : ${tirees} morceaux` }).waitFor({ timeout: 30000 });
    const liste = Object.values(await library("playlists")).find((p) => p.title === "Blind test démo");
    assert.equal(Object.values(liste.tracks).length, tirees);
    assert.ok(Object.values(liste.tracks).some((t) => t.title === "Premier" && /^[0-9a-f]{16}$/.test(t.refrainId)));
    assert.match(Object.values(liste.tracks).find((t) => t.title === "Premier").paroles, /Un deux trois/);
    // Rouverte puis réenregistrée : ses morceaux gardent leurs paroles ; chaque morceau a les curseurs du début et du
    // hook (ses chansons entières sont sur ce PC), avec « ↺ Réidentifier le hook ».
    await page.click("#nav button[data-screen=home]");
    await page.click(".tile[data-screen=music]");
    await page.click("#game-tabs [data-tab=collections]");
    await page.locator("#playlist-list .item", { hasText: "Blind test démo" }).getByRole("button", { name: "Éditer" }).click();
    await page.locator('.track-refrain input[aria-label="Moment du refrain"]').nth(tirees - 1).waitFor();
    assert.equal(await page.locator(".track-refrain button", { hasText: "↺ Réidentifier le hook" }).count(), tirees);
    await page.click("#playlist-save");
    await page.locator("#playlist-status", { hasText: `Enregistrée : ${tirees} morceaux` }).waitFor({ timeout: 30000 });
    await waitFor(async () => {
      const p = Object.values(await library("playlists")).find((x) => x.title === "Blind test démo");
      return /Un deux trois/.test(Object.values(p.tracks).find((t) => t.title === "Premier").paroles ?? "") && p.updatedAt > liste.updatedAt;
    }, "paroles gardées");
    await page.context().close();

    // Depuis un autre PC, sans les chansons : « ⏱ Changer le réglage » télécharge la chanson entière, puis les curseurs.
    const autre = await admin();
    await autre.click(".tile[data-screen=music]");
    await autre.click("#game-tabs [data-tab=collections]");
    await autre.locator("#playlist-list .item", { hasText: "Blind test démo" }).getByRole("button", { name: "Éditer" }).click();
    const morceau = autre.locator(".track").first();
    await morceau.locator(".track-refrain .ok", { hasText: /^Hook réglé ✓ à \d:\d\d \(trouvé automatiquement\)$/ }).waitFor();
    assert.equal(await autre.locator('.track-refrain input[aria-label="Moment du refrain"]').count(), 0);
    await morceau.getByRole("button", { name: "⏱ Changer le réglage" }).click();
    await morceau.locator('.track-refrain input[aria-label="Moment du refrain"]').waitFor({ timeout: 30000 });
    await autre.context().close();
  });

  test("Sons (cedric, 22/10) : aucun temps pour buzzer à régler ; un fichier qui ne répond plus est laissé de côté, l'import continue", async () => {
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="sons"]');
    // « Coincé » : le navigateur ne rend jamais ni sa durée ni son contenu (ni réponse ni erreur). Délais raccourcis.
    await page.evaluate(() => {
      globalThis.lmpDelaisImport = 0.05;
      const coince = (b) => typeof b?.name === "string" && b.name.includes("Coincé");
      const lire = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function () { return coince(this) ? new Promise(() => {}) : lire.call(this); };
      const muets = new Set();
      const creer = URL.createObjectURL;
      URL.createObjectURL = (b) => { const u = creer(b); if (coince(b)) muets.add(u); return u; };
      const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
      Object.defineProperty(HTMLMediaElement.prototype, "src", { ...src, set(u) { if (!muets.has(u)) src.set.call(this, u); } });
    });
    await page.setInputFiles("#song-files", [
      { name: "Les Bloqués - Coincé.wav", mimeType: "audio/wav", buffer: wav(392, 40) },
      { name: "Les Libres - Passe partout.wav", mimeType: "audio/wav", buffer: wav(294, 40) },
      { name: "Les Libres - Encore.wav", mimeType: "audio/wav", buffer: wav(330, 40) },
    ]);
    await page.locator("#song-status", { hasText: "Bibliothèque à jour : 2 chansons rangées. Un fichier illisible laissé de côté" }).waitFor({ timeout: 60000 });
    await page.locator("#song-status", { hasText: "« Coincé »" }).waitFor();
    const songs = Object.values(await library("songs"));
    assert.ok(["Passe partout", "Encore"].every((x) => songs.some((y) => y.title === x)));
    assert.ok(!songs.some((y) => y.title === "Coincé"));
    assert.equal(await page.locator("#playlist-duration").evaluate((e) => e.closest(".panel").hidden), true, "pas de temps pour buzzer dans la bibliothèque");
    // « ⏱ Réglé ✓ » : le début et le hook, sans temps pour buzzer.
    await page.locator("#song-list .song", { hasText: "Passe partout" }).getByRole("button", { name: "⏱ Réglé ✓" }).click();
    await page.locator(".reglage-curseur").first().waitFor();
    assert.equal(await page.locator(".track-duration").count(), 0);
    assert.doesNotMatch(await page.locator("#screen-playlist-edit").innerText(), /buzzer/);
    await page.context().close();
  });

  test("Sons : une chanson réglée avant le 21/10 (début au tiers) redéposée revient au nouveau début, avec sa chanson entière", async () => {
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="sons"]');
    // Rangée le matin du 21/10 : début proposé au tiers du morceau (40 s : 10 s, pour 30 s à buzzer), pas de chanson entière.
    await page.setInputFiles("#song-files", [{ name: "Les Anciens - Vieux.wav", mimeType: "audio/wav", buffer: wav(392, 40) }]);
    await page.locator("#song-status", { hasText: "Bibliothèque à jour : 1 chanson rangée." }).waitFor({ timeout: 60000 });
    const [id, neuve] = Object.entries(await library("songs")).find(([, x]) => x.title === "Vieux");
    await env.withSecurityRulesDisabled(async (ctx) => {
      const d = ctx.database();
      await set(ref(d, `library/songs/${id}/start`), 10);
      await set(ref(d, `library/entieres/${id}`), null);
    });
    await page.locator("#song-list .song-ligne", { hasText: "Vieux" }).getByRole("button", { name: "⏱ Réglé ✓" }).waitFor();
    await page.setInputFiles("#song-files", [{ name: "Les Anciens - Vieux.wav", mimeType: "audio/wav", buffer: wav(392, 40) }]);
    await page.locator("#song-status", { hasText: "1 chanson au nouveau début" }).waitFor({ timeout: 60000 });
    await waitFor(async () => (await library(`songs/${id}`)).start === 0, "début remis à 0:00");
    const apres = await library(`songs/${id}`);
    assert.equal(apres.refrainId, neuve.refrainId, "hook inchangé : pas redécoupé");
    assert.equal(apres.auto, true);
    assert.equal((await library(`entieres/${id}`)).kbps, 96);
    // Redéposée encore : rien à refaire.
    await page.setInputFiles("#song-files", [{ name: "Les Anciens - Vieux.wav", mimeType: "audio/wav", buffer: wav(392, 40) }]);
    await page.locator("#song-status", { hasText: "1 chanson déjà dans la bibliothèque" }).waitFor({ timeout: 60000 });
    await page.context().close();
  });

  test("Sons (cedric, 21/10) : le hook vise le refrain là où la musique explose ; « ☁ » et compteur sans chanson entière en ligne ; « ▶ » devient « ⏸ Pause »", async () => {
    // « Ça explose » : couplet calme, refrain chanté à 30 et 70 s mais la musique n'explose qu'à 36 et 76 s.
    const LRC = ["[00:08.00]Premier couplet tout doux", "[00:12.00]La suite du couplet",
      "[00:30.00]Tout le monde saute", "[00:34.00]Les mains en l'air", "[00:38.00]Tout le monde saute", "[00:42.00]Les mains en l'air",
      "[00:55.00]Second couplet tout doux",
      "[01:10.00]Tout le monde saute", "[01:14.00]Les mains en l'air", "[01:18.00]Tout le monde saute", "[01:22.00]Les mains en l'air"].join("\n");
    const fichiers = () => [
      { name: "Les Volcans - Ça explose.wav", mimeType: "audio/wav", buffer: wavPassages(440, [[36, 1500], [14, 12000], [26, 1500], [14, 12000]]) },
      { name: "Les Volcans - Ça explose.lrc", mimeType: "text/plain", buffer: Buffer.from(LRC) },
      // Sans paroles : calme jusqu'à 45 s, fort de 45 à 75 s.
      { name: "Les Volcans - Sans paroles.wav", mimeType: "audio/wav", buffer: wavPassages(330, [[45, 1500], [30, 12000], [15, 1500]]) },
    ];
    let page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="sons"]');
    await page.setInputFiles("#song-files", fichiers());
    await page.locator("#song-status", { hasText: "Bibliothèque à jour : 2 chansons rangées." }).waitFor({ timeout: 90000 });
    const songs = await library("songs");
    const [idExplose, explose] = Object.entries(songs).find(([, x]) => x.title === "Ça explose");
    const [idSans, sans] = Object.entries(songs).find(([, x]) => x.title === "Sans paroles");
    // Les paroles seules donnaient 29 s (1 s avant les mots) ; le volume pousse sur l'explosion. Sans paroles : là où
    // le volume explose, au lieu du milieu. Le début reste 2 s avant les premiers mots chantés (0:00 sans paroles).
    assert.deepEqual([explose.refrain, explose.start, explose.auto], [35, 6, true]);
    assert.deepEqual([sans.refrain, sans.start, sans.auto], [45, 0, true]);
    assert.equal(await page.locator("#song-entieres").isVisible(), false, "toutes les chansons entières sont en ligne");
    assert.equal(await page.locator("#song-list .song-nuage").count(), 0);

    // Paroles (cedric, 23/10) : pendant l'écoute du refrain, une petite fenêtre les fait défiler, la phrase chantée en
    // gras ; ✕ arrête l'écoute et la ferme. Sans paroles, pas de fenêtre.
    const ligneExplose = page.locator("#song-list .song-ligne", { hasText: "Ça explose" });
    await ligneExplose.getByRole("button", { name: "▶ Refrain" }).click();
    const flottante = page.locator(".paroles-fenetre.flottante");
    await flottante.locator(".paroles-titre", { hasText: "Paroles · Ça explose" }).waitFor();
    await flottante.locator(".paroles-ligne").nth(10).waitFor();
    assert.equal(await flottante.locator(".paroles-ligne").count(), 11);
    // Le refrain commence au hook (35 s) : la phrase de 34 s, puis celle de 38 s.
    await flottante.locator(".paroles-ligne.chantee", { hasText: "Les mains en l'air" }).waitFor();
    await flottante.locator(".paroles-ligne.chantee", { hasText: "Tout le monde saute" }).waitFor({ timeout: 8000 });
    assert.equal(await flottante.locator(".paroles-ligne.chantee").count(), 1);
    if (process.env.CAPTURES) {
      const taille = page.viewportSize();
      await page.setViewportSize({ width: 1366, height: 900 });
      await ligneExplose.evaluate((e) => e.scrollIntoView({ block: "center" }));
      await capture(page, "sons-paroles-ecoute-pc", { pleinePage: false });
      await page.setViewportSize(taille);
    }
    await flottante.getByRole("button", { name: "Fermer les paroles" }).click();
    await flottante.waitFor({ state: "detached" });
    await ligneExplose.getByRole("button", { name: "▶ Refrain" }).waitFor();
    // « ▶ Extrait » joue, devient « ⏸ Pause », et l'arrête au clic suivant.
    const ligneSans = page.locator("#song-list .song-ligne", { hasText: "Sans paroles" });
    await ligneSans.getByRole("button", { name: "▶ Extrait" }).click();
    await ligneSans.getByRole("button", { name: "⏸ Pause" }).waitFor();
    assert.equal(await page.locator(".paroles-fenetre").count(), 0);
    await ligneSans.getByRole("button", { name: "⏸ Pause" }).click();
    await ligneSans.getByRole("button", { name: "▶ Extrait" }).waitFor();
    // Réglages : lâcher le curseur du hook joue la chanson à cet endroit, « ▶ Écouter » devient « ⏸ Pause ».
    await page.locator("#song-list .song-ligne", { hasText: "Ça explose" }).getByRole("button", { name: "⏱ Réglé ✓" }).click();
    const reglage = page.locator(".track.reglage");
    await reglage.locator('input[aria-label="Hook"]:not([disabled])').waitFor({ timeout: 30000 });
    // Les paroles sont là aussi : à l'arrêt, elles montrent le hook ; pendant l'écoute, la phrase chantée.
    const paroles = reglage.locator(".reglage-paroles");
    await paroles.locator(".paroles-ligne.repere", { hasText: "Les mains en l'air" }).waitFor();
    assert.equal(await paroles.locator(".paroles-ligne").count(), 11);
    assert.equal(await paroles.locator(".paroles-ligne").first().innerText(), "0:08\nPremier couplet tout doux");
    await reglage.locator('input[aria-label="Hook"]').fill("40");
    const ecouteHook = reglage.locator('[data-curseur="hook"] .reglage-ligne button', { hasText: /Écouter|Pause/ });
    await ecouteHook.filter({ hasText: "⏸ Pause" }).waitFor();
    await paroles.locator(".paroles-ligne.chantee", { hasText: "Tout le monde saute" }).waitFor();
    // La phrase chantée est au milieu de sa fenêtre, sans faire défiler la page.
    await page.waitForFunction(() => {
      const f = document.querySelector(".reglage-paroles .paroles-defile");
      const l = f.querySelector(".chantee");
      return f.scrollTop > 0 && Math.abs(l.getBoundingClientRect().top + l.offsetHeight / 2 - (f.getBoundingClientRect().top + f.clientHeight / 2)) < l.offsetHeight;
    });
    if (process.env.CAPTURES) {
      const taille = page.viewportSize();
      await page.setViewportSize({ width: 1366, height: 900 });
      await paroles.evaluate((e) => e.scrollIntoView({ block: "center" }));
      await capture(page, "reglage-paroles-pc", { pleinePage: false });
      await page.setViewportSize(taille);
    }
    await ecouteHook.click();
    await ecouteHook.filter({ hasText: "▶ Écouter" }).waitFor();
    assert.equal(await paroles.locator(".paroles-ligne.chantee").count(), 0);
    // Le « ▶ Écouter » du début arrête celui du hook.
    await reglage.locator('[data-curseur="hook"] .reglage-ligne button', { hasText: "▶ Écouter" }).click();
    await ecouteHook.filter({ hasText: "⏸ Pause" }).waitFor();
    await reglage.locator('[data-curseur="debut"] .reglage-ligne button', { hasText: "▶ Écouter" }).click();
    await reglage.locator('[data-curseur="debut"] .reglage-ligne button', { hasText: "⏸ Pause" }).waitFor();
    assert.equal(await ecouteHook.innerText(), "▶ Écouter");
    await page.context().close();

    // Rangées avant le 21/10 (sans chanson entière en ligne) : un hook trouvé tout seul mais faux, un hook réglé à la main.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const d = ctx.database();
      await set(ref(d, `library/songs/${idExplose}/refrain`), 12);
      await set(ref(d, `library/songs/${idSans}/refrain`), 20);
      await set(ref(d, `library/songs/${idSans}/auto`), null);
      await set(ref(d, `library/entieres/${idExplose}`), null);
      await set(ref(d, `library/entieres/${idSans}`), null);
    });
    page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="sons"]');
    await page.locator("#song-entieres", { hasText: "☁ 2 chansons ne sont pas encore entières en ligne" }).waitFor({ timeout: 20000 });
    assert.equal(await page.locator("#song-list .song-ligne", { hasText: "Ça explose" }).locator(".song-nuage").count(), 1);
    await capture(page, "sons-a-redeposer");
    // Redéposées une fois : le hook trouvé tout seul est recherché de nouveau, celui réglé à la main est gardé ; les
    // chansons entières partent en ligne et le « ☁ » s'en va.
    await page.setInputFiles("#song-files", fichiers());
    await waitFor(async () => (await library(`entieres/${idExplose}`))?.n > 0 && (await library(`entieres/${idSans}`))?.n > 0, "chansons entières en ligne", 90000);
    await waitFor(async () => (await library(`songs/${idExplose}`)).refrain === 35, "hook trouvé tout seul, recherché de nouveau");
    assert.deepEqual([(await library(`songs/${idSans}`)).refrain, (await library(`songs/${idSans}`)).auto], [20, undefined], "hook réglé à la main gardé");
    await page.locator("#song-entieres").waitFor({ state: "hidden", timeout: 20000 });
    assert.equal(await page.locator("#song-list .song-nuage").count(), 0);
    await page.context().close();
  });

  test("Bibliothèque › Images (cedric, 22/10) : un clic montre l'image en grand, « 📋 » la copie, « 📋 Coller » la pose dans une question", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    const lea = "abcdef0123456789";
    await seedLibrary(`images/${lea}`, `data:image/png;base64,${png([200, 160, 60]).toString("base64")}`);
    await seedLibrary(`medias/${lea}`, { name: "Le lion de Léa", cat: "Famille et amis", tags: "doudou", createdAt: 1, updatedAt: 1 });
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.locator("#library-images:not([hidden])").waitFor();
    const vis = page.locator("#visionneuse");
    const nomVu = () => page.locator("#vis-nom").innerText();

    // Un émoji en grand ; ‹ › (ou les flèches du clavier) passent aux voisins ; Échap ferme.
    const emojis = page.locator('#media-list .media-group[data-groupe="emojis"] .media-tile');
    const [premier, deuxieme] = [await emojis.nth(0).locator("span:last-child").innerText(), await emojis.nth(1).locator("span:last-child").innerText()];
    await emojis.first().click();
    await vis.locator(".vis-image .emoji").waitFor();
    assert.equal(await nomVu(), premier);
    assert.match(await page.locator("#vis-pos").innerText(), /^1 \/ \d+$/);
    assert.match(await page.locator("#vis-details").innerText(), /^😀 Émojis/);
    await page.keyboard.press("ArrowRight");
    await waitFor(async () => await nomVu() === deuxieme, "émoji suivant");
    await page.click("#vis-prec");
    await waitFor(async () => await nomVu() === premier, "émoji précédent");
    await page.keyboard.press("Escape");
    await vis.waitFor({ state: "hidden" });

    // Sa propre image : en grand avec sa catégorie, ses mots-clés ; « ✏️ Sa fiche » ouvre son groupe.
    await page.locator(`#media-list .media-group[data-groupe="miennes"] .media-tile[data-media="${lea}"]`).click();
    await vis.locator('.vis-image img[src^="data:image/png"]').waitFor();
    assert.equal(await nomVu(), "Le lion de Léa");
    assert.equal(await page.locator("#vis-details").innerText(), "⭐ Mes images · Famille et amis · doudou");
    await page.click("#vis-fiche");
    await vis.waitFor({ state: "hidden" });
    await page.locator(`.media-card[data-media="${lea}"]`).waitFor();
    // Dans son groupe : un clic sur la photo l'ouvre aussi en grand, « 📋 Copier » la copie.
    await page.locator(`.media-card[data-media="${lea}"] img.voir`).click();
    await page.locator("#vis-nom", { hasText: "Le lion de Léa" }).waitFor();
    await page.click("#vis-fermer");
    await vis.waitFor({ state: "hidden" });
    await page.locator(`.media-card[data-media="${lea}"]`).getByRole("button", { name: "📋 Copier" }).click();
    await page.locator("#media-note", { hasText: "« Le lion de Léa » copiée" }).waitFor();

    // L'émoji du lion copié depuis la grande vue, puis collé dans la question.
    await page.click('#media-groups [data-groupe="tout"]');
    await page.fill("#media-search", "lion");
    await page.locator('.media-tile[data-media="emoji:🦁"]').click();
    await page.click("#vis-copier");
    await page.locator("#vis-status", { hasText: "🦁 copié : dans une question, « 📋 Coller »" }).waitFor();
    await page.keyboard.press("Escape");
    await openQuizzes(page);
    await page.locator('#quiz-list [data-quiz="animaux"]').getByRole("button", { name: "Éditer" }).click();
    const q0 = page.locator('[data-q="0"]');
    await q0.getByRole("button", { name: "📋 Coller « Lion »" }).click();
    assert.equal(await q0.locator(".q-emoji").inputValue(), "🦁");
    assert.equal(await q0.locator(".choice-photo .q-coller").count(), 0, "pas d'émoji sur une réponse en image");
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "Enregistré" }).waitFor();

    // La photo libre du tigre copiée d'un geste (📋 de la vignette, sans l'ouvrir) : illustration et réponse B.
    await page.click("#nav button[data-screen=library]");
    await page.fill("#media-search", "tigre");
    const tigre = page.locator('#media-list .media-group[data-groupe="photos"] .media-tile[data-media="banque:tigre"]');
    await tigre.locator(".media-copier").click();
    await page.locator("#media-note", { hasText: "« Tigre » copiée" }).waitFor();
    assert.equal(await vis.isVisible(), false, "le 📋 copie sans ouvrir");
    await openQuizzes(page);
    await page.locator('#quiz-list [data-quiz="animaux"]').getByRole("button", { name: "Éditer" }).click();
    await q0.getByRole("button", { name: "📋 Coller « Tigre »" }).click();
    await q0.locator(".q-image:not([hidden])").waitFor();
    await q0.locator(".choice-photo").nth(1).locator(".q-coller").click();
    await q0.locator(".choice-photo").nth(1).locator(".choice-thumb:not([hidden])").waitFor();
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "Enregistré" }).waitFor();
    const q = (await library("quizzes")).animaux.questions[0];
    assert.equal(q.image, "🦁");
    assert.match(q.imageId, /^[0-9a-f]{16}$/);
    assert.match(await library(`images/${q.imageId}`), /^data:image\/jpeg;base64,/);
    assert.match(q.choiceImages[1], /^[0-9a-f]{16}$/);
    await page.context().close();
  });

  test("Quiz classique tout prêt (cedric, 22/10) : questions à 4 réponses et Juste Chiffre sans émoji, trois niveaux, de vraies photos, dans la rubrique et dans un quiz classique (sorte, niveau, thème, 5 au hasard), et les quiz de test à part", async () => {
    const { QUESTIONS_CHIFFRES } = await import("../web/public/banque-chiffres.js");
    const { QUESTIONS_CLASSIQUES, QUESTIONS_TOUT_PRETES, estJusteChiffre } = await import("../web/public/banque-classiques.js");
    await seedLibrary("quizzes", {
      mien: { title: "Quiz de Jade", source: "saisie", kind: "classique", ageMin: 7, ageMax: 8, updatedAt: 5, questions: [
        { text: "Combien de pattes a une araignée ?", kind: "number", correct: 8, status: "validee", image: "🕷️" },
      ] },
      "test-lea-tous-les-jeux-quiz": { title: "TEST – Quiz classique de Léa", theme: "Culture générale (test)", source: "saisie", updatedAt: 9, questions: [
        { text: "Combien de jours y a-t-il dans une année ?", kind: "number", correct: 365, status: "validee" },
      ] },
    });
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="questions"]');

    // Les questions de la prestation de test ne sont plus « en vrac » : elles ont leur groupe.
    await page.locator('#q-groups [data-groupe="tests"]', { hasText: "🧪 Questions de test (1)" }).waitFor();
    await page.locator('.q-groupe[data-groupe="tests"] .q-item[data-question="test-lea-tous-les-jeux-quiz/0"]').waitFor();
    assert.equal(await page.locator('.q-groupe[data-groupe="miennes"] .q-item').count(), 1);
    await page.click('#q-groups [data-groupe="tests"]');
    await page.locator("#q-list .q-item", { hasText: "Combien de jours y a-t-il dans une année ?" }).getByRole("button", { name: "Supprimer" }).waitFor();
    // Un Juste Chiffre sans émoji a son compteur sur la TV (cedric, 22/10) : 🔢, pas d'alerte.
    const sansEmoji = page.locator('#q-list .q-item[data-question="test-lea-tous-les-jeux-quiz/0"]');
    assert.equal(await sansEmoji.locator(".q-illus.compteur").innerText(), "🔢");
    assert.equal(await sansEmoji.locator(".q-alerte").count(), 0);

    // Deux rubriques à ne pas mélanger (cedric, 22/10). Quiz classique : les questions à 4 réponses écrites avec leur
    // émoji pour la révélation, et les Juste Chiffre sans émoji (🔢 : le compteur), par thème, sans alerte ; jamais de
    // question du quiz illustré.
    await page.click('#q-groups [data-groupe="classiques"]');
    await page.locator("#q-list .q-item").first().waitFor();
    // La liste montre 300 questions au plus, puis « … et N autres : précisez la recherche ».
    const vues = (n) => Math.min(n, 300);
    const listees = async (n, quoi) => {
      await waitFor(async () => await page.locator("#q-list .q-item").count() === vues(n), quoi);
      assert.equal(await page.locator("#q-list > p.hint.small", { hasText: "autres : précisez la recherche" }).count(), n > 300 ? 1 : 0, `${quoi} : « … et ${n - 300} autres »`);
    };
    assert.equal(await page.locator('#q-groups [data-groupe="classiques"]').innerText(), `📝 Quiz classique tout prêt (${QUESTIONS_TOUT_PRETES.length})`);
    await listees(QUESTIONS_TOUT_PRETES.length, "toutes les questions");
    assert.equal(await page.locator("#q-list .q-item.sans-illus").count(), 0);
    assert.equal(await page.locator("#q-list .q-mini").count(), 0, "pas de réponses en images ici");
    // Niveau Facile : son émoji, ou sa photo ; niveaux Moyen et Difficile : une vraie photo, jamais d'émoji.
    const facile = QUESTIONS_CLASSIQUES.find((x) => x.niveau === 1 && !x.photo);
    await page.fill("#q-search", facile.text);
    const premiere = page.locator(`#q-list .q-item[data-question="${facile.id}"]`);
    assert.equal(await premiere.locator(".q-illus.emoji").innerText(), facile.emoji);
    assert.equal(await premiere.locator(".q-reponses li").count(), 4);
    assert.equal(await premiere.locator(".q-reponses li.juste").innerText(), `✓ ${facile.choices[0]}`);
    const moyen = QUESTIONS_CLASSIQUES.find((x) => x.niveau === 2);
    await page.fill("#q-search", moyen.text);
    const enPhoto = page.locator(`#q-list .q-item[data-question="${moyen.id}"] img.q-illus`);
    assert.equal(await enPhoto.getAttribute("src"), moyen.photo);
    await waitFor(async () => await enPhoto.evaluate((img) => img.complete && img.naturalWidth === 640), "la photo s'affiche");
    await page.fill("#q-search", "");
    // Trois niveaux sans chevauchement : une puce chacun.
    const parNiveau = (n) => QUESTIONS_TOUT_PRETES.filter((x) => x.niveau === n);
    assert.equal(await page.locator('.q-niveaux [data-niveau="1"]').innerText(), `Facile · 5 à 8 ans (${parNiveau(1).length})`);
    assert.equal(await page.locator('.q-niveaux [data-niveau="2"]').innerText(), `Moyen · 9 à 11 ans (${parNiveau(2).length})`);
    assert.equal(await page.locator('.q-niveaux [data-niveau="3"]').innerText(), `Difficile · 12 à 15 ans (${parNiveau(3).length})`);
    await page.click('.q-niveaux [data-niveau="1"]');
    await listees(parNiveau(1).length, "le niveau Facile");
    assert.equal(await page.locator("#q-list .q-item .q-illus.emoji:not(.compteur)").count(), parNiveau(1).filter((x) => !estJusteChiffre(x) && !x.photo).length, "émojis seulement au niveau Facile (et pas sur les questions qui ont leur photo)");
    assert.equal(await page.locator("#q-list .q-item .q-illus.compteur").count(), parNiveau(1).filter(estJusteChiffre).length, "🔢 sur les Juste Chiffre");
    for (const n of [2, 3]) {
      await page.click(`.q-niveaux [data-niveau="${n}"]`);
      await listees(parNiveau(n).length, `le niveau ${n}`);
      assert.equal(await page.locator("#q-list .q-item .q-illus.emoji:not(.compteur)").count(), 0, `jamais d'émoji au niveau ${n} (🔢 seulement sur les Juste Chiffre)`);
    }
    assert.match(await page.locator("#q-list .q-item .hint.small").first().innerText(), /· Difficile · 12 à 15 ans$/);
    await page.click('.q-niveaux [data-niveau="2"]');
    await listees(parNiveau(2).length, "le niveau Moyen");
    assert.match(await page.locator("#q-list .q-item .hint.small").first().innerText(), /· Moyen · 9 à 11 ans$/);
    await capture(page, "quiz-classique-moyen");
    await page.click('.q-niveaux [data-niveau="tous"]');
    await listees(QUESTIONS_TOUT_PRETES.length, "tous les niveaux");
    await page.fill("#q-search", QUESTIONS_CHIFFRES[0].text);
    const chiffre = page.locator(`#q-list .q-item[data-question="${QUESTIONS_CHIFFRES[0].id}"]`);
    assert.equal(await chiffre.locator(".q-illus.compteur").innerText(), "🔢");
    assert.equal(await chiffre.locator(".q-nombre").innerText(), `Le Juste Chiffre · réponse : ${QUESTIONS_CHIFFRES[0].correct}`);
    await page.fill("#q-search", "");
    const animaux = page.locator('.q-categories [data-categorie="Animaux"]');
    assert.equal(await animaux.innerText(), `Animaux (${QUESTIONS_TOUT_PRETES.filter((x) => x.theme === "animaux").length})`);
    // Une puce par sorte : les questions à 4 réponses seules, les Juste Chiffre seuls.
    assert.equal(await page.locator('.q-types [data-type="qcm"]').innerText(), `❓ Questions à 4 réponses (${QUESTIONS_CLASSIQUES.length})`);
    await page.click('.q-types [data-type="qcm"]');
    await listees(QUESTIONS_CLASSIQUES.length, "les questions à 4 réponses");
    assert.equal(await page.locator("#q-list .q-nombre").count(), 0);
    await capture(page, "quiz-classique-4-reponses");
    await page.click('.q-types [data-type="nombre"]');
    await listees(QUESTIONS_CHIFFRES.length, "les Juste Chiffre");
    assert.equal(await page.locator("#q-list .q-reponses").count(), 0);
    assert.equal(await page.locator("#q-list .q-illus.compteur").count(), QUESTIONS_CHIFFRES.length, "aucun émoji sur un Juste Chiffre");
    await page.click('.q-types [data-type="tous"]');
    await page.fill("#q-search", "dalmatiens");
    await page.locator("#q-list .q-item", { hasText: "101" }).waitFor();
    await page.fill("#q-search", "");
    await capture(page, "quiz-classique-tout-pret");
    // Quiz illustré : la banque des tout-petits, toute illustrée (photo, sinon l'émoji du mot), pas de Juste Chiffre,
    // pas d'alerte, et jamais « null » écrit dans la page.
    await page.click('#q-groups [data-groupe="illustrees"]');
    await page.locator("#q-list .q-item").first().waitFor();
    assert.equal(await page.locator("#q-list .q-alerte").count(), 0);
    assert.equal(await page.locator("#q-list .q-nombre").count(), 0);
    assert.doesNotMatch(await page.locator("#q-list").innerText(), /\bnull\b/);
    await page.fill("#q-search", "la tête en bas");
    const nuit = page.locator("#q-list .q-item", { hasText: "Quel animal dort la tête en bas ?" }).first();
    assert.equal(await nuit.locator(".q-illus.emoji").innerText(), "🦇");
    assert.equal(await nuit.locator("li.juste .q-mini.emoji").innerText(), "🦇");
    await page.fill("#q-search", "");
    await capture(page, "quiz-illustre-tout-pret");

    // Dans le quiz de Jade (7 ans) : le niveau Facile vient de l'âge du quiz ; la question déjà là ne se coche pas.
    await page.click('#q-groups [data-groupe="miennes"]');
    await page.locator('.q-item[data-question="mien/0"]').getByRole("button", { name: "Éditer" }).click();
    await page.locator("#rv-chiffres:not([hidden])", { hasText: "📝 Questions toutes prêtes" }).click();
    const panel = page.locator("#rv-chiffres-panel");
    await panel.locator(".banque-q").first().waitFor();
    await panel.locator('.chips.niveaux .chip.active[data-niveau="1"]', { hasText: "Facile · 5 à 8 ans" }).waitFor();
    const pourSept = QUESTIONS_TOUT_PRETES.filter((x) => x.niveau === 1);
    assert.equal(await panel.locator(".banque-q").count(), pourSept.length);
    const araignee = panel.locator(".banque-q", { hasText: "Combien de pattes a une araignée ?" });
    assert.equal(await araignee.locator("input").isDisabled(), true);
    await araignee.locator(".tag", { hasText: "déjà dans le quiz" }).waitFor();
    assert.equal(await araignee.locator(".banque-texte").innerText(), "🔢 Combien de pattes a une araignée ?", "jamais d'émoji sur un Juste Chiffre");
    // Les Juste Chiffre, un thème, puis 5 au hasard : 5 cochées, toutes de cette sorte, de ce thème et de ce niveau.
    await panel.locator('.chip[data-type="nombre"]').click();
    await panel.locator('.chip.active[data-type="nombre"]').waitFor();
    await panel.locator('.chip[data-theme="animaux"]').click();
    await panel.locator('.chip.active[data-theme="animaux"]').waitFor();
    await page.click("#rv-chiffres-hasard");
    await waitFor(async () => await panel.locator(".banque-q input:checked").count() === 5, "5 cochées");
    const cochees = await panel.locator(".banque-q:has(input:checked)").evaluateAll((els) => els.map((e) => e.dataset.chiffre));
    const tirees = cochees.map((id) => QUESTIONS_TOUT_PRETES.find((x) => x.id === id));
    assert.ok(tirees.every((x) => estJusteChiffre(x) && x.theme === "animaux" && x.niveau === 1), "sorte, thème et niveau respectés");
    assert.ok(!tirees.some((x) => x.text === "Combien de pattes a une araignée ?"), "jamais celle déjà dans le quiz");
    await capture(page, "juste-chiffre-dans-un-quiz");
    // Plus une question à 4 réponses, trouvée en cherchant : ses réponses, la bonne marquée.
    await panel.locator('.chip[data-type="qcm"]').click();
    await panel.locator('.chip.active[data-type="qcm"]').waitFor();
    await page.fill("#rv-chiffres-cherche", "toile");
    const araigneeQ = QUESTIONS_CLASSIQUES.find((x) => x.text === "Quel animal fabrique une toile ?");
    const toile = panel.locator(".banque-q", { hasText: araigneeQ.text });
    await toile.waitFor();
    assert.equal(await toile.locator(".banque-texte").innerText(), `${araigneeQ.photo ? "" : "🕷️ "}${araigneeQ.text}`);
    assert.match(await toile.locator(".banque-mots").innerText(), /^✓ L'araignée · La fourmi · L'abeille · La mouche · Animaux · Facile · 5 à 8 ans$/);
    await toile.locator("input").check();
    // Et une question Moyen, avec sa vraie photo.
    const moyenne = QUESTIONS_CLASSIQUES.find((x) => x.niveau === 2 && x.theme === "animaux");
    await panel.locator('.chip[data-niveau="2"]').click();
    await panel.locator('.chip.active[data-niveau="2"]').waitFor();
    await page.fill("#rv-chiffres-cherche", moyenne.text.slice(0, 30));
    const ligneMoyenne = panel.locator(`.banque-q[data-chiffre="${moyenne.id}"]`);
    assert.equal(await ligneMoyenne.locator(".banque-texte img.q-mini").getAttribute("src"), moyenne.photo);
    assert.equal(await ligneMoyenne.locator(".banque-texte").innerText(), moyenne.text, "pas d'émoji au niveau Moyen");
    await ligneMoyenne.locator("input").check();
    await capture(page, "question-4-reponses-dans-un-quiz");
    assert.equal(await page.locator("#rv-chiffres-add").innerText(), "Ajouter les 7 questions cochées");
    await page.click("#rv-chiffres-add");
    await page.locator("#rv-status", { hasText: "7 questions toutes prêtes ajoutées" }).waitFor();
    assert.equal(await page.locator("#rv-list .qcard").count(), 8);
    assert.equal(await page.locator('#rv-list .qcard[data-q="5"] .q-number').inputValue(), `${tirees[4].correct}`);
    // Ajoutées : elles ne se cochent plus.
    await page.fill("#rv-chiffres-cherche", "");
    await panel.locator('.chip[data-type="tous"]').click();
    await panel.locator('.chip[data-niveau="tous"]').click();
    await waitFor(async () => await panel.locator(".banque-q.deja").count() === 8, "déjà dans le quiz");
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "Enregistré" }).waitFor();
    const enregistrees = (await library("quizzes/mien/questions")).slice(1);
    // Les Juste Chiffre : leur nombre, sans image.
    assert.deepEqual(enregistrees.slice(0, 5).map((q) => [q.text, q.kind, q.correct, q.image ?? null, q.status]),
      tirees.map((x) => [x.text, "number", x.correct, null, "validee"]));
    // Les questions à 4 réponses : leurs réponses mélangées, la bonne bien repérée, leur image pour la révélation : la
    // photo rangée une fois dans la bibliothèque des images, sinon l'émoji (niveau Facile seulement).
    const [q4, q5] = enregistrees.slice(5);
    assert.deepEqual([q4.text, q4.kind ?? null, q4.status, [...q4.choices].sort()], [araigneeQ.text, null, "validee", [...araigneeQ.choices].sort()]);
    assert.equal(q4.choices[q4.correct], "L'araignée");
    if (araigneeQ.photo) assert.match(q4.imageId, /^[0-9a-f]{16}$/);
    else assert.equal(q4.image, "🕷️");
    assert.deepEqual([q5.text, q5.image ?? "", q5.choices[q5.correct]], [moyenne.text, "", moyenne.choices[0]]);
    assert.match(q5.imageId, /^[0-9a-f]{16}$/);
    assert.match(await library(`images/${q5.imageId}`), /^data:image\/(jpeg|webp);base64,/, "la photo est dans la bibliothèque des images");
    await page.context().close();
  });

  test("Bibliothèque en fabriquant un quiz : « 🖼️ » cherche la bonne réponse et pose un émoji, une de ses images ou une photo libre", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    const lea = "abcdef0123456789";
    await seedLibrary(`images/${lea}`, `data:image/png;base64,${png([200, 160, 60]).toString("base64")}`);
    await seedLibrary(`medias/${lea}`, { name: "Le lion de Léa", cat: "Famille et amis", tags: "doudou", createdAt: 1, updatedAt: 1 });
    const page = await admin();
    await openQuizzes(page);
    await page.locator('#quiz-list [data-quiz="animaux"]').getByRole("button", { name: "Éditer" }).click();
    const q0 = page.locator('[data-q="0"]');
    const fenetre = page.locator(".choix-boite");
    // Illustration : la recherche part de la bonne réponse (« Lion ») ; les noms qui commencent par « Lion » d'abord
    // (l'émoji, puis la photo libre), puis « Le lion de Léa » ; à égalité, ses images passent avant.
    await q0.getByRole("button", { name: "🖼️ Bibliothèque…" }).click();
    assert.equal(await fenetre.locator(".choix-recherche").inputValue(), "Lion");
    assert.deepEqual((await fenetre.locator(".media-tile").evaluateAll((l) => l.map((x) => x.dataset.media))).slice(0, 3), ["emoji:🦁", "banque:lion", lea]);
    await fenetre.locator('.media-tile[data-media="emoji:🦁"]').click();
    await page.locator(".choix-voile").waitFor({ state: "detached" });
    assert.equal(await q0.locator(".q-emoji").inputValue(), "🦁");
    // Échap ferme sans rien changer.
    await q0.getByRole("button", { name: "🖼️ Bibliothèque…" }).click();
    await fenetre.locator(".choix-recherche").press("Escape");
    await page.locator(".choix-voile").waitFor({ state: "detached" });
    assert.equal(await q0.locator(".q-image:not([hidden])").count(), 0);
    await q0.getByRole("button", { name: "🖼️ Bibliothèque…" }).click();
    await fenetre.locator(`.media-tile[data-media="${lea}"]`).click();
    await q0.locator(".q-image:not([hidden])").waitFor();
    // Réponse B en image : la photo libre du tigre ; pas d'émoji proposé pour une réponse en image.
    await q0.locator(".choice-photo").nth(1).locator('button[title^="Choisir l\'image"]').click();
    assert.equal(await fenetre.locator(".choix-recherche").inputValue(), "Tigre");
    assert.equal(await fenetre.locator('[data-groupe="emojis"]').count(), 0);
    await fenetre.locator('.media-tile[data-media="banque:tigre"]').click();
    await q0.locator(".choice-photo").nth(1).locator(".choice-thumb:not([hidden])").waitFor();
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "Enregistré" }).waitFor();
    const q = (await library("quizzes")).animaux.questions[0];
    assert.equal(q.image, "🦁");
    assert.equal(q.imageId, lea, "sa propre image, sans copie");
    assert.match(q.choiceImages[1], /^[0-9a-f]{16}$/);
    assert.match(await library(`images/${q.choiceImages[1]}`), /^data:image\/jpeg;base64,/);
    await page.context().close();
  });

  test("Régie PC : ses propres photos sur des cartes de mimes et des objets de Qui a disparu ?, copiées dans la partie", async () => {
    const page = await admin();
    // Mimes : une carte avec sa photo (le mot vient du nom du fichier), puis plusieurs photos d'un coup.
    await page.click(".tile[data-screen=mimes]");
    await page.click("#game-tabs [data-tab=collections]");
    await page.click("#mime-new");
    await page.fill("#mime-title", "Les doudous de Léa");
    await page.locator("#mime-photo").setInputFiles({ name: "lapin-rose.png", mimeType: "image/png", buffer: png([230, 120, 160]) });
    await page.locator("#mime-photo-label", { hasText: "Photo choisie" }).waitFor();
    assert.equal(await page.inputValue("#mime-word"), "Lapin rose");
    await page.locator("#mime-custom button[type=submit]").click();
    await page.locator("#mime-picked .mime-card .mime-photo").waitFor();
    await page.locator("#mime-photos").setInputFiles([
      { name: "ours-brun.png", mimeType: "image/png", buffer: png([140, 90, 40]) },
      { name: "girafe.png", mimeType: "image/png", buffer: png([220, 190, 60]) },
    ]);
    await page.locator("#mime-status", { hasText: "2 photos ajoutées" }).waitFor();
    // Une carte du catalogue garde son émoji ; une photo donnée pour un mot déjà là devient sa photo.
    await page.locator("#mime-catalog .mime-card", { hasText: "Chat" }).click();
    await page.fill("#mime-word", "girafe");
    await page.locator("#mime-photo").setInputFiles({ name: "ma-girafe.png", mimeType: "image/png", buffer: png([250, 210, 90]) });
    await page.locator("#mime-custom button[type=submit]").click();
    await page.locator("#mime-status", { hasText: "Photo ajoutée à « Girafe »" }).waitFor();
    assert.equal(await page.locator("#mime-count").textContent(), "4");
    await page.click("#mime-save");
    await page.locator("#mime-status", { hasText: "Enregistré : 4 cartes" }).waitFor();
    const [deckId, deck] = Object.entries(await library("mimes"))[0];
    assert.deepEqual(deck.cards.map((c) => [c.word, c.image ?? null, /^[0-9a-f]{16}$/.test(c.imageId ?? "")]),
      [["Lapin rose", null, true], ["Ours brun", null, true], ["Girafe", null, true], ["Chat", "🐱", false]]);
    assert.equal(new Set(deck.cards.map((c) => c.imageId).filter(Boolean)).size, 3, "trois photos différentes");
    for (const c of deck.cards.filter((x) => x.imageId)) assert.equal(typeof (await library(`images/${c.imageId}`)), "string");

    // Qui a disparu ? : une famille faite de ses photos, le mot de chaque objet tiré du nom du fichier.
    await openGamePage(page, "disparu", "collections");
    await page.fill("#bi-theme", "La chambre de Léa");
    await page.click("#builtin-add button[type=submit]");
    await page.locator("#builtin-status", { hasText: "ou sa photo" }).waitFor();
    await page.locator("#bi-photos").setInputFiles(["lit", "lampe", "poupee", "tambour", "ballon"].map((n, k) => ({ name: `${n}.png`, mimeType: "image/png", buffer: png([40 * k, 100, 200 - 30 * k]) })));
    await page.locator("#bi-photos-count", { hasText: "5 photos choisies" }).waitFor();
    await page.click("#builtin-add button[type=submit]");
    await page.locator("#builtin-status", { hasText: "« La chambre de Léa » est ajouté au jeu." }).waitFor();
    await page.locator('#builtin-items .content-item.custom[data-key="la chambre de léa"] .vignettes img').nth(4).waitFor();
    const chambre = (await library("contents")).disparu.extra[0];
    assert.deepEqual(chambre.objects.map((o) => o.word), ["Lit", "Lampe", "Poupee", "Tambour", "Ballon"]);
    assert.ok(chambre.objects.every((o) => /^[0-9a-f]{16}$/.test(o.imageId) && !o.image));
    await page.context().close();

    // La régie charge la prestation : les photos sont copiées dans la partie, la TV les montre à la place des émojis.
    await seedLibrary("shows/photos", { childName: "Léa", age: 7, date: "2026-12-02", status: "publiee", teams: 2, updatedAt: 1,
      rounds: [{ type: "mimes", deckId }, { type: "disparu", count: 1, picks: ["la chambre de léa"] }] });
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator(".show-item", { hasText: "Léa" }).click();
    // Fenêtre de lancement, sur le téléphone seulement : « Lancer » confirme.
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const qs = (await read("show")).quiz.questions;
    const mime = qs.find((q) => q.kind === "mime");
    const disparu = qs.find((q) => q.kind === "disparu");
    const mesPhotos = Object.fromEntries(deck.cards.filter((c) => c.imageId).map((c) => [c.word, c.imageId]));
    for (const c of mime.cards.filter((x) => mesPhotos[x.word])) assert.equal(c.imageId, mesPhotos[c.word]);
    assert.equal(mime.cards.find((c) => c.word === "Chat").imageId, undefined);
    assert.equal(disparu.cards.length >= 5, true);
    assert.ok(disparu.cards.every((c) => chambre.objects.some((o) => o.word === c.word && o.imageId === c.imageId)));
    const wanted = [...new Set([...mime.cards, ...disparu.cards].map((c) => c.imageId).filter(Boolean))];
    await waitFor(async () => { const copied = (await read("choiceImages")) ?? {}; return wanted.every((id) => typeof copied[id] === "string"); }, "photos copiées dans la partie");
    await regie.context().close();
  });

  test("TV trop ancienne pour les mimes : la régie le dit au lieu d'envoyer un programme refusé", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    await seedLibrary("mimes", { zoo: { title: "Zoo", duration: 60, cards: [{ word: "Chat", image: "🐱" }], updatedAt: 1 } });
    await seedLibrary("shows", {
      lea: { childName: "Léa", age: 9, status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }, { type: "mimes", deckId: "zoo" }], updatedAt: 1 },
    });
    // Box d'avant les mimes : son conducteur ne les annonce pas.
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/conducteur/mimes`), null));
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Léa" }).click();
    await regie.locator("#r-toast", { hasText: "La TV doit être mise à jour pour jouer aux mimes" }).waitFor();
    assert.equal(await read("show"), null, "Rien n'est envoyé à la TV");
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game^='mimes/']", { hasText: "Zoo" }).click();
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "La TV doit être mise à jour pour jouer aux mimes" }).waitFor();
    assert.equal(await read("show"), null);
    await regie.context().close();
  });

  test("Le Juste Chiffre : préparé dans l'admin, refusé proprement par une TV trop ancienne", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    const page = await admin();
    await openQuizzes(page);
    await page.locator('#quiz-list [data-quiz="animaux"]').getByRole("button", { name: "Éditer" }).click();
    await page.locator('[data-q="1"] .q-is-number').check();
    await page.locator('[data-q="1"] .q-number').fill("8");
    await page.locator('[data-q="1"] .q-valid:enabled').check();
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "Enregistré" }).waitFor();
    const q = (await library("quizzes")).animaux.questions[1];
    assert.equal(q.kind, "number");
    assert.equal(q.correct, 8);
    assert.equal(q.choices, undefined);
    assert.equal(q.status, "validee");
    await page.context().close();

    await seedLibrary("shows", { lea: { childName: "Léa", age: 9, status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 } });
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/conducteur/numbers`), null));
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Léa" }).click();
    await regie.locator("#r-toast", { hasText: "pour jouer au Juste Chiffre" }).waitFor();
    assert.equal(await read("show"), null, "Rien n'est envoyé à la TV");
    await regie.context().close();
  });

  test("Chante le mot ! et Qui suis-je ? : rien à préparer dans l'admin, ajout en direct, TV trop ancienne prévenue", async () => {
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    await ajouterJeu(page, "chante");
    const round = page.locator("#show-rounds .round").nth(0);
    await round.locator("select.grow").selectOption("4");
    await aVenir(page);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    assert.deepEqual(await sansManche(Object.values(await library("shows"))[0].rounds), [{ type: "chante", count: 4 }]);
    await page.context().close();

    box = startBox();
    await addTeam("rose", "Les Roses");
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Anniversaire de Léa" }).click();
    // Fenêtre de lancement, sur le téléphone seulement : « Lancer » confirme.
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const questions = (await read("show")).quiz.questions;
    assert.deepEqual(questions.map((q) => q.kind), ["chante", "chante", "chante", "chante"]);
    // En jeu : la régie dit ce qu'il faut entendre quand une équipe a buzzé.
    const word = questions[0].text;
    await set(gameRef("conducteur"), { ...(await read("conducteur")), questions: questions.map((q, i) => ({ ...q, id: `c${i}` })) });
    await box.set({ ...questionState(1), qid: "c0", kind: "chante", text: word, choices: null, round: "c0-1000-0", buzzOpen: true, buzz: { team: null, blocked: [] } });
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/buzz/c0-1000-0`), { team: "rose", at: Date.now() }));
    await regie.locator("#flou-info", { hasText: `Les Roses a buzzé ! Réponse attendue : une chanson avec le mot « ${word} »` }).waitFor();
    await regie.click("#flou-ok");
    await regie.locator("#c-phase", { hasText: "Réponse révélée" }).waitFor();
    // En direct : Qui suis-je ? toujours proposé, sans quiz à préparer.
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game='builtin/quisuis']", { hasText: "Qui suis-je ?" }).locator("span", { hasText: "5 personnages" }).waitFor();
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/conducteur/quisuis`), null));
    await regie.locator("#lib-list [data-game='builtin/quisuis']").click();
    await regie.locator("#lib-questions", { hasText: "→" }).waitFor();
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "pour jouer à « Qui suis-je ? »" }).waitFor();
    await regie.context().close();
  });

  test("Régie PC : plusieurs quiz dans une manche, mimes du catalogue tirés puis retouchés, mots choisis un par un", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX, finale: FINALE });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    // Quiz : un deuxième quiz rappelé à la suite, dans la même manche (deux séries).
    await ajouterJeu(page);
    const quiz = page.locator("#show-rounds .round").nth(0);
    await quiz.locator("select.quiz-rappel").selectOption("animaux");
    await quiz.locator("select.quiz-rappel").selectOption("finale");
    await page.locator("#show-summary", { hasText: "4 questions" }).waitFor();
    // Mimes : 30 cartes du catalogue au hasard, une retirée, une à soi ajoutée.
    await ajouterJeu(page, "mimes");
    const mimes = page.locator("#show-rounds .round").nth(1);
    await mimes.locator("select.grow").selectOption("hasard");
    await mimes.locator(".pick-box .small", { hasText: "30 cartes au hasard au lancement" }).waitFor();
    await mimes.locator("button.pick-draw").click();
    await mimes.locator(".pick-box .small", { hasText: "30 cartes choisies" }).waitFor();
    const removed = await mimes.locator("button.pick-item").first().getAttribute("data-key");
    await mimes.locator("button.pick-item").first().click();
    await mimes.locator(".pick-box .small", { hasText: "29 cartes choisies" }).waitFor();
    await mimes.locator(".pick-own input").fill("Le chat de Léa");
    await mimes.locator(".pick-own button").click();
    await mimes.locator('button.pick-item[data-key="le chat de léa"]').waitFor();
    // Chante le mot ! : deux mots choisis à la main.
    await ajouterJeu(page, "chante");
    const chante = page.locator("#show-rounds .round").nth(2);
    await chante.locator("select.pick-add").selectOption("soleil");
    await chante.locator("select.pick-add").selectOption("maman");
    await chante.locator(".pick-box .small", { hasText: "2 mots choisis" }).waitFor();
    await aVenir(page);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    const saved = await sansManche(Object.values(await library("shows"))[0].rounds);
    assert.deepEqual(saved[0].seriesQuiz.map((x) => [x.origine, x.quizId]), [["quiz", "animaux"], ["quiz", "finale"]]);
    assert.equal(saved[0].finale, 3);
    assert.equal(saved[1].type, "mimes");
    assert.equal(saved[1].deckId, undefined, "Cartes choisies dans toutes les collections");
    assert.equal(saved[1].cards.length, 30);
    assert.ok(!saved[1].cards.some((c) => c.word.toLowerCase() === removed), "La carte retirée n'est plus là");
    assert.deepEqual(saved[1].cards.at(-1), { word: "Le chat de Léa" });
    assert.deepEqual(saved[2], { type: "chante", count: 6, picks: ["soleil", "maman"] });
    await page.context().close();

    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Anniversaire de Léa" }).click();
    // Fenêtre de lancement, sur le téléphone seulement : « Lancer » confirme.
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const questions = (await read("show")).quiz.questions;
    assert.deepEqual(questions.slice(0, 4).map((q) => q.round), ["Animaux + Finale", "Animaux + Finale", "Animaux + Finale", "Animaux + Finale"]);
    assert.equal(questions[4].kind, "mime");
    assert.deepEqual(questions[4].cards.map((c) => c.word).sort(), saved[1].cards.map((c) => c.word).sort());
    assert.deepEqual(questions.slice(5).map((q) => q.text), ["soleil", "maman"]);
    await regie.context().close();
  });

  test("Régie PC « jamais deux fois » : un élément déjà utilisé dans une autre manche est signalé en rouge (permis), le tirage l'évite", async () => {
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    await ajouterJeu(page, "mimes");
    const mimes = page.locator("#show-rounds .round").nth(0);
    await mimes.locator("select.grow").selectOption("hasard");
    await mimes.locator(".pick-own input").fill("Chat");
    await mimes.locator(".pick-own button").click();
    await mimes.locator('button.pick-item[data-key="chat"]').waitFor();
    await ajouterJeu(page, "chante");
    const chante = page.locator("#show-rounds .round").nth(1);
    assert.match(await chante.locator('select.pick-add option[value="chat"]').textContent(), /déjà utilisé dans Mimes/);
    await chante.locator("select.pick-add").selectOption("chat");
    // Choisi à la main : permis, en rouge des deux côtés.
    await chante.locator('button.pick-item.deja[data-key="chat"]').waitFor();
    await chante.locator(".pick-deja", { hasText: "chat : déjà utilisé dans Mimes" }).waitFor();
    await mimes.locator('button.pick-item.deja[data-key="chat"]').waitFor();
    await mimes.locator(".pick-deja", { hasText: "déjà utilisé dans Chante le mot !" }).waitFor();
    // 🎲 : le tirage ne reprend pas le chat des Mimes.
    await chante.locator("button.pick-draw").click();
    await chante.locator(".pick-box .small", { hasText: "6 mots choisis" }).waitFor();
    assert.equal(await chante.locator('button.pick-item[data-key="chat"]').count(), 0);
    await mimes.locator('button.pick-item[data-key="chat"]:not(.deja)').waitFor();
    assert.equal(await page.locator(".pick-deja").count(), 0);
    await page.context().close();
  });

  test("à la volée : mimes au hasard retouchés avant l'ajout, et plusieurs quiz cochés dans un même jeu", async () => {
    const DINO = { title: "Dinosaures", source: "tableur", updatedAt: 1, questions: [{ text: "Le T-Rex mangeait de la viande", choices: ["Vrai", "Faux"], correct: 0, status: "validee" }] };
    await seedLibrary("quizzes", { animaux: ANIMAUX, dino: DINO });
    box = startBox();
    await addTeam("rose", "Les Roses");
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    // Mimes au hasard : 5 cartes par équipe (1 équipe, plus la réserve pour 2 équipes de plus), une retirée, une ajoutée.
    await regie.locator("#lib-list [data-game='mimes/hasard']", { hasText: "Mimes au hasard" }).click();
    await regie.locator("#lib-meta", { hasText: "Mimes · 15 cartes" }).waitFor();
    const first = await regie.locator("#lib-questions .lib-card").first().getAttribute("data-word");
    await regie.locator("#lib-questions .lib-card").first().click();
    await regie.locator("#lib-meta", { hasText: "Mimes · 14 cartes" }).waitFor();
    // La carte retirée revient dans la liste « Ajouter » : on en choisit une autre (sinon le test dépend du tirage).
    const extra = await regie.locator("#lib-add option:not([value=''])").evaluateAll((os, mot) => os
      .find((o) => o.textContent.replace(/^[^\p{L}\p{N}]+/u, "").trim().toLowerCase() !== mot.toLowerCase())?.value, first);
    assert.ok(await regie.locator("#lib-add option", { hasText: first }).count() > 0, "la carte retirée peut être remise");
    await regie.selectOption("#lib-add", extra);
    await regie.locator("#lib-meta", { hasText: "Mimes · 15 cartes" }).waitFor();
    const words = await regie.locator("#lib-questions .lib-card").evaluateAll((els) => els.map((e) => e.dataset.word));
    assert.ok(!words.includes(first));
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "est ajouté" }).waitFor();
    const mime = (await read("conducteur")).questions.find((q) => q.kind === "mime");
    assert.deepEqual(mime.cards.map((c) => c.word), words, "La TV reçoit exactement les cartes retouchées");

    // Quiz : Animaux, puis Dinosaures coché en plus ; une question retirée avant l'ajout.
    await regie.click("#plan-add");
    await regie.locator('#lib-list [data-game="quiz/animaux"]').click();
    await regie.locator("#lib-name", { hasText: "Animaux" }).waitFor();
    await regie.locator('#lib-edit .lib-quiz[data-quiz="dino"]').click();
    await regie.locator("#lib-name", { hasText: "Animaux + Dinosaures" }).waitFor();
    await regie.locator("#lib-meta", { hasText: "3 questions" }).waitFor();
    await regie.locator("#lib-questions li", { hasText: "Combien de pattes" }).locator(".lib-x").click();
    await regie.locator("#lib-meta", { hasText: "2 questions" }).waitFor();
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "« Animaux + Dinosaures » est ajouté" }).waitFor();
    const added = (await read("conducteur")).questions.filter((q) => q.round === "Animaux + Dinosaures").map((q) => q.text);
    assert.deepEqual(added, ["Roi de la jungle ?", "Le T-Rex mangeait de la viande"]);
    assert.deepEqual((await library("quizzes")).animaux, ANIMAUX, "Quiz de la bibliothèque inchangé");
    await regie.context().close();
  });

  test("à la volée : un blind test complété titre par titre avec la recherche, une chanson choisie pour ouvrir les Statues", async () => {
    const hex = (k) => k.toString(16).padStart(16, "0");
    const titres = ["Libérée, délivrée", "Hakuna Matata", "Thriller", "Billie Jean", "Toxic", "Africa", "Imagine", "Yesterday", "Respect", "Hello", "Dancing Queen", "Wannabe", "Fame", "Beat It"];
    await seedLibrary("playlists", {
      disney: { title: "Disney", duration: 20, tracks: titres.slice(0, 2).map((title, k) => ({ title, audioId: hex(k + 1) })), updatedAt: 1 },
      tubes: { title: "Tubes", duration: 25, tracks: titres.slice(2).map((title, k) => ({ title, audioId: hex(k + 3) })), updatedAt: 1 },
    });
    box = startBox();
    await addTeam("rose", "Les Roses");
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game='blind/disney']").click();
    await regie.locator("#lib-meta", { hasText: "2 questions" }).waitFor();
    // La recherche (sans accents ni majuscules) ne garde que ce qui correspond, toutes playlists confondues.
    await regie.fill("#lib-search", "THRILL");
    await waitFor(async () => (await regie.locator("#lib-add option:not([value=''])").count()) === 1, "un seul titre trouvé");
    await capture(regie, "regie-blind-recherche");
    await regie.selectOption("#lib-add", { label: "Thriller" });
    await regie.locator("#lib-meta", { hasText: "3 questions" }).waitFor();
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "est ajouté" }).waitFor();
    const blind = (await read("conducteur")).questions.filter((q) => q.kind === "blind");
    assert.deepEqual(blind.map((q) => q.choices[0]), ["Libérée, délivrée", "Hakuna Matata", "Thriller"]);
    assert.equal(blind[2].duration, 25, "le titre garde la durée de sa playlist");

    // Statues sans liste à elles : la musique de la fête, ou une chanson cherchée dans les playlists, jouée en premier.
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game='builtin/statues']").click();
    await regie.locator("#lib-meta", { hasText: "Musique de la fête" }).waitFor();
    await regie.locator("#lib-add option", { hasText: "jouée en premier" }).waitFor({ state: "attached" });
    await regie.fill("#lib-search", "hakuna");
    await regie.selectOption("#lib-add", { label: "Hakuna Matata" });
    await regie.locator("#lib-meta", { hasText: "1 chanson à la suite · en premier : Hakuna Matata" }).waitFor();
    await capture(regie, "regie-statues-chanson");
    await regie.click("#lib-end");
    const statues = await waitFor(async () => (await read("conducteur")).questions.find((q) => q.kind === "statues"), "Statues ajoutées");
    assert.deepEqual(statues.audioIds, [hex(2)]);
    await regie.context().close();
  });

  test("en direct : Zoom mystère au hasard en photos de la banque et Qui a disparu ? en photos, photos copiées dans la partie", async () => {
    const { PHOTOS_BANQUE } = await import("../web/public/banque-photos.js");
    assert.ok(PHOTOS_BANQUE.size >= 5, "des photos de la banque sont sur le site");
    box = startBox();
    await addTeam("rose", "Les Roses");
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    // Zoom mystère au hasard : sans aucun quiz, les photos de la banque, avec leurs réponses en images.
    await regie.locator("#lib-list [data-game='hasard/zoom']").click();
    await regie.locator("#lib-meta", { hasText: "questions" }).waitFor();
    await capture(regie, "regie-zoom-photos");
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "est ajouté" }).waitFor();
    const zoom = (await read("conducteur")).questions.filter((q) => q.kind === "zoom");
    assert.ok(zoom.length >= 1);
    for (const q of zoom) {
      assert.match(q.imageId, /^[0-9a-f]{16}$/);
      assert.equal(q.banque, undefined, "la TV ne reçoit que l'identifiant de la photo");
      assert.equal(q.choices.length, 4);
      assert.match(await read(`images/${q.imageId}`), /^data:image\/jpeg;base64,/, "photo copiée dans la partie");
    }
    // Qui a disparu ? : « 📷 Photos » dans le tirage ; les objets de la banque ont leur photo, lisible par la TV.
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game='builtin/disparu']").click();
    await regie.locator("#lib-edit .lib-photos", { hasText: "📷 Photos" }).click();
    await regie.locator("#lib-edit .lib-photos.on", { hasText: "📷 Photos" }).waitFor();
    await capture(regie, "regie-disparu-photos");
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "Qui a disparu" }).waitFor();
    const grilles = (await read("conducteur")).questions.filter((q) => q.kind === "disparu");
    const photos = grilles.flatMap((q) => q.cards).filter((c) => c.imageId);
    assert.ok(photos.length > 0, "des objets en photos");
    assert.ok(grilles.flatMap((q) => q.cards).every((c) => !c.banque));
    assert.match(await read(`choiceImages/${photos[0].imageId}`), /^data:image\/jpeg;base64,/);
    await regie.context().close();
  });

  test("Régie PC : une manche de mimes composée dans une prestation, gardée toute seule dans la page du jeu, épinglée, puis reprise dans une prestation de 6 équipes", async () => {
    const page = await admin();
    // La page du jeu : son aperçu, ses manches, son historique ; on n'y compose plus de manche (cedric, 21/10).
    await page.locator('#home-games .tile[data-game=mimes]').click();
    await page.locator("#screen-game:not([hidden]) #game-h1", { hasText: "Mimes" }).waitFor();
    await page.locator("#manches-list", { hasText: "Aucune manche pour l'instant : elles arrivent ici quand vous composez une prestation." }).waitFor();
    assert.equal(await page.locator("#manche-new").count(), 0);
    assert.match(await page.locator("#game-apercu").getAttribute("src"), /apercus-jeux\/mimes\.mp4$/);
    assert.match(await page.locator("#game-manche-hint").textContent(), /« ＋ Ajouter un jeu »/);

    // Composée dans une prestation : 5 cartes par équipe × 4 équipes prévues = 20 cartes tirées au hasard.
    await page.click("#nav button[data-screen=home]");
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    await page.click("#round-add");
    await capture(page, "prestation-ajouter-un-jeu");
    await page.click('#jeu-choix .jeu-tuile[data-jeu="mimes"]');
    const composee = page.locator("#show-rounds .round").nth(0);
    await composee.locator("select.grow").selectOption("hasard");
    await composee.locator(".mime-per-team").selectOption("5");
    await composee.locator("button.pick-draw").click();
    await composee.locator(".pick-box .small", { hasText: "20 cartes choisies" }).waitFor();
    await page.locator('#show-rounds .jeu-bloc[data-jeu="mimes"] .jeu-plus').click();
    await page.locator("#show-rounds .round").nth(1).waitFor();
    await capture(page, "prestation-bloc-mimes");
    await page.locator("#show-rounds .round").nth(1).getByRole("button", { name: "✕", exact: true }).click();
    await waitFor(async () => (await page.locator("#show-rounds .round").count()) === 1, "manche retirée");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée." }).waitFor();
    await waitFor(async () => Object.keys((await library("manches")) ?? {}).length === 1, "manche gardée");
    const [id, saved] = Object.entries(await library("manches"))[0];
    const [showId] = Object.keys(await library("shows"));
    assert.equal(saved.type, "mimes");
    assert.equal(saved.title, "Mimes · Anniversaire de Léa");
    assert.equal(saved.origin, "admin");
    assert.equal(saved.showId, showId);
    assert.equal(saved.round.perTeam, 5);
    assert.equal(saved.round.cards.length, 20);
    assert.equal(new Set(saved.round.cards.map((c) => c.word)).size, 20, "Jamais deux fois la même carte");
    assert.equal((await library(`shows/${showId}`)).rounds[0].mancheId, id);
    // Réenregistrée sans changement : rien de plus ; changée : la même manche suit.
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée." }).waitFor();
    await composee.locator(".mime-per-team").selectOption("4");
    await composee.locator("button.pick-draw").click();
    await composee.locator(".pick-box .small", { hasText: "16 cartes choisies" }).waitFor();
    await composee.locator(".mime-per-team").selectOption("5");
    await composee.locator("button.pick-draw").click();
    await composee.locator(".pick-box .small", { hasText: "20 cartes choisies" }).waitFor();
    await page.click("#show-save");
    await waitFor(async () => JSON.stringify((await library(`manches/${id}`)).round.cards) !== JSON.stringify(saved.round.cards), "manche mise à jour");
    assert.equal(Object.keys(await library("manches")).length, 1);
    const tiree = (await library(`manches/${id}`)).round.cards;
    await waitFor(async () => JSON.stringify((await library(`shows/${showId}`)).rounds[0].cards) === JSON.stringify(tiree), "prestation enregistrée");
    await page.locator("#show-save:not([disabled])").waitFor();

    // Dans la page du jeu : la manche, épinglée en tête ; l'historique dit qu'elle est gardée.
    await openGamePage(page, "mimes");
    await page.locator(`#manches-list [data-manche="${id}"] button`, { hasText: "⭐ Épingler" }).click();
    await page.locator(`#manches-pinned [data-manche="${id}"]`, { hasText: "⭐ Épinglée" }).waitFor();
    assert.equal((await library(`manches/${id}`)).pinned, true);
    await page.locator("#manches-shows .manche-from-show", { hasText: "Gardée : « Mimes · Anniversaire de Léa »" }).waitFor();
    await capture(page, "page-jeu-mimes");

    // Prestation de 6 équipes : la manche chargée garde ses 20 cartes ; le reste se tire au lancement.
    await page.click("#nav button[data-screen=home]");
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    await page.selectOption("#show-teams", "6");
    await ajouterJeu(page, "mimes");
    const round = page.locator("#show-rounds .round").nth(0);
    await reprendre(round, id);
    await round.locator(".mime-need", { hasText: "5 par équipe × 6 équipes = 30 cartes · 20 choisies : le reste est tiré au hasard au lancement" }).waitFor();
    await aVenir(page);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    const show = Object.entries(await library("shows")).find(([k]) => k !== showId)[1];
    assert.equal(show.teams, 6);
    assert.equal(show.rounds[0].mancheId, id);
    assert.equal(show.rounds[0].perTeam, 5);
    assert.deepEqual(show.rounds[0].cards, tiree);
    // Reprise telle quelle : pas de nouvelle manche.
    assert.equal(Object.keys(await library("manches")).length, 1);
    await page.context().close();
  });

  test("Régie PC : 4 équipes par défaut, alerte rouge quand une manche n'a pas assez de mots pour les équipes (cedric, 21/10)", async () => {
    await seedLibrary("manches/peu", { type: "pictionary", title: "Cinq animaux", origin: "admin", updatedAt: 1,
      round: { type: "pictionary", duration: 60, picks: ["chat", "chien", "poisson", "serpent", "escargot"] } });
    const page = await admin();
    await page.click("#home-new");
    assert.equal(await page.locator("#show-teams").inputValue(), "4", "Nouvelle prestation : 4 équipes");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    await ajouterJeu(page, "pictionary");
    const round = page.locator("#show-rounds .round").nth(0);
    assert.equal(await round.locator(".alerte-equipes").count(), 0, "Mots au hasard : pas d'alerte");
    await reprendre(round, "peu");
    await round.locator(".alerte-equipes", { hasText: "⚠ Pictionary : 5 mots choisis pour 4 équipes, il en faut au moins 12 (3 par équipe)." }).waitFor();
    await capture(page, "alerte-equipes");
    // Moins d'équipes : l'alerte suit, puis disparaît.
    await page.selectOption("#show-teams", "2");
    await round.locator(".alerte-equipes", { hasText: "pour 2 équipes, il en faut au moins 6" }).waitFor();
    await page.selectOption("#show-teams", "1");
    await round.locator(".alerte-equipes").waitFor({ state: "detached" });
    // « Ça va exploser ! » à une seule équipe.
    await ajouterJeu(page, "patate");
    const bombe = page.locator("#show-rounds .round").nth(1);
    await bombe.locator(".alerte-equipes", { hasText: "« Ça va exploser ! » se joue à 2 équipes au moins" }).waitFor();
    // L'alerte n'empêche pas d'enregistrer.
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "enregistrée" }).waitFor();
    const show = Object.values(await library("shows"))[0];
    assert.equal(show.teams, 1);
    await page.selectOption("#show-teams", "4");
    await bombe.locator(".alerte-equipes").waitFor({ state: "detached" });
    await page.context().close();
  });

  test("Régie PC : recherche à chaque lettre dans les manches d'un jeu et les images, les noms qui commencent par le texte d'abord", async () => {
    await seedLibrary("manches", {
      t: { type: "chante", title: "Tomates et salades", origin: "admin", round: { type: "chante", count: 1, picks: ["soleil"] }, updatedAt: 4 },
      m: { type: "chante", title: "La marelle", origin: "admin", round: { type: "chante", count: 1, picks: ["chat"] }, updatedAt: 3 },
      a: { type: "chante", title: "Maman et moi", origin: "admin", round: { type: "chante", count: 1, picks: ["maman"] }, updatedAt: 2 },
      s: { type: "chante", title: "Soleil", origin: "admin", round: { type: "chante", count: 1, picks: ["lune"] }, updatedAt: 1 },
      v: { type: "chante", title: "Mamie", origin: "admin", archived: true, round: { type: "chante", count: 1, picks: ["chat"] }, updatedAt: 1 },
    });
    await seedLibrary("shows/zoe", { childName: "Zoé", date: "2026-11-12", status: "brouillon", updatedAt: 1, rounds: [{ type: "chante", count: 2, picks: ["chat", "lune"] }] });
    const page = await admin();
    await page.locator("#home-games .tile[data-game=chante]").click();
    await page.locator("#screen-game:not([hidden]) #game-h1", { hasText: "Chante le mot" }).waitFor();
    const ordre = () => page.locator("#manches-list [data-manche]").evaluateAll((l) => l.map((x) => x.dataset.manche));
    await page.locator('#manches-list [data-manche="s"]').waitFor();
    assert.deepEqual(await ordre(), ["t", "m", "a", "s"], "sans recherche : les plus récentes d'abord");
    // « ma » : Maman (commence par), La marelle (un mot commence par), Tomates (contient) ; Soleil disparaît.
    await page.locator("#manche-search").pressSequentially("ma");
    await page.locator("#manche-search-count", { hasText: "4 manches trouvées" }).waitFor();
    assert.deepEqual(await ordre(), ["a", "m", "t"]);
    assert.equal(await page.locator("#manches-archived-box").evaluate((d) => d.open), true, "l'archivée trouvée s'ouvre toute seule");
    await page.locator('#manches-archived [data-manche="v"]').waitFor();
    assert.equal(await page.locator("#manches-shows-count").textContent(), "0");
    // Le prénom d'une prestation retrouve ses manches.
    await page.fill("#manche-search", "zoe");
    await page.locator("#manche-search-count", { hasText: "1 manche trouvée" }).waitFor();
    await page.locator("#manches-list", { hasText: "Aucune de vos manches ne correspond" }).waitFor();
    assert.equal(await page.locator("#manches-shows-box").evaluate((d) => d.open), true);
    await page.locator("#manches-shows .manche-from-show", { hasText: "Anniversaire de Zoé" }).waitFor();
    await page.fill("#manche-search", "");
    await page.locator('#manches-list [data-manche="s"]').waitFor();
    assert.deepEqual(await ordre(), ["t", "m", "a", "s"]);
    assert.equal(await page.locator("#manche-search-count").textContent(), "");

    // Images : avec « ma », les noms qui commencent par « ma » d'abord, Tomate ensuite (pas cachée).
    await page.click("#nav button[data-screen=library]");
    await page.locator("#media-search").pressSequentially("ma");
    await page.locator("#media-count", { hasText: "images trouvées" }).waitFor();
    const noms = await page.locator('#media-list .media-group[data-groupe="photos"] .media-tile > span:last-child').allInnerTexts();
    assert.match(noms[0], /^ma/i);
    assert.ok(noms.includes("Tomate") && noms.indexOf("Maison") < noms.indexOf("Tomate"), noms.join(", "));
    assert.ok(noms.indexOf("Sous-marin") < noms.indexOf("Tomate"), "un mot qui commence par « ma » avant « contient ma »");
    await page.context().close();
  });

  test("en direct : une manche préparée, puis « Au hasard » et « Rejouer avec d'autres… » sans jamais rejouer un mot ; la manche tirée est gardée", async () => {
    await seedLibrary("manches", {
      soleil: { type: "chante", title: "Chansons du soleil", origin: "admin", pinned: true, round: { type: "chante", count: 2, picks: ["soleil", "maman"] }, updatedAt: 1 },
      vieille: { type: "chante", title: "Archivée", origin: "admin", archived: true, round: { type: "chante", count: 1, picks: ["chat"] }, updatedAt: 1 },
    });
    box = startBox();
    await addTeam("rose", "Les Roses");
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    // La manche épinglée est proposée, jamais l'archivée.
    await regie.locator("#lib-list .lib-section", { hasText: "Manches préparées" }).waitFor();
    await regie.locator("#lib-list [data-game='manche/soleil']", { hasText: "Chansons du soleil" }).locator("span", { hasText: "⭐ Chante le mot ! · 2 mots" }).waitFor();
    assert.equal(await regie.locator("#lib-list [data-game='manche/vieille']").count(), 0);
    await regie.locator("#lib-list [data-game='manche/soleil']").click();
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "est ajouté à la fin du programme" }).waitFor();
    const words = async () => (await read("conducteur")).questions.filter((q) => q.kind === "chante").map((q) => q.text.toLowerCase());
    assert.deepEqual(await words(), ["soleil", "maman"]);
    assert.equal(Object.keys(await library("manches")).length, 2, "Une manche préparée n'est pas recopiée");

    // « Chante le mot ! » au hasard : 6 mots, jamais soleil ni maman (déjà au programme) ; difficulté et nouveau tirage.
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game='builtin/chante']").click();
    await regie.locator("#lib-edit .lib-level.on", { hasText: "Moyen" }).waitFor();
    await regie.locator("#lib-edit .lib-level", { hasText: "Facile" }).click();
    await regie.locator("#lib-edit .lib-level.on", { hasText: "Facile" }).waitFor();
    await regie.click("#lib-draw");
    assert.equal(await regie.locator("#lib-questions li").count(), 6);
    await regie.click("#lib-end");
    await waitFor(async () => (await words()).length === 8, "6 mots ajoutés");
    let all = await words();
    assert.equal(all.length, 8);
    assert.equal(new Set(all).size, 8, "Jamais deux fois le même mot pendant la fête");
    // La manche tirée en direct est gardée dans la page du jeu (Régie PC), sans rien modifier d'autre.
    const direct = await waitFor(async () => Object.values(await library("manches")).find((m) => m.origin === "direct"), "manche gardée");
    assert.equal(direct.type, "chante");
    assert.deepEqual(direct.round.picks, all.slice(2));
    assert.match(direct.title, /^Chante le mot ! .*\(en direct, /);

    // La manche se joue : « 🔁 Rejouer » tire 6 nouveaux mots, encore jamais au programme.
    const plan = (await read("conducteur")).questions;
    const at = plan.findIndex((q) => q.kind === "chante" && q.text.toLowerCase() === all[2]);
    await box.set({ ...questionState(7), index: at, qid: plan[at].id, kind: "chante", text: plan[at].text, choices: plan[at].choices, total: plan.length });
    const head = regie.locator(`#panel-plan .plan-head[data-round="${plan[at].round}"]`);
    await head.locator(".state", { hasText: "en cours" }).waitFor();
    await head.locator("button.replay", { hasText: "🔁 Rejouer" }).click();
    await regie.locator("#lib-preview:not([hidden])").waitFor();
    assert.equal(await regie.locator("#lib-questions li").count(), 6);
    await regie.click("#lib-after");
    await waitFor(async () => (await words()).length === 14, "6 autres mots ajoutés");
    all = await words();
    assert.equal(all.length, 14);
    assert.equal(new Set(all).size, 14, "Toujours aucun mot rejoué");
    // Pictionary aussi s'ajoute en direct, ses mots tirés au hasard.
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game='builtin/pictionary']", { hasText: "Pictionary" }).locator("span", { hasText: "s de dessin par équipe" }).waitFor();
    await regie.locator("#lib-list [data-game='builtin/pictionary']").click();
    await regie.locator("#lib-meta", { hasText: "Pictionary · 24 mots" }).waitFor();
    await regie.click("#lib-end");
    const picto = await waitFor(async () => (await read("conducteur")).questions.find((q) => q.kind === "pictionary"), "Pictionary ajouté");
    assert.equal(new Set(picto.cards.map((c) => c.word)).size, 24);
    await regie.context().close();
  });

  test("en direct : « 🔁 Rejouer » dans tous les jeux (cedric, 21/10) : un quiz avec d'autres questions, Ça va exploser ! tel quel", async () => {
    await seedLibrary("quizzes/animaux", { title: "Animaux", updatedAt: 1,
      questions: Array.from({ length: 6 }, (_, i) => ({ text: `Animal ${i} ?`, choices: ["Oui", "Non"], correct: 0, status: "validee" })) });
    await seedLibrary("manches/trois", { type: "quiz", title: "Trois animaux", origin: "admin", updatedAt: 1, round: { type: "quiz", quizId: "animaux", count: 3 } });
    box = startBox();
    await addTeam("rose", "Les Roses");
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game='manche/trois']").click();
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "est ajouté à la fin du programme" }).waitFor();
    const textes = async () => (await read("conducteur")).questions.filter((q) => q.text?.startsWith("Animal")).map((q) => q.text);
    assert.deepEqual(await textes(), ["Animal 0 ?", "Animal 1 ?", "Animal 2 ?"]);
    // Le quiz est en cours : « 🔁 Rejouer » pose les 3 questions suivantes, jamais une déjà posée.
    let plan = (await read("conducteur")).questions;
    let at = plan.findIndex((q) => q.text === "Animal 0 ?");
    await box.set({ ...questionState(7), index: at, qid: plan[at].id, text: plan[at].text, choices: plan[at].choices, total: plan.length });
    const quiz = regie.locator(`#panel-plan .plan-head[data-round="${plan[at].round}"]`);
    await quiz.locator(".state", { hasText: "en cours" }).waitFor();
    await quiz.locator("button.replay", { hasText: "🔁 Rejouer" }).click();
    await regie.locator("#lib-preview:not([hidden])").waitFor();
    assert.deepEqual(await regie.locator("#lib-questions li").allTextContents().then((l) => l.map((x) => x.match(/Animal \d/)?.[0])), ["Animal 3", "Animal 4", "Animal 5"]);
    await regie.click("#lib-after");
    await waitFor(async () => (await textes()).length === 6, "3 autres questions ajoutées");
    assert.equal(new Set(await textes()).size, 6, "Jamais deux fois la même question");

    // Ça va exploser ! joué : « 🔁 Rejouer » le relance tel quel.
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game='builtin/patate']").click();
    await regie.click("#lib-end");
    const bombes = async () => (await read("conducteur")).questions.filter((q) => q.kind === "patate");
    await waitFor(async () => (await bombes()).length === 1, "Ça va exploser ! ajouté");
    plan = (await read("conducteur")).questions;
    at = plan.findIndex((q) => q.kind === "patate");
    await box.set({ ...questionState(9), index: at, qid: plan[at].id, kind: "patate", text: plan[at].text, choices: [], total: plan.length });
    const bombe = regie.locator(`#panel-plan .plan-head[data-round="${plan[at].round}"]`);
    await bombe.locator(".state", { hasText: "en cours" }).waitFor();
    await bombe.locator("button.replay", { hasText: /^🔁 Rejouer$/ }).click();
    await regie.locator("#lib-preview:not([hidden])").waitFor();
    await capture(regie, "rejouer-bombe");
    await regie.click("#lib-after");
    await waitFor(async () => (await bombes()).length === 2, "Ça va exploser ! relancé");
    await regie.context().close();
  });

  test("en direct : « 🔁 Rejouer » un Quiz illustré (cedric, 21/10) : réponses en photos de la banque ou en émojis, jamais les images de cedric", async () => {
    const PNG = `data:image/png;base64,${png([200, 120, 60]).toString("base64")}`;
    const siennes = (n) => [0, 1, 2, 3].map((k) => `${n}${k}`.repeat(8));
    const q = (text, choices, n) => ({ text, choices, correct: 0, status: "validee", choiceImages: siennes(n) });
    await seedLibrary("quizzes/petits", { title: "Les petits", kind: "photo", source: "banque", updatedAt: 1, questions: [
      q("Où est le chat ?", ["Chat", "Chien", "Vache", "Lion"], 1),
      q("Où est le lion ?", ["Lion", "Chat", "Chien", "Vache"], 2),
      // Ni dans la banque ni émoji : jamais reprise au hasard.
      q("Où est le doudou ?", ["Doudou", "Chien", "Vache", "Lion"], 3),
      // Le bonnet n'a pas de photo sur le site : son émoji dessiné.
      q("Où est le bonnet ?", ["Bonnet", "Cochon", "Lapin", "Canard"], 4),
      q("Où est le mouton ?", ["Mouton", "Poule", "Ours", "Coq"], 5),
    ] });
    const toutes = [1, 2, 3, 4, 5].flatMap(siennes);
    await seedLibrary("images", Object.fromEntries(toutes.map((id) => [id, PNG])));
    await seedLibrary("manches/petits", { type: "illustre", title: "Deux pour les petits", origin: "admin", updatedAt: 1, round: { type: "illustre", quizId: "petits", count: 2 } });
    box = startBox();
    await addTeam("rose", "Les Roses");
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game='manche/petits']").click();
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "est ajouté à la fin du programme" }).waitFor();
    const petits = async () => (await read("conducteur")).questions.filter((x) => x.text?.startsWith("Où est"));
    // Choisi à la main : les images de cedric, copiées dans la partie.
    assert.deepEqual((await petits()).map((x) => [x.text, x.choiceImages]), [["Où est le chat ?", siennes(1)], ["Où est le lion ?", siennes(2)]]);
    await waitFor(async () => { const c = (await read("choiceImages")) ?? {}; return [...siennes(1), ...siennes(2)].every((id) => c[id] === PNG); }, "ses images copiées");
    // Le Quiz illustré est en cours : « 🔁 Rejouer » reprend 2 questions au hasard, sans celle du doudou.
    const plan = (await read("conducteur")).questions;
    const at = plan.findIndex((x) => x.text === "Où est le chat ?");
    await box.set({ ...questionState(7), index: at, qid: plan[at].id, text: plan[at].text, choices: plan[at].choices, total: plan.length });
    const jeu = regie.locator(`#panel-plan .plan-head[data-round="${plan[at].round}"]`);
    await jeu.locator(".state", { hasText: "en cours" }).waitFor();
    await jeu.locator("button.replay", { hasText: "🔁 Rejouer" }).click();
    await regie.locator("#lib-preview:not([hidden])").waitFor();
    assert.deepEqual(await regie.locator("#lib-questions li").allTextContents().then((l) => l.map((x) => x.match(/Où est le \w+ \?/)?.[0])), ["Où est le bonnet ?", "Où est le mouton ?"]);
    assert.equal(await regie.locator("#lib-problems").isHidden(), true);
    await regie.click("#lib-after");
    await waitFor(async () => (await petits()).length === 4, "2 questions reprises");
    const rejouees = (await petits()).slice(2);
    assert.deepEqual(rejouees.map((x) => x.text), ["Où est le bonnet ?", "Où est le mouton ?"]);
    // Dans le programme de la TV : seulement des identifiants d'images libres, toutes copiées dans la partie (la TV et les
    // pupitres les lisent dans games/<code>/choiceImages, comme celles d'un quiz choisi à la main).
    const copiees = (await read("choiceImages")) ?? {};
    for (const x of rejouees) {
      assert.equal(x.choiceBanque, undefined);
      assert.equal(x.choiceImages.length, 4);
      for (const id of x.choiceImages) {
        assert.match(id, /^[0-9a-f]{16}$/);
        assert.ok(!toutes.includes(id), `jamais une image de cedric (${x.text})`);
        assert.match(copiees[id] ?? "", /^data:image\/jpeg;base64,/, "copiée dans la partie");
      }
    }
    // Les photos de la banque du site (leur empreinte) ; le bonnet, sans photo sur le site : son émoji dessiné.
    const empreinte = (cle) => createHash("sha256").update(`data:image/jpeg;base64,${readFileSync(join(PUBLIC, `banque/${cle}.jpg`)).toString("base64")}`).digest("hex").slice(0, 16);
    assert.deepEqual(rejouees[1].choiceImages, ["mouton", "poule", "ours", "coq"].map(empreinte));
    assert.deepEqual(rejouees[0].choiceImages.slice(1), ["cochon", "lapin", "canard"].map(empreinte));
    assert.equal(existsSync(join(PUBLIC, "banque/bonnet.jpg")), false);
    assert.equal(new Set(rejouees.flatMap((x) => x.choiceImages)).size, 8);
    await capture(regie, "rejouer-quiz-illustre");
    await regie.context().close();
  });

  test("« 🔁 Rejouer » de l'écran principal (cedric, 21/10) : les jeux déjà lancés, un quiz sans quiz à cocher, ✕, « ▶ Rejouer maintenant »", async () => {
    await seedLibrary("quizzes", {
      animaux: { title: "Animaux", updatedAt: 1, questions: Array.from({ length: 6 }, (_, i) => ({ text: `Animal ${i} ?`, choices: ["Oui", "Non"], correct: 0, status: "validee" })) },
      dino: { title: "Dinosaures", updatedAt: 1, questions: [{ text: "Le T-Rex ?", choices: ["Oui", "Non"], correct: 0, status: "validee" }] },
    });
    await seedLibrary("manches/trois", { type: "quiz", title: "Trois animaux", origin: "admin", updatedAt: 1, round: { type: "quiz", quizId: "animaux", count: 3 } });
    box = startBox();
    await addTeam("rose", "Les Roses");
    await setPresence("rose", true);
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game='manche/trois']").click();
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "est ajouté à la fin du programme" }).waitFor();
    const textes = async () => (await read("conducteur")).questions.filter((q) => q.text?.startsWith("Animal")).map((q) => q.text);
    // Au salon, rien n'a été lancé : pas de « 🔁 Rejouer ».
    assert.equal(await regie.locator("#c-replay").isHidden(), true);
    const plan = (await read("conducteur")).questions;
    const at = plan.findIndex((q) => q.text === "Animal 1 ?");
    await box.set({ ...questionState(7), index: at, qid: plan[at].id, text: plan[at].text, choices: plan[at].choices, total: plan.length });

    // Sur l'écran principal, à côté de « ＋ Jeu » : la liste des jeux déjà lancés, et rien d'autre.
    await regie.locator("#c-replay:not([hidden])", { hasText: "🔁 Rejouer" }).click();
    await regie.locator("#lib-title", { hasText: "Rejouer un jeu" }).waitFor();
    const jeux = regie.locator("#lib-list .rejouable");
    await jeux.first().waitFor();
    // Les jeux du programme de départ sont « Déjà joué », le quiz ajouté est « En cours ».
    const etats = await jeux.locator("span").allTextContents();
    assert.deepEqual([etats.at(-1), etats.slice(0, -1).every((e) => e === "Déjà joué")], ["En cours", true], JSON.stringify(etats));
    const quiz = jeux.filter({ hasText: "En cours" });
    assert.equal(await regie.locator("#lib-list [data-game]").count(), 0, "pas la bibliothèque entière");
    // Le quiz : d'autres questions, jamais une déjà posée ; pas de quiz à cocher, pas de réglages, juste ✕.
    await quiz.click();
    await regie.locator("#lib-preview:not([hidden])").waitFor();
    assert.deepEqual(await regie.locator("#lib-questions li").allTextContents().then((l) => l.map((x) => x.match(/Animal \d/)?.[0])), ["Animal 3", "Animal 4", "Animal 5"]);
    assert.equal(await regie.locator("#lib-edit .lib-quiz").count(), 0, "pas de quiz à cocher");
    assert.equal(await regie.locator("#lib-edit .lib-level, #lib-add").count(), 0, "pas de réglages du tirage");
    assert.equal(await regie.locator("#lib-end").isHidden(), true);
    await regie.locator("#lib-after", { hasText: "Après le jeu en cours" }).waitFor();
    await capture(regie, "rejouer-quiz-simple");
    // « Choisir un autre jeu » revient à la liste des jeux lancés.
    await regie.click("#lib-back");
    await quiz.click();
    await regie.locator("#lib-questions li").nth(2).waitFor();
    await regie.locator("#lib-questions li", { hasText: "Animal 4" }).locator(".lib-x").click();
    assert.equal(await regie.locator("#lib-questions li").count(), 2);
    // « ▶ Rejouer maintenant » : les 2 questions juste après le quiz en cours, et la TV y va tout de suite.
    const avant = box.gotos.length;
    await regie.click("#lib-now");
    await regie.locator("#r-toast", { hasText: "C'est reparti pour" }).waitFor();
    await regie.locator("#lib").waitFor({ state: "hidden" });
    assert.deepEqual(await textes(), ["Animal 0 ?", "Animal 1 ?", "Animal 2 ?", "Animal 3 ?", "Animal 5 ?"]);
    const nouveau = (await read("conducteur")).questions;
    const debut = nouveau.findIndex((q) => q.text === "Animal 3 ?");
    assert.deepEqual(box.gotos.slice(avant), [{ index: debut, qid: nouveau[debut].id }]);
    // Petit téléphone : le jeu en cours sur sa ligne, « ＋ Jeu », « 🔁 Rejouer » et « ⏭ Changer de jeu » dessous, sans débordement.
    await regie.setViewportSize({ width: 360, height: 740 });
    const boutons = await regie.locator(".games-row .rescue-open:not([hidden])").evaluateAll((l) => l.map((b) => ({ texte: b.innerText, deborde: b.scrollWidth > b.clientWidth + 1, droite: b.getBoundingClientRect().right })));
    assert.ok(boutons.length >= 3 && boutons.every((b) => !b.deborde && b.droite <= 360), JSON.stringify(boutons));
    await capture(regie, "rejouer-ecran-principal-360");
    await regie.context().close();
  });

  test("Régie PC : Ctrl+Z défait la dernière action, « Annuler les modifications » revient au dernier enregistrement", async () => {
    const page = await admin();
    // Paquet de mimes : des cartes ajoutées et retirées, rien n'est écrit avant « Enregistrer ».
    await page.click(".tile[data-screen=mimes]");
    await page.click("#game-tabs [data-tab=collections]");
    await page.click("#mime-new");
    const bar = page.locator("#screen-mime-edit .retour-barre.bas");
    const count = () => page.locator("#mime-count").textContent();
    // En haut et en bas : « ← Retour » (page précédente) et « Annuler les modifications », rien à annuler pour l'instant.
    assert.deepEqual(await page.locator("#screen-mime-edit .retour-barre.haut button").allInnerTexts(), ["← Retour", "Annuler les modifications"]);
    assert.deepEqual(await bar.locator("button").allInnerTexts(), ["← Retour", "Annuler les modifications"]);
    assert.equal(await bar.locator(".retour-tout").isDisabled(), true);
    await page.fill("#mime-title", "Animaux");
    await page.locator("#mime-catalog .mime-card", { hasText: "Chat" }).click();
    await page.locator("#mime-catalog .mime-card", { hasText: "Éléphant" }).click();
    await page.locator("#mime-catalog .mime-card", { hasText: "Lapin" }).click();
    await waitFor(async () => (await count()) === "3", "3 cartes");
    await page.keyboard.press("Control+z");
    await waitFor(async () => (await count()) === "2", "Ctrl+Z : le lapin repart");
    assert.equal(await page.locator("#mime-picked .mime-card", { hasText: "Lapin" }).count(), 0);
    await page.click("#mime-save");
    await page.locator("#mime-status", { hasText: "Enregistré : 2 cartes" }).waitFor();
    assert.equal(await bar.locator(".retour-tout").isDisabled(), true, "Rien à annuler juste après l'enregistrement");
    await page.locator("#mime-catalog .mime-card", { hasText: "Lapin" }).click();
    await page.locator("#mime-picked .mime-card", { hasText: "Chat" }).click();
    await page.fill("#mime-title", "Zoo");
    await page.locator("#mime-title").blur();
    await waitFor(async () => !(await bar.locator(".retour-tout").isDisabled()), "Annuler possible");
    await bar.locator(".retour-tout").click();
    await waitFor(async () => (await count()) === "2", "Annuler : retour aux 2 cartes enregistrées");
    assert.equal(await page.inputValue("#mime-title"), "Animaux");
    assert.deepEqual(Object.values(await library("mimes"))[0].cards.map((c) => c.word), ["Chat", "Éléphant"], "La bibliothèque n'a pas bougé");
    // Annuler est une action comme une autre : un Ctrl+Z rend les modifications.
    await page.keyboard.press("Control+z");
    await waitFor(async () => (await page.inputValue("#mime-title")) === "Zoo", "Ctrl+Z après Annuler");
    assert.equal(await count(), "2");
    assert.equal(await page.locator("#mime-picked .mime-card", { hasText: "Lapin" }).count(), 1);

    // Quitter avec des modifications pas enregistrées : la Régie PC demande d'abord.
    const question = repondreFenetre(page);
    // Page Jeux (enregistrée à chaque touche) : Ctrl+Z remet le mot retiré, dans la bibliothèque aussi.
    await openGamePage(page, "chante", "collections");
    assert.match(await question, /Quitter sans enregistrer \?/);
    await page.locator('#builtin-items .content-item.on[data-key="soleil"] .content-toggle').click();
    await page.locator("#builtin-status", { hasText: "« soleil » est retiré du jeu." }).waitFor();
    assert.deepEqual((await library("contents")).chante.off, ["soleil"]);
    await page.keyboard.press("Control+z");
    await page.locator("#builtin-status", { hasText: "Modification annulée." }).waitFor();
    await page.locator('#builtin-items .content-item.on[data-key="soleil"]').waitFor();
    assert.equal((await library("contents")).chante.off ?? null, null);

    // Prestation : une manche ajoutée puis défaite au clavier (Ctrl+Z hors d'un champ).
    await page.click("#nav button[data-screen=home]");
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.locator("#show-child").blur();
    await ajouterJeu(page);
    await ajouterJeu(page, "mimes");
    await waitFor(async () => (await page.locator("#show-rounds .round").count()) === 2, "2 manches");
    await page.keyboard.press("Control+z");
    await waitFor(async () => (await page.locator("#show-rounds .round").count()) === 1, "Ctrl+Z : une manche de moins");
    await page.locator("#screen-show-edit .retour-barre.bas .retour-tout").click();
    await waitFor(async () => (await page.locator("#show-rounds .round").count()) === 0, "Annuler : fiche vide");
    assert.equal(await page.inputValue("#show-child"), "");
    await page.context().close();
  });

  test("Régie PC : la flèche du navigateur et « ← Retour » ramènent à la page précédente ; quitter une page modifiée demande d'abord", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    await seedLibrary("shows", { lea: { childName: "Léa", age: 7, date: "2099-12-02", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 } });
    const page = await admin();
    // Accueil → liste « À venir » → la prestation de Léa.
    await page.click('#screen-home [data-etat="avenir"]');
    await page.locator('#show-list [data-show="lea"]').getByRole("button", { name: "Ouvrir" }).click();
    await page.locator("#screen-show-edit:not([hidden])").waitFor();
    // Flèche du navigateur : la liste, puis l'Accueil, sans quitter le site ; la flèche « avancer » revient.
    await page.goBack();
    await page.locator("#screen-shows:not([hidden])").waitFor();
    assert.equal(await page.textContent("#shows-h1"), "Anniversaires à venir");
    await page.goBack();
    await page.locator("#screen-home:not([hidden])").waitFor();
    await page.goForward();
    await page.locator("#screen-shows:not([hidden])").waitFor();
    await page.goForward();
    await page.locator("#screen-show-edit:not([hidden])").waitFor();
    assert.equal(await page.inputValue("#show-child"), "Léa");
    // Une modification pas enregistrée : la flèche demande ; « Rester » garde la page et la modification.
    await page.fill("#show-age", "8");
    let question = repondreFenetre(page, { accepter: false });
    await page.goBack();
    assert.match(await question, /Quitter sans enregistrer \?/);
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#screen-show-edit").isVisible(), true);
    assert.equal(await page.inputValue("#show-age"), "8");
    // « ← Retour » en haut, puis « Quitter » : la liste, et rien n'est enregistré.
    question = repondreFenetre(page);
    await page.locator("#screen-show-edit .retour-barre.haut .retour-page").click();
    await question;
    await page.locator("#screen-shows:not([hidden])").waitFor();
    assert.equal((await library("shows/lea")).age, 7);
    // Rouverte : la modification abandonnée n'est pas restée. « ← Retour » en bas, sans modification : pas de question.
    await page.locator('#show-list [data-show="lea"]').getByRole("button", { name: "Ouvrir" }).click();
    assert.equal(await page.inputValue("#show-age"), "7");
    await page.locator("#screen-show-edit .retour-barre.bas .retour-page").click();
    await page.locator("#screen-shows:not([hidden])").waitFor();
    // Les autres pages aussi : création d'un quiz, puis une manche d'un jeu.
    await openQuizzes(page);
    await page.click("#quiz-import-open");
    await page.locator("#screen-import .retour-barre.haut .retour-page").click();
    await page.locator("#screen-quizzes:not([hidden])").waitFor();
    await seedLibrary("manches/gouter", { type: "chante", title: "Chansons du goûter", origin: "admin", round: { type: "chante", count: 4 }, updatedAt: 1 });
    await openGamePage(page, "chante");
    await page.locator('.manche-card[data-manche="gouter"]').getByRole("button", { name: "Éditer" }).click();
    await page.locator("#screen-manche-edit:not([hidden])").waitFor();
    await page.locator("#screen-manche-edit .retour-barre.bas .retour-page").click();
    await page.locator("#screen-game:not([hidden])").waitFor();
    assert.equal(await page.textContent("#game-title"), "Chante le mot !");
    // Après un rechargement, les pages d'avant ne rouvrent rien d'autre que l'Accueil.
    await page.reload();
    await page.locator("#screen-home:not([hidden])").waitFor();
    await page.click('#screen-home [data-etat="avenir"]');
    await page.locator("#screen-shows:not([hidden])").waitFor();
    await page.goBack();
    await page.locator("#screen-home:not([hidden])").waitFor();
    await page.goBack();
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#screen-home").isVisible(), true, "Une page d'avant le rechargement ramène à l'Accueil");
    await page.context().close();
  });

  test("Régie PC : Dupliquer une manche ou une collection de cartes ajoute la copie à sa liste, sans l'ouvrir", async () => {
    const page = await admin();
    await seedLibrary("manches/gouter", { type: "patate", title: "Patate du goûter", origin: "admin", round: { type: "patate" }, updatedAt: 1 });
    await openGamePage(page, "patate");
    await page.locator(".manche-card", { hasText: "Patate du goûter" }).getByRole("button", { name: "Dupliquer" }).click();
    await page.locator("#game-status", { hasText: "« Copie de Patate du goûter » est ajoutée à vos manches." }).waitFor();
    await page.locator(".manche-card.copie-recente", { hasText: "Copie de Patate du goûter" }).waitFor();
    assert.equal(await page.locator("#screen-manche-edit").isHidden(), true);
    const titres = Object.values(await library("manches")).map((m) => [m.title, m.type, m.origin]).sort();
    assert.deepEqual(titres, [["Copie de Patate du goûter", "patate", "admin"], ["Patate du goûter", "patate", "admin"]]);
    // Une collection de cartes de mimes.
    await openGamePage(page, "mimes", "collections");
    await page.click("#mime-new");
    await page.fill("#mime-title", "Animaux");
    await page.locator("#mime-catalog .mime-card", { hasText: "Chat" }).click();
    await page.click("#mime-save");
    await page.locator("#mime-status", { hasText: "Enregistré" }).waitFor();
    await page.locator("#screen-mime-edit .retour-barre.haut .retour-page").click();
    await page.locator("#screen-mimes:not([hidden])").waitFor();
    await page.locator("#mime-list .item", { hasText: "Animaux" }).getByRole("button", { name: "Dupliquer" }).click();
    await page.locator("#mime-list .item.copie-recente", { hasText: "Copie de Animaux" }).waitFor();
    assert.equal(await page.locator("#mime-list .item").first().locator("b").textContent(), "Copie de Animaux");
    assert.equal(await page.locator("#screen-mime-edit").isHidden(), true);
    assert.deepEqual(Object.values(await library("mimes")).map((d) => [d.title, d.cards.map((c) => c.word)]).sort(), [["Animaux", ["Chat"]], ["Copie de Animaux", ["Chat"]]]);
    await page.context().close();
  });

  test("Régie PC : l'accueil montre les 16 jeux par famille, chacun mène à ce qui se prépare", async () => {
    const page = await admin();
    assert.equal(await page.locator("#home-games .tile").count(), 16);
    assert.equal(await page.locator("#home-games h3").count(), 4);
    assert.equal(await page.locator("#home-import").count(), 0, "Importer un quiz : seulement dans la rubrique Quiz");
    // Chaque tuile ouvre la page du jeu (ses manches) ; l'onglet Collections mène à son contenu.
    await page.locator('#home-games .tile[data-game=patate]', { hasText: "Rien à préparer" }).click();
    await page.locator("#screen-game:not([hidden]) #game-h1", { hasText: "Ça va exploser" }).waitFor();
    assert.equal(await page.locator("#game-tabs [data-tab=collections]").count(), 0, "Rien à préparer : pas de collections");
    await page.click("#nav button[data-screen=home]");
    await page.locator('#home-games .tile[data-game=chante]').click();
    await page.click("#game-tabs [data-tab=collections]");
    await page.locator("#screen-builtin:not([hidden])").waitFor();
    await page.locator("#screen-builtin [data-tabs] [data-tab=manches]").click();
    await page.locator("#screen-game:not([hidden]) #game-h1", { hasText: "Chante le mot" }).waitFor();
    await page.click("#nav button[data-screen=home]");
    await page.locator('#home-games .tile[data-game=flou]').click();
    await page.click("#game-tabs [data-tab=collections]");
    await page.locator("#screen-quizzes:not([hidden])").waitFor();
    await page.context().close();
  });

  test("Régie PC : trois listes (À venir, À compléter, Archivées) ouvertes par les compteurs ; rechercher par prénom, âge, date ou jeu", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    await seedLibrary("shows", {
      lea: { childName: "Léa", age: 9, date: "2099-12-02", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 },
      hugo: { childName: "Hugo", age: 7, date: "2025-06-14", status: "archivee", rounds: [{ type: "patate" }], updatedAt: 1 },
      zoe: { childName: "Zoé", age: 10, date: "2025-03-01", status: "brouillon", rounds: [], updatedAt: 1 },
    });
    const page = await admin();
    // Plus d'onglet « Prestations » : trois compteurs sur l'Accueil, un par état.
    assert.deepEqual(await page.locator("#nav button").allInnerTexts(), ["Accueil", "Bibliothèque", "Paramètres"]);
    await page.locator("#stat-avenir", { hasText: "1" }).waitFor();
    assert.equal(await page.textContent("#stat-acompleter"), "0");
    assert.equal(await page.textContent("#stat-archivee"), "2", "Hugo archivé, et Zoé dont la date est passée");
    await page.click('#screen-home [data-etat="avenir"]');
    await page.locator("#shows-h1", { hasText: "Anniversaires à venir" }).waitFor();
    assert.equal(await page.textContent("#shows-crumb"), "Anniversaires à venir");
    const search = async (q) => { await page.fill("#show-search", q); return page.locator("#show-search-count").textContent(); };
    // Hugo n'est pas à venir : la liste le dit, et mène aux archivées en un clic, la recherche gardée.
    assert.equal(await search("hugo"), "0 prestation trouvée");
    await page.locator('#show-ailleurs [data-ailleurs="archivee"]', { hasText: "Archivées (1)" }).click();
    await page.locator("#shows-h1", { hasText: "Archivées" }).waitFor();
    assert.equal(await page.inputValue("#show-search"), "hugo");
    await page.locator('#show-list [data-show="hugo"]').waitFor();
    assert.equal(await page.textContent("#show-search-count"), "1 prestation trouvée");
    assert.equal(await search("juin"), "1 prestation trouvée");
    assert.equal(await search("14/06"), "1 prestation trouvée");
    assert.equal(await search("exploser"), "1 prestation trouvée");
    assert.equal(await search("2025"), "2 prestations trouvées");
    // Zoé : brouillon dont la fête est passée, rangée d'elle-même dans les archivées.
    await page.locator('#show-list [data-show="zoe"]').waitFor();
    assert.equal(await search("zoe 11"), "0 prestation trouvée");
    await page.locator("#show-list", { hasText: "Aucune prestation de cette liste ne correspond" }).waitFor();
    // Les onglets passent d'une liste à l'autre ; une autre liste repart d'une recherche vide.
    await page.click('#shows-tabs [data-etat="avenir"]');
    await page.locator("#shows-h1", { hasText: "Anniversaires à venir" }).waitFor();
    assert.equal(await page.inputValue("#show-search"), "");
    assert.equal(await search("lea 9"), "1 prestation trouvée");
    await page.locator('#show-list [data-show="lea"]').waitFor();
    assert.equal(await search("animaux"), "1 prestation trouvée");
    // Le logo ramène à l'Accueil, comme le bouton « Accueil ».
    await page.click("#brand");
    await page.locator("#screen-home:not([hidden])").waitFor();
    assert.equal(await page.locator("#brand small").textContent(), "Administration");
    await page.context().close();
  });

  test("Régie PC : plus de confirm(), alert() ni prompt() du navigateur dans admin.js et retour.js", () => {
    for (const fichier of ["admin.js", "retour.js"]) {
      const restes = readFileSync(join(PUBLIC, fichier), "utf8").split("\n").map((l, i) => `${i + 1} : ${l.trim()}`).filter((l) => /\b(confirm|alert|prompt)\(/.test(l));
      assert.deepEqual(restes, [], `${fichier} : fenêtres du navigateur restantes`);
    }
  });

  test("Régie PC : les questions s'ouvrent dans une fenêtre aux couleurs du site, plus celle du navigateur ; Annuler et Échap ne touchent à rien ; elle tient sur un téléphone", async () => {
    const C = "00112233445566ff";
    await seedLibrary(`sounds/${C}`, "data:audio/mpeg;base64,SUQz");
    await seedLibrary("songs/s9", { title: "Vieille chanson", audioId: C, buzz: 30, retiree: true, updatedAt: 1 });
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    await seedLibrary("shows", {
      tom: { childName: "Tom", status: "brouillon", rounds: [], updatedAt: 1 },
      lea: { childName: "Léa", status: "brouillon", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 },
    });
    const page = await admin();
    // Aucune fenêtre grise du navigateur (« … indique ») : notée ici si jamais elle revenait.
    const natives = [];
    page.on("dialog", (d) => { natives.push(d.message()); d.dismiss().catch(() => {}); });
    const fenetre = page.locator("dialog[data-fenetre][open]");
    // Sur le PC d'abord.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="sons"]');
    await page.locator("#song-retirees", { hasText: "🗑 Supprimées (1)" }).click();
    const effacer = page.locator("#song-list .song", { hasText: "Vieille chanson" }).getByRole("button", { name: "Effacer pour de bon" });

    // « Effacer pour de bon » : la question en titre, l'explication dessous ; le bouton rouge dit ce qu'il fait et a le
    // focus ; fond blanc des cartes, coins arrondis et voile violet du site.
    await effacer.click();
    await fenetre.waitFor();
    assert.deepEqual(await fenetre.locator(".fenetre-message p").allInnerTexts(), ["Effacer « Vieille chanson » pour de bon ?",
      "La chanson entière, les paroles et les extraits sont effacés en ligne (sauf les extraits qu'une playlist utilise encore). On ne pourra plus la remettre."]);
    assert.equal(await fenetre.locator(".fenetre-message p").first().getAttribute("class"), "fenetre-titre");
    assert.deepEqual(await fenetre.locator(".fenetre-boutons .btn").allInnerTexts(), ["Effacer pour de bon", "Annuler"]);
    assert.equal(await fenetre.locator("[data-fenetre-ok]").getAttribute("class"), "btn danger");
    assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute("data-fenetre-ok")), true);
    assert.deepEqual(await fenetre.evaluate((d) => [getComputedStyle(d).backgroundColor, getComputedStyle(d).borderRadius, getComputedStyle(d, "::backdrop").backgroundColor]),
      ["rgb(255, 255, 255)", "22px", "rgba(40, 20, 60, 0.55)"]);
    await capture(page, "fenetre-pc", { pleinePage: false });
    // Annuler : rien n'est effacé.
    await fenetre.locator("[data-fenetre-annuler]").click();
    await fenetre.waitFor({ state: "detached" });
    assert.equal((await library("songs/s9")).title, "Vieille chanson", "Annuler : rien n'est effacé");
    // Échap : comme Annuler.
    await effacer.click();
    await fenetre.waitFor();
    await page.keyboard.press("Escape");
    await fenetre.waitFor({ state: "detached" });
    assert.equal((await library("songs/s9")).title, "Vieille chanson", "Échap : rien n'est effacé");

    // Sur un téléphone (360 px de large) : la fenêtre tient dans l'écran, sans rien de coupé ni qui dépasse.
    await page.setViewportSize({ width: 360, height: 740 });
    await effacer.click();
    await fenetre.waitFor();
    const mesure = await fenetre.evaluate((d) => {
      const r = d.getBoundingClientRect();
      const coupes = [...d.querySelectorAll("p, button")].filter((x) => {
        const b = x.getBoundingClientRect();
        return b.left < r.left || b.right > r.right + 0.5 || x.scrollWidth > x.clientWidth + 1;
      }).map((x) => x.textContent);
      return { gauche: r.left, droite: r.right, haut: r.top, bas: r.bottom, largeur: innerWidth, hauteur: innerHeight, deborde: d.scrollWidth > d.clientWidth, coupes };
    });
    assert.ok(mesure.gauche >= 8 && mesure.droite <= mesure.largeur - 8 && mesure.haut >= 0 && mesure.bas <= mesure.hauteur, `fenêtre dans l'écran : ${JSON.stringify(mesure)}`);
    assert.equal(mesure.deborde, false, "rien ne dépasse sur le côté");
    assert.deepEqual(mesure.coupes, [], "aucun texte coupé");
    await capture(page, "fenetre-telephone", { pleinePage: false });
    // Le bouton rouge efface pour de bon.
    await fenetre.locator("[data-fenetre-ok]").click();
    await page.locator("#song-status", { hasText: "« Vieille chanson » est effacée pour de bon." }).waitFor();
    assert.equal(await library("songs/s9"), null);

    // Retirer un jeu rempli d'une prestation : la fenêtre demande ; le retrait est noté aussitôt (« Annuler les
    // modifications » s'allume, Ctrl+Z remet le jeu).
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.click("#nav button[data-screen=home]");
    await page.click('#screen-home [data-etat="acompleter"]');
    await page.locator('#show-list [data-show="lea"]').getByRole("button", { name: "Ouvrir" }).click();
    await page.locator("#screen-show-edit:not([hidden])").waitFor();
    const annulerTout = page.locator("#screen-show-edit .retour-barre.bas .retour-tout");
    assert.equal(await annulerTout.isDisabled(), true);
    const retirerJeu = page.locator('#show-rounds .jeu-bloc[data-jeu="quiz"] button[title="Retirer ce jeu"]');
    await retirerJeu.click();
    assert.match(await repondreFenetre(page, { accepter: false }), /^Retirer « .+ » et sa manche de la prestation \?$/);
    assert.equal(await page.locator("#show-rounds .round").count(), 1, "Annuler : le jeu reste");
    await retirerJeu.click();
    await repondreFenetre(page);
    await waitFor(async () => (await page.locator("#show-rounds .round").count()) === 0, "jeu retiré");
    await waitFor(async () => !(await annulerTout.isDisabled()), "« Annuler les modifications » possible aussitôt");
    await page.keyboard.press("Control+z");
    await waitFor(async () => (await page.locator("#show-rounds .round").count()) === 1, "Ctrl+Z : le jeu revient");
    assert.equal(await annulerTout.isDisabled(), true);
    await page.click("#show-edit-crumb");

    // Renommer : le nom actuel tout sélectionné, prêt à être remplacé ; Entrée vaut OK.
    await page.locator('#show-list [data-show="tom"]').getByRole("button", { name: "Renommer" }).click();
    await fenetre.waitFor();
    const champ = fenetre.locator("[data-fenetre-texte]");
    assert.equal(await champ.inputValue(), "Anniversaire de Tom");
    assert.equal(await champ.evaluate((c) => document.activeElement === c && c.selectionStart === 0 && c.selectionEnd === c.value.length), true);
    assert.deepEqual(await fenetre.locator(".fenetre-boutons .btn").allInnerTexts(), ["Renommer", "Annuler"]);
    await capture(page, "fenetre-renommer", { pleinePage: false });
    await page.keyboard.type("La fête de Tom");
    await page.keyboard.press("Enter");
    await fenetre.waitFor({ state: "detached" });
    await page.locator('#show-list [data-show="tom"] .card-title', { hasText: "La fête de Tom" }).waitFor();
    assert.equal((await library("shows/tom")).title, "La fête de Tom");
    assert.deepEqual(natives, [], "aucune fenêtre du navigateur");
    await page.context().close();
  });

  test("Régie PC : « Renommer » sur une prestation, un quiz, un paquet de mimes et une playlist, rien d'autre ne change", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    await seedLibrary("mimes", { zoo: { title: "Zoo", duration: 60, cards: [{ word: "Chat", image: "🐱" }], updatedAt: 1 } });
    await seedLibrary("playlists", { tubes: { title: "Tubes", duration: 20, tracks: [{ title: "Frère Jacques", audioId: "0123456789abcdef" }], updatedAt: 1 } });
    await seedLibrary("shows", { lea: { childName: "Léa", age: 9, status: "brouillon", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 } });
    const page = await admin();
    const renommer = async (item, name) => {
      await item.getByRole("button", { name: "Renommer" }).click();
      await repondreFenetre(page, { texte: name });
    };
    await page.click('#screen-home [data-etat="acompleter"]');
    await renommer(page.locator('#show-list [data-show="lea"]'), "  La grande fête   de Léa ");
    await page.locator('#show-list [data-show="lea"] .card-title', { hasText: "La grande fête de Léa" }).waitFor();
    const lea = (await library("shows")).lea;
    assert.equal(lea.title, "La grande fête de Léa");
    assert.deepEqual([lea.childName, lea.status, lea.rounds[0].quizId], ["Léa", "brouillon", "animaux"]);
    // Annulé ou vide : rien n'est écrit.
    await page.locator('#show-list [data-show="lea"]').getByRole("button", { name: "Renommer" }).click();
    await repondreFenetre(page, { accepter: false });
    await renommer(page.locator('#show-list [data-show="lea"]'), "   ");
    assert.equal((await library("shows")).lea.title, "La grande fête de Léa");

    await openQuizzes(page);
    await renommer(page.locator('#quiz-list [data-quiz="animaux"]'), "Les animaux de la ferme");
    await page.locator('#quiz-list [data-quiz="animaux"]', { hasText: "Les animaux de la ferme" }).waitFor();
    const quiz = (await library("quizzes")).animaux;
    assert.equal(quiz.title, "Les animaux de la ferme");
    assert.equal(quiz.questions.length, ANIMAUX.questions.length);
    // « Éditer » ouvre le quiz (l'ancien « Relire »).
    await page.locator('#quiz-list [data-quiz="animaux"]').getByRole("button", { name: "Éditer" }).click();
    assert.equal(await page.inputValue("#rv-title"), "Les animaux de la ferme");
    assert.equal(await page.locator("#screen-review .crumbs b").textContent(), "Éditer");

    await page.click("#nav button[data-screen=home]");
    await page.click(".tile[data-screen=mimes]");
    await page.click("#game-tabs [data-tab=collections]");
    await renommer(page.locator('#mime-list [data-deck="zoo"]'), "Animaux du zoo");
    await page.locator('#mime-list [data-deck="zoo"]', { hasText: "Animaux du zoo" }).waitFor();
    assert.deepEqual((await library("mimes")).zoo.cards, [{ word: "Chat", image: "🐱" }]);

    await page.click("#nav button[data-screen=home]");
    await page.click(".tile[data-screen=music]");
    await page.click("#game-tabs [data-tab=collections]");
    await renommer(page.locator('#playlist-list [data-playlist="tubes"]'), "Comptines");
    await page.locator('#playlist-list [data-playlist="tubes"]', { hasText: "Comptines" }).waitFor();
    assert.equal((await library("playlists")).tubes.tracks[0].title, "Frère Jacques");
    await page.context().close();
  });

  test("Régie PC : quiz de photos, le nom de chaque fichier devient sa réponse, puis il se choisit pour l'Image floue", async () => {
    const page = await admin();
    await openQuizzes(page);
    await page.setInputFiles("#quiz-photos", [
      { name: "tour-eiffel.png", mimeType: "image/png", buffer: png([200, 40, 40]) },
      { name: "chat.png", mimeType: "image/png", buffer: png([40, 200, 40]) },
      { name: "lune.png", mimeType: "image/png", buffer: png([40, 40, 200]) },
    ]);
    await page.locator("#rv-status", { hasText: "3 photos prêtes" }).waitFor();
    assert.equal(await page.inputValue("#rv-title"), "Mes photos");
    assert.equal(await page.locator("#rv-list .qcard").count(), 3);
    const first = page.locator('#rv-list .qcard[data-q="0"]');
    const choices = await first.locator(".q-choice").evaluateAll((els) => els.map((e) => e.value).filter(Boolean));
    assert.deepEqual([...choices].sort(), ["Chat", "Lune", "Tour eiffel"]);
    await page.fill("#rv-title", "Monuments et animaux");
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "Enregistré : 3 questions validées sur 3" }).waitFor();
    const [id, quiz] = Object.entries(await library("quizzes"))[0];
    assert.equal(quiz.source, "photos");
    assert.ok(quiz.questions.every((q) => /^[0-9a-f]{16}$/.test(q.imageId) && q.status === "validee"));
    assert.deepEqual(quiz.questions.map((q) => q.choices[q.correct]), ["Tour eiffel", "Chat", "Lune"]);
    // Image floue : le quiz est proposé avec ses 3 photos.
    await page.click("#nav button[data-screen=home]");
    await page.click("#home-new");
    await ajouterJeu(page, "flou");
    await page.locator("#show-rounds .round").nth(0).locator("select.grow option", { hasText: "Monuments et animaux (3 avec photo)" }).waitFor({ state: "attached" });
    await page.locator("#show-rounds .round").nth(0).locator("select.grow").selectOption(id);
    await page.locator("#show-summary", { hasText: "3 questions" }).waitFor();
    await page.context().close();
  });

  test("Vrai ou Faux express : manche choisie dans l'admin, affirmations seules, ajout en direct, TV trop ancienne prévenue", async () => {
    const SCIENCES = {
      title: "Sciences", source: "tableur", updatedAt: 1,
      questions: [
        { text: "Le Soleil est une étoile", choices: ["Vrai", "Faux"], correct: 0, status: "validee" },
        { text: "Les poissons respirent hors de l'eau", choices: ["Vrai", "Faux"], correct: 1, status: "validee" },
        { text: "Planète la plus proche du Soleil ?", choices: ["Mercure", "Mars"], correct: 0, status: "validee" },
      ],
    };
    await seedLibrary("quizzes", { sciences: SCIENCES });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    await ajouterJeu(page, "express");
    await page.locator("#show-rounds .round").nth(0).locator("select.grow option", { hasText: "Sciences (2 Vrai / Faux)" }).waitFor({ state: "attached" });
    await page.locator("#show-rounds .round").nth(0).locator("select.grow").selectOption("sciences");
    await aVenir(page);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    assert.deepEqual(await sansManche(Object.values(await library("shows"))[0].rounds), [{ type: "express", quizId: "sciences" }]);
    await page.context().close();

    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Anniversaire de Léa" }).click();
    // Fenêtre de lancement, sur le téléphone seulement : « Lancer » confirme.
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const questions = (await read("show")).quiz.questions;
    assert.deepEqual(questions.map((q) => [q.kind, q.duration, q.round]), [["express", 9, "Vrai ou Faux express"], ["express", 9, "Vrai ou Faux express"]]);
    // En direct : proposé dans les mini-jeux pour chaque quiz qui a des Vrai / Faux.
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game='express/sciences']", { hasText: "Vrai ou Faux express : Sciences" }).locator("span", { hasText: "2 affirmations" }).waitFor();
    // TV d'avant le Vrai ou Faux express : la régie le dit, rien n'est envoyé.
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/conducteur/express`), null));
    const before = (await read("conducteur")).questions.length;
    await regie.locator("#lib-list [data-game='express/sciences']").click();
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "pour jouer au Vrai ou Faux express" }).waitFor();
    assert.equal((await read("conducteur")).questions.length, before);
    await regie.context().close();
  });

  test("Zoom mystère : proposé pour un quiz avec photos, ses photos copiées dans la partie, TV trop ancienne prévenue", async () => {
    const PHOTO = "0123456789abcdef";
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await seedLibrary("quizzes", {
      zoo: { title: "Zoo", source: "tableur", updatedAt: 1, questions: [{ text: "Quel animal ?", choices: ["Chat", "Lion"], correct: 1, imageId: PHOTO, status: "validee" }] },
    });
    await seedLibrary("images", { [PHOTO]: PNG });
    await seedLibrary("shows", { lea: { childName: "Léa", age: 9, status: "publiee", rounds: [{ type: "zoom", quizId: "zoo" }], updatedAt: 1 } });
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Léa" }).click();
    // Fenêtre de lancement, sur le téléphone seulement : « Lancer » confirme.
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const [q] = (await read("show")).quiz.questions;
    assert.deepEqual([q.kind, q.imageId, q.round], ["zoom", PHOTO, "Zoom mystère"]);
    await waitFor(async () => (await read(`images/${PHOTO}`)) === PNG, "photo copiée dans la partie");
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game='zoom/zoo']", { hasText: "Zoom mystère : Zoo" }).locator("span", { hasText: "1 photo" }).waitFor();
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/conducteur/zoom`), null));
    await regie.locator("#lib-list [data-game='zoom/zoo']").click();
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "pour jouer au Zoom mystère" }).waitFor();
    await regie.context().close();
  });

  test("Quiz illustré : sa tuile et ses quiz à part, sa manche dans une prestation, la TV l'ouvre sur « Quiz illustré » ; une ancienne manche Quiz d'un quiz illustré en devient un", async () => {
    const PNG = `data:image/png;base64,${png([200, 120, 60]).toString("base64")}`;
    const ids = ["1111111111111111", "2222222222222222", "3333333333333333", "4444444444444444"];
    const PETITS = {
      title: "Les animaux des petits", kind: "photo", source: "banque", updatedAt: 1,
      questions: [
        { text: "Où est le chat ?", choices: ["Chat", "Chien", "Vache", "Lion"], correct: 0, status: "validee", choiceImages: ids },
        { text: "Où est le lion ?", choices: ["Chat", "Chien", "Vache", "Lion"], correct: 3, status: "validee", choiceImages: ids },
      ],
    };
    await seedLibrary("quizzes", { animaux: ANIMAUX, petits: PETITS });
    await seedLibrary("images", Object.fromEntries(ids.map((id) => [id, PNG])));
    // Prestation d'avant la tuile : le quiz illustré était dans une manche « Quiz ».
    await seedLibrary("shows", { lea: { childName: "Léa", age: 5, date: "2099-12-02", status: "publiee", rounds: [{ type: "quiz", quizId: "petits", finale: 1 }, { type: "quiz", quizId: "animaux" }], updatedAt: 1 } });
    const page = await admin();
    // Chaque tuile compte ses quiz ; chaque page ne montre que les siens.
    await page.locator('#screen-home .tile[data-game="illustre"]', { hasText: "1 quiz · 2 questions validées" }).waitFor();
    await page.locator('#screen-home .tile[data-game="quiz"]', { hasText: "1 quiz · 2 questions validées" }).waitFor();
    await openQuizzes(page, "illustre");
    assert.deepEqual(await page.locator("#quiz-list .item").evaluateAll((els) => els.map((e) => e.dataset.quiz)), ["petits"]);
    assert.equal(await page.textContent("#quizzes-crumb"), "Quiz illustré");
    await page.locator("#banque-open").waitFor();
    await openQuizzes(page);
    assert.deepEqual(await page.locator("#quiz-list .item").evaluateAll((els) => els.map((e) => e.dataset.quiz)), ["animaux"]);

    // La page du jeu : son aperçu, pas de création de manche (elles se composent dans les prestations).
    await openGamePage(page, "illustre");
    await page.locator("#game-h1", { hasText: "📷 Quiz illustré" }).waitFor();
    assert.match(await page.locator("#game-apercu").getAttribute("src"), /apercus-jeux\/illustre\.mp4$/);

    // L'ancienne prestation s'ouvre avec un Quiz illustré (Super Finale gardée) et s'enregistre ainsi.
    await page.click("#nav button[data-screen=home]");
    await page.click('#screen-home [data-etat="avenir"]');
    await page.locator('#show-list [data-show="lea"]').getByRole("button", { name: "Ouvrir" }).click();
    const premiere = page.locator("#show-rounds .round").nth(0);
    assert.deepEqual(await page.locator("#show-rounds .jeu-bloc").evaluateAll((l) => l.map((x) => x.dataset.jeu)), ["illustre", "quiz"]);
    assert.equal(await premiere.locator("select.finale").inputValue(), "1");
    assert.deepEqual(await premiere.locator(".quiz-picks select").first().locator("option").evaluateAll((o) => o.map((x) => x.value)), ["", "petits"]);
    // Le Quiz ne propose pas le quiz illustré.
    const seconde = page.locator("#show-rounds .round").nth(1);
    assert.deepEqual(await seconde.locator("select.quiz-rappel option").evaluateAll((o) => o.map((x) => x.value)), ["", "animaux"]);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    // Ses deux manches sont gardées dans la page de leur jeu ; la prestation garde le lien.
    await waitFor(async () => Object.keys((await library("manches")) ?? {}).length === 2, "manches gardées");
    const [mancheId, manche] = Object.entries(await library("manches")).find(([, m]) => m.type === "illustre");
    assert.deepEqual([manche.round, manche.showId], [{ type: "illustre", quizId: "petits", finale: 1 }, "lea"]);
    await waitFor(async () => (await library("shows/lea")).rounds[0].mancheId === mancheId, "lien vers la manche");
    assert.deepEqual((await library("shows/lea")).rounds[0], { type: "illustre", quizId: "petits", finale: 1, mancheId });
    await page.context().close();

    // La TV : le jeu s'appelle « Quiz illustré » (écran d'ouverture), réponses en images copiées dans la partie.
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Léa" }).click();
    // Fenêtre de lancement, sur le téléphone seulement : « Lancer » confirme.
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const show = await read("show");
    assert.deepEqual(show.rounds.map((r) => r.title), ["Quiz illustré", "Animaux"]);
    // La question des bougies va dans le premier Quiz classique, jamais dans le Quiz illustré.
    assert.deepEqual(show.quiz.questions.map((q) => [q.round, q.choiceImages?.length ?? 0, !!q.finale, /bougies/.test(q.text)]), [["Quiz illustré", 4, false, false], ["Quiz illustré", 4, true, false], ["Animaux", 0, false, false], ["Animaux", 0, false, false], ["Animaux", 0, false, true]]);
    await waitFor(async () => Object.keys((await read("choiceImages")) ?? {}).length === 4, "réponses en images copiées dans la partie");
    // En direct : le quiz illustré est proposé en Quiz illustré (avec sa manche), jamais en Quiz.
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    await regie.locator("#lib-list [data-game='illustre/petits']", { hasText: "Quiz illustré : Les animaux des petits" }).waitFor();
    await regie.locator(`#lib-list [data-game='manche/${mancheId}']`, { hasText: "Quiz illustré" }).waitFor();
    await regie.locator("#lib-list [data-game='quiz/animaux']").waitFor();
    assert.equal(await regie.locator("#lib-list [data-game='quiz/petits']").count(), 0);
    await regie.context().close();
  });

  test("tableau de bord : trois compteurs, les prochains anniversaires « À venir », dupliquer depuis une liste sans toucher l'original, archiver", async () => {
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    const LEA = { childName: "Léa", age: 7, date: day(10), status: "publiee", themes: "Licornes", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 };
    await seedLibrary("shows", {
      lea: LEA,
      tom: { childName: "Tom", date: day(3), status: "brouillon", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 },
      vieux: { childName: "Ancien", age: 8, date: "2020-01-01", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 },
    });
    const page = await admin();
    // À venir : Léa (prête) ; à compléter : Tom (brouillon) ; archivée : l'ancienne fête de 2020.
    await page.locator("#stat-avenir", { hasText: "1" }).waitFor();
    assert.equal(await page.textContent("#stat-acompleter"), "1");
    assert.equal(await page.textContent("#stat-archivee"), "1");
    // Prochains anniversaires : seulement les « À venir », avec Ouvrir, Renommer, Archiver (pas Dupliquer).
    assert.deepEqual(await page.locator("#home-upcoming .show-card").evaluateAll((els) => els.map((e) => e.dataset.show)), ["lea"]);
    const carte = page.locator('#home-upcoming [data-show="lea"]');
    await carte.locator(".pill", { hasText: "✓ À venir : visible sur la régie" }).waitFor();
    assert.deepEqual(await carte.locator(".card-actions button").allInnerTexts(), ["Ouvrir", "Renommer", "Archiver"]);
    // Sur téléphone, rien ne dépasse de l'écran.
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Défilement horizontal sur téléphone");
    // À compléter : Tom, avec ce qui lui manque.
    await page.click('#screen-home [data-etat="acompleter"]');
    const tom = page.locator('#show-list [data-show="tom"]');
    await tom.locator(".todo", { hasText: "Indiquer l'âge" }).waitFor();
    assert.match(await tom.textContent(), /dans 3 jours/);

    // Dupliquer, depuis la liste « À venir » : la copie (mêmes manches) apparaît en tête de « À compléter », sans
    // s'ouvrir ; l'original ne bouge pas.
    await page.click('#shows-tabs [data-etat="avenir"]');
    await page.locator('#show-list [data-show="lea"]').getByRole("button", { name: "Dupliquer" }).click();
    await page.locator("#shows-status", { hasText: "« Copie de « Anniversaire de Léa » » est ajoutée ici." }).waitFor();
    assert.equal(await page.textContent("#shows-h1"), "À compléter");
    assert.equal(await page.locator("#screen-show-edit").isHidden(), true, "La copie ne s'ouvre pas");
    const premiere = page.locator("#show-list .show-card").first();
    assert.match(await premiere.getAttribute("class"), /copie-recente/);
    assert.equal(await premiere.locator(".card-title").textContent(), "Copie de « Anniversaire de Léa »");
    const copieId = await premiere.getAttribute("data-show");
    const copiee = await library(`shows/${copieId}`);
    assert.deepEqual([copiee.status, copiee.childName, copiee.age, copiee.date, copiee.themes, copiee.copieDe], ["brouillon", undefined, undefined, undefined, "Licornes", "Anniversaire de Léa"]);
    assert.deepEqual(copiee.rounds, LEA.rounds);
    // Une copie s'enregistre même incomplète, et garde son nom tant qu'elle n'a pas de prénom.
    await premiere.getByRole("button", { name: "Ouvrir" }).click();
    assert.equal(await page.inputValue("#show-child"), "");
    assert.equal(await page.locator("#show-themes").count(), 0, "Plus de case « Thèmes » (cedric, 23/10)");
    await page.fill("#show-notes", "Pour qui ?");
    // Avec « Enregistrer » en haut de la fiche, le message se voit sans descendre (cedric, 23/10).
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click("#show-save-haut");
    await page.locator("#show-status-msg", { hasText: "Enregistrée." }).waitFor();
    await page.locator("#annonce.ok", { hasText: "✓ Enregistrée." }).waitFor();
    const annonce = await page.locator("#annonce").boundingBox();
    const hauteur = await page.evaluate(() => window.innerHeight);
    assert.ok(annonce && annonce.y >= 0 && annonce.y + annonce.height <= hauteur, `Message hors de l'écran : ${JSON.stringify(annonce)}`);
    assert.equal(await page.textContent("#show-edit-title"), "Copie de « Anniversaire de Léa »");
    assert.deepEqual([(await library(`shows/${copieId}`)).notes, (await library(`shows/${copieId}`)).copieDe], ["Pour qui ?", "Anniversaire de Léa"]);
    assert.equal((await library(`shows/${copieId}`)).themes, "Licornes", "Le thème d'une ancienne prestation n'est pas effacé");
    // « À venir » sans prénom, âge ni date : refusé, elle reste « À compléter » et le message dit ce qui manque.
    await page.selectOption("#show-status", "publiee");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "il manque : Indiquer le prénom de l'enfant · Ajouter la date · Indiquer l'âge." }).waitFor();
    await page.locator("#annonce:not(.ok)", { hasText: "il manque : Indiquer le prénom de l'enfant" }).waitFor();
    assert.equal(await page.inputValue("#show-status"), "brouillon");
    await page.fill("#show-child", "Zoé");
    await page.fill("#show-age", "9");
    await page.fill("#show-date", day(20));
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée." }).waitFor();
    const shows = await library("shows");
    const zoe = Object.values(shows).find((s) => s.childName === "Zoé");
    assert.equal(zoe.status, "brouillon");
    assert.deepEqual(await sansManche(zoe.rounds), LEA.rounds);
    assert.deepEqual(shows.lea, LEA, "Prestation d'origine inchangée");
    await page.locator("#show-ready", { hasText: "Passer le statut à « À venir »" }).waitFor();
    // « À venir » avec tout rempli : enregistrée et visible sur la régie.
    await aVenir(page);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée « À venir » : elle est visible sur la régie." }).waitFor();
    assert.equal(await page.textContent("#show-edit-crumb"), "Anniversaires à venir");

    // Une prestation incomplète ne passe pas « À venir » : elle reste « À compléter », rien n'est perdu.
    await page.click("#brand");
    await page.click("#home-new");
    await page.fill("#show-child", "Noé");
    await page.selectOption("#show-status", "publiee");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée en « À compléter » : pour passer en « À venir », il manque : Ajouter la date · Indiquer l'âge · Ajouter une manche." }).waitFor();
    assert.equal(await page.inputValue("#show-status"), "brouillon");
    const noe = Object.values(await library("shows")).find((s) => s.childName === "Noé");
    assert.equal(noe.status, "brouillon");
    // Une date passée non plus (elle filerait directement dans les archivées).
    await page.fill("#show-age", "6");
    await page.fill("#show-date", day(-5));
    await ajouterJeu(page);
    await page.locator("#show-rounds select.grow").nth(0).selectOption("animaux");
    await page.selectOption("#show-status", "publiee");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "il manque : Choisir une date à venir (celle-ci est passée)." }).waitFor();

    // Archiver depuis l'Accueil, après confirmation : Léa quitte les prochains anniversaires et rejoint les archivées.
    await page.click("#brand");
    let question = repondreFenetre(page, { accepter: false });
    await page.locator('#home-upcoming [data-show="lea"]').getByRole("button", { name: "Archiver" }).click();
    assert.match(await question, /^Archiver « .*Léa.* » \?\n\nElle quittera la régie/);
    assert.equal((await library("shows/lea/status")), "publiee");
    question = repondreFenetre(page);
    await page.locator('#home-upcoming [data-show="lea"]').getByRole("button", { name: "Archiver" }).click();
    await question;
    await page.locator('#home-upcoming [data-show="lea"]').waitFor({ state: "detached" });
    assert.equal((await library("shows/lea/status")), "archivee");
    // Léa archivée à la main ; l'ancienne fête de 2020 et Noé (date passée) rangées d'elles-mêmes.
    await page.locator("#stat-archivee", { hasText: "3" }).waitFor();
    await page.click('#screen-home [data-etat="archivee"]');
    await page.locator('#show-list [data-show="lea"]').waitFor();
    await page.locator('#show-list [data-show="vieux"]').waitFor();
    assert.equal(await page.locator("#show-list .show-card").count(), 3);
    await page.context().close();
  });

  test("un brouillon ou une archivée se supprime depuis sa carte, jamais une fête à venir ; pas de « Désarchiver » ; une fête reprogrammée s'archivera de nouveau", async () => {
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
    const rounds = [{ type: "quiz", quizId: "animaux" }];
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    await seedLibrary("shows", {
      brouillon: { childName: "Tom", status: "brouillon", rounds, updatedAt: 1 },
      prete: { childName: "Léa", age: 7, date: day(10), status: "publiee", rounds, updatedAt: 1 },
      passee: { childName: "Malo", age: 9, date: day(-3), status: "publiee", rounds, updatedAt: 1 },
      // Désarchivée avant la décision du 21/10 : gardée hors des archives malgré sa date passée.
      remise: { childName: "Nina", age: 8, date: day(-3), status: "brouillon", keepActive: true, rounds, updatedAt: 1 },
    });
    const page = await admin();
    // À compléter : « Supprimer » sur la carte, avec une confirmation ; « Annuler » ne touche à rien.
    await page.click('#screen-home [data-etat="acompleter"]');
    const tom = page.locator('#show-list [data-show="brouillon"]');
    let question = repondreFenetre(page, { accepter: false });
    await tom.getByRole("button", { name: "Supprimer" }).click();
    assert.match(await question, /Supprimer « Anniversaire de Tom » \?/);
    assert.equal((await library("shows/brouillon")).childName, "Tom");
    question = repondreFenetre(page);
    await tom.getByRole("button", { name: "Supprimer" }).click();
    await question;
    await page.locator("#shows-status", { hasText: "« Anniversaire de Tom » est supprimée." }).waitFor();
    await tom.waitFor({ state: "detached" });
    assert.equal(await library("shows/brouillon"), null);
    // Pas de « Supprimer » sur une fête annoncée (cedric, 21/10) : ni dans « À venir », ni dans les prochains anniversaires.
    await page.click('#shows-tabs [data-etat="avenir"]');
    await page.locator('#show-list [data-show="prete"]').waitFor();
    assert.equal(await page.locator('#show-list [data-show="prete"]').getByRole("button", { name: "Supprimer" }).count(), 0);
    await page.click("#brand");
    await page.locator('#home-upcoming [data-show="prete"]').waitFor();
    assert.equal(await page.locator('#home-upcoming [data-show="prete"]').getByRole("button", { name: "Supprimer" }).count(), 0);
    // Elle s'archive d'abord ; dans les archives, « Supprimer » l'efface, après une confirmation.
    await page.click('#screen-home [data-etat="archivee"]');
    const malo = page.locator('#show-list [data-show="passee"]');
    await malo.waitFor();
    // Pas de « Désarchiver » (cedric, 21/10) : une fête archivée se réutilise avec « Dupliquer ».
    assert.deepEqual(await malo.locator(".card-actions button").allInnerTexts(), ["Ouvrir", "Dupliquer", "Renommer", "⭐ Épingler", "Supprimer"]);
    question = repondreFenetre(page, { accepter: false });
    await malo.getByRole("button", { name: "Supprimer" }).click();
    assert.match(await question, /Supprimer « Anniversaire de Malo » \? Elle sera effacée pour de bon\./);
    assert.equal((await library("shows/passee")).childName, "Malo");
    question = repondreFenetre(page);
    await malo.getByRole("button", { name: "Supprimer" }).click();
    await question;
    await malo.waitFor({ state: "detached" });
    assert.equal(await library("shows/passee"), null);
    // Une fête désarchivée avant cette décision reste « À compléter » tant que sa date est passée.
    await page.click('#shows-tabs [data-etat="acompleter"]');
    await page.locator('#show-list [data-show="remise"]').getByRole("button", { name: "Ouvrir" }).click();
    // Reprogrammée et remise « À venir » : le lendemain de la nouvelle date, elle s'archivera de nouveau.
    // « Enregistrer » est aussi en haut de la fiche (cedric, 21/10) : il enregistre comme celui du bas.
    await page.fill("#show-date", day(5));
    await page.selectOption("#show-status", "publiee");
    await page.click("#screen-show-edit .retour-barre.haut #show-save-haut");
    await page.locator("#show-status-msg", { hasText: "Enregistrée « À venir »" }).waitFor();
    const reprogrammee = await library("shows/remise");
    assert.deepEqual([reprogrammee.status, reprogrammee.keepActive ?? null], ["publiee", null]);
    // Plus de « Supprimer » dans la fiche d'une prestation, quel que soit son état.
    assert.equal(await page.locator("#screen-show-edit").getByRole("button", { name: "Supprimer", exact: true }).count(), 0);
    await capture(page, "prestation-enregistrer-haut-telephone");
    if (process.env.CAPTURES) {
      await page.setViewportSize({ width: 1366, height: 900 });
      await capture(page, "prestation-enregistrer-haut-pc");
    }
    await page.context().close();
  });

  test("Régie PC (cedric, 23/10) : « Titre affiché » se remplit tout seul avec « Anniversaire de » et le prénom, et reste modifiable", async () => {
    await seedLibrary("shows", {
      ancienne: { childName: "Léa", age: 7, status: "brouillon", rounds: [], updatedAt: 1 },
      perso: { childName: "Hugo", age: 8, title: "La boum de Hugo", status: "brouillon", rounds: [], updatedAt: 1 },
    });
    const page = await admin();
    await page.click("#home-new");
    assert.equal(await page.inputValue("#show-title"), "");
    await page.fill("#show-child", "Frédéric");
    assert.equal(await page.inputValue("#show-title"), "Anniversaire de Frédéric");
    await page.fill("#show-child", "Emma");
    assert.equal(await page.inputValue("#show-title"), "Anniversaire d'Emma");
    // Un titre écrit à la main ne bouge plus quand le prénom change ; vidé, il suit de nouveau le prénom.
    await page.fill("#show-title", "La fête des licornes");
    await page.fill("#show-child", "Emmy");
    assert.equal(await page.inputValue("#show-title"), "La fête des licornes");
    await page.fill("#show-title", "");
    await page.fill("#show-child", "Jules");
    assert.equal(await page.inputValue("#show-title"), "Anniversaire de Jules");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée." }).waitFor();
    const jules = Object.values(await library("shows")).find((s) => s.childName === "Jules");
    assert.equal(jules.title, "Anniversaire de Jules");
    assert.equal(await page.textContent("#show-edit-title"), "Anniversaire de Jules");
    // Une prestation déjà faite sans titre le reçoit à l'ouverture ; un titre choisi par Sarah est gardé.
    await page.click("#brand");
    await page.click('#screen-home [data-etat="acompleter"]');
    await page.locator('#show-list [data-show="ancienne"]').getByRole("button", { name: "Ouvrir" }).click();
    assert.equal(await page.inputValue("#show-title"), "Anniversaire de Léa");
    await page.click("#brand");
    await page.click('#screen-home [data-etat="acompleter"]');
    await page.locator('#show-list [data-show="perso"]').getByRole("button", { name: "Ouvrir" }).click();
    assert.equal(await page.inputValue("#show-title"), "La boum de Hugo");
    await page.fill("#show-child", "Hugo-Louis");
    assert.equal(await page.inputValue("#show-title"), "La boum de Hugo");
    await page.context().close();
  });

  test("Régie PC (cedric, 23/10) : une manche se crée d'abord ; « Reprendre » montre les 10 dernières prestations et cherche partout (mot, prénom, date, note)", async () => {
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
    const fr = (d) => d.split("-").reverse().join("/");
    const PRENOMS = ["Ana", "Ben", "Cléo", "Dan", "Eva", "Félix", "Gina", "Hugo", "Inès", "Jade", "Kenzo", "Lison"];
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    // 12 prestations, de la plus récente (hier) à la plus ancienne ; la 11e a une note sur sa manche, la 12e est archivée.
    await seedLibrary("shows", Object.fromEntries(PRENOMS.map((p, k) => [`s${k + 1}`, {
      childName: p, age: 8, date: day(-1 - k), status: k === 11 ? "archivee" : "publiee", updatedAt: 1,
      rounds: [{ type: "mimes", random: true, ...(k === 10 ? { note: "Super avec les jumeaux" } : {}) }],
    }])));
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    // Un jeu dont la manche se reprend en entier (le Quiz, lui, en reprend les questions : voir le test du Quiz en une manche).
    await ajouterJeu(page, "mimes");
    const round = page.locator("#show-rounds .round").nth(0);
    // Créer d'abord : les champs de la manche, puis sa note, puis seulement « Reprendre ».
    assert.equal(await round.locator(".manche-load").count(), 0);
    assert.equal(await round.evaluate((r) => !!(r.querySelector(".round-body").compareDocumentPosition(r.querySelector(".reprendre-zone")) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
    await round.locator(".round-head", { hasText: "Nouvelle manche : choisissez son contenu" }).waitFor();
    // D'office : les 10 dernières prestations, la plus récente en tête.
    await round.locator(".reprendre-ouvrir").click();
    await round.locator(".reprendre-groupe", { hasText: "Des 10 dernières prestations" }).waitFor();
    const affichees = await round.locator(".reprise-item").evaluateAll((xs) => xs.map((x) => x.dataset.reprise));
    assert.deepEqual(affichees, PRENOMS.slice(0, 10).map((_, k) => `s${k + 1}/0`));
    await capture(page, "reprendre-une-manche-liste");
    if (process.env.CAPTURES) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await capture(page, "reprendre-une-manche-liste-pc");
      await page.setViewportSize({ width: 390, height: 844 });
    }
    // La recherche fouille tout, archives comprises : une note, un prénom, une date.
    const cherche = round.locator(".reprendre-cherche");
    await cherche.fill("jumeaux");
    await round.locator(".reprendre-groupe", { hasText: "1 manche trouvée" }).waitFor();
    await round.locator('.reprise-item[data-reprise="s11/0"]', { hasText: "📝 Super avec les jumeaux" }).waitFor();
    await cherche.fill("lison");
    await round.locator('.reprise-item[data-reprise="s12/0"]').waitFor();
    assert.equal(await round.locator(".reprise-item").count(), 1);
    await cherche.fill(fr(day(-12)));
    await round.locator('.reprise-item[data-reprise="s12/0"]').waitFor();
    assert.equal(await round.locator(".reprise-item").count(), 1);
    await cherche.fill("introuvable");
    await round.locator(".reprendre-groupe", { hasText: "Aucune manche ne correspond." }).waitFor();
    // Reprise de la manche notée : la note vient avec ; une note écrite ici s'enregistre avec la manche.
    await cherche.fill("jumeaux");
    await round.locator('.reprise-item[data-reprise="s11/0"]').click();
    const note = page.locator("#show-rounds .round").nth(0).locator(".manche-note input");
    assert.equal(await note.inputValue(), "Super avec les jumeaux");
    await note.fill("Parfait pour les 8 ans");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée." }).waitFor();
    const zoe = Object.values(await library("shows")).find((s) => s.childName === "Zoé");
    assert.equal(zoe.rounds[0].note, "Parfait pour les 8 ans");
    assert.equal((await library(`manches/${zoe.rounds[0].mancheId}`)).round.note, "Parfait pour les 8 ans");
    assert.equal((await library("shows/s11")).rounds[0].note, "Super avec les jumeaux", "La manche reprise ne change pas");
    await capture(page, "reprendre-une-manche");
    await page.context().close();
  });

  test("Régie PC (cedric, 23/10) : un Quiz = une seule manche ; compteur, questions tirées au 🎲 juste sous la ligne du dé, quiz rappelés dans l'ordre choisi, Super Finale en dernière ligne", async () => {
    const { QUESTIONS_TOUT_PRETES } = await import("../web/public/banque-classiques.js");
    const { buildSnapshot } = await import("../web/public/show.js");
    const banque = new Map(QUESTIONS_TOUT_PRETES.map((x) => [x.id, x]));
    await seedLibrary("quizzes", { animaux: ANIMAUX, finale: FINALE });
    // Une ancienne prestation avec un Quiz : le Quiz n'offre pas pour autant de « Reprendre » (cedric, 23/10).
    await seedLibrary("shows", { tom: { childName: "Tom", age: 9, date: "2026-03-01", status: "archivee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 } });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await page.fill("#show-age", "10");
    await ajouterJeu(page);
    const bloc = page.locator('#show-rounds .jeu-bloc[data-jeu="quiz"]');
    const round = page.locator("#show-rounds .round").nth(0);
    const ligne = round.locator(".round-body > .tirage-ligne");
    const compteur = round.locator(".quiz-compteur");
    const tirage = round.locator(".round-body > .tirage-serie");
    const series = round.locator(".quiz-series > li.serie");
    const ordre = () => round.locator(".round-body > *").evaluateAll((xs) => xs.map((x) => x.className));
    // Plus de « ＋ Manche » : le Quiz est une seule manche ; ni « ✍ Écrire une question » ni « ↺ Reprendre ».
    assert.equal(await bloc.locator(".jeu-plus").count(), 0);
    assert.equal(await page.locator("#show-rounds .quiz-ecrire, #show-rounds .reprendre-ouvrir, #show-rounds .reprendre-zone").count(), 0);
    // De haut en bas : le compteur, la ligne du dé (profil, nombre, 🎲, ✕), « Rappeler un de vos quiz », la bougie, la Super Finale.
    assert.deepEqual(await ordre(), ["quiz-compteur", "tirage-ligne", "quiz-ajouts", "check bougies quiz-bougies", "quiz-finale", "manche-note"]);
    assert.deepEqual(await ligne.locator(":scope > *").evaluateAll((xs) => xs.map((x) => x.className)), ["tirage-profil", "tirage-nombre", "btn tirage-de", "icon tirage-effacer"]);
    assert.deepEqual(await round.locator(".quiz-ajouts > *").evaluateAll((xs) => xs.map((x) => x.className)), ["grow quiz-rappel"]);
    assert.equal(await ligne.locator(".tirage-effacer").isDisabled(), true, "Rien à effacer : grisée");
    assert.equal(await compteur.textContent(), "Aucune question pour l'instant");
    assert.equal(await ligne.locator(".tirage-nombre").inputValue(), "8");
    assert.equal(await ligne.locator(".tirage-profil").inputValue(), "MOYENS");
    // Super Finale d'office : oui, les 3 dernières, ×2.
    const finale = round.locator(".quiz-finale");
    assert.equal(await finale.locator(".finale-oui").inputValue(), "oui");
    assert.equal(await finale.locator("select.finale").inputValue(), "3");
    assert.equal(await finale.locator(".finale-facteur").inputValue(), "2");
    await capture(page, "quiz-manche-vide");
    // Un quiz rappelé d'abord, puis le dé : les questions tirées viennent juste sous la ligne du dé (sa sous-rubrique),
    // repliées, et passent en premier ; le quiz rappelé reste plus bas.
    await round.locator(".quiz-rappel").selectOption("animaux");
    await series.first().waitFor();
    await ligne.locator(".tirage-profil").selectOption("GRANDS");
    await ligne.locator(".tirage-nombre").selectOption("10");
    await ligne.locator(".tirage-de").click();
    await tirage.waitFor();
    assert.deepEqual(await ordre(), ["quiz-compteur", "tirage-ligne", "tirage-serie serie", "quiz-ajouts", "quiz-series", "check bougies quiz-bougies", "quiz-finale", "manche-note"]);
    assert.deepEqual(await series.evaluateAll((xs) => xs.map((x) => x.dataset.origine)), ["quiz"]);
    const voirDe = tirage.locator(".serie-voir");
    assert.equal(await voirDe.textContent(), "▸ 🎲 10 questions tirées au hasard (Grands)");
    assert.equal(await tirage.locator(".serie-monter, .serie-descendre, .serie-enlever").count(), 0, "Elle reste sous la ligne du dé ; sa ✕ est celle du dé");
    const nAnimaux = ANIMAUX.questions.filter((q) => q.status === "validee").length;
    assert.equal(await compteur.textContent(), `${10 + nAnimaux} questions, dont 3 en Super Finale, plus la question des bougies`);
    assert.equal(await tirage.locator(".serie-liste").isHidden(), true);
    await voirDe.click();
    const lignes = tirage.locator(".serie-liste > li");
    assert.equal(await lignes.count(), 10);
    // Des Juste Chiffre, une question sur quatre environ (10 → 2), jamais la première ; la Super Finale (3 dernières de
    // toute la manche) tombe sur la dernière tirée et les 2 du quiz rappelé.
    const chiffres = await lignes.evaluateAll((xs) => xs.map((x, i) => (x.textContent.startsWith("🔢") ? i : -1)).filter((i) => i >= 0));
    assert.equal(chiffres.length, 2);
    assert.ok(!chiffres.includes(0));
    assert.deepEqual(await lignes.evaluateAll((xs) => xs.map((x) => x.classList.contains("en-finale"))), [...Array(9).fill(false), true]);
    assert.equal(await lignes.nth(9).locator(".badge-finale").textContent(), "🏆 ×2");
    // Photo de la révélation à côté de chaque question à 4 réponses (Grands).
    const photos = await lignes.evaluateAll((xs) => xs.filter((x) => !x.textContent.startsWith("🔢")).map((x) => x.querySelector("img.tirage-mini")?.getAttribute("src") ?? ""));
    assert.equal(photos.length, 8);
    for (const src of photos) assert.match(src, /^banque-quiz\/qc-.+\.jpg$/);
    // ✕ : la question part, un 🎲 prend sa place ; il en tire une autre de la même sorte.
    const retiree = await lignes.nth(0).locator(".tirage-texte").textContent();
    await lignes.nth(0).locator(".tirage-retirer").click();
    await tirage.locator(".serie-liste li.vide").waitFor();
    assert.equal(await tirage.locator(".serie-voir").textContent(), "▾ 🎲 9 questions tirées au hasard (Grands), 1 à tirer");
    assert.equal(await compteur.textContent(), `${9 + nAnimaux} questions, dont 3 en Super Finale, plus la question des bougies · 1 à tirer`);
    await lignes.nth(0).locator(".tirage-de").click();
    await tirage.locator(".serie-liste li.vide").waitFor({ state: "detached" });
    assert.notEqual(await lignes.nth(0).locator(".tirage-texte").textContent(), retiree);
    // Une question retirée puis 9 questions : le 🎲 disparaît, les autres restent ; 8 : une de moins à la fin.
    const dix = await lignes.allTextContents();
    await lignes.nth(0).locator(".tirage-retirer").click();
    await tirage.locator(".serie-liste li.vide").waitFor();
    await ligne.locator(".tirage-nombre").selectOption("9");
    assert.equal(await tirage.locator(".serie-liste li.vide").count(), 0);
    assert.equal(await lignes.count(), 9);
    await ligne.locator(".tirage-nombre").selectOption("8");
    assert.equal(await lignes.count(), 8);
    assert.deepEqual((await lignes.allTextContents()).map((t) => t.replace("🏆 ×2", "")).slice(0, 5), dix.slice(1, 6));
    // Un deuxième quiz rappelé : à la fin ; ↑ ↓ changent l'ordre des quiz rappelés, les questions tirées restent en tête.
    await round.locator(".quiz-rappel").selectOption("finale");
    await series.nth(1).waitFor();
    assert.equal(await compteur.textContent(), `${8 + nAnimaux + 1} questions, dont 3 en Super Finale, plus la question des bougies`);
    assert.equal(await series.nth(0).locator(".serie-monter").isDisabled(), true);
    assert.equal(await series.nth(1).locator(".serie-descendre").isDisabled(), true);
    await series.nth(1).locator(".serie-monter").click();
    assert.deepEqual(await series.evaluateAll((xs) => xs.map((x) => x.querySelector(".serie-voir").textContent.match(/« (.+) »/)[1])), ["Finale", "Animaux"]);
    assert.deepEqual(await ordre(), ["quiz-compteur", "tirage-ligne", "tirage-serie serie", "quiz-ajouts", "quiz-series", "check bougies quiz-bougies", "quiz-finale", "manche-note"]);
    assert.equal(await tirage.locator(".serie-liste .en-finale").count(), 0, "Super Finale : la question du quiz Finale et les 2 d'Animaux");
    // Une question du quiz rappelé retirée : la bibliothèque ne change pas, « ↺ Remettre » la ramène.
    const animaux = series.nth(1);
    await animaux.locator(".serie-voir").click();
    await animaux.locator(".serie-liste > li").first().locator(".tirage-retirer").click();
    assert.match(await animaux.locator(".serie-voir").textContent(), new RegExp(`${nAnimaux - 1} questions? \\(1 retirée\\)`));
    await animaux.locator(".serie-remettre").click();
    assert.equal(await animaux.locator(".serie-voir").textContent(), `▾ 📚 Quiz « Animaux » : ${nAnimaux} questions`);
    // Super Finale : les 2 dernières, ×3.
    await finale.locator("select.finale").selectOption("2");
    await finale.locator(".finale-facteur").selectOption("3");
    assert.equal(await compteur.textContent(), `${8 + nAnimaux + 1} questions, dont 2 en Super Finale, plus la question des bougies`);
    await capture(page, "quiz-manche-series");
    if (process.env.CAPTURES) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await capture(page, "quiz-manche-series-pc");
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const zoe = Object.values(await library("shows")).find((s) => s.childName === "Zoé");
    assert.equal(zoe.rounds.length, 1);
    const [manche] = zoe.rounds;
    assert.deepEqual(manche.seriesQuiz.map((x) => [x.origine, x.quizId ?? null]), [["de", null], ["quiz", "finale"], ["quiz", "animaux"]]);
    assert.equal(manche.finale, 2);
    assert.equal(manche.facteur, 3);
    assert.equal(manche.tirees, undefined);
    assert.equal(manche.quizId, undefined);
    const [de] = manche.seriesQuiz;
    assert.equal(de.profil, "GRANDS");
    assert.equal(de.questions.length, 8);
    for (const q of de.questions) assert.equal(banque.get(q.id).niveau, 3, "Grands : niveau Difficile");
    // Sur la TV : un seul jeu, les questions tirées d'abord, puis les quiz dans l'ordre ; la bougie juste avant la Super Finale.
    const { snapshot } = buildSnapshot("zoe", zoe, { animaux: ANIMAUX, finale: FINALE });
    const qs = snapshot.quiz.questions;
    assert.equal(new Set(qs.map((q) => q.round)).size, 1, "Un seul jeu");
    assert.equal(qs.length, 8 + 1 + nAnimaux + 1);
    assert.equal(qs[0].text, de.questions[0].text);
    assert.equal(qs[8].text, FINALE.questions[0].text);
    assert.equal(qs.at(-3).text, "Le Juste Chiffre : combien de bougies sur le gâteau de Zoé cette année ?");
    assert.deepEqual(qs.slice(-2).map((q) => q.finale), [true, true]);
    assert.deepEqual(snapshot.facteurs, { [qs.at(-2).id]: 3 });
    // Rouverte : la ✕ du dé n'efface que les questions tirées.
    await page.click("#show-edit-crumb");
    await page.locator(".show-card", { hasText: "Zoé" }).first().click();
    await tirage.waitFor();
    await round.locator(".tirage-effacer").click();
    assert.match(await repondreFenetre(page), /Effacer les 8 questions tirées \?/);
    await tirage.waitFor({ state: "detached" });
    assert.deepEqual(await series.evaluateAll((xs) => xs.map((x) => x.dataset.origine)), ["quiz", "quiz"]);
    assert.equal(await round.locator(".tirage-effacer").isDisabled(), true);
    // Une série enlevée (✕ de la série) : demandé d'abord.
    await series.nth(1).locator(".serie-enlever").click();
    assert.match(await repondreFenetre(page, { accepter: false }), /Enlever cette série \(\d+ questions?\) de la manche \? Le quiz reste dans la bibliothèque\./);
    assert.equal(await series.count(), 2);
    await page.context().close();
  });

  test("Régie PC (cedric, 23/10) : les anciennes manches Quiz qui se suivent n'en font plus qu'une à l'ouverture ; un Quiz ajouté après un Quiz n'en crée pas un second", async () => {
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    const tirees = [{ id: "x1", text: "Quelle est la capitale de l'Italie ?", choices: ["Rome", "Milan", "Naples", "Turin"], correct: 0 },
      { id: "x2", text: "Combien de jours dans une semaine ?", nombre: true, correct: 7 }];
    await seedLibrary("shows", {
      vieux: { childName: "Malo", age: 9, date: day(10), status: "publiee", updatedAt: 1,
        rounds: [{ type: "quiz", quizId: "animaux", count: 2, finale: 3 }, { type: "quiz", tirees, profil: "MOYENS", finale: 1 }, { type: "statues", duration: 60 }] },
    });
    const page = await admin();
    await page.click('#screen-home [data-etat="avenir"]');
    await page.locator('#show-list [data-show="vieux"]').getByRole("button", { name: "Ouvrir" }).click();
    await page.locator("#show-status-msg", { hasText: "Les manches Quiz qui se suivaient n'en font plus qu'une" }).waitFor();
    assert.equal(await page.locator('#show-rounds .jeu-bloc[data-jeu="quiz"] .round').count(), 1);
    const round = page.locator('#show-rounds .jeu-bloc[data-jeu="quiz"] .round');
    // Les questions tirées sous la ligne du dé (elles passent en premier), le quiz rappelé dans la liste.
    assert.equal(await round.locator(".round-body > .tirage-serie").count(), 1);
    assert.deepEqual(await round.locator(".quiz-series > li.serie").evaluateAll((xs) => xs.map((x) => x.dataset.origine)), ["quiz"]);
    assert.equal(await round.locator(".quiz-compteur").textContent(), "4 questions, dont la dernière en Super Finale, plus la question des bougies");
    // « ＋ Ajouter un jeu » Quiz juste après le Quiz : déplacé ici, statues après ; un Quiz en fin, puis encore un : refusé.
    await page.click("#round-add");
    await page.click('#jeu-choix .jeu-tuile[data-jeu="quiz"]');
    assert.equal(await page.locator('#show-rounds .jeu-bloc[data-jeu="quiz"]').count(), 2, "Un Quiz après les statues : un autre jeu");
    await page.click("#round-add");
    await page.click('#jeu-choix .jeu-tuile[data-jeu="quiz"]');
    await page.locator("#annonce", { hasText: "Le Quiz est déjà le dernier jeu" }).waitFor();
    assert.equal(await page.locator('#show-rounds .jeu-bloc[data-jeu="quiz"]').count(), 2);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const malo = (await library("shows")).vieux;
    assert.deepEqual(malo.rounds.map((r) => r.type), ["quiz", "statues"], "Le Quiz vide n'est pas gardé");
    assert.equal(malo.rounds[0].finale, 1);
    assert.deepEqual(malo.rounds[0].seriesQuiz.map((x) => [x.origine, x.quizId ?? null, x.questions?.length ?? null]), [["de", null, 2], ["quiz", "animaux", null]]);
    await page.context().close();
  });

  test("Régie PC (cedric, 23/10) : « Archivée » ne se choisit pas dans une fiche ; une archivée reportée se remet « À venir » avec une nouvelle date", async () => {
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
    const rounds = [{ type: "quiz", quizId: "animaux" }];
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    await seedLibrary("shows", {
      prete: { childName: "Léa", age: 7, date: day(10), status: "publiee", rounds, updatedAt: 1 },
      passee: { childName: "Malo", age: 9, date: day(-3), status: "publiee", rounds, updatedAt: 1 },
    });
    const page = await admin();
    const choix = () => page.$$eval("#show-status option", (os) => os.filter((o) => !o.hidden && !o.disabled).map((o) => o.textContent));
    // Nouvelle prestation : seulement « À compléter » ou « À venir ».
    await page.click("#home-new");
    assert.deepEqual(await choix(), ["À compléter", "À venir"]);
    // Une date passée par erreur : elle part dans les archives, et le message le dit.
    await page.fill("#show-child", "Zoé");
    await page.fill("#show-date", day(-2));
    await page.click("#show-save");
    await page.locator("#annonce", { hasText: "Enregistrée dans les « Archivées » : sa date est passée." }).waitFor();
    assert.equal(await page.inputValue("#show-status"), "archivee");
    assert.equal(await page.textContent("#show-edit-crumb"), "Archivées");
    // Fête à venir : pas d'« Archivée » non plus (on archive avec le bouton de sa carte).
    await page.click("#brand");
    await page.click('#screen-home [data-etat="avenir"]');
    await page.locator('#show-list [data-show="prete"]').getByRole("button", { name: "Ouvrir" }).click();
    assert.deepEqual(await choix(), ["À compléter", "À venir"]);
    assert.equal(await page.inputValue("#show-status"), "publiee");
    // Archivée d'elle-même (date passée) : « Archivée » est montré, et on peut la remettre « À venir ».
    await page.click("#brand");
    await page.click('#screen-home [data-etat="archivee"]');
    await page.locator('#show-list [data-show="passee"]').getByRole("button", { name: "Ouvrir" }).click();
    assert.deepEqual(await choix(), ["À compléter", "À venir", "Archivée"]);
    assert.equal(await page.inputValue("#show-status"), "archivee");
    // Sans changer la date : elle reste archivée, le message dit quoi faire.
    await page.selectOption("#show-status", "publiee");
    await page.click("#show-save");
    await page.locator("#annonce", { hasText: "Toujours dans les « Archivées » : pour la remettre « À venir », il manque : Choisir une date à venir (celle-ci est passée)." }).waitFor();
    assert.equal(await page.inputValue("#show-status"), "archivee");
    // Fête reportée : nouvelle date et « À venir ».
    await page.fill("#show-date", day(6));
    await page.selectOption("#show-status", "publiee");
    await page.click("#show-save");
    await page.locator("#annonce.ok", { hasText: "Enregistrée « À venir » : elle est visible sur la régie." }).waitFor();
    assert.equal(await page.textContent("#show-edit-crumb"), "Anniversaires à venir");
    assert.deepEqual(await choix(), ["À compléter", "À venir"]);
    const malo = await library("shows/passee");
    assert.deepEqual([malo.status, malo.date], ["publiee", day(6)]);
    await page.context().close();
  });

  test("reprendre une manche d'une ancienne prestation et dupliquer un quiz, sans toucher aux originaux", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX, finale: FINALE });
    const LEA = { childName: "Léa", age: 7, date: "2026-03-01", status: "archivee", rounds: [{ type: "quiz", quizId: "animaux" }, { type: "finale", quizId: "finale" }, { type: "chante", count: 5 }], updatedAt: 1 };
    await seedLibrary("shows", { lea: LEA });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    // Le jeu ajouté : « ↺ Reprendre une manche déjà faite » propose celles des autres prestations (pas le Quiz, cedric 23/10).
    await ajouterJeu(page, "chante");
    const round = page.locator("#show-rounds .round").nth(0);
    await round.locator(".reprendre-ouvrir").click();
    const lea2 = round.locator('.reprise-item[data-reprise="lea/2"]');
    await lea2.waitFor();
    // Ni le Quiz ni l'ancienne manche « Super Finale » ne se reprennent ici.
    assert.equal(await round.locator('.reprise-item[data-reprise="lea/0"], .reprise-item[data-reprise="lea/1"]').count(), 0);
    assert.equal(await round.locator(".reprise-item", { hasText: "Super Finale" }).count(), 0);
    await lea2.click();
    assert.equal(await page.locator("#show-rounds .round").nth(0).locator("select.grow").inputValue(), "5");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée." }).waitFor();
    // Elle est gardée dans la page de son jeu, rattachée à la nouvelle prestation ; l'ancienne prestation ne change pas.
    const shows = await library("shows");
    const [zoeId, zoe] = Object.entries(shows).find(([, s]) => s.childName === "Zoé");
    const [mid, manche] = Object.entries(await library("manches"))[0];
    assert.deepEqual(zoe.rounds, [{ type: "chante", count: 5, mancheId: mid }]);
    assert.deepEqual([manche.round, manche.showId, manche.title], [{ type: "chante", count: 5 }, zoeId, "Chante le mot ! · Anniversaire de Zoé"]);
    assert.deepEqual(shows.lea, LEA, "Ancienne prestation inchangée");

    // Dupliquer un quiz : la copie apparaît en tête de la liste, sans s'ouvrir ; elle se modifie et s'enregistre à part.
    await openQuizzes(page);
    await page.locator('#quiz-list [data-quiz="animaux"]').getByRole("button", { name: "Dupliquer" }).click();
    const copie = page.locator("#quiz-list .item.copie-recente");
    await copie.locator("b", { hasText: "Copie de Animaux" }).waitFor();
    assert.equal(await page.locator("#screen-review").isHidden(), true, "La copie ne s'ouvre pas");
    assert.equal(await page.locator("#quiz-list .item").first().getAttribute("data-quiz"), await copie.getAttribute("data-quiz"));
    await copie.getByRole("button", { name: "Éditer" }).click();
    assert.equal(await page.inputValue("#rv-title"), "Copie de Animaux");
    await page.locator('[data-q="0"] .q-text').fill("Qui est le roi de la savane ?");
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "Enregistré" }).waitFor();
    const quizzes = await library("quizzes");
    assert.equal(Object.keys(quizzes).length, 3);
    assert.equal(quizzes.animaux.questions[0].text, "Roi de la jungle ?", "Quiz d'origine inchangé");
    const copy = Object.values(quizzes).find((q) => q.title === "Copie de Animaux");
    assert.equal(copy.questions[0].text, "Qui est le roi de la savane ?");
    await page.context().close();
  });

  test("Régie PC : une ancienne manche « Super Finale » n'est plus un jeu, elle devient les 3 dernières questions ×2 du quiz", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX, finale: FINALE });
    await seedLibrary("shows", { vieille: { childName: "Léa", age: 7, date: "2099-12-02", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }, { type: "finale", quizId: "finale" }], updatedAt: 1 } });
    const page = await admin();
    await page.locator('#home-upcoming [data-show="vieille"]').getByRole("button", { name: "Ouvrir" }).click();
    await page.locator("#show-status-msg", { hasText: "L'ancienne manche « Super Finale » est devenue le réglage du quiz" }).waitFor();
    // Un seul jeu, le Quiz, avec une manche ; la Super Finale n'est plus proposée comme jeu.
    assert.equal(await page.locator("#show-rounds .round").count(), 1);
    assert.deepEqual(await page.locator("#show-rounds .jeu-bloc").evaluateAll((els) => els.map((e) => e.dataset.jeu)), ["quiz"]);
    assert.equal(await page.locator("#show-rounds select.finale").inputValue(), "3");
    await page.click("#round-add");
    assert.equal(await page.locator('#jeu-choix .jeu-tuile[data-jeu="finale"]').count(), 0);
    await page.click("#round-add");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    assert.deepEqual(await sansManche((await library("shows")).vieille.rounds), [{ type: "quiz", quizId: "animaux", finale: 3 }]);
    await page.context().close();
  });

  test("ajouter un jeu en pleine partie, réorganiser les manches futures, sans toucher aux scores ni à la bibliothèque", async () => {
    const DINO = { title: "Dinosaures", source: "tableur", updatedAt: 1, questions: [{ text: "Le T-Rex mangeait de la viande", choices: ["Vrai", "Faux"], correct: 0, status: "validee" }] };
    await seedLibrary("quizzes", { animaux: ANIMAUX, finale: FINALE, dino: DINO });
    await seedLibrary("shows", {
      // Question des bougies décochée : elle n'est pas posée.
      lea: { childName: "Léa", age: 7, date: "2099-12-02", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux", bougies: false }, { type: "finale", quizId: "finale" }], updatedAt: 1 },
      hugo: { childName: "Hugo", age: 9, date: "2025-06-01", status: "archivee", rounds: [{ type: "quiz", quizId: "dino" }], updatedAt: 1 },
    });
    box = startBox();
    await addTeam("rose", "Les Roses");
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator(".show-item", { hasText: "Anniversaire de Léa" }).click();
    // Fenêtre de lancement, sur le téléphone seulement : « Lancer » confirme.
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    await regie.click("#c-next");
    await regie.locator("#c-phase", { hasText: "Question en cours" }).waitFor();
    await givePoints(regie, "rose", 10);
    await waitFor(async () => (await read("state/scores/rose")) === 10, "10 points pour les Roses");
    const rounds = async () => (await read("conducteur")).questions.map((q) => q.round);

    // Un quiz de la bibliothèque, après la manche en cours : aperçu puis ajout.
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    await regie.locator('#lib-list [data-game="quiz/dino"]', { hasText: "1 question" }).click();
    await regie.locator("#lib-questions", { hasText: "Le T-Rex mangeait de la viande" }).waitFor();
    await regie.click("#lib-after");
    await regie.locator("#r-toast", { hasText: "« Dinosaures » est ajouté après la manche en cours." }).waitFor();
    assert.equal(await regie.locator("#lib").isHidden(), true);
    assert.deepEqual(await rounds(), ["Animaux", "Animaux", "Animaux", "Dinosaures"]);
    assert.equal(await read("state/total"), 4);
    assert.equal(await read("state/index"), 0, "La question en cours ne bouge pas");

    // Une manche d'une ancienne prestation, à la fin : elle garde un titre distinct.
    await regie.click("#plan-add");
    await regie.locator('#lib-list [data-game="show/hugo/0"]', { hasText: "Anniversaire de Hugo" }).click();
    await regie.click("#lib-end");
    await regie.locator("#r-toast", { hasText: "« Dinosaures · 2 » est ajouté à la fin du programme." }).waitFor();
    assert.deepEqual(await rounds(), ["Animaux", "Animaux", "Animaux", "Dinosaures", "Dinosaures · 2"]);

    // La manche en cours n'a ni flèches ni « Retirer » ; une manche future se déplace et se retire.
    // (« 🔁 Rejouer » oui : le jeu a commencé.)
    assert.equal(await regie.locator('.plan-head[data-round="Animaux"] button:not(.replay)').count(), 0);
    await regie.locator('.plan-head[data-round="Animaux"] button.replay', { hasText: "🔁 Rejouer" }).waitFor();
    await regie.click('.plan-head[data-round="Dinosaures · 2"] button.up');
    await regie.locator("#r-toast", { hasText: "« Dinosaures · 2 » avancée d'un cran." }).waitFor();
    assert.deepEqual(await rounds(), ["Animaux", "Animaux", "Animaux", "Dinosaures · 2", "Dinosaures"]);

    // Un autre téléphone a changé le programme juste avant : la TV refuse, la régie le dit, rien ne bouge.
    box.refuseNextProgram("stale");
    await regie.click('.plan-head[data-round="Dinosaures"] button.up');
    await regie.locator("#r-toast", { hasText: "Le programme venait de changer" }).waitFor();
    assert.deepEqual(await rounds(), ["Animaux", "Animaux", "Animaux", "Dinosaures · 2", "Dinosaures"]);

    await regie.click('.plan-head[data-round="Dinosaures · 2"] button.remove');
    assert.match(await respond(regie), /reste dans la bibliothèque/);
    await regie.locator("#r-toast", { hasText: "« Dinosaures · 2 » est retirée du programme." }).waitFor();
    assert.deepEqual(await rounds(), ["Animaux", "Animaux", "Animaux", "Dinosaures"]);

    assert.equal(await read("state/scores/rose"), 10, "Scores gardés");
    const lib = await library("quizzes");
    assert.deepEqual(lib.dino, DINO, "Quiz de la bibliothèque inchangé");
    assert.deepEqual(lib.animaux, ANIMAUX);
    await regie.context().close();
  });

  test("prestations : archivées toutes seules le lendemain de la fête ; l'étoile en fait un modèle dont les jeux passent en premier dans la régie", async () => {
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    await seedLibrary("shows", {
      hier: { childName: "Lina", age: 8, date: day(0), status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 },
      vieux: { childName: "Malo", age: 9, date: day(-1), status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }, { type: "patate" }], updatedAt: 1 },
    });
    const page = await admin();
    // Le jour de la fête : encore à venir ; la veille : déjà dans les archivées (plus de trou de 2 jours).
    await page.click('#screen-home [data-etat="avenir"]');
    await page.locator('#show-list [data-show="hier"]').waitFor();
    assert.equal(await page.locator('#show-list [data-show="hier"]').getByRole("button", { name: "⭐ Épingler" }).count(), 0, "L'étoile se met dans les archivées");
    await page.click('#shows-tabs [data-etat="archivee"]');
    await page.locator('#show-list [data-show="vieux"]').getByRole("button", { name: "⭐ Épingler" }).click();
    await page.locator('#show-pinned:not([hidden]) [data-show="vieux"]').waitFor();
    assert.equal(await library("shows/vieux/pinned"), true);
    assert.equal(await library("shows/vieux/status"), "publiee", "Rien d'autre ne change");
    // Ouverte puis enregistrée telle quelle, elle garde son étoile.
    await page.locator('#show-pinned [data-show="vieux"]').getByRole("button", { name: "Ouvrir" }).click();
    assert.equal(await page.textContent("#show-edit-crumb"), "Archivées");
    assert.equal(await page.inputValue("#show-status"), "archivee", "Archivée d'elle-même : le statut le dit");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée." }).waitFor();
    assert.equal(await library("shows/vieux/pinned"), true);
    await page.context().close();

    // Régie du téléphone : la prestation d'il y a 3 jours n'est plus proposée ; ses jeux passent en premier.
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Lina" }).waitFor();
    assert.equal(await regie.locator("#panel-show .show-item", { hasText: "Malo" }).count(), 0);
    await regie.locator("#panel-show .show-item", { hasText: "Lina" }).click();
    // Fenêtre de lancement, sur le téléphone seulement : « Lancer » confirme.
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    await regie.click("#tab-plan");
    await regie.click("#plan-add");
    await regie.locator('#lib-list [data-game="pin/vieux/0"]', { hasText: "Animaux" }).waitFor();
    await regie.locator('#lib-list [data-game="pin/vieux/1"]', { hasText: "Ça va exploser" }).waitFor();
    assert.equal(await regie.locator("#lib-list .lib-section").first().textContent(), "⭐ Prestations épinglées");
    await regie.context().close();
  });

  test("cadrage : l'image d'une réponse se cadre dans sa bulle à la souris ; la TV reçoit l'image recadrée", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    const page = await admin();
    await openQuizzes(page);
    await page.locator('#quiz-list [data-quiz="animaux"]').getByRole("button", { name: "Éditer" }).click();
    const q0 = page.locator('[data-q="0"]');
    // Photo en largeur : moitié gauche rouge, moitié droite bleue.
    await q0.locator(".choice-photo input[type=file]").first().setInputFiles({ name: "drapeau.png", mimeType: "image/png", buffer: pngHalves(400, 200, [220, 30, 30], [30, 60, 220]) });
    const thumb = q0.locator(".choice-thumb:not([hidden])").first();
    await thumb.waitFor();
    // Bulle comme sur la TV : carrée et remplie (le centre, à cheval sur les deux couleurs).
    assert.equal(await thumb.evaluate((e) => getComputedStyle(e).objectFit), "cover");
    await thumb.click();
    const scene = page.locator(".cadre-scene");
    await scene.waitFor();
    assert.equal(await page.locator(".cadre-fond").evaluate((e) => getComputedStyle(e).opacity), "0.35", "ce qui dépasse reste visible en transparence");
    // Glissée vers la gauche jusqu'au bout : la bulle montre la moitié bleue.
    const box_ = await scene.boundingBox();
    await page.mouse.move(box_.x + box_.width / 2, box_.y + box_.height / 2);
    await page.mouse.down();
    await page.mouse.move(box_.x - 400, box_.y + box_.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.click(".cadre-boite button:has-text('Valider le cadrage')");
    await page.locator(".cadre-voile").waitFor({ state: "detached" });
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "Enregistré" }).waitFor();
    const saved = (await library("quizzes")).animaux.questions[0];
    const id = saved.choiceImages[0];
    assert.match(id, /^[0-9a-f]{16}$/);
    const data = await library(`images/${id}`);
    const [w, h, r, g, b] = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return [img.width, img.height, ...ctx.getImageData(img.width / 2, img.height / 2, 1, 1).data.slice(0, 3)];
    }, data);
    assert.deepEqual([w, h], [480, 480], "vignette carrée, à la taille de la bulle");
    assert.ok(b > 150 && r < 100, `centre bleu après le cadrage (${r}, ${g}, ${b})`);
    // Annuler le cadrage ne change rien.
    await page.locator('[data-q="0"] .choice-thumb:not([hidden])').first().click();
    await page.click(".cadre-boite button:has-text('Annuler')");
    await page.locator(".cadre-voile").waitFor({ state: "detached" });
    await page.context().close();
  });

  test("banque des tout-petits : 10 questions au hasard, une image par réponse, relues puis enregistrées", async () => {
    const page = await admin();
    await openQuizzes(page, "illustre");
    await page.click("#quiz-import-open");
    await page.click('#kind-ways-list [data-way=banque]');
    const panel = page.locator("#rv-banque-panel");
    await panel.locator(".banque-q").first().waitFor();
    assert.equal(await page.inputValue("#rv-title"), "Quiz illustré");
    await page.locator("#rv-kind", { hasText: "Quiz illustré" }).waitFor();
    // Recherche d'un mot : les questions qui l'ont en réponse ou dans le texte.
    await page.fill("#rv-banque-cherche", "girafe");
    await panel.locator('.banque-q:has-text("Où est la girafe ?")').waitFor();
    await page.fill("#rv-banque-cherche", "");
    await panel.locator('.banque-q:has-text("miaou")').waitFor();
    await panel.locator("button.chip", { hasText: "Animaux" }).click();
    await panel.locator("button", { hasText: "10 au hasard" }).click();
    assert.equal(await panel.locator(".banque-q input:checked").count(), 10);
    // Une de plus, cochée à la main hors des animaux.
    await panel.locator("button.chip", { hasText: "Musique" }).click();
    await panel.locator('.banque-q:has-text("Sur quoi tape-t-on avec des baguettes ?") input').check();
    await panel.locator("#rv-banque-add", { hasText: "Ajouter les 11 questions cochées" }).click();
    await page.locator("#rv-status", { hasText: "11 questions ajoutées" }).waitFor({ timeout: 30000 });
    assert.equal(await page.locator("#rv-list .qcard").count(), 11);
    await waitFor(async () => (await page.locator("#rv-list .choice-thumb:not([hidden])").count()) === 44, "44 images de réponses");
    // Déjà dans le quiz : grisée, plus cochable.
    assert.equal(await panel.locator('.banque-q.deja:has-text("Sur quoi tape-t-on avec des baguettes ?") input').isDisabled(), true);
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "11 questions validées sur 11" }).waitFor();
    const [quiz] = Object.values(await library("quizzes"));
    assert.equal(quiz.source, "banque");
    assert.equal(quiz.kind, "photo");
    // Chaque jeu montre ses quiz : celui-ci est dans le Quiz illustré, pas dans le Quiz.
    await openQuizzes(page, "illustre");
    assert.equal(await page.textContent("#quizzes-h1"), "Quiz illustrés");
    await page.locator("#quiz-list .item", { hasText: "Quiz illustré" }).waitFor();
    await openQuizzes(page);
    assert.equal(await page.textContent("#quizzes-h1"), "Quiz à réponses écrites");
    assert.equal(await page.locator("#quiz-list .item").count(), 0);
    assert.equal(await page.locator("#banque-open").isHidden(), true, "la banque des tout-petits est dans le Quiz illustré");
    const tambour = quiz.questions.find((q) => q.text === "Sur quoi tape-t-on avec des baguettes ?");
    assert.equal(tambour.choices[tambour.correct], "Tambour");
    assert.ok(quiz.questions.every((q) => q.choices.length === 4 && q.choiceImages.length === 4 && q.choiceImages.every((id) => /^[0-9a-f]{16}$/.test(id))));
    // Même mot, même image (rangée une seule fois).
    const images = await library("images");
    assert.ok(Object.keys(images).length <= new Set(quiz.questions.flatMap((q) => q.choices)).size);
    await page.context().close();
  });

  test("banque des tout-petits : Sarah remplace la photo d'un mot, les questions ajoutées ensuite la prennent", async () => {
    const page = await admin();
    await openQuizzes(page, "illustre");
    await page.click("#banque-open");
    const chat = page.locator('#banque-mots [data-mot="chat"]');
    await chat.waitFor();
    // Un thème à la fois (les animaux d'abord) ; le thème « Le corps » montre ses mots.
    assert.ok((await page.locator("#banque-mots .banque-mot").count()) >= 60);
    await page.locator("#banque-themes button", { hasText: "Le corps" }).click();
    await page.locator('#banque-mots [data-mot="nez"]').waitFor();
    assert.equal(await chat.count(), 0);
    await page.locator("#banque-themes button", { hasText: "Animaux" }).click();
    await chat.waitFor();
    await chat.locator("input[type=file]").setInputFiles({ name: "minou.png", mimeType: "image/png", buffer: png([250, 200, 120]) });
    await page.locator("#banque-status", { hasText: "« Chat » : votre photo est enregistrée" }).waitFor();
    const id = (await library("contents/petits")).images.chat;
    assert.match(id, /^[0-9a-f]{16}$/);
    await chat.locator("button[title='Remettre la photo de la banque']").waitFor();
    // Nouveau quiz : la question « miaou » prend la photo de Sarah pour « Chat ».
    await openQuizzes(page, "illustre");
    await page.click("#quiz-import-open");
    await page.click('#kind-ways-list [data-way=banque]');
    await page.locator('#rv-banque-panel .banque-q:has-text("miaou") input').check();
    await page.click("#rv-banque-add");
    await page.locator("#rv-status", { hasText: "1 question ajoutée" }).waitFor({ timeout: 20000 });
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "Enregistré" }).waitFor();
    const [quiz] = Object.values(await library("quizzes"));
    const q = quiz.questions[0];
    assert.equal(q.choiceImages[q.choices.indexOf("Chat")], id);
    // « ↺ » remet la photo de la banque.
    await openQuizzes(page, "illustre");
    await page.click("#banque-open");
    await page.locator('#banque-mots [data-mot="chat"] button[title="Remettre la photo de la banque"]').click();
    await page.locator("#banque-status", { hasText: "photo de la banque remise" }).waitFor();
    assert.equal((await library("contents/petits"))?.images, undefined);
    await page.context().close();
  });

  test("illustration : émoji et photo ajoutés dans l'admin, copiés dans la partie par la régie", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    await seedLibrary("shows", { ines: { childName: "Inès", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 } });
    const page = await admin();
    await openQuizzes(page);
    await page.locator('#quiz-list [data-quiz="animaux"]').getByRole("button", { name: "Éditer" }).click();
    await page.locator('[data-q="1"]').waitFor();
    await page.locator('[data-q="0"] .q-emoji').fill("🦁");
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.locator('[data-q="1"] .q-photo').setInputFiles({ name: "araignee.png", mimeType: "image/png", buffer: PNG });
    await page.locator('[data-q="1"] .q-image-info', { hasText: "Photo prête" }).waitFor();
    await page.locator('[data-q="1"] .q-image:not([hidden])').waitFor();
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "Enregistré" }).waitFor();
    const saved = (await library("quizzes")).animaux.questions;
    assert.equal(saved[0].image, "🦁");
    assert.equal(saved[0].imageId, undefined);
    assert.match(saved[1].imageId, /^[0-9a-f]{16}$/);
    const id = saved[1].imageId;
    assert.match(await library(`images/${id}`), /^data:image\/jpeg;base64,/);
    // Rouvert : la photo est toujours là, et on peut la retirer.
    await page.reload();
    await page.locator("#screen-home:not([hidden])").waitFor();
    await openQuizzes(page);
    await page.locator('#quiz-list [data-quiz="animaux"]').getByRole("button", { name: "Éditer" }).click();
    await page.locator('[data-q="1"] .q-image:not([hidden])').waitFor();
    await page.context().close();

    // Régie : la prestation arrive sur la TV avec ses illustrations, la photo est copiée dans la partie.
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator(".show-item", { hasText: "Inès" }).click();
    // Fenêtre de lancement, sur le téléphone seulement : « Lancer » confirme.
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const q = (await read("show")).quiz.questions;
    assert.equal(q[0].image, "🦁");
    assert.equal(q[1].imageId, id);
    await waitFor(async () => (await read(`images/${id}`))?.startsWith("data:image/jpeg"), "photo copiée dans la partie");
    await regie.context().close();
  });

  test("quiz en images : JSON de ChatGPT et images déposés ensemble, image manquante signalée puis ajoutée à la main, copiées dans la partie", async () => {
    const json = JSON.stringify({ title: "Les animaux des petits", questions: [
      { text: "Quel animal court le plus vite ?", illustration: "q1-revelation.png", choices: [{ text: "Lion", image: "q1-lion.png" }, { image: "q1-baleine.png" }, { text: "Chien", image: "q1-chien.png" }, { text: "Vache", image: "q1-vache.png" }], correct: 0 },
      { text: "Quelle est la capitale de la France ?", choices: ["Paris", "Rome"], correct: 0 },
    ] });
    const page = await admin();
    await openQuizzes(page, "illustre");
    await page.click("#quiz-import-open");
    await page.click('#kind-ways-list [data-way=json]');
    await page.locator("#import-file").setInputFiles([
      { name: "quiz.json", mimeType: "application/json", buffer: Buffer.from(json) },
      { name: "q1-lion.png", mimeType: "image/png", buffer: png([230, 160, 30]) },
      { name: "Q1-Baleine.PNG", mimeType: "image/png", buffer: png([40, 120, 230]) },
      { name: "q1-chien.png", mimeType: "image/png", buffer: png([120, 80, 40]) },
      { name: "q1-revelation.png", mimeType: "image/png", buffer: png([200, 60, 60]) },
    ]);
    await page.locator("#import-images", { hasText: "4 images prêtes" }).waitFor();
    await page.click("#import-analyse");
    await page.locator('[data-q="1"]').waitFor({ timeout: 15000 });
    // Aperçu avant d'enregistrer : 3 images associées par leur nom, la 4e manque et c'est dit.
    await waitFor(async () => (await page.locator('[data-q="0"] .choice-thumb:not([hidden])').count()) === 3, "3 images en aperçu");
    assert.equal(await page.locator('[data-q="0"] .q-choice').nth(1).inputValue(), "Baleine", "mot tiré du nom de l'image");
    await page.locator('[data-q="0"] .problems', { hasText: "q1-vache.png" }).waitFor();
    // Ajoutée à la main avec « 📷 » ; la question en texte n'a pas d'image.
    await page.locator('[data-q="0"] .choice-photo input[type=file]').nth(3).setInputFiles({ name: "vache.png", mimeType: "image/png", buffer: png([250, 250, 250]) });
    await waitFor(async () => (await page.locator('[data-q="0"] .choice-thumb:not([hidden])').count()) === 4, "4 images en aperçu");
    assert.equal(await page.locator('[data-q="1"] .choice-thumb:not([hidden])').count(), 0);
    // Image de révélation associée à la question 1 ; la question 2 n'a pas d'illustration, c'est signalé sans bloquer.
    await page.locator('[data-q="0"] .q-image:not([hidden])').waitFor();
    assert.equal(await page.locator('[data-q="0"] .tag.missing').isHidden(), true);
    await page.locator('[data-q="1"] .tag.missing:not([hidden])', { hasText: "illustration manquante" }).waitFor();
    await page.click("#rv-validate-all");
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "Enregistré" }).waitFor();
    await page.context().close();
    const [[quizId, saved]] = Object.entries(await library("quizzes"));
    const ids = Object.values(saved.questions[0].choiceImages);
    assert.equal(new Set(ids).size, 4, "quatre images distinctes");
    assert.equal(saved.questions[1].choiceImages, undefined);
    for (const id of ids) assert.match(await library(`images/${id}`), /^data:image\/jpeg;base64,/);
    assert.match(saved.questions[0].imageId, /^[0-9a-f]{16}$/);
    assert.ok(!ids.includes(saved.questions[0].imageId), "image de révélation distincte des réponses");

    // Régie : la prestation part sur la TV avec ses réponses en images, copiées là où les tablettes les lisent.
    await seedLibrary("shows", { lou: { childName: "Lou", status: "publiee", rounds: [{ type: "quiz", quizId }], updatedAt: 1 } });
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator(".show-item", { hasText: "Lou" }).click();
    // Fenêtre de lancement, sur le téléphone seulement : « Lancer » confirme.
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const q = (await read("show")).quiz.questions;
    assert.deepEqual(q[0].choiceImages, ids);
    assert.equal(q[1].choiceImages, undefined);
    await waitFor(async () => Object.keys((await read("choiceImages")) ?? {}).length === 4, "images des réponses copiées dans la partie");
    await regie.context().close();
  });

  test("« 💾 Sauvegarder les prestations » (cedric, 22/10) : un fichier sur le PC, sans les images ni les sons, rien d'écrit en ligne", async () => {
    const INES = { childName: "Inès", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 };
    const TOM = { childName: "Tom", status: "brouillon", updatedAt: 2 };
    const SONG = { title: "Djadja", artist: "Aya Nakamura", imageId: "a1b2c3d4e5f60718", updatedAt: 3 };
    await seedLibrary("shows", { ines: INES, tom: TOM });
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    await seedLibrary("songs", { djadja: SONG });
    await seedLibrary("images", { a1b2c3d4e5f60718: "data:image/png;base64,AAAA" });
    const avant = await library("");
    const page = await admin();
    await page.click("#nav button[data-screen=settings]");
    const [telechargement] = await Promise.all([page.waitForEvent("download"), page.click("#sauvegarde")]);
    assert.match(telechargement.suggestedFilename(), /^sauvegarde-regie-\d{4}-\d{2}-\d{2}-\d{2}h\d{2}\.json$/);
    const fichier = JSON.parse(readFileSync(await telechargement.path(), "utf8"));
    assert.equal(fichier.app, "little-miss-party-quiz");
    assert.deepEqual(fichier.library.shows, { ines: INES, tom: TOM });
    assert.deepEqual(fichier.library.quizzes, { animaux: ANIMAUX });
    assert.deepEqual(fichier.library.songs, { djadja: SONG });
    assert.deepEqual(fichier.library.manches, {});
    assert.equal(fichier.library.images, undefined, "pas les fichiers des images");
    assert.equal(fichier.library.sounds, undefined, "pas les fichiers des sons");
    await page.locator("#sauvegarde-status", { hasText: `${telechargement.suggestedFilename()} (2 prestations,` }).waitFor();
    assert.deepEqual(await library(""), avant, "rien d'écrit en ligne");
    await page.context().close();

    // La Régie PC d'essai (adresse « …--essai-… ») a son bandeau ; la vraie, non.
    const essai = await openRegie(null, "?emu=1", "/admin.html");
    assert.equal(await essai.evaluate(() => document.body.classList.contains("essai")), false);
    await essai.goto(`${baseUrl.replace("127.0.0.1", "lmp--essai-x1.localhost")}/admin.html?emu=1`);
    await essai.locator("body.essai").waitFor({ state: "attached" });
    await essai.locator("#login-form").waitFor();
    assert.match(await essai.evaluate(() => getComputedStyle(document.body, "::before").content), /Régie PC d'essai/);
    await essai.context().close();
  });

  test("Bibliothèque › ❓ Questions (cedric, 22/10) : toutes prêtes, mes questions, mes packs JSON avec leur illustration ou une alerte", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX, mien: { title: "Mon quiz", source: "saisie", updatedAt: 5, questions: [
      { text: "De quelle couleur est le ciel ?", choices: ["Bleu", "Vert"], correct: 0, status: "validee", image: "☁️" },
      { text: "Question sans image", choices: ["Oui", "Non"], correct: 0, status: "validee" },
    ] } });
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="questions"]');
    await page.locator("#library-questions:not([hidden])").waitFor();
    assert.equal(await page.locator("#library-images").isHidden(), true);

    // Aperçu : les trois groupes, avec l'alerte sur ce qui n'a pas d'illustration.
    await page.locator('.q-groupe[data-groupe="illustrees"] .q-item').first().waitFor();
    await page.locator('.q-groupe[data-groupe="miennes"] .q-item[data-question="mien/0"] .q-illus.emoji', { hasText: "☁️" }).waitFor();
    await page.locator('.q-groupe[data-groupe="miennes"] .q-item.sans-illus[data-question="mien/1"] .q-alerte', { hasText: "⚠ Pas d'illustration" }).waitFor();
    await page.locator('.q-groupe[data-groupe="packs"] .pack[data-pack="animaux"]', { hasText: "⚠ 3 sans illustration" }).waitFor();
    await capture(page, "questions-apercu");
    // Ses questions se suppriment (cedric, 22/10) ; pas celles toutes prêtes de l'appli.
    assert.equal(await page.locator('.q-groupe[data-groupe="illustrees"] .q-item').first().getByRole("button", { name: "Supprimer" }).count(), 0);
    assert.equal(await page.locator('.q-groupe[data-groupe="illustrees"] .q-coche').count(), 0);
    await page.locator('.q-item[data-question="mien/1"]').getByRole("button", { name: "Supprimer" }).click();
    assert.equal(await repondreFenetre(page), "Supprimer la question « Question sans image » ?");
    await page.locator("#q-status", { hasText: "Question supprimée." }).waitFor();
    await waitFor(async () => (await library("quizzes/mien/questions"))?.length === 1, "une question de moins");
    assert.equal((await library("quizzes/mien/questions"))[0].text, "De quelle couleur est le ciel ?");
    // Annuler ne supprime rien ; la dernière question d'un quiz l'emporte avec elle, et la fenêtre le dit.
    await page.locator('.q-item[data-question="mien/0"]').getByRole("button", { name: "Supprimer" }).click();
    await repondreFenetre(page, { accepter: false });
    assert.equal((await library("quizzes/mien/questions")).length, 1);
    await page.locator('.q-item[data-question="mien/0"]').getByRole("button", { name: "Supprimer" }).click();
    assert.match(await repondreFenetre(page), /Le quiz « Mon quiz » n'a plus d'autre question : il sera supprimé aussi\./);
    await waitFor(async () => (await library("quizzes/mien")) === null, "quiz vidé supprimé");
    await page.locator('.q-groupe[data-groupe="miennes"] .q-item').first().waitFor({ state: "detached" });
    // Une seule recherche pour tout.
    await page.fill("#q-search", "miaou");
    await page.locator('.q-groupe[data-groupe="illustrees"] .q-item', { hasText: "miaou" }).first().waitFor();
    await waitFor(async () => await page.locator('.q-groupe[data-groupe="packs"] .pack').count() === 0, "aucun pack ne parle de miaou");
    await page.fill("#q-search", "");
    // Quiz illustré tout prêt : une puce par famille.
    await page.click('#q-groups [data-groupe="illustrees"]');
    const familles = page.locator(".q-categories [data-categorie]");
    await familles.first().waitFor();
    assert.ok(await familles.count() >= 4);
    const nomFamille = await familles.first().getAttribute("data-categorie");
    await familles.first().click();
    await page.locator(`.q-categories [data-categorie="${nomFamille}"].active`).waitFor();
    await page.locator("#q-list .q-item").first().waitFor();

    // Mes packs : un fichier JSON avec deux packs, une image déposée avec lui, un autre fichier illisible.
    await page.click('#q-groups [data-groupe="packs"]');
    await page.locator("#pack-import:not([hidden])").waitFor();
    assert.match(await page.locator("#pack-exemple").textContent(), /"illustration": "🐘"/);
    const PACKS = { packs: [
      { title: "Les animaux de la savane", theme: "Animaux", questions: [
        { text: "Quel animal a une très longue trompe ?", choices: ["Éléphant", "Girafe", "Lion", "Zèbre"], correct: 0, illustration: "🐘" },
        { text: "Quel animal est le roi de la savane ?", choices: ["Hippopotame", "Lion", "Gazelle", "Autruche"], correct: 1, illustration: "lion.png" },
        { text: "Combien de pattes a une girafe ?", correct: 4, illustration: "🦒" },
        { text: "Quel animal a des rayures ?", choices: ["Zèbre", "Lion"], correct: 0, illustration: "zebre.png" },
        { text: "Sans réponses" },
      ] },
      { title: "Espace", theme: "Sciences", questions: [{ text: "Quelle planète est rouge ?", choices: ["Mars", "Vénus"], correct: "Mars" }] },
    ] };
    await page.setInputFiles("#pack-file", [
      { name: "savane.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(PACKS)) },
      { name: "lion.png", mimeType: "image/png", buffer: png([200, 160, 60]) },
      { name: "casse.json", mimeType: "application/json", buffer: Buffer.from("{pas du json") },
    ]);
    await page.locator("#pack-status", { hasText: "2 packs importés : 5 questions, ⚠ 2 sans illustration, 1 ignorée (sans réponses). casse.json : Ce fichier n'est pas un JSON lisible." }).waitFor();
    const quizzes = await library("quizzes");
    const [idSavane, savane] = Object.entries(quizzes).find(([, q]) => q.title === "Les animaux de la savane");
    const [idEspace, espace] = Object.entries(quizzes).find(([, q]) => q.title === "Espace");
    assert.deepEqual([savane.source, savane.theme, savane.kind, savane.questions.length], ["json", "Animaux", "classique", 4]);
    assert.equal(savane.questions[0].image, "🐘");
    assert.match(savane.questions[1].imageId, /^[0-9a-f]{16}$/);
    assert.match(await library(`images/${savane.questions[1].imageId}`), /^data:image\//);
    assert.deepEqual([savane.questions[2].kind, savane.questions[2].correct, savane.questions[2].choices], ["number", 4, undefined]);
    assert.equal(savane.questions[3].imageId, undefined);
    assert.ok(savane.questions.every((q) => q.status === "validee"));
    assert.deepEqual([espace.theme, espace.questions[0].correct, espace.questions[0].status], ["Sciences", 0, "validee"]);
    assert.deepEqual(quizzes.animaux, ANIMAUX, "les autres quiz ne bougent pas");
    // Les packs importés à l'instant sont encadrés ; les packs sont rangés par thème (sans thème à la fin).
    await page.locator(`.pack.copie-recente[data-pack="${idSavane}"]`).waitFor();
    assert.deepEqual(await page.locator(".q-theme h3").allInnerTexts(), ["ANIMAUX · 1 PACK", "SCIENCES · 1 PACK", "SANS THÈME · 1 PACK"]);
    await page.locator(`.q-theme[data-theme="Animaux"] .pack[data-pack="${idSavane}"]`).waitFor();
    await page.locator('.q-theme[data-theme="Sans thème"] .pack[data-pack="animaux"]').waitFor();

    // Un pack s'ouvre sur ses questions : illustration là, ou l'alerte.
    await page.locator(`.pack[data-pack="${idSavane}"]`, { hasText: "⚠ 1 sans illustration" }).getByRole("button", { name: "Ouvrir" }).click();
    await page.locator("#q-list h2", { hasText: "Les animaux de la savane" }).waitFor();
    assert.equal(await page.locator("#pack-import").isHidden(), true);
    assert.equal(await page.locator("#q-list .q-item").count(), 4);
    await page.locator(`.q-item[data-question="${idSavane}/0"] .q-illus.emoji`, { hasText: "🐘" }).waitFor();
    await page.locator(`.q-item[data-question="${idSavane}/1"] img.q-illus[src^="data:image"]`).waitFor();
    await page.locator(`.q-item[data-question="${idSavane}/2"] .q-nombre`, { hasText: "réponse : 4" }).waitFor();
    await page.locator(`.q-item.sans-illus[data-question="${idSavane}/3"] .q-illus.vide`).waitFor();
    await page.locator(`.q-item.sans-illus[data-question="${idSavane}/3"] .q-alerte`, { hasText: "⚠ Pas d'illustration" }).waitFor();
    assert.equal(await page.locator(".q-item.sans-illus").count(), 1);
    // Plusieurs questions cochées, supprimées ensemble.
    await page.locator(`.q-item[data-question="${idSavane}/0"] .q-coche`).check();
    await page.locator(`.q-item[data-question="${idSavane}/2"] .q-coche`).check();
    await page.locator("#q-selection:not([hidden])", { hasText: "2 questions cochées" }).waitFor();
    await capture(page, "questions-pack-ouvert");
    // Sur l'écran du PC, « Éditer » et « Supprimer » restent côte à côte (cedric, 22/10 : « 30 cm » entre les deux).
    await page.setViewportSize({ width: 1440, height: 900 });
    const pied = page.locator(`.q-item[data-question="${idSavane}/1"] .q-pied`);
    const [editer, supprimer] = [await pied.getByRole("button", { name: "Éditer" }).boundingBox(), await pied.getByRole("button", { name: "Supprimer" }).boundingBox()];
    assert.ok(Math.abs(editer.y - supprimer.y) < 2 && supprimer.x - (editer.x + editer.width) < 20, `boutons écartés : ${JSON.stringify({ editer, supprimer })}`);
    await capture(page, "questions-pack-pc", { pleinePage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click("#q-tout");
    await page.locator("#q-selection-n", { hasText: "4 questions cochées" }).waitFor();
    assert.equal(await page.locator("#q-tout").isHidden(), true);
    await page.click("#q-aucune");
    await page.locator("#q-selection").waitFor({ state: "hidden" });
    await page.locator(`.q-item[data-question="${idSavane}/0"] .q-coche`).check();
    await page.locator(`.q-item[data-question="${idSavane}/2"] .q-coche`).check();
    await page.click("#q-supprimer");
    assert.equal(await repondreFenetre(page), "Supprimer 2 questions ?");
    await page.locator("#q-status", { hasText: "2 questions supprimées." }).waitFor();
    await waitFor(async () => (await library(`quizzes/${idSavane}/questions`))?.length === 2, "deux questions de moins dans le pack");
    assert.deepEqual((await library(`quizzes/${idSavane}/questions`)).map((q) => q.text), ["Quel animal est le roi de la savane ?", "Quel animal a des rayures ?"]);
    await page.locator("#q-selection").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#q-list .q-item").count(), 2);

    // « Éditer le pack » : la relecture habituelle du quiz.
    await page.getByRole("button", { name: "Éditer le pack" }).click();
    await page.locator("#screen-review:not([hidden])").waitFor();
    assert.equal(await page.locator("#rv-title").inputValue(), "Les animaux de la savane");
    await page.goBack();
    await page.locator("#library-questions:not([hidden])").waitFor();

    // Renommer et Supprimer un pack (fenêtres de la Régie PC).
    await page.click('#q-groups [data-groupe="packs"]');
    await page.locator(`.pack[data-pack="${idSavane}"]`).getByRole("button", { name: "Renommer" }).click();
    await repondreFenetre(page, { texte: "La savane" });
    await waitFor(async () => (await library(`quizzes/${idSavane}`)).title === "La savane", "pack renommé");
    await page.locator(`.pack[data-pack="${idEspace}"]`).getByRole("button", { name: "Supprimer" }).click();
    assert.match(await repondreFenetre(page), /Supprimer le quiz « Espace » \?/);
    await waitFor(async () => (await library(`quizzes/${idEspace}`)) === null, "pack supprimé");
    await page.locator(`.pack[data-pack="${idEspace}"]`).waitFor({ state: "detached" });
    await page.context().close();
  });

  test("prestation de test : ajoutée en un clic sans rien remplacer, modifiée dans l'admin, chargée telle quelle sur la TV", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    const INES = { childName: "Inès", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 };
    await seedLibrary("shows", { ines: INES });
    const page = await admin();
    await page.click("#nav button[data-screen=settings]");
    await page.click("#test-create");
    await page.locator("#test-status", { hasText: "Ajoutée" }).waitFor();
    await page.click("#test-create");
    await page.locator("#test-status", { hasText: "existe déjà" }).waitFor();
    const shows = await library("shows");
    assert.deepEqual(Object.keys(shows).sort(), ["ines", "test-lea-9-ans"]);
    assert.deepEqual(shows.ines, INES, "Prestation existante intacte");
    assert.deepEqual((await library("quizzes")).animaux, ANIMAUX, "Quiz existant intact");

    // Dans l'administration : la prestation, puis ses 10 questions, dont Sarah corrige la première.
    // Elle est dans une des listes (« À venir » jusqu'au lendemain de sa date, puis « Archivées »).
    await page.click("#nav button[data-screen=home]");
    await page.click('#screen-home [data-etat="avenir"]');
    await page.fill("#show-search", "ANNIVERSAIRE TEST");
    await page.locator('#show-list [data-show="test-lea-9-ans"], #show-ailleurs [data-ailleurs="archivee"]').first().waitFor();
    await openQuizzes(page);
    await page.locator('#quiz-list [data-quiz="test-lea-9-ans"]', { hasText: "10 questions · 10 validées" }).getByRole("button", { name: "Éditer" }).click();
    await page.locator('[data-q="9"]').waitFor();
    await page.locator('[data-q="0"] .q-text').fill("Quelle est la capitale de la France ? (modifiée dans l'admin)");
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "10 questions validées sur 10" }).waitFor();
    await page.context().close();

    // Sur la régie : la même prestation, chargée sur la TV avec la question modifiée.
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator(".show-item", { hasText: "ANNIVERSAIRE TEST – Léa, 9 ans" }).click();
    // Fenêtre de lancement, sur le téléphone seulement : « Lancer » confirme.
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    // Ses 10 questions, plus celle des bougies juste avant la dernière (qui compte double).
    const q = (await read("show")).quiz.questions;
    assert.equal(q.length, 11);
    assert.equal(q[0].text, "Quelle est la capitale de la France ? (modifiée dans l'admin)");
    assert.deepEqual([q[9].kind, q[9].correct, q[9].text], ["number", 9, "Le Juste Chiffre : combien de bougies sur le gâteau de Léa cette année ?"]);
    assert.equal(q[10].double, true);
    await regie.context().close();
  });

  test("prestation de test « tous les jeux » : photos dessinées, un peu de chaque jeu, rien de remplacé", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    const page = await admin();
    await page.click("#nav button[data-screen=settings]");
    await page.click("#test-full-create");
    await page.locator("#test-full-status", { hasText: "Ajoutée" }).waitFor({ timeout: 20000 });
    await page.click("#test-full-create");
    await page.locator("#test-full-status", { hasText: "existe déjà" }).waitFor();
    await page.context().close();
    const images = await library("images");
    assert.equal(Object.keys(images).length, 12, "deux photos pour le Zoom mystère, deux pour l'Image floue, huit réponses en images");
    assert.ok(Object.values(images).every((d) => d.startsWith("data:image/jpeg") && d.length < 150000));
    assert.deepEqual((await library("quizzes")).animaux, ANIMAUX, "Quiz existant intact");
    assert.equal((await library("mimes"))["test-lea-tous-les-jeux-mimes"].cards.length, 6);
    const sounds = await library("sounds");
    assert.equal(Object.keys(sounds).length, 4, "quatre comptines");
    for (const [id, data] of Object.entries(sounds)) {
      assert.ok(data.startsWith("data:audio/mpeg;base64,") && data.length < 880000);
      assert.equal(createHash("sha256").update(data).digest("hex").slice(0, 16), id, "identifiant = empreinte du contenu");
    }
    assert.deepEqual((await library("playlists"))["test-lea-tous-les-jeux-comptines"].tracks.map((t) => t.title), ["Frère Jacques", "Au clair de la lune", "Ah ! vous dirai-je, maman", "Joyeux anniversaire"]);

    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator(".show-item", { hasText: "tous les jeux" }).click();
    // Fenêtre de lancement, sur le téléphone seulement : « Lancer » confirme.
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const kinds = [...new Set((await read("show")).quiz.questions.map((q) => q.kind))];
    assert.deepEqual(kinds, ["classic", "number", "express", "mime", "zoom", "chante", "flou", "quisuis", "disparu", "blind", "statues", "pictionary", "gonfleur", "patate", "coffres"]);
    assert.equal((await read("show")).quiz.questions.filter((q) => q.kind === "classic" && q.audioId).length, 4, "quiz musical sur les comptines");
    await waitFor(async () => Object.keys((await read("images")) ?? {}).length === 4, "photos copiées dans la partie");
    assert.equal((await read("show")).quiz.questions.filter((q) => q.choiceImages?.length === 4 && q.round === "Quiz illustré").length, 2, "Quiz illustré des petits");
    await waitFor(async () => Object.keys((await read("choiceImages")) ?? {}).length === 8, "réponses en images copiées dans la partie");
    await waitFor(async () => Object.keys((await read("sounds")) ?? {}).length === 4, "comptines copiées dans la partie", 15000);
    await regie.context().close();
  });

  test("blind test démo : 10 chansons de la bibliothèque au hasard (refrain d'abord), en premier jeu de la prestation de test ; un nouveau clic en tire d'autres", async () => {
    const hex = (n) => n.toString(16).padStart(16, "0");
    // 12 chansons : 10 avec leur refrain, 2 sans (jamais tirées tant qu'il y en a assez avec refrain).
    const songs = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`s${i}`, {
      title: `Chanson ${i}`, artist: "Artiste", audioId: hex(100 + i), buzz: 30, createdAt: 1, updatedAt: 1,
      ...(i < 10 ? { refrainId: hex(200 + i), refrain: 60, paroles: `0|La la ${i}` } : {}),
    }]));
    await seedLibrary("songs", songs);
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    const fete = { ...FULL_SHOW, origin: "test", updatedAt: 1, rounds: [{ type: "quiz", quizId: "animaux" }, { type: "coffres" }] };
    await seedLibrary("shows/test-lea-tous-les-jeux", fete);
    const page = await admin();
    await page.click("#nav button[data-screen=settings]");
    await page.click("#test-blind-demo");
    await page.locator("#test-blind-status", { hasText: "Blind test démo prêt : 10 chansons tirées au hasard, en premier jeu de « ANNIVERSAIRE TEST – Léa, 9 ans · tous les jeux »" }).waitFor();
    const demo = await library("playlists/test-lea-tous-les-jeux-blind-demo");
    assert.equal(demo.title, "TEST – Blind test démo");
    assert.equal(demo.tracks.length, 10);
    assert.ok(demo.tracks.every((t) => /^[0-9a-f]{16}$/.test(t.refrainId) && t.paroles.startsWith("0|La la")), "les chansons avec refrain d'abord, avec leurs paroles");
    let show = await library("shows/test-lea-tous-les-jeux");
    assert.deepEqual(show.rounds, [{ type: "blind", playlistId: "test-lea-tous-les-jeux-blind-demo" }, ...fete.rounds]);
    // Un nouveau clic : un autre tirage, toujours un seul blind test démo dans la prestation.
    await page.click("#test-blind-demo");
    await waitFor(async () => (await library("playlists/test-lea-tous-les-jeux-blind-demo")).updatedAt !== demo.updatedAt, "nouveau tirage");
    show = await library("shows/test-lea-tous-les-jeux");
    assert.equal(show.rounds.filter((r) => r.playlistId === "test-lea-tous-les-jeux-blind-demo").length, 1);
    assert.equal(show.rounds.length, 3);
    await page.context().close();
  });

  test("prestation de test « tous les jeux » d'une version précédente : le bouton lui ajoute les nouveaux jeux et retire l'ancienne manche Super Finale", async () => {
    const old = { childName: "Léa", age: 9, status: "publiee", title: "ANNIVERSAIRE TEST – Léa, 9 ans · tous les jeux", origin: "test", updatedAt: 1,
      rounds: [{ type: "quiz", quizId: "animaux" }, { type: "chante", count: 3 }, { type: "finale", quizId: "finale" }] };
    await seedLibrary("quizzes", { animaux: ANIMAUX, finale: FINALE });
    await seedLibrary("shows/test-lea-tous-les-jeux", old);
    const page = await admin();
    await page.click("#nav button[data-screen=settings]");
    await page.click("#test-full-create");
    await page.locator("#test-full-status", { hasText: "Mise à jour" }).waitFor({ timeout: 20000 });
    await page.context().close();
    const show = await library("shows/test-lea-tous-les-jeux");
    // L'ancienne manche « Super Finale » disparaît : les 3 dernières questions du quiz comptent double.
    assert.deepEqual(show.rounds.map((r) => r.type), ["quiz", "chante", "disparu", "blind", "musical", "statues", "pictionary", "illustre", "gonfleur", "patate", "coffres"]);
    assert.equal(show.rounds[0].finale, 3);
    assert.equal(show.rounds[7].quizId, "test-lea-tous-les-jeux-images");
    assert.equal((await library("quizzes"))["test-lea-tous-les-jeux-images"].questions.length, 2);
    assert.equal(show.childName, "Léa");
    assert.equal(Object.keys(await library("sounds")).length, 4);
  });

  test("prestation de test « tous les jeux » d'hier : le quiz des petits devient un Quiz illustré, les quiz de test sont renommés, rien d'autre ne change", async () => {
    // Version du 20 octobre : le quiz des petits dans une manche « Quiz », un quiz classique nommé « Quiz illustré ».
    const hier = { ...FULL_SHOW, origin: "test", updatedAt: 1, rounds: FULL_SHOW.rounds.map((r) => (r.type === "illustre" ? { ...r, type: "quiz" } : r)) };
    await seedLibrary("shows/test-lea-tous-les-jeux", hier);
    await seedLibrary("quizzes", {
      [FULL_KEYS.quiz]: { ...FULL_QUIZZES[FULL_KEYS.quiz], title: "TEST – Quiz illustré de Léa", updatedAt: 1 },
      [FULL_KEYS.images]: { title: "TEST – Quiz en images des petits", source: "saisie", updatedAt: 1, questions: [{ text: "Où est le chat ?", choices: ["Chat", "Chien"], correct: 0, status: "validee", choiceImages: ["1111111111111111", "2222222222222222"] }] },
      animaux: ANIMAUX,
    });
    const page = await admin();
    await page.click("#nav button[data-screen=settings]");
    await page.click("#test-full-create");
    await page.locator("#test-full-status", { hasText: "Le quiz en images des petits devient un Quiz illustré." }).waitFor({ timeout: 20000 });
    await page.locator("#test-full-status", { hasText: "Quiz de test renommés" }).waitFor();
    const show = await library("shows/test-lea-tous-les-jeux");
    assert.deepEqual(show.rounds, FULL_SHOW.rounds, "seule la manche des petits change de jeu");
    const quizzes = await library("quizzes");
    assert.equal(quizzes[FULL_KEYS.quiz].title, "TEST – Quiz classique de Léa");
    assert.equal(quizzes[FULL_KEYS.images].title, "TEST – Quiz illustré des petits");
    assert.deepEqual(quizzes[FULL_KEYS.quiz].questions, FULL_QUIZZES[FULL_KEYS.quiz].questions, "questions intactes");
    assert.deepEqual(quizzes.animaux, ANIMAUX, "quiz de Sarah intact");
    // Une seconde fois : plus rien à faire.
    await page.click("#test-full-create");
    await page.locator("#test-full-status", { hasText: "existe déjà" }).waitFor();
    await page.context().close();
  });

  test("Sarah importe ses fichiers musicaux : extraits réencodés en MP3 léger, titre et artiste devinés, chargés sur la TV", async () => {
    const page = await admin();
    await page.click(".tile[data-screen=music]");
    await page.click("#game-tabs [data-tab=collections]");
    await page.click("#playlist-new");
    await page.fill("#playlist-title", "Dessins animés");
    await page.selectOption("#playlist-duration", "20");
    await page.setInputFiles("#playlist-files", [
      { name: "La Reine des neiges - Libérée délivrée.wav", mimeType: "audio/wav", buffer: wav(440, 40) },
      { name: "Hakuna Matata.wav", mimeType: "audio/wav", buffer: wav(330, 30) },
    ]);
    await page.locator(".track").nth(1).waitFor();
    assert.equal(await page.locator(".track input[aria-label=Titre]").first().inputValue(), "Libérée délivrée");
    assert.equal(await page.locator(".track input[aria-label=Artiste]").first().inputValue(), "La Reine des neiges");
    // Sans titre, refus clair ; puis on le complète.
    await page.locator(".track input[aria-label=Titre]").nth(1).fill("");
    await page.click("#playlist-save");
    await page.locator("#playlist-status", { hasText: "Morceau 2 : indiquez son titre" }).waitFor();
    await page.locator(".track input[aria-label=Titre]").nth(1).fill("Hakuna Matata");
    await page.locator(".track input[aria-label=Droits]").nth(1).fill("CD de Sarah");
    await page.click("#playlist-save");
    await page.locator("#playlist-status", { hasText: "Enregistrée : 2 morceaux" }).waitFor({ timeout: 30000 });
    // « Régler… » une chanson de la bibliothèque : un écran à son nom, sans ajout de fichiers ni retrait ;
    // l'artiste corrigé suit dans la playlist.
    // Les chansons sont rangées dans Bibliothèque › Sons (lien depuis les playlists).
    await page.click("#playlist-crumb");
    await page.click("#music-songs");
    await page.locator("#library-sons:not([hidden])").waitFor();
    assert.equal(await page.locator("#nav button.active").textContent(), "Bibliothèque");
    await page.locator("#song-list .song", { hasText: "Hakuna Matata" }).getByRole("button", { name: "⏱ Réglé ✓" }).click();
    assert.equal(await page.locator("#playlist-crumb").textContent(), "Bibliothèque");
    await page.locator("#playlist-edit-title", { hasText: "Réglages de « Hakuna Matata »" }).waitFor();
    assert.equal(await page.locator(".track").count(), 1);
    for (const sel of ["#playlist-duration", "#playlist-files", "#playlist-count", ".track button[title^=Retirer]"]) {
      assert.equal(await page.locator(sel).first().isVisible(), false, `${sel} caché pour une seule chanson`);
    }
    await page.locator(".track input[aria-label=Artiste]").fill("Le Roi lion");
    assert.equal(await page.locator("#playlist-save").textContent(), "Enregistrer les réglages");
    await page.click("#playlist-save");
    await page.locator("#song-status", { hasText: "Réglages de « Hakuna Matata » enregistrés." }).waitFor({ timeout: 30000 });
    await waitFor(async () => Object.values(await library("playlists"))[0].tracks[1].artist === "Le Roi lion", "artiste suivi dans la playlist");
    await page.context().close();
    const [id, pl] = Object.entries(await library("playlists"))[0];
    assert.equal(pl.duration, 20);
    assert.deepEqual(pl.tracks.map((t) => [t.title, t.artist ?? null, t.rights ?? null]), [["Libérée délivrée", "La Reine des neiges", null], ["Hakuna Matata", "Le Roi lion", "CD de Sarah"]]);
    const sounds = await library("sounds");
    for (const t of pl.tracks) {
      const data = sounds[t.audioId];
      assert.ok(data?.startsWith("data:audio/mpeg;base64,"), "extrait MP3 rangé");
      assert.equal(createHash("sha256").update(data).digest("hex").slice(0, 16), t.audioId);
      // 20 s de MP3 mono : bien plus léger que le fichier d'origine.
      assert.ok(data.length < 350000, `extrait léger (${data.length})`);
      // Le refrain de la révélation, rangé à part, sous la limite d'un extrait.
      assert.ok(sounds[t.refrainId]?.startsWith("data:audio/mpeg;base64,") && sounds[t.refrainId].length <= 880000, "refrain rangé");
    }
    // Bibliothèque des sons : une chanson par morceau, avec ses préréglages ; les morceaux la désignent.
    const songs = await library("songs");
    assert.deepEqual(pl.tracks.map((t) => songs[t.songId]?.title), ["Libérée délivrée", "Hakuna Matata"]);
    // Leurs chansons entières aussi, pour les régler depuis n'importe quel PC.
    for (const t of pl.tracks) assert.equal((await library(`entieres/${t.songId}`))?.kbps, 96);
    assert.ok(pl.tracks.every((t) => songs[t.songId].buzz === 20 && songs[t.songId].refrainId === t.refrainId && Number.isFinite(songs[t.songId].refrain)));

    await seedLibrary("shows/musique", { childName: "Tom", age: 8, date: "2026-12-02", status: "publiee", updatedAt: 1,
      rounds: [{ type: "blind", playlistId: id }, { type: "musical", playlistId: id }] });
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator(".show-item", { hasText: "Tom" }).click();
    // Fenêtre de lancement, sur le téléphone seulement : « Lancer » confirme.
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const qs = (await read("show")).quiz.questions;
    assert.deepEqual(qs.map((q) => q.kind), ["blind", "blind", "classic", "classic"]);
    assert.ok(qs.every((q) => pl.tracks.some((t) => t.audioId === q.audioId) && q.duration === 20));
    // Extraits et refrains (joués à la révélation du blind test) copiés dans la partie.
    await waitFor(async () => Object.keys((await read("sounds")) ?? {}).length === 4, "extraits et refrains copiés dans la partie");
    assert.ok(qs.filter((q) => q.kind === "blind").every((q) => pl.tracks.some((t) => t.refrainId === q.refrainId)));
    await regie.context().close();
  });

  test("Statues musicales : Sarah dépose ses chansons depuis la page du jeu, les coche dans la prestation, la TV les reçoit", async () => {
    const page = await admin();
    await page.locator('#screen-home .tile[data-game="statues"]', { hasText: "0 chanson" }).waitFor();
    await openGamePage(page, "statues", "collections");
    await page.locator("#screen-playlist-edit:not([hidden])").waitFor();
    assert.equal(await page.locator("#playlist-crumb").textContent(), "Statues musicales");
    assert.equal(await page.locator("#playlist-scale").isHidden(), true, "pas de barème de blind test");
    assert.deepEqual(await page.locator("#playlist-duration option").allTextContents(), ["1 minute", "1 min 30"]);
    await page.setInputFiles("#playlist-files", [
      { name: "La danse des canards.wav", mimeType: "audio/wav", buffer: wav(440, 70) },
      { name: "Tourner.wav", mimeType: "audio/wav", buffer: wav(330, 65) },
    ]);
    await page.locator(".track").nth(1).waitFor();
    assert.equal(await page.locator(".track input[aria-label=Points]").count(), 0);
    assert.equal(await page.locator(".track-note").count(), 0);
    await page.click("#playlist-save");
    await page.locator("#playlist-status", { hasText: "Enregistrée : 2 chansons" }).waitFor({ timeout: 60000 });
    const [listId, list] = Object.entries(await library("playlists"))[0];
    assert.deepEqual([list.use, list.duration, list.title, list.points], ["statues", 60, "Chansons des statues musicales", undefined]);
    assert.deepEqual(list.tracks.map((t) => t.title), ["La danse des canards", "Tourner"]);
    const sounds = await library("sounds");
    assert.ok(list.tracks.every((t) => sounds[t.audioId]?.startsWith("data:audio/mpeg;base64,") && sounds[t.audioId].length <= 880000));
    // La liste n'est pas une playlist de blind test.
    await page.click("#nav button[data-screen=home]");
    await page.click(".tile[data-screen=music]");
    await page.click("#game-tabs [data-tab=collections]");
    assert.equal(await page.locator(`#playlist-list [data-playlist="${listId}"]`).count(), 0);
    await page.click("#nav button[data-screen=home]");
    await page.locator('#screen-home .tile[data-game="statues"]', { hasText: "2 chansons" }).waitFor();

    // Une playlist de blind test : ses chansons se cochent aussi pour les statues, sans l'être d'office.
    await seedLibrary("playlists/blind", { title: "Dessins animés", duration: 25, tracks: [{ title: "Hakuna", audioId: list.tracks[0].audioId }, { title: "Libérée", audioId: "1111111111111111" }] });

    // Prestation : la manche part avec les chansons de la liste cochées ; Sarah en décoche une, en ajoute une d'une playlist.
    await page.click("#nav button[data-screen=home]");
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "7");
    await ajouterJeu(page, "statues");
    const songs = page.locator("#show-rounds .statues-song input");
    await songs.nth(2).waitFor();
    assert.deepEqual(await page.locator("#show-rounds .statues-list").allTextContents(), ["Chansons des statues", "Dessins animés"]);
    assert.deepEqual(await songs.evaluateAll((els) => els.map((e) => e.checked)), [true, true, false], "même chanson dans deux listes : une seule case");
    await songs.nth(0).uncheck();
    await page.locator("#show-rounds .statues-songs", { hasText: "1 chanson cochée, jouée en boucle" }).waitFor();
    await aVenir(page);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    const [, saved] = Object.entries(await library("shows"))[0];
    assert.deepEqual(await sansManche(saved.rounds), [{ type: "statues", duration: 90, songs: [list.tracks[1].audioId] }]);
    await page.context().close();

    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator(".show-item", { hasText: "Léa" }).click();
    // Fenêtre de lancement, sur le téléphone seulement : « Lancer » confirme.
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const [q] = (await read("show")).quiz.questions;
    assert.deepEqual([q.kind, q.audioIds], ["statues", [list.tracks[1].audioId]]);
    await waitFor(async () => Object.keys((await read("sounds")) ?? {}).length === 1, "chanson copiée dans la partie");
    await regie.context().close();
  });

  test("une prestation en brouillon n'apparaît pas sur la régie ; le code de secours ne donne pas la liste", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    await seedLibrary("shows", {
      a: { childName: "Tom", status: "brouillon", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 },
      b: { childName: "Inès", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 },
    });
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator(".show-item", { hasText: "Inès" }).waitFor();
    assert.equal(await regie.locator(".show-item", { hasText: "Tom" }).count(), 0);
    await regie.context().close();

    const secours = await openRegie();
    await secours.locator("#regie-open:not([hidden])").click();
    await secours.click("#regie-use-pin");
    await secours.fill("#regie-pin", PIN);
    await secours.click("#regie-go");
    await inRegie(secours);
    await secours.locator("#panel-show", { hasText: "entrez dans la régie avec le mot de passe" }).waitFor();
    await secours.context().close();
  });

  test("les équipes voient le prénom de l'enfant fêté en rejoignant la partie", async () => {
    await update(gameRef(), { public: { title: "L'anniversaire de Léa", childName: "Léa" } });
    const page = await openRegie();
    await page.locator("#join-welcome", { hasText: "Joyeux anniversaire Léa !" }).waitFor();
    await page.context().close();
  });
});

describe("défis de la pause", () => {
  const defis = async () => (await get(ref(hostDb(), "settings/defis/list"))).val();

  test("la régie ajoute, modifie et efface les défis affichés pendant la pause", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await page.click("#tab-defis");
    // Rien d'enregistré : la liste d'origine s'affiche, prête à être modifiée.
    await page.locator("#panel-defis ol.defis input").nth(6).waitFor();
    assert.equal(await page.locator("#panel-defis ol.defis input").count(), 7);

    await page.fill('#panel-defis input[aria-label="Nouveau défi"]', "Tout le monde imite un lion !");
    await page.click("#panel-defis .defi-ajout button");
    await waitFor(async () => (await defis())?.length === 8, "défi ajouté");
    assert.equal((await defis())[7], "Tout le monde imite un lion !");

    await page.locator("#panel-defis ol.defis input").first().fill("La ola, deux fois !");
    await page.locator("#panel-defis ol.defis input").first().press("Enter");
    await page.locator("#panel-defis ol.defis input").first().blur();
    await waitFor(async () => (await defis())?.[0] === "La ola, deux fois !", "défi modifié");

    await page.locator("#panel-defis .defi-effacer").first().click();
    await waitFor(async () => (await defis())?.length === 7 && (await defis())[0] !== "La ola, deux fois !", "défi effacé");
    await page.context().close();
  });
});

describe("activation des box", () => {
  const boxes = async (path) => {
    let value;
    await env.withSecurityRulesDisabled(async (ctx) => { value = (await get(ref(ctx.database(), `boxes/${path}`))).val(); });
    return value;
  };
  const demande = (uid, code, model) => set(ref(env.authenticatedContext(uid).database(), `boxes/requests/${uid}`), { code, model, at: serverTimestamp() });

  test("la Régie PC signale une nouvelle box, l'accepte, la renomme et la retire", async () => {
    const page = await openAdmin();
    await demande("tv-neuve", "KX7P", "TCL 55C735");
    // Accueil : la demande saute aux yeux, avec le même code que sur la TV.
    await page.locator("#home-boxes:not([hidden])", { hasText: "KX7P" }).waitFor();
    assert.equal(await page.locator("#nav-boxes").textContent(), "1");
    await page.click("#home-boxes");
    const row = page.locator('#box-requests [data-box="tv-neuve"]');
    await row.locator(".box-code", { hasText: "KX7P" }).waitFor();
    assert.equal(await row.locator("input").inputValue(), "TCL 55C735");
    await row.locator("input").fill("TV du salon");
    await row.getByRole("button", { name: "Accepter" }).click();
    await waitFor(async () => (await boxes("allowed/tv-neuve"))?.name === "TV du salon", "box acceptée");
    assert.equal(await boxes("requests/tv-neuve"), null);
    await page.locator("#nav-boxes[hidden]").waitFor({ state: "attached" });
    await page.locator('#box-allowed [data-box="tv-neuve"]', { hasText: "TV du salon" }).waitFor();

    await page.locator('#box-allowed [data-box="tv-neuve"]').getByRole("button", { name: "Renommer" }).click();
    assert.equal(await repondreFenetre(page, { texte: "Mi Box de Sarah" }), "Nouveau nom de la box :");
    await waitFor(async () => (await boxes("allowed/tv-neuve/name")) === "Mi Box de Sarah", "box renommée");
    await page.locator('#box-allowed [data-box="tv-neuve"]').getByRole("button", { name: "Retirer" }).click();
    assert.match(await repondreFenetre(page), /^Retirer « Mi Box de Sarah » \?/);
    await waitFor(async () => (await boxes("allowed/tv-neuve")) === null, "box retirée");
    await page.locator('#box-allowed [data-box="tv-neuve"]').waitFor({ state: "detached" });
    await page.locator(`#box-allowed [data-box="${HOST}"]`).waitFor();
    await page.context().close();
  });

  test("la Régie PC refuse la demande d'un inconnu", async () => {
    const page = await openAdmin();
    await page.click('#nav [data-screen="settings"]');
    await demande("pirate", "ZZ99", "Box inconnue");
    const row = page.locator('#box-requests [data-box="pirate"]');
    await row.getByRole("button", { name: "Refuser" }).click();
    assert.equal(await repondreFenetre(page), "Refuser la box au code ZZ99 ? Elle restera bloquée.");
    await waitFor(async () => (await boxes("requests/pirate")) === null, "demande refusée");
    assert.equal(await boxes("allowed/pirate"), null);
    await page.locator("#box-requests", { hasText: "Aucune demande" }).waitFor();
    await page.context().close();
  });
});

describe("Régie PC : nettoyage des copies des fêtes terminées (cedric, 21/10)", () => {
  const H = 3600_000;
  const S1 = "1111111111111111", S2 = "2222222222222222", PERDU = "dddddddddddddddd";
  const I1 = "aaaaaaaaaaaaaaaa", C1 = "cccccccccccccccc", B1 = "bbbbbbbbbbbbbbbb", B2 = "eeeeeeeeeeeeeeee";
  const MP3 = "data:audio/mpeg;base64,SUQzBAAAAAAA", JPG = "data:image/jpeg;base64,/9j/4AAQ";
  /** Prestation archivée toute seule le lendemain de sa date, déjà passée : ne compte jamais pour le nettoyage. */
  const LEA_ARCHIVEE = { childName: "Léa", age: 7, date: "2026-09-12", status: "archivee", rounds: [{ type: "quiz", quizId: "q" }], updatedAt: 1 };
  const brut = async (path = "") => {
    let v;
    await env.withSecurityRulesDisabled(async (ctx) => { v = (await get(ref(ctx.database(), path))).val(); });
    return v;
  };
  const table = (ids, data) => (ids.length ? Object.fromEntries(ids.map((id) => [id, data])) : undefined);
  /** Une partie complète (équipes, scores, journal, programme, régie) et ses copies. */
  const partie = ({ phase = "ended", endedAt, createdAt, title, childName, sounds = [], images = [], choiceImages = [] }) => JSON.parse(JSON.stringify({
    hostUid: HOST, createdAt, appVersion: "1.0",
    state: { phase, seq: 7, scores: { rose: 250, bleu: 120 }, endedAt },
    teams: { rose: { name: "Les Roses", color: "#FF2D8A" }, bleu: { name: "Les Bleus", color: "#2B86C5" } },
    log: { "000001": { seq: 1, at: 1, type: "game_started" }, "000002": { seq: 2, at: 2, type: "awarded", team: "rose", points: 250 } },
    conducteur: { id: "lea", title: title ?? "Démo", rev: "r1", questions: [{ id: "q1", text: "Couleur ?", audioId: S1 }] },
    show: { id: "s1", title: title ?? "Démo", quiz: { questions: [{ text: "Couleur ?" }] }, by: "tel", at: 1 },
    regie: { tel: { pairedAt: 1, via: "pin" } }, media: { [S1]: "ok" },
    public: title ? { title, childName } : undefined,
    sounds: table(sounds, MP3), images: table(images, JPG), choiceImages: table(choiceImages, JPG),
  }));
  let fetes;
  /**
   * Six parties : une à nettoyer, une terminée il y a 2 h, une interrompue depuis un mois (sa prestation est archivée, sa
   * date passée, et la partie a été confiée à une autre box), une terminée sans heure de fin il y a plus de 48 h avec un
   * extrait dont la chanson a quitté la bibliothèque, une sans copie (et REGI2, au salon).
   */
  async function seedFetes() {
    const now = Date.now();
    fetes = {
      FETE1: partie({ endedAt: now - 25 * H, createdAt: now - 27 * H, title: "L'anniversaire de Léa", childName: "Léa", sounds: [S1, S2], images: [I1, B1], choiceImages: [C1] }),
      FETE2: partie({ endedAt: now - 2 * H, createdAt: now - 5 * H, title: "L'anniversaire de Tom", childName: "Tom", sounds: [S1], images: [I1] }),
      FETE3: { ...partie({ phase: "question", createdAt: now - 30 * 24 * H, sounds: [S2], choiceImages: [C1] }), takeover: { to: "box2", at: now - 29 * 24 * H } },
      FETE4: partie({ createdAt: now - 49 * H, sounds: [S1, PERDU], images: [B2] }),
      FETE5: partie({ endedAt: now - 72 * H, createdAt: now - 75 * H }),
    };
    fetes.FETE3.show.id = fetes.FETE3.conducteur.id = "lea-sept";
    await env.withSecurityRulesDisabled((ctx) => update(ref(ctx.database()), {
      [`library/sounds/${S1}`]: MP3, [`library/sounds/${S2}`]: MP3, [`library/images/${I1}`]: JPG, [`library/images/${C1}`]: JPG, "library/shows/lea-sept": LEA_ARCHIVEE,
      ...Object.fromEntries(Object.entries(fetes).map(([code, g]) => [`games/${code}`, g])),
    }));
    fetes.REGI2 = await brut(`games/${CODE}`);
  }

  /** Un passage déjà noté dans le journal, [depuis] ms avant maintenant (clé de journal comme celles de la Régie PC). */
  async function passageNote(depuis, type = "nettoyage") {
    let cle;
    await env.withSecurityRulesDisabled((ctx) => {
      const r = push(ref(ctx.database(), "maintenance/passages"));
      cle = r.key;
      return set(r, { at: Date.now() - depuis, type, parties: 6, nettoyees: 0, copies: 7, mo: 2.09 });
    });
    return cle;
  }

  /**
   * Régie PC ouverte en notant ce qu'elle lit : adresses REST de la base, et chemins lus avec le SDK (trames du
   * websocket). [context] : le même navigateur qu'avant (déjà reconnu, il entre sans mot de passe).
   */
  async function ouvrir(context = null) {
    context ??= await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const vu = { rest: [], sdk: [] };
    context.removeAllListeners("page");
    context.on("page", (p) => {
      p.on("request", (r) => { if (/:9000\/.*\.json/.test(r.url())) vu.rest.push(r.url()); });
      p.on("websocket", (ws) => ws.on("framesent", ({ payload }) => {
        try {
          const m = JSON.parse(payload);
          if (["g", "q"].includes(m?.d?.a)) vu.sdk.push(m.d.b.p);
        } catch { /* trame non JSON */ }
      }));
    });
    const page = await openRegie(context, "?emu=1", "/admin.html");
    return { page, vu };
  }
  const connecter = async (page) => {
    await page.fill("#admin-password", ADMIN_PASSWORD);
    await page.click("#login");
    await page.locator("#screen-home:not([hidden])").waitFor();
  };
  /** Rien n'a bougé dans ces parties. */
  async function intactes(codes) {
    for (const code of codes) assert.deepEqual(await brut(`games/${code}`), fetes[code], `${code} intacte`);
  }
  const passages = async () => Object.values((await brut("maintenance/passages")) ?? {}).sort((a, b) => a.at - b.at);
  const GARDEES = { enCours: 2, recente: 2, orphelins: 1 };
  const TEXTE_GARDEES = "Copies gardées : 2 (partie en cours ou interrompue), 2 (terminée depuis moins de 24 h), 1 (chanson plus dans la bibliothèque)";

  /** Après le nettoyage : FETE1 sans copies, FETE4 avec son seul extrait sans chanson ; tout le reste intact. */
  async function nettoyees() {
    assert.deepEqual([await brut("games/FETE1/sounds"), await brut("games/FETE1/images"), await brut("games/FETE1/choiceImages")], [null, null, null]);
    assert.deepEqual(await brut("games/FETE4/sounds"), { [PERDU]: MP3 });
    assert.equal(await brut("games/FETE4/images"), null);
    // Tout le reste de ces parties est là : état, scores, journal, équipes, programme, régie, titre.
    for (const code of ["FETE1", "FETE4"]) {
      const { sounds, images, choiceImages, ...reste } = fetes[code];
      const { sounds: s2, images: i2, choiceImages: c2, ...apres } = await brut(`games/${code}`);
      assert.deepEqual(apres, reste, `${code} : seulement les copies effacées`);
    }
    // La partie interrompue (prestation archivée, date passée), celle finie il y a 2 h et les autres : intactes.
    await intactes(["FETE2", "FETE3", "FETE5", CODE]);
    assert.deepEqual(await brut("library"), { sounds: { [S1]: MP3, [S2]: MP3 }, images: { [I1]: JPG, [C1]: JPG }, shows: { "lea-sept": LEA_ARCHIVEE } });
  }

  test("premier passage à l'ouverture : un contrôle qui compte sans rien effacer ; « Vérifier maintenant » montre le détail, sans rien télécharger", async () => {
    await seedFetes();
    const { page, vu } = await ouvrir();
    await connecter(page);
    await waitFor(async () => (await passages()).length === 1, "premier passage noté", 20000);
    const [controle] = await passages();
    assert.deepEqual({ ...controle, at: 0, mo: Math.round(controle.mo * 10) / 10 }, { at: 0, type: "controle", parties: 6, nettoyees: 0, copies: 7, mo: 2.1, gardees: GARDEES });
    // Rien n'est effacé ni écrit d'autre ; la Régie PC n'a lu que des listes de clés et de petites valeurs.
    await intactes(["FETE1", "FETE2", "FETE3", "FETE4", "FETE5", CODE]);
    assert.equal(await brut("maintenance/nettoyages"), null);
    assert.ok(vu.rest.length >= 9 && vu.rest.every((u) => new URL(u).searchParams.get("shallow") === "true"), `listes de clés seulement : ${vu.rest.join(" ")}`);
    const lus = () => vu.sdk.map((p) => p.replace(/^\//, "")).filter((p) => p.startsWith("games"));
    assert.ok(lus().length > 0 && lus().every((p) => /^games\/[A-Z0-9]+\/(state\/phase|state\/endedAt|createdAt|public\/title|public\/childName)$/.test(p)), `petites valeurs seulement : ${lus().join(" ")}`);

    // Paramètres : l'explication, ce que le contrôle a compté et pourquoi des copies restent.
    await page.click("#nav button[data-screen=settings]");
    assert.match(await page.locator("#nettoyage-panel .hint").first().textContent(), /à la première ouverture de la Régie PC après les\s+24 h/);
    await page.locator("#nettoyage-auto", { hasText: "Premier passage de contrôle : 7 copies à effacer, rien effacé." }).waitFor();
    const ligne = page.locator('.nettoyage-passages li[data-type="controle"]');
    assert.match(await ligne.innerText(), /^\d\d\/\d\d\/\d{4} \d\d:\d\d · Contrôle : 7 copies à effacer \(environ 2,1 Mo\), rien effacé \(6 parties vérifiées\)\n/);
    assert.equal(await ligne.locator("small").innerText(), TEXTE_GARDEES);

    await page.click("#nettoyage-verifier");
    await page.locator("#nettoyage-status", { hasText: "Vérification terminée : rien n'a été effacé." }).waitFor({ timeout: 20000 });
    const chiffres = await page.locator(".nettoyage-chiffre").evaluateAll((l) => l.map((x) => [x.dataset.chiffre, x.querySelector("b").textContent, x.querySelector("span").textContent]));
    assert.deepEqual(chiffres, [["parties", "6", "parties en ligne"], ["a-nettoyer", "2", "à nettoyer"], ["mo", "≈ 2,1 Mo", "à libérer (environ)"]]);
    assert.deepEqual(await page.locator(".nettoyage-raisons li").allInnerTexts(), [
      "1 gardée : Partie en cours ou interrompue : elle peut encore être reprise",
      "1 gardée : Terminée depuis moins de 24 h",
      "2 gardées : Aucune copie à effacer",
    ]);
    await page.locator("[data-extraits-gardes='1']", { hasText: "1 extrait gardé : la chanson n'est plus dans la bibliothèque" }).waitFor();
    // Une ligne par partie qui a des copies : à nettoyer d'abord, puis les plus récentes.
    const lignes = await page.locator(".nettoyage-table tbody tr").evaluateAll((l) => l.map((tr) => [tr.dataset.code, ...[...tr.cells].map((td) => td.innerText.replace(/\s*\n\s*/g, " | "))]));
    assert.deepEqual(lignes.map((l) => l[0]), ["FETE1", "FETE4", "FETE2", "FETE3"]);
    const [fete1, fete4, fete2, fete3] = lignes;
    const date = /^\d\d\/\d\d\/\d{4} \d\d:\d\d$/;
    assert.match(fete1[1], date);
    assert.match(fete1[4], /^Terminée le \d\d\/\d\d\/\d{4} à \d\d:\d\d$/);
    assert.deepEqual([...fete1.slice(2, 4), ...fete1.slice(5)], ["FETE1", "L'anniversaire de Léa · Léa", "2 sons · 3 images", "1,4 Mo",
      "À nettoyer | Terminée depuis plus de 24 h | 1 photo de la banque du site ou émoji dessiné : refaits au prochain lancement"]);
    assert.match(fete4[1], date);
    assert.deepEqual(fete4.slice(2), ["FETE4", "—", "Terminée (heure de fin inconnue)", "2 sons · 1 image", "1,3 Mo",
      "À nettoyer | Terminée sans heure de fin, créée il y a plus de 48 h | 1 extrait gardé : la chanson n'est plus dans la bibliothèque | 1 photo de la banque du site ou émoji dessiné : refaits au prochain lancement"]);
    assert.match(fete2[4], /^Terminée le /);
    assert.deepEqual(fete2.slice(5), ["1 son · 1 image", "0,7 Mo", "Gardée | Terminée depuis moins de 24 h"]);
    // Prestation archivée, date passée : la partie n'a jamais été terminée sur la TV, elle reste reprenable.
    assert.deepEqual(fete3.slice(4), ["En cours ou interrompue (reprise possible)", "1 son · 1 image", "0,6 Mo", "Gardée | Partie en cours ou interrompue : elle peut encore être reprise"]);
    await capture(page, "nettoyage-verifier-pc");
    await intactes(["FETE1", "FETE2", "FETE3", "FETE4", "FETE5", CODE]);
    assert.equal((await passages()).length, 1, "« Vérifier maintenant » n'écrit rien");
    assert.ok(lus().every((p) => /^games\/[A-Z0-9]+\/(state\/phase|state\/endedAt|createdAt|public\/title|public\/childName)$/.test(p)));

    // Sur un téléphone : des fiches au lieu du tableau, rien ne dépasse de l'écran.
    await page.setViewportSize({ width: 360, height: 740 });
    assert.equal(await page.locator(".nettoyage-table thead").isVisible(), false);
    const deborde = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(deborde <= 0, `pas de défilement de côté (${deborde} px)`);
    await capture(page, "nettoyage-verifier-telephone");
    await page.context().close();
  });

  test("passages suivants : seules les copies vérifiées des fêtes finies depuis 24 h partent ; une panne ne bloque rien et le passage est refait à l'ouverture suivante", async () => {
    await seedFetes();
    await passageNote(2 * 3600_000, "controle");
    // Première ouverture : la base ne répond pas à la liste des parties.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const panne = /:9000\/games\.json/;
    await context.route(panne, (route) => route.abort("internetdisconnected"));
    const { page } = await ouvrir(context);
    await connecter(page);
    await page.click("#nav button[data-screen=settings]");
    await page.locator("#nettoyage-auto", { hasText: "Nettoyage automatique interrompu : il sera refait à la prochaine ouverture de la Régie PC." }).waitFor({ timeout: 20000 });
    // L'administration reste utilisable ; rien n'est effacé ni noté.
    await page.click("#nav button[data-screen=library]");
    await page.locator("#screen-library:not([hidden])").waitFor();
    await intactes(["FETE1", "FETE2", "FETE3", "FETE4", "FETE5", CODE]);
    assert.equal((await passages()).length, 1);
    assert.equal(await brut("maintenance/nettoyages"), null);
    await page.close();

    // Ouverture suivante : le passage est refait, et efface cette fois.
    await context.unroute(panne);
    const second = await ouvrir(context);
    await second.page.locator("#screen-home:not([hidden])").waitFor();
    await waitFor(async () => (await passages()).length === 2, "passage de nettoyage noté", 20000);
    await nettoyees();
    const nettoyages = Object.values(await brut("maintenance/nettoyages")).sort((a, b) => a.code.localeCompare(b.code));
    assert.deepEqual(nettoyages.map(({ at, mo, ...n }) => n), [
      { code: "FETE1", sounds: 2, images: 2, choiceImages: 1 },
      { code: "FETE4", sounds: 1, images: 1, choiceImages: 0, gardes: 1 },
    ]);
    assert.ok(Math.abs(nettoyages[0].mo - 1.405) < 0.011 && Math.abs(nettoyages[1].mo - 0.68) < 0.011);
    const [, passage] = await passages();
    assert.deepEqual({ ...passage, at: 0, mo: Math.round(passage.mo * 10) / 10 }, { at: 0, type: "nettoyage", parties: 6, nettoyees: 2, copies: 7, mo: 2.1, gardees: GARDEES });
    // Paramètres : les derniers passages et les parties nettoyées.
    await second.page.click("#nav button[data-screen=settings]");
    await second.page.locator("#nettoyage-auto", { hasText: "Nettoyage automatique fait : 2 parties nettoyées, 7 copies effacées, environ 2,1 Mo libérés." }).waitFor();
    const ligne = second.page.locator('.nettoyage-passages li[data-type="nettoyage"]');
    assert.match(await ligne.innerText(), /^\d\d\/\d\d\/\d{4} \d\d:\d\d · 2 parties nettoyées, 7 copies effacées, environ 2,1 Mo libérés \(6 parties vérifiées\)\n/);
    assert.equal(await ligne.locator("small").innerText(), TEXTE_GARDEES);
    assert.deepEqual((await second.page.locator(".nettoyage-faits li").allInnerTexts()).map((t) => t.replace(/^\d\d\/\d\d\/\d{4} \d\d:\d\d · /, "")).sort(), [
      "FETE1 : 2 sons, 3 images effacés · environ 1,4 Mo",
      "FETE4 : 1 son, 1 image effacés · environ 0,7 Mo · 1 extrait gardé (chanson plus dans la bibliothèque)",
    ]);
    // « Vérifier maintenant » : plus rien à nettoyer, l'extrait sans chanson reste.
    await second.page.click("#nettoyage-verifier");
    await second.page.locator("#nettoyage-status", { hasText: "Vérification terminée : rien n'a été effacé." }).waitFor({ timeout: 20000 });
    await second.page.locator('.nettoyage-chiffre[data-chiffre="a-nettoyer"] b', { hasText: "0" }).waitFor();
    await second.page.locator(".nettoyage-raisons li", { hasText: "1 gardée : 1 extrait gardé : la chanson n'est plus dans la bibliothèque" }).waitFor();
    await capture(second.page, "nettoyage-journal");
    await context.close();
  });

  test("une fois par heure au plus : une ouverture moins d'une heure après le dernier passage ne lit même pas les parties", async () => {
    await seedFetes();
    const cle = await passageNote(30 * 60_000);
    const { page, vu } = await ouvrir();
    await connecter(page);
    await page.click("#nav button[data-screen=settings]");
    await page.locator("#nettoyage-auto", { hasText: "Nettoyage automatique : déjà fait il y a moins d'une heure." }).waitFor();
    assert.deepEqual(vu.rest, []);
    await intactes(["FETE1", "FETE2", "FETE3", "FETE4", "FETE5", CODE]);
    // Une heure plus tard : la prochaine ouverture nettoie.
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `maintenance/passages/${cle}/at`), Date.now() - 61 * 60_000));
    const second = await ouvrir(page.context());
    await second.page.locator("#screen-home:not([hidden])").waitFor();
    await waitFor(async () => (await passages()).length === 2, "passage d'une heure plus tard noté", 20000);
    await nettoyees();
    assert.ok(second.vu.rest.length >= 9);
    await page.context().close();
  });
});
