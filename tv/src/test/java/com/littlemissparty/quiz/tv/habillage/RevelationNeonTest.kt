package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RevelationNeonTest {
    @Test
    fun `Chante le mot ne repete pas le mot a droite, l'Image floue le montre`() {
        // cedric, 28/10 : « SOLEIL » à gauche et « Le mot : SOLEIL » à droite faisait une répétition bizarre.
        assertFalse(revelationAvecMot(chante = true))
        assertTrue(revelationAvecMot(chante = false))
        // Seules, les félicitations prennent la place en grand.
        assertTrue(PHRASE_SEULE_MAX >= 56f)
    }
}
