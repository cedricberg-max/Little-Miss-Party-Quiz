package com.littlemissparty.quiz.tv

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.Tempo
import com.littlemissparty.quiz.tv.habillage.apres
import kotlin.math.abs

/**
 * Le Juste Chiffre sur la TV : pendant la question, chaque équipe tape son nombre sur le pupitre ;
 * à la révélation, le nombre à trouver, puis les nombres des équipes du plus proche au plus loin.
 */
@Composable
fun NumberBoard(state: UiState.Playing, revealed: Boolean, modifier: Modifier = Modifier) {
    if (state.question == null) return
    Column(
        modifier.clip(RoundedCornerShape(28.dp)).background(Palette.Panel).padding(horizontal = 32.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("LE JUSTE CHIFFRE", color = Palette.Gold, fontSize = 24.sp, fontWeight = FontWeight.Black, letterSpacing = 6.sp, maxLines = 1)
        Spacer(Modifier.height(10.dp))
        if (!revealed) {
            Text(
                "Tapez votre nombre sur le pupitre !",
                color = Palette.Ink, fontSize = 34.sp, lineHeight = 40.sp, fontWeight = FontWeight.Bold, maxLines = 2,
            )
            Spacer(Modifier.height(8.dp))
            Text("L'équipe la plus proche gagne.", color = Palette.InkSoft, fontSize = 22.sp, maxLines = 1)
        } else {
            NumberReveal(state)
        }
    }
}

@Composable
private fun NumberReveal(state: UiState.Playing) {
    val q = state.question ?: return
    // Le nombre arrive avec l'or de la révélation, puis le classement des écarts.
    val visible = apres(Tempo.REVELATION_OR, q.id)
    val pop = remember(q.id) { Animatable(0.5f) }
    LaunchedEffect(q.id, visible) {
        if (visible) pop.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow))
    }
    Text(
        if (visible) "${q.correct}" else "?",
        color = Neon.Or, fontSize = 72.sp, lineHeight = 78.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
        modifier = Modifier.graphicsLayer { scaleX = pop.value; scaleY = pop.value },
    )
    Spacer(Modifier.height(10.dp))
    val rows = state.teams.mapNotNull { team -> state.awards[team.uid]?.let { team to it } }
        .sortedBy { (_, a) -> abs((a.choice ?: 0).toLong() - q.correct.toLong()) }
    if (rows.isEmpty()) {
        Text("Aucune équipe n'a répondu.", color = Palette.InkSoft, fontSize = 22.sp)
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        // Les trois plus proches (le bandeau du bas montre le nombre de chaque équipe) : tient sur un écran 720p.
        rows.take(3).forEach { (team, a) ->
            val gap = abs((a.choice ?: 0).toLong() - q.correct.toLong())
            Row(
                Modifier
                    .fillMaxWidth(0.8f)
                    .clip(RoundedCornerShape(50))
                    .background(if (visible && a.points > 0) Neon.Or.copy(alpha = 0.35f) else Palette.Panel)
                    .border(2.dp, team.color.toColor(), RoundedCornerShape(50))
                    .padding(horizontal = 18.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(18.dp).clip(CircleShape).background(team.color.toColor()))
                Spacer(Modifier.width(10.dp))
                Text(team.name, color = Palette.Ink, fontSize = 20.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text("${a.choice ?: "–"}", color = Palette.Ink, fontSize = 22.sp, fontWeight = FontWeight.Black, maxLines = 1)
                Spacer(Modifier.width(12.dp))
                Text(
                    when {
                        !visible -> ""
                        gap == 0L -> "pile !"
                        else -> "écart $gap"
                    },
                    color = if (visible && a.points > 0) Palette.Gold else Palette.InkSoft, fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1,
                )
            }
        }
    }
}
