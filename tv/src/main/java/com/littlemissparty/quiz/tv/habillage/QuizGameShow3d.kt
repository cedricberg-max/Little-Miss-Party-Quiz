package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.R
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlinx.coroutines.launch

/*
 * Écran de question du Quiz en 3D (maquettes validées par cedric le 24 octobre) : cartes « tube néon » (C), panneau
 * « enseigne » (B), chrono « anneau à liquide » (B). Le relief, les reflets et les lueurs sont des planches calculées à
 * l'avance (res/drawable-nodpi/gs_q3d_*, dessinées pour un écran 1920 × 1080 : 1 dp = 2 px de planche), étirées en
 * 9 parts ; les textes (question, réponses, lettres, chiffres) sont toujours écrits en direct. Sur la box : quelques
 * images posées, aucun calcul 3D ; seul le liquide du chrono passe par un petit calque (381 px de côté).
 * Une planche absente : null, et l'écran garde le dessin Game Show d'avant.
 */

internal class PlanchesQuiz3d(
    val carteFond: ImageBitmap, val neons: List<ImageBitmap>, val juste: ImageBitmap, val eteinte: ImageBitmap,
    val lettres: List<ImageBitmap>, val panneau: ImageBitmap, val onglet: ImageBitmap, val cadre: ImageBitmap,
    val chronoFond: ImageBitmap, val chronoCyan: ImageBitmap, val chronoRouge: ImageBitmap,
    val teteCyan: ImageBitmap, val teteRouge: ImageBitmap,
)

/** Les planches, dans l'ordre de [planchesDepuis] ; néons et lettres dans l'ordre des propositions (rose, orange, vert, jaune). */
internal val NOMS_QUIZ3D = listOf(
    "carte_fond", "carte_neon_rose", "carte_neon_orange", "carte_neon_vert", "carte_neon_jaune", "carte_juste", "carte_eteinte",
    "lettre_rose", "lettre_orange", "lettre_vert", "lettre_jaune", "panneau", "onglet", "cadre",
    "chrono_fond", "chrono_cyan", "chrono_rouge", "chrono_tete_cyan", "chrono_tete_rouge",
).map { "gs_q3d_$it" }

internal fun planchesDepuis(l: List<ImageBitmap>) = PlanchesQuiz3d(
    l[0], l.subList(1, 5), l[5], l[6], l.subList(7, 11), l[11], l[12], l[13], l[14], l[15], l[16], l[17], l[18],
)

/** Lues une seule fois pour toute l'appli : les 4 cartes, le panneau et le chrono partagent les mêmes images. */
private var planchesQuiz3dLues: PlanchesQuiz3d? = null
private var planchesQuiz3dEssayees = false

/** Les planches du Quiz 3D, ou null (look Classique, ou une image manque : l'écran garde son dessin d'avant). */
@Composable
internal fun planchesQuiz3d(): PlanchesQuiz3d? {
    if (!Look.gs) return null
    val context = LocalContext.current
    return remember {
        if (!planchesQuiz3dEssayees) {
            planchesQuiz3dEssayees = true
            planchesQuiz3dLues = runCatching {
                val res = context.resources
                val ids = NOMS_QUIZ3D.map { res.getIdentifier(it, "drawable", context.packageName) }
                if (ids.any { it == 0 }) null else planchesDepuis(ids.map { ImageBitmap.imageResource(res, it) })
            }.getOrNull()
        }
        planchesQuiz3dLues
    }
}

/** Baloo extra-grasse, comme sur les maquettes (question et réponses). */
private val BalooQuiz3d = FontFamily(Font(R.font.lmp_baloo_extrabold, FontWeight.Black))

/** Contour sombre des textes posés sur le verre (le « contour 2 px » des maquettes). */
private val ContourTexte = Color(0xE60A0614)

// ---------------------------------------------------------------------------------------------------------------------
// Calculs de mise en page (sans Compose, testés dans QuizGameShow3dTest).

/**
 * Découpe d'un axe en 9 parts : bornes de la source (0, coin, fin - coin, fin) puis de la destination, en pixels
 * entiers (pas de couture entre deux parts). Les coins gardent [echelle] px d'écran par px de planche, sans dépasser
 * la moitié de la destination.
 */
internal fun tranches(source: Int, coin: Int, debut: Float, longueur: Float, echelle: Float): IntArray {
    val c = coin.coerceIn(0, source / 2)
    val cd = minOf(c * echelle, longueur / 2)
    val d0 = debut.roundToInt()
    val d3 = (debut + longueur).roundToInt()
    val d1 = (debut + cd).roundToInt()
    val d2 = (debut + longueur - cd).roundToInt().coerceAtLeast(d1)
    return intArrayOf(0, c, source - c, source, d0, d1, d2, d3)
}

