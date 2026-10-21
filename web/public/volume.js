// Volume d'une chanson (cedric, 21/10 : le hook doit tomber sur le vrai refrain, « là où ça explose ») : la Régie PC
// mesure le volume du MP3 toutes les demi-secondes, puis cherche le moment où la musique devient forte. Fonctions
// pures : le décodage du fichier se fait dans admin.js.

/** Pas de la mesure du volume (secondes). */
export const PAS_VOLUME = 0.5;

/** Montée de volume (dB) qui fait « exploser » une chanson. */
const MONTEE = 3;
/** Durée (secondes) du passage fort qui suit l'explosion. */
const FORT = 8;

/**
 * Volume (dB, pleine échelle, -90 au plus bas) de chaque pas de [pas] secondes d'un son : [canaux], un Float32Array par
 * canal, à [rate] échantillons par seconde.
 */
export function volumes(canaux, rate, pas = PAS_VOLUME) {
  const taille = Math.max(1, Math.floor(rate * pas));
  const n = Math.floor((canaux[0]?.length ?? 0) / taille);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let somme = 0;
    for (const c of canaux) for (let j = i * taille; j < (i + 1) * taille; j++) somme += c[j] * c[j];
    const rms = Math.sqrt(somme / (taille * canaux.length));
    out[i] = Math.round(Math.max(-90, 20 * Math.log10(rms + 1e-9)) * 10) / 10;
  }
  return out;
}

/** Volume moyen (dB) de [db] entre [de] et [a] secondes ; -90 hors du son. */
function moyenne(db, de, a, pas) {
  const i0 = Math.max(0, Math.round(de / pas));
  const i1 = Math.min(db.length, Math.round(a / pas));
  if (i1 <= i0) return -90;
  let s = 0;
  for (let i = i0; i < i1; i++) s += db[i];
  return s / (i1 - i0);
}

/** Montée du volume à [t] secondes : les 2 s qui suivent comparées aux 3 s qui précèdent. */
const montee = (db, t, pas) => moyenne(db, t, t + 2, pas) - moyenne(db, t - 3, t, pas);

/** Le moment de plus forte montée entre [de] et [a] secondes (au pas près), et cette montée. */
function plusForteMontee(db, de, a, pas) {
  let best = null;
  for (let t = Math.max(0, de); t <= a; t += pas) {
    const m = montee(db, t, pas);
    if (!best || m > best.m) best = { t, m };
  }
  return best;
}

/**
 * Moment où la chanson explose (secondes), d'après son seul volume, ou null : le début d'un passage fort (8 s parmi les
 * plus fortes de la chanson) juste après une montée nette, entre [min] et [max] secondes. Le premier des plus marqués.
 */
export function explosionDuVolume(db, { min = 0, max = Infinity, pas = PAS_VOLUME } = {}) {
  const duree = (db?.length ?? 0) * pas;
  const fin = Math.min(max, duree - FORT);
  if (duree < 30 || fin <= min) return null;
  // Les passages les plus forts de la chanson : les 8 s qui suivent chaque moment, triées.
  const forts = [];
  for (let t = 0; t + FORT <= duree; t += pas) forts.push(moyenne(db, t, t + FORT, pas));
  const haut = [...forts].sort((a, b) => a - b)[Math.floor(forts.length * 0.85)];
  const candidats = [];
  for (let t = Math.max(min, 3); t <= fin; t += pas) {
    const m = montee(db, t, pas);
    const fort = moyenne(db, t, t + FORT, pas);
    if (m >= MONTEE && fort >= haut - 2) candidats.push({ t, note: fort + m });
  }
  if (!candidats.length) return null;
  const meilleure = Math.max(...candidats.map((c) => c.note));
  // Le premier passage presque aussi marqué que le plus marqué, calé sur sa montée la plus nette.
  const premier = candidats.find((c) => c.note >= meilleure - 1.5);
  return plusForteMontee(db, premier.t - 1, premier.t + 1, pas).t;
}

/**
 * Le refrain trouvé dans les paroles, vérifié au volume (secondes) : [fois], les moments où le refrain est chanté.
 * 1. La première fois qui sonne presque aussi fort que la plus forte (un premier refrain chanté doucement est sauté).
 * 2. Si la musique explose un peu plus loin (un pré-refrain calme pris pour le refrain), le moment de l'explosion.
 * 3. Sinon, la montée juste avant les mots s'il y en a une, ou 1 s avant les mots.
 */
export function refrainAuVolume(db, fois, { pas = PAS_VOLUME } = {}) {
  if (!fois?.length) return null;
  if (!db?.length) return Math.max(0, fois[0] - 1);
  const fort = (t) => moyenne(db, t, t + FORT, pas);
  const plusFort = Math.max(...fois.map(fort));
  const c = fois.find((t) => fort(t) >= plusFort - 1.5) ?? fois[0];
  // Le refrain explose plus loin : le passage qui suit sonne bien plus fort que celui des paroles.
  const plusLoin = plusForteMontee(db, c + 2, c + 16, pas);
  if (plusLoin && plusLoin.m >= MONTEE && fort(plusLoin.t) >= fort(c) + MONTEE) return Math.max(0, plusLoin.t - 0.5);
  const avant = plusForteMontee(db, c - 3, c + 0.5, pas);
  if (avant && avant.m >= MONTEE) return Math.max(0, avant.t - 0.5);
  return Math.max(0, c - 1);
}
