/**
 * Ardoise du Pictionary : la feuille où le dessinateur de l'équipe dessine sur sa tablette.
 * Module autonome, sans Firebase : il dessine en local et rend chaque trait à l'appelant, qui l'envoie à la TV.
 *
 * Contrat d'un trait (le même que la TV) : { id, c, w, p }
 *   c = index de couleur (COULEURS_DESSIN) ou GOMME, w = index d'épaisseur (EPAISSEURS),
 *   p = [x0, y0, x1, y1, …] en coordonnées 0..1 sur une feuille 4:3, arrondies à 3 décimales.
 * Pendant le geste, surTrait(trait, false) part au plus toutes les 80 ms avec le trait entier (même id, il grandit) ;
 * au lever du doigt, surTrait(trait, true). Un geste très long est coupé en plusieurs traits (POINTS_MAX).
 */

export const COULEURS_DESSIN = ["#1B1035", "#FF2D8A", "#2B86C5", "#12C957", "#FFB000", "#FF5A1F", "#6E28BE", "#8B5A2B"];
export const NOMS_COULEURS = ["Noir", "Rose", "Bleu", "Vert", "Jaune", "Orange", "Violet", "Marron"];
/** La gomme : un trait qui efface (envoyé à la TV en couleur « paper »). */
export const GOMME = -1;
/** Épaisseur du trait, en fraction de la largeur de la feuille. */
export const EPAISSEURS = [0.006, 0.012, 0.028];
export const RATIO = 4 / 3;
export const POINTS_MAX = 600;
const ENVOI_MS = 80;
const PAS_MIN = 0.002;

const arrondi = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;

