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
}
