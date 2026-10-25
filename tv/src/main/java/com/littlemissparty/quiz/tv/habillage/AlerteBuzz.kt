package com.littlemissparty.quiz.tv.habillage

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/*
 * Écran du buzz du Game Show, proposition D (cedric, 24 octobre : « beaucoup trop sage… beaucoup plus stylisé ») :
 * des lasers qui convergent sur l'équipe, un anneau néon à sa couleur qui bat, « STOP ! » qui claque en glitch.
 * Dessin seul (lignes, cercles, texte) : rien de lourd pour la Mi Box, aucun son (le buzz a déjà le sien).
 */

/** Durée du claquement de « STOP ! » (arrivée en grand + dédoublement cyan / rose), en ms. */
internal const val STOP_CLAQUE_MS = 450f

/** Les lasers entrent depuis les bords en [LASERS_ENTREE_MS], puis respirent. */
internal const val LASERS_ENTREE_MS = 320f

private const val NB_LASERS = 16

/**
 * Lasers et anneau, centrés sur la zone. [ms] : temps depuis le buzz ; [fondu] : 1 plein, 0 éteint (la parole qui part
 * en bandeau éteint la scène). L'anneau fait [rayon] de la plus petite dimension.
 */
@Composable
internal fun AlerteBuzz(ms: () -> Float, couleur: Color, fondu: () -> Float, modifier: Modifier = Modifier, rayon: Float = 0.36f) {
    val teintes = listOf(GS.Rose, GS.Cyan, GS.Violet, couleur)
    Canvas(modifier.clearAndSetSemantics {}) {
        val f = fondu().coerceIn(0f, 1f)
        if (f <= 0f) return@Canvas
        val t = ms()
        val c = Offset(size.width / 2, size.height / 2)
        val r = size.minDimension * rayon
        val loin = size.maxDimension * 0.8f
        val entree = (t / LASERS_ENTREE_MS).coerceIn(0f, 1f).let { 1f - (1f - it) * (1f - it) }
        val pouls = 0.5f + 0.5f * sin(t / 1_000f * 2f * PI.toFloat() / 0.55f)
        // Lasers : chacun part du bord et vient mourir sur l'anneau ; la gerbe tourne très lentement.
        val tour = t / 1_000f * 0.06f
        for (k in 0 until NB_LASERS) {
            val a = k * 2f * PI.toFloat() / NB_LASERS + tour + if (k % 2 == 1) 0.09f else 0f
            val dedans = r * (1.12f + 0.1f * (k % 3)) + (loin - r) * (1f - entree)
            val dx = cos(a)
            val dy = sin(a)
            val col = teintes[k % teintes.size]
            val vif = f * (0.55f + 0.35f * if ((k + (t / 140f).toInt()) % 5 == 0) 1f else pouls)
            val p1 = Offset(c.x + dx * dedans, c.y + dy * dedans)
            val p2 = Offset(c.x + dx * loin, c.y + dy * loin)
            drawLine(col.copy(alpha = 0.18f * vif), p1, p2, 9.dp.toPx(), StrokeCap.Round)
            drawLine(col.copy(alpha = 0.9f * vif), p1, p2, 1.6.dp.toPx(), StrokeCap.Round)
        }
        // Voile sombre au centre : le texte reste lisible par-dessus les lasers et le plateau.
        drawCircle(
            Brush.radialGradient(listOf(GS.Noir.copy(alpha = 0.78f * f), GS.Noir.copy(alpha = 0.5f * f), Color.Transparent), c, r * 1.35f),
            r * 1.35f, c,
        )
        // Anneau néon à la couleur de l'équipe : halo large, tube, cœur clair ; un deuxième anneau plus fin qui bat.
        val s = 1f + 0.025f * pouls
        val apparition = (t / 260f).coerceIn(0f, 1f)
        val ra = r * s * (0.7f + 0.3f * apparition)
        drawCircle(couleur.copy(alpha = 0.16f * f * apparition), ra, c, style = Stroke(26.dp.toPx()))
        drawCircle(couleur.copy(alpha = 0.85f * f * apparition), ra, c, style = Stroke(4.dp.toPx()))
        drawCircle(Color.White.copy(alpha = 0.55f * f * apparition), ra, c, style = Stroke(1.2.dp.toPx()))
        drawCircle(couleur.copy(alpha = (0.45f - 0.3f * pouls) * f * apparition), r * (1.24f + 0.06f * pouls), c, style = Stroke(2.dp.toPx()))
        // Flash blanc du claquement : une lueur qui se fond dans le noir, sans bord (pas un disque plat).
        if (t < 220f) {
            val a = 0.45f * f * (1f - t / 220f)
            drawCircle(Brush.radialGradient(listOf(Color.White.copy(alpha = a), Color.White.copy(alpha = a * 0.35f), Color.Transparent), c, r * 2.4f), r * 2.4f, c)
        }
    }
}

