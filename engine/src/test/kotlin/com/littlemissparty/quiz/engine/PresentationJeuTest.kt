package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Écran de présentation de chaque jeu : le nom du jeu, puis l'animatrice lance la première question. */
class PresentationJeuTest {

    private val t0 = 1_000_000L

    private fun prestation(intros: Boolean = true) = QuizJson.parse(
        """{"id":"p","intros":$intros,"questions":[
          {"id":"q1","text":"Capitale ?","choices":["Paris","Rome"],"correct":0,"duration":20,"round":"Quiz"},
          {"id":"q2","text":"Couleur ?","choices":["Bleu","Vert"],"correct":0,"duration":20,"round":"Quiz"},
          {"id":"v1","text":"Le ciel est vert","choices":["Vrai","Faux"],"correct":1,"duration":10,"kind":"true_false","round":"Vrai ou Faux"}]}""",
    )

    @Test
    fun `le programme d'une prestation demande les présentations, un quiz sans le réglage s'en passe`() {
        assertTrue(prestation().intros)
        val sans = Game(prestation(intros = false)).apply { next(t0) }
        assertFalse(sans.state.intro)
        assertTrue(sans.deadline() != null, "sans présentation, le chrono part tout de suite")
    }

    @Test
    fun `présentation au début de chaque jeu seulement, puis le chrono part au lancement`() {
        val g = Game(prestation())
        g.next(t0)
        assertTrue(g.state.intro)
        assertEquals(PHASE_INTRO, Codec.publicState(g)["phase"])
        assertNull(g.close(t0 + 1_000), "rien ne ferme la présentation")
        assertTrue(g.next(t0 + 30_000) is GameLaunched)
        assertEquals(t0 + 30_000 + 20_000, g.deadline(), "le chrono part au lancement, pas à la présentation")
        g.close(t0 + 40_000); g.next(t0 + 41_000); g.next(t0 + 42_000)
        g.next(t0 + 43_000)
        assertEquals("q2", g.state.qid)
        assertFalse(g.state.intro, "deuxième question du même jeu : pas de présentation")
        g.close(t0 + 44_000); g.next(t0 + 45_000); g.next(t0 + 46_000)
        g.next(t0 + 47_000)
        assertEquals("v1", g.state.qid)
        assertTrue(g.state.intro, "nouveau jeu : sa présentation")
        @Suppress("UNCHECKED_CAST")
        assertEquals("Vrai ou Faux", (Codec.publicState(g)["game"] as Map<String, Any?>)["title"])
    }

    @Test
    fun `terminer la partie pendant une présentation montre bien la fin`() {
        val g = Game(prestation())
        g.next(t0)
        g.adjust("rose", 100, "", t0 + 1_000)
        assertEquals(100, g.state.scores()["rose"], "les points de la régie restent possibles")
        g.end(t0 + 2_000)
        assertEquals(Phase.ENDED, g.state.phase)
        assertEquals("ended", Codec.publicState(g)["phase"])
    }
}
