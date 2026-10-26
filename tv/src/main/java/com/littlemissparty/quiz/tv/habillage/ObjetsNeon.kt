package com.littlemissparty.quiz.tv.habillage

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/*
 * Objets de néon du Game Show, d'après les maquettes 3D validées par cedric (nuit du 23 au 24 octobre) :
 * l'anneau posé au sol (Gonfleur fou, Ça va exploser !) et la bombe à cage de néon (Ça va exploser !).
 */

/** Anneau de néon posé au sol : dessus noir, tranche sombre aux petites lampes, liseré de la couleur de l'équipe. */
internal fun DrawScope.anneauNeon(cx: Float, y: Float, rx: Float, couleur: Color, ms: Float, ep: Float = 9f * density) {
    val d = density
    val ry = rx * 0.27f
    drawOval(Brush.radialGradient(listOf(couleur.copy(alpha = 0.32f), Color.Transparent), Offset(cx, y + ep), rx * 1.5f), Offset(cx - rx * 1.5f, y - ry * 1.4f), Size(rx * 3f, ry * 2.8f + ep * 2f))
    val tranche = Path().apply {
        moveTo(cx - rx, y); lineTo(cx - rx, y + ep)
        arcTo(Rect(cx - rx, y + ep - ry, cx + rx, y + ep + ry), 180f, -180f, false)
        lineTo(cx + rx, y); close()
    }
    drawPath(tranche, Brush.verticalGradient(listOf(Color(0xFF1C1236), Color(0xFF07040F)), y, y + ep + ry))
    // Petites lampes sur la tranche, qui scintillent doucement.
    for (k in 0 until 9) {
        val a = PI.toFloat() * (k + 0.5f) / 9f
        val x = cx - rx * cos(a)
        val yy = y + ep * 0.55f + ry * sin(a)
        val v = 0.45f + 0.55f * (0.5f + 0.5f * sin(ms / 260f + k * 1.7f))
        drawLine(couleur.copy(alpha = v), Offset(x, yy - 2.2f * d), Offset(x, yy + 2.2f * d), 1.6f * d, StrokeCap.Round)
    }
    drawArc(couleur.copy(alpha = 0.7f), 0f, 180f, false, Offset(cx - rx, y + ep - ry), Size(rx * 2, ry * 2), style = Stroke(1.6f * d))
    drawOval(Brush.radialGradient(listOf(Color(0xFF020106), Color(0xFF0C0818), Color(0xFF1E1638)), Offset(cx, y), rx), Offset(cx - rx, y - ry), Size(rx * 2, ry * 2))
    // Liseré : halo, tube, filament ; deux reflets de néon qui glissent sur l'anneau.
    drawOval(couleur.copy(alpha = 0.35f), Offset(cx - rx, y - ry), Size(rx * 2, ry * 2), style = Stroke(6f * d))
    drawOval(couleur, Offset(cx - rx, y - ry), Size(rx * 2, ry * 2), style = Stroke(2.4f * d))
    drawOval(Color.White.copy(alpha = 0.7f), Offset(cx - rx, y - ry), Size(rx * 2, ry * 2), style = Stroke(0.8f * d))
    val tour = (ms / 22f) % 360f
    drawArc(GS.Cyan.copy(alpha = 0.9f), tour, 40f, false, Offset(cx - rx, y - ry), Size(rx * 2, ry * 2), style = Stroke(2.2f * d, cap = StrokeCap.Round))
    drawArc(GS.Rose.copy(alpha = 0.9f), tour + 180f, 32f, false, Offset(cx - rx, y - ry), Size(rx * 2, ry * 2), style = Stroke(2.2f * d, cap = StrokeCap.Round))
}

/**
 * La bombe à cage de néon : boule laquée sombre, ceinture et méridiens de néon cyan aux lampes roses, culot aux
 * lampes, mèche en tube de néon dont il reste [meche] (0..1) et son étincelle. [chauffe] (0..1) : elle rougit en
 * approchant de l'explosion.
 */
