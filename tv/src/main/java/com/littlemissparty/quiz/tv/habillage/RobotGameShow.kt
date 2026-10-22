package com.littlemissparty.quiz.tv.habillage

import android.graphics.ImageDecoder
import android.graphics.drawable.AnimatedImageDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.util.Log
import android.widget.ImageView
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.viewinterop.AndroidView
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.QuestionKind
import com.littlemissparty.quiz.tv.UiState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/**
 * Le robot animateur du design « The Game Show » : de courts clips pré-calculés (WebP animés avec transparence,
 * res/raw/gs_robot_*.webp, rendus depuis la maquette 3D du kit) à cinq moments. Le robot est grand (90 % de la hauteur
 * de l'écran) et traverse l'écran en glissant sur son socle ([trajet]) ; pendant une question, il reste au bord droit
 * pour ne pas cacher les réponses. Rien ne se calcule en 3D sur la box : elle lit une petite animation, comme une image,
 * et la déplace (simple translation de calque, sans recomposition).
 * Jamais en design classique, jamais pendant une pause ; sur une TV trop ancienne (avant Android 9) ou si le clip
 * ne se lit pas, il n'y a simplement pas de robot : la partie n'en dépend jamais.
 */
enum class MomentRobot(val fichier: String, val dureeMs: Long) {
    /** Présentation d'un jeu : il entre par la gauche, salue, puis traverse tout l'écran. */
    MANCHE("gs_robot_manche", 2_800),
    /** Cinq dernières secondes du chrono : il surgit au bord droit, mains devant la bouche, et tremble. */
    SUSPENSE("gs_robot_suspense", 3_000),
    /** Révélation sans aucune bonne réponse : il traverse l'écran en haussant les épaules, un peu triste. */
    RATE("gs_robot_rate", 2_800),
    /** Tableau des scores : il traverse l'écran en dansant et en sautillant, les yeux en étoiles. */
    SCORES("gs_robot_scores", 3_200),
    /** Grand gagnant de la soirée, après l'annonce : il arrive en bondissant à côté du nom et saute de joie. */
    PODIUM("gs_robot_podium", 3_600),
}

/**
 * Une étape du trajet : à [ms], le centre du robot est à [x] (fraction de la largeur de l'écran), son socle à [bas]
 * (fraction de la hauteur ; 1 = bord bas) et sa taille à [echelle]. Hors de [0, 1] : en dehors de l'écran.
 */
internal data class EtapeRobot(val ms: Int, val x: Float, val bas: Float, val echelle: Float = 1f)

/** Le trajet d'un moment ; [sauts] = hauteur des petits bonds (fraction de l'écran), [periodeSautMs] leur rythme. */
internal class TrajetRobot(val etapes: List<EtapeRobot>, val sauts: Float = 0f, val periodeSautMs: Int = 500) {
    val totalMs get() = etapes.last().ms

    /** Position (x, bas, échelle) à [ms] : passage en douceur d'une étape à l'autre, plus les bonds. */
    fun a(ms: Float): Triple<Float, Float, Float> {
        val i = etapes.indexOfLast { it.ms <= ms }.coerceIn(0, etapes.size - 2)
        val e0 = etapes[i]
        val e1 = etapes[i + 1]
        val u = ((ms - e0.ms) / (e1.ms - e0.ms)).coerceIn(0f, 1f)
        val d = u * u * (3 - 2 * u)
        val bond = if (sauts > 0f) sauts * abs(sin(PI.toFloat() * ms / periodeSautMs)) else 0f
        return Triple(e0.x + (e1.x - e0.x) * d, e0.bas + (e1.bas - e0.bas) * d - bond, e0.echelle + (e1.echelle - e0.echelle) * d)
    }
}

internal fun trajet(moment: MomentRobot): TrajetRobot = when (moment) {
    MomentRobot.MANCHE -> TrajetRobot(listOf(EtapeRobot(0, -0.25f, 1f), EtapeRobot(1_000, 0.19f, 1f), EtapeRobot(2_700, 0.23f, 1f), EtapeRobot(4_000, 1.25f, 1f)))
    // Au bord droit seulement : les réponses (texte à gauche des cartes) restent lisibles.
    MomentRobot.SUSPENSE -> TrajetRobot(listOf(EtapeRobot(0, 1.2f, 1f, 0.8f), EtapeRobot(500, 0.92f, 1f, 0.8f), EtapeRobot(3_000, 0.92f, 1f, 0.8f), EtapeRobot(3_600, 1.2f, 1f, 0.8f)))
    MomentRobot.RATE -> TrajetRobot(listOf(EtapeRobot(0, -0.25f, 1.08f), EtapeRobot(1_100, 0.3f, 1.08f), EtapeRobot(2_600, 0.4f, 1.08f), EtapeRobot(3_800, 1.25f, 1.08f)))
    MomentRobot.SCORES -> TrajetRobot(listOf(EtapeRobot(0, -0.25f, 1f), EtapeRobot(3_400, 1.25f, 1f)), sauts = 0.06f, periodeSautMs = 500)
    // À droite du nom du grand gagnant, qui reste au centre.
    MomentRobot.PODIUM -> TrajetRobot(listOf(EtapeRobot(0, 1.25f, 1f, 1.05f), EtapeRobot(1_200, 0.87f, 1f, 1.05f), EtapeRobot(3_800, 0.87f, 1f, 1.05f), EtapeRobot(4_600, 1.25f, 1f, 1.05f)), sauts = 0.05f, periodeSautMs = 600)
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
    val temps = remember { Animatable(0f) }
    val chemin = remember(moment) { trajet(moment) }
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
        temps.animateTo(chemin.totalMs.toFloat(), tween(chemin.totalMs, easing = LinearEasing))
        (d as? AnimatedImageDrawable)?.stop()
        image = null
    }
    val d = image ?: return
    BoxWithConstraints(Modifier.fillMaxSize().clearAndSetSemantics {}) {
        val largeur = constraints.maxWidth.toFloat()
        val hauteur = constraints.maxHeight.toFloat()
        // 90 % de la hauteur de l'écran, au format des clips (4:5).
        val h = maxHeight * 0.9f
        val hauteurPx = hauteur * 0.9f
        AndroidView(
            factory = { ImageView(it).apply { scaleType = ImageView.ScaleType.FIT_CENTER } },
            update = { it.setImageDrawable(d) },
            modifier = Modifier.size(h * 0.8f, h).graphicsLayer {
                val (x, bas, echelle) = chemin.a(temps.value)
                scaleX = echelle
                scaleY = echelle
                translationX = x * largeur - hauteurPx * 0.4f
                translationY = bas * hauteur - hauteurPx / 2 - hauteurPx * echelle / 2
                alpha = (temps.value / 150f).coerceIn(0f, 1f)
            },
        )
    }
}
