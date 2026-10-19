package com.littlemissparty.quiz.tv.habillage

import android.os.SystemClock
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.R
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.sin
import kotlinx.coroutines.delay

/**
 * Blind test, pendant l'écoute : un vinyle qui tourne sous un bras de platine, sur un halo qui bat au tempo, et
 * un égaliseur dessous. Au buzz ou quand l'animatrice arrête la musique, le disque s'arrête, le bras se relève et
 * l'égaliseur retombe. Le panneau d'à côté (numéro du morceau, consignes) est dans l'écran du jeu.
 *
 * Léger pour la Mi Box : le disque est dessiné une fois (sillons en cache) et seule sa rotation change ; le halo
 * ne change que d'opacité (graphicsLayer) ; l'égaliseur est un petit Canvas redessiné une vingtaine de fois par seconde.
 *
 * @param joue l'extrait s'entend
 * @param manquant l'extrait n'a pas pu être chargé : la légende le dit, l'animatrice peut passer
 */
@Composable
fun BlindTestBoard(joue: Boolean, manquant: Boolean, modifier: Modifier = Modifier) {
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
    val vie by animateFloatAsState(if (joue) 1f else 0f, tween(400), label = "lumiere")
    // Le bras se pose quand l'extrait joue et se relève (vite) quand il s'arrête.
    val leve by animateFloatAsState(if (joue) 0f else 1f, tween(if (joue) 500 else 300, easing = FastOutSlowInEasing), label = "bras")
    Box(Modifier.then(modifier).clip(RoundedCornerShape(28.dp)).background(Color.White.copy(alpha = 0.07f))) {
        Text(
            "BLIND TEST",
            color = Neon.Nuit, fontSize = 18.sp, fontWeight = FontWeight.Black,
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 12.dp)
                .clip(RoundedCornerShape(50)).background(Neon.Or).padding(horizontal = 14.dp, vertical = 4.dp),
        )
        Column(
            Modifier.fillMaxSize().padding(start = 20.dp, end = 20.dp, top = 46.dp, bottom = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                // Lumière de scène derrière le disque : elle respire au tempo pendant l'écoute.
                Box(
                    Modifier.fillMaxHeight().aspectRatio(1f, matchHeightConstraintsFirst = true)
                        .graphicsLayer { alpha = 0.3f + 0.15f * vie * battement.floatValue; scaleX = 1.15f; scaleY = 1.15f }
                        .background(Brush.radialGradient(listOf(Neon.Halo.copy(alpha = 0.40f), Color.Transparent))),
                )
                Platine(angle = { angle.floatValue }, leve = leve, or = 0f, modifier = Modifier.fillMaxHeight())
            }
            Spacer(Modifier.height(10.dp))
            if (manquant) {
                Text(
                    "Extrait indisponible : l'animatrice peut passer.", color = Neon.Blanc, fontSize = 20.sp, lineHeight = 24.sp,
                    fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 2,
                )
            } else {
                Egaliseur(niveau, battement, temps, 0f, Modifier.fillMaxWidth(0.8f).height(50.dp))
            }
        }
    }
}

/**
 * Platine vue de dessus, en images réalistes calculées par tools/habillage/platine.py : le vinyle et son
 * étiquette tournent, le reflet et l'ombre restent fixes (comme sous une vraie lampe), le bras pivote autour de
 * son socle. Cadre 1200 × 1000 : disque centré en (500, 500), pivot du bras en (1090, 150).
 *
 * @param angle rotation du disque en degrés, lue au dessin (aucune recomposition pendant qu'il tourne)
 * @param leve 0 : pointe posée sur le disque ; 1 : bras relevé sur son repose-bras
 * @param or 0 : étiquette rose ; 1 : étiquette dorée (révélation)
 */
@Composable
fun Platine(angle: () -> Float, leve: Float, or: Float, modifier: Modifier = Modifier) {
    Box(modifier.aspectRatio(1.2f, matchHeightConstraintsFirst = true)) {
        Box(Modifier.fillMaxHeight().aspectRatio(1f, matchHeightConstraintsFirst = true).graphicsLayer { rotationZ = angle() }, contentAlignment = Alignment.Center) {
            Image(painterResource(R.drawable.lmp_bt_vinyle), contentDescription = null, modifier = Modifier.fillMaxSize())
            Box(Modifier.fillMaxSize(0.331f)) {
                Image(painterResource(R.drawable.lmp_bt_label_rose), contentDescription = null, modifier = Modifier.fillMaxSize())
                if (or > 0f) {
                    Image(painterResource(R.drawable.lmp_bt_label_or), contentDescription = null, modifier = Modifier.fillMaxSize().graphicsLayer { alpha = or })
                }
            }
        }
        Image(painterResource(R.drawable.lmp_bt_reflet), contentDescription = null, modifier = Modifier.fillMaxSize())
        Image(
            painterResource(R.drawable.lmp_bt_bras), contentDescription = null,
            modifier = Modifier.fillMaxSize().graphicsLayer {
                rotationZ = -15f * leve
                transformOrigin = TransformOrigin(1090f / 1200f, 150f / 1000f)
            },
        )
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

