package com.littlemissparty.quiz.tv

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.MimeCard
import com.littlemissparty.quiz.engine.Scoring
import com.littlemissparty.quiz.tv.habillage.Gerbe
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.Tampon
import com.littlemissparty.quiz.tv.habillage.Tempo
import com.littlemissparty.quiz.tv.habillage.apparition
import com.littlemissparty.quiz.tv.habillage.apres
import com.littlemissparty.quiz.tv.habillage.rebond
import kotlinx.coroutines.delay

/*
 * Manche de mimes sur la TV. L'enfant qui devine tourne le dos à l'écran ; ses coéquipiers voient une très
 * grande image et son mot, et miment. L'écran ne décide rien : il affiche l'état du moteur (équipe qui joue,
 * carte, compteurs, chrono calé sur le serveur). La télécommande reste un secours de la régie.
 */

@Composable
fun MimeScreen(state: UiState.Playing, actions: TvActions) {
    val m = state.mime ?: return
    val team = state.teams.find { it.uid == m.team }
    Box(Modifier.fillMaxSize()) {
        // Halo de la couleur de l'équipe qui joue, qui respire doucement derrière la carte.
        if (team != null) TeamGlow(team.color.toColor())
        Column(Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 24.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "MIMES",
                    color = Palette.Night, fontSize = 20.sp, fontWeight = FontWeight.Black, letterSpacing = 3.sp,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(Neon.Or).padding(horizontal = 16.dp, vertical = 4.dp),
                )
                Spacer(Modifier.width(14.dp))
                Text(
                    state.question?.text.orEmpty(), color = Palette.InkSoft, fontSize = 22.sp, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                if (team != null) MimeCountdown(state)
            }
            Spacer(Modifier.height(8.dp))
            if (team != null) Turn(state, m, team) else BetweenTurns(state, m, Modifier.weight(1f))
            if (team != null) Spacer(Modifier.weight(1f))
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    state.teams.forEach { t -> MimeTeamChip(t, m.counts[t.uid] ?: 0, playing = t.uid == m.team) }
                }
                // En pause, le seul bouton est « Reprendre » sur l'intermède.
                if (!state.paused) MimeButtons(state, m, actions)
            }
        }
        // « TOP DÉPART ! » claque au début de chaque tour, « TEMPS ÉCOULÉ ! » à la fin, calés sur les sifflets.
        Tampon("TOP DÉPART !", cle = "top ${m.team} ${m.turns.size}", actif = team != null)
        Tampon("TEMPS ÉCOULÉ !", cle = "fin ${m.turns.size}", couleur = Neon.Halo, actif = team == null && m.last != null)
    }
}

/** Tour en cours : « Au tour des Licornes ! », la carte en très grand et le compteur de mimes trouvés. */
@Composable
private fun Turn(state: UiState.Playing, m: MimeUi, team: Team) {
    val color = team.color.toColor()
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            "Au tour de ${team.name} !", color = color, fontSize = 28.sp, fontWeight = FontWeight.Black,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(28.dp)) {
            MimeCardView(m, color)
            FoundCounter(m.found)
        }
    }
}

/** Carte qui vient de quitter l'écran : trouvée, elle s'envole en or ; passée, elle file sur le côté. */
private class Sortie(val carte: MimeCard, val trouvee: Boolean)

/**
 * La carte : elle surgit en tournant légèrement à chaque nouveau mot, pendant que la précédente s'envole
 * (trouvée) ou file à gauche (passée). Un tampon « TROUVÉ ! » et une gerbe de confettis saluent chaque mime.
 */
@Composable
private fun MimeCardView(m: MimeUi, color: Color) {
    val card = m.card ?: return
    val pop = remember(card.word, m.found, m.passed) { Animatable(0.6f) }
    LaunchedEffect(card.word, m.found, m.passed) {
        pop.snapTo(0.6f)
        pop.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium))
    }
    var vue by remember { mutableStateOf(Triple(card, m.found, m.passed)) }
    var sortie by remember { mutableStateOf<Sortie?>(null) }
    val depart = remember { Animatable(1f) }
    LaunchedEffect(card.word, m.found, m.passed) {
        val (ancienne, trouves, passes) = vue
        vue = Triple(card, m.found, m.passed)
        if (m.found > trouves || m.passed > passes) {
            sortie = Sortie(ancienne, trouvee = m.found > trouves)
            depart.snapTo(0f)
            depart.animateTo(1f, tween(550, easing = FastOutSlowInEasing))
            sortie = null
        }
    }
    Box(contentAlignment = Alignment.Center) {
        sortie?.let { s ->
            MimeCardFace(
                s.carte, if (s.trouvee) Neon.Or else color,
                Modifier.clearAndSetSemantics {}.graphicsLayer {
                    val v = depart.value
                    alpha = 1f - v
                    if (s.trouvee) {
                        translationY = -260f * v
                        scaleX = 1f + 0.15f * v
                        scaleY = 1f + 0.15f * v
                    } else {
                        translationX = -760f * v
                        rotationZ = -14f * v
                    }
                },
            )
        }
        MimeCardFace(card, color, Modifier.graphicsLayer { scaleX = pop.value; scaleY = pop.value; rotationZ = (1f - pop.value) * -12f })
        Gerbe(cle = m.found, actif = m.found > 0, modifier = Modifier.matchParentSize())
        Tampon("TROUVÉ !", cle = m.found, actif = m.found > 0, tailleSp = 56, dureeMs = 1_000, modifier = Modifier.matchParentSize())
    }
}

