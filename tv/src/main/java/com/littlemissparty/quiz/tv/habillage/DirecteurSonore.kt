package com.littlemissparty.quiz.tv.habillage

/**
 * Chef d'orchestre de l'habillage sonore : regarde l'écran affiché et décide quels sons jouer, et quand.
 * Kotlin pur, sans Android : il se teste sur la JVM et ne touche jamais à la partie elle-même.
 *
 * On lui montre un [Instant] à chaque changement d'écran. Il le compare au précédent et rend des [Ordre]
 * que le moteur ([Sons]) exécute. Un même instant montré deux fois ne rejoue rien ; une box qui se
 * reconnecte en pleine partie reprend la musique de l'écran, sans relancer le générique.
 */
class DirecteurSonore {

    private var avant: Instant? = null
    /** Écran au moment où la pause a commencé, pour savoir à la reprise s'il a changé entre-temps. */
    private var avantPause: Instant? = null
    /** Parties dont le générique a déjà été joué (une seule fois par partie, même après une reconnexion). */
    private val generiques = mutableSetOf<String>()
    /** Dernière épreuve vue (partie, épreuve) : quand elle change, le jingle de transition annonce le nouveau jeu. */
    private var epreuve: Pair<String, String>? = null

    fun observer(maintenant: Instant): List<Ordre> {
        val p = avant
        avant = maintenant
        val precedente = epreuve
        if (maintenant.epreuve.isNotEmpty()) epreuve = maintenant.partie to maintenant.epreuve
        nouvelleEpreuve = maintenant.epreuve.isNotEmpty() && precedente != null &&
            precedente.first == maintenant.partie && precedente.second != maintenant.epreuve
        if (p == null) return premiereFois(maintenant)
        if (maintenant.ecran == Ecran.HORS_PARTIE) {
            return if (p.ecran == Ecran.HORS_PARTIE) emptyList() else listOf(Ordre.Couper, Ordre.Musique(Ambiance.SILENCE))
        }
        if (p.ecran == Ecran.HORS_PARTIE) return premiereFois(maintenant)

        // Pause : on coupe tout ce qui était prévu ; un carillon ouvre l'intermède, puis sa musique feutrée.
        if (!p.enPause && maintenant.enPause) {
            avantPause = p
            transitionEnAttente = false
            return listOf(Ordre.Couper, Ordre.Jouer(Son.PAUSE), Ordre.Musique(Ambiance.SILENCE), Ordre.Musique(Ambiance.INTERMEDE, Tempo.PAUSE_MUSIQUE))
        }
        if (maintenant.enPause) {
            if (nouvelleEpreuve) transitionEnAttente = true
            return emptyList()
        }
        if (p.enPause) {
            val ecranAvant = avantPause ?: p
            avantPause = null
            if (transitionEnAttente) nouvelleEpreuve = true
            transitionEnAttente = false
            return reprise(ecranAvant, maintenant)
        }

        // Intro du lancement (Game Show) : silence pendant la vidéo, qui a sa musique. À sa fin, l'écran du moment entre
        // (la présentation du 1er jeu) ; coupée parce que Sarah a lancé l'épreuve, la question entre comme d'habitude.
        if (maintenant.lancement) return if (p.lancement) emptyList() else listOf(Ordre.Couper, Ordre.Musique(Ambiance.SILENCE))
        if (p.lancement) return entree(if (changeDEcran(p, maintenant)) p else p.copy(ecran = Ecran.SALON), maintenant)

        if (changeDEcran(p, maintenant)) return entree(p, maintenant)
        return memeEcran(p, maintenant)
    }

    /** Vrai pendant l'instant observé : on vient de passer à une autre épreuve de la même partie. */
    private var nouvelleEpreuve = false
    /** Une épreuve a changé pendant la pause : la transition sera jouée après le décompte. */
    private var transitionEnAttente = false

    private fun changeDEcran(a: Instant, b: Instant) = a.ecran != b.ecran || a.index != b.index || a.partie != b.partie

    /** Box qui démarre ou se reconnecte : seulement le générique d'une partie pas encore commencée, sinon la musique. */
    private fun premiereFois(i: Instant): List<Ordre> {
        if (i.ecran == Ecran.HORS_PARTIE) return listOf(Ordre.Musique(Ambiance.SILENCE))
        if (i.enPause) return listOf(Ordre.Musique(Ambiance.INTERMEDE))
        if (i.ecran == Ecran.SALON && i.index < 0 && generiques.add(i.partie)) return generique(i.gameShow)
        // Game Show : une box qui revient sur le podium le rejoue en entier, comme l'écran.
        if (i.ecran == Ecran.FIN && i.gameShow) return entree(i, i)
        return listOf(Ordre.Musique(ambiance(i)))
    }

    /**
     * Générique puis musique du salon, sans blanc : la boucle repart de sa première mesure sur le temps fort qui
     * suit la dernière note du générique, presque aussi fort, puis redescend doucement à son volume de fond.
     */
    private fun generique(gameShow: Boolean) = if (gameShow) accueilGameShow() else listOf(
        Ordre.Couper,
        Ordre.Musique(Ambiance.SILENCE),
        Ordre.Jouer(Son.GENERIQUE),
        Ordre.Caler(Tempo.GENERIQUE_RELAIS),
        Ordre.Musique(Ambiance.SALON_ARRIVEE, Tempo.GENERIQUE_RELAIS, Tempo.FONDU_RELAIS),
        Ordre.Musique(Ambiance.SALON, Tempo.GENERIQUE_FIN, Tempo.FONDU_DESCENTE),
    )

    /**
     * Game Show : pas de générique. L'accueil, c'est la boucle du début de Get Lucky (cedric, 23 octobre : « l'ouverture,
     * c'est Get Lucky »), sans fin tant que la fête n'est pas lancée ; la régie qui se connecte n'y change rien.
     */
    private fun accueilGameShow() = listOf(Ordre.Couper, Ordre.Musique(Ambiance.SALON))

    /** Décompte 3, 2, 1 de la reprise, puis la musique (ou l'entrée de l'écran s'il a changé pendant la pause). */
    private fun reprise(ecranAvant: Instant, i: Instant): List<Ordre> {
        val dans = i.repriseDansMs.coerceAtLeast(0)
        val n = ((dans + 999) / 1000).toInt().coerceAtMost(5)
        // Le carillon et la musique de l'intermède s'arrêtent ; la suite est calée sur le décompte.
        val ordres = mutableListOf<Ordre>(Ordre.Couper)
        for (k in 0 until n) ordres += Ordre.Jouer(Son.pop(k), (dans - (n - k) * 1000L).coerceAtLeast(0))
        ordres += Ordre.Jouer(Son.WHOOSH, dans)
        ordres += if (changeDEcran(ecranAvant, i)) {
            entree(ecranAvant, i).filter { it != Ordre.Couper }.map { it.decale(dans) }
        } else {
            listOf(Ordre.Musique(ambiance(i), dans))
        }
        return ordres
    }

