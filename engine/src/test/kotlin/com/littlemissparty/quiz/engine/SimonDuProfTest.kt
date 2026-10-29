package com.littlemissparty.quiz.engine

import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 🔴 Le Simon du Prof : une suite qui grandit, une erreur élimine du tour, la dernière équipe en jeu le gagne. */
class SimonDuProfTest {

    private val simon = Question("s1", "Le Simon du Prof", emptyList(), -1, kind = QuestionKind.SIMON, roundTitle = "Le Simon du Prof", joueurs = 2, simonTours = 2)
    private val quiz = Question("q1", "Capitale ?", listOf("Paris", "Rome"), 0, durationSec = 20, roundTitle = "Quiz")
    private val t0 = 1_000_000L
    private val equipes = listOf("orange", "vert", "rose")

    private fun cmd(g: Game, type: String) = Command.decode("c${g.state.lastSeq}", mapOf("type" to type, "expectSeq" to g.state.lastSeq))!!

    private fun Game.run(type: String, at: Long, teams: Set<String> = equipes.toSet()) = execute(cmd(this, type), at, teams, random = Random(7))

    private fun relu(g: Game) = Game(g.quiz).apply { g.events.forEach { record(Codec.decode(Codec.encode(it))!!) } }

    /** Jeu lancé, premier tour prêt entre les [teams]. */
    private fun pret(teams: List<String> = equipes, questions: List<Question> = listOf(simon, quiz)): Game =
        Game(Quiz("p", "P", questions)).apply {
            next(t0)
            assertTrue(needsSimon())
            assertNotNull(readySimon(teams, t0, Random(1)))
            assertFalse(needsSimon())
        }

    /** « ▶ » de Sarah : lance la suite prête à [at] ; renvoie l'heure où le chrono part. */
    private fun Game.lance(at: Long): Long {
        assertEquals(CommandStatus.APPLIED, run("simon_go", at).status)
        return state.simon!!.reponseAt!!
    }

    /** Ce que tape une équipe : la bonne suite, ou une erreur au rang [erreur] (à partir de 0), validée en [ms]. */
    private fun Game.tape(erreur: Int? = null, ms: Long? = 3_000): SimonAnswer {
        val bonne = state.simon!!.solution
        val items = if (erreur == null) bonne else bonne.take(erreur) + SIMON_ELEMENTS.first { it != bonne[erreur] }
        return SimonAnswer(items, ms)
    }

    /** Suite lancée puis jugée avec les [reponses] à la fin du chrono. */
    private fun Game.joue(at: Long, reponses: Game.() -> Map<String, SimonAnswer>): SimonVerdict {
        lance(at)
        val fin = simonJugeAt()!!
        assertEquals(fin, wakeAt(), "la box se réveille à la fin du chrono pour juger")
        assertNotNull(judgeSimon(reponses(), fin))
        return state.simon!!.verdict!!
    }

    @Test
    fun `la suite secrete n'a que des boules de couleur, jamais deux fois le meme element de suite`() {
        assertFalse(SIMON_AVEC_CHIFFRES, "plus de chiffres dans le Simon (cedric, 29/10)")
        repeat(50) { graine ->
            val s = suiteSimon(random = Random(graine))
            assertEquals(SIMON_LONGUEUR_MAX, s.size)
            assertTrue(s.all { it in SIMON_COULEURS }, "que des couleurs : $s")
            assertTrue(s.zipWithNext().none { (a, b) -> a == b }, "jamais deux fois de suite : $s")
            assertTrue(s.all { it in SIMON_ELEMENTS })
        }
        assertEquals(10_000L, reponseMs(1, SIMON_REPONSE_SEC))
        assertEquals(10_000L, reponseMs(4, SIMON_REPONSE_SEC))
        assertEquals(14_000L, reponseMs(8, SIMON_REPONSE_SEC), "une seconde de plus par élément au-delà de 4")
        assertEquals(SIMON_REPONSE_MIN_SEC * 1_000L, reponseMs(1, 1), "temps ramené dans les limites")
    }

