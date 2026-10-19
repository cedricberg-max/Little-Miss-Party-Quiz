package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/** Une équipe au classement final, telle que la célébration l'affiche. */
data class Classee(val nom: String, val couleur: Color, val points: Int)

/**
 * Célébration de fin de partie, calée sur les sons déjà joués par le DirecteurSonore (roulement, puis impact,
 * fanfare et applaudissements à [Tempo.FIN_VAINQUEUR], cloches, jingle à [Tempo.FIN_JINGLE]) :
 * - 0 s : projecteur qui balaie, « Et la victoire revient à… » ;
 * - impact : le nom du vainqueur claque au centre, aux couleurs de l'équipe, flash, rayons dorés, couronne ;
 * - puis les points, « Bravo à toutes les équipes ! », les autres équipes en bande compacte (de 1 à 7),
 *   et le logo Little Miss Party en signature.
 * Égalité : « Égalité ! » et tous les noms à égalité, chacun couronné. Personne n'a marqué : pas de couronne,
 * « Bravo à toutes les équipes ! » au centre. Calques en cache, seuls échelle, rotation et opacité bougent.
 */
@Composable
fun Victoire(classement: List<Classee>, modifier: Modifier = Modifier) {
    val meilleur = classement.firstOrNull()?.points ?: 0
    val gagnants = if (meilleur > 0) classement.takeWhile { it.points == meilleur } else emptyList()
    val autres = classement.drop(gagnants.size)
    val t = remember { Animatable(0f) }
    // L'horloge s'arrête après le jingle : l'écran reste vivant (confettis) sans redessiner les rayons pour rien.
    LaunchedEffect(Unit) { t.animateTo(14_000f, tween(14_000, easing = LinearEasing)) }
    val ms = { t.value }
    val impact = Tempo.FIN_VAINQUEUR.toFloat()
    Box(modifier.fillMaxSize()) {
        Projecteur(ms)
        if (gagnants.isNotEmpty()) Rayons { (ms() - impact).coerceAtLeast(0f) }
        Echelle(960.dp, 540.dp) {
            Column(
                Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 22.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Spacer(Modifier.weight(1f))
                when {
                    gagnants.size == 1 -> Text(
                        "Et la victoire revient à…",
                        color = Neon.Blanc.copy(alpha = 0.85f), fontSize = 26.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp,
                        maxLines = 1, modifier = Modifier.apparition(300, Unit),
                    )
                    gagnants.size > 1 -> Text(
                        "Égalité !",
                        style = TextStyle(color = Neon.Or, fontSize = 36.sp, fontWeight = FontWeight.Black, shadow = Shadow(Neon.Or, Offset.Zero, 20f)),
                        maxLines = 1, modifier = Modifier.apparition(300, Unit),
                    )
                }
                if (gagnants.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    // Pour les lecteurs d'écran (et les tests) : « Victoire de … » en une phrase.
                    Column(
                        Modifier.clearAndSetSemantics { text = AnnotatedString("Victoire de " + gagnants.joinToString(" et ") { it.nom }) },
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Couronne(apres(Tempo.FIN_VAINQUEUR + 400, Unit), Modifier.size(if (gagnants.size == 1) 84.dp else 60.dp, if (gagnants.size == 1) 58.dp else 42.dp))
                        if (gagnants.size == 1) NomVainqueur(gagnants[0], impact) else NomsEgalite(gagnants)
                    }
                    Text(
                        "$meilleur points",
                        color = Neon.Or, fontSize = 28.sp, fontWeight = FontWeight.Black, maxLines = 1,
                        modifier = Modifier.apparition(Tempo.FIN_VAINQUEUR + 700, Unit),
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "Bravo à toutes les équipes !",
                        color = Neon.Blanc, fontSize = 28.sp, fontWeight = FontWeight.Bold, maxLines = 1,
                        modifier = Modifier.apparition(5_000, Unit),
                    )
                } else {
                    Text(
                        "Bravo à toutes les équipes !",
                        style = TextStyle(color = Neon.Or, fontSize = 54.sp, lineHeight = 60.sp, fontWeight = FontWeight.Black, shadow = Shadow(Neon.Or, Offset.Zero, 24f)),
                        textAlign = TextAlign.Center, maxLines = 2, modifier = Modifier.apparition(300, Unit),
                    )
                    Spacer(Modifier.height(10.dp))
                    Text("Merci d'avoir joué !", color = Neon.Blanc, fontSize = 30.sp, fontWeight = FontWeight.Bold, modifier = Modifier.apparition(1_200, Unit))
                }
                Spacer(Modifier.weight(1f))
                if (autres.isNotEmpty()) {
                    BandeAutres(autres, classement, Modifier.apparition(if (gagnants.isEmpty()) 1_800L else 4_500L, Unit))
                    Spacer(Modifier.height(12.dp))
                }
                // Signature : le logo, petit, en bas ; il pompe une fois sur le jingle.
                LogoLmp(
                    40.dp,
                    Modifier.apparition(if (gagnants.isEmpty()) 2_400L else 5_500L, Unit).rebond(apres(Tempo.FIN_JINGLE, Unit), 0.12f),
                )
            }
        }
        // Flash blanc bref sur l'impact.
        if (gagnants.isNotEmpty()) {
            Box(
                Modifier.fillMaxSize()
                    .graphicsLayer {
                        val x = (ms() - impact) / 400f
                        alpha = if (x < 0f || x > 1f) 0f else 0.5f * (1f - x)
                    }
                    .background(Color.White),
            )
        }
        Confettis(if (gagnants.isEmpty()) 600L else Tempo.FIN_VAINQUEUR)
    }
}

