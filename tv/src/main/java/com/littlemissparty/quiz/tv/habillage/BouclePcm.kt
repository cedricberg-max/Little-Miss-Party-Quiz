package com.littlemissparty.quiz.tv.habillage

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaPlayer
import android.os.Handler
import android.os.Process
import android.os.SystemClock
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Une boucle de fond musical, telle que [Sons] la pilote : deux lecteurs qui se passent le relais ([Boucle]) ou un
 * flux continu ([BouclePcm]).
 */
internal interface LitSonore {
    val isPlaying: Boolean
    /** Longueur propre de la boucle quand elle n'est pas un fond de 16 s ; null : le tempo commun. */
    val periodeMs: Long?
    fun setVolume(v: Float)
    fun pause()
    /** Joue depuis [ms] dans la boucle. */
    fun demarrer(ms: Int)
    fun possede(mp: MediaPlayer): Boolean
    /** Sortie audio perdue (serveur audio de la box relancé…) : la boucle est à refaire. */
    val enPanne: Boolean get() = false
    /** Se tait tout de suite, rend sa sortie audio [apresMs] plus tard sur [h]. */
    fun liberer(h: Handler, apresMs: Long)
}

/**
 * Boucle sans aucune couture : le fichier WAV est lu en continu dans une seule sortie audio, et la fin du fichier
 * enchaîne sur son début à l'échantillon près, sans relais entre deux lecteurs. Le relais de [Boucle]
 * (setNextMediaPlayer) laissait sur la Mi Box un raccord audible à chaque tour, et parfois plus de musique du tout
 * (cedric, 24 octobre). Rien n'est gardé en mémoire : un petit tampon est relu dans le fichier au fil de la lecture.
 *
 * [surTour] : appelé au début de chaque tour qu'on entend (instant SystemClock.elapsedRealtime), avec 0 à l'arrêt.
 */
