package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin

/** Durée de l'annonce d'un bonus, et d'un malus (plus bref, on ne s'attarde pas sur une perte). */
const val BONUS_MS = 2_200
const val MALUS_MS = 1_900

/** « +50 POINTS », « −1 POINT » : le delta exact, avec un vrai signe moins. */
fun texteDelta(delta: Int): String {
    val signe = if (delta < 0) "−" else "+"
    val n = abs(delta)
    return "$signe$n ${if (n == 1) "POINT" else "POINTS"}"
}

/** Valeur affichée par le compteur à l'instant [t] (de 0 à 1) : d'[avant] à [apres], sans jamais dépasser. */
fun valeurCompteur(avant: Int, apres: Int, t: Float): Int {
    val u = t.coerceIn(0f, 1f)
    val e = 1f - (1f - u) * (1f - u) * (1f - u)
    return if (u >= 1f) apres else avant + ((apres - avant) * e).toInt()
}

/**
 * Annonce plein écran d'un bonus ou d'un malus décidé par l'animatrice, déjà enregistré par la partie.
 * [delta] est la valeur exacte saisie à la régie ; [avant] et [apres] sont les totaux de l'équipe lus dans la partie :
 * l'annonce ne fait que les montrer, elle ne calcule ni n'écrit jamais un score. Transparente et sans focus, elle ne
 * bloque aucune touche et n'interrompt ni le chrono ni la musique (son court du SoundPool mixé par-dessus).
 * Une seule équipe est annoncée : elle tient de 1 à 8 équipes. [onFini] est appelé une seule fois, à la fin.
 */
@Composable
fun BonusMalus(
    nom: String,
    couleur: Color,
    delta: Int,
    avant: Int,
    apres: Int,
    modifier: Modifier = Modifier,
    jouer: (Son) -> Unit = { Sons.executer(listOf(Ordre.Jouer(it))) },
    onFini: () -> Unit,
) {
    val bonus = delta > 0
    val dureeMs = if (bonus) BONUS_MS else MALUS_MS
    val t = remember { Animatable(0f) }
    val fin by rememberUpdatedState(onFini)
    LaunchedEffect(Unit) {
        jouer(if (bonus) Son.BONUS else Son.MALUS)
        t.animateTo(1f, tween(dureeMs, easing = LinearEasing))
        fin()
    }
    val d = dureeMs.toFloat()
    // Repères calés sur le son : le chiffre se pose à 0,5 s, avec l'impact.
    val entree = 260f
    val claque = 520f
    val sortie = 320f
    val accent = if (bonus) Neon.Or else Color(0xFFFF7A3D)
    val accent2 = if (bonus) Neon.OrClair else Neon.Faux
    val compte by remember { derivedStateOf { valeurCompteur(avant, apres, (t.value * d - claque) / (d * 0.45f)) } }

    Box(
        // Textes laissés lisibles (« BONUS ! », « +50 POINTS ») : les tests de la régie les cherchent à l'écran.
        modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        // Voile léger, le jeu reste visible derrière.
        Box(
            Modifier.fillMaxSize().graphicsLayer {
                val ms = t.value * d
                alpha = 0.45f * (ms / entree).coerceIn(0f, 1f) * (1f - ((ms - (d - sortie)) / sortie).coerceIn(0f, 1f))
            }.background(Brush.radialGradient(listOf(Neon.Nuit.copy(alpha = 0.9f), Neon.Nuit.copy(alpha = 0.2f)))),
        )
        Echelle(960.dp, 540.dp) {
            if (bonus) Eclats(t, d, claque, Modifier.fillMaxSize())
            Column(
                Modifier
                    .align(Alignment.Center)
                    .graphicsLayer {
                        val ms = t.value * d
                        val p = (ms / entree).coerceIn(0f, 1f)
                        val f = ((ms - (d - sortie)) / sortie).coerceIn(0f, 1f)
                        // Entrée avec un léger dépassement, sortie qui s'envole un peu en s'effaçant.
                        val s = 0.55f + 0.45f * (1f + 0.18f * sin(p * PI.toFloat())) * p + 0.06f * f
                        scaleX = s
                        scaleY = s
                        alpha = p * (1f - f)
                        translationY = -40f * f
                        // Malus : petite secousse comique juste après l'arrivée du chiffre.
                        if (!bonus) {
                            val u = ((ms - claque) / 380f).coerceIn(0f, 1f)
                            translationX = if (u in 0.001f..0.999f) 22f * sin(u * 6f * PI.toFloat()) * (1f - u) else 0f
                            rotationZ = if (u in 0.001f..0.999f) 2.5f * sin(u * 5f * PI.toFloat()) * (1f - u) else 0f
                        }
                    }
                    .widthIn(max = 720.dp)
                    .background(
                        Brush.verticalGradient(listOf(Neon.FondHaut.copy(alpha = 0.96f), Neon.FondBas.copy(alpha = 0.96f))),
                        RoundedCornerShape(36.dp),
                    )
                    .border(4.dp, Brush.linearGradient(listOf(accent2, couleur, accent)), RoundedCornerShape(36.dp))
                    .padding(horizontal = 44.dp, vertical = 22.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    if (bonus) "BONUS !" else "MALUS !",
                    maxLines = 1,
                    style = TextStyle(fontFamily = PoliceLmp,
                        brush = Brush.verticalGradient(listOf(accent2, accent)),
                        fontSize = 40.sp, fontWeight = FontWeight.Black, letterSpacing = 6.sp,
                        shadow = Shadow(accent.copy(alpha = 0.7f), Offset.Zero, 22f),
                    ),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(22.dp).background(couleur, CircleShape).border(2.dp, Neon.Blanc, CircleShape))
                    Spacer(Modifier.width(12.dp))
                    Text(
                        nom,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.widthIn(max = 560.dp),
                        style = TextStyle(fontFamily = PoliceLmp, color = couleur, fontSize = 34.sp, fontWeight = FontWeight.ExtraBold, shadow = Shadow(Neon.Nuit, Offset(0f, 3f), 6f)),
                    )
                }
                Text(
                    texteDelta(delta),
                    maxLines = 1,
                    modifier = Modifier.graphicsLayer {
                        // Le chiffre claque : il tombe de très gros et se pose net.
                        val ms = t.value * d
                        val u = ((ms - entree) / (claque - entree)).coerceIn(0f, 1f)
                        val s = 1f + 1.1f * (1f - u) * (1f - u) + 0.08f * sin(u * PI.toFloat())
                        scaleX = s
                        scaleY = s
                        alpha = u
                    },
                    style = TextStyle(fontFamily = PoliceLmp,
                        color = if (bonus) Neon.JusteClair else Neon.Faux,
                        fontSize = 76.sp, lineHeight = 84.sp, fontWeight = FontWeight.Black,
                        shadow = Shadow((if (bonus) Neon.JusteClair else Neon.Faux).copy(alpha = 0.75f), Offset.Zero, 30f),
                    ),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (!bonus) {
                        Text("Oups !", style = TextStyle(fontFamily = PoliceLmp, color = Neon.Halo, fontSize = 24.sp, fontWeight = FontWeight.Bold))
                        Spacer(Modifier.width(18.dp))
                    }
                    Text("Score", style = TextStyle(fontFamily = PoliceLmp, color = Neon.Blanc.copy(alpha = 0.75f), fontSize = 24.sp, fontWeight = FontWeight.SemiBold))
                    Spacer(Modifier.width(12.dp))
                    Text(
                        "$compte",
                        maxLines = 1,
                        style = TextStyle(fontFamily = PoliceLmp, color = Neon.Blanc, fontSize = 34.sp, fontWeight = FontWeight.Black, shadow = Shadow(accent.copy(alpha = 0.6f), Offset.Zero, 14f)),
                    )
                }
                Spacer(Modifier.height(2.dp))
            }
        }
    }
}

