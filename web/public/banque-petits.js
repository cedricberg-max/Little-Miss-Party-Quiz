/**
 * Banque des tout-petits (enfants qui ne savent pas encore lire) : des mots concrets, chacun avec une vraie photo
 * (web/public/banque/<clé>.jpg, photos du domaine public) et son émoji en secours, et des questions toutes prêtes
 * dont les 4 réponses sont des mots de la banque. Une même photo sert à plusieurs questions.
 * Sarah pioche les questions (une par une ou « 10 au hasard ») dans l'édition d'un quiz, relit et enregistre.
 * Les questions sont écrites bonne réponse en premier ; l'ordre est mélangé quand Sarah les ajoute.
 */

/**
 * Mots de la banque, par famille : « Mot | article | émoji de secours | recherche de sa photo (en anglais) | étiquettes ».
 * Les étiquettes servent aux questions fabriquées : vole, eau, plumes, 4pattes, insecte, ferme, sauvage, geant, petit,
 * fruit, legume, sucre, sale, boisson, froid, chaud, roues, flotte, cuisine, toilette, chambre, ecole, jardin, pieds,
 * tete, hiver, ete, ciel, souffle, cordes, tape, fete, jouets, les couleurs (rouge, jaune, vert, blanc, orange, rose,
 * bleu). « x-vole » : le mot n'est ni une bonne ni une mauvaise réponse à « Lequel peut voler ? » (cas discutable).
 * « g-… » : mots qui se ressemblent trop (sur la photo ou dans la tête d'un enfant), jamais dans la même question.
 */
