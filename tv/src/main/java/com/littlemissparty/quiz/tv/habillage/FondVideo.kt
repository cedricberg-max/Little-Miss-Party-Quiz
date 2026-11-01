package com.littlemissparty.quiz.tv.habillage

import android.content.Context
import android.graphics.SurfaceTexture
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.SystemClock
import android.util.Log
import android.view.Surface
import android.view.TextureView
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.littlemissparty.quiz.tv.R
import kotlin.math.abs

/**
 * Plateau 3D « The Game Show » en fond : une vidéo 1080p de 13,4 s (res/raw/gs_fond_plateau.mp4, le studio du décor
 * Gemini n°4 validé par cedric le 28/10, stabilisé, en aller-retour sans raccord et ralenti × 0,6 au choix de cedric
 * le 29/10 ; l'affiche gs_fond_poster est sa première image ; l'ancien plateau est gardé dans
 * tv/sauvegarde/) qui tourne en boucle derrière l'écran du jeu, sans calage sur la musique. La box ne fait que la lire avec sa
 * puce vidéo : aucune 3D calculée en direct. [surPret] : la première image est à l'écran (le décor dessiné peut
 * s'effacer) ; [surEchec] : vidéo illisible, le décor dessiné reste. Rien ici ne touche à la partie.
 */
@Composable
internal fun FondVideo3d(surPret: () -> Unit, surEchec: () -> Unit) {
    AndroidView(
        factory = { LecteurFond(it, R.raw.gs_fond_plateau, surPret, surEchec, departMs = GelFond.reprise, imagesAvantPret = IMAGES_PROPRES_DECOR, departSurImageCle = true) },
        update = { GelFond.fond = it },
        onRelease = { lacher(it) },
        modifier = Modifier.fillMaxSize(),
    )
}

/**
 * Accueil du Game Show : le robot qui dort sur le plateau (res/raw/gs_accueil_video.mp4, 22 s à 24 i/s, muette, calculée à
 * l'avance). Elle tourne seule en boucle, sans calage sur la boucle de Get Lucky (cedric, 24/10 : à l'accueil, la
 * continuité de la musique compte, pas quelle image tombe sur quel temps ; chaque recalage faisait une micro-saccade).
 * Même contrat que [FondVideo3d].
 */
@Composable
internal fun VideoAccueil(surPret: () -> Unit, surEchec: () -> Unit) {
    AndroidView(
        factory = { LecteurFond(it, R.raw.gs_accueil_video, surPret, surEchec, imagesAvantPret = IMAGES_PROPRES_DECOR) },
        update = { GelFond.fond = it },
        onRelease = { lacher(it) },
        modifier = Modifier.fillMaxSize(),
    )
}

/**
 * Garde une vidéo sur sa musique sans saccade (écran de fin, cedric, 24/10) : un petit écart se rattrape en accélérant
 * ou en ralentissant la vidéo ([vitesseDeCalage]), invisible à l'œil. Avant, chaque écart de plus de [ECART_CALAGE_MS]
 * faisait sauter la vidéo ; la box redécodait l'image (la micro-saccade) et repartait en retard, d'où un nouveau saut
 * 3 à 5 s plus tard. Seul un très gros écart, mesuré [MESURES_AVANT_SAUT] fois de suite (vidéo partie loin de sa
 * musique, pas une mesure de travers), saute encore, au plus une fois toutes les [ENTRE_SAUTS_MS].
 */
internal class SuiviMusique {
    private var dernierSaut = Long.MIN_VALUE / 2
    private var grosEcarts = 0

    fun suivre(v: LecteurFond, attendu: Int, ecart: Int) {
        val maintenant = SystemClock.uptimeMillis()
        grosEcarts = if (abs(ecart) > SAUT_CALAGE_MS) grosEcarts + 1 else 0
        if (grosEcarts >= MESURES_AVANT_SAUT && maintenant - dernierSaut > ENTRE_SAUTS_MS) {
            v.vitesse(1f)
            v.caler(attendu)
            dernierSaut = maintenant
            grosEcarts = 0
            return
        }
        v.vitesse(vitesseDeCalage(ecart, v.vitesseActuelle))
    }
}

/** Écart signé (ms) dans une boucle de [boucleMs] : positif, la vidéo est en retard sur [attendu]. */
internal fun ecartSigne(attendu: Int, position: Int, boucleMs: Int): Int {
    val d = Math.floorMod(attendu - position, boucleMs)
    return if (d * 2 > boucleMs) d - boucleMs else d
}

/**
 * Vitesse de lecture qui ramène la vidéo sur sa musique : normale tant que l'écart reste sous [ECART_CALAGE_MS]
 * (une correction en cours continue jusqu'à [CALAGE_RETOUR_MS]), puis 2 % plus vite ou plus lentement, 5 % au-delà de
 * [CALAGE_FORT_MS]. [actuelle] : la vitesse en cours, gardée tant qu'elle va dans le bon sens.
 */
