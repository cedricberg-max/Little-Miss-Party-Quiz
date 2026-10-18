// Contenus intégrés des jeux au buzzer inspirés de « Vendredi tout est permis » : aucun travail de
// préparation pour Sarah. Émojis d'avant 2019 (Emoji 11) seulement, comme les cartes de mimes.
// level 2 : réservé aux plus grands (profils MOYENS et au-delà).

/** Chante le mot ! : des mots qu'on trouve dans beaucoup de chansons, connues des enfants comme des parents. */
export const CHANTE_WORDS = [
  ["soleil"], ["maman"], ["papa"], ["amour"], ["cœur"], ["danse"], ["fête"], ["anniversaire"], ["nuit"], ["lune"],
  ["étoile"], ["mer"], ["bateau"], ["pluie"], ["neige"], ["Noël"], ["chat"], ["loup"], ["oiseau"], ["fleur"],
  ["jardin"], ["école"], ["ami"], ["rouge"], ["bleu"], ["vent"], ["train"], ["roi"], ["princesse"], ["chanson"],
  ["été"], ["vacances"], ["ciel"], ["enfant"], ["feu"],
  ["bonheur", 2], ["liberté", 2], ["rêve", 2], ["monde", 2], ["ange", 2], ["toujours", 2], ["jamais", 2],
].map(([word, level]) => ({ word, level: level ?? 1 }));

/** Qui suis-je ? : quatre indices, du plus difficile au plus facile, puis la réponse et son émoji. */
export const QUI_SUIS_JE = [
  ["Le lion", "🦁", ["Je vis en Afrique, dans la savane", "Je dors jusqu'à 20 heures par jour", "J'ai une grande crinière", "On m'appelle le roi des animaux"]],
  ["Le pompier", "👨‍🚒", ["Je porte un casque", "Je monte sur une grande échelle", "Mon camion est rouge et fait pin-pon", "J'éteins les incendies"]],
  ["Le Père Noël", "🎅", ["Je travaille surtout une nuit par an", "J'habite au pôle Nord", "J'ai une grande barbe blanche", "Je distribue des cadeaux en traîneau"]],
  ["L'éléphant", "🐘", ["Je pèse plus lourd qu'une voiture", "J'ai de très grandes oreilles", "Je bois avec mon nez", "J'ai une trompe"]],
  ["Le pirate", "🏴‍☠️", ["Je navigue sur les mers", "Je cherche des trésors", "J'ai parfois un bandeau sur l'œil", "Mon drapeau a une tête de mort"]],
  ["Le pingouin", "🐧", ["J'habite là où il fait très froid", "Je suis un oiseau mais je ne vole pas", "Je nage très bien", "Je suis noir et blanc et je marche en me dandinant"]],
  ["L'astronaute", "👩‍🚀", ["Je porte une combinaison et un casque", "Je m'entraîne longtemps avant de partir", "Je flotte quand je travaille", "Je voyage dans l'espace en fusée"]],
  ["La sorcière", "🧹", ["Je prépare des potions", "J'ai un chapeau pointu", "J'ai souvent un chat noir", "Je vole sur un balai"]],
  ["Le dragon", "🐉", ["Je suis un animal imaginaire", "Je garde parfois des trésors", "J'ai de grandes ailes", "Je crache du feu"]],
  ["La girafe", "🦒", ["J'ai des taches sur tout le corps", "Je mange les feuilles en haut des arbres", "Ma langue est bleue", "J'ai le plus long cou du monde"]],
  ["Le dauphin", "🐬", ["Je vis dans la mer mais je respire de l'air", "Je suis très intelligent", "Je saute hors de l'eau", "On dirait que je souris tout le temps"]],
  ["Le docteur", "👩‍⚕️", ["J'écoute ton cœur", "Je travaille parfois à l'hôpital", "J'écris des ordonnances", "Je soigne les malades"]],
  ["Le vampire", "🧛", ["Je dors le jour", "Je n'aime pas l'ail", "J'ai deux grandes dents pointues", "Je me transforme en chauve-souris"]],
  ["La tortue", "🐢", ["Je peux vivre plus de 100 ans", "Je ponds des œufs", "Je suis très lente", "Je porte ma maison sur mon dos"]],
  ["Le boulanger", "🥖", ["Je me lève très tôt", "Je travaille avec de la farine", "Mon four est très chaud", "Je fais le pain et les croissants"]],
  ["Le kangourou", "🦘", ["J'habite en Australie", "Je me déplace en sautant", "Ma queue m'aide à garder l'équilibre", "Je porte mon bébé dans une poche"]],
  ["Le robot", "🤖", ["Je ne mange pas, je recharge mes batteries", "Je parle sans bouche", "Je suis fait de métal", "Je fais ce qu'on me programme"]],
  ["Le fantôme", "👻", ["Je hante les vieux châteaux", "Je traverse les murs", "Je fais « Bouh ! »", "Je suis tout blanc, comme un drap"]],
  ["La licorne", "🦄", ["Je suis un animal imaginaire", "Ma crinière a souvent toutes les couleurs", "Je ressemble à un cheval", "J'ai une corne sur le front"]],
  ["Le clown", "🤡", ["Je travaille au cirque", "J'ai de très grandes chaussures", "Je fais rire les enfants", "J'ai un nez rouge"]],
].map(([answer, emoji, clues]) => ({ answer, emoji, clues, level: 1 }));
