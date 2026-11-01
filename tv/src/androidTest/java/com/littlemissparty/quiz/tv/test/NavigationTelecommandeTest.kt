package com.littlemissparty.quiz.tv.test

import android.view.KeyEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.littlemissparty.quiz.tv.habillage.Look
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

/** Le salon, le lancement et les fenêtres, uniquement avec les touches de la télécommande. */
@RunWith(AndroidJUnit4::class)
class NavigationTelecommandeTest : TestTv() {

    @Test
    fun salonPuisLancementAvecOk() {
        val code = lancerBoite()
        ecran.voit("Scannez pour jouer")
        ecran.voit("En attente des équipes")
        // Game Show : le code de la partie n'est plus sur l'accueil (cedric, 24/10), il est dans le menu Retour.
        if (Look.gs) assertFalse("pas de code sur l'accueil", ecran.affiche(code)) else ecran.voit(code)
        assertFalse("Pas de lancement possible sans équipe", ecran.affiche("Lancer la fête !"))
        ecran.capture("salon-vide")
        // Game Show : « Lancer la fête ! » est dans le menu Retour, qui ne le propose pas sans équipe.
        if (Look.gs) {
            ecran.touche(KeyEvent.KEYCODE_BACK)
            ecran.voit("Continuer la partie")
            ecran.voit("Code de la partie : $code")
            assertFalse("Pas de lancement possible sans équipe", ecran.affiche("Lancer la fête !"))
            ecran.ok("Continuer la partie")
            ecran.neVoitPas("Continuer la partie")
        }

        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        ecran.voit("Licornes")
        ecran.voit("1 équipe(s) dans la partie")
        ecran.capture("salon-une-equipe")

        ecran.lancerLaFete()
        ecran.voit("Quiz question 1 / ${quiz.questions.size}")
        ecran.voit(quiz.questions[0].text)
        ecran.voit("Arrêter le chrono")
        ecran.capture("question-1")
        attendreQuestion(licornes, code, 0)
    }

    @Test
    fun pauseAvecLaToucheLecture() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        ecran.lancerLaFete()
        attendreQuestion(licornes, code, 0)

        ecran.touche(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
        ecran.voit("Le chrono est arrêté")
        ecran.capture("pause")
        attendreQue("pause publiée") { licornes.etat(code).takeIf { it.child("paused").value == true } }

        // Double appui sur « Reprendre » : le second ne doit pas arrêter le chrono qui repart.
        ecran.voit("Reprendre")
        ecran.focusSur("Reprendre")
        ecran.device.pressDPadCenter()
        Thread.sleep(250)
        ecran.device.pressDPadCenter()
        ecran.neVoitPas("Le chrono est arrêté")
        attendreQue("reprise publiée") { licornes.etat(code).takeIf { it.child("paused").value == false } }
        Thread.sleep(3_000)
        assertEquals("question", licornes.etat(code).child("phase").value)
    }

    @Test
    fun retourOuvreLaFenetreSansQuitter() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        ecran.lancerLaFete()
        attendreQuestion(licornes, code, 0)

        ecran.device.pressBack()
        ecran.focusSur("Continuer la partie")
        // Le chrono s'arrête pendant que la fenêtre est ouverte.
        attendreQue("pause pendant la fenêtre") { licornes.etat(code).takeIf { it.child("paused").value == true } }
        ecran.capture("fenetre-retour")

