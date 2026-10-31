package com.littlemissparty.quiz.tv

import android.content.Context
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.util.Log
import android.view.Surface
import android.view.TextureView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.viewinterop.AndroidView
import com.littlemissparty.quiz.tv.habillage.Liberation

/**
 * Le lancer du drap « à deux mains » (cedric, 31/10, version lente validée le matin) : le clip 3D du plateau entier,
 * 1920×1080. Buzzy part de sa pose du plateau, sort du cadre à droite, revient avec le drap tendu entre ses deux mains,
 * fait un geste vers le chrono : le drap part et se pose ; ses yeux et sa bouche n'apparaissent qu'une fois posé.
 * Ensuite [LANCER_BOUCLE] : Buzzy siffle l'air de rien et le drap respire, en boucle sans couture jusqu'au bilan.
 */
internal const val LANCER_VIDEO = "gs_chrono_lancer"
internal const val LANCER_BOUCLE = "gs_chrono_lancer_boucle"

/** Instant du clip où le drap se pose sur le chrono : calé pile sur le moment du drap tiré par la box. */
internal const val LANCER_POSE_MS = 5_620L

/** Instant du clip où le drap couvre déjà le cadran : plus aucun chiffre n'est dessiné dessus. */
internal const val LANCER_COUVRE_MS = 5_120L

/** Durée du clip du lancer (170 images à 25 i/s) ; la boucle prend la suite. */
internal const val LANCER_DUREE_MS = 6_800L

/** Heure du clip, depuis le 0 du chrono (négatif : pendant le décompte), pour que le drap se pose à [cacheMs]. */
internal fun departLancer(cacheMs: Long): Long = cacheMs - LANCER_POSE_MS

/**
 * Où en est le clip au temps [ecoule] du chrono : null avant son départ, sinon le temps écoulé dans le clip (au-delà de
 * [LANCER_DUREE_MS], c'est la boucle qui tourne).
 */
internal fun tempsLancer(ecoule: Long, cacheMs: Long): Long? = (ecoule - departLancer(cacheMs)).takeIf { it >= 0 }

/** Les chiffres sont encore dessinés : le drap du clip n'a pas encore atteint le cadran. */
internal fun chiffresVisibles(ecoule: Long, cacheMs: Long): Boolean = ecoule < departLancer(cacheMs) + LANCER_COUVRE_MS

/** Le clip et sa boucle sont dans l'appli (sinon le drap dessiné d'avant reste). */
@Composable
internal fun lancerDisponible(): Boolean {
    val context = LocalContext.current
    return remember {
        listOf(LANCER_VIDEO, LANCER_BOUCLE).all { context.resources.getIdentifier(it, "raw", context.packageName) != 0 }
    }
}

/**
 * Le clip du lancer, préparé dès le départ du tour et lancé à l'heure : [depart] = heure du serveur où il doit partir,
 * [maintenant] = heure du serveur. [cle] change à chaque tour (un nouveau tour repart du début). [echec] : illisible.
 */
@Composable
internal fun ClipLancer(cle: Any?, depart: Long, maintenant: () -> Long, echec: () -> Unit, modifier: Modifier) {
    val context = LocalContext.current
    val ids = remember {
        context.resources.getIdentifier(LANCER_VIDEO, "raw", context.packageName) to
            context.resources.getIdentifier(LANCER_BOUCLE, "raw", context.packageName)
    }
    AndroidView(
        factory = { LecteurLancer(it, ids.first, ids.second, echec) },
        update = { it.programmer(cle, depart, maintenant) },
        onRelease = { it.liberer() },
        modifier = modifier.clearAndSetSemantics {},
    )
}

/**
 * Une seule surface, un seul décodeur à la fois (Mi Box) : le clip est préparé à l'avance, mis en route à son heure
 * (s'il part en retard, il saute ce qui est passé), puis rendu ; sa dernière image reste à l'écran jusqu'à la première
 * de la boucle (pas d'écran noir).
 */
