// Étiquettes d'un fichier MP3 (ID3v2.2, 2.3 et 2.4) lues dans le navigateur : titre, artiste et pochette intégrée.
// Rien n'est envoyé ailleurs ; un fichier sans étiquettes (ou abîmé) rend simplement un objet vide.

const latin1 = new TextDecoder("latin1");
const utf8 = new TextDecoder("utf-8");

/** Taille « synchsafe » (7 bits par octet) des en-têtes ID3v2.4. */
const synchsafe = (b, i) => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
const entier = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

/** Texte d'une étiquette selon son codage (0 latin-1, 1 UTF-16 avec BOM, 2 UTF-16BE, 3 UTF-8). */
function texte(codage, octets) {
  let s;
  if (codage === 1 || codage === 2) {
    let le = codage === 1;
    let debut = 0;
    if (codage === 1 && octets.length >= 2) {
      if (octets[0] === 0xff && octets[1] === 0xfe) { le = true; debut = 2; } else if (octets[0] === 0xfe && octets[1] === 0xff) { le = false; debut = 2; }
    }
    s = new TextDecoder(le ? "utf-16le" : "utf-16be").decode(octets.subarray(debut, debut + ((octets.length - debut) & ~1)));
  } else s = (codage === 3 ? utf8 : latin1).decode(octets);
  // Plusieurs valeurs (ID3v2.4) séparées par un zéro : la première suffit.
  return s.split("\u0000")[0].trim();
}

/** Fin d'une chaîne terminée par zéro (un octet, ou deux alignés en UTF-16) à partir de [i]. */
function finChaine(b, i, codage) {
  if (codage === 1 || codage === 2) {
    for (let k = i; k + 1 < b.length; k += 2) if (b[k] === 0 && b[k + 1] === 0) return k;
    return b.length;
  }
  const k = b.indexOf(0, i);
  return k < 0 ? b.length : k;
}

/** Retire la « désynchronisation » ID3 (0xFF 0x00 → 0xFF). */
function resynchroniser(b) {
  const out = [];
  for (let i = 0; i < b.length; i++) {
    out.push(b[i]);
    if (b[i] === 0xff && b[i + 1] === 0) i++;
  }
  return Uint8Array.from(out);
}

/**
 * Lit les étiquettes ID3v2 au début d'un MP3 ([octets] : ArrayBuffer ou Uint8Array).
 * Rend { title?, artist?, picture?: { mime, data: Uint8Array } } (la pochette de face si le fichier en a plusieurs).
 */
export function lireId3(octets) {
  const b = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return {};
  const version = b[3];
  const drapeaux = b[5];
  const taille = synchsafe(b, 6);
  let tag = b.subarray(10, Math.min(b.length, 10 + taille));
  if (drapeaux & 0x80 && version < 4) tag = resynchroniser(tag);
  let i = 0;
  // En-tête étendu : sauté.
  if (drapeaux & 0x40 && version >= 3) i += version === 4 ? synchsafe(tag, 0) : entier(tag, 0) + 4;
  const court = version === 2;
  const out = {};
  let pochette = null;
  while (i + (court ? 6 : 10) <= tag.length) {
    const id = latin1.decode(tag.subarray(i, i + (court ? 3 : 4)));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    const n = court ? (tag[i + 3] << 16) + (tag[i + 4] << 8) + tag[i + 5] : version === 4 ? synchsafe(tag, i + 4) : entier(tag, i + 4);
    const debut = i + (court ? 6 : 10);
    if (n <= 0 || debut + n > tag.length) break;
    let corps = tag.subarray(debut, debut + n);
    if (!court && version === 4 && tag[i + 9] & 0x02) corps = resynchroniser(corps);
    if (!court && version === 4 && tag[i + 9] & 0x01) corps = corps.subarray(4); // taille d'origine en tête
    if ((id === "TIT2" || id === "TT2") && !out.title) out.title = texte(corps[0], corps.subarray(1));
    else if ((id === "TPE1" || id === "TP1") && !out.artist) out.artist = texte(corps[0], corps.subarray(1));
    else if (id === "APIC" || id === "PIC") {
      const codage = corps[0];
      let k = 1;
      let mime;
      if (court) { mime = `image/${latin1.decode(corps.subarray(1, 4)).toLowerCase().replace("jpg", "jpeg")}`; k = 4; } else {
        const fm = finChaine(corps, 1, 0);
        mime = latin1.decode(corps.subarray(1, fm)).toLowerCase() || "image/jpeg";
        if (!mime.includes("/")) mime = `image/${mime.replace("jpg", "jpeg")}`;
        k = fm + 1;
      }
      const type = corps[k];
      const f = finChaine(corps, k + 1, codage);
      const data = corps.subarray(f + (codage === 1 || codage === 2 ? 2 : 1));
      // La pochette de face (type 3) passe avant les autres images.
      if (data.length > 100 && (!pochette || (type === 3 && pochette.type !== 3))) pochette = { mime, data, type };
    }
    i = debut + n;
  }
  if (pochette) out.picture = { mime: pochette.mime, data: pochette.data };
  if (!out.title) delete out.title;
  if (!out.artist) delete out.artist;
  return out;
}

/** Étiquettes d'un fichier choisi sur le PC : seul le début du fichier est lu (l'en-tête ID3 et sa pochette). */
export async function etiquettesMp3(file) {
  try {
    const tete = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (tete.length < 10 || tete[0] !== 0x49 || tete[1] !== 0x44 || tete[2] !== 0x33) return {};
    const taille = synchsafe(tete, 6) + 10;
    return lireId3(await file.slice(0, Math.min(file.size, taille)).arrayBuffer());
  } catch (e) {
    console.warn("Étiquettes illisibles", e);
    return {};
  }
}
