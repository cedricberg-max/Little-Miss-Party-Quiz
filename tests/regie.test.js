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
  // Comme la box : les tablettes n'entrent qu'une fois une régie ouverte (cedric, 24/10).
  if (!silent) stops.push(onValue(ref(db, `games/${CODE}/regie`), (s) => {
    set(ref(db, `games/${CODE}/regieActive`), s.exists()).catch(() => {});
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
            // Jeu quitté en cours de route : bilan des scores d'abord, puis « suivant » y va (GameLeft, cedric 24/10).
            const enCours = ["question", "closed", "reveal"].includes(state.phase);
            if (enCours && plan.questions[state.index]?.round !== q.round) state = { ...state, seq, phase: "scores", leaveTo: cmd.index, deadline: null, paused: false, mime: null, buzz: null };
            else state = sauter(plan, cmd.index, seq);
          }
        }
        else if (cmd.type === "next" && state.phase === "scores" && state.leaveTo != null) state = sauter((await read("conducteur")) ?? { questions: [] }, state.leaveTo, seq);
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
        // « 🏁 Fin de la fête » : comme la box, seulement une fois la partie terminée ; la partie quittée est marquée.
        else if (cmd.type === "newgame" && state.phase !== "ended") status = { status: "refused", reason: "not_ended" };
        else if (cmd.type === "newgame") state = { ...state, leftAt: Date.now() };
        else state = { ...state, seq };
        if (status.status === "applied") status.seq = seq;
      }
      await update(ref(db, `games/${CODE}`), { state, [`commandStatus/${id}`]: { ...status, at: Date.now() } });
    }
  }
  /** Début du jeu qui commence à la question [index] du programme (Jumped). */
  function sauter(plan, index, seq) {
    const q = plan.questions[index];
    return q.kind === "mime"
      ? { ...state, seq, phase: "question", index, qid: q.id, kind: "mime", text: q.text, choices: null, deadline: null, paused: false, leaveTo: null, mime: { team: null, card: null, found: 0, passed: 0, left: q.cards.length, turns: [], counts: {}, points: 50 } }
      : { ...questionState(seq), index, qid: q.id, text: q.text, choices: q.choices, total: plan.questions.length, scores: state.scores, mime: null, leaveTo: null };
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
    const endTurn = (x) => ({ ...x, deadline: null, mime: { ...x.mime, team: null, card: null, found: 0, passed: 0, relais: null, last: { team: m.team, found: x.mime.found, passed: x.mime.passed } } });
    switch (cmd.type) {
      case "mime_start":
        if (m.team) return null;
        // Paquet épuisé par les équipes précédentes : rebattu pour que chaque équipe ait son tour.
        if (!deck.length) deck = [...allCards];
        return { ...st, seq, deadline: Date.now() + 60000, mime: { ...m, team: cmd.team, card: deck[0], found: 0, passed: 0, relais: null, turns: [...(m.turns ?? []), cmd.team] } };
      case "mime_found": {
        // Roulement (comme Game.kt) : l'image suivante attend le changement de joueur.
        if (!m.team || m.relais) return null;
        const scores = add(m.team, 1);
        deck = deck.slice(1);
        const next = { ...st, seq, scores, mime: { ...m, counts, card: null, relais: Date.now(), left: deck.length, found: m.found + 1 } };
        return deck.length ? next : endTurn(next);
      }
      case "mime_pass":
        if (m.team && m.relais) return { ...st, seq, mime: { ...m, relais: null, card: deck[0] } };
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
  // Tablette acceptée par la régie : mêmes vérifications que GameViewModel.admitDevice (nom et couleur de la régie).
  async function admitDevice(id, cmd) {
    const request = (await get(ref(db, `games/${CODE}/joinRequests/${cmd.device}`))).val();
    const teams = (await get(ref(db, `games/${CODE}/teams`))).val() ?? {};
    const entries = Object.entries(teams);
    const name = (cmd.name ?? request?.name)?.trim();
    const reason = !request ? "gone"
      : entries.some(([t, v]) => t === cmd.device || v.device === cmd.device) ? "busy"
        : cmd.type === "admit" && entries.length >= 8 ? "full"
          : cmd.type === "replace" && !teams[cmd.team] ? "unknown_team"
            : cmd.type === "admit" && !name ? "no_name" : null;
    const updates = { [`commandStatus/${id}`]: { status: reason ? "refused" : "applied", ...(reason ? { reason } : {}), at: Date.now() } };
    if (!reason) {
      updates[`joinRequests/${cmd.device}`] = null;
      if (cmd.type === "replace") updates[`teams/${cmd.team}/device`] = cmd.device;
      else {
        // Jamais deux équipes de la même couleur (Couleurs.freeColor) : la couleur demandée si elle est libre.
        const prises = entries.map(([, v]) => v.color?.toUpperCase());
        const voulue = cmd.color ?? request.color;
        const color = voulue && !prises.includes(voulue.toUpperCase()) ? voulue
          : ["#FF2D95", "#FF6B1A", "#39FF14", "#FFE600", "#2B86C5", "#9B5DE5", "#F94144", "#2EE8E0"].find((c) => !prises.includes(c));
        updates[`teams/${cmd.device}`] = { name, color, joinedAt: Date.now() };
        updates[`colors/${color.slice(1).toUpperCase()}`] = cmd.device;
      }
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

async function addTeam(uid, name, color = "#FF2D8A", joinedAt = Date.now()) {
  await env.withSecurityRulesDisabled((ctx) =>
    set(ref(ctx.database(), `games/${CODE}/teams/${uid}`), { name, color, joinedAt }));
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
/** Une prestation s'ouvre jeux repliés (cedric, 24/10) : les déplie tous, pour travailler dedans. */
async function deplierJeux(page) {
  await page.locator("#screen-show-edit").waitFor();
  const replie = page.locator("#show-rounds .jeu-bloc.replie .jeu-replier");
  while (await replie.count()) await replie.first().click();
}

async function ajouterJeu(page, type = "quiz") {
  await page.click("#round-add");
  await page.click(`#jeu-choix .jeu-tuile[data-jeu="${type}"]`);
}

/**
 * « 📗 Intégrer un quiz de votre bibliothèque » (cedric, 23/10) : dans la manche Quiz [round], cherche [texte] et ajoute
 * le quiz [id] (une série de plus).
 */
async function integrerQuiz(round, id, texte) {
  const series = round.locator(".quiz-series > li.serie");
  const avant = await series.count();
  await round.locator(".quiz-biblio-cherche").fill(texte);
  await round.locator(`.quiz-biblio-item[data-quiz="${id}"]`).click();
  await series.nth(avant).waitFor();
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
  // Avant la régie, le grand bouton de l'écran d'attente ; ensuite, le petit « Accès régie ».
  await page.locator("#screen-gate.active #gate-regie, #regie-open:not([hidden])").first().click();
  await page.fill("#regie-password", password);
  await page.click("#regie-go");
}

const inRegie = (page) => page.locator("#regie:not([hidden])").waitFor({ timeout: 10000 });

/**
 * Sur la régie : donne un nom (et une couleur, par son nom) à la première tablette en attente et l'accepte
 * (cedric, 24/10 : la tablette ne tape ni ne choisit rien).
 */
async function accepter(regie, name, couleur = null) {
  const carte = regie.locator("#c-requests .request:has(.req-name)").first();
  await carte.waitFor();
  await carte.locator(".req-name").fill(name);
  if (couleur) await carte.locator(".req-colors button", { hasText: couleur }).click();
  await carte.locator("button.new", { hasText: "Accepter" }).click();
}

const commands = async () => Object.values((await read("commands")) ?? {});

async function setPresence(uid, online) {
  await env.withSecurityRulesDisabled((ctx) =>
    set(ref(ctx.database(), `games/${CODE}/presence/${uid}`), { online, at: Date.now() }));
}

describe("régie", () => {
  test("mot de passe commun : un mauvais est refusé, le bon ouvre la régie", async () => {
    box = startBox();
    const page = await openRegie();
    await page.locator("#screen-gate.active").waitFor();
    await pair(page, "licorne");
    await page.locator("#regie-status", { hasText: "Mot de passe de régie incorrect" }).waitFor();
    assert.equal(await read("regie"), null);
    await page.fill("#regie-password", PASSWORD);
    await page.click("#regie-go");
    await inRegie(page);
    assert.equal(Object.values(await read("regie"))[0].via, "password");
    // Le pupitre ne s'est pas inscrit comme équipe, ni n'a demandé à entrer.
    assert.equal(await read("teams"), null);
    assert.equal(await read("joinRequests"), null);
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
    await page.locator("#gate-regie").click();
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
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    const page = await openRegie();
    // Tablette en attente : l'animatrice peut encore s'en servir comme régie.
    await page.locator("#screen-waiting.active").waitFor();
    await page.locator("#regie-open:not([hidden])").waitFor();
    await accepter(regie, "Les Roses");
    await page.locator("#screen-play.active").waitFor();
    assert.equal(await page.locator("#regie-open").isHidden(), true);
    for (const p of [regie, page]) await p.context().close();
  });

  test("entrée des équipes (cedric, 24/10) : sans régie, la tablette ne va pas plus loin que le code régie ; ensuite l'animatrice la nomme et choisit sa couleur", async () => {
    box = startBox();
    // Tablette scannée avant la régie : rien à taper ni à choisir, seulement l'accès régie.
    const tab = await openRegie();
    await tab.locator("#screen-gate.active #gate-regie").waitFor();
    assert.equal(await tab.locator("input:visible").count(), 0, "aucun champ à remplir");
    assert.equal(await tab.locator("#screen-gate.active button").count(), 1, "un seul bouton : le code de la régie");
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await read("joinRequests"), null, "pas de demande avant la régie");
    await capture(tab, "pupitre-avant-la-regie");
    // L'animatrice ouvre sa régie : la tablette demande d'elle-même à entrer, avec un numéro.
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await tab.locator("#screen-waiting.active").waitFor();
    const numero = await tab.locator("#waiting-num").textContent();
    assert.match(numero, /^Tablette \d{3}$/);
    const device = await tab.locator("#screen-waiting").getAttribute("data-device");
    const demande = await waitFor(() => read(`joinRequests/${device}`), "demande de la tablette");
    assert.equal(demande.name, undefined, "la tablette n'envoie aucun nom");
    assert.equal(demande.color, undefined, "ni couleur");
    assert.equal(await read("teams"), null, "aucune équipe créée sans l'animatrice");
    // Sur la régie : « Nouvelle équipe en attente », le même numéro, les 4 couleurs des bracelets.
    const carte = regie.locator("#c-requests .request:has(.req-name)");
    await carte.locator("p", { hasText: "Nouvelle équipe en attente" }).waitFor();
    await carte.locator(".tablet-tag", { hasText: numero }).waitFor();
    assert.deepEqual(await carte.locator(".req-colors button").allTextContents(), ["Rose", "Orange", "Vert", "Jaune"]);
    await capture(regie, "regie-nouvelle-equipe");
    // Sans nom : refusé, le champ attend.
    await carte.locator("button.new").click();
    await regie.locator("#r-toast", { hasText: "Tapez d'abord le nom de l'équipe" }).waitFor();
    assert.equal(await read("teams"), null);
    await accepter(regie, "Les Licornes", "Vert");
    await regie.locator("#r-toast", { hasText: "« Les Licornes » entre dans la partie" }).waitFor();
    await tab.locator("#screen-play.active").waitFor();
    assert.equal(await tab.locator("#screen-play .team-label").textContent(), "Les Licornes");
    assert.deepEqual(await read(`teams/${device}`).then(({ name, color }) => ({ name, color })), { name: "Les Licornes", color: "#39FF14" });
    // Deuxième tablette : le vert est pris, la première couleur libre est présélectionnée.
    const tab2 = await openRegie();
    await tab2.locator("#screen-waiting.active").waitFor();
    const carte2 = regie.locator("#c-requests .request:has(.req-name)");
    await carte2.locator(".req-colors button.taken", { hasText: "Vert" }).waitFor();
    assert.equal(await carte2.locator(".req-colors button.selected").textContent(), "Rose");
    assert.equal(await carte2.locator(".req-colors button", { hasText: "Vert" }).isDisabled(), true);
    // Le nom tapé reste quand la liste se redessine (une équipe se reconnecte pendant la frappe).
    await carte2.locator(".req-name").fill("Les Dra");
    await setPresence(device, false);
    await setPresence(device, true);
    await carte2.locator(".req-name").press("End");
    await carte2.locator(".req-name").type("gons");
    assert.equal(await carte2.locator(".req-name").inputValue(), "Les Dragons");
    await carte2.locator(".req-name").press("Enter");
    await tab2.locator("#screen-play .team-label", { hasText: "Les Dragons" }).waitFor();
    assert.equal(Object.values(await read("teams")).find((t) => t.name === "Les Dragons").color, "#FF2D95");
    assert.equal(await read("joinRequests"), null);
    for (const p of [regie, tab, tab2]) await p.context().close();
  });

  test("couleurs de la prestation (Régie PC) : la régie ne propose qu'elles, une de plus si une équipe imprévue arrive", async () => {
    box = startBox();
    // Comme la TV au lancement d'une prestation de 2 équipes en bleu et violet.
    await set(gameRef("public"), { title: "L'anniversaire de Léa", childName: "Léa", teamColors: ["#2B86C5", "#9B5DE5"] });
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    const tab = await openRegie();
    await tab.locator("#screen-waiting.active").waitFor();
    const carte = regie.locator("#c-requests .request:has(.req-name)");
    await waitFor(async () => JSON.stringify(await carte.locator(".req-colors button").allTextContents()) === JSON.stringify(["Bleu", "Violet"]), "les 2 couleurs de la prestation");
    await addTeam("a", "A", "#2B86C5");
    await addTeam("b", "B", "#9B5DE5");
    await waitFor(async () => (await carte.locator(".req-colors button").allTextContents()).length === 3, "une couleur de plus quand toutes sont prises");
    assert.equal(await carte.locator(".req-colors button.selected").textContent(), "Rose");
    for (const p of [regie, tab]) await p.context().close();
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
    assert.equal(await page.textContent("#mime-pass"), "Image suivante");
    await page.click("#mime-found");
    // Roulement (cedric, 24/10) : changement de joueur, l'image suivante attend ; « Trouvé » grisé à sa place.
    await page.locator("#mime.relais").waitFor();
    await page.locator("#mime-info", { hasText: "🔄 Changement de joueur : dès que le nouveau devineur est dos à l'écran, touchez « Image suivante »." }).waitFor();
    assert.equal(await page.locator("#mime-now").isHidden(), true, "Pas d'image avant le relais");
    assert.equal(await page.locator("#mime-found").isDisabled(), true);
    assert.equal(await page.locator("#mime-found").isVisible(), true, "« Trouvé » reste à sa place");
    assert.equal(await page.textContent("#mime-pass"), "▶ Image suivante");
    assert.match(await page.getAttribute("#mime-pass", "class"), /\bmain\b/);
    await capture(page, "regie-mimes-changement-de-joueur");
    await page.click("#mime-pass");
    await page.locator("#mime-now .word", { hasText: "Pirate" }).waitFor();
    assert.equal(await page.locator("#mime.relais").count(), 0);
    assert.equal(await page.textContent("#mime-pass"), "Image suivante");
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
    assert.deepEqual((await commands()).map((c) => c.type), ["mime_start", "mime_found", "mime_pass", "mime_pass", "mime_found", "mime_fix", "close", "mime_fix"]);
    assert.deepEqual((await commands()).find((c) => c.type === "mime_start").team, "bleu");
    // Terminer avant que toutes les équipes soient passées : confirmation, et rien n'est envoyé si on renonce.
    await page.click("#c-next");
    const asked = await respond(page, false);
    await page.waitForTimeout(300);
    assert.match(asked, /Les Roses n'est pas encore passée/);
    assert.equal((await commands()).length, 8);
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

  test("Mimes, une manche par équipe (cedric, 23/10) : la régie choisit d'office l'équipe de la couleur, annonce la suivante, et passe une couleur absente", async () => {
    const { TEAM_COLORS } = await import("../web/public/theme.js");
    box = startBox();
    // Licornes (orange) inscrite avant Dragons (rose) : c'est pourtant Dragons qui ouvre, sa couleur passe en premier.
    await addTeam("licornes", "Licornes", TEAM_COLORS[1], 1000);
    await addTeam("dragons", "Dragons", TEAM_COLORS[0], 2000);
    const cartes = [{ word: "Chat", image: "🐱" }, { word: "Lion", image: "🦁" }];
    const plan = ["Rose", "Orange", "Vert"].map((c, k) => ({ id: `r1m${k + 1}`, text: `Équipe ${c}`, kind: "mime", duration: 60, round: "Mimes", cards: cartes }));
    await set(gameRef("conducteur"), { id: "zoe", title: "Zoé", rev: "r1", mimes: true, questions: plan });
    await box.mimes(cartes);
    const mime = (index) => ({ phase: "question", seq: box.state.seq + 1, index, qid: plan[index].id, kind: "mime", text: plan[index].text, total: 3, choices: null, deadline: null,
      mime: { team: null, card: null, found: 0, passed: 0, left: 2, turns: [], counts: {}, points: 50 } });
    await box.set(mime(0));
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await page.locator('.mime-team.selected[data-team="dragons"]').waitFor();
    await page.locator("#mime-info", { hasText: "Au tour de l'équipe Rose : Dragons." }).waitFor();
    await page.locator("#mime-progress", { hasText: "Manche de l'équipe Rose : ses 2 images" }).waitFor();
    assert.equal(await page.textContent("#c-step"), "Mimes · Équipe Rose");
    // Un seul jeu « Mimes » dans le conducteur, pas trois.
    assert.match(await page.textContent("#c-games"), /En cours : Mimes(?! :)/);
    await page.locator("#mime-go", { hasText: "Top départ ! (Dragons)" }).click();
    await page.locator("#mime-now .word", { hasText: "Chat" }).waitFor();
    await page.click("#mime-found");
    await page.locator("#c-next", { hasText: "Arrêter le tour" }).click();
    await page.locator("#mime-info", { hasText: "Tour terminé : Dragons a trouvé 1 mime. Touchez « Voir le classement »" }).waitFor();
    // L'équipe de la manche est passée : le classement, sans confirmation.
    await page.locator("#c-next", { hasText: "Voir le classement" }).click();
    await page.locator("#c-phase", { hasText: "Scores" }).waitFor();
    assert.equal((await commands()).find((c) => c.type === "mime_start").team, "dragons");
    // Entre deux équipes : le bouton annonce la suivante.
    await page.locator("#c-next", { hasText: "Au tour de l'équipe Orange ▶" }).waitFor();

    // La manche de l'équipe Orange : Licornes, choisie d'office ; la terminer avant son tour demande confirmation.
    await box.set(mime(1));
    await page.locator('.mime-team.selected[data-team="licornes"]').waitFor();
    await page.locator("#mime-info", { hasText: "Au tour de l'équipe Orange : Licornes." }).waitFor();
    await page.locator("#c-next", { hasText: "Terminer les mimes" }).click();
    assert.match(await respond(page, false), /Licornes n'est pas encore passée/);

    // Aucune équipe verte dans la partie : Sarah peut faire mimer une autre équipe, ou passer.
    await box.set(mime(2));
    await page.locator("#mime-info", { hasText: "Aucune équipe Vert dans la partie" }).waitFor();
    await page.locator("#c-next", { hasText: "Voir le classement" }).waitFor();
    assert.equal(await page.locator(".mime-team").count(), 2);
    await page.context().close();
  });

  for (const [width, height] of [[360, 640], [390, 780]]) {
    test(`petit téléphone ${width}×${height} : pendant un buzz en pause automatique, Reprendre, le bouton principal et le verdict restent à l'écran`, async () => {
      box = startBox();
      await addTeam("rose", "Les Roses", "#FFE600");
      await addTeam("bleu", "Les Bleus");
      // Tablette des Bleus coupée (cedric, 24/10, photo) : le bandeau rouge en haut mange de la place.
      await setPresence("rose", true);
      await setPresence("bleu", false);
      const plan = [{ id: "c1", text: "Amour", kind: "chante", duration: 40, round: "Chante le mot !", choices: ["roi"], correct: 0 }];
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
      // Au buzz (cedric, 24/10) : la bande à la couleur de l'équipe avec le mot, « Bonne réponse » et « Mauvaise
      // réponse » sont entièrement dans l'écran sans rien faire défiler, même sous le bandeau des tablettes coupées,
      // et y restent quand Sarah fait défiler la régie.
      await page.locator("#r-alerte", { hasText: "Les Bleus" }).waitFor({ timeout: 8000 });
      await page.locator("#flou-info", { hasText: "Les Roses a buzzé ! Réponse attendue : une chanson avec le mot « roi »" }).waitFor();
      assert.equal(await page.locator("#flou-info .buzz-nom-couleur").textContent(), "JAUNE");
      const dansLEcran = (id) => page.evaluate((id) => {
        const el = document.getElementById(id);
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.height > 0 && (hit === el || el.contains(hit));
      }, id);
      for (const position of ["haut", "bas"]) {
        await page.evaluate((p) => { const c = document.querySelector(".regie .control"); c.scrollTop = p === "haut" ? 0 : c.scrollHeight; }, position);
        for (const id of ["flou-info", "flou-ok", "flou-ko", "c-pause", "c-next"]) {
          assert.ok(await dansLEcran(id), `#${id} dans l'écran (régie défilée en ${position}) en ${width}×${height}`);
        }
      }
      // Fine bande : bien moins haute que l'ancien gros carré jaune.
      assert.ok((await page.locator("#flou-info").boundingBox()).height <= 80, "bande de l'équipe fine (le gros carré jaune faisait 150 px)");
      await capture(page, `verdict-buzz-${width}x${height}`);
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
    // Le message prend la couleur de l'équipe (ses bracelets) : Sarah la reconnaît d'un coup d'œil (cedric, 22/10).
    const fond = () => page.locator("#flou-info").evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(await page.locator("#flou-info.buzz-couleur").count(), 1);
    assert.equal(await fond(), "rgb(255, 45, 138)");
    assert.equal(await page.locator("#flou-info .buzz-nom-couleur").count(), 0, "couleur hors palette : pas de nom de couleur");
    await page.locator("#flou-ok small", { hasText: "+150 pour Les Roses" }).waitFor();
    await page.click("#flou-ko");
    await page.locator("#flou-info", { hasText: "Déjà essayé : Les Roses" }).waitFor();
    assert.equal(await page.locator("#flou-info.buzz-couleur").count(), 0, "plus de couleur d'équipe sans buzz en attente");
    assert.deepEqual((await read("state")).buzz.blocked, ["rose"]);
    // Rebond des Bleus (bracelets orange), validé : 100 points et révélation.
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/teams/bleu/color`), "#FF6B1A"));
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/buzz/f1-1000-1`), { team: "bleu", at: Date.now() }));
    await page.locator("#flou-ok small", { hasText: "+100 pour Les Bleus" }).waitFor();
    assert.equal(await fond(), "rgb(255, 107, 26)");
    // Couleur des bracelets : son nom en gros, avant le message.
    await page.locator("#flou-info .buzz-nom-couleur", { hasText: "ORANGE" }).waitFor();
    await page.locator("#flou-info", { hasText: "Les Bleus a buzzé ! Réponse attendue : Un lion" }).waitFor();
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
    assert.equal(await page.locator("#blind-info").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(255, 45, 138)", "message dans la couleur de l'équipe");
    await page.locator("#blind-ok small", { hasText: "+100 pour Les Roses" }).waitFor();
    assert.equal(await page.locator("#c-next").isDisabled(), true);
    await page.click("#blind-ko");
    await waitFor(async () => (await commands()).includes("buzz_ko"), "mauvaise réponse envoyée");

    // Musique arrêtée après l'erreur : relancer (l'équipe ratée rebuzzera 3 s après, ou tout de suite), révéler ou passer.
    await box.set({ ...(await read("state")), buzz: { team: null, blocked: ["rose"] }, blind: blindState({ played: true }) });
    await page.locator("#blind-info", { hasText: "Pas trouvé (Les Roses). Relancez la musique : les autres buzzent tout de suite, Les Roses 3 s après." }).waitFor();
    assert.equal(await page.locator("#blind-info.buzz-couleur").count(), 0);
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
    // Passer au jeu suivant : bilan des scores sur la TV d'abord (cedric, 24/10), puis « Jeu suivant » ouvre les
    // mimes ; les points restent.
    await page.locator("#rescue-next", { hasText: "Passer au jeu suivant : Mimes : Animaux" }).click();
    let asked = await respond(page);
    await page.locator("#r-toast", { hasText: "Bilan des scores sur la TV, puis « Mimes : Animaux »." }).waitFor();
    assert.match(asked, /points déjà gagnés sont gardés/);
    assert.match(asked, /La TV montre le bilan des scores, puis « Mimes : Animaux »/);
    assert.deepEqual(box.gotos, [{ index: 2, qid: "a1m" }]);
    await page.locator("#c-next:not([hidden])", { hasText: "Jeu suivant : Mimes : Animaux ▶" }).waitFor();
    await page.locator("#c-games", { hasText: "Ensuite : Mimes : Animaux" }).waitFor();
    await page.click("#c-next");
    await page.locator("#mime:not([hidden])").waitFor();
    assert.equal((await read("state")).scores.rose, 100);
    await page.locator("#c-games", { hasText: "En cours : Mimes : Animaux · Ensuite : Finale" }).waitFor();
    // Recommencer le quiz (« Rejouer » avant le 21/10) : confirmation qui dit que ses points sont retirés puis rejoués.
    await page.click("#c-rescue");
    await page.locator("#rescue-list .rescue-game", { hasText: "Quiz de Léa" }).locator("button", { hasText: "Recommencer" }).click();
    asked = await respond(page);
    // Depuis les mimes en cours : le bilan des scores d'abord, là aussi.
    await page.locator("#r-toast", { hasText: "Bilan des scores sur la TV, puis « Quiz de Léa »." }).waitFor();
    assert.match(asked, /rien n'est compté deux fois/);
    assert.match(asked, /La TV montre d'abord le bilan des scores/);
    assert.deepEqual(box.gotos[1], { index: 0, qid: "q1" });
    await page.locator("#c-next:not([hidden])", { hasText: "Jeu suivant : Quiz de Léa ▶" }).waitFor();
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
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    const team = await openRegie();
    await accepter(regie, "Les Roses");
    await team.locator("#screen-play.active").waitFor();
    const rose = Object.keys(await read("teams"))[0];
    await box.mimes([{ word: "Chat" }, { word: "Robot" }]);
    await team.locator("#play-status", { hasText: "L'animatrice choisit l'équipe qui joue" }).waitFor();
    assert.equal(await team.locator("#buzz").isHidden(), true);
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

  test("Vrai ou Faux express : sa Super Finale s'annonce en affirmations sur le téléphone", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    const plan = (await read("conducteur")) ?? { questions: [] };
    const vf = (id) => ({ id, text: `Affirmation ${id}`, kind: "express", choices: ["Vrai", "Faux"], correct: 0, double: true, finale: true, round: "Vrai ou Faux express" });
    await set(gameRef("conducteur"), { ...plan, questions: [...plan.questions, vf("vf1"), vf("vf2")] });
    await box.set({ ...questionState(1), phase: "reveal", factorChoice: { start: plan.questions.length, factor: 2 } });
    await page.locator("#c-factor:not([hidden])", { hasText: "Les 2 dernières affirmations du Vrai ou Faux arrivent : combien de points ?" }).waitFor();
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

  test("Fin de la fête (cedric, 23/10) : sur l'écran de fin, un gros bouton « 🏁 Fin de la fête » ; confirmé, la TV quitte la fête et revient à l'accueil", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    const fin = page.locator("#c-fin");
    // Pendant la partie : pas de bouton.
    assert.equal(await fin.isHidden(), true);
    // Partie finie après le dernier jeu du programme : l'écran « Merci d'avoir participé ».
    await box.set({ phase: "ended", index: QUESTIONS.length - 1, seq: (await read("state")).seq + 1 });
    await page.locator("#c-fin:not([hidden])").waitFor();
    assert.equal(await page.locator("#c-next").isHidden(), true);
    assert.match(await page.textContent("#c-question"), /Sinon : « 🏁 Fin de la fête »/);
    assert.ok((await fin.boundingBox()).height >= 90, "un gros bouton");
    // Annulé : rien n'est envoyé.
    await fin.click();
    assert.match(await respond(page, false), /Fin de la fête \? La TV quitte l'écran de fin et revient à l'accueil/);
    assert.equal((await commands()).length, 0);
    await fin.click();
    await respond(page);
    await page.locator("#r-toast", { hasText: "🏁 Fête terminée : la TV revient à l'accueil." }).waitFor();
    assert.deepEqual((await commands()).map((c) => c.type), ["newgame"]);
    await page.locator("#c-question", { hasText: "🏁 Fête terminée. La TV est revenue à l'accueil, prête pour la prochaine fête. Merci !" }).waitFor();
    assert.equal(await fin.isHidden(), true);
    assert.equal(await page.locator("#c-next").isHidden(), true);
    await capture(page, "fin-de-la-fete");
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
    await regie.locator("#r-toast", { hasText: "Bilan des scores sur la TV, puis « Animaux »." }).waitFor();
    await waitFor(async () => (await read(`images/${PHOTO}`)) === PNG && (await read(`sounds/${SON}`)) === MP3, "photo et extrait recopiés dans la partie");
    await regie.context().close();
  });
});

describe("remplacement d'un appareil en cours de partie", () => {
  /** Tablette d'équipe : scanne le QR code habituel et attend que l'animatrice la fasse entrer. */
  async function tablet() {
    const page = await openRegie();
    await page.locator("#screen-waiting.active").waitFor();
    return page;
  }
  async function startedGame() {
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    const old = await tablet();
    await accepter(regie, "Les Bleus");
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

    // Un téléphone de secours scanne le QR code : il demande à entrer, sans rien taper.
    const fresh = await tablet();
    assert.equal(Object.keys(await read("teams")).length, 2, "aucune équipe créée sans la régie");

    // La régie propose aussi de lui confier une équipe existante.
    await regie.locator("#c-requests .req-replace button", { hasText: "Remplace « Les Bleus »" }).click();
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
    const late = await tablet();
    await accepter(regie, "Les Tard-Venus");
    await late.locator("#screen-question.active").waitFor();
    assert.equal(await late.locator("#screen-question .team-label").textContent(), "Les Tard-Venus");
    await regie.locator("#c-answered", { hasText: "0 / 3 équipes ont répondu" }).waitFor();

    const intruder = await tablet();
    await regie.locator("#c-requests button", { hasText: "Ignorer" }).click();
    await intruder.locator("#error-text", { hasText: "n'a pas fait entrer cet appareil" }).waitFor();
    assert.equal(Object.keys(await read("teams")).length, 3);
    for (const p of [regie, old, late, intruder]) await p.context().close();
  });

  test("partie lancée pendant qu'une tablette attend : sa demande reste, l'animatrice la fait entrer", async () => {
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await addTeam("rose", "Les Roses");
    const slow = await openRegie();
    await slow.locator("#screen-waiting.active").waitFor();
    await regie.locator("#c-next", { hasText: "Lancer la fête !" }).click();
    await waitFor(async () => (await read("state"))?.phase === "question", "quiz lancé");
    await slow.locator("#screen-waiting.active").waitFor();
    await accepter(regie, "Les Lents");
    await slow.locator("#screen-question.active").waitFor();
    for (const p of [regie, slow]) await p.context().close();
  });

  test("8 équipes : la régie ne peut que remplacer un appareil", async () => {
    const { regie, old } = await startedGame();
    for (let i = 3; i <= 8; i++) await addTeam(`t${i}`, `Équipe ${i}`);
    const extra = await tablet();
    await accepter(regie, "Les Neuvièmes");
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
  const ESPACE = {
    title: "Espace", theme: "Sciences", source: "json", updatedAt: 1,
    questions: [{ text: "Quelle planète est la plus proche du Soleil ?", choices: ["Mercure", "Vénus", "Mars", "Terre"], correct: 0, status: "validee" }],
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

  test("Prestation (cedric, 24/10) : « ＋ Ajouter un jeu » saute aux yeux, en haut de la page aussi ; les jeux s'ouvrent sous le bouton touché", async () => {
    const page = await admin();
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.click("#home-new");
    await page.selectOption("#show-teams", "4");
    const haut = page.locator("#round-add-top");
    const bas = page.locator("#round-add");
    // En haut, à droite des couleurs des équipes : visible dès l'ouverture, sans descendre.
    await haut.waitFor();
    const boite = await haut.boundingBox();
    const couleurs = await page.locator("#show-couleurs").boundingBox();
    assert.ok(boite.y + boite.height <= 900, "bouton du haut hors de l'écran");
    assert.ok(boite.x >= couleurs.x + couleurs.width - 1, "bouton du haut pas à droite des couleurs");
    assert.ok(Math.abs(boite.y + boite.height / 2 - (couleurs.y + couleurs.height / 2)) < 60, "bouton du haut pas à la hauteur des couleurs");
    // Doré, en haut comme en bas, avec son « ＋ » dans une pastille blanche.
    for (const b of [haut, bas]) {
      assert.match(await b.evaluate((e) => getComputedStyle(e).backgroundImage), /linear-gradient/);
      assert.equal((await b.textContent()).trim(), "＋Ajouter un jeu");
    }
    await capture(page, "ajouter-un-jeu-haut", { pleinePage: false });
    // Du haut : les tuiles s'ouvrent juste dessous ; le jeu choisi arrive à la fin de la prestation.
    await haut.click();
    await page.locator("#jeu-choix-haut #jeu-choix:not([hidden])").waitFor();
    assert.equal(await page.locator("#jeu-choix .jeu-tuile").count(), 16);
    await capture(page, "ajouter-un-jeu-tuiles-haut", { pleinePage: false });
    await page.click('#jeu-choix .jeu-tuile[data-jeu="quiz"]');
    await page.locator("#jeu-choix").waitFor({ state: "hidden" });
    await page.locator('#show-rounds .jeu-bloc[data-jeu="quiz"]').waitFor();
    // Refermée, la place des tuiles ne laisse aucun trou en haut.
    assert.equal(await page.locator("#jeu-choix-haut").isVisible(), false);
    // Du bas : les tuiles s'ouvrent sous les jeux, un second appui les referme ; un appui en haut les y fait monter.
    await bas.click();
    await page.locator("#jeu-choix-bas #jeu-choix:not([hidden])").waitFor();
    await bas.click();
    await page.locator("#jeu-choix").waitFor({ state: "hidden" });
    await bas.click();
    await page.locator("#jeu-choix-bas #jeu-choix:not([hidden])").waitFor();
    await haut.click();
    await page.locator("#jeu-choix-haut #jeu-choix:not([hidden])").waitFor();
    await page.click('#jeu-choix .jeu-tuile[data-jeu="mimes"]');
    await page.locator('#show-rounds .jeu-bloc[data-jeu="mimes"]').waitFor();
    assert.deepEqual(await page.locator("#show-rounds .jeu-bloc").evaluateAll((l) => l.map((e) => e.dataset.jeu)), ["quiz", "mimes"]);
    await bas.scrollIntoViewIfNeeded();
    await capture(page, "ajouter-un-jeu-bas", { pleinePage: false });
    // Téléphone : le bouton du haut passe sous les couleurs, entier.
    await page.setViewportSize({ width: 390, height: 844 });
    await haut.scrollIntoViewIfNeeded();
    const tel = await haut.boundingBox();
    assert.ok(tel.x >= 0 && tel.x + tel.width <= 390, "bouton du haut coupé sur le téléphone");
    await capture(page, "ajouter-un-jeu-telephone", { pleinePage: false });
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
    await integrerQuiz(page.locator("#show-rounds .round").nth(0), "animaux", "anim");
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
    await integrerQuiz(page.locator("#show-rounds .round").nth(0), "animaux", "anim");
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
    await integrerQuiz(page.locator("#show-rounds .round").nth(0), "animaux", "anim");
    // La première question seulement : la seconde retirée de la série du quiz (cedric, 23/10).
    const serieAnimaux = page.locator('#show-rounds li.serie[data-origine="quiz"]');
    await serieAnimaux.locator("button.serie-voir").click();
    await serieAnimaux.locator(".serie-liste li", { hasText: "Combien de pattes" }).locator("button.tirage-retirer").click();
    await page.locator('#show-rounds li.serie[data-origine="quiz"] button.serie-voir', { hasText: "1 question (1 retirée)" }).waitFor();
    await ajouterJeu(page, "chante");
    await page.locator("#show-rounds .round").nth(1).locator("select.tirage-nombre").selectOption("4");
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

  test("Régie PC : Pictionary rangé en séries, un mot à soi dans sa série ; dans une prestation, le 🎲 prépare chaque équipe", async () => {
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
    // Dans une prestation (cedric, 24/10) : plus de séries à cocher, le 🎲 prépare les passages de chaque équipe (voir
    // « le Pictionary comme les autres jeux »).
    const round = page.locator('#show-rounds .jeu-bloc[data-jeu="pictionary"] .round');
    assert.equal(await page.locator("#show-rounds .picto-series").count(), 0);
    await round.locator(".picto-de").click();
    await round.locator(".round-head > .quiz-compteur", { hasText: "4 équipes · 8 passages · 24 mots" }).waitFor();
    await aVenir(page);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    const [pr] = await sansManche(Object.values(await library("shows"))[0].rounds);
    assert.deepEqual([pr.type, pr.duration, pr.propositions, pr.passages, pr.tours.length], ["pictionary", 90, 3, 2, 4]);
    await page.context().close();
  });

  test("Sarah compose un paquet de mimes ; une prestation d'avant qui l'utilise se joue encore ; la régie l'ajoute aussi en direct", async () => {
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

    // Une prestation préparée avant le 🎲 par équipe (cedric, 23/10) avec ce paquet : la Régie PC la montre telle
    // quelle, et elle se joue comme avant. Le paquet ne se choisit plus dans une prestation.
    await seedLibrary("shows/lea", { childName: "Léa", title: "Anniversaire de Léa", age: 9, date: "2099-12-02", status: "publiee", updatedAt: 1,
      rounds: [{ type: "quiz", quizId: "animaux", finale: 3 }, { type: "mimes", deckId }] });
    await page.click("#nav button[data-screen=home]");
    await page.click('#screen-home [data-etat="avenir"]');
    await page.locator('#show-list [data-show="lea"]').getByRole("button", { name: "Ouvrir" }).click();
    await deplierJeux(page);
    await page.locator("#show-summary", { hasText: "3 questions · 1 manche de mimes jouables" }).waitFor();
    await page.locator("#show-rounds .round").nth(1).locator(".mime-ancienne", { hasText: "Manche préparée à l'ancienne" }).waitFor();
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

  test("Régie PC (cedric, 24/10) : menu temporaire des photos manquantes de la banque : une ligne par mot sans photo, 📤 pour la choisir (gardée sur ce PC), ✕, « 📦 Télécharger le lot » ; rien en ligne", async () => {
    const { motsSansPhoto } = await import("../web/public/photos-manquantes.js");
    const mots = motsSansPhoto();
    assert.ok(mots.length > 0 && mots.some((m) => m.mot === "Crêpe"));
    const avant = await library("");
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.locator("#library-images:not([hidden])").waitFor();
    await page.locator(".media-group[data-groupe=\"photos\"] .pm-ouvrir", { hasText: `🧰 Photos manquantes (${mots.length})` }).click();
    const panneau = page.locator("#media-list > details.photos-manquantes");
    await panneau.waitFor();
    assert.equal(await panneau.getAttribute("open"), "");
    assert.deepEqual(await panneau.locator(".pm-mot .pm-nom b").allTextContents(), mots.map((m) => m.mot));
    assert.equal(await panneau.locator(".pm-mot .pm-apercu img").count(), 0, "en attendant : l'émoji");
    const crepe = panneau.locator('.pm-mot[data-cle="crepe"]');
    const gomme = panneau.locator('.pm-mot[data-cle="gomme"]');
    await crepe.locator('input[type="file"]').setInputFiles({ name: "crepe.png", mimeType: "image/png", buffer: png([230, 180, 90]) });
    await crepe.locator(".pm-apercu img").waitFor();
    await panneau.locator(".pm-compte", { hasText: `1 / ${mots.length} photo prête` }).waitFor();
    // Pas une image : refusée, dit pourquoi.
    await gomme.locator('input[type="file"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("pas une photo") });
    await page.locator("#annonce", { hasText: "Ce fichier n'est pas une image" }).waitFor();
    await gomme.locator('input[type="file"]').setInputFiles({ name: "gomme.png", mimeType: "image/png", buffer: png([240, 120, 160]) });
    await panneau.locator(".pm-compte", { hasText: `2 / ${mots.length} photos prêtes` }).waitFor();
    // Gardées sur ce PC : toujours là après un rechargement.
    await page.reload();
    await page.click("#nav button[data-screen=library]");
    await page.click('#media-groups [data-groupe="photos"]');
    await panneau.locator(".pm-compte", { hasText: `2 / ${mots.length} photos prêtes` }).waitFor();
    assert.equal(await panneau.locator(".pm-mot.prete .pm-apercu img").count(), 2);
    // ✕ : enlevée.
    await gomme.locator(".pm-retirer").click();
    await panneau.locator(".pm-compte", { hasText: `1 / ${mots.length} photo prête` }).waitFor();
    assert.equal(await gomme.locator(".pm-retirer").isHidden(), true);
    await capture(page, "photos-manquantes");
    // Le lot : un seul fichier, une photo par mot (clé de la banque).
    const [telechargement] = await Promise.all([page.waitForEvent("download"), panneau.locator(".pm-bas .btn", { hasText: "📦 Télécharger le lot (1 photo)" }).click()]);
    assert.equal(telechargement.suggestedFilename(), "photos-manquantes-1.json");
    const fichier = JSON.parse(readFileSync(await telechargement.path(), "utf8"));
    assert.equal(fichier.photosManquantes, 1);
    assert.deepEqual(Object.keys(fichier.photos), ["crepe"]);
    assert.equal(fichier.photos.crepe.mot, "Crêpe");
    assert.match(fichier.photos.crepe.data, /^data:image\/jpeg;base64,/);
    await page.locator("#annonce", { hasText: "Joignez ce fichier dans le fil « Feuille de route »" }).waitFor();
    assert.deepEqual(await library(""), avant, "rien d'écrit en ligne");
    await page.context().close();
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
      // La recherche de la chanson entière (absente ici) redessine les réglages quand elle finit : taper avant, c'est
      // taper dans un champ qui disparaît (vu sur GitHub le 24/10 : l'artiste renommé jamais enregistré).
      await page.locator(".track.reglage .reglage-manque", { hasText: "Les curseurs attendent la chanson entière" }).waitFor();
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
    // Le nombre de mots choisi, sans 🎲 : la TV les tire au lancement.
    await round.locator(".tirage-nombre").selectOption("4");
    await round.locator(".round-head > .quiz-compteur", { hasText: "la TV en tirera 4 au hasard" }).waitFor();
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

  test("Régie PC : plusieurs quiz dans une manche, mimes tirés au 🎲 pour chaque équipe puis retouchés, mots écrits à la main", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX, espace: ESPACE });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    // Quiz : un deuxième quiz rappelé à la suite, dans la même manche (deux séries).
    await ajouterJeu(page);
    const quiz = page.locator("#show-rounds .round").nth(0);
    await integrerQuiz(quiz, "animaux", "anim");
    await integrerQuiz(quiz, "espace", "esp");
    await page.locator("#show-summary", { hasText: "4 questions" }).waitFor();
    // Mimes (cedric, 24/10 : le 🎲 sur chaque ligne d'équipe) : 10 émojis pour chacune des 4 équipes ; un retiré, un
    // autre tiré à sa place.
    await ajouterJeu(page, "mimes");
    const mimes = page.locator("#show-rounds .round").nth(1);
    const compteurMimes = mimes.locator(".round-head > .quiz-compteur");
    await mimes.locator(".mime-source").selectOption("emojis");
    await mimes.locator(".mime-par-equipe").selectOption("10");
    for (let k = 0; k < 4; k++) {
      await mimes.locator(".mime-equipe").nth(k).locator(".mime-equipe-tete .tirage-de").click();
      await compteurMimes.filter({ hasText: `4 équipes · ${(k + 1) * 10} images` }).waitFor();
    }
    assert.equal(await compteurMimes.textContent(), "4 équipes · 40 images");
    const removed = await mimes.locator(".mime-image .mime-mot").first().textContent();
    await mimes.locator(".mime-image .tirage-retirer").first().click();
    await compteurMimes.filter({ hasText: /^4 équipes · 39 images · 1 à tirer$/ }).waitFor();
    await mimes.locator(".mime-image.vide .tirage-de").click();
    await compteurMimes.filter({ hasText: /^4 équipes · 40 images$/ }).waitFor();
    // Chante le mot ! : deux mots écrits à la main.
    await ajouterJeu(page, "chante");
    const chante = page.locator("#show-rounds .round").nth(2);
    for (const mot of ["soleil", "maman"]) {
      await chante.locator(".mots-ecrire").fill(mot);
      await chante.locator(".mots-ecrire").press("Enter");
    }
    await chante.locator(".round-head > .quiz-compteur", { hasText: "2 mots" }).waitFor();
    await aVenir(page);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    const saved = await sansManche(Object.values(await library("shows"))[0].rounds);
    assert.deepEqual(saved[0].seriesQuiz.map((x) => [x.origine, x.quizId]), [["quiz", "animaux"], ["quiz", "espace"]]);
    assert.equal(saved[0].finale, 3);
    assert.deepEqual([saved[1].type, saved[1].source, saved[1].perTeam], ["mimes", "emojis", 10]);
    assert.deepEqual(saved[1].equipes.map((l) => l.length), [10, 10, 10, 10]);
    assert.ok(!saved[1].equipes.flat().some((c) => c.word === removed), "La carte retirée n'est plus là");
    assert.deepEqual(saved[2].seriesMots.map((x) => [x.origine, x.mots.map((m) => m.word)]), [["main", ["soleil", "maman"]]]);
    assert.equal(saved[2].picks, undefined);
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
    assert.deepEqual(questions.slice(0, 4).map((q) => q.round), ["Animaux + Espace", "Animaux + Espace", "Animaux + Espace", "Animaux + Espace"]);
    // Une manche de mimes par équipe, dans l'ordre des couleurs ; chacune ses cartes, dans l'ordre de la Régie PC.
    assert.deepEqual(questions.slice(4, 8).map((q) => [q.kind, q.text]),
      [["mime", "Équipe Rose"], ["mime", "Équipe Orange"], ["mime", "Équipe Vert"], ["mime", "Équipe Jaune"]]);
    assert.deepEqual(questions.slice(4, 8).map((q) => q.cards.map((c) => c.word)), saved[1].equipes.map((l) => l.map((c) => c.word)));
    assert.deepEqual(questions.slice(8).map((q) => q.text), ["soleil", "maman"]);
    await regie.context().close();
  });

  test("Régie PC « jamais deux fois » : un élément déjà utilisé dans une autre manche est signalé en rouge (permis), le tirage l'évite", async () => {
    // Des Mimes déjà tirés pour chaque équipe (le 🎲 est au hasard : la présélection est posée d'avance).
    await seedLibrary("shows/lea", { childName: "Léa", title: "Anniversaire de Léa", age: 9, teams: 2, date: "2099-12-02", status: "publiee", updatedAt: 1,
      rounds: [{ type: "mimes", source: "emojis", perTeam: 2, equipes: [[{ word: "Chat", image: "🐱" }, { word: "Lion", image: "🦁" }], [{ word: "Ours", image: "🐻" }, { word: "Pomme", image: "🍎" }]] }] });
    const page = await admin();
    await page.click('#screen-home [data-etat="avenir"]');
    await page.locator('#show-list [data-show="lea"]').getByRole("button", { name: "Ouvrir" }).click();
    await deplierJeux(page);
    const mimes = page.locator("#show-rounds .round").nth(0);
    // Une ligne par équipe, repliée : on la déplie pour voir ses images.
    await mimes.locator(".mime-equipe").nth(0).locator(".mime-deplier").click();
    await mimes.locator(".mime-image", { hasText: "Chat" }).waitFor();
    await ajouterJeu(page, "chante");
    const chante = page.locator("#show-rounds .round").nth(1);
    // Écrit à la main (cedric, 24/10 : Chante le mot ! en séries) : permis, en rouge des deux côtés.
    await chante.locator(".mots-ecrire").fill("chat");
    await chante.locator(".mots-ajouter").click();
    await chante.locator('.quiz-series li.deja[data-mot="chat"] .mot-deja', { hasText: "Déjà dans « Mimes »" }).waitFor();
    await mimes.locator(".mime-image.deja", { hasText: "Chat" }).waitFor();
    assert.equal(await mimes.locator(".mime-image.deja").getAttribute("title"), "Déjà utilisée dans Chante le mot !");
    // Repliée, la ligne le dit aussi.
    await mimes.locator(".mime-equipe").nth(0).locator(".mime-deplier").click();
    await mimes.locator(".mime-equipe").nth(0).locator(".mime-deja", { hasText: "⚠ 1 déjà dans un autre jeu" }).waitFor();
    await mimes.locator(".mime-equipe").nth(0).locator(".mime-deplier").click();
    // ✕ puis 🎲 : le tirage ne reprend pas le chat des Mimes.
    await chante.locator('.quiz-series li[data-mot="chat"] .tirage-retirer').click();
    await chante.locator(".round-head > .quiz-compteur", { hasText: "Aucun mot" }).waitFor();
    await chante.locator(".tirage-de").click();
    await chante.locator(".round-head > .quiz-compteur", { hasText: "6 mots" }).waitFor();
    assert.equal(await chante.locator('[data-mot="chat"]').count(), 0);
    await mimes.locator(".mime-image:not(.deja)", { hasText: "Chat" }).waitFor();
    assert.equal(await page.locator(".mot-deja, .mime-image.deja").count(), 0);
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

  test("Régie PC : une manche de mimes tirée au 🎲 dans une prestation, gardée toute seule dans la page du jeu, épinglée ; une prestation de 6 équipes tire pour ses 6 équipes", async () => {
    const page = await admin();
    // La page du jeu : son aperçu, ses manches, son historique ; on n'y compose plus de manche (cedric, 21/10).
    await page.locator('#home-games .tile[data-game=mimes]').click();
    await page.locator("#screen-game:not([hidden]) #game-h1", { hasText: "Mimes" }).waitFor();
    await page.locator("#manches-list", { hasText: "Aucune manche pour l'instant : elles arrivent ici quand vous composez une prestation." }).waitFor();
    assert.equal(await page.locator("#manche-new").count(), 0);
    assert.match(await page.locator("#game-apercu").getAttribute("src"), /apercus-jeux\/mimes\.mp4$/);
    assert.match(await page.locator("#game-manche-hint").textContent(), /« ＋ Ajouter un jeu »/);

    // Composée dans une prestation : le 🎲 de chaque équipe tire ses images (10 ici), toutes différentes.
    await page.click("#nav button[data-screen=home]");
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    await page.click("#round-add");
    await capture(page, "prestation-ajouter-un-jeu");
    await page.click('#jeu-choix .jeu-tuile[data-jeu="mimes"]');
    const composee = page.locator("#show-rounds .round").nth(0);
    const compteur = composee.locator(".round-head > .quiz-compteur");
    await composee.locator(".mime-par-equipe").selectOption("10");
    for (let k = 0; k < 4; k++) await composee.locator(".mime-equipe").nth(k).locator(".mime-equipe-tete .tirage-de").click();
    await compteur.filter({ hasText: /^4 équipes · 40 images$/ }).waitFor();
    // Une seule manche de Mimes : celle de chaque équipe est dedans.
    assert.equal(await page.locator("#show-rounds .jeu-plus").count(), 0);
    await capture(page, "prestation-bloc-mimes");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée." }).waitFor();
    await waitFor(async () => Object.keys((await library("manches")) ?? {}).length === 1, "manche gardée");
    const [id, saved] = Object.entries(await library("manches"))[0];
    const [showId] = Object.keys(await library("shows"));
    assert.equal(saved.type, "mimes");
    assert.equal(saved.title, "Mimes · Anniversaire de Léa");
    assert.equal(saved.origin, "admin");
    assert.equal(saved.showId, showId);
    assert.equal(saved.round.perTeam, 10);
    assert.deepEqual(saved.round.equipes.map((l) => l.length), [10, 10, 10, 10]);
    assert.equal(new Set(saved.round.equipes.flat().map((c) => c.banque)).size, 40, "Jamais deux fois la même image");
    assert.equal((await library(`shows/${showId}`)).rounds[0].mancheId, id);
    // Réenregistrée sans changement : rien de plus ; tirée à nouveau : la même manche suit.
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée." }).waitFor();
    await composee.locator(".mime-equipe").nth(0).locator(".mime-equipe-tete .tirage-de").click();
    await repondreFenetre(page);
    await page.click("#show-save");
    await waitFor(async () => JSON.stringify((await library(`manches/${id}`)).round.equipes) !== JSON.stringify(saved.round.equipes), "manche mise à jour");
    assert.equal(Object.keys(await library("manches")).length, 1);
    const tiree = (await library(`manches/${id}`)).round.equipes;
    await waitFor(async () => JSON.stringify((await library(`shows/${showId}`)).rounds[0].equipes) === JSON.stringify(tiree), "prestation enregistrée");
    await page.locator("#show-save:not([disabled])").waitFor();

    // Dans la page du jeu : la manche, épinglée en tête ; l'historique dit qu'elle est gardée.
    await openGamePage(page, "mimes");
    await page.locator(`#manches-list [data-manche="${id}"] button`, { hasText: "⭐ Épingler" }).click();
    await page.locator(`#manches-pinned [data-manche="${id}"]`, { hasText: "⭐ Épinglée" }).waitFor();
    assert.equal((await library(`manches/${id}`)).pinned, true);
    await page.locator("#manches-shows .manche-from-show", { hasText: "Gardée : « Mimes · Anniversaire de Léa »" }).waitFor();
    await capture(page, "page-jeu-mimes");

    // Prestation de 6 équipes : le 🎲 tire pour les 6 couleurs (pas de « Reprendre » dans les Mimes).
    await page.click("#nav button[data-screen=home]");
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    await page.selectOption("#show-teams", "6");
    await ajouterJeu(page, "mimes");
    const round = page.locator("#show-rounds .round").nth(0);
    assert.equal(await round.locator(".reprendre").count(), 0);
    for (let k = 0; k < 6; k++) await round.locator(".mime-equipe").nth(k).locator(".mime-equipe-tete .tirage-de").click();
    await round.locator(".round-head > .quiz-compteur").filter({ hasText: /^6 équipes · 120 images$/ }).waitFor();
    assert.deepEqual(await round.locator(".mime-equipes > .mime-equipe").evaluateAll((xs) => xs.map((x) => x.dataset.couleur)), ["Rose", "Orange", "Vert", "Jaune", "Bleu", "Violet"]);
    await aVenir(page);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    const show = Object.entries(await library("shows")).find(([k]) => k !== showId)[1];
    assert.equal(show.teams, 6);
    assert.deepEqual(show.rounds[0].equipes.map((l) => l.length), [20, 20, 20, 20, 20, 20]);
    // Chaque prestation garde sa manche ; celle de Léa ne bouge pas.
    await waitFor(async () => Object.keys(await library("manches")).length === 2, "manche de la 2e prestation gardée");
    assert.deepEqual((await library(`manches/${id}`)).round.equipes, tiree);
    await page.context().close();
  });

  test("Régie PC : 4 équipes par défaut, alerte rouge quand une équipe prévue n'a pas de mots (cedric, 21/10)", async () => {
    const page = await admin();
    await page.click("#home-new");
    assert.equal(await page.locator("#show-teams").inputValue(), "4", "Nouvelle prestation : 4 équipes");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    await ajouterJeu(page, "pictionary");
    const round = page.locator("#show-rounds .round").nth(0);
    assert.equal(await round.locator(".alerte-equipes").count(), 0, "Rien de tiré (la TV tirera au hasard) : pas d'alerte");
    // Le 🎲 d'une seule équipe : les trois autres n'ont pas de mots.
    await round.locator('.picto-equipe[data-couleur="Rose"] .tirage-de:not(.petit)').click();
    await round.locator(".alerte-equipes", { hasText: "⚠ Pictionary : équipe orange, équipe vert, équipe jaune sans mots (touchez 🎲)." }).waitFor();
    await capture(page, "alerte-equipes");
    // Moins d'équipes : l'alerte suit, puis disparaît.
    await page.selectOption("#show-teams", "2");
    await round.locator(".alerte-equipes", { hasText: "⚠ Pictionary : équipe orange sans mots (touchez 🎲)." }).waitFor();
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

  test("Régie PC : couleurs des équipes dans la prestation, une pastille par équipe, à changer sans doublon (cedric, 22/10)", async () => {
    const page = await admin();
    await page.click("#home-new");
    const pastilles = () => page.locator("#show-couleurs .pastilles .pastille .nom").allTextContents();
    assert.deepEqual(await pastilles(), ["Rose", "Orange", "Vert", "Jaune"], "4 équipes : les couleurs des bracelets");
    await page.selectOption("#show-teams", "6");
    assert.deepEqual(await pastilles(), ["Rose", "Orange", "Vert", "Jaune", "Bleu", "Violet"]);
    await page.selectOption("#show-teams", "2");
    assert.deepEqual(await pastilles(), ["Rose", "Orange"]);
    // La 1re équipe passe au vert : les 8 couleurs s'ouvrent sous les pastilles.
    await page.locator("#show-couleurs .pastilles .pastille").nth(0).click();
    assert.equal(await page.locator("#show-couleurs .choix-couleurs .pastille").count(), 8);
    await page.locator("#show-couleurs .choix-couleurs .pastille", { hasText: "Vert" }).click();
    assert.deepEqual(await pastilles(), ["Vert", "Orange"]);
    assert.equal(await page.locator("#show-couleurs .choix-couleurs").count(), 0, "le choix se referme");
    // L'orange déjà pris par la 2e équipe, donné à la 1re : les deux échangent, jamais deux fois la même couleur.
    await page.locator("#show-couleurs .pastilles .pastille").nth(0).click();
    await page.locator("#show-couleurs .choix-couleurs .pastille", { hasText: "Orange" }).click();
    assert.deepEqual(await pastilles(), ["Orange", "Vert"]);
    await capture(page, "couleurs-equipes");
    await page.fill("#show-child", "Léa");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "enregistrée" }).waitFor();
    const [id, show] = Object.entries(await library("shows"))[0];
    assert.deepEqual(show.teamColors, ["#FF6B1A", "#39FF14"]);
    // Rouverte, la prestation garde ses couleurs ; « Annuler les modifications » les remet.
    await page.locator("#show-couleurs .pastilles .pastille").nth(1).click();
    await page.locator("#show-couleurs .choix-couleurs .pastille", { hasText: "Bleu" }).click();
    assert.deepEqual(await pastilles(), ["Orange", "Bleu"]);
    await page.locator(".retour-tout").first().click();
    assert.deepEqual(await pastilles(), ["Orange", "Vert"]);
    assert.ok(id);
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
    // Quiz en cours : bilan des scores sur la TV d'abord (cedric, 24/10).
    await regie.locator("#r-toast", { hasText: "Bilan des scores sur la TV, puis" }).waitFor();
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
    // En bas (cedric, 24/10) : Enregistrer · Annuler les modifications · ← Retour, une barre qui suit l'écran dès
    // l'ouverture ; « Supprimer » reste à sa place en bas de la page, et le message d'enregistrement passe dans la barre.
    assert.deepEqual(await bar.locator("button:visible").allInnerTexts(), ["Enregistrer le paquet", "Annuler les modifications", "← Retour"]);
    assert.equal(await bar.evaluate((b) => b.classList.contains("flottante")), true);
    assert.equal(await bar.locator("#mime-delete").count(), 0);
    assert.equal(await bar.locator(".retour-tout").isDisabled(), true);
    await bar.getByRole("button", { name: "Enregistrer le paquet" }).click();
    await bar.locator("#mime-status", { hasText: "Donnez un nom au paquet." }).waitFor();
    await capture(page, "barre-bas-message", { pleinePage: false });
    assert.equal(await bar.locator(".retour-tout").isDisabled(), true, "un enregistrement refusé ne change rien");
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

  test("Régie PC (cedric, 23/10) : dans la Bibliothèque, chaque onglet et chaque rubrique comptent comme une page : « ← Retour » revient à la rubrique d'avant", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    const page = await admin();
    const actif = (id) => page.locator(`#${id} .chip.active`).getAttribute("data-groupe");
    const onglet = () => page.locator("#library-tabs .chip.active").getAttribute("data-lib-tab");
    const retour = () => page.locator("#screen-library .retour-barre.haut .retour-page").click();
    await page.click('#nav [data-screen="library"]');
    await page.locator("#screen-library:not([hidden])").waitFor();
    // Images › Émojis, puis Questions › Quiz classique tout prêt › un filtre (pas une page) › Mes questions en vrac.
    await page.click('#media-groups [data-groupe="emojis"]');
    await page.click('#library-tabs [data-lib-tab="questions"]');
    await page.click('#q-groups [data-groupe="classiques"]');
    await page.locator('#screen-library .chip[data-niveau]:not([data-niveau="tous"])').first().click();
    await page.click('#q-groups [data-groupe="miennes"]');
    assert.equal(await actif("q-groups"), "miennes");
    // ← Retour : Quiz classique tout prêt, puis Tout, puis Images › Émojis, puis Images › Tout, puis l'Accueil.
    await retour();
    await waitFor(async () => (await actif("q-groups")) === "classiques", "retour sur le Quiz classique tout prêt");
    assert.equal(await onglet(), "questions");
    await retour();
    await waitFor(async () => (await actif("q-groups")) === "tout", "retour sur toutes les questions");
    await retour();
    await waitFor(async () => (await onglet()) === "images", "retour sur les images");
    assert.equal(await actif("media-groups"), "emojis");
    await retour();
    await waitFor(async () => (await actif("media-groups")) === "tout", "retour sur toutes les images");
    await retour();
    await page.locator("#screen-home:not([hidden])").waitFor();
    // La flèche « avancer » du navigateur refait le chemin.
    for (const _ of [1, 2, 3, 4]) await page.goForward();
    await waitFor(async () => (await onglet()) === "questions" && (await actif("q-groups")) === "classiques", "en avant jusqu'au Quiz classique tout prêt");
    // Le filtre choisi dans la rubrique n'a pas fait de page : la flèche revient à la rubrique d'avant.
    await page.goBack();
    await waitFor(async () => (await actif("q-groups")) === "tout", "flèche : toutes les questions");
    await page.context().close();
  });

  test("Régie PC : la flèche du navigateur et « ← Retour » ramènent à la page précédente ; quitter une page modifiée demande d'abord", async () => {
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    await seedLibrary("shows", { lea: { childName: "Léa", age: 7, date: "2099-12-02", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 } });
    const page = await admin();
    // Accueil → liste « À venir » → la prestation de Léa.
    await page.click('#screen-home [data-etat="avenir"]');
    await page.locator('#show-list [data-show="lea"]').getByRole("button", { name: "Ouvrir" }).click();
    await deplierJeux(page);
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
    // Trois choix (cedric, 24/10) : Enregistrer, Quitter sans enregistrer, Rester.
    assert.match(await question, /Les enregistrer avant de quitter \?/);
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
    await deplierJeux(page);
    assert.equal(await page.inputValue("#show-age"), "7");
    await page.locator("#screen-show-edit .retour-barre.bas .retour-page").click();
    await page.locator("#screen-shows:not([hidden])").waitFor();
    // « Enregistrer » dans la fenêtre (cedric, 24/10) : la prestation est enregistrée, puis on va où on voulait aller.
    await page.locator('#show-list [data-show="lea"]').getByRole("button", { name: "Ouvrir" }).click();
    await deplierJeux(page);
    await page.fill("#show-age", "9");
    await page.locator("#screen-show-edit .retour-barre.haut .retour-page").click();
    const fenetre = page.locator("dialog[data-fenetre][open]");
    assert.deepEqual(await fenetre.locator(".fenetre-boutons button").allTextContents(), ["Enregistrer", "Quitter sans enregistrer", "Rester"]);
    await fenetre.locator("[data-fenetre-premier]").click();
    await page.locator("#screen-shows:not([hidden])").waitFor();
    await waitFor(async () => (await library("shows/lea")).age === 9, "enregistrée avant de quitter");
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
    await deplierJeux(page);
    await page.locator("#screen-show-edit:not([hidden])").waitFor();
    const annulerTout = page.locator("#screen-show-edit .retour-barre.bas .retour-tout");
    assert.equal(await annulerTout.isDisabled(), true);
    // La barre du bas (cedric, 24/10) : Enregistrer · Annuler les modifications · ← Retour, de gauche à droite ; elle
    // suit l'écran même sans modification.
    const barreBas = page.locator("#screen-show-edit .retour-barre.bas");
    assert.deepEqual(await barreBas.locator(".btn").allInnerTexts(), ["Enregistrer", "Annuler les modifications", "← Retour"]);
    assert.equal(await barreBas.evaluate((b) => b.classList.contains("flottante")), true);
    assert.equal(await page.locator("#screen-show-edit button", { hasText: /^Enregistrer$/ }).count(), 2, "en haut et dans la barre du bas, pas une de plus");
    const retirerJeu = page.locator('#show-rounds .jeu-bloc[data-jeu="quiz"] button[title="Retirer ce jeu"]');
    await retirerJeu.click();
    assert.match(await repondreFenetre(page, { accepter: false }), /^Retirer « .+ » de la prestation \?$/);
    assert.equal(await page.locator("#show-rounds .round").count(), 1, "Annuler : le jeu reste");
    await retirerJeu.click();
    await repondreFenetre(page);
    await waitFor(async () => (await page.locator("#show-rounds .round").count()) === 0, "jeu retiré");
    await waitFor(async () => !(await annulerTout.isDisabled()), "« Annuler les modifications » possible aussitôt");
    // Une modification : la barre suit l'écran, Enregistrer à gauche, tous trois à portée en bas de la fenêtre.
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitFor(async () => (await barreBas.evaluate((b) => b.classList.contains("flottante"))), "barre flottante");
    const boites = await barreBas.locator(".btn").evaluateAll((xs) => xs.map((x) => x.getBoundingClientRect()).map((r) => ({ g: r.left, d: r.right, b: r.bottom })));
    assert.ok(boites[0].d <= boites[1].g && boites[1].d <= boites[2].g, JSON.stringify(boites));
    assert.ok(boites.every((r) => r.b <= 800), "dans la fenêtre");
    await capture(page, "barre-bas-enregistrer", { pleinePage: false });
    await page.keyboard.press("Control+z");
    await waitFor(async () => (await page.locator("#show-rounds .jeu-bloc").count()) === 1, "Ctrl+Z : le jeu revient (replié)");
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
    assert.equal(quiz.kind, "images");
    // Bibliothèque › Questions › « 🔍 Mes séries de photos » (cedric, 23/10) : elle y est, jamais dans ses questions en vrac.
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="questions"]');
    await page.locator('#q-groups [data-groupe="photos"]', { hasText: "🔍 Mes séries de photos (3)" }).click();
    await page.locator(`#q-list .pack[data-pack="${id}"]`, { hasText: "3 photos" }).waitFor();
    assert.equal(await page.locator("#q-list .photos-nouvelle").textContent(), "📷 Nouvelle série de photos");
    await page.locator('#q-groups [data-groupe="miennes"]', { hasText: "(0)" }).waitFor();
    // Image floue (cedric, 23/10 : comme le Quiz) : la série de photos s'intègre par sa recherche, avec ses 3 photos.
    await page.click("#nav button[data-screen=home]");
    await page.click("#home-new");
    await ajouterJeu(page, "flou");
    const round = page.locator("#show-rounds .round").nth(0);
    await round.locator(".quiz-biblio-cherche").fill("monu");
    await round.locator(`.quiz-biblio-item[data-quiz="${id}"]`, { hasText: "3 photos" }).click();
    await round.locator(".round-head > .quiz-compteur", { hasText: "3 photos" }).waitFor();
    assert.equal(await round.locator(".quiz-series .serie-voir").textContent(), "▸ 📚 Série de photos « Monuments et animaux » : 3 photos");
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
    // « 📗 Intégrer un Vrai / Faux de la bibliothèque » (cedric, 23/10 et 24/10) : seulement ses Vrai / Faux.
    const manche = page.locator("#show-rounds .round").nth(0);
    await manche.locator(".quiz-biblio-cherche").fill("scien");
    await manche.locator('.quiz-biblio-item[data-quiz="sciences"]', { hasText: "2 affirmations" }).click();
    await manche.locator(".round-head > .quiz-compteur", { hasText: "2 affirmations" }).waitFor();
    await aVenir(page);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    // Une nouvelle manche part avec sa Super Finale (3 dernières, ×2), comme au Quiz.
    assert.deepEqual(await sansManche(Object.values(await library("shows"))[0].rounds), [{ type: "express", quizId: "sciences", finale: 3 }]);
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
    await deplierJeux(page);
    const premiere = page.locator("#show-rounds .round").nth(0);
    assert.deepEqual(await page.locator("#show-rounds .jeu-bloc").evaluateAll((l) => l.map((x) => x.dataset.jeu)), ["illustre", "quiz"]);
    assert.equal(await premiere.locator("select.finale").inputValue(), "1");
    // Le Quiz illustré a l'architecture du Quiz (cedric, 23/10) : le quiz illustré en est une série.
    assert.deepEqual(await premiere.locator(".quiz-series > li.serie").evaluateAll((xs) => xs.map((x) => x.dataset.origine)), ["quiz"]);
    // Le Quiz ne propose pas le quiz illustré.
    const seconde = page.locator("#show-rounds .round").nth(1);
    await seconde.locator(".quiz-biblio-cherche").fill("animaux");
    await seconde.locator(".quiz-biblio-item").first().waitFor();
    assert.deepEqual(await seconde.locator(".quiz-biblio-item").evaluateAll((xs) => xs.map((x) => x.dataset.quiz)), ["animaux"]);
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

  test("Régie PC (cedric, 23/10) : le Quiz illustré se construit comme le Quiz : 🎲 par thème (photos libres ou émojis), un ancien anniversaire, ses quiz illustrés, Super Finale, « Quiz illustré complet » ; la TV a ses réponses en images", async () => {
    const { buildSnapshot } = await import("../web/public/show.js");
    const { cataloguePetits } = await import("../web/public/banque-petits.js");
    const { imageLibre } = await import("../web/public/banque-photos.js");
    const catalogue = cataloguePetits();
    const familleDe = new Map(catalogue.map((x) => [x.id, x.famille]));
    const bonneDe = new Map(catalogue.map((x) => [x.id, x.choices[0]]));
    const PNG = `data:image/png;base64,${png([200, 120, 60]).toString("base64")}`;
    const ids = ["1111111111111111", "2222222222222222", "3333333333333333", "4444444444444444"];
    const PETITS = {
      title: "Les animaux des petits", kind: "photo", source: "banque", updatedAt: 1,
      questions: [
        { text: "Où est le chat ?", choices: ["Chat", "Chien", "Vache", "Lion"], correct: 0, status: "validee", choiceImages: ids },
        { text: "Où est le lion ?", choices: ["Chat", "Chien", "Vache", "Lion"], correct: 3, status: "validee", choiceImages: ids },
      ],
    };
    // Un ancien anniversaire avec un Quiz illustré tiré au 🎲 (photos libres) et un Quiz ; Tom n'a qu'un Quiz.
    const luna = (text, choices) => ({ id: `l-${choices[0]}`, text, choices, correct: 0, choiceBanque: choices.map(imageLibre) });
    const tireesLuna = [luna("Luna : où est le lion ?", ["Lion", "Chat", "Chien", "Vache"]), luna("Luna : où est le lapin ?", ["Lapin", "Cochon", "Mouton", "Poule"])];
    assert.ok(tireesLuna.every((q) => q.choiceBanque.every(Boolean)));
    const LUNA = { childName: "Luna", age: 4, date: "2026-05-10", status: "archivee", updatedAt: 1, rounds: [
      { type: "illustre", seriesQuiz: [{ id: "de", origine: "de", famille: "animaux", questions: tireesLuna }] },
      { type: "quiz", quizId: "animaux" }] };
    const TOM = { childName: "Tom", age: 9, date: "2026-03-01", status: "archivee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 };
    await seedLibrary("quizzes", { animaux: ANIMAUX, petits: PETITS });
    await seedLibrary("images", Object.fromEntries(ids.map((id) => [id, PNG])));
    await seedLibrary("shows", { luna: LUNA, tom: TOM });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await page.fill("#show-age", "5");
    await ajouterJeu(page, "illustre");
    const round = page.locator("#show-rounds .round").nth(0);
    const ligne = round.locator(".quiz-outils > .tirage-ligne");
    const compteur = round.locator(".round-head > .quiz-compteur");
    const series = round.locator(".quiz-series > li.serie");
    const origines = () => series.evaluateAll((xs) => xs.map((x) => x.dataset.origine));
    // Comme le Quiz : une seule manche, le compteur sur la ligne du numéro, les outils ensemble, la Super Finale. Ni
    // bougies (elles vont dans le Quiz) ni profil : le 🎲 tire par thème dans le Quiz illustré tout prêt.
    assert.equal(await page.locator('#show-rounds .jeu-bloc[data-jeu="illustre"] .jeu-plus').count(), 0);
    assert.deepEqual(await round.locator(".round-head > *").evaluateAll((xs) => xs.map((x) => x.className)), ["num", "quiz-compteur"]);
    assert.deepEqual(await round.locator(".round-body > *").evaluateAll((xs) => xs.map((x) => x.className)), ["quiz-outils", "quiz-finale"]);
    assert.deepEqual(await ligne.locator(":scope > *").evaluateAll((xs) => xs.map((x) => x.className)), ["tirage-theme", "tirage-nombre", "btn tirage-de"]);
    assert.equal(await ligne.locator(".tirage-theme").inputValue(), "");
    assert.equal(await round.locator(".quiz-rappel-titre").textContent(), "📚 Rappeler un de vos quiz illustrés");
    assert.equal(await round.locator(".quiz-biblio-titre").textContent(), "📗 Intégrer un quiz illustré de votre bibliothèque");
    assert.equal(await compteur.textContent(), "Aucune question pour l'instant");
    assert.equal(await round.locator(".quiz-finale select.finale").inputValue(), "3");

    // Un ancien anniversaire : seulement ceux qui ont un Quiz illustré ; ses questions gardent leurs images.
    const rappel = round.locator(".quiz-rappel");
    await rappel.locator(".quiz-rappel-cherche").fill("tom");
    await rappel.locator(".quiz-rappel-liste", { hasText: "Aucune prestation archivée ne correspond." }).waitFor();
    await rappel.locator(".quiz-rappel-cherche").fill("luna");
    await rappel.locator('.quiz-rappel-item[data-show="luna"]').click();
    await series.first().waitFor();
    assert.equal(await series.nth(0).locator(".serie-voir").textContent(), "▸ 📅 Anniversaire de Luna (10 mai 2026) : 2 questions");
    // Ses quiz illustrés de la bibliothèque, jamais un quiz classique (« animaux » ne trouve que le sien).
    await round.locator(".quiz-biblio-cherche").fill("animaux");
    await round.locator(".quiz-biblio-item").first().waitFor();
    assert.deepEqual(await round.locator(".quiz-biblio-item").evaluateAll((xs) => xs.map((x) => x.dataset.quiz)), ["petits"]);
    await round.locator('.quiz-biblio-item[data-quiz="petits"]').click();
    await series.nth(1).waitFor();
    assert.equal(await series.nth(1).locator(".serie-voir").textContent(), "▸ 📚 Quiz illustré « Les animaux des petits » : 2 questions");

    // Le 🎲 : 6 questions du thème Animaux, en tête ; jamais une question déjà là.
    await ligne.locator(".tirage-theme").selectOption("animaux");
    await ligne.locator(".tirage-nombre").selectOption("6");
    await ligne.locator(".tirage-de").click();
    await waitFor(async () => (await series.count()) === 3, "série du dé");
    assert.deepEqual(await origines(), ["de", "reprise", "quiz"]);
    assert.equal(await series.nth(0).locator(".serie-voir").textContent(), "▸ 🎲 6 questions tirées au hasard (Animaux)");
    assert.equal(await compteur.textContent(), "10 questions, dont 3 en Super Finale");
    await series.nth(0).locator(".serie-voir").click();
    const lignes = series.nth(0).locator(".serie-liste > li");
    assert.equal(await lignes.count(), 6);
    const deja = new Set([...tireesLuna, ...PETITS.questions].map((q) => q.text));
    for (const t of await lignes.locator(".tirage-texte").allTextContents()) assert.ok(!deja.has(t), `déjà là : ${t}`);
    // Chaque question montre ses 4 réponses en petites images (photo libre ou émoji, jamais une image à soi), la bonne en vert.
    for (const li of await lignes.all()) {
      assert.equal(await li.locator(".tirage-rep").count(), 4);
      assert.equal(await li.locator(".tirage-rep.bonne").count(), 1);
      const images = await li.locator(".tirage-rep-img").evaluateAll((xs) => xs.map((x) => (x.tagName === "IMG" ? x.getAttribute("src") : `émoji ${x.textContent}`)));
      assert.equal(images.length, 4);
      for (const src of images) assert.match(src, /^(banque\/[^/]+\.jpg|émoji .+)$/);
    }
    // ✕ : un 🎲 prend sa place et tire une autre question du même thème.
    const retiree = await lignes.nth(0).locator(".tirage-texte").textContent();
    await lignes.nth(0).locator(".tirage-retirer").click();
    await series.nth(0).locator(".serie-liste li.vide").waitFor();
    assert.equal(await compteur.textContent(), "9 questions, dont 3 en Super Finale · 1 à tirer");
    await lignes.nth(0).locator(".tirage-de").click();
    await series.nth(0).locator(".serie-liste li.vide").waitFor({ state: "detached" });
    assert.notEqual(await lignes.nth(0).locator(".tirage-texte").textContent(), retiree);
    assert.equal(await compteur.textContent(), "10 questions, dont 3 en Super Finale");

    // Un Quiz illustré ajouté juste après n'en crée pas un second : on revient à celui-ci.
    await ajouterJeu(page, "illustre");
    await page.locator("#annonce", { hasText: "Le Quiz illustré est déjà le dernier jeu" }).waitFor();
    assert.equal(await page.locator("#show-rounds .round").count(), 1);
    // Le « Quiz illustré complet » : tout, dans l'ordre de passage, chaque question avec ses images.
    const complet = round.locator(".quiz-complet");
    assert.equal(await complet.locator(".quiz-complet-voir").textContent(), "▸ 🧩 Quiz illustré complet : 10 questions, dans l'ordre de passage");
    await complet.locator(".quiz-complet-voir").click();
    assert.equal(await complet.locator(".quiz-complet-q .tirage-reponses").count(), 10);
    await capture(page, "quiz-illustre-manche");
    if (process.env.CAPTURES) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await capture(page, "quiz-illustre-manche-pc");
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const shows = await library("shows");
    assert.deepEqual([shows.luna, shows.tom], [LUNA, TOM], "Les prestations archivées ne changent pas");
    const zoe = Object.values(shows).find((s) => s.childName === "Zoé");
    assert.equal(zoe.rounds.length, 1);
    const [manche] = zoe.rounds;
    assert.equal(manche.type, "illustre");
    assert.deepEqual(manche.seriesQuiz.map((x) => [x.origine, x.famille ?? null, x.questions?.length ?? x.quizId]),
      [["de", "animaux", 6], ["reprise", null, 2], ["quiz", null, "petits"]]);
    assert.equal(manche.finale, 3);
    assert.equal(manche.bougies, undefined);
    for (const q of manche.seriesQuiz[0].questions) {
      assert.equal(familleDe.get(q.id), "animaux", q.text);
      assert.equal(q.choices[q.correct], bonneDe.get(q.id));
      assert.deepEqual(q.choiceBanque, q.choices.map(imageLibre));
    }
    assert.deepEqual(manche.seriesQuiz[1].questions, tireesLuna.map(({ id, ...q }) => q));
    await page.context().close();

    // Sur la TV : un seul jeu « Quiz illustré », la Super Finale sur les 3 dernières, pas de bougies.
    const { snapshot } = buildSnapshot("zoe", zoe, { petits: PETITS });
    const qs = snapshot.quiz.questions;
    assert.equal(qs.length, 10);
    assert.deepEqual([...new Set(qs.map((q) => q.round))], ["Quiz illustré"]);
    assert.deepEqual(qs.slice(0, 8).map((q) => q.choiceBanque?.length), Array(8).fill(4));
    assert.deepEqual(qs.slice(8).map((q) => q.choiceImages), [ids, ids]);
    assert.deepEqual(qs.map((q) => !!q.finale), [...Array(7).fill(false), true, true, true]);
    assert.ok(!qs.some((q) => /bougies/.test(q.text)));
    // Lancée par la régie : chaque réponse a son image copiée dans la partie (photo libre, émoji dessiné, ou la sienne).
    await seedLibrary("shows/zoe", { ...zoe, date: "2099-12-02", status: "publiee" });
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Zoé" }).click();
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const jouees = (await read("show")).quiz.questions;
    assert.equal(jouees.length, 10);
    await waitFor(async () => {
      const copiees = (await read("choiceImages")) ?? {};
      return jouees.every((q) => q.choiceBanque === undefined && q.choiceImages?.length === 4 && q.choiceImages.every((id) => copiees[id]));
    }, "réponses en images copiées dans la partie");
    await regie.context().close();
  });

  test("Régie PC (cedric, 23/10) : le Zoom mystère et l'Image floue se construisent comme le Quiz : 🎲 dans les photos libres par thème, un ancien anniversaire, ses séries de photos, « Zoom mystère complet », jamais deux fois la même photo ; la TV reçoit les photos", async () => {
    const { buildSnapshot } = await import("../web/public/show.js");
    const { banqueItems, BANQUE } = await import("../web/public/banque-photos.js");
    const cle = (x) => x.key.slice(BANQUE.length);
    const animaux = banqueItems().filter((x) => x.famille === "animaux").map(cle);
    assert.ok(animaux.length >= 16, "assez de photos d'animaux dans la banque");
    const PNG = `data:image/png;base64,${png([60, 120, 200]).toString("base64")}`;
    const [A, B] = ["1111111111111111", "2222222222222222"];
    const photo = (imageId, mot) => ({ text: "Qu'est-ce que c'est ?", choices: [mot, "Anna", "Simba", "Nemo"], correct: 0, imageId, status: "validee" });
    const DISNEY = { title: "Disney", theme: "Dessins animés", kind: "images", source: "photos", updatedAt: 1, questions: [photo(A, "Elsa"), photo(B, "Olaf")] };
    // Luna avait une Image floue (deux photos de la banque choisies une par une) ; Tom, seulement un Quiz.
    const [p1, p2] = animaux;
    const LUNA = { childName: "Luna", age: 6, date: "2026-05-10", status: "archivee", updatedAt: 1, rounds: [
      { type: "flou", picks: [`${BANQUE}${p1}`, `${BANQUE}${p2}`] }, { type: "quiz", quizId: "animaux" }] };
    const TOM = { childName: "Tom", age: 9, date: "2026-03-01", status: "archivee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 };
    await seedLibrary("quizzes", { animaux: ANIMAUX, disney: DISNEY });
    await seedLibrary("images", { [A]: PNG, [B]: PNG });
    await seedLibrary("shows", { luna: LUNA, tom: TOM });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await page.fill("#show-age", "7");
    await ajouterJeu(page, "zoom");
    const round = page.locator("#show-rounds .round").nth(0);
    const ligne = round.locator(".quiz-outils > .tirage-ligne");
    const compteur = round.locator(".round-head > .quiz-compteur");
    const series = round.locator(".quiz-series > li.serie");
    // Comme le Quiz, avec des photos ; ni Super Finale ni bougies.
    assert.deepEqual(await round.locator(".round-head > *").evaluateAll((xs) => xs.map((x) => x.className)), ["num", "quiz-compteur"]);
    assert.deepEqual(await round.locator(".round-body > *").evaluateAll((xs) => xs.map((x) => x.className)), ["quiz-outils"]);
    assert.deepEqual(await ligne.locator(":scope > *").evaluateAll((xs) => xs.map((x) => x.className)), ["tirage-theme", "tirage-nombre", "btn tirage-de"]);
    assert.equal(await round.locator(".quiz-rappel-titre").textContent(), "📚 Rappeler les photos d'un ancien anniversaire");
    assert.equal(await round.locator(".quiz-biblio-titre").textContent(), "📗 Intégrer une de vos séries de photos");
    assert.equal(await compteur.textContent(), "Aucune photo pour l'instant");

    // Un ancien anniversaire : ses photos de l'Image floue reviennent au Zoom mystère.
    const rappel = round.locator(".quiz-rappel");
    await rappel.locator(".quiz-rappel-cherche").fill("tom");
    await rappel.locator(".quiz-rappel-liste", { hasText: "Aucune prestation archivée ne correspond." }).waitFor();
    await rappel.locator(".quiz-rappel-cherche").fill("luna");
    await rappel.locator('.quiz-rappel-item[data-show="luna"]', { hasText: "2 photos" }).click();
    await series.first().waitFor();
    assert.equal(await series.nth(0).locator(".serie-voir").textContent(), "▸ 📅 Anniversaire de Luna (10 mai 2026) : 2 photos");
    // Ses séries de photos, jamais un quiz classique.
    await round.locator(".quiz-biblio-cherche").fill("a");
    await round.locator(".quiz-biblio-item").first().waitFor();
    assert.deepEqual(await round.locator(".quiz-biblio-item").evaluateAll((xs) => xs.map((x) => x.dataset.quiz)), ["disney"]);
    await round.locator('.quiz-biblio-item[data-quiz="disney"]').click();
    await series.nth(1).waitFor();
    assert.equal(await series.nth(1).locator(".serie-voir").textContent(), "▸ 📚 Série de photos « Disney » : 2 photos");

    // Le 🎲 : 6 photos libres d'animaux, en tête, jamais une photo déjà là.
    await ligne.locator(".tirage-theme").selectOption("animaux");
    await ligne.locator(".tirage-nombre").selectOption("6");
    await ligne.locator(".tirage-de").click();
    await waitFor(async () => (await series.count()) === 3, "série du dé");
    assert.equal(await series.nth(0).locator(".serie-voir").textContent(), "▸ 🎲 6 photos tirées au hasard (Animaux)");
    assert.equal(await compteur.textContent(), "10 photos");
    await series.nth(0).locator(".serie-voir").click();
    const lignes = series.nth(0).locator(".serie-liste > li");
    assert.equal(await lignes.count(), 6);
    const tirees = async () => (await lignes.locator("img.tirage-photo").evaluateAll((xs) => xs.map((x) => x.getAttribute("src"))))
      .map((src) => decodeURIComponent(src.match(/^banque\/(.+)\.jpg$/)[1]));
    const zoom = await tirees();
    assert.equal(zoom.length, 6);
    for (const k of zoom) assert.ok(animaux.includes(k) && k !== p1 && k !== p2, k);
    // La ligne dit la réponse à trouver (pas « Qu'est-ce que c'est ? »), sans son émoji : la photo est à côté (cedric, 24/10).
    assert.ok((await lignes.locator(".tirage-texte").allTextContents()).every((t) => t && !/qu'est-ce/i.test(t) && /^\p{L}/u.test(t)));
    // ↑ ↓ dans la liste tirée au 🎲 aussi (cedric, 24/10) : l'ordre de passage du « Zoom mystère complet » suit.
    assert.equal(await lignes.nth(0).locator(".tirage-monter").isDisabled(), true);
    assert.equal(await lignes.nth(5).locator(".tirage-descendre").isDisabled(), true);
    const premiereDuComplet = async () => decodeURIComponent((await round.locator(".quiz-complet-q img.tirage-photo").first().getAttribute("src")).match(/^banque\/(.+)\.jpg$/)[1]);
    assert.equal(await premiereDuComplet(), zoom[0]);
    await lignes.nth(0).locator(".tirage-descendre").click();
    await waitFor(async () => (await tirees()).join() === [zoom[1], zoom[0], ...zoom.slice(2)].join(), "la 1re photo passe en 2e");
    assert.equal(await premiereDuComplet(), zoom[1]);
    await lignes.nth(1).locator(".tirage-monter").click();
    await waitFor(async () => (await tirees()).join() === zoom.join(), "remise à sa place");
    // ✕ : un 🎲 prend sa place et tire une autre photo.
    await lignes.nth(0).locator(".tirage-retirer").click();
    await series.nth(0).locator(".serie-liste li.vide", { hasText: "Photo à tirer" }).waitFor();
    assert.equal(await compteur.textContent(), "9 photos · 1 à tirer");
    await lignes.nth(0).locator(".tirage-de").click();
    await series.nth(0).locator(".serie-liste li.vide").waitFor({ state: "detached" });
    const zoom2 = await tirees();
    assert.ok(!zoom2.includes(zoom[0]), "la photo retirée ne revient pas");
    assert.equal(await compteur.textContent(), "10 photos");

    // Un Zoom mystère ajouté juste après n'en crée pas un second.
    await ajouterJeu(page, "zoom");
    await page.locator("#annonce", { hasText: "Le Zoom mystère est déjà le dernier jeu : ajoutez-y vos photos" }).waitFor();
    assert.equal(await page.locator("#show-rounds .round").count(), 1);
    // « Zoom mystère complet » : chaque photo dans l'ordre ; ✕ sur Elsa la retire de sa série.
    const complet = round.locator(".quiz-complet");
    assert.equal(await complet.locator(".quiz-complet-voir").textContent(), "▸ 🧩 Zoom mystère complet : 10 photos, dans l'ordre de passage");
    await complet.locator(".quiz-complet-voir").click();
    assert.equal(await complet.locator(".quiz-complet-q .tirage-photo").count(), 10);
    await complet.locator(".quiz-complet-q", { hasText: "Elsa" }).locator(".tirage-retirer").click();
    await compteur.filter({ hasText: "9 photos" }).waitFor();
    assert.equal(await series.nth(2).locator(".serie-voir").textContent(), "▸ 📚 Série de photos « Disney » : 1 photo (1 retirée)");

    // Une Image floue dans la même fête : son 🎲 ne reprend aucune photo du Zoom mystère (jamais deux fois).
    await ajouterJeu(page, "flou");
    const flou = page.locator("#show-rounds .round").nth(1);
    await flou.locator(".tirage-theme").selectOption("animaux");
    await flou.locator(".tirage-nombre").selectOption("6");
    await flou.locator(".tirage-de").click();
    await flou.locator(".round-head > .quiz-compteur", { hasText: "6 photos" }).waitFor();
    assert.equal(await flou.locator(".quiz-complet-voir").textContent(), "▸ 🧩 Image floue complète : 6 photos, dans l'ordre de passage");
    await flou.locator(".quiz-series .serie-voir").click();
    const floues = (await flou.locator(".quiz-series .serie-liste img.tirage-photo").evaluateAll((xs) => xs.map((x) => x.getAttribute("src"))))
      .map((src) => decodeURIComponent(src.match(/^banque\/(.+)\.jpg$/)[1]));
    assert.equal(floues.length, 6);
    for (const k of floues) assert.ok(!zoom2.includes(k) && k !== p1 && k !== p2, `déjà au Zoom mystère : ${k}`);
    await capture(page, "zoom-flou-manche");

    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const shows = await library("shows");
    assert.deepEqual([shows.luna, shows.tom], [LUNA, TOM], "Les prestations archivées ne changent pas");
    const zoe = Object.values(shows).find((x) => x.childName === "Zoé");
    assert.deepEqual(zoe.rounds.map((r) => r.type), ["zoom", "flou"]);
    const [manche] = zoe.rounds;
    assert.deepEqual(manche.seriesQuiz.map((x) => [x.origine, x.famille ?? null, x.questions?.length ?? x.quizId]),
      [["de", "animaux", 6], ["reprise", null, 2], ["quiz", null, "disney"]]);
    assert.deepEqual(manche.seriesQuiz[2].sans, [`i:${A}`]);
    assert.equal(manche.finale, undefined);
    assert.deepEqual(manche.seriesQuiz[0].questions.map((q) => q.banque), zoom2);
    await page.context().close();

    // Sur la TV : un seul jeu « Zoom mystère » de 9 photos, sans Super Finale ; lancées par la régie, photos copiées.
    const { snapshot } = buildSnapshot("zoe", zoe, { disney: DISNEY });
    const qs = snapshot.quiz.questions.filter((q) => q.kind === "zoom");
    assert.equal(qs.length, 9);
    assert.deepEqual([...new Set(qs.map((q) => q.round))], ["Zoom mystère"]);
    assert.ok(!qs.some((q) => q.finale));
    assert.deepEqual(qs.map((q) => q.imageId ?? `b:${q.banque}`), [...zoom2.map((k) => `b:${k}`), `b:${p1}`, `b:${p2}`, B]);
    await seedLibrary("shows/zoe", { ...zoe, date: "2099-12-02", status: "publiee" });
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Zoé" }).click();
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const jouees = (await read("show")).quiz.questions.filter((q) => q.kind === "zoom" || q.kind === "flou");
    assert.equal(jouees.length, 15);
    await waitFor(async () => {
      const copiees = (await read("images")) ?? {};
      return jouees.every((q) => q.banque === undefined && /^[0-9a-f]{16}$/.test(q.imageId ?? "") && copiees[q.imageId]);
    }, "photos copiées dans la partie");
    await regie.context().close();
  });

  test("Régie PC (cedric, 23 et 24/10) : le Zoom mystère et l'Image floue se composent aussi à la main dans toute la bibliothèque d'images (« Mes images » puis les photos libres), cochées une par une, leur nom pour réponse ; déjà utilisée dans ce jeu ou dans la fête : en rouge, mais possible", async () => {
    const { buildSnapshot } = await import("../web/public/show.js");
    const { photosLibres } = await import("../web/public/mediatheque.js");
    const LIBRES = photosLibres().length;
    const PNG = `data:image/png;base64,${png([90, 160, 60]).toString("base64")}`;
    const MES = ["a1a1a1a1a1a1a1a1", "b2b2b2b2b2b2b2b2", "c3c3c3c3c3c3c3c3", "d4d4d4d4d4d4d4d4", "e5e5e5e5e5e5e5e5"];
    const NOMS = ["Lion", "Tigre", "Ours", "Mamie Jo", "Petit tigre"];
    const SANS_NOM = "f6f6f6f6f6f6f6f6";
    const PANDA = "banque:panda";
    await seedLibrary("images", Object.fromEntries([...MES, SANS_NOM].map((id) => [id, PNG])));
    await seedLibrary("medias", {
      ...Object.fromEntries(MES.map((id, k) => [id, { name: NOMS[k], cat: k === 3 ? "Famille" : "Animaux", createdAt: 1, updatedAt: 1 }])),
      [SANS_NOM]: { cat: "Animaux", createdAt: 1, updatedAt: 1 },
    });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await page.fill("#show-age", "7");
    await ajouterJeu(page, "zoom");
    const round = page.locator("#show-rounds .round").nth(0);
    const compteur = round.locator(".round-head > .quiz-compteur");
    const vos = round.locator(".quiz-outils .vos-images");
    const tuile = (zone, id) => zone.locator(`.vos-images-tuile[data-image="${id}"]`);
    const tuiles = (zone) => zone.locator(".vos-images-tuile").evaluateAll((xs) => xs.map((x) => x.dataset.image));
    // Quatrième ligne des outils, fermée : rien ne se charge tant qu'on ne l'ouvre pas.
    assert.equal(await vos.locator(".vos-images-titre").textContent(), "▸ ⭐ Composer avec vos images");
    assert.equal(await vos.locator(".vos-images-tuile").count(), 0);
    await vos.locator(".vos-images-titre").click();
    await vos.locator(".vos-images-tuile").first().waitFor();
    assert.equal(await round.locator(".vos-images-titre").textContent(), "▾ ⭐ Composer avec vos images");
    // Toute la bibliothèque (cedric, 24/10) : ses images d'abord, puis les photos libres ; jamais d'émoji (que des photos).
    const ouverte = await tuiles(round);
    assert.equal(ouverte.length, 60);
    assert.deepEqual(ouverte.slice(0, 6).sort(), [...MES, SANS_NOM].sort());
    assert.ok(ouverte.slice(6).every((id) => id.startsWith("banque:")), "puis les photos libres");
    await round.locator(".vos-images-grille > p.hint", { hasText: `Et ${LIBRES + 6 - 60} autres images : précisez la recherche.` }).waitFor();
    assert.equal(await round.locator(".vos-images-tuile img").count(), 60);
    // Sans nom : pas de réponse à trouver, elle ne se coche pas.
    assert.equal(await tuile(round, SANS_NOM).isDisabled(), true);
    assert.equal(await tuile(round, SANS_NOM).locator(".vos-images-etat").textContent(), "À nommer dans Mes images");
    assert.equal(await round.locator(".vos-images-ajouter").isDisabled(), true);
    // Recherche en direct : « tigre » trouve d'abord les noms qui commencent par « Tigre » (la sienne, puis la photo libre),
    // puis celui qui le contient.
    await round.locator(".vos-images-cherche").fill("tigre");
    await waitFor(async () => (await round.locator(".vos-images-tuile").count()) === 3, "trois tigres");
    assert.deepEqual(await tuiles(round), [MES[1], "banque:tigre", MES[4]]);
    assert.deepEqual(await round.locator(".vos-images-tuile > span").allTextContents(), ["Tigre", "Tigre", "Petit tigre"]);
    assert.equal(await tuile(round, "banque:tigre").locator("img").getAttribute("src"), "banque/tigre.jpg");
    await tuile(round, MES[1]).click();
    await round.locator(".vos-images-cherche").fill("famille");
    await tuile(round, MES[3]).click();
    await round.locator(".vos-images-cherche").fill("panda");
    await tuile(round, PANDA).click();
    await round.locator(".vos-images-cherche").fill("");
    await tuile(round, MES[0]).click();
    for (const id of [MES[0], MES[1], MES[3]]) assert.equal(await tuile(round, id).getAttribute("aria-pressed"), "true", "les cochées le restent d'une recherche à l'autre");
    assert.equal(await round.locator(".vos-images-ajouter").textContent(), "＋ Ajouter ces 4 photos");
    await capture(page, "zoom-vos-images-choix");
    await round.locator(".vos-images-ajouter").click();
    await compteur.filter({ hasText: "4 photos" }).waitFor();
    assert.equal(await round.locator(".vos-images-tuile").count(), 0, "le panneau se referme");
    const serie = round.locator('.quiz-series > li.serie[data-origine="images"]');
    assert.equal(await serie.locator(".serie-voir").textContent(), "▾ ⭐ 4 photos choisies dans la bibliothèque");
    // Dans l'ordre des clics, la réponse sans émoji, la photo à côté.
    assert.deepEqual(await serie.locator(".serie-liste .tirage-texte").allTextContents(), ["Tigre", "Mamie Jo", "Panda", "Lion"]);
    assert.equal(await serie.locator(".serie-liste img.tirage-photo").count(), 4);

    // Un 🎲 dans le même jeu : jamais une photo déjà choisie.
    const ligne = round.locator(".quiz-outils > .tirage-ligne");
    await ligne.locator(".tirage-nombre").selectOption("6");
    await ligne.locator(".tirage-de").click();
    await compteur.filter({ hasText: "10 photos" }).waitFor();
    const de = round.locator('.quiz-series > li.serie[data-origine="de"]');
    await de.locator(".serie-voir").click();
    const tirees = (await de.locator(".serie-liste img.tirage-photo").evaluateAll((xs) => xs.map((x) => x.getAttribute("src"))))
      .map((src) => decodeURIComponent(src.match(/^banque\/(.+)\.jpg$/)[1]));
    assert.equal(tirees.length, 6);
    assert.ok(!tirees.includes("panda"), "le 🎲 ne reprend pas une photo de la composition");
    const [cle] = tirees;
    const nomTiree = (await de.locator(".serie-liste .tirage-texte").first().textContent()).trim();

    // Rouverte : celles déjà dans la composition ne se recochent pas ; celle du 🎲 est en rouge, mais possible.
    await round.locator(".vos-images-titre").click();
    await tuile(round, MES[0]).waitFor();
    assert.equal(await tuile(round, MES[0]).isDisabled(), true);
    assert.equal(await tuile(round, MES[0]).locator(".vos-images-etat").textContent(), "✓ Déjà dans votre composition");
    assert.equal(await tuile(round, MES[0]).locator(".vos-images-etat.alerte").count(), 0);
    await round.locator(".vos-images-cherche").fill("panda");
    assert.equal(await tuile(round, PANDA).isDisabled(), true);
    await round.locator(".vos-images-cherche").fill(nomTiree);
    await tuile(round, `banque:${cle}`).waitFor();
    assert.equal(await tuile(round, `banque:${cle}`).isDisabled(), false);
    assert.equal(await tuile(round, `banque:${cle}`).locator(".vos-images-etat.alerte").textContent(), "Déjà utilisée dans ce jeu");
    await round.locator(".vos-images-cherche").fill("");
    await tuile(round, MES[2]).click();
    assert.equal(await round.locator(".vos-images-ajouter").textContent(), "＋ Ajouter cette photo");
    await round.locator(".vos-images-ajouter").click();
    await compteur.filter({ hasText: "11 photos" }).waitFor();
    assert.equal(await round.locator('.quiz-series > li.serie[data-origine="images"]').count(), 1);

    // Une Image floue dans la même fête : ses images et photos libres déjà au Zoom mystère sont en rouge, mais restent possibles.
    await ajouterJeu(page, "flou");
    const flou = page.locator("#show-rounds .round").nth(1);
    await flou.locator(".vos-images-titre").click();
    await tuile(flou, MES[0]).waitFor();
    assert.equal(await tuile(flou, MES[0]).isDisabled(), false);
    assert.equal(await tuile(flou, MES[0]).locator(".vos-images-etat.alerte").textContent(), "Déjà utilisée dans la fête");
    assert.equal(await tuile(flou, MES[4]).locator(".vos-images-etat").count(), 0);
    await tuile(flou, MES[4]).click();
    await flou.locator(".vos-images-cherche").fill("panda");
    assert.equal(await tuile(flou, PANDA).isDisabled(), false);
    assert.equal(await tuile(flou, PANDA).locator(".vos-images-etat.alerte").textContent(), "Déjà utilisée dans la fête");
    await tuile(flou, PANDA).click();
    await flou.locator(".vos-images-ajouter").click();
    await flou.locator(".round-head > .quiz-compteur", { hasText: "2 photos" }).waitFor();
    await capture(page, "zoom-vos-images");

    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const zoe = Object.values(await library("shows")).find((x) => x.childName === "Zoé");
    assert.deepEqual(zoe.rounds.map((r) => r.type), ["zoom", "flou"]);
    const [zoom, floue] = zoe.rounds;
    assert.deepEqual(zoom.seriesQuiz.map((x) => x.origine), ["de", "images"]);
    const reponses = (x) => x.questions.map((q) => [q.imageId ?? `banque:${q.banque}`, q.choices[q.correct]]);
    const sansEmoji = ([id, rep]) => [id, rep.replace(/^[^\p{L}\p{N}]+/u, "").trim()];
    assert.deepEqual(reponses(zoom.seriesQuiz[1]).map(sansEmoji), [[MES[1], "Tigre"], [MES[3], "Mamie Jo"], [PANDA, "Panda"], [MES[0], "Lion"], [MES[2], "Ours"]]);
    assert.ok(zoom.seriesQuiz[1].questions.every((q) => q.choices.length === 4 && new Set(q.choices).size === 4));
    assert.equal(zoom.seriesQuiz[1].questions[2].banque, "panda");
    assert.deepEqual(reponses(floue.seriesQuiz[0]).map(([id]) => id), [MES[4], PANDA]);
    assert.equal(floue.seriesQuiz[0].questions[0].choices[floue.seriesQuiz[0].questions[0].correct], "Petit tigre");
    await page.context().close();

    // Sur la TV : les photos à deviner, leur nom pour réponse.
    const { snapshot, problems } = buildSnapshot("zoe", zoe, {});
    assert.deepEqual(problems, []);
    const qs = snapshot.quiz.questions;
    const cleTv = (q) => q.imageId ?? `banque:${q.banque}`;
    assert.deepEqual(qs.filter((q) => q.kind === "zoom").map(cleTv).sort(),
      [...zoom.seriesQuiz[0].questions, ...zoom.seriesQuiz[1].questions].map(cleTv).sort());
    assert.deepEqual(qs.filter((q) => q.kind === "flou").map((q) => [cleTv(q), q.choices[q.correct]]),
      floue.seriesQuiz[0].questions.map((q) => [cleTv(q), q.choices[q.correct]]));
  });

  test("Régie PC (cedric, 24/10) : Chante le mot ! se construit comme le Quiz : 🎲 au nombre de mots choisi, un mot écrit à la main, « Chante le mot ! complet » (↑ ↓ ✕ 🔀) ; jamais de manche ; un mot déjà dans la fête en rouge, mais possible", async () => {
    const { buildSnapshot } = await import("../web/public/show.js");
    const { CHANTE_WORDS } = await import("../web/public/buzz-cards.js");
    const petits = new Set(CHANTE_WORDS.filter((w) => w.level === 1).map((w) => w.word));
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
    // Une prestation d'avant les séries : ses mots choisis un par un (« soleil » tiré au hasard, « lune » à la main).
    await seedLibrary("shows", { malo: { childName: "Malo", age: 9, date: day(10), status: "publiee", updatedAt: 1,
      rounds: [{ type: "chante", count: 6, picks: ["soleil", "lune"], hasard: ["soleil"] }] } });
    const page = await admin();
    await page.click('#screen-home [data-etat="avenir"]');
    await page.locator('#show-list [data-show="malo"]').getByRole("button", { name: "Ouvrir" }).click();
    const vieux = page.locator('#show-rounds .jeu-bloc[data-jeu="chante"]');
    await vieux.locator(".jeu-replier").click();
    assert.deepEqual(await vieux.locator(".quiz-series .serie-voir").allTextContents(), ["▸ 🎲 1 mot tiré au hasard", "▸ ✍ 1 mot écrit à la main"]);
    assert.equal(await vieux.locator(".round-head > .quiz-compteur").textContent(), "2 mots");

    await page.click("#nav button[data-screen=home]");
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await page.fill("#show-age", "7");
    await ajouterJeu(page, "chante");
    const bloc = page.locator('#show-rounds .jeu-bloc[data-jeu="chante"]');
    const round = bloc.locator(".round");
    const compteur = round.locator(".round-head > .quiz-compteur");
    const series = round.locator(".quiz-series > li.serie");
    // Pas de manche (cedric, 24/10) : ni « 1 manche », ni « ＋ Manche » ; le nombre de mots, c'est le nombre de tours.
    assert.equal(await bloc.locator(".jeu-plus").count(), 0);
    assert.equal(await bloc.locator(".jeu-nb").count(), 0);
    assert.equal(await compteur.textContent(), "Aucun mot pour l'instant : la TV en tirera 6 au hasard");
    assert.deepEqual(await round.locator(".quiz-outils > *").evaluateAll((xs) => xs.map((x) => x.className)), ["tirage-ligne", "quiz-ajouts mots-main"]);
    assert.equal(await round.locator(".mots-main-titre").textContent(), "✍ Écrire un mot à la main");

    // Le 🎲 : 4 mots pour les petits (Zoé, 7 ans).
    await round.locator(".tirage-nombre").selectOption("4");
    await round.locator(".tirage-de").click();
    await compteur.filter({ hasText: "4 mots" }).waitFor();
    assert.equal(await series.nth(0).locator(".serie-voir").textContent(), "▾ 🎲 4 mots tirés au hasard");
    const tires = await series.nth(0).locator(".serie-liste .tirage-texte").allTextContents();
    assert.equal(tires.length, 4);
    for (const w of tires) assert.ok(petits.has(w), w);

    // Un mot écrit à la main (Entrée), à la fin ; un mot déjà dans ce jeu ne s'ajoute pas.
    await round.locator(".mots-ecrire").fill("Arc-en-ciel");
    await round.locator(".mots-ecrire").press("Enter");
    await compteur.filter({ hasText: "5 mots" }).waitFor();
    assert.equal(await series.nth(1).locator(".serie-voir").textContent(), "▾ ✍ 1 mot écrit à la main");
    assert.equal(await round.locator(".mots-ecrire").inputValue(), "");
    await round.locator(".mots-ecrire").fill(tires[1].toUpperCase());
    await round.locator(".mots-ajouter").click();
    await page.locator("#annonce", { hasText: `« ${tires[1].toUpperCase()} » est déjà dans ce jeu.` }).waitFor();
    assert.equal(await compteur.textContent(), "5 mots");
    await round.locator(".mots-ecrire").fill("");

    // ✕ au 🎲 : un 🎲 prend sa place, il tire un autre mot.
    await series.nth(0).locator(".serie-liste .tirage-retirer").first().click();
    await compteur.filter({ hasText: "4 mots" }).waitFor();
    assert.equal(await series.nth(0).locator(".serie-voir").textContent(), "▾ 🎲 3 mots tirés au hasard, 1 à tirer");
    await series.nth(0).locator(".serie-liste li.vide .tirage-de").click();
    await compteur.filter({ hasText: "5 mots" }).waitFor();
    const tires2 = await series.nth(0).locator(".serie-liste .tirage-texte").allTextContents();
    assert.ok(!tires2.includes(tires[0]), "le mot retiré ne revient pas");

    // « Chante le mot ! complet » : les mots du 🎲 puis celui écrit à la main ; ↓ ; 🔀.
    const complet = round.locator(".quiz-complet");
    assert.equal(await complet.locator(".quiz-complet-voir").textContent(), "▸ 🧩 Chante le mot ! complet : 5 mots, dans l'ordre de passage");
    await complet.locator(".quiz-complet-voir").click();
    const ordre = () => complet.locator(".quiz-complet-q .tirage-texte").allTextContents();
    assert.deepEqual(await ordre(), [...tires2, "Arc-en-ciel"]);
    await complet.locator(".quiz-complet-q").nth(0).locator(".quiz-complet-descendre").click();
    await waitFor(async () => (await ordre()).join() === [tires2[1], tires2[0], ...tires2.slice(2), "Arc-en-ciel"].join(), "le premier passe en 2e");
    const avant = await ordre();
    await complet.locator(".quiz-melanger").click();
    await waitFor(async () => (await ordre()).join() !== avant.join(), "mélangés");
    assert.deepEqual([...await ordre()].sort(), [...avant].sort());
    const joues = await ordre();

    // Un second Chante le mot ! plus loin : son 🎲 ne reprend aucun mot du premier ; un mot écrit à la main déjà dans
    // la fête : en rouge, mais ajouté (« Jamais deux fois »).
    await ajouterJeu(page, "coffres");
    await ajouterJeu(page, "chante");
    const second = page.locator("#show-rounds .round").nth(2);
    await second.locator(".tirage-nombre").selectOption("20");
    await second.locator(".tirage-de").click();
    await second.locator(".round-head > .quiz-compteur", { hasText: "20 mots" }).waitFor();
    await second.locator('.quiz-series > li.serie[data-origine="de"] .serie-voir').click();
    for (const w of await second.locator(".quiz-series .serie-liste .tirage-texte").allTextContents()) assert.ok(!joues.includes(w), `déjà dans le premier : ${w}`);
    await second.locator(".mots-ecrire").fill("Arc-en-ciel");
    await second.locator(".mots-ajouter").click();
    await second.locator(".round-head > .quiz-compteur", { hasText: "21 mots" }).waitFor();
    const deja = second.locator('.quiz-series > li.serie[data-origine="main"] .serie-liste li.deja');
    assert.equal(await deja.locator(".mot-deja").textContent(), "Déjà dans « Chante le mot ! »");
    await capture(page, "chante-le-mot");

    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const zoe = Object.values(await library("shows")).find((x) => x.childName === "Zoé");
    assert.deepEqual(zoe.rounds.map((r) => r.type), ["chante", "coffres", "chante"]);
    const [chante] = zoe.rounds;
    assert.deepEqual(chante.seriesMots.map((x) => [x.origine, x.mots.length]), [["de", 4], ["main", 1]]);
    assert.equal(chante.picks, undefined);
    assert.equal(chante.ordreMots.length, 5);
    // Sur la TV : les mots dans l'ordre du « complet ».
    const { snapshot, problems } = buildSnapshot("zoe", zoe, {});
    assert.deepEqual(problems, []);
    assert.deepEqual(snapshot.quiz.questions.filter((q) => q.kind === "chante").map((q) => q.text).slice(0, 5), joues);
    // La prestation d'avant se joue toujours avec ses mots.
    const malo = (await library("shows")).malo;
    assert.deepEqual(buildSnapshot("malo", malo, {}).snapshot.quiz.questions.map((q) => q.text), ["soleil", "lune"]);
    await page.context().close();
  });

  test("Régie PC (cedric, 24/10) : Qui suis-je ? se construit comme le Quiz : 🎲, les personnages d'un ancien anniversaire, une de vos séries, chacun avec sa petite image ; « Qui suis-je ? complet » (↑ ↓ ✕ 🔀)", async () => {
    const { buildSnapshot } = await import("../web/public/show.js");
    const PNG = `data:image/png;base64,${png([200, 40, 90]).toString("base64")}`;
    const ELSA = "00000000000000e1";
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
    await seedLibrary("images", { [ELSA]: PNG });
    // Une série « Disney » dans la bibliothèque (Elsa avec son image) ; un anniversaire archivé avec son Qui suis-je ?.
    await seedLibrary("contents/quisuis", {
      extra: [
        { answer: "Elsa", emoji: "❄️", clues: ["Je suis reine", "Je fais de la glace", "Libérée, délivrée"], serie: "Disney" },
        { answer: "Simba", emoji: "🦁", clues: ["Mon père est Mufasa", "Je deviens roi"], serie: "Disney" },
      ],
      images: { elsa: ELSA },
    });
    await seedLibrary("shows", { malo: { childName: "Malo", age: 9, date: day(-20), status: "publiee", updatedAt: 1,
      rounds: [{ type: "quisuis", seriesMots: [{ id: "de", origine: "de", mots: [
        { answer: "Le pirate", emoji: "🏴‍☠️", clues: ["J'ai un bateau", "Je cherche un trésor"] },
        { answer: "La fée", emoji: "🧚", clues: ["J'ai une baguette", "Je vole avec mes ailes"] }] }] }] } });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await page.fill("#show-age", "9");
    await ajouterJeu(page, "quisuis");
    const round = page.locator('#show-rounds .jeu-bloc[data-jeu="quisuis"] .round');
    const compteur = round.locator(".round-head > .quiz-compteur");
    const series = round.locator(".quiz-series > li.serie");
    assert.equal(await compteur.textContent(), "Aucun personnage pour l'instant : la TV en tirera 5 au hasard");
    // Les outils : le 🎲, un ancien anniversaire, une de vos séries ; pas de personnage écrit ici (il lui faut ses indices).
    assert.deepEqual(await round.locator(".quiz-outils > *").evaluateAll((xs) => xs.map((x) => x.className)), ["tirage-ligne", "quiz-ajouts quiz-rappel", "quiz-ajouts quiz-biblio"]);
    assert.equal(await round.locator(".quiz-rappel-titre").textContent(), "📚 Rappeler les personnages d'un ancien anniversaire");
    assert.equal(await round.locator(".quiz-biblio-titre").textContent(), "📗 Intégrer une de vos séries de Qui suis-je ?");

    // Un ancien anniversaire : tous ses personnages, en une série.
    await round.locator(".quiz-rappel-cherche").fill("mal");
    await round.locator('.quiz-rappel-item[data-show="malo"]').click();
    await compteur.filter({ hasText: "2 personnages" }).waitFor();
    assert.match(await series.nth(0).locator(".serie-voir").textContent(), /^▾ 📅 Anniversaire de Malo \(.+\) : 2 personnages$/);
    // Une de vos séries : avec l'image d'Elsa, celle de la révélation ; Simba avec son émoji.
    await round.locator(".quiz-biblio-cherche").fill("dis");
    await round.locator('.quiz-biblio-item[data-serie="Disney"]').click();
    await compteur.filter({ hasText: "4 personnages" }).waitFor();
    const disney = series.nth(1);
    assert.equal(await disney.locator(".serie-voir").textContent(), "▾ 📚 Série « Disney » : 2 personnages");
    await waitFor(async () => (await disney.locator('[data-mot="elsa"] img.tirage-mini').getAttribute("src")) === PNG, "la petite image d'Elsa");
    assert.equal(await disney.locator('[data-mot="simba"] .tirage-mini.emoji').textContent(), "🦁");
    assert.equal(await disney.locator('[data-mot="elsa"] .mot-indices').textContent(), "Je suis reine · Je fais de la glace · Libérée, délivrée");
    // Déjà là : la même série ne s'ajoute pas deux fois.
    await round.locator(".quiz-biblio-cherche").fill("dis");
    assert.match(await round.locator('.quiz-biblio-item[data-serie="Disney"]').textContent(), /✓ déjà dans ce jeu/);
    await round.locator('.quiz-biblio-item[data-serie="Disney"]').click();
    await page.locator("#annonce", { hasText: "Tous ces personnages sont déjà dans Qui suis-je ?." }).waitFor();

    // Le 🎲 : 3 personnages, aucun de ceux déjà là ; tirés au hasard, jamais une image téléversée.
    await round.locator(".tirage-nombre").selectOption("3");
    await round.locator(".tirage-de").click();
    await compteur.filter({ hasText: "7 personnages" }).waitFor();
    const de = round.locator('.quiz-series > li.serie[data-origine="de"]');
    assert.equal(await de.locator(".serie-voir").textContent(), "▾ 🎲 3 personnages tirés au hasard");
    assert.equal(await de.locator(".serie-liste img").count(), 0);
    const tires = await de.locator(".serie-liste .tirage-q").evaluateAll((xs) => xs.map((x) => x.dataset.mot));
    for (const cle of ["le pirate", "la fée", "elsa", "simba"]) assert.ok(!tires.includes(cle), cle);

    // « Qui suis-je ? complet » : le 🎲 d'abord, puis les séries ajoutées ; ↓, ✕ et 🔀 ; la petite image aussi.
    const complet = round.locator(".quiz-complet");
    assert.equal(await complet.locator(".quiz-complet-voir").textContent(), "▸ 🧩 Qui suis-je ? complet : 7 personnages, dans l'ordre de passage");
    await complet.locator(".quiz-complet-voir").click();
    const ordre = () => complet.locator(".quiz-complet-q").evaluateAll((xs) => xs.map((x) => x.dataset.mot));
    assert.deepEqual(await ordre(), [...tires, "le pirate", "la fée", "elsa", "simba"]);
    await complet.locator('.quiz-complet-q[data-mot="elsa"] img.tirage-mini').waitFor();
    await complet.locator('.quiz-complet-q[data-mot="la fée"] .tirage-retirer').click();
    await compteur.filter({ hasText: "6 personnages" }).waitFor();
    await complet.locator(".quiz-complet-q").nth(0).locator(".quiz-complet-descendre").click();
    await waitFor(async () => (await ordre()).join() === [tires[1], tires[0], tires[2], "le pirate", "elsa", "simba"].join(), "le premier passe en 2e");
    const avant = await ordre();
    await complet.locator(".quiz-melanger").click();
    await waitFor(async () => (await ordre()).join() !== avant.join(), "mélangés");
    const joues = await ordre();
    await capture(page, "qui-suis-je");

    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const zoe = Object.values(await library("shows")).find((x) => x.childName === "Zoé");
    const [qs] = zoe.rounds;
    assert.deepEqual(qs.seriesMots.map((x) => [x.origine, x.mots.length]), [["de", 3], ["reprise", 1], ["biblio", 2]]);
    assert.equal(qs.seriesMots[2].titre, "Disney");
    assert.equal(qs.seriesMots[2].mots.find((m) => m.answer === "Elsa").imageId, ELSA);
    // Sur la TV : dans l'ordre du « complet », Elsa avec son image, chacun avec ses indices.
    const { snapshot, problems } = buildSnapshot("zoe", zoe, {});
    assert.deepEqual(problems, []);
    const questions = snapshot.quiz.questions.filter((q) => q.kind === "quisuis");
    assert.deepEqual(questions.map((q) => q.choices[0].toLowerCase()), joues);
    const elsa = questions.find((q) => q.choices[0] === "Elsa");
    assert.equal(elsa.imageId, ELSA);
    assert.deepEqual(elsa.cards.map((c) => c.word), ["Je suis reine", "Je fais de la glace", "Libérée, délivrée"]);
    await page.context().close();
  });

  test("Régie PC (cedric, 24/10) : les séries de Qui suis-je ? dans la page du jeu : à la main (champ « Série ») ou en JSON, renommées ou supprimées d'un coup", async () => {
    const page = await admin();
    await openGamePage(page, "quisuis", "collections");
    // À la main : la série reste choisie pour le personnage suivant.
    await page.fill("#bi-answer", "Elsa");
    await page.fill("#bi-emoji", "❄️");
    await page.fill("#bi-serie", "Disney");
    await page.fill("#bi-clue1", "Je suis reine");
    await page.fill("#bi-clue2", "Je fais de la glace");
    await page.click("#builtin-add button[type=submit]");
    await page.locator("#builtin-status", { hasText: "« ❄️ Elsa » est ajouté à la série « Disney »." }).waitFor();
    assert.equal(await page.inputValue("#bi-serie"), "Disney");
    assert.equal(await page.inputValue("#bi-answer"), "");
    const titre = (nom) => page.locator(`#builtin-items .serie-biblio[data-serie="${nom}"] h3`);
    assert.equal(await titre("Disney").textContent(), "📚 Série « Disney » · 1 personnage");
    // En JSON : une série par fichier ; un personnage sans assez d'indices est laissé, un déjà là aussi.
    const fichier = { name: "heros.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
      serie: "Super-héros",
      personnages: [
        { reponse: "Spider-Man", emoji: "🕷️", indices: ["Je grimpe aux murs", "Une araignée m'a piqué", "Je lance des toiles"] },
        { reponse: "Batman", emoji: "🦇", indices: ["Je vis à Gotham", "Je porte une cape"] },
        { reponse: "Hulk", indices: ["Je suis vert"] },
        { reponse: "Elsa", indices: ["Je suis reine", "Je fais de la glace"] },
      ],
    })) };
    await page.locator("#bi-json").setInputFiles(fichier);
    await page.locator("#builtin-status", { hasText: "2 personnages ajoutés (série « Super-héros ») ; 1 personnage était déjà dans le jeu ; 1 personnage ignoré (il faut sa réponse et au moins 2 indices)." }).waitFor();
    assert.equal(await titre("Super-héros").textContent(), "📚 Série « Super-héros » · 2 personnages");
    let extra = (await library("contents")).quisuis.extra;
    assert.deepEqual(extra.map((x) => [x.answer, x.serie]), [["Elsa", "Disney"], ["Spider-Man", "Super-héros"], ["Batman", "Super-héros"]]);
    // Une simple liste : sa série prend le nom du fichier.
    await page.locator("#bi-json").setInputFiles({ name: "Animaux.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify([
      { answer: "Le panda", emoji: "🐼", clues: ["Je mange du bambou", "Je suis noir et blanc"] }])) });
    await page.locator("#builtin-status", { hasText: "1 personnage ajouté (série « Animaux »)." }).waitFor();
    // Un fichier illisible : dit.
    await page.locator("#bi-json").setInputFiles({ name: "casse.json", mimeType: "application/json", buffer: Buffer.from("{ pas du json") });
    await page.locator("#builtin-status", { hasText: "« casse.json » n'est pas un fichier JSON valable." }).waitFor();

    // Renommer, supprimer d'un coup (fenêtres du site).
    await page.locator('#builtin-items .serie-biblio[data-serie="Super-héros"]').getByRole("button", { name: "Renommer" }).click();
    await page.locator(".fenetre input").fill("Héros");
    await page.locator(".fenetre").getByRole("button", { name: "Renommer" }).click();
    await page.locator("#builtin-status", { hasText: "Série « Super-héros » renommée « Héros »." }).waitFor();
    await titre("Héros").waitFor();
    await page.locator('#builtin-items .serie-biblio[data-serie="Animaux"]').getByRole("button", { name: "Supprimer la série" }).click();
    await page.locator(".fenetre", { hasText: "Supprimer la série « Animaux » et son personnage ?" }).waitFor();
    await page.locator(".fenetre").getByRole("button", { name: "Supprimer" }).click();
    await page.locator("#builtin-status", { hasText: "Série « Animaux » supprimée." }).waitFor();
    extra = (await library("contents")).quisuis.extra;
    assert.deepEqual(extra.map((x) => [x.answer, x.serie]), [["Elsa", "Disney"], ["Spider-Man", "Héros"], ["Batman", "Héros"]]);
    assert.equal(await page.locator('#builtin-items .serie-biblio[data-serie="Animaux"]').count(), 0);
    await capture(page, "qui-suis-je-series");
    await page.context().close();
  });

  test("Régie PC (cedric, 24/10) : Qui a disparu ? se construit comme le Quiz : 🎲 des grilles d'émojis, une grille composée avec vos images, des grilles de photos libres, chacune avec ses objets en petit ; « Qui a disparu ? complet » (↑ ↓ ✕ 🔀)", async () => {
    const { buildSnapshot } = await import("../web/public/show.js");
    const PNG = `data:image/png;base64,${png([40, 160, 90]).toString("base64")}`;
    const MES = ["a1", "a2", "a3", "a4", "a5", "a6"].map((x) => x.padStart(16, "0"));
    const NOMS = ["Doudou", "Vélo", "Ballon", "Tortue", "Cabane", "Gâteau"];
    await seedLibrary("images", Object.fromEntries(MES.map((id) => [id, PNG])));
    await seedLibrary("medias", Object.fromEntries(MES.map((id, k) => [id, { name: NOMS[k], cat: "Maison", createdAt: 1, updatedAt: 1 }])));
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await page.fill("#show-age", "9");
    await ajouterJeu(page, "disparu");
    const round = page.locator('#show-rounds .jeu-bloc[data-jeu="disparu"] .round');
    const compteur = round.locator(".round-head > .quiz-compteur");
    assert.equal(await compteur.textContent(), "Aucune grille pour l'instant : la TV en tirera 4 au hasard");
    // Un jeu encore vide se voit en haut de la page (cedric, 24/10), en simple alerte : la TV le remplira au hasard.
    await page.locator("#show-ready li.ready-alerte", { hasText: "⚠ Qui a disparu ? : aucune grille choisie pour l'instant, la TV en tirera 4 au hasard." }).waitFor();
    // Les outils : le 🎲 seul sur sa ligne, puis vos images, puis les photos libres.
    assert.deepEqual(await round.locator(".quiz-outils > *").evaluateAll((xs) => xs.map((x) => x.className)), ["tirage-ligne", "quiz-ajouts vos-images grille-images", "quiz-ajouts disparu-photos"]);

    // Le 🎲 : 3 grilles d'émojis de 7 objets (9 ans).
    await round.locator(".quiz-outils > .tirage-ligne .tirage-nombre").selectOption("3");
    await round.locator(".quiz-outils > .tirage-ligne .tirage-de").click();
    await compteur.filter({ hasText: "3 grilles" }).waitFor();
    await waitFor(async () => !(await page.locator("#show-ready li.ready-alerte").count()), "plus d'alerte une fois des grilles tirées");
    const de = round.locator('.quiz-series > li.serie[data-origine="de"]');
    assert.equal(await de.locator(".serie-voir").textContent(), "▾ 🎲 3 grilles tirées au hasard (émojis)");
    const grillesDe = de.locator(".serie-liste .tirage-q");
    assert.equal(await grillesDe.count(), 3);
    for (let k = 0; k < 3; k++) assert.equal(await grillesDe.nth(k).locator(".grille-vignette.emoji").count(), 7);

    // Une grille avec vos images : de 5 à 12 cochées.
    await round.locator(".grille-images-titre").click();
    const ajouter = round.locator(".grille-images-ajouter");
    assert.equal(await ajouter.textContent(), "Cochez de 5 à 12 images (0)");
    assert.equal(await ajouter.isDisabled(), true);
    for (const id of MES.slice(0, 5)) await round.locator(`.vos-images-tuile[data-image="${id}"]`).click();
    assert.equal(await ajouter.textContent(), "＋ Faire une grille avec ces 5 images");
    await ajouter.click();
    await compteur.filter({ hasText: "4 grilles" }).waitFor();
    const vos = round.locator('.quiz-series > li.serie[data-origine="images"]');
    assert.equal(await vos.locator(".serie-voir").textContent(), "▾ ⭐ 1 grille de vos images");
    await vos.locator('[data-mot="vos images 1"] img.grille-vignette').nth(4).waitFor();
    assert.equal(await vos.locator('[data-mot="vos images 1"] img.grille-vignette').count(), 5);

    // Les photos libres : 2 grilles, une famille de photos chacune.
    await round.locator(".disparu-photos-nombre").selectOption("2");
    await round.locator(".disparu-photos-de").click();
    await compteur.filter({ hasText: "6 grilles" }).waitFor();
    const libres = round.locator('.quiz-series > li.serie[data-origine="photos"]');
    assert.equal(await libres.locator(".serie-voir").textContent(), "▾ 📷 2 grilles de photos libres");
    const themes = await libres.locator(".serie-liste .tirage-q").evaluateAll((xs) => xs.map((x) => x.dataset.mot));
    for (const t of themes) assert.match(t, /^photos · /);
    assert.equal(await libres.locator(".serie-liste .tirage-q").first().locator('img.grille-vignette[src^="banque/"]').count(), 7);
    // ✕ : un 🎲 prend sa place, il tire une autre famille de photos.
    await libres.locator(".serie-liste .tirage-retirer").first().click();
    await compteur.filter({ hasText: "5 grilles" }).waitFor();
    assert.equal(await libres.locator(".serie-voir").textContent(), "▾ 📷 1 grille de photos libres, 1 à tirer");
    await libres.locator(".serie-liste li.vide .tirage-de").click();
    await compteur.filter({ hasText: "6 grilles" }).waitFor();
    const themes2 = await libres.locator(".serie-liste .tirage-q").evaluateAll((xs) => xs.map((x) => x.dataset.mot));
    assert.ok(!themes2.includes(themes[0]), "la famille retirée ne revient pas");
    for (const t of themes2) assert.match(t, /^photos · /);

    // « Qui a disparu ? complet » : les 6 grilles, ↓, 🔀.
    const complet = round.locator(".quiz-complet");
    assert.equal(await complet.locator(".quiz-complet-voir").textContent(), "▸ 🧩 Qui a disparu ? complet : 6 grilles, dans l'ordre de passage");
    await complet.locator(".quiz-complet-voir").click();
    const ordre = () => complet.locator(".quiz-complet-q").evaluateAll((xs) => xs.map((x) => x.dataset.mot));
    const avant = await ordre();
    assert.equal(avant.length, 6);
    const descendu = [avant[1], avant[0], ...avant.slice(2)];
    await complet.locator(".quiz-complet-q").nth(0).locator(".quiz-complet-descendre").click();
    await waitFor(async () => (await ordre()).join() === descendu.join(), "la première passe en 2e");
    await complet.locator(".quiz-melanger").click();
    await waitFor(async () => (await ordre()).join() !== descendu.join(), "mélangées");
    const joues = await ordre();
    await capture(page, "qui-a-disparu");

    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const zoe = Object.values(await library("shows")).find((x) => x.childName === "Zoé");
    const [qd] = zoe.rounds;
    assert.deepEqual(qd.seriesMots.map((x) => [x.origine, x.mots.length]), [["de", 3], ["images", 1], ["photos", 2]]);
    assert.deepEqual(qd.seriesMots[1].mots[0].objects.map((o) => [o.word, o.imageId]), NOMS.slice(0, 5).map((w, k) => [w, MES[k]]));
    assert.ok(qd.seriesMots[2].mots.every((g) => g.objects.every((o) => o.banque)), "photos libres gardées");
    // Sur la TV : chaque grille telle quelle, dans l'ordre du « complet ».
    const { snapshot, problems } = buildSnapshot("zoe", zoe, {});
    assert.deepEqual(problems, []);
    const questions = snapshot.quiz.questions.filter((q) => q.kind === "disparu");
    assert.equal(questions.length, 6);
    const parTheme = new Map(qd.seriesMots.flatMap((x) => x.mots).map((g) => [g.theme.toLowerCase(), g]));
    questions.forEach((q, k) => {
      const g = parTheme.get(joues[k]);
      assert.deepEqual(q.cards.map((c) => c.word).sort(), g.objects.map((o) => o.word).sort());
      assert.ok(g.objects.some((o) => o.word === q.choices[0]), "l'objet qui disparaît est dans sa grille");
    });
    await page.context().close();
  });

  test("Régie PC (cedric, 24/10) : le Pictionary comme les autres jeux : mots proposés, passages par équipe et 🎲 (émoji et vraie photo de chaque mot), un passage à la main pour une équipe, ✕ laisse un 🎲 ; la TV reçoit les passages de chaque équipe", async () => {
    const { buildSnapshot } = await import("../web/public/show.js");
    const MIEN = "7777777777777777";
    await seedLibrary("images", { [MIEN]: `data:image/png;base64,${png([200, 60, 90]).toString("base64")}` });
    await seedLibrary("medias", { [MIEN]: { name: "Doudou", cat: "Maison", createdAt: 1, updatedAt: 1 } });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Noé");
    await page.fill("#show-age", "9");
    await ajouterJeu(page, "pictionary");
    const round = page.locator('#show-rounds .jeu-bloc[data-jeu="pictionary"] .round');
    const compteur = round.locator(".round-head > .quiz-compteur");
    assert.equal(await compteur.textContent(), "Aucun mot pour l'instant : touchez 🎲");
    await page.locator("#show-ready li.ready-alerte", { hasText: "⚠ Pictionary : aucun mot choisi pour l'instant, la TV les tirera au hasard." }).waitFor();
    // La première ligne : mots proposés, passages par équipe, temps de dessin, 🎲 ; la deuxième : à la main, par équipe.
    assert.deepEqual(await round.locator(".quiz-outils > *").evaluateAll((xs) => xs.map((x) => x.className)), ["tirage-ligne", "quiz-ajouts picto-main"]);
    assert.deepEqual(await round.locator(".picto-main-equipe").evaluateAll((xs) => xs.map((x) => x.dataset.couleur)), ["Rose", "Orange", "Vert", "Jaune"]);

    // 🎲 : 2 mots proposés, 3 passages pour chacune des 4 équipes.
    await round.locator(".picto-propositions").selectOption("2");
    await round.locator(".picto-nb-passages").selectOption("3");
    await round.locator(".picto-de").click();
    await compteur.filter({ hasText: "4 équipes · 12 passages · 24 mots" }).waitFor();
    await waitFor(async () => !(await page.locator("#show-ready li.ready-alerte").count()), "plus d'alerte");
    assert.deepEqual(await round.locator(".picto-equipe").evaluateAll((xs) => xs.map((x) => x.dataset.couleur)), ["Rose", "Orange", "Vert", "Jaune"]);
    const rose = round.locator('.picto-equipe[data-couleur="Rose"]');
    assert.equal(await rose.locator(".picto-nombre").textContent(), "3 passages");
    await rose.locator(".mime-deplier").click();
    await rose.locator(".picto-passage").nth(2).waitFor();
    // Chaque mot : l'émoji de la tablette et la vraie photo de la TV, jamais deux fois le même.
    const mots = rose.locator(".picto-mot:not(.vide)");
    assert.equal(await mots.count(), 6);
    for (let k = 0; k < 6; k++) {
      assert.ok((await mots.nth(k).locator(".picto-emoji").textContent()).trim(), "émoji");
      assert.match(await mots.nth(k).locator("img.tirage-photo").getAttribute("src"), /^banque\//);
    }
    // ✕ : un 🎲 prend sa place, il tire un autre mot.
    const premier = await mots.first().getAttribute("data-mot");
    await mots.first().locator(".tirage-retirer").click();
    await compteur.filter({ hasText: "23 mots · 1 à tirer" }).waitFor();
    await rose.locator(".picto-mot.vide .tirage-de").click();
    await compteur.filter({ hasText: "· 24 mots" }).waitFor();
    assert.notEqual(await rose.locator(".picto-mot").first().getAttribute("data-mot"), premier, "le mot retiré ne revient pas");

    // À la main pour l'équipe Verte : 3 images, 2 par passage, donc 2 passages de plus.
    await round.locator('.picto-main-equipe[data-couleur="Vert"]').click();
    const choix = page.locator(".choix-boite");
    await choix.waitFor();
    assert.equal(await choix.locator(".label").textContent(), "🖼️ Mots à dessiner pour l'équipe Vert (2 par passage)");
    await choix.locator('.chip[data-groupe="photos"]').click();
    await choix.locator(".choix-recherche").fill("chat");
    await choix.locator('.media-tile[data-media="banque:chat"]').click();
    await choix.locator(".choix-recherche").fill("chien");
    await choix.locator('.media-tile[data-media="banque:chien"]').click();
    await choix.locator('.chip[data-groupe="miennes"]').click();
    await choix.locator(".choix-recherche").fill("");
    await choix.locator(`.media-tile[data-media="${MIEN}"]`).click();
    await choix.locator(".choix-ajouter", { hasText: "(3)" }).click();
    await compteur.filter({ hasText: "4 équipes · 14 passages · 27 mots" }).waitFor();
    const vert = round.locator('.picto-equipe[data-couleur="Vert"]');
    assert.equal(await vert.locator(".picto-nombre").textContent(), "5 passages");
    assert.deepEqual(await vert.locator(".picto-passage").nth(3).locator(".picto-mot").evaluateAll((xs) => xs.map((x) => x.dataset.mot)), ["chat", "chien"]);
    assert.deepEqual(await vert.locator(".picto-passage").nth(4).locator(".picto-mot").evaluateAll((xs) => xs.map((x) => x.dataset.mot)), ["doudou"]);
    // Un passage se retire d'un coup.
    await vert.locator(".picto-passage").nth(4).locator(".picto-passage-retirer").click();
    await compteur.filter({ hasText: "4 équipes · 13 passages · 26 mots" }).waitFor();
    await capture(page, "pictionary");

    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const noe = Object.values(await library("shows")).find((x) => x.childName === "Noé");
    const [pr] = noe.rounds;
    assert.equal(pr.propositions, 2);
    assert.equal(pr.passages, 3);
    assert.deepEqual(pr.tours.map((ps) => ps.length), [3, 3, 4, 3]);
    assert.ok(pr.tours.flat(2).every((m) => m.banque && m.image), "émoji et photo libre pour chaque mot");
    assert.equal(pr.picks, undefined);
    // Sur la TV : les mots dans l'ordre des passages, équipe après équipe ; chaque équipe a ses passages.
    const { snapshot, problems } = buildSnapshot("noe", noe, {});
    assert.deepEqual(problems, []);
    const [q] = snapshot.quiz.questions.filter((x) => x.kind === "pictionary");
    assert.equal(q.propositions, 2);
    assert.equal(q.passages, 4);
    assert.equal(q.cards.length, 26);
    assert.deepEqual(q.offres.map((ps) => ps.length), [3, 3, 4, 3]);
    assert.deepEqual(q.offres.map((ps) => ps[0]), [[0, 1], [2, 3], [4, 5], [6, 7]], "1er passage de chaque équipe, dans l'ordre des couleurs");
    assert.deepEqual(q.offres[0].flat().map((k) => q.cards[k].word), pr.tours[0].flat().map((m) => m.word));
    assert.ok(q.cards.every((c) => c.banque && c.image));
    await page.context().close();
  });

  test("Régie PC (cedric, 23/10) : le Vrai ou Faux express se construit comme le Quiz : 🎲 dans le Vrai ou Faux tout prêt (autant de vraies que de fausses, au niveau du profil), un ancien anniversaire, les Vrai / Faux de ses quiz, « Vrai ou Faux complet », jamais deux fois la même affirmation", async () => {
    const { buildSnapshot } = await import("../web/public/show.js");
    const { AFFIRMATIONS } = await import("../web/public/banque-vrai-faux.js");
    const moyennes = new Map(AFFIRMATIONS.filter((x) => x.niveau === 2).map((x) => [x.text, x]));
    const vf = (text, vrai) => ({ text, choices: ["Vrai", "Faux"], correct: vrai ? 0 : 1, status: "validee" });
    const SCIENCES = { title: "Sciences", source: "tableur", updatedAt: 1, questions: [
      vf("Le Soleil est une étoile", true), { text: "Planète la plus proche ?", choices: ["Mercure", "Mars", "Vénus", "Terre"], correct: 0, status: "validee" }, vf("Les poissons volent", false)] };
    const LUNA = { childName: "Luna", age: 9, date: "2026-05-10", status: "archivee", updatedAt: 1, rounds: [{ type: "express", quizId: "sciences" }, { type: "quiz", quizId: "animaux" }] };
    await seedLibrary("quizzes", { animaux: ANIMAUX, sciences: SCIENCES });
    await seedLibrary("shows", { luna: LUNA });
    const page = await admin();
    // Bibliothèque › Questions : la rubrique « ✅ Vrai ou Faux tout prêt », par niveau, sans alerte d'illustration.
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="questions"]');
    await page.locator('#q-groups [data-groupe="vraifaux"]', { hasText: `✅ Vrai ou Faux tout prêt (${AFFIRMATIONS.length})` }).click();
    await page.locator('.q-niveaux [data-niveau="2"]', { hasText: `Moyen · 9 à 11 ans (${moyennes.size})` }).click();
    await waitFor(async () => await page.locator("#q-list .q-item").count() === moyennes.size, "les affirmations du niveau Moyen");
    assert.equal(await page.locator("#q-list .q-item.sans-illus").count(), 0);
    const lune = page.locator("#q-list .q-item", { hasText: "La Lune produit sa propre lumière." });
    assert.equal(await lune.locator(".q-reponses li.juste").innerText(), "✓ Faux");

    await page.click("#nav button[data-screen=home]");
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await page.fill("#show-age", "10");
    await ajouterJeu(page, "express");
    const round = page.locator("#show-rounds .round").nth(0);
    const ligne = round.locator(".quiz-outils > .tirage-ligne");
    const compteur = round.locator(".round-head > .quiz-compteur");
    const series = round.locator(".quiz-series > li.serie");
    // Comme le Quiz, avec des affirmations : sa Super Finale en dernière ligne (3 dernières, ×2 d'office), pas de bougies.
    assert.deepEqual(await round.locator(".round-head > *").evaluateAll((xs) => xs.map((x) => x.className)), ["num", "quiz-compteur"]);
    assert.deepEqual(await round.locator(".round-body > *").evaluateAll((xs) => xs.map((x) => x.className)), ["quiz-outils", "quiz-finale"]);
    assert.equal(await round.locator(".quiz-finale .finale-oui").inputValue(), "oui");
    assert.equal(await round.locator(".quiz-finale select.finale").inputValue(), "3");
    assert.equal(await round.locator(".quiz-finale select.finale option:checked").textContent(), "Les 3 dernières affirmations");
    assert.equal(await round.locator(".quiz-finale .finale-facteur").inputValue(), "2");
    assert.deepEqual(await ligne.locator(":scope > *").evaluateAll((xs) => xs.map((x) => x.className)), ["tirage-profil", "tirage-nombre", "btn tirage-de"]);
    assert.equal(await ligne.locator(".tirage-profil").inputValue(), "MOYENS", "le profil de l'âge de l'enfant");
    assert.equal(await round.locator(".quiz-rappel-titre").textContent(), "📚 Rappeler les affirmations d'un ancien anniversaire");
    assert.equal(await round.locator(".quiz-biblio-titre").textContent(), "📗 Intégrer un Vrai / Faux de la bibliothèque");
    assert.equal(await compteur.textContent(), "Aucune affirmation pour l'instant");

    // Un ancien anniversaire : ses affirmations, copiées.
    await round.locator(".quiz-rappel-cherche").fill("luna");
    await round.locator('.quiz-rappel-item[data-show="luna"]', { hasText: "2 affirmations" }).click();
    await series.first().waitFor();
    assert.equal(await series.nth(0).locator(".serie-voir").textContent(), "▸ 📅 Anniversaire de Luna (10 mai 2026) : 2 affirmations");
    // Ses quiz qui ont des Vrai / Faux, jamais les autres.
    await round.locator(".quiz-biblio-cherche").fill("i");
    await round.locator(".quiz-biblio-item").first().waitFor();
    assert.deepEqual(await round.locator(".quiz-biblio-item").evaluateAll((xs) => xs.map((x) => x.dataset.quiz)), ["sciences"]);
    await round.locator('.quiz-biblio-item[data-quiz="sciences"]').click();
    await series.nth(1).waitFor();
    assert.equal(await series.nth(1).locator(".serie-voir").textContent(), "▸ 📚 Vrai / Faux du quiz « Sciences » : 2 affirmations");

    // Le 🎲 : 8 affirmations du niveau Moyen, 4 vraies et 4 fausses, en tête.
    await ligne.locator(".tirage-nombre").selectOption("8");
    await ligne.locator(".tirage-de").click();
    await waitFor(async () => (await series.count()) === 3, "série du dé");
    assert.equal(await series.nth(0).locator(".serie-voir").textContent(), "▸ 🎲 8 affirmations tirées au hasard (Moyens)");
    assert.equal(await compteur.textContent(), "12 affirmations, dont 3 en Super Finale");
    await series.nth(0).locator(".serie-voir").click();
    const lignes = series.nth(0).locator(".serie-liste > li");
    const textes = async () => lignes.locator(".tirage-texte").allTextContents();
    const premier = await textes();
    assert.equal(premier.length, 8);
    for (const t of premier) assert.ok(moyennes.has(t), `niveau Moyen : ${t}`);
    assert.equal(await lignes.locator(".tirage-vf.vrai").count(), 4);
    assert.equal(await lignes.locator(".tirage-vf.faux").count(), 4);
    for (const [k, t] of premier.entries()) assert.equal(await lignes.nth(k).locator(".tirage-vf").textContent(), moyennes.get(t).vrai ? "✓ Vrai" : "✗ Faux");
    // ✕ : un 🎲 prend sa place et tire une autre affirmation.
    await lignes.nth(0).locator(".tirage-retirer").click();
    await series.nth(0).locator(".serie-liste li.vide", { hasText: "Affirmation à tirer" }).waitFor();
    assert.equal(await compteur.textContent(), "11 affirmations, dont 3 en Super Finale · 1 à tirer");
    await lignes.nth(0).locator(".tirage-de").click();
    await series.nth(0).locator(".serie-liste li.vide").waitFor({ state: "detached" });
    const second = await textes();
    assert.ok(!second.includes(premier[0]), "l'affirmation retirée ne revient pas");
    assert.equal(new Set(second).size, 8);
    assert.equal(await compteur.textContent(), "12 affirmations, dont 3 en Super Finale");

    // « Vrai ou Faux complet » : chaque affirmation dans l'ordre ; ✕ sur une affirmation la retire de sa série.
    await ajouterJeu(page, "express");
    await page.locator("#annonce", { hasText: "Le Vrai ou Faux express est déjà le dernier jeu : ajoutez-y vos affirmations" }).waitFor();
    const complet = round.locator(".quiz-complet");
    assert.equal(await complet.locator(".quiz-complet-voir").textContent(), "▸ 🧩 Vrai ou Faux complet : 12 affirmations, dans l'ordre de passage");
    await complet.locator(".quiz-complet-voir").click();
    assert.equal(await complet.locator(".quiz-complet-q .tirage-vf").count(), 12);
    // Le dernier : celui du quiz « Sciences » (celui de Luna passe avant).
    await complet.locator(".quiz-complet-q", { hasText: "Les poissons volent" }).last().locator(".tirage-retirer").click();
    await compteur.filter({ hasText: "11 affirmations" }).waitFor();
    assert.equal(await series.nth(2).locator(".serie-voir").textContent(), "▸ 📚 Vrai / Faux du quiz « Sciences » : 1 affirmation (1 retirée)");

    // Un autre Vrai ou Faux express dans la même fête : son 🎲 ne reprend aucune affirmation du premier.
    await ajouterJeu(page, "coffres");
    await ajouterJeu(page, "express");
    const autre = page.locator("#show-rounds .round").nth(2);
    await autre.locator(".tirage-nombre").selectOption("10");
    await autre.locator(".tirage-de").click();
    await autre.locator(".round-head > .quiz-compteur", { hasText: "10 affirmations" }).waitFor();
    await autre.locator(".quiz-series .serie-voir").click();
    const autres = await autre.locator(".quiz-series .serie-liste .tirage-texte").allTextContents();
    assert.equal(autres.length, 10);
    for (const t of autres) assert.ok(moyennes.has(t) && !second.includes(t), `déjà dans le premier : ${t}`);
    await capture(page, "vrai-faux-manche");

    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const shows = await library("shows");
    assert.deepEqual(shows.luna, LUNA, "La prestation archivée ne change pas");
    const zoe = Object.values(shows).find((x) => x.childName === "Zoé");
    assert.deepEqual(zoe.rounds.map((r) => r.type), ["express", "coffres", "express"]);
    const [manche] = zoe.rounds;
    assert.deepEqual(manche.seriesQuiz.map((x) => [x.origine, x.profil ?? null, x.questions?.length ?? x.quizId]),
      [["de", "MOYENS", 8], ["reprise", null, 2], ["quiz", null, "sciences"]]);
    assert.deepEqual(manche.seriesQuiz[2].sans, ["Les poissons volent"]);
    assert.equal(manche.finale, 3);
    assert.deepEqual(manche.seriesQuiz[0].questions.map((q) => q.text), second);
    await page.context().close();

    // Sur la TV : le premier jeu « Vrai ou Faux express » de 11 affirmations, dans l'ordre, ses 3 dernières en Super Finale ;
    // le second (10 affirmations) a la sienne.
    const { snapshot } = buildSnapshot("zoe", zoe, { animaux: ANIMAUX, sciences: SCIENCES });
    const qs = snapshot.quiz.questions.filter((q) => q.round === "Vrai ou Faux express");
    assert.deepEqual(qs.slice(0, 11).map((q) => q.text), [...second, "Le Soleil est une étoile", "Les poissons volent", "Le Soleil est une étoile"]);
    assert.ok(qs.every((q) => q.kind === "express"));
    assert.deepEqual(qs.map((q) => q.double), [...Array(8).fill(false), true, true, true, ...Array(7).fill(false), true, true, true]);
    assert.deepEqual(qs.slice(0, 8).map((q) => q.choices[q.correct]), second.map((t) => (moyennes.get(t).vrai ? "Vrai" : "Faux")));
    assert.equal(qs.length, 21);
  });

  test("Régie PC (cedric, 23/10 puis 24/10) : les Mimes, une ligne par équipe : âge (celui de la prestation d'office), 🎲, ＋ (images de la Bibliothèque, « Ajouter la sélection »), 🔀 (l'ordre joué sur la TV), liste repliable ; 20 images et 2 min d'office ; la TV reçoit une manche par équipe, photos copiées au lancement", async () => {
    const { buildSnapshot } = await import("../web/public/show.js");
    const { niveauMime } = await import("../web/public/banque-mimes.js");
    const PNG = `data:image/png;base64,${png([200, 60, 120]).toString("base64")}`;
    const MES = ["3333333333333333", "4444444444444444", "5555555555555555", "6666666666666666", "7777777777777777", "8888888888888888"];
    const NOMS = ["Lion", "Tigre", "Ours", "Loup", "Zèbre", "Koala"];
    await seedLibrary("images", Object.fromEntries(MES.map((id) => [id, PNG])));
    await seedLibrary("medias", Object.fromEntries(MES.map((id, k) => [id, { name: NOMS[k], cat: "Animaux", createdAt: 1, updatedAt: 1 }])));
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await page.fill("#show-age", "7");
    await page.selectOption("#show-teams", "3");
    await ajouterJeu(page, "mimes");
    const round = page.locator("#show-rounds .round").nth(0);
    const ligne = round.locator(".quiz-outils > .tirage-ligne");
    const compteur = round.locator(".round-head > .quiz-compteur");
    const equipes = round.locator(".mime-equipes > .mime-equipe");
    const equipe = (k) => equipes.nth(k);
    const de = (k) => equipe(k).locator(".mime-equipe-tete .tirage-de");
    const mots = (k) => equipe(k).locator(".mime-image:not(.vide) .mime-mot").allTextContents();
    // En haut : la source, les images par équipe (20 d'office), la durée du tour (2 min d'office).
    assert.deepEqual(await ligne.locator(":scope > *").evaluateAll((xs) => xs.map((x) => x.className)), ["mime-source", "mime-par-equipe", "mime-duree"]);
    assert.deepEqual(await ligne.locator(".mime-source option").allTextContents(), ["Images : 📷 Photos libres", "Images : 😀 Émojis", "Images : 🖼️ Mes images"]);
    assert.deepEqual(await ligne.locator(".mime-par-equipe option").allTextContents(), [10, 15, 20, 25, 30].map((k) => `${k} images par équipe`));
    assert.equal(await ligne.locator(".mime-par-equipe").inputValue(), "20");
    assert.deepEqual(await ligne.locator(".mime-duree option").allTextContents(), ["1 min", "1 min 30", "2 min", "2 min 30", "3 min"].map((d) => `Tour de ${d}`));
    assert.equal(await ligne.locator(".mime-duree").inputValue(), "120");
    assert.equal(await compteur.textContent(), "Aucune image pour l'instant : touchez 🎲 sur chaque équipe");
    assert.equal(await round.locator(".reprendre").count(), 0, "pas de « Reprendre une manche » pour les Mimes");
    assert.equal(await page.locator("#show-rounds .jeu-plus").count(), 0, "une seule manche : celle de chaque équipe est dedans");
    // Une ligne par équipe, dans les couleurs de la prestation ; l'âge de la prestation (7 ans : Petits) d'office.
    assert.deepEqual(await equipes.evaluateAll((xs) => xs.map((x) => x.dataset.couleur)), ["Rose", "Orange", "Vert"]);
    assert.deepEqual(await equipes.locator(".mime-equipe-tete b").allTextContents(), ["Équipe Rose", "Équipe Orange", "Équipe Vert"]);
    assert.deepEqual(await equipes.locator(".mime-age").evaluateAll((xs) => xs.map((x) => x.value)), ["PETITS", "PETITS", "PETITS"]);
    assert.ok(await equipe(0).locator(".mime-deplier").isDisabled(), "rien à déplier avant le 🎲");

    // Mes images (choix de Sarah, tous âges) : 6 en tout ; l'équipe Rose les prend toutes, il n'en reste plus pour Orange.
    await ligne.locator(".mime-source").selectOption("miennes");
    await de(0).click();
    await page.locator("#annonce", { hasText: "Seulement 6 images à tirer pour l'équipe Rose" }).waitFor();
    assert.deepEqual((await mots(0)).sort(), [...NOMS].sort(), "chaque image une seule fois");
    assert.equal(await equipe(0).locator(".mime-image img.tirage-photo").count(), 6);
    assert.equal(await equipe(0).locator(".mime-deplier").getAttribute("aria-expanded"), "true", "dépliée après son 🎲");
    assert.equal(await compteur.textContent(), "3 équipes · 6 images · 54 à tirer");
    await de(1).click();
    await page.locator("#annonce", { hasText: "Plus d'image à tirer pour l'équipe Orange dans cette source" }).waitFor();

    // Photos libres : le 🎲 d'une ligne déjà tirée demande avant de remplacer ses images.
    await ligne.locator(".mime-source").selectOption("photos");
    await de(0).click();
    assert.match(await repondreFenetre(page, { accepter: false }), /Tirer de nouvelles images pour l'équipe Rose \? Ses 6 images seront remplacées\./);
    assert.deepEqual((await mots(0)).sort(), [...NOMS].sort(), "« Garder » : rien ne change");
    await de(0).click();
    await repondreFenetre(page);
    await compteur.filter({ hasText: /^3 équipes · 20 images · 40 à tirer$/ }).waitFor();
    await de(1).click();
    await de(2).click();
    await compteur.filter({ hasText: /^3 équipes · 60 images$/ }).waitFor();
    // Petits : rien que des images faciles à mimer, toutes différentes, de vraies photos.
    const petits = [...await mots(0), ...await mots(1), ...await mots(2)];
    assert.equal(new Set(petits).size, 60);
    assert.deepEqual(petits.filter((m) => niveauMime(m) !== 1), [], "que des images « Mime : Petits »");
    assert.equal(await round.locator(".mime-image img.tirage-photo").count(), 60);
    // L'équipe Verte a des grands frères : Grands (12 à 15 ans), son 🎲 tire des images plus dures.
    await equipe(2).locator(".mime-age").selectOption("GRANDS");
    await de(2).click();
    await repondreFenetre(page);
    await waitFor(async () => (await mots(2)).every((m) => niveauMime(m) === 3), "images des Grands");
    assert.equal((await mots(2)).length, 20);
    assert.deepEqual(await equipes.locator(".mime-age").evaluateAll((xs) => xs.map((x) => x.value)), ["PETITS", "PETITS", "GRANDS"]);
    // Une ligne se replie.
    await equipe(2).locator(".mime-deplier").click();
    assert.equal(await equipe(2).locator(".mime-images").count(), 0);
    assert.equal(await equipe(2).locator(".mime-deplier").getAttribute("aria-expanded"), "false");
    assert.equal(await equipe(2).locator(".mime-nombre").textContent(), "20 images");

    // 🔀 : l'ordre de l'équipe Orange change (ses images restent les mêmes).
    const orangeAvant = await mots(1);
    await equipe(1).locator(".mime-melanger").click();
    await waitFor(async () => (await mots(1)).join() !== orangeAvant.join(), "ordre mélangé");
    assert.deepEqual([...await mots(1)].sort(), [...orangeAvant].sort());
    // ✕ laisse un 🎲 ; « Tirer l'image qui manque » la remplace, jamais par la même.
    const orangeMelange = await mots(1);
    const retiree = orangeMelange[0];
    await equipe(1).locator(".mime-image .tirage-retirer").first().click();
    await equipe(1).locator(".mime-image.vide .tirage-de").waitFor();
    assert.equal(await compteur.textContent(), "3 équipes · 59 images · 1 à tirer");
    // Une case oubliée sur le 🎲 se voit (cedric, 24/10) : sous le jeu et dans « Reste à faire avant le jour J ».
    await round.locator(".alerte-equipes", { hasText: "⚠ Il manque 1 image (case 🎲 vide) : Équipe Orange." }).waitFor();
    await page.locator("#show-ready li", { hasText: "(Mimes) : il manque 1 image (case 🎲 vide) : Équipe Orange." }).waitFor();
    await equipe(1).locator(".mime-completer", { hasText: "🎲 Tirer l'image qui manque" }).click();
    await equipe(1).locator(".mime-image.vide").waitFor({ state: "detached" });
    assert.equal(await compteur.textContent(), "3 équipes · 60 images");
    assert.equal(await round.locator(".alerte-equipes").count(), 0);
    const orange = await mots(1);
    assert.ok(!orange.includes(retiree), "l'image retirée ne revient pas");
    assert.deepEqual(orange.slice(1), orangeMelange.slice(1), "remplacée à sa place");

    // ＋ (cedric, 24/10) : la Bibliothèque s'ouvre ; recherche, groupes et catégories ; on coche, « Ajouter la sélection ».
    await equipe(0).locator(".mime-plus").click();
    const choix = page.locator(".choix-boite");
    await choix.waitFor();
    assert.equal(await choix.locator(".label").textContent(), "🖼️ Images à mimer pour l'équipe Rose");
    assert.deepEqual(await choix.locator(".chips:not(.choix-cats) .chip").evaluateAll((xs) => xs.map((x) => x.dataset.groupe)), ["tout", "photos", "emojis", "miennes"]);
    assert.ok(await choix.locator(".choix-ajouter").isDisabled());
    await choix.locator('.chip[data-groupe="miennes"]').click();
    await choix.locator('.media-tile[data-media="8888888888888888"]').click();
    await choix.locator(".choix-ajouter", { hasText: "＋ Ajouter la sélection (1)" }).waitFor();
    await choix.locator('.chip[data-groupe="photos"]').click();
    // Une image déjà dans ces Mimes est signalée (permis quand même).
    const dejaRose = (await mots(0))[0];
    await choix.locator(".choix-recherche").fill(dejaRose);
    const tuileRose = choix.locator(".media-tile.deja").filter({ hasText: new RegExp(`^${dejaRose.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
    assert.match(await tuileRose.first().getAttribute("title"), /ces Mimes \(équipe Rose\)/, "déjà dans ces Mimes : signalé, permis");
    await choix.locator(".choix-recherche").fill("");
    await choix.locator('.choix-cats .chip[data-cat="Animaux"]').click();
    await choix.locator(".choix-recherche").fill("lapin");
    await choix.locator(".media-tile", { hasText: "Lapin" }).first().click();
    await choix.locator(".choix-ajouter", { hasText: "＋ Ajouter la sélection (2)" }).click();
    await choix.waitFor({ state: "detached" });
    await page.locator("#annonce", { hasText: "2 images ajoutées à l'équipe Rose." }).waitFor();
    assert.deepEqual((await mots(0)).slice(-2), ["Koala", "Lapin"], "à la fin de la liste de l'équipe");
    assert.equal(await compteur.textContent(), "3 équipes · 62 images");
    await ligne.locator(".mime-duree").selectOption("90");
    await capture(page, "mimes-par-equipe");

    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const zoe = Object.values(await library("shows")).find((x) => x.childName === "Zoé");
    const [manche] = zoe.rounds;
    assert.deepEqual([manche.type, manche.source, manche.perTeam, manche.duration], ["mimes", "photos", 20, 90]);
    assert.deepEqual(manche.ages, { 2: "GRANDS" }, "seule l'âge changé à la main est gardé");
    const listes = manche.equipes.map((l) => l.map((c) => c.word));
    assert.deepEqual(listes.map((l) => l.length), [22, 20, 20]);
    assert.deepEqual(listes[1], orange);
    assert.deepEqual(manche.equipes[0].at(-2), { word: "Koala", imageId: "8888888888888888" });
    assert.ok(manche.equipes.flat().filter((c) => !c.imageId).every((c) => c.banque && c.image), "photos libres : clé de la banque et émoji de secours");
    await page.context().close();

    // Sur la TV : une manche par équipe, dans l'ordre des couleurs, sous un seul jeu « Mimes », images dans l'ordre choisi.
    const { snapshot } = buildSnapshot("zoe", zoe, {});
    const qs = snapshot.quiz.questions.filter((q) => q.kind === "mime");
    assert.deepEqual(qs.map((q) => q.text), ["Équipe Rose", "Équipe Orange", "Équipe Vert"]);
    assert.ok(qs.every((q) => q.round === "Mimes" && q.duration === 90));
    assert.deepEqual(qs.map((q) => q.cards.map((c) => c.word)), listes);
    // Lancée par la régie : les photos libres des cartes sont copiées dans la partie, l'ordre ne bouge pas.
    await seedLibrary("shows/zoe", { ...zoe, date: "2099-12-02", status: "publiee" });
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Zoé" }).click();
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const jouees = (await read("show")).quiz.questions.filter((q) => q.kind === "mime");
    assert.deepEqual(jouees.map((q) => q.cards.map((c) => c.word)), listes);
    // Rangées avec les images des cartes (choiceImages), comme celles d'un paquet de mimes.
    await waitFor(async () => {
      const show = await read("show");
      const copiees = (await read("choiceImages")) ?? {};
      return show.quiz.questions.filter((q) => q.kind === "mime")
        .every((q) => q.cards.every((c) => c.banque === undefined && /^[0-9a-f]{16}$/.test(c.imageId ?? "") && copiees[c.imageId]));
    }, "photos des mimes copiées dans la partie");
    await regie.context().close();
  });

  test("Bibliothèque (cedric, 24/10) : la fiche d'une photo libre ou d'un émoji dit s'il est bon pour le mime, et pour quel âge", async () => {
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#media-groups [data-groupe="photos"]');
    const fiche = async (nom) => {
      await page.locator("#media-search").fill(nom);
      await page.locator(".media-tile", { hasText: nom }).first().click();
      await page.locator("#visionneuse[open]").waitFor();
      const texte = await page.locator("#vis-details").textContent();
      await page.click("#vis-fermer");
      return texte;
    };
    assert.match(await fiche("Voiture"), /🎭 Mime : Petits \(6 à 8 ans\)$/);
    assert.match(await fiche("Hibou"), /🎭 Mime : Moyens \(9 à 11 ans\)$/);
    assert.match(await fiche("Phare"), /🎭 Mime : Grands \(12 ans et plus\)$/);
    assert.doesNotMatch(await fiche("Poireau"), /Mime/);
    await page.click('#media-groups [data-groupe="emojis"]');
    assert.match(await fiche("Pompier"), /🎭 Mime : Petits/);
    await page.context().close();
  });

  test("Régie PC (cedric, 24/10) : le Blind test comme le Quiz, sans manches : nombre de chansons et 🎲, liste repliable avec mini pochette et « ✓ Paroles » à droite ; ✕ laisse un 🎲 ; 🎧 écoute l'extrait et le refrain, « ⏱ Régler… » et retour à la prestation ; chansons choisies et playlist ajoutée en séries ; « Blind test complet » ↑ ↓ ✕ 🔀 ; la TV reçoit les chansons", async () => {
    const { buildSnapshot } = await import("../web/public/show.js");
    const PNG = `data:image/png;base64,${png([30, 90, 200]).toString("base64")}`;
    const WAV = `data:audio/wav;base64,${wav(440, 4).toString("base64")}`;
    const POCHETTE = "a1a1a1a1a1a1a1a1";
    const hex = (c, k) => `${c}${k}`.padEnd(16, c);
    const SONGS = Object.fromEntries([1, 2, 3, 4, 5, 6].map((k) => [`c${k}`, {
      title: `Complète ${k}`, artist: "Les Tests", audioId: hex("e", k), imageId: POCHETTE, refrainId: hex("f", k),
      start: 6, refrain: 40, lrc: true, auto: true, paroles: "40000|La la la", updatedAt: 1,
    }]));
    Object.assign(SONGS, {
      sp: { title: "Sans pochette", artist: "Les Tests", audioId: hex("e", 7), refrainId: hex("f", 7), start: 0, refrain: 30, lrc: true, auto: true, paroles: "30000|Oh oh", updatedAt: 1 },
      pr: { title: "Paroles sans refrain", artist: "Les Tests", audioId: hex("e", 8), imageId: POCHETTE, start: 0, lrc: true, updatedAt: 1 },
      ret: { title: "Retirée", artist: "Les Tests", audioId: hex("e", 9), imageId: POCHETTE, retiree: true, updatedAt: 1 },
    });
    await seedLibrary("songs", SONGS);
    await seedLibrary("images", { [POCHETTE]: PNG });
    await seedLibrary("sounds", { [hex("e", 1)]: WAV, [hex("f", 1)]: WAV });
    await seedLibrary("lyrics", { c1: ["[00:05.00]Le couplet", "[00:39.00]Juste avant", "[00:41.00]On chante tous ensemble"].join("\n") });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await page.fill("#show-age", "9");
    await ajouterJeu(page, "blind");
    const round = page.locator("#show-rounds .round").nth(0);
    const ligne = round.locator(".quiz-outils > .tirage-ligne:not(.blind-manuel)");
    const manuel = round.locator(".quiz-outils > .tirage-ligne.blind-manuel");
    const compteur = round.locator(".quiz-compteur");
    const serieDe = round.locator('.blind-serie[data-origine="de"]');
    const voir = serieDe.locator(".blind-voir");
    const liste = serieDe.locator(".blind-liste");
    const chanson = (id) => round.locator(`.blind-chanson[data-chanson="${id}"]`);
    const ids = () => round.locator(".blind-chanson[data-chanson]").evaluateAll((xs) => xs.map((x) => x.dataset.chanson));
    // Comme le Quiz (cedric) : une ligne avec le nombre de chansons à trouver et le 🎲.
    assert.deepEqual(await ligne.locator(":scope > *").evaluateAll((xs) => xs.map((x) => x.className)), ["tirage-nombre blind-nombre", "btn tirage-de"]);
    assert.equal(await ligne.locator(".blind-nombre").inputValue(), "10");
    assert.equal(await compteur.textContent(), "Aucune chanson pour l'instant : touchez 🎲, « Sélectionner mes chansons » ou ajoutez une playlist");
    assert.equal(await round.locator(".blind-serie").count(), 0);
    // Pas de manches (cedric, 24/10 : « on a juste un nombre de chansons à trouver »), pas de « Reprendre », pas de Note ;
    // le compteur sur la ligne du numéro du jeu.
    const bloc = page.locator('#show-rounds .jeu-bloc[data-jeu="blind"]');
    assert.equal(await bloc.locator(".jeu-nb, .jeu-plus").count(), 0);
    assert.equal(await round.locator(".reprendre-ouvrir, .manche-note").count(), 0);
    assert.equal(await round.locator(".round-head .quiz-compteur").count(), 1);
    // À la place de la note : « 🎶 Ajouter une playlist », une recherche dans ses playlists.
    assert.equal(await round.locator(".quiz-outils > .blind-playlist .blind-playlist-titre").textContent(), "🎶 Ajouter une playlist");
    // Dessous, la création à la main (cedric, 24/10) : « 🎵 Sélectionner mes chansons » et leur nombre.
    assert.equal(await manuel.locator(".blind-selectionner").textContent(), "🎵 Sélectionner mes chansons");
    assert.equal(await manuel.locator(".blind-selection").textContent(), "Aucune chanson sélectionnée");

    // 5 chansons : d'abord celles qui ont pochette et paroles ; la liste s'ouvre, chaque titre avec sa mini pochette et,
    // à sa droite, « ✓ Paroles ».
    await ligne.locator(".blind-nombre").selectOption("5");
    await ligne.locator(".tirage-de").click();
    await compteur.filter({ hasText: /^5 chansons à trouver$/ }).waitFor();
    assert.equal(await voir.textContent(), "▾ 🎲 5 chansons tirées au hasard");
    assert.equal(await liste.isVisible(), true);
    assert.ok((await round.locator(".blind-titre b").allTextContents()).every((t) => /^Complète \d$/.test(t)));
    await waitFor(async () => (await serieDe.locator("img.blind-pochette").evaluateAll((xs) => xs.filter((x) => x.src.startsWith("data:image/png")).length)) === 5, "5 mini pochettes");
    assert.deepEqual(await round.locator(".blind-paroles").allTextContents(), Array(5).fill("✓ Paroles"));
    const [titre, paroles] = await Promise.all([round.locator(".blind-titre").first().boundingBox(), round.locator(".blind-paroles").first().boundingBox()]);
    assert.ok(paroles.x >= titre.x + titre.width - 1, "« ✓ Paroles » à droite du titre");
    await capture(page, "blind-test-chansons");
    // Repliable comme une série du Quiz.
    await voir.click();
    assert.equal(await liste.isHidden(), true);
    assert.equal(await voir.textContent(), "▸ 🎲 5 chansons tirées au hasard");
    await voir.click();
    await liste.waitFor();

    // 8 chansons : les 5 premières restent ; sans pochette, un 💿 barré ; un .lrc sans refrain réglé, « ✗ Pas de paroles ».
    const cinq = await ids();
    await ligne.locator(".blind-nombre").selectOption("8");
    await compteur.filter({ hasText: /^8 chansons à trouver$/ }).waitFor();
    const huit = await ids();
    assert.deepEqual(huit.slice(0, 5), cinq);
    assert.equal(new Set(huit).size, 8);
    assert.ok(!huit.includes("ret"), "une chanson supprimée n'est jamais tirée");
    assert.equal(await chanson("sp").locator(".blind-pochette.sans").count(), 1);
    assert.equal(await chanson("pr").locator(".blind-paroles.non").textContent(), "✗ Pas de paroles");

    // ✕ laisse un 🎲 ; plus rien à tirer (la chanson retirée ne revient pas).
    await chanson("c2").locator(".tirage-retirer").click();
    await round.locator(".blind-chanson.vide .tirage-de").waitFor();
    await compteur.filter({ hasText: /^7 chansons à trouver · 1 à tirer$/ }).waitFor();
    assert.equal(await voir.textContent(), "▾ 🎲 7 chansons tirées au hasard, 1 à tirer");
    await round.locator(".blind-completer", { hasText: "🎲 Tirer la chanson qui manque" }).waitFor();
    await round.locator(".blind-chanson.vide .tirage-de").click();
    await page.locator("#annonce", { hasText: "Plus de chanson à tirer dans la bibliothèque des sons." }).waitFor();
    assert.ok(!(await ids()).includes("c2"));
    // Une case oubliée (cedric, 24/10) : rien ne plante, le blind test a une chanson de moins ; mais c'est dit en rouge
    // sous le jeu, dans « Reste à faire avant le jour J » et à l'enregistrement.
    const trou = "il manque 1 chanson (case 🎲 vide) : 7 jouées au lieu de 8.";
    await round.locator(".alerte-equipes", { hasText: `⚠ I${trou.slice(1)}` }).waitFor();
    await page.locator("#show-ready li", { hasText: `Manche 1 (Blind test) : ${trou}` }).waitFor();

    // 🎧 (cedric : vérifier l'extrait et le hook sans charger la page) : un petit menu sous la chanson, un seul ouvert.
    await chanson("sp").locator(".blind-ecouter").click();
    await chanson("sp").locator(".blind-reglage").waitFor();
    await chanson("pr").locator(".blind-ecouter").click();
    const menuPr = chanson("pr").locator(".blind-reglage");
    await menuPr.waitFor();
    assert.equal(await chanson("sp").locator(".blind-reglage").count(), 0, "un seul petit menu ouvert");
    assert.equal(await menuPr.locator(".blind-refrain").isDisabled(), true, "pas de refrain à écouter");
    assert.equal(await menuPr.locator(".blind-hook").textContent(), "Refrain pas encore réglé");
    await chanson("c1").locator(".blind-ecouter").click();
    const menu = chanson("c1").locator(".blind-reglage");
    await menu.waitFor();
    assert.deepEqual(await menu.locator("button").allTextContents(), ["▶ Extrait · 0:06", "▶ Refrain · 0:40", "⏱ Régler…"]);
    assert.equal(await menu.locator(".blind-hook").textContent(), "Refrain trouvé automatiquement");
    // Le refrain joue, avec ses paroles qui défilent ; « ⏸ Pause » l'arrête.
    await menu.locator(".blind-refrain").click();
    await menu.locator(".blind-refrain", { hasText: "⏸ Pause" }).waitFor();
    const flottante = page.locator(".paroles-fenetre.flottante");
    await flottante.locator(".paroles-titre", { hasText: "Paroles · Complète 1" }).waitFor();
    await flottante.locator(".paroles-ligne.chantee", { hasText: "On chante tous ensemble" }).waitFor({ timeout: 8000 });
    await capture(page, "blind-test-ecoute-refrain", { pleinePage: false });
    await menu.locator(".blind-refrain").click();
    await menu.locator(".blind-refrain", { hasText: "▶ Refrain · 0:40" }).waitFor();
    await flottante.waitFor({ state: "detached" });
    await menu.locator(".blind-extrait").click();
    await menu.locator(".blind-extrait", { hasText: "⏸ Pause" }).waitFor();
    await menu.locator(".blind-extrait").click();
    await menu.locator(".blind-extrait", { hasText: "▶ Extrait · 0:06" }).waitFor();

    // « ⏱ Régler… » : la prestation (pas encore enregistrée) l'est d'abord, puis les réglages de la chanson s'ouvrent.
    await menu.locator(".blind-regler").click();
    assert.match(await repondreFenetre(page), /la prestation est d'abord enregistrée/);
    await page.locator("#annonce", { hasText: `Enregistrée. À revoir avant le jour J : Manche 1 (Blind test) : ${trou}` }).waitFor();
    await page.locator("#screen-playlist-edit:not([hidden])").waitFor();
    assert.equal(await page.textContent("#playlist-edit-title"), "Réglages de « Complète 1 »");
    // Ses paroles arrivent dans les réglages : les lire n'est pas une modification.
    await page.locator(".track.reglage .reglage-paroles .paroles-ligne", { hasText: "On chante tous ensemble" }).waitFor();
    const zoe = Object.values(await library("shows")).find((x) => x.childName === "Zoé");
    const [manche] = zoe.rounds;
    assert.equal(manche.type, "blind");
    assert.equal(manche.nbChansons, 8);
    assert.deepEqual(manche.chansons.filter(Boolean).sort(), huit.filter((id) => id !== "c2").sort());
    assert.equal(manche.chansons.filter((id) => !id).length, 1, "la case retirée reste à tirer");
    assert.deepEqual(manche.seriesBlind.map((x) => [x.origine, x.chansons.length]), [["de", 8]]);
    // Hook déplacé (ici directement dans la bibliothèque) ; « ← Retour » : la prestation telle qu'on l'a laissée, avec
    // le nouveau réglage.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const d = ctx.database();
      await set(ref(d, "library/songs/c1/refrain"), 52);
      await set(ref(d, "library/songs/c1/auto"), null);
    });
    await page.locator("#screen-playlist-edit .retour-page").first().click();
    await page.locator("#screen-show-edit:not([hidden])").waitFor();
    await chanson("c1").locator(".blind-refrain", { hasText: "▶ Refrain · 0:52" }).waitFor();
    assert.equal(await chanson("c1").locator(".blind-hook").textContent(), "Refrain réglé à la main");
    assert.equal(await liste.isVisible(), true, "la liste est restée dépliée");
    assert.equal(await compteur.textContent(), "7 chansons à trouver · 1 à tirer");

    // Case vidée (cedric, 24/10) : « 🎵 Choisir… » ouvre la bibliothèque des sons, la chanson choisie prend sa place ;
    // celles déjà dans le blind test ne se choisissent pas, une chanson supprimée n'y est jamais.
    const vide = (await ids()).length;
    await round.locator(".blind-chanson.vide .blind-choisir").click();
    const choix = page.locator(".choix-sons");
    await choix.waitFor();
    assert.equal(await choix.locator('.choix-chanson[data-chanson="c1"]').isDisabled(), true, "déjà dans ce blind test");
    assert.equal(await choix.locator('.choix-chanson[data-chanson="ret"]').count(), 0, "jamais une chanson supprimée");
    // Recherche à chaque lettre : ce qui commence par le mot d'abord.
    await choix.locator(".choix-recherche").fill("paroles");
    assert.deepEqual(await choix.locator(".choix-chanson-titre b").allTextContents(), ["Paroles sans refrain"]);
    await choix.locator(".choix-recherche").fill("compl");
    await choix.locator('.choix-chanson[data-chanson="c2"]').click();
    await choix.waitFor({ state: "detached" });
    await compteur.filter({ hasText: /^8 chansons à trouver$/ }).waitFor();
    const avecC2 = await ids();
    assert.equal(avecC2.length, vide + 1);
    assert.equal(avecC2[huit.indexOf("c2")], "c2", "à la place de la case vidée");
    await round.locator(".alerte-equipes").waitFor({ state: "detached" });
    assert.equal(await page.locator("#show-ready li", { hasText: "Blind test" }).count(), 0, "plus rien à revoir");

    // Trois chansons de plus dans la bibliothèque, et une playlist (une chanson déjà dans le blind test, une nouvelle,
    // un morceau d'avant la bibliothèque des sons).
    const plus = Object.fromEntries([1, 2, 3].map((k) => [`m${k}`, { title: `Manuelle ${k}`, artist: "Les Tests", audioId: hex("d", k), start: 0, updatedAt: 1 }]));
    await Promise.all(Object.entries(plus).map(([k, x]) => seedLibrary(`songs/${k}`, x)));
    await seedLibrary("playlists", { pl: { title: "Années 80", duration: 30, updatedAt: 1, tracks: [
      { title: "Complète 1", audioId: hex("e", 1), songId: "c1", duration: 20 },
      { title: "Manuelle 1", audioId: hex("d", 1), songId: "m1", duration: 20 },
      { title: "Hors bibliothèque", audioId: hex("b", 1), duration: 20 },
    ] } });
    // « 🎵 Sélectionner mes chansons » : la bibliothèque, cases à cocher ; celles déjà dans le blind test ne se cochent
    // pas. Elles forment la série « choisies à la main », sous celle du 🎲.
    await manuel.locator(".blind-selectionner").click();
    await choix.waitFor();
    await choix.locator('.choix-chanson[data-chanson="m3"]').waitFor();
    assert.equal(await choix.locator(".choix-chanson.cochee").count(), 0);
    assert.equal(await choix.locator('.choix-chanson[data-chanson="c1"]').isDisabled(), true, "déjà au 🎲");
    assert.deepEqual(await choix.locator(".chip").allTextContents(), ["Toutes (11)", "✓ Avec paroles (7)", "☑ Cochées (0)"]);
    await choix.locator('.choix-chanson[data-chanson="m1"]').click();
    await choix.locator('.choix-chanson[data-chanson="m2"]').click();
    await capture(page, "blind-test-selection", { pleinePage: false });
    await choix.locator(".choix-valider", { hasText: "✓ Valider la sélection (2)" }).click();
    await choix.waitFor({ state: "detached" });
    await compteur.filter({ hasText: /^10 chansons à trouver$/ }).waitFor();
    const serieChoix = round.locator('.blind-serie[data-origine="choix"]');
    assert.equal(await serieChoix.locator(".blind-voir").textContent(), "▾ 🎵 2 chansons choisies à la main");
    assert.equal(await manuel.locator(".blind-selection").textContent(), "2 chansons sélectionnées");
    // Rouverte : ses chansons cochées ; décochée, elle part.
    await manuel.locator(".blind-selectionner").click();
    await choix.waitFor();
    assert.equal(await choix.locator(".choix-chanson.cochee").count(), 2);
    await choix.locator('.choix-chanson[data-chanson="m1"]').click();
    await choix.locator(".choix-valider", { hasText: "(1)" }).click();
    await compteur.filter({ hasText: /^9 chansons à trouver$/ }).waitFor();
    // Annuler ne change rien.
    await manuel.locator(".blind-selectionner").click();
    await choix.locator('.choix-chanson[data-chanson="m3"]').click();
    await choix.getByRole("button", { name: "Annuler" }).click();
    await choix.waitFor({ state: "detached" });
    assert.equal((await ids()).length, 9);

    // « 🎶 Ajouter une playlist » (cedric, 24/10) : rien avant la première lettre ; la playlist entière en série, sans les
    // chansons déjà dans le blind test ; le compteur suit.
    const cherche = round.locator(".blind-playlist-cherche");
    await cherche.focus();
    assert.equal(await round.locator(".blind-playlist-liste").isHidden(), true);
    await cherche.fill("ann");
    const item = round.locator('.blind-playlist-item[data-playlist="pl"]');
    assert.equal(await item.locator(".small").textContent(), "2 chansons");
    await item.click();
    await page.locator("#annonce", { hasText: "« Années 80 » ajoutée : 1 chanson, 1 déjà dans ce blind test." }).waitFor();
    await compteur.filter({ hasText: /^10 chansons à trouver$/ }).waitFor();
    const seriePl = round.locator('.blind-serie[data-origine="playlist"]');
    assert.equal(await seriePl.locator(".blind-voir").textContent(), "▾ 🎶 Playlist « Années 80 » : 1 chanson");
    assert.deepEqual(await seriePl.locator(".blind-chanson").evaluateAll((xs) => xs.map((x) => x.dataset.chanson)), ["m1"]);
    // Déroulante : « ＋ Une chanson » en ajoute une, ✕ en enlève une (sans 🎲 à sa place), 🎧 règle le refrain.
    await seriePl.locator(".blind-plus").click();
    await choix.waitFor();
    assert.equal(await choix.locator('.choix-chanson[data-chanson="m2"]').isDisabled(), true, "déjà dans ce blind test");
    await choix.locator('.choix-chanson[data-chanson="m3"]').click();
    await compteur.filter({ hasText: /^11 chansons à trouver$/ }).waitFor();
    assert.deepEqual(await seriePl.locator(".blind-chanson").evaluateAll((xs) => xs.map((x) => x.dataset.chanson)), ["m1", "m3"]);
    await seriePl.locator('.blind-chanson[data-chanson="m3"] .tirage-retirer').click();
    await compteur.filter({ hasText: /^10 chansons à trouver$/ }).waitFor();
    assert.equal(await seriePl.locator(".blind-chanson.vide").count(), 0);
    await seriePl.locator('.blind-chanson[data-chanson="m1"] .blind-ecouter').click();
    await seriePl.locator('.blind-chanson[data-chanson="m1"] .blind-regler').waitFor();
    await seriePl.locator('.blind-chanson[data-chanson="m1"] .blind-ecouter').click();
    // Les séries montent et descendent.
    const origines = () => round.locator(".blind-serie").evaluateAll((xs) => xs.map((x) => x.dataset.origine));
    assert.deepEqual(await origines(), ["de", "choix", "playlist"]);
    await seriePl.locator(".serie-monter").click();
    await waitFor(async () => (await origines()).join() === "de,playlist,choix", "la playlist passe avant les chansons choisies");

    // « 🧩 Blind test complet » : les deux ajouts mélangés dans l'ordre de passage, le nombre total ; ↑ ↓ ✕ et 🔀.
    const complet = round.locator(".blind-complet");
    const ordreComplet = () => complet.locator(".blind-complet-q").evaluateAll((xs) => xs.map((x) => x.dataset.chanson));
    assert.equal(await complet.locator(".blind-complet-voir").textContent(), "▸ 🧩 Blind test complet : 10 chansons, dans l'ordre de passage");
    await complet.locator(".blind-complet-voir").click();
    const avant = await ordreComplet();
    assert.deepEqual(avant.slice(-2), ["m1", "m2"]);
    assert.deepEqual(avant.slice(0, 8).sort(), avecC2.slice().sort());
    await complet.locator(".blind-complet-q").last().locator(".quiz-complet-monter").click();
    await waitFor(async () => (await ordreComplet()).slice(-2).join() === "m2,m1", "m2 passe avant m1");
    await complet.locator('.blind-complet-q[data-chanson="c1"] .tirage-retirer').click();
    await compteur.filter({ hasText: /^9 chansons à trouver$/ }).waitFor();
    assert.ok(!(await ids()).includes("c1"), "enlevée de sa série aussi");
    const range = await ordreComplet();
    await complet.locator(".blind-melanger").click();
    await waitFor(async () => (await ordreComplet()).join() !== range.join(), "mélangé");
    const melange = await ordreComplet();
    assert.deepEqual(melange.slice().sort(), range.slice().sort());
    await capture(page, "blind-test-complet");
    // Enregistré : les séries et l'ordre ; la TV joue cet ordre.
    await page.click("#show-save");
    let zoe2;
    await waitFor(async () => {
      zoe2 = Object.values((await library("shows")) ?? {}).find((x) => x.childName === "Zoé");
      return zoe2?.rounds?.[0]?.ordreBlind?.length === melange.length;
    }, "blind test en séries enregistré");
    assert.deepEqual(zoe2.rounds[0].seriesBlind.map((x) => x.origine), ["de", "playlist", "choix"]);
    assert.deepEqual(zoe2.rounds[0].ordreBlind, melange);
    assert.deepEqual(zoe2.rounds[0].chansons, melange);
    const songs2 = await library("songs");
    const titres = (await buildSnapshot("zoe", zoe2, {}, {}, Math.random, {}, {}, {}, songs2)).snapshot.quiz.questions.filter((q) => q.kind === "blind").map((q) => q.choices[0]);
    assert.deepEqual(titres, melange.map((id) => songs2[id].title));
    // Deux blind tests qui se suivent n'en font plus qu'un ; « ＋ Ajouter un jeu » Blind test juste après y ramène.
    await ajouterJeu(page, "blind");
    await page.locator("#annonce", { hasText: "Le Blind test est déjà le dernier jeu" }).waitFor();
    assert.equal(await page.locator('#show-rounds .jeu-bloc[data-jeu="blind"]').count(), 1);
    await page.context().close();

    // Sur la TV : les 7 chansons, avec pochette, refrain et paroles quand elles les ont.
    const songs = await library("songs");
    const { snapshot } = buildSnapshot("zoe", zoe, {}, {}, Math.random, {}, {}, {}, songs);
    const qs = snapshot.quiz.questions.filter((q) => q.kind === "blind");
    assert.equal(qs.length, 7);
    assert.ok(!qs.some((q) => q.choices[0] === "Retirée" || q.choices[0] === "Complète 2"));
    const c1 = qs.find((q) => q.choices[0] === "Complète 1");
    assert.deepEqual([c1.audioId, c1.imageId, c1.refrainId, c1.lyrics], [hex("e", 1), POCHETTE, hex("f", 1), "40000|La la la"]);
    assert.equal(qs.find((q) => q.choices[0] === "Paroles sans refrain").lyrics, undefined);
    // Lancée par la régie : la TV reçoit ces chansons.
    await seedLibrary("shows/zoe", { ...zoe, date: "2099-12-02", status: "publiee" });
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#panel-show:not([hidden]) .show-item", { hasText: "Zoé" }).click();
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const jouees = (await read("show")).quiz.questions.filter((q) => q.kind === "blind");
    assert.deepEqual(jouees.map((q) => q.choices[0]).sort(), qs.map((q) => q.choices[0]).sort());
    await regie.context().close();
  });

  test("Régie PC (cedric, 24/10) : le Quiz musical comme le Blind test : 🎲 dans la bibliothèque des sons, une playlist modifiable sans toucher la bibliothèque, « Quiz musical complet » ↑ ↓ ✕ 🔀 ; la TV pose les titres dans cet ordre", async () => {
    const { buildSnapshot } = await import("../web/public/show.js");
    // Chaque chanson a son refrain et ses paroles : l'extrait pendant la question, le refrain à la révélation (cedric, 24/10).
    const SONGS = Object.fromEntries(Array.from({ length: 12 }, (_, i) => i + 1).map((k) => [`t${k}`, {
      title: `Titre ${k}`, artist: "Les Tests", audioId: `c${String(k).padStart(2, "0")}`.padEnd(16, "c"), refrainId: `d${String(k).padStart(2, "0")}`.padEnd(16, "d"),
      start: 0, refrain: 40, buzz: 25, lrc: true, auto: true, paroles: "40000|La la la", updatedAt: 1,
    }]));
    await seedLibrary("songs", SONGS);
    // 7 chansons dans la playlist, 5 tirées au 🎲 sur 12 : il en reste toujours au moins 2 à ajouter (vu le 24/10 : avec
    // 3 chansons sur 7, le 🎲 les prenait parfois toutes et la playlist n'avait plus rien à apporter).
    const DISNEY = ["t6", "t7", "t8", "t9", "t10", "t11", "t12"];
    await seedLibrary("playlists", { pl: { title: "Disney", duration: 30, updatedAt: 1, tracks: DISNEY.map((k) => ({ title: SONGS[k].title, audioId: SONGS[k].audioId, songId: k, duration: 25 })) } });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await ajouterJeu(page, "musical");
    const round = page.locator("#show-rounds .round").nth(0);
    const compteur = round.locator(".quiz-compteur");
    // Pas de manches, ni « Reprendre », ni Note ; pas de « Sélectionner mes chansons » (cedric : le 🎲, une playlist, le récap).
    const bloc = page.locator('#show-rounds .jeu-bloc[data-jeu="musical"]');
    assert.equal(await bloc.locator(".jeu-nb, .jeu-plus").count(), 0);
    assert.equal(await round.locator(".reprendre-ouvrir, .manche-note, .blind-manuel").count(), 0);
    assert.equal(await compteur.textContent(), "Aucune chanson pour l'instant : touchez 🎲 ou ajoutez une playlist");
    // 🎲 : 5 chansons, avec leur mini pochette et « ✓ Paroles » (le refrain et ses paroles passent à la révélation).
    await round.locator(".blind-nombre").selectOption("5");
    await round.locator(".quiz-outils .tirage-de").click();
    await compteur.filter({ hasText: /^5 chansons à trouver$/ }).waitFor();
    const de = round.locator('.blind-serie[data-origine="de"]');
    assert.deepEqual(await de.locator(".blind-paroles").allTextContents(), Array(5).fill("✓ Paroles"));
    const ids = (loc) => loc.locator(".blind-chanson[data-chanson]").evaluateAll((xs) => xs.map((x) => x.dataset.chanson));
    const tires = await ids(de);
    assert.equal(tires.length, 5);
    // 🎧 : l'extrait et le refrain, réglables comme au blind test (cedric, 24/10).
    await de.locator(".blind-ecouter").first().click();
    assert.deepEqual(await de.locator(".blind-reglage button").allTextContents(), ["▶ Extrait · 0:00", "▶ Refrain · 0:40", "⏱ Régler…"]);
    // La playlist : ses chansons qui n'y sont pas encore ; modifiée ici, elle ne change pas dans la bibliothèque.
    await round.locator(".blind-playlist-cherche").fill("dis");
    await round.locator('.blind-playlist-item[data-playlist="pl"]').click();
    const pl = round.locator('.blind-serie[data-origine="playlist"]');
    await pl.waitFor();
    const dansPl = await ids(pl);
    assert.deepEqual(dansPl, DISNEY.filter((k) => !tires.includes(k)));
    assert.ok(dansPl.length >= 2);
    await pl.locator(".blind-chanson[data-chanson]").first().locator(".tirage-retirer").click();
    await waitFor(async () => (await ids(pl)).length === dansPl.length - 1, "chanson enlevée de la playlist du quiz");
    assert.equal((await library("playlists/pl/tracks")).length, 7, "la playlist de la bibliothèque ne change pas");
    const total = tires.length + dansPl.length - 1;
    await compteur.filter({ hasText: new RegExp(`^${total} chansons à trouver$`) }).waitFor();
    // « Quiz musical complet » : tout, dans l'ordre de passage ; ↑ et 🔀.
    const complet = round.locator(".blind-complet");
    assert.equal(await complet.locator(".blind-complet-voir").textContent(), `▸ 🧩 Quiz musical complet : ${total} chansons, dans l'ordre de passage`);
    await complet.locator(".blind-complet-voir").click();
    const ordre = () => complet.locator(".blind-complet-q").evaluateAll((xs) => xs.map((x) => x.dataset.chanson));
    const avant = await ordre();
    await complet.locator(".blind-complet-q").nth(1).locator(".quiz-complet-monter").click();
    await waitFor(async () => (await ordre())[0] === avant[1], "la 2e passe en premier");
    await complet.locator(".blind-melanger").click();
    await waitFor(async () => (await ordre()).join() !== [avant[1], avant[0], ...avant.slice(2)].join(), "mélangé");
    const final = await ordre();
    // Enregistré ; la TV pose les titres dans cet ordre, chacun avec 4 titres de la bibliothèque des sons.
    await page.click("#show-save");
    let zoe;
    await waitFor(async () => {
      zoe = Object.values((await library("shows")) ?? {}).find((x) => x.childName === "Zoé");
      return zoe?.rounds?.[0]?.ordreBlind?.length === final.length;
    }, "quiz musical enregistré");
    assert.equal(zoe.rounds[0].type, "musical");
    assert.deepEqual(zoe.rounds[0].chansons, final);
    const qs = buildSnapshot("zoe", zoe, {}, {}, Math.random, {}, {}, {}, SONGS).snapshot.quiz.questions;
    assert.deepEqual(qs.map((q) => q.choices[q.correct]), final.map((k) => SONGS[k].title));
    assert.ok(qs.every((q) => q.kind === "classic" && q.choices.length === 4 && new Set(q.choices).size === 4 && q.duration === 25));
    assert.deepEqual(qs.map((q) => q.audioId), final.map((k) => SONGS[k].audioId));
    // La révélation : l'artiste, le refrain et ses paroles de chaque chanson.
    assert.deepEqual(qs.map((q) => [q.artist, q.refrainId, q.lyrics]), final.map((k) => ["Les Tests", SONGS[k].refrainId, "40000|La la la"]));
    // Deux Quiz musicaux qui se suivent n'en font qu'un.
    await ajouterJeu(page, "musical");
    await page.locator("#annonce", { hasText: "Le Quiz musical est déjà le dernier jeu" }).waitFor();
    await page.context().close();
  });

  test("Bibliothèque › Sons (cedric, 24/10) : « 🎶 Mes playlists » : créer une playlist (son nom, ses chansons cochées, autant qu'on veut), la déplier, ✕ une chanson, « 🎵 Ajouter des chansons », renommer, supprimer", async () => {
    const hex = (c, k) => `${c}${k}`.padEnd(16, c);
    await seedLibrary("songs", Object.fromEntries([1, 2, 3, 4].map((k) => [`s${k}`, { title: `Chanson ${k}`, artist: "Les Tests", audioId: hex("a", k), start: 0, updatedAt: 1 }])));
    // Une playlist d'avant, avec un morceau qui n'est pas dans la bibliothèque des sons : il reste quand on la change.
    await seedLibrary("playlists", { vieille: { title: "Vieille", duration: 30, updatedAt: 1, tracks: [
      { title: "Chanson 1", audioId: hex("a", 1), duration: 20, points: 300 },
      { title: "Importée", audioId: hex("b", 1), duration: 20 },
    ] } });
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="sons"]');
    const boite = page.locator("#library-sons:not([hidden]) #sons-playlists");
    const vieille = boite.locator('.sons-playlist[data-playlist="vieille"]');
    assert.equal(await vieille.locator(".sons-playlist-voir").textContent(), "▸ 🎶 Vieille · 1 chanson (+ 1 hors bibliothèque des sons)");

    // Créer : son nom, puis ses chansons cochées dans la bibliothèque des sons.
    await page.click("#sons-playlist-new");
    assert.match(await repondreFenetre(page, { texte: "  Années   80 " }), /Nom de la nouvelle playlist/);
    const choix = page.locator(".choix-sons");
    await choix.waitFor();
    for (const k of ["s3", "s1", "s4"]) await choix.locator(`.choix-chanson[data-chanson="${k}"]`).click();
    await choix.locator(".choix-valider", { hasText: "(3)" }).click();
    await page.locator("#song-status", { hasText: "Playlist « Années 80 » créée : 3 chansons." }).waitFor();
    let id;
    await waitFor(async () => {
      id = Object.entries((await library("playlists")) ?? {}).find(([, p]) => p.title === "Années 80")?.[0];
      return !!id;
    }, "playlist créée");
    const creee = await library(`playlists/${id}`);
    assert.equal(creee.duration, 30);
    assert.deepEqual(creee.tracks.map((t) => [t.songId, t.title, t.audioId]), [["s3", "Chanson 3", hex("a", 3)], ["s1", "Chanson 1", hex("a", 1)], ["s4", "Chanson 4", hex("a", 4)]]);
    // Dépliée d'office : ses chansons, dans l'ordre des clics.
    const annees = boite.locator(`.sons-playlist[data-playlist="${id}"]`);
    await annees.locator(".sons-playlist-voir", { hasText: "▾ 🎶 Années 80 · 3 chansons" }).waitFor();
    const chansons = () => annees.locator(".sons-playlist-chanson").evaluateAll((xs) => xs.map((x) => x.dataset.chanson));
    assert.deepEqual(await chansons(), ["s3", "s1", "s4"]);
    // ✕ : la chanson part de la playlist (pas de la bibliothèque).
    await annees.locator('.sons-playlist-chanson[data-chanson="s1"] .tirage-retirer').click();
    await waitFor(async () => (await chansons()).join() === "s3,s4", "chanson retirée");
    assert.ok(await library("songs/s1"), "toujours dans la bibliothèque des sons");
    // « 🎵 Ajouter des chansons » (cedric, 24/10 : la playlist existe déjà) : ses chansons cochées ; une de plus, à la fin.
    assert.equal(await annees.locator(".sons-playlist-choisir").textContent(), "🎵 Ajouter des chansons");
    await annees.locator(".sons-playlist-choisir").click();
    await choix.waitFor();
    assert.equal(await choix.locator(".choix-chanson.cochee").count(), 2);
    await choix.locator('.choix-chanson[data-chanson="s2"]').click();
    await choix.locator(".choix-valider", { hasText: "(3)" }).click();
    await waitFor(async () => (await chansons()).join() === "s3,s4,s2", "chanson ajoutée à la fin");
    await capture(page, "sons-mes-playlists");
    // La playlist d'avant : le morceau importé et les points d'un morceau gardés.
    await vieille.locator(".sons-playlist-choisir").click();
    await choix.locator('.choix-chanson[data-chanson="s4"]').click();
    await choix.locator(".choix-valider", { hasText: "(2)" }).click();
    await waitFor(async () => (await library("playlists/vieille/tracks"))?.length === 3, "morceau ajouté");
    const pistes = await library("playlists/vieille/tracks");
    assert.deepEqual(pistes.map((t) => [t.title, t.points ?? null]), [["Chanson 1", 300], ["Importée", null], ["Chanson 4", null]]);
    // Ses chansons décochées : le morceau importé reste.
    await vieille.locator(".sons-playlist-choisir").click();
    await choix.locator('.choix-chanson[data-chanson="s1"]').click();
    await choix.locator('.choix-chanson[data-chanson="s4"]').click();
    await choix.locator(".choix-valider", { hasText: "(0)" }).click();
    await waitFor(async () => (await library("playlists/vieille/tracks"))?.length === 1, "le morceau importé reste");
    // Vider une playlist : refusé, il faut la supprimer.
    await annees.locator(".sons-playlist-choisir").click();
    for (const k of ["s3", "s4", "s2"]) await choix.locator(`.choix-chanson[data-chanson="${k}"]`).click();
    await choix.locator(".choix-valider", { hasText: "(0)" }).click();
    assert.match(await repondreFenetre(page), /Une playlist garde au moins une chanson/);
    assert.equal((await library(`playlists/${id}/tracks`)).length, 3);
    // Renommer, Supprimer (avec confirmation).
    await annees.getByRole("button", { name: "Renommer" }).click();
    await repondreFenetre(page, { texte: "Années 90" });
    await annees.locator(".sons-playlist-voir", { hasText: "Années 90" }).waitFor();
    await annees.getByRole("button", { name: "Supprimer" }).click();
    assert.match(await repondreFenetre(page), /Supprimer la playlist « Années 90 »/);
    await annees.waitFor({ state: "detached" });
    assert.equal(await library(`playlists/${id}`), null);
    await page.context().close();
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
    await page.locator("#show-status-msg", { hasText: "Enregistrée en « À compléter » : pour passer en « À venir », il manque : Ajouter la date · Indiquer l'âge · Ajouter un jeu." }).waitFor();
    assert.equal(await page.inputValue("#show-status"), "brouillon");
    const noe = Object.values(await library("shows")).find((s) => s.childName === "Noé");
    assert.equal(noe.status, "brouillon");
    // Une date passée non plus (elle filerait directement dans les archivées).
    await page.fill("#show-age", "6");
    await page.fill("#show-date", day(-5));
    await ajouterJeu(page);
    await integrerQuiz(page.locator("#show-rounds .round").nth(0), "animaux", "anim");
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
    await deplierJeux(page);
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
    await deplierJeux(page);
    assert.equal(await page.inputValue("#show-title"), "Anniversaire de Léa");
    await page.click("#brand");
    await page.click('#screen-home [data-etat="acompleter"]');
    await page.locator('#show-list [data-show="perso"]').getByRole("button", { name: "Ouvrir" }).click();
    await deplierJeux(page);
    assert.equal(await page.inputValue("#show-title"), "La boum de Hugo");
    await page.fill("#show-child", "Hugo-Louis");
    assert.equal(await page.inputValue("#show-title"), "La boum de Hugo");
    await page.context().close();
  });

  test("Régie PC (cedric, 23/10) : une manche se crée d'abord ; « Reprendre » montre les 10 dernières prestations et cherche partout (mot, prénom, date, note)", async () => {
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
    const fr = (d) => d.split("-").reverse().join("/");
    const PRENOMS = ["Ana", "Ben", "Cléo", "Dan", "Eva", "Félix", "Gina", "Hugo", "Inès", "Jade", "Kenzo", "Lison"];
    await seedLibrary("playlists", { tubes: { title: "Tubes", duration: 20, tracks: [{ title: "Belle", audioId: "aaaaaaaaaaaaaaaa" }], updatedAt: 1 } });
    // 12 prestations, de la plus récente (hier) à la plus ancienne ; la 11e a une note sur sa manche, la 12e est archivée.
    await seedLibrary("shows", Object.fromEntries(PRENOMS.map((p, k) => [`s${k + 1}`, {
      childName: p, age: 8, date: day(-1 - k), status: k === 11 ? "archivee" : "publiee", updatedAt: 1,
      rounds: [{ type: "statues", duration: 60, ...(k === 10 ? { note: "Super avec les jumeaux" } : {}) }],
    }])));
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    // Un jeu dont la manche se reprend en entier (le Quiz, lui, en reprend les questions : voir le test du Quiz en une
    // manche ; les Mimes, eux, n'ont que le 🎲 ; le Blind test et le Quiz musical n'ont plus de manches, cedric 24/10).
    await ajouterJeu(page, "statues");
    const round = page.locator("#show-rounds .round").nth(0);
    // Créer d'abord : les champs de la manche, puis sa note, puis seulement « Reprendre ».
    assert.equal(await round.locator(".manche-load").count(), 0);
    assert.equal(await round.evaluate((r) => !!(r.querySelector(".round-body").compareDocumentPosition(r.querySelector(".reprendre-zone")) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
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
    await round.locator(".reprendre-groupe", { hasText: "1 partie trouvée" }).waitFor();
    await round.locator('.reprise-item[data-reprise="s11/0"]', { hasText: "📝 Super avec les jumeaux" }).waitFor();
    await cherche.fill("lison");
    await round.locator('.reprise-item[data-reprise="s12/0"]').waitFor();
    assert.equal(await round.locator(".reprise-item").count(), 1);
    await cherche.fill(fr(day(-12)));
    await round.locator('.reprise-item[data-reprise="s12/0"]').waitFor();
    assert.equal(await round.locator(".reprise-item").count(), 1);
    await cherche.fill("introuvable");
    await round.locator(".reprendre-groupe", { hasText: "Aucune partie ne correspond." }).waitFor();
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

  test("Régie PC (cedric, 23/10) : un Quiz = une seule manche ; compteur, 🎲 en tête, « Rappeler un de vos quiz » cherche le Quiz d'une prestation archivée, ordre au choix, Super Finale en dernière ligne", async () => {
    const { QUESTIONS_TOUT_PRETES } = await import("../web/public/banque-classiques.js");
    const { buildSnapshot } = await import("../web/public/show.js");
    const banque = new Map(QUESTIONS_TOUT_PRETES.map((x) => [x.id, x]));
    const tirees = [{ id: "x1", text: "Quelle est la capitale de l'Italie ?", choices: ["Rome", "Milan", "Naples", "Turin"], correct: 0 },
      { id: "x2", text: "Combien de jours dans une semaine ?", nombre: true, correct: 7 }];
    const TOM = { childName: "Tom", age: 9, date: "2026-03-01", status: "archivee", rounds: [{ type: "quiz", quizId: "animaux" }, { type: "statues", duration: 60 }], updatedAt: 1 };
    const LINA = { childName: "Lina", age: 8, date: "2026-09-12", status: "archivee", notes: "Thème licornes", rounds: [{ type: "quiz", tirees, profil: "MOYENS" }], updatedAt: 1 };
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    // Cinq autres prestations archivées avec un Quiz : la recherche n'en montre que 6.
    const autres = Object.fromEntries(["Noé", "Jade", "Hugo", "Anna", "Léo"].map((prenom, k) => [`autre${k}`,
      { childName: prenom, age: 6, date: `2025-0${k + 1}-15`, status: "archivee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 }]));
    await seedLibrary("shows", { tom: TOM, lina: LINA, ...autres, sans: { childName: "Ines", age: 7, date: "2026-02-01", status: "archivee", rounds: [{ type: "statues", duration: 60 }], updatedAt: 1 } });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await page.fill("#show-age", "10");
    await ajouterJeu(page);
    const bloc = page.locator('#show-rounds .jeu-bloc[data-jeu="quiz"]');
    const round = page.locator("#show-rounds .round").nth(0);
    const ligne = round.locator(".quiz-outils > .tirage-ligne");
    const compteur = round.locator(".round-head > .quiz-compteur");
    const series = round.locator(".quiz-series > li.serie");
    const origines = () => series.evaluateAll((xs) => xs.map((x) => x.dataset.origine));
    // Plus de « ＋ Manche » : le Quiz est une seule manche ; ni « ✍ Écrire une question » ni « ↺ Reprendre » (cedric, 23/10).
    assert.equal(await bloc.locator(".jeu-plus").count(), 0);
    assert.equal(await page.locator("#show-rounds .quiz-ecrire, #show-rounds .reprendre-ouvrir, #show-rounds .reprendre-zone").count(), 0);
    // Le compteur sur la ligne du numéro, en majuscules (cedric, 23/10). Puis, de haut en bas : les outils de création
    // ensemble (la ligne du dé : profil, nombre, 🎲, pas de ✕ ; « Rappeler un de vos quiz » ; « Intégrer un quiz de
    // votre bibliothèque »), la bougie, la Super Finale ; pas de note dans le Quiz.
    assert.deepEqual(await round.locator(".round-head > *").evaluateAll((xs) => xs.map((x) => x.className)), ["num", "quiz-compteur"]);
    assert.equal(await compteur.evaluate((x) => getComputedStyle(x).textTransform), "uppercase");
    assert.deepEqual(await round.locator(".round-body > *").evaluateAll((xs) => xs.map((x) => x.className)),
      ["quiz-outils", "check bougies quiz-bougies", "quiz-finale"]);
    assert.deepEqual(await round.locator(".quiz-outils > *").evaluateAll((xs) => xs.map((x) => x.className)),
      ["tirage-ligne", "quiz-ajouts quiz-rappel", "quiz-ajouts quiz-biblio"]);
    assert.deepEqual(await ligne.locator(":scope > *").evaluateAll((xs) => xs.map((x) => x.className)), ["tirage-profil", "tirage-nombre", "btn tirage-de"]);
    // « Rappeler un de vos quiz » : une case à gauche (pas un champ), une recherche à droite.
    const ajouts = round.locator(".quiz-rappel");
    assert.deepEqual(await ajouts.locator(":scope > *, :scope > .quiz-ajout-champ > *").evaluateAll((xs) => xs.map((x) => [x.tagName, x.className])),
      [["SPAN", "quiz-ajout-titre quiz-rappel-titre"], ["DIV", "quiz-ajout-champ"], ["INPUT", "quiz-ajout-cherche quiz-rappel-cherche"], ["DIV", "quiz-ajout-liste quiz-rappel-liste"]]);
    assert.equal(await ajouts.locator(".quiz-rappel-titre").textContent(), "📚 Rappeler un de vos quiz");
    assert.equal(await round.locator(".quiz-biblio-titre").textContent(), "📗 Intégrer un quiz de votre bibliothèque");
    assert.equal(await compteur.textContent(), "Aucune question pour l'instant");
    assert.equal(await ligne.locator(".tirage-nombre").inputValue(), "8");
    assert.equal(await ligne.locator(".tirage-profil").inputValue(), "MOYENS");
    // Super Finale d'office : oui, les 3 dernières, ×2.
    const finale = round.locator(".quiz-finale");
    assert.equal(await finale.locator(".finale-oui").inputValue(), "oui");
    assert.equal(await finale.locator("select.finale").inputValue(), "3");
    assert.equal(await finale.locator(".finale-facteur").inputValue(), "2");
    await capture(page, "quiz-manche-vide");
    // La recherche des prestations archivées qui ont un Quiz (cedric, 23/10) : rien tant qu'aucune lettre n'est tapée ;
    // ensuite elle filtre à chaque lettre (prénom, âge, date, notes), 6 au plus, dans une liste posée à droite par-dessus
    // l'écran (rien ne bouge en dessous).
    const cherche = ajouts.locator(".quiz-rappel-cherche");
    const liste = ajouts.locator(".quiz-rappel-liste");
    const trouvees = () => ajouts.locator(".quiz-rappel-item").evaluateAll((xs) => xs.map((x) => x.dataset.show));
    await cherche.click();
    assert.equal(await liste.isHidden(), true);
    assert.equal(await ajouts.locator(".quiz-rappel-item").count(), 0);
    const yBiblio = async () => (await round.locator(".quiz-biblio").boundingBox()).y;
    const avant = await yBiblio();
    await cherche.fill("anniversaire");
    await liste.waitFor();
    assert.equal((await trouvees()).length, 6, "6 au plus");
    assert.equal(await liste.evaluate((x) => getComputedStyle(x).position), "absolute");
    assert.equal(await yBiblio(), avant, "La liste ne pousse rien");
    await capture(page, "quiz-rappel-recherche", { pleinePage: false });
    if (process.env.CAPTURES) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await liste.scrollIntoViewIfNeeded();
      await capture(page, "quiz-rappel-recherche-pc", { pleinePage: false });
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await cherche.fill("tom");
    await waitFor(async () => JSON.stringify(await trouvees()) === '["tom"]', "recherche par prénom");
    assert.equal(await ajouts.locator('.quiz-rappel-item[data-show="tom"]').textContent(), "Anniversaire de Tom (1 mars 2026)01/03/2026 · 9 ans · 2 questions");
    await cherche.fill("");
    await liste.waitFor({ state: "hidden" });
    await cherche.fill("licornes");
    await waitFor(async () => JSON.stringify(await trouvees()) === '["lina"]', "recherche dans les notes");
    await cherche.fill("12/09/2026");
    await waitFor(async () => JSON.stringify(await trouvees()) === '["lina"]', "recherche par date");
    await cherche.fill("8 ans");
    await waitFor(async () => JSON.stringify(await trouvees()) === '["lina"]', "recherche par âge");
    await cherche.fill("introuvable");
    await ajouts.locator(".quiz-rappel-liste", { hasText: "Aucune prestation archivée ne correspond." }).waitFor();
    // Tom choisi : tout son Quiz en une série, repliée ; la prestation archivée ne change pas.
    await cherche.fill("tom");
    await ajouts.locator('.quiz-rappel-item[data-show="tom"]').click();
    await series.first().waitFor();
    assert.equal(await series.nth(0).locator(".serie-voir").textContent(), "▸ 📅 Anniversaire de Tom (1 mars 2026) : 2 questions");
    assert.equal(await compteur.textContent(), "2 questions, dont 2 en Super Finale, plus la question des bougies");
    // Puis le dé : ses questions viennent en premier dans la liste.
    await ligne.locator(".tirage-profil").selectOption("GRANDS");
    await ligne.locator(".tirage-nombre").selectOption("10");
    await ligne.locator(".tirage-de").click();
    await waitFor(async () => (await series.count()) === 2, "série du dé");
    assert.deepEqual(await origines(), ["de", "reprise"]);
    const voirDe = series.nth(0).locator(".serie-voir");
    assert.equal(await voirDe.textContent(), "▸ 🎲 10 questions tirées au hasard (Grands)");
    assert.equal(await compteur.textContent(), "12 questions, dont 3 en Super Finale, plus la question des bougies");
    assert.equal(await series.nth(0).locator(".serie-liste").isHidden(), true);
    await voirDe.click();
    const lignes = series.nth(0).locator(".serie-liste > li");
    assert.equal(await lignes.count(), 10);
    // Des Juste Chiffre, une question sur quatre environ (10 → 2), jamais la première ; la Super Finale (3 dernières de
    // toute la manche) tombe sur la dernière tirée et les 2 de Tom.
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
    await series.nth(0).locator(".serie-liste li.vide").waitFor();
    assert.equal(await series.nth(0).locator(".serie-voir").textContent(), "▾ 🎲 9 questions tirées au hasard (Grands), 1 à tirer");
    assert.equal(await compteur.textContent(), "11 questions, dont 3 en Super Finale, plus la question des bougies · 1 à tirer");
    await lignes.nth(0).locator(".tirage-de").click();
    await series.nth(0).locator(".serie-liste li.vide").waitFor({ state: "detached" });
    assert.notEqual(await lignes.nth(0).locator(".tirage-texte").textContent(), retiree);
    // Une question retirée puis 9 questions : le 🎲 disparaît, les autres restent ; 8 : une de moins à la fin.
    const dix = await lignes.allTextContents();
    await lignes.nth(0).locator(".tirage-retirer").click();
    await series.nth(0).locator(".serie-liste li.vide").waitFor();
    await ligne.locator(".tirage-nombre").selectOption("9");
    assert.equal(await series.nth(0).locator(".serie-liste li.vide").count(), 0);
    assert.equal(await lignes.count(), 9);
    await ligne.locator(".tirage-nombre").selectOption("8");
    assert.equal(await lignes.count(), 8);
    assert.deepEqual((await lignes.allTextContents()).map((t) => t.replace("🏆 ×2", "")).slice(0, 5), dix.slice(1, 6));
    // Le Quiz de Tom se détaille comme les questions tirées : photo ou émoji, ✕ par question, mais pas de 🎲.
    const tom = series.nth(1);
    await tom.locator(".serie-voir").click();
    assert.equal(await tom.locator(".serie-liste > li").count(), 2);
    await tom.locator(".serie-liste > li", { hasText: "Combien de pattes" }).locator(".tirage-retirer").click();
    assert.equal(await tom.locator(".serie-voir").textContent(), "▾ 📅 Anniversaire de Tom (1 mars 2026) : 1 question");
    assert.equal(await tom.locator(".serie-liste li.vide, .serie-liste .tirage-de").count(), 0);
    // Lina en plus : à la fin ; ↑ ↓ changent l'ordre, le dé compris.
    await cherche.fill("lina");
    await ajouts.locator('.quiz-rappel-item[data-show="lina"]').click();
    await waitFor(async () => (await series.count()) === 3, "Lina ajoutée");
    assert.deepEqual(await origines(), ["de", "reprise", "reprise"]);
    assert.equal(await series.nth(0).locator(".serie-monter").isDisabled(), true);
    await series.nth(0).locator(".serie-descendre").click();
    assert.deepEqual(await series.evaluateAll((xs) => xs.map((x) => x.querySelector(".serie-voir").textContent.replace(/^[▸▾] /, "").split(" :")[0])),
      ["📅 Anniversaire de Tom (1 mars 2026)", "🎲 8 questions tirées au hasard (Grands)", "📅 Anniversaire de Lina (12 sept. 2026)"]);
    assert.equal(await compteur.textContent(), "11 questions, dont 3 en Super Finale, plus la question des bougies");
    // Super Finale : les 2 dernières, ×3.
    await finale.locator("select.finale").selectOption("2");
    await finale.locator(".finale-facteur").selectOption("3");
    assert.equal(await compteur.textContent(), "11 questions, dont 2 en Super Finale, plus la question des bougies");
    await capture(page, "quiz-manche-series");
    if (process.env.CAPTURES) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await capture(page, "quiz-manche-series-pc");
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const shows = await library("shows");
    assert.deepEqual([shows.tom, shows.lina], [TOM, LINA], "Les prestations archivées ne changent pas");
    const zoe = Object.values(shows).find((s) => s.childName === "Zoé");
    assert.equal(zoe.rounds.length, 1);
    const [manche] = zoe.rounds;
    assert.deepEqual(manche.seriesQuiz.map((x) => [x.origine, x.titre ?? null, x.questions.length]),
      [["reprise", "Anniversaire de Tom (1 mars 2026)", 1], ["de", null, 8], ["reprise", "Anniversaire de Lina (12 sept. 2026)", 2]]);
    assert.equal(manche.finale, 2);
    assert.equal(manche.facteur, 3);
    assert.equal(manche.tirees, undefined);
    assert.equal(manche.quizId, undefined);
    const de = manche.seriesQuiz[1];
    assert.equal(de.profil, "GRANDS");
    for (const q of de.questions) assert.equal(banque.get(q.id).niveau, 3, "Grands : niveau Difficile");
    assert.deepEqual(manche.seriesQuiz[2].questions, tirees.map(({ id, ...q }) => q));
    // Sur la TV : un seul jeu, dans l'ordre choisi ; la bougie juste avant la Super Finale.
    const { snapshot } = buildSnapshot("zoe", zoe, { animaux: ANIMAUX });
    const qs = snapshot.quiz.questions;
    assert.equal(new Set(qs.map((q) => q.round)).size, 1, "Un seul jeu");
    assert.equal(qs.length, 1 + 8 + 2 + 1);
    assert.equal(qs[0].text, "Roi de la jungle ?");
    assert.equal(qs[1].text, de.questions[0].text);
    assert.equal(qs.at(-3).text, "Le Juste Chiffre : combien de bougies sur le gâteau de Zoé cette année ?");
    assert.deepEqual(qs.slice(-2).map((q) => q.text), tirees.map((q) => q.text));
    assert.deepEqual(qs.slice(-2).map((q) => q.finale), [true, true]);
    assert.deepEqual(snapshot.facteurs, { [qs.at(-2).id]: 3 });
    // Rouverte : la ✕ de la série tirée n'enlève qu'elle ; la ligne du dé reste.
    await page.click("#show-edit-crumb");
    await page.locator(".show-card", { hasText: "Zoé" }).first().click();
    await deplierJeux(page);
    await series.nth(2).waitFor();
    await round.locator('.quiz-series > li.serie[data-origine="de"] .serie-enlever').click();
    assert.match(await repondreFenetre(page), /Enlever cette série \(8 questions\) du jeu \?/);
    await round.locator('.quiz-series > li.serie[data-origine="de"]').waitFor({ state: "detached" });
    assert.deepEqual(await origines(), ["reprise", "reprise"]);
    assert.equal(await round.locator(".tirage-ligne .tirage-de").count(), 1);
    // Une série enlevée (✕ de la série) : demandé d'abord.
    await series.nth(1).locator(".serie-enlever").click();
    assert.match(await repondreFenetre(page, { accepter: false }), /Enlever cette série \(2 questions\) du jeu \?/);
    assert.equal(await series.count(), 2);
    await page.context().close();
  });

  test("Régie PC (cedric, 23/10) : « Intégrer un quiz de votre bibliothèque » ; en dernière ligne le « Quiz complet », tout dans l'ordre de passage : ↑ ↓, ✕, 🔀, l'ordre gardé jusqu'à la TV", async () => {
    const { buildSnapshot } = await import("../web/public/show.js");
    const tirees = [{ id: "x1", text: "Quelle est la capitale de l'Italie ?", choices: ["Rome", "Milan", "Naples", "Turin"], correct: 0 },
      { id: "x2", text: "Combien de jours dans une semaine ?", nombre: true, correct: 7 }];
    // Seulement ses quiz à 4 réponses (cedric, 23/10) : ni Vrai ou Faux, ni quiz d'images, ni quiz de test.
    const FLOU = { title: "Photos floues", source: "photos", updatedAt: 1, questions: [{ text: "Qu'est-ce qui se cache sous le flou ?", choices: ["Chat", "Chien", "Lion", "Ours"], correct: 0, imageId: "0123456789abcdef", status: "validee" }] };
    const DE_TEST = { ...ESPACE, title: "TEST – Espace de Léa" };
    await seedLibrary("quizzes", { animaux: ANIMAUX, espace: ESPACE, finale: FINALE, flou: FLOU, "test-espace": DE_TEST });
    await seedLibrary("shows", { lina: { childName: "Lina", age: 8, date: "2026-09-12", status: "archivee", rounds: [{ type: "quiz", tirees, profil: "MOYENS" }], updatedAt: 1 } });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await page.fill("#show-age", "10");
    await ajouterJeu(page);
    const round = page.locator("#show-rounds .round").nth(0);
    const series = round.locator(".quiz-series > li.serie");
    const biblio = round.locator(".quiz-biblio");
    // Pas de « Quiz complet » sans question.
    assert.equal(await round.locator(".quiz-complet").count(), 0);
    // La bibliothèque : rien avant la première lettre, puis le titre (ou le thème) de ses quiz à 4 réponses.
    const cherche = biblio.locator(".quiz-biblio-cherche");
    await cherche.click();
    assert.equal(await biblio.locator(".quiz-biblio-liste").isHidden(), true);
    await cherche.fill("sciences");
    await biblio.locator('.quiz-biblio-item[data-quiz="espace"]').waitFor();
    assert.deepEqual(await biblio.locator(".quiz-biblio-item").evaluateAll((xs) => xs.map((x) => x.dataset.quiz)), ["espace"]);
    assert.equal(await biblio.locator('.quiz-biblio-item[data-quiz="espace"]').textContent(), "Espace1 question · Sciences");
    for (const mot of ["finale", "flou", "test"]) {
      await cherche.fill(mot);
      await biblio.locator(".quiz-biblio-liste", { hasText: "Aucun quiz de la bibliothèque ne correspond." }).waitFor();
    }
    // Animaux de la bibliothèque, le Quiz de Lina (prestation archivée), puis Espace : à la suite.
    await integrerQuiz(round, "animaux", "anim");
    assert.equal(await series.nth(0).locator(".serie-voir").textContent(), "▸ 📚 Quiz « Animaux » : 2 questions");
    await round.locator(".quiz-rappel-cherche").fill("lina");
    await round.locator('.quiz-rappel-item[data-show="lina"]').click();
    await series.nth(1).waitFor();
    await integrerQuiz(round, "espace", "esp");
    await round.locator(".quiz-biblio-cherche").fill("anim");
    await round.locator('.quiz-biblio-item[data-quiz="animaux"]', { hasText: "✓ déjà dans ce Quiz" }).waitFor();
    await round.locator(".quiz-biblio-cherche").fill("");
    // Le « Quiz complet » : la dernière ligne, repliée ; dépliée, toutes les questions numérotées dans l'ordre de passage,
    // celle des bougies comprise (cedric, 23/10), d'office juste avant la Super Finale (3 dernières).
    assert.deepEqual(await round.locator(".round-body > *").evaluateAll((xs) => xs.map((x) => x.className)),
      ["quiz-outils", "quiz-series", "check bougies quiz-bougies", "quiz-finale", "serie quiz-complet"]);
    const complet = round.locator(".quiz-complet");
    const voir = complet.locator(".quiz-complet-voir");
    assert.equal(await voir.textContent(), "▸ 🧩 Quiz complet : 6 questions, dans l'ordre de passage");
    assert.equal(await complet.locator(".quiz-complet-liste").isHidden(), true);
    await voir.click();
    const lignes = complet.locator(".quiz-complet-liste > li");
    const ordre = () => complet.locator(".quiz-complet-q .tirage-texte").allTextContents();
    const BOUGIES = "🎂 🔢 Le Juste Chiffre : combien de bougies sur le gâteau de Zoé cette année ?";
    assert.deepEqual(await lignes.evaluateAll((xs) => xs.map((x) => [x.querySelector(".quiz-complet-num").textContent, x.querySelector(".tirage-texte").textContent])), [
      ["1", "Roi de la jungle ?"], ["2", "Combien de pattes a une araignée ?"], ["3", BOUGIES],
      ["4", "Quelle est la capitale de l'Italie ?"], ["5", "🔢 Combien de jours dans une semaine ?"], ["6", "Quelle planète est la plus proche du Soleil ?"]]);
    assert.deepEqual(await complet.locator(".quiz-complet-q").evaluateAll((xs) => xs.map((x) => x.classList.contains("en-finale"))), [false, false, false, true, true, true]);
    assert.equal(await complet.locator(".quiz-complet-bougies").locator(".quiz-complet-monter, .quiz-complet-descendre, .tirage-retirer").count(), 3);
    assert.equal(await complet.locator(".quiz-complet-q").first().locator(".quiz-complet-monter").isDisabled(), true);
    // ↓ sur la première, ↑ sur la dernière : l'ordre change, la Super Finale reste sur les 3 dernières, les bougies juste avant.
    await complet.locator(".quiz-complet-q").nth(0).locator(".quiz-complet-descendre").click();
    assert.deepEqual(await ordre(), ["Combien de pattes a une araignée ?", "Roi de la jungle ?", BOUGIES, "Quelle est la capitale de l'Italie ?", "🔢 Combien de jours dans une semaine ?", "Quelle planète est la plus proche du Soleil ?"]);
    await complet.locator(".quiz-complet-q").nth(5).locator(".quiz-complet-monter").click();
    assert.deepEqual(await ordre(), ["Combien de pattes a une araignée ?", "Roi de la jungle ?", BOUGIES, "Quelle est la capitale de l'Italie ?", "Quelle planète est la plus proche du Soleil ?", "🔢 Combien de jours dans une semaine ?"]);
    // Dans les séries aussi, la Super Finale suit l'ordre de passage.
    await series.nth(1).locator(".serie-voir").click();
    assert.deepEqual(await series.nth(1).locator(".serie-liste > li").evaluateAll((xs) => xs.map((x) => x.classList.contains("en-finale"))), [true, true]);
    // ✕ : la question part du quiz (ici retirée du quiz de la bibliothèque, qui ne change pas).
    await complet.locator(".quiz-complet-q", { hasText: "Roi de la jungle" }).locator(".tirage-retirer").click();
    assert.deepEqual(await ordre(), ["Combien de pattes a une araignée ?", BOUGIES, "Quelle est la capitale de l'Italie ?", "Quelle planète est la plus proche du Soleil ?", "🔢 Combien de jours dans une semaine ?"]);
    assert.equal(await series.nth(0).locator(".serie-voir").textContent(), "▸ 📚 Quiz « Animaux » : 1 question (1 retirée)");
    assert.equal(await round.locator(".round-head > .quiz-compteur").textContent(), "4 questions, dont 3 en Super Finale, plus la question des bougies");
    // Une série descendue : ses questions passent ensemble, chacune dans son ordre ; les bougies suivent la Super Finale.
    await series.nth(0).locator(".serie-descendre").click();
    assert.deepEqual(await ordre(), ["Quelle est la capitale de l'Italie ?", BOUGIES, "🔢 Combien de jours dans une semaine ?", "Combien de pattes a une araignée ?", "Quelle planète est la plus proche du Soleil ?"]);
    // Les bougies se rangent à la main, comme les autres : montées en tête, elles y restent quand une série bouge.
    await complet.locator(".quiz-complet-bougies .quiz-complet-monter").click();
    assert.deepEqual(await ordre(), [BOUGIES, "Quelle est la capitale de l'Italie ?", "🔢 Combien de jours dans une semaine ?", "Combien de pattes a une araignée ?", "Quelle planète est la plus proche du Soleil ?"]);
    await series.nth(1).locator(".serie-monter").click();
    assert.deepEqual(await ordre(), [BOUGIES, "Combien de pattes a une araignée ?", "Quelle est la capitale de l'Italie ?", "🔢 Combien de jours dans une semaine ?", "Quelle planète est la plus proche du Soleil ?"]);
    await series.nth(0).locator(".serie-descendre").click();
    // 🔀 : tout est mélangé, les bougies aussi.
    const avant = await ordre();
    await complet.locator(".quiz-melanger").click();
    const melange = await ordre();
    assert.notDeepEqual(melange, avant);
    assert.deepEqual([...melange].sort(), [...avant].sort());
    await capture(page, "quiz-complet");
    if (process.env.CAPTURES) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await capture(page, "quiz-complet-pc");
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const zoe = Object.values(await library("shows")).find((s) => s.childName === "Zoé");
    assert.equal(zoe.rounds[0].ordreQuiz.length, 5);
    assert.deepEqual((await library("quizzes/animaux")).questions, ANIMAUX.questions, "Le quiz de la bibliothèque ne change pas");
    // Sur la TV : exactement l'ordre rangé, bougies comprises ; la Super Finale sur les 3 dernières questions du quiz.
    const { snapshot } = buildSnapshot("zoe", zoe, { animaux: ANIMAUX, espace: ESPACE });
    const sansSigne = (t) => t.replace(/^(🎂 )?(🔢 )?/, "");
    const qs = snapshot.quiz.questions.map((q) => q.text);
    assert.deepEqual(qs, melange.map(sansSigne));
    const finaleTv = snapshot.quiz.questions.filter((q) => q.finale).map((q) => q.text);
    assert.deepEqual(finaleTv, qs.filter((t) => !/bougies/.test(t)).slice(-3));
    // Rouverte : le même ordre ; un nouveau tirage au 🎲 passe en tête, l'ordre rangé suit.
    await page.click("#show-edit-crumb");
    await page.locator(".show-card", { hasText: "Zoé" }).first().click();
    await deplierJeux(page);
    await series.nth(2).waitFor();
    await voir.click();
    assert.deepEqual(await ordre(), melange);
    await round.locator(".tirage-de").click();
    await waitFor(async () => (await series.count()) === 4, "série du dé");
    const tout = await ordre();
    assert.equal(tout.length, 13);
    assert.deepEqual(tout.slice(8), melange);
    // ✕ sur les bougies : la case se décoche ; recochée, la question revient juste avant la Super Finale.
    const caseBougies = round.locator(".quiz-bougies input");
    await complet.locator(".quiz-complet-bougies .tirage-retirer").click();
    assert.equal(await caseBougies.isChecked(), false);
    assert.equal((await ordre()).includes(BOUGIES), false);
    await caseBougies.check();
    const remise = await ordre();
    assert.equal(remise.length, 13);
    assert.equal(remise.indexOf(BOUGIES), 9);
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
    await deplierJeux(page);
    await page.locator("#show-status-msg", { hasText: "Les manches Quiz qui se suivaient n'en font plus qu'une" }).waitFor();
    assert.equal(await page.locator('#show-rounds .jeu-bloc[data-jeu="quiz"] .round').count(), 1);
    const round = page.locator('#show-rounds .jeu-bloc[data-jeu="quiz"] .round');
    assert.deepEqual(await round.locator(".quiz-series > li.serie").evaluateAll((xs) => xs.map((x) => x.dataset.origine)), ["quiz", "de"]);
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
    assert.deepEqual(malo.rounds[0].seriesQuiz.map((x) => [x.origine, x.quizId ?? null, x.questions?.length ?? null]), [["quiz", "animaux", null], ["de", null, 2]]);
    await page.context().close();
  });

  test("Régie PC (cedric, 23 et 24/10) : chaque jeu se replie en une ligne (▸ / ▾), ↑ ↓ ✕ toujours là pour ranger les jeux ; tous repliés en ouvrant une prestation, un jeu ajouté s'ouvre", async () => {
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
    await seedLibrary("quizzes", { animaux: ANIMAUX });
    await seedLibrary("shows", {
      jeux: { childName: "Lou", age: 9, date: day(10), status: "publiee", updatedAt: 1,
        rounds: [{ type: "quiz", quizId: "animaux", finale: 1 }, { type: "statues", duration: 60 }] },
    });
    const page = await admin();
    await page.click('#screen-home [data-etat="avenir"]');
    await page.locator('#show-list [data-show="jeux"]').getByRole("button", { name: "Ouvrir" }).click();
    const bloc = (jeu) => page.locator(`#show-rounds .jeu-bloc[data-jeu="${jeu}"]`);
    const quiz = bloc("quiz");
    const statues = bloc("statues");
    // Replié d'office en ouvrant la prestation (cedric, 24/10) : une ligne, son résumé, ↑ ↓ ✕ toujours là.
    await quiz.locator(".jeu-resume").waitFor();
    assert.deepEqual(await page.locator("#show-rounds .jeu-bloc").evaluateAll((xs) => xs.map((x) => [x.dataset.jeu, x.classList.contains("replie")])), [["quiz", true], ["statues", true]]);
    assert.equal(await page.locator("#show-rounds .round").count(), 0);
    // ▸ déplie, ▾ replie.
    await quiz.locator(".jeu-replier").click();
    await quiz.locator(".round").waitFor();
    assert.equal(await quiz.locator(".jeu-replier").textContent(), "▾");
    assert.equal(await quiz.locator(".jeu-replier").getAttribute("aria-expanded"), "true");
    assert.equal(await statues.locator(".round").count(), 0, "les autres restent repliés");
    await quiz.locator(".jeu-replier").click();
    assert.equal(await quiz.locator(".round").count(), 0);
    assert.equal(await quiz.locator(".jeu-replier").textContent(), "▸");
    assert.equal(await quiz.locator(".jeu-replier").getAttribute("aria-expanded"), "false");
    assert.equal(await quiz.locator(".jeu-resume").textContent(), "2 questions, dont la dernière en Super Finale, plus la question des bougies");
    assert.deepEqual(await quiz.locator(".jeu-tete > button").evaluateAll((xs) => xs.map((x) => x.textContent)), ["▸", "↑", "↓", "✕"]);
    assert.equal(await statues.locator(".jeu-resume").textContent(), "60 s · musique de la fête");
    assert.equal(await statues.locator(".jeu-plus").count(), 0, "Replié : pas de « ＋ Manche »");
    await capture(page, "jeux-replies");
    if (process.env.CAPTURES) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await capture(page, "jeux-replies-pc");
      await page.setViewportSize({ width: 390, height: 844 });
    }
    // Les jeux repliés se rangent : chacun reste replié.
    await statues.getByTitle("Monter ce jeu").click();
    assert.deepEqual(await page.locator("#show-rounds .jeu-bloc").evaluateAll((xs) => xs.map((x) => [x.dataset.jeu, x.classList.contains("replie")])), [["statues", true], ["quiz", true]]);
    // ▸ déplie ; rien de tout ça n'est enregistré.
    await quiz.locator(".jeu-replier").click();
    await quiz.locator(".quiz-outils").waitFor();
    assert.equal(await statues.locator(".round").count(), 0);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const lou = (await library("shows")).jeux;
    assert.deepEqual(lou.rounds.map((r) => r.type), ["statues", "quiz"]);
    assert.equal(JSON.stringify(lou).includes("repli"), false);
    assert.equal(JSON.stringify(lou).includes("ouvert"), false);
    // Un jeu ajouté s'ouvre, pour le remplir ; Ctrl+Z le retire, le Quiz déplié le reste.
    await ajouterJeu(page, "mimes");
    await bloc("mimes").locator(".round").waitFor();
    assert.deepEqual(await page.locator("#show-rounds .jeu-bloc").evaluateAll((xs) => xs.map((x) => [x.dataset.jeu, x.classList.contains("replie")])), [["statues", true], ["quiz", false], ["mimes", false]]);
    await page.locator("#show-edit-title").click();
    await page.keyboard.press("Control+z");
    await waitFor(async () => (await page.locator("#show-rounds .jeu-bloc").count()) === 2, "le jeu ajouté retiré");
    assert.deepEqual(await page.locator("#show-rounds .jeu-bloc").evaluateAll((xs) => xs.map((x) => [x.dataset.jeu, x.classList.contains("replie")])), [["statues", true], ["quiz", false]]);
    // Plus de manches (cedric, 24/10) : ni « 1 manche » ni « ＋ Manche » ; deux fois le même jeu, ce sont deux jeux.
    await ajouterJeu(page, "coffres");
    await ajouterJeu(page, "coffres");
    await waitFor(async () => (await page.locator('#show-rounds .jeu-bloc[data-jeu="coffres"]').count()) === 2, "deux jeux de coffres");
    assert.equal(await page.locator("#show-rounds .jeu-nb, #show-rounds .jeu-plus").count(), 0);
    assert.equal(await page.locator('#show-rounds .jeu-bloc[data-jeu="coffres"] button[title="Retirer ce jeu"]').count(), 2);
    assert.equal(await page.locator("#show-rounds").innerText().then((t) => /manche/i.test(t)), false, "le mot « manche » n'apparaît plus");
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
    await deplierJeux(page);
    assert.deepEqual(await choix(), ["À compléter", "À venir"]);
    assert.equal(await page.inputValue("#show-status"), "publiee");
    // Archivée d'elle-même (date passée) : « Archivée » est montré, et on peut la remettre « À venir ».
    await page.click("#brand");
    await page.click('#screen-home [data-etat="archivee"]');
    await page.locator('#show-list [data-show="passee"]').getByRole("button", { name: "Ouvrir" }).click();
    await deplierJeux(page);
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
    const LEA = { childName: "Léa", age: 7, date: "2026-03-01", status: "archivee", rounds: [{ type: "quiz", quizId: "animaux" }, { type: "finale", quizId: "finale" }, { type: "statues", duration: 90 }], updatedAt: 1 };
    await seedLibrary("shows", { lea: LEA });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    // Le jeu ajouté : « ↺ Reprendre une partie déjà faite » propose celles des autres prestations (pas le Quiz, cedric 23/10).
    await ajouterJeu(page, "statues");
    const round = page.locator("#show-rounds .round").nth(0);
    await round.locator(".reprendre-ouvrir").click();
    const lea2 = round.locator('.reprise-item[data-reprise="lea/2"]');
    await lea2.waitFor();
    // Ni le Quiz ni l'ancienne manche « Super Finale » ne se reprennent ici.
    assert.equal(await round.locator('.reprise-item[data-reprise="lea/0"], .reprise-item[data-reprise="lea/1"]').count(), 0);
    assert.equal(await round.locator(".reprise-item", { hasText: "Super Finale" }).count(), 0);
    await lea2.click();
    assert.equal(await page.locator("#show-rounds .round").nth(0).locator('select[aria-label="Durée"]').inputValue(), "90");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée." }).waitFor();
    // Elle est gardée dans la page de son jeu, rattachée à la nouvelle prestation ; l'ancienne prestation ne change pas.
    const shows = await library("shows");
    const [zoeId, zoe] = Object.entries(shows).find(([, s]) => s.childName === "Zoé");
    const [mid, manche] = Object.entries(await library("manches"))[0];
    assert.deepEqual(zoe.rounds, [{ type: "statues", duration: 90, mancheId: mid }]);
    assert.deepEqual([manche.round, manche.showId, manche.title], [{ type: "statues", duration: 90 }, zoeId, "Statues musicales · Anniversaire de Zoé"]);
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
    await deplierJeux(page);
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
    await deplierJeux(page);
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

  test("prestation de test (cedric, 24/10) : un seul bouton efface les anciennes démos et rien d'autre, puis refait les 16 jeux au 🎲 ; un nouveau clic la refait à neuf ; la TV la charge", async () => {
    const hex = (n) => n.toString(16).padStart(16, "0");
    // Les chansons de Sarah (avec leurs extraits) : le blind test et le quiz musical se tirent dedans.
    const songs = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`s${i}`, {
      title: `Chanson ${i}`, artist: `Artiste ${i}`, audioId: hex(100 + i), buzz: 30, createdAt: 1, updatedAt: 1,
      refrainId: hex(200 + i), refrain: 60, paroles: `0|La la ${i}`,
    }]));
    await seedLibrary("songs", songs);
    const son = "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA";
    await seedLibrary("sounds", { ...Object.fromEntries(Object.values(songs).flatMap((s) => [[s.audioId, son], [s.refrainId, son]])), ["b".repeat(16)]: son });
    const photo = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
    // Les anciennes démos : leurs prestations, quiz, mimes, playlist, photo dessinée, comptine et manche gardée.
    const zoom = { title: "TEST – Photos du Zoom mystère", source: "saisie", updatedAt: 1, questions: [
      { text: "Quel animal ?", choices: ["Le lion", "Le chat"], correct: 0, status: "validee", imageId: "a".repeat(16) },
      { text: "Quoi ?", choices: ["Une fusée", "Un train"], correct: 0, status: "validee", imageId: "c".repeat(16) }] };
    await seedLibrary("quizzes", { animaux: ANIMAUX, "test-lea-9-ans": { ...ANIMAUX, title: "TEST – Quiz de Léa (9 ans)" }, "test-lea-tous-les-jeux-zoom": zoom });
    await seedLibrary("mimes/test-lea-tous-les-jeux-mimes", { title: "TEST – Mimes de Léa", duration: 45, updatedAt: 1, cards: [{ word: "Chat", image: "🐱" }] });
    await seedLibrary("playlists/test-lea-tous-les-jeux-comptines", { title: "TEST – Comptines", duration: 20, updatedAt: 1, tracks: [{ title: "Frère Jacques", audioId: "b".repeat(16) }] });
    await seedLibrary("images", { ["a".repeat(16)]: photo, ["c".repeat(16)]: photo });
    // La seconde photo, Sarah l'a rangée dans « Mes images » : elle reste.
    await seedLibrary("medias", { ["c".repeat(16)]: { name: "Fusée", cat: "Espace", createdAt: 1 } });
    const vieille = { childName: "Léa", age: 9, status: "publiee", title: "ANNIVERSAIRE TEST – Léa, 9 ans · tous les jeux", origin: "test", updatedAt: 1,
      rounds: [{ type: "zoom", quizId: "test-lea-tous-les-jeux-zoom" }, { type: "mimes", deckId: "test-lea-tous-les-jeux-mimes" }, { type: "blind", playlistId: "test-lea-tous-les-jeux-comptines" }] };
    const INES = { childName: "Inès", status: "publiee", rounds: [{ type: "quiz", quizId: "animaux" }], updatedAt: 1 };
    // Une copie que Sarah a faite d'une démo : la sienne, avec le quiz qu'elle joue.
    const COPIE = { childName: "Tom", status: "brouillon", copieDe: "test-lea-9-ans", rounds: [{ type: "quiz", quizId: "test-lea-9-ans" }], updatedAt: 1 };
    await seedLibrary("shows", { "test-lea-tous-les-jeux": vieille, "test-lea-9-ans": { ...vieille, title: "ANNIVERSAIRE TEST – Léa, 9 ans", rounds: [{ type: "quiz", quizId: "test-lea-9-ans" }] }, ines: INES, copie: COPIE });
    await seedLibrary("manches", {
      "m-demo": { type: "zoom", title: "Zoom · démo", showId: "test-lea-tous-les-jeux", round: vieille.rounds[0], updatedAt: 1 },
      "m-ines": { type: "quiz", title: "Quiz · Inès", showId: "ines", round: INES.rounds[0], updatedAt: 1 },
    });

    const page = await admin();
    await page.click("#nav button[data-screen=settings]");
    assert.equal(await page.locator("#test-panel button").count(), 1, "un seul bouton");
    // Annuler : rien ne bouge.
    await page.click("#test-prestation");
    await repondreFenetre(page, { accepter: false });
    assert.ok((await library("shows"))["test-lea-tous-les-jeux"]);
    await page.click("#test-prestation");
    const message = await repondreFenetre(page);
    assert.match(message, /Créer la prestation de test \?/);
    assert.match(message, /2 prestations de test : « ANNIVERSAIRE TEST – Léa, 9 ans · tous les jeux », « ANNIVERSAIRE TEST – Léa, 9 ans »|2 prestations de test : « ANNIVERSAIRE TEST – Léa, 9 ans », « ANNIVERSAIRE TEST – Léa, 9 ans · tous les jeux »/);
    assert.match(message, /1 quiz de démo, 1 paquet de mimes de démo, 1 playlist de démo/);
    assert.match(message, /1 manche gardée pour elles/);
    assert.match(message, /leurs photos dessinées et comptines \(2 fichiers\)/);
    // La prestation s'ouvre, remplie, et s'enregistre « À venir ».
    await page.locator("#show-status-msg", { hasText: "Enregistrée « À venir »" }).waitFor({ timeout: 30000 });
    await page.locator("#show-edit-title", { hasText: "ANNIVERSAIRE TEST – Touktouka, 9 ans" }).waitFor();
    assert.equal(await page.locator("#show-rounds .jeu-bloc").count(), 16);
    assert.equal(await page.locator("#show-rounds .jeu-bloc.replie").count(), 16, "tout replié : une ligne par jeu");
    assert.equal(await page.locator("#show-rounds .alerte-equipes").count(), 0, "chaque équipe a ses images et ses mots");
    await capture(page, "prestation-de-test");

    let shows = await library("shows");
    assert.deepEqual(Object.keys(shows).sort(), ["copie", "ines", "test-prestation"], "les anciennes démos effacées, les prestations de Sarah gardées");
    assert.deepEqual(shows.ines, INES);
    assert.deepEqual(shows.copie, COPIE);
    const fete = shows["test-prestation"];
    assert.deepEqual([fete.childName, fete.age, fete.teams, fete.date, fete.status, fete.origin, fete.title],
      ["Touktouka", 9, 4, isoDay(), "publiee", "test", "ANNIVERSAIRE TEST – Touktouka, 9 ans"]);
    assert.deepEqual(fete.rounds.map((r) => r.type), ["quiz", "mimes", "blind", "zoom", "chante", "express", "illustre", "quisuis",
      "flou", "disparu", "musical", "statues", "pictionary", "gonfleur", "patate", "coffres"]);
    // Chaque jeu rempli par son 🎲.
    const jeu = Object.fromEntries(fete.rounds.map((r) => [r.type, r]));
    for (const t of ["quiz", "zoom", "express", "illustre", "flou"]) assert.ok(jeu[t].seriesQuiz[0].questions.length >= 3, `${t} tiré au 🎲`);
    for (const t of ["chante", "quisuis", "disparu"]) assert.ok(jeu[t].seriesMots[0].mots.length >= 2, `${t} tiré au 🎲`);
    assert.equal(jeu.mimes.equipes.length, 4);
    assert.ok(jeu.mimes.equipes.every((l) => l.length > 0), "des images pour chaque équipe");
    assert.equal(jeu.pictionary.tours.length, 4);
    assert.ok(jeu.pictionary.tours.every((l) => l.length > 0), "des mots pour chaque équipe");
    assert.ok(jeu.blind.chansons.length > 0 && jeu.musical.chansons.length > 0);
    assert.ok(!jeu.musical.chansons.some((k) => jeu.blind.chansons.includes(k)), "jamais deux fois la même chanson");
    // Rien d'autre n'est touché ; les démos qui servent encore restent.
    const quizzes = await library("quizzes");
    assert.deepEqual(Object.keys(quizzes).sort(), ["animaux", "test-lea-9-ans"], "le quiz de la copie de Tom reste");
    assert.equal(await library("mimes/test-lea-tous-les-jeux-mimes"), null);
    assert.equal(await library("playlists/test-lea-tous-les-jeux-comptines"), null);
    assert.deepEqual(Object.keys(await library("images")), ["c".repeat(16)], "la photo rangée par Sarah reste");
    const sons = await library("sounds");
    assert.equal(sons["b".repeat(16)], undefined, "la comptine part");
    assert.equal(Object.keys(sons).length, 48, "les extraits des chansons restent");
    assert.equal(Object.keys(await library("songs")).length, 24);
    let manches = await library("manches");
    assert.equal(manches["m-demo"], undefined);
    assert.ok(manches["m-ines"]);
    const gardees = Object.values(manches).filter((m) => m.showId === "test-prestation").length;
    assert.equal(gardees, 13, "chaque jeu à contenu gardé dans la page de son jeu");

    // Un nouveau clic : la prestation de test refaite à neuf, jamais en double.
    await page.click("#nav button[data-screen=settings]");
    await page.click("#test-prestation");
    const encore = await repondreFenetre(page);
    assert.match(encore, /1 prestation de test : « ANNIVERSAIRE TEST – Touktouka, 9 ans »/);
    assert.match(encore, /13 manches gardées pour elles/);
    await page.locator("#show-status-msg", { hasText: "Enregistrée « À venir »" }).waitFor({ timeout: 30000 });
    shows = await library("shows");
    assert.deepEqual(Object.keys(shows).sort(), ["copie", "ines", "test-prestation"]);
    manches = await library("manches");
    assert.equal(Object.values(manches).filter((m) => m.showId === "test-prestation").length, 13);
    await page.click("#nav button[data-screen=settings]");
    await page.locator("#test-status", { hasText: "Créée : « ANNIVERSAIRE TEST – Touktouka, 9 ans », anciennes démos effacées." }).waitFor();
    await page.context().close();

    // Sur la régie : chargée sur la TV, les 16 jeux.
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator(".show-item", { hasText: "ANNIVERSAIRE TEST – Touktouka, 9 ans" }).click();
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor({ timeout: 30000 });
    const questions = (await read("show")).quiz.questions;
    const kinds = new Set(questions.map((q) => q.kind));
    for (const k of ["classic", "mime", "blind", "zoom", "chante", "express", "quisuis", "flou", "disparu", "statues", "pictionary", "gonfleur", "patate", "coffres"]) {
      assert.ok(kinds.has(k), `${k} sur la TV`);
    }
    assert.ok(questions.some((q) => q.round === "Quiz illustré"), "Quiz illustré sur la TV");
    assert.ok(questions.some((q) => q.kind === "classic" && q.audioId), "Quiz musical sur la TV");
    await regie.context().close();
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
    // Réglages d'une chanson (cedric, 24/10) : Enregistrer · Annuler les modifications · ← Retour suivent l'écran
    // ensemble, en haut de la page aussi.
    const barreReglages = page.locator("#screen-playlist-edit .retour-barre.bas");
    assert.deepEqual(await barreReglages.locator("button:visible").allInnerTexts(), ["Enregistrer les réglages", "Annuler les modifications", "← Retour"]);
    await page.evaluate(() => window.scrollTo(0, 0));
    const hauteur = page.viewportSize().height;
    const boitesReglages = await barreReglages.locator("button:visible").evaluateAll((xs) => xs.map((x) => x.getBoundingClientRect().bottom));
    assert.ok(boitesReglages.every((b) => b > 0 && b <= hauteur), `dans la fenêtre : ${boitesReglages}`);
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

  test("Paroles pendant l'écoute dans l'écran d'une playlist aussi (cedric, 24/10) : ▶ et 🎤 d'un morceau font défiler celles de sa chanson ; sans paroles, rien ne s'affiche", async () => {
    const WAV = `data:audio/wav;base64,${wav(440, 4).toString("base64")}`;
    const hex = (c, k) => `${c}${k}`.padEnd(16, c);
    await seedLibrary("songs", {
      c1: { title: "Avec paroles", artist: "Les Tests", audioId: hex("e", 1), refrainId: hex("f", 1), start: 6, refrain: 40, lrc: true, updatedAt: 1 },
      c2: { title: "Sans paroles", artist: "Les Tests", audioId: hex("e", 2), start: 0, updatedAt: 1 },
    });
    await seedLibrary("sounds", { [hex("e", 1)]: WAV, [hex("f", 1)]: WAV, [hex("e", 2)]: WAV });
    await seedLibrary("lyrics", { c1: ["[00:05.00]Le couplet", "[00:39.00]Juste avant", "[00:41.00]On chante tous ensemble"].join("\n") });
    await seedLibrary("playlists", { fete: { title: "Fête", duration: 20, updatedAt: 1, tracks: [
      { title: "Avec paroles", audioId: hex("e", 1), refrainId: hex("f", 1), songId: "c1", start: 6, refrain: 40 },
      { title: "Sans paroles", audioId: hex("e", 2), songId: "c2", start: 0 },
    ] } });
    const page = await admin();
    await openGamePage(page, "blind", "collections");
    await page.locator('#playlist-list [data-playlist="fete"]').getByRole("button", { name: "Éditer" }).click();
    await page.locator("#screen-playlist-edit:not([hidden])").waitFor();
    const piste = (i) => page.locator(`#playlist-tracks .track[data-track="${i}"]`);
    const flottante = page.locator(".paroles-fenetre.flottante");
    // L'extrait commence au début réglé (6 s) : la phrase de 5 s.
    await piste(0).locator('button[title="Écouter l\'extrait"]').click();
    await flottante.locator(".paroles-titre", { hasText: "Paroles · Avec paroles" }).waitFor();
    await flottante.locator(".paroles-ligne.chantee", { hasText: "Le couplet" }).waitFor();
    // Le hook commence au refrain (40 s) : la phrase de 39 s, puis celle de 41 s.
    await piste(0).locator('button[title="Écouter le hook"]').click();
    await flottante.locator(".paroles-ligne.chantee", { hasText: "On chante tous ensemble" }).waitFor({ timeout: 8000 });
    await flottante.getByRole("button", { name: "Fermer les paroles" }).click();
    await flottante.waitFor({ state: "detached" });
    // Sans paroles : la chanson joue, aucune fenêtre.
    await piste(1).locator('button[title="Écouter l\'extrait"]').click();
    await piste(1).locator('button[title="Écouter l\'extrait"]', { hasText: "⏸" }).waitFor();
    assert.equal(await page.locator(".paroles-fenetre").count(), 0);
    await piste(1).locator('button[title="Écouter l\'extrait"]').click();
    await page.context().close();
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
    await update(gameRef(), { regieActive: true });
    await page.locator("#waiting-welcome", { hasText: "Joyeux anniversaire Léa !" }).waitFor();
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