/** Réduction de la planche d'une carte basse (maquette : 1 jusqu'à 232 px de haut, puis proportionnelle). */
internal fun echelleCarte(hauteurPlanche: Float): Float = ((hauteurPlanche + 120f) / 352f).coerceIn(0.3f, 1f)

/**
 * Masque du liquide du chrono : la part [reste] du tour depuis midi, sens horaire, bords adoucis de 9°. Arrêts
 * (position 0..1 sur le tour, opacité) pour un dégradé conique qui part de midi.
 */
internal fun masqueSecteur(reste: Float, flou: Float = 9f / 360f): List<Pair<Float, Float>> {
    val q = reste.coerceIn(0f, 1f)
    fun a(t: Float) = (((q - t) / (2 * flou)) + 0.5f).coerceIn(0f, 1f) * ((t / (2 * flou)) + 0.5f).coerceIn(0f, 1f)
    return listOf(0f, flou, q - flou, q, q + flou, 1f).map { it.coerceIn(0f, 1f) }.distinct().sorted().map { it to a(it) }
}

/** Taille du chiffre du chrono, en unités du cadran (1 unité = 59,5 dp) : l'encre tient dans l'anneau intérieur. */
internal fun tailleChiffreChrono(n: Int): Float = when ("$n".length) {
    1 -> 0.655f
    2 -> 0.445f
    else -> 0.33f
}

/** Le chrono passe au rouge et bat à chaque seconde dans les 3 dernières (et à 0). */
internal fun chronoUrgent(secondes: Int): Boolean = secondes <= 3

// ---------------------------------------------------------------------------------------------------------------------

/** Une planche étirée en 9 parts sur le rectangle ([x], [y], [w], [h]) ; [coinX] × [coinY] : coins de la source (px). */
internal fun DrawScope.neufParts(
    img: ImageBitmap, x: Float, y: Float, w: Float, h: Float, coinX: Int, coinY: Int, echelle: Float,
    alpha: Float = 1f, filtre: ColorFilter? = null,
) {
    if (alpha <= 0.004f || w < 1f || h < 1f) return
    val xs = tranches(img.width, coinX, x, w, echelle)
    val ys = tranches(img.height, coinY, y, h, echelle)
    for (i in 0 until 3) for (j in 0 until 3) {
        val sw = xs[i + 1] - xs[i]
        val sh = ys[j + 1] - ys[j]
        val dw = xs[i + 5] - xs[i + 4]
        val dh = ys[j + 5] - ys[j + 4]
        if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue
        drawImage(
            img, IntOffset(xs[i], ys[j]), IntSize(sw, sh), IntOffset(xs[i + 4], ys[j + 4]), IntSize(dw, dh),
            alpha = alpha.coerceAtMost(1f), colorFilter = filtre,
        )
    }
}

/** Une image entière posée sur ([x], [y], [w], [h]). */
private fun DrawScope.pose(img: ImageBitmap, x: Float, y: Float, w: Float, h: Float, alpha: Float = 1f, filtre: ColorFilter? = null) {
    if (alpha <= 0.004f || w < 1f || h < 1f) return
    drawImage(
        img, IntOffset.Zero, IntSize(img.width, img.height), IntOffset(x.roundToInt(), y.roundToInt()),
        IntSize(w.roundToInt(), h.roundToInt()), alpha = alpha.coerceAtMost(1f), colorFilter = filtre,
    )
}

/** Px d'écran par px de planche (planches dessinées pour 1920 × 1080, soit 2 px par dp). */
private val DrawScope.k: Float get() = density / 2f

/** Gris de la lettre d'une carte éteinte (luminance assombrie de moitié). */
private val GrisEteint = ColorFilter.colorMatrix(
    ColorMatrix(
        floatArrayOf(
            0.164f, 0.323f, 0.063f, 0f, 0f,
            0.164f, 0.323f, 0.063f, 0f, 0f,
            0.164f, 0.323f, 0.063f, 0f, 0f,
            0f, 0f, 0f, 1f, 0f,
        ),
    ),
)

/**
 * Une proposition A, B, C, D en « tube néon » : verre sombre, tube de sa couleur, lettre dans sa bulle (centrée sur
 * l'anneau). Révélation au rythme d'aujourd'hui : les mauvaises s'éteignent (gris), la bonne passe au VERT avec sa coche.
 */
