package com.littlemissparty.quiz.tv

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import kotlinx.coroutines.delay
import kotlin.math.sqrt

/** Zoom de départ de la photo mystère, et zoom quand le chrono arrive à zéro (la révélation la montre entière). */
private const val ZOOM_DEPART = 6f
private const val ZOOM_FIN = 1.6f

/**
 * Zoom mystère : la photo part très zoomée sur un détail et se dévoile au fil du chrono ; figée à la
 * fermeture, elle s'ouvre en entier à la révélation. Photo pas encore chargée : un grand « ? ».
 */
@Composable
fun ZoomPhoto(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    val bytes = q.imageId?.let { state.images[it] }
    val photo: ImageBitmap? = remember(bytes) {
        bytes?.let { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }.getOrNull() }
    }
    val total = q.durationMs.coerceAtLeast(1)
    var remaining by remember(q.id) { mutableLongStateOf(state.remainingMs) }
    LaunchedEffect(q.id, state.deadline, state.paused, state.phase) {
        val deadline = state.deadline
        if (deadline == null) {
            remaining = state.remainingMs
            return@LaunchedEffect
        }
        // Pendant le décompte 3, 2, 1 de la reprise, la photo ne bouge pas.
        val start = state.resumeAt ?: 0L
        while (true) {
            remaining = (deadline - maxOf(System.currentTimeMillis() + state.serverOffset, start)).coerceAtLeast(0)
            if (remaining == 0L) break
            delay(60)
        }
    }
    val revealed = state.phase == Phase.REVEAL || state.phase == Phase.SCORES
    val progress = 1f - remaining.toFloat() / total
    val target = if (revealed) 1f else ZOOM_DEPART - (ZOOM_DEPART - ZOOM_FIN) * progress.coerceIn(0f, 1f)
    val zoom by animateFloatAsState(
        target,
        animationSpec = if (revealed) tween(1_100, easing = FastOutSlowInEasing) else tween(90, easing = LinearEasing),
        label = "zoom",
    )
    // Chaque photo a son détail de départ, toujours le même pour la même question, et toujours sur l'objet :
    // jamais sur le fond blanc d'un personnage détouré (test du 25/10 au soir : cadre tout blanc au Zoom mystère).
    val pivot = remember(q.id, photo) {
        val graine = q.id.hashCode()
        val detail = photo?.let { runCatching { pivotSurPhoto(it.asAndroidBitmap(), graine) }.getOrNull() }
        val (x, y) = detail ?: (0.3f + (graine and 0xFF) / 255f * 0.4f to 0.3f + ((graine shr 8) and 0xFF) / 255f * 0.4f)
        TransformOrigin(x, y)
    }
    Box(
        modifier.clip(RoundedCornerShape(28.dp)).background(Color.White.copy(alpha = 0.12f)),
        contentAlignment = Alignment.Center,
    ) {
        if (photo != null) {
            Image(
                photo, contentDescription = "Photo mystère", contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = zoom; scaleY = zoom; transformOrigin = pivot },
            )
        } else {
            Text("?", color = Palette.Gold, fontSize = 140.sp, fontWeight = FontWeight.Black)
        }
        if (!revealed) {
            Text(
                "ZOOM MYSTÈRE",
                color = Palette.Night, fontSize = 18.sp, fontWeight = FontWeight.Black,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 12.dp)
                    .clip(RoundedCornerShape(50)).background(Palette.Gold).padding(horizontal = 14.dp, vertical = 4.dp),
            )
        }
    }
}

/** Cadre du Zoom mystère (largeur / hauteur), le même que dans [GameScreens]. */
private const val CADRE = 4f / 3f

private fun pivotSurPhoto(photo: Bitmap, graine: Int): Pair<Float, Float>? {
    val w = 96
    val h = (w * photo.height / photo.width.coerceAtLeast(1)).coerceIn(8, 288)
    val petite = Bitmap.createScaledBitmap(photo, w, h, true)
    val px = IntArray(w * h)
    petite.getPixels(px, 0, w, 0, 0, w, h)
    if (petite !== photo) petite.recycle()
    return pivotDetail(px, w, h, graine)
}

/**
 * Point de départ du zoom (en fraction du cadre) : la fenêtre vue au zoom de départ qui a le plus de détail
 * (écart de luminosité), parmi les meilleures choisie selon [graine] pour varier d'une photo à l'autre.
 * Le transparent compte comme du blanc, un fond uni. Photo uniforme partout : null (le hasard suffit).
 */
internal fun pivotDetail(px: IntArray, w: Int, h: Int, graine: Int, zoom: Float = ZOOM_DEPART): Pair<Float, Float>? {
    if (w <= 0 || h <= 0 || px.size < w * h) return null
    val lum = FloatArray(w * h) { i ->
        val c = px[i]
        val a = (c ushr 24) / 255f
        val l = 0.299f * ((c shr 16) and 0xFF) + 0.587f * ((c shr 8) and 0xFF) + 0.114f * (c and 0xFF)
        l * a + 255f * (1 - a)
    }
    // ContentScale.Crop : la photo remplit le cadre 4/3, centrée ; on ne voit qu'une partie d'elle dans un sens.
    val aspect = w.toFloat() / h
    val fx = minOf(1f, CADRE / aspect)
    val fy = minOf(1f, aspect / CADRE)
    val candidats = ArrayList<Triple<Float, Float, Float>>()
    var x = 0.15f
    while (x <= 0.851f) {
        var y = 0.15f
        while (y <= 0.851f) {
            candidats += Triple(x, y, detailFenetre(lum, w, h, x, y, zoom, fx, fy))
            y += 0.05f
        }
        x += 0.05f
    }
    val meilleur = candidats.maxOf { it.third }
    if (meilleur < 6f) return null
    val bons = candidats.filter { it.third >= meilleur * 0.8f }
    val choix = bons[Math.floorMod(graine, bons.size)]
    return choix.first to choix.second
}

/** Écart type de la luminosité dans la partie de la photo que montre le cadre zoomé autour de (cx, cy). */
private fun detailFenetre(lum: FloatArray, w: Int, h: Int, cx: Float, cy: Float, zoom: Float, fx: Float, fy: Float): Float {
    fun versPhoto(c: Float, f: Float) = 0.5f + (c - 0.5f) * f
    val x0 = (versPhoto(cx - cx / zoom, fx) * w).toInt().coerceIn(0, w - 1)
    val x1 = (versPhoto(cx + (1 - cx) / zoom, fx) * w).toInt().coerceIn(x0 + 1, w)
    val y0 = (versPhoto(cy - cy / zoom, fy) * h).toInt().coerceIn(0, h - 1)
    val y1 = (versPhoto(cy + (1 - cy) / zoom, fy) * h).toInt().coerceIn(y0 + 1, h)
    var n = 0
    var somme = 0.0
    var carres = 0.0
    for (j in y0 until y1) for (i in x0 until x1) {
        val l = lum[j * w + i].toDouble()
        somme += l; carres += l * l; n++
    }
    val moyenne = somme / n
    return sqrt((carres / n - moyenne * moyenne).coerceAtLeast(0.0)).toFloat()
}
