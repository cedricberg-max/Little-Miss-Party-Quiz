---
name: lmp-plateau-tv-motion
description: Direction artistique, écrans, animations Compose/Lottie et sons de Little Miss Party Quiz sur la TV (tv/), le pupitre web (web/public) et la régie. À lire avant de créer ou modifier un écran, une transition, un chrono, une révélation, un effet sonore ou un style.
---

# Plateau TV et motion design : Little Miss Party Quiz

Ce skill fixe **comment le jeu se voit et s'entend**. Les règles du jeu (points, durées de chrono,
textes) viennent de `lmp-game-design-enfants` ; l'état affiché vient de `lmp-firebase-rtdb-fiabilite`.
Pour un audit de performance approfondi, utiliser aussi le skill officiel Google
`jetpack-compose-performance`.

## 1. Contexte matériel et technique (à respecter)

- **TV** : Xiaomi Mi Box (Android TV 9, environ 2 Go de RAM, GPU modeste), sortie 1080p, vue à 3 à
  4 m. `minSdk 26`. Tout effet doit tenir **60 images/s sur la Mi Box**, pas seulement sur émulateur.
- **Pas d'API 31+ sur la box** : pas de `Modifier.blur` / `RenderEffect` (ignorés avant Android 12).
  Faire les flous avec des images pré-floutées ou des dégradés.
- **Stack actuelle** : Compose avec `androidx.compose.material3` (mobile), écrans dans
  `tv/src/main/java/com/littlemissparty/quiz/tv/QuizTvApp.kt`. On **ne migre pas** vers
  `androidx.tv.material3` sans décision : la TV est surtout un écran d'affichage piloté par la régie.
  `tv-material` ne devient utile que pour des écrans très navigués à la télécommande.
- **Pupitre** : HTML/CSS/JS sans framework (`web/public/`), sur n'importe quel téléphone ou tablette,
  Safari iOS compris.
- **Régie** : page web sur le téléphone de l'animatrice (à créer), même stack que le pupitre.
- Pas de SDK Android dans le conteneur : les vérifications visuelles passent par les APK de GitHub
  Actions et les tests de captures en CI.

## 2. Univers « Néon chic », version 2 (validée le 18/10/2026)

Plateau de jeu télévisé moderne, ambiance soirée fluo et lumière noire : fond très sombre, halos néon,
couleurs fluorescentes des équipes. Le logo Little Miss Party (néon blanc rosé + « PARTY » doré) donne
la touche élégante ; les équipes apportent le fluo. La version 2 ajoute de la profondeur, du rythme et
de la surprise sans toucher à la lisibilité.

**Statut** : direction artistique V2 validée par cedric le 18/10/2026. Maquettes de référence (V2 à
gauche, V1 à droite) : https://claude.ai/artifact/EssiViu72HPNfRpnVcsEE7 . Les 4 couleurs d'équipe et
les emblèmes sont validés **à titre provisoire** : cedric les compare encore aux bracelets réels. Les
valeurs ne vivent donc qu'à un seul endroit par plateforme (`ui/Theme.kt` côté TV, variables CSS
`:root` côté web) pour pouvoir être ajustées sans toucher aux écrans.

### Décor en 3 plans (V2)

1. **Fond** : dégradé profond (`#24093F` → `#130726` → `NightDeep`), halos diffus rose halo, or et
   violet `#6E28BE` à faible opacité, texture de points (1 px tous les 24 px, blanc à 4 à 7 %), sol de
   plateau en perspective sur les écrans d'accueil. Tout ce plan est **une seule image WebP précalculée**
   par écran-type (environ 150 Ko), jamais dessinée image par image.
2. **Arcs et cercles de plateau** : grands arcs néon partiels, cercles en pointillés, faisceaux de
   projecteurs. Images ou traits statiques ; animation permise : respiration lente (`alpha`, 6 s) ou
   rotation très lente des rayons.
3. **Éclats** : étincelles à 4 branches (10 à 14 sprites maximum, chacune scintille en `alpha` à son
   rythme), confettis en tirets, petits gribouillis néon (zigzag, vague, flèche en pointillés) sur les
   bords, emblèmes en « stickers » ronds légèrement inclinés (± 6 à 12°).

