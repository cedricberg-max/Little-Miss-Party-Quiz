package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.R
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin

/*
 * Statues musicales du Game Show, choix de cedric du 29/10 (planche « Choix graphiques du 29 ») :
 * - le mot STATUE ! version A : en vraie pierre grise taillée (une seule image fixe, gs_statue_pierre), qui tombe,
 *   claque, tremble et lâche un nuage de poussière de pierre ; « PLUS PERSONNE NE BOUGE » en grand jaune, sans cadre ;
 * - l'animation BRAVO : la ou les gagnantes couronnées et leur « +300 », puis « Bravo aussi aux autres ! » et le « +150 »
 *   de chaque autre équipe. Elle REMPLACE le récap de la chanson (cedric : les deux disaient la même chose) ; le
 *   classement général de fin de chanson reste ensuite, comme dans tous les jeux.
 * Mesures des planches (…/propositions-29-octobre/statues/a-livrer/) divisées par 2 : 960 × 540 dp.
 */

private val NuitS = Color(0xFF05010D)
private val JauneS = Color(0xFFFFE600)
private val OrS = Color(0xFFFFD23F)
private val VertS = Color(0xFF39FF14)
private val CyanS = Color(0xFF00F0FF)
private val RoseS = Color(0xFFFF2D95)

private fun borneS(x: Float) = x.coerceIn(0f, 1f)
private fun lisseS(x: Float) = borneS(x).let { it * it * (3 - 2 * it) }
private fun ressortS(x: Float) = rebondA(x)

/** Le voile des deux écrans : sombre au centre (ellipse 62 % × 52 % de l'écran), le plateau reste visible autour. */
private fun DrawScope.voileStatues() {
    val rx = size.width * 0.62f
    val ry = size.height * 0.52f
    val c = Offset(size.width / 2f, size.height / 2f)
    scale(1f, ry / rx, c) {
        drawRect(
            Brush.radialGradient(0f to NuitS.copy(alpha = 0.78f), 0.7f to NuitS.copy(alpha = 0.45f), 1f to NuitS.copy(alpha = 0.30f), center = c, radius = rx),
            topLeft = Offset(0f, c.y - (size.height / 2f) * rx / ry), size = Size(size.width, size.height * rx / ry),
        )
    }
}

/** Durée de l'animation BRAVO (s) ; ensuite tout reste affiché jusqu'au bouton de Sarah. */
internal const val BRAVO_STATUES_S = 5.6f

/** Le mot STATUE ! en pierre (version A), rejoué à chaque arrêt de la musique. */
@Composable
internal fun StatuePierre(modifier: Modifier = Modifier) {
    val ms = horloge("statue-pierre")
    Echelle(960.dp, 540.dp, modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().clearAndSetSemantics {}.drawBehind { voileStatues() })
        // Le halo cyan derrière le mot, dès 0,2 s.
        Canvas(Modifier.fillMaxSize().clearAndSetSemantics {}) {
            val a = borneS((ms() / 1000f - 0.2f) / 0.25f)
            if (a <= 0f) return@Canvas
            val d = density
            val c = Offset(480f * d, (125f + 82.5f) * d)
            scale(1f, 165f / 650f, c) {
                drawCircle(
                    Brush.radialGradient(0f to CyanS.copy(alpha = 0.67f * a), 0.45f to CyanS.copy(alpha = 0.2f * a), 0.7f to Color.Transparent, center = c, radius = 325f * d),
                    radius = 325f * d, center = c,
                )
            }
        }
        // Le nuage de poussière de pierre, depuis le bas du mot.
        Canvas(Modifier.fillMaxSize().clearAndSetSemantics {}) { poussiere((ms() / 1000f) - 0.22f) }
        Image(
            painterResource(R.drawable.gs_statue_pierre), contentDescription = "STATUE !", contentScale = ContentScale.Fit,
            modifier = Modifier.align(Alignment.TopCenter).offset(y = 125.dp).size(620.dp, 191.dp).graphicsLayer {
                val s = ms() / 1000f
                val p = borneS(s / 0.22f)
                translationY = -(1f - p * p) * 250f * density
                val choc = borneS((s - 0.22f) / 0.3f)
                translationX = if (choc in 0.001f..0.999f) sin(choc * 30f) * (1f - choc) * 7f * density else 0f
                alpha = borneS(s / 0.08f)
            },
        )
        val consigne = TextStyle(fontFamily = PoliceGsTitre, fontSize = 37.sp, letterSpacing = 0.03.em, textAlign = TextAlign.Center)
        Box(
            Modifier.align(Alignment.TopCenter).offset(y = 320.dp).graphicsLayer {
                val p = lisseS((ms() / 1000f - 0.45f) / 0.35f)
                alpha = p
                translationY = (1f - p) * 15f * density
            },
        ) {
            Text("PLUS PERSONNE NE BOUGE", maxLines = 1, softWrap = false, style = consigne.copy(color = NuitS, drawStyle = Stroke(7f, join = androidx.compose.ui.graphics.StrokeJoin.Round)))
            Text("PLUS PERSONNE NE BOUGE", maxLines = 1, softWrap = false, style = consigne.copy(color = JauneS, shadow = Shadow(JauneS, Offset.Zero, 18f)))
        }
    }
}

