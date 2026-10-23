package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.withInfiniteAnimationFrameMillis
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
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
 * Scène « The Game Show » (kit du 22 octobre) : noir lumière noire, grand halo violet, néons cyan et rose sur les
 * côtés, sol quadrillé qui fuit vers un horizon cyan, poussières fluo qui montent doucement et deux faisceaux laser
 * qui balaient lentement. Même règle que le plateau classique pour la petite box : fond, sol et poussières sont
 * dessinés une fois ; à chaque image seuls l'angle des faisceaux, le glissement des poussières et l'éclat de
 * l'horizon changent (calques déplacés, rien n'est redessiné). Fin du chrono : les bords chauffent en rose ;
 * [dore] : dernières questions à points multipliés, paillettes jaune néon. [accueil] : l'écran d'accueil, où le robot
 * dort sur le plateau ([VideoAccueil]) ; [sansVideo] : la grande intro du lancement passe par-dessus.
 */
private const val BALAYAGE_GS_MS = 9_000L
private const val MONTEE_MS = 26_000L

@Composable
fun DecorGameShow(chaud: Boolean, dore: Boolean = false, accueil: Boolean = false, sansVideo: Boolean = false) {
    val temps = remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) {
        val debut = withInfiniteAnimationFrameMillis { it }
        while (true) withInfiniteAnimationFrameMillis { temps.longValue = it - debut }
    }
    val chaleur by animateFloatAsState(if (chaud) 1f else 0f, tween(600), label = "chaleur")
    val paillettes by animateFloatAsState(if (dore) 1f else 0f, tween(1_200), label = "paillettes")
    // Une seule vidéo à la fois (la box n'en décode qu'une) : à l'accueil, le robot qui dort ; ailleurs, le fond 3D du
    // menu Retour ; aucune pendant la grande intro du lancement. Elle remplace le décor dessiné dès sa première image ;
    // si elle échoue, le décor reste.
    val video = when {
        sansVideo -> 0
        accueil -> 1
        Look.fond3d -> 2
        else -> 0
    }
    var videoPrete by remember(video) { mutableStateOf(false) }
    Box(Modifier.fillMaxSize()) {
        key(video) {
            when (video) {
                1 -> VideoAccueil(surPret = { videoPrete = true }, surEchec = { videoPrete = false })
                2 -> FondVideo3d(surPret = { videoPrete = true }, surEchec = { videoPrete = false })
                else -> {}
            }
        }
        if (!videoPrete) DecorDessine(temps::longValue, paillettes)
        if (paillettes > 0.01f) {
            Box(
                Modifier.fillMaxSize()
                    .graphicsLayer { alpha = paillettes * (0.7f + 0.3f * sin(2f * PI.toFloat() * temps.longValue / 1_800f)) }
                    .drawWithCache {
                        onDrawBehind {
                            positionsPaillettes.forEachIndexed { k, o ->
                                drawCircle(GS.Jaune.copy(alpha = 0.45f + 0.2f * (k % 3)), size.minDimension * (0.003f + 0.0015f * (k % 2)), Offset(o.x * size.width, o.y * size.height))
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
                            0.68f to Color.Transparent,
                            1f to GS.Rose.copy(alpha = 0.32f),
                            center = Offset(size.width / 2, size.height / 2), radius = size.width * 0.62f,
                        )
                        onDrawBehind { drawRect(bords) }
                    },
            )
        }
    }
}

/** Le décor dessiné : fond, halos, sol, horizon qui respire, poussières et lasers (sans le fond 3D). */
@Composable
private fun DecorDessine(temps: () -> Long, paillettes: Float) {
    Box(Modifier.fillMaxSize()) {
        // Fond, halos et sol : fixes, dessinés une fois.
        Box(
            Modifier.fillMaxSize().drawWithCache {
                val w = size.width
                val h = size.height
                val fond = Brush.verticalGradient(listOf(Color(0xFF0B0320), GS.Noir, Color(0xFF07021A)))
                val halos = listOf(
                    Triple(GS.Violet.copy(alpha = 0.42f), Offset(w * 0.5f, -h * 0.1f), w * 0.55f),
                    Triple(GS.Cyan.copy(alpha = 0.16f), Offset(-w * 0.02f, h * 0.35f), w * 0.3f),
                    Triple(GS.Rose.copy(alpha = 0.14f), Offset(w * 1.02f, h * 0.3f), w * 0.3f),
                    Triple(GS.Violet.copy(alpha = 0.3f), Offset(w * 0.5f, HORIZON * h), w * 0.42f),
                ).map { (c, o, r) -> Triple(Brush.radialGradient(listOf(c, Color.Transparent), o, r), o, r) }
                val lignes = solGameShow(w, h)
                onDrawBehind {
                    drawRect(fond)
                    halos.forEach { (b, o, r) -> drawCircle(b, r, o) }
                    lignes.forEach { (b, de, a, e) -> drawLine(b, de, a, e) }
                }
            },
        )
        // L'horizon respire lentement (7 s), sans clignoter.
        Box(
            Modifier.fillMaxSize()
                .graphicsLayer { alpha = 0.55f + 0.45f * (0.5f + 0.5f * sin(2f * PI.toFloat() * temps() / 7_000f)) }
                .drawWithCache {
                    val y = HORIZON * size.height
                    val lueur = Brush.verticalGradient(listOf(Color.Transparent, GS.Cyan.copy(alpha = 0.22f), Color.Transparent), y - size.height * 0.05f, y + size.height * 0.05f)
                    val trait = Brush.horizontalGradient(listOf(Color.Transparent, GS.Cyan, GS.CyanClair, GS.Cyan, Color.Transparent))
                    onDrawBehind {
                        drawRect(lueur, Offset(0f, y - size.height * 0.05f), androidx.compose.ui.geometry.Size(size.width, size.height * 0.1f))
                        drawLine(trait, Offset(0f, y), Offset(size.width, y), 2.5f)
                    }
                },
        )
        // Poussières fluo : deux copies du même semis glissent vers le haut, l'une prenant le relais de l'autre.
        for (copie in 0..1) {
            Box(
                Modifier.fillMaxSize()
                    .graphicsLayer {
                        val u = (temps() % MONTEE_MS) / MONTEE_MS.toFloat()
                        translationY = (copie - u) * size.height
                    }
                    .drawWithCache {
                        val m = size.minDimension
                        onDrawBehind {
                            poussieres.forEach { p ->
                                val o = Offset(p.x * size.width, p.y * size.height)
                                drawCircle(Brush.radialGradient(listOf(p.couleur.copy(alpha = 0.5f), Color.Transparent), o, p.rayon * m * 4f), p.rayon * m * 4f, o)
                                drawCircle(p.couleur, p.rayon * m, o)
                            }
                        }
                    },
            )
        }
        // Deux lasers, cyan et rose, qui partent du sol et balaient en miroir.
        val angle = { 12f * sin(2f * PI.toFloat() * temps() / BALAYAGE_GS_MS) }
        listOf(Triple(0.16f, 18f, GS.Cyan), Triple(0.84f, -18f, GS.Rose)).forEachIndexed { k, (x, degres, couleur) ->
            Box(
                Modifier.fillMaxSize()
                    .graphicsLayer {
                        transformOrigin = TransformOrigin(x, 1f)
                        rotationZ = if (k == 0) angle() else -angle()
                        alpha = 0.75f + 0.25f * paillettes
                    }
                    .drawWithCache {
                        val (chemin, lumiere) = laser(size.width, size.height, x, degres, couleur)
                        onDrawBehind { drawPath(chemin, lumiere) }
                    },
            )
        }
    }
}

