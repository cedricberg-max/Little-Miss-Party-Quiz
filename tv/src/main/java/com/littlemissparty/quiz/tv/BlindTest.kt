package com.littlemissparty.quiz.tv

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.tv.habillage.GAIN_REFRAIN_MB
import com.littlemissparty.quiz.tv.habillage.Sons
import com.littlemissparty.quiz.tv.habillage.boosterExtrait
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.security.MessageDigest

/** Extraits musicaux (blind test, quiz musical) : vérification du fichier reçu. */
object Extraits {
    /**
     * L'identifiant d'un extrait est le début de l'empreinte SHA-256 de son adresse data: (comme les photos) :
     * un fichier abîmé pendant le transfert est refusé au lieu d'être joué.
     */
    fun empreinteOk(id: String, dataUrl: String): Boolean {
        val hash = MessageDigest.getInstance("SHA-256").digest(dataUrl.toByteArray(Charsets.UTF_8))
        return hash.take(8).joinToString("") { "%02x".format(it) } == id
    }
}

/**
 * Lecteur de l'extrait de la question : la musique suit le chrono. Elle joue pendant la question, se fige
 * quand une équipe buzze ou pendant une pause, et reprend exactement là où elle s'était arrêtée ; à la
 * révélation, l'extrait repart du début pendant que la TV montre la réponse. Rien ne bloque jamais la partie :
 * un fichier absent ou illisible laisse simplement la question sans musique.
 */
@Composable
fun ExtraitMusical(q: Question, state: UiState.Playing) {
    val path = q.audioId?.let { state.sounds[it] }
    if (path == null) {
        // Toujours pas sur la box quelques secondes après l'ouverture de la question : dit dans les rapports.
        if (q.audioId != null) LaunchedEffect(q.id) {
            delay(ABSENT_APRES_MS)
            Sons.incidentChanson("Extrait ${q.audioId} absent de la box (question ${q.id}) : question sans musique")
        }
        return
    }
    // Lecteur en panne (erreur, ou muet alors qu'il devrait jouer : TV du 25/10 au soir) : refait, deux fois au plus.
    var essai by remember(q.id, path) { mutableIntStateOf(0) }
    val panne: (String) -> Unit = { raison ->
        Sons.incidentChanson("Extrait ${q.audioId} (question ${q.id}) : $raison${if (essai < ESSAIS_CHANSON) ", lecteur refait" else ""}")
        if (essai < ESSAIS_CHANSON) essai++
    }
    val preparation = rememberPrepareAuCalme(q.id, path, essai, liberer = ::rendreLecteur) {
        runCatching {
            MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build(),
                )
                setDataSource(path)
                prepare()
                setOnErrorListener { _, quoi, extra -> panne("lecteur en erreur ($quoi, $extra)"); true }
            }
        }.onFailure {
            Log.w("Extrait", "Extrait illisible ${q.audioId}", it)
            Sons.incidentChanson("Extrait ${q.audioId} (question ${q.id}) illisible : ${it.message}")
        }.getOrNull()
    }
    val player = (preparation as? Preparation.Faite)?.lecteur ?: return
    DisposableEffect(player) {
        val volume = boosterExtrait(player)
        onDispose { runCatching { volume?.release() }; com.littlemissparty.quiz.tv.habillage.Liberation.lecteur(player, stop = true) }
    }
    val revealed = state.phase == Phase.REVEAL
    // Blind test : la révélation fait réentendre l'extrait quelques secondes, ou s'arrête si l'animatrice raccourcit.
    val coupe = q.isBlind && state.blind?.cut == true
    // Refrain préparé dans la Régie PC : c'est lui qui joue à la révélation, en boucle, à la place de l'extrait.
    // Quiz musical : seulement quelques secondes, puis il s'éteint en fondu (cedric, 24/10 : « un peu plus vite »).
    val refrain = q.refrainId?.takeIf { q.isBlind || q.isMusical }?.let { state.sounds[it] }
    if (revealed && refrain != null && !coupe && !state.paused) RefrainEnBoucle(q.id, refrain, dureeMs = MUSICAL_REVELATION_MS.takeIf { q.isMusical })
    val enCours = state.phase == Phase.QUESTION && state.deadline != null && !state.paused
    LaunchedEffect(player, enCours, revealed, coupe, state.deadline, state.resumeAt) {
        runCatching {
            when {
                revealed && (coupe || refrain != null) -> if (player.isPlaying) player.pause()
                revealed -> {
                    player.seekTo(0); player.start()
                    launch { verifierQueCaJoue(player, 0, panne) }
                    // revealSec 0 : tout l'extrait, le temps de chanter.
                    if (q.isBlind && q.revealSec > 0) {
                        delay(q.revealSec * 1000L)
                        if (player.isPlaying) player.pause()
                    }
                    // Quiz musical sans refrain préparé : l'extrait repart pour quelques secondes d'ambiance, puis s'éteint.
                    if (q.isMusical) {
                        delay((MUSICAL_REVELATION_MS - FONDU_REFRAIN_MS).coerceAtLeast(0))
                        eteindre(player)
                    }
                }
                enCours -> {
                    // Après une reprise, la musique attend la fin du décompte 3, 2, 1, comme le chrono.
                    val start = state.resumeAt ?: 0L
                    val attente = start - (System.currentTimeMillis() + state.serverOffset)
                    if (attente > 0) { if (player.isPlaying) player.pause(); delay(attente) }
                    val ecoule = (q.durationMs - ((state.deadline ?: 0L) - (System.currentTimeMillis() + state.serverOffset))).coerceAtLeast(0)
                    if (ecoule < player.duration) {
                        player.seekTo(ecoule.toInt()); player.start()
                        launch { verifierQueCaJoue(player, ecoule.toInt(), panne) }
                    } else if (player.isPlaying) player.pause()
                }
                else -> if (player.isPlaying) player.pause()
            }
            Unit
        }.onFailure { Log.w("Extrait", "Lecture impossible", it) }
    }
}