const MOTS = {
  animaux: `
    Chat|le|🐱|cat|4pattes
    Chien|le|🐶|dog|4pattes g-chien
    Vache|la|🐄|cow|ferme 4pattes
    Cochon|le|🐷|pig|ferme 4pattes rose g-cochon
    Mouton|le|🐑|sheep|ferme 4pattes blanc g-mouton
    Cheval|le|🐴|horse|ferme 4pattes g-cheval
    Poule|la|🐔|hen chicken|ferme plumes x-vole g-oiseau
    Coq|le|🐓|rooster|ferme plumes x-vole g-oiseau
    Canard|le|🦆|duck|ferme plumes x-vole x-eau g-oiseau
    Lapin|le|🐰|rabbit|ferme 4pattes
    Souris|la|🐭|mouse animal|4pattes petit
    Chèvre|la|🐐|goat|ferme 4pattes g-mouton
    Âne|l'|🐴|donkey|ferme 4pattes g-cheval
    Dinde|la|🦃|turkey bird|ferme plumes x-vole g-oiseau
    Poussin|le|🐤|chick baby chicken|ferme plumes x-vole petit jaune g-oiseau
    Oie|l'|🦢|goose|ferme plumes x-vole x-eau g-oiseau
    Lama|le|🦙|llama|4pattes g-mouton
    Lion|le|🦁|lion|sauvage 4pattes
    Tigre|le|🐯|tiger|sauvage 4pattes
    Éléphant|l'|🐘|elephant|sauvage 4pattes geant
    Girafe|la|🦒|giraffe|sauvage 4pattes geant
    Singe|le|🐒|monkey|sauvage x-4pattes g-singe
    Gorille|le|🦍|gorilla|sauvage x-4pattes geant g-singe
    Zèbre|le|🦓|zebra|sauvage 4pattes g-cheval
    Ours|l'|🐻|brown bear|sauvage 4pattes g-ours
    Ours blanc|l'|🐻|polar bear|sauvage 4pattes blanc g-ours
    Panda|le|🐼|giant panda|sauvage 4pattes g-ours
    Koala|le|🐨|koala|sauvage x-4pattes
    Crocodile|le|🐊|crocodile|sauvage 4pattes x-eau g-crocodile
    Lézard|le|🦎|lizard|sauvage 4pattes petit g-crocodile
    Serpent|le|🐍|snake|sauvage
    Grenouille|la|🐸|frog|4pattes x-eau vert
    Tortue|la|🐢|tortoise|4pattes g-tortue
    Renard|le|🦊|fox|sauvage 4pattes
    Loup|le|🐺|wolf|sauvage 4pattes g-chien
    Cerf|le|🦌|deer stag|sauvage 4pattes
    Écureuil|l'|🐿️|squirrel|sauvage 4pattes
    Hérisson|le|🦔|hedgehog|sauvage 4pattes petit
    Sanglier|le|🐗|wild boar|sauvage 4pattes g-cochon
    Castor|le|🦫|beaver|sauvage 4pattes x-eau
    Kangourou|le|🦘|kangaroo|sauvage x-4pattes
    Chameau|le|🐫|camel|4pattes
    Hippopotame|l'|🦛|hippopotamus|sauvage 4pattes geant x-eau
    Rhinocéros|le|🦏|rhinoceros|sauvage 4pattes geant
    Phoque|le|🦭|seal animal|sauvage x-eau x-4pattes
    Manchot|le|🐧|penguin|sauvage plumes x-eau g-oiseau
    Oiseau|l'|🐦|bird|plumes vole g-oiseau
    Hibou|le|🦉|owl|sauvage plumes vole g-oiseau
    Aigle|l'|🦅|eagle|sauvage plumes vole g-oiseau
    Perroquet|le|🦜|parrot|sauvage plumes vole g-oiseau
    Pigeon|le|🐦|pigeon|plumes vole g-oiseau
    Cygne|le|🦢|swan|plumes vole x-eau blanc g-oiseau
    Flamant rose|le|🦩|flamingo|sauvage plumes vole x-eau rose g-oiseau
    Paon|le|🦚|peacock|plumes x-vole g-oiseau
    Autruche|l'|🐦|ostrich|sauvage plumes g-oiseau
    Chauve-souris|la|🦇|bat animal|sauvage vole
    Escargot|l'|🐌|snail|petit
    Papillon|le|🦋|butterfly|insecte vole petit
    Abeille|l'|🐝|honey bee|insecte vole petit
    Coccinelle|la|🐞|ladybug|insecte vole petit rouge
    Mouche|la|🪰|housefly|insecte vole petit g-mouche
    Moustique|le|🦟|mosquito|insecte vole petit g-mouche
    Libellule|la|🦋|dragonfly|insecte vole petit
    Fourmi|la|🐜|ant|insecte x-vole petit
    Sauterelle|la|🦗|grasshopper|insecte x-vole petit
    Chenille|la|🐛|caterpillar|x-insecte petit
    Araignée|l'|🕷️|spider|petit
    Ver de terre|le|🪱|earthworm|petit
    Poisson|le|🐟|fish|eau g-poisson
    Poisson-clown|le|🐠|clownfish|eau orange g-poisson
    Requin|le|🦈|shark|eau geant g-poisson g-baleine
    Baleine|la|🐋|whale|eau geant g-baleine
    Dauphin|le|🐬|dolphin|eau g-baleine
    Pieuvre|la|🐙|octopus|eau
    Méduse|la|🌊|jellyfish|eau
    Étoile de mer|l'|⭐|starfish|eau
    Hippocampe|l'|🐠|seahorse|eau g-poisson
    Crabe|le|🦀|crab|eau g-crevette
    Homard|le|🦞|lobster|eau g-crevette
    Crevette|la|🦐|shrimp|eau g-crevette
    Tortue de mer|la|🐢|sea turtle|eau x-4pattes g-tortue
  `,
  manger: `
    Pomme|la|🍎|red apple|fruit rouge
    Banane|la|🍌|banana|fruit jaune
    Fraise|la|🍓|strawberry|fruit rouge
    Orange|l'|🍊|orange fruit|fruit orange g-orange
    Raisin|le|🍇|grapes|fruit g-raisin
    Cerise|la|🍒|cherries|fruit rouge
    Ananas|l'|🍍|pineapple|fruit
    Pastèque|la|🍉|watermelon|fruit g-melon
    Melon|le|🍈|cantaloupe melon|fruit g-melon
    Citron|le|🍋|lemon|fruit jaune
    Poire|la|🍐|pear|fruit
    Kiwi|le|🥝|kiwi fruit|fruit
    Pêche|la|🍑|peach fruit|fruit g-peche
    Abricot|l'|🍑|apricot|fruit g-peche
    Mangue|la|🥭|mango|fruit g-peche
    Prune|la|🍑|plum fruit|fruit g-raisin
    Myrtilles|les|🫐|blueberries|fruit bleu g-raisin
    Framboise|la|🍓|raspberry|fruit rouge g-framboise
    Mûre|la|🫐|blackberry fruit|fruit g-framboise
    Noix de coco|la|🥥|coconut|fruit
    Figue|la|🍑|fig fruit|fruit
    Carotte|la|🥕|carrot|legume orange
    Tomate|la|🍅|tomato|legume x-fruit rouge g-poivron
    Poivron|le|🫑|bell pepper|legume x-fruit g-poivron
    Brocoli|le|🥦|broccoli|legume vert g-chou
    Chou-fleur|le|🥦|cauliflower|legume blanc g-chou
    Maïs|le|🌽|corn cob|legume x-fruit jaune
    Champignon|le|🍄|mushroom|x-legume x-fruit
    Pomme de terre|la|🥔|potato|legume
    Salade|la|🥬|lettuce|legume vert
    Petits pois|les|🟢|green peas|legume vert g-haricot
    Haricots verts|les|🥒|green beans|legume vert g-haricot
    Concombre|le|🥒|cucumber|legume x-fruit vert g-courgette
    Courgette|la|🥒|zucchini|legume x-fruit vert g-courgette
    Citrouille|la|🎃|pumpkin|legume x-fruit orange
    Aubergine|l'|🍆|eggplant|legume x-fruit
    Oignon|l'|🧅|onion|legume g-oignon
    Ail|l'|🧄|garlic|legume g-oignon
    Radis|le|🥕|radish|legume
    Poireau|le|🥬|leek|legume
    Pain|le|🍞|bread loaf|sale g-pain
    Fromage|le|🧀|cheese|sale g-beurre
    Beurre|le|🧈|butter|g-beurre
    Œuf|l'|🥚|egg|
    Lait|le|🥛|glass of milk|boisson x-manger blanc g-lait
    Yaourt|le|🥛|yogurt|x-boisson g-lait
    Eau|l'|💧|glass of water|boisson x-manger
    Jus d'orange|le|🧃|orange juice glass|boisson x-manger orange g-orange
    Gâteau|le|🎂|birthday cake|sucre fete
    Glace|la|🍦|ice cream cone|sucre froid
    Pizza|la|🍕|pizza|sale chaud
    Bonbon|le|🍬|candy|sucre g-bonbon
    Sucette|la|🍭|lollipop|sucre g-bonbon
    Chocolat|le|🍫|chocolate bar|sucre
    Miel|le|🍯|honey jar|sucre g-pot
    Confiture|la|🍓|jam jar|sucre g-pot
    Croissant|le|🥐|croissant|
    Frites|les|🍟|french fries|sale chaud g-frites
    Chips|les|🥔|potato chips|sale g-frites
    Pâtes|les|🍝|pasta|sale
    Riz|le|🍚|rice bowl|sale blanc
    Soupe|la|🍲|soup bowl|sale chaud x-boisson g-bol
    Céréales|les|🥣|breakfast cereal bowl|g-bol
    Crêpe|la|🥞|crepe|sucre
    Gaufre|la|🧇|waffle|sucre
    Biscuit|le|🍪|cookie|sucre
    Beignet|le|🍩|donut|sucre
    Barbe à papa|la|🍭|cotton candy|sucre rose
    Sandwich|le|🥪|sandwich|sale g-pain
    Hamburger|le|🍔|hamburger|sale g-pain
    Saucisse|la|🌭|sausage|sale
    Jambon|le|🥓|ham|sale rose
    Pop-corn|le|🍿|popcorn|
  `,
  transports: `
    Voiture|la|🚗|car|roues g-voiture
    Taxi|le|🚕|taxi car|roues g-voiture
    Voiture de police|la|🚓|police car|roues g-voiture
    Ambulance|l'|🚑|ambulance|roues g-voiture
    Camping-car|le|🚐|camper van|roues g-voiture
    Bus|le|🚌|bus|roues
    Vélo|le|🚲|bicycle|roues
    Moto|la|🏍️|motorcycle|roues
    Trottinette|la|🛴|kick scooter|roues
    Skateboard|le|🛹|skateboard|roues
    Poussette|la|👶|baby stroller|roues
    Train|le|🚂|train|roues g-train
    Métro|le|🚇|subway train|roues g-train
    Camion|le|🚚|truck|roues g-camion
    Camion de pompiers|le|🚒|fire truck|roues rouge g-camion
    Tracteur|le|🚜|tractor|roues
    Pelleteuse|la|🚜|excavator|x-roues g-camion
    Avion|l'|✈️|airplane|vole x-roues
    Hélicoptère|l'|🚁|helicopter|vole x-roues
    Fusée|la|🚀|rocket launch|vole
    Montgolfière|la|🎈|hot air balloon|vole
    Bateau|le|⛵|sailboat|flotte g-bateau
    Paquebot|le|🛳️|cruise ship|flotte g-bateau
    Canoë|le|🛶|canoe|flotte g-bateau
    Sous-marin|le|🚢|submarine|x-flotte g-bateau
  `,
  maison: `
    Maison|la|🏠|house|
    Lit|le|🛏️|bed|chambre g-lit
    Oreiller|l'|🛏️|pillow|chambre g-lit
    Chaise|la|🪑|chair|
    Table|la|🪑|table furniture|
    Canapé|le|🛋️|sofa|
    Porte|la|🚪|door|
    Fenêtre|la|🪟|window|
    Lampe|la|💡|lamp|chambre g-lampe
    Clé|la|🔑|key|
    Téléphone|le|📱|telephone|
    Ordinateur|l'|💻|laptop computer|
    Télévision|la|📺|television|
    Appareil photo|l'|📷|camera|
    Horloge|l'|⏰|clock|
    Parapluie|le|☂️|umbrella|
    Bougie|la|🕯️|candle|chaud fete g-lampe
    Cadeau|le|🎁|gift box|fete
    Ballon de fête|le|🎈|balloons|fete jouets g-ballon
    Ballon|le|⚽|soccer ball|jouets g-ballon
    Cerf-volant|le|🪁|kite|jouets
    Ours en peluche|l'|🧸|teddy bear|jouets chambre
    Livre|le|📖|book|ecole
    Cartable|le|🎒|school bag|ecole
    Crayon|le|✏️|pencil|ecole g-crayon
    Stylo|le|🖊️|pen|ecole g-crayon
    Feutres|les|🖍️|felt pens markers|ecole g-crayon
    Pinceau|le|🖌️|paintbrush|ecole g-crayon
    Gomme|la|🧽|eraser|ecole
    Règle|la|📏|ruler|ecole
    Colle|la|🧴|glue stick|ecole
    Cahier|le|📓|notebook|ecole
    Ciseaux|les|✂️|scissors|ecole
    Trousse|la|👝|pencil case|ecole
    Cuillère|la|🥄|spoon|cuisine
    Fourchette|la|🍴|fork|cuisine
    Assiette|l'|🍽️|plate dish|cuisine
    Tasse|la|☕|cup|cuisine g-tasse
    Verre|le|🥛|drinking glass|cuisine g-tasse
    Bol|le|🥣|bowl|cuisine g-tasse
    Casserole|la|🍳|saucepan|cuisine g-casserole
    Poêle|la|🍳|frying pan|cuisine g-casserole
    Réfrigérateur|le|🧊|refrigerator|cuisine
    Four|le|🔥|kitchen oven|cuisine
    Brosse à dents|la|🪥|toothbrush|toilette g-brosse
    Dentifrice|le|🪥|toothpaste|toilette g-brosse
    Peigne|le|💇|comb|toilette g-brosse
    Savon|le|🧼|soap|toilette
    Serviette|la|🧻|bath towel|toilette
    Baignoire|la|🛁|bathtub|toilette g-baignoire
    Douche|la|🚿|shower|toilette g-baignoire
    Miroir|le|🪞|mirror|toilette
    Balai|le|🧹|broom|
    Aspirateur|l'|🧹|vacuum cleaner|
    Machine à laver|la|🧺|washing machine|
    Poubelle|la|🗑️|trash bin|
    Panier|le|🧺|basket|
    Boîte aux lettres|la|📫|mailbox|
    Robinet|le|🚰|water tap faucet|
    Seau|le|🪣|bucket|x-jardin
  `,
  vetements: `
    Chaussure|la|👟|sneaker shoe|pieds g-chaussure
    Bottes|les|👢|rain boots|pieds g-chaussure
    Sandales|les|👡|sandals|pieds ete g-chaussure
    Pantoufles|les|🥿|slippers|pieds g-chaussure
    Chaussette|la|🧦|socks|pieds
    Casquette|la|🧢|cap hat|tete ete g-chapeau
    Chapeau|le|👒|sun hat|tete ete g-chapeau
    Bonnet|le|🧣|wool beanie hat|tete hiver g-chapeau
    Couronne|la|👑|crown|tete x-vetements
    Pantalon|le|👖|jeans|g-pantalon
    Short|le|🩳|shorts|ete g-pantalon
    Pyjama|le|🛌|pajamas|g-pantalon
    Robe|la|👗|dress|g-robe
    Jupe|la|👗|skirt|g-robe
    T-shirt|le|👕|t-shirt|ete g-tshirt
    Pull|le|🧶|sweater|hiver g-tshirt
    Manteau|le|🧥|winter coat|hiver
    Écharpe|l'|🧣|scarf|hiver
    Gants|les|🧤|gloves|hiver
    Maillot de bain|le|🩱|swimsuit|ete
    Cravate|la|👔|necktie|x-vetements
    Ceinture|la|👖|belt|x-vetements
    Lunettes|les|👓|glasses|x-vetements g-lunettes
    Lunettes de soleil|les|🕶️|sunglasses|ete x-vetements g-lunettes
    Sac à main|le|👜|handbag|x-vetements
    Montre|la|⌚|wristwatch|x-vetements
    Collier|le|📿|necklace|x-vetements
  `,
  corps: `
    Main|la|✋|hand|
    Pied|le|🦶|foot|
    Œil|l'|👁️|eye|
    Nez|le|👃|nose|
    Bouche|la|👄|mouth lips|g-bouche
    Dents|les|🦷|teeth smile|g-bouche
    Langue|la|👅|tongue|g-bouche
    Oreille|l'|👂|ear|
    Cheveux|les|💇|hair|
  `,
  nature: `
    Soleil|le|☀️|sun|ciel chaud jaune
    Lune|la|🌙|moon|ciel
    Étoile|l'|⭐|star sky|ciel
    Nuage|le|☁️|cloud|ciel blanc g-nuage
    Pluie|la|🌧️|rain|x-ciel g-nuage
    Éclair|l'|⚡|lightning|ciel g-nuage
    Arc-en-ciel|l'|🌈|rainbow|ciel
    Neige|la|❄️|snow|froid blanc g-neige
    Bonhomme de neige|le|⛄|snowman|froid blanc g-neige
    Glaçon|le|🧊|ice cubes|froid
    Feu|le|🔥|fire|chaud
    Volcan|le|🌋|volcano|chaud g-montagne
    Montagne|la|⛰️|mountain|g-montagne
    Arbre|l'|🌳|tree|g-arbre
    Sapin|le|🌲|fir tree|vert g-arbre
    Forêt|la|🌲|forest|g-arbre
    Fleur|la|🌸|flower|g-fleur
    Rose|la|🌹|red rose flower|rouge x-rose g-fleur
    Tournesol|le|🌻|sunflower|jaune g-fleur
    Cactus|le|🌵|cactus|vert
    Herbe|l'|🌿|green grass|vert
    Feuille|la|🍁|autumn leaf|
    Pomme de pin|la|🌰|pine cone|
    Mer|la|🌊|sea|bleu g-mer
    Plage|la|🏖️|beach|g-mer g-sable
    Île|l'|🏝️|island|g-mer
    Sable|le|⏳|sand|g-sable
    Désert|le|🏜️|desert|g-sable
    Rivière|la|🏞️|river|g-riviere
    Cascade|la|💦|waterfall|g-riviere
    Caillou|le|🪨|pebble stone|
    Coquillage|le|🐚|seashell|
    Plume|la|🪶|feather|
    Nid|le|🪺|bird nest|
    Toile d'araignée|la|🕸️|spider web|
  `,
  musique: `
    Guitare|la|🎸|guitar|cordes
    Violon|le|🎻|violin|cordes
    Harpe|la|🎼|harp|cordes
    Piano|le|🎹|piano|
    Tambour|le|🥁|drum|tape g-tambour
    Tambourin|le|🥁|tambourine|tape g-tambour
    Xylophone|le|🎶|xylophone|tape
    Triangle|le|🔺|triangle instrument|tape
    Maracas|les|🎶|maracas|
    Trompette|la|🎺|trumpet|souffle
    Saxophone|le|🎷|saxophone|souffle
    Flûte|la|🎶|recorder flute|souffle
    Accordéon|l'|🪗|accordion|
    Micro|le|🎤|microphone|x-musique
  `,
  jouets: `
    Poupée|la|🪆|doll|g-poupee
    Marionnette|la|🧸|puppet|g-poupee
    Robot|le|🤖|toy robot|
    Toupie|la|🌀|spinning top toy|
    Cubes|les|🧱|toy blocks|
    Puzzle|le|🧩|jigsaw puzzle|
    Dé|le|🎲|dice|
    Cartes à jouer|les|🃏|playing cards|
    Billes|les|🔮|glass marbles toy|
    Yo-yo|le|🪀|yo-yo|
    Pâte à modeler|la|🎨|play dough|
    Bulles de savon|les|🫧|soap bubbles|
    Corde à sauter|la|🪢|jump rope|
    Château de sable|le|🏰|sandcastle|
    Balançoire|la|🎠|playground swing|
    Toboggan|le|🎢|playground slide|
    Trampoline|le|🤸|trampoline|
    Manège|le|🎠|carousel merry-go-round|
    Chapeau de fête|le|🥳|party hat|fete
    Masque|le|🎭|carnival mask|fete x-jouets
    Guirlande|la|🎊|party garland|fete x-jouets g-fete
    Confettis|les|🎊|confetti|fete x-jouets g-fete
    Feux d'artifice|les|🎆|fireworks|fete x-jouets
    Piñata|la|🪅|pinata|fete
  `,
  sport: `
    Ballon de basket|le|🏀|basketball|g-ballon
    Ballon de rugby|le|🏉|rugby ball|g-ballon
    Raquette|la|🎾|tennis racket|g-tennis
    Balle de tennis|la|🎾|tennis ball|jaune g-tennis g-ballon
    Skis|les|🎿|skis|
    Luge|la|🛷|sled|
    Patins à glace|les|⛸️|ice skates|g-patins
    Rollers|les|🛼|roller skates|g-patins
    Planche de surf|la|🏄|surfboard|
    Piscine|la|🏊|swimming pool|x-sport
    But de foot|le|🥅|soccer goal|x-sport
    Médaille|la|🥇|gold medal|x-sport
    Coupe|la|🏆|trophy cup|x-sport
  `,
  outils: `
    Marteau|le|🔨|hammer|
    Tournevis|le|🪛|screwdriver|
    Scie|la|🪚|hand saw|
    Clé à molette|la|🔧|wrench|
    Échelle|l'|🪜|ladder|
    Brouette|la|🛒|wheelbarrow|jardin
    Pelle|la|⛏️|garden shovel|jardin
    Râteau|le|🧹|garden rake|jardin
    Arrosoir|l'|🚿|watering can|jardin
    Tondeuse|la|🚜|lawn mower|jardin
    Cadenas|le|🔒|padlock|x-outils
    Lampe de poche|la|🔦|flashlight|x-outils g-lampe
    Loupe|la|🔍|magnifying glass|x-outils
    Aimant|l'|🧲|magnet|x-outils
  `,
  lieux: `
    Château|le|🏰|castle|
    École|l'|🏫|school building|
    Ferme|la|🏡|farm barn|
    Cabane|la|🛖|tree house|
    Tente|la|⛺|camping tent|
    Igloo|l'|🧊|igloo|g-neige
    Phare|le|🗼|lighthouse|
    Pont|le|🌉|bridge|
    Tour Eiffel|la|🗼|eiffel tower|
    Moulin à vent|le|🌬️|windmill|
    Hôpital|l'|🏥|hospital|
    Gratte-ciel|le|🏙️|skyscraper|
    Magasin|le|🏪|shop store front|
  `,
};

