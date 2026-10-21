package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/*
 * « Ça va exploser ! » : la bombe passe d'équipe en équipe, sa mèche brûle sans qu'on sache quand elle explosera.
 * L'habillage montre qui l'a, fait monter la tension (mèche, tic-tac qui accélère et forcit, lueur rouge) et
 * joue l'explosion. Le moment de l'explosion et les points sont décidés par la partie, jamais par l'écran.
 */

private val jouerSonPatate: (Son) -> Unit = { Sons.executer(listOf(Ordre.Jouer(it))) }

private val stylePatate = TextStyle(fontFamily = PoliceLmp, lineHeight = 1.2.em, lineHeightStyle = LIGNE_LMP, fontWeight = FontWeight.ExtraBold)

/** Place du socle de l'équipe [i] sur [n] : en arc, celles du milieu un peu plus loin (plus haut, plus petites) ; arc plus plat et socles plus petits au-delà de 5 équipes. */
private fun placePatate(i: Int, n: Int): Triple<Float, Float, Float> {
    val f = (i + 0.5f) / n
    val arc = sin(PI.toFloat() * f)
    val k = when { n <= 4 -> 1.4f; n <= 6 -> 1.15f; else -> 0.9f }
    val creux = if (n <= 5) 110f else 64f
    return Triple(90f + 780f * f, 462f - creux * arc, k * (1f - 0.2f * arc))
}

/** La mèche montrée : elle raccourcit avec la tension, mais pas régulièrement, pour que l'explosion reste une surprise. */
private fun mecheMontree(tension: Float): Float {
    val t = tension.coerceIn(0f, 1f)
    return (1f - (t + 0.05f * sin(t * 23f) + 0.03f * sin(t * 61f)) * 0.92f).coerceIn(0.06f, 1f)
}

/**
 * La bombe chez l'équipe [porteur]. [precedent] : l'équipe qui vient de l'envoyer ; [tension] : de 0 (début) à 1
 * (explosion imminente), d'après le temps écoulé ; [explosion] : la bombe explose chez le porteur, qui perd
 * [pointsPerdus] (affiché s'il est donné). [neuves] : les équipes que la bombe n'a pas encore touchées, qui scintillent.
 */
