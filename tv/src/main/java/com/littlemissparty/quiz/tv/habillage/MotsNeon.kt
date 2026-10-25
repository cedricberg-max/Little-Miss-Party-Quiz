package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.keyframes
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/** Couleur du néon de chaque mot, dans l'ordre (proposition T1 du 24 octobre). */
private val TEINTES_MOTS = listOf(GS.Cyan, GS.Rose, GS.Jaune, GS.Vert, GS.Orange)

/**
 * Titre de question en néon, un tube de couleur par mot (proposition T1, choisie par cedric le 25/10, « Quel est ce
 * titre ? » du Quiz musical) : lettres blanches au cœur brillant, chaque mot entouré de la lueur de sa couleur. Les mots
 * s'allument l'un après l'autre en grésillant, puis restent fixes. Une seule ligne : pour un titre court seulement.
 */
@Composable
internal fun MotsNeon(texte: String, taille: TextUnit, modifier: Modifier = Modifier) {
    val mots = texte.split(' ').filter { it.isNotBlank() }
    Row(modifier.semantics { contentDescription = texte }, verticalAlignment = Alignment.CenterVertically) {
        mots.forEachIndexed { k, mot ->
            if (k > 0) Spacer(Modifier.width(taille.value.dp * 0.42f))
            MotAllume(mot, TEINTES_MOTS[k % TEINTES_MOTS.size], taille, delaiMs = 120L * k, cle = texte)
        }
    }
}

@Composable
private fun MotAllume(mot: String, couleur: Color, taille: TextUnit, delaiMs: Long, cle: Any?) {
    val allume = remember(cle) { Animatable(0f) }
    LaunchedEffect(cle) {
        delay(delaiMs)
        allume.animateTo(1f, keyframes {
            durationMillis = 420
            0.9f at 60
            0.2f at 130
            1f at 220
            0.55f at 290
        })
    }
    fun style(c: Color, flou: Float, lueur: Color) = TextStyle(
        color = c, fontFamily = PoliceGsTitre, fontSize = taille, shadow = Shadow(lueur, Offset.Zero, flou),
    )
    // Trois couches : grand halo de la couleur, lueur de la couleur, lettres blanches au cœur brillant.
    Box(Modifier.clearAndSetSemantics {}.graphicsLayer { alpha = allume.value }, contentAlignment = Alignment.Center) {
        Text(mot, maxLines = 1, softWrap = false, style = style(couleur.copy(alpha = 0.6f), taille.value * 1.1f, couleur))
        Text(mot, maxLines = 1, softWrap = false, style = style(couleur.copy(alpha = 0.9f), taille.value * 0.45f, couleur))
        Text(mot, maxLines = 1, softWrap = false, style = style(Color.White, taille.value * 0.12f, Color.White.copy(alpha = 0.9f)))
    }
}