internal fun vitesseDeCalage(ecart: Int, actuelle: Float): Float {
    val a = abs(ecart)
    val sens = if (ecart > 0) 1f else -1f
    return when {
        a <= CALAGE_RETOUR_MS -> 1f
        a <= ECART_CALAGE_MS -> if ((actuelle - 1f) * sens > 0f) actuelle else 1f
        a <= CALAGE_FORT_MS -> 1f + sens * 0.02f
        else -> 1f + sens * 0.05f
    }
}

/** Le fond du décor quitte l'écran : la puce vidéo est rendue tout de suite (un clip du robot peut l'attendre). */
private fun lacher(lecteur: LecteurFond) {
    if (GelFond.fond === lecteur) GelFond.fond = null
    lecteur.liberer()
}

/**
 * La vidéo du décor peut remplacer sa photo : le lecteur a rendu sa première image et [attendues] images sont
 * vraiment arrivées dans la vue depuis (les premières, encore en train de se décoder, restent cachées).
 */
internal fun fondPret(renduCommence: Boolean, recues: Int, attendues: Int): Boolean = renduCommence && recues >= attendues

/** Images propres attendues avant de montrer le décor vidéo (≈ 0,2 s à 24 i/s). */
internal const val IMAGES_PROPRES_DECOR = 4

/** Au plus cette attente (ms) après la première image, si la box ne signale pas les suivantes. */
internal const val ATTENTE_IMAGES_MAX_MS = 600L

/** Écart toléré entre une vidéo et sa musique (ms) : moins d'un quart de temps à 120 BPM, invisible à l'œil. */
internal const val ECART_CALAGE_MS = 120

/** Une correction de vitesse s'arrête sous cet écart (ms). */
internal const val CALAGE_RETOUR_MS = 40

/** Au-delà (ms), la correction passe de 2 % à 5 %. */
internal const val CALAGE_FORT_MS = 600

/** Au-delà (ms), la vidéo saute au bon endroit (une fois : la vitesse rattrape ensuite le reste). */
internal const val SAUT_CALAGE_MS = 1_500

/** Jamais deux sauts à moins de 10 s d'intervalle. */
internal const val ENTRE_SAUTS_MS = 10_000L

/** Un saut seulement après 5 mesures de suite au-delà de [SAUT_CALAGE_MS] (1 s). */
internal const val MESURES_AVANT_SAUT = 5

