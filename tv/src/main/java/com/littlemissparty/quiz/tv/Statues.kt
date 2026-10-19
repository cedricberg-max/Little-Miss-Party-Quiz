package com.littlemissparty.quiz.tv

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.util.Log
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.tv.habillage.apparition

/** Statues musicales : la musique joue-t-elle à cet instant (question en cours, chrono qui tourne, pas une statue) ? */
@Composable
fun statuesDanse(q: Question, state: UiState.Playing): Boolean {
    val remaining = chronoRestant(q, state)
    val tourne = state.phase == Phase.QUESTION && state.deadline != null && !state.paused && remaining > 0
    return tourne && !q.statueAt(q.durationMs - remaining)
}

/**
 * Musique des statues : une boucle de l'habillage (musique maison, sans droits), coupée net à chaque statue
 * et pendant une pause, reprise ensuite. Un son qui ne se charge pas ne bloque rien : la TV affiche quand même
 * « DANSEZ ! » et « STATUE ! ».
 */
@Composable
private fun MusiqueStatues(danse: Boolean) {
    val context = LocalContext.current
    val player = remember {
        runCatching {
            val id = context.resources.getIdentifier("lmp_bed_mimes", "raw", context.packageName)
            MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                context.resources.openRawResourceFd(id).use { setDataSource(it.fileDescriptor, it.startOffset, it.length) }
                isLooping = true
                prepare()
            }
        }.onFailure { Log.w("Statues", "Musique indisponible", it) }.getOrNull()
    } ?: return
    DisposableEffect(player) { onDispose { runCatching { player.stop() }; runCatching { player.release() } } }
    LaunchedEffect(player, danse) {
        runCatching { if (danse) player.start() else if (player.isPlaying) player.pause() }
    }
}

/** Statues musicales : « DANSEZ ! » qui bouge pendant la musique, « STATUE ! » figé à l'arrêt. */
@Composable
fun StatuesBoard(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    val danse = statuesDanse(q, state)
    MusiqueStatues(danse)
    val enCours = state.phase == Phase.QUESTION
    val anim = rememberInfiniteTransition(label = "danse")
    val balance by anim.animateFloat(-1f, 1f, infiniteRepeatable(tween(450, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "balance")
    Box(
        modifier.clip(RoundedCornerShape(28.dp)).background(if (enCours && !danse) Color.White.copy(alpha = 0.18f) else Color.White.copy(alpha = 0.08f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "STATUES MUSICALES",
            color = Palette.Night, fontSize = 18.sp, fontWeight = FontWeight.Black,
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 12.dp)
                .clip(RoundedCornerShape(50)).background(Palette.Gold).padding(horizontal = 14.dp, vertical = 4.dp),
        )
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            when {
                enCours && danse -> {
                    Text(
                        "DANSEZ !", color = Palette.Gold, fontSize = 130.sp, lineHeight = 136.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                        modifier = Modifier.graphicsLayer { rotationZ = 4f * balance; translationY = -10f * balance },
                    )
                    Text("Bougez tant que la musique joue !", color = Palette.Ink, fontSize = 32.sp, fontWeight = FontWeight.Bold)
                }
                enCours -> {
                    Text(
                        "STATUE !", color = Palette.Ink, fontSize = 140.sp, lineHeight = 146.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                        modifier = Modifier.apparition(0, "statue"),
                    )
                    Text("Plus personne ne bouge…", color = Palette.Gold, fontSize = 34.sp, fontWeight = FontWeight.Black)
                }
                state.phase == Phase.CLOSED -> {
                    Text("Fin de la musique !", color = Palette.Gold, fontSize = 64.sp, fontWeight = FontWeight.Black)
                    Spacer(Modifier.height(12.dp))
                    Text("L'animatrice désigne l'équipe gagnante.", color = Palette.Ink, fontSize = 30.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                }
                else -> {
                    val gagnant = state.teams.find { state.awards[it.uid]?.correct == true }
                    Text(
                        gagnant?.let { "Bravo ${it.name} !" } ?: "Bravo à tous les danseurs !",
                        color = gagnant?.color?.toColor() ?: Palette.Gold, fontSize = 60.sp, lineHeight = 66.sp, fontWeight = FontWeight.Black,
                        textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 24.dp).apparition(0, gagnant?.uid),
                    )
                    Spacer(Modifier.height(12.dp))
                    Text("Les meilleures statues de la fête !", color = Palette.Ink, fontSize = 30.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
