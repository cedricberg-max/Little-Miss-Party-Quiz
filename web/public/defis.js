import { ref, get, set, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";

// Défis de la pause : la TV en affiche un toutes les 8 secondes pendant « PAUSE FUN ! », au hasard parmi les défis de
// base (toujours là) et ceux en plus de cette fête (cedric, 31/10, proposition A). Les défis en plus sont préparés dans
// la Régie PC (fiche de la prestation, copiés dans la partie au lancement), puis ajoutés ou effacés ici pendant la fête.
// Ils sont gardés dans la partie (games/<code>/defisFete) : jamais repris à la fête suivante.

/** Défis de base, les mêmes que ceux intégrés à l'appli TV (DefisPause.kt). Ils ne se modifient pas. */
export const DEFIS_PAR_DEFAUT = [
  "Tout le monde fait la ola !",
  "Un tonnerre d'applaudissements pour [prénom] !",
  "Montrez votre plus belle pose de star !",
  "Applaudissez l'équipe d'à côté !",
  "Vos plus beaux pas de danse, c'est maintenant !",
  "Trois tapes dans les mains, tous ensemble !",
  "Qui a le plus beau sourire de l'équipe ?",
];
export const DEFIS_MAX = 30;
export const DEFI_LONGUEUR_MAX = 120;

/** Liste propre à enregistrer : textes nettoyés, vides et doublons retirés, au plus 30 de 120 caractères. */
export function nettoyerDefis(list) {
  const textes = (Array.isArray(list) ? list : [])
    .map((t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, DEFI_LONGUEUR_MAX))
    .filter(Boolean);
  return [...new Set(textes)].slice(0, DEFIS_MAX);
}

/** Valeur à écrire dans games/<code>/defisFete pour ces défis en plus (null : aucun, le nœud est retiré). */
export function valeurDefisFete(list) {
  const propres = nettoyerDefis(list);
  return propres.length ? { list: propres, updatedAt: serverTimestamp() } : null;
}

/** Défis en plus d'une fiche de prestation, écrits un par ligne dans la Régie PC. */
export function defisDuTexte(texte) {
  return nettoyerDefis(String(texte ?? "").split(/\r?\n/));
}

/** Affiche l'onglet « Défis » de la partie [code] dans [box] ; chaque changement est enregistré tout de suite. */
export async function ouvrirDefis(db, code, box, toast) {
  box.innerHTML = '<p class="hint">Chargement des défis…</p>';
  let enPlus;
  try {
    const v = (await get(ref(db, `games/${code}/defisFete`))).val();
    enPlus = nettoyerDefis(v?.list);
  } catch (e) {
    console.error(e);
    box.innerHTML = '<p class="hint">Impossible de lire les défis : vérifiez la connexion, puis rouvrez l\'onglet.</p>';
    return;
  }
  dessiner(db, code, box, toast, enPlus);
}

async function enregistrer(db, code, box, toast, avant, suivant) {
  const list = nettoyerDefis(suivant);
  try {
    await set(ref(db, `games/${code}/defisFete`), valeurDefisFete(list));
    toast(list.length > avant.length ? "Défi ajouté : la TV le montrera aux prochaines pauses."
      : list.length < avant.length ? "Défi effacé." : "Défi modifié.");
    dessiner(db, code, box, toast, list);
  } catch (e) {
    console.error(e);
    toast("Le défi n'a pas pu être enregistré. Vérifiez la connexion et réessayez.");
    dessiner(db, code, box, toast, avant);
  }
}

function dessiner(db, code, box, toast, enPlus) {
  box.innerHTML = "";
  const intro = document.createElement("p");
  intro.className = "hint";
  intro.textContent = "Pendant la pause, la TV affiche un défi toutes les 8 secondes, au hasard parmi les défis de base et ceux de cette fête. Écrivez [prénom] pour le prénom de l'enfant.";
  box.appendChild(intro);

  const titreFete = document.createElement("h3");
  titreFete.className = "defis-titre";
  titreFete.textContent = "Défis en plus pour cette fête";
  box.appendChild(titreFete);
  if (!enPlus.length) {
    box.insertAdjacentHTML("beforeend", '<p class="hint defis-vide">Aucun pour l\'instant. Ajoutez-en ici, ou préparez-les dans la Régie PC (fiche de la prestation).</p>');
  }
  const liste = document.createElement("ol");
  liste.className = "defis";
  enPlus.forEach((texte, i) => {
    const li = document.createElement("li");
    const champ = document.createElement("input");
    champ.type = "text";
    champ.value = texte;
    champ.maxLength = DEFI_LONGUEUR_MAX;
    champ.setAttribute("aria-label", `Défi en plus ${i + 1}`);
    champ.onchange = () => {
      const suivant = [...enPlus];
      suivant[i] = champ.value;
      enregistrer(db, code, box, toast, enPlus, suivant);
    };
    const effacer = document.createElement("button");
    effacer.type = "button";
    effacer.className = "btn secondary defi-effacer";
    effacer.textContent = "Effacer";
    effacer.onclick = () => enregistrer(db, code, box, toast, enPlus, enPlus.filter((_, k) => k !== i));
    li.append(champ, effacer);
    liste.appendChild(li);
  });
  box.appendChild(liste);

  const ajout = document.createElement("form");
  ajout.className = "defi-ajout";
  const nouveau = document.createElement("input");
  nouveau.type = "text";
  nouveau.placeholder = "Nouveau défi, par exemple « Tout le monde imite un lion ! »";
  nouveau.maxLength = DEFI_LONGUEUR_MAX;
  nouveau.setAttribute("aria-label", "Nouveau défi");
  const ajouter = document.createElement("button");
  ajouter.type = "submit";
  ajouter.className = "btn main";
  ajouter.textContent = "＋ Ajouter le défi";
  const plein = enPlus.length >= DEFIS_MAX;
  nouveau.disabled = ajouter.disabled = plein;
  ajout.append(nouveau, ajouter);
  ajout.onsubmit = (e) => {
    e.preventDefault();
    if (!nouveau.value.trim()) { toast("Écrivez d'abord le défi."); return; }
    enregistrer(db, code, box, toast, enPlus, [...enPlus, nouveau.value]);
  };
  box.appendChild(ajout);
  if (plein) box.insertAdjacentHTML("beforeend", `<p class="hint">${DEFIS_MAX} défis en plus au maximum : effacez-en un pour en ajouter un autre.</p>`);

  const titreBase = document.createElement("h3");
  titreBase.className = "defis-titre";
  titreBase.textContent = "Défis de base (toujours là)";
  box.appendChild(titreBase);
  const base = document.createElement("ul");
  base.className = "defis-base";
  DEFIS_PAR_DEFAUT.forEach((texte) => {
    const li = document.createElement("li");
    li.textContent = texte;
    base.appendChild(li);
  });
  box.appendChild(base);
}