@Composable
fun ScenePatate(
    equipes: List<Pair<String, Color>>, porteur: Int, precedent: Int?, tension: Float, explosion: Boolean,
    pointsPerdus: Int? = null, modifier: Modifier = Modifier, neuves: Set<Int> = emptySet(), jouer: (Son) -> Unit = jouerSonPatate,
) {
    val n = equipes.size.coerceAtLeast(1)
    val p = porteur.coerceIn(0, n - 1)
    val joue by rememberUpdatedState(jouer)
    val tens by rememberUpdatedState(tension.coerceIn(0f, 1f))
    // Le vol de la bombe d'un socle à l'autre, à chaque passe.
    var depart by remember { mutableIntStateOf(p) }
    val vol = remember { Animatable(1f) }
    LaunchedEffect(p) {
        if (depart != p) {
            joue(Son.PATATE_PASSE)
            vol.snapTo(0f)
            vol.animateTo(1f, tween(600, easing = LinearEasing))
        }
        depart = p
    }
    // Tic-tac de plus en plus rapide et de plus en plus fort ; la bombe bat au même rythme.
    val pouls = remember { Animatable(0f) }
    LaunchedEffect(explosion) {
        if (explosion) return@LaunchedEffect
        while (true) {
            val t = tens
            delay((950f - 720f * t).toLong())
            joue(if (t < 0.4f) Son.TIC_1 else if (t < 0.75f) Son.TIC_2 else Son.TIC_3)
            pouls.snapTo(1f)
            pouls.animateTo(0f, tween(220, easing = LinearEasing))
        }
    }
    val boum = remember { Animatable(0f) }
    LaunchedEffect(explosion) {
        if (!explosion) { boum.snapTo(0f); return@LaunchedEffect }
        joue(Son.BOMBE_BOUM)
        boum.animateTo(1f, tween(1_500, easing = LinearEasing))
    }
    val annonce = remember(p) { Animatable(0f) }
    LaunchedEffect(p) { delay(450); annonce.animateTo(1f, tween(420, easing = LinearEasing)) }
    val temps = remember { Animatable(0f) }
    LaunchedEffect(Unit) { while (true) temps.animateTo(temps.value + 10_000f, tween(10_000, easing = LinearEasing)) }

    Box(modifier.fillMaxSize()) {
    // Lueur chaude qui grandit avec la tension et bat avec le tic-tac, seulement sur les bords de tout l'écran : dessinée
    // hors du calque de la scène (qui la couperait en rectangle), elle déborde jusqu'aux bords de la TV ; le violet du
    // plateau reste intact au centre, sans voile rose (cedric, 20 octobre).
    Canvas(Modifier.matchParentSize().clearAndSetSemantics {}) {
        val rouge = if (explosion) 0.4f * (1f - boum.value) else 0.35f * tens * tens * (0.6f + 0.4f * pouls.value)
        if (rouge > 0.01f) {
            drawRect(
                Brush.radialGradient(0.6f to Color.Transparent, 1f to Neon.Chaud.copy(alpha = rouge), center = Offset(size.width / 2, size.height / 2), radius = size.width * 0.72f),
                Offset(-0.2f * size.width, -0.25f * size.height), androidx.compose.ui.geometry.Size(size.width * 1.4f, size.height * 1.6f),
            )
        }
    }
    Echelle(960.dp, 540.dp, Modifier.fillMaxSize().graphicsLayer {
        // La TV tremble au moment du BOUM.
        val sec = if (explosion) (1f - boum.value / 0.3f).coerceIn(0f, 1f) else 0f
        translationX = sec * 14f * density * sin(boum.value * 140f)
        translationY = sec * 9f * density * cos(boum.value * 170f)
    }) {
        Canvas(Modifier.fillMaxSize().clearAndSetSemantics {}) {
            val d = density
            val ms = temps.value
            val b = boum.value
            // Une poursuite de scène suit la bombe d'un socle à l'autre.
            if (!explosion) {
                val (xa, ya, sa) = placePatate(depart.coerceIn(0, n - 1), n)
                val (xb, yb, sb) = placePatate(p, n)
                val u = vol.value
                val px = (xa + (xb - xa) * u) * d
                val py = (ya + (yb - ya) * u) * d
                val ps = sa + (sb - sa) * u
                val teinte = lerp(equipes[depart.coerceIn(0, n - 1)].second, equipes[p].second, u)
                val cone = Path().apply {
                    moveTo(px - 26f * d, 0f); lineTo(px + 26f * d, 0f)
                    lineTo(px + 95f * ps * d, py); lineTo(px - 95f * ps * d, py); close()
                }
                drawPath(cone, Brush.verticalGradient(listOf(Color.White.copy(alpha = 0f), teinte.copy(alpha = 0.10f), Color.White.copy(alpha = 0.16f)), 0f, py))
            }
            // Socles en arc, laqués et bordés d'or.
            for (i in 0 until n) {
                val (x, y, s) = placePatate(i, n)
                // Équipe pas encore touchée : halo doré qui respire et petites étoiles qui scintillent.
                val brille = i in neuves && i != p && !explosion
                if (brille) {
                    val r = 0.55f + 0.45f * sin(ms / 420f + i * 1.7f)
                    drawOval(Brush.radialGradient(listOf(Neon.OrClair.copy(alpha = 0.38f * r), Color.Transparent)), Offset((x - 82f * s) * d, (y - 30f * s) * d), androidx.compose.ui.geometry.Size(164f * s * d, 60f * s * d))
                }
                estradeRonde(x * d, y * d, 50f * s * d, 13f * s * d, 15f * s * d)
                if (brille) for (k in 0 until 3) {
                    val ph = ((ms / 1_300f + i * 0.37f + k / 3f) % 1f)
                    val a = sin(ph * PI.toFloat())
                    val c = Offset((x + (k - 1) * 30f * s + 6f * sin(i + k * 2f)) * d, (y - (24f + 34f * ph + 10f * (k % 2)) * s) * d)
                    // Étoile scintillante à quatre branches fines (✦), comme celles de la pause : plus de « + ».
                    val l = (5f + 6f * a) * s * d
                    drawCircle(Brush.radialGradient(listOf(Neon.OrClair.copy(alpha = 0.4f * a), Color.Transparent), c, l * 1.6f), l * 1.6f, c)
                    drawPath(etoileFine(c, l), Neon.OrClair.copy(alpha = a))
                    drawCircle(Color.White.copy(alpha = a), 1.2f * d, c)
                }
                if (i == p && !explosion) drawOval(Brush.radialGradient(listOf(equipes[i].second.copy(alpha = 0.45f), Color.Transparent)), Offset((x - 90f * s) * d, (y - 26f * s) * d), androidx.compose.ui.geometry.Size(180f * s * d, 52f * s * d))
            }
            // La bombe : posée sur le socle du porteur, ou en vol entre deux socles.
            if (!explosion || b < 0.08f) {
                val (x1, y1, s1) = placePatate(p, n)
                val (x0, y0, s0) = placePatate(depart.coerceIn(0, n - 1), n)
                val u = vol.value
                val s = s0 + (s1 - s0) * u
                val r = 44f * s * d
                val x = (x0 + (x1 - x0) * u) * d
                val sol = (y0 + (y1 - y0) * u) * d
                val haut = 80f * d * sin(PI.toFloat() * u)
                drawOval(Brush.radialGradient(listOf(Color.Black.copy(alpha = 0.55f * (1f - 0.7f * sin(PI.toFloat() * u))), Color.Transparent)), Offset(x - r * 1.1f, sol - 6f * d), androidx.compose.ui.geometry.Size(r * 2.2f, 12f * d))
                val gonfle = 1f + 0.09f * pouls.value
                dessineBombe(Offset(x, sol - r * gonfle - haut), r * gonfle, ms, 0.55f)
            }
            if (!explosion) {
                // La grande mèche : elle brûle de droite à gauche vers la bombe, sans dire quand elle arrivera.
                val y = 92f * d
                val x0 = 132f * d
                val x1 = 846f * d
                val reste = mecheMontree(tens)
                val bout = x0 + (x1 - x0) * reste
                val corde = Path().apply {
                    moveTo(x0, y)
                    var x = x0
                    while (x < bout) { x += 6f * d; lineTo(x.coerceAtMost(bout), y + 3f * d * sin(x / (14f * d))) }
                }
                drawLine(Color(0xFF3A2E48), Offset(bout, y), Offset(x1, y), 3f * d, StrokeCap.Round)
                drawPath(corde, Color(0xFFE8D8B8), style = Stroke(7f * d, cap = StrokeCap.Round))
                drawPath(corde, Color(0xFF9A8460), style = Stroke(7f * d, cap = StrokeCap.Round, pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(5f * d, 8f * d))))
                val e = Offset(bout, y + 3f * d * sin(bout / (14f * d)))
                val vibre = 0.75f + 0.25f * sin(ms / 37f)
                drawCircle(Brush.radialGradient(listOf(Color(0xFFFFF6C8), Color(0xFFFFB347).copy(alpha = 0.7f), Color.Transparent), e, 26f * d * vibre), 26f * d * vibre, e)
                for (k in 0 until 8) {
                    val a = k * (2f * PI.toFloat() / 8f) + ms / 110f
                    val lg = (10f + 9f * abs(sin(ms / 47f + k))) * d
                    drawLine(Color(0xFFFFE9A0), e, e + Offset(cos(a) * lg, sin(a) * lg), 2f * d, StrokeCap.Round)
                }
                dessineBombe(Offset(104f * d, y + 6f * d), 26f * d, ms, 0f)
            } else {
                // BOUM chez le porteur : boule de feu, onde de choc, fumée, éclair blanc.
                val (x, y, s) = placePatate(p, n)
                val c = Offset(x * d, (y - 40f * s) * d)
                val feu = (1f - b / 0.4f).coerceIn(0f, 1f)
                if (feu > 0f) drawCircle(Brush.radialGradient(listOf(Color(0xFFFFF6C8), Color(0xFFFFB347), Color(0xFFFF5A8A).copy(alpha = 0.7f), Color.Transparent), c, (90f + 260f * b) * d), (90f + 260f * b) * d, c, alpha = feu)
                for (k in 0..1) {
                    val sk = b - k * 0.08f
                    if (sk in 0f..0.6f) drawCircle(lerp(Color(0xFFFFB347), Neon.Halo, k.toFloat()).copy(alpha = 0.8f * (1f - sk / 0.6f)), (50f + 900f * sk) * d, c, style = Stroke((10f - 12f * sk) * d))
                }
                for (k in 0 until 8) {
                    val a = -PI.toFloat() / 2 + (k - 3.5f) * 0.35f
                    val f = Offset(c.x + cos(a) * 110f * b * d, c.y + sin(a) * 90f * b * d - 40f * b * d)
                    drawCircle(Color(0xFF3A2E48).copy(alpha = (0.75f - 0.5f * b).coerceIn(0f, 1f)), (28f + 10f * (k % 3)) * d * (0.5f + b), f)
                }
                // Éclats dorés projetés tout autour.
                if (b < 0.7f) for (k in 0 until 18) {
                    val a = k * (2f * PI.toFloat() / 18f) + 0.3f * sin(k * 7f)
                    val v = (220f + 140f * abs(sin(k * 3.1f))) * d
                    val q = b / 0.7f
                    val pos = Offset(c.x + cos(a) * v * q, c.y + sin(a) * v * q + 160f * d * q * q)
                    drawCircle(Color(0xFFFFE9A0).copy(alpha = 1f - q), (5f - 3f * q) * d, pos)
                }
                val eclair = (1f - b / 0.22f).coerceIn(0f, 1f)
                if (eclair > 0f) drawRect(Color.White.copy(alpha = eclair * 0.95f))
            }
        }
        // Les noms sous les socles ; l'équipe qui vient d'envoyer la bombe est signalée.
        equipes.forEachIndexed { i, (nom, couleur) ->
            val (x, y, s) = placePatate(i, n)
            val larg = (780f / n - 6f).coerceAtMost(200f)
            Column(Modifier.offset(x = (x - larg / 2).dp, y = (y + 22f * s).dp).width(larg.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    nom, maxLines = if (n > 5) 2 else 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                    modifier = Modifier.background(Neon.Nuit2.copy(alpha = 0.9f), RoundedCornerShape(12.dp))
                        .border(if (i == p) 3.dp else 2.dp, couleur, RoundedCornerShape(12.dp)).padding(horizontal = 8.dp, vertical = 2.dp),
                    style = stylePatate.copy(fontSize = if (n > 5) 12.sp else 16.sp, lineHeight = 1.1.em, color = Neon.Blanc),
                )
                if (i == precedent && i != p && !explosion) {
                    Text("vient de l'envoyer", maxLines = 2, textAlign = TextAlign.Center, style = stylePatate.copy(fontSize = 12.sp, lineHeight = 1.05.em, color = Neon.Blanc.copy(alpha = 0.6f)))
                }
            }
        }
        val (nomP, couleurP) = equipes[p]
        if (!explosion) {
            Row(
                Modifier.align(Alignment.TopCenter).padding(top = 136.dp).widthIn(max = 820.dp)
                    .graphicsLayer {
                        val u = annonce.value
                        alpha = if (u <= 0f) 0f else 1f
                        val sc = if (u <= 0f) 0.5f else rebondSortie(u)
                        scaleX = sc; scaleY = sc
                    }
                    .background(Neon.Nuit2.copy(alpha = 0.9f), RoundedCornerShape(50)).border(3.dp, couleurP, RoundedCornerShape(50))
                    .padding(horizontal = 26.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                Text("La bombe est chez ", maxLines = 1, softWrap = false, style = stylePatate.copy(fontSize = 30.sp, color = Neon.Blanc))
                Text(nomP, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false), style = stylePatate.copy(fontSize = 30.sp, color = couleurP))
                Text(" !", maxLines = 1, softWrap = false, style = stylePatate.copy(fontSize = 30.sp, color = Neon.Blanc))
            }
        } else {
            Column(
                Modifier.align(Alignment.TopCenter).padding(top = 40.dp).graphicsLayer {
                    val u = ((boum.value - 0.1f) / 0.25f).coerceIn(0f, 1f)
                    alpha = if (u <= 0f) 0f else 1f
                    val sc = if (u <= 0f) 0.5f else rebondSortie(u); scaleX = sc; scaleY = sc
                },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("BOUM !", maxLines = 1, style = stylePatate.copy(fontSize = 80.sp, color = Color(0xFFFFB347), shadow = Shadow(Color.Black.copy(alpha = 0.6f), Offset(0f, 4f), 14f)))
                Text(
                    "La bombe a explosé chez $nomP !", maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.background(Neon.Nuit2.copy(alpha = 0.9f), RoundedCornerShape(50)).border(3.dp, couleurP, RoundedCornerShape(50)).padding(horizontal = 24.dp, vertical = 5.dp),
                    style = stylePatate.copy(fontSize = 30.sp, color = couleurP),
                )
                if (pointsPerdus != null) {
                    Text(
                        texteValeur(pointsPerdus) + " POINTS", maxLines = 1,
                        style = stylePatate.copy(fontSize = 54.sp, color = Color(0xFFFF5A5F), shadow = Shadow(Color.Black.copy(alpha = 0.7f), Offset(0f, 4f), 16f)),
                    )
                }
            }
        }
    }
    }
}

/** Étoile à quatre branches fines (✦) : pointes longues, cœur étroit. */
private fun etoileFine(c: Offset, r: Float) = androidx.compose.ui.graphics.Path().apply {
    val creux = r * 0.18f
    moveTo(c.x, c.y - r)
    quadraticBezierTo(c.x + creux, c.y - creux, c.x + r, c.y)
    quadraticBezierTo(c.x + creux, c.y + creux, c.x, c.y + r)
    quadraticBezierTo(c.x - creux, c.y + creux, c.x - r, c.y)
    quadraticBezierTo(c.x - creux, c.y - creux, c.x, c.y - r)
    close()
}
