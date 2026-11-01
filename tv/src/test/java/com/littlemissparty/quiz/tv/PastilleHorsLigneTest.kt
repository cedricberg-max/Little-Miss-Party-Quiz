package com.littlemissparty.quiz.tv

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Cedric, 1/11 au soir : une équipe hors ligne avait son nom plus petit, puis coupé en plein mot (« Fantô / me 7 »). */
class PastilleHorsLigneTest {
    private val src = File("src/main/java/com/littlemissparty/quiz/tv/GameShowQuiz.kt").readText()
    private val pastille = src.substringAfter("internal fun TeamStatusGs(").substringBefore("/** Chrono (Game Show)")

    @Test
    fun `hors ligne en etiquette a part, le nom garde toute sa place`() {
        assertTrue(pastille.contains("val horsLigne = !online && revealedPoints == null"))
        // Sous l'étiquette, la pastille n'a plus de statut à côté du nom (sur une ligne) : rien ne lui prend de largeur.
        assertTrue(pastille.contains("if (uneLigne) \"\" else \"…\""))
        assertTrue(pastille.contains("if (statut.isNotEmpty()) {"))
        assertTrue(pastille.contains("EtiquetteHorsLigne(Modifier.align(Alignment.TopCenter)"))
        assertTrue(src.contains("\"hors ligne\", color = GS.Encre, fontSize = 11.sp"))
        assertTrue(ETIQUETTE_HORS_LIGNE_DEBORD in 4f..16f)
    }

    @Test
    fun `le tour des ecrans montre une equipe hors ligne de 1 a 8 equipes`() {
        val tour = File("src/androidTest/java/com/littlemissparty/quiz/tv/test/tour/TourDesEcrans.kt").readText()
        assertTrue(tour.contains("absente.couperReseau()"))
        assertTrue(tour.contains("verifier(\"zoom-hors-ligne\""))
        assertTrue(tour.contains("absente.retablirReseau(code)"))
        assertFalse(pastille.contains("Statut()\n    } else Column("))
    }
}
