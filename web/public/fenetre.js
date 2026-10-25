/**
 * Fenêtres de la Régie PC aux couleurs du site, à la place des fenêtres grises du navigateur (confirm, alert, prompt)
 * (cedric, 21/10). Chacune rend une promesse : confirmer → vrai ou faux, avertir → rien, demanderTexte → le texte
 * tapé, ou null (Annuler, Échap). Une seule fenêtre à la fois : celles demandées entre-temps attendent leur tour.
 * Le message peut avoir plusieurs paragraphes, séparés par une ligne vide : le premier sert de titre.
 */

/** Fenêtre ouverte (ou dernière demandée) : la suivante s'ouvre quand elle est fermée. */
let file = Promise.resolve();

function el(tag, props = {}, ...enfants) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...enfants.filter(Boolean));
  return e;
}

/** Paragraphes d'un message : une ligne vide les sépare ; un simple retour à la ligne reste dans son paragraphe. */
const paragraphes = (message) => `${message ?? ""}`.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean);

/**
 * Ouvre une fenêtre et attend la réponse : { ok, texte }. [annuler] : texte du second bouton (aucun s'il est nul) ;
 * [texte] : valeur de départ d'un champ à remplir (aucun champ s'il est nul).
 */
function ouvrir(message, { ok, annuler = null, danger = false, texte = null, maxlength = null, premier = null, contenu = null, valider = null }) {
  const tour = file.then(() => new Promise((resolve) => {
    const lignes = paragraphes(message);
    const champ = texte === null ? null : el("input", { type: "text", className: "fenetre-texte", value: texte, autocomplete: "off" });
    if (champ) {
      champ.dataset.fenetreTexte = "";
      champ.setAttribute("aria-label", lignes[0] ?? "Texte");
      if (maxlength) champ.maxLength = maxlength;
    }
    const boutonOk = el("button", { type: "button", className: `btn${danger ? " danger" : ""}`, textContent: ok });
    boutonOk.dataset.fenetreOk = "";
    const boutonAnnuler = annuler ? el("button", { type: "button", className: "btn secondary", textContent: annuler }) : null;
    if (boutonAnnuler) boutonAnnuler.dataset.fenetreAnnuler = "";
    // Un bouton de plus, en premier (« Enregistrer » avant de quitter un écran, cedric 24/10).
    const boutonPremier = premier ? el("button", { type: "button", className: "btn", textContent: premier }) : null;
    if (boutonPremier) boutonPremier.dataset.fenetrePremier = "";
    // Ce qui manque encore quand [valider] refuse OK (une famille à choisir…) : dit ici, la fenêtre reste ouverte.
    const manque = valider ? el("p", { className: "fenetre-manque", role: "alert" }) : null;
    if (manque) manque.hidden = true;
    const d = el("dialog", { className: "fenetre", tabIndex: -1 },
      el("div", { className: "fenetre-message", id: "fenetre-message" },
        ...lignes.map((p, i) => el("p", { className: i === 0 ? "fenetre-titre" : "", textContent: p }))),
      contenu,
      champ,
      manque,
      el("div", { className: "fenetre-boutons" }, boutonPremier, boutonOk, boutonAnnuler));
    d.dataset.fenetre = "";
    if (contenu) d.classList.add("fenetre-large");
    d.setAttribute("role", annuler ? "alertdialog" : "dialog");
    d.setAttribute("aria-labelledby", "fenetre-message");

    let oui = false;
    const fermer = (reponse) => { oui = reponse; d.close(); };
    boutonOk.onclick = () => {
      const refus = valider?.();
      if (typeof refus === "string" && refus) { manque.textContent = refus; manque.hidden = false; return; }
      fermer(true);
    };
    if (boutonPremier) boutonPremier.onclick = () => fermer("premier");
    if (boutonAnnuler) boutonAnnuler.onclick = () => fermer(false);
    // Entrée dans le champ : comme OK.
    champ?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); fermer(true); } });
    // Les touches restent à la fenêtre : les raccourcis de la page (Suppr, Ctrl+A, Ctrl+Z, Échap) n'agissent pas
    // derrière elle. Échap ferme quand même la fenêtre (le navigateur s'en charge : comme Annuler).
    d.addEventListener("keydown", (e) => e.stopPropagation());
    d.addEventListener("close", () => { d.remove(); resolve({ ok: oui, texte: champ?.value ?? null }); }, { once: true });
    document.body.append(d);
    d.showModal();
    if (champ) { champ.focus(); champ.select(); } else (boutonPremier ?? boutonOk).focus();
  }));
  file = tour.then(() => {}, () => {});
  return tour;
}

/** Question oui / non (à la place de confirm) : vrai si on choisit [ok]. [danger] : bouton rouge, pour effacer ou retirer. */
export async function confirmer(message, { ok = "OK", annuler = "Annuler", danger = false } = {}) {
  return (await ouvrir(message, { ok, annuler, danger })).ok;
}

/**
 * Question à trois réponses : [premier] (bouton plein, en premier), [ok] (rouge si [danger]) ou [annuler] (Échap).
 * Rend « premier », « ok » ou null.
 */
export async function choisirParmi(message, { premier, ok, annuler = "Annuler", danger = false }) {
  const r = await ouvrir(message, { ok, annuler, danger, premier });
  return r.ok === "premier" ? "premier" : r.ok ? "ok" : null;
}

/** Simple message (à la place de alert) : se ferme avec [ok] ou Échap. */
export async function avertir(message, { ok = "OK" } = {}) {
  await ouvrir(message, { ok });
}

/** Texte à taper (à la place de prompt), [valeur] tout sélectionnée au départ : le texte, ou null si on annule. */
export async function demanderTexte(message, valeur = "", { ok = "OK", annuler = "Annuler", maxlength } = {}) {
  const r = await ouvrir(message, { ok, annuler, texte: `${valeur ?? ""}`, maxlength });
  return r.ok ? r.texte : null;
}

/**
 * Fenêtre avec un contenu à regarder avant de choisir (aperçu d'un pack, cedric 25/10) : [contenu] (un élément) sous le
 * message. Vrai si on choisit [ok] ; sans [annuler], un simple bouton pour fermer. [valider] : appelé à OK, un texte
 * (ce qui manque) garde la fenêtre ouverte et l'affiche.
 */
export async function apercu(message, contenu, { ok = "OK", annuler = "Annuler", danger = false, valider = null } = {}) {
  return (await ouvrir(message, { ok, annuler, danger, contenu, valider })).ok === true;
}
