package com.littlemissparty.quiz.tv.habillage

import java.awt.Font
import java.awt.font.FontRenderContext
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Les points de l'équipe qui a trouvé tiennent toujours dans leur rond (cedric, 28/10 : « +200 » coupé par le rond). */
class PastillePointsTest {
    private val orbitron = Font.createFont(Font.TRUETYPE_FONT, File("src/main/res/font/lmp_gs_orbitron_black.ttf"))

    /** Largeur du texte en dp à [taille] sp, mesurée dans la vraie police des chiffres du Game Show. */
    private fun largeur(texte: String, taille: Float) =
        orbitron.deriveFont(taille).getStringBounds(texte, FontRenderContext(null, true, true)).width.toFloat()

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
}
