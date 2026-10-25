// Bibliothèque d'images de la Régie PC : cinq groupes (émojis, photos libres de la banque, images de Sarah, images des
// packs importés, pochettes des chansons) et une seule recherche, par nom, catégorie ou mot-clé, sans tenir compte des accents ni des majuscules.
// Les images de Sarah restent dans library/images (une seule copie par image) ; leur fiche (nom, catégorie, mots-clés,
// retirée ou non) vit à côté, dans library/medias, sous le même identifiant.
import { BANQUE_MOTS, FAMILLES_PETITS } from "./banque-petits.js";
import { PHOTOS_BANQUE, BANQUE } from "./banque-photos.js";
import { DISPARU_THEMES } from "./buzz-cards.js";
import { MIME_CATALOG } from "./mime-cards.js";
import { ROUND_TYPES } from "./show.js";
import { themeDuQuiz } from "./rangement.js";

// Les images des packs d'abord : ce sont ses images principales (cedric, 25/10).
export const GROUPES_IMAGES = { packs: "📦 Images des packs", emojis: "😀 Émojis", photos: "📷 Photos libres", miennes: "⭐ Mes images", pochettes: "💿 Pochettes" };

/**
 * Images des packs importés (cedric, 25/10 : les images avec droits d'auteur à part des photos libres et des siennes),
 * rangées par thème du pack. Une image qu'elle range elle-même dans une de ses catégories passe dans « Mes images » ;
 * sa fiche garde cette catégorie réservée tant qu'elle reste ici. Jamais tirées au hasard.
 */
export const PACKS = "Images des packs";
/** Un quiz venu d'un pack : importé d'un ZIP, ou d'un ancien fichier de pack (source « json »). */
export const estQuizPack = (qz) => qz?.pack === true || qz?.source === "json";

/**
 * Pochettes d'album (cedric, 22/10) : à part de ses images. Celles des chansons arrivent toutes seules ; une chanson
 * effacée pour de bon laisse sa pochette ici, avec une fiche dans cette catégorie réservée.
 */
export const POCHETTES = "Pochettes";

/** Catégories proposées pour ses images ; elle peut en créer d'autres. */
export const CATEGORIES_PERSO = ["Personnages", "Dessins animés", "Films et séries", "Jeux vidéo", "Célébrités", "Sport", "Famille et amis", "Autres"];
/** Image sans catégorie (déjà utilisée dans un quiz ou un jeu avant la bibliothèque, ou pas encore rangée). */
export const A_RANGER = "À ranger";

/** Limites de la fiche d'une image (les mêmes que les règles de la base). */
export const FICHE = { nom: 80, cat: 40, tags: 300 };

