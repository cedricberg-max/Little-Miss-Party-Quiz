/**
 * La Patate chaude sur la tablette. L'équipe qui tient la bombe choisit à qui l'envoyer (un appui sur l'équipe) ; la
 * mèche colle 2 secondes après la réception, l'envoyeur ne peut pas la récupérer (sauf à 2 équipes), et les équipes
 * qui ne l'ont pas encore eue brillent. Les autres voient chez qui elle est. Module autonome, sans Firebase : la page
 * pupitre envoie le choix (surEnvoi) et passe l'état à maj().
 */

/**
 * hote : l'élément qui reçoit l'écran. surEnvoi(equipe) envoie la bombe (une promesse). maj(v) redessine :
 * v = {
 *   titre, texte, aMoi, chaude (la bombe est chez nous), envoye (équipe choisie, en cours d'envoi, ou null),
 *   colle (0 à 1 : mèche qui colle, 1 = on peut envoyer), equipes: [{ id, nom, couleur, permise, envoyeur, neuve }]
 * }
 */
export function ecranPatate(hote, { surEnvoi }) {
  hote.innerHTML = `
    <div class="pc">
      <div class="pc-bombe" aria-hidden="true">💣</div>
      <p class="pc-titre"></p>
      <p class="pc-texte"></p>
      <div class="pc-colle"><span></span></div>
      <div class="pc-equipes"></div>
    </div>`;
  const q = (s) => hote.querySelector(s);
  const liste = q(".pc-equipes");
  let dernier = null;
  let signature = "";

  function maj(v) {
    dernier = v;
    q(".pc").classList.toggle("pc-chez-moi", v.aMoi === true);
    q(".pc-titre").textContent = v.titre ?? "";
    q(".pc-texte").textContent = v.texte ?? "";
    const colle = Math.max(0, Math.min(1, v.colle ?? 1));
    q(".pc-colle").hidden = !v.aMoi || colle >= 1;
    q(".pc-colle span").style.width = `${Math.round(colle * 100)}%`;
    const equipes = v.aMoi ? v.equipes ?? [] : [];
    // Liste reconstruite seulement quand les équipes changent : un bouton ne bouge pas sous le doigt.
    const sig = equipes.map((e) => `${e.id}:${e.nom}:${e.couleur}`).join("|");
    if (sig !== signature) {
      signature = sig;
      liste.replaceChildren(...equipes.map((e) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pc-equipe";
        b.dataset.id = e.id;
        b.style.setProperty("--eq", e.couleur ?? "#fff");
        const nom = document.createElement("span");
        nom.className = "pc-nom";
        nom.textContent = e.nom;
        const note = document.createElement("small");
        b.append(nom, note);
        b.onclick = () => {
          const d = dernier;
          const cible = d?.equipes?.find((x) => x.id === e.id);
          if (!d?.aMoi || d.envoye || (d.colle ?? 1) < 1 || !cible?.permise) return;
          navigator.vibrate?.(60);
          surEnvoi(e.id);
        };
        return b;
      }));
    }
    liste.querySelectorAll(".pc-equipe").forEach((b) => {
      const e = equipes.find((x) => x.id === b.dataset.id);
      if (!e) return;
      b.disabled = !e.permise || colle < 1 || !!v.envoye;
      b.classList.toggle("pc-neuve", e.permise && e.neuve);
      b.classList.toggle("pc-choisie", v.envoye === e.id);
      b.querySelector("small").textContent = e.envoyeur && !e.permise ? "vient de vous l'envoyer" : e.neuve ? "pas encore touchée !" : "";
    });
  }

  return { maj, detruire: () => { hote.innerHTML = ""; } };
}