/** Mots de la banque : le mot affiché, son article, l'émoji de secours, la recherche de sa photo, sa famille et ses étiquettes. */
export const BANQUE_MOTS = Object.entries(MOTS).flatMap(([famille, bloc]) => bloc.trim().split("\n").map((ligne) => {
  const [mot, article, emoji, recherche, etiquettes = ""] = ligne.trim().split("|");
  return { mot, article, emoji, recherche, famille, cle: cleMot(mot), tags: new Set([famille, ...etiquettes.split(/\s+/).filter(Boolean)]) };
}));

/** Clé d'un mot (nom de sa photo) : minuscules sans accents, tirets (« Pomme de terre » → « pomme-de-terre »). */
export function cleMot(mot) {
  return String(mot).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/œ/gi, "oe").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const PAR_MOT = new Map(BANQUE_MOTS.map((m) => [m.mot, m]));
/** Le mot de la banque (photo, émoji), ou undefined. */
export const motBanque = (mot) => PAR_MOT.get(mot);

/** Thèmes de la banque, pour filtrer. */
export const FAMILLES_PETITS = {
  animaux: "Animaux", manger: "À manger", transports: "Transports", maison: "Maison et école", vetements: "Vêtements", corps: "Le corps",
  nature: "Nature", musique: "Musique", jouets: "Jouets et fête", sport: "Sport", outils: "Outils", lieux: "Lieux",
};

const q = (famille, text, ...choices) => ({ famille, text, choices });