/** 18 bouffées grises qui s'écartent en éventail depuis le bas du mot et s'effacent en 1,25 s ([u] : secondes depuis le choc). */
private fun DrawScope.poussiere(u: Float) {
    if (u <= 0f || u > 1.3f) return
    val d = density
    val a = borneS(1f - u / 1.25f)
    val ouvre = 1f - exp(-u * 3.5f)
    for (k in 0 until 18) {
        val cote = if (k % 2 == 0) 1f else -1f
        val angle = (k / 2) * (PI.toFloat() / 18f) * 0.9f
        val portee = (120f + 25f * (k % 5)) * ouvre
        val x = 480f + cote * cos(angle) * portee * 2.2f
        val y = 280f - sin(angle) * portee * 0.6f
        drawOval(
            Brush.radialGradient(listOf(Color(0xFFC8C8D7).copy(alpha = 0.5f * a), Color.Transparent), Offset(x * d, y * d), 40f * d),
            topLeft = Offset((x - 45f) * d, (y - 30f) * d), size = Size(90f * d, 60f * d),
        )
    }
}

/** Une équipe à l'écran du BRAVO : nom, couleur et points de cette chanson. */
data class EquipeBravo(val nom: String, val couleur: Color, val points: Int)

/** Place verticale (dp) des éléments du BRAVO pour [gagnantes] noms et [autres] tuiles (rien ne déborde à 8 équipes). */
internal data class PlacesBravo(val nomsHaut: Float, val ligneNom: Float, val colonnesNoms: Int, val pastille: Float, val autres: Float, val tuiles: Float, val rangees: Int)

internal fun placesBravo(gagnantes: Int, autres: Int): PlacesBravo {
    val g = gagnantes.coerceAtLeast(1)
    val colonnes = if (g > 3) 2 else 1
    val lignes = (g + colonnes - 1) / colonnes
    val ligne = when { g == 1 -> 64f; g <= 3 -> 44f; else -> 38f }
    val finNoms = 150f + lignes * ligne
    val pastille = finNoms + 8f
    // La pastille remonte de 20 dp et rétrécit à 65 % (70 dp de haut) quand les autres arrivent.
    val finPastille = pastille - 20f + 0.65f * 70f
    val texteAutres = maxOf(if (autres > 4) 310f else 320f, finPastille + 8f)
    val rangees = if (autres > 4) 2 else if (autres > 0) 1 else 0
    return PlacesBravo(150f, ligne, colonnes, pastille, texteAutres, texteAutres + 62f, rangees)
}

