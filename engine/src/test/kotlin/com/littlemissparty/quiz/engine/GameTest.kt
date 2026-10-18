package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class GameTest {

    private val quiz = Quiz(
        "demo", "Démo",
        listOf(
            Question("q1", "Couleur du ciel ?", listOf("Vert", "Bleu", "Rouge", "Jaune"), correct = 1, durationSec = 20),
            Question("q2", "Le soleil est une étoile", listOf("Vrai", "Faux"), correct = 0, durationSec = 10, kind = QuestionKind.TRUE_FALSE),
            Question("q3", "Finale", listOf("A", "B", "C", "D"), correct = 3, durationSec = 20, double = true),
        ),
    )

    private val t0 = 1_000_000L

    /** Joue une question complète et renvoie la partie. */
    private fun playFirst(answers: Map<String, Answer>): Game {
        val g = Game(quiz)
        g.next(t0)
        g.next(t0 + 20_000)
        g.next(t0 + 20_100, answers)
        return g
    }

    @Test
    fun `le bouton suivant enchaîne toutes les étapes jusqu'à la fin`() {
        val g = Game(quiz)
        val phases = mutableListOf<Phase>()
        var t = t0
        while (g.next(t) != null) { phases += g.state.phase; t += 1000 }
        assertEquals(Phase.ENDED, g.state.phase)
        assertEquals(
            listOf(Phase.QUESTION, Phase.CLOSED, Phase.REVEAL, Phase.SCORES).let { it + it + it } + Phase.ENDED,
            phases,
        )
        assertNull(g.next(t), "Après la fin, suivant ne fait plus rien")
    }

    @Test
    fun `bonne réponse immédiate rapporte 120, à la dernière seconde 100, mauvaise 0`() {
        val g = playFirst(
            mapOf(
                "rapide" to Answer(1, t0),
                "lente" to Answer(1, t0 + 20_000),
                "fausse" to Answer(2, t0 + 1_000),
            )
        )
        assertEquals(mapOf("rapide" to 120, "lente" to 100, "fausse" to 0), g.state.scores())
    }

    @Test
    fun `le bonus est proportionnel au temps restant`() {
        val g = playFirst(mapOf("moitie" to Answer(1, t0 + 10_000)))
        assertEquals(110, g.state.scores()["moitie"])
    }

    @Test
    fun `la Super Finale double les points`() {
        val g = Game(quiz)
        var t = t0
        repeat(9) { g.next(t); t += 1000 } // jusqu'à l'ouverture de q3
        assertEquals("q3", g.state.qid)
        val opened = g.state.segments.first().start
        g.next(opened + 5_000)
        g.next(opened + 5_100, mapOf("a" to Answer(3, opened)))
        assertEquals(240, g.state.scores()["a"])
    }

    @Test
    fun `une équipe qui n'a pas répondu garde ses points et n'en perd jamais`() {
        val g = playFirst(mapOf("a" to Answer(1, t0)))
        val s = g.state.scores()
        assertEquals(120, s["a"])
        assertTrue(s.values.all { it >= 0 })
    }

    @Test
    fun `double clic sur révéler n'attribue pas deux fois les points`() {
        val g = playFirst(mapOf("a" to Answer(1, t0)))
        assertNull(g.reveal(t0 + 20_200, mapOf("a" to Answer(1, t0))))
        assertEquals(120, g.state.scores()["a"])
    }

    @Test
    fun `rejouer le journal donne exactement les mêmes scores, même avec des doublons`() {
        val g = playFirst(mapOf("a" to Answer(1, t0), "b" to Answer(1, t0 + 5_000)))
        g.adjust("b", 50, "bonus animatrice", t0 + 30_000)
        val replayed = Game(quiz, g.events + g.events + g.events.reversed())
        assertEquals(g.state, replayed.state)
        assertEquals(mapOf("a" to 120, "b" to 165), replayed.state.scores())
    }

    @Test
    fun `un événement impossible dans l'état courant est ignoré`() {
        val g = Game(quiz)
        assertNull(g.close(t0), "On ne ferme pas une question jamais ouverte")
        assertNull(g.resume(t0), "On ne reprend pas une partie qui n'est pas en pause")
        assertFalse(g.record(Revealed(1, t0, "q1", mapOf("x" to Award(1, true, 999, 0)))))
        assertEquals(emptyMap(), g.state.scores())
    }

    @Test
    fun `revenir à une question déjà jouée est refusé`() {
        val g = Game(quiz)
        var t = t0
        repeat(4) { g.next(t); t += 1000 } // q1 jouée, scores affichés
        assertNull(g.openQuestion(0, t))
    }

    @Test
    fun `la pause gèle le chrono et le temps de pause ne compte pas pour le bonus`() {
        val g = Game(quiz)
        g.next(t0)
        g.pause(t0 + 5_000)
        assertTrue(g.state.paused)
        assertNull(g.deadline())
        assertEquals(15_000, g.remainingMs(t0 + 60_000), "Le chrono ne bouge pas en pause")
        g.resume(t0 + 65_000, countdownMs = 0)
        assertEquals(t0 + 80_000, g.deadline())
        // Réponse 5 s après la reprise : 10 s de chrono consommées, il en reste 10.
        g.close(t0 + 80_000)
        g.reveal(t0 + 80_100, mapOf("a" to Answer(1, t0 + 70_000)))
        assertEquals(110, g.state.scores()["a"])
    }

    @Test
    fun `une réponse arrivée avant une pause garde le bonus de son moment`() {
        val g = Game(quiz)
        g.next(t0)
        g.pause(t0 + 10_000)
        g.resume(t0 + 100_000, countdownMs = 0)
        g.close(t0 + 105_000)
        g.reveal(t0 + 105_100, mapOf("a" to Answer(1, t0 + 2_000)))
        assertEquals(118, g.state.scores()["a"])
    }

    @Test
    fun `une correction de score s'annule sans toucher au reste`() {
        val g = playFirst(mapOf("a" to Answer(1, t0)))
        val fix = g.adjust("a", -20, "erreur", t0 + 21_000)!!
        assertEquals(100, g.state.scores()["a"])
        assertIs<Undone>(g.undo(fix.seq, t0 + 22_000))
        assertEquals(120, g.state.scores()["a"])
        assertNull(g.undo(fix.seq, t0 + 23_000), "Annuler deux fois ne fait rien")
        assertNull(g.undo(1, t0 + 23_000), "Seules les corrections sont annulables")
    }

    @Test
    fun `fermer la question fige le chrono`() {
        val g = Game(quiz)
        g.next(t0)
        g.close(t0 + 3_000)
        assertEquals(Phase.CLOSED, g.state.phase)
        assertEquals(3_000, g.state.elapsedAt(t0 + 50_000))
        assertNull(g.deadline())
    }
}