/** Questions écrites à la main : la bonne réponse est la première. */
export const QUESTIONS_PETITS = [
  q("animaux", "Quel animal fait « miaou » ?", "Chat", "Chien", "Vache", "Canard"),
  q("animaux", "Quel animal fait « ouaf ouaf » ?", "Chien", "Chat", "Mouton", "Poule"),
  q("animaux", "Quel animal fait « meuh » ?", "Vache", "Cochon", "Lion", "Lapin"),
  q("animaux", "Quel animal fait « coin-coin » ?", "Canard", "Poule", "Chat", "Cheval"),
  q("animaux", "Quel animal pond des œufs ?", "Poule", "Vache", "Chien", "Cochon"),
  q("animaux", "Quel animal nous donne du lait ?", "Vache", "Poule", "Canard", "Lapin"),
  q("animaux", "Quel animal a une très longue trompe ?", "Éléphant", "Girafe", "Lion", "Zèbre"),
  q("animaux", "Quel animal a un très long cou ?", "Girafe", "Éléphant", "Ours", "Singe"),
  q("animaux", "Quel animal a des rayures noires et blanches ?", "Zèbre", "Cheval", "Lion", "Ours"),
  q("animaux", "Quel animal vit dans la mer ?", "Poisson", "Vache", "Chat", "Lapin"),
  q("animaux", "Quel animal a des plumes et vole dans le ciel ?", "Oiseau", "Poisson", "Serpent", "Tortue"),
  q("animaux", "Quel animal porte sa maison sur son dos ?", "Escargot", "Lapin", "Chien", "Singe"),
  q("animaux", "Quel animal adore les carottes ?", "Lapin", "Lion", "Requin", "Crocodile"),
  q("animaux", "Quel animal fabrique le miel ?", "Abeille", "Papillon", "Fourmi", "Araignée"),
  q("animaux", "Quel animal saute très haut et porte son bébé dans une poche ?", "Kangourou", "Éléphant", "Ours", "Tortue"),
  q("animaux", "Quel animal a 8 pattes ?", "Araignée", "Fourmi", "Abeille", "Coccinelle"),
  q("animaux", "Quel animal est rouge avec des points noirs ?", "Coccinelle", "Abeille", "Papillon", "Fourmi"),
  q("animaux", "Quel animal vit sur la glace et ne vole pas ?", "Manchot", "Lion", "Singe", "Vache"),
  q("animaux", "Quel animal mange du bambou ?", "Panda", "Lion", "Requin", "Chat"),
  q("animaux", "Quel animal grimpe aux arbres et adore les bananes ?", "Singe", "Vache", "Poisson", "Cochon"),
  q("animaux", "Quel animal est le roi de la savane ?", "Lion", "Lapin", "Mouton", "Canard"),
  q("animaux", "Quel animal nous donne de la laine ?", "Mouton", "Chien", "Poule", "Cheval"),
  q("animaux", "Quel animal fait « hou hou » la nuit ?", "Hibou", "Canard", "Poule", "Chat"),
  q("animaux", "Quel animal a 8 bras ?", "Pieuvre", "Crabe", "Poisson", "Baleine"),
  q("animaux", "Quel animal marche de côté avec ses pinces ?", "Crabe", "Pieuvre", "Dauphin", "Tortue"),
  q("animaux", "Quel est le plus gros animal de la mer ?", "Baleine", "Poisson", "Crabe", "Pieuvre"),
  q("animaux", "Quel animal a de grandes dents et nage dans la mer ?", "Requin", "Mouton", "Lapin", "Poule"),
  q("animaux", "Quel animal fait « croâ » et saute près de la mare ?", "Grenouille", "Crocodile", "Serpent", "Tortue"),
  q("animaux", "Quel animal n'a pas de pattes ?", "Serpent", "Chien", "Poule", "Grenouille"),
  q("animaux", "Quel animal se cache dans sa carapace ?", "Tortue", "Lapin", "Chat", "Singe"),
  q("animaux", "Quel animal galope ?", "Cheval", "Vache", "Cochon", "Mouton"),
  q("animaux", "Quel animal est rose et aime la boue ?", "Cochon", "Mouton", "Chien", "Canard"),
  q("animaux", "Quel animal attrape les souris ?", "Chat", "Vache", "Canard", "Mouton"),
  q("animaux", "Quel petit animal adore le fromage ?", "Souris", "Éléphant", "Girafe", "Cheval"),
  q("animaux", "Quel animal a de jolies ailes de toutes les couleurs ?", "Papillon", "Fourmi", "Escargot", "Araignée"),
  q("animaux", "Quel animal est orange avec une grande queue touffue ?", "Renard", "Cochon", "Mouton", "Poule"),
  q("animaux", "Quel animal dort tout l'hiver ?", "Ours", "Poule", "Cheval", "Vache"),
  q("animaux", "Quel animal a une grande bouche pleine de dents ?", "Crocodile", "Canard", "Grenouille", "Escargot"),
  q("animaux", "Quel animal a des rayures orange et noires ?", "Tigre", "Zèbre", "Lion", "Girafe"),
  q("animaux", "Quel animal saute hors de l'eau et joue avec les vagues ?", "Dauphin", "Vache", "Hibou", "Fourmi"),
  q("manger", "Quel fruit est jaune et long ?", "Banane", "Pomme", "Fraise", "Raisin"),
  q("manger", "Quel fruit est rouge avec des petits grains dessus ?", "Fraise", "Banane", "Orange", "Poire"),
  q("manger", "Quel légume est orange et croquant ?", "Carotte", "Tomate", "Brocoli", "Maïs"),
  q("manger", "Lequel est un fruit ?", "Pomme", "Voiture", "Chaise", "Chaussure"),
  q("manger", "Lequel est un légume ?", "Brocoli", "Gâteau", "Bonbon", "Glace"),
  q("manger", "Quel fruit a le même nom que sa couleur ?", "Orange", "Banane", "Fraise", "Raisin"),
  q("manger", "Quel fruit est vert dehors et rouge dedans ?", "Pastèque", "Banane", "Citron", "Poire"),
  q("manger", "Quel fruit jaune est très acide ?", "Citron", "Fraise", "Cerise", "Raisin"),
  q("manger", "Quel fruit pousse en grappes ?", "Raisin", "Pomme", "Ananas", "Pastèque"),
  q("manger", "Quel fruit a une couronne de feuilles ?", "Ananas", "Cerise", "Banane", "Fraise"),
  q("manger", "Que mange-t-on à son anniversaire, avec des bougies dessus ?", "Gâteau", "Brocoli", "Pain", "Fromage"),
  q("manger", "Qu'est-ce qui est tout froid et se mange en été ?", "Glace", "Pain", "Frites", "Croissant"),
  q("manger", "Qu'est-ce que la poule pond ?", "Œuf", "Pomme", "Pain", "Bonbon"),
  q("manger", "Que boit-on et qui vient de la vache ?", "Lait", "Pomme", "Pain", "Banane"),
  q("manger", "Qu'est-ce que les ours adorent manger ?", "Miel", "Fromage", "Pain", "Carotte"),
  q("manger", "Qu'est-ce qui est rond, avec de la tomate et du fromage ?", "Pizza", "Banane", "Croissant", "Œuf"),
  q("manger", "Que fabrique le boulanger ?", "Pain", "Fromage", "Lait", "Pomme"),
  q("manger", "Qu'est-ce qu'on mange au petit-déjeuner et qui a la forme d'une lune ?", "Croissant", "Pizza", "Frites", "Brocoli"),
  q("manger", "Quel légume est rouge et rond ?", "Tomate", "Carotte", "Brocoli", "Maïs"),
  q("manger", "Quel légume ressemble à un petit arbre vert ?", "Brocoli", "Carotte", "Tomate", "Pomme de terre"),
  q("manger", "Avec quoi fait-on les frites ?", "Pomme de terre", "Carotte", "Pomme", "Banane"),
  q("manger", "Lequel est le plus sucré ?", "Bonbon", "Salade", "Brocoli", "Pain"),
  q("manger", "Qu'est-ce qui est marron et sucré ?", "Chocolat", "Tomate", "Salade", "Lait"),
  q("manger", "Quel petit fruit rouge a une queue ?", "Cerise", "Banane", "Ananas", "Pastèque"),
  q("manger", "Quel légume est jaune avec plein de grains ?", "Maïs", "Tomate", "Salade", "Carotte"),
  q("manger", "Qu'est-ce qui a des trous et vient du lait ?", "Fromage", "Pomme", "Bonbon", "Frites"),
  q("transports", "Lequel a des ailes et vole très haut dans le ciel ?", "Avion", "Voiture", "Bateau", "Vélo"),
  q("transports", "Lequel va sur l'eau ?", "Bateau", "Train", "Voiture", "Vélo"),
  q("transports", "Lequel roule sur des rails ?", "Train", "Bateau", "Avion", "Vélo"),
  q("transports", "Lequel a deux roues et des pédales ?", "Vélo", "Voiture", "Bus", "Camion"),
  q("transports", "Lequel va dans l'espace ?", "Fusée", "Bus", "Vélo", "Bateau"),
  q("transports", "Lequel emmène beaucoup de monde en même temps sur la route ?", "Bus", "Vélo", "Moto", "Fusée"),
  q("transports", "Lequel travaille dans les champs de la ferme ?", "Tracteur", "Avion", "Bateau", "Fusée"),
  q("transports", "Lequel a une grande hélice sur le toit ?", "Hélicoptère", "Train", "Voiture", "Bateau"),
  q("transports", "Lequel transporte des choses très lourdes sur la route ?", "Camion", "Vélo", "Moto", "Avion"),
  q("transports", "Lequel a 4 roues et emmène la famille en vacances ?", "Voiture", "Vélo", "Fusée", "Bateau"),
  q("maison", "Dans quoi dort-on ?", "Lit", "Chaise", "Lampe", "Tasse"),
  q("maison", "Sur quoi s'assoit-on ?", "Chaise", "Parapluie", "Clé", "Livre"),
  q("maison", "Qu'est-ce qui ouvre une porte ?", "Clé", "Cuillère", "Crayon", "Chaussette"),
  q("maison", "Qu'est-ce qu'on prend quand il pleut ?", "Parapluie", "Lunettes", "Ballon", "Livre"),
  q("maison", "Avec quoi dessine-t-on ?", "Crayon", "Fourchette", "Clé", "Chaussure"),
  q("maison", "Avec quoi découpe-t-on le papier ?", "Ciseaux", "Cuillère", "Livre", "Lampe"),
  q("maison", "Avec quoi mange-t-on la soupe ?", "Cuillère", "Fourchette", "Ciseaux", "Crayon"),
  q("maison", "Avec quoi se brosse-t-on les dents ?", "Brosse à dents", "Fourchette", "Crayon", "Clé"),
  q("maison", "Qu'est-ce qui donne l'heure ?", "Horloge", "Livre", "Chaise", "Tasse"),
  q("maison", "Qu'est-ce qu'on lit ?", "Livre", "Ballon", "Cuillère", "Chaussette"),
  q("maison", "Avec quoi se lave-t-on les mains ?", "Savon", "Bonbon", "Crayon", "Clé"),
  q("maison", "Qu'est-ce qu'on souffle sur le gâteau d'anniversaire ?", "Bougie", "Livre", "Clé", "Chaise"),
  q("maison", "Qu'est-ce qu'on ouvre le jour de son anniversaire ?", "Cadeau", "Brocoli", "Chaise", "Savon"),
  q("maison", "Avec quoi joue-t-on au football ?", "Ballon", "Livre", "Cuillère", "Lampe"),
  q("maison", "Qu'est-ce qui éclaire quand il fait noir ?", "Lampe", "Chaise", "Tasse", "Clé"),
  q("maison", "Avec quoi appelle-t-on Mamie ?", "Téléphone", "Crayon", "Livre", "Cuillère"),
  q("maison", "Dans quoi range-t-on ses affaires d'école ?", "Cartable", "Tasse", "Lit", "Chaussure"),
  q("maison", "Qu'est-ce qui vole au bout d'une ficelle quand il y a du vent ?", "Cerf-volant", "Chaise", "Livre", "Clé"),
  q("maison", "Avec quoi mange-t-on les spaghettis ?", "Fourchette", "Ciseaux", "Crayon", "Savon"),
  q("maison", "Dans quoi boit-on le chocolat chaud ?", "Tasse", "Fourchette", "Ciseaux", "Chaussure"),
  q("maison", "Qu'est-ce qu'on regarde pour voir des dessins animés ?", "Télévision", "Lit", "Parapluie", "Savon"),
  q("maison", "Avec quoi fait-on des câlins le soir dans son lit ?", "Ours en peluche", "Fourchette", "Clé", "Ciseaux"),
  q("maison", "Qu'est-ce qui s'envole si on le lâche à la fête ?", "Ballon de fête", "Chaise", "Livre", "Tasse"),
  q("maison", "Où habite-t-on avec sa famille ?", "Maison", "Vélo", "Chaise", "Tasse"),
  q("vetements", "Qu'est-ce qu'on met aux pieds ?", "Chaussure", "Casquette", "Gants", "Écharpe"),
  q("vetements", "Qu'est-ce qu'on met sur les mains quand il fait froid ?", "Gants", "Chaussette", "Lunettes", "Casquette"),
  q("vetements", "Qu'est-ce qu'on met autour du cou ?", "Écharpe", "Chaussure", "Gants", "Chaussette"),
  q("vetements", "Qu'est-ce qu'on met sur la tête ?", "Casquette", "Chaussette", "Pantalon", "Gants"),
  q("vetements", "Qu'est-ce qui aide à mieux voir ?", "Lunettes", "Gants", "Chaussette", "Écharpe"),
  q("vetements", "Qu'est-ce qu'on met sur les jambes ?", "Pantalon", "Casquette", "Gants", "Lunettes"),
  q("vetements", "Qu'est-ce qu'on met dans les chaussures ?", "Chaussette", "Casquette", "Écharpe", "Robe"),
  q("vetements", "Qu'est-ce qu'on porte en haut quand il fait chaud ?", "T-shirt", "Gants", "Écharpe", "Chaussette"),
  q("nature", "Qu'est-ce qui brille dans le ciel pendant la journée ?", "Soleil", "Lune", "Étoile", "Feu"),
  q("nature", "Qu'est-ce qu'on voit dans le ciel la nuit ?", "Lune", "Soleil", "Arc-en-ciel", "Arbre"),
  q("nature", "Qu'est-ce qui tombe du ciel en hiver et qui est tout blanc ?", "Neige", "Feuille", "Fleur", "Soleil"),
  q("nature", "Qu'est-ce qui apparaît dans le ciel avec plein de couleurs ?", "Arc-en-ciel", "Nuage", "Lune", "Feu"),
  q("nature", "Qu'est-ce qui est très chaud et qui brûle ?", "Feu", "Neige", "Nuage", "Feuille"),
  q("nature", "Qu'est-ce qui sent bon et pousse dans le jardin ?", "Fleur", "Voiture", "Chaise", "Clé"),
  q("nature", "Qu'est-ce qui a un tronc et des branches ?", "Arbre", "Fleur", "Nuage", "Maison"),
  q("nature", "Où joue-t-on dans le sable au bord de la mer ?", "Plage", "Montagne", "Maison", "Lit"),
  q("nature", "Qu'est-ce qui est très haut, avec de la neige tout en haut ?", "Montagne", "Plage", "Arbre", "Maison"),
  q("nature", "Quel arbre décore-t-on à Noël ?", "Sapin", "Fleur", "Champignon", "Feuille"),
  q("nature", "Qu'est-ce qui tombe des arbres en automne ?", "Feuille", "Étoile", "Ballon", "Lune"),
  q("nature", "Qu'est-ce qui pousse dans la forêt et ressemble à un petit parapluie ?", "Champignon", "Fleur", "Carotte", "Pomme"),
  q("nature", "Qu'est-ce qui est blanc et flotte dans le ciel ?", "Nuage", "Soleil", "Arbre", "Feu"),
  q("nature", "Qu'est-ce qui scintille dans le ciel la nuit ?", "Étoile", "Soleil", "Nuage", "Arc-en-ciel"),
  q("musique", "Sur quoi tape-t-on avec des baguettes ?", "Tambour", "Guitare", "Piano", "Trompette"),
  q("musique", "Lequel a des touches noires et blanches ?", "Piano", "Guitare", "Tambour", "Violon"),
  q("musique", "Dans lequel souffle-t-on ?", "Trompette", "Piano", "Tambour", "Guitare"),
  q("musique", "Lequel se joue avec un archet ?", "Violon", "Tambour", "Trompette", "Piano"),
  q("musique", "Lequel a des cordes que l'on gratte ?", "Guitare", "Tambour", "Trompette", "Piano"),
  // Ajoutées le 20 octobre avec les 400 mots (ne pas réordonner : les identifiants suivent l'ordre).
  q("animaux", "Quel animal fait « cocorico » le matin ?", "Coq", "Poule", "Canard", "Chat"),
  q("animaux", "Quel animal fait « hi-han » ?", "Âne", "Cheval", "Vache", "Mouton"),
  q("animaux", "Quel animal fait « bêêê » ?", "Mouton", "Vache", "Cochon", "Chien"),
  q("animaux", "Quel animal fait « groin groin » ?", "Cochon", "Mouton", "Lapin", "Canard"),
  q("animaux", "Quel animal hurle « ahouuu » à la lune ?", "Loup", "Lapin", "Cochon", "Poule"),
  q("animaux", "Quel animal fait « bzzz » et fabrique du miel ?", "Abeille", "Fourmi", "Escargot", "Coccinelle"),
  q("animaux", "Quel animal a des piquants sur le dos ?", "Hérisson", "Lapin", "Souris", "Chat"),
  q("animaux", "Quel animal a une grosse crinière ?", "Lion", "Ours", "Éléphant", "Girafe"),
  q("animaux", "Quel animal saute avec un bébé dans sa poche ?", "Kangourou", "Lapin", "Singe", "Ours"),
  q("animaux", "Quel animal mange des bambous ?", "Panda", "Lion", "Requin", "Poule"),
  q("animaux", "Quel animal grimpe aux arbres et mange des bananes ?", "Singe", "Vache", "Poisson", "Escargot"),
  q("animaux", "Quel animal a une queue toute touffue et mange des noisettes ?", "Écureuil", "Cochon", "Poisson", "Canard"),
  q("animaux", "Quel animal vit dans le froid, sur la glace ?", "Ours blanc", "Lion", "Girafe", "Singe"),
  q("animaux", "Quel animal a deux bosses sur le dos ?", "Chameau", "Cheval", "Vache", "Lapin"),
  q("animaux", "Quel animal a une corne sur le nez ?", "Rhinocéros", "Éléphant", "Lion", "Zèbre"),
  q("animaux", "Quel animal construit des barrages dans la rivière ?", "Castor", "Lapin", "Renard", "Chat"),
  q("animaux", "Quel oiseau répète les mots qu'on lui dit ?", "Perroquet", "Poule", "Canard", "Hibou"),
  q("animaux", "Quel oiseau ouvre sa queue comme un grand éventail ?", "Paon", "Pigeon", "Canard", "Poule"),
  q("animaux", "Quel oiseau est tout rose et tient sur une patte ?", "Flamant rose", "Pigeon", "Hibou", "Aigle"),
  q("animaux", "Quel animal dort la tête en bas ?", "Chauve-souris", "Chien", "Vache", "Poisson"),
  q("animaux", "Quel petit animal rouge a des points noirs ?", "Coccinelle", "Fourmi", "Abeille", "Araignée"),
  q("animaux", "Qui fabrique une toile pour attraper les mouches ?", "Araignée", "Abeille", "Papillon", "Escargot"),
  q("animaux", "Quelle petite bête devient un papillon ?", "Chenille", "Fourmi", "Araignée", "Escargot"),
  q("animaux", "Quel animal a huit bras ?", "Pieuvre", "Poisson", "Dauphin", "Requin"),
  q("animaux", "Quel animal marche de côté avec des pinces ?", "Crabe", "Poisson", "Tortue", "Dauphin"),
  q("animaux", "Quel animal de la mer a la forme d'une étoile ?", "Étoile de mer", "Requin", "Baleine", "Crabe"),
  q("animaux", "Quel poisson est orange et blanc ?", "Poisson-clown", "Requin", "Baleine", "Dauphin"),
  q("animaux", "Quel animal souffle de l'eau par un trou sur sa tête ?", "Baleine", "Requin", "Crabe", "Pieuvre"),
  q("animaux", "Quel animal a de grandes oreilles et adore les carottes ?", "Lapin", "Chat", "Cochon", "Poule"),
  q("animaux", "Quel petit animal sort de l'œuf de la poule ?", "Poussin", "Lapin", "Chat", "Canard"),
  q("manger", "Qu'est-ce qui est jaune et que mangent les singes ?", "Banane", "Pomme", "Fraise", "Carotte"),
  q("manger", "Quel fruit est très acide ?", "Citron", "Banane", "Fraise", "Poire"),
  q("manger", "Quel fruit a une couronne de feuilles sur la tête ?", "Ananas", "Pomme", "Banane", "Cerise"),
  q("manger", "Quel fruit est rouge dedans avec des pépins noirs ?", "Pastèque", "Banane", "Citron", "Poire"),
  q("manger", "Quel fruit est marron et poilu dehors, vert dedans ?", "Kiwi", "Pomme", "Banane", "Fraise"),
  q("manger", "Quel fruit est tout dur et plein d'eau dedans ?", "Noix de coco", "Fraise", "Banane", "Cerise"),
  q("manger", "Qu'est-ce qu'on transforme en frites ?", "Pomme de terre", "Carotte", "Tomate", "Pomme"),
  q("manger", "Avec quoi fait-on la soupe de citrouille ?", "Citrouille", "Banane", "Fraise", "Cerise"),
  q("manger", "Qu'est-ce qui fait pleurer quand on le coupe ?", "Oignon", "Pomme", "Banane", "Pain"),
  q("manger", "Qu'est-ce qu'on boit au petit déjeuner, fait avec des oranges ?", "Jus d'orange", "Lait", "Eau", "Soupe"),
  q("manger", "Qu'est-ce qu'on boit quand on a très soif ?", "Eau", "Frites", "Pain", "Fromage"),
  q("manger", "Qu'est-ce qu'on met sur sa tartine le matin ?", "Confiture", "Frites", "Soupe", "Pizza"),
  q("manger", "Qu'est-ce qu'on mange au cinéma ?", "Pop-corn", "Soupe", "Salade", "Œuf"),
  q("manger", "Qu'est-ce qui est rond avec un trou au milieu ?", "Beignet", "Pain", "Fromage", "Pizza"),
  q("manger", "Qu'est-ce qui a des petits carrés et se mange avec du sucre ?", "Gaufre", "Pain", "Pizza", "Œuf"),
  q("manger", "Qu'est-ce qui est rose, tout doux, et se mange à la fête foraine ?", "Barbe à papa", "Pain", "Salade", "Carotte"),
  q("manger", "Qu'est-ce qu'on mange avec une petite cuillère, dans un petit pot ?", "Yaourt", "Pizza", "Pain", "Frites"),
  q("manger", "Qu'est-ce qu'on mange avec du lait dans un bol le matin ?", "Céréales", "Frites", "Pizza", "Salade"),
  q("manger", "Qu'est-ce qui est fait avec des spaghettis ?", "Pâtes", "Pain", "Gâteau", "Glace"),
  q("manger", "Qu'est-ce qui a du pain, de la viande et du fromage ?", "Hamburger", "Glace", "Pomme", "Bonbon"),
  q("manger", "Qu'est-ce qu'on lèche et qui a un bâton ?", "Sucette", "Pain", "Fromage", "Salade"),
  q("transports", "Qui vient quand il y a le feu ?", "Camion de pompiers", "Bus", "Vélo", "Tracteur"),
  q("transports", "Qui emmène les malades à l'hôpital ?", "Ambulance", "Tracteur", "Vélo", "Train"),
  q("transports", "Qu'est-ce qui roule sous la terre, dans la ville ?", "Métro", "Bateau", "Avion", "Vélo"),
  q("transports", "Qu'est-ce qui va sous la mer ?", "Sous-marin", "Avion", "Voiture", "Vélo"),
  q("transports", "Qu'est-ce qui vole avec un grand ballon et un panier ?", "Montgolfière", "Avion", "Fusée", "Bateau"),
  q("transports", "Qu'est-ce qu'on pousse avec un bébé dedans ?", "Poussette", "Camion", "Moto", "Train"),
  q("transports", "Sur quoi fait-on des figures avec une planche à roulettes ?", "Skateboard", "Voiture", "Bateau", "Bus"),
  q("transports", "Qu'est-ce qui a une sirène et des policiers dedans ?", "Voiture de police", "Tracteur", "Vélo", "Bateau"),
  q("transports", "Avec quoi creuse-t-on de gros trous sur les chantiers ?", "Pelleteuse", "Vélo", "Bateau", "Bus"),
  q("transports", "Sur quoi rame-t-on sur la rivière ?", "Canoë", "Avion", "Voiture", "Train"),
  q("maison", "Avec quoi ouvre-t-on la porte de la maison ?", "Clé", "Cuillère", "Crayon", "Livre"),
  q("maison", "Qu'est-ce qui garde les aliments au frais ?", "Réfrigérateur", "Lit", "Télévision", "Chaise"),
  q("maison", "Dans quoi fait-on cuire le gâteau ?", "Four", "Réfrigérateur", "Lit", "Baignoire"),
  q("maison", "Avec quoi se regarde-t-on le matin ?", "Miroir", "Fenêtre", "Porte", "Livre"),
  q("maison", "Avec quoi se coiffe-t-on ?", "Peigne", "Fourchette", "Crayon", "Clé"),
  q("maison", "Avec quoi se sèche-t-on après le bain ?", "Serviette", "Livre", "Assiette", "Chaise"),
  q("maison", "Qu'est-ce qu'on met sur sa brosse à dents ?", "Dentifrice", "Confiture", "Savon", "Colle"),
  q("maison", "Où pose-t-on la tête pour dormir ?", "Oreiller", "Chaise", "Table", "Panier"),
  q("maison", "Avec quoi balaie-t-on la poussière ?", "Balai", "Parapluie", "Crayon", "Cuillère"),
  q("maison", "Où jette-t-on les déchets ?", "Poubelle", "Réfrigérateur", "Lit", "Baignoire"),
  q("maison", "Où le facteur dépose-t-il les lettres ?", "Boîte aux lettres", "Poubelle", "Four", "Lit"),
  q("maison", "Avec quoi prend-on des photos ?", "Appareil photo", "Livre", "Horloge", "Lampe"),
  q("maison", "Avec quoi coupe-t-on le papier ?", "Ciseaux", "Cuillère", "Crayon", "Gomme"),
  q("maison", "Avec quoi efface-t-on un trait de crayon ?", "Gomme", "Règle", "Colle", "Ciseaux"),
  q("maison", "Avec quoi trace-t-on un trait bien droit ?", "Règle", "Gomme", "Colle", "Peigne"),
  q("maison", "Où range-t-on ses crayons ?", "Trousse", "Réfrigérateur", "Poubelle", "Four"),
  q("maison", "Sur quoi s'assoit-on à plusieurs pour regarder la télé ?", "Canapé", "Table", "Lit", "Baignoire"),
  q("maison", "Par où regarde-t-on dehors ?", "Fenêtre", "Porte", "Miroir", "Table"),
  q("maison", "D'où coule l'eau dans l'évier ?", "Robinet", "Lampe", "Horloge", "Livre"),
  q("vetements", "Qu'est-ce qu'on met pour sauter dans les flaques ?", "Bottes", "Sandales", "Pantoufles", "Chaussette"),
  q("vetements", "Qu'est-ce qu'on met pour dormir ?", "Pyjama", "Manteau", "Maillot de bain", "Écharpe"),
  q("vetements", "Qu'est-ce qu'on met pour aller à la piscine ?", "Maillot de bain", "Manteau", "Pyjama", "Gants"),
  q("vetements", "Qu'est-ce qu'on met aux pieds à la maison ?", "Pantoufles", "Bottes", "Gants", "Bonnet"),
  q("vetements", "Qu'est-ce qui donne l'heure, au poignet ?", "Montre", "Collier", "Gants", "Lunettes"),
  q("vetements", "Qu'est-ce que porte un roi sur la tête ?", "Couronne", "Casquette", "Bonnet", "Chaussette"),
  q("vetements", "Qu'est-ce qui protège les yeux du soleil ?", "Lunettes de soleil", "Écharpe", "Gants", "Chaussette"),
  q("corps", "Avec quoi voit-on ?", "Œil", "Oreille", "Nez", "Main"),
  q("corps", "Avec quoi entend-on ?", "Oreille", "Œil", "Pied", "Nez"),
  q("corps", "Avec quoi sent-on les fleurs ?", "Nez", "Oreille", "Main", "Pied"),
  q("corps", "Avec quoi marche-t-on ?", "Pied", "Main", "Nez", "Oreille"),
  q("corps", "Avec quoi applaudit-on ?", "Main", "Pied", "Nez", "Oreille"),
  q("corps", "Qu'est-ce qu'on brosse matin et soir ?", "Dents", "Oreille", "Pied", "Main"),
  q("corps", "Qu'est-ce qu'on coiffe avec un peigne ?", "Cheveux", "Nez", "Pied", "Main"),
  q("corps", "Avec quoi goûte-t-on la glace ?", "Langue", "Oreille", "Pied", "Œil"),
  q("nature", "Qu'est-ce qui tombe du ciel quand il pleut ?", "Pluie", "Neige", "Feuille", "Sable"),
  q("nature", "Que fabrique-t-on avec de la neige ?", "Bonhomme de neige", "Château de sable", "Gâteau", "Maison"),
  q("nature", "Qu'est-ce qui crache du feu en haut d'une montagne ?", "Volcan", "Rivière", "Arbre", "Plage"),
  q("nature", "Quelle fleur est grande, jaune et regarde le soleil ?", "Tournesol", "Rose", "Cactus", "Sapin"),
  q("nature", "Quelle plante pique et vit dans le désert ?", "Cactus", "Fleur", "Salade", "Arbre"),
  q("nature", "Qu'est-ce qu'on ramasse sur la plage ?", "Coquillage", "Pomme de pin", "Feuille", "Plume"),
  q("nature", "Qu'est-ce qui tombe des sapins ?", "Pomme de pin", "Coquillage", "Caillou", "Neige"),
  q("nature", "Où les oiseaux pondent-ils leurs œufs ?", "Nid", "Coquillage", "Caillou", "Toile d'araignée"),
  q("nature", "Qu'est-ce qu'on met dans un verre pour que ce soit tout froid ?", "Glaçon", "Sable", "Caillou", "Feu"),
  q("nature", "Qu'est-ce qui gronde et brille pendant l'orage ?", "Éclair", "Lune", "Étoile", "Soleil"),
  q("musique", "Qu'est-ce qu'on secoue pour faire de la musique ?", "Maracas", "Piano", "Violon", "Trompette"),
  q("musique", "Dans quoi chante-t-on pour que tout le monde entende ?", "Micro", "Tambour", "Livre", "Tasse"),
  q("musique", "Lequel est un instrument qu'on ouvre et qu'on ferme ?", "Accordéon", "Guitare", "Trompette", "Tambour"),
  q("jouets", "Avec quoi fait-on des bulles en soufflant ?", "Bulles de savon", "Ballon", "Dé", "Puzzle"),
  q("jouets", "Qu'est-ce qui tourne très vite sur la pointe ?", "Toupie", "Cubes", "Puzzle", "Poupée"),
  q("jouets", "Avec quoi construit-on une tour ?", "Cubes", "Billes", "Corde à sauter", "Yo-yo"),
  q("jouets", "Qu'est-ce qu'on lance pour jouer aux petits chevaux ?", "Dé", "Ballon", "Toupie", "Poupée"),
  q("jouets", "Qu'est-ce qu'on assemble, pièce par pièce, pour faire une image ?", "Puzzle", "Dé", "Billes", "Toupie"),
  q("jouets", "Sur quoi glisse-t-on au parc ?", "Toboggan", "Balançoire", "Trampoline", "Manège"),
  q("jouets", "Sur quoi saute-t-on très haut ?", "Trampoline", "Toboggan", "Balançoire", "Château de sable"),
  q("jouets", "Que construit-on avec un seau sur la plage ?", "Château de sable", "Cubes", "Puzzle", "Robot"),
  q("jouets", "Qu'est-ce qu'on casse à la fête pour faire tomber les bonbons ?", "Piñata", "Ballon", "Cadeau", "Gâteau"),
  q("jouets", "Qu'est-ce qui fait boum et colore le ciel la nuit de fête ?", "Feux d'artifice", "Confettis", "Bougie", "Lampe"),
  q("jouets", "Sur quoi tourne-t-on assis sur un petit cheval ?", "Manège", "Toboggan", "Trampoline", "Vélo"),
  q("sport", "Avec quoi joue-t-on au tennis ?", "Raquette", "Ballon de basket", "Skis", "Luge"),
  q("sport", "Qu'est-ce qu'on met aux pieds pour glisser sur la glace ?", "Patins à glace", "Skis", "Sandales", "Pantoufles"),
  q("sport", "Avec quoi descend-on la piste de neige, assis ?", "Luge", "Planche de surf", "Vélo", "Trottinette"),
  q("sport", "Avec quoi glisse-t-on sur les vagues ?", "Planche de surf", "Luge", "Skis", "Rollers"),
  q("sport", "Qu'est-ce qu'on gagne quand on est premier ?", "Médaille", "Chaussette", "Cuillère", "Caillou"),
  q("sport", "Où marque-t-on un but ?", "But de foot", "Piscine", "Luge", "Panier"),
  q("sport", "Où nage-t-on ?", "Piscine", "Luge", "But de foot", "Skis"),
  q("outils", "Avec quoi tape-t-on sur un clou ?", "Marteau", "Scie", "Pelle", "Râteau"),
  q("outils", "Avec quoi coupe-t-on une planche de bois ?", "Scie", "Marteau", "Arrosoir", "Pinceau"),
  q("outils", "Avec quoi monte-t-on tout en haut ?", "Échelle", "Pelle", "Brouette", "Marteau"),
  q("outils", "Avec quoi arrose-t-on les fleurs ?", "Arrosoir", "Marteau", "Scie", "Échelle"),
  q("outils", "Avec quoi creuse-t-on un trou dans le jardin ?", "Pelle", "Marteau", "Arrosoir", "Loupe"),
  q("outils", "Qu'est-ce qui coupe l'herbe du jardin ?", "Tondeuse", "Arrosoir", "Échelle", "Marteau"),
  q("outils", "Avec quoi voit-on les petites choses en très gros ?", "Loupe", "Marteau", "Pelle", "Cadenas"),
  q("outils", "Avec quoi éclaire-t-on dans le noir ?", "Lampe de poche", "Marteau", "Scie", "Arrosoir"),
  q("lieux", "Où vont les enfants pour apprendre ?", "École", "Hôpital", "Phare", "Château"),
  q("lieux", "Où habitent les rois et les princesses ?", "Château", "Tente", "Igloo", "Cabane"),
  q("lieux", "Où dort-on en camping ?", "Tente", "Château", "Hôpital", "Pont"),
  q("lieux", "Où soigne-t-on les malades ?", "Hôpital", "École", "Ferme", "Phare"),
  q("lieux", "Quelle maison est faite de neige ?", "Igloo", "Cabane", "Château", "Tente"),
  q("lieux", "Qu'est-ce qui éclaire les bateaux la nuit ?", "Phare", "Pont", "Moulin à vent", "Tente"),
  q("lieux", "Qu'est-ce qui permet de traverser la rivière ?", "Pont", "Phare", "Tente", "Igloo"),
  q("lieux", "Quel grand monument est à Paris ?", "Tour Eiffel", "Igloo", "Phare", "Tente"),
  q("lieux", "Où vivent les vaches, les poules et les cochons ?", "Ferme", "École", "Hôpital", "Château"),
  q("lieux", "Qu'est-ce qui tourne avec le vent ?", "Moulin à vent", "Pont", "Château", "Tente"),
  q("lieux", "Où achète-t-on des choses ?", "Magasin", "Phare", "Igloo", "Pont"),
  q("lieux", "Quelle petite maison construit-on dans un arbre ?", "Cabane", "Château", "Hôpital", "Gratte-ciel"),
  q("lieux", "Quel immeuble est si haut qu'il touche presque les nuages ?", "Gratte-ciel", "Tente", "Cabane", "Igloo"),
].map((x, i) => ({ ...x, id: `p${String(i + 1).padStart(3, "0")}` }));

