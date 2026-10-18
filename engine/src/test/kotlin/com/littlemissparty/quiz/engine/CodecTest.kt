package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CodecTest {

    private val quiz = Quiz(
        "demo", "Démo",
        listOf(
            Question("q1", "Couleur du ciel ?", listOf("Vert", "Bleu", "Rouge", "Jaune"), correct = 1),
            Question("q2", "Finale", listOf("A", "B"), correct = 0, double = true),
        ),
    )

    /** Imite Firebase : les entiers reviennent en Long. */
    private fun firebaseRoundTrip(v: Any?): Any? = when (v) {
        is Int -> v.toLong()
        is Map<*, *> -> v.filterValues { it != null }.mapValues { firebaseRoundTrip(it.value) }
        is List<*> -> v.map { firebaseRoundTrip(it) }
        else -> v
    }

    @Test
    fun `chaque événement survit à l'aller-retour Firebase`() {
        val g = Game(quiz)
        g.next(1000)
        g.pause(2000)
        g.resume(3000)
        g.next(4000)
        g.next(5000, mapOf("a" to Answer(1, 1500), "b" to Answer(0, 1600)))
        val fix = g.adjust("b", 30, "oral", 6000)!!
        g.undo(fix.seq, 7000)
        g.next(8000)
        g.end(9000)
        val decoded = g.events.map { Codec.decode(firebaseRoundTrip(Codec.encode(it)) as Map<*, *>) }
        assertEquals(g.events, decoded)
        assertEquals(g.state, Game(quiz, decoded.filterNotNull()).state)
    }

    @Test
    fun `un événement illisible est ignoré sans planter`() {
        assertNull(Codec.decode(mapOf("seq" to 1L, "at" to 1L, "type" to "inconnu")))
        assertNull(Codec.decode(mapOf("type" to "open")))
    }

    @Test
    fun `les clés du journal restent triées`() {
        val keys = listOf(1, 2, 10, 100, 999).map(Codec::key)
        assertEquals(keys.sorted(), keys)
    }

    @Test
    fun `la bonne réponse n'est jamais publiée avant la révélation`() {
        val g = Game(quiz)
        g.next(1000)
        val during = Codec.publicState(g)
        assertNull(during["correct"])
        assertNull(during["awards"])
        assertEquals(listOf("Vert", "Bleu", "Rouge", "Jaune"), during["choices"])
        assertEquals(21_000L, during["deadline"])
        g.next(2000)
        assertNull(Codec.publicState(g)["correct"], "Question fermée mais pas encore révélée")
        g.next(3000, mapOf("a" to Answer(1, 1000)))
        val after = Codec.publicState(g)
        assertEquals(1, after["correct"])
        assertEquals(mapOf("a" to 120), after["scores"])
    }

    @Test
    fun `en pause, l'état publié donne le temps restant et pas d'échéance`() {
        val g = Game(quiz)
        g.next(1000)
        g.pause(6000)
        val s = Codec.publicState(g)
        assertEquals(true, s["paused"])
        assertNull(s["deadline"])
        assertEquals(15_000L, s["remainingMs"])
    }

    @Test
    fun `le salon publie l'état d'attente sans question`() {
        val s = Codec.publicState(Game(quiz), buzzRound = 3)
        assertEquals("lobby", s["phase"])
        assertFalse("text" in s)
        assertEquals(3, s["round"])
        assertTrue(s["buzzOpen"] == true)
    }
}
