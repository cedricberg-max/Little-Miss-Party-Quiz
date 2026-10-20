package com.littlemissparty.quiz.engine

import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** La bombe cachée : coffres ouverts chacun son tour, tours sans danger, puis la bombe arrête le jeu. */
class BombeCacheeTest {

    private val t0 = 1_000_000L
    private val quiz = Question("q1", "Capitale ?", listOf("Paris", "Rome"), 0, durationSec = 20, roundTitle = "Quiz")
    private val bombe = Question("b1", "La bombe cachée", emptyList(), -1, kind = QuestionKind.COFFRES, roundTitle = "La bombe cachée")
    private val apres = Question("q2", "Couleur du ciel ?", listOf("Bleu", "Vert"), 0, durationSec = 20, roundTitle = "Quiz 2")
    private val equipes = listOf("licornes", "dragons")

    /** Tirage qui donne toujours 0 : la bombe dès qu'elle est possible. */
    private val toujoursBombe = TirageZero()

    /** Quiz joué (Licornes 100 et plus, Dragons 0), puis la bombe cachée, présentée puis lancée. */
    private fun partie(intros: Boolean = true): Game = Game(Quiz("p", "P", listOf(quiz, bombe, apres), intros = intros)).apply {
        next(t0)
        if (intros) next(t0 + 100)
        close(t0 + 2_000)
        next(t0 + 3_000, mapOf("licornes" to Answer(0, t0 + 1_000)))
        next(t0 + 4_000)
        next(t0 + 5_000)
        assertEquals("b1", question?.id)
        if (intros) {
            assertFalse(needsChests(), "rien avant le lancement de l'animatrice")
            assertNull(dealChests(equipes, t0 + 5_500))
            next(t0 + 6_000)
        }
        assertTrue(needsChests())
    }

    /** Ouvre le premier coffre fermé pour l'équipe qui joue, une fois l'animation précédente finie. */
    private fun Game.ouvrir(random: Random = Random(1)): ChestOpened {
        val r = chestRound!!
        return openChest(r.team!!, r.closed.first(), r.readyAt, random) as ChestOpened
    }

    @Test
    fun `l'équipe la plus en retard commence, puis chacune son tour`() {
        val g = partie()
        val d = g.dealChests(equipes, t0 + 7_000) as ChestsDealt
        assertEquals(listOf("dragons", "licornes"), d.order, "les Dragons (0 point) commencent")
        assertEquals(chestCount(2), d.count)
        assertEquals(10, d.count)
        assertEquals(6, d.safe, "3 tours sans danger à 2 équipes")
        assertNull(g.dealChests(equipes, t0 + 7_100), "une seule distribution")
        assertEquals("dragons", g.chestRound!!.team)
        assertNull(g.openChest("licornes", 0, t0 + 8_000), "pas le tour des Licornes")
        g.ouvrir()
        assertEquals("licornes", g.chestRound!!.team)
        g.ouvrir()
        assertEquals("dragons", g.chestRound!!.team)
    }

    @Test
    fun `jamais de bombe pendant les tours sans danger, puis la bombe arrête le jeu`() {
        // Beaucoup de parties tirées au sort : la bombe n'arrive jamais trop tôt, et toujours avant la fin des coffres.
        repeat(300) { graine ->
            val random = Random(graine)
            val g = partie(intros = false)
            g.dealChests(equipes, t0 + 7_000)
            val r0 = g.chestRound!!
            while (g.chestRound!!.team != null) {
                val e = g.ouvrir(random)
                if (e.bomb) assertTrue(g.chestRound!!.turn > r0.safe, "bombe après les tours sans danger (partie $graine)")
            }
            val r = g.chestRound!!
            assertTrue(r.exploded, "la partie se termine toujours sur la bombe")
            assertEquals(1, r.opened.count { it.bomb })
            assertEquals(Phase.REVEAL, g.state.phase, "bilan")
            assertTrue(g.state.scores().values.all { it >= 0 }, "jamais sous 0")
        }
    }

    @Test
    fun `la bombe coûte 300 points, réduits au score, et le bilan montre les gains du jeu`() {
        val g = partie(intros = false)
        g.dealChests(equipes, t0 + 7_000)
        val avant = g.state.scores()
        // Une graine où les Dragons (0 point) ouvrent la bombe juste après les tours sans danger.
        val r = g.chestRound!!
        repeat(r.safe) { g.ouvrir(Random(it)) }
        val team = g.chestRound!!.team!!
        val score = g.state.scores()[team] ?: 0
        val e = g.openChest(team, g.chestRound!!.closed.first(), g.chestRound!!.readyAt, toujoursBombe) as ChestOpened
        assertTrue(e.bomb)
        assertEquals(-minOf(BOMB_POINTS, score), e.delta)
        assertNull(g.chestRound!!.team, "plus personne ne joue")
        assertNull(g.openRandomChest(t0 + 999_000), "plus aucun coffre ne s'ouvre")
        val gains = g.gameGains()
        equipes.forEach { assertEquals((g.state.scores()[it] ?: 0) - (avant[it] ?: 0), gains[it] ?: 0) }
        g.next(t0 + 999_000)
        assertEquals(Phase.SCORES, g.state.phase, "classement")
        g.next(t0 + 999_500)
        assertEquals("q2", g.question?.id, "le jeu suivant s'enchaîne")
    }

