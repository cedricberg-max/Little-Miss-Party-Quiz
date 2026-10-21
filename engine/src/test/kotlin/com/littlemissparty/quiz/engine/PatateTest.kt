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
        assertNull(g.explode(fin - 1_000), "pas avant la fin")
        assertNull(g.next(fin - 1_000), "le bouton principal ne fait pas exploser la bombe")
        val boom = g.timeUp(fin) as PotatoExploded
        assertEquals(lit.holder, boom.holder)
        assertEquals(Phase.REVEAL, g.state.phase)
        val awards = g.state.awards["p1"]!!
        trois.filter { it != lit.holder }.forEach { assertEquals(POTATO_POINTS, awards[it]!!.points) }
        assertEquals(-minOf(POTATO_POINTS, avant[lit.holder] ?: 0), awards[lit.holder]!!.points, "jamais sous 0")
        assertTrue(g.state.scores().values.all { it >= 0 })
        assertNull(g.passPotato(lit.holder, (trois - lit.holder).first(), fin + 100), "plus rien ne passe")
        g.next(fin + 5_000)
        assertEquals(Phase.SCORES, g.state.phase)
        g.next(fin + 6_000)
        assertEquals("q2", g.question?.id, "le jeu suivant s'enchaîne")
    }

    @Test
    fun `un envoi parti juste avant l'explosion compte, et la pause arrête la mèche`() {
        val g = partie()
        val lit = g.allumer()
        val fin = go + lit.fuseMs
        val cible = (trois - lit.holder).first()
        // Écrit 200 ms avant la fin, reçu 300 ms après : l'équipe s'en est débarrassée à temps.
        assertNotNull(g.passPotato(lit.holder, cible, fin + 300, sentAt = fin - 200))
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
