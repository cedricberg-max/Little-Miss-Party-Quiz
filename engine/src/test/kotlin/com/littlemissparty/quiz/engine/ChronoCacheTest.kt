package com.littlemissparty.quiz.engine

import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** ⏱️ Le Chrono caché : le chrono disparaît sous le drap, chaque équipe buzze à la cible, la plus proche gagne. */
class ChronoCacheTest {

    private val chrono = Question("c1", "Le Chrono caché", emptyList(), -1, kind = QuestionKind.CHRONO, roundTitle = "Le Chrono caché", chronoTours = 2)
    private val quiz = Question("q1", "Capitale ?", listOf("Paris", "Rome"), 0, durationSec = 20, roundTitle = "Quiz")
    private val t0 = 1_000_000L
    private val equipes = setOf("orange", "vert", "rose")

    private fun cmd(g: Game, type: String, vararg extra: Pair<String, Any?>) =
        Command.decode("c${g.state.lastSeq}", mapOf("type" to type, "expectSeq" to g.state.lastSeq) + extra)!!

    private fun Game.run(type: String, at: Long, vararg extra: Pair<String, Any?>, teams: Set<String> = equipes) =
        execute(cmd(this, type, *extra), at, teams, random = Random(3))

    private fun relu(g: Game) = Game(g.quiz).apply { g.events.forEach { record(Codec.decode(Codec.encode(it))!!) } }

    private fun pret(questions: List<Question> = listOf(chrono)): Game = Game(Quiz("p", "P", questions)).apply { next(t0) }

    /** Lance le tour prêt ; renvoie l'heure du 0. */
    private fun Game.lance(at: Long, teams: Set<String> = equipes): Long {
        assertEquals(CommandStatus.APPLIED, run("chrono_go", at, teams = teams).status)
        return state.chrono!!.goAt!!
    }

    @Test
    fun `le premier tour est pret avec la cible reglee, sans chrono de question`() {
        val g = pret()
        val c = g.state.chrono!!
        assertEquals(1, c.tour)
        assertEquals(CHRONO_CIBLE_DEFAUT, c.cible)
        assertEquals("ready", c.step)
        assertNull(g.deadline())
        val pub = Codec.publicState(g, teams = equipes)
        assertNull(pub["durationMs"])
        assertEquals("ready", (pub["chrono"] as Map<*, *>)["step"])
    }

    @Test
    fun `Sarah change la cible avant de lancer, jamais pendant le tour, jamais hors limites`() {
        val g = pret()
        assertEquals(CommandStatus.APPLIED, g.run("chrono_cible", t0 + 100, "cible" to 45).status)
        assertEquals(45, g.state.chrono!!.cible)
        assertEquals(CommandStatus.REFUSED, g.run("chrono_cible", t0 + 200, "cible" to 5).status)
        assertEquals(CommandStatus.REFUSED, g.run("chrono_cible", t0 + 200, "cible" to 500).status)
        g.lance(t0 + 1_000)
        assertEquals(CommandStatus.REFUSED, g.run("chrono_cible", t0 + 2_000, "cible" to 20).status)
        assertEquals(45, g.state.chrono!!.cible)
    }

    @Test
    fun `decompte puis 0, le drap tombe entre 6 et 12 s, la plus proche gagne 100 points`() {
        val g = pret()
        val go = g.lance(t0 + 1_000)
        assertEquals(t0 + 1_000 + CHRONO_DECOMPTE_MS, go)
        assertTrue(g.state.chrono!!.cacheMs!! in CHRONO_CACHE_MIN_MS..CHRONO_CACHE_MAX_MS)
        assertNotNull(g.chronoShown(go + 40, go + 60))
        val zero = go + 40
        // Cible 30 s : orange 29,5 s, vert 31,2 s, rose 30,3 s.
        assertNotNull(g.chronoBuzz("orange", zero + 29_500, zero + 29_600))
        assertNotNull(g.chronoBuzz("vert", zero + 31_200, zero + 31_300))
        assertNull(g.state.chrono!!.result, "rose n'a pas encore buzzé")
        assertNotNull(g.chronoBuzz("rose", zero + 30_300, zero + 30_350))
        val r = g.state.chrono!!.result!!
        assertEquals(listOf("rose"), r.winners)
        assertEquals(-500L, r.ecarts["orange"])
        assertEquals(1_200L, r.ecarts["vert"])
        assertEquals(300L, r.ecarts["rose"])
        assertEquals(CHRONO_POINTS, g.state.scores()["rose"])
        assertEquals(mapOf("rose" to 1), g.chronoGagnes())
        assertEquals(g.state, relu(g).state, "le journal se relit à l'identique")
    }

