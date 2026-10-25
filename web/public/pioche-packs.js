/**
 * « 🎨 Mes thèmes » d'un Quiz (cedric, 25/10) : les questions se piochent dans les packs importés (les thèmes
 * commerciaux : K-pop Demon Hunters, Mario…), au-dessus de la banque libre. Trois dés :
 * - « hasard » : n'importe quel pack ;
 * - « theme » : un thème principal tapé, la moitié des questions ; le reste au hasard dans les autres packs ;
 * - « recherche » : un mot (thème, personnage…) : seulement les questions qui s'y rapportent (titre ou thème du pack,
 *   texte ou réponses de la question), même s'il n'y en a qu'une série.
 * Jamais une question déjà dans la prestation ni retirée (✕) ; d'abord celles du niveau de la prestation, puis les
 * autres s'il en manque (le niveau d'une question changé à la main passe avant celui de son pack). Fonctions pures, testées.
 */
import { playable, quizKind, illustreQuestions, expressQuestions, zoomQuestions, estJeuDePhotos } from "./show.js";
import { niveauDuQuiz, lireNiveau, themeDuQuiz, cleTheme } from "./rangement.js";
import { contientTout, parPertinence, sansAccent } from "./recherche.js";

const IMAGE_ID = /^[0-9a-f]{16}$/;
const NIVEAUX = ["Facile", "Moyen", "Difficile"];
/** Le niveau des packs pour un niveau de la banque (1 petits, 2 moyens, 3 grands ; null : tous). */
export const niveauDesPacks = (niveau) => NIVEAUX[niveau - 1] ?? null;

/** Une question jouable au Quiz : quatre réponses, ou un Juste Chiffre. */
const auQuiz = (q) => q.kind === "number" || (q.choices ?? []).filter((c) => `${c ?? ""}`.trim()).length === 4;

/**
 * Les questions d'un pack jouables dans le jeu [jeu] (cedric, 25/10 : la carte du Quiz pour chaque jeu) : au Quiz, ses
 * quiz à 4 réponses ; au Quiz illustré, ses quiz illustrés ; au Vrai ou Faux express, ses Vrai / Faux ; au Zoom
 * mystère et à l'Image floue, ses séries de photos.
 */
const QUESTIONS_DU_JEU = {
  quiz: (quiz) => (quizKind(quiz) === "classique" ? playable(quiz).filter(auQuiz) : []),
  illustre: (quiz) => illustreQuestions(quiz),
  express: (quiz) => (quizKind(quiz) === "classique" ? expressQuestions(quiz) : []),
  photos: (quiz) => (quizKind(quiz) === "images" ? zoomQuestions(quiz) : []),
};
const questionsDuJeu = (jeu) => QUESTIONS_DU_JEU[estJeuDePhotos(jeu) ? "photos" : jeu] ?? QUESTIONS_DU_JEU.quiz;
/** Ce qui rend une question unique dans la prestation : sa photo au Zoom et à l'Image floue, son texte ailleurs. */
export const cleDePack = (q, jeu = "quiz") => (estJeuDePhotos(jeu) ? `i:${q.imageId}` : q.text);

/**
 * Les questions des packs importés (aux photos : de toutes mes séries) jouables dans le jeu [jeu] : `{ id, quizId, titre, theme, niveau, cle, q }`.
 * [exclure] : identifiants de quiz à laisser (prestations de test…).
 */
export function catalogueDesPacks(quizzes = {}, exclure = () => false, jeu = "quiz") {
  const duJeu = questionsDuJeu(jeu);
  return Object.entries(quizzes ?? {})
    // Au Zoom mystère et à l'Image floue, toutes mes séries de photos, importées ou faites à la main (cedric, 25/10).
    .filter(([id, quiz]) => (quiz?.pack === true || (estJeuDePhotos(jeu) && quizKind(quiz ?? {}) === "images")) && quiz.title && !exclure(id))
    .flatMap(([id, quiz]) => duJeu(quiz).map((q, k) => ({
      id: `${id}:${k}`, quizId: id, titre: quiz.title, theme: themeDuQuiz(quiz), niveau: lireNiveau(q.niveau) ?? niveauDuQuiz(quiz), cle: cleDePack(q, jeu), q,
    })));
}

/** Lettres et chiffres seulement : « kpop » trouve « K-pop », « spiderman » trouve « Spider-Man ». */
const serre = (t) => sansAccent(t).replace(/[^a-z0-9]/g, "");
/** Tous les mots de [terme] dans [textes], ou [terme] collé (sans espaces ni tirets) dans l'un d'eux. */
const repond = (textes, terme) => contientTout(textes, terme) || (serre(terme).length > 1 && textes.some((t) => serre(t).includes(serre(terme))));

/** La question se rapporte à [terme] : le titre ou le thème de son pack, son texte ou ses réponses. */
export const serapporte = (x, terme) => repond([x.titre, x.theme, x.q.text, ...(x.q.choices ?? [])].filter(Boolean), terme);

/**
 * Les thèmes (cedric, 25/10 : les rubriques sont les thèmes) dont le nom ou un pack répond à [terme] (le champ, en
 * direct) : `[{ titre, n }]` (titre : le thème), les plus proches d'abord ; n : ses questions libres.
 */
