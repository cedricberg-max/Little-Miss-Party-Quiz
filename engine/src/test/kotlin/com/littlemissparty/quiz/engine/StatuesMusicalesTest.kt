package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Statues musicales : une chanson par tour, Sarah coupe la musique et désigne les gagnantes de chaque chanson. */
class StatuesMusicalesTest {

    private val statues = Question("s1", "Statues musicales", emptyList(), -1, durationSec = 90, kind = QuestionKind.STATUES, roundTitle = "Statues musicales")
    private val t0 = 1_000_000L

    private val chansons = listOf(ChansonStatues("c1", "a1", "Get Lucky"), ChansonStatues("c2", "a2", "One More Time"), ChansonStatues("c3", "a3"))
    private val jeu = statues.copy(songs = chansons)
    private val quiz = Question("q1", "Capitale ?", listOf("Paris", "Rome"), 0, durationSec = 20, roundTitle = "Quiz")
    private val equipes = setOf("rose", "bleu", "vert")

    private fun cmd(g: Game, type: String, vararg extra: Pair<String, Any?>) =
        Command.decode("c${g.state.lastSeq}", mapOf("type" to type, "expectSeq" to g.state.lastSeq) + extra)!!

    private fun Game.run(type: String, at: Long, vararg extra: Pair<String, Any?>) = execute(cmd(this, type, *extra), at, equipes)

    private fun relu(g: Game) = Game(g.quiz).apply { g.events.forEach { record(Codec.decode(Codec.encode(it))!!) } }

    @Test
    fun `la première chanson part de 0 00 au lancement, STATUE la coupe, On danse la reprend là où elle était`() {
        val g = Game(Quiz("p", "P", listOf(jeu))).apply { next(t0) }
        val st0 = g.state.statues!!
        assertEquals(0, st0.song)
        assertTrue(st0.dancing)
        assertEquals(10_000, st0.positionMs(t0 + 10_000))
        // Aucun chrono : rien ne s'arrête tout seul, même longtemps après.
        assertEquals(null, g.deadline())
        assertEquals(CommandStatus.APPLIED, g.run("statues_stop", t0 + 12_000).status)
        assertFalse(g.state.statues!!.dancing)
        assertEquals(12_000, g.state.statues!!.positionMs(t0 + 50_000), "la chanson ne bouge plus pendant la statue")
        assertEquals(CommandStatus.REFUSED, g.run("statues_stop", t0 + 13_000).status, "déjà arrêtée")
        assertEquals(CommandStatus.APPLIED, g.run("statues_play", t0 + 20_000).status)
        assertEquals(17_000, g.state.statues!!.positionMs(t0 + 25_000))
        val pub = Codec.publicState(g)["statues"] as Map<*, *>
        assertEquals(3, pub["songs"])
        assertEquals(listOf("Get Lucky", "One More Time", ""), pub["titles"])
        assertEquals(true, pub["dancing"])
        assertEquals(null, Codec.publicState(g)["remainingMs"])
        assertEquals(g.state.statues, relu(g).state.statues)
    }

    @Test
    fun `la pause fige la chanson, la reprise la relance seulement si on dansait`() {
        val g = Game(Quiz("p", "P", listOf(jeu))).apply { next(t0) }
        g.pause(t0 + 5_000)
        assertEquals(5_000, g.state.statues!!.positionMs(t0 + 60_000))
        assertEquals(CommandStatus.REFUSED, g.run("statues_stop", t0 + 6_000).status, "en pause, rien n'avance")
        g.resume(t0 + 60_000)
        val reprise = g.state.statues!!
        assertTrue(reprise.dancing)
        assertTrue(reprise.positionMs(t0 + 70_000) in 5_000L..15_000L, "reprend où elle était (après le décompte)")
        g.run("statues_stop", t0 + 80_000)
        val figee = g.state.statues!!.positionMs(t0 + 80_000)
        g.pause(t0 + 81_000)
        g.resume(t0 + 90_000)
        assertFalse(g.state.statues!!.dancing, "une statue reste une statue après la reprise")
        assertEquals(figee, g.state.statues!!.positionMs(t0 + 200_000))
    }

