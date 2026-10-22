package com.littlemissparty.quiz.tv

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.habillage.Couronne
import com.littlemissparty.quiz.tv.habillage.GS
import com.littlemissparty.quiz.tv.habillage.LogoQuiz
import com.littlemissparty.quiz.tv.habillage.PoliceGsChiffres
import com.littlemissparty.quiz.tv.habillage.PoliceGsTexte
import com.littlemissparty.quiz.tv.habillage.Tempo
import com.littlemissparty.quiz.tv.habillage.apparition
import com.littlemissparty.quiz.tv.habillage.apres
import com.littlemissparty.quiz.tv.habillage.rebond
import com.littlemissparty.quiz.tv.habillage.reflet
import com.littlemissparty.quiz.tv.habillage.styleCentre
import com.littlemissparty.quiz.tv.habillage.styleEtiquetteGs
import com.littlemissparty.quiz.tv.habillage.styleTitreNeon
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

/*
 * Écrans du Quiz en design « The Game Show » (kit du 22 octobre) : mêmes données, mêmes moments, mêmes tempos que
 * les écrans classiques de GameScreens.kt ; seule l'apparence change (verre sombre, bords néon, lueurs, chiffres
 * Orbitron). Les lueurs sont des traits arrondis de plus en plus larges et transparents, dessinés une fois.
 */

/**
 * Lueur néon autour d'un cadre arrondi : quatre contours de plus en plus larges et transparents, dessinés derrière le
 * contenu et mis en cache (rien n'est recalculé à chaque image, pas de flou, compatible Mi Box).
 */
fun Modifier.lueurNeon(couleur: Color, rayon: Dp, intensite: Float = 1f): Modifier = composed {
    val r = with(LocalDensity.current) { rayon.toPx() }
    drawWithCache {
        val pas = 3.dp.toPx()
        onDrawBehind {
            for (k in 4 downTo 1) {
                val e = pas * k * 2
                drawRoundRect(
                    couleur.copy(alpha = (0.09f * intensite * (5 - k) / 2f).coerceAtMost(1f)),
                    topLeft = Offset(-e / 2, -e / 2), size = Size(size.width + e, size.height + e),
                    cornerRadius = CornerRadius(r + e / 2), style = Stroke(pas * 2),
                )
            }
        }
    }
}

/** Une proposition A, B, C, D en texte : carte de verre sombre au bord néon de sa couleur, lettre dans un carré néon. */
@Composable
internal fun ChoiceCardGs(i: Int, text: String, correct: Int?, modifier: Modifier, express: Boolean, compacte: Boolean) {
    val isCorrect = correct == i
    val rangMauvaise = if (correct == null) 0 else (0 until i).count { it != correct }
    val eteinte = apres(Tempo.mauvaiseSEteint(rangMauvaise, express), correct, actif = correct != null && !isCorrect)
    val juste = apres(Tempo.revelationOr(express), correct, actif = isCorrect)
    val dim by animateFloatAsState(if (eteinte) 0.3f else 1f, tween(350), label = "dim")
    val color = Palette.Choices[i % Palette.Choices.size]
    val forme = RoundedCornerShape(18.dp)
    val bord = when {
        juste -> GS.Juste
        eteinte -> GS.Faux
        else -> color
    }
    Row(
        modifier
            .rebond(juste)
            .alpha(dim)
            .lueurNeon(bord, 18.dp, if (juste) 1.8f else 0.9f)
            .clip(forme)
            .background(
                if (juste) Brush.verticalGradient(listOf(GS.Juste.copy(alpha = 0.95f), GS.JusteProfond))
                else Brush.horizontalGradient(listOf(color.copy(alpha = 0.2f), GS.Nuit.copy(alpha = 0.9f), GS.Nuit.copy(alpha = 0.9f))),
            )
            .border(if (juste) 4.dp else 2.5.dp, if (juste) Color.White else bord, forme)
            .reflet(juste)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val cote = if (compacte) 40.dp else 50.dp
        Box(
            Modifier.size(cote).clip(RoundedCornerShape(12.dp)).background(if (juste) Color.White else color),
            contentAlignment = Alignment.Center,
        ) {
            Text(Palette.ChoiceLetters[i], style = styleCentre(if (compacte) 20.sp else 25.sp, if (juste) GS.JusteProfond else GS.Noir, FontWeight.Black).copy(fontFamily = PoliceGsChiffres))
        }
        Spacer(Modifier.width(if (compacte) 14.dp else 18.dp))
        Text(
            text, color = if (juste) GS.JusteTexte else GS.Encre, fontSize = if (compacte) 26.sp else 31.sp,
            lineHeight = if (compacte) 28.sp else 33.sp, fontWeight = FontWeight.Bold, fontFamily = PoliceGsTexte,
            maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
        )
        when {
            juste -> Box(
                Modifier.size(if (compacte) 40.dp else 48.dp).apparition(100, Unit).clip(CircleShape).background(Color.White),
                contentAlignment = Alignment.Center,
            ) { Text("✓", style = styleCentre(if (compacte) 27.sp else 32.sp, GS.JusteProfond, FontWeight.Black)) }
            eteinte -> Text("✗", color = GS.Faux, fontSize = 32.sp, fontWeight = FontWeight.Black)
        }
    }
}

