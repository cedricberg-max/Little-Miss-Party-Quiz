// Import d'un quiz : texte collé depuis Gemini (avec la consigne fournie), lignes copiées d'un tableur
// (Google Sheets, Excel) ou fichier CSV, ou JSON. Fonctions pures, sans Firebase : l'administration
// affiche le résultat pour relecture, Sarah valide chaque question avant qu'elle soit jouée.
import { PROFILES, MIN_DURATION_SEC, MAX_DURATION_SEC } from "./profiles.js";

export const LETTERS = ["A", "B", "C", "D"];
export const MAX_TEXT = 300;
export const MAX_CHOICE = 120;

/** Consigne à copier dans Gemini : elle produit exactement le format texte lu par [parseQuiz]. */
export function geminiPrompt({ theme = "", age = "", count = 8 } = {}) {
  const sujet = theme.trim() ? `sur le thème « ${theme.trim()} »` : "sur des thèmes variés";
  const public_ = String(age).trim() ? `des enfants de ${String(age).trim()} ans` : "des enfants de 6 à 15 ans";
  return [
    `Crée un quiz de ${count} questions ${sujet}, pour ${public_}, à jouer en équipes lors d'un anniversaire.`,
    "Questions courtes, vocabulaire simple, une seule bonne réponse, aucune question piège ni moqueuse.",
    "Quatre propositions par question (ou Vrai / Faux), courtes et toutes plausibles.",
    "Réponds uniquement dans ce format, sans aucun autre texte :",
    "",
    "Titre : <titre du quiz>",
    "",
    "1. <question>",
    "A) <proposition>",
    "B) <proposition>",
    "C) <proposition>",
    "D) <proposition>",
    "Réponse : <lettre de la bonne réponse>",
    "",
    "2. <question>",
    "…",
  ].join("\n");
}

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const words = (s) => String(s ?? "").trim().split(/\s+/).filter(Boolean).length;

/**
 * Lit le texte collé et renvoie `{ title, theme, ageMin, ageMax, format, questions }`.
 * Chaque question : `{ text, choices, correct (index ou -1), duration (ou null), double, marks }`.
 * Rien n'est rejeté ici : les anomalies sont signalées par [checkQuestions].
 */
export function parseQuiz(input) {
  const text = String(input ?? "").replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const json = tryJson(text);
  if (json) return json;
  if (looksTabular(text)) return parseTable(text);
  return parseText(text);
}

// ---------- JSON ----------

