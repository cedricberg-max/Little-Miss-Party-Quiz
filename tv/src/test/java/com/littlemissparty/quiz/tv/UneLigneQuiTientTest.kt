package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mimes, audit du 31/10 (choix B) : le nom en entier sur une ligne, rapetissé plutôt que coupé. */
class UneLigneQuiTientTest {
    @Test
    fun `un nom qui tient garde sa taille`() {
        assertEquals(1f, echelleUneLigne(120, 150, 0.55f), 0f)
        assertEquals(1f, echelleUneLigne(150, 150, 0.55f), 0f)
    }

    @Test
    fun `un nom trop long rapetisse juste assez, jamais sous le minimum`() {
        assertEquals(0.75f, echelleUneLigne(200, 150, 0.55f), 0.001f)
        assertEquals(0.55f, echelleUneLigne(1000, 150, 0.55f), 0f)
    }

    @Test
    fun `gonfleur et ca va exploser a 1-5 equipes rapetissent le nom, jamais de points de suspension`() {
        // Tour des écrans à 5 équipes (31/10) : « Les Comètes Filant… » sous le ballon et sous la bombe.
        for (chemin in listOf("habillage/Gonfleur.kt", "habillage/Patate.kt")) {
            val source = java.io.File("src/main/java/com/littlemissparty/quiz/tv/$chemin").readText()
            val apres = source.substringAfter("} else UneLigneQuiTient")
            assertTrue(chemin, source.contains("} else UneLigneQuiTient"))
            assertTrue(chemin, apres.substringBefore("\n                }").contains("softWrap = false"))
            assertFalse(chemin, apres.substringBefore("\n                }").contains("Ellipsis"))
        }
    }

    @Test
    fun `NomUneLigne ne finit jamais par des points de suspension`() {
        // Tour des écrans à 4 équipes (31/10, Statues) : « Les Comètes Fila… » dans une tuile BRAVO.
        val source = java.io.File("src/main/java/com/littlemissparty/quiz/tv/habillage/LaParole.kt").readText()
        val corps = source.substringAfter("internal fun NomUneLigne(").substringBefore("\n}\n")
        assertTrue(corps.contains("UneLigneQuiTient("))
        assertFalse(corps.contains("Ellipsis"))
    }

    @Test
    fun `pastille d equipe Game Show a 1-4 equipes jamais de points de suspension sur le nom`() {
        // Tour des écrans à 4 équipes (31/10, Statues) : « Les Comètes Fila… » dans la pastille du bandeau.
        val source = java.io.File("src/main/java/com/littlemissparty/quiz/tv/GameShowQuiz.kt").readText()
        val colonne = source.substringAfter("internal fun TeamStatusGs(").substringAfter("} else Column(").substringBefore("\n    }\n}")
        assertTrue(colonne.contains("UneLigneQuiTient("))
        assertFalse(colonne.substringBefore("Statut()").contains("Ellipsis"))
    }
}
