package com.littlemissparty.quiz.tv

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.tv.habillage.Confettis
import com.littlemissparty.quiz.tv.habillage.Couronne
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.Tempo
import com.littlemissparty.quiz.tv.habillage.apparition
import com.littlemissparty.quiz.tv.habillage.apres
import com.littlemissparty.quiz.tv.habillage.rebond
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

/** Question, question fermée et révélation : le même plateau, qui évolue. */
@Composable
fun QuestionScreen(state: UiState.Playing, actions: TvActions) {
    val q = state.question ?: return
    val revealed = state.phase == Phase.REVEAL
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 24.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Question ${state.index + 1} / ${state.total}",
                    color = Palette.InkSoft, fontSize = 22.sp, fontWeight = FontWeight.Bold,
                )
                if (q.isExpress) {
                    Spacer(Modifier.width(16.dp))
                    Text(
                        "VRAI OU FAUX EXPRESS",
                        color = Palette.Night, fontSize = 18.sp, fontWeight = FontWeight.Black,
                        modifier = Modifier.clip(RoundedCornerShape(50)).background(Palette.Ink).padding(horizontal = 14.dp, vertical = 4.dp),
                    )
                }
                if (q.double) {
                    Spacer(Modifier.width(16.dp))
                    Text(
                        "SUPER FINALE · POINTS ×2",
                        color = Palette.Night, fontSize = 18.sp, fontWeight = FontWeight.Black,
                        modifier = Modifier.clip(RoundedCornerShape(50)).background(Palette.Gold).padding(horizontal = 14.dp, vertical = 4.dp),
                    )
                }
                Spacer(Modifier.weight(1f))
                when (state.phase) {
                    Phase.QUESTION -> Countdown(state)
                    Phase.CLOSED -> Text(
                        if (state.answered.size >= state.teams.size && state.teams.isNotEmpty()) "Toutes les équipes ont répondu !" else "Temps écoulé !",
                        color = Palette.Gold, fontSize = 26.sp, fontWeight = FontWeight.Black,
                    )
                    else -> {}
                }
            }
            Spacer(Modifier.height(12.dp))
            Text(
                q.text,
                color = Palette.Ink, fontSize = 34.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                lineHeight = 40.sp, maxLines = 3, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth().apparition(0, state.index),
            )
            Spacer(Modifier.height(20.dp))
            // Chaque question a ses propres cartes : elles surgissent une à une, sur les bulles sonores.
            key(state.index) {
                // Révélation : l'illustration facultative (photo ou émoji) apparaît à gauche des propositions.
                Row(Modifier.weight(1f)) {
                    // Zoom mystère : la photo est la question, elle se dévoile pendant tout le chrono.
                    if (q.isFlou) {
                        // Image floue : la photo est la question, réponse à voix haute après un buzz.
                        FlouPhoto(q, state, Modifier.fillMaxHeight().aspectRatio(4f / 3f, matchHeightConstraintsFirst = true))
                        Spacer(Modifier.width(20.dp))
                    } else if (q.isChante) {
                        ChanteBoard(q, state, Modifier.weight(1.4f).fillMaxHeight())
                        Spacer(Modifier.width(20.dp))
                    } else if (q.isQuiSuis) {
                        QuiSuisBoard(q, state, Modifier.weight(1.4f).fillMaxHeight())
                        Spacer(Modifier.width(20.dp))
                    } else if (q.isZoom) {
                        ZoomPhoto(q, state, Modifier.fillMaxHeight().aspectRatio(4f / 3f, matchHeightConstraintsFirst = true))
                        Spacer(Modifier.width(20.dp))
                    } else if (revealed && hasIllustration(q, state)) {
                        val photo = q.imageId != null && state.images[q.imageId] != null
                        Illustration(q, state, Modifier.fillMaxHeight().aspectRatio(if (photo) 4f / 3f else 1f, matchHeightConstraintsFirst = true))
                        Spacer(Modifier.width(20.dp))
                    }
                    if (q.isBuzz) FlouPanel(q, state, Modifier.weight(1f).fillMaxHeight())
                    else if (q.isNumber) NumberBoard(state, revealed, Modifier.weight(1f).fillMaxHeight())
                    else ChoiceGrid(q.choices, correct = if (revealed) q.correct else null, Modifier.weight(1f).fillMaxHeight(), express = q.isExpress)
                }
            }
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    val gagnants = state.teams.filter { (state.awards[it.uid]?.points ?: 0) > 0 }
                    state.teams.forEach { team ->
                        TeamStatus(
                            rangGagnant = gagnants.indexOf(team),
                            team = team,
                            online = team.uid in state.online,
                            answered = team.uid in state.answered,
                            points = if (revealed) state.awards[team.uid]?.points ?: 0 else null,
                            choice = if (revealed) state.awards[team.uid]?.choice else null,
                            isNumber = q.isNumber,
                            express = q.isExpress,
                        )
                    }
                }
                // En pause, le seul bouton est « Reprendre » sur l'intermède.
                if (!state.paused) when (state.phase) {
                    // Jeux au buzzer : l'animatrice juge la réponse orale (la régie a les mêmes boutons).
                    Phase.QUESTION -> if (q.isBuzz && state.buzzTeam != null) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            TvButton("Mauvaise réponse", { actions.judgeBuzz(false) }, fontSize = 24.sp)
                            NextButton("Bonne réponse", { actions.judgeBuzz(true) }, key = state.buzzTeam)
                        }
                    } else NextButton("Arrêter le chrono", actions.next, key = state.phase)
                    Phase.CLOSED -> NextButton("Révéler la réponse", actions.next, key = state.phase)
                    // Vrai ou Faux express : la TV enchaîne seule ; le bouton ne fait qu'aller plus vite.
                    else -> NextButton(if (q.isExpress) "Suivant" else "Voir les scores", actions.next, key = state.phase)
                }
            }
        }
    }
}

