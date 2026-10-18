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

    @Test
    fun `une prestation chargée depuis Firebase se lit comme un fichier`() {
        // Firebase renvoie des Map, des List et des Long.
        val value = mapOf(
            "id" to "show1",
            "title" to "L'anniversaire de Léa",
            "questions" to listOf(
                mapOf("id" to "r1q1", "text" to "Roi de la jungle ?", "choices" to listOf("Lion", "Tigre", "Zèbre", "Singe"),
                    "correct" to 0L, "duration" to 35L, "kind" to "classic", "double" to false, "round" to "Animaux"),
                mapOf("id" to "r2q1", "text" to "Le Soleil est une étoile", "choices" to listOf("Vrai", "Faux"),
                    "correct" to 0L, "duration" to 35L, "kind" to "true_false", "double" to true, "round" to "Super Finale"),
            ),
        )
        val quiz = QuizJson.fromValue(value)
        assertEquals("L'anniversaire de Léa", quiz.title)
        assertEquals(listOf("r1q1", "r2q1"), quiz.questions.map { it.id })
        assertEquals(35, quiz.questions[0].durationSec)
        assertEquals("Animaux", quiz.questions[0].roundTitle)
        assertTrue(quiz.questions[1].double)
        assertEquals(QuestionKind.TRUE_FALSE, quiz.questions[1].kind)
    }

    @Test
    fun `une prestation abîmée est refusée`() {
        assertFailsWith<IllegalArgumentException> { QuizJson.fromValue(null) }
        assertFailsWith<Exception> {
            QuizJson.fromValue(mapOf("id" to "x", "questions" to listOf(mapOf("id" to "q1", "text" to "?", "choices" to listOf("a"), "correct" to 0L))))
        }
    }
}
