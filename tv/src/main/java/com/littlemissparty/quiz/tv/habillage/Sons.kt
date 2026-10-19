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
    /** Durée exacte des boucles musicales (8 mesures à 120 BPM). */
    private const val BOUCLE_MS = 16_000L
    /** Crayon du Pictionary : léger, sous la musique ; il part vite et s'éteint un peu plus doucement. */
    private const val CRAYON_VOLUME = 0.7f
    private const val CRAYON_ENTREE_MS = 80L
    private const val CRAYON_SORTIE_MS = 200L

    private val fil = HandlerThread("habillage-son").apply { start() }
    private val h = Handler(fil.looper)
    /** Jeton des sons programmés : [Ordre.Couper] les annule tous d'un coup. */
    private val prevus = Any()
    private val fondus = Any()
    private val fonduCrayon = Any()

    private var pool: SoundPool? = null
    private val courts = mutableMapOf<Son, Int>()
    private val longs = mutableMapOf<Son, MediaPlayer>()
    /** Numéro du dernier lancement de chaque son long : un fondu de sortie ne coupe jamais un son relancé entre-temps. */
    private val lancements = mutableMapOf<Son, Int>()
    private val lits = mutableMapOf<Lit, MediaPlayer>()
    private val volumes = Lit.entries.associateWith { 0f }.toMutableMap()
    private var ambiance = Ambiance.SILENCE
    /** Dernière ambiance demandée, même encore programmée : c'est elle qu'on remet au retour au premier plan. */
    private var ambianceVoulue = Ambiance.SILENCE
    private var crayon: MediaPlayer? = null
    private var crayonActif = false
    private var volumeCrayon = 0f
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
            essayer("crayon") { crayon = lecteur(app, FICHIER_CRAYON, boucle = true) }
            essayer("lits") {
                Lit.entries.forEach { l -> essayer(l.name) { lecteur(app, l.fichier, boucle = true)?.let { lits[l] = it } } }
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
                    is Ordre.Musique -> {
                        ambianceVoulue = o.ambiance
                        plus(o.dansMs) { versAmbiance(o.ambiance) }
                    }
                }
            }
        }
    }

    /**
     * Grattement du crayon pendant le Pictionary : on l'entend tant que le trait avance sur la TV, il s'éteint
     * quand le dessinateur lève le doigt. Rappeler avec la même valeur ne fait rien.
     */
    fun crayon(actif: Boolean) {
        h.post {
            if (actif == crayonActif || (actif && enArriere)) return@post
            crayonActif = actif
            essayer("crayon") { fondreCrayon(actif) }
        }
    }

    /** L'appli passe en arrière-plan (bouton Accueil, mise en veille) : silence total. */
    fun suspendre() {
        h.post {
            enArriere = true
            couper()
            essayer("suspendre") { lits.values.forEach { if (it.isPlaying) it.pause() }; pool?.autoPause() }
            essayer("suspendre") {
                h.removeCallbacksAndMessages(fonduCrayon)
                crayon?.let { if (it.isPlaying) it.pause() }
                volumeCrayon = 0f
            }
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
            // Une musique encore programmée (fin du générique, entrée en pause…) a été annulée en arrière-plan :
            // on la remet, sinon l'écran resterait muet jusqu'au suivant.
            if (ambiance != ambianceVoulue) essayer("reprendre") { versAmbiance(ambianceVoulue) }
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
        // Le crayon se tait aussi ; le prochain point reçu le relance.
        if (crayonActif) {
            crayonActif = false
            essayer("couper") { fondreCrayon(false) }
        }
    }

    private fun fondreCrayon(actif: Boolean) {
        val mp = crayon ?: return
        h.removeCallbacksAndMessages(fonduCrayon)
        val de = volumeCrayon
        val vers = if (actif) CRAYON_VOLUME else 0f
        if (actif && !mp.isPlaying) {
            mp.setVolume(de, de)
            mp.start()
        }
        val etapes = ((if (actif) CRAYON_ENTREE_MS else CRAYON_SORTIE_MS) / PAS_MS).toInt().coerceAtLeast(1)
        for (k in 1..etapes) {
            h.postAtTime({
                essayer("crayon") {
                    val v = de + (vers - de) * k / etapes
                    volumeCrayon = v
                    mp.setVolume(v, v)
                    if (k == etapes && vers == 0f && mp.isPlaying) mp.pause()
                }
            }, fonduCrayon, SystemClock.uptimeMillis() + k * PAS_MS)
        }
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

    /** Fondu enchaîné d'une ambiance à l'autre : chaque boucle glisse vers son volume, celles qui se taisent s'arrêtent. */
    private fun versAmbiance(a: Ambiance) {
        ambiance = a
        Lit.entries.forEach { if (a.volume(it) > 0f) reveiller(lits[it]) }
        val depart = volumes.toMap()
        val etapes = (FONDU_MS / PAS_MS).toInt()
        for (k in 1..etapes) {
            h.postAtTime({
                if (ambiance != a) return@postAtTime
                val t = k.toFloat() / etapes
                Lit.entries.forEach { l ->
                    val de = depart.getValue(l)
                    val v = de + (a.volume(l) - de) * t
                    volumes[l] = v
                    essayer("fondu") {
                        val mp = lits[l] ?: return@essayer
                        if (de == 0f && v == 0f) return@essayer
                        mp.setVolume(v, v)
                        if (k == etapes && v == 0f && mp.isPlaying) mp.pause()
                    }
                }
            }, fondus, SystemClock.uptimeMillis() + k * PAS_MS)
        }
    }

    /** Relance les boucles qui doivent s'entendre (retour au premier plan). */
    private fun demarrerLits() {
        lits.forEach { (l, mp) ->
            val v = volumes.getValue(l)
            essayer("lit") {
                mp.setVolume(v, v)
                if (v > 0f) reveiller(mp)
            }
        }
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
            // Un lecteur en erreur (serveur audio de la box relancé…) resterait muet toute la partie : on le refait.
            setOnErrorListener { mp, quoi, extra ->
                Log.w(TAG, "Lecteur « $nom » en erreur ($quoi, $extra), reconstruit")
                h.post { reconstruire(context, nom, boucle, mp) }
                true
            }
        }
    }

    private fun reconstruire(context: Context, nom: String, boucle: Boolean, ancien: MediaPlayer) {
        essayer("reconstruire") { ancien.release() }
        val neuf = try { lecteur(context, nom, boucle) } catch (e: Exception) { null } ?: return
        Son.entries.find { it.fichier == nom && longs[it] === ancien }?.let { longs[it] = neuf }
        if (crayon === ancien) {
            crayon = neuf
            volumeCrayon = 0f
            crayonActif = false
        }
        Lit.entries.find { it.fichier == nom && lits[it] === ancien }?.let { l ->
            lits[l] = neuf
            val v = volumes.getValue(l)
            essayer("lit") {
                neuf.setVolume(v, v)
                if (v > 0f && !enArriere) reveiller(neuf)
            }
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
