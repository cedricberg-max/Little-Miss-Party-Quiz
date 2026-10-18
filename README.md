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
5. Tablette déchargée ou cassée en pleine partie : n'importe quel téléphone scanne le même QR code et
   « demande à entrer ». Sur la régie, l'animatrice choisit « Remplace « Les Bleus » » (l'équipe garde
   nom, couleur et points ; l'ancien appareil est désactivé pour de bon, même s'il revient) ou
   « Nouvelle équipe » (8 au plus). Une fois la partie commencée, aucun appareil n'entre sans elle.

## Installer l'appli sur la box

À chaque mise à jour de `main`, GitHub compile l'APK et le publie dans les **Releases** du dépôt,
et la recopie sur Firebase Hosting pour la mise à jour depuis la TV. Le pupitre et les règles de la base
sont publiés sur Firebase Hosting en même temps.

Première installation : télécharger l'APK depuis la dernière Release sur le PC, puis l'envoyer sur la
Mi Box avec une clé USB ou l'appli « Send Files to TV ». C'est la seule fois.

### Mettre à jour depuis la TV

La box cherche seule une nouvelle version au démarrage puis toutes les 30 minutes (un petit fichier).
Quand il y en a une, une fenêtre la propose à l'accueil : **Installer maintenant** enchaîne
téléchargement, vérification et installation ; **Plus tard** (ou Retour) ne la repropose qu'au prochain
lancement. Recherche manuelle toujours possible : bouton Retour de la télécommande › **Rechercher une
mise à jour** (aussi sur l'écran « Connexion impossible »). La box lit `tv/latest.json` sur l'hébergement Firebase (publié par GitHub Actions avec
chaque version stable de `main`), télécharge l'APK avec sa progression (reprise après une coupure), puis
vérifie avant d'installer : taille et empreinte SHA-256, nom de l'appli, versionCode plus récent, même
clé de signature que l'appli installée. Android demande ensuite de confirmer l'installation ; les
parties, réglages et codes sont conservés, l'appli redémarre seule.

- Jamais pendant une prestation : dès qu'une équipe est dans le salon ou qu'une question a été jouée,
  la fenêtre dit d'attendre la fin de la partie, et la proposition automatique attend le retour à
  l'accueil. Une version trouvée est aussi indiquée en petit dans le coin.
- Une seule autorisation Android, la première fois : « Sources inconnues » pour Little Miss Party Quiz
  (la fenêtre ouvre le réglage).
- Le dépôt étant privé, la box ne lit pas les Releases GitHub (il faudrait un jeton dans l'APK) : chaque
  version stable est recopiée sur l'hébergement Firebase, qui accepte les fichiers .apk sur Blaze, dans
  le quota gratuit (un APK d'environ 15 Mo par mise à jour de box).
- GitHub Actions bloque toute version dont le nom d'appli, le versionCode ou la clé de signature
  différerait (la box la refuserait).

## Tests automatiques

Lancés par GitHub à chaque modification ; aucun APK n'est publié si l'un échoue.

- Moteur : `./gradlew -p engine test`
- Règles Firebase, pupitre et régie (navigateur simulé, émulateur Firebase) : `cd tests && npm ci && npm test`

## Quiz et prestations

Dans l'administration (`admin.html`, mot de passe administrateur commun) :

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
Paramètres › Mot de passe de la régie). Le serveur garde seulement une empreinte illisible et compare lui-même
(règles Firebase) ; il n'accepte qu'un essai toutes les 2 secondes. Les régies déjà reliées restent
reliées après un changement.

Deux accès séparés, deux mots de passe communs, sans aucun compte ni adresse e-mail :

- **Administration** (bibliothèque, prestations, les deux mots de passe) : le mot de passe administrateur.
  Toute personne qui le connaît a tous les droits. Le premier se choisit à la première ouverture de
  `admin.html` ; il se change dans Paramètres. Un ordinateur reste reconnu après un rechargement, jusqu'au
  prochain changement. Mot de passe perdu : effacer `settings/admin` dans la console Firebase (Realtime
  Database), puis en choisir un nouveau.
- **Régie en prestation** : le mot de passe de régie, sur le téléphone de l'animatrice. Il ne donne aucun
  droit d'administration.

Les deux sont vérifiés par les règles Firebase (empreinte SHA-256 salée, jamais relisible, un essai toutes
les 2 secondes). Box, pupitres, régie et administration utilisent une connexion Firebase anonyme : le jour J,
rien ne dépend de Google ni d'un e-mail.

## Rapports de plantage

La box envoie ses plantages dans `reports/` au démarrage suivant. Le workflow GitHub
« Rapports de la box » (lancement manuel) affiche les 20 derniers.
