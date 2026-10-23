package com.littlemissparty.quiz.tv.habillage

import android.content.Context
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.util.Log
import android.view.Surface
import android.view.TextureView
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.littlemissparty.quiz.tv.R

/**
 * Plateau 3D « The Game Show » en fond : une vidéo 1080p de 16 s (res/raw/gs_fond_plateau.mp4, calculée à l'avance
 * en vraie 3D, 8 mesures à 120 BPM) qui tourne en boucle derrière l'écran du jeu. La box ne fait que la lire avec sa
 * puce vidéo : aucune 3D calculée en direct. [surPret] : la première image est à l'écran (le décor dessiné peut
 * s'effacer) ; [surEchec] : vidéo illisible, le décor dessiné reste. Rien ici ne touche à la partie.
 */
@Composable
internal fun FondVideo3d(surPret: () -> Unit, surEchec: () -> Unit) {
    AndroidView(
        factory = { LecteurFond(it, R.raw.gs_fond_plateau, surPret, surEchec) },
        onRelease = { it.liberer() },
        modifier = Modifier.fillMaxSize(),
    )
}

/** Vidéo opaque en boucle dans un TextureView ; le décodage se fait dans le lecteur du système. */
internal class LecteurFond(
    context: Context,
    private val resId: Int,
    private val surPret: () -> Unit,
    private val surEchec: () -> Unit,
) : TextureView(context), TextureView.SurfaceTextureListener {
    private var lecteur: MediaPlayer? = null
    private var surface: Surface? = null
    private var fini = false

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
                isLooping = true
                setVolume(0f, 0f)
                setOnInfoListener { _, quoi, _ ->
                    if (quoi == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) surPret()
                    false
                }
                setOnErrorListener { _, quoi, extra ->
                    Log.w("Habillage", "Fond 3D ignoré : lecteur $quoi/$extra")
                    surEchec()
                    true
                }
                setOnPreparedListener { if (!fini) it.start() }
                prepareAsync()
            }
        } catch (e: Throwable) {
            Log.w("Habillage", "Fond 3D ignoré : ${e.message}")
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

    /** La vue quitte l'écran pour de bon : plus aucune lecture. */
    fun liberer() {
        fini = true
        arreter()
    }

    private fun arreter() {
        try { lecteur?.release() } catch (_: Throwable) {}
        lecteur = null
        surface?.release()
        surface = null
    }
}
