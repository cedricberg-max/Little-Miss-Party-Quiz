package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Le Gonfleur fou : course de tapes, premier ballon éclaté gagnant, ou le plus gros à l'arrêt. */
class GonfleurTest {

    private val t0 = 1_000_000L
    private val quiz = Question("q1", "Capitale ?", listOf("Paris", "Rome"), 0, durationSec = 20, roundTitle = "Quiz")
    private val ballon = Question("g1", "Le Gonfleur fou", emptyList(), -1, durationSec = 45, kind = QuestionKind.GONFLEUR, roundTitle = "Le Gonfleur fou")
    private val apres = Question("q2", "Couleur du ciel ?", listOf("Bleu", "Vert"), 0, durationSec = 20, roundTitle = "Quiz 2")
    private val equipes = setOf("licornes", "dragons", "pandas")

    /** Quiz joué, puis le Gonfleur fou présenté et lancé à [lance]. */
    private fun partie(lance: Long = t0 + 6_000): Game = Game(Quiz("p", "P", listOf(quiz, ballon, apres), intros = true)).apply {
        next(t0)
        next(t0 + 100)
        close(t0 + 2_000)
        next(t0 + 3_000, mapOf("licornes" to Answer(0, t0 + 1_000)))
        next(t0 + 4_000)
        next(t0 + 5_000)
        assertEquals("g1", question?.id)
        assertNull(pumpGoAt, "rien avant le lancement de l'animatrice")
        assertNull(Codec.publicState(this)["pump"])
        next(lance)
    }

    private val go get() = t0 + 6_000 + PUMP_GO_MS

    @Test
    fun `le départ attend le décompte de la TV, puis le premier ballon éclaté gagne`() {
        val g = partie()
        assertEquals(go, g.pumpGoAt)
        assertEquals(go, g.state.resumeAt, "les tablettes attendent le « GONFLEZ ! »")
        @Suppress("UNCHECKED_CAST")
        val p = Codec.publicState(g)["pump"] as Map<String, Any?>
        assertEquals(Codec.pumpKey(g), p["key"])
        assertEquals(PUMP_TARGET, p["target"])
        assertNotNull(g.deadline(), "chrono de secours")
        assertNull(g.balloon(emptyMap(), equipes, go - 1_000, stop = true), "pas d'arrêt pendant le décompte")
        assertNull(g.next(go + 1_000), "le bouton principal sans les tapes ne fait rien")
        assertNull(g.close(go + 1_000), "jamais de fermeture ordinaire")
        val enCours = mapOf("licornes" to Pump(60, go + 8_000), "dragons" to Pump(99, go + 8_000))
        assertNull(g.balloon(enCours, equipes, go + 8_000, stop = false), "personne n'a encore éclaté")
        // Les deux ballons éclatent : le premier arrivé gagne, même envoyé en second à la box.
        val fin = mapOf("licornes" to Pump(PUMP_TARGET, go + 12_400), "dragons" to Pump(PUMP_TARGET, go + 12_100), "pandas" to Pump(40, go + 12_000))
        val e = g.balloon(fin, equipes, go + 12_500, stop = false) as BalloonBurst
        assertEquals("dragons", e.team)
        assertEquals(Phase.REVEAL, g.state.phase)
        val awards = g.state.awards["g1"]!!
        assertEquals(Scoring.MINI_WIN, awards["dragons"]!!.points)
        assertEquals(Scoring.MINI_PLAYED, awards["licornes"]!!.points)
        assertEquals(Scoring.MINI_PLAYED, awards["pandas"]!!.points, "chaque équipe qui joue marque")
        assertNull(g.balloon(fin, equipes, go + 13_000, stop = true), "une seule fin")
        assertNull(Codec.publicState(g)["correct"])
        g.next(go + 20_000)
        assertEquals(Phase.SCORES, g.state.phase)
        g.next(go + 21_000)
        assertEquals("q2", g.question?.id, "le jeu suivant s'enchaîne")
    }

    @Test
    fun `arrêtée par l'animatrice ou au bout du chrono, la course revient au plus gros ballon`() {
        val g = partie()
        val pumps = mapOf("licornes" to Pump(70, go + 9_000), "dragons" to Pump(70, go + 8_500), "inconnus" to Pump(99, go + 1_000))
        val res = g.execute(Command.Next("c1", g.state.lastSeq), go + 10_000, equipes, pumps = pumps)
        assertEquals(CommandStatus.APPLIED, res.status)
        assertEquals("dragons", (res.event as BalloonBurst).team, "égalité : le premier arrivé à 70 ; une équipe inconnue ne compte pas")
        assertEquals(3, g.state.awards["g1"]!!.size)
    }

    @Test
    fun `course arrêtée sans aucune tape, personne ne gagne et tout le monde a sa participation`() {
        val g = partie()
        assertNull(g.timeUp(go + 45_000), "la fin du chrono passe par les tapes")
        val e = g.balloon(emptyMap(), equipes, go + 45_500, stop = true) as BalloonBurst
        assertEquals(NO_WINNER, e.team)
        assertTrue(g.state.awards["g1"]!!.values.all { it.points == Scoring.MINI_PLAYED && !it.correct })
    }

    @Test
    fun `en pause rien ne finit, et la reprise garde la même course`() {
        val g = partie()
        val cle = Codec.pumpKey(g)
        g.pause(go + 5_000)
        assertNull(g.balloon(mapOf("licornes" to Pump(PUMP_TARGET, go + 4_000)), equipes, go + 6_000, stop = false))
        val res = g.execute(Command.Close("c1", g.state.lastSeq), go + 6_000, equipes, pumps = mapOf("licornes" to Pump(50, go + 4_000)))
        assertEquals(CommandStatus.REFUSED, res.status)
        g.resume(go + 20_000)
        assertEquals(cle, Codec.pumpKey(g), "les tapes déjà envoyées restent valables")
        assertTrue(g.state.resumeAt!! > go + 20_000, "décompte de reprise avant de retaper")
        assertEquals(40_000L, g.remainingMs(g.state.resumeAt!!), "le chrono de secours a été arrêté pendant la pause")
    }

    @Test
    fun `rejoué depuis la régie, le Gonfleur repart de zéro avec une nouvelle clé`() {
        val g = partie()
        val avant = g.state.scores()
        val cle = Codec.pumpKey(g)
        g.balloon(mapOf("licornes" to Pump(PUMP_TARGET, go + 9_000)), equipes, go + 9_100, stop = false)
        assertNotNull(g.goto(1, go + 60_000))
        assertEquals(avant, g.state.scores(), "les points de la première course ne comptent plus")
        g.next(go + 61_000)
        assertTrue(Codec.pumpKey(g) != cle, "les anciennes tapes ne comptent pas")
    }

    @Test
    fun `le journal rejoué redonne la même fin, et la prestation de la régie se lit`() {
        val g = partie()
        g.balloon(mapOf("pandas" to Pump(PUMP_TARGET, go + 9_000)), equipes, go + 9_100, stop = false)
        val relu = Game(g.quiz, g.events.map { Codec.decode(Codec.encode(it))!! })
        assertEquals(g.state, relu.state)
        val q = QuizJson.parse("""{"id":"p","questions":[{"id":"r1g","text":"Le Gonfleur fou","kind":"gonfleur","choices":[],"correct":-1,"duration":45,"double":false,"round":"Le Gonfleur fou"}]}""")
        assertTrue(q.questions.single().isGonfleur)
        assertEquals(45, q.questions.single().durationSec)
    }
}
