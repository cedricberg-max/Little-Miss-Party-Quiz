// Buzzy en plein écran sur les tablettes (cedric, 01/11, point 43 : les 15 animations validées, aux moments proposés).
// Une petite fête de 3 secondes par-dessus l'écran (Game Show seulement), puis la tablette revient toute seule.
// Chaque moment ne se joue qu'une fois (même après un rechargement de la page) ; un toucher la ferme ; elle se ferme
// aussi dès que l'écran du jeu change (une question qui s'ouvre n'est jamais cachée).

export const FETES = {
  bienvenue: { anim: "coucou", mot: "BIENVENUE !", couleur: "cyan" },
  parti: { anim: "danse", mot: "C'EST PARTI !", sous: "La fête commence !", couleur: "rose" },
  premiers: { anim: "confettis", mot: "PREMIERS !", sous: "Vous avez buzzé en premier !", couleur: "rose" },
  bonne: { anim: "bravo", mot: "BONNE RÉPONSE !", sous: "Bravo l'équipe !" },
  points: { anim: "applaudit", mot: "SUPER !", sous: "Vous marquez des points !" },
  chanson: { anim: "guitare", mot: "BIEN JOUÉ !", sous: "Vous avez trouvé la chanson !", couleur: "cyan" },
  trouve: { anim: "tourne", mot: "TROUVÉ !", sous: "Ils ont deviné le mot !" },
  statues: { anim: "robotdance", mot: "BRAVO !", sous: "Vous n'avez pas bougé !" },
  gagne: { anim: "ola", mot: "GAGNÉ !", sous: "Le trésor est à vous !" },
  duel: { anim: "salto", mot: "VICTOIRE !", sous: "Vous gagnez le duel !", couleur: "rose" },
  chrono: { anim: "energie", mot: "PILE À TEMPS !", sous: "Chrono parfait !", couleur: "cyan" },
  roulement: { anim: "batterie", mot: "ROULEMENT…", sous: "Résultats sur la TV !", couleur: "rose" },
  pause: { anim: "groove", mot: "PETITE PAUSE", sous: "Le prochain jeu arrive…", couleur: "cyan" },
  podium: { anim: "fusee", mot: "AU PODIUM !", sous: "Regardez la TV !" },
  merci: { anim: "coeur", mot: "MERCI !", sous: "C'était une super fête !", couleur: "rose" },
};

const DUREE_MS = 3000;
const CLE_VUES = "lmp-fetes-vues";
const dossier = (anim) => `img/gs/fete/${anim}.webm`;

let vues;
try { vues = new Set(JSON.parse(sessionStorage.getItem(CLE_VUES) ?? "[]")); } catch { vues = new Set(); }
let ouverte = null;

/** Écran du jeu sous la fête en cours (null : aucune fête). */
export const ecranSousFete = () => ouverte?.ecran ?? null;

/** Joue la fête [nom] une seule fois pour [cle], par-dessus l'écran [ecran]. Retourne true si elle part. */
export function feter(nom, cle, ecran, sous = null) {
  const f = FETES[nom];
  if (!f || !cle || vues.has(cle) || document.visibilityState === "hidden") return false;
  vues.add(cle);
  try { sessionStorage.setItem(CLE_VUES, JSON.stringify([...vues].slice(-200))); } catch { /* stockage refusé */ }
  fermerFete();
  const el = document.createElement("div");
  el.className = "fete-buzzy";
  el.dataset.fete = nom;
  el.setAttribute("role", "status");
  el.innerHTML = `<div class="fete-halo"></div><div class="fete-rayons"></div>
    <p class="fete-mot ${f.couleur ?? ""}"></p>
    <video class="fete-video" muted playsinline autoplay loop preload="auto"></video>
    <p class="fete-sous"></p>`;
  el.querySelector(".fete-mot").textContent = f.mot;
  el.querySelector(".fete-sous").textContent = sous ?? f.sous ?? "";
  const video = el.querySelector("video");
  video.src = dossier(f.anim);
  video.play?.()?.catch?.(() => {});
  el.addEventListener("pointerdown", (e) => { e.preventDefault(); fermerFete(); });
  document.body.appendChild(el);
  ouverte = { el, ecran, minuterie: setTimeout(fermerFete, DUREE_MS) };
  return true;
}

export function fermerFete() {
  if (!ouverte) return;
  clearTimeout(ouverte.minuterie);
  const { el } = ouverte;
  ouverte = null;
  el.classList.add("sort");
  el.querySelector("video")?.pause();
  setTimeout(() => el.remove(), 250);
}

/**
 * Les vidéos se chargent en avance, une par une et sans gêner le jeu (Wi-Fi de la box parfois faible) : d'abord celles
 * du début de la fête, les autres ensuite.
 */
let prechargees = false;
export function prechargerFetes() {
  if (prechargees) return;
  prechargees = true;
  const ordre = ["bienvenue", "parti", "premiers", "bonne", "points", ...Object.keys(FETES)];
  const anims = [...new Set(ordre.map((n) => FETES[n].anim))];
  const suivante = () => {
    const a = anims.shift();
    if (!a) return;
    fetch(dossier(a), { priority: "low" }).then((r) => r.blob()).catch(() => {}).finally(() => setTimeout(suivante, 400));
  };
  setTimeout(suivante, 1500);
}
