// Nettoyage des copies des fêtes terminées (Régie PC, cedric, 21/10). Au lancement d'une prestation, la régie copie dans
// la partie (games/<code>/sounds, images, choiceImages, songs) les extraits, les photos et les chansons entières des
// statues musicales (copiées par la régie téléphone) dont la TV a besoin ; la TV les garde
// ensuite sur la box. Une fois la fête finie, ces copies ne servent plus : elles s'effacent toutes seules 24 h après la
// fin définitive notée par la TV, à la première ouverture de la Régie PC après ce délai, jamais avant. Seul l'état de la
// partie compte, jamais la date ni l'archivage de la prestation. Rien d'autre n'est touché : bibliothèque, prestations,
// scores et journaux des parties restent. Fonctions pures (testées dans importer.test.js) ; les règles Firebase refont
// la même vérification côté serveur.

/** Fête terminée par « Nouvelle partie » sur la TV (heure de fin notée) : copies effacées 24 h après. */
export const APRES_FIN_MS = 24 * 3600_000;
/** Fête terminée sans heure de fin (programme joué jusqu'au bout) : 48 h après la création de la partie. */
export const APRES_CREATION_MS = 48 * 3600_000;
/** Marge pour l'horloge : le serveur doit lui aussi trouver la partie assez ancienne, sinon il refuse. */
export const MARGE_MS = 5 * 60_000;
/** Un passage automatique par heure au plus, à l'ouverture de la Régie PC. */
export const UNE_HEURE_MS = 3600_000;

/**
 * Taille moyenne d'une copie, en Mo (aucun outil ne donne la vraie taille d'un nœud de la base) :
 * - extrait : 30 s de MP3 mono à 96 kbit/s ≈ 0,48 Mo une fois en base64, refrain de 90 s ≈ 0,84 Mo (SOUND_BUDGET
 *   880 000 caractères), statues jusqu'à 90 s : environ 0,6 Mo en moyenne ;
 * - photo d'illustration : 110 000 caractères au plus (IMAGE_BUDGET), photo de la banque ≈ 60 Ko : environ 0,08 Mo ;
 * - photo d'une réponse ou d'une carte : 45 000 caractères au plus (CHOICE_IMAGE) : environ 0,045 Mo ;
 * - chanson entière des statues musicales (games/<code>/songs/<songId>, en morceaux) : 3 min 30 de MP3 à 96 kbit/s
 *   ≈ 2,5 Mo, environ 3,4 Mo en base64.
 */
export const MO_MOYEN = { sounds: 0.6, images: 0.08, choiceImages: 0.045, songs: 3.4 };

export const DOSSIERS = ["sounds", "images", "choiceImages", "songs"];

/** Raisons affichées dans la vérification, par clé (la clé va dans le journal). */
export const RAISONS = {
  fin: "Terminée depuis plus de 24 h",
  creation: "Terminée sans heure de fin, créée il y a plus de 48 h",
  enCours: "Partie en cours ou interrompue : elle peut encore être reprise",
  recente: "Terminée depuis moins de 24 h",
  recenteSansFin: "Terminée sans heure de fin, créée il y a moins de 48 h",
  sansDate: "Terminée sans date lisible : gardée par prudence",
  sansCopie: "Aucune copie à effacer",
  codeInconnu: "Code de partie inattendu : gardée par prudence",
};

/** Pourquoi des copies sont gardées, en quelques mots (journal des passages), par clé. */
export const GARDEES = {
  enCours: "partie en cours ou interrompue",
  recente: "terminée depuis moins de 24 h",
  recenteSansFin: "terminée sans heure de fin, depuis moins de 48 h",
  sansDate: "terminée sans date lisible",
  codeInconnu: "code de partie inattendu",
  orphelins: "chanson plus dans la bibliothèque",
};

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
/** « 2 extraits gardés : la chanson n'est plus dans la bibliothèque » : ces copies-là ne se referaient pas. */
export const extraitsGardes = (n) => `${pluriel(n, "extrait gardé", "extraits gardés")} : la chanson n'est plus dans la bibliothèque`;
/** Photos absentes de la bibliothèque : photos de la banque du site ou émojis dessinés, refaits à chaque lancement. */
export const photosDuSite = (n) => `${pluriel(n, "photo de la banque du site ou émoji dessiné", "photos de la banque du site ou émojis dessinés")} : refaits au prochain lancement`;

