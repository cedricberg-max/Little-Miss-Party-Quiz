package com.littlemissparty.quiz.tv.habillage

import androidx.compose.ui.geometry.Offset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Qui suis-je ? du Game Show, version A ajustée (planche du 28/10, validée par cedric). */
class QuiSuisGsTest {

    @Test
    fun `les ampoules font le tour complet de l enseigne, sans sortir du cadre`() {
        val w = 300f
        val h = 80f
        assertEquals(Offset(0f, 0f), pointDuTour(0f, w, h))
        assertEquals(Offset(w, 0f), pointDuTour(w, w, h))
        assertEquals(Offset(w, h), pointDuTour(w + h, w, h))
        assertEquals(Offset(0f, h), pointDuTour(2 * w + h, w, h))
        assertEquals(Offset(0f, 0f), pointDuTour(2 * (w + h), w, h))
        for (k in -50..400) {
            val p = pointDuTour(k * 3.7f, w, h)
            assertTrue("$k : $p", p.x in 0f..w && p.y in 0f..h)
            assertTrue("sur le bord", p.x == 0f || p.x == w || p.y == 0f || p.y == h)
        }
    }

    @Test
    fun `chaque indice a sa couleur, jusqu a 5, et la pastille du nouvel indice ne dure que 2 s`() {
        assertEquals(5, COULEURS_INDICES_GS.toSet().size)
        assertTrue(NOUVEL_INDICE_MS in 1_500..2_500)
    }

    /** cedric 28/10 : plus de buzzer rouge dessiné, ni de grand « ? » ; le texte des indices n'est jamais coupé. */
    @Test
    fun `pas de buzzer dessine, pas de grand point d interrogation, indices jamais coupes`() {
        val qsj = File("src/main/java/com/littlemissparty/quiz/tv/habillage/QuiSuisGs.kt").readText()
        assertFalse(qsj.contains("ellipse", ignoreCase = true))
        assertFalse("pas de texte tronqué", qsj.contains("TextOverflow.Ellipsis"))
        val tableau = File("src/main/java/com/littlemissparty/quiz/tv/JeuxAuBuzzer.kt").readText()
        assertTrue(tableau.contains("if (!revealed && !Look.gs) Text(\"?\""))
        assertTrue(tableau.contains("if (Look.gs) CarteIndiceGs("))
    }
}
