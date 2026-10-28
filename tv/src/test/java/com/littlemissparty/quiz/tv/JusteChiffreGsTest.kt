package com.littlemissparty.quiz.tv

import com.littlemissparty.quiz.tv.habillage.Tempo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Le Juste Chiffre du Game Show, révélation « A puis B » (planche du 28/10) : minutage, règle et étages des équipes. */
class JusteChiffreGsTest {

    @Test
    fun `les rouleaux s arretent de gauche a droite, le dernier pile sur le son de la bonne reponse`() {
        for (n in 1..6) {
            val m = MinutageJuste(n)
            for (i in 1 until n) assertTrue("$n chiffres : rouleau $i après ${i - 1}", m.arret(i) > m.arret(i - 1))
            assertEquals("$n chiffres : dernier rouleau sur la révélation", Tempo.REVELATION_OR / 1000f, m.arret(n - 1), 0.001f)
            assertTrue("$n chiffres : jamais avant que la machine soit là", m.arret(0) >= 0.35f)
        }
    }

    @Test
    fun `la machine monte, puis la regle, le rayon, les equipes, les ecarts et enfin les points, avec leur son`() {
        val m = MinutageJuste(3)
        val ordre = listOf(m.fin, m.monte, m.regle, m.rayon, m.pose, m.equipe(0), m.ecart(0), m.ecart(1), m.bonus)
        assertEquals(ordre.sorted(), ordre)
        // Le « +100 » et le tampon de la pastille tombent ensemble, sur leur son (DirecteurSonore).
        assertEquals((Tempo.REVELATION_TAMPON + Tempo.JUSTE_GS_RETARD) / 1000f, m.bonus, 0.001f)
    }

    @Test
    fun `la regle contient la reponse et tous les nombres des equipes, avec dix graduations au plus`() {
        val cas = listOf(
            listOf(206L, 200L, 250L),
            listOf(7L, 7L),
            listOf(1_000_000L, 3L),
            listOf(-40L, 12L, 0L),
            listOf(42L),
        )
        for (valeurs in cas) {
            val e = echelleRegle(valeurs)
            assertTrue("$valeurs : rien à gauche de la règle", valeurs.all { it > e.bas })
            assertTrue("$valeurs : rien à droite de la règle", valeurs.all { it < e.haut })
            assertTrue("$valeurs : pas positif", e.pas >= 1.0)
            assertTrue("$valeurs : pas plus de 12 graduations", (e.haut - e.bas) / e.pas <= 12.0)
        }
    }

    @Test
    fun `deux equipes trop proches ne sont jamais au meme etage, des equipes eloignees restent en bas`() {
        val loin = etagesEquipes(listOf(100f, 400f, 800f), listOf(40f, 40f, 40f))
        assertEquals(listOf(0, 0, 0), loin)
        val proches = etagesEquipes(listOf(100f, 120f, 140f), listOf(40f, 40f, 40f))
        assertEquals(3, proches.toSet().size)
        // Même nombre pour deux équipes : l'une au-dessus de l'autre.
        val memes = etagesEquipes(listOf(300f, 300f), listOf(30f, 30f))
        assertNotEquals(memes[0], memes[1])
        // 8 équipes au même nombre : jamais plus de 3 étages (ça tient sous la machine).
        val huit = etagesEquipes(List(8) { 500f }, List(8) { 30f })
        assertTrue(huit.all { it in 0..2 })
    }
}
