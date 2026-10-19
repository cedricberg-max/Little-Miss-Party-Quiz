package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Les sons d'une partie : jamais en double, jamais pendant une pause, jamais de générique en pleine partie. */
class DirecteurSonoreTest {

    private val salon = Instant(Ecran.SALON, partie = "ABCD", equipes = 0)
    private val q1 = Instant(Ecran.QUESTION, partie = "ABCD", index = 0, equipes = 2, premiere = true)
    private val q2 = q1.copy(index = 1, premiere = false)

    private fun List<Ordre>.sons() = filterIsInstance<Ordre.Jouer>().map { it.son }
    private fun List<Ordre>.musique() = filterIsInstance<Ordre.Musique>().lastOrNull()?.ambiance

    @Test
    fun `le generique se joue une seule fois par partie, puis la musique du salon`() {
        val d = DirecteurSonore()
        val o = d.observer(salon)
        assertEquals(listOf(Son.GENERIQUE), o.sons())
        assertEquals(Ambiance.SALON, o.musique())
        // Pas de blanc entre le générique et le salon : la boucle repart de sa première mesure sur le temps fort
        // qui suit la dernière note (16 temps), presque aussi fort, puis redescend en douceur.
        assertTrue(Ordre.Caler(Tempo.GENERIQUE_RELAIS) in o)
        val musiques = o.filterIsInstance<Ordre.Musique>()
        val relais = musiques.first { it.ambiance == Ambiance.SALON_ARRIVEE }
        assertEquals(Tempo.GENERIQUE_RELAIS, relais.dansMs)
        assertEquals(16 * Tempo.TEMPS, relais.dansMs)
        assertTrue(relais.fonduMs <= 200)
        assertTrue(musiques.last().dansMs > relais.dansMs && musiques.last().fonduMs >= 2_000)
        assertTrue(d.observer(salon).isEmpty())
        // La box perd la partie puis la retrouve : pas de second générique.
        d.observer(Instant(Ecran.HORS_PARTIE))
        val retour = d.observer(salon)
        assertFalse(Son.GENERIQUE in retour.sons())
        assertEquals(Ambiance.SALON, retour.musique())
    }

    @Test
    fun `une box qui redemarre en pleine partie reprend la musique sans generique`() {
        val o = DirecteurSonore().observer(q2.copy(reponses = 1))
        assertEquals(listOf(Ordre.Musique(Ambiance.QUESTION)), o)
    }

    @Test
    fun `une nouvelle partie rejoue le generique`() {
        val d = DirecteurSonore()
        d.observer(salon)
        d.observer(Instant(Ecran.FIN, partie = "ABCD", index = 10))
        assertTrue(Son.GENERIQUE in d.observer(salon.copy(partie = "WXYZ")).sons())
    }

    @Test
    fun `le son d'arrivee d'une equipe seulement quand une equipe arrive`() {
        val d = DirecteurSonore()
        d.observer(salon)
        assertEquals(listOf(Son.EQUIPE_1), d.observer(salon.copy(equipes = 1)).sons())
        assertEquals(listOf(Son.EQUIPE_2), d.observer(salon.copy(equipes = 2)).sons())
        assertTrue(d.observer(salon.copy(equipes = 2)).isEmpty())
        assertTrue(d.observer(salon.copy(equipes = 1)).isEmpty())
    }

    @Test
    fun `premiere question annoncee, les suivantes enchainees, une bulle par proposition`() {
        val d = DirecteurSonore()
        d.observer(salon)
        val premiere = d.observer(q1)
        assertEquals(Ordre.Couper, premiere.first())
        assertTrue(Son.MANCHE in premiere.sons())
        assertEquals(4, premiere.sons().count { it.name.startsWith("POP") })
        assertEquals(Ambiance.QUESTION, premiere.musique())
        val suivante = d.observer(q2.copy(propositions = 2))
        assertFalse(Son.MANCHE in suivante.sons())
        assertTrue(Son.WHOOSH in suivante.sons())
        assertEquals(2, suivante.sons().count { it.name.startsWith("POP") })
    }

    @Test
    fun `les dernieres questions a points doubles ne sonnent pas comme un nouveau jeu`() {
        val d = DirecteurSonore()
        d.observer(salon)
        d.observer(q1)
        d.observer(q2)
        // Passage aux points ×2 : un éclat « points doublés », une seule fois, sans jingle de manche ni transition.
        val bascule = d.observer(q2.copy(index = 8, superFinale = true)).sons()
        assertTrue(Son.BT_DOUBLE in bascule)
        assertFalse(Son.MANCHE in bascule || Son.TRANSITION in bascule)
        // Les questions ×2 suivantes s'enchaînent comme les autres.
        val suivante = d.observer(q2.copy(index = 9, superFinale = true)).sons()
        assertTrue(Son.WHOOSH in suivante)
        assertFalse(Son.BT_DOUBLE in suivante || Son.MANCHE in suivante)
    }

