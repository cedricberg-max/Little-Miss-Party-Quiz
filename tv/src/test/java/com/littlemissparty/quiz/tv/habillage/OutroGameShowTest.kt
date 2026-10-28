package com.littlemissparty.quiz.tv.habillage

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OutroGameShowTest {
    @Test
    fun `l'outro s'active toute seule quand sa video est dans l'appli`() {
        val fichier = File("src/main/res/raw/${Outro.FICHIER}.mp4")
        assertEquals(fichier.isFile, Outro.disponible)
        // Jamais plus lourde que promis (35 Mo au plus) : l'APK doit rester installable sur la Mi Box.
        if (fichier.isFile) assertTrue("outro trop lourde : ${fichier.length()} octets", fichier.length() <= 36_700_160L)
        // Le fondu vers « Merci » est plus doux que l'arrivée habituelle de l'écran de fin.
        assertTrue(FONDU_APRES_OUTRO_MS > 500)
        assertTrue(VOLUME_OUTRO in 0.1f..1f)
    }
}
