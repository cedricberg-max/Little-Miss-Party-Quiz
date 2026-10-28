package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin

/*
 * Qui suis-je ? du Game Show, version A ajustée (planche du 28/10, validée par cedric) : l'enseigne de fête à ampoules,
 * les indices en cartes néon (une couleur et une étoile numérotée par indice, le nouveau arrive en rebond avec
 * « NOUVEL INDICE ! »), à droite l'appel au buzz SANS buzzer dessiné, et des confettis légers. Tout est dessiné en
 * direct (pas de vidéo), léger pour la Mi Box.
 */

/** Une couleur par indice (maquette : rose, cyan, jaune, vert, orange). */
internal val COULEURS_INDICES_GS = listOf(GS.Rose, GS.Cyan, GS.Jaune, GS.Juste, GS.Orange)

/** Le nouvel indice garde sa pastille « NOUVEL INDICE ! » ce temps-là (maquette : ~2 s). */
internal const val NOUVEL_INDICE_MS = 2_000

/** Les mots de l'enseigne et leur couleur : « QUI SUIS-JE ? » multicolore. */
private val MOTS_ENSEIGNE = listOf("QUI " to GS.Rose, "SUIS" to GS.Jaune, "-" to GS.Encre, "JE" to GS.Cyan, " ?" to GS.Juste)
private const val AMPOULES = 30

/** La grande enseigne « QUI SUIS-JE ? » violette, ampoules qui clignotent en chenillard, un peu penchée. */
@Composable
internal fun EnseigneQuiSuis(modifier: Modifier = Modifier) {
    val boucle = rememberInfiniteTransition(label = "enseigne-qsj")
    val t by boucle.animateFloat(0f, 60f, infiniteRepeatable(tween(60_000, easing = LinearEasing)), label = "t")
    Box(
        modifier
            .graphicsLayer {
                rotationZ = -1.4f
                val s = 1f + 0.012f * sin(t * 3f)
                scaleX = s; scaleY = s
            }
            .drawBehind {
                val r = CornerRadius(17.dp.toPx())
                drawRoundRect(Color(0xE60E0622), cornerRadius = r)
                for ((largeur, alpha) in listOf(10f to 0.25f, 5f to 0.5f)) {
                    drawRoundRect(GS.Violet, cornerRadius = r, style = Stroke(largeur.dp.toPx()), alpha = alpha)
                }
                drawRoundRect(Color.White.copy(alpha = 0.85f), cornerRadius = r, style = Stroke(1.2.dp.toPx()))
                // Ampoules sur tout le tour, une sur trois allumée, qui avancent (8 pas par seconde).
                val marge = 8.dp.toPx()
                val w = size.width - 2 * marge
                val h = size.height - 2 * marge
                val tour = 2 * (w + h)
                val pas = (t * 8f).toInt()
                for (k in 0 until AMPOULES) {
                    val p = pointDuTour(k * tour / AMPOULES, w, h).let { Offset(marge + it.x, marge + it.y) }
                    val allumee = (k + pas) % 3 == 0
                    if (allumee) drawCircle(Color(0x66FFC040), 7.dp.toPx(), p)
                    drawCircle(Color(0xFFFFF3C4), 3.2.dp.toPx(), p, alpha = if (allumee) 1f else 0.3f)
                }
            }
            .padding(horizontal = 36.dp, vertical = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            MOTS_ENSEIGNE.forEachIndexed { i, (mot, couleur) ->
                val lueur = 0.7f + 0.15f * sin(t * 5f + i)
                Text(
                    mot, maxLines = 1, softWrap = false,
                    style = TextStyle(fontFamily = PoliceGsTitre, fontSize = 46.sp, color = Color.White, shadow = Shadow(couleur, Offset.Zero, 26f * lueur)),
                )
            }
        }
    }
}

/**
 * Une carte d'indice : fond nuit, tube de la couleur de l'indice, étoile numérotée. [nouveau] : le dernier arrivé,
 * qui entre en rebond, brille plus fort, lance des étincelles et porte « NOUVEL INDICE ! » quelques secondes.
 * Mêmes marges que [CarteIndice] : la taille du texte calculée pour tenir sans rien couper reste juste.
 */
