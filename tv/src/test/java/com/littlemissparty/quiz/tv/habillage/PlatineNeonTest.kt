package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlatineNeonTest {
    private fun proj(x: Double, y: Double, z: Double): FloatArray = FloatArray(2).also { PlatineNeon.projeter(x, y, z, it, 0) }

    @Test
    fun `la projection tombe sur l'image du rendu 3D (memes points que three js)`() {
        // Valeurs relevées dans platine-appli.html (window.projeter) avec la caméra de la vidéo du disque.
        val attendu = mapOf(
            Triple(0.0, -0.07, 1.64) to (0.47301f to 0.87702f),
            Triple(0.0, -0.07, -1.64) to (0.48202f to 0.2997f),
            Triple(-1.64, -0.07, 0.0) to (0.03597f to 0.53053f),
            Triple(1.64, -0.07, 0.0) to (0.92086f to 0.53053f),
            Triple(1.53, 0.0, -0.62) to (0.86553f to 0.41617f),
            Triple(0.0, 1.0, 0.0) to (0.47642f to 0.23589f),
            Triple(0.0, 0.0, 0.0) to (0.4783f to 0.51279f),
        )
        for ((p, uv) in attendu) {
            val r = proj(p.first, p.second, p.third)
            assertEquals("x de $p", uv.first, r[0], 0.0005f)
            assertEquals("y de $p", uv.second, r[1], 0.0005f)
        }
    }

    @Test
    fun `six lasers sur un temps, douze sur le premier temps de la mesure, rien apres une demi-seconde ni a l'arret`() {
        fun allumes(ms: Long, ecoute: Boolean = true) = (0 until 12).count { PlatineNeon.eclatLaser(it, PlatineNeon.Temps(ms), ecoute) > 0f }
        assertEquals(12, allumes(4 * Tempo.TEMPS + 50))     // premier temps d'une mesure
        assertEquals(6, allumes(5 * Tempo.TEMPS + 50))      // deuxième temps
        assertEquals(6, allumes(7 * Tempo.TEMPS + 100))
        assertEquals(0, allumes(5 * Tempo.TEMPS + 460))     // le rayon s'est éteint avant le temps suivant
        assertEquals(0, allumes(4 * Tempo.TEMPS + 50, ecoute = false))
        // Plus fort au tout début du temps, puis il décroît.
        val t0 = PlatineNeon.eclatLaser(0, PlatineNeon.Temps(8 * Tempo.TEMPS), true)
        val t1 = PlatineNeon.eclatLaser(0, PlatineNeon.Temps(8 * Tempo.TEMPS + 200), true)
        assertTrue(t0 > t1 && t1 > 0f)
    }

    private fun etat(t: Float, ecoute: Boolean, vie: Float = if (ecoute) 1f else 0f, leve: Float = 1f - vie) =
        PlatineNeon.Etat(t, (t * 1000).toLong(), vie, if (ecoute) 1f else 0.08f, vie, leve, ecoute)

    @Test
    fun `pendant l'ecoute, toute la lumiere est dans l'image, la couronne est coupee en deux moities`() {
        val pics = PlatineNeon.Pics()
        for (k in 0 until 50) {
            val c = PlatineNeon.calques(etat(k * 0.033f, ecoute = true), pics)
            for (trait in c.derriere + c.milieu + c.devant) {
                assertTrue(trait.points.none { it.isNaN() || it.isInfinite() })
                assertTrue(trait.alpha in 0f..1f)
            }
            // 36 barres et leurs pics derrière le disque, 36 devant (plus les deux bords du cône de l'hologramme).
            assertEquals(36, c.derriere.count { it.genre == PlatineNeon.Genre.BARRE })
            assertEquals(36, c.devant.count { it.genre == PlatineNeon.Genre.BARRE })
            assertEquals(36, c.derriere.count { it.genre == PlatineNeon.Genre.LIGNE && it.points.size == 4 })
            assertEquals(38, c.devant.count { it.genre == PlatineNeon.Genre.LIGNE && it.points.size == 4 })
        }
        // Les barres de devant restent dans l'image (bas de l'image), même au plus haut.
        val c = PlatineNeon.calques(etat(4 * Tempo.TEMPS / 1000f, ecoute = true), pics)
        val ys = c.devant.filter { it.genre == PlatineNeon.Genre.BARRE || it.genre == PlatineNeon.Genre.LIGNE }.flatMap { tr -> tr.points.filterIndexed { i, _ -> i % 2 == 1 } }
        assertTrue("barres coupées en bas : ${ys.max()}", ys.max() < 0.99f)
    }

    @Test
    fun `musique arretee, ni laser ni onde ni etincelle, le disque est voile et les pics retombent`() {
        val pics = PlatineNeon.Pics()
        PlatineNeon.calques(etat(1f, ecoute = true), pics)
        val haut = pics.hauteurs.max()
        var c = PlatineNeon.calques(etat(1.1f, ecoute = false), pics)
        for (k in 1..30) c = PlatineNeon.calques(etat(1.1f + k * 0.05f, ecoute = false), pics)
        assertFalse(c.devant.any { it.genre == PlatineNeon.Genre.DEGRADE })
        assertFalse(c.milieu.any { it.genre == PlatineNeon.Genre.LUEUR })
        assertFalse(c.devant.any { it.genre == PlatineNeon.Genre.NOTE })
        assertTrue(c.milieu.any { it.genre == PlatineNeon.Genre.REMPLI && it.couleur == 0L })
        assertTrue(pics.hauteurs.max() < haut)
    }

    @Test
    fun `le bras passe d'une image a l'autre de la planche, sans sortir des 9 positions`() {
        assertEquals(0 to 0f, PlatineNeon.imageBras(0f))
        assertEquals(4 to 0f, PlatineNeon.imageBras(0.5f))
        assertEquals(7, PlatineNeon.imageBras(1f).first)
        assertEquals(1f, PlatineNeon.imageBras(1f).second, 1e-6f)
        assertEquals(7, PlatineNeon.imageBras(2f).first)
        assertEquals(0, PlatineNeon.imageBras(-1f).first)
    }

    @Test
    fun `la video du disque et la planche du bras sont dans l'appli, aux mesures du dessin`() {
        val disque = java.io.File("src/main/res/raw/gs_bt_disque.mp4")
        assertTrue("vidéo du disque manquante", disque.isFile)
        assertTrue("vidéo du disque trop lourde : ${disque.length()}", disque.length() in 300_000L..3_500_000L)
        // WebP sans perte (VP8L) : largeur et hauteur sur 14 bits chacune, juste après la signature 0x2F.
        val b = java.io.File("src/main/res/drawable-nodpi/gs_bt_bras.webp").readBytes()
        assertEquals("VP8L", String(b, 12, 4, Charsets.US_ASCII))
        val v = (b[21].toInt() and 0xFF) or ((b[22].toInt() and 0xFF) shl 8) or ((b[23].toInt() and 0xFF) shl 16) or ((b[24].toInt() and 0xFF) shl 24)
        assertEquals(3 * PlatineNeon.BRAS_L, (v and 0x3FFF) + 1)
        assertEquals(3 * PlatineNeon.BRAS_H, ((v shr 14) and 0x3FFF) + 1)
        assertTrue(PlatineNeon.BRAS_X + PlatineNeon.BRAS_L <= PlatineNeon.VIDEO_L)
        assertTrue(PlatineNeon.BRAS_Y + PlatineNeon.BRAS_H <= PlatineNeon.HAUTEUR)
    }

    @Test
    fun `couleurs de la couronne rose violet cyan en miroir`() {
        assertEquals(PlatineNeon.ROSE, PlatineNeon.couleurBarre(18))
        assertEquals(PlatineNeon.CYAN, PlatineNeon.couleurBarre(54))
        assertEquals(PlatineNeon.couleurBarre(9), PlatineNeon.couleurBarre(27))
        assertEquals(PlatineNeon.couleurBarre(45), PlatineNeon.couleurBarre(63))
    }
}
