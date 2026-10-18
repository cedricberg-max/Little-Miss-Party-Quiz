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

## 2. Univers « Néon chic » (direction fluo, palette en cours de validation)

Plateau de jeu télévisé moderne, ambiance soirée fluo et lumière noire : fond très sombre, halos néon,
couleurs fluorescentes des équipes. Le logo Little Miss Party (néon blanc rosé + « PARTY » doré) donne
la touche élégante ; les équipes apportent le fluo.

**Statut** : les valeurs ci-dessous sont des **propositions** issues de l'analyse du logo et des
accessoires (18/10/2026). Tant que cedric ne les a pas validées, ne pas les figer dans le code ailleurs
que dans les jetons centralisés (`ui/Theme.kt` côté TV, variables CSS `:root` côté web). Une fois
validées, remplacer ce paragraphe par « Palette validée le … ».

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

### Couleurs d'équipe (proposition)

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

1. **Une seule animation « héros » à la fois.** Pendant une question, seul le chrono bouge.
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

## 6. Son

- Effets courts (buzz, clac, victoire, tic-tac) : `SoundPool`, préchargés au démarrage de la partie.
  Le `ToneGenerator` actuel de `GameViewModel.kt` est provisoire.
- Musiques et extraits du blind test : lecteur média (Media3/ExoPlayer) sur fichiers locaux en cache.
- Un son de buzzer **propre à chaque équipe**. Tapis musical bas pendant la réflexion. Volume général
  réglable depuis la régie. Pas plus d'un son « événement » à la fois.

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
- Retour en moins de 100 ms après un toucher (état local immédiat, vibration, son), puis confirmation
  « Réponse enregistrée » quand le serveur a accepté.
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
