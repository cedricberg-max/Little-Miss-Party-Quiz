package com.littlemissparty.quiz.engine

import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** « Ça va exploser ! » : la bombe passe de tablette en tablette, la mèche cachée décide de l'explosion. */
class PatateTest {

    private val t0 = 1_000_000L
    private val quiz = Question("q1", "Capitale ?", listOf("Paris", "Rome"), 0, durationSec = 20, roundTitle = "Quiz")
    private val patate = Question("p1", "Ça va exploser !", emptyList(), -1, kind = QuestionKind.PATATE, roundTitle = "Ça va exploser !")
    private val apres = Question("q2", "Couleur du ciel ?", listOf("Bleu", "Vert"), 0, durationSec = 20, roundTitle = "Quiz 2")
    private val trois = listOf("licornes", "dragons", "pandas")

    /** Quiz joué (Licornes 100 et plus), puis « Ça va exploser ! » présenté et lancé. */
    private fun partie(): Game = Game(Quiz("p", "P", listOf(quiz, patate, apres), intros = true)).apply {
        next(t0)
        next(t0 + 100)
        close(t0 + 2_000)
        next(t0 + 3_000, mapOf("licornes" to Answer(0, t0 + 1_000)))
        next(t0 + 4_000)
        next(t0 + 5_000)
        assertEquals("p1", question?.id)
        assertTrue(!needsPotato(), "rien avant le lancement de l'animatrice")
        next(t0 + 6_000)
        assertTrue(needsPotato())
    }

    private fun Game.allumer(equipes: List<String> = trois, random: Random = Random(3)): PotatoLit =
        lightPotato(equipes, t0 + 7_000, random) as PotatoLit

    private val go = t0 + 7_000 + POTATO_GO_MS

    /**
     * Les équipes se renvoient la bombe 500 ms après la mèche qui colle (jamais plus de 3 secondes chez elles) ; la
     * dernière la reçoit au plus tard [jusqua] − [POTATO_STICKY_MS] : à [jusqua], elle peut l'envoyer et ne l'a pas
     * gardée trop longtemps.
     */
    private fun Game.fairePasser(jusqua: Long) {
        while (true) {
            val p = state.potato!!
            val t = p.readyAt + 500
            if (t + POTATO_STICKY_MS > jusqua) return
            assertNotNull(passPotato(p.holder, p.targets.first(), t))
        }
    }

    @Test
    fun `la mèche s'allume en secret, la bombe colle 2 secondes, puis passe sans retour à l'envoyeur`() {
        val g = partie()
        val lit = g.allumer()
        assertTrue(lit.fuseMs in POTATO_FUSE_MIN_MS..POTATO_FUSE_MAX_MS)
        assertNull(g.lightPotato(trois, t0 + 7_100), "une seule mèche")
        val publie = Codec.publicState(g)
        assertNull(publie["deadline"], "la mèche reste secrète")
        assertNull(publie["durationMs"])
        val porteur = lit.holder
        val autres = trois - porteur
        assertNull(g.passPotato(porteur, autres[0], go - 500), "pas avant le départ")
        assertNull(g.passPotato(porteur, autres[0], go + 1_000), "la mèche colle encore")
        assertNull(g.passPotato(autres[0], autres[1], go + 3_000), "seule l'équipe qui tient la bombe l'envoie")
        assertNull(g.passPotato(porteur, porteur, go + 3_000))
        val e = g.passPotato(porteur, autres[0], go + 3_000) as PotatoPassed
        assertEquals(autres[0], g.state.potato!!.holder)
        assertEquals(e.at, g.state.potato!!.since)
        assertEquals(listOf(autres[1]), g.state.potato!!.targets, "pas de retour à l'envoyeur à 3 équipes")
        assertNull(g.passPotato(autres[0], porteur, go + 6_000))
        assertNotNull(g.passPotato(autres[0], autres[1], go + 6_000))
        assertEquals(trois.toSet(), g.state.potato!!.hit, "tout le monde l'a eue")
        assertEquals(2, g.state.potato!!.passes)
    }

