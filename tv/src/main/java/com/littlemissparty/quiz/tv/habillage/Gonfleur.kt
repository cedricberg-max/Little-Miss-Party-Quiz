package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
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
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
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
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/*
 * Le Gonfleur fou : chaque équipe tapote sa tablette pour gonfler son ballon ; le premier qui éclate gagne.
 * L'habillage ne fait que montrer la progression que la partie lui donne (0 à 1 par équipe) et le gagnant.
 */

const val DEPART_GONFLEUR_MS = 3_200L
const val POINTS_GONFLEUR_GAGNANT = 300
const val POINTS_GONFLEUR_AUTRES = 150

private val jouerSonGonfleur: (Son) -> Unit = { Sons.executer(listOf(Ordre.Jouer(it))) }

private val styleGonfleur = TextStyle(fontFamily = PoliceLmp, lineHeight = 1.2.em, lineHeightStyle = LIGNE_LMP, fontWeight = FontWeight.ExtraBold)

/** Le départ (environ 3 s) : 3, 2, 1… « GONFLEZ ! ». [onFini] est appelé une fois, à la fin. */
@Composable
fun DepartGonfleur(onFini: () -> Unit, modifier: Modifier = Modifier, jouer: (Son) -> Unit = jouerSonGonfleur) {
    val fini by rememberUpdatedState(onFini)
    val joue by rememberUpdatedState(jouer)
    var etape by remember { mutableIntStateOf(0) }
    val t = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        for (k in 0..3) {
            etape = k
            joue(if (k < 3) Son.BIP else Son.BIP_FIN)
            t.snapTo(0f)
            t.animateTo(1f, tween(if (k < 3) 750 else 950, easing = LinearEasing))
        }
        fini()
    }
    Echelle(960.dp, 540.dp, modifier.fillMaxSize()) {
        val texte = if (etape < 3) "${3 - etape}" else "GONFLEZ !"
        Text(
            texte, maxLines = 1, textAlign = TextAlign.Center,
            modifier = Modifier.align(Alignment.Center).graphicsLayer {
                val u = t.value
                val s = if (u < 0.25f) 0.4f + 0.8f * (u / 0.25f) else 1.2f - 0.2f * ((u - 0.25f) / 0.75f)
                scaleX = s; scaleY = s
                alpha = if (u > 0.85f && etape < 3) 1f - (u - 0.85f) / 0.15f else 1f
            },
            style = styleGonfleur.copy(
                fontSize = if (etape < 3) 180.sp else 110.sp,
                color = if (etape < 3) Neon.OrClair else Color(0xFFFF8AC2),
                shadow = Shadow(if (etape < 3) Neon.Or.copy(alpha = 0.7f) else Neon.Halo, blurRadius = 40f),
            ),
        )
    }
}

/**
 * Les ballons, un par équipe (nom, couleur, progression de 0 à 1), sur leurs socles posés sur l'estrade.
 * Quand [gagnante] est donnée, son ballon éclate (« Les … gagnent ! », « +300 POINTS »), les autres équipes
 * affichent « +150 POINTS ».
 */
