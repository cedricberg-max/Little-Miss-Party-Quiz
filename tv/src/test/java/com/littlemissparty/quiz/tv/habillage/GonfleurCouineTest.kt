package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Gonfleur fou, Game Show (cedric, 27/10, son B) : le ballon qui couine, plus aigu à mesure qu'il gonfle. */
class GonfleurCouineTest {

    @Test
    fun `un fichier par tiers, et la vitesse monte de 0,95 a 1,10 dans chaque tiers`() {
        assertEquals(Son.COUINE_1, couinement(0.1f, 0, 4).son)
        assertEquals(Son.COUINE_2, couinement(0.5f, 0, 4).son)
        assertEquals(Son.COUINE_3, couinement(0.9f, 0, 4).son)
        assertEquals("ballon plein : le plus aigu", Son.COUINE_3, couinement(1f, 0, 4).son)
        assertEquals(0.95f, couinement(0f, 0, 4).vitesse, 0.001f)
        assertEquals(1.10f, couinement(0.3333f, 0, 4).vitesse, 0.01f)
        assertTrue(couinement(0.2f, 0, 4).vitesse < couinement(0.3f, 0, 4).vitesse)
    }

    @Test
    fun `place en stereo selon la place de l'equipe, environ 6 dB sous la musique`() {
        val gauche = couinement(0.5f, 0, 4)
        val droite = couinement(0.5f, 3, 4)
        val seule = couinement(0.5f, 0, 1)
        assertEquals(0.5f, gauche.gauche, 0.001f)
        assertEquals(0f, gauche.droite, 0.001f)
        assertEquals(0f, droite.gauche, 0.001f)
        assertEquals(0.5f, droite.droite, 0.001f)
        assertEquals(seule.gauche, seule.droite, 0.001f)
    }

    @Test
    fun `les couinements sont des sons du Game Show seulement`() {
        listOf(Son.COUINE_1, Son.COUINE_2, Son.COUINE_3).forEach {
            assertTrue(it.fichier.startsWith("gs_"))
            assertTrue(!it.long)
        }
    }
}
