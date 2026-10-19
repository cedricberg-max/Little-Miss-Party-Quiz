package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PictionaryTest {

    @Test
    fun `un trait de l'ardoise se lit tel quel`() {
        val t = traitDepuis("k1", mapOf("c" to 3L, "w" to 2L, "p" to listOf(0.1, 0.2, 0.35, 0.4)))!!
        assertEquals("k1", t.id)
        assertEquals(3, t.couleur)
        assertEquals(2, t.epaisseur)
        assertArrayEquals(floatArrayOf(0.1f, 0.2f, 0.35f, 0.4f), t.points, 1e-6f)
    }

    @Test
    fun `un trait abime reste visible au lieu de disparaitre`() {
        // Couleur et épaisseur inconnues : encre noire, trait moyen. Points hors feuille : ramenés au bord.
        val t = traitDepuis("k2", mapOf("c" to 42, "w" to -1, "p" to listOf(-0.5, 1.7, 0.5)))!!
        assertEquals(0, t.couleur)
        assertEquals(1, t.epaisseur)
        // Le dernier nombre sans partenaire est ignoré.
        assertArrayEquals(floatArrayOf(0f, 1f), t.points, 1e-6f)
    }

    @Test
    fun `un trait illisible est ignore`() {
        assertNull(traitDepuis("a", null))
        assertNull(traitDepuis("b", "texte"))
        assertNull(traitDepuis("c", mapOf("c" to 1)))
        assertNull(traitDepuis("d", mapOf("p" to listOf(0.5))))
    }

    @Test
    fun `memes feutres et epaisseurs que la tablette`() {
        assertEquals(8, COULEURS_DESSIN.size)
        assertEquals(listOf(0.006f, 0.012f, 0.028f), EPAISSEURS_DESSIN)
        assertEquals(4f / 3f, RATIO_DESSIN, 1e-6f)
    }

    @Test
    fun `le crayon gratte seulement quand le trait avance`() {
        val un = TraitDessin("a", 0, 1, floatArrayOf(0.1f, 0.1f, 0.2f, 0.2f))
        val deux = TraitDessin("a", 0, 1, floatArrayOf(0.1f, 0.1f, 0.2f, 0.2f, 0.3f, 0.3f))
        assertEquals(2, pointsDessines(listOf(un)))
        assertEquals(5, pointsDessines(listOf(un, deux)))
        // Dessin déjà commencé à l'arrivée sur l'écran (TV relancée) : pas de grattement.
        assertFalse(crayonAvance(-1, 40))
        assertTrue(crayonAvance(2, 3))
        // Rien de nouveau, ou feuille effacée : le crayon se tait.
        assertFalse(crayonAvance(3, 3))
        assertFalse(crayonAvance(30, 0))
    }

    @Test
    fun `la boucle du crayon est bien dans l'appli`() {
        assertTrue(java.io.File("src/main/res/raw/$FICHIER_CRAYON.ogg").isFile)
    }
}
