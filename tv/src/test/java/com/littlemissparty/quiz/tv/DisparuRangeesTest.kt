package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Test

/** Qui a disparu ? : 4, 6 ou 8 objets (Régie PC, cedric 27/10) toujours sur 2 rangées égales à la TV. */
class DisparuRangeesTest {

    @Test
    fun `4, 6 ou 8 objets font deux rangees egales`() {
        for (n in listOf(4, 6, 8)) {
            val colonnes = colonnesDisparu(n)
            assertEquals("$n objets : 2 rangées", 2, (n + colonnes - 1) / colonnes)
            assertEquals("$n objets : rangées égales", 0, n % colonnes)
        }
    }
}
