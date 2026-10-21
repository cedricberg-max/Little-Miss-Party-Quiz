/**
 * « Ça va exploser ! » sur la tablette. L'équipe qui tient la bombe choisit à qui l'envoyer (un appui sur l'équipe) ; la
 * mèche colle 2 secondes après la réception, l'envoyeur ne peut pas la récupérer (sauf à 2 équipes), et les équipes
 * qui ne l'ont pas encore eue brillent. Ensuite l'équipe a 3 secondes pour l'envoyer : un gros 3, 2, 1 sur la bombe,
 * sinon elle explose chez elle. Les autres voient chez qui elle est. Module autonome, sans Firebase : la page
 * pupitre envoie le choix (surEnvoi) et passe l'état à maj().
 *
 * Habillage : la même bombe que sur la TV, posée sur son socle. Elle tombe chez nous (lueur rouge qui bat autour de
 * l'écran, de plus en plus vite pendant que la mèche brûle, et la tablette vibre à chaque coup si elle a un vibreur),
 * les équipes s'allument une à une quand la mèche ne colle plus, et la bombe s'envole vers l'équipe choisie. Trois
 * bombes par partie : l'explosion se voit aussi sur la tablette, et un petit compteur dit quelle bombe joue.
 * Téléphone droit : tout en colonne ; tablette posée ou téléphone couché : la bombe à gauche, les équipes à droite.
 */

/** La bombe de la TV (sphère prune, bague dorée, mèche qui grésille) sur son socle laqué cerclé d'or. */
const BOMBE_SVG = `
<svg class="pc-dessin" viewBox="0 0 160 170" aria-hidden="true">
  <defs>
    <radialGradient id="pc-sphere" cx="38%" cy="32%" r="70%">
      <stop offset="0" stop-color="#6A5596"/><stop offset=".45" stop-color="#34245A"/><stop offset="1" stop-color="#140A26"/>
    </radialGradient>
    <linearGradient id="pc-or" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFF1B8"/><stop offset=".5" stop-color="#E8B04A"/><stop offset="1" stop-color="#A8701E"/>
    </linearGradient>
    <linearGradient id="pc-socle" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5B3A86"/><stop offset="1" stop-color="#2A1745"/>
    </linearGradient>
    <radialGradient id="pc-feu"><stop offset="0" stop-color="#FFF6C8"/><stop offset=".45" stop-color="#FFB347" stop-opacity=".8"/><stop offset="1" stop-color="#FF5A5F" stop-opacity="0"/></radialGradient>
  </defs>
  <g class="pc-socle">
    <ellipse cx="80" cy="152" rx="56" ry="13" fill="#1A0B2E" opacity=".55"/>
    <path d="M28 140 v8 a52 12 0 0 0 104 0 v-8 z" fill="url(#pc-socle)"/>
    <ellipse cx="80" cy="140" rx="52" ry="12" fill="#4A2F6E" stroke="url(#pc-or)" stroke-width="2.5"/>
    <ellipse cx="80" cy="140" rx="38" ry="7" fill="#2A1745" opacity=".7"/>
  </g>
  <g class="pc-corps">
    <circle cx="76" cy="92" r="44" fill="url(#pc-sphere)"/>
    <ellipse cx="60" cy="72" rx="15" ry="9" fill="#fff" opacity=".28" transform="rotate(-28 60 72)"/>
    <circle cx="54" cy="66" r="4" fill="#fff" opacity=".55"/>
    <g transform="rotate(32 104 52)"><rect x="94" y="40" width="20" height="16" rx="3" fill="url(#pc-or)"/><rect x="94" y="45" width="20" height="3" fill="#8A5A16" opacity=".5"/></g>
    <path d="M110 44 q10 -16 26 -14" fill="none" stroke="#E8D8B8" stroke-width="4" stroke-linecap="round"/>
    <path d="M110 44 q10 -16 26 -14" fill="none" stroke="#9A8460" stroke-width="4" stroke-linecap="round" stroke-dasharray="3 5"/>
    <g class="pc-etincelle">
      <circle cx="137" cy="30" r="15" fill="url(#pc-feu)"/>
      <path d="M137 18 v24 M125 30 h24 M129 22 l16 16 M145 22 l-16 16" stroke="#FFE9A0" stroke-width="2" stroke-linecap="round"/>
      <circle cx="137" cy="30" r="3.5" fill="#fff"/>
    </g>
  </g>
</svg>`;

