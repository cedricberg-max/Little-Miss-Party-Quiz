package com.littlemissparty.quiz.tv.habillage

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.SoundPool
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log

/**
 * Moteur sonore de l'habillage : exécute les [Ordre] du [DirecteurSonore].
 * Sons courts dans un SoundPool (prêts en mémoire, sans latence) ; sons longs et musiques dans des
 * lecteurs préparés à l'avance. Tout se passe sur un fil dédié, et chaque appel est protégé :
 * un son qui ne se charge pas (box sans sortie audio, émulateur muet) ne gêne jamais la partie.
 */
object Sons {
    private const val TAG = "Habillage"
    private const val FONDU_MS = 700L
    private const val COUPE_MS = 300L
    private const val PAS_MS = 40L
    /** Durée exacte des deux boucles musicales (8 mesures à 120 BPM). */
    private const val BOUCLE_MS = 16_000L

    private val fil = HandlerThread("habillage-son").apply { start() }
    private val h = Handler(fil.looper)
    /** Jeton des sons programmés : [Ordre.Couper] les annule tous d'un coup. */
    private val prevus = Any()
    private val fondus = Any()

    private var pool: SoundPool? = null
    private val courts = mutableMapOf<Son, Int>()
    private val longs = mutableMapOf<Son, MediaPlayer>()
    /** Numéro du dernier lancement de chaque son long : un fondu de sortie ne coupe jamais un son relancé entre-temps. */
    private val lancements = mutableMapOf<Son, Int>()
    private var litComplet: MediaPlayer? = null
    private var litLeger: MediaPlayer? = null
    private var volComplet = 0f
    private var volLeger = 0f
    private var ambiance = Ambiance.SILENCE
    private var pret = false
    private var enArriere = false

    /**
     * Origine du tempo (horloge de la box) : les boucles repartent toujours calées dessus, et les décors
     * battent au même tempo. Une boucle muette est mise en pause, pour ne pas décoder du son pour rien.
     */
    @Volatile var departDesLits: Long = SystemClock.elapsedRealtime()
        private set

