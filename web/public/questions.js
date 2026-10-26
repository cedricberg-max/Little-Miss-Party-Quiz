// Bibliothèque › Questions de la Régie PC (cedric, 22/10) : des groupes et une seule recherche.
// - Les questions toutes prêtes de l'appli, jamais modifiées ici, en deux rubriques à ne pas mélanger (cedric, 22/10) :
//   « Quiz classique » (questions à 4 réponses écrites, banque-classiques.js, avec une illustration pour la révélation,
//   et le Juste Chiffre tout prêt, banque-chiffres.js, sans illustration : la TV montre son compteur) et
//   « Quiz illustré » (banque des tout-petits : une image par réponse), et le « Vrai ou Faux » tout prêt (cedric, 23/10 :
//   des affirmations sans image, banque-vrai-faux.js, tirées au 🎲 dans le Vrai ou Faux express).
// - « Mes questions » : celles écrites à la main dans la Régie PC, avec leur illustration.
// - « Mes packs » : les quiz importés (fichier JSON, tableur, texte collé), un pack par thème.
// - « Mes séries de photos » (cedric, 23/10) : ses quiz de photos à deviner, pour le Zoom mystère et l'Image floue
//   (une série « Disney », « Animaux »…), à part de ses questions et de ses packs.
// - « Questions de test » : celles des prestations de test (Paramètres), à part pour ne pas encombrer les siennes.
// Chaque question dit si son illustration est là ; sinon la Régie PC affiche une petite alerte. Fonctions pures, testées.
import { parseQuiz } from "./importer.js";
import { cataloguePetits, FAMILLES_PETITS, motBanque } from "./banque-petits.js";
import { PHOTOS_BANQUE } from "./banque-photos.js";
import { QUESTIONS_TOUT_PRETES, THEMES_TOUT_PRETS, estJusteChiffre } from "./banque-classiques.js";
import { libelleNiveau } from "./banque-chiffres.js";
import { AFFIRMATIONS, THEMES_VRAI_FAUX } from "./banque-vrai-faux.js";
import { quizKind } from "./show.js";
import { etiquettes, familleDuQuiz, niveauDuQuiz } from "./rangement.js";

export const GROUPES_QUESTIONS = {
  // Ses thèmes (ses packs) d'abord (cedric, 25/10 : « le genre de série que je vais utiliser en priorité »).
  packs: "🎨 Mes thèmes", classiques: "📝 Quiz classique tout prêt", illustrees: "🖼️ Quiz illustré tout prêt", vraifaux: "✅ Vrai ou Faux tout prêt",
  miennes: "✍️ Mes questions en vrac", photos: "🔍 Mes séries de photos", tests: "🧪 Questions de test",
};
export const JUSTE_CHIFFRE = "🔢 Juste Chiffre";
export const QUESTION_4_REPONSES = "❓ Question à 4 réponses toute prête";

const IMAGE_ID = /^[0-9a-f]{16}$/;
/** Les questions d'un quiz, dans l'ordre, sans les cases vides (la base rend parfois un objet au lieu d'une liste). */
const questionsDe = (quiz) => (Array.isArray(quiz?.questions) ? quiz.questions : Object.values(quiz?.questions ?? {})).filter(Boolean);
/** Quiz importés d'un fichier ou d'un texte collé : des packs. Le reste est écrit à la main dans la Régie PC. */
const SOURCES_PACK = new Set(["json", "tableur", "gemini"]);
export const estPack = (quiz) => SOURCES_PACK.has(quiz?.source);
/** Quiz des prestations de test de Paramètres (« TEST – … de Léa ») : leurs clés fixes commencent par « test- ». */
export const estQuizDeTest = (id) => `${id ?? ""}`.startsWith("test-");
/** Quiz de photos à deviner (Zoom mystère, Image floue) : une série de photos, importée ou non. */
export const estSerieDePhotos = (quiz) => quizKind(quiz) === "images";

/** Mot d'une réponse sans son émoji de tête (« 🐱 Chat » → « Chat »). */
const motSeul = (c) => `${c ?? ""}`.replace(/^[^\p{L}\p{N}]+/u, "").trim();
const photoDeLaBanque = (mot) => {
  const m = motBanque(motSeul(mot));
  return m && PHOTOS_BANQUE.has(m.cle) ? m.cle : null;
};
/** Émoji du mot de la banque : ce que reçoit une réponse sans photo quand elle entre dans un quiz (dessiné en image). */
const emojiDeLaBanque = (mot) => motBanque(motSeul(mot))?.emoji ?? null;

/**
 * Illustration d'une question : une photo par réponse dans un quiz illustré ([kind] « photo »), sinon l'image
 * montrée à la révélation (photo ou émoji). `{ ok, manque }` : [manque] dit ce qui manque, pour l'alerte.
 * Un Juste Chiffre a toujours son visuel sur la TV, le compteur qui tourne (validé par cedric le 22/10) : jamais d'alerte.
 */
