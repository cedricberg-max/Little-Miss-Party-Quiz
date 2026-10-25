package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * Jeux au buzzer hors blind test (cedric, 25/10, règle 2) : une équipe qui s'est trompée peut rebuzzer sur la même
 * question 3 s après le verdict ; toute réponse après une erreur vaut le rebond.
 */
class RebuzzTest {

    private val q = Question("f1", "Qu'est-ce qui se cache sous le flou ?", listOf("Un lion", "Un chat"), 0, durationSec = 40, kind = QuestionKind.FLOU, imageId = "0123456789abcdef")
    private val t0 = 1_000_000L

    private fun game() = Game(Quiz("p", "P", listOf(q))).apply { next(t0) }

    @Test
    fun `l'équipe qui s'est trompée rebuzze 3 s après le verdict, au tarif du rebond`() {
        val g = game()
        g.buzz("rose", t0 + 1_000)
        g.judgeBuzz(false, t0 + 2_000)
        assertEquals(t0 + 2_000 + REBUZZ_DELAY_MS, g.rebuzzAt())
        assertNull(g.buzz("rose", t0 + 4_000), "encore 1 s à attendre")
        assertNotNull(g.buzz("rose", t0 + 5_000), "3 s après le verdict : elle peut retenter")
        g.judgeBuzz(true, t0 + 6_000)
        assertEquals(mapOf("rose" to Scoring.BUZZ_REBOUND), g.state.scores())
    }

    @Test
    fun `une autre équipe peut buzzer tout de suite après le verdict`() {
        val g = game()
        g.buzz("rose", t0 + 1_000)
        g.judgeBuzz(false, t0 + 2_000)
        assertNotNull(g.buzz("bleu", t0 + 2_100))
        assertNull(g.rebuzzAt(), "chrono arrêté pendant la réponse de l'autre équipe")
    }

    @Test
    fun `chaque nouveau verdict relance l'attente de 3 s, et la pause aussi`() {
        val g = game()
        g.buzz("rose", t0 + 1_000)
        g.judgeBuzz(false, t0 + 2_000)
        g.buzz("bleu", t0 + 2_500)
        g.judgeBuzz(false, t0 + 3_000)
        assertNull(g.buzz("rose", t0 + 5_500), "3 s comptées depuis le dernier verdict")
        assertNotNull(g.buzz("rose", t0 + 6_000))
        g.judgeBuzz(false, t0 + 7_000)
        g.pause(t0 + 8_000)
        assertNull(g.rebuzzAt(), "rien pendant la pause")
        g.resume(t0 + 20_000)
        val reprise = assertNotNull(g.rebuzzAt())
        assertNull(g.buzz("rose", reprise - 1_000))
        assertNotNull(g.buzz("rose", reprise))
    }

    @Test
    fun `le journal se relit à l'identique`() {
        val g = game()
        g.buzz("rose", t0 + 1_000)
        g.judgeBuzz(false, t0 + 2_000)
        g.buzz("rose", t0 + 5_000)
        assertEquals(Game(g.quiz, g.events.map { Codec.decode(Codec.encode(it))!! }).state, g.state)
    }
}
