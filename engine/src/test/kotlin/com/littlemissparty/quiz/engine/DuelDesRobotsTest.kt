package com.littlemissparty.quiz.engine

import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 🤠 Le Duel des robots : deux équipes face à face, la première qui buzze après le PAN gagne, trop tôt elle perd. */
class DuelDesRobotsTest {

    private val duel = Question("d1", "Le Duel des robots", emptyList(), -1, kind = QuestionKind.DUEL, roundTitle = "Le Duel des robots", joueurs = 2)
    private val quiz = Question("q1", "Capitale ?", listOf("Paris", "Rome"), 0, durationSec = 20, roundTitle = "Quiz")
    private val t0 = 1_000_000L
    private val equipes = setOf("orange", "vert", "rose")

    private fun cmd(g: Game, type: String, vararg extra: Pair<String, Any?>) =
        Command.decode("c${g.state.lastSeq}", mapOf("type" to type, "expectSeq" to g.state.lastSeq) + extra)!!

    private fun Game.run(type: String, at: Long, vararg extra: Pair<String, Any?>, teams: Set<String> = equipes, random: Random = Random(7)) =
        execute(cmd(this, type, *extra), at, teams, random = random)

    private fun relu(g: Game) = Game(g.quiz).apply { g.events.forEach { record(Codec.decode(Codec.encode(it))!!) } }

    /** Jeu lancé, premier duel prêt entre deux des [teams]. */
    private fun pret(teams: Set<String> = equipes, questions: List<Question> = listOf(duel)): Game =
        Game(Quiz("p", "P", questions)).apply {
            next(t0)
            assertTrue(needsDuel())
            assertNotNull(readyDuel(teams, t0, random = Random(1)))
        }

    /** Lance le duel prêt ; renvoie l'heure du PAN. */
    private fun Game.lance(at: Long): Long {
        assertEquals(CommandStatus.APPLIED, run("duel_start", at).status)
        return state.duel!!.panAt!!
    }

    @Test
    fun `le jeu prepare un premier duel, le PAN reste secret, aucun chrono`() {
        val g = pret()
        val d = g.state.duel!!
        assertEquals(1, d.n)
        assertEquals(2, d.teams.size)
        assertEquals(listOf(1, 1), d.players, "le joueur n° 1 de chaque équipe")
        assertEquals("ready", d.step)
        assertFalse(g.needsDuel())
        val pan = g.lance(t0 + 5_000)
        assertTrue(pan - (t0 + 5_000) in 20_000L..60_000L, "face-à-face de 20 à 40 s, parfois jusqu'à 60 s")
        val pub = Codec.publicState(g, teams = equipes)
        val etat = pub["duel"] as Map<*, *>
        assertEquals("standoff", etat["step"])
        assertEquals(3, etat["total"], "3 équipes de 2 joueurs : 3 duels")
        assertNotNull(etat["key"])
        assertFalse(pub.toString().contains(pan.toString()), "l'heure du PAN n'est jamais publiée")
        assertNull(pub["deadline"])
        assertNull(pub["durationMs"])
        assertNull(g.deadline())
        assertEquals(pan + DUEL_PERSONNE_MS, g.wakeAt(), "la box se réveille pour juger si personne ne buzze")
    }

    @Test
    fun `la premiere equipe apres le PAN gagne 100 points, apres 1,5 s d'attente d'un appui plus rapide coince dans le wifi`() {
        val g = pret()
        val (a, b) = g.state.duel!!.teams
        val pan = g.lance(t0 + 5_000)
        assertNotNull(g.duelBuzz(a, pan + 300, pan + 400))
        assertNull(g.state.duel!!.result, "on attend encore l'autre équipe")
        assertEquals(pan + 300 + DUEL_LATENCE_MAX_MS, g.wakeAt())
        assertNull(g.settleDuel(pan + 600), "trop tôt pour juger")
        assertNotNull(g.timeUp(pan + 300 + DUEL_LATENCE_MAX_MS))
        val r = g.state.duel!!.result!!
        assertEquals(a, r.winner)
        assertEquals(b, r.loser)
        assertNull(r.early)
        assertEquals(300, r.ms)
        assertEquals(DUEL_POINTS, g.state.scores()[a])
        assertEquals(null, g.state.scores()[b])
        assertEquals(mapOf(a to 1, b to 1), g.state.duel!!.played)
        assertNull(g.duelBuzz(b, pan + 900, pan + 1_000), "duel jugé : un buzz en retard ne change rien")
        assertEquals("result", (Codec.publicState(g, teams = equipes)["duel"] as Map<*, *>)["step"])
        assertNull(Codec.duelKey(g), "plus de buzz possible")
        assertEquals(g.state.duel, relu(g).state.duel)
        assertEquals(g.state.scores(), relu(g).state.scores())
    }

