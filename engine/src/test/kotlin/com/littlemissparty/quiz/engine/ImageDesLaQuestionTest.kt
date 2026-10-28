package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Photo montrée dès la question au Quiz classique (« À quel pays est ce drapeau ? », cedric, 28/10). */
class ImageDesLaQuestionTest {

    private val drapeau = "0123456789abcdef"
    private val t0 = 1_000_000L

    @Test
    fun `un QCM avec sa photo la montre dès la question`() {
        val quiz = QuizJson.parse(
            """{"id":"d","questions":[
               {"id":"a","text":"À quel pays est ce drapeau ?","choices":["France","Italie","Japon","Canada"],"correct":2,"imageId":"$drapeau","imageVisible":true}]}""",
        )
        val q = quiz.questions[0]
        assertTrue(q.imageVisible)
        assertEquals(drapeau, q.imageId)
    }

    @Test
    fun `sans photo valable, hors QCM ou en quiz musical, l'option est ignorée sans jamais refuser de jouer`() {
        val quiz = QuizJson.parse(
            """{"id":"d","questions":[
               {"id":"a","text":"Sans photo ?","choices":["Oui","Non"],"correct":0,"imageVisible":true},
               {"id":"b","text":"Photo abîmée ?","choices":["Oui","Non"],"correct":0,"imageId":"../x","imageVisible":true},
               {"id":"c","text":"Combien ?","choices":[],"correct":50,"kind":"number","imageId":"$drapeau","imageVisible":true},
               {"id":"e","text":"Express ?","choices":["Vrai","Faux"],"correct":0,"kind":"express","imageId":"$drapeau","imageVisible":true},
               {"id":"f","text":"Quel titre ?","choices":["A","B"],"correct":0,"audioId":"fedcba9876543210","imageId":"$drapeau","imageVisible":true},
               {"id":"g","text":"Pas un booléen ?","choices":["Oui","Non"],"correct":0,"imageId":"$drapeau","imageVisible":"oui"}]}""",
        )
        assertEquals(6, quiz.questions.size, "toutes les questions restent jouables")
        quiz.questions.forEach { assertFalse(it.imageVisible, "question ${it.id}") }
    }

    @Test
    fun `sans l'option, la photo reste pour la révélation et la partie se joue comme avant`() {
        val quiz = QuizJson.parse(
            """{"id":"d","questions":[
               {"id":"a","text":"Capitale de la France ?","choices":["Paris","Lyon"],"correct":0,"imageId":"$drapeau"},
               {"id":"b","text":"Ce drapeau ?","choices":["Japon","Chine"],"correct":0,"imageId":"$drapeau","imageVisible":true}]}""",
        )
        assertFalse(quiz.questions[0].imageVisible)
        val g = Game(quiz).apply { next(t0) }
        g.close(t0 + 5_000)
        g.next(t0 + 6_000, mapOf("rose" to Answer(0, t0 + 2_000)))
        assertTrue(g.state.awards["a"]!!["rose"]!!.points >= Scoring.BASE, "points du QCM inchangés")
        var t = t0 + 7_000
        while (g.question?.id != "b" && t < t0 + 20_000) g.next(t.also { t += 1_000 })
        assertEquals("b", g.question?.id)
        assertTrue(g.question!!.imageVisible)
    }
}