    @Test
    fun `le premier tour se prepare au lancement, la suite reste secrete, pas de chrono`() {
        val g = pret()
        val r = g.state.simon!!
        assertEquals(1, r.tour)
        assertEquals(equipes, r.teams)
        assertEquals(1, r.prochaine)
        assertNull(g.deadline())
        assertNull(g.wakeAt())
        val pub = Codec.publicState(g, teams = equipes)
        assertNull(pub["durationMs"])
        assertNull(pub["deadline"])
        val etat = pub["simon"] as Map<*, *>
        assertEquals("ready", etat["step"])
        assertEquals(1, etat["tour"])
        assertEquals(2, etat["tours"])
        assertEquals(mapOf("orange" to 1, "vert" to 1, "rose" to 1), etat["players"], "le joueur n° 1 de chaque équipe")
        assertNull(etat["key"])
        assertFalse(pub.toString().contains(r.sequence.joinToString(",")), "la suite n'est jamais publiée avant le bilan")
    }

    @Test
    fun `la suite se montre boule par boule puis le chrono part, jamais de jugement avant`() {
        val g = pret()
        val chrono = g.lance(t0 + 5_000)
        val r = g.state.simon!!
        assertEquals(t0 + 5_000 + SIMON_REGARDEZ_MS, r.montreAt)
        assertEquals(r.montreAt!! + SIMON_PAS_MS, chrono, "une boule pour la suite n° 1")
        assertEquals(chrono + 10_000, g.simonJugeAt())
        assertFalse(g.simonReponse(chrono - 500))
        assertTrue(g.simonReponse(chrono))
        assertNull(g.judgeSimon(emptyMap(), chrono - 1_000), "personne ne peut répondre pendant que le robot montre")
        val etat = Codec.publicState(g, teams = equipes)["simon"] as Map<*, *>
        assertEquals("play", etat["step"])
        assertNotNull(etat["key"])
        assertEquals(chrono, etat["reponseAt"])
        assertEquals(chrono + 10_000, etat["finAt"])
        assertNull(etat["verdict"])
        assertNull(g.next(chrono), "pas de « Jeu suivant » pendant une suite")
    }

    @Test
    fun `une erreur elimine du tour, la derniere equipe en jeu gagne le tour et ses points`() {
        val g = pret()
        val v1 = g.joue(t0) { mapOf("orange" to tape(), "vert" to tape(), "rose" to tape(erreur = 0)) }
        assertEquals(listOf("rose"), v1.wrong)
        assertTrue(v1.winners.isEmpty())
        assertEquals(mapOf("rose" to 1), g.state.simon!!.out)
        assertEquals(2, g.state.simon!!.prochaine, "la suite suivante a un élément de plus")
        // Une équipe éliminée ne joue plus : sa réponse ne compte pas.
        val v2 = g.joue(t0 + 30_000) { mapOf("orange" to tape(), "vert" to tape(erreur = 1), "rose" to tape()) }
        assertEquals(2, v2.suite)
        assertEquals(listOf("orange"), v2.winners)
        assertEquals(SIMON_POINTS, v2.points)
        assertTrue(g.state.simon!!.fini)
        assertEquals(SIMON_POINTS, g.state.scores()["orange"])
        assertEquals(null, g.state.scores()["rose"])
        val etat = Codec.publicState(g, teams = equipes)["simon"] as Map<*, *>
        assertEquals("won", etat["step"])
        val verdict = etat["verdict"] as Map<*, *>
        assertEquals(g.state.simon!!.sequence.take(2).joinToString(","), verdict["solution"], "la bonne suite, pour la vérification")
        assertEquals(listOf("orange"), verdict["winners"])
        assertEquals(g.state, relu(g).state, "le journal relu redonne la même partie")
    }

    @Test
    fun `une equipe qui n'a rien tape ou pas fini est eliminee`() {
        val g = pret()
        val v = g.joue(t0) { mapOf("orange" to tape(), "vert" to SimonAnswer(emptyList(), null)) }
        assertEquals(setOf("vert", "rose"), v.wrong.toSet(), "rose n'a rien envoyé")
        assertEquals(listOf("orange"), v.winners)
    }

    @Test
    fun `une bonne suite tapee sans valider compte quand meme`() {
        val g = pret(listOf("orange", "vert"))
        val v = g.joue(t0) { mapOf("orange" to tape(ms = null), "vert" to tape(erreur = 0)) }
        assertEquals(listOf("orange"), v.winners)
    }

