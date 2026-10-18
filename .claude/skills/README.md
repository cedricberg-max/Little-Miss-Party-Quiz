# Skills du projet Little Miss Party Quiz

Ces skills sont chargés automatiquement par Claude Code dans toute session ouverte sur ce dépôt.
Ils se modifient par PR, comme le code.

| Skill | Origine | Rôle |
| --- | --- | --- |
| `lmp-game-design-enfants` | Projet | Barème, chronos, profils d'âge, frustration, fiche de mini-jeu |
| `lmp-plateau-tv-motion` | Projet | Direction artistique fluo, écrans, animations, sons, performances Mi Box |
| `lmp-firebase-rtdb-fiabilite` | Projet | Données, règles de sécurité, synchro, reprise, buzz équitable, régie |
| `testing-setup` | Google, [android/skills](https://github.com/android/skills) | Mise en place des tests Android |
| `jetpack-compose-performance` | Google, [android/skills](https://github.com/android/skills) | Audit de performance Compose |

Les deux skills Google sont copiés sans modification depuis le commit
`5bda39f154fb859a08d45e2392f3568e049f83fb` (14/10/2026) d'android/skills, sous licence Apache 2.0
(`LICENSE.txt` dans chaque dossier). Ils ne contiennent que du texte : aucun script, aucun hook,
aucun serveur MCP. Pour les mettre à jour, recopier les dossiers depuis une nouvelle version
relue et changer le commit ci-dessus.

Une information ne vit que dans un seul skill projet : les points dans `lmp-game-design-enfants`,
l'apparence et les durées d'animation dans `lmp-plateau-tv-motion`, les données et la sécurité dans
`lmp-firebase-rtdb-fiabilite`. Quand le code fige un choix différent, mettre le skill à jour dans la
même PR.
