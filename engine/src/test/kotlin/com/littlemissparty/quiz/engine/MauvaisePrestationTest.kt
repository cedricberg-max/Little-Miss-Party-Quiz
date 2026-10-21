package com.littlemissparty.quiz.engine

import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Mauvaise prestation lancée (cedric, 21/10) : tant qu'aucun point n'a été donné, la régie la remplace par la bonne,
 * même après l'ouverture de la première question ; la partie repart du salon d'attente, le journal continue.
 */
class MauvaisePrestationTest {

    private val t0 = 1_000_000L
    private fun q(id: String, round: String, correct: Int = 0) =
        Question(id, "Question $id ?", listOf("A", "B"), correct = correct, durationSec = 10, roundTitle = round)

    /** Prestation de Léa, lancée par erreur : un quiz, des mimes. */
    private val lea = Quiz(
        "lea", "L'anniversaire de Léa",
        listOf(
            q("r1q1", "Animaux"), q("r1q2", "Animaux"),
            Question("r2m", "Mimes", emptyList(), -1, durationSec = 60, kind = QuestionKind.MIME, roundTitle = "Mimes", cards = listOf(MimeCard("Chat", "🐱"), MimeCard("Pirate", "🏴‍☠️"))),
        ),
        intros = true,
    )

    /** La bonne prestation, celle de Chloé : mêmes identifiants de questions (deux prestations tirées du même modèle). */
    private val chloe = Quiz("chloe", "L'anniversaire de Chloé", listOf(q("r1q1", "Espace", correct = 1), q("r1q2", "Espace", correct = 1)), intros = true)

    /** Première question de Léa présentée puis lancée, réponses fermées et révélées : personne n'a trouvé. */
    private fun leaSansPoint(): Game = Game(lea).apply {
        next(t0)
        assertTrue(state.intro)
        next(t0 + 1_000)
        close(t0 + 3_000)
        next(t0 + 4_000, mapOf("rose" to Answer(1, t0 + 2_000)))
        assertEquals(Phase.REVEAL, state.phase)
        assertEquals(mapOf("rose" to 0), state.scores())
    }

    @Test
    fun `première question commencée sans point, la partie repart du salon et la numérotation continue`() {
        val g = leaSansPoint()
        assertTrue(g.mayReplaceProgram())
        assertNull(Codec.publicState(g)["scored"], "la régie peut proposer « Mauvaise prestation ? »")
        val avant = g.state.lastSeq
        val reset = assertIs<ProgramReset>(g.resetProgram(t0 + 5_000))
        assertEquals(avant + 1, reset.seq, "le numéro d'étape continue : la régie ne voit jamais un ancien numéro")
        // La box rouvre la partie avec la bonne prestation, sur le journal tel qu'il est.
        val bonne = Game(chloe, g.events)
        assertEquals(Phase.LOBBY, bonne.state.phase)
        assertEquals(-1, bonne.state.index)
        assertFalse(bonne.state.intro)
        assertEquals(emptyMap(), bonne.state.scores())
        assertEquals(reset.seq, bonne.state.lastSeq)
        assertEquals(listOf<GameEvent>(reset), bonne.events, "l'ancien programme est oublié")
        // La fête démarre ensuite normalement, sur la prestation de Chloé, avec des points.
        assertEquals(reset.seq + 1, assertNotNull(bonne.next(t0 + 6_000)).seq)
        assertTrue(bonne.state.intro)
        assertEquals("r1q1", bonne.state.qid)
        bonne.next(t0 + 7_000)
        bonne.close(t0 + 9_000)
        bonne.next(t0 + 10_000, mapOf("rose" to Answer(1, t0 + 8_000)))
        assertTrue(bonne.state.scores().getValue("rose") > 0)
        assertFalse(bonne.mayReplaceProgram())
        assertNull(bonne.resetProgram(t0 + 11_000), "après un point, la prestation ne change plus")
        assertEquals(true, Codec.publicState(bonne)["scored"])
    }