/** Dessine un trait sur un contexte 2D de largeur l et hauteur h (courbes lissées entre les points). */
export function tracer(ctx, trait, l, h) {
  const p = trait.p;
  if (!p || p.length < 2) return;
  // Gomme : le trait efface ce qui est dessous (le papier de la feuille réapparaît).
  ctx.globalCompositeOperation = trait.c === GOMME ? "destination-out" : "source-over";
  ctx.strokeStyle = trait.c === GOMME ? "#000" : COULEURS_DESSIN[trait.c] ?? COULEURS_DESSIN[0];
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = (EPAISSEURS[trait.w] ?? EPAISSEURS[1]) * l;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (p.length < 4) {
    ctx.beginPath();
    ctx.arc(p[0] * l, p[1] * h, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[0] * l, p[1] * h);
  for (let i = 2; i < p.length - 2; i += 2) {
    const mx = ((p[i] + p[i + 2]) / 2) * l;
    const my = ((p[i + 1] + p[i + 3]) / 2) * h;
    ctx.quadraticCurveTo(p[i] * l, p[i + 1] * h, mx, my);
  }
  ctx.lineTo(p[p.length - 2] * l, p[p.length - 1] * h);
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
}

/**
 * Construit l'ardoise dans [hote] et la rend prête à dessiner.
 * options : { surTrait(trait, fini), surEffacer(), titre }
 */
export function creerArdoise(hote, { surTrait = () => {}, surEffacer = () => {}, titre = "À toi de dessiner !" } = {}) {
  hote.classList.add("ardoise");
  hote.innerHTML = `
    <div class="ardoise-titre"></div>
    <div class="ardoise-zone">
      <div class="ardoise-cadre">
        <span class="ardoise-coin c1">✦</span><span class="ardoise-coin c2">✦</span>
        <span class="ardoise-coin c3">✦</span><span class="ardoise-coin c4">✦</span>
        <div class="ardoise-feuille">
          <canvas aria-label="Feuille de dessin"></canvas>
          <div class="ardoise-attente" hidden></div>
        </div>
      </div>
    </div>
    <div class="ardoise-outils">
      <div class="ardoise-couleurs" role="radiogroup" aria-label="Couleur"></div>
      <div class="ardoise-epaisseurs" role="radiogroup" aria-label="Épaisseur"></div>
      <button type="button" class="ardoise-gomme" role="radio" aria-label="Gomme">🧽 Gomme</button>
      <button type="button" class="ardoise-effacer">Tout effacer</button>
    </div>`;
  const $ = (s) => hote.querySelector(s);
  $(".ardoise-titre").textContent = titre;
  const zone = $(".ardoise-zone");
  const cadre = $(".ardoise-cadre");
  const feuille = $(".ardoise-feuille");
  const canvas = $("canvas");
  const attente = $(".ardoise-attente");
  const effacer = $(".ardoise-effacer");
  const ctx = canvas.getContext("2d");

  let couleur = 0;
  let epaisseur = 1;
  let actif = true;
  const traits = [];
  let enCours = null;
  let doigt = null;
  let dernierEnvoi = 0;
  let envoiPrevu = null;
  let numero = 0;
  const prefixe = Math.random().toString(36).slice(2, 7);

  // Feutres et épaisseurs.
  COULEURS_DESSIN.forEach((hex, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ardoise-feutre";
    b.style.setProperty("--feutre", hex);
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", NOMS_COULEURS[i]);
    b.onclick = () => choisirCouleur(i);
    $(".ardoise-couleurs").append(b);
  });
  EPAISSEURS.forEach((_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ardoise-epaisseur";
    b.style.setProperty("--taille", `${[8, 14, 24][i]}px`);
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", ["Fin", "Moyen", "Épais"][i]);
    b.onclick = () => choisirEpaisseur(i);
    $(".ardoise-epaisseurs").append(b);
  });
  function choisirCouleur(i) {
    couleur = i;
    hote.style.setProperty("--feutre-actif", i === GOMME ? "#fff8ea" : COULEURS_DESSIN[i]);
    hote.querySelectorAll(".ardoise-feutre").forEach((b, k) => b.setAttribute("aria-checked", String(k === i)));
    $(".ardoise-gomme").setAttribute("aria-checked", String(i === GOMME));
    hote.classList.toggle("ardoise-gommer", i === GOMME);
  }
  // Gomme : efface juste là où passe le doigt ; un feutre la repose.
  $(".ardoise-gomme").onclick = () => choisirCouleur(GOMME);
  function choisirEpaisseur(i) {
    epaisseur = i;
    hote.querySelectorAll(".ardoise-epaisseur").forEach((b, k) => b.setAttribute("aria-checked", String(k === i)));
  }
  choisirCouleur(0);
  choisirEpaisseur(1);

  // « Tout effacer » en deux temps (pas de fenêtre du navigateur) : le bouton demande confirmation 3 s.
  let confirmation = null;
  effacer.onclick = () => {
    if (!actif) return;
    if (!confirmation) {
      effacer.classList.add("confirmer");
      effacer.textContent = "Sûr ? Effacer";
      confirmation = setTimeout(remettreEffacer, 3000);
      return;
    }
    remettreEffacer();
    vider();
    surEffacer();
  };
  function remettreEffacer() {
    clearTimeout(confirmation);
    confirmation = null;
    effacer.classList.remove("confirmer");
    effacer.textContent = "Tout effacer";
  }

  // La feuille garde son format 4:3 et occupe toute la place disponible, en pixels nets sur tout écran.
  let l = 0;
  let h = 0;
  function ajuster() {
    const r = zone.getBoundingClientRect();
    const bord = cadre.offsetWidth - feuille.clientWidth || 28;
    let largeur = Math.max(100, r.width - 8);
    let hauteur = largeur / RATIO + bord;
    if (hauteur > r.height - 8) largeur = (Math.max(100, r.height - 8) - bord) * RATIO + bord;
    cadre.style.width = `${Math.floor(largeur)}px`;
    const fr = feuille.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    l = fr.width;
    h = fr.width / RATIO;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(l * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redessiner();
  }
  function redessiner() {
    ctx.clearRect(0, 0, l, h);
    traits.forEach((t) => tracer(ctx, t, l, h));
    if (enCours) tracer(ctx, enCours, l, h);
  }
  const observateur = typeof ResizeObserver === "function" ? new ResizeObserver(ajuster) : null;
  observateur?.observe(zone);
  window.addEventListener("resize", ajuster);
  requestAnimationFrame(ajuster);

  function position(e) {
    const r = canvas.getBoundingClientRect();
    return [arrondi((e.clientX - r.left) / r.width), arrondi((e.clientY - r.top) / r.height)];
  }
  function nouveauTrait(x, y) {
    numero += 1;
    return { id: `${prefixe}${numero}`, c: couleur, w: epaisseur, p: [x, y] };
  }
  function envoyer(fini) {
    clearTimeout(envoiPrevu);
    envoiPrevu = null;
    if (!enCours) return;
    dernierEnvoi = performance.now();
    surTrait({ ...enCours, p: enCours.p.slice() }, fini);
  }
  function terminer() {
    if (!enCours) return;
    envoyer(true);
    traits.push(enCours);
    enCours = null;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!actif || doigt !== null) return;
    e.preventDefault();
    remettreEffacer();
    doigt = e.pointerId;
    canvas.setPointerCapture?.(e.pointerId);
    const [x, y] = position(e);
    enCours = nouveauTrait(x, y);
    redessiner();
    envoyer(false);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== doigt || !enCours) return;
    e.preventDefault();
    const evenements = e.getCoalescedEvents?.() ?? [e];
    for (const ev of evenements) {
      const [x, y] = position(ev);
      const p = enCours.p;
      if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < PAS_MIN) continue;
      p.push(x, y);
      // Geste très long : on le coupe pour que chaque envoi reste léger ; le dessin continue sans couture.
      if (p.length >= POINTS_MAX * 2) {
        terminer();
        enCours = nouveauTrait(x, y);
      }
    }
    redessiner();
    const attendu = ENVOI_MS - (performance.now() - dernierEnvoi);
    if (attendu <= 0) envoyer(false);
    else if (!envoiPrevu) envoiPrevu = setTimeout(() => envoyer(false), attendu);
  });
  const lever = (e) => {
    if (e.pointerId !== doigt) return;
    doigt = null;
    terminer();
    redessiner();
  };
  canvas.addEventListener("pointerup", lever);
  canvas.addEventListener("pointercancel", lever);
  // Pas de défilement ni de zoom pendant qu'on dessine.
  canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  function vider() {
    traits.length = 0;
    enCours = null;
    doigt = null;
    redessiner();
  }

  return {
    vider,
    /** Bloque le dessin (avant le top départ, ou à la fin du temps), avec un message sur la feuille. */
    desactiver(message = "") {
      if (enCours) terminer();
      actif = false;
      doigt = null;
      hote.classList.add("ardoise-bloquee");
      attente.textContent = message;
      attente.hidden = !message;
    },
    activer() {
      actif = true;
      hote.classList.remove("ardoise-bloquee");
      attente.hidden = true;
    },
    traits: () => traits.map((t) => ({ ...t, p: t.p.slice() })),
    detruire() {
      observateur?.disconnect();
      window.removeEventListener("resize", ajuster);
      clearTimeout(envoiPrevu);
      clearTimeout(confirmation);
      hote.innerHTML = "";
      hote.classList.remove("ardoise", "ardoise-bloquee");
    },
  };
}

