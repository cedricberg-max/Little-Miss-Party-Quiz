/**
 * Portes mystères sur la tablette : chaque équipe choisit sa porte en secret, puis voit le résultat de la sienne
 * une fois que la télé l'a ouverte. Module autonome, sans Firebase : la page pupitre envoie le choix et décide
 * de l'écran à montrer.
 */

const STYLES = ["pm-bleu", "pm-bordeaux", "pm-emeraude", "pm-prune"];

// Porte art déco : cadre doré à gradins, battant laqué (soleil, médaille numérotée, panneau mouluré, poignée).
const porteHTML = (k, contenu = "") => `
  <div class="pm-porte ${STYLES[k % STYLES.length]}">
    <div class="pm-spot"></div><div class="pm-sol"></div><div class="pm-cadre"></div>
    <div class="pm-interieur">${contenu}</div>
    <div class="pm-battant"><div class="pm-soleil"></div><div class="pm-numero">${k + 1}</div><div class="pm-panneau"></div><div class="pm-poignee"></div></div>
  </div>`;

const pastille = (equipe) => {
  const el = document.createElement("div");
  el.className = "pm-equipe";
  el.textContent = equipe?.nom ?? "";
  if (equipe?.couleur) el.style.setProperty("--eq", equipe.couleur);
  return el;
};

/** « +150 POINTS », « −150 POINTS » (vrai signe moins), comme sur la télé. */
export function texteDelta(v) {
  const n = Math.abs(v);
  return `${v < 0 ? "−" : "+"}${n} ${n === 1 ? "POINT" : "POINTS"}`;
}

export function nomContenu(v) {
  if (v < 0) return "La tuile";
  if (v >= 300) return "Jackpot";
  if (v >= 150) return "Bonus";
  return "Petit bonus";
}

/**
 * Choix de la porte. options : { nombre (3 ou 4), equipe: { nom, couleur }, surChoix(i) }.
 * surChoix n'est appelé qu'une fois, quand l'équipe valide. Rend :
 * - verrouiller(i) : montre « Porte i+1 choisie » sans rappeler surChoix (reconnexion, choix déjà enregistré) ;
 * - attente(texte) : écran d'attente (« Regardez la télé ! ») ;
 * - detruire().
 */
export function choisirPorte(hote, { nombre = 4, equipe = null, surChoix = () => {} } = {}) {
  const n = Math.max(1, Math.min(4, nombre));
  let choisie = -1;
  let fait = false;
  hote.classList.add("pm");

  function choix() {
    hote.innerHTML = `
      <div class="pm-titre">Choisissez votre porte !</div>
      <div class="pm-portes pm-n${n}">${Array.from({ length: n }, (_, k) =>
        `<button type="button" class="pm-mini" data-k="${k}" aria-pressed="false" aria-label="Porte ${k + 1}">${porteHTML(k)}</button>`).join("")}</div>
      <button type="button" class="pm-choisir" disabled>Touchez une porte</button>
      <div class="pm-texte">Derrière chaque porte : un bonus… ou une tuile !</div>`;
    hote.prepend(pastille(equipe));
    const bouton = hote.querySelector(".pm-choisir");
    hote.querySelectorAll(".pm-mini").forEach((b) => {
      b.onclick = () => {
        if (fait) return;
        choisie = Number(b.dataset.k);
        hote.querySelectorAll(".pm-mini").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        hote.querySelector(".pm-portes").classList.add("pm-une-choisie");
        bouton.disabled = false;
        bouton.textContent = `Je choisis la porte ${choisie + 1} !`;
      };
    });
    bouton.onclick = () => {
      if (fait || choisie < 0) return;
      fait = true;
      verrouiller(choisie);
      surChoix(choisie);
    };
  }

  function verrouiller(i) {
    fait = true;
    choisie = i;
    hote.innerHTML = `
      <div class="pm-cadenas">🔒</div>
      <div class="pm-titre"></div>
      <div class="pm-texte">Suspense… Personne ne sait ce qu'il y a derrière. Regardez la télé !</div>`;
    hote.querySelector(".pm-titre").textContent = `Porte ${i + 1} choisie…`;
    hote.prepend(pastille(equipe));
  }

  function attente(texte = "Regardez la télé !") {
    hote.innerHTML = `
      <div class="pm-attente">${Array.from({ length: n }, () => "<span></span>").join("")}</div>
      <div class="pm-titre"></div>`;
    hote.querySelector(".pm-titre").textContent = texte;
    hote.prepend(pastille(equipe));
  }

  choix();
  return {
    verrouiller,
    attente,
    detruire() {
      hote.innerHTML = "";
      hote.classList.remove("pm");
    },
  };
}

/**
 * Résultat de l'équipe une fois sa porte ouverte à la télé. options : { valeur, porte (index), equipe }.
 * Rend { detruire() }.
 */
export function ecranPorteOuverte(hote, { valeur, porte = 0, equipe = null }) {
  hote.classList.add("pm");
  const malus = valeur < 0;
  const contenu = `<div class="pm-revele ${malus ? "pm-malus" : ""}"><div class="pm-valeur"></div><div class="pm-nom"></div></div>`;
  hote.innerHTML = `
    <div class="pm-titre"></div>
    <div class="pm-mini pm-resultat">${porteHTML(porte, contenu)}</div>
    <div class="pm-points ${malus ? "pm-moins" : ""}"></div>`;
  hote.querySelector(".pm-titre").textContent = malus ? "Aïe, la tuile !" : valeur >= 300 ? "JACKPOT !" : "Bravo !";
  hote.querySelector(".pm-valeur").textContent = `${valeur < 0 ? "−" : "+"}${Math.abs(valeur)}`;
  hote.querySelector(".pm-nom").textContent = nomContenu(valeur).toUpperCase();
  hote.querySelector(".pm-points").textContent = texteDelta(valeur);
  if (equipe) hote.prepend(pastille(equipe));
  // La porte s'ouvre juste après l'affichage.
  requestAnimationFrame(() => requestAnimationFrame(() => hote.querySelector(".pm-porte")?.classList.add("pm-ouverte")));
  return {
    detruire() {
      hote.innerHTML = "";
      hote.classList.remove("pm");
    },
  };
}
