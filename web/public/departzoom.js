/**
 * « 🔍 Départ du zoom » du Zoom mystère (cedric, 31/10 : « qu'elle puisse voir l'image zoomée telle qu'elle va
 * apparaître à l'écran sur sa première frame… un réglage dans la régie PC pour ça ! »). La TV montre la photo dans un
 * cadre 4/3 (remplie, centrée), zoomée z fois autour du point (x, y) du cadre, puis dézoome jusqu'à 1,6 au fil du
 * chrono. La Régie PC montre cette première image à l'identique et laisse Sarah déplacer le départ et choisir la force.
 */

/** Forces proposées (zoom de départ) ; « Moyen » = le zoom de la TV avant ce réglage. */
export const FORCES_ZOOM = [{ z: 4, nom: "Léger" }, { z: 6, nom: "Moyen" }, { z: 9, nom: "Fort" }];
export const ZOOM_MOYEN = 6;
/** Cadre du Zoom mystère sur la TV (largeur / hauteur). */
const CADRE = 4 / 3;

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k != null));
  return e;
};

/** Graine d'une photo (comme String.hashCode de la TV), pour varier le départ automatique d'une photo à l'autre. */
export function graineDe(texte) {
  let g = 0;
  for (const c of `${texte}`) g = (Math.imul(31, g) + c.charCodeAt(0)) | 0;
  return g;
}

/**
 * Départ automatique (portage de pivotDetail de la TV) : la fenêtre vue au zoom de départ qui a le plus de détail
 * (écart de luminosité), parmi les meilleures choisie selon [graine]. Le transparent compte comme du blanc. [px] :
 * pixels RGBA de la photo réduite ([w] × [h]). Photo uniforme : null. Fonction pure, testée.
 */
export function pivotDetail(px, w, h, graine, zoom = ZOOM_MOYEN) {
  if (w <= 0 || h <= 0 || px.length < w * h * 4) return null;
  const lum = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = px[i * 4 + 3] / 255;
    lum[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) * a + 255 * (1 - a);
  }
  const aspect = w / h;
  const fx = Math.min(1, CADRE / aspect);
  const fy = Math.min(1, aspect / CADRE);
  const versPhoto = (c, f) => 0.5 + (c - 0.5) * f;
  const detail = (cx, cy) => {
    const x0 = Math.min(Math.max(Math.trunc(versPhoto(cx - cx / zoom, fx) * w), 0), w - 1);
    const x1 = Math.min(Math.max(Math.trunc(versPhoto(cx + (1 - cx) / zoom, fx) * w), x0 + 1), w);
    const y0 = Math.min(Math.max(Math.trunc(versPhoto(cy - cy / zoom, fy) * h), 0), h - 1);
    const y1 = Math.min(Math.max(Math.trunc(versPhoto(cy + (1 - cy) / zoom, fy) * h), y0 + 1), h);
    let n = 0, somme = 0, carres = 0;
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) { const l = lum[j * w + i]; somme += l; carres += l * l; n++; }
    const moyenne = somme / n;
    return Math.sqrt(Math.max(0, carres / n - moyenne * moyenne));
  };
  const candidats = [];
  for (let i = 0; i <= 14; i++) for (let j = 0; j <= 14; j++) {
    const x = Math.round((0.15 + i * 0.05) * 100) / 100, y = Math.round((0.15 + j * 0.05) * 100) / 100;
    candidats.push([x, y, detail(x, y)]);
  }
  const meilleur = Math.max(...candidats.map((c) => c[2]));
  if (meilleur < 6) return null;
  const bons = candidats.filter((c) => c[2] >= meilleur * 0.8);
  const [x, y] = bons[((graine % bons.length) + bons.length) % bons.length];
  return { x, y };
}

/** La partie du cadre vue au départ (fractions du cadre) : un rectangle 4/3, 1/z de la largeur. Fonction pure, testée. */
export function fenetreDuDepart({ x, y, z }) {
  return { gauche: x * (1 - 1 / z), haut: y * (1 - 1 / z), taille: 1 / z };
}

/** Le départ qui montre la fenêtre centrée sur (cx, cy) au zoom z, toujours dans le cadre. Fonction pure, testée. */
export function departCentreSur(cx, cy, z) {
  const t = 1 / z;
  const origine = (c) => Math.min(1, Math.max(0, (c - t / 2) / (1 - t)));
  return { x: Math.round(origine(cx) * 1000) / 1000, y: Math.round(origine(cy) * 1000) / 1000, z };
}

const charger = async (src) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
};