export function packsQuiRepondent(catalogue, terme, exclus = new Set()) {
  if (!`${terme ?? ""}`.trim()) return [];
  const parTheme = new Map();
  for (const x of catalogue) {
    if (exclus.has(x.cle ?? x.q.text) || !repond([x.theme, x.titre].filter(Boolean), terme)) continue;
    const cle = cleTheme(x.theme) || x.theme;
    const p = parTheme.get(cle) ?? { titre: x.theme, packs: new Set(), n: 0 };
    p.n += 1;
    p.packs.add(x.titre);
    parTheme.set(cle, p);
  }
  return parPertinence([...parTheme.values()].map(({ titre, packs, n }) => ({ titre, theme: [...packs].filter((t) => t !== titre).join(", "), n })),
    terme, (p) => [p.titre], (p) => [p.theme].filter(Boolean));
}

const melanger = (liste, hasard) => {
  const a = [...liste];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(hasard() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** [k] questions de [liste], celles du [niveau] d'abord (au hasard), puis les autres. */
function prendre(liste, k, niveau, hasard) {
  const bon = melanger(liste.filter((x) => !niveau || x.niveau === niveau), hasard);
  const autres = melanger(liste.filter((x) => niveau && x.niveau !== niveau), hasard);
  return [...bon, ...autres].slice(0, Math.max(0, k));
}

/**
 * Pioche [n] questions du [catalogue] : `{ mode, terme, niveau, exclus }` (exclus : textes déjà pris). Renvoie les
 * entrées du catalogue, mélangées ; moins de [n] s'il n'y en a pas assez.
 */
export function piocherDansLesPacks(catalogue, n, { mode = "hasard", terme = "", niveau = null, exclus = new Set() } = {}, hasard = Math.random) {
  const vus = new Set();
  // Une même question (même texte) dans deux packs ne compte qu'une fois.
  const cle = (x) => x.cle ?? x.q.text;
  const libres = catalogue.filter((x) => !exclus.has(cle(x)) && !vus.has(cle(x)) && vus.add(cle(x)));
  if (mode === "recherche") return prendre(libres.filter((x) => serapporte(x, terme)), n, niveau, hasard);
  if (mode === "theme" && `${terme}`.trim()) {
    const du = libres.filter((x) => serapporte(x, terme));
    const autres = libres.filter((x) => !serapporte(x, terme));
    const moitie = Math.ceil(n / 2);
    const a = prendre(du, moitie, niveau, hasard);
    const b = prendre(autres, n - a.length, niveau, hasard);
    // Pas assez d'autres packs : le thème principal complète.
    const c = prendre(du.filter((x) => !a.includes(x)), n - a.length - b.length, niveau, hasard);
    return melanger([...a, ...b, ...c], hasard);
  }
  return prendre(libres, n, niveau, hasard);
}

/**
 * Une question piochée telle qu'elle est gardée dans la manche du jeu [jeu] : au Quiz et au Quiz illustré, réponses
 * mélangées (la bonne pas toujours la A ; au Quiz illustré, chacune garde son image) ; Vrai / Faux et photos tels quels.
 */
export function versQuestionDePack(x, hasard = Math.random, jeu = "quiz") {
  const q = x.q;
  const choix = () => (Array.isArray(q.choices) ? q.choices : Object.values(q.choices ?? {}));
  if (estJeuDePhotos(jeu)) return { id: `i:${q.imageId}`, text: q.text, choices: [...choix()], correct: q.correct, imageId: q.imageId };
  // Vrai ou Faux : l'image de l'affirmation (Mario, K-pop…) se montre à la révélation (cedric, 25/10).
  if (jeu === "express") {
    return { id: `pk-${x.id}`, text: q.text, choices: [...choix()].slice(0, 2), correct: q.correct,
      ...(IMAGE_ID.test(q.imageId ?? "") ? { imageId: q.imageId } : typeof q.image === "string" && q.image ? { emoji: q.image } : {}) };
  }
  if (jeu === "illustre") {
    const images = choix().map((_, k) => (IMAGE_ID.test(q.choiceImages?.[k] ?? "") ? q.choiceImages[k] : ""));
    const ordre = melanger(choix().map((_, k) => k).slice(0, 4), hasard);
    return {
      id: `pk-${x.id}`, text: q.text, choices: ordre.map((k) => choix()[k]), correct: ordre.indexOf(q.correct),
      ...(images.some(Boolean) ? { choiceImages: ordre.map((k) => images[k]) } : {}), ...(IMAGE_ID.test(q.imageId ?? "") ? { imageId: q.imageId } : {}),
    };
  }
  if (q.kind === "number") return { id: `pk-${x.id}`, text: q.text, nombre: true, correct: q.correct };
  const choices = melanger(q.choices.slice(0, 4), hasard);
  return {
    id: `pk-${x.id}`, text: q.text, choices, correct: choices.indexOf(q.choices[q.correct]),
    ...(IMAGE_ID.test(q.imageId ?? "") ? { imageId: q.imageId } : typeof q.image === "string" && q.image ? { emoji: q.image } : {}),
  };
}
