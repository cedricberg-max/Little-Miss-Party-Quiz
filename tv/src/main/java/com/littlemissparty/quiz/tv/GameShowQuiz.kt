package com.littlemissparty.quiz.tv

import com.littlemissparty.quiz.tv.habillage.CONTOUR_MIN
import com.littlemissparty.quiz.tv.habillage.TexteJauge
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import com.littlemissparty.quiz.tv.habillage.HALO_DECOR
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.habillage.CarteQuiz3d
import com.littlemissparty.quiz.tv.habillage.ChronoAnneau3d
import com.littlemissparty.quiz.tv.habillage.Couronne
import com.littlemissparty.quiz.tv.habillage.GS
import com.littlemissparty.quiz.tv.habillage.LogoQuiz
import com.littlemissparty.quiz.tv.habillage.OngletQuiz3d
import com.littlemissparty.quiz.tv.habillage.PoliceGsChiffres
import com.littlemissparty.quiz.tv.habillage.PoliceGsTexte
import com.littlemissparty.quiz.tv.habillage.Tempo
import com.littlemissparty.quiz.tv.habillage.apparition
import com.littlemissparty.quiz.tv.habillage.planchesQuiz3d
import com.littlemissparty.quiz.tv.habillage.apres
import com.littlemissparty.quiz.tv.habillage.OmbreDeJauge
import com.littlemissparty.quiz.tv.habillage.contourJauge
import com.littlemissparty.quiz.tv.habillage.dessineJauge
import com.littlemissparty.quiz.tv.habillage.ombreJauge
import com.littlemissparty.quiz.tv.habillage.dessineJaugeSimple
import com.littlemissparty.quiz.tv.habillage.planchesJauge
import com.littlemissparty.quiz.tv.habillage.rebond
import com.littlemissparty.quiz.tv.habillage.reflet
import com.littlemissparty.quiz.tv.habillage.styleCentre
import com.littlemissparty.quiz.tv.habillage.styleEtiquetteGs
import com.littlemissparty.quiz.tv.habillage.styleTitreNeon
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

/*
 * Écrans du Quiz en design « The Game Show » (kit du 22 octobre) : mêmes données, mêmes moments, mêmes tempos que
 * les écrans classiques de GameScreens.kt ; seule l'apparence change (verre sombre, bords néon, lueurs, chiffres
 * Orbitron). Les lueurs sont des traits arrondis de plus en plus larges et transparents, dessinés une fois.
 */

/**
 * Lueur néon autour d'un cadre arrondi : quatre contours de plus en plus larges et transparents, dessinés derrière le
 * contenu et mis en cache (rien n'est recalculé à chaque image, pas de flou, compatible Mi Box).
 */
fun Modifier.lueurNeon(couleur: Color, rayon: Dp, intensite: Float = 1f): Modifier = composed {
    val r = with(LocalDensity.current) { rayon.toPx() }
    drawWithCache {
        val pas = 3.dp.toPx()
        onDrawBehind {
            for (k in 4 downTo 1) {
                val e = pas * k * 2
                drawRoundRect(
                    couleur.copy(alpha = (0.09f * intensite * (5 - k) / 2f).coerceAtMost(1f)),
                    topLeft = Offset(-e / 2, -e / 2), size = Size(size.width + e, size.height + e),
                    cornerRadius = CornerRadius(r + e / 2), style = Stroke(pas * 2),
                )
            }
        }
    }
}