/** Le nom du vainqueur claque sur l'impact : de 1,6 à 1 avec un rebond, très grand, aux couleurs de l'équipe. */
@Composable
private fun NomVainqueur(g: Classee, impact: Float) {
    val v = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(impact.toLong())
        v.animateTo(1f, spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessMediumLow))
    }
    val taille = when {
        g.nom.length <= 10 -> 96.sp
        g.nom.length <= 16 -> 74.sp
        else -> 56.sp
    }
    Text(
        g.nom,
        style = TextStyle(
            color = g.couleur, fontSize = taille, lineHeight = taille * 1.08f, fontWeight = FontWeight.Black,
            // Liseré or : un halo doré serré sous le halo de la couleur d'équipe.
            shadow = Shadow(Neon.Or.copy(alpha = 0.9f), Offset.Zero, 18f),
        ),
        textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.graphicsLayer {
            val x = v.value
            alpha = x.coerceIn(0f, 1f)
            val s = 1.6f - 0.6f * x
            scaleX = s
            scaleY = s
        },
    )
}

/** Égalité : un nom par ligne jusqu'à 3, deux par ligne au-delà ; chacun dans sa couleur, jamais rogné à 2 ou 3. */
@Composable
private fun NomsEgalite(gagnants: List<Classee>) {
    val taille = when (gagnants.size) {
        2 -> 52.sp
        3 -> 40.sp
        else -> 28.sp
    }
    val rangs = gagnants.chunked(if (gagnants.size <= 3) 1 else 2)
    Column(
        Modifier.apparition(Tempo.FIN_VAINQUEUR, Unit),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        rangs.forEach { rang ->
            Row(horizontalArrangement = Arrangement.spacedBy(28.dp), verticalAlignment = Alignment.CenterVertically) {
                rang.forEach { g ->
                    Text(
                        g.nom,
                        style = TextStyle(color = g.couleur, fontSize = taille, lineHeight = taille * 1.12f, fontWeight = FontWeight.Black, shadow = Shadow(Neon.Or.copy(alpha = 0.8f), Offset.Zero, 14f)),
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = if (rang.size == 1) 880.dp else 430.dp),
                    )
                }
            }
        }
    }
}

/** Les autres équipes (de 1 à 7), en pastilles compactes centrées, jusqu'à 3 par ligne. */
@Composable
private fun BandeAutres(autres: List<Classee>, classement: List<Classee>, modifier: Modifier) {
    // Trois pastilles par ligne au plus : les noms restent lisibles même à 8 équipes (3 + 3 + 1).
    val parLigne = when {
        autres.size <= 3 -> autres.size
        autres.size == 4 -> 2
        else -> 3
    }
    val compacte = autres.size > 4
    // Largeur d'une pastille : toute la ligne disponible (880 dp) partagée, pour que les noms restent lisibles.
    val largeur = ((880 - 10 * (parLigne - 1)) / parLigne).coerceAtMost(320).dp
    val taille = if (compacte) 16.sp else 17.sp
    val avecPoints = classement.any { it.points > 0 }
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        autres.chunked(parLigne).forEach { ligne ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ligne.forEach { e ->
                    // Rang « olympique » : deux équipes à égalité partagent le même rang. Personne n'a marqué : juste les noms.
                    val rang = 1 + classement.count { it.points > e.points }
                    Row(
                        Modifier.widthIn(max = largeur).clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.12f))
                            .padding(horizontal = if (compacte) 10.dp else 14.dp, vertical = if (compacte) 5.dp else 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (avecPoints) {
                            Text("$rang", color = Neon.Or, fontSize = taille, fontWeight = FontWeight.Black, maxLines = 1)
                            Spacer(Modifier.width(6.dp))
                        }
                        Box(Modifier.size(14.dp).clip(CircleShape).background(e.couleur))
                        Spacer(Modifier.width(8.dp))
                        Text(
                            e.nom, color = Neon.Blanc, fontSize = taille, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        if (avecPoints) {
                            Spacer(Modifier.width(8.dp))
                            Text("${e.points}", color = Neon.Blanc.copy(alpha = 0.8f), fontSize = taille, fontWeight = FontWeight.Black, maxLines = 1)
                        }
                    }
                }
            }
        }
    }
}

/** Projecteur doré qui balaie l'écran de gauche à droite pendant le roulement, avant l'impact. */
@Composable
private fun Projecteur(ms: () -> Float) {
    Box(
        Modifier.fillMaxSize()
            .graphicsLayer {
                val x = (ms() / Tempo.FIN_VAINQUEUR.toFloat()).coerceIn(0f, 1.2f)
                translationX = (x - 0.5f) * size.width * 1.1f
                alpha = if (x >= 1.2f) 0f else (1.2f - x).coerceIn(0f, 1f)
            }
            .drawWithCache {
                val c = Offset(size.width / 2, size.height * 0.45f)
                val pinceau = Brush.radialGradient(listOf(Neon.Or.copy(alpha = 0.28f), Color.Transparent), c, size.height * 0.55f)
                onDrawBehind { drawCircle(pinceau, size.height * 0.55f, c) }
            },
    )
}
