package com.littlemissparty.quiz.tv.test

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.littlemissparty.quiz.engine.Scoring
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** La régie sur le téléphone de l'animatrice : connexion par mot de passe commun et pilotage de la TV. */
@RunWith(AndroidJUnit4::class)
class RegieTest : TestTv() {

    @Before
    fun motDePasse() = RegieSimulee.definirMotDePasse()

    @Test
    fun connexionParMotDePassePuisPartiePiloteeDuTelephone() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue("Le bon mot de passe doit relier la régie", regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        ecran.voit("Régie reliée")
        assertTrue("La régie lit le conducteur (bonnes réponses)", regie.lireConducteur(code))
        ecran.capture("regie-reliee")

        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Question 1 / ")
        val q = attendreQuestion(licornes, code, 0)
        assertTrue(licornes.repondre(code, q.id, q.correct))
        ecran.voit("Toutes les équipes ont répondu")

        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Voir les scores")
        val avant = points(licornes, code, licornes.uid)
        assertTrue(avant >= Scoring.BASE)

        // Correction de score depuis la régie.
        assertEquals("applied", regie.commande(code, "adjust", mapOf("team" to licornes.uid, "delta" to 50)))
        attendreQue("correction publiée") { points(licornes, code, licornes.uid).takeIf { it == avant + 50 } }
        ecran.capture("apres-correction")
    }

    @Test
    fun mauvaisMotDePasseRefuse() {
        val code = lancerBoite()
        pupitre("licornes").rejoindre(code, "Licornes", VERT)
        val regie = regie()
        assertFalse("Un mauvais mot de passe ne doit pas relier la régie", regie.connecter(code, "pas-le-bon-mot"))
        assertNull("Une régie non reliée ne peut pas envoyer de commande", regie.envoyer(code, "next"))
        assertFalse("Une régie non reliée ne lit pas les bonnes réponses", regie.lireConducteur(code))
        assertFalse(ecran.affiche("Régie reliée"))
        ecran.voit("Lancer le quiz")
    }

    @Test
    fun doubleCommandeNAvanceQuUneSeuleFois() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))

        // Double appui sur « Suivant » : deux commandes avec la même étape affichée.
        val etape = regie.etape(code)
        val premiere = regie.envoyer(code, "next", etape)!!
        val seconde = regie.envoyer(code, "next", etape)!!
        assertEquals("applied", regie.verdict(code, premiere))
        assertEquals("stale", regie.verdict(code, seconde))

        attendreQuestion(licornes, code, 0)
        Thread.sleep(1_000)
        assertEquals("La question doit rester ouverte", "question", licornes.etat(code).child("phase").value)
        ecran.voit("Arrêter le chrono")
    }

    private val regies = mutableListOf<RegieSimulee>()

    private fun regie() = RegieSimulee().also { regies += it }

    @org.junit.After
    fun rangerRegies() = regies.forEach { it.close() }
}
