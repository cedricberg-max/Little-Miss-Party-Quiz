package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.inset
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/*
 * Les coffres mystères (remplacent les Portes mystères) : des coffres de toutes formes posés sur les gradins d'une estrade
 * laquée prune, ouverts chacun leur tour par les équipes. Bonus, malus, le classement après chaque coffre… puis la bombe,
 * cachée avec un coffre en or.
 *
 * Ces écrans ne font qu'animer ce que la partie leur donne : le contenu d'un coffre est tiré par la box au moment
 * de l'ouverture, jamais par l'habillage. Les animations jouent leurs propres sons et préviennent par onFini ;
 * si l'écran est remplacé avant la fin, rien n'est bloqué. Tout tient de 1 à 8 équipes et de 1 à 21 coffres.
 */

/** Modèle de chaque coffre d'après son index, le même sur la TV et sur les tablettes (coffre-<modèle+1>.svg). */
val MODELES_COFFRES = listOf(0, 3, 1, 5, 2, 4, 1, 5, 0, 4, 3, 2, 5, 0, 2, 4, 1, 3)

fun modeleCoffre(index: Int): Int = MODELES_COFFRES[Math.floorMod(index, MODELES_COFFRES.size)]

/**
 * « +150 POINTS », « −100 POINTS » (signe moins U+2212), « 0 POINT » quand l'équipe n'avait rien à perdre ;
 * la bombe ([delta] null) vaut [pointsBombe], les points vraiment retirés.
 */
fun textePointsCoffre(delta: Int?, pointsBombe: Int = POINTS_BOMBE): String {
    val v = delta ?: pointsBombe
    return if (v == 0) "0 POINT" else texteValeur(v) + " POINTS"
}

/** Un coffre gagnant : les bonus valent au moins 50 ; 0 est un malus qui n'a rien pu retirer. */
private fun estBonus(delta: Int) = delta > 0

const val POINTS_BOMBE = -300

/** Durée d'une ouverture qui finit sur la carte BONUS / MALUS (verdict à 1,55 s + la carte). */
const val OUVERTURE_CARTE_MS = 3_850L

/** Un malus : l'orage et la colère du coffre d'abord, la carte MALUS ensuite ([T_VERDICT_MALUS] + la carte). Moins que CHEST_SHOW_MS. */
const val OUVERTURE_MALUS_MS = 4_300L

const val OUVERTURE_COFFRE_MS = 3_200L
/** La bombe fonce vers l'écran puis explose : moins que CHEST_SHOW_MS (4,5 s), le temps que la partie laisse à l'ouverture. */
const val OUVERTURE_BOMBE_MS = 4_400L
const val OUVERTURE_OR_MS = 4_200L
/** L'annonce de la bombe puis du coffre en or : moins que BOMB_ALERT_MS (5 s) dans la partie. */
const val ALERTE_BOMBE_MS = 4_900L

/** Le classement après un coffre (CHEST_RANKING_MS dans la partie). */
const val CLASSEMENT_COFFRE_MS = 2_900L

private const val T_ENTREE = 450f
private const val T_OUVRE = 1_300f
private const val T_TEXTE = 1_550f
/** Bombe : elle a jailli du coffre et commence à foncer vers l'écran. */
private const val T_POSE = 1_750f
private const val T_BOUM = 3_000f
/** Malus : le couvercle se referme d'un coup, le coffre boude et trépigne. */
private const val T_CLAQUE = 1_720f
/** Malus : la carte MALUS (ou « Oups ! ») arrive après l'orage, pour qu'on le voie avant qu'elle le recouvre. */
private const val T_VERDICT_MALUS = 2_000f
/** Malus : les éclairs de l'orage. */
private val ECLAIRS = listOf(1_450f, 2_080f, 2_700f)

/* ------------------------------------------------------------------ Modèles */

/** Un modèle de coffre : taille (dp à l'échelle 1), hauteur du couvercle (part de la hauteur), forme et couleurs. */
private class ModeleCoffre(
    val largeur: Float, val hauteur: Float, val couvercle: Float, val bombe: Boolean,
    val clair: Color, val fonce: Color, val trait: Color,
)

private val MODELES = listOf(
    // 0 Grand coffre au trésor, rose poudré, bandes dorées.
    ModeleCoffre(118f, 94f, 0.38f, true, Color(0xFFF6C6D5), Color(0xFFDC8EAC), Color(0xFF9C4F6E)),
    // 1 Malle de voyage, bleu dragée, sangles et coins de laiton.
    ModeleCoffre(100f, 106f, 0.2f, false, Color(0xFFC8DCF6), Color(0xFF8EAEDD), Color(0xFF3F5E8C)),
    // 2 Petit écrin à pieds, vert d'eau, gemme sur le couvercle.
    ModeleCoffre(80f, 64f, 0.44f, true, Color(0xFFC8EFDF), Color(0xFF86C8AD), Color(0xFF2F6E58)),
    // 3 Coffre plat, lavande, clous dorés.
    ModeleCoffre(126f, 70f, 0.3f, false, Color(0xFFDED2F7), Color(0xFFA895DC), Color(0xFF5A458F)),
    // 4 Boîte à chapeau ronde, pêche, ruban crème et nœud.
    ModeleCoffre(96f, 90f, 0.26f, false, Color(0xFFFFDCC2), Color(0xFFF2A97E), Color(0xFFA55A35)),
    // 5 Coffre bombé crème à bandes prune.
    ModeleCoffre(108f, 90f, 0.36f, true, Color(0xFFF8EEDF), Color(0xFFDCC5A2), Color(0xFF8A6A44)),
)

private val OR_CLAIR = Color(0xFFFFF3D1)
private val OR_MOYEN = Color(0xFFE9C27A)
private val OR_FONCE = Color(0xFFA8782F)
private val PRUNE = Color(0xFF8E5BB5)
private val INTERIEUR = Color(0xFF2A1640)
private val SUIE = Color(0xFF231B2C)
private val BONUS_VERT = Color(0xFF2EE86B)
private val MALUS_CORAIL = Color(0xFFFF5A5F)
private val LUEUR_OR = Color(0xFFFFD98A)
private val LUEUR_MALUS = Color(0xFFB9A8D8)
private val LUEUR_BOMBE = Color(0xFFFF6A3D)

internal fun largeurModele(modele: Int): Float = MODELES[modele].largeur

/** Position de la plaque numérotée sur la face avant (fractions de la largeur et de la hauteur du coffre). */
private fun plaque(m: ModeleCoffre): Rect {
    val l = if (m === MODELES[4]) 0.30f else m.couvercle
    val pw = 0.36f
    val ph = min(0.3f, (1f - l) * 0.56f)
    val cy = l + (1f - l) * (if (m === MODELES[2]) 0.42f else 0.46f)
    return Rect(0.5f - pw / 2, cy - ph / 2, 0.5f + pw / 2, cy + ph / 2)
}

/**
 * Dessine un coffre qui remplit la zone ; sa base touche le bas de la zone. [ouverture] : 0 fermé, 1 couvercle
 * relevé ; [lueur] : la lumière qui sort quand il est ouvert ; [assombri] : 0 neuf, 0,25 déjà ouvert, 0,75 brûlé.
 */
