---
name: lmp-firebase-rtdb-fiabilite
description: Architecture de données, règles de sécurité, synchronisation, reprise après crash, reconnexion, chrono serveur, buzz équitable et accès régie de Little Miss Party Quiz sur Firebase Realtime Database. À lire avant toute modification qui lit ou écrit dans Firebase, touche database.rules.json, l'état de partie, les scores, le chrono, le buzzer, les pupitres ou la régie.
---

# Fiabilité Firebase Realtime Database : Little Miss Party Quiz

La fiabilité est l'exigence n° 1 : une panne ne doit jamais faire perdre la partie ni imposer de
recommencer. Ce skill fixe **comment l'état est stocké, protégé et resynchronisé**. Les règles de jeu
viennent de `lmp-game-design-enfants`, l'affichage de `lmp-plateau-tv-motion`.

## 1. L'existant (à conserver)

- Projet Firebase `little-miss-party-quiz`, Realtime Database **europe-west1**, authentification
  **anonyme** pour la TV, les pupitres et la régie.
- **Décisions V1 (cedric, 18/10/2026)** : offre gratuite **Spark** (pas de Cloud Functions, pas de
  Cloud Storage, pas de clé API Gemini ni Claude) ; médias intégrés à l'APK ; **8 équipes maximum** ;
  régie appairée par QR + PIN vérifié par la box ; tout service payant exige l'accord explicite de
  cedric. Feuille de route : https://claude.ai/code/artifact/c59cec39-7c64-4dd3-be46-c138e82011d0
- TV : `tv/src/main/java/com/littlemissparty/quiz/tv/GameViewModel.kt`
  - crée `games/$code` (code de 5 caractères sans ambiguïté, `CODE_CHARS`) avec `hostUid`, `createdAt`,
    `state {phase, buzzOpen, round}` ;
  - **reprise** : code actif dans `SharedPreferences("partie")/active_game`, écran `ResumeOffer` avec
    reprise auto au bout de 15 s, « Réessayer » ne recrée jamais de partie, `newGame()` passe
    l'ancienne en `phase = "ended"` (PR #3). Ne jamais casser ce comportement ;
  - `setPersistenceEnabled(true)` : copie locale, écritures mises en file pendant une coupure.
- Pupitre : `web/public/app.js`, SDK web 11.1.0, une équipe = un `uid` anonyme
  (`games/$code/teams/$uid`), buzz par `set` sur `buzz/$round`.
- Règles : `database.rules.json` (seule la TV écrit la partie, chaque équipe écrit sa fiche, buzz
  écrit une seule fois si `buzzOpen` et bon tour). Déployées **par la CI sur `main` uniquement**
  (`firebase deploy --only hosting,database`) ; jamais de déploiement depuis le conteneur.

Limites connues à corriger : premier buzz **arrivé** gagne (injuste en 4G, lot 4) ; équipe liée à un
`uid` (perdue si le navigateur efface ses données, réattribution par la régie au lot 2) ; partie liée
au `uid` de la box (perdue si les données de la box sont effacées) ; pas encore de régie (lot 2).

## 2. Invariants (ne jamais les violer)

