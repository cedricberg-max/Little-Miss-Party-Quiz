package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/** Pictionary : la TV relit les paquets de traits envoyés par la tablette du dessinateur. */
class DessinTest {

    @Test
    fun `un trait se lit avec sa couleur, son épaisseur et ses points`() {
        val t = Dessin.lireTrait(mapOf("c" to "#F94144", "w" to 2L, "p" to "10,20 30,40 1000,1000"))!!
        assertEquals(0xFFF94144L, t.couleur)
        assertEquals(2, t.epaisseur)
        assertEquals(listOf(10 to 20, 30 to 40, 1000 to 1000), t.points)
    }

    @Test
    fun `la gomme est un trait couleur papier`() {
        assertNull(Dessin.lireTrait(mapOf("c" to "paper", "w" to 3L, "p" to "5,5"))!!.couleur)
    }

    @Test
    fun `les traits s'ajoutent dans l'ordre, tout effacer vide la feuille`() {
        val d = Dessin("k")
            .avec(mapOf("c" to "#000000", "w" to 1L, "p" to "1,1 2,2"))
            .avec(mapOf("c" to "#000000", "w" to 1L, "p" to "2,2 3,3"))
        assertEquals(2, d.traits.size)
        assertEquals(listOf(2 to 2, 3 to 3), d.traits[1].points)
        val vide = d.avec(mapOf("clear" to true))
        assertEquals(0, vide.traits.size)
        assertEquals(1, vide.effacements)
        assertEquals("k", vide.cle)
    }

    @Test
    fun `un paquet illisible est ignoré sans rien casser`() {
        val d = Dessin("k").avec(mapOf("c" to "#000000", "w" to 1L, "p" to "1,1"))
        assertSame(d, d.avec(mapOf("c" to "rouge", "w" to 1L, "p" to "1,1")))
        assertSame(d, d.avec(mapOf("c" to "#000000", "w" to 9L, "p" to "1,1")))
        assertSame(d, d.avec(mapOf("c" to "#000000", "w" to 1L, "p" to "n'importe quoi")))
        assertSame(d, d.avec(mapOf("w" to 1L)))
    }
}
