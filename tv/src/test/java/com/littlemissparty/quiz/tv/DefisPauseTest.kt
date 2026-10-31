package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DefisPauseTest {
    @Test
    fun `sans defi en plus, les 7 defis de base avec le prenom`() {
        val defis = defisPour("Léa", null)
        assertEquals(DEFIS_PAR_DEFAUT.size, defis.size)
        assertTrue("Un tonnerre d'applaudissements pour Léa !" in defis)
    }

    @Test
    fun `sans prenom, le defi qui le demande est ecarte`() {
        val defis = defisPour("  ", null)
        assertEquals(DEFIS_PAR_DEFAUT.size - 1, defis.size)
        assertTrue(defis.none { "prénom" in it })
    }

    @Test
    fun `defis en plus de la fete, a la suite des 7 de base, prenom ecrit de plusieurs facons`() {
        val defis = defisPour("Tom", listOf("Bravo [Prénom] !", "Dansez pour [prenom] !", "Ola !"))
        assertEquals(DEFIS_PAR_DEFAUT.size + 3, defis.size)
        assertEquals(listOf("Bravo Tom !", "Dansez pour Tom !", "Ola !"), defis.takeLast(3))
        assertTrue("Tout le monde fait la ola !" in defis)
    }

    @Test
    fun `un defi en plus identique a un defi de base n'est montre qu'une fois`() {
        val defis = defisPour("Tom", listOf("Tout le monde fait la ola !", "Sautez !"))
        assertEquals(DEFIS_PAR_DEFAUT.size + 1, defis.size)
        assertEquals(1, defis.count { it == "Tout le monde fait la ola !" })
    }

    @Test
    fun `defis en plus avec prenom, sans prenom, jamais d'ecran vide`() {
        val defis = defisPour("", listOf("Bravo [prénom] !"))
        assertEquals(DEFIS_PAR_DEFAUT.size - 1, defis.size)
        assertTrue(defis.none { "[" in it })
    }

    @Test
    fun `lecture de la base, textes nettoyes, liste vide ignoree`() {
        assertEquals(listOf("Ola !", "Sautez"), lireDefis(listOf("  Ola   ! ", null, "", "Sautez")))
        assertNull(lireDefis(listOf(null, "  ")))
        assertNull(lireDefis(emptyList()))
    }

    @Test
    fun `nouvelle partie sans defi en plus, ceux de la precedente ne suivent pas`() {
        DefisPause.enPlus.value = listOf("Ancien défi")
        DefisPause.lire(null)
        assertNull(DefisPause.enPlus.value)
    }
}
