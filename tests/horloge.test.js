import { test } from "node:test";
import assert from "node:assert/strict";
import { decalage, meilleure, mesurerHorloge, garder } from "../web/public/horloge.js";

// Duel des robots (cedric, 27/10 : « le timing doit être vraiment juste ») : l'horloge de la tablette calée sur le serveur.

test("horloge fine : la mesure à l'aller-retour le plus court gagne, son erreur tient dans la moitié de l'aller-retour", () => {
  assert.deepEqual(decalage({ p0: 1_000, p1: 1_100, serveur: 51_050 }), { rtt: 100, offset: 50_000 });
  const m = meilleure([
    { p0: 0, p1: 400, serveur: 50_350 },   // wifi encombré : 400 ms
    { p0: 1_000, p1: 1_040, serveur: 51_020 }, // 40 ms : la bonne
    { p0: 2_000, p1: 2_200, serveur: 52_010 },
  ]);
  assert.deepEqual(m, { rtt: 40, offset: 50_000 });
  assert.equal(meilleure([]), null);
});

test("horloge fine : mesurée 5 fois malgré un wifi irrégulier et une écriture ratée", async () => {
  // Serveur en avance de 7 000 ms ; aller-retours 300, 25, échec, 120, 60 ; le serveur pose son heure au milieu.
  const vraiDecalage = 7_000;
  const allers = [300, 25, null, 120, 60];
  let horloge = 0;
  let pose = null;
  let i = 0;
  const m = await mesurerHorloge(
    async () => {
      const rtt = allers[i++];
      if (rtt == null) throw new Error("hors connexion");
      // Le serveur pose son heure à un instant quelconque de l'aller-retour (ici au tiers).
      pose = horloge + rtt / 3 + vraiDecalage;
      horloge += rtt;
    },
    async () => pose,
    5,
    () => horloge,
  );
  assert.equal(m.rtt, 25, "la mesure la plus courte");
  assert.ok(Math.abs(m.offset - vraiDecalage) <= 25 / 2, `erreur ${m.offset - vraiDecalage} ms`);
});

test("horloge fine : on garde la meilleure, sauf si l'ancienne ne tient plus (tablette en veille)", () => {
  const bonne = { rtt: 30, offset: 1_000 };
  assert.equal(garder(null, bonne), bonne);
  assert.equal(garder(bonne, null), bonne);
  assert.equal(garder(bonne, { rtt: 80, offset: 1_010 }), bonne, "moins précise, cohérente : on garde l'ancienne");
  assert.deepEqual(garder(bonne, { rtt: 20, offset: 1_002 }), { rtt: 20, offset: 1_002 }, "plus précise");
  assert.deepEqual(garder(bonne, { rtt: 80, offset: 1_500 }), { rtt: 80, offset: 1_500 }, "l'horloge a sauté : la nouvelle");
});
