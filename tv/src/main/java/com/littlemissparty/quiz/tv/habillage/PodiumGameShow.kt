package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.lueurNeon
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

/**
 * Le podium du design « The Game Show », calé sur gs_podium (Digital Love, demande de cedric du 23 octobre) :
 * - 0 → [Tempo.PODIUM_REVELATION] : « why don't you play the game » et le roulement. Les jauges de toutes les équipes
 *   (1 à 8, dans un ordre mélangé) montent ensemble ; chaque équipe s'arrête à son score, la moins bonne d'abord. Les
 *   dernières secondes, sur la montée, seules les jauges du meilleur score grimpent encore, de plus en plus lentement,
 *   jusqu'en haut ;
 * - le solo de guitare : flash, le nom du gagnant claque au centre avec sa couronne, ses points, les feux d'artifice et
 *   les confettis ; au-dessus du nom, le robot 3D arrive du fond de la scène, le félicite puis danse tant que la chanson
 *   continue ([ClipRobotEnBoucle], vidéo calculée à l'avance) ; les autres équipes en bande en bas ;
 * - à [Tempo.PODIUM_FIN], quand la chanson s'éteint : l'écran de fin ([AuRevoirGameShow]).
 * Égalité : toutes les équipes à égalité montent jusqu'en haut et sont couronnées. Personne n'a marqué : les jauges
 * restent vides et « Bravo à toutes les équipes ! » arrive au solo. Les jauges ne montrent que les scores déjà
 * calculés : rien ici ne compte de points. Seuls échelle, position et opacité bougent (calques), léger pour la Mi Box.
 */
