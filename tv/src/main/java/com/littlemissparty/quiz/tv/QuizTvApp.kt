package com.littlemissparty.quiz.tv

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

private val Pink = Color(0xFFFF3CAC)
private val Violet = Color(0xFF784BA0)
private val Blue = Color(0xFF2B86C5)
private val Night = Color(0xFF1A0B2E)
private val Gold = Color(0xFFFFD166)

@Composable
fun QuizTvApp(state: UiState, onRearm: () -> Unit, onRetry: () -> Unit) {
    Box(Modifier.fillMaxSize()) {
        PartyBackground()
        when (state) {
            UiState.MissingConfig -> Message(
                "Configuration Firebase manquante",
                "Cette version a été compilée sans le fichier firebase-config.json.",
            )
            UiState.Connecting -> Connecting()
            is UiState.Error -> Message("Connexion impossible", state.message, onRetry)
            is UiState.Lobby -> Lobby(state, onRearm)
        }
    }
}

@Composable
private fun PartyBackground() {
    val t = rememberInfiniteTransition(label = "bg")
    val shift by t.animateFloat(
        0f, 1f, infiniteRepeatable(tween(12000, easing = LinearEasing), RepeatMode.Reverse), label = "shift",
    )
    val phase by t.animateFloat(
        0f, (2 * PI).toFloat(), infiniteRepeatable(tween(20000, easing = LinearEasing)), label = "phase",
    )
    Canvas(Modifier.fillMaxSize()) {
        drawRect(
            Brush.linearGradient(
                listOf(Night, Violet, Pink, Blue, Night),
                start = Offset(size.width * shift, 0f),
                end = Offset(size.width * (1 - shift), size.height),
            )
        )
        // Bulles festives qui flottent doucement.
        val bubbles = listOf(Pink, Gold, Blue, Color.White, Violet, Gold, Pink, Blue)
        bubbles.forEachIndexed { i, c ->
            val a = phase + i * 0.8f
            val cx = size.width * (0.1f + 0.8f * ((i * 0.37f + 0.15f * sin(a)) % 1f))
            val cy = size.height * (0.5f + 0.4f * cos(a * 0.7f + i))
            drawCircle(c.copy(alpha = 0.18f), radius = size.minDimension * (0.04f + 0.02f * (i % 3)), center = Offset(cx, cy))
        }
    }
}

@Composable
private fun Connecting() {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(color = Color.White)
        Spacer(Modifier.height(24.dp))
        Text("Préparation de la partie…", color = Color.White, fontSize = 28.sp)
    }
}

@Composable
private fun Message(title: String, detail: String, onRetry: (() -> Unit)? = null) {
    val focus = remember { FocusRequester() }
    Column(
        Modifier.fillMaxSize().padding(64.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, color = Color.White, fontSize = 40.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp))
        Text(detail, color = Color.White.copy(alpha = 0.8f), fontSize = 22.sp, textAlign = TextAlign.Center)
        if (onRetry != null) {
            Spacer(Modifier.height(32.dp))
            Button(onClick = onRetry, modifier = Modifier.focusRequester(focus)) { Text("Réessayer", fontSize = 22.sp) }
            LaunchedEffect(Unit) { focus.requestFocus() }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Lobby(state: UiState.Lobby, onRearm: () -> Unit) {
    val qr = remember(state.joinUrl) { qrCode(state.joinUrl) }
    Row(Modifier.fillMaxSize().padding(horizontal = 56.dp, vertical = 40.dp)) {
        Column(Modifier.weight(1f).fillMaxHeight()) {
            Title()
            Spacer(Modifier.height(32.dp))
            Text(
                if (state.teams.isEmpty()) "En attente des équipes…" else "${state.teams.size} équipe(s) dans la partie",
                color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(16.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                state.teams.forEach { team -> TeamChip(team) }
            }
            Spacer(Modifier.weight(1f))
            if (state.teams.isNotEmpty()) {
                Text("Test : appuyez sur BUZZ sur votre pupitre !", color = Gold, fontSize = 22.sp)
            }
        }
        Spacer(Modifier.width(40.dp))
        Column(
            Modifier
                .fillMaxHeight()
                .clip(RoundedCornerShape(32.dp))
                .background(Color.White)
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Scannez pour jouer", color = Night, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(16.dp))
            Image(qr, contentDescription = "QR code de la partie", modifier = Modifier.size(300.dp))
            Spacer(Modifier.height(16.dp))
            Text("Code de la partie", color = Night.copy(alpha = 0.6f), fontSize = 18.sp)
            Text(state.code, color = Pink, fontSize = 48.sp, fontWeight = FontWeight.Black, letterSpacing = 8.sp)
        }
    }
    AnimatedVisibility(
        visible = state.buzzer != null,
        enter = fadeIn(tween(150)) + scaleIn(initialScale = 1.3f),
        exit = fadeOut(tween(300)),
    ) {
        state.buzzer?.let { BuzzOverlay(it, onRearm) }
    }
}

@Composable
private fun Title() {
    val t = rememberInfiniteTransition(label = "title")
    val pulse by t.animateFloat(
        1f, 1.06f, infiniteRepeatable(tween(900, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "pulse",
    )
    val tilt by t.animateFloat(
        -2f, 2f, infiniteRepeatable(tween(1800, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "tilt",
    )
    Column(Modifier.scale(pulse).rotate(tilt)) {
        Text("Little Miss Party", color = Color.White, fontSize = 64.sp, fontWeight = FontWeight.Black)
        Text("QUIZ", color = Gold, fontSize = 88.sp, fontWeight = FontWeight.Black, letterSpacing = 12.sp)
    }
}

@Composable
private fun TeamChip(team: Team) {
    val pop = remember(team.uid) { Animatable(0f) }
    LaunchedEffect(team.uid) {
        pop.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow))
    }
    Row(
        Modifier
            .scale(pop.value)
            .clip(RoundedCornerShape(50))
            .background(Color.White.copy(alpha = 0.15f))
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(28.dp).clip(CircleShape).background(team.color.toColor()))
        Spacer(Modifier.width(12.dp))
        Text(team.name, color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun BuzzOverlay(team: Team, onRearm: () -> Unit) {
    val focus = remember { FocusRequester() }
    val bounce = remember(team.uid) { Animatable(0.3f) }
    LaunchedEffect(team.uid) {
        bounce.animateTo(1f, spring(dampingRatio = Spring.DampingRatioHighBouncy, stiffness = Spring.StiffnessMediumLow))
    }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Column(
        Modifier.fillMaxSize().background(team.color.toColor().copy(alpha = 0.94f)),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("BUZZ !", color = Color.White, fontSize = 48.sp, fontWeight = FontWeight.Black)
        Text(
            team.name,
            modifier = Modifier.scale(bounce.value),
            color = Color.White, fontSize = 120.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
        )
        Text("a buzzé en premier", color = Color.White, fontSize = 36.sp)
        Spacer(Modifier.height(48.dp))
        Button(
            onClick = onRearm,
            modifier = Modifier.focusRequester(focus),
            colors = ButtonDefaults.buttonColors(containerColor = Night, contentColor = Color.White),
        ) { Text("Réarmer les buzzers", fontSize = 24.sp, modifier = Modifier.padding(8.dp)) }
    }
}

private fun String.toColor(): Color =
    runCatching { Color(android.graphics.Color.parseColor(this)) }.getOrDefault(Pink)
