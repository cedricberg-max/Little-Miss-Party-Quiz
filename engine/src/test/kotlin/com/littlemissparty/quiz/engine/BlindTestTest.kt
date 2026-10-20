package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Blind test « jeu télévisé » : chaque morceau s'annonce, l'animatrice le lance, le premier buzz fige la
 * musique, elle juge la réponse orale ; après une erreur elle relance la musique pour les autres équipes.
 */
class BlindTestTest {

    private val audio = "0123456789abcdef"
    private fun track(id: String, title: String, points: Int = 100) = Question(
        id, "Quel est ce titre ?", listOf(title), 0, durationSec = 25, kind = QuestionKind.BLIND,
        artist = "Artiste $title", audioId = audio, roundTitle = "Blind test · Tubes", points = points,
    )
    private val playlist = listOf(track("b1", "Un"), track("b2", "Deux"), track("b3", "Trois", 200))
    private val teams = setOf("rose", "bleu", "vert")
    private val t0 = 1_000_000L

    private fun game(vararg extra: Question) = Game(Quiz("p", "P", playlist + extra)).apply { next(t0) }

    /** Commande de la régie, exactement comme la box l'applique (avec le numéro d'événement affiché). */
    private fun Game.cmd(type: String, at: Long, vararg args: Pair<String, Any>): CommandResult =
        execute(Command.decode("c$at", mapOf("type" to type, "expectSeq" to state.lastSeq, *args))!!, at, teams)

    private fun Game.blind() = Codec.publicState(this)["blind"] as Map<*, *>

    @Suppress("UNCHECKED_CAST")
    private fun Game.statuses() = (blind()["tracks"] as List<Map<String, Any?>>).map { it["status"] }

    @Test
    fun `le morceau s'annonce sans musique, l'animatrice le lance, le buzz le fige, bonne réponse = valeur du morceau`() {
        val g = game()
        assertEquals("b1", g.state.qid)
        assertEquals(false, Codec.publicState(g)["buzzOpen"], "pas de buzz avant « Lancer le morceau »")
        assertNull(g.deadline(), "la musique attend l'animatrice")
        assertEquals(true, g.blind()["waiting"])
        assertEquals(listOf("playing", "todo", "todo"), g.statuses())
        assertNull(Codec.publicState(g)["choices"], "le titre reste caché sur les pupitres")

        assertEquals(CommandStatus.APPLIED, g.cmd("blind_play", t0 + 5_000).status)
        assertEquals(true, Codec.publicState(g)["buzzOpen"])
        assertEquals(t0 + 5_000 + 25_000, g.deadline())
        assertNull(g.buzz("rose", t0 + 6_000)?.let { null } ?: g.buzz("bleu", t0 + 6_001), "un seul buzz gagne")
        assertEquals("rose", g.state.buzzTeam())
        assertNull(g.deadline(), "musique figée pendant la réponse")
        assertEquals(CommandStatus.APPLIED, g.cmd("buzz_ok", t0 + 9_000).status)
        assertEquals(mapOf("rose" to 100), g.state.scores())
        assertEquals(Phase.REVEAL, g.state.phase)
        assertEquals("Artiste Un", Codec.publicState(g)["artist"])
        assertEquals(listOf("found", "todo", "todo"), g.statuses())

        // Double appui sur « Bonne réponse » : jamais deux fois les points.
        assertEquals(CommandStatus.STALE, g.execute(Command.Judge("dbl", g.state.lastSeq - 1, true), t0 + 9_100, teams).status)
        assertEquals(CommandStatus.REFUSED, g.cmd("buzz_ok", t0 + 9_200).status)
        assertEquals(mapOf("rose" to 100), g.state.scores())

        // « Titre suivant » : le morceau suivant s'annonce, sans démarrer tout seul.
        assertEquals(CommandStatus.APPLIED, g.cmd("next", t0 + 12_000).status)
        assertEquals("b2", g.state.qid)
        assertEquals(true, g.blind()["waiting"])
        assertNull(g.deadline())
    }

