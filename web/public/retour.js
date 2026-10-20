/**
 * « ↩ Retour » et « Annuler les modifications » dans les écrans d'édition de la Régie PC.
 * Chaque écran garde ses états successifs (en mémoire, rien n'est écrit) : Retour revient à l'état d'avant la
 * dernière action, Annuler revient au dernier enregistrement (ou à l'ouverture de l'écran). Annuler est lui-même
 * une action : un Retour juste après rend les modifications. Enregistrer fixe le nouveau point de départ.
 */

/** Copie profonde des objets et tableaux simples ; les fichiers (photos, morceaux pas encore envoyés) gardés tels quels. */
const cloner = (v) => (Array.isArray(v) ? v.map(cloner)
  : v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype
    ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cloner(x)]))
    : v);

const empreinte = (v) => JSON.stringify(v ?? null, (k, x) => (typeof Blob !== "undefined" && x instanceof Blob ? `fichier:${x.name ?? ""}:${x.size}` : x));

/** Au plus autant d'actions gardées par écran. */
const MAX_ETATS = 200;

/** Historiques des écrans, pour le raccourci Ctrl+Z et les actions qui finissent plus tard (photo préparée…). */
const ouverts = new Set();

/**
 * Historique d'un écran. [capturer] renvoie l'état modifiable de l'écran, [restaurer] le remet et redessine l'écran.
 * La barre (deux boutons) est ajoutée à la fin de [ecran] ; dès qu'il y a quelque chose à annuler, elle reste visible
 * en bas de la fenêtre.
 * Les clics, choix et saisies dans l'écran sont notés tout seuls ; [noter] sert après une action qui finit plus tard.
 */
export function historique({ ecran, capturer, restaurer }) {
  let pile = [];
  let depart = null;
  const bouton = (texte, titre, classe) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn secondary ${classe}`;
    b.textContent = texte;
    b.title = titre;
    return b;
  };
  const retour = bouton("↩ Retour", "Annuler la dernière action (Ctrl+Z)", "retour-dernier");
  const annuler = bouton("Annuler les modifications", "Revenir au dernier enregistrement", "retour-tout");
  const barre = document.createElement("div");
  barre.className = "retour-barre";
  barre.append(retour, annuler);
  ecran.append(barre);

  const maj = () => {
    retour.disabled = pile.length < 2;
    annuler.disabled = !depart || empreinte(pile[pile.length - 1]) === empreinte(depart);
    // Rien à annuler : la barre reste à sa place en bas de l'écran, sans passer sur le contenu.
    barre.classList.toggle("flottante", !(retour.disabled && annuler.disabled));
  };
  const appliquer = (etat) => { restaurer(cloner(etat)); maj(); };
  const h = {
    /** Écran ouvert : son état actuel est le point de départ, l'historique repart de zéro. */
    depart() { depart = cloner(capturer()); pile = [depart]; maj(); },
    /** Enregistré : Annuler reviendra désormais ici. Les Retour restent possibles. */
    enregistre() { h.noter(); depart = cloner(pile[pile.length - 1]); maj(); },
    noter() {
      if (!depart) return;
      const etat = cloner(capturer());
      if (empreinte(etat) === empreinte(pile[pile.length - 1])) return;
      pile.push(etat);
      if (pile.length > MAX_ETATS) pile.splice(0, 1);
      maj();
    },
    retour() {
      h.noter();
      if (pile.length < 2) return;
      pile.pop();
      appliquer(pile[pile.length - 1]);
    },
    annuler() {
      h.noter();
      if (!depart || empreinte(pile[pile.length - 1]) === empreinte(depart)) return;
      pile.push(cloner(depart));
      appliquer(depart);
    },
    get visible() { return !ecran.hidden; },
  };
  retour.onclick = h.retour;
  annuler.onclick = h.annuler;
  // Les gestionnaires de l'écran passent d'abord : l'état est lu juste après eux.
  const plusTard = () => setTimeout(h.noter, 0);
  let saisie = null;
  ecran.addEventListener("click", (e) => { if (!barre.contains(e.target)) plusTard(); });
  ecran.addEventListener("change", plusTard);
  // Une saisie au clavier compte pour une seule action quand on s'arrête de taper.
  ecran.addEventListener("input", () => { clearTimeout(saisie); saisie = setTimeout(h.noter, 600); });
  ecran.addEventListener("focusout", () => { if (saisie) { clearTimeout(saisie); saisie = null; plusTard(); } });
  maj();
  ouverts.add(h);
  return h;
}

/** Note l'état de l'écran affiché (après une action qui se termine plus tard : photo préparée, fichier lu…). */
export function noterEcran() {
  ouverts.forEach((h) => { if (h.visible) h.noter(); });
}

// Ctrl+Z (ou Cmd+Z) hors d'un champ de texte : Retour sur l'écran affiché. Dans un champ, le navigateur annule la frappe.
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && !["checkbox", "radio", "button", "file"].includes(t.type)))) return;
  const h = [...ouverts].find((x) => x.visible);
  if (!h) return;
  e.preventDefault();
  h.retour();
});
