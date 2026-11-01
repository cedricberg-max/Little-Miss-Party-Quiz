package com.littlemissparty.quiz.tv

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Voyants du conducteur sur la régie téléphone (point 59, cedric 31/10) : ils ne suivaient que les musiques. La box
 * marque maintenant aussi chaque photo du programme dans games/<code>/media (« loading », puis « ok » ou « missing ») ;
 * la régie compte les photos dès qu'une est marquée (regie.js, voyantDuJeu).
 */
class VoyantsPhotosTest {
    private val src = File("src/main/java/com/littlemissparty/quiz/tv/GameViewModel.kt").readText()

    @Test
    fun `chaque photo du programme copiee sur la box est marquee pour la regie`() {
        val bloc = src.substringAfter("private fun savePhotos(").substringBefore("/** Extraits musicaux du programme")
        assertTrue(bloc, "there -> markSound(id, \"ok\")" in bloc)
        assertTrue(bloc, "markSound(id, \"loading\")" in bloc)
        assertTrue(bloc, "markSound(id, if (downloadPhoto(ref, dir, id) != null) \"ok\" else \"missing\")" in bloc)
    }

    @Test
    fun `une photo chargee pour l'ecran est marquee aussi`() {
        val bloc = src.substringAfter("private fun prefetchImage(").substringBefore("/** Photos gardées sur la box")
        assertTrue(bloc, "markSound(id, if (bytes != null) \"ok\" else \"missing\")" in bloc)
    }

    @Test
    fun `la regie compte les photos des qu'une est marquee`() {
        val regie = File("../web/public/regie.js").readText()
        val voyant = regie.substringAfter("function voyantDuJeu(").substringBefore("const VOYANTS")
        assertTrue("q.imageId" in voyant && "choiceImages" in voyant && "cards" in voyant && "marquePhotos" in voyant)
    }
}
