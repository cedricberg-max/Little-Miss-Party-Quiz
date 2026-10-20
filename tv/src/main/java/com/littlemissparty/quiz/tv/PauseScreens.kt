package com.littlemissparty.quiz.tv

import androidx.compose.animation.AnimatedContent
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
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.PAUSE_NETWORK
import com.littlemissparty.quiz.engine.PAUSE_TEAM
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.tv.habillage.Echelle
import com.littlemissparty.quiz.tv.habillage.LogoLmp
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.styleCentre
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import com.littlemissparty.quiz.tv.habillage.PoliceLmp

/**
 * Pause générale et décompte de reprise, par-dessus toutes les étapes de la partie.
 * L'intermède ne parle jamais de panne : même une pause automatique (pupitre déconnecté)
 * reste un moment de l'émission.
 */
@Composable
fun PauseLayer(state: UiState.Playing, onResume: () -> Unit) {
    // Les défis de la régie sont gardés en copie sur la box dès le début de la partie, prêts même sans Internet.
    LaunchedEffect(Unit) { DefisPause.suivre() }
    AnimatedVisibility(state.paused, enter = fadeIn(tween(500)), exit = fadeOut(tween(400))) {
        Intermission(state, onResume)
    }
    if (!state.paused) ResumeCountdown(state)
}

/**
 * Intermède « PAUSE FUN ! » : faisceaux qui tournent, halo qui respire, confettis qui tombent, titre qui ondule.
 * Un défi pour la salle est toujours affiché (modifiables dans la régie, onglet « Défis ») : l'attente reste un jeu.
 */
@Composable
private fun Intermission(state: UiState.Playing, onResume: () -> Unit) {
    val t = rememberInfiniteTransition(label = "intermede")
    val turn by t.animateFloat(0f, 360f, infiniteRepeatable(tween(24_000, easing = LinearEasing)), label = "turn")
    val breath by t.animateFloat(0.55f, 1f, infiniteRepeatable(tween(3_000, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "breath")
    val twinkle by t.animateFloat(0f, (2 * PI).toFloat(), infiniteRepeatable(tween(4_000, easing = LinearEasing)), label = "twinkle")
    val chute = t.animateFloat(0f, 1f, infiniteRepeatable(tween(14_000, easing = LinearEasing)), label = "chute")
    val vague = t.animateFloat(0f, (2 * PI).toFloat(), infiniteRepeatable(tween(2_400, easing = LinearEasing)), label = "vague")
    Box(Modifier.fillMaxSize().background(Neon.Fond.copy(alpha = 0.94f)), contentAlignment = Alignment.Center) {
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
        // 3. Étoiles scintillantes sur les bords (✦, plus de « + » : demande de cedric), chacune à son rythme.
        Sparkles { twinkle }
        // 4. Confettis qui tombent doucement, en boucle : la pause peut durer, l'écran reste vivant.
        Paillettes { chute.value }
        // Dessiné pour 960 × 560 et réduit si besoin : le bouton « Reprendre » reste toujours à l'écran.
        Echelle(960.dp, 560.dp) {
            Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                LogoLmp(54.dp)
                Spacer(Modifier.height(12.dp))
                TitreOndule(TITRE_PAUSE.uppercase(), { vague.value }, Modifier.graphicsLayer { val s = 0.97f + 0.03f * breath; scaleX = s; scaleY = s })
                Spacer(Modifier.height(16.dp))
                Text(
                    when {
                        state.pauseReason == PAUSE_TEAM -> "Petite pause : on attend une équipe, gardez le rythme !"
                        state.pauseReason == PAUSE_NETWORK -> "Petite pause : on attend le retour d'Internet, gardez le rythme !"
                        state.childName.isNotBlank() -> "${state.childName} et ses invités reprennent leur souffle… la fête revient très vite !"
                        else -> "On reprend son souffle… la fête revient très vite !"
                    },
                    color = Palette.Ink, fontSize = 30.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 48.dp),
                )
                if (state.phase == Phase.QUESTION) {
                    Spacer(Modifier.height(10.dp))
                    Text("Le chrono est arrêté", color = Palette.InkSoft, fontSize = 22.sp)
                }
                Spacer(Modifier.height(24.dp))
                DefiPause(state.childName)
                Spacer(Modifier.height(24.dp))
                // Secours à la télécommande ; avec la régie, c'est l'animatrice qui relance depuis son téléphone.
                NextButton("Reprendre", onResume, key = "pause")
            }
        }
    }
}

