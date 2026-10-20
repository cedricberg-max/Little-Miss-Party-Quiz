// Banque des tout-petits : après avoir ajouté ou retiré des photos dans web/public/banque/ (<clé>.jpg), refait la
// liste des mots qui ont leur photo (web/public/banque/liste.js), lue par la Régie PC, la régie et les tests.
// node scripts/banque-liste.mjs
import { readdir, writeFile } from "node:fs/promises";
import { BANQUE_MOTS } from "../web/public/banque-petits.js";

const DIR = new URL("../web/public/banque/", import.meta.url);
const fichiers = new Set((await readdir(DIR)).filter((f) => f.endsWith(".jpg")).map((f) => f.slice(0, -4)));
const cles = BANQUE_MOTS.map((m) => m.cle).filter((c) => fichiers.has(c));
const inconnus = [...fichiers].filter((f) => !cles.includes(f));
if (inconnus.length) console.warn(`Photos sans mot dans la banque (ignorées) : ${inconnus.join(", ")}`);
await writeFile(new URL("liste.js", DIR), `// Mots de la banque des tout-petits qui ont leur photo dans ce dossier (<clé>.jpg, domaine public, 480 px).
// Fichier tenu à jour avec les photos (node scripts/banque-liste.mjs) : un mot absent garde son émoji.
export const CLES_PHOTOS = ${JSON.stringify(cles, null, 0).replace(/","/g, "\", \"")};
`);
console.log(`${cles.length} mots sur ${BANQUE_MOTS.length} ont leur photo.`);
