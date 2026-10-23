package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DesignTest {

    @Test
    fun `sans choix sur la box, le design est The Game Show`() {
        assertEquals(Design.GAME_SHOW, Design.depuis(null))
        assertEquals(Design.GAME_SHOW, Design.depuis("inconnu"))
    }

    @Test
    fun `le Classique reste en secours quand il est choisi dans le menu Retour`() {
        assertEquals(Design.CLASSIQUE, Design.depuis("classique"))
        assertEquals(Design.GAME_SHOW, Design.depuis("gs"))
    }

    @Test
    fun `le fond 3D est un Game Show, et le bouton passe Game Show, fond 3D, Classique, puis revient`() {
        assertEquals(Design.GAME_SHOW_3D, Design.depuis("gs3d"))
        assertEquals(Design.GAME_SHOW_3D, Design.GAME_SHOW.suivant)
        assertEquals(Design.CLASSIQUE, Design.GAME_SHOW_3D.suivant)
        assertEquals(Design.GAME_SHOW, Design.CLASSIQUE.suivant)
        Look.design = Design.GAME_SHOW_3D
        assertTrue(Look.gs)
        assertTrue(Look.fond3d)
        Look.design = Design.GAME_SHOW
        assertTrue(Look.gs)
        assertFalse(Look.fond3d)
    }
}