function tryJson(text) {
  const body = text.replace(/```(?:json)?/gi, "").trim();
  if (!/^[[{]/.test(body)) return null;
  let data;
  try { data = JSON.parse(body); } catch { return null; }
  const list = Array.isArray(data) ? data : data.questions;
  if (!Array.isArray(list)) return null;
  return {
    title: clean(data.title ?? data.titre ?? ""),
    theme: clean(data.theme ?? data.thème ?? ""),
    ageMin: num(data.ageMin), ageMax: num(data.ageMax),
    format: "json",
    questions: list.map((q) => {
      const choices = (q.choices ?? q.propositions ?? q.options ?? q.reponses ?? q.réponses ?? []).map(clean);
      const raw = q.correct ?? q.answer ?? q.bonne_reponse ?? q.bonneReponse ?? q.reponse ?? q.réponse;
      // Le format du projet compte à partir de 0 ; un nombre égal au nombre de propositions vient d'un comptage à partir de 1.
      const correct = typeof raw === "number" ? (raw === choices.length ? raw - 1 : raw) : resolveCorrect(raw, choices);
      return finish({
        text: clean(q.text ?? q.question ?? q.intitule ?? ""),
        choices, correct: Number.isInteger(correct) ? correct : -1,
        duration: num(q.duration ?? q.duree ?? q.durée), double: q.double === true, marks: 0,
      });
    }),
  };
}

// ---------- Tableur ----------

function looksTabular(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  if (!lines.length) return false;
  const tabbed = lines.filter((l) => l.includes("\t")).length;
  if (tabbed >= Math.max(1, lines.length / 2)) return true;
  const first = lines[0];
  for (const sep of [";", ","]) {
    const cells = splitRow(first, sep);
    if (cells.length >= 4 && cells.some((c) => /question/i.test(c))) return true;
    if (sep === ";" && lines.every((l) => splitRow(l, ";").length >= 4)) return true;
  }
  return false;
}

function delimiter(text) {
  const first = text.split("\n").find((l) => l.trim()) ?? "";
  if (first.includes("\t")) return "\t";
  return splitRow(first, ";").length >= splitRow(first, ",").length ? ";" : ",";
}

/** Une ligne de CSV, guillemets compris (un guillemet doublé est un guillemet). */
function splitRow(line, sep) {
  const cells = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"' && cur.trim() === "") { quoted = true; cur = ""; } else if (c === sep) { cells.push(cur); cur = ""; } else cur += c;
  }
  cells.push(cur);
  return cells.map((s) => s.trim());
}

function rows(text, sep) {
  // Une cellule entre guillemets peut contenir un retour à la ligne (copie depuis Sheets).
  const out = [];
  let buf = "";
  for (const line of text.split("\n")) {
    buf = buf ? `${buf}\n${line}` : line;
    if ((buf.match(/"/g) ?? []).length % 2 === 0) { if (buf.trim()) out.push(splitRow(buf, sep)); buf = ""; }
  }
  if (buf.trim()) out.push(splitRow(buf, sep));
  return out;
}

function headerMap(cells) {
  const map = { text: -1, choices: [], correct: -1, duration: -1, double: -1 };
  cells.forEach((raw, i) => {
    const c = norm(raw);
    if (/^(bonne|correct|solution)|^reponse$|^reponse (correcte|juste)/.test(c)) map.correct = i;
    else if (/question|intitule|enonce/.test(c)) map.text = i;
    else if (/^(reponse|proposition|choix|option)s? ?[a-d1-4]$|^[a-d]$/.test(c)) map.choices.push(i);
    else if (/duree|temps|chrono|secondes/.test(c)) map.duration = i;
    else if (/double|x2|×2|finale/.test(c)) map.double = i;
  });
  return map.text >= 0 && map.choices.length >= 2 ? map : null;
}

function parseTable(text) {
  const all = rows(text, delimiter(text));
  const header = all.length ? headerMap(all[0]) : null;
  const body = header ? all.slice(1) : all;
  const questions = body.filter((r) => r.some((c) => c)).map((r) => {
    if (header) {
      const choices = header.choices.map((i) => clean(r[i])).filter(Boolean);
      return finish({
        text: clean(r[header.text]),
        choices,
        correct: header.correct >= 0 ? resolveCorrect(r[header.correct], choices) : -1,
        duration: header.duration >= 0 ? num(r[header.duration]) : null,
        double: header.double >= 0 && /^(oui|x|1|vrai|true|×?2|x2)$/i.test(String(r[header.double] ?? "").trim()),
        marks: 0,
      });
    }
    // Sans en-tête : question, propositions, bonne réponse, puis durée facultative.
    const cells = r.map(clean);
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    const [q, ...rest] = cells;
    let duration = null;
    if (rest.length >= 4 && /^\d+$/.test(rest[rest.length - 1]) && Number(rest[rest.length - 1]) > 4) duration = Number(rest.pop());
    const answer = rest.length >= 3 ? rest.pop() : "";
    const choices = rest.filter(Boolean);
    return finish({ text: q ?? "", choices, correct: resolveCorrect(answer, choices), duration, double: false, marks: 0 });
  });
  return { title: "", theme: "", ageMin: null, ageMax: null, format: "tableur", questions };
}

// ---------- Texte (Gemini) ----------

const RE = {
  title: /^titre\s*(?:du quiz)?\s*:\s*(.+)$/i,
  theme: /^th[eè]me\s*:\s*(.+)$/i,
  age: /^(?:[aâ]ge|tranche d'[aâ]ge|public)\s*:\s*(\d+)(?:\s*(?:-|à|a|–)\s*(\d+))?/i,
  answer: /^(?:la\s+)?(?:bonne\s+)?r[ée]ponse(?:\s+(?:correcte|juste|attendue))?\s*:\s*(.+)$/i,
  duration: /^(?:dur[ée]e|temps|chrono)\s*:\s*(\d+)/i,
  choice: /^(?:[-*•]\s*)?\(?([A-Da-d])\s*[).:\-–]\s+(.+)$/,
  bullet: /^[-*•]\s+(.+)$/,
  numbered: /^(?:q(?:uestion)?\s*)?(\d{1,3})\s*[.):\-–]\s*(.+)$/i,
  labelled: /^q(?:uestion)?\s*\d*\s*:\s*(.+)$/i,
};
const CORRECT_MARK = /\s*(?:✅|✔️?|☑️?|\((?:bonne réponse|correcte?|vrai)\)|\*)\s*$/i;

function parseText(text) {
  const out = { title: "", theme: "", ageMin: null, ageMax: null, format: "texte", questions: [] };
  let cur = null;
  const push = () => { if (cur) out.questions.push(finish(cur)); cur = null; };
  const start = (t) => { push(); cur = { text: t, choices: [], correct: -1, answer: null, duration: null, double: false, marks: 0, markIdx: [] }; };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\*\*|__/g, "").replace(/^#+\s*/, "").replace(/^>\s*/, "").trim();
    if (!line || /^[-=_*]{3,}$/.test(line) || /^```/.test(line)) continue;
    let m;
    if (!cur && (m = line.match(RE.title))) { out.title = clean(m[1]); continue; }
    if (!cur && (m = line.match(RE.theme))) { out.theme = clean(m[1]); continue; }
    if (!cur && (m = line.match(RE.age))) { out.ageMin = Number(m[1]); out.ageMax = Number(m[2] ?? m[1]); continue; }
    if (cur && (m = line.match(RE.answer))) { cur.answer = m[1]; continue; }
    if (cur && (m = line.match(RE.duration))) { cur.duration = Number(m[1]); continue; }
    if (cur && cur.text && (m = line.match(RE.choice))) { addChoice(cur, m[2]); continue; }
    if (cur && cur.text && !cur.answer && (m = line.match(RE.bullet))) { addChoice(cur, m[1]); continue; }
    if ((m = line.match(RE.numbered)) && !(cur && !cur.choices.length && /^\d+$/.test(m[1]) && cur.text === "")) { start(m[2]); continue; }
    if ((m = line.match(RE.labelled))) { start(m[1]); continue; }
    if (!cur || cur.choices.length || cur.answer) { start(line); continue; }
    cur.text = `${cur.text} ${line}`.trim();
  }
  push();
  return out;
}

