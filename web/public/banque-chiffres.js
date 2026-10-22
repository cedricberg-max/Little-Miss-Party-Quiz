// Le Juste Chiffre tout prêt (cedric, 22/10 : « tu ne pourrais pas en développer d'autres pour enrichir la
// bibliothèque de questions toutes prêtes ? ») : des questions dont la réponse est un nombre, par thème et par âge.
// Pas d'émoji (cedric, 22/10 : « pour les questions chiffrées, les émojis n'interviennent pas, c'est juste une animation
// avec les chiffres ») : la TV montre son compteur qui tourne, donc pas d'alerte « Pas d'illustration » non plus.
// Faits simples et sûrs ; quand la réponse est approchée, la question dit « environ » (l'équipe la plus proche gagne,
// voir Scoring.kt). Fonctions pures, testées.

export const THEMES_CHIFFRES = {
  animaux: "Animaux", corps: "Corps humain", temps: "Calendrier et heures", espace: "Espace", sport: "Sport",
  jeux: "Jeux et nombres", musique: "Musique", contes: "Contes, livres et dessins animés", monde: "Monde et nature",
};

/** Âges conseillés : 1 = les petits (5 à 9 ans), 2 = les moyens (8 à 12 ans), 3 = les grands (11 à 15 ans). */
export const NIVEAUX_CHIFFRES = { 1: [5, 9], 2: [8, 12], 3: [11, 15] };

