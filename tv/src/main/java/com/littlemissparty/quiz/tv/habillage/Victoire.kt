package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlin.math.PI

/** Une équipe au classement final, telle que la célébration l'affiche. */
data class Classee(val nom: String, val couleur: Color, val points: Int)

/**
 * Célébration de fin de partie, calée sur les sons déjà joués par le DirecteurSonore (long roulement qui monte,
 * puis impact, fanfare et applaudissements à [Tempo.FIN_VAINQUEUR], cloches, jingle à [Tempo.FIN_JINGLE]) :
 * - 0 s : la salle s'assombrit, le logo Little Miss Party arrive en grand au centre, rayons dorés derrière lui,
 *   « Le grand gagnant de la soirée est… » ;
 * - suspense : les cartes de toutes les équipes (1 à 8), un projecteur saute de l'une à l'autre, de plus en plus
 *   vite puis de plus en plus lentement, et s'arrête sur le vainqueur juste avant l'impact ;
 * - impact : flash, les autres cartes s'effacent, le nom du vainqueur claque au centre, couronne, rayons,
 *   feux d'artifice et confettis, le logo bat au-dessus ;
 * - puis les points, « Bravo à toutes les équipes ! » et les autres équipes en bande compacte.
 * Égalité : le projecteur finit sur toutes les équipes à égalité, « Égalité ! », chacune couronnée. Personne n'a
 * marqué : pas de projecteur ni de couronne, « Bravo à toutes les équipes ! ». Seuls échelle, position et
 * opacité bougent (calques en cache) : léger pour la Mi Box.
 */
@Composable
fun Victoire(classement: List<Classee>, modifier: Modifier = Modifier) {
    val meilleur = classement.firstOrNull()?.points ?: 0
    val gagnants = if (meilleur > 0) classement.takeWhile { it.points == meilleur } else emptyList()
    val autres = classement.drop(gagnants.size)
    val t = remember { Animatable(0f) }
    // L'horloge s'arrête après le jingle : l'écran reste vivant (confettis) sans redessiner les rayons pour rien.
    LaunchedEffect(Unit) { t.animateTo(FIN_HORLOGE_MS, tween(FIN_HORLOGE_MS.toInt(), easing = LinearEasing)) }
    val ms = { t.value }
    val impact = Tempo.FIN_VAINQUEUR.toFloat()
    // Ordre d'affichage des cartes du suspense : mélangé une fois, pour que le vainqueur ne soit pas toujours en premier.
    val cartes = remember(classement) { classement.shuffled(java.util.Random(classement.hashCode().toLong())) }
    val sauts = remember(cartes, gagnants) { sautsProjecteur(cartes.size, cartes.indexOfFirst { it in gagnants }) }
    Box(modifier.fillMaxSize()) {
        // Salle assombrie pendant le suspense, qui se rallume sur l'impact.
        Box(
            Modifier.fillMaxSize().graphicsLayer {
                val m = ms()
                alpha = when {
                    m < 800f -> m / 800f * 0.55f
                    m < impact -> 0.55f
                    else -> (0.55f * (1f - (m - impact) / 600f)).coerceAtLeast(0f)
                }
            }.background(Neon.Nuit),
        )
        if (gagnants.isNotEmpty()) Rayons { (ms() - impact).coerceAtLeast(0f) }
        Echelle(960.dp, 540.dp) {
            // Le logo : en grand au centre au début, puis en haut, où il bat sur l'impact et sur le jingle.
            Box(
                Modifier.align(Alignment.TopCenter).padding(top = 14.dp).graphicsLayer {
                    val m = ms()
                    val entree = (m / 900f).coerceIn(0f, 1f)
                    val monte = ((m - 1_300f) / 700f).coerceIn(0f, 1f).let { it * it * (3 - 2 * it) }
                    val coup = battement(m - impact, 700f) * 0.18f + battement(m - Tempo.FIN_JINGLE, 600f) * 0.12f
                    val s = (0.6f + 0.4f * entree) * (1.9f - 0.9f * monte) * (1f + coup)
                    scaleX = s; scaleY = s
                    translationY = (1f - monte) * 150.dp.toPx()
                    alpha = entree
                },
            ) {
                // Halo doré derrière le logo, plus fort après l'impact.
                Box(
                    Modifier.align(Alignment.Center).size(300.dp, 140.dp).graphicsLayer {
                        val m = ms()
                        alpha = if (m < impact) 0.45f + 0.15f * kotlin.math.sin(m / 160f) else 0.85f
                    }.background(Brush.radialGradient(listOf(Neon.Or.copy(alpha = 0.55f), Color.Transparent))),
                )
                LogoMarque(96.dp)
            }
            Column(
                Modifier.fillMaxSize().padding(start = 40.dp, end = 40.dp, top = 128.dp, bottom = 18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                    // Le suspense : « Le grand gagnant… » et les cartes des équipes sous le projecteur.
                    if (gagnants.isNotEmpty()) {
                        Column(
                            Modifier.graphicsLayer {
                                val m = ms()
                                alpha = if (m < impact) 1f else (1f - (m - impact) / 300f).coerceAtLeast(0f)
                            },
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(
                                "Le grand gagnant de la soirée est…",
                                color = Neon.Blanc, fontSize = 30.sp, fontWeight = FontWeight.Black, letterSpacing = 1.sp, maxLines = 1,
                                modifier = Modifier.apparition(1_400, Unit).graphicsLayer {
                                    alpha = 0.75f + 0.25f * kotlin.math.sin(ms() / 220f)
                                },
                            )
                            Spacer(Modifier.height(18.dp))
                            CartesSuspense(cartes, gagnants, sauts, ms)
                        }
                    }
                    // La révélation.
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        if (gagnants.size > 1) {
                            Text(
                                "Égalité !",
                                style = TextStyle(fontFamily = PoliceLmp, lineHeight = 1.2.em, lineHeightStyle = LIGNE_LMP, color = Neon.Or, fontSize = 36.sp, fontWeight = FontWeight.Black, shadow = Shadow(Neon.Or, Offset.Zero, 20f)),
                                maxLines = 1, modifier = Modifier.apparition(Tempo.FIN_VAINQUEUR, Unit),
                            )
                        }
                        if (gagnants.isNotEmpty()) {
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
                                modifier = Modifier.apparition(Tempo.FIN_VAINQUEUR + 3_000, Unit),
                            )
                        } else {
                            Text(
                                "Bravo à toutes les équipes !",
                                style = TextStyle(fontFamily = PoliceLmp, color = Neon.Or, fontSize = 54.sp, lineHeight = 60.sp, fontWeight = FontWeight.Black, shadow = Shadow(Neon.Or, Offset.Zero, 24f)),
                                textAlign = TextAlign.Center, maxLines = 2, modifier = Modifier.apparition(2_000, Unit),
                            )
                            Spacer(Modifier.height(10.dp))
                            Text("Merci d'avoir joué !", color = Neon.Blanc, fontSize = 30.sp, fontWeight = FontWeight.Bold, modifier = Modifier.apparition(2_800, Unit))
                        }
                    }
                }
                if (autres.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    BandeAutres(autres, classement, Modifier.apparition(if (gagnants.isEmpty()) 3_400L else Tempo.FIN_VAINQUEUR + 2_500L, Unit))
                }
            }
        }
        // Flash blanc sur l'impact.
        if (gagnants.isNotEmpty()) {
            Box(
                Modifier.fillMaxSize()
                    .graphicsLayer {
                        val x = (ms() - impact) / 500f
                        alpha = if (x < 0f || x > 1f) 0f else 0.65f * (1f - x)
                    }
                    .background(Color.White),
            )
            FeuxDArtifice(ms, impact)
        }
        Confettis(if (gagnants.isEmpty()) 2_000L else Tempo.FIN_VAINQUEUR)
    }
}

