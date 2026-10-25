/**
 * Lecture d'un fichier ZIP dans le navigateur, sans bibliothèque ni service extérieur (cedric, 25/10 : « je dépose un
 * seul ZIP dans la Régie »). Seuls les fichiers rangés tels quels ou compressés de la façon habituelle (« deflate »)
 * sont lus ; la décompression passe par le navigateur (DecompressionStream). Rien du ZIP n'est exécuté : on n'en tire
 * que des octets. Les chemins dangereux (« .. », chemin absolu, lecteur « C: ») sont refusés, les fichiers cachés des
 * systèmes (__MACOSX, .DS_Store, Thumbs.db) laissés de côté. Toute erreur est une Error au message en français.
 */

/** Limites raisonnables d'une archive de pack. */
export const LIMITES_ZIP = {
  /** Taille du fichier ZIP. */
  zip: 150 * 1024 * 1024,
  /** Fichiers dans l'archive (dossiers non comptés). */
  fichiers: 500,
  /** Taille d'un fichier une fois décompressé. */
  fichier: 30 * 1024 * 1024,
  /** Taille de tous les fichiers décompressés. */
  total: 300 * 1024 * 1024,
};

const Mo = (n) => `${Math.round(n / 1024 / 1024)} Mo`;

/** Les 128 caractères hauts de la page de code des anciens ZIP de Windows (noms sans le drapeau UTF-8). */
const CP437 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

function nomDuFichier(octets, utf8) {
  if (utf8) return new TextDecoder("utf-8").decode(octets);
  // Sans drapeau : de l'UTF-8 quand même (macOS, 7-Zip récents), sinon l'ancienne page de code de Windows.
  try { return new TextDecoder("utf-8", { fatal: true }).decode(octets); } catch { /* page de code */ }
  return [...octets].map((b) => (b < 128 ? String.fromCharCode(b) : CP437[b - 128])).join("");
}

/** Fichier d'un système, jamais un contenu : dossier __MACOSX, .DS_Store, Thumbs.db, desktop.ini, fichiers « ._ ». */
export function estFichierSysteme(chemin) {
  const parts = chemin.split("/");
  const nom = parts[parts.length - 1];
  return parts.some((p) => p === "__MACOSX") || /^(\.ds_store|thumbs\.db|desktop\.ini)$/i.test(nom) || nom.startsWith("._");
}

/** Chemin propre (« / » partout), ou null s'il sort de l'archive. */
export function cheminSur(brut) {
  const chemin = `${brut ?? ""}`.replace(/\\/g, "/");
  if (!chemin || chemin.startsWith("/") || /^[a-z]:/i.test(chemin) || chemin.includes("\0")) return null;
  const parts = chemin.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) return null;
  return parts.join("/");
}

async function inflater(octets, attendu) {
  const flux = new Blob([octets]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const lecteur = flux.getReader();
  const morceaux = [];
  let n = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    n += value.length;
    // Jamais plus que la taille annoncée : une archive piégée ne remplit pas la mémoire.
    if (n > attendu) { await lecteur.cancel(); throw new Error("Un fichier du ZIP est abîmé (taille différente de celle annoncée)."); }
    morceaux.push(value);
  }
  const out = new Uint8Array(n);
  let k = 0;
  for (const m of morceaux) { out.set(m, k); k += m.length; }
  return out;
}

/**
 * Fichiers d'un ZIP ([donnees] : Blob, File, ArrayBuffer ou Uint8Array). Renvoie une liste
 * `{ chemin, nom, taille, lire() }` (lire → Uint8Array), sans dossiers ni fichiers systèmes.
 */
