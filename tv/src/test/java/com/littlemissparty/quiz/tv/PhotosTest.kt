package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class PhotosTest {

    @Test
    fun `une photo est reduite par puissance de 2 sans passer sous la taille voulue`() {
        assertEquals(1, reductionPour(800, 600, PHOTO_PLEINE))
        assertEquals(2, reductionPour(2000, 1500, PHOTO_PLEINE))
        assertEquals(4, reductionPour(1200, 1000, PHOTO_CARTE_DISPARU))
        assertEquals(2, reductionPour(1200, 1000, PHOTO_CARTE_MIMES))
        // Abîmée ou vide : pas de réduction, et jamais d'erreur.
        assertEquals(1, reductionPour(0, 0, PHOTO_PLEINE))
        assertEquals(1, reductionPour(-1, 500, PHOTO_PLEINE))
    }

    /**
     * Test du 27/10 au soir : petits blocages au début des questions en images, chaque écran décodait sa photo pendant
     * que la box dessinait. Plus aucun écran ne décode une photo lui-même : tout passe par Photos (en fond, d'avance).
     */
    @Test
    fun `aucun ecran ne decode une photo sur le fil de l ecran`() {
        val sources = File("src/main/java").walkTopDown().filter { it.isFile && it.extension == "kt" && it.name != "Photos.kt" }.toList()
        assertTrue("sources introuvables", sources.size > 20)
        val fautifs = sources.filter { f -> f.readText().let { "BitmapFactory.decodeByteArray" in it || "BitmapFactory.decodeStream" in it } }
        assertEquals("Décodage de photo hors de Photos.kt : ${fautifs.map { it.name }}", emptyList<File>(), fautifs)
    }

    /**
     * Test du 27/10 au soir (images coupées « à l'arrache », têtes coupées) : une photo de partie qui doit remplir sa
     * case est cadrée vers le haut, jamais au milieu. Seuls le Zoom mystère (il zoome exprès), les pochettes carrées du
     * blind test et les portraits dessinés du Duel restent centrés.
     */
    @Test
    fun `une photo coupee pour remplir sa case garde le haut, la ou sont les tetes`() {
        val centresPermis = setOf("ZoomMystere.kt", "Karaoke.kt", "BlindTestScenes.kt", "DuelWestern.kt")
        val fautifs = File("src/main/java").walkTopDown().filter { it.isFile && it.extension == "kt" && it.name !in centresPermis }
            .flatMap { f ->
                val lignes = f.readLines()
                lignes.indices.filter { "ContentScale.Crop" in lignes[it] && "CadrageHaut" !in lignes[it] && "CadrageHaut" !in lignes.getOrElse(it + 1) { "" } }
                    .map { "${f.name}:${it + 1}" }
            }.toList()
        assertEquals("Photo coupée au milieu : $fautifs", emptyList<String>(), fautifs)
    }
}