/**
 * Carte du mot secret, montrée au seul dessinateur avant qu'il dessine : l'image et le mot, en grand.
 * [image] est une adresse d'image ou un émoji. La carte se remplace par l'ardoise quand Sarah masque le mot.
 */
export function afficherMotSecret(hote, { mot, image = "" }) {
  hote.classList.add("mot-secret");
  hote.innerHTML = `
    <div class="mot-secret-carte">
      <div class="mot-secret-titre">🤫 Ton mot secret</div>
      <div class="mot-secret-image"></div>
      <div class="mot-secret-mot"></div>
      <div class="mot-secret-consigne">Ne le montre à personne ! Tu vas devoir le dessiner.</div>
    </div>`;
  const cadre = hote.querySelector(".mot-secret-image");
  if (/^(https?:|data:|\/|\.\/)/.test(image)) {
    const img = document.createElement("img");
    img.src = image;
    img.alt = "";
    cadre.append(img);
  } else if (image) {
    cadre.textContent = image;
  } else {
    cadre.remove();
  }
  hote.querySelector(".mot-secret-mot").textContent = mot;
  return {
    masquer() {
      hote.innerHTML = "";
      hote.classList.remove("mot-secret");
    },
  };
}

/**
 * Choix du mot par le dessinateur : trois cartes (image + mot) qu'il fait défiler du doigt ou avec les flèches,
 * puis « Je choisis ce mot ! » ou un toucher de la carte. surChoix(index) n'est appelé qu'une fois ; ensuite la carte confirme le choix.
 * [mots] = [{ mot, image }] (image = adresse ou émoji).
 */
