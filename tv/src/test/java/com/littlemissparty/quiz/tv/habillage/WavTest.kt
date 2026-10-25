package com.littlemissparty.quiz.tv.habillage

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Les boucles du Game Show en WAV, lues en continu par [BouclePcm] : en-tête et enchaînement fin → début. */
class WavTest {

    private fun morceau(id: String, corps: ByteArray): ByteArray {
        val b = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN)
        b.put(id.toByteArray(Charsets.US_ASCII)).putInt(corps.size)
        return b.array() + corps + if (corps.size % 2 == 1) byteArrayOf(0) else byteArrayOf()
    }

    private fun fmt(forme: Int = 1, canaux: Int = 2, frequence: Int = 44_100, bits: Int = 16): ByteArray {
        val b = ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN)
        b.putShort(forme.toShort()).putShort(canaux.toShort()).putInt(frequence)
            .putInt(frequence * canaux * bits / 8).putShort((canaux * bits / 8).toShort()).putShort(bits.toShort())
        return morceau("fmt ", b.array())
    }

    private fun wav(vararg morceaux: ByteArray): ByteArray {
        val corps = ByteArrayOutputStream().apply { write("WAVE".toByteArray()); morceaux.forEach { write(it) } }.toByteArray()
        return morceau("RIFF", corps)
    }

    @Test
    fun `un WAV stereo 16 bits donne ses echantillons et sa duree`() {
        val f = lireEnteteWav(wav(fmt(), morceau("data", ByteArray(44_100 * 4))))!!
        assertEquals(2, f.canaux)
        assertEquals(44_100, f.frequence)
        assertEquals(44L, f.debutDonnees)
        assertEquals(44_100L, f.images)
        assertEquals(1_000L, f.dureeMs)
    }

    @Test
    fun `les morceaux avant les donnees sont sautes, taille impaire comprise`() {
        val f = lireEnteteWav(wav(fmt(), morceau("LIST", ByteArray(5)), morceau("data", ByteArray(400))))!!
        // 12 (RIFF) + 24 (fmt) + 8 + 5 + 1 (octet de bourrage) + 8 (en-tête data).
        assertEquals(58L, f.debutDonnees)
        assertEquals(100L, f.images)
    }

    @Test
    fun `donnees annoncees plus longues que le fichier, ou image incomplete, ramenees a ce qui existe`() {
        val octets = wav(fmt(), morceau("data", ByteArray(402)))
        assertEquals(100L, lireEnteteWav(octets)!!.images)
        assertEquals(50L, lireEnteteWav(octets, tailleFichier = 44L + 200)!!.images)
    }

    @Test
    fun `tout autre fichier est refuse, et la boucle reste lue par deux lecteurs`() {
        assertNull(lireEnteteWav("OggS".toByteArray() + ByteArray(60)))
        assertNull(lireEnteteWav(wav(fmt(bits = 24), morceau("data", ByteArray(600)))))
        assertNull(lireEnteteWav(wav(fmt(forme = 3, bits = 32), morceau("data", ByteArray(800)))))
        assertNull(lireEnteteWav(wav(fmt(canaux = 6), morceau("data", ByteArray(1200)))))
        assertNull(lireEnteteWav(wav(fmt())))
        assertNull(lireEnteteWav(ByteArray(8)))
    }

    @Test
    fun `la lecture enchaine la fin de la boucle sur son debut, a l'image pres`() {
        assertEquals(listOf(10L to 50L), morceauxBoucle(10, 50, 100))
        assertEquals(listOf(80L to 20L, 0L to 30L), morceauxBoucle(80, 50, 100))
        assertEquals(listOf(50L to 50L), morceauxBoucle(50, 50, 100))
        // Plus long que la boucle : elle repasse plusieurs fois.
        assertEquals(listOf(90L to 10L, 0L to 100L, 0L to 40L), morceauxBoucle(90, 150, 100))
        // Un départ au-delà de la fin retombe dans la boucle.
        assertEquals(listOf(30L to 10L), morceauxBoucle(230, 10, 100))
        assertEquals(50L, morceauxBoucle(77, 50, 100).sumOf { it.second })
    }

    @Test
    fun `les boucles du Game Show livrees en WAV se lisent en flux continu`() {
        // Les tests JVM d'Android tournent depuis le dossier du module tv/.
        val wavs = java.io.File("src/main/res/raw").listFiles().orEmpty().filter { it.extension == "wav" }
        val attendus = Lit.entries.mapNotNull { it.fichierPour(true) }.map { it.replaceFirst("lmp_", "gs_") }
        assertTrue("Boucles du Game Show pas en WAV : ${attendus - wavs.map { it.nameWithoutExtension }.toSet()}",
            attendus.all { n -> wavs.any { it.nameWithoutExtension == n } })
        for (f in wavs) {
            val octets = f.readBytes()
            val e = lireEnteteWav(octets.copyOf(512), octets.size.toLong())
            assertNotNull("${f.name} illisible", e)
            assertEquals("${f.name} : données jusqu'au bout du fichier", octets.size.toLong(), e!!.debutDonnees + e.octetsDonnees)
        }
    }
}
