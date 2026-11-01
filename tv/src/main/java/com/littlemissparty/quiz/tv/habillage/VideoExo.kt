package com.littlemissparty.quiz.tv.habillage

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters

/**
 * Le nouveau lecteur vidéo de la box (point 46, cedric 1/11 : « que tous les raccords soient vraiment invisibles »).
 * L'ancien lecteur du système (MediaPlayer) vidait son décodeur et repartait à chaque tour de boucle : un petit trou,
 * sur toutes les vidéos en boucle. Celui-ci (Media3 ExoPlayer) prépare le tour suivant pendant que le tour en cours
 * se joue et enchaîne sans s'arrêter, comme une seule vidéo sans fin.
 *
 * Trois façons de jouer ([modeDeLecture]) : une fois, en boucle entière, ou une fois en entier puis en boucle à partir
 * de [repriseMs] (arrivée puis boucle : écran de fin, clips du robot). Dans ce dernier cas, la boucle est le même
 * fichier coupé à [repriseMs] : la box l'a déjà préparé quand le premier passage se termine.
 *
 * Tous les appels se font sur le fil de [looper] (celui de l'écran, ou le fil OpenGL des clips du robot) ; les
 * réponses ([surPrete], [surPremiereImage], [surFin], [surErreur]) arrivent sur ce même fil.
 */
