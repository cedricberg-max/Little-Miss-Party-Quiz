package com.littlemissparty.quiz.tv.habillage

import com.littlemissparty.quiz.tv.R
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * Game Show : le logo du jeu en tube néon (planche du 24/10, cedric : plus d'émoji), dessiné à l'avance avec son halo
 * sur fond transparent (res/drawable-nodpi/gs_logo_*.webp). null : le jeu garde son émoji.
 */
fun logoNeonJeu(famille: String): Int? = when (famille.lowercase()) {
    "quiz" -> R.drawable.gs_logo_quiz
    "illustre" -> R.drawable.gs_logo_illustre
    "mimes", "mime" -> R.drawable.gs_logo_mimes
    "blind", "blindtest" -> R.drawable.gs_logo_blind
    "musical", "quizmusical" -> R.drawable.gs_logo_musical
    "express", "vraifaux" -> R.drawable.gs_logo_express
    "juste", "number", "justechiffre" -> R.drawable.gs_logo_juste
    "zoom" -> R.drawable.gs_logo_zoom
    "flou" -> R.drawable.gs_logo_flou
    "chante" -> R.drawable.gs_logo_chante
    "quisuis" -> R.drawable.gs_logo_quisuis
    "disparu" -> R.drawable.gs_logo_disparu
    "statues" -> R.drawable.gs_logo_statues
    "pictionary" -> R.drawable.gs_logo_pictionary
    "bombe", "coffres", "bombecachee" -> R.drawable.gs_logo_coffres
    "gonfleur", "ballons" -> R.drawable.gs_logo_gonfleur
    "patate", "patatechaude" -> R.drawable.gs_logo_patate
    else -> null
}

/** Emblème d'un jeu sur l'écran de présentation : emoji (rendu sur Android 9) et couleur du halo. */
class EmblemeJeu(val emoji: String, val couleur: Color)

/**
 * Emblème d'après la famille du jeu (« quiz », « mimes », « blind », « musical », « express », « juste », « zoom »,
 * « flou », « chante », « quisuis », « disparu », « statues », « pictionary », « portes », « bombe », « gonfleur »,
 * « patate ») ; un mot inconnu donne celui du quiz.
 */
fun emblemeJeu(famille: String): EmblemeJeu = when (famille.lowercase()) {
    "mimes", "mime" -> EmblemeJeu("🎭", Color(0xFFFF2D8A))
    "blind", "blindtest" -> EmblemeJeu("🎧", Color(0xFFB56BFF))
    "musical", "quizmusical" -> EmblemeJeu("🎶", Color(0xFFB56BFF))
    "express", "vraifaux" -> EmblemeJeu("✅", Color(0xFF2EE86B))
    "juste", "number", "justechiffre" -> EmblemeJeu("🔢", Color(0xFF2EE8E0))
    "zoom" -> EmblemeJeu("🔍", Color(0xFF2EE8E0))
    "flou" -> EmblemeJeu("🖼️", Color(0xFF6FA8FF))
    "chante" -> EmblemeJeu("🎤", Color(0xFFFF5A1F))
    "quisuis" -> EmblemeJeu("🕵️", Color(0xFFFFE61F))
    "disparu" -> EmblemeJeu("👀", Color(0xFF7CFF3A))
    "statues" -> EmblemeJeu("🗿", Color(0xFF6FA8FF))
    "pictionary" -> EmblemeJeu("🎨", Color(0xFFFF2D8A))
    "portes" -> EmblemeJeu("🚪", Color(0xFFF0CC92))
    "bombe", "coffres", "bombecachee" -> EmblemeJeu("🗝️", Color(0xFFF0CC92))
    "gonfleur", "ballons" -> EmblemeJeu("🎈", Color(0xFFFF2D8A))
    "patate", "patatechaude" -> EmblemeJeu("💣", Color(0xFFFF5A1F))
    else -> EmblemeJeu("❓", Color(0xFFF0CC92))
}

/**
 * Écran de présentation d'un jeu, avant sa première question : « PROCHAIN JEU », l'emblème du jeu qui flotte
 * dans un médaillon doré au milieu de rayons qui tournent lentement, et le nom du jeu en grand. Aucune règle :
 * Sarah présente le jeu de vive voix puis le lance depuis la régie. Tourne en boucle, calmement, aussi longtemps
 * qu'il le faut ; fond transparent (le plateau reste derrière), rien de focalisable, ne joue aucun son. Le titre
 * reste un texte visible (tests émulateur).
 */
@Composable
fun PresentationJeu(titre: String, famille: String, modifier: Modifier = Modifier, video: Boolean = true) {
    // Design « The Game Show » : l'intro vidéo du jeu quand il en a une (voir [IntroJeuGameShow]), sinon l'emblème.
    if (Look.gs) {
        val nom = nomIntroJeu(famille)
        return if (nom != null) IntroJeuGameShow(titre, famille, nom, video, modifier) else PresentationJeuGameShow(titre, famille, modifier)
    }
    val embleme = emblemeJeu(famille)
    val boucle = rememberInfiniteTransition(label = "presentation")
    val tour by boucle.animateFloat(0f, 360f, infiniteRepeatable(tween(40_000, easing = LinearEasing)), label = "tour")
    val flotte by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(3_200), RepeatMode.Reverse), label = "flotte")
    val scintille by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(14_000, easing = LinearEasing)), label = "scintille")
    val reflet by boucle.animateFloat(-0.4f, 1.4f, infiniteRepeatable(tween(7_000, easing = LinearEasing)), label = "reflet")
    Echelle(960.dp, 540.dp, modifier.fillMaxSize()) {
        // Rayons dorés qui tournent très lentement derrière le médaillon.
        Box(
            Modifier.align(Alignment.Center).padding(bottom = 120.dp).size(520.dp)
                .graphicsLayer { rotationZ = tour; alpha = 0.9f }
                .drawWithCache {
                    val c = Offset(size.width / 2, size.height / 2)
                    val r = size.minDimension / 2
                    val pinceau = Brush.radialGradient(listOf(embleme.couleur.copy(alpha = 0.22f), Neon.Or.copy(alpha = 0.06f), Color.Transparent), c, r)
                    val rayons = (0 until 16).map { i ->
                        val a = Math.toRadians(i * 22.5)
                        Path().apply {
                            moveTo(c.x, c.y)
                            lineTo(c.x + (r * cos(a - 0.08)).toFloat(), c.y + (r * sin(a - 0.08)).toFloat())
                            lineTo(c.x + (r * cos(a + 0.08)).toFloat(), c.y + (r * sin(a + 0.08)).toFloat())
                            close()
                        }
                    }
                    onDrawBehind { rayons.forEach { drawPath(it, pinceau) } }
                },
        )
        Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.apparition(0, titre)) {
                FiletOr()
                Text(
                    "PROCHAIN JEU", maxLines = 1, softWrap = false, modifier = Modifier.padding(horizontal = 16.dp),
                    style = TextStyle(fontFamily = PoliceLmp, lineHeight = 1.2.em, lineHeightStyle = LIGNE_LMP, color = Neon.Or, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 8.sp),
                )
                FiletOr()
            }
            Spacer(Modifier.height(18.dp))
            // Médaillon : anneau doré, halo de la couleur du jeu, emblème qui flotte doucement ; étincelles autour.
            Box(
                Modifier.size(190.dp).apparition(250, titre)
                    .graphicsLayer { translationY = (flotte - 0.5f) * 14.dp.toPx() }
                    .drawBehind {
                        val c = Offset(size.width / 2, size.height / 2)
                        val r = size.minDimension / 2
                        drawCircle(Brush.radialGradient(listOf(embleme.couleur.copy(alpha = 0.45f), Color.Transparent), c, r * 1.5f), r * 1.5f, c)
                        drawCircle(Brush.radialGradient(listOf(Color(0xFF3A1466), Neon.Nuit2), c, r), r * 0.9f, c)
                        drawCircle(Brush.sweepGradient(listOf(Neon.OrProfond, Neon.OrClair, Neon.Or, Neon.OrProfond, Neon.OrClair, Neon.OrProfond), c), r * 0.9f, c, style = Stroke(6.dp.toPx()))
                        drawCircle(Neon.Or.copy(alpha = 0.35f), r * 0.78f, c, style = Stroke(1.5.dp.toPx()))
                        for (k in 0 until 6) {
                            val onde = 0.5f + 0.5f * sin(2f * PI.toFloat() * (scintille * (1 + k % 3) + k / 6f))
                            val a = 2f * PI.toFloat() * (k / 6f + scintille * 0.25f)
                            val p = Offset(c.x + cos(a) * r * 1.22f, c.y + sin(a) * r * 1.22f)
                            drawCircle(Neon.Blanc.copy(alpha = 0.15f + 0.6f * onde * onde), (2.2f + 1.6f * (k % 2)).dp.toPx(), p)
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text(embleme.emoji, style = TextStyle(fontSize = 92.sp, textAlign = TextAlign.Center))
            }
            Spacer(Modifier.height(26.dp))
            val taille = when {
                titre.length <= 16 -> 84.sp
                titre.length <= 26 -> 62.sp
                else -> 46.sp
            }
            Text(
                titre,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 60.dp).apparition(500, titre),
                style = TextStyle(
                    fontFamily = PoliceLmp, fontSize = taille, lineHeight = taille * 1.08f, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center,
                    // Reflet clair qui traverse le titre doré toutes les 7 secondes.
                    brush = Brush.linearGradient(
                        0f to Neon.Or, (reflet - 0.15f).coerceIn(0f, 1f) to Neon.Or, reflet.coerceIn(0f, 1f) to Neon.Blanc, (reflet + 0.15f).coerceIn(0f, 1f) to Neon.Or, 1f to Neon.OrProfond,
                        start = Offset(0f, 0f), end = Offset(1400f, 300f),
                    ),
                    shadow = Shadow(Neon.Or.copy(alpha = 0.55f), blurRadius = 28f),
                ),
            )
        }
    }
}

@Composable
private fun FiletOr() {
    Box(Modifier.width(80.dp).height(2.dp).drawBehind { drawRect(Brush.horizontalGradient(listOf(Neon.Or.copy(alpha = 0f), Neon.Or, Neon.Or.copy(alpha = 0f)))) })
}