export function choisirMot(hote, mots, { surChoix = () => {} } = {}) {
  hote.classList.add("choix-mot");
  hote.innerHTML = `
    <div class="choix-titre">🤫 Choisis ton mot secret</div>
    <div class="choix-piste">
      <button type="button" class="choix-fleche" data-sens="-1" aria-label="Mot précédent">‹</button>
      <div class="choix-vue"><div class="choix-cartes"></div></div>
      <button type="button" class="choix-fleche" data-sens="1" aria-label="Mot suivant">›</button>
    </div>
    <div class="choix-points"></div>
    <button type="button" class="choix-valider">Je choisis ce mot !</button>`;
  const cartes = hote.querySelector(".choix-cartes");
  const points = hote.querySelector(".choix-points");
  const valider = hote.querySelector(".choix-valider");
  let courant = 0;
  let choisi = false;
  mots.forEach(({ mot, image = "" }, i) => {
    const c = document.createElement("div");
    c.className = "choix-carte";
    const img = document.createElement("div");
    img.className = "mot-secret-image";
    if (/^(https?:|data:|\/|\.\/)/.test(image)) {
      const el = document.createElement("img");
      el.src = image;
      el.alt = "";
      img.append(el);
    } else img.textContent = image;
    const m = document.createElement("div");
    m.className = "mot-secret-mot";
    m.textContent = mot;
    c.append(img, m);
    cartes.append(c);
    const p = document.createElement("button");
    p.type = "button";
    p.className = "choix-point";
    p.setAttribute("aria-label", `Mot ${i + 1}`);
    p.onclick = () => aller(i);
    points.append(p);
  });
  function aller(i) {
    if (choisi) return;
    courant = (i + mots.length) % mots.length;
    cartes.style.transform = `translateX(${-100 * courant}%)`;
    points.querySelectorAll(".choix-point").forEach((p, k) => p.setAttribute("aria-current", String(k === courant)));
  }
  hote.querySelectorAll(".choix-fleche").forEach((b) => { b.onclick = () => aller(courant + Number(b.dataset.sens)); });
  // Glisser du doigt vers la gauche ou la droite.
  let depart = null;
  cartes.addEventListener("pointerdown", (e) => { depart = e.clientX; });
  cartes.addEventListener("pointerup", (e) => {
    if (depart === null) return;
    const dx = e.clientX - depart;
    depart = null;
    if (Math.abs(dx) > 40) aller(courant + (dx < 0 ? 1 : -1));
    // Simple toucher de la carte (sans glisser) : le mot est choisi, comme avec « Je choisis ce mot ! ».
    else if (Math.abs(dx) < 12) valider.onclick();
  });
  valider.onclick = () => {
    if (choisi) return;
    choisi = true;
    hote.classList.add("choix-fait");
    valider.disabled = true;
    valider.textContent = "C'est noté ! L'animatrice connaît ton mot.";
    surChoix(courant);
  };
  aller(0);
  return {
    masquer() {
      hote.innerHTML = "";
      hote.classList.remove("choix-mot", "choix-fait");
    },
  };
}