@OptIn(UnstableApi::class)
internal class VideoExo(
    private val context: Context,
    resId: Int,
    looper: Looper,
    boucle: Boolean,
    repriseMs: Int? = null,
    avecSon: Boolean = false,
) {
    private var repriseMs: Int? = repriseMs
    private var mode = modeDeLecture(boucle, repriseMs)
    private val handler = Handler(looper)
    private val joueur: ExoPlayer = ExoPlayer.Builder(context).setLooper(looper).setLoadControl(chargementLeger()).build()
    private var pretSignale = false
    private var imageSignalee = false
    private var finSignalee = false
    private var libere = false
    private var dureeFichier: Int? = null

    /** Première fois que la vidéo est prête à partir (avant [demarrer]). */
    var surPrete: () -> Unit = {}
    /** Première image vraiment affichée. */
    var surPremiereImage: () -> Unit = {}
    /** Fin de la vidéo jouée une fois (jamais en boucle). */
    var surFin: () -> Unit = {}
    var surErreur: (String) -> Unit = {}

    init {
        charger(resId, boucle, repriseMs)
        if (avecSon) {
            // Vidéo qui a du son : sur la même sortie que les sons du jeu (même volume de la TV), sans prendre la main.
            joueur.setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_GAME).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), false)
        } else {
            // Vidéo muette : la piste son n'est même pas décodée (moins de travail pour la box).
            joueur.volume = 0f
            joueur.trackSelectionParameters = joueur.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true).build()
        }
        joueur.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(etat: Int) {
                if (libere) return
                if (etat == Player.STATE_READY && !pretSignale) {
                    pretSignale = true
                    surPrete()
                }
                if (etat == Player.STATE_ENDED && mode == ModeLecture.UNE_FOIS && !finSignalee) {
                    finSignalee = true
                    surFin()
                }
            }

            override fun onMediaItemTransition(element: MediaItem?, raison: Int) {
                // Arrivée finie : on est dans la boucle, elle tourne maintenant sans fin.
                if (!libere && mode == ModeLecture.ARRIVEE_PUIS_BOUCLE && joueur.currentMediaItemIndex == 1) {
                    joueur.repeatMode = Player.REPEAT_MODE_ONE
                }
            }

            override fun onRenderedFirstFrame() {
                if (libere || imageSignalee) return
                imageSignalee = true
                surPremiereImage()
            }

            override fun onPlayerError(erreur: PlaybackException) {
                if (libere) return
                surErreur("${erreur.errorCodeName} ${erreur.message}")
            }
        })
    }

    /**
     * Met la vidéo [resId] à la place de celle en cours, sur le même lecteur et la même surface (clips du Duel et du
     * Chrono qui s'enchaînent) : rien à rendre ni à recréer entre les deux. Repart avec [demarrer] une fois prête.
     * [puisBoucle] : après [resId] joué une fois, cette vidéo-là tourne en boucle.
     */
    fun charger(resId: Int, boucle: Boolean, repriseMs: Int? = null, puisBoucle: Int? = null) {
        if (libere) return
        this.repriseMs = repriseMs.takeIf { puisBoucle == null }
        mode = if (puisBoucle != null) ModeLecture.ARRIVEE_PUIS_BOUCLE else modeDeLecture(boucle, repriseMs)
        pretSignale = false
        imageSignalee = false
        finSignalee = false
        dureeFichier = null
        val uri = Uri.parse("android.resource://${context.packageName}/$resId")
        val entiere = MediaItem.fromUri(uri)
        val elements = if (puisBoucle != null) {
            // Un clip joué une fois, puis une autre vidéo en boucle, enchaînée sans trou (lancer du Chrono).
            listOf(entiere, MediaItem.fromUri(Uri.parse("android.resource://${context.packageName}/$puisBoucle")))
        } else if (mode == ModeLecture.ARRIVEE_PUIS_BOUCLE) {
            listOf(
                entiere,
                MediaItem.Builder().setUri(uri)
                    .setClippingConfiguration(MediaItem.ClippingConfiguration.Builder().setStartPositionMs(repriseMs!!.toLong()).build())
                    .build(),
            )
        } else listOf(entiere)
        joueur.playWhenReady = false
        joueur.setMediaItems(elements)
        joueur.repeatMode = if (mode == ModeLecture.BOUCLE) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
    }

    /** Branche la surface et prépare (sans partir). [departMs] : départ à cet endroit, sur l'image clé si [surImageCle]. */
    fun preparer(surface: Surface, departMs: Int = 0, surImageCle: Boolean = false) {
        joueur.setVideoSurface(surface)
        if (departMs > 0) caler(departMs, surImageCle)
        joueur.playWhenReady = false
        joueur.prepare()
    }

    /** Saute directement à la boucle qui suit le premier passage. */
    fun allerALaBoucle() {
        if (libere || mode != ModeLecture.ARRIVEE_PUIS_BOUCLE) return
        joueur.seekTo(1, 0L)
        joueur.repeatMode = Player.REPEAT_MODE_ONE
    }

    fun demarrer() {
        if (!libere) joueur.playWhenReady = true
    }

    fun pause() {
        if (!libere) joueur.playWhenReady = false
    }

    fun volume(v: Float) {
        if (!libere) joueur.volume = v
    }

    val joue: Boolean get() = !libere && joueur.isPlaying

    /** Saute à [ms] du fichier : l'image exacte, ou l'image clé la plus proche si [surImageCle] (jamais d'image grise). */
    fun caler(ms: Int, surImageCle: Boolean = false) {
        if (libere) return
        joueur.setSeekParameters(if (surImageCle) SeekParameters.CLOSEST_SYNC else SeekParameters.EXACT)
        val r = repriseMs
        // Dans la boucle (fichier coupé à [repriseMs]), les positions comptent depuis la coupure.
        if (r != null && joueur.currentMediaItemIndex == 1 && ms >= r) joueur.seekTo(1, (ms - r).toLong())
        else joueur.seekTo(0, ms.toLong())
    }

    /** Vitesse de lecture (1 = normale, 0 = figée sur l'image en cours). */
    fun vitesse(v: Float) {
        if (libere) return
        if (v <= 0f) {
            joueur.playWhenReady = false
            return
        }
        joueur.setPlaybackSpeed(v)
        joueur.playWhenReady = true
    }

    /** Position dans le fichier (ms), même dans la boucle coupée à [repriseMs]. */
    val position: Int
        get() {
            if (libere) return 0
            val p = joueur.currentPosition.toInt()
            val r = repriseMs
            return if (r != null && joueur.currentMediaItemIndex == 1) p + r else p
        }

    /** Durée du fichier (ms), ou null tant qu'elle n'est pas connue. */
    val duree: Int?
        get() {
            if (libere) return dureeFichier
            if (joueur.currentMediaItemIndex == 0) joueur.duration.takeIf { it != C.TIME_UNSET && it > 0 }?.let { dureeFichier = it.toInt() }
            return dureeFichier
        }

    /** Vrai si la vidéo a une piste son lisible (grande intro). */
    fun aDuSon(): Boolean = runCatching { joueur.currentTracks.containsType(C.TRACK_TYPE_AUDIO) }.getOrDefault(true)

    /**
     * Rend le lecteur. [differe] (fil de l'écran) : il s'arrête tout de suite, sans attendre, et n'est rendu qu'un peu
     * plus tard, une fois son décodeur lâché : rendre un lecteur qui tourne bloque le fil jusqu'à une demi-seconde sur
     * la Mi Box (gels au changement d'écran, rapports du 26/10). [apres] : ce qui ne peut partir qu'après lui (la
     * surface dans laquelle il dessine).
     */
    fun liberer(differe: Boolean = true, apres: () -> Unit = {}) {
        if (libere) return
        libere = true
        val fin = Runnable {
            runCatching { joueur.release() }.onFailure { Log.w("Habillage", "Lecteur vidéo mal rendu : ${it.message}") }
            runCatching(apres)
        }
        if (differe) {
            runCatching { joueur.stop() }
            handler.postDelayed(fin, LIBERATION_DIFFEREE_MS)
        } else fin.run()
    }
}