@Composable
private fun ChoiceGrid(choices: List<String>, correct: Int?, modifier: Modifier, express: Boolean = false) {
    val rows = choices.indices.chunked(2)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        rows.forEach { row ->
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                row.forEach { i -> ChoiceCard(i, choices[i], correct, Modifier.weight(1f).fillMaxHeight().apparition(Tempo.propositionApparait(i), Unit), express) }
            }
        }
    }
}

@Composable
private fun ChoiceCard(i: Int, text: String, correct: Int?, modifier: Modifier, express: Boolean = false) {
    val isCorrect = correct == i
    // Révélation au rythme du roulement : les mauvaises s'éteignent une à une, puis la bonne passe à l'or.
    val rangMauvaise = if (correct == null) 0 else (0 until i).count { it != correct }
    val eteinte = apres(Tempo.mauvaiseSEteint(rangMauvaise, express), correct, actif = correct != null && !isCorrect)
    val enOr = apres(Tempo.revelationOr(express), correct, actif = isCorrect)
    val dim by animateFloatAsState(if (eteinte) 0.3f else 1f, tween(350), label = "dim")
    val color = Palette.Choices[i % Palette.Choices.size]
    Row(
        modifier
            .rebond(enOr)
            .alpha(dim)
            .clip(RoundedCornerShape(24.dp))
            .background(Palette.Panel)
            .then(if (enOr) Modifier.background(Brush.verticalGradient(listOf(Neon.OrClair.copy(alpha = 0.6f), Neon.OrProfond.copy(alpha = 0.35f)))) else Modifier)
            .border(if (enOr) 5.dp else 3.dp, if (enOr) Neon.Or else color, RoundedCornerShape(24.dp))
            .padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(52.dp).clip(CircleShape).background(color), contentAlignment = Alignment.Center) {
            Text(Palette.ChoiceLetters[i], color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Black)
        }
        Spacer(Modifier.width(18.dp))
        Text(
            text, color = Palette.Ink, fontSize = 28.sp, fontWeight = FontWeight.Bold,
            maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
        )
        if (enOr) Text("✓", color = Color.White, fontSize = 40.sp, fontWeight = FontWeight.Black)
    }
}

