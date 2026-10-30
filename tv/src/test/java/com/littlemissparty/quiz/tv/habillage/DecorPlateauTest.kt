package com.littlemissparty.quiz.tv.habillage

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class DecorPlateauTest {
    @Test
    fun `le plateau du studio est dans l'appli et l'ancien reste gardé pour revenir en arrière`() {
        val video = File("src/main/res/raw/gs_fond_plateau.mp4")
        assertTrue(video.isFile && video.length() in 1_000_000L..12_000_000L)
        assertTrue(File("src/main/res/drawable-nodpi/gs_fond_poster.webp").isFile)
        // cedric (28/10) : garder l'ancien décor, hors de l'appli, pour pouvoir le remettre tout de suite.
        for (f in listOf("gs_fond_plateau.mp4", "gs_fond_poster.webp", "LISEZMOI.md")) {
            assertTrue("$f gardé", File("sauvegarde/plateau-avant-gemini-28-octobre/$f").isFile)
        }
        // Une vidéo MP4 (boîte « ftyp ») : pas un fichier vide ou une image renommée.
        assertTrue(String(video.readBytes().copyOfRange(4, 8)) == "ftyp")
    }

    @Test
    fun `le decor tourne au ralenti choisi par cedric, en aller-retour de 13,4 s`() {
        // cedric (29/10) : la boucle aller-retour sans coupure, ralentie × 0,6 (7,3 s avant, 8,2 s en aller-retour).
        val octets = File("src/main/res/raw/gs_fond_plateau.mp4").readBytes()
        val i = (0 until octets.size - 4).first { String(octets, it, 4, Charsets.ISO_8859_1) == "mvhd" }
        fun entier(at: Int, n: Int) = (0 until n).fold(0L) { acc, k -> (acc shl 8) or (octets[at + k].toLong() and 0xFF) }
        val v1 = octets[i + 4].toInt() == 1
        val secondes = entier(i + if (v1) 28 else 20, if (v1) 8 else 4).toDouble() / entier(i + if (v1) 24 else 16, 4)
        assertTrue("durée $secondes s", secondes in 13.0..14.0)
    }
}
