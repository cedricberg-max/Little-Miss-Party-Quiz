/**
 * Banque du Rébus (cedric, 1/11) : des mots coupés en morceaux qui se prononcent. Chaque morceau est une photo de la banque
 * des tout-petits (`banque` : clé de web/public/banque/<clé>.jpg, domaine public, déjà validée par cedric) ou une lettre /
 * un chiffre écrit en néon sur la TV (`texte`). `son` est ce que le morceau fait entendre : la TV l'écrit sous le morceau
 * à la révélation, puis le mot entier.
 * Niveaux : facile (deux photos de choses que les 5-8 ans connaissent), moyen (une lettre ou un chiffre, ou un mot moins
 * courant), difficile (trois ou quatre morceaux, sons plus approchés).
 * Le dé de la Régie PC pioche ici, jamais deux fois le même mot dans une prestation.
 */
export const REBUS = [
  // Facile
  { mot: "Pinceau", niveau: "facile", morceaux: [{ son: "pain", banque: "pain" }, { son: "seau", banque: "seau" }] },
  { mot: "Pompier", niveau: "facile", morceaux: [{ son: "pont", banque: "pont" }, { son: "pied", banque: "pied" }] },
  { mot: "Oiseau", niveau: "facile", morceaux: [{ son: "oie", banque: "oie" }, { son: "seau", banque: "seau" }] },
  { mot: "Serpent", niveau: "facile", morceaux: [{ son: "cerf", banque: "cerf" }, { son: "paon", banque: "paon" }] },
  { mot: "Robot", niveau: "facile", morceaux: [{ son: "robe", banque: "robe" }, { son: "eau", banque: "eau" }] },
  { mot: "Ciseaux", niveau: "facile", morceaux: [{ son: "scie", banque: "scie" }, { son: "seau", banque: "seau" }] },
  { mot: "Lionceau", niveau: "facile", morceaux: [{ son: "lion", banque: "lion" }, { son: "seau", banque: "seau" }] },
  { mot: "Pompon", niveau: "facile", morceaux: [{ son: "pont", banque: "pont" }, { son: "pont", banque: "pont" }] },
  { mot: "Dessert", niveau: "facile", morceaux: [{ son: "dé", banque: "de" }, { son: "cerf", banque: "cerf" }] },
  { mot: "Chalet", niveau: "facile", morceaux: [{ son: "chat", banque: "chat" }, { son: "lait", banque: "lait" }] },
  { mot: "Anneau", niveau: "facile", morceaux: [{ son: "âne", banque: "ane" }, { son: "eau", banque: "eau" }] },
  { mot: "Roseau", niveau: "facile", morceaux: [{ son: "rose", banque: "rose" }, { son: "eau", banque: "eau" }] },
  { mot: "Merci", niveau: "facile", morceaux: [{ son: "mer", banque: "mer" }, { son: "scie", banque: "scie" }] },
  { mot: "Bébé", niveau: "facile", morceaux: [{ son: "B", texte: "B" }, { son: "B", texte: "B" }] },

  // Moyen
  { mot: "Saucisse", niveau: "moyen", morceaux: [{ son: "seau", banque: "seau" }, { son: "six", texte: "6" }] },
  { mot: "Télé", niveau: "moyen", morceaux: [{ son: "T", texte: "T" }, { son: "lait", banque: "lait" }] },
  { mot: "Cadeau", niveau: "moyen", morceaux: [{ son: "K", texte: "K" }, { son: "dé", banque: "de" }, { son: "eau", banque: "eau" }] },
  { mot: "Oursin", niveau: "moyen", morceaux: [{ son: "ours", banque: "ours" }, { son: "un", texte: "1" }] },
  { mot: "Coquin", niveau: "moyen", morceaux: [{ son: "coq", banque: "coq" }, { son: "un", texte: "1" }] },
  { mot: "Vernis", niveau: "moyen", morceaux: [{ son: "ver", banque: "ver-de-terre" }, { son: "nid", banque: "nid" }] },
  { mot: "Cerceau", niveau: "moyen", morceaux: [{ son: "cerf", banque: "cerf" }, { son: "seau", banque: "seau" }] },
  { mot: "Gilet", niveau: "moyen", morceaux: [{ son: "J", texte: "J" }, { son: "lait", banque: "lait" }] },
  { mot: "Danser", niveau: "moyen", morceaux: [{ son: "dents", banque: "dents" }, { son: "C", texte: "C" }] },
  { mot: "Danger", niveau: "moyen", morceaux: [{ son: "dents", banque: "dents" }, { son: "G", texte: "G" }] },
  { mot: "Pensée", niveau: "moyen", morceaux: [{ son: "paon", banque: "paon" }, { son: "C", texte: "C" }] },
  { mot: "Cacao", niveau: "moyen", morceaux: [{ son: "K", texte: "K" }, { son: "K", texte: "K" }, { son: "O", texte: "O" }] },
  { mot: "Soleil", niveau: "moyen", morceaux: [{ son: "seau", banque: "seau" }, { son: "l'œil", banque: "oeil" }] },
  { mot: "Boucherie", niveau: "moyen", morceaux: [{ son: "bouche", banque: "bouche" }, { son: "riz", banque: "riz" }] },

  // Difficile
  { mot: "Muraille", niveau: "difficile", morceaux: [{ son: "mûre", banque: "mure" }, { son: "ail", banque: "ail" }] },
  { mot: "Dentelle", niveau: "difficile", morceaux: [{ son: "dents", banque: "dents" }, { son: "T", texte: "T" }, { son: "L", texte: "L" }] },
  { mot: "Hôtel", niveau: "difficile", morceaux: [{ son: "O", texte: "O" }, { son: "T", texte: "T" }, { son: "L", texte: "L" }] },
  { mot: "Énervé", niveau: "difficile", morceaux: [{ son: "N", texte: "N" }, { son: "R", texte: "R" }, { son: "V", texte: "V" }] },
  { mot: "Solitaire", niveau: "difficile", morceaux: [{ son: "seau", banque: "seau" }, { son: "lit", banque: "lit" }, { son: "T", texte: "T" }, { son: "R", texte: "R" }] },
  { mot: "Pomme de terre", niveau: "difficile", morceaux: [{ son: "pomme", banque: "pomme" }, { son: "dé", banque: "de" }, { son: "T", texte: "T" }, { son: "R", texte: "R" }] },
  { mot: "Pierre", niveau: "difficile", morceaux: [{ son: "pied", banque: "pied" }, { son: "R", texte: "R" }] },
  { mot: "Lionne", niveau: "difficile", morceaux: [{ son: "lion", banque: "lion" }, { son: "N", texte: "N" }] },
];

