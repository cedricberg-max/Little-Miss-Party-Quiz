# Little Miss Party Quiz

Quiz interactif façon jeu télévisé pour les prestations Little Miss Party.

- **`tv/`** : l'application Android TV (Kotlin, Jetpack Compose) qui affiche le jeu et le QR code.
- **`engine/`** : le moteur de jeu en Kotlin pur (barème, chrono, journal, reprise), testé sans Android.
- **`tests/`** : tests automatiques des règles Firebase et du pupitre sur l'émulateur Firebase.
- **`web/public/`** : le pupitre des équipes (`index.html`) et la régie de l'animatrice (`regie.html`), des pages web qui marchent sur tout téléphone ou tablette (Android et Apple).
- **`database.rules.json`** : les règles de sécurité de la base Firebase.
- **`firebase-config.json`** : la configuration Firebase publique, partagée par la TV et le pupitre.

## Comment ça marche

1. La box TV crée une partie sur Firebase et affiche un QR code.
2. Chaque équipe scanne le QR code : la page pupitre s'ouvre, l'équipe choisit son nom et sa couleur.
3. L'animatrice relie son téléphone : bouton « Relier la régie » sur la TV, scan du QR code, saisie du
   code à 4 chiffres affiché. Le téléphone pilote ensuite la partie (lancer, chrono, révéler, scores,
   corrections) ; la télécommande de la box reste utilisable en secours.
4. Tout passe par Internet (Wi-Fi du lieu ou 4G), sans réseau commun ni routeur.

## Installer l'appli sur la box

À chaque mise à jour de `main`, GitHub compile l'APK et le publie dans les **Releases** du dépôt
(Firebase Hosting refuse les fichiers .apk sur l'offre gratuite). Le pupitre et les règles de la base
sont publiés sur Firebase Hosting en même temps.

Pour installer : télécharger l'APK depuis la dernière Release sur le PC, puis l'envoyer sur la Mi Box
avec une clé USB ou l'appli « Send Files to TV ».

## Tests automatiques

Lancés par GitHub à chaque modification ; aucun APK n'est publié si l'un échoue.

- Moteur : `./gradlew -p engine test`
- Règles Firebase, pupitre et régie (navigateur simulé, émulateur Firebase) : `cd tests && npm ci && npm test`

## Rapports de plantage

La box envoie ses plantages dans `reports/` au démarrage suivant. Le workflow GitHub
« Rapports de la box » (lancement manuel) affiche les 20 derniers.
