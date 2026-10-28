package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ImagesAppliTest {

    /** Chaque grande image décodée d'avance existe bien dans l'appli (sinon l'écran retomberait sur son dessin de secours). */
    @Test
    fun `les grandes images decodees d avance existent toutes`() {
        val dossiers = File("src/main/res").listFiles { f -> f.isDirectory && f.name.startsWith("drawable") }.orEmpty()
        val manquantes = GRANDES_IMAGES.filter { nom -> dossiers.none { d -> d.listFiles { f -> f.nameWithoutExtension == nom }.orEmpty().isNotEmpty() } }
        assertEquals("Images manquantes : $manquantes", emptyList<String>(), manquantes)
        assertTrue("les affiches du décor en font partie", "gs_fond_poster" in GRANDES_IMAGES && "gs_accueil_poster" in GRANDES_IMAGES)
    }

    /**
     * Test du 27/10 au soir : petits blocages en entrant dans un écran, la box y décodait ses grandes images. Plus aucun
     * écran ne décode une image de l'appli lui-même pendant qu'il se dessine : tout passe par [ImagesAppli] (ou un fil
     * de fond, comme les coffres).
     */
    @Test
    fun `aucun ecran ne decode une grande image en entrant`() {
        val sources = File("src/main/java").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        val fautifs = sources.filter { f -> f.name != "ImagesAppli.kt" && f.name != "CoffresGs.kt" && "ImageBitmap.imageResource(" in f.readText() }
        assertEquals("Décodage d'image hors d'ImagesAppli : ${fautifs.map { it.name }}", emptyList<File>(), fautifs)
    }
}