@Composable
fun SceneGonfleur(equipes: List<Triple<String, Color, Float>>, gagnante: Int?, modifier: Modifier = Modifier, jouer: (Son) -> Unit = jouerSonGonfleur) {
    val n = equipes.size.coerceAtLeast(1)
    val joue by rememberUpdatedState(jouer)
    // Petit « pfff » de gonflage chaque fois que le ballon de tête franchit un palier.
    val tete = equipes.maxOfOrNull { it.third } ?: 0f
    val palier = (tete * 8f).toInt().coerceIn(0, 7)
    LaunchedEffect(palier) {
        if (palier > 0 && gagnante == null) joue(if (palier < 3) Son.GONFLE_1 else if (palier < 6) Son.GONFLE_2 else Son.GONFLE_3)
    }
    val eclat = remember(gagnante) { Animatable(0f) }
    LaunchedEffect(gagnante) {
        if (gagnante == null) return@LaunchedEffect
        joue(Son.BALLON_ECLATE)
        eclat.animateTo(1f, tween(1_600, easing = LinearEasing))
    }
    val temps = remember { Animatable(0f) }
    LaunchedEffect(Unit) { while (true) temps.animateTo(temps.value + 10_000f, tween(10_000, easing = LinearEasing)) }
    val fente = 860f / n
    val rMax = min(fente * 0.44f, 118f)
    Echelle(960.dp, 540.dp, modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().clearAndSetSemantics {}.drawWithCache { onDrawBehind { estradeGonfleur() } })
        equipes.forEachIndexed { i, (nom, couleur, progres) ->
            val p by animateFloatAsState(progres.coerceIn(0f, 1f), tween(260), label = "ballon$i")
            val cx = 50f + fente * (i + 0.5f)
            val gagne = gagnante == i
            Canvas(Modifier.fillMaxSize().clearAndSetSemantics {}) {
                val d = density
                val socleHaut = 452f * d
                // Socle lesté (laiton et laque) posé sur l'estrade, avec son ombre.
                socle(cx * d, socleHaut, min(fente * 0.36f, 56f) * d, couleur)
                val e = eclat.value
                if (gagne && e > 0.12f) {
                    // Le ballon a éclaté : lambeaux de caoutchouc et ficelle qui retombe.
                    morceaux(Offset(cx * d, ballonCentre(p, rMax) * d), rMax * d, couleur, (e - 0.12f) / 0.88f, i)
                    return@Canvas
                }
                val r = (26f + (rMax - 26f) * p) * (if (gagne) 1f + 0.12f * (e / 0.12f) else 1f) * d
                val tremble = if (p > 0.82f && gagnante == null) (p - 0.82f) / 0.18f else 0f
                val ms = temps.value
                val balance = 3f * sin(ms / 900f + i * 1.3f) + 4f * tremble * sin(ms / 45f + i)
                val c = Offset(cx * d, ballonCentre(p, rMax) * d)
                // Ficelle du socle au nœud.
                val noeud = Offset(c.x, c.y + r * 1.12f)
                val ficelle = Path().apply {
                    moveTo(cx * d, socleHaut - 8f * d)
                    cubicTo(cx * d + 8f * d * sin(ms / 700f + i), (socleHaut + noeud.y) / 2, noeud.x - 6f * d, noeud.y + 20f * d, noeud.x, noeud.y)
                }
                drawPath(ficelle, Color(0xFFF6EBDC).copy(alpha = 0.85f), style = Stroke(1.6f * d))
                rotate(balance, noeud) { ballon(c, r, couleur, p, tremble) }
            }
            // Nom de l'équipe sur le socle ; points à la fin.
            Column(
                Modifier.offset(x = (cx - fente / 2).dp, y = 478.dp).width(fente.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    nom, maxLines = if (n > 5) 2 else 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 3.dp).background(Neon.Nuit2.copy(alpha = 0.9f), RoundedCornerShape(if (n > 5) 12.dp else 50.dp))
                        .border(2.dp, couleur, RoundedCornerShape(if (n > 5) 12.dp else 50.dp)).padding(horizontal = if (n > 5) 6.dp else 10.dp, vertical = 2.dp),
                    style = styleGonfleur.copy(fontSize = if (n > 5) 12.sp else 17.sp, lineHeight = 1.1.em, color = Neon.Blanc),
                )
            }
            if (gagnante != null && !gagne) {
                Text(
                    texteValeur(POINTS_GONFLEUR_AUTRES) + " POINTS", maxLines = 1, softWrap = false,
                    modifier = Modifier.offset(x = (cx - fente / 2).dp, y = (ballonCentre(p, rMax) - 14f).dp).width(fente.dp)
                        .wrapContentWidth()
                        .graphicsLayer { alpha = ((eclat.value - 0.4f) / 0.3f).coerceIn(0f, 1f) }
                        .background(Neon.Nuit2.copy(alpha = 0.85f), RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp),
                    textAlign = TextAlign.Center,
                    style = styleGonfleur.copy(fontSize = if (n > 5) 13.sp else 20.sp, color = Neon.JusteClair),
                )
            }
        }
        if (gagnante != null) {
            val (nom, couleur, _) = equipes[gagnante.coerceIn(0, equipes.lastIndex)]
            Gerbe(cle = gagnante, actif = true)
            Column(
                Modifier.align(Alignment.TopCenter).padding(top = 30.dp).graphicsLayer {
                    val u = ((eclat.value - 0.15f) / 0.3f).coerceIn(0f, 1f)
                    alpha = if (u <= 0f) 0f else 1f
                    val s = 0.6f + 0.4f * u; scaleX = s; scaleY = s
                },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    "$nom gagnent !", maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.background(Neon.Nuit2.copy(alpha = 0.9f), RoundedCornerShape(50)).border(3.dp, couleur, RoundedCornerShape(50))
                        .padding(horizontal = 26.dp, vertical = 6.dp),
                    style = styleGonfleur.copy(fontSize = 34.sp, color = couleur),
                )
                Text(
                    texteValeur(POINTS_GONFLEUR_GAGNANT) + " POINTS", maxLines = 1,
                    style = styleGonfleur.copy(fontSize = 58.sp, color = Neon.JusteClair, shadow = Shadow(Color.Black.copy(alpha = 0.7f), Offset(0f, 4f), 16f)),
                )
            }
        } else {
            Text(
                "Tapez vite sur la tablette !", maxLines = 1,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 16.dp)
                    .background(Neon.Nuit2.copy(alpha = 0.88f), RoundedCornerShape(50)).border(2.5.dp, Neon.Or, RoundedCornerShape(50))
                    .padding(horizontal = 26.dp, vertical = 6.dp),
                style = styleGonfleur.copy(fontSize = 26.sp, color = Neon.OrClair),
            )
        }
    }
}