// ---------- Questions fabriquées à partir des étiquettes des mots ----------

/**
 * Modèles de questions : la bonne réponse porte l'étiquette [oui] ; les mauvaises sont prises parmi les mots qui portent
 * une des étiquettes [parmi] (une famille est aussi une étiquette) sans porter [oui]. Un mot marqué « x-<oui> » n'est
 * jamais pris, ni comme bonne ni comme mauvaise réponse. [intrus] : l'inverse, la bonne réponse est le mot qui n'a pas
 * l'étiquette, au milieu de trois mots qui l'ont (« Lequel n'est pas un animal ? »).
 */
const COULEURS = ["rouge", "jaune", "vert", "blanc", "orange", "rose", "bleu"];
const AUTRES = (...familles) => Object.keys(MOTS).filter((f) => !familles.includes(f));
export const MODELES_PETITS = [
  { id: "vole", text: "Lequel peut voler ?", oui: "vole", parmi: ["animaux", "transports"] },
  { id: "eau", text: "Qui vit dans l'eau ?", oui: "eau", parmi: ["animaux"] },
  { id: "plumes", text: "Qui a des plumes ?", oui: "plumes", parmi: ["animaux"] },
  { id: "pattes", text: "Qui marche à quatre pattes ?", oui: "4pattes", parmi: ["animaux"] },
  { id: "insecte", text: "Lequel est un insecte ?", oui: "insecte", parmi: ["animaux"] },
  { id: "ferme", text: "Lequel vit à la ferme ?", oui: "ferme", parmi: ["sauvage"] },
  { id: "gros", text: "Lequel est le plus gros ?", oui: "geant", parmi: ["petit"] },
  { id: "petit", text: "Lequel est le plus petit ?", oui: "petit", parmi: ["geant"] },
  { id: "animal", text: "Lequel est un animal ?", oui: "animaux", parmi: AUTRES("animaux", "corps") },
  { id: "fruit", text: "Lequel est un fruit ?", oui: "fruit", parmi: ["manger"] },
  { id: "legume", text: "Lequel est un légume ?", oui: "legume", parmi: ["manger"] },
  { id: "sucre", text: "Lequel est sucré ?", oui: "sucre", parmi: ["sale"] },
  { id: "sale", text: "Lequel est salé ?", oui: "sale", parmi: ["sucre"] },
  { id: "boisson", text: "Qu'est-ce qu'on boit ?", oui: "boisson", parmi: ["manger"] },
  { id: "mange", text: "Lequel se mange ?", oui: "manger", parmi: AUTRES("manger", "animaux", "nature", "corps") },
  { id: "froid", text: "Lequel est tout froid ?", oui: "froid", parmi: ["chaud"] },
  { id: "chaud", text: "Lequel est très chaud ?", oui: "chaud", parmi: ["froid"] },
  { id: "roues", text: "Lequel a des roues ?", oui: "roues", parmi: ["transports"] },
  { id: "flotte", text: "Lequel flotte sur l'eau ?", oui: "flotte", parmi: ["roues"] },
  { id: "cuisine", text: "Qu'est-ce qu'on trouve dans la cuisine ?", oui: "cuisine", parmi: ["toilette", "chambre", "ecole"] },
  { id: "toilette", text: "Qu'est-ce qu'on trouve dans la salle de bain ?", oui: "toilette", parmi: ["cuisine", "chambre", "ecole"] },
  { id: "ecole", text: "Qu'est-ce qu'on utilise à l'école ?", oui: "ecole", parmi: ["cuisine", "toilette", "chambre"] },
  { id: "pieds", text: "Qu'est-ce qu'on met aux pieds ?", oui: "pieds", parmi: ["vetements"] },
  { id: "tete", text: "Qu'est-ce qu'on met sur la tête ?", oui: "tete", parmi: ["vetements"] },
  { id: "hiver", text: "Qu'est-ce qu'on met quand il fait froid ?", oui: "hiver", parmi: ["ete"] },
  { id: "ete", text: "Qu'est-ce qu'on met quand il fait chaud ?", oui: "ete", parmi: ["hiver"] },
  { id: "vetement", text: "Lequel est un vêtement ?", oui: "vetements", parmi: AUTRES("vetements", "corps", "sport") },
  { id: "ciel", text: "Qu'est-ce qu'on voit dans le ciel ?", oui: "ciel", parmi: ["nature"] },
  { id: "souffle", text: "Dans lequel souffle-t-on ?", oui: "souffle", parmi: ["cordes", "tape"] },
  { id: "cordes", text: "Lequel a des cordes ?", oui: "cordes", parmi: ["souffle", "tape"] },
  { id: "tape", text: "Sur lequel tape-t-on ?", oui: "tape", parmi: ["souffle", "cordes"] },
  { id: "musique", text: "Lequel fait de la musique ?", oui: "musique", parmi: ["manger", "maison", "vetements", "outils", "lieux", "nature"] },
  { id: "jouet", text: "Avec quoi joue-t-on ?", oui: "jouets", parmi: ["manger", "vetements", "outils"] },
  { id: "sport", text: "Avec quoi fait-on du sport ?", oui: "sport", parmi: ["manger", "maison", "vetements", "outils"] },
  { id: "outil", text: "Lequel est un outil ?", oui: "outils", parmi: ["manger", "animaux", "vetements", "jouets"] },
  { id: "jardin", text: "Qu'est-ce qu'on utilise au jardin ?", oui: "jardin", parmi: ["maison"] },
  { id: "fete", text: "Qu'est-ce qu'on voit à une fête d'anniversaire ?", oui: "fete", parmi: ["outils", "transports", "animaux"] },
  ...COULEURS.map((c) => ({ id: c, text: `Lequel est ${c} ?`, oui: c, parmi: COULEURS.filter((x) => x !== c) })),
  // L'intrus : trois mots de la même sorte et un qui n'en est pas (la bonne réponse).
  { id: "pas-animal", text: "Lequel n'est pas un animal ?", oui: "animaux", parmi: AUTRES("animaux", "corps"), intrus: true },
  { id: "pas-fruit", text: "Lequel n'est pas un fruit ?", oui: "fruit", parmi: ["manger"], intrus: true },
  { id: "pas-vetement", text: "Lequel n'est pas un vêtement ?", oui: "vetements", parmi: AUTRES("vetements", "corps", "sport"), intrus: true },
  { id: "pas-vehicule", text: "Lequel n'est pas un véhicule ?", oui: "transports", parmi: AUTRES("transports"), intrus: true },
  { id: "pas-instrument", text: "Lequel n'est pas un instrument de musique ?", oui: "musique", parmi: ["maison", "jouets", "outils"], intrus: true },
  { id: "pas-mange", text: "Lequel ne se mange pas ?", oui: "manger", parmi: AUTRES("manger", "animaux", "nature", "corps"), intrus: true },
];

