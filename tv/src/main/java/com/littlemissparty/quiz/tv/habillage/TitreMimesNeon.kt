package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Titre des Mimes entre deux tours, choix D de cedric (planche du 1/11, point 34) : une enseigne de néon, « les » petit
 * et penché en tube cyan, « MIMES ! » en grand tube jaune orangé, qui s'allument en clignotant toutes les 3 s (« MIMES ! »
 * 0,4 s après « les »). Les lettres sont blanches au cœur du tube, la lueur est faite de trois couches de plus en plus
 * larges (une seule ombre par texte dans Compose). Lu « Les Mimes ! » par les tests et l'accessibilité.
 */
@Composable
internal fun TitreMimesNeon(modifier: Modifier = Modifier) {
    val t by rememberInfiniteTransition(label = "enseigne").animateFloat(
        0f, NEON_CYCLE_S, infiniteRepeatable(tween((NEON_CYCLE_S * 1000).toInt(), easing = LinearEasing), RepeatMode.Restart), label = "t",
    )
    Row(
        modifier.clearAndSetSemantics { text = AnnotatedString("Les Mimes !") },
        verticalAlignment = Alignment.Bottom,
    ) {
        TubeNeon(
            "les", PoliceBaloo, FontWeight.ExtraBold, 46.sp, listOf(CYAN to 6f, CYAN to 18f, CYAN to 32f),
            Modifier.graphicsLayer { rotationZ = -8f; alpha = allumageNeon(t) },
        )
        Spacer(Modifier.width(14.dp))
        TubeNeon(
            "MIMES !", PoliceGsTitre, FontWeight.Normal, 76.sp, listOf(JAUNE to 6f, ORANGE to 18f, ROUGE_ORANGE to 36f),
            Modifier.graphicsLayer { alpha = allumageNeon(t - 0.4f) },
        )
    }
}

/** Un mot en tube néon : les lueurs de la plus large à la plus serrée, puis les lettres blanches. */
@Composable
private fun TubeNeon(texte: String, police: FontFamily, graisse: FontWeight, taille: TextUnit, lueurs: List<Pair<Color, Float>>, modifier: Modifier) {
    Box(modifier) {
        val base = TextStyle(fontFamily = police, fontWeight = graisse, fontSize = taille, lineHeight = taille * 1.15f, color = Color.White)
        for ((couleur, flou) in lueurs.reversed()) {
            Text(texte, maxLines = 1, softWrap = false, style = base.copy(shadow = Shadow(couleur, Offset.Zero, flou * 2f)))
        }
    }
}

/** Opacité de l'enseigne à [t] s dans son cycle de 3 s, comme la planche : 0-4 % éteinte, 5-9 % allumée, 10-12 % éteinte, puis allumée. */
internal fun allumageNeon(t: Float): Float {
    val p = (((t % NEON_CYCLE_S) + NEON_CYCLE_S) % NEON_CYCLE_S) / NEON_CYCLE_S
    return when {
        p < 0.05f -> 0.25f
        p < 0.10f -> 1f
        p < 0.13f -> 0.3f
        else -> 1f
    }
}

internal const val NEON_CYCLE_S = 3f
private val CYAN = Color(0xFF00F0FF)
private val JAUNE = Color(0xFFFFE600)
private val ORANGE = Color(0xFFFFB000)
private val ROUGE_ORANGE = Color(0xFFFF6B1A)
