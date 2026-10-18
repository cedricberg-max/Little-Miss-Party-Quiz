---
name: lmp-game-design-enfants
description: Règles de game design de Little Miss Party Quiz (barème, chronos, profils d'âge, remontée au score, frustration des enfants, fiche de mini-jeu, prestation personnalisée, mode express, création et import de quiz). À lire avant de créer ou modifier une mécanique de jeu, un barème, un chrono, une manche, un mini-jeu, une prestation, le mode express, l’import de quiz ou un texte affiché aux joueurs.
---

# Game design enfants : Little Miss Party Quiz

Ce skill fixe **ce que le jeu fait et pourquoi**. L'apparence et les animations sont dans
`lmp-plateau-tv-motion` ; le stockage, la synchro et la sécurité dans `lmp-firebase-rtdb-fiabilite`.
Source des décisions : la proposition globale validée par cedric le 18/10/2026
(https://claude.ai/code/artifact/ca9908fa-60eb-46c5-af3a-553e5974ad6e).

Public : anniversaires d'enfants de 6 à 15 ans, 2 équipes par défaut (jusqu'à 8, décision du 18/10/2026), une animatrice
non technicienne qui pilote depuis la régie. Langue de l'interface : français uniquement.

## 1. Principes non négociables

1. **Aucun enfant ne doit avoir l'impression que c'est injuste.** Une règle qui dépend de la
   latence réseau, de la vitesse de lecture ou d'un détail incompréhensible est refusée.
2. **Toutes les équipes qui trouvent marquent.** La vitesse ne départage qu'à la marge, sauf dans les
   manches à buzzer où la course est le jeu lui-même.
3. **Jamais de points négatifs avant 12 ans.** Jamais de mécanique qui retire des points au leader.
4. **La remontée est possible, jamais offerte.** L'équipe en tête garde l'avantage si elle joue
   aussi bien en finale.
5. **L'animatrice a toujours le dernier mot.** Toute attribution automatique peut être corrigée ou
   annulée depuis la régie, et chaque mini-jeu a un mode de validation manuelle.
6. **Une règle s'explique en une phrase** que l'animatrice lit sur la régie. Sinon elle est trop
   compliquée.

## 2. Profils d'âge

Toute valeur qui dépend de l'âge vient du profil de la prestation, jamais d'une constante en dur dans
un écran. Le profil est une donnée de contenu (choisie dans l'admin), pas une option de compilation.

| Profil | Âges | Chrono QCM après lecture | Bonus fusée | Négatifs | Texte max d'une question | Lecture |
| --- | --- | --- | --- | --- | --- | --- |
| `PETITS` | 6 à 8 | 25 s | non | non | 15 mots, propositions de 1 à 3 mots | l'animatrice lit tout |
| `MOYENS` | 9 à 11 | 15 s | oui | non | 20 mots | l'animatrice lit la question |
| `GRANDS` | 12 à 15 | 12 s | oui | option en buzzer | 25 mots | lecture libre |
| `ADULTES` | 16+ | 10 s | oui | option | 30 mots | lecture libre |

Le chrono **démarre après la lecture** : question affichée, l'animatrice lit, propositions révélées,
puis départ du chrono (bouton « Lancer le chrono » ou délai automatique réglable). Il s'arrête dès
que toutes les équipes connectées ont répondu.

## 3. Barème de référence

Toutes ces valeurs vivent dans **un seul fichier** (cible : `tv/src/main/java/com/littlemissparty/quiz/tv/engine/Bareme.kt`)
et sont consommées par des fonctions pures testées. Ne jamais recopier un nombre dans un écran.

| Situation | Points |
| --- | --- |
| QCM, bonne réponse (chaque équipe) | 100 |
| QCM, bonus fusée (première équipe correcte) | +20 ; partagé si les équipes correctes ont répondu à moins de 1 000 ms d'écart |
| QCM, mauvaise réponse ou pas de réponse | 0 |
| Buzzer, bonne réponse | 150 |
| Buzzer, mauvaise réponse | 0 (option −50 seulement en `GRANDS`/`ADULTES`), l'équipe est bloquée sur la question |
| Buzzer, rebond (les autres équipes peuvent buzzer après une erreur) | 100 |
| Blind test buzzer | 150 si buzz dans les 10 premières secondes, 100 ensuite, +50 bonus artiste ou œuvre |
| Blind test buzzer, après un indice donné par l'animatrice | 100 au plus (+50 bonus inchangé) |
| Quiz musical à 4 propositions (`qcm-audio`, tous âges, conseillé pour les Petits) | comme un QCM : 100 + bonus fusée |
| Mini-jeu, vainqueur | 300 |
| Mini-jeu, chaque autre équipe ayant joué | 150 |
| Mimes, chaque mime trouvé (choix de cedric, 18/10/2026) | 50 ; « −1 » de la régie retire un mime, jamais sous 0 |
| Le Juste Chiffre, équipe la plus proche (toutes les équipes à égalité) | 100 ; pile le bon nombre : 150 ; ×2 en Super Finale ; pas de bonus fusée (`engine/Scoring.kt` : `awardNumber`, `NUMBER_CLOSEST`, `NUMBER_EXACT`) |
| Super Finale | multiplicateur ×2 sur tout (200 + bonus 40) |
| Joker « Double » | ×2 sur une question choisie, une fois par équipe, manches 1 et 2 uniquement |

Règles associées :

- La réponse QCM est **verrouillée** dès l'envoi. Pas de changement d'avis.
- Le « temps de réponse » utilisé pour le bonus est l'heure d'appui corrigée par l'écart d'horloge
  serveur (voir `lmp-firebase-rtdb-fiabilite`), jamais l'heure d'arrivée.
- Les points sont **acquis à chaque question** (un événement par attribution). Quitter un jeu ne perd
  rien ; rejouer une question annule uniquement ses propres événements.

### Quiz musical (validé le 18/10/2026)

Deux modes dans le même moteur, extraits toujours joués sur la TV depuis le cache :

- **Blind test classique (`blindtest`)** : extrait sur la TV → une équipe buzze → la musique se coupe →
  réponse à voix haute → l'animatrice **valide ou refuse** depuis la régie. Refus : l'équipe est bloquée
  sur ce titre, l'extrait reprend là où il s'était arrêté et les autres équipes peuvent buzzer (rebond).
  Commandes de régie : reprendre l'extrait, donner un indice (affiché sur la TV), attribuer ou retirer
  des points. Révélation : titre, artiste, pochette.
- **Quiz musical à 4 propositions (`qcm-audio`)** : extrait sur la TV, 4 propositions sur chaque
  pupitre, toutes les équipes répondent, révélation et points du QCM.
- Bibliothèque classée par artiste, titre, thème, âge (de / à) et difficulté (1 à 3). Sarah importe un
  fichier audio ordinaire, choisit un passage de 15 à 30 s, ajoute pochette et métadonnées.
- **Droits (décision du 18/10/2026)** : statut des droits facultatif, affiché en avertissement, jamais
  bloquant (voir `lmp-firebase-rtdb-fiabilite`, section 4 bis). Les autorisations sont traitées à part.

### Mode de secours sans Internet

Les pupitres ne marchent pas sans Internet. La box continue depuis son cache, pilotée à la
télécommande : les équipes montrent des **cartes-réponses imprimées aux formes A à D** (triangle,
losange, rond, carré, comme à l'écran), ou répondent à voix haute au blind test ; l'animatrice saisit
les points. Le barème reste le même, sans bonus fusée (pas d'heure d'appui mesurable).

## 4. Remontée et suspense

- **Super Finale** : 4 questions à ×2. **Black-out** : scores masqués pendant la finale, révélés à la
  fin.
- **Joker Double** : décision d'équipe, annoncé sur la TV avant la question.
- **Contrôle d'équilibre** : pour tout nouveau barème, vérifier par un test que l'équipe menée de 250
  points après les manches 1 et 2 peut gagner en faisant mieux en finale, et que l'équipe en tête gagne
  si elle fait aussi bien. L'exemple de référence (à garder comme test unitaire) :

| Étape | Licornes | Dragons |
| --- | --- | --- |
| Manche 1 (8 QCM) | 7 bonnes, 5 bonus = 800 | 5 bonnes, 2 bonus = 540 |
| Mime | +300 → 1 100 | +150 → 690 |
| Pictionary | +150 → 1 250 | +300 → 990 |
| Super Finale | 3 bonnes, 1 bonus = +640 → 1 890 | 4 bonnes, 3 bonus = +920 → **1 910** |

- **Interdits** : rattrapage qui retire des points au leader, points « au hasard » non annoncés,
  multiplicateurs annoncés après coup.
- **Équilibrage discret** (optionnel, plus tard) : si l'écart dépasse 3 bonnes réponses en manche 1,
  la régie *propose* à l'animatrice des questions plus faciles. Jamais automatique, jamais visible.

## 5. Rythme d'une prestation

- Manche QCM : **8 questions** (10 maximum).
- Au-delà de 4 équipes, préférer les QCM et Vrai ou Faux (toutes les équipes jouent en même temps)
  aux jeux à tour de rôle, qui font attendre trop longtemps.
- Une prestation type de 60 min : quiz 8, deux mini-jeux, blind test 8, Super Finale 4.
- Introduction de manche ≤ 4 s, passable par l'animatrice.
- Aucun temps mort de plus de 10 s sans quelque chose qui bouge ou qui parle sur la TV.
- **Prestation personnalisée** : prénom de l'enfant fêté (accueil, générique, victoire), âge et profil,
  thèmes, durée, équipes (nom, couleur, emblème), manches dans l'ordre. Préparée sur le PC et choisie
  sur la régie : aucune ressaisie le jour J.

### Mode anniversaire express (validé le 18/10/2026, reportable si le calendrier l'exige)

L'animatrice saisit un prénom et un âge (thème et durée facultatifs). Une **fonction pure**, testée,
compose le programme sans IA : elle part du programme type de la durée (60 min : quiz 8, deux
mini-jeux, blind test 8, Super Finale 4), remplit chaque case avec des contenus validés de la
bibliothèque dont la tranche d'âge contient l'âge, la difficulté adaptée au profil, le thème demandé
en priorité, en écartant les contenus joués récemment. Si une case ne trouve rien, elle reste vide et
la régie le dit (jamais de contenu hors âge). L'animatrice accepte, remplace ou réordonne, puis démarre.
Le résultat est une prestation ordinaire (`origin: 'express'`).

### Création des quiz

Trois entrées, une seule relecture : import tableur, **collage d'un texte Gemini** produit avec la
consigne fournie par l'administration (V1), génération Gemini intégrée (après le 2 décembre, API soumise
à l'accord de cedric). L'analyse convertit, signale les anomalies (bonne réponse absente ou double,
propositions identiques, texte trop long pour le profil, doublon), prévisualise TV et pupitre ; Sarah
valide chaque question. Aucune IA n'intervient pendant une prestation.

## 6. Feedback et frustration

- Mauvaise réponse : la proposition choisie passe en **gris**, jamais de rouge clignotant ni de son
  moqueur.
- Scores montrés **entre les questions**, sous forme de barres ; le message de l'équipe menée est
  positif et concret : « Encore 3 bonnes réponses pour rattraper les Licornes ! ».
- Chaque équipe qui marque a sa petite célébration, même si elle reste derrière.
- Fin de partie : vainqueur, puis **trophées secondaires** (« Équipe la plus rapide », « Meilleurs
  mimes », « Esprit d'équipe » choisi par l'animatrice).
- Textes aux joueurs : phrases courtes, vocabulaire d'enfant français, « vous » pour une équipe
  (« Bravo les Dragons ! »), pas d'anglicismes, pas d'ironie.

## 7. Fiche obligatoire d'un nouveau mini-jeu

Avant toute implémentation, remplir et faire valider cette fiche :

```
Nom :
Règle en une phrase (lue par l'animatrice) :
Profils d'âge concernés :
Interactions : TV / pupitre / régie / oral
Points : (en réutilisant le barème de la section 3)
Durée : (cible ≤ 5 min)
Dépend de la vitesse réseau ? (si oui : seuil d'égalité ou arbitrage obligatoire)
Validation : automatique / animatrice ; comment l'animatrice corrige
Mode manuel si les pupitres tombent :
Incidents prévus : équipe déconnectée, pause, rejouer
Contenu nécessaire et qui le prépare :
```

Refuser ou simplifier un jeu qui : demande de taper du texte aux `PETITS`, dépend d'une vitesse de
quelques centaines de millisecondes, dure plus de 6 min, ou n'a pas de mode manuel.

Jeux validés et leur version : Vrai ou Faux express, Mime, Zoom mystère (coupé en premier si le lot 4
déborde), Le Juste Chiffre, Statues musicales (V1) ; Pictionary (retiré de la V1 le 18/10/2026),
Bruitages, Qui a disparu (V1.5) ; Remets dans l'ordre,
Course à la tape, Memory géant, Le Duel (V2).

## 8. Où vit le code

- Logique de jeu = **fonctions pures Kotlin** sans dépendance Android ni Firebase (cible : package
  `engine`), du type `fun scoreQcm(question, reponses, profil): List<EvenementPoints>`.
- Chaque règle de ce skill a son test unitaire JVM, exécuté par GitHub Actions (pas de SDK Android
  dans le conteneur : on ne lance pas Gradle localement).
- Un changement de barème = un changement de `Bareme.kt` + ses tests + une ligne dans ce skill.
