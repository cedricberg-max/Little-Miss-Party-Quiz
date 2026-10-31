package com.littlemissparty.quiz.tv

import com.littlemissparty.quiz.tv.habillage.PART_MOT_MAX
import com.littlemissparty.quiz.tv.habillage.PART_MOT_MIN
import com.littlemissparty.quiz.tv.habillage.partageMotPhrase
import com.littlemissparty.quiz.tv.habillage.partageMotPhraseTient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Jeux au buzzer, textes du 30/10 (Qui suis-je à 8 équipes) : consigne claire, et la phrase de la révélation entière. */
class JeuxAuBuzzerTextesTest {

    @Test
    fun `apres un buzz, la TV dit simplement ce qui se passe`() {
        assertEquals("On écoute sa réponse…", consigneBuzz(chante = false, blind = false))
        assertEquals("On écoute le titre…", consigneBuzz(chante = false, blind = true))
        assertEquals("À vous de chanter !", consigneBuzz(chante = true, blind = false))
        listOf(false, true).forEach { b -> assertFalse("plus de « à voix haute »", consigneBuzz(false, b).contains("voix haute")) }
    }

    @Test
    fun `beaucoup de place, le mot garde sa grande part`() {
        val parts = mutableListOf<Float>()
        partageMotPhrase(600, 80f) { part -> parts += part; Triple(90f, 34f, true) }
        assertEquals(listOf(PART_MOT_MAX), parts)
    }

    @Test
    fun `peu de place, le mot cede jusqu'a ce que la phrase tienne`() {
        val parts = mutableListOf<Float>()
        // La phrase ne tient que si le mot prend 26 % ou moins.
        val (mot, phrase) = partageMotPhrase(220, 80f) { part -> parts += part; Triple(100f * part, 20f, part <= 0.26f + 1e-4f) }
        assertTrue("le mot a cédé de la place", parts.size > 1 && parts.last() <= 0.26f + 1e-4f)
        assertEquals(100f * parts.last(), mot, 0.01f)
        assertEquals(20f, phrase, 0f)
    }

    @Test
    fun `jamais en dessous de la part minimum, jamais de boucle sans fin`() {
        val parts = mutableListOf<Float>()
        partageMotPhrase(100, 80f) { part -> parts += part; Triple(26f, 16f, false) }
        assertTrue(parts.all { it >= PART_MOT_MIN - 1e-3f })
        assertTrue(parts.size < 20)
        val une = mutableListOf<Float>()
        partageMotPhrase(50, 80f) { part -> une += part; Triple(26f, 16f, false) }
        assertEquals("cadre plus petit que les marges : un seul essai", 1, une.size)
    }

    @Test
    fun `le partage dit si la phrase tient, pour passer en mode compact sinon`() {
        assertTrue(partageMotPhraseTient(600, 80f) { Triple(90f, 34f, true) }.third)
        val r = partageMotPhraseTient(150, 80f) { part -> Triple(100f * part, 16f, false) }
        assertFalse("la phrase ne tient pas : le panneau passe en compact", r.third)
    }

    @Test
    fun `qui suis-je a 4 equipes, panneau bas, la phrase reste a l'ecran`() {
        // CI du 31/10 : « Personne n'a trouvé, ce n'est pas grave ! » poussée sous le panneau. En compact, seul le trait de
        // néon laisse sa place ; « C'était : », le mot et la phrase restent. Le panneau du Qui suis-je perd aussi sa grande
        // marge à la révélation.
        val source = java.io.File("src/main/java/com/littlemissparty/quiz/tv/habillage/RevelationNeon.kt").readText()
        assertFalse("« C'était : » reste", source.contains("if (!compacte) Text("))
        assertTrue(source.contains("if (!compacte) Canvas("))
        val panneau = java.io.File("src/main/java/com/littlemissparty/quiz/tv/ImageFloue.kt").readText()
        assertTrue(panneau.contains("val margeReduite = appelQuiSuis || revelationQuiSuis"))
        val phrase = source.substringAfter("// Filigrane A derrière la phrase").substringBefore("\n}\n")
        assertFalse("la phrase ne dépend pas du mode compact", phrase.contains("compacte"))
    }
}
