package com.littlemissparty.quiz.tv

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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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

/** Petit badge doré en haut d'un plateau de mini-jeu. */
@Composable
private fun Badge(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        color = Palette.Night, fontSize = 18.sp, fontWeight = FontWeight.Black,
        modifier = modifier.clip(RoundedCornerShape(50)).background(Palette.Gold).padding(horizontal = 14.dp, vertical = 4.dp),
    )
}

/**
 * Chante le mot ! : le mot en très grand, entouré de notes qui dansent. Il reste affiché pendant que
 * l'équipe chante, et à la révélation.
 */
@Composable
fun ChanteBoard(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    val danse = rememberInfiniteTransition(label = "notes")
    val haut by danse.animateFloat(
        0f, 1f,
        infiniteRepeatable(tween(900, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "note",
    )
    Box(
        modifier.clip(RoundedCornerShape(28.dp)).background(Color.White.copy(alpha = 0.10f)),
        contentAlignment = Alignment.Center,
    ) {
        Badge("CHANTE LE MOT !", Modifier.align(Alignment.TopCenter).padding(top = 12.dp))
        Text(
            "♪", color = Palette.Gold, fontSize = 64.sp,
            modifier = Modifier.align(Alignment.CenterStart).padding(start = 36.dp).graphicsLayer { translationY = -24f * haut },
        )
        Text(
            "♫", color = Palette.Gold, fontSize = 64.sp,
            modifier = Modifier.align(Alignment.CenterEnd).padding(end = 36.dp).graphicsLayer { translationY = -24f * (1f - haut) },
        )
        Text(
            q.text.uppercase(),
            color = Palette.Ink, fontSize = 96.sp, lineHeight = 104.sp, fontWeight = FontWeight.Black,
            textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 110.dp).apparition(0, q.id),
        )
    }
}

/**
 * Qui suis-je ? : les indices apparaissent un à un au fil du chrono (figés pendant une réponse orale) ;
 * à la révélation, tous les indices et l'émoji du personnage.
 */
@Composable
fun QuiSuisBoard(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    val remaining = chronoRestant(q, state)
    val revealed = state.phase == Phase.REVEAL || state.phase == Phase.SCORES
    val shown = if (revealed || state.phase == Phase.CLOSED) q.cards.size else q.cluesShown(q.durationMs - remaining)
    Column(
        modifier.clip(RoundedCornerShape(28.dp)).background(Color.White.copy(alpha = 0.10f)).padding(horizontal = 28.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Badge("QUI SUIS-JE ?")
            Spacer(Modifier.weight(1f))
            Text(
                if (revealed) q.emoji ?: "⭐" else "?",
                color = Palette.Gold, fontSize = 56.sp, fontWeight = FontWeight.Black,
                modifier = Modifier.apparition(0, revealed),
            )
        }
        q.cards.take(shown).forEachIndexed { i, clue ->
            Row(
                Modifier.fillMaxWidth().apparition(0, "${q.id}-$i"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "${i + 1}", color = Palette.Night, fontSize = 22.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(Palette.Ink).width(40.dp).padding(vertical = 4.dp),
                )
                Spacer(Modifier.width(16.dp))
                Text(
                    clue.word,
                    color = Palette.Ink, fontSize = 30.sp, lineHeight = 36.sp, fontWeight = FontWeight.Bold,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (shown < q.cards.size) {
            Text(
                "Prochain indice dans un instant…",
                color = Palette.InkSoft, fontSize = 20.sp, modifier = Modifier.padding(start = 56.dp),
            )
        }
    }
}
