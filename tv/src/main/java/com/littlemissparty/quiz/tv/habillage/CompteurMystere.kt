package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Illustration générique d'une question Juste Chiffre (proposition à cedric du 22 octobre) : un compteur lumineux à trois
 * rouleaux dont les chiffres défilent sans fin, comme une machine à sous, pendant que les équipes tapent leur nombre.
 * Rien n'est dévoilé (même chose quelle que soit la réponse). Avec [emoji] (le sujet de la question, 🕷️ pour les pattes
 * d'une araignée), l'émoji se pose à gauche du compteur. Chaque rouleau est une colonne de chiffres dessinée une fois
 * qui glisse (calque déplacé) : rien n'est redessiné à chaque image, la petite box suit.
 */
@Composable
fun CompteurMystere(emoji: String?, modifier: Modifier = Modifier, hauteur: Dp = 132.dp) {
    val gs = Look.gs
    val bord = if (gs) GS.Cyan else Neon.Or
    val encre = if (gs) GS.Encre else Color(0xFFFFF6E6)
    val boucle = rememberInfiniteTransition(label = "compteur")
    // Trois rouleaux à des vitesses différentes, pour que les chiffres ne s'alignent jamais.
    val tours = listOf(2_600, 3_400, 2_100).mapIndexed { k, ms ->
        boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(ms, easing = LinearEasing)), label = "rouleau$k")
    }
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
        if (emoji != null) {
            Text(emoji, style = TextStyle(fontSize = (hauteur.value * 0.62f).sp, textAlign = TextAlign.Center))
            Spacer(Modifier.width(hauteur * 0.22f))
        }
        val forme = RoundedCornerShape(hauteur * 0.16f)
        Row(
            Modifier
                .clip(forme)
                .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.55f), (if (gs) GS.Nuit else Neon.Nuit2).copy(alpha = 0.9f), Color.Black.copy(alpha = 0.55f))))
                .border(3.dp, bord, forme)
                .size(width = hauteur * 2.3f, height = hauteur),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            tours.forEachIndexed { k, tour ->
                val t by tour
                Rouleau(depart = k * 3, avance = { t }, hauteur = hauteur * 0.78f, encre = encre, lueur = bord)
            }
        }
    }
}

/** Un rouleau : les chiffres 0 à 9 (deux fois, pour boucler sans saut) qui défilent derrière une fenêtre. */
@Composable
private fun Rouleau(depart: Int, avance: () -> Float, hauteur: Dp, encre: Color, lueur: Color) {
    val ligne = hauteur * 0.62f
    val style = TextStyle(
        fontFamily = if (Look.gs) PoliceGsChiffres else PoliceLmp, fontWeight = FontWeight.Black, fontSize = (ligne.value * 0.82f).sp,
        lineHeight = (ligne.value).sp, color = encre, textAlign = TextAlign.Center, shadow = Shadow(lueur.copy(alpha = 0.85f), Offset.Zero, 18f),
        lineHeightStyle = LIGNE_LMP,
    )
    val forme = RoundedCornerShape(hauteur * 0.12f)
    Box(
        // Décor qui tourne sans fin : rien à lire (les chiffres coupés par la fenêtre ne sont pas du texte de l'écran).
        Modifier.size(width = hauteur * 0.62f, height = hauteur).clip(forme).clearAndSetSemantics { }
            .background(Color.White.copy(alpha = 0.06f))
            // Haut et bas du rouleau dans l'ombre, comme un tambour qui tourne.
            .drawWithContent {
                drawContent()
                drawRect(Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.85f), 0.3f to Color.Transparent, 0.7f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.85f)))
            },
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(
            Modifier.wrapContentHeight(unbounded = true, align = Alignment.Top).offset(y = (hauteur - ligne) / 2)
                .graphicsLayer { translationY = -avance() * 10 * ligne.toPx() },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            for (i in 0 until 21) {
                Box(Modifier.height(ligne).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text("${(depart + i) % 10}", style = style, maxLines = 1, softWrap = false)
                }
            }
        }
    }
}
