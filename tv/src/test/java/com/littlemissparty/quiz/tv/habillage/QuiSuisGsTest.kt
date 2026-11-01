package com.littlemissparty.quiz.tv.habillage

import androidx.compose.ui.geometry.Offset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Qui suis-je ? du Game Show, version A ajustée (planche du 28/10, validée par cedric). */
class QuiSuisGsTest {

    @Test
    fun `les ampoules font le tour complet de l enseigne, sans sortir du cadre`() {
        val w = 300f
        val h = 80f
        assertEquals(Offset(0f, 0f), pointDuTour(0f, w, h))
        assertEquals(Offset(w, 0f), pointDuTour(w, w, h))
        assertEquals(Offset(w, h), pointDuTour(w + h, w, h))
        assertEquals(Offset(0f, h), pointDuTour(2 * w + h, w, h))
        assertEquals(Offset(0f, 0f), pointDuTour(2 * (w + h), w, h))
        for (k in -50..400) {
            val p = pointDuTour(k * 3.7f, w, h)
            assertTrue("$k : $p", p.x in 0f..w && p.y in 0f..h)
            assertTrue("sur le bord", p.x == 0f || p.x == w || p.y == 0f || p.y == h)
        }
    }

    @Test
    fun `chaque indice a sa couleur, jusqu a 5, et la pastille du nouvel indice ne dure que 2 s`() {
        assertEquals(5, COULEURS_INDICES_GS.toSet().size)
        assertTrue(NOUVEL_INDICE_MS in 1_500..2_500)
    }

    /** Test du 28/10 : « qui je suis » coupé en bas du cadre ; plus il y a d'équipes déjà essayées, plus il faut de place. */
    @Test
    fun `l appel au buzz demande plus de place avec les equipes deja essayees, jamais moins que son texte`() {
        // L'onglet d'appel du 31/10 : la plaque, le « ? » qui dépasse et « dès que vous savez / qui je suis ».
        assertTrue(besoinAppelBuzz(0) >= 120f)
        assertTrue(besoinAppelBuzz(1) > besoinAppelBuzz(0))
        assertTrue(besoinAppelBuzz(3) > besoinAppelBuzz(2))
        assertEquals(besoinAppelBuzz(1), besoinAppelBuzz(2), 0.01f)
        val source = File("src/main/java/com/littlemissparty/quiz/tv/habillage/QuiSuisGs.kt").readText()
        assertTrue("réduit selon la hauteur du cadre", source.contains("maxHeight.value / besoinAppelBuzz("))
    }

    /** Test du 30/10 au soir : à 4 équipes, « Déjà essayé » passait sous le cadre ; le sous-titre laisse sa place aux essais. */
    @Test
    fun `apres un essai rate, le sous-titre laisse la place aux equipes deja essayees`() {
        assertTrue(besoinAppelBuzz(1) < (44f + 62f + 10f + 52f + 22f + 22f + 8f + 34f) * 1.1f)
        // Trois essais (4 équipes) tiennent dans un panneau d'une centaine de dp, au plus petit facteur.
        assertTrue(besoinAppelBuzz(3) * 0.4f <= 110f)
        val source = File("src/main/java/com/littlemissparty/quiz/tv/habillage/QuiSuisGs.kt").readText()
        assertTrue(source.contains("PlaqueAppel(GenrePlaque.QUISUIS, \"BUZZEZ !\", if (dejaEssaye.isEmpty()) \"dès que vous savez\\nqui je suis\" else \"\", k = e)"))
    }

    /** cedric 28/10 : plus de buzzer rouge dessiné, ni de grand « ? » ; le texte des indices n'est jamais coupé. */
    @Test
    fun `pas de buzzer dessine, pas de grand point d interrogation, indices jamais coupes`() {
        val qsj = File("src/main/java/com/littlemissparty/quiz/tv/habillage/QuiSuisGs.kt").readText()
        assertFalse(qsj.contains("ellipse", ignoreCase = true))
        assertFalse("pas de texte tronqué", qsj.contains("TextOverflow.Ellipsis"))
        val tableau = File("src/main/java/com/littlemissparty/quiz/tv/JeuxAuBuzzer.kt").readText()
        assertTrue(tableau.contains("if (!revealed && !Look.gs) Text(\"?\""))
        assertTrue(tableau.contains("if (Look.gs) CarteIndiceGs("))
    }

    @Test
    fun `polaroid du personnage, penche, presque aussi grand que la planche C, sort un peu du cadre, de 1 a 8 equipes (1-11)`() {
        val a = Math.toRadians(5.0)
        fun boite(w: Float, ht: Float) =
            (w * kotlin.math.cos(a) + ht * kotlin.math.sin(a)).toFloat() to (ht * kotlin.math.cos(a) + w * kotlin.math.sin(a)).toFloat()
        for ((l, h) in listOf(420f to 300f, 300f to 300f, 260f to 180f, 500f to 220f, 200f to 340f, 420f to 134f, 440f to 207f)) {
            val (w, ht) = taillePolaroid(l, h, 540f)
            assertEquals(POLAROID_RAPPORT, w / ht, 1e-3f)
            val (bl, bh) = boite(w, ht)
            // Au repos, il ne sort du cadre que de la place libre entre l'enseigne et les équipes.
            assertTrue("$l x $h : $bl x $bh", bl <= l + 2 * POLAROID_DEBORD + 0.01f && bh <= h + 2 * POLAROID_DEBORD + 0.01f)
            // Jamais plus grand que la planche C (51 % de l'écran).
            assertTrue(ht <= 0.51f * 540f)
        }
        // 3 équipes (cadre de 207 dp de haut, mesuré) : planche C (276 dp de haut sur 540) moins 5 %, puis encore 5 %
        // (cedric, 1/11 à 12 h 39).
        val (_, h3) = taillePolaroid(440f, 207f, 540f)
        assertTrue("3 équipes : $h3", h3 in 0.88f * 276f..0.92f * 276f)
        assertEquals(0.95f, POLAROID_REDUCTION, 1e-3f)
        // Plus grand que l'ancien médaillon rond (0,86 de la plus petite dimension du cadre), même à 8 équipes.
        for ((l, h) in listOf(440f to 207f, 420f to 134f)) {
            val (w, ht) = taillePolaroid(l, h, 540f)
            assertTrue("$l x $h", ht > 0.86f * minOf(l, h) * 1.15f && w > 0.86f * minOf(l, h))
        }
        assertEquals(0.04f, POLAROID_REBOND, 1e-3f)
        assertEquals(-5f, POLAROID_ANGLE)
        val src = java.io.File("src/main/java/com/littlemissparty/quiz/tv/habillage/RevelationPersonnage.kt").readText()
        val bloc = src.substringAfter("private fun MedaillonSeul(").substringBefore("\n}\n")
        assertTrue(bloc.contains(".background(Color.White, RoundedCornerShape(3.dp))"))
        assertTrue("plus de rond", !bloc.contains("CircleShape"))
        assertTrue("il sort du cadre, centré", bloc.contains(".requiredSize(largeur.dp, hauteur.dp)"))
    }
}
