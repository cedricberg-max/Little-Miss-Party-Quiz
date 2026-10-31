package com.littlemissparty.quiz.tv.habillage

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.ParentDataModifier
import androidx.compose.ui.layout.findRootCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/** Largeur de l'écran des planches, en px. */
internal const val LARGEUR_PLANCHE = 1280f

/**
 * Où poser un élément, en px d'un écran de 1280 × 720 (planche) : [x] est son bord gauche ([ancreX] = 0) ou son
 * centre ([ancreX] = 0,5) ; [y] est son centre vertical.
 */
internal data class PlacePlanche(val x: Float, val y: Float, val ancreX: Float = 0.5f) : ParentDataModifier {
    override fun Density.modifyParentData(parentData: Any?) = this@PlacePlanche
}

/** Ce que voit le contenu d'un [CalquePlanche] : [k] (taille des éléments, 1 = planche) et la place de chacun. */
internal class CalquePlancheScope(val k: Float, private val densite: Density) {
    /** Pose l'élément à sa place sur la planche. */
    fun Modifier.planche(x: Float, y: Float, ancreX: Float = 0.5f): Modifier = this.then(PlacePlanche(x, y, ancreX))

    /** [px] px de la planche, en dp de cet écran. */
    fun px(px: Float): Dp = (px * 0.75f * k).dp

    /** [px] px de la planche, en taille de lettres de cet écran. */
    fun pxSp(px: Float): TextUnit = with(densite) { px(px).toSp() }
}

/**
 * Pose ses éléments aux positions fixes de la planche (1280 × 720, multipliées par la largeur réelle de l'écran),
 * quelle que soit la place du calque dans l'écran : la scène peut rapetisser, les onglets gardent leur taille.
 *
 * Jamais coupé : si l'ensemble ne tient plus dans le calque (5 à 8 équipes, les pastilles sur deux rangs), tout
 * rapetisse d'un même facteur et remonte juste assez ; quand il tient (1 à 4 équipes), rien ne bouge.
 */
@Composable
internal fun CalquePlanche(modifier: Modifier = Modifier, contenu: @Composable CalquePlancheScope.() -> Unit) {
    val densite = LocalDensity.current
    var origine by remember { mutableStateOf<Offset?>(null) }
    var largeurRacine by remember { mutableStateOf<Int?>(null) }
    val largeurEcranPx = largeurRacine?.toFloat() ?: with(densite) { LocalConfiguration.current.screenWidthDp.dp.toPx() }
    val k = with(densite) { largeurEcranPx.toDp().value } / (LARGEUR_PLANCHE * 0.75f)
    val portee = remember(k, densite) { CalquePlancheScope(k, densite) }
    Layout(
        content = { portee.contenu() },
        modifier = modifier.onGloballyPositioned {
            origine = it.positionInRoot()
            largeurRacine = it.findRootCoordinates().size.width
        },
    ) { mesurables, c ->
        val enfants = mesurables.map { it.measure(Constraints()) }
        val places = mesurables.map { it.parentData as? PlacePlanche ?: PlacePlanche(LARGEUR_PLANCHE / 2, 360f) }
        val w = if (c.hasBoundedWidth) c.maxWidth else enfants.maxOfOrNull { it.width } ?: 0
        val h = if (c.hasBoundedHeight) c.maxHeight else enfants.maxOfOrNull { it.height } ?: 0
        layout(w, h) {
            // Avant de connaître sa place dans l'écran, rien n'est posé (pas d'éclair à la mauvaise place).
            val o = origine ?: return@layout
            val f = largeurEcranPx / LARGEUR_PLANCHE
            val cadres = enfants.mapIndexed { i, p ->
                val pl = places[i]
                val gauche = pl.x * f - pl.ancreX * p.width - o.x
                val haut = pl.y * f - p.height / 2f - o.y
                Rect(gauche, haut, gauche + p.width, haut + p.height)
            }
            val (e, decalage) = ajusteALaPlace(cadres, w.toFloat(), h.toFloat())
            val centre = cadres.reduceOrNull(::unir)?.center ?: Offset.Zero
            enfants.forEachIndexed { i, p ->
                val cc = centre + (cadres[i].center - centre) * e + decalage
                p.placeWithLayer((cc.x - p.width / 2f).roundToInt(), (cc.y - p.height / 2f).roundToInt()) { scaleX = e; scaleY = e }
            }
        }
    }
}

/**
 * Pour des éléments aux [cadres] (dans le calque de [largeur] × [hauteur]) : le facteur commun (≤ 1, autour du centre
 * de l'ensemble) et le décalage qui les font tenir en entier. Ce qui tient déjà ne bouge pas : facteur 1, décalage nul.
 */
internal fun ajusteALaPlace(cadres: List<Rect>, largeur: Float, hauteur: Float): Pair<Float, Offset> {
    val tout = cadres.reduceOrNull(::unir) ?: return 1f to Offset.Zero
    val e = minOf(1f, largeur / tout.width.coerceAtLeast(1f), hauteur / tout.height.coerceAtLeast(1f))
    val apres = Rect(
        tout.center.x - tout.width * e / 2, tout.center.y - tout.height * e / 2,
        tout.center.x + tout.width * e / 2, tout.center.y + tout.height * e / 2,
    )
    fun recale(debut: Float, fin: Float, limite: Float) = when {
        debut < 0f -> -debut
        fin > limite -> limite - fin
        else -> 0f
    }
    return e to Offset(recale(apres.left, apres.right, largeur), recale(apres.top, apres.bottom, hauteur))
}

/** Le plus petit cadre qui contient [a] et [b]. */
internal fun unir(a: Rect, b: Rect) = Rect(minOf(a.left, b.left), minOf(a.top, b.top), maxOf(a.right, b.right), maxOf(a.bottom, b.bottom))
