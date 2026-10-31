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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.ChronoRound
import com.littlemissparty.quiz.engine.centiemes
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
import kotlin.math.floor
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
internal const val DRAP_COUVRE_MS = 380L

/** Révélation : la règle se dessine, puis une pastille toutes les [PASTILLE_PAS_MS], la plus proche au ralenti. */
internal const val REGLE_MS = 900L
internal const val PASTILLE_PAS_MS = 900L
internal const val PASTILLE_RALENTI_MS = 2_200L

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

/**
 * Bornes de la règle du temps (secondes) : la cible et toutes les équipes, une seconde de marge, au moins 6 s de part
 * et d'autre de la cible, jamais avant 0.
 */
internal fun bornesRegle(cible: Int, ecarts: Collection<Long>): Pair<Int, Int> {
    val temps = ecarts.map { cible + it / 1000.0 }
    val bas = floor(minOf(cible - 6.0, (temps.minOrNull() ?: cible.toDouble()) - 1.0)).toInt().coerceAtLeast(0)
    val haut = ceil(maxOf(cible + 6.0, (temps.maxOrNull() ?: cible.toDouble()) + 1.0)).toInt()
    return bas to maxOf(haut, bas + 1)
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
    ChronoSons(c, ecoule, maintenant)
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
                TexteNeon("LE CHRONO DE BUZZY", GS.Cyan, 92f, police = PoliceGsTitre, largeurMax = 1500.dp)
                val tours = if (state.chronoTours > 1) "TOUR ${c.tour} / ${state.chronoTours} · " else ""
                TexteNeon("${tours}CIBLE : ${c.cible} SECONDES", GS.Jaune, 54f, police = PoliceGsTitre, largeurMax = 1500.dp, force = 0.7f)
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
        if (tours > 1) TexteNeon("TOUR ${c.tour} / $tours", GS.CyanClair, 40f, police = PoliceGsTitre, largeurMax = 640.dp, force = 0.5f)
        TexteNeon("OBJECTIF", Color.White, 52f, police = PoliceGsTitre, largeurMax = 640.dp, force = 0.6f)
        Row(verticalAlignment = Alignment.Bottom) {
            Text("${c.cible}", style = chiffreStyle(150f, GS.Jaune, Color(0xFFFF9F1C)), maxLines = 1)
            Text(" SECONDES", style = chiffreStyle(56f, GS.Jaune, Color(0xFFFF9F1C)), maxLines = 1, modifier = Modifier.padding(bottom = 24.dp))
        }
    }
}

/** Un son du Chrono de Buzzy à l'instant [instant] (ms) de la révélation, à la [vitesse] donnée (hauteur). */
internal data class SonChrono(val instant: Long, val son: Son, val vitesse: Float = 1f)

/**
 * Les sons de la révélation, calés sur ses images : la règle se dessine, le drapeau tombe et se plante (à 0,7 s), chaque
 * pastille fait « fiou-plop » en se posant, un peu plus aigu à chaque fois ; la plus proche a son ralenti (impact à
 * l'arrivée) ; puis gagné, « PILE ! » au centième, ou personne.
 */
internal fun sonsRevelation(ecarts: Map<String, Long>, winners: List<String>): List<SonChrono> {
    val ordre = ordreRevelation(ecarts)
    val sons = mutableListOf(SonChrono(0, Son.CHRONO_REGLE), SonChrono(200, Son.CHRONO_DRAPEAU))
    ordre.forEachIndexed { i, _ ->
        val debut = REGLE_MS + i * PASTILLE_PAS_MS
        // « fiou-plop » : le plop tombe 0,42 s après son début, la pastille se pose 0,5 s après le sien.
        sons += if (i == ordre.lastIndex) SonChrono(debut, Son.CHRONO_RALENTI) else SonChrono(debut + 80, Son.CHRONO_PASTILLE, 1f + 0.06f * i)
    }
    val fin = REGLE_MS + (ordre.size - 1).coerceAtLeast(0) * PASTILLE_PAS_MS + PASTILLE_RALENTI_MS
    sons += SonChrono(
        fin,
        when {
            winners.isEmpty() -> Son.CHRONO_PERSONNE
            winners.any { centiemes(ecarts[it] ?: Long.MAX_VALUE) == 0L } -> Son.CHRONO_PILE
            else -> Son.CHRONO_GAGNE
        },
    )
    return sons
}

