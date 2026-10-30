package com.littlemissparty.quiz.tv

import com.littlemissparty.quiz.tv.habillage.BANDE_TITRE_ALPHA
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Game Show : la bande sombre derrière les titres et les règles des jeux (choix C de cedric, planche Pictionary du 29/10). */
class BandeTitresTest {

    @Test
    fun `la regle du Pictionary, trois lignes en Game Show, deux en Classique, meme texte`() {
        val gs = reglePictionary(90, 150, gs = true)
        val classique = reglePictionary(90, 150, gs = false)
        assertEquals(3, gs.lines().size)
        assertEquals(2, classique.lines().size)
        assertEquals(gs.replace("\n", " "), classique.replace("\n", " "))
        assertTrue(gs.endsWith("Son équipe a 90 secondes pour trouver le mot : 150 points !"))
    }

    @Test
    fun `la bande laisse deviner le decor et ne touche pas au Classique`() {
        assertTrue(BANDE_TITRE_ALPHA in 0.45f..0.75f)
        val source = File("src/main/java/com/littlemissparty/quiz/tv/habillage/PanneauJeu.kt").readText()
        assertTrue(source.contains("internal fun Modifier.bandeTitre(): Modifier =\n    if (!Look.gs) this"))
    }

    @Test
    fun `Mimes et Pictionary ont la bande derriere le titre et la regle, sans cadre`() {
        val mimes = File("src/main/java/com/littlemissparty/quiz/tv/MimeScreens.kt").readText()
        assertTrue(mimes.contains("Column(Modifier.fillMaxWidth().bandeTitre(), horizontalAlignment = Alignment.CenterHorizontally)"))
        val picto = File("src/main/java/com/littlemissparty/quiz/tv/PictionaryScreens.kt").readText()
        assertTrue(picto.contains("modifier = Modifier.bandeTitre(),"))
        // Les plaques des équipes : noir au contour néon en Game Show.
        assertTrue(picto.contains("Look.gs -> Neon.Nuit.copy(alpha = 0.88f)"))
    }
}
