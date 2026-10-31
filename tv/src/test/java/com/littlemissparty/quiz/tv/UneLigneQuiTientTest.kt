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
}