    private fun entree(p: Instant, i: Instant): List<Ordre> {
        val o = mutableListOf<Ordre>(Ordre.Couper)
        when (i.ecran) {
            Ecran.HORS_PARTIE -> o += Ordre.Musique(Ambiance.SILENCE)
            Ecran.SALON -> if (i.index < 0 && generiques.add(i.partie)) return generique(i.gameShow) else {
                o += Ordre.Jouer(Son.WHOOSH)
                o += Ordre.Musique(Ambiance.SALON)
            }
            // Game Show, Duel des robots : le début de l'air western une fois, puis sa boucle repart de sa première
            // mesure juste derrière, sans blanc (sous la vidéo d'intro du duel).
            Ecran.PRESENTATION -> if (i.duel && i.gameShow) {
                o += Ordre.Jouer(Son.DUEL_INTRO)
                o += Ordre.Musique(Ambiance.SILENCE)
                o += Ordre.Musique(Ambiance.DUEL_PRESENTATION, Tempo.DUEL_INTRO_BOUCLE, Tempo.FONDU_RELAIS)
                o += Ordre.Caler(Tempo.DUEL_INTRO_BOUCLE)
            } else if (nouvelleEpreuve) {
                // Présentation d'un jeu : le jingle du rideau, puis une musique douce sous la voix de Sarah.
                o += Ordre.Jouer(Son.TRANSITION)
                o += Ordre.Musique(Ambiance.SILENCE)
                o += Ordre.Musique(ambiance(i), Tempo.TRANSITION_MUSIQUE)
            } else {
                o += Ordre.Jouer(Son.WHOOSH)
                o += Ordre.Musique(ambiance(i))
            }
            Ecran.QUESTION -> {
                // Le Vrai ou Faux express garde sa musique nerveuse d'un bout à l'autre de la série.
                val musique = ambiance(i)
                if (p.ecran == Ecran.PRESENTATION && !i.musical) {
                    // Sarah lance le jeu présenté : le jingle d'ouverture de manche, puis la musique du jeu.
                    o += Ordre.Jouer(Son.MANCHE)
                    o += Ordre.Jouer(Son.IMPACT)
                    o += Ordre.Musique(Ambiance.SILENCE)
                    o += Ordre.Musique(musique, Tempo.QUESTION_MUSIQUE_APRES_MANCHE)
                } else if (i.musical) {
                    // La chanson part dès l'ouverture : aucun jingle par-dessus (le rideau, lui, passe quand même).
                    o += Ordre.Musique(Ambiance.SILENCE)
                    // Blind test : son générique court à la présentation, un éclat de cuivres au passage en points doublés.
                    if (i.blindPresentation) o += Ordre.Jouer(Son.BT_GENERIQUE)
                    // Game Show : la musique d'attente sous « Lancer le morceau », après le générique s'il passe.
                    if (musique == Ambiance.BT_ATTENTE) o += Ordre.Musique(musique, if (i.blindPresentation) Tempo.BT_ATTENTE_APRES_GENERIQUE else 0L)
                    if (i.blind && i.blindDouble && !p.blindDouble) o += Ordre.Jouer(Son.BT_DOUBLE)
                } else if (nouvelleEpreuve) {
                    o += Ordre.Jouer(Son.TRANSITION)
                    o += Ordre.Musique(Ambiance.SILENCE)
                    o += Ordre.Musique(musique, Tempo.TRANSITION_MUSIQUE)
                } else if (i.superFinale && !p.superFinale) {
                    // Les dernières questions du quiz passent à points ×2 : un éclat « points doublés », une seule fois.
                    // Ce n'est pas un nouveau jeu : ni rideau ni jingle de manche. Game Show : un impact, pas les cuivres
                    // du Classique, qui faisaient deux musiques à la fois sur Daft Punk (cedric, 25/10 au soir).
                    o += Ordre.Jouer(if (i.gameShow) Son.IMPACT else Son.BT_DOUBLE)
                    // Game Show : la musique de la manche ne s'arrête pas, la nappe de tension la rejoint (cedric, 23/10).
                    if (!i.gameShow) {
                        o += Ordre.Musique(Ambiance.SILENCE)
                        o += Ordre.Musique(musique, Tempo.QUESTION_MUSIQUE_APRES_MANCHE)
                    } else o += Ordre.Musique(musique)
                } else if (i.premiere) {
                    o += Ordre.Jouer(Son.MANCHE)
                    o += Ordre.Jouer(Son.IMPACT)
                    o += Ordre.Musique(Ambiance.SILENCE)
                    o += Ordre.Musique(musique, Tempo.QUESTION_MUSIQUE_APRES_MANCHE)
                } else {
                    o += Ordre.Jouer(Son.WHOOSH)
                    o += Ordre.Musique(musique)
                }
                // Zoom mystère : moteur d'objectif et déclic quand la photo apparaît.
                if (i.zoom) o += Ordre.Jouer(Son.ZOOM_OUVERTURE, Tempo.PROPOSITIONS_DEBUT)
                // Image floue et Zoom mystère : une longue montée accompagne la photo qui se précise (ou se dézoome).
                // Elle dure tout le chrono (cedric, 25/10 : à l'Image floue, 30 s de montée pour 40 s de chrono).
                if (i.flou || i.zoom) o += Ordre.Jouer(Son.FLOU_MONTEE, Tempo.PROPOSITIONS_DEBUT, etireSurMs = (i.chronoMs - Tempo.PROPOSITIONS_DEBUT).coerceAtLeast(0))
                // Extrait musical (blind test, quiz musical) : le diamant se pose sur le disque quand la chanson part.
                // Blind test : seulement quand la chanson part vraiment (pas pendant la présentation).
                if (i.musical && (!i.blind || i.blindLecture)) o += Ordre.Jouer(Son.BT_DIAMANT)
                // Une bulle par proposition affichée ; les jeux au buzzer n'en affichent aucune.
                val bulles = if (i.jeuBuzz || i.blind) 0 else i.propositions.coerceIn(0, 8)
                for (k in 0 until bulles) {
                    o += Ordre.Jouer(Son.pop(k), Tempo.propositionApparait(k))
                }
            }
            Ecran.MIMES -> if (p.ecran == Ecran.MIMES_TOUR && i.pictionary) {
                // Fin d'un dessin : « Trouvé ! » et applaudissements (sauf s'il a déjà sonné pendant le tour),
                // sinon le sifflet de fin.
                val trouve = i.pictioTrouve || p.trouves > 0
                if (!trouve) o += Ordre.Jouer(Son.MIME_FIN)
                else if (p.trouves == 0) o += Ordre.Jouer(Son.PICTIO_TROUVE)
                o += Ordre.Musique(Ambiance.SILENCE)
                if (trouve) o += Ordre.Jouer(Son.APPLAUDISSEMENTS, Tempo.MIME_BILAN)
                o += Ordre.Musique(Ambiance.MIMES_ENTRE, Tempo.MIME_BILAN_MUSIQUE)
            } else if (p.ecran == Ecran.MIMES_TOUR) {
                // Fin d'un tour : coup de sifflet et « ta-daa », applaudissements si l'équipe a trouvé.
                o += Ordre.Jouer(Son.MIME_FIN)
                o += Ordre.Musique(Ambiance.SILENCE)
                if (p.trouves > 0) o += Ordre.Jouer(Son.APPLAUDISSEMENTS, Tempo.MIME_BILAN)
                o += Ordre.Musique(Ambiance.MIMES_ENTRE, Tempo.MIME_BILAN_MUSIQUE)
            } else if (nouvelleEpreuve) {
                // On arrive d'un autre jeu : jingle de transition, puis la musique des mimes.
                o += Ordre.Jouer(Son.TRANSITION)
                o += Ordre.Musique(Ambiance.SILENCE)
                o += Ordre.Musique(Ambiance.MIMES_ENTRE, Tempo.TRANSITION_MUSIQUE)
            } else {
                // Ouverture de la manche.
                o += Ordre.Jouer(Son.MANCHE)
                o += Ordre.Jouer(Son.IMPACT)
                o += Ordre.Musique(Ambiance.SILENCE)
                o += Ordre.Musique(Ambiance.MIMES_ENTRE, Tempo.QUESTION_MUSIQUE_APRES_MANCHE)
            }
            Ecran.MIMES_TOUR -> {
                o += Ordre.Jouer(if (i.pictionary) Son.PICTIO_TOP else Son.MIME_TOP)
                o += Ordre.Musique(Ambiance.SILENCE)
                o += Ordre.Musique(Ambiance.MIMES, Tempo.MIME_TOP_IMPACT)
            }
            Ecran.VERROUILLEE -> {
                o += Ordre.Jouer(Son.VERROU)
                // Chrono à zéro alors qu'une équipe n'a pas répondu : le signal « temps écoulé » sous le tampon.
                if (i.tempsEcoule) o += Ordre.Jouer(Son.MIME_FIN)
                if (!i.express) o += Ordre.Musique(Ambiance.SUSPENSE)
            }
            Ecran.REVELATION -> if (i.nombre) {
                // Le Juste Chiffre : les chiffres défilent et se posent sur l'or ; fanfare si une équipe tombe pile.
                o += Ordre.Musique(Ambiance.SILENCE)
                o += Ordre.Jouer(Son.CHIFFRE_ROULETTE)
                o += Ordre.Jouer(if (i.pile) Son.CHIFFRE_PILE else Son.BONNE_REPONSE, Tempo.REVELATION_OR)
                o += Ordre.Jouer(Son.IMPACT, Tempo.REVELATION_OR)
                o += Ordre.Musique(Ambiance.FETE, Tempo.REVELATION_OR)
                // Game Show : les points attendent la règle des écarts (révélation « A puis B » du 28/10).
                val retard = if (i.gameShow) Tempo.JUSTE_GS_RETARD else 0L
                for (k in 0 until i.gagnants.coerceIn(0, 8)) o += Ordre.Jouer(Son.TAMPON, Tempo.tampon(k) + retard)
                if (i.gagnants > 0) o += Ordre.Jouer(Son.POINTS, Tempo.REVELATION_POINTS + retard)
            } else if (i.blind) {
                // Blind test : rembobinage et fanfare quand une équipe a trouvé, simple carillon sinon (jamais moqueur).
                o += Ordre.Musique(Ambiance.SILENCE)
                o += Ordre.Jouer(if (i.gagnants > 0) Son.BT_BRAVO else Son.BONNE_REPONSE)
                for (k in 0 until i.gagnants.coerceIn(0, 8)) o += Ordre.Jouer(Son.TAMPON, Tempo.tampon(k))
                if (i.gagnants > 0) o += Ordre.Jouer(Son.POINTS, Tempo.REVELATION_POINTS)
            } else if (i.jeuBuzz) {
                // Jeux au buzzer : la réponse s'affiche tout de suite, sans roulement.
                o += Ordre.Musique(Ambiance.SILENCE)
                when {
                    // Image floue : la photo s'ouvre nette (mise au point, déclic, « tadaa »).
                    i.flou -> o += Ordre.Jouer(Son.ZOOM_REVELE)
                    else -> {
                        o += Ordre.Jouer(Son.BONNE_REPONSE)
                        o += Ordre.Jouer(Son.IMPACT)
                    }
                }
                // Chante le mot : on applaudit la chanson.
                if (i.chante && i.gagnants > 0) o += Ordre.Jouer(Son.APPLAUDISSEMENTS, Tempo.BUZZ_BRAVO)
                // Blind test : la chanson repart en grand pendant qu'on découvre le titre, rien par-dessus.
                if (!i.musical) o += Ordre.Musique(Ambiance.FETE, Tempo.BUZZ_BRAVO)
                for (k in 0 until i.gagnants.coerceIn(0, 8)) o += Ordre.Jouer(Son.TAMPON, Tempo.tampon(k))
                if (i.gagnants > 0) o += Ordre.Jouer(Son.POINTS, Tempo.REVELATION_POINTS)
            } else if (i.express) {
                // Vrai ou Faux express : pas de roulement, le verdict tombe tout de suite et la musique continue.
                o += Ordre.Jouer(if (i.reponseVraie) Son.VF_VRAI else Son.VF_FAUX, Tempo.revelationOr(express = true))
                for (k in 0 until i.gagnants.coerceIn(0, 8)) o += Ordre.Jouer(Son.TAMPON, Tempo.tampon(k, express = true))
                if (i.gagnants > 0) o += Ordre.Jouer(Son.POINTS, Tempo.EXPRESS_POINTS)
            } else {
                o += Ordre.Musique(Ambiance.SILENCE)
                // Zoom mystère : la photo s'ouvre en grand (mise au point, déclic, « tadaa ») à la place du roulement.
                o += Ordre.Jouer(if (i.zoom) Son.ZOOM_REVELE else Son.ROULEMENT_COURT)
                for (k in 0 until (i.propositions - 1).coerceIn(0, 3)) {
                    o += Ordre.Jouer(Son.ETEINT, Tempo.mauvaiseSEteint(k))
                }
                o += Ordre.Jouer(Son.BONNE_REPONSE, Tempo.REVELATION_OR)
                o += Ordre.Jouer(Son.IMPACT, Tempo.REVELATION_OR)
                if (!i.musical) o += Ordre.Musique(Ambiance.FETE, Tempo.REVELATION_OR)
                for (k in 0 until i.gagnants.coerceIn(0, 8)) {
                    o += Ordre.Jouer(Son.TAMPON, Tempo.tampon(k))
                }
                if (i.gagnants > 0) o += Ordre.Jouer(Son.POINTS, Tempo.REVELATION_POINTS)
            }
            Ecran.CLASSEMENT -> if (i.blindBilan) {
                // Fin du blind test : le riff du générique ralenti, puis le classement et la fête.
                o += Ordre.Musique(Ambiance.SILENCE)
                o += Ordre.Jouer(Son.BT_OUTRO)
                o += Ordre.Jouer(Son.COMPTEUR, Tempo.CLASSEMENT_COMPTEUR)
                if (i.meneurAPoints) o += Ordre.Jouer(Son.COURONNE, Tempo.CLASSEMENT_COURONNE)
                o += Ordre.Musique(Ambiance.BILAN, Tempo.BT_OUTRO_MUSIQUE)
            } else {
                o += Ordre.Jouer(Son.WHOOSH)
                // Game Show : le riff d'Aerodynamic seul. Le compteur et la couronne du Classique sont des sons musicaux
                // qui faisaient deux musiques à la fois (cedric, 25/10 au soir, classement en cours de Quiz).
                if (!i.gameShow) {
                    o += Ordre.Jouer(Son.COMPTEUR, Tempo.CLASSEMENT_COMPTEUR)
                    if (i.meneurAPoints) o += Ordre.Jouer(Son.COURONNE, Tempo.CLASSEMENT_COURONNE)
                }
                o += Ordre.Musique(Ambiance.BILAN)
            }
            Ecran.FIN -> if (i.gameShow) {
                // Game Show : le podium sur Digital Love (cedric, 23 octobre). La chanson part sur « why don't you
                // play the game » pendant que les jauges montent, roulement de tambour par-dessus ; le solo de guitare
                // tombe sur le nom du gagnant (Tempo.PODIUM_REVELATION) ; à la fin de la chanson, l'écran de fin et le
                // dernier groove d'Aerodynamic. Juste avant la note grave de 4:07, gs_podium s'arrête et la boucle d'attente
                // enchaîne pile à sa coupe (écho, boucle sans guitare) jusqu'à « ▶ Lancer la fin » (cedric, 29/10).
                // Box qui revient alors que la fin est déjà lancée : la musique de la fin, sans rejouer le podium.
                if (i.finLancee) return listOf(Ordre.Couper, Ordre.Musique(if (i.outro) Ambiance.SILENCE else Ambiance.AU_REVOIR))
                o += Ordre.Musique(Ambiance.SILENCE)
                o += Ordre.Jouer(Son.PODIUM)
                o += Ordre.Enchainer(Son.PODIUM, Tempo.PODIUM_COUPE, Ambiance.PODIUM_ATTENTE)
            } else {
                o += Ordre.Musique(Ambiance.SILENCE)
                // Grand gagnant : long roulement qui monte pendant tout le suspense, la montée arrive sur la fin.
                o += Ordre.Jouer(Son.ROULEMENT_FINAL)
                o += Ordre.Jouer(Son.MONTEE, Tempo.FIN_VAINQUEUR - 2_000)
                o += Ordre.Jouer(Son.IMPACT, Tempo.FIN_VAINQUEUR)
                o += Ordre.Jouer(Son.FANFARE, Tempo.FIN_VAINQUEUR)
                o += Ordre.Jouer(Son.APPLAUDISSEMENTS, Tempo.FIN_VAINQUEUR)
                o += Ordre.Jouer(Son.CLOCHES, Tempo.FIN_VAINQUEUR + 1_500)
                o += Ordre.Jouer(Son.FIN, Tempo.FIN_JINGLE)
                o += Ordre.Musique(Ambiance.FETE, Tempo.FIN_MUSIQUE)
            }
        }
        return o
    }

