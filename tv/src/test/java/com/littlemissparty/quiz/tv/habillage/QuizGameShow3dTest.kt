package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuizGameShow3dTest {

    @Test
    fun `les 9 parts d'une carte gardent leurs coins et se touchent sans couture`() {
        // Carte de 865 × 232 px (1080p) et sa marge de lueur de 60 px : planche 980 px de large, coins de 170 px.
        val t = tranches(980, 170, -60f, 985f, 1f)
        assertArrayEquals(intArrayOf(0, 170, 810, 980, -60, 110, 755, 925), t)
    }

    @Test
    fun `une carte trop petite pour ses coins les partage en deux, jamais d'inversion`() {
        val t = tranches(352, 120, 0f, 100f, 1f)
        assertEquals(50, t[5])
        assertTrue(t[6] >= t[5])
        assertEquals(100, t[7])
    }

    @Test
    fun `la planche d'une carte basse se réduit, une carte haute la garde entière`() {
        assertEquals(1f, echelleCarte(232f), 1e-6f)
        assertEquals(1f, echelleCarte(400f), 1e-6f)
        assertEquals((150f + 120f) / 352f, echelleCarte(150f), 1e-6f)
    }

    @Test
    fun `le masque du liquide part de midi et couvre la part restante`() {
        val m = masqueSecteur(0.5f)
        assertEquals(0f, m.first().first, 0f)
        assertEquals(1f, m.last().first, 0f)
        assertEquals(0f, m.last().second, 0f)
        assertEquals(0.5f, m.first().second, 1e-6f)
        assertEquals(1f, m.first { kotlin.math.abs(it.first - 0.475f) < 1e-4f }.second, 1e-6f)
        assertEquals(0.5f, m.first { it.first == 0.5f }.second, 1e-6f)
        assertTrue(m.zipWithNext().all { (a, b) -> a.first < b.first })
    }

    @Test
    fun `le chiffre du chrono rapetisse avec le nombre de chiffres`() {
        assertTrue(tailleChiffreChrono(5) > tailleChiffreChrono(10))
        assertTrue(tailleChiffreChrono(10) > tailleChiffreChrono(120))
        assertEquals(tailleChiffreChrono(0), tailleChiffreChrono(9), 0f)
    }

    @Test
    fun `calme jusqu'à 3 secondes, rouge dans les 3 dernières`() {
        assertFalse(chronoUrgent(10))
        assertFalse(chronoUrgent(4))
        assertTrue(chronoUrgent(3))
        assertTrue(chronoUrgent(0))
    }

    @Test
    fun `dix-neuf planches, néons et lettres dans l'ordre des propositions`() {
        assertEquals(19, NOMS_QUIZ3D.size)
        assertEquals(listOf("gs_q3d_carte_neon_rose", "gs_q3d_carte_neon_orange", "gs_q3d_carte_neon_vert", "gs_q3d_carte_neon_jaune"), NOMS_QUIZ3D.subList(1, 5))
        assertEquals("gs_q3d_lettre_vert", NOMS_QUIZ3D[9])
        assertTrue(NOMS_QUIZ3D.all { it.matches(Regex("gs_q3d_[a-z_]+")) })
    }
}
