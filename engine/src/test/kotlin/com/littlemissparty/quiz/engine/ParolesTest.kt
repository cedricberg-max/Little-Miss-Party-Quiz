package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Paroles du refrain au blind test : forme courte envoyée par la Régie PC, lue par la TV. */
class ParolesTest {

    @Test
    fun `phrase par phrase - les mots se suivent dans la phrase, sans jamais traîner`() {
        val p = lireParoles("1000|On chante tous ensemble\n5000|\n6000|Encore une fois")
        assertEquals(3, p.size)
        assertEquals(listOf(1000L, 5000L, 6000L), p.map { it.debutMs })
        assertEquals(listOf(5000L, 6000L, 6000L + FIN_DERNIERE_LIGNE_MS), p.map { it.finMs })
        assertEquals("On chante tous ensemble", p[0].texte)
        // Premier mot au début de la phrase, les suivants dans l'ordre, tous avant la fin.
        val t = p[0].mots.map { it.debutMs }
        assertEquals(1000L, t.first())
        assertTrue(t.zipWithNext().all { (a, b) -> b > a })
        assertTrue(t.last() < 1000L + 4 * 420L, "4 mots : au plus 420 ms par mot")
        // Pause instrumentale : une ligne sans mot.
        assertTrue(p[1].mots.isEmpty())
    }

    @Test
    fun `mot par mot - les temps du fichier sont gardés`() {
        val p = lireParoles("2000|Hey ho|2000,2600\n4000|Let's go|4100,4500")
        assertEquals(listOf(2000L, 2600L), p[0].mots.map { it.debutMs })
        assertEquals(listOf(4100L, 4500L), p[1].mots.map { it.debutMs })
    }

    @Test
    fun `des paroles abîmées n'empêchent jamais de jouer`() {
        assertEquals(emptyList(), lireParoles(null))
        assertEquals(emptyList(), lireParoles(""))
        assertEquals(emptyList(), lireParoles("x".repeat(MAX_PAROLES + 1)))
        // Ligne sans temps ignorée ; temps des mots en mauvais nombre : estimés à la place ; lignes remises dans l'ordre.
        val p = lireParoles("abc|rien\n3000|deux mots|3000\n1000|un")
        assertEquals(listOf(1000L, 3000L), p.map { it.debutMs })
        assertEquals(2, p[1].mots.size)
        assertEquals(3000L, p[1].mots[0].debutMs)
    }

    @Test
    fun `la question du blind test garde ses paroles, seulement avec un refrain`() {
        val json = """{"id":"p","title":"P","questions":[
            {"id":"q1","text":"Quel est ce titre ?","choices":["Un"],"correct":0,"kind":"blind","audioId":"0123456789abcdef",
             "refrainId":"fedcba9876543210","lyrics":"0|La la la"},
            {"id":"q2","text":"Quel est ce titre ?","choices":["Deux"],"correct":0,"kind":"blind","audioId":"0123456789abcdef","lyrics":"0|Sans refrain"},
            {"id":"q3","text":"Trois ?","choices":["a","b"],"correct":0,"refrainId":"fedcba9876543210","lyrics":"0|Pas un blind test"}]}"""
        val quiz = QuizJson.parse(json)
        assertEquals("La la la", quiz.questions[0].paroles.single().texte)
        assertEquals(emptyList(), quiz.questions[1].paroles)
        assertEquals(emptyList(), quiz.questions[2].paroles)
    }
}
