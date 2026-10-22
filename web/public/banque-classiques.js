// Quiz classique tout prêt (cedric, 22/10 : « des questions traditionnelles, écrites, 4 réponses écrites et un visuel de
// la réponse ») : par thème et par âge, à côté du Juste Chiffre tout prêt (banque-chiffres.js). La bonne réponse est
// écrite en premier ; elles sont mélangées quand la question entre dans un quiz. L'émoji illustre la bonne réponse :
// la TV ne le montre qu'à la révélation (jamais pendant la question). Émojis d'Android 9 au plus (Mi Box) : pas de 🪐,
// 🫁, 🧊, 🟢… Faits simples et sûrs, propositions courtes pour les petits. Données pures, testées.
import { NIVEAUX_CHIFFRES, QUESTIONS_CHIFFRES, THEMES_CHIFFRES } from "./banque-chiffres.js";

/** Thèmes des questions toutes prêtes : ceux du Juste Chiffre, plus trois pour les questions à 4 réponses. */
export const THEMES_TOUT_PRETS = {
  ...THEMES_CHIFFRES, cuisine: "Cuisine et aliments", pays: "Pays et villes", histoire: "Histoire et inventions",
};

const slug = (t) => `${t}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72);
const q = (theme, niveau, emoji, text, ...choices) => {
  const [ageMin, ageMax] = NIVEAUX_CHIFFRES[niveau];
  return { id: `qc-${slug(text)}`, theme, niveau, ageMin, ageMax, text, choices, correct: 0, emoji };
};

export const QUESTIONS_CLASSIQUES = [
  // Animaux
  q("animaux", 1, "🐘", "Quel est le plus grand animal qui vit sur la terre ferme ?", "L'éléphant", "La girafe", "Le rhinocéros", "L'hippopotame"),
  q("animaux", 1, "🦁", "Quel animal est appelé le roi de la savane ?", "Le lion", "Le zèbre", "La girafe", "La hyène"),
  q("animaux", 1, "🕷️", "Quel animal fabrique une toile ?", "L'araignée", "La fourmi", "L'abeille", "La mouche"),
  q("animaux", 1, "🐔", "Le poussin est le bébé de quel animal ?", "La poule", "La vache", "Le chat", "Le cochon"),
  q("animaux", 1, "🐸", "Quand il grandit, le têtard devient…", "Une grenouille", "Un poisson", "Un serpent", "Un lézard"),
  q("animaux", 2, "🦎", "Quel animal peut changer de couleur ?", "Le caméléon", "Le crocodile", "Le serpent", "La tortue"),
  q("animaux", 2, "🐋", "Quel est le plus grand animal du monde ?", "La baleine bleue", "L'éléphant", "Le requin blanc", "La girafe"),
  q("animaux", 2, "🐧", "Quel oiseau ne sait pas voler ?", "Le manchot", "Le pigeon", "L'aigle", "Le moineau"),
  q("animaux", 2, "❄️", "Où vit l'ours polaire ?", "Au pôle Nord", "Au pôle Sud", "Dans la jungle", "Dans le désert"),
  q("animaux", 2, "🦇", "Quel animal dort la tête en bas ?", "La chauve-souris", "Le hibou", "Le perroquet", "Le chat"),
  q("animaux", 2, "🐄", "Comment appelle-t-on le petit de la vache ?", "Le veau", "Le poulain", "L'agneau", "Le chevreau"),
  q("animaux", 2, "🐝", "Où les abeilles fabriquent-elles le miel ?", "Dans la ruche", "Dans un nid", "Dans un terrier", "Dans une grotte"),
  q("animaux", 3, "🐆", "Quel est l'animal le plus rapide sur la terre ferme ?", "Le guépard", "Le lion", "Le cheval", "Le lévrier"),
  q("animaux", 3, "🥚", "Quel mammifère pond des œufs ?", "L'ornithorynque", "Le kangourou", "Le koala", "Le dauphin"),
  q("animaux", 3, "🐬", "Le dauphin est…", "Un mammifère", "Un poisson", "Un reptile", "Un amphibien"),
  q("animaux", 3, "🦘", "Quel animal est le symbole de l'Australie ?", "Le kangourou", "Le panda", "Le lion", "Le bison"),
  q("animaux", 3, "🐦", "Quel petit oiseau sait voler en arrière ?", "Le colibri", "Le moineau", "Le pigeon", "La mouette"),
  q("animaux", 3, "🥗", "Comment appelle-t-on un animal qui ne mange que des plantes ?", "Un herbivore", "Un carnivore", "Un omnivore", "Un insectivore"),

  // Corps humain
  q("corps", 1, "👃", "Avec quoi sent-on les odeurs ?", "Le nez", "Les oreilles", "Les yeux", "La bouche"),
  q("corps", 1, "👂", "Avec quoi entend-on ?", "Les oreilles", "Le nez", "Les mains", "Les pieds"),
  q("corps", 1, "👀", "Avec quoi voit-on ?", "Les yeux", "Les oreilles", "Le nez", "Les mains"),
  q("corps", 1, "🧠", "Où se trouve le cerveau ?", "Dans la tête", "Dans le ventre", "Dans le pied", "Dans la main"),
  q("corps", 2, "🧼", "Que faut-il faire avant de manger ?", "Se laver les mains", "Prendre un bain", "Mettre un pyjama", "Se coiffer"),
  q("corps", 2, "❤️", "Quel organe fait circuler le sang dans tout le corps ?", "Le cœur", "Les poumons", "L'estomac", "Le foie"),
  q("corps", 2, "🌬️", "Avec quoi respire-t-on ?", "Les poumons", "Le cœur", "L'estomac", "Les reins"),
  q("corps", 2, "🦴", "Quel est le plus long os du corps ?", "Le fémur", "Le tibia", "L'humérus", "Le radius"),
  q("corps", 3, "🖐️", "Quel est le plus grand organe du corps humain ?", "La peau", "Le cœur", "Le foie", "Le cerveau"),
  q("corps", 3, "☀️", "Quelle vitamine le soleil aide-t-il notre corps à fabriquer ?", "La vitamine D", "La vitamine A", "La vitamine C", "La vitamine B"),
  q("corps", 3, "🔴", "Quelles cellules transportent l'oxygène dans le sang ?", "Les globules rouges", "Les globules blancs", "Les plaquettes", "Les neurones"),

  // Calendrier et heures
  q("temps", 1, "📅", "Quel jour vient après lundi ?", "Mardi", "Mercredi", "Dimanche", "Jeudi"),
  q("temps", 1, "❄️", "En quelle saison tombe la neige ?", "L'hiver", "L'été", "Le printemps", "L'automne"),
  q("temps", 1, "🍂", "En quelle saison les feuilles tombent-elles des arbres ?", "L'automne", "L'été", "Le printemps", "L'hiver"),
  q("temps", 2, "🎆", "Quel est le premier mois de l'année ?", "Janvier", "Mars", "Décembre", "Septembre"),
  q("temps", 2, "☃️", "Quel est le mois le plus court de l'année ?", "Février", "Avril", "Juin", "Novembre"),
  q("temps", 2, "🎄", "Quel jour fête-t-on Noël ?", "Le 25 décembre", "Le 1er janvier", "Le 14 juillet", "Le 31 octobre"),
  q("temps", 2, "🇫🇷", "Quel jour est la fête nationale française ?", "Le 14 juillet", "Le 1er mai", "Le 25 décembre", "Le 11 novembre"),
  q("temps", 2, "🎃", "Quelle fête célèbre-t-on le 31 octobre ?", "Halloween", "Noël", "Pâques", "La Chandeleur"),
  q("temps", 2, "🥞", "Quelle fête célèbre-t-on avec des crêpes le 2 février ?", "La Chandeleur", "Pâques", "Noël", "Halloween"),
  q("temps", 2, "🥚", "À quelle fête cherche-t-on des œufs en chocolat ?", "Pâques", "Noël", "Halloween", "La Chandeleur"),
  q("temps", 3, "🌞", "En France, en quel mois est le jour le plus long de l'année ?", "Juin", "Décembre", "Mars", "Septembre"),

  // Espace
  q("espace", 1, "🌍", "Sur quelle planète vivons-nous ?", "La Terre", "Mars", "Vénus", "La Lune"),
  q("espace", 1, "🌙", "Qu'est-ce qui brille la nuit dans le ciel et change de forme ?", "La Lune", "Le Soleil", "Un nuage", "Un avion"),
  q("espace", 1, "👨‍🚀", "Que porte un astronaute dans l'espace ?", "Une combinaison", "Un maillot de bain", "Un imperméable", "Un pyjama"),
  q("espace", 2, "☀️", "Quelle est l'étoile la plus proche de la Terre ?", "Le Soleil", "La Lune", "Mars", "L'étoile du Berger"),
  q("espace", 2, "🔴", "Quelle planète est surnommée la planète rouge ?", "Mars", "Vénus", "Jupiter", "Saturne"),
  q("espace", 2, "🔭", "Quelle est la plus grande planète du système solaire ?", "Jupiter", "Saturne", "La Terre", "Neptune"),
  q("espace", 2, "💍", "Quelle planète a de grands anneaux bien visibles ?", "Saturne", "Mars", "Mercure", "Vénus"),
  q("espace", 3, "🌕", "Qui a marché le premier sur la Lune ?", "Neil Armstrong", "Youri Gagarine", "Thomas Pesquet", "Buzz l'Éclair"),
  q("espace", 3, "🚀", "Quel astronaute français est allé deux fois dans la Station spatiale internationale ?", "Thomas Pesquet", "Neil Armstrong", "Jules Verne", "Louis Pasteur"),
  q("espace", 3, "🔥", "Quelle est la planète la plus proche du Soleil ?", "Mercure", "Vénus", "Mars", "La Terre"),
  q("espace", 3, "🌌", "Qu'est-ce que la Voie lactée ?", "Notre galaxie", "Une planète", "Une comète", "Une étoile"),
  q("espace", 3, "☄️", "Qu'est-ce qu'une étoile filante ?", "Un caillou qui brûle", "Une étoile qui tombe", "Un avion", "Une planète"),

  // Sport
  q("sport", 1, "🎾", "Dans quel sport joue-t-on avec une raquette et une balle jaune ?", "Le tennis", "Le football", "Le basket", "Le judo"),
  q("sport", 1, "🏀", "Dans quel sport marque-t-on des paniers ?", "Le basket", "Le tennis", "Le vélo", "La natation"),
  q("sport", 1, "⛷️", "Sur quoi glisse-t-on à la montagne en hiver ?", "Des skis", "Des rollers", "Un vélo", "Une trottinette"),
  q("sport", 1, "⛑️", "Que met-on sur la tête pour faire du vélo sans se blesser ?", "Un casque", "Un bonnet", "Une casquette", "Une couronne"),
  q("sport", 2, "🚴", "Quel est le sport du Tour de France ?", "Le cyclisme", "La course à pied", "La natation", "Le ski"),
  q("sport", 2, "🥋", "Dans quel sport porte-t-on un kimono et une ceinture de couleur ?", "Le judo", "Le tennis", "Le rugby", "Le golf"),
  q("sport", 2, "🏉", "Dans quel sport marque-t-on des essais avec un ballon ovale ?", "Le rugby", "Le football", "Le volley", "Le hockey"),
  q("sport", 2, "🥇", "Quelle médaille reçoit le gagnant aux Jeux olympiques ?", "L'or", "L'argent", "Le bronze", "Le cuivre"),
  q("sport", 2, "🥅", "Au football, qui arrête les tirs devant le but ?", "Le gardien de but", "L'attaquant", "L'arbitre", "Le défenseur"),
  q("sport", 3, "🏆", "Quel pays a gagné la Coupe du monde de football en 2018 ?", "La France", "Le Brésil", "L'Allemagne", "L'Argentine"),
  q("sport", 3, "⚽", "Quel pays a gagné la Coupe du monde de football en 2022 ?", "L'Argentine", "La France", "Le Brésil", "Le Maroc"),
  q("sport", 3, "🎾", "Dans quelle ville se joue le tournoi de tennis de Roland-Garros ?", "Paris", "Lyon", "Londres", "Madrid"),
  q("sport", 3, "🏊", "Quel nageur français a gagné 4 médailles d'or aux Jeux olympiques de Paris en 2024 ?", "Léon Marchand", "Florent Manaudou", "Teddy Riner", "Antoine Dupont"),

  // Jeux et nombres
  q("jeux", 1, "🎨", "Quelle couleur obtient-on en mélangeant du bleu et du jaune ?", "Le vert", "Le violet", "L'orange", "Le rose"),
  q("jeux", 1, "⭕", "Quelle forme a une roue ?", "Un rond", "Un carré", "Un triangle", "Une étoile"),
  q("jeux", 1, "📏", "Quel est le contraire de « grand » ?", "Petit", "Gros", "Long", "Haut"),
  q("jeux", 1, "🔤", "Quelle lettre vient juste après A dans l'alphabet ?", "B", "C", "Z", "E"),
  q("jeux", 1, "🎩", "Que sort souvent un magicien de son chapeau ?", "Un lapin", "Un éléphant", "Une voiture", "Un gâteau"),
  q("jeux", 1, "💯", "Quel nombre vient juste après 99 ?", "100", "98", "101", "1 000"),
  q("jeux", 2, "🍊", "Quelle couleur obtient-on en mélangeant du rouge et du jaune ?", "L'orange", "Le vert", "Le violet", "Le marron"),
  q("jeux", 2, "🍇", "Quelle couleur obtient-on en mélangeant du rouge et du bleu ?", "Le violet", "Le vert", "L'orange", "Le jaune"),
  q("jeux", 2, "✋", "À « pierre, feuille, ciseaux », qu'est-ce qui bat la pierre ?", "La feuille", "Les ciseaux", "Le caillou", "Rien"),
  q("jeux", 2, "✌️", "À « pierre, feuille, ciseaux », qu'est-ce qui bat la feuille ?", "Les ciseaux", "La pierre", "Le papier", "Rien"),
  q("jeux", 3, "♟️", "Aux échecs, quelle pièce faut-il mettre « échec et mat » pour gagner ?", "Le roi", "La reine", "Le fou", "La tour"),
  q("jeux", 3, "🐝", "Comment s'appelle une forme à 6 côtés, comme les alvéoles des abeilles ?", "Un hexagone", "Un pentagone", "Un octogone", "Un losange"),

  // Musique
  q("musique", 1, "🎹", "Quel instrument a des touches noires et blanches ?", "Le piano", "La guitare", "Le tambour", "La flûte"),
  q("musique", 1, "🥁", "Sur quel instrument tape-t-on avec des baguettes ?", "Le tambour", "La flûte", "Le violon", "Le piano"),
  q("musique", 1, "🎂", "Quelle chanson chante-t-on pour un anniversaire ?", "Joyeux anniversaire", "Frère Jacques", "Au clair de la lune", "Vive le vent"),
  q("musique", 2, "🎺", "Dans quel instrument souffle-t-on ?", "La trompette", "Le violon", "Le piano", "La batterie"),
  q("musique", 2, "🎻", "Quel instrument à cordes se joue avec un archet ?", "Le violon", "La guitare", "La harpe", "Le piano"),
  q("musique", 2, "❄️", "Qui chante « Libérée, délivrée » dans « La Reine des neiges » ?", "Elsa", "Anna", "Olaf", "Kristoff"),
  q("musique", 2, "🎤", "Comment s'appelle un groupe de personnes qui chantent ensemble ?", "Une chorale", "Un orchestre", "Une fanfare", "Un duo"),
  q("musique", 3, "🎼", "Comment s'appelle la personne qui dirige un orchestre ?", "Le chef d'orchestre", "Le batteur", "Le chanteur", "Le pianiste"),
  q("musique", 3, "🎶", "Quel compositeur a écrit « La Petite Musique de nuit » ?", "Mozart", "Beethoven", "Bach", "Chopin"),
  q("musique", 3, "👂", "Quel compositeur, devenu sourd, a écrit « La Lettre à Élise » ?", "Beethoven", "Mozart", "Bach", "Chopin"),

  // Contes, livres et dessins animés
  q("contes", 1, "👠", "Qui perd sa pantoufle de verre en quittant le bal ?", "Cendrillon", "Blanche-Neige", "Raiponce", "Ariel"),
  q("contes", 1, "🍎", "Qui croque la pomme empoisonnée ?", "Blanche-Neige", "Cendrillon", "Belle", "Alice"),
  q("contes", 1, "🤥", "Qui a un nez qui grandit quand il ment ?", "Pinocchio", "Peter Pan", "Aladdin", "Mowgli"),
  q("contes", 1, "🐠", "Comment s'appelle le petit poisson-clown perdu de Disney et Pixar ?", "Nemo", "Dory", "Flipper", "Bubulle"),
  q("contes", 1, "⛄", "Comment s'appelle le bonhomme de neige de « La Reine des neiges » ?", "Olaf", "Sven", "Hans", "Kristoff"),
  q("contes", 1, "🚀", "Quel jouet est le meilleur ami de Woody dans « Toy Story » ?", "Buzz l'Éclair", "Shrek", "Nemo", "Olaf"),
  q("contes", 1, "💚", "De quelle couleur est Shrek ?", "Vert", "Bleu", "Rouge", "Jaune"),
  q("contes", 2, "🦁", "Comment s'appelle le lionceau qui deviendra roi dans « Le Roi lion » ?", "Simba", "Nala", "Scar", "Mufasa"),
  q("contes", 2, "🐻", "Quel ours est l'ami de Mowgli dans « Le Livre de la jungle » ?", "Baloo", "Winnie", "Paddington", "Petit Ours Brun"),
  q("contes", 2, "🍍", "Quel personnage vit dans un ananas au fond de la mer ?", "Bob l'éponge", "Nemo", "Ariel", "Sébastien"),
  q("contes", 2, "🧚", "Comment s'appelle la petite fée de Peter Pan ?", "La fée Clochette", "La fée Marraine", "La fée Dragée", "La fée Morgane"),
  q("contes", 2, "🐶", "Comment s'appelle le chien de Tintin ?", "Milou", "Idéfix", "Pluto", "Scooby-Doo"),
  q("contes", 2, "🧪", "Qu'est-ce qui rend Astérix si fort ?", "La potion magique", "Les épinards", "Le miel", "Le chocolat"),
  q("contes", 2, "🥬", "Qui mange des épinards pour devenir très fort ?", "Popeye", "Obélix", "Hulk", "Superman"),
  q("contes", 2, "👸", "Quelle princesse a de très longs cheveux et vit dans une tour ?", "Raiponce", "Jasmine", "Mulan", "Belle"),
  q("contes", 2, "🕷️", "Quel super-héros a été piqué par une araignée ?", "Spider-Man", "Batman", "Superman", "Iron Man"),
  q("contes", 2, "🍄", "Quel héros de jeu vidéo est un plombier moustachu ?", "Mario", "Sonic", "Pikachu", "Link"),
  q("contes", 2, "⚡", "Quel Pokémon jaune est le compagnon de Sacha ?", "Pikachu", "Salamèche", "Bulbizarre", "Carapuce"),
  q("contes", 3, "🌹", "Qui a écrit « Le Petit Prince » ?", "Antoine de Saint-Exupéry", "Victor Hugo", "Jules Verne", "Charles Perrault"),
  q("contes", 3, "📖", "Qui a écrit « Les Misérables » ?", "Victor Hugo", "Molière", "Émile Zola", "Alexandre Dumas"),
  q("contes", 3, "📚", "Qui a écrit les contes « Le Petit Chaperon rouge » et « Cendrillon » ?", "Charles Perrault", "Victor Hugo", "Jean de La Fontaine", "Molière"),
  q("contes", 3, "🦊", "Qui a écrit la fable « Le Corbeau et le Renard » ?", "Jean de La Fontaine", "Molière", "Charles Perrault", "Victor Hugo"),
  q("contes", 3, "🦉", "Dans quelle école Harry Potter apprend-il la magie ?", "Poudlard", "Beauxbâtons", "Durmstrang", "Gotham"),

  // Monde et nature
  q("monde", 1, "☀️", "De quelle couleur est le ciel quand il fait beau ?", "Bleu", "Vert", "Rouge", "Violet"),
  q("monde", 1, "🌧️", "Qu'est-ce qui tombe du ciel quand il pleut ?", "De l'eau", "Du sable", "Du lait", "Des feuilles"),
  q("monde", 1, "☁️", "D'où vient la pluie ?", "Des nuages", "Du Soleil", "De la Lune", "Des arbres"),
  q("monde", 1, "🌱", "Que boit une plante pour grandir ?", "De l'eau", "Du lait", "Du jus d'orange", "Du sirop"),
  q("monde", 1, "❄️", "Que devient l'eau quand elle gèle ?", "De la glace", "De la vapeur", "Du sable", "Du lait"),
  q("monde", 2, "🎄", "Quel arbre décore-t-on à Noël ?", "Le sapin", "Le chêne", "Le pommier", "Le palmier"),
  q("monde", 2, "🌋", "Comment appelle-t-on une montagne qui crache de la lave ?", "Un volcan", "Un glacier", "Une colline", "Une falaise"),
  q("monde", 2, "🏔️", "Quelle est la plus haute montagne de France ?", "Le mont Blanc", "Le puy de Dôme", "Le mont Ventoux", "Le Canigou"),
  q("monde", 3, "🗻", "Quelle est la plus haute montagne du monde ?", "L'Everest", "Le mont Blanc", "Le Kilimandjaro", "L'Aconcagua"),
  q("monde", 3, "🌊", "Quel est le plus grand océan du monde ?", "L'océan Pacifique", "L'océan Atlantique", "L'océan Indien", "L'océan Arctique"),
  q("monde", 3, "🏞️", "Quel est le plus long fleuve de France ?", "La Loire", "La Seine", "Le Rhône", "La Garonne"),
  q("monde", 3, "🏜️", "Quel est le plus grand désert chaud du monde ?", "Le Sahara", "Le Gobi", "L'Atacama", "Le Kalahari"),
  q("monde", 3, "🌳", "Quel gaz les plantes rejettent-elles grâce à la lumière du soleil ?", "L'oxygène", "Le gaz carbonique", "L'hélium", "L'azote"),

  // Cuisine et aliments
  q("cuisine", 1, "🥕", "Quel légume orange les lapins adorent-ils ?", "La carotte", "Le poireau", "La tomate", "Le radis"),
  q("cuisine", 1, "🍟", "Avec quoi fait-on les frites ?", "Des pommes de terre", "Des carottes", "Des pommes", "Des bananes"),
  q("cuisine", 1, "🥛", "Quel animal donne le lait qu'on boit le plus souvent ?", "La vache", "Le cochon", "Le cheval", "La poule"),
  q("cuisine", 1, "🍓", "Quel fruit rouge a de petits grains sur sa peau ?", "La fraise", "La cerise", "La pomme", "La tomate"),
  q("cuisine", 1, "🍳", "Que pond la poule ?", "Des œufs", "Du lait", "Du miel", "Du fromage"),
  q("cuisine", 2, "🍫", "Avec quoi fait-on le chocolat ?", "Le cacao", "Le café", "La vanille", "La noisette"),
  q("cuisine", 2, "🍌", "Quel fruit jaune faut-il éplucher avant de le manger ?", "La banane", "La fraise", "La cerise", "Le raisin"),
  q("cuisine", 2, "🍏", "Avec quel fruit fait-on le cidre ?", "La pomme", "La poire", "Le raisin", "La cerise"),
  q("cuisine", 2, "🍕", "De quel pays vient la pizza ?", "L'Italie", "La France", "Le Japon", "Le Mexique"),
  q("cuisine", 2, "🍣", "De quel pays viennent les sushis ?", "Le Japon", "La Chine", "L'Inde", "L'Espagne"),
  q("cuisine", 2, "🥐", "Quelle viennoiserie a la forme d'une lune ?", "Le croissant", "Le pain au chocolat", "La brioche", "Le chausson aux pommes"),
  q("cuisine", 2, "😢", "Quel légume fait pleurer quand on le coupe ?", "L'oignon", "La carotte", "La courgette", "Le concombre"),
  q("cuisine", 3, "🧀", "Quel fromage rond vient de Normandie ?", "Le camembert", "Le roquefort", "Le comté", "La mozzarella"),

  // Pays et villes
  q("pays", 1, "🗼", "Quelle est la capitale de la France ?", "Paris", "Lyon", "Marseille", "Bordeaux"),
  q("pays", 2, "🇮🇹", "Quelle est la capitale de l'Italie ?", "Rome", "Milan", "Venise", "Naples"),
  q("pays", 2, "🇪🇸", "Quelle est la capitale de l'Espagne ?", "Madrid", "Barcelone", "Séville", "Valence"),
  q("pays", 2, "💂", "Quelle est la capitale de l'Angleterre ?", "Londres", "Manchester", "Liverpool", "Dublin"),
  q("pays", 2, "🐫", "Dans quel pays se trouvent les grandes pyramides de Gizeh ?", "L'Égypte", "Le Mexique", "La Grèce", "L'Inde"),
  q("pays", 2, "🇨🇳", "Dans quel pays se trouve la Grande Muraille ?", "La Chine", "Le Japon", "L'Inde", "La Russie"),
  q("pays", 2, "👢", "Quel pays a la forme d'une botte ?", "L'Italie", "L'Espagne", "La France", "La Grèce"),
  q("pays", 2, "💶", "Quelle monnaie utilise-t-on en France ?", "L'euro", "Le franc", "Le dollar", "La livre"),
  q("pays", 2, "🌉", "Quel fleuve traverse Paris ?", "La Seine", "La Loire", "Le Rhône", "La Garonne"),
  q("pays", 3, "🇩🇪", "Quelle est la capitale de l'Allemagne ?", "Berlin", "Munich", "Francfort", "Vienne"),
  q("pays", 3, "🇯🇵", "Quelle est la capitale du Japon ?", "Tokyo", "Kyoto", "Pékin", "Séoul"),
  q("pays", 3, "🇺🇸", "Quelle est la capitale des États-Unis ?", "Washington", "New York", "Los Angeles", "Chicago"),
  q("pays", 3, "🗽", "Dans quelle ville se trouve la statue de la Liberté ?", "New York", "Washington", "Paris", "Londres"),
  q("pays", 3, "🇧🇷", "Quelle langue parle-t-on au Brésil ?", "Le portugais", "L'espagnol", "Le brésilien", "L'anglais"),
  q("pays", 3, "🇫🇷", "Quel surnom donne-t-on à la France, à cause de sa forme ?", "L'Hexagone", "Le Losange", "Le Triangle", "Le Carré"),

  // Histoire et inventions
  q("histoire", 2, "🦖", "Quels animaux géants ont disparu il y a des millions d'années ?", "Les dinosaures", "Les éléphants", "Les baleines", "Les girafes"),
  q("histoire", 3, "👑", "Qui fut le premier empereur des Français ?", "Napoléon Ier", "Louis XIV", "Charlemagne", "Jules César"),
  q("histoire", 3, "🌞", "Quel roi de France était surnommé le Roi-Soleil ?", "Louis XIV", "Louis XVI", "Henri IV", "François Ier"),
  q("histoire", 3, "🏰", "Quel château Louis XIV a-t-il fait agrandir pour y vivre avec sa cour ?", "Versailles", "Chambord", "Chenonceau", "Fontainebleau"),
  q("histoire", 3, "⚔️", "Qui est surnommée « la Pucelle d'Orléans » ?", "Jeanne d'Arc", "Marie Curie", "Marie-Antoinette", "Joséphine"),
  q("histoire", 3, "🔬", "Quelle savante a reçu deux prix Nobel ?", "Marie Curie", "Simone Veil", "Jeanne d'Arc", "Coco Chanel"),
  q("histoire", 3, "💉", "Qui a trouvé le vaccin contre la rage ?", "Louis Pasteur", "Marie Curie", "Napoléon", "Victor Hugo"),
];

/**
 * Tout le quiz classique tout prêt, thème par thème : les questions à 4 réponses, puis les Juste Chiffre du même thème.
 * Une question sans [choices] est un Juste Chiffre.
 */
const ORDRE_THEMES = Object.keys(THEMES_TOUT_PRETS);
export const QUESTIONS_TOUT_PRETES = [...QUESTIONS_CLASSIQUES, ...QUESTIONS_CHIFFRES]
  .sort((a, b) => ORDRE_THEMES.indexOf(a.theme) - ORDRE_THEMES.indexOf(b.theme));
export const estJusteChiffre = (x) => !x.choices?.length;