    private fun memeEcran(p: Instant, i: Instant): List<Ordre> {
        val o = mutableListOf<Ordre>()
        // « ▶ Lancer la fin » sur le podium du Game Show : le podium (ou sa boucle d'attente) s'éteint en fondu sous
        // l'arrivée de l'outro ; sans la vidéo de l'outro, l'écran de fin et le groove d'Aerodynamic.
        if (i.ecran == Ecran.FIN && i.gameShow && i.finLancee && !p.finLancee) {
            o += Ordre.Couper
            o += Ordre.Musique(Ambiance.SILENCE, fonduMs = Tempo.FONDU_LANCER_FIN)
            if (!i.outro) o += Ordre.Musique(Ambiance.AU_REVOIR, fonduMs = Tempo.FONDU_AU_REVOIR)
            return o
        }
        if (i.equipes > p.equipes) o += Ordre.Jouer(Son.equipe(i.equipes - 1))
        // Buzzer de l'accueil, pour s'amuser : chaque appui fait le bruit rigolo de l'équipe, autant de fois qu'elle veut.
        // Game Show : le mot robot de l'équipe, celui de son arrivée et de ses buzz en jeu (cedric, 23 octobre : il
        // entendait « Harder » à l'arrivée, puis l'ancien buzzer à chaque appui).
        if (i.buzzs > p.buzzs && i.buzzeur >= 0) o += Ordre.Jouer(if (i.gameShow) Son.equipe(i.buzzeur) else Son.rigolo(i.buzzeur))
        // Bip, bip, bip : chacune des cinq dernières secondes du chrono, le dernier plus aigu. Jamais pendant qu'une
        // équipe répond après un buzz (le chrono est figé), en express (trop court) ni quand tout le monde a répondu.
        // Pas dans « Ça va exploser ! » : la mèche n'est jamais affichée, et sa musique monte d'elle-même jusqu'au boum.
        if ((i.ecran == Ecran.QUESTION || i.ecran == Ecran.MIMES_TOUR) && i.decompte in 1..5 && i.decompte != p.decompte &&
            !i.enPause && !i.express && !i.patate && i.buzzEquipe < 0 && !tousOntRepondu(i)
        ) o += Ordre.Jouer(if (i.decompte == 1) Son.BIP_FIN else Son.BIP)
        if (i.ecran == Ecran.QUESTION) {
            if (i.reponses > p.reponses) o += Ordre.Jouer(Son.REPONSE)
            // La tension des 5 dernières secondes s'arrête quand le temps repart ou que tout le monde a répondu.
            // Pas de tension en express : le chrono entier ne dure que quelques secondes.
            // Pas de tension dans les jeux au buzzer : le buzz et le suspense de la réponse en tiennent lieu.
            val enTension = p.urgent && !tousOntRepondu(p) && !p.express && !p.jeuBuzz && !p.musical && !p.patate
            val tension = i.urgent && !tousOntRepondu(i) && !i.express && !i.jeuBuzz && !i.musical && !i.patate
            if (tension && !enTension && !p.urgent) o += Ordre.Jouer(Son.TENSION)
            if (enTension && !tension) o += Ordre.Arreter(Son.TENSION)
            if (i.jeuBuzz || i.blind) o += buzzJeu(p, i)
            // Blind test, Game Show : la musique d'attente se coupe net quand Sarah lance le morceau (même si elle
            // n'était pas encore entrée après le générique : rien de prévu ne doit repartir sous la chanson).
            if (i.blind && i.gameShow && p.ecran == Ecran.QUESTION && p.blindAttente && !i.blindAttente) {
                o += Ordre.Couper
                o += Ordre.Musique(ambiance(i), fonduMs = Tempo.FONDU_RELAIS)
            }
            // Blind test : le diamant se pose chaque fois que Sarah lance (ou relance) la chanson.
            if (i.blind && i.blindLecture && !p.blindLecture && i.buzzEquipe < 0) o += Ordre.Jouer(Son.BT_DIAMANT)
            // Qui a disparu ? : « abracadabra » au début du tour de magie, « pouf ! » quand l'objet a disparu.
            if (i.disparu == DISPARU_MAGIE && p.disparu == DISPARU_MEMORISER) {
                o += Ordre.Jouer(Son.MAGIE)
                o += Ordre.Musique(ambiance(i))
            }
            if (i.disparu >= DISPARU_CHERCHER && p.disparu in DISPARU_MEMORISER..DISPARU_MAGIE) {
                o += Ordre.Jouer(Son.MAGIE_POUF)
                o += Ordre.Musique(ambiance(i))
            }
            // Duel des robots : chaque étape a sa musique (boucle western à l'annonce, rien au face-à-face, plus bas
            // entre deux duels) ; au face-à-face, elle se tait net : sa propre musique part avec l'écran du duel.
            if (i.duel && i.duelEtape != p.duelEtape) {
                o += Ordre.Musique(ambiance(i), fonduMs = if (i.duelEtape == "standoff") Tempo.FONDU_RELAIS else Tempo.FONDU_MUSIQUE)
            }
            // Simon du Prof : la musique change net quand une suite démarre (Classique : elle se tait), revient après.
            if (i.simonSuite != p.simonSuite || i.simonChiffres != p.simonChiffres) {
                o += Ordre.Musique(ambiance(i), fonduMs = if (i.simonSuite) Tempo.FONDU_RELAIS else Tempo.FONDU_MUSIQUE)
            }
            // Statues musicales : « gel ! » quand la musique s'arrête, petit élan quand elle repart.
            if (i.statue && !p.statue) o += Ordre.Jouer(Son.STATUE_GEL)
            if (!i.statue && p.statue && i.statuesAnnonce == 0) o += Ordre.Jouer(Son.STATUE_REPART)
            // « Et l'équipe gagnante est… » : roulement de tambour, puis la fanfare pour les gagnantes.
            if (i.statuesAnnonce == 1 && p.statuesAnnonce == 0) o += Ordre.Jouer(Son.ROULEMENT_LONG)
            if (i.statuesAnnonce == 2 && p.statuesAnnonce == 1 && i.statuesGagnantes) o += Ordre.Jouer(Son.FANFARE)
        }
        // Blind test : Sarah raccourcit la révélation, la fanfare s'arrête.
        if (i.ecran == Ecran.REVELATION && i.blind && i.blindCoupe && !p.blindCoupe) o += Ordre.Couper
        if (i.ecran == Ecran.MIMES_TOUR) {
            if (i.trouves > p.trouves) o += Ordre.Jouer(if (i.pictionary) Son.PICTIO_TROUVE else Son.MIME_TROUVE)
            // Mimes en roulement (cedric, 24/10) : « Changement de joueur ! » arrive dans un souffle, la musique ne change pas.
            if (i.trouves > p.trouves && !i.pictionary) o += Ordre.Jouer(Son.WHOOSH, Tempo.MIME_RELAIS)
            if (i.passes > p.passes) o += Ordre.Jouer(Son.MIME_PASSE)
            // Mimes en file (cedric, 26/10) : « ⏭ Passer » fait tourner les joueurs, dans le même souffle qu'un mime trouvé.
            if (i.passes > p.passes && i.onTourne) o += Ordre.Jouer(Son.WHOOSH, Tempo.MIME_RELAIS)
            // Sarah montre l'image suivante : petit « pop », le mimeur peut y aller.
            if (p.onTourne && !i.onTourne && i.trouves == p.trouves && i.passes == p.passes) o += Ordre.Jouer(Son.pop(i.trouves + i.passes))
            // Dix dernières secondes du tour : la tension monte. Mimes (cedric, 26/10) : la boucle qui monte ne s'arrête
            // jamais pendant le tour ; Pictionary : la musique s'efface sous la tension.
            if (i.urgent && !p.urgent) {
                o += Ordre.Jouer(Son.MIME_TENSION)
                if (i.pictionary) o += Ordre.Musique(Ambiance.SUSPENSE)
            }
            if (p.urgent && !i.urgent) {
                o += Ordre.Arreter(Son.MIME_TENSION)
                if (i.pictionary) o += Ordre.Musique(Ambiance.MIMES)
            }
        }
        return o
    }