/**
 * L'animation BRAVO des statues, sur [t] secondes depuis la fin du roulement de tambour : [gagnantes] couronnées avec
 * leurs points, puis « Bravo aussi aux autres ! » et une tuile par autre équipe ([autres], leurs points).
 */
@Composable
internal fun BravoStatues(gagnantes: List<EquipeBravo>, autres: List<EquipeBravo>, depart: Float, modifier: Modifier = Modifier) {
    val cle = gagnantes.joinToString { it.nom }
    val t = remember(cle) { Animatable(depart.coerceIn(0f, BRAVO_STATUES_S)) }
    LaunchedEffect(cle) { t.animateTo(BRAVO_STATUES_S, tween(((BRAVO_STATUES_S - t.value) * 1000).toInt().coerceAtLeast(0), easing = LinearEasing)) }
    val s = { t.value }
    val p = placesBravo(gagnantes.size, autres.size)
    Echelle(960.dp, 540.dp, modifier.fillMaxSize().semantics {
        contentDescription = descriptionBravo(gagnantes, autres)
    }) {
        Box(Modifier.fillMaxSize().clearAndSetSemantics {}.drawBehind { voileStatues() })
        // BRAVO, en ressort.
        val bravo = TextStyle(fontFamily = PoliceGsTitre, fontSize = 75.sp, textAlign = TextAlign.Center)
        Box(
            Modifier.align(Alignment.TopCenter).offset(y = 46.dp).clearAndSetSemantics {}
                .graphicsLayer { val k = ressortS((s() - 0.1f) / 0.55f); scaleX = k; scaleY = k },
        ) {
            Text("BRAVO", maxLines = 1, softWrap = false, style = bravo.copy(color = NuitS, drawStyle = Stroke(9f, join = androidx.compose.ui.graphics.StrokeJoin.Round)))
            Text("BRAVO", maxLines = 1, softWrap = false, style = bravo.copy(color = OrS, shadow = Shadow(OrS, Offset.Zero, 26f)))
        }
        // Les gagnantes couronnées, l'une sous l'autre (deux colonnes au-delà de 3).
        val parColonne = (gagnantes.size + p.colonnesNoms - 1) / p.colonnesNoms
        Row(
            Modifier.align(Alignment.TopCenter).offset(y = p.nomsHaut.dp).clearAndSetSemantics {}
                .graphicsLayer { val k = ressortS((s() - 0.45f) / 0.55f); scaleX = k; scaleY = k; alpha = borneS((s() - 0.45f) * 6f) },
            horizontalArrangement = Arrangement.spacedBy(30.dp),
        ) {
            gagnantes.chunked(parColonne.coerceAtLeast(1)).forEach { colonne ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    colonne.forEach { NomCouronne(it, p.ligneNom, if (p.colonnesNoms > 1) 420f else 820f) }
                }
            }
        }
        // « +300 » : il gonfle, penche et se balance ; il remonte et rétrécit quand les autres arrivent.
        val points = gagnantes.firstOrNull()?.points ?: 0
        if (points > 0) Box(
            Modifier.align(Alignment.TopCenter).offset(y = p.pastille.dp).clearAndSetSemantics {}
                .graphicsLayer {
                    val v = s()
                    val k = ressortS((v - 0.95f) / 0.5f)
                    val place = if (autres.isEmpty()) 0f else lisseS((v - 2.6f) / 0.5f)
                    val e = k * (1f - 0.35f * place)
                    scaleX = e; scaleY = e
                    translationY = -20f * place * density
                    rotationZ = -4f + 2f * sin(v * 5f)
                }
                .drawBehind { drawRoundRect(JauneS.copy(alpha = 0.4f), Offset(-12f * density, -12f * density), Size(size.width + 24f * density, size.height + 24f * density), CornerRadius(size.height)) }
                .background(JauneS, RoundedCornerShape(50))
                .padding(horizontal = 18.dp),
        ) {
            Text("+$points", maxLines = 1, softWrap = false, style = TextStyle(fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Black, fontSize = 60.sp, color = NuitS))
        }
        if (autres.isNotEmpty()) {
            val phrase = TextStyle(fontFamily = PoliceGsTitre, fontSize = 35.sp, textAlign = TextAlign.Center)
            Box(
                Modifier.align(Alignment.TopCenter).offset(y = p.autres.dp).clearAndSetSemantics {}
                    .graphicsLayer { val k = ressortS((s() - 2.6f) / 0.5f); scaleX = k; scaleY = k; alpha = borneS((s() - 2.6f) * 8f) },
            ) {
                Text("BRAVO AUSSI AUX AUTRES !", maxLines = 1, softWrap = false, style = phrase.copy(color = NuitS, drawStyle = Stroke(6f, join = androidx.compose.ui.graphics.StrokeJoin.Round)))
                Text("BRAVO AUSSI AUX AUTRES !", maxLines = 1, softWrap = false, style = phrase.copy(color = Color.White, shadow = Shadow(VertS, Offset.Zero, 24f)))
            }
            val parRangee = if (p.rangees > 1) (autres.size + 1) / 2 else autres.size
            val largeur = minOf(210f, (900f - 12f * (parRangee - 1)) / parRangee)
            autres.chunked(parRangee).forEachIndexed { r, rangee ->
                Row(
                    Modifier.align(Alignment.TopCenter).offset(y = (p.tuiles + r * 75f).dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    rangee.forEachIndexed { j, e -> TuileAutre(e, largeur, 3.0f + (r * parRangee + j) * 0.18f, s) }
                }
            }
        }
        ConfettisBravo(gagnantes.firstOrNull()?.couleur ?: JauneS, s)
    }
}

