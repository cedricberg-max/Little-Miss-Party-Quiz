package com.littlemissparty.quiz.tv

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.ChronoResult
import com.littlemissparty.quiz.engine.ChronoBuzz
import com.littlemissparty.quiz.engine.ChronoRound
import com.littlemissparty.quiz.engine.centiemes
import com.littlemissparty.quiz.tv.habillage.BouclePcm
import com.littlemissparty.quiz.tv.habillage.EchelleSansCoupe
import com.littlemissparty.quiz.tv.habillage.GS
import com.littlemissparty.quiz.tv.habillage.Ordre
import com.littlemissparty.quiz.tv.habillage.Son
import com.littlemissparty.quiz.tv.habillage.Sons
import com.littlemissparty.quiz.tv.habillage.PoliceGsChiffres
import com.littlemissparty.quiz.tv.habillage.PoliceGsTexte
import com.littlemissparty.quiz.tv.habillage.PoliceGsTitre
import com.littlemissparty.quiz.tv.habillage.SCENE_H
import com.littlemissparty.quiz.tv.habillage.SCENE_L
import com.littlemissparty.quiz.tv.habillage.TexteNeon
import kotlinx.coroutines.delay
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.sin

/*
 * ⏱️ Le Chrono de Buzzy sur la TV (cedric, 30/10). L'écran ne décide rien : la box tire le moment du drap, reçoit les buzz
 * et juge. Ici : le tour prêt (la cible), le décompte 3, 2, 1, le chrono qui défile au centième, puis Buzzy qui jette
 * son drap dessus (derrière, plus aucun chiffre n'est dessiné), et la révélation sur la règle du temps : le drapeau à
 * tête de Buzzy sur la cible, la pastille de chaque équipe là où elle a buzzé, la plus proche en dernier.
 * Dessin PROVISOIRE : le vrai décor, le drap et le drapeau viennent du design Game Show.
 */

/** Durée de la chute du drap ; les chiffres ne sont plus dessinés dès [DRAP_COUVRE_MS] (le drap les couvre déjà). */
internal const val DRAP_CHUTE_MS = 550L
internal const val DRAP_COUVRE_MS = 520L

/** « 12,34 » : secondes et centièmes du chrono (jamais négatif). */
internal fun texteChrono(ms: Long): String {
    val m = ms.coerceAtLeast(0)
    return "%02d,%02d".format(m / 1000, (m % 1000) / 10)
}

/** « +1,24 s », « −0,80 s », « pile ! ». */
internal fun texteEcart(ms: Long): String {
    val c = centiemes(ms)
    if (c == 0L) return "PILE !"
    return "${if (ms > 0) "+" else "−"}${c / 100},%02d s".format(c % 100)
}

/** Ordre de la révélation : la plus loin d'abord, la plus proche en dernier (suspense). */
internal fun ordreRevelation(ecarts: Map<String, Long>): List<String> = ecarts.entries.sortedByDescending { abs(it.value) }.map { it.key }

