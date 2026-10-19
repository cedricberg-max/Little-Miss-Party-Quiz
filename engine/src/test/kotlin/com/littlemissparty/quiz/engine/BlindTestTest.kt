package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Blind test : l'extrait suit le chrono, le buzz le fige, l'animatrice valide le titre (et l'artiste). */
class BlindTestTest {

    private val audio = "0123456789abcdef"
    private fun blind(id: String) = Question(id, "Quel est ce titre ?", listOf("Libérée, délivrée"), 0, durationSec = 30, kind = QuestionKind.BLIND, artist = "La Reine des neiges", audioId = audio, roundTitle = "Blind test")
    private val t0 = 1_000_000L
    private fun game(vararg q: Question) = Game(Quiz("p", "P", q.toList())).apply { next(t0) }

    @Test
    fun `buzz dans les 10 premières secondes, titre et artiste, 150 plus 50`() {
        val g = game(blind("b1"))
        assertTrue(blind("b1").isBuzz)
        assertEquals(true, Codec.publicState(g)["buzzOpen"])
        assertNull(Codec.publicState(g)["choices"], "le titre reste caché sur les pupitres")
        assertNull(Codec.publicState(g)["artist"])
        g.buzz("rose", t0 + 6_000)
        assertNull(g.deadline(), "la musique et le chrono se figent pendant la réponse")
        val r = g.execute(Command.decode("c1", mapOf("type" to "buzz_bonus", "expectSeq" to g.state.lastSeq))!!, t0 + 9_000, setOf("rose"), emptyMap())
        assertEquals(CommandStatus.APPLIED, r.status)
        assertEquals(mapOf("rose" to Scoring.BUZZ + Scoring.BLIND_ARTIST), g.state.scores())
        assertEquals(Scoring.BLIND_ARTIST, g.state.awards["b1"]!!["rose"]!!.bonus)
        assertEquals("La Reine des neiges", Codec.publicState(g)["artist"])
        assertEquals(listOf("Libérée, délivrée"), Codec.publicState(g)["choices"])
    }

    @Test
    fun `buzz tardif 100, mauvaise réponse puis reprise de l'extrait là où il s'était arrêté`() {
        val g = game(blind("b1"))
        g.buzz("rose", t0 + 4_000)
        g.judgeBuzz(false, t0 + 7_000)
        // L'extrait repart à 4 s : 26 s restantes à partir du verdict.
        assertEquals(t0 + 7_000 + 26_000, g.deadline())
        g.buzz("bleu", t0 + 7_000 + 8_000)
        // Rebond : 100, même avec le bonus artiste ; le bonus ne compte qu'avec une bonne réponse.
        g.judgeBuzz(true, t0 + 20_000, bonus = true)
        assertEquals(mapOf("bleu" to Scoring.BUZZ_REBOUND + Scoring.BLIND_ARTIST), g.state.scores())

        val late = game(blind("b2"))
        late.buzz("vert", t0 + 12_000)
        late.judgeBuzz(true, t0 + 14_000)
        assertEquals(mapOf("vert" to Scoring.BUZZ_REBOUND), late.state.scores())
    }

    @Test
    fun `pause pendant l'extrait, Super Finale doublée, un mauvais verdict n'a pas de bonus`() {
        val g = game(blind("b1").copy(double = true))
        g.pause(t0 + 3_000)
        assertNull(g.deadline())
        g.resume(t0 + 60_000, countdownMs = 3_000)
        g.buzz("rose", t0 + 63_000 + 5_000)
        // 3 s avant la pause + 5 s après la reprise = 8 s d'extrait : plein tarif, doublé.
        g.judgeBuzz(true, t0 + 70_000, bonus = true)
        assertEquals(mapOf("rose" to (Scoring.BUZZ + Scoring.BLIND_ARTIST) * 2), g.state.scores())

        val ko = game(blind("b2"))
        ko.buzz("rose", t0 + 1_000)
        ko.judgeBuzz(false, t0 + 2_000, bonus = true)
        assertEquals(emptyMap(), ko.state.scores())
        assertEquals(listOf("rose"), ko.state.buzz!!.blocked)
    }

    @Test
    fun `se lit depuis une prestation, journal relu à l'identique, quiz musical à propositions`() {
        val quiz = QuizJson.parse(
            """{"id":"p","questions":[
              {"id":"b","text":"Quel est ce titre ?","choices":["Libérée, délivrée"],"correct":0,"kind":"blind","duration":30,"artist":" La Reine des neiges ","audioId":"$audio"},
              {"id":"m","text":"Quel est ce titre ?","choices":["A","B","C","D"],"correct":2,"audioId":"$audio","artist":"ignoré hors blind test"},
              {"id":"x","text":"Sans extrait","choices":["Titre"],"correct":0,"kind":"blind","audioId":"pas-une-empreinte"}]}""",
        )
        assertEquals(listOf(QuestionKind.BLIND, QuestionKind.CLASSIC, QuestionKind.BLIND), quiz.questions.map { it.kind })
        assertEquals("La Reine des neiges", quiz.questions[0].artist)
        assertEquals(audio, quiz.questions[1].audioId)
        assertNull(quiz.questions[1].artist)
        assertNull(quiz.questions[2].audioId, "une empreinte mal formée est ignorée, sans refuser la prestation")

        val g = Game(quiz).apply { next(t0) }
        g.buzz("rose", t0 + 2_000)
        g.judgeBuzz(true, t0 + 3_000, bonus = true)
        val replay = Game(quiz).apply { g.events.forEach { record(Codec.decode(Codec.encode(it))!!) } }
        assertEquals(g.state.scores(), replay.state.scores())
    }
}
