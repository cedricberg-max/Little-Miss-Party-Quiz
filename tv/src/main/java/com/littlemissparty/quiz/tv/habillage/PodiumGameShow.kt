package com.littlemissparty.quiz.tv.habillage

import androidx.compose.ui.unit.offset
import androidx.compose.ui.layout.layout
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.withInfiniteAnimationFrameMillis
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.viewinterop.AndroidView
import com.littlemissparty.quiz.tv.R
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

/**
 * Le podium du design « The Game Show », version A « suspense » (choix de cedric du 24 octobre), calé sur gs_podium
 * (Digital Love) :
 * - 0 → [Tempo.PODIUM_REVELATION] : « why don't you play the game » et le roulement. Les tubes de verre des équipes
 *   (1 à 8, dans un ordre mélangé, moitié à gauche de l'arche, moitié à droite) se remplissent ensemble au même
 *   compteur. Une équipe sous le plafond s'arrête à son score ; les meilleures montent jusqu'au plafond (90 % du
 *   deuxième score) et y restent au même niveau : on ne sait pas qui gagne. Le robot attend dans l'arche, puis joue
 *   du tambour sur les dernières mesures. Sur la fin du roulement ([MONTEE_DEBUT] → [MONTEE_FIN]), les meilleurs
 *   repartent jusqu'à leur vrai score : le tube du gagnant se remplit jusqu'en haut (deux tubes pleins à égalité),
 *   brille, puis tous les tubes s'enfoncent sous le plateau (cedric, 24 octobre : « le gagnant remplit la jauge en
 *   totalité ») ;
 * - le solo de guitare : flash, la fête du gagnant en plan cinéma, plein écran ([FeteCinema] : le robot bondit,
 *   s'arrête, fait un clin d'œil, la caméra bouge ; cedric, 24 octobre), le nom du gagnant claque lettre par lettre
 *   ([NomNerveux]) et ses vrais points ; jamais les autres équipes (cedric, 26/10) ;
 * - à [Tempo.PODIUM_COUPE] (4:07 de la chanson, juste avant une note grave), la musique enchaîne sur sa boucle
 *   d'attente (écho de la dernière note aiguë, boucle « fête » sans guitare) et l'image du podium continue pendant que
 *   Sarah parle aux enfants ; son « ▶ Lancer la fin » ([finLancee]) lance l'outro du robot en fusée puis l'écran de fin
 *   cinéma ([OutroPuisFinGameShow]) (cedric, 29/10 : le podium faisait long, rien n'est coupé de la fusée).
 * Égalité en tête : mêmes tubes, puis « ÉGALITÉ ! » et les noms couronnés. Personne n'a marqué : les tubes restent
 * presque vides et « Bravo à toutes les équipes ! » arrive au solo. Les compteurs du suspense ne sont qu'un spectacle
 * plafonné ; tout nombre affiché après le solo est le vrai score ([Classee.points]) : rien ici ne compte de points.
 * Une seule vidéo à la fois : pendant la fête, le décor du dessous ne lit pas son fond ([Habillage.finVideo]). Si la
 * vidéo de la fête ne se lit pas, l'ancien clip du robot qui vole ([ROBOT_FETE]) la remplace. Le reste ne bouge que
 * par calques (échelle, position, opacité).
 */