    private val attributs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_GAME)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
        .build()

    fun preparer(context: Context) {
        val app = context.applicationContext
        h.post {
            if (pret) return@post
            pret = true
            essayer("pool") {
                val p = SoundPool.Builder().setMaxStreams(8).setAudioAttributes(attributs).build()
                Son.entries.filter { !it.long }.forEach { s -> id(app, s.fichier)?.let { courts[s] = p.load(app, it, 1) } }
                pool = p
            }
            Son.entries.filter { it.long }.forEach { s -> essayer(s.name) { lecteur(app, s.fichier, boucle = false)?.let { longs[s] = it } } }
            essayer("lits") {
                litComplet = lecteur(app, Ambiance.LIT_COMPLET, boucle = true)
                litLeger = lecteur(app, Ambiance.LIT_LEGER, boucle = true)
                departDesLits = SystemClock.elapsedRealtime()
                demarrerLits()
            }
        }
    }

    fun executer(ordres: List<Ordre>) {
        if (ordres.isEmpty()) return
        h.post {
            ordres.forEach { o ->
                when (o) {
                    Ordre.Couper -> couper()
                    is Ordre.Arreter -> essayer("arreter") { eteindre(o.son) }
                    is Ordre.Jouer -> plus(o.dansMs) { jouer(o.son) }
                    is Ordre.Musique -> plus(o.dansMs) { versAmbiance(o.ambiance) }
                }
            }
        }
    }

    /** L'appli passe en arrière-plan (bouton Accueil, mise en veille) : silence total. */
    fun suspendre() {
        h.post {
            enArriere = true
            couper()
            essayer("suspendre") { litComplet?.pause(); litLeger?.pause(); pool?.autoPause() }
        }
    }

    fun reprendre() {
        h.post {
            if (!enArriere) return@post
            enArriere = false
            essayer("reprendre") {
                pool?.autoResume()
                demarrerLits()
            }
        }
    }

    private fun plus(dansMs: Long, action: () -> Unit) {
        val r = Runnable { if (!enArriere) essayer("son") { action() } }
        if (dansMs <= 0) r.run() else h.postAtTime(r, prevus, SystemClock.uptimeMillis() + dansMs)
    }

    private fun jouer(s: Son) {
        if (s.long) {
            val mp = longs[s] ?: return
            lancements[s] = (lancements[s] ?: 0) + 1
            if (mp.isPlaying) mp.pause()
            mp.setVolume(1f, 1f)
            mp.seekTo(0)
            mp.start()
        } else {
            val id = courts[s] ?: return
            pool?.play(id, 1f, 1f, 1, 0, 1f)
        }
    }

    /** Annule ce qui était prévu et éteint en douceur les sons longs encore en cours. La musique, elle, continue. */
    private fun couper() {
        h.removeCallbacksAndMessages(prevus)
        longs.keys.forEach { essayer("couper") { eteindre(it) } }
    }

    private fun eteindre(s: Son) {
        val mp = longs[s] ?: return
        if (!mp.isPlaying) return
        val lancement = lancements[s]
        val etapes = (COUPE_MS / PAS_MS).toInt()
        for (k in 1..etapes) {
            h.postAtTime({
                essayer("eteindre") {
                    if (!mp.isPlaying || lancements[s] != lancement) return@essayer
                    val v = 1f - k.toFloat() / etapes
                    mp.setVolume(v, v)
                    if (k == etapes) mp.pause()
                }
            }, fondus, SystemClock.uptimeMillis() + k * PAS_MS)
        }
    }

    /** Fondu enchaîné entre la boucle complète et la boucle légère, qui tournent toujours ensemble. */
    private fun versAmbiance(a: Ambiance) {
        ambiance = a
        if (a.complete > 0f) reveiller(litComplet)
        if (a.legere > 0f) reveiller(litLeger)
        val deC = volComplet
        val deL = volLeger
        val etapes = (FONDU_MS / PAS_MS).toInt()
        for (k in 1..etapes) {
            h.postAtTime({
                if (ambiance != a) return@postAtTime
                val t = k.toFloat() / etapes
                volComplet = deC + (a.complete - deC) * t
                volLeger = deL + (a.legere - deL) * t
                essayer("fondu") {
                    litComplet?.setVolume(volComplet, volComplet)
                    litLeger?.setVolume(volLeger, volLeger)
                    if (k == etapes) {
                        if (a.complete == 0f) litComplet?.let { if (it.isPlaying) it.pause() }
                        if (a.legere == 0f) litLeger?.let { if (it.isPlaying) it.pause() }
                    }
                }
            }, fondus, SystemClock.uptimeMillis() + k * PAS_MS)
        }
    }

    /** Relance les boucles qui doivent s'entendre (retour au premier plan). */
    private fun demarrerLits() {
        litComplet?.setVolume(volComplet, volComplet)
        litLeger?.setVolume(volLeger, volLeger)
        if (volComplet > 0f) reveiller(litComplet)
        if (volLeger > 0f) reveiller(litLeger)
    }

    /** Remet une boucle en route, calée sur le tempo commun. */
    private fun reveiller(mp: MediaPlayer?) {
        if (mp == null || mp.isPlaying) return
        mp.seekTo(Math.floorMod(SystemClock.elapsedRealtime() - departDesLits, BOUCLE_MS).toInt())
        mp.start()
    }

    private fun lecteur(context: Context, nom: String, boucle: Boolean): MediaPlayer? {
        val res = id(context, nom) ?: return null
        val afd = context.resources.openRawResourceFd(res) ?: return null
        return MediaPlayer().apply {
            setAudioAttributes(attributs)
            afd.use { setDataSource(it.fileDescriptor, it.startOffset, it.length) }
            isLooping = boucle
            setVolume(0f, 0f)
            prepare()
        }
    }

    private fun id(context: Context, nom: String): Int? =
        context.resources.getIdentifier(nom, "raw", context.packageName).takeIf { it != 0 }

    private inline fun essayer(quoi: String, bloc: () -> Unit) {
        try {
            bloc()
        } catch (e: Exception) {
            Log.w(TAG, "Son « $quoi » ignoré : ${e.message}")
        }
    }
}
