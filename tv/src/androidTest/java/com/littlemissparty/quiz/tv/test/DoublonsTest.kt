package com.littlemissparty.quiz.tv.test

import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.littlemissparty.quiz.engine.Scoring
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Réponses, inscriptions et appuis en double : comptés une seule fois. */
@RunWith(AndroidJUnit4::class)
class DoublonsTest : TestTv() {

    @Test
    fun deuxiemeReponseDuMemePupitreRefusee() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        ecran.voit("Dragons")
        ecran.ok("Lancer la fête")
        val q = attendreQuestion(licornes, code, 0)

        assertTrue(licornes.repondre(code, q.id, q.correct))
        assertFalse("Une équipe ne peut pas changer sa réponse", licornes.repondre(code, q.id, mauvaiseReponse(q)))
        assertTrue(dragons.repondre(code, q.id, mauvaiseReponse(q)))
        ecran.voit("Toutes les équipes ont répondu")
        ecran.ok("Révéler la réponse")
        ecran.voit("Voir les scores")
        val gagne = points(licornes, code, licornes.uid)
        assertTrue("Points comptés une seule fois : $gagne", gagne.toInt() in Scoring.BASE..(Scoring.BASE + Scoring.MAX_BONUS))
    }

    @Test
    fun memeTabletteQuiRejointDeuxFois() {
        val code = lancerBoite()
        val licornes = pupitre("licornes")
        licornes.rejoindre(code, "Licornes", VERT)
        licornes.rejoindre(code, "Licornes", VERT)
        ecran.voit("Licornes")
        ecran.voit("1 équipe(s) dans la partie")
        assertEquals(1L, licornes.equipes(code).childrenCount)
    }

    @Test
    fun doubleAppuiRapideSurOk() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        ecran.voit("Lancer la fête")
        ecran.focusSur("Lancer la fête")
        // Un enfant ou une animatrice pressée appuie deux fois très vite : 250 ms entre les deux appuis.
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val premier = SystemClock.uptimeMillis()
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
        Thread.sleep(250)
        val second = SystemClock.uptimeMillis()
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
        Log.i(TAG, "Double appui : ${second - premier} ms entre les deux")
        Thread.sleep(3000)
        ecran.capture("apres-double-appui")
        assertEquals(
            "Le second appui ne doit pas arrêter le chrono de la question qui vient de s'ouvrir",
            "question", licornes.etat(code).child("phase").value,
        )
    }
}
