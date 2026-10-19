// Écran allumé pendant une partie, sur les tablettes des équipes et le téléphone de la régie.
// Une page web n'a pas le drapeau natif FLAG_KEEP_SCREEN_ON de l'appli TV : son équivalent est l'API
// « Screen Wake Lock » du navigateur (Chrome et Samsung Internet sur Android, Safari récent sur iPhone).
// L'écran allumé suit l'état de la partie, pas un toucher : il est redemandé après un rechargement de la page,
// au retour au premier plan et quand le système l'a retiré ; il est relâché à la fin. Le bouton
// d'alimentation éteint toujours l'écran, et en arrière-plan le système reprend la main de lui-même.
// Aucun réglage de la tablette n'est modifié.

let wanted = false;
let sentinel = null;
let asking = false;
let listeners = [];

/** Le navigateur sait garder l'écran allumé. */
export const awakeSupported = typeof navigator !== "undefined" && "wakeLock" in navigator;

/** L'écran est-il gardé allumé en ce moment ? */
export const isAwake = () => sentinel != null;

/** Prévenu à chaque changement (pour l'afficher à la régie) : reçoit vrai si l'écran est gardé allumé. */
export function onAwakeChange(fn) {
  listeners.push(fn);
}

function changed() {
  listeners.forEach((fn) => { try { fn(isAwake()); } catch { /* sans effet sur la partie */ } });
}

async function acquire() {
  if (!wanted || sentinel || asking || !awakeSupported || document.visibilityState !== "visible") return;
  asking = true;
  try {
    const lock = await navigator.wakeLock.request("screen");
    if (!wanted) { lock.release().catch(() => {}); return; }
    sentinel = lock;
    // Retiré par le système (page cachée, économie d'énergie) : redemandé dès que possible.
    lock.addEventListener("release", () => {
      if (sentinel === lock) sentinel = null;
      changed();
      if (wanted) setTimeout(acquire, 1000);
    });
  } catch {
    // Refusé (batterie très faible, navigateur trop ancien) : la partie continue, la régie le voit.
  } finally {
    asking = false;
    changed();
  }
}

/** Garder l'écran allumé ([on] vrai) ou rendre la veille normale à Android. */
export function setAwake(on) {
  wanted = !!on;
  if (wanted) acquire();
  else if (sentinel) {
    const lock = sentinel;
    sentinel = null;
    lock.release().catch(() => {});
    changed();
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") acquire(); });
}
