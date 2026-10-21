/**
 * « ← Retour » et « Annuler les modifications » dans les écrans d'édition de la Régie PC, en haut et en bas de l'écran
 * (cedric, 21/10). Retour mène à la page précédente, comme la flèche du navigateur ; Annuler revient au dernier
 * enregistrement (ou à l'ouverture de l'écran). Chaque écran garde aussi ses états successifs (en mémoire, rien n'est
 * écrit) : Ctrl+Z revient à l'état d'avant la dernière action. Annuler est lui-même une action : un Ctrl+Z juste après
 * rend les modifications. Enregistrer fixe le nouveau point de départ.
 */

/** Copie profonde des objets et tableaux simples ; les fichiers (photos, morceaux pas encore envoyés) gardés tels quels. */
const cloner = (v) => (Array.isArray(v) ? v.map(cloner)
  : v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype
    ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cloner(x)]))
    : v);

const empreinte = (v) => JSON.stringify(v ?? null, (k, x) => (typeof Blob !== "undefined" && x instanceof Blob ? `fichier:${x.name ?? ""}:${x.size}` : x));

/** Au plus autant d'actions gardées par écran. */
const MAX_ETATS = 200;

/** Historiques des écrans, pour le raccourci Ctrl+Z, les actions qui finissent plus tard (photo préparée…) et les départs. */
const ouverts = new Set();

/** Barre « ← Retour » seule, pour un écran sans modifications à annuler (création d'un quiz, banque des petits). */
export function barresRetour(ecran, precedent) {
  const barres = ["haut", "bas"].map((place) => {
    const barre = document.createElement("div");
    barre.className = `retour-barre ${place}`;
    barre.append(bouton("← Retour", "Revenir à la page précédente", "retour-page", precedent));
    return barre;
  });
  placer(ecran, barres);
}

function bouton(texte, titre, classe, onclick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `btn secondary ${classe}`;
  b.textContent = texte;
  b.title = titre;
  b.onclick = onclick;
  return b;
}

/** Barre du haut sous le fil d'Ariane de l'écran, barre du bas à la fin. */
function placer(ecran, [haut, bas]) {
  const fil = ecran.querySelector(":scope > .crumbs");
  if (fil) fil.after(haut);
  else ecran.prepend(haut);
  ecran.append(bas);
}

/**
 * Historique d'un écran. [capturer] renvoie l'état modifiable de l'écran, [restaurer] le remet et redessine l'écran,
 * [precedent] ouvre la page précédente. Deux barres (Retour, Annuler) sont ajoutées en haut et en bas de [ecran] ;
 * dès qu'il y a quelque chose à annuler, celle du bas reste visible en bas de la fenêtre.
 * [enregistreSeul] : écran enregistré à chaque touche, jamais de modification en attente.
 * Les clics, choix et saisies dans l'écran sont notés tout seuls ; [noter] sert après une action qui finit plus tard.
 */
export function historique({ ecran, capturer, restaurer, precedent, enregistreSeul = false }) {
  let pile = [];
  let depart = null;
  /** Ouvert avec un contenu jamais enregistré (quiz importé…) : le quitter le perdrait. */
  let nouveau = false;
  const barres = ["haut", "bas"].map((place) => {
    const barre = document.createElement("div");
    barre.className = `retour-barre ${place}`;
    barre.append(
      bouton("← Retour", "Revenir à la page précédente", "retour-page", () => precedent()),
      bouton("Annuler les modifications", "Revenir au dernier enregistrement", "retour-tout", () => h.annuler()));
    return barre;
  });
  placer(ecran, barres);
  const annulers = barres.map((b) => b.querySelector(".retour-tout"));

  const maj = () => {
    const rien = !depart || empreinte(pile[pile.length - 1]) === empreinte(depart);
    annulers.forEach((b) => { b.disabled = rien; });
    // Rien à annuler : la barre du bas reste à sa place en bas de l'écran, sans passer sur le contenu.
    barres[1].classList.toggle("flottante", !rien);
  };
  const appliquer = (etat) => { restaurer(cloner(etat)); maj(); };
  const h = {
    /** Écran ouvert : son état actuel est le point de départ, l'historique repart de zéro. */
    depart({ nouveau: jamaisEnregistre = false } = {}) { depart = cloner(capturer()); pile = [depart]; nouveau = jamaisEnregistre; maj(); },
    /** Enregistré : Annuler reviendra désormais ici. Les Ctrl+Z restent possibles. */
    enregistre() { h.noter(); depart = cloner(pile[pile.length - 1]); nouveau = false; maj(); },
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
    /** Des modifications ne sont pas enregistrées (lu sur l'écran, même pendant une saisie). */
    get modifie() {
      if (enregistreSeul || !depart || ecran.hidden) return false;
      return nouveau || empreinte(cloner(capturer())) !== empreinte(depart);
    },
    /** On quitte l'écran sans enregistrer : il revient à son dernier enregistrement. */
    abandonner() {
      if (!depart) return;
      pile = [depart];
      nouveau = false;
      appliquer(depart);
    },
    get visible() { return !ecran.hidden; },
  };
  // Les gestionnaires de l'écran passent d'abord : l'état est lu juste après eux.
  const plusTard = () => setTimeout(h.noter, 0);
  let saisie = null;
  ecran.addEventListener("click", (e) => { if (!barres.some((b) => b.contains(e.target))) plusTard(); });
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

/** L'écran affiché a des modifications pas encore enregistrées. */
export function ecranModifie() {
  return [...ouverts].some((h) => h.modifie);
}

/**
 * Avant de quitter l'écran affiché : s'il a des modifications pas enregistrées, on demande (cedric, 21/10).
 * Quitter quand même remet l'écran à son dernier enregistrement. Renvoie faux pour rester.
 */
export function quitterEcran() {
  const h = [...ouverts].find((x) => x.modifie);
  if (!h) return true;
  if (!confirm("Des modifications ne sont pas enregistrées.\n\nQuitter sans enregistrer ? Elles seront perdues.")) return false;
  h.abandonner();
  return true;
}

// Ctrl+Z (ou Cmd+Z) hors d'un champ de texte : défait la dernière action de l'écran affiché. Dans un champ, le navigateur
// annule la frappe.
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && !["checkbox", "radio", "button", "file"].includes(t.type)))) return;
  const h = [...ouverts].find((x) => x.visible);
  if (!h) return;
  e.preventDefault();
  h.retour();
});

// Fermer l'onglet, recharger ou quitter le site avec des modifications en attente : le navigateur demande.
window.addEventListener("beforeunload", (e) => {
  if (!ecranModifie()) return;
  e.preventDefault();
  e.returnValue = "";
});
