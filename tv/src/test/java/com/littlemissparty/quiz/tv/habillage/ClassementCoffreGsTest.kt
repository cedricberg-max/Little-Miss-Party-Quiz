package com.littlemissparty.quiz.tv.habillage

import com.littlemissparty.quiz.engine.CHEST_RANKING_MS
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Coffres mystères, Game Show : le classement A après chaque coffre (cedric, 29/10). */
class ClassementCoffreGsTest {

    @Test
    fun `le classement tient dans le temps que la partie lui laisse, 4 s`() {
        assertEquals(4_000L, CHEST_RANKING_MS)
        assertTrue(CLASSEMENT_COFFRE_GS_MS <= CHEST_RANKING_MS)
        // La fête (autocollant, couronne, confettis) a au moins 1,5 s pour se voir.
        assertTrue(CLASSEMENT_COFFRE_GS_MS / 1000f - TempsClassementA.FETE >= 1.5f)
        val ordre = listOf(TempsClassementA.COMPTE, TempsClassementA.BOUGE, TempsClassementA.NOUVEAUX_RANGS, TempsClassementA.FETE)
        assertEquals(ordre.sorted(), ordre)
    }

    @Test
    fun `de 1 a 8 equipes les lignes tiennent entre le titre et le bas de l'ecran`() {
        for (n in 1..8) {
            val g = geometrieClassementA(n)
            assertTrue("$n équipes : sous le titre", g.haut >= 95f)
            assertTrue("$n équipes : au-dessus du bas", g.haut + g.pas * n <= 495f + 0.01f)
            assertTrue("$n équipes : cartes lisibles", g.hauteurCarte >= 40f)
        }
        // Comme sur la planche : 112 px de pas (56 dp) jusqu'à 7 équipes, 100 px à 8.
        assertEquals(56f, geometrieClassementA(6).pas, 0.01f)
        assertEquals(50f, geometrieClassementA(8).pas, 0.01f)
        // 0 équipe : pas de division par zéro.
        assertEquals(56f, geometrieClassementA(0).pas, 0.01f)
    }

    @Test
    fun `l'autocollant dit ce qui arrive a l'equipe qui a ouvert le coffre`() {
        fun evo(avant: Int, apres: Int, recit: Recit) = Evolution(avant, apres, recit)
        assertEquals("NOUVEAU N°1 !" to false, autocollantClassementA(evo(3, 0, Recit.NOUVEAU_PREMIER), 6))
        assertEquals("+1 PLACE !" to false, autocollantClassementA(evo(3, 2, Recit.MONTE), 6))
        assertEquals("+2 PLACES !" to false, autocollantClassementA(evo(4, 2, Recit.MONTE), 6))
        assertEquals("AÏE !" to true, autocollantClassementA(evo(1, 2, Recit.DESCEND), 6))
        assertEquals("GARDE SA PLACE" to false, autocollantClassementA(evo(2, 2, Recit.TIENT), 6))
        assertEquals("TOUJOURS N°1 !" to false, autocollantClassementA(evo(0, 0, Recit.TOUJOURS_EN_TETE), 6))
        // Une seule équipe : ni « garde sa place » ni « nouveau n°1 ».
        assertEquals("BIEN JOUÉ !" to false, autocollantClassementA(evo(0, 0, Recit.TOUJOURS_EN_TETE), 1))
    }

    @Test
    fun `le ressort part de 0, depasse un peu puis se pose a 1`() {
        assertEquals(0f, rebondA(0f), 0.001f)
        assertEquals(1f, rebondA(1f), 0.001f)
        assertEquals(1f, rebondA(3f), 0.001f)
        assertTrue((0..100).map { rebondA(it / 100f) }.any { it > 1f })
        assertTrue((0..100).all { rebondA(it / 100f) < 1.3f })
    }

    @Test
    fun `le Game Show montre le classement A, le Classique garde le sien`() {
        val source = File("src/main/java/com/littlemissparty/quiz/tv/CoffresScreens.kt").readText()
        assertTrue(source.contains("if (Look.gs) ClassementCoffreGs(lignes, joue, Modifier.fillMaxSize()) else ClassementCoffre(lignes, joue, Modifier.fillMaxSize())"))
        // Aucune image ni vidéo : tout est dessiné (la Mi Box n'a rien de plus à charger).
        val classement = File("src/main/java/com/littlemissparty/quiz/tv/habillage/ClassementCoffreGs.kt").readText()
        assertFalse(classement.contains("painterResource") || classement.contains("R.raw.") || classement.contains("R.drawable."))
    }

    @Test
    fun `le rond du rang respire dans sa carte, de 1 a 8 equipes`() {
        // cedric, 30/10 : le rond touchait le cadre ; au moins 2 dp de bordure plus 3,5 dp d'air, en haut et en bas.
        for (n in 1..8) {
            val g = geometrieClassementA(n)
            assertTrue("$n équipes : marge ${margeRangA(g)}", margeRangA(g) >= 5.5f * g.f)
        }
    }
}
