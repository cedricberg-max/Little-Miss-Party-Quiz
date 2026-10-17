# Little Miss Party Quiz

Quiz interactif façon jeu télévisé pour les prestations Little Miss Party.

- **`tv/`** : l'application Android TV (Kotlin, Jetpack Compose) qui affiche le jeu et le QR code.
- **`web/public/`** : le pupitre des équipes, une page web qui marche sur tout téléphone ou tablette (Android et Apple).
- **`database.rules.json`** : les règles de sécurité de la base Firebase.
- **`firebase-config.json`** : la configuration Firebase publique, partagée par la TV et le pupitre.

## Comment ça marche

1. La box TV crée une partie sur Firebase et affiche un QR code.
2. Chaque équipe scanne le QR code : la page pupitre s'ouvre, l'équipe choisit son nom et sa couleur.
3. Tout passe par Internet (Wi-Fi du lieu ou 4G), sans réseau commun ni routeur.

## Installer l'appli sur la box

À chaque mise à jour de `main`, GitHub compile l'APK et le publie avec le pupitre sur Firebase Hosting :
`https://<projet>.web.app/tv.apk`. Sur la Mi Box, installez l'appli **Downloader**, tapez cette adresse et installez.
L'APK est aussi téléchargeable dans l'onglet *Actions* de GitHub (artefact `little-miss-party-quiz-tv`).