@Composable
internal fun CarteQuiz3d(p: PlanchesQuiz3d, i: Int, text: String, correct: Int?, modifier: Modifier, express: Boolean) {
    val isCorrect = correct == i
    val rangMauvaise = if (correct == null) 0 else (0 until i).count { it != correct }
    val eteinte = apres(Tempo.mauvaiseSEteint(rangMauvaise, express), correct, actif = correct != null && !isCorrect)
    val juste = apres(Tempo.revelationOr(express), correct, actif = isCorrect)
    val j by animateFloatAsState(if (juste) 1f else 0f, tween(350), label = "juste")
    val e by animateFloatAsState(if (eteinte) 1f else 0f, tween(350), label = "eteinte")
    val c = i % p.neons.size
    val couleur = GS.Propositions[c % GS.Propositions.size]
    BoxWithConstraints(modifier.rebond(juste).drawBehind { dessineCarte(p, c, j, e) }) {
        // Bulle de la lettre : 86 % de la hauteur, 100 dp au plus (maquette : 200 px).
        val ls = minOf(100f, maxHeight.value * 0.86f)
        Row(
            Modifier.fillMaxSize().padding(start = (9f + (100f - ls) / 4f).dp, end = if (juste) 65.dp else 20.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(ls.dp).drawBehind { dessineBulle(p, c, j, e) }, contentAlignment = Alignment.Center) {
                val k = LocalDensity.current.density / 2f
                Text(
                    "ABCD"[i % 4].toString(),
                    style = styleCentre((ls * 0.36f).sp, lerpVers(Color.White, Color(0xB3787682), e), FontWeight.Normal).copy(
                        fontFamily = PoliceGsTitre,
                        shadow = Shadow(lerpVers(couleur, GS.Juste, j).copy(alpha = 1f - e), Offset.Zero, 16f * k),
                    ),
                    maxLines = 1, softWrap = false,
                )
            }
            Spacer(Modifier.width(11.dp))
            TexteReponse3d(
                text, lerpVers(Color.White, Color(0xB39692A5), e), if (eteinte) null else ContourTexte,
                Modifier.weight(1f).fillMaxHeight(),
            )
        }
    }
}

