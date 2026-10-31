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
// QUOI=courte (cedric, 28/10 : « des séries un peu plus courtes, de manière à mener le jeu de A à Z ») : tous les jeux,
// 2 à 4 éléments chacun, avec la Super Finale ; des drapeaux au Quiz si le pack est importé. Le Simon s'ajoute avec
// MODE=simon une fois la version qui le connaît publiée (la Régie PC d'avant l'enlèverait).
// QUOI=marco (cedric, 28/10 au soir) : « Anniversaire Marco Mouly », la courte avec le Simon, les questions à images
// d'abord.
// QUOI=epstein (cedric, 30/10) : « Anniversaire Epstein », la même pour la TV 0.1.831 (tous les jeux, Simon et Duel
// compris, le plus possible d'images des packs).
// QUOI=diddy (cedric, 31/10) : « Anniversaire P Diddy », la même pour la version du 31/10, le Chrono de Buzzy en plus.
const DIDDY = process.env.QUOI === "diddy" || /^menage4/.test(process.env.MODE ?? "");
const EPSTEIN = process.env.QUOI === "epstein" || DIDDY;
const MARCO = process.env.QUOI === "marco" || EPSTEIN;
const COURTE = process.env.QUOI === "courte" || MARCO;
const ID = DIDDY ? "anniversaire-p-diddy" : EPSTEIN ? "anniversaire-epstein" : MARCO ? "anniversaire-marco-mouly" : COURTE ? "prestation-test-courte" : COMPLETE ? "prestation-test-complete" : "prestation-test-touki-touki";
const base = JSON.parse(readFileSync("firebase-config.json", "utf8")).databaseURL.replace(/\/$/, "");
// LIBRAIRIE=<fichier JSON { quizzes, contents }> : essai local, sans rien lire ni écrire en ligne.
const locale = process.env.LIBRAIRIE ? JSON.parse(readFileSync(process.env.LIBRAIRIE, "utf8")) : null;
const token = locale ? null : (await (await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/firebase.database", "https://www.googleapis.com/auth/userinfo.email"] }).getClient()).getAccessToken()).token;
const get = async (path) => (locale ? (path === "library/quizzes" ? locale.quizzes : path === "library/contents" ? locale.contents : path === "library/songs" ? locale.songs : null)
  : (await fetch(`${base}/${path}.json?access_token=${token}`)).json());

// MODE=menage (cedric, 28/10 au soir : « fais le ménage sur les prestations test ») : efface les prestations de test
// (clé test-… ou prestation-test-…, origine « test », titre avec « test » ou 🧪, fêtes de Touktouka / Touki touki) et
// les manches gardées pour elles. Jamais une autre prestation : le journal n'en donne que le nombre.
if (process.env.MODE === "menage" && !locale) {
  const shows = (await get("library/shows")) ?? {};
  const manches = (await get("library/manches")) ?? {};
  const deTest = ([id, x]) => id !== "anniversaire-marco-mouly" && x && (id.startsWith("test-") || id.startsWith("prestation-test-")
    || x.origin === "test" || /\btest\b|🧪/i.test(x.title ?? "") || /touk/i.test(x.childName ?? ""));
  const effacees = Object.entries(shows).filter(deTest);
  const ids = new Set(effacees.map(([id]) => id));
  const manchesEffacees = Object.entries(manches).filter(([, m]) => ids.has(m?.showId)).map(([id]) => id);
  for (const [id, x] of effacees) console.log(`Effacée : ${id} « ${x.title ?? ""} »`);
  console.log(`${effacees.length} prestations de test et ${manchesEffacees.length} manches à effacer ; ${Object.keys(shows).length - effacees.length} autres prestations gardées`);
  const chemins = Object.fromEntries([...effacees.map(([id]) => [`library/shows/${id}`, null]), ...manchesEffacees.map((id) => [`library/manches/${id}`, null])]);
  if (!Object.keys(chemins).length) process.exit(0);
  const res = await fetch(`${base}/.json?access_token=${token}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(chemins) });
  console.log(res.ok ? "Ménage fait." : `Écriture refusée : ${res.status}`);
  process.exit(res.ok ? 0 : 1);
}
// MODE=menage2 (cedric, 29/10 : « Oui, tu peux faire le ménage dans la régie ») : efface les prestations restantes,
// sauf « Anniversaire Marco Mouly » et toute fête datée du 1er décembre 2026 ou après (les vraies fêtes commencent le
// 2/12 : celles-là sont gardées et signalées). Le journal ne montre ni titre ni prénom.
if (process.env.MODE === "menage2" && !locale) {
  const shows = (await get("library/shows")) ?? {};
  const manches = (await get("library/manches")) ?? {};
  const autres = Object.entries(shows).filter(([id, x]) => x && id !== "anniversaire-marco-mouly");
  const vraie = ([, x]) => `${x.date ?? ""}` >= "2026-12-01";
  for (const [id, x] of autres) console.log(`${vraie([id, x]) ? "Gardée (date de vraie fête)" : "Effacée"} : ${id} · date ${x.date ?? "?"} · ${x.status ?? "?"} · ${(Array.isArray(x.rounds) ? x.rounds : Object.values(x.rounds ?? {})).length} jeux · origine ${x.origin ?? "-"}`);
  const effacees = autres.filter((e) => !vraie(e)).map(([id]) => id);
  const manchesEffacees = Object.entries(manches).filter(([, m]) => effacees.includes(m?.showId)).map(([id]) => id);
  console.log(`${effacees.length} prestations et ${manchesEffacees.length} manches à effacer`);
  if (!effacees.length) process.exit(0);
  const chemins = Object.fromEntries([...effacees.map((id) => [`library/shows/${id}`, null]), ...manchesEffacees.map((id) => [`library/manches/${id}`, null])]);
  const res = await fetch(`${base}/.json?access_token=${token}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(chemins) });
  console.log(res.ok ? "Ménage fait." : `Écriture refusée : ${res.status}`);
  process.exit(res.ok ? 0 : 1);
}
// MODE=menage3 (cedric, 30/10 : « il ne doit rester qu'elle ») : liste, SANS RIEN EFFACER, ce qui serait effacé pour
// ne garder qu'« Anniversaire Epstein » et les fêtes datées du 1er décembre 2026 ou après. MODE=menage3ecrire efface
// cette liste, seulement après l'accord de cedric. Le journal ne montre ni titre ni prénom.
if ((process.env.MODE === "menage3" || process.env.MODE === "menage3ecrire") && !locale) {
  const shows = (await get("library/shows")) ?? {};
  const manches = (await get("library/manches")) ?? {};
  if (!shows["anniversaire-epstein"]) { console.log("« Anniversaire Epstein » n'existe pas : rien n'est effacé."); process.exit(1); }
  const jour = (t) => (typeof t === "number" ? new Date(t).toISOString().slice(0, 16).replace("T", " ") + "Z" : "?");
  const autres = Object.entries(shows).filter(([id, x]) => x && id !== "anniversaire-epstein");
  const vraie = ([, x]) => `${x.date ?? ""}` >= "2026-12-01";
  for (const [id, x] of autres) console.log(`${vraie([id, x]) ? "Gardée (date de vraie fête)" : "À effacer"} : ${id} · date ${x.date ?? "?"} · ${x.status ?? "?"} · ${(Array.isArray(x.rounds) ? x.rounds : Object.values(x.rounds ?? {})).length} jeux · créée ${jour(x.createdAt)} · modifiée ${jour(x.updatedAt)}`);
  // menage3ecrire n'efface que les prestations nommées dans QUOI (celles que cedric a vues dans la liste et acceptées).
  const acceptees = new Set(`${process.env.QUOI ?? ""}`.split(",").map((x) => x.trim()).filter(Boolean));
  const effacees = autres.filter((e) => !vraie(e)).map(([id]) => id).filter((id) => process.env.MODE === "menage3" || acceptees.has(id));
  const manchesEffacees = Object.entries(manches).filter(([, m]) => effacees.includes(m?.showId)).map(([id]) => id);
  const manchesSeules = Object.entries(manches).filter(([, m]) => m?.showId && !shows[m.showId]).length;
  console.log(`${effacees.length} prestations et ${manchesEffacees.length} manches à effacer ; ${Object.keys(manches).length} manches en tout (${manchesSeules} sans prestation, gardées)`);
  if (process.env.MODE === "menage3" || !effacees.length) { console.log("Lecture seule : rien n'est effacé."); process.exit(0); }
  const chemins = Object.fromEntries([...effacees.map((id) => [`library/shows/${id}`, null]), ...manchesEffacees.map((id) => [`library/manches/${id}`, null])]);
  const res = await fetch(`${base}/.json?access_token=${token}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(chemins) });
  console.log(res.ok ? "Ménage fait." : `Écriture refusée : ${res.status}`);
  process.exit(res.ok ? 0 : 1);
}
// MODE=menage4 (cedric, 31/10 : « tu me purges celles d'avant ») : liste, SANS RIEN EFFACER, les prestations autres
// qu'« Anniversaire P Diddy » et les fêtes datées du 1er décembre 2026 ou après. MODE=menage4ecrire efface seulement
// celles nommées dans QUOI (vérifiées une à une). Le journal ne montre ni titre ni prénom, sauf les prestations de test
// connues (Epstein).
if ((process.env.MODE === "menage4" || process.env.MODE === "menage4ecrire") && !locale) {
  const shows = (await get("library/shows")) ?? {};
  const manches = (await get("library/manches")) ?? {};
  if (!shows[ID]) { console.log("« Anniversaire P Diddy » n'existe pas encore : rien n'est effacé."); process.exit(1); }
  const jour = (t) => (typeof t === "number" ? new Date(t).toISOString().slice(0, 16).replace("T", " ") + "Z" : "?");
  const autres = Object.entries(shows).filter(([id, x]) => x && id !== ID);
  const vraie = ([, x]) => `${x.date ?? ""}` >= "2026-12-01";
  const test = ([id, x]) => /^(test-|prestation-test-|anniversaire-(epstein|marco-mouly)$)/.test(id) || x.origine === "test" || /test|🧪/i.test(`${x.title ?? ""}`);
  for (const [id, x] of autres) console.log(`${vraie([id, x]) ? "Gardée (date de vraie fête)" : test([id, x]) ? "Test, à effacer" : "Pas un test connu, gardée"} : ${test([id, x]) ? id : "(sans nom)"} · date ${x.date ?? "?"} · ${x.status ?? "?"} · ${(Array.isArray(x.rounds) ? x.rounds : Object.values(x.rounds ?? {})).length} jeux · créée ${jour(x.createdAt)} · modifiée ${jour(x.updatedAt)}`);
  const acceptees = new Set(`${process.env.QUOI ?? ""}`.split(",").map((x) => x.trim()).filter(Boolean));
  const effacees = autres.filter((e) => !vraie(e) && test(e)).map(([id]) => id).filter((id) => process.env.MODE === "menage4" || acceptees.has(id));
  const manchesEffacees = Object.entries(manches).filter(([, m]) => effacees.includes(m?.showId)).map(([id]) => id);
  console.log(`${effacees.length} prestations et ${manchesEffacees.length} manches à effacer ; ${Object.keys(manches).length} manches en tout`);
  if (process.env.MODE === "menage4" || !effacees.length) { console.log("Lecture seule : rien n'est effacé."); process.exit(0); }
  const chemins = Object.fromEntries([...effacees.map((id) => [`library/shows/${id}`, null]), ...manchesEffacees.map((id) => [`library/manches/${id}`, null])]);
  const res = await fetch(`${base}/.json?access_token=${token}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(chemins) });
  console.log(res.ok ? `Ménage fait : ${effacees.join(", ")}` : `Écriture refusée : ${res.status}`);
  process.exit(res.ok ? 0 : 1);
}
// MODE=chiffres (cedric, 29/10) : combien de Juste Chiffre dans les packs, par thème. Lecture seule.
if (process.env.MODE === "chiffres" && !locale) {
  const qz = (await get("library/quizzes")) ?? {};
  const parTheme = {};
  let total = 0, packsAvec = 0, nbPacks = 0;
  for (const [id, q] of Object.entries(qz)) {
    if (q?.pack !== true || id.startsWith("test-")) continue;
    nbPacks++;
    const n = playable(q).filter((x) => x.kind === "number").length;
    const t = `${q.theme || q.title || "?"}`.slice(0, 40);
    parTheme[t] = parTheme[t] ?? { packs: 0, chiffres: 0, questions: 0 };
    parTheme[t].packs++; parTheme[t].chiffres += n; parTheme[t].questions += playable(q).length;
    total += n; if (n) packsAvec++;
  }
  console.log(`${nbPacks} packs ; ${packsAvec} avec des Juste Chiffre ; ${total} Juste Chiffre en tout`);
  for (const [t, v] of Object.entries(parTheme).sort((a, b) => b[1].chiffres - a[1].chiffres)) console.log(`${t} : ${v.packs} packs, ${v.chiffres} Juste Chiffre sur ${v.questions} questions`);
  const ex = Object.values(qz).filter((q) => q?.pack === true).flatMap((q) => playable(q).filter((x) => x.kind === "number").slice(0, 1).map((x) => `[${q.theme ?? ""}] ${x.text}`)).slice(0, 8);
  for (const e of ex) console.log(`Exemple : ${e.slice(0, 120)}`);
  process.exit(0);
}
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
const aImages = (q) => /^[0-9a-f]{16}$/.test(q?.imageId ?? "") || Object.values(q?.choiceImages ?? {}).some((x) => /^[0-9a-f]{16}$/.test(x ?? ""));
const pioche = (liste, f, n) => {
  // Marco Mouly : seulement les questions avec leurs images quand il y en a assez.
  const garder = (qs) => (MARCO && qs.filter(aImages).length ? qs.filter(aImages) : qs);
  const tas = melange(liste).map(([, q]) => melange(garder(f(q))));
  const out = [];
  for (let k = 0; out.length < n && tas.some((t) => t.length); k = (k + 1) % tas.length) if (tas[k].length) out.push(versSerie(tas[k].pop()));
  return out;
};
const serie = (type, liste, f, n) => liste.length && { type, seriesQuiz: [{ id: "de", origine: "de", questions: pioche(liste, f, n) }] };
// Chansons de la bibliothèque des sons, mélangées, jamais deux fois : Blind test, Quiz musical, Statues.
const chansons = melange(Object.entries(songs ?? {}).filter(([, x]) => chansonJouable(x)).map(([id]) => id));
const prendre = (n) => chansons.splice(0, n);
// Les packs de drapeaux (cedric, 28/10), s'ils sont importés : la moitié du Quiz de la prestation courte.
const drapeaux = packs.filter(([, q]) => /drapeau/i.test(`${q.title ?? ""} ${q.theme ?? ""}`) && quizKind(q) !== "images");
const N = (long, court) => (COURTE ? court : long);
const quizCourt = () => {
  const avec = pioche(drapeaux, playable, 2);
  return { type: "quiz", finale: 1, seriesQuiz: [{ id: "de", origine: "de", questions: [...avec, ...pioche(quiz, playable, 4 - avec.length)] }] };
};
const court = (r) => (COURTE && r ? { ...r, ...(["quiz", "illustre"].includes(r.type) ? { finale: 1 } : {}) } : r);
const parJeuType = {
  quiz: COURTE ? quizCourt() : serie("quiz", quiz, playable, 20),
  illustre: court(serie("illustre", illustres, playable, N(20, 3))),
  zoom: serie("zoom", photos.slice(0, moitie), zoomQuestions, N(10, 3)),
  flou: photos.length > 1 && serie("flou", photos.slice(moitie), zoomQuestions, N(10, 3)),
  express: serie("express", vraiFaux, expressQuestions, N(12, 4)),
  quisuis: qui.length && { type: "quisuis", picks: qui.slice(0, N(10, 3)).map((x) => CONTENT_GAMES.quisuis.key(x)) },
  disparu: tours.length && { type: "disparu", objects: 6, seriesMots: [{ id: "de", origine: "de", mots: tours.slice(0, N(5, 2)) }] },
  duel: COURTE ? { type: "duel", joueurs: 1, dureeMin: 15, dureeMax: 25, longs: false } : { type: "duel" },
  coffres: { type: "coffres" },
  simon: { type: "simon", tours: 2, joueurs: 1 },
  chrono: { type: "chrono" },
  mimes: COURTE ? { type: "mimes", perTeam: 1 } : { type: "mimes" },
  blind: chansons.length && { type: "blind", chansons: prendre(N(10, 3)) },
  musical: chansons.length && { type: "musical", chansons: prendre(N(8, 3)) },
  statues: { type: "statues", ...(chansons.length ? { chansons: prendre(N(4, 2)) } : {}) },
  chante: COURTE ? { type: "chante", count: 3 } : { type: "chante" },
  pictionary: COURTE ? { type: "pictionary", passages: 1 } : { type: "pictionary" },
  gonfleur: { type: "gonfleur" },
  patate: COURTE ? { type: "patate", bombs: 1 } : { type: "patate" },
};
// L'ordre d'une vraie fête (celui de la prestation de test de la Régie PC), les Coffres pour finir.
const ORDRE = COMPLETE || COURTE
  ? ["quiz", "mimes", "blind", "zoom", "chante", "express", "illustre", "quisuis", "flou", "disparu", "musical", "statues", "pictionary", "gonfleur", "duel", "patate", ...(MARCO ? ["simon"] : []), ...(DIDDY ? ["chrono"] : []), "coffres"]
  : ["quiz", "illustre", "zoom", "flou", "express", "quisuis", "disparu", "duel", "coffres"];
