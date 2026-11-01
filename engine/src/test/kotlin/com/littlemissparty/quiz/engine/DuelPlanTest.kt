package com.littlemissparty.quiz.engine

import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 🤠 Le Duel des robots, nouveau déroulé (cedric, 1/11) : les joueurs de chaque équipe donnés pendant la présentation
 * (tout le monde joue au moins une fois), une équipe changée sur le duel proposé, « ＋ Un duel en plus », et le mode
 * manuel où Sarah compose chaque duel.
 */
class DuelPlanTest {

    private val duel = Question("d1", "Le Duel des robots", emptyList(), -1, kind = QuestionKind.DUEL, roundTitle = "Le Duel des robots", joueurs = 2)
    private val t0 = 1_000_000L

    private fun cmd(g: Game, type: String, vararg extra: Pair<String, Any?>) =
        Command.decode("c${g.state.lastSeq}", mapOf("type" to type, "expectSeq" to g.state.lastSeq) + extra)!!

    private fun Game.run(type: String, at: Long, teams: Set<String>, vararg extra: Pair<String, Any?>) =
        execute(cmd(this, type, *extra), at, teams, random = Random(3))

    private fun relu(g: Game) = Game(g.quiz).apply { g.events.forEach { record(Codec.decode(Codec.encode(it))!!) } }

    private fun jeu(): Game = Game(Quiz("p", "P", listOf(duel))).apply { next(t0) }

    /** La box : un duel à préparer quand il le faut (comme GameViewModel). */
    private fun Game.box(teams: Set<String>, at: Long) {
        if (needsDuel()) readyDuel(teams, at, random = Random(5))
    }

    /** Lance le duel prêt, la première équipe gagne juste après le PAN, la box juge. */
    private fun Game.joue(teams: Set<String>, at: Long): Long {
        assertEquals(CommandStatus.APPLIED, run("duel_start", at, teams).status)
        val pan = state.duel!!.panAt!!
        val a = state.duel!!.teams[0]
        duelPanShown(pan, pan + 10)
        duelBuzz(a, pan + 200, pan + 250)
        assertNotNull(timeUp(pan + 200 + DUEL_LATENCE_MAX_MS))
        assertNotNull(state.duel!!.result)
        return pan + 5_000
    }

    @Test
    fun `joueurs par equipe donnes, chacun joue au moins une fois, en la moitie des joueurs arrondie au-dessus`() {
        val equipes = setOf("orange", "vert", "rose")
        val g = jeu()
        assertEquals(CommandStatus.APPLIED, g.run("duel_plan", t0 + 100, equipes, "counts" to mapOf("orange" to 2, "vert" to 3, "rose" to 2)).status)
        assertEquals(4, g.duelsAPrevoir(equipes), "7 joueurs : 4 duels")
        var at = t0 + 1_000
        var duels = 0
        g.box(equipes, at)
        while (!g.duelTousPasses(equipes)) {
            assertEquals("ready", g.state.duel!!.step)
            at = g.joue(equipes, at)
            duels++
            if (!g.duelTousPasses(equipes)) assertEquals(CommandStatus.APPLIED, g.run("duel_next", at, equipes).status)
            check(duels < 20)
        }
        assertEquals(4, duels)
        val joues = g.state.duel!!.played
        assertTrue(joues.getValue("orange") >= 2 && joues.getValue("vert") >= 3 && joues.getValue("rose") >= 2, "$joues")
        val pub = Codec.publicState(g, teams = equipes)["duel"] as Map<*, *>
        assertEquals(true, pub["allPlayed"])
        assertEquals(4, pub["total"])
        assertEquals(mapOf("counts" to mapOf("orange" to 2, "vert" to 3, "rose" to 2)), pub["plan"])
        assertEquals(g.state, relu(g).state)
    }