private fun DrawScope.dessineCoffre(modele: Int, ouverture: Float, lueur: Color?, assombri: Float, dore: Boolean = false, enScene: Boolean = false) {
    // Game Show : les coffres 3D validés (CoffresGs.kt) ; le dessin ci-dessous reste celui du Classique.
    if (Look.gs && dessineCoffreGs(modele, ouverture, assombri, dore, enScene)) return
    val m = MODELES[modele]
    val w = size.width
    val h = size.height
    fun ton(c: Color) = if (assombri <= 0f) c else lerp(c, SUIE, assombri)
    // [dore] : le coffre en or de l'annonce, corps doré et bandes plus claires pour rester lisibles.
    val clair = ton(if (dore) Color(0xFFFFE7A3) else m.clair)
    val fonce = ton(if (dore) Color(0xFFD9A441) else m.fonce)
    val trait = ton(if (dore) OR_FONCE else m.trait).copy(alpha = 0.7f)
    val or = if (dore) listOf(ton(Color(0xFFFFFBEA)), ton(Color(0xFFFFE08A)), ton(Color(0xFFB07A22))) else listOf(ton(OR_CLAIR), ton(OR_MOYEN), ton(OR_FONCE))
    val ep = 1.6f * density * (w / (m.largeur * density)).coerceAtLeast(0.6f)
    val rond = modele == 4
    val pied = if (modele == 2) 0.1f * h else 0f
    val l = (if (rond) 0.30f else m.couvercle) * h
    val bas = h - pied

    // Corps.
    val corps = Path().apply {
        if (rond) {
            addRect(Rect(0f, l - 0.02f * h, w, bas - 0.07f * h))
            addOval(Rect(0f, bas - 0.14f * h, w, bas))
        } else {
            addRoundRect(RoundRect(0f, l, w, bas, CornerRadius.Zero, CornerRadius.Zero, CornerRadius(0.06f * w), CornerRadius(0.06f * w)))
        }
    }
    // Pieds de l'écrin : il repose dessus.
    if (pied > 0f) for (fx in listOf(0.14f, 0.86f)) {
        drawOval(Brush.verticalGradient(or, bas - pied * 0.3f, h), Offset(w * fx - pied * 0.7f, bas - pied * 0.4f), Size(pied * 1.4f, pied * 1.4f))
    }
    drawPath(corps, Brush.verticalGradient(listOf(clair, fonce), l, bas))
    drawPath(corps, Brush.horizontalGradient(listOf(Color.White.copy(alpha = 0.2f), Color.Transparent, Color.Black.copy(alpha = 0.1f)), 0f, w))
    clipPath(corps) {
        when (modele) {
            0 -> listOf(0.18f, 0.82f).forEach { fx -> bande(fx * w, 0.08f * w, 0f, h, or) }
            1 -> {
                listOf(0.22f, 0.78f).forEach { fx -> drawRect(ton(lerp(m.fonce, m.trait, 0.45f)), Offset(fx * w - 0.035f * w, 0f), Size(0.07f * w, h)) }
                listOf(0f, w - 0.1f * w).forEach { x -> drawRect(Brush.verticalGradient(or), Offset(x, bas - 0.1f * w), Size(0.1f * w, 0.1f * w)) }
            }
            2 -> drawRoundRect(or[1].copy(alpha = 0.9f), Offset(0.05f * w, l + 0.06f * h), Size(0.9f * w, bas - l - 0.12f * h), CornerRadius(0.04f * w), style = Stroke(ep))
            3 -> for (k in 0..6) drawCircle(Brush.radialGradient(or.reversed()), 0.018f * w, Offset(w * (0.08f + k * 0.14f), bas - 0.08f * h))
            4 -> drawRect(Brush.horizontalGradient(listOf(ton(Color(0xFFFFF4E4)), ton(Color(0xFFF1DFC6))), w * 0.43f, w * 0.57f), Offset(w * 0.43f, 0f), Size(w * 0.14f, h))
            5 -> listOf(0.62f, 0.86f).forEach { fy -> drawRect(ton(PRUNE), Offset(0f, l + (bas - l) * fy - 0.03f * h), Size(w, 0.06f * h)) }
        }
    }
    drawPath(corps, trait, style = Stroke(ep))

    // Ouverture : l'intérieur sombre et la lumière qui en sort.
    if (ouverture > 0f) {
        val bouche = Rect(0.05f * w, l - 0.06f * h, 0.95f * w, l + 0.06f * h)
        drawOval(INTERIEUR, bouche.topLeft, bouche.size)
        if (lueur != null) {
            val c = Offset(w / 2, l)
            drawOval(Brush.radialGradient(listOf(lueur.copy(alpha = 0.95f), lueur.copy(alpha = 0.35f), Color.Transparent), c, 0.5f * w), Offset(0.12f * w, l - 0.05f * h), Size(0.76f * w, 0.1f * h))
            drawCircle(Brush.radialGradient(listOf(lueur.copy(alpha = 0.55f * ouverture), Color.Transparent), c, 0.75f * w), 0.75f * w, c)
        }
    }

    // Couvercle (relevé et basculé en arrière quand le coffre s'ouvre).
    val levee = ouverture * 0.75f * l + ouverture * 0.12f * h
    withTransform({
        translate(top = -levee)
        rotate(-16f * ouverture, Offset(w * 0.96f, l))
    }) {
        val couv = Path().apply {
            when {
                rond -> {
                    addRect(Rect(-0.03f * w, 0.08f * h, 1.03f * w, l + 0.02f * h))
                    addOval(Rect(-0.03f * w, l - 0.05f * h, 1.03f * w, l + 0.05f * h))
                }
                m.bombe -> addRoundRect(RoundRect(-0.02f * w, 0f, 1.02f * w, l + 0.02f * h, CornerRadius(0.52f * w, l), CornerRadius(0.52f * w, l), CornerRadius.Zero, CornerRadius.Zero))
                else -> addRoundRect(RoundRect(-0.03f * w, 0f, 1.03f * w, l + 0.02f * h, CornerRadius(0.05f * w)))
            }
        }
        drawPath(couv, Brush.verticalGradient(listOf(lerp(clair, Color.White, 0.18f), fonce), 0f, l))
        clipPath(couv) {
            when (modele) {
                0 -> listOf(0.18f, 0.82f).forEach { fx -> bande(fx * w, 0.08f * w, 0f, l + 0.02f * h, or) }
                1 -> listOf(0.22f, 0.78f).forEach { fx -> drawRect(ton(lerp(m.fonce, m.trait, 0.45f)), Offset(fx * w - 0.035f * w, 0f), Size(0.07f * w, l)) }
                3 -> for (k in 0..6) drawCircle(Brush.radialGradient(or.reversed()), 0.016f * w, Offset(w * (0.08f + k * 0.14f), l - 0.07f * h))
                4 -> drawRect(Brush.horizontalGradient(listOf(ton(Color(0xFFFFF4E4)), ton(Color(0xFFF1DFC6))), w * 0.43f, w * 0.57f), Offset(w * 0.43f, 0f), Size(w * 0.14f, l + 0.05f * h))
                5 -> drawRect(ton(PRUNE), Offset(w * 0.46f, 0f), Size(w * 0.08f, l))
            }
        }
        drawPath(couv, trait, style = Stroke(ep))
        if (rond) {
            drawOval(Brush.verticalGradient(listOf(lerp(clair, Color.White, 0.3f), clair), 0f, 0.16f * h), Offset(-0.03f * w, 0f), Size(1.06f * w, 0.16f * h))
            drawOval(trait, Offset(-0.03f * w, 0f), Size(1.06f * w, 0.16f * h), style = Stroke(ep))
            // Nœud du ruban.
            val c = Offset(w / 2, 0.06f * h)
            val creme = ton(Color(0xFFFFF4E4))
            drawOval(creme, Offset(c.x - 0.2f * w, c.y - 0.07f * h), Size(0.19f * w, 0.1f * h))
            drawOval(creme, Offset(c.x + 0.01f * w, c.y - 0.07f * h), Size(0.19f * w, 0.1f * h))
            drawOval(trait.copy(alpha = 0.35f), Offset(c.x - 0.2f * w, c.y - 0.07f * h), Size(0.19f * w, 0.1f * h), style = Stroke(ep * 0.8f))
            drawOval(trait.copy(alpha = 0.35f), Offset(c.x + 0.01f * w, c.y - 0.07f * h), Size(0.19f * w, 0.1f * h), style = Stroke(ep * 0.8f))
            drawCircle(lerp(creme, ton(m.fonce), 0.25f), 0.045f * w, c)
        } else {
            // Liseré doré entre le couvercle et le corps.
            drawRoundRect(Brush.verticalGradient(or, l - 0.035f * h, l + 0.035f * h), Offset(-0.025f * w, l - 0.035f * h), Size(1.05f * w, 0.07f * h), CornerRadius(0.02f * w))
        }
        if (modele == 2) {
            val g = Offset(w / 2, 0.06f * h)
            drawCircle(Brush.radialGradient(listOf(ton(Color.White), ton(Color(0xFFFFC4DD)), ton(Color(0xFFF27DB0))), g - Offset(0.02f * w, 0.02f * w), 0.08f * w), 0.065f * w, g)
            drawCircle(or[1], 0.065f * w, g, style = Stroke(ep))
        }
    }

    // Plaque de la serrure (le numéro ou la valeur sont écrits par-dessus).
    if (ouverture <= 0f) {
        val p = plaque(m)
        val r = Rect(p.left * w, p.top * h, p.right * w, p.bottom * h)
        drawRoundRect(Color.Black.copy(alpha = 0.18f), r.topLeft + Offset(0f, 0.012f * h), r.size, CornerRadius(0.05f * w))
        drawRoundRect(Brush.verticalGradient(or, r.top, r.bottom), r.topLeft, r.size, CornerRadius(0.05f * w))
        drawRoundRect(ton(OR_FONCE).copy(alpha = 0.6f), r.topLeft, r.size, CornerRadius(0.05f * w), style = Stroke(ep))
    }
}

private fun DrawScope.bande(cx: Float, larg: Float, y0: Float, y1: Float, or: List<Color>) {
    drawRect(Brush.horizontalGradient(listOf(or[2], or[0], or[1], or[2]), cx - larg / 2, cx + larg / 2), Offset(cx - larg / 2, y0), Size(larg, y1 - y0))
    var y = y0 + larg * 0.8f
    while (y < y1 - larg * 0.4f) { drawCircle(or[2].copy(alpha = 0.8f), larg * 0.13f, Offset(cx, y)); y += larg * 1.4f }
}

/** La bombe : boule prune laquée, culot doré, mèche dont il reste [meche] (0..1), étincelle au bout. */
internal fun DrawScope.dessineBombe(c: Offset, r: Float, t: Float, meche: Float, etincelle: Boolean = true) {
    drawCircle(Brush.radialGradient(listOf(Color(0xFF6A4A8E), Color(0xFF2A1B42), Color(0xFF0E0918)), c - Offset(r * 0.35f, r * 0.4f), r * 1.5f), r, c)
    drawCircle(Neon.Halo.copy(alpha = 0.35f), r, c, style = Stroke(r * 0.06f))
    drawOval(Color.White.copy(alpha = 0.32f), c - Offset(r * 0.62f, r * 0.68f), Size(r * 0.5f, r * 0.32f))
    // Culot doré, penché vers la droite.
    rotate(35f, c) {
        drawRoundRect(Brush.horizontalGradient(listOf(OR_FONCE, OR_CLAIR, OR_MOYEN, OR_FONCE), c.x - r * 0.28f, c.x + r * 0.28f), Offset(c.x - r * 0.28f, c.y - r * 1.16f), Size(r * 0.56f, r * 0.3f), CornerRadius(r * 0.06f))
    }
    if (meche <= 0f) return
    val depart = c + Offset(r * 0.66f, -r * 0.92f)
    val chemin = Path()
    val pas = 18
    var bout = depart
    for (s in 0..pas) {
        val f = s / pas.toFloat() * meche
        val p = depart + Offset(r * 0.55f * f + r * 0.18f * sin(f * 5f), -r * 0.9f * f + r * 0.12f * (1 - cos(f * 4f)))
        if (s == 0) chemin.moveTo(p.x, p.y) else chemin.lineTo(p.x, p.y)
        bout = p
    }
    drawPath(chemin, Color(0xFFE8D8B8), style = Stroke(r * 0.1f, cap = StrokeCap.Round))
    drawPath(chemin, Color(0xFF9A8460), style = Stroke(r * 0.1f, cap = StrokeCap.Round, pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(r * 0.06f, r * 0.1f))))
    if (!etincelle) return
    val vibre = 0.75f + 0.25f * sin(t / 37f)
    drawCircle(Brush.radialGradient(listOf(Color(0xFFFFF6C8), Color(0xFFFFB347).copy(alpha = 0.7f), Color.Transparent), bout, r * 0.7f * vibre), r * 0.7f * vibre, bout)
    for (k in 0 until 7) {
        val a = k * (2f * PI.toFloat() / 7f) + t / 120f
        val lg = r * (0.35f + 0.25f * abs(sin(t / 53f + k)))
        drawLine(Color(0xFFFFE9A0), bout, bout + Offset(cos(a) * lg, sin(a) * lg), r * 0.05f, StrokeCap.Round)
    }
}

/** Petite estrade ronde laquée prune, bordée d'or, sur laquelle on pose un objet (coffre agrandi, bombe). */
internal fun DrawScope.estradeRonde(cx: Float, haut: Float, rx: Float, ry: Float, epaisseur: Float) {
    drawOval(Brush.radialGradient(listOf(Neon.Or.copy(alpha = 0.25f), Color.Transparent), Offset(cx, haut + epaisseur), rx * 1.6f), Offset(cx - rx * 1.6f, haut - ry), Size(rx * 3.2f, ry * 2f + epaisseur * 3f))
    val face = Path().apply {
        moveTo(cx - rx, haut); lineTo(cx - rx, haut + epaisseur)
        arcTo(Rect(cx - rx, haut + epaisseur - ry, cx + rx, haut + epaisseur + ry), 180f, -180f, false)
        lineTo(cx + rx, haut); close()
    }
    drawPath(face, Brush.verticalGradient(listOf(Color(0xFF3A1A5E), Color(0xFF1C0C30)), haut, haut + epaisseur + ry))
    drawArc(Neon.Or.copy(alpha = 0.8f), 0f, 180f, false, Offset(cx - rx, haut + epaisseur - ry), Size(rx * 2, ry * 2), style = Stroke(2f * density))
    drawOval(Brush.verticalGradient(listOf(Color(0xFF5A2F86), Color(0xFF3A1B5E)), haut - ry, haut + ry), Offset(cx - rx, haut - ry), Size(rx * 2, ry * 2))
    drawOval(Neon.Or, Offset(cx - rx, haut - ry), Size(rx * 2, ry * 2), style = Stroke(2.5f * density))
    drawOval(Color.White.copy(alpha = 0.08f), Offset(cx - rx * 0.7f, haut - ry * 0.7f), Size(rx * 1.4f, ry * 1.0f))
}

/* ------------------------------------------------------------------ Gradins et coffres */

/** Une marche de l'estrade : bord avant [avant], profondeur [prof], échelle des coffres posés dessus, étendue. */
private class Marche(val avant: Float, val prof: Float, val echelle: Float, val gauche: Float, val droite: Float) {
    val base get() = avant - prof * 0.42f
}

