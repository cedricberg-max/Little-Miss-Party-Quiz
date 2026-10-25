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
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.sin

/** Couleurs des lettres, dans l'ordre (proposition T3 du 24 octobre). */
private val TEINTES_DANSE = listOf(GS.Rose, GS.Jaune, GS.Cyan, GS.Vert, GS.Orange, Color(0xFFB56BFF))
private val PENCHE = floatArrayOf(-6f, 4f, -3f, 7f, -5f, 2f)
private val DECALE = floatArrayOf(-6f, 6f, -2f, 8f, -8f, 3f)

/**
 * Titre de question festif (proposition T3, « Quel est ce titre ? » du Quiz musical) : chaque lettre a sa couleur
 * néon, cernée de blanc, penchée et décalée ; elles dansent doucement au tempo des musiques (120 BPM). Une seule ligne :
 * pour un titre court seulement. Léger : chaque lettre est un calque qui tourne et monte, rien n'est recomposé.
 */
@Composable
internal fun LettresQuiDansent(texte: String, taille: TextUnit, modifier: Modifier = Modifier) {
    val danse = rememberInfiniteTransition(label = "danse")
    // Une mesure de 4 temps à 120 BPM, 2 s : chaque lettre fait un aller-retour par temps, en décalé.
    val t by danse.animateFloat(0f, 1f, infiniteRepeatable(tween(2_000, easing = LinearEasing), RepeatMode.Restart), label = "t")
    val tour = 2f * PI.toFloat()
    Row(modifier.semantics { contentDescription = texte }, verticalAlignment = Alignment.CenterVertically) {
        var n = 0
        for (lettre in texte) {
            if (lettre == ' ') { Spacer(Modifier.width(taille.value.dp * 0.32f)); continue }
            val k = n++
            val couleur = TEINTES_DANSE[k % TEINTES_DANSE.size]
            Box(
                Modifier.graphicsLayer {
                    val phase = t * 4f * tour + k * 0.7f
                    rotationZ = PENCHE[k % 6] + 3f * sin(phase)
                    translationY = (DECALE[k % 6] + 5f * sin(phase + 1.2f)) * density
                },
                contentAlignment = Alignment.Center,
            ) {
                // Contour blanc dessous, lettre de couleur dessus (le contour d'un seul texte mangerait la couleur).
                Text(lettre.toString(), maxLines = 1, softWrap = false, style = TextStyle(
                    color = Color.White, fontFamily = PoliceGsTitre, fontSize = taille, drawStyle = Stroke(width = taille.value * 0.12f * 2f),
                    shadow = Shadow(Color.Black.copy(alpha = 0.5f), Offset(0f, taille.value * 0.12f), 0f),
                ))
                Text(lettre.toString(), maxLines = 1, softWrap = false, style = TextStyle(
                    color = couleur, fontFamily = PoliceGsTitre, fontSize = taille,
                    shadow = Shadow(couleur.copy(alpha = 0.85f), Offset.Zero, taille.value * 0.35f),
                ))
            }
        }
    }
}
