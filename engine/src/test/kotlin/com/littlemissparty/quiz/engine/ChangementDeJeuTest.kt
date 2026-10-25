package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Sarah quitte un jeu en cours depuis la régie (« Passer au jeu suivant », « Aller à ce jeu ») : bilan des scores
 * d'abord, comme à la fin normale d'un jeu, puis « suivant » ouvre le jeu choisi (cedric, 24/10).
 */
class ChangementDeJeuTest {

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

    private fun Game.goto(index: Int) = execute(Command.Goto("g$t", state.lastSeq, index, quiz.questions[index].id), now(), teams)
    private fun Game.suivant() = execute(Command.Next("n$t", state.lastSeq), now(), teams)

    /** Première question du quiz jouée jusqu'à son classement (Rose juste), puis la deuxième ouverte. */
    private fun quizEnCours(): Game = Game(quiz).apply {
        next(now())
        next(now())
        next(now(), mapOf("rose" to Answer(1, t - 500)))
        next(now())
        next(now())
        check(state.qid == "q2" && state.phase == Phase.QUESTION)
    }

    @Test
    fun `quitter le quiz en pleine question montre le bilan, puis suivant ouvre le jeu choisi`() {
        val g = quizEnCours()
        val scores = g.state.scores()
        val r = g.goto(2)
        assertEquals(CommandStatus.APPLIED, r.status)
        assertEquals(GameLeft(g.state.lastSeq, t, "m1"), r.event)
        assertEquals(Phase.SCORES, g.state.phase)
        assertEquals("q2", g.state.qid, "le bilan reste celui du jeu quitté")
        assertEquals(scores, g.state.scores(), "aucun point perdu ni ajouté")
        assertEquals(0, g.remainingMs(now()), "plus de chrono")
        assertEquals(2, g.leaveTarget)
        assertEquals("Mimes", g.nextGameTitle(), "la TV annonce le jeu choisi")
        assertEquals(2, Codec.publicState(g)["leaveTo"], "la régie aussi")
        assertEquals("scores", Codec.publicState(g)["phase"])

        val saut = assertIs<Jumped>(g.suivant().event)
        assertEquals(emptyList(), saut.clear, "jeu jamais joué : rien n'est effacé")
        assertEquals("m1", g.state.qid)
        assertEquals(Phase.QUESTION, g.state.phase)
        assertNull(g.state.leaveTo)
        assertNull(g.leaveTarget)
        assertNull(Codec.publicState(g)["leaveTo"])
        assertEquals(scores, g.state.scores())
    }

    @Test
    fun `le bilan se relit depuis le journal`() {
        val g = quizEnCours()
        g.goto(3)
        val relue = Game(quiz, g.events.map { Codec.decode(Codec.encode(it))!! })
        assertEquals(g.state, relue.state)
        assertEquals(3, relue.leaveTarget)
        assertIs<Jumped>(g.suivant().event)
        assertEquals(g.state, Game(quiz, g.events.map { Codec.decode(Codec.encode(it))!! }).state)
        assertEquals("f1", g.state.qid)
    }

    @Test
    fun `en pause, le bilan lève la pause et suivant repart sans reprise`() {
        val g = quizEnCours()
        g.pause(now())
        assertTrue(g.state.paused)
        assertEquals(CommandStatus.APPLIED, g.goto(2).status)
        assertEquals(Phase.SCORES, g.state.phase)
        assertFalse(g.state.paused)
        assertNull(g.state.resumeAt)
        assertEquals(CommandStatus.APPLIED, g.suivant().status)
        assertEquals("m1", g.state.qid)
    }

    @Test
    fun `en plein tour de mimes, le tour s'arrête et ses mimes trouvés restent`() {
        val g = quizEnCours()
        assertIs<GameLeft>(g.goto(2).event)
        g.suivant()
        g.mimeStart("bleu", now())
        g.mimeFound(now())
        val scores = g.state.scores()
        assertIs<GameLeft>(g.goto(3).event)
        assertNull(g.state.mime, "plus de tour en cours")
        assertEquals(scores, g.state.scores())
        assertEquals(Scoring.MIME, g.state.scores()["bleu"])
        g.suivant()
        assertEquals("f1", g.state.qid)
    }

    @Test
    fun `quitter le dernier jeu pour rejouer un jeu d'avant ne termine pas la partie`() {
        val g = quizEnCours()
        g.goto(3)
        g.suivant()
        assertEquals("f1", g.state.qid)
        assertTrue(g.isLastQuestion)
        assertIs<GameLeft>(g.goto(0).event)
        assertEquals("Quiz", g.nextGameTitle())
        val saut = assertIs<Jumped>(g.suivant().event)
        assertEquals(listOf("q1", "q2"), saut.clear, "jeu déjà joué : il repart de zéro")
        assertEquals("q1", g.state.qid)
        assertEquals(0, g.state.scores()["rose"] ?: 0, "les points du quiz sont retirés, jamais comptés deux fois")
    }

    @Test
    fun `sans jeu en cours, le changement de jeu est immédiat`() {
        // Recommencer le jeu en cours.
        val g = quizEnCours()
        val recommence = assertIs<Jumped>(g.goto(0).event)
        assertEquals(listOf("q1", "q2"), recommence.clear)
        // Depuis le classement d'une question (fin normale d'un jeu ou entre deux questions).
        g.next(now())
        g.next(now(), mapOf("rose" to Answer(1, t - 500)))
        g.next(now())
        assertEquals(Phase.SCORES, g.state.phase)
        assertIs<Jumped>(g.goto(2).event)
        assertEquals("m1", g.state.qid)
        // Après la fin de partie (fin demandée par erreur).
        g.end(now())
        assertIs<Jumped>(g.goto(3).event)
        assertEquals("f1", g.state.qid)
        // Depuis l'écran de présentation d'un jeu : rien n'y a été joué.
        val avecIntros = Game(quiz.copy(intros = true)).apply { next(now()) }
        assertTrue(avecIntros.state.intro)
        assertIs<Jumped>(avecIntros.goto(2).event)
        assertTrue(avecIntros.state.intro)
        assertEquals("m1", avecIntros.state.qid)
    }

    @Test
    fun `pendant le bilan, choisir un autre jeu y va directement`() {
        val g = quizEnCours()
        g.goto(2)
        assertEquals(Phase.SCORES, g.state.phase)
        val saut = assertIs<Jumped>(g.goto(3).event)
        assertEquals("f1", saut.qid)
        assertNull(g.state.leaveTo)
    }
}
