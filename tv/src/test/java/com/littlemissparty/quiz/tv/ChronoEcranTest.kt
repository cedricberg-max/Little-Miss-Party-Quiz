package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** ⏱️ Le Chrono de Buzzy à la TV : textes du chrono et des écarts, bornes de la règle, ordre de la révélation. */
class ChronoEcranTest {

    @Test
    fun `chrono au centieme, ecarts signes, pile`() {
        assertEquals("00,00", texteChrono(-40))
        assertEquals("07,45", texteChrono(7_456))
        assertEquals("+1,24 s", texteEcart(1_240))
        assertEquals("−0,80 s", texteEcart(-800))
        assertEquals("PILE !", texteEcart(3))
        assertEquals("+12,05 s", texteEcart(12_050))
    }

    @Test
    fun `la regle montre la cible et toutes les equipes, jamais avant 0`() {
        assertEquals(24 to 36, bornesRegle(30, listOf(-500L, 1_200L)))
        val (bas, haut) = bornesRegle(10, listOf(-9_000L, 14_500L))
        assertEquals(0, bas)
        assertTrue(haut >= 26)
        assertEquals(24 to 36, bornesRegle(30, emptyList()))
    }

    @Test
    fun `la plus loin d'abord, la plus proche en dernier`() {
        assertEquals(listOf("vert", "orange", "rose"), ordreRevelation(mapOf("orange" to -500L, "vert" to 1_200L, "rose" to 300L)))
    }
}
