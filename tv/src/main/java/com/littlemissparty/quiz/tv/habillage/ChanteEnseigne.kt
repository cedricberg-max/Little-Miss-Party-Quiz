package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/*
 * Chante le mot ! du Game Show, proposition F « enseigne néon », choisie par cedric le 25/10 : « UNE CHANSON AVEC LE
 * MOT » en orange au-dessus, le mot en lettres blanches qui brillent d'orange dans un tube néon rose aux bouts
 * arrondis, deux micros néon cyan de chaque côté, un égaliseur jaune et orange qui danse dessous au tempo (120 BPM).
 * Le tube n'est qu'un trait de lumière : aucun panneau, le plateau reste visible à travers.
 */

private const val ENSEIGNE_TAILLE_MAX = 130f
private const val ENSEIGNE_TAILLE_MIN = 36f
private const val ENSEIGNE_TITRE = "UNE CHANSON AVEC LE MOT"

/** Le titre au-dessus du tube, à l'échelle [e] (1 = taille pleine). */
private fun styleTitreEnseigne(e: Float) = TextStyle(
    fontFamily = PoliceGsChiffres, fontSize = 22.sp * e, letterSpacing = 8.sp * e, color = Color(0xFFFFE0C2),
    shadow = Shadow(GS.Orange.copy(alpha = 0.95f), Offset.Zero, 18f * e),
)

/** Hauteurs de repos des barres de l'égaliseur (fraction de sa hauteur), de gauche à droite. */
private val BARRES = floatArrayOf(0.25f, 0.58f, 0.92f, 0.5f, 0.79f, 0.33f, 1f, 0.67f, 0.42f, 0.83f, 0.54f, 0.29f, 0.75f, 0.46f)

/** Le mot à chanter sur son enseigne. [mot] : déjà en majuscules ; [cle] rallume l'enseigne à chaque nouveau mot. */
@Composable
internal fun ChanteEnseigne(mot: String, cle: Any?, modifier: Modifier = Modifier) {
    val boucle = rememberInfiniteTransition(label = "enseigne")
    // Une mesure à 120 BPM (2 s) : le tube respire, l'égaliseur danse.
    val t by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(2_000, easing = LinearEasing), RepeatMode.Restart), label = "t")
    // L'enseigne s'allume en grésillant à chaque nouveau mot, comme un vrai néon.
    val allume = remember(cle) { Animatable(0f) }
    LaunchedEffect(cle) {
        allume.animateTo(1f, keyframes {
            durationMillis = 620
            0.85f at 90
            0.15f at 170
            1f at 270
            0.4f at 360
            1f at 470
        })
    }
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val tubeL = minOf(maxWidth * 0.82f, maxHeight * 2.9f)
        val tubeH = minOf(tubeL * 0.3f, maxHeight * 0.46f)
        val micro = tubeH * 0.72f
        // Le titre tient toujours sur la largeur du tube, jamais coupé : il rapetisse quand la place manque.
        val mesure = rememberTextMeasurer()
        val largeurTube = with(LocalDensity.current) { tubeL.toPx() }
        val echelleTitre = remember(largeurTube) {
            val large = mesure.measure(ENSEIGNE_TITRE, styleTitreEnseigne(1f), softWrap = false, maxLines = 1).size.width
            (largeurTube / large.coerceAtLeast(1)).coerceAtMost(1f)
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(
                ENSEIGNE_TITRE, maxLines = 1, softWrap = false, modifier = Modifier.apparition(150, cle),
                style = styleTitreEnseigne(echelleTitre),
            )
            Spacer(Modifier.height(tubeH * 0.16f))
            Row(
                Modifier.width(tubeL).height(tubeH).graphicsLayer { alpha = allume.value }.drawBehind {
                    // Le tube rose : halo large, tube, cœur blanc. Il respire doucement au tempo.
                    val respire = 0.5f + 0.5f * sin(t * 2f * PI.toFloat() * 2f)
                    val e = 3.dp.toPx()
                    val r = CornerRadius(size.height / 2f)
                    drawRoundRect(GS.Rose.copy(alpha = 0.10f + 0.05f * respire), cornerRadius = r, style = Stroke(e * 9f))
                    drawRoundRect(GS.Rose.copy(alpha = 0.28f + 0.08f * respire), cornerRadius = r, style = Stroke(e * 4f))
                    drawRoundRect(Color(0xFFFF9ED2), cornerRadius = r, style = Stroke(e * 1.6f))
                    drawRoundRect(Color.White.copy(alpha = 0.65f), cornerRadius = r, style = Stroke(e * 0.5f))
                },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Spacer(Modifier.width(tubeH * 0.2f))
                MicroNeon(Modifier.size(micro * 0.62f, micro))
                // Calque à part : les lettres et leurs lueurs ne se redessinent pas à chaque image du tube qui respire.
                Box(Modifier.weight(1f).fillMaxHeight().graphicsLayer {}, contentAlignment = Alignment.Center) {
                    MotNeon(mot, allume.value)
                }
                MicroNeon(Modifier.size(micro * 0.62f, micro))
                Spacer(Modifier.width(tubeH * 0.2f))
            }
            Spacer(Modifier.height(tubeH * 0.2f))
            Egaliseur({ t }, Modifier.width(tubeL * 0.4f).height(tubeH * 0.38f).graphicsLayer { alpha = allume.value })
        }
    }
}

