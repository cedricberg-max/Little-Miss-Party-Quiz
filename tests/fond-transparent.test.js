// Images à fond transparent (cedric, 25/10) : le sujet repéré, agrandi, sur un fond Game Show qui contraste avec lui.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { analyserTransparence, choisirFond, placerSujet, seConfond, FONDS } from "../web/public/fond-transparent.js";

/** Une image [w] × [h] transparente, avec un rectangle plein de couleur [c] (contour [bord]) en x0..x1, y0..y1. */
function image(w, h, [x0, y0, x1, y1], c, bord = c) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * w + x) * 4;
    const surLeBord = x === x0 || x === x1 || y === y0 || y === y1;
    data.set([...(surLeBord ? bord : c), 255], i);
  }
  return data;
}

describe("images à fond transparent", () => {
  test("le sujet est repéré (son cadre, son contour) ; une image opaque ou vide n'est pas touchée", () => {
    const a = analyserTransparence(image(100, 80, [60, 10, 89, 39], [255, 230, 0]), 100, 80);
    assert.deepEqual([a.x, a.y, a.l, a.h], [60, 10, 30, 30]);
    assert.ok(a.contour.length > 50 && a.contour.every((c) => c.join() === "255,230,0"));
    assert.equal(analyserTransparence(image(10, 10, [0, 0, 9, 9], [1, 2, 3]), 10, 10), null, "opaque");
    assert.equal(analyserTransparence(new Uint8ClampedArray(400), 10, 10), null, "rien de visible");
  });

  test("le fond contraste avec le contour : jamais noir sur nuit, ni blanc sur clair", () => {
    const nom = (c) => choisirFond(Array(40).fill(c)).nom;
    assert.equal(nom([255, 230, 0]), "violet", "un sujet jaune : la nuit violette du décor");
    assert.equal(nom([255, 255, 255]), "violet", "un contour blanc : un fond sombre");
    assert.notEqual(nom([0, 0, 0]), "violet", "un contour noir ne se perd pas dans la nuit violette");
    assert.ok(["lavande", "or"].includes(nom([0, 0, 0])), "un contour noir : un fond clair");
    assert.ok(!seConfond([0, 0, 0], FONDS.find((f) => f.nom === nom([0, 0, 0])).centre));
    assert.notEqual(nom([139, 44, 255]), "violet", "un sujet violet : pas de fond violet");
    assert.equal(choisirFond([]).nom, "violet");
  });

  test("le sujet occupe la plus grande place possible, centré, avec sa marge", () => {
    const p = placerSujet({ l: 30, h: 30 }, 800, 600, { margeX: 0.08, margeY: 0.13 });
    assert.deepEqual([Math.round(p.l), Math.round(p.x), Math.round(p.y)], [444, 178, 78]);
    const large = placerSujet({ l: 300, h: 100 }, 480, 480, { margeX: 0.12, margeY: 0.12 });
    assert.deepEqual([Math.round(large.l), Math.round(large.h), Math.round(large.y)], [365, 122, 179]);
  });
});
