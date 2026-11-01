package com.littlemissparty.quiz.tv

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import com.littlemissparty.quiz.tv.habillage.HALO_BOUM
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** « Ça va exploser ! » (points 31 et 32 du 31/10) : phrase du bas jamais coupée, BOUM et points perdus détachés du décor. */
class PatateTexteBasTest {

    @Test
    fun `la phrase du bas suit la partie`() {
        assertEquals("", texteBasPatate(false, true, true, 5, true, 3))
        assertEquals("Gardée plus de 2 secondes ! Toutes les autres équipes gagnent 5 points !", texteBasPatate(true, true, true, 5, false, null))
        assertEquals("Toutes les autres équipes gagnent 3 points !", texteBasPatate(true, true, false, 3, false, null))
        assertEquals("Attention, une nouvelle bombe arrive !", texteBasPatate(true, false, false, 0, true, 4))
        assertEquals("Vite, envoyez la bombe ! Elle explose dans 4…", texteBasPatate(true, false, false, 0, false, 4))
        assertEquals("Vite, envoyez la bombe à une autre équipe sur votre tablette !", texteBasPatate(true, false, false, 0, false, null))
    }

    @Test
    fun `la phrase du bas n'est jamais coupee et garde le halo doux`() {
        val src = File("src/main/java/com/littlemissparty/quiz/tv/PatateScreens.kt").readText()
        val bloc = src.substringAfter("PlaqueAppel(GenrePlaque.BOMBE").substringBefore("if (!state.paused)")
        assertTrue("TexteAjuste(" in bloc)
        assertTrue("lignes = 2" in bloc)
        assertTrue("shadow = HALO_DECOR" in bloc)
        assertFalse("TextOverflow.Ellipsis" in bloc)
        assertFalse("maxLines = 1" in bloc)
    }

    @Test
    fun `BOUM et les points perdus ont le halo noir doux, sans decalage`() {
        assertEquals(Color.Black, HALO_BOUM.color)
        assertEquals(Offset.Zero, HALO_BOUM.offset)
        assertTrue(HALO_BOUM.blurRadius >= 22f)
        val src = File("src/main/java/com/littlemissparty/quiz/tv/habillage/Patate.kt").readText()
        assertEquals(2, Regex("""shadow = HALO_BOUM""").findAll(src).count())
        assertFalse("Offset(0f, 4f)" in src.substringAfter("Text(\"BOUM !\"").substringBefore("POINTS\""))
    }
}