@Composable
internal fun CarteIndiceGs(numero: Int, texte: String, modifier: Modifier = Modifier, taille: TextUnit = 28.sp, nouveau: Boolean = false) {
    val couleur = COULEURS_INDICES_GS[(numero - 1).mod(COULEURS_INDICES_GS.size)]
    val entree = remember(numero, texte) { Animatable(if (nouveau) 0f else 1f) }
    val depuis = remember(numero, texte) { Animatable(if (nouveau) 0f else NOUVEL_INDICE_MS + 600f) }
    LaunchedEffect(numero, texte) {
        if (!nouveau) return@LaunchedEffect
        entree.animateTo(1f, spring(dampingRatio = 0.5f, stiffness = Spring.StiffnessMediumLow))
    }
    LaunchedEffect(numero, texte) {
        if (!nouveau) return@LaunchedEffect
        depuis.animateTo(NOUVEL_INDICE_MS + 600f, tween(NOUVEL_INDICE_MS + 600, easing = LinearEasing))
    }
    val etoile: Dp = (taille.value * 1.45f).dp
    val forme = RoundedCornerShape(22.dp)
    Box(modifier) {
        Row(
            Modifier
                .fillMaxWidth()
                .graphicsLayer {
                    val p = entree.value
                    alpha = (p * 3f).coerceIn(0f, 1f)
                    val s = 0.6f + 0.4f * p
                    scaleX = s; scaleY = s
                    rotationZ = (1f - p) * -4.6f
                }
                .shadow((10f + 14f * exp(-depuis.value / 330f)).dp, forme, ambientColor = couleur, spotColor = couleur)
                .clip(forme)
                .background(Color(0xE00E0622))
                .border(3.dp, couleur, forme)
                .padding(horizontal = 18.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(etoile), contentAlignment = Alignment.Center) {
                val tourne by rememberInfiniteTransition(label = "etoile").animateFloat(
                    -8f, 8f, infiniteRepeatable(tween(1_600 + 200 * numero), RepeatMode.Reverse), label = "r",
                )
                Canvas(Modifier.size(etoile).clearAndSetSemantics {}) {
                    rotate(tourne) { drawPath(etoileA5(size.width / 2f, size.height / 2f, size.minDimension * 0.56f), couleur) }
                }
                Text("$numero", style = styleCentre(taille * 0.72f, Color(0xFF14081F)).copy(fontFamily = PoliceGsTitre))
            }
            Spacer(Modifier.width(16.dp))
            Text(texte, style = TextStyle(fontFamily = PoliceLmp, color = GS.Encre, fontSize = taille, lineHeight = taille * 1.15f, fontWeight = FontWeight.ExtraBold))
        }
        if (nouveau) {
            val u = depuis.value
            // Étincelles au coin, puis la pastille jaune.
            if (u < 1_300f) Canvas(Modifier.matchParentSize().clearAndSetSemantics {}) { etincelles(Offset(size.width - 20.dp.toPx(), 10.dp.toPx()), u / 1000f, couleur, numero) }
            val f = ((u - 100f) / 200f).coerceIn(0f, 1f) * (1f - ((u - NOUVEL_INDICE_MS + 400f) / 400f).coerceIn(0f, 1f))
            if (f > 0f) Text(
                "NOUVEL INDICE !", maxLines = 1, softWrap = false,
                style = TextStyle(fontFamily = PoliceGsTitre, fontSize = 13.sp, color = Color(0xFF14081F)),
                modifier = Modifier.align(Alignment.TopEnd).padding(end = 6.dp)
                    .graphicsLayer { alpha = f; rotationZ = 4.6f; translationY = -12.dp.toPx() }
                    .shadow(8.dp, RoundedCornerShape(50), ambientColor = GS.Jaune, spotColor = GS.Jaune)
                    .clip(RoundedCornerShape(50)).background(GS.Jaune)
                    .padding(horizontal = 12.dp, vertical = 3.dp),
            )
        }
    }
}

/** Le point à la distance [d] sur le tour d'un rectangle [w] × [h], en partant du coin haut gauche, sens horaire. */
internal fun pointDuTour(d: Float, w: Float, h: Float): Offset {
    val tour = 2 * (w + h)
    val e = ((d % tour) + tour) % tour
    return when {
        e < w -> Offset(e, 0f)
        e < w + h -> Offset(w, e - w)
        e < 2 * w + h -> Offset(w - (e - w - h), h)
        else -> Offset(0f, h - (e - 2 * w - h))
    }
}

/** Étoile à 5 branches centrée sur ([cx], [cy]), de rayon [r]. */
private fun etoileA5(cx: Float, cy: Float, r: Float) = Path().apply {
    for (i in 0 until 10) {
        val a = -PI / 2 + i * PI / 5
        val rr = if (i % 2 == 1) r * 0.48f else r
        val x = cx + (rr * cos(a)).toFloat()
        val y = cy + (rr * sin(a)).toFloat()
        if (i == 0) moveTo(x, y) else lineTo(x, y)
    }
    close()
}