    @Test
    fun `les deux ont buzze, le plus rapide gagne meme si son buzz arrive apres (wifi plus lent)`() {
        val g = pret()
        val (a, b) = g.state.duel!!.teams
        val pan = g.lance(t0)
        g.duelPanShown(pan, pan + 30)
        g.duelBuzz(a, pan + 250, pan + 300)
        g.duelBuzz(b, pan + 200, pan + 450)
        val r = g.state.duel!!.result!!
        assertEquals(b, r.winner, "jugé aussitôt, au temps d'appui")
        assertEquals(200, r.ms)
    }

    @Test
    fun `buzzer avant le PAN fait perdre le duel, le point va a l'autre equipe`() {
        val g = pret()
        val (a, b) = g.state.duel!!.teams
        val pan = g.lance(t0)
        g.duelBuzz(a, pan - 2_000, pan - 1_900)
        val r = g.state.duel!!.result!!
        assertEquals(b, r.winner)
        assertEquals(a, r.loser)
        assertEquals(a, r.early)
        assertEquals(DUEL_POINTS, g.state.scores()[b])
        // Appuyé juste avant le PAN, arrivé juste après : trop tôt quand même.
        val h = pret()
        val (c, d) = h.state.duel!!.teams
        val pan2 = h.lance(t0)
        h.duelPanShown(pan2 + 20, pan2 + 30)
        h.duelBuzz(c, pan2 - 50, pan2 + 120)
        assertEquals(c, h.state.duel!!.result!!.early)
        assertEquals(d, h.state.duel!!.result!!.winner)
    }

    @Test
    fun `l'heure annoncee par la tablette est ramenee dans la fenetre permise`() {
        val g = pret()
        val (a, b) = g.state.duel!!.teams
        val pan = g.lance(t0)
        // Une tablette qui prétend avoir appuyé 5 s avant l'arrivée : ramenée à 1,5 s avant.
        g.duelBuzz(a, pan - 4_000 + 0, pan + 1_000)
        assertEquals(a, g.state.duel!!.result!!.early, "1 000 − 1 500 : encore trop tôt")
        val h = pret()
        val (c, d) = h.state.duel!!.teams
        val pan2 = h.lance(t0)
        h.duelPanShown(pan2, pan2 + 30)
        // Une heure dans le futur : ramenée à l'heure d'arrivée.
        h.duelBuzz(c, pan2 + 60_000, pan2 + 700)
        h.duelBuzz(d, pan2 + 650, pan2 + 800)
        assertEquals(d, h.state.duel!!.result!!.winner)
        assertEquals(650, h.state.duel!!.result!!.ms)
    }

    @Test
    fun `personne ne buzze 10 s apres le PAN, duel nul sans points`() {
        val g = pret()
        val pan = g.lance(t0)
        assertNull(g.timeUp(pan + 9_000))
        assertNotNull(g.timeUp(pan + DUEL_PERSONNE_MS))
        val r = g.state.duel!!.result!!
        assertNull(r.winner)
        assertNull(r.early)
        assertEquals(0, r.points)
        assertTrue(g.state.scores().values.all { it == 0 })
        assertEquals(1, g.state.duel!!.played.values.first())
    }

