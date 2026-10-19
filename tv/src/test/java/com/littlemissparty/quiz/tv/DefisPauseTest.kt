package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DefisPauseTest {
    @Test
    fun `sans liste enregistree, les defis d'origine avec le prenom`() {
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
    fun `liste de la regie, prenom ecrit de plusieurs facons`() {
        val defis = defisPour("Tom", listOf("Bravo [Prénom] !", "Dansez pour [prenom] !", "Ola !"))
        assertEquals(listOf("Bravo Tom !", "Dansez pour Tom !", "Ola !"), defis)
    }

    @Test
    fun `liste qui ne contient que des defis avec prenom, sans prenom, jamais d'ecran vide`() {
        val defis = defisPour("", listOf("Bravo [prénom] !"))
        assertTrue(defis.isNotEmpty())
        assertTrue(defis.none { "[" in it })
    }

    @Test
    fun `lecture de la base, textes nettoyes, liste vide ignoree`() {
        assertEquals(listOf("Ola !", "Sautez"), lireDefis(listOf("  Ola   ! ", null, "", "Sautez")))
        assertNull(lireDefis(listOf(null, "  ")))
        assertNull(lireDefis(emptyList()))
    }
}
