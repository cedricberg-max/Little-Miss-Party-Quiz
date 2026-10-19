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
        assertEquals(Ordre.Musique(Ambiance.SALON, Tempo.GENERIQUE_FIN), o.filterIsInstance<Ordre.Musique>().last())
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
        assertTrue(Ordre.Arreter(Son.FLOU_MONTEE) in buzz)
        assertEquals(Ambiance.SILENCE, buzz.musique())
        // Le même état observé deux fois ne rejoue rien.
        assertTrue(d.observer(image.copy(buzzEquipe = 1)).isEmpty())
        // Raté : « pouet » gentil et la musique revient.
        val rate = d.observer(image.copy(ratees = 1))
        assertTrue(Ordre.Arreter(Son.SUSPENSE_REPONSE) in rate)
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
    fun `chante le mot, pas de suspense pendant que l'equipe chante, applaudie si elle gagne`() {
        val d = DirecteurSonore()
        val mot = Instant(Ecran.QUESTION, partie = "ABCD", index = 10, equipes = 2, propositions = 1, jeuBuzz = true, chante = true)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 9, equipes = 2))
        assertFalse(Son.FLOU_MONTEE in d.observer(mot).sons())
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
    fun `blind test, diamant puis extrait, scratch au buzz, reprise apres un rate, chanson en grand a la revelation`() {
        val d = DirecteurSonore()
        val bt = Instant(Ecran.QUESTION, partie = "ABCD", index = 12, equipes = 2, propositions = 1, jeuBuzz = true, blindTest = true, extrait = "res:lmp_bt_frere_jacques", extraitMs = 0)
        d.observer(Instant(Ecran.CLASSEMENT, partie = "ABCD", index = 11, equipes = 2))
        val entree = d.observer(bt)
        assertEquals(Ambiance.SILENCE, entree.musique())
        assertTrue(Son.BT_DIAMANT in entree.sons())
        assertTrue(Ordre.Extrait("res:lmp_bt_frere_jacques", 0, Tempo.BT_EXTRAIT) in entree)
        // Buzz à 6 s : le disque s'arrête net.
        val buzz = d.observer(bt.copy(buzzEquipe = 1, extraitMs = 6_000))
        assertTrue(Ordre.ArreterExtrait in buzz)
        assertEquals(listOf(Son.BT_SCRATCH, Son.BUZZ_GROS, Son.EQUIPE_2, Son.SUSPENSE_REPONSE), buzz.sons())
        // Raté : l'extrait repart là où il s'était arrêté.
        val rate = d.observer(bt.copy(ratees = 1, extraitMs = 6_000))
        assertTrue(Ordre.Extrait("res:lmp_bt_frere_jacques", 6_000, Tempo.FLOU_REPRISE) in rate)
        assertEquals(Ambiance.SILENCE, rate.musique())
        // Révélation : la chanson repart, pas de musique de fête par-dessus.
        val revele = d.observer(bt.copy(ecran = Ecran.REVELATION, ratees = 1, gagnants = 1, extraitMs = 0))
        assertTrue(revele.any { it is Ordre.Extrait })
        assertFalse(revele.any { it is Ordre.Musique && it.ambiance == Ambiance.FETE })
        assertFalse(Son.ROULEMENT_COURT in revele.sons())
    }

    @Test
    fun `blind test, pause puis reprise sur l'extrait, et box qui se reconnecte en plein extrait`() {
        val d = DirecteurSonore()
        val bt = Instant(Ecran.QUESTION, partie = "ABCD", index = 12, equipes = 2, propositions = 1, jeuBuzz = true, blindTest = true, extrait = "/cache/a.mp3", extraitMs = 4_000)
        d.observer(bt)
        assertTrue(d.observer(bt.copy(enPause = true)).first() == Ordre.Couper)
        val reprise = d.observer(bt.copy(repriseDansMs = 3_000, extraitMs = 5_000))
        assertTrue(Ordre.Extrait("/cache/a.mp3", 5_000, 3_000) in reprise)
        val autre = DirecteurSonore()
        assertTrue(Ordre.Extrait("/cache/a.mp3", 4_000, 0) in autre.observer(bt))
        // Pendant qu'une équipe répond, une box qui se reconnecte ne relance pas l'extrait.
        assertFalse(DirecteurSonore().observer(bt.copy(buzzEquipe = 0)).any { it is Ordre.Extrait })
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
