// Catalogue intégré des cartes de mimes : un mot simple à mimer et son image (emoji affiché en très grand
// sur la TV). Emojis d'avant 2019 (Emoji 11) seulement : une box sous Android 9 les affiche tous.
// Sarah coche des cartes dans l'administration pour composer un paquet ; elle peut aussi ajouter ses mots.

const T = (theme, list) => list.map(([word, image, hard]) => ({ theme, word, image, level: hard ? 2 : 1 }));

export const MIME_CATALOG = [
  ...T("Animaux", [
    ["Chat", "🐱"], ["Chien", "🐶"], ["Lapin", "🐰"], ["Singe", "🐒"], ["Éléphant", "🐘"], ["Lion", "🦁"],
    ["Serpent", "🐍"], ["Poule", "🐔"], ["Grenouille", "🐸"], ["Canard", "🦆"], ["Pingouin", "🐧"], ["Cheval", "🐴"],
    ["Cochon", "🐷"], ["Vache", "🐮"], ["Poisson", "🐟"], ["Requin", "🦈"], ["Papillon", "🦋"], ["Araignée", "🕷️"],
    ["Escargot", "🐌"], ["Kangourou", "🦘", true], ["Crocodile", "🐊"], ["Chauve-souris", "🦇", true], ["Pieuvre", "🐙", true],
    ["Gorille", "🦍"], ["Abeille", "🐝"], ["Tortue", "🐢"], ["Hibou", "🦉", true], ["Ours", "🐻"], ["Souris", "🐭"], ["Girafe", "🦒", true],
  ]),
  ...T("Métiers", [
    ["Pompier", "👨‍🚒"], ["Policier", "👮"], ["Cuisinier", "👩‍🍳"], ["Docteur", "👩‍⚕️"], ["Pilote d'avion", "👨‍✈️", true],
    ["Astronaute", "👩‍🚀"], ["Peintre", "🎨"], ["Coiffeur", "💇", true], ["Jardinier", "👨‍🌾"], ["Facteur", "📮", true],
    ["Magicien", "🎩"], ["Chanteur", "🎤"], ["Photographe", "📸", true], ["Professeur", "👩‍🏫"], ["Dentiste", "🦷", true],
    ["Clown", "🤡"], ["Détective", "🕵️", true], ["Plongeur", "🌊", true], ["Mécanicien", "🔧", true], ["Pirate", "🏴‍☠️"],
  ]),
  ...T("Sports", [
    ["Football", "⚽"], ["Basket", "🏀"], ["Tennis", "🎾"], ["Natation", "🏊"], ["Vélo", "🚴"], ["Ski", "⛷️"],
    ["Boxe", "🥊"], ["Danse", "💃"], ["Golf", "⛳", true], ["Surf", "🏄"], ["Judo", "🥋", true], ["Course à pied", "🏃"],
    ["Patin à glace", "⛸️", true], ["Escalade", "🧗", true], ["Bowling", "🎳"], ["Haltérophilie", "🏋️", true], ["Équitation", "🏇", true],
    ["Ping-pong", "🏓"], ["Skateboard", "🛹", true], ["Pêche", "🎣"],
  ]),
  ...T("Actions", [
    ["Se brosser les dents", "🦷"], ["Dormir", "😴"], ["Manger une glace", "🍦"], ["Prendre une douche", "🚿"],
    ["Conduire une voiture", "🚗"], ["Téléphoner", "📞"], ["Lire un livre", "📖"], ["Pleurer", "😭"], ["Rire", "😂"],
    ["Éternuer", "🤧"], ["Se maquiller", "💄", true], ["Faire un gâteau", "🎂", true], ["Prendre un selfie", "🤳"],
    ["Faire les courses", "🛒", true], ["Jouer aux jeux vidéo", "🎮"], ["Se coiffer", "💇‍♀️", true], ["Souffler les bougies", "🕯️"],
    ["Ouvrir un cadeau", "🎁"], ["Avoir peur", "😱"], ["Faire du camping", "⛺", true],
  ]),
  ...T("Objets", [
    ["Parapluie", "☂️"], ["Ballon", "🎈"], ["Téléphone", "📱"], ["Ordinateur", "💻", true], ["Guitare", "🎸"],
    ["Ciseaux", "✂️"], ["Marteau", "🔨"], ["Lunettes", "👓"], ["Appareil photo", "📷"], ["Clé", "🔑"],
    ["Balai", "🧹", true], ["Montre", "⌚", true], ["Trompette", "🎺"], ["Batterie", "🥁"], ["Violon", "🎻", true],
    ["Piano", "🎹"], ["Fusée", "🚀"], ["Hélicoptère", "🚁"], ["Bateau", "⛵"], ["Train", "🚂"],
  ]),
  ...T("Nourriture", [
    ["Pizza", "🍕"], ["Spaghettis", "🍝"], ["Banane", "🍌"], ["Pop-corn", "🍿"], ["Hamburger", "🍔"], ["Sucette", "🍭"],
    ["Pomme", "🍎"], ["Citron", "🍋", true], ["Frites", "🍟"], ["Bonbon", "🍬"], ["Soupe", "🍲", true],
    ["Crêpe", "🥞"], ["Œuf", "🥚"], ["Piment", "🌶️", true], ["Carotte", "🥕"],
  ]),
  ...T("Imaginaire", [
    ["Fantôme", "👻"], ["Robot", "🤖"], ["Zombie", "🧟"], ["Vampire", "🧛", true], ["Sorcière", "🧙‍♀️"], ["Licorne", "🦄"],
    ["Dragon", "🐉"], ["Fée", "🧚"], ["Super-héros", "🦸"], ["Sirène", "🧜‍♀️", true], ["Extraterrestre", "👽"],
    ["Princesse", "👸"], ["Roi", "🤴"], ["Chevalier", "🛡️", true], ["Cow-boy", "🤠"],
  ]),
];

export const MIME_THEMES = [...new Set(MIME_CATALOG.map((c) => c.theme))];

/** Paquet prêt à l'emploi : toutes les cartes faciles d'un thème (ou de tous les thèmes). */
export function starterCards(theme = null, level = 1) {
  return MIME_CATALOG.filter((c) => (!theme || c.theme === theme) && c.level <= level).map(({ word, image }) => ({ word, image }));
}

/** Mélange de Fisher-Yates ; [random] est remplaçable pour les tests. */
export function shuffle(list, random = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
