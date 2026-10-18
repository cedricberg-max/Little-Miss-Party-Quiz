package com.littlemissparty.quiz.tv.habillage

import android.os.SystemClock
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.tv.UiState
import kotlin.math.exp
import kotlin.math.sin
import kotlinx.coroutines.delay

/** Couleurs du plateau « Néon chic » (démo validée le 18 octobre). */
object Neon {
    val Nuit = Color(0xFF0B0614)
    val Nuit2 = Color(0xFF1A0B2E)
    val Violet = Color(0xFF6E28BE)
    val Blanc = Color(0xFFFFF4F2)
    val Halo = Color(0xFFF888B3)
    val Or = Color(0xFFF0CC92)
    val OrClair = Color(0xFFF6DAAA)
    val OrProfond = Color(0xFFE0B577)
    val Chaud = Color(0xFFFF5A1F)
}

/** Ce qui doit survivre à l'écran : un générique par partie, même si la box se reconnecte. */
object Habillage {
    val directeur = DirecteurSonore()
    val generiquesVus = mutableSetOf<String>()
}

/**
 * Habillage de toute l'appli TV : le décor du plateau et la bande-son, qui suivent la partie sans jamais
 * la modifier. Se place à la place de l'ancien fond, sous les écrans.
 */
@Composable
fun HabillageTv(state: UiState) {
    val context = LocalContext.current
    LaunchedEffect(Unit) { Sons.preparer(context) }
    val cycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(cycle) {
        val observateur = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_STOP -> Sons.suspendre()
                Lifecycle.Event.ON_START -> Sons.reprendre()
                else -> {}
            }
        }
        cycle.addObserver(observateur)
        onDispose { cycle.removeObserver(observateur) }
    }
    val urgent = chronoUrgent(state as? UiState.Playing)
    val instant = remember(state, urgent) { instantDe(state, urgent, System.currentTimeMillis()) }
    LaunchedEffect(instant) { Sons.executer(Habillage.directeur.observer(instant)) }
    DecorPlateau(chaud = urgent)
}

internal fun instantDe(state: UiState, urgent: Boolean, maintenant: Long): Instant {
    val s = state as? UiState.Playing ?: return Instant(Ecran.HORS_PARTIE)
    val ecran = when (s.phase) {
        Phase.LOBBY -> Ecran.SALON
        Phase.QUESTION -> Ecran.QUESTION
        Phase.CLOSED -> Ecran.VERROUILLEE
        Phase.REVEAL -> Ecran.REVELATION
        Phase.SCORES -> Ecran.CLASSEMENT
        Phase.ENDED -> Ecran.FIN
    }
    return Instant(
        ecran = ecran,
        partie = s.code,
        index = s.index,
        equipes = s.teams.size,
        reponses = s.answered.size,
        propositions = s.question?.choices?.size ?: 4,
        enPause = s.paused,
        repriseDansMs = s.resumeAt?.let { it - (maintenant + s.serverOffset) }?.coerceAtLeast(0) ?: 0,
        urgent = urgent,
        buzzeur = s.teams.indexOfFirst { it.uid == s.buzzerUid },
        premiere = s.index == 0,
        superFinale = s.question?.double == true,
        gagnants = if (s.phase == Phase.REVEAL) s.awards.values.count { it.points > 0 } else 0,
        meneurAPoints = (s.ranking.firstOrNull()?.second ?: 0) > 0,
    )
}

/** Vrai pendant les 5 dernières secondes du chrono, calculé comme le chrono affiché (heure du serveur). */
@Composable
private fun chronoUrgent(s: UiState.Playing?): Boolean {
    var urgent by remember { mutableStateOf(false) }
    val deadline = if (s != null && s.phase == Phase.QUESTION && !s.paused) s.deadline else null
    LaunchedEffect(deadline, s?.resumeAt) {
        if (s == null || deadline == null) {
            urgent = false
            return@LaunchedEffect
        }
        val depart = s.resumeAt ?: 0L
        while (true) {
            val reste = deadline - maxOf(System.currentTimeMillis() + s.serverOffset, depart)
            urgent = reste in 1..5_000
            if (reste <= 0) break
            delay(100)
        }
    }
    return urgent
}

/**
 * Le plateau : nuit violette, halos qui battent au tempo de la musique, sol en perspective, deux
 * projecteurs qui balaient, étincelles. Une seule toile redessinée à chaque image, rien n'est recomposé.
 * Dans les 5 dernières secondes, les bords chauffent (orange).
 */
