package com.littlemissparty.quiz.tv.habillage

import android.content.Context
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.os.SystemClock
import android.util.Log
import android.view.Surface
import android.view.TextureView
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.littlemissparty.quiz.tv.R
import kotlinx.coroutines.delay
import kotlin.math.abs

/**
 * Plateau 3D « The Game Show » en fond : une vidéo 1080p de 16 s (res/raw/gs_fond_plateau.mp4, calculée à l'avance
 * en vraie 3D, 8 mesures à 120 BPM) qui tourne en boucle derrière l'écran du jeu. La box ne fait que la lire avec sa
 * puce vidéo : aucune 3D calculée en direct. [surPret] : la première image est à l'écran (le décor dessiné peut
 * s'effacer) ; [surEchec] : vidéo illisible, le décor dessiné reste. Rien ici ne touche à la partie.
 */
@Composable
internal fun FondVideo3d(surPret: () -> Unit, surEchec: () -> Unit) {
    AndroidView(
        factory = { LecteurFond(it, R.raw.gs_fond_plateau, surPret, surEchec, departMs = GelFond.reprise) },
        update = { GelFond.fond = it },
        onRelease = { lacher(it) },
        modifier = Modifier.fillMaxSize(),
    )
}

/**
 * Accueil du Game Show : le robot qui dort sur le plateau (res/raw/gs_accueil_video.mp4, 24,8 s, muette, calculée à
 * l'avance), calé sur la boucle de Get Lucky que joue [Sons] : à chaque tour de la musique ([Sons.tourAccueil]), la
 * vidéo doit être au même point ; un écart de plus de [ECART_ACCUEIL_MS] la remet en place. Sans musique (box muette),
 * elle tourne seule en boucle. Même contrat que [FondVideo3d].
 */
@Composable
internal fun VideoAccueil(surPret: () -> Unit, surEchec: () -> Unit) {
    var lecteur by remember { mutableStateOf<LecteurFond?>(null) }
    AndroidView(
        factory = { LecteurFond(it, R.raw.gs_accueil_video, surPret, surEchec) },
        update = {
            lecteur = it
            GelFond.fond = it
        },
        onRelease = { lacher(it) },
        modifier = Modifier.fillMaxSize(),
    )
    LaunchedEffect(lecteur) {
        val v = lecteur ?: return@LaunchedEffect
        var dernierCalage = 0L
        while (true) {
            delay(200)
            val tour = Sons.tourAccueil
            val pos = v.position() ?: continue
            val duree = v.duree() ?: continue
            if (tour <= 0L) continue
            val attendu = Math.floorMod(SystemClock.elapsedRealtime() - tour, duree.toLong()).toInt()
            val ecart = abs(attendu - pos).let { minOf(it, duree - it) }
            // Un saut au plus toutes les 3 s : le temps que la box décode l'image demandée.
            val maintenant = SystemClock.uptimeMillis()
            if (ecart > ECART_ACCUEIL_MS && maintenant - dernierCalage > 3_000) {
                v.caler(attendu)
                dernierCalage = maintenant
            }
        }
    }
}

/** Le fond du décor quitte l'écran : la puce vidéo est rendue tout de suite (un clip du robot peut l'attendre). */
private fun lacher(lecteur: LecteurFond) {
    if (GelFond.fond === lecteur) GelFond.fond = null
    lecteur.liberer()
}

/** Écart toléré entre la vidéo de l'accueil et sa musique (ms) : moins d'un temps à 116 BPM, invisible à l'œil. */
internal const val ECART_ACCUEIL_MS = 120

/**
 * Vidéo opaque dans un TextureView ; le décodage se fait dans le lecteur du système. Par défaut muette et en boucle
 * (fonds). [volume] > 0 : le son de la vidéo sort aussi (grande intro du lancement). [surFin] : appelé une fois, à la
 * fin de la vidéo (sans boucle) ou dès [finMs] atteint. [departMs] : la vidéo commence là (plateau qui reprend
 * après un clip du robot, [GelFond]). [repriseMs] : à la fin du fichier, la vidéo repart de là (une arrivée jouée
 * une fois, puis une boucle : écran de fin). [attenteMs] : délai avant de partir, lu quand la vidéo est prête.
 */