export async function lireZip(donnees, limites = LIMITES_ZIP) {
  const taille = donnees?.size ?? donnees?.byteLength ?? 0;
  if (!taille) throw new Error("Le fichier ZIP est vide.");
  if (taille > limites.zip) throw new Error(`Le ZIP fait ${Mo(taille)} : ${Mo(limites.zip)} au plus.`);
  const tampon = donnees instanceof Uint8Array ? donnees
    : new Uint8Array(donnees instanceof ArrayBuffer ? donnees : await donnees.arrayBuffer());
  const vue = new DataView(tampon.buffer, tampon.byteOffset, tampon.byteLength);
  const u16 = (o) => vue.getUint16(o, true);
  const u32 = (o) => vue.getUint32(o, true);

  // Fin du répertoire central : cherchée depuis la fin (un commentaire de 64 Ko au plus peut la suivre).
  let fin = -1;
  for (let o = tampon.length - 22; o >= Math.max(0, tampon.length - 22 - 65535); o--) {
    if (u32(o) === 0x06054b50) { fin = o; break; }
  }
  if (fin < 0) throw new Error("Ce fichier n'est pas un ZIP lisible. Recréez-le (clic droit › Compresser) et réessayez.");
  const nombre = u16(fin + 10);
  const tailleRep = u32(fin + 12);
  const debutRep = u32(fin + 16);
  if (nombre === 0xffff || debutRep === 0xffffffff) throw new Error("Ce ZIP est trop gros (format ZIP64) : faites un pack plus petit.");
  if (debutRep + tailleRep > tampon.length) throw new Error("Ce ZIP est incomplet : téléchargez-le de nouveau.");

  const fichiers = [];
  const vus = new Set();
  let total = 0;
  let o = debutRep;
  for (let i = 0; i < nombre; i++) {
    if (o + 46 > tampon.length || u32(o) !== 0x02014b50) throw new Error("Ce ZIP est abîmé : téléchargez-le de nouveau.");
    const drapeaux = u16(o + 8);
    const methode = u16(o + 10);
    const compresse = u32(o + 20);
    const decompresse = u32(o + 24);
    const lNom = u16(o + 28), lExtra = u16(o + 30), lComm = u16(o + 32);
    const local = u32(o + 42);
    const brut = nomDuFichier(tampon.subarray(o + 46, o + 46 + lNom), (drapeaux & 0x800) !== 0);
    o += 46 + lNom + lExtra + lComm;
    if (brut.endsWith("/") || brut.endsWith("\\")) continue;
    const chemin = cheminSur(brut);
    if (chemin === null) throw new Error(`Le ZIP contient un chemin refusé (« ${brut} ») : recréez-le à partir du dossier du pack.`);
    if (!chemin || estFichierSysteme(chemin) || vus.has(chemin)) continue;
    if (drapeaux & 0x1) throw new Error("Ce ZIP est protégé par un mot de passe : recréez-le sans mot de passe.");
    if (methode !== 0 && methode !== 8) throw new Error(`« ${chemin} » est compressé d'une façon inconnue : recréez le ZIP (clic droit › Compresser).`);
    if (compresse === 0xffffffff || decompresse === 0xffffffff) throw new Error("Ce ZIP est trop gros (format ZIP64) : faites un pack plus petit.");
    if (decompresse > limites.fichier) throw new Error(`« ${chemin} » fait ${Mo(decompresse)} : ${Mo(limites.fichier)} au plus par fichier.`);
    total += decompresse;
    if (total > limites.total) throw new Error(`Le ZIP contient plus de ${Mo(limites.total)} une fois ouvert : faites un pack plus petit.`);
    if (fichiers.length >= limites.fichiers) throw new Error(`Le ZIP contient plus de ${limites.fichiers} fichiers : faites un pack plus petit.`);
    if (local + 30 > tampon.length || u32(local) !== 0x04034b50) throw new Error("Ce ZIP est abîmé : téléchargez-le de nouveau.");
    const debut = local + 30 + u16(local + 26) + u16(local + 28);
    if (debut + compresse > tampon.length) throw new Error("Ce ZIP est incomplet : téléchargez-le de nouveau.");
    vus.add(chemin);
    const octets = tampon.subarray(debut, debut + compresse);
    fichiers.push({
      chemin, nom: chemin.split("/").pop(), taille: decompresse,
      lire: async () => {
        if (methode === 0) return octets.slice();
        if (typeof DecompressionStream === "undefined") throw new Error("Ce navigateur ne sait pas ouvrir les ZIP : utilisez Chrome ou Edge à jour.");
        const out = await inflater(octets, decompresse);
        if (out.length !== decompresse) throw new Error(`« ${chemin} » est abîmé dans le ZIP : téléchargez-le de nouveau.`);
        return out;
      },
    });
  }
  return fichiers;
}

/**
 * Comme lireZip, en ouvrant aussi les ZIP rangés dans le ZIP (cedric, 25/10 : ChatGPT livre parfois « une archive qui
 * contient 7 archives »), sur un seul niveau : « quiz-facile.zip » devient le dossier « quiz-facile/ ». Les limites
 * valent pour le tout ; un ZIP dans un ZIP intérieur n'est pas ouvert (laissé de côté comme un fichier inconnu).
 */
export async function lireZipEtSesZip(donnees, limites = LIMITES_ZIP) {
  const fichiers = [];
  const vus = new Set();
  let total = 0;
  const ajouter = (f) => {
    if (vus.has(f.chemin)) return;
    total += f.taille;
    if (total > limites.total) throw new Error(`Le ZIP contient plus de ${Mo(limites.total)} une fois ouvert : faites un pack plus petit.`);
    if (fichiers.length >= limites.fichiers) throw new Error(`Le ZIP contient plus de ${limites.fichiers} fichiers : faites un pack plus petit.`);
    vus.add(f.chemin);
    fichiers.push(f);
  };
  for (const f of await lireZip(donnees, limites)) {
    if (!/\.zip$/i.test(f.nom)) { ajouter(f); continue; }
    const dossier = f.chemin.replace(/\.zip$/i, "");
    let dedans;
    try {
      dedans = await lireZip(await f.lire(), limites);
    } catch (err) {
      throw new Error(`Dans « ${f.chemin} » : ${err?.message ?? "il n'a pas pu être ouvert."}`);
    }
    for (const g of dedans) ajouter({ ...g, chemin: `${dossier}/${g.chemin}` });
  }
  return fichiers;
}