    /**
     * Jeux au buzzer : le buzz fige tout (gros buzz, note de l'équipe, suspense, sauf pour Chante le mot où
     * l'équipe chante sans musique) ; un raté repart en douceur ; Qui suis-je : une petite note par indice.
     */
    private fun buzzJeu(p: Instant, i: Instant): List<Ordre> {
        val o = mutableListOf<Ordre>()
        if (i.indices > p.indices && p.indices > 0 && i.buzzEquipe < 0) o += Ordre.Jouer(Son.INDICE)
        val nouveauBuzz = i.buzzEquipe >= 0 && i.buzzEquipe != p.buzzEquipe
        val repart = i.buzzEquipe < 0 && p.buzzEquipe >= 0
        // Annule d'abord tout ce qui était prévu (musique qui revenait après un raté, suspense, montée de l'image) :
        // un deuxième buzz juste après un raté ne doit jamais entendre la musique repartir sous sa réponse.
        if (nouveauBuzz || repart) o += Ordre.Couper
        // Jamais moqueur : un petit « pouet » gentil quand une équipe s'est trompée (Game Show : son à lui, cedric 24/10).
        if ((nouveauBuzz || repart) && i.ratees > p.ratees) o += Ordre.Jouer(Son.RATE)
        // Game Show : la tablette joue le mot de l'équipe dès l'appui ; la TV le joue aussitôt, avec le buzz, sans
        // attendre (cedric, 27/10 au soir : le mot de la TV arrivait nettement après celui de la tablette).
        val motEquipe = if (i.gameShow) 0L else Tempo.FLOU_EQUIPE
        if (nouveauBuzz && i.blind) {
            // Blind test : le disque freine, « BWAP » de cuivres, la note de l'équipe, puis un vrai silence pour la laisser
            // répondre (cedric, 24 octobre : plus de musique d'attente).
            o += Ordre.Musique(Ambiance.SILENCE)
            o += Ordre.Jouer(Son.BT_BUZZ)
            o += Ordre.Jouer(Son.equipe(i.buzzEquipe), motEquipe)
        } else if (nouveauBuzz) {
            // Quiz musical : le disque s'arrête net (scratch) au moment du buzz.
            if (i.musical) o += Ordre.Jouer(Son.BT_SCRATCH)
            o += Ordre.Musique(Ambiance.SILENCE)
            o += Ordre.Jouer(Son.BUZZ_GROS)
            o += Ordre.Jouer(Son.equipe(i.buzzEquipe), motEquipe)
            if (!i.chante) o += Ordre.Jouer(Son.SUSPENSE_REPONSE, Tempo.FLOU_SUSPENSE)
        } else if (repart) {
            // L'image (ou la chanson) reprend, avec sa musique ; Image floue : la montée dramatique repart là où le
            // buzz l'avait figée, comme la photo.
            o += Ordre.Musique(ambiance(i), Tempo.FLOU_REPRISE)
            if (i.flou) o += Ordre.Reprendre(Son.FLOU_MONTEE, Tempo.FLOU_REPRISE)
        }
        return o
    }

    private fun tousOntRepondu(i: Instant) = i.equipes > 0 && i.reponses >= i.equipes

    private fun ambiance(i: Instant) = when (i.ecran) {
        Ecran.HORS_PARTIE -> Ambiance.SILENCE
        Ecran.SALON -> Ambiance.SALON
        Ecran.PRESENTATION -> ambiancePresentation(i)
        Ecran.QUESTION, Ecran.VERROUILLEE, Ecran.REVELATION -> when {
            i.express -> Ambiance.EXPRESS
            // Blind test, Game Show : la musique d'attente tant que Sarah n'a pas lancé le morceau.
            i.blindAttente && i.gameShow && i.ecran == Ecran.QUESTION -> Ambiance.BT_ATTENTE
            // Extrait musical : rien ne doit couvrir la chanson.
            i.musical && i.ecran != Ecran.VERROUILLEE -> Ambiance.SILENCE
            // Image floue : musique en retrait pendant que l'image se précise, silence pendant qu'une équipe répond.
            // Qui a disparu ? : musique douce pour mémoriser, presque rien pendant le tour de magie.
            // « Ça va exploser ! » : sa propre musique, calée sur la mèche (MusiquePatate) ; les boucles se taisent.
            i.patate && i.ecran != Ecran.REVELATION -> Ambiance.SILENCE
            // Le Duel des robots : un air de suspense pendant que les joueurs s'approchent, puis le silence du
            // face-à-face, rompu seulement par les feintes et le PAN (DuelScreens).
            i.duel -> when (i.duelEtape) {
                "standoff" -> Ambiance.SILENCE
                "ready" -> Ambiance.DUEL_ANNONCE
                else -> Ambiance.DUEL_ENTRE
            }
            // Le Simon du Prof : la boucle douce entre deux suites, celle aux percussions pendant une suite (la note de
            // chaque boule passe par-dessus), la partie où tout joue quand les chiffres arrivent.
            i.simon && i.ecran == Ecran.QUESTION -> when {
                !i.simonSuite -> Ambiance.SIMON_ENTRE
                i.simonChiffres -> Ambiance.SIMON_FORT
                else -> Ambiance.SIMON_SUITE
            }
            i.disparu == DISPARU_MEMORISER && i.ecran == Ecran.QUESTION -> Ambiance.MEMOIRE
            i.disparu == DISPARU_MAGIE && i.ecran == Ecran.QUESTION -> Ambiance.ENVOUTEMENT
            // Game Show : Qui suis-je ? est un jeu qui bouge, sur la musique des mimes (cedric, 23/10), en retrait sous les indices.
            i.quiSuis && i.gameShow && i.ecran == Ecran.QUESTION -> if (i.buzzEquipe >= 0) Ambiance.SILENCE else Ambiance.MIMES_ENTRE
            i.jeuBuzz && i.ecran == Ecran.QUESTION -> if (i.buzzEquipe >= 0) Ambiance.SILENCE else Ambiance.SUSPENSE
            // Zoom mystère : musique en retrait sous la montée, comme l'Image floue.
            i.zoom && i.ecran == Ecran.QUESTION -> Ambiance.SUSPENSE
            // Dernières questions à points multipliés : la musique devient un peu plus pressante (pas angoissante).
            i.superFinale && i.ecran == Ecran.QUESTION -> Ambiance.DECISIVE
            else -> ambianceParDefaut(i.ecran)
        }
        // Game Show : la boucle d'attente du podium tant que Sarah n'a pas lancé la fin ; pendant l'outro (sa vidéo a son
        // propre son), rien ; l'écran lance le groove d'Aerodynamic après elle.
        Ecran.FIN -> when {
            !i.gameShow -> ambianceParDefaut(i.ecran)
            !i.finLancee -> Ambiance.PODIUM_ATTENTE
            i.outro -> Ambiance.SILENCE
            else -> Ambiance.AU_REVOIR
        }
        else -> ambianceParDefaut(i.ecran)
    }

    private fun ambianceParDefaut(e: Ecran) = when (e) {
        Ecran.HORS_PARTIE -> Ambiance.SILENCE
        Ecran.SALON -> Ambiance.SALON
        Ecran.PRESENTATION -> Ambiance.PRESENTATION
        Ecran.QUESTION -> Ambiance.QUESTION
        Ecran.MIMES -> Ambiance.MIMES_ENTRE
        Ecran.MIMES_TOUR -> Ambiance.MIMES
        Ecran.VERROUILLEE -> Ambiance.SUSPENSE
        Ecran.REVELATION, Ecran.FIN -> Ambiance.FETE
        Ecran.CLASSEMENT -> Ambiance.BILAN
    }
}

