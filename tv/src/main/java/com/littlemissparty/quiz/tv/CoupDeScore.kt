package com.littlemissparty.quiz.tv

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.habillage.Confettis
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.Ordre
import com.littlemissparty.quiz.tv.habillage.Son
import com.littlemissparty.quiz.tv.habillage.Sons
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

/**
 * Points ajoutés ou retirés à la main depuis la régie, déjà comptés par le moteur : la TV les montre en
 * BONUS ou en MALUS. [id] : numéro de l'événement ScoreAdjusted ; [delta] : les points exacts de la
 * correction ; [avant]/[apres] : total de l'équipe avant et après. L'animation ne calcule jamais un score.
 */
data class CoupDeScore(
    val id: Int,
    val equipe: String,
    val nom: String,
    val couleur: String,
    val delta: Int,
    val avant: Int,
    val apres: Int,
) {
    val bonus: Boolean get() = delta > 0
}

/**
 * File des coups à montrer, un à la fois pour rester lisibles. Deux corrections rapides de la même équipe
 * dans le même sens, la seconde arrivée avant que la première n'ait commencé, n'en font qu'une (+10 puis +10
 * montrent +20). Celle qui est déjà à l'écran n'est jamais modifiée.
 */
class FileDesCoups(private val max: Int = 6) {
    private val attente = ArrayDeque<CoupDeScore>()
    var courant: CoupDeScore? = null
        private set

    /** Ajoute un coup ; rend le coup à montrer maintenant. */
    fun ajouter(c: CoupDeScore): CoupDeScore? {
        val dernier = attente.lastOrNull()
        if (dernier != null && dernier.equipe == c.equipe && dernier.bonus == c.bonus) {
            attente[attente.lastIndex] = c.copy(delta = dernier.delta + c.delta, avant = dernier.avant)
        } else {
            attente.addLast(c)
            // Une avalanche de corrections : on garde les dernières, le score réel est déjà juste.
            while (attente.size > max) attente.removeFirst()
        }
        if (courant == null) courant = attente.removeFirstOrNull()
        return courant
    }

    /** Le coup [id] a fini de s'afficher ; rend le suivant (ou null). Un id périmé ne change rien. */
    fun fini(id: Int): CoupDeScore? {
        if (courant?.id != id) return courant
        courant = attente.removeFirstOrNull()
        return courant
    }

    fun vider() {
        attente.clear()
        courant = null
    }
}

/** Durée de chaque animation : la joie dure un peu plus que le « oups ». */
const val BONUS_MS = 2_600L
const val MALUS_MS = 1_900L

/**
 * Animation simple du BONUS / MALUS, par-dessus l'écran, sans rien bloquer : en attendant celle du fil
 * Design (habillage/BonusMalus), qui la remplace par la même signature. Seulement des transformations
 * (graphicsLayer) : rien n'est redessiné à chaque image en plein écran.
 */
@Composable
fun BonusMalusSimple(coup: CoupDeScore, onFini: () -> Unit) {
    val entree = remember(coup.id) { Animatable(0f) }
    val sortie = remember(coup.id) { Animatable(1f) }
    val secousse = remember(coup.id) { Animatable(0f) }
    var affiche by remember(coup.id) { mutableIntStateOf(coup.avant) }
    LaunchedEffect(coup.id) {
        Sons.executer(
            if (coup.bonus) listOf(Ordre.Jouer(Son.CLOCHES), Ordre.Jouer(Son.POINTS, 350))
            else listOf(Ordre.Jouer(Son.RIGOLO_2), Ordre.Jouer(Son.MAGIE_POUF, 150)),
        )
        launch { entree.animateTo(1f, spring(dampingRatio = if (coup.bonus) 0.45f else 0.6f, stiffness = Spring.StiffnessMediumLow)) }
        if (!coup.bonus) launch {
            delay(150)
            secousse.animateTo(0f, keyframes { durationMillis = 500; 18f at 60; -16f at 140; 12f at 220; -8f at 300; 4f at 380 })
        }
        // Le compteur de l'équipe suit la correction, une dizaine d'étapes au plus.
        launch {
            delay(450)
            val pas = 12
            for (k in 1..pas) {
                affiche = coup.avant + (coup.apres - coup.avant) * k / pas
                delay(55)
            }
        }
        delay((if (coup.bonus) BONUS_MS else MALUS_MS) - 350)
        sortie.animateTo(0f, tween(350, easing = FastOutSlowInEasing))
        onFini()
    }
    val equipe = coup.couleur.toColor()
    val accent = if (coup.bonus) Neon.Or else Color(0xFFFF7A2F)
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        if (coup.bonus) Confettis(0, Modifier.graphicsLayer { alpha = sortie.value })
        Column(
            Modifier
                .graphicsLayer {
                    val e = entree.value
                    scaleX = 0.4f + 0.6f * e
                    scaleY = 0.4f + 0.6f * e
                    alpha = (e * 1.4f).coerceAtMost(1f) * sortie.value
                    translationX = secousse.value * density
                    rotationZ = if (coup.bonus) (1f - e) * -8f else secousse.value * 0.2f
                }
                .background(
                    Brush.verticalGradient(listOf(Neon.FondHaut.copy(alpha = 0.94f), Neon.Nuit.copy(alpha = 0.94f))),
                    RoundedCornerShape(36.dp),
                )
                .padding(horizontal = 64.dp, vertical = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                if (coup.bonus) "BONUS !" else "MALUS !",
                style = grand(64.sp, accent),
            )
            Text(coup.nom, style = grand(34.sp, equipe), maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis)
            Text(
                "${if (coup.bonus) "+" else "−"}${abs(coup.delta)} POINTS",
                style = grand(if (coup.bonus) 96.sp else 80.sp, if (coup.bonus) Neon.Blanc else accent),
            )
            Text("$affiche points", style = grand(26.sp, Neon.Blanc.copy(alpha = 0.8f)))
        }
    }
}

private fun grand(taille: androidx.compose.ui.unit.TextUnit, couleur: Color) = TextStyle(
    color = couleur,
    fontSize = taille,
    lineHeight = taille,
    fontWeight = FontWeight.Black,
    shadow = Shadow(couleur.copy(alpha = 0.6f), blurRadius = 24f),
)