/** Titre dont les lettres ondulent l'une après l'autre ; seul le calque de chaque lettre bouge. */
@Composable
private fun TitreOndule(texte: String, phase: () -> Float, modifier: Modifier = Modifier) {
    val style = TextStyle(
        fontFamily = PoliceLmp, color = Palette.Gold, fontSize = 72.sp, lineHeight = 80.sp, fontWeight = FontWeight.Black,
        shadow = Shadow(Palette.Gold.copy(alpha = 0.8f), blurRadius = 28f),
    )
    Row(modifier.clearAndSetSemantics { text = AnnotatedString(texte) }) {
        texte.forEachIndexed { i, c ->
            Text(
                c.toString(), style = style, maxLines = 1, softWrap = false,
                modifier = Modifier.graphicsLayer { translationY = sin(phase() - i * 0.45f) * 7.dp.toPx() },
            )
        }
    }
}

/**
 * Petits défis pour la salle, quand la pause se prolonge : un toutes les quelques secondes,
 * jamais tout de suite (une pause courte reste une simple respiration).
 */
@Composable
private fun DefiPause(prenom: String) {
    // Toujours un défi à l'écran, dès le début de la pause, puis un nouveau toutes les 8 secondes.
    val enregistres by DefisPause.enregistres
    val defis = remember(prenom, enregistres) { defisPour(prenom, enregistres) }
    var k by remember { mutableIntStateOf(0) }
    LaunchedEffect(defis) {
        while (true) {
            delay(DEFI_DUREE_MS)
            k++
        }
    }
    Box(Modifier.height(96.dp).padding(horizontal = 40.dp), contentAlignment = Alignment.Center) {
        AnimatedContent(
            k,
            transitionSpec = { (fadeIn(tween(500)) + slideInVertically(tween(500)) { it / 2 }) togetherWith fadeOut(tween(300)) },
            label = "defi",
        ) { n ->
            Row(
                Modifier.background(Neon.Halo.copy(alpha = 0.16f), RoundedCornerShape(32.dp)).padding(horizontal = 28.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("DÉFI PAUSE", color = Palette.Gold, fontSize = 18.sp, fontWeight = FontWeight.Black, letterSpacing = 4.sp)
                Spacer(Modifier.size(16.dp))
                Text(
                    defis[n % defis.size], color = Palette.Ink, fontSize = 26.sp, lineHeight = 30.sp, fontWeight = FontWeight.Bold,
                    maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                )
            }
        }
    }
}

/** Confettis multicolores qui tombent en tournoyant ; une quarantaine de petits rectangles. */
@Composable
private fun Paillettes(phase: () -> Float) {
    Canvas(Modifier.fillMaxSize().clearAndSetSemantics {}) {
        val p = phase()
        val w = size.width
        val h = size.height
        val l = size.minDimension * 0.014f
        PAILLETTES.forEachIndexed { i, (x0, v, d) ->
            val y = ((p * v + d) % 1f) * (h + 4 * l) - 2 * l
            val x = w * x0 + sin(p * 2 * PI.toFloat() * v + i) * w * 0.015f
            val tour = sin(p * 2 * PI.toFloat() * (2 + i % 3) + i)
            val couleur = CONFETTIS[i % CONFETTIS.size]
            rotate(i * 37f + p * 360f * (1 + i % 2), Offset(x, y)) {
                drawRect(
                    couleur.copy(alpha = 0.35f + 0.45f * kotlin.math.abs(tour)),
                    topLeft = Offset(x - l / 2, y - l * kotlin.math.abs(tour) / 4),
                    size = Size(l, (l / 2) * kotlin.math.abs(tour) + 1f),
                )
            }
        }
    }
}

@Composable
private fun Sparkles(phase: () -> Float) {
    Canvas(Modifier.fillMaxSize()) {
        SPARKS.forEachIndexed { i, (fx, fy) ->
            // Chaque étoile s'allume d'un coup puis s'éteint doucement, à son rythme : un vrai scintillement, pas un « + ».
            val onde = 0.5f + 0.5f * sin(phase() * (1 + i % 3) + i * 1.7f)
            val eclat = onde * onde * onde
            val cx = size.width * fx
            val cy = size.height * fy
            val r = size.minDimension * (0.016f + 0.007f * (i % 3)) * (0.55f + 0.45f * eclat)
            val color = if (i % 3 == 0) Palette.Gold else Color.White
            val centre = Offset(cx, cy)
            drawCircle(
                Brush.radialGradient(listOf(color.copy(alpha = 0.45f * eclat), Color.Transparent), centre, r * 1.6f),
                radius = r * 1.6f, center = centre,
            )
            rotate(i * 11f, centre) { drawPath(etoile(cx, cy, r), color.copy(alpha = 0.25f + 0.75f * eclat)) }
        }
    }
}

/** Étoile scintillante à quatre branches fines (✦) : pointes longues, cœur étroit. */
private fun etoile(cx: Float, cy: Float, r: Float) = Path().apply {
    val creux = r * 0.18f
    moveTo(cx, cy - r)
    quadraticBezierTo(cx + creux, cy - creux, cx + r, cy)
    quadraticBezierTo(cx + creux, cy + creux, cx, cy + r)
    quadraticBezierTo(cx - creux, cy + creux, cx - r, cy)
    quadraticBezierTo(cx - creux, cy - creux, cx, cy - r)
    close()
}

/**
 * Décompte 3, 2, 1 calé sur l'heure du serveur : la TV et les pupitres reprennent au même instant,
 * et le chrono de la question repart quand il se termine.
 */
@Composable
private fun ResumeCountdown(state: UiState.Playing) {
    val resumeAt = state.resumeAt ?: return
    // Avant les dernières questions multipliées, c'est l'annonce « × N » qui occupe l'écran, pas le 3, 2, 1.
    if (resumeAt == state.introUntil) return
    // Départ du Gonfleur fou : la TV montre son propre 3, 2, 1… « GONFLEZ ! ».
    if (resumeAt == state.pumpGoAt) return
    // Mèche de la patate chaude qui s'allume : la scène de la bombe occupe l'écran.
    if (state.potato?.let { it.passes == 0 && resumeAt == it.since } == true) return
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
    Box(Modifier.fillMaxSize().background(Neon.Fond.copy(alpha = 0.7f)), contentAlignment = Alignment.Center) {
        // Anneau doré qui se resserre sur chaque chiffre, comme un projecteur qui fait le point.
        Canvas(
            Modifier.size(300.dp).graphicsLayer {
                val s = 0.55f + 0.45f * pop.value
                scaleX = s; scaleY = s; alpha = (1.9f - pop.value).coerceIn(0f, 1f)
            },
        ) {
            drawCircle(Palette.Gold.copy(alpha = 0.55f), radius = size.minDimension / 2 - 6f, style = Stroke(width = 6f))
        }
        // Le chiffre seul au centre de l'anneau, centré au pixel (styleCentre) ; la phrase passe sous l'anneau.
        Text(
            "$shown",
            style = styleCentre(200.sp, Palette.Gold, FontWeight.Black).copy(shadow = Shadow(Palette.Gold.copy(alpha = 0.9f), blurRadius = 40f)),
            modifier = Modifier.graphicsLayer { scaleX = pop.value; scaleY = pop.value; alpha = (2.2f - pop.value).coerceIn(0f, 1f) },
        )
        Text(
            "C'est reparti !", color = Palette.Ink, fontSize = 34.sp, fontWeight = FontWeight.Black,
            modifier = Modifier.align(Alignment.Center).offset(y = 185.dp),
        )
    }
}

private fun secondsBefore(at: Long, offset: Long): Int {
    val ms = at - (System.currentTimeMillis() + offset)
    return if (ms <= 0) 0 else ((ms + 999) / 1000).toInt().coerceAtMost(9)
}

private val NeonHalo = Color(0xFFF888B3)

// Texte de la pause ; la TV l'affiche en majuscules (« PAUSE FUN ! », maquette validée le 19 octobre).
private const val TITRE_PAUSE = "Pause fun !"
/** Couleurs des confettis de la pause : celles des équipes, l'or et le blanc. */
private val CONFETTIS = listOf(Palette.Gold, Color(0xFF7CFF3A), Color(0xFFFF2D8A), Color(0xFF3A86FF), Color(0xFFFFE61F), Color(0xFFFF5A1F), Color.White, Color(0xFF9EF01A))
private const val DEFI_DUREE_MS = 8_000L

/** Paillettes : position horizontale, vitesse de chute (tours par cycle), décalage de départ. */
private val PAILLETTES = List(40) { i ->
    Triple(((i * 0.618034f) % 1f) * 0.96f + 0.02f, 1f + (i % 3), (i * 0.37f) % 1f)
}

/** Positions des étincelles, sur les bords pour ne jamais passer derrière le message. */
private val SPARKS = listOf(
    0.06f to 0.12f, 0.18f to 0.28f, 0.09f to 0.55f, 0.15f to 0.84f, 0.30f to 0.08f, 0.70f to 0.10f,
    0.86f to 0.22f, 0.93f to 0.48f, 0.82f to 0.78f, 0.94f to 0.90f, 0.40f to 0.93f, 0.62f to 0.91f,
)
