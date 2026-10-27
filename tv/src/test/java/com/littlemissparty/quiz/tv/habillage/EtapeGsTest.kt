package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Test

/** L'étape du jeu en haut à gauche : sur deux lignes, jamais « 12 » seul sous le « 9 » (test du 27/10 au soir). */
class EtapeGsTest {

    @Test
    fun `coupée après le nom du jeu, le compte reste entier`() {
        assertEquals("Vrai ou Faux express ·\n11 / 12", etapeSurDeuxLignes("Vrai ou Faux express · 11 / 12"))
        assertEquals("Quiz musical ·\nComptines · question 1 / 10", etapeSurDeuxLignes("Quiz musical · Comptines · question 1 / 10"))
        assertEquals("Mimes", etapeSurDeuxLignes("Mimes"))
    }
}
