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
import androidx.compose.ui.graphics.Path
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
    val depuisResultat by produceState(0L, c?.result?.at, decalage) {
        val at = c?.result?.at ?: return@produceState
        while (true) {
            value = maintenant() - at
            withFrameNanos { }
            if (value > 30_000) break
        }
    }

    EchelleSansCoupe(SCENE_L, SCENE_H, Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxWidth().padding(top = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            TexteNeon("LE CHRONO DE BUZZY", GS.Cyan, 92f, police = PoliceGsTitre, largeurMax = 1500.dp)
            if (c != null) {
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
    }
}

/** Le tour prêt : le chrono à zéro, la consigne. */
@Composable
private fun androidx.compose.foundation.layout.BoxScope.ChronoPret(c: ChronoRound) {
    Cadran("00,00", null, Modifier.align(Alignment.Center))
    Consigne("Comptez dans votre tête et buzzez à ${c.cible} secondes pile !", Modifier.align(Alignment.BottomCenter).padding(bottom = 90.dp))
}

/** Décompte, chrono qui défile, puis le drap de Buzzy ; en bas, les équipes qui ont buzzé. */
@Composable
private fun androidx.compose.foundation.layout.BoxScope.ChronoEnCours(state: UiState.Playing, c: ChronoRound, ecoule: Long) {
    val cache = c.cacheMs ?: Long.MAX_VALUE
    val drap = if (ecoule == Long.MIN_VALUE || ecoule < cache) 0f else ((ecoule - cache).toFloat() / DRAP_CHUTE_MS).coerceIn(0f, 1f)
    val chiffres = when {
        ecoule == Long.MIN_VALUE -> null
        ecoule < 0 -> null
        ecoule < cache + DRAP_COUVRE_MS -> texteChrono(ecoule)
        // Sous le drap : plus aucun chiffre n'est dessiné.
        else -> ""
    }
    val decompte = if (ecoule != Long.MIN_VALUE && ecoule < 0) ((-ecoule + 999) / 1000).toString() else null
    Cadran(chiffres ?: "00,00", decompte, Modifier.align(Alignment.Center), drap = drap, tempsDrap = (ecoule - cache).coerceAtLeast(0))
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
private fun Consigne(texte: String, modifier: Modifier) {
    Text(
        texte,
        modifier.padding(horizontal = 120.dp),
        style = TextStyle(
            fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 50.sp, textAlign = TextAlign.Center, color = Color.White,
            shadow = Shadow(Color.Black, Offset.Zero, 22f),
        ),
        maxLines = 2,
    )
}

/**
 * Le grand chrono néon : un anneau, les chiffres au centième ([texte] : "" = rien dessiné), ou le décompte en grand ;
 * [drap] : avancée de la chute du drap (0 à 1), qui recouvre tout le cadran, Buzzy dessus.
 */
@Composable
private fun Cadran(texte: String, decompte: String?, modifier: Modifier, drap: Float = 0f, tempsDrap: Long = 0) {
    Box(modifier.size(860.dp, 560.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val r = size.minDimension * 0.46f
            val centre = Offset(size.width / 2, size.height / 2)
            drawCircle(GS.Cyan.copy(alpha = 0.18f), r + 26f, centre, style = Stroke(52f))
            drawCircle(GS.Cyan, r, centre, style = Stroke(10f))
            drawCircle(GS.Violet.copy(alpha = 0.5f), r - 22f, centre, style = Stroke(4f))
            // Le bouton du chronomètre, en haut.
            drawRoundRect(GS.Cyan, Offset(centre.x - 34f, centre.y - r - 64f), Size(68f, 40f), CornerRadius(10f))
        }
        when {
            decompte != null -> TexteNeon(decompte, GS.Rose, 300f, police = PoliceGsChiffres, largeurMax = 700.dp)
            texte.isNotEmpty() -> TexteNeon(texte, GS.Cyan, 190f, police = PoliceGsChiffres, largeurMax = 700.dp, graisse = FontWeight.Black)
        }
        if (drap > 0f) Drap(drap, tempsDrap, Modifier.fillMaxSize())
    }
}

/** Le drap de Buzzy (provisoire) : il tombe d'en haut, rebondit un peu et ondule ; la tête de Buzzy dépasse dessus. */
@Composable
private fun Drap(avance: Float, temps: Long, modifier: Modifier) {
    Canvas(modifier) {
        // Chute avec un petit rebond à l'arrivée.
        val e = 1f - (1f - avance) * (1f - avance)
        val rebond = if (avance >= 1f) (sin(minOf(temps - DRAP_CHUTE_MS, 600L) / 600f * Math.PI * 2) * 8f * (1f - minOf(temps - DRAP_CHUTE_MS, 600L) / 600f)).toFloat() else 0f
        val haut = -size.height + e * (size.height + 10f) + rebond
        val bas = haut + size.height + 30f
        val ondule = (temps % 2_400L) / 2_400f * 2f * Math.PI.toFloat()
        val p = Path().apply {
            moveTo(-20f, haut)
            lineTo(size.width + 20f, haut)
            lineTo(size.width + 30f, bas)
            val n = 6
            for (i in n downTo 1) {
                val x0 = size.width * i / n
                val x1 = size.width * (i - 1) / n
                quadraticBezierTo((x0 + x1) / 2, bas + 34f * sin(ondule + i).toFloat() + 18f, x1, bas)
            }
            lineTo(-30f, bas)
            close()
        }
        drawPath(p, Brush.verticalGradient(listOf(Color(0xFFB0102E), Color(0xFFE8173F), Color(0xFF8A0A22)), haut, bas))
        // Plis du drap.
        for (i in 1..4) {
            val x = size.width * i / 5
            drawLine(Color.Black.copy(alpha = 0.18f), Offset(x, haut + 30f), Offset(x + 14f * sin(ondule + i).toFloat(), bas - 10f), strokeWidth = 14f)
        }
        teteBuzzy(Offset(size.width / 2, haut - 6f), 92f)
    }
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
        teteBuzzy(Offset(xc, pied - mat + dy), 70f * k)
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
            TexteNeon(texteEcart(r.ecarts.getValue(uid)), Color.White, 30f, police = PoliceGsChiffres, largeurMax = 320.dp, force = 0.4f, tailleMin = 16f)
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
