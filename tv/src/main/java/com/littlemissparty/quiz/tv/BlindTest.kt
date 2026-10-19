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
        onDispose { runCatching { player.stop() }; runCatching { player.release() } }
    }
    val revealed = state.phase == Phase.REVEAL
    // Blind test : la révélation fait réentendre l'extrait quelques secondes, ou s'arrête si l'animatrice raccourcit.
    val coupe = q.isBlind && state.blind?.cut == true
    val enCours = state.phase == Phase.QUESTION && state.deadline != null && !state.paused
    LaunchedEffect(player, enCours, revealed, coupe, state.deadline, state.resumeAt) {
        runCatching {
            when {
                revealed && coupe -> if (player.isPlaying) player.pause()
                revealed -> {
                    player.seekTo(0); player.start()
                    if (q.isBlind) {
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