- Couleurs du décor : rose halo `#F888B3`, or et blanc néon uniquement. **Les couleurs fluo n'entrent
  dans le décor que pour fêter une équipe** (accueil avec toutes les équipes, buzz, révélation,
  victoire).
- **Pendant une question**, le décor tombe à environ 40 % ; les étincelles restent sur les bords, jamais
  derrière le texte ; la question est posée sur un panneau sombre (`NightDeep` à 55 %).
- Effets ludiques permis : texte en double néon (contour décalé, `TextStyle(drawStyle = Stroke(...))`
  sous le texte plein), pastilles dorées inclinées, chiffres géants en contour. Rien d'enfantin ni de
  dessin animé : pas de mascotte, pas de bulles, pas de couleurs pastel.
- **Mode sobre** automatique : si la box rate des images (frame time > 20 ms sur 2 s), couper le plan 3
  et les rotations, garder fond et contenu.

### Règle d'or : la couleur dit QUI, la forme dit QUOI

- **Couleur = équipe.** Les couleurs fluo appartiennent aux équipes et à rien d'autre (score, nom,
  pupitre, buzzer, célébration). Elles reprennent les bracelets et bandeaux portés par les enfants.
- **Forme = proposition.** Les propositions A à D sont **neutres** (cartes sombres, contour néon blanc)
  et se distinguent par une forme et une lettre : A triangle, B losange, C rond, D carré. Jamais une
  couleur d'équipe sur une proposition.
- **Or = la marque et la bonne réponse.** L'or du logo signale les moments forts et la bonne réponse
  (pas le vert, qui est une couleur d'équipe).

### Jetons de marque (relevés dans le logo officiel)

| Jeton | Valeur | Usage |
| --- | --- | --- |
| `NightDeep` | `#0B0614` | fond principal (noir violacé, fait ressortir le fluo) |
| `Night` | `#1A0B2E` | panneaux, dégradés |
| `NeonWhite` | `#FFF4F2` | cœur du néon du logo, textes principaux |
| `NeonHalo` | `#F888B3` | halo rose du logo, décor de marque |
| `Gold` | `#F0CC92` (dégradé `#E0B577` → `#F6DAAA`) | titres, cadres, bonne réponse, victoire |
| `Muted` | blanc à 35 % | mauvaise réponse, éléments inactifs |

### Couleurs d'équipe (validées à titre provisoire)

| Équipe | Accessoire (photo) | Valeur écran proposée | Emblème |
| --- | --- | --- | --- |
| Verte | `#8EE52F` à `#C2F83E` | `#7CFF3A` | éclair |
| Rose | `#F42B77` à `#EF3D97` | `#FF2D8A` | cœur |
| Jaune | `#F0CE0D` à `#F5E527` | `#FFE61F` | étoile |
| Orange | `#EB3218` à `#EE4F28` | `#FF5A1F` | flamme |
| Équipes 5 à 8 | à décider (accessoires supplémentaires) | cyan `#22E4FF`, violet `#B45CFF`, bleu `#3D7BFF`, blanc `#F4F4FF` | goutte, lune, diamant, couronne |

Chaque équipe a aussi un **emblème** affiché avec sa couleur : il garantit la lisibilité pour les
enfants daltoniens (vert, jaune et orange se confondent en deutéranopie).

### Logo

- Fichier fourni : PNG détouré 2676 × 957, fond transparent, halo intégré. Il est prévu pour un fond
  sombre : ne jamais le poser sur un fond clair ni le recolorer, le déformer ou lui ajouter un contour.
- Version TV : export WebP environ 1 200 px de large dans `res/drawable-nodpi`. Animation permise :
  apparition en fondu et légère respiration du halo (`graphicsLayer { alpha }`), rien d'autre.
- Emplacements : écran d'accueil et générique (grand), coin supérieur pendant le jeu (petit,
  discret), écran final.

### Typographie

- Titres : police ronde et grasse (Fredoka ou Baloo 2) ; texte : Nunito. Fichiers de police
  embarqués dans l'APK (`res/font`) et servis par Hosting pour le web, **jamais chargés depuis Internet
  pendant une partie**.
