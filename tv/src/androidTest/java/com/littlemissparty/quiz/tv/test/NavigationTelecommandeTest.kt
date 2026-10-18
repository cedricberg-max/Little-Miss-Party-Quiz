package com.littlemissparty.quiz.tv.test

import android.view.KeyEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.junit.runner.RunWith

/** Le salon, le lancement et les fenêtres, uniquement avec les touches de la télécommande. */
@RunWith(AndroidJUnit4::class)
class NavigationTelecommandeTest : TestTv() {

    @Test
    fun salonPuisLancementAvecOk() {
        val code = lancerBoite()
        ecran.voit(code)
        ecran.voit("En attente des équipes")
        assertFalse("Pas de lancement possible sans équipe", ecran.affiche("Lancer le quiz"))
        ecran.capture("salon-vide")

        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        ecran.voit("Licornes")
        ecran.voit("1 équipe(s) dans la partie")
        ecran.capture("salon-une-equipe")

        ecran.ok("Lancer le quiz")
        ecran.voit("Question 1 / ${quiz.questions.size}")
        ecran.voit(quiz.questions[0].text)
        ecran.voit("Arrêter le chrono")
        ecran.capture("question-1")
        attendreQuestion(licornes, code, 0)
    }

    @Test
    fun pauseAvecLaToucheLecture() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        ecran.ok("Lancer le quiz")
        attendreQuestion(licornes, code, 0)

        ecran.touche(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
        ecran.voit("Le chrono est arrêté")
        ecran.capture("pause")
        attendreQue("pause publiée") { licornes.etat(code).takeIf { it.child("paused").value == true } }

        ecran.ok("Reprendre")
        ecran.neVoitPas("Le chrono est arrêté")
        attendreQue("reprise publiée") { licornes.etat(code).takeIf { it.child("paused").value == false } }
    }

    @Test
    fun retourOuvreLaFenetreSansQuitter() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        ecran.ok("Lancer le quiz")
        attendreQuestion(licornes, code, 0)

        ecran.device.pressBack()
        ecran.focusSur("Continuer la partie")
        // Le chrono s'arrête pendant que la fenêtre est ouverte.
        attendreQue("pause pendant la fenêtre") { licornes.etat(code).takeIf { it.child("paused").value == true } }
        ecran.capture("fenetre-retour")

        ecran.ok("Continuer la partie")
        ecran.neVoitPas("Continuer la partie")
        ecran.voit("Question 1 / ")
        attendreQue("chrono relancé") { licornes.etat(code).takeIf { it.child("paused").value == false } }
    }

    @Test
    fun nouvellePartieDepuisLaFenetreAvecLesFleches() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        ecran.ok("Lancer le quiz")
        attendreQuestion(licornes, code, 0)

        ecran.device.pressBack()
        ecran.focusSur("Continuer la partie")
        // Descend avec la flèche jusqu'au dernier bouton de la fenêtre.
        val cible = "Terminer et lancer une nouvelle partie"
        repeat(6) { if (!ecran.aLeFocus(cible)) { ecran.touche(KeyEvent.KEYCODE_DPAD_DOWN); Thread.sleep(300) } }
        ecran.capture("fenetre-nouvelle-partie")
        ecran.ok(cible)

        val nouveau = attendreQue("nouvelle partie créée", 30_000) { Boite.codeActif()?.takeIf { it != code } }
        assertNotEquals(code, nouveau)
        ecran.voit("Scannez pour jouer", 30_000)
        ecran.voit(nouveau)
        assertEquals("ended", licornes.etat(code).child("phase").value)
    }
}