private fun marches(rangees: Int): List<Marche> = when (rangees) {
    1 -> listOf(Marche(452f, 44f, 1.05f, 70f, 890f))
    2 -> listOf(Marche(338f, 36f, 0.86f, 110f, 850f), Marche(464f, 42f, 1f, 50f, 910f))
    else -> listOf(Marche(276f, 30f, 0.72f, 170f, 790f), Marche(370f, 34f, 0.85f, 110f, 850f), Marche(466f, 40f, 1f, 50f, 910f))
}

/** Nombre de coffres par rangée, du fond vers l'avant (l'avant reçoit les coffres en plus). */
internal fun repartitionCoffres(nombre: Int): List<Int> {
    if (nombre <= 0) return emptyList()
    val rangees = when { nombre <= 6 -> 1; nombre <= 12 -> 2; else -> 3 }
    val base = nombre / rangees
    val reste = nombre % rangees
    return List(rangees) { r -> base + if (r >= rangees - reste) 1 else 0 }
}

/** Place de chaque coffre (centre x, base y, échelle), numérotés de gauche à droite en partant du fond. */
private fun placesCoffres(nombre: Int): List<Triple<Float, Float, Float>> {
    val rep = repartitionCoffres(nombre)
    val ms = marches(rep.size)
    return rep.flatMapIndexed { r, n ->
        val m = ms[r]
        val g = m.gauche + 30f * m.echelle
        val d = m.droite - 30f * m.echelle
        List(n) { i -> Triple(g + (d - g) * (i + 0.5f) / n, m.base, m.echelle) }
    }
}

private fun DrawScope.gradins(rangees: Int) {
    val d = density
    val ms = marches(rangees)
    ms.forEachIndexed { k, m ->
        val haut = (m.avant - m.prof) * d
        val avant = m.avant * d
        val bas = (if (k + 1 < ms.size) ms[k + 1].avant - ms[k + 1].prof else 540f) * d
        val retrait = m.prof * 0.6f * d
        // Dessus de la marche (laque prune) puis contremarche plus sombre.
        val dessus = Path().apply {
            moveTo(m.gauche * d + retrait, haut); lineTo(m.droite * d - retrait, haut); lineTo(m.droite * d, avant); lineTo(m.gauche * d, avant); close()
        }
        if (Look.gs) {
            // Game Show (maquette des coffres 3D) : laque nuit, nez de marche en néon cyan, arête du fond rose.
            drawPath(dessus, Brush.verticalGradient(listOf(Color(0xFF1C1238), Color(0xFF2A1B52)), haut, avant))
            drawRect(Brush.verticalGradient(listOf(Color(0xFF15102C), Color(0xFF0A0718)), avant, bas), Offset(m.gauche * d, avant), Size((m.droite - m.gauche) * d, bas - avant))
            drawRect(Brush.verticalGradient(listOf(GS.Cyan.copy(alpha = 0.28f), Color.Transparent), avant, avant + 18f * d), Offset(m.gauche * d, avant), Size((m.droite - m.gauche) * d, 18f * d))
            drawLine(GS.Cyan.copy(alpha = 0.35f), Offset(m.gauche * d, avant), Offset(m.droite * d, avant), 7f * d)
            drawLine(GS.CyanClair, Offset(m.gauche * d, avant), Offset(m.droite * d, avant), 2f * d)
            drawLine(GS.Rose.copy(alpha = 0.55f), Offset(m.gauche * d + retrait, haut), Offset(m.droite * d - retrait, haut), 1.5f * d)
            return@forEachIndexed
        }
        drawPath(dessus, Brush.verticalGradient(listOf(Color(0xFF55297F), Color(0xFF41206A)), haut, avant))
        drawPath(dessus, Brush.horizontalGradient(listOf(Color.Transparent, Color.White.copy(alpha = 0.07f), Color.Transparent), m.gauche * d, m.droite * d))
        drawRect(Brush.verticalGradient(listOf(Color(0xFF2A1244), Color(0xFF190A2C)), avant, bas), Offset(m.gauche * d, avant), Size((m.droite - m.gauche) * d, bas - avant))
        // Bandeau lumineux doux sous le nez de marche, filet d'or sur le bord.
        drawRect(Brush.verticalGradient(listOf(Neon.Halo.copy(alpha = 0.22f), Color.Transparent), avant, avant + 16f * d), Offset(m.gauche * d, avant), Size((m.droite - m.gauche) * d, 16f * d))
        drawLine(Neon.Or.copy(alpha = 0.85f), Offset(m.gauche * d, avant), Offset(m.droite * d, avant), 2f * d)
        drawLine(Neon.Or.copy(alpha = 0.35f), Offset(m.gauche * d + retrait, haut), Offset(m.droite * d - retrait, haut), 1f * d)
    }
}

/**
 * Les coffres sur leurs gradins. [ouverts] : index → points gagnés ou perdus, null pour le coffre de la bombe.
 * [auTour] : l'équipe qui choisit (nom, couleur) ; [phaseDanger] : la bombe peut être dans n'importe quel coffre ;
 * [bombe] : les points vraiment retirés par la bombe (affichés sur son coffre), ou null pour « 💣 » seul ;
 * [or] : le coffre en or, une fois ouvert (pastille dorée « ⭐ +500 ») ; [bandeau] : false cache le bandeau du tour
 * (pendant le classement et l'alerte, qui ont leur propre titre en haut).
 */
@Composable
fun SceneCoffres(
    nombre: Int, ouverts: Map<Int, Int?>, auTour: Pair<String, Color>?, phaseDanger: Boolean,
    modifier: Modifier = Modifier, bombe: Int? = null, or: Int? = null, bandeau: Boolean = true,
) {
    ChargerCoffresGs()
    val places = remember(nombre) { placesCoffres(nombre) }
    val rangees = remember(nombre) { repartitionCoffres(nombre).size }
    val boucle = rememberInfiniteTransition(label = "coffres")
    val pouls by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(1_200), RepeatMode.Reverse), label = "pouls")
    Echelle(960.dp, 540.dp, modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().clearAndSetSemantics {}.drawWithCache { onDrawBehind { gradins(rangees) } })
        if (phaseDanger) {
            // Lueur rouge-ambre qui respire lentement au pied des gradins : la tension monte, sans clignoter.
            Box(
                Modifier.fillMaxSize().clearAndSetSemantics {}.drawBehind {
                    val c = Offset(size.width / 2, size.height * 1.05f)
                    drawRect(Brush.radialGradient(listOf(Color(0xFFFF4D3D).copy(alpha = 0.16f + 0.12f * pouls), Color(0xFFFF8A3D).copy(alpha = 0.06f), Color.Transparent), c, size.width * 0.65f))
                },
            )
        }
        places.forEachIndexed { i, (cx, base, e) ->
            val m = MODELES[modeleCoffre(i)]
            val w = m.largeur * e
            val h = m.hauteur * e
            val ouvert = ouverts.containsKey(i)
            val delta = ouverts[i]
            Box(Modifier.offset(x = (cx - w / 2).dp, y = (base - h).dp).size(w.dp, h.dp)) {
                Canvas(Modifier.fillMaxSize().clearAndSetSemantics {}) {
                    // Ombre au sol : le coffre est posé.
                    drawOval(Brush.radialGradient(listOf(Color.Black.copy(alpha = 0.55f), Color.Transparent)), Offset(-size.width * 0.08f, size.height - 6f * density * e), Size(size.width * 1.16f, 12f * density * e))
                    dessineCoffre(
                        modeleCoffre(i), if (ouvert) 1f else 0f,
                        when { !ouvert -> null; delta == null -> LUEUR_BOMBE; estBonus(delta) -> LUEUR_OR; else -> LUEUR_MALUS },
                        when { !ouvert -> 0f; delta == null -> 0.72f; else -> 0.28f },
                        enScene = true,
                    )
                }
                val p = plaque(m)
                if (!ouvert) {
                    Box(
                        Modifier.offset(x = (p.left * w).dp, y = (p.top * h).dp).size((p.width * w).dp, (p.height * h).dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        // Game Show : le numéro s'allume dans la fenêtre noire du coffre 3D.
                        Text(
                            "${i + 1}", maxLines = 1, softWrap = false,
                            style = if (Look.gs) styleCentre(maxOf(p.height * h * 0.66f, 14f * e).sp, Neon.Blanc).copy(fontFamily = PoliceGsChiffres, shadow = Shadow(GS.Cyan, Offset.Zero, 10f))
                            else styleCentre(maxOf(p.height * h * 0.72f, 15f * e).sp, Color(0xFF3A1C00)),
                        )
                    }
                } else {
                    // Coffre ouvert : sa valeur s'affiche sur la face avant.
                    val (fond, encre, texte) = when {
                        delta == null -> Triple(Color(0xFF2A0E1E), MALUS_CORAIL, if (bombe == null) "💣" else if (bombe == 0) "💣 0" else "💣 " + texteValeur(bombe))
                        i == or -> Triple(LUEUR_OR, Color(0xFF3A1C00), "⭐ " + texteValeur(delta))
                        estBonus(delta) -> Triple(BONUS_VERT, Neon.JusteTexte, texteValeur(delta))
                        else -> Triple(MALUS_CORAIL, Color.White, if (delta == 0) "0" else texteValeur(delta))
                    }
                    Text(
                        texte, maxLines = 1, softWrap = false,
                        style = styleCentre((15f * e).sp, encre),
                        modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = (h * 0.22f).dp)
                            .background(fond, RoundedCornerShape(50)).border((1.5f * e).dp, Color.White.copy(alpha = 0.7f), RoundedCornerShape(50))
                            .padding(horizontal = (8f * e).dp, vertical = (3f * e).dp),
                    )
                }
            }
        }
        if (bandeau) BandeauTour(auTour, Modifier.align(Alignment.TopCenter).padding(top = 14.dp))
        if (phaseDanger) PastilleDanger(pouls, Modifier.align(Alignment.TopStart).padding(start = 18.dp, top = 18.dp))
    }
}

private val styleBandeau = TextStyle(fontFamily = PoliceLmp, lineHeight = 1.2.em, lineHeightStyle = LIGNE_LMP, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)

@Composable
private fun BandeauTour(auTour: Pair<String, Color>?, modifier: Modifier = Modifier) {
    if (Look.gs) return BandeauTourGs(auTour, modifier)
    val couleur = auTour?.second ?: Neon.Or
    Row(
        modifier.widthIn(max = 700.dp).background(Neon.Nuit2.copy(alpha = 0.88f), RoundedCornerShape(50)).border(2.5.dp, couleur, RoundedCornerShape(50))
            .padding(horizontal = 26.dp, vertical = 6.dp).apparition(0, auTour?.first),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (auTour == null) {
            Text("Les Coffres mystères", maxLines = 1, style = styleBandeau.copy(color = Neon.OrClair))
        } else {
            Text(auTour.first, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false), style = styleBandeau.copy(color = couleur))
            Text(", choisissez un coffre !", maxLines = 1, softWrap = false, style = styleBandeau.copy(color = Neon.Blanc))
        }
    }
}

/**
 * Game Show (retour de cedric le 25/10 au soir : « pas très sexy ») : l'enseigne du tour en tube de néon de la
 * couleur de l'équipe, qui respire ; le nom de l'équipe brille dans sa couleur, le reste en blanc néon (Bungee).
 */
