package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Tableau des scores, Game Show : sa jauge d'aujourd'hui, contour néon et ombre plus présente (cedric, 29/10 09 h 17). */
class JaugeScoresTest {

    @Test
    fun `le tableau des scores garde le tube, ajoute le contour neon et l'ombre plus presente, sans graduation`() {
        val source = File("src/main/java/com/littlemissparty/quiz/tv/GameShowQuiz.kt").readText()
        val ombre = source.indexOf("ombreJauge(OmbreDeJauge.PRESENTE)")
        val tube = source.indexOf("if (planches != null) dessineJauge(planches, part, color) else dessineJaugeSimple(part, color)")
        val contour = source.indexOf("contourJauge(color)")
        // L'ombre sous le tube, le contour par-dessus.
        assertTrue(ombre in 0 until tube)
        assertTrue(contour > tube)
        val jauge = File("src/main/java/com/littlemissparty/quiz/tv/habillage/JaugeTube.kt").readText()
        assertFalse(jauge.contains("graduation(") || jauge.contains("fun DrawScope.ecrin"))
    }

    @Test
    fun `trois ombres possibles, la validee est la plus presente`() {
        assertEquals(listOf("AUCUNE", "LEGERE", "PRESENTE"), OmbreDeJauge.entries.map { it.name })
    }
}