const aTag = (m, t) => m.tags.has(t);
const groupes = (m) => [...m.tags].filter((t) => t.startsWith("g-"));
/** Deux mots trop proches (même groupe « g-… ») ne vont jamais ensemble dans une question. */
const procheDe = (a, b) => groupes(a).some((g) => b.tags.has(g));

/** « Où est le chat ? », « Où est l'éléphant ? », « Où sont les frites ? ». */
const texteOu = (m) => {
  const nom = m.mot.charAt(0).toLowerCase() + m.mot.slice(1);
  if (m.article === "les") return `Où sont les ${nom} ?`;
  return `Où est ${m.article}${m.article.endsWith("'") ? "" : " "}${nom} ?`;
};

/** Bonnes réponses possibles d'un modèle, et ses mauvaises réponses possibles. Fonction pure, testée. */
export function reponsesModele(modele) {
  const exclu = `x-${modele.oui}`;
  const bonnes = BANQUE_MOTS.filter((m) => aTag(m, modele.oui) && !aTag(m, exclu));
  const mauvaises = BANQUE_MOTS.filter((m) => modele.parmi.some((t) => aTag(m, t)) && !aTag(m, modele.oui) && !aTag(m, exclu));
  return modele.intrus ? { bonnes: mauvaises, mauvaises: bonnes } : { bonnes, mauvaises };
}

