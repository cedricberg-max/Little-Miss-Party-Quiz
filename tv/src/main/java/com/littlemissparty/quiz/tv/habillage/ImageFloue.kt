package com.littlemissparty.quiz.tv.habillage

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Photo floue qui devient nette, pour le jeu de l'image mystère : [nettete] va de 0 (méconnaissable) à 1 (nette).
 *
 * Le flou vient de petites copies de la photo (de 8 à 120 pixels de large, calculées une seule fois),
 * agrandies avec lissage ; on passe en fondu d'une copie à la suivante. Ça marche sur la Mi Box
 * (Android 9), où le flou de Compose n'existe pas, et ne coûte presque rien à chaque image.
 * [nettete] est lu au dessin seulement : l'animer ne recompose rien.
 */
@Composable
fun ImageFloue(photo: ImageBitmap, nettete: () -> Float, modifier: Modifier = Modifier) {
    val niveaux = remember(photo) { niveauxDeFlou(photo) }
    Canvas(modifier.clearAndSetSemantics {}) {
        // Photo entière, centrée, sans déformation.
        val echelle = min(size.width / photo.width, size.height / photo.height)
        val l = (photo.width * echelle).roundToInt()
        val h = (photo.height * echelle).roundToInt()
        val ou = IntOffset(((size.width - l) / 2).roundToInt(), ((size.height - h) / 2).roundToInt())
        val cible = IntSize(l, h)
        val (bas, part) = niveauDeNettete(nettete(), niveaux.size)
        fun dessine(i: Int, alpha: Float) = drawImage(
            niveaux[i], srcSize = IntSize(niveaux[i].width, niveaux[i].height),
            dstOffset = ou, dstSize = cible, alpha = alpha, filterQuality = FilterQuality.Low,
        )
        dessine(bas, 1f)
        if (part > 0f && bas + 1 < niveaux.size) dessine(bas + 1, part)
    }
}

/** Largeurs des copies, de la plus floue à la plus nette ; la photo d'origine vient en dernier. */
private val LARGEURS = intArrayOf(8, 14, 24, 40, 70, 120)

private fun niveauxDeFlou(photo: ImageBitmap): List<ImageBitmap> {
    val source = photo.asAndroidBitmap()
    val copies = LARGEURS.filter { it < source.width }.map { l ->
        val h = (source.height.toLong() * l / source.width).toInt().coerceAtLeast(1)
        Bitmap.createScaledBitmap(source, l, h, true).asImageBitmap()
    }
    return copies + photo
}

/** Copie à dessiner pour une netteté donnée, et la part de la suivante à fondre par-dessus. */
internal fun niveauDeNettete(nettete: Float, n: Int): Pair<Int, Float> {
    if (n <= 1) return 0 to 0f
    val f = nettete.coerceIn(0f, 1f) * (n - 1)
    val bas = f.toInt().coerceAtMost(n - 1)
    return bas to (f - bas)
}
