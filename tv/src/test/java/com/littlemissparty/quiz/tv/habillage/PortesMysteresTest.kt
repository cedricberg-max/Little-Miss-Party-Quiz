package com.littlemissparty.quiz.tv.habillage

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PortesMysteresTest {

    /** Lignes du classement calculées comme le fait la partie : rangs avant, puis après départagés par l'ancien rang. */
    private fun lignes(vararg e: Pair<Int, Int>): List<LignePortes> {
        val avant = e.map { it.first }
        val apres = e.map { scoreApresPorte(it.first, it.second) }
        val ra = rangs(avant)
        val rp = rangs(apres, ra)
        return e.indices.map { LignePortes("E$it", Color.Red, avant[it], apres[it], ra[it] + 1, rp[it] + 1) }
    }

    @Test
    fun `3 portes jusqu'a 3 equipes, 4 au-dela`() {
        assertEquals(listOf(300, 150, -150), valeursPortes(1))
        assertEquals(listOf(300, 150, -150), valeursPortes(3))
        assertEquals(listOf(300, 150, 50, -150), valeursPortes(4))
        assertEquals(listOf(300, 150, 50, -150), valeursPortes(8))
    }

    @Test
    fun `un score ne descend jamais sous 0`() {
        assertEquals(0, scoreApresPorte(100, PORTE_TUILE))
        assertEquals(850, scoreApresPorte(1000, PORTE_TUILE))
        assertEquals(1300, scoreApresPorte(1000, PORTE_JACKPOT))
    }

    @Test
    fun `renversement - le deuxieme prend la tete, le premier prend la tuile`() {
        val l = lignes(1250 to PORTE_TUILE, 1180 to PORTE_JACKPOT, 1120 to PORTE_BONUS, 500 to PORTE_PETIT_BONUS)
        val evo = evolutions(l)
        assertEquals(Recit.TUILE_DU_PREMIER, evo[0].recit)
        assertEquals("Aïe, la tuile !", texteRecit(evo[0]))
        assertEquals(Recit.NOUVEAU_PREMIER, evo[1].recit)
        assertEquals("+1 place !", texteRecit(evo[2]))
        assertEquals(Recit.TIENT, evo[3].recit)
        // « Ça tient ! » n'était pas clair pour cedric : l'équipe a marqué mais reste à sa place.
        assertEquals("Garde sa place !", texteRecit(evo[3]))
        assertTrue(renversement(l))
    }

    @Test
    fun `toujours en tete, et une equipe qui recule de deux places`() {
        val l = lignes(1250 to PORTE_JACKPOT, 1180 to PORTE_TUILE, 1100 to PORTE_BONUS, 1050 to PORTE_BONUS)
        val evo = evolutions(l)
        assertEquals("Toujours en tête !", texteRecit(evo[0]))
        assertEquals("−2 places", texteRecit(evo[1]))
        assertEquals("+1 place !", texteRecit(evo[2]))
        assertFalse(renversement(l))
    }

    @Test
    fun `a egalite apres les portes, l'ancien classement departage`() {
        // 1000 + 150 = 1150 et 1300 − 150 = 1150 : le premier d'avant garde la tête.
        val l = lignes(1000 to PORTE_BONUS, 1300 to PORTE_TUILE)
        assertEquals(1, l[1].rangApres)
        assertFalse(renversement(l))
    }

    @Test
    fun `une seule equipe est toujours en tete`() {
        assertEquals(Recit.TOUJOURS_EN_TETE, evolutions(lignes(400 to PORTE_TUILE)).single().recit)
    }

    @Test
    fun `textes des portes`() {
        assertEquals("−150", texteValeur(-150))
        assertEquals("+300", texteValeur(300))
        assertEquals("−150 POINTS", texteDelta(PORTE_TUILE))
        assertEquals("+50 POINTS", texteDelta(PORTE_PETIT_BONUS))
        assertEquals("1 250", espaceMilliers(1250))
        assertEquals("Jackpot", nomContenu(300))
        assertEquals("La tuile", nomContenu(-150))
        assertEquals("Petit bonus", nomContenu(50))
    }
}
