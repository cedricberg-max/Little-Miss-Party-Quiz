package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * « Portes mystères » est supprimé (cedric, 31/10). Un vieux pack qui en contient encore se joue sans ces questions,
 * et les événements des anciennes parties ne cassent pas la reprise : rien n'est effacé, rien ne plante.
 */
class AncienJeuPortesTest {
    @Test
    fun `un vieux pack avec des portes se joue sans elles`() {
        val quiz = QuizJson.parse(
            """{"id":"vieux","title":"Vieux pack","questions":[
              {"id":"q1","text":"Capitale de la France ?","choices":["Paris","Lyon","Nice","Lille"],"correct":0,"round":"Quiz"},
              {"id":"pm","text":"Portes mystères","choices":["Porte 1","Porte 2"],"correct":-1,"kind":"portes","doors":[100,-100],"round":"Portes mystères"},
              {"id":"q2","text":"2 + 2 ?","choices":["3","4","5","6"],"correct":1,"round":"Quiz"}
            ]}""",
        )
        assertEquals(listOf("q1", "q2"), quiz.questions.map { it.id })
        assertEquals(QuestionKind.entries.none { it.code == "portes" }, true)
    }

    @Test
    fun `les evenements des portes des anciennes parties sont ignores`() {
        assertNull(Codec.decode(mapOf("type" to "door", "seq" to 3, "at" to 1_000L, "qid" to "pm")))
        assertNull(Codec.decode(mapOf("type" to "doorset", "seq" to 4, "at" to 1_000L, "qid" to "pm", "door" to 0, "value" to 100)))
    }
}