@Composable
fun PodiumGameShow(classement: List<Classee>, modifier: Modifier = Modifier, finLancee: Boolean = false) {
    if (finLancee) return OutroPuisFinGameShow(modifier)
    DisposableEffect(Unit) {
        Habillage.podium.value = true
        onDispose { Habillage.podium.value = false }
    }
    val meilleur = classement.firstOrNull()?.points ?: 0
    val gagnants = if (meilleur > 0) classement.takeWhile { it.points == meilleur } else emptyList()
    val seul = gagnants.size == 1
    // Horloge du podium (ms) : lue seulement dans les calques et les dessins, jamais à la composition.
    val horloge = remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) {
        val debut = withInfiniteAnimationFrameMillis { it }
        while (true) withInfiniteAnimationFrameMillis { horloge.floatValue = (it - debut).toFloat() }
    }
    val ms = { horloge.floatValue }
    val revelation = Tempo.PODIUM_REVELATION.toFloat()
    // Ordre des tubes mélangé une fois : le gagnant n'est ni toujours au milieu, ni toujours à gauche.
    val colonnes = remember(classement) { classement.shuffled(java.util.Random(classement.hashCode().toLong())) }
    val scores = remember(classement) { classement.map { it.points } }
    // Le robot : il attend dans l'arche, joue du tambour sur les dernières mesures, puis la fête au solo.
    val robotAttend = apres(500, Unit)
    val robotTambour = apres(Tempo.PODIUM_REVELATION - ROBOT_TAMBOUR_AVANT_MS, Unit)
    val robotFete = apres(Tempo.PODIUM_REVELATION - 300, Unit)
    val robot = when {
        robotFete -> 3
        robotTambour -> 2
        robotAttend -> 1
        else -> 0
    }
    // Une fois sous le plateau, les tubes ne sont plus dessinés du tout.
    val tubesPartis = apres(Tempo.PODIUM_REVELATION + 500, Unit)
    val petitRobot = if (classement.size >= 7) 0.8f else 1f
    var feteEchec by remember { mutableStateOf(false) }
    // La fête a montré sa première image : jusque-là, la dernière image des jauges reste dessous (jamais d'écran noir
    // si la box tarde à afficher la fête, vu sur l'émulateur le 30/10).
    var fetePrete by remember { mutableStateOf(false) }
    // Les jauges en plan cinéma (décor 3D et robot dans la même vidéo, cedric 30/10) ; sans le fichier ou s'il ne se
    // lit pas, le plateau et les clips du robot dans l'arche, comme avant.
    val contexte = LocalContext.current
    val jaugesRes = remember { contexte.resources.getIdentifier(JAUGES_VIDEO, "raw", contexte.packageName) }
    var jaugesEchec by remember { mutableStateOf(false) }
    val jaugesCinema = jaugesRes != 0 && !jaugesEchec
    val ligneNom = if (classement.size >= 6) 439.dp else 452.5.dp
    Box(modifier.fillMaxSize()) {
        // Salle un peu assombrie pendant le suspense (l'arche du plateau reste visible), qui se rallume au solo.
        Box(
            Modifier.fillMaxSize().graphicsLayer {
                val m = ms()
                alpha = when {
                    // Sur la vidéo des jauges, la salle est déjà dans sa lumière : un voile léger seulement.
                    jaugesCinema && m < revelation -> (m / 800f).coerceAtMost(1f) * 0.2f
                    m < 800f -> m / 800f * 0.45f
                    m < revelation -> 0.45f
                    else -> 0.45f - 0.2f * ((m - revelation) / 600f).coerceIn(0f, 1f)
                }
            }.background(GS.Noir),
        )
        // Les jauges en plan cinéma, de la première image au solo ; leur dernière image reste sous la fête qui arrive.
        if (jaugesCinema && !(tubesPartis && (fetePrete || feteEchec))) {
            JaugesCinema(jaugesRes, { ms().toInt() }, { robot == 3 && !feteEchec }, { jaugesEchec = true })
        }
        // Au solo, la fête en plan cinéma couvre tout le plateau ; elle part exactement sur le solo.
        if (robot == 3 && !feteEchec) FeteCinema({ (revelation - ms()).toInt() }, { fetePrete = true }, { feteEchec = true })
        if (gagnants.size > 1) Rayons { (ms() - revelation).coerceAtLeast(0f) }
        // Secousse de caméra quand le nom du gagnant claque (tout le podium bouge, le décor derrière reste).
        Box(
            Modifier.fillMaxSize().graphicsLayer {
                if (seul) {
                    val s = secousseNerveuse((ms() - revelation) / 1000f, gagnants[0].nom.length)
                    translationX = s.x.dp.toPx()
                    translationY = s.y.dp.toPx()
                }
            },
        ) {
            Echelle(960.dp, 540.dp) {
                // Au solo, le robot vole au premier plan (clip 16:9 sur toute la largeur) ; un voile sombre en bas
                // garde le nom et le classement lisibles par-dessus lui.
                if (robot == 3) {
                    if (feteEchec) ClipRobotEnBoucle(ROBOT_FETE, ROBOT_FETE_BOUCLE_MS, Modifier.align(Alignment.Center).fillMaxWidth().aspectRatio(16f / 9f))
                    Box(
                        Modifier.align(Alignment.BottomCenter).fillMaxWidth().fillMaxHeight(0.5f)
                            .background(Brush.verticalGradient(0f to Color.Transparent, 0.3f to GS.Noir.copy(alpha = 0.55f), 1f to GS.Noir.copy(alpha = 0.7f))),
                    )
                }
                Box(Modifier.align(Alignment.Center).size(960.dp, 540.dp)) {
                    // Le robot dans l'arche du plateau, debout sur le disque ; plus petit à 7 et 8 équipes.
                    key(robot) {
                        val arche = Modifier
                            .padding(start = (480f - ROBOT_ARCHE_L / 2 * petitRobot).dp, top = (ROBOT_ARCHE_SOL - 0.84f * ROBOT_ARCHE_H * petitRobot).dp)
                            .size((ROBOT_ARCHE_L * petitRobot).dp, (ROBOT_ARCHE_H * petitRobot).dp)
                        when {
                            jaugesCinema -> {}
                            robot == 1 -> ClipRobotEnBoucle(ROBOT_ATTENTE, ROBOT_ATTENTE_BOUCLE_MS, arche)
                            robot == 2 -> ClipRobotEnBoucle(ROBOT_TAMBOUR, -1, arche)
                            else -> {}
                        }
                    }
                    // Halo de l'arche qui couvre le passage du robot qui attend au robot qui joue du tambour (au solo,
                    // le flash blanc couvre l'arrivée du robot de la fête).
                    if (!jaugesCinema) Canvas(Modifier.fillMaxSize()) {
                        val m = ms()
                        val a = 0.7f * battement(m - (revelation - ROBOT_TAMBOUR_AVANT_MS) + 200f, 500f)
                        if (a > 0f) {
                            val c = Offset(480.dp.toPx(), (ROBOT_ARCHE_SOL - 0.45f * ROBOT_ARCHE_H * petitRobot).dp.toPx())
                            drawCircle(Brush.radialGradient(listOf(GS.Cyan.copy(alpha = a), Color.Transparent), c, 150.dp.toPx()), 150.dp.toPx(), c)
                        }
                    }
                    // Filigrane A derrière le logo et « LE GRAND GAGNANT EST… » pendant les jauges (cedric, 30/10 : la couronne
                    // du nouveau décor est juste derrière, les textes s'y délavaient) ; il s'éteint avec le titre.
                    val mesureTitre = rememberTextMeasurer()
                    val largeurTitre = remember(mesureTitre) {
                        mesureTitre.measure(TITRE_JAUGES, styleTitreNeon(30.sp, GS.Cyan), maxLines = 1, softWrap = false).size.width.toFloat()
                    }
                    Canvas(Modifier.fillMaxSize()) {
                        val m = ms()
                        val demi = largeurTitre / 2 + FILIGRANE_MARGE_DP.dp.toPx()
                        val part = (m / 600f).coerceIn(0f, 1f) * (1f - (m - DESCENTE_DEBUT) / 400f).coerceIn(0f, 1f)
                        filigrane(Rect(size.width / 2 - demi, 3.dp.toPx(), size.width / 2 + demi, FILIGRANE_TITRE_BAS_DP.dp.toPx()), part)
                    }
                    // Filigrane A derrière le logo et « Bravo à toutes les équipes ! », à partir du solo (cedric, 30/10).
                    if (gagnants.isNotEmpty()) {
                        val mesureBravo = rememberTextMeasurer()
                        Canvas(Modifier.fillMaxSize()) {
                            val l = if (seul) maxOf(mesureBravo.measure("Bravo à toutes les équipes !", styleBravo(), maxLines = 1).size.width.toFloat(), 200.dp.toPx()) else 200.dp.toPx()
                            val demi = l / 2 + FILIGRANE_MARGE_DP.dp.toPx()
                            val bas = (if (seul) 109f else 62f).dp.toPx()
                            filigrane(Rect(size.width / 2 - demi, 3.dp.toPx(), size.width / 2 + demi, bas), ((ms() - revelation) / 300f).coerceIn(0f, 1f))
                        }
                    }
                    // Le logo, en haut au centre, bat sur le solo.
                    Box(
                        Modifier.align(Alignment.TopCenter).padding(top = 8.dp).graphicsLayer {
                            val m = ms()
                            alpha = (m / 900f).coerceIn(0f, 1f)
                            compositingStrategy = CompositingStrategy.ModulateAlpha
                            val s = 1f + 0.12f * battement(m - revelation, 700f)
                            scaleX = s; scaleY = s
                        },
                    ) { LogoGameShow(26.dp, aligne = Alignment.CenterHorizontally) }
                    // « Le grand gagnant est… », qui s'éteint quand les tubes descendent.
                    Text(
                        TITRE_JAUGES, style = styleTitreNeon(30.sp, GS.Cyan), maxLines = 1, softWrap = false,
                        modifier = Modifier.align(Alignment.TopCenter).padding(top = 64.dp).apparition(300, Unit).graphicsLayer {
                            val m = ms()
                            alpha = (0.8f + 0.2f * kotlin.math.sin(m / 240f)) * (1f - (m - DESCENTE_DEBUT) / 400f).coerceIn(0f, 1f)
                            compositingStrategy = CompositingStrategy.ModulateAlpha
                        },
                    )
                    if (!tubesPartis) TubesPodium(colonnes, scores, ms)
                    if (seul) {
                        val g = gagnants[0]
                        Text(
                            "Bravo à toutes les équipes !", style = styleBravo(),
                            maxLines = 1, modifier = Modifier.align(Alignment.TopCenter).padding(top = 66.dp).apparition(Tempo.PODIUM_REVELATION + 3_000, Unit),
                        )
                        NomNerveux(g, ligneNom, ms)
                        PointsNerveux(g.points, g.nom.length, ligneNom + POINTS_SOUS_NOM_DP.dp, ms)
                        // Le gagnant seul : plus les autres équipes dessous (cedric, 26/10 : « je ne vois pas l'intérêt »).
                    } else {
                        RevelationEgaliteOuZero(gagnants, meilleur, Modifier.align(Alignment.BottomCenter))
                    }
                }
            }
        }
        if (gagnants.isNotEmpty()) {
            // Flash blanc sur le premier accord du solo.
            Box(
                Modifier.fillMaxSize()
                    .graphicsLayer {
                        val x = (ms() - revelation) / 500f
                        alpha = if (x < 0f || x > 1f) 0f else 0.55f * (1f - x)
                    }
                    .background(Color.White),
            )
            if (!seul) FeuxDArtifice(ms, revelation)
        }
        Confettis(Tempo.PODIUM_REVELATION)
    }
}

