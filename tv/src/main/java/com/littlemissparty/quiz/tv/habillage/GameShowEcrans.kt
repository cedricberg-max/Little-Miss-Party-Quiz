package com.littlemissparty.quiz.tv.habillage

import androidx.compose.ui.res.painterResource
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * Titre néon du Game Show : lettres Bungee claires, teintées de [couleur] vers le bas, avec la lueur de la couleur
 * autour. La lueur est l'ombre du texte (dessinée avec lui, une fois) : rien n'est recalculé à chaque image.
 */
fun styleTitreNeon(taille: TextUnit, couleur: Color, alignement: TextAlign = TextAlign.Center) = TextStyle(
    fontFamily = PoliceGsTitre, fontSize = taille, lineHeight = taille * 1.08f, textAlign = alignement,
    brush = Brush.verticalGradient(listOf(Color.White, lerpVers(couleur, Color.White, 0.35f), couleur)),
    shadow = Shadow(couleur.copy(alpha = 0.9f), Offset.Zero, taille.value * 0.55f),
    lineHeightStyle = LIGNE_LMP,
)

/** Étiquette du Game Show (Orbitron, capitales espacées), par exemple « PROCHAIN JEU ». */
fun styleEtiquetteGs(taille: TextUnit, couleur: Color, espacement: TextUnit = taille * 0.4f) = TextStyle(
    fontFamily = PoliceGsChiffres, fontSize = taille, lineHeight = taille * 1.2f, fontWeight = FontWeight.Bold,
    color = couleur, letterSpacing = espacement, shadow = Shadow(couleur.copy(alpha = 0.7f), Offset.Zero, taille.value * 0.6f),
    lineHeightStyle = LIGNE_LMP,
)

internal fun lerpVers(a: Color, b: Color, t: Float) = Color(a.red + (b.red - a.red) * t, a.green + (b.green - a.green) * t, a.blue + (b.blue - a.blue) * t, a.alpha + (b.alpha - a.alpha) * t)

/**
 * Logo « THE GAME SHOW by Little Miss Party » (kit du 22 octobre) : « THE » en cyan bien lisible, « GAME SHOW » en néon rose,
 * puis « by » et le logo officiel. [hauteur] : hauteur de « GAME SHOW » ; l'ensemble fait environ 1,9 fois plus.
 */
@Composable
fun LogoGameShow(hauteur: Dp, modifier: Modifier = Modifier, aligne: Alignment.Horizontal = Alignment.Start) {
    val taille = (hauteur.value * 0.82f).sp
    // Filigrane A bien marqué derrière tout le logo, posé deux fois (cedric, 30/10 : « GAME SHOW » se confondait
    // avec le décor, au tableau des scores comme ailleurs). Il suit l'opacité donnée au logo.
    val fond = Modifier.drawBehind {
        val m = hauteur.toPx() * LOGO_FILIGRANE_MARGE
        val zone = Rect(-m, -m, size.width + m, size.height + m)
        repeat(LOGO_FILIGRANE_COUCHES) { filigrane(zone, 1f) }
    }
    Column(modifier.then(fond), horizontalAlignment = aligne) {
        // « THE » fait partie du nom (cedric, 22/10) : bien lisible, pas une petite étiquette.
        // L'espacement des lettres s'ajoute aussi après le E : on recentre d'autant.
        val espacement = (hauteur.value * 0.08f).sp
        Text(
            "THE", style = styleEtiquetteGs((hauteur.value * 0.5f).sp, GS.Cyan, espacement), maxLines = 1, softWrap = false,
            modifier = Modifier.padding(start = with(LocalDensity.current) { espacement.toDp() }),
        )
        Text("GAME SHOW", style = styleTitreNeon(taille, GS.Rose, TextAlign.Start), maxLines = 1, softWrap = false)
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.offset(y = -hauteur * 0.04f)) {
            Text("by", style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = (hauteur.value * 0.3f).sp, color = GS.Encre.copy(alpha = 0.8f), lineHeight = 1.1.em, lineHeightStyle = LIGNE_LMP))
            Spacer(Modifier.width(hauteur * 0.12f))
            LogoLmp(hauteur * 0.55f)
        }
    }
}

/** Marge du filigrane autour du logo, en part de sa hauteur, et nombre de couches (deux : plus sombre que le A). */
internal const val LOGO_FILIGRANE_MARGE = 0.35f
internal const val LOGO_FILIGRANE_COUCHES = 2

