package com.littlemissparty.quiz.tv.habillage

import androidx.compose.ui.unit.Constraints
import org.junit.Assert.assertEquals
import org.junit.Test

/** Règle du Pictionary avec 8 équipes (cedric, 30/10) : elle rapetisse juste assez pour tenir, jamais plus. */
class TientEnHauteurTest {
    @Test
    fun `assez de place, la taille ne bouge pas`() {
        assertEquals(1f, echelleQuiTient(400, 600), 0f)
        assertEquals(1f, echelleQuiTient(600, 600), 0f)
        assertEquals("hauteur libre", 1f, echelleQuiTient(900, Constraints.Infinity), 0f)
        assertEquals("rien à mesurer", 1f, echelleQuiTient(0, 300), 0f)
    }

    @Test
    fun `trop haut, juste ce qu'il faut pour tenir`() {
        assertEquals(0.75f, echelleQuiTient(800, 600), 1e-4f)
        assertEquals("jamais minuscule", 0.2f, echelleQuiTient(10_000, 100), 0f)
    }
}