const IMAGE_ID = /^[0-9a-f]{16}$/;
export const sansAccent = (x) => `${x ?? ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/œ/g, "oe").toLowerCase();

/** « princesse, Disney ; reine » → ["princesse", "Disney", "reine"] (sans doublon ni mot vide). */
export function motsCles(texte) {
  const out = [];
  for (const mot of `${texte ?? ""}`.split(/[,;\n]+/)) {
    const m = mot.trim().replace(/\s+/g, " ").slice(0, 40);
    if (m && !out.some((x) => sansAccent(x) === sansAccent(m))) out.push(m);
  }
  return out;
}

/** Les mots-clés tels qu'enregistrés : « princesse, Disney, reine », coupés à la limite de la base. */
export function texteMotsCles(liste) {
  let out = "";
  for (const m of liste) {
    const next = out ? `${out}, ${m}` : m;
    if (next.length > FICHE.tags) break;
    out = next;
  }
  return out;
}

/** Nom d'une image tiré d'un texte de jeu : « 🐱 Chat » → « Chat ». */
const nomPropre = (x) => {
  const s = `${x ?? ""}`.replace(/^[^\p{L}\p{N}]+/u, "").trim().slice(0, FICHE.nom);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// Étiquettes de la banque des tout-petits, en mots lisibles (celles en « g-… » et « x-… » servent au tirage).
const ETIQUETTES = { "4pattes": "4 pattes", sale: "salé", sucre: "sucré", ecole: "école", legume: "légume", fete: "fête", geant: "géant", ete: "été", tete: "tête" };
const etiquettes = (m) => [...m.tags].filter((t) => t !== m.famille && !/^[gx]-/.test(t)).map((t) => ETIQUETTES[t] ?? t);

/** Photos libres de droits de la banque : une par mot qui a sa photo, rangées par famille. */
export const photosLibres = () => BANQUE_MOTS.filter((m) => PHOTOS_BANQUE.has(m.cle)).map((m) => ({
  groupe: "photos", id: `${BANQUE}${m.cle}`, nom: m.mot, cat: FAMILLES_PETITS[m.famille], tags: etiquettes(m), emoji: m.emoji, src: `banque/${m.cle}.jpg`,
}));

// Familles des émojis des autres catalogues (Qui a disparu ?, Mimes), rangés avec ceux de la banque.
const CAT_THEME = {
  "Animaux de la ferme": "Animaux", "La mer": "Animaux", "Les petites bêtes": "Animaux", "La forêt": "Animaux", "Animaux du monde": "Animaux", "Animaux sauvages": "Animaux", Animaux: "Animaux",
  "La fête": "Jouets et fête", "Jeux et jouets": "Jouets et fête", Noël: "Jouets et fête",
  "À table": "À manger", "Le goûter": "À manger", "Le marché": "À manger", Fruits: "À manger", Nourriture: "À manger",
  "L'école": "Maison et école", "Le sport": "Sport", "Encore du sport": "Sport", Sports: "Sport",
  "Les émotions": "Émotions", "Les têtes rigolotes": "Émotions",
  "Les contes de fées": "Imaginaire", "Monstres et Halloween": "Imaginaire", Imaginaire: "Imaginaire",
  "Le ciel": "Nature", "Le jardin": "Nature", "Les vêtements": "Vêtements", "La musique": "Musique", "Les outils": "Outils",
  "Les vacances": "Lieux", "La ville": "Lieux", "Les véhicules": "Transports", Transports: "Transports", "Le corps": "Le corps",
  Métiers: "Métiers", Actions: "Actions", Objets: "Objets",
};
const glyphe = (e) => `${e ?? ""}`.replace(/️/g, "");

let emojis = null;
/**
 * Tous les émojis des jeux, une fois chacun : ceux de la banque des tout-petits, puis ceux de Qui a disparu ? et des
 * Mimes. Les autres mots du même émoji et le nom de leur famille d'origine deviennent des mots-clés.
 */
export function emojisBibliotheque() {
  if (emojis) return emojis;
  const parGlyphe = new Map();
  const ajouter = (emoji, nom, cat, tags) => {
    const k = glyphe(emoji);
    if (!k) return;
    const x = parGlyphe.get(k);
    if (x) {
      for (const t of [nom, ...tags]) if (t && t !== x.nom && !x.tags.some((y) => sansAccent(y) === sansAccent(t))) x.tags.push(t);
    } else parGlyphe.set(k, { groupe: "emojis", id: `emoji:${k}`, nom, cat, tags: [...tags], emoji });
  };
  BANQUE_MOTS.forEach((m) => ajouter(m.emoji, m.mot, FAMILLES_PETITS[m.famille], etiquettes(m)));
  DISPARU_THEMES.forEach((t) => t.objects.forEach((o) => ajouter(o.image, o.word, CAT_THEME[t.theme] ?? "Autres", [t.theme])));
  MIME_CATALOG.forEach((c) => ajouter(c.image, c.word, CAT_THEME[c.theme] ?? "Autres", [c.theme]));
  emojis = [...parGlyphe.values()];
  return emojis;
}

/**
 * Images de Sarah déjà utilisées dans ses contenus (quiz, mimes, jeux, chansons) : identifiant → { nom, ou } ;
 * [nom] vient de la réponse, du mot ou du titre ; [ou] liste les contenus qui s'en servent.
 */
export function imagesUtilisees({ quizzes = {}, mimes = {}, contents = {}, songs = {}, playlists = {} } = {}) {
  const out = new Map();
  const noter = (id, nom, ou) => {
    if (typeof id !== "string" || !IMAGE_ID.test(id)) return;
    const x = out.get(id) ?? { nom: "", ou: [] };
    if (!x.nom) x.nom = nomPropre(nom);
    if (ou && !x.ou.includes(ou)) x.ou.push(ou);
    out.set(id, x);
  };
  for (const qz of Object.values(quizzes)) {
    if (!qz?.title) continue;
    for (const q of Object.values(qz.questions ?? {})) {
      if (!q) continue;
      const choix = Object.values(q.choices ?? {});
      noter(q.imageId, choix[q.correct] ?? q.text, `Quiz « ${qz.title} »`);
      Object.entries(q.choiceImages ?? {}).forEach(([k, id]) => noter(id, choix[k], `Quiz « ${qz.title} »`));
    }
  }
  for (const d of Object.values(mimes)) for (const c of Object.values(d?.cards ?? {})) noter(c?.imageId, c?.word, `Mimes « ${d.title} »`);
  // Contenus des jeux intégrés (Qui a disparu ?, Qui suis-je ?…) : leurs objets, et leurs images par élément.
  const parcourir = (x, ou) => {
    if (!x || typeof x !== "object") return;
    if (typeof x.imageId === "string") noter(x.imageId, x.word ?? x.answer ?? x.title ?? x.theme, ou);
    for (const [k, v] of Object.entries(x)) {
      if (k === "images" && v && typeof v === "object" && !Array.isArray(v)) Object.entries(v).forEach(([cle, id]) => noter(id, cle, ou));
      else if (v && typeof v === "object") parcourir(v, ou);
    }
  };
  for (const [type, c] of Object.entries(contents)) parcourir(c, ROUND_TYPES[type] ?? type);
  for (const s of Object.values(songs)) noter(s?.imageId, s?.title, s?.title ? `Chanson « ${s.title} »` : "Pochettes des chansons");
  for (const p of Object.values(playlists)) for (const t of Object.values(p?.tracks ?? {})) noter(t?.imageId, t?.title, `Playlist « ${p.title} »`);
  return out;
}

/** Images des packs : identifiant → { nom, theme, pack } (le premier pack qui s'en sert). */
export function imagesDesPacks(quizzes = {}) {
  const out = new Map();
  for (const qz of Object.values(quizzes)) {
    if (!qz?.title || !estQuizPack(qz)) continue;
    // Rangées par thème du pack (cedric, 25/10), comme dans Bibliothèque › Questions.
    const theme = themeDuQuiz(qz);
    for (const q of Object.values(qz.questions ?? {})) {
      if (!q) continue;
      const choix = Object.values(q.choices ?? {});
      const noter = (id, nom) => { if (typeof id === "string" && IMAGE_ID.test(id) && !out.has(id)) out.set(id, { nom: nomPropre(nom) || "Image", theme, pack: qz.title }); };
      noter(q.imageId, choix[q.correct] ?? q.text);
      Object.entries(q.choiceImages ?? {}).forEach(([k, id]) => noter(id, choix[k]));
    }
  }
  return out;
}

/**
 * Catégorie de la fiche d'une image de pack nommée à l'import (cedric, 25/10 : « Yoshi », « Toad »… dans le thème
 * Mario) : « 📦 » puis son thème, la fiche n'ayant pas d'autre place pour lui (même une image qu'aucun pack ne cite).
 */
const PREFIXE_PACK = "📦 ";
export const catDePack = (theme) => `${PREFIXE_PACK}${`${theme ?? ""}`.trim() || "Sans thème"}`.slice(0, FICHE.cat);
/** Le thème écrit dans la catégorie d'une fiche d'image de pack, sinon null. */
export const themeDeFiche = (fiche) => (typeof fiche?.cat === "string" && fiche.cat.startsWith(PREFIXE_PACK) ? fiche.cat.slice(PREFIXE_PACK.length) : null);
/** Une fiche rangée dans « Images des packs » (avec ou sans son thème). */
export const estFicheDePack = (fiche) => fiche?.cat === PACKS || themeDeFiche(fiche) != null;

/** Une image est une image de pack si sa fiche est rangée dans « Images des packs », ou si un pack s'en sert sans qu'elle l'ait rangée ailleurs. */
const estImagePack = (id, fiche, packs) => estFicheDePack(fiche) || (!fiche?.cat && packs.has(id));

/**
 * Les images des packs, par thème de pack puis par nom (pas les pochettes) ; une fiche donne son nom, ses mots-clés et
 * « retirée ».
 */
export function mesImagesDePacks(medias = {}, packs = new Map(), utilisees = new Map(), pochettes = new Map()) {
  const out = [];
  const ids = new Set([...Object.keys(medias), ...packs.keys()]);
  // Un thème trop long pour la catégorie de la fiche (coupé) : celui d'un pack qui commence pareil.
  const themes = [...new Set([...packs.values()].map((p) => p.theme))];
  const themeDe = (f) => { const t = themeDeFiche(f); return t == null ? null : themes.find((x) => catDePack(x) === f.cat) ?? t; };
  for (const id of ids) {
    const f = medias[id];
    if (!IMAGE_ID.test(id) || estPochette(id, f, pochettes) || !estImagePack(id, f, packs)) continue;
    const p = packs.get(id);
    out.push({
      groupe: "packs", id, nom: f?.name ?? p?.nom ?? "Image", cat: p?.theme ?? themeDe(f) ?? "Sans thème", tags: f ? motsCles(f.tags) : p ? motsCles(p.pack) : [],
      retiree: f?.hidden === true, ou: utilisees.get(id)?.ou ?? [], fiche: !!f,
    });
  }
  return out.sort((a, b) => a.cat.localeCompare(b.cat, "fr") || a.nom.localeCompare(b.nom, "fr"));
}

/** Nom d'une pochette : « Artiste – Titre », ou le titre seul. */
export const nomPochette = (t) => [t?.artist, t?.title].map((x) => `${x ?? ""}`.trim()).filter(Boolean).join(" – ").slice(0, FICHE.nom);

/** Pochettes des chansons (bibliothèque des sons, même supprimées) et des morceaux des playlists : identifiant → { nom, tags }. */
export function pochettesUtilisees({ songs = {}, playlists = {} } = {}) {
  const out = new Map();
  const noter = (id, t) => {
    if (typeof id !== "string" || !IMAGE_ID.test(id) || out.has(id)) return;
    out.set(id, { nom: nomPochette(t) || "Pochette", tags: motsCles([t?.artist, t?.title].filter(Boolean).join(",")) });
  };
  Object.values(songs).forEach((s) => noter(s?.imageId, s));
  Object.values(playlists).forEach((p) => Object.values(p?.tracks ?? {}).forEach((t) => noter(t?.imageId, t)));
  return out;
}

/**
 * Une image est une pochette si sa fiche est rangée dans « Pochettes », ou si elle sert de pochette sans avoir été
 * rangée ailleurs : une image que Sarah a mise elle-même dans une de ses catégories reste dans « Mes images ».
 */
const estPochette = (id, fiche, pochettes) => fiche?.cat === POCHETTES || (!fiche?.cat && pochettes.has(id));

/**
 * Ses images : celles qui ont une fiche (envoyées dans la bibliothèque, ou déjà rangées), puis celles déjà utilisées
 * sans fiche (« À ranger »), les plus récentes d'abord. Jamais les pochettes ([pochettes] : celles des chansons) ni les
 * images des packs ([packs], voir imagesDesPacks).
 */
export function mesImages(medias = {}, utilisees = new Map(), pochettes = new Map(), packs = new Map()) {
  const out = [];
  for (const [id, f] of Object.entries(medias)) {
    if (!f || !IMAGE_ID.test(id) || estPochette(id, f, pochettes) || estImagePack(id, f, packs)) continue;
    out.push({
      groupe: "miennes", id, nom: f.name ?? utilisees.get(id)?.nom ?? "", cat: f.cat || A_RANGER, tags: motsCles(f.tags),
      retiree: f.hidden === true, ou: utilisees.get(id)?.ou ?? [], fiche: true, date: f.createdAt ?? f.updatedAt ?? 0,
    });
  }
  out.sort((a, b) => b.date - a.date);
  for (const [id, x] of utilisees) {
    if (!medias[id] && !pochettes.has(id) && !packs.has(id)) out.push({ groupe: "miennes", id, nom: x.nom, cat: A_RANGER, tags: [], retiree: false, ou: x.ou, fiche: false, date: 0 });
  }
  return out;
}

/**
 * Les pochettes : celles des chansons et des playlists, et celles gardées après l'effacement de leur chanson (fiche
 * « Pochettes »), par artiste puis titre. Une fiche donne son nom, ses mots-clés et « retirée ».
 */
export function mesPochettes(medias = {}, pochettes = new Map(), utilisees = new Map()) {
  const out = [];
  for (const [id, f] of Object.entries(medias)) {
    if (!f || !IMAGE_ID.test(id) || !estPochette(id, f, pochettes)) continue;
    const p = pochettes.get(id);
    out.push({
      groupe: "pochettes", id, nom: f.name ?? p?.nom ?? "", cat: POCHETTES, tags: f.tags ? motsCles(f.tags) : p?.tags ?? [],
      retiree: f.hidden === true, ou: utilisees.get(id)?.ou ?? [], fiche: true,
    });
  }
  for (const [id, p] of pochettes) {
    if (!medias[id]) out.push({ groupe: "pochettes", id, nom: p.nom, cat: POCHETTES, tags: p.tags, retiree: false, ou: utilisees.get(id)?.ou ?? [], fiche: false });
  }
  return out.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

/** Une image correspond à la recherche si chaque mot cherché est dans son nom, sa catégorie ou ses mots-clés. */
export function correspond(item, recherche) {
  const mots = sansAccent(recherche).split(/\s+/).filter(Boolean);
  if (!mots.length) return true;
  const texte = sansAccent([item.nom, item.cat, ...(item.tags ?? []), ...(item.ou ?? [])].join(" "));
  return mots.every((m) => texte.includes(m));
}

/** Catégories d'une liste d'images, dans l'ordre où elles apparaissent ; « À ranger » toujours en premier. */
export function categoriesDe(items) {
  const cats = [...new Set(items.map((x) => x.cat).filter(Boolean))];
  return cats.includes(A_RANGER) ? [A_RANGER, ...cats.filter((c) => c !== A_RANGER)] : cats;
}

/** Catégories à proposer pour ses images : les suggestions, puis celles qu'elle a créées. */
export function categoriesPerso(items) {
  const siennes = categoriesDe(items).filter((c) => c !== A_RANGER && !CATEGORIES_PERSO.includes(c)).sort((a, b) => a.localeCompare(b, "fr"));
  return [...CATEGORIES_PERSO.slice(0, -1), ...siennes, CATEGORIES_PERSO.at(-1)];
}

/** Fiche à enregistrer pour une image ([avant] : la fiche actuelle) ; null si le nom est vide. */
export function ficheImage({ nom, cat, tags, retiree = false }, avant = null) {
  const name = `${nom ?? ""}`.trim().replace(/\s+/g, " ").slice(0, FICHE.nom);
  if (!name) return null;
  const c = `${cat ?? ""}`.trim().slice(0, FICHE.cat);
  return {
    name, ...(c && c !== A_RANGER ? { cat: c } : {}), tags: texteMotsCles(motsCles(Array.isArray(tags) ? tags.join(",") : tags)),
    ...(retiree ? { hidden: true } : {}), createdAt: avant?.createdAt ?? Date.now(),
  };
}
