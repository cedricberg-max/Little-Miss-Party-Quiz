// MENU TEMPORAIRE (cedric, 24/10) : les mots de la banque des tout-petits qui n'ont pas encore de vraie photo (la
// recherche automatique de photos du domaine public n'en a pas trouvé de bonne). Pour chacun, cedric choisit une photo
// sur son PC (📤, ou glissée sur la ligne) ; « 📦 Télécharger le lot » en fait un seul fichier, qu'il joint dans le fil
// « Feuille de route ». Claude range ensuite les photos dans la banque (web/public/banque/) et enlève ce menu.
// En attendant, les photos choisies restent dans ce navigateur (IndexedDB) : rien n'est envoyé en ligne.
import { BANQUE_MOTS, FAMILLES_PETITS } from "./banque-petits.js";
import { PHOTOS_BANQUE } from "./banque-photos.js";
import { compressImage } from "./illustration.js";

const BASE = "lmp-photos-manquantes";
const TABLE = "photos";
/** Photos gardées en grand (Claude les recadre en carré pour la banque) : 1 200 px de large, 400 Ko au plus. */
const LARGEUR = 1200;
const BUDGET = 400_000;

/** Les mots de la banque sans vraie photo, dans l'ordre des familles. */
export const motsSansPhoto = () => BANQUE_MOTS.filter((m) => !PHOTOS_BANQUE.has(m.cle));

