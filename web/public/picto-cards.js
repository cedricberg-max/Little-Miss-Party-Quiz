// Catalogue intégré du Pictionary : des mots faciles à dessiner pour des enfants, chacun avec son image (un
// émoji affiché en grand sur la tablette du dessinateur, puis sur la TV à la fin du tour). Émojis d'avant 2019
// (Emoji 11) seulement : une box sous Android 9 les affiche tous. Les mots marqués « grands » (level 2) ne
// sortent pas pour les 6-8 ans. Sarah retire des mots ou ajoute les siens dans l'administration (page Jeux).

// Les mots sont rangés en séries (thèmes) : une manche peut n'en garder que quelques-unes, choisies ou tirées au hasard.
const T = (series, list) => list.map(([word, image, hard]) => ({ word, image, level: hard ? 2 : 1, series }));

/** Série des mots ajoutés par Sarah sans série choisie. */
export const PICTO_OWN_SERIES = "Mes mots";

export const PICTO_WORDS = [
  ...T("Animaux", [
    ["Chat", "🐱"], ["Chien", "🐶"], ["Poisson", "🐟"], ["Serpent", "🐍"], ["Escargot", "🐌"], ["Papillon", "🦋"],
    ["Araignée", "🕷️"], ["Éléphant", "🐘"], ["Girafe", "🦒"], ["Lapin", "🐰"], ["Tortue", "🐢"], ["Pieuvre", "🐙"],
    ["Baleine", "🐳"], ["Oiseau", "🐦"], ["Abeille", "🐝"], ["Coccinelle", "🐞"], ["Dinosaure", "🦕", true], ["Licorne", "🦄"],
  ]),
  ...T("Nature et météo", [
    ["Soleil", "☀️"], ["Lune", "🌙"], ["Étoile", "⭐"], ["Nuage", "☁️"], ["Pluie", "🌧️"], ["Arc-en-ciel", "🌈"],
    ["Fleur", "🌸"], ["Arbre", "🌳"], ["Montagne", "⛰️"], ["Volcan", "🌋", true], ["Île", "🏝️", true], ["Bonhomme de neige", "⛄"],
  ]),
  ...T("Maison et objets", [
    ["Maison", "🏠"], ["Château", "🏰"], ["Clé", "🔑"], ["Lunettes", "👓"], ["Parapluie", "☂️"], ["Ballon", "🎈"],
    ["Cadeau", "🎁"], ["Bougie", "🕯️"], ["Ciseaux", "✂️"], ["Livre", "📖"], ["Téléphone", "📱"], ["Horloge", "⏰"],
    ["Lit", "🛏️"], ["Ampoule", "💡", true], ["Couronne", "👑"], ["Chapeau", "🎩"], ["Chaussure", "👟"], ["Robot", "🤖"],
  ]),
  ...T("À manger", [
    ["Pomme", "🍎"], ["Banane", "🍌"], ["Gâteau d'anniversaire", "🎂"], ["Glace", "🍦"], ["Pizza", "🍕"], ["Carotte", "🥕"],
    ["Fraise", "🍓"], ["Hamburger", "🍔"], ["Sucette", "🍭"], ["Œuf", "🥚"],
  ]),
  ...T("Transports", [
    ["Voiture", "🚗"], ["Vélo", "🚲"], ["Avion", "✈️"], ["Bateau", "⛵"], ["Fusée", "🚀"], ["Train", "🚂"],
    ["Hélicoptère", "🚁", true], ["Tracteur", "🚜"],
  ]),
  ...T("Fête et personnages", [
    ["Fantôme", "👻"], ["Pirate", "🏴‍☠️", true], ["Sorcière", "🧙", true], ["Clown", "🤡"], ["Extraterrestre", "👽"], ["Sirène", "🧜‍♀️", true],
    ["Guitare", "🎸"], ["Tambour", "🥁"], ["Football", "⚽"], ["Cœur", "❤️"],
  ]),
];

/** Les séries du catalogue intégré, dans l'ordre. */
export const PICTO_SERIES = [...new Set(PICTO_WORDS.map((w) => w.series))];
