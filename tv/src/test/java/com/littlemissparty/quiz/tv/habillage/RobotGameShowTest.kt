package com.littlemissparty.quiz.tv.habillage

import com.littlemissparty.quiz.engine.Award
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.engine.QuestionKind
import com.littlemissparty.quiz.tv.Team
import com.littlemissparty.quiz.tv.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.random.Random

class RobotGameShowTest {

    /** Demi-largeur du robot en fraction de la largeur d'un écran 16:9 (90 % de la hauteur, format 4:5). */
    private fun demiLargeur(echelle: Float) = 0.9f * 0.8f * echelle * 9f / 16f / 2f

    /** Les clips où il vole (réacteurs) ou pend du haut de l'écran : eux seuls quittent le sol. */
    private val volants = setOf("gs_robot_descente", "gs_robot_energie", "gs_robot_dort", "gs_robot_envers", "gs_robot_vole", "gs_robot_pique", "gs_robot_fusee")

    @Test
    fun `le robot arrive et repart hors de l'ecran`() {
        for (c in CATALOGUE) {
            val t = c.trajet
            for (ms in listOf(0f, t.totalMs.toFloat())) {
                val (x, bas, e) = t.a(ms)
                val hors = x + demiLargeur(e) <= 0f || x - demiLargeur(e) >= 1f || bas <= 0f || bas - 0.9f * e >= 1f
                assertTrue("$c à $ms ms : x = $x, bas = $bas", hors)
            }
        }
    }

    @Test
    fun `pendant la question il reste au bord droit pour ne pas cacher les reponses`() {
        for (c in CATALOGUE.filter { it.moment == MomentRobot.SUSPENSE }) {
            var ms = 0f
            while (ms <= c.trajet.totalMs) {
                val (x, _, e) = c.trajet.a(ms)
                assertTrue("$c à $ms ms : bord gauche ${x - demiLargeur(e)}", x - demiLargeur(e) >= 0.75f)
                ms += 50f
            }
        }
    }

    @Test
    fun `avant la revelation, jamais un robot triste qui ferait croire a une mauvaise reponse`() {
        // cedric, 23/10 : il avait bien répondu, et pendant les dernières secondes le robot semblait pleurer.
        val tristes = setOf("gs_robot_pleure", "gs_robot_rate", "gs_robot_oups", "gs_robot_inquiet", "gs_robot_cache")
        val avant = setOf(MomentRobot.MANCHE, MomentRobot.SUSPENSE, MomentRobot.SUPER_FINALE)
        for (c in CATALOGUE.filter { it.moment in avant }) assertTrue("$c", c.fichier !in tristes)
        assertTrue(CATALOGUE.any { it.moment == MomentRobot.SUSPENSE })
    }

    @Test
    fun `bonus, malus et coffres, jamais au centre pour laisser voir la carte et le coffre`() {
        for (c in CATALOGUE.filter { it.moment in setOf(MomentRobot.BONUS, MomentRobot.MALUS, MomentRobot.BOMBE) }) {
            var ms = 0f
            while (ms <= c.trajet.totalMs) {
                val (x, _, e) = c.trajet.a(ms)
                val gauche = x - demiLargeur(e)
                val droite = x + demiLargeur(e)
                assertTrue("$c à $ms ms : de $gauche à $droite", droite <= 0.35f || gauche >= 0.65f)
                ms += 50f
            }
        }
    }

    @Test
    fun `seuls les clips qui volent quittent le sol`() {
        for (c in CATALOGUE.filter { it.fichier !in volants }) {
            var ms = 0f
            while (ms <= c.trajet.totalMs) {
                val (_, bas, _) = c.trajet.a(ms)
                assertTrue("$c à $ms ms : bas = $bas", bas >= 0.85f)
                ms += 25f
            }
        }
    }

