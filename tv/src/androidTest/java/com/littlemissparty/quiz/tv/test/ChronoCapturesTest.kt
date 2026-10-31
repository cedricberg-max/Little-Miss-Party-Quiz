package com.littlemissparty.quiz.tv.test

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.littlemissparty.quiz.tv.TEAM_COLORS
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * ⏱️ Le Chrono de Buzzy, joué de bout en bout sur la box : présentation, tour prêt (objectif en grand), décompte, chrono
 * qui défile, drap de Buzzy, buzz des équipes sous le drap, révélation sur la règle néon (drapeau, ralenti, gagnante),
 * 2e tour, scores ; puis un tour à 8 équipes. Chaque écran est capturé (« chrono-… ») pour la planche de cedric.
 */
@RunWith(AndroidJUnit4::class)
class ChronoCapturesTest : TestTv() {

    @Before
    fun motDePasse() = RegieSimulee.definirMotDePasse()

    private val regies = mutableListOf<RegieSimulee>()

    @After
    fun rangerRegies() = regies.forEach { it.close() }

    /** Exactement ce qu'envoie la régie pour « Le Chrono de Buzzy » (web/public/show.js), cible courte pour le test. */
    private fun chrono(cible: Int, tours: Int) = mapOf(
        "id" to "ch", "text" to "Le Chrono de Buzzy", "choices" to emptyList<String>(), "correct" to -1,
        "duration" to 20, "kind" to "chrono", "double" to false, "round" to "Le Chrono de Buzzy",
        "cible" to cible, "tours" to tours,
    )

