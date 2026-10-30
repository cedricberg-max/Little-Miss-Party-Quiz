package com.littlemissparty.quiz.tv.test

import android.view.KeyEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.littlemissparty.quiz.engine.Scoring
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Coupures réseau de la box ou d'un pupitre pendant la partie. */
@RunWith(AndroidJUnit4::class)
class ReconnexionTest : TestTv() {

    @Test
    fun boiteHorsConnexionPuisRetour() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        ecran.voit("Licornes")

        Boite.base.goOffline()
        try {
            ecran.voit("Hors connexion")
            ecran.capture("hors-connexion")
            // La télécommande reste utilisable : la box avance seule et enverra tout au retour du réseau.
            ecran.lancerLaFete()
            ecran.voit("Quiz question 1 / ")
            // Les tablettes ne reçoivent pas la question : la box la fige d'elle-même, chrono arrêté.
            ecran.voit("on attend le retour d'Internet")
            ecran.voit("Le chrono est arrêté")
            ecran.capture("pause-sans-internet")
            assertEquals("lobby", licornes.etat(code).child("phase").value)
        } finally {
            Boite.base.goOnline()
        }

        ecran.neVoitPas("Hors connexion", 30_000)
        val q = attendreQuestion(licornes, code, 0)
        attendreQue("pause automatique publiée au retour du réseau") {
            licornes.etat(code).takeIf { it.child("paused").value == true && it.child("pauseReason").value == "network" }
        }
        // Rien ne repart seul : l'animatrice relance, puis le décompte 3, 2, 1 rouvre les réponses.
        ecran.ok("Reprendre")
        attendreQue("reprise publiée") { licornes.etat(code).takeIf { it.child("paused").value == false } }
        Thread.sleep(3_500)
        assertTrue("Réponse refusée après le retour du réseau", licornes.repondre(code, q.id, q.correct))
        ecran.voit("Toutes les équipes ont répondu")
        ecran.ok("Révéler la réponse")
        ecran.voit("Voir les scores")
        assertTrue(points(licornes, code, licornes.uid) >= Scoring.BASE)
    }

    /**
     * Coupure d'Internet : la box se fige une seule fois ; l'animatrice relance, donne des points à la
     * télécommande, et la question suivante n'est pas figée à nouveau.
     */
    @Test
    fun feteSansInternetALaTelecommande() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        ecran.voit("Licornes")

        Boite.base.goOffline()
        try {
            ecran.voit("Hors connexion")
            ecran.lancerLaFete()
            ecran.voit("on attend le retour d'Internet")
            ecran.capture("pause-sans-internet")
            ecran.ok("Reprendre")
            Thread.sleep(4_000)

            // Menu Retour › « Donner des points » : Licornes, +100, Valider.
            ecran.device.pressBack()
            ecran.focusSur("Continuer la partie")
            ecran.touche(KeyEvent.KEYCODE_DPAD_DOWN)
            ecran.ok("Donner des points")
            ecran.ok("Licornes")
            ecran.voit("✓ Licornes")
            ecran.touche(KeyEvent.KEYCODE_DPAD_DOWN)
            repeat(7) { ecran.touche(KeyEvent.KEYCODE_DPAD_LEFT) }
            ecran.touche(KeyEvent.KEYCODE_DPAD_RIGHT)
            ecran.ok("+100")
            ecran.capture("donner-des-points")
            ecran.touche(KeyEvent.KEYCODE_DPAD_DOWN)
            ecran.ok("Valider +100 pour 1 équipe")
            ecran.neVoitPas("Donner des points")

            // La partie continue à la télécommande ; la question suivante ne se fige pas.
            // Décompte 3, 2, 1 de la reprise, puis le chrono tourne à nouveau.
            Thread.sleep(6_000)
            if (ecran.affiche("Arrêter le chrono")) ecran.ok("Arrêter le chrono")
            ecran.ok("Révéler la réponse")
            ecran.ok("Voir les scores")
            ecran.ok("Question suivante")
            ecran.voit("Quiz question 2 / ")
            Thread.sleep(6_000)
            ecran.neVoitPas("on attend le retour d'Internet")
            ecran.voit("Arrêter le chrono")
        } finally {
            Boite.base.goOnline()
        }

        ecran.neVoitPas("Hors connexion", 30_000)
        attendreQuestion(licornes, code, 1)
        assertEquals("points donnés hors connexion, envoyés au retour", 100L, points(licornes, code, licornes.uid))
    }

    @Test
    fun pupitreQuiPerdLeReseauPuisRevient() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        ecran.voit("Dragons")
        ecran.neVoitPas("hors ligne")

        licornes.couperReseau()
        ecran.voit("hors ligne")
        ecran.capture("pupitre-hors-ligne")
        licornes.retablirReseau(code)
        ecran.neVoitPas("hors ligne")

        // Revenu, le pupitre joue normalement.
        ecran.lancerLaFete()
        val q = attendreQuestion(dragons, code, 0)
        assertTrue(licornes.repondre(code, q.id, q.correct))
        assertTrue(dragons.repondre(code, q.id, mauvaiseReponse(q)))
        ecran.voit("Toutes les équipes ont répondu")
        ecran.ok("Révéler la réponse")
        ecran.voit("Voir les scores")
        assertTrue(points(dragons, code, licornes.uid) >= Scoring.BASE)
    }
}
