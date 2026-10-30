package com.littlemissparty.quiz.tv.habillage

import java.nio.ByteBuffer
import java.nio.ByteOrder

// Lecture des WAV des boucles du Game Show ([BouclePcm]) : sans Android, testé dans WavTest.

/** Format d'un fichier WAV : où commencent ses échantillons et combien d'octets ils font. */
internal data class FormatWav(val canaux: Int, val frequence: Int, val bits: Int, val debutDonnees: Long, val octetsDonnees: Long) {
    val octetsParImage: Int get() = canaux * bits / 8
    val images: Long get() = octetsDonnees / octetsParImage
    val dureeMs: Long get() = images * 1000 / frequence
}

/**
 * Lit l'en-tête d'un WAV PCM 16 bits ([octets] : le début du fichier, quelques centaines d'octets suffisent).
 * null : ce n'est pas un WAV PCM 16 bits mono ou stéréo, ou ses données ne commencent pas dans [octets].
 */
internal fun lireEnteteWav(octets: ByteArray, tailleFichier: Long = Long.MAX_VALUE): FormatWav? {
    if (octets.size < 12) return null
    val b = ByteBuffer.wrap(octets).order(ByteOrder.LITTLE_ENDIAN)
    fun texte(pos: Int) = String(octets, pos, 4, Charsets.US_ASCII)
    if (texte(0) != "RIFF" || texte(8) != "WAVE") return null
    var pos = 12
    var canaux = 0
    var frequence = 0
    var bits = 0
    var pcm = false
    while (pos + 8 <= octets.size) {
        val id = texte(pos)
        val taille = b.getInt(pos + 4).toLong() and 0xffffffffL
        val corps = pos + 8
        when (id) {
            "fmt " -> {
                if (corps + 16 > octets.size) return null
                val forme = b.getShort(corps).toInt() and 0xffff
                // 1 : PCM ; 0xFFFE : extensible (ffmpeg l'écrit au-delà de 2 canaux), lu comme du PCM.
                pcm = forme == 1 || forme == 0xFFFE
                canaux = b.getShort(corps + 2).toInt()
                frequence = b.getInt(corps + 4)
                bits = b.getShort(corps + 14).toInt()
            }
            "data" -> {
                if (!pcm || bits != 16 || canaux !in 1..2 || frequence <= 0) return null
                val reste = (tailleFichier - corps).coerceAtLeast(0)
                // Taille inconnue (0 ou 0xFFFFFFFF, flux écrit sans retour arrière) : jusqu'à la fin du fichier.
                val octetsDonnees = if (taille == 0L || taille == 0xffffffffL) reste else minOf(taille, reste)
                val f = FormatWav(canaux, frequence, bits, corps.toLong(), octetsDonnees)
                return f.copy(octetsDonnees = f.images * f.octetsParImage).takeIf { it.images > 0 }
            }
        }
        pos = corps + (taille + (taille and 1)).toInt()
    }
    return null
}

/**
 * Les morceaux à lire pour sortir [n] images d'une boucle de [total] images, en partant de l'image [depuis] :
 * (début, longueur) ; le dernier finit au bout de la boucle et le suivant repart de [reprise] (0 : du début), à
 * l'image près. Avec une reprise, les images d'avant ne se lisent qu'une fois, au départ (une intro).
 */
internal fun morceauxBoucle(depuis: Long, n: Long, total: Long, reprise: Long = 0): List<Pair<Long, Long>> {
    require(total > 0 && reprise in 0 until total)
    val out = mutableListOf<Pair<Long, Long>>()
    var p = Math.floorMod(depuis, total)
    var reste = n
    while (reste > 0) {
        val l = minOf(reste, total - p)
        out += p to l
        reste -= l
        p += l
        if (p == total) p = reprise
    }
    return out
}

/** Image de la boucle où l'on arrive après avoir lu [n] images depuis [depuis] (voir [morceauxBoucle]). */
internal fun imageApres(depuis: Long, n: Long, total: Long, reprise: Long = 0): Long {
    val p = Math.floorMod(depuis, total) + n
    return if (p < total) p else reprise + (p - total) % (total - reprise)
}
