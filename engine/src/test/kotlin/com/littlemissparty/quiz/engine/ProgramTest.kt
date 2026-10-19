package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** Jeu ajouté ou manches futures réorganisées depuis la régie, en pleine partie. */
class ProgramTest {

    private fun q(id: String, round: String, double: Boolean = false) =
        Question(id, "Question $id ?", listOf("A", "B"), correct = 0, durationSec = 10, double = double, roundTitle = round)

    private val animaux = listOf(q("r1q1", "Animaux"), q("r1q2", "Animaux"))
    private val espace = listOf(q("r2q1", "Espace"), q("r2q2", "Espace"))
    private val finale = listOf(q("r3q1", "Super Finale", double = true))
    private val ajout = listOf(q("x1q1", "Dinosaures"), q("x1q2", "Dinosaures"))
    private val quiz = Quiz("lea", "Léa", animaux + espace + finale)
    private val t0 = 1_000_000L

    /** Première question jouée jusqu'aux scores, Rose a bien répondu (100 points au moins). */
    private fun firstScored(): Game = Game(quiz).apply {
        next(t0)
        next(t0 + 4_000)
        next(t0 + 4_100, mapOf("rose" to Answer(0, t0 + 1_000)))
        next(t0 + 5_000)
    }

    @Test
    fun `ajouter un jeu après la manche en cours garde les scores et la suite de la manche`() {
        val g = firstScored()
        val before = g.state.scores()
        val next = Quiz("lea", "Léa", animaux + ajout + espace + finale)
        val edited = assertNotNull(g.withProgram(next))
        assertEquals(before, edited.state.scores())
        assertEquals(g.state, edited.state)
        // La manche Animaux se termine, puis vient le jeu ajouté.
        edited.next(t0 + 6_000)
        assertEquals("r1q2", edited.state.qid)
        edited.next(t0 + 7_000); edited.next(t0 + 7_100); edited.next(t0 + 7_200)
        edited.next(t0 + 8_000)
        assertEquals("x1q1", edited.state.qid)
    }

    @Test
    fun `la manche en cours et les questions jouées sont intouchables`() {
        val g = firstScored()
        assertEquals(1, g.lockedUntil(), "Question 1 jouée, la 2 termine la manche Animaux")
        // Retirer la fin de la manche en cours, ou glisser un jeu au milieu : refusé.
        assertEquals("current_round", g.programProblem(Quiz("lea", "Léa", listOf(animaux[0]) + espace)))
        assertEquals("current_round", g.programProblem(Quiz("lea", "Léa", listOf(animaux[0]) + ajout + listOf(animaux[1]))))
        assertNull(g.withProgram(Quiz("lea", "Léa", listOf(animaux[0].copy(correct = 1), animaux[1]) + espace)))
        // Déplacer ou retirer des manches futures : accepté.
        assertNull(g.programProblem(Quiz("lea", "Léa", animaux + finale + espace)))
        assertNull(g.programProblem(Quiz("lea", "Léa", animaux + finale)))
    }

    @Test
    fun `au salon tout peut changer`() {
        val g = Game(quiz)
        assertEquals(-1, g.lockedUntil())
        assertNotNull(g.withProgram(Quiz("autre", "Autre", ajout)))
    }

    @Test
    fun `après la fin, un jeu ajouté permet de reprendre la partie sans perdre les points`() {
        // Programme qui s'arrêtait trop tôt (bug n° 8 du test du 19 octobre) : le quiz est fini, partie terminée.
        val g = Game(Quiz("lea", "Léa", animaux)).apply {
            next(t0); next(t0 + 4_000); next(t0 + 4_100, mapOf("rose" to Answer(0, t0 + 1_000))); next(t0 + 4_200)
            next(t0 + 5_000); next(t0 + 6_000); next(t0 + 6_100); next(t0 + 6_200)
            next(t0 + 7_000)
        }
        assertEquals(Phase.ENDED, g.state.phase)
        val before = g.state.scores()
        // Ce qui a été joué ne bouge pas ; un jeu ajouté à la fin est accepté.
        assertEquals("current_round", g.programProblem(Quiz("lea", "Léa", listOf(animaux[0]) + ajout)))
        val edited = assertNotNull(g.withProgram(Quiz("lea", "Léa", animaux + ajout)))
        assertEquals(Phase.ENDED, edited.state.phase)
        // La régie va au jeu ajouté : la partie reprend, les points sont gardés, rien n'est rejoué.
        assertNotNull(edited.goto(2, t0 + 8_000))
        assertEquals("x1q1", edited.state.qid)
        assertEquals(Phase.QUESTION, edited.state.phase)
        assertEquals(before, edited.state.scores())
        // Le jeu ajouté se joue jusqu'au bout, puis la partie se termine de nouveau normalement.
        edited.next(t0 + 9_000); edited.next(t0 + 9_100); edited.next(t0 + 9_200)
        edited.next(t0 + 10_000); edited.next(t0 + 10_100); edited.next(t0 + 10_200); edited.next(t0 + 10_300)
        edited.next(t0 + 11_000)
        assertEquals(Phase.ENDED, edited.state.phase)
        assertEquals(before, edited.state.scores())
        // Relu depuis le journal (box redémarrée), l'état est le même.
        assertEquals(edited.state, Game(edited.quiz, edited.events).state)
    }

