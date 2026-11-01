// Buzzy peintre (tablettes des équipes qui ne dessinent pas, Pictionary) : tirage sans répétition et fichiers présents.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { CLIPS_BUZZY, fichierClip, pioche } from "../web/public/spectateurs.js";

test("toutes les vidéos passent avant qu'une revienne, jamais deux fois de suite", () => {
  let graine = 7;
  const hasard = () => (graine = (graine * 16807) % 2147483647) / 2147483647;
  const tirer = pioche(CLIPS_BUZZY, hasard);
  const vus = [];
  for (let i = 0; i < CLIPS_BUZZY.length * 6; i++) vus.push(tirer());
  for (let k = 0; k < 6; k++) assert.equal(new Set(vus.slice(k * CLIPS_BUZZY.length, (k + 1) * CLIPS_BUZZY.length)).size, CLIPS_BUZZY.length);
  for (let i = 1; i < vus.length; i++) assert.notEqual(vus[i], vus[i - 1], `répétition à ${i}`);
});

test("chaque vidéo existe en paysage et en portrait, et reste légère", () => {
  for (const nom of CLIPS_BUZZY) for (const p of [false, true]) {
    const f = new URL(`../web/public/${fichierClip(nom, p)}`, import.meta.url);
    assert.ok(existsSync(f), `manque ${fichierClip(nom, p)}`);
    assert.ok(statSync(f).size < 3_000_000, `${fichierClip(nom, p)} trop lourde`);
  }
});
