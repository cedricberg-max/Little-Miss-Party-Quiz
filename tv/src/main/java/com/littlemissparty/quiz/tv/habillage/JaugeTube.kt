package com.littlemissparty.quiz.tv.habillage

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlin.math.roundToInt

/**
 * Jauge de score du Game Show en tube de verre 3D (planches calculées à l'avance, res/drawable-nodpi/gs_jauge_*) :
 * bague chromée en haut, socle en bas, verre étiré entre les deux, liquide néon teint à la couleur de l'équipe. Vue de
 * côté : le corps du tube et le liquide sont les mêmes sur toute leur hauteur, l'écran les étire. Images à la largeur
 * du tube : haut 1/2, bas 5/8. Rien n'est calculé en 3D sur la box : quatre petites images étirées.
 */
internal class PlanchesJauge(val haut: ImageBitmap, val corps: ImageBitmap, val bas: ImageBitmap, val liquide: ImageBitmap)

/** Les planches de la jauge, ou null (look Classique, ou une image manque : la jauge garde un dessin simple). */
@Composable
internal fun planchesJauge(): PlanchesJauge? {
    if (!Look.gs) return null
    val context = LocalContext.current
    return remember {
        runCatching {
            val images = listOf("gs_jauge_haut", "gs_jauge_corps", "gs_jauge_bas", "gs_jauge_liquide").map { ImagesAppli.lire(context, it) }
            if (images.any { it == null }) null
            else images.filterNotNull().let { (h, c, b, l) -> PlanchesJauge(h, c, b, l) }
        }.getOrNull()
    }
}

/** Le tube sur toute la toile, rempli à [part] (0 à 1) d'un liquide [couleur]. */
internal fun DrawScope.dessineJauge(p: PlanchesJauge, part: Float, couleur: Color) {
    val w = size.width
    val hHaut = w * 0.5f
    val hBas = w * 0.625f
    // Intérieur du verre : sous la bague du haut, au-dessus du socle.
    val y0 = hHaut * 0.52f
    val y1 = size.height - hBas + w * 0.16f
    drawRoundRect(GS.Nuit.copy(alpha = 0.85f), Offset(w * 0.04f, y0), Size(w * 0.92f, (y1 - y0).coerceAtLeast(1f)), CornerRadius(w * 0.06f))
    val niveau = (y1 - y0) * part.coerceIn(0f, 1f)
    if (niveau >= 1f) {
        val haut = y1 - niveau
        image(p.liquide, 0f, haut, w, niveau, ColorFilter.tint(couleur, BlendMode.Modulate))
        // Surface du liquide : un trait clair et sa lueur.
        drawRect(Brush.verticalGradient(listOf(Color.Transparent, couleur.copy(alpha = 0.55f), Color.Transparent), haut - w * 0.12f, haut + w * 0.12f), Offset(w * 0.06f, haut - w * 0.12f), Size(w * 0.88f, w * 0.24f))
        drawRect(lerpVers(couleur, Color.White, 0.7f), Offset(w * 0.06f, haut - 1.5f), Size(w * 0.88f, 3f))
    }
    image(p.corps, 0f, hHaut, w, size.height - hHaut - hBas)
    image(p.haut, 0f, 0f, w, hHaut)
    image(p.bas, 0f, size.height - hBas, w, hBas)
}

/** Sans planches : le même tube en dessin simple (verre sombre, bord néon, liquide qui monte du bas). */
internal fun DrawScope.dessineJaugeSimple(part: Float, couleur: Color) {
    val w = size.width
    val r = CornerRadius(w * 0.18f)
    drawRoundRect(GS.Nuit.copy(alpha = 0.85f), cornerRadius = r)
    val niveau = (size.height - 8f) * part.coerceIn(0f, 1f)
    if (niveau >= 1f) {
        drawRoundRect(
            Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.9f), couleur, couleur.copy(alpha = 0.55f)), size.height - 4f - niveau, size.height - 4f),
            Offset(4f, size.height - 4f - niveau), Size(w - 8f, niveau), CornerRadius(w * 0.14f),
        )
    }
    drawRoundRect(couleur.copy(alpha = 0.55f), cornerRadius = r, style = androidx.compose.ui.graphics.drawscope.Stroke(3f))
}

private fun DrawScope.image(img: ImageBitmap, x: Float, y: Float, w: Float, h: Float, filtre: ColorFilter? = null) {
    if (w < 1f || h < 1f) return
    drawImage(img, IntOffset.Zero, IntSize(img.width, img.height), IntOffset(x.roundToInt(), y.roundToInt()), IntSize(w.roundToInt(), h.roundToInt()), colorFilter = filtre)
}