internal enum class ModeLecture { UNE_FOIS, BOUCLE, ARRIVEE_PUIS_BOUCLE }

/** Une fois, en boucle entière, ou une fois en entier puis en boucle depuis [repriseMs]. */
internal fun modeDeLecture(boucle: Boolean, repriseMs: Int?): ModeLecture = when {
    repriseMs != null && repriseMs > 0 -> ModeLecture.ARRIVEE_PUIS_BOUCLE
    boucle || repriseMs == 0 -> ModeLecture.BOUCLE
    else -> ModeLecture.UNE_FOIS
}

/** Délai avant de rendre un lecteur arrêté (ms) : son décodeur est lâché, le rendre ne bloque plus rien. */
internal const val LIBERATION_DIFFEREE_MS = 800L

/**
 * Réserve de lecture d'un lecteur : quelques secondes d'avance seulement. Par défaut, ExoPlayer garde jusqu'à 50 s de
 * vidéo en mémoire (plusieurs dizaines de Mo par vidéo 1080p) ; avec le décor, une intro et les clips de Buzzy ouverts
 * en même temps, la mémoire de l'appli débordait. Les vidéos sont dans l'appli : elles se lisent bien plus vite qu'elles
 * ne se jouent, et [VIDEO_AVANCE_MAX_MS] d'avance suffit à préparer le tour de boucle suivant.
 */
@OptIn(UnstableApi::class)
internal fun chargementLeger(): DefaultLoadControl = DefaultLoadControl.Builder()
    .setBufferDurationsMs(VIDEO_AVANCE_MIN_MS, VIDEO_AVANCE_MAX_MS, 250, 500)
    .setTargetBufferBytes(VIDEO_RESERVE_OCTETS)
    .setPrioritizeTimeOverSizeThresholds(false)
    .build()

internal const val VIDEO_AVANCE_MIN_MS = 1_500
internal const val VIDEO_AVANCE_MAX_MS = 4_000
/** Au plus 6 Mo de vidéo d'avance par lecteur. */
internal const val VIDEO_RESERVE_OCTETS = 6 * 1024 * 1024
