package com.littlemissparty.quiz.tv.habillage

import android.os.SystemClock
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.sin

/**
 * Blind test : un vinyle qui tourne sous un bras de platine, et un égaliseur qui danse au tempo pendant que
 * l'extrait joue. Au buzz, le disque freine et s'arrête, l'égaliseur retombe et « STOP ! » prend la couleur de
 * l'équipe ; à la révélation, le disque repart et l'étiquette s'illumine d'or.
 *
 * Léger pour la Mi Box : le disque est dessiné une fois (sillons en cache) et seule sa rotation change ;
 * l'égaliseur est un seul Canvas redessiné une vingtaine de fois par seconde.
 *
 * @param joue l'extrait s'entend (question sans buzz en attente, ou révélation)
 * @param buzzeur nom et couleur de l'équipe qui a buzzé, null sinon (le nom reste affiché par le panneau du buzzer)
 */
@Composable
fun BlindTestBoard(joue: Boolean, revele: Boolean, buzzeur: Pair<String, Color>?, modifier: Modifier = Modifier) {
    // Tours par seconde : 33 tours/min ≈ 0,55 ; le disque freine en 0,6 s au buzz et repart en 0,4 s.
    val vitesse by animateFloatAsState(if (joue) 0.55f else 0f, tween(if (joue) 400 else 600), label = "vinyle")
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
    val or by animateFloatAsState(if (revele) 1f else 0f, tween(600), label = "etiquette")
    Box(
        modifier.clip(RoundedCornerShape(28.dp)).background(Color.White.copy(alpha = 0.08f)),
        contentAlignment = Alignment.Center,
    ) {
        Column(Modifier.fillMaxSize().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                "BLIND TEST",
                color = Neon.Nuit, fontSize = 18.sp, fontWeight = FontWeight.Black,
                modifier = Modifier.clip(RoundedCornerShape(50)).background(Neon.Or).padding(horizontal = 14.dp, vertical = 4.dp),
            )
            Spacer(Modifier.height(10.dp))
            Box(Modifier.weight(1f).aspectRatio(1f), contentAlignment = Alignment.Center) {
                Vinyle(or, Modifier.fillMaxSize().graphicsLayer { rotationZ = angle.floatValue })
                BrasDePlatine(joue, Modifier.fillMaxSize())
            }
            Spacer(Modifier.height(12.dp))
            Egaliseur(niveau, battement, temps, Modifier.fillMaxWidth().height(64.dp))
            Spacer(Modifier.height(8.dp))
            Text(
                when {
                    revele -> "Écoutez la suite !"
                    buzzeur != null -> "STOP !"
                    else -> "Écoutez bien…"
                },
                color = buzzeur?.second?.takeIf { !revele } ?: Neon.Blanc,
                fontSize = 28.sp, fontWeight = FontWeight.Black,
            )
        }
    }
}

/** Le disque : vinyle noir à sillons, reflet, étiquette rose qui passe à l'or à la révélation. */
@Composable
private fun Vinyle(or: Float, modifier: Modifier) {
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
                val etiquette = androidx.compose.ui.graphics.lerp(Neon.Halo, Neon.Or, or)
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

/** Seize barres or et rose qui rebondissent au tempo ; elles retombent quand la musique s'arrête. */
@Composable
private fun Egaliseur(niveau: Float, battement: androidx.compose.runtime.FloatState, temps: androidx.compose.runtime.FloatState, modifier: Modifier) {
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
            val couleur = if (k % 2 == 0) Neon.Or else Neon.Halo
            drawRoundRect(couleur, Offset(x, size.height - h), Size(l, h.coerceAtLeast(4f)), CornerRadius(l / 2))
        }
    }
}