/** Pastille d'équipe sous la question : a répondu (sans dire quoi), puis points gagnés à la révélation. */
@Composable
private fun TeamStatus(rangGagnant: Int, team: Team, online: Boolean, answered: Boolean, points: Int?, choice: Int?, isNumber: Boolean = false, express: Boolean = false) {
    val color = team.color.toColor()
    // Les points tombent comme des tampons, une équipe gagnante après l'autre, juste après la bonne réponse.
    val delai = if (rangGagnant >= 0) Tempo.tampon(rangGagnant, express) else Tempo.revelationOr(express)
    val montre = apres(delai, points != null, actif = points != null)
    val revealedPoints = points.takeIf { montre }
    Column(
        Modifier
            .rebond(revealedPoints != null && revealedPoints > 0, 0.25f)
            .clip(RoundedCornerShape(16.dp))
            .background(if (answered || revealedPoints != null) color.copy(alpha = 0.35f) else Palette.Panel)
            .border(2.dp, if (online) color else Color.Gray, RoundedCornerShape(16.dp))
            .padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(team.name, color = Palette.Ink, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        Text(
            when {
                revealedPoints != null -> (if (revealedPoints > 0) "+$revealedPoints" else "0") +
                    (choice?.let { " · ${if (isNumber) "$it" else Palette.ChoiceLetters.getOrElse(it) { "?" }}" } ?: " · –")
                !online -> "hors ligne"
                answered -> "a répondu ✓"
                else -> "…"
            },
            color = if (revealedPoints != null && revealedPoints > 0) Palette.Gold else Palette.InkSoft,
            fontSize = 16.sp, fontWeight = FontWeight.Bold,
        )
    }
}

/** Chrono calé sur l'heure du serveur : le même temps restant sur la TV et sur les pupitres. */
@Composable
private fun Countdown(state: UiState.Playing) {
    val total = state.question?.durationMs ?: 1
    var remaining by remember { mutableLongStateOf(state.remainingMs) }
    LaunchedEffect(state.deadline, state.paused) {
        val deadline = state.deadline
        if (deadline == null) {
            remaining = state.remainingMs
            return@LaunchedEffect
        }
        // Pendant le décompte 3, 2, 1 de la reprise, le chrono reste figé.
        val start = state.resumeAt ?: 0L
        while (true) {
            remaining = (deadline - maxOf(System.currentTimeMillis() + state.serverOffset, start)).coerceAtLeast(0)
            if (remaining == 0L) break
            delay(100)
        }
    }
    val seconds = ((remaining + 999) / 1000).toInt()
    val urgent = seconds <= 5
    val fraction = remaining.toFloat() / total
    Box(
        Modifier.size(84.dp).drawBehind {
            val stroke = 8.dp.toPx()
            drawArc(Color.White.copy(alpha = 0.2f), 0f, 360f, false, style = Stroke(stroke), topLeft = Offset(stroke / 2, stroke / 2), size = Size(size.width - stroke, size.height - stroke))
            drawArc(if (urgent) Color(0xFFFF4D6D) else Palette.Gold, -90f, 360f * fraction, false, style = Stroke(stroke), topLeft = Offset(stroke / 2, stroke / 2), size = Size(size.width - stroke, size.height - stroke))
        },
        contentAlignment = Alignment.Center,
    ) {
        Text("$seconds", color = if (urgent) Color(0xFFFF4D6D) else Palette.Ink, fontSize = 34.sp, fontWeight = FontWeight.Black)
    }
}

@Composable
fun ScoresScreen(state: UiState.Playing, actions: TvActions) {
    Column(Modifier.fillMaxSize().padding(horizontal = 56.dp, vertical = 28.dp)) {
        Text("Classement", color = Palette.Ink, fontSize = 40.sp, fontWeight = FontWeight.Black)
        Text(
            if (state.mime != null) "Après les mimes" else "Après la question ${state.index + 1} / ${state.total}",
            color = Palette.InkSoft, fontSize = 20.sp,
        )
        Spacer(Modifier.height(16.dp))
        Ranking(state, Modifier.weight(1f))
        Row {
            Spacer(Modifier.weight(1f))
            if (!state.paused) NextButton(if (state.isLast) "Résultats finaux" else "Question suivante", actions.next, key = state.index)
        }
    }
}

@Composable
fun FinalScreen(state: UiState.Playing, actions: TvActions) {
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(horizontal = 56.dp, vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Bravo à toutes les équipes !", color = Palette.Gold, fontSize = 44.sp, fontWeight = FontWeight.Black)
            state.ranking.firstOrNull()?.let { (team, _) ->
                // Le nom du vainqueur s'allume en néon sur l'impact de la fanfare.
                Text(
                    "Victoire de ${team.name}",
                    style = TextStyle(
                        color = team.color.toColor(), fontSize = 36.sp, lineHeight = 40.sp, fontWeight = FontWeight.Black,
                        shadow = Shadow(team.color.toColor(), blurRadius = 30f),
                    ),
                    modifier = Modifier.apparition(Tempo.FIN_VAINQUEUR, Unit).rebond(apres(Tempo.FIN_VAINQUEUR + 300, Unit), 0.15f),
                )
            }
            Spacer(Modifier.height(16.dp))
            Ranking(state, Modifier.weight(1f))
        }
        Confettis(Tempo.FIN_VAINQUEUR)
    }
}