    @Test
    fun `une equipe hors du duel ne peut pas buzzer, ni buzzer deux fois`() {
        val g = pret()
        val (a, _) = g.state.duel!!.teams
        val autre = (equipes - g.state.duel!!.teams.toSet()).single()
        val pan = g.lance(t0)
        assertNull(g.duelBuzz(autre, pan + 100, pan + 150))
        assertNotNull(g.duelBuzz(a, pan + 100, pan + 150))
        assertNull(g.duelBuzz(a, pan + 200, pan + 250))
    }

    @Test
    fun `la ronde fait jouer tout le monde, les joueurs tournent, jamais la meme paire deux fois de suite`() {
        val quatre = setOf("orange", "vert", "rose", "jaune")
        val g = pret(quatre)
        val paires = mutableListOf<List<String>>()
        var t = t0
        repeat(8) {
            val d = g.state.duel!!
            paires += d.teams
            val pan = g.lance(t)
            g.duelPanShown(pan, pan + 30)
            g.duelBuzz(d.teams[0], pan + 200, pan + 300)
            g.duelBuzz(d.teams[1], pan + 400, pan + 500)
            t = pan + 10_000
            if (it < 7) assertEquals(CommandStatus.APPLIED, g.run("duel_next", t, teams = quatre).status)
        }
        paires.zipWithNext().forEach { (x, y) -> assertNotEquals(x.toSet(), y.toSet(), "même paire deux fois de suite") }
        assertEquals(4, g.duelsAPrevoir(4), "4 équipes de 2 joueurs : 4 duels")
        // Après 8 duels, chaque équipe a joué 4 fois : la ronde équilibre.
        assertEquals(quatre.associateWith { 4 }, g.state.duel!!.played)
        assertTrue(g.duelTousPasses(quatre))
        // Les 4 premiers duels : chaque équipe une fois (tout le monde a joué une fois avant que quelqu'un rejoue).
        assertEquals(quatre, paires.take(2).flatten().toSet())
    }

    @Test
    fun `le joueur appele tourne dans chaque equipe`() {
        val g = pret(setOf("orange", "vert"))
        val pan = g.lance(t0)
        g.timeUp(pan + DUEL_PERSONNE_MS)
        g.run("duel_next", pan + 20_000, teams = setOf("orange", "vert"))
        assertEquals(listOf(2, 2), g.state.duel!!.players, "joueurs n° 2")
        assertEquals(2, g.state.duel!!.n)
        val pan2 = g.lance(pan + 21_000)
        g.timeUp(pan2 + DUEL_PERSONNE_MS)
        g.run("duel_next", pan2 + 20_000, teams = setOf("orange", "vert"))
        assertEquals(listOf(1, 1), g.state.duel!!.players, "2 joueurs par équipe : le n° 1 rejoue")
        assertEquals(1, joueurAppele(4, 4))
        assertEquals(3, duelsPrevus(5, 1), "5 joueurs en tout : un joueur rejoue")
        assertEquals(0, duelsPrevus(1, 4))
    }

    @Test
    fun `la pause arrete le face-a-face, la meme paire reste prete et Sarah relance`() {
        val g = pret()
        val avant = g.state.duel!!
        val pan = g.lance(t0)
        val cle = Codec.duelKey(g)
        assertNotNull(g.pause(pan - 3_000))
        assertEquals("ready", g.state.duel!!.step)
        assertEquals(avant.teams, g.state.duel!!.teams)
        assertNull(Codec.duelKey(g))
        assertNull(g.duelBuzz(avant.teams[0], pan + 100, pan + 200), "en pause, aucun buzz")
        g.resume(pan + 60_000)
        assertTrue(g.state.segments.isEmpty(), "pas de chrono au Duel des robots")
        assertEquals("ready", g.state.duel!!.step, "la reprise ne relance pas le duel toute seule")
        g.lance(pan + 70_000)
        assertNotEquals(cle, Codec.duelKey(g), "chaque face-à-face a sa clé : un vieux buzz ne compte jamais")
    }