    @Test
    fun `mauvaise réponse, la musique attend la relance, l'équipe ratée attend 3 s, plusieurs erreurs sans points`() {
        val g = game()
        g.cmd("blind_play", t0 + 1_000)
        g.buzz("rose", t0 + 5_000)
        val key = Codec.buzzKey(g)
        assertEquals(CommandStatus.APPLIED, g.cmd("buzz_ko", t0 + 7_000).status)
        assertEquals(emptyMap(), g.state.scores())
        assertEquals(false, Codec.publicState(g)["buzzOpen"], "personne ne buzze tant que la musique ne repart pas")
        assertNull(g.deadline())

        g.cmd("blind_play", t0 + 20_000)
        // La musique repart là où elle s'était arrêtée : 4 s jouées, 21 s restantes.
        assertEquals(t0 + 20_000 + 21_000, g.deadline())
        assertTrue(Codec.buzzKey(g) != key, "nouvelle clé : le buzz raté ne bloque pas les autres")
        assertNull(g.buzz("rose", t0 + 21_000), "l'équipe qui s'est trompée attend 3 s après la reprise")
        g.buzz("bleu", t0 + 22_000)
        g.cmd("buzz_ko", t0 + 23_000)
        g.cmd("blind_play", t0 + 24_000)
        g.buzz("vert", t0 + 25_000)
        g.cmd("buzz_ko", t0 + 26_000)
        assertEquals(listOf("rose", "bleu", "vert"), g.state.buzz!!.blocked)
        // Toutes les équipes ont tenté : à la relance, tout le monde peut rebuzzer.
        g.cmd("blind_play", t0 + 30_000)
        assertEquals(emptyList(), g.state.buzz!!.blocked)
        g.buzz("rose", t0 + 31_000)
        g.cmd("buzz_ok", t0 + 32_000)
        assertEquals(mapOf("rose" to 100), g.state.scores(), "aucun point pour les erreurs, la valeur du morceau à la fin")
    }

    @Test
    fun `une équipe qui s'est trompée rebuzze 3 s après la reprise, plusieurs fois, compte à rebours compris`() {
        val g = game()
        g.cmd("blind_play", t0 + 1_000)
        assertNull(Codec.publicState(g)["buzzBlocked"], "personne n'est bloqué")
        g.buzz("rose", t0 + 5_000)
        g.cmd("buzz_ko", t0 + 7_000)
        assertNull(g.rebuzzAt(), "musique à l'arrêt : personne ne buzze")
        assertEquals(mapOf("rose" to true), Codec.publicState(g)["buzzBlocked"], "les règles refusent tout buzz pendant l'attente")

        g.cmd("blind_play", t0 + 20_000)
        assertEquals(t0 + 23_000, g.rebuzzAt())
        assertEquals(mapOf("rose" to t0 + 23_000), Codec.publicState(g)["buzzBlocked"], "heure de rebuzz publiée pour les règles et le pupitre")
        assertNull(g.buzz("rose", t0 + 22_000), "trop tôt")
        assertNotNull(g.buzz("rose", t0 + 23_100), "3 s après la reprise : elle retente")
        g.cmd("buzz_ko", t0 + 24_000)
        assertEquals(listOf("rose"), g.state.buzz!!.blocked, "une seule fois dans la liste, même après deux erreurs")

        // Pause pendant la musique puis reprise avec 3, 2, 1 : les 3 s comptent après le décompte.
        g.cmd("blind_play", t0 + 30_000)
        g.pause(t0 + 31_000)
        g.resume(t0 + 40_000, countdownMs = 3_000)
        assertEquals(t0 + 46_000, g.rebuzzAt())
        assertNull(g.buzz("rose", t0 + 44_000), "pendant les 3 s après le décompte")
        g.buzz("rose", t0 + 46_500)
        g.cmd("buzz_ok", t0 + 47_000)
        assertEquals(mapOf("rose" to 100), g.state.scores(), "trouvé au 3e essai : la valeur du morceau, sans pénalité")
    }