/**
 * Écran de présentation d'un jeu, design Game Show : « PROCHAIN JEU » en capitales cyan, l'emblème du jeu qui flotte
 * dans un anneau néon (cyan, et violet en pointillés qui tourne lentement), le nom du jeu en grand titre néon de la
 * couleur du jeu, et « LE JEU VA COMMENCER » qui respire. Même contrat que la version classique : aucune règle, fond
 * transparent, rien de focalisable, aucun son, titre lisible par les tests.
 */
@Composable
fun PresentationJeuGameShow(titre: String, famille: String, modifier: Modifier = Modifier) {
    val embleme = emblemeJeu(famille)
    // L'or des jeux classiques (quiz, coffres, portes) passe au rose néon du kit.
    val couleur = if (embleme.couleur == Color(0xFFF0CC92)) GS.Rose else enNeon(embleme.couleur)
    val boucle = rememberInfiniteTransition(label = "presentation-gs")
    val tour by boucle.animateFloat(0f, 360f, infiniteRepeatable(tween(24_000, easing = LinearEasing)), label = "tour")
    val flotte by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(3_200), RepeatMode.Reverse), label = "flotte")
    val souffle by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(2_400), RepeatMode.Reverse), label = "souffle")
    val balayage by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(5_000, easing = LinearEasing)), label = "balayage")
    Echelle(960.dp, 540.dp, modifier.fillMaxSize()) {
        // Remonté de 36 dp : « LE JEU VA COMMENCER » ne passe jamais sous le bouton de l'animatrice, en bas à droite.
        Column(Modifier.align(Alignment.Center).padding(bottom = 72.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.apparition(0, titre)) {
                FiletNeon(false)
                Text("PROCHAIN JEU", maxLines = 1, softWrap = false, modifier = Modifier.padding(horizontal = 16.dp), style = styleEtiquetteGs(20.sp, GS.Cyan, 9.sp))
                FiletNeon(true)
            }
            Spacer(Modifier.height(20.dp))
            Box(Modifier.size(196.dp).apparition(250, titre), contentAlignment = Alignment.Center) {
                // Halo de la couleur du jeu et disque de verre sombre : fixes.
                Box(
                    Modifier.size(196.dp).drawWithCache {
                        val c = Offset(size.width / 2, size.height / 2)
                        val r = size.minDimension / 2
                        val halo = Brush.radialGradient(listOf(couleur.copy(alpha = 0.5f), couleur.copy(alpha = 0.12f), Color.Transparent), c, r * 1.6f)
                        val disque = Brush.radialGradient(listOf(GS.VioletProfond, GS.Nuit), c, r * 0.8f)
                        onDrawBehind {
                            drawCircle(halo, r * 1.6f, c)
                            drawCircle(disque, r * 0.8f, c)
                            drawCircle(GS.Cyan.copy(alpha = 0.35f), r * 0.86f, c, style = Stroke(10.dp.toPx()))
                            drawCircle(GS.Cyan, r * 0.86f, c, style = Stroke(3.5.dp.toPx()))
                            drawCircle(GS.CyanClair.copy(alpha = 0.6f), r * 0.7f, c, style = Stroke(1.dp.toPx()))
                        }
                    },
                )
                // Anneau violet en pointillés qui tourne lentement, et un point lumineux qui en fait le tour.
                Box(
                    Modifier.size(196.dp)
                        .graphicsLayer { rotationZ = tour }
                        .drawWithCache {
                            val c = Offset(size.width / 2, size.height / 2)
                            val r = size.minDimension / 2
                            val pointilles = PathEffect.dashPathEffect(floatArrayOf(14.dp.toPx(), 9.dp.toPx()))
                            val point = Offset(c.x + r * 0.99f, c.y)
                            val lueur = Brush.radialGradient(listOf(GS.Encre, couleur.copy(alpha = 0.6f), Color.Transparent), point, 12.dp.toPx())
                            onDrawBehind {
                                drawCircle(GS.Violet, r * 0.99f, c, style = Stroke(3.dp.toPx(), pathEffect = pointilles))
                                drawCircle(lueur, 12.dp.toPx(), point)
                            }
                        },
                )
                val logo = logoNeonJeu(famille)
                if (logo != null) Image(
                    painterResource(logo), contentDescription = null,
                    modifier = Modifier.size(150.dp).graphicsLayer { translationY = (flotte - 0.5f) * 14.dp.toPx() },
                ) else Text(
                    embleme.emoji,
                    modifier = Modifier.graphicsLayer { translationY = (flotte - 0.5f) * 14.dp.toPx() },
                    style = TextStyle(fontSize = 92.sp, textAlign = TextAlign.Center),
                )
            }
            Spacer(Modifier.height(24.dp))
            val taille = when {
                titre.length <= 14 -> 70.sp
                titre.length <= 22 -> 52.sp
                else -> 40.sp
            }
            // Plaque sombre sous le titre : il passe devant les pupitres du plateau et doit rester lisible (cedric, 25/10).
            Box(
                Modifier.padding(horizontal = 50.dp).apparition(500, titre)
                    .background(GS.Noir.copy(alpha = 0.72f), RoundedCornerShape(18.dp))
                    .padding(horizontal = 28.dp, vertical = 6.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(titre, maxLines = 2, overflow = TextOverflow.Ellipsis, style = styleTitreNeon(taille, couleur))
                // Reflet blanc qui traverse le titre toutes les 5 secondes (le titre reste net et immobile).
                Text(
                    titre, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    style = styleTitreNeon(taille, couleur).copy(
                        shadow = null,
                        brush = Brush.linearGradient(
                            0f to Color.Transparent, (balayage * 1.6f - 0.4f).coerceIn(0f, 1f) to Color.Transparent,
                            (balayage * 1.6f - 0.3f).coerceIn(0f, 1f) to Color.White.copy(alpha = 0.85f),
                            (balayage * 1.6f - 0.2f).coerceIn(0f, 1f) to Color.Transparent, 1f to Color.Transparent,
                            start = Offset(0f, 0f), end = Offset(1200f, 200f),
                        ),
                    ),
                )
            }
            Spacer(Modifier.height(18.dp))
            Text(
                "LE JEU VA COMMENCER", maxLines = 1, softWrap = false,
                modifier = Modifier.apparition(800, titre).graphicsLayer { alpha = 0.55f + 0.45f * souffle },
                style = styleEtiquetteGs(18.sp, GS.Jaune, 7.sp),
            )
        }
        // Petits éclats qui tournent autour de l'emblème, calés sur l'anneau (un seul calque).
        Box(
            Modifier.align(Alignment.Center).padding(bottom = 168.dp).size(300.dp)
                .graphicsLayer { rotationZ = -tour * 0.6f }
                .drawBehind {
                    val c = Offset(size.width / 2, size.height / 2)
                    for (k in 0 until 8) {
                        val a = 2f * PI.toFloat() * k / 8f
                        val r = size.minDimension / 2 * (0.86f + 0.08f * (k % 2))
                        drawCircle(listOf(GS.Cyan, GS.Rose, GS.Violet, GS.Jaune)[k % 4].copy(alpha = 0.75f), (2f + (k % 3)).dp.toPx(), Offset(c.x + cos(a) * r, c.y + sin(a) * r))
                    }
                },
        )
    }
}