@Composable
fun PodiumGameShow(classement: List<Classee>, modifier: Modifier = Modifier) {
    if (apres(Tempo.PODIUM_FIN, Unit)) return AuRevoirGameShow(modifier)
    val meilleur = classement.firstOrNull()?.points ?: 0
    val gagnants = if (meilleur > 0) classement.takeWhile { it.points == meilleur } else emptyList()
    val autres = classement.drop(gagnants.size)
    val t = remember { Animatable(0f) }
    // L'horloge s'arrête quand les feux d'artifice sont finis : la suite (danse, confettis) vit sans elle.
    LaunchedEffect(Unit) { t.animateTo(HORLOGE_PODIUM_MS, tween(HORLOGE_PODIUM_MS.toInt(), easing = LinearEasing)) }
    val ms = { t.value }
    val revelation = Tempo.PODIUM_REVELATION.toFloat()
    // Ordre des colonnes mélangé une fois : le gagnant n'est ni toujours au milieu, ni toujours à gauche.
    val colonnes = remember(classement) { classement.shuffled(java.util.Random(classement.hashCode().toLong())) }
    val scores = remember(classement) { classement.map { it.points } }
    Box(modifier.fillMaxSize()) {
        // Salle assombrie pendant le suspense, qui se rallume un peu au solo.
        Box(
            Modifier.fillMaxSize().graphicsLayer {
                val m = ms()
                alpha = when {
                    m < 800f -> m / 800f * 0.6f
                    m < revelation -> 0.6f
                    else -> 0.6f - 0.25f * ((m - revelation) / 600f).coerceIn(0f, 1f)
                }
            }.background(GS.Noir),
        )
        if (gagnants.isNotEmpty()) Rayons { (ms() - revelation).coerceAtLeast(0f) }
        Echelle(960.dp, 540.dp) {
            // Le logo, en haut au centre, bat sur le solo.
            Box(
                Modifier.align(Alignment.TopCenter).padding(top = 8.dp).graphicsLayer {
                    val m = ms()
                    alpha = (m / 900f).coerceIn(0f, 1f)
                    val s = 1f + 0.12f * battement(m - revelation, 700f)
                    scaleX = s; scaleY = s
                },
            ) { LogoGameShow(26.dp, aligne = Alignment.CenterHorizontally) }
            // Le suspense : « Le grand gagnant est… » et les jauges.
            Column(
                Modifier.fillMaxSize().padding(start = 24.dp, end = 24.dp, top = 74.dp, bottom = 16.dp).graphicsLayer {
                    val m = ms()
                    alpha = if (m < revelation) 1f else (1f - (m - revelation) / 300f).coerceAtLeast(0f)
                },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    "LE GRAND GAGNANT EST…", style = styleTitreNeon(30.sp, GS.Cyan), maxLines = 1, softWrap = false,
                    modifier = Modifier.apparition(300, Unit).graphicsLayer { alpha = 0.8f + 0.2f * kotlin.math.sin(ms() / 240f) },
                )
                Spacer(Modifier.height(10.dp))
                JaugesPodium(colonnes, scores, ms, Modifier.weight(1f).fillMaxWidth())
            }
            // Le robot vole au-dessus du nom (clip 16:9 en plein écran) et vient par moments en gros plan face caméra
            // (cedric, 23/10) : son visage reste au-dessus du nom, son corps passe derrière. Un voile sombre en bas
            // garde le nom et les équipes lisibles par-dessus lui.
            if (apres(Tempo.PODIUM_REVELATION - 300, Unit)) {
                ClipRobotEnBoucle(ROBOT_FETE, ROBOT_FETE_BOUCLE_MS, Modifier.align(Alignment.Center).fillMaxWidth().aspectRatio(16f / 9f))
                Box(
                    Modifier.align(Alignment.BottomCenter).fillMaxWidth().fillMaxHeight(0.5f)
                        .background(Brush.verticalGradient(0f to Color.Transparent, 0.3f to GS.Noir.copy(alpha = 0.55f), 1f to GS.Noir.copy(alpha = 0.7f))),
                )
            }
            // La révélation, dans les 40 % du bas : la couronne, le nom, les points ; les autres équipes dessous
            // (jusqu'à 3) ou de part et d'autre du nom (4 à 7).
            val cotes = autres.size > 3
            Row(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                if (cotes) ColonneAutres(autres.filterIndexed { i, _ -> i % 2 == 0 }, classement, Modifier.width(200.dp))
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    if (gagnants.isNotEmpty()) {
                        if (gagnants.size > 1) {
                            Text(
                                "ÉGALITÉ !", style = styleTitreNeon(24.sp, GS.Jaune), maxLines = 1,
                                modifier = Modifier.apparition(Tempo.PODIUM_REVELATION, Unit),
                            )
                        }
                        // Pour les lecteurs d'écran (et les tests) : « Victoire de … » en une phrase.
                        Column(
                            Modifier.clearAndSetSemantics { text = AnnotatedString("Victoire de " + gagnants.joinToString(" et ") { it.nom }) },
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Couronne(apres(Tempo.PODIUM_REVELATION + 250, Unit), Modifier.size(if (gagnants.size == 1) 58.dp else 44.dp, if (gagnants.size == 1) 40.dp else 30.dp))
                            if (gagnants.size == 1) NomGagnantGs(gagnants[0], revelation) else NomsEgalite(gagnants, Tempo.PODIUM_REVELATION)
                        }
                        Text(
                            "$meilleur POINTS", style = styleEtiquetteGs(22.sp, GS.Jaune, 3.sp), maxLines = 1,
                            modifier = Modifier.apparition(Tempo.PODIUM_REVELATION + 600, Unit),
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            "Bravo à toutes les équipes !",
                            style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = GS.Encre),
                            maxLines = 1, modifier = Modifier.apparition(Tempo.PODIUM_REVELATION + 3_000, Unit),
                        )
                    } else {
                        Text(
                            "Bravo à toutes les équipes !", style = styleTitreNeon(40.sp, GS.Rose), textAlign = TextAlign.Center, maxLines = 2,
                            modifier = Modifier.apparition(Tempo.PODIUM_REVELATION, Unit),
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "Merci d'avoir joué !",
                            style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 24.sp, color = GS.Encre),
                            modifier = Modifier.apparition(Tempo.PODIUM_REVELATION + 800, Unit),
                        )
                    }
                    if (autres.isNotEmpty() && !cotes) {
                        Spacer(Modifier.height(8.dp))
                        BandeAutres(autres, classement, Modifier.apparition(Tempo.PODIUM_REVELATION + 2_500, Unit))
                    }
                }
                if (cotes) ColonneAutres(autres.filterIndexed { i, _ -> i % 2 == 1 }, classement, Modifier.width(200.dp))
            }
        }
        if (gagnants.isNotEmpty()) {
            // Flash blanc sur le premier accord du solo.
            Box(
                Modifier.fillMaxSize()
                    .graphicsLayer {
                        val x = (ms() - revelation) / 500f
                        alpha = if (x < 0f || x > 1f) 0f else 0.65f * (1f - x)
                    }
                    .background(Color.White),
            )
            FeuxDArtifice(ms, revelation)
        }
        Confettis(Tempo.PODIUM_REVELATION)
    }
}

