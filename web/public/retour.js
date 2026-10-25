/**
 * « ← Retour » et « Annuler les modifications » dans les écrans d'édition de la Régie PC, dans la barre du bas qui suit
 * l'écran (cedric, 21/10, 24/10 et 25/10 ; les écrans sans modification gardent « ← Retour » en haut et en bas). Retour mène à la page précédente, comme la flèche du navigateur ; Annuler revient au dernier
 * enregistrement (ou à l'ouverture de l'écran). Chaque écran garde aussi ses états successifs (en mémoire, rien n'est
 * écrit) : Ctrl+Z revient à l'état d'avant la dernière action. Annuler est lui-même une action : un Ctrl+Z juste après
 * rend les modifications. Enregistrer fixe le nouveau point de départ.
 */

import { confirmer, choisirParmi } from "./fenetre.js";

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
 * Sur une page de modification, la barre du bas suit l'écran quand on monte ou descend, toujours (cedric, 24/10) : les
 * boutons d'enregistrement de l'écran y passent, à gauche, avec leur message ; « Supprimer » reste à sa place, en bas
 * de la page.
 */
function rassembler(ecran, bas) {
  bas.classList.add("flottante");
  const actions = ecran.querySelector(":scope > .actions");
  if (!actions) return;
  const enregistrer = (b) => (b.id.endsWith("-save") ? 0 : 1);
  bas.prepend(...[...actions.querySelectorAll(":scope > button:not(.danger)")].sort((a, b) => enregistrer(a) - enregistrer(b)));
  const suivant = actions.nextElementSibling;
  const message = actions.querySelector(":scope > .status") ?? (suivant?.classList.contains("status") ? suivant : null);
  if (message) bas.prepend(message);
  actions.classList.remove("sticky");
}

/**
 * Historique d'un écran. [capturer] renvoie l'état modifiable de l'écran, [restaurer] le remet et redessine l'écran,
 * [precedent] ouvre la page précédente. Une barre (Annuler, Retour) est ajoutée en bas de [ecran] ; elle reste toujours
 * visible en bas de la fenêtre (voir rassembler).
 * [enregistreSeul] : écran enregistré à chaque touche, jamais de modification en attente.
 * Les clics, choix et saisies dans l'écran sont notés tout seuls ; [noter] sert après une action qui finit plus tard.
 */
export function historique({ ecran, capturer, restaurer, precedent, enregistreSeul = false, enregistrer = null }) {
  let pile = [];
  let depart = null;
  /** Ouvert avec un contenu jamais enregistré (quiz importé…) : le quitter le perdrait. */
  let nouveau = false;
  // Une seule barre, en bas, qui suit l'écran : Enregistrer · Annuler les modifications · ← Retour, de gauche à droite ;
  // quitter la page en dernier (cedric, 24/10). Plus de barre en haut des pages de modification (cedric, 25/10).
  const barre = document.createElement("div");
  barre.className = "retour-barre bas";
  barre.append(
    bouton("Annuler les modifications", "Revenir au dernier enregistrement", "retour-tout", () => h.annuler()),
    bouton("← Retour", "Revenir à la page précédente", "retour-page", () => precedent()),
  );
  ecran.append(barre);
  rassembler(ecran, barre);
  const annulers = [barre.querySelector(".retour-tout")];

  const maj = () => {
    const rien = !depart || empreinte(pile[pile.length - 1]) === empreinte(depart);
    annulers.forEach((b) => { b.disabled = rien; });
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
    /** Enregistre l'écran (vrai une fois enregistré), s'il sait le faire ; sinon null. */
    enregistrer,
  };
  // Les gestionnaires de l'écran passent d'abord : l'état est lu juste après eux.
  const plusTard = () => setTimeout(h.noter, 0);
  let saisie = null;
  // Les boutons de l'écran passés dans la barre (Enregistrer, Tout valider…) restent notés ; Retour et Annuler non.
  ecran.addEventListener("click", (e) => { if (!(e.target instanceof Element && e.target.closest(".retour-page, .retour-tout"))) plusTard(); });
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
 * Avant de quitter l'écran affiché : s'il a des modifications pas enregistrées, on demande dans une fenêtre
 * (cedric, 21/10). Quitter quand même remet l'écran à son dernier enregistrement. Rend une promesse : faux pour rester.
 */
export async function quitterEcran() {
  const h = [...ouverts].find((x) => x.modifie);
  if (!h) return true;
  // « Enregistrer » aussi (cedric, 24/10) : l'écran est enregistré, puis on va où on voulait aller ; s'il ne s'enregistre
  // pas (message à l'écran), on reste.
  if (h.enregistrer) {
    const choix = await choisirParmi("Des modifications ne sont pas enregistrées.\n\nLes enregistrer avant de quitter ? Sinon, elles seront perdues.",
      { premier: "Enregistrer", ok: "Quitter sans enregistrer", annuler: "Rester", danger: true });
    if (choix === "premier") return (await h.enregistrer()) === true;
    if (choix !== "ok") return false;
  } else if (!(await confirmer("Des modifications ne sont pas enregistrées.\n\nQuitter sans enregistrer ? Elles seront perdues.", { ok: "Quitter sans enregistrer", annuler: "Rester", danger: true }))) return false;
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
