package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Reprise d'une partie après un arrêt de l'appli (25/10 au soir) : la box ne relit que l'essentiel, jamais les médias
 * copiés par la régie (des dizaines de Mo, « La base Firebase ne répond pas » à chaque essai).
 */
class RepriseLegereTest {
    private val source = File("src/main/java/com/littlemissparty/quiz/tv/GameViewModel.kt").readText()

    @Test
    fun `la reprise ne relit jamais les chansons ni les photos de la partie`() {
        for (media in listOf("sounds", "images", "choiceImages", "media")) {
            assertTrue("« $media » relu à la reprise", media !in CLES_REPRISE)
        }
    }

    @Test
    fun `tout ce que l'ouverture d'une partie lit fait partie des morceaux relus`() {
        // Chaque `partie.child("…")` de l'ouverture, de la proposition de reprise et du refus des envois d'avant le
        // changement de box : son premier morceau doit être relu, sinon la reprise planterait.
        val lus = Regex("""partie\.child\("([A-Za-z]+)""").findAll(source).map { it.groupValues[1] }.toSet()
        assertTrue("aucune lecture trouvée", lus.size > 8)
        val manquants = lus - CLES_REPRISE.toSet()
        assertEquals("morceaux lus mais jamais relus à la reprise", emptySet<String>(), manquants)
    }

    @Test
    fun `plus aucune lecture de la partie entiere`() {
        val entieres = Regex("""getReference\("games/\$\w+"\)\.readOnce\(""").findAll(source).map { it.value }.toList()
        assertEquals(emptyList<String>(), entieres)
    }
}
