package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Test

/** Annonce des points multipliés : le Vrai ou Faux express parle d'affirmations (cedric, 23/10), le quiz de questions. */
class MultiplicateurTest {

    @Test
    fun `le quiz annonce ses dernieres questions`() {
        assertEquals("DERNIÈRES QUESTIONS", titreDernieres(3))
        assertEquals("DERNIÈRE QUESTION", titreDernieres(1))
        assertEquals("Encore 3 questions pour tout changer !", encoreDernieres(3))
        assertEquals("Une dernière question pour tout changer !", encoreDernieres(1))
    }

    @Test
    fun `le vrai ou faux express annonce ses dernieres affirmations`() {
        assertEquals("DERNIÈRES AFFIRMATIONS", titreDernieres(3, affirmations = true))
        assertEquals("DERNIÈRE AFFIRMATION", titreDernieres(1, affirmations = true))
        assertEquals("Encore 2 affirmations pour tout changer !", encoreDernieres(2, affirmations = true))
        assertEquals("Une dernière affirmation pour tout changer !", encoreDernieres(1, affirmations = true))
    }

    @Test
    fun `les multiplicateurs ont leur nom`() {
        assertEquals("POINTS DOUBLÉS !", pointsMultiplies(2))
        assertEquals("POINTS TRIPLÉS !", pointsMultiplies(3))
        assertEquals("POINTS × 5 !", pointsMultiplies(5))
    }
}
