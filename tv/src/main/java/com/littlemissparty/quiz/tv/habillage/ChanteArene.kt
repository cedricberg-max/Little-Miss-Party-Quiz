package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/*
 * Chante le mot ! du Game Show, proposition H « arène en or » (cedric, 24/10 : « le mot est écrit en blanc sans aucun
 * style et ces deux pauvres notes… font pitié ») : le mot en lettres d'or en relief au milieu d'un anneau de lumière
 * cyan et rose, quatre étoiles qui scintillent, « UNE CHANSON AVEC LE MOT » au-dessus. Aucun cadre sur le plateau.
 */

private const val ARENE_TAILLE_MAX = 120f
private const val ARENE_TAILLE_MIN = 40f

/** Le mot à chanter dans son arène. [mot] : déjà en majuscules ; [cle] rejoue l'arrivée à chaque nouveau mot. */
@Composable
internal fun ChanteArene(mot: String, cle: Any?, modifier: Modifier = Modifier) {
    val boucle = rememberInfiniteTransition(label = "arene")
    // Une mesure à 120 BPM (2 s) : l'anneau respire, les étoiles scintillent l'une après l'autre.
    val t by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(2_000, easing = LinearEasing), RepeatMode.Restart), label = "t")
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val largeur = constraints.maxWidth * 0.78f
        Canvas(Modifier.fillMaxSize().clearAndSetSemantics {}) {
            val c = Offset(size.width / 2, size.height * 0.56f)
            val rx = size.width * 0.44f
            val ry = size.height * 0.34f
            val respire = 0.5f + 0.5f * sin(t * 2f * PI.toFloat() * 2f)
            fun anneau(couleur: Color, ex: Float, epais: Float, alpha: Float) {
                val s = Size(2f * rx * ex, 2f * ry * ex)
                val tl = Offset(c.x - s.width / 2, c.y - s.height / 2)
                drawOval(couleur.copy(alpha = 0.18f * alpha), tl, s, style = Stroke(epais * 5f))
                drawOval(couleur.copy(alpha = 0.9f * alpha), tl, s, style = Stroke(epais))
                drawOval(Color.White.copy(alpha = 0.45f * alpha), tl, s, style = Stroke(epais * 0.35f))
            }
            anneau(GS.Rose, 1.09f + 0.012f * respire, 3.dp.toPx(), 0.75f)
            anneau(GS.Cyan, 1f, 4.dp.toPx(), 0.85f + 0.15f * respire)
            // Quatre étoiles sur l'anneau, chacune scintille à son temps.
            val places = floatArrayOf(-2.45f, -0.62f, 2.3f, 0.75f)
            for (k in places.indices) {
                val a = places[k]
                val p = Offset(c.x + cos(a) * rx, c.y + sin(a) * ry)
                val eclat = (1f - ((t * 4f - k + 4f) % 4f).coerceIn(0f, 1f)).let { it * it }
                etoile(p, (10f + 10f * eclat).dp.toPx(), Color(0xFFFFE600).copy(alpha = 0.7f + 0.3f * eclat))
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(horizontal = 24.dp)) {
            Text(
                "UNE CHANSON AVEC LE MOT", maxLines = 1, softWrap = false, modifier = Modifier.apparition(150, cle),
                style = TextStyle(
                    fontFamily = PoliceGsChiffres, fontSize = 22.sp, letterSpacing = 7.sp, color = Color(0xFFFFD9B8),
                    shadow = Shadow(GS.Orange.copy(alpha = 0.9f), Offset.Zero, 16f),
                ),
            )
            Spacer(Modifier.height(10.dp))
            val mesure = rememberTextMeasurer()
            val taille = remember(mot, largeur) {
                val style = TextStyle(fontFamily = PoliceGsTitre, fontSize = ARENE_TAILLE_MAX.sp)
                val plusLong = mot.split(' ').maxOf { mesure.measure(it, style, softWrap = false, maxLines = 1).size.width }
                if (plusLong <= 0) ARENE_TAILLE_MAX else (ARENE_TAILLE_MAX * largeur / plusLong).coerceIn(ARENE_TAILLE_MIN, ARENE_TAILLE_MAX)
            }
            Box(Modifier.apparition(0, cle).graphicsLayer {
                val b = 1f + 0.025f * sin(t * 2f * PI.toFloat() * 4f)
                scaleX = b
                scaleY = b
            }) {
                // Relief : la même ligne en brun foncé, décalée vers le bas, sous les lettres d'or.
                Text(
                    mot, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    style = TextStyle(fontFamily = PoliceGsTitre, fontSize = taille.sp, lineHeight = (taille * 1.05f).sp, color = Color(0xFF5A1E00)),
                    modifier = Modifier.clearAndSetSemantics {}.graphicsLayer { translationY = taille * 0.06f * density },
                )
                Text(
                    mot, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    style = TextStyle(
                        brush = Brush.verticalGradient(listOf(Color(0xFFFFFBE0), Color(0xFFFFE600), Color(0xFFFF9A1A), Color(0xFFFF5A1F))),
                        fontFamily = PoliceGsTitre, fontSize = taille.sp, lineHeight = (taille * 1.05f).sp,
                        shadow = Shadow(Color(0xFFFFB000).copy(alpha = 0.8f), Offset.Zero, taille * 0.4f),
                    ),
                )
            }
        }
    }
}

/** Étoile à quatre branches pointues, avec un halo. */
private fun androidx.compose.ui.graphics.drawscope.DrawScope.etoile(c: Offset, r: Float, couleur: Color) {
    drawCircle(couleur.copy(alpha = 0.25f * couleur.alpha), r * 0.9f, c)
    val p = Path().apply {
        moveTo(c.x, c.y - r)
        quadraticBezierTo(c.x, c.y, c.x + r, c.y)
        quadraticBezierTo(c.x, c.y, c.x, c.y + r)
        quadraticBezierTo(c.x, c.y, c.x - r, c.y)
        quadraticBezierTo(c.x, c.y, c.x, c.y - r)
        close()
    }
    drawPath(p, couleur)
}
