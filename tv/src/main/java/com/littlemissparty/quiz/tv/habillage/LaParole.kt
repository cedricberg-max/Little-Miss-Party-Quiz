package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** Annonce « La parole est à… » : arrivée au centre, tenue, puis glissement en bandeau en haut de l'écran. */
const val PAROLE_ENTREE_MS = 420L
const val PAROLE_CENTRE_MS = 1_700L
const val PAROLE_GLISSE_MS = 520L
private const val PAROLE_SORTIE_MS = 260

/** Où en est l'annonce [ms] après le buzz : 0 au centre, 1 en bandeau en haut. Une box qui se reconnecte passe directement en bandeau. */
fun glissementParole(ms: Long): Float =
    ((ms - PAROLE_CENTRE_MS).toFloat() / PAROLE_GLISSE_MS).coerceIn(0f, 1f).let { 1f - (1f - it) * (1f - it) }

/**
 * Jeux au buzzer : l'équipe qui a buzzé et qui a la parole, en grand, pour que toute la salle le voie.
 * Elle arrive au centre de l'écran dans sa couleur, avec un éclat de lumière, puis se range en bandeau en haut
 * tant que [visible] : l'image, le mot ou la chanson restent visibles pendant que l'équipe répond.
 * [dejaMs] : temps déjà écoulé depuis le buzz (box qui se reconnecte : l'annonce ne se rejoue pas au centre).
 * N'affiche que ce qu'on lui donne et ne joue aucun son (le buzz a déjà le sien) ; ne prend jamais le focus.
 * Une seule équipe à la fois : tient de 1 à 8 équipes ; un nom long se réduit pour tenir sur une ligne.
 */
