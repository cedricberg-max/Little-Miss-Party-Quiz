// Images en double (cedric, 25/10) : la même image sous deux noms de fichier ou à deux tailles, reconnue à l'œil.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { GRILLE, empreinteDePixels, memeImage, groupesDeDoublons, repointer } from "../web/public/doublons.js";

/** Pixels RGBA GRILLE × GRILLE : [fond] partout, [sujet] dans le carré (x, y, côté) ; [bruit] ajouté à chaque case. */
function pixels(fond, sujet = null, { x = 0, y = 0, cote = 0 } = {}, bruit = 0) {
  const out = new Uint8ClampedArray(GRILLE * GRILLE * 4);
  for (let j = 0; j < GRILLE; j++) {
    for (let i = 0; i < GRILLE; i++) {
      const dans = sujet && i >= x && i < x + cote && j >= y && j < y + cote;
      const c = dans ? sujet : fond;
      const k = (j * GRILLE + i) * 4;
      const b = bruit ? ((i * 7 + j * 13) % (2 * bruit + 1)) - bruit : 0;
      out.set([c[0] + b, c[1] + b, c[2] + b, 255], k);
    }
  }
  return out;
}
const empreinte = (px, l = 800, h = 600) => empreinteDePixels(px, l, h);
const NOIR = [5, 5, 5];

describe("doublons d'images", () => {
  test("la même image, à une autre taille et un peu recompressée : un doublon", () => {
    const a = empreinte(pixels([40, 160, 60], [250, 250, 250], { x: 4, y: 4, cote: 6 }), 800, 600);
    const b = empreinte(pixels([40, 160, 60], [250, 250, 250], { x: 4, y: 4, cote: 6 }, 4), 400, 300);
    assert.ok(memeImage(a, b));
  });

  test("deux images différentes sur le même fond noir (« Bill Balle », « Bob-omb ») : jamais confondues", () => {
    const bill = empreinte(pixels(NOIR, [210, 170, 40], { x: 0, y: 3, cote: 4 }));
    const bobomb = empreinte(pixels(NOIR, [40, 40, 120], { x: 3, y: 6, cote: 4 }));
    assert.equal(memeImage(bill, bobomb), false);
    // Même un tout petit sujet qui change (2 × 2 cases) suffit.
    assert.equal(memeImage(empreinte(pixels(NOIR, [250, 250, 250], { x: 8, y: 8, cote: 3 })), empreinte(pixels(NOIR))), false);
  });

  test("d'autres proportions : pas la même image", () => {
    const px = pixels([200, 30, 30]);
    assert.equal(memeImage(empreinte(px, 800, 600), empreinte(px, 600, 600)), false);
    assert.ok(memeImage(empreinte(px, 800, 600), empreinte(px, 801, 600)));
  });

  test("les groupes : la plus grande d'abord ; [ensemble] sépare ce qui ne se fusionne pas", () => {
    const vert = pixels([40, 160, 60]);
    const images = [
      { id: "petite", empreinte: empreinte(vert, 400, 300) }, { id: "autre", empreinte: empreinte(pixels([10, 10, 200])) },
      { id: "grande", empreinte: empreinte(vert, 1600, 1200) }, { id: "moyenne", empreinte: empreinte(vert, 800, 600) },
    ];
    assert.deepEqual(groupesDeDoublons(images).map((g) => g.map((x) => x.id)), [["grande", "moyenne", "petite"]]);
    assert.deepEqual(groupesDeDoublons(images, (a, b) => a.id !== "petite" && b.id !== "petite").map((g) => g.map((x) => x.id)), [["grande", "moyenne"]]);
  });

  test("repointer : chaque copie citée (valeur ou clé), partout, prend l'image gardée ; l'entrée touchée est horodatée", () => {
    const [G, C] = ["a".repeat(16), "b".repeat(16)];
    const lib = {
      quizzes: { q1: { title: "Mario", questions: [{ imageId: C, choiceImages: { 0: G, 1: C } }], imagesHorsFormat: { [C]: "trop petite" } }, q2: { title: "Autre", questions: [{ imageId: "c".repeat(16) }] } },
      shows: { s1: { rounds: [{ seriesQuiz: [{ questions: [{ imageId: C }] }] }] } },
      contents: { quisuis: { images: { yoshi: C } } },
    };
    const out = repointer(lib, new Map([[C, G]]), { horodatage: "MAINTENANT" });
    assert.deepEqual(out, {
      "library/quizzes/q1/questions/0/imageId": G, "library/quizzes/q1/questions/0/choiceImages/1": G,
      [`library/quizzes/q1/imagesHorsFormat/${C}`]: null, [`library/quizzes/q1/imagesHorsFormat/${G}`]: "trop petite",
      "library/shows/s1/rounds/0/seriesQuiz/0/questions/0/imageId": G, "library/contents/quisuis/images/yoshi": G,
      "library/quizzes/q1/updatedAt": "MAINTENANT", "library/shows/s1/updatedAt": "MAINTENANT", "library/contents/quisuis/updatedAt": "MAINTENANT",
    });
  });
});
