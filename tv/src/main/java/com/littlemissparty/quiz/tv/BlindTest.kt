package com.littlemissparty.quiz.tv

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.util.Log
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.tv.habillage.apparition
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
    val enCours = state.phase == Phase.QUESTION && state.deadline != null && !state.paused
    LaunchedEffect(player, enCours, revealed, state.deadline, state.resumeAt) {
        runCatching {
            when {
                revealed -> { player.seekTo(0); player.start() }
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
        }.onFailure { Log.w("Extrait", "Lecture impossible", it) }
    }
}

/**
 * Blind test : un disque qui tourne et des barres d'égaliseur pendant l'extrait ; tout se fige au buzz.
 * À la révélation : le titre et l'artiste.
 */
@Composable
fun BlindBoard(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    val revealed = state.phase == Phase.REVEAL || state.phase == Phase.SCORES
    val joue = (state.phase == Phase.QUESTION && state.deadline != null && !state.paused) || state.phase == Phase.REVEAL
    val manquant = q.audioId == null || state.sounds[q.audioId] == null
    val anim = rememberInfiniteTransition(label = "disque")
    val tour by anim.animateFloat(0f, 360f, infiniteRepeatable(tween(4_000, easing = LinearEasing)), label = "tour")
    val battement by anim.animateFloat(0f, 1f, infiniteRepeatable(tween(500, easing = LinearEasing), RepeatMode.Reverse), label = "battement")
    Box(
        modifier.clip(RoundedCornerShape(28.dp)).background(Color.White.copy(alpha = 0.10f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "BLIND TEST",
            color = Palette.Night, fontSize = 18.sp, fontWeight = FontWeight.Black,
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 12.dp)
                .clip(RoundedCornerShape(50)).background(Palette.Gold).padding(horizontal = 14.dp, vertical = 4.dp),
        )
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(top = 48.dp, bottom = 20.dp, start = 24.dp, end = 24.dp)) {
            // Disque : il tourne pendant la musique, s'arrête net au buzz.
            Box(
                Modifier.weight(1f).aspectRatio(1f).graphicsLayer { rotationZ = if (joue) tour else 0f }
                    .clip(CircleShape).background(Color(0xFF15101F)).border(6.dp, Palette.Gold, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.fillMaxSize(0.62f).clip(CircleShape).border(2.dp, Color.White.copy(alpha = 0.15f), CircleShape))
                Box(Modifier.fillMaxSize(0.34f).clip(CircleShape).background(Palette.Gold), contentAlignment = Alignment.Center) {
                    Text(if (revealed) "♫" else "?", color = Palette.Night, fontSize = 44.sp, fontWeight = FontWeight.Black)
                }
            }
            Spacer(Modifier.height(14.dp))
            if (revealed) {
                q.artist?.let {
                    Text(
                        it, color = Palette.Ink, fontSize = 30.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.apparition(0, it),
                    )
                }
            } else if (manquant) {
                Text("Extrait indisponible : l'animatrice peut passer.", color = Palette.InkSoft, fontSize = 22.sp, textAlign = TextAlign.Center)
            } else {
                // Égaliseur : cinq barres qui dansent pendant la musique, figées au buzz.
                Row(Modifier.height(48.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                    listOf(0.55f, 0.9f, 0.4f, 1f, 0.7f).forEachIndexed { i, base ->
                        val h = if (joue) (if (i % 2 == 0) battement else 1f - battement) * 0.7f + 0.3f * base else 0.25f
                        Box(Modifier.width(14.dp).fillMaxHeight(h.coerceIn(0.1f, 1f)).clip(RoundedCornerShape(4.dp)).background(Palette.Gold))
                    }
                }
            }
        }
    }
}
