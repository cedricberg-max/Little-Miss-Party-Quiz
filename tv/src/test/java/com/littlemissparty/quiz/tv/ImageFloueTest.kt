package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Image floue : la photo nette n'est jamais dessinée avant la révélation (test du 27/10 au soir). */
class ImageFloueTest {

    @Test
    fun `avant la révélation, jamais la photo nette, même si le niveau déborde`() {
        for (niveau in listOf(0f, 3.5f, NIVEAUX_FLOUS - 1f, NIVEAUX_FLOUS - 0.5f, NIVEAUX_FLOUS.toFloat(), NIVEAUX_FLOUS + 3f)) {
            val (bas, haut) = niveauxAffiches(niveau, revealed = false)
            assertTrue("niveau $niveau : $bas", bas < NIVEAUX_FLOUS)
            assertTrue("niveau $niveau : $haut", haut < NIVEAUX_FLOUS)
        }
    }

    @Test
    fun `à la révélation, la photo nette arrive`() {
        assertEquals(NIVEAUX_FLOUS to NIVEAUX_FLOUS, niveauxAffiches(NIVEAUX_FLOUS.toFloat(), revealed = true))
        assertEquals(NIVEAUX_FLOUS - 1 to NIVEAUX_FLOUS, niveauxAffiches(NIVEAUX_FLOUS - 0.5f, revealed = true))
    }

    @Test
    fun `début de question, le niveau le plus flou`() {
        assertEquals(0 to 1, niveauxAffiches(0f, revealed = false))
    }
}
