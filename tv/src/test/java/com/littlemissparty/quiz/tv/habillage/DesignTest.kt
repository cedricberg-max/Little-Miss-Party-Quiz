package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DesignTest {

    @Test
    fun `sans choix sur la box, le design est The Game Show sur le plateau 3D`() {
        assertEquals(Design.GAME_SHOW_3D, Design.depuis(null))
        assertEquals(Design.GAME_SHOW_3D, Design.depuis("inconnu"))
    }

    @Test
    fun `le Classique reste en secours quand il est choisi dans le menu Retour`() {
        assertEquals(Design.CLASSIQUE, Design.depuis("classique"))
        assertEquals(Design.GAME_SHOW, Design.depuis("gs"))
    }

    @Test
    fun `le plateau 3D est un Game Show, et le bouton passe plateau 3D, décor dessiné, Classique, puis revient`() {
        assertEquals(Design.GAME_SHOW_3D, Design.depuis("gs3d"))
        assertEquals(Design.GAME_SHOW, Design.GAME_SHOW_3D.suivant)
        assertEquals(Design.CLASSIQUE, Design.GAME_SHOW.suivant)
        assertEquals(Design.GAME_SHOW_3D, Design.CLASSIQUE.suivant)
        Look.design = Design.GAME_SHOW_3D
        assertTrue(Look.gs)
        assertTrue(Look.fond3d)
        Look.design = Design.GAME_SHOW
        assertTrue(Look.gs)
        assertFalse(Look.fond3d)
    }

    @Test
    fun `une box qui ne lit qu'une video a la fois garde le decor dessine, le robot passe toujours`() {
        Look.design = Design.GAME_SHOW_3D
        Look.deuxVideos = false
        assertTrue(Look.gs)
        assertFalse(Look.fond3d)
        Look.deuxVideos = true
        assertTrue(Look.fond3d)
    }

    @Test
    fun `le decodeur materiel de la box decide, pas les decodeurs logiciels d'Android`() {
        // Mi Box : puce Amlogic d'abord, décodeurs logiciels ensuite.
        assertEquals(1, instancesMaterielles(listOf("OMX.amlogic.avc.decoder.awesome" to 1, "OMX.google.h264.decoder" to 32, "c2.android.avc.decoder" to 32)))
        assertEquals(4, instancesMaterielles(listOf("c2.android.avc.decoder" to 32, "OMX.MTK.VIDEO.DECODER.AVC" to 4)))
        // Émulateur : seulement des décodeurs logiciels.
        assertEquals(32, instancesMaterielles(listOf("c2.android.avc.decoder" to 32, "OMX.google.h264.decoder" to 16)))
        assertEquals(0, instancesMaterielles(emptyList()))
    }
}
