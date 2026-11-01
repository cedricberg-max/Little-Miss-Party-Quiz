package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Mimes en file (cedric, 26/10) : une manche par couleur, préparée dans la Régie PC. « Lancer l'épreuve » montre tout de
 * suite la première image ; Trouvé ou Passer font tourner les joueurs (écran vide jusqu'à « Image suivante ») ; le tour
 * finit au chrono, le bilan des scores suit tout seul ; Sarah lance à la main la manche de la couleur suivante.
 */
class MimesEnFileTest {

    private val jaunes = listOf("Pompier", "Pirate", "Singe").map { MimeCard(it, "🙂") }
    private val verts = listOf("Danseuse", "Robot").map { MimeCard(it, "🙂") }
    private val quiz = Quiz(
        "demo", "Démo",
        listOf(
            Question("q1", "Couleur du ciel ?", listOf("Vert", "Bleu"), correct = 1, durationSec = 20, roundTitle = "Quiz"),
            Question("m1", "Équipe Jaune", emptyList(), correct = -1, durationSec = 60, kind = QuestionKind.MIME, roundTitle = "Mimes", cards = jaunes, couleur = "#F5D000"),
            Question("m2", "Équipe Verte", emptyList(), correct = -1, durationSec = 60, kind = QuestionKind.MIME, roundTitle = "Mimes", cards = verts, couleur = "#3CB44B"),
            Question("q2", "Finale", listOf("A", "B"), correct = 0, durationSec = 10, roundTitle = "Finale"),
        ),
        intros = true,
    )
    private val teams = setOf("jaune", "vert")
    private val t0 = 1_000_000L

    /** Quiz joué puis classement : la présentation des Mimes est à l'écran. */
    private fun aLaPresentation(): Game = Game(quiz).apply {
        next(t0)
        next(t0 + 1_000)
        next(t0 + 5_000)
        next(t0 + 5_100)
        next(t0 + 6_000)
        next(t0 + 7_000)
        check(question?.id == "m1" && state.intro) { "Présentation des Mimes attendue, pas ${question?.id} ${state.phase}" }
    }

    @Test
    fun `lancer l'épreuve montre tout de suite la première image et le chrono part`() {
        val g = aLaPresentation()
        assertNotNull(g.mimeStart("jaune", t0 + 10_000))
        assertFalse(g.state.intro)
        assertEquals("jaune", g.state.mime?.team)
        assertEquals("Pompier", g.mimeCard?.word)
        assertEquals(t0 + 70_000 + MIME_DEPART_MS, g.deadline())
    }

    @Test
    fun `passer fait tourner les joueurs, sans point, l'image passée repart sous le paquet`() {
        val g = aLaPresentation()
        g.mimeStart("jaune", t0 + 10_000)
        assertNotNull(g.mimeSkip(t0 + 15_000))
        assertNull(g.mimeCard, "L'écran se vide le temps que les joueurs tournent")
        assertEquals(t0 + 15_000, g.state.mime?.relais)
        assertEquals(1, g.state.mime?.passed)
        assertEquals(0, g.state.mimes["m1"]?.get("jaune") ?: 0)
        assertNull(g.mimeSkip(t0 + 15_300), "Pendant que les joueurs tournent, Passer ne fait rien")
        assertEquals(t0 + 70_000 + MIME_DEPART_MS, g.deadline(), "Le chrono continue")
        // Le nouveau mimeur est face à l'écran : Sarah montre l'image suivante.
        assertNotNull(g.mimePass(t0 + 19_000))
        assertEquals("Pirate", g.mimeCard?.word)
        g.mimeFound(t0 + 25_000)
        g.mimePass(t0 + 28_000)
        assertEquals("Singe", g.mimeCard?.word)
        g.mimeFound(t0 + 30_000)
        g.mimePass(t0 + 33_000)
        assertEquals("Pompier", g.mimeCard?.word, "L'image passée revient après les autres")
        assertEquals(2, g.state.mimes["m1"]?.get("jaune"))
    }

    @Test
    fun `passer sur la dernière image la garde, le tour continue`() {
        val g = aLaPresentation()
        g.mimeStart("jaune", t0 + 10_000)
        g.mimeFound(t0 + 12_000); g.mimePass(t0 + 13_000)
        g.mimeFound(t0 + 14_000); g.mimePass(t0 + 15_000)
        assertEquals("Singe", g.mimeCard?.word)
        assertNotNull(g.mimeSkip(t0 + 16_000))
        g.mimePass(t0 + 17_000)
        assertEquals("Singe", g.mimeCard?.word)
        assertTrue(g.state.mimeTurn)
    }

    @Test
    fun `fin du chrono, puis le bilan des scores arrive tout seul et seule la jauge de l'équipe monte`() {
        val g = aLaPresentation()
        val avant = g.state.scores()
        g.mimeStart("jaune", t0 + 10_000)
        g.mimeFound(t0 + 20_000)
        assertNotNull(g.timeUp(t0 + 70_000))
        assertFalse(g.state.mimeTurn)
        assertEquals(t0 + 70_000 + MIME_BILAN_AUTO_MS, g.wakeAt(), "La box se réveille pour le bilan")
        assertFalse(g.mimeBilanDue(t0 + 71_000))
        assertNull(g.timeUp(t0 + 71_000), "Trop tôt : « TEMPS ÉCOULÉ ! » et le bravo d'abord")
        assertNotNull(g.timeUp(t0 + 70_000 + MIME_BILAN_AUTO_MS))
        assertEquals(Phase.SCORES, g.state.phase)
        assertEquals((avant["jaune"] ?: 0) + Scoring.MIME, g.state.scores()["jaune"])
        assertEquals(avant["vert"] ?: 0, g.state.scores()["vert"] ?: 0)
        assertNull(g.wakeAt(), "Plus rien ne part seul : Sarah lance l'équipe suivante")
    }

    @Test
    fun `au bilan, lancer l'équipe suivante ouvre sa manche et montre sa première image d'un seul geste`() {
        val g = aLaPresentation()
        g.mimeStart("jaune", t0 + 10_000)
        g.timeUp(t0 + 70_000)
        g.timeUp(t0 + 80_000)
        assertEquals(Phase.SCORES, g.state.phase)
        assertNotNull(g.mimeStart("vert", t0 + 90_000))
        assertEquals("m2", g.question?.id)
        assertFalse(g.state.intro, "Même jeu : pas de nouvelle présentation")
        assertEquals("vert", g.state.mime?.team)
        assertEquals("Danseuse", g.mimeCard?.word)
        assertEquals(t0 + 150_000 + MIME_DEPART_MS, g.deadline())
        // Dernière couleur : au bilan, plus de manche de mimes à ouvrir, « suivant » mène au jeu suivant.
        g.timeUp(t0 + 150_000)
        g.timeUp(t0 + 160_000)
        assertEquals(Phase.SCORES, g.state.phase)
        assertNull(g.mimeStart("jaune", t0 + 170_000))
        assertNotNull(g.next(t0 + 171_000))
        assertEquals("q2", g.question?.id)
    }

    @Test
    fun `en pause, rien ne se lance, ni le tour ni le bilan`() {
        val g = aLaPresentation()
        g.pause(t0 + 9_000)
        assertNull(g.mimeStart("jaune", t0 + 10_000))
        assertTrue(g.state.intro)
        g.resume(t0 + 11_000)
        g.mimeStart("jaune", t0 + 20_000)
        g.timeUp(t0 + 80_000)
        g.pause(t0 + 81_000)
        assertNull(g.mimeBilanAt())
        assertNull(g.timeUp(t0 + 90_000))
        assertEquals(Phase.QUESTION, g.state.phase)
    }

    @Test
    fun `une manche de mimes jouée par toutes les équipes garde son ancien déroulé`() {
        val partagee = Quiz(
            "p", "P",
            listOf(Question("m", "Mimes", emptyList(), correct = -1, durationSec = 60, kind = QuestionKind.MIME, roundTitle = "Mimes", cards = jaunes)),
        )
        val g = Game(partagee).apply { next(t0) }
        g.mimeStart("jaune", t0 + 1_000)
        g.timeUp(t0 + 61_000)
        assertNull(g.mimeBilanAt(), "Pas de bilan automatique : les autres équipes n'ont pas joué")
        assertEquals(Phase.QUESTION, g.state.phase)
    }

    @Test
    fun `le journal rejoué redonne la même partie, Passer compris`() {
        val g = aLaPresentation()
        g.mimeStart("jaune", t0 + 10_000)
        g.mimeSkip(t0 + 12_000)
        g.mimePass(t0 + 14_000)
        g.mimeFound(t0 + 16_000)
        g.timeUp(t0 + 70_000)
        g.timeUp(t0 + 80_000)
        g.mimeStart("vert", t0 + 90_000)
        val relu = Game(g.quiz, g.events.map { Codec.decode(Codec.encode(it))!! })
        assertEquals(g.state, relu.state)
        assertEquals("Danseuse", relu.mimeCard?.word)
    }

    @Test
    fun `commandes de la régie, Passer et lancer depuis la présentation`() {
        val g = aLaPresentation()
        assertEquals(CommandStatus.APPLIED, g.execute(Command.MimeStart("c1", g.state.lastSeq, "jaune"), t0 + 10_000, teams).status)
        assertEquals(CommandStatus.APPLIED, g.execute(Command.MimeSkip("c2", g.state.lastSeq), t0 + 12_000, teams).status)
        assertEquals(CommandStatus.REFUSED, g.execute(Command.MimeSkip("c3", g.state.lastSeq), t0 + 12_500, teams).status)
        assertEquals(CommandStatus.STALE, g.execute(Command.MimeSkip("c4", g.state.lastSeq - 1), t0 + 13_000, teams).status)
        assertEquals(Command.MimeSkip("x", 4), Command.decode("x", mapOf("type" to "mime_skip", "expectSeq" to 4)))
    }

    @Test
    fun `couleur lue dans le programme, seulement pour les mimes, et durée jusqu'à 5 minutes`() {
        val json = """{"id":"p","questions":[
            {"id":"m","text":"Équipe Jaune","kind":"mime","duration":300,"couleur":"#f5d000","cards":[{"word":"Chat"}]},
            {"id":"p","text":"Pictionary","kind":"pictionary","couleur":"#F5D000","cards":[{"word":"Chat"}]},
            {"id":"n","text":"Mimes","kind":"mime","couleur":"jaune","cards":[{"word":"Chat"}]}]}"""
        val q = QuizJson.parse(json).questions
        assertEquals("#F5D000", q[0].couleur)
        assertEquals(300, q[0].durationSec)
        assertNull(q[1].couleur)
        assertNull(q[2].couleur)
        assertFailsWith<IllegalArgumentException> {
            Question("m", "Mimes", emptyList(), correct = -1, durationSec = 301, kind = QuestionKind.MIME, cards = jaunes)
        }
    }

    @Test
    fun `un jeu ajoute apres la manche des mimes en file pendant un tour est accepte et garde tout`() {
        // Test du 27/10 au soir : « ＋ Jeu » → Blind test → « Ajouter après la manche actuelle », deux fois rien.
        val blind = Question("b1", "Quel est ce titre ?", listOf("Titre A", "Titre B"), correct = 0, durationSec = 30, roundTitle = "Blind test")
        val avecBlind = quiz.copy(questions = quiz.questions.take(3) + blind + quiz.questions.drop(3))
        val etapes = listOf<(Game) -> Any?>(
            { it },
            { it.mimeStart("jaune", t0 + 10_000) },
            { it.mimeFound(t0 + 12_000) },
            { it.mimeSkip(t0 + 14_000) },
            { it.mimePass(t0 + 16_000) },
            { it.mimeStop(t0 + 20_000) },
        )
        val g = aLaPresentation()
        etapes.forEachIndexed { i, etape ->
            etape(g)
            assertNull(g.programProblem(avecBlind), "étape $i : programme refusé")
            val suite = assertNotNull(g.withProgram(avecBlind), "étape $i : état différent avec le jeu ajouté (${g.state.phase})")
            assertEquals(g.state.scores(), suite.state.scores())
        }
    }
}
