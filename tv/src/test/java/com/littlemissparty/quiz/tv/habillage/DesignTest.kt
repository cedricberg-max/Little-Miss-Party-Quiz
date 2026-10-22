package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
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
}
