package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Portes mystères : le jeu final, chaque équipe choisit une porte, bonus ou malus peuvent renverser le classement. */
class PortesMysteresTest {

    private val t0 = 1_000_000L
    private val quiz = Question("q1", "Capitale ?", listOf("Paris", "Rome"), 0, durationSec = 20, roundTitle = "Quiz")
    private val portes = Question(
        "p1", "Portes mystères", listOf("Porte 1", "Porte 2", "Porte 3", "Porte 4"), -1, durationSec = 30,
        kind = QuestionKind.PORTES, roundTitle = "Portes mystères", doors = listOf(150, -150, 300, 50),
    )

    /** Quiz joué (Licornes plus de 100, Dragons 0), un bonus de 200 pour les Licornes ; puis les portes. */
    private fun partie(): Game = Game(Quiz("p", "P", listOf(quiz, portes))).apply {
        next(t0)
        close(t0 + 2_000)
        next(t0 + 3_000, mapOf("licornes" to Answer(0, t0 + 1_000)))
        adjust("licornes", 200, "", t0 + 3_500)
        next(t0 + 4_000)
        next(t0 + 5_000)
        assertEquals("p1", question?.id)
    }

    @Test
    fun `chaque équipe reçoit sa porte, la même porte pour deux équipes, un malus jamais sous 0`() {
        val g = partie()
        val avant = g.state.scores()
        assertTrue(avant.getValue("licornes") >= Scoring.BASE)
        g.close(t0 + 10_000)
        g.next(t0 + 11_000, mapOf("licornes" to Answer(1, t0 + 6_000), "dragons" to Answer(1, t0 + 7_000), "loups" to Answer(2, t0 + 8_000)))
        val awards = g.state.awards.getValue("p1")
        assertEquals(-150, awards.getValue("licornes").points, "malus entier : la Licorne avait assez de points")
        assertEquals(0, awards.getValue("dragons").points, "malus réduit : jamais sous 0")
        assertEquals(300, awards.getValue("loups").points)
        assertEquals(avant.getValue("licornes") - 150, g.state.scores().getValue("licornes"))
        assertTrue(g.state.scores().values.all { it >= 0 })
    }

    @Test
    fun `l'animatrice ouvre les portes une à une de gauche à droite, puis le classement final et la fin`() {
        val g = partie()
        assertEquals(mapOf("count" to 4), Codec.publicState(g)["portes"], "rien n'est dit avant la révélation")
        g.close(t0 + 10_000)
        g.next(t0 + 11_000, mapOf("licornes" to Answer(2, t0 + 6_000), "dragons" to Answer(1, t0 + 7_000)))
        assertEquals(listOf(0, 1, 2, 3), g.doorOrder())
        @Suppress("UNCHECKED_CAST")
        fun etat() = Codec.publicState(g)["portes"] as Map<String, Any?>
        assertEquals(0, etat()["opened"])
        assertEquals(emptyMap<String, Int>(), etat()["values"], "aucune valeur avant l'ouverture")
        assertNull(Codec.publicState(g)["correct"])
        repeat(3) { g.next(t0 + 12_000L + it) }
        assertEquals(3, g.state.doorsOpened)
        assertEquals(mapOf("0" to 150, "1" to -150, "2" to 300), etat()["values"], "seules les portes ouvertes")
        assertEquals(Phase.REVEAL, g.state.phase)
        g.next(t0 + 13_000)
        assertEquals(4, g.state.doorsOpened)
        assertNull(g.openDoor(t0 + 13_500), "pas de cinquième porte")
        g.next(t0 + 14_000)
        assertEquals(Phase.SCORES, g.state.phase, "classement final")
        g.next(t0 + 15_000)
        assertEquals(Phase.ENDED, g.state.phase, "puis la grande finale")
    }

    @Test
    fun `rejouée depuis la régie, les portes repartent fermées sans compter deux fois`() {
        val g = partie()
        g.close(t0 + 10_000)
        g.next(t0 + 11_000, mapOf("licornes" to Answer(2, t0 + 6_000)))
        g.next(t0 + 12_000)
        val apres = g.state.scores().getValue("licornes")
        g.goto(1, t0 + 13_000)
        assertEquals(0, g.state.doorsOpened)
        assertEquals(apres - 300, g.state.scores().getValue("licornes"))
    }

    @Test
    fun `le programme JSON donne les valeurs des portes, il faut une valeur par porte`() {
        val q = QuizJson.parse(
            """{"id":"p","questions":[{"id":"p1","text":"Portes mystères","choices":["Porte 1","Porte 2","Porte 3"],"kind":"portes","duration":30,"doors":[300,-150,100]}]}""",
        ).questions[0]
        assertTrue(q.isPortes)
        assertEquals(listOf(300, -150, 100), q.doors)
        assertFailsWith<IllegalArgumentException> { portes.copy(doors = listOf(100)) }
        assertFailsWith<IllegalArgumentException> { portes.copy(doors = listOf(1, 2, 3, 5000)) }
    }

    @Test
    fun `le journal garde l'ouverture des portes`() {
        val e = DoorOpened(7, t0, "p1")
        assertEquals(e, Codec.decode(Codec.encode(e)))
    }
}
