// Photos de la banque des tout-petits (web/public/banque/<clé>.jpg, domaine public) dans les jeux : Mimes et Qui a
// disparu ? (« 📷 Photos » : chaque carte dont le mot est dans la banque montre sa photo), Zoom mystère et Image floue
// (photos de la banque à choisir, avec des réponses en images pour les enfants qui ne lisent pas encore).
// Une photo de la banque est désignée par sa clé (« banque »), puis copiée dans la partie par la régie au chargement
// du programme (resolveBanque) : rien dans la base de la bibliothèque, la banque vit avec le site (jamais effaçable).
import { BANQUE_MOTS, FAMILLES_PETITS, cleMot } from "./banque-petits.js";
import { motCle } from "./jamais-deux-fois.js";
import { imageId } from "./illustration.js";
import { CLES_PHOTOS } from "./banque/liste.js";

/** Préfixe des photos de la banque choisies dans une manche Zoom mystère ou Image floue (« banque:vache »). */
export const BANQUE = "banque:";

/**
 * Mots qui ont vraiment leur photo sur le site : seuls ceux-là sont proposés en photos (un mot sans photo garde son
 * émoji, jamais une fausse photo).
 */
export const PHOTOS_BANQUE = new Set(CLES_PHOTOS);
const aPhoto = (m) => !!m && PHOTOS_BANQUE.has(m.cle);

const PAR_CLE = new Map(BANQUE_MOTS.map((m) => [m.cle, m]));
const PAR_CONCEPT = new Map(BANQUE_MOTS.map((m) => [motCle(m.mot), m]));

/** Le mot de la banque qui correspond à un mot de jeu (« Cerises », « le chat »…), ou null. */
export const motDeLaBanque = (word) => (typeof word === "string" && word.trim() ? PAR_CLE.get(cleMot(word)) ?? PAR_CONCEPT.get(motCle(word)) ?? null : null);

/** Une carte ou un objet ({ word, image }) avec la photo de la banque de son mot, s'il y en a une. */
export const avecPhoto = (card) => {
  const m = card && !card.imageId && !card.banque ? motDeLaBanque(card.word) : null;
  return aPhoto(m) ? { ...card, banque: m.cle } : card;
};

