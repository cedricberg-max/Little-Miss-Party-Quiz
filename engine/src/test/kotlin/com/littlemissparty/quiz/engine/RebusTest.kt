package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

/** Le Rébus : les morceaux se dévoilent un à un, la première équipe qui buzze dit le mot, plus tôt = plus de points. */
class RebusTest {

    private val photo = "0123456789abcdef"
    private fun rebus(id: String = "r1", morceaux: Int = 3, double: Boolean = false) = Question(
        id, "Quel est ce mot ?", listOf("Pinceau"), 0, durationSec = 36, kind = QuestionKind.REBUS, double = double,
        cards = (1..morceaux).map { MimeCard("m$it", imageId = photo) },
    )
    private val t0 = 1_000_000L

    private fun game(vararg q: Question) = Game(Quiz("p", "P", q.toList())).apply { next(t0) }

    @Test
    fun `un morceau de plus toutes les 12 s, le chrono et les morceaux se figent au buzz`() {
        val q = rebus()
        assertEquals(1, q.cluesShown(0))
        assertEquals(1, q.cluesShown(11_999))
        assertEquals(2, q.cluesShown(12_000))
        assertEquals(3, q.cluesShown(30_000))
        assertEquals(3, q.cluesShown(99_000))
        val g = game(q)
        assertEquals(true, Codec.publicState(g)["buzzOpen"])
        assertNull(Codec.publicState(g)["choices"], "le mot ne part jamais sur les tablettes avant la révélation")
        g.buzz("rose", t0 + 13_000)
        assertNull(g.deadline())
        assertEquals(2, q.cluesShown(g.state.elapsedAt(t0 + 60_000)), "figé sur deux morceaux pendant la réponse")
    }

    @Test
    fun `300 points avec un morceau, 200 avec deux, 100 ensuite, doublés en Super Finale`() {
        val g1 = game(rebus())
        g1.buzz("rose", t0 + 5_000); g1.judgeBuzz(true, t0 + 7_000)
        assertEquals(mapOf("rose" to 300), g1.state.scores())
        val g2 = game(rebus())
        g2.buzz("rose", t0 + 13_000); g2.judgeBuzz(true, t0 + 15_000)
        assertEquals(mapOf("rose" to 200), g2.state.scores())
        val g3 = game(rebus())
        g3.buzz("rose", t0 + 25_000); g3.judgeBuzz(true, t0 + 27_000)
        assertEquals(mapOf("rose" to 100), g3.state.scores())
        val g4 = game(rebus(double = true))
        g4.buzz("bleu", t0 + 1_000); g4.judgeBuzz(true, t0 + 2_000)
        assertEquals(mapOf("bleu" to 600), g4.state.scores())
    }

    @Test
    fun `mauvaise réponse, l'équipe attend 3 s, les morceaux reprennent, la suivante gagne selon ce qu'elle a vu`() {
        val g = game(rebus())
        g.buzz("rose", t0 + 5_000)
        g.judgeBuzz(false, t0 + 9_000)
        assertEquals(listOf("rose"), g.state.buzz!!.blocked)
        assertNull(g.buzz("rose", t0 + 10_000))
        // 5 s avant le buzz + 9 s après la reprise = 14 s de chrono : deux morceaux.
        g.buzz("bleu", t0 + 18_000)
        g.judgeBuzz(true, t0 + 19_000)
        assertEquals(mapOf("bleu" to 200), g.state.scores())
    }

    @Test
    fun `chrono écoulé sans bonne réponse, personne ne marque, on passe au rébus suivant`() {
        val g = game(rebus("a"), rebus("b"))
        g.timeUp(t0 + 36_000)
        assertEquals(Phase.CLOSED, g.state.phase)
        g.next(t0 + 37_000)
        assertEquals(Phase.REVEAL, g.state.phase)
        assertEquals(emptyMap(), g.state.scores())
    }

    @Test
    fun `pack lu depuis la Régie PC, durée par défaut 12 s par morceau, de 2 à 6 morceaux`() {
        val quiz = QuizJson.parse(
            """{"id":"p","questions":[
               {"id":"a","text":"Quel est ce mot ?","choices":["Pompier"],"correct":0,"kind":"rebus",
                "cards":[{"word":"pont","imageId":"$photo"},{"word":"pied","image":"🦶"}]},
               {"id":"b","text":"Quel est ce mot ?","choices":["Saucisse"],"correct":0,"kind":"rebus","duration":30,
                "cards":[{"word":"seau","imageId":"$photo"},{"word":"6"}]}]}""",
        )
        assertEquals(QuestionKind.REBUS, quiz.questions[0].kind)
        assertEquals(24, quiz.questions[0].durationSec)
        assertEquals("🦶", quiz.questions[0].cards[1].image)
        assertEquals(30, quiz.questions[1].durationSec)
        assertNull(quiz.questions[1].cards[1].imageId, "une lettre ou un chiffre : écrit en néon sur la TV")
        assertFailsWith<IllegalArgumentException> { rebus(morceaux = 1) }
        assertFailsWith<IllegalArgumentException> { rebus(morceaux = 7) }
    }
}
