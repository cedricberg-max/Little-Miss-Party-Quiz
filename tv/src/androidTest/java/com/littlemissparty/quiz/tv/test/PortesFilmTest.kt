package com.littlemissparty.quiz.tv.test

import android.os.SystemClock
import android.util.Log
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
 * 🚪 Les portes entre deux jeux, filmées (cedric, 1/11 au soir : « texture métallique » à la réouverture, toujours là
 * sur 0.1.969). Quiz → Juste Chiffre → Mimes → Zoom mystère, chaque passage filmé en entier (« portes-film-… .mp4 »)
 * pour être regardé image par image ; l'heure de chaque nouveau jeu est notée dans le journal (« PORTES| »).
 */
@RunWith(AndroidJUnit4::class)
class PortesFilmTest : TestTv() {

    @Before
    fun motDePasse() = RegieSimulee.definirMotDePasse()

    private val regies = mutableListOf<RegieSimulee>()

    @After
    fun rangerRegies() = regies.forEach { it.close() }

    private fun programme(quiz: Map<String, Any?>) = listOf(
        quiz + mapOf("id" to "p-quiz", "round" to "Quiz"),
        mapOf("id" to "p-juste", "text" to "Combien d'os dans le corps humain ?", "kind" to "number", "correct" to 206, "duration" to 30, "double" to false, "round" to "Le Juste Chiffre"),
        mapOf(
            "id" to "p-mime", "text" to "Animaux", "kind" to "mime", "duration" to 60, "round" to "Les Mimes",
            "cards" to listOf(mapOf("word" to "Lion", "image" to "🦁"), mapOf("word" to "Chat", "image" to "🐱")),
        ),
        mapOf("id" to "p-vf", "text" to "Le Soleil est une étoile.", "choices" to listOf("Vrai", "Faux"), "correct" to 0, "duration" to 8, "kind" to "express", "double" to false, "round" to "Vrai ou Faux express"),
    )

    @Test
    fun portesEntreLesJeuxFilmees() {
        val code = lancerBoite()
        val equipes = listOf("Les Licornes", "Les Dragons", "Les Fusées", "Les Pandas").mapIndexed { i, nom ->
            pupitre("equipe$i").also { it.rejoindre(code, nom, TEAM_COLORS[i]) }
        }
        val regie = RegieSimulee().also { regies += it }
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        @Suppress("UNCHECKED_CAST")
        val demo = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val prog = programme(demo[0])
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, prog))
        assertEquals("applied", regie.commande(code, "next"))
        val lecteur = equipes[0]
        attendreQue("quiz ouvert", 60_000) { lecteur.etat(code).takeIf { it.child("qid").value == "p-quiz" && it.child("phase").value == "question" } }
        SystemClock.sleep(3_000)
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        for (suivant in listOf("p-juste", "p-mime", "p-vf")) {
            // Un film par passage : du bilan du jeu d'avant jusqu'à quelques secondes après la réouverture.
            val film = Thread {
                device.executeShellCommand(
                    "screenrecord --size 1280x720 --bit-rate 8000000 --time-limit 40 ${Ecran.DOSSIER_CAPTURES}/portes-film-$suivant.mp4",
                )
            }.apply { start() }
            val debut = SystemClock.uptimeMillis()
            var vu = false
            attendreQue("$suivant ouvert", 60_000) {
                val e = lecteur.etat(code)
                val la = e.child("qid").value == suivant
                if (la && !vu) {
                    vu = true
                    Log.i(TAG, "PORTES|$suivant|${e.child("phase").value}|${SystemClock.uptimeMillis() - debut} ms après le début du film")
                }
                // La présentation du jeu (« intro ») est passée comme Sarah le ferait, après 1,5 s.
                if (la && e.child("phase").value == "question") true
                else { regie.commande(code, "next"); Thread.sleep(1_500); null }
            }
            Log.i(TAG, "PORTES|$suivant|question|${SystemClock.uptimeMillis() - debut} ms après le début du film")
            SystemClock.sleep(6_000)
            device.executeShellCommand("pkill -INT screenrecord")
            film.join(10_000)
        }
    }
}