/** Centre du ballon (dp) : il monte en grossissant, sa ficelle reste attachée au socle. */
private fun ballonCentre(p: Float, rMax: Float): Float {
    val r = 26f + (rMax - 26f) * p
    return 360f - 40f * p - r * 0.3f
}

private fun DrawScope.estradeGonfleur() {
    val d = density
    val haut = 452f * d
    val avant = 470f * d
    drawPath(
        Path().apply { moveTo(40f * d, haut); lineTo(size.width - 40f * d, haut); lineTo(size.width - 10f * d, avant); lineTo(10f * d, avant); close() },
        Brush.verticalGradient(listOf(Color(0xFF55297F), Color(0xFF41206A)), haut, avant),
    )
    drawRect(Brush.verticalGradient(listOf(Color(0xFF2A1244), Color(0xFF190A2C)), avant, size.height), Offset(10f * d, avant), Size(size.width - 20f * d, size.height - avant))
    drawRect(Brush.verticalGradient(listOf(Neon.Halo.copy(alpha = 0.22f), Color.Transparent), avant, avant + 16f * d), Offset(10f * d, avant), Size(size.width - 20f * d, 16f * d))
    drawLine(Neon.Or.copy(alpha = 0.85f), Offset(10f * d, avant), Offset(size.width - 10f * d, avant), 2f * d)
}

private fun DrawScope.socle(cx: Float, haut: Float, demi: Float, couleur: Color) {
    val d = density
    drawOval(Brush.radialGradient(listOf(Color.Black.copy(alpha = 0.55f), Color.Transparent)), Offset(cx - demi * 1.25f, haut + 6f * d), Size(demi * 2.5f, 14f * d))
    drawRoundRect(Brush.verticalGradient(listOf(Color(0xFF4A2470), Color(0xFF241038)), haut - 16f * d, haut + 12f * d), Offset(cx - demi, haut - 16f * d), Size(demi * 2, 28f * d), CornerRadius(8f * d))
    drawRoundRect(Neon.Or, Offset(cx - demi, haut - 16f * d), Size(demi * 2, 28f * d), CornerRadius(8f * d), style = Stroke(2f * d))
    drawRoundRect(couleur.copy(alpha = 0.8f), Offset(cx - demi * 0.7f, haut - 6f * d), Size(demi * 1.4f, 4f * d), CornerRadius(2f * d))
    // Anneau de laiton où la ficelle est nouée.
    drawCircle(Brush.radialGradient(listOf(Color(0xFFFFF3D1), Color(0xFFA8782F)), Offset(cx, haut - 18f * d), 6f * d), 5f * d, Offset(cx, haut - 18f * d))
}

