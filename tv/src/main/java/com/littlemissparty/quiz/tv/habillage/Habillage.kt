package com.littlemissparty.quiz.tv.habillage

import android.os.SystemClock
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.engine.QuestionKind
import com.littlemissparty.quiz.tv.UiState
import kotlin.math.cos
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
    /** Dernier jeu montré par partie : le rideau de transition ne passe qu'au changement de jeu. */
    val epreuvesVues = mutableMapOf<String, String>()
    /** Tours de mimes déjà présentés par le bandeau d'équipe. */
    val equipesAnnoncees = mutableSetOf<String>()
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
        Phase.QUESTION -> when {
            s.mime == null -> Ecran.QUESTION
            s.mime.team != null -> Ecran.MIMES_TOUR
            else -> Ecran.MIMES
        }
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
        buzzeur = s.teams.indexOfFirst { it.uid == s.lastFunBuzz },
        buzzs = s.funTotal,
        premiere = s.index == 0,
        superFinale = s.question?.double == true,
        gagnants = if (s.phase == Phase.REVEAL) s.awards.values.count { it.points > 0 } else 0,
        meneurAPoints = (s.ranking.firstOrNull()?.second ?: 0) > 0,
        trouves = s.mime?.takeIf { it.team != null }?.found ?: 0,
        passes = s.mime?.takeIf { it.team != null }?.passed ?: 0,
        epreuve = s.question?.takeIf { s.phase == Phase.QUESTION || s.phase == Phase.CLOSED || s.phase == Phase.REVEAL }?.let(::epreuveDe) ?: "",
    )
}

/** Le jeu auquel appartient une question : les mimes, ou une manche de quiz (toutes ses questions ensemble). */
internal fun epreuveDe(q: Question) = (if (q.kind == QuestionKind.MIME) "mimes" else "quiz") + "|" + (q.roundTitle ?: "")

/**
 * Vrai pendant la fin du chrono (5 dernières secondes d'une question, 10 d'un tour de mimes), calculé comme
 * le chrono affiché (heure du serveur).
 */
@Composable
private fun chronoUrgent(s: UiState.Playing?): Boolean {
    var urgent by remember { mutableStateOf(false) }
    val deadline = if (s != null && s.phase == Phase.QUESTION && !s.paused) s.deadline else null
    val fenetre = if (s?.mime != null) 10_000L else 5_000L
    LaunchedEffect(deadline, s?.resumeAt, fenetre) {
        if (s == null || deadline == null) {
            urgent = false
            return@LaunchedEffect
        }
        val depart = s.resumeAt ?: 0L
        while (true) {
            val reste = deadline - maxOf(System.currentTimeMillis() + s.serverOffset, depart)
            urgent = reste in 1..fenetre
            if (reste <= 0) break
            delay(100)
        }
    }
    return urgent
}

/**
 * Le plateau : nuit violette, sol en perspective, deux projecteurs, et des halos et étincelles qui
 * battent au tempo de la musique. Tout est dessiné une seule fois dans deux calques ; seule l'opacité du
 * calque lumineux change, une vingtaine de fois par seconde, pour rester fluide sur une petite box et
 * laisser la main aux écrans du jeu. Dans les 5 dernières secondes, les bords chauffent (orange).
 */
@Composable
fun DecorPlateau(chaud: Boolean) {
    val battement = remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) {
        while (true) {
            val ms = SystemClock.elapsedRealtime() - Sons.departDesLits
            val phase = Math.floorMod(ms, Tempo.TEMPS).toFloat() / Tempo.TEMPS
            battement.floatValue = exp(-phase * 4.5f)
            delay(50)
        }
    }
    val chaleur by animateFloatAsState(if (chaud) 1f else 0f, tween(600), label = "chaleur")
    Box(Modifier.fillMaxSize()) {
        // Fond, sol et projecteurs : ne se redessinent jamais.
        Box(
            Modifier.fillMaxSize().drawWithCache {
                val w = size.width
                val h = size.height
                val fond = Brush.radialGradient(listOf(Color(0xFF24093F), Color(0xFF130726), Neon.Nuit), Offset(w / 2, 0f), w * 0.85f)
                val lignes = sol(w, h)
                val faisceaux = listOf(faisceau(w, h, 0.18f, 16f), faisceau(w, h, 0.82f, -16f))
                onDrawBehind {
                    drawRect(fond)
                    lignes.forEach { (b, de, a) -> drawLine(b, de, a, 1.5f) }
                    faisceaux.forEach { (chemin, lumiere) -> drawPath(chemin, lumiere) }
                }
            },
        )
        // Halos rose, violet et or, et étincelles : leur éclat suit le battement.
        Box(
            Modifier.fillMaxSize()
                .graphicsLayer { alpha = 0.45f + 0.55f * battement.floatValue }
                .drawWithCache {
                    val w = size.width
                    val h = size.height
                    val halos = listOf(
                        Triple(Neon.Halo.copy(alpha = 0.30f), Offset(w * 0.08f, h * 0.02f), w * 0.33f),
                        Triple(Neon.Violet.copy(alpha = 0.55f), Offset(w * 0.9f, h * 0.05f), w * 0.31f),
                        Triple(Neon.Or.copy(alpha = 0.26f), Offset(w * 0.5f, h * 1.08f), w * 0.4f),
                    ).map { (c, o, r) -> Triple(Brush.radialGradient(listOf(c, Color.Transparent), o, r), o, r) }
                    onDrawBehind {
                        halos.forEach { (b, o, r) -> drawCircle(b, r, o) }
                        etincelles()
                    }
                },
        )
        if (chaleur > 0.01f) {
            Box(
                Modifier.fillMaxSize()
                    .graphicsLayer { alpha = chaleur * (0.7f + 0.3f * battement.floatValue) }
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
    val lumiere = Brush.verticalGradient(listOf(Color.Transparent, Neon.Blanc.copy(alpha = 0.09f), Color.Transparent), pied.y - dy, pied.y)
    return chemin to lumiere
}

private val positions = List(18) { i -> Offset(((i * 0.618f + 0.11f) % 1f), ((i * 0.377f + 0.07f) % 0.75f)) }

private fun DrawScope.etincelles() {
    positions.forEachIndexed { i, o ->
        drawCircle(Neon.Blanc.copy(alpha = 0.25f + 0.15f * (i % 4)), size.minDimension * (0.0025f + 0.0015f * (i % 3)), Offset(o.x * size.width, o.y * size.height))
    }
}
