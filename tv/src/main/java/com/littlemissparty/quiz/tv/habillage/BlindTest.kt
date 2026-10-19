package com.littlemissparty.quiz.tv.habillage

import android.os.SystemClock
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.sin
import kotlinx.coroutines.delay

/**
 * Blind test : à gauche un vinyle qui tourne sous un bras de platine, entouré d'ondes et d'un halo qui battent
 * au tempo ; à droite un égaliseur et une légende. Au buzz, le disque freine et s'arrête, le bras se relève,
 * l'égaliseur retombe ; à la révélation, l'étiquette passe à l'or, « ? » devient « ♫ » et le disque repart.
 *
 * Léger pour la Mi Box : le disque est dessiné une fois (sillons en cache) et seule sa rotation change ; ondes et
 * halo ne changent que d'échelle et d'opacité (graphicsLayer) ; l'égaliseur est un petit Canvas redessiné une
 * vingtaine de fois par seconde.
 *
 * @param joue l'extrait s'entend (question sans buzz en attente, ou révélation)
 * @param manquant l'extrait n'a pas pu être chargé : la légende le dit, l'animatrice peut passer
 * @param artiste affiché sous « Écoutez la suite ! » à la révélation
 */
@Composable
fun BlindTestBoard(joue: Boolean, revele: Boolean, manquant: Boolean, artiste: String?, modifier: Modifier = Modifier) {
    // Tours par seconde : 33 tours/min ≈ 0,55 ; le disque s'arrête net au buzz et repart en 0,4 s.
    val vitesse by animateFloatAsState(if (joue) 0.55f else 0f, tween(if (joue) 400 else 200), label = "vinyle")
    val angle = remember { mutableFloatStateOf(0f) }
    val battement = remember { mutableFloatStateOf(0f) }
    val temps = remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) {
        var avant = SystemClock.elapsedRealtime()
        while (true) {
            val maintenant = SystemClock.elapsedRealtime()
            angle.floatValue = (angle.floatValue + 360f * vitesse * (maintenant - avant) / 1000f) % 360f
            avant = maintenant
            val ms = maintenant - Sons.departDesLits
            battement.floatValue = exp(-(Math.floorMod(ms, Tempo.TEMPS).toFloat() / Tempo.TEMPS) * 4f)
            temps.floatValue = ms / 1000f
            delay(50)
        }
    }
    val niveau by animateFloatAsState(if (joue) 1f else 0.08f, tween(350), label = "egaliseur")
    val vie by animateFloatAsState(if (joue) 1f else 0f, tween(400), label = "ondes")
    val or by animateFloatAsState(if (revele) 1f else 0f, tween(600), label = "etiquette")
    Box(Modifier.then(modifier).clip(RoundedCornerShape(28.dp)).background(Color.White.copy(alpha = 0.07f))) {
        Text(
            "BLIND TEST",
            color = Neon.Nuit, fontSize = 18.sp, fontWeight = FontWeight.Black,
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 12.dp)
                .clip(RoundedCornerShape(50)).background(Neon.Or).padding(horizontal = 14.dp, vertical = 4.dp),
        )
        Row(Modifier.fillMaxSize().padding(start = 24.dp, end = 24.dp, top = 48.dp, bottom = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.fillMaxHeight().aspectRatio(1f, matchHeightConstraintsFirst = true), contentAlignment = Alignment.Center) {
                // Halo qui bat au tempo, rose pendant l'écoute, doré à la révélation.
                Box(
                    Modifier.fillMaxSize()
                        .graphicsLayer { alpha = 0.35f + 0.45f * vie * battement.floatValue + 0.3f * or; scaleX = 1.12f; scaleY = 1.12f }
                        .background(Brush.radialGradient(listOf(lerp(Neon.Halo, Neon.Or, or).copy(alpha = 0.45f), Color.Transparent))),
                )
                // Trois ondes qui partent du disque et s'effacent, décalées d'un tiers de cycle.
                for (k in 0 until 3) {
                    Box(
                        Modifier.fillMaxSize(0.9f).graphicsLayer {
                            val phase = ((temps.floatValue / 2.2f) + k / 3f) % 1f
                            val e = 0.86f + 0.3f * phase
                            scaleX = e; scaleY = e
                            alpha = vie * 0.55f * (1f - phase)
                        }.border(3.dp, Neon.Halo, CircleShape),
                    )
                }
                Vinyle(or, Modifier.fillMaxSize(0.9f).graphicsLayer { rotationZ = angle.floatValue })
                Text(
                    if (revele) "♫" else "?",
                    color = Neon.Nuit, fontSize = 64.sp, lineHeight = 64.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                )
                BrasDePlatine(joue, Modifier.fillMaxSize(0.9f))
            }
            Spacer(Modifier.width(24.dp))
            Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.Center) {
                Egaliseur(niveau, battement, temps, or, Modifier.fillMaxWidth().height(150.dp))
                Spacer(Modifier.height(16.dp))
                Text(
                    when {
                        manquant && !revele -> "Extrait indisponible : l'animatrice peut passer."
                        revele -> "Écoutez la suite !"
                        joue -> "Écoutez bien…"
                        else -> "Musique en pause"
                    },
                    color = if (revele) Neon.Or else Neon.Blanc, fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.Black,
                )
                if (revele && artiste != null) {
                    Spacer(Modifier.height(6.dp))
                    Text(artiste, color = Neon.Blanc.copy(alpha = 0.8f), fontSize = 24.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

/** Le disque : vinyle noir à sillons, reflet, étiquette rose qui passe à l'or à la révélation. */
@Composable
internal fun Vinyle(or: Float, modifier: Modifier) {
    Box(
        modifier.drawWithCache {
            val c = Offset(size.width / 2, size.height / 2)
            val r = size.minDimension / 2 * 0.92f
            val sillons = (0 until 26).map { r * (0.42f + 0.56f * it / 25f) }
            val reflet = Brush.sweepGradient(
                listOf(Color.Transparent, Color.White.copy(alpha = 0.10f), Color.Transparent, Color.Transparent, Color.White.copy(alpha = 0.08f), Color.Transparent),
                c,
            )
            onDrawBehind {
                drawCircle(Color(0xFF0E0A12), r, c)
                sillons.forEach { drawCircle(Color.White.copy(alpha = 0.05f), it, c, style = Stroke(1.2f)) }
                drawCircle(reflet, r, c)
                val etiquette = lerp(Neon.Halo, Neon.Or, or)
                drawCircle(etiquette, r * 0.36f, c)
                drawCircle(Neon.Nuit.copy(alpha = 0.35f), r * 0.36f, c, style = Stroke(3f))
                // Un motif sur l'étiquette, pour qu'on voie le disque tourner.
                drawArc(Neon.Nuit.copy(alpha = 0.45f), -20f, 40f, false, Offset(c.x - r * 0.26f, c.y - r * 0.26f), Size(r * 0.52f, r * 0.52f), style = Stroke(r * 0.05f))
                drawCircle(Color(0xFF0E0A12), r * 0.035f, c)
            }
        },
    )
}

/** Le bras : posé sur le disque quand l'extrait joue, relevé sur le côté sinon. */
@Composable
private fun BrasDePlatine(pose: Boolean, modifier: Modifier) {
    val inclinaison by animateFloatAsState(if (pose) 0f else -14f, tween(450), label = "bras")
    Canvas(modifier) {
        val pivot = Offset(size.width * 0.93f, size.height * 0.08f)
        rotate(inclinaison, pivot) {
            val coude = Offset(size.width * 0.86f, size.height * 0.55f)
            val tete = Offset(size.width * 0.66f, size.height * 0.72f)
            drawLine(Neon.OrClair, pivot, coude, 7f)
            drawLine(Neon.OrClair, coude, tete, 7f)
            drawRoundRect(Neon.OrProfond, Offset(tete.x - 14f, tete.y - 10f), Size(30f, 20f), CornerRadius(5f))
        }
        drawCircle(Neon.OrProfond, 18f, pivot)
        drawCircle(Neon.Nuit, 7f, pivot)
    }
}

/** Seize barres or et rose (tout or à la révélation) qui rebondissent au tempo ; elles retombent quand la musique s'arrête. */
@Composable
private fun Egaliseur(niveau: Float, battement: androidx.compose.runtime.FloatState, temps: androidx.compose.runtime.FloatState, or: Float, modifier: Modifier) {
    val barres = 16
    Canvas(modifier) {
        val b = battement.floatValue
        val t = temps.floatValue
        val l = size.width / (barres * 1.6f)
        for (k in 0 until barres) {
            // Hauteur : battement du tempo + deux ondes lentes décalées par barre, pour un mouvement vivant.
            val vague = 0.35f + 0.25f * sin(t * 3.1f + k * 0.7f) + 0.2f * sin(t * 5.3f + k * 1.9f)
            val h = size.height * niveau * (0.15f + 0.85f * (0.5f * b + 0.5f * abs(vague)).coerceIn(0f, 1f))
            val x = k * l * 1.6f + l * 0.3f
            val couleur = if (k % 2 == 0) Neon.Or else lerp(Neon.Halo, Neon.Or, or)
            drawRoundRect(couleur, Offset(x, size.height - h), Size(l, h.coerceAtLeast(4f)), CornerRadius(l / 2))
        }
    }
}

