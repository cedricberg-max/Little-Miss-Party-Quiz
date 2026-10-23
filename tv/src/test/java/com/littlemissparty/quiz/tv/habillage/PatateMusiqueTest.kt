package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** « Ça va exploser ! » : la musique finit pile sur l'explosion, quelle que soit la mèche restante. */
class PatateMusiqueTest {

    @Test
    fun `la musique part du debut quand la meche s'allume et finit pile sur le boum`() {
        assertEquals(0L, positionMusiquePatate(PATATE_MUSIQUE_MS))
        assertEquals(PATATE_MUSIQUE_MS, positionMusiquePatate(0))
        assertEquals(PATATE_MUSIQUE_MS - 5_000, positionMusiquePatate(5_000))
    }

    @Test
    fun `la duree annoncee est celle du fichier, a 5 ms pres`() {
        val octets = java.io.File("src/main/res/raw/lmp_patate_musique.ogg").readBytes()
        // Dernière page Ogg : sa position (en échantillons à 44,1 kHz) marque la fin du son.
        val i = String(octets, Charsets.ISO_8859_1).lastIndexOf("OggS")
        assertTrue(i >= 0)
        var echantillons = 0L
        for (k in 7 downTo 0) echantillons = (echantillons shl 8) or (octets[i + 6 + k].toLong() and 0xFF)
        val ms = echantillons * 1_000 / 44_100
        assertTrue("fichier $ms ms, annoncé $PATATE_MUSIQUE_MS ms", kotlin.math.abs(ms - PATATE_MUSIQUE_MS) <= 5)
    }
}