internal class BouclePcm private constructor(
    private val flux: FileInputStream,
    private val fermer: () -> Unit,
    private val format: FormatWav,
    override val periodeMs: Long?,
    private val surTour: ((Long) -> Unit)?,
    private val signaler: (String) -> Unit,
) : LitSonore {
    private val verrou = Object()
    /** Sortie audio, ouverte au premier départ : une boucle chargée mais muette n'en occupe aucune. */
    @Volatile private var piste: AudioTrack? = null
    private val tamponImages: Int
    private val tamponOctets: Int
    @Volatile private var joue = false
    @Volatile private var libere = false
    @Volatile private var volume = 0f
    @Volatile override var enPanne = false
        private set
    /** Change à chaque départ, pause ou libération : le bloc que le fil était en train d'écrire est alors périmé. */
    @Volatile private var epoque = 0
    /** Prochaine image du fichier à écrire dans la sortie. */
    private var lecture = 0L
    /** Images écrites dans la sortie depuis le dernier départ, et où chaque tour commence parmi elles. */
    private var ecrites = 0L
    private val debutsDeTour = ArrayDeque<Long>()
    private val fil: Thread

    private val canal = if (format.canaux == 1) AudioFormat.CHANNEL_OUT_MONO else AudioFormat.CHANNEL_OUT_STEREO

    init {
        val mini = AudioTrack.getMinBufferSize(format.frequence, canal, AudioFormat.ENCODING_PCM_16BIT)
        // Assez pour ne jamais manquer (le fil son peut être bousculé un instant), assez court pour qu'un départ
        // calé sur le tempo s'entende à l'heure.
        tamponOctets = maxOf(mini * 2, format.frequence * format.octetsParImage / 5)
        tamponImages = tamponOctets / format.octetsParImage
        fil = Thread({ ecrire() }, "habillage-boucle").apply { isDaemon = true; start() }
    }

    private fun ouvrirPiste(): AudioTrack {
        val t = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build(),
            )
            .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(format.frequence).setChannelMask(canal).build())
            .setBufferSizeInBytes(tamponOctets)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        if (t.state != AudioTrack.STATE_INITIALIZED) {
            t.release()
            throw IllegalStateException("sortie audio refusée")
        }
        return t
    }

    override val isPlaying: Boolean get() = joue && !libere

    override fun setVolume(v: Float) {
        volume = v
        if (!libere) runCatching { piste?.setVolume(v) }
    }

    override fun pause() {
        surTour?.invoke(0L)
        synchronized(verrou) {
            if (!joue || libere) return
            joue = false
            epoque++
            runCatching { piste?.pause() }
        }
    }

    override fun demarrer(ms: Int) {
        synchronized(verrou) {
            if (libere) return
            epoque++
            val p = try {
                piste ?: ouvrirPiste().also { piste = it }
            } catch (e: Exception) {
                enPanne = true
                throw e
            }
            runCatching { p.pause() }
            runCatching { p.flush() }
            lecture = Math.floorMod(ms.toLong() * format.frequence / 1000, format.images)
            ecrites = 0L
            debutsDeTour.clear()
            surTour?.invoke(SystemClock.elapsedRealtime() - ms)
            runCatching { p.setVolume(volume) }
            try {
                p.play()
            } catch (e: IllegalStateException) {
                enPanne = true
                throw e
            }
            joue = true
            verrou.notifyAll()
        }
    }

    override fun possede(mp: MediaPlayer) = false

    override fun liberer(h: Handler, apresMs: Long) {
        synchronized(verrou) {
            if (libere) return
            libere = true
            joue = false
            epoque++
            verrou.notifyAll()
        }
        surTour?.invoke(0L)
        val p = piste
        runCatching { p?.setVolume(0f) }
        runCatching { p?.pause() }
        h.postDelayed({
            runCatching { fil.join(500) }
            runCatching { p?.release() }
            runCatching { fermer() }
        }, apresMs)
    }

    /**
     * Fil d'écriture : remplit la sortie au fil de la lecture, en enchaînant la fin du fichier sur son début. Écriture
     * non bloquante : une pause, un nouveau départ ou la libération ne restent jamais coincés derrière elle.
     */
    private fun ecrire() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        val bloc = maxOf(1024, tamponImages / 4)
        val octets = ByteArray(bloc * format.octetsParImage)
        val canal = flux.channel
        try {
            while (true) {
                val depuis: Long
                val ep: Int
                val base: Long
                val ouverte: AudioTrack?
                synchronized(verrou) {
                    while (!joue && !libere) verrou.wait()
                    if (libere) return
                    ouverte = piste
                    depuis = lecture
                    ep = epoque
                    base = ecrites
                }
                // Toujours ouverte quand la boucle joue (demarrer l'ouvre avant de lancer la lecture).
                val piste = ouverte ?: return
                // Tours qui commencent dans ce bloc (sauf le tout premier départ, déjà annoncé par demarrer).
                val tours = mutableListOf<Long>()
                var rempli = 0
                for ((debut, n) in morceauxBoucle(depuis, bloc.toLong(), format.images)) {
                    val ici = base + rempli / format.octetsParImage
                    if (debut == 0L && ici > 0) tours += ici
                    val bb = ByteBuffer.wrap(octets, rempli, (n * format.octetsParImage).toInt())
                    var pos = format.debutDonnees + debut * format.octetsParImage
                    while (bb.hasRemaining()) {
                        val lu = canal.read(bb, pos)
                        if (lu <= 0) throw IllegalStateException("fichier tronqué")
                        pos += lu
                    }
                    rempli += (n * format.octetsParImage).toInt()
                }
                var ecrit = 0
                while (ecrit < rempli && epoque == ep) {
                    val r = piste.write(octets, ecrit, rempli - ecrit, AudioTrack.WRITE_NON_BLOCKING)
                    if (r < 0) {
                        signaler("sortie audio en erreur ($r)")
                        enPanne = true
                        synchronized(verrou) { if (epoque == ep) joue = false }
                        break
                    }
                    if (r == 0) Thread.sleep(PAUSE_ECRITURE_MS) else ecrit += r
                    annoncerTours(piste)
                }
                synchronized(verrou) {
                    if (epoque != ep || ecrit < rempli) return@synchronized
                    lecture = (depuis + bloc) % format.images
                    ecrites = base + bloc
                    debutsDeTour.addAll(tours)
                }
                annoncerTours(piste)
            }
        } catch (_: InterruptedException) {
        } catch (e: Exception) {
            if (!libere) signaler("lecture interrompue (${e.message})")
            enPanne = true
            synchronized(verrou) { joue = false }
        }
    }

    /** Le début d'un tour vient de s'entendre (la tête de lecture de la sortie l'a passé) : la vidéo s'y recale. */
    private fun annoncerTours(piste: AudioTrack) {
        val cb = surTour ?: return
        val tete = runCatching { piste.playbackHeadPosition.toLong() and 0xffffffffL }.getOrNull() ?: return
        while (true) {
            val prochain = synchronized(verrou) {
                debutsDeTour.firstOrNull()?.takeIf { it <= tete }?.also { debutsDeTour.removeFirst() }
            } ?: return
            cb(SystemClock.elapsedRealtime() - (tete - prochain) * 1000 / format.frequence)
        }
    }

    companion object {
        private const val PAUSE_ECRITURE_MS = 8L

        /**
         * La boucle du fichier [res] s'il est en WAV PCM 16 bits ; null sinon (le fichier est alors lu par deux
         * lecteurs, comme avant).
         */
        fun ouvrir(
            context: Context, res: Int, surTour: ((Long) -> Unit)?, tempoMs: Long, signaler: (String) -> Unit,
        ): BouclePcm? {
            val afd = context.resources.openRawResourceFd(res) ?: return null
            val flux = try { afd.createInputStream() } catch (e: Exception) { afd.close(); return null }
            try {
                val tete = ByteArray(512)
                val lu = flux.channel.read(ByteBuffer.wrap(tete), afd.startOffset)
                val f = lireEnteteWav(tete.copyOf(maxOf(lu, 0)), afd.length) ?: run { flux.close(); afd.close(); return null }
                val decale = f.copy(debutDonnees = afd.startOffset + f.debutDonnees)
                val periode = f.dureeMs.takeIf { kotlin.math.abs(it - tempoMs) > 250 }
                return BouclePcm(flux, { flux.close(); afd.close() }, decale, periode, surTour, signaler)
            } catch (e: Exception) {
                runCatching { flux.close() }
                runCatching { afd.close() }
                throw e
            }
        }
    }
}
