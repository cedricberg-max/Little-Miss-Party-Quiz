// Illustration facultative d'une question : un émoji, ou une photo réduite dans le navigateur avant
// d'être rangée dans la bibliothèque (library/images/<empreinte>). Petite taille : la TV la charge vite,
// même sur une box ancienne, et la base reste légère.

import { analyserTransparence, choisirFond, placerSujet } from "./fond-transparent.js";

/** Taille maximale d'une photo enregistrée (caractères de son adresse data:), sous la limite des règles. */
export const IMAGE_BUDGET = 110_000;

/** Identifiant d'une photo : début de l'empreinte SHA-256 de son contenu (deux fois la même photo = une seule copie). */
export async function imageId(dataUrl) {
  const bytes = new TextEncoder().encode(dataUrl);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Émoji (ou court texte) d'illustration : nettoyé, 16 caractères au plus, vide si rien. */
export function cleanEmoji(text) {
  return [...(text ?? "").trim()].slice(0, 8).join("").slice(0, 16);
}

/** Photo d'une réponse en image : plus petite (elle s'affiche dans une case de la TV et des tablettes). */
export const CHOICE_IMAGE = { budget: 45_000, width: 480 };

/**
 * Le sujet d'une image à fond transparent (fond-transparent.js), dans les coordonnées de [bitmap] ; null pour une
 * image sans transparence. L'analyse se fait sur une copie réduite (rapide, même pour une grande image).
 */
function sujetTransparent(bitmap) {
  const k = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k)), h = Math.max(1, Math.round(bitmap.height * k));
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const a = analyserTransparence(ctx.getImageData(0, 0, w, h).data, w, h);
  if (!a) return null;
  // Un pixel d'analyse de marge autour du sujet (la réduction arrondit ses bords).
  const x = Math.max(0, (a.x - 1) / k), y = Math.max(0, (a.y - 1) / k);
  return { x, y, l: Math.min(bitmap.width - x, (a.l + 2) / k), h: Math.min(bitmap.height - y, (a.h + 2) / k), fond: choisirFond(a.contour) };
}

const rgba = ([r, g, b], a = 1) => `rgba(${r}, ${g}, ${b}, ${a})`;

/**
 * Une image à fond transparent (cedric, 25/10) : le sujet en grand dans un cadre [largeur] × [hauteur] (4:3, ou carré
 * pour une case), sur un fond dans l'esprit du décor Game Show (dégradé, rayons, halo derrière le sujet, ombre
 * douce sous lui) qui contraste avec son contour. La marge garde le sujet entier quand la TV recadre l'image à sa case
 * (rectangle plus large, ou rond pour Qui suis-je ?).
 */
function dessinerSurFond(ctx, bitmap, sujet, largeur, hauteur) {
  const f = sujet.fond;
  const cx = largeur / 2, cy = hauteur / 2, rayon = Math.hypot(largeur, hauteur) / 2;
  const degrade = ctx.createRadialGradient(cx, cy, 0, cx, cy, rayon);
  degrade.addColorStop(0, rgba(f.centre));
  degrade.addColorStop(1, rgba(f.bord));
  ctx.fillStyle = degrade;
  ctx.fillRect(0, 0, largeur, hauteur);
  // Rayons du plateau, très légers, depuis le centre.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = rgba(f.rayons, 0.08);
  for (let k = 0; k < 16; k += 2) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, rayon, (k * Math.PI) / 8, ((k + 1) * Math.PI) / 8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  const carre = largeur === hauteur;
  const p = placerSujet(sujet, largeur, hauteur, carre ? { margeX: 0.12, margeY: 0.12 } : { margeX: 0.08, margeY: 0.13 });
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(p.l, p.h) * 0.62);
  halo.addColorStop(0, rgba(f.halo, 0.5));
  halo.addColorStop(1, rgba(f.halo, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, largeur, hauteur);
  ctx.save();
  ctx.shadowColor = rgba(f.ombre, 0.45);
  ctx.shadowBlur = Math.round(largeur * 0.025);
  ctx.shadowOffsetY = Math.round(largeur * 0.008);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sujet.x, sujet.y, sujet.l, sujet.h, p.x, p.y, p.l, p.h);
  ctx.restore();
}

/**
 * Réduit une photo (fichier choisi sur le PC) en JPEG d'au plus [maxWidth] px de large, sous [budget]. À fond
 * transparent : le sujet en grand sur un fond Game Show (4:3 ; carré jusqu'à 512 px de large : cases, vignettes).
 */
export async function compressImage(file, budget = IMAGE_BUDGET, maxWidth = 800) {
  const bitmap = await createImageBitmap(file);
  const sujet = sujetTransparent(bitmap);
  const ratio = sujet ? (maxWidth <= 512 ? 1 : 3 / 4) : bitmap.height / bitmap.width;
  let width = sujet ? maxWidth : Math.min(maxWidth, bitmap.width);
  for (let attempt = 0; attempt < 6; attempt++) {
    const height = Math.round(width * ratio);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    if (sujet) dessinerSurFond(ctx, bitmap, sujet, width, height);
    else ctx.drawImage(bitmap, 0, 0, width, height);
    for (const quality of [0.8, 0.65, 0.5]) {
      const url = canvas.toDataURL("image/jpeg", quality);
      if (url.length <= budget) return url;
    }
    width = Math.round(width * 0.75);
  }
  throw new Error("Photo trop lourde, même réduite");
}
