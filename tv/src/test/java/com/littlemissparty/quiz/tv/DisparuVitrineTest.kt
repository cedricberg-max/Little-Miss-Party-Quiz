package com.littlemissparty.quiz.tv

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Qui a disparu ? en Game Show, « vitrine de nuit » (choix B de cedric, 29/10). */
class DisparuVitrineTest {
    private val blanc = 0xFFFFFFFF.toInt()
    private val presqueBlanc = 0xFFF0F0F2.toInt()
    private val transparent = 0x00000000
    private val ciel = 0xFF6FA8DC.toInt()

    @Test
    fun `une image detouree ou sur fond blanc se pose entiere, une photo remplit la fenetre`() {
        assertTrue(imageDetouree(intArrayOf(blanc, blanc, presqueBlanc, blanc)))
        assertTrue(imageDetouree(intArrayOf(transparent, transparent, transparent, transparent)))
        assertTrue(imageDetouree(intArrayOf(transparent, blanc, transparent, presqueBlanc)))
        assertFalse(imageDetouree(intArrayOf(ciel, blanc, blanc, blanc)))
        assertFalse(imageDetouree(intArrayOf(ciel, ciel, ciel, ciel)))
        assertFalse("image illisible : traitée comme une photo", imageDetouree(IntArray(0)))
    }

    @Test
    fun `la photo qui remplit la fenetre est coupee sur les cotes ou en bas, jamais au-dessus des visages`() {
        // Photo carrée (recadrée dans la Régie PC) dans une fenêtre carrée : rien n'est coupé.
        assertArrayEquals(intArrayOf(0, 0, 400, 400), photoQuiRemplit(120f, 120f, 400, 400))
        // Photo en hauteur dans une fenêtre large : la largeur entière, le haut gardé (on coupe surtout en bas).
        val (x, y, l, h) = photoQuiRemplit(200f, 100f, 300, 600).toList()
        assertEquals(0, x)
        assertEquals(300, l)
        assertEquals(150, h)
        assertTrue("cadrage vers le haut", y < (600 - h) / 2)
        // Photo large dans une fenêtre haute : la hauteur entière, centrée en largeur.
        val r = photoQuiRemplit(100f, 200f, 800, 400)
        assertEquals(400, r[3])
        assertEquals((800 - r[2]) / 2, r[0])
    }

    @Test
    fun `chaque carte a son neon, 8 cartes toutes differentes`() {
        val neons = (0 until 8).map { neonDisparu(it) }
        assertEquals(8, neons.toSet().size)
        assertEquals(neonDisparu(0), neonDisparu(8))
        assertNotEquals(neonDisparu(0), neonDisparu(1))
    }

    @Test
    fun `la carte Game Show est la vitrine de nuit, plus la carte creme`() {
        val source = File("src/main/java/com/littlemissparty/quiz/tv/Disparu.kt").readText()
        assertTrue(source.contains(".background(CarteNuit)"))
        assertTrue(source.contains("blendMode = BlendMode.Multiply"))
        assertFalse(source.contains("CarteCreme"))
    }
}