const REPONSES = new Map(MODELES_PETITS.map((md) => [md.id, reponsesModele(md)]));

/** Tire au hasard [n] éléments de [liste] qui vont avec [bonne] et entre eux (pas deux mots trop proches). */
function tirerMauvaises(liste, bonne, n, rng) {
  const choisis = [];
  const pool = [...liste];
  while (choisis.length < n && pool.length) {
    const m = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    if (m === bonne || procheDe(m, bonne) || choisis.some((c) => procheDe(m, c))) continue;
    choisis.push(m);
  }
  return choisis.length === n ? choisis : null;
}

/** Fabrique une question : modèle [modele] (ou « ou » pour « Où est … ? ») et bonne réponse [m]. Null si impossible. */
export function fabriquerPetite(modele, m, rng = Math.random) {
  let text, mauvaises;
  if (modele === "ou") {
    text = texteOu(m);
    mauvaises = tirerMauvaises(BANQUE_MOTS.filter((x) => x.famille === m.famille), m, 3, rng);
  } else {
    const md = MODELES_PETITS.find((x) => x.id === modele);
    text = md.text;
    mauvaises = tirerMauvaises(REPONSES.get(md.id).mauvaises, m, 3, rng);
  }
  if (!mauvaises) return null;
  return { id: `g-${modele}-${m.cle}`, famille: m.famille, text, choices: [m.mot, ...mauvaises.map((x) => x.mot)], fabriquee: true };
}