    @Test
    fun `l'équipe suivante attend la fin de l'animation, et l'annonce de la bombe après le dernier tour sans danger`() {
        val g = partie(intros = false)
        g.dealChests(equipes, t0 + 7_000)
        val premier = g.ouvrir()
        val r = g.chestRound!!
        assertEquals(premier.at + CHEST_SHOW_MS, r.readyAt)
        assertNull(g.openChest(r.team!!, r.closed.first(), r.readyAt - 1_000), "trop tôt : l'animation n'est pas finie")
        repeat(r.safe - 1) { g.ouvrir() }
        val dernier = g.chestRound!!.opened.last()
        assertTrue(g.chestRound!!.danger)
        assertEquals(dernier.at + CHEST_SHOW_MS + BOMB_ALERT_MS, g.chestRound!!.readyAt, "le temps de l'annonce")
    }

    @Test
    fun `en pause rien ne s'ouvre, et un malus ne fait jamais descendre sous 0`() {
        val g = partie(intros = false)
        g.dealChests(equipes, t0 + 7_000)
        val r = g.chestRound!!
        g.pause(t0 + 8_000)
        assertNull(g.openChest(r.team!!, 0, t0 + 9_000))
        assertNull(g.openRandomChest(t0 + 9_000))
        g.resume(t0 + 10_000)
        val e = g.openChest("dragons", 0, t0 + 14_000, PremierMalus()) as ChestOpened
        assertEquals(0, e.delta, "les Dragons n'avaient aucun point")
        assertEquals(0, g.state.scores()["dragons"] ?: 0)
    }

    @Test
    fun `le secours de la régie ouvre un coffre au hasard pour l'équipe qui joue`() {
        val g = partie(intros = false)
        g.dealChests(equipes, t0 + 7_000)
        val res = g.execute(Command.ChestRandom("c1", g.state.lastSeq), t0 + 8_000, equipes.toSet())
        assertEquals(CommandStatus.APPLIED, res.status)
        assertEquals("dragons", (res.event as ChestOpened).team)
        val trop = g.execute(Command.ChestRandom("c2", g.state.lastSeq), t0 + 8_500, equipes.toSet())
        assertEquals(CommandStatus.REFUSED, trop.status, "pas pendant l'animation")
        val double = g.execute(Command.ChestRandom("c3", g.state.lastSeq - 1), t0 + 20_000, equipes.toSet())
        assertEquals(CommandStatus.STALE, double.status, "un double appui n'ouvre qu'un coffre")
        assertNull(g.next(t0 + 20_000), "le bouton principal n'ouvre jamais de coffre")
    }

    @Test
    fun `le journal rejoué redonne les mêmes coffres et les mêmes points`() {
        val g = partie(intros = false)
        g.dealChests(equipes, t0 + 7_000)
        repeat(5) { g.ouvrir(Random(it)) }
        val relu = Game(g.quiz, g.events.map { Codec.decode(Codec.encode(it))!! })
        assertEquals(g.state, relu.state)
        assertEquals(g.chestRound, relu.chestRound)
    }

    @Test
    fun `rejouée depuis la régie, la bombe cachée repart à zéro sans compter deux fois`() {
        val g = partie(intros = false)
        val avant = g.state.scores()
        g.dealChests(equipes, t0 + 7_000)
        repeat(4) { g.ouvrir(Random(it)) }
        assertNotNull(g.goto(1, t0 + 60_000))
        assertNull(g.chestRound, "coffres à redistribuer")
        assertEquals(avant, g.state.scores(), "les coffres de la première fois ne comptent plus")
        assertTrue(g.needsChests())
    }

    @Test
    fun `l'état publié ne dit rien des coffres fermés`() {
        val g = partie(intros = false)
        g.dealChests(equipes, t0 + 7_000)
        g.ouvrir()
        @Suppress("UNCHECKED_CAST")
        val c = Codec.publicState(g)["chests"] as Map<String, Any?>
        assertEquals("licornes", c["team"])
        assertEquals(1, (c["opened"] as List<*>).size)
        assertNotNull(c["key"])
        assertEquals(5, c["safeLeft"])
        assertNull(Codec.publicState(g)["deadline"], "pas de chrono")
        assertNull(Codec.publicState(g)["correct"])
    }

    @Test
    fun `de 1 à 8 équipes, assez de coffres pour finir sur la bombe`() {
        (1..8).forEach { n ->
            val safe = n * safeRounds(n)
            assertTrue(chestCount(n) >= safe + 2, "$n équipes")
            assertTrue(chestCount(n) <= MAX_CHESTS)
        }
    }
}

/** Tirage toujours à 0 (noms de classes en ASCII : certains systèmes de fichiers refusent les accents). */
private class TirageZero : Random() {
    override fun nextBits(bitCount: Int) = 0
}

/** Premier tirage sur 10 = 9 (un malus), puis 0 (le premier malus de la liste). */
private class PremierMalus : Random() {
    private var n = 0
    override fun nextBits(bitCount: Int) = 0
    override fun nextInt(until: Int) = if (n++ == 0) until - 1 else 0
}
