package com.littlemissparty.quiz.tv

import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ZoomMystereTest {
    private val blanc = 0xFFFFFFFF.toInt()
    private val transparent = 0x00000000

    /** Personnage détouré sur fond blanc : un carré rayé (du détail) dans le coin en haut à droite. */
    private fun personnage(fond: Int, w: Int = 96, h: Int = 72) = IntArray(w * h) { i ->
        val x = i % w
        val y = i / w
        if (x in 66..86 && y in 6..22) (if ((x / 2) % 2 == 0) 0xFFE02020.toInt() else 0xFF2020E0.toInt()) else fond
    }

    @Test
    fun `fond blanc autour du personnage, le zoom part sur le personnage, quelle que soit la question`() {
        for (graine in listOf(0, 1, 7, -42, "r3q2".hashCode(), "r5q1".hashCode())) {
            val (x, y) = pivotDetail(personnage(blanc), 96, 72, graine)!!
            assertTrue("à droite : $x", x > 0.6f)
            assertTrue("en haut : $y", y < 0.4f)
        }
    }

    @Test
    fun `fond transparent, compte comme un fond uni`() {
        val (x, y) = pivotDetail(personnage(transparent), 96, 72, 3)!!
        assertTrue("$x, $y", x > 0.6f && y < 0.4f)
    }

    @Test
    fun `photo toute unie ou vide, pas de point prefere`() {
        assertNull(pivotDetail(IntArray(96 * 72) { blanc }, 96, 72, 5))
        assertNull(pivotDetail(IntArray(0), 0, 0, 5))
    }

    @Test
    fun `photo pleine de details partout, le point varie d'une question a l'autre`() {
        val w = 96
        val h = 72
        val bruit = IntArray(w * h) { i -> if ((i * 2654435761L % 7).toInt() < 3) 0xFF000000.toInt() else blanc }
        val points = (0 until 20).mapNotNull { pivotDetail(bruit, w, h, it) }.toSet()
        assertTrue("${points.size} points", points.size > 3)
    }
}