/** Une proposition A, B, C, D en texte : carte de verre sombre au bord néon de sa couleur, lettre dans un carré néon. */
@Composable
internal fun ChoiceCardGs(i: Int, text: String, correct: Int?, modifier: Modifier, express: Boolean, compacte: Boolean) {
    // Cartes « tube néon » 3D (maquette C validée le 24/10) quand leurs planches sont là.
    planchesQuiz3d()?.let { return CarteQuiz3d(it, i, text, correct, modifier, express) }
    val isCorrect = correct == i
    val rangMauvaise = if (correct == null) 0 else (0 until i).count { it != correct }
    val eteinte = apres(Tempo.mauvaiseSEteint(rangMauvaise, express), correct, actif = correct != null && !isCorrect)
    val juste = apres(Tempo.revelationOr(express), correct, actif = isCorrect)
    val dim by animateFloatAsState(if (eteinte) 0.3f else 1f, tween(350), label = "dim")
    val color = Palette.Choices[i % Palette.Choices.size]
    val forme = RoundedCornerShape(18.dp)
    val bord = when {
        juste -> GS.Juste
        eteinte -> GS.Faux
        else -> color
    }
    Row(
        modifier
            .rebond(juste)
            .alpha(dim)
            .lueurNeon(bord, 18.dp, if (juste) 1.8f else 0.9f)
            .clip(forme)
            .background(
                if (juste) Brush.verticalGradient(listOf(GS.Juste.copy(alpha = 0.95f), GS.JusteProfond))
                else Brush.horizontalGradient(listOf(color.copy(alpha = 0.2f), GS.Nuit.copy(alpha = 0.9f), GS.Nuit.copy(alpha = 0.9f))),
            )
            .border(if (juste) 4.dp else 2.5.dp, if (juste) Color.White else bord, forme)
            .reflet(juste)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val cote = if (compacte) 40.dp else 50.dp
        Box(
            Modifier.size(cote).clip(RoundedCornerShape(12.dp)).background(if (juste) Color.White else color),
            contentAlignment = Alignment.Center,
        ) {
            Text(Palette.ChoiceLetters[i], style = styleCentre(if (compacte) 20.sp else 25.sp, if (juste) GS.JusteProfond else GS.Noir, FontWeight.Black).copy(fontFamily = PoliceGsChiffres))
        }
        Spacer(Modifier.width(if (compacte) 14.dp else 18.dp))
        Text(
            text, color = if (juste) GS.JusteTexte else GS.Encre, fontSize = if (compacte) 26.sp else 31.sp,
            lineHeight = if (compacte) 28.sp else 33.sp, fontWeight = FontWeight.Bold, fontFamily = PoliceGsTexte,
            maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
        )
        when {
            juste -> Box(
                Modifier.size(if (compacte) 40.dp else 48.dp).apparition(100, Unit).clip(CircleShape).background(Color.White),
                contentAlignment = Alignment.Center,
            ) { Text("✓", style = styleCentre(if (compacte) 27.sp else 32.sp, GS.JusteProfond, FontWeight.Black)) }
            eteinte -> Text("✗", color = GS.Faux, fontSize = 32.sp, fontWeight = FontWeight.Black)
        }
    }
}

