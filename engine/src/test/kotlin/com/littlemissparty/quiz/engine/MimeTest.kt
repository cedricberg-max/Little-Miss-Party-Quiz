package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Manche de mimes : tours d'équipe, Trouvé / Passer / correction, chrono, pause, points au classement. */
class MimeTest {

    private val cards = listOf("Chat", "Pirate", "Pizza", "Danseuse").map { MimeCard(it, "🙂") }
    private val quiz = Quiz(
        "demo", "Démo",
        listOf(
            Question("q1", "Couleur du ciel ?", listOf("Vert", "Bleu"), correct = 1, durationSec = 20, roundTitle = "Quiz"),
            Question("m1", "Mimes", emptyList(), correct = -1, durationSec = 60, kind = QuestionKind.MIME, roundTitle = "Mimes", cards = cards),
            Question("q2", "Finale", listOf("A", "B"), correct = 0, durationSec = 10, roundTitle = "Finale"),
        ),
    )
    private val teams = setOf("rose", "bleu")
    private val t0 = 1_000_000L

    /** Quiz joué (Rose a bien répondu), manche de mimes ouverte. */
    private fun atMimes(): Game = Game(quiz).apply {
        next(t0)
        next(t0 + 5_000)
        next(t0 + 5_100, mapOf("rose" to Answer(1, t0 + 2_000)))
        next(t0 + 6_000)
        next(t0 + 7_000)
        check(question?.isMime == true)
    }

    private fun Game.cmd(c: Command, now: Long) = execute(c, now, teams)

    @Test
    fun `la manche s'ouvre sans chrono, le tour de l'équipe le lance avec la première carte`() {
        val g = atMimes()
        assertEquals(Phase.QUESTION, g.state.phase)
        assertNull(g.deadline(), "Pas de chrono avant le tour d'une équipe")
        assertNull(g.mimeCard, "Aucune carte montrée avant le tour")
        assertEquals(0L, g.remainingMs(t0 + 10_000))
        assertNotNull(g.mimeStart("bleu", t0 + 10_000))
        assertEquals("Chat", g.mimeCard?.word)
        assertEquals(t0 + 70_000, g.deadline())
        assertEquals(30_000L, g.remainingMs(t0 + 40_000))
    }

    @Test
    fun `trouvé rapporte des points au classement général et passe à la carte suivante, passer ne rapporte rien`() {
        val g = atMimes()
        val before = g.state.scores()
        g.mimeStart("bleu", t0 + 10_000)
        g.mimeFound(t0 + 15_000)
        assertEquals("Pirate", g.mimeCard?.word)
        g.mimePass(t0 + 20_000)
        assertEquals("Pizza", g.mimeCard?.word, "La carte passée repart sous le paquet")
        g.mimeFound(t0 + 25_000)
        assertEquals((before["bleu"] ?: 0) + 2 * Scoring.MIME, g.state.scores()["bleu"])
        assertEquals(before["rose"], g.state.scores()["rose"], "Les points du quiz sont gardés")
        assertEquals("Danseuse", g.mimeCard?.word)
    }

    @Test
    fun `double appui sur Trouvé depuis la régie, un seul mime compté`() {
        val g = atMimes()
        g.cmd(Command.MimeStart("c1", g.state.lastSeq, "rose"), t0 + 10_000)
        val seen = g.state.lastSeq
        assertEquals(CommandStatus.APPLIED, g.cmd(Command.MimeFound("c2", seen), t0 + 12_000).status)
        assertEquals(CommandStatus.STALE, g.cmd(Command.MimeFound("c3", seen), t0 + 12_050).status)
        assertEquals(1, g.state.mimes["m1"]?.get("rose"))
    }

    @Test
    fun `moins un corrige une erreur sans jamais descendre sous zéro, même après le tour`() {
        val g = atMimes()
        g.mimeStart("bleu", t0 + 10_000)
        assertNull(g.mimeFix("bleu", -1, t0 + 11_000), "Rien à retirer : jamais de points négatifs")
        g.mimeFound(t0 + 12_000)
        g.mimeFound(t0 + 13_000)
        g.mimeFix("bleu", -1, t0 + 14_000)
        assertEquals(1, g.state.mimes["m1"]?.get("bleu"))
        assertEquals(1, g.state.mime?.found)
        g.mimeStop(t0 + 20_000)
        assertNotNull(g.mimeFix("bleu", -1, t0 + 21_000), "Correction possible juste après la fin du tour")
        assertEquals(0, g.state.mime?.last?.found)
        assertEquals(0, g.state.mimes["m1"]?.get("bleu"))
        assertNull(g.mimeFix("bleu", -1, t0 + 22_000))
        assertEquals(CommandStatus.REFUSED, g.cmd(Command.MimeFix("c", g.state.lastSeq, "inconnue", 1), t0 + 23_000).status)
        assertEquals(CommandStatus.REFUSED, g.cmd(Command.MimeFix("c", g.state.lastSeq, "bleu", 5), t0 + 23_000).status)
    }