/** Niveaux du Rébus, dans l'ordre de la Régie PC. */
export const NIVEAUX_REBUS = ["facile", "moyen", "difficile"];

/**
 * Une question Rébus prête à jouer pour un mot de la banque : « Quel est ce mot ? », le mot en seule réponse, un morceau
 * par carte (la photo de la banque est copiée dans la partie par la régie au chargement, comme pour les Mimes).
 */
export function questionRebus(r, id) {
  return {
    ...(id ? { id } : {}),
    kind: "rebus",
    text: "Quel est ce mot ?",
    choices: [r.mot],
    correct: 0,
    duration: Math.min(120, Math.max(10, 12 * r.morceaux.length)),
    // Photo de la banque (copiée dans la partie au chargement), image de Sarah (imageId), ou lettre / chiffre en néon.
    cards: r.morceaux.map((m) => (m.banque ? { word: m.son, banque: m.banque } : m.imageId ? { word: m.son, imageId: m.imageId } : { word: m.texte })),
  };
}

const sansAccents = (s) => `${s ?? ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Un morceau écrit à la main par Sarah (« pain », « 6 », « K ») : une lettre ou un chiffre devient du néon, un son déjà
 * illustré dans la banque du Rébus reprend sa photo. Null : il faudra une photo à soi.
 */
export function morceauConnu(son) {
  const s = `${son ?? ""}`.trim();
  if (/^[\p{L}\d]{1,2}$/u.test(s) && (/^\d+$/.test(s) || s.length === 1)) return { son: s, texte: s.toUpperCase() };
  const cle = sansAccents(s);
  for (const r of REBUS) for (const m of r.morceaux) if (m.banque && sansAccents(m.son) === cle) return { son: m.son, banque: m.banque };
  return null;
}