internal class LecteurFond(
    context: Context,
    private val resId: Int,
    private val surPret: () -> Unit,
    private val surEchec: () -> Unit,
    private val boucle: Boolean = true,
    private val volume: Float = 0f,
    private val finMs: Int = Int.MAX_VALUE,
    private val surFin: () -> Unit = {},
    private val departMs: Int = 0,
    private val repriseMs: Int? = null,
    private val attenteMs: () -> Int = { 0 },
) : TextureView(context), TextureView.SurfaceTextureListener {
    private var lecteur: MediaPlayer? = null
    private var surface: Surface? = null
    private var fini = false
    private var finSignalee = false

    /** Une image est à l'écran (avant, une photo du fond serait noire). */
    var affiche = false
        private set
    private val guetteur = object : Runnable {
        override fun run() {
            val l = lecteur ?: return
            if ((runCatching { l.currentPosition }.getOrNull() ?: 0) >= finMs) return terminer()
            postDelayed(this, 50)
        }
    }

    init {
        surfaceTextureListener = this
    }

    override fun onSurfaceTextureAvailable(st: SurfaceTexture, largeur: Int, hauteur: Int) {
        if (fini) return
        arreter()
        try {
            val s = Surface(st).also { surface = it }
            lecteur = MediaPlayer().apply {
                context.resources.openRawResourceFd(resId).use { setDataSource(it.fileDescriptor, it.startOffset, it.length) }
                setSurface(s)
                isLooping = boucle && repriseMs == null
                setVolume(volume, volume)
                setOnInfoListener { _, quoi, _ ->
                    if (quoi == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) {
                        affiche = true
                        surPret()
                    }
                    false
                }
                setOnErrorListener { _, quoi, extra ->
                    Log.w("Habillage", "Vidéo ignorée : lecteur $quoi/$extra")
                    if (GelFond.clipsOuverts.get() > 0) GelFond.uneSeuleVideo()
                    surEchec()
                    true
                }
                setOnCompletionListener { mp ->
                    val r = repriseMs
                    if (r != null) {
                        runCatching {
                            mp.seekTo(r.toLong(), MediaPlayer.SEEK_CLOSEST)
                            mp.start()
                        }
                    } else if (!boucle) terminer()
                }
                setOnPreparedListener { mp ->
                    if (fini) return@setOnPreparedListener
                    if (departMs > 0) runCatching { mp.seekTo(departMs.toLong(), MediaPlayer.SEEK_CLOSEST) }
                    val lancer = Runnable {
                        if (fini || lecteur !== mp) return@Runnable
                        mp.start()
                        if (finMs < Int.MAX_VALUE) post(guetteur)
                    }
                    val attente = attenteMs()
                    if (attente > 0) postDelayed(lancer, attente.toLong()) else lancer.run()
                }
                prepareAsync()
            }
            GelFond.fondsOuverts++
        } catch (e: Throwable) {
            Log.w("Habillage", "Vidéo ignorée : ${e.message}")
            surEchec()
        }
    }

    override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, largeur: Int, hauteur: Int) = Unit

    // Surface perdue (veille, autre appli) : la vidéo s'arrête et le décor dessiné revient ; elle repart à la surface
    // suivante tant que la vue n'est pas libérée.
    override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
        arreter()
        if (!fini) surEchec()
        return true
    }

    override fun onSurfaceTextureUpdated(st: SurfaceTexture) = Unit

    /** Position de lecture (ms), ou null tant que la vidéo n'est pas prête. */
    fun position(): Int? = lecteur?.let { l -> runCatching { if (l.isPlaying) l.currentPosition else null }.getOrNull() }

    /** Durée de la vidéo (ms), ou null tant qu'elle n'est pas prête. */
    fun duree(): Int? = lecteur?.let { l -> runCatching { l.duration.takeIf { it > 0 } }.getOrNull() }

    /** Saute à [ms] exactement (l'image la plus proche, pas seulement l'image clé). */
    fun caler(ms: Int) {
        val l = lecteur ?: return
        runCatching { l.seekTo(ms.toLong(), MediaPlayer.SEEK_CLOSEST) }
    }

    /** La vue quitte l'écran pour de bon : plus aucune lecture. */
    fun liberer() {
        fini = true
        arreter()
    }

    private fun terminer() {
        removeCallbacks(guetteur)
        if (finSignalee || fini) return
        finSignalee = true
        surFin()
    }

    private fun arreter() {
        removeCallbacks(guetteur)
        val l = lecteur
        lecteur = null
        if (l != null) {
            try { l.release() } catch (_: Throwable) {}
            GelFond.fondsOuverts--
        }
        surface?.release()
        surface = null
    }
}
