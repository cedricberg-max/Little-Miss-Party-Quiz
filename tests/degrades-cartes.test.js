// Fond des cartes de réponse du Quiz (Game Show) : un dégradé fondu, sans « suite de lignes » (cedric, 30/10 : en
// Vrai ou Faux express, des bandes se voyaient dans le haut des cartes, étirées sur la TV). Le dégradé descend sans
// marche ni retour en arrière, colonne après colonne. L'image est lue par Chromium, comme un écran la décode.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const DOSSIER = new URL("../tv/src/main/res/drawable-nodpi/", import.meta.url);
let browser;
let page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
after(async () => browser?.close());

/** Rouge et alpha des lignes [y0, y1) de la colonne [x] de l'image [nom]. */
async function colonne(nom, x, y0, y1) {
  const data = `data:image/webp;base64,${readFileSync(new URL(nom, DOSSIER)).toString("base64")}`;
  return page.evaluate(async ({ data, x, y0, y1 }) => {
    const img = await createImageBitmap(await (await fetch(data)).blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const c = new OffscreenCanvas(img.width, img.height).getContext("2d", { willReadFrequently: true });
    c.drawImage(img, 0, 0);
    const p = c.getImageData(x, y0, 1, y1 - y0).data;
    return Array.from({ length: y1 - y0 }, (_, i) => [p[i * 4], p[i * 4 + 3]]);
  }, { data, x, y0, y1 });
}

/** Plus grande marche d'une ligne à la suivante, et plus grande remontée dans un dégradé qui descend. */
function marches(valeurs) {
  let saut = 0;
  let remontee = 0;
  for (let i = 1; i < valeurs.length; i++) {
    const d = valeurs[i] - valeurs[i - 1];
    saut = Math.max(saut, Math.abs(d));
    remontee = Math.max(remontee, d);
  }
  return { saut, remontee };
}

describe("dégradés des cartes de réponse", () => {
  test("verre de la carte : le reflet du haut se fond dans le noir, sans bandes", async () => {
    for (const x of [120, 300, 490, 860]) {
      const rouge = (await colonne("gs_q3d_carte_fond.webp", x, 96, 200)).map(([r]) => r);
      const { saut, remontee } = marches(rouge);
      assert.ok(saut <= 5, `colonne ${x} : marche de ${saut} niveaux`);
      assert.ok(remontee <= 2, `colonne ${x} : le dégradé remonte de ${remontee} niveaux (une ligne)`);
    }
  });

  test("carte de la bonne réponse : le vert se fond, sans marches", async () => {
    for (const x of [300, 490, 700]) {
      const lignes = await colonne("gs_q3d_carte_juste.webp", x, 88, 200);
      for (const [canal, i] of [["rouge", 0], ["alpha", 1]]) {
        const { saut } = marches(lignes.map((l) => l[i]));
        assert.ok(saut <= 5, `colonne ${x}, ${canal} : marche de ${saut} niveaux`);
      }
    }
  });

  test("le contrôle voit bien une marche : une colonne à bandes est refusée", () => {
    const bandes = [21, 13, 17, 19, 19, 19, 17, 9, 11, 13, 13, 13, 12, 4];
    assert.ok(marches(bandes).saut > 5 && marches(bandes).remontee > 2);
    assert.deepEqual(marches([40, 39, 37, 36, 34, 33]), { saut: 2, remontee: 0 });
  });
});