/** Horloge de l'écran final : jusqu'un peu après le jingle. */
private const val FIN_HORLOGE_MS = 20_000f

/** Battement bref (0 → 1 → 0) pendant [duree] ms après un instant (x = temps écoulé depuis cet instant). */
private fun battement(x: Float, duree: Float): Float = if (x < 0f || x > duree) 0f else kotlin.math.sin(x / duree * PI.toFloat())

/** Début du saut du projecteur, et fin : il s'arrête sur le vainqueur un peu avant l'impact. */
private const val SAUTS_DEBUT = 2_000f
private const val SAUTS_FIN = 6_300f

/**
 * Le projecteur du suspense : instants (ms) et cartes éclairées. Il accélère, puis ralentit pour finir sur
 * [cible] (la carte du vainqueur, ou la première des ex aequo) ; deux fois de suite la même carte, jamais.
 */
internal fun sautsProjecteur(n: Int, cible: Int): List<Pair<Float, Int>> {
    if (n <= 1 || cible < 0) return listOf(SAUTS_DEBUT to cible.coerceAtLeast(0))
    // Intervalles : 420 ms au début, 120 ms au plus vite, 650 ms pour les derniers sauts.
    val intervalles = listOf(420f, 340f, 260f, 200f, 150f, 120f, 120f, 120f, 120f, 130f, 150f, 190f, 250f, 330f, 450f, 650f)
    val total = intervalles.sum()
    val echelle = (SAUTS_FIN - SAUTS_DEBUT) / total
    val r = java.util.Random(n * 7919L + cible)
    val cartes = IntArray(intervalles.size + 1)
    cartes[cartes.size - 1] = cible
    for (k in cartes.size - 2 downTo 0) {
        var c: Int
        do { c = r.nextInt(n) } while (c == cartes[k + 1])
        cartes[k] = c
    }
    var instant = SAUTS_DEBUT
    return cartes.mapIndexed { k, c ->
        val p = instant to c
        if (k < intervalles.size) instant += intervalles[k] * echelle
        p
    }
}

