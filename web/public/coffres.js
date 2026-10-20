/**
 * La bombe cachée sur la tablette : les coffres de la TV, chacun son tour. L'équipe qui joue choisit un coffre fermé
 * et l'ouvre ; les autres regardent qui joue et ce qui sort. Module autonome, sans Firebase : la page pupitre envoie
 * le choix et passe l'état de la partie à maj().
 */

/** Apparence de chaque coffre, la même que sur la TV (habillage/BombeCachee.kt, modeleCoffre). */
const MODELES = [0, 3, 1, 5, 2, 4, 1, 5, 0, 4, 3, 2, 5, 0, 2, 4, 1, 3];
export const modeleCoffre = (i) => MODELES[i % MODELES.length];

/** Plaque dorée de chaque dessin (img/coffres/coffre-N.svg) : centre vertical et hauteur, en % de l'image. */
const PLAQUES = [[64.6, 26.6], [56.1, 26.9], [64.8, 25.3], [60.4, 25.6], [60.8, 26.5], [63.6, 26.5]];

/** Le contenu d'un coffre ne s'affiche sur la tablette qu'une fois montré par la TV (pas de suspense gâché). */
export const REVELATION_MS = 1800;

/** « +150 », « −100 » (vrai signe moins), comme sur la TV. */
export const signe = (v) => `${v < 0 ? "−" : "+"}${Math.abs(v)}`;

const coffreHTML = (i) => {
  const m = modeleCoffre(i);
  const [y, h] = PLAQUES[m];
  return `
  <span class="bc-coffre bc-m${m}">
    <span class="bc-lueur"></span>
    <img class="bc-image" src="img/coffres/coffre-${m + 1}.svg" alt="" draggable="false">
    <span class="bc-plaque" style="top:${y}%;height:${h}%">${i + 1}</span>
    <span class="bc-contenu"></span>
  </span>`;
};

/**
 * hote : l'élément qui reçoit l'écran. surChoix(i) envoie le coffre choisi (une promesse) ; maj(v) redessine :
 * v = {
 *   pret, cle (une par ouverture), count, ouverts: [{ chest, delta, bomb, team, visible }],
 *   joue: { nom, couleur } | null (équipe qui ouvre), aMoi, peutOuvrir, envoye (coffre envoyé ou null),
 *   titre, texte, danger, bilan: [{ nom, couleur, gain, moi }] | null, total
 * }
 */
export function ecranCoffres(hote, { surChoix }) {
  hote.innerHTML = `
    <div class="bc">
      <div class="bc-tete"><span class="bc-titre"></span><span class="bc-danger" hidden>💣 La bombe est cachée !</span></div>
      <p class="bc-texte"></p>
      <div class="bc-grille"></div>
      <button class="bc-ouvrir" type="button" hidden>Ouvrir ce coffre !</button>
      <div class="bc-bilan" hidden></div>
      <p class="bc-total"></p>
    </div>`;
  const q = (s) => hote.querySelector(s);
  const grille = q(".bc-grille");
  const bouton = q(".bc-ouvrir");
  let count = -1;
  let cle = null;
  let choix = null;
  let dernier = null;

  bouton.onclick = () => {
    if (choix == null || bouton.disabled || !dernier?.peutOuvrir) return;
    bouton.disabled = true;
    surChoix(choix);
  };

  function maj(v) {
    dernier = v;
    q(".bc-titre").textContent = v.titre ?? "";
    q(".bc-texte").textContent = v.texte ?? "";
    q(".bc-danger").hidden = !v.danger || !!v.bilan;
    const tete = q(".bc-titre");
    tete.style.setProperty("--eq", v.joue?.couleur ?? "#fff3d1");
    tete.classList.toggle("bc-equipe", !!v.joue && !v.bilan);

    // Une nouvelle ouverture : la sélection repart à zéro.
    if (v.cle !== cle) { cle = v.cle; choix = null; }
    if (v.count !== count) {
      count = v.count ?? 0;
      grille.innerHTML = "";
      grille.style.setProperty("--n", `${count}`);
      for (let i = 0; i < count; i++) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "bc-case";
        b.setAttribute("aria-label", `Coffre ${i + 1}`);
        b.innerHTML = coffreHTML(i);
        b.onclick = () => {
          if (b.disabled) return;
          choix = i;
          navigator.vibrate?.(20);
          maj(dernier);
        };
        grille.appendChild(b);
      }
    }
    const ouverts = new Map((v.ouverts ?? []).map((o) => [o.chest, o]));
    const actif = v.aMoi && v.envoye == null;
    if (choix != null && ouverts.has(choix)) choix = null;
    grille.classList.toggle("bc-a-moi", actif);
    grille.classList.toggle("bc-une-choisie", actif && choix != null);
    grille.querySelectorAll(".bc-case").forEach((b, i) => {
      const o = ouverts.get(i);
      const visible = o?.visible === true;
      b.disabled = !actif || !!o;
      b.setAttribute("aria-pressed", `${(actif && choix === i) || v.envoye === i}`);
      b.classList.toggle("bc-envoye", v.envoye === i);
      b.classList.toggle("bc-ouvert", !!o);
      b.classList.toggle("bc-attente", !!o && !visible);
      b.classList.toggle("bc-bombe", visible && o.bomb);
      b.classList.toggle("bc-plus", visible && !o.bomb && o.delta > 0);
      b.classList.toggle("bc-moins", visible && !o.bomb && o.delta <= 0);
      b.style.setProperty("--eq", o?.couleur ?? "transparent");
      const contenu = b.querySelector(".bc-contenu");
      const texte = !o ? "" : !visible ? "?" : o.bomb ? "💣" : signe(o.delta);
      if (contenu.textContent !== texte) contenu.textContent = texte;
      b.title = o ? `${o.nom ?? ""}${visible ? ` : ${o.bomb ? "la bombe" : signe(o.delta)}` : ""}` : "";
    });
    bouton.hidden = !actif;
    bouton.disabled = choix == null || !v.peutOuvrir;
    bouton.textContent = choix == null ? "Touchez un coffre" : `Ouvrir le coffre ${choix + 1} !`;

    const bilan = q(".bc-bilan");
    bilan.hidden = !v.bilan;
    grille.hidden = !!v.bilan;
    if (v.bilan) {
      bilan.innerHTML = "";
      v.bilan.forEach((l) => {
        const ligne = document.createElement("div");
        ligne.className = `bc-ligne${l.moi ? " bc-moi" : ""}`;
        ligne.style.setProperty("--eq", l.couleur ?? "#fff");
        const nom = document.createElement("span");
        nom.className = "bc-nom";
        nom.textContent = l.nom;
        const gain = document.createElement("span");
        gain.className = `bc-gain ${l.gain > 0 ? "bc-g-plus" : l.gain < 0 ? "bc-g-moins" : ""}`;
        gain.textContent = l.gain === 0 ? "0" : signe(l.gain);
        ligne.append(nom, gain);
        bilan.appendChild(ligne);
      });
    }
    q(".bc-total").textContent = v.total ?? "";
  }

  return { maj, detruire: () => { hote.innerHTML = ""; } };
}
