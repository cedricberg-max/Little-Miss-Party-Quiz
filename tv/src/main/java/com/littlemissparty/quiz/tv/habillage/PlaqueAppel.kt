package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.InfiniteTransition
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * Les onglets d'appel et de conseil du Game Show (« BUZZEZ ! », « MÉMORISEZ ! », « TAPEZ ! »…), validés par cedric le
 * 31/10 à 11:12 (planche /mnt/project-files/the-game-show/onglets-appel-31-octobre/, artifact WpVPaSvm8cKJRZMZVEQrDV).
 * Une plaque pleine aux coins arrondis, contour néon et sa lueur, le mot d'appel en Bungee puis une petite ligne en
 * Rajdhani ; chaque jeu a son habillage et sa petite animation (couches légères, rien ne pilote le jeu). Pas de contour
 * « comme les jauges ». Mesures de la planche en px d'un écran de 1280 (1 px = 0,75 dp) ; [k] : dans une scène dessinée
 * plus grande puis réduite (Echelle), ce que vaut 1 dp de l'écran en dp de la scène.
 */
enum class GenrePlaque { BLIND, FLOUE, CHANTE, DISPARU, QUISUIS, GONFLEUR, BOMBE, DUEL }

/** Blanc doux de la petite ligne (règle de cedric du 31/10 à 11:03 : plus de blanc pur sur un fond sombre). */
internal val BlancDoux = Color(0xFFECE8F6)
/** Petite ligne des plaques bleu nuit (Blind test, Image floue, Chante le mot), la référence de cedric du 31/10. */
internal val LigneBleuNuit = Color(0xFFBFF6FF)

internal val CyanAppel = Color(0xFF3FE0FF)
private val RoseAppel = Color(0xFFFF4FD8)
internal val RoseChante = Color(0xFFFF5AA8)
private val JauneAppel = Color(0xFFFFE14A)
private val VertAppel = Color(0xFF5DFF6A)
private val OrangeAppel = Color(0xFFFF9A3C)
private val OrDisparu = Color(0xFFFFD23F)

private class StylePlaque(
    val fond: List<Color>,
    val contour: Brush,
    /** Épaisseur du contour, en px de 1280. */
    val trait: Float,
    /** Rayon des coins en px de 1280 ; négatif : pilule. */
    val coins: Float,
    val lueur: Color,
    val mot: Color,
    val motLueur: Color,
    val motPx: Float,
    val police: FontFamily,
    val ligne: Color,
    val lignePx: Float,
    /** Marges intérieures haut, droite, bas, gauche (px de 1280). */
    val marges: List<Float> = listOf(18f, 30f, 16f, 30f),
    /** Filet intérieur (Blind test : rose ; Qui a disparu : double filet doré). */
    val filet: Color? = null,
)

