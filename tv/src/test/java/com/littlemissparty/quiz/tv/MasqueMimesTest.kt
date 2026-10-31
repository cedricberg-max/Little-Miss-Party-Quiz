package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mimes entre deux tours : le masque plus gros (cedric, 27/10 au soir), jamais au détriment des textes dessous. */
class MasqueMimesTest {

    @Test
    fun `le masque grandit avec la place, plafonne a 220 et laisse toujours la place des textes`() {
        assertEquals(220f, tailleMasqueMimes(600f))
        val moyen = tailleMasqueMimes(420f)
        assertTrue("plus gros qu'avant", moyen > 132f)
        assertTrue("laisse la place des textes", moyen <= 420f - 250f)
        // 8 équipes sur deux rangées (cedric, 30/10 : règle coupée) : le masque rapetisse, puis disparaît.
        assertEquals(100f, tailleMasqueMimes(350f))
        assertEquals(0f, tailleMasqueMimes(300f))
        assertEquals(0f, tailleMasqueMimes(200f))
    }

    @Test
    fun `le nom a cote de la pastille MIMES n est jamais le meme mot`() {
        for (t in listOf("Mimes", "mimes", " MIMES ", "Les Mimes", "Mime", null, "")) assertNull(t, sousTitreMimes(t))
        assertEquals("Animaux de la ferme", sousTitreMimes("Animaux de la ferme"))
        assertEquals("Équipe orange", sousTitreMimes("Équipe orange"))
    }
}
