/**
 * Le Gonfleur fou sur la tablette : un gros bouton à tapoter, le ballon de l'équipe qui gonfle à chaque tape. La
 * tablette compte elle-même ses tapes et les envoie régulièrement ; la box décide du gagnant. Module autonome,
 * sans Firebase : la page pupitre envoie les tapes (surEnvoi) et passe l'état de la course à maj().
 */

/** Une tablette envoie ses tapes au plus souvent toutes les ENVOI_MS, et tout de suite quand son ballon éclate. */
export const ENVOI_MS = 250;

/**
 * Tapes que les règles de la base acceptent à l'instant [maintenant] (20 par seconde depuis le départ, plus une
 * marge) : la tablette n'envoie jamais plus, le reste part à l'envoi suivant.
 */
export const plafond = (goAt, maintenant) => Math.floor(Math.max(0, maintenant - goAt) / 50) + 8;

/**
 * hote : l'élément qui reçoit l'écran. surTape() est appelé à chaque tape acceptée. appuyer() : une tape venue du
 * gros buzzer USB (comme un doigt sur le bouton). maj(v) redessine :
 * v = { n, cible, actif, titre, texte, couleur }
 */
export function ecranGonfleur(hote, { surTape }) {
  hote.innerHTML = `
    <div class="gf">
      <p class="gf-titre"></p>
      <div class="gf-scene">
        <div class="gf-ballon"><span class="gf-reflet"></span><span class="gf-noeud"></span></div>
        <span class="gf-ficelle"></span>
      </div>
      <div class="gf-jauge"><span class="gf-plein"></span></div>
      <button class="gf-pompe" type="button">Gonflez !</button>
      <p class="gf-texte"></p>
    </div>`;
  const q = (s) => hote.querySelector(s);
  const pompe = q(".gf-pompe");
  const ballon = q(".gf-ballon");
  let actif = false;

  // Une tape : un doigt sur le bouton, ou un appui sur le gros buzzer USB de la tablette (appuyer()).
  function appuyer() {
    if (!actif) return;
    surTape();
    // L'enfoncement du bouton repart à chaque tape, sans forcer la mise en page (void offsetWidth) : sur une tablette
    // modeste, ce calcul forcé à chaque tape retardait les suivantes.
    if (pompe.classList.contains("gf-appui")) {
      pompe.classList.remove("gf-appui");
      requestAnimationFrame(() => pompe.classList.add("gf-appui"));
    } else pompe.classList.add("gf-appui");
  }
  // pointerdown plutôt que click : chaque doigt qui tape compte tout de suite, même très vite.
  pompe.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    appuyer();
  });
  pompe.addEventListener("animationend", () => pompe.classList.remove("gf-appui"));
  // Pas de zoom ni de menu sur un appui long ou un double tap.
  pompe.addEventListener("contextmenu", (ev) => ev.preventDefault());

  function maj(v) {
    actif = v.actif === true;
    const p = Math.max(0, Math.min(1, (v.n ?? 0) / (v.cible || 1)));
    hote.style.setProperty("--gf-couleur", v.couleur ?? "#ff2d8a");
    ballon.style.setProperty("--p", p.toFixed(3));
    ballon.classList.toggle("gf-tendu", p >= 0.8 && p < 1);
    ballon.classList.toggle("gf-eclate", p >= 1);
    q(".gf-plein").style.width = `${Math.round(p * 100)}%`;
    q(".gf-titre").textContent = v.titre ?? "";
    q(".gf-texte").textContent = v.texte ?? "";
    pompe.disabled = !actif;
    pompe.hidden = p >= 1;
  }

  return { maj, appuyer, detruire: () => { hote.innerHTML = ""; } };
}