/** Ce que dit l'écran BRAVO, pour l'accessibilité et les tests sur émulateur (le dessin lui-même n'a pas de texte lisible). */
internal fun descriptionBravo(gagnantes: List<EquipeBravo>, autres: List<EquipeBravo>): String {
    fun points(e: EquipeBravo) = if (e.points > 0) "+${e.points}" else "0"
    val bravo = "Bravo ${gagnantes.joinToString(", ") { it.nom }} ! ${gagnantes.firstOrNull()?.let(::points) ?: ""}".trim()
    return if (autres.isEmpty()) bravo else "$bravo. Bravo aussi aux autres ! " + autres.joinToString(", ") { "${it.nom} ${points(it)}" }
}

/** Le nom d'une gagnante, couronne à gauche, en blanc avec la lueur de sa couleur, à la plus grande taille qui tient. */
@Composable
private fun NomCouronne(e: EquipeBravo, ligne: Float, largeurMax: Float) {
    val mesure = rememberTextMeasurer()
    val densite = LocalDensity.current
    val couronne = ligne * 0.75f
    val place = largeurMax - couronne - 10f
    val taille = remember(e.nom, ligne, largeurMax, densite) {
        val max = ligne * 0.875f
        var tt = max
        while (tt > 14f) {
            val w = mesure.measure(e.nom, TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = tt.sp), maxLines = 1, softWrap = false).size.width
            if (with(densite) { w.toDp().value } <= place) break
            tt -= 2f
        }
        tt
    }
    Row(Modifier.height(ligne.dp), verticalAlignment = Alignment.CenterVertically) {
        CouronneS(Modifier.size(couronne.dp, (couronne * 0.75f).dp))
        Box(Modifier.width(10.dp))
        Box {
            Text(e.nom, maxLines = 1, softWrap = false, style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = taille.sp, color = Color.Transparent, shadow = Shadow(e.couleur, Offset.Zero, 60f)))
            Text(e.nom, maxLines = 1, softWrap = false, style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = taille.sp, color = Color.White, shadow = Shadow(e.couleur, Offset.Zero, 20f)))
        }
    }
}

