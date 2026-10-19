package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Pictionary : équipe par équipe, le mot montré sur la tablette de l'équipe qui joue, puis le dessin et le
 * chrono ; un mot par tour, trouvé ou perdu ; points à l'équipe qui joue ; enchaînement avec le jeu suivant.
 */
class PictionaryTest {

    private val words = listOf("Chat", "Fusée", "Maison", "Soleil").map { MimeCard(it, "🙂") }
    private val quiz = Quiz(
        "demo", "Démo",
        listOf(
            Question("q1", "Couleur du ciel ?", listOf("Vert", "Bleu"), correct = 1, durationSec = 20, roundTitle = "Quiz"),
            Question("p1", "Pictionary", emptyList(), correct = -1, durationSec = 90, kind = QuestionKind.PICTIONARY, roundTitle = "Pictionary", cards = words),
            Question("q2", "Dernière", listOf("A", "B"), correct = 0, durationSec = 10, roundTitle = "Finale"),
        ),
    )
    private val teams = setOf("rose", "bleu")
    private val t0 = 1_000_000L

    /** Quiz joué (Rose a bien répondu), Pictionary ouvert. */
    private fun atPicto(): Game = Game(quiz).apply {
        next(t0)
        next(t0 + 5_000)
        next(t0 + 5_100, mapOf("rose" to Answer(1, t0 + 2_000)))
        next(t0 + 6_000)
        next(t0 + 7_000)
        check(question?.isPicto == true)
    }

    private fun Game.cmd(c: Command, now: Long) = execute(c, now, teams)

    @Test
    fun `le mot s'affiche pour l'équipe sans chrono, il part seulement quand l'animatrice lance le dessin`() {
        val g = atPicto()
        assertNull(g.mimeCard, "Aucun mot avant que l'animatrice le montre")
        assertNull(g.pictoDraw(t0 + 8_000), "Pas de dessin sans mot montré")
        assertNull(g.mimeStart("bleu", t0 + 8_000), "Pas de dessin sans mot montré")
        assertNotNull(g.pictoShow("bleu", t0 + 10_000))
        assertEquals("Chat", g.mimeCard?.word)
        assertEquals("bleu", g.state.mime?.secret)
        assertNull(g.deadline(), "Le chrono attend que le mot soit masqué")
        assertEquals(0L, g.remainingMs(t0 + 30_000))
        assertNotNull(g.pictoDraw(t0 + 40_000))
        assertEquals("bleu", g.state.mime?.team)
        assertNull(g.state.mime?.secret)
        assertEquals(t0 + 40_000 + 90_000, g.deadline())
        assertEquals("Chat", g.mimeCard?.word, "L'animatrice garde le mot sous les yeux pendant le dessin")
    }

    @Test
    fun `trouvé rapporte les points du Pictionary à l'équipe qui joue, une seule fois, et finit le tour`() {
        val g = atPicto()
        val before = g.state.scores()
        g.pictoShow("bleu", t0 + 10_000)
        g.pictoDraw(t0 + 15_000)
        val seq = g.state.lastSeq
        assertEquals(CommandStatus.APPLIED, g.cmd(Command.MimeFound("c1", seq), t0 + 50_000).status)
        // Double appui sur « Trouvé ! » : le second visait un état déjà dépassé.
        assertEquals(CommandStatus.STALE, g.cmd(Command.MimeFound("c2", seq), t0 + 50_100).status)
        assertEquals((before["bleu"] ?: 0) + Scoring.PICTO, g.state.scores()["bleu"])
        assertEquals(before["rose"], g.state.scores()["rose"])
        assertNull(g.state.mime?.team, "Un mot par tour : le tour est fini")
        assertNull(g.deadline())
        assertEquals(MimeTurn("bleu", 1, 0, 0), g.state.mime?.last)
        assertEquals("Chat", g.lastCard?.word, "La TV montre le mot à tout le monde une fois le tour fini")
        assertEquals(mapOf("bleu" to Scoring.PICTO), g.gameGains().filterValues { it > 0 }.filterKeys { it == "bleu" })
    }

    @Test
    fun `chrono écoulé, le tour est perdu, sans points, et le mot ne resservira pas`() {
        val g = atPicto()
        val before = g.state.scores()
        g.pictoShow("bleu", t0 + 10_000)
        g.pictoDraw(t0 + 15_000)
        assertNotNull(g.timeUp(t0 + 15_000 + 90_000))
        assertEquals(before, g.state.scores())
        assertEquals(MimeTurn("bleu", 0, 0, 0), g.state.mime?.last)
        g.pictoShow("rose", t0 + 120_000)
        assertEquals("Fusée", g.mimeCard?.word, "L'équipe suivante a un autre mot")
    }

    @Test
    fun `autre mot seulement pendant que l'équipe découvre le sien, jamais pendant le dessin`() {
        val g = atPicto()
        assertNull(g.mimePass(t0 + 8_000))
        g.pictoShow("rose", t0 + 10_000)
        assertNotNull(g.mimePass(t0 + 12_000))
        assertEquals("Fusée", g.mimeCard?.word)
        g.pictoDraw(t0 + 15_000)
        assertNull(g.mimePass(t0 + 20_000), "Pendant le dessin, le mot ne change plus")
        assertEquals("Fusée", g.mimeCard?.word)
    }

