package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BombeCacheeTest {

    @Test
    fun `les coffres tiennent sur 1 a 3 rangees, l'avant recoit les coffres en plus`() {
        assertEquals(listOf(5, 5), repartitionCoffres(10))
        assertEquals(listOf(4, 5, 5), repartitionCoffres(14))
        assertEquals(listOf(6, 6, 6), repartitionCoffres(18))
        assertEquals(listOf(4), repartitionCoffres(4))
        assertEquals(emptyList<Int>(), repartitionCoffres(0))
        for (n in 1..21) {
            val r = repartitionCoffres(n)
            assertEquals(n, r.sum())
            assertTrue("au plus 7 coffres par rangée pour $n", r.all { it <= 7 })
        }
    }

    @Test
    fun `le texte des points utilise le vrai signe moins`() {
        assertEquals("+150 POINTS", textePointsCoffre(150))
        assertEquals("−100 POINTS", textePointsCoffre(-100))
        assertEquals("−300 POINTS", textePointsCoffre(null))
        // La bombe affiche ce qu'elle a vraiment retiré ; 0 quand l'équipe n'avait rien à perdre.
        assertEquals("−120 POINTS", textePointsCoffre(null, -120))
        assertEquals("0 POINT", textePointsCoffre(null, 0))
        assertEquals("0 POINT", textePointsCoffre(0))
    }

    @Test
    fun `chaque coffre a un modele stable, les memes que sur les tablettes`() {
        assertEquals(18, MODELES_COFFRES.size)
        assertTrue(MODELES_COFFRES.all { it in 0..5 })
        assertEquals(modeleCoffre(3), modeleCoffre(21))
        // Deux coffres voisins d'une même rangée n'ont jamais le même modèle.
        for (n in listOf(10, 14, 18)) {
            var i = 0
            repartitionCoffres(n).forEach { k ->
                for (j in i until i + k - 1) assertTrue("coffres ${j + 1} et ${j + 2} ($n)", modeleCoffre(j) != modeleCoffre(j + 1))
                i += k
            }
        }
    }
}
