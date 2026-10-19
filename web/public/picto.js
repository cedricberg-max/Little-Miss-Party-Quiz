// Pictionary sur le pupitre : envoi vers la TV des traits de l'ardoise (ardoise.js), par petits paquets, dans
// games/<code>/drawing/<clé du tour>/<push> :
//   { c: couleur "#RRGGBB", w: épaisseur 1 à 3, p: "x,y x,y …" }  ou  { clear: true }.
// Les coordonnées vont de 0 à 1000 sur une feuille au format 4:3 (la TV dessine la même feuille, à sa taille).
// L'ardoise rend le trait entier toutes les 80 ms pendant le geste : on n'envoie que les points nouveaux, en
// recommençant par le dernier point déjà parti, pour que la TV relie les paquets sans trou. Chaque paquet est écrit
// une seule fois (les règles de la base refusent toute réécriture d'un trait).
import { ref, push } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { COULEURS_DESSIN } from "./ardoise.js";

const coord = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1000);

/** Le paquet à envoyer pour [trait] ({ c, w, p: [x, y, …] } de 0 à 1), à partir du point [depuis]. */
export function paquet(trait, depuis) {
  const p = [];
  for (let i = depuis * 2; i + 1 < trait.p.length; i += 2) p.push(`${coord(trait.p[i])},${coord(trait.p[i + 1])}`);
  return { c: COULEURS_DESSIN[trait.c] ?? COULEURS_DESSIN[0], w: Math.min(3, Math.max(1, (trait.w ?? 1) + 1)), p: p.join(" ") };
}

/**
 * Relie l'ardoise à la base : renvoie { trait(t, fini), effacer() }, à passer en surTrait et surEffacer.
 * [onError] est appelé si un envoi est refusé (connexion perdue, pause, fin du tour).
 */
export function envoyeurDessin(db, path, { onError } = {}) {
  const target = ref(db, path);
  /** Nombre de points déjà partis pour chaque trait en cours. */
  const partis = new Map();
  const send = (data) => push(target, data).catch((e) => { console.error(e); onError?.(); });
  return {
    trait(t, fini) {
      const n = Math.floor(t.p.length / 2);
      const deja = partis.get(t.id) ?? 0;
      if (fini) partis.delete(t.id);
      else partis.set(t.id, Math.max(deja, n));
      // Rien de nouveau depuis le dernier paquet.
      if (n === 0 || (deja > 0 && n <= deja)) return;
      send(paquet(t, Math.max(0, deja - 1)));
    },
    effacer() {
      partis.clear();
      send({ clear: true });
    },
  };
}