const rounds = [
  ...ORDRE.map((t) => parJeuType[t]),
].filter(Boolean).map((r) => cleanRound(r));

const demain = new Date(Date.now() + 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const show = DIDDY
  ? { childName: "P Diddy", age: 9, teams: 4, date: isoDay(), status: "publiee", title: "Anniversaire P Diddy", rounds,
    notes: "Prestation de test (31/10) : tous les jeux, Simon, Duel et Chrono de Buzzy compris, séries courtes, images des packs d'abord." }
  : EPSTEIN
  ? { childName: "Epstein", age: 9, teams: 4, date: isoDay(), status: "publiee", title: "Anniversaire Epstein", rounds,
    notes: "Prestation de test (30/10, TV 0.1.831) : tous les jeux, Simon et Duel compris, séries courtes, images des packs d'abord." }
  : MARCO
  ? { childName: "Marco Mouly", age: 9, teams: 4, date: isoDay(), status: "publiee", title: "Anniversaire Marco Mouly", rounds,
    notes: "Prestation de test (28/10) : tous les jeux, Simon compris, séries courtes, images des packs d'abord." }
  : COURTE
  ? { childName: "Touki touki", age: 9, teams: 4, date: isoDay(), status: "publiee", title: "Prestation test courte", rounds,
    notes: "Prestation de test courte : tous les jeux, 2 à 4 éléments chacun, pour les jouer de A à Z (28/10)." }
  : COMPLETE
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
console.log(`Drapeaux : ${drapeaux.length} pack(s)`);
// MODE=simon : ajoute le Simon du Prof (2 tours, 1 joueur par équipe) avant les Coffres de la prestation courte déjà
// écrite, s'il n'y est pas encore. Rien d'autre ne change.
if (process.env.MODE === "simon" && COURTE && !locale) {
  const tours = deja?.rounds ? (Array.isArray(deja.rounds) ? deja.rounds : Object.values(deja.rounds)) : null;
  if (!tours) { console.log("La prestation courte n'existe pas encore : rien n'est écrit."); process.exit(1); }
  if (tours.some((r) => r?.type === "simon")) { console.log("Le Simon y est déjà."); process.exit(0); }
  const k = tours.findIndex((r) => r?.type === "coffres");
  const avecSimon = [...tours];
  avecSimon.splice(k < 0 ? avecSimon.length : k, 0, cleanRound({ type: "simon", tours: 2, joueurs: 1 }));
  const essai = buildSnapshot(ID, { ...deja, rounds: avecSimon }, quizzes, {}, Math.random, {}, contents ?? {}, {}, songs ?? {});
  console.log(`Avec le Simon : ${avecSimon.length} jeux ; problèmes : ${essai.problems.length ? essai.problems.join(" | ") : "aucun"}`);
  if (essai.problems.length) process.exit(1);
  const res = await fetch(`${base}/library/shows/${ID}.json?access_token=${token}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ rounds: avecSimon, updatedAt: { ".sv": "timestamp" } }),
  });
  console.log(res.ok ? "Simon ajouté." : `Écriture refusée : ${res.status}`);
  process.exit(res.ok ? 0 : 1);
}
if (process.env.MODE !== "ecrire" || locale) process.exit(0);
if (deja) { console.log("Une prestation porte déjà ce nom : rien n'est écrit."); process.exit(1); }
if (problems.length || !rounds.length) { console.log("Programme incomplet : rien n'est écrit."); process.exit(1); }
const res = await fetch(`${base}/library/shows/${ID}.json?access_token=${token}`, {
  method: "PUT", headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...show, createdAt: { ".sv": "timestamp" }, updatedAt: { ".sv": "timestamp" } }),
});
console.log(res.ok ? "Prestation ajoutée." : `Écriture refusée : ${res.status}`);
process.exit(res.ok ? 0 : 1);
