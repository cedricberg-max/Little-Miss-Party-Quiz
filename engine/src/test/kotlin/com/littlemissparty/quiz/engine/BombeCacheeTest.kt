package com.littlemissparty.quiz.engine

import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Les coffres mystères : coffres ouverts chacun son tour, tours sans danger, puis la bombe arrête le jeu. */
class BombeCacheeTest {

    private val t0 = 1_000_000L
    private val quiz = Question("q1", "Capitale ?", listOf("Paris", "Rome"), 0, durationSec = 20, roundTitle = "Quiz")
    private val bombe = Question("b1", "Les Coffres mystères", emptyList(), -1, kind = QuestionKind.COFFRES, roundTitle = "Les Coffres mystères")
    private val apres = Question("q2", "Couleur du ciel ?", listOf("Bleu", "Vert"), 0, durationSec = 20, roundTitle = "Quiz 2")
    private val equipes = listOf("licornes", "dragons")

    /** Tirage qui donne toujours 0 : la bombe dès qu'elle est possible. */
    private val toujoursBombe = TirageZero()

    /** Quiz joué (Licornes 100 et plus, Dragons 0), puis les coffres mystères, présentés puis lancés. */
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
        assertEquals(14, d.count, "6 coffres sans danger, puis 8 coffres fermés quand la bombe arrive")
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
            assertTrue(r.opened.count { it.gold } <= 1, "un seul coffre en or")
            r.opened.filter { it.gold }.forEach { assertEquals(GOLD_POINTS, it.delta) }
            assertTrue(r.opened.take(r.safe).none { it.gold }, "pas de coffre en or pendant les tours sans danger")
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
        assertEquals(premier.at + CHEST_SHOW_MS + CHEST_RANKING_MS, r.readyAt, "l'ouverture, puis le classement")
        assertNull(g.openChest(r.team!!, r.closed.first(), r.readyAt - 1_000), "trop tôt : l'animation n'est pas finie")
        repeat(r.safe - 1) { g.ouvrir() }
        val dernier = g.chestRound!!.opened.last()
        assertTrue(g.chestRound!!.danger)
        assertEquals(dernier.at + CHEST_SHOW_MS + CHEST_RANKING_MS + BOMB_ALERT_MS, g.chestRound!!.readyAt, "le temps de l'annonce")
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
    fun `rejoués depuis la régie, les coffres mystères repartent à zéro sans compter deux fois`() {
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
    fun `la prestation envoyée par la régie se lit, et la commande de secours aussi`() {
        // Exactement ce qu'écrit web/public/show.js pour une manche « Les Coffres mystères » (ou d'anciennes Portes).
        val quiz = QuizJson.parse("""{"id":"p","questions":[{"id":"r1c","text":"Les Coffres mystères","kind":"coffres","choices":[],"correct":-1,"duration":20,"double":false,"round":"Les Coffres mystères"}]}""")
        assertTrue(quiz.questions.single().isCoffres)
        assertEquals("Les Coffres mystères", quiz.questions.single().roundTitle)
        assertEquals(Command.ChestRandom("c", 4), Command.decode("c", mapOf("type" to "chest_random", "expectSeq" to 4)))
    }

    @Test
    fun `de 1 à 8 équipes, la bombe et le coffre en or restent noyés parmi au moins 8 coffres`() {
        // La règle annoncée à cedric le 21/10 : coffres au départ, ouverts sans danger, fermés quand la bombe arrive.
        val attendu = mapOf(2 to Triple(14, 6, 8), 3 to Triple(17, 9, 8), 4 to Triple(16, 8, 8), 5 to Triple(19, 10, 9), 6 to Triple(16, 6, 10), 8 to Triple(20, 8, 12))
        attendu.forEach { (n, t) ->
            assertEquals(t.first, chestCount(n), "coffres au départ, $n équipes")
            assertEquals(t.second, n * safeRounds(n), "ouverts sans danger, $n équipes")
            assertEquals(t.third, chestCount(n) - n * safeRounds(n), "fermés quand la bombe arrive, $n équipes")
        }
        (1..8).forEach { n ->
            assertTrue(chestCount(n) - n * safeRounds(n) >= 8, "$n équipes")
            assertTrue(chestCount(n) <= MAX_CHESTS)
        }
    }

    @Test
    fun `le coffre en or vaut 500, une seule fois, seulement avec la bombe`() {
        // Tirage « 1 » sur les coffres restants : le coffre en or dès qu'il est possible, puis plus jamais.
        val g = partie(intros = false)
        g.dealChests(equipes, t0 + 7_000)
        val r = g.chestRound!!
        repeat(r.safe) { assertFalse(g.ouvrir(TirageUn()).gold, "pas pendant les tours sans danger") }
        val team = g.chestRound!!.team!!
        val avant = g.state.scores()[team] ?: 0
        val or = g.ouvrir(TirageUn())
        assertTrue(or.gold)
        assertFalse(or.bomb)
        assertEquals(GOLD_POINTS, or.delta)
        assertEquals(avant + GOLD_POINTS, g.state.scores()[team])
        assertTrue(g.chestRound!!.goldFound)
        @Suppress("UNCHECKED_CAST")
        val c = Codec.publicState(g)["chests"] as Map<String, Any?>
        assertEquals(false, c["goldLeft"], "les tablettes savent qu'il est trouvé")
        assertEquals(true, (c["opened"] as List<Map<String, Any?>>).last()["gold"])
        val ensuite = g.ouvrir(TirageUn())
        assertFalse(ensuite.gold, "un seul coffre en or")
        // Le journal rejoué garde le coffre en or ; un faux coffre en or (pas 500, ou avant le danger) est refusé.
        val relu = Game(g.quiz, g.events.map { Codec.decode(Codec.encode(it))!! })
        assertEquals(g.chestRound, relu.chestRound)
        val faux = ChestOpened(g.state.lastSeq + 1, t0 + 999_000, "b1", g.chestRound!!.team!!, g.chestRound!!.closed.first(), GOLD_POINTS, bomb = false, gold = true)
        assertFalse(Game(g.quiz, g.events).record(faux), "déjà trouvé")
        val tot = partie(intros = false)
        tot.dealChests(equipes, t0 + 7_000)
        val r0 = tot.chestRound!!
        val avantDanger = ChestOpened(tot.state.lastSeq + 1, r0.readyAt, "b1", r0.team!!, 0, GOLD_POINTS, bomb = false, gold = true)
        assertFalse(tot.record(avantDanger), "pas de coffre en or pendant les tours sans danger")
        repeat(r0.safe) { tot.ouvrir(TirageDeux()) }
        val r1 = tot.chestRound!!
        val pasCinqCents = ChestOpened(tot.state.lastSeq + 1, r1.readyAt, "b1", r1.team!!, r1.closed.first(), 300, bomb = false, gold = true)
        assertFalse(tot.record(pasCinqCents), "le coffre en or vaut toujours 500")
    }

    @Test
    fun `avec la bombe, le coffre en or sort une partie sur deux environ`() {
        var or = 0
        val parties = 400
        repeat(parties) { graine ->
            val random = Random(graine)
            val g = partie(intros = false)
            g.dealChests(equipes, t0 + 7_000)
            while (g.chestRound!!.team != null) g.ouvrir(random)
            if (g.chestRound!!.goldFound) or++
        }
        assertTrue(or in parties * 35 / 100..parties * 65 / 100, "coffre en or trouvé dans $or parties sur $parties")
    }
}

/** Tirage toujours à 0 (noms de classes en ASCII : certains systèmes de fichiers refusent les accents). */
private class TirageZero : Random() {
    override fun nextBits(bitCount: Int) = 0
}

/** Tirage toujours à 1 (sauf quand une seule valeur est possible) : jamais la bombe tant qu'il reste 2 coffres. */
private class TirageUn : Random() {
    override fun nextBits(bitCount: Int) = 0
    override fun nextInt(until: Int) = if (until > 1) 1 else 0
}

/** Tirage toujours à 2 (ou moins) : ni la bombe ni le coffre en or tant qu'il reste 3 coffres. */
private class TirageDeux : Random() {
    override fun nextBits(bitCount: Int) = 0
    override fun nextInt(until: Int) = minOf(2, until - 1)
}

/** Premier tirage sur 10 = 9 (un malus), puis 0 (le premier malus de la liste). */
private class PremierMalus : Random() {
    private var n = 0
    override fun nextBits(bitCount: Int) = 0
    override fun nextInt(until: Int) = if (n++ == 0) until - 1 else 0
}