    @Test
    fun `à 2 équipes la bombe repart chez l'envoyeur, seule la mèche qui colle compte`() {
        val g = partie()
        val lit = g.allumer(listOf("licornes", "dragons"))
        val autre = if (lit.holder == "licornes") "dragons" else "licornes"
        g.passPotato(lit.holder, autre, go + 2_500)
        assertEquals(listOf(lit.holder), g.state.potato!!.targets)
        assertNull(g.passPotato(autre, lit.holder, go + 3_000), "colle encore")
        assertNotNull(g.passPotato(autre, lit.holder, go + 5_000))
    }

    @Test
    fun `l'explosion à la fin de la mèche coûte des points à l'équipe qui tient la bombe, les autres en gagnent`() {
        val g = partie()
        val avant = g.state.scores()
        val lit = g.allumer()
        val fin = go + lit.fuseMs
        assertNotNull(g.deadline())
        assertEquals(fin, g.deadline())
        g.fairePasser(fin)
        val porteur = g.state.potato!!.holder
        assertEquals(fin, g.wakeAt(), "la bombe a toujours été renvoyée à temps : c'est la mèche qui décide")
        assertNull(g.explode(fin - 1_000), "pas avant la fin")
        assertNull(g.next(fin - 1_000), "le bouton principal ne fait pas exploser la bombe")
        val boom = g.timeUp(fin) as PotatoExploded
        assertEquals(porteur, boom.holder)
        assertTrue(!g.state.potato!!.booms.single().held, "au bout de la mèche")
        assertEquals(Phase.QUESTION, g.state.phase, "deux autres bombes à venir")
        val awards = g.state.awards["p1"]!!
        trois.filter { it != porteur }.forEach { assertEquals(POTATO_POINTS, awards[it]!!.points) }
        assertEquals(-minOf(POTATO_POINTS, avant[porteur] ?: 0), awards[porteur]!!.points, "jamais sous 0")
        assertTrue(g.state.scores().values.all { it >= 0 })
        assertNull(g.passPotato(porteur, g.state.potato!!.targets.first(), fin + 100), "plus rien ne passe")
        assertNull(g.explode(fin + 100), "elle n'explose qu'une fois")
        assertNull(g.deadline(), "plus de mèche entre deux bombes")
        assertNull(Codec.potatoKey(g), "les tablettes n'envoient plus rien")
    }

    @Test
    fun `trois bombes par partie, les points s'ajoutent, puis le bilan`() {
        repeat(30) { graine ->
            val random = Random(graine)
            val g = partie()
            val avant = g.state.scores()
            var t = t0 + 7_000
            val perdants = mutableListOf<String>()
            for (n in 1..POTATO_BOMBS) {
                assertTrue(g.needsPotato(), "bombe $n à allumer")
                val lit = g.lightPotato(trois, t, random) as PotatoLit
                assertEquals(n, lit.bomb)
                assertNull(g.lightPotato(trois, t + 10, random), "une seule mèche à la fois")
                // La bombe suivante ne repart jamais de l'équipe chez qui la précédente vient d'exploser.
                if (n > 1) assertTrue(lit.holder != perdants.last(), "partie $graine")
                val depart = t + if (n == 1) POTATO_GO_MS else POTATO_NEXT_MS
                assertEquals(depart, g.state.potato!!.since, "l'explosion et l'annonce avant de repartir")
                assertNull(g.passPotato(lit.holder, (trois - lit.holder).first(), depart - 1_000), "pas pendant l'annonce")
                val fin = depart + lit.fuseMs
                assertEquals(fin, g.deadline())
                g.fairePasser(fin)
                val boom = g.timeUp(fin) as PotatoExploded
                perdants += boom.holder
                assertEquals(n, g.state.potato!!.booms.size)
                t = fin + 50
            }
            assertEquals(Phase.REVEAL, g.state.phase, "le bilan après la troisième bombe")
            assertTrue(!g.needsPotato(), "jamais de quatrième bombe")
            assertNull(g.lightPotato(trois, t + 1_000, random))
            // Chaque équipe : +100 par bombe chez les autres, −100 (réduit au score) par bombe chez elle.
            val gains = g.gameGains()
            trois.forEach { e ->
                val ailleurs = perdants.count { it != e } * POTATO_POINTS
                assertTrue(gains[e]!! <= ailleurs, "partie $graine, $e")
                assertEquals((g.state.scores()[e] ?: 0) - (avant[e] ?: 0), gains[e] ?: 0)
            }
            assertTrue(g.state.scores().values.all { it >= 0 }, "jamais sous 0")
            assertTrue(trois.all { (gains[it] ?: 0) <= POTATO_BOMBS * POTATO_POINTS }, "au plus 300 sur la partie")
            val relu = Game(g.quiz, g.events.map { Codec.decode(Codec.encode(it))!! })
            assertEquals(g.state, relu.state, "partie $graine relue à l'identique")
            g.next(t + 5_000)
            assertEquals(Phase.SCORES, g.state.phase)
            g.next(t + 6_000)
            assertEquals("q2", g.question?.id, "le jeu suivant s'enchaîne")
        }
    }

