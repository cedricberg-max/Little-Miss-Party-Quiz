package com.littlemissparty.quiz.engine

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class QuizJsonTest {

    @Test
    fun `le quiz de démonstration livré avec la box est valide`() {
        val quiz = QuizJson.parse(File("../tv/src/main/assets/quizzes/demo.json").readText())
        assertEquals("demo", quiz.id)
        assertTrue(quiz.questions.size >= 10)
        assertTrue(quiz.questions.last().double, "Le quiz se termine par la Super Finale")
        assertTrue(quiz.questions.any { it.kind == QuestionKind.TRUE_FALSE })
    }

    @Test
    fun `une bonne réponse hors des propositions est refusée avec le nom de la question`() {
        val e = assertFailsWith<IllegalArgumentException> {
            QuizJson.parse("""{"id":"x","questions":[{"id":"q7","text":"?","choices":["a","b"],"correct":3}]}""")
        }
        assertTrue("q7" in e.message!!)
    }
}
