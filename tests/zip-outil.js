// Petit fabricant de ZIP pour les tests (import des packs en un seul ZIP, cedric 25/10).
import { deflateRawSync } from "node:zlib";

/** Petit ZIP fait à la main : [entrees] = [[chemin, contenu (texte ou octets), { stocke, utf8, drapeaux }]]. */
export function faireZip(entrees) {
  const locaux = [];
  const centraux = [];
  let decalage = 0;
  for (const [chemin, contenu, { stocke = false, utf8 = true, drapeaux = 0, methode = null } = {}] of entrees) {
    const nom = Buffer.from(chemin, utf8 ? "utf8" : "latin1");
    const brut = Buffer.isBuffer(contenu) ? contenu : Buffer.from(contenu ?? "");
    const donnees = stocke ? brut : deflateRawSync(brut);
    const m = methode ?? (stocke ? 0 : 8);
    const fl = (utf8 ? 0x800 : 0) | drapeaux;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(fl, 6); local.writeUInt16LE(m, 8);
    local.writeUInt32LE(donnees.length, 18); local.writeUInt32LE(brut.length, 22); local.writeUInt16LE(nom.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(fl, 8);
    central.writeUInt16LE(m, 10); central.writeUInt32LE(donnees.length, 20); central.writeUInt32LE(brut.length, 24);
    central.writeUInt16LE(nom.length, 28); central.writeUInt32LE(decalage, 42);
    locaux.push(local, nom, donnees);
    centraux.push(central, nom);
    decalage += 30 + nom.length + donnees.length;
  }
  const rep = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entrees.length, 8); fin.writeUInt16LE(entrees.length, 10);
  fin.writeUInt32LE(rep.length, 12); fin.writeUInt32LE(decalage, 16);
  return new Uint8Array(Buffer.concat([...locaux, rep, fin]));
}
