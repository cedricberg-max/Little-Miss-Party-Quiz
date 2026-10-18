package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Pause générale de l'animatrice ou automatique (pupitre déconnecté), puis reprise avec décompte. */
class PauseTest {

    private val quiz = Quiz(
        "demo", "Démo",
        listOf(
            Question("q1", "Couleur du ciel ?", listOf("Vert", "Bleu", "Rouge", "Jaune"), correct = 1, durationSec = 20),
            Question("q2", "Finale", listOf("A", "B"), correct = 0, durationSec = 10, double = true),
        ),
    )
    private val teams = setOf("rose", "bleu")
    private val t0 = 1_000_000L

    private fun firebaseRoundTrip(v: Any?): Any? = when (v) {
        is Int -> v.toLong()
        is Map<*, *> -> v.filterValues { it != null }.mapValues { firebaseRoundTrip(it.value) }
        is List<*> -> v.map { firebaseRoundTrip(it) }
        else -> v
    }

    /** Première question jouée jusqu'aux scores, Rose a bien répondu. */
    private fun atScores(): Game = Game(quiz).apply {
        next(t0)
        next(t0 + 5_000)
        next(t0 + 5_100, mapOf("rose" to Answer(1, t0 + 2_000)))
        next(t0 + 6_000)
    }

    @Test
    fun `la pause est possible à chaque étape de la partie, pas au salon ni à la fin`() {
        val g = Game(quiz)
        assertNull(g.pause(t0), "Salon d'attente : rien à mettre en pause")
        g.next(t0)
        for (expected in listOf(Phase.QUESTION, Phase.CLOSED, Phase.REVEAL, Phase.SCORES)) {
            assertEquals(expected, g.state.phase)
            val t = t0 + 1_000 * g.state.lastSeq
            g.pause(t)
            assertTrue(g.state.paused, "Pause en $expected")
            assertNull(g.next(t + 10), "Rien n'avance en pause ($expected)")
            assertEquals(expected, g.state.phase)
            g.resume(t + 20)
            assertFalse(g.state.paused)
            g.next(t + 5_000, mapOf("rose" to Answer(1, t0 + 500)))
        }
        g.end(t0 + 100_000)
        assertNull(g.pause(t0 + 100_001), "Partie terminée")
    }

    @Test
    fun `scores et étape sont conservés pendant la pause`() {
        val g = atScores()
        val before = g.state.scores()
        g.pause(t0 + 7_000)
        g.adjust("bleu", 10, "oral", t0 + 8_000)
        g.resume(t0 + 9_000)
        assertEquals(Phase.SCORES, g.state.phase)
        assertEquals(before + ("bleu" to 10), g.state.scores())
        // La partie reprend exactement là où elle était : question suivante.
        g.next(t0 + 20_000)
        assertEquals(1, g.state.index)
    }

    @Test
    fun `à la reprise, le chrono repart après le décompte 3, 2, 1`() {
        val g = Game(quiz)
        g.next(t0)
        g.pause(t0 + 5_000)
        assertEquals(15_000, g.remainingMs(t0 + 60_000))
        g.resume(t0 + 60_000)
        assertEquals(t0 + 60_000 + RESUME_COUNTDOWN_MS, g.state.resumeAt)
        assertEquals(15_000, g.remainingMs(t0 + 62_000), "Pendant le décompte le chrono ne bouge pas")
        assertEquals(t0 + 63_000 + 15_000, g.deadline())
        assertEquals(10_000, g.remainingMs(t0 + 68_000))
    }

    @Test
    fun `une pause pendant le décompte ne consomme pas de chrono`() {
        val g = Game(quiz)
        g.next(t0)
        g.pause(t0 + 5_000)
        g.resume(t0 + 10_000)
        g.pause(t0 + 11_000)
        assertEquals(15_000, g.remainingMs(t0 + 50_000))
        g.resume(t0 + 50_000)
        assertEquals(t0 + 53_000 + 15_000, g.deadline())
    }

    @Test
    fun `le bonus de rapidité ignore la pause et le décompte`() {
        val g = Game(quiz)
        g.next(t0)
        g.pause(t0 + 5_000)
        g.resume(t0 + 60_000)
        // 5 s de chrono avant la pause, 5 s après le décompte : il reste 10 s sur 20.
        val answer = Answer(1, t0 + 68_000)
        g.next(t0 + 70_000)
        g.next(t0 + 70_100, mapOf("rose" to answer))
        assertEquals(110, g.state.scores()["rose"])
    }

    @Test
    fun `fermer une question en pause est impossible, reprendre d'abord`() {
        val g = Game(quiz)
        g.next(t0)
        g.pause(t0 + 1_000)
        assertNull(g.close(t0 + 2_000))
        assertEquals(Phase.QUESTION, g.state.phase)
    }