    @Test
    fun `le bouton principal de la régie lance, arrête et relance la musique, jamais pendant une réponse`() {
        val g = game()
        assertEquals(CommandStatus.APPLIED, g.cmd("next", t0 + 1_000).status, "« Lancer le morceau »")
        assertEquals(t0 + 1_000 + 25_000, g.deadline())
        g.buzz("rose", t0 + 2_000)
        assertEquals(CommandStatus.REFUSED, g.cmd("next", t0 + 3_000).status, "une équipe répond : on attend le verdict")
        g.cmd("buzz_ko", t0 + 4_000)
        g.cmd("next", t0 + 5_000)
        g.buzz("bleu", t0 + 6_000)
        g.cmd("buzz_ko", t0 + 7_000)
        g.cmd("next", t0 + 8_000)
        g.buzz("vert", t0 + 9_000)
        g.cmd("buzz_ko", t0 + 10_000)
        // Tout le monde a tenté : la relance par le bouton principal réautorise toutes les équipes.
        assertEquals(CommandStatus.APPLIED, g.cmd("next", t0 + 11_000).status)
        assertEquals(emptyList(), g.state.buzz!!.blocked)
        assertEquals(true, Codec.publicState(g)["buzzOpen"])
        assertEquals(CommandStatus.APPLIED, g.cmd("next", t0 + 12_000).status, "« Arrêter la musique »")
        assertEquals(true, g.blind()["waiting"])
        assertEquals(false, Codec.publicState(g)["buzzOpen"])
        assertEquals(emptyMap(), g.state.scores())
    }

    @Test
    fun `réautoriser toutes les équipes, fin de l'extrait, révéler sans points, passer un morceau, bilan`() {
        val g = game()
        g.cmd("blind_play", t0)
        g.buzz("rose", t0 + 2_000)
        g.cmd("buzz_ko", t0 + 3_000)
        assertEquals(CommandStatus.APPLIED, g.cmd("blind_unblock", t0 + 4_000).status)
        assertEquals(emptyList(), g.state.buzz!!.blocked)
        g.cmd("blind_play", t0 + 5_000)
        assertEquals(t0 + 5_000 + 23_000, g.deadline())
        assertNull(g.timeUp(t0 + 20_000), "le chrono n'est pas à zéro")
        // Chrono à zéro sans bonne réponse : « Personne n'a trouvé », révélation sans points, pochette et titre quand même.
        assertNotNull(g.timeUp(t0 + 28_000))
        assertEquals(Phase.REVEAL, g.state.phase)
        assertEquals(listOf("Un"), Codec.publicState(g)["choices"])
        assertEquals(emptyMap(), g.state.scores())
        assertEquals(CommandStatus.APPLIED, g.cmd("blind_cut", t0 + 36_000).status)
        assertEquals(true, g.blind()["cut"])
        g.cmd("next", t0 + 40_000)
        assertEquals("b2", g.state.qid)
        // Passer sans révéler : le morceau suivant s'annonce.
        assertEquals(CommandStatus.APPLIED, g.cmd("blind_skip", t0 + 41_000).status)
        assertEquals("b3", g.state.qid)
        assertEquals(listOf("revealed", "skipped", "playing"), g.statuses())
        assertEquals(200, g.blind()["points"], "un des derniers morceaux, à double valeur")
        g.cmd("blind_play", t0 + 42_000)
        g.buzz("vert", t0 + 43_000)
        g.cmd("buzz_ok", t0 + 44_000)
        // Dernier morceau : « suivant » mène au bilan, puis à la suite de la prestation.
        g.cmd("next", t0 + 50_000)
        assertEquals(Phase.SCORES, g.state.phase)
        assertEquals(mapOf("vert" to 200), g.state.scores())
    }