/** Pastille d'équipe sous la question (Game Show) : verre sombre bordé de la couleur néon de l'équipe. */
@Composable
internal fun TeamStatusGs(
    team: Team, online: Boolean, answered: Boolean, revealedPoints: Int?, statut: String, compacte: Boolean, modifier: Modifier,
    uneLigne: Boolean = false,
    /** Pastille dessinée sous l'étiquette « hors ligne » (contour gris, sans statut à côté du nom). */
    compacteEtiquette: Boolean = false,
) {
    // Équipe hors ligne (cedric, 1/11 au soir : « Fantôme 7 » plus petit que les autres, puis coupé « Fantô / me 7 ») :
    // « hors ligne » ne prend plus la place du nom, il s'affiche en petite étiquette posée sur le haut de la pastille.
    val horsLigne = !online && revealedPoints == null
    if (horsLigne && !compacteEtiquette) return Box(modifier) {
        TeamStatusGs(team, true, answered, null, if (uneLigne) "" else "…", compacte, Modifier.fillMaxWidth().grisee(), uneLigne, compacteEtiquette = true)
        EtiquetteHorsLigne(Modifier.align(Alignment.TopCenter).offset(y = (-ETIQUETTE_HORS_LIGNE_DEBORD).dp))
    }
    val color = team.color.toColor()
    val forme = RoundedCornerShape(14.dp)
    val allumee = answered || revealedPoints != null
    val cadre = modifier
        .rebond(revealedPoints != null && revealedPoints > 0, 0.25f)
        .then(if (allumee && online) Modifier.lueurNeon(color, 14.dp, 0.7f) else Modifier)
        .clip(forme)
        // Choix B de cedric (planche du 1/11, point 37) : une équipe qui a répondu, sa couleur bien plus forte sur un fond
        // de nuit (avant, la pastille devenait transparente et le nom se fondait dans le plateau), et le halo noir doux
        // sur le nom et le statut.
        .then(if (allumee) Modifier.background(GS.Nuit.copy(alpha = 0.55f)).background(color.copy(alpha = 0.55f)) else Modifier.background(GS.Nuit.copy(alpha = 0.85f)))
        .border(2.dp, if (online && !compacteEtiquette) color else Color.Gray, forme)
    val taille = if (compacte) 15.sp else 17.sp
    val halo = if (allumee) TextStyle(shadow = HALO_DECOR) else TextStyle.Default
    @Composable
    fun Statut(m: Modifier = Modifier) = Text(
        statut,
        color = if (revealedPoints != null && revealedPoints > 0) GS.Jaune else GS.Encre.copy(alpha = 0.75f),
        fontSize = taille, fontWeight = FontWeight.Bold,
        fontFamily = if (revealedPoints != null) PoliceGsChiffres else PoliceGsTexte,
        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = m, style = halo,
    )
    // 5 équipes et plus : pastille basse, nom et statut côte à côte, pour laisser leur hauteur aux cartes (maquette du 24/10).
    if (uneLigne) Row(cadre.padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        // Le nom se réduit un peu (jusqu'à 13 sp), puis passe sur deux lignes entre deux mots, plutôt que d'être coupé
        // quand les points s'affichent à côté (« Les Ninjas Masqu… » à 8 équipes, test du 30/10 au soir).
        var t by remember(team.name, statut) { mutableFloatStateOf(taille.value) }
        var deuxLignes by remember(team.name, statut) { mutableStateOf(false) }
        Text(
            team.name, color = GS.Encre, fontSize = t.sp, lineHeight = (t * 1.05f).sp, fontWeight = FontWeight.Bold, fontFamily = PoliceGsTexte,
            maxLines = if (deuxLignes) 2 else 1, softWrap = deuxLignes,
            overflow = if (deuxLignes && t <= 11f) TextOverflow.Ellipsis else TextOverflow.Clip,
            onTextLayout = {
                if (!it.hasVisualOverflow) return@Text
                when {
                    !deuxLignes && t > 13f -> t -= 1f
                    !deuxLignes -> deuxLignes = true
                    t > 11f -> t -= 1f
                }
            },
            modifier = Modifier.weight(1f), style = halo,
        )
        if (statut.isNotEmpty()) {
            Spacer(Modifier.width(6.dp))
            Statut()
        }
    } else Column(
        cadre.padding(horizontal = if (compacte) 8.dp else 12.dp, vertical = 5.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Jamais « … » (tour des écrans à 4 équipes, 31/10 : « Les Comètes Fila… ») : le nom rapetisse un peu s'il ne tient pas.
        UneLigneQuiTient(echelleMin = 0.6f) {
            Text(team.name, color = GS.Encre, fontSize = taille, fontWeight = FontWeight.Bold, fontFamily = PoliceGsTexte, maxLines = 1, softWrap = false, style = halo)
        }
        Statut()
    }
}

/** Une équipe hors ligne : pastille un peu éteinte, le nom garde sa taille. */
private fun Modifier.grisee() = graphicsLayer { alpha = 0.8f }

/** Petite étiquette grise « hors ligne », posée à cheval sur le haut de la pastille. */
@Composable
private fun EtiquetteHorsLigne(modifier: Modifier) = Text(
    "hors ligne", color = GS.Encre, fontSize = 11.sp, fontWeight = FontWeight.Bold, fontFamily = PoliceGsTexte, maxLines = 1, softWrap = false,
    modifier = modifier.background(Color(0xFF4A4F63), RoundedCornerShape(50)).padding(horizontal = 7.dp, vertical = 1.dp),
)

/** De combien (dp) l'étiquette « hors ligne » dépasse au-dessus de la pastille. */
internal const val ETIQUETTE_HORS_LIGNE_DEBORD = 9f

/** Chrono (Game Show) : anneau cyan qui se vide, avec sa lueur ; rose dans les 5 dernières secondes. */
@Composable
internal fun CountdownGs(seconds: Int, fraction: Float) {
    planchesQuiz3d()?.let { return ChronoAnneau3d(it, seconds, fraction) }
    val urgent = seconds <= 5
    val couleur = if (urgent) GS.Rose else GS.Cyan
    Box(
        Modifier.size(86.dp).drawBehind {
            val trait = 7.dp.toPx()
            val coin = Offset(trait * 1.5f, trait * 1.5f)
            val taille = Size(size.width - trait * 3, size.height - trait * 3)
            drawCircle(GS.Nuit.copy(alpha = 0.85f), size.minDimension / 2 - trait)
            drawArc(GS.Violet.copy(alpha = 0.3f), 0f, 360f, false, coin, taille, style = Stroke(trait))
            drawArc(couleur.copy(alpha = 0.22f), -90f, 360f * fraction, false, coin, taille, style = Stroke(trait * 2.6f, cap = StrokeCap.Round))
            drawArc(couleur, -90f, 360f * fraction, false, coin, taille, style = Stroke(trait, cap = StrokeCap.Round))
        },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "$seconds",
            style = styleCentre(30.sp, if (urgent) GS.Rose else GS.Encre, FontWeight.Black).copy(
                fontFamily = PoliceGsChiffres, shadow = Shadow(couleur.copy(alpha = 0.8f), Offset.Zero, 18f),
            ),
        )
    }
}