const ID = /^[0-9a-f]{16}$/;
/** Clé d'une chanson de la bibliothèque (library/songs). */
const SONG_ID = /^[A-Za-z0-9_-]{1,40}$/;
/** Code d'une partie que le journal accepte (règles : maintenance/nettoyages). */
export const CODE_PARTIE = /^[A-Za-z0-9]{1,12}$/;

const liste = (x) => [...new Set((Array.isArray(x) ? x : []).filter((id) => typeof id === "string"))];
const compte = (copies) => DOSSIERS.reduce((n, d) => n + copies[d].length, 0);
/** Taille estimée (Mo) de copies { sounds, images, choiceImages, songs }. */
export const moDe = (copies) => DOSSIERS.reduce((mo, d) => mo + (copies[d]?.length ?? 0) * MO_MOYEN[d], 0);

/**
 * Décision pour une partie : { decision: "nettoyer" | "garder", cle, raison, effacer, gardes, notes, mo, prochain }.
 * [partie] : { code, phase, endedAt, createdAt, sounds, images, choiceImages, songs } (identifiants des copies
 * seulement) ; [maintenant] : heure du serveur ; [bibliotheque] : { sounds: Set, images: Set, songs: Set } des originaux
 * présents. Effacées seulement : les copies d'une fête terminée depuis assez longtemps, que le prochain lancement refera
 * (extrait encore dans library/sounds ; photo de la bibliothèque, ou de la banque du site, ou émoji dessiné ; chanson
 * encore dans library/songs). [prochain] : heure
 * à laquelle une fête terminée deviendra bonne à nettoyer (null sinon). [mo] : ce qui serait libéré.
 */
export function classerPartie(partie, { maintenant, bibliotheque }) {
  const copies = Object.fromEntries(DOSSIERS.map((d) => [d, liste(partie?.[d])]));
  const vide = { sounds: [], images: [], choiceImages: [], songs: [] };
  const garder = (cle, extra = {}) => ({ decision: "garder", cle, raison: RAISONS[cle], copies, effacer: vide, gardes: [], notes: [], mo: 0, prochain: null, ...extra });
  if (!compte(copies)) return garder("sansCopie");
  if (!CODE_PARTIE.test(partie?.code ?? "")) return garder("codeInconnu");
  // Seule la fin notée par la TV compte : une prestation archivée ou dont la date est passée ne suffit jamais.
  if (partie.phase !== "ended") return garder("enCours");
  const finNotee = typeof partie.endedAt === "number";
  const echeance = finNotee ? partie.endedAt + APRES_FIN_MS
    : partie.endedAt == null && typeof partie.createdAt === "number" ? partie.createdAt + APRES_CREATION_MS : null;
  if (echeance === null) return garder("sansDate");
  if (maintenant < echeance + MARGE_MS) return garder(finNotee ? "recente" : "recenteSansFin", { prochain: echeance + MARGE_MS });
  // Assez ancienne : seulement les copies qu'un prochain lancement refera à partir des originaux.
  const sons = bibliotheque?.sounds ?? new Set();
  const images = bibliotheque?.images ?? new Set();
  const chansons = bibliotheque?.songs ?? new Set();
  const effacer = {
    sounds: copies.sounds.filter((id) => ID.test(id) && sons.has(id)),
    images: copies.images.filter((id) => ID.test(id)),
    choiceImages: copies.choiceImages.filter((id) => ID.test(id)),
    songs: copies.songs.filter((id) => SONG_ID.test(id) && chansons.has(id)),
  };
  // Extraits et chansons entières dont la chanson a quitté la bibliothèque : gardés (le seul exemplaire qui reste).
  const gardes = [...copies.sounds.filter((id) => !effacer.sounds.includes(id)), ...copies.songs.filter((id) => !effacer.songs.includes(id))];
  const duSite = [...effacer.images, ...effacer.choiceImages].filter((id) => !images.has(id)).length;
  const notes = [...(gardes.length ? [extraitsGardes(gardes.length)] : []), ...(duSite ? [photosDuSite(duSite)] : [])];
  if (!compte(effacer)) return garder("orphelins", { raison: extraitsGardes(gardes.length), gardes });
  const cle = finNotee ? "fin" : "creation";
  return { decision: "nettoyer", cle, raison: RAISONS[cle], copies, effacer, gardes, notes, mo: moDe(effacer), prochain: null };
}

