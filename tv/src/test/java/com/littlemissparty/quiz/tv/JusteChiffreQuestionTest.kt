package com.littlemissparty.quiz.tv

import com.littlemissparty.quiz.tv.habillage.HALO_DECOR
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Soirée du 1/11 (TV 0.1.969/971, 8 équipes) : « LE JUSTE CHIFFRE » trop fondu dans le décor, et la phrase sous le
 * compteur mystère coupée.
 */
class JusteChiffreQuestionTest {
    @Test
    fun `le titre du Game Show est detache par un halo noir plus marque que la regle des petits textes`() {
        assertTrue(HALO_DECOR in HALOS_TITRE_JUSTE)
        assertTrue(HALOS_TITRE_JUSTE.size >= 2)
        assertTrue(HALOS_TITRE_JUSTE.all { it.color == androidx.compose.ui.graphics.Color.Black })
        assertTrue(HALOS_TITRE_JUSTE.maxOf { it.blurRadius } > HALO_DECOR.blurRadius)
    }

    @Test
    fun `les phrases sous le compteur tiennent toujours entieres, le compteur se reduit`() {
        val code = java.io.File("src/main/java/com/littlemissparty/quiz/tv/JusteChiffre.kt").readText()
        val question = code.substringAfter("if (!revealed) {").substringBefore("} else {")
        assertTrue(question.contains("TexteAjuste(\n                        \"Tapez votre nombre sur le pupitre !\""))
        assertTrue(question.contains("TexteAjuste(\n                        \"L'équipe la plus proche gagne.\""))
        assertTrue(question.contains("maxHeight * PART_COMPTEUR_JUSTE"))
        assertTrue(PART_COMPTEUR_JUSTE in 0.3f..0.5f)
    }
}
