package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.withInfiniteAnimationFrameMillis
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * Le plateau (choix de cedric du 19 octobre : B + C, « doux, pas agressif ») : nuit violette, sol en perspective,
 * lumière fixe, deux projecteurs qui balaient lentement la scène de gauche à droite, et un ciel d'étoiles qui
 * s'allument et s'éteignent très doucement, chacune à son rythme. Rien ne clignote : un balayage dure
 * [BALAYAGE_MS], une étoile met 9 à 22 s à scintiller. Fond, faisceaux et étoiles sont dessinés une fois ; à chaque
 * image seuls l'angle des faisceaux (calque tourné) et l'éclat des étoiles changent, pour rester fluide sur une
 * petite box. Dans les 5 dernières secondes, les bords chauffent (orange) ; [dore] : dernières questions à points
 * multipliés, plateau doré et projecteurs plus vifs.
 */
private const val BALAYAGE_MS = 11_000L
private const val AMPLITUDE_DEGRES = 14f

@Composable
fun DecorPlateau(chaud: Boolean, dore: Boolean = false) {
    val temps = remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) {
        val debut = withInfiniteAnimationFrameMillis { it }
        while (true) withInfiniteAnimationFrameMillis { temps.longValue = it - debut }
    }
    val chaleur by animateFloatAsState(if (chaud) 1f else 0f, tween(600), label = "chaleur")
    val or by animateFloatAsState(if (dore) 1f else 0f, tween(1_200), label = "dore")
    val angle = { AMPLITUDE_DEGRES * sin(2f * PI.toFloat() * temps.longValue / BALAYAGE_MS) }
    Box(Modifier.fillMaxSize()) {
        // Fond, sol et halos : lumière fixe, ne se redessinent jamais.
        Box(
            Modifier.fillMaxSize().drawWithCache {
                val w = size.width
                val h = size.height
                val fond = Brush.radialGradient(listOf(Neon.FondHaut, Neon.Fond, Neon.FondBas), Offset(w / 2, 0f), w * 0.85f)
                val lignes = sol(w, h)
                val halos = listOf(
                    Triple(Neon.Halo.copy(alpha = 0.22f), Offset(w * 0.08f, h * 0.02f), w * 0.33f),
                    Triple(Neon.Violet.copy(alpha = 0.42f), Offset(w * 0.9f, h * 0.05f), w * 0.31f),
                    Triple(Neon.Or.copy(alpha = 0.2f), Offset(w * 0.5f, h * 1.08f), w * 0.4f),
                ).map { (c, o, r) -> Triple(Brush.radialGradient(listOf(c, Color.Transparent), o, r), o, r) }
                onDrawBehind {
                    drawRect(fond)
                    lignes.forEach { (b, de, a) -> drawLine(b, de, a, 1.5f) }
                    halos.forEach { (b, o, r) -> drawCircle(b, r, o) }
                }
            },
        )
        Etoiles(temps::longValue)
        // Les deux projecteurs balaient ensemble, pivotant sur leur pied ; plus vifs sur le plateau doré.
        listOf(0.18f to 16f, 0.82f to -16f).forEach { (x, degres) ->
            Box(
                Modifier.fillMaxSize()
                    .graphicsLayer {
                        transformOrigin = TransformOrigin(x, 1f)
                        rotationZ = angle()
                        alpha = 0.7f + 0.3f * or
                    }
                    .drawWithCache {
                        val (chemin, lumiere) = faisceau(size.width, size.height, x, degres)
                        onDrawBehind { drawPath(chemin, lumiere) }
                    },
            )
        }
        // Plateau doré : lumière d'or qui tombe d'en haut et monte du sol, et poussière d'or.
        if (or > 0.01f) {
            Box(
                Modifier.fillMaxSize()
                    .graphicsLayer { alpha = or }
                    .drawWithCache {
                        val w = size.width
                        val h = size.height
                        val haut = Brush.radialGradient(listOf(Neon.OrClair.copy(alpha = 0.28f), Color.Transparent), Offset(w / 2, -h * 0.1f), w * 0.6f)
                        val sol = Brush.radialGradient(listOf(Color(0xFFFFAA5A).copy(alpha = 0.30f), Color.Transparent), Offset(w / 2, h * 1.05f), w * 0.5f)
                        val voile = Brush.verticalGradient(listOf(Color(0x33FF9A4A), Color(0x14F0CC92), Color(0x33FF9A4A)))
                        onDrawBehind {
                            drawRect(voile)
                            drawRect(haut)
                            drawRect(sol)
                            positionsOr.forEachIndexed { k, o ->
                                drawCircle(Neon.OrClair.copy(alpha = 0.35f + 0.2f * (k % 3)), size.minDimension * (0.003f + 0.0015f * (k % 2)), Offset(o.x * w, o.y * h))
                            }
                        }
                    },
            )
        }
        if (chaleur > 0.01f) {
            Box(
                Modifier.fillMaxSize()
                    .graphicsLayer { alpha = chaleur }
                    .drawWithCache {
                        val bords = Brush.radialGradient(
                            0.55f to Color.Transparent,
                            1f to Neon.Chaud.copy(alpha = 0.5f),
                            center = Offset(size.width / 2, size.height / 2), radius = size.width * 0.62f,
                        )
                        onDrawBehind { drawRect(bords) }
                    },
            )
        }
    }
}