    @Test
    fun `sur la dernière question, un jeu ajouté à la fin prolonge la partie au lieu de la terminer`() {
        val g = Game(Quiz("demo", "Démo", animaux)).apply {
            next(t0); next(t0 + 4_000); next(t0 + 4_100); next(t0 + 4_200)
            next(t0 + 5_000); next(t0 + 6_000); next(t0 + 6_100); next(t0 + 6_200)
        }
        assertEquals(Phase.SCORES, g.state.phase)
        assertEquals(true, g.isLastQuestion)
        val edited = assertNotNull(g.withProgram(Quiz("demo", "Démo", animaux + ajout)))
        edited.next(t0 + 7_000)
        assertEquals(Phase.QUESTION, edited.state.phase)
        assertEquals("x1q1", edited.state.qid)
    }

    @Test
    fun `la fin d'un jeu annonce le jeu suivant, jamais au milieu d'un jeu`() {
        val g = firstScored()
        assertNull(g.nextGameTitle(), "Question 2 d'Animaux à suivre : même jeu")
        g.next(t0 + 6_000); g.next(t0 + 7_000); g.next(t0 + 7_100); g.next(t0 + 7_200)
        assertEquals("Espace", g.nextGameTitle())
        val mimes = Question("m", "Animaux", emptyList(), correct = -1, kind = QuestionKind.MIME, roundTitle = "Mimes des animaux", cards = listOf(MimeCard("Chat")))
        val avecMimes = Game(Quiz("lea", "Léa", animaux + mimes), g.events)
        assertEquals("Mimes", avecMimes.nextGameTitle())
        assertNull(Game(Quiz("lea", "Léa", animaux), g.events).nextGameTitle(), "Plus rien après : résultats finaux")
        val sansTitre = Game(Quiz("lea", "Léa", animaux + Question("x", "Sans manche ?", listOf("Oui", "Non"), correct = 0)), g.events)
        assertEquals("Quiz", sansTitre.nextGameTitle(), "Questions sans titre de manche : un quiz")
    }

    @Test
    fun `les points d'un jeu ne comptent que ce jeu`() {
        val g = firstScored()
        val total = g.state.scores()
        assertEquals(total, g.gameGains(), "Premier jeu : tout vient de lui")
        g.next(t0 + 6_000); g.next(t0 + 7_000); g.next(t0 + 7_100); g.next(t0 + 7_200)
        assertEquals(total, g.gameGains(), "Fin du jeu Animaux : son vainqueur")
        g.next(t0 + 7_300)
        assertEquals("Espace", g.question!!.roundTitle)
        assertEquals(emptyMap(), g.gameGains(), "Nouveau jeu : rien encore")
        assertEquals(total, g.state.scores(), "Le total, lui, est gardé")
    }

    @Test
    fun `quiz sans manches, seule la question en cours est verrouillée`() {
        val plain = Quiz("demo", "Démo", listOf(Question("q1", "Un ?", listOf("A", "B"), 0), Question("q2", "Deux ?", listOf("A", "B"), 0)))
        val g = Game(plain).apply { next(t0) }
        assertEquals(0, g.lockedUntil())
        assertNotNull(g.withProgram(Quiz("demo", "Démo", listOf(plain.questions[0]) + ajout + listOf(plain.questions[1]))))
    }
}