    @Test
    fun `une pause automatique nomme l'équipe déconnectée`() {
        val g = Game(quiz)
        g.next(t0)
        g.pause(t0 + 4_000, PAUSE_TEAM, "bleu")
        assertEquals(Hold(PAUSE_TEAM, "bleu", t0 + 4_000), g.state.hold)
        val pub = Codec.publicState(g)
        assertEquals(true, pub["paused"])
        assertEquals(PAUSE_TEAM, pub["pauseReason"])
        assertEquals("bleu", pub["pauseTeam"])
        assertEquals(16_000L, pub["remainingMs"])
        g.resume(t0 + 30_000)
        val after = Codec.publicState(g)
        assertEquals(false, after["paused"])
        assertNull(after["pauseTeam"])
        assertEquals(t0 + 33_000, after["resumeAt"])
    }

    @Test
    fun `la pause est publiée hors question aussi, et la partie terminée la lève`() {
        val g = atScores()
        g.pause(t0 + 7_000)
        assertEquals(true, Codec.publicState(g)["paused"])
        g.end(t0 + 8_000)
        assertFalse(g.state.paused)
        assertEquals(Phase.ENDED, g.state.phase)
    }

    @Test
    fun `pause, raison et décompte survivent au journal et à la reprise de la box`() {
        val g = Game(quiz)
        g.next(t0)
        g.pause(t0 + 3_000, PAUSE_TEAM, "rose")
        g.resume(t0 + 9_000)
        g.pause(t0 + 15_000)
        val decoded = g.events.map { Codec.decode(firebaseRoundTrip(Codec.encode(it)) as Map<*, *>)!! }
        assertEquals(g.events, decoded)
        val replayed = Game(quiz, decoded)
        assertEquals(g.state, replayed.state)
        assertEquals(Hold(PAUSE_REGIE, null, t0 + 15_000), replayed.state.hold)
    }

    @Test
    fun `un journal d'avant la pause générale se rejoue à l'identique`() {
        // Ancien format : pause sans raison, reprise sans décompte, fermeture pendant la pause.
        val old = listOf(
            mapOf("seq" to 1L, "at" to t0, "type" to "open", "index" to 0L, "qid" to "q1"),
            mapOf("seq" to 2L, "at" to t0 + 2_000, "type" to "pause"),
            mapOf("seq" to 3L, "at" to t0 + 9_000, "type" to "resume"),
            mapOf("seq" to 4L, "at" to t0 + 10_000, "type" to "pause"),
            mapOf("seq" to 5L, "at" to t0 + 12_000, "type" to "close"),
        ).map { Codec.decode(it)!! }
        val g = Game(quiz, old)
        assertEquals(5, g.state.lastSeq, "Tous les événements sont acceptés")
        assertEquals(Phase.CLOSED, g.state.phase)
        assertFalse(g.state.paused)
        // 2 s puis 1 s de chrono : la reprise sans décompte repart aussitôt.
        assertEquals(3_000, g.state.elapsedAt(Long.MAX_VALUE))
    }

    @Test
    fun `la régie ne peut pas faire avancer une partie en pause`() {
        val g = Game(quiz)
        g.execute(Command.Next("a", 0), t0, teams)
        assertEquals(CommandStatus.APPLIED, g.execute(Command.Pause("p", g.state.lastSeq), t0 + 1_000, teams).status)
        val next = g.execute(Command.Next("n", g.state.lastSeq), t0 + 2_000, teams)
        assertEquals(CommandStatus.REFUSED, next.status)
        assertEquals("paused", next.reason)
        assertEquals("paused", g.execute(Command.Close("c", g.state.lastSeq), t0 + 2_100, teams).reason)
        // Une seconde pause (double appui, deux téléphones) ne change rien.
        assertEquals(CommandStatus.REFUSED, g.execute(Command.Pause("p2", g.state.lastSeq), t0 + 2_200, teams).status)
        // Les corrections restent possibles pendant la pause.
        assertEquals(CommandStatus.APPLIED, g.execute(Command.Adjust("adj", g.state.lastSeq, "rose", 10), t0 + 2_300, teams).status)
        val resume = g.execute(Command.Resume("r", g.state.lastSeq), t0 + 3_000, teams)
        assertEquals(CommandStatus.APPLIED, resume.status)
        assertEquals(RESUME_COUNTDOWN_MS, (resume.event as Resumed).countdownMs)
        assertEquals(CommandStatus.REFUSED, g.execute(Command.Resume("r2", g.state.lastSeq), t0 + 3_100, teams).status)
        assertEquals(CommandStatus.APPLIED, g.execute(Command.Close("c2", g.state.lastSeq), t0 + 8_000, teams).status)
    }
}