/** Face de la carte : verre sombre, liseré néon de la couleur de l'équipe, reflet de cette couleur en haut. */
@Composable
private fun MimeCardFace(card: MimeCard, color: Color, modifier: Modifier) {
    Column(
        modifier
            .width(500.dp)
            .clip(RoundedCornerShape(36.dp))
            .background(Brush.verticalGradient(listOf(color.copy(alpha = 0.30f), Neon.Nuit2.copy(alpha = 0.85f), Neon.Nuit.copy(alpha = 0.9f))))
            .border(4.dp, color, RoundedCornerShape(36.dp))
            .padding(vertical = 12.dp, horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(card.image ?: "🎭", fontSize = 120.sp, lineHeight = 128.sp, textAlign = TextAlign.Center)
        Text(
            card.word, color = Neon.Blanc, fontSize = 42.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
            maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 46.sp,
        )
    }
}

/** Compteur du tour : il rebondit et lâche un « +1 » doré à chaque mime trouvé. */
@Composable
private fun FoundCounter(found: Int) {
    val bump = remember { Animatable(1f) }
    val flyer = remember { Animatable(0f) }
    LaunchedEffect(found) {
        if (found == 0) return@LaunchedEffect
        bump.snapTo(1.5f)
        flyer.snapTo(1f)
        bump.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy))
    }
    LaunchedEffect(found) { if (found > 0) flyer.animateTo(0f, tween(900)) }
    Box(contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("$found", color = Neon.Or, fontSize = 96.sp, fontWeight = FontWeight.Black, modifier = Modifier.scale(bump.value))
            Text(if (found > 1) "trouvés" else "trouvé", color = Palette.InkSoft, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        }
        Text(
            "+1", color = Neon.Or, fontSize = 44.sp, fontWeight = FontWeight.Black,
            modifier = Modifier.alpha(flyer.value).graphicsLayer { translationY = -140f * (1f - flyer.value) },
        )
    }
}

/** Entre deux tours : bilan du tour qui vient de finir, puis qui va mimer. */
@Composable
private fun BetweenTurns(state: UiState.Playing, m: MimeUi, modifier: Modifier) {
    val last = m.last
    val lastTeam = state.teams.find { it.uid == last?.team }
    // Le bilan d'un tour arrive après le tampon « TEMPS ÉCOULÉ ! » ; l'ouverture de la manche, tout de suite.
    val bilan = if (last != null) Tempo.MIME_BILAN else 0L
    Box(modifier.fillMaxWidth()) {
        if (last != null && last.found > 0) Gerbe(cle = m.turns.size, actif = apres(bilan, m.turns.size))
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Text("🎭", fontSize = 90.sp, lineHeight = 96.sp, modifier = Modifier.apparition(bilan, m.turns.size))
            if (last != null && lastTeam != null) {
                Text(
                    if (last.found > 0) "Bravo ${lastTeam.name} !" else "Bien essayé ${lastTeam.name} !",
                    color = lastTeam.color.toColor(), fontSize = 44.sp, lineHeight = 50.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                    modifier = Modifier.apparition(bilan, m.turns.size).rebond(apres(bilan, m.turns.size)),
                )
                Text(
                    "${last.found} mime${if (last.found > 1) "s" else ""} trouvé${if (last.found > 1) "s" else ""} · +${last.found * Scoring.MIME} points",
                    color = Neon.Or, fontSize = 32.sp, lineHeight = 38.sp, fontWeight = FontWeight.Black,
                    modifier = Modifier.apparition(bilan + Tempo.TEMPS, m.turns.size),
                )
            } else {
                Text(
                    "Les Mimes !",
                    maxLines = 1, softWrap = false,
                    style = TextStyle(
                        brush = Brush.verticalGradient(listOf(Neon.OrClair, Neon.Or, Neon.OrProfond)),
                        fontSize = 56.sp, lineHeight = 62.sp, fontWeight = FontWeight.Black, letterSpacing = 2.sp,
                        shadow = Shadow(Neon.Halo.copy(alpha = 0.7f), Offset.Zero, 30f),
                    ),
                    modifier = Modifier.apparition(0, Unit).rebond(true),
                )
            }
            Spacer(Modifier.height(10.dp))
            Text(
                if (m.left == 0) "Toutes les cartes ont été mimées !"
                else "Celui qui devine se met dos à la TV, ses coéquipiers miment sans parler.\nChaque mime trouvé rapporte ${Scoring.MIME} points.",
                color = Palette.Ink, fontSize = 24.sp, textAlign = TextAlign.Center, lineHeight = 32.sp,
            )
        }
    }
}

