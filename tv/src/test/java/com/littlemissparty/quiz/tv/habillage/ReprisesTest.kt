package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Test du 24 octobre : « lmp_bed_full » en erreur 19 fois en 2 s, refait aussitôt à chaque fois ; les 20 rapports du
 * lancement pris par cette seule avalanche, rien sur le reste de la soirée.
 */
class ReprisesTest {

    @Test
    fun `un lecteur en erreur est refait de plus en plus tard, trois fois par minute au plus`() {
        val r = Reprises()
        assertEquals(500L, r.delai("lmp_bed_full", 0))
        assertEquals(2_000L, r.delai("lmp_bed_full", 600))
        assertEquals(5_000L, r.delai("lmp_bed_full", 2_700))
        // Quatrième erreur dans la minute : on attend que la première tentative (prévue à 500 ms) sorte de la fenêtre.
        assertEquals(60_500L - 7_800, r.delai("lmp_bed_full", 7_800))
    }

    @Test
    fun `chaque fichier a ses propres tentatives`() {
        val r = Reprises()
        r.delai("lmp_bed_full", 0)
        r.delai("lmp_bed_full", 600)
        assertEquals(500L, r.delai("gs_scores", 700))
    }

    @Test
    fun `une minute calme et le son repart au premier delai`() {
        val r = Reprises()
        r.delai("lmp_bed_full", 0)
        r.delai("lmp_bed_full", 600)
        r.delai("lmp_bed_full", 2_700)
        assertEquals(500L, r.delai("lmp_bed_full", 2_700 + 5_000 + 60_000))
    }

    @Test
    fun `jamais deux tentatives sur le meme instant, meme en pleine avalanche`() {
        val r = Reprises()
        val prevues = (0 until 20).map { i -> val t = i * 100L; t + r.delai("lmp_bed_full", t) }
        // Sur n'importe quelle minute, trois tentatives au plus.
        for (debut in prevues) assertTrue(prevues.count { it >= debut && it < debut + 60_000 } <= 3)
    }

    @Test
    fun `une erreur repetee part une fois, puis ses repetitions en une seule ligne`() {
        val envoyes = mutableListOf<String>()
        val inc = Incidents { envoyes += it }
        val texte = "Lecteur « lmp_bed_full » en erreur (1, -19)"
        assertTrue(inc.noter(texte, 0))
        for (t in 100L..1_900L step 100) assertFalse(inc.noter(texte, t))
        assertEquals(listOf(texte), envoyes)
        inc.fermer(texte)
        assertEquals(listOf(texte, "$texte : encore ×19 en 2 s"), envoyes)
        // La rafale fermée, la même erreur repart comme une nouvelle.
        assertTrue(inc.noter(texte, 20_000))
        inc.fermer(texte)
        assertEquals(3, envoyes.size)
    }

    @Test
    fun `des erreurs differentes partent chacune, et une avalanche ne bloque plus la suite de la soiree`() {
        val envoyes = mutableListOf<String>()
        val inc = Incidents(max = 10) { envoyes += it }
        val avalanche = "Lecteur « lmp_bed_full » en erreur (1, -19)"
        inc.noter(avalanche, 0)
        repeat(200) { inc.noter(avalanche, 10L * it) }
        inc.noter("Lecteur « lmp_bed_full » en erreur (1, -1010)", 50)
        inc.fermer(avalanche)
        inc.noter("Boucle « gs_bed_questions » arrêtée toute seule", 3_600_000)
        assertEquals(4, envoyes.size)
        assertEquals("Boucle « gs_bed_questions » arrêtée toute seule", envoyes.last())
    }

    @Test
    fun `au plus max envois par lancement, le dernier le dit`() {
        val envoyes = mutableListOf<String>()
        val inc = Incidents(max = 3) { envoyes += it }
        for (i in 1..5) inc.noter("incident $i", i * 1_000L)
        assertEquals(listOf("incident 1", "incident 2", "incident 3 (dernier rapport du son pour ce lancement)"), envoyes)
    }
}
