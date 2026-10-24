package com.littlemissparty.quiz.tv.test

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Essai sur émulateur du 23 octobre (huit équipes) : toute l'appli s'est arrêtée parce qu'Android a relancé, sur un
 * fil à lui, le second lecteur d'une boucle de musique qui venait d'être rendu. Ce même échec, reproduit ici avec la
 * pile relevée ce jour-là, est noté dans les rapports et la partie continue.
 */
@RunWith(AndroidJUnit4::class)
class RelaisBoucleTest : TestTv() {

    @Test
    fun unRelaisDeBoucleRateParAndroidNArretePasLaPartie() {
        val code = lancerBoite()
        pupitre("licornes").rejoindre(code, "Licornes", VERT)
        ecran.voit("Licornes")

        val fil = Thread {
            throw IllegalStateException().apply {
                stackTrace = arrayOf(
                    StackTraceElement("android.media.MediaPlayer", "_start", "MediaPlayer.java", -2),
                    StackTraceElement("android.media.MediaPlayer", "startImpl", "MediaPlayer.java", 1342),
                    StackTraceElement("android.media.MediaPlayer", "start", "MediaPlayer.java", 1317),
                    StackTraceElement("android.media.MediaPlayer$6", "run", "MediaPlayer.java", 3659),
                    StackTraceElement("java.lang.Thread", "run", "Thread.java", 764),
                )
            }
        }
        fil.start()
        fil.join(5_000)
        assertFalse("le fil du relais s'est éteint", fil.isAlive)

        // Toujours la même partie, toujours à l'écran : une deuxième équipe peut encore la rejoindre.
        Thread.sleep(1_000)
        assertEquals(code, Boite.codeActif())
        pupitre("dragons").rejoindre(code, "Dragons", ROSE)
        ecran.voit("Dragons")
    }
}
