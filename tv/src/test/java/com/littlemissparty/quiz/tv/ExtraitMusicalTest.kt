package com.littlemissparty.quiz.tv

import com.littlemissparty.quiz.engine.Phase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Quiz musical (cedric, 31/10) : la chanson continue, plus bas, de la fermeture jusqu'au classement. */
class ExtraitMusicalTest {
    @Test
    fun `pendant la question, la chanson suit le chrono comme avant`() {
        assertNull(lectureMusicale(Phase.QUESTION, enPause = false, refrainPret = true))
    }

    @Test
    fun `fermee puis revelee, la chanson continue un peu moins fort, sans repartir du debut ni s'arreter`() {
        assertEquals(LectureMusicale.FOND, lectureMusicale(Phase.CLOSED, enPause = false, refrainPret = false))
        assertEquals(LectureMusicale.FOND, lectureMusicale(Phase.REVEAL, enPause = false, refrainPret = false))
        assertEquals(LectureMusicale.FOND, lectureMusicale(Phase.CLOSED, enPause = false, refrainPret = true))
        assertTrue(VOLUME_MUSICAL_FOND in 0.3f..0.9f)
    }

    @Test
    fun `revelation avec refrain prepare, le refrain prend le relais en fondu`() {
        assertEquals(LectureMusicale.VERS_REFRAIN, lectureMusicale(Phase.REVEAL, enPause = false, refrainPret = true))
    }

    @Test
    fun `pause generale, la chanson attend`() {
        assertEquals(LectureMusicale.PAUSE, lectureMusicale(Phase.CLOSED, enPause = true, refrainPret = false))
        assertEquals(LectureMusicale.PAUSE, lectureMusicale(Phase.REVEAL, enPause = true, refrainPret = true))
    }

    @Test
    fun `au classement, la chanson s'arrete (Aerodynamic prend la suite)`() {
        assertNull(lectureMusicale(Phase.SCORES, enPause = false, refrainPret = true))
    }
}