private fun style(genre: GenrePlaque): StylePlaque = when (genre) {
    GenrePlaque.BLIND -> StylePlaque(
        listOf(Color(0xFF0C2A48), Color(0xFF051425)), Brush.linearGradient(listOf(CyanAppel, CyanAppel)), 3f, 18f, CyanAppel,
        Color.White, CyanAppel, 40f, PoliceGsTitre, LigneBleuNuit, 24f, filet = RoseAppel.copy(alpha = 0.33f),
    )
    // Image floue et Zoom mystère : fond et lettres exactement comme le Blind test, contour blanc-bleu.
    GenrePlaque.FLOUE -> StylePlaque(
        listOf(Color(0xFF0C2A48), Color(0xFF051425)), Brush.linearGradient(listOf(Color(0xD9E1FAFF), Color(0xD9E1FAFF))), 3f, 18f,
        Color(0xFF9FF0FF), Color.White, CyanAppel, 40f, PoliceGsTitre, LigneBleuNuit, 24f,
    )
    GenrePlaque.CHANTE -> StylePlaque(
        listOf(Color(0xFF0C2A48), Color(0xFF051425)), Brush.linearGradient(listOf(RoseChante, RoseChante)), 3f, 18f, RoseChante,
        Color.White, RoseChante, 40f, PoliceGsTitre, LigneBleuNuit, 24f, marges = listOf(18f, 30f, 16f, 44f),
    )
    GenrePlaque.DISPARU -> StylePlaque(
        listOf(Color(0xFF0D1430), Color(0xFF0A1024)), Brush.linearGradient(listOf(OrDisparu, OrDisparu)), 3f, 10f, OrDisparu,
        OrDisparu, Color(0xFFFFB000), 40f, PoliceGsTitre, Color(0xFFE8ECFF), 24f, filet = OrDisparu.copy(alpha = 0.53f),
    )
    // Qui suis-je, choix A (09:20).
    GenrePlaque.QUISUIS -> StylePlaque(
        listOf(Color(0xFF3A1260), Color(0xFF1C0838)), Brush.linearGradient(listOf(RoseAppel, RoseAppel)), 3f, 17f, RoseAppel,
        JauneAppel, Color(0xAAFFB000), 35f, PoliceGsTitre, BlancDoux, 21f, marges = listOf(17f, 28f, 15f, 28f),
    )
    GenrePlaque.GONFLEUR -> StylePlaque(
        listOf(Color(0xFF2C0D48), Color(0xFF170628)),
        Brush.linearGradient(listOf(RoseAppel, OrangeAppel, VertAppel, JauneAppel, RoseAppel)), 5f, -1f, RoseAppel,
        Color.White, RoseAppel, 40f, PoliceGsTitre, BlancDoux, 24f, marges = listOf(16f, 84f, 14f, 118f),
    )
    GenrePlaque.BOMBE -> StylePlaque(
        listOf(Color(0xFF2A0806), Color(0xFF1C0504)),
        Brush.linearGradient(
            0f to Color(0xFFFFD21A), 0.5f to Color(0xFFFFD21A), 0.5f to Color(0xFF111111), 1f to Color(0xFF111111),
            start = Offset.Zero, end = Offset(17f, 17f), tileMode = TileMode.Repeated,
        ),
        5f, 12f, Color(0xFFFF3B2F), Color(0xFFFFD21A), Color(0xFFFF3B2F), 33f, PoliceGsTitre, BlancDoux, 20f,
        marges = listOf(14f, 24f, 12f, 24f),
    )
    GenrePlaque.DUEL -> StylePlaque(
        listOf(Color(0xFF5A3418), Color(0xFF2E180A)), Brush.linearGradient(listOf(Color(0xFFFF9A3C), Color(0xFFFF9A3C))), 3f, 12f,
        Color(0xFFFF9A3C), Color(0xFFFFE7B0), Color(0xFFFF9A3C), 31f, PoliceGsWestern, Color(0xFFFFE7B0), 22f,
    )
}

/**
 * Un onglet d'appel : [mot] (« BUZZEZ ! ») et [ligne] (peut contenir des retours à la ligne ; vide : pas de ligne).
 * Jamais coupé, de 1 à 8 équipes : trop large ou trop haut pour sa place, il rapetisse en entier.
 */
