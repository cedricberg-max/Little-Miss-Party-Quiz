// Images bonnes pour le mime (cedric, 24/10 : « pour les tout-petits, des mots extrêmement simples, une voiture, une
// maison… reconnaissables très facilement avec un geste compréhensible d'enfant »). Chaque mot de la banque des
// tout-petits qu'on peut mimer a un niveau : 1 = Petits (un geste évident), 2 = Moyens (il faut un peu d'idée),
// 3 = Grands (plus dur à faire deviner). Les mots qu'on ne mime pas (une règle, un poireau, le nez…) n'en ont pas :
// le 🎲 des Mimes ne les tire jamais. Les émojis des cartes de mimes gardent leur niveau (facile = Petits, sinon
// Moyens). Invisible ailleurs ; la fiche d'une image le montre (« 🎭 Mime : Petits (6 à 8 ans) »).
import { MIME_CATALOG } from "./mime-cards.js";

const PETITS = `
  Chat, Chien, Vache, Cochon, Cheval, Poule, Canard, Lapin, Lion, Éléphant, Girafe, Singe, Gorille, Ours, Crocodile,
  Serpent, Grenouille, Tortue, Kangourou, Manchot, Oiseau, Escargot, Papillon, Abeille, Araignée, Poisson, Requin, Crabe,
  Banane, Pomme, Glace, Pizza, Gâteau, Sucette, Hamburger, Soupe,
  Voiture, Vélo, Moto, Trottinette, Train, Bus, Avion, Hélicoptère, Fusée, Bateau,
  Maison, Lit, Téléphone, Appareil photo, Parapluie, Ballon, Ours en peluche, Livre, Ciseaux, Brosse à dents, Peigne,
  Douche, Balai,
  Lunettes, Couronne,
  Pluie, Bonhomme de neige, Arbre, Fleur,
  Guitare, Piano, Tambour, Trompette, Micro,
  Robot, Bulles de savon, Corde à sauter, Balançoire, Toboggan, Trampoline,
  Ballon de basket, Piscine, But de foot,
  Marteau`;

const MOYENS = `
  Mouton, Coq, Souris, Poussin, Tigre, Panda, Koala, Loup, Écureuil, Chameau, Hippopotame, Rhinocéros, Phoque, Hibou,
  Aigle, Perroquet, Flamant rose, Autruche, Chauve-souris, Coccinelle, Mouche, Moustique, Chenille, Baleine, Dauphin,
  Pieuvre, Cerf,
  Carotte, Citron, Pastèque, Œuf, Pain, Bonbon, Chocolat, Frites, Pâtes, Pop-corn, Crêpe, Barbe à papa, Lait,
  Taxi, Voiture de police, Ambulance, Camion, Camion de pompiers, Tracteur, Pelleteuse, Poussette, Skateboard, Canoë,
  Sous-marin,
  Clé, Porte, Chaise, Lampe, Ordinateur, Télévision, Horloge, Bougie, Cadeau, Ballon de fête, Cerf-volant, Cartable,
  Crayon, Pinceau, Gomme, Cuillère, Fourchette, Tasse, Poêle, Dentifrice, Savon, Serviette, Baignoire, Miroir,
  Aspirateur, Oreiller,
  Chapeau, Casquette, Chaussure, Bottes, Chaussette, Bonnet, Gants, Écharpe, Pyjama, Maillot de bain, Lunettes de soleil,
  Montre,
  Soleil, Neige, Feu, Volcan, Éclair, Étoile, Arc-en-ciel, Montagne, Mer, Plage, Sapin, Cactus, Glaçon,
  Violon, Flûte, Maracas, Tambourin, Xylophone, Accordéon,
  Poupée, Marionnette, Toupie, Yo-yo, Puzzle, Cubes, Dé, Cartes à jouer, Pâte à modeler, Château de sable, Manège,
  Masque, Feux d'artifice, Piñata,
  Ballon de rugby, Raquette, Balle de tennis, Skis, Luge, Patins à glace, Rollers, Planche de surf, Médaille, Coupe,
  Scie, Tournevis, Échelle, Pelle, Arrosoir, Brouette, Lampe de poche, Loupe,
  Moulin à vent`;

