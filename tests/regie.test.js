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
import { faireZip } from "./zip-outil.js";
import { lockedUntil, isoDay, heureCourte, jourHeure, MIME_RESERVE } from "../web/public/show.js";

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
  // La régie « cockpit » est la régie par défaut (cedric, 25/10) : ces tests pilotent la disposition d'avant
  // (?cockpit=0, gardée sur le téléphone), mêmes boutons et mêmes actions ; le test « cockpit » ouvre la sienne
  // avec ?cockpit=1.
  const nouveauContexte = browser.newContext.bind(browser);
  contexteSansChoix = nouveauContexte;
  browser.newContext = async (options) => {
    const contexte = await nouveauContexte(options);
    await contexte.addInitScript(() => {
      if (!/[?&]cockpit=1/.test(location.search)) localStorage.setItem("lmp-regie-cockpit", "0");
    });
    return contexte;
  };
});

/** Contexte du navigateur sans régie choisie d'avance (voir before) : la régie s'ouvre comme sur un téléphone neuf. */
let contexteSansChoix;

after(async () => {
  await browser?.close();
  server?.close();
  await env?.cleanup();
});

const hostDb = () => env.authenticatedContext(HOST).database();
const read = async (path) => (await get(ref(hostDb(), `games/${CODE}/${path}`))).val();
const gameRef = (path = "") => ref(hostDb(), `games/${CODE}${path ? `/${path}` : ""}`);

const TEAM_COLORS_TEST = ["#2B86C5", "#9B5DE5", "#F94144", "#2EE8E0", "#FF6B1A", "#39FF14"];
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
function startBox({ silent = false, held = false, host = HOST, from = null, seen = [], suite = null, copieRegie = true, arretPartie = true, outro = true, enchaine = false } = {}) {
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
      const advance = ["next", "close", "end", "pause", "resume", "mime_start", "mime_found", "mime_pass", "mime_skip", "mime_stop", "goto", "buzz_ok", "buzz_ko", "picto_show", "picto_draw"].includes(cmd.type);
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
        // Après le bilan d'un jeu (enchaine) : le jeu suivant du programme tel qu'il est à cet instant, sinon le podium.
        else if (enchaine && cmd.type === "next" && state.phase === "scores") {
          const plan = (await read("conducteur")) ?? { questions: [] };
          state = (state.index ?? 0) + 1 < plan.questions.length ? sauter(plan, state.index + 1, seq) : { ...state, seq, phase: "ended" };
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
        // « ▶ Lancer la fin » (cedric, 29/10) : sur le podium, la box lance l'outro et publie outroAt ; une box d'avant ne fait rien.
        else if (cmd.type === "next" && state.phase === "ended") { if (outro && state.outroAt == null) state = { ...state, seq, outroAt: Date.now() }; }
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
        // « ⛔ Arrêter la partie » (cedric, 29/10) : accepté à toute étape par une box à jour (arretPartie), sans podium.
        else if (cmd.type === "newgame" && state.phase !== "ended" && !(cmd.arret === true && arretPartie)) status = { status: "refused", reason: "not_ended" };
        else if (cmd.type === "newgame" && suite) {
          // Comme la box (newGame) : la nouvelle partie, puis la régie déjà reliée, puis l'adresse sur l'ancienne.
          const regie = (await get(ref(db, `games/${CODE}/regie`))).val() ?? {};
          await set(ref(db, `games/${suite}`), { hostUid: host, state: { phase: "lobby", seq: 0, total: QUESTIONS.length, scores: {}, round: 1, buzzOpen: true } });
          if (copieRegie) {
            for (const [u, r] of Object.entries(regie)) await set(ref(db, `games/${suite}/regie/${u}`), { pairedAt: serverTimestamp(), via: r?.via ?? "password" });
          }
          state = { ...state, phase: "ended", leftAt: Date.now(), suite };
        }
        else if (cmd.type === "newgame") state = { ...state, phase: "ended", leftAt: Date.now() };
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
      : { ...questionState(seq), index, qid: q.id, text: q.text, choices: q.choices ?? null, total: plan.questions.length, scores: state.scores, mime: null, leaveTo: null };
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
      case "mime_skip":
        // Mimes en file (MimeSkipped) : l'image repart sous le paquet, sans point, et les joueurs tournent.
        if (!m.team || m.relais) return null;
        if (deck.length > 1) deck = [...deck.slice(1), deck[0]];
        return { ...st, seq, mime: { ...m, card: null, relais: Date.now(), passed: m.passed + 1 } };
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
        conducteur: { id: show.quiz.id, title: show.title, rev: show.id, mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, blind: true, blindPlay: true, statues: true, disparu: true, pictionary: true, coffres: true, gonfleur: true, patate: true, duel: true, simon: true, chrono: true, programReset: true, questions: show.quiz.questions },
        public: { title: show.title, ...(show.childName ? { childName: show.childName } : {}), ...(show.prestation ? { prestation: show.prestation } : {}) },
        ...(started ? { state } : {}),
      });
      return;
    }
    const index = state.phase === "lobby" ? -1 : state.index;
    const keep = lockedUntil(plan.questions, index);
    const same = (i) => JSON.stringify(show.quiz.questions[i]) === JSON.stringify(plan.questions[i]);
    // TV à jour (jeuxCommences, contrat du 30/10) : seuls les jeux commencés restent intouchables, index recalé.
    const blocs = (qs) => qs.reduce((out, q, i) => { if (i && qs[i - 1].round === q.round && q.round) out[out.length - 1].push(q); else out.push([q]); return out; }, []);
    const intouchables = () => blocs(plan.questions).filter((b) => b.some((q, k) => plan.questions.indexOf(q) === index) || state.jeuxCommences.includes(b[0].id));
    const garde = () => {
      const texte = JSON.stringify(show.quiz.questions);
      return intouchables().every((b) => texte.includes(JSON.stringify(b).slice(1, -1))) && show.quiz.questions.some((q) => q.id === state.qid);
    };
    const reason = refuseProgram ?? (show.base !== plan.rev ? "stale"
      : Array.isArray(state.jeuxCommences) && index >= 0 ? (garde() ? null : "current_round")
      : show.quiz.questions.length <= keep || ![...Array(keep + 1).keys()].every(same) ? "current_round" : null);
    refuseProgram = null;
    const updates = { showStatus: { id: show.id, status: reason ? "refused" : "applied", ...(reason ? { reason } : {}), at: Date.now() } };
    if (!reason) {
      state = { ...state, total: show.quiz.questions.length };
      if (Array.isArray(state.jeuxCommences) && index >= 0) state = { ...state, index: show.quiz.questions.findIndex((q) => q.id === state.qid) };
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
        // Au milieu de la fête (un jeu suit) : la fin du tour mène au classement, pas aux résultats finaux.
        ...state, phase: "question", seq: state.seq + 1, index: 2, total: 4, qid: "m1", kind: "mime", text: "Animaux", durationMs: 60000,
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
    conducteur: { id: "essai", title: "Démo", rev: "initial", mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, blind: true, blindPlay: true, statues: true, disparu: true, pictionary: true, coffres: true, gonfleur: true, patate: true, duel: true, simon: true, chrono: true, questions: QUESTIONS.map((q, i) => ({ id: `q${i + 1}`, ...q })) },
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
  // La ligne n'existe plus (cedric, 25/10) : le quiz s'ajoute par le crochet de test de l'émulateur.
  const i = Number(await round.getAttribute("data-manche"));
  assert.equal(await round.page().evaluate(([k, q]) => window.__integrerQuiz(k, q), [i, id]), true, `quiz « ${texte} » ajouté`);
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
/** Bonus ou malus de [amount] points (±50, ±100 ou ±200) pour une équipe : son « ± Points », puis un seul appui. */
async function givePoints(page, team, amount) {
  await page.locator(`#panel-teams [data-team="${team}"] .pts-open`).click();
  await page.click(`#pts [data-delta="${amount}"]`);
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

  test("mimes en file (cedric, 26/10) : le bouton principal lance l'équipe de la couleur, « ⏭ Passer » fait tourner, « 👁 Image suivante » à la main", async () => {
    box = startBox();
    await addTeam("jaune", "Les Soleils", "#FFE600");
    await addTeam("vert", "Les Pousses", "#39FF14");
    const cards = [{ word: "Pompier", image: "🧑‍🚒" }, { word: "Singe", image: "🐒" }, { word: "Pirate", image: "🏴‍☠️" }];
    const plan = [
      { id: "r1m1", text: "Équipe Jaune", kind: "mime", duration: 90, round: "Mimes", couleur: "#FFE600", cards },
      { id: "r1m2", text: "Équipe Vert", kind: "mime", duration: 90, round: "Mimes", couleur: "#39FF14", cards },
    ];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, mimesEnFile: true, questions: plan });
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await box.mimes(cards);
    await box.set({ index: 0, qid: "r1m1", text: "Équipe Jaune", total: 2 });
    await page.locator("#mime-info", { hasText: "Tous en file : le mimeur face à l'écran, les autres dos à l'écran" }).waitFor();
    // Bouton principal : le tour de l'équipe de la couleur part tout de suite, sans choisir d'équipe.
    await page.click("#c-next");
    await page.locator("#mime-now .word", { hasText: "Pompier" }).waitFor();
    await page.locator("#mime-skip:not([hidden])").waitFor();
    assert.equal(await page.locator("#mime-pass").isHidden(), true, "Pas d'image suivante sans faire tourner les joueurs");
    // « ⏭ Passer » : l'écran se vide, les joueurs tournent ; « 👁 Image suivante » devient le bouton principal.
    await page.click("#mime-skip");
    await page.locator("#mime.relais").waitFor();
    await page.locator("#mime-info", { hasText: "🔄 On tourne" }).waitFor();
    assert.equal(await page.locator("#mime-now").isHidden(), true);
    assert.equal(await page.textContent("#mime-pass"), "👁 Image suivante");
    assert.equal(await page.locator("#mime-skip").isDisabled(), true, "Pendant que les joueurs tournent, rien à passer");
    await capture(page, "regie-mimes-en-file-on-tourne");
    await page.click("#mime-pass");
    await page.locator("#mime-now .word", { hasText: "Singe" }).waitFor();
    await page.click("#mime-found");
    await page.locator("#mime.relais").waitFor();
    await page.click("#mime-pass");
    await page.locator("#mime-now .word", { hasText: "Pirate" }).waitFor();
    const envoyees = await commands();
    assert.deepEqual(envoyees.map((c) => c.type), ["mime_start", "mime_skip", "mime_pass", "mime_found", "mime_pass"]);
    assert.equal(envoyees[0].team, "jaune");
    await page.context().close();
  });

  test("mimes en file : une box d'avant le 26/10 garde le déroulé habituel (Top départ, Image suivante)", async () => {
    box = startBox();
    await addTeam("jaune", "Les Soleils", "#FFE600");
    const cards = [{ word: "Pompier", image: "🧑‍🚒" }, { word: "Singe", image: "🐒" }];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, questions: [{ id: "r1m1", text: "Équipe Jaune", kind: "mime", duration: 90, round: "Mimes", cards }] });
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await box.mimes(cards);
    await box.set({ index: 0, qid: "r1m1", text: "Équipe Jaune", total: 1 });
    await page.locator("#mime-go", { hasText: "Top départ ! (Les Soleils)" }).click();
    await page.locator("#mime-now .word", { hasText: "Pompier" }).waitFor();
    assert.equal(await page.locator("#mime-skip").isHidden(), true);
    assert.equal(await page.textContent("#mime-pass"), "Image suivante");
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
    // Dernier jeu de la fête : pas de classement juste avant, « suivant » lance les résultats finaux (cedric, 27/10).
    await page.locator("#mime-info", { hasText: "ou passez avec « Résultats finaux 🏆 »" }).waitFor();
    await page.locator("#c-next", { hasText: "Résultats finaux 🏆" }).waitFor();
    assert.equal(await page.locator(".mime-team").count(), 2);
    await page.context().close();
  });

  for (const [width, height] of [[360, 640], [390, 780]]) {
    test(`petit téléphone ${width}×${height} : pendant un buzz, en pause puis reprise, Reprendre, le bouton principal et le verdict restent à l'écran`, async () => {
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
      // Le téléphone signale sa présence : la box compte ses coupures dans ses rapports (cedric, 30/10).
      await waitFor(async () => Object.values((await get(gameRef("regiePresence"))).val() ?? {}).some((p) => p.online === true), "présence du téléphone");
      await page.locator("#c-hold", { hasText: "Les Bleus" }).waitFor();
      await page.locator("#flou-judge:not([hidden])").waitFor();
      // Chaque bouton du bas est entièrement dans l'écran et c'est bien lui qu'un doigt touche.
      // Régie « cockpit » : « ☰ Plus » (Terminer y est rangé) ; ancienne régie : « Terminer » sur la ligne du bas.
      const milieu = await page.evaluate(() => (document.getElementById("c-plus") ? "c-plus" : "c-end"));
      for (const id of ["c-pause", milieu, "c-next"]) {
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
      // En pause (test du 30/10 au soir) : le verdict attend la reprise, « Reprendre » d'abord, à portée de doigt.
      await page.locator("#flou-info", { hasText: "appuyez sur « Reprendre », puis jugez la réponse de Les Roses" }).waitFor();
      await page.locator("#c-pause", { hasText: "Reprendre (3, 2, 1)" }).click();
      await waitFor(async () => (await commands()).some((c) => c.type === "resume"), "reprise envoyée");
      // Partie reprise, tablette des Bleus toujours coupée : le verdict en plein écran au-dessus des commandes.
      await box.set({ paused: false, pauseReason: null, pauseTeam: null });
      await page.locator("#flou-info", { hasText: "Les Roses a buzzé ! Réponse attendue : une chanson avec le mot « roi »" }).waitFor();
      assert.equal(await page.locator("#flou-info .buzz-nom-couleur").textContent(), "JAUNE");
      // La réponse attendue sur sa propre ligne, en gros, dans le même cadre que la couleur et le verdict (cedric, 24/10).
      const reponse = page.locator("#flou-info .buzz-reponse b");
      assert.equal(await reponse.textContent(), "une chanson avec le mot « roi »");
      assert.ok(parseFloat(await reponse.evaluate((el) => getComputedStyle(el).fontSize)) >= 20, "réponse en gros");
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
      assert.ok((await page.locator("#flou-info").boundingBox()).height <= 100, "bande de l'équipe fine (le gros carré jaune faisait 150 px)");
      await capture(page, `verdict-buzz-${width}x${height}`);
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

  test("régie « cockpit » (proposition du 25/10, ?cockpit=1) : pastille des tablettes coupées, « ☰ Plus », verdict plein écran, bandeau du verdict", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses", "#FFE600");
    await addTeam("bleu", "Les Bleus");
    await setPresence("rose", true);
    await setPresence("bleu", true);
    const plan = [{ id: "f1", text: "Qu'est-ce qui se cache sous le flou ?", choices: ["Un lion", "Un chat"], correct: 0, duration: 40, kind: "flou", imageId: "0123456789abcdef", round: "Image floue" }];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, questions: plan });
    await box.set({ ...questionState(1), qid: "f1", kind: "flou", text: plan[0].text, choices: null, total: 1, round: "f1-1000-0", buzzOpen: true, buzz: { team: null, blocked: [] } });
    const page = await openRegie(await browser.newContext({ viewport: { width: 360, height: 640 } }), `?g=${CODE}&emu=1&cockpit=1`);
    await pair(page);
    await inRegie(page);
    await page.locator("#regie.cockpit").waitFor();
    // Un bouton est dans l'écran, sans rien faire défiler, et c'est bien lui qu'un doigt touche.
    const dansLEcran = (id) => page.evaluate((id) => {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.height > 0 && (hit === el || el.contains(hit));
    }, id);
    // Écran principal : la scène, Pause, « ☰ Plus » et le bouton principal ; le reste est rangé dans « ☰ Plus ».
    for (const id of ["c-pause", "c-plus", "c-next"]) assert.ok(await dansLEcran(id), `#${id} dans l'écran`);
    // « ⏭ Terminer » aussi, jamais sur l'écran principal en pleine partie (cedric, 30/10).
    for (const id of ["c-points", "c-tablette", "c-box", "c-end", "c-arret", "c-notes", "panel-teams"]) {
      assert.equal(await page.locator(`#plus #${id}`).count(), 1, `#${id} rangé dans « ☰ Plus »`);
    }
    assert.equal(await page.locator("#plus").isHidden(), true);
    // Tablette coupée : une pastille dans la barre du haut, plus de grand bandeau rouge.
    await setPresence("bleu", false);
    // Le nom de l'équipe d'un coup d'œil (cedric, 25/10), avec sa couleur.
    await page.locator("#c-horsligne .hl-noms", { hasText: /^Les Bleus$/ }).waitFor({ timeout: 8000 });
    assert.match(await page.locator("#c-horsligne").textContent(), /^📱.*hors ligne$/);
    assert.equal(await page.locator("#c-horsligne .hl-couleur").count(), 1);
    assert.equal(await page.locator("#r-alerte").isHidden(), true);
    for (const id of ["c-horsligne", "c-timer"]) {
      const r = await page.locator(`#${id}`).boundingBox();
      assert.ok(r.x >= 0 && r.x + r.width <= 360 - 15, `#${id} entier dans la barre du haut : ${JSON.stringify(r)}`);
    }
    assert.equal(await page.locator("#c-horsligne").getAttribute("title"), "Déconnectée : Les Bleus");
    await capture(page, "cockpit-question-360x640", { pleinePage: false });
    // Deux équipes : les deux noms ; trois et plus : les couleurs et le nombre. Toujours entière dans la barre.
    await addTeam("vert", "Les Super Licornes Magiques", "#39FF14");
    await setPresence("vert", true);
    await setPresence("rose", false);
    await page.locator("#c-horsligne .hl-noms", { hasText: "Les Roses, Les Bleus" }).waitFor({ timeout: 8000 });
    await setPresence("vert", false);
    await page.locator("#c-horsligne .hl-noms", { hasText: /^3$/ }).waitFor({ timeout: 8000 });
    assert.equal(await page.locator("#c-horsligne .hl-couleur").count(), 3);
    for (const id of ["c-horsligne", "c-timer"]) {
      const r = await page.locator(`#${id}`).boundingBox();
      assert.ok(r.x >= 0 && r.x + r.width <= 360 - 15, `#${id} entier avec trois équipes coupées : ${JSON.stringify(r)}`);
    }
    // Retour : verte un instant, avec le nom ; puis plus rien quand tout le monde est là.
    await setPresence("rose", true);
    await setPresence("vert", true);
    await page.locator("#c-horsligne .hl-noms", { hasText: "Les Bleus" }).waitFor();
    await setPresence("bleu", true);
    await page.locator("#c-horsligne.revenue", { hasText: "revenue" }).waitFor();
    await page.locator("#c-horsligne").waitFor({ state: "hidden", timeout: 10000 });
    await setPresence("bleu", false);
    await page.locator("#c-horsligne", { hasText: "Les Bleus" }).waitFor({ timeout: 8000 });
    // « ☰ Plus » monte du bas ; une commande qui ouvre sa fenêtre le referme.
    await page.click("#c-plus");
    await page.locator("#plus:not([hidden])").waitFor();
    assert.ok(await dansLEcran("c-points"));
    await page.waitForTimeout(300); // fin de l'animation, pour la capture
    await capture(page, "cockpit-plus-360x640", { pleinePage: false });
    await page.click("#c-box");
    await page.locator("#plus").waitFor({ state: "hidden" });
    await page.locator("#box:not([hidden])").waitFor();
    await page.click("#box-close");
    await page.locator("#box").waitFor({ state: "hidden" });
    // Buzz des Roses (bracelets jaunes) : tout l'écran sous la barre du haut devient le verdict, cadré en jaune.
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/buzz/f1-1000-0`), { team: "rose", at: Date.now() }));
    await page.locator("#flou-verdict.en-bas").waitFor();
    await page.locator("#flou-info .buzz-nom-couleur", { hasText: "JAUNE" }).waitFor();
    const cadre = await page.locator("#flou-verdict").boundingBox();
    const haut = await page.locator(".regie .top").boundingBox();
    assert.ok(cadre.y >= haut.y + haut.height && cadre.height > 640 * 0.75, `verdict plein écran sous la barre du haut : ${JSON.stringify(cadre)}`);
    assert.equal(await page.locator("#flou-verdict").evaluate((el) => getComputedStyle(el).borderTopColor), "rgb(255, 230, 0)");
    for (const id of ["flou-ok", "flou-ko", "c-horsligne"]) assert.ok(await dansLEcran(id), `#${id} dans l'écran au buzz`);
    await capture(page, "cockpit-buzz-360x640", { pleinePage: false });
    await page.setViewportSize({ width: 390, height: 780 });
    await capture(page, "cockpit-buzz-390x780", { pleinePage: false });
    // Une tablette décroche pendant la réponse orale (test du 30/10 au soir) : en pause, le verdict quitte le plein écran,
    // « Reprendre » est à portée de doigt ; une fois la partie reprise, le verdict revient en plein écran.
    await box.set({ paused: true, pauseReason: "team", pauseTeam: "bleu" });
    await page.locator("#flou-verdict:not(.en-bas)").waitFor({ state: "attached" });
    await page.locator("#flou-info", { hasText: "appuyez sur « Reprendre »" }).waitFor();
    await page.locator("#c-pause", { hasText: "Reprendre" }).waitFor();
    assert.ok(await dansLEcran("c-pause"), "« Reprendre » visible pendant la pause");
    await capture(page, "cockpit-buzz-en-pause-390x780", { pleinePage: false });
    await box.set({ paused: false, pauseReason: null, pauseTeam: null });
    await page.locator("#flou-verdict.en-bas").waitFor();
    // Verdict : le bandeau de 2 s le confirme, la scène revient seule.
    await page.click("#flou-ko");
    await page.locator("#c-flash.mauvaise", { hasText: "✕ Mauvaise réponse · Les Roses" }).waitFor();
    await page.locator("#flou-verdict:not(.en-bas)").waitFor({ state: "attached" });
    await page.waitForTimeout(300);
    await capture(page, "cockpit-verdict-390x780", { pleinePage: false });
    await page.locator("#c-flash").waitFor({ state: "hidden", timeout: 4000 });
    assert.deepEqual((await read("state")).buzz.blocked, ["rose"]);
    await page.context().close();
  });

  test("régie « cockpit » par défaut (choix B de cedric, 25/10) : sans paramètre, chaque commande de « ☰ Plus » ouvre sa fenêtre ; ?cockpit=0 revient à l'ancienne régie", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    const plan = [{ id: "q1", text: "Quel est le plus grand animal ?", choices: ["L'éléphant", "La baleine bleue"], correct: 1, duration: 20, round: "Quiz" }];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", questions: plan });
    await box.set({ ...questionState(1), qid: "q1", text: plan[0].text, choices: plan[0].choices, total: 1, round: "q1-1000-0" });
    const page = await openRegie(await contexteSansChoix({ viewport: { width: 360, height: 640 } }));
    await pair(page);
    await inRegie(page);
    await page.locator("#regie.cockpit").waitFor();
    const plus = async () => {
      await page.click("#c-plus");
      await page.locator("#plus:not([hidden])").waitFor();
    };
    // ± Points : la fenêtre des points, « ☰ Plus » refermé.
    await plus();
    await page.click("#c-points");
    await page.locator("#plus").waitFor({ state: "hidden" });
    await page.locator("#pts:not([hidden])").waitFor();
    await page.click("#pts-cancel");
    await page.locator("#pts").waitFor({ state: "hidden" });
    // 📱 Tablette : le QR pour reconnecter une tablette.
    await plus();
    await page.click("#c-tablette");
    await page.locator("#tablette:not([hidden])").waitFor();
    await page.click("#tablette-close");
    await page.locator("#tablette").waitFor({ state: "hidden" });
    // Plus de « ⏭ Changer de jeu » ni de « 🔁 Rejouer » (cedric, 30/10) : tout passe par le conducteur.
    assert.equal(await page.locator("#c-rescue, #c-replay, #rescue").count(), 0);
    // Terminer la partie (cedric, 31/10) : un appui court ne fait rien du tout et « ☰ Plus » reste ouvert.
    await plus();
    await page.click("#c-arret");
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#ask").isHidden(), true, "un appui court n'ouvre rien");
    assert.equal(await page.locator("#plus").isHidden(), false);
    assert.equal((await read("state")).phase, "question");
    await page.click("#plus-fermer");
    await page.locator("#plus").waitFor({ state: "hidden" });
    // Les équipes et le conducteur sont dans « ☰ Plus », sous ses commandes.
    await plus();
    await page.locator("#plus #panel-teams, #plus #panel-plan").first().waitFor({ state: "attached" });
    await page.click("#plus-fond", { position: { x: 10, y: 10 } });
    await page.locator("#plus").waitFor({ state: "hidden" });
    // ?cockpit=0 : l'ancienne régie, gardée sur ce téléphone même sans le paramètre.
    await page.goto(page.url().replace(/([?&])cockpit=1/, "$1") + "&cockpit=0");
    await inRegie(page);
    assert.equal(await page.locator("#regie.cockpit").count(), 0);
    assert.equal(await page.locator("#c-plus").count(), 0);
    await page.goto(page.url().replace("&cockpit=0", ""));
    await inRegie(page);
    assert.equal(await page.locator("#regie.cockpit").count(), 0);
    await page.context().close();
  });

  test("régie « cockpit » (test du 25/10) : « ☰ Plus » ouvert ne cache jamais « Lancer la fête ! », même avec une tablette restée sur une ancienne partie", async () => {
    box = startBox();
    // L'équipe est inscrite, mais sa tablette est restée sur une ancienne partie : hors ligne ici.
    await addTeam("touj", "TOUJ");
    const page = await openRegie(await contexteSansChoix({ viewport: { width: 360, height: 640 } }));
    await pair(page);
    await inRegie(page);
    await page.locator("#regie.cockpit").waitFor();
    await page.locator("#c-horsligne .hl-noms", { hasText: /^TOUJ$/ }).waitFor({ timeout: 8000 });
    const dansLEcran = (id) => page.evaluate((id) => {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.height > 0 && (hit === el || el.contains(hit));
    }, id);
    // « ☰ Plus » ouvert sur l'onglet Prestation : la feuille s'arrête au-dessus du bas de la régie.
    await page.click("#c-plus");
    await page.locator("#plus:not([hidden])").waitFor();
    await page.click("#plus #tab-show");
    await page.locator("#plus #panel-show:not([hidden])").waitFor();
    assert.equal(await page.locator("#plus").isHidden(), false);
    for (const id of ["c-next", "c-pause", "c-plus"]) assert.ok(await dansLEcran(id), `#${id} visible et touchable, « ☰ Plus » ouvert`);
    assert.equal(await page.locator("#c-next").textContent(), "Lancer la fête !");
    assert.equal(await page.locator("#c-next").isDisabled(), false, "une tablette hors ligne ne bloque jamais le lancement");
    // La feuille monte de 24 px en s'ouvrant : on la mesure une fois arrivée (CI lente).
    await page.waitForFunction(() => document.getElementById("plus").getAnimations({ subtree: true }).every((a) => a.playState === "finished" || a.effect?.getTiming().iterations === Infinity));
    const feuille = await page.locator("#plus").boundingBox();
    const bas = await page.locator(".regie .actions").boundingBox();
    assert.ok(feuille.y + feuille.height <= bas.y + 1, `la feuille s'arrête au-dessus des boutons : ${JSON.stringify({ feuille, bas })}`);
    // Le bas grandit feuille ouverte (une ligne de plus) : la feuille remonte avec lui.
    await page.evaluate(() => { const l = document.createElement("p"); l.id = "ligne-test"; l.style.height = "40px"; l.style.margin = "0"; document.querySelector(".regie .actions").prepend(l); });
    await page.waitForFunction(() => {
      const f = document.getElementById("plus").getBoundingClientRect(), b = document.querySelector(".regie .actions").getBoundingClientRect();
      return f.bottom <= b.top + 1;
    }, null, { timeout: 3000 });
    await page.evaluate(() => document.getElementById("ligne-test").remove());
    await capture(page, "cockpit-plus-lancer-360x640", { pleinePage: false });
    // « ☰ Plus » touché une seconde fois : la feuille se referme.
    await page.click("#c-plus");
    await page.locator("#plus").waitFor({ state: "hidden" });
    // Ouvert de nouveau : « Lancer la fête ! » referme la feuille et lance la fête, tablette toujours hors ligne.
    await page.click("#c-plus");
    await page.locator("#plus:not([hidden])").waitFor();
    await page.click("#c-next");
    await page.locator("#plus").waitFor({ state: "hidden" });
    await page.locator("#c-phase", { hasText: "Question en cours" }).waitFor();
    assert.deepEqual((await commands()).map((c) => c.type), ["next"]);
    await page.context().close();
  });

  test("régie « cockpit » : le milieu de l'écran (maquette validée le 25/10) : la réponse en grand, une tuile par équipe, toucher = bonus ou malus, tablette coupée = QR, tout s'efface au buzz", async () => {
    box = startBox();
    const equipes = [["lic", "Les Licornes", "#FF6B1A"], ["dra", "Les Dragons", "#39FF14"], ["sta", "Les Stars", "#FF2D95"], ["pir", "Les Pirates", "#FFE600"]];
    for (const [k, [id, nom, c]] of equipes.entries()) { await addTeam(id, nom, c, 1000 + k); await setPresence(id, true); }
    const plan = [
      { id: "q1", text: "Quel est le plus grand animal du monde ?", choices: ["L'éléphant", "La baleine bleue", "La girafe", "Le requin"], correct: 1, duration: 20, round: "Quiz" },
      { id: "q2", text: "Combien de pattes a une araignée ?", choices: ["6", "10", "8", "4"], correct: 2, duration: 20, round: "Quiz" },
    ];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", questions: plan });
    const base = { ...questionState(1), qid: "q1", text: plan[0].text, choices: plan[0].choices, total: 2, scores: { lic: 300, dra: 250, sta: 200, pir: 150 } };
    await box.set(base);
    for (const [id, choice] of [["lic", 1], ["dra", 0], ["pir", 1]]) {
      await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/answers/q1/${id}`), { choice, at: Date.now() }));
    }
    const page = await openRegie(await contexteSansChoix({ viewport: { width: 390, height: 844 } }));
    await pair(page);
    await inRegie(page);
    await page.locator("#regie.cockpit").waitFor();
    // Question : la bonne réponse en grand, puis les 4 équipes, qui a répondu et qui réfléchit.
    await page.locator("#c-answer.grosse .rep-txt", { hasText: "La baleine bleue" }).waitFor();
    assert.equal(await page.locator("#c-answer .rep-lettre").textContent(), "B");
    const tuile = (id) => page.locator(`#c-tuiles .tuile[data-team="${id}"]`);
    await tuile("sta").locator(".t-etat", { hasText: "… réfléchit" }).waitFor();
    assert.equal(await tuile("lic").locator(".t-etat").textContent(), "✓ a répondu");
    assert.equal(await tuile("lic").locator(".t-score").textContent(), "300");
    assert.equal(await page.locator("#c-tuiles .tuile").count(), 4);
    // Rien ne dépasse de l'écran ni ne passe sous les boutons du bas.
    const bas = await page.locator(".regie .actions").boundingBox();
    for (const [id] of equipes) {
      const r = await tuile(id).boundingBox();
      assert.ok(r.x >= 0 && r.x + r.width <= 390 && r.y + r.height <= bas.y + 1, `tuile ${id} dans l'écran : ${JSON.stringify(r)}`);
    }
    await capture(page, "cockpit-milieu-question-390x844", { pleinePage: false });
    // La réponse se cache d'un toucher.
    await page.click("#c-answer");
    await page.locator("#c-answer .rep-txt", { hasText: "Réponse cachée" }).waitFor();
    await page.click("#c-answer");
    await page.locator("#c-answer .rep-txt", { hasText: "La baleine bleue" }).waitFor();
    // Bonus et malus seulement par « ± Points » dans ☰ Plus (cedric, 30/10) : une tuile ne s'ouvre pas, aucune astuce.
    assert.equal(await tuile("dra").isDisabled(), true);
    assert.equal(await page.locator(".t-astuce").count(), 0);
    assert.equal(await page.locator("#pts").isHidden(), true);
    // Réponse révélée : la réponse de chaque équipe et ses points ; la tablette des Stars coupée : tuile rouge, toucher = QR.
    await box.set({ ...base, phase: "reveal", correct: 1, scores: { lic: 400, dra: 250, sta: 200, pir: 250 },
      awards: { lic: { correct: true, points: 100, bonus: 0 }, dra: { correct: false, points: 0, bonus: 0 }, pir: { correct: true, points: 100, bonus: 0 } } });
    await setPresence("sta", false);
    await tuile("lic").locator(".t-etat", { hasText: "✓ B · +100" }).waitFor();
    assert.equal(await tuile("dra").locator(".t-etat").textContent(), "✕ A · 0");
    await page.locator('#c-tuiles .tuile.coupee[data-team="sta"]', { hasText: "Hors ligne" }).waitFor({ timeout: 8000 });
    await capture(page, "cockpit-milieu-reponse-390x844", { pleinePage: false });
    await tuile("sta").click();
    await page.locator("#tablette:not([hidden])").waitFor();
    await page.click("#tablette-close");
    await page.locator("#tablette").waitFor({ state: "hidden" });
    await setPresence("sta", true);
    await page.locator("#c-tuiles .tuile.coupee").waitFor({ state: "detached" });
    // Scores : le classement, et la réponse de la question suivante en grand.
    await box.set({ ...base, phase: "scores", correct: 1, scores: { lic: 400, dra: 250, sta: 200, pir: 250 } });
    await page.locator("#c-answer.grosse .rep-lbl", { hasText: "Prochaine réponse" }).waitFor();
    assert.match(await page.locator("#c-answer .rep-txt").textContent(), /^C8$/);
    assert.match(await page.locator("#c-question").textContent(), /^Question suivante : Combien de pattes/);
    assert.deepEqual(await page.locator("#c-tuiles .tuile").evaluateAll((els) => els.map((e) => e.dataset.team)), ["lic", "dra", "pir", "sta"]);
    assert.deepEqual(await page.locator("#c-tuiles .t-place").allTextContents(), ["1", "2", "2", "4"]);
    // Buzz : tout s'efface, le verdict plein écran passe devant (inchangé).
    await box.set({ ...base, phase: "question", kind: "flou", choices: null, buzzOpen: true, buzz: { team: "lic", blocked: [] } });
    await page.locator("#c-tuiles").waitFor({ state: "hidden" });
    // 8 équipes : toutes dans l'écran, au-dessus des boutons du bas.
    const autres = [["nin", "Les Ninjas", "#2B86C5"], ["fus", "Les Fusées", "#9B5DE5"], ["tig", "Les Tigres", "#F94144"], ["dau", "Les Dauphins", "#2EE8E0"]];
    for (const [k, [id, nom, c]] of autres.entries()) { await addTeam(id, nom, c, 2000 + k); await setPresence(id, true); }
    await box.set({ ...base, phase: "scores", buzz: null, buzzOpen: false, scores: { lic: 400, dra: 250, sta: 200, pir: 250, nin: 200, fus: 150, tig: 100, dau: 50 } });
    await page.locator("#c-tuiles .tuile").nth(7).waitFor();
    for (let k = 0; k < 8; k++) {
      const r = await page.locator("#c-tuiles .tuile").nth(k).boundingBox();
      assert.ok(r.y >= 0 && r.y + r.height <= bas.y + 1, `8 équipes : tuile ${k} au-dessus des boutons : ${JSON.stringify(r)}`);
    }
    await capture(page, "cockpit-milieu-8-equipes-390x844", { pleinePage: false });
    await page.context().close();
  });

  test("« ± Points » sur un petit téléphone (test du 25/10) : la fenêtre tient dans l'écran, rien ne se superpose ; le mode sombre forcé du téléphone ne repeint pas la régie", async () => {
    box = startBox();
    await addTeam("touj", "TOUJ");
    await setPresence("touj", true);
    // Huit équipes : la liste tient aussi sur le plus petit téléphone.
    for (const n of ["Les Licornes magiques", "Dragons", "Stars", "Pirates", "Bleus", "Violets", "Rouges"]) await addTeam(n.toLowerCase().replace(/\W/g, ""), n);
    for (const [w, h] of [[360, 640], [300, 560], [390, 844]]) {
      const page = await openRegie(await contexteSansChoix({ viewport: { width: w, height: h } }));
      await pair(page);
      await inRegie(page);
      // L'appli se déclare sombre : le navigateur n'applique pas son propre mode sombre.
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "dark");
      assert.equal(await page.locator('meta[name="color-scheme"]').getAttribute("content"), "dark");
      await page.click("#c-plus");
      await page.click("#c-points");
      await page.locator("#pts:not([hidden])").waitFor();
      await page.waitForTimeout(300);
      // La liste des équipes, puis les bonus et malus : chaque écran tient dans le téléphone, rien ne se superpose.
      const verifier = async (etape) => {
        const blocs = await page.evaluate(() => [...document.querySelectorAll("#pts .pts-box > *, #pts .pts-teams > *, #pts .pts-montants > *")]
          .filter((el) => el.getClientRects().length).map((el) => { const r = el.getBoundingClientRect(); return { id: el.id || el.className || el.textContent, parent: el.parentElement.className, top: r.top, bottom: r.bottom }; }));
        for (const b of blocs) assert.ok(b.top >= 0 && b.bottom <= h + 0.5, `${w}x${h} ${etape} : « ${b.id} » dans l'écran ${JSON.stringify(b)}`);
        for (const parent of new Set(blocs.map((b) => b.parent))) {
          const freres = blocs.filter((b) => b.parent === parent);
          for (let k = 1; k < freres.length; k++) {
            assert.ok(freres[k].top >= freres[k - 1].bottom - 0.5, `${w}x${h} ${etape} : « ${freres[k].id} » ne chevauche pas « ${freres[k - 1].id} »`);
          }
        }
        await capture(page, `points-${etape}-${w}x${h}`, { pleinePage: false });
      };
      await verifier("equipes");
      await page.click('#pts-teams button[data-team="touj"]');
      await verifier("montants");
      // Un appui donne les points et ferme la fenêtre.
      await page.click('#pts [data-delta="50"]');
      await page.locator("#pts").waitFor({ state: "hidden" });
      await page.locator("#undo-text", { hasText: "+50 pour TOUJ" }).waitFor();
      await page.context().close();
    }
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
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, blind: true, blindPlay: true, statues: true, disparu: true, pictionary: true, coffres: true, gonfleur: true, patate: true, questions: plan });
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
    // Dernier morceau, à double valeur, du dernier jeu de la fête : le bouton mène aux résultats finaux, sans bilan
    // juste avant (cedric, 27/10).
    await box.set({ ...(await read("state")), qid: "b3", index: 2, blind: blindState({ points: 200, played: true, tracks: tracks(["found", "skipped", "revealed"], "bleu") }) });
    await page.locator("#blind-head", { hasText: "Morceau 3 / 3 · 200 points" }).locator(".double", { hasText: "POINTS DOUBLÉS" }).waitFor();
    await page.locator("#c-next", { hasText: "Résultats finaux 🏆" }).waitFor();
    // Un jeu suit : le bilan du blind test.
    await box.set({ ...(await read("state")), total: 4 });
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
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, blind: true, statues: true, disparu: true, pictionary: true, coffres: true, gonfleur: true, patate: true, questions: plan });
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

  /** Statues avec une box qui publie state.statues (cedric, 26/10) : arrêts à la main, gagnantes par chanson. */
  async function statuesEnCours(statues, teams = [["rose", "Les Roses", "#FF2D8A"], ["bleu", "Les Bleus", "#2B86C5"], ["vert", "Les Verts", "#39FF14"]], query = `?g=${CODE}&emu=1`) {
    box = startBox();
    for (const [id, nom, couleur] of teams) await addTeam(id, nom, couleur);
    const plan = [{ id: "s1", text: "Statues musicales", kind: "statues", round: "Statues musicales", songs: [{ songId: "danse", audioId: "0123456789abcdef", title: "Danse" }, { songId: "bouge", audioId: "fedcba9876543210", title: "Bouge" }] }];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, blind: true, statues: true, disparu: true, pictionary: true, coffres: true, gonfleur: true, patate: true, questions: plan });
    const etat = { song: 0, songs: 2, titles: ["Danse", "Bouge"], dancing: true, since: Date.now(), playedMs: 0, ended: false, result: null, ...statues };
    await box.set({ ...questionState(1), qid: "s1", kind: "statues", text: plan[0].text, choices: null, total: 1, durationMs: null, deadline: null, statues: etat });
    const page = await openRegie(undefined, query);
    await pair(page);
    await inRegie(page);
    return { page, etat };
  }
  const commandes = async (type) => Object.values((await read("commands")) ?? {}).filter((c) => c.type === type);

  test("statues : STATUE ! / On danse !, plusieurs gagnantes, annonce à la TV puis chanson suivante ou résultats", async () => {
    const { page, etat } = await statuesEnCours({});
    await page.locator("#statues-info", { hasText: "Chanson 1 sur 2 · « Danse ». 💃 Les enfants dansent." }).waitFor();
    assert.equal(await page.locator("#statues-teams").isVisible(), false, "pas de gagnante à choisir pendant la chanson");
    await page.locator("#statues-bascule", { hasText: "✋ STATUE !" }).click();
    await waitFor(async () => (await commandes("statues_stop")).length === 1, "musique coupée");
    await box.set({ statues: { ...etat, dancing: false } });
    await page.locator("#statues-info", { hasText: "✋ Statue ! Éliminez ceux qui bougent." }).waitFor();
    await page.locator("#statues-bascule.danse", { hasText: "💃 On danse !" }).click();
    await waitFor(async () => (await commandes("statues_play")).length === 1, "musique relancée");
    await box.set({ statues: { ...etat, dancing: true } });
    await page.locator("#statues-bascule", { hasText: "✋ STATUE !" }).waitFor();
    await page.locator("#statues-points", { hasText: "300 points pour chaque gagnante, 150 pour les autres équipes" }).waitFor();

    // Écran gagnant : tuiles à cocher, plusieurs gagnantes possibles ; « Valider » attend un choix.
    await page.click("#statues-choisir");
    await page.locator("#statues-info", { hasText: "Qui a gagné ?" }).waitFor();
    assert.equal(await page.locator("#statues-bascule").isVisible(), false, "une seule décision par écran");
    // « Valider » est le gros bouton du bas ; il attend un choix.
    await page.locator("#c-next", { hasText: "Touchez la ou les gagnantes" }).waitFor();
    assert.equal(await page.locator("#c-next").isDisabled(), true);
    await page.locator(".statues-tuile", { hasText: "Les Roses" }).click();
    await page.locator("#c-next", { hasText: "✓ Valider : Les Roses" }).waitFor();
    await page.locator(".statues-tuile", { hasText: "Les Verts" }).click();
    await page.locator('.statues-tuile[aria-pressed="true"]', { hasText: "Les Verts" }).waitFor();
    assert.equal(await page.locator(".statues-tuile.personne").getAttribute("aria-pressed"), "false");
    await page.locator("#c-next", { hasText: "✓ Valider : 2 gagnantes" }).click();
    await waitFor(async () => (await commandes("statues_win")).some((c) => JSON.stringify(c.teams) === JSON.stringify(["rose", "vert"])), "gagnantes envoyées");

    // La TV annonce : rien à toucher pendant le suspense, puis « ▶ Chanson suivante » et « Résultats finaux ».
    const result = { song: 0, winners: ["rose", "vert"], gains: { rose: 300, vert: 300, bleu: 150 }, at: Date.now() };
    await box.set({ statues: { ...etat, dancing: false, result } });
    await page.locator("#statues-info", { hasText: "🏆 Les Roses, Les Verts gagnent la chanson. Annonce sur la TV…" }).waitFor();
    await page.locator("#c-next", { hasText: "Annonce sur la TV…" }).waitFor();
    assert.equal(await page.locator("#c-next").isDisabled(), true);
    assert.equal(await page.locator("#statues-suivante").isVisible(), false);
    await page.locator("#statues-suivante", { hasText: "▶ Chanson suivante" }).waitFor({ timeout: 12000 });
    await page.locator("#statues-info", { hasText: "Bilan des scores sur la TV." }).waitFor();
    await page.locator("#c-next", { hasText: "Résultats finaux 🏆" }).waitFor();
    await page.click("#statues-suivante");
    await waitFor(async () => (await commandes("statues_song")).length === 1, "chanson suivante demandée");
    await box.set({ statues: { ...etat, song: 1, dancing: true, result: null } });
    await page.locator("#statues-info", { hasText: "Chanson 2 sur 2 · « Bouge »." }).waitFor();
    await page.locator("#c-next", { hasText: "⏭ Finir la chanson" }).waitFor();
    // Dernière chanson jouée : plus de « Chanson suivante », seulement « Résultats finaux ».
    await box.set({ statues: { ...etat, song: 1, dancing: false, result: { song: 1, winners: ["bleu"], gains: {}, at: Date.now() - 9000 } } });
    await page.locator("#statues-info", { hasText: "🏆 Les Bleus gagne la chanson." }).waitFor();
    await page.locator("#c-next", { hasText: "Résultats finaux 🏆" }).click();
    await waitFor(async () => (await commandes("next")).length === 1, "fin du jeu demandée");
    assert.equal(await page.locator("#statues-suivante").isVisible(), false);
    await page.context().close();
  });

  test("statues : chanson finie toute seule → écran gagnant direct ; « Personne » ; Chanson suivante passe par la gagnante ; pause", async () => {
    const { page, etat } = await statuesEnCours({ ended: true, dancing: false });
    await page.locator("#statues-info", { hasText: "La chanson est finie. Qui a gagné ?" }).waitFor();
    assert.equal(await page.locator("#statues-retour").isVisible(), false, "pas de retour à une chanson finie");
    await page.locator(".statues-tuile", { hasText: "Les Bleus" }).click();
    await page.locator(".statues-tuile.personne").click();
    assert.equal(await page.locator('.statues-tuile[aria-pressed="true"]').count(), 1, "Personne décoche les équipes");
    await page.locator("#c-next", { hasText: "✓ Valider : personne" }).click();
    await waitFor(async () => (await commandes("statues_win")).some((c) => c.personne === true && c.teams == null && c.team == null), "« Personne » envoyé");
    await box.set({ statues: { ...etat, ended: true, dancing: false, result: { song: 0, winners: null, gains: {}, at: Date.now() - 9000 } } });
    await page.locator("#statues-info", { hasText: "Personne ne gagne cette chanson." }).waitFor();

    // Chanson suivante pendant une chanson : jamais sans gagnante, l'écran gagnant s'ouvre d'abord.
    await box.set({ statues: { ...etat, song: 0, dancing: true, ended: false, result: null }, seq: 5 });
    const avant = (await read("commands")) ?? {};
    await page.locator("#c-next", { hasText: "⏭ Chanson suivante" }).click();
    await page.locator("#statues-info", { hasText: "Qui a gagné ?" }).waitFor();
    assert.deepEqual(Object.keys((await read("commands")) ?? {}), Object.keys(avant), "rien n'est envoyé à la box");
    await page.click("#statues-retour");
    await page.locator("#statues-bascule", { hasText: "✋ STATUE !" }).waitFor();

    // Pause générale : le gros bouton attend la reprise.
    await box.set({ paused: true, pauseReason: "regie", statues: { ...etat, dancing: false, result: null } });
    await waitFor(async () => page.locator("#statues-bascule").isDisabled(), "bouton figé pendant la pause");
    await page.context().close();
  });

  test("statues sur 8 équipes (régie cockpit) : noms entiers, « Valider » toujours sous le doigt", async () => {
    const huit = ["Orange", "Vert", "Rose", "Jaune", "Bleu", "Violet", "Rouge", "Turquoise"].map((n, i) => [`e${i}`, `Les ${n}s`, TEAM_COLORS_TEST[i % TEAM_COLORS_TEST.length]]);
    const { page } = await statuesEnCours({ ended: true, dancing: false }, huit, `?g=${CODE}&emu=1&cockpit=1`);
    await page.locator(".statues-tuile.personne").waitFor();
    await page.locator(".statues-tuile", { hasText: "Les Turquoises" }).click();
    await page.locator("#c-next", { hasText: "✓ Valider : Les Turquoises" }).waitFor();
    // Le gros bouton « Valider » reste à l'écran (barre du bas), sans faire défiler la page.
    const vue = page.viewportSize();
    const bas = await page.locator("#c-next").boundingBox();
    assert.ok(bas && bas.y + bas.height <= vue.height + 1, "Valider visible sans défiler");
    assert.equal(await page.locator(".statues-tuile").count(), 9);
    assert.equal(await page.locator("#statues-teams.serree").count(), 1);
    // Largeur du nom lui-même (la pastille ✓ déborde exprès du coin de la tuile cochée).
    const deborde = await page.evaluate(() => [...document.querySelectorAll(".statues-tuile")].some((b) => {
      const r = document.createRange();
      r.selectNodeContents(b);
      const t = r.getBoundingClientRect();
      const c = b.getBoundingClientRect();
      return t.left < c.left + 3 || t.right > c.right - 3;
    }));
    assert.equal(deborde, false, "aucun nom coupé");
    await capture(page, "regie-statues-8-equipes");
    await page.context().close();
  });

  /** Duel des robots : la box publie state.duel (contrat du 27/10) ; l'heure du PAN n'y est jamais. */
  async function duelEnCours(duel, teams = [["rose", "Les Roses", "#FF2D8A"], ["bleu", "Les Bleus", "#2B86C5"], ["vert", "Les Verts", "#39FF14"]], query = `?g=${CODE}&emu=1&cockpit=1`) {
    box = startBox();
    for (const [id, nom, couleur] of teams) await addTeam(id, nom, couleur);
    const plan = [{ id: "d1", kind: "duel", text: "Le Duel des robots", round: "Le Duel des robots", joueurs: 2, faceMin: 20, faceMax: 40, longs: true }];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, blind: true, statues: true, disparu: true, pictionary: true, coffres: true, gonfleur: true, patate: true, duel: true, simon: true, chrono: true, questions: plan });
    const etat = { n: 1, total: 3, teams: ["rose", "bleu"], players: [1, 1], step: "ready", extra: false, key: "d1-1", result: null, played: {}, allPlayed: false, ...duel };
    await box.set({ ...questionState(1), qid: "d1", kind: "duel", text: plan[0].text, choices: null, total: 1, durationMs: null, deadline: null, duel: etat });
    const page = await openRegie(undefined, query);
    await pair(page);
    await inRegie(page);
    return { page, etat };
  }

  test("duel des robots : lancer, face-à-face (arrêt en deux appuis), gagnante, trop tôt, personne, duel suivant, résultats", async () => {
    const { page, etat } = await duelEnCours({});
    await page.locator("#duel-info", { hasText: "Duel 1 sur 3 : appelez les deux joueurs." }).waitFor();
    await page.locator("#duel-face .duel-equipe", { hasText: "Les Roses" }).waitFor();
    // Jamais de « joueur n° » : l'équipe joue, la rotation se fait entre eux (cedric, 31/10 au soir).
    assert.equal(await page.locator("#duel-face").getByText(/joueur n°/i).count(), 0, "pas de joueur n° au duel");
    await page.locator("#duel-face .duel-equipe", { hasText: "Les Bleus" }).waitFor();
    await page.locator("#duel-points", { hasText: "100 points par duel gagné" }).waitFor();
    assert.equal(await page.locator("#c-tuiles").isVisible(), false, "le milieu est au duel");
    await page.locator("#c-next", { hasText: "🤠 Lancer le duel" }).click();
    await waitFor(async () => (await commandes("duel_start")).some((c) => c.teams == null), "face-à-face lancé");

    await box.set({ duel: { ...etat, step: "standoff", key: "d1-1b" } });
    await page.locator("#duel-info", { hasText: "Face-à-face… mains sur les buzzers" }).waitFor();
    await page.locator("#c-next", { hasText: "Face-à-face… 🤠" }).waitFor();
    assert.equal(await page.locator("#c-next").isDisabled(), true, "rien à lancer pendant le face-à-face");
    assert.equal(await page.locator("#duel-autres").isVisible(), false);
    await page.click("#duel-stop");
    await page.locator("#duel-stop", { hasText: "Touchez encore" }).waitFor();
    assert.equal((await commandes("duel_stop")).length, 0, "un seul appui n'arrête rien");
    await page.click("#duel-stop");
    await waitFor(async () => (await commandes("duel_stop")).length === 1, "face-à-face arrêté");

    await box.set({ duel: { ...etat, step: "result", result: { winner: "rose", loser: "bleu", early: null, ms: 312, points: 100 } } });
    await page.locator("#duel-resultat", { hasText: "🏆 Les Roses gagne le duel en 0,31 s !" }).waitFor();
    await page.locator("#c-next", { hasText: "▶ Duel suivant" }).click();
    await waitFor(async () => (await commandes("duel_next")).length === 1, "duel suivant demandé");
    await box.set({ duel: { ...etat, step: "result", result: { winner: "rose", loser: "bleu", early: "bleu", ms: null, points: 100 } } });
    await page.locator("#duel-resultat", { hasText: "💥 Les Bleus a tiré trop tôt : Les Roses gagne le duel." }).waitFor();
    await box.set({ duel: { ...etat, step: "result", result: { winner: null, loser: null, early: null, ms: null, points: 0 } } });
    await page.locator("#duel-resultat", { hasText: "Personne n'a tiré ! Duel nul, aucun point." }).waitFor();

    // Tous les joueurs passés : le gros bouton finit le jeu, un duel en plus reste possible.
    await box.set({ duel: { ...etat, n: 3, step: "result", allPlayed: true, result: { winner: "vert", loser: "rose", early: null, ms: 420, points: 100 } } });
    await page.locator("#duel-autres", { hasText: "🤠 Duel en plus" }).waitFor();
    // Duel en plus : comme la box, les 2 équipes qui ont le moins joué sont cochées d'avance (pas la paire d'avant).
    await box.set({ duel: { ...etat, n: 3, step: "result", allPlayed: true, teams: ["vert", "rose"], played: { rose: 2, bleu: 1, vert: 1 }, result: { winner: "vert", loser: "rose", early: null, ms: 420, points: 100 } } });
    await page.click("#duel-autres");
    await page.locator("#c-next", { hasText: "🤠 Les Bleus contre Les Verts" }).waitFor();
    await page.click("#duel-retour");
    assert.equal(await page.locator("#duel-fin").isVisible(), false, "« Jeu suivant » est déjà le gros bouton");
    await page.locator("#c-next", { hasText: "Résultats finaux 🏆" }).click();
    await waitFor(async () => (await commandes("next")).length === 1, "jeu suivant");
    await page.context().close();
  });

  test("duel des robots : duel à la volée entre 2 équipes choisies, « Jeu suivant » confirmé, pause, une seule équipe", async () => {
    const { page, etat } = await duelEnCours({});
    // Qui affronte qui (cedric, 27/10) : la paire proposée par la box est cochée d'avance, Sarah la change.
    await page.click("#duel-autres");
    await page.locator("#c-next", { hasText: "🤠 Les Roses contre Les Bleus" }).waitFor();
    assert.equal(await page.locator("#duel-face").isVisible(), false);
    await page.locator("#duel-choix .statues-tuile", { hasText: "Les Roses" }).click();
    await page.locator("#c-next", { hasText: "Touchez 2 équipes" }).waitFor();
    assert.equal(await page.locator("#c-next").isDisabled(), true);
    await page.locator("#duel-choix .statues-tuile", { hasText: "Les Verts" }).click();
    await page.locator("#duel-choix .statues-tuile", { hasText: "Les Roses" }).click();
    assert.deepEqual(await page.locator('#duel-choix [aria-pressed="true"]').allTextContents(), ["Les Roses", "Les Verts"], "2 équipes au plus : la plus ancienne part");
    await page.locator("#duel-choix .statues-tuile", { hasText: "Les Roses" }).click();
    await page.locator("#duel-choix .statues-tuile", { hasText: "Les Bleus" }).click();
    await page.locator("#c-next", { hasText: "🤠 Les Verts contre Les Bleus" }).click();
    await waitFor(async () => (await commandes("duel_start")).some((c) => JSON.stringify(c.teams) === JSON.stringify(["vert", "bleu"])), "duel à la volée lancé");
    await page.locator("#duel-face").waitFor();

    // Retour sans rien lancer.
    await page.click("#duel-autres");
    await page.click("#duel-retour");
    await page.locator("#c-next", { hasText: "🤠 Lancer le duel" }).waitFor();

    // « Jeu suivant » avant la fin des duels prévus : confirmé, on dit combien il en reste.
    await page.click("#duel-fin");
    assert.match(await respond(page, false), /Arrêter les duels \? 3 duels prévus pas encore joués/);
    assert.equal((await commandes("next")).length, 0);
    await page.click("#duel-fin");
    await respond(page);
    await waitFor(async () => (await commandes("next")).length === 1, "jeu suivant après confirmation");

    await box.set({ paused: true, pauseReason: "regie", duel: { ...etat, step: "ready" }, seq: 9 });
    await waitFor(async () => page.locator("#duel-autres").isDisabled(), "pause : rien ne part");
    await page.context().close();
  });

  test("duel des robots : une seule équipe, la régie le dit et propose le jeu suivant", async () => {
    const { page } = await duelEnCours({ teams: [] }, [["rose", "Les Roses", "#FF2D8A"]]);
    await page.locator("#duel-info", { hasText: "Il faut au moins 2 équipes pour un duel" }).waitFor();
    await page.locator("#c-next", { hasText: "Résultats finaux 🏆" }).click();
    await waitFor(async () => (await commandes("next")).length === 1, "jeu suivant");
    await page.context().close();
  });

  test("duel des robots sur 8 équipes : sans joueur n°, choix de 2 équipes, gros bouton toujours visible", async () => {
    const huit = ["Orange", "Vert", "Rose", "Jaune", "Bleu", "Violet", "Rouge", "Turquoise"].map((n, i) => [`e${i}`, `Les ${n}s`, TEAM_COLORS_TEST[i % TEAM_COLORS_TEST.length]]);
    const { page } = await duelEnCours({ teams: ["e0", "e7"], players: [3, 2] }, huit);
    await page.locator("#duel-face .duel-equipe", { hasText: "Les Turquoises" }).waitFor();
    assert.equal(await page.locator("#duel-face").getByText(/joueur n°/i).count(), 0, "pas de joueur n° sur 8 équipes");
    await capture(page, "regie-duel-pret");
    await page.click("#duel-autres");
    assert.equal(await page.locator("#duel-choix .statues-tuile").count(), 8);
    const bas = await page.locator("#c-next").boundingBox();
    assert.ok(bas && bas.y + bas.height <= page.viewportSize().height + 1, "le gros bouton reste visible");
    await capture(page, "regie-duel-choix");
    await page.context().close();
  });

  test("Le Chrono de Buzzy : régler la cible, lancer, suivre les buzz sans l'heure, écarts et points 100 / 50 / 25, tour suivant", async () => {
    box = startBox();
    const teams = [["rose", "Les Roses", "#FF2D8A"], ["bleu", "Les Bleus", "#2B86C5"], ["vert", "Les Verts", "#39FF14"], ["jaune", "Les Jaunes", "#FFE600"]];
    for (const [id, nom, couleur] of teams) await addTeam(id, nom, couleur);
    const plan = [{ id: "ch", kind: "chrono", text: "Le Chrono de Buzzy", round: "Le Chrono de Buzzy", choices: [], correct: -1, double: false, cible: 30, tours: 3 }];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, blind: true, statues: true, disparu: true, pictionary: true, coffres: true, gonfleur: true, patate: true, duel: true, simon: true, chrono: true, questions: plan });
    const etat = { tour: 1, tours: 3, cible: 30, step: "ready", key: "ch-1-0", last: false };
    await box.set({ ...questionState(1), qid: "ch", kind: "chrono", text: plan[0].text, choices: null, total: 1, durationMs: null, deadline: null, chrono: etat });
    const page = await openRegie(undefined, `?g=${CODE}&emu=1&cockpit=1`);
    await pair(page);
    await inRegie(page);
    await page.locator("#chrono-info", { hasText: "Tour 1 sur 3" }).waitFor();
    await page.locator("#chrono-info", { hasText: "Cible : 30 secondes" }).waitFor();
    await page.locator("#chrono-points", { hasText: "100, 50 et 25 points" }).waitFor();
    await page.locator("#c-next", { hasText: "⏱️ Lancer le chrono (30 s)" }).waitFor();
    await capture(page, "regie-chrono-pret", { pleinePage: false });
    // −5 : la cible part à la box ; jamais sous 10 s.
    await page.click('#chrono-reglage button[data-pas="-5"]');
    await waitFor(async () => (await commandes("chrono_cible")).some((c) => c.cible === 25), "cible 25 envoyée");
    await box.set({ chrono: { ...etat, cible: 25 } });
    await page.locator("#chrono-cible", { hasText: "25 s" }).waitFor();
    await page.locator("#c-next", { hasText: "Lancer le chrono (25 s)" }).click();
    await waitFor(async () => (await commandes("chrono_go")).length === 1, "chrono lancé");
    // En cours : qui a buzzé, jamais à quelle heure.
    const run = { ...etat, cible: 25, step: "run", key: "ch-1-100", goAt: Date.now() - 12_000, cacheMs: 8000, teams: teams.map(([id]) => id), buzzed: ["rose", "jaune"] };
    await box.set({ chrono: run });
    await page.locator("#chrono-info", { hasText: "2 / 4 équipes ont buzzé" }).waitFor();
    await page.locator("#chrono-equipes li", { hasText: "Les Roses" }).locator("span", { hasText: "✅ a buzzé" }).waitFor();
    await page.locator("#chrono-equipes li", { hasText: "Les Bleus" }).locator("span", { hasText: "compte…" }).waitFor();
    await page.locator("#c-next", { hasText: "Chrono en cours… ⏱️" }).waitFor();
    assert.equal(await page.locator("#c-next").isDisabled(), true, "rien à lancer pendant le chrono");
    assert.doesNotMatch(await page.locator("#chrono").innerText(), /\d+,\d\d/, "aucun temps avant la révélation");
    await capture(page, "regie-chrono-en-cours", { pleinePage: false });
    assert.equal(await page.locator("#chrono-reveler").isVisible(), false, "cible pas encore passée : rien à révéler");
    // Toutes ont buzzé : le bilan attend Sarah, le gros bouton devient « 👀 Révéler » (cedric, 31/10).
    await box.set({ chrono: { ...run, buzzed: teams.map(([id]) => id), reveler: true } });
    await page.locator("#chrono-info", { hasText: "Toutes les équipes ont buzzé" }).waitFor();
    await page.locator("#c-next", { hasText: "👀 Révéler" }).waitFor();
    assert.equal(await page.locator("#c-next").isDisabled(), false, "Sarah révèle quand elle veut");
    assert.equal(await page.locator("#chrono-reveler").isVisible(), false, "un seul bouton Révéler");
    await capture(page, "regie-chrono-reveler", { pleinePage: false });
    await page.click("#c-next");
    await waitFor(async () => (await commandes("chrono_reveal")).length === 1, "révélation envoyée");
    // Une équipe ne buzze pas, la cible est passée : « Révéler sans attendre », le gros bouton reste en attente.
    await box.set({ chrono: { ...run, goAt: Date.now() - 40_000, reveler: null } });
    await page.locator("#chrono-reveler", { hasText: "Révéler sans attendre" }).waitFor();
    await page.locator("#c-next", { hasText: "Chrono en cours… ⏱️" }).waitFor();
    // Bilan : écarts, la plus proche d'abord, et les points des 3 plus proches.
    await box.set({ chrono: { ...run, step: "result", buzzed: null,
      result: { ecarts: { rose: -380, bleu: 1240, vert: 2900, jaune: -4100 }, winners: ["rose"], points: 100, gains: { rose: 100, bleu: 50, vert: 25 }, at: Date.now() } } });
    await page.locator("#chrono-info", { hasText: "🏆 Les Roses gagne le tour." }).waitFor();
    await page.locator("#chrono-equipes li", { hasText: "Les Roses" }).locator("span", { hasText: "+100" }).waitFor();
    await page.locator("#chrono-equipes li", { hasText: "Les Bleus" }).locator("span", { hasText: "+50" }).waitFor();
    await page.locator("#chrono-equipes li", { hasText: "Les Verts" }).locator("span", { hasText: "+25" }).waitFor();
    assert.doesNotMatch(await page.locator("#chrono-equipes li", { hasText: "Les Jaunes" }).innerText(), /\+\d/, "la 4e ne marque pas");
    await page.locator("#c-next", { hasText: "▶ Tour suivant (2 / 3)" }).waitFor();
    await capture(page, "regie-chrono-bilan", { pleinePage: false });
    await page.context().close();
  });

  /** Simon de Buzzy : la box publie state.simon (contrat du 27/10 au soir) ; la suite secrète n'y est jamais avant le bilan. */
  async function simonEnCours(simon, teams = [["rose", "Les Roses", "#FF2D8A"], ["bleu", "Les Bleus", "#2B86C5"], ["vert", "Les Verts", "#39FF14"]]) {
    box = startBox();
    for (const [id, nom, couleur] of teams) await addTeam(id, nom, couleur);
    const plan = [{ id: "s1", kind: "simon", text: "Le Simon de Buzzy", round: "Le Simon de Buzzy", choices: [], correct: -1, double: false, tours: 2, reponse: 10, joueurs: 4 }];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, blind: true, statues: true, disparu: true, pictionary: true, coffres: true, gonfleur: true, patate: true, duel: true, simon: true, chrono: true, questions: plan });
    const etat = { tour: 1, tours: 2, suite: 3, step: "ready", teams: teams.map(([id]) => id), out: {}, players: Object.fromEntries(teams.map(([id], i) => [id, i + 1])), last: false, verdict: null, ...simon };
    await box.set({ ...questionState(1), qid: "s1", kind: "simon", text: plan[0].text, choices: null, total: 1, durationMs: null, deadline: null, simon: etat });
    const page = await openRegie(undefined, `?g=${CODE}&emu=1&cockpit=1`);
    await pair(page);
    await inRegie(page);
    return { page, etat };
  }

  test("Simon de Buzzy : lancer la suite, l'arrêter en deux appuis, bilan après la vérification TV, suite et tour suivants, jeu suivant", async () => {
    const { page, etat } = await simonEnCours({});
    await page.locator("#simon-info", { hasText: "Tour 1 sur 2. Suite de 3 : appelez le joueur de chaque équipe." }).waitFor();
    await page.locator("#simon-equipes li", { hasText: "Les Bleus" }).locator("span", { hasText: "en jeu" }).waitFor();
    assert.equal(await page.locator("#simon-equipes").getByText(/joueur n°/i).count(), 0, "pas de joueur n° au Simon");
    await page.locator("#simon-points", { hasText: "300 points pour l'équipe qui gagne le tour" }).waitFor();
    assert.equal(await page.locator("#c-tuiles").isVisible(), false, "le milieu est au Simon");
    assert.equal(await page.locator("#c-answer").isVisible(), false, "pas de « bonne réponse » : la suite est secrète");
    await page.locator("#c-next", { hasText: "▶ Lancer la suite de 3" }).click();
    await waitFor(async () => (await commandes("simon_go")).length === 1, "suite lancée");

    await box.set({ simon: { ...etat, step: "play", key: "s1-1-3-1", finAt: Date.now() + 9000 } });
    await page.locator("#simon-info", { hasText: "Suite de 3 en cours : fin du chrono dans" }).waitFor();
    await page.locator("#c-next", { hasText: "Suite en cours… 🔴" }).waitFor();
    assert.equal(await page.locator("#c-next").isDisabled(), true, "rien à lancer pendant la suite");
    await page.click("#simon-stop");
    await page.locator("#simon-stop", { hasText: "Touchez encore" }).waitFor();
    assert.equal((await commandes("simon_stop")).length, 0, "un seul appui n'arrête rien");
    await page.click("#simon-stop");
    await waitFor(async () => (await commandes("simon_stop")).length === 1, "suite arrêtée");

    // Suite jugée : le bouton attend la vérification colonne par colonne de la TV (3 × 0,7 s + 1,5 s).
    const verdict = { suite: 3, solution: "rouge,vert,jaune", answers: {}, wrong: ["vert"], winners: [], points: 300, at: Date.now() };
    await box.set({ simon: { ...etat, step: "judged", suite: 4, out: { vert: 3 }, verdict } });
    await page.locator("#c-next", { hasText: "Vérification à la TV…" }).waitFor();
    assert.equal(await page.locator("#c-next").isDisabled(), true);
    await page.locator("#c-next", { hasText: "▶ Suite suivante (4 éléments)" }).waitFor({ timeout: 8000 });
    await page.locator("#simon-verdict", { hasText: "Bonne suite : 🔴 🟢 🟡 · Erreur : Les Verts" }).waitFor();
    await page.locator("#simon-equipes li.eliminee", { hasText: "Les Verts" }).locator("span", { hasText: "éliminée (suite de 3)" }).waitFor();
    await page.click("#c-next");
    await waitFor(async () => (await commandes("simon_go")).length === 2, "suite suivante");

    // « Bah alors » : toutes fausses, la même suite se rejoue.
    await box.set({ simon: { ...etat, step: "judged", suite: 4, verdict: { ...verdict, suite: 4, solution: "rouge,vert,jaune,4", wrong: ["rose", "bleu"], bahAlors: true, at: Date.now() - 9000 } } });
    await page.locator("#c-next", { hasText: "▶ Relancer la suite" }).waitFor();
    await page.locator("#simon-verdict", { hasText: "🔴 🟢 🟡 4" }).waitFor();

    // Tour gagné, puis dernier tour : « Jeu suivant ».
    await box.set({ simon: { ...etat, step: "won", suite: 5, out: { vert: 3, bleu: 5 }, verdict: { ...verdict, suite: 5, solution: "bleu,bleu,rouge,4,2", wrong: ["bleu"], winners: ["rose"], at: Date.now() - 9000 } } });
    await page.locator("#simon-info", { hasText: "🏆 Les Roses gagne le tour." }).waitFor();
    await page.locator("#simon-equipes li", { hasText: "Les Roses" }).locator("span", { hasText: "🏆 gagne le tour" }).waitFor();
    await page.locator("#c-next", { hasText: "▶ Tour suivant (2 / 2)" }).click();
    await waitFor(async () => (await commandes("simon_go")).length === 3, "tour suivant");
    await box.set({ simon: { ...etat, tour: 2, step: "won", last: true, verdict: { ...verdict, winners: ["bleu", "rose"], at: Date.now() - 9000 } } });
    await page.locator("#simon-info", { hasText: "Les Bleus, Les Roses gagnent le tour." }).waitFor();
    assert.equal(await page.locator("#simon-fin").isVisible(), false, "« Jeu suivant » est déjà le gros bouton");
    await page.locator("#c-next", { hasText: "Résultats finaux 🏆" }).click();
    await waitFor(async () => (await commandes("next")).length === 1, "jeu suivant");
    await page.context().close();
  });

  test("Simon de Buzzy : « Jeu suivant » en cours de route confirmé, pause, 8 équipes lisibles", async () => {
    const huit = ["Orange", "Vert", "Rose", "Jaune", "Bleu", "Violet", "Rouge", "Turquoise"].map((n, i) => [`e${i}`, `Les ${n}s`, TEAM_COLORS_TEST[i % TEAM_COLORS_TEST.length]]);
    const { page, etat } = await simonEnCours({ out: { e3: 4 } }, huit);
    // La liste se remplit à l'arrivée de l'état de la partie : on attend la 8e équipe avant de compter.
    await page.locator("#simon-equipes li").nth(7).waitFor();
    assert.equal(await page.locator("#simon-equipes li").count(), 8);
    await page.locator("#simon-equipes li.eliminee", { hasText: "Les Jaunes" }).waitFor();
    const bas = await page.locator("#c-next").boundingBox();
    assert.ok(bas && bas.y + bas.height <= page.viewportSize().height + 1, "le gros bouton reste visible");
    await capture(page, "regie-simon-8-equipes");
    await page.click("#simon-fin");
    assert.match(await respond(page, false), /Arrêter le Simon de Buzzy \? 2 tours pas encore gagnés/);
    assert.equal((await commandes("next")).length, 0);
    await page.click("#simon-fin");
    await respond(page);
    await waitFor(async () => (await commandes("next")).length === 1, "jeu suivant après confirmation");
    await box.set({ paused: true, pauseReason: "regie", simon: { ...etat, step: "ready" }, seq: 9 });
    await waitFor(async () => page.locator("#simon-fin").isDisabled(), "pause : rien ne part");
    await page.context().close();
  });

  test("« ▶ Y aller » du conducteur (cedric, 30/10, à la place de « ⏭ Changer de jeu ») : « Êtes-vous sûr ? » Oui / Non, bilan des scores d'abord, un jeu déjà joué recommence", async () => {
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
    const page = await openRegie(null, `?g=${CODE}&emu=1&cockpit=1`);
    await pair(page);
    await inRegie(page);
    await page.locator("#c-games", { hasText: "En cours : Quiz de Léa · Ensuite : Mimes : Animaux" }).waitFor();
    // Plus de « ⏭ Changer de jeu » : le conducteur montre « ▶ Y aller » sur chaque autre jeu, pas sur celui en cours.
    assert.equal(await page.locator("#c-rescue, #rescue").count(), 0);
    await ouvrirConducteur(page);
    const allerA = (titre) => page.locator(".plan-head", { hasText: titre }).locator("button.go");
    await allerA("Finale").waitFor();
    assert.equal(await page.locator(".plan-head", { hasText: "Quiz de Léa" }).locator("button.go").count(), 0, "pas sur le jeu en cours");
    // « Non » : rien n'est envoyé.
    await allerA("Animaux").click();
    let asked = await respond(page, false);
    assert.match(asked, /^Êtes-vous sûr \?/);
    await page.waitForTimeout(300);
    assert.equal(box.gotos.length, 0);
    // « Oui » : bilan des scores sur la TV d'abord (cedric, 24/10), puis « Jeu suivant » ouvre les mimes ; les points restent.
    await allerA("Animaux").click();
    assert.equal(await page.textContent("#ask-line"), "Vous allez passer à «\u00a0Mimes : Animaux\u00a0».");
    asked = await respond(page);
    await page.locator("#r-toast", { hasText: "Bilan des scores sur la TV, puis « Mimes : Animaux »." }).waitFor();
    assert.match(asked, /points déjà gagnés sont gardés/);
    assert.match(asked, /La TV montre le bilan des scores, puis « Mimes : Animaux »/);
    assert.deepEqual(box.gotos, [{ index: 2, qid: "a1m" }]);
    await page.locator("#c-next:not([hidden])", { hasText: "Jeu suivant : Mimes : Animaux ▶" }).waitFor();
    await page.click("#c-next");
    await page.locator("#mime:not([hidden])").waitFor();
    assert.equal((await read("state")).scores.rose, 100);
    await page.locator("#c-games", { hasText: "En cours : Mimes : Animaux · Ensuite : Finale" }).waitFor();
    // Le quiz déjà joué : « ▶ Y aller » le recommence, ses points retirés puis rejoués ; le bilan des mimes d'abord.
    await ouvrirConducteur(page);
    await allerA("Quiz de Léa").click();
    asked = await respond(page);
    await page.locator("#r-toast", { hasText: "Bilan des scores sur la TV, puis « Quiz de Léa »." }).waitFor();
    assert.match(asked, /rien n'est compté deux fois/);
    assert.match(asked, /La TV montre d'abord le bilan des scores du jeu en cours\./);
    assert.deepEqual(box.gotos[1], { index: 0, qid: "q1" });
    await page.locator("#c-next:not([hidden])", { hasText: "Jeu suivant : Quiz de Léa ▶" }).waitFor();
    // Partie terminée par erreur pendant les mimes : la finale jamais jouée reste à venir, la partie peut reprendre.
    await box.set({ phase: "ended", index: 2, qid: "a1m", mime: null, seq: (await read("state")).seq + 1 });
    await page.locator("#c-next:not([hidden])", { hasText: "Jeu suivant : Finale" }).waitFor();
    await ouvrirConducteur(page);
    await allerA("Finale").click();
    assert.match(await respond(page), /La partie reprend avec ce jeu/);
    await page.locator("#r-toast", { hasText: "C'est parti pour « Finale » !" }).waitFor();
    assert.deepEqual(box.gotos[2], { index: 3, qid: "f1" });
    await page.context().close();
  });

  test("dernier jeu (cedric, 30/10) : un jeu ajouté juste après pendant sa dernière question, ou pendant son bilan, et la suite enchaîne dessus", async () => {
    box = startBox({ enchaine: true });
    await addTeam("rose", "Les Roses");
    const plan = [
      { id: "q1", text: "Couleur du ciel ?", choices: ["Vert", "Bleu"], correct: 1, duration: 20, kind: "classic", round: "Quiz de Léa" },
      { id: "q2", text: "2 + 2 ?", choices: ["4", "5"], correct: 0, duration: 20, kind: "classic", round: "Quiz de Léa" },
    ];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", patate: true, gonfleur: true, questions: plan });
    await box.set({ ...questionState(4), phase: "reveal", index: 1, qid: "q2", text: "2 + 2 ?", choices: ["4", "5"], total: 2, scores: { rose: 100 } });
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    // Dernière question du dernier jeu : la suite, ce sont les résultats finaux.
    await regie.locator("#c-next", { hasText: "Résultats finaux 🏆" }).waitFor();
    await regie.click("#c-add");
    await carteDuJeu(regie, "patate");
    await regie.locator("#carte-envoyer:not([disabled])").click();
    await regie.locator("#r-toast", { hasText: "« Ça va exploser ! » est ajouté après le jeu en cours." }).waitFor();
    // Tout de suite : le quiz n'est plus le dernier jeu, son bilan des scores puis « Jeu suivant ».
    await regie.locator("#c-next", { hasText: "Voir les scores" }).waitFor();
    assert.equal(await read("state/total"), 3);
    await box.set({ phase: "scores", seq: (await read("state")).seq + 1 });
    await regie.locator("#c-next", { hasText: `Jeu suivant : ${ROUND_TYPES_TEST.patate} ▶` }).click();
    await waitFor(async () => (await read("state/index")) === 2, "la TV enchaîne sur le jeu ajouté");
    const patate = (await read("conducteur")).questions[2];
    assert.equal((await read("state")).qid, patate.id);

    // Le jeu ajouté est fini, son bilan à l'écran : c'était le dernier… Sarah en ajoute un autre pendant le bilan.
    await box.set({ phase: "scores", seq: (await read("state")).seq + 1 });
    await regie.locator("#c-next", { hasText: "Résultats finaux 🏆" }).waitFor();
    await regie.click("#c-add");
    await carteDuJeu(regie, "gonfleur");
    await regie.locator("#carte-envoyer:not([disabled])").click();
    await regie.locator("#r-toast", { hasText: "Gonfleur fou » est ajouté après le jeu en cours." }).waitFor();
    await regie.locator("#c-next", { hasText: "Jeu suivant : Le Gonfleur fou ▶" }).click();
    await waitFor(async () => (await read("state/index")) === 3, "la TV enchaîne sur le Gonfleur fou");
    assert.equal((await read("state")).scores.rose, 100, "les points restent");
    await regie.context().close();
  });

  test("« ↺ Relancer ce jeu » : le jeu en cours repart de sa première question d'un seul geste, après l'avertissement", async () => {
    // cedric, 30/10 : une manche mal partie (règles pas comprises), Sarah relance le jeu en cours sans chercher.
    box = startBox();
    await addTeam("rose", "Les Roses");
    const plan = [
      { id: "q1", text: "Couleur du ciel ?", choices: ["Vert", "Bleu"], correct: 1, duration: 20, kind: "classic", round: "Quiz de Léa" },
      { id: "q2", text: "2 + 2 ?", choices: ["4", "5"], correct: 0, duration: 20, kind: "classic", round: "Quiz de Léa" },
      { id: "f1", text: "Finale ?", choices: ["A", "B"], correct: 0, duration: 10, kind: "classic", round: "Finale" },
    ];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", mimes: true, numbers: true, express: true, zoom: true, flou: true, chante: true, quisuis: true, questions: plan });
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    // Au salon : pas de jeu en cours, pas de bouton.
    assert.equal(await page.locator("#c-recommencer").getAttribute("hidden"), "");
    await box.set({ ...questionState(3), index: 1, qid: "q2", text: "2 + 2 ?", total: 3, scores: { rose: 100 } });
    await page.locator("#c-games", { hasText: "En cours : Quiz de Léa" }).waitFor();
    await page.locator("#c-recommencer:not([hidden])", { hasText: "↺ Relancer ce jeu" }).waitFor({ state: "attached" });
    // Renoncer : rien n'est envoyé.
    await page.locator("#c-recommencer").evaluate((el) => el.click());
    assert.match(await page.locator("#ask-attention").textContent(), /Ce jeu repart à zéro : les points gagnés pendant ce jeu sont effacés\./);
    assert.equal(await page.locator("#ask-attention").isHidden(), false);
    await respond(page, false);
    await page.waitForTimeout(300);
    assert.equal(box.gotos.length, 0);
    // Accepter : retour à la première question du jeu en cours, rien compté deux fois.
    await page.locator("#c-recommencer").evaluate((el) => el.click());
    const question = await respond(page);
    assert.match(question, /Recommencer « Quiz de Léa » \?.*rien n'est compté deux fois/);
    // Pas de bilan des scores (cedric, 30/10) : le jeu repart sur sa présentation.
    assert.match(question, /La TV repart sur la présentation du jeu, puis « ▶ Lancer l'épreuve »\./);
    assert.doesNotMatch(question, /bilan/);
    await waitFor(async () => box.gotos.length === 1, "retour au début du jeu envoyé à la TV");
    assert.deepEqual(box.gotos, [{ index: 0, qid: "q1" }]);
    // Partie terminée : plus de jeu en cours, plus de bouton.
    await box.set({ phase: "ended", seq: (await read("state")).seq + 1 });
    await page.locator("#c-recommencer[hidden]").waitFor({ state: "attached" });
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
    await givePoints(page, "rose", 50);
    await page.locator(".team .score", { hasText: "50" }).waitFor();
    await page.locator("#undo-text", { hasText: "+50 pour Les Roses" }).waitFor();
    await page.click("#undo-go");
    await waitFor(async () => (await commands()).some((c) => c.type === "undo" && c.target === 1), "annulation envoyée");
    const adjust = (await commands()).find((c) => c.type === "adjust");
    assert.equal(adjust.team, "rose");
    assert.equal(adjust.delta, 50);
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
    // La liste des équipes d'abord ; l'animatrice touche la sienne, puis un bonus.
    await page.locator("#pts-title", { hasText: "quelle équipe" }).waitFor();
    assert.deepEqual(await page.locator("#pts-teams button .name").allTextContents(), ["Les Roses", "Les Bleus"]);
    await page.click('#pts-teams button[data-team="bleu"]');
    await page.locator("#pts-title", { hasText: "Points pour Les Bleus" }).waitFor();
    await page.click('#pts [data-delta="50"]');
    await page.locator("#undo-text", { hasText: "+50 pour Les Bleus" }).waitFor();
    const adjust = (await commands()).filter((c) => c.type === "adjust");
    assert.deepEqual(adjust.map((c) => [c.team, c.delta]), [["bleu", 50]]);
    await page.context().close();
  });

  test("« ± Points » simplifié (cedric, 30/10) : l'équipe, puis trois bonus et trois malus ; un appui = un seul envoi, « Annuler » quelques secondes", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await page.click("#tab-teams");
    await page.locator('.team[data-team="rose"] .pts-open').click();
    await page.locator("#pts-title", { hasText: "Points pour Les Roses" }).waitFor();
    assert.deepEqual(await page.locator("#pts .pts-bloc.bonus button").allTextContents(), ["+50", "+100", "+200"]);
    assert.deepEqual(await page.locator("#pts .pts-bloc.malus button").allTextContents(), ["−50", "−100", "−200"]);
    assert.equal(await page.locator("#pts-score").textContent(), "Score : 0");
    // « ← Autre équipe » revient à la liste, sans rien envoyer.
    await page.click("#pts-autre");
    await page.locator("#pts-title", { hasText: "quelle équipe" }).waitFor();
    await page.click('#pts-teams button[data-team="rose"]');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await commands()).length, 0, "choisir l'équipe n'envoie rien");
    // Double appui sur +200 : une seule correction, la fenêtre se ferme et le second appui ne la rouvre pas.
    await page.locator('#pts [data-delta="200"]').dblclick();
    await page.locator("#undo-text", { hasText: "+200 pour Les Roses" }).waitFor();
    await page.locator('.team[data-team="rose"] .score', { hasText: "200" }).waitFor();
    assert.equal(await page.locator("#pts").isHidden(), true);
    // Malus : −50.
    await givePoints(page, "rose", -50);
    await page.locator("#undo-text", { hasText: "−50 pour Les Roses" }).waitFor();
    await page.locator('.team[data-team="rose"] .score', { hasText: "150" }).waitFor();
    // Fermer sans toucher un montant : rien n'est envoyé.
    await page.locator('.team[data-team="bleu"] .pts-open').click();
    await page.click("#pts-cancel");
    await page.locator("#pts").waitFor({ state: "hidden" });
    // « Annuler » sur le bandeau : le malus est annulé.
    await page.click("#undo-go");
    await waitFor(async () => (await commands()).some((c) => c.type === "undo"), "annulation envoyée");
    const deltas = (await commands()).filter((c) => c.type === "adjust").map((c) => [c.team, c.delta]);
    assert.deepEqual(deltas, [["rose", 200], ["rose", -50]]);
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
    await ouvrirConducteur(page);
    await page.locator("#panel-plan .plan-item").first().waitFor();
    const text = await page.locator("#panel-plan").textContent();
    assert.ok(!text.includes("Super Finale"), text);
    await page.context().close();
  });

  test("le conducteur liste les questions avec leur réponse", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await ouvrirConducteur(page);
    await page.locator(".plan-item", { hasText: "Le soleil est une étoile" }).locator("b", { hasText: "A · Vrai" }).waitFor();
    await page.context().close();
  });

  test("juste avant les dernières questions du quiz, l'animatrice choisit ×2, ×3, ×4 ou ×5", async () => {
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
    // ×4 aussi (cedric, 31/10).
    await page.click("#c-factor [data-factor='4']");
    await waitFor(async () => (await commands()).find((c) => c.type === "factor" && c.factor === 4), "commande ×4");
    await page.locator("#c-factor [data-factor='4'].on").waitFor();
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
    await box.set({ ...questionState(box.state.seq + 1, 0), index: 2, qid: "b1", kind: "coffres", text: "Les Coffres mystères", choices: null, deadline: null, total: 4, chests });
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
    await page.locator("#coffres-opened", { hasText: "Les Bleus : +150" }).waitFor();
    // La bombe arrive, cachée avec le coffre en or ; puis les Roses trouvent le coffre en or.
    await box.set({ ...box.state, seq: box.state.seq + 1, chests: { ...chests, team: "bleu", turn: 6, safeLeft: 0, danger: true, goldLeft: true, key: "b1-1-6", opened } });
    await page.locator("#coffres-info", { hasText: "La bombe est cachée dans un des coffres ! ⭐ Le coffre en or (+500) aussi." }).waitFor();
    const or = { team: "rose", chest: 8, delta: 500, bomb: false, gold: true, at: Date.now() };
    await box.set({ ...box.state, seq: box.state.seq + 1, chests: { ...chests, team: "bleu", turn: 7, safeLeft: 0, danger: true, goldLeft: false, key: "b1-1-7", opened: [...opened, or] } });
    await page.locator("#coffres-opened", { hasText: "Les Roses : ⭐ +500" }).waitFor();
    assert.equal(await page.locator("#coffres-info", { hasText: "coffre en or" }).count(), 0, "le coffre en or est trouvé");
    // La bombe : jeu fini. Pas de tableau des scores après les coffres (cedric, 28/10) : dernier jeu, les résultats finaux.
    await box.set({ ...box.state, seq: box.state.seq + 1, phase: "reveal", total: 3, chests: { ...chests, team: null, key: null, exploded: true, opened: [...opened, { team: "rose", chest: 1, delta: -300, bomb: true, at: Date.now() }] } });
    await page.locator("#coffres[hidden]").waitFor({ state: "attached" });
    await page.locator("#c-next", { hasText: "Résultats finaux" }).waitFor();
    assert.equal(await page.locator("#c-next", { hasText: "Voir les scores" }).count(), 0, "jamais « Voir les scores » après les coffres");
    await page.context().close();
  });

  test("Les coffres mystères : « ⏭ Jeu suivant » quitte les coffres sans attendre la bombe, après confirmation", async () => {
    // Test du 27/10 au soir : Sarah voulait passer à un autre jeu pendant les coffres et se croyait bloquée.
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    const plan = (await read("conducteur")) ?? { questions: [] };
    const bombe = { id: "b1", text: "Les Coffres mystères", kind: "coffres", choices: [], correct: -1, round: "Les Coffres mystères" };
    const apres = { id: "z1", text: "Couleur du ciel ?", choices: ["Bleu", "Vert"], correct: 0, round: "Quiz final" };
    const questions = [...plan.questions, bombe, apres];
    const i = questions.length - 2;
    await set(gameRef("conducteur"), { ...plan, coffres: true, questions });
    const chests = { ready: true, count: 10, order: ["bleu", "rose"], team: "bleu", turn: 0, safe: 6, safeLeft: 6, danger: false, exploded: false, key: "b1-1-0", readyAt: Date.now() - 1000, opened: [], gains: { bleu: 0, rose: 0 } };
    await box.set({ ...questionState(box.state.seq + 1, 0), index: i, qid: "b1", kind: "coffres", text: "Les Coffres mystères", choices: null, deadline: null, total: questions.length, chests });
    await page.locator("#c-next", { hasText: "Coffres en cours" }).waitFor();
    // Renoncer : rien n'est envoyé.
    await page.locator("#coffres-fin:not([hidden])", { hasText: "Jeu suivant" }).click();
    await respond(page, false);
    await page.waitForTimeout(300);
    assert.equal(box.gotos.length, 0);
    // Confirmer : la régie saute au jeu suivant, bilan des scores d'abord, points gardés.
    await page.click("#coffres-fin");
    const asked = await respond(page);
    assert.match(asked, /points déjà gagnés sont gardés/);
    await waitFor(() => box.gotos.length === 1, "saut envoyé à la box");
    assert.deepEqual(box.gotos, [{ index: i + 1, qid: "z1" }]);
    await page.locator("#coffres[hidden]").waitFor({ state: "attached" });
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
    await box.set({ ...questionState(box.state.seq + 1, 0), index: 2, qid: "g1", kind: "gonfleur", text: "Le Gonfleur fou", choices: null, total: 4, resumeAt: goAt, pump: { key: "g1-1", goAt, target: 100 } });
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

  test("Vrai ou Faux express : jamais « Voir les scores » entre deux affirmations, seulement à la fin de la série", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await addTeam("rose", "Les Roses");
    const plan = (await read("conducteur")) ?? { questions: [] };
    const i = plan.questions.length;
    const aff = (id, text) => ({ id, text, kind: "express", choices: ["Vrai", "Faux"], correct: 0, round: "Vrai ou Faux express" });
    const apres = { id: "c9", text: "Quelle est la capitale de la France ?", kind: "classic", choices: ["Paris", "Lyon", "Nice", "Lille"], correct: 0, round: "Quiz" };
    await set(gameRef("conducteur"), { ...plan, express: true, questions: [...plan.questions, aff("e1", "Le Soleil est une étoile."), aff("e2", "Les poissons volent."), apres] });
    const revelation = (index, qid, text) => ({
      ...questionState(box.state.seq + 1, 0), phase: "reveal", index, qid, kind: "express", text, choices: ["Vrai", "Faux"], deadline: null, total: i + 3,
    });
    // Test du 28/10 : « Voir les scores » s'affichait après chaque affirmation, alors que la TV enchaîne seule.
    await box.set(revelation(i, "e1", "Le Soleil est une étoile."));
    await page.locator("#c-next", { hasText: "Affirmation suivante" }).waitFor();
    assert.equal(await page.locator("#c-next", { hasText: "Voir les scores" }).count(), 0);
    // Dernière affirmation de la série : les scores, avant le jeu suivant.
    await box.set(revelation(i + 1, "e2", "Les poissons volent."));
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
    await box.set({ ...questionState(box.state.seq + 1, 0), index: 2, qid: "p1", kind: "patate", text: "Ça va exploser !", choices: null, deadline: null, total: 4, potato });
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

  test("« Ça va exploser ! » (cedric, 26/10) : « 🏁 Dernière bombe » pendant une bombe, « ⏭ Jeu suivant » entre deux, un seul appui ; rien après la dernière", async () => {
    box = startBox();
    const page = await openRegie(await contexteSansChoix({ viewport: { width: 360, height: 640 } }));
    await pair(page);
    await inRegie(page);
    await addTeam("rose", "Les Roses");
    await addTeam("bleu", "Les Bleus");
    const plan = (await read("conducteur")) ?? { questions: [] };
    const bombe = { id: "p1", text: "Ça va exploser !", kind: "patate", choices: [], correct: -1, round: "Ça va exploser !" };
    await set(gameRef("conducteur"), { ...plan, patate: true, patateStop: true, questions: [...plan.questions, bombe] });
    const now = Date.now();
    const potato = { lit: true, holder: "rose", from: null, since: now - 3000, readyAt: now - 1000, canReturn: true, targets: ["bleu"], teams: ["rose", "bleu"], hit: ["rose"], passes: 0, key: "p1-1", bomb: 1, bombs: 3, exploded: false, booms: [] };
    await box.set({ ...questionState(box.state.seq + 1, 0), index: 2, qid: "p1", kind: "patate", text: "Ça va exploser !", choices: null, deadline: null, total: 3, potato });
    const stop = page.locator("#patate-stop");
    // Bombe 1 sur 3 en cours : « 🏁 Dernière bombe », dans l'écran, un seul appui.
    await page.locator("#patate-stop:not([hidden])", { hasText: "🏁 Dernière bombe" }).waitFor();
    const r = await stop.boundingBox();
    assert.ok(r.y >= 0 && r.y + r.height <= 640, `bouton dans l'écran : ${JSON.stringify(r)}`);
    await stop.click();
    await waitFor(async () => (await commands()).filter((c) => c.type === "potato_stop").length === 1, "« Dernière bombe » envoyé en un appui");
    // La box l'a pris en compte : cette bombe est la dernière, plus de bouton.
    await box.set({ ...box.state, seq: box.state.seq + 1, potato: { ...potato, bombs: 1 } });
    await page.locator("#patate-stop").waitFor({ state: "hidden" });
    // Elle explose : « C'était la dernière bombe », jamais « La bombe 2 s'allume ».
    const boom = { holder: "rose", at: Date.now(), lost: 100, gain: 100 };
    await box.set({ ...box.state, seq: box.state.seq + 1, potato: { ...potato, bombs: 1, exploded: true, key: null, booms: [boom] } });
    await page.locator("#patate-info", { hasText: "C'était la dernière bombe" }).waitFor();
    assert.doesNotMatch(await page.textContent("#patate-info"), /s'allume/);
    assert.equal(await stop.isHidden(), true);
    // Autre partie de 3 bombes : BOUM de la bombe 1 → « ⏭ Jeu suivant ».
    await box.set({ ...box.state, seq: box.state.seq + 1, potato: { ...potato, exploded: true, key: null, booms: [boom] } });
    await page.locator("#patate-info", { hasText: "La bombe 2 s'allume…" }).waitFor();
    await page.locator("#patate-stop:not([hidden])", { hasText: "⏭ Jeu suivant" }).waitFor();
    // La bombe 2 allumée mais pas encore partie : toujours « ⏭ Jeu suivant », puis « 🏁 Dernière bombe » une fois partie.
    const go = Date.now() + 2500;
    await box.set({ ...box.state, seq: box.state.seq + 1, potato: { ...potato, holder: "bleu", since: go, readyAt: go + 2000, bomb: 2, exploded: false, key: "p1-2", booms: [boom] } });
    await page.locator("#patate-info", { hasText: "Bombe 2 sur 3" }).waitFor();
    assert.equal(await stop.textContent(), "⏭ Jeu suivant");
    await page.locator("#patate-stop", { hasText: "🏁 Dernière bombe" }).waitFor({ timeout: 6000 });
    // Bombe 3 sur 3 : déjà la dernière, pas de bouton.
    await box.set({ ...box.state, seq: box.state.seq + 1, potato: { ...potato, holder: "rose", since: Date.now() - 1000, bomb: 3, exploded: false, key: "p1-3", booms: [boom, { ...boom, holder: "bleu" }] } });
    await page.locator("#patate-info", { hasText: "Bombe 3 sur 3" }).waitFor();
    assert.equal(await stop.isHidden(), true);
    // Ancienne box (sans patateStop) : jamais de bouton.
    await set(gameRef("conducteur"), { ...plan, patate: true, questions: [...plan.questions, bombe] });
    await box.set({ ...box.state, seq: box.state.seq + 1, potato: { ...potato, bomb: 1 } });
    await page.locator("#patate-info", { hasText: "Bombe 1 sur 3" }).waitFor();
    assert.equal(await stop.isHidden(), true);
    await capture(page, "patate-derniere-bombe-360x640", { pleinePage: false });
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

  /** Appui long sur [id] pendant [ms]. */
  async function appuyerLongtemps(page, id, ms) {
    const r = await page.locator(`#${id}`).boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
  }
  const deuxJeux = [
    { id: "q1", text: "Couleur du ciel ?", choices: ["Vert", "Bleu"], correct: 1, round: "Couleurs" },
    { id: "q2", text: "Qui rugit ?", choices: ["Lion", "Chat"], correct: 0, round: "Animaux" },
  ];

  test("« ⏭ Terminer » (cedric, 29/10 et 31/10) : appui court = jeu suivant, ou podium au dernier jeu ; toujours « Êtes-vous sûr de vouloir terminer le jeu en cours ? Oui / Non »", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await set(gameRef("conducteur"), { id: "p", title: "Léa", rev: "s1", mimes: true, questions: deuxJeux });
    const page = await openRegie(undefined, `?g=${CODE}&emu=1&cockpit=1`);
    await pair(page);
    await inRegie(page);
    assert.equal(await page.locator("#c-end").getAttribute("hidden"), "", "rien à terminer au salon");
    await box.set({ ...questionState(1), qid: "q1", text: deuxJeux[0].text, choices: deuxJeux[0].choices, total: 2 });
    await page.click("#c-plus");
    // ⏭ dessiné (cedric, 31/10) : triangles centrés sur la barre ; le texte du bouton ne change pas.
    assert.equal(await page.locator("#c-end .picto-suivant").count(), 1);
    assert.match(await page.locator("#c-end").textContent(), /^⏭ Terminer/);
    await page.locator("#plus #c-end", { hasText: "⏭ Terminer" }).click();
    await page.locator("#ask-line", { hasText: "Vous allez passer au jeu suivant : «\u00a0Animaux\u00a0»." }).waitFor();
    await capture(page, "terminer-jeu-suivant", { pleinePage: false });
    assert.equal(await page.locator("#ask-text").textContent(), "« Couleurs » s'arrête ici. Les points déjà gagnés sont gardés.");
    assert.equal(await page.locator("#ask-attention").isHidden(), true, "l'encadré rouge est réservé à « Terminer la partie »");
    assert.equal(await page.locator("#ask-title").textContent(), "Êtes-vous sûr de vouloir terminer le jeu en cours ?");
    assert.deepEqual([await page.locator("#ask-ok").textContent(), await page.locator("#ask-cancel").textContent()], ["Oui", "Non"]);
    await respond(page, false);
    assert.equal((await commands()).length, 0, "Non : rien n'est envoyé");
    await page.click("#c-plus");
    await page.click("#c-end");
    await respond(page);
    await waitFor(async () => (await commands()).some((c) => c.type === "goto" && c.index === 1 && c.qid === "q2"), "jeu suivant demandé");
    // Dernier jeu : la suite, ce sont les résultats finaux.
    await box.set({ ...questionState(5, 1), qid: "q2", text: deuxJeux[1].text, choices: deuxJeux[1].choices, index: 1, total: 2 });
    await page.click("#c-plus");
    await page.click("#c-end");
    await page.locator("#ask-line", { hasText: "Vous allez passer au podium final." }).waitFor();
    assert.match(await respond(page), /Êtes-vous sûr de vouloir terminer le jeu en cours \? « Animaux » est le dernier jeu\./);
    await page.locator("#c-phase", { hasText: "Partie terminée" }).waitFor();
    assert.equal(await page.locator("#c-end").getAttribute("hidden"), "");
    await page.context().close();
  });

  test("« ⏭ Terminer » (cedric, 31/10) : plus d'appui long ni de menu ; doigt gardé appuyé = la même question qu'un appui court", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await set(gameRef("conducteur"), { id: "p", title: "Léa", rev: "s1", mimes: true, questions: deuxJeux });
    await box.set({ ...questionState(1), qid: "q1", text: deuxJeux[0].text, choices: deuxJeux[0].choices, total: 2 });
    const page = await openRegie(undefined, `?g=${CODE}&emu=1&cockpit=1`);
    await pair(page);
    await inRegie(page);
    assert.equal(await page.locator("#c-end.hold, #c-end .fill").count(), 0, "pas de jauge sur « ⏭ Terminer »");
    await page.click("#c-plus");
    await appuyerLongtemps(page, "c-end", 1200);
    assert.equal(await page.locator("#fin-choix").isHidden(), true, "le choix podium / fin définitive est sur « ⛔ Terminer la partie » seulement");
    assert.equal(await respond(page, false), "Êtes-vous sûr de vouloir terminer le jeu en cours ? « Couleurs » s'arrête ici. Les points déjà gagnés sont gardés.");
    assert.equal((await commands()).length, 0, "Non : rien n'est envoyé");
    await page.context().close();
  });

  test("« ⛔ Terminer la partie » (cedric, 29/10 et 31/10) : appui long seulement, « ⛔ Terminer définitivement la partie », « Êtes-vous sûr ? », tout s'arrête sans podium et la régie suit la TV", async () => {
    box = startBox({ suite: "SUIT5" });
    await addTeam("rose", "Les Roses");
    await set(gameRef("conducteur"), { id: "p", title: "Léa", rev: "s1", mimes: true, questions: deuxJeux });
    await box.set({ ...questionState(1), qid: "q1", text: deuxJeux[0].text, choices: deuxJeux[0].choices, total: 2 });
    const page = await openRegie(undefined, `?g=${CODE}&emu=1&cockpit=1`);
    await pair(page);
    await inRegie(page);
    await page.click("#c-plus");
    await capture(page, "arreter-la-partie-bouton", { pleinePage: false });
    assert.equal(await page.locator("#c-arret .label").textContent(), "⛔ Terminer la partie");
    await page.click("#c-arret");
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#ask").isHidden(), true, "un toucher n'ouvre rien");
    assert.equal(await page.locator("#r-toast:not([hidden])").count(), 0, "et n'affiche rien");
    await appuyerLongtemps(page, "c-arret", 1700);
    await page.click("#fin-arret");
    // Gros encadré rouge « ATTENTION » (cedric, 29/10), sur le téléphone seulement.
    await page.locator("#ask-attention:not([hidden])", { hasText: "⚠️ ATTENTION" }).waitFor();
    assert.match(await page.locator("#ask-attention").textContent(), /Ce bouton va mettre fin définitivement à la partie\./);
    assert.equal(await page.locator("#ask-attention").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(211, 20, 28)");
    assert.equal(await page.locator("#c-arret").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(211, 20, 28)", "bouton plein rouge, pas comme les autres");
    await capture(page, "arreter-la-partie-attention", { pleinePage: false });
    assert.match(await respond(page, false), /^Êtes-vous sûr \? Pas de podium : la TV revient tout de suite à l'accueil\./);
    assert.equal((await commands()).length, 0);
    await page.click("#c-plus");
    await appuyerLongtemps(page, "c-arret", 1700);
    await page.click("#fin-arret");
    await respond(page);
    await waitFor(async () => (await commands()).some((c) => c.type === "newgame" && c.arret === true), "arrêt envoyé");
    assert.equal((await commands()).some((c) => c.type === "end"), false, "jamais le podium");
    // La régie suit la TV sur sa nouvelle partie, comme après « Fin de la fête ».
    await page.waitForURL(/[?&]g=SUIT5/, { timeout: 10000 });
    await page.context().close();
  });

  test("« ⛔ Terminer la partie », jauge pleine (cedric, 31/10) : « 🏆 Aller au podium » à gauche, « ⛔ Terminer définitivement la partie » à droite, puis « Êtes-vous sûr ? »", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    await set(gameRef("conducteur"), { id: "p", title: "Léa", rev: "s1", mimes: true, questions: deuxJeux });
    await box.set({ ...questionState(1), qid: "q1", text: deuxJeux[0].text, choices: deuxJeux[0].choices, total: 2 });
    const page = await openRegie(undefined, `?g=${CODE}&emu=1&cockpit=1`);
    await pair(page);
    await inRegie(page);
    await page.click("#c-plus");
    await appuyerLongtemps(page, "c-arret", 1700);
    await page.locator("#fin-choix:not([hidden])", { hasText: "Que voulez-vous faire ?" }).waitFor();
    const gauche = await page.locator("#fin-podium").boundingBox();
    const droite = await page.locator("#fin-arret").boundingBox();
    assert.ok(gauche.x + gauche.width <= droite.x + 1, "« Aller au podium » à gauche");
    assert.equal(await page.locator("#fin-podium").textContent(), "🏆 Aller au podium");
    assert.equal(await page.locator("#fin-arret").textContent(), "⛔ Terminer définitivement la partie");
    assert.equal(await page.locator("#ask").isHidden(), true, "pas encore de confirmation");
    assert.equal(await page.locator("#plus").getAttribute("hidden"), "", "« ☰ Plus » se referme derrière le choix");
    await capture(page, "terminer-la-partie-choix", { pleinePage: false });
    // Annuler : rien n'est envoyé.
    await page.click("#fin-annuler");
    await page.locator("#fin-choix").waitFor({ state: "hidden" });
    assert.equal((await commands()).length, 0, "Annuler : rien n'est envoyé");
    // Podium, puis Non : rien n'est envoyé.
    await page.click("#c-plus");
    await appuyerLongtemps(page, "c-arret", 1700);
    await page.click("#fin-podium");
    await page.locator("#ask-line", { hasText: "Vous allez passer au podium final." }).waitFor();
    assert.match(await respond(page, false), /^Êtes-vous sûr \? Les jeux qui restent ne seront pas joués\./);
    assert.equal((await commands()).length, 0, "Non : rien n'est envoyé");
    // Podium, puis Oui : les résultats finaux.
    await page.click("#c-plus");
    await appuyerLongtemps(page, "c-arret", 1700);
    await page.click("#fin-podium");
    await respond(page);
    await page.locator("#c-phase", { hasText: "Partie terminée" }).waitFor();
    assert.deepEqual((await commands()).map((c) => c.type), ["end"]);
    await page.context().close();
  });

  test("« ⛔ Terminer la partie » avec une TV d'avant (refus « pas finie ») : la partie est terminée puis quittée", async () => {
    box = startBox({ arretPartie: false });
    await addTeam("rose", "Les Roses");
    await set(gameRef("conducteur"), { id: "p", title: "Léa", rev: "s1", mimes: true, questions: deuxJeux });
    await box.set({ ...questionState(1), qid: "q1", text: deuxJeux[0].text, choices: deuxJeux[0].choices, total: 2 });
    const page = await openRegie(undefined, `?g=${CODE}&emu=1&cockpit=1`);
    await pair(page);
    await inRegie(page);
    await page.click("#c-plus");
    await appuyerLongtemps(page, "c-arret", 1700);
    await page.click("#fin-arret");
    await respond(page);
    await waitFor(async () => (await commands()).map((c) => c.type).join(",") === "newgame,end,newgame", "arrêt, puis fin, puis sortie");
    await waitFor(async () => (await read("state/leftAt")) != null, "la TV a quitté la partie");
    await page.context().close();
  });

  test("« ▶ Lancer la fin » avec une box d'avant (pas d'outroAt) : le bouton s'efface après sa réponse, « Fin de la fête » prend sa place", async () => {
    box = startBox({ outro: false });
    await addTeam("rose", "Les Roses");
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await box.set({ phase: "ended", index: QUESTIONS.length - 1, seq: (await read("state")).seq + 1 });
    await page.locator("#c-lancer-fin:not([hidden])").click();
    await page.locator("#c-fin:not([hidden])").waitFor();
    assert.equal(await page.locator("#c-lancer-fin").isHidden(), true);
    assert.equal(await read("state/outroAt"), null);
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
    // Podium (cedric, 29/10) : d'abord « ▶ Lancer la fin », un seul gros bouton ; « Fin de la fête » vient après.
    const lancer = page.locator("#c-lancer-fin:not([hidden])");
    await lancer.waitFor();
    assert.equal(await fin.isHidden(), true, "pas de « Fin de la fête » avant la fusée");
    assert.match(await page.textContent("#c-question"), /Parlez aux enfants, puis « ▶ Lancer la fin »/);
    assert.ok((await lancer.boundingBox()).height >= 90, "un gros bouton");
    await lancer.click();
    await page.locator("#r-toast", { hasText: "▶ Fin lancée : la fusée part sur la TV." }).waitFor();
    assert.deepEqual((await commands()).map((c) => c.type), ["next"]);
    assert.ok(await read("state/outroAt"), "la box a lancé la fin");
    await page.locator("#c-lancer-fin").waitFor({ state: "hidden" });
    await page.locator("#c-fin:not([hidden])").waitFor();
    assert.equal(await page.locator("#c-next").isHidden(), true);
    assert.match(await page.textContent("#c-question"), /Sinon : « 🏁 Fin de la fête »/);
    assert.ok((await fin.boundingBox()).height >= 90, "un gros bouton");
    // Annulé : rien n'est envoyé.
    await fin.click();
    assert.match(await respond(page, false), /Fin de la fête \? La TV quitte l'écran de fin et revient à l'accueil/);
    assert.equal((await commands()).length, 1);
    await fin.click();
    await respond(page);
    await page.locator("#r-toast", { hasText: "🏁 Fête terminée : la TV revient à l'accueil." }).waitFor();
    assert.deepEqual((await commands()).map((c) => c.type), ["next", "newgame"]);
    await page.locator("#c-question", { hasText: "🏁 Fête terminée. La TV est revenue à l'accueil, prête pour la prochaine fête. Merci !" }).waitFor();
    assert.equal(await fin.isHidden(), true);
    assert.equal(await page.locator("#c-next").isHidden(), true);
    await capture(page, "fin-de-la-fete");
    await page.context().close();
  });

  test("« 🏁 Fin de la fête » : la régie suit la TV toute seule dans la nouvelle partie, sans QR ni mot de passe, la liste des prestations ouverte (cedric, 25/10)", async () => {
    box = startBox({ suite: "SUIT3" });
    await addTeam("rose", "Les Roses");
    const page = await openRegie(await contexteSansChoix({ viewport: { width: 390, height: 844 } }));
    await pair(page);
    await inRegie(page);
    await box.set({ phase: "ended", index: QUESTIONS.length - 1, outroAt: Date.now(), seq: (await read("state")).seq + 1 });
    await page.click("#c-fin");
    await respond(page);
    // La TV a ouvert SUIT3 : la régie y passe seule, déjà reliée, au salon d'attente.
    await page.waitForURL(/[?&]g=SUIT3/, { timeout: 10000 });
    await inRegie(page);
    await page.locator("#c-next", { hasText: "En attente des équipes" }).waitFor();
    assert.equal(await page.locator("#regie-login").isHidden(), true, "pas de mot de passe à retaper");
    // La liste des prestations s'ouvre d'elle-même, le bouton principal reste visible dessous.
    await page.locator("#plus:not([hidden]) #panel-show:not([hidden])").waitFor();
    assert.equal(await page.locator("#c-next").isVisible(), true);
    await capture(page, "fin-de-la-fete-suit-la-tv", { pleinePage: false });
    // Un rechargement ne rouvre pas la liste : on reste simplement sur la nouvelle partie.
    assert.doesNotMatch(page.url(), /suivie=/);
    await page.reload();
    await inRegie(page);
    assert.match(page.url(), /[?&]g=SUIT3/);
    await page.context().close();
  });

  test("« 🏁 Fin de la fête » : si la box n'a pas pu relier le téléphone à la nouvelle partie, la régie le dit et y emmène avec le mot de passe", async () => {
    box = startBox({ suite: "SUIT4", copieRegie: false });
    await addTeam("rose", "Les Roses");
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await box.set({ phase: "ended", index: QUESTIONS.length - 1, outroAt: Date.now(), seq: (await read("state")).seq + 1 });
    await page.click("#c-fin");
    await respond(page);
    const suite = page.locator("#c-suite:not([hidden])", { hasText: "La TV a ouvert une nouvelle partie" });
    await suite.waitFor();
    assert.match(page.url(), /[?&]g=REGI2/, "la régie ne part pas seule");
    assert.match(await suite.locator("a").getAttribute("href"), /[?&]g=SUIT4.*regie=1|regie=1.*[?&]g=SUIT4/);
    await suite.locator("a").click();
    await page.waitForURL(/[?&]g=SUIT4/);
    await page.locator("#regie-login:not([hidden])").waitFor();
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

  test("lancer : les défis de la pause préparés dans la fiche sont copiés dans la partie, à la suite de ceux déjà ajoutés (cedric, 31/10)", async () => {
    box = startBox();
    await seedShows({ lea: prestation("Léa", isoDay(), { defis: ["Tout le monde imite un lion !", "Bravo à Mamie !"] }) });
    await writeRaw(`games/${CODE}/defisFete`, { list: ["Déjà là !", "Bravo à Mamie !"], updatedAt: 1 });
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await item(regie, "Léa").click();
    await regie.locator("#ask:not([hidden])").waitFor();
    await regie.click("#ask-ok");
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    assert.deepEqual((await raw(`games/${CODE}/defisFete`)).list, ["Déjà là !", "Bravo à Mamie !", "Tout le monde imite un lion !"]);
    await regie.context().close();
  });

  test("la liste des prestations est gardée sur le téléphone : affichée tout de suite au retour, puis mise à jour (cedric, 25/10)", async () => {
    box = startBox();
    await seedShows({ lea: prestation("Léa", isoDay()) });
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await item(regie, "Léa").locator(".show-run", { hasText: "Préparée" }).waitFor();
    const gardee = await regie.evaluate(() => JSON.parse(localStorage.getItem("lmp-regie-prestations")));
    assert.deepEqual(gardee.map((x) => [x.id, x.show.childName, x.jeux > 0]), [["lea", "Léa", true]]);
    // Rechargée (nouveau scan, page quittée) : la liste gardée d'abord, puis la vraie, qui a changé entre-temps.
    await seedShows({ lea: prestation("Léa", isoDay()), zoe: prestation("Zoé", isoDay()) });
    await regie.reload();
    await inRegie(regie);
    await item(regie, "Léa").waitFor();
    await item(regie, "Zoé").waitFor();
    await regie.locator("#panel-show .hint", { hasText: "Mise à jour" }).waitFor({ state: "detached" });
    assert.deepEqual((await regie.evaluate(() => JSON.parse(localStorage.getItem("lmp-regie-prestations")))).map((x) => x.id).sort(), ["lea", "zoe"]);
    // Toucher une prestation la relit toujours à l'instant du lancement.
    await item(regie, "Zoé").click();
    await regie.locator("#ask:not([hidden])").waitFor();
    assert.equal(await regie.textContent("#ask-title"), "Lancer l'anniversaire de Zoé ?");
    await regie.click("#ask-cancel");
    await regie.context().close();
  });

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
    // Une autre date (cedric, 30/10) : on peut la lancer, la fenêtre dit pour quand elle était prévue.
    assert.equal(await regie.textContent("#ask-warn"), `⚠ Fête initialement prévue le ${date}. Lancer quand même ?`);
    assert.equal(await regie.textContent("#ask-ok"), "Lancer quand même");
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

    // Aucun point : « Mauvaise prestation ? », discret, au bas du conducteur (plus de « ⏭ Changer de jeu », 30/10).
    await ouvrirConducteur(regie);
    await regie.locator("#plan-wrong").click();
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
    await givePoints(regie, "rose", 50);
    await waitFor(async () => (await read("state/scored")) === true, "point compté par la box");
    await ouvrirConducteur(regie);
    await regie.locator("#panel-plan .plan-head").first().waitFor();
    assert.equal(await regie.locator("#plan-wrong").count(), 0);

    // Point donné au même instant (l'écran ne le savait pas encore) : la box refuse, le téléphone le dit simplement.
    await writeRaw(`games/${CODE}/state/scored`, null);
    await regie.locator("#plan-wrong").click();
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

  test("« Recommencer » ou « ▶ Y aller » recopie dans la partie les photos et extraits du jeu qui y manquent", async () => {
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
    await ouvrirConducteur(regie);
    await regie.locator(".plan-head", { hasText: "Animaux" }).locator("button.go").click();
    // Son extrait pas encore marqué par la box : voyant orange, la confirmation dit « Lancer quand même ? ».
    await regie.locator("#ask-warn:not([hidden])", { hasText: "pas encore chargé" }).waitFor();
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "Bilan des scores sur la TV, puis « Animaux »." }).waitFor();
    await waitFor(async () => (await read(`images/${PHOTO}`)) === PNG && (await read(`sounds/${SON}`)) === MP3, "photo et extrait recopiés dans la partie");
    await regie.context().close();
  });
  test("statues : « ▶ Y aller » recopie dans la partie les chansons entières (n en dernier) ; une chanson absente ne bloque rien", async () => {
    box = startBox();
    const P0 = "A".repeat(800000);
    const P1 = "B".repeat(1200);
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), "library/entieres/danse"), { n: 2, kbps: 96, length: 187, at: 1, p: { 0: P0, 1: P1 } }));
    await set(gameRef("conducteur"), {
      id: "p", title: "L'anniversaire de Léa", rev: "s1", mimes: true, statues: true, programReset: true,
      questions: [
        { id: "q1", text: "Couleur du ciel ?", choices: ["Vert", "Bleu"], correct: 1, round: "Couleurs" },
        { id: "s1", text: "Statues musicales", kind: "statues", round: "Statues musicales", songs: [{ songId: "absente", audioId: "fedcba9876543210", title: "Pas en ligne" }, { songId: "danse", audioId: "0123456789abcdef", title: "Danse" }] },
      ],
    });
    await box.set(questionState(2));
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await ouvrirConducteur(regie);
    await regie.locator(".plan-head", { hasText: "Statues musicales" }).locator("button.go").click();
    await regie.locator("#ask-warn:not([hidden])", { hasText: "pas encore chargé" }).waitFor();
    await respond(regie);
    await waitFor(async () => (await read("songs/danse/n")) === 2, "chanson entière recopiée", 20000);
    assert.deepEqual(await read("songs/danse"), { n: 2, kbps: 96, length: 187, p: [P0, P1] });
    assert.equal(await read("songs/absente"), null, "chanson pas en ligne : la box jouera l'extrait");
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
    await givePoints(regie, blue, 50);
    await waitFor(async () => (await read("state"))?.scores?.[blue] === 50, "points avant le remplacement");

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
    assert.equal((await read("state")).scores[blue], 50, "points gardés");

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
    await givePoints(regie, blue, 50);
    await waitFor(async () => (await read("state"))?.scores?.[blue] === 50, "points avant la reconnexion");

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
    assert.equal((await read("state")).scores[blue], 50, "points gardés");

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

  test("« ＋ Ajouter une équipe » dans ☰ Plus (test Mi Box de cedric, 26/10) : QR direct en nouvelle équipe, carte « Nouvelle équipe en attente », jusqu'à 8 équipes (360×640)", async () => {
    box = startBox();
    const regie = await openRegie(await contexteSansChoix({ viewport: { width: 360, height: 640 } }));
    await pair(regie);
    await inRegie(regie);
    await regie.locator("#regie.cockpit").waitFor();
    const touk = await tablet();
    await accepter(regie, "Touk");
    await touk.locator("#screen-play.active").waitFor();
    await regie.locator("#c-next", { hasText: "Lancer la fête !" }).click();
    await touk.locator("#screen-question.active").waitFor();
    // En pleine partie : « ☰ Plus » → « ＋ Ajouter une équipe », un gros bouton bien visible.
    await regie.click("#c-plus");
    const bouton = regie.locator("#plus:not([hidden]) #c-equipe");
    await bouton.waitFor();
    const r = await bouton.boundingBox();
    assert.ok(r.y >= 0 && r.y + r.height <= 640 && r.x + r.width <= 360, `bouton dans l'écran : ${JSON.stringify(r)}`);
    assert.equal(await bouton.isDisabled(), false);
    await bouton.click();
    await regie.locator("#plus").waitFor({ state: "hidden" });
    await regie.locator("#tablette:not([hidden]) #tablette-qr svg path").waitFor();
    assert.equal(await regie.textContent("#tablette-titre"), "Ajouter une équipe");
    // Le QR ouvre la partie sans « reprise » : la tablette ne propose pas de reprendre une équipe.
    const lien = await regie.locator("#tablette-qr").getAttribute("data-texte");
    assert.equal(lien, `${baseUrl}/?g=${CODE}&emu=1`);
    assert.equal(await regie.locator("#tablette-bloquee").isHidden(), true);
    await capture(regie, "regie-ajouter-equipe-360x640", { pleinePage: false });
    const nouvelle = await openRegie(null, new URL(lien).search);
    await nouvelle.locator("#screen-waiting.active").waitFor();
    assert.equal(await nouvelle.locator("#screen-takeover.active").count(), 0);
    // La demande arrive : la fenêtre se referme sur la carte « Nouvelle équipe en attente ».
    await regie.locator("#tablette").waitFor({ state: "hidden" });
    const carte = regie.locator("#c-requests .request", { hasText: "Nouvelle équipe en attente" });
    await carte.waitFor();
    // La carte se voit sans rien faire défiler, au-dessus des boutons du bas.
    const c = await carte.boundingBox();
    const bas = await regie.locator(".regie .actions").boundingBox();
    assert.ok(c.y >= 0 && c.y + 60 <= bas.y, `carte visible : ${JSON.stringify({ c, bas })}`);
    await capture(regie, "regie-ajouter-equipe-carte-360x640", { pleinePage: false });
    await accepter(regie, "Les Tard-Venus");
    await nouvelle.locator("#screen-question.active").waitFor();
    assert.equal(await nouvelle.locator("#screen-question .team-label").textContent(), "Les Tard-Venus");
    await regie.locator("#c-tuiles .tuile", { hasText: "Les Tard-Venus" }).waitFor();
    // Reconnecter une tablette garde son QR « reprise ».
    await regie.click("#c-plus");
    await regie.click("#c-tablette");
    await regie.locator("#tablette-titre", { hasText: "Reconnecter une tablette" }).waitFor();
    assert.match(await regie.locator("#tablette-qr").getAttribute("data-texte"), /reprise=1/);
    await regie.click("#tablette-close");
    // 8 équipes : le bouton se grise, avec la raison.
    for (let k = 0; k < 6; k++) await addTeam(`t${k}`, `Équipe ${k + 3}`, TEAM_COLORS_TEST[k]);
    await regie.click("#c-plus");
    await regie.locator("#plus #c-equipe[disabled]").waitFor();
    assert.equal(await regie.locator("#c-equipe").getAttribute("title"), "8 équipes au maximum");
    for (const p of [regie, touk, nouvelle]) await p.context().close();
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

/** Le conducteur : « ☰ Plus » › « 📋 Conducteur » en régie « cockpit » (page plein écran, cedric 30/10), sinon son onglet. */
async function ouvrirConducteur(page) {
  if (!(await page.locator("#c-conducteur").count())) return page.click("#tab-plan");
  if (await page.locator("#conducteur").isHidden()) {
    if (await page.locator("#plus").isHidden()) await page.click("#c-plus");
    await page.click("#c-conducteur");
  }
  await page.locator("#conducteur:not([hidden])").waitFor();
}

/** « ✏️ Modifier ce jeu » (choix A, cedric 30/10) : déplie le jeu dans le conducteur, puis rouvre sa carte. */
async function modifierJeu(page, titre) {
  const jeu = page.locator(`.plan-jeu:has(> .plan-head[data-round="${titre}"])`);
  if (await jeu.locator(".plan-questions").isHidden()) await jeu.locator(".plan-deplier").click();
  await jeu.locator(".plan-questions button.edit").click();
}

/** « ＋ Jeu » (cedric, 30/10) : touche le jeu dans la liste et rend la carte de la Régie PC ouverte dans son cadre. */
async function carteDuJeu(regie, type) {
  await regie.locator(`#lib-list .lib-jeu[data-jeu="${type}"]`).click();
  await regie.locator("#carte:not([hidden])").waitFor();
  const cadre = regie.frameLocator("#carte-cadre");
  await cadre.locator(`#carte-jeu .jeu-bloc[data-jeu="${type}"]`).waitFor();
  return cadre;
}

const ROUND_TYPES_TEST = { patate: "Ça va exploser !" };

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

/** Glisser la ligne [source] à la souris sur le haut (avant) ou le bas (après) de la ligne [cible] (cedric, 26/10). */
async function glisser(source, cible, bas) {
  // Les deux lignes à l'écran ensemble (à la main, la page défile d'elle-même quand on approche du bord).
  const page = source.page();
  const ecran = page.viewportSize();
  await page.setViewportSize({ width: ecran.width, height: 2400 });
  const { height } = await cible.boundingBox();
  await source.dragTo(cible, { targetPosition: { x: 40, y: bas ? height - 3 : 3 } });
  await page.setViewportSize(ecran);
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
    // Plus de « Tout valider » ni de case « Validée » (cedric, 26/10) : une question complète se joue d'office.
    assert.equal(await page.locator("#rv-validate-all, .q-valid").count(), 0);
    assert.equal(await page.locator("#rv-save").textContent(), "Enregistrer");
    await page.locator("#rv-summary", { hasText: "3 questions · 1 à corriger" }).waitFor();
    await page.locator('[data-q="1"] .problems', { hasText: "Bonne réponse absente" }).waitFor();
    // Enregistré tel quel : la question à corriger est dite, et ne se jouera pas.
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "Enregistré : 3 questions, dont 1 à corriger (elle ne se joue pas)." }).waitFor();
    assert.deepEqual(Object.values(await library("quizzes"))[0].questions.map((q) => q.status), ["validee", "brouillon", "validee"]);
    // Sarah coche la bonne réponse (B) : la question est bonne d'office.
    await page.locator('[data-q="1"] input[type=radio]').nth(1).check();
    await page.locator("#rv-summary").filter({ hasText: /^3 questions$/ }).waitFor();
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "Enregistré : 3 questions." }).waitFor();
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
    assert.equal(await page.locator("#jeu-choix .jeu-tuile").count(), 19);
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
    assert.equal(await page.locator("#jeu-choix .jeu-tuile").count(), 19);
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
    await ouvrirConducteur(regie);
    assert.equal(await regie.locator("#panel-plan .plan-round").count(), 1);
    await regie.locator("#panel-plan .plan-item", { hasText: "points ×2" }).waitFor({ state: "attached" });
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
    // 19 jeux (dont le Quiz illustré, le Pictionary, les Coffres mystères, le Gonfleur fou, Ça va exploser !, le Duel des robots et le Simon de Buzzy) : la Super Finale n'en est pas un, c'est la fin du quiz (réglage de la manche Quiz).
    const tile = (type) => page.locator(`#screen-home .tile[data-game="${type}"]`);
    assert.equal(await page.locator("#screen-home .tile[data-game]").count(), 19);
    await tile("illustre").waitFor();
    await tile("patate").waitFor();
    await tile("gonfleur").waitFor();
    await tile("pictionary").waitFor();
    await page.locator('#screen-home .tile[data-game="quiz"]', { hasText: "1 quiz · 2 questions validées" }).waitFor();
    assert.equal(await tile("finale").count(), 0);
    await openGamePage(page, "quiz");
    await page.locator("#game-rule", { hasText: "les dernières questions du quiz peuvent compter ×2, ×3, ×4 ou ×5" }).waitFor();
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
    // La première question seulement : la seconde retirée dans le « Quiz complet » (cedric, 23 et 25/10).
    const complet = page.locator("#show-rounds .round").nth(0).locator(".quiz-complet");
    // Ouvert d'office (cedric, 26/10).
    await complet.locator(".quiz-complet-liste li", { hasText: "Combien de pattes" }).locator("button.tirage-retirer").click();
    await complet.locator(".quiz-complet-voir", { hasText: "Quiz complet : 2 questions" }).waitFor();
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
    await ouvrirConducteur(regie);
    await regie.locator("#panel-plan .plan-item", { hasText: "Mimes : Animaux à mimer" }).waitFor({ state: "attached" });
    // En direct : « ＋ Jeu », toujours sur l'écran principal, ouvre le même « Ajouter un jeu » que le conducteur.
    assert.equal(await regie.locator("#c-add").isVisible(), true);
    // Sa carte (cedric, 30/10) : le 🎲 de la 1re équipe.
    await regie.click("#c-add");
    const cadre = await carteDuJeu(regie, "mimes");
    await cadre.locator(".mime-source").selectOption("emojis");
    await cadre.locator(".mime-par-equipe").selectOption("10");
    await cadre.locator(".mime-equipe").first().locator(".mime-equipe-tete .tirage-de").click();
    await cadre.locator(".mime-equipe").first().locator(".mime-nombre", { hasText: "10 images" }).waitFor();
    await regie.locator("#carte-envoyer:not([disabled])").click();
    await regie.locator("#r-toast", { hasText: "est ajouté au début du programme" }).waitFor();
    const plan = (await read("conducteur")).questions;
    assert.equal(plan.length, 5);
    assert.equal(plan[0].kind, "mime");
    assert.ok(plan[0].cards.length >= 10);
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
    await page.locator("#screen-playlist-edit .retour-barre.bas").getByRole("button", { name: "← Retour" }).click();
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
    // Cliquer une phrase (cedric, 26/10) : deux boutons dessous, « Début de la chanson ici » et « Hook ici », qui
    // placent leur curseur sur son minutage ; un nouveau clic sur la phrase les range.
    const suite = paroles.locator(".paroles-ligne", { hasText: "La suite du couplet" });
    await suite.click();
    assert.deepEqual(await suite.locator(".paroles-actions button").allTextContents(), ["⏮ Début de la chanson ici", "🎤 Hook ici"]);
    await suite.click();
    assert.equal(await paroles.locator(".paroles-actions").count(), 0);
    await suite.click();
    await suite.locator(".paroles-debut-ici").click();
    assert.equal(await reglage.locator('input[aria-label="Début de la chanson"]').inputValue(), "12");
    assert.equal(await reglage.locator('[data-curseur="debut"] .reglage-temps').textContent(), "0:12");
    assert.equal(await paroles.locator(".paroles-actions").count(), 0, "les boutons partent une fois choisi");
    const mains = paroles.locator(".paroles-ligne", { hasText: "Les mains en l'air" }).nth(1);
    await mains.click();
    await mains.locator(".paroles-hook-ici").click();
    assert.equal(await reglage.locator('input[aria-label="Hook"]').inputValue(), "42");
    assert.equal(await reglage.locator('[data-curseur="hook"] .reglage-temps').textContent(), "0:42");
    assert.equal(await reglage.locator(".reglage-origine").textContent(), "réglé à la main");
    assert.equal(await reglage.locator('input[aria-label="Début de la chanson"]').inputValue(), "12", "le début ne bouge pas");
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
    for (const k of ["tests", "miennes"]) await page.locator(`.q-groupe[data-groupe="${k}"] .q-plier`).click();
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
    assert.equal(disparu.cards.length, 4, "4 cartes à 7 ans (cedric, 27/10)");
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
    await ouvrirConducteur(regie);
    await regie.click("#plan-add");
    const cadre = await carteDuJeu(regie, "mimes");
    await cadre.locator(".mime-equipe").first().locator("button.tirage-de").first().click();
    await regie.locator("#carte-envoyer:not([disabled])").click();
    await regie.locator("#carte-info:not([hidden])", { hasText: "La TV doit être mise à jour pour jouer aux mimes" }).waitFor();
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
    await ouvrirConducteur(regie);
    await regie.click("#plan-add");
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/conducteur/quisuis`), null));
    await carteDuJeu(regie, "quisuis");
    await regie.locator("#carte-envoyer:not([disabled])").click();
    await regie.locator("#carte-info:not([hidden])", { hasText: "pour jouer à « Qui suis-je ? »" }).waitFor();
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
    assert.deepEqual(questions.slice(4, 8).map((q) => q.cards.slice(0, saved[1].equipes[0].length).map((c) => c.word)), saved[1].equipes.map((l) => l.map((c) => c.word)));
    // Mimes en file (cedric, 26/10) : chaque manche a sa couleur, et une réserve d'images mimables suit les siennes si
    // l'équipe les épuise, jamais une image déjà dans la fête.
    assert.deepEqual(questions.slice(4, 8).map((q) => q.couleur), ["#FF2D95", "#FF6B1A", "#39FF14", "#FFE600"]);
    const reserves = questions.slice(4, 8).map((q, i) => q.cards.slice(saved[1].equipes[i].length).map((c) => c.word.toLowerCase()));
    assert.ok(reserves.every((r) => r.length >= 20 && r.length <= MIME_RESERVE), "Quelques dizaines d'images de secours pour chaque équipe");
    const tous = [...saved[1].equipes.flat().map((c) => c.word.toLowerCase()), ...reserves.flat()];
    assert.equal(new Set(tous).size, tous.length, "Jamais deux fois la même image");
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

  test("à la volée (carte, 30/10) : mimes tirés au 🎲 pour l'équipe, une image retirée puis retirée au 🎲 avant l'envoi ; la TV reçoit ces images d'abord", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await ouvrirConducteur(regie);
    await regie.click("#plan-add");
    // Une ligne par équipe de la partie (1 équipe) ; 10 émojis ; un retiré, son 🎲 en tire un autre.
    const cadre = await carteDuJeu(regie, "mimes");
    assert.equal(await cadre.locator(".mime-equipe").count(), 1);
    const compteur = cadre.locator(".round-head > .quiz-compteur");
    await cadre.locator(".mime-source").selectOption("emojis");
    await cadre.locator(".mime-par-equipe").selectOption("10");
    await cadre.locator(".mime-equipe-tete .tirage-de").click();
    await compteur.filter({ hasText: "10 images" }).waitFor();
    if (!(await cadre.locator(".mime-images").count())) await cadre.locator(".mime-deplier").click();
    const retiree = await cadre.locator(".mime-image .mime-mot").first().textContent();
    await cadre.locator(".mime-image .tirage-retirer").first().click();
    await compteur.filter({ hasText: "1 à tirer" }).waitFor();
    await cadre.locator(".mime-image.vide .tirage-de").click();
    await compteur.filter({ hasText: /10 images$/ }).waitFor();
    const words = await cadre.locator(".mime-image .mime-mot").allTextContents();
    assert.equal(words.length, 10);
    assert.ok(!words.includes(retiree));
    await regie.locator("#carte-envoyer:not([disabled])").click();
    await regie.locator("#r-toast", { hasText: "est ajouté" }).waitFor();
    const mime = (await read("conducteur")).questions.find((q) => q.kind === "mime");
    assert.deepEqual(mime.cards.slice(0, 10).map((c) => c.word), words, "La TV reçoit exactement les images retouchées, puis celles de secours");
    await regie.context().close();
  });

  test("à la volée : le 🎲 du Blind test dans la bibliothèque des sons, sans playlist, jamais une chanson déjà au programme ni retirée", async () => {
    const hex = (k) => k.toString(16).padStart(16, "0");
    // Sans aucune chanson dans la bibliothèque : pas de blind test au hasard proposé.
    box = startBox();
    await addTeam("rose", "Les Roses");
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await ouvrirConducteur(regie);
    await regie.click("#plan-add");
    await carteDuJeu(regie, "blind");
    await regie.locator("#carte-envoyer:not([disabled])").click();
    await regie.locator("#carte-info:not([hidden])").waitFor();
    assert.equal((await read("conducteur")).questions.some((q) => q.kind === "blind"), false, "rien n'est envoyé");
    await regie.click("#carte-retour");
    await regie.click("#lib-close");

    // Les chansons de cedric sont dans la bibliothèque des sons, sans playlist (cedric, 27/10 en direct).
    const pochette = (k) => (0x100 + k).toString(16).padStart(16, "0");
    const chansons = Object.fromEntries(Array.from({ length: 13 }, (_, k) => [`s${k + 1}`, { title: `Chanson ${k + 1}`, audioId: hex(k + 1), imageId: pochette(k + 1), buzz: 30, updatedAt: 1, ...(k === 12 ? { retiree: true } : {}) }]));
    await seedLibrary("songs", chansons);
    const PNG = `data:image/png;base64,${png([20, 40, 200]).toString("base64")}`;
    await seedLibrary("images", Object.fromEntries(Array.from({ length: 13 }, (_, k) => [pochette(k + 1), PNG])));
    const conducteur = await read("conducteur");
    await set(gameRef("conducteur"), { ...conducteur, questions: [...conducteur.questions, { id: "b0", text: "Quel est ce titre ?", choices: ["Chanson 1"], correct: 0, kind: "blind", audioId: hex(1), round: "Blind test" }] });
    await regie.click("#plan-add");
    // La carte (cedric, 30/10) : 10 chansons d'office, le 🎲 les tire.
    const cadre = await carteDuJeu(regie, "blind");
    assert.equal(await cadre.locator(".blind-nombre").inputValue(), "10");
    await cadre.locator(".quiz-outils .tirage-de").first().click();
    await cadre.locator(".quiz-compteur", { hasText: "10 chansons à trouver" }).waitFor();
    await regie.locator("#carte-envoyer:not([disabled])").click();
    await regie.locator("#r-toast", { hasText: "est ajouté" }).waitFor();
    const blind = (await read("conducteur")).questions.filter((q) => q.kind === "blind" && q.id !== "b0");
    assert.ok(blind.every((q) => q.imageId), "les pochettes suivent");
    assert.equal(Object.keys((await read("images")) ?? {}).length >= 10, true, "pochettes copiées dans la partie");
    assert.equal(blind.length, 10);
    assert.equal(new Set(blind.map((q) => q.audioId)).size, 10, "10 chansons différentes");
    assert.ok(!blind.some((q) => q.audioId === hex(1)), "jamais une chanson déjà au programme");
    assert.ok(!blind.some((q) => q.audioId === hex(13)), "jamais une chanson retirée");
    await regie.context().close();
  });

  test("à la volée (carte, 30/10) : Statues musicales sans rien choisir, la musique de la fête ; Ça va exploser ! tel quel", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await ouvrirConducteur(regie);
    await regie.click("#plan-add");
    await carteDuJeu(regie, "statues");
    await regie.locator("#carte-envoyer:not([disabled])").click();
    const statues = await waitFor(async () => (await read("conducteur")).questions.find((q) => q.kind === "statues"), "Statues ajoutées");
    assert.equal(statues.round, "Statues musicales");
    await regie.click("#plan-add");
    await carteDuJeu(regie, "patate");
    await regie.locator("#carte-envoyer:not([disabled])").click();
    await regie.locator("#r-toast", { hasText: "« Ça va exploser ! » est ajouté" }).waitFor();
    const ordre = (await read("conducteur")).questions.map((q) => q.round);
    assert.ok(ordre.indexOf(ROUND_TYPES_TEST.patate) >= 0 && ordre.indexOf(ROUND_TYPES_TEST.patate) < ordre.indexOf("Statues musicales"), "juste après le jeu en cours, avant les Statues");
    await regie.context().close();
  });

  test("en direct (carte, 30/10) : Zoom mystère au 🎲 en photos de la banque et Qui a disparu ? en images réelles, photos copiées dans la partie", async () => {
    const { PHOTOS_BANQUE } = await import("../web/public/banque-photos.js");
    assert.ok(PHOTOS_BANQUE.size >= 5, "des photos de la banque sont sur le site");
    box = startBox();
    await addTeam("rose", "Les Roses");
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await ouvrirConducteur(regie);
    await regie.click("#plan-add");
    // Zoom mystère, sa carte (cedric, 30/10) : le 🎲 sans aucun quiz tire les photos de la banque, réponses en images.
    let cadre = await carteDuJeu(regie, "zoom");
    await cadre.locator("select.de-nombre-unique").selectOption("3");
    await cadre.locator(".de-unique").click();
    await cadre.locator(".round-head > .quiz-compteur", { hasText: "3 cartes à deviner" }).waitFor();
    await capture(regie, "regie-zoom-photos");
    await regie.locator("#carte-envoyer:not([disabled])").click();
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
    cadre = await carteDuJeu(regie, "disparu");
    await cadre.locator("select.disparu-images").selectOption("reelles");
    await cadre.locator(".de-unique").click();
    await cadre.locator(".round-head > .quiz-compteur", { hasText: "tour" }).waitFor();
    await capture(regie, "regie-disparu-photos");
    await regie.locator("#carte-envoyer:not([disabled])").click();
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
    // Le nombre de bombes (cedric, 26/10, test Mi Box) : de 1 à 6, 3 d'office.
    const bombes = bombe.locator("select.patate-bombes");
    assert.equal(await bombes.inputValue(), "3");
    assert.deepEqual((await bombes.locator("option").allTextContents()).map((t) => t.replace(/ \(.*\)$/, "")),
      ["Une bombe par partie", "Deux bombes par partie", "Trois bombes par partie", "Quatre bombes par partie", "Cinq bombes par partie", "Six bombes par partie"]);
    await bombes.selectOption("5");
    // L'alerte n'empêche pas d'enregistrer.
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "enregistrée" }).waitFor();
    const show = Object.values(await library("shows"))[0];
    assert.equal(show.teams, 1);
    assert.deepEqual(show.rounds[1], { type: "patate", bombs: 5 });
    await page.selectOption("#show-teams", "4");
    await bombe.locator(".alerte-equipes").waitFor({ state: "detached" });
    await page.context().close();
  });

  test("Régie PC (cedric, 27/10) : 🤠 Le Duel des robots, joueurs par équipe, face-à-face au moins / au plus, de temps en temps un long duel", async () => {
    const page = await admin();
    await page.locator('#home-games .tile[data-game=duel]', { hasText: "Rien à préparer" }).waitFor();
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    await page.selectOption("#show-teams", "1");
    await ajouterJeu(page, "duel");
    const round = page.locator("#show-rounds .round").nth(0);
    await round.locator(".alerte-equipes", { hasText: "« Le Duel des robots » se joue à 2 équipes au moins" }).waitFor();
    await page.selectOption("#show-teams", "3");
    await round.locator(".alerte-equipes").waitFor({ state: "detached" });
    // D'office : environ 4 joueurs par équipe, 20 à 40 s, de temps en temps un long duel.
    const [joueurs, min, max, longs] = ["select.duel-joueurs", "select.duel-min", "select.duel-max", "input.duel-longs"].map((s) => round.locator(s));
    assert.deepEqual([await joueurs.inputValue(), await min.inputValue(), await max.inputValue(), await longs.isChecked()], ["4", "20", "40", true]);
    assert.equal((await joueurs.locator("option").allTextContents()).length, 12);
    assert.deepEqual(await max.locator("option").allTextContents(), ["au plus 10 s", "au plus 15 s", "au plus 20 s", "au plus 30 s", "au plus 40 s", "au plus 50 s", "au plus 60 s"]);
    // Le minimum ne dépasse jamais le maximum ; à 60 s au plus, les longs duels n'ont plus d'effet.
    await joueurs.selectOption("6");
    await min.selectOption("50");
    await waitFor(async () => (await max.inputValue()) === "50", "le maximum suit");
    await max.selectOption("60");
    await waitFor(async () => longs.isDisabled(), "case grisée à 60 s");
    await max.selectOption("30");
    await waitFor(async () => (await min.inputValue()) === "30", "le minimum suit");
    await longs.uncheck();
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "nregistrée" }).waitFor();
    const show = Object.values(await library("shows"))[0];
    const { mancheId, ...duel } = show.rounds[0];
    assert.deepEqual(duel, { type: "duel", joueurs: 6, dureeMin: 30, dureeMax: 30, longs: false });
    await page.context().close();
  });

  test("Régie PC (cedric, 27/10) : 🔴 Le Simon de Buzzy, nombre de tours, secondes pour taper une suite, joueurs par équipe ; dès 1 équipe", async () => {
    const page = await admin();
    await page.locator('#home-games .tile[data-game=simon]', { hasText: "Rien à préparer" }).waitFor();
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "9");
    await page.selectOption("#show-teams", "1");
    await ajouterJeu(page, "simon");
    const round = page.locator("#show-rounds .round").nth(0);
    // D'office : 3 tours, 10 s, environ 4 joueurs ; une seule équipe suffit.
    const [tours, reponse, joueurs] = ["select.simon-tours", "select.simon-reponse", "select.simon-joueurs"].map((s) => round.locator(s));
    assert.deepEqual([await tours.inputValue(), await reponse.inputValue(), await joueurs.inputValue()], ["3", "10", "4"]);
    assert.equal(await round.locator(".alerte-equipes").count(), 0, "se joue dès 1 équipe");
    assert.deepEqual(await reponse.locator("option").allTextContents(), [5, 8, 10, 15, 20, 30].map((n) => `${n} s pour taper une suite`));
    assert.equal((await tours.locator("option").allTextContents()).length, 10);
    await tours.selectOption("5");
    await reponse.selectOption("15");
    await joueurs.selectOption("2");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "nregistrée" }).waitFor();
    const show = Object.values(await library("shows"))[0];
    const { mancheId, ...simon } = show.rounds[0];
    assert.deepEqual(simon, { type: "simon", tours: 5, reponse: 15, joueurs: 2 });
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

  test("en direct (carte, 30/10) : le 🎲 de Chante le mot ! ne reprend jamais un mot déjà au programme ; Pictionary aussi", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const conducteur = await read("conducteur");
    const deja = ["soleil", "maman"].map((w, k) => ({ id: `c${k}`, text: w, choices: [w], correct: 0, kind: "chante", round: "Chante le mot !" }));
    await set(gameRef("conducteur"), { ...conducteur, questions: [...conducteur.questions, ...deja] });
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await ouvrirConducteur(regie);
    await regie.click("#plan-add");
    const words = async () => (await read("conducteur")).questions.filter((q) => q.kind === "chante").map((q) => q.text.toLowerCase());
    // 20 mots au 🎲 : jamais soleil ni maman (déjà au programme).
    let cadre = await carteDuJeu(regie, "chante");
    await cadre.locator(".tirage-nombre").selectOption("20");
    await cadre.locator(".tirage-de").first().click();
    await cadre.locator(".round-head > .quiz-compteur", { hasText: "20 mots" }).waitFor();
    await regie.locator("#carte-envoyer:not([disabled])").click();
    await waitFor(async () => (await words()).length === 22, "20 mots ajoutés");
    const all = await words();
    assert.equal(new Set(all).size, 22, "Jamais deux fois le même mot pendant la fête");
    assert.equal(Object.keys((await library("manches")) ?? {}).length, 0, "rien n'est écrit dans la bibliothèque");
    // Pictionary : son 🎲 dans la carte, puis envoyé.
    await regie.click("#plan-add");
    cadre = await carteDuJeu(regie, "pictionary");
    await cadre.locator(".picto-de").click();
    await regie.locator("#carte-envoyer:not([disabled])").click();
    const picto = await waitFor(async () => (await read("conducteur")).questions.find((q) => q.kind === "pictionary"), "Pictionary ajouté");
    assert.ok(picto.cards.length > 0);
    assert.equal(new Set(picto.cards.map((c) => c.word)).size, picto.cards.length);
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
    // Plus de barre en haut des pages de modification (cedric, 25/10).
    assert.equal(await page.locator("#screen-mime-edit .retour-barre.haut").count(), 0);
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
    // « ← Retour », puis « Quitter » : la liste, et rien n'est enregistré.
    question = repondreFenetre(page);
    await page.locator("#screen-show-edit .retour-barre.bas .retour-page").click();
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
    await page.locator("#screen-show-edit .retour-barre.bas .retour-page").click();
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
    await page.locator("#screen-mime-edit .retour-barre.bas .retour-page").click();
    await page.locator("#screen-mimes:not([hidden])").waitFor();
    await page.locator("#mime-list .item", { hasText: "Animaux" }).getByRole("button", { name: "Dupliquer" }).click();
    await page.locator("#mime-list .item.copie-recente", { hasText: "Copie de Animaux" }).waitFor();
    assert.equal(await page.locator("#mime-list .item").first().locator("b").textContent(), "Copie de Animaux");
    assert.equal(await page.locator("#screen-mime-edit").isHidden(), true);
    assert.deepEqual(Object.values(await library("mimes")).map((d) => [d.title, d.cards.map((c) => c.word)]).sort(), [["Animaux", ["Chat"]], ["Copie de Animaux", ["Chat"]]]);
    await page.context().close();
  });

  test("Régie PC : l'accueil montre les 19 jeux par famille, chacun mène à ce qui se prépare", async () => {
    const page = await admin();
    assert.equal(await page.locator("#home-games .tile").count(), 19);
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
    assert.equal(await page.locator("#screen-show-edit button", { hasText: /^Enregistrer$/ }).count(), 1, "seulement dans la barre du bas (cedric, 25/10)");
    assert.equal(await page.locator("#screen-show-edit .retour-barre.haut").count(), 0, "plus de barre en haut (cedric, 25/10)");
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
    await page.locator("#rv-status", { hasText: "Enregistré : 3 questions." }).waitFor();
    const [id, quiz] = Object.entries(await library("quizzes"))[0];
    assert.equal(quiz.source, "photos");
    assert.ok(quiz.questions.every((q) => /^[0-9a-f]{16}$/.test(q.imageId) && q.status === "validee"));
    assert.deepEqual(quiz.questions.map((q) => q.choices[q.correct]), ["Tour eiffel", "Chat", "Lune"]);
    assert.equal(quiz.kind, "images");
    // Bibliothèque › Questions › « 🔍 Mes séries de photos » (cedric, 23/10) : elle y est, jamais dans ses questions en vrac.
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="questions"]');
    await page.locator('#q-groups [data-groupe="photos"]', { hasText: "🔍 Mes séries de photos (3)" }).click();
    // Rangée par thème (cedric, 25/10) : faite à la main sans thème, son nom en fait un.
    await page.locator('#q-list .q-theme[data-theme="Monuments et animaux"] .q-plier', { hasText: "🎨 Monuments et animaux (1)" }).click();
    await page.locator(`#q-list .pack[data-pack~="${id}"]`, { hasText: "3 photos" }).waitFor();
    await page.locator(`#q-list .pack[data-pack~="${id}"] .pack-niveau.sans`, { hasText: "Niveau à choisir dans « Éditer »" }).waitFor();
    assert.equal(await page.locator("#q-list .photos-nouvelle").textContent(), "📷 Nouvelle série de photos");
    await page.locator('#q-groups [data-groupe="miennes"]', { hasText: "(0)" }).waitFor();
    // Image floue (cedric, 25/10 : la carte du Quiz) : la série de photos faite à la main se pioche aux dés de « Mes packs ».
    await page.click("#nav button[data-screen=home]");
    await page.click("#home-new");
    await ajouterJeu(page, "flou");
    const round = page.locator("#show-rounds .round").nth(0);
    // Une seule ligne de 🎲 (cedric, 26/10) : le nom de la série tapé dans son champ.
    await round.locator(".de-unique-champ").fill("monu");
    await round.locator(".packs-suggestion", { hasText: "Monuments et animaux" }).click();
    await round.locator("select.de-nombre-unique").selectOption("3");
    await round.locator(".de-unique").click();
    await round.locator(".round-head > .quiz-compteur", { hasText: "3 cartes à deviner" }).waitFor();
    assert.equal(await round.locator(".quiz-complet-voir").textContent(), "▾ 🧩 Image floue complète : 3 photos, dans l'ordre de passage");
    await page.context().close();
  });

  test("Le Quiz (cedric, 26/10) : l'âge sur la ligne du numéro, une seule ligne de 🎲 (vide : au hasard partout ; « libre » ; « mes packs » ; un thème), le « Quiz complet » ouvert, une question retirée garde sa place", async () => {
    const pack = (title, niveau, n, theme = null) => ({ title, niveau, famille: "Divers", pack: true, kind: "classique", source: "json", updatedAt: 1, ...(theme ? { theme } : {}),
      questions: Array.from({ length: n }, (_, k) => ({ text: `${title} ${k + 1} ?`, choices: ["A", "B", "C", "D"], correct: k % 4, status: "validee" })) });
    // Les questions de Mario montrent une image de la bibliothèque à la révélation.
    const MARIO_IMG = "a1b2c3d4e5f60718";
    const mario16 = pack("Mario", "Facile", 16, "Jeux vidéo");
    mario16.questions.forEach((q) => { q.imageId = MARIO_IMG; });
    await seedLibrary("images", { [MARIO_IMG]: `data:image/png;base64,${png([200, 40, 40]).toString("base64")}` });
    await seedLibrary("quizzes", { kpop: pack("K-pop Demon Hunters", "Facile", 16), mario: mario16, poke: pack("Pokémon", "Difficile", 8) });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "6");
    await ajouterJeu(page, "quiz");
    const round = page.locator("#show-rounds .round").nth(0);
    // De haut en bas : l'âge au bout de la ligne du numéro ; la ligne de 🎲 ; « Rappeler le quiz d'un ancien anniversaire ».
    assert.deepEqual(await round.locator(".quiz-outils > *").evaluateAll((els) => els.map((e) => e.className)), ["de-ligne de-unique-ligne", "quiz-ajouts quiz-rappel fine"]);
    assert.equal(await round.locator(".round-head > select.quiz-age").inputValue(), "PETITS");
    assert.equal(await round.locator(".quiz-age-ligne, .quiz-total, .packs-ligne, .banque-ligne").count(), 0);
    assert.equal(await round.locator(".quiz-rappel-titre").textContent(), "📚 Rappeler le quiz d'un ancien anniversaire");
    const champ = round.locator(".de-unique-champ");
    assert.equal(await champ.getAttribute("placeholder"), "Tout au hasard… ou tapez un thème");
    const nombre = round.locator("select.de-nombre-unique");
    assert.equal(await nombre.inputValue(), "8");
    assert.deepEqual(await nombre.locator("option").evaluateAll((os) => os.map((o) => Number(o.value))), Array.from({ length: 15 }, (_, k) => k + 1));
    // La Super Finale tout en bas, les bougies au bout de sa ligne.
    assert.equal(await round.locator(".round-body > *:last-child").getAttribute("class"), "quiz-finale");
    await round.locator(".quiz-finale > .quiz-bougies", { hasText: "🎂 Bougies" }).waitFor();
    // Le champ propose ses sources ; on peut aussi taper librement.
    await champ.focus();
    const proposees = await round.locator(".de-unique-ligne .packs-suggestion b").allTextContents();
    assert.deepEqual(proposees.slice(0, 2), ["Questions libres de droit", "Mes packs"]);
    assert.ok(["K-pop Demon Hunters", "Jeux vidéo", "Pokémon"].every((t) => proposees.includes(t)), proposees.join(", "));
    await champ.fill("kpop");
    await round.locator(".de-unique-ligne .packs-suggestion", { hasText: "K-pop Demon Hunters" }).click();
    assert.equal(await champ.inputValue(), "K-pop Demon Hunters");
    await champ.fill("");
    await capture(page, "quiz-carte-vide", { pleinePage: false });
    const compteur = round.locator(".round-head > .quiz-compteur");
    const complet = round.locator(".quiz-complet");
    const lignes = complet.locator(".quiz-complet-liste > li");
    // Les questions, sans celle des bougies (Léa a 6 ans).
    const textes = () => complet.locator(".quiz-complet-liste .quiz-complet-q:not(.quiz-complet-bougies) .tirage-texte").allTextContents();
    const DES_PACKS = /^(K-pop|Mario|Pokémon)/;

    // 1. Champ vide, 6 questions, 6 ans : moitié mes packs (Facile), moitié libres de droit. Le « complet » s'ouvre seul.
    await nombre.selectOption("6");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: /^6 questions/ }).waitFor();
    assert.match(await complet.locator(".quiz-complet-voir").textContent(), /^▾ 🧩 Quiz complet : 7 questions/, "les bougies comprises");
    const un = await textes();
    assert.equal(un.filter((x) => DES_PACKS.test(x)).length, 3);
    assert.ok(un.filter((x) => DES_PACKS.test(x)).every((x) => /^(K-pop|Mario)/.test(x)), "l'âge de la carte d'abord");

    // 2. « libre » : les libres de droit seulement, à la suite.
    await champ.fill("libre");
    await nombre.selectOption("4");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: /^10 questions/ }).waitFor();
    assert.deepEqual((await textes()).slice(0, 6), un, "à la suite, rien ne bouge");
    const libres = (await textes()).slice(6);
    assert.equal(libres.filter((x) => DES_PACKS.test(x)).length, 0);

    // 3. « mes packs », 12-15 ans : le pack Difficile d'abord.
    await round.locator(".round-head > select.quiz-age").selectOption("GRANDS");
    await champ.fill("mes packs");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: /^14 questions/ }).waitFor();
    assert.ok((await textes()).slice(10).every((x) => x.startsWith("Pokémon")));

    // 4. Un thème (celui du pack compte) : seulement lui ; un mot introuvable : rien, et c'est dit.
    await champ.fill("jeux video");
    await nombre.selectOption("5");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: /^19 questions/ }).waitFor();
    const mario = (await textes()).slice(14);
    assert.ok(mario.length === 5 && mario.every((x) => x.startsWith("Mario")));
    assert.equal(new Set(await textes()).size, 19, "jamais deux fois la même");
    // Leur vraie miniature (cedric, 26/10 : pas un cadre 🖼).
    const lignesMario = complet.locator(".quiz-complet-q", { has: page.locator(".tirage-texte", { hasText: /^Mario/ }) });
    assert.ok((await lignesMario.count()) >= 5);
    await waitFor(async () => (await lignesMario.locator('img.tirage-mini[src^="data:image/png"]').count()) === await lignesMario.count(), "miniatures des questions de Mario");
    assert.equal(await lignesMario.locator(".tirage-mini.emoji").count(), 0);
    // Le thème du pack, juste à gauche de la photo (cedric, 26/10) ; rien pour les questions libres de droit.
    assert.deepEqual([...new Set(await lignesMario.locator(".quiz-complet-theme").allTextContents())], ["Jeux vidéo"]);
    assert.equal(await lignesMario.locator(".quiz-complet-theme").count(), await lignesMario.count());
    assert.ok(await lignesMario.first().locator(".quiz-complet-theme").evaluate((x) => x.nextElementSibling?.classList.contains("tirage-mini")), "à gauche de la miniature");
    const lignesPokemon = complet.locator(".quiz-complet-q", { has: page.locator(".tirage-texte", { hasText: /^Pokémon/ }) });
    assert.deepEqual([...new Set(await lignesPokemon.locator(".quiz-complet-theme").allTextContents())], ["Pokémon"], "sans thème : le nom du pack");
    const lignesLibres = complet.locator(".quiz-complet-q:not(.quiz-complet-bougies)", { hasNot: page.locator(".tirage-texte", { hasText: DES_PACKS }) });
    assert.ok((await lignesLibres.count()) >= 4);
    assert.equal(await lignesLibres.locator(".quiz-complet-theme").count(), 0);
    await champ.fill("zzz");
    await round.locator(".de-unique").click();
    await page.locator("#annonce", { hasText: "Aucune question libre ne se rapporte à « zzz »" }).waitFor();
    assert.equal((await textes()).length, 19);

    // ✕ : la place reste (son numéro), avec un petit 🎲 et un champ à gauche, une ✕ à droite ; la question ne revient jamais.
    const place = (await lignes.allTextContents()).findIndex((t) => t.includes(mario[0]));
    await lignes.nth(place).locator(".tirage-retirer").click();
    const caseVide = lignes.nth(place);
    await caseVide.locator(".quiz-case-de").waitFor();
    assert.equal(await caseVide.locator(".quiz-complet-num").textContent(), String(place + 1));
    assert.match(await compteur.textContent(), /^18 questions.* · 1 à tirer$/);
    assert.match(await complet.locator(".quiz-complet-voir").textContent(), /19 questions, dans l'ordre de passage \(1 à tirer\)$/);
    await capture(page, "quiz-carte-case", { pleinePage: false });
    // Son champ propose les mêmes sources que le grand 🎲 (cedric, 26/10 : « le champ semble inactif »).
    await caseVide.locator(".quiz-case-champ").fill("demon");
    await caseVide.locator(".packs-suggestion", { hasText: "K-pop Demon Hunters" }).waitFor();
    await caseVide.locator(".quiz-case-de").click();
    await lignes.nth(place).locator(".tirage-texte", { hasText: /^K-pop/ }).waitFor();
    assert.equal((await textes()).length, 19);
    assert.ok(!(await textes()).includes(mario[0]));
    // Une seconde ✕, sur la case vide : la place part pour de bon.
    const autre = (await lignes.allTextContents()).findIndex((t) => t.includes(libres[0]));
    await lignes.nth(autre).locator(".tirage-retirer").click();
    await lignes.nth(autre).locator(".quiz-case-retirer").click();
    await compteur.filter({ hasText: /^18 questions/ }).waitFor();
    assert.equal(await complet.locator(".quiz-case-vide").count(), 0);
    assert.equal((await textes()).length, 18);

    // Enregistrée : les libres de droit dans la série du dé, chaque clic dans mes packs sa série ; l'ordre du « complet ».
    const ordre = await textes();
    await aVenir(page);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    const [manche] = Object.values(await library("shows"))[0].rounds;
    assert.equal(manche.profil, "GRANDS");
    assert.deepEqual(manche.seriesQuiz.map((x) => [x.origine, x.pioche ? { ...x.pioche, profil: undefined } : null, x.questions.length]).map(([o, p, n]) => [o, p && JSON.parse(JSON.stringify(p)), n]), [
      ["de", null, 6],
      ["reprise", { mode: "hasard" }, 3],
      ["reprise", { mode: "hasard" }, 4],
      ["reprise", { mode: "recherche", terme: "jeux video" }, 5]]);
    // Rouverte : l'âge revient, l'ordre aussi.
    await page.click("#show-edit-crumb");
    await page.locator(".show-card", { hasText: "Léa" }).first().click();
    await deplierJeux(page);
    const rouverte = page.locator("#show-rounds .round").nth(0);
    assert.equal(await rouverte.locator("select.quiz-age").inputValue(), "GRANDS");
    assert.deepEqual(await rouverte.locator(".quiz-complet-liste .quiz-complet-q:not(.quiz-complet-bougies) .tirage-texte").allTextContents(), ordre);
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
    // Un quiz de la bibliothèque dans le Vrai ou Faux (crochet de test ; la ligne n'existe plus) : seulement ses Vrai / Faux.
    const manche = page.locator("#show-rounds .round").nth(0);
    await integrerQuiz(manche, "sciences", "scien");
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
    // 20 s par affirmation à tout âge (cedric, test du 27/10 : à peine le temps de lire).
    assert.deepEqual(questions.map((q) => [q.kind, q.duration, q.round]), [["express", 20, "Vrai ou Faux express"], ["express", 20, "Vrai ou Faux express"]]);
    // En direct, sa carte (cedric, 30/10) : le 🎲 ; TV d'avant le Vrai ou Faux express : la régie le dit, rien n'est envoyé.
    await ouvrirConducteur(regie);
    await regie.click("#plan-add");
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/conducteur/express`), null));
    const before = (await read("conducteur")).questions.length;
    const cadre = await carteDuJeu(regie, "express");
    await cadre.locator(".de-unique").click();
    await cadre.locator(".round-head > .quiz-compteur", { hasText: "affirmation" }).waitFor();
    await regie.locator("#carte-envoyer:not([disabled])").click();
    await regie.locator("#carte-info:not([hidden])", { hasText: "pour jouer au Vrai ou Faux express" }).waitFor();
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
    await ouvrirConducteur(regie);
    await regie.click("#plan-add");
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/conducteur/zoom`), null));
    const cadre = await carteDuJeu(regie, "zoom");
    await cadre.locator(".de-unique").click();
    await cadre.locator(".round-head > .quiz-compteur", { hasText: "à deviner" }).waitFor();
    await regie.locator("#carte-envoyer:not([disabled])").click();
    await regie.locator("#carte-info:not([hidden])", { hasText: "pour jouer au Zoom mystère" }).waitFor();
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
    // Le Quiz illustré a la carte du Quiz (cedric, 26/10) : une seule ligne de 🎲, le rappel ; pas de liste des séries.
    assert.deepEqual(await premiere.locator(".quiz-outils > *").evaluateAll((els) => els.map((e) => e.className)),
      ["de-ligne de-unique-ligne", "quiz-ajouts quiz-rappel fine"]);
    assert.equal(await premiere.locator(".quiz-series").count(), 0);
    // Le Quiz n'intègre plus de quiz de la bibliothèque (cedric, 25/10) : ses dés et « Rappeler un de vos quiz ».
    const seconde = page.locator("#show-rounds .round").nth(1);
    assert.equal(await seconde.locator(".quiz-biblio").count(), 0);
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
    // En direct (cedric, 30/10) : le Quiz illustré a sa ligne dans « ＋ Jeu », juste après le Quiz.
    await ouvrirConducteur(regie);
    await regie.click("#plan-add");
    await regie.locator('#lib-list .lib-jeu[data-jeu="illustre"]', { hasText: "Quiz illustré" }).waitFor();
    // « ✏️ Modifier » : le Quiz à venir se rouvre dans la carte du Quiz.
    await regie.click("#lib-close");
    await modifierJeu(regie, "Animaux");
    await regie.frameLocator("#carte-cadre").locator('#carte-jeu .jeu-bloc[data-jeu="quiz"]').waitFor();
    await regie.click("#carte-retour");
    await regie.context().close();
  });

  test("Régie PC (cedric, 26/10) : au Quiz illustré, un pack sans ses images n'est jamais tiré, et une question déjà là sans ses images est signalée en rouge", async () => {
    const PNG = `data:image/png;base64,${png([200, 120, 60]).toString("base64")}`;
    const ids = ["1111111111111111", "2222222222222222", "3333333333333333", "4444444444444444"];
    // Le pack Marvel importé sans ses images (kind « photo », aucune réponse en photo) ; un autre avec les siennes.
    const MARVEL = { title: "Marvel", kind: "photo", updatedAt: 1, pack: true, niveau: "Facile", questions: [
      { text: "Qui est l'archer des Avengers ?", choices: ["Œil de Faucon", "Thor", "Hulk", "Vision"], correct: 0, status: "validee" },
      { text: "Qui a un marteau ?", choices: ["Thor", "Hulk", "Vision", "Loki"], correct: 0, status: "validee", choiceImages: { 0: ids[0], 1: ids[1], 3: ids[3] } }] };
    const PETITS = { title: "Les animaux des petits", kind: "photo", updatedAt: 1, pack: true, niveau: "Facile", questions: [
      { text: "Où est le chat ?", choices: ["Chat", "Chien", "Vache", "Lion"], correct: 0, status: "validee", choiceImages: ids },
      { text: "Où est le lion ?", choices: ["Chat", "Chien", "Vache", "Lion"], correct: 3, status: "validee", choiceImages: ids }] };
    // La prestation de Lauren, composée avant : une question Marvel sans images et une avec, dans son Quiz illustré.
    const LAUREN = { childName: "Lauren", age: 6, date: "2099-12-02", status: "publiee", updatedAt: 1, rounds: [{ type: "illustre", seriesQuiz: [{ id: "pk1", origine: "reprise", questions: [
      { id: "pk-marvel:0", text: MARVEL.questions[0].text, choices: MARVEL.questions[0].choices, correct: 0 },
      { id: "pk-petits:0", text: PETITS.questions[0].text, choices: PETITS.questions[0].choices, correct: 0, choiceImages: ids }] }] }] };
    await seedLibrary("quizzes", { marvel: MARVEL, petits: PETITS });
    await seedLibrary("images", Object.fromEntries(ids.map((id) => [id, PNG])));
    await seedLibrary("shows", { lauren: LAUREN });
    const page = await admin();
    await page.click('#screen-home [data-etat="avenir"]');
    await page.locator('#show-list [data-show="lauren"]').getByRole("button", { name: "Ouvrir" }).click();
    await deplierJeux(page);
    const round = page.locator("#show-rounds .round").nth(0);
    const lignes = round.locator(".quiz-complet .quiz-complet-q");
    await lignes.nth(1).waitFor();
    assert.deepEqual(await lignes.evaluateAll((xs) => xs.map((x) => [x.querySelector(".tirage-texte")?.textContent, x.querySelector(".alerte-sans-images")?.textContent ?? null])),
      [["Qui est l'archer des Avengers ?", "⚠ Sans images"], ["Où est le chat ?", null]]);
    // 🎲 « mes packs » : seulement la question du pack qui a toutes ses images (ni Marvel, ni celle qui a perdu une photo).
    await round.locator(".de-unique-champ").fill("mes packs");
    await round.locator("select.de-nombre-unique").selectOption("4");
    await round.locator(".de-unique").click();
    await round.locator(".round-head > .quiz-compteur").filter({ hasText: /^3 questions/ }).waitFor();
    assert.deepEqual(await lignes.evaluateAll((xs) => xs.map((x) => x.querySelector(".tirage-texte")?.textContent)),
      ["Qui est l'archer des Avengers ?", "Où est le chat ?", "Où est le lion ?"]);
    assert.equal(await round.locator(".quiz-complet .alerte-sans-images").count(), 1);
    await page.context().close();
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
      title: "Les animaux des petits", kind: "photo", source: "banque", updatedAt: 1, pack: true, niveau: "Facile",
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
    const champ = round.locator(".de-unique-champ");
    const nombre = round.locator("select.de-nombre-unique");
    const compteur = round.locator(".round-head > .quiz-compteur");
    // La carte du Quiz (cedric, 26/10) : une seule manche, le compteur et l'âge sur la ligne du numéro ; une seule ligne
    // de 🎲 (mes packs, le Quiz illustré tout prêt par thème), le rappel ; la Super Finale. Ni bougies (elles vont dans le
    // Quiz) ni liste des séries (elles sont dans le « complet »).
    assert.equal(await page.locator('#show-rounds .jeu-bloc[data-jeu="illustre"] .jeu-plus').count(), 0);
    assert.deepEqual(await round.locator(".round-head > *").evaluateAll((xs) => xs.map((x) => x.className)), ["num", "quiz-compteur", "tirage-profil quiz-age quiz-en-tete"]);
    assert.deepEqual(await round.locator(".round-body > *").evaluateAll((xs) => xs.map((x) => x.className)), ["quiz-outils", "quiz-finale"]);
    assert.deepEqual(await round.locator(".quiz-outils > *").evaluateAll((els) => els.map((e) => e.className)),
      ["de-ligne de-unique-ligne", "quiz-ajouts quiz-rappel fine"]);
    assert.equal(await round.locator(".quiz-biblio, .quiz-series").count(), 0);
    // Le champ propose le tout prêt, mes packs (seulement les quiz illustrés : pas « animaux », un Quiz classique), les thèmes.
    await champ.focus();
    assert.deepEqual(await round.locator(".de-unique-ligne .packs-suggestion").evaluateAll((xs) => xs.slice(0, 2).map((x) => x.innerText.replace(/\s+/g, " "))),
      ["Questions libres de droit Quiz illustré tout prêt, tous les thèmes", "Mes packs 2 questions dans mes packs"]);
    assert.equal(await round.locator(".de-unique-ligne .packs-suggestion", { hasText: "Animaux" }).count() > 0, true);
    assert.equal(await round.locator("select.quiz-age").inputValue(), "PETITS");
    assert.equal(await round.locator(".quiz-rappel-titre").textContent(), "📚 Rappeler un de vos quiz illustrés");
    assert.equal(await compteur.textContent(), "Aucune question pour l'instant");
    assert.equal(await round.locator(".quiz-finale select.finale").inputValue(), "3");

    // Un ancien anniversaire : seulement ceux qui ont un Quiz illustré ; ses questions gardent leurs images.
    const rappel = round.locator(".quiz-rappel");
    await rappel.locator(".quiz-rappel-cherche").fill("tom");
    await rappel.locator(".quiz-rappel-liste", { hasText: "Aucune prestation archivée ne correspond." }).waitFor();
    await rappel.locator(".quiz-rappel-cherche").fill("luna");
    await rappel.locator('.quiz-rappel-item[data-show="luna"]').click();
    await compteur.filter({ hasText: /^2 questions/ }).waitFor();
    // 🎲 « mes packs », 2 questions : celles du pack illustré.
    await champ.fill("mes packs");
    await nombre.selectOption("2");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: /^4 questions/ }).waitFor();

    // « animaux » : 6 questions du thème Animaux du tout prêt (le pack « Les animaux des petits » est déjà là) ; jamais une
    // question déjà là ; l'âge ne bouge pas.
    await champ.fill("animaux");
    await nombre.selectOption("6");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: /^10 questions/ }).waitFor();
    assert.equal(await compteur.textContent(), "10 questions, dont 3 en Super Finale");
    assert.equal(await round.locator("select.quiz-age").inputValue(), "PETITS");
    const complet = round.locator(".quiz-complet");
    assert.equal(await complet.locator(".quiz-complet-voir").textContent(), "▾ 🧩 Quiz illustré complet : 10 questions, dans l'ordre de passage");
    const lignes = complet.locator(".quiz-complet-q");
    assert.equal(await lignes.count(), 10);
    const deja = new Set([...tireesLuna, ...PETITS.questions].map((q) => q.text));
    const textes = await lignes.locator(".tirage-texte").allTextContents();
    assert.equal(textes.filter((t) => !deja.has(t)).length, 6, "6 nouvelles questions tirées");
    // Chaque question montre ses 4 réponses en petites images, la bonne en vert.
    for (const li of await lignes.all()) {
      assert.equal(await li.locator(".tirage-rep").count(), 4);
      assert.equal(await li.locator(".tirage-rep.bonne").count(), 1);
    }
    // ✕ sur une question du tout prêt : sa place reste, avec son petit 🎲 et son champ (ici « animaux » encore).
    const k = textes.findIndex((t) => !deja.has(t));
    const retiree = textes[k];
    await lignes.nth(k).locator(".tirage-retirer").click();
    const vide = complet.locator("li.quiz-case-vide");
    await vide.waitFor();
    assert.equal(await vide.locator(".quiz-complet-num").textContent(), String(k + 1));
    assert.equal(await compteur.textContent(), "9 questions, dont 3 en Super Finale · 1 à tirer");
    assert.equal(await complet.locator(".quiz-complet-voir").textContent(), "▾ 🧩 Quiz illustré complet : 9 questions, dans l'ordre de passage (1 à tirer)");
    await vide.locator(".quiz-case-champ").fill("animaux");
    await vide.locator(".quiz-case-de").click();
    await vide.waitFor({ state: "detached" });
    assert.equal(await compteur.textContent(), "10 questions, dont 3 en Super Finale");
    assert.ok(!(await lignes.locator(".tirage-texte").allTextContents()).includes(retiree));

    // Un Quiz illustré ajouté juste après n'en crée pas un second : on revient à celui-ci.
    await ajouterJeu(page, "illustre");
    await page.locator("#annonce", { hasText: "Le Quiz illustré est déjà le dernier jeu" }).waitFor();
    assert.equal(await page.locator("#show-rounds .round").count(), 1);
    // Le « Quiz illustré complet » : tout, dans l'ordre de passage, chaque question avec ses images.
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
    assert.deepEqual(manche.seriesQuiz.map((x) => [x.origine, x.famille ?? null, x.questions?.length ?? x.quizId, x.pioche?.mode ?? null]),
      [["de", null, 6, null], ["reprise", null, 2, null], ["reprise", null, 2, "hasard"]]);
    assert.deepEqual(manche.seriesQuiz[2].questions.map((q) => q.text).sort(), PETITS.questions.map((q) => q.text).sort());
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
    // Dans l'ordre des clics (cedric, 25/10 : chaque 🎲 à la suite) : Luna, mon pack, puis le 🎲 du tout prêt.
    assert.deepEqual([...qs.slice(0, 2), ...qs.slice(4)].map((q) => q.choiceBanque?.length), Array(8).fill(4));
    assert.deepEqual(qs.slice(2, 4).map((q) => [...q.choiceImages].sort()), [ids, ids]);
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

  test("Régie PC (cedric, 23 et 25/10) : le Zoom mystère et l'Image floue ont la carte du Quiz : l'âge et les cartes à deviner, 🎲 dans mes séries de photos et dans les photos libres par thème, un ancien anniversaire, « Zoom mystère complet », jamais deux fois la même photo ; la TV reçoit les photos", async () => {
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
    const champ = round.locator(".de-unique-champ");
    const nombre = round.locator("select.de-nombre-unique");
    const compteur = round.locator(".round-head > .quiz-compteur");
    // La carte du Quiz (cedric, 26/10), avec des photos : le compteur de cartes à deviner et l'âge en tête, une seule
    // ligne de 🎲 (mes séries de photos, importées ou faites à la main ; les photos libres par thème), le rappel,
    // « ⭐ Composer avec vos images » ; ni Super Finale ni bougies ; plus de liste des séries.
    assert.deepEqual(await round.locator(".round-head > *").evaluateAll((xs) => xs.map((x) => x.className)), ["num", "quiz-compteur", "tirage-profil quiz-age quiz-en-tete"]);
    assert.deepEqual(await round.locator(".round-body > *").evaluateAll((xs) => xs.map((x) => x.className)), ["quiz-outils"]);
    assert.deepEqual(await round.locator(".quiz-outils > *").evaluateAll((els) => els.map((e) => e.className)),
      ["de-ligne de-unique-ligne", "quiz-ajouts quiz-rappel fine", "vos-images-bloc"]);
    assert.equal(await round.locator(".quiz-biblio, .quiz-series").count(), 0);
    assert.deepEqual(await nombre.locator("option").evaluateAll((os) => os.map((o) => o.textContent)).then((t) => [t[0], t.length]), ["1 carte", 15]);
    assert.equal(await nombre.inputValue(), "6");
    await champ.focus();
    assert.deepEqual(await round.locator(".de-unique-ligne .packs-suggestion").evaluateAll((xs) => xs.slice(0, 2).map((x) => x.innerText.replace(/\s+/g, " "))),
      ["Photos libres de droit Photos libres de droit, tous les thèmes", "Mes packs 2 cartes dans mes packs"]);
    assert.equal(await round.locator(".quiz-rappel-titre").textContent(), "📚 Rappeler les photos d'un ancien anniversaire");
    assert.equal(await compteur.textContent(), "Aucune carte pour l'instant");

    // Un ancien anniversaire : ses photos de l'Image floue reviennent au Zoom mystère.
    const rappel = round.locator(".quiz-rappel");
    await rappel.locator(".quiz-rappel-cherche").fill("tom");
    await rappel.locator(".quiz-rappel-liste", { hasText: "Aucune prestation archivée ne correspond." }).waitFor();
    await rappel.locator(".quiz-rappel-cherche").fill("luna");
    await rappel.locator('.quiz-rappel-item[data-show="luna"]', { hasText: "2 photos" }).click();
    await compteur.filter({ hasText: "2 cartes à deviner" }).waitFor();
    // « Disney », 2 cartes : ses deux photos (jamais un quiz classique).
    await champ.fill("Disney");
    await nombre.selectOption("2");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: "4 cartes à deviner" }).waitFor();

    // « animaux » : 6 photos libres d'animaux, jamais une photo déjà là.
    await champ.fill("animaux");
    await nombre.selectOption("6");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: "10 cartes à deviner" }).waitFor();
    assert.equal(await compteur.textContent(), "10 cartes à deviner");
    const complet = round.locator(".quiz-complet");
    assert.equal(await complet.locator(".quiz-complet-voir").textContent(), "▾ 🧩 Zoom mystère complet : 10 photos, dans l'ordre de passage");
    assert.equal(await complet.locator(".quiz-complet-q .tirage-photo").count(), 10);
    const libres = async (ou) => (await ou.locator(".quiz-complet-q img.tirage-photo").evaluateAll((xs) => xs.map((x) => x.getAttribute("src"))))
      .map((src) => src.match(/^banque\/(.+)\.jpg$/)).filter(Boolean).map((m) => decodeURIComponent(m[1])).filter((k) => k !== p1 && k !== p2);
    const zoom = await libres(complet);
    assert.equal(zoom.length, 6);
    for (const k of zoom) assert.ok(animaux.includes(k), k);
    // La ligne dit la réponse à trouver (pas « Qu'est-ce que c'est ? »), sans son émoji : la photo est à côté (cedric, 24/10).
    assert.ok((await complet.locator(".quiz-complet-q .tirage-texte").allTextContents()).every((t) => t && !/qu'est-ce/i.test(t) && /^\p{L}/u.test(t)));
    // ✕ sur une photo libre : sa place reste, avec son petit 🎲 et son champ ; il en tire une autre.
    const ligneDe = (k) => complet.locator(".quiz-complet-q").filter({ has: page.locator(`img.tirage-photo[src="${`banque/${encodeURIComponent(k)}.jpg`}"]`) });
    await ligneDe(zoom[0]).locator(".tirage-retirer").click();
    const vide = complet.locator("li.quiz-case-vide");
    await vide.waitFor();
    assert.equal(await compteur.textContent(), "9 cartes à deviner · 1 à tirer");
    await vide.locator(".quiz-case-champ").fill("animaux");
    await vide.locator(".quiz-case-de").click();
    await vide.waitFor({ state: "detached" });
    const zoom2 = await libres(complet);
    assert.ok(!zoom2.includes(zoom[0]), "la photo retirée ne revient pas");
    assert.equal(zoom2.length, 6);
    assert.equal(await compteur.textContent(), "10 cartes à deviner");

    // Un Zoom mystère ajouté juste après n'en crée pas un second.
    await ajouterJeu(page, "zoom");
    await page.locator("#annonce", { hasText: "Le Zoom mystère est déjà le dernier jeu : ajoutez-y vos photos" }).waitFor();
    assert.equal(await page.locator("#show-rounds .round").count(), 1);
    // ✕ sur Elsa (piochée dans mes séries) : sa place reste.
    await complet.locator(".quiz-complet-q", { hasText: "Elsa" }).locator(".tirage-retirer").click();
    await compteur.filter({ hasText: "9 cartes à deviner · 1 à tirer" }).waitFor();
    assert.equal(await vide.count(), 1);

    // Une Image floue dans la même fête : son 🎲 ne reprend aucune photo du Zoom mystère (jamais deux fois).
    await ajouterJeu(page, "flou");
    const flou = page.locator("#show-rounds .round").nth(1);
    await flou.locator(".de-unique-champ").fill("animaux");
    await flou.locator(".de-unique").click();
    await flou.locator(".round-head > .quiz-compteur", { hasText: "6 cartes à deviner" }).waitFor();
    const completFlou = flou.locator(".quiz-complet");
    assert.equal(await completFlou.locator(".quiz-complet-voir").textContent(), "▾ 🧩 Image floue complète : 6 photos, dans l'ordre de passage");
    const floues = await libres(completFlou);
    assert.equal(floues.length, 6);
    for (const k of floues) assert.ok(!zoom2.includes(k), `déjà au Zoom mystère : ${k}`);
    // ↑ ↓ dans le « complet » : l'ordre de passage.
    assert.equal(await completFlou.locator(".quiz-complet-q").first().locator(".quiz-complet-monter").isDisabled(), true);
    await completFlou.locator(".quiz-complet-q").first().locator(".quiz-complet-descendre").click();
    await waitFor(async () => (await libres(completFlou)).join() === [floues[1], floues[0], ...floues.slice(2)].join(), "la 1re photo passe en 2e");
    await capture(page, "zoom-flou-manche");
    if (process.env.CAPTURES) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await capture(page, "zoom-flou-manche-pc");
      await page.setViewportSize({ width: 390, height: 844 });
    }

    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const shows = await library("shows");
    assert.deepEqual([shows.luna, shows.tom], [LUNA, TOM], "Les prestations archivées ne changent pas");
    const zoe = Object.values(shows).find((x) => x.childName === "Zoé");
    assert.deepEqual(zoe.rounds.map((r) => r.type), ["zoom", "flou"]);
    const [manche] = zoe.rounds;
    assert.deepEqual(manche.seriesQuiz.map((x) => [x.origine, x.famille ?? null, x.questions?.length ?? x.quizId, x.pioche?.mode ?? null]),
      [["de", null, 6, null], ["reprise", null, 2, null], ["reprise", null, 1, "recherche"]]);
    assert.deepEqual(manche.seriesQuiz[2].questions.map((q) => q.imageId), [B]);
    assert.equal(manche.finale, undefined);
    assert.deepEqual(manche.seriesQuiz[0].questions.map((q) => q.banque).sort(), [...zoom2].sort());
    await page.context().close();

    // Sur la TV : un seul jeu « Zoom mystère » de 9 photos, sans Super Finale ; lancées par la régie, photos copiées.
    const { snapshot } = buildSnapshot("zoe", zoe, { disney: DISNEY });
    const qs = snapshot.quiz.questions.filter((q) => q.kind === "zoom");
    assert.equal(qs.length, 9);
    assert.deepEqual([...new Set(qs.map((q) => q.round))], ["Zoom mystère"]);
    assert.ok(!qs.some((q) => q.finale));
    assert.deepEqual(qs.map((q) => q.imageId ?? `b:${q.banque}`).sort(), [...zoom2.map((k) => `b:${k}`), `b:${p1}`, `b:${p2}`, B].sort());
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
    const tuile = (zone, id) => zone.locator(`.vos-images-tuile[data-image="${id}"]`);
    const tuiles = (zone) => zone.locator(".vos-images-tuile").evaluateAll((xs) => xs.map((x) => x.dataset.image));
    // « 🖼 Ajouter une image » (cedric, 26/10) : une recherche en direct dans toute la bibliothèque ; rien avant la
    // première lettre.
    assert.equal(await round.locator(".vos-images-titre").textContent(), "🖼 Ajouter une image");
    assert.equal(await round.locator(".vos-images-tuile").count(), 0);
    const cherche = round.locator(".vos-images-cherche");
    // Ses images d'abord, puis les photos libres ; jamais d'émoji (que des photos).
    await cherche.fill("i");
    await round.locator(".vos-images-tuile").first().waitFor();
    const trouvees = await tuiles(round);
    assert.equal(trouvees.length, 24);
    assert.ok(trouvees.every((id) => MES.includes(id) || id === SANS_NOM || id.startsWith("banque:")));
    await round.locator(".vos-images-grille > p.hint", { hasText: /^Et \d+ autres images : précisez la recherche\.$/ }).waitFor();
    // Sans nom : pas de réponse à trouver, elle ne se prend pas.
    await cherche.fill("animaux");
    assert.equal(await tuile(round, SANS_NOM).isDisabled(), true);
    assert.equal(await tuile(round, SANS_NOM).locator(".vos-images-etat").textContent(), "À nommer dans Mes images");
    // « tigre » trouve d'abord les noms qui commencent par « Tigre » (la sienne, puis la photo libre), puis celui qui le
    // contient. Un clic ajoute CETTE image à la fin du « complet » ; la recherche reste, l'image est marquée.
    await cherche.fill("tigre");
    await waitFor(async () => (await round.locator(".vos-images-tuile").count()) === 3, "trois tigres");
    assert.deepEqual(await tuiles(round), [MES[1], "banque:tigre", MES[4]]);
    assert.deepEqual(await round.locator(".vos-images-tuile > span").allTextContents(), ["Tigre", "Tigre", "Petit tigre"]);
    assert.equal(await tuile(round, "banque:tigre").locator("img").getAttribute("src"), "banque/tigre.jpg");
    await tuile(round, MES[1]).click();
    await compteur.filter({ hasText: "1 carte à deviner" }).waitFor();
    assert.equal(await cherche.inputValue(), "tigre");
    assert.equal(await tuile(round, MES[1]).isDisabled(), true);
    assert.equal(await tuile(round, MES[1]).locator(".vos-images-etat").textContent(), "✓ Déjà dans le jeu");
    await cherche.fill("famille");
    await tuile(round, MES[3]).click();
    await compteur.filter({ hasText: "2 cartes à deviner" }).waitFor();
    await cherche.fill("panda");
    await tuile(round, PANDA).click();
    await compteur.filter({ hasText: "3 cartes à deviner" }).waitFor();
    await cherche.fill("lion");
    await tuile(round, MES[0]).click();
    await compteur.filter({ hasText: "4 cartes à deviner" }).waitFor();
    await capture(page, "zoom-vos-images-choix");
    // Dans le « Zoom mystère complet » : dans l'ordre des clics, la réponse sans émoji, la photo à côté.
    const complet = round.locator(".quiz-complet");
    const lignesCompletes = complet.locator(".quiz-complet-q");
    assert.deepEqual(await lignesCompletes.locator(".tirage-texte").allTextContents(), ["Tigre", "Mamie Jo", "Panda", "Lion"]);
    assert.equal(await lignesCompletes.locator("img.tirage-photo").count(), 4);

    // Le 🎲 des photos libres dans le même jeu : jamais une photo déjà choisie ; ses photos à la suite (cedric, 25/10).
    await round.locator(".de-unique-champ").fill("libre");
    await round.locator(".de-nombre-unique").selectOption("6");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: "10 cartes à deviner" }).waitFor();
    const tirees = (await lignesCompletes.locator("img.tirage-photo").evaluateAll((xs) => xs.slice(4, 10).map((x) => x.getAttribute("src"))))
      .map((src) => decodeURIComponent(src.match(/^banque\/(.+)\.jpg$/)[1]));
    assert.equal(tirees.length, 6);
    assert.ok(!tirees.includes("panda"), "le 🎲 ne reprend pas une photo de la composition");
    const [cle] = tirees;
    const nomTiree = (await lignesCompletes.locator(".tirage-texte").nth(4).textContent()).trim();

    // Celles déjà ajoutées ne se reprennent pas ; celle du 🎲 est en rouge, mais possible. Ajoutée après le 🎲, elle
    // passe à la fin du « complet ».
    await cherche.fill("lion");
    assert.equal(await tuile(round, MES[0]).isDisabled(), true);
    assert.equal(await tuile(round, MES[0]).locator(".vos-images-etat.alerte").count(), 0);
    await cherche.fill("panda");
    assert.equal(await tuile(round, PANDA).isDisabled(), true);
    await cherche.fill(nomTiree);
    await tuile(round, `banque:${cle}`).waitFor();
    assert.equal(await tuile(round, `banque:${cle}`).isDisabled(), false);
    assert.equal(await tuile(round, `banque:${cle}`).locator(".vos-images-etat.alerte").textContent(), "Déjà utilisée dans ce jeu");
    await cherche.fill("ours");
    await tuile(round, MES[2]).click();
    await compteur.filter({ hasText: "11 cartes à deviner" }).waitFor();
    assert.equal(await lignesCompletes.locator(".tirage-texte").last().textContent(), "Ours");

    // Une Image floue dans la même fête : ses images et photos libres déjà au Zoom mystère sont en rouge, mais restent possibles.
    await ajouterJeu(page, "flou");
    const flou = page.locator("#show-rounds .round").nth(1);
    await flou.locator(".vos-images-cherche").fill("lion");
    assert.equal(await tuile(flou, MES[0]).isDisabled(), false);
    assert.equal(await tuile(flou, MES[0]).locator(".vos-images-etat.alerte").textContent(), "Déjà utilisée dans la fête");
    await flou.locator(".vos-images-cherche").fill("petit");
    assert.equal(await tuile(flou, MES[4]).locator(".vos-images-etat").count(), 0);
    await tuile(flou, MES[4]).click();
    await flou.locator(".round-head > .quiz-compteur", { hasText: "1 carte à deviner" }).waitFor();
    await flou.locator(".vos-images-cherche").fill("panda");
    assert.equal(await tuile(flou, PANDA).isDisabled(), false);
    assert.equal(await tuile(flou, PANDA).locator(".vos-images-etat.alerte").textContent(), "Déjà utilisée dans la fête");
    await tuile(flou, PANDA).click();
    await flou.locator(".round-head > .quiz-compteur", { hasText: "2 cartes à deviner" }).waitFor();
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

  test("Régie PC (cedric, 26/10) : au Zoom mystère, ✎ renomme une photo dans son « complet » : la réponse du jeu, sa fiche et ses packs dans la bibliothèque ; Échap annule ; une photo libre ne change que dans le jeu", async () => {
    const PNG = `data:image/png;base64,${png([200, 120, 40]).toString("base64")}`;
    const LION = "a7a7a7a7a7a7a7a7";
    await seedLibrary("images", { [LION]: PNG });
    await seedLibrary("medias", { [LION]: { name: "Lion", cat: "Animaux", createdAt: 1, updatedAt: 1 } });
    // Un pack de photos qui montre la même image sous un nom qui ne colle pas.
    await seedLibrary("quizzes", { savane: { title: "Savane", pack: true, kind: "classique", source: "json", updatedAt: 1, theme: "Savane",
      questions: [{ text: "Qui est-ce ?", choices: ["Lion", "Simba", "Tigre", "Ours"], correct: 0, imageId: LION, status: "validee" }] } });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await ajouterJeu(page, "zoom");
    const round = page.locator("#show-rounds .round").nth(0);
    await round.locator(".vos-images-cherche").fill("lion");
    await round.locator(`.vos-images-tuile[data-image="${LION}"]`).click();
    await round.locator(".vos-images-cherche").fill("panda");
    await round.locator('.vos-images-tuile[data-image="banque:panda"]').click();
    const complet = round.locator(".quiz-complet");
    const noms = () => complet.locator(".quiz-complet-q .tirage-texte").allTextContents();
    await waitFor(async () => (await noms()).join() === "Lion,Panda", "deux photos");
    // Échap : rien ne change.
    await complet.locator(".quiz-complet-q").first().locator(".photo-renommer").click();
    await complet.locator(".photo-nom").fill("Mufasa");
    await complet.locator(".photo-nom").press("Escape");
    await waitFor(async () => (await noms()).join() === "Lion,Panda", "annulé");
    // ✎ puis Entrée : la réponse du jeu, et dans la bibliothèque sa fiche et la bonne réponse du pack (le « Simba » qui
    // s'écrivait déjà ainsi prend l'ancien nom).
    await complet.locator(".quiz-complet-q").first().locator(".photo-renommer").click();
    await complet.locator(".photo-nom").fill("Simba");
    await complet.locator(".photo-nom").press("Enter");
    await waitFor(async () => (await noms()).join() === "Simba,Panda", "renommée dans le jeu");
    await waitFor(async () => (await library(`medias/${LION}`))?.name === "Simba", "fiche renommée");
    await waitFor(async () => (await library("quizzes/savane/questions/0/choices"))?.[0] === "Simba", "pack renommé");
    assert.deepEqual(await library("quizzes/savane/questions/0/choices"), ["Simba", "Lion", "Tigre", "Ours"]);
    // Une photo libre : seulement dans ce jeu.
    await complet.locator(".quiz-complet-q").nth(1).locator(".photo-renommer").click();
    await complet.locator(".photo-nom").fill("Panda géant");
    await complet.locator(".photo-nom").press("Enter");
    await waitFor(async () => (await noms()).join() === "Simba,Panda géant", "photo libre renommée");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const zoe = Object.values(await library("shows")).find((x) => x.childName === "Zoé");
    const qs = zoe.rounds[0].seriesQuiz.flatMap((x) => x.questions ?? []).filter((q) => q && !q.vide);
    assert.deepEqual(qs.map((q) => q.choices[q.correct]), ["Simba", "Panda géant"]);
    assert.equal(new Set(qs[0].choices).size, qs[0].choices.length, "jamais deux propositions pareilles");
    await page.context().close();
  });

  test("Régie PC (cedric, 28/10) : dans le « Zoom mystère complet », la miniature a la forme de la TV (4:3) ; un clic la recadre pour cette prestation seulement (le pack reste tel quel) ; Annuler ne change rien", async () => {
    const PNG = `data:image/png;base64,${png([200, 120, 40]).toString("base64")}`;
    const LION = "a8a8a8a8a8a8a8a8";
    await seedLibrary("images", { [LION]: PNG });
    await seedLibrary("medias", { [LION]: { name: "Lion", cat: "Animaux", createdAt: 1, updatedAt: 1 } });
    await seedLibrary("quizzes", { savane2: { title: "Savane", pack: true, kind: "classique", source: "json", updatedAt: 1, theme: "Savane",
      questions: [{ text: "Qui est-ce ?", choices: ["Lion", "Tigre", "Ours", "Loup"], correct: 0, imageId: LION, status: "validee" }] } });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Nina");
    await ajouterJeu(page, "zoom");
    const round = page.locator("#show-rounds .round").nth(0);
    await round.locator(".vos-images-cherche").fill("lion");
    await round.locator(`.vos-images-tuile[data-image="${LION}"]`).click();
    const mini = round.locator(".quiz-complet .quiz-complet-q .tirage-photo.recadrable");
    await mini.waitFor();
    const taille = await mini.evaluate((el) => [el.getBoundingClientRect().width, el.getBoundingClientRect().height]);
    assert.ok(Math.abs(taille[0] / taille[1] - 4 / 3) < 0.05, `forme 4:3 comme sur la TV (${taille})`);
    // Annuler : rien ne change.
    await mini.click();
    await page.locator(".cadre-boite").waitFor();
    await page.locator(".cadre-boite button", { hasText: "Annuler" }).click();
    await page.locator(".cadre-boite").waitFor({ state: "detached" });
    // Zoom puis Valider : une nouvelle image, pour cette prestation.
    await mini.click();
    await page.locator(".cadre-zoom").fill("2.5");
    await page.locator(".cadre-boite button", { hasText: "Valider le cadrage" }).click();
    await page.locator(".cadre-boite").waitFor({ state: "detached" });
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const nina = Object.values(await library("shows")).find((x) => x.childName === "Nina");
    const qs = nina.rounds[0].seriesQuiz.flatMap((x) => x.questions ?? []).filter((q) => q && !q.vide);
    assert.equal(qs.length, 1);
    assert.match(qs[0].imageId, /^[0-9a-f]{16}$/);
    assert.notEqual(qs[0].imageId, LION, "la photo recadrée");
    assert.equal(qs[0].choices[qs[0].correct], "Lion");
    assert.equal(typeof (await library(`images/${qs[0].imageId}`)), "string", "rangée dans la bibliothèque");
    assert.equal(await library("quizzes/savane2/questions/0/imageId"), LION, "le pack reste tel quel");
    await page.context().close();
  });

  test("Régie PC (cedric, 29/10) : le cadrage d'une photo est gardé pour ce jeu et cette forme : la même photo dans le Zoom mystère d'une autre prestation le reprend tout seul ; l'Image floue garde l'image d'origine ; l'image d'origine n'est jamais modifiée", async () => {
    const PNG = `data:image/png;base64,${png([30, 120, 200]).toString("base64")}`;
    const OURS = "a9a9a9a9a9a9a9a9";
    await seedLibrary("images", { [OURS]: PNG });
    await seedLibrary("medias", { [OURS]: { name: "Ours", cat: "Animaux", createdAt: 1, updatedAt: 1 } });
    const page = await admin();
    const prendreOurs = async (jeu, k) => {
      await ajouterJeu(page, jeu);
      const round = page.locator("#show-rounds .round").nth(k);
      await round.locator(".vos-images-cherche").fill("ours");
      await round.locator(`.vos-images-tuile[data-image="${OURS}"]`).click();
      return round;
    };
    const enregistrer = async (prenom) => {
      await page.click("#show-save");
      await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
      return Object.values(await library("shows")).find((x) => x.childName === prenom);
    };
    const photos = (show, k) => show.rounds[k].seriesQuiz.flatMap((x) => x.questions ?? []).filter((q) => q && !q.vide).map((q) => q.imageId);
    // Première prestation : la photo recadrée au Zoom mystère.
    await page.click("#home-new");
    await page.fill("#show-child", "Paul");
    const zoom = await prendreOurs("zoom", 0);
    await zoom.locator(".quiz-complet .tirage-photo.recadrable").click();
    await page.locator(".cadre-zoom").fill("3");
    await page.locator(".cadre-boite button", { hasText: "Valider le cadrage" }).click();
    await page.locator(".cadre-boite").waitFor({ state: "detached" });
    const paul = await enregistrer("Paul");
    const [recadree] = photos(paul, 0);
    assert.notEqual(recadree, OURS);
    await waitFor(async () => (await library(`cadrages/zoom~revelation~${OURS}`))?.crop === recadree, "cadrage gardé");
    // Une autre prestation : au Zoom mystère, la même photo arrive déjà recadrée ; à l'Image floue, telle quelle.
    await page.click('#nav [data-screen="home"]');
    await page.click("#home-new");
    await page.fill("#show-child", "Lina");
    await prendreOurs("zoom", 0);
    await prendreOurs("flou", 1);
    const lina = await enregistrer("Lina");
    assert.deepEqual(photos(lina, 0), [recadree], "le Zoom mystère reprend le cadrage");
    assert.deepEqual(photos(lina, 1), [OURS], "l'Image floue garde l'image d'origine");
    assert.equal(await library(`images/${OURS}`), PNG, "l'image d'origine n'est jamais modifiée");
    await page.context().close();
  });

  test("Régie PC (cedric, 29/10) : Mimes, Pictionary et Qui suis-je ? : un clic sur la petite image la recadre (forme de la TV) ; le cadrage est gardé et une autre prestation le reprend ; les images d'origine ne changent pas", async () => {
    const PNG = `data:image/png;base64,${png([220, 60, 160]).toString("base64")}`;
    const [LION, CHAT, MARIO] = ["c1c1c1c1c1c1c1c1", "c2c2c2c2c2c2c2c2", "c3c3c3c3c3c3c3c3"];
    await seedLibrary("images", { [LION]: PNG, [CHAT]: PNG, [MARIO]: PNG });
    const jeux = () => [
      { type: "mimes", perTeam: 1, equipes: [[{ word: "Lion", image: "🦁", imageId: LION }]] },
      { type: "pictionary", passages: 1, tours: [[[{ word: "Chat", image: "🐱", imageId: CHAT }]]] },
      { type: "quisuis", seriesMots: [{ id: "m1", origine: "main", mots: [{ answer: "Mario", emoji: "🍄", clues: ["Plombier", "Moustache"], imageId: MARIO }] }] },
    ];
    await seedLibrary("shows/ines", { childName: "Inès", title: "Anniversaire d'Inès", age: 9, teams: 2, date: "2099-12-04", status: "publiee", updatedAt: 1, rounds: jeux() });
    await seedLibrary("shows/theo", { childName: "Théo", title: "Anniversaire de Théo", age: 9, teams: 2, date: "2099-12-05", status: "publiee", updatedAt: 1, rounds: jeux() });
    const page = await admin();
    const ouvrir = async (id) => {
      await page.click('#nav button[data-screen=home]');
      await page.click('#screen-home [data-etat="avenir"]');
      await page.locator(`#show-list [data-show="${id}"]`).getByRole("button", { name: "Ouvrir" }).click();
      await deplierJeux(page);
    };
    const recadrer = async (img, forme) => {
      await img.click();
      await page.locator(".cadre-boite", { hasText: forme }).waitFor();
      await page.locator(".cadre-zoom").fill("2");
      await page.locator(".cadre-boite button", { hasText: "Valider le cadrage" }).click();
      await page.locator(".cadre-boite").waitFor({ state: "detached" });
    };
    await ouvrir("ines");
    const blocs = page.locator("#show-rounds .round");
    await blocs.nth(0).locator(".mime-deplier").first().click();
    await recadrer(blocs.nth(0).locator(".mime-image img.recadrable"), "Cadrer l'image à mimer");
    await blocs.nth(1).locator(".mime-deplier").first().click();
    await recadrer(blocs.nth(1).locator(".picto-mot img.recadrable"), "Cadrer la vignette");
    const perso = blocs.nth(2).locator(".quiz-complet-q img.tirage-mini.recadrable").first();
    // L'écran se redessine quand un cadrage est gardé : on mesure l'image affichée.
    let taille;
    await waitFor(async () => (taille = await perso.evaluate((el) => [el.getBoundingClientRect().width, el.getBoundingClientRect().height, getComputedStyle(el).borderRadius]))[0] > 0, "personnage affiché");
    assert.ok(Math.abs(taille[0] - taille[1]) < 1 && taille[2] === "50%", `rond comme sur la TV (${taille})`);
    await recadrer(perso, "Cadrer le personnage dans son rond");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const ines = await library("shows/ines");
    const images = (x) => [x.rounds[0].equipes[0][0].imageId, x.rounds[1].tours[0][0][0].imageId, x.rounds[2].seriesMots[0].mots[0].imageId];
    const recadrees = images(ines);
    recadrees.forEach((id, k) => { assert.match(id, /^[0-9a-f]{16}$/); assert.notEqual(id, [LION, CHAT, MARIO][k]); });
    assert.equal(ines.rounds[0].equipes[0][0].image, "🦁", "l'émoji reste");
    await waitFor(async () => (await library(`cadrages/mimes~mime~${LION}`))?.crop === recadrees[0], "cadrage des mimes gardé");
    assert.equal((await library(`cadrages/pictionary~vignette~${CHAT}`))?.crop, recadrees[1]);
    assert.equal((await library(`cadrages/quisuis~rond~${MARIO}`))?.crop, recadrees[2]);
    // Une autre prestation avec les mêmes images : elles arrivent recadrées.
    await ouvrir("theo");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    assert.deepEqual(images(await library("shows/theo")), recadrees);
    for (const id of [LION, CHAT, MARIO]) assert.equal(await library(`images/${id}`), PNG);
    await page.context().close();
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
    // Glissé à la souris (cedric, 26/10) : le dernier posé en tête, puis remis en bas.
    await glisser(complet.locator(".quiz-complet-q").last(), complet.locator(".quiz-complet-q").first(), false);
    await waitFor(async () => (await ordre()).join() === ["Arc-en-ciel", tires2[1], tires2[0], ...tires2.slice(2)].join(), "glissé en tête");
    await glisser(complet.locator(".quiz-complet-q").first(), complet.locator(".quiz-complet-q").last(), true);
    await waitFor(async () => (await ordre()).join() === [tires2[1], tires2[0], ...tires2.slice(2), "Arc-en-ciel"].join(), "glissé en bas");
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

  test("Régie PC (cedric, 24 et 25/10) : Qui suis-je ? a la carte du Quiz : l'âge et le total, 🎲 dans mes packs et dans les personnages du jeu, un ancien anniversaire, chacun avec sa petite image ; « Qui suis-je ? complet » (↑ ↓ ✕ 🔀)", async () => {
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
    const champ = round.locator(".de-unique-champ");
    const nombre = round.locator("select.de-nombre-unique");
    assert.equal(await compteur.textContent(), "Aucun personnage pour l'instant : la TV en tirera 5 au hasard");
    // La carte du Quiz (cedric, 26/10) : le compteur et l'âge en tête, une seule ligne de 🎲 (mes packs : les personnages
    // de mes séries ; les personnages du jeu), le rappel ; ni « Intégrer une de vos séries » ni liste des séries.
    assert.deepEqual(await round.locator(".round-head > *").evaluateAll((xs) => xs.map((x) => x.className)), ["num", "quiz-compteur", "tirage-profil quiz-age quiz-en-tete"]);
    assert.deepEqual(await round.locator(".quiz-outils > *").evaluateAll((xs) => xs.map((x) => x.className)),
      ["de-ligne de-unique-ligne", "quiz-ajouts quiz-rappel fine"]);
    assert.equal(await round.locator(".quiz-biblio, .quiz-series").count(), 0);
    assert.equal(await nombre.inputValue(), "5");
    assert.deepEqual(await nombre.locator("option").evaluateAll((os) => os.map((o) => Number(o.value))), Array.from({ length: 15 }, (_, k) => k + 1));
    await champ.focus();
    assert.deepEqual(await round.locator(".de-unique-ligne .packs-suggestion").evaluateAll((xs) => xs.slice(0, 2).map((x) => x.innerText.replace(/\s+/g, " "))),
      ["Personnages libres de droit Les personnages de Qui suis-je ?, à l'âge choisi", "Mes packs 2 personnages dans mes packs"]);
    assert.equal(await round.locator(".quiz-rappel-titre").textContent(), "📚 Rappeler les personnages d'un ancien anniversaire");

    // Un ancien anniversaire : tous ses personnages, en une série.
    await round.locator(".quiz-rappel-cherche").fill("mal");
    await round.locator('.quiz-rappel-item[data-show="malo"]').click();
    await compteur.filter({ hasText: "2 personnages" }).waitFor();
    // « Disney » : mes packs sur ce mot, 2 personnages ; un nouveau clic n'en trouve plus d'autre (jamais deux fois).
    await champ.fill("Disney");
    await nombre.selectOption("2");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: "4 personnages" }).waitFor();
    await round.locator(".de-unique").click();
    await page.locator("#annonce", { hasText: "Aucun personnage libre ne se rapporte à « Disney » : essayez un autre mot, ou videz le champ." }).waitFor();
    assert.equal(await compteur.textContent(), "4 personnages");

    // « libre » : 3 personnages du jeu, aucun de ceux déjà là ni de mes séries ; jamais une image téléversée.
    await champ.fill("libre");
    await nombre.selectOption("3");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: "7 personnages" }).waitFor();

    // « Qui suis-je ? complet », ouvert d'office : dans l'ordre des clics, chaque 🎲 à la suite (cedric, 25/10) ; la
    // petite image, les indices ; ✕, ↓ et 🔀.
    const complet = round.locator(".quiz-complet");
    assert.equal(await complet.locator(".quiz-complet-voir").textContent(), "▾ 🧩 Qui suis-je ? complet : 7 personnages, dans l'ordre de passage");
    const ordre = () => complet.locator(".quiz-complet-q").evaluateAll((xs) => xs.map((x) => x.dataset.mot));
    const debut = await ordre();
    const tires = debut.slice(4);
    for (const cle of ["le pirate", "la fée", "elsa", "simba"]) assert.ok(!tires.includes(cle), cle);
    assert.deepEqual(debut.slice(0, 2), ["le pirate", "la fée"]);
    assert.deepEqual(debut.slice(2, 4).sort(), ["elsa", "simba"]);
    assert.equal(await complet.locator(".quiz-complet-q img.tirage-mini").count(), 1, "seule Elsa a une image (la sienne), jamais au 🎲");
    await waitFor(async () => (await complet.locator('[data-mot="elsa"] img.tirage-mini').getAttribute("src")) === PNG, "la petite image d'Elsa");
    assert.equal(await complet.locator('[data-mot="simba"] .tirage-mini.emoji').textContent(), "🦁");
    assert.equal(await complet.locator('[data-mot="elsa"] .mot-indices').textContent(), "Je suis reine · Je fais de la glace · Libérée, délivrée");
    // ✕ sur la fée : sa place reste (2e), avec son petit 🎲 et son champ ; la ✕ de la place la supprime pour de bon.
    await complet.locator('.quiz-complet-q[data-mot="la fée"] .tirage-retirer').click();
    await compteur.filter({ hasText: "6 personnages · 1 à tirer" }).waitFor();
    const vide = complet.locator("li.quiz-case-vide");
    assert.equal(await vide.locator(".quiz-complet-num").textContent(), "2");
    assert.match(await complet.locator(".quiz-complet-voir").textContent(), /\(1 à tirer\)$/);
    await vide.locator(".quiz-case-retirer").click();
    await compteur.filter({ hasText: /^6 personnages$/ }).waitFor();
    const avantDescente = await ordre();
    await complet.locator(".quiz-complet-q").nth(0).locator(".quiz-complet-descendre").click();
    await waitFor(async () => (await ordre()).join() === [avantDescente[1], avantDescente[0], ...avantDescente.slice(2)].join(), "le premier passe en 2e");
    // Glissé à la souris (cedric, 26/10) : le 2e posé sous le 4e.
    const glisse = await ordre();
    await glisser(complet.locator(".quiz-complet-q").nth(1), complet.locator(".quiz-complet-q").nth(3), true);
    await waitFor(async () => (await ordre()).join() === [glisse[0], glisse[2], glisse[3], glisse[1], ...glisse.slice(4)].join(), "glissé plus bas");
    const avant = await ordre();
    await complet.locator(".quiz-melanger").click();
    await waitFor(async () => (await ordre()).join() !== avant.join(), "mélangés");
    // ✕ sur Elsa (piochée dans mes packs) : sa place reste ; « Disney » n'a plus personne de libre ; la place part.
    await complet.locator('.quiz-complet-q[data-mot="elsa"] .tirage-retirer').click();
    await compteur.filter({ hasText: "5 personnages · 1 à tirer" }).waitFor();
    await vide.locator(".quiz-case-champ").fill("Disney");
    await vide.locator(".quiz-case-de").click();
    await page.locator("#annonce", { hasText: "Plus aucun personnage libre sur « Disney »" }).waitFor();
    await vide.locator(".quiz-case-retirer").click();
    await compteur.filter({ hasText: /^5 personnages$/ }).waitFor();
    // ✕ sur un personnage du 🎲 : le petit 🎲 de sa place en tire un autre, à sa place.
    const place = (await ordre()).indexOf(tires[2]);
    await complet.locator(`.quiz-complet-q[data-mot="${tires[2]}"] .tirage-retirer`).click();
    await compteur.filter({ hasText: "4 personnages · 1 à tirer" }).waitFor();
    assert.equal(await vide.locator(".quiz-complet-num").textContent(), String(place + 1));
    await vide.locator(".quiz-case-de").click();
    await compteur.filter({ hasText: /^5 personnages$/ }).waitFor();
    assert.ok(!(await ordre()).includes(tires[2]), "le personnage retiré ne revient pas");
    const joues = await ordre();
    await capture(page, "qui-suis-je");
    if (process.env.CAPTURES) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await capture(page, "qui-suis-je-pc");
      await page.setViewportSize({ width: 390, height: 844 });
    }

    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const zoe = Object.values(await library("shows")).find((x) => x.childName === "Zoé");
    const [qs] = zoe.rounds;
    assert.deepEqual(qs.seriesMots.map((x) => [x.origine, x.mots.filter((m) => !m.vide).length, x.pioche ?? null]),
      [["de", 3, null], ["reprise", 1, null], ["biblio", 1, { mode: "recherche", terme: "Disney", profil: "MOYENS" }]]);
    assert.equal(qs.seriesMots[2].titre, "Mes packs : « Disney » à 100 %");
    // Sur la TV : dans l'ordre du « complet », chacun avec ses indices.
    const { snapshot, problems } = buildSnapshot("zoe", zoe, {});
    assert.deepEqual(problems, []);
    const questions = snapshot.quiz.questions.filter((q) => q.kind === "quisuis");
    assert.deepEqual(questions.map((q) => q.choices[0].toLowerCase()), joues);
    const simba = questions.find((q) => q.choices[0] === "Simba");
    assert.deepEqual(simba.cards.map((c) => c.word), ["Mon père est Mufasa", "Je deviens roi"]);
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
      serie: "Super-héros", famille: "Films et séries", niveau: "Moyen",
      personnages: [
        { reponse: "Spider-Man", emoji: "🕷️", indices: ["Je grimpe aux murs", "Une araignée m'a piqué", "Je lance des toiles"] },
        { reponse: "Batman", emoji: "🦇", indices: ["Je vis à Gotham", "Je porte une cape"] },
        { reponse: "Hulk", indices: ["Je suis vert"] },
        { reponse: "Elsa", indices: ["Je suis reine", "Je fais de la glace"] },
      ],
    })) };
    // Le ZIP du pack (cedric, 25/10) : un aperçu, puis « Enregistrer le pack ».
    const zipDe = (nom, ...entrees) => ({ name: nom, mimeType: "application/zip", buffer: Buffer.from(faireZip(entrees)) });
    await page.locator("#bi-zip").setInputFiles(zipDe("heros.zip", ["heros/" + fichier.name, fichier.buffer]));
    const apercuQui = page.locator("dialog[data-fenetre][open]");
    await apercuQui.locator(".pack-apercu-pack[data-epreuve=quisuis]", { hasText: "Super-héros" }).waitFor();
    assert.match(await apercuQui.innerText(), /Qui suis-je \? · 2 personnages nouveaux/);
    assert.match(await apercuQui.innerText(), /1 personnage était déjà dans le jeu/);
    assert.match(await apercuQui.innerText(), /Personnage 3 \(« Hulk »\) : il faut sa réponse et au moins 2 indices\./);
    assert.equal(await repondreFenetre(page), "Importer « Super-héros » ?");
    await page.locator("#builtin-status", { hasText: /^✓ 2 personnages pour Qui suis-je \?(, \d+ images?)?\.$/ }).waitFor();
    assert.equal(await titre("Super-héros").textContent(), "📚 Série « Super-héros » · 2 personnages");
    let extra = (await library("contents")).quisuis.extra;
    assert.deepEqual(extra.map((x) => [x.answer, x.serie, x.famille, x.niveau]), [["Elsa", "Disney", undefined, undefined],
      ["Spider-Man", "Super-héros", "Films et séries", "Moyen"], ["Batman", "Super-héros", "Films et séries", "Moyen"]]);
    // Une simple liste : sa série prend le nom du fichier ; sans niveau, l'aperçu le demande (cedric, 25/10).
    await page.locator("#bi-zip").setInputFiles(zipDe("animaux.zip", ["Animaux.json", JSON.stringify([
      { answer: "Le panda", emoji: "🐼", clues: ["Je mange du bambou", "Je suis noir et blanc"] }])]));
    assert.equal(await apercuQui.locator("select.pack-theme").count(), 0, "Qui suis-je ? : pas de thème, ses personnages vont dans le jeu");
    await apercuQui.locator("select.pack-niveau").selectOption("Facile");
    assert.equal(await repondreFenetre(page), "Importer « Animaux » ?");
    await page.locator("#builtin-status", { hasText: /^✓ 1 personnage pour Qui suis-je \?(, \d+ images?)?\.$/ }).waitFor();
    // Des données illisibles : expliqué, rien d'enregistré.
    await page.locator("#bi-zip").setInputFiles(zipDe("casse.zip", ["casse.json", "{ pas du json"]));
    assert.match(await repondreFenetre(page), /Ce pack ne peut pas être importé\.[\s\S]*« casse\.json »[\s\S]*mal écrites[\s\S]*Rien n'a été enregistré\./);
    // Modifier un personnage importé (cedric, 25/10) : réponse, émoji, indices ; sa place dans le jeu le suit.
    await page.locator('#builtin-items .content-item[data-key="batman"]').getByRole("button", { name: "Modifier ce personnage" }).click();
    const modif = page.locator("dialog[data-fenetre][open] .personnage-edit");
    await modif.getByLabel("Réponse").fill("Batman le justicier");
    await modif.getByLabel("Émoji (facultatif)").fill("🌙");
    await modif.getByLabel("Indice 3").fill("J'ai une Batmobile");
    await page.locator("dialog[data-fenetre][open] [data-fenetre-ok]").click();
    await page.locator("#builtin-status", { hasText: "« 🌙 Batman le justicier » est modifié." }).waitFor();
    const batman = (await library("contents")).quisuis.extra.find((x) => x.answer === "Batman le justicier");
    assert.deepEqual([batman.emoji, batman.clues, batman.serie], ["🌙", ["Je vis à Gotham", "Je porte une cape", "J'ai une Batmobile"], "Super-héros"]);
    assert.deepEqual([batman.famille, batman.niveau], ["Films et séries", "Moyen"], "modifié, il garde sa famille et son niveau");
    assert.deepEqual((await library("contents")).quisuis.extra.filter((x) => x.answer === "Le panda").map((x) => [x.famille ?? null, x.niveau]), [[null, "Facile"]]);

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
    assert.deepEqual(extra.map((x) => [x.answer, x.serie]), [["Elsa", "Disney"], ["Spider-Man", "Héros"], ["Batman le justicier", "Héros"]]);
    assert.equal(await page.locator('#builtin-items .serie-biblio[data-serie="Animaux"]').count(), 0);
    await capture(page, "qui-suis-je-series");
    await page.context().close();
  });

  test("Régie PC (cedric, 27/10) : Qui a disparu ? comme les autres jeux : l'âge (celui de la prestation), 4 / 6 / 8 cartes et le nombre de tours ; le 🎲 et son champ ; un ancien anniversaire ; « Qui a disparu ? complet » (↑ ↓ glisser 🔀, ✕ laisse un 🎲)", async () => {
    const { buildSnapshot, niveauDeFamille } = await import("../web/public/show.js");
    const { DISPARU_THEMES } = await import("../web/public/buzz-cards.js");
    const PNG = `data:image/png;base64,${png([40, 160, 90]).toString("base64")}`;
    const MES = ["a1", "a2", "a3", "a4", "a5", "a6"].map((x) => x.padStart(16, "0"));
    const NOMS = ["Doudou", "Vélo", "Ballon", "Tortue", "Cabane", "Gâteau"];
    await seedLibrary("images", Object.fromEntries(MES.map((id) => [id, PNG])));
    await seedLibrary("medias", Object.fromEntries(MES.map((id, k) => [id, { name: NOMS[k], cat: "Maison", createdAt: 1, updatedAt: 1 }])));
    // Un ancien anniversaire : un tour « Les outils » de 8 cartes.
    const outils = DISPARU_THEMES.find((t) => t.theme === "Les outils");
    await seedLibrary("shows", { luna: { childName: "Luna", age: 12, date: "2026-05-10", status: "archivee", updatedAt: 1,
      rounds: [{ type: "disparu", objects: 8, seriesMots: [{ id: "de", origine: "de", mots: [{ theme: outils.theme, objects: outils.objects.slice(0, 8) }] }] }] } });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await page.fill("#show-age", "9");
    await ajouterJeu(page, "disparu");
    const round = page.locator('#show-rounds .jeu-bloc[data-jeu="disparu"] .round');
    const compteur = round.locator(".round-head > .quiz-compteur");
    assert.equal(await compteur.textContent(), "Aucun tour pour l'instant : la TV en tirera 4 au hasard");
    await page.locator("#show-ready li.ready-alerte", { hasText: "⚠ Qui a disparu ? : aucun tour choisi pour l'instant, la TV en tirera 4 au hasard." }).waitFor();
    // Les lignes : âge, cartes et tours ; le 🎲 et son champ ; le rappel ; vos images.
    assert.deepEqual(await round.locator(".quiz-outils > *").evaluateAll((xs) => xs.map((x) => x.className)),
      ["de-ligne disparu-reglages", "de-ligne de-unique-ligne", "quiz-ajouts quiz-rappel fine", "quiz-ajouts vos-images grille-images"]);
    const age = round.locator("select.disparu-age");
    const cartes = round.locator("select.disparu-cartes");
    const tours = round.locator("select.disparu-tours");
    // L'âge de la prestation d'office (9 ans : les moyens, 6 cartes) ; 4, 6 ou 8 cartes.
    assert.deepEqual([await age.inputValue(), await cartes.inputValue(), await tours.inputValue()], ["MOYENS", "6", "4"]);
    assert.deepEqual(await cartes.locator("option").allTextContents(), ["4 cartes par tour", "6 cartes par tour", "8 cartes par tour"]);
    // Les petits : 4 cartes, des familles simples.
    await age.selectOption("PETITS");
    await waitFor(async () => (await cartes.inputValue()) === "4", "4 cartes chez les petits");
    const champ = round.locator(".de-unique-champ");
    await champ.focus();
    // Le champ ne propose que des familles (plus de lignes « Émojis » / « Photos libres »).
    const proposees = await round.locator(".de-unique-ligne .packs-suggestion b").evaluateAll((xs) => xs.map((x) => x.textContent));
    assert.ok(proposees.includes("Fruits") && !proposees.includes("Émojis") && !proposees.includes("Photos libres"), `familles proposées : ${proposees}`);
    await round.locator(".disparu-tours").selectOption("3");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: /^3 tours/ }).waitFor();
    await waitFor(async () => !(await page.locator("#show-ready li.ready-alerte").count()), "plus d'alerte une fois des tours tirés");
    const complet = round.locator(".quiz-complet");
    const lignes = complet.locator(".quiz-complet-q");
    const ordre = () => lignes.evaluateAll((xs) => xs.map((x) => x.dataset.mot));
    const niveauDe = (cle) => (cle.startsWith("photos · ") ? 1 : niveauDeFamille(DISPARU_THEMES.find((t) => t.theme.toLowerCase() === cle)));
    assert.ok((await ordre()).every((c) => niveauDe(c) === 1), `familles simples : ${await ordre()}`);
    for (let k = 0; k < 3; k++) assert.equal(await lignes.nth(k).locator(".grille-vignette").count(), 4);

    // 6 cartes : chaque tour déjà là en prend 6 (d'autres objets de sa famille).
    await cartes.selectOption("6");
    await waitFor(async () => (await lignes.nth(2).locator(".grille-vignette").count()) === 6, "6 cartes par tour");
    for (let k = 0; k < 3; k++) assert.equal(await lignes.nth(k).locator(".grille-vignette").count(), 6);
    // « Images réelles », 2 tours ; puis un mot (« guitare ») : sa famille.
    const images = round.locator("select.disparu-images");
    assert.equal(await images.inputValue(), "mixte");
    await images.selectOption("reelles");
    await champ.fill("");
    await tours.selectOption("2");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: /^5 tours/ }).waitFor();
    const apres = await ordre();
    assert.ok(apres.slice(3).every((c) => c.startsWith("photos · ")), apres.join());
    assert.equal(await lignes.nth(4).locator('img.grille-vignette[src^="banque/"]').count(), 6);
    // En « mixte » : les 2 tours au hasard en images réelles ont pu prendre « photos · musique » (jamais deux fois) ;
    // « La musique » en émojis (familles moyennes) reste libre, les petits n'ont tiré que des familles simples.
    await images.selectOption("mixte");
    await champ.fill("guitare");
    await tours.selectOption("1");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: /^6 tours/ }).waitFor();
    assert.ok(["la musique", "photos · musique"].includes((await ordre())[5]), (await ordre())[5]);
    // Un ancien anniversaire : son tour, à 6 cartes comme les autres.
    await round.locator(".quiz-rappel-cherche").fill("luna");
    await round.locator('.quiz-rappel-item[data-show="luna"]', { hasText: "1 tour" }).click();
    await compteur.filter({ hasText: /^7 tours/ }).waitFor();
    assert.equal((await ordre())[6], "les outils");
    assert.equal(await lignes.nth(6).locator(".grille-vignette").count(), 6);
    // Vos images : autant que de cartes par tour.
    await round.locator(".grille-images-titre").click();
    const ajouter = round.locator(".grille-images-ajouter");
    assert.equal(await ajouter.textContent(), "Cochez 6 images (0)");
    for (const id of MES) await round.locator(`.vos-images-tuile[data-image="${id}"]`).click();
    assert.equal(await ajouter.textContent(), "＋ Faire un tour avec ces 6 images");
    await ajouter.click();
    await compteur.filter({ hasText: /^8 tours/ }).waitFor();
    assert.equal((await ordre())[7], "vos images 1");

    // « Qui a disparu ? complet » : ouvert d'office ; ↓, glisser, 🔀.
    assert.equal(await complet.locator(".quiz-complet-voir").textContent(), "▾ 🧩 Qui a disparu ? complet : 8 tours, dans l'ordre de passage");
    const avant = await ordre();
    await lignes.nth(0).locator(".quiz-complet-descendre").click();
    await waitFor(async () => (await ordre()).join() === [avant[1], avant[0], ...avant.slice(2)].join(), "la première passe en 2e");
    await glisser(lignes.nth(7), lignes.nth(0), false);
    await waitFor(async () => (await ordre())[0] === "vos images 1", "glissé en tête");
    await complet.locator(".quiz-melanger").click();
    await waitFor(async () => (await ordre()).join() !== avant.join(), "mélangés");
    // ✕ : sa place reste, avec un petit 🎲 et son champ (en « Émojis » : une famille d'émojis).
    await images.selectOption("emojis");
    const melange = await ordre();
    // Le 3e tour, ou le 4e si le 🔀 y a mis celui de vos images (vérifié plus bas, il doit rester).
    const x = melange[2] === "vos images 1" ? 3 : 2;
    await lignes.nth(x).locator(".tirage-retirer").click();
    const vide = complet.locator(".quiz-case-vide");
    await vide.waitFor();
    assert.equal(await complet.locator(".quiz-complet-liste > li").nth(x).getAttribute("class"), await vide.getAttribute("class"), "à la même place");
    await vide.locator(".quiz-case-de").click();
    await vide.waitFor({ state: "detached" });
    const neuf = (await ordre())[x];
    assert.ok(!melange.includes(neuf) && !neuf.startsWith("photos · ") && neuf !== melange[x], neuf);
    assert.equal(await lignes.nth(x).locator(".grille-vignette").count(), 6);
    const joues = await ordre();
    await capture(page, "qui-a-disparu");

    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const zoe = Object.values(await library("shows")).find((x) => x.childName === "Zoé");
    const [qd] = zoe.rounds;
    assert.deepEqual([qd.objects, qd.profil], [6, "PETITS"], "les cartes et l'âge choisis restent");
    const mots = qd.seriesMots.flatMap((x) => x.mots).filter((m) => !m.vide);
    assert.equal(mots.length, 8);
    assert.ok(mots.every((g) => g.objects.length === 6), "6 cartes à chaque tour");
    assert.deepEqual(mots.find((g) => g.theme === "Vos images 1").objects.map((o) => [o.word, o.imageId]), NOMS.map((w, k) => [w, MES[k]]));
    // Sur la TV : chaque tour tel quel, dans l'ordre du « complet », 6 cartes.
    const { snapshot, problems } = buildSnapshot("zoe", zoe, {});
    assert.deepEqual(problems, []);
    const questions = snapshot.quiz.questions.filter((q) => q.kind === "disparu");
    assert.equal(questions.length, 8);
    const parTheme = new Map(mots.map((g) => [g.theme.toLowerCase(), g]));
    questions.forEach((q, k) => {
      const g = parTheme.get(joues[k]);
      assert.equal(q.cards.length, 6);
      assert.deepEqual(q.cards.map((c) => c.word).sort(), g.objects.map((o) => o.word).sort());
      assert.ok(g.objects.some((o) => o.word === q.choices[0]), "l'objet qui disparaît est dans son tour");
    });
    await page.context().close();
  });

  test("Régie PC (cedric, 29/10) : Qui a disparu ?, un clic sur la petite image d'une carte la recadre (carré, comme sur la TV) pour cette prestation seulement ; Annuler ne change rien ; un émoji ne se recadre pas", async () => {
    const PNG = `data:image/png;base64,${png([200, 80, 40]).toString("base64")}`;
    const VELO = "b1b1b1b1b1b1b1b1";
    await seedLibrary("images", { [VELO]: PNG });
    const objets = [{ word: "Vélo", imageId: VELO }, { word: "Chat", image: "🐱" }, { word: "Pomme", image: "🍎" }, { word: "Ballon", image: "⚽" }];
    await seedLibrary("shows/remi", { childName: "Rémi", title: "Anniversaire de Rémi", age: 9, date: "2099-12-03", status: "publiee", updatedAt: 1,
      rounds: [{ type: "disparu", objects: 4, seriesMots: [{ id: "i1", origine: "images", mots: [{ theme: "Vos images 1", objects: objets }] }] }] });
    const page = await admin();
    await page.click('#screen-home [data-etat="avenir"]');
    await page.locator('#show-list [data-show="remi"]').getByRole("button", { name: "Ouvrir" }).click();
    await deplierJeux(page);
    const round = page.locator('#show-rounds .jeu-bloc[data-jeu="disparu"] .round');
    const vignette = round.locator(".quiz-complet .grille-vignette").first();
    await vignette.waitFor();
    assert.equal(await round.locator(".quiz-complet img.grille-vignette.recadrable").count(), 1, "seule l'image se recadre");
    const taille = await vignette.evaluate((el) => [el.getBoundingClientRect().width, el.getBoundingClientRect().height]);
    assert.ok(Math.abs(taille[0] - taille[1]) < 1, `carrée comme sur la TV (${taille})`);
    await vignette.click();
    await page.locator(".cadre-boite").waitFor();
    await page.locator(".cadre-boite button", { hasText: "Annuler" }).click();
    await page.locator(".cadre-boite").waitFor({ state: "detached" });
    await vignette.click();
    const avant = await vignette.getAttribute("src");
    await page.locator(".cadre-zoom").fill("2");
    await page.locator(".cadre-boite button", { hasText: "Valider le cadrage" }).click();
    await page.locator(".cadre-boite").waitFor({ state: "detached" });
    await waitFor(async () => (await round.locator(".quiz-complet .grille-vignette").first().getAttribute("src")) !== avant, "la vignette montre l'image recadrée");
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const remi = await library("shows/remi");
    const apres = remi.rounds[0].seriesMots[0].mots[0].objects;
    assert.equal(apres[0].word, "Vélo");
    assert.match(apres[0].imageId, /^[0-9a-f]{16}$/);
    assert.notEqual(apres[0].imageId, VELO, "l'image recadrée");
    assert.equal(typeof (await library(`images/${apres[0].imageId}`)), "string", "rangée dans la bibliothèque");
    assert.equal(await library(`images/${VELO}`), PNG, "l'image d'origine reste");
    assert.deepEqual(apres.slice(1), objets.slice(1));
    await page.context().close();
  });

  test("Régie PC (cedric, 27/10) : Qui a disparu ? en émojis, en images réelles ou mixte ; aux images réelles, seulement les images carrées bien cadrées des packs, jamais leurs paysages", async () => {
    const { buildSnapshot } = await import("../web/public/show.js");
    const PNG = (k) => `data:image/png;base64,${png([20 * k, 200 - 15 * k, 90]).toString("base64")}`;
    const IDS = Array.from({ length: 10 }, (_, k) => `${k}`.repeat(16));
    const HEROS = ["Thor", "Hulk", "Loki", "Groot", "Rocket", "Vision", "Wanda", "Faucon"];
    await seedLibrary("images", Object.fromEntries(IDS.map((id, k) => [id, PNG(k)])));
    await seedLibrary("quizzes", {
      // Un Quiz illustré : ses réponses, des personnages carrés bien cadrés.
      marvel: { title: "Marvel illustré", theme: "Marvel", kind: "photo", pack: true, niveau: "Facile", updatedAt: 1, questions: [0, 1].map((q) => ({
        text: `Qui ? ${q}`, choices: HEROS.slice(4 * q, 4 * q + 4), correct: 0, status: "validee", choiceImages: IDS.slice(4 * q, 4 * q + 4) })) },
      // Une série de photos du Zoom (des paysages) : jamais tirée ici.
      paysages: { title: "Paysages", theme: "Paysages", kind: "images", source: "photos", pack: true, niveau: "Facile", updatedAt: 1, questions: [8, 9].map((k) => ({
        text: "Qu'est-ce que c'est ?", choices: [`Lieu ${k}`, "A", "B", "C"], correct: 0, imageId: IDS[k], status: "validee" })) },
    });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await page.fill("#show-age", "9");
    await ajouterJeu(page, "disparu");
    const round = page.locator('#show-rounds .jeu-bloc[data-jeu="disparu"] .round');
    const compteur = round.locator(".round-head > .quiz-compteur");
    const images = round.locator("select.disparu-images");
    const tours = round.locator("select.disparu-tours");
    const champ = round.locator(".de-unique-champ");
    const lignes = round.locator(".quiz-complet .quiz-complet-q");
    const ordre = () => lignes.evaluateAll((xs) => xs.map((x) => x.dataset.mot));
    // Sur la première ligne, mixte d'office.
    assert.deepEqual(await round.locator(".disparu-reglages > *").evaluateAll((xs) => xs.map((x) => x.className.split(" ").pop())), ["disparu-age-titre", "disparu-age", "disparu-images", "disparu-cartes", "disparu-tours"]);
    assert.equal(await images.inputValue(), "mixte");
    assert.deepEqual(await images.locator("option").allTextContents(), ["Mixte : émojis et images réelles", "Émojis", "Images réelles"]);
    // Émojis : 2 tours, que des émojis.
    await images.selectOption("emojis");
    await tours.selectOption("2");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: /^2 tours/ }).waitFor();
    assert.equal(await lignes.locator("img.grille-vignette").count(), 0);
    assert.equal(await lignes.locator(".grille-vignette.emoji").count(), 12);
    // Images réelles, « Marvel » : les personnages du Quiz illustré.
    await images.selectOption("reelles");
    await champ.fill("Marvel");
    await tours.selectOption("1");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: /^3 tours/ }).waitFor();
    assert.equal((await ordre())[2], "marvel");
    assert.equal(await lignes.nth(2).locator("img.grille-vignette").count(), 6);
    // « Paysages » : une série du Zoom, jamais tirée.
    await champ.fill("Paysages");
    await round.locator(".de-unique").click();
    await page.locator("#annonce", { hasText: "Aucune famille libre ne répond à « Paysages »" }).waitFor();
    assert.equal(await lignes.count(), 3);
    // Au hasard en images réelles : des photos (ni émoji).
    await champ.fill("");
    await tours.selectOption("2");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: /^5 tours/ }).waitFor();
    for (const k of [3, 4]) {
      assert.equal(await lignes.nth(k).locator(".grille-vignette.emoji").count(), 0);
      assert.equal(await lignes.nth(k).locator("img.grille-vignette").count(), 6);
    }
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    const zoe = Object.values(await library("shows")).find((x) => x.childName === "Zoé");
    assert.equal(zoe.rounds[0].images, "reelles");
    // Sur la TV : le tour Marvel montre les images des personnages, chacune avec son nom.
    const { snapshot } = buildSnapshot("zoe", zoe, {});
    const marvel = snapshot.quiz.questions.filter((q) => q.kind === "disparu")[2];
    assert.equal(marvel.cards.length, 6);
    assert.ok(marvel.cards.every((c) => IDS.slice(0, 8).includes(c.imageId) && c.word === HEROS[IDS.indexOf(c.imageId)]));
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

  test("Régie PC (cedric, 23 et 25/10) : le Vrai ou Faux express a la carte du Quiz : 🎲 dans mes packs et dans le Vrai ou Faux tout prêt (autant de vraies que de fausses, au niveau du profil), un ancien anniversaire, les Vrai / Faux de ses quiz, « Vrai ou Faux complet », jamais deux fois la même affirmation", async () => {
    const { buildSnapshot } = await import("../web/public/show.js");
    const { AFFIRMATIONS } = await import("../web/public/banque-vrai-faux.js");
    const moyennes = new Map(AFFIRMATIONS.filter((x) => x.niveau === 2).map((x) => [x.text, x]));
    const vf = (text, vrai) => ({ text, choices: ["Vrai", "Faux"], correct: vrai ? 0 : 1, status: "validee" });
    const SCIENCES = { title: "Sciences", source: "tableur", updatedAt: 1, pack: true, niveau: "Moyen", questions: [
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
    const champ = round.locator(".de-unique-champ");
    const nombre = round.locator("select.de-nombre-unique");
    const compteur = round.locator(".round-head > .quiz-compteur");
    // La carte du Quiz (cedric, 26/10), avec des affirmations : le compteur et l'âge en tête, une seule ligne de 🎲 (mes
    // packs, le Vrai ou Faux tout prêt), le rappel ; sa Super Finale en dernière ligne (3 dernières, ×2 d'office), pas de bougies.
    assert.deepEqual(await round.locator(".round-head > *").evaluateAll((xs) => xs.map((x) => x.className)), ["num", "quiz-compteur", "tirage-profil quiz-age quiz-en-tete"]);
    assert.deepEqual(await round.locator(".round-body > *").evaluateAll((xs) => xs.map((x) => x.className)), ["quiz-outils", "quiz-finale"]);
    assert.deepEqual(await round.locator(".quiz-outils > *").evaluateAll((els) => els.map((e) => e.className)),
      ["de-ligne de-unique-ligne", "quiz-ajouts quiz-rappel fine"]);
    assert.equal(await round.locator(".quiz-biblio, .quiz-series").count(), 0);
    assert.equal(await round.locator(".quiz-finale .finale-oui").inputValue(), "oui");
    assert.equal(await round.locator(".quiz-finale select.finale").inputValue(), "3");
    assert.equal(await round.locator(".quiz-finale select.finale option:checked").textContent(), "Les 3 dernières affirmations");
    assert.equal(await round.locator(".quiz-finale .finale-facteur").inputValue(), "2");
    assert.equal(await round.locator("select.quiz-age").inputValue(), "MOYENS", "le profil de l'âge de l'enfant");
    // Le champ propose le tout prêt et mes packs : seulement leurs Vrai / Faux (« Sciences » en a 2 ; « animaux » aucun).
    await champ.focus();
    assert.deepEqual(await round.locator(".de-unique-ligne .packs-suggestion").evaluateAll((xs) => xs.slice(0, 2).map((x) => x.innerText.replace(/\s+/g, " "))),
      ["Affirmations libres de droit Vrai ou Faux tout prêt, à l'âge choisi", "Mes packs 2 affirmations dans mes packs"]);
    assert.equal(await round.locator(".quiz-rappel-titre").textContent(), "📚 Rappeler les affirmations d'un ancien anniversaire");
    assert.equal(await compteur.textContent(), "Aucune affirmation pour l'instant");

    // « mes packs », 2 affirmations : les Vrai / Faux de « Sciences », jamais sa question à 4 réponses.
    await champ.fill("mes packs");
    await nombre.selectOption("2");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: /^2 affirmations/ }).waitFor();
    // Un ancien anniversaire : ses affirmations, copiées.
    await round.locator(".quiz-rappel-cherche").fill("luna");
    await round.locator('.quiz-rappel-item[data-show="luna"]', { hasText: "2 affirmations" }).click();
    await compteur.filter({ hasText: /^4 affirmations/ }).waitFor();

    // « libre » : 8 affirmations du Vrai ou Faux tout prêt, niveau Moyen, 4 vraies et 4 fausses, à la suite.
    await champ.fill("libre");
    await nombre.selectOption("8");
    await round.locator(".de-unique").click();
    await compteur.filter({ hasText: /^12 affirmations/ }).waitFor();
    assert.equal(await compteur.textContent(), "12 affirmations, dont 3 en Super Finale");
    const complet = round.locator(".quiz-complet");
    assert.equal(await complet.locator(".quiz-complet-voir").textContent(), "▾ 🧩 Vrai ou Faux complet : 12 affirmations, dans l'ordre de passage");
    const lignes = complet.locator(".quiz-complet-q");
    const textes = async () => (await lignes.locator(".tirage-texte").allTextContents()).slice(4, 12);
    const premier = await textes();
    assert.equal(premier.length, 8);
    for (const t of premier) assert.ok(moyennes.has(t), `niveau Moyen : ${t}`);
    const vfs = (await lignes.locator(".tirage-vf").allTextContents()).slice(4, 12);
    assert.deepEqual([vfs.filter((x) => x === "✓ Vrai").length, vfs.filter((x) => x === "✗ Faux").length], [4, 4]);
    for (const [k, t] of premier.entries()) assert.equal(vfs[k], moyennes.get(t).vrai ? "✓ Vrai" : "✗ Faux");
    // ✕ sur une affirmation du tout prêt : sa place reste, avec son petit 🎲 et son champ ; il en tire une autre.
    await lignes.nth(4).locator(".tirage-retirer").click();
    const vide = complet.locator("li.quiz-case-vide");
    await vide.waitFor();
    assert.equal(await vide.locator(".quiz-complet-num").textContent(), "5");
    assert.equal(await compteur.textContent(), "11 affirmations, dont 3 en Super Finale · 1 à tirer");
    await vide.locator(".quiz-case-champ").fill("libre");
    await vide.locator(".quiz-case-de").click();
    await vide.waitFor({ state: "detached" });
    const second = await textes();
    assert.ok(!second.includes(premier[0]), "l'affirmation retirée ne revient pas");
    assert.equal(new Set(second).size, 8);
    assert.equal(await compteur.textContent(), "12 affirmations, dont 3 en Super Finale");

    // Un Vrai ou Faux ajouté juste après n'en crée pas un second.
    await ajouterJeu(page, "express");
    await page.locator("#annonce", { hasText: "Le Vrai ou Faux express est déjà le dernier jeu : ajoutez-y vos affirmations" }).waitFor();
    assert.equal(await complet.locator(".quiz-complet-q .tirage-vf").count(), 12);
    // ✕ sur « Les poissons volent » de mes packs (avant celle de Luna) : sa place reste.
    await complet.locator(".quiz-complet-q", { hasText: "Les poissons volent" }).first().locator(".tirage-retirer").click();
    await compteur.filter({ hasText: "11 affirmations, dont 3 en Super Finale · 1 à tirer" }).waitFor();
    await vide.waitFor();

    // Un autre Vrai ou Faux express dans la même fête : son 🎲 ne reprend aucune affirmation du premier.
    await ajouterJeu(page, "coffres");
    await ajouterJeu(page, "express");
    const autre = page.locator("#show-rounds .round").nth(2);
    await autre.locator(".de-unique-champ").fill("libre");
    await autre.locator(".de-nombre-unique").selectOption("10");
    await autre.locator(".de-unique").click();
    await autre.locator(".round-head > .quiz-compteur", { hasText: "10 affirmations" }).waitFor();
    const autres = await autre.locator(".quiz-complet-q .tirage-texte").allTextContents();
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
    assert.deepEqual(manche.seriesQuiz.map((x) => [x.origine, x.profil ?? null, x.questions?.length ?? x.quizId, x.pioche?.mode ?? null]),
      [["de", "MOYENS", 8, null], ["reprise", null, 1, "hasard"], ["reprise", null, 2, null]]);
    assert.deepEqual(manche.seriesQuiz[1].questions.map((q) => q.text), ["Le Soleil est une étoile"]);
    assert.equal(manche.finale, 3);
    assert.deepEqual(manche.seriesQuiz[0].questions.map((q) => q.text), second);
    await page.context().close();

    // Sur la TV : le premier jeu « Vrai ou Faux express » de 11 affirmations, dans l'ordre, ses 3 dernières en Super Finale ;
    // le second (10 affirmations) a la sienne.
    const { snapshot } = buildSnapshot("zoe", zoe, { animaux: ANIMAUX, sciences: SCIENCES });
    const qs = snapshot.quiz.questions.filter((q) => q.round === "Vrai ou Faux express");
    assert.deepEqual(qs.slice(0, 11).map((q) => q.text), ["Le Soleil est une étoile", "Le Soleil est une étoile", "Les poissons volent", ...second]);
    assert.ok(qs.every((q) => q.kind === "express"));
    assert.deepEqual(qs.map((q) => q.double), [...Array(8).fill(false), true, true, true, ...Array(7).fill(false), true, true, true]);
    assert.deepEqual(qs.slice(3, 11).map((q) => q.choices[q.correct]), second.map((t) => (moyennes.get(t).vrai ? "Vrai" : "Faux")));
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
    assert.deepEqual(await ligne.locator(".mime-par-equipe option").allTextContents(), [10, 15, 20, 25, 30, 40, 50, 60].map((k) => `${k} images par équipe`));
    assert.equal(await ligne.locator(".mime-par-equipe").inputValue(), "20");
    assert.deepEqual(await ligne.locator(".mime-duree option").allTextContents(), ["30 s", "45 s", "1 min", "1 min 15", "1 min 30", "1 min 45", "2 min", "2 min 15", "2 min 30", "2 min 45", "3 min", "3 min 15",
      "3 min 30", "3 min 45", "4 min", "4 min 15", "4 min 30", "4 min 45", "5 min"].map((d) => `Tour de ${d}`), "Mimes en file (cedric, 26/10) : réglé à la seconde près, jusqu'à 5 min");
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
    assert.deepEqual(await choix.locator(".chips:not(.choix-cats) .chip").evaluateAll((xs) => xs.map((x) => x.dataset.groupe)), ["tout", "packs", "photos", "emojis", "miennes"]);
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
    // Ses images d'abord, puis la réserve mimable (mimes en file, cedric 26/10).
    assert.deepEqual(qs.map((q, i) => q.cards.slice(0, listes[i].length).map((c) => c.word)), listes);
    assert.ok(qs.every((q, i) => q.cards.length >= listes[i].length + 20 && q.cards.length <= listes[i].length + MIME_RESERVE));
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
    assert.deepEqual(jouees.map((q, i) => q.cards.slice(0, listes[i].length).map((c) => c.word)), listes);
    // Rangées avec les images des cartes (choiceImages), comme celles d'un paquet de mimes.
    await waitFor(async () => {
      const show = await read("show");
      const copiees = (await read("choiceImages")) ?? {};
      // Réserve : la photo si la banque de ce test l'a, sinon son émoji (une carte sans photo n'empêche rien).
      return show.quiz.questions.filter((q) => q.kind === "mime")
        .every((q, i) => q.cards.slice(0, listes[i].length).every((c) => c.banque === undefined && /^[0-9a-f]{16}$/.test(c.imageId ?? "") && copiees[c.imageId])
          && q.cards.slice(listes[i].length).every((c) => c.banque === undefined && ((c.imageId && copiees[c.imageId]) || c.image)));
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
    assert.deepEqual(await round.locator(".blind-series .blind-paroles").allTextContents(), Array(5).fill("✓ Paroles"));
    const [titre, paroles] = await Promise.all([round.locator(".blind-titre").first().boundingBox(), round.locator(".blind-series .blind-paroles").first().boundingBox()]);
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
    // Glissée à la souris (cedric, 26/10) : la dernière posée en tête.
    const avantGlisse = await ordreComplet();
    await glisser(complet.locator(".blind-complet-q").last(), complet.locator(".blind-complet-q").first(), false);
    await waitFor(async () => (await ordreComplet()).join() === ["m1", ...avantGlisse.slice(0, -1)].join(), "glissée en tête");
    // 🎧 et « ✓ Paroles » sur chaque chanson du « complet » aussi (cedric, 26/10), d'où qu'elle vienne.
    const lignesCompletes = complet.locator(".blind-complet-q");
    assert.equal(await lignesCompletes.locator(".blind-paroles").count(), await lignesCompletes.count());
    assert.equal(await lignesCompletes.locator(".blind-ecouter").count(), await lignesCompletes.count());
    assert.equal(await complet.locator('.blind-complet-q[data-chanson="m1"] .blind-paroles').textContent(),
      await seriePl.locator('.blind-chanson[data-chanson="m1"] .blind-paroles').textContent(), "la même pastille que dans sa série");
    await complet.locator('.blind-complet-q[data-chanson="m1"] .blind-ecouter').click();
    await complet.locator('.blind-complet-q[data-chanson="m1"] .blind-reglage').waitFor();
    assert.ok((await complet.locator('.blind-complet-q[data-chanson="m1"] .blind-reglage button').allTextContents()).includes("⏱ Régler…"));
    assert.equal(await round.locator(".blind-reglage").count(), 1, "seulement dans le « complet », un seul ouvert");
    await complet.locator('.blind-complet-q[data-chanson="m1"] .blind-ecouter').click();
    await waitFor(async () => (await round.locator(".blind-reglage").count()) === 0, "menu refermé");
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
    // Pas de manches, ni « Reprendre », ni Note ; « Sélectionner mes chansons » comme au Blind test (cedric, 26/10).
    const bloc = page.locator('#show-rounds .jeu-bloc[data-jeu="musical"]');
    assert.equal(await bloc.locator(".jeu-nb, .jeu-plus").count(), 0);
    assert.equal(await round.locator(".reprendre-ouvrir, .manche-note").count(), 0);
    assert.equal(await round.locator(".blind-manuel .blind-selectionner").textContent(), "🎵 Sélectionner mes chansons");
    assert.equal(await compteur.textContent(), "Aucune chanson pour l'instant : touchez 🎲, « Sélectionner mes chansons » ou ajoutez une playlist");
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
    // « 🎵 Sélectionner mes chansons » (cedric, 26/10) : choisie à la main, elle vient après les autres dans le « complet ».
    await round.locator(".blind-selectionner").click();
    const choix = page.locator(".choix-sons");
    await choix.locator(`.choix-chanson[data-chanson="${dansPl[0]}"]`).click();
    await choix.locator(".choix-valider", { hasText: "(1)" }).click();
    await choix.waitFor({ state: "detached" });
    await round.locator('.blind-serie[data-origine="choix"]').waitFor();
    assert.equal(await round.locator(".blind-selection").textContent(), "1 chanson sélectionnée");
    const total = tires.length + dansPl.length;
    await compteur.filter({ hasText: new RegExp(`^${total} chansons à trouver$`) }).waitFor();
    // « Quiz musical complet » : tout, dans l'ordre de passage ; ↑ et 🔀.
    const complet = round.locator(".blind-complet");
    assert.equal(await complet.locator(".blind-complet-voir").textContent(), `▸ 🧩 Quiz musical complet : ${total} chansons, dans l'ordre de passage`);
    await complet.locator(".blind-complet-voir").click();
    const ordre = () => complet.locator(".blind-complet-q").evaluateAll((xs) => xs.map((x) => x.dataset.chanson));
    const avant = await ordre();
    assert.equal(avant.at(-1), dansPl[0], "la chanson choisie à la main, après les autres");
    assert.equal(await complet.locator(`.blind-complet-q[data-chanson="${dansPl[0]}"] .blind-paroles`).textContent(), "✓ Paroles");
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

  test("Régie PC (cedric, 24/10) : Quiz musical, sous chaque chanson ses 3 mauvaises réponses tirées du refrain : proposées, modifiées, ✕ prend la suivante, enregistrées et jouées", async () => {
    const { buildSnapshot, leurresDeChanson } = await import("../web/public/show.js");
    const { propositionsDeTitre } = await import("../web/public/paroles.js");
    const hex = (c, k) => `${c}${k}`.padEnd(16, c);
    const refrain = (lignes) => lignes.map(([s, t]) => `${s * 1000}|${t}`).join("\n");
    const SONGS = {
      s1: { title: "Libérée, délivrée", artist: "La Reine des neiges", audioId: hex("a", 1), refrainId: hex("b", 1), start: 0, refrain: 60, buzz: 25, lrc: true, updatedAt: 1,
        paroles: refrain([[0, "Libérée, délivrée"], [3, "Je ne mentirai plus jamais"], [7, "Libérée, délivrée"], [10, "C'est décidé, je m'en vais"], [14, "J'ai laissé mon enfance en été"], [18, "Perdue dans l'hiver"]]) },
      s2: { title: "Hakuna Matata", artist: "Le Roi lion", audioId: hex("a", 2), refrainId: hex("b", 2), start: 0, refrain: 50, buzz: 25, lrc: true, updatedAt: 1,
        paroles: refrain([[0, "Hakuna matata, mais quelle phrase magnifique"], [5, "Hakuna matata, quel chant fantastique"], [9, "Sans aucun souci, philosophie"]]) },
      s3: { title: "Sous l'océan", artist: "La Petite Sirène", audioId: hex("a", 3), start: 0, buzz: 25, updatedAt: 1 },
      s4: { title: "Ce rêve bleu", artist: "Aladdin", audioId: hex("a", 4), start: 0, buzz: 25, updatedAt: 1 },
    };
    await seedLibrary("songs", SONGS);
    await seedLibrary("playlists", { pl: { title: "Disney", duration: 30, updatedAt: 1, tracks: Object.entries(SONGS).map(([k, x]) => ({ title: x.title, audioId: x.audioId, songId: k, duration: 25 })) } });
    const page = await admin();
    await page.click("#home-new");
    await page.fill("#show-child", "Zoé");
    await ajouterJeu(page, "musical");
    const round = page.locator("#show-rounds .round").nth(0);
    await round.locator(".blind-playlist-cherche").fill("dis");
    await round.locator('.blind-playlist-item[data-playlist="pl"]').click();
    const leurres = (k) => round.locator(`.blind-chanson[data-chanson="${k}"] .leurre-texte`);
    const valeurs = (k) => leurres(k).evaluateAll((xs) => xs.map((x) => x.value));
    // Dépliée : sous chaque chanson, ses 3 mauvaises réponses proposées d'après le refrain réglé pour le hook.
    const p1 = propositionsDeTitre(SONGS.s1.paroles, SONGS.s1.title);
    await leurres("s1").first().waitFor();
    assert.deepEqual(await valeurs("s1"), leurresDeChanson(SONGS.s1));
    assert.deepEqual(await valeurs("s1"), p1.slice(0, 3));
    assert.deepEqual(await valeurs("s2"), leurresDeChanson(SONGS.s2));
    assert.equal((await valeurs("s2")).length, 3);
    // Sans paroles du refrain : cases vides, d'autres titres seront tirés (ou celles que Sarah tape).
    assert.deepEqual(await valeurs("s3"), ["", "", ""]);
    await round.locator('.blind-chanson[data-chanson="s3"] .leurres-aide', { hasText: "Pas de paroles du refrain" }).waitFor();
    // ✕ : la proposition suivante du refrain prend sa place ; on modifie en tapant.
    await round.locator('.blind-chanson[data-chanson="s1"] .leurre-retirer').nth(2).click();
    await waitFor(async () => (await valeurs("s1"))[2] === p1[3], "la proposition suivante remplace celle enlevée");
    await leurres("s1").nth(1).fill("Reine des neiges");
    await leurres("s3").nth(0).fill("Le Roi lion");
    // Rien ne dépasse de la chanson, même sur un écran étroit.
    const deborde = await round.locator(".leurre").evaluateAll((xs) => xs.filter((x) => x.getBoundingClientRect().right > x.closest(".blind-chanson").getBoundingClientRect().right + 0.5).length);
    assert.equal(deborde, 0, "aucune mauvaise réponse ne dépasse");
    await capture(page, "quiz-musical-leurres");
    await page.click("#show-save");
    let zoe;
    await waitFor(async () => {
      zoe = Object.values((await library("shows")) ?? {}).find((x) => x.childName === "Zoé");
      return !!zoe?.rounds?.[0]?.leurres?.s1;
    }, "mauvaises réponses enregistrées");
    assert.deepEqual(zoe.rounds[0].leurres.s1, [p1[0], "Reine des neiges", p1[3]]);
    assert.deepEqual(zoe.rounds[0].leurres.s3, ["Le Roi lion", "", ""]);
    assert.equal(zoe.rounds[0].leurres.s2, undefined, "pas modifiées : proposées à nouveau au lancement");
    // La TV : le vrai titre et ces mauvaises réponses, mélangés ; une case vide prend un autre titre.
    const qs = buildSnapshot("zoe", zoe, {}, {}, Math.random, {}, {}, {}, SONGS).snapshot.quiz.questions;
    const q = (k) => qs.find((x) => x.audioId === SONGS[k].audioId);
    assert.deepEqual([...q("s1").choices].sort(), [SONGS.s1.title, p1[0], "Reine des neiges", p1[3]].sort());
    assert.deepEqual([...q("s2").choices].sort(), [SONGS.s2.title, ...leurresDeChanson(SONGS.s2)].sort());
    assert.ok(q("s3").choices.includes("Le Roi lion") && q("s3").choices.length === 4 && new Set(q("s3").choices).size === 4);
    assert.ok(qs.every((x) => x.choices[x.correct] === Object.values(SONGS).find((s) => s.audioId === x.audioId).title));
    // Rouverte : les mauvaises réponses modifiées sont là, celles de s2 toujours proposées.
    await page.click("#show-edit-crumb");
    await page.locator(".show-card", { hasText: "Zoé" }).first().click();
    await deplierJeux(page);
    await round.locator(".blind-voir").first().click();
    await leurres("s1").first().waitFor();
    assert.deepEqual(await valeurs("s1"), [p1[0], "Reine des neiges", p1[3]]);
    assert.deepEqual(await valeurs("s2"), leurresDeChanson(SONGS.s2));
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
    // « Enregistrer » dans la barre du bas qui suit l'écran : le message se voit sans descendre (cedric, 23/10 et 25/10).
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click("#show-save");
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
    // Un seul « Enregistrer », dans la barre du bas qui suit l'écran (cedric, 25/10).
    await page.fill("#show-date", day(5));
    await page.selectOption("#show-status", "publiee");
    assert.equal(await page.locator("#screen-show-edit .retour-barre.haut").count(), 0);
    await page.click("#screen-show-edit .retour-barre.bas #show-save");
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

  test("Régie PC (cedric, 23/10) : un Quiz = une seule manche ; compteur et âge en tête, une seule ligne de 🎲 (26/10), « Rappeler le quiz d'un ancien anniversaire » cherche le Quiz d'une prestation archivée, ordre au choix, Super Finale en dernière ligne", async () => {
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
    const ligne = round.locator(".quiz-outils > .de-unique-ligne");
    const age = round.locator(".round-head > select.quiz-age");
    const compteur = round.locator(".round-head > .quiz-compteur");
    const complet = round.locator(".quiz-complet");
    const lignesComplet = complet.locator(".quiz-complet-liste > li.quiz-complet-q");
    // Plus de « ＋ Manche » : le Quiz est une seule manche ; ni « ✍ Écrire une question » ni « ↺ Reprendre » (cedric, 23/10).
    assert.equal(await bloc.locator(".jeu-plus").count(), 0);
    assert.equal(await page.locator("#show-rounds .quiz-ecrire, #show-rounds .reprendre-ouvrir, #show-rounds .reprendre-zone").count(), 0);
    // Le compteur sur la ligne du numéro, en majuscules (cedric, 23/10), et l'âge juste à côté (26/10). Puis, de haut en
    // bas : la seule ligne de 🎲 (🎲, le champ, le nombre) et le rappel, plus fin ; la Super Finale avec la case des
    // bougies au bout ; pas de note dans le Quiz.
    assert.deepEqual(await round.locator(".round-head > *").evaluateAll((xs) => xs.map((x) => x.className)), ["num", "quiz-compteur", "tirage-profil quiz-age quiz-en-tete"]);
    assert.equal(await compteur.evaluate((x) => getComputedStyle(x).textTransform), "uppercase");
    assert.deepEqual(await round.locator(".round-body > *").evaluateAll((xs) => xs.map((x) => x.className)),
      ["quiz-outils", "quiz-finale"]);
    assert.equal(await round.locator(".quiz-finale > .quiz-bougies").textContent(), "🎂 Bougies");
    assert.deepEqual(await round.locator(".quiz-outils > *").evaluateAll((xs) => xs.map((x) => x.className)),
      ["de-ligne de-unique-ligne", "quiz-ajouts quiz-rappel fine"]);
    assert.deepEqual(await ligne.locator(":scope > *").evaluateAll((xs) => xs.map((x) => x.className)),
      ["btn packs-de de-unique", "quiz-ajout-champ", "tirage-nombre de-nombre de-nombre-unique"]);
    assert.equal(await ligne.locator(".de-unique-champ").inputValue(), "");
    // Le rappel : une case à gauche (pas un champ), une recherche à droite.
    const ajouts = round.locator(".quiz-rappel");
    assert.deepEqual(await ajouts.locator(":scope > *, :scope > .quiz-ajout-champ > *").evaluateAll((xs) => xs.map((x) => [x.tagName, x.className])),
      [["SPAN", "quiz-ajout-titre quiz-rappel-titre"], ["DIV", "quiz-ajout-champ"], ["INPUT", "quiz-ajout-cherche quiz-rappel-cherche"], ["DIV", "quiz-ajout-liste quiz-rappel-liste"]]);
    assert.equal(await ajouts.locator(".quiz-rappel-titre").textContent(), "📚 Rappeler le quiz d'un ancien anniversaire");
    assert.equal(await round.locator(".quiz-biblio").count(), 0);
    assert.equal(await compteur.textContent(), "Aucune question pour l'instant");
    assert.equal(await ligne.locator(".tirage-nombre").inputValue(), "8");
    assert.equal(await age.inputValue(), "MOYENS");
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
    const yBiblio = async () => (await round.locator(".quiz-finale").boundingBox()).y;
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
    // Tom choisi : tout son Quiz en une série ; la prestation archivée ne change pas. Les séries se voient dans le
    // « Quiz complet » (cedric, 25/10).
    await cherche.fill("tom");
    await ajouts.locator('.quiz-rappel-item[data-show="tom"]').click();
    await complet.waitFor();
    assert.equal(await compteur.textContent(), "2 questions, dont 2 en Super Finale, plus la question des bougies");
    // Puis le 🎲, « libre » tapé : des questions libres de droit, à la suite (cedric, 25/10).
    await age.selectOption("GRANDS");
    await ligne.locator(".de-unique-champ").fill("libre");
    await ligne.locator(".de-nombre-unique").selectOption("10");
    await ligne.locator(".de-unique").click();
    await compteur.filter({ hasText: /^12 questions/ }).waitFor();
    assert.equal(await compteur.textContent(), "12 questions, dont 3 en Super Finale, plus la question des bougies");
    // Ouvert d'office.
    assert.match(await complet.locator(".quiz-complet-voir").textContent(), /^▾/);
    // Sans les deux questions de Tom (au mot près : une question tirée peut aussi parler de pattes) ni celle des bougies.
    const tirees10 = complet.locator(".quiz-complet-liste > li.quiz-complet-q:not(.quiz-complet-bougies)")
      .filter({ hasNot: page.locator(".tirage-texte", { hasText: /^(Roi de la jungle \?|Combien de pattes a une araignée \?)$/ }) });
    assert.equal(await tirees10.count(), 10);
    // Des Juste Chiffre, une question sur quatre environ (10 → 2), jamais la première.
    const textes10 = await tirees10.locator(".tirage-texte").allTextContents();
    assert.equal(textes10.filter((x) => x.startsWith("🔢")).length, 2);
    assert.ok(!textes10[0].startsWith("🔢"));
    // Photo de la révélation à côté de chaque question à 4 réponses (Grands).
    const photos = await tirees10.evaluateAll((xs) => xs.filter((x) => !x.querySelector(".tirage-texte").textContent.startsWith("🔢")).map((x) => x.querySelector("img.tirage-mini")?.getAttribute("src") ?? ""));
    assert.equal(photos.length, 8);
    for (const src of photos) assert.match(src, /^banque-quiz\/qc-.+\.jpg$/);
    // ✕ : la question part, sa place reste (cedric, 26/10), avec un petit 🎲 qui en tire une autre.
    const retiree = textes10.find((x) => !x.startsWith("🔢"));
    const place = await lignesComplet.filter({ hasText: retiree }).locator(".quiz-complet-num").textContent();
    await lignesComplet.filter({ hasText: retiree }).locator(".tirage-retirer").click();
    const vide = complet.locator(".quiz-complet-liste li.quiz-case-vide");
    await vide.waitFor();
    assert.equal(await vide.locator(".quiz-complet-num").textContent(), place, "à sa place");
    assert.equal(await compteur.textContent(), "11 questions, dont 3 en Super Finale, plus la question des bougies · 1 à tirer");
    assert.match(await complet.locator(".quiz-complet-voir").textContent(), /\(1 à tirer\)$/);
    await vide.locator(".quiz-case-de").click();
    await vide.waitFor({ state: "detached" });
    assert.equal(await compteur.textContent(), "12 questions, dont 3 en Super Finale, plus la question des bougies");
    assert.ok(!(await lignesComplet.locator(".tirage-texte").allTextContents()).includes(retiree));
    // Le Quiz de Tom aussi : ✕ laisse la place ; sa ✕ la supprime pour de bon.
    await lignesComplet.filter({ has: page.locator(".tirage-texte", { hasText: /^Combien de pattes a une araignée \?$/ }) }).locator(".tirage-retirer").click();
    await vide.waitFor();
    await vide.locator(".quiz-case-retirer").click();
    await vide.waitFor({ state: "detached" });
    assert.equal(await compteur.textContent(), "11 questions, dont 3 en Super Finale, plus la question des bougies");
    // Un nouveau clic sur le dé : 8 questions de plus, à la suite, aucune déjà là (cedric, 25/10 : il ne refait plus sa série).
    const avantClic = await lignesComplet.locator(".tirage-texte").allTextContents();
    await ligne.locator(".de-nombre-unique").selectOption("8");
    await ligne.locator(".de-unique").click();
    await compteur.filter({ hasText: /^19 questions/ }).waitFor();
    const apresClic = (await lignesComplet.locator(".tirage-texte").allTextContents()).filter((t) => !t.startsWith("🎂"));
    assert.deepEqual(apresClic.slice(0, avantClic.filter((t) => !t.startsWith("🎂")).length), avantClic.filter((t) => !t.startsWith("🎂")), "les questions d'avant ne bougent pas");
    assert.equal(new Set(apresClic).size, 19, "jamais deux fois la même");
    // Lina en plus : à la fin.
    await cherche.fill("lina");
    await ajouts.locator('.quiz-rappel-item[data-show="lina"]').click();
    await compteur.filter({ hasText: /^21 questions/ }).waitFor();
    assert.equal(await compteur.textContent(), "21 questions, dont 3 en Super Finale, plus la question des bougies");
    // Super Finale : les 2 dernières, ×3.
    await finale.locator("select.finale").selectOption("2");
    await finale.locator(".finale-facteur").selectOption("3");
    assert.equal(await compteur.textContent(), "21 questions, dont 2 en Super Finale, plus la question des bougies");
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
      [["de", null, 18], ["reprise", "Anniversaire de Tom (1 mars 2026)", 1], ["reprise", "Anniversaire de Lina (12 sept. 2026)", 2]]);
    assert.equal(manche.finale, 2);
    assert.equal(manche.facteur, 3);
    assert.equal(manche.tirees, undefined);
    assert.equal(manche.quizId, undefined);
    const de = manche.seriesQuiz[0];
    assert.equal(de.profil, "GRANDS");
    for (const q of de.questions) assert.equal(banque.get(q.id).niveau, 3, "Grands : niveau Difficile");
    assert.deepEqual(manche.seriesQuiz[2].questions, tirees.map(({ id, ...q }) => q));
    // Sur la TV : un seul jeu, dans l'ordre choisi ; la bougie juste avant la Super Finale.
    const { snapshot } = buildSnapshot("zoe", zoe, { animaux: ANIMAUX });
    const qs = snapshot.quiz.questions;
    assert.equal(new Set(qs.map((q) => q.round)).size, 1, "Un seul jeu");
    assert.equal(qs.length, 1 + 18 + 1 + 2);
    assert.equal(qs[0].text, "Roi de la jungle ?");
    assert.deepEqual(qs.slice(1, 19).map((q) => q.text).sort(), de.questions.map((q) => q.text).sort(), "les questions du dé à la suite");
    assert.equal(qs.at(-3).text, "Le Juste Chiffre : combien de bougies sur le gâteau de Zoé cette année ?");
    assert.deepEqual(qs.slice(-2).map((q) => q.text), tirees.map((q) => q.text));
    assert.deepEqual(qs.slice(-2).map((q) => q.finale), [true, true]);
    assert.deepEqual(snapshot.facteurs, { [qs.at(-2).id]: 3 });
    // Rouverte : tout revient, dans le « Quiz complet ».
    await page.click("#show-edit-crumb");
    await page.locator(".show-card", { hasText: "Zoé" }).first().click();
    await deplierJeux(page);
    await compteur.filter({ hasText: /^21 questions/ }).waitFor();
    assert.equal(await round.locator(".quiz-series").count(), 0);
    await page.context().close();
  });

  test("Régie PC (cedric, 23 et 25/10) : en dernière ligne le « Quiz complet », tout dans l'ordre de passage : ↑ ↓, ✕, 🔀, l'ordre gardé jusqu'à la TV", async () => {
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
    // Pas de « Quiz complet » sans question.
    assert.equal(await round.locator(".quiz-complet").count(), 0);
    // Animaux de la bibliothèque, le Quiz de Lina (prestation archivée), puis Espace : à la suite.
    // (Plus de ligne « Intégrer un quiz de votre bibliothèque » depuis le 25/10 : une ancienne prestation peut en avoir.)
    await integrerQuiz(round, "animaux", "anim");
    await round.locator(".quiz-complet-voir", { hasText: "3 questions" }).waitFor();
    await round.locator(".quiz-rappel-cherche").fill("lina");
    await round.locator('.quiz-rappel-item[data-show="lina"]').click();
    await round.locator(".quiz-complet-voir", { hasText: "5 questions" }).waitFor();
    await integrerQuiz(round, "espace", "esp");
    // Le « Quiz complet » : juste sous le 🎲, ouvert d'office (cedric, 26/10) ; toutes les questions numérotées dans l'ordre
    // de passage, celle des bougies comprise (cedric, 23/10), d'office juste avant la Super Finale (3 dernières).
    assert.deepEqual(await round.locator(".round-body > *").evaluateAll((xs) => xs.map((x) => x.className)),
      ["quiz-outils", "serie quiz-complet", "quiz-finale"]);
    const complet = round.locator(".quiz-complet");
    const voir = complet.locator(".quiz-complet-voir");
    assert.equal(await voir.textContent(), "▾ 🧩 Quiz complet : 6 questions, dans l'ordre de passage");
    assert.equal(await complet.locator(".quiz-complet-liste").isHidden(), false);
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
    // ✕ : la question part du quiz (ici retirée du quiz de la bibliothèque, qui ne change pas).
    await complet.locator(".quiz-complet-q", { hasText: "Roi de la jungle" }).locator(".tirage-retirer").click();
    assert.deepEqual(await ordre(), ["Combien de pattes a une araignée ?", BOUGIES, "Quelle est la capitale de l'Italie ?", "Quelle planète est la plus proche du Soleil ?", "🔢 Combien de jours dans une semaine ?"]);
    assert.equal(await round.locator(".round-head > .quiz-compteur").textContent(), "4 questions, dont 3 en Super Finale, plus la question des bougies");
    // Les bougies se rangent à la main, comme les autres.
    await complet.locator(".quiz-complet-bougies .quiz-complet-monter").click();
    assert.deepEqual(await ordre(), [BOUGIES, "Combien de pattes a une araignée ?", "Quelle est la capitale de l'Italie ?", "Quelle planète est la plus proche du Soleil ?", "🔢 Combien de jours dans une semaine ?"]);
    // Glisser à la souris (cedric, 26/10), les flèches restent : la question posée en bas entre dans la Super Finale.
    const finales = () => complet.locator(".quiz-complet-q").evaluateAll((xs) => xs.map((x) => x.classList.contains("en-finale")));
    const ligne = (texte) => complet.locator(".quiz-complet-q", { has: page.locator(".tirage-texte", { hasText: texte }) });
    const poser = (a, b, bas) => glisser(ligne(a), ligne(b), bas);
    await poser("araignée", "jours dans une semaine", true);
    await waitFor(async () => (await ordre())[4] === "Combien de pattes a une araignée ?", "glissée en dernière place");
    assert.deepEqual(await ordre(), [BOUGIES, "Quelle est la capitale de l'Italie ?", "Quelle planète est la plus proche du Soleil ?", "🔢 Combien de jours dans une semaine ?", "Combien de pattes a une araignée ?"]);
    assert.deepEqual(await finales(), [false, false, true, true, true]);
    // Posée au-dessus de la première : en tête.
    await poser("planète", "Le Juste Chiffre", false);
    await waitFor(async () => (await ordre())[0] === "Quelle planète est la plus proche du Soleil ?", "glissée en tête");
    assert.deepEqual(await ordre(), ["Quelle planète est la plus proche du Soleil ?", BOUGIES, "Quelle est la capitale de l'Italie ?", "🔢 Combien de jours dans une semaine ?", "Combien de pattes a une araignée ?"]);
    assert.deepEqual(await finales(), [false, false, true, true, true]);
    // Les bougies se glissent aussi ; posées tout en bas, elles ne prennent pas une place de la Super Finale : elles passent juste avant.
    await poser("Le Juste Chiffre", "planète", false);
    await waitFor(async () => (await ordre())[0] === BOUGIES, "bougies en tête");
    await poser("Le Juste Chiffre", "araignée", true);
    await waitFor(async () => (await ordre())[1] === BOUGIES, "bougies glissées en bas");
    assert.deepEqual(await ordre(), ["Quelle planète est la plus proche du Soleil ?", BOUGIES, "Quelle est la capitale de l'Italie ?", "🔢 Combien de jours dans une semaine ?", "Combien de pattes a une araignée ?"]);
    assert.deepEqual(await finales(), [false, false, true, true, true]);
    assert.equal(await complet.locator(".quiz-complet-q").nth(1).locator(".quiz-complet-monter").isVisible(), true, "les flèches restent");
    // Quel que soit le mélange, les 3 dernières places restent la Super Finale (cedric, 26/10) : jamais les bougies.
    for (let essai = 0; essai < 12; essai++) {
      await complet.locator(".quiz-melanger").click();
      const fin = await complet.locator(".quiz-complet-q").evaluateAll((xs) => xs.slice(-3).map((x) => x.classList.contains("en-finale") && !x.classList.contains("quiz-complet-bougies")));
      assert.deepEqual(fin, [true, true, true], `mélange ${essai + 1}`);
    }
    // 🔀 : tout est mélangé, les bougies aussi (mais jamais dans la Super Finale).
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
    // Rouverte : le même ordre ; un nouveau tirage au 🎲 vient à la suite (cedric, 25/10), l'ordre rangé d'abord.
    await page.click("#show-edit-crumb");
    await page.locator(".show-card", { hasText: "Zoé" }).first().click();
    await deplierJeux(page);
    await voir.waitFor();
    assert.deepEqual(await ordre(), melange);
    await round.locator(".de-unique-champ").fill("libre");
    await round.locator(".de-unique").click();
    await waitFor(async () => (await ordre()).length === 13, "série du dé");
    const tout = await ordre();
    assert.equal(tout.length, 13);
    assert.deepEqual(tout.slice(0, 5), melange);
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
    // Ses séries (le quiz, puis les questions tirées) se voient dans le « Quiz complet » (cedric, 25/10), bougies comprises.
    assert.equal(await round.locator(".quiz-complet-voir").textContent(), "▾ 🧩 Quiz complet : 5 questions, dans l'ordre de passage");
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
    assert.equal(await statues.locator(".jeu-resume").textContent(), "musique de la fête");
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
    // Plus de durée à régler aux statues (cedric, 27/10) : chaque chanson se joue en entier.
    await page.locator("#show-rounds .round").nth(0).locator(".statues-chansons").waitFor();
    assert.equal(await page.locator("#show-rounds .round").nth(0).locator('select[aria-label="Durée"]').count(), 0);
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

  test("« ＋ Jeu » en pleine partie (cedric, 30/10) : une ligne par jeu, la carte de la Régie PC, « ← Retour » / « ✓ Envoyer au conducteur », « ✏️ Modifier » un jeu à venir ; scores et bibliothèque intacts", async () => {
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
    await givePoints(regie, "rose", 50);
    await waitFor(async () => (await read("state/scores/rose")) === 50, "50 points pour les Roses");
    const rounds = async () => (await read("conducteur")).questions.map((q) => q.round);

    // « ＋ Jeu » (cedric, 30/10) : une ligne par jeu ; le Quiz ouvre sa carte, celle de la Régie PC, en plein écran.
    await ouvrirConducteur(regie);
    await regie.click("#plan-add");
    // La liste se dessine juste après le toucher (CI plus lente) : on attend sa première ligne.
    await regie.locator("#lib-list .lib-jeu").first().waitFor();
    assert.deepEqual((await regie.locator("#lib-list .lib-jeu").evaluateAll((l) => l.map((b) => b.dataset.jeu))).slice(0, 3), ["quiz", "illustre", "mimes"]);
    assert.equal(await regie.locator("#lib-list", { hasText: "Quiz de la bibliothèque" }).count(), 0, "plus de « Quiz de la bibliothèque »");
    let cadre = await carteDuJeu(regie, "quiz");
    assert.equal(await regie.textContent("#carte-titre"), "Quiz");
    // « ← Retour » : rien n'est envoyé, retour à la liste des jeux.
    await regie.click("#carte-retour");
    await regie.locator("#carte").waitFor({ state: "hidden" });
    await regie.locator("#lib-list .lib-jeu").first().waitFor();
    assert.deepEqual(await rounds(), ["Animaux", "Animaux", "Animaux"]);
    // 🎲 de la carte, puis « ✓ Envoyer au conducteur » : juste après le jeu en cours.
    cadre = await carteDuJeu(regie, "quiz");
    await cadre.locator("select.de-nombre-unique").selectOption("3");
    await cadre.locator("button.de-unique").click();
    await cadre.locator(".quiz-compteur", { hasText: "3" }).waitFor();
    await capture(regie, "plus-jeu-carte-quiz");
    await cadre.locator(".quiz-complet-q").last().scrollIntoViewIfNeeded();
    await capture(regie, "plus-jeu-carte-quiz-questions");
    await regie.locator("#carte-envoyer:not([disabled])").click();
    await regie.locator("#r-toast", { hasText: "« Quiz » est ajouté après le jeu en cours." }).waitFor();
    assert.equal(await regie.locator("#carte").isHidden(), true);
    assert.equal(await regie.locator("#lib").isHidden(), true);
    assert.deepEqual(await rounds(), ["Animaux", "Animaux", "Animaux", "Quiz", "Quiz", "Quiz"]);
    assert.equal(await read("state/index"), 0, "La question en cours ne bouge pas");

    // La TV refuse : la carte reste ouverte, le réglage gardé, on renvoie.
    await regie.click("#plan-add");
    cadre = await carteDuJeu(regie, "patate");
    box.refuseNextProgram("current_round");
    await regie.locator("#carte-envoyer:not([disabled])").click();
    await regie.locator("#r-toast", { hasText: "La manche en cours ne peut pas changer" }).waitFor();
    assert.equal(await regie.locator("#carte").isHidden(), false, "la carte reste ouverte");
    await regie.locator("#carte-envoyer:not([disabled])").click();
    await regie.locator("#r-toast", { hasText: "« Ça va exploser ! » est ajouté après le jeu en cours." }).waitFor();
    assert.deepEqual(await rounds(), ["Animaux", "Animaux", "Animaux", ROUND_TYPES_TEST.patate, "Quiz", "Quiz", "Quiz"]);

    // Choix A : « ✏️ Modifier » un jeu à venir rouvre la même carte avec ses questions ; une retirée, il garde sa place.
    const avant = (await read("conducteur")).questions.filter((q) => q.round === "Quiz").map((q) => q.text);
    await modifierJeu(regie, "Quiz");
    cadre = regie.frameLocator("#carte-cadre");
    await cadre.locator(".quiz-compteur", { hasText: "3" }).waitFor();
    assert.equal(await regie.textContent("#carte-titre"), "✏️ Quiz");
    await cadre.locator(".quiz-complet button", { hasText: "✕" }).first().click();
    await cadre.locator(".quiz-compteur", { hasText: "2" }).waitFor();
    await regie.locator("#carte-envoyer:not([disabled])", { hasText: "Enregistrer dans le conducteur" }).click();
    await regie.locator("#r-toast", { hasText: "« Quiz » est modifié dans le conducteur." }).waitFor();
    assert.deepEqual(await rounds(), ["Animaux", "Animaux", "Animaux", ROUND_TYPES_TEST.patate, "Quiz", "Quiz"]);
    const apres = (await read("conducteur")).questions.filter((q) => q.round === "Quiz").map((q) => q.text);
    assert.deepEqual(apres, avant.slice(1), "les deux autres questions, dans le même ordre");

    // La manche en cours n'a ni flèches, ni « Retirer », ni « 🔁 Rejouer » (retiré par cedric, 30/10).
    assert.equal(await regie.locator('.plan-head[data-round="Animaux"] button:not(.plan-deplier)').count(), 0);
    await regie.click(`.plan-head[data-round="${ROUND_TYPES_TEST.patate}"] button.remove`);
    await respond(regie);
    await regie.locator("#r-toast", { hasText: `« ${ROUND_TYPES_TEST.patate} » est retirée du programme.` }).waitFor();
    await capture(regie, "plus-jeu-conducteur-modifier");
    // Un autre téléphone a changé le programme juste avant : la TV refuse, la régie le dit, rien ne bouge.
    box.refuseNextProgram("stale");
    await regie.click('.plan-head[data-round="Quiz"] button.remove');
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "Le programme venait de changer" }).waitFor();
    assert.deepEqual(await rounds(), ["Animaux", "Animaux", "Animaux", "Quiz", "Quiz"]);

    assert.equal(await read("state/scores/rose"), 50, "Scores gardés");
    const lib = await library("quizzes");
    assert.deepEqual(lib.dino, DINO, "Quiz de la bibliothèque inchangé");
    assert.deepEqual(lib.animaux, ANIMAUX);
    await regie.context().close();
  });

  test("« 📋 Conducteur » (cedric, 30/10) : dans « ☰ Plus », en plein écran ; jeux repliés, ▸ pour les questions ; appui long pour déplacer un jeu à venir", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const q = (id, round) => ({ id, text: `${id} ?`, choices: ["Oui", "Non"], correct: 0, duration: 20, kind: "classic", round });
    const plan = [q("a1", "Jeu A"), q("b1", "Jeu B"), q("b2", "Jeu B"), q("c1", "Jeu C"), q("d1", "Jeu D")];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", questions: plan });
    await box.set({ ...questionState(4), index: 0, qid: "a1", text: "a1 ?", choices: ["Oui", "Non"], total: plan.length });
    const regie = await openRegie(await contexteSansChoix({ viewport: { width: 390, height: 760 } }));
    await pair(regie);
    await inRegie(regie);
    // Plus d'onglet « Conducteur » : un bouton de « ☰ Plus » ouvre sa page.
    assert.equal(await regie.locator("#tab-plan").isHidden(), true);
    await ouvrirConducteur(regie);
    assert.equal(await regie.locator("#plus").isHidden(), true);
    const ordre = async () => [...new Set((await read("conducteur")).questions.map((x) => x.round))];
    const jeu = (titre) => regie.locator(".plan-jeu", { has: regie.locator(`.plan-head[data-round="${titre}"]`) });
    // Tous repliés ; ▸ déplie les questions d'un jeu, ▾ les replie.
    assert.equal(await regie.locator(".plan-questions:not([hidden])").count(), 0);
    await jeu("Jeu B").locator(".plan-deplier").click();
    await jeu("Jeu B").locator(".plan-item", { hasText: "b2 ?" }).waitFor();
    assert.equal(await jeu("Jeu B").locator(".plan-deplier .fleche").textContent(), "▾");
    await jeu("Jeu B").locator(".plan-deplier").click();
    await jeu("Jeu B").locator(".plan-questions").waitFor({ state: "hidden" });
    // Plus de flèches ↑ ↓ ; la ligne : ▸ et le nom, « Retirer » en rouge, ▶ ; le jeu en cours n'a que son nom.
    assert.equal(await regie.locator(".plan-head button.up, .plan-head button.down").count(), 0);
    assert.deepEqual(await regie.locator('.plan-head[data-round="Jeu B"] > button').evaluateAll((xs) => xs.map((x) => [x.className, x.textContent])),
      [["plan-deplier", "▸Jeu B"], ["remove", "Retirer"], ["go", "▶"]]);
    assert.equal(await regie.locator('.plan-head[data-round="Jeu A"] button:not(.plan-deplier)').count(), 0);
    await capture(regie, "conducteur-replie");
    // Un glissement simple ne déplace rien.
    const tete = (titre) => regie.locator(`.plan-head[data-round="${titre}"] .plan-deplier`);
    let boite = await tete("Jeu D").boundingBox();
    await regie.mouse.move(boite.x + 30, boite.y + boite.height / 2);
    await regie.mouse.down();
    await regie.mouse.move(boite.x + 30, boite.y - 80, { steps: 5 });
    await regie.mouse.up();
    await regie.waitForTimeout(600);
    assert.deepEqual(await ordre(), ["Jeu A", "Jeu B", "Jeu C", "Jeu D"]);
    // Appui long sur « Jeu D », glissé au-dessus de « Jeu B », lâché : il passe juste après le jeu en cours.
    boite = await tete("Jeu D").boundingBox();
    const cible = await tete("Jeu B").boundingBox();
    await regie.mouse.move(boite.x + 30, boite.y + boite.height / 2);
    await regie.mouse.down();
    await regie.waitForTimeout(700);
    await regie.locator(".plan-jeu.souleve").waitFor();
    await regie.mouse.move(boite.x + 30, cible.y - 4, { steps: 12 });
    await capture(regie, "conducteur-glisse");
    await regie.mouse.up();
    await regie.locator("#r-toast", { hasText: "« Jeu D » est avancé de 2 places." }).waitFor();
    assert.deepEqual(await ordre(), ["Jeu A", "Jeu D", "Jeu B", "Jeu C"]);
    assert.equal(await regie.locator(".plan-questions:not([hidden])").count(), 0, "le lâcher ne déplie rien");
    // Le jeu en cours ne se soulève pas.
    boite = await tete("Jeu A").boundingBox();
    await regie.mouse.move(boite.x + 30, boite.y + boite.height / 2);
    await regie.mouse.down();
    await regie.waitForTimeout(700);
    assert.equal(await regie.locator(".plan-jeu.souleve").count(), 0);
    await regie.mouse.up();
    // « Retirer » : « Êtes-vous sûr ? » Oui / Non ; Non ne retire rien, Oui le retire.
    await regie.click('.plan-head[data-round="Jeu C"] button.remove');
    assert.match(await respond(regie, false), /^Êtes-vous sûr \?/);
    assert.deepEqual(await ordre(), ["Jeu A", "Jeu D", "Jeu B", "Jeu C"]);
    await regie.click('.plan-head[data-round="Jeu C"] button.remove');
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "« Jeu C » est retirée du programme." }).waitFor();
    assert.deepEqual(await ordre(), ["Jeu A", "Jeu D", "Jeu B"]);
    // « ← Retour » : la régie.
    await regie.click("#conducteur-retour");
    await regie.locator("#conducteur").waitFor({ state: "hidden" });
    await regie.context().close();
  });

  test("jeux sautés avec ▶ (cedric, 30/10) : ils gardent la couleur « pas encore joué » ; pendant le bilan du dernier jeu, Sarah en remet un juste après et « Jeu suivant » y va", async () => {
    box = startBox({ enchaine: true });
    await addTeam("rose", "Les Roses");
    const q = (id, round) => ({ id, text: `${id} ?`, choices: ["Oui", "Non"], correct: 0, duration: 20, kind: "classic", round });
    const plan = [q("a1", "Jeu A"), q("b1", "Jeu B"), q("c1", "Jeu C"), q("d1", "Jeu D")];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", questions: plan });
    // Sarah a sauté B et C avec ▶ : D (le dernier) est en cours.
    await box.set({ ...questionState(4), phase: "reveal", index: 3, qid: "d1", text: "d1 ?", choices: ["Oui", "Non"], total: 4, scores: { rose: 50 } });
    const regie = await openRegie(await contexteSansChoix({ viewport: { width: 390, height: 760 } }));
    await pair(regie);
    await inRegie(regie);
    await ouvrirConducteur(regie);
    const jeu = (titre) => regie.locator(`.plan-jeu:has(> .plan-head[data-round="${titre}"])`);
    // TV d'avant (sans la liste des jeux commencés) : tout ce qui précède le jeu en cours compte comme joué.
    await jeu("Jeu B").and(regie.locator(".joue")).waitFor();
    assert.equal(await jeu("Jeu B").locator("button.edit, button.remove").count(), 0);
    // TV à jour : B et C n'ont jamais commencé, ils gardent la couleur « pas encore joué », sans étiquette.
    await box.set({ jeuxCommences: ["a1", "d1"], seq: (await read("state")).seq + 1 });
    await jeu("Jeu B").and(regie.locator(".a-jouer")).waitFor();
    await jeu("Jeu C").and(regie.locator(".a-jouer")).waitFor();
    await jeu("Jeu A").and(regie.locator(".joue")).waitFor();
    await jeu("Jeu D").and(regie.locator(".en-cours")).waitFor();
    assert.equal(await regie.locator("#panel-plan .state").count(), 0, "pas d'étiquette « jouée » / « à venir »");
    await capture(regie, "conducteur-jeux-sautes");
    // Au bilan du dernier jeu, la suite c'est le podium… Sarah remet B juste après D (appui long, glissé dessous).
    await box.set({ phase: "scores", seq: (await read("state")).seq + 1 });
    await regie.locator("#c-next", { hasText: "Résultats finaux 🏆" }).waitFor({ state: "attached" });
    const tete = (titre) => regie.locator(`.plan-head[data-round="${titre}"] .plan-deplier`);
    const boite = await tete("Jeu B").boundingBox();
    const cible = await tete("Jeu D").boundingBox();
    await regie.mouse.move(boite.x + 30, boite.y + boite.height / 2);
    await regie.mouse.down();
    await regie.waitForTimeout(700);
    await regie.locator(".plan-jeu.souleve").waitFor();
    await regie.mouse.move(boite.x + 30, cible.y + cible.height + 30, { steps: 12 });
    await regie.mouse.up();
    await regie.locator("#r-toast", { hasText: "« Jeu B » est reculé de 2 places." }).waitFor();
    assert.deepEqual((await read("conducteur")).questions.map((x) => x.id), ["a1", "c1", "d1", "b1"]);
    assert.equal(await read("state/index"), 2, "la TV recale le jeu en cours");
    // Tout de suite : « Jeu suivant : Jeu B », et la TV y va.
    await regie.click("#conducteur-retour");
    await regie.locator("#c-next", { hasText: "Jeu suivant : Jeu B ▶" }).click();
    await waitFor(async () => (await read("state/qid")) === "b1", "la TV enchaîne sur le jeu B");
    assert.equal((await read("state")).scores.rose, 50);
    await regie.context().close();
  });

  test("voyant de chaque jeu du conducteur (cedric, 30/10) : vert chargé dans la box, orange en chargement, rouge il en manque ; ▶ sur un jeu pas chargé demande « Lancer quand même ? »", async () => {
    box = startBox();
    await addTeam("rose", "Les Roses");
    const q = (id, round, extra = {}) => ({ id, text: `${id} ?`, choices: ["Oui", "Non"], correct: 0, duration: 20, kind: "classic", round, ...extra });
    const SON = "0123456789abcdef";
    const PHOTO = "fedcba9876543210";
    const plan = [q("a1", "Jeu A"), q("b1", "Jeu B", { audioId: SON }), q("c1", "Jeu C", { imageId: PHOTO }), q("d1", "Jeu D")];
    await set(gameRef("conducteur"), { id: "lea", title: "Léa", rev: "r1", blind: true, questions: plan });
    await box.set({ ...questionState(4), index: 0, qid: "a1", text: "a1 ?", choices: ["Oui", "Non"], total: plan.length });
    const regie = await openRegie(await contexteSansChoix({ viewport: { width: 390, height: 760 } }));
    await pair(regie);
    await inRegie(regie);
    await ouvrirConducteur(regie);
    const voyants = () => regie.locator(".plan-head").evaluateAll((xs) => xs.map((x) => x.dataset.voyant));
    const media = (valeurs) => env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), `games/${CODE}/media`), valeurs));
    // Rien de marqué : le son en chargement ; une box qui ne marque pas les photos ne les compte pas.
    await waitFor(async () => (await voyants()).join() === "vert,orange,vert,vert", "son pas encore marqué : orange");
    await media({ [SON]: "missing", [PHOTO]: "loading" });
    await waitFor(async () => (await voyants()).join() === "vert,rouge,orange,vert", "son manquant : rouge ; photo en chargement : orange");
    await capture(regie, "conducteur-voyants");
    // ▶ sur un jeu rouge : jamais bloqué, mais la confirmation dit « Lancer quand même ? » ; Non : rien n'est envoyé.
    await regie.click('.plan-head[data-round="Jeu B"] button.go');
    await regie.locator("#ask-warn:not([hidden])", { hasText: "Ce jeu n'est pas encore chargé dans la box" }).waitFor();
    await capture(regie, "conducteur-pas-charge");
    assert.match(await respond(regie, false), /^Êtes-vous sûr \?/);
    await regie.waitForTimeout(300);
    assert.equal(box.gotos.length, 0);
    await regie.click('.plan-head[data-round="Jeu B"] button.go');
    assert.match(await respond(regie), /^Êtes-vous sûr \?/);
    await waitFor(async () => box.gotos.length === 1, "la TV va au jeu B");
    // La TV accepte : la régie referme le conducteur d'elle-même. On attend qu'il soit fermé avant de le rouvrir
    // (sur la CI, plus lente, il se refermait juste après qu'on l'avait rouvert).
    await regie.locator("#conducteur").waitFor({ state: "hidden" });
    // Tout chargé : vert, ▶ ne demande que « Êtes-vous sûr ? ».
    await media({ [SON]: "ok", [PHOTO]: "ok" });
    await ouvrirConducteur(regie);
    await waitFor(async () => (await voyants()).join() === "vert,vert,vert,vert", "tout chargé : vert");
    await regie.click('.plan-head[data-round="Jeu C"] button.go');
    await regie.locator("#ask:not([hidden])").waitFor();
    assert.equal(await regie.locator("#ask-warn").isHidden(), true, "chargé : pas d'avertissement");
    assert.match(await respond(regie, false), /^Êtes-vous sûr \?/);
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

    // Régie du téléphone : la prestation d'il y a 3 jours n'est plus proposée.
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
    await ouvrirConducteur(regie);
    await regie.click("#plan-add");
    // « ＋ Jeu » (cedric, 30/10) : une ligne par jeu, plus les jeux des prestations épinglées (« Rappeler un ancien
    // anniversaire » est dans la carte de chaque jeu).
    await regie.locator("#lib-list .lib-jeu").first().waitFor();
    assert.equal(await regie.locator("#lib-list .lib-jeu").count(), 18);
    assert.equal(await regie.locator("#lib-list", { hasText: "Prestations épinglées" }).count(), 0);
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
    // « Enregistrer » cliqué tout de suite après « Valider » (CI, 30/10) : il attend que l'image recadrée soit rangée.
    await page.evaluate(() => {
      [...document.querySelectorAll(".cadre-boite button")].find((b) => b.textContent.includes("Valider le cadrage")).click();
      document.getElementById("rv-save").click();
    });
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
    await page.locator("#rv-status", { hasText: "Enregistré : 11 questions." }).waitFor();
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
    assert.equal(await page.locator('[data-q="0"] .illustration .tag.missing').isHidden(), true);
    await page.locator('[data-q="1"] .illustration .tag.missing:not([hidden])', { hasText: "Image manquante : ajoutez une illustration." }).waitFor();
    assert.equal(await page.locator('[data-q="1"] .case-manquante:not([hidden])').count(), 0, "question en texte : pas d'alerte sur ses réponses");
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

  test("De bout en bout (cedric, 26/10 : « que ça ne revienne jamais ») : les images d'un pack ZIP, tirées au 🎲 au Quiz illustré, au Zoom mystère, à l'Image floue et au Vrai ou Faux express, partent dans le programme de la TV et sont copiées dans la partie", async () => {
    // Des couleurs bien différentes : jamais prises pour des doublons à l'import.
    const COULEURS = [[230, 30, 30], [30, 200, 40], [30, 60, 230], [240, 220, 20], [200, 30, 200], [20, 210, 220], [250, 140, 0], [120, 60, 20],
      [255, 255, 255], [0, 0, 0], [130, 130, 130], [90, 0, 140], [0, 110, 70], [255, 170, 200]];
    let c = 0;
    const image = () => png(COULEURS[c++]);
    const heros = (text, noms, correct) => ({ text, choices: noms.map((n) => ({ text: n, image: `${n.toLowerCase()}.png` })), correct });
    const ILLUSTRE = { title: "Héros illustrés", theme: "Marvel", niveau: "Facile", questions: [
      heros("Qui est l'archer des Avengers ?", ["Faucon", "Thor", "Hulk", "Vision"], 0),
      heros("Qui a un bouclier ?", ["Captain", "Loki", "Groot", "Rocket"], 0)] };
    const VF = { title: "Héros vrai ou faux", theme: "Marvel", niveau: "Facile", questions: [
      { text: "Hulk est vert.", choices: ["Vrai", "Faux"], correct: 0, illustration: "hulk-vf.png" },
      { text: "Thor a un bouclier.", choices: ["Vrai", "Faux"], correct: 1, illustration: "thor-vf.png" }] };
    const entrees = [["illus/pack.json", JSON.stringify(ILLUSTRE)], ...ILLUSTRE.questions.flatMap((q) => q.choices.map((x) => [`illus/${x.image}`, image()])),
      ["photos/pack.json", JSON.stringify({ title: "Héros en photo", theme: "Marvel", niveau: "Facile" })],
      ...["iron-man", "spider-man", "black-widow", "star-lord"].map((n) => [`photos/${n}.png`, image()]),
      ["vf/pack.json", JSON.stringify(VF)], ["vf/hulk-vf.png", image()], ["vf/thor-vf.png", image()]];
    assert.equal(c, COULEURS.length);

    // 1. L'import du ZIP dans la Régie PC.
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="questions"]');
    await page.click('#q-groups [data-groupe="packs"]');
    await page.locator("#pack-import:not([hidden])").waitFor();
    await page.setInputFiles("#pack-file", { name: "marvel.zip", mimeType: "application/zip", buffer: Buffer.from(faireZip(entrees)) });
    await page.locator("dialog[data-fenetre][open] .pack-apercu-vignettes img").first().waitFor();
    assert.doesNotMatch(await page.locator("dialog[data-fenetre][open]").innerText(), /Image manquante|image absente|introuvable|Pas importé|n'est pas importée/, "aucune image manquante");
    assert.equal(await repondreFenetre(page), "Importer ces 3 packs ?");
    await page.locator("#pack-status", { hasText: /^✓ 3 packs importés, 14 images\.$/ }).waitFor();
    const packs = Object.values(await library("quizzes"));
    assert.deepEqual(packs.map((q) => [q.title, q.kind]).sort(), [["Héros en photo", "images"], ["Héros illustrés", "photo"], ["Héros vrai ou faux", "classique"]]);
    const bibliotheque = await library("images");
    assert.equal(Object.keys(bibliotheque).length, 14);

    // 2. Une prestation : chaque jeu tire au 🎲 dans « mes packs ».
    await page.click("#nav button[data-screen=home]");
    await page.click("#home-new");
    await page.fill("#show-child", "Lauren");
    await page.fill("#show-age", "6");
    await aVenir(page);
    const tirer = async (jeu, k, n, attendu) => {
      await ajouterJeu(page, jeu);
      const round = page.locator("#show-rounds .round").nth(k);
      await round.locator(".de-unique-champ").fill("mes packs");
      await round.locator("select.de-nombre-unique").selectOption(`${n}`);
      await round.locator(".de-unique").click();
      await round.locator(".round-head > .quiz-compteur").filter({ hasText: attendu }).waitFor();
    };
    await tirer("illustre", 0, 2, /^2 questions/);
    await tirer("zoom", 1, 2, "2 cartes à deviner");
    await tirer("flou", 2, 2, "2 cartes à deviner");
    await tirer("express", 3, 2, /^2 affirmations/);
    assert.equal(await page.locator(".alerte-sans-images").count(), 0);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "Enregistrée" }).waitFor();
    await page.context().close();

    // 3. Lancée depuis la régie du téléphone, sur la box.
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator(".show-item", { hasText: "Lauren" }).click();
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor();
    const questions = (await read("show")).quiz.questions;
    const ID = /^[0-9a-f]{16}$/;
    const parSorte = (kind) => questions.filter((q) => q.kind === kind);
    // Le programme : chaque question du Quiz illustré a une photo par réponse ; chaque photo et chaque affirmation, la sienne.
    const illustrees = parSorte("classic");
    assert.deepEqual(illustrees.map((q) => q.text).sort(), ILLUSTRE.questions.map((q) => q.text).sort());
    for (const q of illustrees) {
      assert.equal(q.choiceImages?.length, 4, q.text);
      assert.ok(q.choiceImages.every((id) => ID.test(id) && bibliotheque[id]), q.text);
    }
    assert.equal(new Set(illustrees.flatMap((q) => q.choiceImages)).size, 8);
    const photos = [...parSorte("zoom"), ...parSorte("flou"), ...parSorte("express")];
    assert.deepEqual([parSorte("zoom").length, parSorte("flou").length, parSorte("express").length], [2, 2, 2]);
    for (const q of photos) assert.ok(ID.test(q.imageId ?? "") && bibliotheque[q.imageId], `${q.kind} : ${q.text}`);
    assert.equal(new Set(photos.map((q) => q.imageId)).size, 6, "jamais deux fois la même photo");
    // Et chaque image copiée dans la partie, telle quelle : les réponses là où les tablettes les lisent, les photos avec les illustrations.
    await waitFor(async () => Object.keys((await read("choiceImages")) ?? {}).length === 8, "les 8 réponses en images copiées dans la partie");
    await waitFor(async () => Object.keys((await read("images")) ?? {}).length === 6, "les 6 photos copiées dans la partie");
    const copiees = { ...(await read("choiceImages")), ...(await read("images")) };
    for (const id of [...illustrees.flatMap((q) => q.choiceImages), ...photos.map((q) => q.imageId)]) assert.equal(copiees[id], bibliotheque[id], id);
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

    // Aperçu (cedric, 25/10) : chaque rubrique repliée sur une ligne, son nom et son nombre ; ▸ la déplie, ▾ la replie.
    await page.locator('.q-groupe.replie[data-groupe="classiques"] .q-plier', { hasText: "▸" }).waitFor();
    assert.equal(await page.locator("#q-list .q-item, #q-list .pack").count(), 0, "tout est replié à l'arrivée");
    await capture(page, "questions-repliees");
    assert.match(await page.locator('.q-groupe[data-groupe="miennes"] .q-plier h2').innerText(), /\(2\)$/);
    await page.locator('.q-groupe[data-groupe="classiques"] .q-plier').click();
    await page.locator('.q-groupe.ouvert[data-groupe="classiques"] .q-item').first().waitFor();
    await page.locator('.q-groupe[data-groupe="classiques"] .q-plier', { hasText: "▾" }).click();
    await page.locator('.q-groupe.replie[data-groupe="classiques"]').waitFor();
    assert.equal(await page.locator('.q-groupe[data-groupe="classiques"] .q-item').count(), 0);
    for (const k of ["illustrees", "miennes", "packs"]) await page.locator(`.q-groupe[data-groupe="${k}"] .q-plier`).click();
    // Avec l'alerte sur ce qui n'a pas d'illustration.
    await page.locator('.q-groupe[data-groupe="illustrees"] .q-item').first().waitFor();
    await page.locator('.q-groupe[data-groupe="miennes"] .q-item[data-question="mien/0"] .q-illus.emoji', { hasText: "☁️" }).waitFor();
    await page.locator('.q-groupe[data-groupe="miennes"] .q-item.sans-illus[data-question="mien/1"] .q-alerte', { hasText: "⚠ Pas d'illustration" }).waitFor();
    await page.locator('.q-groupe[data-groupe="packs"] .pack[data-pack~="animaux"]', { hasText: "⚠ 3 sans illustration" }).waitFor();
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

    // Mes packs : un seul ZIP (cedric, 25/10) avec deux packs et une image ; une image nommée manque.
    await page.click('#q-groups [data-groupe="packs"]');
    await page.locator("#pack-import:not([hidden])").waitFor();
    assert.equal(await page.locator("#pack-import").getByText("📦 Importer un pack ZIP").count(), 1);
    assert.doesNotMatch(await page.locator("#pack-import").innerText(), /JSON/, "plus de « JSON » dans les mots de l'import");
    const PACKS = { packs: [
      { title: "Les animaux de la savane", theme: "Animaux", famille: "Animaux et nature", niveau: "Facile", questions: [
        { text: "Quel animal a une très longue trompe ?", choices: ["Éléphant", "Girafe", "Lion", "Zèbre"], correct: 0, illustration: "🐘" },
        { text: "Quel animal est le roi de la savane ?", choices: ["Hippopotame", "Lion", "Gazelle", "Autruche"], correct: 1, illustration: "lion.png" },
        { text: "Combien de pattes a une girafe ?", correct: 4, illustration: "🦒" },
        { text: "Quel animal a des rayures ?", choices: ["Zèbre", "Lion"], correct: 0, illustration: "zebre.png" },
        { text: "Sans réponses" },
      ] },
      { title: "Espace", theme: "Sciences", questions: [{ text: "Quelle planète est rouge ?", choices: ["Mars", "Vénus"], correct: "Mars" }] },
    ] };
    // D'abord un ZIP abîmé : expliqué, rien d'enregistré.
    const avant = Object.keys(await library("quizzes")).length;
    await page.setInputFiles("#pack-file", { name: "casse.zip", mimeType: "application/zip", buffer: Buffer.from("pas un zip du tout") });
    assert.match(await repondreFenetre(page), /Ce ZIP ne peut pas être importé\.[\s\S]*pas un ZIP lisible[\s\S]*Rien n'a été enregistré\./);
    assert.equal(Object.keys(await library("quizzes")).length, avant);
    await page.setInputFiles("#pack-file", { name: "savane.zip", mimeType: "application/zip", buffer: Buffer.from(faireZip([
      ["Savane/savane.json", JSON.stringify(PACKS)], ["Savane/lion.png", png([200, 160, 60]), { stocke: true }], ["Savane/liste.txt", "relecture"],
    ])) });
    const apercuPacks = page.locator("dialog[data-fenetre][open]");
    await apercuPacks.locator(".pack-apercu-vignettes img").first().waitFor();
    const texteApercu = await apercuPacks.innerText();
    assert.match(texteApercu, /Les animaux de la savane\s+Quiz · 4 questions/);
    // Deux thèmes différents : le choix global laisse le thème de chaque pack.
    assert.equal(await apercuPacks.locator(".pack-theme-global select.pack-theme option:checked").textContent(), "— Le thème de chaque pack —");
    assert.equal(await apercuPacks.locator(".pack-theme-global .pack-theme-etat").isHidden(), true);
    assert.match(texteApercu, /Question 4 : Image manquante : ajoutez une illustration\./);
    assert.match(texteApercu, /Question 5 : ni propositions ni nombre à trouver, elle n'est pas importée\./);
    assert.match(texteApercu, /Laissé de côté : liste\.txt\./);
    // Thème et niveau (cedric, 25/10) : la Régie propose un de ses thèmes (« Animaux » existe déjà) ou un nouveau
    // (« Sciences »), modifiable ; « Espace » ne dit pas son niveau, l'import le demande.
    const etiquettesDe = (titre) => apercuPacks.locator(".pack-apercu-pack").filter({ has: page.locator("h3", { hasText: new RegExp(`^${titre}$`) }) });
    const savaneTheme = etiquettesDe("Les animaux de la savane");
    assert.deepEqual([await savaneTheme.locator("select.pack-theme").inputValue(), await savaneTheme.locator(".pack-theme-etat").textContent()], ["Animaux", "existant"]);
    assert.equal(await savaneTheme.locator(".pack-theme-nom").isHidden(), true);
    assert.equal(await savaneTheme.locator("select.pack-niveau").inputValue(), "Facile");
    const espaceTheme = etiquettesDe("Espace");
    assert.deepEqual([await espaceTheme.locator(".pack-theme-nom").inputValue(), await espaceTheme.locator(".pack-theme-etat").textContent()], ["Sciences", "nouveau"]);
    // La Régie s'est trompée ? Un nouveau thème au nom d'un thème déjà là y range le pack ; ici on garde « Sciences ».
    await espaceTheme.locator(".pack-theme-nom").fill("animaux");
    assert.equal(await espaceTheme.locator(".pack-theme-etat").textContent(), "existant");
    await espaceTheme.locator(".pack-theme-nom").fill("Sciences");
    await espaceTheme.locator(".pack-etiquettes-manque", { hasText: "Le pack ne dit pas le niveau : choisissez-le ici." }).waitFor();
    await capture(page, "pack-theme-apercu", { pleinePage: false });
    await apercuPacks.locator("[data-fenetre-ok]").click();
    await apercuPacks.locator(".fenetre-manque", { hasText: "Choisissez le niveau de « Espace » avant d'enregistrer." }).waitFor();
    assert.equal(await apercuPacks.isVisible(), true, "rien n'est enregistré tant qu'il manque le niveau");
    assert.equal(Object.keys(await library("quizzes")).length, avant);
    await etiquettesDe("Espace").locator("select.pack-niveau").selectOption("Moyen");
    await etiquettesDe("Espace").locator(".pack-etiquettes-manque").waitFor({ state: "hidden" });
    assert.equal(await repondreFenetre(page), "Importer ces 2 packs ?");
    await page.locator("#pack-status", { hasText: /^✓ 2 packs importés(, \d+ images?)?\. 1 image manquante : ajoutez-les dans « Éditer »\.$/ }).waitFor();
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
    assert.deepEqual([savane.famille, savane.niveau, savane.ageMin, savane.ageMax], ["Animaux et nature", "Facile", 5, 8], "sa famille gardée, sans rien ranger");
    assert.deepEqual([espace.famille ?? null, espace.niveau, espace.ageMin, espace.ageMax], [null, "Moyen", 9, 11]);
    assert.deepEqual(quizzes.animaux, ANIMAUX, "les autres quiz ne bougent pas");
    // Les packs importés à l'instant sont encadrés, leurs thèmes ouverts ; les packs sont rangés par thème (cedric,
    // 25/10), dans l'ordre alphabétique, avec leurs pastilles de niveau : l'ancien quiz « Animaux » et la savane ensemble.
    await page.locator(`.pack.copie-recente[data-pack~="${idSavane}"]`).waitFor();
    assert.deepEqual(await page.locator(".q-theme .q-plier h2").allInnerTexts(), ["🎨 Animaux (2)", "🎨 Sciences (1)"]);
    await page.locator(`.q-theme[data-theme="Animaux"] .pack[data-pack~="${idSavane}"] .pack-niveau[data-niveau="Facile"]`).waitFor();
    await page.locator(`.q-theme[data-theme="Animaux"] .pack[data-pack~="animaux"]`).waitFor();
    await page.locator(`.q-theme[data-theme="Sciences"] .pack[data-pack~="${idEspace}"] .pack-niveau[data-niveau="Moyen"]`).waitFor();
    await capture(page, "packs-par-theme");
    // ✎ Renommer : « sciences et espace » devient le thème ; puis le nom d'un autre thème l'y range (fusion).
    await page.locator('.q-theme[data-theme="Sciences"] .theme-renommer').click();
    await repondreFenetre(page, { texte: "Sciences et espace" });
    await page.locator('.q-theme[data-theme="Sciences et espace"]').waitFor();
    assert.equal((await library(`quizzes/${idEspace}`)).theme, "Sciences et espace");
    await page.locator('.q-theme[data-theme="Sciences et espace"] .theme-renommer').click();
    await repondreFenetre(page, { texte: "ANIMAUX" });
    await page.locator('.q-theme[data-theme="Animaux"] .q-plier h2', { hasText: "🎨 Animaux (3)" }).waitFor();
    assert.equal((await library(`quizzes/${idEspace}`)).theme, "Animaux");
    await page.locator('.q-theme[data-theme="Animaux"] .theme-renommer').click();
    await repondreFenetre(page, { accepter: false });
    // Une puce par niveau : « Facile » garde la savane et l'ancien quiz de 6 à 8 ans (son niveau vient de ses âges).
    await page.click('.q-niveaux-packs [data-niveau="Facile"]');
    assert.deepEqual(await page.locator(".q-theme .q-plier h2").allInnerTexts(), ["🎨 Animaux (2)"]);
    await page.click('.q-niveaux-packs [data-niveau="tous"]');
    await page.locator(`.pack[data-pack~="${idEspace}"]`).waitFor();

    // Un thème se montre en blocs, un par jeu et par niveau (cedric, 26/10 : plus de « Disney 1, Disney 2… ») : la savane
    // et l'ancien quiz « Animaux » (Facile tous les deux) n'en font qu'un, ses questions à la suite.
    assert.deepEqual(await page.locator('.q-theme[data-theme="Animaux"] .pack-bloc').evaluateAll((xs) => xs.map((x) => x.dataset.pack)), [`animaux ${idSavane}`, idEspace]);
    await page.locator(`.pack[data-pack~="${idSavane}"]`, { hasText: "⚠ 4 sans illustration" }).getByRole("button", { name: "Ouvrir" }).click();
    await page.locator("#q-list h2", { hasText: "Animaux · Quiz classique · Facile" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Éditer le pack" }).count(), 0, "deux packs : chaque question a son « Éditer »");
    // Sans image hors format, rien d'écrit à la place de leur liste (cedric, 26/10 : « null » au-dessus des questions).
    assert.equal(await page.locator("#q-list").evaluate((el) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())), false);
    assert.equal(await page.locator("#pack-import").isHidden(), true);
    assert.equal(await page.locator("#q-list .q-item").count(), 4 + ANIMAUX.questions.length);
    await page.locator(`.q-item[data-question="${idSavane}/0"] .q-illus.emoji`, { hasText: "🐘" }).waitFor();
    await page.locator(`.q-item[data-question="${idSavane}/1"] img.q-illus[src^="data:image"]`).waitFor();
    await page.locator(`.q-item[data-question="${idSavane}/2"] .q-nombre`, { hasText: "réponse : 4" }).waitFor();
    await page.locator(`.q-item.sans-illus[data-question="${idSavane}/3"] .q-illus.vide`).waitFor();
    await page.locator(`.q-item.sans-illus[data-question="${idSavane}/3"] .q-alerte`, { hasText: "⚠ Pas d'illustration" }).waitFor();
    assert.equal(await page.locator(".q-item.sans-illus").count(), 4);
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
    await page.locator("#q-selection-n", { hasText: `${4 + ANIMAUX.questions.length} questions cochées` }).waitFor();
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
    assert.equal(await page.locator("#q-list .q-item").count(), 2 + ANIMAUX.questions.length);

    // Un bloc d'un seul pack : « Éditer le pack », la relecture habituelle du quiz.
    await page.click('#q-groups [data-groupe="packs"]');
    await page.locator(`.pack[data-pack~="${idEspace}"]`).getByRole("button", { name: "Ouvrir" }).click();
    await page.locator("#q-list h2", { hasText: "Animaux · Quiz classique · Moyen" }).waitFor();
    await page.getByRole("button", { name: "Éditer le pack" }).click();
    await page.locator("#screen-review:not([hidden])").waitFor();
    assert.equal(await page.locator("#rv-title").inputValue(), "Espace");
    // Son thème et son niveau se corrigent ici (cedric, 25/10) ; plus de famille à choisir.
    assert.equal(await page.locator("#rv-theme").inputValue(), "Animaux");
    assert.equal(await page.locator("#rv-famille-champ").isHidden(), true);
    assert.equal(await page.locator("#rv-niveau").inputValue(), "Moyen");
    await page.goBack();
    await page.locator("#library-questions:not([hidden])").waitFor();

    // Supprimer un bloc (fenêtre de la Régie PC) : ses packs seulement, le reste du thème ne bouge pas.
    await page.click('#q-groups [data-groupe="packs"]');
    await page.locator(`.pack[data-pack~="${idEspace}"]`).getByRole("button", { name: "Supprimer" }).click();
    assert.match(await repondreFenetre(page), /^Supprimer « Animaux · Quiz classique · Moyen » \?/);
    await waitFor(async () => (await library(`quizzes/${idEspace}`)) === null, "pack supprimé");
    await page.locator(`.pack[data-pack~="${idEspace}"]`).waitFor({ state: "detached" });
    assert.ok(await library(`quizzes/${idSavane}`), "le reste du thème ne bouge pas");
    await page.context().close();
  });

  test("Image à fond transparent (cedric, 25/10) : rangée en 4:3 (carrée pour une case), le sujet en grand, sur un fond Game Show qui contraste ; une photo opaque ne change pas", async () => {
    const page = await admin();
    const r = await page.evaluate(async () => {
      const { compressImage, CHOICE_IMAGE } = await import("/illustration.js");
      // Une petite étoile jaune dans un coin d'une grande image transparente ; une photo opaque.
      const dessin = (w, h, f) => { const c = Object.assign(document.createElement("canvas"), { width: w, height: h }); f(c.getContext("2d")); return new Promise((ok) => c.toBlob(ok, "image/png")); };
      const etoile = await dessin(1600, 900, (x) => { x.fillStyle = "#ffe600"; x.fillRect(1000, 200, 200, 200); });
      const opaque = await dessin(600, 300, (x) => { x.fillStyle = "#3080c0"; x.fillRect(0, 0, 600, 300); });
      const lire = async (url) => {
        const b = await createImageBitmap(await (await fetch(url)).blob());
        const c = Object.assign(document.createElement("canvas"), { width: b.width, height: b.height });
        const x = c.getContext("2d");
        x.drawImage(b, 0, 0);
        const px = (u, v) => [...x.getImageData(Math.round(u * b.width), Math.round(v * b.height), 1, 1).data.slice(0, 3)];
        return { taille: [b.width, b.height], centre: px(0.5, 0.5), coin: px(0.02, 0.02), gauche: px(0.25, 0.5) };
      };
      return { grande: await lire(await compressImage(etoile)), cas: await lire(await compressImage(etoile, CHOICE_IMAGE.budget, CHOICE_IMAGE.width)), opaque: await lire(await compressImage(opaque)) };
    });
    const jaune = ([r, g, b]) => r > 200 && g > 180 && b < 90;
    const sombre = (c) => Math.max(...c) < 90;
    assert.deepEqual(r.grande.taille, [800, 600]);
    assert.deepEqual(r.cas.taille, [480, 480]);
    // L'étoile, agrandie et centrée, occupe le milieu ; autour, la nuit violette du décor (plus de blanc).
    for (const x of [r.grande, r.cas]) {
      assert.ok(jaune(x.centre), `le sujet au centre : ${x.centre}`);
      assert.ok(sombre(x.coin), `un coin du fond : ${x.coin}`);
    }
    assert.ok(jaune(r.grande.gauche), "l'étoile occupe presque toute la hauteur (elle est carrée : sa largeur suit)");
    assert.deepEqual(r.opaque.taille, [600, 300], "une photo opaque garde son format");
    assert.ok(Math.abs(r.opaque.coin[2] - 192) < 12 && Math.abs(r.opaque.centre[0] - 48) < 12, `et ses couleurs : ${r.opaque.coin}`);
    await page.context().close();
  });

  test("Import « ZIP de l'IA + dossier d'images » (cedric, 25/10) : un seul packs.json, les images retrouvées par leur nom dans le dossier téléchargé, seules celles qui servent sont téléversées", async () => {
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="questions"]');
    await page.click('#q-groups [data-groupe="packs"]');
    await page.locator("#pack-import:not([hidden])").waitFor();
    const PACKS = { theme: "KPop Demon Hunters", niveau: "Moyen", packs: [
      { title: "KPop Demon Hunters", questions: [{ text: "Qui chante Golden ?", choices: ["Rumi", "Mira", "Zoey", "Jinu"], correct: 0, image: "Rumi Scène (2).PNG" }] },
      { title: "KPop Demon Hunters", photos: [{ image: "rumi_kdh.png", reponse: "Rumi" }, { image: "Mira-KDH.png", reponse: "Mira" }] },
      { serie: "KPop Demon Hunters", personnages: [{ reponse: "Jinu le démon", indices: ["Je suis un démon", "Je chante"], image: "jinu.png" }] },
    ] };
    // Le ZIP de l'IA (ses données seules) et le dossier d'images téléchargé, avec des images qui ne servent à rien.
    const ia = Buffer.from(faireZip([["kdh/packs.json", JSON.stringify(PACKS)]]));
    const images = [["rumi scene (2).png", [200, 40, 90]], ["rumi_kdh.png", [40, 200, 90]], ["mira-kdh.png", [40, 90, 200]], ["jinu.png", [220, 220, 40]], ["inutile.png", [10, 10, 10]], ["IMG_0042.png", [90, 90, 90]]];
    await page.setInputFiles("#pack-file", { name: "kdh-tout.zip", mimeType: "application/zip",
      buffer: Buffer.from(faireZip([["ia.zip", ia], ...images.map(([n, c]) => [`images/${n}`, png(c)])])) });
    const fenetre = page.locator("dialog[data-fenetre][open]");
    await fenetre.locator(".pack-images-inutiles").waitFor();
    assert.equal(await fenetre.locator(".pack-images-inutiles").textContent(), "2 images du ZIP ne servent à aucun pack : elles ne sont pas téléversées.");
    assert.deepEqual((await fenetre.locator(".pack-apercu-pack").evaluateAll((xs) => xs.map((x) => x.dataset.epreuve))).sort(), ["photos", "quisuis", "quiz"]);
    assert.doesNotMatch(await fenetre.innerText(), /Image manquante|image absente/);
    await repondreFenetre(page);
    await page.locator("#pack-status", { hasText: /^✓ \d+ packs? importés?/ }).waitFor();
    const quizzes = Object.values(await library("quizzes"));
    const quiz = quizzes.find((q) => q.kind !== "images");
    const zoom = quizzes.find((q) => q.kind === "images");
    assert.match(quiz.questions[0].imageId, /^[0-9a-f]{16}$/);
    assert.deepEqual(zoom.questions.map((q) => q.choices[q.correct]), ["Rumi", "Mira"]);
    const qui = (await library("contents")).quisuis;
    assert.equal(qui.extra.find((x) => x.answer === "Jinu le démon").serie, "KPop Demon Hunters");
    const idJinu = qui.images["jinu le démon"];
    assert.match(idJinu, /^[0-9a-f]{16}$/, "l'image du personnage, à sa place");
    // Téléversées : les 4 images citées, jamais les 2 qui ne servent à rien.
    const rangees = Object.keys(await library("images"));
    assert.deepEqual(new Set(rangees), new Set([quiz.questions[0].imageId, ...zoom.questions.map((q) => q.imageId), idJinu]));
    assert.equal(rangees.length, 4);
    await page.context().close();
  });

  test("« 🎨 Prestation test d'un thème » (cedric, 25/10) : les jeux à packs piochent seulement dans ce thème, un jeu sans rien dessus est retiré, les autres jeux comme d'habitude", async () => {
    const [A, B, C] = ["d1d1d1d1d1d1d1d1", "d2d2d2d2d2d2d2d2", "d3d3d3d3d3d3d3d3"];
    const pack = (title, theme, n) => ({ title, theme, niveau: "Moyen", pack: true, kind: "classique", source: "json", updatedAt: 1,
      questions: Array.from({ length: n }, (_, k) => ({ text: `${title} ${k + 1} ?`, choices: ["A", "B", "C", "D"], correct: k % 4, status: "validee" })) });
    const photo = (imageId, rep) => ({ text: "Qu'est-ce que c'est ?", choices: [rep, ...["Yoshi", "Toad", "Peach", "Luigi"].filter((x) => x !== rep).slice(0, 3)], correct: 0, status: "validee", imageId });
    await seedLibrary("quizzes", { mario: pack("Super Mario", "Mario", 20), disney: pack("Disney", "Disney", 20),
      zoom: { title: "Super Mario", theme: "Mario", niveau: "Facile", pack: true, kind: "images", source: "photos", updatedAt: 1, questions: [photo(A, "Yoshi"), photo(B, "Toad"), photo(C, "Peach")] } });
    const page = await admin();
    await page.click("#nav button[data-screen=settings]");
    await page.locator('#test-theme-choix option[value="Mario"]').waitFor({ state: "attached" });
    assert.deepEqual(await page.locator("#test-theme-choix option").allTextContents(), ["Disney", "Mario"]);
    await page.locator("#test-theme-choix").selectOption("Mario");
    await page.click("#test-theme");
    assert.match(await repondreFenetre(page), /Créer « 🧪 Test packs Mario » \?/);
    await page.locator("#show-status-msg", { hasText: "Enregistrée « À venir »" }).waitFor({ timeout: 30000 });
    const fete = (await library("shows"))["test-packs-mario"];
    assert.deepEqual([fete.title, fete.childName, fete.date, fete.status], ["🧪 Test packs Mario", "Touktouka", isoDay(), "publiee"]);
    // Pas de Quiz illustré, de Vrai ou Faux ni de Qui suis-je ? sur Mario : retirés ; l'Image floue n'a plus de photo libre (jamais deux fois).
    // (Pas de chansons dans cette bibliothèque : ni Blind test ni Quiz musical.)
    assert.deepEqual(fete.rounds.map((r) => r.type), ["quiz", "mimes", "zoom", "chante", "disparu", "statues", "pictionary", "gonfleur", "duel", "patate", "simon", "chrono", "coffres"]);
    const jeu = Object.fromEntries(fete.rounds.map((r) => [r.type, r]));
    assert.deepEqual(jeu.quiz.seriesQuiz.map((x) => [x.origine, x.pioche?.mode, x.pioche?.terme]), [["reprise", "recherche", "Mario"]]);
    assert.ok(jeu.quiz.seriesQuiz[0].questions.every((q) => q.text.startsWith("Super Mario")), "rien d'autre que Mario");
    assert.deepEqual(jeu.zoom.seriesQuiz[0].questions.map((q) => q.imageId).sort(), [A, B, C]);
    assert.ok(jeu.mimes.equipes.every((l) => l.length > 0), "les autres jeux au 🎲 habituel");
    await page.click("#nav button[data-screen=settings]");
    await page.locator("#test-theme-status", { hasText: "Créée : « 🧪 Test packs Mario » (rien sur « Mario » pour : " }).waitFor();
    await page.context().close();
  });

  test("Import : les images nommées par l'IA (cedric, 25/10 : « Yoshi, Toad… ») arrivent sous leur nom dans le thème, citées ou non, et se retrouvent en tapant", async () => {
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="questions"]');
    await page.click('#q-groups [data-groupe="packs"]');
    await page.locator("#pack-import:not([hidden])").waitFor();
    const PACKS = { theme: "Mario", niveau: "Facile",
      images: [{ fichier: "IMG_001.png", nom: "Yoshi sur son kart" }, { fichier: "IMG_002.png", nom: "Toad" }, { fichier: "IMG_003.png", nom: "Peach" }, { fichier: "absente.png", nom: "Wario" }],
      packs: [{ title: "Zoom Mario", photos: [{ image: "IMG_001.png", reponse: "Yoshi" }] }] };
    const images = [["IMG_001.png", [40, 200, 60]], ["IMG_002.png", [220, 40, 40]], ["IMG_003.png", [250, 150, 200]], ["IMG_004.png", [20, 20, 20]]];
    await page.setInputFiles("#pack-file", { name: "mario.zip", mimeType: "application/zip",
      buffer: Buffer.from(faireZip([["mario/packs.json", JSON.stringify(PACKS)], ...images.map(([n, c]) => [`mario/images/${n}`, png(c)])])) });
    const fenetre = page.locator("dialog[data-fenetre][open]");
    await fenetre.locator(".pack-images-nommees").waitFor();
    assert.match(await fenetre.locator(".pack-images-nommees").textContent(), /^🖼 3 images nommées \(Yoshi sur son kart, Toad, Peach\) : rangées sous ce nom/);
    assert.equal(await fenetre.locator(".pack-noms-absents").textContent(), "1 image nommée absente du ZIP : absente.png.");
    assert.equal(await fenetre.locator(".pack-images-inutiles").textContent(), "1 image du ZIP ne sert à aucun pack et n'a pas de nom : elle n'est pas téléversée.");
    assert.equal(await repondreFenetre(page), "Importer « Zoom Mario » ?");
    await page.locator("#pack-status", { hasText: "✓ 1 pack importé, 3 images." }).waitFor();
    // Téléversées : la photo citée et les deux nommées, jamais IMG_004 ; chacune sa fiche, son nom, son thème.
    const [zoom] = Object.values(await library("quizzes"));
    const medias = await library("medias");
    assert.equal(Object.keys(await library("images")).length, 3);
    assert.deepEqual(Object.values(medias).map((f) => [f.name, f.cat]).sort(), [["Peach", "📦 Mario"], ["Toad", "📦 Mario"], ["Yoshi sur son kart", "📦 Mario"]]);
    assert.equal(medias[zoom.questions[0].imageId].name, "Yoshi sur son kart", "l'image citée prend aussi son nom");
    assert.equal(zoom.questions[0].choices[0], "Yoshi", "la réponse du jeu ne change pas");

    // Un fichier qui ne fait que nommer (noms-images.json) : rangé dans le thème déjà là, écrit comme lui.
    await page.setInputFiles("#pack-file", { name: "noms.zip", mimeType: "application/zip",
      buffer: Buffer.from(faireZip([["noms-images.json", JSON.stringify({ theme: "mario", images: [{ fichier: "img_004.PNG", nom: "Bowser" }] })], ["images/IMG_004.png", png([20, 20, 20])]])) });
    assert.equal(await repondreFenetre(page), "Ranger cette image ?");
    await page.locator("#pack-status", { hasText: "✓ 1 image." }).waitFor();
    // La ligne du bilan s'en va toute seule (cedric, 26/10).
    await page.locator("#pack-status:empty").waitFor({ state: "attached", timeout: 13000 });

    // Bibliothèque › Images : les 4 dans « Mario », et on tape le nom pour la retrouver.
    await page.click('#library-tabs [data-lib-tab="images"]');
    await page.locator('#media-groups [data-groupe="packs"]', { hasText: "📦 Images des packs (4)" }).waitFor();
    await page.click('#media-groups [data-groupe="packs"]');
    assert.deepEqual(await page.locator("#media-list h3.content-series").allInnerTexts(), ["Mario · 4"]);
    await page.fill("#media-search", "toad");
    await page.locator("#media-list h3.content-series", { hasText: "Mario · 1" }).waitFor();
    assert.deepEqual(await page.locator("#media-list .media-card input.media-name").evaluateAll((xs) => xs.map((x) => x.value)), ["Toad"]);
    await page.fill("#media-search", "");

    // ✎ Renommer le thème : ses images, même celles qu'aucun pack ne cite, le suivent.
    await page.click('#library-tabs [data-lib-tab="questions"]');
    await page.click('#q-groups [data-groupe="photos"]');
    await page.locator('.q-theme[data-theme="Mario"] .theme-renommer').click();
    await repondreFenetre(page, { texte: "Super Mario" });
    await page.locator('.q-theme[data-theme="Super Mario"]').waitFor();
    await waitFor(async () => Object.values(await library("medias")).every((f) => f.cat === "📦 Super Mario"), "les fiches suivent le thème");
    await page.context().close();
  });

  test("🗑 Supprimer un thème (cedric, 26/10) : ses packs et ses séries de photos (Zoom mystère, Image floue), leurs questions et les images qui ne servent qu'à eux ; Mes images, les autres thèmes et les prestations ne bougent pas", async () => {
    const I = (k) => `${k}`.repeat(16).slice(0, 16);
    const PNG = `data:image/png;base64,${png([200, 60, 120]).toString("base64")}`;
    const q = (text, imageId) => ({ text, choices: ["A", "B", "C", "D"], correct: 0, status: "validee", imageId });
    await seedLibrary("quizzes", {
      m1: { title: "Mario Facile", theme: "Mario", niveau: "Facile", pack: true, source: "json", updatedAt: 1, questions: [q("Qui est vert ?", I(1)), q("Qui est rose ?", I(2))] },
      m2: { title: "Mario Moyen", theme: "Mario", niveau: "Moyen", pack: true, source: "json", updatedAt: 1, questions: [q("Qui conduit ?", I(3))] },
      zm: { title: "Zoom Mario", theme: "Mario", niveau: "Facile", pack: true, kind: "images", source: "photos", updatedAt: 1, questions: [q("Qui est-ce ?", I(4))] },
      kp: { title: "K-pop Facile", theme: "K-pop", niveau: "Facile", pack: true, source: "json", updatedAt: 1, questions: [q("Qui chante ?", I(5))] },
    });
    await seedLibrary("images", Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((k) => [I(k), PNG])));
    await seedLibrary("medias", {
      [I(6)]: { name: "Toad", cat: "📦 mario", createdAt: 1, updatedAt: 1 },
      [I(2)]: { name: "Mon chat", cat: "Animaux", createdAt: 1, updatedAt: 1 },
      [I(7)]: { name: "Bowser", cat: "📦 K-pop", createdAt: 1, updatedAt: 1 },
    });
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
    const LOU = { childName: "Lou", age: 9, date: day(10), status: "publiee", updatedAt: 1,
      rounds: [{ type: "quiz", seriesQuiz: [{ id: "s1", origine: "biblio", questions: [{ id: "pk-x", text: "Qui conduit ?", choices: ["A", "B", "C", "D"], correct: 0, imageId: I(3) }] }] }] };
    // Sa « 🧪 Test packs Mario » (Paramètres) cite I(1) : une copie pour essayer, qui part avec le thème.
    const TEST = { childName: "🧪 Test packs Mario", age: 9, date: day(10), status: "publiee", updatedAt: 1,
      rounds: [{ type: "quiz", seriesQuiz: [{ id: "s1", origine: "biblio", questions: [{ id: "pk-y", text: "Qui est vert ?", choices: ["A", "B", "C", "D"], correct: 0, imageId: I(1) }] }] }] };
    await seedLibrary("shows", { lou: LOU, "test-packs-mario": TEST });
    // Son jeu gardé à l'enregistrement (« manche » du test) part avec lui.
    await seedLibrary("manches", { m1: { type: "quiz", title: "Quiz", showId: "test-packs-mario", origin: "admin", createdAt: 1, updatedAt: 1, round: TEST.rounds[0] } });
    // Ses personnages de Qui suis-je ? (cedric, 26/10 : leurs images restaient) : Yoshi, de la série « Mario », part ;
    // Rumi (K-pop) reste.
    const RUMI = { answer: "Rumi", clues: ["chanteuse", "Huntrix"], serie: "K-pop", niveau: "Facile" };
    await seedLibrary(`images/${I(8)}`, PNG);
    await seedLibrary(`images/${I(9)}`, PNG);
    await seedLibrary("contents/quisuis", { extra: [{ answer: "Yoshi", clues: ["vert", "dinosaure"], serie: "Mario", niveau: "Facile" }, RUMI],
      images: { yoshi: I(8), rumi: I(9) }, updatedAt: 1 });
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="questions"]');
    await page.click('#q-groups [data-groupe="packs"]');
    const mario = page.locator('.q-theme[data-theme="Mario"]');
    await mario.waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "pas de défilement de côté sur un téléphone");
    // Annuler ne supprime rien.
    await mario.locator(".theme-supprimer").click();
    const message = await repondreFenetre(page, { accepter: false });
    assert.match(message, /^Supprimer le thème « Mario » \?\n\n3 packs \(4 questions\) et 4 images partent de la bibliothèque, pour de bon\./);
    assert.match(message, /1 personnage de Qui suis-je \? part aussi\./);
    assert.match(message, /Sa prestation de test « .*Test packs Mario.* » part aussi\./);
    assert.match(message, /1 image reste : une prestation ou un autre pack s'en sert\./, "I(3), copiée chez Lou");
    assert.match(message, /Mes images, les autres thèmes et les questions déjà copiées dans une prestation ne changent pas\./);
    assert.equal(Object.keys(await library("quizzes")).length, 4);
    await mario.locator(".theme-supprimer").click();
    await repondreFenetre(page);
    await page.locator("#annonce", { hasText: "✓ Thème « Mario » supprimé : 3 packs et 4 images." }).waitFor();
    await mario.waitFor({ state: "detached" });
    await page.locator('.q-theme[data-theme="K-pop"]').waitFor();
    // Partis : les deux packs et la série de photos Mario, I(1) et I(4) (citées), I(6) (nommée « Toad » sans pack).
    // Gardées : I(2) (Mes images), I(3) (copiée dans la prestation de Lou), I(5) et I(7) (K-pop).
    assert.deepEqual(Object.keys(await library("quizzes")), ["kp"]);
    assert.deepEqual(Object.keys(await library("images")).sort(), [2, 3, 5, 7, 9].map(I).sort());
    const qui = await library("contents/quisuis");
    assert.deepEqual([qui.extra, qui.images], [[RUMI], { rumi: I(9) }]);
    assert.deepEqual(Object.keys(await library("medias")).sort(), [I(2), I(7)].sort());
    assert.deepEqual(await library("shows"), { lou: LOU }, "la prestation ne change pas ; le test du thème est parti");
    assert.equal(await library("manches"), null, "le jeu gardé du test aussi");
    await page.context().close();
  });

  test("🧹 Images orphelines (cedric, 26/10 : les photos des thèmes supprimés restaient) : celles que plus rien n'utilise, sans fiche ou d'un thème qui n'existe plus, et les prestations de test de ces thèmes ; Mes images, les thèmes vivants et les prestations restent", async () => {
    const I = (k) => `${k}`.repeat(16).slice(0, 16);
    const PNG = `data:image/png;base64,${png([60, 120, 200]).toString("base64")}`;
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
    await seedLibrary("quizzes", { kp: { title: "K-pop Facile", theme: "K-pop", niveau: "Facile", pack: true, source: "json", updatedAt: 1,
      questions: [{ text: "Qui chante ?", choices: ["A", "B", "C", "D"], correct: 0, status: "validee", imageId: I(1) }] } });
    await seedLibrary("images", Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((k) => [I(k), PNG])));
    await seedLibrary("medias", {
      [I(3)]: { name: "Woody", cat: "📦 Pixar", createdAt: 1, updatedAt: 1 }, // thème supprimé, rien ne la cite
      [I(4)]: { name: "Rumi", cat: "📦 K-pop", createdAt: 1, updatedAt: 1 }, // nommée, thème vivant : gardée
      [I(5)]: { name: "Mon chat", cat: "Animaux", createdAt: 1, updatedAt: 1 }, // Mes images : jamais touchée
      [I(6)]: { name: "Buzz", cat: "📦 Pixar", createdAt: 1, updatedAt: 1 }, // citée seulement par le test de Pixar
      [I(7)]: { name: "Woody et Buzz", cat: "📦 Pixar", createdAt: 1, updatedAt: 1 }, // copiée chez Lou : reste
    });
    const serie = (id) => [{ id: "s1", origine: "biblio", questions: [{ id: "pk", text: "Qui ?", choices: ["A", "B", "C", "D"], correct: 0, imageId: id }] }];
    const LOU = { childName: "Lou", age: 9, date: day(10), status: "publiee", updatedAt: 1, rounds: [{ type: "quiz", seriesQuiz: serie(I(7)) }] };
    await seedLibrary("shows", { lou: LOU, "test-packs-pixar": { childName: "🧪 Test packs Pixar", age: 9, date: day(10), status: "publiee", updatedAt: 1, rounds: [{ type: "quiz", seriesQuiz: serie(I(6)) }] } });
    // Buzz, personnage de Qui suis-je ? de Disney Pixar (supprimé) : son image I(10) y est rangée, il part avec elle.
    // Rumi (K-pop, vivant) et Mario (série tapée à la main, sans image de pack) restent.
    const RUMI = { answer: "Rumi", clues: ["chanteuse", "Huntrix"], serie: "K-pop", niveau: "Facile" };
    const MARIO = { answer: "Mario", clues: ["plombier", "moustache"], serie: "Mes héros", niveau: "Facile" };
    await seedLibrary(`images/${"a".repeat(16)}`, PNG);
    await seedLibrary("medias/aaaaaaaaaaaaaaaa", { name: "Buzz l'Éclair", cat: "📦 Disney Pixar", createdAt: 1, updatedAt: 1 });
    await seedLibrary("contents/quisuis", { extra: [{ answer: "Buzz l'Éclair", clues: ["espace", "ranger"], serie: "Disney Pixar", niveau: "Facile" }, RUMI, MARIO],
      images: { "buzz l'éclair": "a".repeat(16), rumi: I(4) }, updatedAt: 1 });
    // Le jeu gardé d'un ancien test de Mario, déjà effacé (cedric, 26/10 : 52 images Mario restaient) : I(11), rangée à
    // Mario, part avec lui ; celui de Lou reste.
    await seedLibrary(`images/${"b".repeat(16)}`, PNG);
    await seedLibrary(`medias/${"b".repeat(16)}`, { name: "Bill Balle", cat: "📦 Super Mario", createdAt: 1, updatedAt: 1 });
    const MANCHE_LOU = { type: "quiz", title: "Quiz de Lou", showId: "lou", origin: "admin", createdAt: 1, updatedAt: 1, round: { type: "quiz", seriesQuiz: serie(I(7)) } };
    await seedLibrary("manches", {
      vieille: { type: "quiz", title: "Quiz", showId: "test-packs-supermario", origin: "admin", createdAt: 1, updatedAt: 1, round: { type: "quiz", seriesQuiz: serie("b".repeat(16)) } },
      lou: MANCHE_LOU,
    });
    // I(2), I(8) : sans fiche, que rien ne cite (invisibles) ; I(7) : rangée à Pixar, mais copiée chez Lou.
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="images"]');
    await page.click('#media-groups [data-groupe="packs"]');
    await page.click(".orphelines-nettoyer");
    const fenetre = page.locator("dialog[data-fenetre][open]");
    await fenetre.locator(".orphelines-apercu figure").first().waitFor();
    assert.equal(await fenetre.locator(".orphelines-apercu figure").count(), 6);
    assert.deepEqual((await fenetre.locator(".orphelines-apercu figcaption").allTextContents()).sort(), ["Bill Balle", "Buzz", "Buzz l'Éclair", "Sans nom", "Sans nom", "Woody"]);
    // Une seule phrase sur les images (cedric, 26/10) ; en petit, ce qui part avec elles et pourquoi d'autres restent.
    assert.equal(await fenetre.locator(".orphelines-avec").textContent(), "Ce qui s'en servait dans ces thèmes part avec elles. Mes images et les pochettes ne sont jamais touchées.");
    assert.equal(await fenetre.locator(".orphelines-restent").textContent(), "1 autre image reste : la prestation « Anniversaire de Lou », le jeu gardé « Quiz de Lou » s'en servent.");
    assert.equal(await repondreFenetre(page, { accepter: false }), "Effacer les 6 images des thèmes supprimés (Pixar, Disney Pixar, Super Mario) ?");
    assert.equal(Object.keys(await library("images")).length, 10, "annuler n'efface rien");
    await page.click(".orphelines-nettoyer");
    await repondreFenetre(page);
    await page.locator("#annonce", { hasText: "✓ 6 images effacées." }).waitFor();
    assert.deepEqual(Object.keys(await library("images")).sort(), [1, 4, 5, 7].map(I).sort());
    assert.deepEqual(Object.keys(await library("medias")).sort(), [4, 5, 7].map(I).sort());
    assert.deepEqual(await library("shows"), { lou: LOU });
    assert.deepEqual(await library("manches"), { lou: MANCHE_LOU });
    const qui = await library("contents/quisuis");
    assert.deepEqual([qui.extra, qui.images], [[RUMI, MARIO], { rumi: I(4) }]);
    await page.click(".orphelines-nettoyer");
    await page.locator("#annonce", { hasText: "Aucune image orpheline : tout ce qui reste sert encore." }).waitFor();
    await page.context().close();
  });

  test("🗑 Tout effacer les images des packs (cedric, 26/10 : « repartir sur une base saine ») : les images, les questions et personnages qui les montrent dans les prestations et les jeux gardés ; la prestation reste, Mes images aussi", async () => {
    const I = (k) => `${k}`.repeat(16).slice(0, 16);
    const PNG = `data:image/png;base64,${png([90, 160, 60]).toString("base64")}`;
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
    await seedLibrary("images", Object.fromEntries([1, 2, 3, 5].map((k) => [I(k), PNG])));
    await seedLibrary("medias", {
      [I(1)]: { name: "Bill Balle", cat: "📦 Super Mario", createdAt: 1, updatedAt: 1 },
      [I(2)]: { name: "Bowser", cat: "📦 Super Mario", createdAt: 1, updatedAt: 1 },
      [I(3)]: { name: "Yoshi", cat: "📦 Super Mario", createdAt: 1, updatedAt: 1 },
      [I(5)]: { name: "Mon chat", cat: "Animaux", createdAt: 1, updatedAt: 1 },
    });
    const q = (text, imageId) => ({ id: `pk-${text}`, text, choices: ["A", "B", "C", "D"], correct: 0, ...(imageId ? { imageId } : {}) });
    const LOU = { childName: "Lou", age: 9, date: day(10), status: "publiee", updatedAt: 1, rounds: [
      { type: "quiz", seriesQuiz: [{ id: "s1", origine: "biblio", questions: [q("Qui vole ?", I(1)), q("Capitale ?", null), q("Mon chat ?", I(5))] }] },
      { type: "quisuis", seriesMots: [{ id: "m1", origine: "biblio", mots: [{ answer: "Yoshi", clues: ["vert", "dino"], imageId: I(3) }] }] },
      { type: "statues", duration: 60 }] };
    await seedLibrary("shows", { lou: LOU });
    await seedLibrary("manches", { m: { type: "quiz", title: "Quiz Mario", origin: "admin", createdAt: 1, updatedAt: 1, round: { type: "quiz", seriesQuiz: [{ id: "s", origine: "biblio", questions: [q("Qui tire ?", I(2)), q("Couleur ?", null)] }] } } });
    await seedLibrary("contents/quisuis", { extra: [{ answer: "Yoshi", clues: ["vert", "dino"], serie: "Super Mario", niveau: "Facile" }], images: { yoshi: I(3) }, updatedAt: 1 });
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="images"]');
    await page.click('#media-groups [data-groupe="packs"]');
    await page.click(".tout-effacer");
    const fenetre = page.locator("dialog[data-fenetre][open]");
    await fenetre.locator(".tout-effacer-retirees").waitFor();
    assert.equal(await fenetre.locator(".tout-effacer-retirees").textContent(), "Les questions qui les montrent sont retirées de : la prestation « Anniversaire de Lou », le jeu gardé « Quiz Mario ».");
    assert.equal(await repondreFenetre(page, { accepter: false }), "Effacer les 3 images des packs ?");
    assert.equal(Object.keys(await library("images")).length, 4, "annuler n'efface rien");
    await page.click(".tout-effacer");
    await repondreFenetre(page);
    await page.locator("#annonce", { hasText: "✓ 3 images des packs effacées." }).waitFor();
    assert.deepEqual(Object.keys(await library("images")), [I(5)]);
    assert.deepEqual(Object.keys(await library("medias")), [I(5)]);
    const lou = (await library("shows")).lou;
    assert.deepEqual(lou.rounds[0].seriesQuiz[0].questions.map((x) => x.text), ["Capitale ?", "Mon chat ?"]);
    assert.equal((lou.rounds[1].seriesMots ?? []).length, 0, "la série Qui suis-je vidée part");
    assert.deepEqual(lou.rounds[2], LOU.rounds[2]);
    assert.deepEqual((await library("manches/m")).round.seriesQuiz[0].questions.map((x) => x.text), ["Couleur ?"]);
    assert.equal((await library("contents/quisuis"))?.extra ?? null, null, "Yoshi part du jeu Qui suis-je ?");
    await page.locator(".tout-effacer").waitFor({ state: "detached" });
    await page.context().close();
  });

  test("Images en double (cedric, 25/10) : à l'import, la même image sous deux noms de fichier n'est gardée qu'une fois, ni deux fois avec celles déjà importées, sans rien demander (26/10)", async () => {
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="questions"]');
    await page.click('#q-groups [data-groupe="packs"]');
    await page.locator("#pack-import:not([hidden])").waitFor();
    const ROUGE = [220, 30, 30], NOIR = [5, 5, 5], BLEU = [20, 40, 220];
    // bill.png et bill-copie.png : la même image, à deux tailles ; bobomb.png : une autre sur le même fond.
    const PACKS = { theme: "Mario", niveau: "Facile",
      images: [{ fichier: "bill.png", nom: "Bill Balle" }, { fichier: "bill-copie.png", nom: "Bill Balle dans le ciel" }, { fichier: "bobomb.png", nom: "Bob-omb" }],
      packs: [
        { title: "Quiz Mario 1", questions: [{ text: "Qui est-ce ?", choices: ["Bill Balle", "Bob-omb"], correct: 0, image: "bill.png" }] },
        { title: "Quiz Mario 2", questions: [{ text: "Et lui ?", choices: ["Bill Balle", "Bob-omb"], correct: 0, image: "bill-copie.png" }] },
      ] };
    await page.setInputFiles("#pack-file", { name: "mario.zip", mimeType: "application/zip", buffer: Buffer.from(faireZip([["packs.json", JSON.stringify(PACKS)],
      ["images/bill.png", pngHalves(160, 120, ROUGE, NOIR)], ["images/bill-copie.png", pngHalves(80, 60, ROUGE, NOIR)], ["images/bobomb.png", pngHalves(160, 120, BLEU, NOIR)]])) });
    const fenetre = page.locator("dialog[data-fenetre][open]");
    await fenetre.locator(".pack-images-nommees").waitFor();
    assert.equal(await fenetre.locator(".pack-doublons").count(), 0, "rien à dire sur les doublons");
    assert.match(await fenetre.locator(".pack-images-nommees").textContent(), /^🖼 2 images nommées \(Bill Balle, Bob-omb\)/);
    await repondreFenetre(page);
    await page.locator("#pack-status", { hasText: /^✓ \d+ packs? importés?/ }).waitFor();
    const quizzes = Object.values(await library("quizzes"));
    const [id1, id2] = ["Quiz Mario 1", "Quiz Mario 2"].map((t) => quizzes.find((q) => q.title === t).questions[0].imageId);
    assert.equal(id1, id2, "les deux packs citent la même image, la plus grande");
    assert.equal(Object.keys(await library("images")).length, 2);
    assert.deepEqual(Object.values(await library("medias")).map((f) => f.name).sort(), ["Bill Balle", "Bob-omb"]);

    // Déjà importée : une copie plus petite, citée par un pack et une prestation, avec sa fiche ; puis un ZIP qui
    // apporte la même en plus grand : elle remplace la petite partout (cedric, 26/10 : « une image affichée une seule fois »).
    const COPIE = "e".repeat(16);
    await seedLibrary(`images/${COPIE}`, `data:image/png;base64,${pngHalves(40, 30, ROUGE, BLEU).toString("base64")}`);
    await seedLibrary(`medias/${COPIE}`, { name: "Toad", cat: "📦 Mario", tags: "", createdAt: 1, updatedAt: 1 });
    await seedLibrary("quizzes/vieux", { title: "Quiz Mario 3", theme: "Mario", niveau: "Moyen", pack: true, kind: "classique", source: "json", updatedAt: 1,
      questions: [{ text: "Encore lui ?", choices: ["Toad", "Bob-omb"], correct: 0, status: "validee", imageId: COPIE }] });
    await seedLibrary("shows/fete", { childName: "Léo", status: "brouillon", updatedAt: 1,
      rounds: [{ type: "zoom", seriesQuiz: [{ id: "s1", origine: "reprise", questions: [{ text: "Qu'est-ce que c'est ?", choices: ["Toad", "Bill"], correct: 0, status: "validee", imageId: COPIE }] }] }] });
    const zipDe = (nom, titre, image, png) => ({ name: nom, mimeType: "application/zip", buffer: Buffer.from(faireZip([["packs.json", JSON.stringify({ theme: "Mario", niveau: "Facile",
      packs: [{ title: titre, questions: [{ text: "Qui ?", choices: ["Toad", "Bill Balle"], correct: 0, image }] }] })], [`images/${image}`, png]])) });
    await page.setInputFiles("#pack-file", zipDe("toad.zip", "Quiz Mario 4", "toad.png", pngHalves(160, 120, ROUGE, BLEU)));
    await repondreFenetre(page);
    await page.locator("#pack-status", { hasText: /^✓ 1 pack importé/ }).waitFor();
    const toad = Object.values(await library("quizzes")).find((q) => q.title === "Quiz Mario 4").questions[0].imageId;
    assert.notEqual(toad, COPIE, "la plus grande gardée");
    assert.equal(await library(`images/${COPIE}`), null);
    assert.equal(await library(`medias/${COPIE}`), null);
    assert.equal((await library(`medias/${toad}`)).name, "Toad", "la fiche suit");
    assert.equal((await library("quizzes/vieux")).questions[0].imageId, toad);
    assert.equal((await library("shows/fete")).rounds[0].seriesQuiz[0].questions[0].imageId, toad, "les prestations aussi");
    // Et la même en plus petit : la bibliothèque garde la sienne, rien de nouveau n'est rangé.
    const avant = Object.keys(await library("images")).sort();
    await page.setInputFiles("#pack-file", zipDe("bill.zip", "Quiz Mario 5", "bill-petit.png", pngHalves(80, 60, ROUGE, NOIR)));
    await repondreFenetre(page);
    await page.locator("#pack-status", { hasText: /^✓ 1 pack importé/ }).waitFor();
    assert.equal(Object.values(await library("quizzes")).find((q) => q.title === "Quiz Mario 5").questions[0].imageId, id1);
    assert.deepEqual(Object.keys(await library("images")).sort(), avant);
    // Plus de bouton « Fusionner les doublons ».
    await page.click('#library-tabs [data-lib-tab="images"]');
    await page.click('#media-groups [data-groupe="packs"]');
    await page.locator(".orphelines-nettoyer").waitFor();
    assert.equal(await page.locator(".doublons-fusionner").count(), 0);
    await page.context().close();
  });

  test("Mes images, page après page (cedric, 26/10 : 569 images, la liste s'arrêtait à la première page)", async () => {
    const id = (k) => k.toString(16).padStart(16, "a");
    await seedLibrary("medias", Object.fromEntries(Array.from({ length: 125 }, (_, k) => [id(k), { name: `Photo ${k}`, cat: "Famille", tags: "", createdAt: 1, updatedAt: 1 }])));
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="images"]');
    await page.click('#media-groups [data-groupe="miennes"]');
    await waitFor(async () => (await page.locator("#media-list .media-card").count()) === 120, "120 fiches d'abord");
    const suite = page.locator(".fiches-suivantes");
    assert.equal(await suite.textContent(), "Voir les 5 images suivantes (120 sur 125)");
    await suite.click();
    await waitFor(async () => (await page.locator("#media-list .media-card").count()) === 125, "les 5 suivantes");
    assert.equal(await suite.count(), 0);
    await page.context().close();
  });

  test("Import d'un pack en un seul ZIP (cedric, 25/10) : Quiz illustré avec une image absente (simple alerte), série de photos sans données, tout modifiable et gardé", async () => {
    const page = await admin();
    await page.click("#nav button[data-screen=library]");
    await page.click('#library-tabs [data-lib-tab="questions"]');
    await page.click('#q-groups [data-groupe="packs"]');
    await page.locator("#pack-import:not([hidden])").waitFor();
    const zip = (nom, entrees) => ({ name: nom, mimeType: "application/zip", buffer: Buffer.from(faireZip(entrees)) });

    // Quiz illustré, à la racine du ZIP (sans dossier) : la réponse C n'a pas son image.
    const ILLUSTRE = { title: "Reine des neiges", theme: "Disney", famille: "Dessins animés et mangas", niveau: "Facile", ageMin: 5, ageMax: 8, questions: [
      { text: "Qui est le bonhomme de neige ?", choices: [{ text: "Sven", image: "rdn-q01-sven.jpg" }, { text: "Olaf", image: "rdn-q01-olaf.jpg" }, { text: "Hans", image: "rdn-q01-hans.jpg" }], correct: 1 },
    ] };
    await page.setInputFiles("#pack-file", zip("reine.zip", [
      ["pack.json", JSON.stringify(ILLUSTRE)], ["rdn-q01-sven.jpg", png([120, 90, 40])], ["rdn-q01-olaf.jpg", png([240, 240, 255])],
    ]));
    const fenetre = page.locator("dialog[data-fenetre][open]");
    await fenetre.locator(".pack-apercu-vignettes img").nth(1).waitFor();
    assert.match(await fenetre.innerText(), /Quiz illustré · 5 à 8 ans · 1 question/);
    assert.equal(await fenetre.locator(".pack-theme-nom").inputValue(), "Disney");
    assert.equal(await fenetre.locator(".pack-theme-global").count(), 0, "un seul pack : pas de thème global");
    assert.match(await fenetre.innerText(), /Question 1, réponse C : Image manquante : ajoutez une illustration\./);
    await capture(page, "pack-zip-apercu", { pleinePage: false });
    assert.equal(await repondreFenetre(page), "Importer « Reine des neiges » ?");
    await page.locator("#pack-status", { hasText: /^✓ 1 pack importé(, \d+ images?)?\. 1 image manquante : ajoutez-les dans « Éditer »\.$/ }).waitFor();
    let quizzes = await library("quizzes");
    const [idReine, reine] = Object.entries(quizzes).find(([, q]) => q.title === "Reine des neiges");
    assert.deepEqual([reine.kind, reine.source, reine.ageMin, reine.ageMax, reine.famille, reine.niveau], ["photo", "json", 5, 8, "Dessins animés et mangas", "Facile"]);
    const q0 = reine.questions[0];
    assert.deepEqual([q0.choices, q0.correct, q0.status, q0.image], [["Sven", "Olaf", "Hans"], 1, "validee", undefined], "jamais d'émoji à la place");
    assert.deepEqual(Object.keys(q0.choiceImages), ["0", "1"], "la case sans image reste vide");
    assert.match(await library(`images/${q0.choiceImages[0]}`), /^data:image\//);

    // Le même ZIP une seconde fois, mais sans ses images (cedric, 26/10 : six packs Marvel rangés ainsi, leurs questions
    // en texte seul sur la TV) : refusé, rien d'enregistré.
    await page.setInputFiles("#pack-file", zip("reine.zip", [["pack.json", JSON.stringify(ILLUSTRE)]]));
    assert.match(await repondreFenetre(page), /Ce pack ne peut pas être importé\.[\s\S]*Question 1 : aucune de ses images n'est dans le ZIP \(rdn-q01-sven\.jpg, rdn-q01-olaf\.jpg, rdn-q01-hans\.jpg\)\. Elle n'est pas importée : au Quiz illustré, chaque réponse a sa photo\.[\s\S]*Rien n'a été enregistré\./);
    assert.equal(Object.keys(await library("quizzes")).length, 1);
    // Avec un autre pack qui, lui, a ses images : celui-ci est importé, l'illustré sans images est dit en rouge.
    const VF = { title: "Disney vrai ou faux", theme: "Disney", niveau: "Facile", questions: [{ text: "Olaf est un bonhomme de neige.", choices: ["Vrai", "Faux"], correct: 0 }] };
    await page.setInputFiles("#pack-file", zip("deux.zip", [["reine/pack.json", JSON.stringify(ILLUSTRE)], ["vf/pack.json", JSON.stringify(VF)]]));
    await fenetre.locator(".pack-refuse").waitFor();
    assert.match(await fenetre.locator(".pack-refuse").innerText(), /^Reine des neiges[\s\S]*Pas importé : aucune de ses questions n'a une photo pour chaque réponse dans le ZIP\./);
    assert.equal(await repondreFenetre(page, { accepter: false }), "Importer « Disney vrai ou faux » ?");
    await page.locator("#pack-status", { hasText: "Import annulé : rien n'a été enregistré." }).waitFor();
    assert.equal(Object.keys(await library("quizzes")).length, 1);

    // Dans « Éditer » : la petite alerte sur la case C ; on y met une image, on en retire une autre, on enregistre.
    await page.locator(`.pack[data-pack~="${idReine}"]`).getByRole("button", { name: "Ouvrir" }).click();
    await page.getByRole("button", { name: "Éditer le pack" }).click();
    await page.locator("#screen-review:not([hidden])").waitFor();
    const cases = page.locator('#rv-list [data-q="0"] .choice-photo');
    assert.deepEqual(await cases.locator(".case-manquante").evaluateAll((els) => els.map((e) => !e.hidden)), [false, false, true, false], "4e case vide : pas une réponse");
    assert.equal(await page.locator('#rv-list [data-q="0"] .illustration .tag.missing:not([hidden])').count(), 0, "révélation facultative au Quiz illustré : pas d'alerte");
    await cases.nth(2).locator("input[type=file]").setInputFiles({ name: "hans.png", mimeType: "image/png", buffer: png([20, 160, 90]) });
    await cases.nth(2).locator("img.choice-thumb:not([hidden])").waitFor();
    assert.equal(await cases.nth(2).locator(".case-manquante").isHidden(), true);
    await cases.nth(0).getByRole("button", { name: "✕" }).click();
    assert.equal(await cases.nth(0).locator(".case-manquante").isVisible(), true, "image retirée : la petite alerte, rien d'autre");
    await page.locator('#rv-list [data-q="0"] .q-choice').nth(1).fill("Olaf le bonhomme");
    await page.click("#rv-save");
    await page.locator("#rv-status", { hasText: "Enregistré" }).waitFor();
    const apres = (await library(`quizzes/${idReine}`)).questions[0];
    assert.deepEqual([apres.choices, Object.keys(apres.choiceImages)], [["Sven", "Olaf le bonhomme", "Hans"], ["1", "2"]]);
    // Refermé puis rouvert : tout est là.
    await page.goBack();
    await page.locator("#library-questions:not([hidden])").waitFor();
    await page.click('#q-groups [data-groupe="packs"]');
    await page.locator(`.pack[data-pack~="${idReine}"]`).getByRole("button", { name: "Ouvrir" }).click();
    await page.getByRole("button", { name: "Éditer le pack" }).click();
    await page.locator("#screen-review:not([hidden])").waitFor();
    assert.equal(await page.locator('#rv-list [data-q="0"] .q-choice').nth(1).inputValue(), "Olaf le bonhomme");
    await cases.nth(2).locator('img.choice-thumb:not([hidden])[src^="data:image"]').waitFor();
    assert.equal(await cases.nth(0).locator(".case-manquante").isVisible(), true);
    await page.goBack();
    await page.locator("#library-questions:not([hidden])").waitFor();

    // Série de photos (Zoom mystère, Image floue), sans données, dans un dossier : la réponse vient du nom, liste.txt est laissé.
    await page.click('#q-groups [data-groupe="packs"]');
    await page.setInputFiles("#pack-file", zip("pack.zip", [
      ["Disney zoom/olaf.jpg", png([250, 190, 110])], ["Disney zoom/chateau-de-cendrillon.jpg", png([90, 120, 220])], ["Disney zoom/liste.txt", "olaf.jpg → Olaf"],
      // Sa fiche (cedric, 25/10) : famille et niveau, sans questions.
      ["Disney zoom/pack.json", JSON.stringify({ title: "Disney zoom", famille: "Dessins animés et mangas", niveau: "Moyen" })],
    ]));
    assert.equal(await fenetre.locator("select.pack-niveau").inputValue(), "Moyen");
    assert.match(await fenetre.innerText(), /Disney zoom\s+Zoom mystère \/ Image floue · 2 photos/);
    assert.match(await fenetre.innerText(), /Laissé de côté : liste\.txt\./);
    await repondreFenetre(page);
    await page.locator("#pack-status", { hasText: /^✓ 1 pack importé(, \d+ images?)?\.$/ }).waitFor();
    quizzes = await library("quizzes");
    const [, serie] = Object.entries(quizzes).find(([, q]) => q.title === "Disney zoom");
    assert.deepEqual([serie.kind, serie.source, serie.questions.length], ["images", "photos", 2]);
    assert.deepEqual(serie.questions.map((q) => q.choices[q.correct]), ["Chateau de cendrillon", "Olaf"]);
    assert.ok(serie.questions.every((q) => /^[0-9a-f]{16}$/.test(q.imageId) && q.status === "validee"));
    assert.equal(serie.pack, true);
    assert.deepEqual([serie.famille, serie.niveau], ["Dessins animés et mangas", "Moyen"]);

    // Bibliothèque › Images (cedric, 25/10) : les images des packs ont leur rubrique, à part de « Mes images ».
    await page.click('#library-tabs [data-lib-tab="images"]');
    await page.locator('#media-groups [data-groupe="packs"]', { hasText: "📦 Images des packs (4)" }).waitFor();
    assert.match(await page.locator('#media-groups [data-groupe="miennes"]').innerText(), /\(0\)/);
    await page.click('#media-groups [data-groupe="packs"]');
    // « Disney zoom » (sans thème) : la Régie l'a rangé dans le thème proche « Disney ».
    assert.deepEqual(await page.locator("#media-list h3.content-series").allInnerTexts(), ["Disney · 4"]);
    assert.equal(await page.locator("#media-list .media-card select.media-cat").count(), 0, "rangées par thème du pack, sans catégorie à choisir");
    await capture(page, "images-des-packs");

    // Trois niveaux dans un seul ZIP (cedric, 25/10) : même nom, même thème ; un même nom à un autre niveau n'est pas un doublon.
    await page.click('#library-tabs [data-lib-tab="questions"]');
    await page.click('#q-groups [data-groupe="packs"]');
    const hp = (niveau, ageMin, ageMax, choices = ["Oui", "Non"]) => JSON.stringify({ title: "Harry Potter", famille: "Films et séries", niveau, ageMin, ageMax,
      questions: [{ text: `Question ${niveau} ?`, choices, correct: 0 }] });
    await page.setInputFiles("#pack-file", zip("harry-potter.zip", [
      ["harry-potter/pack-facile.json", hp("Facile", 5, 8)], ["harry-potter/pack-moyen.json", hp("Moyen", 9, 11)], ["harry-potter/pack-difficile.json", hp("Difficile", 12, 15, ["Vrai", "Faux"])],
      // ZIP global : une série de photos dans son dossier, avec sa fiche.
      ["harry-potter/zoom-facile/pack.json", JSON.stringify({ title: "Harry Potter", famille: "Films et séries", niveau: "Facile" })],
      ["harry-potter/zoom-facile/hedwige.jpg", png([255, 255, 255])], ["harry-potter/zoom-facile/poudlard.jpg", png([60, 60, 90])],
    ]));
    await fenetre.locator(".pack-apercu-pack h3").nth(3).waitFor();
    assert.equal(await fenetre.locator(".pack-apercu-pack h3").evaluateAll((els) => els.map((e) => e.textContent).join(" | ")), "Harry Potter | Harry Potter | Harry Potter | Harry Potter");
    // Le thème de tous les packs (cedric, 25/10), tout en haut : proposé d'après les packs, il règle chaque série ;
    // chacune garde son menu pour changer la sienne.
    const global = fenetre.locator(".pack-theme-global");
    const themesDesSeries = () => fenetre.locator(".pack-apercu-pack").evaluateAll((els) => els.map((e) => {
      const menu = e.querySelector("select.pack-theme");
      return menu.value.startsWith("\u0000") ? `+${e.querySelector(".pack-theme-nom").value}` : menu.value;
    }));
    assert.deepEqual([await global.locator("select.pack-theme option:checked").textContent(), await global.locator(".pack-theme-nom").inputValue(), await global.locator(".pack-theme-etat").textContent()],
      ["＋ Nouveau thème…", "Harry Potter", "nouveau"]);
    assert.deepEqual(await themesDesSeries(), ["+Harry Potter", "+Harry Potter", "+Harry Potter", "+Harry Potter"]);
    const unDesSiens = await global.locator("select.pack-theme option").evaluateAll((els) => els.map((e) => e.value).find((v) => !v.startsWith("\u0000")));
    await global.locator("select.pack-theme").selectOption(unDesSiens);
    assert.equal(await global.locator(".pack-theme-etat").textContent(), "existant");
    assert.deepEqual(await themesDesSeries(), [unDesSiens, unDesSiens, unDesSiens, unDesSiens]);
    await global.locator("select.pack-theme").selectOption({ label: "＋ Nouveau thème…" });
    assert.deepEqual(await themesDesSeries(), ["+Harry Potter", "+Harry Potter", "+Harry Potter", "+Harry Potter"]);
    // Une seule série change, puis revient.
    const serie2 = fenetre.locator(".pack-apercu-pack").nth(1);
    await serie2.locator("select.pack-theme").selectOption(unDesSiens);
    assert.deepEqual(await themesDesSeries(), ["+Harry Potter", unDesSiens, "+Harry Potter", "+Harry Potter"]);
    await capture(page, "pack-theme-global", { pleinePage: false });
    await serie2.locator("select.pack-theme").selectOption({ label: "＋ Nouveau thème…" });
    assert.equal(await serie2.locator(".pack-theme-nom").inputValue(), "Harry Potter");
    assert.match(await fenetre.innerText(), /Zoom mystère \/ Image floue · 2 photos/);
    assert.equal(await repondreFenetre(page), "Importer ces 4 packs ?");
    await page.locator("#pack-status", { hasText: /^✓ \d+ packs? importés?/ }).waitFor();
    const hps = Object.values(await library("quizzes")).filter((q) => q.title.startsWith("Harry Potter") && q.kind !== "images");
    const zoomHp = Object.values(await library("quizzes")).find((q) => q.title === "Harry Potter" && q.kind === "images");
    assert.deepEqual([zoomHp.niveau, zoomHp.questions.map((q) => q.choices[q.correct]).join(", ")], ["Facile", "Hedwige, Poudlard"]);
    // Un pack fait avec l'ancien prompt (famille, sans thème) : son thème vient de son nom ; sa famille reste gardée.
    assert.deepEqual(hps.map((q) => [q.title, q.theme, q.famille, q.niveau]).sort((a, b) => a[3].localeCompare(b[3])),
      [["Harry Potter", "Harry Potter", "Films et séries", "Difficile"], ["Harry Potter", "Harry Potter", "Films et séries", "Facile"], ["Harry Potter", "Harry Potter", "Films et séries", "Moyen"]]);
    await page.locator('.q-theme[data-theme="Harry Potter"] .q-plier h2', { hasText: "🎨 Harry Potter (3)" }).waitFor();
    assert.deepEqual(await page.locator('.q-theme[data-theme="Harry Potter"] .pack .pack-niveau').allInnerTexts(), ["Facile", "Moyen", "Difficile"]);
    // Chaque carte dit son jeu, reconnu à l'import : c'est ce jeu-là qui le propose dans une prestation.
    assert.deepEqual(await page.locator('.q-theme[data-theme="Harry Potter"] .pack .pill').allInnerTexts(), ["📝 Quiz classique", "📝 Quiz classique", "✅ Vrai ou Faux express"]);

    // Un ZIP qui contient des ZIP (ChatGPT, 25/10) : tout dans le même aperçu. Une image panoramique : petite alerte, pas un refus.
    const kpop = (niveau, image) => JSON.stringify({ title: "K-pop", famille: "Musique", niveau,
      questions: [{ text: `Qui chante ${niveau} ?`, choices: ["Rumi", "Mira"], correct: 0, ...(image ? { revelation: image } : {}) }] });
    await page.setInputFiles("#pack-file", zip("kpop.zip", [
      ["kpop/quiz-facile.zip", faireZip([["pack.json", kpop("Facile", "rumi.png")], ["rumi.png", pngHalves(1600, 900, [200, 40, 90], [40, 90, 200])]])],
      ["kpop/quiz-moyen.zip", faireZip([["pack.json", kpop("Moyen", "mira.png")], ["mira.png", pngHalves(800, 600, [90, 200, 40], [40, 40, 40])]])],
    ]));
    await fenetre.locator(".pack-apercu-pack h3").nth(1).waitFor();
    assert.match(await fenetre.innerText(), /Question 1 : Image panoramique \(1600 × 900\) : attendu paysage 4:3, 800 × 600\. Elle sera recadrée sur la TV\./);
    assert.equal(await fenetre.locator(".pack-alerte.hors-format").count(), 1, "l'image au bon format ne dit rien");
    await capture(page, "pack-zip-hors-format", { pleinePage: false });
    assert.equal(await repondreFenetre(page), "Importer ces 2 packs ?");
    await page.locator("#pack-status", { hasText: /^✓ \d+ packs? importés?/ }).waitFor();
    const [idKpop, kpopFacile] = Object.entries(await library("quizzes")).find(([, q]) => q.title === "K-pop" && q.niveau === "Facile");
    assert.deepEqual(Object.values(kpopFacile.imagesHorsFormat ?? {}).length, 1);
    const carteKpop = page.locator(`.pack[data-pack~="${idKpop}"]`);
    await carteKpop.locator(".q-alerte.hors-format", { hasText: "⚠ 1 image hors format : « Ouvrir » pour voir" }).waitFor();
    await carteKpop.getByRole("button", { name: "Ouvrir" }).click();
    await page.locator(".hors-format-liste li", { hasText: "Question 1 : Image panoramique (1600 × 900)" }).waitFor();

    // Bibliothèque › Questions (cedric, 25/10) : le gros bouton d'import à gauche de « ← Retour », « 🎨 Mes thèmes » en premier.
    assert.deepEqual(await page.locator("#screen-library > .retour-barre.haut > *").evaluateAll((xs) => xs.map((x) => x.textContent)), ["📦 Importer un pack ZIP", "← Retour"]);
    assert.deepEqual(await page.locator("#q-groups .chip").evaluateAll((xs) => xs.slice(0, 2).map((x) => x.dataset.groupe)), ["tout", "packs"]);
    assert.match(await page.locator('#q-groups [data-groupe="packs"]').textContent(), /^🎨 Mes thèmes \(/);
    // Les thèmes de ses packs dans les puces des banques toutes prêtes, chacun dans le jeu qui lui va.
    await page.click('#q-groups [data-groupe="classiques"]');
    assert.equal(await page.locator(".q-categories .theme-pack").evaluateAll((xs) => xs.map((x) => x.textContent).join(" | ")), "🎨 Harry Potter (2) | 🎨 K-pop (2)");
    assert.equal(await page.locator(".q-liste .q-item .q-niveau:not(select)").first().textContent(), "Facile · 5-8 ans", "banque de l'appli : niveau affiché, fixe");
    await page.click('.q-categories .theme-pack[data-categorie="K-pop"]');
    const niveaux = page.locator(".q-liste .q-item select.q-niveau-choix");
    await waitFor(async () => (await niveaux.count()) === 2, "les 2 questions K-pop");
    assert.deepEqual(await niveaux.evaluateAll((xs) => xs.map((x) => x.value)), ["Facile", "Moyen"]);
    // Le niveau d'une question se change à la main, et reste.
    await niveaux.first().selectOption("Difficile");
    await waitFor(async () => (await library(`quizzes/${idKpop}/questions/0/niveau`)) === "Difficile", "niveau enregistré");
    await capture(page, "questions-themes-niveaux", { pleinePage: false });
    await page.click('#q-groups [data-groupe="vraifaux"]');
    assert.equal(await page.locator(".q-categories .theme-pack").evaluateAll((xs) => xs.map((x) => x.textContent).join(" | ")), "🎨 Harry Potter (1)");
    // Bibliothèque › Images : les images des packs d'abord.
    await page.click('#library-tabs [data-lib-tab="images"]');
    assert.equal(await page.locator("#q-importer-haut").isHidden(), true, "le bouton d'import est celui des questions");
    assert.deepEqual(await page.locator("#media-groups .chip").evaluateAll((xs) => xs.slice(0, 2).map((x) => x.dataset.groupe)), ["tout", "packs"]);
    await page.click('#media-groups [data-groupe="tout"]');
    assert.equal(await page.locator("#media-list .media-group").first().getAttribute("data-groupe"), "packs");
    await page.context().close();
  });

  test("prestation de test (cedric, 24/10) : un seul bouton efface les anciennes démos et rien d'autre, puis refait les 19 jeux au 🎲 ; un nouveau clic la refait à neuf ; la TV la charge", async () => {
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
    assert.equal(await page.locator("#test-panel #test-prestation").count(), 1, "un seul bouton de prestation de test");
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
    assert.equal(await page.locator("#show-rounds .jeu-bloc").count(), 19);
    assert.equal(await page.locator("#show-rounds .jeu-bloc.replie").count(), 19, "tout replié : une ligne par jeu");
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
      "flou", "disparu", "musical", "statues", "pictionary", "gonfleur", "duel", "patate", "simon", "chrono", "coffres"]);
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
    assert.equal(await page.locator("#test-titre").textContent(), "ANNIVERSAIRE TEST – Touktouka, 9 ans", "le texte de Paramètres dit le bon nom");
    await page.context().close();

    // Sur la régie : chargée sur la TV, les 19 jeux.
    box = startBox();
    const regie = await openRegie();
    await pair(regie);
    await inRegie(regie);
    await regie.locator(".show-item", { hasText: "ANNIVERSAIRE TEST – Touktouka, 9 ans" }).click();
    await respond(regie);
    await regie.locator("#r-toast", { hasText: "est chargée sur la TV" }).waitFor({ timeout: 30000 });
    const questions = (await read("show")).quiz.questions;
    const kinds = new Set(questions.map((q) => q.kind));
    for (const k of ["classic", "mime", "blind", "zoom", "chante", "express", "quisuis", "flou", "disparu", "statues", "pictionary", "gonfleur", "duel", "patate", "simon", "chrono", "coffres"]) {
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

  test("Statues musicales : la liste de la page du jeu ; dans la prestation, vos chansons (🎲, playlist, cochées, ↑ ↓ ✕), la TV reçoit leur refrain", async () => {
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

    // Vos chansons (cedric, 24/10 : « je devrais pouvoir entendre des musiques présélectionnées dans ma playlist ») : celles
    // de la bibliothèque des sons, au 🎲, d'une playlist ou cochées ; la TV joue leur refrain, l'une après l'autre.
    const hex = (c, k) => `${c}${k}`.padEnd(16, c);
    const SONGS = {
      s1: { title: "Libérée, délivrée", artist: "La Reine des neiges", audioId: hex("a", 1), refrainId: hex("b", 1), start: 0, refrain: 60, length: 222, buzz: 25, updatedAt: 1 },
      s2: { title: "Hakuna Matata", artist: "Le Roi lion", audioId: hex("a", 2), refrainId: hex("b", 2), start: 0, refrain: 50, length: 187, buzz: 25, updatedAt: 1 },
      s3: { title: "Sous l'océan", artist: "La Petite Sirène", audioId: hex("a", 3), start: 0, buzz: 25, updatedAt: 1 },
    };
    await seedLibrary("songs", SONGS);
    for (const id of [hex("a", 1), hex("b", 1), hex("a", 2), hex("b", 2), hex("a", 3)]) await seedLibrary(`sounds/${id}`, "data:audio/mpeg;base64,SUQz");
    await seedLibrary("playlists/disney", { title: "Dessins animés", duration: 25, updatedAt: 1, tracks: ["s1", "s3"].map((k) => ({ title: SONGS[k].title, audioId: SONGS[k].audioId, songId: k, duration: 25 })) });
    // Chansons entières en ligne : s1 et s2 ; pas s3 (rangée avant le 21/10).
    for (const k of ["s1", "s2"]) await seedLibrary(`entieres/${k}`, { n: 1, kbps: 96, p: { 0: wav(440, 1).toString("base64") } });
    await seedLibrary("shows/nina", { childName: "Nina", age: 8, date: "2026-05-10", status: "archivee", updatedAt: 1,
      rounds: [{ type: "quiz", quizId: "animaux" }, { type: "statues", duration: 90, chansons: ["s3", "s1", "perdue"] }] });

    await page.click("#nav button[data-screen=home]");
    await page.click("#home-new");
    await page.fill("#show-child", "Léa");
    await page.fill("#show-age", "7");
    await ajouterJeu(page, "statues");
    const round = page.locator("#show-rounds .round").nth(0);
    const resume = round.locator(".statues-resume");
    assert.equal(await resume.textContent(), "Aucune chanson : la musique de la fête.");
    const ids = () => round.locator(".statues-chanson").evaluateAll((xs) => xs.map((x) => x.dataset.chanson));
    // 🎶 Une playlist : ses chansons, dans son ordre.
    await round.locator(".statues-playlist-cherche").fill("dessins");
    await round.locator('.statues-playlist-item[data-playlist="disney"]').click();
    await resume.filter({ hasText: "2 chansons, jouées en entier l'une après l'autre." }).waitFor();
    assert.deepEqual(await ids(), ["s1", "s3"]);
    // Chaque chanson en entier (cedric, 27/10) : sa durée et 🎧 ; ☁ sur celle qui n'est pas entière en ligne.
    assert.equal(await round.locator(".statues-son").count(), 0, "plus de « ♪ Refrain / Début »");
    assert.equal(await round.locator('.statues-chanson[data-chanson="s1"] .statues-duree').textContent(), "3:42");
    assert.equal(await round.locator('.statues-chanson[data-chanson="s3"] .statues-duree').count(), 0, "durée inconnue : rien");
    await round.locator('.statues-chanson[data-chanson="s3"] .statues-nuage').waitFor();
    assert.equal(await round.locator('.statues-chanson[data-chanson="s1"] .statues-nuage').count(), 0);
    await round.locator('.statues-chanson[data-chanson="s3"] .statues-ecouter').click();
    await page.locator("#annonce", { hasText: "La chanson entière de « Sous l'océan » n'est pas encore en ligne" }).waitFor();
    await round.locator('.statues-chanson[data-chanson="s1"] .statues-ecouter').click();
    await round.locator('.statues-chanson[data-chanson="s1"] .statues-ecouter.en-lecture').waitFor();
    await round.locator('.statues-chanson[data-chanson="s1"] .statues-ecouter').click();
    await waitFor(async () => !(await round.locator(".statues-ecouter.en-lecture").count()), "écoute arrêtée");
    // 🎵 Cochées dans la bibliothèque : une de plus, à la fin.
    await round.locator(".statues-choisir").click();
    const choix = page.locator(".choix-sons");
    await choix.waitFor();
    await choix.locator('.choix-chanson[data-chanson="s2"]').click();
    await choix.locator(".choix-valider").click();
    await waitFor(async () => (await ids()).join() === "s1,s3,s2", "chanson cochée ajoutée à la fin");
    // ↑ ↓ ✕ : l'ordre de passage.
    await round.locator('.statues-chanson[data-chanson="s2"] .quiz-complet-monter').click();
    await waitFor(async () => (await ids()).join() === "s1,s2,s3", "montée");
    // Glissée à la souris (cedric, 26/10) : la première posée sous la dernière.
    await glisser(round.locator('.statues-chanson[data-chanson="s1"]'), round.locator('.statues-chanson[data-chanson="s3"]'), true);
    await waitFor(async () => (await ids()).join() === "s2,s3,s1", "glissée en bas");
    await round.locator('.statues-chanson[data-chanson="s1"] .tirage-retirer').click();
    await waitFor(async () => (await ids()).join() === "s2,s3", "retirée");
    // 📚 Un ancien anniversaire (cedric, 27/10) : ses chansons à la fin, sans celles déjà là ni celles supprimées depuis.
    await round.locator(".statues-rappel-cherche").fill("nina");
    await round.locator('.statues-rappel-item[data-show="nina"]', { hasText: "2 chansons" }).click();
    await waitFor(async () => (await ids()).join() === "s2,s3,s1", "rappelée à la fin");
    await round.locator('.statues-chanson[data-chanson="s1"] .tirage-retirer').click();
    await waitFor(async () => (await ids()).join() === "s2,s3", "retirée");
    await capture(page, "statues-vos-chansons");
    // 🎲 (cedric, 27/10) : chaque tirage s'ajoute à la fin de la liste, jamais une chanson déjà dedans.
    await round.locator(".statues-nombre").selectOption("3");
    await round.locator(".statues-de").click();
    await waitFor(async () => (await ids()).join() === "s2,s3,s1", "la seule chanson libre ajoutée à la fin");
    await page.locator("#annonce", { hasText: "Seulement 1 chanson de plus" }).waitFor();
    await round.locator(".statues-de").click();
    await page.locator("#annonce", { hasText: "déjà dans la liste" }).waitFor();
    assert.equal((await ids()).join(), "s2,s3,s1", "rien de remplacé");
    // « 🧩 Statues complet » (cedric, 27/10) : ouvert d'office, numéroté ; 🔀 mélange ; ▾ / ▸ le replie.
    const complet = round.locator(".statues-complet");
    assert.equal(await complet.locator(".quiz-complet-voir").textContent(), "▾ 🧩 Statues complet : 3 chansons, dans l'ordre de passage");
    assert.deepEqual(await complet.locator(".quiz-complet-num").allTextContents(), ["1", "2", "3"]);
    await complet.locator(".statues-melanger").click();
    await waitFor(async () => (await ids()).join() !== "s2,s3,s1", "mélangées");
    assert.deepEqual((await ids()).sort(), ["s1", "s2", "s3"]);
    await complet.locator(".quiz-complet-voir").click();
    await waitFor(async () => !(await complet.locator(".statues-liste").isVisible()), "replié");
    assert.equal(await complet.locator(".quiz-complet-voir").textContent(), "▸ 🧩 Statues complet : 3 chansons, dans l'ordre de passage");
    await complet.locator(".quiz-complet-voir").click();
    await complet.locator(".statues-liste").waitFor();
    const tirees = await ids();
    await aVenir(page);
    await page.click("#show-save");
    await page.locator("#show-status-msg", { hasText: "visible sur la régie" }).waitFor();
    const saved = Object.values(await library("shows")).find((x) => x.childName === "Léa");
    assert.deepEqual(await sansManche(saved.rounds), [{ type: "statues", duration: 90, chansons: tirees }]);
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
    const son = (k) => SONGS[k].refrainId ?? SONGS[k].audioId;
    assert.deepEqual([q.kind, q.audioIds], ["statues", tirees.map(son)], "le refrain de chacune, dans l'ordre");
    await waitFor(async () => Object.keys((await read("sounds")) ?? {}).length === 3, "chansons copiées dans la partie");
    await regie.context().close();

    // Une manche d'avant (extraits cochés dans les playlists) se joue encore telle quelle.
    const { buildSnapshot } = await import("../web/public/show.js");
    const avant = buildSnapshot("x", { childName: "Tom", age: 7, rounds: [{ type: "statues", duration: 60, songs: [list.tracks[1].audioId] }] }, {}, {}, Math.random, await library("playlists"), {}, {}, SONGS);
    assert.deepEqual(avant.snapshot.quiz.questions[0].audioIds, [list.tracks[1].audioId]);
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
  const defis = async () => (await get(ref(hostDb(), `games/${CODE}/defisFete/list`))).val();

  test("la régie ajoute, modifie et efface les défis en plus de la fête ; les 7 défis de base restent affichés, sans être modifiables", async () => {
    box = startBox();
    const page = await openRegie();
    await pair(page);
    await inRegie(page);
    await page.click("#tab-defis");
    // Rien d'ajouté : les défis de base s'affichent, en lecture seule, et aucun défi en plus.
    await page.locator("#panel-defis .defis-base li").nth(6).waitFor();
    assert.equal(await page.locator("#panel-defis .defis-base li").count(), 7);
    assert.equal(await page.locator("#panel-defis .defis-base input").count(), 0);
    assert.equal(await page.locator("#panel-defis ol.defis input").count(), 0);
    await page.locator("#panel-defis .defis-vide").waitFor();

    await page.fill('#panel-defis input[aria-label="Nouveau défi"]', "Tout le monde imite un lion !");
    await page.click("#panel-defis .defi-ajout button");
    await waitFor(async () => (await defis())?.length === 1, "défi ajouté");
    assert.equal((await defis())[0], "Tout le monde imite un lion !");
    await page.locator("#panel-defis ol.defis input").first().waitFor();

    await page.locator("#panel-defis ol.defis input").first().fill("La ola, deux fois !");
    await page.locator("#panel-defis ol.defis input").first().press("Enter");
    await page.locator("#panel-defis ol.defis input").first().blur();
    await waitFor(async () => (await defis())?.[0] === "La ola, deux fois !", "défi modifié");

    // Le dernier défi effacé : plus rien en plus dans la partie, la TV garde les défis de base.
    await page.locator("#panel-defis .defi-effacer").first().click();
    await waitFor(async () => (await defis()) === null, "défi effacé");
    await page.locator("#panel-defis .defis-vide").waitFor();
    // Les défis de base de la box (réglage commun) ne sont jamais touchés depuis le téléphone.
    assert.equal((await get(ref(hostDb(), "settings/defis"))).val(), null);
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