/** Ce que montre la TV, réduit à ce qui compte pour le son. */
data class Instant(
    val ecran: Ecran,
    /** Code de la partie : le générique n'est joué qu'une fois par partie. */
    val partie: String = "",
    val index: Int = -1,
    val equipes: Int = 0,
    val reponses: Int = 0,
    val propositions: Int = 4,
    val enPause: Boolean = false,
    /** Temps restant du décompte 3, 2, 1 de la dernière reprise. */
    val repriseDansMs: Long = 0,
    /** Fin du chrono : cinq dernières secondes d'une question, dix d'un tour de mimes. */
    val urgent: Boolean = false,
    /** Secondes restantes au chrono pendant ses cinq dernières secondes (5, 4, 3, 2, 1) ; 0 sinon : un bip par seconde. */
    val decompte: Int = 0,
    /** Place (0, 1, 2…) de la dernière équipe qui a buzzé à l'accueil, -1 si personne. */
    val buzzeur: Int = -1,
    /** Nombre d'appuis sur le buzzer de l'accueil depuis le début : un son par nouvel appui. */
    val buzzs: Int = 0,
    val premiere: Boolean = false,
    val superFinale: Boolean = false,
    /** Équipes qui marquent des points à cette révélation. */
    val gagnants: Int = 0,
    val meneurAPoints: Boolean = false,
    /** Mimes trouvés et passés pendant le tour en cours. */
    val trouves: Int = 0,
    val passes: Int = 0,
    /** Mimes en file : les joueurs tournent, l'écran attend « Image suivante » (pas d'image montrée). */
    val onTourne: Boolean = false,
    /** Jeu en cours (« quiz|Manche 1 », « mimes|… ») ; vide hors des questions. */
    val epreuve: String = "",
    /** Vrai ou Faux express (et la bonne réponse est « Vrai »), Zoom mystère. */
    val express: Boolean = false,
    val reponseVraie: Boolean = false,
    val zoom: Boolean = false,
    /** Durée du chrono de la question (millisecondes) ; 0 hors des questions. */
    val chronoMs: Long = 0,
    /**
     * Jeux au buzzer (Image floue, Chante le mot, Qui suis-je) : place de l'équipe qui a buzzé et attend le
     * verdict (-1 sinon), équipes déjà ratées, indices de Qui suis-je déjà affichés.
     */
    val jeuBuzz: Boolean = false,
    /** La question fait entendre un extrait musical (blind test, quiz musical) : l'habillage se tait. */
    val musical: Boolean = false,
    /** Statues musicales : la musique du jeu est arrêtée, tout le monde se fige. */
    val statue: Boolean = false,
    /** Statues musicales : annonce des gagnantes d'une chanson (1 roulement de tambour, 2 gagnantes, 3 récap), 0 sinon. */
    val statuesAnnonce: Int = 0,
    /** Statues musicales : la chanson a des gagnantes (sinon « Personne »). */
    val statuesGagnantes: Boolean = false,
    /** « Ça va exploser ! » : le jeu a sa propre musique, calée sur la mèche ; ni boucle, ni bips, ni tension. */
    val patate: Boolean = false,
    /**
     * Le Duel des robots ; [duelEtape] : « ready » (les joueurs se placent), « standoff » (face-à-face, sa musique est
     * jouée par l'écran du duel et coupée net au PAN), « result », ou vide.
     */
    val duel: Boolean = false,
    val duelEtape: String = "",
    /** Le Simon du Prof : sa question est à l'écran ; une suite est en cours (le robot la montre, les équipes la tapent). */
    val simon: Boolean = false,
    val simonSuite: Boolean = false,
    /** Le Simon du Prof : la suite en cours a des chiffres (à partir de [com.littlemissparty.quiz.engine.SIMON_CHIFFRES_DES]). */
    val simonChiffres: Boolean = false,
    /** Quiz : question fermée par la fin du chrono (une équipe n'a pas répondu), « TEMPS ÉCOULÉ ! » à l'écran. */
    val tempsEcoule: Boolean = false,
    val flou: Boolean = false,
    val chante: Boolean = false,
    val quiSuis: Boolean = false,
    val indices: Int = 0,
    val buzzEquipe: Int = -1,
    val ratees: Int = 0,
    /**
     * Blind test : question du blind test, présentation du premier morceau (avant la première écoute),
     * chanson en cours de lecture, points doublés, révélation raccourcie par la régie, bilan de fin de manche.
     */
    val blind: Boolean = false,
    val blindPresentation: Boolean = false,
    /** Blind test : l'écran « Lancer le morceau » (morceau pas encore écouté, personne n'a buzzé). */
    val blindAttente: Boolean = false,
    val blindLecture: Boolean = false,
    val blindDouble: Boolean = false,
    val blindCoupe: Boolean = false,
    val blindBilan: Boolean = false,
    /** Qui a disparu ? : étape du jeu ([DISPARU_MEMORISER]…[DISPARU_REPONSE]), 0 pour les autres jeux. */
    val disparu: Int = 0,
    /** Le Juste Chiffre : révélation d'un nombre, et une équipe l'a trouvé pile. */
    val nombre: Boolean = false,
    val pile: Boolean = false,
    /**
     * Pictionary (même structure que les mimes) : top départ et « Trouvé ! » au crayon ; le dernier tour a été
     * trouvé (la régie peut finir le tour au moment même où elle valide le mot).
     */
    val pictionary: Boolean = false,
    val pictioTrouve: Boolean = false,
    /** Design « The Game Show » : le podium et l'écran de fin ont leur propre musique. */
    val gameShow: Boolean = false,
    /** Game Show avec la vidéo de l'outro dans l'appli ([Outro]) : après le podium, l'écran lance lui-même la musique de fin. */
    val outro: Boolean = false,
    /** Game Show, après le podium : Sarah a lancé la fin (« ▶ Lancer la fin ») ; avant, la musique attend en boucle. */
    val finLancee: Boolean = false,
    /**
     * Game Show : la grosse intro du lancement passe en plein écran avec sa propre musique (Get Lucky) ; l'habillage
     * se tait jusqu'à sa fin, puis l'écran du moment (la présentation du 1er jeu) entre normalement.
     */
    val lancement: Boolean = false,
    /** Famille du jeu en cours, comme pour sa vidéo d'intro ([familleJeu] : "blind", "quiz", "duel"…). */
    val famille: String = "",
)

/**
 * Game Show : jeux qui ont leur propre boucle sous l'écran de présentation (la vidéo d'intro, jusqu'à « ▶ Lancer
 * l'épreuve »), par famille ([familleJeu]). Les autres gardent la boucle « fête » de Digital Love ([Ambiance.PRESENTATION]),
 * choix de cedric le 29/10 : « la plupart des intros », et une boucle à soi pour certains jeux quand il en donne une.
 * Le Duel et le Simon ont déjà la leur (ci-dessous). Pour un nouveau jeu : une [Lit], une [Ambiance], une ligne ici.
 */
internal val PRESENTATIONS_PROPRES: Map<String, Ambiance> = mapOf(
    "blind" to Ambiance.BT_PRESENTATION,
    "chante" to Ambiance.CHANTE_PRESENTATION,
    "zoom" to Ambiance.ZOOM_PRESENTATION,
    "flou" to Ambiance.ZOOM_PRESENTATION,
    "disparu" to Ambiance.DISPARU_PRESENTATION,
    // Coffres mystères : leur famille s'appelle « bombe » ([familleType]).
    "bombe" to Ambiance.COFFRES_PRESENTATION,
    "quiz" to Ambiance.QUIZ_PRESENTATION,
    "illustre" to Ambiance.QUIZ_PRESENTATION,
    "quisuis" to Ambiance.QUISUIS_PRESENTATION,
)

/** Qui a disparu ? : la boucle de Mission Impossible repart de là, après son début (échantillon 162 641 à 44,1 kHz). */
internal const val DISPARU_INTRO_REPRISE_MS = 3_688L

/** Quiz et Quiz illustré : la boucle de Questions pour un champion repart de là, après les trompettes (échantillon 95 256). */
internal const val QUIZ_INTRO_REPRISE_MS = 2_160L

/** Musique de l'écran de présentation d'un jeu ([propres] : voir [PRESENTATIONS_PROPRES]). */
internal fun ambiancePresentation(i: Instant, propres: Map<String, Ambiance> = PRESENTATIONS_PROPRES): Ambiance = when {
    i.duel -> Ambiance.DUEL_PRESENTATION
    i.simon && i.gameShow -> Ambiance.SIMON_ENTRE
    i.gameShow -> propres[i.famille] ?: Ambiance.PRESENTATION
    else -> Ambiance.PRESENTATION
}

const val DISPARU_MEMORISER = 1
const val DISPARU_MAGIE = 2
const val DISPARU_CHERCHER = 3
const val DISPARU_REPONSE = 4

/** [MIMES] : manche de mimes entre deux tours ; [MIMES_TOUR] : une équipe mime. */
enum class Ecran { HORS_PARTIE, SALON, PRESENTATION, QUESTION, MIMES, MIMES_TOUR, VERROUILLEE, REVELATION, CLASSEMENT, FIN }

/**
 * Les boucles musicales de 16 s (8 mesures à 120 BPM), toujours calées sur le même tempo. [gs] : boucle propre au
 * Game Show, sans équivalent classique ([fichier] null : le Classique ne la charge pas).
 */
