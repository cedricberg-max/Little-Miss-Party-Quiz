/**
 * Animation des tablettes qui ne dessinent pas, pendant le Pictionary : Buzzy peintre dans son atelier (cedric 11-01).
 * Une série de petites vidéos (le chat, Madame Buzzy, le Président robot, la maison…) qui passent au hasard, sans
 * répétition, en fondu de l'une à l'autre. Chaque vidéo existe en paysage et en portrait, avec exactement la même
 * action et la même durée : si la tablette pivote, on bascule en direct sur l'autre version, au même instant,
 * avec un fondu court. Module autonome, sans Firebase.
 */

export const CLIPS_BUZZY = [
  "chat", "femme", "president", "maison", "paysage", "autoportrait", "grillepain",
  "mouche", "eternuement", "maman", "illisible", "banane", "joconde",
];
const DOSSIER = "videos/buzzy-peintre/";
const FONDU_CLIP_MS = 450;
const FONDU_ROTATION_MS = 250;

const BANDEAUX = {
  choix: (equipe) => `L'équipe « ${equipe} » choisit son mot secret… chut !`,
  dessin: (equipe) => `L'équipe « ${equipe} » dessine : regardez la télé !`,
};

const portrait = () => window.matchMedia?.("(orientation: portrait)").matches ?? window.innerHeight > window.innerWidth;
export const fichierClip = (nom, enPortrait) => `${DOSSIER}${nom}-${enPortrait ? "portrait" : "paysage"}.mp4`;

/** Tirage au sort sans remise : toutes les vidéos passent avant qu'une revienne, jamais deux fois de suite. */
export function pioche(liste, hasard = Math.random) {
  let sac = [];
  let dernier = null;
  return () => {
    if (!sac.length) {
      sac = [...liste];
      for (let i = sac.length - 1; i > 0; i--) { const j = Math.floor(hasard() * (i + 1)); [sac[i], sac[j]] = [sac[j], sac[i]]; }
      if (sac.length > 1 && sac[sac.length - 1] === dernier) [sac[0], sac[sac.length - 1]] = [sac[sac.length - 1], sac[0]];
    }
    dernier = sac.pop();
    return dernier;
  };
}

/**
 * Lance l'animation dans [hote]. options : { equipe } (l'équipe qui dessine, citée dans le bandeau),
 * { phase } : "choix" pendant que le dessinateur choisit son mot, "dessin" ensuite.
 * Rend { changerPhase(phase), arreter() } ; arreter() quand le tour se termine.
 */
export function animationSpectateurs(hote, { equipe = "l'équipe", phase = "dessin" } = {}) {
  hote.classList.add("spectateurs");
  hote.innerHTML = `
    <div class="sp-titre">Pictionary</div>
    <div class="sp-ecran" aria-hidden="true">
      <video class="sp-video" muted playsinline preload="auto"></video>
      <video class="sp-video" muted playsinline preload="auto"></video>
    </div>
    <div class="sp-bandeau"></div>`;
  const bandeau = hote.querySelector(".sp-bandeau");
  const changerPhase = (p) => { bandeau.textContent = (BANDEAUX[p] ?? BANDEAUX.dessin)(equipe); };
  changerPhase(phase);

  const [v1, v2] = hote.querySelectorAll(".sp-video");
  const suivant = pioche(CLIPS_BUZZY);
  let actif = v1;
  let enPortrait = portrait();
  let arrete = false;
  let echecs = 0;
  const autre = () => (actif === v1 ? v2 : v1);

  function montrer(v, ms) {
    v.style.transition = `opacity ${ms}ms ease`;
    const ancien = actif;
    actif = v;
    v.classList.add("sp-visible");
    if (ancien !== v) {
      ancien.classList.remove("sp-visible");
      setTimeout(() => { if (ancien !== actif) ancien.pause(); }, ms + 50);
    }
  }

  const attendre = (v, evt) => new Promise((ok, ko) => {
    const fini = () => { v.removeEventListener(evt, pret); v.removeEventListener("error", rate); };
    const pret = () => { fini(); ok(); };
    const rate = () => { fini(); ko(new Error(evt)); };
    v.addEventListener(evt, pret);
    v.addEventListener("error", rate);
  });
  async function charger(v, nom) {
    v.dataset.clip = nom;
    const pret = attendre(v, "canplay");
    v.src = fichierClip(nom, enPortrait);
    v.load?.();
    await pret;
  }
  // Place la vidéo à l'instant t et attend que l'image soit prête.
  async function caler(v, t) {
    if (Math.abs(v.currentTime - t) < 0.02) return;
    const fait = attendre(v, "seeked");
    v.currentTime = t;
    await fait;
  }

  async function clipSuivant() {
    if (arrete) return;
    const v = autre();
    const nom = suivant();
    try {
      await charger(v, nom);
      if (arrete) return;
      echecs = 0;
      await caler(v, 0);
      await v.play().catch(() => {});
      montrer(v, FONDU_CLIP_MS);
    } catch {
      // Vidéo absente ou illisible : on passe à la suivante (sans boucler à l'infini si tout manque).
      if (++echecs < CLIPS_BUZZY.length) clipSuivant();
    }
  }

  // Fin d'une vidéo → la suivante, en fondu.
  const finVideo = (e) => { if (e.target === actif) clipSuivant(); };
  v1.addEventListener("ended", finVideo);
  v2.addEventListener("ended", finVideo);

  // La tablette pivote : même vidéo, même instant, dans l'autre cadrage.
  async function pivoter() {
    const p = portrait();
    if (p === enPortrait || arrete) return;
    enPortrait = p;
    const nom = actif.dataset.clip;
    if (!nom) return;
    const v = autre();
    try {
      await charger(v, nom);
      if (arrete || actif.dataset.clip !== nom) return;
      await caler(v, Math.min(actif.currentTime + 0.08, (v.duration || 99) - 0.05));
      if (arrete || actif.dataset.clip !== nom) return;
      await v.play().catch(() => {});
      montrer(v, FONDU_ROTATION_MS);
    } catch {
      /* l'autre version manque : on garde celle qui tourne */
    }
  }
  const media = window.matchMedia?.("(orientation: portrait)");
  media?.addEventListener?.("change", pivoter);
  window.addEventListener("resize", pivoter);

  clipSuivant();

  return {
    changerPhase,
    arreter() {
      arrete = true;
      media?.removeEventListener?.("change", pivoter);
      window.removeEventListener("resize", pivoter);
      for (const v of [v1, v2]) { v.pause(); v.removeAttribute("src"); v.load?.(); }
      hote.innerHTML = "";
      hote.classList.remove("spectateurs");
    },
  };
}