/**
 * Les autres équipes de part et d'autre du nom du gagnant (4 à 7 équipes) : une pastille par ligne, rang, couleur, nom
 * et points. Les noms longs sont réduits, jamais coupés au milieu d'un mot.
 */
@Composable
private fun ColonneAutres(equipes: List<Classee>, classement: List<Classee>, modifier: Modifier) {
    val avecPoints = classement.any { it.points > 0 }
    Column(modifier.apparition(Tempo.PODIUM_REVELATION + 2_500, Unit), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        equipes.forEach { e ->
            val rang = 1 + classement.count { it.points > e.points }
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (avecPoints) {
                    Text("$rang", style = TextStyle(fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Black, fontSize = 14.sp, color = GS.Cyan), maxLines = 1)
                    Spacer(Modifier.width(6.dp))
                }
                Box(Modifier.size(12.dp).clip(RoundedCornerShape(50)).background(enNeon(e.couleur)))
                Spacer(Modifier.width(6.dp))
                Box(Modifier.weight(1f)) { NomUneLigne(e.nom, GS.Encre, 16f, 92.dp, tailleMin = 9f) }
                if (avecPoints) {
                    Spacer(Modifier.width(4.dp))
                    Text("${e.points}", style = TextStyle(fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = GS.Encre.copy(alpha = 0.8f)), maxLines = 1)
                }
            }
        }
    }
}

/** Le clip du robot qui félicite le gagnant : entrée de 3,85 s, puis 15,4 s de vol et de danse en boucle (16:9). */
internal const val ROBOT_FETE = "gs_robot_fete"
internal const val ROBOT_FETE_BOUCLE_MS = 3_849

/** Horloge du podium : jusqu'à la fin des feux d'artifice. */
private const val HORLOGE_PODIUM_MS = 26_000f

/** Les jauges montent à partir de là ; le deuxième score est atteint à [JAUGES_DEUXIEME], le meilleur à [JAUGES_FIN]. */
internal const val JAUGES_DEBUT = 1_200f
internal const val JAUGES_DEUXIEME = 11_500f
internal const val JAUGES_FIN = 14_900f

/**
 * Hauteur commune des jauges à [ms], en fraction du meilleur score : toutes montent ensemble et chaque équipe s'arrête
 * à son score ([niveauJauge]). Elle atteint le deuxième score à [JAUGES_DEUXIEME] (les équipes s'arrêtent une à une,
 * la moins bonne d'abord), puis les dernières secondes, sur la montée de la musique, seules les meilleures grimpent
 * encore, de plus en plus lentement, et touchent le haut à [JAUGES_FIN]. Égalité en tête : elles montent ensemble.
 */
internal fun hauteurJauges(ms: Float, scores: List<Int>): Float {
    val meilleur = scores.maxOrNull() ?: 0
    if (meilleur <= 0 || ms <= JAUGES_DEBUT) return 0f
    val deuxieme = scores.filter { it < meilleur }.maxOrNull()?.coerceAtLeast(0) ?: 0
    val r2 = deuxieme.toFloat() / meilleur
    return if (ms < JAUGES_DEUXIEME) {
        val u = (ms - JAUGES_DEBUT) / (JAUGES_DEUXIEME - JAUGES_DEBUT)
        r2 * u * u * (3 - 2 * u)
    } else {
        val u = ((ms - JAUGES_DEUXIEME) / (JAUGES_FIN - JAUGES_DEUXIEME)).coerceIn(0f, 1f)
        // Rapide au départ, de plus en plus lent près du sommet.
        r2 + (1f - r2) * (1f - (1f - u) * (1f - u) * (1f - u))
    }
}

/** Remplissage de la jauge d'une équipe (0 → 1) : la hauteur commune, arrêtée à son score. */
internal fun niveauJauge(ms: Float, points: Int, scores: List<Int>): Float {
    val meilleur = scores.maxOrNull() ?: 0
    if (meilleur <= 0) return 0f
    return minOf(hauteurJauges(ms, scores), points.coerceAtLeast(0).toFloat() / meilleur)
}