/** Hauteur de l'horizon (fraction de l'écran) : le sol quadrillé occupe le bas de la scène. */
private const val HORIZON = 0.64f

/** Une ligne du sol : pinceau, départ, arrivée, épaisseur. */
private data class Trait(val pinceau: Brush, val de: Offset, val a: Offset, val epaisseur: Float)

/** Sol quadrillé : rayons qui fuient vers le point de fuite, traverses de plus en plus serrées vers l'horizon. */
private fun solGameShow(w: Float, h: Float): List<Trait> {
    val haut = HORIZON * h
    val fuite = Offset(w / 2, haut - h * 0.18f)
    val rayon = Brush.verticalGradient(listOf(GS.Violet.copy(alpha = 0.05f), GS.Violet.copy(alpha = 0.55f), GS.Cyan.copy(alpha = 0.5f)), haut, h)
    val rayons = (-14..14).map { k ->
        val xBas = w / 2 + k * w * 0.075f
        val xHaut = fuite.x + (xBas - fuite.x) * ((haut - fuite.y) / (h - fuite.y))
        Trait(rayon, Offset(xHaut, haut), Offset(xBas, h), 1.6f)
    }
    val traverses = (1..9).map { k ->
        val u = k / 10f
        val y = haut + (h - haut) * u * u
        Trait(SolidColor(lerpCouleur(GS.Violet, GS.Cyan, u).copy(alpha = 0.15f + 0.4f * u)), Offset(0f, y), Offset(w, y), 1.2f + 1.2f * u)
    }
    return rayons + traverses
}

private fun lerpCouleur(a: Color, b: Color, t: Float) = Color(a.red + (b.red - a.red) * t, a.green + (b.green - a.green) * t, a.blue + (b.blue - a.blue) * t, 1f)

/** Faisceau laser partant du bas de l'écran (en x, fraction de la largeur), incliné de [degres]. */
private fun laser(w: Float, h: Float, x: Float, degres: Float, couleur: Color): Pair<Path, Brush> {
    val pied = Offset(w * x, h)
    val l = h * 1.25f
    val demi = w * 0.035f
    val a = Math.toRadians(degres.toDouble())
    val dx = (sin(a) * l).toFloat()
    val dy = (cos(a) * l).toFloat()
    val chemin = Path().apply {
        moveTo(pied.x - demi * 0.2f, pied.y)
        lineTo(pied.x + dx - demi, pied.y - dy)
        lineTo(pied.x + dx + demi, pied.y - dy)
        lineTo(pied.x + demi * 0.2f, pied.y)
        close()
    }
    val lumiere = Brush.verticalGradient(listOf(Color.Transparent, couleur.copy(alpha = 0.16f), couleur.copy(alpha = 0.06f)), pied.y - dy, pied.y)
    return chemin to lumiere
}

private class Poussiere(val x: Float, val y: Float, val rayon: Float, val couleur: Color)

private val poussieres = List(46) { i ->
    Poussiere(
        x = (0.5f + i * 0.7548777f) % 1f,
        y = (0.5f + i * 0.5698403f) % 1f,
        rayon = 0.0012f + 0.0009f * (i % 3),
        couleur = listOf(GS.Cyan, GS.Violet, GS.Rose, GS.CyanClair)[i % 4],
    )
}

private val positionsPaillettes = List(26) { i -> Offset(((i * 0.437f + 0.05f) % 1f), 0.1f + ((i * 0.291f + 0.13f) % 0.8f)) }