/**
 * Tableau des scores (Game Show) : une jauge verticale néon par équipe, du premier au dernier, qui monte depuis le
 * score d'avant la question sur le compteur sonore ; score en chiffres au-dessus, nom dessous (réduit pour tenir en
 * entier), couronne au premier. De 1 à 8 équipes.
 */
@Composable
internal fun ClassementGameShow(
    state: UiState.Playing,
    actions: TvActions,
    titre: String = "TABLEAU DES SCORES",
    sousTitre: String? = null,
    lignes: List<Pair<Team, Int>> = state.ranking,
    gains: Map<String, Int> = state.lastGain,
) {
    Column(Modifier.fillMaxSize().padding(horizontal = 48.dp, vertical = 22.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(titre, style = styleTitreNeon(38.sp, GS.Cyan, TextAlign.Start), maxLines = 1, softWrap = false)
            Spacer(Modifier.width(20.dp))
            Text(
                when {
                    sousTitre != null -> sousTitre
                    state.mime?.picto == true -> "Après le Pictionary"
                    state.mime != null -> "Après les mimes"
                    else -> "Après ${state.etape ?: "la question ${state.index + 1}"}"
                },
                color = GS.Encre.copy(alpha = 0.75f), fontSize = 20.sp, fontFamily = PoliceGsTexte, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(bottom = 6.dp),
            )
        }
        Spacer(Modifier.height(10.dp))
        Jauges(lignes, gains, Modifier.weight(1f).fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            LogoQuiz(46.dp)
            Spacer(Modifier.weight(1f))
            if (!state.paused && Pilotage.telecommande) NextButton(suiteLabel(state), actions.next, key = state.index)
        }
    }
}