/** Une gerbe d'étincelles qui retombent, [u] secondes après son départ (graine fixe : la même à chaque image). */
private fun androidx.compose.ui.graphics.drawscope.DrawScope.etincelles(centre: Offset, u: Float, couleur: Color, graine: Int) {
    val r = java.util.Random(graine * 977L)
    repeat(28) { i ->
        val a = r.nextFloat() * 2f * PI.toFloat()
        val v = (120f + r.nextFloat() * 300f) * density / 2f
        val vie = 0.5f + r.nextFloat() * 0.8f
        if (u > vie) return@repeat
        val al = 1f - u / vie
        drawCircle(
            if (i % 3 == 0) Color.White else couleur, (1.3f + 1.5f * al) * density,
            Offset(centre.x + cos(a) * v * u, centre.y + sin(a) * v * u + 250f * density * u * u), alpha = al,
        )
    }
}

/**
 * À droite pendant les indices : « BUZZEZ ! » en néon rose qui pulse doucement, « dès que vous savez / qui je suis »,
 * et les équipes qui se sont trompées en étiquettes barrées. Pas de buzzer dessiné (cedric, 28/10).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AppelBuzzQuiSuis(dejaEssaye: List<String>, modifier: Modifier = Modifier) {
    val pulse by rememberInfiniteTransition(label = "buzzez").animateFloat(0.5f, 1f, infiniteRepeatable(tween(780), RepeatMode.Reverse), label = "p")
    Column(
        modifier.clip(RoundedCornerShape(20.dp)).background(Color(0x990E0622)).padding(horizontal = 18.dp, vertical = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            "BUZZEZ !", maxLines = 1, softWrap = false,
            style = TextStyle(fontFamily = PoliceGsTitre, fontSize = 46.sp, color = Color.White, shadow = Shadow(GS.Rose, Offset.Zero, 22f + 22f * pulse)),
        )
        Spacer(Modifier.height(10.dp))
        Text(
            "dès que vous savez\nqui je suis", textAlign = TextAlign.Center,
            style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 23.sp, lineHeight = 26.sp, color = GS.Encre),
        )
        if (dejaEssaye.isNotEmpty()) {
            Spacer(Modifier.height(22.dp))
            Text("Déjà essayé :", style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Color(0xFFC9C0F0)))
            Spacer(Modifier.height(8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                dejaEssaye.forEach { nom ->
                    Text(
                        nom, maxLines = 1, softWrap = false,
                        style = TextStyle(fontFamily = PoliceGsTitre, fontSize = 16.sp, color = GS.Encre, textDecoration = TextDecoration.LineThrough),
                        modifier = Modifier.graphicsLayer { rotationZ = -2.8f }
                            .clip(RoundedCornerShape(6.dp)).background(GS.Rose.copy(alpha = 0.18f)).border(1.5.dp, GS.Rose, RoundedCornerShape(6.dp))
                            .padding(horizontal = 10.dp, vertical = 3.dp),
                    )
                }
            }
        }
    }
}

/** Confettis légers qui tombent doucement derrière le jeu (une trentaine de petits rectangles, rien de lourd). */
@Composable
internal fun ConfettisLegers(modifier: Modifier = Modifier, nombre: Int = 36) {
    val t by rememberInfiniteTransition(label = "confettis").animateFloat(0f, 600f, infiniteRepeatable(tween(600_000, easing = LinearEasing)), label = "t")
    val couleurs = listOf(GS.Rose, GS.Cyan, GS.Jaune, GS.Juste, GS.Violet, GS.Orange)
    val graines = remember(nombre) {
        val r = java.util.Random(99)
        List(nombre) { floatArrayOf(r.nextFloat(), 20f + r.nextFloat() * 35f, r.nextFloat() * 10f, r.nextFloat()) }
    }
    Canvas(modifier.clearAndSetSemantics {}) {
        val d = density
        graines.forEachIndexed { i, (x0, v, ph, y0) ->
            val y = ((y0 * size.height + t * v * d) % (size.height + 20f * d)) - 10f * d
            val x = x0 * size.width + 15f * d * sin(t * 1.3f + ph)
            rotate(t * 115f + ph * 57f, Offset(x, y)) {
                val e = (kotlin.math.abs(sin(t * 3f + ph)) * 0.8f + 0.2f)
                drawRect(couleurs[i % couleurs.size], Offset(x - 3.5f * d, y - 2f * d * e), Size(7f * d, 4f * d * e), alpha = 0.75f)
            }
        }
    }
}
