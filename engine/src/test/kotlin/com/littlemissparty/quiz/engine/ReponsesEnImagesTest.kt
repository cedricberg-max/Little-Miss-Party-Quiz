package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Réponses en images (quiz des petits) : une photo par proposition, mêlées aux questions en texte. */
class ReponsesEnImagesTest {

    private val lion = "0123456789abcdef"
    private val chien = "fedcba9876543210"
    private val t0 = 1_000_000L

    @Test
    fun `le quiz mêle questions en images et en texte, une photo mal formée reste en texte`() {
        val quiz = QuizJson.parse(
            """{"id":"p","questions":[
               {"id":"a","text":"Qui court vite ?","choices":["Lion","Baleine","Chien"],"correct":0,"choiceImages":["$lion","","$chien"]},
               {"id":"b","text":"Capitale ?","choices":["Paris","Rome"],"correct":0},
               {"id":"c","text":"Abîmée ?","choices":["Oui","Non"],"correct":0,"choiceImages":["../x",null]},
               {"id":"d","text":"Express ?","choices":["Vrai","Faux"],"correct":0,"kind":"express","choiceImages":["$lion","$chien"]}]}""",
        )
        assertEquals(listOf(lion, null, chien), quiz.questions[0].choiceImages)
        assertTrue(quiz.questions[0].hasChoiceImages)
        assertTrue(quiz.questions[1].choiceImages.isEmpty(), "question en texte inchangée")
        assertTrue(quiz.questions[2].choiceImages.isEmpty(), "aucune photo valable : texte")
        assertTrue(quiz.questions[3].choiceImages.isEmpty(), "Vrai ou Faux express : toujours en texte")
        assertFailsWith<IllegalArgumentException> { Question("x", "?", listOf("a", "b"), 0, choiceImages = listOf(lion)) }
    }

    @Test
    fun `les pupitres reçoivent les photos dès la question, les points restent ceux du QCM`() {
        val q = Question("a", "Qui court vite ?", listOf("Lion", "Baleine"), 0, durationSec = 20, choiceImages = listOf(lion, null))
        val texte = Question("b", "Capitale ?", listOf("Paris", "Rome"), 0, durationSec = 20)
        val g = Game(Quiz("p", "P", listOf(q, texte))).apply { next(t0) }
        assertEquals(listOf(lion, ""), Codec.publicState(g)["choiceImages"])
        assertNull(Codec.publicState(g)["correct"], "la bonne réponse reste cachée")
        g.close(t0 + 5_000)
        g.next(t0 + 6_000, mapOf("rose" to Answer(0, t0 + 2_000), "bleu" to Answer(1, t0 + 1_000)))
        assertTrue(g.state.awards["a"]!!["rose"]!!.points >= Scoring.BASE, "bonne réponse en image : points du QCM")
        assertEquals(0, g.state.awards["a"]!!["bleu"]!!.points)
        var t = t0 + 7_000
        while (g.question?.id != "b" && t < t0 + 20_000) g.next(t.also { t += 1_000 })
        assertEquals("b", g.question?.id)
        assertFalse(Codec.publicState(g).containsKey("choiceImages") && Codec.publicState(g)["choiceImages"] != null, "question suivante en texte")
    }
}
