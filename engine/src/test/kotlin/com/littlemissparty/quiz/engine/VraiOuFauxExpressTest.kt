package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Vrai ou Faux express : les affirmations s'enchaînent toutes seules, 50 points par bonne réponse. */
class VraiOuFauxExpressTest {

    private val vf = listOf("Vrai", "Faux")
    private fun express(id: String, correct: Int, round: String = "Express", double: Boolean = false) =
        Question(id, "Affirmation $id", vf, correct, durationSec = 8, kind = QuestionKind.EXPRESS, roundTitle = round, double = double)

    private val quiz = Quiz(
        "p", "P",
        listOf(
            express("e1", 0),
            express("e2", 1),
            Question("q3", "Question classique ?", listOf("A", "B", "C", "D"), 2, roundTitle = "Quiz"),
            express("f1", 0, round = "Finale express", double = true),
        ),
    )
    private val t0 = 1_000_000L

    @Test
    fun `bonne réponse 50 points, la vitesse ne compte pas`() {
        val g = Game(quiz).apply { next(t0) }
        g.close(t0 + 7_900)
        g.expressStep(t0 + 9_000, mapOf("rose" to Answer(0, t0 + 7_800), "bleu" to Answer(0, t0 + 100), "vert" to Answer(1, t0 + 100)))
        val awards = g.state.awards["e1"]!!
        assertEquals(Scoring.EXPRESS, awards["rose"]!!.points)
        assertEquals(Scoring.EXPRESS, awards["bleu"]!!.points)
        assertEquals(0, awards["vert"]!!.points)
        assertEquals(0, awards["bleu"]!!.bonus)
    }

    @Test
    fun `la série s'enchaîne seule, puis les scores à la fin de la manche`() {
        val g = Game(quiz).apply { next(t0) }
        assertNull(g.expressDelayMs(), "Question ouverte : rien d'automatique")
        g.close(t0 + 8_000)
        assertEquals(EXPRESS_CLOSED_MS, g.expressDelayMs())
        g.expressStep(t0 + 9_200, mapOf("rose" to Answer(0, t0 + 1_000)))
        assertEquals(Phase.REVEAL, g.state.phase)
        assertEquals(EXPRESS_REVEAL_MS, g.expressDelayMs())
        g.expressStep(t0 + 12_700, emptyMap())
        assertEquals(Phase.QUESTION, g.state.phase)
        assertEquals("e2", g.state.qid)
        g.close(t0 + 20_000)
        g.expressStep(t0 + 21_200, mapOf("rose" to Answer(1, t0 + 15_000)))
        // Dernière affirmation de la manche : la suivante est un autre jeu, on montre les scores.
        g.expressStep(t0 + 24_700, emptyMap())
        assertEquals(Phase.SCORES, g.state.phase)
        assertNull(g.expressDelayMs())
        assertEquals(2 * Scoring.EXPRESS, g.state.scores()["rose"])
    }

    @Test
    fun `les scores de fin de serie restent a l'ecran malgre un appui reflexe de la regie`() {
        // Test du 28/10 : scores à 21:19:53, « suivant » du téléphone à 21:19:54, le jeu suivant partait sans les jauges.
        val equipes = setOf("rose")
        val g = Game(quiz).apply { next(t0) }
        g.close(t0 + 8_000)
        g.expressStep(t0 + 9_200, emptyMap())
        g.expressStep(t0 + 12_700, emptyMap())
        g.close(t0 + 20_000)
        g.expressStep(t0 + 21_200, emptyMap())
        g.expressStep(t0 + 24_700, emptyMap())
        assertEquals(Phase.SCORES, g.state.phase)
        val reflexe = g.execute(Command.Next("n1", g.state.lastSeq), t0 + 25_700, equipes)
        assertEquals(CommandStatus.REFUSED, reflexe.status)
        assertEquals("scores_just_shown", reflexe.reason)
        assertEquals(Phase.SCORES, g.state.phase)
        // Quelques secondes plus tard, « Jeu suivant » repart normalement.
        val suite = g.execute(Command.Next("n2", g.state.lastSeq), t0 + 24_700 + EXPRESS_SCORES_GUARD_MS, equipes)
        assertEquals(CommandStatus.APPLIED, suite.status)
        assertEquals("q3", g.state.qid)
    }

