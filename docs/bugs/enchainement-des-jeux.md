# Bug n° 8 : impossible de passer au jeu suivant après le quiz

**Statut : corrigé (19 octobre 2026). À surveiller à chaque mise à jour (règle de cedric) :**
avant chaque publication, vérifier que l'on passe d'un jeu à l'autre avec les équipes et les scores
conservés. Les tests de non-régression listés plus bas doivent rester verts et ne jamais être retirés.

## Symptôme (test réel du 19 octobre)

À la fin du quiz, la régie ne proposait aucun moyen d'aller au jeu suivant : l'animatrice restait
bloquée sur le classement ou sur l'écran de fin.

## Causes

Le moteur d'enchaînement fonctionnait (testé) ; c'est la TV qui avait reçu un programme incomplet ou
périmé, et la régie ne le montrait pas.

1. **Liste des prestations figée** : la régie lisait la bibliothèque une seule fois, à l'ouverture de
   la page. Une prestation modifiée ensuite dans l'administration (jeu ajouté) était chargée dans son
   ancienne version.
2. **Jeu injouable écarté sans le dire** : `buildSnapshot` (web/public/show.js) retirait en silence
   un jeu impossible à construire (paquet supprimé, playlist vide…) dès qu'il restait un autre jeu.
   Le quiz devenait alors le dernier jeu du programme.
3. **Mauvais libellé** : à la fin d'un jeu, la TV et la régie affichaient « Question suivante » ; rien
   n'annonçait le jeu suivant.
4. **Pas de reprise après la fin** : une fois la partie terminée (dernier jeu du programme ou appui
   long « Terminer la partie »), le moteur, la régie et les règles Firebase refusaient tout ajout de jeu.

## Correction

- La régie relit la bibliothèque au moment du chargement (`readShows`, `loadShow` dans
  web/public/regie.js) et affiche, avant de lancer, le programme qui sera joué. Un jeu injouable est
  signalé (« ⚠ ») et l'animatrice choisit « Lancer quand même » en connaissant le programme réel.
- Le salon d'attente de la régie affiche « Programme sur la TV (N jeux) : A → B → C ».
- Fin d'un jeu : « Jeu suivant : X » sur la TV (`Game.nextGameTitle`, engine/Program.kt) et sur la
  régie ; « Résultats finaux » seulement à la toute fin.
- Récupération contrôlée après la fin : la régie peut ajouter un jeu (onglet Programme) ou rejouer /
  aller à un jeu (🛟 Jeux) ; la partie reprend avec les mêmes équipes et les mêmes points.
  `Game.programProblem` accepte un programme modifié après la fin ; la règle RTDB `games/$code/show`
  accepte une modification de programme (`base`) après la fin, jamais le chargement d'une autre
  prestation.
- La Super Finale n'est plus un jeu à part : ses questions (×2) terminent le quiz qui la précède
  (`assemble` dans show.js), ce qui supprime un passage de jeu inutile.

## Tests de non-régression

- engine/src/test/.../ProgramTest.kt : « après la fin, un jeu ajouté permet de reprendre la partie sans
  perdre les points », « la fin d'un jeu annonce le jeu suivant, jamais au milieu d'un jeu ».
- Enchaînement quiz → mimes → quiz avec équipes et scores gardés : tests du moteur (GameTest,
  ProgramTest) et test émulateur tv/src/androidTest/.../RegieTest.kt.
- tests/regie.test.js : « secours : jeu en cours et suivant, passer au suivant, rejouer un jeu après
  confirmation » (partie terminée par erreur, reprise sur le jeu suivant).
- tests/rules.test.js : programme modifiable après la fin, autre prestation refusée.
- tests/importer.test.js : « Super Finale : les dernières questions du quiz, pas un jeu à part ».
