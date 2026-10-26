package com.littlemissparty.quiz.tv.test

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.littlemissparty.quiz.tv.habillage.Look
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * « 🏁 Fin de la fête » sur la régie du téléphone (cedric, 23/10) : une fois la partie terminée (écran « Merci d'avoir
 * participé »), la TV quitte la fête et revient à l'accueil avec une nouvelle partie ; la partie quittée est marquée
 * (`leftAt`) et pointe vers la nouvelle (`suite`), où la régie est déjà reliée. Avant la fin, la commande est refusée.
 */
@RunWith(AndroidJUnit4::class)
class FinDeLaFeteTest : TestTv() {

    private val regies = mutableListOf<RegieSimulee>()

    @Before
    fun motDePasse() = RegieSimulee.definirMotDePasse()

    @After
    fun rangerRegies() = regies.forEach { it.close() }

    @Test
    fun laFinDeLaFeteRameneLaTvALAccueil() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = RegieSimulee().also { regies += it }
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        ecran.voit("Régie reliée")

        // Partie pas encore terminée : refusée, la TV garde la fête.
        val tropTot = regie.envoyer(code, "newgame") ?: throw AssertionError("« newgame » refusée par le serveur")
        assertEquals("refused", regie.verdict(code, tropTot))
        assertEquals("not_ended", regie.raison(code, tropTot))
        assertEquals(code, Boite.codeActif())
        assertEquals(null, licornes.etat(code).child("leftAt").value)

        assertEquals("applied", regie.commande(code, "end"))
        attendreQue("partie terminée") { licornes.etat(code).child("phase").value?.takeIf { it == "ended" } }
        ecran.capture("ecran-de-fin")

        // « 🏁 Fin de la fête » : nouvelle partie à l'accueil, l'ancienne marquée quittée.
        assertEquals("applied", regie.commande(code, "newgame"))
        val nouveau = attendreQue("nouvelle partie créée", 30_000) { Boite.codeActif()?.takeIf { it != code } }
        assertNotEquals(code, nouveau)
        ecran.voit("Scannez pour jouer", 30_000)
        // Game Show : plus de code de la partie sur l'accueil (cedric, 24/10), il est dans le menu Retour.
        if (!Look.gs) ecran.voit(nouveau)
        attendreQue("ancienne partie marquée quittée") { licornes.etat(code).child("leftAt").value as? Number }
        assertEquals("ended", licornes.etat(code).child("phase").value)
        // La régie et les tablettes suivent seules (cedric, 25/10) : le téléphone est déjà relié à la nouvelle partie,
        // et l'ancienne pointe vers elle.
        attendreQue("régie reliée à la nouvelle partie") { regie.estRelie(nouveau).takeIf { it } }
        assertEquals(nouveau, licornes.etat(code).child("suite").value)
        ecran.capture("retour-accueil")
    }
}