    @Test
    fun `pendant la présentation du premier jeu, ou en pause, le remplacement est possible`() {
        val g = Game(lea).apply { next(t0) }
        assertTrue(g.state.intro)
        assertNotNull(g.resetProgram(t0 + 1_000))
        assertEquals(Phase.LOBBY, g.state.phase)
        val h = Game(lea).apply { next(t0); next(t0 + 1_000); pause(t0 + 2_000) }
        assertTrue(h.state.paused)
        assertNotNull(h.resetProgram(t0 + 3_000))
        assertFalse(h.state.paused)
    }

    /** Tirage toujours à 1 : un coffre bonus pendant les tours sans danger. */
    private val bonus = object : Random() {
        override fun nextBits(bitCount: Int) = 0
        override fun nextInt(until: Int) = if (until > 1) 1 else 0
    }

    /** Premier tirage sur 10 = 9 (un malus), puis le premier malus de la liste. */
    private val malus = object : Random() {
        private var n = 0
        override fun nextBits(bitCount: Int) = 0
        override fun nextInt(until: Int) = if (n++ == 0) until - 1 else 0
    }

    private val equipes = listOf("rose", "bleu")

    /** Partie d'un seul jeu ([question]), ouvert, puis jouée par [jouer]. */
    private fun seul(question: Question, jouer: Game.() -> Unit): Game =
        Game(Quiz("p", "P", listOf(question))).apply { next(t0); jouer() }

    @Test
    fun `chaque façon de donner un point bloque le remplacement`() {
        val cas = mapOf(
            "bonne réponse au quiz" to seul(q("a", "Quiz")) { close(t0 + 2_000); next(t0 + 3_000, mapOf("rose" to Answer(0, t0 + 1_000))) },
            "bonus de la régie, même annulé" to seul(q("a", "Quiz")) { val e = adjust("rose", 10, "régie", t0 + 1_000)!!; undo(e.seq, t0 + 2_000) },
            "malus de la régie" to seul(q("a", "Quiz")) { adjust("rose", -10, "régie", t0 + 1_000) },
            "points à la télécommande" to seul(q("a", "Quiz")) { remotePoints("rose", 50, t0 + 1_000) },
            "statues musicales" to seul(Question("s", "Statues", emptyList(), -1, durationSec = 90, kind = QuestionKind.STATUES)) {
                statuesWin("rose", listOf("bleu"), t0 + 30_000)
            },
            "gonfleur fou" to seul(Question("g", "Gonfleur", emptyList(), -1, durationSec = 45, kind = QuestionKind.GONFLEUR)) {
                balloon(mapOf("rose" to Pump(PUMP_TARGET, t0 + PUMP_GO_MS + 5_000)), equipes, t0 + PUMP_GO_MS + 5_000, stop = false)
            },
            "ça va exploser" to seul(Question("p", "Bombe", emptyList(), -1, kind = QuestionKind.PATATE)) {
                val lit = lightPotato(equipes, t0 + 1_000, Random(3)) as PotatoLit
                explode(t0 + 1_000 + POTATO_GO_MS + lit.fuseMs + 10)
            },
            "coffre mystère" to seul(Question("c", "Coffres", emptyList(), -1, kind = QuestionKind.COFFRES)) {
                dealChests(equipes, t0 + 1_000)
                val r = chestRound!!
                val ouvert = assertIs<ChestOpened>(openChest(r.team!!, r.closed.first(), r.readyAt, bonus))
                assertTrue(ouvert.delta > 0)
            },
            "mime trouvé" to seul(lea.questions[2]) { mimeStart("rose", t0 + 1_000); mimeFound(t0 + 2_000) },
            "mime corrigé par la régie" to seul(lea.questions[2]) { mimeStart("rose", t0 + 1_000); mimeStop(t0 + 2_000); mimeFix("rose", 1, t0 + 3_000) },
            "image floue" to seul(Question("f", "Flou", listOf("Un lion", "Un chat"), 0, durationSec = 40, kind = QuestionKind.FLOU, imageId = "photo")) {
                buzz("rose", t0 + 5_000); judgeBuzz(true, t0 + 6_000)
            },
        )
        for ((nom, g) in cas) {
            assertTrue(g.state.scored, "$nom : point compté")
            assertFalse(g.mayReplaceProgram(), "$nom : remplacement refusé")
            val avant = g.state
            assertNull(g.resetProgram(t0 + 100_000), nom)
            assertEquals(avant, g.state, "$nom : partie intacte")
        }
    }