    @Test
    fun `plusieurs gagnantes 300 points, les autres 150, chanson après chanson, cumulés`() {
        val g = Game(Quiz("p", "P", listOf(jeu))).apply { next(t0) }
        assertEquals(CommandStatus.APPLIED, g.run("statues_win", t0 + 30_000, "teams" to listOf("rose", "bleu")).status)
        val r = g.state.statues!!.result!!
        assertEquals(listOf("rose", "bleu"), r.winners)
        assertEquals(mapOf("rose" to 300, "bleu" to 300, "vert" to 150), r.gains)
        assertFalse(g.state.statues!!.dancing, "la chanson s'arrête")
        assertEquals(Phase.QUESTION, g.state.phase, "le récap reste dans le jeu")
        assertEquals(CommandStatus.REFUSED, g.run("statues_win", t0 + 31_000, "teams" to listOf("vert")).status, "déjà jugée")
        assertEquals(CommandStatus.REFUSED, g.run("statues_play", t0 + 31_000).status, "jugée : on ne relance pas")
        assertEquals(CommandStatus.APPLIED, g.run("statues_song", t0 + 40_000).status)
        assertEquals(StatuesRound(song = 1, since = t0 + 40_000), g.state.statues)
        g.run("statues_win", t0 + 70_000, "teams" to listOf("vert"))
        assertEquals(mapOf("rose" to 450, "bleu" to 450, "vert" to 450), g.state.scores())
        assertEquals(g.state.scores(), relu(g).state.scores())
        assertEquals(g.state.statues, relu(g).state.statues)
    }

    @Test
    fun `Personne ne donne rien à personne, équipe inconnue refusée, ancienne régie à une gagnante acceptée`() {
        val g = Game(Quiz("p", "P", listOf(jeu))).apply { next(t0) }
        assertEquals(CommandStatus.REFUSED, g.run("statues_win", t0 + 10_000, "teams" to listOf("rose", "inconnue")).status)
        assertEquals(null, Command.decode("v", mapOf("type" to "statues_win", "expectSeq" to 1)), "ni gagnantes, ni « Personne » : illisible")
        assertEquals(CommandStatus.APPLIED, g.run("statues_win", t0 + 11_000, "personne" to true).status)
        assertEquals(emptyList(), g.state.statues!!.result!!.winners)
        assertEquals(emptyMap(), g.state.scores().filterValues { it != 0 })
        g.run("statues_song", t0 + 20_000)
        assertEquals(CommandStatus.APPLIED, g.run("statues_win", t0 + 30_000, "team" to "rose").status)
        assertEquals(mapOf("rose" to 300, "bleu" to 150, "vert" to 150), g.state.scores())
    }

    @Test
    fun `doublé, chaque chanson vaut deux fois plus`() {
        val g = Game(Quiz("p", "P", listOf(jeu.copy(double = true)))).apply { next(t0) }
        g.run("statues_win", t0 + 10_000, "teams" to listOf("bleu"))
        assertEquals(mapOf("rose" to 300, "bleu" to 600, "vert" to 300), g.state.scores())
    }

    @Test
    fun `chanson finie toute seule, Sarah choisit encore les gagnantes, pas de chanson après la dernière`() {
        val g = Game(Quiz("p", "P", listOf(jeu))).apply { next(t0) }
        assertEquals(null, g.statuesSongEnded(1, t0 + 5_000), "pas la chanson en cours")
        g.statuesSongEnded(0, t0 + 200_000)
        assertTrue(g.state.statues!!.ended)
        assertFalse(g.state.statues!!.dancing)
        assertEquals(CommandStatus.REFUSED, g.run("statues_play", t0 + 201_000).status, "finie : plus de musique")
        assertEquals(CommandStatus.REFUSED, g.run("statues_song", t0 + 201_000).status, "il faut d'abord les gagnantes")
        assertEquals(CommandStatus.REFUSED, g.run("next", t0 + 201_000).status, "« Jeu suivant » aussi")
        g.run("statues_win", t0 + 202_000, "teams" to listOf("rose"))
        g.run("statues_song", t0 + 210_000)
        g.run("statues_win", t0 + 220_000, "teams" to listOf("rose"))
        g.run("statues_song", t0 + 230_000)
        g.run("statues_win", t0 + 240_000, "teams" to listOf("rose"))
        assertEquals(2, g.state.statues!!.song)
        assertEquals(CommandStatus.REFUSED, g.run("statues_song", t0 + 250_000).status, "plus de chanson")
        assertEquals(CommandStatus.REFUSED, g.run("close", t0 + 250_000).status, "pas de chrono à arrêter")
    }

