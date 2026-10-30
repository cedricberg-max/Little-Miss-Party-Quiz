package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * « ▶ Lancer la fin » (cedric, 29/10) : après le podium du Game Show, la musique attend en boucle pendant que Sarah
 * parle aux enfants ; son bouton « suivant » de la fin de partie lance l'outro du robot en fusée puis l'écran de fin.
 */
class LancerLaFinTest {

    private fun q(id: String, round: String) =
        Question(id, "Question $id ?", listOf("A", "B"), correct = 0, durationSec = 10, roundTitle = round)

    private val animaux = listOf(q("r1q1", "Animaux"), q("r1q2", "Animaux"))
    private val ajout = listOf(q("x1q1", "Dinosaures"))
    private val t0 = 1_000_000L

    /** Partie jouée jusqu'aux résultats finaux (le podium). */
    private fun terminee(): Game = Game(Quiz("lea", "Léa", animaux)).apply {
        next(t0); next(t0 + 4_000); next(t0 + 4_100, mapOf("rose" to Answer(0, t0 + 1_000))); next(t0 + 4_200)
        next(t0 + 5_000); next(t0 + 6_000); next(t0 + 6_100)
        assertNotNull(next(t0 + 7_000))
        assertEquals(Phase.ENDED, state.phase)
    }

    @Test
    fun `sur le podium rien n'est lancé, la fin attend Sarah`() {
        val g = terminee()
        assertNull(g.state.outroAt)
        assertFalse(Codec.publicState(g).containsKey("outroAt"))
    }

    @Test
    fun `suivant sur la fin de partie lance la fin, une seule fois, publiée pour la TV et le téléphone`() {
        val g = terminee()
        val e = assertIs<OutroLaunched>(g.next(t0 + 60_000))
        assertEquals(t0 + 60_000, g.state.outroAt)
        assertEquals(t0 + 60_000, Codec.publicState(g)["outroAt"])
        // Deux appuis (ou deux téléphones) : la fin n'est lancée qu'une fois, à la première heure.
        assertNull(g.next(t0 + 61_000))
        assertEquals(t0 + 60_000, g.state.outroAt)
        // La partie reste terminée, avec son heure de fin (la Régie PC s'en sert).
        assertEquals(Phase.ENDED, g.state.phase)
        assertEquals(t0 + 7_000, g.state.endedAt)
        assertEquals(e.seq, g.state.lastSeq)
    }

    @Test
    fun `jamais pendant la partie, ni en pause`() {
        val g = Game(Quiz("lea", "Léa", animaux))
        g.next(t0)
        assertFalse(g.record(OutroLaunched(g.state.lastSeq + 1, t0 + 500)), "pas de fin lancée en pleine question")
        assertNull(g.state.outroAt)
        // Pause demandée pendant une question puis fin par la régie : la partie terminée n'est plus en pause, et la
        // fin attend toujours Sarah.
        g.pause(t0 + 1_000)
        assertNull(g.next(t0 + 1_500), "en pause, « suivant » ne fait rien")
        assertNull(g.state.outroAt)
        assertNotNull(g.end(t0 + 2_000))
        assertNull(g.state.outroAt)
    }

    @Test
    fun `un jeu ajouté après la fin repart sans fin lancée, la fin suivante attend de nouveau Sarah`() {
        val g = terminee()
        g.next(t0 + 60_000)
        val edited = assertNotNull(g.withProgram(Quiz("lea", "Léa", animaux + ajout)))
        assertNotNull(edited.goto(2, t0 + 70_000))
        assertNull(edited.state.outroAt)
        assertFalse(Codec.publicState(edited).containsKey("outroAt"))
        edited.next(t0 + 71_000); edited.next(t0 + 71_100)
        assertNotNull(edited.next(t0 + 72_000))
        assertEquals(Phase.ENDED, edited.state.phase)
        assertNull(edited.state.outroAt, "nouveau podium : la fin attend de nouveau")
        assertIs<OutroLaunched>(edited.next(t0 + 90_000))
        assertEquals(t0 + 90_000, edited.state.outroAt)
    }

    @Test
    fun `box redémarrée, le journal relu par Firebase redonne la fin lancée`() {
        val g = terminee()
        g.next(t0 + 60_000)
        val relus = g.events.map { e ->
            val brut = Codec.encode(e).mapValues { (_, v) -> if (v is Int) v.toLong() else v }
            assertNotNull(Codec.decode(brut))
        }
        assertEquals("outro", Codec.encode(g.events.last())["type"])
        val relue = Game(g.quiz, relus)
        assertEquals(t0 + 60_000, relue.state.outroAt)
        assertEquals(g.state, relue.state)
        assertEquals(Codec.publicState(g), Codec.publicState(relue))
    }
}
