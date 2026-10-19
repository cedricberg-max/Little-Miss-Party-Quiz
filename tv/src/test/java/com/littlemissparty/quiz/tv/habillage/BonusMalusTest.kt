package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BonusMalusTest {

    @Test
    fun `le delta affiche est exactement celui de la regie`() {
        assertEquals("+50 POINTS", texteDelta(50))
        assertEquals("+7 POINTS", texteDelta(7))
        assertEquals("+1 POINT", texteDelta(1))
        assertEquals("−1 POINT", texteDelta(-1))
        assertEquals("−20 POINTS", texteDelta(-20))
        assertEquals("+1000 POINTS", texteDelta(1000))
    }

    @Test
    fun `le compteur va du score d'avant au score d'apres sans depasser`() {
        assertEquals(100, valeurCompteur(100, 150, 0f))
        assertEquals(150, valeurCompteur(100, 150, 1f))
        assertEquals(150, valeurCompteur(100, 150, 3f))
        assertEquals(100, valeurCompteur(100, 150, -1f))
        assertEquals(80, valeurCompteur(100, 80, 1f))
        var avant = 100
        for (k in 0..20) {
            val v = valeurCompteur(100, 150, k / 20f)
            assertTrue(v in 100..150 && v >= avant)
            avant = v
        }
        for (k in 0..20) assertTrue(valeurCompteur(100, 80, k / 20f) in 80..100)
    }
}
