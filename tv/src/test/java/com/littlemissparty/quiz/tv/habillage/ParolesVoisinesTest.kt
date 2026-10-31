package com.littlemissparty.quiz.tv.habillage

import com.littlemissparty.quiz.engine.LigneParole
import com.littlemissparty.quiz.engine.MotParole
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Paroles « en double » du Quiz musical (cedric, 30/10) : un refrain qui répète sa ligne ne l'affiche qu'une fois. */
class ParolesVoisinesTest {
    private fun ligne(debut: Long, texte: String) =
        LigneParole(debut, debut + 2_000, texte.split(" ").filter { it.isNotBlank() }.mapIndexed { i, m -> MotParole(m, debut + i * 200L) })

    @Test
    fun `la meme ligne au-dessus ou en dessous n'est pas repetee en pale`() {
        val chantee = ligne(0, "Allô? Allô? Allô? j'deviens paro, paro")
        assertFalse(voisineAffichee(ligne(2_000, "Allô? Allô? Allô? j'deviens paro, paro"), chantee))
        assertFalse("ni pour une majuscule ou un espace", voisineAffichee(ligne(2_000, " allô? Allô? Allô? j'deviens paro, paro "), chantee))
    }

    @Test
    fun `une autre ligne reste visible, comme avant`() {
        val chantee = ligne(0, "Allô? Allô? Allô? j'deviens paro, paro")
        assertTrue(voisineAffichee(ligne(2_000, "Tu m'as rendue folle"), chantee))
        assertTrue("pause instrumentale : la suivante s'annonce", voisineAffichee(ligne(2_000, "Allô?"), LigneParole(0, 2_000, emptyList())))
        assertTrue("avant la première ligne", voisineAffichee(ligne(2_000, "Allô?"), null))
    }
}