    @Test
    fun `entre deux affirmations, suivant enchaine sans scores et hors express les scores ne sont pas retenus`() {
        val equipes = setOf("rose")
        val g = Game(quiz).apply { next(t0) }
        g.close(t0 + 8_000)
        g.expressStep(t0 + 9_200, emptyMap())
        assertEquals(Phase.REVEAL, g.state.phase)
        assertEquals(CommandStatus.APPLIED, g.execute(Command.Next("n1", g.state.lastSeq), t0 + 9_500, equipes).status)
        assertEquals("e2", g.state.qid)
        assertEquals(Phase.QUESTION, g.state.phase)
        // Quiz classique : la régie montre les scores puis passe à la suite aussi vite qu'elle veut.
        g.goto(2, t0 + 30_000)
        g.close(t0 + 32_000)
        g.execute(Command.Next("n2", g.state.lastSeq), t0 + 32_100, equipes)
        g.execute(Command.Next("n3", g.state.lastSeq), t0 + 32_200, equipes)
        assertEquals(Phase.SCORES, g.state.phase)
        assertEquals(CommandStatus.APPLIED, g.execute(Command.Next("n4", g.state.lastSeq), t0 + 32_300, equipes).status)
    }

    @Test
    fun `en pause, rien n'avance tout seul`() {
        val g = Game(quiz).apply { next(t0) }
        g.close(t0 + 8_000)
        g.pause(t0 + 8_500)
        assertNull(g.expressDelayMs())
        assertNull(g.expressStep(t0 + 10_000, emptyMap()))
        assertEquals(Phase.CLOSED, g.state.phase)
        g.resume(t0 + 20_000)
        assertEquals(EXPRESS_CLOSED_MS, g.expressDelayMs())
    }

    @Test
    fun `hors du Vrai ou Faux express, la box attend l'animatrice`() {
        val g = Game(quiz).apply { next(t0) }
        g.goto(2, t0 + 1_000)
        g.close(t0 + 2_000)
        assertNull(g.expressDelayMs())
        assertNull(g.expressStep(t0 + 3_000, emptyMap()))
        assertEquals(Phase.CLOSED, g.state.phase)
    }

    @Test
    fun `super finale express, points doublés`() {
        val g = Game(quiz).apply { next(t0) }
        g.goto(3, t0 + 1_000)
        g.close(t0 + 2_000)
        g.expressStep(t0 + 3_000, mapOf("rose" to Answer(0, t0 + 1_500)))
        assertEquals(2 * Scoring.EXPRESS, g.state.awards["f1"]!!["rose"]!!.points)
        // Fin de la partie : la box attend l'animatrice après la toute dernière affirmation, puis les résultats finaux
        // (plus de classement juste avant, cedric 27/10).
        assertNull(g.expressStep(t0 + 7_000, emptyMap()))
        assertEquals(Phase.REVEAL, g.state.phase)
        assertNotNull(g.next(t0 + 8_000))
        assertEquals(Phase.ENDED, g.state.phase)
    }

    @Test
    fun `l'animatrice peut toujours avancer elle-même, et un double pas est refusé`() {
        val g = Game(quiz).apply { next(t0) }
        g.close(t0 + 8_000)
        g.next(t0 + 8_500, mapOf("rose" to Answer(0, t0 + 1_000)))
        assertEquals(Phase.REVEAL, g.state.phase)
        // L'étape automatique arrive juste après : elle passe à l'affirmation suivante, une seule fois.
        g.expressStep(t0 + 12_000, emptyMap())
        assertEquals("e2", g.state.qid)
        assertNull(g.expressStep(t0 + 12_100, emptyMap()))
        assertEquals(Phase.QUESTION, g.state.phase)
        // « Suivant » sur une révélation express : l'affirmation suivante, pas les scores.
        g.close(t0 + 13_000)
        g.next(t0 + 13_500, mapOf("rose" to Answer(1, t0 + 12_500)))
        g.next(t0 + 14_000)
        assertEquals(Phase.SCORES, g.state.phase, "fin de la manche : les scores")
    }

    @Test
    fun `se lit depuis une prestation, deux propositions obligatoires`() {
        val q = QuizJson.parse(
            """{"id":"p","questions":[{"id":"e","text":"Le soleil est une étoile.","choices":["Vrai","Faux"],"correct":0,"kind":"express","duration":8}]}""",
        ).questions.single()
        assertTrue(q.isExpress)
        assertEquals("express", Codec.publicState(Game(Quiz("p", "P", listOf(q))).apply { next(t0) })["kind"])
        assertFailsWith<IllegalArgumentException> {
            Question("x", "?", listOf("a", "b", "c"), correct = 1, kind = QuestionKind.EXPRESS)
        }
    }
}
