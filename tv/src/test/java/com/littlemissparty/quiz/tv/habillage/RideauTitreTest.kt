package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Test

/** Nom du jeu sur les portes du Game Show : il tient dans le cadre néon (express du 24/10 qui débordait). */
class RideauTitreTest {

    @Test
    fun `un titre qui tient garde sa taille`() {
        assertEquals(88f, tailleTitreDansCadre(88f, 600f, 947f), 0.001f)
    }

    @Test
    fun `un titre trop large est reduit pour tenir rebond compris`() {
        val t = tailleTitreDansCadre(64f, 1090f, 947f)
        assertEquals(1090f * t / 64f, 947f / 1.04f, 0.5f)
    }

    @Test
    fun `jamais sous le minimum`() {
        assertEquals(TITRE_RIDEAU_MIN_SP, tailleTitreDansCadre(64f, 5000f, 947f), 0.001f)
    }
}
