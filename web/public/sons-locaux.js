// Chansons entières gardées sur ce PC (cedric, 21/10) : chaque chanson est rangée en entier en ligne
// (library/entieres) pour que les curseurs « Début de la chanson » et « Hook » marchent depuis n'importe quel PC.
// Ce cache du navigateur (IndexedDB), rangé par chanson, évite de la retélécharger à chaque ouverture. Si le
// navigateur refuse (navigation privée, disque plein), rien d'autre ne change : la chanson est retéléchargée.

const BASE = "lmp-chansons";
const TABLE = "fichiers";
let ouverture = null;
let persistance = false;

function ouvrir() {
  ouverture ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(BASE, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(TABLE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => { ouverture = null; throw e; });
  return ouverture;
}

/** Une opération sur la table, dans sa propre transaction ; rend le résultat de la requête. */
async function operation(mode, action) {
  const db = await ouvrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TABLE, mode);
    const req = action(tx.objectStore(TABLE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? req.error);
  });
}

/** Garde sur ce PC le fichier d'une chanson de la bibliothèque ; rend vrai si c'est fait. */
export async function garderFichier(songId, fichier) {
  if (!songId || typeof Blob === "undefined" || !(fichier instanceof Blob)) return false;
  try {
    // Le navigateur ne vide pas ces fichiers de lui-même quand le disque se remplit (s'il l'accepte).
    if (!persistance) { persistance = true; navigator.storage?.persist?.().catch(() => {}); }
    await operation("readwrite", (t) => t.put({ fichier, nom: fichier.name ?? "", taille: fichier.size, le: Date.now() }, songId));
    return true;
  } catch (e) {
    console.warn("Chanson pas gardée sur ce PC", e);
    return false;
  }
}

/** Le fichier gardé sur ce PC pour la chanson [songId], ou null. */
export async function fichierGarde(songId) {
  if (!songId || typeof indexedDB === "undefined") return null;
  try {
    const x = await operation("readonly", (t) => t.get(songId));
    return x?.fichier instanceof Blob ? x.fichier : null;
  } catch (e) {
    console.warn("Chanson gardée illisible", e);
    return null;
  }
}

/** Oublie sur ce PC le fichier de la chanson [songId] (chanson effacée pour de bon). */
export async function oublierFichier(songId) {
  if (!songId || typeof indexedDB === "undefined") return;
  try {
    await operation("readwrite", (t) => t.delete(songId));
  } catch (e) {
    console.warn("Chanson gardée pas oubliée", e);
  }
}