let ouverture = null;
function ouvrir() {
  ouverture ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(BASE, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(TABLE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => { ouverture = null; throw e; });
  return ouverture;
}
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

/** Photos déjà choisies sur ce PC : { clé du mot: { data, nom } }. Navigateur qui refuse : rien (on peut choisir quand même). */
const choisies = new Map();
let lues = null;
function lire() {
  lues ??= (async () => {
    try {
      const cles = await operation("readonly", (t) => t.getAllKeys());
      const valeurs = await operation("readonly", (t) => t.getAll());
      cles.forEach((k, i) => { if (valeurs[i]?.data) choisies.set(k, valeurs[i]); });
    } catch (e) {
      console.warn("Photos manquantes : navigateur sans stockage", e);
    }
  })();
  return lues;
}
async function garder(cle, x) {
  choisies.set(cle, x);
  try { await operation("readwrite", (t) => t.put(x, cle)); } catch (e) { console.warn("Photo pas gardée sur ce PC", e); }
}
async function oublier(cle) {
  choisies.delete(cle);
  try { await operation("readwrite", (t) => t.delete(cle)); } catch (e) { console.warn("Photo pas oubliée", e); }
}

/**
 * Le menu, à poser en haut de « Photos libres » : une ligne par mot sans photo (émoji, mot, famille, ce que la photo doit
 * montrer), 📤 pour choisir la photo, son aperçu, ✕ pour l'enlever ; en bas, « 📦 Télécharger le lot ».
 * [h] : le constructeur d'éléments de la Régie PC ; [annonce] : le message bien visible.
 */
export function panneauPhotosManquantes(h, annonce) {
  const mots = motsSansPhoto();
  if (!mots.length) return null;
  const pret = h("span", { class: "pm-compte", "aria-live": "polite" });
  const lot = h("button", { type: "button", class: "btn", text: "📦 Télécharger le lot" });
  const lignes = new Map();
  const maj = () => {
    const n = mots.filter((m) => choisies.has(m.cle)).length;
    pret.textContent = `${n} / ${mots.length} photo${n > 1 ? "s" : ""} prête${n > 1 ? "s" : ""}`;
    lot.disabled = !n;
    lot.textContent = n ? `📦 Télécharger le lot (${n} photo${n > 1 ? "s" : ""})` : "📦 Télécharger le lot";
    for (const m of mots) {
      const { apercu, retirer, li } = lignes.get(m.cle);
      const x = choisies.get(m.cle);
      apercu.replaceChildren(x ? h("img", { src: x.data, alt: `Photo choisie pour « ${m.mot} »` }) : h("span", { class: "emoji", text: m.emoji }));
      retirer.hidden = !x;
      li.classList.toggle("prete", !!x);
    }
  };
  const choisir = async (m, fichier) => {
    if (!fichier || !/^image\//.test(fichier.type)) return annonce("Ce fichier n'est pas une image : choisissez une photo (JPEG, PNG, WebP…).");
    try {
      const data = await compressImage(fichier, BUDGET, LARGEUR);
      await garder(m.cle, { data, nom: fichier.name ?? "", mot: m.mot, le: Date.now() });
      maj();
      annonce(`Photo de « ${m.mot} » prête.`, true);
    } catch (e) {
      console.warn(e);
      annonce(`Cette photo n'a pas pu être lue : essayez-en une autre pour « ${m.mot} ».`);
    }
  };
  const liste = h("ul", { class: "pm-liste" }, ...mots.map((m) => {
    const entree = h("input", { type: "file", accept: "image/*", hidden: true, onchange: (e) => { choisir(m, e.target.files?.[0]); e.target.value = ""; } });
    const apercu = h("span", { class: "pm-apercu" });
    const retirer = h("button", { type: "button", class: "icon pm-retirer", text: "✕", title: "Enlever cette photo", "aria-label": `Enlever la photo de « ${m.mot} »`,
      onclick: async () => { await oublier(m.cle); maj(); } });
    const li = h("li", {
      class: "pm-mot", "data-cle": m.cle,
      ondragover: (e) => { e.preventDefault(); li.classList.add("survol"); },
      ondragleave: () => li.classList.remove("survol"),
      ondrop: (e) => { e.preventDefault(); li.classList.remove("survol"); choisir(m, e.dataTransfer?.files?.[0]); },
    },
    apercu,
    h("span", { class: "pm-nom" }, h("b", { text: m.mot }), h("span", { class: "small hint", text: ` · ${FAMILLES_PETITS[m.famille] ?? m.famille}` })),
    h("button", { type: "button", class: "btn small pm-choisir", text: "📤 Choisir la photo", "aria-label": `Choisir la photo de « ${m.mot} »`, onclick: () => entree.click() }),
    retirer, entree);
    lignes.set(m.cle, { apercu, retirer, li });
    return li;
  }));
  lot.onclick = () => {
    const photos = Object.fromEntries(mots.filter((m) => choisies.has(m.cle)).map((m) => [m.cle, { mot: m.mot, ...choisies.get(m.cle) }]));
    const texte = JSON.stringify({ app: "little-miss-party-quiz", photosManquantes: 1, at: new Date().toISOString(), photos });
    const nom = `photos-manquantes-${Object.keys(photos).length}.json`;
    const url = URL.createObjectURL(new Blob([texte], { type: "application/json" }));
    const lien = h("a", { href: url, download: nom, hidden: true });
    document.body.append(lien);
    lien.click();
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    annonce(`Lot téléchargé : ${nom}, dans le dossier Téléchargements. Joignez ce fichier dans le fil « Feuille de route ».`, true);
  };
  const panneau = h("details", { class: "photos-manquantes", open: true },
    h("summary", {}, h("b", { text: `🧰 Photos manquantes (menu temporaire) · ${mots.length} mot${mots.length > 1 ? "s" : ""} sans vraie photo` })),
    h("p", { class: "small hint", text: "Pour chaque mot : « 📤 Choisir la photo » sur ce PC (ou glissez-la sur sa ligne). Les photos restent sur ce PC en attendant. Quand c'est fini : « 📦 Télécharger le lot », puis joignez le fichier dans le fil « Feuille de route ». Claude range les photos dans la banque et enlève ce menu." }),
    liste,
    h("div", { class: "pm-bas" }, pret, lot));
  maj();
  lire().then(maj);
  return panneau;
}