enum class Lit(val fichier: String?, val gs: String? = null, val repriseMs: Long = 0) {
    COMPLET("lmp_bed_full"),
    LEGER("lmp_bed_light"),
    MIMES("lmp_bed_mimes"),
    PAUSE("lmp_bed_pause"),
    EXPRESS("lmp_bed_express"),
    MAGIE("lmp_bed_magie"),
    /** Game Show : le riff d'Aerodynamic sous le bilan des scores (choix de cedric, 23 octobre). */
    BILAN(null, "gs_bed_bilan"),
    /** Game Show : nappe de tension sans note, par-dessus la musique de la manche pendant la Super finale. */
    TENSION(null, "gs_bed_tension"),
    /** Game Show : le dernier groove d'Aerodynamic, sous l'écran de fin après le podium (cedric, 23 octobre). */
    FIN(null, "gs_bed_fin"),
    /**
     * Game Show : la boucle du début de Get Lucky sous l'accueil (48 temps, 24,8 s, tempo d'origine : elle a sa propre
     * longueur ; la vidéo du robot qui dort tourne seule, à côté).
     */
    ACCUEIL(null, "gs_accueil"),
    /** Game Show : la boucle western du Duel des robots (36 temps, 21,24 s, sans blanc), sous l'annonce et entre deux duels. */
    DUEL(null, "gs_duel_intro_boucle"),
    /**
     * Game Show, le Simon du Prof sur « Prix choc » d'Etienne de Crécy (cedric, 28/10), trois boucles prises entre les
     * passages chantés (jamais la voix) à 127,87 BPM, coupées sur un début de mesure là où la suite ressemble le plus
     * au début (raccord fondu sur 60 ms) : la douce, sans batterie (8 mesures, 15 s, de 0:01,9) ; avec les premières
     * percussions (16 mesures, 30 s, de 0:43,2) ; la partie où tout joue (16 mesures, 30 s, de 2:02,0). Volumes laissés
     * tels quels (pas de limiteur, qui changerait le niveau au raccord) : la douce et celle aux percussions sont plus
     * basses dans le fichier, leurs ambiances les remontent.
     */
    SIMON_DOUCE(null, "gs_simon_douce"),
    SIMON_SUITE(null, "gs_simon_suite"),
    SIMON_FORT(null, "gs_simon_fort"),
    /**
     * Game Show, Blind test : la musique d'attente de l'écran « Lancer le morceau » (cedric, 29/10, boucle A) : l'intro
     * seule de « Music Sounds Better With You » (Stardust), mesures 1 à 7, 13,52 s à 124,2 BPM, sans blanc, −12 LUFS
     * comme l'accueil.
     */
    BT_ATTENTE(null, "gs_bt_attente"),
    /**
     * Game Show, Blind test : la boucle sous sa vidéo d'intro (cedric, 29/10, boucle C) : « Intro » d'Alan Braxe &
     * Fred Falke, la ligne de basse entrée à 1:17,65, 4 mesures (la phrase entière) prises à 1:25,4, 7,75 s à
     * 123,91 BPM, raccord fondu 25 ms sur la suite réelle, −12 LUFS comme la boucle « fête » des autres intros.
     */
    BT_INTRO(null, "gs_bt_intro"),
    /**
     * Game Show, Chante le mot ! : la boucle sous sa vidéo d'intro (cedric, 29/10 : « parfaite ») : La Vie en rose
     * (Édith Piaf), de « Quand il me prend dans ses bras » à « je vois la vie en rose », 11,90 s, raccord déjà fondu,
     * −12 LUFS comme la boucle « fête » des autres intros.
     */
    CHANTE_INTRO(null, "gs_chante_intro"),
    /**
     * Game Show, Zoom mystère et Image floue : la boucle sous leur vidéo d'intro (cedric, 29/10 : « vraiment bien ») :
     * La Panthère rose, 16,67 s, sans raccord audible, −12 LUFS comme la boucle « fête » des autres intros.
     */
    ZOOM_INTRO(null, "gs_zoom_intro"),
    /**
     * Game Show, Qui a disparu ? : la boucle sous sa vidéo d'intro (cedric, 29/10) : Mission Impossible, un début joué
     * une fois (3,688 s), puis 13,3 s qui tournent à partir de l'échantillon 162 641 ([repriseMs]), −12 LUFS.
     */
    DISPARU_INTRO(null, "gs_disparu_intro", repriseMs = DISPARU_INTRO_REPRISE_MS),
    /** Game Show, Coffres mystères : la boucle sous sa vidéo d'intro (cedric, 29/10 : « parfaite ») : Pirates des Caraïbes, 13,62 s, −12 LUFS. */
    COFFRES_INTRO(null, "gs_coffres_intro"),
    /**
     * Game Show, Quiz et Quiz illustré : la boucle sous leur vidéo d'intro (cedric, 29/10 : « meilleur, je valide ») : le
     * générique de Questions pour un champion, les trompettes une fois, puis la boucle depuis l'échantillon 95 256
     * ([repriseMs]), −12 LUFS.
     */
    QUIZ_INTRO(null, "gs_quiz_intro", repriseMs = QUIZ_INTRO_REPRISE_MS),
    /** Game Show, Qui suis-je ? : la boucle sous sa vidéo d'intro (cedric, 29/10) : Soul Bossa Nova, 18,77 s, raccord fondu, −12 LUFS. */
    QUISUIS_INTRO(null, "gs_quisuisje_intro"),
    /**
     * Game Show, fin du podium (cedric, 29/10) : la suite de gs_podium, à enchaîner pile à sa coupe ([Tempo.PODIUM_COUPE],
     * juste avant la note grave de 4:07) : l'écho de la dernière note aiguë (6 s), la boucle « fête » de Digital Love
     * sans guitare (vitesse d'origine, calée sur la mesure) qui entre dessous pendant que le son descend en 2 s jusqu'à
     * -6 dB ; puis, à [repriseMs], 8 mesures de boucle pure qui tournent jusqu'à « ▶ Lancer la fin ». Niveau déjà réglé
     * dans le fichier (le même que le podium) : son ambiance le joue à plein volume.
     */
    PODIUM_ATTENTE(null, "gs_podium_attente", repriseMs = PODIUM_ATTENTE_REPRISE_MS),
    ;

    /** Fichier lu dans le design donné (null : cette boucle n'existe pas dans ce design). */
    fun fichierPour(gameShow: Boolean): String? = if (gameShow) gs ?: fichier else fichier
}

/** Fond musical : le volume de chaque boucle selon l'ambiance (fondu enchaîné de l'une à l'autre). */
enum class Ambiance(
    private val complete: Float = 0f,
    private val legere: Float = 0f,
    private val mimes: Float = 0f,
    private val pause: Float = 0f,
    private val express: Float = 0f,
    private val magie: Float = 0f,
    /** Volumes propres au Game Show, à la place des autres ; null : les mêmes que le Classique. */
    private val gameShow: Map<Lit, Float>? = null,
) {
    SILENCE,
    /** Accueil ; Game Show : la boucle de Get Lucky, au niveau des autres fonds (elle est 1 dB plus forte). */
    SALON(complete = 0.55f, gameShow = mapOf(Lit.ACCUEIL to 0.49f)),
    /** Relais du générique : la musique du salon entre presque aussi fort que lui, avant de redescendre. */
    SALON_ARRIVEE(complete = 0.85f, gameShow = mapOf(Lit.ACCUEIL to 0.49f)),
    /** Plan de volumes du 25 octobre : la musique des questions remonte, le creux du suspense n'est plus que de 4 dB. */
    QUESTION(legere = 0.7f),
    SUSPENSE(legere = 0.45f),
    /** Présentation du Duel des robots ; Game Show : la boucle western à plein volume (Classique : comme les autres). */
    DUEL_PRESENTATION(complete = 0.5f, gameShow = mapOf(Lit.DUEL to 1f)),
    /** Duel des robots : un duel est prêt, les joueurs se placent ; Game Show : la boucle western à −4 dB. */
    DUEL_ANNONCE(legere = 0.45f, gameShow = mapOf(Lit.DUEL to 0.63f)),
    /** Duel des robots : entre deux duels, sous le résultat ; Game Show : la boucle western à −10 dB. */
    DUEL_ENTRE(legere = 0.3f, gameShow = mapOf(Lit.DUEL to 0.32f)),
    /**
     * Le Simon du Prof, Game Show (« Prix choc », cedric 28/10) : la boucle douce à la présentation et entre deux suites,
     * sous la voix de Sarah ; Classique : la musique des questions.
     */
    SIMON_ENTRE(legere = 0.7f, gameShow = mapOf(Lit.SIMON_DOUCE to 0.82f)),
    /**
     * Pendant une suite : la boucle aux percussions, assez bas pour que la note de chaque boule passe nettement au-dessus
     * (cedric, 28/10 au soir : « pas assez fort ») ; Classique : silence.
     */
    SIMON_SUITE(gameShow = mapOf(Lit.SIMON_SUITE to SIMON_MUSIQUE_SUITE)),
    /** Pendant une suite avec des chiffres (longue, plus dure) : la partie où tout joue, baissée de même ; Classique : silence. */
    SIMON_FORT(gameShow = mapOf(Lit.SIMON_FORT to SIMON_MUSIQUE_FORT)),
    /**
     * Blind test, Game Show : sous l'écran « Lancer le morceau », au niveau de l'accueil, coupée net quand Sarah lance
     * le morceau (cedric, 29/10) ; Classique : le silence d'avant.
     */
    BT_ATTENTE(gameShow = mapOf(Lit.BT_ATTENTE to 0.49f)),
    /** Présentation du Blind test (Game Show) : sa boucle d'Alan Braxe, au volume de la boucle « fête » des autres intros. */
    BT_PRESENTATION(gameShow = mapOf(Lit.BT_INTRO to 0.5f)),
    /** Présentation de Chante le mot ! (Game Show) : sa boucle de La Vie en rose, au volume de la boucle « fête ». */
    CHANTE_PRESENTATION(gameShow = mapOf(Lit.CHANTE_INTRO to 0.5f)),
    /** Présentation du Zoom mystère et de l'Image floue (Game Show) : La Panthère rose, au volume de la boucle « fête ». */
    ZOOM_PRESENTATION(gameShow = mapOf(Lit.ZOOM_INTRO to 0.5f)),
    /** Présentation de Qui a disparu ? (Game Show) : Mission Impossible, au volume de la boucle « fête ». */
    DISPARU_PRESENTATION(gameShow = mapOf(Lit.DISPARU_INTRO to 0.5f)),
    /** Présentation des Coffres mystères (Game Show) : Pirates des Caraïbes, au volume de la boucle « fête ». */
    COFFRES_PRESENTATION(gameShow = mapOf(Lit.COFFRES_INTRO to 0.5f)),
    /** Présentation du Quiz et du Quiz illustré (Game Show) : Questions pour un champion, au volume de la boucle « fête ». */
    QUIZ_PRESENTATION(gameShow = mapOf(Lit.QUIZ_INTRO to 0.5f)),
    /** Présentation de Qui suis-je ? (Game Show) : Soul Bossa Nova, au volume de la boucle « fête ». */
    QUISUIS_PRESENTATION(gameShow = mapOf(Lit.QUISUIS_INTRO to 0.5f)),
    /** Game Show : la boucle d'attente après la coupe du podium, au niveau du podium (réglé dans le fichier). */
    PODIUM_ATTENTE(gameShow = mapOf(Lit.PODIUM_ATTENTE to 1f)),
    /**
     * Présentation d'un jeu : la musique du salon, assez bas pour que Sarah présente le jeu par-dessus ; 0,3 sonnait
     * trop éteint (cedric, 24/10).
     */
    PRESENTATION(complete = 0.5f),
    FETE(complete = 0.8f),
    /** Tour de mimes : rythmique latine qui entraîne, sans couvrir les cris de ceux qui devinent. */
    MIMES(mimes = 0.7f),
    /** Entre deux tours de mimes : la même musique, plus bas, pendant qu'on choisit l'équipe suivante. */
    MIMES_ENTRE(mimes = 0.45f),
    /** Pause : musique lounge feutrée, qui tient aussi longtemps qu'il faut. */
    INTERMEDE(pause = 0.5f),
    /** Vrai ou Faux express : course contre la montre, sur toute la série. */
    EXPRESS(express = 0.75f),
    /**
     * Dernières questions du quiz à points multipliés : la rythmique nerveuse de l'express, un peu plus bas. Game Show :
     * la musique de la manche continue, avec la nappe de tension par-dessus (cedric, 23 octobre).
     */
    DECISIVE(express = 0.6f, gameShow = mapOf(Lit.LEGER to 0.7f, Lit.TENSION to 0.55f)),
    /** Bilan des scores entre deux jeux : la musique de fête ; Game Show : le riff d'Aerodynamic. */
    BILAN(complete = 0.8f, gameShow = mapOf(Lit.BILAN to 0.8f)),
    /** Écran de fin, après le podium du Game Show : le dernier groove d'Aerodynamic ; Classique : la musique de fête. */
    AU_REVOIR(complete = 0.8f, gameShow = mapOf(Lit.FIN to 0.75f)),
    /** Qui a disparu ? : boîte à musique et harpe pendant qu'on mémorise les objets. */
    MEMOIRE(magie = 0.6f),
    /** Qui a disparu ? : le tour de magie, la boîte à musique s'efface sous l'« abracadabra ». */
    ENVOUTEMENT(magie = 0.25f);

    /** Volume d'une boucle dans cette ambiance ; [gs] : design « The Game Show ». */
    fun volume(l: Lit, gs: Boolean = false): Float {
        if (gs && gameShow != null) return gameShow[l] ?: 0f
        return when (l) {
            Lit.COMPLET -> complete
            Lit.LEGER -> legere
            Lit.MIMES -> mimes
            Lit.PAUSE -> pause
            Lit.EXPRESS -> express
            Lit.MAGIE -> magie
            Lit.BILAN, Lit.TENSION, Lit.FIN, Lit.ACCUEIL, Lit.DUEL, Lit.SIMON_DOUCE, Lit.SIMON_SUITE, Lit.SIMON_FORT,
            Lit.BT_ATTENTE, Lit.BT_INTRO, Lit.CHANTE_INTRO, Lit.ZOOM_INTRO, Lit.DISPARU_INTRO, Lit.COFFRES_INTRO, Lit.QUIZ_INTRO, Lit.QUISUIS_INTRO, Lit.PODIUM_ATTENTE -> 0f
        }
    }
}

