package com.littlemissparty.quiz.tv.habillage

import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.unit.dp

/** Nuit du plateau sous la fumée d'un panneau du Game Show. */
private val Fumee = Color(0xFF05010D)

/**
 * Fond d'un panneau de jeu (Chante le mot, Qui suis-je, Statues, blind test…). Classique : verre blanc arrondi d'opacité
 * [alpha]. Game Show : plus aucun cadre posé sur le plateau (cedric, 24 octobre : « cette texture transparente qui vient
 * faire un carré sur le plateau… ça ne me plaît pas ») ; une fumée sombre, sans bord, garde le texte lisible.
 */
internal fun Modifier.panneauJeu(alpha: Float = 0.10f): Modifier =
    if (!Look.gs) clip(RoundedCornerShape(28.dp)).background(Color.White.copy(alpha = alpha))
    else drawBehind {
        val r = size.minDimension / 2f
        if (r <= 0f) return@drawBehind
        // Un disque en dégradé étiré en ovale sur tout le panneau : sombre au centre, fondu à rien sur les bords.
        scale(size.width / size.minDimension, size.height / size.minDimension, center) {
            drawCircle(
                Brush.radialGradient(
                    0f to Fumee.copy(alpha = 0.6f), 0.55f to Fumee.copy(alpha = 0.42f), 1f to Color.Transparent,
                    center = center, radius = r,
                ),
                r, center,
            )
        }
    }

/**
 * Game Show, titres et règles des jeux (choix C de cedric, 29/10) : une bande sombre sur toute la largeur de l'écran
 * derrière le titre et la règle, fondue en haut et en bas, pour que le texte ne se perde plus dans le plateau.
 * Dessinée hors des bords du texte (jusqu'aux bords de l'écran), sans rien changer à la mise en page. Classique : rien.
 */
internal fun Modifier.bandeTitre(): Modifier =
    if (!Look.gs) this
    else drawBehind {
        val deborde = 18.dp.toPx()
        drawRect(
            Brush.verticalGradient(
                0f to Color.Transparent, 0.22f to Fumee.copy(alpha = BANDE_TITRE_ALPHA), 0.78f to Fumee.copy(alpha = BANDE_TITRE_ALPHA), 1f to Color.Transparent,
                startY = -deborde, endY = size.height + deborde,
            ),
            topLeft = Offset(-BANDE_TITRE_LARGEUR, -deborde),
            size = Size(size.width + 2 * BANDE_TITRE_LARGEUR, size.height + 2 * deborde),
        )
    }

/** Opacité du cœur de la bande (planche du 29/10 : le décor se devine derrière). */
internal const val BANDE_TITRE_ALPHA = 0.62f

/** De quoi aller jusqu'aux bords de l'écran quel que soit l'endroit du texte (px, largement au-delà de la 4K). */
private const val BANDE_TITRE_LARGEUR = 8_000f
