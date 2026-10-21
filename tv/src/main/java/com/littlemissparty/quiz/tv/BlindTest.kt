package com.littlemissparty.quiz.tv

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.tv.habillage.GAIN_REFRAIN_MB
import com.littlemissparty.quiz.tv.habillage.boosterExtrait
import kotlinx.coroutines.delay
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
    val path = q.audioId?.let { state.sounds[it] } ?: return
    val player = remember(q.id, path) {
        runCatching {
            MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build(),
                )
                setDataSource(path)
                prepare()
            }
        }.onFailure { Log.w("Extrait", "Extrait illisible ${q.audioId}", it) }.getOrNull()
    } ?: return
    DisposableEffect(player) {
        val volume = boosterExtrait(player)
        onDispose { runCatching { volume?.release() }; runCatching { player.stop() }; runCatching { player.release() } }
    }
    val revealed = state.phase == Phase.REVEAL
    // Blind test : la révélation fait réentendre l'extrait quelques secondes, ou s'arrête si l'animatrice raccourcit.
    val coupe = q.isBlind && state.blind?.cut == true
    // Refrain préparé dans la Régie PC : c'est lui qui joue à la révélation, en boucle, à la place de l'extrait.
    val refrain = q.refrainId?.takeIf { q.isBlind }?.let { state.sounds[it] }
    if (revealed && refrain != null && !coupe && !state.paused) RefrainEnBoucle(q.id, refrain)
    val enCours = state.phase == Phase.QUESTION && state.deadline != null && !state.paused
    LaunchedEffect(player, enCours, revealed, coupe, state.deadline, state.resumeAt) {
        runCatching {
            when {
                revealed && (coupe || refrain != null) -> if (player.isPlaying) player.pause()
                revealed -> {
                    player.seekTo(0); player.start()
                    // revealSec 0 : tout l'extrait, le temps de chanter.
                    if (q.isBlind && q.revealSec > 0) {
                        delay(q.revealSec * 1000L)
                        if (player.isPlaying) player.pause()
                    }
                }
                enCours -> {
                    // Après une reprise, la musique attend la fin du décompte 3, 2, 1, comme le chrono.
                    val start = state.resumeAt ?: 0L
                    val attente = start - (System.currentTimeMillis() + state.serverOffset)
                    if (attente > 0) { if (player.isPlaying) player.pause(); delay(attente) }
                    val ecoule = (q.durationMs - ((state.deadline ?: 0L) - (System.currentTimeMillis() + state.serverOffset))).coerceAtLeast(0)
                    if (ecoule < player.duration) { player.seekTo(ecoule.toInt()); player.start() } else if (player.isPlaying) player.pause()
                }
                else -> if (player.isPlaying) player.pause()
            }
            Unit
        }.onFailure { Log.w("Extrait", "Lecture impossible", it) }
    }
}

/** Fondu enchaîné entre deux passages du refrain, en millisecondes. */
private const val FONDU_REFRAIN_MS = 2_000L

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
 * Deux lecteurs se relaient : le second démarre en fondu pendant que le premier s'éteint.
 */
@Composable
fun RefrainEnBoucle(cle: String, path: String) {
    val lecteurs = remember(cle, path) {
        runCatching {
            List(2) {
                MediaPlayer().apply {
                    setAudioAttributes(
                        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build(),
                    )
                    setDataSource(path)
                    prepare()
                }
            }
        }.onFailure { Log.w("Extrait", "Refrain illisible", it) }.getOrNull()
    } ?: return
    DisposableEffect(lecteurs) {
        val volumes = lecteurs.map { boosterExtrait(it, GAIN_REFRAIN_MB) }
        onDispose {
            lecteurs.forEach { PositionRefrain.lacher(it) }
            volumes.forEach { runCatching { it?.release() } }
            lecteurs.forEach { runCatching { it.stop() }; runCatching { it.release() } }
        }
    }
    LaunchedEffect(lecteurs) {
        runCatching {
            var i = 0
            lecteurs[0].setVolume(1f, 1f)
            lecteurs[0].start()
            PositionRefrain.suivre(lecteurs[0])
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