internal class LecteurLancer(
    context: Context,
    private val clip: Int,
    private val boucle: Int,
    private val echec: () -> Unit,
) : TextureView(context), TextureView.SurfaceTextureListener {
    private var surface: Surface? = null
    private var lecteur: MediaPlayer? = null
    private var pret = false
    private var cle: Any? = null
    private var depart = 0L
    private var maintenant: () -> Long = { System.currentTimeMillis() }
    private var fini = false
    private var generation = 0
    private val lancer = Runnable { demarrer() }

    init {
        surfaceTextureListener = this
        isOpaque = false
    }

    /** Le clip du tour [cle] part à l'heure [depart] (serveur). */
    fun programmer(cle: Any?, depart: Long, maintenant: () -> Long) {
        this.maintenant = maintenant
        if (cle == this.cle && depart == this.depart) return
        this.cle = cle
        this.depart = depart
        preparer()
    }

    private fun preparer() {
        val s = surface ?: return
        if (fini || cle == null) return
        removeCallbacks(lancer)
        val jeton = ++generation
        pret = false
        val ancien = lecteur
        lecteur = null
        if (ancien == null) creer(s, clip, false, jeton) else Liberation.lecteur(ancien, stop = true) {
            post { if (jeton == generation && !fini && surface === s) creer(s, clip, false, jeton) }
        }
    }

    private fun creer(s: Surface, res: Int, enBoucle: Boolean, jeton: Int) {
        try {
            lecteur = MediaPlayer().apply {
                context.resources.openRawResourceFd(res).use { setDataSource(it.fileDescriptor, it.startOffset, it.length) }
                setSurface(s)
                isLooping = enBoucle
                setVolume(0f, 0f)
                setOnErrorListener { _, quoi, extra ->
                    Log.w("Chrono", "Clip du lancer ignoré : lecteur $quoi/$extra")
                    echec()
                    true
                }
                setOnPreparedListener { mp ->
                    if (fini || lecteur !== mp || jeton != generation) return@setOnPreparedListener
                    if (enBoucle) mp.start() else {
                        pret = true
                        demarrer()
                    }
                }
                if (!enBoucle) setOnCompletionListener { mp -> if (lecteur === mp && jeton == generation) versBoucle() }
                prepareAsync()
            }
        } catch (e: Throwable) {
            Log.w("Chrono", "Clip du lancer ignoré : ${e.message}")
            echec()
        }
    }

    /** À l'heure : le clip part (en sautant ce qui est déjà passé) ; trop tôt : il attend ; tout passé : la boucle. */
    private fun demarrer() {
        val mp = lecteur ?: return
        if (!pret || fini) return
        removeCallbacks(lancer)
        val avance = depart - maintenant()
        when {
            avance > 15 -> postDelayed(lancer, avance)
            -avance >= LANCER_DUREE_MS - 200 -> versBoucle()
            else -> {
                if (-avance > 80) mp.seekTo((-avance).toInt())
                mp.start()
            }
        }
    }

    private fun versBoucle() {
        val s = surface ?: return
        val jeton = ++generation
        val ancien = lecteur
        lecteur = null
        pret = false
        if (ancien == null) creer(s, boucle, true, jeton) else Liberation.lecteur(ancien, stop = true) {
            post { if (jeton == generation && !fini && surface === s) creer(s, boucle, true, jeton) }
        }
    }

    override fun onSurfaceTextureAvailable(st: SurfaceTexture, largeur: Int, hauteur: Int) {
        surface = Surface(st)
        preparer()
    }

    override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, largeur: Int, hauteur: Int) = Unit

    override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
        val s = surface
        surface = null
        arreter { s?.release() }
        return true
    }

    override fun onSurfaceTextureUpdated(st: SurfaceTexture) = Unit

    fun liberer() {
        fini = true
        arreter()
    }

    private fun arreter(apres: () -> Unit = {}) {
        removeCallbacks(lancer)
        generation++
        val l = lecteur
        lecteur = null
        if (l != null) Liberation.lecteur(l, stop = true, apres) else apres()
    }
}