@Composable
fun PlaqueAppel(genre: GenrePlaque, mot: String, ligne: String, modifier: Modifier = Modifier, k: Float = 1f) {
    val s = style(genre)
    val u = 0.75f * k
    val boucle = rememberInfiniteTransition(label = "plaque")
    // Animation de toute la plaque : balancement (Chante), battement de cœur (Bombe), écrasement (Gonfleur).
    val balance by boucle.animateFloat(-2.5f, 2.5f, infiniteRepeatable(tween(1200, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "balance")
    val coeur by boucle.animateFloat(
        1f, 1f,
        infiniteRepeatable(keyframes { durationMillis = 1100; 1f at 0; 1.035f at 132; 1f at 264; 1.025f at 396; 1f at 550 }), label = "coeur",
    )
    val ecrase by boucle.animateFloat(0f, 0f, infiniteRepeatable(keyframes { durationMillis = 700; 0f at 0; 1f at 294; -0.5f at 420; 0f at 700 }), label = "ecrase")
    val defile by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(3000, easing = LinearEasing)), label = "defile")
    val net by boucle.animateFloat(0f, 0f, infiniteRepeatable(keyframes { durationMillis = 3200; 0f at 0; 1f at 1280; 1f at 2240; 0f at 3200 }), label = "net")
    val gonfle by boucle.animateFloat(1f, 1.06f, infiniteRepeatable(tween(350), RepeatMode.Reverse), label = "gonfle")
    val densite = LocalDensity.current
    fun px(v: Float) = with(densite) { (v * u).dp.toPx() }
    val forme = if (s.coins < 0) RoundedCornerShape(50) else RoundedCornerShape((s.coins * u).dp)
    Box(modifier.ajusteSaPlace(), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .graphicsLayer {
                    when (genre) {
                        GenrePlaque.CHANTE -> rotationZ = balance
                        GenrePlaque.BOMBE -> { scaleX = coeur; scaleY = coeur }
                        GenrePlaque.GONFLEUR -> { scaleX = 1f + 0.03f * ecrase; scaleY = 1f - 0.06f * ecrase }
                        else -> Unit
                    }
                }
                .drawBehind {
                    val r = if (s.coins < 0) size.height / 2 else px(s.coins)
                    // Ombre portée (0 8 22 noir 80 %), puis la lueur néon autour : quelques contours de plus en plus larges.
                    for (i in 1..3) drawRoundRect(
                        Color.Black.copy(alpha = 0.22f), Offset(-px(2f * i), px(8f) - px(2f * i) + px(4f)),
                        Size(size.width + px(4f * i), size.height + px(4f * i)), CornerRadius(r + px(2f * i)),
                    )
                    listOf(4f to 0.45f, 10f to 0.22f, 20f to 0.10f).forEach { (l, a) ->
                        drawRoundRect(s.lueur.copy(alpha = a), Offset.Zero, size, CornerRadius(r), style = Stroke(px(s.trait + l)))
                    }
                }
                .background(Brush.verticalGradient(s.fond), forme)
                .border((s.trait * u).dp, if (genre == GenrePlaque.GONFLEUR) contourQuiDefile(defile) else s.contour, forme)
                .drawBehind {
                    val f = s.filet ?: return@drawBehind
                    val r = if (s.coins < 0) size.height / 2 else px(s.coins)
                    val e = px(if (genre == GenrePlaque.DISPARU) 6f else 4f)
                    drawRoundRect(f, Offset(e, e), Size(size.width - 2 * e, size.height - 2 * e), CornerRadius((r - e).coerceAtLeast(0f)), style = Stroke(px(2f)))
                },
        ) {
            // Gonfleur : seule la plaque s'écrase, les lettres gardent leurs proportions (un texte déformé passerait pour
            // un texte rogné dans le tour des écrans, et il se lit mieux droit).
            // Les marges sur le texte seulement : les décors se placent depuis le bord de la plaque, comme sur la planche.
            Column(
                Modifier.padding(start = (s.marges[3] * u).dp, top = (s.marges[0] * u).dp, end = (s.marges[1] * u).dp, bottom = (s.marges[2] * u).dp).graphicsLayer { if (genre == GenrePlaque.GONFLEUR) { scaleX = 1f / (1f + 0.03f * ecrase); scaleY = 1f / (1f - 0.06f * ecrase) } },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.Center) {
                    if (genre == GenrePlaque.BLIND) { Egaliseur(boucle, u); Spacer(Modifier.width((14 * u).dp)) }
                    Text(
                        mot, maxLines = 1, softWrap = false,
                        modifier = Modifier.graphicsLayer { if (genre == GenrePlaque.GONFLEUR) { scaleX = gonfle; scaleY = gonfle } },
                        style = TextStyle(
                            fontFamily = s.police, fontSize = with(densite) { (s.motPx * u).dp.toSp() },
                            letterSpacing = with(densite) { (s.motPx * u * 0.03f).dp.toSp() }, color = s.mot,
                            // Image floue : le mot passe du flou au net (planche : flou 2,2 px → net en 3,2 s), rendu par sa lueur.
                            shadow = Shadow(s.motLueur, Offset.Zero, px(if (genre == GenrePlaque.FLOUE) 6f + 10f * (1f - net) else 9f)),
                        ),
                    )
                }
                if (ligne.isNotEmpty()) {
                    Spacer(Modifier.height((8 * u).dp))
                    Text(
                        ligne, textAlign = TextAlign.Center,
                        style = TextStyle(
                            fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, color = s.ligne,
                            fontSize = with(densite) { (s.lignePx * u).dp.toSp() }, lineHeight = with(densite) { (s.lignePx * u * 1.15f).dp.toSp() },
                        ),
                    )
                }
            }
            DecorPlaque(genre, boucle, u)
        }
    }
}