/** Le mot en lettres blanches qui brillent d'orange, réduit pour tenir dans la place (deux lignes au plus). */
@Composable
private fun MotNeon(mot: String, allume: Float) {
    BoxWithConstraints(contentAlignment = Alignment.Center) {
        val largeur = constraints.maxWidth * 0.94f
        val hauteur = constraints.maxHeight * 0.8f
        val mesure = rememberTextMeasurer()
        val (taille, lignes) = remember(mot, largeur, hauteur) {
            fun large(texte: String) = mesure.measure(
                texte, TextStyle(fontFamily = PoliceGsTitre, fontSize = ENSEIGNE_TAILLE_MAX.sp), softWrap = false, maxLines = 1,
            ).size.width.coerceAtLeast(1)
            fun haut(n: Int) = mesure.measure(
                "M", TextStyle(fontFamily = PoliceGsTitre, fontSize = ENSEIGNE_TAILLE_MAX.sp, lineHeight = (ENSEIGNE_TAILLE_MAX * 1.02f).sp),
            ).size.height.coerceAtLeast(1) * n
            val uneLigne = minOf(ENSEIGNE_TAILLE_MAX * largeur / large(mot), ENSEIGNE_TAILLE_MAX * hauteur / haut(1))
            val mots = mot.split(' ').filter { it.isNotBlank() }
            if (mots.size < 2 || uneLigne >= ENSEIGNE_TAILLE_MAX * 0.55f) uneLigne.coerceIn(ENSEIGNE_TAILLE_MIN, ENSEIGNE_TAILLE_MAX) to 1
            else minOf(ENSEIGNE_TAILLE_MAX * largeur / mots.maxOf { large(it) }, ENSEIGNE_TAILLE_MAX * hauteur / haut(2))
                .coerceIn(ENSEIGNE_TAILLE_MIN, ENSEIGNE_TAILLE_MAX) to 2
        }
        fun style(couleur: Color, flou: Float, lueur: Color) = TextStyle(
            color = couleur, fontFamily = PoliceGsTitre, fontSize = taille.sp, lineHeight = (taille * 1.02f).sp,
            textAlign = TextAlign.Center, shadow = Shadow(lueur, Offset.Zero, flou),
        )
        // Trois couches : grand halo rouge orangé, lueur orange, lettres blanches au cœur brillant.
        Box(contentAlignment = Alignment.Center) {
            Text(mot, maxLines = lignes, style = style(GS.Orange.copy(alpha = 0.55f * allume), taille * 1.1f, Color(0xFFFF3B00)),
                modifier = Modifier.clearAndSetSemantics {})
            Text(mot, maxLines = lignes, style = style(Color(0xFFFFB37A).copy(alpha = allume), taille * 0.38f, GS.Orange),
                modifier = Modifier.clearAndSetSemantics {})
            Text(mot, maxLines = lignes, style = style(Color.White, taille * 0.08f, Color.White.copy(alpha = 0.9f)))
        }
    }
}

/** Égaliseur : des barres arrondies jaune et orange qui montent et descendent au tempo, chacune à son rythme. */
@Composable
private fun Egaliseur(t: () -> Float, modifier: Modifier) {
    Canvas(modifier.clearAndSetSemantics {}) {
        val n = BARRES.size
        val pas = size.width / n
        val l = pas * 0.56f
        val degrade = Brush.verticalGradient(listOf(GS.Jaune, GS.Orange), startY = 0f, endY = size.height)
        for (k in 0 until n) {
            val phase = t() * 2f * PI.toFloat() * 4f + k * 1.3f
            val h = size.height * (BARRES[k] * (0.45f + 0.55f * abs(sin(phase)))).coerceIn(0.12f, 1f)
            val x = k * pas + (pas - l) / 2f
            val y = size.height - h
            drawRoundRect(GS.Orange.copy(alpha = 0.22f), Offset(x - l * 0.35f, y - l * 0.35f), Size(l * 1.7f, h + l * 0.7f), CornerRadius(l))
            drawRoundRect(degrade, Offset(x, y), Size(l, h), CornerRadius(l / 2f))
        }
    }
}
