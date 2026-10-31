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

    @Test
    fun `la video de fin dure 8 s d'arrivee plus une boucle de 16 s`() {
        // Durée lue dans l'en-tête mvhd du MP4 : une vidéo livrée plus courte ou plus longue décalerait la boucle.
        val octets = File("src/main/res/raw/gs_fin_video.mp4").readBytes()
        val i = (0 until octets.size - 4).first { String(octets, it, 4, Charsets.ISO_8859_1) == "mvhd" }
        fun entier(at: Int, n: Int) = (0 until n).fold(0L) { acc, k -> (acc shl 8) or (octets[at + k].toLong() and 0xFF) }
        val v1 = octets[i + 4].toInt() == 1
        val echelle = entier(i + if (v1) 24 else 16, 4)
        val duree = entier(i + if (v1) 28 else 20, if (v1) 8 else 4)
        assertEquals((FIN_BOUCLE_DEBUT_MS + FIN_BOUCLE_MS).toDouble(), duree * 1000.0 / echelle, 50.0)
    }

    @Test
    fun `la boucle de fin repart d'une image cle, sans a-coup sur la box`() {
        // Test du 30/10 : petit à-coup quand la boucle repart. Il n'y avait pas d'image clé à 8,0 s (la box décodait
        // depuis 6,2 s). L'image 200 (numéro 201 dans l'en-tête stss, 25 images/s) doit être une image clé.
        val octets = File("src/main/res/raw/gs_fin_video.mp4").readBytes()
        val i = (0 until octets.size - 4).first { String(octets, it, 4, Charsets.ISO_8859_1) == "stss" }
        fun entier(at: Int, n: Int) = (0 until n).fold(0L) { acc, k -> (acc shl 8) or (octets[at + k].toLong() and 0xFF) }
        val imagesCles = (0 until entier(i + 8, 4).toInt()).map { entier(i + 12 + it * 4, 4) }
        assertTrue("image clé à la reprise de la boucle", FIN_BOUCLE_DEBUT_MS * 25L / 1000 + 1 in imagesCles)
    }

    @Test
    fun `les textes de fin sont dans la video, l'appli n'ecrit rien par-dessus`() {
        // Vidéo du 29/10 (titre néon et logo dans l'image) : sans ce réglage, « Merci » et « À bientôt » seraient en double.
        assertTrue(FIN_TEXTES_DANS_LA_VIDEO)
        val source = File("src/main/java/com/littlemissparty/quiz/tv/habillage/FinGameShow.kt").readText()
        assertTrue(source.contains("if (FIN_TEXTES_DANS_LA_VIDEO) TextesDeLaVideo() else MessagesFin()"))
    }
}