/** « STOP » et son point d'exclamation, séparés par une espace fine insécable. */
private const val STOP_TEXTE = "STOP\u202F!"

/**
 * « STOP ! » qui claque : il arrive en très grand, retombe à sa taille et se dédouble en cyan et en rose le temps du
 * claquement ; ensuite il garde un liseré cyan décalé, comme une enseigne. [fondu] comme pour [AlerteBuzz].
 */
@Composable
internal fun StopGlitch(ms: () -> Float, taille: TextUnit, modifier: Modifier = Modifier, fondu: () -> Float = { 1f }) {
    fun style(couleur: Color) = TextStyle(color = couleur, fontFamily = PoliceGsTitre, fontSize = taille, fontWeight = FontWeight.Normal)
    val degrade = TextStyle(
        brush = Brush.verticalGradient(listOf(Color(0xFFFFE3EE), Color(0xFFFF7FAE), Color(0xFFFF3D7F))),
        fontFamily = PoliceGsTitre, fontSize = taille, fontWeight = FontWeight.Normal,
        shadow = Shadow(GS.Rose.copy(alpha = 0.9f), Offset.Zero, 36f),
    )
    // Centrage optique (cedric, 25/10 : « le STOP n'est pas centré ») : c'est le mot STOP qui se pose sur l'axe de
    // l'anneau, le point d'exclamation dépasse à droite ; espace fine insécable entre les deux.
    val mesure = rememberTextMeasurer()
    val decalageOptique = remember(taille) {
        val st = TextStyle(fontFamily = PoliceGsTitre, fontSize = taille)
        (mesure.measure(STOP_TEXTE, st, softWrap = false, maxLines = 1).size.width -
            mesure.measure("STOP", st, softWrap = false, maxLines = 1).size.width) / 2f
    }
    Box(
        modifier.clearAndSetSemantics {}.graphicsLayer {
            translationX = decalageOptique * 0.8f
            val t = ms()
            val p = (t / 180f).coerceIn(0f, 1f)
            val s = if (p < 1f) 1.9f - 0.9f * p else 1f + 0.05f * sin(((t - 180f) / 120f).coerceAtMost(PI.toFloat()))
            scaleX = s
            scaleY = s
            alpha = fondu().coerceIn(0f, 1f) * p.coerceAtLeast(0.2f)
        },
        contentAlignment = Alignment.Center,
    ) {
        val decalage: () -> Float = {
            val t = ms()
            if (t < STOP_CLAQUE_MS) 9f * (1f - t / STOP_CLAQUE_MS) * (if ((t / 50f).toInt() % 2 == 0) 1f else -0.6f) else 0f
        }
        Text(STOP_TEXTE, maxLines = 1, softWrap = false, style = style(GS.Cyan.copy(alpha = 0.85f)),
            modifier = Modifier.graphicsLayer { translationX = (-2.5f - decalage()) * density; translationY = 1.5f * density })
        Text(STOP_TEXTE, maxLines = 1, softWrap = false, style = style(GS.Rose.copy(alpha = 0.7f)),
            modifier = Modifier.graphicsLayer { val d = decalage(); translationX = (d * 1.2f) * density; alpha = if (d == 0f) 0f else 1f })
        Text(STOP_TEXTE, maxLines = 1, softWrap = false, style = degrade)
    }
}

