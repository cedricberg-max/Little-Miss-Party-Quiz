package com.littlemissparty.quiz.tv.habillage

import android.graphics.ImageDecoder
import android.graphics.drawable.AnimatedImageDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.util.Log
import android.widget.ImageView
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.QuestionKind
import com.littlemissparty.quiz.tv.UiState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * Le robot animateur du design « The Game Show » : de courts clips pré-calculés (WebP animés avec transparence,
 * res/raw/gs_robot_*.webp, rendus depuis la maquette 3D du kit) qui surgissent en bas à gauche à cinq moments, puis
 * s'effacent. Rien ne se calcule en 3D sur la box : elle lit une petite animation, comme une image.
 * Jamais en design classique, jamais pendant une pause ; sur une TV trop ancienne (avant Android 9) ou si le clip
 * ne se lit pas, il n'y a simplement pas de robot : la partie n'en dépend jamais.
 */
enum class MomentRobot(val fichier: String, val dureeMs: Long) {
    /** Présentation d'un jeu : il monte sur son socle et salue. */
    MANCHE("gs_robot_manche", 2_800),
    /** Cinq dernières secondes du chrono : mains devant la bouche, il tremble. */
    SUSPENSE("gs_robot_suspense", 3_000),
    /** Révélation sans aucune bonne réponse : il hausse les épaules, un peu triste. */
    RATE("gs_robot_rate", 2_800),
    /** Tableau des scores : il danse, les yeux en étoiles. */
    SCORES("gs_robot_scores", 3_200),
    /** Grand gagnant de la soirée, après l'annonce : il saute de joie. */
    PODIUM("gs_robot_podium", 3_600),
}

/** Le moment du robot pour cet écran (et sa clé : un clip par question, par jeu, par classement), ou null. */
internal fun momentRobot(s: UiState.Playing, secondes: Int): Pair<MomentRobot, String>? {
    if (s.paused) return null
    val q = s.question
    // Questions à réponses (quiz, Vrai ou Faux, Juste Chiffre…) : les jeux à plein écran (mimes, blind test, mini-jeux)
    // ont déjà leur propre mise en scène.
    val quiz = q != null && s.mime == null && s.blind == null && s.coffres == null && s.portes == null &&
        q.kind in setOf(QuestionKind.CLASSIC, QuestionKind.EXPRESS, QuestionKind.NUMBER, QuestionKind.ZOOM, QuestionKind.FLOU)
    return when (s.phase) {
        Phase.QUESTION, Phase.CLOSED, Phase.REVEAL -> when {
            s.intro -> MomentRobot.MANCHE to "manche ${s.code} ${s.index}"
            quiz && s.phase == Phase.QUESTION && secondes in 1..5 -> MomentRobot.SUSPENSE to "suspense ${s.code} ${q!!.id}"
            quiz && s.phase == Phase.REVEAL && s.awards.isNotEmpty() && s.awards.values.none { it.correct } -> MomentRobot.RATE to "rate ${s.code} ${q!!.id}"
            else -> null
        }
        Phase.SCORES -> if (s.portes == null && s.blind == null) MomentRobot.SCORES to "scores ${s.code} ${s.index}" else null
        Phase.ENDED -> MomentRobot.PODIUM to "podium ${s.code}"
        Phase.LOBBY -> null
    }
}

/** Clips déjà joués (par clé) : un même moment ne repasse pas si l'écran se recompose ou si la box se reconnecte. */
private val clipsJoues = mutableSetOf<String>()

@Composable
fun RobotGameShow(state: UiState) {
    if (!Look.gs || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return
    val s = state as? UiState.Playing ?: return
    val secondes = secondesRestantes(s)
    val (moment, cle) = momentRobot(s, secondes) ?: return
    // Podium : il attend que le grand gagnant soit annoncé.
    val attente = if (moment == MomentRobot.PODIUM) Tempo.FIN_VAINQUEUR + 400 else 0L
    key(cle) { ClipRobot(moment, cle, attente) }
}

@Composable
private fun ClipRobot(moment: MomentRobot, cle: String, attenteMs: Long) {
    val context = LocalContext.current
    var image by remember { mutableStateOf<Drawable?>(null) }
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(cle) {
        if (!clipsJoues.add(cle)) return@LaunchedEffect
        val d = try {
            withContext(Dispatchers.IO) {
                val id = context.resources.getIdentifier(moment.fichier, "raw", context.packageName)
                if (id == 0) null else ImageDecoder.decodeDrawable(ImageDecoder.createSource(context.resources, id))
            }
        } catch (e: Exception) {
            Log.w("Habillage", "Robot ${moment.name} ignoré : ${e.message}")
            null
        } ?: return@LaunchedEffect
        delay(attenteMs)
        (d as? AnimatedImageDrawable)?.apply { repeatCount = 0; start() }
        image = d
        visible = true
        delay(moment.dureeMs + 500)
        visible = false
        delay(500)
        (d as? AnimatedImageDrawable)?.stop()
        image = null
    }
    val alpha by animateFloatAsState(if (visible) 1f else 0f, tween(if (visible) 120 else 450), label = "robot")
    val d = image ?: return
    Box(Modifier.fillMaxSize().clearAndSetSemantics {}, contentAlignment = Alignment.BottomStart) {
        AndroidView(
            factory = { ImageView(it).apply { scaleType = ImageView.ScaleType.FIT_END } },
            update = { it.setImageDrawable(d) },
            modifier = Modifier.offset(x = (-6).dp, y = 10.dp).size(184.dp, 230.dp).graphicsLayer { this.alpha = alpha },
        )
    }
}
