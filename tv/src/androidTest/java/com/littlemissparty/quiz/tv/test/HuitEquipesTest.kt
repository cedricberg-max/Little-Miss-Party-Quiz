package com.littlemissparty.quiz.tv.test

import android.view.KeyEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.littlemissparty.quiz.tv.TEAM_COLORS
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Huit équipes aux noms longs : la plupart des fêtes en ont 4, mais il peut y en avoir jusqu'à 8.
 * Aucun bouton ne doit sortir de l'écran ni être rogné, et chaque équipe doit rester à l'écran.
 */
@RunWith(AndroidJUnit4::class)
class HuitEquipesTest : TestTv() {

    private val noms = listOf(
        "Les Licornes Roses", "Les Dragons Dorés", "Les Comètes", "Les Pirates du Lac",
        "Les Panthères", "Les Fusées", "Les Sirènes Bleues", "Les Ninjas",
    )

    @Test
    fun huitEquipesToutResteALEcran() {
        val code = lancerBoite()
        val equipes = noms.mapIndexed { i, nom -> pupitre("equipe$i").also { it.rejoindre(code, nom, TEAM_COLORS[i]) } }
        ecran.voit("8 équipes : la partie est complète")
        noms.forEach { ecran.voit(it) }
        ecran.capture("salon-8-equipes")
        // Le plus important : « Lancer la fête ! » (sur l'écran, ou dans le menu Retour du Game Show) reste entier.
        ecran.montrerLancement()
        ecran.entierementVisible("Lancer la fête !")
        ecran.lancerLaFete()

        val q = attendreQuestion(equipes[0], code, 0)
        ecran.entierementVisible("Arrêter le chrono")
        ecran.capture("question-8-equipes")
        equipes.forEachIndexed { i, e -> e.repondre(code, q.id, if (i % 2 == 0) q.correct else mauvaiseReponse(q)) }
        ecran.voit("Toutes les équipes ont répondu")
        ecran.entierementVisible("Révéler la réponse")
        ecran.ok("Révéler la réponse")
        ecran.entierementVisible("Voir les scores")
        ecran.capture("revelation-8-equipes")
        ecran.ok("Voir les scores")
        ecran.voit(titreClassement())
        noms.forEach { ecran.voit(it) }
        ecran.entierementVisible("Question suivante")
        ecran.capture("classement-8-equipes")

        // « Donner des points » (fête sans Internet) : les 8 équipes et tous les boutons restent à l'écran.
        ecran.device.pressBack()
        ecran.focusSur("Continuer la partie")
        ecran.touche(KeyEvent.KEYCODE_DPAD_DOWN)
        ecran.ok("Donner des points")
        noms.forEach { ecran.entierementVisible(it) }
        listOf("+300", "−100", "Choisissez les équipes, puis les points", "Fermer").forEach { ecran.entierementVisible(it) }
        ecran.capture("donner-des-points-8-equipes")
        ecran.device.pressBack()
        ecran.neVoitPas("Donner des points")
        ecran.voit(titreClassement())
    }
}
