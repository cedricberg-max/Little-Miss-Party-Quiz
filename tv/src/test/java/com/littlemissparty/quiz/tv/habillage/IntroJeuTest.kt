package com.littlemissparty.quiz.tv.habillage

import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.engine.QuestionKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class IntroJeuTest {

    // Une vraie question de quiz (photos ou extrait) ; les autres jeux sont reconnus à leur type seul
    // (familleType(kind)) : chacun a ses propres règles de construction (voir Question.init).
    private fun question(images: List<String?> = emptyList(), audio: String? = null) =
        Question("q1", "Combien ?", listOf("1", "2", "3", "4"), 0, choiceImages = images, audioId = audio)

    @Test
    fun `chaque jeu a son intro video et la bonne`() {
        val attendu = mapOf(
            QuestionKind.CLASSIC to "quiz", QuestionKind.TRUE_FALSE to "quiz", QuestionKind.EXPRESS to "vraifaux",
            QuestionKind.MIME to "mimes", QuestionKind.PICTIONARY to "picto", QuestionKind.BLIND to "blind",
            QuestionKind.ZOOM to "zoom", QuestionKind.FLOU to "floue", QuestionKind.CHANTE to "chante",
            QuestionKind.QUISUIS to "quisuisje", QuestionKind.DISPARU to "disparu", QuestionKind.STATUES to "statues",
            QuestionKind.COFFRES to "coffres", QuestionKind.GONFLEUR to "gonfleur", QuestionKind.PATATE to "patate",
            QuestionKind.DUEL to "duel", QuestionKind.SIMON to "simon",
        )
        for ((kind, nom) in attendu) assertEquals("$kind", nom, nomIntroJeu(familleType(kind)))
        assertEquals("illustre", nomIntroJeu(familleJeu(question(images = listOf("a", "b", null, "d")))))
        assertEquals("musical", nomIntroJeu(familleJeu(question(audio = "s1"))))
        // Sans question (écran pas encore chargé) : l'intro du quiz.
        assertEquals("quiz", nomIntroJeu(familleJeu(null)))
    }

    @Test
    fun `l'intro du duel joue une fois puis tient son titre, les autres tournent en boucle`() {
        assertEquals(REPRISE_INTRO_DUEL_MS, repriseIntroJeu("duel"))
        assertNull(repriseIntroJeu("quiz"))
        assertNull(repriseIntroJeu("mimes"))
    }

    @Test
    fun `juste chiffre et portes gardent leur ecran dessine`() {
        assertNull(nomIntroJeu(familleType(QuestionKind.NUMBER)))
        assertNull(nomIntroJeu(familleType(QuestionKind.PORTES)))
    }

    @Test
    fun `le simon du prof a son embleme`() {
        assertEquals("🔴", emblemeJeu("simon").emoji)
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
    fun `chaque intro est bien dans l'appli et reste facile a decoder`() {
        val noms = QuestionKind.entries.mapNotNull { nomIntroJeu(familleType(it)) } + listOf("illustre", "musical")
        for (nom in noms.toSet()) {
            val f = File("src/main/res/raw/gs_intro_$nom.mp4")
            assertTrue("gs_intro_$nom.mp4 manquant", f.isFile)
            // 16 s en 1080p. La place n'est plus une limite (cedric, 24/10 : « on peut même exagérer ») ; le débit, si :
            // au plus 12 Mbit/s en moyenne, ce que le décodeur de la Mi Box lit sans peine (16 s × 12 Mbit/s = 24 Mo).
            assertTrue("gs_intro_$nom.mp4 trop lourd pour la box : ${f.length()} octets", f.length() < 24_000_000)
        }
    }
    @Test
    fun `le decor reste noir des que l'intro d'un jeu va passer, jamais l'image fixe entre deux videos`() {
        assertTrue(introJeuEnVue(gameShow = true, phase = Phase.QUESTION, presentation = true, enPause = false, famille = "quiz"))
        // En pause, l'intro s'arrête : le plateau reprend son fond.
        assertFalse(introJeuEnVue(gameShow = true, phase = Phase.QUESTION, presentation = true, enPause = true, famille = "quiz"))
        // Après « Lancer l'épreuve », en Classique, ou pour un jeu sans intro vidéo : rien ne change.
        assertFalse(introJeuEnVue(gameShow = true, phase = Phase.QUESTION, presentation = false, enPause = false, famille = "quiz"))
        assertFalse(introJeuEnVue(gameShow = false, phase = Phase.QUESTION, presentation = true, enPause = false, famille = "quiz"))
        assertFalse(introJeuEnVue(gameShow = true, phase = Phase.QUESTION, presentation = true, enPause = false, famille = "inconnu"))
        assertFalse(introJeuEnVue(gameShow = true, phase = Phase.SCORES, presentation = true, enPause = false, famille = "quiz"))
    }
}