    @Test
    fun `du récap, les scores puis le jeu suivant, au dernier jeu les résultats finaux`() {
        val g = Game(Quiz("p", "P", listOf(jeu, quiz))).apply { next(t0) }
        assertEquals(CommandStatus.REFUSED, g.run("next", t0 + 5_000).status, "pendant la chanson, il faut d'abord les gagnantes")
        g.run("statues_win", t0 + 10_000, "teams" to listOf("vert"))
        // Test du 28/10 : le tableau des scores à la fin du jeu, comme partout ailleurs.
        assertEquals(CommandStatus.APPLIED, g.run("next", t0 + 20_000).status)
        assertEquals(Phase.SCORES, g.state.phase)
        assertEquals(null, g.state.statues)
        assertEquals(CommandStatus.APPLIED, g.run("next", t0 + 25_000).status)
        assertEquals("q1", g.state.qid)
        assertEquals(null, g.state.statues)
        assertEquals(mapOf("rose" to 150, "bleu" to 150, "vert" to 300), g.state.scores())

        val fin = Game(Quiz("p", "P", listOf(jeu))).apply { next(t0) }
        fin.run("statues_win", t0 + 10_000, "teams" to listOf("rose"))
        fin.run("next", t0 + 20_000)
        assertEquals(Phase.ENDED, fin.state.phase)
    }

    @Test
    fun `rejoué, le jeu repart de la première chanson et ses points ne comptent qu'une fois`() {
        val g = Game(Quiz("p", "P", listOf(jeu, quiz))).apply { next(t0) }
        g.run("statues_win", t0 + 10_000, "teams" to listOf("rose"))
        g.execute(Command.Goto("g", g.state.lastSeq, 0, "s1"), t0 + 20_000, equipes)
        assertEquals(StatuesRound(since = t0 + 20_000), g.state.statues)
        assertEquals(emptyMap(), g.state.scores().filterValues { it != 0 })
    }

    @Test
    fun `sans chansons entières, les extraits d'avant font les tours, sans rien un seul tour`() {
        assertEquals(listOf(ChansonStatues(null, "x"), ChansonStatues(null, "y")), statues.copy(audioIds = listOf("x", "y")).statuesSongs)
        assertEquals(1, statues.statuesTours)
    }

    @Test
    fun `journal d'avant le 27 octobre, une gagnante pour tout le jeu, relu à l'identique`() {
        val g = Game(Quiz("p", "P", listOf(statues))).apply { next(t0) }
        g.statuesWin("rose", listOf("bleu"), t0 + 40_000)
        assertEquals(Phase.REVEAL, g.state.phase)
        assertEquals(mapOf("rose" to Scoring.MINI_WIN, "bleu" to Scoring.MINI_PLAYED), g.state.scores())
        assertEquals(g.state.scores(), relu(g).state.scores())
    }
}

class StatuesMusicalesJsonTest {
    @Test
    fun `se lit depuis une prestation, sans propositions ni bonne réponse`() {
        val quiz = QuizJson.parse("""{"id":"p","questions":[{"id":"s","text":"Statues musicales","kind":"statues","duration":90,"round":"Statues musicales"}]}""")
        assertTrue(quiz.questions[0].isStatues)
        assertEquals(90, quiz.questions[0].durationSec)
    }

    @Test
    fun `les chansons entières se lisent avec leur extrait de secours, les mauvaises sont écartées`() {
        val quiz = QuizJson.parse("""{"id":"p","questions":[{"id":"s","text":"Statues","kind":"statues","round":"Statues",
            "songs":[{"songId":"c-1","audioId":"0123456789abcdef","title":"Get Lucky"},{"songId":"../x","audioId":"fedcba9876543210"},{"audioId":"pas-un-son"},{}]}]}""")
        assertEquals(listOf(ChansonStatues("c-1", "0123456789abcdef", "Get Lucky"), ChansonStatues(null, "fedcba9876543210")), quiz.questions[0].songs)
    }
}