/** Une étoile du ciel : position (fractions de l'écran), taille, période de scintillement et décalage. */
private class Etoile(val x: Float, val y: Float, val rayon: Float, val periodeMs: Float, val phase: Float)

private val ciel = List(42) { i ->
    Etoile(
        // Suite R2 : étoiles bien réparties, sans paires collées.
        x = (0.5f + i * 0.7548777f) % 1f,
        y = 0.03f + 0.72f * ((0.5f + i * 0.5698403f) % 1f),
        rayon = 0.0018f + 0.0012f * (i % 3) + if (i % 7 == 0) 0.0016f else 0f,
        periodeMs = 9_000f + 13_000f * ((i * 0.53f) % 1f),
        phase = (i * 2.399f) % (2f * PI.toFloat()),
    )
}

/** Les étoiles : chacune passe très lentement de presque éteinte à douce, sans jamais flasher ; les plus grosses ont un petit halo. */
@Composable
private fun Etoiles(temps: () -> Long) {
    Box(
        Modifier.fillMaxSize().drawWithCache {
            val m = size.minDimension
            val halos = ciel.map { e -> Brush.radialGradient(listOf(Neon.Blanc.copy(alpha = 0.35f), Color.Transparent), Offset(e.x * size.width, e.y * size.height), e.rayon * m * 5f) }
            onDrawBehind {
                val t = temps().toFloat()
                ciel.forEachIndexed { i, e ->
                    val onde = 0.5f + 0.5f * sin(2f * PI.toFloat() * t / e.periodeMs + e.phase)
                    val eclat = 0.08f + 0.5f * onde * onde
                    val centre = Offset(e.x * size.width, e.y * size.height)
                    if (e.rayon > 0.003f) drawCircle(halos[i], e.rayon * m * 5f, centre, alpha = eclat)
                    drawCircle(Neon.Blanc, e.rayon * m, centre, alpha = eclat)
                }
            }
        },
    )
}

/** Lignes du sol : rayons qui fuient vers l'horizon et traverses de plus en plus serrées au loin. */
private fun sol(w: Float, h: Float): List<Triple<Brush, Offset, Offset>> {
    val haut = h * 0.8f
    val fuite = Offset(w / 2, h * 0.45f)
    val rayon = Brush.verticalGradient(listOf(Color.Transparent, Neon.Halo.copy(alpha = 0.32f)), haut, h)
    val rayons = (-10..10).map { k ->
        val xBas = w / 2 + k * w * 0.085f
        val xHaut = fuite.x + (xBas - fuite.x) * ((haut - fuite.y) / (h - fuite.y))
        Triple(rayon, Offset(xHaut, haut), Offset(xBas, h))
    }
    val traverses = (1..6).map { k ->
        val u = k / 7f
        val y = haut + (h - haut) * u * u
        Triple<Brush, Offset, Offset>(SolidColor(Neon.Halo.copy(alpha = 0.32f * u)), Offset(0f, y), Offset(w, y))
    }
    return rayons + traverses
}

/** Faisceau de projecteur partant du bas de l'écran (en x, fraction de la largeur), incliné de `degres`. */
private fun faisceau(w: Float, h: Float, x: Float, degres: Float): Pair<Path, Brush> {
    val pied = Offset(w * x, h)
    val l = h * 1.3f
    val demi = w * 0.06f
    val a = Math.toRadians(degres.toDouble())
    val dx = (sin(a) * l).toFloat()
    val dy = (cos(a) * l).toFloat()
    val chemin = Path().apply {
        moveTo(pied.x - demi * 0.25f, pied.y)
        lineTo(pied.x + dx - demi, pied.y - dy)
        lineTo(pied.x + dx + demi, pied.y - dy)
        lineTo(pied.x + demi * 0.25f, pied.y)
        close()
    }
    val lumiere = Brush.verticalGradient(listOf(Color.Transparent, Neon.Blanc.copy(alpha = 0.14f), Color.Transparent), pied.y - dy, pied.y)
    return chemin to lumiere
}

private val positionsOr = List(24) { i -> Offset(((i * 0.437f + 0.05f) % 1f), 0.15f + ((i * 0.291f + 0.13f) % 0.8f)) }
