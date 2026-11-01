package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Zoom mystère : une question à propositions dont la photo se dévoile au fil du chrono. */
class ZoomMystereTest {

    private val photo = "0123456789abcdef"
    private val t0 = 1_000_000L

    @Test
    fun `points du quiz classique, la photo n'arrive sur les pupitres qu'à la révélation`() {
        val q = Question("z1", "Quel animal ?", listOf("Chat", "Lion"), 1, durationSec = 20, kind = QuestionKind.ZOOM, imageId = photo)
        val g = Game(Quiz("p", "P", listOf(q))).apply { next(t0) }
        assertEquals("zoom", Codec.publicState(g)["kind"])
        g.close(t0 + 10_000)
        g.next(t0 + 11_000, mapOf("rose" to Answer(1, t0 + 10_000), "bleu" to Answer(0, t0 + 1_000)))
        assertEquals(Scoring.award(q, Answer(1, t0 + 10_000), 0.5).points, g.state.awards["z1"]!!["rose"]!!.points)
        assertEquals(0, g.state.awards["z1"]!!["bleu"]!!.points)
        assertNull(g.expressDelayMs(), "l'animatrice garde la main")
    }

    @Test
    fun `sans photo valable, la question se joue comme une question classique`() {
        assertFailsWith<IllegalArgumentException> { Question("z", "?", listOf("a", "b"), 0, kind = QuestionKind.ZOOM) }
        val quiz = QuizJson.parse(
            """{"id":"p","questions":[
               {"id":"a","text":"Quel animal ?","choices":["Chat","Lion"],"correct":1,"kind":"zoom","imageId":"$photo"},
               {"id":"b","text":"Photo perdue ?","choices":["Oui","Non"],"correct":0,"kind":"zoom","imageId":"../x"}]}""",
        )
        assertTrue(quiz.questions[0].isZoom)
        assertEquals(photo, quiz.questions[0].imageId)
        assertEquals(QuestionKind.CLASSIC, quiz.questions[1].kind)
    }

    @Test
    fun `depart du zoom regle dans la Regie PC, lu par la TV et ramene dans ses limites`() {
        // Cedric, 31/10 : la tête de Mickey visible dès la première image ; format partagé avec departZoom de show.js.
        val quiz = QuizJson.parse(
            """{"id":"p","questions":[
               {"id":"a","text":"?","choices":["A","B"],"correct":0,"kind":"zoom","imageId":"$photo","zoomDepart":{"x":0.25,"y":0.4,"z":9}},
               {"id":"b","text":"?","choices":["A","B"],"correct":0,"kind":"zoom","imageId":"$photo","zoomDepart":{"x":-1,"y":3,"z":40}},
               {"id":"c","text":"?","choices":["A","B"],"correct":0,"kind":"zoom","imageId":"$photo","zoomDepart":{"x":0.5}},
               {"id":"d","text":"?","choices":["A","B"],"correct":0,"kind":"zoom","imageId":"$photo"},
               {"id":"e","text":"?","choices":["A","B"],"correct":0,"zoomDepart":{"x":0.5,"y":0.5,"z":6}}]}""",
        )
        assertEquals(ZoomDepart(0.25f, 0.4f, 9f), quiz.questions[0].zoomDepart)
        assertEquals(ZoomDepart(0f, 1f, 10f), quiz.questions[1].zoomDepart)
        assertNull(quiz.questions[2].zoomDepart, "incomplet : la TV choisit seule")
        assertNull(quiz.questions[3].zoomDepart)
        assertNull(quiz.questions[4].zoomDepart, "seulement au Zoom mystère")
    }
}
