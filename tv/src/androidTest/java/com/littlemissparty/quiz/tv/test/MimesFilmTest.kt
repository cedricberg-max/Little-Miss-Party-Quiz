package com.littlemissparty.quiz.tv.test

import android.os.SystemClock
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
 * 🎭 Un tour de Mimes filmé (cedric, 1/11 au soir) : le bandeau « À vous de mimer ! » seul, puis « TOP DÉPART ! » seul,
 * puis la carte ; à la fin, « TEMPS ÉCOULÉ ! » dans la couleur de l'équipe, puis le bravo et « Prochaine équipe… »,
 * jamais l'un sur l'autre. Film « mimes-film-tour.mp4 », pour être regardé image par image.
 */
@RunWith(AndroidJUnit4::class)
class MimesFilmTest : TestTv() {

    @Before
    fun motDePasse() = RegieSimulee.definirMotDePasse()

    private val regies = mutableListOf<RegieSimulee>()

    @After
    fun rangerRegies() = regies.forEach { it.close() }

    @Test
    fun unTourDeMimesFilme() {
        val code = lancerBoite()
        val equipes = listOf("Les Licornes", "Les Dragons", "Les Fusées").mapIndexed { i, nom ->
            pupitre("equipe$i").also { it.rejoindre(code, nom, TEAM_COLORS[i]) }
        }
        val regie = RegieSimulee().also { regies += it }
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        @Suppress("UNCHECKED_CAST")
        val demo = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val mime = mapOf(
            "id" to "p-mime", "text" to "Animaux", "kind" to "mime", "duration" to 60, "round" to "Les Mimes",
            "cards" to listOf(mapOf("word" to "Lion", "image" to "🦁"), mapOf("word" to "Chat", "image" to "🐱"), mapOf("word" to "Hippopotame", "image" to "🦛")),
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(demo[0] + ("round" to "Quiz"), mime)))
        assertEquals("applied", regie.commande(code, "next"))
        val lecteur = equipes[0]
        attendreQue("mimes ouverts", 60_000) {
            val e = lecteur.etat(code)
            if (e.child("qid").value == "p-mime" && e.child("phase").value == "question") true
            else { regie.commande(code, "next"); Thread.sleep(1_500); null }
        }
        SystemClock.sleep(4_000)
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val film = Thread {
            device.executeShellCommand("screenrecord --size 1280x720 --bit-rate 8000000 --time-limit 30 ${Ecran.DOSSIER_CAPTURES}/mimes-film-tour.mp4")
        }.apply { start() }
        SystemClock.sleep(1_000)
        assertEquals("applied", regie.commande(code, "mime_start", mapOf("team" to equipes[1].uid)))
        SystemClock.sleep(7_000)
        assertEquals("applied", regie.commande(code, "mime_found"))
        SystemClock.sleep(2_500)
        assertEquals("applied", regie.commande(code, "mime_stop"))
        SystemClock.sleep(7_000)
        ecran.capture("mimes-film-fin")
        device.executeShellCommand("pkill -INT screenrecord")
        film.join(10_000)
    }
}
