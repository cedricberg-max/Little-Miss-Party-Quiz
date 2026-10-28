package com.littlemissparty.quiz.tv.test

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.littlemissparty.quiz.tv.habillage.Tempo
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Podium du Game Show, les deux cas limites (cedric, 25/10 au soir : « comment c'est codé ? il faut y penser ») :
 * personne n'a marqué → aucun gagnant, « Bravo à toutes les équipes ! » ; égalité en tête → « ÉGALITÉ ! » et les noms
 * de toutes les équipes à égalité.
 */
@RunWith(AndroidJUnit4::class)
class PodiumCasLimitesTest : TestTv() {

    private val regies = mutableListOf<RegieSimulee>()

    @Before
    fun gameShow() {
        RegieSimulee.definirMotDePasse()
        Boite.choisirDesign(Boite.designDesTests)
    }

    @After
    fun rangerRegies() = regies.forEach { it.close() }

    private fun regieReliee(code: String): RegieSimulee {
        val regie = RegieSimulee().also { regies += it }
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        ecran.voit("Régie reliée")
        return regie
    }

    @Test
    fun personneNAMarqueAucunGagnant() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        val regie = regieReliee(code)
        assertEquals("applied", regie.commande(code, "next"))
        attendreQuestion(licornes, code, 0)

        assertEquals("applied", regie.commande(code, "end"))
        ecran.voit("Bravo à toutes les équipes", 45_000)
        ecran.voit("Merci d'avoir joué")
        ecran.neVoitPas("Victoire de", 1_000)
        ecran.neVoitPas("ÉGALITÉ", 1_000)
        ecran.capture("podium-zero")
    }

    @Test
    fun egaliteEnTeteLesDeuxNoms() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        val chats = pupitre("chats").also { it.rejoindre(code, "Chats", "#FFE600") }
        val regie = regieReliee(code)
        assertEquals("applied", regie.commande(code, "next"))
        attendreQuestion(licornes, code, 0)

        // Licornes et Dragons à égalité en tête (50), les Chats derrière (20).
        for ((equipe, points) in listOf(licornes to 50, dragons to 50, chats to 20)) {
            val id = regie.envoyer(code, "adjust", extra = mapOf("team" to equipe.uid, "delta" to points))!!
            assertEquals("applied", regie.verdict(code, id))
            attendreQue("points de ${equipe.uid}") { points(licornes, code, equipe.uid).takeIf { it == points.toLong() } }
        }

        assertEquals("applied", regie.commande(code, "end"))
        ecran.voit("ÉGALITÉ", 45_000)
        val victoire = attendreQue("noms des gagnants") { ecran.elements().firstOrNull { "Victoire de" in it.texte }?.texte }
        assertTrue(victoire, "Licornes" in victoire && "Dragons" in victoire && "Chats" !in victoire)
        ecran.voit("50 POINTS")
        // Seuls les gagnants : les Chats (3es) n'apparaissent plus dessous (cedric, 26/10).
        seulementLesGagnants("Chats")
        ecran.capture("podium-egalite")
    }

    @Test
    fun gagnantSeulSansLesAutresEquipes() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        val regie = regieReliee(code)
        assertEquals("applied", regie.commande(code, "next"))
        attendreQuestion(licornes, code, 0)

        for ((equipe, points) in listOf(licornes to 80, dragons to 30)) {
            val id = regie.envoyer(code, "adjust", extra = mapOf("team" to equipe.uid, "delta" to points))!!
            assertEquals("applied", regie.verdict(code, id))
            attendreQue("points de ${equipe.uid}") { points(licornes, code, equipe.uid).takeIf { it == points.toLong() } }
        }

        assertEquals("applied", regie.commande(code, "end"))
        ecran.voit("Bravo à toutes les équipes", 45_000)
        // Écran final : le gagnant seul (cedric, 26/10 : « 2 Sacha 250 » sous le gagnant, « je ne vois pas l'intérêt »).
        seulementLesGagnants("Dragons")
        ecran.capture("podium-gagnant-seul")
    }

    /**
     * Les noms des tubes restent jusqu'à leur descente sous le plateau ([Tempo.PODIUM_REVELATION]), et les textes de la
     * révélation sont déjà là, invisibles, avant : on attend que [perdante] quitte l'écran avec les tubes, puis on
     * vérifie qu'elle ne revient pas dessous (l'ancienne bande des autres équipes arrivait après le nom du gagnant).
     */
    private fun seulementLesGagnants(perdante: String) {
        ecran.neVoitPas(perdante, Tempo.PODIUM_REVELATION + 10_000)
        Thread.sleep(4_000)
        assertFalse("« $perdante » revenue sous les gagnants", ecran.affiche(perdante))
    }
}
