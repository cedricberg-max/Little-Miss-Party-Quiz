package com.littlemissparty.quiz.tv.habillage

import androidx.compose.ui.graphics.Color
import com.littlemissparty.quiz.tv.PART_NOM_EN_TETE
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
        assertTrue(OMBRE_LARGE > OMBRE_MOYENNE && OMBRE_MOYENNE > OMBRE_PROCHE && OMBRE_PROCHE > OMBRE_SERREE && OMBRE_SERREE > LUEUR_CYAN)
        // Android plafonne le flou d'une ombre de texte à 25 px : 12,5 dp sur une box en 1080p (densité 2).
        assertTrue(OMBRE_LARGE.value * 2f <= 25f)
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
    fun `chaque texte blanc choisi le 31-10 a son contour et plus de carre`() {
        // Les onglets d'appel et de conseil (n° 2, 4-8, 11, 21, 24, 29, 30, cedric 09:19) deviendront des plaques néon : pas
        // de contour pour eux.
        val ecrans = mapOf(
            "BlindTestEcrans.kt" to "n° 1", "GameScreens.kt" to "n° 3", "ImageFloue.kt" to "nom de l'équipe qui a buzzé",
            "habillage/BlindTestScenes.kt" to "n° 9-10", "MimeScreens.kt" to "n° 14, 18", "PictionaryScreens.kt" to "n° 15",
            "GameShowQuiz.kt" to "n° 36",
        )
        // n° 16, intro du Pictionary : le halo noir doux du Chrono depuis le 1/11 (point 33, voir HaloDecorTest).
        assertFalse(source("habillage/Pictionary.kt").contains("filigraneGs("))
        for ((fichier, n) in ecrans) {
            val s = source(fichier)
            assertTrue("$fichier ($n) : contour des jauges", s.contains("TexteJauge("))
            assertFalse("$fichier ($n) : plus de carré", s.contains("filigraneGs("))
            assertFalse("$fichier ($n) : plus de bande", s.contains("bandeTitre()"))
        }
        assertFalse(source("habillage/BlindTestScenes.kt").contains("filigrane(Rect("))
        assertFalse(source("GonfleurScreens.kt").contains("TexteJauge("))
        assertFalse(source("PatateScreens.kt").contains("TexteJauge("))
        assertFalse(source("habillage/StatuesGameShow.kt").contains("TexteJauge("))
        // Classique : l'appel en texte simple ; Game Show : l'onglet d'appel néon, sans contour jauges (31/10 à 11:12).
        assertTrue(source("BlindTestEcrans.kt").contains("else -> Text(\n                    \"Buzzez dès que vous reconnaissez la chanson !\""))
        assertTrue(source("BlindTestEcrans.kt").contains("PlaqueAppel(GenrePlaque.BLIND, \"BUZZEZ !\""))
    }

    @Test
    fun `Mimes - Au tour de seul, puis le nom de l'equipe dans sa couleur (plus de « Au tour de Les… »)`() {
        val s = source("MimeScreens.kt")
        assertFalse(s.contains("\"Au tour de \${"))
        assertTrue(s.contains("TexteJauge(\"Au tour de\""))
        assertTrue(s.contains("team.name, color = couleur"))
        // Dans l'en-tête, à la hauteur du chrono : la carte du tour ne rapetisse pas (Mimes rognés à 4 équipes, 31/10).
        val enTete = s.substringAfter("private fun EnTeteTour(").substringBefore("\n}\n")
        assertTrue(enTete.contains("TexteJauge(\"Au tour de\"") && enTete.contains("MimeCountdown(state)"))
        val tour = s.substringAfter("private fun Turn(").substringBefore("\n}\n")
        assertFalse(tour.contains("Au tour de"))
        assertTrue(PART_NOM_EN_TETE in 0.3f..0.5f)
    }

    @Test
    fun `contour - lettres en gras au moins, comme la planche (le blanc ne doit pas paraitre cyan)`() {
        val s = source("habillage/ContourJauge.kt")
        assertTrue(s.contains("maxOf(base.fontWeight ?: FontWeight.Normal, FontWeight.Bold)"))
        assertTrue(s.contains("style = plein)"))
        assertFalse(s.contains("base.copy(color = "))
        // Ombres de nuit sous les lettres pleines (comme le text-shadow de la planche), seul le cyan est un contour.
        assertEquals(4, Regex("plein.copy\\(color = NuitContour, shadow").findAll(s).count())
        assertEquals(1, Regex("drawStyle = Stroke\\(trait\\)").findAll(s).count())
    }
}
