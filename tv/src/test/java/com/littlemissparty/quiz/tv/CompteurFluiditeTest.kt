package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Fluidité mesurée sur la box (cedric, 25/10 au soir) : une ligne courte qui dit où ça accroche. */
class CompteurFluiditeTest {

    @Test
    fun `rien de mesure, rien a dire`() {
        assertNull(CompteurFluidite().ligne())
    }

    @Test
    fun `tout est fluide`() {
        val c = CompteurFluidite()
        repeat(1000) { c.image(16, "question quiz") }
        assertEquals("images 1000, en retard 0,0 % · aucun accroc", c.ligne())
    }

    @Test
    fun `les ecrans qui accrochent le plus d'abord, avec leur pire image`() {
        val c = CompteurFluidite()
        repeat(990) { c.image(16, "question zoom") }
        c.image(60, "question zoom")
        c.image(420, "question zoom")
        c.image(200, "question zoom")
        c.image(260, "intro coffres")
        // Retour au premier plan : ignoré.
        c.image(30_000, "intro coffres")
        assertEquals(
            "images 994, en retard 0,4 % · accrocs : question zoom 2 (pire 420 ms), intro coffres 1 (pire 260 ms)",
            c.ligne(),
        )
        c.vider()
        assertNull(c.ligne())
    }

    @Test
    fun `quatre ecrans au plus dans la ligne`() {
        val c = CompteurFluidite()
        for (k in 1..6) repeat(k) { c.image(200, "ecran $k") }
        val ligne = c.ligne()!!
        assertEquals(listOf("ecran 6", "ecran 5", "ecran 4", "ecran 3"), Regex("ecran \\d").findAll(ligne).map { it.value }.toList())
    }

    @Test
    fun `réception des buzz et des envois de bombe, médiane et pire, puis remise à zéro`() {
        Reactivite.releve()
        listOf(120L, 90L, 400L).forEach { Reactivite.noter("buzz", it) }
        Reactivite.noter("bombe", -30)
        Reactivite.noter("bombe", 90_000)
        assertEquals("réception : buzz 3 (médiane 120 ms, pire 400 ms), bombe 1 (médiane 0 ms, pire 0 ms)", Reactivite.releve())
        assertNull(Reactivite.releve())
    }
}