/** Les sons de l'habillage ; [fichier] est le nom dans res/raw. Les longs passent par un lecteur dédié. */
/** [gs] : fichier du Game Show quand il ne suit pas la règle lmp_… → gs_… (équipes 5 à 8, qui reprennent 1 à 4 en Classique). */
enum class Son(val fichier: String, val long: Boolean = false, val gs: String? = null) {
    GENERIQUE("lmp_generique", true),
    TENSION("lmp_tension", true),
    BIP("lmp_bip"), BIP_FIN("lmp_bip_fin"),
    MONTEE("lmp_riser_4b"),
    IMPACT("lmp_impact", true),
    MANCHE("lmp_round_sting"),
    WHOOSH("lmp_whoosh"),
    REPONSE("lmp_tick_answer"),
    VERROU("lmp_lock_clac"),
    ROULEMENT_COURT("lmp_drumroll_2b"),
    ROULEMENT_LONG("lmp_drumroll_4b"),
    ROULEMENT_FINAL("lmp_roulement_final", true),
    ETEINT("lmp_wrong_off"),
    BONNE_REPONSE("lmp_reveal_chime", true),
    TAMPON("lmp_stamp"),
    POINTS("lmp_points_bling"),
    COMPTEUR("lmp_points_count", true),
    COURONNE("lmp_crown_hit", true),
    FANFARE("lmp_victory_fanfare", true),
    APPLAUDISSEMENTS("lmp_applause", true),
    CLOCHES("lmp_prize_bells"),
    FIN("lmp_end_jingle", true),
    /** Game Show seulement : le podium sur Digital Love, roulement et impact compris (104,6 s). */
    PODIUM("gs_podium", true),
    POP_1("lmp_pop_1"), POP_2("lmp_pop_2"), POP_3("lmp_pop_3"), POP_4("lmp_pop_4"),
    MIME_TOP("lmp_mime_go", true),
    MIME_TROUVE("lmp_mime_found"),
    MIME_PASSE("lmp_mime_pass"),
    MIME_TENSION("lmp_mime_tension", true),
    MIME_FIN("lmp_mime_time_up", true),
    PAUSE("lmp_pause_in", true),
    TRANSITION("lmp_transition", true),
    /** Game Show seulement : l'ouverture des portes entre les jeux (la fermeture est gs_transition), jouée par le rideau. */
    TRANSITION_OUVRE("gs_transition_ouvre", true),
    CHIFFRE_ROULETTE("lmp_chiffre_roulette", true),
    CHIFFRE_PILE("lmp_chiffre_pile", true),
    VF_VRAI("lmp_vf_vrai"),
    VF_FAUX("lmp_vf_faux"),
    /**
     * Mauvaise réponse aux jeux au buzzer : le « pouet » du Vrai ou Faux en Classique ; en Game Show un son à lui
     * (cedric, 24/10 : l'ancien « dégueulasse »), sans toucher le « Faux » de la révélation du Vrai ou Faux.
     */
    RATE("lmp_vf_faux", gs = "gs_rate"),
    ZOOM_OUVERTURE("lmp_zoom_ouverture"),
    ZOOM_REVELE("lmp_zoom_revele", true),
    FLOU_MONTEE("lmp_flou_montee", true),
    BUZZ_GROS("lmp_buzz_gros"),
    SUSPENSE_REPONSE("lmp_suspense_reponse", true),
    INDICE("lmp_indice"),
    BT_DIAMANT("lmp_bt_diamant"),
    BT_SCRATCH("lmp_bt_scratch"),
    STATUE_GEL("lmp_statue_gel", true),
    STATUE_REPART("lmp_statue_repart"),
    MAGIE("lmp_magie"),
    MAGIE_POUF("lmp_magie_pouf"),
    BT_GENERIQUE("lmp_bt_generique"),
    BT_BUZZ("lmp_bt_buzz"),
    BT_BRAVO("lmp_bt_bravo"),
    BT_DOUBLE("lmp_bt_double"),
    BT_OUTRO("lmp_bt_outro"),
    RIGOLO_1("lmp_fun_buzz_1"), RIGOLO_2("lmp_fun_buzz_2"), RIGOLO_3("lmp_fun_buzz_3"), RIGOLO_4("lmp_fun_buzz_4"),
    BONUS("lmp_bonus"),
    MALUS("lmp_malus"),
    PICTIO_TOP("lmp_pictio_top", true),
    PICTIO_TROUVE("lmp_pictio_trouve", true),
    PORTES_OUVRE("lmp_portes_ouvre", true),
    PORTES_JACKPOT("lmp_portes_jackpot", true),
    PORTES_TUILE("lmp_portes_tuile", true),
    PORTES_RENVERSEMENT("lmp_portes_renversement", true),
    COFFRE_SECOUE("lmp_coffre_secoue"),
    COFFRE_OUVRE("lmp_coffre_ouvre", true),
    COFFRE_OR("lmp_coffre_or", true),
    BOMBE_ALERTE("lmp_bombe_alerte", true),
    BOMBE_MECHE("lmp_bombe_meche"),
    /** La bombe sort du coffre et fonce vers l'écran : mèche qui crépite, souffle qui monte, cœur qui s'emballe. */
    BOMBE_APPROCHE("lmp_bombe_approche"),
    /** Coffre malus : coup de tonnerre, couvercle qui claque, orage qui gronde. */
    COFFRE_MALUS("lmp_coffre_malus", true),
    BOMBE_BOUM("lmp_bombe_boum", true),
    GONFLE_1("lmp_gonfle_1"), GONFLE_2("lmp_gonfle_2"), GONFLE_3("lmp_gonfle_3"),
    /**
     * Game Show seulement (cedric, 27/10, son B) : le ballon qui couine, de plus en plus aigu à mesure qu'il gonfle
     * (un tiers chacun). Rien en Classique.
     */
    COUINE_1("gs_couine_1"), COUINE_2("gs_couine_2"), COUINE_3("gs_couine_3"),
    BALLON_ECLATE("lmp_ballon_eclate", true),
    /**
     * Le Duel des robots (cedric, 27/10) : le face-à-face commence, une feinte, le PAN, la victoire, un tir trop tôt.
     * Design classique : des sons de l'appli ; Game Show : ceux du western néon quand ils sont livrés.
     */
    DUEL_FACE("lmp_drumroll_2b", true, gs = "gs_duel_face"),
    DUEL_FEINTE("lmp_whoosh", gs = "gs_duel_feinte"),
    DUEL_PAN("lmp_impact", gs = "gs_duel_coup"),
    DUEL_VICTOIRE("lmp_crown_hit", gs = "gs_duel_victoire"),
    DUEL_TROP_TOT("lmp_wrong_off", gs = "gs_duel_troptot"),
    /** Game Show seulement : le début de l'air western à la présentation du duel (2,9 s), avant sa boucle. */
    DUEL_INTRO("gs_duel_intro_debut", true),
    /** Game Show seulement : la grande fin de l'air western sous les affiches WANTED du classement du duel (22,7 s). */
    DUEL_CLASSEMENT("gs_duel_classement", true),
    TIC_1("lmp_tic_1"), TIC_2("lmp_tic_2"), TIC_3("lmp_tic_3"),
    PATATE_PASSE("lmp_patate_passe"),
    /** Musique de « Ça va exploser ! » (extrait choisi par cedric) : sa fin tombe sur l'explosion, voir [MusiquePatate]. */
    PATATE_MUSIQUE("lmp_patate_musique", true),
    EQUIPE_1("lmp_team_sting_1"), EQUIPE_2("lmp_team_sting_2"), EQUIPE_3("lmp_team_sting_3"), EQUIPE_4("lmp_team_sting_4"),
    /** Game Show : un mot robot de Harder Better Faster Stronger par équipe, 8 en tout ; le Classique reprend ses 4 notes. */
    EQUIPE_5("lmp_team_sting_1", gs = "gs_team_sting_5"), EQUIPE_6("lmp_team_sting_2", gs = "gs_team_sting_6"),
    EQUIPE_7("lmp_team_sting_3", gs = "gs_team_sting_7"), EQUIPE_8("lmp_team_sting_4", gs = "gs_team_sting_8");