@Composable
fun DecorPlateau(chaud: Boolean) {
    val battement = remember { mutableFloatStateOf(0f) }
    val temps = remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) {
        while (true) {
            withFrameMillis {
                val ms = SystemClock.elapsedRealtime() - Sons.departDesLits
                val phase = Math.floorMod(ms, Tempo.TEMPS).toFloat() / Tempo.TEMPS
                battement.floatValue = exp(-phase * 4.5f)
                temps.floatValue = Math.floorMod(ms, 600_000L) / 1000f
            }
        }
    }
    val chaleur by animateFloatAsState(if (chaud) 1f else 0f, tween(600), label = "chaleur")
    Canvas(Modifier.fillMaxSize()) {
        val p = battement.floatValue
        val t = temps.floatValue
        val w = size.width
        val h = size.height
        drawRect(Brush.radialGradient(listOf(Color(0xFF24093F), Color(0xFF130726), Neon.Nuit), Offset(w / 2, 0f), w * 0.85f))
        halo(Neon.Halo.copy(alpha = 0.30f * (0.45f + 0.55f * p)), Offset(w * 0.08f, h * 0.02f), w * 0.33f)
        halo(Neon.Violet.copy(alpha = 0.55f * (0.55f + 0.45f * p)), Offset(w * 0.9f, h * 0.05f), w * 0.31f)
        halo(Neon.Or.copy(alpha = 0.26f * (0.35f + 0.65f * p)), Offset(w * 0.5f, h * 1.08f), w * 0.4f)
        sol(t, 0.10f + 0.22f * p)
        projecteur(Offset(w * 0.18f, h), 14f + 12f * sin(t * 0.55f), 0.07f + 0.04f * p)
        projecteur(Offset(w * 0.82f, h), -14f - 12f * sin(t * 0.55f + 1.3f), 0.07f + 0.04f * p)
        etincelles(t)
        if (chaleur > 0.01f) {
            drawRect(
                Brush.radialGradient(
                    0.55f to Color.Transparent,
                    1f to Neon.Chaud.copy(alpha = 0.5f * chaleur * (0.7f + 0.3f * p)),
                    center = Offset(w / 2, h / 2), radius = w * 0.62f,
                ),
            )
        }
    }
}

private fun DrawScope.halo(couleur: Color, centre: Offset, rayon: Float) {
    drawCircle(Brush.radialGradient(listOf(couleur, Color.Transparent), centre, rayon), rayon, centre)
}

/** Sol quadrillé en perspective, qui avance lentement vers le public. */
private fun DrawScope.sol(t: Float, force: Float) {
    val w = size.width
    val h = size.height
    val haut = h * 0.8f
    val fuite = Offset(w / 2, h * 0.45f)
    val trait = 1.5f
    for (k in -10..10) {
        val xBas = w / 2 + k * w * 0.085f
        val xHaut = fuite.x + (xBas - fuite.x) * ((haut - fuite.y) / (h - fuite.y))
        drawLine(
            Brush.verticalGradient(listOf(Color.Transparent, Neon.Halo.copy(alpha = force)), haut, h),
            Offset(xHaut, haut), Offset(xBas, h), trait,
        )
    }
    val defile = (t * 0.25f) % 1f
    for (k in 0 until 7) {
        val u = ((k + defile) / 7f)
        val y = haut + (h - haut) * u * u
        drawLine(Neon.Halo.copy(alpha = force * u), Offset(0f, y), Offset(w, y), trait)
    }
}

private fun DrawScope.projecteur(pied: Offset, angle: Float, force: Float) {
    val l = size.height * 1.3f
    val demi = size.width * 0.06f
    val faisceau = Path().apply {
        moveTo(pied.x - demi * 0.25f, pied.y)
        lineTo(pied.x - demi, pied.y - l)
        lineTo(pied.x + demi, pied.y - l)
        lineTo(pied.x + demi * 0.25f, pied.y)
        close()
    }
    rotate(angle, pied) {
        drawPath(faisceau, Brush.verticalGradient(listOf(Color.Transparent, Neon.Blanc.copy(alpha = force), Color.Transparent), pied.y - l, pied.y))
    }
}

private val positions = List(18) { i -> Offset(((i * 0.618f + 0.11f) % 1f), ((i * 0.377f + 0.07f) % 0.75f)) }

private fun DrawScope.etincelles(t: Float) {
    positions.forEachIndexed { i, o ->
        val a = ((sin(t * (1.1f + i % 4 * 0.3f) + i * 1.7f) + 1f) / 2f)
        if (a > 0.35f) {
            drawCircle(Neon.Blanc.copy(alpha = (a - 0.35f) * 0.9f), size.minDimension * (0.0025f + 0.0015f * (i % 3)), Offset(o.x * size.width, o.y * size.height))
        }
    }
}