    @Test
    fun `l'heure annoncee par la tablette compte, pas l'arrivee dans un wifi lent`() {
        val g = pret()
        val go = g.lance(t0)
        g.chronoShown(go, go)
        // Orange appuie à 30,0 s mais son buzz arrive 1,2 s plus tard ; vert appuie à 30,4 s, arrivé tout de suite.
        g.chronoBuzz("vert", go + 30_400, go + 30_420)
        g.chronoBuzz("orange", go + 30_000, go + 31_200)
        g.chronoBuzz("rose", go + 40_000, go + 40_010)
        assertEquals(listOf("orange"), g.state.chrono!!.result!!.winners)
    }

    @Test
    fun `une heure d'appui invraisemblable est ramenee a 1,5 s avant l'arrivee`() {
        val g = pret()
        val go = g.lance(t0)
        g.chronoShown(go, go)
        g.chronoBuzz("orange", go + 1_000, go + 30_000)
        assertEquals(go + 30_000 - CHRONO_LATENCE_MAX_MS, g.state.chrono!!.buzzes.single().t)
    }

    @Test
    fun `egalite au centieme pres, les deux equipes gagnent`() {
        val g = pret()
        val go = g.lance(t0)
        g.chronoShown(go, go)
        g.chronoBuzz("orange", go + 29_500, go + 29_900)
        g.chronoBuzz("vert", go + 30_203, go + 30_300)
        g.chronoBuzz("rose", go + 30_197, go + 30_250)
        assertEquals(setOf("vert", "rose"), g.state.chrono!!.result!!.winners.toSet())
        assertEquals(CHRONO_POINTS, g.state.scores()["vert"])
        assertEquals(CHRONO_POINTS, g.state.scores()["rose"])
    }

    @Test
    fun `une equipe qui ne buzze pas, la box revele 15 s apres la cible, sans elle`() {
        val g = pret()
        val go = g.lance(t0)
        g.chronoShown(go, go)
        g.chronoBuzz("orange", go + 28_000, go + 28_100)
        g.chronoBuzz("vert", go + 33_000, go + 33_100)
        val due = go + 30_000 + CHRONO_ATTENTE_MS
        assertEquals(due, g.wakeAt())
        assertNull(g.settleChrono(due - 1_000))
        assertNotNull(g.timeUp(due))
        val r = g.state.chrono!!.result!!
        assertEquals(listOf("orange"), r.winners)
        assertFalse("rose" in r.ecarts)
    }

    @Test
    fun `Reveler maintenant, seulement une fois la cible passee`() {
        val g = pret()
        val go = g.lance(t0)
        g.chronoShown(go, go)
        g.chronoBuzz("orange", go + 29_000, go + 29_100)
        assertEquals(CommandStatus.REFUSED, g.run("chrono_reveal", go + 20_000).status, "les équipes comptent encore")
        assertEquals(CommandStatus.APPLIED, g.run("chrono_reveal", go + 31_000).status)
        assertEquals(listOf("orange"), g.state.chrono!!.result!!.winners)
    }

    @Test
    fun `personne ne buzze, bilan sans points`() {
        val g = pret()
        val go = g.lance(t0)
        assertNotNull(g.timeUp(go + 30_000 + CHRONO_ATTENTE_MS))
        val r = g.state.chrono!!.result!!
        assertTrue(r.winners.isEmpty())
        assertEquals(0, r.points)
        assertTrue(g.state.scores().values.all { it == 0 })
    }

    @Test
    fun `un 0 affiche en retard ne penalise personne, borne a 1 s`() {
        val g = pret()
        val go = g.lance(t0)
        g.chronoShown(go + 400, go + 500)
        g.chronoBuzz("orange", go + 400 + 30_000, go + 30_500)
        g.chronoBuzz("vert", go + 31_000, go + 31_100)
        g.chronoBuzz("rose", go + 45_000, go + 45_100)
        val r = g.state.chrono!!.result!!
        assertEquals(0L, r.ecarts["orange"])
        assertEquals(listOf("orange"), r.winners)
        val g2 = pret()
        val go2 = g2.lance(t0)
        g2.chronoShown(go2 + 5_000, go2 + 5_000)
        assertEquals(go2 + CHRONO_AFFICHAGE_MAX_MS, g2.state.chrono!!.reference)
    }

    @Test
    fun `la TV n'a jamais dit quand le 0 est apparu, l'heure prevue sert de reference`() {
        val g = pret()
        val go = g.lance(t0)
        equipes.forEachIndexed { i, t -> g.chronoBuzz(t, go + 30_000 + i * 100L, go + 30_100 + i * 100L) }
        val r = g.state.chrono!!.result!!
        assertEquals(0L, r.ecarts["orange"])
        assertEquals(listOf("orange"), r.winners)
    }