    @Test
    fun `l'état publié dit quelle bombe et où elles ont explosé, jamais la mèche`() {
        val g = partie()
        val lit = g.allumer()
        @Suppress("UNCHECKED_CAST")
        fun etat() = Codec.publicState(g)["potato"] as Map<String, Any?>
        assertEquals(1, etat()["bomb"])
        assertEquals(POTATO_BOMBS, etat()["bombs"])
        assertEquals(false, etat()["exploded"])
        assertEquals(go, etat()["burnFrom"])
        // Une pause de 30 s : la mèche a brûlé 10 s, elle repart comme si elle avait été allumée 10 s avant la reprise.
        g.pause(go + 10_000)
        assertNull(etat()["burnFrom"], "en pause, rien ne bat")
        g.resume(go + 40_000)
        assertEquals(g.state.resumeAt!! - 10_000, etat()["burnFrom"])
        g.timeUp(go + 30_000 + lit.fuseMs + 60_000)
        assertEquals(true, etat()["exploded"])
        @Suppress("UNCHECKED_CAST")
        val booms = etat()["booms"] as List<Map<String, Any?>>
        assertEquals(lit.holder, booms.single()["holder"])
        assertNull(etat()["burnFrom"], "entre deux bombes, rien ne bat")
        g.lightPotato(trois, go + lit.fuseMs + 100_000, Random(1))
        assertEquals(2, etat()["bomb"])
        assertEquals(false, etat()["exploded"])
        assertEquals(1, (etat()["booms"] as List<*>).size, "l'explosion précédente reste connue")
        assertNull(Codec.publicState(g)["deadline"], "la mèche reste secrète")
        // Une bombe en trop ou hors d'ordre est refusée.
        val g2 = partie()
        assertTrue(!g2.record(PotatoLit(g2.state.lastSeq + 1, t0 + 7_000, "p1", "licornes", POTATO_FUSE_MIN_MS, trois, bomb = 2)))
    }

    @Test
    fun `un envoi parti juste avant l'explosion compte, et la pause arrête la mèche`() {
        val g = partie()
        val lit = g.allumer()
        val fin = go + lit.fuseMs
        g.fairePasser(fin - 200)
        val porteur = g.state.potato!!.holder
        val cible = g.state.potato!!.targets.first()
        // Écrit 200 ms avant la fin, reçu 300 ms après : l'équipe s'en est débarrassée à temps.
        assertNotNull(g.passPotato(porteur, cible, fin + 300, sentAt = fin - 200))
        assertEquals(cible, g.state.potato!!.holder)
        val g2 = partie()
        val lit2 = g2.allumer()
        g2.pause(go + 10_000)
        assertNull(g2.passPotato(lit2.holder, (trois - lit2.holder).first(), go + 15_000), "en pause, rien ne passe")
        assertNull(g2.explode(go + lit2.fuseMs + 5_000), "la mèche ne brûle pas en pause")
        g2.resume(go + 60_000)
        assertNull(g2.passPotato(lit2.holder, (trois - lit2.holder).first(), go + 60_500), "décompte de reprise")
        assertEquals(lit2.fuseMs - 10_000, g2.remainingMs(g2.state.resumeAt!!))
    }