/** Gonfleur : le contour dégradé rose → orange → vert → jaune défile en 3 s. */
private fun contourQuiDefile(t: Float): Brush {
    val l = 600f
    return Brush.linearGradient(
        listOf(RoseAppel, OrangeAppel, VertAppel, JauneAppel, RoseAppel),
        start = Offset(-t * l, 0f), end = Offset(l - t * l, 0f), tileMode = TileMode.Repeated,
    )
}

/**
 * Trop large ou trop haut pour sa place : tout rapetisse d'un même facteur, depuis le centre (jamais rogné, jamais
 * « … »). Les décors qui débordent de la plaque restent visibles.
 */
private fun Modifier.ajusteSaPlace() = layout { mesurable, c ->
    val p = mesurable.measure(Constraints())
    val e = minOf(
        1f,
        if (c.hasBoundedWidth) c.maxWidth.toFloat() / p.width.coerceAtLeast(1) else 1f,
        if (c.hasBoundedHeight) c.maxHeight.toFloat() / p.height.coerceAtLeast(1) else 1f,
    )
    val w = (p.width * e).roundToInt().coerceIn(c.minWidth, c.maxWidth)
    val h = (p.height * e).roundToInt().coerceIn(c.minHeight, if (c.hasBoundedHeight) c.maxHeight else Int.MAX_VALUE)
    layout(w, h) {
        p.placeWithLayer((w - p.width) / 2, (h - p.height) / 2) { scaleX = e; scaleY = e }
    }
}

/** Blind test : l'égaliseur de 4 barres (rose, cyan, jaune, vert) à gauche du mot. */
@Composable
private fun Egaliseur(boucle: InfiniteTransition, u: Float) {
    val barres = listOf(Triple(RoseAppel, 800, 0), Triple(CyanAppel, 900, 300), Triple(JauneAppel, 1100, 500), Triple(VertAppel, 700, 200))
    Row(Modifier.height((34 * u).dp).padding(bottom = (4 * u).dp), horizontalArrangement = Arrangement.spacedBy((4 * u).dp), verticalAlignment = Alignment.Bottom) {
        barres.forEachIndexed { i, (c, d, decalage) ->
            val h by boucle.animateFloat(
                0.25f, 1f, infiniteRepeatable(tween(d / 2, easing = FastOutSlowInEasing), RepeatMode.Reverse, StartOffset(decalage)), label = "eq$i",
            )
            Box(
                Modifier.width((7 * u).dp).height((30 * u).dp)
                    .graphicsLayer { scaleY = h; transformOrigin = TransformOrigin(0.5f, 1f) }
                    .background(c, RoundedCornerShape((2 * u).dp)),
            )
        }
    }
}