    @Test
    fun `coupure du reseau pendant un face-a-face, pause automatique`() {
        val g = pret()
        g.lance(t0)
        assertNotNull(g.networkPause(t0 + 10_000, NETWORK_GRACE_MS, alreadyPaused = false))
        assertEquals("ready", g.state.duel!!.step)
    }

    @Test
    fun `arreter le duel, pas de points, jeu suivant refuse pendant un face-a-face, permis ensuite`() {
        val g = pret(questions = listOf(duel, quiz))
        g.lance(t0)
        assertEquals(CommandStatus.REFUSED, g.run("next", t0 + 1_000).status)
        assertEquals(CommandStatus.APPLIED, g.run("duel_stop", t0 + 2_000).status)
        assertEquals("ready", g.state.duel!!.step)
        assertEquals(CommandStatus.REFUSED, g.run("duel_stop", t0 + 3_000).status, "plus rien à arrêter")
        assertEquals(CommandStatus.REFUSED, g.run("duel_next", t0 + 3_000).status, "le duel prêt n'est pas joué")
        assertEquals(CommandStatus.APPLIED, g.run("next", t0 + 4_000).status)
        assertEquals("q1", g.state.qid)
        assertNull(g.state.duel)
    }

    @Test
    fun `dernier jeu, jeu suivant mene aux resultats finaux`() {
        val g = pret()
        val pan = g.lance(t0)
        g.timeUp(pan + DUEL_PERSONNE_MS)
        assertEquals(CommandStatus.APPLIED, g.run("next", pan + 20_000).status)
        assertEquals(Phase.ENDED, g.state.phase)
    }

    @Test
    fun `duel a la volee entre deux equipes choisies, apres un duel ou a la place du duel pret`() {
        val g = pret()
        val autre = (equipes - g.state.duel!!.teams.toSet()).single()
        val choisies = listOf(autre, g.state.duel!!.teams[0])
        // À la place du duel prêt : même numéro, lancé aussitôt.
        assertEquals(CommandStatus.APPLIED, g.run("duel_start", t0 + 1_000, "teams" to choisies).status)
        assertEquals(1, g.state.duel!!.n)
        assertEquals(choisies, g.state.duel!!.teams)
        assertTrue(g.state.duel!!.extra)
        assertEquals("standoff", g.state.duel!!.step)
        assertEquals(CommandStatus.REFUSED, g.run("duel_start", t0 + 2_000, "teams" to choisies).status, "pas pendant un face-à-face")
        g.timeUp(g.state.duel!!.panAt!! + DUEL_PERSONNE_MS)
        // Après un duel jugé : le duel suivant, à la volée.
        val t = g.state.duel!!.result!!.at + 5_000
        assertEquals(CommandStatus.APPLIED, g.run("duel_start", t, "teams" to choisies.reversed()).status)
        assertEquals(2, g.state.duel!!.n)
        assertEquals(listOf(2, 2), g.state.duel!!.players)
        assertEquals(CommandStatus.APPLIED, g.run("duel_stop", t + 500).status)
        assertEquals("unknown_team", g.run("duel_start", t + 1_000, "teams" to listOf("x", autre)).reason)
        assertEquals(g.state.duel, relu(g).state.duel)
    }

    @Test
    fun `equipe choisie deux fois ou une seule equipe, refuse`() {
        val g = pret()
        g.lance(t0)
        g.run("duel_stop", t0 + 1)
        assertEquals("bad_teams", g.run("duel_start", t0 + 2, "teams" to listOf("rose", "rose")).reason)
        assertEquals("bad_teams", g.run("duel_start", t0 + 2, "teams" to listOf("rose")).reason)
    }

    @Test
    fun `une seule equipe, pas de duel possible, on passe au jeu suivant`() {
        val g = Game(Quiz("p", "P", listOf(duel, quiz))).apply { next(t0) }
        assertNull(g.readyDuel(setOf("orange"), t0))
        assertEquals("none", (Codec.publicState(g, teams = setOf("orange"))["duel"] as Map<*, *>)["step"])
        assertEquals(CommandStatus.APPLIED, g.run("next", t0 + 1_000, teams = setOf("orange")).status)
        assertEquals("q1", g.state.qid)
    }

