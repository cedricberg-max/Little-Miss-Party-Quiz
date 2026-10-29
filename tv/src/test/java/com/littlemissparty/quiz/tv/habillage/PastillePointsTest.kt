package com.littlemissparty.quiz.tv.habillage

import java.io.File
import java.nio.ByteBuffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Les points de l'équipe qui a trouvé tiennent toujours dans leur rond (cedric, 28/10 : « +200 » coupé par le rond). */
class PastillePointsTest {
    /**
     * Largeur du texte en dp à [taille] sp, mesurée dans la vraie police des chiffres du Game Show : somme des avances
     * des caractères lues dans le fichier TTF (tables cmap, hmtx, hhea, head). java.awt n'existe pas pour les tests
     * Android, on lit donc la police à la main.
     */
    private fun largeur(texte: String, taille: Float) =
        texte.sumOf { orbitron.avance(it) } * taille / orbitron.unitesParEm

    private val orbitron = PoliceTtf(File("src/main/res/font/lmp_gs_orbitron_black.ttf").readBytes())

    private class PoliceTtf(octets: ByteArray) {
        private val b = ByteBuffer.wrap(octets)
        private fun u16(at: Int) = b.getShort(at).toInt() and 0xFFFF
        private val tables = (0 until u16(4)).associate { i ->
            String(octets, 12 + 16 * i, 4, Charsets.ISO_8859_1) to b.getInt(12 + 16 * i + 8)
        }
        val unitesParEm = u16(tables.getValue("head") + 18)
        private val nbAvances = u16(tables.getValue("hhea") + 34)

        /** Glyphe du caractère, via la sous-table cmap de format 4 (Unicode BMP), la seule de cette police. */
        private fun glyphe(c: Char): Int {
            val cmap = tables.getValue("cmap")
            val sous = (0 until u16(cmap + 2)).map { cmap + b.getInt(cmap + 4 + 8 * it + 4) }.first { u16(it) == 4 }
            val n = u16(sous + 6) / 2
            val fins = sous + 14
            val debuts = fins + 2 * n + 2
            val deltas = debuts + 2 * n
            val decalages = deltas + 2 * n
            val k = (0 until n).first { c.code <= u16(fins + 2 * it) }
            if (c.code < u16(debuts + 2 * k)) return 0
            val dec = u16(decalages + 2 * k)
            val g = if (dec == 0) c.code else u16(decalages + 2 * k + dec + 2 * (c.code - u16(debuts + 2 * k)))
            return if (dec != 0 && g == 0) 0 else (g + u16(deltas + 2 * k)) and 0xFFFF
        }

        fun avance(c: Char): Int = u16(tables.getValue("hmtx") + 4 * minOf(glyphe(c), nbAvances - 1))
    }

    @Test
    fun `de +1 a +2000 les points tiennent dans le rond`() {
        for (points in listOf(1, 5, 10, 50, 100, 200, 500, 999, 1000, 2000)) {
            val texte = "+$points"
            val diametre = diametrePastille(texte)
            val taille = tailleDansPastille(largeur(texte, TAILLE_PASTILLE_SP), diametre)
            assertTrue("$texte : $taille sp", taille <= TAILLE_PASTILLE_SP)
            // Dans le rond, loin du néon de 4 dp : jamais plus de 72 % du diamètre.
            assertTrue("$texte déborde : ${largeur(texte, taille)} dp dans $diametre dp", largeur(texte, taille) <= 0.72f * diametre)
            // Et lisible de loin : jamais en dessous de 18 sp.
            assertTrue("$texte trop petit : $taille sp", taille >= 18f)
        }
    }

    @Test
    fun `les petits nombres gardent leur grande taille`() {
        assertEquals(88, diametrePastille("+50"))
        assertEquals(104, diametrePastille("+200"))
        assertEquals(TAILLE_PASTILLE_SP, tailleDansPastille(largeur("+5", TAILLE_PASTILLE_SP), 88), 0.01f)
        // Mesure ratée : la taille d'avant, sans planter.
        assertEquals(TAILLE_PASTILLE_SP, tailleDansPastille(0f, 88), 0.01f)
    }

    @Test
    fun `la police est bien lue`() {
        // Avances d'Orbitron Black (1000 unités par em) : « +200 » fait 2953 unités, soit 106,3 dp à 36 sp.
        assertEquals(1000, orbitron.unitesParEm)
        assertEquals(2953, "+200".sumOf { orbitron.avance(it) })
        assertEquals(106.3f, largeur("+200", TAILLE_PASTILLE_SP), 0.1f)
    }
}
