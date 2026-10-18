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
    fun `un buzzer fait sonner l'equipe une fois`() {
        val d = DirecteurSonore()
        d.observer(q2)
        assertEquals(listOf(Son.EQUIPE_2, Son.VERROU), d.observer(q2.copy(buzzeur = 1)).sons())
        assertTrue(d.observer(q2.copy(buzzeur = 1)).isEmpty())
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
    fun `buzzer libre du salon, un bruit rigolo a chaque appui, celui de l'equipe, rien de verrouille`() {
        val d = DirecteurSonore()
        d.observer(salon.copy(equipes = 3))
        assertEquals(listOf(Son.RIGOLO_2), d.observer(salon.copy(equipes = 3, buzzRigolo = 1, buzzRigoloEquipe = 1)).sons())
        assertEquals(listOf(Son.RIGOLO_2), d.observer(salon.copy(equipes = 3, buzzRigolo = 2, buzzRigoloEquipe = 1)).sons())
        assertEquals(listOf(Son.RIGOLO_3), d.observer(salon.copy(equipes = 3, buzzRigolo = 3, buzzRigoloEquipe = 2)).sons())
        // Le même appui revu (rafraîchissement) ne rejoue rien ; jamais de verrou ni de musique coupée.
        val revu = d.observer(salon.copy(equipes = 3, buzzRigolo = 3, buzzRigoloEquipe = 2))
        assertTrue(revu.isEmpty())
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
