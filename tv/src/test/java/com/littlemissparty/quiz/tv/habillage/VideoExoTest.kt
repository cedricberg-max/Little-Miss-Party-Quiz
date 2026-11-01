package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Point 46 (cedric, 1/11) : le nouveau lecteur vidéo, boucles sans trou, pour toutes les vidéos qui tournent. */
class VideoExoTest {
    private fun src(chemin: String) = File("src/main/java/com/littlemissparty/quiz/tv/$chemin").readText()

    @Test
    fun `trois facons de jouer, une fois, en boucle, ou une arrivee puis une boucle`() {
        assertEquals(ModeLecture.UNE_FOIS, modeDeLecture(boucle = false, repriseMs = null))
        assertEquals(ModeLecture.BOUCLE, modeDeLecture(boucle = true, repriseMs = null))
        assertEquals(ModeLecture.ARRIVEE_PUIS_BOUCLE, modeDeLecture(boucle = false, repriseMs = 4_000))
        assertEquals(ModeLecture.ARRIVEE_PUIS_BOUCLE, modeDeLecture(boucle = true, repriseMs = 4_000))
        // Reprise au tout début : c'est une boucle entière.
        assertEquals(ModeLecture.BOUCLE, modeDeLecture(boucle = false, repriseMs = 0))
    }

    @Test
    fun `la boucle s enchaine sans s arreter, et l arrivee passe a la boucle coupee au bon endroit`() {
        val v = src("habillage/VideoExo.kt")
        assertTrue(v.contains("ExoPlayer.Builder(context).setLooper(looper)"))
        assertTrue(v.contains("Player.REPEAT_MODE_ONE"))
        assertTrue(v.contains("setStartPositionMs(repriseMs!!.toLong())"))
        assertTrue(v.contains("override fun onMediaItemTransition"))
        // Vidéos muettes : la piste son n'est pas décodée.
        assertTrue(v.contains("setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true)"))
        // Rendu sans bloquer l'écran : arrêté tout de suite, rendu plus tard.
        assertTrue(v.contains("joueur.stop()"))
        assertTrue(v.contains("handler.postDelayed(fin, LIBERATION_DIFFEREE_MS)"))
        assertTrue(LIBERATION_DIFFEREE_MS in 300L..2_000L)
    }

    @Test
    fun `decors, intros, fin, clips de Buzzy, Duel et Chrono passent par le nouveau lecteur, l ancien en secours`() {
        for (f in listOf("habillage/FondVideo.kt", "habillage/LecteurAlpha.kt", "habillage/DuelRobots.kt", "ChronoLancer.kt")) {
            val s = src(f)
            assertTrue(f, s.contains("VideoExo("))
            assertTrue("$f : secours", s.contains("MoteurVideo.ancien = true"))
            assertTrue("$f : nouveau lecteur d'abord", s.contains("!MoteurVideo.ancien"))
        }
        // Le Duel et le Chrono gardent le même lecteur d'un plan à l'autre (rien à rendre entre deux plans).
        assertTrue(src("habillage/DuelRobots.kt").contains("e.charger(resId, boucle)"))
        assertTrue(src("ChronoLancer.kt").contains("e.charger(clip, boucle = false, puisBoucle = boucle)"))
        // Les clips du robot sont rendus sur leur propre fil, tout de suite.
        assertTrue(src("habillage/LecteurAlpha.kt").contains("exo?.liberer(differe = false)"))
        assertFalse(MoteurVideo.ancien)
    }

    @Test
    fun `le lecteur est dans l appli`() {
        val g = File("build.gradle.kts").readText()
        assertTrue(g.contains("androidx.media3:media3-exoplayer:"))
    }
}