/** Les petits décors de chaque plaque, posés par rapport à elle (ils peuvent déborder). */
@Composable
private fun BoxScope.DecorPlaque(genre: GenrePlaque, boucle: InfiniteTransition, u: Float) {
    val muet = Modifier.clearAndSetSemantics {}
    when (genre) {
        GenrePlaque.FLOUE -> {
            val a by boucle.animateFloat(-16f, -8f, infiniteRepeatable(tween(1200, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "lunettes")
            Canvas(
                muet.align(Alignment.TopEnd).offset(x = (58 * u).dp, y = (-44 * u).dp).size((132 * u).dp, (56 * u).dp)
                    .graphicsLayer { rotationZ = a; transformOrigin = TransformOrigin(0.5f, 0.6f) },
            ) { lunettes() }
        }
        GenrePlaque.CHANTE -> {
            val n by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(600, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "note")
            Canvas(
                muet.align(Alignment.TopStart).offset(x = (-62 * u).dp, y = (-38 * u).dp).size((77 * u).dp, (96 * u).dp)
                    .graphicsLayer {
                        rotationZ = -14f + 10f * n; translationY = -12f * u * density * n; scaleX = 1f + 0.06f * n; scaleY = 1f + 0.06f * n
                        transformOrigin = TransformOrigin(0.5f, 1f)
                    },
            ) { noteDouble(CyanAppel) }
            listOf(Triple(JauneAppel, 34f, 0), Triple(RoseChante, 26f, 1300)).forEachIndexed { i, (c, h, decalage) ->
                val t by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(2600, easing = LinearEasing), initialStartOffset = StartOffset(decalage)), label = "envol$i")
                Canvas(
                    muet.align(Alignment.TopEnd).offset(x = ((if (i == 0) 6 else -30) * u).dp, y = ((if (i == 0) -10 else -6) * u).dp)
                        .size((h * 0.8f * u).dp, (h * u).dp)
                        .graphicsLayer {
                            alpha = if (t < 0.15f) t / 0.15f else 1f - (t - 0.15f) / 0.85f
                            translationX = 40f * u * density * t; translationY = -70f * u * density * t; rotationZ = 20f * t
                        },
                ) { noteDouble(c) }
            }
        }
        GenrePlaque.DISPARU -> {
            val t by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(1500, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "loupe")
            Canvas(
                muet.align(Alignment.TopEnd).offset(x = (46 * u).dp, y = (-52 * u).dp).size((86 * u).dp)
                    .graphicsLayer { translationX = -26f * u * density * t; translationY = 8f * u * density * t; rotationZ = -10f + 16f * t },
            ) { loupe() }
        }
        GenrePlaque.QUISUIS -> {
            val t by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(900, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "qm")
            Text(
                "?", modifier = muet.align(Alignment.TopEnd).offset(x = (22 * u).dp, y = (-30 * u).dp)
                    .graphicsLayer { rotationZ = 14f - 10f * t; scaleX = 1f + 0.12f * t; scaleY = 1f + 0.12f * t },
                style = TextStyle(
                    fontFamily = PoliceGsTitre, color = CyanAppel, fontSize = with(LocalDensity.current) { (56 * u).dp.toSp() },
                    shadow = Shadow(CyanAppel, Offset.Zero, with(LocalDensity.current) { (12 * u).dp.toPx() }),
                ),
            )
        }
        GenrePlaque.GONFLEUR -> {
            val appui by boucle.animateFloat(0f, 0f, infiniteRepeatable(keyframes { durationMillis = 700; 0f at 0; 1f at 294; 1f at 385; 0f at 700 }), label = "appui")
            val ballon by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(2800, easing = LinearEasing)), label = "ballon")
            // Le bouton doré, l'onde jaune, puis la main qui appuie dessus.
            Canvas(muet.align(Alignment.TopStart).offset(x = (26 * u).dp, y = (44 * u).dp).size((72 * u).dp, (40 * u).dp)) {
                val o = appui
                if (o > 0.6f) drawOval(JauneAppel.copy(alpha = (1f - o) * 2f + 0.2f), Offset(size.width * 0.05f, 0f), Size(size.width * 0.9f, size.height), style = Stroke(3f * u * density))
            }
            Box(
                muet.align(Alignment.TopStart).offset(x = (26 * u).dp, y = (50 * u).dp).size((72 * u).dp, (22 * u).dp)
                    .graphicsLayer { scaleY = 1f - 0.45f * appui; transformOrigin = TransformOrigin(0.5f, 1f) }
                    .background(Brush.radialGradient(listOf(Color(0xFFFFF2A0), Color(0xFFFFD21A), Color(0xFFC47A00))), RoundedCornerShape(50, 50, 30, 30)),
            )
            Canvas(
                muet.align(Alignment.TopStart).offset(x = (30 * u).dp, y = (-26 * u).dp).size((66 * u).dp, (86 * u).dp)
                    .graphicsLayer { translationY = (-14f + 24f * appui) * u * density; rotationZ = -5f + 5f * appui },
            ) { main() }
            val e = when {
                ballon < 0.25f -> 0.55f + 0.6f * ballon
                ballon < 0.5f -> 0.7f + 0.6f * (ballon - 0.25f)
                ballon < 0.75f -> 0.85f + 0.8f * (ballon - 0.5f)
                ballon < 0.88f -> 1.05f + 0.77f * (ballon - 0.75f)
                else -> 0f
            }
            Canvas(
                muet.align(Alignment.TopEnd).offset(x = (-20 * u).dp, y = (4 * u).dp).size((46 * u).dp, (66 * u).dp)
                    .graphicsLayer { scaleX = e; scaleY = e; transformOrigin = TransformOrigin(0.5f, 1f) },
            ) { petitBallon() }
        }
        else -> Unit
    }
}

