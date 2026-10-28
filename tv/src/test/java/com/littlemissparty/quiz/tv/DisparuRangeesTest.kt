package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Qui a disparu ? : 4, 6 ou 8 objets (Régie PC, cedric 27/10) toujours sur 2 rangées égales à la TV. */
class DisparuRangeesTest {

    @Test
    fun `4, 6 ou 8 objets font deux rangees egales`() {
        for (n in listOf(4, 6, 8)) {
            val colonnes = colonnesDisparu(n)
            assertEquals("$n objets : 2 rangées", 2, (n + colonnes - 1) / colonnes)
            assertEquals("$n objets : rangées égales", 0, n % colonnes)
        }
    }

    @Test
    fun `la photo d une carte tient en entier dans sa tuile, portrait ou paysage, jamais coupee`() {
        // Tuiles larges et basses (test du 27/10 au soir), carrées ou hautes ; photos en portrait, carrées, en paysage.
        for ((l, h) in listOf(133f to 32f, 150f to 60f, 100f to 100f, 80f to 140f)) {
            for ((pl, ph) in listOf(600f to 900f, 512f to 512f, 3840f to 2160f)) {
                val (w, z) = photoDansTuile(l, h, pl, ph)
                assertTrue("$pl x $ph dans $l x $h : tient en largeur", w <= l + 0.01f)
                assertTrue("$pl x $ph dans $l x $h : tient en hauteur", z <= h + 0.01f)
                assertTrue("$pl x $ph dans $l x $h : la plus grande possible", w >= l - 0.01f || z >= h - 0.01f)
                assertEquals("$pl x $ph : mêmes proportions, rien de coupé ni d'écrasé", pl / ph, w / z, 0.01f)
            }
        }
        assertEquals("photo abîmée : rien", 0f to 0f, photoDansTuile(100f, 100f, 0f, 0f))
    }

    /** Choix A de cedric (28/10) : cartes en grand sans l'enseigne, mais elle revient quand il n'y a rien à voir. */
    @Test
    fun `l enseigne revient au debut de chaque grille et au tour de magie, jamais quand on regarde les cartes`() {
        assertTrue("A par défaut", PropositionDisparu.sansEnseigne)
        assertTrue(enseigneDisparuVisible(EtapeDisparu.MEMORISER, 0))
        assertTrue(enseigneDisparuVisible(EtapeDisparu.MEMORISER, DISPARU_ENSEIGNE_DEBUT_MS - 1))
        assertTrue(enseigneDisparuVisible(EtapeDisparu.MAGIE, 12_000))
        assertFalse("les cartes à mémoriser", enseigneDisparuVisible(EtapeDisparu.MEMORISER, DISPARU_ENSEIGNE_DEBUT_MS))
        assertFalse("on cherche", enseigneDisparuVisible(EtapeDisparu.CHERCHER, 0))
        assertFalse("on cherche", enseigneDisparuVisible(EtapeDisparu.CHERCHER, 20_000))
        assertFalse("la réponse", enseigneDisparuVisible(EtapeDisparu.REPONSE, 0))
        // Au plus 2 s volées aux cartes à mémoriser (10 s pour 4 objets).
        assertTrue(DISPARU_ENSEIGNE_DEBUT_MS <= 2_000)
    }
}