    @Test
    fun `chrono à zéro, jamais pendant l'attente du Lancer, ni pendant une réponse, refrain lu depuis le programme`() {
        val g = game()
        assertNull(g.timeUp(t0 + 60_000), "musique pas encore lancée : rien ne se révèle")
        g.cmd("blind_play", t0)
        g.buzz("rose", t0 + 20_000)
        assertNull(g.timeUp(t0 + 40_000), "une équipe répond : on attend le verdict")
        g.cmd("buzz_ko", t0 + 41_000)
        assertNull(g.timeUp(t0 + 50_000), "musique arrêtée après l'erreur : on attend la relance")
        assertEquals(Phase.QUESTION, g.state.phase)
        g.cmd("blind_play", t0 + 51_000)
        // Il restait 5 s de musique : à zéro, révélation sans points.
        assertNull(g.timeUp(t0 + 55_000))
        assertNotNull(g.timeUp(t0 + 56_000))
        assertEquals(Phase.REVEAL, g.state.phase)
        assertEquals(emptyMap(), g.state.scores())

        val json = """{"id":"q","title":"Q","questions":[{"id":"b1","text":"Quel est ce titre ?","choices":["Un"],"correct":0,
            "kind":"blind","audioId":"0123456789abcdef","refrainId":"fedcba9876543210","duration":30},
            {"id":"q2","text":"Deux ?","choices":["a","b"],"correct":0,"refrainId":"fedcba9876543210"}]}"""
        val quiz = QuizJson.parse(json)
        assertEquals("fedcba9876543210", quiz.questions[0].refrainId)
        assertNull(quiz.questions[1].refrainId, "refrain réservé au blind test")
    }

    @Test
    fun `pause pendant la musique ou pendant l'attente, Super Finale doublée`() {
        val g = Game(Quiz("p", "P", listOf(track("b1", "Un").copy(double = true)))).apply { next(t0) }
        g.pause(t0 + 1_000)
        g.resume(t0 + 2_000, countdownMs = 3_000)
        assertNull(g.deadline(), "une pause pendant l'attente ne lance pas la musique")
        g.cmd("blind_play", t0 + 10_000)
        g.pause(t0 + 13_000)
        assertEquals(CommandStatus.REFUSED, g.cmd("buzz_ok", t0 + 14_000).status)
        g.resume(t0 + 60_000, countdownMs = 3_000)
        assertEquals(t0 + 63_000 + 22_000, g.deadline(), "3 s jouées avant la pause")
        g.buzz("rose", t0 + 64_000)
        g.cmd("buzz_ok", t0 + 65_000)
        assertEquals(mapOf("rose" to 200), g.state.scores())
    }

