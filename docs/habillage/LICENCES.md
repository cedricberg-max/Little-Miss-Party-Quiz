# Sons et musiques du plateau TV : origine et droits

Les 58 sons de `tv/src/main/res/raw/lmp_*.ogg` (musiques de fond, musique des Mimes, musique de pause, générique, jingles de transition et de pause, effets, sons des Mimes, buzz rigolos du salon, roulette et fanfare du Juste Chiffre, musique et verdicts du Vrai ou Faux express, ouverture et révélation du Zoom mystère, montée, gros buzz et suspense des jeux au buzzer, note des indices de Qui suis-je, diamant et scratch du blind test, gel et reprise des Statues musicales) ont été
composés et mixés pour Little Miss Party avec `tools/habillage/studio.py`. Ils ne contiennent aucune
musique existante : pas de droits SACEM à déclarer pour leur diffusion pendant une prestation.

## Blind test intégré : 12 extraits du domaine public

Les fichiers `lmp_bt_<titre>.ogg` (20 s chacun, liste dans `habillage/BlindTestCatalogue.kt`) sont des mélodies
du domaine public, arrangées et enregistrées pour Little Miss Party avec `tools/habillage/blindtest.py` :

- comptines et chansons traditionnelles : Frère Jacques, Au clair de la lune, Ah ! vous dirai-je maman, La cucaracha ;
- auteurs morts depuis plus de 70 ans : Joyeux anniversaire (Mildred et Patty Hill, †1916 et †1946), Vive le vent
  (James Lord Pierpont, †1893), Beethoven, Mozart, Grieg, Vivaldi, Offenbach.

La composition est libre et l'interprétation est la nôtre (aucun disque existant) : ni droit d'auteur ni droit voisin.

## MP3 importés par l'animatrice

Pour les vraies chansons du blind test, l'appli joue les MP3 que l'animatrice importe elle-même dans l'administration.
L'appli ne contrôle ni ne bloque jamais un fichier pour une question de droits, et n'utilise aucun service de streaming
(leurs conditions interdisent la diffusion publique). Si un lieu l'exige, la déclaration SACEM d'un événement est à la
charge de l'organisateur ; le paquet intégré ci-dessus reste disponible quand on veut zéro démarche.

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
python3 tools/habillage/blindtest.py out frere_jacques      # un extrait du blind test intégré (bt_frere_jacques.wav)
ffmpeg -i out/generique.wav -c:a libvorbis -q:a 4 tv/src/main/res/raw/lmp_generique.ogg
```

Les quatre boucles musicales (`lmp_bed_full`, `lmp_bed_light`, `lmp_bed_mimes`, `lmp_bed_pause`) gardent la métadonnée `ANDROID_LOOP=true`
(`-metadata ANDROID_LOOP=true` à l'encodage) pour tourner sans coupure sur la box.
