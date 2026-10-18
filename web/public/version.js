// Version du site, écrite dans version.json par GitHub Actions à chaque publication.
// Une page restée ouverte depuis la veille (régie, pupitre, administration) voit qu'une nouvelle version
// est en ligne et se met à jour au bon moment, au lieu de garder un ancien code qui ne parle plus à la TV.

/** Version en ligne (« 0.1.152 »), ou null en local et hors connexion. */
export async function onlineVersion() {
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json())?.web ?? null;
  } catch {
    return null;
  }
}

/**
 * Affiche la version de la page dans les éléments [data-web-version], puis vérifie toutes les minutes
 * (et au retour sur l'onglet) ; appelle onNew une fois quand une autre version est publiée.
 */
export function watchVersion(onNew, everyMs = 60_000) {
  let mine = null;
  let told = false;
  const check = async () => {
    const v = await onlineVersion();
    if (!v) return;
    if (mine == null) {
      mine = v;
      document.querySelectorAll("[data-web-version]").forEach((e) => { e.textContent = `Version ${v}`; });
      return;
    }
    if (v !== mine && !told) {
      told = true;
      onNew(v);
    }
  };
  check();
  setInterval(check, everyMs);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
}

/** Bandeau « nouvelle version » avec un bouton pour recharger quand on veut. */
export function showUpdateBanner(text) {
  const el = document.getElementById("update-banner");
  if (!el) return;
  el.querySelector("span").textContent = text;
  el.querySelector("button").onclick = () => location.reload();
  el.hidden = false;
}
