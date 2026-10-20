// « Jamais deux fois » (règle impérative de cedric, 20 octobre) : dans une même prestation, un tirage au hasard ne
// reprend jamais une image, un émoji ou un mot déjà utilisé dans une autre activité (le petit coq des Mimes ne revient
// pas au Zoom mystère ni dans Qui a disparu ?). Choisi à la main, il reste permis, avec un message rouge
// « déjà utilisé dans … ». Fonctions pures, sans Firebase ; aucune autre dépendance (show.js et manches.js s'en servent).

const ARTICLE = /^(le|la|les|l|un|une|des|du|de la)\s+/;
const IMAGE_ID = /^[0-9a-f]{16}$/;

/**
 * Mot réduit à l'essentiel pour comparer : minuscules sans accents ni article, singulier approché
 * (« Les Cerises » et « cerise » se retrouvent, « L'éléphant » et « Éléphant » aussi).
 */
export function motCle(mot) {
  const base = `${mot ?? ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/œ/gi, "oe").toLowerCase()
    .replace(/[’']/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(ARTICLE, "");
  return base.split(" ").map((w) => (w.length > 3 ? w.replace(/[sx]$/, "") : w)).join("-");
}

/** Émoji comparable : sans sélecteur de variante ni couleur de peau (🐴 et 🐴️ sont la même image). */
export const emojiCle = (e) => `${e ?? ""}`.replace(/[︎️]|\uD83C[\uDFFB-\uDFFF]/g, "").trim();

/** Ce qu'un élément montre ou fait dire : son mot, son émoji, sa photo. */
export function concepts({ word, image, imageId } = {}) {
  const out = [];
  const w = motCle(word);
  if (w) out.push(`m:${w}`);
  const e = emojiCle(image);
  // Une image longue est une adresse (photo), pas un émoji : elle compte par son identifiant.
  if (e && e.length <= 16) out.push(`e:${e}`);
  if (IMAGE_ID.test(imageId ?? "")) out.push(`i:${imageId}`);
  return out;
}

/** Ce qu'une question du programme montre (mimes, Pictionary, Qui a disparu ?, Zoom, Image floue, Chante le mot, Qui suis-je ?, quiz photo). */
export function questionConcepts(q) {
  if (!q) return [];
  const cards = Array.isArray(q.cards) ? q.cards : [];
  switch (q.kind) {
    case "mime":
    case "pictionary":
    case "disparu":
      return cards.flatMap(concepts);
    case "chante":
      return concepts({ word: q.choices?.[0] });
    case "quisuis":
      return concepts({ word: q.choices?.[0], image: q.image, imageId: q.imageId });
    case "zoom":
    case "flou":
      return concepts({ word: q.choices?.[q.correct], imageId: q.imageId });
    default: {
      // Quiz photo : les photos des réponses et leurs mots ; puis l'illustration de la révélation (ou la pochette).
      const photos = q.choiceImages && typeof q.choiceImages === "object" ? q.choiceImages : null;
      const answers = photos ? (q.choices ?? []).flatMap((c, k) => (IMAGE_ID.test(photos[k] ?? "") ? concepts({ word: c, imageId: photos[k] }) : [])) : [];
      return [...answers, ...concepts({ imageId: q.imageId })];
    }
  }
}

/** L'élément a-t-il déjà servi ([used] : Set de concepts) ? */
export const dejaUtilise = (keys, used) => !!used && keys.some((k) => used.has(k));

/**
 * Garde les éléments neufs (aucun de leurs concepts dans [used]) s'il en reste au moins [need] ; sinon toute la
 * liste : on ne bloque jamais une fête faute de contenu neuf. [keysOf] : les concepts d'un élément.
 */
export function neufsSiPossible(list, keysOf, used, need = 1) {
  if (!used?.size) return list;
  const fresh = list.filter((x) => !dejaUtilise(keysOf(x), used));
  return fresh.length >= Math.min(need, list.length) ? fresh : list;
}
