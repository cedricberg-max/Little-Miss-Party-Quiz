package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Podium du Game Show : les jauges ménagent le suspense et finissent exactement sur les vrais scores. */
class PodiumGameShowTest {

    private val scores = listOf(900, 640, 640, 120)

    @Test
    fun `les jauges finissent exactement sur les scores, le meilleur en haut juste avant le solo`() {
        val fin = Tempo.PODIUM_REVELATION.toFloat() - 100f
        assertTrue(JAUGES_FIN < Tempo.PODIUM_REVELATION)
        scores.forEach { assertEquals(it / 900f, niveauJauge(fin, it, scores), 1e-4f) }
        // Rien ne monte avant le début, rien ne dépasse jamais son score.
        assertEquals(0f, niveauJauge(JAUGES_DEBUT, 900, scores), 0f)
        for (ms in 0..16_000 step 250) scores.forEach { assertTrue(niveauJauge(ms.toFloat(), it, scores) <= it / 900f + 1e-6f) }
    }

    @Test
    fun `le gagnant reste cache jusqu'aux dernieres secondes`() {
        // Avant que le deuxième score soit atteint, les deux meilleures jauges sont à la même hauteur.
        for (ms in 0 until JAUGES_DEUXIEME.toInt() step 250) assertEquals(niveauJauge(ms.toFloat(), 640, scores), niveauJauge(ms.toFloat(), 900, scores), 1e-4f)
        // La moins bonne équipe s'arrête la première, puis les suivantes ; le meilleur score grimpe jusqu'au bout.
        val p = scores.map { it / 900f }
        assertTrue(instantArret(p[3], scores) < instantArret(p[1], scores))
        assertTrue(instantArret(p[1], scores) <= JAUGES_DEUXIEME + 1f)
        assertEquals(Float.MAX_VALUE, instantArret(1f, scores), 0f)
        // La hauteur commune ne redescend jamais.
        var avant = 0f
        for (ms in 0..16_000 step 50) hauteurJauges(ms.toFloat(), scores).also { assertTrue(it >= avant - 1e-6f); avant = it }
    }

    @Test
    fun `egalite en tete, personne n'a marque, une seule equipe`() {
        val egalite = listOf(500, 500, 200)
        assertEquals(1f, niveauJauge(15_000f, 500, egalite), 1e-4f)
        assertEquals(niveauJauge(14_000f, 500, egalite), niveauJauge(14_000f, 500, egalite.reversed()), 1e-4f)
        assertEquals(0f, niveauJauge(15_000f, 0, listOf(0, 0)), 0f)
        assertEquals(1f, niveauJauge(15_000f, 300, listOf(300)), 1e-4f)
        // Score négatif (malus) : jauge vide, jamais en dessous.
        assertEquals(0f, niveauJauge(15_000f, -100, listOf(300, -100)), 0f)
    }

    @Test
    fun `les clips du robot du podium et de l'ecran de fin sont dans l'appli`() {
        for (f in listOf(ROBOT_FETE, ROBOT_AU_REVOIR)) assertTrue("$f manquant", File("src/main/res/raw/$f.mp4").isFile)
    }
}
