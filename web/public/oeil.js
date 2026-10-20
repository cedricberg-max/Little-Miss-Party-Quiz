/**
 * Petit œil à droite de chaque champ de mot de passe : un appui montre ce qui est tapé (pour repérer une majuscule ou
 * un caractère en trop), un second le masque à nouveau. Module autonome, sans dépendance : afficherMotsDePasse(racine)
 * équipe tous les champs « password » de la page.
 */

const OEIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const OEIL_BARRE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/></svg>';

const STYLE = `
.oeil-champ { position: relative; display: block; }
.oeil-champ > input { width: 100%; padding-right: 48px; box-sizing: border-box; }
.oeil-bouton { position: absolute; top: 50%; right: 6px; transform: translateY(-50%); width: 38px; height: 38px; padding: 7px;
  border: 0; border-radius: 50%; background: transparent; color: inherit; opacity: .6; cursor: pointer; }
.oeil-bouton:hover, .oeil-bouton:focus-visible { opacity: 1; background: rgba(127, 127, 127, .15); }
.oeil-bouton svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }`;

/** Ajoute l'œil à un champ (une seule fois). */
export function ajouterOeil(champ) {
  if (champ.dataset.oeil) return;
  champ.dataset.oeil = "1";
  const boite = document.createElement("span");
  boite.className = "oeil-champ";
  champ.replaceWith(boite);
  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = "oeil-bouton";
  const maj = () => {
    const visible = champ.type === "text";
    bouton.innerHTML = visible ? OEIL_BARRE : OEIL;
    bouton.setAttribute("aria-label", visible ? "Masquer le mot de passe" : "Afficher le mot de passe");
    bouton.title = bouton.getAttribute("aria-label");
  };
  bouton.onclick = (e) => {
    e.preventDefault();
    champ.type = champ.type === "password" ? "text" : "password";
    maj();
    champ.focus();
  };
  boite.append(champ, bouton);
  // Envoyé : le mot de passe redevient masqué pour la prochaine fois.
  champ.form?.addEventListener("submit", () => { champ.type = "password"; maj(); });
  // Champ caché par la page (ex. code à 4 chiffres à la place du mot de passe) : l'œil disparaît avec lui.
  boite.hidden = champ.hidden;
  new MutationObserver(() => { boite.hidden = champ.hidden; }).observe(champ, { attributes: true, attributeFilter: ["hidden"] });
  maj();
}

/** Équipe tous les champs de mot de passe sous [racine]. */
export function afficherMotsDePasse(racine = document) {
  if (!document.getElementById("oeil-style")) {
    const s = document.createElement("style");
    s.id = "oeil-style";
    s.textContent = STYLE;
    document.head.append(s);
  }
  racine.querySelectorAll('input[type="password"]').forEach(ajouterOeil);
}