- Tailles TV minimales : texte courant 28 sp, question 48 sp, propositions 40 sp, scores 56 sp, titres
  64 à 88 sp. Largeur d'un bloc de lecture limitée à environ 1 200 dp.

### Gabarit d'écran TV

```
┌───────────────────────────────────────────────┐  marges de sécurité : 48 dp à gauche/droite,
│ [Pictogramme jeu]  Manche 1 · Question 4/8    │  27 dp en haut/bas (surbalayage des TV)
│                                               │
│              ZONE DE JEU (centre)             │
│                                               │
│ [Équipe A ▮▮▮▮ 800]   ( chrono )   [Équipe B] │  scores et chrono toujours aux mêmes places
└───────────────────────────────────────────────┘
```

Chaque jeu a son pictogramme et sa couleur d'accent, mais garde ce gabarit.

## 3. Règles de mouvement

1. **Une seule animation « héros » à la fois.** Pendant une question, seul le chrono bouge (plus le
   scintillement lent des étincelles des bords, décor à 40 %).
2. Durées :

| Élément | Durée | Courbe |
| --- | --- | --- |
| Transition entre écrans | 300 à 600 ms | `FastOutSlowInEasing` |
| Apparition d'une proposition | 250 ms, décalage 120 ms entre chaque | ressort amorti |
| Introduction de manche | 3 à 4 s, passable | — |
| Compteur de points | 600 à 900 ms | décélération |
| Bandeau « Annuler » de la régie | 10 s | linéaire |

3. **Séquence de révélation (QCM)**, identique dans tous les jeux pour que les enfants l'anticipent :
   verrouillage + son « clac » → 1 000 ms de roulement → mauvaises propositions vers `Muted` (300 ms)
   → bonne proposition en `Gold` + halo doré + son de victoire (400 ms) → pastilles des équipes sur leur
   choix (300 ms) → points qui s'envolent vers les scores (600 ms) → compteur.
4. **Chrono expressif** : anneau qui se vide, couleur qui chauffe sur les 5 dernières secondes,
   tic-tac seulement à la fin, légère pulsation. Le temps affiché est calculé depuis l'état serveur
   (jamais un `delay(1000)` qui décrémente un compteur local).
5. **Pause** : tout se fige (chrono, musique, animations en boucle) et un écran « Pause » élégant
   s'affiche. La reprise reprend l'animation au même point.
6. Résultats finaux : barres qui montent ensemble, la première s'arrête, pause 1 s, confettis et nom du
   vainqueur, puis trophées secondaires.

### Temps forts de la V2

| Moment | Durée | Séquence | Technique Mi Box |
| --- | --- | --- | --- |
| Introduction de manche | ≈ 3 s, passable | riser → chiffre géant en contour qui claque avec rebond → rayons qui tournent lentement → bandeau du thème en biais (−5°) qui glisse → règles en pastilles → emblèmes des équipes qui s'allument un par un, « Tout le monde est prêt ? » | rayons = une image tournée en `graphicsLayer { rotationZ }` ; chiffre en `scale` ressort |
| Buzz | < 1,2 s | son + flash **dès la réception** → onde de choc (3 anneaux `scale` + `alpha`) → rayons couleur d'équipe → emblème géant qui tombe en tournant → confettis de l'équipe → nom en double néon ; autres équipes en « bloqués » | anneaux et rayons = images teintées ; confettis ≤ 60 rectangles dans un seul `Canvas` |
| Révélation | ≈ 3 s | verrouillage + roulement (1 000 ms) → le projecteur hésite sur les propositions → les fausses s'éteignent une à une → la bonne en or avec éclat de rayons dorés et étiquette « BONNE RÉPONSE » → emblèmes des équipes gagnantes « tamponnés » sur la carte → +points qui montent au-dessus des scores → compteurs | faisceau = image en dégradé déplacée en `translationX` |
| Victoire | ≈ 8 s | riser → podiums qui montent de la 4e à la 1re → couronne qui tombe sur le gagnant → explosion de confettis or + couleurs d'équipe → faisceaux qui balayent → fanfare → un prix en sticker pour chaque équipe | confettis ≤ 120 dans un seul `Canvas` ou Lottie < 150 Ko |