/** Échelle d'un dessin fait dans une boîte de [w] × [h] (viewBox de la planche). */
private inline fun DrawScope.dansBoite(w: Float, h: Float, bloc: DrawScope.(Float) -> Unit) {
    val e = minOf(size.width / w, size.height / h)
    bloc(e)
}

/** La note double de la planche (viewBox 64 × 80). */
internal fun DrawScope.noteDouble(c: Color) = dansBoite(64f, 80f) { e ->
    val p = Path().apply { moveTo(24 * e, 64 * e); lineTo(24 * e, 16 * e); lineTo(56 * e, 7 * e); lineTo(56 * e, 54 * e) }
    drawPath(p, c, style = Stroke(6 * e))
    drawOval(c, Offset(3 * e, 55 * e), Size(24 * e, 18 * e))
    drawOval(c, Offset(35 * e, 46 * e), Size(24 * e, 18 * e))
}

/** Lunettes néon (verres rose, branches cyan), viewBox 132 × 56. */
private fun DrawScope.lunettes() = dansBoite(132f, 56f) { e ->
    listOf(34f, 98f).forEach { cx ->
        drawCircle(Color.White.copy(alpha = 0.14f), 20 * e, Offset(cx * e, 30 * e))
        drawCircle(RoseAppel, 20 * e, Offset(cx * e, 30 * e), style = Stroke(5 * e))
    }
    val b = Stroke(5 * e, cap = StrokeCap.Round)
    drawPath(Path().apply { moveTo(54 * e, 28 * e); quadraticBezierTo(66 * e, 19 * e, 78 * e, 28 * e) }, CyanAppel, style = b)
    drawLine(CyanAppel, Offset(14 * e, 24 * e), Offset(2 * e, 14 * e), 5 * e, StrokeCap.Round)
    drawLine(CyanAppel, Offset(118 * e, 24 * e), Offset(130 * e, 14 * e), 5 * e, StrokeCap.Round)
}

/** La loupe dorée, viewBox 86 × 86. */
private fun DrawScope.loupe() = dansBoite(86f, 86f) { e ->
    drawCircle(OrDisparu.copy(alpha = 0.14f), 24 * e, Offset(34 * e, 34 * e))
    drawCircle(OrDisparu, 24 * e, Offset(34 * e, 34 * e), style = Stroke(6 * e))
    drawLine(OrDisparu, Offset(52 * e, 52 * e), Offset(76 * e, 76 * e), 10 * e, StrokeCap.Round)
    drawArc(Color.White, 200f, 70f, false, Offset(20 * e, 20 * e), Size(28 * e, 28 * e), style = Stroke(3 * e, cap = StrokeCap.Round))
}

