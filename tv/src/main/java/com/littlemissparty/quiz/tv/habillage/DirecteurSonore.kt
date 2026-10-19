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
        if (i.ecran == Ecran.SALON && i.index < 0 && generiques.add(i.partie)) return generique()
        return listOf(Ordre.Musique(ambiance(i)))
    }

    /**
     * Générique puis musique du salon, sans blanc : la boucle repart de sa première mesure sur le temps fort qui
     * suit la dernière note du générique, presque aussi fort, puis redescend doucement à son volume de fond.
     */
    private fun generique() = listOf(
        Ordre.Couper,
        Ordre.Musique(Ambiance.SILENCE),
        Ordre.Jouer(Son.GENERIQUE),
        Ordre.Caler(Tempo.GENERIQUE_RELAIS),
        Ordre.Musique(Ambiance.SALON_ARRIVEE, Tempo.GENERIQUE_RELAIS, Tempo.FONDU_RELAIS),
        Ordre.Musique(Ambiance.SALON, Tempo.GENERIQUE_FIN, Tempo.FONDU_DESCENTE),
    )

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
            Ecran.SALON -> if (i.index < 0 && generiques.add(i.partie)) return generique() else {
                o += Ordre.Jouer(Son.WHOOSH)
                o += Ordre.Musique(Ambiance.SALON)
            }
            Ecran.QUESTION -> {
                // Le Vrai ou Faux express garde sa musique nerveuse d'un bout à l'autre de la série.
                val musique = ambiance(i)
                if (i.musical) {
                    // La chanson part dès l'ouverture : aucun jingle par-dessus (le rideau, lui, passe quand même).
                    o += Ordre.Musique(Ambiance.SILENCE)
                    // Blind test : son générique court à la présentation, un éclat de cuivres au passage en points doublés.
                    if (i.blindPresentation) o += Ordre.Jouer(Son.BT_GENERIQUE)
                    if (i.blind && i.blindDouble && !p.blindDouble) o += Ordre.Jouer(Son.BT_DOUBLE)
                } else if (nouvelleEpreuve) {
                    o += Ordre.Jouer(Son.TRANSITION)
                    o += Ordre.Musique(Ambiance.SILENCE)
                    o += Ordre.Musique(musique, Tempo.TRANSITION_MUSIQUE)
                } else if (i.superFinale && !p.superFinale) {
                    // Les dernières questions du quiz passent à points ×2 : un éclat « points doublés », une seule fois.
                    // Ce n'est pas un nouveau jeu : ni rideau ni jingle de manche.
                    o += Ordre.Jouer(Son.BT_DOUBLE)
                    o += Ordre.Musique(Ambiance.SILENCE)
                    o += Ordre.Musique(musique, Tempo.QUESTION_MUSIQUE_APRES_MANCHE)
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
                if (i.flou || i.zoom) o += Ordre.Jouer(Son.FLOU_MONTEE, Tempo.PROPOSITIONS_DEBUT)
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
                if (!i.express) o += Ordre.Musique(Ambiance.SUSPENSE)
            }
            Ecran.REVELATION -> if (i.nombre) {
                // Le Juste Chiffre : les chiffres défilent et se posent sur l'or ; fanfare si une équipe tombe pile.
                o += Ordre.Musique(Ambiance.SILENCE)
                o += Ordre.Jouer(Son.CHIFFRE_ROULETTE)
                o += Ordre.Jouer(if (i.pile) Son.CHIFFRE_PILE else Son.BONNE_REPONSE, Tempo.REVELATION_OR)
                o += Ordre.Jouer(Son.IMPACT, Tempo.REVELATION_OR)
                o += Ordre.Musique(Ambiance.FETE, Tempo.REVELATION_OR)
                for (k in 0 until i.gagnants.coerceIn(0, 8)) o += Ordre.Jouer(Son.TAMPON, Tempo.tampon(k))
                if (i.gagnants > 0) o += Ordre.Jouer(Son.POINTS, Tempo.REVELATION_POINTS)
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
                o += Ordre.Musique(Ambiance.FETE, Tempo.BT_OUTRO_MUSIQUE)
            } else {
                o += Ordre.Jouer(Son.WHOOSH)
                o += Ordre.Jouer(Son.COMPTEUR, Tempo.CLASSEMENT_COMPTEUR)
                if (i.meneurAPoints) o += Ordre.Jouer(Son.COURONNE, Tempo.CLASSEMENT_COURONNE)
                o += Ordre.Musique(Ambiance.FETE)
            }
            Ecran.FIN -> {
                o += Ordre.Musique(Ambiance.SILENCE)
                o += Ordre.Jouer(Son.ROULEMENT_LONG)
                o += Ordre.Jouer(Son.MONTEE)
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
        if (i.equipes > p.equipes) o += Ordre.Jouer(Son.equipe(i.equipes - 1))
        // Buzzer de l'accueil, pour s'amuser : chaque appui fait le bruit rigolo de l'équipe, autant de fois qu'elle veut.
        if (i.buzzs > p.buzzs && i.buzzeur >= 0) o += Ordre.Jouer(Son.rigolo(i.buzzeur))
        // Bip, bip, bip : chacune des cinq dernières secondes du chrono, le dernier plus aigu. Jamais pendant qu'une
        // équipe répond après un buzz (le chrono est figé), en express (trop court) ni quand tout le monde a répondu.
        if ((i.ecran == Ecran.QUESTION || i.ecran == Ecran.MIMES_TOUR) && i.decompte in 1..5 && i.decompte != p.decompte &&
            !i.enPause && !i.express && i.buzzEquipe < 0 && !tousOntRepondu(i)
        ) o += Ordre.Jouer(if (i.decompte == 1) Son.BIP_FIN else Son.BIP)
        if (i.ecran == Ecran.QUESTION) {
            if (i.reponses > p.reponses) o += Ordre.Jouer(Son.REPONSE)
            // La tension des 5 dernières secondes s'arrête quand le temps repart ou que tout le monde a répondu.
            // Pas de tension en express : le chrono entier ne dure que quelques secondes.
            // Pas de tension dans les jeux au buzzer : le buzz et le suspense de la réponse en tiennent lieu.
            val enTension = p.urgent && !tousOntRepondu(p) && !p.express && !p.jeuBuzz && !p.musical
            val tension = i.urgent && !tousOntRepondu(i) && !i.express && !i.jeuBuzz && !i.musical
            if (tension && !enTension && !p.urgent) o += Ordre.Jouer(Son.TENSION)
            if (enTension && !tension) o += Ordre.Arreter(Son.TENSION)
            if (i.jeuBuzz || i.blind) o += buzzJeu(p, i)
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
            // Statues musicales : « gel ! » quand la musique s'arrête, petit élan quand elle repart.
            if (i.statue && !p.statue) o += Ordre.Jouer(Son.STATUE_GEL)
            if (!i.statue && p.statue) o += Ordre.Jouer(Son.STATUE_REPART)
        }
        // Blind test : Sarah raccourcit la révélation, la fanfare s'arrête.
        if (i.ecran == Ecran.REVELATION && i.blind && i.blindCoupe && !p.blindCoupe) o += Ordre.Couper
        if (i.ecran == Ecran.MIMES_TOUR) {
            if (i.trouves > p.trouves) o += Ordre.Jouer(if (i.pictionary) Son.PICTIO_TROUVE else Son.MIME_TROUVE)
            if (i.passes > p.passes) o += Ordre.Jouer(Son.MIME_PASSE)
            // Dix dernières secondes du tour : la musique s'efface sous la tension.
            if (i.urgent && !p.urgent) {
                o += Ordre.Jouer(Son.MIME_TENSION)
                o += Ordre.Musique(Ambiance.SUSPENSE)
            }
            if (p.urgent && !i.urgent) {
                o += Ordre.Arreter(Son.MIME_TENSION)
                o += Ordre.Musique(Ambiance.MIMES)
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
        // Jamais moqueur : un petit « pouet » gentil quand une équipe s'est trompée.
        if ((nouveauBuzz || repart) && i.ratees > p.ratees) o += Ordre.Jouer(Son.VF_FAUX)
        if (nouveauBuzz && i.blind) {
            // Blind test : le disque freine, « BWAP » de cuivres, la note de l'équipe, puis l'attente feutrée.
            o += Ordre.Musique(Ambiance.SILENCE)
            o += Ordre.Jouer(Son.BT_BUZZ)
            o += Ordre.Jouer(Son.equipe(i.buzzEquipe), Tempo.FLOU_EQUIPE)
            o += Ordre.Jouer(Son.BT_ATTENTE, Tempo.BT_ATTENTE_DEBUT)
        } else if (nouveauBuzz) {
            // Quiz musical : le disque s'arrête net (scratch) au moment du buzz.
            if (i.musical) o += Ordre.Jouer(Son.BT_SCRATCH)
            o += Ordre.Musique(Ambiance.SILENCE)
            o += Ordre.Jouer(Son.BUZZ_GROS)
            o += Ordre.Jouer(Son.equipe(i.buzzEquipe), Tempo.FLOU_EQUIPE)
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
        Ecran.QUESTION, Ecran.VERROUILLEE, Ecran.REVELATION -> when {
            i.express -> Ambiance.EXPRESS
            // Extrait musical : rien ne doit couvrir la chanson.
            i.musical && i.ecran != Ecran.VERROUILLEE -> Ambiance.SILENCE
            // Image floue : musique en retrait pendant que l'image se précise, silence pendant qu'une équipe répond.
            // Qui a disparu ? : musique douce pour mémoriser, presque rien pendant le tour de magie.
            i.disparu == DISPARU_MEMORISER && i.ecran == Ecran.QUESTION -> Ambiance.MEMOIRE
            i.disparu == DISPARU_MAGIE && i.ecran == Ecran.QUESTION -> Ambiance.ENVOUTEMENT
            i.jeuBuzz && i.ecran == Ecran.QUESTION -> if (i.buzzEquipe >= 0) Ambiance.SILENCE else Ambiance.SUSPENSE
            // Zoom mystère : musique en retrait sous la montée, comme l'Image floue.
            i.zoom && i.ecran == Ecran.QUESTION -> Ambiance.SUSPENSE
            else -> ambianceParDefaut(i.ecran)
        }
        else -> ambianceParDefaut(i.ecran)
    }

    private fun ambianceParDefaut(e: Ecran) = when (e) {
        Ecran.HORS_PARTIE -> Ambiance.SILENCE
        Ecran.SALON -> Ambiance.SALON
        Ecran.QUESTION -> Ambiance.QUESTION
        Ecran.MIMES -> Ambiance.MIMES_ENTRE
        Ecran.MIMES_TOUR -> Ambiance.MIMES
        Ecran.VERROUILLEE -> Ambiance.SUSPENSE
        Ecran.REVELATION, Ecran.CLASSEMENT, Ecran.FIN -> Ambiance.FETE
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
    /** Jeu en cours (« quiz|Manche 1 », « mimes|… ») ; vide hors des questions. */
    val epreuve: String = "",
    /** Vrai ou Faux express (et la bonne réponse est « Vrai »), Zoom mystère. */
    val express: Boolean = false,
    val reponseVraie: Boolean = false,
    val zoom: Boolean = false,
    /**
     * Jeux au buzzer (Image floue, Chante le mot, Qui suis-je) : place de l'équipe qui a buzzé et attend le
     * verdict (-1 sinon), équipes déjà ratées, indices de Qui suis-je déjà affichés.
     */
    val jeuBuzz: Boolean = false,
    /** La question fait entendre un extrait musical (blind test, quiz musical) : l'habillage se tait. */
    val musical: Boolean = false,
    /** Statues musicales : la musique du jeu est arrêtée, tout le monde se fige. */
    val statue: Boolean = false,
    val flou: Boolean = false,
    val chante: Boolean = false,
    val indices: Int = 0,
    val buzzEquipe: Int = -1,
    val ratees: Int = 0,
    /**
     * Blind test : question du blind test, présentation du premier morceau (avant la première écoute),
     * chanson en cours de lecture, points doublés, révélation raccourcie par la régie, bilan de fin de manche.
     */
    val blind: Boolean = false,
    val blindPresentation: Boolean = false,
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
)

const val DISPARU_MEMORISER = 1
const val DISPARU_MAGIE = 2
const val DISPARU_CHERCHER = 3
const val DISPARU_REPONSE = 4

/** [MIMES] : manche de mimes entre deux tours ; [MIMES_TOUR] : une équipe mime. */
enum class Ecran { HORS_PARTIE, SALON, QUESTION, MIMES, MIMES_TOUR, VERROUILLEE, REVELATION, CLASSEMENT, FIN }

/** Les boucles musicales de 16 s (8 mesures à 120 BPM), toujours calées sur le même tempo. */
enum class Lit(val fichier: String) {
    COMPLET("lmp_bed_full"),
    LEGER("lmp_bed_light"),
    MIMES("lmp_bed_mimes"),
    PAUSE("lmp_bed_pause"),
    EXPRESS("lmp_bed_express"),
    MAGIE("lmp_bed_magie"),
}

/** Fond musical : le volume de chaque boucle selon l'ambiance (fondu enchaîné de l'une à l'autre). */
enum class Ambiance(
    private val complete: Float = 0f,
    private val legere: Float = 0f,
    private val mimes: Float = 0f,
    private val pause: Float = 0f,
    private val express: Float = 0f,
    private val magie: Float = 0f,
) {
    SILENCE,
    SALON(complete = 0.55f),
    /** Relais du générique : la musique du salon entre presque aussi fort que lui, avant de redescendre. */
    SALON_ARRIVEE(complete = 0.85f),
    QUESTION(legere = 0.6f),
    SUSPENSE(legere = 0.25f),
    FETE(complete = 0.8f),
    /** Tour de mimes : rythmique latine qui entraîne, sans couvrir les cris de ceux qui devinent. */
    MIMES(mimes = 0.6f),
    /** Entre deux tours de mimes : la même musique, plus bas, pendant qu'on choisit l'équipe suivante. */
    MIMES_ENTRE(mimes = 0.35f),
    /** Pause : musique lounge feutrée, qui tient aussi longtemps qu'il faut. */
    INTERMEDE(pause = 0.5f),
    /** Vrai ou Faux express : course contre la montre, sur toute la série. */
    EXPRESS(express = 0.5f),
    /** Qui a disparu ? : boîte à musique et harpe pendant qu'on mémorise les objets. */
    MEMOIRE(magie = 0.55f),
    /** Qui a disparu ? : le tour de magie, la boîte à musique s'efface sous l'« abracadabra ». */
    ENVOUTEMENT(magie = 0.18f);

    fun volume(l: Lit) = when (l) {
        Lit.COMPLET -> complete
        Lit.LEGER -> legere
        Lit.MIMES -> mimes
        Lit.PAUSE -> pause
        Lit.EXPRESS -> express
        Lit.MAGIE -> magie
    }
}

/** Les sons de l'habillage ; [fichier] est le nom dans res/raw. Les longs passent par un lecteur dédié. */
enum class Son(val fichier: String, val long: Boolean = false) {
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
    POP_1("lmp_pop_1"), POP_2("lmp_pop_2"), POP_3("lmp_pop_3"), POP_4("lmp_pop_4"),
    MIME_TOP("lmp_mime_go", true),
    MIME_TROUVE("lmp_mime_found"),
    MIME_PASSE("lmp_mime_pass"),
    MIME_TENSION("lmp_mime_tension", true),
    MIME_FIN("lmp_mime_time_up", true),
    PAUSE("lmp_pause_in", true),
    TRANSITION("lmp_transition", true),
    CHIFFRE_ROULETTE("lmp_chiffre_roulette", true),
    CHIFFRE_PILE("lmp_chiffre_pile", true),
    VF_VRAI("lmp_vf_vrai"),
    VF_FAUX("lmp_vf_faux"),
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
    BT_ATTENTE("lmp_bt_attente", true),
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
    EQUIPE_1("lmp_team_sting_1"), EQUIPE_2("lmp_team_sting_2"), EQUIPE_3("lmp_team_sting_3"), EQUIPE_4("lmp_team_sting_4");

    companion object {
        private val pops = listOf(POP_1, POP_2, POP_3, POP_4)
        private val equipes = listOf(EQUIPE_1, EQUIPE_2, EQUIPE_3, EQUIPE_4)
        private val rigolos = listOf(RIGOLO_1, RIGOLO_2, RIGOLO_3, RIGOLO_4)
        fun pop(k: Int) = pops[Math.floorMod(k, pops.size)]
        fun equipe(place: Int) = equipes[Math.floorMod(place, equipes.size)]
        fun rigolo(place: Int) = rigolos[Math.floorMod(place, rigolos.size)]
    }
}

sealed interface Ordre {
    data class Jouer(val son: Son, val dansMs: Long = 0) : Ordre
    data class Musique(val ambiance: Ambiance, val dansMs: Long = 0, val fonduMs: Long = Tempo.FONDU_MUSIQUE) : Ordre
    /** Les boucles musicales repartent du début de leur première mesure (relais calé sur le générique). */
    data class Caler(val dansMs: Long = 0) : Ordre
    data class Arreter(val son: Son) : Ordre
    /** Un son long mis en sourdine (par [Couper]) repart là où il s'était arrêté, en fondu. */
    data class Reprendre(val son: Son, val dansMs: Long = 0) : Ordre
    /** Annule les sons prévus et fait taire les sons longs en cours (changement d'écran, pause). */
    data object Couper : Ordre

    fun decale(ms: Long): Ordre = when (this) {
        is Jouer -> copy(dansMs = dansMs + ms)
        is Musique -> copy(dansMs = dansMs + ms)
        is Caler -> copy(dansMs = dansMs + ms)
        is Reprendre -> copy(dansMs = dansMs + ms)
        else -> this
    }
}

/** Minutage partagé par les sons et les animations, pour qu'image et son tombent ensemble (120 BPM, un temps = 500 ms). */
object Tempo {
    const val TEMPS = 500L
    /** Fondu enchaîné ordinaire d'une ambiance musicale à l'autre. */
    const val FONDU_MUSIQUE = 700L
    /** Temps fort qui suit la dernière note du générique (16 temps) : la musique du salon prend le relais. */
    const val GENERIQUE_RELAIS = 8_000L
    const val FONDU_RELAIS = 120L
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
    const val CLASSEMENT_COMPTEUR = 300L
    const val CLASSEMENT_COURONNE = 1_800L
    const val FIN_VAINQUEUR = 2_000L
    const val FIN_JINGLE = 9_500L
    const val FIN_MUSIQUE = 12_000L
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
    /** Blind test : l'attente feutrée démarre sous la fin du « BWAP » ; la fête attend la fin de l'outro. */
    const val BT_ATTENTE_DEBUT = 1_500L
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