internal fun DrawScope.bombeNeon(c: Offset, r: Float, t: Float, meche: Float, chauffe: Float = 0f, etincelle: Boolean = true) {
    val rouge = Color(0xFFFF2A4A)
    val trait = lerp(GS.Cyan, Color(0xFFFF6A8A), chauffe)
    val lampe = lerp(GS.Rose, Color(0xFFFFD34A), chauffe)
    drawCircle(Brush.radialGradient(listOf(trait.copy(alpha = 0.28f), Color.Transparent), c, r * 1.6f), r * 1.6f, c)
    drawCircle(
        Brush.radialGradient(listOf(lerp(Color(0xFF5A6488), rouge, chauffe * 0.8f), lerp(Color(0xFF1C2036), Color(0xFF5A0A1A), chauffe), Color(0xFF07080F)), c - Offset(r * 0.35f, r * 0.45f), r * 1.55f),
        r, c,
    )
    // Méridiens (ellipses verticales) puis la ceinture, en néon : halo, tube, filament.
    fun neon(dessin: (Color, Float) -> Unit) {
        dessin(trait.copy(alpha = 0.35f), r * 0.11f)
        dessin(trait, r * 0.045f)
        dessin(Color.White.copy(alpha = 0.7f), r * 0.015f)
    }
    for (k in listOf(0.38f, 0.82f)) neon { col, ep -> drawArc(col, 90f, 180f, false, Offset(c.x - r * k, c.y - r), Size(2 * r * k, 2 * r), style = Stroke(ep)) }
    for (k in listOf(0.38f, 0.82f)) neon { col, ep -> drawArc(col, -90f, 180f, false, Offset(c.x - r * k, c.y - r), Size(2 * r * k, 2 * r), style = Stroke(ep)) }
    neon { col, ep -> drawArc(col, 0f, 180f, false, Offset(c.x - r, c.y - r * 0.3f), Size(2 * r, r * 0.6f), style = Stroke(ep * 1.3f)) }
    // Lampes de la ceinture, qui clignotent en vague.
    for (k in 0 until 11) {
        val a = PI.toFloat() * (k + 0.5f) / 11f
        val p = Offset(c.x + r * cos(a), c.y + r * 0.3f * sin(a))
        val v = 0.5f + 0.5f * sin(t / 140f - k * 0.8f)
        drawCircle(lampe.copy(alpha = 0.35f * v), r * 0.08f, p)
        drawCircle(lerp(lampe, Color.White, 0.5f).copy(alpha = 0.6f + 0.4f * v), r * 0.032f, p)
    }
    // Reflet laqué.
    drawOval(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.55f), Color.Transparent), c - Offset(r * 0.42f, r * 0.55f), r * 0.32f), c - Offset(r * 0.72f, r * 0.78f), Size(r * 0.6f, r * 0.45f))
    // Culot : petit cylindre sombre bordé de lampes.
    val culot = Rect(c.x - r * 0.3f, c.y - r * 1.16f, c.x + r * 0.3f, c.y - r * 0.9f)
    drawRect(Brush.horizontalGradient(listOf(Color(0xFF151A2E), Color(0xFF4A5276), Color(0xFF151A2E)), culot.left, culot.right), culot.topLeft, culot.size)
    drawOval(Color(0xFF2A3050), Offset(culot.left, culot.top - r * 0.07f), Size(culot.width, r * 0.14f))
    drawOval(lampe, Offset(culot.left, culot.top - r * 0.07f), Size(culot.width, r * 0.14f), style = Stroke(r * 0.03f))
    for (k in 0 until 4) drawCircle(lerp(lampe, Color.White, 0.4f), r * 0.03f, Offset(culot.left + culot.width * (k + 0.5f) / 4f, culot.bottom - r * 0.05f))
    if (meche <= 0f) return
    // Mèche en tube de néon, courbée vers la droite.
    val depart = Offset(c.x, culot.top - r * 0.04f)
    val chemin = Path()
    var bout = depart
    for (s in 0..18) {
        val f = s / 18f * meche
        val p = depart + Offset(r * 0.5f * f * f + r * 0.08f * sin(f * 3f), -r * 0.75f * f + r * 0.2f * f * f)
        if (s == 0) chemin.moveTo(p.x, p.y) else chemin.lineTo(p.x, p.y)
        bout = p
    }
    drawPath(chemin, trait.copy(alpha = 0.35f), style = Stroke(r * 0.16f, cap = StrokeCap.Round))
    drawPath(chemin, lerp(trait, Color.White, 0.3f), style = Stroke(r * 0.07f, cap = StrokeCap.Round))
    if (!etincelle) return
    val vibre = 0.75f + 0.25f * sin(t / 37f)
    drawCircle(Brush.radialGradient(listOf(Color(0xFFFFF6C8), Color(0xFFFFB347).copy(alpha = 0.7f), Color.Transparent), bout, r * 0.6f * vibre), r * 0.6f * vibre, bout)
    for (k in 0 until 7) {
        val a = k * (2f * PI.toFloat() / 7f) + t / 120f
        val lg = r * (0.3f + 0.25f * abs(sin(t / 53f + k)))
        drawLine(Color(0xFFFFE9A0), bout, bout + Offset(cos(a) * lg, sin(a) * lg), r * 0.04f, StrokeCap.Round)
    }
}
