package com.littlemissparty.quiz.tv.test

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.littlemissparty.quiz.engine.Scoring
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** L'appli se ferme ou plante en pleine partie : au redémarrage, rien n'est perdu. */
@RunWith(AndroidJUnit4::class)
class RepriseTest : TestTv() {

    @Test
    fun repriseAvecOkApresFermeture() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        ecran.ok("Lancer la fête !")
        val q = attendreQuestion(licornes, code, 0)
        assertTrue(licornes.repondre(code, q.id, q.correct))
        ecran.voit("Toutes les équipes ont répondu")

        relancerBoite()
        ecran.voit("Une partie est en cours", 30_000)
        ecran.voit("Code $code")
        ecran.voit("Licornes")
        ecran.capture("proposition-reprise")
        ecran.ok("Reprendre la partie")

        // Même partie, même étape : la réponse donnée avant la fermeture compte toujours.
        ecran.voit("Quiz · question 1 / ")
        ecran.ok("Révéler la réponse")
        ecran.voit("Voir les scores")
        assertEquals(code, Boite.codeActif())
        val gagne = attendreQue("points après reprise") {
            licornes.etat(code).child("awards/${licornes.uid}/points").value as? Number
        }.toLong()
        assertTrue("Points après reprise : $gagne", gagne >= Scoring.BASE)
    }

    @Test
    fun repriseAutomatiqueSansToucherLaTelecommande() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        ecran.ok("Lancer la fête !")
        attendreQuestion(licornes, code, 0)

        relancerBoite()
        ecran.voit("Reprise automatique", 30_000)
        ecran.capture("compte-a-rebours")
        ecran.voit("Quiz · question 1 / ", 30_000)
        assertEquals("Aucune nouvelle partie ne doit être créée", code, Boite.codeActif())
    }
}
