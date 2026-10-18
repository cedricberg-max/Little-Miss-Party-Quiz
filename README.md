# Little Miss Party Quiz

Quiz interactif façon jeu télévisé pour les prestations Little Miss Party.

- **`tv/`** : l'application Android TV (Kotlin, Jetpack Compose) qui affiche le jeu et le QR code.
- **`engine/`** : le moteur de jeu en Kotlin pur (barème, chrono, journal, reprise), testé sans Android.
- **`tests/`** : tests automatiques des règles Firebase et du pupitre sur l'émulateur Firebase.
- **`web/public/`** : la page des pupitres et de la régie (`index.html`, deux modes : joueur et régie) et l'administration (`admin.html`), des pages web qui marchent sur tout téléphone, tablette ou PC.
- **`database.rules.json`** : les règles de sécurité de la base Firebase.
- **`firebase-config.json`** : la configuration Firebase publique, partagée par la TV et le pupitre.

## Comment ça marche

1. La box TV crée une partie sur Firebase et affiche un QR code.
2. Chaque équipe scanne le QR code : la page pupitre s'ouvre, l'équipe choisit son nom et sa couleur.
3. L'animatrice scanne le même QR code, touche le petit bouton « 🎛 Accès régie » en bas à droite et
   saisit le mot de passe commun des animatrices. Son téléphone pilote ensuite la partie (lancer, chrono,
   révéler, scores, corrections) ; la télécommande de la box reste utilisable en secours. Sans mot de
   passe : « Code affiché sur la TV » (bouton Retour de la télécommande, « Code de secours de la régie »).
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

## Quiz et prestations

Dans l'administration (`admin.html`, compte Google principal de cedric) :

- **Quiz › Importer un quiz** : la page fournit la consigne à coller dans Gemini ; on colle sa réponse
  (ou des lignes copiées d'un tableur, ou un fichier CSV), puis on relit. Les anomalies sont signalées
  (bonne réponse absente ou double, propositions identiques, question trop longue pour l'âge, doublon).
  Seules les questions **validées** sont jouées.
- **Prestations › Nouvelle prestation** : prénom de l'enfant, âge, date, manches dans l'ordre (quiz ou
  Super Finale aux points doublés). Statut « Prête » : la prestation apparaît sur la régie.
- Le jour J, dans le salon d'attente, la régie (entrée avec le mot de passe) ouvre l'onglet
  **Prestation** : une touche charge la prestation sur la TV, qui accueille l'enfant par son prénom.

Sans prestation chargée, la TV joue le quiz de démonstration livré avec l'appli.

## Mot de passe de la régie

Il se change dans l'administration (`https://little-miss-party-quiz.web.app/admin.html`,
Paramètres › Accès régie). Le serveur garde seulement une empreinte illisible et compare lui-même
(règles Firebase) ; il n'accepte qu'un essai toutes les 2 secondes. Les régies déjà reliées restent
reliées après un changement.

Deux accès strictement séparés :

- **Administration** (bibliothèque, prestations, mot de passe de régie) : un seul compte Google, celui
  de cedric (berguig.cedric@gmail.com, propriétaire du projet Firebase), que Sarah utilise sur le PC
  familial. Inscrit dans `database.rules.json` (expression `auth.token.email.matches(...)`, adresse
  vérifiée). La connexion Google doit être activée dans Firebase (Authentication › Méthodes de
  connexion › Google) ; elle ne sert qu'à cette page.
- **Régie en prestation** : le téléphone de l'animatrice, avec le seul mot de passe de régie (connexion
  Firebase anonyme + vérification par les règles). Aucun compte Google, aucun e-mail, aucun code reçu
  par e-mail. La box et les pupitres utilisent aussi une connexion anonyme, sans e-mail.

## Rapports de plantage

La box envoie ses plantages dans `reports/` au démarrage suivant. Le workflow GitHub
« Rapports de la box » (lancement manuel) affiche les 20 derniers.