@Composable
private fun Ranking(state: UiState.Playing, modifier: Modifier) {
    val ranking = state.ranking
    val best = (ranking.firstOrNull()?.second ?: 0).coerceAtLeast(1)
    val couronne = apres(Tempo.CLASSEMENT_COURONNE, Unit)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ranking.forEachIndexed { i, (team, score) ->
            // Les scores montent depuis ceux d'avant la question, sur le compteur sonore.
            val compteur = remember(team.uid) { Animatable((score - (state.lastGain[team.uid] ?: 0)).coerceAtLeast(0).toFloat()) }
            LaunchedEffect(score) {
                delay(Tempo.CLASSEMENT_COMPTEUR)
                compteur.animateTo(score.toFloat(), tween(1_500, easing = FastOutSlowInEasing))
            }
            val shown = compteur.value.roundToInt()
            val width = compteur.value / best
            val color = team.color.toColor()
            Row(
                Modifier.weight(1f, fill = false).height(48.dp).apparition(90L * i, Unit)
                    .then(if (i == 0 && score > 0) Modifier.clip(RoundedCornerShape(24.dp)).background(Brush.horizontalGradient(listOf(Neon.Or.copy(alpha = 0.22f), Color.Transparent))) else Modifier),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // La couronne se pose à côté du rang, dans la ligne : rien ne dépasse du cadre, même en 1080p.
                Row(Modifier.width(66.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${i + 1}", color = if (i == 0) Palette.Gold else Palette.Ink, fontSize = 30.sp, fontWeight = FontWeight.Black)
                    if (i == 0) Couronne(couronne && score > 0, Modifier.padding(start = 6.dp).size(26.dp, 18.dp))
                }
                Box(Modifier.size(22.dp).clip(CircleShape).background(color))
                Spacer(Modifier.width(12.dp))
                Text(team.name, color = Palette.Ink, fontSize = 26.sp, fontWeight = FontWeight.Bold, maxLines = 1, modifier = Modifier.width(240.dp))
                Box(Modifier.weight(1f).height(26.dp).clip(RoundedCornerShape(13.dp)).background(Palette.Panel)) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(width.coerceIn(0.02f, 1f)).clip(RoundedCornerShape(13.dp)).background(Brush.horizontalGradient(listOf(color.copy(alpha = 0.35f), color))))
                }
                Spacer(Modifier.width(16.dp))
                Text("$shown", color = Palette.Ink, fontSize = 30.sp, fontWeight = FontWeight.Black, modifier = Modifier.width(90.dp), textAlign = TextAlign.End)
                val gain = state.lastGain[team.uid] ?: 0
                Text(if (gain > 0) "+$gain" else "", color = Palette.Gold, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(70.dp), textAlign = TextAlign.End)
            }
        }
    }
}
