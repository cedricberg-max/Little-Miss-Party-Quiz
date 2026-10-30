/**
 * 🔴 Le Simon du Prof sur la tablette. Pendant que le robot montre la suite à la TV : « Regarde bien la TV… ». Puis le
 * joueur appelé tape la suite : 8 grosses boules de couleur en haut, les chiffres en dessous une fois qu'ils ont
 * débarqué, sa suite en bas (« Ta suite (5/8) »), « Effacer » le dernier élément et « Valider » quand elle est complète.
 * Chaque appui joue la note de sa couleur. Ensuite : envoyé, éliminé du tour, ou gagné. Module autonome, sans Firebase :
 * la page pupitre envoie la saisie (surSaisie, surValider) et passe l'état à maj().
 * Téléphone ou tablette droits : tout en colonne. Couchés : les boules et les chiffres à gauche, la suite à droite.
 */

/** Les 8 couleurs (mêmes codes que le moteur), dans l'ordre des boules, et leur teinte. */
export const SIMON_COULEURS = [
  ["rouge", "#ff2a2a"], ["orange", "#ff8c00"], ["jaune", "#ffe81a"], ["vert", "#2bd94a"],
  ["bleu", "#1e88ff"], ["violet", "#a020ff"], ["rose", "#ff7ad9"], ["blanc", "#ffffff"],
];
export const SIMON_CHIFFRES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const TEINTE = Object.fromEntries(SIMON_COULEURS);

/** La note de chaque élément (gamme de do, puis plus aigu pour les chiffres), en hertz. */
const NOTES = {
  rouge: 262, orange: 294, jaune: 330, vert: 349, bleu: 392, violet: 440, rose: 494, blanc: 523,
  1: 587, 2: 659, 3: 698, 4: 784, 5: 880, 6: 988, 7: 1047, 8: 1175, 9: 1319, 0: 1397,
};
export const noteSimon = (item) => NOTES[item] ?? 440;

/** Un élément de suite (boule ou chiffre), petit, pour la bande « Ta suite ». */
function pastille(item) {
  const el = document.createElement("span");
  if (item == null) { el.className = "sm-vide"; return el; }
  if (TEINTE[item]) { el.className = "sm-mini sm-boule"; el.style.setProperty("--c", TEINTE[item]); }
  else { el.className = "sm-mini sm-tuile"; el.textContent = item; }
  return el;
}

export function ecranSimon(hote, { surTouche, surEffacer, surValider }) {
  hote.innerHTML = `
    <div class="sm">
      <p class="sm-joueur" hidden></p>
      <h2 class="sm-titre"></h2>
      <p class="sm-texte"></p>
      <div class="sm-chrono" hidden><span></span></div>
      <div class="sm-pave">
        <div class="sm-boules"></div>
        <p class="sm-sep" hidden>— Les chiffres —</p>
        <div class="sm-chiffres" hidden></div>
      </div>
      <div class="sm-bas">
        <p class="sm-compte"></p>
        <div class="sm-suite"></div>
        <div class="sm-actions">
          <button type="button" class="sm-effacer">⌫ Effacer</button>
          <button type="button" class="sm-valider">Valider ✓</button>
        </div>
      </div>
    </div>`;
  const q = (s) => hote.querySelector(s);
  const racine = q(".sm");
  let dernier = null;

  /** Un appui pris dès que le doigt touche (pas au relâché) : les petits doigts vont vite. */
  function toucher(b, action) {
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (b.disabled) return;
      b.classList.remove("sm-appui");
      void b.offsetWidth;
      b.classList.add("sm-appui");
      action();
    });
  }

  SIMON_COULEURS.forEach(([item, c]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sm-touche sm-boule";
    b.dataset.item = item;
    b.style.setProperty("--c", c);
    b.setAttribute("aria-label", item);
    toucher(b, () => surTouche(item));
    q(".sm-boules").appendChild(b);
  });
  SIMON_CHIFFRES.forEach((item) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sm-touche sm-tuile";
    b.dataset.item = item;
    b.textContent = item;
    toucher(b, () => surTouche(item));
    q(".sm-chiffres").appendChild(b);
  });
  toucher(q(".sm-effacer"), () => surEffacer());
  toucher(q(".sm-valider"), () => surValider());

  /**
   * v = { etat: "attente" | "regarde" | "chiffres" | "joue" | "envoye" | "elimine" | "gagne" | "continue" | "spectateur",
   *       titre, texte, joueur, chiffres (pavé des chiffres montré), saisie (éléments tapés), longueur, chrono (0..1 restant) }
   */
  function maj(v) {
    dernier = v;
    racine.dataset.etat = v.etat;
    q(".sm-titre").textContent = v.titre ?? "";
    q(".sm-texte").textContent = v.texte ?? "";
    q(".sm-texte").hidden = !v.texte;
    q(".sm-joueur").textContent = v.joueur ?? "";
    q(".sm-joueur").hidden = !v.joueur;
    const joue = v.etat === "joue";
    racine.classList.toggle("sm-a-moi", joue);
    // Le pavé : seulement quand c'est à nous de taper (le reste du temps, on regarde la TV).
    q(".sm-pave").hidden = !joue;
    q(".sm-bas").hidden = !(joue || v.etat === "envoye");
    q(".sm-sep").hidden = !v.chiffres;
    q(".sm-chiffres").hidden = !v.chiffres;
    // Sans chiffres (cedric, 29/10 : que des couleurs, comme un vrai Simon) : les boules prennent la place libérée.
    racine.classList.toggle("sm-sans-chiffres", !v.chiffres);
    const saisie = v.saisie ?? [];
    const n = Math.max(v.longueur ?? 0, saisie.length);
    q(".sm-compte").textContent = n ? `Ta suite (${saisie.length}/${n})` : "";
    q(".sm-suite").replaceChildren(...Array.from({ length: n }, (_, i) => pastille(saisie[i])));
    const plein = saisie.length >= n;
    hote.querySelectorAll(".sm-touche").forEach((b) => { b.disabled = !joue || plein; });
    q(".sm-effacer").disabled = !joue || saisie.length === 0;
    q(".sm-valider").disabled = !joue || !plein;
    q(".sm-valider").classList.toggle("sm-pret", joue && plein);
    const chrono = q(".sm-chrono");
    chrono.hidden = !joue || v.chrono == null;
    if (v.chrono != null) {
      chrono.querySelector("span").style.width = `${Math.round(Math.max(0, Math.min(1, v.chrono)) * 100)}%`;
      chrono.classList.toggle("sm-presse", v.chrono < 0.3);
    }
  }

  return { maj, get etat() { return dernier?.etat; } };
}
