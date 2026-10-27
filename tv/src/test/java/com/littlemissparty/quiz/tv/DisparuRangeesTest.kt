package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
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
    fun `la tuile photo du Game Show est carree et tient dans sa case, jamais une bande etroite`() {
        // Cases d'une grille de 4, 6 ou 8 objets, larges (test du 27/10 au soir) ou hautes.
        for ((largeur, hauteur) in listOf(150f to 110f, 160f to 175f, 230f to 120f, 110f to 200f, 120f to 120f)) {
            val cote = coteTuileDisparu(largeur, hauteur)
            assertTrue("$largeur x $hauteur : la tuile a une taille", cote > 0f)
            assertTrue("$largeur x $hauteur : tient en largeur", cote + 14f <= largeur)
            assertTrue("$largeur x $hauteur : tient en hauteur avec le nom", cote + 11f + 28f <= hauteur)
            assertTrue("$largeur x $hauteur : prend toute la place possible", cote + 14f == largeur || cote + 39f == hauteur)
        }
        assertEquals("case minuscule : rien de négatif", 0f, coteTuileDisparu(10f, 10f))
    }
}
