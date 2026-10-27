package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * Heure de fin de partie (`endedAt`) : la Régie PC efface les copies des médias d'une partie 24 h après.
 * Elle n'existe que tant que la partie est terminée, et se relit à l'identique depuis le journal.
 */
class FinDePartieTest {

    private fun q(id: String, round: String) =
        Question(id, "Question $id ?", listOf("A", "B"), correct = 0, durationSec = 10, roundTitle = round)

    private val animaux = listOf(q("r1q1", "Animaux"), q("r1q2", "Animaux"))
    private val ajout = listOf(q("x1q1", "Dinosaures"))
    private val t0 = 1_000_000L

    /**
     * Les deux questions jouées jusqu'à la révélation de la dernière (pas encore la fin) : après le tout dernier jeu, plus
     * de classement, « suivant » lance les résultats finaux (cedric, 27/10).
     */
    private fun jusquALaDerniereRevelation(): Game = Game(Quiz("lea", "Léa", animaux)).apply {
        next(t0); next(t0 + 4_000); next(t0 + 4_100, mapOf("rose" to Answer(0, t0 + 1_000))); next(t0 + 4_200)
        next(t0 + 5_000); next(t0 + 6_000); next(t0 + 6_100)
    }

    @Test
    fun `aucune heure de fin avant la fin de la partie`() {
        val g = Game(Quiz("lea", "Léa", animaux))
        assertNull(g.state.endedAt)
        assertFalse(Codec.publicState(g).containsKey("endedAt"), "salon d'attente")
        g.next(t0)
        assertNull(g.state.endedAt)
        assertFalse(Codec.publicState(g).containsKey("endedAt"), "question en cours")
        val revelation = jusquALaDerniereRevelation()
        assertEquals(Phase.REVEAL, revelation.state.phase)
        assertNull(revelation.state.endedAt)
        assertFalse(Codec.publicState(revelation).containsKey("endedAt"), "révélation de la dernière question")
    }

    @Test
    fun `la fin de partie donne son heure, publiée dans l'état public`() {
        val g = jusquALaDerniereRevelation()
        val fin = assertNotNull(g.next(t0 + 7_000))
        assertEquals(Phase.ENDED, g.state.phase)
        assertEquals(t0 + 7_000, fin.at)
        assertEquals(t0 + 7_000, g.state.endedAt)
        assertEquals(t0 + 7_000, Codec.publicState(g)["endedAt"])
    }

    @Test
    fun `fin demandée par la régie en pleine partie, et une seconde fin ne change rien`() {
        val g = Game(Quiz("lea", "Léa", animaux))
        g.next(t0)
        g.pause(t0 + 1_000)
        assertNotNull(g.end(t0 + 2_000))
        assertEquals(t0 + 2_000, g.state.endedAt)
        assertNull(g.end(t0 + 3_000), "déjà terminée")
        assertEquals(t0 + 2_000, g.state.endedAt)
    }

    @Test
    fun `une correction de score après la fin garde l'heure de fin`() {
        val g = jusquALaDerniereRevelation()
        g.next(t0 + 7_000)
        val bonus = assertNotNull(g.adjust("rose", 50, "oral", t0 + 8_000))
        assertNotNull(g.undo(bonus.seq, t0 + 9_000))
        assertEquals(Phase.ENDED, g.state.phase)
        assertEquals(t0 + 7_000, g.state.endedAt)
        assertEquals(t0 + 7_000, Codec.publicState(g)["endedAt"])
    }

    @Test
    fun `un jeu ajouté après la fin efface l'heure de fin, la fin suivante donne la sienne`() {
        val g = jusquALaDerniereRevelation()
        g.next(t0 + 7_000)
        val edited = assertNotNull(g.withProgram(Quiz("lea", "Léa", animaux + ajout)))
        // Programme prolongé mais pas encore repris : la partie est toujours terminée.
        assertEquals(t0 + 7_000, edited.state.endedAt)
        // La régie va au jeu ajouté : la partie reprend, plus d'heure de fin (rien ne doit être effacé).
        assertNotNull(edited.goto(2, t0 + 8_000))
        assertEquals(Phase.QUESTION, edited.state.phase)
        assertNull(edited.state.endedAt)
        assertFalse(Codec.publicState(edited).containsKey("endedAt"))
        // Le jeu ajouté se joue jusqu'au bout : nouvelle fin, nouvelle heure.
        edited.next(t0 + 9_000); edited.next(t0 + 9_100)
        assertEquals(Phase.REVEAL, edited.state.phase)
        assertNull(edited.state.endedAt)
        assertNotNull(edited.next(t0 + 10_000))
        assertEquals(Phase.ENDED, edited.state.phase)
        assertEquals(t0 + 10_000, edited.state.endedAt)
        assertEquals(t0 + 10_000, Codec.publicState(edited)["endedAt"])
    }

    @Test
    fun `box redémarrée, le journal redonne la même heure de fin`() {
        val g = jusquALaDerniereRevelation()
        g.next(t0 + 7_000)
        assertEquals(t0 + 7_000, Game(g.quiz, g.events).state.endedAt)
        // Reprise puis seconde fin, relues depuis le journal passé par Firebase (entiers en Long).
        val edited = assertNotNull(g.withProgram(Quiz("lea", "Léa", animaux + ajout)))
        edited.goto(2, t0 + 8_000)
        assertNull(Game(edited.quiz, edited.events).state.endedAt, "partie reprise : pas d'heure de fin")
        edited.next(t0 + 9_000); edited.next(t0 + 9_100); edited.next(t0 + 10_000)
        val relus = edited.events.map { e ->
            val brut = Codec.encode(e).mapValues { (_, v) -> if (v is Int) v.toLong() else v }
            assertNotNull(Codec.decode(brut))
        }
        val relue = Game(edited.quiz, relus)
        assertEquals(t0 + 10_000, relue.state.endedAt)
        assertEquals(edited.state, relue.state)
        assertEquals(Codec.publicState(edited), Codec.publicState(relue))
    }
}
