// « Prestation test touki touki » (cedric, 27/10 au soir) : une prestation de test remplie avec le plus possible
// d'images et de questions de ses packs, pour la TV 0.1.701 (pas de Simon). MODE=apercu : rien n'est écrit, le
// programme est seulement vérifié ; MODE=ecrire : la prestation est ajoutée (jamais remplacée, rien n'est effacé).
// Le dépôt est public : le journal ne montre que des nombres.
import { readFileSync } from "node:fs";
const { GoogleAuth } = process.env.LIBRAIRIE ? {} : await import("google-auth-library");
import { buildSnapshot, chansonJouable, quizKind, playable, zoomQuestions, expressQuestions, activeItems, CONTENT_GAMES, isoDay } from "../../web/public/show.js";
import { cleanRound } from "../../web/public/manches.js";

// QUOI=complete (cedric, 27/10 au soir : « il manquait les trois quarts des jeux ») : tous les jeux que la TV 0.1.701
// connaît (pas encore le Simon), les jeux à packs remplis avec les packs, les chansons tirées dans la bibliothèque.
const COMPLETE = process.env.QUOI === "complete";
const ID = COMPLETE ? "prestation-test-complete" : "prestation-test-touki-touki";
const base = JSON.parse(readFileSync("firebase-config.json", "utf8")).databaseURL.replace(/\/$/, "");
// LIBRAIRIE=<fichier JSON { quizzes, contents }> : essai local, sans rien lire ni écrire en ligne.
const locale = process.env.LIBRAIRIE ? JSON.parse(readFileSync(process.env.LIBRAIRIE, "utf8")) : null;
const token = locale ? null : (await (await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/firebase.database", "https://www.googleapis.com/auth/userinfo.email"] }).getClient()).getAccessToken()).token;
const get = async (path) => (locale ? (path === "library/quizzes" ? locale.quizzes : path === "library/contents" ? locale.contents : path === "library/songs" ? locale.songs : null)
  : (await fetch(`${base}/${path}.json?access_token=${token}`)).json());

const [quizzes, contents, deja, songs] = await Promise.all([get("library/quizzes"), get("library/contents"), get(`library/shows/${ID}`), get("library/songs")]);
const packs = Object.entries(quizzes ?? {}).filter(([id, q]) => q?.pack === true && !id.startsWith("test-"));
const parSorte = (k) => packs.filter(([, q]) => quizKind(q) === k);
const ids = (l) => l.map(([id]) => id);

// Vrai ou Faux : les packs classiques qui en ont ; le Quiz : les autres packs classiques.
const classiques = parSorte("classique");
const vraiFaux = classiques.filter(([, q]) => expressQuestions(q).length >= 3 && expressQuestions(q).length >= playable(q).length / 2);
const quiz = classiques.filter(([id]) => !vraiFaux.some(([v]) => v === id));
const illustres = parSorte("photo");
const photos = parSorte("images").filter(([, q]) => zoomQuestions(q).length);
const moitie = Math.ceil(photos.length / 2);
const nb = (l, f) => l.reduce((t, [, q]) => t + f(q).length, 0);

// Qui a disparu ? : des familles de 6 cartes avec les images des réponses des packs illustrés (bien cadrées, carrées).
const familles = illustres.map(([, q]) => {
  const vues = new Map();
  for (const x of playable(q)) (x.choices ?? []).forEach((w, k) => { const img = x.choiceImages?.[k]; if (w && /^[0-9a-f]{16}$/.test(img ?? "") && !vues.has(w)) vues.set(w, img); });
  return { theme: (q.theme || q.title || "Pack").slice(0, 40), objects: [...vues].map(([word, imageId]) => ({ word, imageId })) };
}).filter((f) => f.objects.length >= 6);
const vusThemes = new Set();
const tours = familles.filter((f) => !vusThemes.has(f.theme.toLowerCase()) && vusThemes.add(f.theme.toLowerCase())).slice(0, 5)
  .map((f) => ({ theme: f.theme, objects: f.objects.slice(0, 6) }));

// Qui suis-je ? : les personnages des packs (avec leur image), choisis un par un.
const qui = activeItems("quisuis", contents?.quisuis).filter((x) => x?.serie && x?.imageId).slice(0, 10);

// Chaque jeu pioche à tour de rôle une question au hasard dans chacun de ses packs : le plus de packs possible, sous
// un titre de jeu normal (pas la liste de tous les packs).
const melange = (l) => l.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
const versSerie = (q) => (q.kind === "number" ? { text: q.text, nombre: true, correct: q.correct }
  : { text: q.text, choices: q.choices, correct: q.correct, ...(q.imageId ? { imageId: q.imageId } : {}), ...(q.choiceImages ? { choiceImages: q.choiceImages } : {}) });
const pioche = (liste, f, n) => {
  const tas = melange(liste).map(([, q]) => melange(f(q)));
  const out = [];
  for (let k = 0; out.length < n && tas.some((t) => t.length); k = (k + 1) % tas.length) if (tas[k].length) out.push(versSerie(tas[k].pop()));
  return out;
};
const serie = (type, liste, f, n) => liste.length && { type, seriesQuiz: [{ id: "de", origine: "de", questions: pioche(liste, f, n) }] };
// Chansons de la bibliothèque des sons, mélangées, jamais deux fois : Blind test, Quiz musical, Statues.
const chansons = melange(Object.entries(songs ?? {}).filter(([, x]) => chansonJouable(x)).map(([id]) => id));
const prendre = (n) => chansons.splice(0, n);
const parJeuType = {
  quiz: serie("quiz", quiz, playable, 20),
  illustre: serie("illustre", illustres, playable, 20),
  zoom: serie("zoom", photos.slice(0, moitie), zoomQuestions, 10),
  flou: photos.length > 1 && serie("flou", photos.slice(moitie), zoomQuestions, 10),
  express: serie("express", vraiFaux, expressQuestions, 12),
  quisuis: qui.length && { type: "quisuis", picks: qui.map((x) => CONTENT_GAMES.quisuis.key(x)) },
  disparu: tours.length && { type: "disparu", objects: 6, seriesMots: [{ id: "de", origine: "de", mots: tours }] },
  duel: { type: "duel" },
  coffres: { type: "coffres" },
  mimes: { type: "mimes" },
  blind: chansons.length && { type: "blind", chansons: prendre(10) },
  musical: chansons.length && { type: "musical", chansons: prendre(8) },
  statues: { type: "statues", ...(chansons.length ? { chansons: prendre(4) } : {}) },
  chante: { type: "chante" },
  pictionary: { type: "pictionary" },
  gonfleur: { type: "gonfleur" },
  patate: { type: "patate" },
};
// L'ordre d'une vraie fête (celui de la prestation de test de la Régie PC), les Coffres pour finir.
const ORDRE = COMPLETE
  ? ["quiz", "mimes", "blind", "zoom", "chante", "express", "illustre", "quisuis", "flou", "disparu", "musical", "statues", "pictionary", "gonfleur", "duel", "patate", "coffres"]
  : ["quiz", "illustre", "zoom", "flou", "express", "quisuis", "disparu", "duel", "coffres"];
const rounds = [
  ...ORDRE.map((t) => parJeuType[t]),
].filter(Boolean).map((r) => cleanRound(r));

const demain = new Date(Date.now() + 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const show = COMPLETE
  ? { childName: "Touki touki", age: 9, teams: 4, date: demain, status: "publiee", title: "Prestation test complète", rounds,
    notes: "Prestation de test : tous les jeux, remplis avec les packs et la bibliothèque des sons (27/10)." }
  : { childName: "Touki touki", age: 9, teams: 4, date: isoDay(), status: "publiee", title: "Prestation test touki touki", rounds, notes: "Prestation de test : le plus possible d'images et de questions des packs (27/10)." };
const { snapshot, problems } = buildSnapshot(ID, show, quizzes, {}, Math.random, {}, contents ?? {}, {}, songs ?? {});
console.log(`Packs : ${quiz.length} quiz (${nb(quiz, playable)} questions), ${illustres.length} illustrés (${nb(illustres, playable)}), ${photos.length} séries de photos (${nb(photos, zoomQuestions)}), ${vraiFaux.length} Vrai ou Faux`);
console.log(`Chansons jouables : ${Object.values(songs ?? {}).filter(chansonJouable).length}`);
console.log(`Qui a disparu ? : ${tours.length} tours ; Qui suis-je ? : ${qui.length} personnages`);
console.log(`Jeux : ${rounds.map((r) => r.type).join(", ")}`);
const parJeu = {};
for (const q of snapshot?.quiz?.questions ?? []) parJeu[q.round] = (parJeu[q.round] ?? 0) + 1;
console.log(`Programme : ${snapshot?.quiz?.questions?.length ?? 0} éléments ; ${Object.entries(parJeu).map(([t, n]) => `${t} ${n}`).join(" · ")}`);
console.log(`Problèmes : ${problems.length ? problems.join(" | ") : "aucun"}`);
console.log(`Déjà en ligne : ${deja ? "oui" : "non"}`);
if (process.env.MODE !== "ecrire" || locale) process.exit(0);
if (deja) { console.log("Une prestation porte déjà ce nom : rien n'est écrit."); process.exit(1); }
if (problems.length || !rounds.length) { console.log("Programme incomplet : rien n'est écrit."); process.exit(1); }
const res = await fetch(`${base}/library/shows/${ID}.json?access_token=${token}`, {
  method: "PUT", headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...show, createdAt: { ".sv": "timestamp" }, updatedAt: { ".sv": "timestamp" } }),
});
console.log(res.ok ? "Prestation ajoutée." : `Écriture refusée : ${res.status}`);
process.exit(res.ok ? 0 : 1);