    @Test
    fun `l'equipe la plus nombreuse fait passer tous ses joueurs, les autres rejouent contre elle`() {
        assertEquals(5, duelsPrevus(mapOf("a" to 5, "b" to 1)))
        assertEquals(4, duelsPrevus(mapOf("a" to 4, "b" to 4)))
        assertEquals(12, duelsPrevus(mapOf("a" to 3, "b" to 3, "c" to 3, "d" to 3, "e" to 3, "f" to 3, "g" to 3, "h" to 3)))
        assertEquals(0, duelsPrevus(mapOf("a" to 3)))
    }

    @Test
    fun `adversaires varies, 4 equipes de 3 joueurs, chaque paire se rencontre une seule fois`() {
        val equipes = setOf("orange", "vert", "rose", "jaune")
        val g = jeu()
        g.run("duel_plan", t0 + 100, equipes, "counts" to equipes.associateWith { 3 })
        assertEquals(6, g.duelsAPrevoir(equipes))
        var at = t0 + 1_000
        val paires = mutableListOf<Set<String>>()
        g.box(equipes, at)
        repeat(6) {
            paires += g.state.duel!!.teams.toSet()
            at = g.joue(equipes, at)
            if (!g.duelTousPasses(equipes)) g.run("duel_next", at, equipes)
        }
        assertTrue(g.duelTousPasses(equipes))
        assertEquals(6, paires.distinct().size, "$paires")
        assertEquals(equipes.associateWith { 3 }, g.state.duel!!.played)
    }

    @Test
    fun `le plan remplace le duel prepare avant lui, puis n'est plus accepte une fois le premier duel lance`() {
        val equipes = setOf("orange", "vert", "rose")
        val g = jeu()
        g.box(equipes, t0 + 50)
        assertEquals("ready", g.state.duel!!.step)
        assertEquals(CommandStatus.APPLIED, g.run("duel_plan", t0 + 100, equipes, "counts" to mapOf("orange" to 1, "vert" to 1, "rose" to 6)).status)
        assertNull(g.state.duel, "le duel d'avant le plan est oublié")
        assertTrue(g.needsDuel())
        g.box(equipes, t0 + 200)
        assertTrue("rose" in g.state.duel!!.teams, "l'équipe qui a le plus de joueurs à faire passer d'abord")
        g.joue(equipes, t0 + 300)
        assertEquals(CommandStatus.REFUSED, g.run("duel_plan", t0 + 400_000, equipes, "skip" to true).status)
        assertEquals(CommandStatus.REFUSED, g.run("duel_plan", t0 + 400_000, equipes, "counts" to mapOf("inconnue" to 2)).status)
    }

    @Test
    fun `une equipe changee sur le duel propose, pour ce duel seulement, sans le lancer`() {
        val equipes = setOf("orange", "vert", "rose")
        val g = jeu()
        g.run("duel_plan", t0 + 100, equipes, "counts" to equipes.associateWith { 2 })
        g.box(equipes, t0 + 200)
        val propose = g.state.duel!!.teams
        val absente = (equipes - propose.toSet()).single()
        val nouvelle = listOf(absente, propose[1])
        assertEquals(CommandStatus.APPLIED, g.run("duel_swap", t0 + 300, equipes, "teams" to nouvelle).status)
        val d = g.state.duel!!
        assertEquals(nouvelle, d.teams)
        assertEquals(1, d.n)
        assertEquals("ready", d.step)
        assertFalse(d.extra)
        assertEquals(3, g.duelsAPrevoir(equipes), "le nombre de duels prévus ne change pas")
        assertEquals(CommandStatus.REFUSED, g.run("duel_swap", t0 + 400, equipes, "teams" to listOf("orange", "orange")).status)
        // L'équipe écartée n'est pas oubliée : elle joue au duel suivant.
        val ecartee = propose[0]
        g.joue(equipes, t0 + 500)
        g.run("duel_next", t0 + 200_000, equipes)
        assertTrue(ecartee in g.state.duel!!.teams)
    }

