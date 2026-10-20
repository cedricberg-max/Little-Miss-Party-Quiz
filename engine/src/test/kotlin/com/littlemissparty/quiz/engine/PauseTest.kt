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
    fun `un arrêt du chrono de la régie pendant le décompte de reprise est refusé, puis accepté après`() {
        val g = Game(quiz)
        g.next(t0)
        g.pause(t0 + 1_000)
        g.resume(t0 + 60_000)
        // Appui réflexe juste après « Reprendre » : la question ne se ferme pas (« Temps écoulé ! » évité).
        val tot = g.execute(Command.Close("c1", g.state.lastSeq), t0 + 60_500, teams)
        assertEquals(CommandStatus.REFUSED, tot.status)
        assertEquals("countdown", tot.reason)
        assertEquals(Phase.QUESTION, g.state.phase)
        assertEquals(19_000L, g.remainingMs(t0 + 63_000))
        // Après le décompte, l'animatrice peut arrêter le chrono normalement.
        assertEquals(CommandStatus.APPLIED, g.execute(Command.Close("c2", g.state.lastSeq), t0 + 65_000, teams).status)
        assertEquals(Phase.CLOSED, g.state.phase)
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

    @Test
    fun `double appui sur OK, le chrono qui vient de partir ne s'arrete pas tout de suite`() {
        val g = Game(quiz)
        g.next(t0)
        // Le second appui arrive 636 ms plus tard sur l'émulateur, bien après la garde de 500 ms de la box.
        assertTrue(g.justStarted(t0 + 636))
        assertFalse(g.justStarted(t0 + CLOSE_GUARD_MS))
        // Après une pause, même protection à la reprise du chrono (décompte compris).
        g.pause(t0 + 5_000)
        assertFalse(g.justStarted(t0 + 5_100), "En pause, rien à protéger")
        g.resume(t0 + 8_000)
        assertTrue(g.justStarted(t0 + 9_000), "Pendant le décompte 3, 2, 1")
        assertTrue(g.justStarted(t0 + 11_000 + 600))
        assertFalse(g.justStarted(t0 + 11_000 + CLOSE_GUARD_MS))
        g.close(t0 + 20_000)
        assertFalse(g.justStarted(t0 + 20_100), "Question fermée")
    }

    @Test
    fun `box sans Internet, la question se fige une fois, l'animatrice garde la main`() {
        val g = Game(quiz)
        assertNull(g.networkPause(t0, 60_000, false), "Salon d'attente : rien à figer")
        g.next(t0)
        assertNull(g.networkPause(t0 + 2_000, NETWORK_GRACE_MS - 1, false), "Micro-coupure : on attend")
        val paused = g.networkPause(t0 + 5_000, NETWORK_GRACE_MS, false)
        assertTrue(paused is Paused && paused.reason == PAUSE_NETWORK)
        assertEquals(15_000, g.remainingMs(t0 + 60_000), "Chrono figé à 15 s")
        assertNull(g.networkPause(t0 + 6_000, 10_000, false), "Déjà en pause")
        // L'animatrice relance à la télécommande pendant la coupure : la box ne repause pas la question.
        g.resume(t0 + 7_000)
        assertNull(g.networkPause(t0 + 12_000, 12_000, true))
        // Question suivante lancée hors connexion : la fête continue (cartes A B C D), sans nouvelle pause.
        g.close(t0 + 13_000)
        g.next(t0 + 13_100, mapOf("rose" to Answer(1, t0 + 11_000)))
        g.next(t0 + 13_200)
        g.next(t0 + 13_300)
        assertEquals("q2", g.state.qid)
        assertNull(g.networkPause(t0 + 14_000, 14_000, true), "Même coupure : pas de nouvelle pause")
        // Nouvelle coupure plus tard (Internet revenu entre-temps) : la question se fige à nouveau.
        assertTrue(g.networkPause(t0 + 20_000, NETWORK_GRACE_MS, false) is Paused)
    }

    @Test
    fun `points donnés à la télécommande hors connexion, sans jamais passer sous zéro`() {
        val g = Game(quiz)
        g.next(t0)
        val bonus = g.remotePoints("rose", 150, t0 + 1_000)
        assertTrue(bonus is ScoreAdjusted && bonus.reason == REASON_REMOTE)
        assertEquals(150, g.state.scores()["rose"])
        g.remotePoints("rose", -100, t0 + 1_100)
        assertEquals(50, g.state.scores()["rose"])
        // Malus plus gros que le score : l'équipe s'arrête à zéro.
        g.remotePoints("rose", -100, t0 + 1_200)
        assertEquals(0, g.state.scores()["rose"])
        assertNull(g.remotePoints("bleu", -50, t0 + 1_300), "Déjà à zéro : rien ne part")
        assertNull(g.remotePoints("bleu", 0, t0 + 1_400))
        assertNull(g.remotePoints("bleu", Command.MAX_DELTA + 1, t0 + 1_500), "Montant hors limite")
        assertEquals(0, g.state.scores()["bleu"] ?: 0)
    }
}
