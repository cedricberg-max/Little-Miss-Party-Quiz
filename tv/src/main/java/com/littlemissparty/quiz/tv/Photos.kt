package com.littlemissparty.quiz.tv

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Photo plein cadre : décodée à au moins ce nombre de pixels sur son petit côté (assez pour la TV en 1080). */
internal const val PHOTO_PLEINE = 720

/** Cartes de Qui a disparu ? et des Mimes : plus petites, décodées plus petites (la Mi Box a peu de mémoire). */
internal const val PHOTO_CARTE_DISPARU = 240
internal const val PHOTO_CARTE_MIMES = 480

/**
 * Les photos de la partie décodées hors du fil de l'écran, gardées en mémoire (test du 27/10 au soir : petits
 * blocages au début des questions en images, la box décodait chaque photo pendant qu'elle dessinait l'écran). La box
 * décode d'avance celles de la question en cours et de la suivante ([prechauffer]) ; l'écran les trouve prêtes.
 */
internal object Photos {
    /** Une photo d'octets donnés (le même tableau que la box garde), à une taille donnée. */
    private class Cle(val octets: ByteArray, val cible: Int) {
        override fun equals(other: Any?) = other is Cle && other.octets === octets && other.cible == cible
        override fun hashCode() = System.identityHashCode(octets) * 31 + cible
    }

    /** 40 Mo d'images au plus (la Mi Box a peu de mémoire) : les plus anciennes repartent. */
    private val cache = object : LruCache<Cle, ImageBitmap>(40 * 1024 * 1024) {
        override fun sizeOf(key: Cle, value: ImageBitmap) = value.width * value.height * 4
    }

    /** Un décodage à la fois, en fond : le dessin de l'écran garde le processeur. */
    @OptIn(ExperimentalCoroutinesApi::class)
    internal val fil = Dispatchers.Default.limitedParallelism(1)
    private val portee = CoroutineScope(SupervisorJob() + fil)

    fun enCache(octets: ByteArray, cible: Int): ImageBitmap? = cache.get(Cle(octets, cible))

    /** Décode (réduite pour [cible] pixels de petit côté au moins) et garde ; null si la photo est abîmée. */
    fun decoder(octets: ByteArray, cible: Int): ImageBitmap? {
        val cle = Cle(octets, cible)
        cache.get(cle)?.let { return it }
        return runCatching {
            val bornes = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(octets, 0, octets.size, bornes)
            val reduction = reductionPour(bornes.outWidth, bornes.outHeight, cible)
            BitmapFactory.decodeByteArray(octets, 0, octets.size, BitmapFactory.Options().apply { inSampleSize = reduction })
                ?.apply { prepareToDraw() }?.asImageBitmap()
        }.getOrNull()?.also { cache.put(cle, it) }
    }

    /** Décode en fond, d'avance, si ce n'est pas déjà fait. */
    fun prechauffer(octets: ByteArray, cible: Int = PHOTO_PLEINE) {
        if (enCache(octets, cible) != null) return
        portee.launch { decoder(octets, cible) }
    }
}

/** Réduction par puissance de 2 qui garde au moins [cible] pixels sur le petit côté. */
internal fun reductionPour(largeur: Int, hauteur: Int, cible: Int): Int {
    var reduction = 1
    if (largeur <= 0 || hauteur <= 0 || cible <= 0) return reduction
    while (minOf(largeur, hauteur) / (reduction * 2) >= cible) reduction *= 2
    return reduction
}

/**
 * Photo prête à dessiner : tout de suite si la box l'a décodée d'avance, sinon décodée en fond (elle apparaît un
 * instant après, l'écran ne bloque jamais). Null tant qu'elle n'est pas là, ou si elle est abîmée.
 */
@Composable
internal fun rememberPhoto(octets: ByteArray?, cible: Int = PHOTO_PLEINE): ImageBitmap? {
    val prete = remember(octets, cible) { octets?.let { Photos.enCache(it, cible) } }
    val tardive by produceState<Pair<ByteArray?, ImageBitmap?>>(null to null, octets, cible) {
        if (prete == null && octets != null) value = octets to withContext(Photos.fil) { Photos.decoder(octets, cible) }
    }
    return prete ?: tardive.second.takeIf { tardive.first === octets && octets != null }
}