    @Test
    fun `presentation du jeu, le premier duel attend le lancement`() {
        val g = Game(Quiz("p", "P", listOf(duel), intros = true)).apply { next(t0) }
        assertTrue(g.state.intro)
        assertFalse(g.needsDuel())
        assertNull(g.readyDuel(equipes, t0))
        g.next(t0 + 1_000)
        assertTrue(g.needsDuel())
    }

    @Test
    fun `jeu rejoue, ses points de duel repartent de zero`() {
        val g = pret(questions = listOf(duel, quiz))
        val pan = g.lance(t0)
        val (a, _) = g.state.duel!!.teams
        g.duelBuzz(a, pan + 100, pan + 100)
        g.timeUp(pan + 100 + DUEL_LATENCE_MAX_MS)
        assertEquals(DUEL_POINTS, g.state.scores()[a])
        assertNotNull(g.goto(0, pan + 10_000))
        assertNull(g.state.duel)
        assertEquals(0, g.state.scores()[a] ?: 0)
    }

    @Test
    fun `duree du face-a-face entre les bornes, parfois un long duel jusqu'a 60 s`() {
        val r = Random(42)
        val tirages = (1..2_000).map { dureeFaceAFace(20, 40, longs = true, random = r) }
        assertTrue(tirages.all { it in 20_000L..60_000L })
        val longs = tirages.count { it > 40_000 }
        assertTrue(longs in 350..650, "environ un sur quatre : $longs")
        assertTrue((1..500).map { dureeFaceAFace(20, 40, longs = false, random = r) }.all { it in 20_000L..40_000L })
        assertTrue((1..500).map { dureeFaceAFace(30, 60, longs = true, random = r) }.all { it in 30_000L..60_000L })
        assertEquals(10_000, dureeFaceAFace(10, 10, longs = false, random = r))
    }

    @Test
    fun `reglages lus dans la partie, ramenes dans les limites`() {
        val json = """{"id":"p","title":"P","questions":[
            {"id":"d1","kind":"duel","text":"Le Duel des robots","joueurs":30,"faceMin":5,"faceMax":90,"longs":false},
            {"id":"d2","kind":"duel","text":"Le Duel des robots"}]}"""
        val (a, b) = QuizJson.parse(json).questions
        assertTrue(a.isDuel)
        assertEquals(listOf(DUEL_JOUEURS_MAX, DUEL_FACE_MIN_SEC, DUEL_FACE_MAX_SEC), listOf(a.joueurs, a.faceMin, a.faceMax))
        assertFalse(a.longs)
        assertEquals(listOf(DUEL_JOUEURS, DUEL_FACE_DEFAUT_MIN, DUEL_FACE_DEFAUT_MAX), listOf(b.joueurs, b.faceMin, b.faceMax))
        assertTrue(b.longs)
    }

    @Test
    fun `jeu double, 200 points le duel`() {
        val g = pret(questions = listOf(duel.copy(double = true)))
        val (a, _) = g.state.duel!!.teams
        val pan = g.lance(t0)
        g.duelBuzz(a, pan + 100, pan + 100)
        g.timeUp(pan + 100 + DUEL_LATENCE_MAX_MS)
        assertEquals(DUEL_POINTS * 2, g.state.scores()[a])
    }

