package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Test

class CouleursTest {
    @Test
    fun `couleur demandee libre, elle est gardee`() {
        assertEquals("#06D6A0", freeColor("#06D6A0", listOf("#FF2D95")))
    }

    @Test
    fun `couleur deja prise, meme ecrite autrement, l'equipe recoit la premiere libre`() {
        assertEquals("#FF6B1A", freeColor("#ff2d95", listOf("#FF2D95")))
        assertEquals("#39FF14", freeColor("#FF2D95", listOf("#FF2D95", "#ff6b1a")))
    }

    @Test
    fun `couleur absente ou invalide, premiere libre`() {
        assertEquals("#FF2D95", freeColor(null, emptyList()))
        assertEquals("#FF6B1A", freeColor("rouge", listOf("#FF2D95")))
    }

    @Test
    fun `les quatre couleurs des bracelets d'abord, puis le bleu pour une cinquieme equipe`() {
        assertEquals(listOf("#FF2D95", "#FF6B1A", "#39FF14", "#FFE600"), TEAM_COLORS.take(4))
        assertEquals("#2B86C5", freeColor(null, TEAM_COLORS.take(4)))
        assertEquals(8, TEAM_COLORS.map(::colorKey).toSet().size)
    }

    @Test
    fun `cle de reservation`() {
        assertEquals("FF3CAC", colorKey("#ff3cac"))
    }
}