    @Test
    fun `un seul buzz par equipe, et seulement les equipes du tour`() {
        val g = pret()
        val go = g.lance(t0, setOf("orange", "vert"))
        g.chronoShown(go, go)
        assertNotNull(g.chronoBuzz("orange", go + 29_000, go + 29_100))
        assertNull(g.chronoBuzz("orange", go + 30_000, go + 30_100), "un second buzz ne compte pas")
        assertNull(g.chronoBuzz("rose", go + 30_000, go + 30_100), "rose est arrivée après le lancement")
    }

    @Test
    fun `tour suivant avec la meme cible, puis apres le dernier tour les scores`() {
        val g = pret()
        g.run("chrono_cible", t0, "cible" to 20)
        val go = g.lance(t0 + 100)
        g.chronoShown(go, go)
        equipes.forEachIndexed { i, t -> g.chronoBuzz(t, go + 20_000 + i * 300L, go + 20_500 + i * 300L) }
        assertFalse(g.chronoFini)
        assertEquals(CommandStatus.APPLIED, g.run("chrono_go", go + 25_000).status)
        assertEquals(2, g.state.chrono!!.tour)
        assertEquals(20, g.state.chrono!!.cible, "la cible reste celle de Sarah")
        assertEquals(mapOf("orange" to 1), g.state.chrono!!.gagnes)
        val go2 = g.lance(go + 30_000)
        g.chronoShown(go2, go2)
        equipes.forEachIndexed { i, t -> g.chronoBuzz(t, go2 + 21_000 - i * 300L, go2 + 21_500) }
        assertTrue(g.chronoFini)
        assertEquals(CommandStatus.REFUSED, g.run("chrono_go", go2 + 25_000).status)
        assertEquals(CHRONO_POINTS, g.state.scores()["orange"])
        assertEquals(CHRONO_POINTS, g.state.scores()["rose"])
        assertNotNull(g.next(go2 + 26_000))
        assertEquals(Phase.ENDED, g.state.phase, "dernier jeu : les résultats finaux")
    }

    @Test
    fun `jamais les scores pendant un tour en cours, arreter garde le tour pret`() {
        val g = pret(listOf(chrono, quiz))
        val go = g.lance(t0)
        assertNull(g.next(go + 1_000))
        assertEquals(CommandStatus.APPLIED, g.run("chrono_stop", go + 2_000).status)
        assertEquals("ready", g.state.chrono!!.step)
        assertNotNull(g.next(go + 3_000))
        assertEquals(Phase.SCORES, g.state.phase)
        assertNull(g.state.chrono)
    }

    @Test
    fun `la pause arrete le tour en cours sans points, la reprise le laisse pret`() {
        val g = pret()
        val go = g.lance(t0)
        g.chronoBuzz("orange", go + 5_000, go + 5_100)
        assertNotNull(g.pause(go + 6_000))
        assertEquals("ready", g.state.chrono!!.step)
        assertTrue(g.state.chrono!!.buzzes.isEmpty())
        assertNull(Codec.chronoKey(g))
        assertNotNull(g.resume(go + 7_000))
        assertEquals(CommandStatus.APPLIED, g.run("chrono_go", go + 20_000).status)
    }

    @Test
    fun `jeu double, 200 points`() {
        val g = pret(listOf(chrono.copy(double = true)))
        val go = g.lance(t0)
        g.chronoShown(go, go)
        equipes.forEachIndexed { i, t -> g.chronoBuzz(t, go + 30_000 + i * 500L, go + 30_000 + i * 500L + 50) }
        assertEquals(2 * CHRONO_POINTS, g.state.scores()["orange"])
    }

    @Test
    fun `le drap tombe avant 60 % de la cible, meme pour une petite cible`() {
        repeat(200) { i ->
            val r = Random(i)
            assertTrue(momentDuDrap(30, r) in CHRONO_CACHE_MIN_MS..CHRONO_CACHE_MAX_MS)
            assertTrue(momentDuDrap(10, r) <= 6_000L)
            assertTrue(momentDuDrap(10, r) >= 3_600L)
        }
    }

    @Test
    fun `reglages lus depuis le programme, ramenes dans les limites`() {
        val q = QuizJson.parse(
            """{"id":"p","title":"P","questions":[{"id":"c","text":"Chrono","kind":"chrono","cible":200,"tours":0}]}""",
        ).questions.single()
        assertTrue(q.isChrono)
        assertEquals(CHRONO_CIBLE_MAX, q.chronoCible)
        assertEquals(1, q.chronoTours)
    }

    @Test
    fun `le tour publie les equipes qui ont buzze, jamais leur heure`() {
        val g = pret()
        val go = g.lance(t0)
        g.chronoBuzz("orange", go + 29_123, go + 29_200)
        val etat = Codec.publicState(g, teams = equipes)["chrono"] as Map<*, *>
        assertEquals(listOf("orange"), etat["buzzed"])
        assertNotNull(etat["key"])
        assertFalse(etat.toString().contains("29123"))
    }
}
