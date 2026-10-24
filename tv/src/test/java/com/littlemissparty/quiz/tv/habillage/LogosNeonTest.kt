package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Logos néon des jeux du Game Show (planche du 24/10) : un par jeu, tous dans l'appli. */
class LogosNeonTest {

    private val familles = listOf(
        "quiz", "illustre", "mimes", "blind", "musical", "express", "juste", "zoom", "flou", "chante", "quisuis", "disparu",
        "statues", "pictionary", "bombe", "gonfleur", "patate",
    )

    @Test
    fun `chaque jeu a son logo neon`() {
        for (f in familles) assertNotNull("logo manquant pour $f", logoNeonJeu(f))
        // Un jeu inconnu garde son émoji.
        assertNull(logoNeonJeu("inconnu"))
    }

    @Test
    fun `les logos sont dans l'appli`() {
        for (n in listOf("quiz", "illustre", "mimes", "blind", "musical", "express", "juste", "zoom", "flou", "chante", "quisuis",
            "disparu", "statues", "pictionary", "coffres", "gonfleur", "patate")) {
            assertTrue("gs_logo_$n manquant", File("src/main/res/drawable-nodpi/gs_logo_$n.webp").isFile)
        }
    }
}
