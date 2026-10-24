package com.littlemissparty.quiz.tv.habillage

import android.media.MediaCodecList
import android.util.Log

/**
 * Nombre de vidéos H.264 que la box peut décoder en même temps, d'après son décodeur matériel (celui de la puce vidéo,
 * pas les décodeurs logiciels d'Android, trop lents pour du 1080p sur une Mi Box). 0 si la box ne répond pas.
 */
fun videosSimultanees(): Int = try {
    val avc = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
        .filter { !it.isEncoder && it.supportedTypes.any { t -> t.equals("video/avc", ignoreCase = true) } }
        .map { it.name to it.getCapabilitiesForType("video/avc").maxSupportedInstances }
    Log.i("Decodeurs", "Décodeurs H.264 : $avc")
    instancesMaterielles(avc)
} catch (e: Exception) {
    Log.w("Decodeurs", "Décodeurs illisibles", e)
    0
}

/** Décodeurs logiciels d'Android : présents partout, ils ne disent rien de la puce vidéo. */
private fun logiciel(nom: String) = nom.startsWith("OMX.google.", ignoreCase = true) || nom.startsWith("c2.android.", ignoreCase = true)

/** Le premier décodeur matériel donne la réponse ; sans décodeur matériel (émulateur), le meilleur logiciel. */
internal fun instancesMaterielles(decodeurs: List<Pair<String, Int>>): Int =
    decodeurs.firstOrNull { !logiciel(it.first) }?.second ?: decodeurs.maxOfOrNull { it.second } ?: 0
