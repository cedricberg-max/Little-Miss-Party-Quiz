package com.littlemissparty.quiz.tv.test

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
            ecran.ok("Lancer le quiz")
            ecran.voit("Question 1 / ")
            assertEquals("lobby", licornes.etat(code).child("phase").value)
        } finally {
            Boite.base.goOnline()
        }

        ecran.neVoitPas("Hors connexion", 30_000)
        val q = attendreQuestion(licornes, code, 0)
        assertTrue("Réponse refusée après le retour du réseau", licornes.repondre(code, q.id, q.correct))
        ecran.voit("Toutes les équipes ont répondu")
        ecran.ok("Révéler la réponse")
        ecran.voit("Voir les scores")
        assertTrue(points(licornes, code, licornes.uid) >= Scoring.BASE)
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
        ecran.ok("Lancer le quiz")
        val q = attendreQuestion(dragons, code, 0)
        assertTrue(licornes.repondre(code, q.id, q.correct))
        assertTrue(dragons.repondre(code, q.id, mauvaiseReponse(q)))
        ecran.voit("Toutes les équipes ont répondu")
        ecran.ok("Révéler la réponse")
        ecran.voit("Voir les scores")
        assertTrue(points(dragons, code, licornes.uid) >= Scoring.BASE)
    }
}
