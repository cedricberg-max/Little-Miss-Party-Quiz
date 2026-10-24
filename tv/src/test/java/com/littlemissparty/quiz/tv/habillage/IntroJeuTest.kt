package com.littlemissparty.quiz.tv.habillage

import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.engine.QuestionKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class IntroJeuTest {

    private fun question(kind: QuestionKind = QuestionKind.CLASSIC, images: List<String?> = emptyList(), audio: String? = null) =
        Question("q1", "Combien ?", listOf("1", "2", "3", "4"), 0, kind = kind, choiceImages = images, audioId = audio)

    @Test
    fun `chaque jeu a son intro video et la bonne`() {
        val attendu = mapOf(
            QuestionKind.CLASSIC to "quiz", QuestionKind.TRUE_FALSE to "quiz", QuestionKind.EXPRESS to "vraifaux",
            QuestionKind.MIME to "mimes", QuestionKind.PICTIONARY to "picto", QuestionKind.BLIND to "blind",
            QuestionKind.ZOOM to "zoom", QuestionKind.FLOU to "floue", QuestionKind.CHANTE to "chante",
            QuestionKind.QUISUIS to "quisuisje", QuestionKind.DISPARU to "disparu", QuestionKind.STATUES to "statues",
            QuestionKind.COFFRES to "coffres", QuestionKind.GONFLEUR to "gonfleur", QuestionKind.PATATE to "patate",
        )
        for ((kind, nom) in attendu) assertEquals("$kind", nom, nomIntroJeu(familleJeu(question(kind))))
        assertEquals("illustre", nomIntroJeu(familleJeu(question(images = listOf("a", "b", null, "d")))))
        assertEquals("musical", nomIntroJeu(familleJeu(question(audio = "s1"))))
        // Sans question (écran pas encore chargé) : l'intro du quiz.
        assertEquals("quiz", nomIntroJeu(familleJeu(null)))
    }

    @Test
    fun `juste chiffre et portes gardent leur ecran dessine`() {
        assertNull(nomIntroJeu(familleJeu(question(QuestionKind.NUMBER))))
        assertNull(nomIntroJeu(familleJeu(question(QuestionKind.PORTES))))
    }

    @Test
    fun `quiz illustre reste un quiz pour l'embleme classique`() {
        // Design classique inchangé : le quiz illustré garde l'emblème du quiz.
        val illustre = emblemeJeu(familleJeu(question(images = listOf("a", null, null, null))))
        val quiz = emblemeJeu(familleJeu(question()))
        assertEquals(quiz.emoji, illustre.emoji)
        assertEquals(quiz.couleur, illustre.couleur)
    }

    @Test
    fun `chaque intro est bien dans l'appli et reste legere`() {
        val noms = QuestionKind.entries.mapNotNull { nomIntroJeu(familleJeu(question(it))) } + listOf("illustre", "musical")
        for (nom in noms.toSet()) {
            val f = File("src/main/res/raw/gs_intro_$nom.mp4")
            assertTrue("gs_intro_$nom.mp4 manquant", f.isFile)
            // 16 s en 1080p : la box a peu de place (fil principal, 24 octobre).
            assertTrue("gs_intro_$nom.mp4 trop lourd : ${f.length()} octets", f.length() < 6_000_000)
        }
    }
}
