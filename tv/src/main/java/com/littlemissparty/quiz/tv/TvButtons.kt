package com.littlemissparty.quiz.tv

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.PoliceLmp
import com.littlemissparty.quiz.tv.habillage.couleurTexteNeonDore
import com.littlemissparty.quiz.tv.habillage.styleCentre

private val Shape = RoundedCornerShape(50)
private const val FOCUS_MS = 160

/**
 * Bouton piloté à la télécommande. Celui qui a la sélection se voit à plusieurs mètres : fond doré,
 * texte violet foncé, contour lumineux et léger agrandissement, avec une transition douce. Les autres
 * restent discrets (fond translucide) ; `primary` les borde d'or pour signaler l'action principale.
 */
@Composable
fun TvButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    primary: Boolean = false,
    accent: Color = Palette.Ink,
    fontSize: TextUnit = 22.sp,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val scale by animateFloatAsState(if (focused) 1.08f else 1f, tween(FOCUS_MS), label = "scale")
    val glow by animateDpAsState(if (focused) 18.dp else if (primary) 10.dp else 0.dp, tween(FOCUS_MS), label = "glow")
    // Bouton principal « néon doré » (choix de cedric) : fond de nuit cerclé d'or, texte or clair ; plein or sous le focus.
    val container by animateColorAsState(
        when {
            focused -> Palette.Gold
            primary -> Neon.Plaque
            else -> Color.White.copy(alpha = 0.08f)
        },
        tween(FOCUS_MS), label = "container",
    )
    val ink by animateColorAsState(
        when {
            focused -> Palette.FocusInk
            primary -> couleurTexteNeonDore(false)
            else -> accent
        },
        tween(FOCUS_MS), label = "ink",
    )
    val border by animateColorAsState(
        when {
            focused -> Color.White
            primary -> Neon.Or
            else -> Color.White.copy(alpha = 0.45f)
        },
        tween(FOCUS_MS), label = "border",
    )
    Button(
        onClick = onClick,
        modifier = modifier
            .scale(scale)
            .shadow(glow, Shape, ambientColor = Palette.Gold, spotColor = Palette.Gold),
        shape = Shape,
        colors = ButtonDefaults.buttonColors(containerColor = container, contentColor = ink),
        border = BorderStroke(if (focused) 4.dp else if (primary) 3.dp else 2.dp, border),
        contentPadding = PaddingValues(horizontal = 28.dp, vertical = 12.dp),
        interactionSource = interaction,
    ) {
        Text(
            label,
            // Le bouton Material impose sa propre police et une hauteur de ligne plus petite que le texte : celle de
            // l'appli est redonnée ici, centrée au pixel (sinon Baloo 2 tombe trop bas, « Trouvé ! » le 21/10).
            style = styleCentre(fontSize, ink, if (focused || primary) FontWeight.ExtraBold else FontWeight.SemiBold).copy(textAlign = TextAlign.Center),
        )
    }
}
