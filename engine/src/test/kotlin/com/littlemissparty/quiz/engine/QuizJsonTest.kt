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

    @Test
    fun `illustration facultative, une illustration abimee est ignoree sans bloquer la partie`() {
        val quiz = QuizJson.parse(
            """{"id":"p","questions":[
              {"id":"a","text":"Roi de la jungle ?","choices":["Lion","Tigre"],"correct":0,"image":"🦁","imageId":"0123456789abcdef"},
              {"id":"b","text":"Sans image","choices":["Oui","Non"],"correct":0},
              {"id":"c","text":"Abîmée","choices":["Oui","Non"],"correct":0,"image":"${"x".repeat(40)}","imageId":"../../secret"}]}""",
        )
        assertEquals("🦁", quiz.questions[0].emoji)
        assertEquals("0123456789abcdef", quiz.questions[0].imageId)
        assertEquals(null, quiz.questions[1].emoji)
        assertEquals(null, quiz.questions[1].imageId)
        assertEquals(null, quiz.questions[2].emoji)
        assertEquals(null, quiz.questions[2].imageId)
    }

    @Test
    fun `l'emoji d'illustration n'arrive sur les pupitres qu'a la revelation`() {
        val quiz = Quiz("p", "P", listOf(Question("a", "Roi de la jungle ?", listOf("Lion", "Tigre"), 0, emoji = "🦁")))
        val g = Game(quiz)
        g.next(1_000)
        assertEquals(null, Codec.publicState(g)["image"])
        g.next(2_000)
        g.next(3_000, emptyMap())
        assertEquals("🦁", Codec.publicState(g)["image"])
    }

    @Test
    fun `Pictionary - la photo d'un mot passe jusqu'aux mots proposes, une photo mal formee est ignoree`() {
        val quiz = QuizJson.parse(
            """{"id":"p","questions":[{"id":"r1p","text":"Pictionary","kind":"pictionary","duration":90,"cards":[
              {"word":"Toboggan","image":"🛝","imageId":"0123456789abcdef"},{"word":"Chat","imageId":"pas-une-photo"},{"word":"Lune"}]}]}""",
        )
        assertEquals(listOf("0123456789abcdef", null, null), quiz.questions[0].cards.map { it.imageId })
        val g = Game(quiz)
        g.next(1_000)
        check(g.question?.isPicto == true)
        checkNotNull(g.pictoShow("rose", 3_000))
        @Suppress("UNCHECKED_CAST")
        val offer = (Codec.publicState(g)["mime"] as Map<String, Any?>)["offer"] as List<Map<String, Any?>>
        assertEquals("0123456789abcdef", offer.first { it["word"] == "Toboggan" }["imageId"])
    }
}