/** Arrête et rend un lecteur de chanson ; sans effet s'il l'est déjà. */
internal fun rendreLecteur(l: MediaPlayer) = com.littlemissparty.quiz.tv.habillage.Liberation.lecteur(l, stop = true)

/** Extrait toujours absent de la box ce temps après l'ouverture de sa question : signalé dans les rapports. */
private const val ABSENT_APRES_MS = 8_000L

/** Lecteur d'une chanson refait au plus ce nombre de fois quand il tombe en panne. */
internal const val ESSAIS_CHANSON = 2

/**
 * Une chanson lancée avance vraiment : sinon (lecteur muet, la TCL du 25/10 au soir), [panne]. Le lecteur lancé
 * depuis [depart] doit avoir avancé d'au moins une demi-seconde en [VERIFICATION_MS].
 */
internal suspend fun verifierQueCaJoue(player: MediaPlayer, depart: Int, panne: (String) -> Unit) {
    delay(VERIFICATION_MS)
    val position = runCatching { player.currentPosition }.getOrNull() ?: return
    if (!runCatching { player.isPlaying }.getOrDefault(false)) return
    if (position < depart + 500) panne("muet, n'avance pas (${position - depart} ms en $VERIFICATION_MS ms)")
}

private const val VERIFICATION_MS = 1_500L

/** Fondu enchaîné entre deux passages du refrain, en millisecondes. */
private const val FONDU_REFRAIN_MS = 2_000L

/**
 * Quiz musical, révélation (cedric, 24/10) : la bonne réponse s'allume d'abord sur les cartes pendant [MUSICAL_GRILLE_MS],
 * puis la scène du blind test (pochette, titre, paroles) ; la musique dure [MUSICAL_REVELATION_MS] en tout, fondu compris.
 */
const val MUSICAL_GRILLE_MS = 2_500L
const val MUSICAL_REVELATION_MS = 15_000L

/** Baisse le son de [l] jusqu'au silence en [FONDU_REFRAIN_MS], puis l'arrête. */
private suspend fun eteindre(l: MediaPlayer) {
    val pas = 10
    for (k in 1..pas) {
        delay(FONDU_REFRAIN_MS / pas)
        val v = 1f - k / pas.toFloat()
        l.setVolume(v, v)
    }
    if (l.isPlaying) l.pause()
}

