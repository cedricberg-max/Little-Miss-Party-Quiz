package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** BONUS / MALUS de la régie : un à la fois, dans l'ordre, sans en perdre ni en montrer deux fois. */
class FileDesCoupsTest {

    private fun coup(id: Int, equipe: String, delta: Int, avant: Int) =
        CoupDeScore(id, equipe, "Équipe $equipe", "#FF2D8A", delta, avant, avant + delta)

    @Test
    fun `un coup arrive seul, il se montre tout de suite puis la file se vide`() {
        val f = FileDesCoups()
        assertEquals(1, f.ajouter(coup(1, "a", 100, 0))?.id)
        assertNull(f.fini(1))
        assertNull(f.courant)
    }

    @Test
    fun `des corrections rapides attendent leur tour, dans l'ordre`() {
        val f = FileDesCoups()
        f.ajouter(coup(1, "a", 100, 0))
        f.ajouter(coup(2, "b", -50, 300))
        f.ajouter(coup(3, "a", 150, 100))
        assertEquals(1, f.courant?.id)
        assertEquals(2, f.fini(1)?.id)
        assertEquals(3, f.fini(2)?.id)
        assertNull(f.fini(3))
    }

    @Test
    fun `chaque validation a sa propre animation, au montant exact, meme pour la meme equipe`() {
        val f = FileDesCoups()
        f.ajouter(coup(1, "b", 50, 0))
        f.ajouter(coup(2, "a", 150, 200))
        f.ajouter(coup(3, "a", 100, 350))
        assertEquals(150, f.fini(1)?.delta)
        assertEquals(100, f.fini(2)?.delta)
        assertNull(f.fini(3))
    }

    @Test
    fun `un meme evenement recu deux fois ne s'anime qu'une fois`() {
        val f = FileDesCoups()
        f.ajouter(coup(1, "a", 150, 0))
        f.ajouter(coup(1, "a", 150, 0))
        assertNull(f.fini(1))
        f.ajouter(coup(1, "a", 150, 0))
        assertNull(f.courant)
    }

    @Test
    fun `le coup deja a l'ecran ne change jamais, un bonus puis un malus restent deux animations`() {
        val f = FileDesCoups()
        f.ajouter(coup(1, "a", 100, 0))
        f.ajouter(coup(2, "a", 100, 100))
        assertEquals(100, f.courant?.delta)
        f.ajouter(coup(3, "a", -50, 200))
        assertEquals(2, f.fini(1)?.id)
        assertEquals(-50, f.fini(2)?.delta)
    }

    @Test
    fun `une fin d'animation perimee ne saute pas le coup suivant`() {
        val f = FileDesCoups()
        f.ajouter(coup(1, "a", 100, 0))
        f.ajouter(coup(2, "b", 100, 0))
        assertEquals(2, f.fini(1)?.id)
        assertEquals(2, f.fini(1)?.id)
        assertEquals(2, f.courant?.id)
    }

    @Test
    fun `une avalanche garde les dernieres corrections, la partie rouverte vide tout`() {
        val f = FileDesCoups(max = 3)
        f.ajouter(coup(1, "a", 10, 0))
        listOf("b", "c", "d", "e", "f").forEachIndexed { i, e -> f.ajouter(coup(i + 2, e, 10, 0)) }
        assertEquals(1, f.courant?.id)
        assertEquals(listOf(4, 5, 6), generateSequence(f.fini(1)) { f.fini(it.id) }.map { it.id }.toList())
        f.ajouter(coup(7, "a", 10, 0))
        f.vider()
        assertNull(f.courant)
        assertNull(f.fini(7))
    }
}
