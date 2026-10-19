// Illustration facultative d'une question : un émoji, ou une photo réduite dans le navigateur avant
// d'être rangée dans la bibliothèque (library/images/<empreinte>). Petite taille : la TV la charge vite,
// même sur une box ancienne, et la base reste légère.

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

/** Réduit une photo (fichier choisi sur le PC) en JPEG d'au plus [maxWidth] px de large, sous [budget]. */
export async function compressImage(file, budget = IMAGE_BUDGET, maxWidth = 800) {
  const bitmap = await createImageBitmap(file);
  let width = Math.min(maxWidth, bitmap.width);
  for (let attempt = 0; attempt < 6; attempt++) {
    const height = Math.round((bitmap.height * width) / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    for (const quality of [0.8, 0.65, 0.5]) {
      const url = canvas.toDataURL("image/jpeg", quality);
      if (url.length <= budget) return url;
    }
    width = Math.round(width * 0.75);
  }
  throw new Error("Photo trop lourde, même réduite");
}
