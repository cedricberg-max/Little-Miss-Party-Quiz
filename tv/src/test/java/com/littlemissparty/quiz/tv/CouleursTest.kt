package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Test

class CouleursTest {
    @Test
    fun `couleur demandee libre, elle est gardee`() {
        assertEquals("#06D6A0", freeColor("#06D6A0", listOf("#FF3CAC")))
    }

    @Test
    fun `couleur deja prise, meme ecrite autrement, l'equipe recoit la premiere libre`() {
        assertEquals("#FFD166", freeColor("#ff3cac", listOf("#FF3CAC")))
        assertEquals("#06D6A0", freeColor("#FF3CAC", listOf("#FF3CAC", "#ffd166")))
    }

    @Test
    fun `couleur absente ou invalide, premiere libre`() {
        assertEquals("#FF3CAC", freeColor(null, emptyList()))
        assertEquals("#FFD166", freeColor("rouge", listOf("#FF3CAC")))
    }

    @Test
    fun `cle de reservation`() {
        assertEquals("FF3CAC", colorKey("#ff3cac"))
    }
}