/**
 * Vidéo opaque dans un TextureView ; le décodage se fait dans le lecteur du système. Par défaut muette et en boucle
 * (fonds). [volume] > 0 : le son de la vidéo sort aussi (grande intro du lancement). [surFin] : appelé une fois, à la
 * fin de la vidéo (sans boucle) ou dès [finMs] atteint. [departMs] : la vidéo commence là (plateau qui reprend
 * après un clip du robot, [GelFond]). [repriseMs] : à la fin du fichier, la vidéo repart de là (une arrivée jouée
 * une fois, puis une boucle : écran de fin). [attenteMs] : délai avant de partir, lu quand la vidéo est prête.
 * [departLu] : comme [departMs], mais lu quand la vidéo est prête (vidéo calée sur une musique déjà partie).
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
    private val departLu: (() -> Int)? = null,
    private val repriseMs: Int? = null,
    private val attenteMs: () -> Int = { 0 },
    /** [volume] > 0 : appelé une fois la vidéo prête, vrai si la box a une piste son à lire (grande intro). */
    private val surSon: (Boolean) -> Unit = {},
    /**
     * Décor du plateau : la vidéo reste cachée (sa photo fixe au-dessus) jusqu'à ce nombre d'images vraiment reçues
     * après la première ([fondPret]). Portes qui se rouvrent sur le jeu suivant (cedric, 31/10) : quelques images de
     * « texture métallique à traits », le décodeur de la box qui démarre, passaient avant le décor.
     */
    private val imagesAvantPret: Int = 0,
    /** [departMs] pris sur l'image clé la plus proche : jamais une image décodée sans sa référence (gris à traits). */
    private val departSurImageCle: Boolean = false,
) : TextureView(context), TextureView.SurfaceTextureListener {
    private var lecteur: MediaPlayer? = null
    /** Le nouveau lecteur (point 46) : boucles sans trou. [lecteur] ne sert plus que de secours ([MoteurVideo]). */
    private var exo: VideoExo? = null
    private var surface: Surface? = null
    private var fini = false
    private var finSignalee = false

    /** Une image est à l'écran (avant, une photo du fond serait noire). */
    var affiche = false
        private set

    /** Le lecteur a annoncé sa première image ; [imagesRecues] : images arrivées depuis dans la vue. */
    private var renduCommence = false
    private var imagesRecues = 0
    private val pretQuandMeme = Runnable { declarerPret() }

    private fun declarerPret() {
        if (affiche || fini) return
        removeCallbacks(pretQuandMeme)
        affiche = true
        if (imagesAvantPret > 0) alpha = 1f
        surPret()
    }
    private val guetteur = object : Runnable {
        override fun run() {
            val pos = exo?.position ?: lecteur?.let { l -> runCatching { l.currentPosition }.getOrNull() ?: 0 } ?: return
            if (pos >= finMs) return terminer()
            postDelayed(this, 50)
        }
    }

    init {
        surfaceTextureListener = this
        // Décor : invisible tant que ses images ne sont pas propres (la photo du plateau est dessous et au-dessus).
        if (imagesAvantPret > 0) alpha = 0f
    }

    /**
     * La vue quitte la fenêtre (fin normale de l'intro, « Lancer l'épreuve ») : la surface est détruite, ce n'est pas une
     * vidéo qui lâche. Avant, chaque intro de jeu finie était rapportée « a lâché, essai 1 » (Mi Box, 26/10).
     */
    private var detachee = false

    override fun onAttachedToWindow() {
        detachee = false
        super.onAttachedToWindow()
    }

    override fun onDetachedFromWindow() {
        detachee = true
        super.onDetachedFromWindow()
    }

    override fun onSurfaceTextureAvailable(st: SurfaceTexture, largeur: Int, hauteur: Int) {
        if (fini) return
        arreter()
        try {
            val s = Surface(st).also { surface = it }
            if (!MoteurVideo.ancien) {
                ouvrirExo(s)
                GelFond.fondsOuverts++
                return
            }
            lecteur = MediaPlayer().apply {
                // Vidéo qui a du son : sur la même sortie que les sons du jeu (même volume de la TV).
                if (volume > 0f) setAudioAttributes(
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MOVIE).build(),
                )
                context.resources.openRawResourceFd(resId).use { setDataSource(it.fileDescriptor, it.startOffset, it.length) }
                setSurface(s)
                isLooping = boucle && repriseMs == null
                setVolume(volume, volume)
                setOnInfoListener { _, quoi, _ ->
                    if (quoi == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) {
                        renduCommence = true
                        if (fondPret(renduCommence, imagesRecues, imagesAvantPret)) declarerPret()
                        // Box qui ne signale pas ses images : la vidéo se montre quand même, un peu plus tard.
                        else postDelayed(pretQuandMeme, ATTENTE_IMAGES_MAX_MS)
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
                    if (volume > 0f) surSon(runCatching { mp.trackInfo.any { it.trackType == MediaPlayer.TrackInfo.MEDIA_TRACK_TYPE_AUDIO } }.getOrDefault(true))
                    val depart = departLu?.invoke() ?: departMs
                    val mode = if (departSurImageCle) MediaPlayer.SEEK_CLOSEST_SYNC else MediaPlayer.SEEK_CLOSEST
                    if (depart > 0) runCatching { mp.seekTo(depart.toLong(), mode) }
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

    /** Même déroulé qu'avec l'ancien lecteur, sans trou à chaque tour de boucle. */
    private fun ouvrirExo(s: Surface) {
        val v = VideoExo(context, resId, android.os.Looper.getMainLooper(), boucle = boucle, repriseMs = repriseMs, avecSon = volume > 0f)
        exo = v
        if (volume > 0f) v.volume(volume)
        v.surPremiereImage = {
            renduCommence = true
            if (fondPret(renduCommence, imagesRecues, imagesAvantPret)) declarerPret()
            // Box qui ne signale pas ses images : la vidéo se montre quand même, un peu plus tard.
            else postDelayed(pretQuandMeme, ATTENTE_IMAGES_MAX_MS)
        }
        v.surErreur = { quoi ->
            Log.w("Habillage", "Vidéo ignorée : nouveau lecteur $quoi")
            Sons.incident("Vidéo ${runCatching { resources.getResourceEntryName(resId) }.getOrDefault("$resId")} : nouveau lecteur en échec ($quoi), retour à l'ancien")
            // Les vidéos suivantes reprennent l'ancien lecteur ; celle-ci laisse la place au décor dessiné.
            MoteurVideo.ancien = true
            if (GelFond.clipsOuverts.get() > 0) GelFond.uneSeuleVideo()
            surEchec()
        }
        v.surFin = { if (!boucle) terminer() }
        v.surPrete = prete@{
            if (fini || exo !== v) return@prete
            if (volume > 0f) surSon(v.aDuSon())
            departLu?.invoke()?.let { if (it > 0) v.caler(it, departSurImageCle) }
            val lancer = Runnable {
                if (fini || exo !== v) return@Runnable
                v.demarrer()
                if (finMs < Int.MAX_VALUE) post(guetteur)
            }
            val attente = attenteMs()
            if (attente > 0) postDelayed(lancer, attente.toLong()) else lancer.run()
        }
        v.preparer(s, departMs = if (departLu == null) departMs else 0, surImageCle = departSurImageCle)
    }

    override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, largeur: Int, hauteur: Int) = Unit

    // Surface perdue (veille, autre appli) : la vidéo s'arrête et le décor dessiné revient ; elle repart à la surface
    // suivante tant que la vue n'est pas libérée.
    override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
        arreter()
        if (!fini && !detachee) surEchec()
        return true
    }

    override fun onSurfaceTextureUpdated(st: SurfaceTexture) {
        if (affiche || !renduCommence) return
        imagesRecues++
        if (fondPret(renduCommence, imagesRecues, imagesAvantPret)) declarerPret()
    }

    /** Position de lecture (ms), ou null tant que la vidéo n'est pas prête. */
    fun position(): Int? = exo?.let { v -> if (v.joue) v.position else null }
        ?: lecteur?.let { l -> runCatching { if (l.isPlaying) l.currentPosition else null }.getOrNull() }

    /** Durée de la vidéo (ms), ou null tant qu'elle n'est pas prête. */
    fun duree(): Int? = exo?.duree ?: lecteur?.let { l -> runCatching { l.duration.takeIf { it > 0 } }.getOrNull() }

    /** Vitesse de lecture en cours (1 = normale). */
    var vitesseActuelle = 1f
        private set

    /** Change la vitesse de lecture, sans saut ni image redécodée ; seulement pendant la lecture (sinon elle repartirait). */
    fun vitesse(v: Float) {
        exo?.let { e ->
            if (v == vitesseActuelle || !e.joue) return
            e.vitesse(v)
            vitesseActuelle = v
            return
        }
        val l = lecteur ?: return
        if (v == vitesseActuelle || vitesseRefusee) return
        runCatching {
            if (!l.isPlaying) return
            l.playbackParams = l.playbackParams.setSpeed(v)
            vitesseActuelle = v
        }.onFailure {
            // Box qui refuse : la vidéo tourne à vitesse normale, sans calage fin (jamais de saccade pour autant).
            vitesseRefusee = true
            Log.w("Habillage", "Vitesse de la vidéo refusée : ${it.message}")
        }
    }
    private var vitesseRefusee = false

    /** Saute à [ms] exactement (l'image la plus proche, pas seulement l'image clé). */
    fun caler(ms: Int) {
        exo?.let { return it.caler(ms) }
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
        removeCallbacks(pretQuandMeme)
        renduCommence = false
        imagesRecues = 0
        // Plus de lecteur, plus d'image : au prochain départ (nouvelle surface), le décor attend de nouveau ses images.
        affiche = false
        if (imagesAvantPret > 0) alpha = 0f
        val l = lecteur
        lecteur = null
        val e = exo
        exo = null
        vitesseActuelle = 1f
        val s = surface
        surface = null
        if (e != null) {
            GelFond.fondsOuverts--
            // La surface ne part qu'après le lecteur qui dessine dedans.
            e.liberer { s?.release() }
        } else if (l != null) {
            GelFond.fondsOuverts--
            // La surface ne part qu'après le lecteur qui dessine dedans.
            Liberation.lecteur(l) { s?.release() }
        } else s?.release()
    }
}

/**
 * Rend les lecteurs (vidéos, chansons) hors du fil de l'écran : sur la Mi Box, release() bloque parfois des centaines
 * de millisecondes, et l'image se figeait juste au changement d'écran (gels de 0,3 à 0,8 s, rapports du 26/10). Un seul
 * fil, dans l'ordre : un lecteur est toujours rendu avant le suivant.
 */
internal object Liberation {
    private val fil = java.util.concurrent.Executors.newSingleThreadExecutor { r -> Thread(r, "liberation-lecteurs").apply { isDaemon = true } }

    /** [stop] : arrêté d'abord (chanson en cours). [apres] : ce qui ne peut partir qu'une fois le lecteur rendu. */
    fun lecteur(mp: MediaPlayer, stop: Boolean = false, apres: () -> Unit = {}) = fil.execute {
        if (stop) runCatching { mp.stop() }
        runCatching { mp.release() }
        runCatching(apres)
    }
}

/**
 * Quel lecteur pour les vidéos : le nouveau (sans trou à chaque boucle, point 46) tant qu'il marche ; s'il échoue une
 * fois sur la box, toutes les vidéos suivantes de la soirée reprennent l'ancien lecteur du système.
 */
internal object MoteurVideo {
    @Volatile var ancien = false
}