function addChoice(q, raw) {
  let text = raw.trim();
  if (CORRECT_MARK.test(text)) { text = text.replace(CORRECT_MARK, ""); q.markIdx.push(q.choices.length); }
  q.choices.push(clean(text));
}

/** Derniers réglages communs : double (Super Finale), bonne réponse, marques en double. */
function finish(q) {
  let text = clean(q.text);
  let double = q.double === true;
  const dbl = /\s*\((?:x2|×2|points? doubl[ée]s?|super finale)\)\s*$/i;
  if (dbl.test(text)) { double = true; text = text.replace(dbl, ""); }
  let correct = q.correct;
  let marks = q.marks ?? 0;
  if (q.markIdx) {
    marks = q.markIdx.length;
    if (q.answer != null) correct = resolveCorrect(q.answer, q.choices);
    else if (q.markIdx.length === 1) correct = q.markIdx[0];
  }
  return { text, choices: q.choices, correct, duration: q.duration ?? null, double, marks };
}

/**
 * Bonne réponse écrite en toutes lettres, par sa lettre (« B », « B) Le lion ») ou son numéro (1 à 4).
 * Le texte exact d'une proposition passe avant : « 8 » désigne la proposition « 8 », pas la 8e.
 */
export function resolveCorrect(raw, choices) {
  const value = clean(raw ?? "");
  if (!value) return -1;
  const byText = choices.findIndex((c) => norm(c) === norm(value));
  if (byText >= 0) return byText;
  const m = value.match(/^\(?([A-Da-d])(?:\s*[).:\-–]\s*(.*))?$/);
  if (m) {
    const i = LETTERS.indexOf(m[1].toUpperCase());
    if (i < choices.length) return i;
  }
  if (/^[1-4]$/.test(value) && Number(value) <= choices.length) return Number(value) - 1;
  const partial = choices.findIndex((c) => norm(value).includes(norm(c)) && norm(c).length > 2);
  return partial;
}

function clean(s) { return String(s ?? "").replace(/\s+/g, " ").trim(); }
function num(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/\s*s(ec(ondes?)?)?$/i, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : null;
}

// ---------- Relecture ----------

/**
 * Anomalies de chaque question : `errors` (la question ne peut pas être validée) et `warnings`
 * (à regarder, la validation reste possible). [existing] : textes déjà présents dans la bibliothèque.
 */
export function checkQuestions(questions, { profile = null, existing = [] } = {}) {
  const p = PROFILES[profile];
  const known = new Set(existing.map(norm));
  const seen = new Map();
  return questions.map((q, i) => {
    const errors = [];
    const warnings = [];
    const key = norm(q.text);
    if (!key) errors.push("Question vide.");
    if (q.text.length > MAX_TEXT) errors.push(`Question trop longue (${q.text.length} caractères, ${MAX_TEXT} au plus).`);
    if (q.choices.length < 2) errors.push("Il faut au moins 2 propositions.");
    if (q.choices.length > 4) errors.push(`${q.choices.length} propositions : 4 au plus.`);
    if (q.choices.some((c) => !c)) errors.push("Une proposition est vide.");
    if (q.choices.some((c) => c.length > MAX_CHOICE)) errors.push(`Une proposition dépasse ${MAX_CHOICE} caractères.`);
    if (new Set(q.choices.map(norm)).size !== q.choices.length) errors.push("Deux propositions sont identiques.");
    if ((q.marks ?? 0) > 1) errors.push("Plusieurs propositions sont marquées comme bonne réponse.");
    else if (!(q.correct >= 0 && q.correct < q.choices.length)) errors.push("Bonne réponse absente ou introuvable dans les propositions.");
    if (q.duration != null && (q.duration < MIN_DURATION_SEC || q.duration > MAX_DURATION_SEC)) {
      errors.push(`Durée de ${q.duration} s : entre ${MIN_DURATION_SEC} et ${MAX_DURATION_SEC} s.`);
    }
    if (p && words(q.text) > p.maxWords) warnings.push(`${words(q.text)} mots : long pour le profil ${p.label} (${p.maxWords} au plus).`);
    if (p?.maxChoiceWords && q.choices.some((c) => words(c) > p.maxChoiceWords)) {
      warnings.push(`Propositions de plus de ${p.maxChoiceWords} mots : longues pour le profil ${p.label}.`);
    }
    if (key && seen.has(key)) warnings.push(`Même question que la n° ${seen.get(key) + 1}.`);
    else if (key) seen.set(key, i);
    if (key && known.has(key)) warnings.push("Cette question existe déjà dans la bibliothèque.");
    return { errors, warnings };
  });
}