private fun DrawScope.dessineCarte(p: PlanchesQuiz3d, c: Int, j: Float, e: Float) {
    val s = k * echelleCarte(size.height / k)
    val mg = 60f * s
    val x = -mg
    val y = -mg
    val w = size.width + 2 * mg
    val h = size.height + 2 * mg
    // Carte éteinte : le verre reste presque plein, le décor ne remonte pas à travers (cedric, 24 octobre).
    neufParts(p.carteFond, x, y, w, h, 170, 120, s, 1f - 0.12f * e)
    neufParts(p.neons[c], x, y, w, h, 170, 120, s, (1f - j - e).coerceIn(0f, 1f))
    neufParts(p.juste, x, y, w, h, 170, 120, s, j)
    neufParts(p.eteinte, x, y, w, h, 170, 120, s, e)
    if (j > 0.01f) {
        // La coche de la bonne réponse : disque blanc, halo vert, trait vert.
        val r = minOf(38f, size.height / k / 3f) * k * (0.6f + 0.4f * j)
        val centre = Offset(size.width - 70f * k, size.height / 2)
        val rh = r * 1.9f
        drawCircle(
            Brush.radialGradient(
                0f to GS.Juste.copy(alpha = 0.78f * j), (r / rh) to GS.Juste.copy(alpha = 0.5f * j), 1f to Color.Transparent,
                center = centre, radius = rh,
            ),
            rh, centre,
        )
        drawCircle(Color.White.copy(alpha = j), r, centre)
        val coche = Path().apply {
            moveTo(centre.x - r * 0.45f, centre.y)
            lineTo(centre.x - r * 0.1f, centre.y + r * 0.37f)
            lineTo(centre.x + r * 0.5f, centre.y - r * 0.34f)
        }
        drawPath(coche, GS.JusteProfond.copy(alpha = j), style = Stroke(maxOf(6f * k, r / 4f), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

private fun DrawScope.dessineBulle(p: PlanchesQuiz3d, c: Int, j: Float, e: Float) {
    val w = size.width
    pose(p.lettres[c], 0f, 0f, w, w, (1f - j) * (1f - e))
    pose(p.lettres[2], 0f, 0f, w, w, j)
    pose(p.lettres[c], 0f, 0f, w, w, 0.8f * e, GrisEteint)
}

/** Style Baloo des réponses et de la question, à l'interligne naturel de la police (chaque ligne a sa propre case). */
private fun styleBaloo3d(taille: Float, couleur: Color = Color.White, ombre: Shadow? = null) =
    TextStyle(fontFamily = BalooQuiz3d, fontWeight = FontWeight.Black, fontSize = taille.sp, color = couleur, shadow = ombre)

/** Les lignes de [texte] telles que Text les couperait sur [largeur] px, sans espaces de bout de ligne. */
private fun TextMeasurer.lignes(texte: String, style: TextStyle, largeur: Int, max: Int): List<String> {
    val r = measure(texte, style, constraints = Constraints(maxWidth = largeur.coerceAtLeast(1)))
    val l = (0 until r.lineCount).map { texte.substring(r.getLineStart(it), r.getLineEnd(it, visibleEnd = true)).trim() }.filter { it.isNotEmpty() }
    return if (l.size <= max) l else l.take(max - 1) + (l[max - 1] + "…")
}

/**
 * Lignes à pas fixe : chaque ligne est centrée dans sa case de [pas], au milieu de la police comme sur les maquettes.
 * L'interligne ne dépend ainsi ni du moteur de texte ni de la police ; lu comme un seul texte par l'accessibilité.
 */
@Composable
private fun LignesAPas(texte: String, lignes: List<String>, style: TextStyle, pas: Float, centre: Boolean, modifier: Modifier = Modifier) {
    Column(
        modifier.clearAndSetSemantics { text = AnnotatedString(texte) },
        horizontalAlignment = if (centre) Alignment.CenterHorizontally else Alignment.Start,
    ) {
        for (l in lignes) Box(Modifier.height(pas.dp), contentAlignment = Alignment.Center) {
            Text(l, style = style, maxLines = 1, softWrap = false, modifier = Modifier.wrapContentHeight(unbounded = true))
        }
    }
}

/** Le texte d'une réponse : la plus grande taille (33 à 13 sp) qui tient en 2 lignes sans couper de mot. */
@Composable
private fun TexteReponse3d(text: String, couleur: Color, contour: Color?, modifier: Modifier) {
    val mesure = rememberTextMeasurer()
    val densite = LocalDensity.current.density
    BoxWithConstraints(modifier, contentAlignment = Alignment.CenterStart) {
        val larg = constraints.maxWidth
        // Hauteur utile : la carte moins 20 dp (maquette : 40 px de marge).
        val haut = maxHeight.value - 20f
        val (taille, lignes) = remember(text, larg, haut) {
            var t = 33f
            var l = mesure.lignes(text, styleBaloo3d(t), larg, 3)
            while (t > 13f) {
                val motLePlusLong = text.split(' ').maxOfOrNull { m -> mesure.measure(m, styleBaloo3d(t), maxLines = 1, softWrap = false).size.width } ?: 0
                if (l.size <= 2 && l.size * t * 1.08f <= haut && motLePlusLong <= larg) break
                t -= 1f
                l = mesure.lignes(text, styleBaloo3d(t), larg, 3)
            }
            t to mesure.lignes(text, styleBaloo3d(t), larg, 2)
        }
        val k = densite / 2f
        LignesAPas(text, lignes, styleBaloo3d(taille, couleur, contour?.let { Shadow(it, Offset.Zero, 6f * k) }), taille * 1.08f, centre = false)
    }
}

/**
 * La question dans son enseigne : une ligne en grand (38 sp) si elle tient, sinon 32 sp sur 3 lignes au plus, réduite
 * jusqu'à tenir en entier. L'enseigne prend la hauteur du texte ; sa lueur déborde de 30 dp tout autour.
 */
@Composable
internal fun QuestionPanneau3d(p: PlanchesQuiz3d, texte: String, modifier: Modifier, festif: Boolean = false) {
    val mesure = rememberTextMeasurer()
    val k = LocalDensity.current.density / 2f
    BoxWithConstraints(
        modifier.drawBehind { neufParts(p.panneau, -60f * k, -60f * k, size.width + 120f * k, size.height + 120f * k, 170, 140, k) },
        contentAlignment = Alignment.Center,
    ) {
        val larg = (constraints.maxWidth - 80.dp.value * k * 2f).roundToInt().coerceAtLeast(1)
        // Maquette : 76 px sur une ligne (pas 86, marges 32), 64 px au-delà (pas 72, marges 22), 3 lignes au plus.
        val (taille, pas, lignes) = remember(texte, larg) {
            if (mesure.measure(texte, styleBaloo3d(38f), maxLines = 1, softWrap = false).size.width <= larg) Triple(38f, 43f, listOf(texte))
            else {
                var t = 32f
                while (t > 22f && mesure.lignes(texte, styleBaloo3d(t), larg, 4).size > 3) t -= 1f
                Triple(t, t * 1.125f, mesure.lignes(texte, styleBaloo3d(t), larg, 3))
            }
        }
        // Quiz musical (cedric, 24/10 : « trop sage » ; proposition T1 choisie le 25/10) : un titre court, un néon de couleur par mot.
        if (festif && lignes.size == 1) MotsNeon(texte, 40.sp, Modifier.padding(vertical = 14.dp))
        else LignesAPas(
            texte, lignes, styleBaloo3d(taille, Color.White, Shadow(Color(0xB39678FF), Offset.Zero, 24f * k)), pas, centre = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 40.dp, vertical = if (lignes.size == 1) 16.dp else 11.dp).offset(y = (-2).dp),
        )
    }
}

/**
 * L'onglet « Question 4 / 10 » : plaque néon cyan, texte blanc à lueur cyan, réduit (jusqu'à 12 sp) plutôt que coupé ;
 * encore trop long (« Quiz musical · Comptines · question 1 / 10 »), il passe sur deux lignes, jamais de « … ».
 */
@Composable
internal fun OngletQuiz3d(p: PlanchesQuiz3d, texte: String, modifier: Modifier) {
    val k = LocalDensity.current.density / 2f
    val mesure = rememberTextMeasurer()
    fun style(t: Float) = styleEtiquetteGs(t.sp, Color.White, (t / 6f).sp).copy(shadow = Shadow(GS.Cyan.copy(alpha = 0.85f), Offset.Zero, 17f * k))
    // Prend toute sa part de la ligne : le chrono reste calé à droite, à la place des maquettes, quelle que soit l'étape.
    BoxWithConstraints(modifier.fillMaxWidth().padding(start = 4.dp), contentAlignment = Alignment.CenterStart) {
        // Place du texte : la largeur donnée moins les 22 dp de plaque de chaque côté.
        val dispo = constraints.maxWidth - (44.dp.value * k * 2f).roundToInt()
        val taille = remember(texte, dispo) {
            var t = 18f
            while (t > 12f && mesure.measure(texte, style(t), maxLines = 1, softWrap = false).size.width > dispo) t -= 0.5f
            t
        }
        val tient = remember(texte, dispo, taille) { mesure.measure(texte, style(taille), maxLines = 1, softWrap = false).size.width <= dispo }
        Text(
            texte, maxLines = if (tient) 1 else 2, softWrap = !tient, style = style(taille),
            modifier = Modifier
                .drawBehind { neufParts(p.onglet, -60f * k, -60f * k, size.width + 120f * k, size.height + 120f * k, 140, 98, k) }
                .padding(horizontal = 22.dp, vertical = 9.dp),
        )
    }
}

/** Cadre néon de l'illustration (photo ou émoji) à la révélation ; la photo se pose 13 dp à l'intérieur. */
internal fun Modifier.cadreQuiz3d(p: PlanchesQuiz3d): Modifier = drawBehind {
    neufParts(p.cadre, -60f * k, -60f * k, size.width + 120f * k, size.height + 120f * k, 150, 150, k)
}

/**
 * Chrono « anneau à liquide » : cadran chromé, liquide cyan qui se vide dans le sens des aiguilles, bille de tête ;
 * calme jusqu'à 3 s, puis rouge et un battement à chaque seconde, halo rouge à 0. Garde la place de l'ancien chrono
 * (86 dp) et déborde autour sans rien pousser.
 */
@Composable
internal fun ChronoAnneau3d(p: PlanchesQuiz3d, seconds: Int, fraction: Float) {
    val urgent = chronoUrgent(seconds)
    val rouge by animateFloatAsState(if (urgent) 1f else 0f, tween(300), label = "rouge")
    val battement = remember { Animatable(1f) }
    val pop = remember { Animatable(1f) }
    val flash = remember { Animatable(0f) }
    LaunchedEffect(seconds) {
        launch { pop.snapTo(1.1f); pop.animateTo(1f, tween(300, easing = LinearOutSlowInEasing)) }
        if (urgent) launch { battement.animateTo(1.06f, tween(60)); battement.animateTo(1f, tween(450, easing = FastOutSlowInEasing)) }
        if (seconds == 0) launch { flash.snapTo(1.55f); flash.animateTo(0.35f, tween(1200, easing = LinearOutSlowInEasing)) }
        else flash.snapTo(0f)
    }
    val f = fraction.coerceIn(0f, 1f)
    val k = LocalDensity.current.density / 2f
    val u = 59.5f
    Box(Modifier.size(86.dp)) {
        Box(
            Modifier
                // Le cadran (190,5 dp avec sa lueur) déborde de la place de 86 dp, centré dessus, sans rien pousser.
                .fillMaxSize()
                .wrapContentSize(Alignment.Center, unbounded = true)
                .size(190.5.dp)
                // Centre du cadran à la place des maquettes (1730, 112 px) : il ne touche pas l'enseigne de la question.
                .offset(x = (-12).dp, y = (-11).dp)
                .drawBehind {
                    // Halo rouge (urgence, battement, temps écoulé), puis le cadran.
                    val uPx = 119f * k
                    val force = flash.value + (if (f > 0f) 0.35f * rouge else 0f) + 0.8f * rouge * ((battement.value - 1f) / 0.06f).coerceAtLeast(0f)
                    if (force > 0.01f) {
                        val r = 1.15f * uPx * 1.6f
                        val a = (0.67f * force).coerceAtMost(1f)
                        drawCircle(
                            Brush.radialGradient(0f to ROUGE_CHRONO.copy(alpha = a), 0.45f to ROUGE_CHRONO.copy(alpha = a), 0.62f to ROUGE_CHRONO.copy(alpha = a * 0.5f), 1f to Color.Transparent, center = center, radius = r),
                            r, center,
                        )
                    }
                }
                .graphicsLayer { scaleX = battement.value; scaleY = battement.value },
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.fillMaxSize().drawBehind { pose(p.chronoFond, 0f, 0f, size.width, size.height) })
            if (f > 0f) Box(
                Modifier
                    .fillMaxSize()
                    .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                    .drawBehind { dessineLiquide(p, f, rouge, 119f * k) },
            )
            if (f > 0f && f < 1f) Box(
                Modifier.fillMaxSize().drawBehind {
                    val a = 2 * PI.toFloat() * f
                    val r = 0.67f * 119f * k
                    val cx = center.x + sin(a) * r
                    val cy = center.y - cos(a) * r
                    val t = 202f * k
                    pose(p.teteCyan, cx - t / 2, cy - t / 2, t, t, 1f - rouge)
                    pose(p.teteRouge, cx - t / 2, cy - t / 2, t, t, rouge)
                },
            )
            val rr = if (seconds > 0) rouge else 1f
            Text(
                "$seconds", maxLines = 1, softWrap = false,
                style = styleCentre((tailleChiffreChrono(seconds) * u).sp, lerpVers(Color.White, Color(0xFFFFE8EC), rr), FontWeight.Normal).copy(
                    fontFamily = PoliceGsTitre,
                    shadow = Shadow(lerpVers(CYAN_CHRONO, ROUGE_CHRONO, rr).copy(alpha = 0.6f + 0.3f * rr), Offset.Zero, 17f * k),
                ),
                modifier = Modifier.graphicsLayer { scaleX = pop.value; scaleY = pop.value },
            )
        }
    }
}

private val CYAN_CHRONO = Color(0xFF00E1FF)
private val ROUGE_CHRONO = Color(0xFFFF2A3A)

/** Le liquide restant : planche allumée (cyan → rouge), découpée en secteur depuis midi et vidée au centre. */
private fun DrawScope.dessineLiquide(p: PlanchesQuiz3d, reste: Float, rouge: Float, u: Float) {
    pose(p.chronoCyan, 0f, 0f, size.width, size.height, 1f - rouge)
    pose(p.chronoRouge, 0f, 0f, size.width, size.height, rouge)
    if (reste < 1f) {
        val arrets = masqueSecteur(reste).map { (t, a) -> t to Color.White.copy(alpha = a) }.toTypedArray()
        rotate(-90f) { drawRect(Brush.sweepGradient(*arrets, center = center), blendMode = BlendMode.DstIn) }
    }
    drawRect(
        Brush.radialGradient(
            0f to Color.Transparent, (0.45f / 1.12f) to Color.Transparent, (0.55f / 1.12f) to Color.White,
            (0.92f / 1.12f) to Color.White, 1f to Color.Transparent, center = center, radius = 1.12f * u,
        ),
        blendMode = BlendMode.DstIn,
    )
}
