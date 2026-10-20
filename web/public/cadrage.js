/**
 * Cadrage d'une image comme sur la TV (Régie PC). La fenêtre a la forme exacte de la bulle de la TV : vignette de
 * réponse carrée (quiz des petits) ou bulle de révélation 4:3. Ce qui dépasse reste visible en transparence ; Sarah
 * fait glisser l'image à la souris (ou au doigt) et zoome à la molette ou au curseur. « Valider » rend l'image
 * recadrée telle qu'elle apparaîtra : la TV et les tablettes la montrent à l'identique, sans réglage de leur côté.
 */

/** Formes des bulles : rapport largeur / hauteur, taille de l'image rendue et arrondi (comme sur la TV). */
export const BULLES = {
  vignette: { ratio: 1, width: 480, height: 480, radius: "22%" },
  revelation: { ratio: 4 / 3, width: 800, height: 600, radius: "9%" },
};

/** Zoom maximal par rapport à l'image qui remplit juste la bulle. */
const ZOOM_MAX = 4;

/**
 * Position de départ et limites : l'image remplit toujours la bulle (jamais de bord vide), centrée.
 * [w], [h] : taille de l'image ; [fw], [fh] : taille de la fenêtre. Fonction pure, testée.
 */
export function cadrageInitial(w, h, fw, fh) {
  const base = Math.max(fw / w, fh / h);
  return { base, zoom: 1, x: (fw - w * base) / 2, y: (fh - h * base) / 2 };
}

/** Garde l'image sur toute la fenêtre après un déplacement ou un zoom. Fonction pure, testée. */
export function borner(c, w, h, fw, fh) {
  const zoom = Math.min(ZOOM_MAX, Math.max(1, c.zoom));
  const s = c.base * zoom;
  const x = Math.min(0, Math.max(fw - w * s, c.x));
  const y = Math.min(0, Math.max(fh - h * s, c.y));
  return { ...c, zoom, x, y };
}

/** Zoom autour d'un point de la fenêtre (le point sous la souris ne bouge pas). Fonction pure, testée. */
export function zoomer(c, zoom, px, py, w, h, fw, fh) {
  const avant = c.base * c.zoom;
  const z = Math.min(ZOOM_MAX, Math.max(1, zoom));
  const apres = c.base * z;
  return borner({ ...c, zoom: z, x: px - ((px - c.x) * apres) / avant, y: py - ((py - c.y) * apres) / avant }, w, h, fw, fh);
}

/** Partie de l'image source gardée (en pixels de l'image), pour le rendu final. Fonction pure, testée. */
export function zoneGardee(c, fw, fh) {
  const s = c.base * c.zoom;
  return { sx: -c.x / s + 0, sy: -c.y / s + 0, sw: fw / s, sh: fh / s };
}

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k != null));
  return e;
};

/**
 * Ouvre la fenêtre de cadrage sur [source] (fichier, Blob ou adresse data:). Rend un Blob JPEG recadré à la taille
 * de la bulle, ou null si Sarah annule.
 */
export async function ouvrirCadrage(source, forme = "vignette") {
  const bulle = BULLES[forme] ?? BULLES.vignette;
  const url = typeof source === "string" ? source : URL.createObjectURL(source);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    if (typeof source !== "string") URL.revokeObjectURL(url);
    throw new Error("Image illisible");
  }
  const w = img.naturalWidth, h = img.naturalHeight;
  const fw = Math.max(200, Math.min(400, window.innerWidth - 150));
  const fh = Math.round(fw / bulle.ratio);
  let c = cadrageInitial(w, h, fw, fh);

  const fond = el("img", { src: url, className: "cadre-fond", alt: "", draggable: false });
  const net = el("img", { src: url, className: "cadre-net", alt: "Image cadrée", draggable: false });
  const fenetre = el("div", { className: `cadre-fenetre ${forme}` }, net);
  fenetre.style.cssText = `width:${fw}px;height:${fh}px;border-radius:${bulle.radius}`;
  const scene = el("div", { className: "cadre-scene" }, fond, fenetre);
  scene.style.cssText = `width:${fw}px;height:${fh}px`;
  const zoom = el("input", { type: "range", min: "1", max: String(ZOOM_MAX), step: "0.01", value: "1", className: "cadre-zoom" });
  zoom.setAttribute("aria-label", "Zoom");
  const valider = el("button", { type: "button", className: "btn", textContent: "Valider le cadrage" });
  const annuler = el("button", { type: "button", className: "btn secondary", textContent: "Annuler" });
  const centrer = el("button", { type: "button", className: "btn secondary", textContent: "Recentrer" });
  const boite = el("div", { className: "cadre-boite", role: "dialog" },
    el("p", { className: "label", textContent: forme === "vignette" ? "Cadrer la vignette de la réponse" : "Cadrer la bulle de la révélation" }),
    el("p", { className: "hint small", textContent: "Faites glisser l'image ; la molette ou le curseur zoome. La partie claire est celle montrée sur la TV." }),
    scene,
    el("label", { className: "inline cadre-zoom-label" }, "Zoom", zoom),
    el("div", { className: "row" }, valider, centrer, annuler));
  const voile = el("div", { className: "cadre-voile" }, boite);

  const dessiner = () => {
    const s = c.base * c.zoom;
    const t = `translate(${c.x}px, ${c.y}px)`;
    for (const i of [fond, net]) {
      i.style.width = `${w * s}px`;
      i.style.height = `${h * s}px`;
      i.style.transform = t;
    }
    zoom.value = String(c.zoom);
  };
  let glisse = null;
  scene.addEventListener("pointerdown", (e) => {
    glisse = { x: e.clientX, y: e.clientY, c };
    scene.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  scene.addEventListener("pointermove", (e) => {
    if (!glisse) return;
    c = borner({ ...glisse.c, x: glisse.c.x + e.clientX - glisse.x, y: glisse.c.y + e.clientY - glisse.y }, w, h, fw, fh);
    dessiner();
  });
  const lacher = () => { glisse = null; };
  scene.addEventListener("pointerup", lacher);
  scene.addEventListener("pointercancel", lacher);
  scene.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = scene.getBoundingClientRect();
    c = zoomer(c, c.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top, w, h, fw, fh);
    dessiner();
  }, { passive: false });
  zoom.addEventListener("input", () => { c = zoomer(c, Number(zoom.value), fw / 2, fh / 2, w, h, fw, fh); dessiner(); });
  centrer.onclick = () => { c = cadrageInitial(w, h, fw, fh); dessiner(); };

  document.body.append(voile);
  dessiner();
  const choix = await new Promise((resolve) => {
    valider.onclick = () => resolve(true);
    annuler.onclick = () => resolve(false);
    voile.addEventListener("keydown", (e) => { if (e.key === "Escape") resolve(false); });
    voile.addEventListener("click", (e) => { if (e.target === voile) resolve(false); });
    valider.focus();
  });
  voile.remove();
  if (typeof source !== "string") URL.revokeObjectURL(url);
  if (!choix) return null;
  const { sx, sy, sw, sh } = zoneGardee(c, fw, fh);
  const canvas = el("canvas", { width: bulle.width, height: bulle.height });
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, bulle.width, bulle.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, bulle.width, bulle.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9));
}