/** Mèche la plus longue possible (POTATO_FUSE_MAX_MS du moteur) : le rouge bat le plus vite à ce moment-là. */
const MECHE_MAX_MS = 45000;

/**
 * Rythme du rouge qui bat chez l'équipe qui tient la bombe, d'après le temps de mèche déjà brûlé : de 900 ms entre
 * deux coups au départ à 280 ms au bout de la mèche la plus longue. Ne dit jamais quand la bombe explosera.
 */
export function rythmeBombe(brule) {
  const tension = Math.max(0, Math.min(1, brule / MECHE_MAX_MS));
  return { periode: Math.round(900 - 620 * tension), vibre: Math.round(40 + 80 * tension) };
}

/**
 * hote : l'élément qui reçoit l'écran. surEnvoi(equipe) envoie la bombe (une promesse). maj(v) redessine :
 * v = {
 *   titre, texte, aMoi, chaude (la bombe est chez nous), envoye (équipe choisie, en cours d'envoi, ou null),
 *   colle (0 à 1 : mèche qui colle, 1 = on peut envoyer), equipes: [{ id, nom, couleur, permise, envoyeur, neuve }],
 *   compteur (« Bombe 2 sur 3 » ou ""), brule (heure de la tablette où la mèche a commencé à brûler, ou null),
 *   boum (la bombe vient d'exploser), boumChezMoi (chez nous),
 *   decompte (3, 2 ou 1 : secondes qu'il reste pour l'envoyer, ou null)
 * }
 */