/** Éclats dorés et confettis qui jaillissent du centre quand le chiffre se pose (bonus seulement). */
@Composable
private fun Eclats(t: Animatable<Float, AnimationVector1D>, d: Float, depart: Float, modifier: Modifier) {
    val morceaux = remember {
        val couleurs = listOf(Neon.Or, Neon.OrClair, Neon.JusteClair, Color(0xFFFF2D8A), Color(0xFFFFE61F), Neon.Blanc, Neon.Halo)
        List(36) { i ->
            val r = java.util.Random(i * 6151L)
            Eclat(i * (2f * PI.toFloat() / 36f) + r.nextFloat() * 0.3f, 0.6f + r.nextFloat() * 0.5f, r.nextFloat() * 6.28f, i % 3 == 0, couleurs[i % couleurs.size])
        }
    }
    Canvas(modifier) {
        val ms = t.value * d - depart
        if (ms <= 0f) return@Canvas
        val s = (ms / (d - depart)).coerceIn(0f, 1f)
        val w = size.width
        val h = size.height
        val c = Offset(w / 2, h / 2)
        val ouvert = 1f - exp(-5f * s)
        // Anneau de lumière qui s'élargit.
        drawCircle(
            Brush.radialGradient(listOf(Color.Transparent, Neon.Or.copy(alpha = 0.55f * (1f - s)), Color.Transparent), c, h * (0.2f + 0.6f * ouvert)),
            h * (0.2f + 0.6f * ouvert), c,
        )
        val taille = h * 0.02f
        morceaux.forEach { m ->
            val r = m.force * ouvert * h * 0.75f
            val x = c.x + cos(m.angle) * r * 1.4f
            val y = c.y + sin(m.angle) * r + h * 0.25f * s * s
            val a = (1f - s * s).coerceIn(0f, 1f)
            if (m.etoile) {
                val k = taille * (0.6f + 0.6f * abs(sin(s * 9f + m.phase)))
                drawLine(m.couleur.copy(alpha = a), Offset(x - k, y), Offset(x + k, y), strokeWidth = taille * 0.25f)
                drawLine(m.couleur.copy(alpha = a), Offset(x, y - k), Offset(x, y + k), strokeWidth = taille * 0.25f)
            } else {
                rotate(s * 540f + m.phase * 57f, Offset(x, y)) {
                    drawRect(m.couleur.copy(alpha = a), Offset(x - taille / 2, y - taille * 0.3f), Size(taille, taille * 0.6f))
                }
            }
        }
    }
}

private class Eclat(val angle: Float, val force: Float, val phase: Float, val etoile: Boolean, val couleur: Color)
