package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Portes qui se rouvrent sur le jeu suivant (cedric, 31/10) : quelques images de « texture métallique à traits »
 * passaient avant le décor. Le décor vidéo ne remplace sa photo qu'après quelques images vraiment reçues, et une reprise
 * au milieu de la vidéo part d'une image clé.
 */
class DecorImagesPropresTest {

    @Test
    fun `la photo reste tant que les premieres images ne sont pas arrivees`() {
        assertFalse(fondPret(renduCommence = false, recues = 10, attendues = IMAGES_PROPRES_DECOR))
        assertFalse(fondPret(renduCommence = true, recues = 0, attendues = IMAGES_PROPRES_DECOR))
        assertFalse(fondPret(renduCommence = true, recues = IMAGES_PROPRES_DECOR - 1, attendues = IMAGES_PROPRES_DECOR))
        assertTrue(fondPret(renduCommence = true, recues = IMAGES_PROPRES_DECOR, attendues = IMAGES_PROPRES_DECOR))
    }

    @Test
    fun `les autres videos se montrent des leur premiere image, comme avant`() {
        assertTrue(fondPret(renduCommence = true, recues = 0, attendues = 0))
        assertFalse(fondPret(renduCommence = false, recues = 0, attendues = 0))
    }

    @Test
    fun `attente courte et bornee`() {
        assertTrue(IMAGES_PROPRES_DECOR in 2..6)
        assertTrue(ATTENTE_IMAGES_MAX_MS in 200L..1_000L)
    }

    @Test
    fun `le plateau et l'accueil attendent leurs images propres, la reprise part d'une image cle`() {
        val src = File("src/main/java/com/littlemissparty/quiz/tv/habillage/FondVideo.kt").readText()
        val plateau = src.lines().first { "R.raw.gs_fond_plateau" in it }
        assertTrue(plateau, "imagesAvantPret = IMAGES_PROPRES_DECOR" in plateau && "departSurImageCle = true" in plateau)
        val accueil = src.lines().first { "R.raw.gs_accueil_video" in it && "LecteurFond(" in it }
        assertTrue(accueil, "imagesAvantPret = IMAGES_PROPRES_DECOR" in accueil)
        assertTrue("MediaPlayer.SEEK_CLOSEST_SYNC" in src)
    }
}
