package com.littlemissparty.quiz.tv.habillage

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Textes posés sur le décor « comme les jauges » (choix B de cedric, 31/10) : fin contour cyan collé aux lettres, sa
 * lueur, une ombre noire bien présente, jamais de carré ni de bande derrière.
 */
class ContourJaugeTest {
    private fun source(chemin: String) = File("src/main/java/com/littlemissparty/quiz/tv/$chemin").readText()

    @Test
    fun `reglages de la planche - cyan 3FE0FF, contour 0,1 x la taille, au moins 3 px sur 1280`() {
        assertEquals(Color(0xFF3FE0FF), CyanContour)
        assertEquals(0.1f, CONTOUR_PART_TAILLE, 0f)
        // 3 px sur 1280 = 2,25 dp sur 960.
        assertEquals(2.25f, CONTOUR_MIN.value, 0.01f)
        // Ombres : la plus large (54 px) > la moyenne (34 px) > la serrée (10-20 px) > la lueur cyan (5 px).
        assertTrue(OMBRE_LARGE > OMBRE_MOYENNE && OMBRE_MOYENNE > OMBRE_SERREE && OMBRE_SERREE > LUEUR_CYAN)
        assertEquals(1600f / 960f, ECHELLE_SCENE_BLIND, 0.001f)
    }

    @Test
    fun `classique inchange, calques muets, meme place que le texte`() {
        val s = source("habillage/ContourJauge.kt")
        assertTrue(s.contains("if (!Look.gs || !contour) {"))
        assertTrue(s.contains("Modifier.matchParentSize().clearAndSetSemantics {}"))
        assertTrue(s.contains("Box(modifier, propagateMinConstraints = true)"))
    }

    @Test
    fun `chaque ecran choisi le 31-10 a son contour et plus de carre`() {
        val ecrans = mapOf(
            "BlindTestEcrans.kt" to "n° 1-2", "GameScreens.kt" to "n° 3", "ImageFloue.kt" to "n° 4-7",
            "habillage/BlindTestScenes.kt" to "n° 9-11", "MimeScreens.kt" to "n° 14, 18", "PictionaryScreens.kt" to "n° 15",
            "habillage/Pictionary.kt" to "n° 16", "GonfleurScreens.kt" to "n° 21", "PatateScreens.kt" to "n° 24",
            "habillage/StatuesGameShow.kt" to "n° 30", "GameShowQuiz.kt" to "n° 36",
        )
        for ((fichier, n) in ecrans) {
            val s = source(fichier)
            assertTrue("$fichier ($n) : contour des jauges", s.contains("TexteJauge("))
            assertFalse("$fichier ($n) : plus de carré", s.contains("filigraneGs("))
            assertFalse("$fichier ($n) : plus de bande", s.contains("bandeTitre()"))
        }
        assertFalse(source("habillage/BlindTestScenes.kt").contains("filigrane(Rect("))
    }

    @Test
    fun `Mimes - Au tour de seul, puis le nom de l'equipe dans sa couleur (plus de « Au tour de Les… »)`() {
        val s = source("MimeScreens.kt")
        assertFalse(s.contains("\"Au tour de \${"))
        assertTrue(s.contains("TexteJauge(\"Au tour de\""))
        assertTrue(s.contains("team.name, color = color"))
    }
}