    @Test
    fun `un coffre malus sans effet (équipe à zéro) ou une question sans bonne réponse ne comptent pas comme un point`() {
        val g = seul(Question("c", "Coffres", emptyList(), -1, kind = QuestionKind.COFFRES)) { dealChests(equipes, t0 + 1_000) }
        val r = g.chestRound!!
        assertEquals(0, assertIs<ChestOpened>(g.openChest(r.team!!, r.closed.first(), r.readyAt, malus)).delta)
        assertTrue(g.mayReplaceProgram())
        assertTrue(leaSansPoint().mayReplaceProgram())
    }

    @Test
    fun `jamais après la fin de la partie`() {
        val g = Game(lea).apply { next(t0); end(t0 + 1_000) }
        assertFalse(g.mayReplaceProgram())
        assertNull(g.resetProgram(t0 + 2_000))
        assertEquals(Phase.ENDED, g.state.phase)
    }

    @Test
    fun `le journal relu ignore tout ce qui précède la dernière remise à zéro`() {
        val g = leaSansPoint()
        g.resetProgram(t0 + 5_000)
        val vue = Game(chloe, g.events)
        vue.next(t0 + 6_000)
        vue.next(t0 + 7_000)
        // Journal complet de la partie, tel que Firebase le garde (événements de Léa compris), relu par une box redémarrée.
        val avantRemise = Game(lea).also { r -> leaSansPoint().events.forEach { r.record(it) } }.events
        val journal = avantRemise + vue.events
        val relue = Game(chloe, journal.shuffled(Random(7)))
        assertEquals(vue.state, relue.state)
        assertEquals(emptyMap(), relue.state.scores())
        assertEquals(vue.events, relue.events)
        // « Recommencer » le premier jeu de Chloé : il n'a été ouvert qu'une fois depuis la remise à zéro.
        val saut = assertIs<Jumped>(relue.goto(0, t0 + 8_000))
        assertEquals(listOf("r1q1", "r1q2"), saut.clear, "le jeu en cours repart, sans compter deux fois")
    }

    @Test
    fun `une deuxième remise à zéro, puis une vraie partie`() {
        val g = leaSansPoint()
        g.resetProgram(t0 + 5_000)
        val b = Game(chloe, g.events)
        b.next(t0 + 6_000)
        val second = assertIs<ProgramReset>(b.resetProgram(t0 + 7_000))
        val c = Game(lea, b.events)
        assertEquals(Phase.LOBBY, c.state.phase)
        assertEquals(second.seq, c.state.lastSeq)
        assertEquals(listOf<GameEvent>(second), c.events)
        c.next(t0 + 8_000); c.next(t0 + 9_000); c.close(t0 + 10_000)
        c.next(t0 + 11_000, mapOf("rose" to Answer(0, t0 + 9_500)))
        assertTrue(c.state.scores().getValue("rose") > 0)
        val journal = g.events.dropLast(1) + b.events.dropLast(1) + c.events
        assertEquals(c.state, Game(lea, journal).state, "relu depuis la dernière remise à zéro")
    }

    @Test
    fun `la remise à zéro survit à l'aller-retour Firebase`() {
        val e = ProgramReset(12, t0)
        assertEquals(mapOf("seq" to 12, "at" to t0, "type" to "reset"), Codec.encode(e))
        assertEquals(e, Codec.decode(mapOf("seq" to 12L, "at" to t0, "type" to "reset")))
    }
}