const GRANDS = `
  Chèvre, Âne, Dinde, Oie, Lama, Zèbre, Ours blanc, Lézard, Renard, Hérisson, Sanglier, Castor, Pigeon, Cygne, Paon,
  Libellule, Fourmi, Sauterelle, Ver de terre, Poisson-clown, Méduse, Étoile de mer, Hippocampe, Homard, Crevette,
  Tortue de mer,
  Ananas, Noix de coco, Petits pois, Fromage, Miel, Céréales, Gaufre, Sandwich, Saucisse, Eau, Jus d'orange,
  Camping-car, Métro, Montgolfière, Paquebot,
  Stylo, Feutres, Verre, Casserole, Réfrigérateur, Four, Machine à laver, Poubelle, Robinet, Seau, Canapé, Fenêtre,
  Panier, Boîte aux lettres,
  Robe, Pull, Manteau, Cravate, Ceinture, Sac à main, Collier, Pantalon, T-shirt, Jupe, Short, Sandales, Pantoufles,
  Lune, Nuage, Cascade, Rivière, Rose, Tournesol, Feuille, Désert, Île, Coquillage, Plume, Nid, Toile d'araignée, Forêt,
  Harpe, Triangle, Saxophone,
  Billes, Chapeau de fête, Guirlande, Confettis,
  Râteau, Tondeuse, Cadenas, Aimant, Clé à molette,
  Château, Cabane, Tente, Igloo, Phare, Pont, Tour Eiffel, Gratte-ciel, Magasin, École, Hôpital, Ferme`;

/** Niveaux de mime : 1 = Petits, 2 = Moyens, 3 = Grands. */
export const NIVEAUX_MIME = { 1: "Petits (6 à 8 ans)", 2: "Moyens (9 à 11 ans)", 3: "Grands (12 ans et plus)" };

const liste = (bloc) => bloc.split(",").map((x) => x.trim()).filter(Boolean);
/** Mot de la banque des tout-petits → son niveau de mime. */
export const MIMES_BANQUE = new Map([...liste(PETITS).map((m) => [m, 1]), ...liste(MOYENS).map((m) => [m, 2]), ...liste(GRANDS).map((m) => [m, 3])]);
// Cartes de mimes en émoji : faciles pour les Petits, les autres pour les Moyens.
const MIMES_CARTES = new Map(MIME_CATALOG.map((c) => [c.word, c.level === 1 ? 1 : 2]));

/** Niveau de mime d'un mot (banque des tout-petits d'abord, puis cartes de mimes), ou 0 si on ne le mime pas. */
export const niveauMime = (mot) => MIMES_BANQUE.get(mot) ?? MIMES_CARTES.get(mot) ?? 0;

/**
 * Niveaux que le 🎲 des Mimes tire pour un profil d'âge, du préféré au moins préféré : les Petits n'ont que les
 * leurs ; les Moyens les leurs puis ceux des Petits ; les Grands et les Adultes les leurs, puis Moyens, puis Petits.
 * Neutre (tous âges) : tous, mélangés.
 */
export function niveauxPourProfil(profil) {
  if (profil === "PETITS") return [[1]];
  if (profil === "MOYENS") return [[2], [1]];
  if (profil === "GRANDS" || profil === "ADULTES") return [[3], [2], [1]];
  return [[1, 2, 3]];
}

/** Ce qu'affiche la fiche d'une image bonne pour le mime ; rien sinon. */
export const etiquetteMime = (mot) => (niveauMime(mot) ? `🎭 Mime : ${NIVEAUX_MIME[niveauMime(mot)]}` : "");
