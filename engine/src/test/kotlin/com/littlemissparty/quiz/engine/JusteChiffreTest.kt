package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Le Juste Chiffre : chaque équipe tape un nombre, la ou les plus proches gagnent. */
class JusteChiffreTest {

    private val quiz = Quiz(
        "p", "P",
        listOf(
            Question("n1", "Combien d'os dans le corps humain ?", emptyList(), correct = 206, durationSec = 30, kind = QuestionKind.NUMBER),
            Question("n2", "Super Finale : hauteur de la tour Eiffel (m) ?", emptyList(), correct = 330, durationSec = 30, kind = QuestionKind.NUMBER, double = true),
        ),
    )
    private val t0 = 1_000_000L

    private fun Game.play(answers: Map<String, Answer>) {
        next(t0 + 1_000)
        next(t0 + 2_000, answers)
    }

    @Test
    fun `la plus proche gagne, la vitesse ne compte pas`() {
        val g = Game(quiz).apply { next(t0) }
        g.play(mapOf("rose" to Answer(200, t0 + 900), "bleu" to Answer(210, t0 + 100), "vert" to Answer(500, t0 + 50)))
        val a = g.state.awards["n1"]!!
        assertEquals(Scoring.NUMBER_CLOSEST, a["bleu"]!!.points, "4 d'écart : la plus proche")
        assertTrue(a["bleu"]!!.correct)
        assertEquals(0, a["rose"]!!.points)
        assertEquals(0, a["vert"]!!.points)
        assertFalse(a["vert"]!!.correct)
        assertEquals(0, a["bleu"]!!.bonus)
    }

    @Test
    fun `égalité de distance, toutes les équipes à égalité marquent, pile le bon nombre rapporte plus`() {
        val g = Game(quiz).apply { next(t0) }
        g.play(mapOf("rose" to Answer(200, t0), "bleu" to Answer(212, t0)))
        assertEquals(Scoring.NUMBER_CLOSEST, g.state.awards["n1"]!!["rose"]!!.points)
        assertEquals(Scoring.NUMBER_CLOSEST, g.state.awards["n1"]!!["bleu"]!!.points)
        val exact = Game(quiz).apply { next(t0) }
        exact.play(mapOf("rose" to Answer(206, t0), "bleu" to Answer(206, t0), "vert" to Answer(207, t0)))
        assertEquals(Scoring.NUMBER_EXACT, exact.state.awards["n1"]!!["rose"]!!.points)
        assertEquals(Scoring.NUMBER_EXACT, exact.state.awards["n1"]!!["bleu"]!!.points)
        assertEquals(0, exact.state.awards["n1"]!!["vert"]!!.points)
    }

    @Test
    fun `super finale double les points, personne n'a répondu = personne ne marque`() {
        val g = Game(quiz).apply { next(t0) }
        g.play(emptyMap())
        assertTrue(g.state.awards["n1"].orEmpty().isEmpty())
        g.next(t0 + 3_000)
        g.next(t0 + 4_000)
        g.next(t0 + 5_000)
        g.next(t0 + 6_000, mapOf("rose" to Answer(300, t0)))
        assertEquals(2 * Scoring.NUMBER_CLOSEST, g.state.awards["n2"]!!["rose"]!!.points)
    }

    @Test
    fun `le nombre n'arrive sur les pupitres qu'à la révélation`() {
        val g = Game(quiz).apply { next(t0) }
        assertEquals("number", Codec.publicState(g)["kind"])
        assertNull(Codec.publicState(g)["correct"])
        g.play(mapOf("rose" to Answer(206, t0)))
        assertEquals(206, Codec.publicState(g)["correct"])
    }

    @Test
    fun `se lit depuis une prestation, et une question mal formée est refusée`() {
        val q = QuizJson.parse("""{"id":"p","questions":[{"id":"n","text":"Combien ?","kind":"number","correct":42,"duration":20}]}""").questions.single()
        assertTrue(q.isNumber)
        assertEquals(42, q.correct)
        assertFailsWith<IllegalArgumentException> {
            Question("x", "?", listOf("a", "b"), correct = 1, kind = QuestionKind.NUMBER)
        }
    }

    @Test
    fun `rejouer une question du Juste Chiffre ne compte jamais deux fois`() {
        val g = Game(quiz).apply { next(t0) }
        g.play(mapOf("rose" to Answer(206, t0)))
        g.next(t0 + 3_000)
        g.goto(0, t0 + 4_000)
        assertNull(g.state.scores()["rose"]?.takeIf { it != 0 })
        g.next(t0 + 5_000)
        g.next(t0 + 6_000, mapOf("rose" to Answer(206, t0 + 4_500)))
        assertEquals(Scoring.NUMBER_EXACT, g.state.scores()["rose"])
    }
}