1. **Un seul moteur** : la TV est l'unique écrivain de `state` et `log` (journal). La régie et les pupitres
   écrivent seulement des **intentions** (commandes, réponses, buzz, demande d'appairage).
2. **Journal en ajout seul** : `log` n'est jamais modifié ni supprimé (règle `!data.exists()`). Une
   correction ou une annulation est un nouvel événement (`undoes: <eventId>`).
3. **Scores dérivés** : un score se recalcule à partir des réponses et des événements non annulés.
   Ne jamais stocker un score comme source de vérité (un cache `scores` recalculé est permis, jamais
   lu pour décider). Recompter ne peut jamais doubler.
4. **Idempotence** : chaque commande a un identifiant unique (clé push) ; le moteur note
   `state/appliedCmds/$cmdId` dans la **même** mise à jour multi-chemins que ses effets. Une commande
   déjà notée est ignorée.
5. **Commandes concurrentes** : chaque commande porte `expectSeq`, le `state/seq` que la régie
   affichait. Le moteur traite les commandes une par une, dans l'ordre des clés push, et **rejette**
   une commande d'avancement (`next`, `reveal`, `startTimer`, `skip`…) dont `expectSeq` ne correspond
   plus à `state/seq` (statut `stale`, la régie se met à jour). Deux appuis sur « Suivant », depuis un
   ou deux téléphones, n'avancent donc jamais de deux étapes. Les corrections de score (`adjust`)
   sont commutatives et acceptées même si `seq` a changé.
6. **Écriture unique** des réponses et des buzz (règle `!data.exists()`). Un `PERMISSION_DENIED` sur
   une seconde écriture se traite comme « déjà enregistré », jamais comme une erreur affichée.
7. **Temps serveur** : toute logique de jeu utilise `ServerValue.TIMESTAMP` / `serverTimestamp()` et
   `.info/serverTimeOffset`. Jamais `System.currentTimeMillis()` ou `Date.now()` brut pour décider.
8. **Écritures atomiques** : un changement d'état et ses événements partent dans un seul
   `updateChildren` multi-chemins. Pas de séquence de `setValue` dont une moitié peut échouer.
9. **Bonne réponse secrète** : le contenu du quiz (avec les bonnes réponses) n'est lisible que par la
   box appairée et l'admin. La bonne réponse n'est écrite dans la partie (`reveals/$qKey`) qu'au moment
   de la révélation.
10. **Rien d'essentiel ne dépend du réseau pendant la partie** : quiz chargé avant le début, médias
    dans l'APK.
11. **Pas de nouvelle brique sans décision** : pas de Firestore, pas de Cloud Functions, pas de Cloud
    Storage, pas de second transport réseau (mode local) en V1. Tout passage à Blaze ou à une API
    payante demande l'accord explicite de cedric.

## 3. Modèle de données

### En place depuis le lot 1 (source de vérité : `database.rules.json`, `engine/`)

```
games/$code
  hostUid, createdAt, quizId, appVersion      // écrits une seule fois, à la création par la box
  state        { phase, seq, total, scores, round, buzzOpen,          // écrit par la box seule
                 index, qid, kind, double, text, choices, durationMs,
                 paused, deadline, remainingMs, correct?, awards? }   // correct et awards seulement après révélation
  log/$seq     { seq, at, type, ... }          // journal, clé sur 6 chiffres, écriture unique (même la box)
  teams/$uid   { name, color, joinedAt }       // une équipe = un uid anonyme de pupitre (8 max, côté appli)
  presence/$uid { online, at }                 // onDisconnect -> online:false
  answers/$qid/$uid { choice, at }             // écriture unique, at = heure serveur, question ouverte et hors pause
  buzz/$round  { team, at }                    // buzzer de test du salon
reports/$id    { kind, text, version, device, at }  // plantages de la box : écriture seule, lus par le workflow « Rapports »
```

- Le moteur (`engine/`, Kotlin pur, testé sans Android) rejoue `log/` pour reconstruire l'état ;
  `state` n'est qu'une projection publique, réécrite dans le **même** `updateChildren` que l'événement.
- Événements : `open`, `pause`, `resume`, `close`, `reveal` (points figés par question : une seconde
  révélation est ignorée), `scores`, `adjust`, `undo`, `end`. Un événement impossible dans l'état
  courant ou déjà vu (même `seq`) est ignoré, jamais une erreur.
- Chrono : `open`/`pause`/`resume`/`close` forment des segments ; le bonus de rapidité se calcule sur
  le temps de chrono restant à l'heure serveur de la réponse, pauses exclues.
- Le quiz (avec les bonnes réponses) est dans l'APK (`tv/src/main/assets/quizzes/`), jamais dans la base.

### Prévu (lots 2 et 4), à figer dans la PR qui l'ajoute

```
games/$code
  pairing/$uid { pin, at }      pairingLock { failures, until }      regie/$uid { pairedAt }
  commands/$cmdId { type, args, expectSeq, by, at }    commandStatus/$cmdId
  devices/$uid "<teamId>"       // réattribution d'un pupitre à une équipe par la régie
  buzz/$windowId/$teamId { pressedAt, receivedAt }
quizzes/$quizId                 // quiz importés : lecture admin + box autorisée
admins/$uid true
```

## 4. Sécurité : règles et appairage de la régie

Chaque règle ajoutée doit avoir son test (section 8). Exemples de motifs (conditions coupées sur
plusieurs lignes pour la lecture ; dans `database.rules.json`, chaque condition est une seule chaîne) :

```json
"events": { "$e": {
  ".write": "!data.exists() && root.child('games').child($code).child('hosts/tv').val() === auth.uid"
}},
"regie": { "$uid": {
  ".write": "root.child('games').child($code).child('hosts/tv').val() === auth.uid"
}},
"pairing": { "$uid": {
  ".write": "auth.uid === $uid && !data.exists()",
  ".validate": "newData.child('pin').isString() && newData.child('pin').val().matches(/^[0-9]{4}$/)"
}},
"answers": { "$q": { "$team": {
  ".write": "!data.exists()
             && root.child('games').child($code).child('devices').child(auth.uid).val() === $team
             && root.child('games').child($code).child('state/qKeyOpen').val() === $q",
  ".validate": "newData.child('choice').isNumber() && newData.child('receivedAt').val() === now"
}}},
"commands": { "$cmd": {
  ".write": "!data.exists()
             && root.child('games').child($code).child('regie').child(auth.uid).exists()",
  ".validate": "newData.child('by').val() === auth.uid && newData.child('expectSeq').isNumber()"
}}
```

**Appairage de la régie (V1, sans serveur payant)** :

1. La TV affiche, sur un écran réservé, un QR code (lien vers la page régie avec le code de partie) et
   un **PIN à 4 chiffres** tiré au hasard pour cette partie. Le PIN n'est jamais écrit dans Firebase :
   il reste en mémoire sur la box (et dans ses `SharedPreferences` pour survivre à un redémarrage).
2. Le téléphone scanne, s'authentifie en anonyme et écrit `pairing/$uid = { pin, at }`.
3. La box compare. PIN correct : elle écrit `regie/$uid` et supprime la demande. PIN faux : elle
   incrémente `pairingLock/failures` ; à 5 échecs, elle ignore toute demande pendant 60 s
   (`pairingLock/until`). La box limite les essais, ce que les règles seules ne savent pas faire.
4. Les règles n'acceptent une commande que d'un `uid` présent dans `regie`. Une régie se retire depuis
   la TV (« Retirer les régies ») ou en changeant de partie. Un nouveau PIN invalide les appareils non
   encore appairés.
5. Deux prestations simultanées = deux parties, deux box, deux PIN : rien n'est partagé.

Autres règles :

- `quizzes` : lecture réservée aux admins et aux box autorisées (mécanisme d'autorisation de la box
  défini avec le lot 2) ; écriture admin uniquement. Un pupitre ne lit jamais une bonne réponse avant `reveals`.
- **Admin** : `root.child('admins').child(auth.uid).exists()` et
  `auth.token.firebase.sign_in_provider === 'google.com'`.
- Jamais de `".read": true` ni de `".write": true`, jamais de sécurité qui repose sur un bouton caché.

## 5. Chrono

- Le moteur enregistre `open`, `pause`, `resume`, `close` avec l'heure serveur estimée par la box
  (`System.currentTimeMillis() + offset`, écart lu sur `.info/serverTimeOffset`).
- `state` publie `deadline` (heure serveur de fin) quand le chrono tourne, `remainingMs` en pause.
- Chaque client affiche `deadline - (Date.now() + offset)` ; les pupitres ne décident rien.
- La fin du temps est **décidée par la TV** : elle écrit `close` 500 ms après `deadline` (réponses de
  la dernière seconde). Les règles refusent toute réponse hors phase `question`, en pause, ou plus de
  2 s après `deadline`. La révélation relit `answers/$qid` après la fermeture confirmée.

## 6. Buzz équitable

1. Le pupitre envoie `pressedAt = Date.now() + offset` (heure d'appui corrigée) et
   `receivedAt = serverTimestamp()`.
2. À la réception du premier buzz d'une fenêtre, la TV attend **300 ms**, puis choisit le plus petit
   `pressedAt` valide : `openedAt ≤ pressedAt ≤ receivedAt` (sinon on retient `receivedAt`).
3. Le résultat est un événement `buzz_won` du moteur ; les autres buzz restent visibles pour
   l'historique.
4. QCM : bonus fusée partagé sous 1 000 ms d'écart (voir le barème), la latence y est neutralisée.

## 7. Connexion, présence, reprise

- **Présence** : chaque appareil écoute `.info/connected` ; à `true`, il pose
  `presence/$uid/onDisconnect().update({online: false, lastSeen: TIMESTAMP})` **puis** écrit
  `online: true`. La régie affiche une pastille par équipe.
- **Pause proposée, jamais automatique** (feuille de route validée le 18/10/2026) : pupitre d'une équipe
  hors ligne pendant une question → la régie affiche l'alerte et propose la pause ; l'animatrice décide.
- **Pupitre qui revient** : relire l'état complet, ne jamais renvoyer une réponse déjà présente,
  réafficher « Réponse enregistrée » si elle existe.
- **Nouvel appareil pour une équipe** : la régie réattribue `devices/$nouveauUid = teamId` ; l'équipe
  garde son nom, sa couleur et ses points.
- **TV** : `keepSynced(true)` sur `games/$code` ; au redémarrage, la reprise existante rouvre la
  partie, puis le moteur rejoue les commandes non notées dans `appliedCmds`.
- **Restauration contrôlée** : « revenir à l'état de 14 h 32 » = événements d'annulation jusqu'au
  `seq` choisi, jamais une suppression.
- Gérer `onCancelled` sans écran d'erreur brutal : message calme et réessai automatique, l'animatrice
  peut continuer en mode manuel.

## 8. Tests obligatoires

- **Règles** : tests avec l'émulateur Firebase (`@firebase/rules-unit-testing`, `firebase emulators:exec`)
  exécutés par GitHub Actions sur chaque PR. Couvrir au minimum : un pupitre ne peut ni modifier un
  score ni écrire un événement ; une équipe ne répond pas deux fois ; un buzz hors fenêtre est refusé ;
  une régie non appairée ne peut pas commander ; une commande au `expectSeq` périmé est rejetée par le
  moteur ; 5 PIN faux bloquent l'appairage 60 s ; un pupitre ne lit pas `quizzes` ; un appareil inconnu
  ne peut pas se faire passer pour une équipe.
- **Moteur** : tests JVM du replay (scores reconstruits depuis `events`, annulations, commande en
  double appliquée une seule fois, pause et reprise du chrono).
- **Pupitres simulés** : Playwright avec 2 à 8 contextes de navigateur (8 équipes max) sur l'émulateur, partie complète et
  coupures réseau provoquées (`context.setOffline(true)`).
- **Chaos sur la Mi Box** (manuel, avant chaque version) : débrancher en pleine question, couper le
  Wi-Fi 10 s, tuer l'appli, changer de tablette d'équipe. La partie doit reprendre à l'identique.
- Le conteneur n'a pas de SDK Android : ne pas lancer Gradle localement, laisser la CI exécuter les
  tests et lire ses journaux.

## 9. Avant de livrer une modification

- [ ] Les 11 invariants de la section 2 tiennent.
- [ ] Toute nouvelle écriture a sa règle et son test de règle.
- [ ] Aucune logique de jeu n'utilise l'heure locale brute.
- [ ] La reprise TV de la PR #3 fonctionne toujours (test de reprise passé).
- [ ] Le comportement hors ligne d'un pupitre et de la TV est décrit dans la PR.
