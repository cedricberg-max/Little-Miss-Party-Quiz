package com.littlemissparty.quiz.tv.habillage

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap

/**
 * Box qui ne décode qu'une vidéo à la fois (Mi Box) : le plateau 3D et un clip du robot ne peuvent pas tourner
 * ensemble. Quand un clip arrive, la TV garde l'image du plateau à cet instant ([image]), rend la vidéo du fond, joue
 * le clip par-dessus cette photo, puis relance le plateau au même point peu après le dernier clip ([DecorGameShow]).
 * Sur une box qui lit deux vidéos, rien de tout cela ne sert. Fil principal, sauf [fondsOuverts], lu par le fil du clip.
 */
internal object GelFond {
    /** Clips du robot qui attendent ou occupent la puce vidéo. */
    var demandes by mutableIntStateOf(0)
        private set

    /** La dernière image du plateau, à l'écran tant qu'il est figé. */
    var image by mutableStateOf<ImageBitmap?>(null)
        private set

    /** Où le plateau reprend (ms). */
    var reprise = 0
        private set

    /** Vidéos plein écran ouvertes (fond, accueil, intros) : un clip attend qu'il n'y en ait plus. */
    @Volatile var fondsOuverts = 0

    /** Le fond du décor à l'écran : c'est lui qu'on photographie. */
    var fond: LecteurFond? = null

    fun demander() {
        if (demandes == 0 && image == null) fond?.takeIf { it.affiche }?.let { f ->
            image = runCatching { f.bitmap?.asImageBitmap() }.getOrNull()
            reprise = f.position() ?: 0
        }
        demandes++
    }

    fun rendre() {
        if (demandes > 0) demandes--
    }

    /** Le plateau est reparti (ou ne repartira pas) : la photo s'en va. */
    fun oublierImage() {
        image = null
        reprise = 0
    }
}

/** Au-delà, le clip part quand même : sans robot, la partie continue de toute façon. */
internal const val ATTENTE_FOND_MAX_MS = 2_000L

/** Le plateau ne repart qu'après ce silence : des clips qui s'enchaînent ne le font pas clignoter. */
internal const val REPRISE_FOND_MS = 1_500L

/** Le fil du clip démarre le lecteur seulement quand la puce vidéo est libre (ou que l'attente a assez duré). */
internal fun clipPeutPartir(deuxVideos: Boolean, fondsOuverts: Int, attenteMs: Long): Boolean =
    deuxVideos || fondsOuverts <= 0 || attenteMs >= ATTENTE_FOND_MAX_MS