    @Test
    fun `un tic par reponse recue, rien si rien ne change`() {
        val d = DirecteurSonore()
        d.observer(q2)
        assertEquals(listOf(Son.REPONSE), d.observer(q2.copy(reponses = 1)).sons())
        assertTrue(d.observer(q2.copy(reponses = 1)).isEmpty())
    }

    @Test
    fun `la tension des 5 dernieres secondes ne part qu'une fois et s'arrete quand tout le monde a repondu`() {
        val d = DirecteurSonore()
        d.observer(q2)
        assertEquals(listOf(Son.TENSION), d.observer(q2.copy(urgent = true)).sons())
        assertTrue(d.observer(q2.copy(urgent = true)).isEmpty())
        val o = d.observer(q2.copy(urgent = true, reponses = 2))
        assertTrue(Ordre.Arreter(Son.TENSION) in o)
        assertTrue(d.observer(q2.copy(urgent = true, reponses = 2)).isEmpty())
    }

    @Test
    fun `pas de tension si tout le monde a deja repondu`() {
        val d = DirecteurSonore()
        d.observer(q2.copy(reponses = 2))
        assertTrue(d.observer(q2.copy(reponses = 2, urgent = true)).sons().isEmpty())
    }

    @Test
    fun `la pause coupe tout, carillon puis musique d'intermede, et la reprise compte 3 2 1`() {
        val d = DirecteurSonore()
        d.observer(q2.copy(urgent = true))
        val pause = d.observer(q2.copy(enPause = true))
        assertEquals(Ordre.Couper, pause.first())
        assertEquals(listOf(Son.PAUSE), pause.sons())
        assertEquals(Ordre.Musique(Ambiance.INTERMEDE, Tempo.PAUSE_MUSIQUE), pause.last())
        // Une réponse ou une équipe pendant la pause ne fait aucun bruit.
        assertTrue(d.observer(q2.copy(enPause = true, reponses = 1, equipes = 3)).isEmpty())
        val reprise = d.observer(q2.copy(reponses = 1, equipes = 3, repriseDansMs = 3_000))
        val pops = reprise.filterIsInstance<Ordre.Jouer>().filter { it.son.name.startsWith("POP") }
        assertEquals(listOf(0L, 1_000L, 2_000L), pops.map { it.dansMs })
        assertTrue(Ordre.Jouer(Son.WHOOSH, 3_000) in reprise)
        assertEquals(Ordre.Musique(Ambiance.QUESTION, 3_000), reprise.last())
        // Un seul Couper, en tête : il fait taire le carillon et annule la musique d'intermède encore prévue.
        assertEquals(Ordre.Couper, reprise.first())
        assertEquals(1, reprise.count { it == Ordre.Couper })
    }

    @Test
    fun `une box qui se reconnecte pendant la pause remet la musique d'intermede, sans carillon`() {
        assertEquals(listOf(Ordre.Musique(Ambiance.INTERMEDE)), DirecteurSonore().observer(q2.copy(enPause = true)))
    }

    @Test
    fun `si l'ecran a change pendant la pause, son entree est jouee apres le decompte`() {
        val d = DirecteurSonore()
        d.observer(q2)
        d.observer(q2.copy(enPause = true))
        val reprise = d.observer(Instant(Ecran.VERROUILLEE, partie = "ABCD", index = 1, equipes = 2, repriseDansMs = 3_000))
        assertTrue(Ordre.Jouer(Son.VERROU, 3_000) in reprise)
        assertEquals(Ambiance.SUSPENSE, reprise.musique())
    }

    @Test
    fun `revelation dans l'ordre et en rythme`() {
        val d = DirecteurSonore()
        d.observer(Instant(Ecran.VERROUILLEE, partie = "ABCD", index = 1, equipes = 3))
        val o = d.observer(Instant(Ecran.REVELATION, partie = "ABCD", index = 1, equipes = 3, gagnants = 2))
        val jouer = o.filterIsInstance<Ordre.Jouer>()
        assertEquals(3, jouer.count { it.son == Son.ETEINT })
        assertEquals(2, jouer.count { it.son == Son.TAMPON })
        assertEquals(Tempo.REVELATION_OR, jouer.single { it.son == Son.BONNE_REPONSE }.dansMs)
        assertTrue(jouer.filter { it.son == Son.ETEINT }.all { it.dansMs < Tempo.REVELATION_OR })
        assertTrue(jouer.filter { it.son == Son.TAMPON }.all { it.dansMs > Tempo.REVELATION_OR })
        assertTrue(Son.POINTS in o.sons())
        // Personne n'a marqué : ni tampon ni points.
        val d2 = DirecteurSonore()
        d2.observer(Instant(Ecran.VERROUILLEE, partie = "ABCD", index = 1))
        val vide = d2.observer(Instant(Ecran.REVELATION, partie = "ABCD", index = 1, gagnants = 0)).sons()
        assertFalse(Son.TAMPON in vide || Son.POINTS in vide)
    }