@Composable
private fun FiletNeon(versLaDroite: Boolean) {
    Box(
        Modifier.width(90.dp).height(2.dp).drawBehind {
            val couleurs = listOf(GS.Cyan.copy(alpha = 0f), GS.Cyan)
            drawRect(Brush.horizontalGradient(if (versLaDroite) couleurs.reversed() else couleurs))
        },
    )
}

/**
 * Logo du générique d'ouverture en design Game Show, calé sur la même musique que la version classique : « THE »
 * s'allume pendant le roulement (0,2 à 0,9 s), « GAME SHOW » claque sur l'impact (2 s), puis « by » et le logo
 * officiel apparaissent. Le temps n'est lu que dans les calques : rien ne se recompose à chaque image.
 */
@Composable
internal fun LogoGeneriqueGameShow(ms: () -> Float) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            "THE", maxLines = 1, softWrap = false, style = styleEtiquetteGs(52.sp, GS.Cyan, 8.sp),
            modifier = Modifier.graphicsLayer { alpha = ((ms() - 200f) / 700f).coerceIn(0f, 1f) },
        )
        Text(
            "GAME SHOW", maxLines = 1, softWrap = false, style = styleTitreNeon(118.sp, GS.Rose),
            modifier = Modifier.graphicsLayer {
                val q = ((ms() - 2_000f) / 450f).coerceIn(0f, 1f)
                val claque = if (q <= 0f) 0f else 1f + 0.5f * (1f - q) * (1f - q)
                alpha = if (q > 0f) 1f else 0f
                scaleX = claque
                scaleY = claque
            },
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.graphicsLayer { alpha = ((ms() - 2_600f) / 600f).coerceIn(0f, 1f) },
        ) {
            Text("by", style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 30.sp, color = GS.Encre.copy(alpha = 0.85f)))
            Spacer(Modifier.width(14.dp))
            LogoLmp(64.dp)
        }
    }
}
