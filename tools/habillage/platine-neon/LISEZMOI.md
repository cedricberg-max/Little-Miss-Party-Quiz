# Platine néon du Blind test (look Game Show)

Rendu 3D (three.js) de la platine validée par cedric le 24/10, d'où sortent les deux images de l'appli :

- `tv/src/main/res/raw/gs_bt_disque.mp4` : le disque en boucle (deux tours en 3,64 s, 25 images/s), couleur en haut,
  bande noire, transparence en bas, lu par `LecteurAlpha`.
- `tv/src/main/res/drawable-nodpi/gs_bt_bras.webp` : planche 3 × 3 du bras, de posé (0) à relevé (8).

Tout ce qui suit la musique (égaliseur, ondes, lasers, hologramme) est dessiné en direct par `PlatineNeon.kt`, avec la
même caméra que `platine-appli.html` (champ 27°, élévation 33°, distance 6,8, visée (0,08 ; 0,05 ; 0), image 1012 × 900).

Refaire les images :

1. Dans ce dossier : `npm i three playwright`, et un dossier `fonts/` avec `bungee.ttf` et `orbitron900.ttf`
   (copies de `lmp_gs_bungee.ttf` et `lmp_gs_orbitron_black.ttf`).
2. `./rendre.sh` : images du disque (`disque/c`, `disque/m`) et des 9 positions du bras (`bras0` … `bras8`).
3. `python3 encoder_disque.py . gs_bt_disque.mp4 10` puis `python3 planche_bras.py . gs_bt_bras.webp 100`.
4. Si la caméra ou le cadre du bras changent : reporter les mesures dans `PlatineNeon` (caméra, `BRAS_X` …) ;
   `PlatineNeonTest` vérifie la projection et la taille de la planche.
