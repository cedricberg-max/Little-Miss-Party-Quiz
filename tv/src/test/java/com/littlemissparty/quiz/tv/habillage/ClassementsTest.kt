package com.littlemissparty.quiz.tv.habillage

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Test

/** Classements qui bougent (Coffres mystères) : rangs, récits et petits textes, de 1 à 8 équipes. */
class ClassementsTest {
    /** Lignes calculées comme le fait la partie : rangs avant, puis après départagés par l'ancien rang (jamais sous 0). */
    private fun lignes(vararg e: Pair<Int, Int>): List<LigneClassement> {
        val avant = e.map { it.first }
        val apres = e.map { maxOf(0, it.first + it.second) }
        val ra = rangs(avant)
        val rp = rangs(apres, ra)
        return e.indices.map { LigneClassement("E$it", Color.Red, avant[it], apres[it], ra[it] + 1, rp[it] + 1) }
    }

    @Test
    fun `le deuxieme prend la tete, le premier prend la tuile`() {
        val evo = evolutions(lignes(1250 to -150, 1180 to 300, 1120 to 150, 500 to 50))
        assertEquals(Recit.TUILE_DU_PREMIER, evo[0].recit)
        assertEquals("Aïe, la tuile !", texteRecit(evo[0]))
        assertEquals(Recit.NOUVEAU_PREMIER, evo[1].recit)
        assertEquals("+1 place !", texteRecit(evo[2]))
        assertEquals("Garde sa place !", texteRecit(evo[3]))
    }

    @Test
    fun `toujours en tete, une equipe recule de deux places, egalite departagee par l'ancien rang`() {
        val evo = evolutions(lignes(1250 to 300, 1180 to -150, 1100 to 150, 1050 to 150))
        assertEquals("Toujours en tête !", texteRecit(evo[0]))
        assertEquals("−2 places", texteRecit(evo[1]))
        assertEquals(1, lignes(1000 to 150, 1300 to -150)[1].rangApres)
        assertEquals(Recit.TOUJOURS_EN_TETE, evolutions(lignes(400 to -150)).single().recit)
    }

    @Test
    fun `petits textes de points`() {
        assertEquals("−150", texteValeur(-150))
        assertEquals("+300", texteValeur(300))
        assertEquals("1 250", espaceMilliers(1250))
        assertEquals(300, GROS_GAIN)
    }
}
