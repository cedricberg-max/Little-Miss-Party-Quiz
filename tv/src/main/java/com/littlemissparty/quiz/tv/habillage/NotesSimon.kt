package com.littlemissparty.quiz.tv.habillage

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.min
import kotlin.math.sin

/**
 * 🔴 Le Simon de Buzzy : la note de chaque boule (et de chaque chiffre) quand le robot l'allume au tableau. Mêmes notes
 * que sur les tablettes (gamme de do, puis plus aigu pour les chiffres). Sons provisoires, fabriqués par l'appli : la
 * musique du jeu sera choisie avec cedric (28/10).
 */
object NotesSimon {
    private const val TAG = "NotesSimon"
    private const val FREQUENCE = 22_050
    internal const val DUREE_MS = 450
    /** Les suites les plus rapides (une boule toutes les 400 ms) : 300 ms de note. */
    internal const val DUREE_MIN_MS = 250
    /** Presque à fond (la note culmine à 1,0 × [VOLUME]) : elles passaient sous la musique (cedric, 28/10 au soir). */
    internal const val VOLUME = 0.95f

    /** Hertz de chaque élément (codes du moteur). */
    private val NOTES = mapOf(
        "rouge" to 262.0, "orange" to 294.0, "jaune" to 330.0, "vert" to 349.0, "bleu" to 392.0, "violet" to 440.0, "rose" to 494.0, "blanc" to 523.0,
        "1" to 587.0, "2" to 659.0, "3" to 698.0, "4" to 784.0, "5" to 880.0, "6" to 988.0, "7" to 1047.0, "8" to 1175.0, "9" to 1319.0, "0" to 1397.0,
    )

    private val fil = HandlerThread("simon-notes").apply { start() }
    private val h = Handler(fil.looper)
    private val sons = HashMap<String, ShortArray>()

    /** Joue la note de [item], au plus [dureeMs] (sans attendre ; rien si la sortie son refuse). */
    fun jouer(item: String, dureeMs: Int = DUREE_MS) {
        val f = NOTES[item] ?: return
        val duree = dureeMs.coerceIn(DUREE_MIN_MS, DUREE_MS)
        h.post {
            runCatching {
                val pcm = sons.getOrPut("$item/$duree") { note(f, duree) }
                val piste = AudioTrack.Builder()
                    .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                    .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(FREQUENCE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                    .setBufferSizeInBytes(pcm.size * 2)
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .build()
                if (piste.state == AudioTrack.STATE_UNINITIALIZED) { piste.release(); return@runCatching }
                piste.write(pcm, 0, pcm.size)
                piste.play()
                h.postDelayed({ runCatching { piste.stop() }; piste.release() }, duree + 200L)
            }.onFailure { Log.w(TAG, "Note du Simon : ${it.message}") }
        }
    }

    /** Une note douce de clochette : la fondamentale et son octave, attaque courte, extinction progressive. */
    internal fun note(f: Double, dureeMs: Int = DUREE_MS, frequence: Int = FREQUENCE): ShortArray {
        val n = frequence * dureeMs / 1000
        val attaque = frequence / 200
        return ShortArray(n) { i ->
            val t = i.toDouble() / frequence
            val enveloppe = min(1.0, i.toDouble() / attaque) * exp(-4.0 * t * 1000 / dureeMs)
            val s = 0.8 * sin(2 * PI * f * t) + 0.2 * sin(4 * PI * f * t)
            (s * enveloppe * VOLUME * Short.MAX_VALUE).toInt().toShort()
        }
    }
}