**Révélation du blind test** : même tension que la révélation QCM, puis la pochette (carré de 360 dp,
cadre or) apparaît en grand avec le titre et l'artiste en double néon ; l'emblème de l'équipe qui a
trouvé se tamponne sur la pochette. Pochette absente : grand disque vinyle néon à la place.

La logique du buzzer (horodatage, départage, verrou) ne dépend **jamais** d'une animation : l'écran
réagit à l'état, il ne le produit pas.

## 4. Animations Compose : consignes de code

- Lire les valeurs animées **dans les phases Layout/Draw**, pas dans la composition :
  `Modifier.graphicsLayer { alpha = a; scaleX = s; scaleY = s }`, `Modifier.offset { IntOffset(...) }`.
  Ne jamais écrire `Modifier.alpha(animatedAlpha)` dans un écran qui s'anime en continu.
- Plusieurs propriétés liées à un même état → `updateTransition(etat)`. Une animation en boucle
  (`rememberInfiniteTransition`) uniquement pour l'élément héros visible.
- Isoler le chrono et les compteurs dans leurs propres composables pour que leur recomposition ne
  touche pas le reste de l'écran. Passer des lambdas (`{ remaining }`) plutôt que des valeurs qui
  changent à chaque image.
- Dessins personnalisés (anneau du chrono, faisceaux) avec `Canvas`/`drawBehind`, objets `Path` et
  `Brush` mémorisés (`remember`), aucune allocation dans la boucle de dessin.
- Les écrans sont pilotés par l'état (`UiState`) exposé par le ViewModel ; une animation ne modifie
  jamais l'état du jeu.

### Effets néon sans flou en temps réel

- **Texte néon** : `TextStyle(shadow = Shadow(color = couleur.copy(alpha = 0.8f), blurRadius = 24f))`,
  éventuellement deux couches (halo large peu opaque + halo serré). Fonctionne sur Android 9.
- **Formes néon** (cadres, anneau du chrono, contours des propositions) : dessiner 2 ou 3 traits
  superposés de largeur décroissante et d'opacité croissante, ou un `Brush.radialGradient` derrière la
  forme dans `drawBehind`. Pas de `Modifier.blur`.
- **Grands halos** (projecteurs, explosion de buzzer) : images PNG/WebP pré-floutées, teintées par
  `ColorFilter.tint`, animées en `alpha`/`scale` via `graphicsLayer`.
- Au plus **3 éléments lumineux animés en même temps** à l'écran ; un halo au repos est statique.

## 5. Lottie et Rive

- **Lottie** (`com.airbnb.android:lottie-compose`) pour les moments illustrés : confettis, trophée,
  mascotte, introductions. Fichiers dans `assets/`, **moins de 150 Ko**, sans masques ni mattes lourds,
  préchargés avant la partie. Tester chaque fichier sur la Mi Box avant de l'adopter.
- **Rive** : pas avant une décision explicite (mascotte interactive en V2), et seulement si un designer
  fournit les fichiers.
- Jamais d'animation téléchargée pendant une partie.

## 6. Son (validé le 18/10/2026)

Deux sound designs distincts : **la box fait le spectacle, les pupitres font le retour personnel.** Le
son de la TV couvre la salle ; celui des tablettes est faible et ne doit jamais le doubler.

### Box (TV)

| Moment | Sons |
| --- | --- |
| Accueil | boucle d'ambiance douce ; « ding » brillant à chaque équipe connectée |
| Introduction de manche | riser 1,5 s → boom sur le chiffre → woosh sur le bandeau → jingle propre au type de manche (quiz, blind test, mini-jeu) |
| Question | « pop » à l'apparition ; silence pendant la lecture ; tic-tac léger sur les 5 dernières secondes seulement |
| Buzz | impact franc + éclat brillant, joué dès réception ; la musique du blind test baisse automatiquement (ducking) puis se coupe |
| Révélation | roulement de tambour → « tchic » par fausse proposition éteinte → carillon doré sur la bonne → « blings » pendant le défilement des points |
| Mauvaise réponse | « bloop » gentil, jamais de buzzer humiliant |
| Victoire | riser → fanfare → explosion des confettis → applaudissements |