/** La main à plat vue de dessus (doigts et paume), viewBox 72 × 94. */
private fun DrawScope.main() = dansBoite(72f, 94f) { e ->
    val fond = Color(0xFF2C0D48)
    val trait = Stroke(3.5f * e)
    fun doigt(x: Float, y: Float, w: Float, h: Float) {
        drawRoundRect(fond, Offset(x * e, y * e), Size(w * e, h * e), CornerRadius(w / 2 * e))
        drawRoundRect(Color.White, Offset(x * e, y * e), Size(w * e, h * e), CornerRadius(w / 2 * e), style = trait)
    }
    doigt(17f, 10f, 11f, 42f); doigt(29f, 4f, 11f, 46f); doigt(41f, 7f, 11f, 44f); doigt(53f, 16f, 10f, 36f)
    rotate(-28f, Offset(8 * e, 55 * e)) { doigt(2f, 40f, 11f, 30f) }
    drawRoundRect(fond, Offset(14 * e, 38 * e), Size(50 * e, 46 * e), CornerRadius(14 * e))
    drawRoundRect(Color.White, Offset(14 * e, 38 * e), Size(50 * e, 46 * e), CornerRadius(14 * e), style = trait)
}

/** Le petit ballon rose qui gonfle puis éclate, viewBox 46 × 66. */
private fun DrawScope.petitBallon() = dansBoite(46f, 66f) { e ->
    drawOval(RoseAppel, Offset(4 * e, 2 * e), Size(38 * e, 44 * e))
    drawOval(Color.White, Offset(4 * e, 2 * e), Size(38 * e, 44 * e), style = Stroke(2.5f * e))
    drawPath(Path().apply { moveTo(19 * e, 46 * e); lineTo(27 * e, 46 * e); lineTo(23 * e, 51 * e); close() }, RoseAppel)
    drawPath(Path().apply { moveTo(23 * e, 51 * e); quadraticBezierTo(17 * e, 58 * e, 23 * e, 65 * e) }, Color.White, style = Stroke(2 * e))
    drawOval(Color.White.copy(alpha = 0.55f), Offset(11 * e, 8 * e), Size(10 * e, 14 * e))
}

/**
 * Qui a disparu, on mémorise : l'œil réaliste au-dessus de la plaque (blanc dégradé, iris cyan, pupille, reflet, cils
 * dorés) ; la pupille va de gauche à droite en 3,4 s et l'œil cligne à 92 % du cycle.
 */