@Composable
fun LaParole(nom: String, couleur: Color, visible: Boolean, modifier: Modifier = Modifier, dejaMs: Long = 0L) {
    val t = remember(nom) { Animatable(dejaMs.toFloat().coerceAtLeast(0f)) }
    val presence = remember { Animatable(0f) }
    LaunchedEffect(visible, nom) {
        if (visible) {
            presence.snapTo(1f)
            val fin = (PAROLE_CENTRE_MS + PAROLE_GLISSE_MS).toFloat()
            if (t.value < fin) t.animateTo(fin, tween((fin - t.value).toInt().coerceAtLeast(1), easing = LinearEasing))
        } else {
            presence.animateTo(0f, tween(PAROLE_SORTIE_MS))
        }
    }
    if (!visible && presence.value == 0f) return
    val boucle = rememberInfiniteTransition(label = "parole")
    val pouls by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(1_100, easing = LinearEasing), RepeatMode.Restart), label = "pouls")

    Box(modifier.fillMaxSize().clearAndSetSemantics {}) {
        // Voile pendant l'annonce au centre ; il s'efface quand le nom part en bandeau.
        Box(
            Modifier.fillMaxSize().graphicsLayer {
                val ms = t.value
                alpha = presence.value * 0.6f * (ms / PAROLE_ENTREE_MS).coerceIn(0f, 1f) * (1f - glissementParole(ms.toLong()))
            }.background(Brush.radialGradient(listOf(couleur.copy(alpha = 0.35f), Neon.Nuit.copy(alpha = 0.92f)))),
        )
        Echelle(960.dp, 540.dp) {
            if (Look.gs) {
                // Game Show (proposition D) : lasers, anneau et « STOP ! » au centre ; tout s'éteint quand le nom part en bandeau.
                val scene = { presence.value * (1f - glissementParole(t.value.toLong())) }
                AlerteBuzz({ t.value }, couleur, scene, Modifier.fillMaxSize(), rayon = 0.3f)
                StopGlitch({ t.value }, 92.sp, Modifier.align(Alignment.Center).offset(y = (-150).dp), fondu = scene)
            } else
            // Éclat de lumière dans la couleur de l'équipe, à l'arrivée.
            Box(
                Modifier.fillMaxSize().drawBehind {
                    val ms = t.value
                    val p = (ms / 700f).coerceIn(0f, 1f)
                    if (p <= 0f || p >= 1f) return@drawBehind
                    val c = Offset(size.width / 2, size.height / 2)
                    val r = size.minDimension * (0.15f + 0.75f * p)
                    drawCircle(couleur.copy(alpha = 0.55f * (1f - p)), r, c, style = Stroke(18f * (1f - p) + 2f))
                    for (k in 0 until 16) {
                        val a = k * PI.toFloat() / 8f
                        val d1 = r * 0.55f
                        val d2 = r * (0.8f + 0.2f * (k % 2))
                        drawLine(
                            Neon.OrClair.copy(alpha = 0.8f * (1f - p)),
                            Offset(c.x + cos(a) * d1, c.y + sin(a) * d1), Offset(c.x + cos(a) * d2, c.y + sin(a) * d2), 5f,
                        )
                    }
                },
            )
            Column(
                Modifier
                    .align(Alignment.Center)
                    .graphicsLayer {
                        val ms = t.value
                        val p = (ms / PAROLE_ENTREE_MS).coerceIn(0f, 1f)
                        val g = glissementParole(ms.toLong())
                        // Arrivée avec un rebond, puis vers le haut de l'écran en rétrécissant.
                        val arrivee = 0.4f + 0.6f * p + 0.16f * sin(p * PI.toFloat())
                        val s = arrivee * (1f - 0.56f * g)
                        scaleX = s
                        scaleY = s
                        translationY = -g * 205.dp.toPx()
                        alpha = presence.value * p
                    }
                    .drawBehind {
                        // Anneau qui bat tant que l'équipe a la parole.
                        val c = Offset(size.width / 2, size.height / 2)
                        // Game Show : au centre, c'est l'anneau de la scène qui bat ; celui-ci n'apparaît qu'en bandeau.
                        val bandeau = if (Look.gs) glissementParole(t.value.toLong()) else 1f
                        drawCircle(couleur.copy(alpha = 0.35f * (1f - pouls) * bandeau), size.height * (0.6f + 0.35f * pouls), c, style = Stroke(6f))
                    }
                    .background(
                        Brush.verticalGradient(listOf(Neon.FondHaut.copy(alpha = 0.97f), Neon.FondBas.copy(alpha = 0.97f))),
                        RoundedCornerShape(40.dp),
                    )
                    .border(4.dp, couleur, RoundedCornerShape(40.dp))
                    .padding(horizontal = 44.dp, vertical = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    if (Look.gs) "LA PAROLE EST À" else "🎤  LA PAROLE EST À",
                    style = TextStyle(fontFamily = PoliceLmp, lineHeight = 1.2.em, lineHeightStyle = LIGNE_LMP, color = Neon.Or, fontSize = 24.sp, fontWeight = FontWeight.Black, letterSpacing = 4.sp),
                )
                NomUneLigne(nom.ifBlank { "Équipe" }, couleur, 96f, 780.dp)
            }
        }
    }
}

/** Le nom de l'équipe en grand, réduit autant qu'il faut pour tenir sur une seule ligne dans [largeurMax]. */
@Composable
internal fun NomUneLigne(texte: String, couleur: Color, tailleMax: Float, largeurMax: Dp, tailleMin: Float = 28f) {
    val mesure = rememberTextMeasurer()
    val densite = LocalDensity.current
    fun style(taille: Float) = TextStyle(fontFamily = PoliceLmp,
        color = couleur, fontSize = taille.sp, lineHeight = (taille * 1.1f).sp, fontWeight = FontWeight.Black,
        shadow = Shadow(couleur.copy(alpha = 0.8f), Offset.Zero, 28f),
    )
    val taille = remember(texte, largeurMax, densite.density, densite.fontScale) {
        val maxPx = with(densite) { largeurMax.toPx() }
        var s = tailleMax
        while (s > tailleMin && mesure.measure(texte, style(s), maxLines = 1, softWrap = false).size.width > maxPx) s *= 0.92f
        s
    }
    Text(texte, maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis, style = style(taille))
}
