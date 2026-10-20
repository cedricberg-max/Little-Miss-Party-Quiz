package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Dernières questions du quiz : l'animatrice choisit ×2, ×3 ou ×5 juste avant la première (×2 si elle ne
 * touche à rien). Un réglage de la manche Quiz, jamais un jeu à part.
 */
class MultiplicateurTest {

    private fun q(id: String, round: String, double: Boolean = false) =
        Question(id, "Question $id ?", listOf("A", "B", "C", "D"), correct = 0, durationSec = 10, double = double, roundTitle = round)

    private val quiz = Quiz(
        "fete", "Fête",
        listOf(
            q("a1", "Quiz animaux"), q("a2", "Quiz animaux", double = true), q("a3", "Quiz animaux", double = true),
            Question("f1", "Image", listOf("Chat", "Chien"), correct = 0, durationSec = 30, kind = QuestionKind.FLOU, imageId = "img", roundTitle = "Image floue"),
            q("b1", "Quiz espace"), q("b2", "Quiz espace", double = true),
        ),
    )
    private val teams = setOf("rose", "bleu")
    private val t0 = 1_000_000L

    /** Joue la question en cours jusqu'au classement : « rose » répond juste tout de suite. */
    private fun jouer(g: Game, debut: Long): Long {
        if (g.state.phase == Phase.LOBBY || g.state.phase == Phase.SCORES) g.next(debut)
        // Première question multipliée : le chrono part après l'annonce « × N ».
        val t = g.multiplierIntroUntil() ?: debut
        g.next(t + 10_000)
        g.next(t + 10_100, mapOf("rose" to Answer(0, t + 10_000)))
        g.next(t + 10_200)
        return t + 20_000
    }

    private fun gagne(g: Game, qid: String) = g.state.awards[qid]?.get("rose")?.points ?: 0

    @Test
    fun `sans choix les dernières questions valent double`() {
        val g = Game(quiz)
        var t = t0
        repeat(3) { t = jouer(g, t) }
        assertEquals(100, gagne(g, "a1"))
        assertEquals(200, gagne(g, "a2"))
        assertEquals(200, gagne(g, "a3"))
    }

    @Test
    fun `le multiplicateur choisi avant la première question compte pour toute la série`() {
        val g = Game(quiz)
        var t = jouer(g, t0)
        assertEquals(1, g.factorChoice())
        assertEquals(CommandStatus.APPLIED, g.execute(Command.Factor("x", g.state.lastSeq, 5), t, teams).status)
        // Changer d'avis avant de lancer la question : le dernier choix compte.
        assertEquals(CommandStatus.APPLIED, g.execute(Command.Factor("y", g.state.lastSeq, 3), t, teams).status)
        t = jouer(g, t)
        // Plus de choix pendant la série : la valeur annoncée ne change pas en cours de route.
        assertNull(g.factorChoice())
        assertEquals(CommandStatus.REFUSED, g.execute(Command.Factor("z", g.state.lastSeq, 5), t, teams).status)
        t = jouer(g, t)
        assertEquals(300, gagne(g, "a2"))
        assertEquals(300, gagne(g, "a3"))
        assertEquals(3, g.factorOf(2))
    }

    @Test
    fun `chaque manche de quiz a son propre multiplicateur, ×2 par défaut`() {
        val g = Game(quiz)
        var t = jouer(g, t0)
        g.execute(Command.Factor("x", g.state.lastSeq, 5), t, teams)
        t = jouer(g, t); t = jouer(g, t)
        // Image floue (personne ne trouve), puis la seconde manche de quiz.
        t = jouer(g, t)
        t = jouer(g, t)
        assertEquals(5, g.factorChoice())
        t = jouer(g, t)
        assertEquals(500, gagne(g, "a2"))
        assertEquals(emptyMap(), g.state.awards["f1"].orEmpty())
        assertEquals(200, gagne(g, "b2"))
    }

    @Test
    fun `multiplicateur inconnu ou hors des dernières questions refusé`() {
        val g = Game(quiz)
        assertNull(g.factorChoice())
        assertEquals("bad_factor", g.execute(Command.Factor("x", 0, 4), t0, teams).reason)
        assertEquals(CommandStatus.REFUSED, g.execute(Command.Factor("y", 0, 3), t0, teams).status)
    }

    @Test
    fun `le choix survit à la reprise de la partie`() {
        val g = Game(quiz)
        var t = jouer(g, t0)
        g.execute(Command.Factor("x", g.state.lastSeq, 3), t, teams)
        val log = g.events.map { Codec.decode(Codec.encode(it))!! }
        val reprise = Game(quiz, log)
        assertEquals(3, reprise.factorOf(1))
        t = jouer(reprise, t)
        assertEquals(300, gagne(reprise, "a2"))
    }

    @Test
    fun `annonce « × N » avant la première question multipliée seulement, puis le chrono part`() {
        val g = Game(quiz)
        val t = jouer(g, t0)
        g.execute(Command.Factor("x", g.state.lastSeq, 3), t, teams)
        g.next(t)
        assertEquals(t + MULTIPLIER_INTRO_MS, g.multiplierIntroUntil())
        assertEquals(2, g.multipliedLeft(g.state.index))
        assertEquals(t + MULTIPLIER_INTRO_MS + 10_000, g.deadline(), "le chrono entier, après l'annonce")
        assertEquals(t + MULTIPLIER_INTRO_MS, Codec.publicState(g)["intro"])
        // « Arrêter le chrono » réflexe pendant l'annonce : refusé, comme pendant un décompte.
        assertEquals("countdown", g.execute(Command.Close("c", g.state.lastSeq), t + 1_000, teams).reason)
        // Pause pendant l'annonce : la reprise est un décompte ordinaire, l'annonce ne revient pas.
        g.pause(t + 2_000)
        assertNull(g.multiplierIntroUntil())
        g.resume(t + 9_000, countdownMs = 3_000)
        assertNull(g.multiplierIntroUntil())
        assertEquals(t + 12_000 + 10_000, g.deadline(), "rien n'a été décompté pendant l'annonce")
        // Question suivante de la série : pas de nouvelle annonce.
        jouer(g, t + 12_000)
        g.next(t + 40_000)
        assertNull(g.multiplierIntroUntil())
        assertEquals(1, g.multipliedLeft(g.state.index))
    }

    @Test
    fun `progression dans le jeu en cours, jamais dans toute la prestation`() {
        val g = Game(quiz)
        assertNull(g.gameStep())
        var t = jouer(g, t0)
        assertEquals("Quiz animaux · question 1 / 3", g.gameStep()!!.label)
        t = jouer(g, t); t = jouer(g, t)
        g.next(t)
        assertEquals("Image floue", g.gameStep()!!.label)
        t = jouer(g, t)
        jouer(g, t)
        assertEquals(GameStep("Quiz espace", 1, 2, questions = true), g.gameStep())
    }
}