/** Pastille d'équipe sous la question (Game Show) : verre sombre bordé de la couleur néon de l'équipe. */
@Composable
internal fun TeamStatusGs(
    team: Team, online: Boolean, answered: Boolean, revealedPoints: Int?, statut: String, compacte: Boolean, modifier: Modifier,
) {
    val color = team.color.toColor()
    val forme = RoundedCornerShape(14.dp)
    val allumee = answered || revealedPoints != null
    Column(
        modifier
            .rebond(revealedPoints != null && revealedPoints > 0, 0.25f)
            .then(if (allumee && online) Modifier.lueurNeon(color, 14.dp, 0.7f) else Modifier)
            .clip(forme)
            .background(if (allumee) color.copy(alpha = 0.26f) else GS.Nuit.copy(alpha = 0.85f))
            .border(2.dp, if (online) color else Color.Gray, forme)
            .padding(horizontal = if (compacte) 8.dp else 12.dp, vertical = 5.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val taille = if (compacte) 15.sp else 17.sp
        Text(team.name, color = GS.Encre, fontSize = taille, fontWeight = FontWeight.Bold, fontFamily = PoliceGsTexte, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
            statut,
            color = if (revealedPoints != null && revealedPoints > 0) GS.Jaune else GS.Encre.copy(alpha = 0.75f),
            fontSize = taille, fontWeight = FontWeight.Bold,
            fontFamily = if (revealedPoints != null) PoliceGsChiffres else PoliceGsTexte,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Chrono (Game Show) : anneau cyan qui se vide, avec sa lueur ; rose dans les 5 dernières secondes. */
@Composable
internal fun CountdownGs(seconds: Int, fraction: Float) {
    val urgent = seconds <= 5
    val couleur = if (urgent) GS.Rose else GS.Cyan
    Box(
        Modifier.size(86.dp).drawBehind {
            val trait = 7.dp.toPx()
            val coin = Offset(trait * 1.5f, trait * 1.5f)
            val taille = Size(size.width - trait * 3, size.height - trait * 3)
            drawCircle(GS.Nuit.copy(alpha = 0.85f), size.minDimension / 2 - trait)
            drawArc(GS.Violet.copy(alpha = 0.3f), 0f, 360f, false, coin, taille, style = Stroke(trait))
            drawArc(couleur.copy(alpha = 0.22f), -90f, 360f * fraction, false, coin, taille, style = Stroke(trait * 2.6f, cap = StrokeCap.Round))
            drawArc(couleur, -90f, 360f * fraction, false, coin, taille, style = Stroke(trait, cap = StrokeCap.Round))
        },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "$seconds",
            style = styleCentre(30.sp, if (urgent) GS.Rose else GS.Encre, FontWeight.Black).copy(
                fontFamily = PoliceGsChiffres, shadow = Shadow(couleur.copy(alpha = 0.8f), Offset.Zero, 18f),
            ),
        )
    }
}

/**
 * Tableau des scores (Game Show) : une jauge verticale néon par équipe, du premier au dernier, qui monte depuis le
 * score d'avant la question sur le compteur sonore ; score en chiffres au-dessus, nom dessous (réduit pour tenir en
 * entier), couronne au premier. De 1 à 8 équipes.
 */
@Composable
internal fun ClassementGameShow(state: UiState.Playing, actions: TvActions) {
    Column(Modifier.fillMaxSize().padding(horizontal = 48.dp, vertical = 22.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text("TABLEAU DES SCORES", style = styleTitreNeon(38.sp, GS.Cyan, TextAlign.Start), maxLines = 1, softWrap = false)
            Spacer(Modifier.width(20.dp))
            Text(
                when {
                    state.mime?.picto == true -> "Après le Pictionary"
                    state.mime != null -> "Après les mimes"
                    else -> "Après ${state.etape ?: "la question ${state.index + 1}"}"
                },
                color = GS.Encre.copy(alpha = 0.75f), fontSize = 20.sp, fontFamily = PoliceGsTexte, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(bottom = 6.dp),
            )
        }
        Spacer(Modifier.height(10.dp))
        Jauges(state, Modifier.weight(1f).fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            LogoQuiz(46.dp)
            Spacer(Modifier.weight(1f))
            if (!state.paused) NextButton(suiteLabel(state), actions.next, key = state.index)
        }
    }
}

@Composable
private fun Jauges(state: UiState.Playing, modifier: Modifier) {
    val ranking = state.ranking
    val best = (ranking.firstOrNull()?.second ?: 0).coerceAtLeast(1)
    val couronne = apres(Tempo.CLASSEMENT_COURONNE, Unit)
    val serre = ranking.size > 5
    BoxWithConstraints(modifier) {
        val colonne = (maxWidth / ranking.size.coerceAtLeast(1)).coerceAtMost(200.dp)
        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.Center) {
            ranking.forEachIndexed { i, (team, score) ->
                val compteur = remember(team.uid) { Animatable((score - (state.lastGain[team.uid] ?: 0)).coerceAtLeast(0).toFloat()) }
                LaunchedEffect(score) {
                    delay(Tempo.CLASSEMENT_COMPTEUR)
                    compteur.animateTo(score.toFloat(), tween(1_500, easing = FastOutSlowInEasing))
                }
                val color = team.color.toColor()
                val gain = state.lastGain[team.uid] ?: 0
                Column(
                    Modifier.width(colonne).fillMaxHeight().padding(horizontal = if (serre) 6.dp else 12.dp).apparition(90L * i, Unit),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    // La couronne du premier tient dans sa propre ligne : rien ne dépasse au-dessus de l'écran.
                    Box(Modifier.height(22.dp), contentAlignment = Alignment.Center) {
                        if (i == 0) Couronne(couronne && score > 0, Modifier.size(30.dp, 20.dp))
                    }
                    Text(
                        "${compteur.value.roundToInt()}", maxLines = 1, softWrap = false,
                        style = TextStyle(
                            fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Black, fontSize = if (serre) 22.sp else 30.sp,
                            color = color, shadow = Shadow(color.copy(alpha = 0.8f), Offset.Zero, 20f), textAlign = TextAlign.Center,
                        ),
                    )
                    Text(
                        if (gain > 0) "+$gain" else " ", maxLines = 1, softWrap = false,
                        style = TextStyle(fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Bold, fontSize = if (serre) 13.sp else 15.sp, color = GS.Jaune),
                    )
                    Spacer(Modifier.height(4.dp))
                    // La jauge : rail de verre bordé de la couleur, remplissage néon qui monte du bas.
                    val forme = RoundedCornerShape(14.dp)
                    Box(
                        Modifier.weight(1f).widthIn(max = 86.dp).fillMaxWidth(if (serre) 0.8f else 0.62f)
                            .lueurNeon(color, 14.dp, 0.6f)
                            .clip(forme).background(GS.Nuit.copy(alpha = 0.85f)).border(2.dp, color.copy(alpha = 0.55f), forme),
                        contentAlignment = Alignment.BottomCenter,
                    ) {
                        val part = (compteur.value / best).coerceIn(0.03f, 1f)
                        Box(
                            Modifier.fillMaxWidth().fillMaxHeight(part).padding(4.dp).clip(RoundedCornerShape(10.dp))
                                .background(Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.9f), color, color.copy(alpha = 0.55f)))),
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                    NomQuiTient(team.name, if (serre) 17.sp else 22.sp, Modifier.fillMaxWidth())
                    Text(
                        if (i == 0) "1er" else "${i + 1}e", maxLines = 1,
                        style = TextStyle(fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Bold, fontSize = if (serre) 12.sp else 14.sp, color = if (i == 0) GS.Jaune else GS.Encre.copy(alpha = 0.6f)),
                    )
                }
            }
        }
    }
}

/** Nom d'équipe sur une ligne, réduit jusqu'à tenir en entier dans la colonne (jamais coupé). */
@Composable
private fun NomQuiTient(nom: String, max: TextUnit, modifier: Modifier) {
    val mesure = rememberTextMeasurer()
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val dispo = constraints.maxWidth
        val taille = remember(nom, dispo, max) {
            var t = max.value
            while (t > 10f && mesure.measure(nom, TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = t.sp), maxLines = 1, softWrap = false).size.width > dispo) t -= 0.5f
            t.sp
        }
        Text(nom, maxLines = 1, softWrap = false, style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = taille, color = GS.Encre, textAlign = TextAlign.Center))
    }
}

/** Étiquette « Question 4 / 10 » du Game Show, en Orbitron cyan. */
@Composable
internal fun EtapeGs(texte: String, modifier: Modifier = Modifier) {
    Text(texte, style = styleEtiquetteGs(17.sp, GS.Cyan, 3.sp), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = modifier)
}
