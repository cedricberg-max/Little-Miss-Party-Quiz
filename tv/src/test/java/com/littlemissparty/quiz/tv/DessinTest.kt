package com.littlemissparty.quiz.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import com.littlemissparty.quiz.tv.habillage.COULEURS_DESSIN
import com.littlemissparty.quiz.tv.habillage.GOMME_DESSIN

/** Pictionary : la TV relit les paquets de traits envoyés par la tablette du dessinateur. */
class DessinTest {

    @Test
    fun `un trait se lit avec sa couleur, son épaisseur et ses points`() {
        val t = Dessin.lireTrait(mapOf("c" to "#F94144", "w" to 2L, "p" to "10,20 30,40 1000,1000"))!!
        assertEquals(0xFFF94144L, t.couleur)
        assertEquals(2, t.epaisseur)
        assertEquals(listOf(10 to 20, 30 to 40, 1000 to 1000), t.points)
    }

    @Test
    fun `la gomme est un trait couleur papier`() {
        assertNull(Dessin.lireTrait(mapOf("c" to "paper", "w" to 3L, "p" to "5,5"))!!.couleur)
    }

    @Test
    fun `les traits s'ajoutent dans l'ordre, tout effacer vide la feuille`() {
        val d = Dessin("k")
            .avec(mapOf("c" to "#000000", "w" to 1L, "p" to "1,1 2,2"))
            .avec(mapOf("c" to "#000000", "w" to 1L, "p" to "2,2 3,3"))
        assertEquals(2, d.traits.size)
        assertEquals(listOf(2 to 2, 3 to 3), d.traits[1].points)
        val vide = d.avec(mapOf("clear" to true))
        assertEquals(0, vide.traits.size)
        assertEquals(1, vide.effacements)
        assertEquals("k", vide.cle)
    }

    @Test
    fun `l'heure d'envoi d'un paquet se lit dans sa clé de push`() {
        // Clé au format du SDK Firebase (8 chiffres de l'heure, puis 12 au hasard) : 28/10/2026 à 06:40:00.123 UTC.
        val heure = 1_793_169_600_123L
        val chiffres = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz"
        var t = heure
        val debut = CharArray(8)
        for (i in 7 downTo 0) { debut[i] = chiffres[(t % 64).toInt()]; t /= 64 }
        assertEquals(heure, Dessin.heureDeCle(String(debut) + "abcdEFGHijkl"))
        assertEquals(0L, Dessin.heureDeCle("--------xxxxxxxxxxxx"))
        assertNull(Dessin.heureDeCle("court"))
        assertNull(Dessin.heureDeCle("pas*une*cle-de-push"))
        assertNull(Dessin.heureDeCle(null))
    }

    @Test
    fun `au fil du dessin, seuls les nouveaux morceaux sont convertis pour le tableau`() {
        val auFil = TableauAuFil()
        val morceau = mapOf("c" to "#1B1035", "w" to 1L, "p" to "1,1 2,2")
        val d1 = Dessin("k").avec(morceau).avec(morceau)
        val t1 = auFil.pour(d1)
        val d2 = d1.avec(morceau)
        val t2 = auFil.pour(d2)
        assertEquals(3, t2.size)
        assertSame("le premier morceau garde son objet", t1[0], t2[0])
        assertSame(t1[1], t2[1])
        // « Tout effacer », puis un autre tour : tout repart de zéro.
        assertEquals(0, auFil.pour(d2.avec(mapOf("clear" to true))).size)
        val autre = auFil.pour(Dessin("k2").avec(morceau))
        assertEquals(1, autre.size)
        assertEquals(d2.pourTableau().map { it.points.toList() }, t2.map { it.points.toList() })
    }

    @Test
    fun `un paquet illisible est ignoré sans rien casser`() {
        val d = Dessin("k").avec(mapOf("c" to "#000000", "w" to 1L, "p" to "1,1"))
        assertSame(d, d.avec(mapOf("c" to "rouge", "w" to 1L, "p" to "1,1")))
        assertSame(d, d.avec(mapOf("c" to "#000000", "w" to 9L, "p" to "1,1")))
        assertSame(d, d.avec(mapOf("c" to "#000000", "w" to 1L, "p" to "n'importe quoi")))
        assertSame(d, d.avec(mapOf("w" to 1L)))
    }

    @Test
    fun `le dessin reçu passe au tableau de la TV avec les feutres et épaisseurs de l'ardoise`() {
        val d = Dessin("k")
            .avec(mapOf("c" to "#FF2D8A", "w" to 3L, "p" to "0,0 500,250 1000,1000"))
            .avec(mapOf("c" to "paper", "w" to 2L, "p" to "1,1"))
            .avec(mapOf("c" to "#123456", "w" to 1L, "p" to "10,10"))
        val t = d.pourTableau()
        assertEquals(3, t.size)
        assertEquals(1, t[0].couleur)
        assertEquals(2, t[0].epaisseur)
        assertEquals(listOf(0f, 0f, 0.5f, 0.25f, 1f, 1f), t[0].points.toList())
        assertEquals("La gomme recouvre le dessin, couleur papier", GOMME_DESSIN, t[1].couleur)
        assertEquals(1, t[1].epaisseur)
        assertEquals("Une couleur hors palette prend l'encre", 0, t[2].couleur)
        assertEquals(0, t[2].epaisseur)
        assertEquals(8, COULEURS_DESSIN.size)
    }
}