@Composable
private fun BandeauTourGs(auTour: Pair<String, Color>?, modifier: Modifier = Modifier) {
    val couleur = auTour?.second?.let(::enNeon) ?: GS.Cyan
    val souffle by rememberInfiniteTransition(label = "bandeau").animateFloat(0.55f, 1f, infiniteRepeatable(tween(1_100), RepeatMode.Reverse), label = "souffle")
    val lueur = { c: Color -> Shadow(c, Offset.Zero, 18f) }
    val style = TextStyle(fontFamily = PoliceGsTitre, fontSize = 24.sp, lineHeight = 1.15.em)
    Row(
        modifier.widthIn(max = 780.dp).apparition(0, auTour?.first)
            .drawBehind {
                val r = CornerRadius(size.height / 2)
                drawRoundRect(Brush.verticalGradient(listOf(Color(0xF0140A2A), Color(0xF00A0618))), cornerRadius = r)
                // Tube de néon : halo large et doux, halo serré, cœur coloré, filament blanc.
                drawRoundRect(couleur.copy(alpha = 0.16f * souffle), cornerRadius = r, style = Stroke(14.dp.toPx()))
                drawRoundRect(couleur.copy(alpha = 0.45f * souffle), cornerRadius = r, style = Stroke(6.dp.toPx()))
                drawRoundRect(couleur, cornerRadius = r, style = Stroke(2.6.dp.toPx()))
                drawRoundRect(Color.White.copy(alpha = 0.75f), cornerRadius = r, style = Stroke(0.9.dp.toPx()))
            }
            .padding(horizontal = 30.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (auTour == null) {
            Text("Les Coffres mystères", maxLines = 1, style = style.copy(color = GS.CyanClair, shadow = lueur(GS.Cyan)))
        } else {
            Text(
                auTour.first, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
                style = style.copy(color = lerp(couleur, Color.White, 0.25f), shadow = lueur(couleur)),
            )
            Text(", choisissez un coffre !", maxLines = 1, softWrap = false, style = style.copy(color = Color(0xFFF4F1FF), shadow = lueur(GS.Violet)))
        }
    }
}

@Composable
private fun PastilleDanger(pouls: Float, modifier: Modifier = Modifier) {
    Row(
        modifier
            .drawBehind { drawRoundRect(MALUS_CORAIL.copy(alpha = 0.18f + 0.22f * pouls), Offset(-6.dp.toPx(), -6.dp.toPx()), Size(size.width + 12.dp.toPx(), size.height + 12.dp.toPx()), CornerRadius(size.height)) }
            .background(Color(0xFF2A0E1E).copy(alpha = 0.9f), RoundedCornerShape(50)).border(2.dp, MALUS_CORAIL, RoundedCornerShape(50))
            .padding(horizontal = 14.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("💣", style = TextStyle(fontSize = 20.sp))
        Spacer(Modifier.width(6.dp))
        Text("Danger !", maxLines = 1, style = styleBandeau.copy(fontSize = 20.sp, color = Color(0xFFFFC2C4)))
    }
}

/* ------------------------------------------------------------------ Ouverture d'un coffre */

private class Projectile(val vx: Float, val vy: Float, val tourne: Float, val taille: Float, val teinte: Int)

private fun projectiles(graine: Long, nombre: Int): List<Projectile> {
    val r = java.util.Random(graine)
    return List(nombre) {
        Projectile((r.nextFloat() - 0.5f) * 520f, -(380f + r.nextFloat() * 520f), r.nextFloat() * 10f, 0.6f + r.nextFloat() * 0.8f, r.nextInt(3))
    }
}

internal fun rebondSortie(u: Float): Float = 1f + 2.4f * (u - 1f) * (u - 1f) * (u - 1f) + 1.4f * (u - 1f) * (u - 1f)

/**
 * L'ouverture d'un coffre, par-dessus la scène (environ 3 s) : le coffre vient au premier plan sur une estrade,
 * tremble, son couvercle saute. Bonus : pluie d'or et « +150 POINTS ». Malus : un orage sort du coffre (éclairs,
 * pluie), le couvercle se referme d'un coup et le coffre trépigne de rage, « Oups ! » et « −100 POINTS » (0 : « Oups ! »
 * et « 0 POINT », l'équipe n'avait rien à perdre). Bombe ([delta] null) : elle jaillit du coffre et fonce vers l'écran
 * en grossissant, mèche qui crépite… BOUM ! en plein écran et [pointsBombe], les points vraiment retirés (« −300 POINTS »).
 * Avec [avant] et [apres] (totaux de l'équipe lus dans la partie), un bonus ou un malus se termine sur la même carte
 * que les ± Points de la régie (« BONUS ! », compteur du score) : l'ouverture dure alors [OUVERTURE_CARTE_MS].
 * Le coffre en or ([or]) : rayons dorés, double pluie d'or, « COFFRE EN OR ! » et « +500 POINTS » ([OUVERTURE_OR_MS]).
 * L'écran montre les points, il ne les calcule jamais. [onFini] est appelé une fois, à la fin.
 */
@Composable
fun OuvertureCoffre(
    index: Int, delta: Int?, equipe: String, couleur: Color, onFini: () -> Unit,
    modifier: Modifier = Modifier, pointsBombe: Int = POINTS_BOMBE, avant: Int? = null, apres: Int? = null,
    jouer: (Son) -> Unit = jouerSonBombe, or: Boolean = false,
) {
    val t = remember(index) { Animatable(0f) }
    val fini by rememberUpdatedState(onFini)
    val joue by rememberUpdatedState(jouer)
    val bombe = delta == null
    val malus = delta != null && !or && !estBonus(delta)
    // Bonus ou malus réel avec les scores : verdict sur la carte BONUS / MALUS commune à toute l'appli.
    val carte = !bombe && !or && delta != 0 && avant != null && apres != null
    val total = (if (bombe) OUVERTURE_BOMBE_MS else if (or) OUVERTURE_OR_MS else if (malus) OUVERTURE_MALUS_MS else if (carte) OUVERTURE_CARTE_MS else OUVERTURE_COFFRE_MS).toFloat()
    val tVerdict = if (malus) T_VERDICT_MALUS else T_TEXTE
    LaunchedEffect(index) {
        suspend fun jusqua(ms: Float) = t.animateTo(ms, tween((ms - t.value).toInt().coerceAtLeast(0), easing = LinearEasing))
        jusqua(T_ENTREE); joue(Son.COFFRE_SECOUE)
        jusqua(T_OUVRE); joue(Son.COFFRE_OUVRE)
        if (bombe) {
            jusqua(T_POSE); joue(Son.BOMBE_APPROCHE); signalerRobot(MomentRobot.BOMBE)
            jusqua(T_BOUM); joue(Son.BOMBE_BOUM)
        } else {
            // Malus : l'orage et le couvercle qui claque, avant la carte MALUS.
            if (malus) { jusqua(T_OUVRE + 60f); joue(Son.COFFRE_MALUS) }
            jusqua(if (malus) T_VERDICT_MALUS - 130f else 1_420f)
            // La carte joue elle-même son BONUS / MALUS : pas de second son par-dessus.
            if (!carte) joue(if (or || delta!! >= PORTE_JACKPOT) Son.PORTES_JACKPOT else if (estBonus(delta)) Son.COFFRE_OR else Son.PORTES_TUILE)
            // La carte BONUS / MALUS fait venir le robot elle-même ; sans carte, c'est ici.
            if (!carte && delta != 0) signalerRobot(if (malus) MomentRobot.MALUS else MomentRobot.BONUS)
        }
        jusqua(total)
        fini()
    }
    val modele = modeleCoffre(index)
    ChargerOuvertureGs(modele)
    val m = MODELES[modele]
    // Coffre agrandi : assez grand pour le spectacle, assez bas pour laisser le verdict lisible au-dessus.
    val e = min(240f / m.largeur, 170f / m.hauteur)
    val cw = m.largeur * e
    val ch = m.hauteur * e
    val sol = 455f
    val pieces = remember(index, or) { projectiles(index * 31L + 7, if (or) 80 else 40) }
    val debris = remember(index) { projectiles(index * 17L + 3, 16) }
    val boules = remember(index) { boulesDeFeu(index * 13L + 5) }
    val braises = remember(index) { projectiles(index * 23L + 11, 34) }
    Echelle(960.dp, 540.dp, modifier.fillMaxSize()) {
        // Voile sombre, estrade, coffre, effets : une seule toile animée.
        Canvas(
            Modifier.fillMaxSize().clearAndSetSemantics {}.graphicsLayer {
                val ms = t.value
                // L'écran tremble : la bombe qui approche, son explosion, le couvercle du malus et ses éclairs.
                val choc = when {
                    bombe && ms in T_BOUM..(T_BOUM + 800f) -> 16f * (1f - (ms - T_BOUM) / 800f)
                    bombe && ms in T_POSE..T_BOUM -> 2.5f * (ms - T_POSE) / (T_BOUM - T_POSE)
                    malus && ms in T_CLAQUE..(T_CLAQUE + 350f) -> 7f * (1f - (ms - T_CLAQUE) / 350f)
                    malus && ECLAIRS.any { ms in it..(it + 120f) } -> 3f
                    else -> 0f
                }
                if (choc > 0f) { translationX = choc * density * sin(ms / 13f); translationY = choc * 0.8f * density * cos(ms / 17f) }
            },
        ) {
            val ms = t.value
            val d = density
            val voile = (ms / 300f).coerceIn(0f, 1f)
            drawRect(Neon.Nuit.copy(alpha = 0.9f * voile))
            // Bombe qui approche : le bord de l'écran rougit ; malus : vignette rouge qui bat, de colère.
            if (bombe && ms > T_POSE && ms < T_BOUM) {
                val a = (ms - T_POSE) / (T_BOUM - T_POSE)
                drawRect(Brush.radialGradient(listOf(Color.Transparent, Color(0xFFFF3B5C).copy(alpha = (0.2f + 0.15f * sin(ms / 70f)) * a)), Offset(size.width / 2, size.height / 2), size.width * 0.6f))
            }
            if (malus && ms > T_CLAQUE) {
                val a = ((ms - T_CLAQUE) / 300f).coerceIn(0f, 1f)
                drawRect(Brush.radialGradient(listOf(Color.Transparent, Color.Transparent, MALUS_CORAIL.copy(alpha = (0.16f + 0.1f * sin(ms / 110f)) * a)), Offset(size.width / 2, size.height / 2), size.width * 0.62f))
            }
            val entree = (ms / T_ENTREE).coerceIn(0f, 1f)
            val monte = rebondSortie(entree)
            val cx = size.width / 2
            val solPx = sol * d + (1f - monte) * 60f * d
            estradeRonde(cx, solPx, cw * 0.8f * d, 26f * d, 22f * d)
            val ouv = if (malus) couvercleMalus(ms) else ((ms - T_OUVRE) / 250f).coerceIn(0f, 1f).let { 1f - (1f - it) * (1f - it) }
            val lueur = when { bombe -> LUEUR_BOMBE; estBonus(delta!!) -> LUEUR_OR; else -> LUEUR_MALUS }
            // Faisceau de lumière qui monte du coffre ouvert (pas pour un malus : c'est un orage qui en sort).
            if (ouv > 0f && !malus) {
                val haut = solPx - ch * d
                val faisceau = Path().apply {
                    moveTo(cx - cw * 0.38f * d, haut + ch * 0.3f * d); lineTo(cx + cw * 0.38f * d, haut + ch * 0.3f * d)
                    lineTo(cx + cw * 0.9f * d, 0f); lineTo(cx - cw * 0.9f * d, 0f); close()
                }
                drawPath(faisceau, Brush.verticalGradient(listOf(Color.Transparent, lueur.copy(alpha = 0.32f * ouv)), 0f, haut + ch * 0.3f * d))
            }
            // Le coffre : tremble avant d'ouvrir, s'écrase un peu sur un malus, noircit à l'explosion.
            val secoue = ((ms - T_ENTREE) / (T_OUVRE - T_ENTREE)).coerceIn(0f, 1f)
            val tremble = if (ms in T_ENTREE..T_OUVRE) secoue * secoue else 0f
            // Malus : après le claquement, le coffre trépigne de rage (trois bonds, de plus en plus petits).
            val rage = if (malus) trepigne(ms) else Trepigne.CALME
            val saut = (if (ms in T_ENTREE..T_OUVRE) abs(sin(ms / 70f)) * 7f * d * tremble else 0f) + rage.haut * 18f * d
            val ecrase = rage.ecrase
            val brule = if (bombe && ms >= T_BOUM) 0.72f else if (malus) 0.3f * ((ms - T_CLAQUE) / 300f).coerceIn(0f, 1f) else 0f
            withTransform({
                translate(cx - cw * d / 2, solPx - ch * d - saut)
                rotate(3.2f * tremble * sin(ms / 38f) + rage.penche, Offset(cw * d / 2, ch * d))
                scale(1f, ecrase, Offset(cw * d / 2, ch * d))
            }) {
                drawOval(Brush.radialGradient(listOf(Color.Black.copy(alpha = 0.6f), Color.Transparent)), Offset(-cw * 0.06f * d, ch * d - 10f * d), Size(cw * 1.12f * d, 20f * d))
                // Rayons de lumière qui fuient par la fente du couvercle juste avant l'ouverture.
                if (ms in 800f..T_OUVRE) {
                    val a = ((ms - 800f) / 500f).coerceIn(0f, 1f)
                    val ly = (if (modele == 4) 0.3f else m.couvercle) * ch * d
                    drawOval(Brush.radialGradient(listOf(lueur.copy(alpha = 0.8f * a), Color.Transparent), Offset(cw * d / 2, ly), cw * 0.6f * d), Offset(-cw * 0.1f * d, ly - 14f * d), Size(cw * 1.2f * d, 28f * d))
                }
                inset(0f, 0f, size.width - cw * d, size.height - ch * d) {
                    dessineCoffre(modele, ouv, if (ouv > 0f) lueur else null, brule)
                }
            }
            val bouche = Offset(cx, solPx - ch * d * (1f - (if (modele == 4) 0.3f else m.couvercle)) - ch * d * m.couvercle * 0.2f)
            // Le coffre en or : une couronne de rayons dorés qui tourne derrière la pluie d'or.
            if (or && ms > T_OUVRE) {
                val s = ((ms - T_OUVRE) / 400f).coerceIn(0f, 1f)
                val longueur = 520f * d * s
                rotate(ms / 40f, bouche) {
                    for (k in 0 until 14) {
                        val a = k * (2f * PI.toFloat() / 14f)
                        val rayon = Path().apply {
                            moveTo(bouche.x, bouche.y)
                            lineTo(bouche.x + cos(a - 0.07f) * longueur, bouche.y + sin(a - 0.07f) * longueur)
                            lineTo(bouche.x + cos(a + 0.07f) * longueur, bouche.y + sin(a + 0.07f) * longueur)
                            close()
                        }
                        drawPath(rayon, Brush.radialGradient(listOf(LUEUR_OR.copy(alpha = 0.55f), LUEUR_OR.copy(alpha = 0f)), bouche, longueur.coerceAtLeast(1f)))
                    }
                }
            }
            when {
                // Bonus : pièces d'or qui jaillissent puis retombent.
                !bombe && estBonus(delta!!) && ms > T_OUVRE -> {
                    val s = (ms - T_OUVRE) / 1000f
                    pieces.forEachIndexed { k, p ->
                        val tt = s - (k % 8) * 0.03f
                        if (tt <= 0f) return@forEachIndexed
                        val x = bouche.x + p.vx * tt * d
                        val y = bouche.y + (p.vy * tt + 0.5f * 1300f * tt * tt) * d
                        if (y > size.height + 20f * d) return@forEachIndexed
                        val r = 9f * p.taille * d
                        val lg = abs(cos(p.tourne + tt * 9f))
                        drawOval(Brush.verticalGradient(listOf(OR_CLAIR, OR_MOYEN, OR_FONCE), y - r, y + r), Offset(x - r * (0.25f + 0.75f * lg), y - r), Size(2 * r * (0.25f + 0.75f * lg), 2 * r))
                        drawOval(OR_FONCE.copy(alpha = 0.7f), Offset(x - r * (0.25f + 0.75f * lg), y - r), Size(2 * r * (0.25f + 0.75f * lg), 2 * r), style = Stroke(1.2f * d))
                    }
                }
                // Malus : un orage sort du coffre, éclairs et pluie, et le coffre fume de colère.
                malus && ms > T_OUVRE -> orage(ms, bouche, Offset(cx, solPx - ch * d - 52f * d), cw * d, solPx - ch * d * 0.72f, solPx - ch * d * 0.5f, d)
            }
            if (bombe && ms > T_OUVRE && ms < T_BOUM) {
                // La bombe jaillit du coffre, puis fonce vers l'écran en grossissant, de plus en plus vite, en se dandinant.
                val sommet = Offset(cx, bouche.y - 150f * d)
                val v = ((ms - T_POSE) / (T_BOUM - T_POSE)).coerceIn(0f, 1f)
                val e = v * v * (1.6f - 0.6f * v)
                val (p, r) = if (ms < T_POSE) {
                    val u = ((ms - T_OUVRE) / (T_POSE - T_OUVRE)).coerceIn(0f, 1f)
                    Offset(bouche.x, bouche.y + (sommet.y - bouche.y) * (1f - (1f - u) * (1f - u))) to (30f + 14f * u) * d
                } else {
                    val glisse = 1f - (1f - v) * (1f - v)
                    Offset(cx, sommet.y + (size.height * 0.52f - sommet.y) * glisse) to (44f + 156f * e) * d
                }
                val pouls = 0.5f + 0.5f * sin(ms / (70f - 35f * v))
                if (v > 0f) drawCircle(Brush.radialGradient(listOf(Color(0xFFFF6A3D).copy(alpha = (0.35f + 0.25f * pouls) * v), Color.Transparent), p, r * 2.3f), r * 2.3f, p)
                rotate(sin(ms / (95f - 55f * v)) * (6f + 10f * v), p) {
                    dessineBombe(p, r * (1f + 0.05f * v * sin(ms / 45f)), ms, 1f - 0.9f * v)
                }
            }
            if (bombe && ms >= T_BOUM) explosion((ms - T_BOUM) / 1000f, Offset(cx, size.height * 0.52f), boules, braises, debris, d)
        }
        // Qui ouvre quel coffre (la carte BONUS / MALUS reprend le nom : le bandeau s'efface pour lui laisser la place).
        Row(
            Modifier.align(Alignment.TopCenter).padding(top = 14.dp)
                .graphicsLayer { alpha = if (carte) 1f - ((t.value - tVerdict) / 220f).coerceIn(0f, 1f) else 1f }
                .apparition(0, index)
                .background(Neon.Nuit2.copy(alpha = 0.9f), RoundedCornerShape(50)).border(2.5.dp, couleur, RoundedCornerShape(50))
                .padding(horizontal = 22.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(equipe, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false), style = styleBandeau.copy(fontSize = 22.sp, color = couleur))
            Text(" ouvre le coffre n° ${index + 1}", maxLines = 1, softWrap = false, style = styleBandeau.copy(fontSize = 22.sp, color = Neon.Blanc))
        }
        if (carte) {
            // La carte BONUS / MALUS, un peu réduite et au-dessus du coffre ouvert pour le laisser voir.
            val montree by remember(index) { derivedStateOf { t.value >= tVerdict } }
            if (montree) Box(Modifier.fillMaxSize().padding(bottom = 190.dp)) {
                BonusMalus(equipe, couleur, delta!!, avant!!, apres!!, jouer = joue, onFini = {})
            }
        }
        // Le verdict : visible dès qu'il tombe et jusqu'à la fin.
        // Bombe : le verdict arrive quand la boule de feu tourne en fumée, pour rester lisible.
        val apparu = if (bombe) T_BOUM + 400f else if (carte) Float.MAX_VALUE else tVerdict
        Column(
            Modifier.align(Alignment.TopCenter).padding(top = 62.dp).graphicsLayer {
                val u = ((t.value - apparu) / 380f).coerceIn(0f, 1f)
                alpha = if (u <= 0f) 0f else 1f
                val s = if (u <= 0f) 0.5f else rebondSortie(u)
                scaleX = s; scaleY = s
            },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            val (titre, teinte) = when {
                bombe -> "BOUM !" to Color(0xFFFFB347)
                or -> "COFFRE EN OR !" to LUEUR_OR
                estBonus(delta!!) -> "Bonus !" to Neon.OrClair
                else -> "Oups !" to Color(0xFFFFC2C4)
            }
            Text(titre, maxLines = 1, style = TextStyle(fontFamily = PoliceLmp, lineHeight = 1.2.em, lineHeightStyle = LIGNE_LMP, fontSize = if (bombe) 76.sp else if (or) 62.sp else 46.sp, fontWeight = FontWeight.ExtraBold, color = teinte, shadow = Shadow(Color.Black.copy(alpha = 0.6f), Offset(0f, 4f), 14f)))
            Text(
                textePointsCoffre(delta, pointsBombe), maxLines = 1,
                style = TextStyle(
                    fontFamily = PoliceLmp, lineHeight = 1.2.em, lineHeightStyle = LIGNE_LMP, fontSize = 60.sp, fontWeight = FontWeight.ExtraBold,
                    color = if (or) OR_CLAIR else if (!bombe && estBonus(delta!!)) BONUS_VERT else MALUS_CORAIL,
                    shadow = Shadow(Color.Black.copy(alpha = 0.7f), Offset(0f, 4f), 16f),
                ),
            )
        }
    }
}

private val jouerSonBombe: (Son) -> Unit = { Sons.executer(listOf(Ordre.Jouer(it))) }

/** Malus : le couvercle s'entrouvre, l'orage s'échappe, puis il se referme d'un coup (petit rebond). */
private fun couvercleMalus(ms: Float): Float = when {
    ms < T_OUVRE -> 0f
    ms < T_OUVRE + 200f -> 0.8f * (1f - (1f - (ms - T_OUVRE) / 200f).let { it * it })
    ms < T_CLAQUE -> 0.8f + 0.06f * sin((ms - T_OUVRE) / 35f)
    ms < T_CLAQUE + 80f -> 0.8f * (1f - (ms - T_CLAQUE) / 80f)
    ms < T_CLAQUE + 260f -> 0.12f * sin(PI.toFloat() * (ms - T_CLAQUE - 80f) / 180f)
    else -> 0f
}

/** Le coffre qui trépigne : hauteur du bond (0..1), écrasement à la réception, inclinaison (degrés). */
private class Trepigne(val haut: Float, val ecrase: Float, val penche: Float) {
    companion object { val CALME = Trepigne(0f, 1f, 0f) }
}

private fun trepigne(ms: Float): Trepigne {
    val t = ms - T_CLAQUE - 120f
    if (t < 0f || t >= 900f) return Trepigne.CALME
    val k = (t / 300f).toInt()
    val f = t / 300f - k
    val force = 1f - 0.25f * k
    val haut = sin(PI.toFloat() * f) * force
    val ecrase = if (f < 0.14f) 1f - 0.13f * force * (1f - f / 0.14f) else 1f
    return Trepigne(haut, ecrase, (if (k % 2 == 0) 5f else -5f) * haut)
}

/**
 * Malus : un nuage d'orage sort de la bouche du coffre et monte au-dessus ([ciel]) ; pluie sur le couvercle ([couvercle] :
 * hauteur où tombent les gouttes), éclairs, fumée de colère sur les côtés à chaque bond et symbole de colère.
 */
private fun DrawScope.orage(ms: Float, bouche: Offset, ciel: Offset, largeurCoffre: Float, couvercle: Float, flancs: Float, d: Float) {
    val e = ((ms - T_OUVRE) / 450f).coerceIn(0f, 1f).let { 1f - (1f - it) * (1f - it) }
    val c = Offset(bouche.x + (ciel.x - bouche.x) * e, bouche.y + (ciel.y - bouche.y) * e)
    val k = (0.35f + 0.65f * e) * 1.25f * (largeurCoffre / (240f * d)).coerceIn(0.7f, 1.2f)
    val eclair = ECLAIRS.maxOf { f -> if (ms in f..(f + 140f)) 1f - (ms - f) / 140f else 0f }
    // Pluie, sous le nuage.
    if (ms > T_OUVRE + 350f) for (g in 0 until 26) {
        val x = c.x + ((g * 37) % 200 - 100) * k * d
        val periode = 360f + (g % 5) * 30f
        val f = ((ms + g * 97f) % periode) / periode
        val y = c.y + 22f * d + (couvercle - c.y - 22f * d) * f
        drawLine(Color(0xFFAFC4FF).copy(alpha = 0.55f * (1f - f * 0.5f)), Offset(x, y), Offset(x - 3f * d, y + 14f * d), 2.2f * d, StrokeCap.Round)
    }
    // Éclairs : zigzag du nuage au coffre, halo violet, éclat sur tout l'écran.
    if (eclair > 0f) {
        val rang = ECLAIRS.indexOfFirst { ms in it..(it + 140f) }
        val r = java.util.Random(31L + rang)
        val chemin = Path().apply {
            var x = c.x + (r.nextFloat() - 0.5f) * 80f * k * d
            var y = c.y + 20f * d
            moveTo(x, y)
            val pas = 6
            for (i in 1..pas) {
                y = c.y + 20f * d + (couvercle - c.y - 20f * d) * i / pas
                x = bouche.x + (r.nextFloat() - 0.5f) * 70f * d * (1f - i / (pas + 1f))
                lineTo(x, y)
            }
        }
        drawRect(Color(0xFFE8DDFF).copy(alpha = 0.22f * eclair))
        drawPath(chemin, Color(0xFFB98CFF).copy(alpha = 0.55f * eclair), style = Stroke(11f * d, cap = StrokeCap.Round))
        drawPath(chemin, Color.White.copy(alpha = eclair), style = Stroke(3.5f * d, cap = StrokeCap.Round))
    }
    // Le nuage : bouffées sombres, plus claires pendant un éclair.
    val bouffees = listOf(
        Triple(-70f, 10f, 38f), Triple(-35f, -14f, 46f), Triple(10f, -24f, 52f), Triple(55f, -8f, 44f),
        Triple(86f, 12f, 34f), Triple(-8f, 14f, 46f), Triple(40f, 16f, 40f), Triple(-56f, 22f, 30f),
    )
    val sombre = lerp(Color(0xFF3A2D4D), Color(0xFFD9CCF5), eclair * 0.6f)
    val clair = lerp(Color(0xFF6B5A82), Color.White, eclair * 0.6f)
    bouffees.forEachIndexed { i, (dx, dy, rr) ->
        val p = c + Offset(dx * k * d, (dy + 3f * sin(ms / 300f + i)) * k * d)
        val rp = rr * k * d
        drawCircle(Color(0xFF1C1428).copy(alpha = 0.5f * e), rp, p + Offset(0f, 6f * d))
        drawCircle(Brush.radialGradient(listOf(clair, sombre), p - Offset(rp * 0.35f, rp * 0.45f), rp * 1.3f), rp, p, alpha = 0.95f * e)
    }
    if (ms < T_CLAQUE + 120f) return
    // Fumée de colère : deux bouffées corail qui fusent des flancs à chaque réception de bond.
    val t = ms - T_CLAQUE - 120f
    for (b in 0 until 3) {
        val age = (t - b * 300f) / 500f
        if (age !in 0f..1f) continue
        for (s in listOf(-1f, 1f)) {
            val p = Offset(bouche.x + s * (largeurCoffre * 0.5f + 20f * d + 40f * d * age), flancs - 30f * d * age)
            drawCircle(MALUS_CORAIL.copy(alpha = 0.6f * (1f - age)), (10f + 18f * age) * d, p)
        }
    }
    // Symbole de colère (quatre arcs) au coin du coffre, qui apparaît d'un coup puis bat.
    val u = ((ms - T_CLAQUE - 150f) / 300f).coerceIn(0f, 1f)
    if (u <= 0f) return
    val taille = 22f * d * rebondSortie(u) * (1f + 0.12f * sin(ms / 90f))
    val centre = Offset(bouche.x + largeurCoffre * 0.48f, couvercle - 34f * d)
    for (q in 0 until 4) rotate(q * 90f, centre) {
        val arc = Path().apply {
            moveTo(centre.x + taille * 0.25f, centre.y - taille * 0.95f)
            quadraticBezierTo(centre.x + taille * 0.25f, centre.y - taille * 0.25f, centre.x + taille * 0.95f, centre.y - taille * 0.25f)
        }
        drawPath(arc, Color(0xFFFF3B4E), style = Stroke(5f * d, cap = StrokeCap.Round))
    }
}

/** Une boule de feu de l'explosion : direction, vitesse (dp/s), rayon (dp), léger retard. */
private class BouleDeFeu(val angle: Float, val vitesse: Float, val rayon: Float, val retard: Float)

private fun boulesDeFeu(graine: Long): List<BouleDeFeu> {
    val r = java.util.Random(graine)
    return List(18) { BouleDeFeu(r.nextFloat() * 2f * PI.toFloat(), 70f + r.nextFloat() * 200f, 46f + r.nextFloat() * 50f, r.nextFloat() * 0.08f) }
}

/** Couleur d'une boule de feu selon son âge (s) : blanc, jaune, orange, rouge sombre, puis fumée prune. */
private fun teinteFeu(age: Float): Pair<Color, Color> {
    fun entre(a: Color, b: Color, f: Float) = lerp(a, b, f.coerceIn(0f, 1f))
    return when {
        age < 0.12f -> Color.White to Color(0xFFFFE9A0)
        age < 0.35f -> entre(Color(0xFFFFF3C4), Color(0xFFFFB347), (age - 0.12f) / 0.23f) to entre(Color(0xFFFFC75A), Color(0xFFFF6A2E), (age - 0.12f) / 0.23f)
        age < 0.7f -> entre(Color(0xFFFFB347), Color(0xFFB8323F), (age - 0.35f) / 0.35f) to entre(Color(0xFFFF6A2E), Color(0xFF5A2238), (age - 0.35f) / 0.35f)
        else -> entre(Color(0xFF6A4058), Color(0xFF4A3E58), (age - 0.7f) / 0.4f) to Color(0xFF2E2638)
    }
}

/**
 * BOUM ! au centre de l'écran, [s] secondes après : éclair blanc, cœur incandescent, boules de feu qui gonflent puis
 * tournent en fumée qui monte, deux ondes de choc, braises qui retombent et débris.
 */
private fun DrawScope.explosion(s: Float, c: Offset, boules: List<BouleDeFeu>, braises: List<Projectile>, debris: List<Projectile>, d: Float) {
    val coeur = (1f - s / 0.4f).coerceIn(0f, 1f)
    if (coeur > 0f) {
        val rc = (120f + 260f * s) * d
        drawCircle(Brush.radialGradient(listOf(Color(0xFFFFF6D8), Color(0xFFFFC24A), Color(0xFFFF6A2E).copy(alpha = 0.7f), Color.Transparent), c, rc), rc, c, alpha = coeur)
    }
    // Fumée d'abord (derrière), feu par-dessus : les plus vieilles boules en premier.
    boules.sortedBy { it.retard }.forEach { b ->
        val age = s - b.retard
        if (age <= 0f || age > 1.4f) return@forEach
        val dep = 1f - kotlin.math.exp(-age / 0.22f)
        val p = c + Offset(cos(b.angle) * b.vitesse * dep * d, sin(b.angle) * b.vitesse * 0.8f * dep * d - 80f * age * age * d)
        val rp = b.rayon * (0.5f + 1.3f * (1f - kotlin.math.exp(-age / 0.3f))) * d
        val (c1, c2) = teinteFeu(age)
        val alpha = (1f - (age - 0.6f) / 0.8f).coerceIn(0f, 1f)
        drawCircle(Brush.radialGradient(listOf(c1, c2, c2.copy(alpha = 0f)), p, rp), rp, p, alpha = alpha)
    }
    for (k in 0..1) {
        val sk = s - k * 0.12f
        if (sk in 0f..0.9f) drawCircle((if (k == 0) Color(0xFFFFD27A) else Color(0xFFFF8A3D)).copy(alpha = 0.8f * (1f - sk / 0.9f)), (90f + 820f * sk) * d, c, style = Stroke((12f - 9f * sk) * d))
    }
    // Braises : traits incandescents qui filent et retombent.
    braises.forEach { p ->
        if (s > 1.1f) return@forEach
        val vx = p.vx * 1.6f
        val vy = p.vy * 1.3f
        fun pos(t: Float) = Offset(c.x + vx * t * d, c.y + (vy * t + 0.5f * 900f * t * t) * d)
        val a = (1f - s / 1.1f).coerceIn(0f, 1f)
        drawLine(lerp(Color(0xFFFFF0B0), Color(0xFFFF7A2E), s).copy(alpha = a), pos((s - 0.04f).coerceAtLeast(0f)), pos(s), 3f * d * p.taille, StrokeCap.Round)
    }
    debris.forEach { p ->
        val x = c.x + p.vx * 1.6f * s * d
        val y = c.y + (p.vy * 1.3f * s + 0.5f * 1500f * s * s) * d
        if (y < size.height) rotate(p.tourne * 40f + s * 500f, Offset(x, y)) { drawRect(Color(0xFF2A2030), Offset(x - 6f * d * p.taille, y - 4f * d * p.taille), Size(12f * d * p.taille, 8f * d * p.taille)) }
    }
    // Éclair blanc, bref : on doit voir la boule de feu juste derrière.
    val eclair = (1f - s / 0.18f).coerceIn(0f, 1f)
    if (eclair > 0f) drawRect(Color.White.copy(alpha = eclair * eclair * 0.9f))
}

/* ------------------------------------------------------------------ Alerte */

/**
 * L'annonce (environ 5 s), en deux temps aussi forts l'un que l'autre. La bombe tombe sur son estrade, mèche allumée :
 * « Attention… une bombe se cache dans un des coffres ! ». Puis elle glisse à gauche et le coffre en or tombe à droite,
 * s'ouvre sur ses rayons et sa pluie d'or : « …et un coffre en or à +500 points ! » (retour de cedric le 21/10 : le
 * coffre en or passait inaperçu). [onFini] est appelé une fois, à la fin.
 */
@Composable
fun AlerteBombe(onFini: () -> Unit, modifier: Modifier = Modifier, jouer: (Son) -> Unit = jouerSonBombe) {
    val t = remember { Animatable(0f) }
    val fini by rememberUpdatedState(onFini)
    val joue by rememberUpdatedState(jouer)
    LaunchedEffect(Unit) {
        joue(Son.BOMBE_ALERTE)
        t.animateTo(A_OR_OUVRE, tween(A_OR_OUVRE.toInt(), easing = LinearEasing))
        joue(Son.COFFRE_OR)
        t.animateTo(ALERTE_BOMBE_MS.toFloat(), tween((ALERTE_BOMBE_MS - A_OR_OUVRE).toInt(), easing = LinearEasing))
        fini()
    }
    val pieces = remember { projectiles(97L, 46) }
    ChargerOuvertureGs(0, dore = true)
    Echelle(960.dp, 540.dp, modifier.fillMaxSize()) {
        Canvas(Modifier.fillMaxSize().clearAndSetSemantics {}) {
            val ms = t.value
            val d = density
            // Voile plein dès la première image : l'alerte suit le classement, déjà sombre.
            drawRect(Neon.Nuit.copy(alpha = 0.82f))
            val sol = 470f * d
            val cx = size.width / 2
            // Deuxième temps : la bombe glisse à gauche, le coffre en or prend la droite.
            val g = ((ms - A_GLISSE) / 400f).coerceIn(0f, 1f).let { 1f - (1f - it) * (1f - it) }
            val xBombe = cx - 215f * d * g
            val xOr = cx + 215f * d
            // Vignette rouge qui respire autour de la bombe, puis dorée autour du coffre.
            val pouls = 0.5f + 0.5f * sin(2f * PI.toFloat() * ms / 1_100f)
            drawRect(Brush.radialGradient(listOf(Color.Transparent, Color.Transparent, Color(0xFFFF3B5C).copy(alpha = 0.18f + 0.14f * pouls)), Offset(xBombe, size.height / 2), size.width * 0.62f))
            val dore = ((ms - A_OR_TOMBE) / 400f).coerceIn(0f, 1f)
            if (dore > 0f) drawCircle(Brush.radialGradient(listOf(LUEUR_OR.copy(alpha = 0.3f * dore), Color.Transparent), Offset(xOr, sol - 80f * d), 360f * d), 360f * d, Offset(xOr, sol - 80f * d))
            estradeRonde(xBombe, sol, 120f * d - 20f * d * g, 22f * d, 20f * d)
            // Bombe un peu plus petite qu'avant : sa mèche reste sous les trois lignes du message.
            val r = (54f - 6f * g) * d
            val chute = (ms / 580f).coerceIn(0f, 1f)
            val y = if (chute < 1f) -r + (sol - r + r) * chute * chute
            else sol - r - 22f * d * abs(sin(((ms - 580f) / 260f).coerceIn(0f, 1f) * PI.toFloat()))
            drawOval(Brush.radialGradient(listOf(Color.Black.copy(alpha = 0.6f * chute), Color.Transparent)), Offset(xBombe - r * 1.2f, sol - 8f * d), Size(r * 2.4f, 16f * d))
            dessineBombe(Offset(xBombe, y), r, ms, 1f - 0.25f * ((ms - 600f) / 2_400f).coerceIn(0f, 1f), etincelle = ms > 600f)
            if (ms < A_OR_TOMBE - 150f) return@Canvas
            // Le coffre en or : estrade, chute avec rebond, rayons qui tournent et pluie d'or à l'ouverture.
            estradeRonde(xOr, sol, 100f * d, 22f * d, 20f * d)
            val cw = 150f * d
            val ch = 119f * d
            val u = ((ms - A_OR_TOMBE) / 420f).coerceIn(0f, 1f)
            val bas = if (u < 1f) -20f * d + (sol + 20f * d) * u * u else sol - 18f * d * abs(sin(((ms - A_OR_TOMBE - 420f) / 240f).coerceIn(0f, 1f) * PI.toFloat()))
            val ouv = ((ms - A_OR_OUVRE) / 250f).coerceIn(0f, 1f).let { 1f - (1f - it) * (1f - it) }
            val bouche = Offset(xOr, bas - ch * (1f - MODELES[0].couvercle) - ch * MODELES[0].couvercle * 0.2f)
            if (ouv > 0f) {
                val longueur = 330f * d * ouv
                rotate(ms / 40f, bouche) {
                    for (k in 0 until 14) {
                        val a = k * (2f * PI.toFloat() / 14f)
                        val rayon = Path().apply {
                            moveTo(bouche.x, bouche.y)
                            lineTo(bouche.x + cos(a - 0.08f) * longueur, bouche.y + sin(a - 0.08f) * longueur)
                            lineTo(bouche.x + cos(a + 0.08f) * longueur, bouche.y + sin(a + 0.08f) * longueur)
                            close()
                        }
                        drawPath(rayon, Brush.radialGradient(listOf(LUEUR_OR.copy(alpha = 0.6f), LUEUR_OR.copy(alpha = 0f)), bouche, longueur.coerceAtLeast(1f)))
                    }
                }
            }
            drawOval(Brush.radialGradient(listOf(Color.Black.copy(alpha = 0.55f * u), Color.Transparent)), Offset(xOr - cw * 0.55f, sol - 8f * d), Size(cw * 1.1f, 16f * d))
            withTransform({ translate(xOr - cw / 2, bas - ch) }) {
                inset(0f, 0f, size.width - cw, size.height - ch) { dessineCoffre(0, ouv, if (ouv > 0f) LUEUR_OR else null, 0f, dore = true) }
            }
            if (ouv > 0f) {
                val sp = (ms - A_OR_OUVRE) / 1000f
                pieces.forEachIndexed { k, p ->
                    val tt = sp - (k % 8) * 0.03f
                    if (tt <= 0f) return@forEachIndexed
                    val x = bouche.x + p.vx * 0.8f * tt * d
                    val yy = bouche.y + (p.vy * 0.9f * tt + 0.5f * 1300f * tt * tt) * d
                    if (yy > sol + 10f * d) return@forEachIndexed
                    val rp = 8f * p.taille * d
                    val lg = abs(cos(p.tourne + tt * 9f))
                    drawOval(Brush.verticalGradient(listOf(OR_CLAIR, OR_MOYEN, OR_FONCE), yy - rp, yy + rp), Offset(x - rp * (0.25f + 0.75f * lg), yy - rp), Size(2 * rp * (0.25f + 0.75f * lg), 2 * rp))
                }
            }
        }
        // « ⭐ +500 » qui jaillit au-dessus du coffre ouvert.
        Box(
            Modifier.align(Alignment.TopStart).offset(x = 480.dp + 215.dp - 70.dp, y = 286.dp).width(140.dp).graphicsLayer {
                val u = ((t.value - A_OR_OUVRE - 120f) / 380f).coerceIn(0f, 1f)
                alpha = if (u <= 0f) 0f else 1f
                val sc = (if (u <= 0f) 0.4f else rebondSortie(u)) * (1f + 0.06f * sin(t.value / 120f))
                scaleX = sc; scaleY = sc
            },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "⭐ +500", maxLines = 1, softWrap = false,
                modifier = Modifier.background(Brush.verticalGradient(listOf(Color(0xFFFFE9A8), Color(0xFFE9B54A))), RoundedCornerShape(50))
                    .border(2.5.dp, Color.White.copy(alpha = 0.85f), RoundedCornerShape(50)).padding(horizontal = 16.dp, vertical = 2.dp),
                style = styleCentre(30.sp, Color(0xFF5A3A08), FontWeight.ExtraBold),
            )
        }
        Column(Modifier.align(Alignment.TopCenter).padding(top = 40.dp, start = 40.dp, end = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                "Attention…", maxLines = 1,
                modifier = Modifier.graphicsLayer { alpha = ((t.value - 750f) / 300f).coerceIn(0f, 1f) },
                style = TextStyle(fontFamily = PoliceLmp, lineHeight = 1.2.em, lineHeightStyle = LIGNE_LMP, fontSize = 34.sp, fontWeight = FontWeight.ExtraBold, color = Neon.OrClair, letterSpacing = 2.sp),
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "Une bombe se cache dans un des coffres !", textAlign = TextAlign.Center, maxLines = 2,
                modifier = Modifier.graphicsLayer {
                    val u = ((t.value - 1_250f) / 380f).coerceIn(0f, 1f)
                    alpha = if (u <= 0f) 0f else 1f
                    val s = if (u <= 0f) 0.6f else rebondSortie(u); scaleX = s; scaleY = s
                },
                style = TextStyle(fontFamily = PoliceLmp, lineHeight = 1.15.em, lineHeightStyle = LIGNE_LMP, fontSize = 42.sp, fontWeight = FontWeight.ExtraBold, color = Neon.Blanc, shadow = Shadow(Color(0xFFFF3B5C).copy(alpha = 0.6f), blurRadius = 24f)),
            )
            Spacer(Modifier.height(6.dp))
            // Même taille que la bombe : le coffre en or compte autant qu'elle dans l'annonce.
            Text(
                "…et un coffre en or à +500 points !", textAlign = TextAlign.Center, maxLines = 1, softWrap = false,
                modifier = Modifier.graphicsLayer {
                    val u = ((t.value - A_OR_OUVRE + 100f) / 380f).coerceIn(0f, 1f)
                    alpha = if (u <= 0f) 0f else 1f
                    val s = if (u <= 0f) 0.6f else rebondSortie(u); scaleX = s; scaleY = s
                },
                style = TextStyle(
                    fontFamily = PoliceLmp, lineHeight = 1.15.em, lineHeightStyle = LIGNE_LMP, fontSize = 42.sp, fontWeight = FontWeight.ExtraBold, color = LUEUR_OR,
                    shadow = Shadow(LUEUR_OR.copy(alpha = 0.75f), blurRadius = 26f),
                ),
            )
        }
    }
}

/** Annonce : la bombe glisse à gauche, le coffre en or tombe, puis s'ouvre (son du coffre en or). */
private const val A_GLISSE = 2_050f
private const val A_OR_TOMBE = 2_250f
private const val A_OR_OUVRE = 2_750f

/* ------------------------------------------------------------------ Bilan */

/** Le bilan : ce que chaque équipe a gagné ou perdu dans ce jeu (nom, couleur, points), lignes qui arrivent une à une. */
@Composable
fun BilanBombe(lignes: List<Triple<String, Color, Int>>, modifier: Modifier = Modifier, jouer: (Son) -> Unit = jouerSonBombe) {
    val t = remember { Animatable(0f) }
    val joue by rememberUpdatedState(jouer)
    val pas = 320f
    LaunchedEffect(lignes.size) {
        for (i in lignes.indices) {
            t.animateTo(500f + i * pas, tween(if (i == 0) 500 else pas.toInt(), easing = LinearEasing))
            joue(Son.pop(i))
        }
        t.animateTo(500f + lignes.size * pas + 800f, tween(800, easing = LinearEasing))
    }
    val deuxColonnes = lignes.size > 4
    Echelle(960.dp, 540.dp, modifier.fillMaxSize()) {
        Column(Modifier.align(Alignment.TopCenter).padding(top = 18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(
                Modifier.background(Neon.Nuit2.copy(alpha = 0.88f), RoundedCornerShape(50)).border(2.5.dp, Neon.Or, RoundedCornerShape(50)).padding(horizontal = 26.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("💣", style = TextStyle(fontSize = 24.sp))
                Spacer(Modifier.width(10.dp))
                Text("Le bilan des Coffres mystères", maxLines = 1, style = styleBandeau.copy(color = Neon.OrClair))
            }
            Spacer(Modifier.height(if (deuxColonnes) 22.dp else 30.dp))
            val largeur: Dp = if (deuxColonnes) 420.dp else 620.dp
            val hauteur: Dp = if (deuxColonnes) 64.dp else 72.dp
            val colonnes = if (deuxColonnes) lignes.chunked((lignes.size + 1) / 2) else listOf(lignes)
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                var i0 = 0
                colonnes.forEach { col ->
                    val debut = i0
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        col.forEachIndexed { j, (nom, couleur, points) ->
                            LigneBilan(nom, couleur, points, debut + j, largeur, hauteur) { t.value }
                        }
                    }
                    i0 += col.size
                }
            }
        }
    }
}

@Composable
private fun LigneBilan(nom: String, couleur: Color, points: Int, i: Int, largeur: Dp, hauteur: Dp, ms: () -> Float) {
    val debut = 500f + i * 320f - 320f
    Row(
        Modifier.width(largeur).height(hauteur)
            .graphicsLayer {
                val u = ((ms() - debut) / 380f).coerceIn(0f, 1f)
                alpha = u
                translationX = (1f - u) * 60f * density
            }
            .background(Neon.Nuit2.copy(alpha = 0.9f), RoundedCornerShape(20.dp)).border(3.dp, couleur, RoundedCornerShape(20.dp))
            .padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(22.dp).background(couleur, CircleShape).border(2.dp, Color.White.copy(alpha = 0.8f), CircleShape))
        Spacer(Modifier.width(14.dp))
        Text(nom, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f), style = styleBandeau.copy(fontSize = if (hauteur > 66.dp) 28.sp else 24.sp, color = Neon.Blanc))
        val teinte = when { points > 0 -> BONUS_VERT; points < 0 -> MALUS_CORAIL; else -> Neon.OrClair }
        Text(
            if (points == 0) "0" else texteValeur(points), maxLines = 1, softWrap = false,
            style = styleBandeau.copy(fontSize = if (hauteur > 66.dp) 34.sp else 30.sp, color = teinte),
        )
    }
}

