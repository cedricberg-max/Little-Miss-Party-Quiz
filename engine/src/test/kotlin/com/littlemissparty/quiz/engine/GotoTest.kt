package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Enchaînement des jeux d'une prestation et commandes de secours de la régie (jeu suivant, autre jeu, rejouer). */
class GotoTest {

    private val cards = listOf("Chat", "Pirate").map { MimeCard(it, "🙂") }
    private val quiz = Quiz(
        "lea", "Léa",
        listOf(
            Question("q1", "Couleur du ciel ?", listOf("Vert", "Bleu"), correct = 1, durationSec = 20, roundTitle = "Quiz"),
            Question("q2", "2 + 2 ?", listOf("4", "5"), correct = 0, durationSec = 20, roundTitle = "Quiz"),
            Question("m1", "Animaux", emptyList(), correct = -1, durationSec = 60, kind = QuestionKind.MIME, roundTitle = "Mimes", cards = cards),
            Question("f1", "Finale", listOf("A", "B"), correct = 0, durationSec = 10, roundTitle = "Finale"),
        ),
    )
    private val teams = setOf("rose", "bleu")
    private var t = 1_000_000L
    private fun now() = (t + 1_000).also { t = it }

    /** Question QCM jouée jusqu'au classement : Rose répond juste. */
    private fun Game.playQuestion() {
        check(state.phase == Phase.QUESTION)
        next(now())
        next(now(), mapOf("rose" to Answer(question!!.correct, t - 500)))
        next(now())
    }

    @Test
    fun `quiz puis mimes puis jeu suivant, équipes et scores gardés tout du long`() {
        val g = Game(quiz)
        g.next(now())
        g.playQuestion()
        g.next(now())
        g.playQuestion()
        val afterQuiz = g.state.scores()["rose"]!!
        assertTrue(afterQuiz > 0)
        // Fin du quiz : « suivant » ouvre les mimes.
        assertNotNull(g.next(now()))
        assertEquals("m1", g.state.qid)
        assertEquals(Phase.QUESTION, g.state.phase)
        g.mimeStart("bleu", now()); g.mimeFound(now()); g.mimeStop(now())
        g.mimeStart("rose", now()); g.mimeFound(now()); g.mimeStop(now())
        assertNotNull(g.next(now()), "Entre deux tours, suivant mène au classement")
        assertEquals(Phase.SCORES, g.state.phase)
        assertEquals(afterQuiz + Scoring.MIME, g.state.scores()["rose"])
        assertEquals(Scoring.MIME, g.state.scores()["bleu"])
        // Classement des mimes, puis jeu suivant.
        assertNotNull(g.next(now()))
        assertEquals("f1", g.state.qid)
        assertEquals(afterQuiz + Scoring.MIME, g.state.scores()["rose"])
    }

    @Test
    fun `chaque équipe a son tour même quand le paquet est épuisé`() {
        val g = Game(quiz)
        g.goto(2, now())
        g.mimeStart("bleu", now()); g.mimeFound(now()); g.mimeFound(now())
        assertNull(g.state.mime?.team, "Paquet épuisé : le tour de Bleu s'arrête")
        assertNotNull(g.mimeStart("rose", now()), "Rose joue quand même : le paquet est rebattu")
        assertEquals("Chat", g.mimeCard?.word)
        assertEquals(listOf("bleu", "rose"), g.state.mime?.turns)
    }

    @Test
    fun `jeu suivant depuis le milieu du quiz, les points gagnés restent`() {
        val g = Game(quiz)
        g.next(now())
        g.playQuestion()
        val score = g.state.scores()
        g.next(now())
        assertEquals("q2", g.state.qid)
        val jump = assertNotNull(g.goto(2, now()))
        assertTrue(jump is Jumped && jump.clear.isEmpty())
        assertEquals("m1", g.state.qid)
        assertEquals(score, g.state.scores())
    }

    @Test
    fun `rejouer un jeu retire ses points avant de le rejouer, jamais de double compte`() {
        val g = Game(quiz)
        g.next(now())
        g.playQuestion()
        g.next(now())
        g.playQuestion()
        g.next(now())
        g.mimeStart("bleu", now()); g.mimeFound(now()); g.mimeStop(now())
        assertEquals(Scoring.MIME, g.state.scores()["bleu"])
        // Rejouer les mimes : les mimes de Bleu sont retirés, le quiz reste.
        val quizPoints = g.state.scores()["rose"]
        val replay = assertNotNull(g.goto(2, now())) as Jumped
        assertEquals(listOf("m1"), replay.clear)
        assertEquals(null, g.state.scores()["bleu"]?.takeIf { it != 0 })
        assertEquals(quizPoints, g.state.scores()["rose"])
        assertEquals(emptyList(), g.state.mime?.turns)
        g.mimeStart("bleu", now()); g.mimeFound(now()); g.mimeStop(now())
        assertEquals(Scoring.MIME, g.state.scores()["bleu"], "Un seul mime compté après le rejeu")
        // Rejouer le quiz depuis le début : ses points sont retirés, les mimes restent.
        val back = assertNotNull(g.goto(1, now())) as Jumped
        assertEquals(0, back.index, "Le saut vise le début du jeu")
        assertEquals(listOf("q1", "q2"), back.clear)
        assertEquals(null, g.state.scores()["rose"]?.takeIf { it != 0 })
        assertEquals(Scoring.MIME, g.state.scores()["bleu"])
        g.playQuestion()
        g.next(now())
        g.playQuestion()
        assertEquals(quizPoints, g.state.scores()["rose"])
        // En repassant par les mimes après le quiz rejoué, ils repartent de zéro.
        g.next(now())
        assertEquals("m1", g.state.qid)
        assertEquals(null, g.state.scores()["bleu"]?.takeIf { it != 0 })
    }

    @Test
    fun `secours en pause et après une fin par erreur, double appui sans effet`() {
        val g = Game(quiz)
        g.next(now())
        g.pause(now())
        val r = g.execute(Command.Goto("c1", g.state.lastSeq, 2, "m1"), now(), teams)
        assertEquals(CommandStatus.APPLIED, r.status)
        assertTrue(!g.state.paused, "Le saut lève la pause")
        val stale = g.execute(Command.Goto("c2", g.state.lastSeq - 1, 3, "f1"), now(), teams)
        assertEquals(CommandStatus.STALE, stale.status)
        assertEquals(CommandStatus.REFUSED, g.execute(Command.Goto("c3", g.state.lastSeq, 3, "autre"), now(), teams).status)
        g.end(now())
        assertEquals(Phase.ENDED, g.state.phase)
        assertEquals(CommandStatus.APPLIED, g.execute(Command.Goto("c4", g.state.lastSeq, 3, "f1"), now(), teams).status)
        assertEquals("f1", g.state.qid)
    }

    @Test
    fun `le saut se relit depuis le journal`() {
        val g = Game(quiz)
        g.next(now())
        g.playQuestion()
        g.goto(0, now())
        val log = g.events.map { Codec.encode(it) }
        val replayed = Game(quiz, log.map { Codec.decode(it)!! })
        assertEquals(g.state, replayed.state)
        assertEquals(Command.Goto("x", 3, 2, "m1"), Command.decode("x", mapOf("type" to "goto", "expectSeq" to 3L, "index" to 2L, "qid" to "m1")))
    }
}
