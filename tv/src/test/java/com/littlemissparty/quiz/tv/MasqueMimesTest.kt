package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mimes entre deux tours : le masque plus gros (cedric, 27/10 au soir), jamais au détriment des textes dessous. */
class MasqueMimesTest {

    @Test
    fun `le masque grandit avec la place, plafonne a 220 et ne descend jamais sous l ancienne taille`() {
        assertEquals(220f, tailleMasqueMimes(600f))
        assertEquals(132f, tailleMasqueMimes(200f))
        val moyen = tailleMasqueMimes(420f)
        assertTrue("plus gros qu'avant", moyen > 132f)
        assertTrue("laisse la place des textes", moyen <= 420f - 250f)
    }
}