/**
 * Le son du chrono, image par image : 3, 2, 1 (bips), le départ, puis le tic-tac une fois par seconde tant qu'on voit
 * le chrono (le tempo à garder en tête), plus rien quand le drap tombe (son lancer, le fantôme) ; un petit « tok »
 * à chaque buzz ; à la révélation, [sonsRevelation]. Un son déjà passé de plus de 300 ms n'est jamais joué en retard.
 */
@Composable
private fun ChronoSons(c: ChronoRound?, ecoule: Long, maintenant: () -> Long) {
    val cache = c?.cacheMs
    val seconde = if (ecoule == Long.MIN_VALUE || c?.enCours != true) null else Math.floorDiv(ecoule, 1_000L)
    LaunchedEffect(seconde) {
        val s = seconde ?: return@LaunchedEffect
        if (ecoule - s * 1_000L > 300 || cache == null) return@LaunchedEffect
        when {
            s in -3L..-1L -> jouerChrono(Son.CHRONO_BIP)
            s == 0L -> jouerChrono(Son.CHRONO_GO)
            s >= 1 && s * 1_000L < cache -> jouerChrono(if (s % 2 == 1L) Son.CHRONO_TIC else Son.CHRONO_TAC)
        }
    }
    val drapTombe = seconde != null && cache != null && ecoule >= cache
    LaunchedEffect(drapTombe) { if (drapTombe && ecoule - cache!! < 400) jouerChrono(Son.CHRONO_DRAP) }
    val buzz = c?.buzzes?.size ?: 0
    val vus = remember(c?.goAt) { mutableIntStateOf(buzz) }
    LaunchedEffect(buzz) {
        if (buzz > vus.intValue && c?.enCours == true) jouerChrono(Son.CHRONO_BUZZ)
        vus.intValue = buzz
    }
    val r = c?.result
    LaunchedEffect(r?.at) {
        r ?: return@LaunchedEffect
        for (son in sonsRevelation(r.ecarts, r.winners)) {
            val attente = r.at + son.instant - maintenant()
            if (attente < -300) continue
            if (attente > 0) delay(attente)
            jouerChrono(son.son, son.vitesse)
        }
    }
}

private fun jouerChrono(son: Son, vitesse: Float = 1f) = Sons.executer(listOf(Ordre.Jouer(son, vitesse = vitesse)))

/** Le tour prêt : le chrono à zéro, la consigne. */
@Composable
private fun androidx.compose.foundation.layout.BoxScope.ChronoPret(c: ChronoRound) {
    Cadran(0L, c.cible, null, Modifier.fillMaxSize())
    Consigne("Prêts ? Comptez dans votre tête et buzzez à ${c.cible} secondes pile !", Modifier.align(Alignment.BottomCenter).padding(bottom = 60.dp), GS.Rose)
}