    @Test
    fun `bombe gardée plus de 3 secondes, elle explose chez l'équipe avant la fin de la mèche, même pénalité`() {
        val g = partie()
        val avant = g.state.scores()
        val lit = g.allumer()
        val limite = go + POTATO_STICKY_MS + POTATO_HOLD_MS
        assertEquals(limite, g.holdDeadline())
        assertEquals(limite, g.wakeAt(), "la box se réveille pour la faire exploser")
        assertEquals(go + lit.fuseMs, g.deadline(), "la mèche, elle, ne change pas")
        @Suppress("UNCHECKED_CAST")
        fun etat() = Codec.publicState(g)["potato"] as Map<String, Any?>
        assertEquals(limite, etat()["holdUntil"], "la tablette compte 3, 2, 1 jusque-là")
        assertNull(Codec.publicState(g)["deadline"], "la mèche reste secrète")
        assertNull(g.explode(limite - 100), "encore 100 ms pour l'envoyer")
        // Écrit avant la limite, reçu après : il compte. Écrit après : refusé.
        val g2 = partie()
        val lit2 = g2.allumer()
        assertNotNull(g2.passPotato(lit2.holder, (trois - lit2.holder).first(), limite + 300, sentAt = limite - 100))
        assertNull(g.passPotato(lit.holder, (trois - lit.holder).first(), limite + 300, sentAt = limite + 50))
        val boom = g.timeUp(limite) as PotatoExploded
        assertEquals(lit.holder, boom.holder)
        assertTrue(g.state.potato!!.booms.single().held, "gardée trop longtemps")
        val awards = g.state.awards["p1"]!!
        trois.filter { it != lit.holder }.forEach { assertEquals(POTATO_POINTS, awards[it]!!.points) }
        assertEquals(-minOf(POTATO_POINTS, avant[lit.holder] ?: 0), awards[lit.holder]!!.points)
        @Suppress("UNCHECKED_CAST")
        assertEquals(true, (etat()["booms"] as List<Map<String, Any?>>).single()["held"])
        assertNull(etat()["holdUntil"])
        assertTrue(g.needsPotato(), "la bombe suivante s'allume, avec une nouvelle mèche")
        val relu = Game(g.quiz, g.events.map { Codec.decode(Codec.encode(it))!! })
        assertEquals(g.state, relu.state, "relue à l'identique")
    }

    @Test
    fun `chaque réception redonne 3 secondes, une pause aussi (tablette coupée, jamais la faute de l'équipe)`() {
        val g = partie()
        val lit = g.allumer()
        val cible = (trois - lit.holder).first()
        assertNotNull(g.passPotato(lit.holder, cible, go + 4_000))
        assertEquals(go + 4_000 + POTATO_STICKY_MS + POTATO_HOLD_MS, g.holdDeadline())
        // Pause 1 s avant la limite : rien n'explose ; à la reprise, 3 secondes après la fin du décompte.
        g.pause(go + 8_000)
        assertNull(g.holdDeadline())
        assertNull(g.explode(go + 20_000))
        g.resume(go + 30_000)
        val reprise = g.state.resumeAt!!
        assertEquals(reprise + POTATO_HOLD_MS, g.holdDeadline())
        assertNull(g.explode(reprise + POTATO_HOLD_MS - 100))
        val boom = g.timeUp(reprise + POTATO_HOLD_MS) as PotatoExploded
        assertEquals(cible, boom.holder)
        assertTrue(g.state.potato!!.booms.single().held)
    }

    @Test
    fun `secours de la régie, rejeu, et journal relu à l'identique`() {
        val g = partie()
        val lit = g.allumer()
        val res = g.execute(Command.PotatoRandom("c1", g.state.lastSeq), go + 2_500, trois.toSet())
        assertEquals(CommandStatus.APPLIED, res.status)
        assertTrue((res.event as PotatoPassed).to != lit.holder)
        val relu = Game(g.quiz, g.events.map { Codec.decode(Codec.encode(it))!! })
        assertEquals(g.state, relu.state)
        val avant = g.state.scores()
        g.timeUp(go + lit.fuseMs)
        assertNotNull(g.goto(1, go + 90_000))
        assertEquals(avant, g.state.scores(), "les points de la patate ne comptent plus")
        assertNull(g.state.potato, "nouvelle mèche à allumer")
        g.next(go + 91_000)
        assertTrue(g.needsPotato())
        val q = QuizJson.parse("""{"id":"p","questions":[{"id":"r1p","text":"Ça va exploser !","kind":"patate","choices":[],"correct":-1,"duration":40,"double":false,"round":"Ça va exploser !"}]}""")
        assertTrue(q.questions.single().isPatate)
    }
}
