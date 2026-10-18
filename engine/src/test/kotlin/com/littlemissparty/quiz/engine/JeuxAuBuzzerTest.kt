package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Chante le mot ! et Qui suis-je ? : même buzzer que l'image floue, sans photo. */
class JeuxAuBuzzerTest {

    private val chante = Question("c1", "soleil", listOf("soleil"), 0, durationSec = 30, kind = QuestionKind.CHANTE, roundTitle = "Chante le mot !")
    private val indices = listOf("Je vis dans la savane", "J'ai une crinière", "Je rugis très fort", "On m'appelle le roi des animaux").map { MimeCard(it) }
    private val quiSuis = Question("p1", "Qui suis-je ?", listOf("Le lion"), 0, durationSec = 40, kind = QuestionKind.QUISUIS, cards = indices, emoji = "🦁")
    private val t0 = 1_000_000L

    @Test
    fun `chante le mot, premier buzz, la régie valide, 150 points`() {
        val g = Game(Quiz("p", "P", listOf(chante, quiSuis))).apply { next(t0) }
        assertTrue(chante.isBuzz)
        assertEquals(true, Codec.publicState(g)["buzzOpen"])
        assertEquals("chante", Codec.publicState(g)["kind"])
        g.buzz("rose", t0 + 3_000)
        assertNull(g.deadline())
        g.judgeBuzz(true, t0 + 8_000)
        assertEquals(mapOf("rose" to Scoring.BUZZ), g.state.scores())
        assertEquals(Phase.REVEAL, g.state.phase)
    }

    @Test
    fun `qui suis-je, un indice de plus à intervalles réguliers, le rebond vaut 100`() {
        assertEquals(1, quiSuis.cluesShown(0))
        assertEquals(1, quiSuis.cluesShown(9_999))
        assertEquals(2, quiSuis.cluesShown(10_000))
        assertEquals(4, quiSuis.cluesShown(39_000))
        assertEquals(4, quiSuis.cluesShown(80_000))
        assertEquals(0, chante.cluesShown(10_000))
        val g = Game(Quiz("p", "P", listOf(quiSuis))).apply { next(t0) }
        assertNull(Codec.publicState(g)["choices"], "la réponse reste cachée sur les pupitres")
        g.buzz("rose", t0 + 12_000)
        g.judgeBuzz(false, t0 + 15_000)
        g.buzz("bleu", t0 + 20_000)
        g.judgeBuzz(true, t0 + 22_000)
        assertEquals(mapOf("bleu" to Scoring.BUZZ_REBOUND), g.state.scores())
        assertEquals(listOf("Le lion"), Codec.publicState(g)["choices"])
    }

    @Test
    fun `se lisent depuis une prestation, une seule réponse et des indices obligatoires`() {
        val quiz = QuizJson.parse(
            """{"id":"p","questions":[
              {"id":"c","text":"maman","choices":["maman"],"correct":0,"kind":"chante","duration":30},
              {"id":"q","text":"Qui suis-je ?","choices":["Le lion"],"correct":0,"kind":"quisuis","duration":40,"image":"🦁",
               "cards":[{"word":"Je rugis"},{"word":"J'ai une crinière"}]}]}""",
        )
        assertEquals(listOf(QuestionKind.CHANTE, QuestionKind.QUISUIS), quiz.questions.map { it.kind })
        assertEquals(2, quiz.questions[1].cards.size)
        assertEquals("🦁", quiz.questions[1].emoji)
        assertFailsWith<IllegalArgumentException> { Question("x", "Qui ?", listOf("A"), 0, kind = QuestionKind.QUISUIS, cards = listOf(MimeCard("seul"))) }
        assertFailsWith<IllegalArgumentException> { Question("x", "mot", listOf("a", "b"), 0, kind = QuestionKind.CHANTE) }
    }
}
