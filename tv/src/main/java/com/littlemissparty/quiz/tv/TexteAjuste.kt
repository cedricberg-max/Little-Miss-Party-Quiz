package com.littlemissparty.quiz.tv

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/**
 * Texte qui tient toujours dans sa place (règle 10) : sa taille baisse, de [max] jusqu'à [min] au plus, tant qu'un mot
 * dépasse la largeur, que le texte prend plus de [lignes] lignes ou qu'il dépasse la hauteur. Jamais un mot coupé en
 * deux (« Téléphériqu / e », test du 25/10 au soir) ni une phrase rognée en bas. [uneLigneJusqua] : le texte reste sur
 * une ligne tant qu'il y tient à cette taille au moins, puis passe à [lignes] lignes.
 */
@Composable
fun TexteAjuste(
    texte: String,
    color: Color,
    max: TextUnit,
    modifier: Modifier = Modifier,
    min: TextUnit = 14.sp,
    lignes: Int = 2,
    fontWeight: FontWeight = FontWeight.Black,
    textAlign: TextAlign = TextAlign.Center,
    uneLigneJusqua: TextUnit? = null,
) {
    val style = LocalTextStyle.current.merge(TextStyle(fontWeight = fontWeight, textAlign = textAlign))
    val mesure = rememberTextMeasurer()
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val largeur = constraints.maxWidth
        val hauteur = constraints.maxHeight
        val taille = remember(texte, largeur, hauteur, max, min, lignes, style, uneLigneJusqua) {
            fun tient(t: Float, n: Int): Boolean {
                val st = style.copy(fontSize = t.sp, lineHeight = (t * 1.12f).sp)
                val motsTiennent = texte.split(' ', ' ', '\n').filter { it.isNotEmpty() }.all { mot ->
                    mesure.measure(mot, st, maxLines = 1, softWrap = false).size.width <= largeur
                }
                return motsTiennent && mesure.measure(texte, st, constraints = Constraints(maxWidth = largeur)).let {
                    it.lineCount <= n && (hauteur == Constraints.Infinity || it.size.height <= hauteur)
                }
            }
            // Sur une seule ligne tant qu'elle reste assez grande (« Fantôme 5 a / buzzé ! » coupé en deux, 30/10).
            val seule = uneLigneJusqua?.value?.coerceAtLeast(min.value)
            if (seule != null && tient(seule, 1)) tailleQuiTient(max.value, seule) { tient(it, 1) }
            else tailleQuiTient(max.value, min.value) { tient(it, lignes) }
        }
        Text(
            texte, color = color, style = style, fontSize = taille.sp, lineHeight = (taille * 1.12f).sp,
            maxLines = lignes, overflow = TextOverflow.Ellipsis,
        )
    }
}

/** La plus grande taille, de [max] à [min] par pas de 2, pour laquelle [tient] ; [min] si aucune. */
internal fun tailleQuiTient(max: Float, min: Float, tient: (Float) -> Boolean): Float {
    var t = max
    while (t > min) {
        if (tient(t)) return t
        t -= 2f
    }
    return min
}