    /** Partie avec [noms] ; le quiz de démo puis le chrono ; renvoie le code, la régie et les tablettes au tour prêt. */
    private fun jusquAuChrono(noms: List<String>, cible: Int, tours: Int, presentation: Boolean): Triple<String, RegieSimulee, List<PupitreSimule>> {
        val code = lancerBoite()
        val equipes = noms.mapIndexed { i, nom -> pupitre("equipe$i").also { it.rejoindre(code, nom, TEAM_COLORS[i]) } }
        val regie = RegieSimulee().also { regies += it }
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        @Suppress("UNCHECKED_CAST")
        val demo = regie.programme(code)["questions"] as List<Map<String, Any?>>
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(demo[0] + ("round" to "Quiz"), chrono(cible, tours))))
        assertEquals("applied", regie.commande(code, "next"))
        val lecteur = equipes[0]
        attendreQue("question du quiz ouverte") { lecteur.etat(code).takeIf { it.child("qid").value == demo[0]["id"] && it.child("phase").value == "question" } }
        var vuPresentation = false
        attendreQue("chrono prêt", 60_000) {
            val e = lecteur.etat(code)
            if (e.child("qid").value == "ch" && e.child("phase").value == "intro" && presentation && !vuPresentation) {
                vuPresentation = true
                ecran.capture("chrono-presentation", attente = 4_000)
            }
            if (e.child("qid").value == "ch" && e.child("phase").value == "question" && e.child("chrono/step").value == "ready") true
            else { regie.commande(code, "next"); Thread.sleep(1_500); null }
        }
        return Triple(code, regie, equipes)
    }

    /** Dort jusqu'à l'heure [quand] (horloge de l'appareil, proche de celle du serveur dans l'émulateur). */
    private fun jusqua(quand: Long) {
        val reste = quand - System.currentTimeMillis()
        if (reste > 0) Thread.sleep(reste)
    }

    /**
     * Toutes ont buzzé : la TV n'enchaîne plus seule (cedric, 31/10), elle attend le « 👀 Révéler » de Sarah ; la régie
     * le propose, Sarah l'envoie. [capture] : l'écran pendant l'attente.
     */
    private fun attendRevelation(lecteur: PupitreSimule, regie: RegieSimulee, code: String, capture: String? = null) {
        attendreQue("Révéler proposé") { lecteur.etat(code).takeIf { it.child("chrono/reveler").value == true } }
        Thread.sleep(1_500)
        assertEquals("la TV attend Sarah", "run", lecteur.etat(code).child("chrono/step").value)
        if (capture != null) ecran.capture(capture)
        assertEquals("applied", regie.commande(code, "chrono_reveal"))
    }

    @Test
    fun chronoDeBuzzyQuatreEquipesDeuxTours() {
        val (code, regie, equipes) = jusquAuChrono(listOf("Les Licornes", "Les Dragons", "Les Fusées", "Les Pandas"), 10, 2, presentation = true)
        val lecteur = equipes[0]
        ecran.capture("chrono-pret", attente = 2_000)

        // Film du tour 1 entier, du décompte à la gagnante (sans son : l'émulateur n'en a pas ; les sons sont ajoutés
        // après sur la planche de cedric, calés sur l'image).
        val film = Thread {
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).executeShellCommand(
                "screenrecord --size 1280x720 --bit-rate 2500000 --time-limit 32 ${Ecran.DOSSIER_CAPTURES}/chrono-tour-apercu.mp4",
            )
        }.apply { start() }
        // Tour 1 : 3, 2, 1, le chrono défile, le drap tombe ; buzz échelonnés autour de 10 s.
        assertEquals("applied", regie.commande(code, "chrono_go"))
        val e = attendreQue("chrono lancé") { lecteur.etat(code).takeIf { it.child("chrono/step").value == "run" } }
        val goAt = (e.child("chrono/goAt").value as Number).toLong()
        val cache = (e.child("chrono/cacheMs").value as Number).toLong()
        jusqua(goAt - 1_400)
        ecran.capture("chrono-decompte")
        // Le clip du lancer à deux mains : Buzzy revient avec le drap tendu (2,4 s avant la pose), puis le drap en vol.
        jusqua(goAt + cache - 2_400)
        ecran.capture("chrono-lancer-retour")
        jusqua(goAt + cache - 500)
        ecran.capture("chrono-lancer-vol")
        jusqua(goAt + 2_300)
        ecran.capture("chrono-defile")
        jusqua(goAt + cache + 200)
        ecran.capture("chrono-drap-tombe")
        jusqua(goAt + cache + 1_400)
        ecran.capture("chrono-drap")
        // Pandas trop tôt (8 s), Licornes tout près (9,7 s), Dragons (10,4 s), Fusées trop tard (11,6 s).
        jusqua(goAt + 8_000); assertTrue(equipes[3].buzzerChrono(code))
        jusqua(goAt + 9_700); assertTrue(equipes[0].buzzerChrono(code))
        assertTrue("un seul buzz par équipe", !equipes[0].buzzerChrono(code))
        ecran.capture("chrono-buzz", attente = 300)
        jusqua(goAt + 10_400); assertTrue(equipes[1].buzzerChrono(code))
        jusqua(goAt + 11_600); assertTrue(equipes[2].buzzerChrono(code))
        attendRevelation(lecteur, regie, code, "chrono-attente-reveler")
        attendreQue("tour jugé", 20_000) { lecteur.etat(code).takeIf { it.child("chrono/step").value == "result" } }
        val debut = System.currentTimeMillis()
        jusqua(debut + 1_100)
        ecran.capture("chrono-revelation-drapeau")
        jusqua(debut + 3_200)
        ecran.capture("chrono-revelation-pastilles")
        jusqua(debut + 4_700)
        ecran.capture("chrono-revelation-ralenti")
        jusqua(debut + 7_500)
        ecran.capture("chrono-revelation-gagnant")
        val r = lecteur.etat(code).child("chrono/result")
        assertEquals("100, 50, 25 : les trois plus proches", 3L, r.child("gains").childrenCount)
        film.join(40_000)

        // Tour 2 : la régie change la cible (15 s), même déroulé plus vite ; puis les scores.
        assertEquals("applied", regie.commande(code, "chrono_go"))
        attendreQue("tour 2 prêt") { lecteur.etat(code).takeIf { it.child("chrono/step").value == "ready" && (it.child("chrono/tour").value as Number).toInt() == 2 } }
        assertEquals("applied", regie.commande(code, "chrono_cible", mapOf("cible" to 15)))
        ecran.capture("chrono-pret-tour-2", attente = 1_500)
        assertEquals("applied", regie.commande(code, "chrono_go"))
        val e2 = attendreQue("tour 2 lancé") { lecteur.etat(code).takeIf { it.child("chrono/step").value == "run" } }
        val go2 = (e2.child("chrono/goAt").value as Number).toLong()
        listOf(14_000L, 15_100L, 16_900L, 13_200L).withIndex().sortedBy { it.value }.forEach { (i, ms) ->
            jusqua(go2 + ms); assertTrue(equipes[i].buzzerChrono(code))
        }
        attendRevelation(lecteur, regie, code)
        attendreQue("tour 2 jugé", 20_000) { lecteur.etat(code).takeIf { it.child("chrono/step").value == "result" } }
        ecran.capture("chrono-revelation-tour-2", attente = 7_500)
        assertEquals(true, lecteur.etat(code).child("chrono/last").value)
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("après le chrono", 20_000) { lecteur.etat(code).takeIf { it.child("phase").value != "question" } }
        ecran.capture("chrono-scores", attente = 4_000)
    }

    @Test
    fun chronoDeBuzzyHuitEquipes() {
        val noms = listOf("Les Licornes Roses", "Les Dragons Dorés", "Les Comètes", "Les Pirates du Lac", "Les Panthères", "Les Fusées", "Les Sirènes Bleues", "Les Ninjas")
        val (code, regie, equipes) = jusquAuChrono(noms, 10, 1, presentation = false)
        val lecteur = equipes[0]
        ecran.capture("chrono-8-equipes-pret", attente = 2_000)
        assertEquals("applied", regie.commande(code, "chrono_go"))
        val e = attendreQue("chrono lancé") { lecteur.etat(code).takeIf { it.child("chrono/step").value == "run" } }
        val goAt = (e.child("chrono/goAt").value as Number).toLong()
        val cache = (e.child("chrono/cacheMs").value as Number).toLong()
        val moments = listOf(9_800L, 10_600L, 8_300L, 11_900L, 10_150L, 7_400L, 12_800L, 9_300L)
        var capture = false
        moments.withIndex().sortedBy { it.value }.forEach { (i, ms) ->
            if (!capture && ms > 10_000) { ecran.capture("chrono-8-equipes-buzz"); capture = true }
            jusqua(goAt + maxOf(ms, cache + 500)); assertTrue(equipes[i].buzzerChrono(code))
        }
        attendRevelation(lecteur, regie, code)
        attendreQue("tour jugé", 20_000) { lecteur.etat(code).takeIf { it.child("chrono/step").value == "result" } }
        val debut = System.currentTimeMillis()
        jusqua(debut + 6_000)
        ecran.capture("chrono-8-equipes-pastilles")
        jusqua(debut + 11_500)
        ecran.capture("chrono-8-equipes-gagnant")
    }
}