/** Décompte, chrono qui défile, puis le drap de Buzzy ; en bas, les équipes qui ont buzzé. */
@Composable
private fun androidx.compose.foundation.layout.BoxScope.ChronoEnCours(state: UiState.Playing, c: ChronoRound, ecoule: Long) {
    val cache = c.cacheMs ?: Long.MAX_VALUE
    val drap = if (ecoule == Long.MIN_VALUE || ecoule < cache) 0f else ((ecoule - cache).toFloat() / DRAP_CHUTE_MS).coerceIn(0f, 1f)
    // Sous le drap : plus aucun chiffre ni aucune graduation n'est dessiné (null).
    val temps = when {
        ecoule == Long.MIN_VALUE || ecoule < 0 -> 0L
        ecoule < cache + DRAP_COUVRE_MS -> ecoule
        else -> null
    }
    val decompte = if (ecoule != Long.MIN_VALUE && ecoule < 0) ((-ecoule + 999) / 1000).toString() else null
    Cadran(temps, c.cible, decompte, Modifier.fillMaxSize(), drap = drap, tempsDrap = if (drap > 0f) ecoule - cache else 0L)
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
private fun Cadran(temps: Long?, cible: Int, decompte: String?, modifier: Modifier, drap: Float = 0f, tempsDrap: Long = 0) {
    val plateau = com.littlemissparty.quiz.tv.habillage.imageAppli(PLATEAU_CHRONO)
    val tete = com.littlemissparty.quiz.tv.habillage.imageAppli("gs_chrono_tete_clin")
    Box(modifier) {
        Canvas(Modifier.fillMaxSize()) {
            val k = size.width / 1920f
            plateau?.let { drawImage(it, dstOffset = IntOffset.Zero, dstSize = IntSize(size.width.toInt(), size.height.toInt())) }
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
        if (drap > 0f) Drap(drap, tempsDrap, tete, Modifier.offset(380.dp, 70.dp).size(660.dp, 740.dp))
    }
}

/** Chiffres en Bungee (le zéro d'Orbitron se lit « Ø ») : couleur et lueur néon, sans cadre. */
private fun chiffreStyle(taille: Float, couleur: Color, lueur: Color = couleur) = TextStyle(
    fontFamily = PoliceGsTitre, fontSize = taille.sp, lineHeight = taille.sp, color = couleur, textAlign = TextAlign.Center,
    shadow = Shadow(lueur.copy(alpha = 0.85f), Offset.Zero, taille * 0.35f),
)

/** Le drap de Buzzy (provisoire, en attendant le clip du lancer) : il tombe, rebondit un peu et ondule ; Buzzy dessus. */
@Composable
private fun Drap(avance: Float, temps: Long, tete: ImageBitmap?, modifier: Modifier) {
    Canvas(modifier) {
        // Chute avec un petit rebond à l'arrivée.
        val e = 1f - (1f - avance) * (1f - avance)
        val apres = (temps - DRAP_CHUTE_MS).coerceIn(0L, 600L) / 600f
        val rebond = if (avance >= 1f) (sin(apres * Math.PI * 2) * 8.0 * (1f - apres)).toFloat() else 0f
        val haut = -size.height + e * (size.height + 10f) + rebond
        val bas = haut + size.height - 40f
        val ondule = (temps % 2_400L) / 2_400f * 2f * Math.PI.toFloat()
        val p = Path().apply {
            moveTo(size.width * 0.12f, haut)
            lineTo(size.width * 0.88f, haut)
            lineTo(size.width, bas)
            val n = 6
            for (i in n downTo 1) {
                val x0 = size.width * i / n
                val x1 = size.width * (i - 1) / n
                quadraticBezierTo((x0 + x1) / 2, bas + 34f * sin(ondule + i).toFloat() + 18f, x1, bas)
            }
            close()
        }
        drawPath(p, Brush.verticalGradient(listOf(Color(0xFFB0102E), Color(0xFFE8173F), Color(0xFF8A0A22)), haut, bas))
        // Plis du drap.
        for (i in 1..4) {
            val x = size.width * i / 5
            drawLine(Color.Black.copy(alpha = 0.18f), Offset(x, haut + 60f), Offset(x + 14f * sin(ondule + i).toFloat(), bas - 10f), strokeWidth = 14f)
        }
        val l = size.width * 0.36f
        val h = l * 423f / 484f
        if (tete != null) drawImage(tete, dstOffset = IntOffset((size.width / 2 - l / 2).toInt(), (haut - h * 0.75f).toInt()), dstSize = IntSize(l.toInt(), h.toInt()))
        else teteBuzzy(Offset(size.width / 2, haut - 6f), 92f)
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

/** La tête de Buzzy (provisoire) : l'écran-visage cyan, deux yeux, l'antenne. */
private fun DrawScope.teteBuzzy(bas: Offset, taille: Float) {
    val l = taille * 1.3f
    val h = taille
    val coin = Offset(bas.x - l / 2, bas.y - h)
    drawLine(GS.Cyan, Offset(bas.x, coin.y), Offset(bas.x, coin.y - h * 0.35f), strokeWidth = 6f)
    drawCircle(GS.Rose, h * 0.1f, Offset(bas.x, coin.y - h * 0.38f))
    drawRoundRect(Color(0xFF14102A), coin, Size(l, h), CornerRadius(h * 0.28f))
    drawRoundRect(GS.Cyan, coin, Size(l, h), CornerRadius(h * 0.28f), style = Stroke(6f))
    drawCircle(GS.Cyan, h * 0.12f, Offset(bas.x - l * 0.2f, coin.y + h * 0.45f))
    drawCircle(GS.Cyan, h * 0.12f, Offset(bas.x + l * 0.2f, coin.y + h * 0.45f))
}

/**
 * La révélation sur la règle du temps : la règle se dessine, le drapeau à tête de Buzzy se plante sur la cible, puis
 * les pastilles des équipes tombent une à une (la plus loin d'abord) ; la plus proche au ralenti, puis la gagnante.
 */
@Composable
private fun androidx.compose.foundation.layout.BoxScope.Revelation(state: UiState.Playing, c: ChronoRound, t: Long) {
    val r = c.result ?: return
    val ordre = ordreRevelation(r.ecarts)
    val (bas, haut) = bornesRegle(c.cible, r.ecarts.values)
    val couleur = { uid: String -> state.teams.find { it.uid == uid }?.color?.toColor() ?: Color.White }
    val nom = { uid: String -> state.teams.find { it.uid == uid }?.name ?: "Une équipe" }
    // Heure d'arrivée de chaque pastille (la dernière, la plus proche, au ralenti).
    val arrivee = ordre.indices.map { i -> REGLE_MS + i * PASTILLE_PAS_MS }
    val fin = (arrivee.lastOrNull() ?: REGLE_MS) + PASTILLE_RALENTI_MS
    val largeur = 1640f
    val gauche = (1920f - largeur) / 2
    val yRegle = 600f
    val xDe = { s: Double -> gauche + ((s - bas) / (haut - bas)).toFloat() * largeur }
    val teteDrapeau = com.littlemissparty.quiz.tv.habillage.imageAppli(if (r.winners.isEmpty()) "gs_chrono_tete_surprise" else "gs_chrono_tete_rire")
    Canvas(Modifier.fillMaxSize()) {
        val k = size.width / 1920f
        val dessin = (t.toFloat() / REGLE_MS).coerceIn(0f, 1f)
        // La règle : un tube néon, un trait par seconde, plus grand toutes les 5 s.
        drawLine(GS.Cyan.copy(alpha = 0.25f), Offset(gauche * k, yRegle * k), Offset((gauche + largeur * dessin) * k, yRegle * k), strokeWidth = 26f * k)
        drawLine(GS.Cyan, Offset(gauche * k, yRegle * k), Offset((gauche + largeur * dessin) * k, yRegle * k), strokeWidth = 6f * k)
        for (s in bas..haut) {
            val x = xDe(s.toDouble())
            if (x > gauche + largeur * dessin) break
            val grand = s % 5 == 0
            drawLine(GS.Cyan.copy(alpha = if (grand) 1f else 0.6f), Offset(x * k, (yRegle - if (grand) 26f else 14f) * k), Offset(x * k, (yRegle + if (grand) 26f else 14f) * k), strokeWidth = (if (grand) 4f else 2f) * k)
        }
        // Le drapeau à tête de Buzzy : il tombe d'en haut et se plante sur la cible.
        val tombe = ((t - 200).toFloat() / 500f).coerceIn(0f, 1f)
        val xc = xDe(c.cible.toDouble()) * k
        val pied = yRegle * k
        val mat = 250f * k
        val dy = (1f - tombe * tombe) * -700f * k
        drawLine(GS.Jaune, Offset(xc, pied + dy), Offset(xc, pied - mat + dy), strokeWidth = 8f * k)
        val lt = 170f * k
        val ht = lt * 423f / 484f
        if (teteDrapeau != null) drawImage(teteDrapeau, dstOffset = IntOffset((xc - lt / 2).toInt(), (pied - mat + dy - ht * 0.9f).toInt()), dstSize = IntSize(lt.toInt(), ht.toInt()))
        else teteBuzzy(Offset(xc, pied - mat + dy), 70f * k)
        // Le fanion doré à étoile blanche (choix B de cedric, 30/10), qui flotte au vent sous la tête de Buzzy.
        fanion(Offset(xc + 4f * k, pied - mat + dy + 30f * k), 120f * k, 78f * k, t)
        // Les pastilles des équipes, la plus loin d'abord.
        ordre.forEachIndexed { i, uid ->
            val debut = arrivee[i]
            val duree = if (i == ordre.lastIndex) PASTILLE_RALENTI_MS else 500L
            val p = ((t - debut).toFloat() / duree).coerceIn(0f, 1f)
            if (p <= 0f) return@forEachIndexed
            val e = 1f - (1f - p) * (1f - p)
            val x = xDe(c.cible + r.ecarts.getValue(uid) / 1000.0) * k
            val y = (yRegle - 380f + 380f * e) * k
            val coul = couleur(uid)
            drawCircle(coul.copy(alpha = 0.3f), 46f * k, Offset(x, y))
            drawCircle(coul, 30f * k, Offset(x, y))
            drawCircle(Color.White, 30f * k, Offset(x, y), style = Stroke(4f * k))
        }
    }
    // La cible sous le fanion, qui tombe avec lui.
    run {
        val tombe = ((t - 200).toFloat() / 500f).coerceIn(0f, 1f)
        val dy = (1f - tombe * tombe) * -700f
        Text(
            "${c.cible}", style = chiffreStyle(56f, GS.Jaune, Color(0xFFFF9F1C)), maxLines = 1,
            modifier = Modifier.offset((xDe(c.cible.toDouble()) + 6f).dp, (yRegle - 250f + 112f + dy).dp).width(140.dp),
        )
    }
    // Les noms et écarts sous la règle, sur 4 rangées pour ne jamais se chevaucher à 8 équipes.
    val parPosition = ordre.sortedBy { r.ecarts.getValue(it) }
    parPosition.forEachIndexed { rang, uid ->
        val i = ordre.indexOf(uid)
        if (t < arrivee[i] + (if (i == ordre.lastIndex) PASTILLE_RALENTI_MS else 500L)) return@forEachIndexed
        val x = xDe(c.cible + r.ecarts.getValue(uid) / 1000.0)
        val rangee = rang % 4
        Column(
            Modifier.offset((x - 160f).dp, (yRegle + 50f + rangee * 92f).dp).width(320.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            TexteNeon(nom(uid), couleur(uid), 34f, police = PoliceGsTitre, largeurMax = 320.dp, force = 0.6f, tailleMin = 16f)
            val gain = r.gains[uid]?.let { " · +$it" }.orEmpty()
            TexteNeon(texteEcart(r.ecarts.getValue(uid)) + gain, Color.White, 30f, police = PoliceGsChiffres, largeurMax = 320.dp, force = 0.4f, tailleMin = 16f)
        }
    }
    // Les gagnantes, une fois la plus proche posée.
    if (t >= fin) {
        val texte = when {
            r.winners.isEmpty() -> "PERSONNE N'A BUZZÉ !"
            r.winners.size == 1 -> "${nom(r.winners[0]).uppercase()} GAGNE LE TOUR !"
            else -> "ÉGALITÉ ! ${r.winners.joinToString(" ET ") { nom(it).uppercase() }}"
        }
        Column(Modifier.align(Alignment.TopCenter).padding(top = 230.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            TexteNeon(texte, r.winners.firstOrNull()?.let(couleur) ?: GS.Cyan, 84f, police = PoliceGsTitre, largeurMax = 1700.dp)
            if (r.points > 0) TexteNeon("+${r.points} POINTS", GS.Jaune, 60f, police = PoliceGsChiffres, largeurMax = 900.dp, force = 0.8f)
        }
    }
}