    /**
     * Fichier d'un son long : en Game Show, le sien propre ([gs]) s'il en a un. Avant, un son long lisait toujours la
     * version gs_ de son fichier classique : le face-à-face du duel jouait un roulement au lieu de sa musique.
     */
    fun fichierLong(gameShow: Boolean): String = if (gameShow) gs ?: fichier else fichier

    companion object {
        private val pops = listOf(POP_1, POP_2, POP_3, POP_4)
        private val equipes = listOf(EQUIPE_1, EQUIPE_2, EQUIPE_3, EQUIPE_4, EQUIPE_5, EQUIPE_6, EQUIPE_7, EQUIPE_8)
        private val rigolos = listOf(RIGOLO_1, RIGOLO_2, RIGOLO_3, RIGOLO_4)
        fun pop(k: Int) = pops[Math.floorMod(k, pops.size)]
        fun equipe(place: Int) = equipes[Math.floorMod(place, equipes.size)]
        fun rigolo(place: Int) = rigolos[Math.floorMod(place, rigolos.size)]
    }
}

sealed interface Ordre {
    /** [etireSurMs] : un son long plus court que ça est ralenti (sans changer sa hauteur) pour durer ce temps-là. */
    data class Jouer(
        val son: Son,
        val dansMs: Long = 0,
        val etireSurMs: Long = 0,
        /** Sons courts seulement : volume à gauche et à droite (stéréo par place d'équipe), et vitesse (hauteur) de 0,5 à 2. */
        val gauche: Float = 1f,
        val droite: Float = 1f,
        val vitesse: Float = 1f,
    ) : Ordre
    data class Musique(val ambiance: Ambiance, val dansMs: Long = 0, val fonduMs: Long = Tempo.FONDU_MUSIQUE) : Ordre
    /** Les boucles musicales repartent du début de leur première mesure (relais calé sur le générique). */
    data class Caler(val dansMs: Long = 0) : Ordre
    data class Arreter(val son: Son) : Ordre
    /** Un son long mis en sourdine (par [Couper]) repart là où il s'était arrêté, en fondu. */
    data class Reprendre(val son: Son, val dansMs: Long = 0) : Ordre
    /** Annule les sons prévus et fait taire les sons longs en cours (changement d'écran, pause). */
    data object Couper : Ordre
    /**
     * Quand le son long [son] (lancé juste avant) arrive à [aMs] de sa lecture, passe sans fondu à l'[ambiance] : son
     * fichier enchaîne pile sur la fin du son. Calé sur la position réelle du son peu avant ([Tempo.ENCHAINER_AVANT]),
     * pas seulement sur l'horloge : la box met plus ou moins de temps à démarrer un son. Annulé par [Couper].
     */
    data class Enchainer(val son: Son, val aMs: Long, val ambiance: Ambiance) : Ordre

    fun decale(ms: Long): Ordre = when (this) {
        is Jouer -> copy(dansMs = dansMs + ms)
        is Musique -> copy(dansMs = dansMs + ms)
        is Caler -> copy(dansMs = dansMs + ms)
        is Reprendre -> copy(dansMs = dansMs + ms)
        is Enchainer -> copy(aMs = aMs + ms)
        else -> this
    }
}

/** Minutage partagé par les sons et les animations, pour qu'image et son tombent ensemble (120 BPM, un temps = 500 ms). */
object Tempo {
    const val TEMPS = 500L
    /** Mimes : après « TROUVÉ ! », le message « Changement de joueur ! » (environ une seconde, cedric 24/10). */
    const val MIME_RELAIS = 700L
    const val MIME_RELAIS_DUREE = 1_100L
    /** Fondu enchaîné ordinaire d'une ambiance musicale à l'autre. */
    const val FONDU_MUSIQUE = 700L
    /** Temps fort qui suit la dernière note du générique (16 temps) : la musique du salon prend le relais. */
    const val GENERIQUE_RELAIS = 8_000L
    const val FONDU_RELAIS = 120L
    /** Blind test : la musique d'attente entre à la fin du générique court (4,8 s). */
    const val BT_ATTENTE_APRES_GENERIQUE = 4_500L
    /** Duel des robots : la boucle western prend le relais à la fin de son début (gs_duel_intro_debut, 2,95 s). */
    const val DUEL_INTRO_BOUCLE = 2_946L
    /** Après deux mesures au niveau du générique, la musique du salon redescend doucement à son volume de fond. */
    const val GENERIQUE_FIN = 12_000L
    const val FONDU_DESCENTE = 3_000L
    /** Box qui charge encore ses sons ou reste muette : l'animation du générique n'attend jamais plus que ça. */
    const val GENERIQUE_ATTENTE_MAX = 2_500L
    /** Durée de l'animation du générique sur le salon. */
    const val GENERIQUE_ANIMATION = 9_000L
    const val QUESTION_MUSIQUE_APRES_MANCHE = 1_500L
    const val PROPOSITIONS_DEBUT = 350L
    const val PROPOSITIONS_PAS = 150L
    const val REVELATION_ETEINT = 1_000L
    const val REVELATION_ETEINT_PAS = 250L
    const val REVELATION_OR = 2_000L
    const val REVELATION_TAMPON = 2_500L
    const val REVELATION_TAMPON_PAS = 200L
    const val REVELATION_POINTS = 3_000L
    /** Juste Chiffre du Game Show : tampons et points tombent avec le « +100 » de la règle des écarts, pas avant. */
    const val JUSTE_GS_RETARD = 3_750L
    const val CLASSEMENT_COMPTEUR = 300L
    const val CLASSEMENT_COURONNE = 1_800L
    /** Grand gagnant : 7 s de suspense (lmp_roulement_final), puis l'impact ; jingle et musique de fête ensuite. */
    const val FIN_VAINQUEUR = 7_000L
    const val FIN_JINGLE = 14_500L
    const val FIN_MUSIQUE = 17_000L
    /**
     * Podium du Game Show (gs_podium) : les jauges montent sur « why don't you play the game », le solo de guitare
     * de Digital Love tombe à [PODIUM_REVELATION] sur le nom du gagnant ; gs_podium s'arrête à [PODIUM_COUPE] (4:07 de
     * la chanson, juste avant la note grave de trop) et [Lit.PODIUM_ATTENTE] enchaîne pile là (cedric, 29/10).
     */
    const val PODIUM_REVELATION = 15_444L
    const val PODIUM_COUPE = 50_089L
    /** « ▶ Lancer la fin » : la boucle d'attente du podium s'éteint doucement sous le fondu de l'outro. */
    const val FONDU_LANCER_FIN = 1_500L
    /** [Ordre.Enchainer] relit la position du son ce temps-là avant l'enchaînement. */
    const val ENCHAINER_AVANT = 1_500L
    const val FONDU_AU_REVOIR = 2_000L
    /** Coup de cuivres du « Top départ » des mimes, après les deux coups de sifflet. */
    const val MIME_TOP_IMPACT = 500L
    const val MIME_BILAN = 1_000L
    const val MIME_BILAN_MUSIQUE = 2_500L
    /** Jingle de changement de jeu : le logo aux cuivres tombe à 750 ms, l'animation y pose le nom du jeu. */
    const val TRANSITION_IMPACT = 750L
    /** Image floue : la note de l'équipe juste après le gros buzz, puis le suspense pendant sa réponse. */
    const val FLOU_EQUIPE = 300L
    const val FLOU_SUSPENSE = 900L
    const val FLOU_REPRISE = 600L
    /** Jeux au buzzer : applaudissements et musique de fête juste après la réponse. */
    const val BUZZ_BRAVO = 400L
    /** Blind test : la fête attend la fin de l'outro. */
    const val BT_OUTRO_MUSIQUE = 4_000L

    const val TRANSITION_MUSIQUE = 2_000L
    /** Durée du rideau plein écran qui annonce un nouveau jeu (assez court pour ne pas retarder la fête). */
    const val TRANSITION_RIDEAU = 2_600L
    const val PAUSE_MUSIQUE = 1_500L

    /** Vrai ou Faux express : la révélation ne dure que 3,5 s, tout tombe tout de suite. */
    const val EXPRESS_ETEINT = 100L
    const val EXPRESS_OR = 300L
    const val EXPRESS_TAMPON = 600L
    const val EXPRESS_TAMPON_PAS = 120L
    const val EXPRESS_POINTS = 900L

    fun propositionApparait(k: Int) = PROPOSITIONS_DEBUT + k * PROPOSITIONS_PAS
    fun mauvaiseSEteint(k: Int, express: Boolean = false) = if (express) EXPRESS_ETEINT else REVELATION_ETEINT + k * REVELATION_ETEINT_PAS
    fun revelationOr(express: Boolean) = if (express) EXPRESS_OR else REVELATION_OR
    fun tampon(k: Int, express: Boolean = false) =
        if (express) EXPRESS_TAMPON + k * EXPRESS_TAMPON_PAS else REVELATION_TAMPON + k * REVELATION_TAMPON_PAS
}

/**
 * Vitesse de lecture d'un son long de [dureeFichierMs] qui doit durer [etireSurMs] : ralenti jusqu'à [VITESSE_MIN] au
 * plus, jamais accéléré (un chrono plus court le coupe à la fin, comme avant).
 */
internal fun vitesseEtiree(dureeFichierMs: Int, etireSurMs: Long): Float =
    if (dureeFichierMs <= 0 || etireSurMs <= dureeFichierMs) 1f
    else (dureeFichierMs.toFloat() / etireSurMs).coerceAtLeast(VITESSE_MIN)

/** Un son étiré ne descend pas sous cette vitesse : au-delà, il deviendrait pâteux. */
internal const val VITESSE_MIN = 0.6f
/** gs_podium_attente : l'écho et la descente durent 11,54 s, puis la boucle pure (8 mesures) tourne depuis là. */
internal const val PODIUM_ATTENTE_REPRISE_MS = 11_540L

/** Simon : musique sous les notes des boules (avant le 28/10 au soir : 0,84 et 0,55, les notes s'y perdaient). */
internal const val SIMON_MUSIQUE_SUITE = 0.6f
internal const val SIMON_MUSIQUE_FORT = 0.42f