/** Départ automatique d'une photo ([src] : adresse de l'image), comme la TV le choisirait. */
export async function departAuto(src, graine, z = ZOOM_MOYEN) {
  let p = null;
  try {
    const img = await charger(src);
    const w = 96, h = Math.min(288, Math.max(8, Math.round(w * img.naturalHeight / Math.max(1, img.naturalWidth))));
    const c = el("canvas", { width: w, height: h });
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    p = pivotDetail(ctx.getImageData(0, 0, w, h).data, w, h, graine, z);
  } catch { /* image illisible : le hasard, comme la TV */ }
  p ??= { x: 0.3 + (graine & 0xff) / 255 * 0.4, y: 0.3 + ((graine >> 8) & 0xff) / 255 * 0.4 };
  return { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000, z };
}

/** Première image de la TV : la photo dans son cadre 4/3, zoomée comme au départ. */
export function premiereImage(src, depart, classe = "zoom-premiere") {
  const img = el("img", { src, alt: "", draggable: false });
  const cadre = el("span", { className: classe }, img);
  poserDepart(img, depart);
  return cadre;
}
const poserDepart = (img, { x, y, z }) => {
  img.style.transformOrigin = `${x * 100}% ${y * 100}%`;
  img.style.transform = `scale(${z})`;
};

/**
 * Fenêtre du réglage : la photo entière telle que la TV la montre à la révélation, le rectangle de ce qu'on voit au
 * départ (à faire glisser), la force du zoom, et la première image en grand. Rend le départ choisi, ou null (Annuler).
 */
export async function ouvrirDepartZoom(src, depart, auto) {
  let d = { ...depart };
  const photo = el("img", { src, className: "dz-photo", alt: "", draggable: false });
  const rect = el("span", { className: "dz-fenetre" });
  const scene = el("div", { className: "dz-scene" }, photo, rect);
  const grand = el("img", { src, alt: "Première image sur la TV", draggable: false });
  const apercu = el("span", { className: "dz-apercu" }, grand);
  const forces = el("div", { className: "chips dz-forces", role: "group" });
  forces.setAttribute("aria-label", "Force du zoom");
  const boutons = FORCES_ZOOM.map(({ z, nom }) => el("button", { type: "button", className: "chip", textContent: nom, onclick: () => { d = recentrer(d, z); dessiner(); } }));
  forces.append(...boutons);
  const valider = el("button", { type: "button", className: "btn", textContent: "Valider le départ" });
  const automatique = el("button", { type: "button", className: "btn secondary", textContent: "Départ automatique" });
  const annuler = el("button", { type: "button", className: "btn secondary", textContent: "Annuler" });
  const boite = el("div", { className: "cadre-boite dz-boite", role: "dialog" },
    el("p", { className: "label", textContent: "Départ du zoom : la première image sur la TV" }),
    el("p", { className: "hint small", textContent: "Faites glisser le cadre sur ce que la TV montrera au début. Plus le zoom est fort, plus c'est dur à deviner." }),
    el("div", { className: "dz-vues" },
      el("div", { className: "dz-vue" }, el("span", { className: "hint small", textContent: "La photo entière" }), scene),
      el("div", { className: "dz-vue" }, el("span", { className: "hint small", textContent: "Sur la TV, au début" }), apercu)),
    el("div", { className: "row" }, el("span", { className: "label", textContent: "Force du zoom" }), forces),
    el("div", { className: "row" }, valider, automatique, annuler));
  const voile = el("div", { className: "cadre-voile" }, boite);
  // Changer de force garde le centre de ce qu'on voit.
  function recentrer(v, z) {
    const f = fenetreDuDepart(v);
    return departCentreSur(f.gauche + f.taille / 2, f.haut + f.taille / 2, z);
  }
  function dessiner() {
    const f = fenetreDuDepart(d);
    rect.style.left = `${f.gauche * 100}%`;
    rect.style.top = `${f.haut * 100}%`;
    rect.style.width = rect.style.height = `${f.taille * 100}%`;
    poserDepart(grand, d);
    boutons.forEach((b, k) => b.classList.toggle("active", FORCES_ZOOM[k].z === d.z));
  }
  const viser = (e) => {
    const r = scene.getBoundingClientRect();
    d = departCentreSur((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, d.z);
    dessiner();
  };
  let glisse = false;
  scene.addEventListener("pointerdown", (e) => { glisse = true; scene.setPointerCapture(e.pointerId); viser(e); e.preventDefault(); });
  scene.addEventListener("pointermove", (e) => { if (glisse) viser(e); });
  const lacher = () => { glisse = false; };
  scene.addEventListener("pointerup", lacher);
  scene.addEventListener("pointercancel", lacher);
  automatique.onclick = async () => { d = await auto(d.z); dessiner(); };
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
  return choix ? d : null;
}
