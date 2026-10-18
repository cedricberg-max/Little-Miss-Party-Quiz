# Sons et musiques du plateau TV : origine et droits

Les 45 sons de `tv/src/main/res/raw/lmp_*.ogg` (musiques de fond, musique des Mimes, musique de pause, générique, jingles de transition et de pause, effets, sons des Mimes, buzz rigolos du salon, roulette et fanfare du Juste Chiffre) ont été
composés et mixés pour Little Miss Party avec `tools/habillage/studio.py`. Ils ne contiennent aucune
musique existante : pas de droits SACEM à déclarer pour leur diffusion pendant une prestation.

## Instruments enregistrés

Piano, cordes, cuivres, basses, marimba, agogo, harpe, boîte à musique, cloches, timbales, sifflet et applaudissements viennent des échantillons **FluidR3 GM**.

- Source : https://github.com/gleitz/midi-js-soundfonts/tree/gh-pages/FluidR3_GM (paquet npm `pepperscore-sounds-complete` 0.1.0)
- Licence : Creative Commons Attribution 3.0, https://creativecommons.org/licenses/by/3.0/
- Crédit à conserver : « Instruments : FluidR3 GM, licence CC BY 3.0 ».

## Synthèse maison

Batterie, impacts, souffles, montées, ressort et sifflet à coulisse sont synthétisés par le script lui-même. Ils
n'utilisent aucun échantillon tiers.

## Refaire ou retoucher un son

```
npm pack pepperscore-sounds-complete@0.1.0 && mkdir pep && tar -xzf pepperscore-sounds-complete-0.1.0.tgz -C pep
python3 -m pip install numpy soundfile pedalboard
python3 tools/habillage/studio.py out generique bed_full    # rend les .wav dans out/
ffmpeg -i out/generique.wav -c:a libvorbis -q:a 4 tv/src/main/res/raw/lmp_generique.ogg
```

Les quatre boucles musicales (`lmp_bed_full`, `lmp_bed_light`, `lmp_bed_mimes`, `lmp_bed_pause`) gardent la métadonnée `ANDROID_LOOP=true`
(`-metadata ANDROID_LOOP=true` à l'encodage) pour tourner sans coupure sur la box.
