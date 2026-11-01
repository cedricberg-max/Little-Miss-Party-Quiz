package com.littlemissparty.quiz.tv.habillage

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * Règle des petits textes posés sur le décor (cedric, 31/10 au soir) : jamais de rectangle ni d'ovale derrière, une
 * ombre douce et noire tout autour des lettres, en gras. Le modèle exact : la phrase du Chrono « Prêts ? Comptez dans
 * votre tête… » (ChronoScreens, Consigne).
 */
internal val HALO_DECOR = Shadow(Color.Black, Offset.Zero, 22f)

/**
 * Nom d'équipe (ou phrase qui en porte un) détaché du décor quelle que soit sa couleur (cedric, 1/11 au soir : « Sacha »
 * bleu nuit se fondait dans le plateau au « Bravo » du blind test). Sous le texte, trois copies de nuit portant chacune
 * une ombre floue (un halo noir plus fort que [HALO_DECOR], Android plafonnant le flou d'une seule ombre) ; le texte
 * garde par-dessus sa propre lueur de couleur. Aucun cadre. [texte] peut porter des couleurs par morceaux.
 */
@Composable
internal fun TexteDetache(
    texte: AnnotatedString,
    style: TextStyle,
    modifier: Modifier = Modifier,
    maxLines: Int = Int.MAX_VALUE,
    overflow: TextOverflow = TextOverflow.Clip,
) {
    val densite = LocalDensity.current
    fun px(d: Float) = with(densite) { d.dp.toPx() }
    val nuit = Color(0xFF06020E)
    val calques = listOf(
        style.copy(color = nuit, shadow = Shadow(nuit.copy(alpha = 0.9f), Offset.Zero, px(12f))),
        style.copy(color = nuit, shadow = Shadow(nuit, Offset.Zero, px(8f))),
        style.copy(color = nuit, shadow = Shadow(nuit, Offset(0f, px(2f)), px(4f))),
    )
    Box(modifier, propagateMinConstraints = true) {
        calques.forEach { st ->
            Text(
                texte.text,
                Modifier.matchParentSize().clearAndSetSemantics {},
                maxLines = maxLines, overflow = overflow, style = st,
            )
        }
        Text(texte, maxLines = maxLines, overflow = overflow, style = style)
    }
}

@Composable
internal fun TexteDetache(
    texte: String,
    style: TextStyle,
    modifier: Modifier = Modifier,
    maxLines: Int = Int.MAX_VALUE,
    overflow: TextOverflow = TextOverflow.Clip,
) = TexteDetache(AnnotatedString(texte), style, modifier, maxLines, overflow)
