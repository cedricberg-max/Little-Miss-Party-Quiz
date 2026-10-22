package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertTrue
import org.junit.Test

class RobotGameShowTest {

    /** Demi-largeur du robot en fraction de la largeur d'un écran 16:9 (90 % de la hauteur, format 4:5). */
    private fun demiLargeur(echelle: Float) = 0.9f * 0.8f * echelle * 9f / 16f / 2f

    @Test
    fun `le robot arrive et repart hors de l'ecran`() {
        for (m in MomentRobot.values()) {
            val t = trajet(m)
            for (ms in listOf(0f, t.totalMs.toFloat())) {
                val (x, _, e) = t.a(ms)
                val hors = x + demiLargeur(e) <= 0f || x - demiLargeur(e) >= 1f
                assertTrue("$m à $ms ms : x = $x", hors)
            }
        }
    }

    @Test
    fun `pendant la question il reste au bord droit pour ne pas cacher les reponses`() {
        val t = trajet(MomentRobot.SUSPENSE)
        var ms = 0f
        while (ms <= t.totalMs) {
            val (x, _, e) = t.a(ms)
            assertTrue("à $ms ms : bord gauche ${x - demiLargeur(e)}", x - demiLargeur(e) >= 0.75f)
            ms += 50f
        }
    }

    @Test
    fun `le socle ne monte jamais au-dessus du milieu de l'ecran`() {
        for (m in MomentRobot.values()) {
            val t = trajet(m)
            var ms = 0f
            while (ms <= t.totalMs) {
                val (_, bas, _) = t.a(ms)
                assertTrue("$m à $ms ms : bas = $bas", bas in 0.85f..1.2f)
                ms += 25f
            }
        }
    }

    @Test
    fun `le trajet avance dans le temps`() {
        for (m in MomentRobot.values()) {
            val ms = trajet(m).etapes.map { it.ms }
            assertTrue("$m : $ms", ms.zipWithNext().all { (a, b) -> b > a })
        }
    }
}
