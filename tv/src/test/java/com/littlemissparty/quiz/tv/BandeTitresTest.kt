package com.littlemissparty.quiz.tv

import com.littlemissparty.quiz.tv.habillage.BANDE_TITRE_ALPHA
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Game Show : la bande sombre derrière les titres et les règles des jeux (choix C de cedric, planche Pictionary du 29/10). */
class BandeTitresTest {

    @Test
    fun `la bande laisse deviner le decor et ne touche pas au Classique`() {
        assertTrue(BANDE_TITRE_ALPHA in 0.45f..0.75f)
        val source = File("src/main/java/com/littlemissparty/quiz/tv/habillage/PanneauJeu.kt").readText()
        assertTrue(source.contains("internal fun Modifier.bandeTitre(): Modifier =\n    if (!Look.gs) this"))
    }

    @Test
    fun `Mimes et Pictionary n'ont plus de bande, plus de regle sous le logo (1-11)`() {
        val mimes = File("src/main/java/com/littlemissparty/quiz/tv/MimeScreens.kt").readText()
        assertFalse(mimes.contains("bandeTitre()"))
        val picto = File("src/main/java/com/littlemissparty/quiz/tv/PictionaryScreens.kt").readText()
        assertFalse(picto.contains("bandeTitre()"))
        // Plus de règle écrite sous le logo (cedric, 1/11 au soir) : le logo seul.
        assertFalse(picto.contains("Un enfant dessine"))
        // Les plaques des équipes : noir au contour néon en Game Show.
        assertTrue(picto.contains("Look.gs -> Neon.Nuit.copy(alpha = 0.88f)"))
    }
}
