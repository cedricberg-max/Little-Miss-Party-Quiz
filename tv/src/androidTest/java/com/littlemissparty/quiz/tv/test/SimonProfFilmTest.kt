package com.littlemissparty.quiz.tv.test

import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * 🔴 Le robot prof du Simon, filmé (cedric, 1/11 au soir : « il doit avoir un peu plus de vie », sans danser) : il
 * respire, se balance à peine, cligne des yeux, regarde le tableau. Un film « simon-film-prof.mp4 » de ~40 s : « PRÊTS ? »
 * (le prof attend), la suite montrée (il montre avec sa règle), puis « Bah alors ?! », pour être regardé image par image.
 */
@RunWith(AndroidJUnit4::class)
class SimonProfFilmTest : TestTv() {

    @Before
    fun motDePasse() = RegieSimulee.definirMotDePasse()

    private val regies = mutableListOf<RegieSimulee>()

    @After
    fun rangerRegies() = regies.forEach { it.close() }

    @Test
    fun leProfVitPendantTouteLaSuite() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val dragons = pupitre("dragons").also { it.rejoindre(code, "Dragons", ROSE) }
        val regie = RegieSimulee().also { regies += it }
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        @Suppress("UNCHECKED_CAST")
        val demo = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val simon = mapOf(
            "id" to "sm", "text" to "Le Simon de Buzzy", "choices" to emptyList<String>(), "correct" to -1,
            "kind" to "simon", "double" to false, "round" to "Le Simon de Buzzy", "tours" to 1, "reponse" to 5, "joueurs" to 2,
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(demo[0] + ("round" to "Quiz"), simon)))
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("question du quiz ouverte") { licornes.etat(code).takeIf { it.child("qid").value == demo[0]["id"] && it.child("phase").value == "question" } }
        attendreQue("premier tour prêt", 30_000) {
            val e = licornes.etat(code)
            if (e.child("qid").value == "sm" && e.child("simon/step").value == "ready") true
            else { if (e.child("qid").value != "sm" || e.child("phase").value == "intro") regie.commande(code, "next"); null }
        }
        ecran.voit("PRÊTS ?")
        SystemClock.sleep(1_500)
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val film = Thread {
            device.executeShellCommand("screenrecord --size 1280x720 --bit-rate 8000000 --time-limit 45 ${Ecran.DOSSIER_CAPTURES}/simon-film-prof.mp4")
        }.apply { start() }
        // 18 s de « PRÊTS ? » : plusieurs clignements et coups d'œil au tableau.
        SystemClock.sleep(18_000)
        ecran.capture("simon-prof-pret")
        assertEquals("applied", regie.commande(code, "simon_go"))
        ecran.voit("À VOUS DE JOUER !", 15_000)
        assertTrue(licornes.repondreSimon(code, emptyList()))
        assertTrue(dragons.repondreSimon(code, emptyList()))
        attendreQue("suite 1 jugée") { licornes.etat(code).takeIf { it.child("simon/step").value == "judged" } }
        SystemClock.sleep(8_000)
        ecran.capture("simon-prof-bilan")
        device.executeShellCommand("pkill -INT screenrecord")
        film.join(10_000)
    }
}