    @Test
    fun `chrono écoulé, le tour s'arrête, aucun mime ne compte plus, l'équipe suivante peut jouer`() {
        val g = atMimes()
        g.mimeStart("bleu", t0 + 10_000)
        g.mimeFound(t0 + 20_000)
        assertNotNull(g.timeUp(t0 + 70_000))
        assertFalse(g.state.mimeTurn)
        assertEquals(MimeTurn("bleu", 1, 0), g.state.mime?.last)
        assertNull(g.mimeFound(t0 + 71_000))
        assertNull(g.deadline())
        assertEquals("rose", g.nextMimeTeam(listOf("bleu", "rose")), "La télécommande propose l'équipe qui n'a pas joué")
        g.mimeStart("rose", t0 + 80_000)
        assertEquals("Pirate", g.mimeCard?.word, "Le paquet continue là où il s'était arrêté")
        assertEquals(t0 + 140_000, g.deadline(), "Chaque tour a son propre chrono")
    }

    @Test
    fun `pause pendant un tour, chrono figé, rien ne compte, reprise avec 3 2 1`() {
        val g = atMimes()
        g.mimeStart("rose", t0 + 10_000)
        g.pause(t0 + 30_000)
        assertNull(g.deadline())
        assertEquals(CommandStatus.REFUSED, g.cmd(Command.MimeFound("c", g.state.lastSeq), t0 + 40_000).status)
        g.resume(t0 + 100_000)
        // 20 s jouées avant la pause, le chrono repart après le décompte : il reste 40 s.
        assertEquals(t0 + 100_000 + RESUME_COUNTDOWN_MS + 40_000, g.deadline())
        assertEquals("Chat", g.mimeCard?.word)
    }

    @Test
    fun `pause et reprise entre deux tours ne lancent aucun chrono`() {
        val g = atMimes()
        g.mimeStart("rose", t0 + 10_000)
        g.mimeStop(t0 + 20_000)
        g.pause(t0 + 25_000)
        g.resume(t0 + 30_000)
        assertNull(g.deadline())
        assertFalse(g.state.mimeTurn)
        assertNotNull(g.mimeStart("bleu", t0 + 40_000))
    }

    @Test
    fun `paquet épuisé, le tour s'arrête tout seul`() {
        val g = atMimes()
        g.mimeStart("rose", t0 + 10_000)
        repeat(4) { g.mimeFound(t0 + 11_000 + it * 1_000L) }
        assertFalse(g.state.mimeTurn)
        assertEquals(4, g.state.mime?.last?.found)
        assertNull(g.mimeStart("bleu", t0 + 20_000), "Plus aucune carte à mimer")
    }

    @Test
    fun `suivant arrête le tour puis termine la manche, les points restent au classement jusqu'à la fin`() {
        val g = atMimes()
        g.mimeStart("rose", t0 + 10_000)
        g.mimeFound(t0 + 11_000)
        assertTrue(g.next(t0 + 12_000) is MimeTurnEnded)
        assertTrue(g.next(t0 + 13_000) is ScoresShown)
        assertEquals(Phase.SCORES, g.state.phase)
        val scores = g.state.scores()
        g.next(t0 + 14_000)
        assertEquals("q2", g.state.qid)
        assertNull(g.state.mime)
        assertEquals(scores, g.state.scores())
    }

    @Test
    fun `la partie se reconstruit à l'identique depuis le journal (redémarrage de la box)`() {
        val g = atMimes()
        g.mimeStart("rose", t0 + 10_000)
        g.mimeFound(t0 + 11_000)
        g.mimePass(t0 + 12_000)
        g.mimeFix("rose", 1, t0 + 13_000)
        g.pause(t0 + 14_000)
        val stored = g.events.map { Codec.encode(it) }
        val replayed = Game(quiz, stored.map { assertNotNull(Codec.decode(it)) })
        assertEquals(g.state, replayed.state)
        assertEquals(g.mimeCard, replayed.mimeCard)
    }

    @Test
    fun `l'état public montre la carte en cours, jamais le reste du paquet`() {
        val g = atMimes()
        g.mimeStart("rose", t0 + 10_000)
        g.mimeFound(t0 + 11_000)
        @Suppress("UNCHECKED_CAST")
        val mime = Codec.publicState(g)["mime"] as Map<String, Any?>
        assertEquals("rose", mime["team"])
        assertEquals(mapOf("word" to "Pirate", "image" to "🙂"), mime["card"])
        assertEquals(1, mime["found"])
        assertEquals(3, mime["left"])
        assertEquals(mapOf("rose" to 1), mime["counts"])
        assertFalse(Codec.publicState(g).toString().contains("Danseuse"))
    }

    @Test
    fun `un paquet de mimes se lit depuis le JSON d'une prestation`() {
        val q = QuizJson.parse(
            """{"id":"p","title":"P","questions":[{"id":"m","text":"Mimes","kind":"mime","duration":45,
               "cards":[{"word":"Chat","image":"🐱"},{"word":"Robot"}]}]}""",
        ).questions.single()
        assertTrue(q.isMime)
        assertEquals(listOf(MimeCard("Chat", "🐱"), MimeCard("Robot", null)), q.cards)
        assertEquals(45, q.durationSec)
    }
}
