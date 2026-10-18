package com.littlemissparty.quiz.tv

import android.graphics.BitmapFactory
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import kotlinx.coroutines.delay

/** Zoom de départ de la photo mystère, et zoom quand le chrono arrive à zéro (la révélation la montre entière). */
private const val ZOOM_DEPART = 6f
private const val ZOOM_FIN = 1.6f

/**
 * Zoom mystère : la photo part très zoomée sur un détail et se dévoile au fil du chrono ; figée à la
 * fermeture, elle s'ouvre en entier à la révélation. Photo pas encore chargée : un grand « ? ».
 */
@Composable
fun ZoomPhoto(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    val bytes = q.imageId?.let { state.images[it] }
    val photo: ImageBitmap? = remember(bytes) {
        bytes?.let { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }.getOrNull() }
    }
    val total = q.durationMs.coerceAtLeast(1)
    var remaining by remember(q.id) { mutableLongStateOf(state.remainingMs) }
    LaunchedEffect(q.id, state.deadline, state.paused, state.phase) {
        val deadline = state.deadline
        if (deadline == null) {
            remaining = state.remainingMs
            return@LaunchedEffect
        }
        // Pendant le décompte 3, 2, 1 de la reprise, la photo ne bouge pas.
        val start = state.resumeAt ?: 0L
        while (true) {
            remaining = (deadline - maxOf(System.currentTimeMillis() + state.serverOffset, start)).coerceAtLeast(0)
            if (remaining == 0L) break
            delay(60)
        }
    }
    val revealed = state.phase == Phase.REVEAL || state.phase == Phase.SCORES
    val progress = 1f - remaining.toFloat() / total
    val target = if (revealed) 1f else ZOOM_DEPART - (ZOOM_DEPART - ZOOM_FIN) * progress.coerceIn(0f, 1f)
    val zoom by animateFloatAsState(
        target,
        animationSpec = if (revealed) tween(1_100, easing = FastOutSlowInEasing) else tween(90, easing = LinearEasing),
        label = "zoom",
    )
    // Chaque photo a son détail de départ, toujours le même pour la même question.
    val pivot = remember(q.id) {
        val h = q.id.hashCode()
        TransformOrigin(0.3f + (h and 0xFF) / 255f * 0.4f, 0.3f + ((h shr 8) and 0xFF) / 255f * 0.4f)
    }
    Box(
        modifier.clip(RoundedCornerShape(28.dp)).background(Color.White.copy(alpha = 0.12f)),
        contentAlignment = Alignment.Center,
    ) {
        if (photo != null) {
            Image(
                photo, contentDescription = "Photo mystère", contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = zoom; scaleY = zoom; transformOrigin = pivot },
            )
        } else {
            Text("?", color = Palette.Gold, fontSize = 140.sp, fontWeight = FontWeight.Black)
        }
        if (!revealed) {
            Text(
                "ZOOM MYSTÈRE",
                color = Palette.Night, fontSize = 18.sp, fontWeight = FontWeight.Black,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 12.dp)
                    .clip(RoundedCornerShape(50)).background(Palette.Gold).padding(horizontal = 14.dp, vertical = 4.dp),
            )
        }
    }
}