export function ecranPatate(hote, { surEnvoi }) {
  hote.innerHTML = `
    <div class="pc">
      <div class="pc-scene">
        <p class="pc-compteur" hidden></p>
        <div class="pc-bombe" aria-hidden="true"><div class="pc-halo"></div>${BOMBE_SVG}<p class="pc-decompte" hidden></p></div>
        <p class="pc-titre"></p>
        <p class="pc-texte"></p>
        <div class="pc-colle"><span></span></div>
      </div>
      <div class="pc-equipes"></div>
    </div>`;
  const q = (s) => hote.querySelector(s);
  const racine = q(".pc");
  const bombe = q(".pc-bombe");
  const liste = q(".pc-equipes");
  let dernier = null;
  let signature = "";
  let avant = { aMoi: false, pret: false, envoye: null };
  let battement = null;

  /** Rejoue une animation CSS ponctuelle (classe retirée puis remise). */
  function rejouer(el, classe) {
    el.classList.remove(classe);
    void el.offsetWidth;
    el.classList.add(classe);
  }

  /**
   * Un coup du rouge qui bat (et une vibration), puis le suivant, plus tôt à mesure que la mèche brûle. S'arrête dès
   * que la bombe n'est plus chez nous, part, ou que la mèche ne brûle plus (pause, explosion).
   */
  function battre() {
    battement = null;
    const d = dernier;
    if (!d?.aMoi || d.envoye || d.brule == null) return;
    const { periode, vibre } = rythmeBombe(Date.now() - d.brule);
    racine.style.setProperty("--pc-coup", `${Math.min(periode - 40, 520)}ms`);
    rejouer(racine, "pc-bat");
    // Pas de vibreur (la plupart des tablettes) : navigator.vibrate n'existe pas ou ne fait rien, le rouge suffit.
    try { navigator.vibrate?.(vibre); } catch { /* vibreur refusé : rien */ }
    battement = setTimeout(battre, periode);
  }

  function maj(v) {
    dernier = v;
    const aMoi = v.aMoi === true;
    racine.classList.toggle("pc-chez-moi", aMoi);
    racine.classList.toggle("pc-boum", v.boum === true);
    racine.classList.toggle("pc-boum-moi", v.boum === true && v.boumChezMoi === true);
    q(".pc-compteur").textContent = v.compteur ?? "";
    q(".pc-compteur").hidden = !v.compteur;
    // Le rouge bat dès que la bombe a fini de tomber chez nous, tant que la mèche brûle.
    const bat = aMoi && !v.envoye && v.brule != null;
    if (bat && battement == null) battement = setTimeout(battre, avant.aMoi ? 0 : 760);
    if (!bat) { clearTimeout(battement); battement = null; racine.classList.remove("pc-bat"); }
    // 3, 2, 1 sur la bombe : il reste si peu pour l'envoyer ; chaque chiffre arrive en grand.
    const chiffre = q(".pc-decompte");
    const n = aMoi && !v.envoye && v.decompte != null ? String(v.decompte) : "";
    chiffre.hidden = !n;
    if (n && chiffre.textContent !== n) { chiffre.textContent = n; rejouer(chiffre, "pc-tic"); }
    if (!n) chiffre.textContent = "";
    q(".pc-titre").textContent = v.titre ?? "";
    q(".pc-texte").textContent = v.texte ?? "";
    const colle = Math.max(0, Math.min(1, v.colle ?? 1));
    q(".pc-colle").hidden = !aMoi || colle >= 1;
    q(".pc-colle span").style.width = `${Math.round(colle * 100)}%`;
    const equipes = aMoi ? v.equipes ?? [] : [];
    // Liste reconstruite seulement quand les équipes changent : un bouton ne bouge pas sous le doigt.
    const sig = equipes.map((e) => `${e.id}:${e.nom}:${e.couleur}`).join("|");
    if (sig !== signature) {
      signature = sig;
      liste.replaceChildren(...equipes.map((e, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pc-equipe";
        b.dataset.id = e.id;
        b.style.setProperty("--eq", e.couleur ?? "#fff");
        b.style.setProperty("--i", i);
        const nom = document.createElement("span");
        nom.className = "pc-nom";
        nom.textContent = e.nom;
        const note = document.createElement("small");
        b.append(nom, note);
        b.onclick = () => {
          const d = dernier;
          const cible = d?.equipes?.find((x) => x.id === e.id);
          if (!d?.aMoi || d.envoye || (d.colle ?? 1) < 1 || !cible?.permise) return;
          navigator.vibrate?.(60);
          surEnvoi(e.id);
        };
        return b;
      }));
    }
    racine.classList.toggle("pc-une-choisie", !!v.envoye);
    liste.querySelectorAll(".pc-equipe").forEach((b) => {
      const e = equipes.find((x) => x.id === b.dataset.id);
      if (!e) return;
      b.disabled = !e.permise || colle < 1 || !!v.envoye;
      b.classList.toggle("pc-neuve", e.permise && e.neuve);
      b.classList.toggle("pc-choisie", v.envoye === e.id);
      b.querySelector("small").textContent = e.envoyeur && !e.permise ? "vient de vous l'envoyer" : e.neuve ? "pas encore touchée\u00a0!" : "";
    });

    // Animations ponctuelles : la bombe tombe chez nous, les équipes s'allument, la bombe s'envole.
    const pret = aMoi && colle >= 1 && !v.envoye;
    if (aMoi && !avant.aMoi) {
      racine.classList.remove("pc-partie");
      rejouer(bombe, "pc-arrive");
      // Posée : elle peut battre.
      setTimeout(() => bombe.classList.remove("pc-arrive"), 720);
    }
    if (pret && !avant.pret) rejouer(liste, "pc-allume");
    if (aMoi && v.envoye && v.envoye !== avant.envoye) {
      const cible = liste.querySelector(`.pc-equipe[data-id="${CSS.escape(v.envoye)}"]`);
      if (cible) {
        // Le vol se fait dans le dessin (160 unités de large) : l'écart à l'écran est remis à son échelle.
        const a = bombe.getBoundingClientRect();
        const c = cible.getBoundingClientRect();
        const k = 160 / Math.max(1, a.width);
        bombe.style.setProperty("--vx", `${Math.round((c.left + c.width / 2 - (a.left + a.width / 2)) * k)}px`);
        bombe.style.setProperty("--vy", `${Math.round((c.top + c.height / 2 - (a.top + a.height * 0.55)) * k)}px`);
      }
      bombe.classList.remove("pc-arrive");
      rejouer(racine, "pc-partie");
    }
    if (!v.envoye) racine.classList.remove("pc-partie");
    avant = { aMoi, pret, envoye: v.envoye ?? null };
  }

  return { maj, detruire: () => { clearTimeout(battement); battement = null; hote.innerHTML = ""; } };
}
