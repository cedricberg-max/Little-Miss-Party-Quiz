package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Écran de fin cinéma du Game Show : la vidéo part sur un temps de la musique sans rien couper de l'arrivée, sa
 * boucle de 16 s reste dans [8 s, 24 s[ et suit les tours d'Aerodynamic sans jamais sauter de plus d'un demi-temps.
 */
class FinGameShowTest {

    @Test
    fun `sans musique la video part tout de suite, avec musique sur le prochain temps`() {
        assertEquals(0, attenteFin(50_000L, 0L))
        assertEquals(0, attenteFin(50_000L, 40_000L))
        assertEquals(200, attenteFin(50_300L, 40_000L))
        assertEquals(1, attenteFin(50_499L, 40_000L))
        // Toujours moins d'un temps, et la vidéo part pile sur un temps de la musique.
        for (m in 40_000L..42_000L step 37) {
            val a = attenteFin(m, 40_000L)
            assertTrue(a in 0 until FIN_TEMPS_MS)
            assertEquals(0L, Math.floorMod(m + a - 40_000L, FIN_TEMPS_MS.toLong()))
        }
    }

    @Test
    fun `la boucle reste entre 8 et 24 s et repart du debut de la boucle a chaque tour`() {
        val ancre = 100_000L
        assertEquals(FIN_BOUCLE_DEBUT_MS, positionFinAttendue(ancre, ancre))
        assertEquals(FIN_BOUCLE_DEBUT_MS + 5_000, positionFinAttendue(ancre + 5_000, ancre))
        assertEquals(FIN_BOUCLE_DEBUT_MS, positionFinAttendue(ancre + FIN_BOUCLE_MS, ancre))
        assertEquals(FIN_BOUCLE_DEBUT_MS + 1_000, positionFinAttendue(ancre + 3 * FIN_BOUCLE_MS + 1_000, ancre))
        for (m in ancre..ancre + 60_000 step 113) {
            val p = positionFinAttendue(m, ancre)
            assertTrue("$p hors de la boucle", p in FIN_BOUCLE_DEBUT_MS until FIN_BOUCLE_DEBUT_MS + FIN_BOUCLE_MS)
        }
    }

    @Test
    fun `l'ancre se pose sur le temps de la musique le plus proche`() {
        assertEquals(10_000L, ancreSurMusique(10_000L, 0L))           // pas de musique : rien ne bouge
        assertEquals(10_000L, ancreSurMusique(10_000L, 2_000L))       // déjà sur un temps
        assertEquals(10_100L, ancreSurMusique(10_000L, 2_100L))       // 100 ms plus tard
        assertEquals(9_900L, ancreSurMusique(10_000L, 2_400L))        // 100 ms plus tôt
        for (a in 10_000L..11_000L step 7) {
            val n = ancreSurMusique(a, 3_210L)
            assertTrue(kotlin.math.abs(n - a) <= FIN_TEMPS_MS / 2)
            assertEquals(0L, Math.floorMod(n - 3_210L, FIN_TEMPS_MS.toLong()))
            assertEquals(n, ancreSurMusique(n, 3_210L))                // stable : plus aucun saut une fois calée
        }
    }

    @Test
    fun `l'ecart passe la fin de la boucle sans se tromper`() {
        assertEquals(0, ecartBoucleFin(9_000, 9_000))
        assertEquals(100, ecartBoucleFin(9_000, 9_100))
        // 23,95 s et 8,05 s sont à 100 ms l'une de l'autre : la boucle vient de repartir.
        assertEquals(100, ecartBoucleFin(23_950, 8_050))
        assertEquals(8_000, ecartBoucleFin(8_000, 16_000))
    }

    @Test
    fun `la video de fin est bien dans l'appli`() {
        assertTrue(File("src/main/res/raw/gs_fin_video.mp4").isFile)
    }
}