export function illustration(q, kind) {
  // Juste Chiffre et Vrai ou Faux : jamais d'image attendue (cedric, 25/10).
  if (q?.kind === "number") return { ok: true, manque: null };
  if (kind !== "photo" && q?.choices?.length === 2 && q.choices.join("/").toLowerCase() === "vrai/faux") return { ok: true, manque: null };
  if (kind === "photo") {
    const choix = q?.choices ?? [];
    const sans = choix.filter((_, k) => !IMAGE_ID.test(q?.choiceImages?.[k] ?? "")).length;
    if (!choix.length) return { ok: false, manque: "Pas d'illustration" };
    return sans ? { ok: false, manque: sans === choix.length ? "Pas de photo pour les réponses" : `${sans} réponse${sans > 1 ? "s" : ""} sans photo` } : { ok: true, manque: null };
  }
  const ok = IMAGE_ID.test(q?.imageId ?? "") || !!`${q?.image ?? ""}`.trim();
  return { ok, manque: ok ? null : "Pas d'illustration" };
}

/** Une question à montrer : texte, réponses, bonne réponse, illustration, et d'où elle vient. */
function fiche(q, kind, extra) {
  return {
    text: q.text ?? "", choices: q.kind === "number" ? [] : [...(q.choices ?? [])], correct: q.correct, nombre: q.kind === "number",
    image: q.image ?? null, imageId: IMAGE_ID.test(q.imageId ?? "") ? q.imageId : null,
    choiceImages: (q.choices ?? []).map((_, k) => (IMAGE_ID.test(q.choiceImages?.[k] ?? "") ? q.choiceImages[k] : null)),
    validee: q.status === "validee", ...illustration(q, kind), ...extra,
  };
}

/**
 * Quiz classique tout prêt, par thème (cedric, 22/10) : les questions à 4 réponses écrites, qui n'ont besoin que d'une
 * illustration pour la révélation (leur émoji), et les Juste Chiffre, sans émoji (la TV montre son compteur).
 */
export function questionsClassiquesPretes(liste = QUESTIONS_TOUT_PRETES) {
  return liste.map((x) => {
    const nombre = estJusteChiffre(x);
    // La photo de la banque passe avant l'émoji ; aux niveaux Moyen et Difficile, il n'y a que des photos.
    const photo = nombre ? null : x.photo ?? null;
    const illustree = nombre || !!photo || !!x.emoji;
    return {
      groupe: "classiques", cle: x.id, text: x.text, choices: nombre ? [] : [...x.choices], correct: x.correct, nombre, niveau: x.niveau,
      photo, image: nombre || photo ? null : x.emoji ?? null, imageId: null, categorie: THEMES_TOUT_PRETS[x.theme] ?? x.theme,
      source: `${nombre ? `${JUSTE_CHIFFRE} tout prêt` : QUESTION_4_REPONSES} · ${libelleNiveau(x.niveau)}`,
      validee: true, ok: illustree, manque: illustree ? null : "Pas d'illustration",
    };
  });
}

/** Vrai ou Faux tout prêt (cedric, 23/10) : des affirmations sans image (la TV n'en montre pas), par thème et par niveau. */
export function questionsVraiFauxPretes(liste = AFFIRMATIONS) {
  return liste.map((x) => ({
    groupe: "vraifaux", cle: x.id, text: x.text, choices: ["Vrai", "Faux"], correct: x.vrai ? 0 : 1, nombre: false, vraiFaux: true, niveau: x.niveau,
    categorie: THEMES_VRAI_FAUX[x.theme] ?? x.theme, source: `Vrai ou Faux tout prêt · ${libelleNiveau(x.niveau)}`,
    validee: true, ok: true, manque: null,
  }));
}

/**
 * Quiz illustré tout prêt : la banque des tout-petits, par famille ; il faut une image par réponse. Chaque réponse a
 * la photo de la banque de son mot ([banque] : clés des photos, null si le mot n'en a pas), sinon l'émoji de son mot
 * ([banqueEmojis]), dessiné en image quand la question entre dans un quiz (cedric, 22/10 : « 1087 sans illustration
 * complète », c'était à tort). L'alerte ne reste que pour une réponse sans photo ni émoji.
 */
export function questionsIllustreesPretes(catalogue = cataloguePetits()) {
  return catalogue.map((x, i) => {
    const banque = x.choices.map(photoDeLaBanque);
    const banqueEmojis = x.choices.map((c, k) => (banque[k] ? null : emojiDeLaBanque(c)));
    const sans = banque.filter((c, k) => !c && !banqueEmojis[k]).length;
    return {
      groupe: "illustrees", cle: x.id ?? `p-${i}`, text: x.text, choices: [...x.choices], correct: 0, nombre: false, banque, banqueEmojis,
      categorie: FAMILLES_PETITS[x.famille] ?? x.famille, source: "Banque des tout-petits", validee: true,
      ok: !sans, manque: sans ? `${sans} réponse${sans > 1 ? "s" : ""} sans image` : null,
    };
  });
}