/** Petite empreinte stable : le même mot donne toujours la même question (aperçu de la Régie PC = la partie). */
function empreinte(s) {
  let h = 2166136261;
  for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

const sosies = (m) => [...m.tags].filter((t) => t.startsWith("g-"));
const questions = new Map();

/**
 * Question Zoom mystère ou Image floue faite d'une photo de la banque : « Qu'est-ce que c'est ? », 4 réponses en
 * images (émoji + mot, lisibles par les enfants qui ne lisent pas) prises dans la même famille, jamais deux mots qui
 * se ressemblent trop (étiquettes « g-… »). Null si la clé n'existe pas.
 */
export function questionBanque(cle) {
  if (questions.has(cle)) return questions.get(cle);
  const m = PAR_CLE.get(cle);
  if (!m) return null;
  const evite = new Set(sosies(m));
  const autres = BANQUE_MOTS.filter((x) => x.famille === m.famille && x.cle !== cle && !sosies(x).some((t) => evite.has(t)))
    .sort((a, b) => empreinte(cle + a.cle) - empreinte(cle + b.cle)).slice(0, 3);
  const choix = [m, ...autres];
  const correct = empreinte(cle) % choix.length;
  [choix[0], choix[correct]] = [choix[correct], choix[0]];
  const q = { text: "Qu'est-ce que c'est ?", choices: choix.map((x) => `${x.emoji} ${x.mot}`), correct, banque: cle, status: "validee" };
  questions.set(cle, q);
  return q;
}

/** Photos de la banque comme éléments de collection (Zoom mystère, Image floue), rangées par famille. */
export const banqueItems = () => BANQUE_MOTS.filter(aPhoto).map((m) => ({
  key: `${BANQUE}${m.cle}`, label: `📷 ${m.emoji} ${m.mot}`, group: `Photos · ${FAMILLES_PETITS[m.famille] ?? m.famille}`, level: 1, value: questionBanque(m.cle),
}));

/**
 * Familles de la banque pour Qui a disparu ? : « Photos · Animaux », chaque objet avec sa photo (et son émoji en
 * secours), 5 objets au moins. Mêmes champs que les familles en émojis (DISPARU_THEMES).
 */
let familles = null;
export function disparuPhotos() {
  if (familles?.n !== PHOTOS_BANQUE.size) {
    familles = {
      n: PHOTOS_BANQUE.size,
      liste: Object.entries(FAMILLES_PETITS).map(([famille, nom]) => ({
        theme: `Photos · ${nom}`,
        objects: BANQUE_MOTS.filter((m) => m.famille === famille && aPhoto(m)).map((m) => ({ word: m.mot, image: m.emoji, banque: m.cle })),
      })).filter((t) => t.objects.length >= 5),
    };
  }
  return familles.liste;
}

/** Ce qu'il reste à copier dans la partie : `{ cle, dir }` (dir « images » pour une photo de question, sinon « choiceImages »). */
export function banqueRefs(questionsList) {
  const out = new Map();
  for (const q of questionsList ?? []) {
    if (q?.banque) out.set(`images/${q.banque}`, { cle: q.banque, dir: "images" });
    for (const c of Array.isArray(q?.cards) ? q.cards : []) if (c?.banque) out.set(`choiceImages/${c.banque}`, { cle: c.banque, dir: "choiceImages" });
  }
  return [...out.values()];
}

/**
 * Copie les photos de la banque dans la partie et rend le programme où chacune est remplacée par son identifiant
 * (les questions d'origine ne sont pas touchées). [photo](cle) : la photo en data URL, ou null si elle manque ;
 * [secours](mot) : l'émoji dessiné en image (photo de question seulement : un Zoom mystère a toujours quelque chose à
 * montrer) ; [ecrire](dir, id, data). Une carte sans photo garde son émoji ; rien ne bloque jamais le chargement.
 */
export async function resolveBanque(questionsList, { photo, secours = async () => null, ecrire }) {
  const faits = new Map();
  const copie = (cle, dir, repli) => {
    const k = `${dir}/${cle}`;
    if (!faits.has(k)) {
      faits.set(k, (async () => {
        try {
          const data = (await photo(cle)) ?? (repli ? await secours(PAR_CLE.get(cle)) : null);
          if (!data) return null;
          const id = await imageId(data);
          await ecrire(dir, id, data);
          return id;
        } catch (e) {
          console.warn("Photo de la banque", cle, e);
          return null;
        }
      })());
    }
    return faits.get(k);
  };
  const sans = async (x, dir, repli) => {
    const { banque, ...reste } = x;
    const id = await copie(banque, dir, repli);
    return id ? { ...reste, imageId: id } : reste;
  };
  return Promise.all((questionsList ?? []).map(async (q) => {
    if (!q?.banque && !(Array.isArray(q?.cards) && q.cards.some((c) => c?.banque))) return q;
    const out = q.banque ? await sans(q, "images", true) : { ...q };
    if (Array.isArray(q.cards)) out.cards = await Promise.all(q.cards.map((c) => (c?.banque ? sans(c, "choiceImages", false) : c)));
    return out;
  }));
}

/** Lit une photo de la banque sur le site, en data URL (null si elle n'existe pas encore). */
export async function lirePhotoBanque(cle) {
  try {
    const res = await fetch(`banque/${encodeURIComponent(cle)}.jpg`);
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    const blob = await res.blob();
    if (!blob.size || blob.size > 100_000) return null;
    return await new Promise((ok, ko) => {
      const r = new FileReader();
      r.onload = () => ok(typeof r.result === "string" ? r.result : null);
      r.onerror = () => ko(r.error);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** L'émoji d'un mot dessiné en grand sur fond blanc (JPEG 480 px), quand sa photo manque. */
export async function emojiEnImage(m) {
  if (!m?.emoji || typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 480;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 480, 480);
  ctx.font = "320px 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(m.emoji, 240, 262);
  return canvas.toDataURL("image/jpeg", 0.8);
}