    @Test
    fun `toutes en erreur des la premiere suite, bah alors, personne ne sort et la meme suite se rejoue`() {
        val g = pret()
        val v = g.joue(t0) { equipes.associateWith { tape(erreur = 0) } }
        assertTrue(v.bahAlors)
        assertTrue(v.wrong.isEmpty())
        assertTrue(v.winners.isEmpty())
        assertTrue(g.state.simon!!.out.isEmpty())
        assertEquals(1, g.state.simon!!.prochaine)
        assertEquals(true, ((Codec.publicState(g, teams = equipes)["simon"] as Map<*, *>)["verdict"] as Map<*, *>)["bahAlors"])
        g.lance(t0 + 30_000)
        assertEquals(1, g.state.simon!!.suite)
    }

    @Test
    fun `toutes en erreur sur une suite plus longue, la plus avancee gagne, a egalite la plus rapide`() {
        val g = pret()
        g.joue(t0) { equipes.associateWith { tape() } }
        g.joue(t0 + 30_000) { equipes.associateWith { tape() } }
        // Suite n° 3 : orange se trompe au 3e élément, vert et rose au 2e ; orange gagne.
        val v3 = g.joue(t0 + 60_000) { mapOf("orange" to tape(erreur = 2), "vert" to tape(erreur = 1), "rose" to tape(erreur = 1)) }
        assertEquals(listOf("orange"), v3.winners)
        assertEquals(setOf("vert", "rose"), v3.wrong.toSet())

        val h = pret()
        h.joue(t0) { equipes.associateWith { tape() } }
        val v = h.joue(t0 + 30_000) { mapOf("orange" to tape(erreur = 1, ms = 4_000), "vert" to tape(erreur = 1, ms = 2_500), "rose" to tape(erreur = 0, ms = 1_000)) }
        assertEquals(listOf("vert"), v.winners, "même avancée : la plus rapide à valider")
    }

    @Test
    fun `plus de chiffres - jamais d'annonce, jamais de pave des chiffres, meme a la suite de 4 et au-dela`() {
        val g = pret(listOf("orange", "vert"))
        repeat(3) { i -> g.joue(t0 + i * 30_000L) { mapOf("orange" to tape(), "vert" to tape()) } }
        assertEquals(4, g.state.simon!!.prochaine)
        val debut = t0 + 200_000
        g.lance(debut)
        assertFalse(g.state.simon!!.annonceChiffres)
        assertEquals(debut + SIMON_REGARDEZ_MS, g.state.simon!!.montreAt, "la suite part tout de suite, sans annonce")
        val etat = Codec.publicState(g, teams = listOf("orange", "vert"))["simon"] as Map<*, *>
        assertNull(etat["chiffresAt"])
        assertEquals(false, etat["chiffres"], "les tablettes ne montrent jamais le pavé des chiffres")
        assertTrue(g.state.simon!!.solution.all { it in SIMON_COULEURS })
        assertNotNull(g.judgeSimon(mapOf("orange" to g.tape(), "vert" to g.tape(erreur = 3)), g.simonJugeAt()!!))
        assertTrue(g.state.simon!!.fini)
        assertNotNull(g.simonGo(listOf("orange", "vert"), t0 + 300_000))
        repeat(4) { i -> g.joue(t0 + 310_000 + i * 30_000L) { mapOf("orange" to tape(), "vert" to tape()) } }
        g.lance(t0 + 500_000)
        assertFalse(g.state.simon!!.annonceChiffres)
        assertEquals(false, (Codec.publicState(g, teams = listOf("orange", "vert"))["simon"] as Map<*, *>)["chiffres"])
    }

    @Test
    fun `un joueur different a chaque suite`() {
        val g = pret(listOf("orange", "vert"))
        val joueur = { g.state.simon!!.joueur("orange", simon.joueurs) }
        assertEquals(1, joueur())
        g.joue(t0) { mapOf("orange" to tape(), "vert" to tape()) }
        assertEquals(2, joueur())
        g.joue(t0 + 30_000) { mapOf("orange" to tape(), "vert" to tape()) }
        assertEquals(1, joueur(), "2 joueurs par équipe : le n° 1 revient")
    }

