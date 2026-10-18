package com.littlemissparty.quiz.tv

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.PAUSE_TEAM
import com.littlemissparty.quiz.engine.Phase
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * Pause générale et décompte de reprise, par-dessus toutes les étapes de la partie.
 * L'intermède ne parle jamais de panne : même une pause automatique (pupitre déconnecté)
 * reste un moment de l'émission.
 */
@Composable
fun PauseLayer(state: UiState.Playing, onResume: () -> Unit) {
    AnimatedVisibility(state.paused, enter = fadeIn(tween(500)), exit = fadeOut(tween(400))) {
        Intermission(state, onResume)
    }
    if (!state.paused) ResumeCountdown(state)
}

/** Intermède festif : faisceaux qui tournent, halo qui respire, étincelles, message chaleureux. */
@Composable
private fun Intermission(state: UiState.Playing, onResume: () -> Unit) {
    val t = rememberInfiniteTransition(label = "intermede")
    val turn by t.animateFloat(0f, 360f, infiniteRepeatable(tween(24_000, easing = LinearEasing)), label = "turn")
    val breath by t.animateFloat(0.55f, 1f, infiniteRepeatable(tween(3_000, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "breath")
    val twinkle by t.animateFloat(0f, (2 * PI).toFloat(), infiniteRepeatable(tween(4_000, easing = LinearEasing)), label = "twinkle")
    Box(Modifier.fillMaxSize().background(Palette.Night.copy(alpha = 0.94f)), contentAlignment = Alignment.Center) {
        // 1. Faisceaux de projecteurs : dessinés une fois, seule la rotation du calque change.
        Box(
            Modifier.fillMaxSize()
                .graphicsLayer { rotationZ = turn; scaleX = 1.6f; scaleY = 1.6f }
                .drawWithCache {
                    val c = Offset(size.width / 2, size.height / 2)
                    val r = size.maxDimension
                    val beams = (0 until 8).map { i ->
                        val a = (i * 45.0) * PI / 180
                        val w = 0.11
                        Path().apply {
                            moveTo(c.x, c.y)
                            lineTo(c.x + (r * cos(a - w)).toFloat(), c.y + (r * sin(a - w)).toFloat())
                            lineTo(c.x + (r * cos(a + w)).toFloat(), c.y + (r * sin(a + w)).toFloat())
                            close()
                        }
                    }
                    val brushes = listOf(NeonHalo, Palette.Gold).map { col ->
                        Brush.radialGradient(listOf(col.copy(alpha = 0.22f), Color.Transparent), c, r * 0.6f)
                    }
                    onDrawBehind { beams.forEachIndexed { i, p -> drawPath(p, brushes[i % 2]) } }
                },
        )
        // 2. Halo doré derrière le message, qui respire lentement.
        Box(
            Modifier.size(720.dp)
                .graphicsLayer { alpha = breath; scaleX = 0.9f + 0.1f * breath; scaleY = 0.9f + 0.1f * breath }
                .drawWithCache {
                    val brush = Brush.radialGradient(listOf(Palette.Gold.copy(alpha = 0.35f), NeonHalo.copy(alpha = 0.12f), Color.Transparent))
                    onDrawBehind { drawCircle(brush) }
                },
        )
        // 3. Étincelles à quatre branches sur les bords, chacune scintille à son rythme.
        Sparkles { twinkle }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text("LITTLE MISS PARTY QUIZ", color = NeonHalo, fontSize = 22.sp, fontWeight = FontWeight.Black, letterSpacing = 8.sp)
            Spacer(Modifier.height(20.dp))
            Text(
                "On revient tout de suite !",
                style = TextStyle(
                    color = Palette.Gold, fontSize = 72.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                    shadow = Shadow(Palette.Gold.copy(alpha = 0.8f), blurRadius = 28f),
                ),
                modifier = Modifier.graphicsLayer { val s = 0.97f + 0.03f * breath; scaleX = s; scaleY = s },
            )
            Spacer(Modifier.height(16.dp))
            Text(
                if (state.pauseReason == PAUSE_TEAM) "Petite pause : on attend nos amis, restez bien en place !"
                else if (state.childName.isNotBlank()) "Petite pause pour ${state.childName} et ses invités, ne bougez pas !"
                else "Petite pause, restez bien en place !",
                color = Palette.Ink, fontSize = 30.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
            )
            if (state.phase == Phase.QUESTION) {
                Spacer(Modifier.height(10.dp))
                Text("Le chrono est arrêté", color = Palette.InkSoft, fontSize = 22.sp)
            }
            Spacer(Modifier.height(36.dp))
            // Secours à la télécommande ; avec la régie, c'est l'animatrice qui relance depuis son téléphone.
            NextButton("Reprendre", onResume, key = "pause")
        }
    }
}

@Composable
private fun Sparkles(phase: () -> Float) {
    Canvas(Modifier.fillMaxSize()) {
        SPARKS.forEachIndexed { i, (fx, fy) ->
            val a = (0.35f + 0.65f * (0.5f + 0.5f * sin(phase() + i * 1.7f))).coerceIn(0f, 1f)
            val cx = size.width * fx
            val cy = size.height * fy
            val r = size.minDimension * (0.012f + 0.006f * (i % 3))
            val color = if (i % 3 == 0) Palette.Gold else Color.White
            // Étoile à quatre branches : deux losanges croisés.
            drawLine(color.copy(alpha = a), Offset(cx - r, cy), Offset(cx + r, cy), strokeWidth = r / 3)
            drawLine(color.copy(alpha = a), Offset(cx, cy - r), Offset(cx, cy + r), strokeWidth = r / 3)
            drawCircle(color.copy(alpha = a * 0.5f), radius = r / 3, center = Offset(cx, cy))
        }
    }
}

/**
 * Décompte 3, 2, 1 calé sur l'heure du serveur : la TV et les pupitres reprennent au même instant,
 * et le chrono de la question repart quand il se termine.
 */
@Composable
private fun ResumeCountdown(state: UiState.Playing) {
    val resumeAt = state.resumeAt ?: return
    var shown by remember(resumeAt) { mutableIntStateOf(secondsBefore(resumeAt, state.serverOffset)) }
    LaunchedEffect(resumeAt) {
        while (true) {
            shown = secondsBefore(resumeAt, state.serverOffset)
            if (shown <= 0) break
            delay(50)
        }
    }
    if (shown <= 0) return
    val pop = remember(shown) { Animatable(1.8f) }
    LaunchedEffect(shown) { pop.animateTo(1f, tween(450, easing = FastOutSlowInEasing)) }
    Box(Modifier.fillMaxSize().background(Palette.Night.copy(alpha = 0.7f)), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                "$shown",
                style = TextStyle(
                    color = Palette.Gold, fontSize = 200.sp, fontWeight = FontWeight.Black,
                    shadow = Shadow(Palette.Gold.copy(alpha = 0.9f), blurRadius = 40f),
                ),
                modifier = Modifier.graphicsLayer { scaleX = pop.value; scaleY = pop.value; alpha = (2.2f - pop.value).coerceIn(0f, 1f) },
            )
            Text("C'est reparti !", color = Palette.Ink, fontSize = 34.sp, fontWeight = FontWeight.Black)
        }
    }
}

private fun secondsBefore(at: Long, offset: Long): Int {
    val ms = at - (System.currentTimeMillis() + offset)
    return if (ms <= 0) 0 else ((ms + 999) / 1000).toInt().coerceAtMost(9)
}

private val NeonHalo = Color(0xFFF888B3)

/** Positions des étincelles, sur les bords pour ne jamais passer derrière le message. */
private val SPARKS = listOf(
    0.06f to 0.12f, 0.18f to 0.28f, 0.09f to 0.55f, 0.15f to 0.84f, 0.30f to 0.08f, 0.70f to 0.10f,
    0.86f to 0.22f, 0.93f to 0.48f, 0.82f to 0.78f, 0.94f to 0.90f, 0.40f to 0.93f, 0.62f to 0.91f,
)
