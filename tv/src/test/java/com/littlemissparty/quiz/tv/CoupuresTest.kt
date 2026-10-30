package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Coupures des tablettes et du téléphone dans les rapports de la box (cedric, 30/10 au soir). */
class CoupuresTest {
    private val noms = mapOf("a" to "tablette rose", "b" to "tablette vert", "regie:x" to "téléphone")
    private fun Coupures.ligne(t: Long) = releve(t) { noms.getValue(it) }

    @Test
    fun `personne n'a decroche, rien a dire`() {
        val c = Coupures()
        c.vu("a", true, 0)
        c.vu("a", true, 1_000)
        assertNull(c.ligne(300_000))
    }

    @Test
    fun `une coupure courte entre deux releves est comptee, avec sa duree`() {
        val c = Coupures()
        c.vu("a", true, 0)
        c.vu("a", false, 10_000)
        c.vu("a", true, 13_000)
        assertEquals("coupures 5 min : tablette rose 1× (3 s)", c.ligne(300_000))
        // Remis à zéro : le relevé suivant ne la répète pas.
        assertNull(c.ligne(600_000))
    }

    @Test
    fun `plusieurs coupures, la pire, et une coupure encore en cours`() {
        val c = Coupures()
        listOf("a", "b", "regie:x").forEach { c.vu(it, true, 0) }
        c.vu("a", false, 10_000); c.vu("a", true, 12_000)
        c.vu("a", false, 50_000); c.vu("a", true, 64_000)
        c.vu("regie:x", false, 280_000)
        assertEquals("coupures 5 min : tablette rose 2× (pire 14 s), téléphone 1× (20 s, encore coupée)", c.ligne(300_000))
        // Toujours coupé au relevé suivant : compté de nouveau, avec toute sa durée.
        assertEquals("coupures 5 min : téléphone 1× (5 min 20 s, encore coupée)", c.ligne(600_000))
        c.vu("regie:x", true, 610_000)
        assertEquals("coupures 5 min : téléphone 1× (5 min 30 s)", c.ligne(900_000))
        assertNull(c.ligne(1_200_000))
    }

    @Test
    fun `deja hors ligne quand la box le decouvre`() {
        val c = Coupures()
        c.vu("b", false, 100_000)
        assertEquals("coupures 5 min : tablette vert 1× (3 min 20 s, encore coupée)", c.ligne(300_000))
    }
}
