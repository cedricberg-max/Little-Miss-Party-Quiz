package com.littlemissparty.quiz.tv.habillage

import com.littlemissparty.quiz.engine.BOMB_ALERT_MS
import com.littlemissparty.quiz.engine.CHEST_SHOW_MS
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

    @Test
    fun `chaque animation tient dans le temps que la partie lui laisse`() {
        // La partie laisse CHEST_SHOW_MS à l'ouverture d'un coffre, BOMB_ALERT_MS à l'annonce : sinon la fin serait coupée.
        for (ms in listOf(OUVERTURE_COFFRE_MS, OUVERTURE_CARTE_MS, OUVERTURE_MALUS_MS, OUVERTURE_OR_MS, OUVERTURE_BOMBE_MS)) {
            assertTrue("$ms ms > $CHEST_SHOW_MS ms", ms <= CHEST_SHOW_MS)
        }
        assertTrue(ALERTE_BOMBE_MS <= BOMB_ALERT_MS)
    }

    /** Planche du 28/10 : les pièces d'or 3D (atlas d'un tour complet, 16 cases) suivent l'angle de l'ancien ovale. */
    @Test
    fun `la piece d or tourne case par case, un tour complet, dans les deux sens`() {
        val tour = 2f * Math.PI.toFloat()
        assertEquals(0, casePiece(0f))
        assertEquals(4, casePiece(tour / 4f + 0.001f))
        assertEquals(8, casePiece(tour / 2f + 0.001f))
        assertEquals(15, casePiece(tour - 0.001f))
        assertEquals(0, casePiece(tour + 0.001f))
        assertEquals(15, casePiece(-0.001f))
        for (k in -200..200) assertTrue(casePiece(k * 0.37f) in 0..15)
        // L'atlas fait 4 × 4 cases : largeur et hauteur lues dans l'en-tête WebP étendu (VP8X, 24 bits chacune).
        val entete = java.io.File("src/main/res/drawable-nodpi/gs_piece_or.webp").readBytes()
        assertEquals("VP8X", String(entete, 12, 4, Charsets.US_ASCII))
        fun l24(i: Int) = 1 + ((entete[i].toInt() and 0xFF) or ((entete[i + 1].toInt() and 0xFF) shl 8) or ((entete[i + 2].toInt() and 0xFF) shl 16))
        assertEquals(4 * CASE_PIECE, l24(24))
        assertEquals(4 * CASE_PIECE, l24(27))
        assertTrue("préchargée avec les grandes images", "gs_piece_or" in GRANDES_IMAGES)
    }

    /** cedric 28/10 : « la 3D du coffre qui change » au moment où il est choisi ; le coffre fermé est lu d'avance. */
    @Test
    fun `le coffre choisi garde sa vraie image fermee le temps que sa planche se lise`() {
        val source = java.io.File("src/main/java/com/littlemissparty/quiz/tv/habillage/CoffresGs.kt").readText()
        assertTrue(source.contains("ferme != null -> Quatre(ferme, CASE_OUVERTURE, 0, 1)"))
        assertTrue(source.indexOf("ferme != null") < source.indexOf("else -> Quatre(sceneLue"))
        for (m in 0..5) assertTrue(java.io.File("src/main/res/drawable-nodpi/gs_coffre_$m.webp").isFile)
        assertTrue(java.io.File("src/main/res/drawable-nodpi/gs_coffre_or.webp").isFile)
    }
}
