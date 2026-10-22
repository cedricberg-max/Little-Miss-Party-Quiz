package com.littlemissparty.quiz.tv.test

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

/**
 * Design « The Game Show » : le logo « THE GAME SHOW by Little Miss Party » est au centre de l'écran sur la pause et
 * sur la victoire (cedric, test du 22/10 : il partait vers la gauche sur les scores finaux).
 */
@RunWith(AndroidJUnit4::class)
class LogoGameShowTest : TestTv() {

    private val regies = mutableListOf<RegieSimulee>()

    private fun design(cle: String) =
        Boite.contexte.getSharedPreferences("lmp_design", Context.MODE_PRIVATE).edit().putString("design", cle).commit()

    @Before
    fun gameShow() {
        RegieSimulee.definirMotDePasse()
        design("gs")
    }

    /** Les autres tests restent en design Classique, celui de la box par défaut. */
    @After
    fun classique() {
        regies.forEach { it.close() }
        design("classique")
    }

    /**
     * « THE » et « GAME SHOW » : au milieu de l'écran, à 1 % de sa largeur près. Sur la pause, le petit logo du bas de
     * l'écran de jeu reste dessous, à gauche : on mesure celui qui est le plus près du centre.
     */
    private fun logoAuCentre(ou: String) {
        for (texte in listOf("THE", "GAME SHOW")) {
            val e = attendreQue("« $texte » du logo, $ou") {
                ecran.elements().filter { it.texte == texte && it.visible }.minByOrNull { abs(it.centreX - it.largeurFenetre / 2f) }
            }
            val ecart = abs(e.centreX - e.largeurFenetre / 2f)
            assertTrue("« $texte » décalé de ${ecart.toInt()} px sur ${e.largeurFenetre}, $ou", ecart <= e.largeurFenetre * 0.01f)
        }
    }

    @Test
    fun leLogoEstAuCentreSurLaPauseEtSurLaVictoire() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        val regie = RegieSimulee().also { regies += it }
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        ecran.voit("Régie reliée")

        // Une question : les Licornes trouvent, les Dragons non. Elles gagnent donc la partie.
        assertEquals("applied", regie.commande(code, "next"))
        val q = attendreQuestion(licornes, code, 0)
        assertTrue(licornes.repondre(code, q.id, q.correct))
        assertTrue(dragons.repondre(code, q.id, mauvaiseReponse(q)))
        ecran.voit("Toutes les équipes ont répondu")
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("points des Licornes") { points(licornes, code, licornes.uid).takeIf { it > 0 } }

        assertEquals("applied", regie.commande(code, "pause"))
        ecran.voit("PAUSE FUN !")
        logoAuCentre("sur la pause")
        ecran.capture("pause")
        assertEquals("applied", regie.commande(code, "resume"))

        assertEquals("applied", regie.commande(code, "end"))
        ecran.voit("Victoire de Licornes", 30_000)
        logoAuCentre("sur la victoire")
        ecran.capture("victoire")
    }
}