    @Test
    fun `journal relu à l'identique, morceau rejoué sans double comptage, quiz musical inchangé`() {
        val g = game()
        g.cmd("blind_play", t0)
        g.buzz("rose", t0 + 1_000)
        g.cmd("buzz_ko", t0 + 2_000)
        g.cmd("blind_unblock", t0 + 3_000)
        g.cmd("blind_play", t0 + 4_000)
        g.buzz("bleu", t0 + 5_000)
        g.cmd("buzz_ok", t0 + 6_000)
        g.cmd("blind_cut", t0 + 7_000)
        g.cmd("next", t0 + 8_000)
        g.cmd("blind_skip", t0 + 9_000)
        val replay = Game(g.quiz).apply { g.events.forEach { assertTrue(record(Codec.decode(Codec.encode(it))!!)) } }
        assertEquals(g.state, replay.state)

        // La régie rejoue le blind test : ses points et ses morceaux passés repartent de zéro.
        assertEquals(CommandStatus.APPLIED, g.cmd("goto", t0 + 20_000, "index" to 0, "qid" to "b1").status)
        assertEquals(emptyMap(), g.state.scores())
        assertEquals(listOf("playing", "todo", "todo"), g.statuses())

        val quiz = QuizJson.parse(
            """{"id":"p","questions":[
              {"id":"b","text":"Quel est ce titre ?","choices":["Libérée, délivrée"],"correct":0,"kind":"blind","duration":30,"artist":" La Reine des neiges ","audioId":"$audio","points":200,"reveal":9,"imageId":"fedcba9876543210"},
              {"id":"m","text":"Quel est ce titre ?","choices":["A","B","C","D"],"correct":2,"audioId":"$audio","artist":"ignoré hors blind test","points":500},
              {"id":"x","text":"Sans extrait","choices":["Titre"],"correct":0,"kind":"blind","audioId":"pas-une-empreinte"}]}""",
        )
        assertEquals(listOf(QuestionKind.BLIND, QuestionKind.CLASSIC, QuestionKind.BLIND), quiz.questions.map { it.kind })
        assertEquals("La Reine des neiges", quiz.questions[0].artist)
        assertEquals(200, quiz.questions[0].trackPoints)
        assertEquals(9, quiz.questions[0].revealSec)
        assertEquals("fedcba9876543210", quiz.questions[0].imageId, "la pochette")
        assertNull(quiz.questions[1].points, "la valeur d'un morceau ne concerne que le blind test")
        assertNull(quiz.questions[1].artist)
        assertNull(quiz.questions[2].audioId, "une empreinte mal formée est ignorée, sans refuser la prestation")
        assertEquals(Scoring.BLIND_POINTS, quiz.questions[2].trackPoints)

        // Révélation de 30 s, ou tout l'extrait (0) pour chanter le refrain ; au-delà de 60 s, ramenée à 60.
        fun reveal(v: Int) = QuizJson.parse(
            """{"id":"p","questions":[{"id":"b","text":"T ?","choices":["A"],"correct":0,"kind":"blind","audioId":"$audio","reveal":$v}]}""",
        ).questions[0].revealSec
        assertEquals(30, reveal(30))
        assertEquals(0, reveal(0))
        assertEquals(60, reveal(500))
    }

    @Test
    fun `statues musicales, les chansons choisies sont lues dans l'ordre, sans doublon ni empreinte mal formée`() {
        val quiz = QuizJson.parse(
            """{"id":"p","questions":[
              {"id":"s","text":"Statues musicales","kind":"statues","duration":90,"audioIds":["0123456789abcdef","pas-une-empreinte","fedcba9876543210","0123456789abcdef"]},
              {"id":"s2","text":"Statues musicales","kind":"statues","duration":60},
              {"id":"q","text":"Q ?","choices":["A","B"],"correct":0,"audioIds":["0123456789abcdef"]}]}""",
        )
        assertEquals(listOf("0123456789abcdef", "fedcba9876543210"), quiz.questions[0].audioIds)
        assertEquals(emptyList<String>(), quiz.questions[1].audioIds, "sans chanson : la musique maison de la TV")
        assertEquals(emptyList<String>(), quiz.questions[2].audioIds, "seules les statues ont une liste de chansons")
    }

    @Test
    fun `des mimes juste après le blind test, le chrono du tour tourne normalement`() {
        val mimes = Question("m1", "Mimes", emptyList(), -1, durationSec = 60, kind = QuestionKind.MIME, cards = listOf(MimeCard("chat"), MimeCard("chien")))
        val g = Game(Quiz("p", "P", listOf(track("b1", "Un"), mimes))).apply { next(t0) }
        g.cmd("blind_play", t0 + 1_000)
        g.buzz("rose", t0 + 2_000)
        g.cmd("buzz_ok", t0 + 3_000)
        g.cmd("next", t0 + 5_000)
        assertEquals(Phase.SCORES, g.state.phase, "dernier morceau : bilan")
        g.cmd("next", t0 + 6_000)
        assertEquals("m1", g.state.qid)
        g.mimeStart("rose", t0 + 7_000)
        assertEquals(false, g.state.buzzHeld)
        assertEquals(t0 + 7_000 + 60_000, g.deadline())
        assertNotNull(g.events.last())
    }

    private fun GameState.buzzTeam() = buzz?.team
}