        ecran.ok("Continuer la partie")
        ecran.neVoitPas("Continuer la partie")
        ecran.voit("Quiz question 1 / ")
        attendreQue("chrono relancé") { licornes.etat(code).takeIf { it.child("paused").value == false } }
    }

    @Test
    fun reconnecterUneTabletteGardeLEquipeEtSesPoints() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        ecran.lancerLaFete()
        attendreQuestion(licornes, code, 0)

        // Menu Retour → « Reconnecter une tablette » : QR code, puis attente de la nouvelle tablette.
        ecran.device.pressBack()
        ecran.focusSur("Continuer la partie")
        repeat(3) { ecran.touche(KeyEvent.KEYCODE_DPAD_DOWN) }
        ecran.ok("Reconnecter une tablette")
        ecran.voit("En attente de la nouvelle tablette…")
        ecran.entierementVisible("Reconnecter une tablette")
        ecran.capture("reconnecter-tablette")

        // La nouvelle tablette touche « Licornes » : la TV propose de la lui confier, sélection déjà dessus.
        val neuve = pupitre("neuve")
        neuve.demanderReprise(code, licornes.uid, "Licornes", VERT)
        ecran.ok("Confier « Licornes » à la nouvelle tablette")
        attendreQue("tablette rattachée à l'équipe") {
            licornes.equipes(code).child("${licornes.uid}/device").value?.takeIf { it == neuve.uid }
        }
        ecran.neVoitPas("Reconnecter une tablette")
        assertEquals("une seule équipe, la même", 1L, licornes.equipes(code).childrenCount)
    }

    @Test
    fun nouvellePartieDepuisLaFenetreAvecLesFleches() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        ecran.lancerLaFete()
        attendreQuestion(licornes, code, 0)

        ecran.device.pressBack()
        // Descend avec la flèche bouton par bouton : chacun prend la sélection et reste lisible en entier,
        // jusqu'au dernier, qui était coupé sur la vraie TV.
        val cible = "Terminer et lancer une nouvelle partie"
        val menu = listOf(
            "Continuer la partie", "Donner des points", "Reconnecter la régie", "Reconnecter une tablette", "Rechercher une mise à jour",
            "Vider le cache des médias", "🎨 Design : ${Look.design.nom}", "Quitter l'application", cible,
            "Terminer la partie et quitter",
        )
        menu.forEachIndexed { i, bouton ->
            if (i > 0) ecran.touche(KeyEvent.KEYCODE_DPAD_DOWN)
            ecran.focusSur(bouton)
            ecran.entierementVisible(bouton)
        }
        ecran.capture("fenetre-nouvelle-partie")
        ecran.touche(KeyEvent.KEYCODE_DPAD_UP)
        ecran.ok(cible)

        val nouveau = attendreQue("nouvelle partie créée", 30_000) { Boite.codeActif()?.takeIf { it != code } }
        assertNotEquals(code, nouveau)
        ecran.voit("Scannez pour jouer", 30_000)
        // Game Show : plus de code de la partie sur l'accueil (cedric, 24/10), il est dans le menu Retour.
        if (!Look.gs) ecran.voit(nouveau)
        assertEquals("ended", licornes.etat(code).child("phase").value)
    }

    @Test
    fun terminerLaPartieEtQuitter() {
        // cedric, 31/10 au soir : en fin de soirée, terminer la partie et fermer l'appli d'un seul coup.
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        ecran.lancerLaFete()
        attendreQuestion(licornes, code, 0)

        ecran.device.pressBack()
        // Dernier bouton de la fenêtre, sous le bas de l'écran : on y descend à la flèche, comme à la télécommande.
        ecran.voit("Continuer la partie")
        val avant = listOf(
            "Donner des points", "Reconnecter la régie", "Reconnecter une tablette", "Rechercher une mise à jour",
            "Vider le cache des médias", "🎨 Design : ${Look.design.nom}", "Quitter l'application", "Terminer et lancer une nouvelle partie",
        )
        avant.forEach { bouton -> ecran.touche(KeyEvent.KEYCODE_DPAD_DOWN); ecran.focusSur(bouton) }
        ecran.touche(KeyEvent.KEYCODE_DPAD_DOWN)
        ecran.ok("Terminer la partie et quitter")
        attendreQue("partie terminée", 30_000) { licornes.etat(code).child("phase").value?.takeIf { it == "ended" } }
        assertEquals("rien à reprendre au prochain démarrage", null, Boite.codeActif())
        assertNotNull("aucune nouvelle partie", licornes.etat(code).child("leftAt").value)
        assertEquals("pas de suite : on a quitté", null, licornes.etat(code).child("suite").value)
    }
}
