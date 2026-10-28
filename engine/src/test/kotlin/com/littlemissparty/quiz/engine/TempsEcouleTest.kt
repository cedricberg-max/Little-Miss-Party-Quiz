package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Quiz : chrono à zéro alors qu'une équipe n'a pas répondu, « TEMPS ÉCOULÉ ! » puis la réponse se révèle seule (cedric, 27/10). */
class TempsEcouleTest {

    private val quiz = Quiz(
        "demo", "Démo",
        listOf(
            Question("q1", "Couleur du ciel ?", listOf("Vert", "Bleu", "Rouge", "Jaune"), correct = 1, durationSec = 20),
            Question("q2", "Combien de pattes a une araignée ?", emptyList(), correct = 8, durationSec = 20, kind = QuestionKind.NUMBER),
            Question("q3", "Le soleil est une étoile", listOf("Vrai", "Faux"), correct = 0, durationSec = 8, kind = QuestionKind.EXPRESS),
        ),
    )
    private val teams = setOf("rose", "bleu")
    private val t0 = 1_000_000L

    @Test
    fun `chrono à zéro, la réponse se révèle seule 2,5 s après le « temps écoulé »`() {
        val g = Game(quiz)
        g.next(t0)
        assertNull(g.revelationAutoAt(), "question en cours")
        val fin = t0 + 20_000 + 200
        g.timeUp(fin)
        assertEquals(Phase.CLOSED, g.state.phase)
        assertTrue(g.tempsEcoule())
        assertEquals(fin + TEMPS_ECOULE_MS, g.revelationAutoAt())
        assertEquals(fin + TEMPS_ECOULE_MS, g.wakeAt(), "la box se réveille pour révéler")
        g.reveal(fin + TEMPS_ECOULE_MS, mapOf("rose" to Answer(1, t0 + 3_000)))
        assertEquals(Phase.REVEAL, g.state.phase)
        assertTrue((g.state.scores()["rose"] ?: 0) > 0, "la réponse donnée à temps compte")
        assertFalse(g.tempsEcoule())
        assertNull(g.revelationAutoAt())
    }

    @Test
    fun `Sarah arrête le chrono, ou toutes les équipes ont répondu, rien ne se révèle seul`() {
        val g = Game(quiz)
        g.next(t0)
        g.execute(Command.Close("c", g.state.lastSeq), t0 + 6_000, teams)
        assertEquals(Phase.CLOSED, g.state.phase)
        assertFalse(g.tempsEcoule())
        assertNull(g.revelationAutoAt())
        assertNull(g.wakeAt())
    }

    @Test
    fun `juste chiffre aussi, mais pas pendant une pause`() {
        val g = Game(quiz)
        var t = t0
        while (g.state.qid != "q2") { g.next(t); t += 1_000 }
        val fin = g.state.segments.last().start + 20_000 + 200
        g.timeUp(fin)
        assertTrue(g.tempsEcoule())
        assertEquals(fin + TEMPS_ECOULE_MS, g.revelationAutoAt())
        g.pause(fin + 1_000)
        assertNull(g.revelationAutoAt(), "en pause, rien ne part")
    }

    @Test
    fun `le vrai ou faux express garde son propre enchaînement`() {
        val g = Game(quiz)
        while (g.state.qid != "q3" || g.state.phase != Phase.QUESTION) g.next(t0)
        val ouverte = g.state.segments.last().start
        g.timeUp(ouverte + 8_000 + 200)
        assertEquals(Phase.CLOSED, g.state.phase)
        assertFalse(g.tempsEcoule())
        assertEquals(EXPRESS_CLOSED_MS, g.expressDelayMs())
    }
}