/** Le nom de l'équipe dans une pastille néon à sa couleur, réduit pour tenir sur une ligne dans [largeurMax]. */
@Composable
internal fun PastilleNom(nom: String, couleur: Color, tailleMax: Float, largeurMax: Dp, modifier: Modifier = Modifier) {
    Box(
        modifier
            .background(Brush.verticalGradient(listOf(GS.Noir.copy(alpha = 0.92f), GS.Nuit.copy(alpha = 0.92f))), RoundedCornerShape(50))
            .border(3.dp, couleur, RoundedCornerShape(50))
            .padding(horizontal = 36.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) { NomUneLigne(nom.ifBlank { "Équipe" }, couleur, tailleMax, largeurMax) }
}

/** Petite ligne espacée sous la pastille (« A BUZZÉ · ON ÉCOUTE SA RÉPONSE »). */
@Composable
internal fun LigneBuzz(texte: String, taille: TextUnit, modifier: Modifier = Modifier) {
    Text(
        texte, maxLines = 1, softWrap = false, modifier = modifier,
        style = TextStyle(
            fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Bold, fontSize = taille, letterSpacing = taille * 0.32f,
            color = Color(0xFFFFF3E6), shadow = Shadow(GS.Cyan.copy(alpha = 0.6f), Offset.Zero, 14f),
        ),
    )
}

/** Micro dessiné en tube néon (tête à grille, étrier, pied), à la place de l'émoji 🎤 du Game Show. */
@Composable
internal fun MicroNeon(modifier: Modifier = Modifier, couleur: Color = GS.Cyan) {
    Canvas(modifier.clearAndSetSemantics {}) {
        val w = size.width
        val h = size.height
        val trait = w * 0.075f
        fun tube(dessin: (Color, Float) -> Unit) {
            dessin(couleur.copy(alpha = 0.22f), trait * 3.2f)
            dessin(couleur, trait)
            dessin(Color.White.copy(alpha = 0.7f), trait * 0.35f)
        }
        val tl = Offset(w * 0.32f, h * 0.04f)
        val tete = androidx.compose.ui.geometry.Size(w * 0.36f, h * 0.5f)
        tube { c, e -> drawRoundRect(c, tl, tete, androidx.compose.ui.geometry.CornerRadius(w * 0.18f), style = Stroke(e)) }
        // Grille de la tête : trois barres.
        for (k in 1..3) {
            val y = tl.y + tete.height * k / 4.2f
            tube { c, e -> drawLine(c, Offset(tl.x + tete.width * 0.28f, y), Offset(tl.x + tete.width * 0.72f, y), e * 0.6f, StrokeCap.Round) }
        }
        // Étrier en U sous la tête, pied et socle.
        tube { c, e -> drawArc(c, 0f, 180f, false, Offset(w * 0.2f, h * 0.2f), androidx.compose.ui.geometry.Size(w * 0.6f, h * 0.52f), style = Stroke(e, cap = StrokeCap.Round)) }
        tube { c, e -> drawLine(c, Offset(w * 0.5f, h * 0.72f), Offset(w * 0.5f, h * 0.9f), e, StrokeCap.Round) }
        tube { c, e -> drawLine(c, Offset(w * 0.3f, h * 0.92f), Offset(w * 0.7f, h * 0.92f), e, StrokeCap.Round) }
    }
}

/** « TOUT LE MONDE CHANTE ! » du Game Show : micro néon et lettres roses qui brillent. */
@Composable
internal fun ToutLeMondeChante(taille: TextUnit, modifier: Modifier = Modifier) {
    androidx.compose.foundation.layout.Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        MicroNeon(Modifier.size(taille.value.dp * 1.15f, taille.value.dp * 1.5f))
        androidx.compose.foundation.layout.Spacer(Modifier.size(taille.value.dp * 0.55f))
        Text(
            "TOUT LE MONDE CHANTE !", maxLines = 1, softWrap = false,
            style = TextStyle(
                brush = Brush.verticalGradient(listOf(Color(0xFFFFC1DC), GS.Rose, Color(0xFFFF6B9E))),
                fontFamily = PoliceGsTitre, fontSize = taille, shadow = Shadow(GS.Rose.copy(alpha = 0.85f), Offset.Zero, 26f),
            ),
        )
    }
}
