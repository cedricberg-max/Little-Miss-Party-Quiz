package com.littlemissparty.quiz.tv.habillage

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PortesMysteresTest {

    private fun eq(avant: Int, valeur: Int, porte: Int? = 0) = EquipePortes("E$avant", Color.Red, avant, scoreApresPorte(avant, valeur), porte)

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
    fun `le dernier choisit en premier`() {
        val e = listOf(eq(900, 0), eq(1200, 0), eq(500, 0))
        assertEquals(listOf(2, 0, 1), ordreChoix(e))
    }

    @Test
    fun `la porte du premier s'ouvre en dernier, les portes vides d'abord`() {
        // Le premier (1200) est derrière la porte 2, le deuxième derrière la porte 0, personne derrière la 1 et la 3.
        val e = listOf(eq(900, 0, 0), eq(1200, 0, 2), eq(500, 0, 0))
        assertEquals(listOf(1, 3, 0, 2), ordreOuverture(e, 4))
    }

    @Test
    fun `renversement - le deuxieme prend la tete, le premier prend la tuile`() {
        val e = listOf(eq(1250, PORTE_TUILE), eq(1180, PORTE_JACKPOT), eq(1120, PORTE_BONUS), eq(500, PORTE_PETIT_BONUS))
        val evo = evolutions(e)
        assertEquals(Recit.TUILE_DU_PREMIER, evo[0].recit)
        assertEquals(Recit.NOUVEAU_PREMIER, evo[1].recit)
        assertEquals(Recit.MONTE, evo[2].recit)
        assertEquals("+1 place !", texteRecit(evo[2]))
        assertEquals(Recit.TIENT, evo[3].recit)
        assertTrue(renversement(e))
    }

    @Test
    fun `toujours en tete, et une equipe qui recule de deux places`() {
        val e = listOf(eq(1250, PORTE_JACKPOT), eq(1180, PORTE_TUILE), eq(1100, PORTE_BONUS), eq(1050, PORTE_BONUS))
        val evo = evolutions(e)
        assertEquals("Toujours en tête !", texteRecit(evo[0]))
        assertEquals("−2 places", texteRecit(evo[1]))
        assertFalse(renversement(e))
    }

    @Test
    fun `a egalite apres les portes, l'ancien classement departage`() {
        // 1000 + 150 = 1150 et 1300 − 150 = 1150 : le premier d'avant garde la tête.
        val e = listOf(eq(1000, PORTE_BONUS), eq(1300, PORTE_TUILE))
        val evo = evolutions(e)
        assertEquals(0, evo[1].rangApres)
        assertFalse(renversement(e))
    }

    @Test
    fun `une seule equipe est toujours en tete`() {
        assertEquals(Recit.TOUJOURS_EN_TETE, evolutions(listOf(eq(400, PORTE_TUILE))).single().recit)
    }

    @Test
    fun `textes des portes`() {
        assertEquals("−150", texteValeur(-150))
        assertEquals("+300", texteValeur(300))
        assertEquals("1 250", espaceMilliers(1250))
        assertEquals("Jackpot", nomContenu(300))
        assertEquals("La tuile", nomContenu(-150))
        assertEquals("Petit bonus", nomContenu(50))
    }
}
