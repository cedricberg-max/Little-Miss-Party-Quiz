/*
 * Horloge fine (Duel des robots, cedric 27/10 : « le timing doit être vraiment juste ») : l'écart entre l'horloge de
 * l'appareil et celle du serveur, mesuré plusieurs fois ; la mesure dont l'aller-retour est le plus court gagne (son
 * erreur est au plus la moitié de cet aller-retour). L'horloge de l'appareil est performance.now(), qui ne saute
 * jamais (contrairement à Date.now(), que le système peut remettre à l'heure).
 */

/** Une mesure : [p0] juste avant l'écriture, [p1] à l'accusé du serveur, [serveur] = l'heure qu'il y a posée. */
export function decalage({ p0, p1, serveur }) {
  return { rtt: p1 - p0, offset: serveur - (p0 + p1) / 2 };
}

/** La meilleure des mesures : l'aller-retour le plus court ; null sans mesure. */
export function meilleure(mesures) {
  return mesures.map(decalage).filter((m) => m.rtt >= 0).sort((a, b) => a.rtt - b.rtt)[0] ?? null;
}

/**
 * Mesure [n] fois : [ecrire] pose l'heure du serveur, [lire] la relit. Renvoie { rtt, offset } (heure du serveur =
 * performance.now() + offset), ou null si rien n'a marché.
 */
export async function mesurerHorloge(ecrire, lire, n = 5, maintenant = () => performance.now()) {
  const mesures = [];
  for (let i = 0; i < n; i++) {
    try {
      const p0 = maintenant();
      await ecrire();
      const p1 = maintenant();
      const serveur = await lire();
      if (typeof serveur === "number") mesures.push({ p0, p1, serveur });
    } catch {
      // Hors connexion : on garde les autres mesures.
    }
  }
  return meilleure(mesures);
}

/**
 * Garde la meilleure mesure : la nouvelle si son aller-retour est plus court, ou si l'ancienne ne tient plus (tablette
 * mise en veille : son horloge a pu s'arrêter).
 */
export function garder(ancienne, nouvelle) {
  if (!nouvelle) return ancienne;
  if (!ancienne || nouvelle.rtt < ancienne.rtt) return nouvelle;
  return Math.abs(nouvelle.offset - ancienne.offset) > nouvelle.rtt / 2 + 30 ? nouvelle : ancienne;
}