@Composable
private fun Jauges(ranking: List<Pair<Team, Int>>, gains: Map<String, Int>, modifier: Modifier) {
    val planches = planchesJauge()
    val best = (ranking.firstOrNull()?.second ?: 0).coerceAtLeast(1)
    val couronne = apres(Tempo.CLASSEMENT_COURONNE, Unit)
    val serre = ranking.size > 5
    BoxWithConstraints(modifier) {
        val colonne = (maxWidth / ranking.size.coerceAtLeast(1)).coerceAtMost(200.dp)
        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.Center) {
            ranking.forEachIndexed { i, (team, score) ->
                val compteur = remember(team.uid) { Animatable((score - (gains[team.uid] ?: 0)).coerceAtLeast(0).toFloat()) }
                LaunchedEffect(score) {
                    delay(Tempo.CLASSEMENT_COMPTEUR)
                    compteur.animateTo(score.toFloat(), tween(1_500, easing = FastOutSlowInEasing))
                }
                val color = team.color.toColor()
                val gain = gains[team.uid] ?: 0
                Column(
                    Modifier.width(colonne).fillMaxHeight().padding(horizontal = if (serre) 6.dp else 12.dp).apparition(90L * i, Unit),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    // La couronne du premier tient dans sa propre ligne : rien ne dépasse au-dessus de l'écran.
                    Box(Modifier.height(22.dp), contentAlignment = Alignment.Center) {
                        if (i == 0) Couronne(couronne && score > 0, Modifier.size(30.dp, 20.dp))
                    }
                    // Chiffres un peu espacés : en Black, « 117 » se touchait presque sur la Mi Box (cedric, 26/10).
                    Text(
                        "${compteur.value.roundToInt()}", maxLines = 1, softWrap = false,
                        style = TextStyle(
                            fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Black, fontSize = if (serre) 22.sp else 30.sp,
                            letterSpacing = if (serre) 1.5.sp else 2.5.sp, color = color, shadow = Shadow(color.copy(alpha = 0.8f), Offset.Zero, 20f), textAlign = TextAlign.Center,
                        ),
                    )
                    Text(
                        if (gain > 0) "+$gain" else " ", maxLines = 1, softWrap = false,
                        style = TextStyle(fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Bold, fontSize = if (serre) 13.sp else 15.sp, color = GS.Jaune),
                    )
                    Spacer(Modifier.height(4.dp))
                    // La jauge : le tube de verre du podium (cedric, 24/10), liquide néon à la couleur de l'équipe qui monte
                    // avec le compteur. Sans ses planches, le même tube en dessin simple.
                    // Le contour néon autour du verre et une ombre bien présente (cedric, 29/10) : le tube un peu plus court pour que rien ne touche les
                    // chiffres ni le nom.
                    Canvas(Modifier.weight(1f).padding(vertical = 7.dp).widthIn(max = 86.dp).fillMaxWidth(if (serre) 0.8f else 0.62f)) {
                        val part = (compteur.value / best).coerceIn(0.03f, 1f)
                        ombreJauge(OmbreDeJauge.PRESENTE)
                        if (planches != null) dessineJauge(planches, part, color) else dessineJaugeSimple(part, color)
                        contourJauge(color)
                    }
                    Spacer(Modifier.height(6.dp))
                    NomQuiTient(team.name, if (serre) 17.sp else 22.sp, Modifier.fillMaxWidth())
                    Text(
                        if (i == 0) "1er" else "${i + 1}e", maxLines = 1,
                        style = TextStyle(fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Bold, fontSize = if (serre) 12.sp else 14.sp, color = if (i == 0) GS.Jaune else GS.Encre.copy(alpha = 0.6f)),
                    )
                }
            }
        }
    }
}

/** Nom d'équipe sur une ligne, réduit jusqu'à tenir en entier dans la colonne (jamais coupé). */
@Composable
private fun NomQuiTient(nom: String, max: TextUnit, modifier: Modifier) {
    val mesure = rememberTextMeasurer()
    val densite = LocalDensity.current
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val dispo = constraints.maxWidth
        val taille = remember(nom, dispo, max) {
            var t = max.value
            // Le contour déborde un peu de chaque côté des lettres : on garde sa place.
            val place = dispo - with(densite) { (CONTOUR_MIN * 2).roundToPx() }
            while (t > 10f && mesure.measure(nom, TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = t.sp), maxLines = 1, softWrap = false).size.width > place) t -= 0.5f
            t.sp
        }
        // Posé sur le décor « comme les jauges » (n° 36 du 31/10), comme les tubes au-dessus.
        TexteJauge(nom, maxLines = 1, softWrap = false, style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = taille, color = GS.Encre, textAlign = TextAlign.Center))
    }
}

/** Étiquette « Question 4 / 10 » du Game Show, en Orbitron cyan. */
@Composable
internal fun EtapeGs(texte: String, modifier: Modifier = Modifier) {
    planchesQuiz3d()?.let { return OngletQuiz3d(it, texte, modifier) }
    // Trop long pour une ligne : deux lignes plutôt qu'un « … » (le texte n'est jamais coupé).
    Text(texte, style = styleEtiquetteGs(17.sp, GS.Cyan, 3.sp), maxLines = 2, modifier = modifier)
}
