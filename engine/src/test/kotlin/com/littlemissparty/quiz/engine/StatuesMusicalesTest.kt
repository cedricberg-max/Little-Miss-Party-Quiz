package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Statues musicales : la musique s'arrête par moments, l'animatrice désigne l'équipe gagnante. */
class StatuesMusicalesTest {

    private val statues = Question("s1", "Statues musicales", emptyList(), -1, durationSec = 90, kind = QuestionKind.STATUES, roundTitle = "Statues musicales")
    private val t0 = 1_000_000L

    @Test
    fun `les arrêts sont toujours les mêmes, assez nombreux, jamais au début ni à la fin`() {
        val again = statues.copy()
        assertEquals(statues.statues, again.statues)
        assertTrue(statues.statues.size >= 4, "plusieurs statues en 90 s : ${statues.statues}")
        assertFalse(statues.statueAt(0))
        assertFalse(statues.statueAt(5_000))
        assertFalse(statues.statueAt(89_000))
        assertTrue(statues.statues.all { it.last - it.first + 1 in 2_500L..STATUE_MAX_MS })
        assertTrue(statues.statueAt(statues.statues[0].first))
        assertTrue(statues.statues.zipWithNext().all { (a, b) -> b.first - a.last >= 4_000 }, "on danse au moins 4 s entre deux statues")
    }

    @Test
    fun `l'animatrice désigne la gagnante, 300 points, les autres 150`() {
        val g = Game(Quiz("p", "P", listOf(statues))).apply { next(t0) }
        assertEquals("statues", Codec.publicState(g)["kind"])
        val r = g.execute(Command.decode("c", mapOf("type" to "statues_win", "team" to "rose", "expectSeq" to g.state.lastSeq))!!, t0 + 40_000, setOf("rose", "bleu", "vert"))
        assertEquals(CommandStatus.APPLIED, r.status)
        assertEquals(Phase.REVEAL, g.state.phase)
        assertEquals(mapOf("rose" to Scoring.MINI_WIN, "bleu" to Scoring.MINI_PLAYED, "vert" to Scoring.MINI_PLAYED), g.state.scores())
        // Journal relu à l'identique.
        val replay = Game(Quiz("p", "P", listOf(statues))).apply { g.events.forEach { record(Codec.decode(Codec.encode(it))!!) } }
        assertEquals(g.state.scores(), replay.state.scores())
    }

    @Test
    fun `après le chrono, équipe inconnue refusée, pas de deuxième gagnante, révélation sans gagnante possible`() {
        val g = Game(Quiz("p", "P", listOf(statues, statues.copy(id = "s2")))).apply { next(t0) }
        g.close(t0 + 90_000)
        assertEquals(CommandStatus.REFUSED, g.execute(Command.StatuesWin("x", g.state.lastSeq, "inconnue"), t0 + 91_000, setOf("rose")).status)
        assertEquals(CommandStatus.APPLIED, g.execute(Command.StatuesWin("y", g.state.lastSeq, "rose"), t0 + 92_000, setOf("rose")).status)
        assertEquals(CommandStatus.REFUSED, g.execute(Command.StatuesWin("z", g.state.lastSeq, "rose"), t0 + 93_000, setOf("rose")).status)
        assertEquals(mapOf("rose" to Scoring.MINI_WIN), g.state.scores())
        g.next(t0 + 94_000)
        g.next(t0 + 95_000)
        g.close(t0 + 200_000)
        g.next(t0 + 201_000)
        assertEquals(Phase.REVEAL, g.state.phase)
        assertEquals(mapOf("rose" to Scoring.MINI_WIN), g.state.scores(), "sans gagnante désignée, personne ne marque")
    }
}

class StatuesMusicalesJsonTest {
    @Test
    fun `se lit depuis une prestation, sans propositions ni bonne réponse`() {
        val quiz = QuizJson.parse("""{"id":"p","questions":[{"id":"s","text":"Statues musicales","kind":"statues","duration":90,"round":"Statues musicales"}]}""")
        assertTrue(quiz.questions[0].isStatues)
        assertEquals(90, quiz.questions[0].durationSec)
    }
}
