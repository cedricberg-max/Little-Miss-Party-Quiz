package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Ça va exploser : la fumée du BOUM s'efface en entier (cedric, 31/10 au soir : de gros ronds gris restaient au fond). */
class FumeeBoumTest {
    @Test
    fun `la fumee du boum part epaisse puis disparait completement`() {
        assertEquals(0.7f, fumeeBoum(0f), 1e-4f)
        assertTrue(fumeeBoum(0.5f) in 0.01f..0.69f)
        assertEquals(0f, fumeeBoum(0.85f), 1e-4f)
        assertEquals(0f, fumeeBoum(1f), 1e-4f)
    }
}