/** Un ballon brillant de la couleur de l'équipe ; il pâlit et se tend en approchant de l'éclatement. */
private fun DrawScope.ballon(c: Offset, r: Float, couleur: Color, p: Float, tremble: Float) {
    val tendu = lerp(couleur, Color.White, 0.18f * p)
    val corps = Path().apply {
        moveTo(c.x, c.y + r * 1.08f)
        cubicTo(c.x - r * 0.9f, c.y + r * 0.85f, c.x - r * 1.05f, c.y - r * 0.2f, c.x - r * 0.9f, c.y - r * 0.6f)
        cubicTo(c.x - r * 0.65f, c.y - r * 1.15f, c.x + r * 0.65f, c.y - r * 1.15f, c.x + r * 0.9f, c.y - r * 0.6f)
        cubicTo(c.x + r * 1.05f, c.y - r * 0.2f, c.x + r * 0.9f, c.y + r * 0.85f, c.x, c.y + r * 1.08f)
        close()
    }
    drawCircle(Brush.radialGradient(listOf(couleur.copy(alpha = 0.35f + 0.25f * tremble), Color.Transparent), c, r * 1.6f), r * 1.6f, c)
    drawPath(corps, Brush.radialGradient(listOf(lerp(tendu, Color.White, 0.55f), tendu, lerp(couleur, Color.Black, 0.35f)), c - Offset(r * 0.35f, r * 0.4f), r * 1.5f))
    drawPath(corps, Color.Black.copy(alpha = 0.18f), style = Stroke(1.5f * density))
    drawOval(Color.White.copy(alpha = 0.55f), c - Offset(r * 0.6f, r * 0.75f), Size(r * 0.38f, r * 0.55f))
    drawCircle(Color.White.copy(alpha = 0.7f), r * 0.06f, c + Offset(-r * 0.22f, -r * 0.82f))
    // Nœud.
    val n = c + Offset(0f, r * 1.08f)
    drawPath(Path().apply { moveTo(n.x - r * 0.09f, n.y + r * 0.1f); lineTo(n.x + r * 0.09f, n.y + r * 0.1f); lineTo(n.x, n.y - r * 0.02f); close() }, lerp(couleur, Color.Black, 0.25f))
}

/** Le ballon vient d'éclater : lambeaux qui s'envolent en tournant, petit anneau de souffle. */
private fun DrawScope.morceaux(c: Offset, r: Float, couleur: Color, u: Float, graine: Int) {
    val d = density
    if (u < 0.5f) drawCircle(Color.White.copy(alpha = 0.7f * (1f - u / 0.5f)), r * (0.6f + 1.6f * u), c, style = Stroke(6f * d * (1f - u)))
    val rnd = java.util.Random(graine * 977L + 5)
    for (k in 0 until 14) {
        val a = rnd.nextFloat() * 2f * PI.toFloat()
        val v = (0.8f + rnd.nextFloat()) * r * 1.6f
        val x = c.x + cos(a) * v * u
        val y = c.y + sin(a) * v * u + 220f * d * u * u
        val taille = (5f + 7f * rnd.nextFloat()) * d
        rotate(rnd.nextFloat() * 360f + u * 540f, Offset(x, y)) {
            drawOval(couleur.copy(alpha = (1f - u * 0.8f).coerceIn(0f, 1f)), Offset(x - taille, y - taille * 0.5f), Size(taille * 2, taille))
        }
    }
    // La ficelle retombe mollement.
    val bas = c.y + r * 1.1f + 60f * d * u
    drawLine(Color(0xFFF6EBDC).copy(alpha = 0.8f * (1f - u)), Offset(c.x, bas - 40f * d), Offset(c.x + 10f * d * sin(u * 8f), bas), 1.6f * d, StrokeCap.Round)
}
