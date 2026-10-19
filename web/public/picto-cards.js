// Catalogue intégré du Pictionary : des mots faciles à dessiner pour des enfants, chacun avec son image (un
// émoji affiché en grand sur la tablette du dessinateur, puis sur la TV à la fin du tour). Émojis d'avant 2019
// (Emoji 11) seulement : une box sous Android 9 les affiche tous. Les mots marqués « grands » (level 2) ne
// sortent pas pour les 6-8 ans. Sarah retire des mots ou ajoute les siens dans l'administration (page Jeux).

const T = (list) => list.map(([word, image, hard]) => ({ word, image, level: hard ? 2 : 1 }));

export const PICTO_WORDS = T([
  // Animaux
  ["Chat", "🐱"], ["Chien", "🐶"], ["Poisson", "🐟"], ["Serpent", "🐍"], ["Escargot", "🐌"], ["Papillon", "🦋"],
  ["Araignée", "🕷️"], ["Éléphant", "🐘"], ["Girafe", "🦒"], ["Lapin", "🐰"], ["Tortue", "🐢"], ["Pieuvre", "🐙"],
  ["Baleine", "🐳"], ["Oiseau", "🐦"], ["Abeille", "🐝"], ["Coccinelle", "🐞"], ["Dinosaure", "🦕", true], ["Licorne", "🦄"],
  // Nature et météo
  ["Soleil", "☀️"], ["Lune", "🌙"], ["Étoile", "⭐"], ["Nuage", "☁️"], ["Pluie", "🌧️"], ["Arc-en-ciel", "🌈"],
  ["Fleur", "🌸"], ["Arbre", "🌳"], ["Montagne", "⛰️"], ["Volcan", "🌋", true], ["Île", "🏝️", true], ["Bonhomme de neige", "⛄"],
  // Maison et objets
  ["Maison", "🏠"], ["Château", "🏰"], ["Clé", "🔑"], ["Lunettes", "👓"], ["Parapluie", "☂️"], ["Ballon", "🎈"],
  ["Cadeau", "🎁"], ["Bougie", "🕯️"], ["Ciseaux", "✂️"], ["Livre", "📖"], ["Téléphone", "📱"], ["Horloge", "⏰"],
  ["Lit", "🛏️"], ["Ampoule", "💡", true], ["Couronne", "👑"], ["Chapeau", "🎩"], ["Chaussure", "👟"], ["Robot", "🤖"],
  // Manger
  ["Pomme", "🍎"], ["Banane", "🍌"], ["Gâteau d'anniversaire", "🎂"], ["Glace", "🍦"], ["Pizza", "🍕"], ["Carotte", "🥕"],
  ["Fraise", "🍓"], ["Hamburger", "🍔"], ["Sucette", "🍭"], ["Œuf", "🥚"],
  // Transports
  ["Voiture", "🚗"], ["Vélo", "🚲"], ["Avion", "✈️"], ["Bateau", "⛵"], ["Fusée", "🚀"], ["Train", "🚂"],
  ["Hélicoptère", "🚁", true], ["Tracteur", "🚜"],
  // Fête et personnages
  ["Fantôme", "👻"], ["Pirate", "🏴‍☠️", true], ["Sorcière", "🧙", true], ["Clown", "🤡"], ["Extraterrestre", "👽"], ["Sirène", "🧜‍♀️", true],
  ["Guitare", "🎸"], ["Tambour", "🥁"], ["Football", "⚽"], ["Cœur", "❤️"],
]);