/**
 * Toutes les questions de la banque, chacune avec ses 4 réponses : celles écrites une par une, « Où est … ? » pour
 * chaque mot, et chaque modèle avec chacune de ses bonnes réponses. Les mauvaises réponses sont tirées avec [rng] :
 * la Régie PC fabrique le catalogue une fois à l'ouverture, il change donc d'une fois sur l'autre.
 */
export function cataloguePetits(rng = Math.random) {
  const fabriquees = [
    ...BANQUE_MOTS.map((m) => fabriquerPetite("ou", m, rng)),
    ...MODELES_PETITS.flatMap((md) => REPONSES.get(md.id).bonnes.map((m) => fabriquerPetite(md.id, m, rng))),
  ];
  return [...QUESTIONS_PETITS, ...fabriquees.filter(Boolean)];
}

/**
 * Tire [n] questions variées du [catalogue] : on alterne questions rédigées, « Où est … ? » et modèles, jamais deux
 * fois le même texte ni la même bonne réponse, et rien dont le texte est dans [exclus]. [famille] : ce thème seulement.
 * Fonction pure (à [rng] près), testée.
 */
export function tirerPetits(n, { famille = null, exclus = new Set(), rng = Math.random, catalogue = cataloguePetits(rng) } = {}) {
  const libres = catalogue.filter((x) => (!famille || x.famille === famille) && !exclus.has(x.text));
  const sortes = [
    libres.filter((x) => !x.fabriquee),
    libres.filter((x) => x.id.startsWith("g-ou-")),
    libres.filter((x) => x.fabriquee && !x.id.startsWith("g-ou-")),
  ];
  const poids = [0.35, 0.25, 0.4];
  const textes = new Set();
  const reponses = new Set();
  const pris = [];
  for (let essai = 0; pris.length < n && essai < n * 60; essai++) {
    let de = rng(), k = 0;
    while (k < 2 && de >= poids[k]) de -= poids[k++];
    const sorte = sortes[k].length ? sortes[k] : sortes.find((x) => x.length);
    if (!sorte) break;
    const question = sorte[Math.floor(rng() * sorte.length)];
    if (textes.has(question.text) || reponses.has(question.choices[0])) continue;
    textes.add(question.text);
    reponses.add(question.choices[0]);
    pris.push(question);
  }
  return pris;
}

/** Nombre de questions différentes que la banque sait poser (bonne réponse comprise ; les mauvaises varient en plus). */
export function nombreQuestionsPetits() {
  return QUESTIONS_PETITS.length + BANQUE_MOTS.length + MODELES_PETITS.reduce((s, md) => s + REPONSES.get(md.id).bonnes.length, 0);
}