/** Les jauges du suspense : compteur, rail de verre au bord néon, remplissage qui monte du bas, nom de l'équipe. */
@Composable
private fun JaugesPodium(colonnes: List<Classee>, scores: List<Int>, ms: () -> Float, modifier: Modifier) {
    val meilleur = scores.maxOrNull() ?: 0
    val serre = colonnes.size > 5
    BoxWithConstraints(modifier) {
        val largeur = (maxWidth / colonnes.size.coerceAtLeast(1)).coerceAtMost(200.dp)
        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.Center) {
            colonnes.forEachIndexed { k, e ->
                val couleur = enNeon(e.couleur)
                val part = if (meilleur > 0) e.points.coerceAtLeast(0).toFloat() / meilleur else 0f
                // Instant où sa jauge s'arrête (Float.MAX_VALUE : elle monte jusqu'au bout) : un petit coup d'éclat.
                val arret = remember(e, scores) { instantArret(part, scores) }
                Column(
                    Modifier.width(largeur).fillMaxHeight().padding(horizontal = if (serre) 5.dp else 12.dp).apparition(500L + 80L * k, Unit),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    CompteurJauge(e.points, part, couleur, serre, ms, scores)
                    Spacer(Modifier.height(6.dp))
                    val forme = RoundedCornerShape(14.dp)
                    Box(
                        Modifier.weight(1f).widthIn(max = 86.dp).fillMaxWidth(if (serre) 0.8f else 0.6f)
                            .graphicsLayer {
                                val m = ms()
                                // Une fois arrêtée, la jauge recule un peu dans l'ombre ; celle qui monte encore brille.
                                val eclat = battement(m - arret, 400f)
                                alpha = if (m > arret + 400f) 0.62f else 1f
                                val s = 1f + 0.06f * eclat
                                scaleX = s; scaleY = s
                            }
                            .lueurNeon(couleur, 14.dp, 0.6f)
                            .clip(forme).background(GS.Nuit.copy(alpha = 0.85f)).border(2.dp, couleur.copy(alpha = 0.55f), forme),
                        contentAlignment = Alignment.BottomCenter,
                    ) {
                        Box(
                            Modifier.fillMaxSize().padding(4.dp)
                                .graphicsLayer {
                                    transformOrigin = TransformOrigin(0.5f, 1f)
                                    scaleY = niveauJauge(ms(), e.points, scores).coerceAtLeast(0.02f)
                                }
                                .clip(RoundedCornerShape(10.dp))
                                .background(Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.9f), couleur, couleur.copy(alpha = 0.55f)))),
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        NomUneLigne(e.nom, GS.Encre, if (serre) 18f else 22f, largeur - (if (serre) 10.dp else 24.dp), tailleMin = 10f)
                    }
                }
            }
        }
    }
}

/** Instant (ms) où une jauge à [part] du meilleur score s'arrête ; les meilleures montent jusqu'au bout. */
internal fun instantArret(part: Float, scores: List<Int>): Float {
    if (part >= 1f || (scores.maxOrNull() ?: 0) <= 0) return Float.MAX_VALUE
    // La hauteur commune ne fait que monter : on cherche le premier instant où elle atteint [part].
    var a = JAUGES_DEBUT
    var b = JAUGES_FIN
    repeat(30) {
        val m = (a + b) / 2
        if (hauteurJauges(m, scores) >= part) b = m else a = m
    }
    return b
}

/** Compteur au-dessus d'une jauge : il suit le remplissage et finit exactement sur le score de l'équipe. */
@Composable
private fun CompteurJauge(points: Int, part: Float, couleur: Color, serre: Boolean, ms: () -> Float, scores: List<Int>) {
    val meilleur = scores.maxOrNull() ?: 0
    val affiche = (niveauJauge(ms(), points, scores) * meilleur).roundToInt().coerceAtMost(points.coerceAtLeast(0))
    Text(
        "$affiche", maxLines = 1, softWrap = false,
        style = TextStyle(
            fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Black, fontSize = if (serre) 22.sp else 30.sp,
            color = couleur, shadow = Shadow(couleur.copy(alpha = 0.8f), Offset.Zero, 20f), textAlign = TextAlign.Center,
        ),
    )
}