    @Test
    fun `PAN affiche en retard, un appui avant l'image est trop tot et la reaction se mesure depuis l'image`() {
        val g = pret()
        val (a, b) = g.state.duel!!.teams
        val pan = g.lance(t0)
        // La TV a mis 120 ms à afficher le PAN ; le buzz de a (appui à +80) arrive avant qu'elle l'ait dit : on attend.
        g.duelBuzz(a, pan + 80, pan + 90)
        assertNull(g.state.duel!!.result, "pas jugé avant de savoir quand le PAN est apparu")
        assertNotNull(g.duelPanShown(pan + 120, pan + 130))
        val r = g.state.duel!!.result!!
        assertEquals(a, r.early, "appuyé avant que le PAN soit à l'écran : trop tôt")
        assertEquals(b, r.winner)
        assertNull(g.duelPanShown(pan + 150, pan + 160), "une seule fois par face-à-face")
        // Même retard, appui 200 ms après l'image : bon, et 200 ms de réaction (pas 320).
        val h = pret()
        val (c, _) = h.state.duel!!.teams
        val pan2 = h.lance(t0)
        h.duelPanShown(pan2 + 120, pan2 + 125)
        h.duelBuzz(c, pan2 + 320, pan2 + 360)
        h.timeUp(pan2 + 320 + DUEL_LATENCE_MAX_MS)
        assertEquals(c, h.state.duel!!.result!!.winner)
        assertEquals(200, h.state.duel!!.result!!.ms)
        // Relu après un redémarrage de la box : même bilan.
        assertEquals(h.state.duel, relu(h).state.duel)
    }

    @Test
    fun `retard d'affichage borne a 1 s, et sans nouvelle de la TV on juge sur l'heure prevue`() {
        val g = pret()
        val (a, _) = g.state.duel!!.teams
        val pan = g.lance(t0)
        g.duelPanShown(pan + 5_000, pan + 5_000)
        assertEquals(pan + DUEL_AFFICHAGE_MAX_MS, g.state.duel!!.reference)
        val h = pret()
        val (c, _) = h.state.duel!!.teams
        val pan2 = h.lance(t0)
        h.duelBuzz(c, pan2 + 250, pan2 + 300)
        assertNotNull(h.timeUp(pan2 + 250 + DUEL_LATENCE_MAX_MS))
        assertEquals(c, h.state.duel!!.result!!.winner)
        assertEquals(250, h.state.duel!!.result!!.ms)
        assertNull(g.state.duel!!.result)
        assertNotNull(a)
    }

    @Test
    fun `la plus rapide gagne quels que soient les retards du wifi`() {
        val retards = listOf(15L, 120L, 400L, 900L, 1_400L)
        for (lentA in retards) for (lentB in retards) for (ecart in listOf(5L, 40L, 300L)) {
            val g = pret()
            val (a, b) = g.state.duel!!.teams
            val pan = g.lance(t0)
            g.duelPanShown(pan + 60, pan + 70)
            val appuiA = pan + 60 + 180
            val appuiB = appuiA + ecart
            // Les buzz arrivent dans l'ordre de leur arrivée sur le serveur, pas de leur appui.
            listOf(Triple(a, appuiA, appuiA + lentA), Triple(b, appuiB, appuiB + lentB)).sortedBy { it.third }
                .forEach { (team, t, at) -> g.duelBuzz(team, t, at) }
            if (g.state.duel!!.result == null) g.timeUp(g.wakeAt()!!)
            val r = g.state.duel!!.result!!
            assertEquals(a, r.winner, "a appuie $ecart ms avant b, wifi $lentA / $lentB ms")
            assertEquals(180, r.ms, "réaction mesurée à l'appui, depuis le PAN affiché")
        }
    }

    @Test
    fun `un appui plus rapide coince dans le wifi est attendu, jamais oublie`() {
        val g = pret()
        val (a, b) = g.state.duel!!.teams
        val pan = g.lance(t0)
        g.duelPanShown(pan, pan + 20)
        // b appuie à +300 et arrive vite ; a a appuyé à +250 mais son buzz met 1,2 s.
        g.duelBuzz(b, pan + 300, pan + 320)
        assertNull(g.timeUp(pan + 320 + 500), "on attend encore : un appui plus rapide peut arriver jusqu'à 1,5 s après")
        g.duelBuzz(a, pan + 250, pan + 1_450)
        assertEquals(a, g.state.duel!!.result!!.winner)
    }