/**
 * Bilan d'un passage : nombre de parties, à nettoyer, copies à effacer, Mo libérés (environ), parties gardées par raison
 * (dans l'ordre de RAISONS), extraits gardés faute d'original, copies gardées par clé de raison (pour le journal), et la
 * prochaine fête qui deviendra bonne à nettoyer.
 */
export function bilan(resultats) {
  const aNettoyer = resultats.filter((r) => r.decision === "nettoyer");
  const gardees = new Map();
  for (const r of resultats) if (r.decision === "garder") gardees.set(r.raison, (gardees.get(r.raison) ?? 0) + 1);
  const ordre = Object.values(RAISONS);
  const rang = (raison) => (ordre.includes(raison) ? ordre.indexOf(raison) : ordre.length);
  const prochains = resultats.map((r) => r.prochain).filter((t) => typeof t === "number");
  const copiesGardees = {};
  const garder = (cle, n) => { if (n) copiesGardees[cle] = (copiesGardees[cle] ?? 0) + n; };
  for (const r of resultats) {
    if (r.decision === "nettoyer") garder("orphelins", r.gardes.length);
    else if (r.cle !== "sansCopie") garder(r.cle, compte(r.copies));
  }
  return {
    parties: resultats.length,
    aNettoyer: aNettoyer.length,
    copiesAEffacer: aNettoyer.reduce((n, r) => n + compte(r.effacer), 0),
    mo: aNettoyer.reduce((mo, r) => mo + r.mo, 0),
    copiesGardees,
    gardees: [...gardees].sort(([a], [b]) => rang(a) - rang(b)),
    extraitsGardes: resultats.reduce((n, r) => n + r.gardes.length, 0),
    prochain: prochains.length ? Math.min(...prochains) : null,
  };
}

/** Effacements d'une partie, en une seule écriture : { "games/<code>/sounds/<id>": null, … }. */
export function effacements(code, effacer) {
  return Object.fromEntries(DOSSIERS.flatMap((d) => (effacer[d] ?? []).map((id) => [`games/${code}/${d}/${id}`, null])));
}

/** Passage automatique à faire à l'ouverture de la Régie PC ? Une fois par heure au plus. */
export function passageAFaire(dernier, maintenant) {
  return typeof dernier?.at !== "number" || maintenant - dernier.at >= UNE_HEURE_MS;
}

/** Copies gardées d'un passage du journal, en clair : « 2 (partie en cours ou interrompue), 1 (chanson …) ». */
export function texteGardees(gardees) {
  return Object.entries(gardees ?? {}).filter(([cle, n]) => GARDEES[cle] && n > 0)
    .sort(([a], [b]) => Object.keys(GARDEES).indexOf(a) - Object.keys(GARDEES).indexOf(b))
    .map(([cle, n]) => `${n} (${GARDEES[cle]})`).join(", ");
}

/** « 2,1 Mo » (au dixième ; « moins de 0,1 Mo » plutôt que « 0 Mo » quand il y a quelque chose). */
export function texteMo(mo) {
  if (mo > 0 && mo < 0.05) return "moins de 0,1 Mo";
  return `${(Math.round(mo * 10) / 10).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mo`;
}