@Composable
private fun MimeTeamChip(team: Team, count: Int, playing: Boolean) {
    val color = team.color.toColor()
    Column(
        Modifier
            .clip(RoundedCornerShape(16.dp))
            .background(if (playing) color.copy(alpha = 0.45f) else Palette.Panel)
            .border(if (playing) 3.dp else 2.dp, color, RoundedCornerShape(16.dp))
            .padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(team.name, color = Palette.Ink, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        Text(
            "$count mime${if (count > 1) "s" else ""}",
            color = if (count > 0) Neon.Or else Palette.InkSoft, fontSize = 16.sp, fontWeight = FontWeight.Bold,
        )
    }
}

/** Secours à la télécommande : « Trouvé » a toujours le focus pendant un tour, « Top départ » entre deux tours. */
@Composable
private fun MimeButtons(state: UiState.Playing, m: MimeUi, actions: TvActions) {
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
        if (m.team != null) {
            TvButton("Passer", actions.mimePass, fontSize = 20.sp)
            TvButton("Arrêter le tour", actions.mimeStop, fontSize = 20.sp)
            NextButton("Trouvé !", actions.mimeFound, key = "turn-${m.turns.size}")
        } else {
            TvButton("Terminer les mimes", actions.next, fontSize = 20.sp)
            if (m.left > 0) {
                val next = state.teams.minByOrNull { t -> m.turns.count { it == t.uid } }
                NextButton("Top départ : ${next?.name ?: "équipe"}", { actions.mimeStart(next?.uid) }, key = "between-${m.turns.size}")
            }
        }
    }
}

/** Chrono du tour, calé sur l'heure du serveur comme celui des questions. */
@Composable
private fun MimeCountdown(state: UiState.Playing) {
    val total = state.question?.durationMs ?: 1
    var remaining by remember { mutableLongStateOf(state.remainingMs) }
    LaunchedEffect(state.deadline, state.paused) {
        val deadline = state.deadline
        if (deadline == null) {
            remaining = state.remainingMs
            return@LaunchedEffect
        }
        val start = state.resumeAt ?: 0L
        while (true) {
            remaining = (deadline - maxOf(System.currentTimeMillis() + state.serverOffset, start)).coerceAtLeast(0)
            if (remaining == 0L) break
            delay(100)
        }
    }
    val seconds = ((remaining + 999) / 1000).toInt()
    val urgent = seconds <= 10
    val fraction = remaining.toFloat() / total
    // Dix dernières secondes : le chrono bat à chaque seconde, comme la tension sonore.
    val battement = remember { Animatable(1f) }
    LaunchedEffect(seconds) {
        if (!urgent || seconds == 0) return@LaunchedEffect
        battement.snapTo(1.18f)
        battement.animateTo(1f, tween(400))
    }
    Box(
        Modifier.size(84.dp).graphicsLayer { scaleX = battement.value; scaleY = battement.value }.drawBehind {
            val stroke = 9.dp.toPx()
            val box = Size(size.width - stroke, size.height - stroke)
            drawArc(Color.White.copy(alpha = 0.2f), 0f, 360f, false, style = Stroke(stroke), topLeft = Offset(stroke / 2, stroke / 2), size = box)
            drawArc(if (urgent) Neon.Chaud else Neon.Or, -90f, 360f * fraction, false, style = Stroke(stroke), topLeft = Offset(stroke / 2, stroke / 2), size = box)
        },
        contentAlignment = Alignment.Center,
    ) {
        Text("$seconds", color = if (urgent) Neon.Chaud else Palette.Ink, fontSize = 34.sp, fontWeight = FontWeight.Black)
    }
}

/** Halo de la couleur de l'équipe : dessiné une fois, seule son opacité respire (léger pour la box). */
@Composable
private fun TeamGlow(color: Color) {
    val pulse by rememberInfiniteTransition(label = "glow").animateFloat(
        0.55f, 1f, infiniteRepeatable(tween(1400), RepeatMode.Reverse), label = "pulse",
    )
    Box(
        Modifier.fillMaxSize().graphicsLayer { alpha = pulse }.drawWithCache {
            val r = size.minDimension * 0.75f
            val halo = Brush.radialGradient(listOf(color.copy(alpha = 0.45f), Color.Transparent), center = Offset(size.width / 2, size.height / 2), radius = r)
            onDrawBehind { drawCircle(halo, radius = r) }
        },
    )
}
