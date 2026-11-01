package com.littlemissparty.quiz.tv

import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.engine.QuestionKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Image floue : la photo nette n'est jamais dessinée avant la révélation (test du 27/10 au soir). */
class ImageFloueTest {

    @Test
    fun `avant la révélation, jamais la photo nette, même si le niveau déborde`() {
        for (niveau in listOf(0f, 3.5f, NIVEAUX_FLOUS - 1f, NIVEAUX_FLOUS - 0.5f, NIVEAUX_FLOUS.toFloat(), NIVEAUX_FLOUS + 3f)) {
            val (bas, haut) = niveauxAffiches(niveau, revealed = false)
            assertTrue("niveau $niveau : $bas", bas < NIVEAUX_FLOUS)
            assertTrue("niveau $niveau : $haut", haut < NIVEAUX_FLOUS)
        }
    }

    @Test
    fun `à la révélation, la photo nette arrive`() {
        assertEquals(NIVEAUX_FLOUS to NIVEAUX_FLOUS, niveauxAffiches(NIVEAUX_FLOUS.toFloat(), revealed = true))
        assertEquals(NIVEAUX_FLOUS - 1 to NIVEAUX_FLOUS, niveauxAffiches(NIVEAUX_FLOUS - 0.5f, revealed = true))
    }

    @Test
    fun `début de question, le niveau le plus flou`() {
        assertEquals(0 to 1, niveauxAffiches(0f, revealed = false))
    }

    private fun flou(depart: Int?) = Question(
        "f", "Qui est-ce ?", listOf("A", "B"), 0, durationSec = 20, kind = QuestionKind.FLOU,
        imageId = "0123456789abcdef", flouDepart = depart,
    )

    @Test
    fun `depart regle plus flou dans la Regie PC, des niveaux en plus avant ceux d'aujourd'hui`() {
        val aujourdhui = niveauxDe(flou(null))
        assertEquals(NIVEAUX_FLOUS, aujourdhui.size)
        assertEquals(5, aujourdhui.first())
        assertEquals(listOf(2, 3, 4) + aujourdhui, niveauxDe(flou(2)))
        assertEquals(listOf(3, 4) + aujourdhui, niveauxDe(flou(3)))
        assertEquals(listOf(4) + aujourdhui, niveauxDe(flou(4)))
    }

    @Test
    fun `avec un depart plus flou, toujours jamais la photo nette avant la revelation`() {
        val flous = niveauxDe(flou(2)).size
        for (niveau in listOf(0f, flous - 1f, flous - 0.5f, flous.toFloat(), flous + 2f)) {
            val (bas, haut) = niveauxAffiches(niveau, revealed = false, flous = flous)
            assertTrue("niveau $niveau : $bas", bas < flous)
            assertTrue("niveau $niveau : $haut", haut < flous)
        }
        assertEquals(flous to flous, niveauxAffiches(flous.toFloat(), revealed = true, flous = flous))
    }
    /** Cedric, 1/11 au soir : l'image doit être floue dès la première image, jamais nette une ou deux images. */
    @Test
    fun `floue des la premiere image, jamais nette au debut du chrono`() {
        // Le moteur dit 0 ms restantes tant que le chrono tourne : on lit l'échéance.
        org.junit.Assert.assertEquals(20_000L, restantInitial(deadline = 120_000L, maintenant = 100_000L, resumeAt = null, remainingMs = 0L))
        // Décompte de reprise : le chrono ne repart qu'à resumeAt.
        org.junit.Assert.assertEquals(15_000L, restantInitial(deadline = 120_000L, maintenant = 100_000L, resumeAt = 105_000L, remainingMs = 0L))
        // Chrono figé (buzz, pause) : le temps gardé par le moteur.
        org.junit.Assert.assertEquals(7_000L, restantInitial(deadline = null, maintenant = 100_000L, resumeAt = null, remainingMs = 7_000L))
        org.junit.Assert.assertEquals(0f, departFlou(revealed = false, flous = 10), 0f)
        org.junit.Assert.assertEquals(10f, departFlou(revealed = true, flous = 10), 0f)
        val code = java.io.File("src/main/java/com/littlemissparty/quiz/tv/ImageFloue.kt").readText()
        org.junit.Assert.assertTrue(code.contains("Animatable(departFlou(revealed, flous))"))
        org.junit.Assert.assertFalse(code.contains("remember(q.id) { Animatable(cible) }"))
    }
}
