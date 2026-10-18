package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

class CommandTest {

    private val quiz = Quiz(
        "demo", "Démo",
        listOf(
            Question("q1", "Couleur du ciel ?", listOf("Vert", "Bleu", "Rouge", "Jaune"), correct = 1, durationSec = 20),
            Question("q2", "Le soleil est une étoile", listOf("Vrai", "Faux"), correct = 0, durationSec = 10),
        ),
    )
    private val teams = setOf("rose", "bleu")
    private val t0 = 1_000_000L

    private fun next(g: Game, id: String = "c${g.state.lastSeq}") = Command.Next(id, g.state.lastSeq)

    @Test
    fun `deux appuis sur suivant n'avancent que d'une étape`() {
        val g = Game(quiz)
        val seen = g.state.lastSeq
        // Deux téléphones (ou un double appui) envoient « Suivant » en voyant la même étape.
        val first = g.execute(Command.Next("a", seen), t0, teams)
        val second = g.execute(Command.Next("b", seen), t0 + 50, teams)
        assertEquals(CommandStatus.APPLIED, first.status)
        assertEquals(CommandStatus.STALE, second.status)
        assertNull(second.event)
        assertEquals(Phase.QUESTION, g.state.phase)
        assertEquals(0, g.state.index)
    }

    @Test
    fun `la régie mène une question complète, points compris`() {
        val g = Game(quiz)
        g.execute(next(g), t0, teams)
        g.execute(Command.Close("x", g.state.lastSeq), t0 + 5_000, teams)
        assertEquals(Phase.CLOSED, g.state.phase)
        val answers = mapOf("rose" to Answer(1, t0 + 2_000), "intrus" to Answer(1, t0 + 1_000))
        val reveal = g.execute(next(g), t0 + 5_100, teams, answers)
        assertIs<Revealed>(reveal.event)
        assertEquals(Phase.REVEAL, g.state.phase)
        // Un appareil qui n'est pas une équipe inscrite ne marque rien.
        assertEquals(setOf("rose"), g.state.scores().keys)
        assertEquals(118, g.state.scores()["rose"])
    }

    @Test
    fun `impossible de lancer sans équipe`() {
        val g = Game(quiz)
        val r = g.execute(next(g), t0, emptySet())
        assertEquals(CommandStatus.REFUSED, r.status)
        assertEquals("no_teams", r.reason)
        assertEquals(Phase.LOBBY, g.state.phase)
    }

    @Test
    fun `une correction de score passe même si la partie a avancé, une fois par commande`() {
        val g = Game(quiz)
        val seen = g.state.lastSeq
        g.execute(next(g), t0, teams)
        val r = g.execute(Command.Adjust("adj", seen, "bleu", 10), t0 + 100, teams)
        assertEquals(CommandStatus.APPLIED, r.status)
        g.execute(Command.Adjust("adj2", seen, "bleu", 10), t0 + 200, teams)
        assertEquals(20, g.state.scores()["bleu"])
    }

    @Test
    fun `correction refusée pour une équipe inconnue ou un montant aberrant`() {
        val g = Game(quiz)
        assertEquals("unknown_team", g.execute(Command.Adjust("a", 0, "pirate", 10), t0, teams).reason)
        assertEquals("bad_delta", g.execute(Command.Adjust("b", 0, "rose", 0), t0, teams).reason)
        assertEquals("bad_delta", g.execute(Command.Adjust("c", 0, "rose", 5000), t0, teams).reason)
        assertEquals(emptyMap(), g.state.scores())
    }

    @Test
    fun `annuler une correction, une seule fois`() {
        val g = Game(quiz)
        val adj = g.execute(Command.Adjust("a", 0, "rose", 50), t0, teams).event!!
        assertEquals(CommandStatus.APPLIED, g.execute(Command.Undo("u", 0, adj.seq), t0 + 10, teams).status)
        assertEquals(CommandStatus.REFUSED, g.execute(Command.Undo("u2", 0, adj.seq), t0 + 20, teams).status)
        assertEquals(0, g.state.scores()["rose"] ?: 0)
    }

    @Test
    fun `pause et reprise depuis la régie, sans double effet`() {
        val g = Game(quiz)
        g.execute(next(g), t0, teams)
        assertEquals(CommandStatus.APPLIED, g.execute(Command.Pause("p", 0), t0 + 1_000, teams).status)
        assertEquals(CommandStatus.REFUSED, g.execute(Command.Pause("p2", 0), t0 + 1_100, teams).status)
        assertEquals(CommandStatus.APPLIED, g.execute(Command.Resume("r", 0), t0 + 6_000, teams).status)
        // 5 secondes de pause : le chrono n'a consommé que 1 seconde + ce qui suit la reprise.
        assertEquals(19_000, g.remainingMs(t0 + 6_000))
    }

    @Test
    fun `terminer la partie est protégé contre une commande en retard`() {
        val g = Game(quiz)
        g.execute(next(g), t0, teams)
        assertEquals(CommandStatus.STALE, g.execute(Command.End("e", 0), t0 + 10, teams).status)
        assertEquals(CommandStatus.APPLIED, g.execute(Command.End("e2", g.state.lastSeq), t0 + 20, teams).status)
        assertEquals(Phase.ENDED, g.state.phase)
    }

    @Test
    fun `décodage des commandes stockées dans Firebase`() {
        assertEquals(Command.Next("k", 3), Command.decode("k", mapOf("type" to "next", "expectSeq" to 3L)))
        assertEquals(
            Command.Adjust("k", 3, "rose", -10),
            Command.decode("k", mapOf("type" to "adjust", "expectSeq" to 3L, "team" to "rose", "delta" to -10L)),
        )
        assertEquals(Command.Undo("k", 1, 4), Command.decode("k", mapOf("type" to "undo", "expectSeq" to 1L, "target" to 4.0)))
        assertNull(Command.decode("k", mapOf("type" to "explode", "expectSeq" to 1L)))
        assertNull(Command.decode("k", mapOf("type" to "next")))
        assertNull(Command.decode("k", mapOf("type" to "adjust", "expectSeq" to 1L)))
    }
}