/** Cartes des équipes pendant le suspense : celle sous le projecteur grandit et s'allume, les autres s'éteignent. */
@Composable
private fun CartesSuspense(cartes: List<Classee>, gagnants: List<Classee>, sauts: List<Pair<Float, Int>>, ms: () -> Float) {
    val parLigne = if (cartes.size <= 4) cartes.size else (cartes.size + 1) / 2
    val largeur = if (cartes.size <= 4) 210.dp else 205.dp
    Column(verticalArrangement = Arrangement.spacedBy(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        cartes.withIndex().chunked(parLigne).forEach { ligne ->
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                ligne.forEach { (k, e) ->
                    val gagnant = e in gagnants
                    Box(
                        Modifier.apparition(1_600L + k * 90L, Unit).width(largeur).graphicsLayer {
                            val m = ms()
                            val eclairee = when {
                                m < SAUTS_DEBUT -> false
                                // À la fin, toutes les équipes ex aequo s'allument ensemble.
                                m >= SAUTS_FIN -> gagnant
                                else -> sauts.lastOrNull { it.first <= m }?.second == k
                            }
                            val s = if (eclairee) 1.14f else 0.94f
                            scaleX = s; scaleY = s
                            alpha = if (m < SAUTS_DEBUT || eclairee) 1f else 0.45f
                        }
                            .clip(RoundedCornerShape(22.dp))
                            .background(Brush.verticalGradient(listOf(Color(0xFF2A1250), Color(0xFF14082A))))
                            .border(4.dp, e.couleur, RoundedCornerShape(22.dp))
                            .padding(horizontal = 14.dp, vertical = 14.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        // Le nom entier sur une ligne, réduit s'il est long : on doit reconnaître chaque équipe.
                        NomUneLigne(e.nom, e.couleur, 26f, largeur - 28.dp, tailleMin = 13f)
                    }
                }
            }
        }
    }
}

/**
 * Feux d'artifice après l'impact : des gerbes d'étincelles qui éclatent à différents endroits du ciel, l'une
 * après l'autre, puis retombent. Un seul Canvas, positions et couleurs calculées une fois.
 */
@Composable
private fun FeuxDArtifice(ms: () -> Float, impact: Float) {
    val bouquets = remember {
        val couleurs = listOf(Neon.Or, Color(0xFFFF2D8A), Color(0xFF7CFF3A), Color(0xFF3AD7FF), Color(0xFFFFE61F), Neon.OrClair)
        listOf(0.18f to 0.28f, 0.82f to 0.24f, 0.32f to 0.18f, 0.68f to 0.36f, 0.12f to 0.5f, 0.88f to 0.48f, 0.5f to 0.14f, 0.25f to 0.4f)
            .mapIndexed { k, (x, y) -> Triple(Offset(x, y), impact + 150f + k * 650f, couleurs[k % couleurs.size]) }
    }
    Canvas(Modifier.fillMaxSize().clearAndSetSemantics {}) {
        val m = ms()
        val r0 = size.minDimension * 0.3f
        bouquets.forEach { (pos, debut, couleur) ->
            val x = (m - debut) / 1_300f
            if (x <= 0f || x >= 1f) return@forEach
            val c = Offset(pos.x * size.width, pos.y * size.height)
            val ouvre = 1f - (1f - x) * (1f - x) * (1f - x)
            val chute = x * x * size.height * 0.08f
            for (i in 0 until 32) {
                val a = i * (2 * PI.toFloat() / 32)
                val d = r0 * ouvre * (0.75f + 0.25f * ((i * 37) % 7) / 6f)
                val p = Offset(c.x + kotlin.math.cos(a) * d, c.y + kotlin.math.sin(a) * d + chute)
                drawCircle(couleur.copy(alpha = (1f - x).coerceIn(0f, 1f)), size.minDimension * 0.008f * (1.2f - x * 0.6f), p)
            }
            if (x < 0.15f) drawCircle(Color.White.copy(alpha = 0.45f * (1f - x / 0.15f)), r0 * 0.1f, c)
        }
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
        style = TextStyle(fontFamily = PoliceLmp,
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
                        style = TextStyle(fontFamily = PoliceLmp, color = g.couleur, fontSize = taille, lineHeight = taille * 1.12f, fontWeight = FontWeight.Black, shadow = Shadow(Neon.Or.copy(alpha = 0.8f), Offset.Zero, 14f)),
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