const slug = (t) => `${t}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
const c = (theme, niveau, text, correct) => {
  const [ageMin, ageMax] = NIVEAUX_CHIFFRES[niveau];
  return { id: `jc-${slug(text)}`, theme, niveau, ageMin, ageMax, text, correct };
};

export const QUESTIONS_CHIFFRES = [
  // Animaux
  c("animaux", 1, "Combien de pattes a une araignée ?", 8),
  c("animaux", 1, "Combien de pattes a une coccinelle ?", 6),
  c("animaux", 1, "Combien de bosses a un dromadaire ?", 1),
  c("animaux", 1, "Combien de bosses a un chameau ?", 2),
  c("animaux", 1, "Combien de bras a une pieuvre ?", 8),
  c("animaux", 1, "Combien de pattes a un serpent ?", 0),
  c("animaux", 1, "Combien de pattes a une poule ?", 2),
  c("animaux", 2, "Combien de bras a une étoile de mer, le plus souvent ?", 5),
  c("animaux", 2, "Combien d'ailes a une abeille ?", 4),
  c("animaux", 2, "Combien de pattes a un papillon ?", 6),
  c("animaux", 2, "Combien de pattes a un crabe, pinces comprises ?", 10),
  c("animaux", 2, "Combien d'heures par jour dort un koala, environ ?", 20),
  c("animaux", 3, "Combien de cœurs a une pieuvre ?", 3),
  c("animaux", 3, "Combien d'os (vertèbres) y a-t-il dans le long cou d'une girafe ?", 7),
  c("animaux", 3, "Combien de doigts a un cheval au bout de chaque patte ?", 1),
  c("animaux", 3, "Combien de mois un bébé éléphant reste-t-il dans le ventre de sa maman, environ ?", 22),
  c("animaux", 3, "À combien de km/h peut courir un guépard, environ ?", 110),
  c("animaux", 3, "Combien de pattes a un scorpion, sans compter ses pinces ?", 8),

  // Corps humain
  c("corps", 1, "Combien as-tu de doigts en tout, sur tes deux mains ?", 10),
  c("corps", 1, "Combien as-tu d'orteils sur un pied ?", 5),
  c("corps", 2, "Combien as-tu de doigts et d'orteils en tout ?", 20),
  c("corps", 2, "Combien de dents de lait a un enfant ?", 20),
  c("corps", 2, "Combien avons-nous de sens : la vue, l'ouïe, l'odorat… ?", 5),
  c("corps", 2, "Combien de mois un bébé reste-t-il dans le ventre de sa maman ?", 9),
  c("corps", 2, "Quelle est la température normale du corps humain, en degrés ?", 37),
  c("corps", 3, "Combien de dents a un adulte, dents de sagesse comprises ?", 32),
  c("corps", 3, "Combien d'os y a-t-il dans le squelette d'un adulte ?", 206),
  c("corps", 3, "Combien de litres de sang a un adulte, environ ?", 5),
  c("corps", 3, "Combien de fois le cœur d'un adulte bat-il en une minute, au repos, environ ?", 70),

  // Calendrier et heures
  c("temps", 1, "Combien de jours y a-t-il dans une semaine ?", 7),
  c("temps", 1, "Combien de saisons y a-t-il dans une année ?", 4),
  c("temps", 1, "Combien de jours dure un week-end ?", 2),
  c("temps", 1, "Combien de mois y a-t-il dans une année ?", 12),
  c("temps", 2, "Combien d'heures y a-t-il dans une journée ?", 24),
  c("temps", 2, "Combien de minutes y a-t-il dans une heure ?", 60),
  c("temps", 2, "Combien de jours y a-t-il dans une année, quand elle n'est pas bissextile ?", 365),
  c("temps", 2, "Combien de jours y a-t-il en février, les années normales ?", 28),
  c("temps", 2, "Combien de jours y a-t-il au mois de décembre ?", 31),
  c("temps", 2, "Combien d'années y a-t-il dans un siècle ?", 100),
  c("temps", 3, "Combien de semaines y a-t-il dans une année, environ ?", 52),
  c("temps", 3, "Combien de minutes y a-t-il dans une journée ?", 1440),
  c("temps", 3, "Combien de secondes y a-t-il dans une heure ?", 3600),
  c("temps", 3, "Combien de mois de l'année ont 31 jours ?", 7),
  c("temps", 3, "Tous les combien d'années revient une année bissextile ?", 4),
  c("temps", 3, "Combien d'années y a-t-il dans un millénaire ?", 1000),

  // Espace
  c("espace", 1, "Combien de lunes tournent autour de la Terre ?", 1),
  c("espace", 2, "Combien de planètes tournent autour du Soleil ?", 8),
  c("espace", 2, "Combien d'heures met la Terre pour faire un tour sur elle-même ?", 24),
  c("espace", 2, "Combien de jours met la Terre pour faire le tour du Soleil, environ ?", 365),
  c("espace", 3, "En partant du Soleil, à quelle place est la Terre parmi les planètes ?", 3),
  c("espace", 3, "Combien de lunes a la planète Mars ?", 2),
  c("espace", 3, "En quelle année un astronaute a-t-il marché sur la Lune pour la première fois ?", 1969),
  c("espace", 3, "Combien de minutes met la lumière du Soleil pour arriver sur la Terre, environ ?", 8),
  c("espace", 3, "Combien de kilomètres y a-t-il entre la Terre et la Lune, environ ?", 384000),
  c("espace", 3, "Combien de planètes du système solaire sont plus grandes que la Terre ?", 4),

  // Sport
  c("sport", 2, "Combien de joueurs une équipe de football a-t-elle sur le terrain ?", 11),
  c("sport", 2, "Combien de minutes dure un match de football, sans les prolongations ?", 90),
  c("sport", 2, "Combien de joueurs une équipe de basket a-t-elle sur le terrain ?", 5),
  c("sport", 2, "Combien d'anneaux y a-t-il sur le drapeau des Jeux olympiques ?", 5),
  c("sport", 2, "En quelle année les Jeux olympiques ont-ils eu lieu à Paris, la dernière fois ?", 2024),
  c("sport", 2, "Combien de trous a un parcours de golf complet ?", 18),
  c("sport", 3, "Combien de joueurs une équipe de rugby a-t-elle sur le terrain ?", 15),
  c("sport", 3, "Combien de joueurs une équipe de volley a-t-elle sur le terrain ?", 6),
  c("sport", 3, "Combien de joueurs une équipe de handball a-t-elle sur le terrain ?", 7),
  c("sport", 3, "Combien de mètres mesure le bassin d'une piscine olympique ?", 50),
  c("sport", 3, "Combien de kilomètres fait un marathon, environ ?", 42),
  c("sport", 3, "Tous les combien d'années ont lieu les Jeux olympiques d'été ?", 4),
  c("sport", 3, "Au basket, combien de points vaut un panier marqué de loin, derrière la grande ligne ?", 3),

  // Jeux et nombres
  c("jeux", 1, "Combien de faces a un dé ?", 6),
  c("jeux", 1, "Combien de côtés a un triangle ?", 3),
  c("jeux", 1, "Combien font 5 + 5 + 5 ?", 15),
  c("jeux", 2, "Combien de cases a une grille de morpion ?", 9),
  c("jeux", 2, "Combien de faces a un cube ?", 6),
  c("jeux", 2, "Combien de couleurs y a-t-il dans un jeu de cartes : cœur, carreau… ?", 4),
  c("jeux", 2, "Combien de lettres y a-t-il dans l'alphabet ?", 26),
  c("jeux", 2, "Combien de voyelles y a-t-il dans l'alphabet : a, e, i… ?", 6),
  c("jeux", 2, "Combien de centimètres y a-t-il dans un mètre ?", 100),
  c("jeux", 2, "Combien de grammes y a-t-il dans un kilo ?", 1000),
  c("jeux", 2, "Combien font 7 × 8 ?", 56),
  c("jeux", 3, "Combien de cases a un échiquier ?", 64),
  c("jeux", 3, "Combien de cartes y a-t-il dans un jeu de cartes classique, sans les jokers ?", 52),
  c("jeux", 3, "En additionnant les points de toutes les faces d'un dé, combien obtient-on ?", 21),
  c("jeux", 3, "Combien de côtés a un panneau « STOP » ?", 8),
  c("jeux", 3, "Combien de zéros y a-t-il dans un million ?", 6),
  c("jeux", 3, "Combien font 12 × 12 ?", 144),

  // Musique
  c("musique", 2, "Combien de notes y a-t-il dans la gamme : do, ré, mi… ?", 7),
  c("musique", 2, "Combien de cordes a une guitare classique ?", 6),
  c("musique", 2, "Combien de musiciens jouent dans un quatuor ?", 4),
  c("musique", 3, "Combien de cordes a un violon ?", 4),
  c("musique", 3, "Combien de touches a un piano classique ?", 88),
  c("musique", 3, "Combien de lignes a une portée, où l'on écrit les notes de musique ?", 5),

  // Contes, livres et dessins animés
  c("contes", 1, "Combien de nains vivent avec Blanche-Neige ?", 7),
  c("contes", 1, "Dans le conte, combien y a-t-il de petits cochons ?", 3),
  c("contes", 1, "Combien d'ours Boucle d'or rencontre-t-elle dans la maison de la forêt ?", 3),
  c("contes", 1, "Combien de loups y a-t-il dans « Le Petit Chaperon rouge » ?", 1),
  c("contes", 1, "Combien de petits chatons a Duchesse dans « Les Aristochats » ?", 3),
  c("contes", 2, "Combien de doigts a Mickey à chaque main ?", 4),
  c("contes", 2, "Combien y a-t-il de Tortues Ninja ?", 4),
  c("contes", 2, "Combien de dalmatiens y a-t-il dans le titre du dessin animé de Disney ?", 101),
  c("contes", 2, "Dans « La Reine des neiges », combien de sœurs a Elsa ?", 1),
  c("contes", 2, "Combien de vœux le génie d'Aladdin accorde-t-il ?", 3),
  c("contes", 2, "Combien de méchantes demi-sœurs a Cendrillon ?", 2),
  c("contes", 2, "Combien de coups sonne l'horloge à minuit, quand Cendrillon doit quitter le bal ?", 12),
  c("contes", 2, "Dans « La Belle au bois dormant » de Disney, combien de bonnes fées protègent Aurore ?", 3),
  c("contes", 2, "Dans « Toy Story », combien d'yeux ont les petits extraterrestres verts ?", 3),
  c("contes", 3, "En combien de jours Phileas Fogg fait-il le tour du monde, dans le roman de Jules Verne ?", 80),
  c("contes", 3, "Combien y a-t-il de livres dans l'histoire de Harry Potter ?", 7),
  c("contes", 3, "Combien de Pokémon y avait-il dans le tout premier Pokédex ?", 151),

  // Monde et nature
  c("monde", 1, "Combien de couleurs y a-t-il dans un arc-en-ciel ?", 7),
  c("monde", 1, "Combien de couleurs a le drapeau de la France ?", 3),
  c("monde", 1, "Combien de couleurs a un feu de circulation ?", 3),
  c("monde", 1, "Combien de roues a une voiture, sans la roue de secours ?", 4),
  c("monde", 1, "Combien de roues a un tricycle ?", 3),
  c("monde", 2, "À combien de degrés l'eau se met-elle à bouillir ?", 100),
  c("monde", 2, "À combien de degrés l'eau se transforme-t-elle en glace ?", 0),
  c("monde", 2, "Combien de branches a un flocon de neige ?", 6),
  c("monde", 2, "Combien de chiffres a un numéro de téléphone portable en France ?", 10),
  c("monde", 2, "Combien de minutes faut-il pour cuire un œuf à la coque, environ ?", 3),
  c("monde", 3, "Combien mesure la tour Eiffel, environ, en mètres ?", 330),
  c("monde", 3, "En quelle année a eu lieu la prise de la Bastille ?", 1789),
  c("monde", 3, "Combien d'étoiles y a-t-il sur le drapeau de l'Union européenne ?", 12),
  c("monde", 3, "Combien d'étoiles y a-t-il sur le drapeau des États-Unis ?", 50),
];

/** Une question convient à [age] si l'âge est dans sa tranche ; sans âge, toutes conviennent. */
export const chiffreConvient = (x, age) => !Number.isFinite(age) || (age >= x.ageMin && age <= x.ageMax);

/**
 * Tire [n] questions au hasard : du [theme] s'il est donné, pour [age] s'il est donné, jamais une question dont le
 * texte est dans [exclus]. Pour varier, on évite d'abord deux fois la même réponse (ou le même émoji, pour celles qui
 * en ont) ; s'il n'y en a pas assez, on complète avec les autres. Marche aussi sur un mélange de Juste Chiffre et de
 * questions à 4 réponses ([liste]). Fonction pure (à [rng] près), testée.
 */
export function tirerChiffres(n, { theme = null, age = null, exclus = new Set(), rng = Math.random, liste = QUESTIONS_CHIFFRES } = {}) {
  const libres = liste.filter((x) => (!theme || x.theme === theme) && chiffreConvient(x, age) && !exclus.has(x.text));
  for (let i = libres.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [libres[i], libres[j]] = [libres[j], libres[i]];
  }
  const emojis = new Set();
  const reponses = new Set();
  const pris = [];
  for (const x of libres) {
    if (pris.length >= n) break;
    const reponse = x.choices?.length ? `t:${x.choices[0]}` : `n:${x.correct}`;
    if ((x.emoji && emojis.has(x.emoji)) || reponses.has(reponse)) continue;
    if (x.emoji) emojis.add(x.emoji);
    reponses.add(reponse);
    pris.push(x);
  }
  for (const x of libres) {
    if (pris.length >= n) break;
    if (!pris.includes(x)) pris.push(x);
  }
  return pris;
}
