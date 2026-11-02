package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Chante le mot ! et Qui suis-je ? : même buzzer que l'image floue, sans photo. */
class JeuxAuBuzzerTest {

    private val chante = Question("c1", "soleil", listOf("soleil"), 0, durationSec = 30, kind = QuestionKind.CHANTE, roundTitle = "Chante le mot !")
    private val indices = listOf("Je vis dans la savane", "J'ai une crinière", "Je rugis très fort", "On m'appelle le roi des animaux").map { MimeCard(it) }
    private val quiSuis = Question("p1", "Qui suis-je ?", listOf("Le lion"), 0, durationSec = 40, kind = QuestionKind.QUISUIS, cards = indices, emoji = "🦁")
    private val t0 = 1_000_000L

    @Test
    fun `chante le mot, premier buzz, la régie valide, 150 points`() {
        val g = Game(Quiz("p", "P", listOf(chante, quiSuis))).apply { next(t0) }
        assertTrue(chante.isBuzz)
        assertEquals(true, Codec.publicState(g)["buzzOpen"])
        assertEquals("chante", Codec.publicState(g)["kind"])
        g.buzz("rose", t0 + 3_000)
        assertNull(g.deadline())
        g.judgeBuzz(true, t0 + 8_000)
        assertEquals(mapOf("rose" to Scoring.BUZZ), g.state.scores())
        assertEquals(Phase.REVEAL, g.state.phase)
    }

    @Test
    fun `qui suis-je, un indice de plus à intervalles réguliers, le rebond vaut 100`() {
        assertEquals(1, quiSuis.cluesShown(0))
        assertEquals(1, quiSuis.cluesShown(9_999))
        assertEquals(2, quiSuis.cluesShown(10_000))
        assertEquals(4, quiSuis.cluesShown(39_000))
        assertEquals(4, quiSuis.cluesShown(80_000))
        assertEquals(0, chante.cluesShown(10_000))
        val g = Game(Quiz("p", "P", listOf(quiSuis))).apply { next(t0) }
        assertNull(Codec.publicState(g)["choices"], "la réponse reste cachée sur les pupitres")
        g.buzz("rose", t0 + 12_000)
        g.judgeBuzz(false, t0 + 15_000)
        g.buzz("bleu", t0 + 20_000)
        g.judgeBuzz(true, t0 + 22_000)
        assertEquals(mapOf("bleu" to Scoring.BUZZ_REBOUND), g.state.scores())
        assertEquals(listOf("Le lion"), Codec.publicState(g)["choices"])
    }

    @Test
    fun `se lisent depuis une prestation, une seule réponse et des indices obligatoires`() {
        val quiz = QuizJson.parse(
            """{"id":"p","questions":[
              {"id":"c","text":"maman","choices":["maman"],"correct":0,"kind":"chante","duration":30},
              {"id":"q","text":"Qui suis-je ?","choices":["Le lion"],"correct":0,"kind":"quisuis","duration":40,"image":"🦁",
               "cards":[{"word":"Je rugis"},{"word":"J'ai une crinière"}]}]}""",
        )
        assertEquals(listOf(QuestionKind.CHANTE, QuestionKind.QUISUIS), quiz.questions.map { it.kind })
        assertEquals(2, quiz.questions[1].cards.size)
        assertEquals("🦁", quiz.questions[1].emoji)
        assertFailsWith<IllegalArgumentException> { Question("x", "Qui ?", listOf("A"), 0, kind = QuestionKind.QUISUIS, cards = listOf(MimeCard("seul"))) }
        assertFailsWith<IllegalArgumentException> { Question("x", "mot", listOf("a", "b"), 0, kind = QuestionKind.CHANTE) }
    }

    @Test
    fun `une tablette qui decroche pendant la reponse orale ne met pas en pause, le verdict passe`() {
        // Test du 30/10 au soir : un fantôme décroche après un buzz, pause automatique, le verdict de Sarah refusé.
        val g = Game(Quiz("p", "P", listOf(quiSuis))).apply { next(t0) }
        assertTrue(g.pauseAutoPossible(t0 + 2_000), "chrono qui court : une tablette coupée met en pause")
        g.buzz("rose", t0 + 3_000)
        assertEquals(false, g.pauseAutoPossible(t0 + 7_000), "réponse orale : pas de pause automatique")
        g.judgeBuzz(false, t0 + 8_000)
        assertTrue(g.pauseAutoPossible(t0 + 9_000), "après une mauvaise réponse le chrono repart : la pause redevient possible")
        g.buzz("bleu", t0 + 10_000)
        assertEquals(false, g.pauseAutoPossible(t0 + 11_000))
        g.judgeBuzz(true, t0 + 12_000)
        assertEquals(Phase.REVEAL, g.state.phase, "le verdict passe")
        assertEquals(false, g.pauseAutoPossible(t0 + 13_000), "révélation : rien ne court")
    }

    @Test
    fun `en pause, le verdict reste refuse (la regie doit d'abord reprendre)`() {
        val g = Game(Quiz("p", "P", listOf(chante))).apply { next(t0) }
        g.buzz("rose", t0 + 3_000)
        g.pause(t0 + 4_000)
        assertNull(g.judgeBuzz(true, t0 + 5_000))
        assertEquals(false, g.pauseAutoPossible(t0 + 5_000), "déjà en pause")
        g.resume(t0 + 6_000)
        g.judgeBuzz(true, t0 + 12_000)
        assertEquals(Phase.REVEAL, g.state.phase)
    }

    @Test
    fun `chante le mot gagne au premier mot, compte entier au bilan du jeu (jauges du tableau des scores)`() {
        // Cedric, 1/11 au soir : 100 points gagnés à Chante le mot, vus pendant le jeu, mais qui ne montaient pas dans la
        // jauge du bilan de fin de jeu (elle ne montait que des points de la dernière question).
        val mots = listOf("soleil", "maman", "école").mapIndexed { i, m -> Question("c$i", m, listOf(m), 0, durationSec = 30, kind = QuestionKind.CHANTE, roundTitle = "Chante le mot !") }
        val apres = Question("q1", "Couleur du ciel ?", listOf("Bleu", "Vert"), 0, durationSec = 20, roundTitle = "Quiz")
        val g = Game(Quiz("p", "P", mots + apres)).apply { next(t0) }
        g.buzz("rose", t0 + 2_000)
        g.judgeBuzz(true, t0 + 4_000)
        var t = t0 + 10_000
        while (g.state.phase != Phase.SCORES) {
            assertTrue(t < t0 + 1_000_000, "le bilan du jeu arrive")
            g.next(t)
            t += 40_000

        }
        assertEquals(mapOf("rose" to Scoring.BUZZ), g.gameGains())
        assertEquals(g.state.scores(), g.gameGains())
    }
}
