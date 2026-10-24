package com.littlemissparty.quiz.tv.habillage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * Vidéo de l'accueil (et de l'écran de fin) calée sur sa musique sans micro-saccade (cedric, 24/10) : un écart se
 * rattrape par la vitesse de lecture, jamais par un saut, sauf très gros écart.
 */
class CalageVideoTest {

    @Test
    fun `l'ecart a un sens et passe la fin de la boucle`() {
        assertEquals(0, ecartSigne(5_000, 5_000, 24_800))
        assertEquals(100, ecartSigne(5_100, 5_000, 24_800))
        assertEquals(-100, ecartSigne(5_000, 5_100, 24_800))
        // 0,05 s attendu, 24,75 s lu : la vidéo est 100 ms en retard, juste avant son tour.
        assertEquals(100, ecartSigne(50, 24_750, 24_800))
        assertEquals(-100, ecartSigne(24_750, 50, 24_800))
    }

    @Test
    fun `petit ecart, vitesse normale`() {
        assertEquals(1f, vitesseDeCalage(0, 1f))
        assertEquals(1f, vitesseDeCalage(110, 1f))
        assertEquals(1f, vitesseDeCalage(-110, 1f))
    }

    @Test
    fun `au-dela de la tolerance la video rattrape doucement, dans le bon sens`() {
        assertEquals(1.02f, vitesseDeCalage(200, 1f), 0.0001f)
        assertEquals(0.98f, vitesseDeCalage(-200, 1f), 0.0001f)
        assertEquals(1.05f, vitesseDeCalage(900, 1f), 0.0001f)
        assertEquals(0.95f, vitesseDeCalage(-900, 1f), 0.0001f)
    }

    @Test
    fun `une correction continue jusqu'a l'ecart presque nul, puis s'arrete`() {
        assertEquals(1.02f, vitesseDeCalage(80, 1.02f), 0.0001f)
        assertEquals(1f, vitesseDeCalage(30, 1.02f))
        // Dépassé dans l'autre sens : on ne continue pas à accélérer.
        assertEquals(1f, vitesseDeCalage(-80, 1.02f))
    }

    @Test
    fun `une video qui derive finit calee sans jamais sauter`() {
        // Vidéo qui lit 1 % trop lentement et un décalage constant de 150 ms au départ : la vitesse suffit.
        var ecart = 150.0
        var vitesse = 1f
        repeat(3_000) { // 10 minutes, une mesure toutes les 200 ms
            vitesse = vitesseDeCalage(ecart.toInt(), vitesse)
            ecart += 200.0 * (1.0 - 0.99 * vitesse)
            assertTrue("écart $ecart", abs(ecart) < SAUT_CALAGE_MS)
        }
        assertTrue("écart final $ecart", abs(ecart) <= ECART_ACCUEIL_MS)
    }
}
