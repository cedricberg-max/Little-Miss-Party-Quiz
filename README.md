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

À chaque mise à jour de `main`, GitHub compile l'APK et le publie dans les **Releases** du dépôt
(Firebase Hosting refuse les fichiers .apk sur l'offre gratuite). Le pupitre et les règles de la base
sont publiés sur Firebase Hosting en même temps.

Pour installer : télécharger l'APK depuis la dernière Release sur le PC, puis l'envoyer sur la Mi Box
avec une clé USB ou l'appli « Send Files to TV ».
