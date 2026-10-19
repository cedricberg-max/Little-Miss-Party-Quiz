package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Qui a disparu ? : mémoriser les objets, puis buzzer pour dire celui qui manque. */
class QuiADisparuTest {

    private val objets = listOf("Pomme" to "🍎", "Banane" to "🍌", "Fraise" to "🍓", "Cerise" to "🍒", "Raisin" to "🍇", "Poire" to "🍐")
        .map { (w, e) -> MimeCard(w, e) }
    private val disparu = Question(
        "d1", "Qui a disparu ?", listOf("Fraise"), 0, durationSec = 45, kind = QuestionKind.DISPARU,
        cards = objets, emoji = "🍓", roundTitle = "Qui a disparu ?",
    )
    private val t0 = 1_000_000L

    @Test
    fun `le buzzer reste fermé pendant la mémorisation, puis s'ouvre et la régie valide`() {
        assertEquals(12_000, disparu.memoMs)
        assertEquals(15_000, disparu.buzzFromMs)
        assertEquals(2, disparu.missingIndex)
        assertTrue(disparu.isBuzz)
        val g = Game(Quiz("p", "P", listOf(disparu))).apply { next(t0) }
        assertEquals(false, Codec.publicState(g)["buzzOpen"], "on ne buzze pas pendant qu'on mémorise")
        assertNull(g.buzz("rose", t0 + 5_000), "un buzz trop tôt ne compte pas")
        assertEquals(15_000, g.armDelayMs(t0))
        assertNull(g.armBuzz(t0 + 10_000), "jamais avant la fin de la mémorisation")
        g.armBuzz(t0 + 15_000)
        assertEquals(true, Codec.publicState(g)["buzzOpen"])
        assertNull(g.armDelayMs(t0 + 15_000))
        g.buzz("rose", t0 + 18_000)
        g.judgeBuzz(true, t0 + 20_000)
        assertEquals(mapOf("rose" to Scoring.BUZZ), g.state.scores())
        assertEquals(listOf("Fraise"), Codec.publicState(g)["choices"])
        assertEquals("🍓", Codec.publicState(g)["image"])
    }

    @Test
    fun `une pause pendant la mémorisation repousse l'ouverture du buzzer`() {
        val g = Game(Quiz("p", "P", listOf(disparu))).apply { next(t0) }
        g.pause(t0 + 5_000)
        assertNull(g.armDelayMs(t0 + 8_000), "en pause, on n'ouvre rien")
        g.resume(t0 + 60_000, countdownMs = 0)
        assertEquals(10_000, g.armDelayMs(t0 + 60_000))
        assertNull(g.armBuzz(t0 + 65_000))
        g.armBuzz(t0 + 70_000)
        assertEquals(true, Codec.publicState(g)["buzzOpen"])
    }

    @Test
    fun `après une erreur, le buzzer reste ouvert pour les autres et le rebond vaut 100`() {
        val g = Game(Quiz("p", "P", listOf(disparu))).apply { next(t0) }
        g.armBuzz(t0 + 15_000)
        g.buzz("rose", t0 + 16_000)
        g.judgeBuzz(false, t0 + 18_000)
        assertEquals(true, Codec.publicState(g)["buzzOpen"])
        g.buzz("bleu", t0 + 19_000)
        g.judgeBuzz(true, t0 + 20_000)
        assertEquals(mapOf("bleu" to Scoring.BUZZ_REBOUND), g.state.scores())
    }

    @Test
    fun `le journal relu redonne le même état, et la question se lit depuis une prestation`() {
        val g = Game(Quiz("p", "P", listOf(disparu))).apply { next(t0) }
        g.armBuzz(t0 + 15_000)
        g.buzz("rose", t0 + 16_000)
        val copy = Game(Quiz("p", "P", listOf(disparu)))
        g.events.forEach { copy.record(Codec.decode(Codec.encode(it))!!) }
        assertEquals(g.state, copy.state)

        val quiz = QuizJson.parse(
            """{"id":"p","questions":[{"id":"d","text":"Qui a disparu ?","choices":["Chat"],"correct":0,"kind":"disparu","duration":45,"image":"🐱",
               "cards":[{"word":"Chat","image":"🐱"},{"word":"Chien","image":"🐶"},{"word":"Lapin","image":"🐰"},{"word":"Souris","image":"🐭"}]}]}""",
        )
        assertEquals(QuestionKind.DISPARU, quiz.questions[0].kind)
        assertEquals(0, quiz.questions[0].missingIndex)
        assertEquals(10_000, quiz.questions[0].memoMs, "au moins 10 secondes pour mémoriser")
    }

    @Test
    fun `refuse un objet disparu absent de la grille, trop peu d'objets ou un chrono trop court`() {
        assertFailsWith<IllegalArgumentException> { disparu.copy(choices = listOf("Kiwi")) }
        assertFailsWith<IllegalArgumentException> { disparu.copy(cards = objets.take(3), choices = listOf("Pomme")) }
        assertFailsWith<IllegalArgumentException> { disparu.copy(durationSec = 20) }
    }
}