- Effets courts : `SoundPool`, **tous préchargés au démarrage** (une vingtaine de sons OGG, 2 Mo au
  total au plus). Le `ToneGenerator` actuel de `GameViewModel.kt` est provisoire.
- Musiques et extraits du blind test : Media3/ExoPlayer sur fichiers locaux en cache.
- Au plus **2 sons simultanés** (un événement + une ambiance). Pas de boom très grave ni très fort
  (public de 6 à 8 ans). Volume des effets et de la musique réglables séparément depuis la régie.
- Sources : bruitages libres de droits à usage commercial (licence vérifiée et notée à côté de chaque
  fichier). Aucun service payant sans accord de cedric. Les extraits musicaux relèvent d'une décision
  de droits à part (voir le skill `lmp-firebase-rtdb-fiabilite`, médias).

### Pupitres (téléphones et tablettes Android)

- Seulement des retours courts et aigus (ils percent mieux sur un petit haut-parleur) : « tic » au
  toucher, « c'est enregistré » à la confirmation, « buzz reçu » ou « trop tard » doux.
- **Jamais** le chrono, les jingles ni les sons de la TV : le décalage entre appareils créerait un écho.
- Le vrai retour est **visuel** : flash plein écran dans la couleur de l'équipe. Le son est un bonus ;
  bouton muet par pupitre. Le son est débloqué par le premier toucher (« Rejoindre »).

## 7. Télécommande (secours)

La TV doit rester pilotable à la télécommande si la régie tombe. Pour chaque écran interactif :
focus initial explicite (`FocusRequester` + `LaunchedEffect`), focus visible à 3 m (contour épais ou
agrandissement ~1,1), pas de piège de focus, touches OK = Suivant, Lecture/Pause = Pause, Retour =
dialogue de confirmation existant (`QuitDialog`).

## 8. Pupitre web

- Couleur de l'équipe en plein écran (variable CSS `--team`, déjà en place).
- **Un seul geste attendu à la fois**, boutons d'au moins 120 px de côté, formes A à D identiques à la
  TV, en blanc sur fond sombre ; la couleur de l'équipe reste en fond et en bordure. Pour les `PETITS`,
  pas de texte sur les boutons.
- Retour en moins de 100 ms après un toucher (état local immédiat, flash, son court), puis confirmation
  « Réponse enregistrée » quand le serveur a accepté.
- **Vibration = bonus uniquement.** Beaucoup de tablettes Android bon marché n'ont pas de vibreur et
  `navigator.vibrate()` renvoie `true` même sans moteur : impossible à détecter. Jamais la vibration
  comme seul signal. Écran d'arrivée : bouton « Tester son et vibration » pour vérifier chaque appareil.
- Appareils visés : Android 10 ou plus récent (Chrome à jour), 2 Go de RAM, écran 8 pouces conseillé.
  Le point faible des tablettes bon marché est le Wi-Fi : le tester avant chaque achat groupé.
- Entre deux questions : « Regardez la TV ! ».
- Garder les acquis : déblocage du son au premier toucher, plein écran, `wakeLock`. Respecter
  `prefers-reduced-motion`.

## 9. Régie

Sombre, sobre, une main : état courant en haut, **un gros bouton « Suivant »** au libellé contextuel,
**Pause** toujours visible, pastilles de connexion des pupitres. Actions destructrices par **appui long
de 1 s** (anneau qui se remplit), bandeau « Annuler » de 10 s après chaque action. Aucun effet
décoratif.

## 10. Vérification avant de livrer un écran

1. Captures d'écran Compose générées en CI (voir le skill `testing-setup`) pour chaque état : attente,
   question, verrouillé, révélation, scores, pause.
2. Lisibilité : aucune taille sous les minima de la section 2 ; contraste vérifié.
3. Performance : APK de test sur la Mi Box, options développeur « Rendu GPU du profil » ; aucune barre
   au-dessus de la ligne des 16 ms pendant la révélation et le chrono.
4. Comportement en pause, en reprise après redémarrage, et avec une équipe déconnectée.
