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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
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
 * Le médaillon seul, centré, de [MEDAILLON_PART] de la plus petite dimension du cadre : il grandit avec la place, de 1
 * à 8 équipes, et ne déborde jamais. Rayons et gerbe derrière, rognés au cadre.
 */
@Composable
private fun MedaillonSeul(nom: String, emoji: String?, image: ImageBitmap?, ms: Float, modifier: Modifier) {
    BoxWithConstraints(modifier.fillMaxSize().clipToBounds(), contentAlignment = Alignment.Center) {
        val cote = minOf(maxWidth, maxHeight) * MEDAILLON_PART
        Box(Modifier.size(cote * 2.1f)) { Rayons { ms } }
        Gerbe(cle = nom)
        Box(
            Modifier
                .graphicsLayer {
                    val p = (ms / 450f).coerceIn(0f, 1f)
                    // Le rebond reste dans le cadre : 1 + 0,08 au plus fort.
                    val s = 0.3f + 0.7f * p + 0.08f * sin(p * PI.toFloat())
                    scaleX = s; scaleY = s
                    alpha = p
                }
                .size(cote)
                .clip(CircleShape)
                .background(Brush.radialGradient(listOf(Neon.FondHaut, Neon.Nuit2)))
                .border(cote * 0.03f, Brush.verticalGradient(listOf(Neon.OrClair, Neon.OrProfond)), CircleShape),
            contentAlignment = Alignment.Center,
        ) { VisuelPersonnage(image, emoji, cote.value * 0.55f) }
    }
}

/** Part de la plus petite dimension du cadre prise par le médaillon seul (le rebond monte à × 1,08). */
internal const val MEDAILLON_PART = 0.86f