/* ------------------------------------------------------------------ Classement après un coffre */

/**
 * Le classement entre deux coffres (environ 3 s) : les équipes à leur place d'avant, le score de celle qui vient
 * d'ouvrir un coffre qui monte ou descend, puis les lignes qui glissent à leur nouvelle place et ce qui arrive à
 * chacune (« +1 place ! », « Nouveau n°1 ! », « Garde sa place ! »). [lignes] : scores et rangs calculés par la partie,
 * [joue] : l'index (dans [lignes]) de l'équipe qui a ouvert le coffre.
 */
@Composable
fun ClassementCoffre(lignes: List<LignePortes>, joue: Int, modifier: Modifier = Modifier, jouer: (Son) -> Unit = jouerSonBombe) {
    val evo = remember(lignes) { evolutions(lignes) }
    val renverse = evo.any { it.recit == Recit.NOUVEAU_PREMIER }
    val bouge = evo.any { it.rangAvant != it.rangApres }
    val t = remember(lignes) { Animatable(0f) }
    val sonne by rememberUpdatedState(jouer)
    LaunchedEffect(lignes) {
        sonne(Son.WHOOSH)
        t.animateTo(C_COMPTE, tween(C_COMPTE.toInt(), easing = LinearEasing))
        sonne(Son.COMPTEUR)
        t.animateTo(C_BASCULE, tween((C_BASCULE - C_COMPTE).toInt(), easing = LinearEasing))
        if (bouge) sonne(Son.WHOOSH)
        t.animateTo(C_RECIT, tween((C_RECIT - C_BASCULE).toInt(), easing = LinearEasing))
        if (renverse) sonne(Son.PORTES_RENVERSEMENT) else if (evo.getOrNull(joue)?.recit == Recit.MONTE) sonne(Son.pop(0))
        t.animateTo(CLASSEMENT_COFFRE_MS.toFloat(), tween((CLASSEMENT_COFFRE_MS - C_RECIT).toInt(), easing = LinearEasing))
    }
    val n = lignes.size.coerceAtLeast(1)
    val hauteur = minOf(56f, 380f / n)
    Echelle(960.dp, 540.dp, modifier.fillMaxSize()) {
        // Voile sombre dès la première image (l'ouverture juste avant est déjà sombre : pas d'éclair des coffres),
        // puis le titre et les lignes apparaissent en fondu.
        Box(Modifier.fillMaxSize().clearAndSetSemantics {}.background(Neon.Nuit.copy(alpha = 0.86f)))
        Row(
            Modifier.align(Alignment.TopCenter).padding(top = 22.dp).graphicsLayer { alpha = (t.value / 250f).coerceIn(0f, 1f) }
                .background(Neon.Nuit2.copy(alpha = 0.9f), RoundedCornerShape(50)).border(2.5.dp, Neon.Or, RoundedCornerShape(50))
                .padding(horizontal = 26.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("🏆", style = TextStyle(fontSize = 24.sp))
            Spacer(Modifier.width(10.dp))
            Text("Le classement", maxLines = 1, style = styleBandeau.copy(color = Neon.OrClair))
        }
        Box(
            Modifier.align(Alignment.TopCenter).padding(top = 92.dp)
                // Décalé vers la gauche : les étiquettes s'affichent à droite des lignes.
                .offset(x = (-90).dp).width(580.dp).height((hauteur * n).dp).graphicsLayer { alpha = (t.value / 250f).coerceIn(0f, 1f) },
        ) {
            lignes.forEachIndexed { i, l -> LigneClassementCoffre(l, evo[i], i == joue, hauteur) { t.value } }
        }
    }
}

private const val C_COMPTE = 350f
private const val C_BASCULE = 1_250f
private const val C_RECIT = 1_950f

@Composable
private fun LigneClassementCoffre(e: LignePortes, evo: Evolution, joue: Boolean, hauteur: Float, ms: () -> Float) {
    val gain = e.apres - e.avant
    val taille = (hauteur * 0.4f).sp
    val apres by remember(evo) { derivedStateOf { ms() >= C_BASCULE + 500f } }
    val rang = if (apres) evo.rangApres else evo.rangAvant
    Row(
        Modifier.fillMaxWidth().height((hauteur - 6f).dp)
            .graphicsLayer {
                // Glissement de l'ancienne place à la nouvelle, avec un léger dépassement.
                val u = ((ms() - C_BASCULE) / 900f).coerceIn(0f, 1f)
                val e2 = if (u >= 1f) 1f else 1f - (1f - u) * (1f - u) * (1f - u) * (1f - 2.2f * u)
                translationY = (evo.rangAvant + (evo.rangApres - evo.rangAvant) * e2) * hauteur * density
            }
            .background(
                if (rang == 0) Brush.horizontalGradient(listOf(Color(0x59FFD166), Color(0x14FFD166))) else Brush.horizontalGradient(listOf(Color(0x21FFFFFF), Color(0x0DFFFFFF))),
                RoundedCornerShape(12.dp),
            )
            .border(if (joue) 3.dp else if (rang == 0) 2.dp else 0.dp, if (joue) e.couleur else if (rang == 0) Color(0xFFFFD166) else Color.Transparent, RoundedCornerShape(12.dp))
            .drawBehind { drawRect(e.couleur, size = Size(6.dp.toPx(), size.height)) }
            .padding(start = 16.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("${rang + 1}", maxLines = 1, style = styleBandeau.copy(color = Neon.Or, fontSize = taille), modifier = Modifier.width((hauteur * 0.7f).dp))
        Text(e.nom, maxLines = 1, overflow = TextOverflow.Ellipsis, style = styleBandeau.copy(color = Neon.Blanc, fontSize = taille), modifier = Modifier.weight(1f))
        if (joue) {
            Text(
                if (gain == 0) "0" else texteValeur(gain), maxLines = 1, softWrap = false,
                style = styleBandeau.copy(color = if (gain > 0) Neon.JusteTexte else Color.White, fontSize = taille * 0.72f),
                modifier = Modifier
                    .graphicsLayer {
                        val p = ((ms() - 150f) / 250f).coerceIn(0f, 1f)
                        alpha = p; scaleX = 0.5f + 0.5f * p; scaleY = 0.5f + 0.5f * p
                    }
                    .background(if (gain > 0) Neon.JusteClair else Neon.Faux, RoundedCornerShape(50))
                    .padding(horizontal = 8.dp, vertical = 1.dp),
            )
            Spacer(Modifier.width(12.dp))
        }
        val score by remember(e) { derivedStateOf { valeurCompteur(e.avant, e.apres, (ms() - C_COMPTE) / 800f) } }
        Text(espaceMilliers(score), maxLines = 1, softWrap = false, textAlign = TextAlign.End, style = styleBandeau.copy(color = Neon.Blanc, fontSize = taille), modifier = Modifier.widthIn(min = (hauteur * 1.6f).dp))
    }
    val texte = texteRecit(evo)?.takeIf { joue || evo.rangAvant != evo.rangApres }
    if (texte != null) {
        val montre by remember(evo) { derivedStateOf { ms() >= C_RECIT } }
        if (montre) {
            Box(
                Modifier.offset(x = 590.dp).width(190.dp).height((hauteur - 6f).dp)
                    .graphicsLayer { translationY = evo.rangApres * hauteur * density },
            ) {
                val (fond, encre) = when (evo.recit) {
                    Recit.TOUJOURS_EN_TETE, Recit.NOUVEAU_PREMIER -> Color(0xFFFFD166) to Neon.Nuit2
                    Recit.TUILE_DU_PREMIER -> Neon.Faux to Color.White
                    Recit.MONTE -> Neon.JusteClair to Neon.JusteTexte
                    Recit.DESCEND -> Color(0xFFFFD0D1) to Color(0xFF8A0F1C)
                    else -> Color.White to Neon.Nuit2
                }
                Text(
                    texte, maxLines = 1, softWrap = false,
                    style = styleBandeau.copy(color = encre, fontSize = taille * 0.7f),
                    modifier = Modifier.align(Alignment.CenterStart).apparition(0, texte)
                        .background(fond, RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 3.dp),
                )
            }
        }
    }
}
