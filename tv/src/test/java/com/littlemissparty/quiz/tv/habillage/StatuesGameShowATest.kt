package com.littlemissparty.quiz.tv.habillage

import androidx.compose.ui.graphics.Color
import com.littlemissparty.quiz.engine.STATUES_ANNONCE_MS
import com.littlemissparty.quiz.tv.STATUES_SUSPENSE_MS
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Statues musicales, Game Show : STATUE ! en pierre et l'écran BRAVO seul (choix A de cedric, 29/10). */
class StatuesGameShowATest {

    @Test
    fun `de 1 a 8 equipes, quel que soit le nombre de gagnantes, le BRAVO tient dans l'ecran`() {
        for (equipes in 1..8) for (gagnantes in 1..equipes) {
            val autres = equipes - gagnantes
            val p = placesBravo(gagnantes, autres)
            val lignes = (gagnantes + p.colonnesNoms - 1) / p.colonnesNoms
            val cas = "$gagnantes gagnante(s), $autres autre(s)"
            // Les noms sous BRAVO, la pastille sous les noms, la phrase des autres sous la pastille rétrécie.
            assertTrue(cas, p.nomsHaut >= 46f + 75f)
            assertTrue(cas, p.pastille >= p.nomsHaut + lignes * p.ligneNom)
            if (autres > 0) assertTrue(cas, p.autres >= p.pastille - 20f + 0.65f * 70f)
            // Les tuiles (70 dp, rangées de 75 dp) finissent au-dessus du bas de l'écran (540 dp).
            val bas = if (autres > 0) p.tuiles + (p.rangees - 1) * 75f + 70f else p.pastille + 70f
            assertTrue("$cas : bas à $bas dp", bas <= 540f)
            assertEquals(cas, if (autres > 4) 2 else if (autres > 0) 1 else 0, p.rangees)
        }
    }

    @Test
    fun `plus de 3 gagnantes passent sur deux colonnes, les noms restent lisibles`() {
        assertEquals(1, placesBravo(3, 0).colonnesNoms)
        assertEquals(2, placesBravo(4, 0).colonnesNoms)
        assertEquals(64f, placesBravo(1, 7).ligneNom, 0.01f)
        assertTrue((1..8).all { placesBravo(it, 0).ligneNom >= 38f })
    }

    @Test
    fun `l'animation BRAVO a fini avant le classement general`() {
        // Le BRAVO commence à la fin du roulement de tambour ; il doit avoir tout montré avant que Sarah enchaîne.
        assertTrue(BRAVO_STATUES_S * 1000 <= STATUES_ANNONCE_MS - STATUES_SUSPENSE_MS + 2_000)
    }

    @Test
    fun `l'ecran BRAVO dit les gagnantes, leurs points et ceux des autres`() {
        val dragons = EquipeBravo("Dragons", Color.Red, 300)
        val licornes = EquipeBravo("Licornes", Color.Green, 150)
        val chats = EquipeBravo("Chats", Color.Blue, 0)
        assertEquals("Bravo Dragons ! +300", descriptionBravo(listOf(dragons), emptyList()))
        assertEquals(
            "Bravo Dragons ! +300. Bravo aussi aux autres ! Licornes +150, Chats 0",
            descriptionBravo(listOf(dragons), listOf(licornes, chats)),
        )
    }

    @Test
    fun `le Game Show montre la pierre et le BRAVO, un seul appel pour les gagnantes et le recap`() {
        val source = File("src/main/java/com/littlemissparty/quiz/tv/habillage/StatuesGameShow.kt").readText()
        assertTrue(source.contains("if (etape == EtapeStatues.STATUE) { StatuePierre(modifier); return }"))
        assertTrue(source.contains("(etape == EtapeStatues.GAGNANTES || etape == EtapeStatues.RECAP) && r != null && gagnantes.isNotEmpty()"))
        assertEquals(1, Regex("BravoStatues\\(").findAll(source).count())
        // L'ancien récap de la chanson et la statue de glace ne sont plus montrés.
        assertFalse(source.contains("RecapGameShow") || source.contains("StatueGlace"))
        // Personne n'a gagné : « Personne cette fois ! » reste.
        assertTrue(source.contains("EtapeStatues.GAGNANTES, EtapeStatues.RECAP -> StatueDOr(emptyList(), centre)"))
        // Le Classique garde ses écrans.
        val classique = File("src/main/java/com/littlemissparty/quiz/tv/Statues.kt").readText()
        assertTrue(classique.contains("if (Look.gs) { StatuesGameShow(state, etape, gagnantes, modifier); return }"))
        assertTrue(classique.contains("EtapeStatues.RECAP -> RecapStatues(state, f)"))
    }

    @Test
    fun `l'image de pierre est dans l'appli, legere`() {
        val image = File("src/main/res/drawable-nodpi/gs_statue_pierre.webp")
        assertTrue(image.isFile)
        assertTrue("moins de 200 Ko", image.length() in 1..200_000)
        val octets = image.readBytes()
        assertEquals("RIFF", String(octets, 0, 4, Charsets.ISO_8859_1))
        assertEquals("WEBP", String(octets, 8, 4, Charsets.ISO_8859_1))
    }
}
