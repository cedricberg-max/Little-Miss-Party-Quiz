package com.littlemissparty.quiz.tv.habillage

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.SoundPool
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import kotlin.math.abs

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
    private const val REPRISE_FONDU_MS = 600L
    private const val REPRISE_MIN_RESTE_MS = 500
    /** Durée exacte des boucles musicales (8 mesures à 120 BPM). */
    private const val BOUCLE_MS = 16_000L
    /** Crayon du Pictionary : léger, sous la musique ; il part vite et s'éteint un peu plus doucement. */
    private const val CRAYON_VOLUME = 0.7f
    private const val CRAYON_ENTREE_MS = 80L
    private const val CRAYON_SORTIE_MS = 200L
    /** Versions d'un même son long au plus (gs_tension_2 … gs_tension_5). */
    private const val MAX_VARIANTES = 5
    /** Musique calée sur la partie : écart toléré avant de la recaler, et temps laissé au lecteur pour finir un recalage. */
    private const val CALAGE_ECART_MS = 150
    private const val CALAGE_ATTENTE_MS = 400L

    private val fil = HandlerThread("habillage-son").apply { start() }
    private val h = Handler(fil.looper)
    /** Jeton des sons programmés : [Ordre.Couper] les annule tous d'un coup. */
    private val prevus = Any()
    private val fondus = Any()
    private val fonduCrayon = Any()

    private var pool: SoundPool? = null
    private val courts = mutableMapOf<Son, Int>()
    private val longs = mutableMapOf<Son, MediaPlayer>()
    /**
     * Game Show : toutes les versions d'un son long qui en a plusieurs (gs_tension, gs_tension_2, gs_tension_3…).
     * Chaque lancement en tire une au hasard, jamais la même deux fois de suite ; [longs] pointe sur celle en cours.
     */
    private val variantes = mutableMapOf<Son, List<MediaPlayer>>()
    private val derniereVariante = mutableMapOf<Son, Int>()
    /** Dernier recalage de chaque musique calée ([calerSur]) : le lecteur met un instant à rendre sa nouvelle position. */
    private val recalages = mutableMapOf<Son, Long>()
    /** Numéro du dernier lancement de chaque son long : un fondu de sortie ne coupe jamais un son relancé entre-temps. */
    private val lancements = mutableMapOf<Son, Int>()
    private val lits = mutableMapOf<Lit, Boucle>()
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

    /**
     * Instant (SystemClock.uptimeMillis) où le générique a vraiment démarré : l'animation du logo s'y cale, même si
     * la box finissait encore de charger ses sons au démarrage.
     */
    @Volatile var departGenerique: Long = Long.MIN_VALUE / 2
        private set

    private val attributs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_GAME)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
        .build()

    /**
     * Charge les sons un par un, chacun dans son propre message du fil : un ordre reçu pendant le chargement (le
     * générique au lancement) passe entre deux, sans attendre la fin. Le générique et la musique du salon d'abord.
     */
    fun preparer(context: Context) {
        val app = context.applicationContext
        h.post {
            if (pret) return@post
            pret = true
            val etapes = ArrayDeque<() -> Unit>()
            val longsDabord = listOf(Son.GENERIQUE) + Son.entries.filter { it.long && it != Son.GENERIQUE }
            val litsDabord = listOf(Lit.COMPLET) + Lit.entries.filter { it != Lit.COMPLET }
            etapes += { chargerLong(app, Son.GENERIQUE) }
            etapes += { chargerLit(app, Lit.COMPLET) }
            etapes += {
                essayer("pool") {
                    val p = SoundPool.Builder().setMaxStreams(8).setAudioAttributes(attributs).build()
                    Son.entries.filter { !it.long }.forEach { s -> idSon(app, s)?.let { courts[s] = p.load(app, it, 1) } }
                    pool = p
                }
            }
            longsDabord.drop(1).forEach { s -> etapes += { chargerLong(app, s) } }
            etapes += { essayer("crayon") { crayon = lecteur(app, FICHIER_CRAYON, boucle = true) } }
            litsDabord.drop(1).forEach { l -> etapes += { chargerLit(app, l) } }
            enchainer(etapes)
        }
    }

    private fun enchainer(etapes: ArrayDeque<() -> Unit>) {
        val etape = etapes.removeFirstOrNull() ?: return
        etape()
        h.post { enchainer(etapes) }
    }

    private fun chargerLong(app: Context, s: Son) = essayer(s.name) {
        // Sons propres au Game Show (le podium) : rien à charger en Classique.
        if (!Look.gs && s.fichier.startsWith("gs_")) return@essayer
        val principal = lecteur(app, s.fichier, boucle = false) ?: return@essayer
        longs[s] = principal
        if (!Look.gs) return@essayer
        val gs = s.fichier.replaceFirst("lmp_", "gs_")
        val autres = (2..MAX_VARIANTES).mapNotNull { k -> brut(app, "${gs}_$k")?.let { lecteur(app, "${gs}_$k", boucle = false) } }
        if (autres.isNotEmpty()) variantes[s] = listOf(principal) + autres
    }

    /** Une boucle chargée après un ordre de musique prend tout de suite le volume de l'ambiance en cours. */
    private fun chargerLit(app: Context, l: Lit) = essayer(l.name) {
        val nom = l.fichierPour(Look.gs) ?: return@essayer
        val b = boucle(app, nom) ?: return@essayer
        lits[l] = b
        val v = volumes.getValue(l)
        b.setVolume(v)
        if (v > 0f && !enArriere) reveiller(b)
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
                        plus(o.dansMs) { versAmbiance(o.ambiance, o.fonduMs) }
                    }
                    is Ordre.Caler -> plus(o.dansMs) { caler() }
                    is Ordre.Reprendre -> plus(o.dansMs) { reprendreLong(o.son) }
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

    /**
     * Musique calée sur une horloge de la partie (la mèche de « Ça va exploser ! ») : elle doit être à [positionMs]
     * maintenant. Elle ne se recale que si elle s'en écarte de plus de [CALAGE_ECART_MS], pour ne pas hoqueter.
     * [joue] faux (pause de la partie, bombe qui explose, entre deux bombes) la fige là où elle est. À rappeler souvent :
     * un changement d'écran qui coupe les sons longs ne la fait taire qu'un instant.
     */
    fun calerSur(s: Son, positionMs: Long, joue: Boolean) {
        h.post {
            essayer("caler ${s.name}") {
                val mp = longs[s] ?: return@essayer
                if (!joue || enArriere || positionMs < 0 || positionMs >= mp.duration) {
                    if (mp.isPlaying) mp.pause()
                    return@essayer
                }
                // Annule un fondu de sortie en cours (changement d'écran) : c'est la mèche qui décide, pas l'écran.
                lancements[s] = (lancements[s] ?: 0) + 1
                mp.setVolume(1f, 1f)
                val maintenant = SystemClock.uptimeMillis()
                val enRecalage = maintenant - (recalages[s] ?: Long.MIN_VALUE / 2) < CALAGE_ATTENTE_MS
                if (!enRecalage && abs(mp.currentPosition - positionMs) > CALAGE_ECART_MS) {
                    mp.seekTo(positionMs, MediaPlayer.SEEK_CLOSEST)
                    recalages[s] = maintenant
                }
                if (!mp.isPlaying) mp.start()
            }
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
            variantes[s]?.let { v ->
                longs[s]?.takeIf { it.isPlaying }?.pause()
                val i = (v.indices - (derniereVariante[s] ?: -1)).random()
                derniereVariante[s] = i
                longs[s] = v[i]
            }
            val mp = longs[s] ?: return
            lancements[s] = (lancements[s] ?: 0) + 1
            if (mp.isPlaying) mp.pause()
            mp.setVolume(1f, 1f)
            mp.seekTo(0)
            mp.start()
            if (s == Son.GENERIQUE) departGenerique = SystemClock.uptimeMillis()
        } else {
            val id = courts[s] ?: return
            pool?.play(id, 1f, 1f, 1, 0, 1f)
        }
    }

    /** Relance en fondu un son long mis en pause en cours de route, à l'endroit où il s'était arrêté (rien s'il était fini). */
    private fun reprendreLong(s: Son) {
        val mp = longs[s] ?: return
        if (mp.isPlaying || mp.currentPosition <= 0 || mp.currentPosition >= mp.duration - REPRISE_MIN_RESTE_MS) return
        val lancement = (lancements[s] ?: 0) + 1
        lancements[s] = lancement
        mp.setVolume(0f, 0f)
        mp.start()
        val etapes = (REPRISE_FONDU_MS / PAS_MS).toInt()
        for (k in 1..etapes) {
            h.postAtTime({
                essayer("reprendre") {
                    if (lancements[s] != lancement) return@essayer
                    val v = k.toFloat() / etapes
                    mp.setVolume(v, v)
                }
            }, prevus, SystemClock.uptimeMillis() + k * PAS_MS)
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

    /** Les boucles repartent du début de leur première mesure à cet instant (relais du générique). */
    private fun caler() {
        departDesLits = SystemClock.elapsedRealtime()
        lits.values.forEach { if (it.isPlaying) essayer("caler") { it.demarrer(0) } }
    }

    /** Fondu enchaîné d'une ambiance à l'autre : chaque boucle glisse vers son volume, celles qui se taisent s'arrêtent. */
    private fun versAmbiance(a: Ambiance, fonduMs: Long = FONDU_MS) {
        ambiance = a
        Lit.entries.forEach { if (a.volume(it, Look.gs) > 0f) reveiller(lits[it]) }
        val depart = volumes.toMap()
        val etapes = (fonduMs / PAS_MS).toInt().coerceAtLeast(1)
        for (k in 1..etapes) {
            h.postAtTime({
                if (ambiance != a) return@postAtTime
                val t = k.toFloat() / etapes
                Lit.entries.forEach { l ->
                    val de = depart.getValue(l)
                    val v = de + (a.volume(l, Look.gs) - de) * t
                    volumes[l] = v
                    essayer("fondu") {
                        val b = lits[l] ?: return@essayer
                        if (de == 0f && v == 0f) return@essayer
                        b.setVolume(v)
                        if (k == etapes && v == 0f) b.pause()
                    }
                }
            }, fondus, SystemClock.uptimeMillis() + k * PAS_MS)
        }
    }

    /** Relance les boucles qui doivent s'entendre (retour au premier plan). */
    private fun demarrerLits() {
        lits.forEach { (l, b) ->
            val v = volumes.getValue(l)
            essayer("lit") {
                b.setVolume(v)
                if (v > 0f) reveiller(b)
            }
        }
    }

    /** Remet une boucle en route, calée sur le tempo commun. */
    private fun reveiller(b: Boucle?) {
        if (b == null || b.isPlaying) return
        b.demarrer(Math.floorMod(SystemClock.elapsedRealtime() - departDesLits, BOUCLE_MS).toInt())
    }

    private fun boucle(context: Context, nom: String): Boucle? {
        val a = lecteur(context, nom, boucle = false) ?: return null
        val b = try { lecteur(context, nom, boucle = false) } catch (e: Exception) { null }
        return Boucle(a, b)
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
        Son.entries.find { longs[it] === ancien }?.let { longs[it] = neuf }
        for (s in variantes.keys.toList()) variantes[s] = variantes.getValue(s).map { if (it === ancien) neuf else it }
        if (crayon === ancien) {
            crayon = neuf
            volumeCrayon = 0f
            crayonActif = false
        }
        Lit.entries.find { it.fichierPour(Look.gs) == nom && lits[it]?.possede(ancien) == true }?.let { l ->
            // Une boucle, c'est deux lecteurs : on refait les deux.
            essayer("reconstruire") { lits[l]?.liberer() }
            essayer("reconstruire") { neuf.release() }
            lits.remove(l)
            chargerLit(context, l)
        }
    }

    /**
     * Fichier d'un son : en design « The Game Show », sa version sci-fi (res/raw/gs_…) quand elle existe, sinon le son
     * classique. Les noms restent ceux du classique partout ailleurs : seul le fichier lu change.
     */
    private fun id(context: Context, nom: String): Int? {
        if (Look.gs) brut(context, nom.replaceFirst("lmp_", "gs_"))?.let { return it }
        return brut(context, nom)
    }

    /** Son court : son fichier propre au Game Show s'il en a un ([Son.gs]), sinon la règle habituelle. */
    private fun idSon(context: Context, s: Son): Int? {
        if (Look.gs) s.gs?.let { g -> brut(context, g)?.let { return it } }
        return id(context, s.fichier)
    }

    private fun brut(context: Context, nom: String): Int? =
        context.resources.getIdentifier(nom, "raw", context.packageName).takeIf { it != 0 }

    /**
     * Changement de design : on lâche tous les sons chargés et on recharge ceux du nouveau design, dans le même ordre
     * qu'au démarrage. L'ambiance demandée reprend dès que sa boucle est prête.
     */
    fun recharger(context: Context) {
        val app = context.applicationContext
        h.post {
            h.removeCallbacksAndMessages(prevus)
            h.removeCallbacksAndMessages(fondus)
            h.removeCallbacksAndMessages(fonduCrayon)
            (longs.values + variantes.values.flatten()).toSet().forEach { essayer("recharger") { it.release() } }
            longs.clear()
            variantes.clear()
            derniereVariante.clear()
            lits.values.forEach { essayer("recharger") { it.liberer() } }
            lits.clear()
            essayer("recharger") { crayon?.release() }
            crayon = null
            crayonActif = false
            volumeCrayon = 0f
            essayer("recharger") { pool?.release() }
            pool = null
            courts.clear()
            pret = false
            preparer(app)
        }
    }

    private inline fun essayer(quoi: String, bloc: () -> Unit) {
        try {
            bloc()
        } catch (e: Exception) {
            Log.w(TAG, "Son « $quoi » ignoré : ${e.message}")
        }
    }
}

/**
 * Boucle musicale sans blanc : deux lecteurs du même fichier se passent le relais (setNextMediaPlayer), le second
 * part à l'échantillon près quand le premier finit. Un lecteur seul en isLooping revient au début du fichier avec un
 * trou audible sur certaines TV. Sans second lecteur (mémoire), on retombe sur isLooping.
 */
private class Boucle(private val a: MediaPlayer, private val b: MediaPlayer?) {
    private var courant = a

    init {
        if (b == null || !relier(a, b)) a.isLooping = true
    }

    private fun relier(de: MediaPlayer, vers: MediaPlayer): Boolean = try {
        de.setOnCompletionListener { relais(it) }
        vers.setOnCompletionListener { relais(it) }
        de.setNextMediaPlayer(vers)
        true
    } catch (e: Exception) {
        false
    }

    /** Le lecteur qui vient de finir se remet au début et attend son tour derrière celui qui joue. */
    private fun relais(fini: MediaPlayer) {
        val suivant = if (fini === a) b ?: return else a
        courant = suivant
        try {
            fini.seekTo(0)
            suivant.setNextMediaPlayer(fini)
        } catch (e: Exception) {
            // Relais impossible : celui qui joue boucle seul, comme avant.
            try { suivant.isLooping = true } catch (_: Exception) {}
        }
    }

    val isPlaying: Boolean get() = courant.isPlaying

    fun setVolume(v: Float) {
        a.setVolume(v, v)
        b?.setVolume(v, v)
    }

    fun pause() {
        if (courant.isPlaying) courant.pause()
    }

    fun demarrer(ms: Int) {
        courant.seekTo(ms)
        if (!courant.isPlaying) courant.start()
    }

    fun possede(mp: MediaPlayer) = mp === a || mp === b

    fun liberer() {
        a.release()
        b?.release()
    }
}
