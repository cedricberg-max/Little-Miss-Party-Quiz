package com.littlemissparty.quiz.tv.habillage

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Calque des positions de la planche (Blind test, 31/10) : à 1-4 équipes, tout tient et rien ne bouge (tailles de la
 * planche) ; à 5-8 équipes, si la scène est trop basse, tout rapetisse d'un même facteur et reste en entier.
 */
class CalquePlancheTest {
    @Test
    fun `ce qui tient ne bouge pas`() {
        val cadres = listOf(Rect(400f, 180f, 900f, 260f), Rect(400f, 340f, 700f, 456f))
        assertEquals(1f to Offset.Zero, ajusteALaPlace(cadres, 1200f, 500f))
    }

    @Test
    fun `trop haut - tout rapetisse et reste dans le calque`() {
        val cadres = listOf(Rect(400f, 40f, 900f, 120f), Rect(400f, 200f, 700f, 400f))
        val (e, d) = ajusteALaPlace(cadres, 1200f, 300f)
        assertEquals(300f / 360f, e, 0.001f)
        // Centre de l'ensemble y 220, hauteur réduite 300 : de 70 à 370, remonté de 70.
        assertEquals(0f, d.x, 0.001f)
        assertEquals(-70f, d.y, 0.001f)
    }

    @Test
    fun `qui depasse sans etre trop grand - seulement recale`() {
        val (e, d) = ajusteALaPlace(listOf(Rect(100f, -20f, 300f, 80f)), 1000f, 400f)
        assertEquals(1f, e)
        assertEquals(Offset(0f, 20f), d)
        assertTrue(ajusteALaPlace(emptyList(), 10f, 10f).first == 1f)
    }
}
