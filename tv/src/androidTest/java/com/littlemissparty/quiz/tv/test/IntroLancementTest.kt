package com.littlemissparty.quiz.tv.test

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.littlemissparty.quiz.tv.habillage.Habillage
import com.littlemissparty.quiz.tv.habillage.Sons
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Collections
import java.util.UUID

/**
 * Design « The Game Show » (cedric, 23/10 : « je ne vois pas mon introduction avec le robot qui s'éveille ») : quand
 * Sarah lance la fête depuis l'accueil, la grande intro passe par-dessus la présentation du premier jeu. Elle ne
 * bloque jamais Sarah : l'épreuve lancée (régie ou télécommande) ou une pause l'arrêtent, et elle ne revient pas.
 */
@RunWith(AndroidJUnit4::class)
class IntroLancementTest : TestTv() {
    private val regies = mutableListOf<RegieSimulee>()

    @Before
    fun gameShow() {
        RegieSimulee.definirMotDePasse()
        Boite.choisirDesign(Boite.designDesTests)
    }

    @After
    fun ranger() = regies.forEach { runCatching { it.close() } }

    private fun regie() = RegieSimulee().also { regies += it }

    private val questions = listOf(
        mapOf(
            "id" to "p1", "text" to "Quel animal miaule ?", "choices" to listOf("Le chat", "Le chien"), "correct" to 0,
            "duration" to 30, "kind" to "classic", "double" to false, "round" to "Quiz des animaux",
        ),
    )

    private fun introALEcran(): Boolean = attendreQue("grande intro du lancement") { Habillage.introLancement.value.takeIf { it } }

    private fun introFinie() = attendreQue("fin de la grande intro") { (!Habillage.introLancement.value).takeIf { it } }

    @Test
    fun laFeteLanceeDepuisLAccueilJoueLIntroQueLaPauseArreteSansRetour() {
        val code = lancerBoite()
        pupitre("licornes").rejoindre(code, "Licornes", VERT)
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        assertEquals("applied", regie.chargerPrestation(code, "L'anniversaire de Léa", questions, prenom = "Léa", prestation = "lea-${UUID.randomUUID().toString().take(8)}"))
        ecran.voit("Joyeux anniversaire Léa !")
        ecran.voit("Scannez pour jouer")
        assertFalse("pas d'intro tant que la fête n'est pas lancée", Habillage.introLancement.value)
        ecran.capture("accueil-game-show")

        assertEquals("applied", regie.commande(code, "next"))
        assertTrue(introALEcran())
        // La présentation du jeu est dessous, son bouton garde la télécommande.
        ecran.voit("Lancer l'épreuve")
        ecran.capture("intro-lancement")

        assertEquals("applied", regie.commande(code, "pause"))
        introFinie()
        assertEquals("applied", regie.commande(code, "resume"))
        Thread.sleep(2_000)
        assertFalse("l'intro arrêtée par la pause ne revient pas", Habillage.introLancement.value)
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Quel animal miaule ?")
    }

    /**
     * Test Mi Box du 26/10 : « Intro du lancement : la vidéo ne se lit pas » dans les rapports à chaque fête, alors que
     * cedric l'a vue en entier. La fin normale de l'intro retire la vidéo de l'écran, ce qui détruit sa surface : ce
     * n'est pas un échec, rien ne doit partir dans les rapports.
     */
    @Test
    fun lIntroFinieNormalementNEnvoieAucunIncident() {
        val code = lancerBoite()
        val incidents = Collections.synchronizedList(mutableListOf<String>())
        val avant = Sons.rapporteur
        Sons.rapporteur = { texte -> incidents += texte; avant?.invoke(texte) }
        try {
            pupitre("licornes").rejoindre(code, "Licornes", VERT)
            val regie = regie()
            assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
            assertEquals("applied", regie.chargerPrestation(code, "L'anniversaire de Léa", questions, prenom = "Léa", prestation = "lea-${UUID.randomUUID().toString().take(8)}"))
            ecran.voit("Scannez pour jouer")
            assertEquals("applied", regie.commande(code, "next"))
            assertTrue(introALEcran())
            // 31,6 s de vidéo, jusqu'au bout, sans pause ni épreuve lancée.
            attendreQue("fin naturelle de la grande intro", 60_000) { (!Habillage.introLancement.value).takeIf { it } }
            Thread.sleep(1_500)
            ecran.voit("Lancer l'épreuve")
            val intro = incidents.filter { "Intro du lancement" in it }
            assertTrue("aucun incident pour une intro finie normalement : $intro", intro.isEmpty())
        } finally {
            Sons.rapporteur = avant
        }
    }

    @Test
    fun laTelecommandeLanceLEpreuvePendantLIntro() {
        val code = lancerBoite()
        pupitre("licornes").rejoindre(code, "Licornes", VERT)
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        assertEquals("applied", regie.chargerPrestation(code, "L'anniversaire de Léa", questions, prenom = "Léa", prestation = "lea-${UUID.randomUUID().toString().take(8)}"))
        ecran.lancerLaFete()
        assertTrue(introALEcran())
        ecran.ok("Lancer l'épreuve")
        introFinie()
        ecran.voit("Quel animal miaule ?")
    }
}