    @Test
    fun `la pause arrete la suite sans eliminer personne, elle se relance telle quelle`() {
        val g = pret()
        g.lance(t0)
        assertNotNull(g.pause(t0 + 2_500))
        assertFalse(g.state.simon!!.enCours)
        assertNull(g.wakeAt())
        assertNull(g.judgeSimon(emptyMap(), t0 + 20_000))
        assertNotNull(g.resume(t0 + 30_000))
        assertEquals(1, g.state.simon!!.prochaine)
        g.lance(t0 + 40_000)
        assertEquals(1, g.state.simon!!.suite)
        assertTrue(g.state.simon!!.out.isEmpty())
    }

    @Test
    fun `coupure du reseau pendant une suite, pause automatique`() {
        val g = pret()
        g.lance(t0)
        assertNotNull(g.networkPause(t0 + 5_000, NETWORK_GRACE_MS, alreadyPaused = false))
        assertTrue(g.state.paused)
        assertFalse(g.state.simon!!.enCours)
    }

    @Test
    fun `arreter la suite, puis tours suivants et jeu suivant`() {
        val g = pret(listOf("orange", "vert"))
        g.lance(t0)
        assertEquals(CommandStatus.APPLIED, g.run("simon_stop", t0 + 1_000).status)
        assertFalse(g.state.simon!!.enCours)
        g.joue(t0 + 10_000) { mapOf("orange" to tape(), "vert" to tape(erreur = 0)) }
        assertTrue(g.state.simon!!.fini)
        assertFalse(g.simonFini)
        assertEquals(CommandStatus.APPLIED, g.run("simon_go", t0 + 40_000).status, "« ▶ Tour suivant »")
        assertEquals(2, g.state.simon!!.tour)
        assertEquals(1, g.state.simon!!.prochaine)
        assertTrue(g.state.simon!!.out.isEmpty(), "tout le monde rejoue au nouveau tour")
        g.joue(t0 + 50_000) { mapOf("orange" to tape(erreur = 0), "vert" to tape()) }
        assertTrue(g.simonFini)
        assertEquals(CommandStatus.REFUSED, g.run("simon_go", t0 + 80_000).status, "2 tours seulement")
        assertEquals(mapOf("orange" to SIMON_POINTS, "vert" to SIMON_POINTS), g.state.scores().filterValues { it != 0 })
        assertNotNull(g.next(t0 + 90_000), "« Voir les scores »")
        assertEquals(Phase.SCORES, g.state.phase)
        assertNull(g.state.simon)
        assertNotNull(g.next(t0 + 95_000), "« Jeu suivant »")
        assertEquals("q1", g.state.qid)
    }

    @Test
    fun `une equipe seule joue tant qu'elle reussit, sa premiere erreur finit le tour`() {
        val g = pret(listOf("orange"))
        g.joue(t0) { mapOf("orange" to tape()) }
        g.joue(t0 + 30_000) { mapOf("orange" to tape()) }
        assertFalse(g.state.simon!!.fini, "seule, elle continue tant qu'elle réussit")
        val v = g.joue(t0 + 60_000) { mapOf("orange" to tape(erreur = 2)) }
        assertEquals(listOf("orange"), v.winners)
    }

    @Test
    fun `une equipe arrivee en cours de tour attend le tour suivant`() {
        val g = pret(listOf("orange", "vert"))
        val v = g.joue(t0) { mapOf("orange" to tape(), "vert" to tape(), "rose" to tape()) }
        assertFalse("rose" in v.answers, "rose n'est pas du tour")
    }

    @Test
    fun `reglages de la Regie PC hors limites ramenes dans les limites`() {
        val q = QuizJson.parse(
            """{"id":"p","title":"P","questions":[{"id":"s","text":"Le Simon du Prof","choices":[],"kind":"simon","tours":99,"reponse":2,"joueurs":3}]}""",
        ).questions.single()
        assertTrue(q.isSimon)
        assertEquals(SIMON_TOURS_MAX, q.simonTours)
        assertEquals(SIMON_REPONSE_MIN_SEC, q.simonSec)
        assertEquals(3, q.joueurs)
    }
}
