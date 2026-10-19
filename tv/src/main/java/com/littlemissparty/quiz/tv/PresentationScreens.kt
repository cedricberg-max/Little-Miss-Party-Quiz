package com.littlemissparty.quiz.tv

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.habillage.LogoLmp
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.PoliceLmp

/**
 * Présentation d'un jeu (demande de cedric) : son nom en grand, qui respire doucement, et rien d'autre. Les règles,
 * c'est l'animatrice qui les donne ; l'écran attend qu'elle lance le jeu depuis la régie (ou OK sur la télécommande).
 */
@Composable
fun PresentationScreen(state: UiState.Playing, actions: TvActions) {
    val titre = state.gameTitle ?: "Quiz"
    val souffle = rememberInfiniteTransition(label = "presentation")
    val echelle by souffle.animateFloat(
        1f, 1.05f, infiniteRepeatable(tween(1_600, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "echelle",
    )
    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().padding(horizontal = 80.dp, vertical = 48.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            LogoLmp(110.dp)
            Spacer(Modifier.height(28.dp))
            Text(
                titre,
                style = TextStyle(
                    fontFamily = PoliceLmp, color = Neon.OrClair, fontSize = 88.sp, lineHeight = 96.sp, fontWeight = FontWeight.ExtraBold,
                    textAlign = TextAlign.Center, shadow = Shadow(Neon.Or.copy(alpha = 0.7f), blurRadius = 36f),
                ),
                maxLines = 2,
                modifier = Modifier.graphicsLayer { scaleX = echelle; scaleY = echelle },
            )
        }
        if (!state.paused) {
            NextButton("Lancer l'épreuve", actions.next, Modifier.align(Alignment.BottomEnd).padding(36.dp), key = "presentation-${state.index}")
        }
    }
}