    @Test
    fun `en vol il traverse sans s'arreter, et il ne reste jamais coince hors de l'ecran`() {
        for (c in CATALOGUE.filter { it.fichier == "gs_robot_vole" }) {
            val xs = (0..c.trajet.totalMs step 100).map { c.trajet.a(it.toFloat()).first }
            val pas = xs.zipWithNext { a, b -> b - a }
            assertTrue("$c : $pas", pas.all { it > 0.01f } || pas.all { it < -0.01f })
        }
        for (c in CATALOGUE) {
            val visible = (0..c.trajet.totalMs step 50).count { ms ->
                val (x, bas, e) = c.trajet.a(ms.toFloat())
                x + demiLargeur(e) > 0f && x - demiLargeur(e) < 1f && bas > 0.1f && bas - 0.9f * e < 0.9f
            }
            assertTrue("$c visible seulement ${visible * 50} ms", visible * 50 >= 2_000)
        }
    }

    @Test
    fun `pendant la pause, les numeros se suivent sans jamais repeter le dernier`() {
        val tirage = TirageRobot(Random(3))
        val n = CATALOGUE.count { it.moment == MomentRobot.PAUSE }
        assertTrue("seulement $n numéros de pause", n >= 10)
        val suite = List(5 * n) { tirage.suivant(MomentRobot.PAUSE)!! }
        assertTrue(suite.zipWithNext().none { (a, b) -> a == b })
    }

    /** Les clips où il est déçu, boude ou a peur. */
    private val negatifs = setOf(
        "gs_robot_rate", "gs_robot_oups", "gs_robot_pleure", "gs_robot_cache", "gs_robot_inquiet", "gs_robot_boude",
        "gs_robot_facepalm", "gs_robot_courtcircuit", "gs_robot_degonfle", "gs_robot_peur",
    )

    @Test
    fun `il ne fait la tete que dans les moments negatifs, et jamais dans les moments negatifs il ne se rejouit`() {
        // cedric, 23 octobre : deux familles bien séparées. Personne n'a trouvé, malus et bombe = déçu ou apeuré ;
        // partout ailleurs (lancement, suspense, bonnes réponses, scores, podium, pause) = joyeux.
        val momentsNegatifs = setOf(MomentRobot.RATE, MomentRobot.MALUS, MomentRobot.BOMBE)
        for (c in CATALOGUE) {
            assertEquals("$c au moment ${c.moment}", c.moment in momentsNegatifs, c.fichier in negatifs)
        }
    }

    @Test
    fun `le trajet avance dans le temps`() {
        for (c in CATALOGUE) {
            val ms = c.trajet.etapes.map { it.ms }
            assertTrue("$c : $ms", ms.zipWithNext().all { (a, b) -> b > a })
        }
    }

    @Test
    fun `chaque clip du catalogue est dans l'appli et chaque moment a ses clips`() {
        for (c in CATALOGUE) assertTrue("$c manquant", File("src/main/res/raw/${c.fichier}.mp4").isFile)
        assertEquals(CATALOGUE.size, CATALOGUE.map { it.fichier to it.moment }.toSet().size)
        for (m in MomentRobot.values()) assertTrue("$m sans clip", CATALOGUE.any { it.moment == m })
        val varies = MomentRobot.values().toList() - MomentRobot.TETE - MomentRobot.SUPER_FINALE
        for (m in varies) {
            assertTrue("$m : une seule animation", CATALOGUE.count { it.moment == m } >= 2)
        }
    }

    @Test
    fun `jamais deux fois de suite le meme clip, et tous passent avant qu'un revienne`() {
        repeat(20) { graine ->
            val tirage = TirageRobot(Random(graine))
            for (m in MomentRobot.values()) {
                val n = CATALOGUE.count { it.moment == m }
                val suite = List(10 * n) { tirage.suivant(m)!! }
                if (n > 1) assertTrue("$m : $suite", suite.zipWithNext().none { (a, b) -> a == b })
                suite.chunked(n).forEach { tour -> assertEquals("$m : $tour", n, tour.toSet().size) }
            }
        }
    }

    @Test
    fun `l'equipe en tete, seule et avec des points`() {
        assertEquals("b", meneur(mapOf("a" to 100, "b" to 300, "c" to 200)))
        assertNull(meneur(mapOf("a" to 300, "b" to 300)))
        assertNull(meneur(mapOf("a" to 0, "b" to 0)))
        assertNull(meneur(emptyMap()))
    }