/**
 * Où en est le refrain qu'on entend (millisecondes depuis le début de son extrait) : les paroles de la révélation se
 * calent dessus à chaque image. Null quand aucun refrain ne joue. À chaque boucle, la position repart de zéro.
 */
object PositionRefrain {
    @Volatile private var lecteur: MediaPlayer? = null

    fun ms(): Long? = lecteur?.let { runCatching { if (it.isPlaying) it.currentPosition.toLong() else null }.getOrNull() }

    internal fun suivre(l: MediaPlayer?) { lecteur = l }
    internal fun lacher(l: MediaPlayer) { if (lecteur === l) lecteur = null }
}

/**
 * Blind test, révélation : le refrain (environ 90 s) joue plus fort que l'extrait et repart en boucle, avec un
 * fondu enchaîné, jusqu'au « Titre suivant » de l'animatrice (le composant disparaît alors, la musique s'arrête).
 * Deux lecteurs se relaient : le second démarre en fondu pendant que le premier s'éteint. Avec [dureeMs] (Quiz
 * musical) : un seul passage, qui s'éteint en fondu au bout de ce temps.
 */
@Composable
fun RefrainEnBoucle(cle: String, path: String, dureeMs: Long? = null) {
    val preparation = rememberPrepareAuCalme(cle, path, liberer = { l: List<MediaPlayer> -> l.forEach(::rendreLecteur) }) {
        runCatching {
            List(2) {
                MediaPlayer().apply {
                    setAudioAttributes(
                        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build(),
                    )
                    setDataSource(path)
                    prepare()
                    setOnErrorListener { _, quoi, extra -> Sons.incidentChanson("Refrain ($cle) : lecteur en erreur ($quoi, $extra)"); true }
                }
            }
        }.onFailure {
            Log.w("Extrait", "Refrain illisible", it)
            Sons.incidentChanson("Refrain ($cle) illisible : ${it.message}")
        }.getOrNull()
    }
    val lecteurs = (preparation as? Preparation.Faite)?.lecteur ?: return
    DisposableEffect(lecteurs) {
        val volumes = lecteurs.map { boosterExtrait(it, GAIN_REFRAIN_MB) }
        onDispose {
            lecteurs.forEach { PositionRefrain.lacher(it) }
            volumes.forEach { runCatching { it?.release() } }
            lecteurs.forEach { com.littlemissparty.quiz.tv.habillage.Liberation.lecteur(it, stop = true) }
        }
    }
    LaunchedEffect(lecteurs) {
        runCatching {
            var i = 0
            lecteurs[0].setVolume(1f, 1f)
            lecteurs[0].start()
            PositionRefrain.suivre(lecteurs[0])
            if (dureeMs != null) {
                val fin = minOf(dureeMs, lecteurs[0].duration.toLong().coerceAtLeast(FONDU_REFRAIN_MS))
                delay((fin - FONDU_REFRAIN_MS).coerceAtLeast(0))
                eteindre(lecteurs[0])
                return@runCatching
            }
            while (true) {
                val actuel = lecteurs[i]
                val suivant = lecteurs[1 - i]
                val duree = actuel.duration.toLong().coerceAtLeast(FONDU_REFRAIN_MS * 3)
                delay((duree - actuel.currentPosition - FONDU_REFRAIN_MS).coerceAtLeast(0))
                suivant.seekTo(0)
                suivant.setVolume(0f, 0f)
                suivant.start()
                // Les paroles suivent le passage qui commence : elles repartent au début du refrain.
                PositionRefrain.suivre(suivant)
                val pas = 10
                for (k in 1..pas) {
                    delay(FONDU_REFRAIN_MS / pas)
                    val v = k / pas.toFloat()
                    suivant.setVolume(v, v)
                    actuel.setVolume(1 - v, 1 - v)
                }
                if (actuel.isPlaying) actuel.pause()
                i = 1 - i
            }
        }.onFailure { Log.w("Extrait", "Lecture du refrain impossible", it) }
    }
}