    @Test
    fun `PAN affiche un peu en avance, la reference suit l'image (dans la limite toleree)`() {
        val g = pret()
        val (a, b) = g.state.duel!!.teams
        val pan = g.lance(t0)
        // Appui 100 ms avant l'heure prévue : on ne sait pas encore, on attend l'image.
        g.duelBuzz(a, pan - 100, pan - 20)
        assertNull(g.state.duel!!.result)
        // L'image est partie 150 ms avant l'heure prévue : l'appui de a vient 50 ms après, il est bon.
        g.duelPanShown(pan - 150, pan)
        assertEquals(pan - 150, g.state.duel!!.reference)
        g.duelBuzz(b, pan + 200, pan + 260)
        assertEquals(a, g.state.duel!!.result!!.winner)
        assertEquals(50, g.state.duel!!.result!!.ms)
        // Jamais plus de 200 ms d'avance prise en compte.
        val h = pret()
        val pan2 = h.lance(t0)
        h.duelPanShown(pan2 - 900, pan2)
        assertEquals(pan2 - DUEL_AVANCE_MAX_MS, h.state.duel!!.reference)
    }

    @Test
    fun `quiz, duel puis quiz, les points se gardent d'un jeu a l'autre, retour au duel et rejeu coherents`() {
        val q2 = quiz.copy(id = "q2")
        val g = Game(Quiz("p", "P", listOf(quiz, duel, q2)))
        var t = t0
        fun relue() = assertEquals(g.state, relu(g).state, "box redémarrée : même partie")
        // Quiz : « orange » répond juste.
        g.next(t)
        assertEquals("q1", g.state.qid)
        t += 5_000
        g.next(t)
        assertEquals(Phase.CLOSED, g.state.phase)
        g.next(t + 500, mapOf("orange" to Answer(0, t - 1_000)))
        val apresQuiz = g.state.scores()["orange"]!!
        assertTrue(apresQuiz > 0)
        while (g.state.qid != "d1") { t += 1_000; assertNotNull(g.next(t), "suivant bloqué en ${g.state.phase}") }
        relue()
        // Duel : un premier duel joué et gagné.
        assertNotNull(g.readyDuel(equipes, t, random = Random(3)))
        val (a, _) = g.state.duel!!.teams
        val pan = g.lance(t + 1_000)
        g.duelPanShown(pan, pan + 20)
        g.duelBuzz(a, pan + 250, pan + 300)
        g.timeUp(pan + 250 + DUEL_LATENCE_MAX_MS)
        assertEquals(a, g.state.duel!!.result!!.winner)
        relue()
        val avantQ2 = g.state.scores()
        assertEquals(apresQuiz + (if (a == "orange") DUEL_POINTS else 0), avantQ2["orange"])
        // Jeu suivant : le quiz q2, scores gardés, plus aucun duel en cours.
        t = pan + 10_000
        assertEquals(CommandStatus.APPLIED, g.run("next", t).status)
        assertEquals("q2", g.state.qid)
        assertNull(g.state.duel)
        assertEquals(avantQ2, g.state.scores())
        relue()
        // Retour au duel depuis q2 : le duel repart de zéro (ses points seulement), le quiz garde les siens.
        assertNotNull(g.goto(1, t + 5_000))
        if (g.state.phase == Phase.SCORES) g.next(t + 6_000)
        assertEquals("d1", g.state.qid)
        assertEquals(apresQuiz, g.state.scores()["orange"] ?: 0)
        assertEquals(0, g.state.scores()[a]?.takeIf { a != "orange" } ?: 0)
        assertNotNull(g.readyDuel(equipes, t + 7_000, random = Random(4)))
        assertEquals(1, g.state.duel!!.n, "la ronde recommence")
        relue()
        // Et on va jusqu'au bout : le quiz q2 puis les résultats, sans blocage.
        t += 8_000
        assertEquals(CommandStatus.APPLIED, g.run("next", t).status)
        assertEquals("q2", g.state.qid)
        var n = 0
        while (g.state.phase != Phase.ENDED) { t += 1_000; assertNotNull(g.next(t), "suivant bloqué en ${g.state.phase}"); assertTrue(++n < 10) }
        assertEquals(apresQuiz, g.state.scores()["orange"])
        relue()
    }
}