@Composable
fun OeilMemorise(modifier: Modifier = Modifier, k: Float = 1f) {
    val u = 0.75f * k
    val boucle = rememberInfiniteTransition(label = "oeil")
    val cycle by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(3400, easing = LinearEasing)), label = "cycle")
    val regard = when {
        cycle < 0.3f -> -1f
        cycle < 0.5f -> -1f + 2f * (cycle - 0.3f) / 0.2f
        cycle < 0.8f -> 1f
        else -> 1f - 2f * (cycle - 0.8f) / 0.2f
    }
    val ouvert = when {
        cycle < 0.88f -> 1f
        cycle < 0.92f -> 1f - 0.92f * (cycle - 0.88f) / 0.04f
        cycle < 0.96f -> 0.08f + 0.92f * (cycle - 0.92f) / 0.04f
        else -> 1f
    }
    Canvas(modifier.clearAndSetSemantics {}.size((140 * u).dp, (84 * u).dp).graphicsLayer { scaleY = ouvert }) {
        dansBoite(140f, 84f) { e ->
            val amande = Path().apply {
                moveTo(8 * e, 46 * e); quadraticBezierTo(70 * e, -4 * e, 132 * e, 46 * e); quadraticBezierTo(70 * e, 92 * e, 8 * e, 46 * e); close()
            }
            drawPath(amande, Brush.radialGradient(listOf(Color.White, Color(0xFFE6E9F2), Color(0xFFAAB1C4)), Offset(70 * e, 38 * e), 60 * e))
            clipPath(amande) {
                translate(left = 5 * e * regard) {
                    val c = Offset(70 * e, 46 * e)
                    drawCircle(Brush.radialGradient(listOf(Color(0xFF0B2D3A), Color(0xFF1AA9C9), CyanAppel, Color(0xFF0C5F74)), c, 23 * e), 23 * e, c)
                    drawCircle(Color(0xFF05080F), 10 * e, c)
                    drawCircle(Color.White, 5 * e, Offset(77 * e, 38 * e))
                    drawCircle(Color.White.copy(alpha = 0.7f), 2 * e, Offset(63 * e, 53 * e))
                }
                drawPath(Path().apply { moveTo(0f, 0f); lineTo(140 * e, 0f); lineTo(140 * e, 30 * e); quadraticBezierTo(70 * e, 4 * e, 0f, 30 * e); close() }, Color(0x590D1430))
            }
            drawPath(Path().apply { moveTo(8 * e, 46 * e); quadraticBezierTo(70 * e, -4 * e, 132 * e, 46 * e) }, OrDisparu, style = Stroke(5 * e, cap = StrokeCap.Round))
            drawPath(Path().apply { moveTo(8 * e, 46 * e); quadraticBezierTo(70 * e, 92 * e, 132 * e, 46 * e) }, OrDisparu.copy(alpha = 0.8f), style = Stroke(3 * e, cap = StrokeCap.Round))
            listOf(26f to 30f, 44f to 21f, 62f to 16f, 80f to 16f, 98f to 21f, 115f to 30f).zip(
                listOf(-8f to -10f, -4f to -12f, -1f to -12f, 2f to -12f, 5f to -11f, 9f to -9f),
            ).forEach { (a, d) ->
                drawLine(OrDisparu, Offset(a.first * e, a.second * e), Offset((a.first + d.first) * e, (a.second + d.second) * e), 3.5f * e, StrokeCap.Round)
            }
        }
    }
}

/**
 * « BLIND TEST » de la présentation : Bungee en dégradé cyan → rose avec sa lueur, et la note double jaune qui flirte
 * avec le coin haut du dernier T (ancrée au bout du titre, jamais dans la lettre), flotte ±10 px et ±7° en 1,6 s.
 * [taille] : hauteur des lettres en dp.
 */
@Composable
fun TitreBlindTest(taille: Dp, modifier: Modifier = Modifier) {
    val boucle = rememberInfiniteTransition(label = "titre-bt")
    val t by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(800, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "note")
    val densite = LocalDensity.current
    val note = taille * (80f / 76f)
    // La note compte dans la largeur (elle dépasse à droite du T) : trop large pour sa place, tout rapetisse, jamais coupé.
    Box(modifier.ajusteSaPlace().padding(end = note * 0.8f)) {
        Text(
            "BLIND TEST", maxLines = 1, softWrap = false,
            style = TextStyle(
                fontFamily = PoliceGsTitre, fontSize = with(densite) { taille.toSp() }, letterSpacing = with(densite) { (taille * 0.04f).toSp() },
                brush = Brush.horizontalGradient(listOf(CyanAppel, RoseAppel)),
                shadow = Shadow(CyanAppel.copy(alpha = 0.67f), Offset.Zero, with(densite) { (taille * 0.12f).toPx() }),
            ),
        )
        // La tête gauche de la note se pose sur le coin haut droit du dernier T (planche : left 100 %, bottom 62 %).
        Canvas(
            Modifier.clearAndSetSemantics {}.align(Alignment.TopEnd)
                // Recalée sur la capture du 31/10 : l'espacement des lettres laisse un blanc après le T, et le haut du T est
                // plus bas que le haut de la ligne.
                .offset(x = note * 0.8f - taille * 0.10f, y = -note * 0.78f + taille * 0.15f)
                .size(note * 0.8f, note)
                .graphicsLayer {
                    translationY = -10f / 76f * taille.toPx() * t
                    rotationZ = -8f + 14f * t
                    transformOrigin = TransformOrigin(0.15f, 0.8f)
                },
        ) { noteDouble(JauneAppel) }
    }
}