    private val equipes = listOf("e0", "e1", "e2").map { Team(it, it, "#fff", 0L) }
    private val q = Question("q1", "Combien ?", listOf("1", "2", "3", "4"), 0)
    private fun partie(phase: Phase, bloc: UiState.Playing.() -> UiState.Playing = { this }) =
        UiState.Playing(code = "ABCD", joinUrl = "", teams = equipes, phase = phase, question = q, index = 3).bloc()

    @Test
    fun `chaque situation a son moment`() {
        // Présentation d'un jeu sans intro vidéo (Juste Chiffre) : le robot annonce la manche.
        assertEquals(MomentRobot.MANCHE, momentRobot(partie(Phase.QUESTION) { copy(intro = true, question = q.copy(kind = QuestionKind.NUMBER, choices = emptyList(), correct = 42)) }, 0, null)?.first)
        assertEquals(MomentRobot.SUPER_FINALE, momentRobot(partie(Phase.QUESTION) { copy(factor = 3, introUntil = 1L) }, 0, null)?.first)
        val tous = equipes.associate { it.uid to Award(0, true, 100, 0) }
        assertEquals(MomentRobot.TOUS, momentRobot(partie(Phase.REVEAL) { copy(awards = tous) }, 0, null)?.first)
        val aucun = equipes.associate { it.uid to Award(1, false, 0, 0) }
        assertEquals(MomentRobot.RATE, momentRobot(partie(Phase.REVEAL) { copy(awards = aucun) }, 0, null)?.first)
        // Une équipe sur trois a trouvé : pas de robot.
        assertNull(momentRobot(partie(Phase.REVEAL) { copy(awards = aucun + ("e0" to Award(0, true, 100, 0))) }, 0, null))
        assertEquals(MomentRobot.PODIUM, momentRobot(partie(Phase.ENDED), 0, null)?.first)
        assertNull(momentRobot(partie(Phase.REVEAL) { copy(awards = tous, paused = true) }, 0, null))
    }

    @Test
    fun `pas de second robot sur l'intro video d'un jeu`() {
        // Le robot joue déjà au jeu dans la vidéo de présentation.
        assertNull(momentRobot(partie(Phase.QUESTION) { copy(intro = true) }, 0, null))
    }

    @Test
    fun `pas de robot inquiet quand toutes les equipes ont deja repondu`() {
        assertEquals(MomentRobot.SUSPENSE, momentRobot(partie(Phase.QUESTION) { copy(answered = setOf("e0", "e1")) }, 4, null)?.first)
        assertNull(momentRobot(partie(Phase.QUESTION) { copy(answered = setOf("e0", "e1", "e2")) }, 4, null))
    }

    @Test
    fun `une equipe qui passe en tete est fetee au classement`() {
        val scores = partie(Phase.SCORES) { copy(scores = mapOf("e0" to 200, "e1" to 300)) }
        assertEquals(MomentRobot.TETE, momentRobot(scores, 0, "e0")?.first)
        assertEquals(MomentRobot.SCORES, momentRobot(scores, 0, "e1")?.first)
        assertEquals(MomentRobot.SCORES, momentRobot(scores, 0, null)?.first)
        // Égalité en tête : pas de nouveau meneur.
        assertEquals(MomentRobot.SCORES, momentRobot(partie(Phase.SCORES) { copy(scores = mapOf("e0" to 300, "e1" to 300)) }, 0, "e0")?.first)
    }

    @Test
    fun `le suspense vient a chaque question, dans les cinq dernieres secondes`() {
        for (i in 0 until 10) assertEquals(MomentRobot.SUSPENSE, momentRobot(partie(Phase.QUESTION) { copy(index = i) }, 4, null)?.first)
        assertNull(momentRobot(partie(Phase.QUESTION), 8, null))
        assertNull(momentRobot(partie(Phase.QUESTION), 0, null))
    }
}