    @Test
    fun `mot montré à la mauvaise équipe, l'animatrice choisit l'autre, et le dessin part pour celle-ci`() {
        val g = atPicto()
        g.pictoShow("rose", t0 + 10_000)
        assertNull(g.pictoShow("rose", t0 + 10_100), "Double appui : rien de plus")
        g.pictoShow("bleu", t0 + 11_000)
        assertEquals("bleu", g.state.mime?.secret)
        assertNull(g.mimeStart("rose", t0 + 12_000), "Seule l'équipe qui a vu le mot peut dessiner")
        g.pictoDraw(t0 + 12_000)
        assertEquals("bleu", g.state.mime?.team)
    }

    @Test
    fun `pause pendant le dessin, le chrono se fige puis reprend, le mot ne change pas`() {
        val g = atPicto()
        g.pictoShow("bleu", t0 + 10_000)
        g.pictoDraw(t0 + 10_000)
        g.pause(t0 + 40_000)
        assertNull(g.mimeFound(t0 + 45_000), "En pause, rien n'avance")
        g.resume(t0 + 100_000)
        val remaining = g.remainingMs(t0 + 100_000 + RESUME_COUNTDOWN_MS)
        assertEquals(60_000L, remaining)
        assertEquals("Chat", g.mimeCard?.word)
    }

    @Test
    fun `chaque équipe joue son tour, puis le classement et le jeu suivant, scores gardés`() {
        val g = atPicto()
        g.pictoShow("bleu", t0 + 10_000)
        g.pictoDraw(t0 + 12_000)
        g.mimeFound(t0 + 30_000)
        g.pictoShow("rose", t0 + 40_000)
        g.pictoDraw(t0 + 42_000)
        g.timeUp(t0 + 42_000 + 90_000)
        val scores = g.state.scores()
        assertEquals(listOf("bleu", "rose"), g.state.mime?.turns)
        // « Terminer le Pictionary » : le classement, puis le jeu suivant.
        assertNotNull(g.next(t0 + 140_000))
        assertEquals(Phase.SCORES, g.state.phase)
        assertEquals("Finale", g.nextGameTitle())
        assertNotNull(g.next(t0 + 150_000))
        assertEquals("q2", g.state.qid)
        assertEquals(Phase.QUESTION, g.state.phase)
        assertEquals(scores, g.state.scores(), "Équipes et scores gardés au jeu suivant")
        // Relire le journal (box redémarrée) redonne exactement la même partie.
        assertEquals(g.state, Game(quiz, g.events).state)
    }

    @Test
    fun `passer au jeu suivant en plein dessin garde les points déjà gagnés, rejouer le Pictionary ne compte jamais deux fois`() {
        val g = atPicto()
        g.pictoShow("bleu", t0 + 10_000)
        g.pictoDraw(t0 + 12_000)
        g.mimeFound(t0 + 30_000)
        g.pictoShow("rose", t0 + 40_000)
        g.pictoDraw(t0 + 42_000)
        val withPicto = g.state.scores()
        // Le jeu fait un flop : la régie saute au jeu suivant en plein tour.
        assertEquals(CommandStatus.APPLIED, g.cmd(Command.Goto("g1", g.state.lastSeq, 2, "q2"), t0 + 50_000).status)
        assertEquals("q2", g.state.qid)
        assertEquals(withPicto, g.state.scores())
        // Rejouer le Pictionary : ses points sont retirés, puis rejoués.
        assertEquals(CommandStatus.APPLIED, g.cmd(Command.Goto("g2", g.state.lastSeq, 1, "p1"), t0 + 60_000).status)
        assertEquals((withPicto["bleu"] ?: 0) - Scoring.PICTO, g.state.scores()["bleu"] ?: 0)
        assertNull(g.state.mime?.secret)
        assertEquals(emptyList(), g.state.mime?.turns)
        assertEquals(g.state, Game(quiz, g.events).state)
    }

    @Test
    fun `les points d'un dessin réglés dans l'administration remplacent ceux par défaut`() {
        val custom = quiz.copy(questions = quiz.questions.map { if (it.isPicto) it.copy(points = 200) else it })
        val g = Game(custom).apply { next(t0); next(t0 + 5_000); next(t0 + 5_100); next(t0 + 6_000); next(t0 + 7_000) }
        g.pictoShow("rose", t0 + 10_000)
        g.pictoDraw(t0 + 11_000)
        g.mimeFound(t0 + 20_000)
        assertEquals(200, g.state.scores()["rose"])
    }

    @Test
    fun `le mot n'est publié que pendant le tour, la TV et les pupitres reçoivent la clé du dessin`() {
        val g = atPicto()
        val waiting = Codec.publicState(g)["mime"] as Map<*, *>
        assertNull(waiting["card"])
        assertNull(waiting["drawKey"])
        g.pictoShow("bleu", t0 + 10_000)
        val secret = Codec.publicState(g)["mime"] as Map<*, *>
        assertEquals("bleu", secret["secret"])
        assertEquals("Chat", (secret["card"] as Map<*, *>)["word"])
        assertEquals(Scoring.PICTO, secret["points"])
        g.pictoDraw(t0 + 12_000)
        val drawing = Codec.publicState(g)["mime"] as Map<*, *>
        assertEquals("p1-${t0 + 12_000}", drawing["drawKey"])
        g.mimeFound(t0 + 30_000)
        val after = Codec.publicState(g)["mime"] as Map<*, *>
        assertNull(after["card"])
        assertEquals("p1-${t0 + 12_000}", after["drawKey"], "Le dessin reste affiché sur la TV avec le mot")
        assertEquals("Chat", (after["last"] as Map<*, *>)["word"])
        // Le journal survit à l'encodage dans Firebase.
        val replayed = Game(quiz, g.events.map { Codec.decode(Codec.encode(it))!! })
        assertEquals(g.state, replayed.state)
        assertTrue(g.events.any { it is PictoShown })
    }
}
