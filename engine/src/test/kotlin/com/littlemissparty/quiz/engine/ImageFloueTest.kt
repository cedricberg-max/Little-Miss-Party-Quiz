package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Image floue : la première équipe qui buzze répond à voix haute, l'animatrice valide. */
class ImageFloueTest {

    private val photo = "0123456789abcdef"
    private val q = Question("f1", "Qu'est-ce qui se cache sous le flou ?", listOf("Un lion", "Un chat"), 0, durationSec = 40, kind = QuestionKind.FLOU, imageId = photo)
    private val finale = Question("f2", "Et celle-ci ?", listOf("Une tour", "Un pont"), 1, durationSec = 40, kind = QuestionKind.FLOU, imageId = photo, double = true)
    private val t0 = 1_000_000L

    private fun game() = Game(Quiz("p", "P", listOf(q, finale))).apply { next(t0) }

    @Test
    fun `premier buzz, chrono figé, bonne réponse 150 points et révélation`() {
        val g = game()
        assertEquals(true, Codec.publicState(g)["buzzOpen"])
        assertNull(Codec.publicState(g)["choices"], "la réponse ne s'affiche pas sur les pupitres")
        g.buzz("rose", t0 + 10_000)
        assertTrue(g.state.buzzHeld)
        assertNull(g.deadline(), "le chrono attend le verdict")
        assertEquals(30_000L, g.remainingMs(t0 + 60_000), "le temps restant ne bouge plus")
        assertEquals(false, Codec.publicState(g)["buzzOpen"])
        assertNull(g.buzz("bleu", t0 + 10_100), "un second buzz pendant la réponse ne compte pas")
        g.judgeBuzz(true, t0 + 15_000)
        assertEquals(Phase.REVEAL, g.state.phase)
        assertEquals(mapOf("rose" to Scoring.BUZZ), g.state.scores())
        assertEquals(listOf("Un lion", "Un chat"), Codec.publicState(g)["choices"])
    }

    @Test
    fun `mauvaise réponse, équipe bloquée, la photo reprend, le rebond vaut 100`() {
        val g = game()
        val key = Codec.buzzKey(g)
        g.buzz("rose", t0 + 10_000)
        g.judgeBuzz(false, t0 + 14_000)
        assertEquals(Phase.QUESTION, g.state.phase)
        assertEquals(listOf("rose"), g.state.buzz!!.blocked)
        assertEquals(mapOf("rose" to true), Codec.publicState(g)["buzzBlocked"], "les règles de la base refusent son buzz")
        assertNotEquals(key, Codec.buzzKey(g), "nouvelle clé : la place du premier buzz est libérée")
        assertEquals(t0 + 14_000 + 30_000, g.deadline(), "le chrono repart où il s'était arrêté")
        assertNull(g.buzz("rose", t0 + 15_000), "l'équipe bloquée ne rebuzze pas")
        g.buzz("bleu", t0 + 16_000)
        g.judgeBuzz(true, t0 + 18_000)
        assertEquals(mapOf("bleu" to Scoring.BUZZ_REBOUND), g.state.scores())
    }

    @Test
    fun `chrono écoulé sans bonne réponse, personne ne marque, la réponse est révélée`() {
        val g = game()
        g.buzz("rose", t0 + 10_000)
        g.judgeBuzz(false, t0 + 12_000)
        g.timeUp(t0 + 42_000)
        assertEquals(Phase.CLOSED, g.state.phase)
        g.next(t0 + 43_000)
        assertEquals(Phase.REVEAL, g.state.phase)
        assertEquals(emptyMap(), g.state.scores())
        assertEquals(0, Codec.publicState(g)["correct"])
    }

    @Test
    fun `pause pendant la réponse orale, la reprise ne relance pas le chrono avant le verdict`() {
        val g = game()
        g.buzz("rose", t0 + 10_000)
        g.pause(t0 + 11_000)
        assertNull(g.judgeBuzz(true, t0 + 12_000), "rien ne se juge en pause")
        g.resume(t0 + 20_000)
        assertNull(g.deadline())
        g.judgeBuzz(false, t0 + 25_000)
        assertEquals(t0 + 25_000 + 30_000, g.deadline())
    }

    @Test
    fun `super finale doublée, une question rejouée repart sans équipe bloquée et avec une nouvelle clé`() {
        val g = game()
        val first = Codec.buzzKey(g)
        g.buzz("rose", t0 + 10_000)
        g.judgeBuzz(false, t0 + 11_000)
        g.goto(0, t0 + 20_000)
        assertEquals(emptyList(), g.state.buzz!!.blocked)
        assertNotEquals(first, Codec.buzzKey(g))
        g.buzz("rose", t0 + 21_000)
        g.judgeBuzz(true, t0 + 22_000)
        g.next(t0 + 23_000)
        g.next(t0 + 24_000)
        g.buzz("bleu", t0 + 25_000)
        g.judgeBuzz(true, t0 + 26_000)
        assertEquals(mapOf("rose" to Scoring.BUZZ, "bleu" to 2 * Scoring.BUZZ), g.state.scores())
    }

    @Test
    fun `la régie juge une seule fois, un double appui est refusé, et le journal se relit à l'identique`() {
        val g = game()
        g.buzz("rose", t0 + 10_000)
        val seq = g.state.lastSeq
        assertEquals(CommandStatus.APPLIED, g.execute(Command.Judge("a", seq, true), t0 + 11_000, setOf("rose")).status)
        assertEquals(CommandStatus.STALE, g.execute(Command.Judge("b", seq, true), t0 + 11_100, setOf("rose")).status)
        val replay = Game(g.quiz, g.events.map { Codec.decode(Codec.encode(it))!! })
        assertEquals(g.state, replay.state)
        assertEquals(Command.Judge("c", 3, false), Command.decode("c", mapOf("type" to "buzz_ko", "expectSeq" to 3)))
    }
}
