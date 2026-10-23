import { ref, get, set, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";

// Défis de la pause : la TV en affiche un toutes les quelques secondes pendant « PAUSE FUN ! ».
// La régie (et l'administration) les modifient dans settings/defis ; sans liste enregistrée, la TV garde les siens.

/** Défis d'origine, les mêmes que ceux intégrés à l'appli TV (PauseScreens.kt). */
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

/** Liste propre à enregistrer : textes nettoyés, vides retirés, au plus 30 de 120 caractères. */
export function nettoyerDefis(list) {
  return (list ?? [])
    .map((t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, DEFI_LONGUEUR_MAX))
    .filter(Boolean)
    .slice(0, DEFIS_MAX);
}

let defis = null;
let erreur = null;

/** Affiche la rubrique « Défis de la pause » dans [box] ; chaque changement est enregistré tout de suite. */
export async function ouvrirDefis(db, box, toast, demander) {
  if (defis === null) {
    box.innerHTML = '<p class="hint">Chargement des défis…</p>';
    try {
      const v = (await get(ref(db, "settings/defis"))).val();
      defis = Array.isArray(v?.list) ? nettoyerDefis(v.list) : [...DEFIS_PAR_DEFAUT];
      erreur = null;
    } catch (e) {
      console.error(e);
      erreur = "Impossible de lire les défis : vérifiez la connexion, puis rouvrez l'onglet.";
    }
  }
  dessiner(db, box, toast, demander);
}

async function enregistrer(db, box, toast, demander, suivant) {
  const list = nettoyerDefis(suivant);
  try {
    await set(ref(db, "settings/defis"), list.length ? { list, updatedAt: serverTimestamp() } : { updatedAt: serverTimestamp() });
    defis = list.length ? list : [...DEFIS_PAR_DEFAUT];
    toast(list.length ? "Défis enregistrés : la TV les affichera à la prochaine pause." : "Liste vide : la TV reprend les défis d'origine.");
  } catch (e) {
    console.error(e);
    // Ouverte avec le code à 4 chiffres de la TV, la régie n'a pas le droit de modifier les défis.
    toast(/permission/i.test(String(e?.message ?? e))
      ? "Pour modifier les défis, ouvrez la régie avec son mot de passe (pas le code de la TV)."
      : "Les défis n'ont pas pu être enregistrés. Vérifiez la connexion et réessayez.");
  }
  dessiner(db, box, toast, demander);
}

function dessiner(db, box, toast, demander) {
  box.innerHTML = "";
  if (erreur) {
    box.innerHTML = `<p class="hint">${erreur}</p>`;
    defis = null;
    return;
  }
  const intro = document.createElement("p");
  intro.className = "hint";
  intro.textContent = "Pendant la pause, la TV affiche un de ces défis toutes les 8 secondes. Écrivez [prénom] pour le prénom de l'enfant.";
  box.appendChild(intro);

  const liste = document.createElement("ol");
  liste.className = "defis";
  defis.forEach((texte, i) => {
    const li = document.createElement("li");
    const champ = document.createElement("input");
    champ.type = "text";
    champ.value = texte;
    champ.maxLength = DEFI_LONGUEUR_MAX;
    champ.setAttribute("aria-label", `Défi ${i + 1}`);
    champ.onchange = () => {
      const suivant = [...defis];
      suivant[i] = champ.value;
      enregistrer(db, box, toast, demander, suivant);
    };
    const effacer = document.createElement("button");
    effacer.type = "button";
    effacer.className = "btn secondary defi-effacer";
    effacer.textContent = "Effacer";
    effacer.onclick = () => enregistrer(db, box, toast, demander, defis.filter((_, k) => k !== i));
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
  const plein = defis.length >= DEFIS_MAX;
  nouveau.disabled = ajouter.disabled = plein;
  ajout.append(nouveau, ajouter);
  ajout.onsubmit = (e) => {
    e.preventDefault();
    if (!nouveau.value.trim()) { toast("Écrivez d'abord le défi."); return; }
    enregistrer(db, box, toast, demander, [...defis, nouveau.value]);
  };
  box.appendChild(ajout);
  if (plein) box.insertAdjacentHTML("beforeend", `<p class="hint">${DEFIS_MAX} défis au maximum : effacez-en un pour en ajouter un autre.</p>`);

  const origine = document.createElement("button");
  origine.type = "button";
  origine.className = "link";
  origine.textContent = "Remettre les défis d'origine";
  origine.onclick = async () => {
    const oui = await demander({ title: "Remettre les défis d'origine ?", text: "La liste actuelle sera remplacée.", ok: "Remettre", alert: true });
    if (oui) enregistrer(db, box, toast, demander, DEFIS_PAR_DEFAUT);
  };
  box.appendChild(origine);
}