    @Test
    fun `classement avec couronne seulement si le premier a des points`() {
        val d = DirecteurSonore()
        d.observer(q2)
        assertFalse(Son.COURONNE in d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 1)).sons())
        d.observer(q2.copy(index = 2))
        assertTrue(Son.COURONNE in d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 2, meneurAPoints = true)).sons())
    }

    @Test
    fun `la victoire finale une seule fois`() {
        val d = DirecteurSonore()
        d.observer(q2)
        val fin = Instant(Ecran.FIN, partie = "ABCD", index = 1)
        val o = d.observer(fin)
        assertEquals(1, o.sons().count { it == Son.FANFARE })
        assertTrue(Son.FIN in o.sons())
        assertTrue(d.observer(fin).isEmpty())
    }

    @Test
    fun `buzzer de l'accueil, chaque appui fait sonner l'equipe, jamais deux fois le meme appui`() {
        val d = DirecteurSonore()
        val salon = Instant(Ecran.SALON, partie = "ABCD", equipes = 2)
        d.observer(salon)
        assertEquals(listOf(Son.RIGOLO_2), d.observer(salon.copy(buzzeur = 1, buzzs = 1)).sons())
        assertTrue(d.observer(salon.copy(buzzeur = 1, buzzs = 1)).isEmpty())
        assertEquals(listOf(Son.RIGOLO_1), d.observer(salon.copy(buzzeur = 0, buzzs = 2)).sons())
        assertEquals(listOf(Son.RIGOLO_1), d.observer(salon.copy(buzzeur = 0, buzzs = 3)).sons())
    }

    private val mimes = Instant(Ecran.MIMES, partie = "ABCD", index = 3, equipes = 2)
    private val tour = mimes.copy(ecran = Ecran.MIMES_TOUR)

    @Test
    fun `manche de mimes annoncee, top depart, puis un son par mime trouve ou passe`() {
        val d = DirecteurSonore()
        d.observer(q2)
        val ouverture = d.observer(mimes)
        assertEquals(listOf(Son.MANCHE, Son.IMPACT), ouverture.sons())
        assertEquals(Ambiance.MIMES_ENTRE, ouverture.musique())
        val top = d.observer(tour)
        assertEquals(listOf(Son.MIME_TOP), top.sons())
        assertEquals(Ordre.Musique(Ambiance.MIMES, Tempo.MIME_TOP_IMPACT), top.filterIsInstance<Ordre.Musique>().last())
        assertEquals(listOf(Son.MIME_TROUVE), d.observer(tour.copy(trouves = 1)).sons())
        assertEquals(listOf(Son.MIME_PASSE), d.observer(tour.copy(trouves = 1, passes = 1)).sons())
        // La même carte montrée deux fois (reconnexion de la régie, rafraîchissement) ne rejoue rien.
        assertTrue(d.observer(tour.copy(trouves = 1, passes = 1)).isEmpty())
    }

    @Test
    fun `tension des 10 dernieres secondes une seule fois, coupee par la fin du tour`() {
        val d = DirecteurSonore()
        d.observer(tour)
        val tension = d.observer(tour.copy(urgent = true))
        assertEquals(listOf(Son.MIME_TENSION), tension.sons())
        assertEquals(Ambiance.SUSPENSE, tension.musique())
        assertTrue(d.observer(tour.copy(urgent = true)).isEmpty())
        val fin = d.observer(mimes.copy(urgent = false))
        assertEquals(Ordre.Couper, fin.first())
        assertEquals(Son.MIME_FIN, fin.sons().first())
    }

    @Test
    fun `fin de tour applaudie seulement si l'equipe a trouve`() {
        val d = DirecteurSonore()
        d.observer(tour.copy(trouves = 2))
        assertTrue(Son.APPLAUDISSEMENTS in d.observer(mimes).sons())
        d.observer(tour)
        val rate = d.observer(mimes)
        assertEquals(listOf(Son.MIME_FIN), rate.sons())
        assertEquals(Ambiance.MIMES_ENTRE, rate.musique())
    }

    @Test
    fun `pause pendant un tour de mimes puis reprise sur la musique du tour`() {
        val d = DirecteurSonore()
        d.observer(tour.copy(trouves = 1))
        assertEquals(listOf(Son.PAUSE), d.observer(tour.copy(trouves = 1, enPause = true)).sons())
        val reprise = d.observer(tour.copy(trouves = 1, repriseDansMs = 3_000))
        assertFalse(Son.MIME_TROUVE in reprise.sons())
        assertEquals(Ordre.Musique(Ambiance.MIMES, 3_000), reprise.filterIsInstance<Ordre.Musique>().last())
    }

    private val dessin = tour.copy(pictionary = true)
    private val entreDessins = mimes.copy(pictionary = true)

    @Test
    fun `pictionary - top depart au crayon, trouve une seule fois, sifflet si le temps s'ecoule`() {
        val d = DirecteurSonore()
        d.observer(entreDessins)
        assertEquals(listOf(Son.PICTIO_TOP), d.observer(dessin).sons())
        // La régie valide « Trouvé ! » et finit le tour d'un coup : le « Trouvé ! » sonne à la fin du tour.
        val fin = d.observer(entreDessins.copy(pictioTrouve = true))
        assertEquals(listOf(Son.PICTIO_TROUVE, Son.APPLAUDISSEMENTS), fin.sons())
        assertTrue(d.observer(entreDessins.copy(pictioTrouve = true)).isEmpty())
        // Trouvé pendant le tour, puis fin du tour : pas de second « Trouvé ! ».
        d.observer(dessin)
        assertEquals(listOf(Son.PICTIO_TROUVE), d.observer(dessin.copy(trouves = 1)).sons())
        assertEquals(listOf(Son.APPLAUDISSEMENTS), d.observer(entreDessins.copy(pictioTrouve = true)).sons())
        // Temps écoulé : le sifflet, ni « Trouvé ! » ni applaudissements.
        d.observer(dessin)
        val rate = d.observer(entreDessins)
        assertEquals(listOf(Son.MIME_FIN), rate.sons())
        assertEquals(Ambiance.MIMES_ENTRE, rate.musique())
    }

    private val quizM1 = q1.copy(epreuve = "quiz|Manche 1")
    private val mimesM = mimes.copy(epreuve = "mimes|Les mimes")

    @Test
    fun `passage du quiz aux mimes annonce par le jingle de transition, une seule fois`() {
        val d = DirecteurSonore()
        d.observer(salon)
        // La première question du premier jeu garde son annonce habituelle.
        assertEquals(listOf(Son.MANCHE, Son.IMPACT), d.observer(quizM1).sons().take(2))
        d.observer(quizM1.copy(index = 1, premiere = false))
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 1, equipes = 2))
        val arrivee = d.observer(mimesM.copy(index = 2))
        assertEquals(listOf(Son.TRANSITION), arrivee.sons())
        assertFalse(Son.MANCHE in arrivee.sons())
        assertEquals(Ordre.Musique(Ambiance.MIMES_ENTRE, Tempo.TRANSITION_MUSIQUE), arrivee.last())
        // Les tours de mimes qui suivent sont dans la même épreuve : pas de nouvelle transition.
        assertEquals(listOf(Son.MIME_TOP), d.observer(tour.copy(index = 2, epreuve = mimesM.epreuve)).sons())
        assertFalse(Son.TRANSITION in d.observer(mimesM.copy(index = 2)).sons())
    }

    @Test
    fun `nouvelle manche de quiz annoncee par la transition, puis musique de question`() {
        val d = DirecteurSonore()
        d.observer(quizM1.copy(index = 4, premiere = false))
        val m2 = d.observer(quizM1.copy(index = 5, premiere = false, epreuve = "quiz|Manche 2"))
        assertEquals(Son.TRANSITION, m2.sons().first())
        assertEquals(Ambiance.QUESTION, m2.musique())
        assertFalse(Son.TRANSITION in d.observer(quizM1.copy(index = 6, premiere = false, epreuve = "quiz|Manche 2")).sons())
    }

    @Test
    fun `une box qui se reconnecte en plein jeu ne rejoue pas la transition`() {
        val d = DirecteurSonore()
        assertTrue(d.observer(mimesM).sons().isEmpty())
        assertFalse(Son.TRANSITION in d.observer(tour.copy(epreuve = mimesM.epreuve)).sons())
    }

    @Test
    fun `jeu change pendant la pause, la transition part apres le decompte`() {
        val d = DirecteurSonore()
        d.observer(quizM1.copy(index = 1, premiere = false))
        d.observer(quizM1.copy(index = 1, premiere = false, enPause = true))
        assertTrue(d.observer(mimesM.copy(index = 2, enPause = true)).isEmpty())
        val reprise = d.observer(mimesM.copy(index = 2, repriseDansMs = 3_000))
        assertTrue(Ordre.Jouer(Son.TRANSITION, 3_000) in reprise)
        assertFalse(Son.MANCHE in reprise.sons())
    }

    @Test
    fun `juste chiffre, roulette qui se pose sur l'or, fanfare seulement si une equipe tombe pile`() {
        val d = DirecteurSonore()
        val question = Instant(Ecran.QUESTION, partie = "ABCD", index = 4, equipes = 2, nombre = true, propositions = 0)
        d.observer(question)
        val proche = d.observer(question.copy(ecran = Ecran.REVELATION, gagnants = 1))
        assertEquals(Son.CHIFFRE_ROULETTE, proche.sons().first())
        assertFalse(Son.ROULEMENT_COURT in proche.sons())
        assertTrue(Ordre.Jouer(Son.BONNE_REPONSE, Tempo.REVELATION_OR) in proche)
        assertFalse(Son.CHIFFRE_PILE in proche.sons())
        d.observer(question.copy(index = 5))
        val pile = d.observer(question.copy(index = 5, ecran = Ecran.REVELATION, gagnants = 1, pile = true))
        assertTrue(Ordre.Jouer(Son.CHIFFRE_PILE, Tempo.REVELATION_OR) in pile)
        assertFalse(Son.BONNE_REPONSE in pile.sons())
    }

    @Test
    fun `vrai ou faux express, musique continue, verdict ding ou pouet, ni roulement ni tension`() {
        val d = DirecteurSonore()
        val question = Instant(Ecran.QUESTION, partie = "ABCD", index = 6, equipes = 2, propositions = 2, express = true, reponseVraie = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 5, equipes = 2))
        val entree = d.observer(question)
        assertEquals(Ambiance.EXPRESS, entree.musique())
        assertFalse(Son.TENSION in d.observer(question.copy(urgent = true)).sons())
        val verrou = d.observer(question.copy(ecran = Ecran.VERROUILLEE))
        assertEquals(null, verrou.musique())
        val vrai = d.observer(question.copy(ecran = Ecran.REVELATION, gagnants = 1))
        assertTrue(Ordre.Jouer(Son.VF_VRAI, Tempo.revelationOr(express = true)) in vrai)
        assertFalse(Son.ROULEMENT_COURT in vrai.sons() || Son.BONNE_REPONSE in vrai.sons())
        assertEquals(null, vrai.musique())
        assertTrue(vrai.filterIsInstance<Ordre.Jouer>().all { it.dansMs <= Tempo.EXPRESS_POINTS })
        // Question suivante : la musique express continue, pas de nouvelle entrée de musique.
        d.observer(question.copy(index = 7, reponseVraie = false))
        val faux = d.observer(question.copy(index = 7, reponseVraie = false, ecran = Ecran.REVELATION))
        assertTrue(Son.VF_FAUX in faux.sons())
        assertFalse(Son.VF_VRAI in faux.sons())
    }

    @Test
    fun `zoom mystere, ouverture a l'entree et revelation dediee`() {
        val d = DirecteurSonore()
        val question = Instant(Ecran.QUESTION, partie = "ABCD", index = 8, equipes = 2, propositions = 4, zoom = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 7, equipes = 2))
        assertTrue(Son.ZOOM_OUVERTURE in d.observer(question).sons())
        val revele = d.observer(question.copy(ecran = Ecran.REVELATION, gagnants = 1))
        assertTrue(Son.ZOOM_REVELE in revele.sons())
        assertFalse(Son.ROULEMENT_COURT in revele.sons())
    }

    @Test
    fun `image floue, montee puis buzz qui fige tout, rate gentil, revelation`() {
        val d = DirecteurSonore()
        val image = Instant(Ecran.QUESTION, partie = "ABCD", index = 9, equipes = 3, propositions = 0, jeuBuzz = true, flou = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 8, equipes = 3))
        val entree = d.observer(image)
        assertTrue(Son.FLOU_MONTEE in entree.sons())
        assertEquals(Ambiance.SUSPENSE, entree.musique())
        // L'équipe 2 buzze : gros buzz, sa note, suspense, plus de musique.
        val buzz = d.observer(image.copy(buzzEquipe = 1))
        assertEquals(listOf(Son.BUZZ_GROS, Son.EQUIPE_2, Son.SUSPENSE_REPONSE), buzz.sons())
        assertEquals(Ordre.Couper, buzz.first())
        assertEquals(Ambiance.SILENCE, buzz.musique())
        // Le même état observé deux fois ne rejoue rien.
        assertTrue(d.observer(image.copy(buzzEquipe = 1)).isEmpty())
        // Raté : « pouet » gentil et la musique revient.
        val rate = d.observer(image.copy(ratees = 1))
        assertEquals(Ordre.Couper, rate.first())
        assertEquals(listOf(Son.VF_FAUX), rate.sons())
        assertEquals(Ambiance.SUSPENSE, rate.musique())
        assertFalse(Son.TENSION in d.observer(image.copy(ratees = 1, urgent = true)).sons())
        // Une autre équipe buzze et trouve : révélation de la photo, sans roulement.
        d.observer(image.copy(ratees = 1, urgent = true, buzzEquipe = 0))
        val revele = d.observer(image.copy(ecran = Ecran.REVELATION, ratees = 1, gagnants = 1))
        assertEquals(Ordre.Couper, revele.first())
        assertTrue(Son.ZOOM_REVELE in revele.sons())
        assertFalse(Son.ROULEMENT_COURT in revele.sons())
    }

    @Test
    fun `deuxieme buzz juste apres un rate, la musique prevue ne repart pas sous la reponse`() {
        val d = DirecteurSonore()
        val image = Instant(Ecran.QUESTION, partie = "ABCD", index = 9, equipes = 3, propositions = 1, jeuBuzz = true, flou = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 8, equipes = 3))
        d.observer(image)
        d.observer(image.copy(buzzEquipe = 0))
        val rate = d.observer(image.copy(ratees = 1))
        assertTrue(rate.any { it is Ordre.Musique && it.dansMs > 0 })
        // L'équipe 2 buzze avant que la musique revienne : tout ce qui était prévu est annulé d'abord.
        val buzz = d.observer(image.copy(ratees = 1, buzzEquipe = 2))
        assertEquals(Ordre.Couper, buzz.first())
        assertEquals(Ambiance.SILENCE, buzz.musique())
        // Les deux changements arrivent d'un coup (raté de l'équipe 3, buzz de l'équipe 1) : pouet puis buzz.
        val coup = d.observer(image.copy(ratees = 2, buzzEquipe = 1))
        assertEquals(listOf(Son.VF_FAUX, Son.BUZZ_GROS, Son.EQUIPE_2, Son.SUSPENSE_REPONSE), coup.sons())
    }

    @Test
    fun `chante le mot, pas de suspense pendant que l'equipe chante, applaudie si elle gagne`() {
        val d = DirecteurSonore()
        val mot = Instant(Ecran.QUESTION, partie = "ABCD", index = 10, equipes = 2, propositions = 1, jeuBuzz = true, chante = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 9, equipes = 2))
        val entree = d.observer(mot).sons()
        assertFalse(Son.FLOU_MONTEE in entree)
        // Pas de bulle de proposition : le mot s'affiche seul.
        assertFalse(Son.POP_1 in entree)
        val buzz = d.observer(mot.copy(buzzEquipe = 0))
        assertEquals(listOf(Son.BUZZ_GROS, Son.EQUIPE_1), buzz.sons())
        assertEquals(Ambiance.SILENCE, buzz.musique())
        val bravo = d.observer(mot.copy(ecran = Ecran.REVELATION, gagnants = 1))
        assertTrue(Ordre.Jouer(Son.APPLAUDISSEMENTS, Tempo.BUZZ_BRAVO) in bravo)
        assertFalse(Son.ROULEMENT_COURT in bravo.sons())
        val d2 = DirecteurSonore()
        d2.observer(mot)
        assertFalse(Son.APPLAUDISSEMENTS in d2.observer(mot.copy(ecran = Ecran.REVELATION)).sons())
    }

    @Test
    fun `qui suis-je, une note par nouvel indice, pas pendant qu'une equipe repond`() {
        val d = DirecteurSonore()
        val qui = Instant(Ecran.QUESTION, partie = "ABCD", index = 11, equipes = 2, propositions = 1, jeuBuzz = true, indices = 1)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 10, equipes = 2))
        assertFalse(Son.INDICE in d.observer(qui).sons())
        assertEquals(listOf(Son.INDICE), d.observer(qui.copy(indices = 2)).sons())
        assertTrue(d.observer(qui.copy(indices = 2)).isEmpty())
        d.observer(qui.copy(indices = 2, buzzEquipe = 1))
        assertFalse(Son.INDICE in d.observer(qui.copy(indices = 3, buzzEquipe = 1)).sons())
    }

    @Test
    fun `blind test, l'habillage se tait sous la chanson, diamant, scratch au buzz, rate gentil, pas de fete par-dessus`() {
        val d = DirecteurSonore()
        val bt = Instant(Ecran.QUESTION, partie = "ABCD", index = 12, equipes = 2, propositions = 1, jeuBuzz = true, musical = true, epreuve = "manche|Blind test")
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 11, equipes = 2, epreuve = ""))
        d.observer(Instant(Ecran.QUESTION, partie = "ABCD", index = 10, equipes = 2, epreuve = "manche|Quiz"))
        val entree = d.observer(bt)
        assertEquals(Ambiance.SILENCE, entree.musique())
        assertEquals(listOf(Son.BT_DIAMANT), entree.sons())
        assertFalse(Son.TENSION in d.observer(bt.copy(urgent = true)).sons())
        val buzz = d.observer(bt.copy(urgent = true, buzzEquipe = 1))
        assertEquals(listOf(Son.BT_SCRATCH, Son.BUZZ_GROS, Son.EQUIPE_2, Son.SUSPENSE_REPONSE), buzz.sons())
        val rate = d.observer(bt.copy(urgent = true, ratees = 1))
        assertEquals(listOf(Son.VF_FAUX), rate.sons())
        assertEquals(Ambiance.SILENCE, rate.musique())
        val revele = d.observer(bt.copy(ecran = Ecran.REVELATION, ratees = 1, gagnants = 1))
        assertFalse(revele.any { it is Ordre.Musique && it.ambiance == Ambiance.FETE })
        assertFalse(Son.ROULEMENT_COURT in revele.sons())
        // Reprise après une pause : toujours le silence sous la chanson.
        d.observer(bt.copy(index = 13))
        d.observer(bt.copy(index = 13, enPause = true))
        assertEquals(Ambiance.SILENCE, d.observer(bt.copy(index = 13, repriseDansMs = 3_000)).musique())
    }

    @Test
    fun `blind test, generique a la presentation, diamant a chaque lancement, buzz dedie et attente, bravo, points doubles, outro`() {
        val d = DirecteurSonore()
        val bt = Instant(Ecran.QUESTION, partie = "ABCD", index = 12, equipes = 2, propositions = 0, jeuBuzz = true, musical = true,
            blind = true, epreuve = "manche|Blind test")
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 11, equipes = 2))
        // Présentation : le générique du blind test, pas encore de diamant ni de bulles.
        val presentation = d.observer(bt.copy(blindPresentation = true))
        assertEquals(listOf(Son.BT_GENERIQUE), presentation.sons())
        assertEquals(Ambiance.SILENCE, presentation.musique())
        // Sarah lance la chanson : le diamant se pose, une seule fois.
        assertEquals(listOf(Son.BT_DIAMANT), d.observer(bt.copy(blindLecture = true)).sons())
        assertTrue(d.observer(bt.copy(blindLecture = true)).isEmpty())
        // Buzz : le buzzer du blind test, la note de l'équipe, puis l'attente feutrée ; ni scratch ni gros buzz.
        val buzz = d.observer(bt.copy(buzzEquipe = 1))
        assertEquals(listOf(Son.BT_BUZZ, Son.EQUIPE_2, Son.BT_ATTENTE), buzz.sons())
        assertEquals(Ambiance.SILENCE, buzz.musique())
        // Mauvaise réponse : petit « pouet », silence, l'attente se coupe ; puis Sarah relance la chanson.
        val rate = d.observer(bt.copy(ratees = 1))
        assertTrue(Ordre.Couper in rate)
        assertEquals(listOf(Son.VF_FAUX), rate.sons())
        assertEquals(Ambiance.SILENCE, rate.musique())
        assertEquals(listOf(Son.BT_DIAMANT), d.observer(bt.copy(ratees = 1, blindLecture = true)).sons())
        // Révélation avec un gagnant : fanfare du blind test, tampon et points ; raccourcie par Sarah, tout se tait.
        val revele = d.observer(bt.copy(ecran = Ecran.REVELATION, ratees = 1, gagnants = 1))
        assertEquals(listOf(Son.BT_BRAVO, Son.TAMPON, Son.POINTS), revele.sons())
        assertFalse(revele.any { it is Ordre.Musique && it.ambiance == Ambiance.FETE })
        assertEquals(listOf(Ordre.Couper), d.observer(bt.copy(ecran = Ecran.REVELATION, ratees = 1, gagnants = 1, blindCoupe = true)))
        // Personne n'a trouvé : un simple carillon, jamais moqueur.
        d.observer(bt.copy(index = 13, blindLecture = true))
        assertEquals(listOf(Son.BONNE_REPONSE), d.observer(bt.copy(index = 13, ecran = Ecran.REVELATION)).sons())
        // Premier morceau à points doublés : l'éclat de cuivres, une seule fois.
        assertEquals(listOf(Son.BT_DOUBLE, Son.BT_DIAMANT), d.observer(bt.copy(index = 14, blindDouble = true, blindLecture = true)).sons())
        d.observer(bt.copy(index = 14, ecran = Ecran.REVELATION, blindDouble = true))
        assertFalse(Son.BT_DOUBLE in d.observer(bt.copy(index = 15, blindDouble = true, blindLecture = true)).sons())
        // Bilan : l'outro, puis le classement et la fête une fois l'outro fini.
        val bilan = d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 15, equipes = 2, blind = true, blindBilan = true, meneurAPoints = true))
        assertEquals(listOf(Son.BT_OUTRO, Son.COMPTEUR, Son.COURONNE), bilan.sons())
        assertEquals(Ordre.Musique(Ambiance.FETE, Tempo.BT_OUTRO_MUSIQUE), bilan.last())
    }

    @Test
    fun `blind test, une box qui se reconnecte ne rejoue ni le generique ni les points doubles`() {
        val d = DirecteurSonore()
        val o = d.observer(Instant(Ecran.QUESTION, partie = "ABCD", index = 14, equipes = 2, jeuBuzz = true, musical = true,
            blind = true, blindDouble = true, blindLecture = true))
        assertEquals(listOf(Ordre.Musique(Ambiance.SILENCE)), o)
    }

    @Test
    fun `quiz musical a quatre titres, ni musique ni tension sur la chanson, revelation sans fete`() {
        val d = DirecteurSonore()
        val q = Instant(Ecran.QUESTION, partie = "ABCD", index = 14, equipes = 2, propositions = 4, musical = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 13, equipes = 2))
        assertEquals(Ambiance.SILENCE, d.observer(q).musique())
        assertFalse(Son.TENSION in d.observer(q.copy(urgent = true)).sons())
        d.observer(q.copy(ecran = Ecran.VERROUILLEE))
        val revele = d.observer(q.copy(ecran = Ecran.REVELATION, gagnants = 1))
        assertTrue(Son.BONNE_REPONSE in revele.sons())
        assertFalse(revele.any { it is Ordre.Musique && it.ambiance == Ambiance.FETE })
    }

    @Test
    fun `statues musicales, gel a chaque arret, elan a chaque reprise, jamais en double, rien par-dessus la musique du jeu`() {
        val d = DirecteurSonore()
        val danse = Instant(Ecran.QUESTION, partie = "ABCD", index = 15, equipes = 2, propositions = 0, musical = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 14, equipes = 2))
        assertEquals(Ambiance.SILENCE, d.observer(danse).musique())
        assertEquals(listOf(Son.STATUE_GEL), d.observer(danse.copy(statue = true)).sons())
        assertTrue(d.observer(danse.copy(statue = true)).isEmpty())
        assertEquals(listOf(Son.STATUE_REPART), d.observer(danse).sons())
        assertFalse(Son.TENSION in d.observer(danse.copy(urgent = true)).sons())
    }

    @Test
    fun `qui a disparu, musique douce pour memoriser, abracadabra puis pouf, et le buzzer reprend la main`() {
        val d = DirecteurSonore()
        val q = Instant(Ecran.QUESTION, partie = "ABCD", index = 16, equipes = 2, propositions = 1, jeuBuzz = true, disparu = DISPARU_MEMORISER)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 15, equipes = 2))
        assertEquals(Ambiance.MEMOIRE, d.observer(q).musique())
        val magie = d.observer(q.copy(disparu = DISPARU_MAGIE))
        assertEquals(listOf(Son.MAGIE), magie.sons())
        assertEquals(Ambiance.ENVOUTEMENT, magie.musique())
        assertTrue(d.observer(q.copy(disparu = DISPARU_MAGIE)).isEmpty())
        val chercher = q.copy(disparu = DISPARU_CHERCHER)
        val pouf = d.observer(chercher)
        assertEquals(listOf(Son.MAGIE_POUF), pouf.sons())
        assertEquals(Ambiance.SUSPENSE, pouf.musique())
        assertTrue(Son.BUZZ_GROS in d.observer(chercher.copy(buzzEquipe = 1)).sons())
    }

    @Test
    fun `qui a disparu, une box qui se reconnecte en pleine recherche ne refait pas le pouf`() {
        val d = DirecteurSonore()
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 15, equipes = 2))
        val chercher = Instant(Ecran.QUESTION, partie = "ABCD", index = 16, equipes = 2, propositions = 1, jeuBuzz = true, disparu = DISPARU_CHERCHER)
        d.observer(chercher)
        assertFalse(Son.MAGIE_POUF in d.observer(chercher).sons())
    }

    @Test
    fun `chaque extrait du blind test integre existe dans les ressources de l'appli`() {
        assertEquals(12, BlindTestCatalogue.extraits.size)
        assertEquals(BlindTestCatalogue.extraits.size, BlindTestCatalogue.extraits.map { it.id }.toSet().size)
        val manquants = BlindTestCatalogue.extraits.filterNot { java.io.File("src/main/res/raw/lmp_bt_${it.id}.ogg").isFile }
        assertTrue("Extraits manquants : $manquants", manquants.isEmpty())
    }

    @Test
    fun `chaque son a un fichier distinct`() {
        assertEquals(Son.entries.size, Son.entries.map { it.fichier }.toSet().size)
    }

    @Test
    fun `chaque son existe dans les ressources de l'appli`() {
        // Les tests JVM d'Android tournent depuis le dossier du module tv/.
        val manquants = (Son.entries.map { it.fichier } + Lit.entries.map { it.fichier }).filterNot { java.io.File("src/main/res/raw/$it.ogg").isFile }
        assertTrue("Sons manquants : $manquants", manquants.isEmpty())
    }
}