    @Test
    fun `un duel en plus s'ajoute aux duels prevus`() {
        val equipes = setOf("orange", "vert")
        val g = jeu()
        g.run("duel_plan", t0 + 100, equipes, "counts" to equipes.associateWith { 1 })
        g.box(equipes, t0 + 200)
        assertEquals(1, g.duelsAPrevoir(equipes))
        g.joue(equipes, t0 + 300)
        assertTrue(g.duelTousPasses(equipes))
        assertEquals(CommandStatus.APPLIED, g.run("duel_start", t0 + 200_000, equipes, "teams" to listOf("vert", "orange")).status)
        assertTrue(g.state.duel!!.extra)
        assertEquals(2, g.state.duel!!.n)
        val pan = g.state.duel!!.panAt!!
        g.duelPanShown(pan, pan + 10)
        g.duelBuzz("vert", pan + 100, pan + 150)
        g.timeUp(pan + 100 + DUEL_LATENCE_MAX_MS)
        assertEquals(2, g.duelsAPrevoir(equipes), "le duel en plus compte")
        assertEquals(1, g.state.duel!!.extras)
    }

    @Test
    fun `mode manuel, rien n'est propose, Sarah choisit les 2 equipes avant chaque duel`() {
        val equipes = setOf("orange", "vert", "rose", "jaune")
        val g = jeu()
        assertEquals(CommandStatus.APPLIED, g.run("duel_plan", t0 + 100, equipes, "skip" to true).status)
        assertTrue(g.duelManuel)
        assertFalse(g.needsDuel())
        assertNull(g.readyDuel(equipes, t0 + 200), "la box ne propose rien")
        assertEquals(0, g.duelsAPrevoir(equipes))
        assertEquals(CommandStatus.APPLIED, g.run("duel_start", t0 + 300, equipes, "teams" to listOf("jaune", "orange")).status)
        val d = g.state.duel!!
        assertEquals(listOf("jaune", "orange"), d.teams)
        assertFalse(d.extra)
        val pan = d.panAt!!
        g.duelPanShown(pan, pan + 10)
        g.duelBuzz("jaune", pan + 100, pan + 150)
        g.timeUp(pan + 100 + DUEL_LATENCE_MAX_MS)
        assertEquals(CommandStatus.REFUSED, g.run("duel_next", pan + 5_000, equipes).status)
        assertFalse(g.needsDuel())
        assertFalse(g.duelTousPasses(equipes), "jamais fini tout seul : « Jeu suivant » termine le Duel")
        assertEquals(CommandStatus.APPLIED, g.run("duel_start", pan + 6_000, equipes, "teams" to listOf("rose", "vert")).status)
        assertEquals(2, g.state.duel!!.n)
        assertEquals(mapOf("manual" to true), (Codec.publicState(g, teams = equipes)["duel"] as Map<*, *>)["plan"])
        assertEquals(g.state, relu(g).state)
        assertEquals(CommandStatus.APPLIED, g.run("next", pan + 400_000, equipes).let { if (it.status == CommandStatus.APPLIED) it else g.run("duel_stop", pan + 400_000, equipes) }.status)
    }

    @Test
    fun `pendant la presentation du Duel, la regie voit le reglage de la Regie PC et donne les joueurs de chaque equipe`() {
        val equipes = setOf("orange", "vert")
        val g = Game(Quiz("p", "P", listOf(duel), intros = true)).apply { next(t0) }
        assertTrue(g.state.intro)
        val pub = Codec.publicState(g, teams = equipes)
        assertEquals("intro", pub["phase"])
        val d = pub["duel"] as Map<*, *>
        assertEquals(2, d["joueurs"])
        assertNull(d["plan"])
        assertEquals(CommandStatus.APPLIED, g.run("duel_plan", t0 + 100, equipes, "counts" to mapOf("orange" to 5, "vert" to 3)).status)
        assertEquals(mapOf("counts" to mapOf("orange" to 5, "vert" to 3)), (Codec.publicState(g, teams = equipes)["duel"] as Map<*, *>)["plan"])
        assertFalse(g.needsDuel(), "rien avant le lancement de l'épreuve")
        g.next(t0 + 1_000)
        assertFalse(g.state.intro)
        assertTrue(g.needsDuel())
        assertEquals(5, g.duelsAPrevoir(equipes))
    }
}