@Composable
fun ChronoScreen(state: UiState.Playing, actions: TvActions) {
    val c = state.chrono
    val decalage = state.duelOffset ?: state.serverOffset
    val maintenant = { System.currentTimeMillis() + decalage }
    val goAt = c?.goAt
    val enCours = c?.enCours == true
    // Le chrono au centième, image par image, de la fin du décompte jusqu'au jugement.
    val ecoule by produceState(Long.MIN_VALUE, goAt, enCours, decalage) {
        value = Long.MIN_VALUE
        if (goAt == null || !enCours) return@produceState
        while (true) {
            withFrameNanos { }
            value = maintenant() - goAt
        }
    }
    // L'instant où le 0 est vraiment à l'écran : la box mesure les buzz depuis cet instant (comme le PAN du Duel).
    LaunchedEffect(goAt) {
        if (goAt == null || c?.shownAt != null || c?.result != null) return@LaunchedEffect
        val attente = goAt - maintenant()
        if (attente < -1_500) return@LaunchedEffect
        if (attente > 0) delay(attente)
        withFrameNanos { }
        actions.chronoShown()
    }
    ChronoSons(c, ecoule, maintenant, state.teams.map { it.uid })
    val depuisResultat by produceState(0L, c?.result?.at, decalage) {
        val at = c?.result?.at ?: return@produceState
        while (true) {
            value = maintenant() - at
            withFrameNanos { }
            if (value > 30_000) break
        }
    }

    EchelleSansCoupe(SCENE_L, SCENE_H, Modifier.fillMaxSize()) {
        if (c?.result != null) {
            Column(Modifier.fillMaxWidth().padding(top = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                // Le titre jusqu'à la gagnante : son bandeau prend alors sa place (la cible est écrite près du drapeau).
                if (depuisResultat < finRevelation(c.result!!)) {
                    TexteNeon("LE CHRONO DE BUZZY", GS.Cyan, 80f, police = PoliceGsTitre, largeurMax = 1500.dp)
                }
            }
        }
        when {
            c == null -> Unit
            c.result != null -> Revelation(state, c, depuisResultat)
            enCours -> ChronoEnCours(state, c, ecoule)
            else -> ChronoPret(c)
        }
        // Prêt et chrono en cours (écran prêt A de cedric, 30/10) : l'objectif en grand en haut à droite, au-dessus de
        // Buzzy, jamais sur le chrono.
        if (c != null && c.result == null) Objectif(c, state.chronoTours, Modifier.align(Alignment.TopEnd).padding(top = 40.dp, end = 70.dp))
    }
}

/** L'objectif du tour : « TOUR 1 / 3 », « OBJECTIF », la cible en très grand et « SECONDES » (texte seul sur le décor). */
@Composable
private fun Objectif(c: ChronoRound, tours: Int, modifier: Modifier) {
    Column(modifier.width(640.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        // Plus de « TOUR 1 / 3 » à l'écran : le compte reste sur la régie (cedric, 1/11 au soir).
        TexteNeon("OBJECTIF", Color.White, 52f, police = PoliceGsTitre, largeurMax = 640.dp, force = 0.6f)
        Row(verticalAlignment = Alignment.Bottom) {
            Text("${c.cible}", style = chiffreStyle(150f, GS.Jaune, Color(0xFFFF9F1C)), maxLines = 1)
            Text(" SECONDES", style = chiffreStyle(56f, GS.Jaune, Color(0xFFFF9F1C)), maxLines = 1, modifier = Modifier.padding(bottom = 24.dp))
        }
    }
}

/**
 * Un son du Chrono de Buzzy à l'instant [instant] (ms) de la révélation, à la [vitesse] donnée (hauteur), au [volume]
 * donné : les petits sons de la révélation à 0,7 sous la boucle B, la fanfare finale à plein volume (cedric, 31/10).
 */
internal data class SonChrono(val instant: Long, val son: Son, val vitesse: Float = 1f, val volume: Float = CHRONO_SFX_VOLUME)

/** Volume des petits sons de la révélation (règle, drapeau, pastilles, ralenti), sous la boucle B. */
internal const val CHRONO_SFX_VOLUME = 0.7f

/**
 * Les sons de la révélation, calés sur ses images (la vidéo validée par cedric le 1/11) : la ligne repère se dessine, le
 * drapeau tombe et se plante ; chaque ligne d'équipe arrive dans un petit souffle, sa pastille fait « fiou-plop » en se
 * posant, un peu plus aigu à chaque fois ; la plus proche glisse au ralenti ; puis gagné, « PILE ! » au centième, ou personne.
 */
internal fun sonsRevelation(ecarts: Map<String, Long>, winners: List<String>): List<SonChrono> {
    val n = ecarts.size
    val sons = mutableListOf(SonChrono(REV_REGLE_MS, Son.CHRONO_REGLE), SonChrono(REV_DRAPEAU_MS, Son.CHRONO_DRAPEAU))
    for (i in 0 until n) {
        val a = arriveeLigne(i, n)
        sons += SonChrono(a, Son.WHOOSH, volume = 0.35f)
        sons += if (i == n - 1) SonChrono(a + 300, Son.CHRONO_RALENTI) else SonChrono(a + 300, Son.CHRONO_PASTILLE, 1f + 0.06f * i)
    }
    sons += SonChrono(
        finRevelation(n),
        when {
            winners.isEmpty() -> Son.CHRONO_PERSONNE
            winners.any { centiemes(ecarts[it] ?: Long.MAX_VALUE) == 0L } -> Son.CHRONO_PILE
            else -> Son.CHRONO_GAGNE
        },
        volume = 1f,
    )
    return sons.sortedBy { it.instant }
}

/**
 * Le son du chrono, image par image : 3, 2, 1 (bips), le départ, puis le tic-tac une fois par seconde tant qu'on voit
 * les chiffres (le tempo à garder en tête, cedric 1/11 : chaque tic pile quand la seconde change à l'écran), plus rien
 * quand le drap tombe (son lancer, le fantôme) ; à chaque buzz, le mot Daft Punk de l'équipe, comme dans tous les jeux
 * au buzzer (cedric, 31/10) ; à la révélation, [sonsRevelation]. Un son déjà passé de plus de 300 ms n'est jamais joué
 * en retard.
 */
@Composable
private fun ChronoSons(c: ChronoRound?, ecoule: Long, maintenant: () -> Long, equipes: List<String>) {
    val cache = c?.cacheMs
    // Le son part en avance du temps que cette box met à le faire entendre (mesuré sur sa sortie son), moins l'image
    // que l'écran met à s'afficher : le tic tombe avec le chiffre, pas après.
    val avance = avanceTic(BouclePcm.latenceMs)
    val seconde = if (ecoule == Long.MIN_VALUE || c?.enCours != true) null else secondeTic(ecoule, avance)
    LaunchedEffect(seconde) {
        val s = seconde ?: return@LaunchedEffect
        if (ecoule + avance - s * 1_000L > 300 || cache == null) return@LaunchedEffect
        sonSeconde(s, cache)?.let { jouerChrono(it) }
    }
    val drapTombe = seconde != null && cache != null && ecoule >= cache
    LaunchedEffect(drapTombe) { if (drapTombe && ecoule - cache!! < 400) jouerChrono(Son.CHRONO_DRAP) }
    val buzz = c?.buzzes?.size ?: 0
    val vus = remember(c?.goAt) { mutableIntStateOf(buzz) }
    LaunchedEffect(buzz) {
        if (buzz > vus.intValue && c?.enCours == true) sonsNouveauxBuzz(c.buzzes, vus.intValue, equipes).forEach { jouerChrono(it) }
        vus.intValue = buzz
    }
    val r = c?.result
    LaunchedEffect(r?.at) {
        r ?: return@LaunchedEffect
        for (son in sonsRevelation(r.ecarts, r.winners)) {
            val attente = r.at + son.instant - maintenant()
            if (attente < -300) continue
            if (attente > 0) delay(attente)
            jouerChrono(son.son, son.vitesse, son.volume)
        }
    }
}

/** Avance du tic sur l'image : la latence de la sortie son de la box, moins une image et demie (25 ms), 0 à 200 ms. */
internal fun avanceTic(latenceMs: Long): Long = (latenceMs - 25L).coerceIn(0L, 200L)

/** La seconde dont le son doit partir maintenant : celle qui s'affichera dans [avance] ms. */
internal fun secondeTic(ecoule: Long, avance: Long): Long = Math.floorDiv(ecoule + avance, 1_000L)

/**
 * Le son de la seconde [s] du chrono : bips à 3, 2, 1, le départ à 0, puis tic, tac tant que le chiffre de cette seconde
 * est encore à l'écran (jamais un tic sous le drap) ; null sinon.
 */
internal fun sonSeconde(s: Long, cacheMs: Long): Son? = when {
    s in -3L..-1L -> Son.CHRONO_BIP
    s == 0L -> Son.CHRONO_GO
    s >= 1 && s * 1_000L < cacheMs && chiffresVisibles(s * 1_000L, cacheMs) -> if (s % 2 == 1L) Son.CHRONO_TIC else Son.CHRONO_TAC
    else -> null
}

/**
 * Les buzz arrivés depuis [vus] : le mot de chaque équipe (sa place dans la partie, le même que sur sa tablette et dans
 * les autres jeux au buzzer, cedric 31/10). Une équipe introuvable garde le petit « tok » du chrono.
 */
internal fun sonsNouveauxBuzz(buzzes: List<ChronoBuzz>, vus: Int, equipes: List<String>): List<Son> =
    buzzes.drop(vus.coerceAtLeast(0)).map { b -> equipes.indexOf(b.team).let { if (it >= 0) Son.equipe(it) else Son.CHRONO_BUZZ } }

private fun jouerChrono(son: Son, vitesse: Float = 1f, volume: Float = 1f) =
    Sons.executer(listOf(Ordre.Jouer(son, gauche = volume, droite = volume, vitesse = vitesse)))

/** Le tour prêt : le chrono à zéro, Buzzy qui bouge un tout petit peu à côté (cedric, 1/11), la consigne. */
@Composable
private fun androidx.compose.foundation.layout.BoxScope.ChronoPret(c: ChronoRound) {
    var enPanne by remember(c.tour) { mutableStateOf(false) }
    val boucle = attenteDisponible() && !enPanne
    Cadran(0L, c.cible, null, Modifier.fillMaxSize(), video = if (!boucle) null else {
        { ClipAttente({ enPanne = true }, Modifier.fillMaxSize()) }
    })
    Consigne("Prêts ? Comptez dans votre tête et buzzez à ${c.cible} secondes pile !", Modifier.align(Alignment.BottomCenter).padding(bottom = 60.dp), GS.Rose)
}

/** Décompte, chrono qui défile, puis le drap de Buzzy ; en bas, les équipes qui ont buzzé. */
@Composable
private fun androidx.compose.foundation.layout.BoxScope.ChronoEnCours(state: UiState.Playing, c: ChronoRound, ecoule: Long) {
    val cache = c.cacheMs ?: Long.MAX_VALUE
    val drap = if (ecoule == Long.MIN_VALUE || ecoule < cache) 0f else ((ecoule - cache).toFloat() / DRAP_CHUTE_MS).coerceIn(0f, 1f)
    // Le clip du lancer à deux mains (cedric, 31/10) ; absent ou illisible : le drap dessiné d'avant tombe à sa place.
    var clipEnPanne by remember(c.goAt) { mutableStateOf(false) }
    val clip = lancerDisponible() && !clipEnPanne && c.cacheMs != null && c.goAt != null
    // Sous le drap : plus aucun chiffre ni aucune graduation n'est dessiné (null).
    val temps = when {
        ecoule == Long.MIN_VALUE || ecoule < 0 -> 0L
        clip -> if (chiffresVisibles(ecoule, cache)) ecoule else null
        ecoule < cache + DRAP_COUVRE_MS -> ecoule
        else -> null
    }
    val decompte = if (ecoule != Long.MIN_VALUE && ecoule < 0) ((-ecoule + 999) / 1000).toString() else null
    val maintenant = { System.currentTimeMillis() + (state.duelOffset ?: state.serverOffset) }
    Cadran(
        temps, c.cible, decompte, Modifier.fillMaxSize(), drap = if (clip) 0f else drap, tempsDrap = if (drap > 0f) ecoule - cache else 0L,
        video = if (!clip) null else {
            { ClipLancer(c.goAt, c.goAt!! + departLancer(cache), maintenant, { clipEnPanne = true }, Modifier.fillMaxSize()) }
        },
    )
    Consigne(
        when {
            decompte != null -> "Prêts ? Le chrono va partir…"
            drap <= 0f -> "Regardez bien le chrono…"
            else -> "Comptez dans votre tête… et buzzez à ${c.cible} secondes pile !"
        },
        Modifier.align(Alignment.BottomCenter).padding(bottom = 170.dp),
    )
    // Les équipes du tour : leur nom en couleur, allumé quand elle a buzzé (jamais l'heure avant la révélation).
    val equipes = c.teams.mapNotNull { uid -> state.teams.find { it.uid == uid } }
    val taille = when { equipes.size <= 4 -> 44f; equipes.size <= 6 -> 36f; else -> 30f }
    Row(
        Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(start = 60.dp, end = 60.dp, bottom = 60.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        equipes.forEach { t ->
            val a = c.buzzes.any { it.team == t.uid }
            val couleur = t.color.toColor()
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                TexteNeon(
                    if (a) "✓ ${t.name}" else t.name, couleur, taille, police = PoliceGsTitre,
                    largeurMax = (1800 / equipes.size.coerceAtLeast(1) - 20).dp, force = if (a) 1f else 0.35f, tailleMin = 18f,
                    modifier = Modifier.alpha(if (a) 1f else 0.55f),
                )
            }
        }
    }
}

/** Une consigne en blanc, posée sur le décor avec un halo (jamais de cadre autour). */
@Composable
private fun Consigne(texte: String, modifier: Modifier, couleur: Color = Color.White) {
    Text(
        texte,
        modifier.padding(horizontal = 120.dp),
        style = TextStyle(
            fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 50.sp, textAlign = TextAlign.Center, color = couleur,
            shadow = Shadow(Color.Black, Offset.Zero, 22f),
        ),
        maxLines = 2,
    )
}

/** Le cadran vide du chrono géant sur [PLATEAU_CHRONO] (scène 1920 × 1080) : son centre et son rayon. */
internal val CADRAN_CENTRE = Offset(707f, 487f)
internal const val CADRAN_RAYON = 234f
internal const val PLATEAU_CHRONO = "gs_chrono_plateau"

/** Graduations allumées sur 60 quand [ms] sont écoulées sur une cible de [cible] secondes (un tour = la cible). */
internal fun graduationsAllumees(ms: Long, cible: Int): Int = (ms * 60 / (cible * 1_000L).coerceAtLeast(1)).toInt().coerceIn(0, 60)

/**
 * Le chrono géant 3D de Buzzy (choix B de cedric, 30/10) : le plateau et son cadran vide, et dans le cadran, dessinés en
 * direct, les 60 graduations (un tour = la cible, celles du temps écoulé s'allument de cyan à rose), le triangle doré
 * de la cible, les secondes en blanc et « ,42 » en rose, « SECONDES » dessous. [temps] null : le drap couvre le cadran,
 * plus rien n'y est dessiné. [decompte] : le 3, 2, 1 avant le départ. [drap] : avancée de la chute du drap (0 à 1).
 */
@Composable
private fun Cadran(
    temps: Long?, cible: Int, decompte: String?, modifier: Modifier, drap: Float = 0f, tempsDrap: Long = 0,
    video: (@Composable () -> Unit)? = null,
) {
    val plateau = com.littlemissparty.quiz.tv.habillage.imageAppli(PLATEAU_CHRONO)
    val drapImage = com.littlemissparty.quiz.tv.habillage.imageAppli(DRAP_IMAGE)
    val main = com.littlemissparty.quiz.tv.habillage.imageAppli(DRAP_MAIN)
    Box(modifier) {
        Canvas(Modifier.fillMaxSize()) {
            plateau?.let { drawImage(it, dstOffset = IntOffset.Zero, dstSize = IntSize(size.width.toInt(), size.height.toInt())) }
        }
        // Le clip du lancer passe sur le plateau (sa première image est le plateau), sous les chiffres du cadran.
        video?.invoke()
        Canvas(Modifier.fillMaxSize()) {
            val k = size.width / 1920f
            if (temps == null) return@Canvas
            val c = Offset(CADRAN_CENTRE.x * k, CADRAN_CENTRE.y * k)
            val r = CADRAN_RAYON * k
            val allumees = if (decompte != null) 0 else graduationsAllumees(temps, cible)
            for (i in 0 until 60) {
                val a = (i / 60.0 * 2 * Math.PI - Math.PI / 2)
                val fort = i % 5 == 0
                val dx = kotlin.math.cos(a).toFloat()
                val dy = sin(a).toFloat()
                val allume = i < allumees
                val couleur = if (allume) lerp(GS.Cyan, GS.Rose, i / 59f) else Color(0x55A9A0D8)
                drawLine(
                    couleur, Offset(c.x + dx * r * 0.79f, c.y + dy * r * 0.79f), Offset(c.x + dx * r * 0.92f, c.y + dy * r * 0.92f),
                    strokeWidth = (if (fort) 7f else 3.5f) * k, cap = StrokeCap.Round,
                )
            }
            // La cible : un petit triangle doré en haut, pointe vers le centre.
            val tri = Path().apply {
                moveTo(c.x, c.y - r * 0.80f)
                lineTo(c.x - 13f * k, c.y - r * 0.93f)
                lineTo(c.x + 13f * k, c.y - r * 0.93f)
                close()
            }
            drawPath(tri, Color(0xFFFFC933))
        }
        if (temps != null) {
            val centre = Modifier.offset((CADRAN_CENTRE.x - 230f).dp, (CADRAN_CENTRE.y - 120f).dp).size(460.dp, 240.dp)
            Column(centre, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                if (decompte != null) {
                    Text(decompte, style = chiffreStyle(170f, GS.Rose), maxLines = 1)
                } else {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text("${temps / 1000}", style = chiffreStyle(150f, Color.White, GS.Cyan), maxLines = 1)
                        Text(",%02d".format((temps % 1000) / 10), style = chiffreStyle(70f, GS.Rose), maxLines = 1, modifier = Modifier.padding(bottom = 22.dp))
                    }
                    Text("SECONDES", style = chiffreStyle(30f, GS.CyanClair, GS.Cyan), maxLines = 1)
                }
            }
        }
        if (drap > 0f) Drap(drap, tempsDrap, drapImage, main, Modifier.fillMaxSize())
    }
}

/** Chiffres en Bungee (le zéro d'Orbitron se lit « Ø ») : couleur et lueur néon, sans cadre. */
private fun chiffreStyle(taille: Float, couleur: Color, lueur: Color = couleur) = TextStyle(
    fontFamily = PoliceGsTitre, fontSize = taille.sp, lineHeight = taille.sp, color = couleur, textAlign = TextAlign.Center,
    shadow = Shadow(lueur.copy(alpha = 0.85f), Offset.Zero, taille * 0.35f),
)

/** Le drap fantôme validé par cedric (30/10) : rendu 3D, posé sur le chrono géant, à sa place exacte dans la scène 1920×1080. */
internal const val DRAP_IMAGE = "gs_chrono_drap"
/** La main de Buzzy, qui passe devant le drap (découpée du plateau) : redessinée par-dessus. */
internal const val DRAP_MAIN = "gs_chrono_drap_main"
private val DRAP_POS = Offset(260f, 117f)
private val MAIN_POS = Offset(978f, 552f)
/** Hauteur d'où le drap tombe (en px de la scène). */
private const val DRAP_HAUTEUR = 950f

/**
 * Où est le drap pendant sa chute ([avance] de 0 à 1) puis [temps] ms après son lancer : décalage vertical (négatif = plus
 * haut que sa place), écrasement vertical à l'arrivée (1 = aucun). Il accélère en tombant, s'écrase un peu en touchant le
 * chrono, rebondit à peine, puis respire doucement.
 */
internal fun positionDrap(avance: Float, temps: Long): Pair<Float, Float> {
    val chute = avance.coerceIn(0f, 1f)
    val dy = -(1f - chute * chute) * DRAP_HAUTEUR
    if (chute < 1f) return dy to 1f
    val apres = ((temps - DRAP_CHUTE_MS).coerceAtLeast(0L)).toFloat()
    val atterrit = (apres / 520f).coerceIn(0f, 1f)
    val ecrase = if (atterrit < 1f) (sin(atterrit * Math.PI * 2.0) * 0.07 * (1f - atterrit)).toFloat() else 0f
    val respire = (sin(apres / 1_400.0 * Math.PI * 2.0) * 0.006).toFloat()
    return dy to (1f - ecrase + respire)
}

/** Le drap fantôme (en attendant le clip du lancer) : il tombe sur le chrono, s'écrase un peu, puis respire. */
@Composable
private fun Drap(avance: Float, temps: Long, drap: ImageBitmap?, main: ImageBitmap?, modifier: Modifier) {
    Canvas(modifier) {
        val k = size.width / 1920f
        val (dy, ey) = positionDrap(avance, temps)
        if (drap != null) {
            val l = drap.width * k
            val h = drap.height * k
            // Écrasé depuis le bas (l'ourlet reste posé), un peu élargi d'autant.
            val hh = h * ey
            val ll = l * (1f + (1f - ey) * 0.6f)
            val x = DRAP_POS.x * k - (ll - l) / 2
            val y = (DRAP_POS.y + dy) * k + (h - hh)
            drawImage(drap, dstOffset = IntOffset(x.toInt(), y.toInt()), dstSize = IntSize(ll.toInt(), hh.toInt()))
        }
        if (main != null) drawImage(main, dstOffset = IntOffset((MAIN_POS.x * k).toInt(), (MAIN_POS.y * k).toInt()), dstSize = IntSize((main.width * k).toInt(), (main.height * k).toInt()))
    }
}

/** Le fanion doré : son coin haut gauche [haut] contre le mât, [l] × [h], qui ondule avec le temps [t] ; une étoile blanche. */
private fun DrawScope.fanion(haut: Offset, l: Float, h: Float, t: Long) {
    val o = (t % 1_600L) / 1_600f * 2f * Math.PI.toFloat()
    val v = { x: Float -> sin(o - x * 3f) * h * 0.08f * x }
    val p = Path().apply {
        moveTo(haut.x, haut.y)
        cubicTo(haut.x + l * 0.33f, haut.y + v(0.33f) - h * 0.06f, haut.x + l * 0.66f, haut.y + v(0.66f) + h * 0.06f, haut.x + l, haut.y + v(1f))
        lineTo(haut.x + l, haut.y + h + v(1f))
        cubicTo(haut.x + l * 0.66f, haut.y + h + v(0.66f) + h * 0.06f, haut.x + l * 0.33f, haut.y + h + v(0.33f) - h * 0.06f, haut.x, haut.y + h)
        close()
    }
    drawPath(p, Color(0x66FFB000), style = Stroke(h * 0.22f))
    drawPath(p, Brush.verticalGradient(listOf(Color(0xFFFFE27A), Color(0xFFFFC21A), Color(0xFFE09600)), haut.y, haut.y + h))
    drawPath(p, Color(0xFFFFF1B8), style = Stroke(2.5f))
    val c = Offset(haut.x + l * 0.48f, haut.y + h * 0.5f + v(0.48f))
    val etoile = Path().apply {
        for (i in 0 until 10) {
            val r = if (i % 2 == 0) h * 0.36f else h * 0.15f
            val a = -Math.PI / 2 + i * Math.PI / 5
            val pt = Offset(c.x + (kotlin.math.cos(a) * r).toFloat(), c.y + (sin(a) * r).toFloat())
            if (i == 0) moveTo(pt.x, pt.y) else lineTo(pt.x, pt.y)
        }
        close()
    }
    drawPath(etoile, Color.White)
}

/*
 * La révélation (cedric, 1/11 : sa version B, validée en vidéo avec le son). En haut, la ligne repère : la ligne du temps
 * se dessine, le drapeau du pays des robots (tête de Buzzy dans l'étoile) tombe et se plante au milieu, « 30 SECONDES »
 * (les secondes du tour) pope à côté, un mât pointillé descend. Puis une ligne par équipe, la plus proche en haut : elles
 * arrivent une à une, la plus loin d'abord, avec le « fiou-plop » d'hier un peu plus aigu à chaque fois, la pastille
 * pope là où l'équipe a buzzé. La gagnante glisse lentement depuis le bord jusqu'à sa place, puis fanfare, confettis, et
 * son bandeau remplace le titre. Les lignes s'adaptent au nombre d'équipes (plus serrées à 8).
 */
internal const val REV_REGLE_MS = 250L
internal const val REV_DRAPEAU_MS = 550L
internal const val REV_MAT_MS = 1_000L
internal const val REV_PREMIERE_MS = 1_600L
internal const val REV_GLISSE_MS = 1_500L

/** Écart entre deux lignes qui arrivent : plus rapide quand il y en a beaucoup. */
internal fun pasRevelation(n: Int): Long = if (n > 4) 850L else 1_100L

/** Arrivée de la [i]-ème ligne révélée (la plus loin d'abord) sur [n]. */
internal fun arriveeLigne(i: Int, n: Int): Long = REV_PREMIERE_MS + i * pasRevelation(n)

/** Le moment (depuis le résultat) où la plus proche est posée et où la gagnante s'affiche. */
internal fun finRevelation(r: ChronoResult): Long = finRevelation(r.ecarts.size)
internal fun finRevelation(n: Int): Long = if (n <= 0) REV_PREMIERE_MS else arriveeLigne(n - 1, n) + REV_GLISSE_MS

/** Les lignes à l'écran : la ligne repère, la première équipe, la hauteur d'une ligne, la taille des noms. */
internal data class GeoResultats(val yRepere: Float, val y0: Float, val h: Float, val police: Float)

internal fun geoResultats(n: Int): GeoResultats {
    val yRepere = if (n <= 3) 420f else 340f
    val y0 = yRepere + if (n <= 3) 150f else 85f
    val h = minOf(130f, (1045f - y0) / n.coerceAtLeast(1))
    return GeoResultats(yRepere, y0, h, minOf(44f, h * 0.5f))
}

/** Demi-largeur de la ligne du temps, en secondes : toutes les équipes dedans, au moins 2 s. */
internal fun demiRegle(ecarts: Collection<Long>): Int =
    maxOf(2, ceil((ecarts.maxOfOrNull { abs(it) } ?: 0L) / 1000.0 + 0.3).toInt())

/** Un repère toutes les [pasGraduation] secondes (jamais plus de 6 de chaque côté). */
internal fun pasGraduation(demi: Int): Int = maxOf(1, ceil(demi / 6.0).toInt())

private const val REGLE_G = 700f
private const val REGLE_D = 1480f
private fun sortie(x: Float) = 1f - (1f - x.coerceIn(0f, 1f)).let { it * it * it }
private fun rebond(x: Float): Float { val u = x.coerceIn(0f, 1f) - 1f; return 1f + 2.70158f * u * u * u + 1.70158f * u * u }
private fun elastique(x: Float): Float {
    val u = x.coerceIn(0f, 1f)
    return if (u == 0f || u == 1f) u else (Math.pow(2.0, -10.0 * u) * sin((u * 10f - 0.75f) * 2f * Math.PI.toFloat() / 3f) + 1.0).toFloat()
}
private fun hasard(i: Int): Float { val x = sin(i * 12.9898f) * 43758.547f; return x - kotlin.math.floor(x) }

@Composable
private fun androidx.compose.foundation.layout.BoxScope.Revelation(state: UiState.Playing, c: ChronoRound, t: Long) {
    val r = c.result ?: return
    val ordre = ordreRevelation(r.ecarts)
    val n = ordre.size
    val rang = ordre.reversed()                       // rang 0 = la plus proche, en haut
    val g = geoResultats(n)
    val demi = demiRegle(r.ecarts.values)
    val xDe = { ecartMs: Long -> (REGLE_G + REGLE_D) / 2 + (ecartMs / 1000f) / demi * (REGLE_D - REGLE_G) / 2 }
    val couleur = { uid: String -> state.teams.find { it.uid == uid }?.color?.toColor() ?: Color.White }
    val nom = { uid: String -> state.teams.find { it.uid == uid }?.name ?: "Une équipe" }
    val fin = finRevelation(n)
    val yLigne = { uid: String -> g.y0 + rang.indexOf(uid) * g.h }
    val drapeau = com.littlemissparty.quiz.tv.habillage.imageAppli("gs_chrono_drapeau_buzzy")
    val xc = xDe(0)
    val chute = ((t - REV_DRAPEAU_MS) / 450f)
    val dyDrapeau = if (t < REV_DRAPEAU_MS) -2_000f else (1f - rebond(chute)) * -500f

    Canvas(Modifier.fillMaxSize()) {
        val k = size.width / 1920f
        // La ligne repère : un tube doré qui se dessine, un repère par seconde.
        val d = sortie((t - REV_REGLE_MS) / 500f)
        val xa = REGLE_G - 40f
        val xb = xa + (REGLE_D + 40f - xa) * d
        if (t >= REV_REGLE_MS) {
            drawLine(GS.Jaune.copy(alpha = 0.25f), Offset(xa * k, g.yRepere * k), Offset(xb * k, g.yRepere * k), strokeWidth = 22f * k)
            drawLine(Color(0xFFFFE27A), Offset(xa * k, g.yRepere * k), Offset(xb * k, g.yRepere * k), strokeWidth = 6f * k)
            val pas = pasGraduation(demi)
            var s = -demi
            while (s <= demi) {
                val x = xDe(s * 1000L)
                if (s != 0 && x <= xb) drawLine(Color(0xFFFFE27A), Offset(x * k, (g.yRepere - 14f) * k), Offset(x * k, (g.yRepere + 14f) * k), strokeWidth = 3f * k)
                s += pas
            }
        }
        // Le mât pointillé qui descend du drapeau à travers les lignes.
        if (t >= REV_MAT_MS && n > 0) {
            val bas = g.y0 + (n - 1) * g.h + g.h * 0.45f
            val y2 = g.yRepere + (bas - g.yRepere) * sortie((t - REV_MAT_MS) / 600f)
            drawLine(GS.Jaune.copy(alpha = 0.22f), Offset(xc * k, g.yRepere * k), Offset(xc * k, y2 * k), strokeWidth = 18f * k)
            drawLine(
                GS.Jaune, Offset(xc * k, g.yRepere * k), Offset(xc * k, y2 * k), strokeWidth = 5f * k,
                pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(14f * k, 10f * k), -t / 25f * k),
            )
        }
        // Les lignes des équipes, qui glissent depuis la gauche.
        ordre.forEachIndexed { i, uid ->
            val a = arriveeLigne(i, n)
            if (t < a) return@forEachIndexed
            val sl = sortie((t - a) / 350f)
            val y = yLigne(uid) * k
            val off = (1f - sl) * -300f * k
            drawLine(couleur(uid).copy(alpha = 0.55f * sl), Offset(REGLE_G * k + off, y), Offset(REGLE_D * k + off, y), strokeWidth = maxOf(3f, g.h * 0.05f) * k)
        }
        // La ligne gagnante qui pulse.
        if (t >= fin && r.winners.isNotEmpty()) {
            val tc = (t - fin) / 1000f
            r.winners.forEach { w ->
                val y = yLigne(w) * k
                drawLine(couleur(w).copy(alpha = 0.35f + 0.2f * sin(tc * 8f)), Offset(REGLE_G * k, y), Offset(REGLE_D * k, y), strokeWidth = (10f + 6f * sin(tc * 8f)) * k)
            }
        }
        // Les pastilles : elles popent à leur place ; la dernière (la plus proche) glisse lentement depuis le bord.
        ordre.forEachIndexed { i, uid ->
            val tp = arriveeLigne(i, n) + 300
            if (t < tp) return@forEachIndexed
            val e = r.ecarts.getValue(uid)
            val derniere = i == n - 1
            val cible = xDe(e)
            val x: Float
            val echelle: Float
            if (derniere) {
                val bord = xDe(if (e >= 0) demi * 1000L else -demi * 1000L)
                val q = ((t - tp) / (REV_GLISSE_MS - 300f)).coerceIn(0f, 1f)
                x = bord + (cible - bord) * (1f - (1f - q) * (1f - q) * (1f - q) * (1f - q))
                echelle = 1f
            } else {
                x = cible
                echelle = elastique((t - tp) / 600f)
            }
            val y = yLigne(uid)
            val rr = maxOf(14f, g.h * 0.22f) * echelle
            val coul = couleur(uid)
            drawCircle(coul.copy(alpha = 0.3f), rr * 1.7f * k, Offset(x * k, y * k))
            drawCircle(coul, rr * k, Offset(x * k, y * k))
            drawCircle(Color.White, rr * k, Offset(x * k, y * k), style = Stroke(4f * k))
            // Étincelles du pop (la gagnante : quand elle se pose).
            val b = (t - (if (derniere) fin else tp)) / 600f
            if (b in 0f..1f) for (j in 0 until 12) {
                val ang = j / 12f * 2f * Math.PI.toFloat() + hasard(j + i) * 0.4f
                val dd = (30f + g.h * 0.6f) * sortie(b)
                drawCircle(if (j % 2 == 1) Color.White else coul, 5f * (1f - b) * k, Offset((cible + kotlin.math.cos(ang) * dd) * k, (y + sin(ang) * dd) * k))
            }
        }
        // Le drapeau : son mât blanc planté sur la ligne repère, le tissu qui se balance un peu.
        if (t >= REV_DRAPEAU_MS) {
            val pied = (g.yRepere + dyDrapeau) * k
            val haut = pied - 200f * k
            drawLine(Color(0xFFFFF3C4), Offset(xc * k, pied), Offset(xc * k, haut), strokeWidth = 7f * k)
            drawCircle(GS.Jaune, 9f * k, Offset(xc * k, haut - 4f * k))
            if (drapeau != null) {
                val l = 190f * k
                val h = l * drapeau.height / drapeau.width
                val angle = sin(t / 1000f * 5f) * 2.5f
                withTransform({ rotate(angle, Offset(xc * k, haut)) }) {
                    // Le bord gauche du tissu (2 % de l'image) contre le mât.
                    drawImage(drapeau, dstOffset = IntOffset((xc * k - l * 0.02f).toInt(), (haut - h * 0.09f).toInt()), dstSize = IntSize(l.toInt(), h.toInt()))
                }
            } else fanion(Offset(xc * k + 4f * k, haut), 150f * k, 98f * k, t)
        }
        // Confettis quand la gagnante est posée.
        if (t >= fin && r.winners.isNotEmpty()) {
            val tc = (t - fin) / 1000f
            val couleurs = listOf(GS.Jaune, GS.Rose, GS.Cyan, Color(0xFF3DDC6B), Color(0xFFA46BFF), Color.White)
            val xg = xDe(r.ecarts.getValue(r.winners.first()))
            val yg = yLigne(r.winners.first())
            for (j in 0 until 140) {
                val ang = hasard(j) * 2f * Math.PI.toFloat()
                val v = 500f + hasard(j + 7) * 900f
                val x0 = if (j % 2 == 1) xg else 960f
                val y0 = if (j % 2 == 1) yg else 105f
                val x = x0 + kotlin.math.cos(ang) * v * tc * 0.6f
                val y = y0 + sin(ang) * v * tc * 0.5f + 380f * tc * tc
                val alpha = (3.5f - tc).coerceIn(0f, 1f)
                if (y > 1100f || alpha <= 0f) continue
                withTransform({ rotate(tc * 400f * (hasard(j + 3) - 0.5f), Offset(x * k, y * k)) }) {
                    drawRect(couleurs[j % 6].copy(alpha = alpha), Offset(x * k, y * k), Size(14f * k, 8f * k))
                }
            }
        }
    }

    // Repères « −1 s / +1 s », « TROP TÔT », « TROP TARD » : petits textes posés sur le décor avec un halo doux.
    if (t >= REV_REGLE_MS + 200) {
        val a = ((t - REV_REGLE_MS - 200) / 330f).coerceIn(0f, 1f)
        val pas = pasGraduation(demi)
        var s = -demi
        while (s <= demi) {
            if (s != 0) TexteDecor("${if (s > 0) "+" else "−"}${abs(s)} s", Color(0xFFFFE9A8), 26f, xDe(s * 1000L), g.yRepere + 42f, Alignment.Center, 120f, a, PoliceGsTexte)
            s += pas
        }
        TexteDecor("TROP TÔT", Color(0xFFDFE6FF), 30f, REGLE_G - 60f, g.yRepere, Alignment.CenterEnd, 300f, a)
        TexteDecor("TROP TARD", Color(0xFFDFE6FF), 30f, REGLE_D + 60f, g.yRepere, Alignment.CenterStart, 300f, a)
    }
    // « 30 SECONDES » : les secondes du tour, en grand à gauche du drapeau.
    if (t >= REV_DRAPEAU_MS + 400) {
        val p = rebond((t - REV_DRAPEAU_MS - 400) / 400f)
        Box(
            Modifier.offset((xc - 28f - 700f).dp, (g.yRepere - 70f - 50f).dp).size(700.dp, 100.dp).graphicsLayer { scaleX = p; scaleY = p; transformOrigin = TransformOrigin(1f, 0.5f) },
            contentAlignment = Alignment.CenterEnd,
        ) { TexteNeon("${c.cible} SECONDES", GS.Jaune, 66f, police = PoliceGsTitre, largeurMax = 680.dp) }
    }
    // Les noms (à gauche de leur ligne), puis le temps de chaque équipe et ses points (à droite).
    ordre.forEachIndexed { i, uid ->
        val a = arriveeLigne(i, n)
        if (t < a) return@forEachIndexed
        val sl = sortie((t - a) / 350f)
        val y = yLigne(uid)
        val gagnante = t >= fin && uid in r.winners
        TexteDecor(nom(uid).uppercase(), couleur(uid), g.police, REGLE_G - 30f - (1f - sl) * 300f, y, Alignment.CenterEnd, 620f, sl, lueur = gagnante)
        val derniere = i == n - 1
        val tt = if (derniere) fin else a + 450
        if (t >= tt) {
            val p = rebond((t - tt) / 350f)
            val e = r.ecarts.getValue(uid)
            val cs = centiemes((c.cible * 1000L + e).coerceAtLeast(0))
            val temps = "%d,%02d s".format(cs / 100, cs % 100)
            Row(
                Modifier.offset((REGLE_D + 40f).dp, (y - g.h / 2).dp).size(440.dp, g.h.dp).graphicsLayer { scaleX = p; scaleY = p; transformOrigin = TransformOrigin(0f, 0.5f) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(temps, maxLines = 1, style = styleDecor(g.police, Color.White, PoliceGsChiffres))
                r.gains[uid]?.takeIf { it > 0 }?.let { Text("   +$it", maxLines = 1, style = styleDecor(g.police, GS.Jaune, PoliceGsChiffres)) }
            }
        }
    }
    // Le bandeau de la gagnante, à la place du titre.
    if (t >= fin) {
        val p = rebond((t - fin) / 450f)
        val texte = when {
            r.winners.isEmpty() -> "PERSONNE N'A BUZZÉ !"
            r.winners.size == 1 -> phraseGagnant(nom(r.winners[0]))
            else -> "ÉGALITÉ ! ${r.winners.joinToString(" ET ") { nom(it).uppercase() }}"
        }
        Row(
            Modifier.align(Alignment.TopCenter).padding(top = 48.dp).graphicsLayer { scaleX = p; scaleY = p },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TexteNeon(texte, r.winners.firstOrNull()?.let(couleur) ?: GS.Cyan, 64f, police = PoliceGsTitre, largeurMax = if (r.points > 0) 1350.dp else 1750.dp)
            if (r.points > 0) TexteNeon("  +${r.points}", GS.Jaune, 60f, police = PoliceGsChiffres, largeurMax = 300.dp, force = 0.8f)
        }
    }
}

/** Style d'un petit texte posé sur le décor : gras, halo noir doux autour des lettres (jamais de cadre). */
private fun styleDecor(taille: Float, couleur: Color, police: androidx.compose.ui.text.font.FontFamily = PoliceGsTitre, lueur: Boolean = false) = TextStyle(
    fontFamily = police, fontWeight = FontWeight.Bold, fontSize = taille.sp, color = couleur,
    shadow = if (lueur) Shadow(couleur, Offset.Zero, 28f) else Shadow(Color.Black, Offset.Zero, 22f),
)

/** Un petit texte du décor, calé sur ([x], [y]) selon [ancre] dans une boîte de [largeur] ; réduit s'il est trop long. */
@Composable
private fun TexteDecor(
    texte: String, couleur: Color, taille: Float, x: Float, y: Float, ancre: Alignment, largeur: Float, alpha: Float,
    police: androidx.compose.ui.text.font.FontFamily = PoliceGsTitre, lueur: Boolean = false,
) {
    val gauche = when (ancre) { Alignment.CenterEnd -> x - largeur; Alignment.CenterStart -> x; else -> x - largeur / 2 }
    // Trop long : la taille baisse jusqu'à tenir dans la boîte (jamais sous 55 %), le texte n'est jamais coupé.
    val mesure = rememberTextMeasurer()
    val densite = LocalDensity.current
    val ajustee = remember(texte, taille, largeur, police, densite) {
        val dispo = with(densite) { largeur.dp.toPx() }
        val l = mesure.measure(texte, styleDecor(taille, couleur, police), maxLines = 1, softWrap = false, constraints = Constraints()).size.width
        if (l <= dispo || l == 0) taille else maxOf(taille * 0.55f, taille * dispo / l * 0.97f)
    }
    Box(Modifier.offset(gauche.dp, (y - taille).dp).size(largeur.dp, (taille * 2).dp).alpha(alpha), contentAlignment = ancre) {
        Text(texte, maxLines = 1, softWrap = false, style = styleDecor(ajustee, couleur, police, lueur))
    }
}

/** « LES PANDAS GAGNENT LE TOUR ! » : le verbe s'accorde quand le nom de l'équipe est au pluriel (« Les … »). */
internal fun phraseGagnant(nom: String): String {
    val pluriel = nom.trim().let { it.startsWith("les ", ignoreCase = true) || it.startsWith("des ", ignoreCase = true) }
    return "${nom.uppercase()} ${if (pluriel) "GAGNENT" else "GAGNE"} LE TOUR !"
}