/** La couronne (même forme que celle du classement des Coffres). */
@Composable
private fun CouronneS(modifier: Modifier) {
    Canvas(modifier.clearAndSetSemantics {}) {
        val k = size.width / 40f
        scale(k, k, Offset.Zero) {
            val p = Path().apply {
                moveTo(3f, 26f); lineTo(1f, 7f); lineTo(12f, 15f); lineTo(20f, 2f); lineTo(28f, 15f); lineTo(39f, 7f); lineTo(37f, 26f); close()
            }
            drawPath(p, JauneS)
            drawPath(p, NuitS, style = Stroke(2.5f))
            drawCircle(RoseS, 3f, Offset(20f, 18f))
        }
    }
}

/** La tuile d'une autre équipe : son nom (réduit pour tenir en entier) et son « +150 » en vert, en ressort qui monte. */
@Composable
private fun TuileAutre(e: EquipeBravo, largeur: Float, arrivee: Float, s: () -> Float) {
    val forme = RoundedCornerShape(11.dp)
    Column(
        Modifier.size(largeur.dp, 70.dp)
            .graphicsLayer {
                val k = ressortS((s() - arrivee) / 0.45f)
                alpha = borneS((s() - arrivee) * 6f)
                translationY = (1f - k) * 30f * density
                scaleX = 0.8f + 0.2f * k; scaleY = scaleX
            }
            .drawBehind { drawRoundRect(e.couleur.copy(alpha = 0.35f), Offset(-4f * density, -4f * density), Size(size.width + 8f * density, size.height + 8f * density), CornerRadius(14f * density), style = Stroke(6f * density)) }
            .background(NuitS.copy(alpha = 0.9f), forme)
            .border(2.dp, e.couleur, forme)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            NomUneLigne(e.nom, Color.White, 23f, maxWidth, tailleMin = 12f)
        }
        Text(
            if (e.points > 0) "+${e.points}" else "0", maxLines = 1, softWrap = false,
            style = TextStyle(fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Black, fontSize = 26.sp, color = VertS, shadow = Shadow(VertS, Offset.Zero, 14f)),
        )
    }
}

/** 170 confettis qui partent du centre de l'écran à 1 s et retombent. */
@Composable
private fun ConfettisBravo(couleurGagnante: Color, s: () -> Float) {
    val confettis = remember(couleurGagnante) {
        var graine = 11L
        fun hasard(): Float { graine = graine * 16807L % 2147483647L; return graine / 2147483647f }
        val couleurs = listOf(JauneS, Color.White, RoseS, CyanS, VertS, couleurGagnante)
        List(170) { floatArrayOf(-PI.toFloat() / 2f + (hasard() - 0.5f) * 3.2f, 300f + hasard() * 420f, (hasard() * couleurs.size).toInt().coerceAtMost(couleurs.size - 1).toFloat(), hasard() * 6f, 5f + hasard() * 5f, hasard() * 0.2f) } to couleurs
    }
    Canvas(Modifier.fillMaxSize().clearAndSetSemantics {}) {
        val u = s() - 1.0f
        if (u < 0f) return@Canvas
        val d = density
        val (liste, couleurs) = confettis
        for (c in liste) {
            val v = u - c[5]
            if (v < 0f) continue
            val a = borneS(1.8f - v * 0.6f)
            if (a <= 0f) continue
            val amorti = v * exp(-v * 0.8f)
            val x = (480f + cos(c[0]) * c[1] * amorti) * d
            val y = (260f + sin(c[0]) * c[1] * amorti + 240f * v * v) * d
            translate(x, y) {
                rotate((c[3] + v * 9f) * 180f / PI.toFloat(), Offset.Zero) {
                    scale(1f, cos(v * 12f + c[3]), Offset.Zero) {
                        drawRect(couleurs[c[2].toInt()], Offset(-c[4] * d / 2f, -c[4] * d / 4f), Size(c[4] * d, c[4] * d / 2f), alpha = a)
                    }
                }
            }
        }
    }
}