/**
 * La révélation sans gagnant unique, dans les 40 % du bas : égalité en tête (« ÉGALITÉ ! », la couronne, les noms à
 * égalité, leurs points) ou personne n'a marqué (« Bravo à toutes les équipes ! »). Jamais les autres équipes : seuls
 * les gagnants (cedric, 26/10).
 */
@Composable
private fun RevelationEgaliteOuZero(gagnants: List<Classee>, meilleur: Int, modifier: Modifier) {
    Row(
        modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
            if (gagnants.isNotEmpty()) {
                Text(
                    "ÉGALITÉ !", style = styleTitreNeon(24.sp, GS.Jaune), maxLines = 1,
                    modifier = Modifier.apparition(Tempo.PODIUM_REVELATION, Unit),
                )
                // Pour les lecteurs d'écran (et les tests) : « Victoire de … » en une phrase.
                Column(
                    Modifier.clearAndSetSemantics { text = AnnotatedString("Victoire de " + gagnants.joinToString(" et ") { it.nom }) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Couronne(apres(Tempo.PODIUM_REVELATION + 250, Unit), Modifier.size(44.dp, 30.dp))
                    NomsEgalite(gagnants, Tempo.PODIUM_REVELATION)
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
        }
    }
}

/**
 * Les tubes du suspense ([dispositionTubes]) : la lueur néon et le tube de verre ([dessineJauge]), le compteur au-dessus
 * et le nom de l'équipe dessous. Juste avant le solo, tubes et compteurs s'enfoncent sous le plateau par une fente
 * lumineuse ; les noms s'éteignent avant.
 */
@Composable
private fun TubesPodium(colonnes: List<Classee>, scores: List<Int>, ms: () -> Float) {
    val places = remember(colonnes.size) { dispositionTubes(colonnes.size) }
    val planches = planchesJauge()
    val plafond = remember(scores) { plafondSuspense(scores) }
    val couleurs = remember(colonnes) { colonnes.map { enNeon(it.couleur) } }
    val mesure = rememberTextMeasurer()
    val densite = LocalDensity.current
    val echelle = places.firstOrNull()?.echelle ?: 1f
    // Une seule taille pour tous les compteurs : le plus long nombre qu'ils afficheront tient dans la place d'un tube.
    val tailleCompteur = remember(places, scores, densite) {
        val t0 = minOf(maxOf(21f, 29f * echelle), (places.firstOrNull()?.largeur ?: 64f) * 1.55f / 1.15f * 1.2f)
        val plusLong = colonnes.maxOfOrNull { valeurSuspense(Float.MAX_VALUE, it.points, scores).toString() } ?: "0"
        val l = mesure.measure(plusLong, styleCompteur(t0, Color.White), maxLines = 1, softWrap = false).size.width.toFloat()
        val maxPx = with(densite) { ((places.firstOrNull()?.place ?: 100f) * 0.94f).dp.toPx() }
        if (l > maxPx) t0 * maxPx / l else t0
    }
    // Tubes et compteurs : coupés à la fente du plateau quand ils descendent.
    Box(
        Modifier.fillMaxWidth().height(FENTE_Y.dp).clipToBounds().graphicsLayer {
            translationY = descenteTubes(ms()) * DESCENTE_DP.dp.toPx()
        },
    ) {
        places.forEachIndexed { k, p ->
            val e = colonnes[k]
            val couleur = couleurs[k]
            Canvas(
                Modifier.padding(start = (p.centre - p.largeur / 2).dp, top = TUBE_HAUT.dp).size(p.largeur.dp, TUBE_HAUTEUR.dp),
            ) {
                val part = remplissage(ms(), e.points, scores)
                // Lueur néon autour du verre : quatre anneaux de plus en plus pâles.
                val pas = size.width * 0.0837f
                val r = size.width * 0.39f
                for (a in 4 downTo 1) {
                    val d = pas * a * 2
                    drawRoundRect(
                        couleur.copy(alpha = minOf(1f, 0.09f * 0.45f * (5 - a) / 2f)), Offset(-d / 2, -d / 2), Size(size.width + d, size.height + d),
                        CornerRadius(r + d / 2), style = Stroke(pas * 2),
                    )
                }
                if (planches != null) dessineJauge(planches, part, couleur) else dessineJaugeSimple(part, couleur)
                // Tube plein : un éclat néon autour du verre, jusqu'à la descente.
                val eclat = tubePlein(ms(), e.points, scores)
                if (eclat > 0f) {
                    val d = pas * 6
                    drawRoundRect(
                        Brush.radialGradient(listOf(couleur.copy(alpha = 0.55f * eclat), Color.Transparent), center, size.height * 0.75f),
                        Offset(-d, -d), Size(size.width + 2 * d, size.height + 2 * d), CornerRadius(r + d),
                    )
                }
            }
            // Le compteur : il ne change de texte que quand le nombre change. Les meilleurs, tenus au plafond,
            // frémissent en attendant le solo.
            val valeur by remember(e, scores) { derivedStateOf { valeurSuspense(ms(), e.points, scores) } }
            val tenu = e.points > plafond
            Text(
                "$valeur", maxLines = 1, softWrap = false, style = styleCompteur(tailleCompteur, couleur),
                modifier = Modifier.centreSurLigneDeBase(p.centre.dp, (TUBE_HAUT - 25f * p.echelle).dp).graphicsLayer {
                    val m = ms()
                    alpha = if (tenu && m > JAUGES_FIN && m < MONTEE_DEBUT) 0.82f + 0.18f * kotlin.math.cos((m - JAUGES_FIN) / 90f) else 1f
                },
            )
        }
    }
    // Les fentes du plateau, sous chaque tube, le temps de la descente.
    Canvas(Modifier.fillMaxSize()) {
        val m = ms()
        val a = ((m - (DESCENTE_DEBUT - 200f)) / 200f).coerceIn(0f, 1f) * (1f - (m - Tempo.PODIUM_REVELATION) / 400f).coerceIn(0f, 1f)
        if (a <= 0f) return@Canvas
        val y = FENTE_Y.dp.toPx()
        val h = 6.dp.toPx()
        places.forEach { p ->
            val x = p.centre.dp.toPx()
            val l = 90.dp.toPx()
            drawRect(
                Brush.verticalGradient(listOf(GS.Cyan.copy(alpha = 0f), GS.CyanClair.copy(alpha = 0.9f * a), GS.Cyan.copy(alpha = 0f)), y - h, y + h),
                Offset(x - l / 2, y - h), Size(l, 2 * h),
            )
        }
    }
    // Les noms sous les tubes : réduits pour tenir dans leur place, jamais coupés ; décalés un sur deux à 3 et 4 par côté.
    Box(
        Modifier.fillMaxSize().graphicsLayer {
            alpha = 1f - ((ms() - (DESCENTE_DEBUT - 250f)) / 250f).coerceIn(0f, 1f)
            compositingStrategy = CompositingStrategy.ModulateAlpha
        },
    ) {
        places.forEachIndexed { k, p ->
            val e = colonnes[k]
            val taille = remember(e.nom, p, densite) {
                val t0 = maxOf(16f, 19f * p.echelle)
                val l = mesure.measure(e.nom, styleNomTube(t0), maxLines = 1, softWrap = false).size.width.toFloat()
                val maxPx = with(densite) { p.placeNom.dp.toPx() }
                if (l > maxPx) t0 * maxPx / l else t0
            }
            Text(
                e.nom, maxLines = 1, softWrap = false, style = styleNomTube(taille),
                modifier = Modifier.centreSurLigneDeBase(p.centre.dp, (TUBE_HAUT + TUBE_HAUTEUR + 22f * p.echelle + if (p.decale) 22f else 0f).dp),
            )
        }
    }
}

// Chiffres un peu espacés, comme aux jauges des scores : en Black, « 117 » se touchait presque (cedric, 26/10).
private fun styleCompteur(taille: Float, couleur: Color) = TextStyle(
    fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Black, fontSize = taille.sp, letterSpacing = (taille * 0.08f).sp, color = couleur,
    shadow = Shadow(couleur.copy(alpha = 0.8f), Offset.Zero, taille * 0.6f), textAlign = TextAlign.Center,
)

private fun styleNomTube(taille: Float) = TextStyle(
    fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = taille.sp, color = GS.Encre,
    shadow = Shadow(Color.Black.copy(alpha = 0.85f), Offset.Zero, 10f),
)

/** Place un texte centré sur [x] (dp depuis la gauche du parent), sa ligne de base à [ligne] du haut du parent. */
private fun Modifier.centreSurLigneDeBase(x: androidx.compose.ui.unit.Dp, ligne: androidx.compose.ui.unit.Dp): Modifier = layout { mesurable, contraintes ->
    val p = mesurable.measure(contraintes.copy(minWidth = 0, minHeight = 0, maxWidth = androidx.compose.ui.unit.Constraints.Infinity))
    val b = p[androidx.compose.ui.layout.FirstBaseline].takeIf { it != androidx.compose.ui.layout.AlignmentLine.Unspecified } ?: p.height
    layout(contraintes.maxWidth, contraintes.maxHeight) { p.place(x.roundToPx() - p.width / 2, ligne.roundToPx() - b) }
}

/** Les clips du robot du podium : il attend dans l'arche (entrée, puis 1,55 s qui boucle), puis le tambour (4 s, une fois). */
internal const val ROBOT_ATTENTE = "gs_robot_podium_attente"
internal const val ROBOT_ATTENTE_BOUCLE_MS = 1_450
internal const val ROBOT_TAMBOUR = "gs_robot_batterie"
internal const val ROBOT_TAMBOUR_AVANT_MS = 4_300L
/** Le robot dans l'arche du plateau (dp sur 960 × 540) : clip 4:5, son disque posé à [ROBOT_ARCHE_SOL]. */
private const val ROBOT_ARCHE_L = 237f
private const val ROBOT_ARCHE_H = 300f
private const val ROBOT_ARCHE_SOL = 420f

/**
 * Les jauges en plan cinéma (res/raw/gs_podium_jauges.mp4, cedric 30/10) : le nouveau décor 3D du podium et le robot qui
 * attend puis joue du tambour, dans une seule vidéo calée sur la musique depuis son début ; les tubes, les compteurs et
 * les textes sont dessinés par-dessus. Elle part à la position de la musique ([ecouleMs]) quand elle est prête. Une
 * seule vidéo à la fois : le décor du dessous ne lit plus son fond, et le lecteur est rendu à [JAUGES_VIDEO_FIN_MS],
 * avant que la fête ne prépare le sien ; sa dernière image reste affichée jusqu'à ce que la fête la couvre.
 * [fetePrend] : la fête a déjà pris la main sur le décor quand les jauges partent.
 */
@Composable
private fun JaugesCinema(resId: Int, ecouleMs: () -> Int, fetePrend: () -> Boolean, surEchec: () -> Unit) {
    DisposableEffect(Unit) {
        Habillage.finVideo.value = true
        onDispose { if (!fetePrend()) Habillage.finVideo.value = false }
    }
    var prete by remember { mutableStateOf(false) }
    var vue by remember { mutableStateOf<LecteurFond?>(null) }
    AndroidView(
        factory = {
            LecteurFond(
                it, resId, surPret = { prete = true }, surEchec = surEchec, boucle = false,
                finMs = JAUGES_VIDEO_FIN_MS, surFin = { vue?.liberer() }, departLu = { ecouleMs().coerceAtLeast(0) },
            ).also { v -> vue = v }
        },
        update = { it.alpha = if (prete) 1f else 0f },
        onRelease = { it.liberer() },
        modifier = Modifier.fillMaxSize().clearAndSetSemantics {},
    )
}

/** Le titre des jauges, et le bas de son filigrane (le titre est à 64 dp du haut, en 30 sp). */
internal const val TITRE_JAUGES = "LE GRAND GAGNANT EST…"
internal const val FILIGRANE_TITRE_BAS_DP = 112f

/** La vidéo des jauges en plan cinéma (sans elle : le plateau et les clips du robot). */
internal const val JAUGES_VIDEO = "gs_podium_jauges"

/** Le lecteur des jauges est rendu 500 ms avant le solo : la fête prépare le sien 300 ms avant (une vidéo à la fois). */
internal const val JAUGES_VIDEO_FIN_MS = (Tempo.PODIUM_REVELATION - 500).toInt()

/**
 * La fête du gagnant en plan cinéma, plein écran (res/raw/gs_podium_fete.mp4, calculée à l'avance en 3D sur le plateau) :
 * 96 images (8 temps de Digital Love) pour le BOUM et l'approche de la caméra, puis une boucle parfaite de 64 temps
 * ([FETE_BOUCLE_DEBUT_MS] → la fin du fichier). Le tiers bas et le haut restent calmes : l'appli y écrit le nom, les
 * points, le classement et le logo. Elle démarre quand [attenteMs] tombe à zéro (le solo) et apparaît dès sa première
 * image. Une seule vidéo à la fois : le décor du dessous ne lit plus son fond pendant ce temps.
 */
@Composable
private fun FeteCinema(attenteMs: () -> Int, surAffiche: () -> Unit, surEchec: () -> Unit) {
    DisposableEffect(Unit) {
        Habillage.finVideo.value = true
        onDispose { Habillage.finVideo.value = false }
    }
    var prete by remember { mutableStateOf(false) }
    AndroidView(
        factory = {
            LecteurFond(
                it, R.raw.gs_podium_fete, surPret = { prete = true; surAffiche() }, surEchec = surEchec, boucle = false,
                repriseMs = FETE_BOUCLE_DEBUT_MS, attenteMs = { attenteMs().coerceAtLeast(0) },
            )
        },
        update = { it.alpha = if (prete) 1f else 0f },
        onRelease = { it.liberer() },
        modifier = Modifier.fillMaxSize().clearAndSetSemantics {},
    )
}

private fun styleBravo() = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = GS.Encre)

/** La fête en plan cinéma : 96 images d'arrivée (8 temps à 124,73 BPM, arrondis à l'image), puis la boucle de 64 temps jusqu'à la fin du fichier ; une image clé est posée sur la 96ᵉ. */
internal const val FETE_BOUCLE_DEBUT_MS = 3_840

/** Le clip du robot qui félicite le gagnant, si la fête en plan cinéma ne se lit pas : entrée de 3,85 s, puis 15,4 s de vol et de danse en boucle (16:9). */
internal const val ROBOT_FETE = "gs_robot_fete"
internal const val ROBOT_FETE_BOUCLE_MS = 3_849

/** Le compteur commun monte de [JAUGES_DEBUT] à [JAUGES_FIN] (ms), puis reste au plafond jusqu'à la montée finale. */
internal const val JAUGES_DEBUT = 1_200f
internal const val JAUGES_FIN = 11_500f
/** Montée finale, sur la fin du roulement : du plafond au meilleur score ; chacun s'arrête à son vrai score. */
internal const val MONTEE_DEBUT = Tempo.PODIUM_REVELATION - 3_000f
internal const val MONTEE_FIN = Tempo.PODIUM_REVELATION - 1_500f
/** Les tubes s'enfoncent sous le plateau entre ces deux instants (ms), juste avant le solo. */
internal const val DESCENTE_DEBUT = Tempo.PODIUM_REVELATION - 900f
internal const val DESCENTE_FIN = Tempo.PODIUM_REVELATION - 100f
private const val DESCENTE_DP = 380f

/** Les tubes (dp sur 960 × 540) : haut, hauteur, et la fente du plateau où ils disparaissent. */
internal const val TUBE_HAUT = 160f
internal const val TUBE_HAUTEUR = 290f
internal const val FENTE_Y = 465f

/**
 * Plafond du suspense (en points) : 90 % du deuxième meilleur score, ou 75 % du meilleur si personne d'autre n'a
 * marqué. Les équipes au-dessus (les premières et les deuxièmes) y restent ensemble jusqu'au solo.
 */
internal fun plafondSuspense(scores: List<Int>): Float {
    val meilleur = scores.maxOrNull() ?: 0
    if (meilleur <= 0) return 0f
    val deuxieme = scores.filter { it in 1 until meilleur }.maxOrNull()
    return if (deuxieme != null) 0.9f * deuxieme else 0.75f * meilleur
}

/**
 * Le compteur commun à [ms] : de 0 au plafond, lent au départ et à l'arrivée ; puis, à la montée finale, du plafond
 * au meilleur score (accélère, puis claque en haut).
 */
internal fun compteurSuspense(ms: Float, scores: List<Int>): Float {
    val plafond = plafondSuspense(scores)
    if (ms >= MONTEE_DEBUT) {
        val v = ((ms - MONTEE_DEBUT) / (MONTEE_FIN - MONTEE_DEBUT)).coerceIn(0f, 1f)
        val meilleur = (scores.maxOrNull() ?: 0).coerceAtLeast(0).toFloat()
        return plafond + (meilleur - plafond) * v * v
    }
    val u = ((ms - JAUGES_DEBUT) / (JAUGES_FIN - JAUGES_DEBUT)).coerceIn(0f, 1f)
    return plafond * u * u * (3 - 2 * u)
}

/** Éclat d'un tube plein (0 → 1) : le gagnant (ou les ex aequo) au sommet après la montée finale, s'il a marqué. */
internal fun tubePlein(ms: Float, points: Int, scores: List<Int>): Float {
    val meilleur = scores.maxOrNull() ?: 0
    if (meilleur <= 0 || points < meilleur || ms < MONTEE_FIN) return 0f
    return (0.6f + 0.4f * kotlin.math.cos((ms - MONTEE_FIN) / 110f)) * ((ms - MONTEE_FIN) / 120f).coerceIn(0f, 1f)
}

/** Le nombre au-dessus d'un tube pendant le suspense : le compteur commun, arrêté au score de l'équipe. */
internal fun valeurSuspense(ms: Float, points: Int, scores: List<Int>): Int =
    minOf(points.coerceAtLeast(0).toFloat(), compteurSuspense(ms, scores)).roundToInt()

/** Remplissage d'un tube (0 → 1, part du meilleur score) : comme le compteur, avec toujours un fond de liquide. */
internal fun remplissage(ms: Float, points: Int, scores: List<Int>): Float {
    val meilleur = scores.maxOrNull() ?: 0
    if (meilleur <= 0) return 0.03f
    return maxOf(0.03f, minOf(points.coerceAtLeast(0).toFloat(), compteurSuspense(ms, scores)) / meilleur)
}

/** Descente des tubes sous le plateau (0 → 1), qui accélère. */
internal fun descenteTubes(ms: Float): Float {
    val u = ((ms - DESCENTE_DEBUT) / (DESCENTE_FIN - DESCENTE_DEBUT)).coerceIn(0f, 1f)
    return u * u
}

/**
 * Place d'un tube (dp sur 960) : [centre], [largeur] du verre, [echelle] des textes, [place] entre deux tubes,
 * [placeNom] largeur où son nom doit tenir, [decale] : nom une ligne plus bas (un sur deux à 3 et 4 tubes par côté).
 */
internal data class PlaceTube(val centre: Float, val largeur: Float, val echelle: Float, val place: Float, val placeNom: Float, val decale: Boolean)

/**
 * Les tubes de 1 à 8 équipes : la moitié (arrondie au-dessus) à gauche de l'arche, le reste à droite, dans les mêmes
 * zones que la maquette validée à 4 équipes. Place par tube min(122,5 ; 280 / n par côté), verre à 60 % de sa place.
 */
internal fun dispositionTubes(n: Int): List<PlaceTube> {
    if (n <= 0) return emptyList()
    val gauche = (n + 1) / 2
    val droite = n - gauche
    val k = maxOf(gauche, droite)
    val place = minOf(122.5f, 280f / k)
    val largeur = minOf(64f, place * 0.6f)
    val echelle = minOf(1.15f, largeur / 64f * 1.15f * (if (k >= 3) 1.08f else 1f))
    val decale = k >= 3
    return listOf(gauche to 165f, droite to 795f).flatMap { (m, zone) ->
        (0 until m).map { i ->
            val x = zone + (i - (m - 1) / 2f) * place
            // Le nom reste à l'écran : sa place ne dépasse jamais 8 dp du bord.
            val nom = minOf((if (decale) place * 2 else place) * 0.94f, 2 * (x - 8f), 2 * (952f - x))
            PlaceTube(x, largeur, echelle, place, nom, decale && i % 2 == 1)
        }
    }
}

/**
 * Écran de fin dessiné du Game Show (secours de [FinCinemaGameShow] si sa vidéo ne se lit pas), sur le dernier groove d'Aerodynamic : « Merci d'avoir participé ! »,
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
                        // Le reflet ne passe que sur les lettres du logo (et leur lueur), jamais en bande rectangulaire
                        // (cedric, 23/10) : calque à part, agrandi pour que la lueur ne soit pas coupée au bord.
                        Box(
                            Modifier.horsCadre(48.dp)
                                .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                                .drawWithContent {
                                    drawContent()
                                    val x = (balayage * 1.8f - 0.4f) * size.width
                                    val l = size.width * 0.22f
                                    drawRect(
                                        Brush.linearGradient(
                                            0f to Color.Transparent, 0.5f to Color.White.copy(alpha = 0.55f), 1f to Color.Transparent,
                                            start = Offset(x - l, 0f), end = Offset(x + l, size.height * 0.35f),
                                        ),
                                        blendMode = BlendMode.SrcAtop,
                                    )
                                }
                                .padding(48.dp),
                        ) { LogoGameShow(84.dp, aligne = Alignment.CenterHorizontally) }
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
                        modifier = Modifier.apparition(1_600, Unit).graphicsLayer { alpha = 0.75f + 0.25f * souffle; compositingStrategy = CompositingStrategy.ModulateAlpha },
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

/** Déborde de [marge] de tous côtés sans changer la place occupée (pour un calque qui garde toute la lueur). */
private fun Modifier.horsCadre(marge: androidx.compose.ui.unit.Dp): Modifier = layout { mesurable, contraintes ->
    val m = marge.roundToPx()
    val p = mesurable.measure(contraintes.offset(2 * m, 2 * m))
    layout((p.width - 2 * m).coerceAtLeast(0), (p.height - 2 * m).coerceAtLeast(0)) { p.place(-m, -m) }
}
