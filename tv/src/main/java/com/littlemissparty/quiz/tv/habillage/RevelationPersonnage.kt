package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.sin

/**
 * Qui suis-je ? : révélation du personnage. Son image (déposée dans la Régie PC) ou son émoji dans un médaillon
 * doré, rayons qui tournent derrière, et son nom en grand sur une ligne. Sans image ni émoji, le nom seul, plus
 * grand : jamais de visuel de remplacement qui pourrait faire croire à une autre réponse.
 * N'affiche que ce qu'on lui donne et ne joue aucun son (la révélation a déjà le sien).
 * [avecNom] = false : le médaillon seul, quand le nom est déjà écrit à côté (Game Show, révélation en néon).
 */
@Composable
fun RevelationPersonnage(nom: String, emoji: String?, image: ImageBitmap?, modifier: Modifier = Modifier, avecNom: Boolean = true) {
    val t = remember(nom) { Animatable(0f) }
    LaunchedEffect(nom) { t.animateTo(1_200f, tween(1_200, easing = LinearEasing)) }
    val visuel = image != null || !emoji.isNullOrBlank()
    // Game Show, le nom déjà écrit à côté : le médaillon seul, aussi grand que le cadre le permet (cedric, 30/10 : à
    // 8 équipes « la pastille de Mickey est ridiculement petite »).
    if (!avecNom && visuel) return MedaillonSeul(nom, emoji, image, t.value, modifier)
    Box(modifier.fillMaxSize()) {
        Echelle(560.dp, 400.dp) {
            if (visuel) Box(Modifier.align(Alignment.Center).size(420.dp).graphicsLayer { translationY = -48.dp.toPx() }) { Rayons { t.value } }
            Gerbe(cle = nom)
            Column(
                Modifier.align(Alignment.Center),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                if (visuel) {
                    Box(
                        Modifier
                            .graphicsLayer {
                                val p = (t.value / 450f).coerceIn(0f, 1f)
                                val s = 0.3f + 0.7f * p + 0.18f * sin(p * PI.toFloat())
                                scaleX = s; scaleY = s
                                alpha = p
                            }
                            .size(200.dp)
                            .clip(CircleShape)
                            .background(Brush.radialGradient(listOf(Neon.FondHaut, Neon.Nuit2)))
                            .border(6.dp, Brush.verticalGradient(listOf(Neon.OrClair, Neon.OrProfond)), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        VisuelPersonnage(image, emoji, 110f)
                    }
                    if (avecNom) Spacer(Modifier.height(18.dp))
                }
                if (avecNom || !visuel) {
                    Text(
                        "C'ÉTAIT…",
                        style = TextStyle(fontFamily = PoliceLmp, lineHeight = 1.2.em, lineHeightStyle = LIGNE_LMP, color = Neon.Or, fontSize = if (visuel) 20.sp else 26.sp, fontWeight = FontWeight.Black, letterSpacing = 5.sp),
                        modifier = Modifier.graphicsLayer { alpha = ((t.value - 250f) / 300f).coerceIn(0f, 1f) },
                    )
                    Box(
                        Modifier.graphicsLayer {
                            val p = ((t.value - 350f) / 450f).coerceIn(0f, 1f)
                            val s = 0.6f + 0.4f * p + 0.1f * sin(p * PI.toFloat())
                            scaleX = s; scaleY = s
                            alpha = p
                        },
                    ) {
                        NomUneLigne(nom.ifBlank { "?" }, Neon.OrClair, if (visuel) 64f else 88f, 520.dp)
                    }
                }
            }
        }
    }
}

/** L'image du personnage, ou son émoji à [tailleEmoji] sp, dans le médaillon. */
@Composable
private fun VisuelPersonnage(image: ImageBitmap?, emoji: String?, tailleEmoji: Float) {
    if (image != null) {
        Image(image, contentDescription = null, contentScale = ContentScale.Crop, alignment = com.littlemissparty.quiz.tv.CadrageHaut, modifier = Modifier.fillMaxSize().clip(CircleShape))
    } else {
        Text(emoji.orEmpty(), fontSize = tailleEmoji.sp)
    }
}

/**
 * Choix C de cedric (planche du 1/11, point 35) : à la place du médaillon rond, une photo polaroid blanche un peu
 * penchée, presque aussi grande que sur la planche (cedric, 1/11 à 11 h : « à peine » plus petite, 3 à 5 %). Comme sur
 * la planche, elle sort un peu du cadre ([POLAROID_DEBORD] dp en haut et en bas, la place libre entre l'enseigne et les
 * équipes) : elle grandit avec la place, de 1 à 8 équipes. Rayons et gerbe derrière, rognés au cadre ; elle arrive
 * avec un petit rebond.
 */
@Composable
private fun MedaillonSeul(nom: String, emoji: String?, image: ImageBitmap?, ms: Float, modifier: Modifier) {
    val ecran = LocalConfiguration.current.screenHeightDp.toFloat()
    BoxWithConstraints(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val (largeur, hauteur) = taillePolaroid(maxWidth.value, maxHeight.value, ecran)
        Box(Modifier.fillMaxSize().clipToBounds(), contentAlignment = Alignment.Center) {
            Box(Modifier.size((minOf(maxWidth, maxHeight) * 1.8f))) { Rayons { ms } }
            Gerbe(cle = nom)
        }
        Box(
            Modifier
                .graphicsLayer {
                    val p = (ms / 450f).coerceIn(0f, 1f)
                    // Petit rebond : 1 + 0,04 au plus fort, le temps d'un éclair.
                    val s = 0.3f + 0.7f * p + POLAROID_REBOND * sin(p * PI.toFloat())
                    scaleX = s; scaleY = s
                    alpha = p
                    rotationZ = POLAROID_ANGLE
                }
                // Plus grand que le cadre : il en sort, centré (comme sur la planche).
                .requiredSize(largeur.dp, hauteur.dp)
                .shadow(10.dp, RoundedCornerShape(3.dp), ambientColor = Color.Black, spotColor = Color.Black)
                .background(Color.White, RoundedCornerShape(3.dp))
                // Bord blanc fin sur trois côtés, large en bas, comme un vrai polaroid.
                .padding(start = (largeur * 0.087f).dp, end = (largeur * 0.087f).dp, top = (largeur * 0.087f).dp, bottom = (largeur * 0.28f).dp)
                .clip(RoundedCornerShape(1.dp))
                .background(Brush.radialGradient(listOf(Neon.FondHaut, Neon.Nuit2))),
            contentAlignment = Alignment.Center,
        ) { VisuelPolaroid(image, emoji, largeur * 0.45f) }
    }
}

/** La photo dans le polaroid (cadrée en haut, pour garder le visage), ou l'émoji à [tailleEmoji] sp. */
@Composable
private fun VisuelPolaroid(image: ImageBitmap?, emoji: String?, tailleEmoji: Float) {
    if (image != null) {
        Image(image, contentDescription = null, contentScale = ContentScale.Crop, alignment = com.littlemissparty.quiz.tv.CadrageHaut, modifier = Modifier.fillMaxSize())
    } else {
        Text(emoji.orEmpty(), fontSize = tailleEmoji.sp)
    }
}

/**
 * Largeur et hauteur du polaroid (dp) dans un cadre de [l] × [h] dp, sur un écran de [ecran] dp de haut : les
 * proportions de la planche (0,837), penché de [POLAROID_ANGLE] degrés. Sa boîte penchée peut sortir du cadre de
 * [POLAROID_DEBORD] dp de chaque côté, et sa hauteur ne dépasse jamais [POLAROID_ECRAN] de l'écran (la planche C,
 * 51 % de l'écran, moins 4 %).
 */
internal fun taillePolaroid(l: Float, h: Float, ecran: Float): Pair<Float, Float> {
    val a = Math.toRadians(kotlin.math.abs(POLAROID_ANGLE).toDouble())
    val c = kotlin.math.cos(a).toFloat()
    val s = kotlin.math.sin(a).toFloat()
    // Boîte englobante du polaroid penché, pour une hauteur de 1.
    val bl = POLAROID_RAPPORT * c + s
    val bh = c + POLAROID_RAPPORT * s
    val haut = minOf((l + 2 * POLAROID_DEBORD) / bl, (h + 2 * POLAROID_DEBORD) / bh, ecran * POLAROID_ECRAN)
    return POLAROID_RAPPORT * haut to haut
}

/** Largeur sur hauteur du polaroid (planche du 1/11, choix C). */
internal const val POLAROID_RAPPORT = 0.837f
internal const val POLAROID_ANGLE = -5f
/** La planche C prenait 51 % de la hauteur de l'écran ; « à peine » plus petit, 3 à 5 % (cedric, 1/11 à 11 h). */
internal const val POLAROID_ECRAN = 0.49f
/** Ce qui peut sortir du cadre en haut et en bas : la place libre entre l'enseigne et les équipes (36 à 38 dp, mesuré
 *  sur les captures de 3 et 8 équipes). */
internal const val POLAROID_DEBORD = 36f
internal const val POLAROID_REBOND = 0.04f
