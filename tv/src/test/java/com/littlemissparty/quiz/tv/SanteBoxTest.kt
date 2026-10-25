package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Bilan de santé de la box (cedric, 25 octobre) : une ligne lisible, les alertes en tête, jamais trop longue. */
class SanteBoxTest {

    private val normal = SanteBox(
        ramLibreMo = 812, ramTotaleMo = 1945, ramBasse = false, appliMo = 95, appliMaxMo = 192,
        disqueLibreMo = 1_331, boucles = 1, sonsLongs = 0, incidentsSon = 3, internet = true,
        ecran = "question", tablettes = 4, equipes = 4, depuisMs = 65 * 60_000L,
    )

    @Test
    fun `tout va bien, une ligne sans alerte`() {
        assertEquals(emptyList<String>(), normal.alertes())
        assertEquals(
            "RAM libre 812/1945 Mo · appli 95/192 Mo · disque 1,3 Go · boucles 1, sons 0, incidents 3 · " +
                "Internet oui · question · tablettes 4/4 · 1 h 05",
            normal.ligne(),
        )
    }

    @Test
    fun `memoire, place et Internet en alerte en tete de ligne`() {
        val mal = normal.copy(ramLibreMo = 120, appliMo = 170, disqueLibreMo = 600, internet = false, depuisMs = 6 * 60_000L)
        assertEquals(listOf("mémoire basse", "appli près de sa limite", "place basse", "sans Internet"), mal.alertes())
        assertTrue(mal.ligne().startsWith("⚠ mémoire basse, appli près de sa limite, place basse, sans Internet · RAM libre 120/"))
        assertTrue(mal.ligne().contains("disque 600 Mo"))
        assertTrue(mal.ligne().endsWith("6 min"))
        // Le workflow « Rapports » garde les 200 premiers caractères : tout tient, même avec toutes les alertes.
        assertTrue(mal.copy(ecran = "intro en pause", tablettes = 8, equipes = 8).ligne().length <= 200)
    }

    @Test
    fun `la box le dit elle-meme quand Android signale la memoire basse`() {
        assertEquals(listOf("mémoire basse"), normal.copy(ramBasse = true).alertes())
    }
}