/** Questions des quiz gardés par [garde], en vrac : du quiz le plus récent au plus ancien ; [categorie] : son thème, sinon son titre. */
function enVrac(quizzes, groupe, garde) {
  return Object.entries(quizzes)
    .filter(([id, quiz]) => quiz && garde(id, quiz))
    .sort(([, a], [, b]) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .flatMap(([id, quiz]) => {
      const kind = quizKind(quiz);
      return questionsDe(quiz).map((q, i) => fiche(q, kind, {
        groupe, cle: `${id}/${i}`, quizId: id, index: i, categorie: `${quiz.theme ?? ""}`.trim() || (quiz.title ?? ""), source: quiz.title ?? "",
      }));
    });
}

/** Ses questions écrites à la main, en vrac (sans celles des prestations de test). */
export const mesQuestions = (quizzes = {}) => enVrac(quizzes, "miennes", (id, quiz) => !estPack(quiz) && !estQuizDeTest(id) && !estSerieDePhotos(quiz));

/** Les questions des prestations de test, à part (cedric, 22/10 : elles encombraient « Mes questions en vrac »). */
export const questionsDeTest = (quizzes = {}) => enVrac(quizzes, "tests", (id) => estQuizDeTest(id));

/** Ses packs : un par quiz importé, avec le compte des questions et de celles sans illustration. */
export const mesPacks = (quizzes = {}) => enCartes(quizzes, "packs", (id, quiz) => estPack(quiz) && !estQuizDeTest(id) && !estSerieDePhotos(quiz));

/** Ses séries de photos (Zoom mystère, Image floue), comme ses packs : une carte par quiz de photos. */
export const mesSeriesDePhotos = (quizzes = {}) => enCartes(quizzes, "photos", (id, quiz) => estSerieDePhotos(quiz) && !estQuizDeTest(id));

/** Les quiz gardés par [garde], une carte chacun, du plus récent au plus ancien. */
function enCartes(quizzes, groupe, garde) {
  return Object.entries(quizzes)
    .filter(([id, quiz]) => quiz && garde(id, quiz))
    .map(([id, quiz]) => {
      const kind = quizKind(quiz);
      const questions = questionsDe(quiz).map((q, i) => fiche(q, kind, { groupe, cle: `${id}/${i}`, quizId: id, index: i }));
      return {
        id, title: quiz.title ?? "", theme: quiz.theme ?? "", famille: familleDuQuiz(quiz), niveau: niveauDuQuiz(quiz), kind, source: quiz.source, updatedAt: quiz.updatedAt ?? 0,
        total: questions.length, validees: questions.filter((q) => q.validee).length, sansIllustration: questions.filter((q) => !q.ok).length, questions,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Supprimer des questions de ses quiz (cedric, 22/10 : « la question doit pouvoir être supprimable de ma bibliothèque »).
 * [choisies] : `{ quizId, index, text }` ; une question n'est retirée que si elle est toujours à sa place avec le même
 * texte (rien d'autre n'est effacé si le quiz a changé entre-temps). Renvoie les nouvelles listes de questions par quiz
 * (`null` : le quiz n'a plus de question, il est supprimé), les quiz vidés et le nombre de questions retirées.
 */
export function retirerQuestions(quizzes = {}, choisies = []) {
  const parQuiz = new Map();
  for (const x of choisies) {
    if (!x?.quizId || !quizzes[x.quizId] || !Number.isInteger(x.index)) continue;
    if (!parQuiz.has(x.quizId)) parQuiz.set(x.quizId, new Map());
    parQuiz.get(x.quizId).set(x.index, x.text ?? "");
  }
  const ecritures = {};
  const vides = [];
  let n = 0;
  for (const [id, retirees] of parQuiz) {
    const restantes = questionsDe(quizzes[id]).filter((q, i) => {
      const retiree = retirees.has(i) && retirees.get(i) === (q.text ?? "");
      if (retiree) n += 1;
      return !retiree;
    });
    if (restantes.length === questionsDe(quizzes[id]).length) continue;
    ecritures[id] = restantes.length ? restantes : null;
    if (!restantes.length) vides.push(id);
  }
  return { ecritures, vides, n };
}

export const SANS_THEME = "Sans thème";
/**
 * Ses packs rangés par thème : `[[thème, packs]]`, thèmes dans l'ordre alphabétique (« Disney » et « disney » vont
 * ensemble), les packs sans thème à la fin ; dans un thème, l'ordre reçu (le plus récent d'abord).
 */
export function packsParTheme(packs = []) {
  const themes = new Map();
  for (const p of packs) {
    const nom = `${p.theme ?? ""}`.trim().replace(/\s+/g, " ");
    const cle = nom ? sansAccent(nom) : "";
    if (!themes.has(cle)) themes.set(cle, [nom || SANS_THEME, []]);
    themes.get(cle)[1].push(p);
  }
  return [...themes.entries()]
    .sort(([a, [na]], [b, [nb]]) => (a === "") - (b === "") || na.localeCompare(nb, "fr", { sensitivity: "base" }))
    .map(([, groupe]) => groupe);
}

const sansAccent = (s) => `${s ?? ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Une question correspond à la recherche si chaque mot cherché est dans son texte, ses réponses ou sa catégorie. */
export function questionCorrespond(q, recherche) {
  const mots = sansAccent(recherche).split(/\s+/).filter(Boolean);
  const dans = sansAccent([q.text, ...(q.choices ?? []), q.categorie, q.source].join(" "));
  return mots.every((m) => dans.includes(m));
}

const estPackJson = (x) => !!x && typeof x === "object" && !Array.isArray(x) && Array.isArray(x.questions);
const nombreEntier = (v) => (typeof v === "number" && Number.isInteger(v) ? v : typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v) : null);
const emoji = (v) => (typeof v === "string" && v.trim() && !/\.(png|jpe?g|webp|gif)$/i.test(v.trim()) && [...v.trim()].length <= 4 ? v.trim() : null);

/**
 * Packs d'un fichier JSON : un pack `{ title, theme, questions }`, une liste de packs, `{ packs: [...] }`, ou une
 * simple liste de questions. Chaque question comme à l'import d'un quiz (propositions, bonne réponse, images de
 * réponses nommées) ; en plus, un émoji d'illustration (`illustration`, `image` ou `emoji`) et le Juste Chiffre (pas de
 * propositions, une réponse en nombre). Renvoie `{ packs }`, ou `{ erreur }` si le fichier ne se lit pas.
 */
export function lirePacks(texte) {
  const corps = `${texte ?? ""}`.replace(/^﻿/, "").replace(/```(?:json)?/gi, "").trim();
  let data;
  try { data = JSON.parse(corps); } catch { return { erreur: "Ce fichier n'est pas un JSON lisible." }; }
  const liste = Array.isArray(data?.packs) ? data.packs
    : Array.isArray(data) && data.length && data.every(estPackJson) ? data
      : estPackJson(data) ? [data]
        : Array.isArray(data) ? [{ questions: data }] : [];
  const packs = liste.filter(estPackJson).map((p) => {
    // Seules les questions écrites comme des objets comptent ; leurs propositions sont toujours une liste.
    const objets = p.questions.filter((q) => q && typeof q === "object" && !Array.isArray(q));
    // Juste Chiffre : une question écrite sans aucune proposition (une liste mal écrite n'en fait pas un).
    const sansChoix = objets.map((q) => [q.choices, q.propositions, q.options, q.reponses, q.réponses].every((c) => c == null || (Array.isArray(c) && !c.length)));
    const bruts = objets.map((q) => ({ ...q, choices: [q.choices, q.propositions, q.options, q.reponses, q.réponses].find(Array.isArray) ?? [] }));
    const lu = parseQuiz(JSON.stringify({ title: p.title ?? p.titre ?? p.nom ?? p.name ?? "", theme: p.theme ?? p.thème ?? p.categorie ?? "", ageMin: p.ageMin, ageMax: p.ageMax, questions: bruts }));
    const questions = (lu?.questions ?? []).map((q, i) => {
      const brut = bruts[i];
      const sans = sansChoix[i];
      const n = nombreEntier(brut.correct ?? brut.answer ?? brut.reponse ?? brut.réponse ?? brut.bonne_reponse);
      const illus = emoji(brut.illustration) ?? emoji(brut.image) ?? emoji(brut.emoji);
      // Sa photo de révélation (« illustration » : un fichier) reste avec elle (cedric, 26/10).
      if (sans && n != null) return { text: q.text, choices: [], correct: n, kind: "number", duration: q.duration, double: q.double, marks: 0, ...(illus ? { image: illus } : {}), ...(q.revealFile ? { revealFile: q.revealFile } : {}) };
      return { ...q, ...(illus ? { image: illus } : {}) };
    });
    // Ses deux étiquettes (cedric, 25/10) : écrites sur le pack, ou une fois pour tous en haut du fichier.
    return { title: lu.title, theme: lu.theme, ageMin: lu.ageMin, ageMax: lu.ageMax, ...etiquettes(p, Array.isArray(data) ? null : data), questions };
  }).filter((p) => p.questions.length);
  return packs.length ? { packs } : { erreur: "Aucune question trouvée dans ce fichier." };
}
