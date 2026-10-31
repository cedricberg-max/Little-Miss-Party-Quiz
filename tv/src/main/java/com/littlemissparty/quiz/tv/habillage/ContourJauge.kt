package com.littlemissparty.quiz.tv.habillage

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.isSpecified
import androidx.compose.ui.unit.sp

/**
 * Texte posé sur le décor du studio, « comme les jauges » des scores (choix B de cedric, 31/10, planche
 * d'uniformisation n° 1-11, 14-16, 18, 21, 24, 30, 36) : un fin contour néon cyan collé aux lettres avec sa lueur, et
 * une ombre noire bien présente autour. Aucun fond, aucun cadre (il refuse les carrés). Même texte, même police, même
 * taille, même place qu'un [Text] : seuls des calques sont ajoutés dessous.
 *
 * Réglages de la planche (écran de référence 1280 px, CSS) : ombre #06020E floue de 10, 20, 34 px et 54 px à 90 %,
 * plus une ombre de 4 px vers le bas ; lueur #3FE0FF de 5 px ; contour #3FE0FF de 0,1 × la taille du texte (3 px au
 * moins) dessiné sous le remplissage, dont seule la moitié extérieure se voit. Ici, du dessous vers le dessus : quatre
 * textes de nuit portant chacun une ombre floue (Android 9 fait le flou des ombres de texte sur la puce graphique),
 * le contour cyan portant sa lueur, puis le texte. Rien n'est recalculé à chaque image.
 *
 * Classique, ou [contour] faux : un [Text] ordinaire, rien ne change. [echelle] : dans une scène dessinée plus grande puis
 * réduite (Echelle), ce que vaut 1 dp de la scène en dp de l'écran à l'envers (1600 / 960 pour une scène de 1600) : les ombres
 * gardent ainsi leur taille réelle à l'écran.
 */
@Composable
internal fun TexteJauge(
    texte: String,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
    fontSize: TextUnit = TextUnit.Unspecified,
    lineHeight: TextUnit = TextUnit.Unspecified,
    fontWeight: FontWeight? = null,
    fontFamily: FontFamily? = null,
    letterSpacing: TextUnit = TextUnit.Unspecified,
    textAlign: TextAlign? = null,
    maxLines: Int = Int.MAX_VALUE,
    softWrap: Boolean = true,
    overflow: TextOverflow = TextOverflow.Clip,
    style: TextStyle = LocalTextStyle.current,
    contour: Boolean = true,
    echelle: Float = 1f,
) {
    val base = style.merge(
        TextStyle(
            color = color, fontSize = fontSize, lineHeight = lineHeight, fontWeight = fontWeight, fontFamily = fontFamily,
            letterSpacing = letterSpacing, textAlign = textAlign ?: TextAlign.Unspecified,
        ),
    )
    if (!Look.gs || !contour) {
        Text(texte, modifier, maxLines = maxLines, softWrap = softWrap, overflow = overflow, style = base)
        return
    }
    // Gras au moins, comme la planche (Rajdhani Bold) : en demi-gras, le contour mange les lettres et le blanc paraît
    // cyan (captures du 31/10).
    val plein = base.copy(fontWeight = maxOf(base.fontWeight ?: FontWeight.Normal, FontWeight.Bold))
    val densite = LocalDensity.current
    fun px(d: Dp) = with(densite) { d.toPx() } * echelle
    val taille = with(densite) { (if (plein.fontSize.isSpecified) plein.fontSize else 16.sp).toPx() }
    val trait = maxOf(taille * CONTOUR_PART_TAILLE, px(CONTOUR_MIN))
    val calques = listOf(
        plein.copy(color = NuitContour, shadow = Shadow(NuitContour.copy(alpha = 0.9f), Offset.Zero, px(OMBRE_LARGE))),
        plein.copy(color = NuitContour, shadow = Shadow(NuitContour, Offset.Zero, px(OMBRE_MOYENNE))),
        plein.copy(color = NuitContour, shadow = Shadow(NuitContour, Offset.Zero, px(OMBRE_PROCHE))),
        plein.copy(color = NuitContour, shadow = Shadow(NuitContour, Offset(0f, px(OMBRE_BAS_DECALAGE)), px(OMBRE_SERREE))),
        plein.copy(color = CyanContour, drawStyle = Stroke(trait), shadow = Shadow(CyanContour, Offset.Zero, px(LUEUR_CYAN))),
    )
    // Le texte plein mesure la boîte ; les calques, dessinés dessous, prennent exactement sa place. Les contraintes
    // minimales passent au texte : avec une largeur imposée (fillMaxWidth, weight), il la prend comme un Text, et son
    // alignement (centré…) reste le même.
    Box(modifier, propagateMinConstraints = true) {
        calques.forEach { st ->
            // Calques muets : seul le texte plein est lu (lecteur d'écran, tests).
            Text(texte, Modifier.matchParentSize().clearAndSetSemantics {}, maxLines = maxLines, softWrap = softWrap, overflow = overflow, style = st)
        }
        Text(texte, maxLines = maxLines, softWrap = softWrap, overflow = overflow, style = plein)
    }
}

/** Nuit de l'ombre (#06020E de la planche). */
private val NuitContour = Color(0xFF06020E)

/** Cyan du contour et de sa lueur (#3FE0FF de la planche). */
internal val CyanContour = Color(0xFF3FE0FF)

/** Épaisseur totale du contour : 0,1 × la taille du texte (la moitié extérieure se voit), jamais moins de 3 px sur 1280. */
internal const val CONTOUR_PART_TAILLE = 0.1f
internal val CONTOUR_MIN = 2.25.dp

/*
 * Rayons des ombres, en dp sur 960 (1 dp = 1,33 px de la référence 1280). Un flou CSS b vaut un écart type b / 2 ; le
 * rayon d'une ombre Android vaut environ 0,87 × b : 54 px → 35 dp, 34 px → 22 dp, 20 px → 13 dp, 10 px et l'ombre
 * de 4 px vers le bas → 6,5 dp. Comme le text-shadow du CSS, les ombres de nuit partent des lettres pleines (pas du
 * contour : trop clair sur les captures du 31/10) ; la lueur cyan, plus serrée (2 dp), laisse le blanc bien blanc.
 */
internal val OMBRE_LARGE = 35.dp
internal val OMBRE_MOYENNE = 22.dp
internal val OMBRE_PROCHE = 13.dp
internal val OMBRE_SERREE = 6.5.dp
internal val OMBRE_BAS_DECALAGE = 3.dp
internal val LUEUR_CYAN = 2.dp