/** Le nom du gagnant claque sur le solo : de 1,6 à 1 avec un rebond, en grand titre néon de sa couleur. */
@Composable
private fun NomGagnantGs(g: Classee, revelation: Float) {
    val v = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(revelation.toLong())
        v.animateTo(1f, spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessMediumLow))
    }
    val taille = when {
        g.nom.length <= 10 -> 66.sp
        g.nom.length <= 16 -> 50.sp
        else -> 38.sp
    }
    Text(
        g.nom, style = styleTitreNeon(taille, enNeon(g.couleur)), maxLines = 2, textAlign = TextAlign.Center,
        modifier = Modifier.graphicsLayer {
            val x = v.value
            alpha = x.coerceIn(0f, 1f)
            val s = 1.6f - 0.6f * x
            scaleX = s; scaleY = s
        },
    )
}

/**
 * Écran de fin du Game Show, après le podium, sur le dernier groove d'Aerodynamic : « Merci d'avoir participé ! »,
 * « À bientôt sur The Game Show ! », le logo signé « by Little Miss Party » bien en grand (comme une pub), et le robot
 * 3D qui dit au revoir. Doucement animé : le logo respire, un reflet passe, le message bat lentement.
 */
@Composable
fun AuRevoirGameShow(modifier: Modifier = Modifier) {
    val boucle = rememberInfiniteTransition(label = "au-revoir")
    val souffle by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(2_000), RepeatMode.Reverse), label = "souffle")
    val balayage by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(6_000, easing = LinearEasing)), label = "balayage")
    Box(modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().graphicsLayer { alpha = 0.45f }.background(GS.Noir))
        Echelle(960.dp, 540.dp) {
            Row(Modifier.fillMaxSize().padding(horizontal = 30.dp, vertical = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(
                        Modifier.apparition(200, Unit).graphicsLayer {
                            val s = 1f + 0.03f * souffle
                            scaleX = s; scaleY = s
                        },
                        contentAlignment = Alignment.Center,
                    ) {
                        // Halo violet qui respire derrière le logo, et un reflet cyan qui le traverse.
                        Box(
                            Modifier.matchParentSizePlus().graphicsLayer { alpha = 0.35f + 0.25f * souffle }
                                .background(Brush.radialGradient(listOf(GS.Violet.copy(alpha = 0.6f), Color.Transparent))),
                        )
                        LogoGameShow(84.dp, aligne = Alignment.CenterHorizontally)
                        Box(
                            Modifier.matchParentSizePlus().graphicsLayer {
                                translationX = (balayage * 2.4f - 1.2f) * size.width
                                alpha = 0.5f
                            }.background(Brush.horizontalGradient(listOf(Color.Transparent, GS.CyanClair.copy(alpha = 0.25f), Color.Transparent))),
                        )
                    }
                    Spacer(Modifier.height(26.dp))
                    Text(
                        "Merci d'avoir participé !",
                        style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 40.sp, color = GS.Encre, textAlign = TextAlign.Center),
                        maxLines = 1, modifier = Modifier.apparition(900, Unit),
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "À BIENTÔT SUR THE GAME SHOW !", style = styleEtiquetteGs(20.sp, GS.Cyan, 3.sp), maxLines = 1,
                        modifier = Modifier.apparition(1_600, Unit).graphicsLayer { alpha = 0.75f + 0.25f * souffle },
                    )
                }
                // Le robot qui dit au revoir, à droite (clip au format 4:5).
                Box(Modifier.width(330.dp).fillMaxHeight(), contentAlignment = Alignment.Center) {
                    ClipRobotEnBoucle(ROBOT_AU_REVOIR, ROBOT_AU_REVOIR_BOUCLE_MS, Modifier.size(330.dp, 412.dp))
                }
            }
        }
    }
}

/** Le clip du robot qui dit au revoir (entrée de 2 s, puis 8 s en boucle). */
internal const val ROBOT_AU_REVOIR = "gs_robot_aurevoir"
internal const val ROBOT_AU_REVOIR_BOUCLE_MS = 2_001

/** Calque derrière et devant le logo, pour le halo et le reflet. */
private fun Modifier.matchParentSizePlus(): Modifier = this.fillMaxWidth().height(240.dp)
