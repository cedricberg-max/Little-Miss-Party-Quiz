package com.littlemissparty.quiz.tv

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.SIMON_CHIFFRES_MS
import com.littlemissparty.quiz.engine.SIMON_AVEC_CHIFFRES
import com.littlemissparty.quiz.engine.SIMON_CHIFFRES_DES
import com.littlemissparty.quiz.engine.SIMON_PAS_MS
import com.littlemissparty.quiz.engine.SIMON_VERIF_FIN_MS
import com.littlemissparty.quiz.engine.SIMON_VERIF_PAS_MS
import com.littlemissparty.quiz.engine.SimonRound
import com.littlemissparty.quiz.engine.justes
import com.littlemissparty.quiz.engine.reponseMs
import com.littlemissparty.quiz.tv.habillage.EchelleSansCoupe
import com.littlemissparty.quiz.tv.habillage.GS
import com.littlemissparty.quiz.tv.habillage.NotesSimon
import com.littlemissparty.quiz.tv.habillage.Ordre
import com.littlemissparty.quiz.tv.habillage.PoliceGsChiffres
import com.littlemissparty.quiz.tv.habillage.PoliceGsTexte
import com.littlemissparty.quiz.tv.habillage.PoliceGsTitre
import com.littlemissparty.quiz.tv.habillage.SCENE_H
import com.littlemissparty.quiz.tv.habillage.SCENE_L
import com.littlemissparty.quiz.tv.habillage.Son
import com.littlemissparty.quiz.tv.habillage.Sons
import com.littlemissparty.quiz.tv.habillage.TexteNeon
import com.littlemissparty.quiz.tv.habillage.apparition
import kotlinx.coroutines.delay

/*
 * 🔴 Le Simon du Prof sur la TV (cedric, 27/10 ; planche du design). L'écran ne décide rien : la box tire la suite
 * secrète, lance chaque suite et juge. Ici, au tableau néon : « Regardez bien… » puis les boules qui s'allument une à
 * une avec leur note ; « Attention, les chiffres débarquent ! » avant la première suite à chiffres ; « À vous de
 * jouer ! » avec ce que chaque équipe tape en direct, en « ? » à sa couleur ; la vérification colonne par colonne ;
 * puis le bandeau (éliminées, gagnante du tour, « Bah alors ?! »). Le robot prof (blouse, grande règle) à gauche du
 * tableau change de pose selon le moment. Sons provisoires (musique choisie avec cedric le 28/10).
 */

/** Teinte de chaque boule (mêmes codes et mêmes teintes que les tablettes). */
internal val TEINTES_SIMON = mapOf(
    "rouge" to Color(0xFFFF2A2A), "orange" to Color(0xFFFF8C00), "jaune" to Color(0xFFFFE81A), "vert" to Color(0xFF2BD94A),
    "bleu" to Color(0xFF1E88FF), "violet" to Color(0xFFA020FF), "rose" to Color(0xFFFF7AD9), "blanc" to Color(0xFFFFFFFF),
)

/** Temps où une boule reste allumée, sur les [SIMON_PAS_MS] de son tour : un petit noir entre deux boules. */
internal const val SIMON_ALLUME_MS = 750L

/** Les étapes du Simon à l'écran. */
internal enum class EtapeSimon { ATTENTE, PRET, CHIFFRES, REGARDEZ, MONTRE, JOUE, TEMPS, VERIF, BILAN }

/**
 * Ce que montre la TV à l'heure [maintenant] (heure du serveur) : l'étape, la boule allumée ([boule], [allumee]),
 * la colonne vérifiée ([colonne]) et les secondes du chrono ([reste]). Égale tant que rien ne change à l'écran.
 */
internal data class VueSimon(val etape: EtapeSimon, val boule: Int = -1, val allumee: Boolean = false, val colonne: Int = -1, val reste: Int = 0)

internal fun vueSimon(r: SimonRound?, maintenant: Long, reponseSec: Int): VueSimon {
    if (r == null) return VueSimon(EtapeSimon.ATTENTE)
    val start = r.startAt
    if (r.enCours && start != null) {
        val montre = r.montreAt ?: start
        val reponse = r.reponseAt ?: montre
        val fin = r.finAt(reponseSec) ?: reponse
        return when {
            r.annonceChiffres && maintenant < start + SIMON_CHIFFRES_MS -> VueSimon(EtapeSimon.CHIFFRES)
            maintenant < montre -> VueSimon(EtapeSimon.REGARDEZ)
            maintenant < reponse -> {
                val dt = maintenant - montre
                VueSimon(EtapeSimon.MONTRE, boule = (dt / SIMON_PAS_MS).toInt().coerceIn(0, r.suite - 1), allumee = dt % SIMON_PAS_MS < SIMON_ALLUME_MS)
            }
            maintenant < fin -> VueSimon(EtapeSimon.JOUE, reste = ((fin - maintenant + 999) / 1000).toInt())
            else -> VueSimon(EtapeSimon.TEMPS)
        }
    }
    val v = r.verdict ?: return VueSimon(EtapeSimon.PRET)
    val dt = (maintenant - v.at).coerceAtLeast(0)
    return if (dt < v.suite * SIMON_VERIF_PAS_MS + SIMON_VERIF_FIN_MS) VueSimon(EtapeSimon.VERIF, colonne = (dt / SIMON_VERIF_PAS_MS).toInt().coerceIn(0, v.suite))
    else VueSimon(EtapeSimon.BILAN)
}

/** Rang de la première erreur de [tape] par rapport à [solution] (élément faux ou manquant), ou null : tout juste. */
internal fun erreurSimon(tape: List<String>, solution: List<String>): Int? = justes(tape, solution).takeIf { it < solution.size }

/** « 6,1 s ». */
internal fun secondesSimon(ms: Long): String = "%d,%d s".format(ms / 1000, (ms % 1000) / 100)

/** Largeur utile du tableau (scène de 1920 × 1080) : plus étroit quand le robot prof est à côté. */
private val LargeurTableau = staticCompositionLocalOf { 1676f }

private val OrNeon = Color(0xFFFFC94A)
private val RoseCraie = Color(0xFFFF9AD5)
private val Creme = Color(0xFFF4F1FF)
private val Ardoise = Brush.verticalGradient(listOf(Color(0xF2182624), Color(0xF20D1513)))

@Composable
fun SimonScreen(state: UiState.Playing, actions: TvActions) {
    val r = state.simon
    val decalage = state.serverOffset
    // L'horloge du serveur, relue toutes les 50 ms ; l'écran ne se redessine que quand ce qu'il montre change.
    val horloge = remember { mutableLongStateOf(System.currentTimeMillis() + decalage) }
    LaunchedEffect(decalage) {
        while (true) {
            horloge.longValue = System.currentTimeMillis() + decalage
            delay(50)
        }
    }
    val vue by remember(r, state.simonSec) { derivedStateOf { vueSimon(r, horloge.longValue, state.simonSec) } }
    val maintenant = { System.currentTimeMillis() + decalage }
    val equipe = { uid: String -> state.teams.find { it.uid == uid } }
    val nom = { uid: String -> equipe(uid)?.name ?: "Une équipe" }
    val couleur = { uid: String -> equipe(uid)?.color?.toColor() ?: GS.Cyan }
    val v = r?.verdict
    val cle = "${r?.tour}-${r?.suite}-${r?.startAt}-${v?.at}"

    // Les sons, jamais rejoués après coup (écran recomposé, box redémarrée) : seulement s'ils tombent maintenant.
    LaunchedEffect(vue.etape == EtapeSimon.CHIFFRES, r?.startAt) {
        val start = r?.startAt ?: return@LaunchedEffect
        if (vue.etape == EtapeSimon.CHIFFRES && maintenant() - start < 1_000) sonSimon(Son.BONUS)
    }
    LaunchedEffect(vue.etape == EtapeSimon.MONTRE, vue.boule, r?.startAt) {
        val rr = r ?: return@LaunchedEffect
        val montre = rr.montreAt ?: return@LaunchedEffect
        if (vue.etape != EtapeSimon.MONTRE || vue.boule < 0) return@LaunchedEffect
        if (maintenant() - (montre + vue.boule * SIMON_PAS_MS) < 400) rr.sequence.getOrNull(vue.boule)?.let { NotesSimon.jouer(it) }
    }
    LaunchedEffect(vue.etape == EtapeSimon.JOUE, vue.reste) {
        if (vue.etape == EtapeSimon.JOUE && vue.reste in 1..3) sonSimon(Son.TIC_1)
    }
    // Vérification : la note de chaque colonne, le « faux » quand une équipe s'y trompe.
    LaunchedEffect(vue.etape == EtapeSimon.VERIF, vue.colonne, v?.at) {
        if (vue.etape != EtapeSimon.VERIF || v == null || r == null || vue.colonne !in 0 until v.suite) return@LaunchedEffect
        if (maintenant() - (v.at + vue.colonne * SIMON_VERIF_PAS_MS) > 400) return@LaunchedEffect
        val solution = r.sequence.take(v.suite)
        if (v.answers.values.any { erreurSimon(it.items, solution) == vue.colonne }) sonSimon(Son.RATE)
        else NotesSimon.jouer(solution[vue.colonne])
    }
    LaunchedEffect(vue.etape == EtapeSimon.BILAN, v?.at) {
        if (vue.etape != EtapeSimon.BILAN || v == null) return@LaunchedEffect
        if (maintenant() - (v.at + v.suite * SIMON_VERIF_PAS_MS + SIMON_VERIF_FIN_MS) > 1_500) return@LaunchedEffect
        when {
            v.bahAlors -> sonSimon(Son.RIGOLO_1)
            v.winners.isNotEmpty() -> sonSimon(Son.BT_BRAVO)
            v.wrong.isEmpty() -> sonSimon(Son.POP_1)
            else -> {}
        }
    }

    EchelleSansCoupe(SCENE_L, SCENE_H, Modifier.fillMaxSize()) {
        if (r != null) {
            TubeSimon("LE SIMON DU PROF · TOUR ${r.tour}", GS.Cyan, Modifier.align(Alignment.TopStart).padding(start = 72.dp, top = 34.dp))
            val n = if (r.enCours || v == null) r.suite else v.suite
            TubeSimon("SUITE N° $n", GS.Orange, Modifier.align(Alignment.TopEnd).padding(end = 72.dp, top = 34.dp))
        }
        val lignes = vue.etape in setOf(EtapeSimon.JOUE, EtapeSimon.TEMPS, EtapeSimon.VERIF)
        // Le robot prof à gauche, le tableau à sa droite ; un tableau plus large pour les lignes des équipes.
        val gauche = if (lignes) 470f else 620f
        Tableau(
            Modifier.padding(start = gauche.dp, end = 40.dp, top = 130.dp, bottom = if (lignes) 40.dp else 190.dp).fillMaxSize(),
        ) { CompositionLocalProvider(LargeurTableau provides 1920f - gauche - 40f - 84f) {
            when (vue.etape) {
                EtapeSimon.ATTENTE -> Annonce(
                    if (state.teams.isEmpty()) "IL FAUT UNE ÉQUIPE" else "LE ROBOT PROF ARRIVE…",
                    if (state.teams.isEmpty()) "Au moins une équipe doit être inscrite pour jouer" else null, cle,
                )
                EtapeSimon.PRET -> Annonce(
                    "PRÊTS ?",
                    when {
                        r!!.tour > 1 && r.suite == 1 -> "Nouveau tour : tout le monde rejoue !"
                        r.suite == 1 -> "Le robot montre une suite : retenez-la bien !"
                        else -> "Suite de ${r.suite} : le joueur appelé prend la tablette"
                    },
                    cle,
                )
                EtapeSimon.CHIFFRES -> ChiffresDebarquent(cle)
                EtapeSimon.REGARDEZ, EtapeSimon.MONTRE -> Montre(r!!, vue, cle)
                EtapeSimon.JOUE, EtapeSimon.TEMPS -> EnDirect(state, r!!, vue, nom, couleur)
                EtapeSimon.VERIF -> Verification(r!!, vue.colonne, nom, couleur)
                EtapeSimon.BILAN -> Bilan(r!!, nom, couleur, cle)
            }
        } }
        // Devant le tableau : sa règle passe par-dessus le cadre, comme sur la planche.
        RobotProf(poseSimon(vue.etape, v), if (lignes) 700f else 820f, Modifier.align(Alignment.BottomStart).offset(x = (-40).dp, y = (-30).dp))
        if (!lignes && r != null) {
            val prets = vue.etape == EtapeSimon.PRET
            Plaques(
                r.teams.map { uid ->
                    val dehors = uid in r.out
                    Plaque(nom(uid), couleur(uid), if (dehors) "éliminés" else if (prets) "joueur n° ${r.joueur(uid, state.simonJoueurs)}" else "encore en jeu", dehors)
                },
                1920f - gauche - 40f,
                Modifier.align(Alignment.BottomEnd).padding(start = gauche.dp, end = 40.dp, bottom = 36.dp),
            )
        }
    }

    // Sans régie, à la télécommande : OK lance la suite, la suivante, le tour suivant, puis le jeu suivant.
    if (!state.paused && state.regies == 0) Box(Modifier.fillMaxSize()) {
        Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 24.dp)) {
            when {
                vue.etape == EtapeSimon.ATTENTE && state.teams.isEmpty() -> NextButton(suiteLabel(state), actions.next, key = "simon-seul-${state.index}")
                vue.etape == EtapeSimon.PRET -> NextButton("Lancer la suite", actions.next, key = "simon-pret-$cle")
                vue.etape == EtapeSimon.BILAN && v != null -> when {
                    state.simonFini -> NextButton(suiteLabel(state), actions.next, key = "simon-fin-$cle")
                    v.winners.isNotEmpty() -> NextButton("Tour suivant", actions.next, key = "simon-tour-$cle")
                    v.bahAlors -> NextButton("Relancer la suite", actions.next, key = "simon-bah-$cle")
                    else -> NextButton("Suite suivante", actions.next, key = "simon-suite-$cle")
                }
                else -> {}
            }
        }
    }
}

private fun sonSimon(s: Son) = Sons.executer(listOf(Ordre.Jouer(s)))

/** Les poses du robot prof (design du 27/10) : même cadre pour toutes, on passe de l'une à l'autre en fondu. */
internal enum class PoseSimon(val image: Int) {
    ATTEND(R.drawable.gs_simon_prof_attend), MONTRE(R.drawable.gs_simon_prof_montre), CHIFFRES(R.drawable.gs_simon_prof_chiffres),
    BAH_ALORS(R.drawable.gs_simon_prof_bahalors), FELICITE(R.drawable.gs_simon_prof_felicite),
}

/** Le robot montre la suite avec sa règle, lève les bras pour les chiffres, félicite (sérieusement) la gagnante du tour. */
internal fun poseSimon(etape: EtapeSimon, v: com.littlemissparty.quiz.engine.SimonVerdict?): PoseSimon = when (etape) {
    EtapeSimon.CHIFFRES -> PoseSimon.CHIFFRES
    EtapeSimon.REGARDEZ, EtapeSimon.MONTRE -> PoseSimon.MONTRE
    EtapeSimon.BILAN -> when {
        v?.bahAlors == true -> PoseSimon.BAH_ALORS
        v?.winners?.isNotEmpty() == true -> PoseSimon.FELICITE
        else -> PoseSimon.ATTEND
    }
    else -> PoseSimon.ATTEND
}

@Composable
private fun RobotProf(pose: PoseSimon, hauteur: Float, modifier: Modifier) {
    Crossfade(pose, modifier.height(hauteur.dp).width((hauteur * 954f / 1000f).dp), animationSpec = tween(250), label = "robot-prof") { p ->
        Image(painterResource(p.image), contentDescription = null, modifier = Modifier.fillMaxSize())
    }
}

/** Halo d'un cadre arrondi : [n] contours de plus en plus larges et pâles autour du bord. */
private fun DrawScope.halo(couleur: Color, rayon: Float, n: Int) {
    for (i in 1..n) {
        val e = i * 10.dp.toPx()
        drawRoundRect(
            couleur.copy(alpha = 0.28f / i), topLeft = Offset(-e / 2, -e / 2), size = size.copy(width = size.width + e, height = size.height + e),
            cornerRadius = CornerRadius(rayon + e / 2), style = Stroke(e),
        )
    }
}

/** « LE SIMON DU PROF · TOUR 3 », « SUITE N° 4 » : tubes néon en haut de l'écran. */
@Composable
private fun TubeSimon(texte: String, couleur: Color, modifier: Modifier) {
    val forme = RoundedCornerShape(50.dp)
    Box(
        modifier.drawBehind { halo(couleur, 50.dp.toPx(), 3) }.background(Color(0xCC0A0618), forme)
            .border(4.dp, Color.White, forme).padding(4.dp).border(4.dp, couleur, forme).padding(horizontal = 30.dp, vertical = 8.dp),
    ) {
        Text(
            texte, maxLines = 1, softWrap = false,
            style = TextStyle(fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Bold, fontSize = 30.sp, letterSpacing = 0.14.em, color = Color.White, shadow = Shadow(couleur, Offset.Zero, 14f)),
        )
    }
}

/** Le tableau du prof : ardoise sombre, grand néon doré, fin trait de craie rose. */
@Composable
private fun Tableau(modifier: Modifier, contenu: @Composable BoxScope.() -> Unit) {
    val forme = RoundedCornerShape(26.dp)
    Box(
        modifier.drawBehind { halo(OrNeon, 26.dp.toPx(), 4) }.background(Ardoise, forme).border(6.dp, OrNeon, forme)
            .padding(10.dp).border(2.dp, RoseCraie, RoundedCornerShape(18.dp)).padding(horizontal = 24.dp, vertical = 20.dp),
        content = contenu,
    )
}

/** Un grand titre néon au tableau, et une ligne d'explication dessous. */
@Composable
private fun BoxScope.Annonce(titre: String, texte: String?, cle: Any?) {
    val l = LargeurTableau.current
    Column(Modifier.align(Alignment.Center).apparition(0, cle), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
        TexteNeon(titre, GS.CyanClair, 120f, PoliceGsTitre, largeurMax = (l - 40f).dp)
        texte?.let { Text(it, maxLines = 2, textAlign = TextAlign.Center, style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 48.sp, color = Creme)) }
    }
}

/** « Regardez bien… », puis les boules qui s'allument une à une (la dernière allumée cerclée de blanc). */
@Composable
private fun BoxScope.Montre(r: SimonRound, vue: VueSimon, cle: Any?) {
    val l = LargeurTableau.current
    Column(Modifier.align(Alignment.TopCenter).fillMaxWidth().padding(top = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        TexteNeon("REGARDEZ BIEN…", Color(0xFFB8FFE0), 84f, PoliceGsTitre, largeurMax = (l - 100f).dp, force = 0.6f)
        Text(
            if (SIMON_AVEC_CHIFFRES && r.suite >= SIMON_CHIFFRES_DES) "Couleurs et chiffres mélangés" else "Le robot montre la suite", maxLines = 1,
            style = TextStyle(fontFamily = PoliceGsChiffres, fontWeight = FontWeight.Bold, fontSize = 30.sp, letterSpacing = 0.08.em, color = Color(0xFF8FF6D0)),
            modifier = Modifier.padding(top = 10.dp),
        )
    }
    val n = r.suite
    val parLigne = if (n <= 10) n else (n + 1) / 2
    val taille = minOf(150f, (l - 80f - 24f * (parLigne - 1)) / parLigne).dp
    Column(Modifier.align(Alignment.Center).padding(top = 120.dp), verticalArrangement = Arrangement.spacedBy(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        (0 until n).chunked(parLigne).forEach { ligne ->
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.CenterVertically) {
                ligne.forEach { j ->
                    val vue1 = vue.etape == EtapeSimon.MONTRE && j <= vue.boule
                    val allumee = vue1 && j == vue.boule && vue.allumee
                    Box(Modifier.size(taille * 1.12f), contentAlignment = Alignment.Center) {
                        if (vue1) Element(r.sequence[j], if (allumee) taille * 1.12f else taille, anneau = if (allumee) Color.White else null, modifier = Modifier.alpha(if (allumee) 1f else 0.82f))
                    }
                }
            }
        }
    }
}

/** Une boule de couleur (sphère brillante) ou un chiffre (tuile blanche), de [taille] ; [anneau] : cerclé. */
@Composable
private fun Element(item: String, taille: Dp, modifier: Modifier = Modifier, anneau: Color? = null) {
    val teinte = TEINTES_SIMON[item]
    if (teinte != null) {
        Canvas(modifier.size(taille).semantics { contentDescription = item }) {
            val rayon = size.minDimension / 2
            drawCircle(teinte.copy(alpha = 0.35f), rayon * 1.0f)
            drawCircle(
                Brush.radialGradient(listOf(Color.White.melange(teinte, 0.45f), teinte, teinte.sombre(0.45f)), center = Offset(size.width * 0.38f, size.height * 0.32f), radius = rayon * 1.25f),
                rayon * 0.92f,
            )
            drawCircle(Color.White.copy(alpha = 0.75f), rayon * 0.14f, center = Offset(size.width * 0.36f, size.height * 0.30f))
            anneau?.let { drawCircle(it, rayon * 0.94f, style = Stroke(rayon * 0.09f)) }
        }
    } else {
        val forme = RoundedCornerShape(taille * 0.22f)
        val d = LocalDensity.current
        Box(
            modifier.size(taille * 0.92f).drawBehind { halo(GS.Cyan, (taille * 0.22f).toPx(), 2) }
                .background(Brush.verticalGradient(listOf(Color.White, Color(0xFFDFF3FF))), forme)
                .then(if (anneau != null) Modifier.border(taille * 0.06f, anneau, forme) else Modifier)
                .semantics { contentDescription = item },
            contentAlignment = Alignment.Center,
        ) {
            Text(item, maxLines = 1, style = TextStyle(fontFamily = PoliceGsTitre, fontSize = with(d) { (taille * 0.58f).toSp() }, color = Color(0xFF0E0A24)))
        }
    }
}

/** Mélange une couleur avec une autre : [part] de celle-ci au-dessus de [fond]. */
private fun Color.melange(fond: Color, part: Float): Color =
    Color(red * part + fond.red * (1 - part), green * part + fond.green * (1 - part), blue * part + fond.blue * (1 - part), 1f)

private fun Color.sombre(k: Float): Color = Color(red * k, green * k, blue * k, alpha)

/** Une bulle « ? » : verre sombre cerclé de la couleur de l'équipe, point d'interrogation lumineux. */
@Composable
private fun Bulle(couleur: Color, taille: Dp) {
    val d = LocalDensity.current
    Box(
        Modifier.size(taille).drawBehind {
            val rayon = size.minDimension / 2
            drawCircle(couleur.copy(alpha = 0.22f), rayon * 1.12f)
            drawCircle(Brush.radialGradient(listOf(couleur.copy(alpha = 0.45f), Color(0xFF120A22)), center = Offset(size.width * 0.4f, size.height * 0.35f), radius = rayon * 1.2f), rayon * 0.94f)
            drawCircle(couleur, rayon * 0.94f, style = Stroke(rayon * 0.1f))
            drawArc(Color.White.copy(alpha = 0.45f), 200f, 70f, false, topLeft = Offset(size.width * 0.2f, size.height * 0.2f), size = size.copy(size.width * 0.6f, size.height * 0.6f), style = Stroke(rayon * 0.08f, cap = StrokeCap.Round))
        },
        contentAlignment = Alignment.Center,
    ) {
        Text("?", maxLines = 1, style = TextStyle(fontFamily = PoliceGsTitre, fontSize = with(d) { (taille * 0.5f).toSp() }, color = Color.White, shadow = Shadow(couleur, Offset.Zero, 12f)))
    }
}

/** Une case vide de la suite : cercle en pointillés. */
@Composable
private fun Vide(taille: Dp, couleur: Color = Color.White.copy(alpha = 0.28f)) {
    Canvas(Modifier.size(taille)) {
        val rayon = size.minDimension / 2
        drawCircle(couleur, rayon * 0.92f, style = Stroke(2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 5.dp.toPx()))))
    }
}

/** Une case d'une ligne : vide, « ? » (tapé, caché), ou l'élément tapé (pendant la vérification). */
private sealed interface Case {
    data object Vide : Case
    data class Cachee(val couleur: Color) : Case
    data class Vue(val item: String, val faux: Boolean) : Case
}

/** Une ligne du tableau : l'équipe (ou « La bonne suite »), ses cases, et son état à droite. */
private class Ligne(val nom: String, val couleur: Color, val cases: List<Case>, val etat: String, val etatCouleur: Color, val eteinte: Boolean = false, val coches: Int = 0)

private val NOM_L = 250.dp
private val ETAT_L = 250.dp
private val ESPACE = 16.dp

/** Les lignes des équipes, la colonne [colonne] entourée (vérification) ; [n] cases par ligne. */
@Composable
private fun BoxScope.Lignes(titre: String, sousTitre: String, lignes: List<Ligne>, n: Int, colonne: Int?, chronoReste: Int? = null, chronoTotal: Int = 0) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().height(110.dp), verticalAlignment = Alignment.CenterVertically) {
            TexteNeon(titre, GS.CyanClair, 86f, PoliceGsTitre, largeurMax = 900.dp, force = 0.6f)
            Text(
                sousTitre, maxLines = 1, softWrap = false, modifier = Modifier.padding(start = 24.dp, top = 18.dp).weight(1f),
                style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 38.sp, color = Color(0xFF8CE8FF)),
            )
            if (chronoReste != null) Chrono(chronoReste, chronoTotal)
        }
        Spacer(Modifier.height(12.dp))
        val hauteurDispo = 880f - 110f - 12f - 40f
        val k = lignes.size.coerceAtLeast(1)
        val h = minOf(100f, (hauteurDispo - 10f * (k - 1)) / k)
        val dispo = LargeurTableau.current - 48f - NOM_L.value - ESPACE.value * 2 - ETAT_L.value
        val taille = minOf(h - 18f, 66f, dispo / (n * 1.2f - 0.2f)).coerceAtLeast(20f)
        val ecart = taille * 0.2f
        Box(Modifier.fillMaxWidth()) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                lignes.forEach { l -> LigneSimon(l, h.dp, taille.dp, ecart.dp) }
            }
            // La colonne en cours de vérification, de haut en bas.
            if (colonne != null && colonne in 0 until n) Box(
                Modifier.offset(x = 24.dp + NOM_L + ESPACE + (taille + ecart).dp * colonne - 7.dp, y = (-6).dp)
                    .width(taille.dp + 14.dp).height((h * k + 10f * (k - 1) + 12f).dp)
                    .drawBehind { halo(GS.Cyan, size.width / 2, 2) }
                    .border(3.dp, GS.Cyan, RoundedCornerShape(50)).background(GS.Cyan.copy(alpha = 0.08f), RoundedCornerShape(50)),
            )
        }
    }
}

@Composable
private fun LigneSimon(l: Ligne, h: Dp, taille: Dp, ecart: Dp) {
    val forme = RoundedCornerShape(22.dp)
    Row(
        Modifier.fillMaxWidth().height(h).alpha(if (l.eteinte) 0.35f else 1f)
            .background(Color(0xE60C0718), forme).border(3.dp, if (l.eteinte) Color.White.copy(alpha = 0.3f) else l.couleur, forme)
            .padding(horizontal = 24.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(NOM_L), contentAlignment = Alignment.CenterStart) {
            TexteNeon(l.nom, l.couleur, 44f, PoliceGsTexte, largeurMax = NOM_L, force = 0.35f, tailleMin = 18f, graisse = FontWeight.Bold)
        }
        Spacer(Modifier.width(ESPACE))
        Row(horizontalArrangement = Arrangement.spacedBy(ecart), verticalAlignment = Alignment.CenterVertically) {
            l.cases.forEachIndexed { j, c ->
                Box(Modifier.size(taille), contentAlignment = Alignment.Center) {
                    when (c) {
                        Case.Vide -> Vide(taille)
                        is Case.Cachee -> Bulle(c.couleur, taille)
                        is Case.Vue -> Element(c.item, taille, anneau = if (c.faux) GS.Faux else null)
                    }
                    if (j < l.coches) Text("✓", maxLines = 1, modifier = Modifier.align(Alignment.TopCenter).offset(y = -taille * 0.42f), style = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.Bold, color = GS.Juste))
                }
            }
        }
        Spacer(Modifier.weight(1f).width(ESPACE))
        Text(
            l.etat, maxLines = 1, softWrap = false, textAlign = TextAlign.End, modifier = Modifier.width(ETAT_L),
            style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 32.sp, color = l.etatCouleur),
        )
    }
}

/** Le chrono du tableau : anneau jaune qui se vide, secondes au milieu. */
@Composable
private fun Chrono(reste: Int, total: Int) {
    val presse = reste <= 3
    val c = if (presse) GS.Faux else GS.Jaune
    Box(Modifier.size(104.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val e = 10.dp.toPx()
            drawCircle(Color(0xFF1A1230), size.minDimension / 2 - e / 2)
            drawArc(c, -90f, 360f * (reste.toFloat() / total.coerceAtLeast(1)), false, topLeft = Offset(e / 2, e / 2), size = size.copy(size.width - e, size.height - e), style = Stroke(e, cap = StrokeCap.Round))
        }
        Text("$reste", maxLines = 1, style = TextStyle(fontFamily = PoliceGsTitre, fontSize = 46.sp, color = Color.White, shadow = Shadow(c, Offset.Zero, 14f)))
    }
}

/** « À vous de jouer ! » : ce que chaque équipe tape, en « ? » à sa couleur, et qui a validé. */
@Composable
private fun BoxScope.EnDirect(state: UiState.Playing, r: SimonRound, vue: VueSimon, nom: (String) -> String, couleur: (String) -> Color) {
    val depart = r.reponseAt ?: 0L
    val lignes = r.teams.map { uid ->
        val c = couleur(uid)
        if (uid in r.out) Ligne(nom(uid), c, List(r.suite) { Case.Vide }, "déjà éliminés", Creme, eteinte = true)
        else {
            val s = state.simonSaisies[uid]
            val tapes = s?.items?.size?.coerceAtMost(r.suite) ?: 0
            val etat = when {
                s != null && s.ok -> "✓ Validé" + (s.at?.let { " · " + secondesSimon((it - depart).coerceAtLeast(0)) } ?: "")
                vue.etape == EtapeSimon.TEMPS -> "temps écoulé"
                tapes > 0 -> "tape…"
                else -> "…"
            }
            Ligne(nom(uid), c, List(r.suite) { j -> if (j < tapes) Case.Cachee(c) else Case.Vide }, etat, if (s?.ok == true) GS.Juste else Creme)
        }
    }
    val total = (reponseMs(r.suite, state.simonSec) / 1000).toInt()
    Lignes(
        if (vue.etape == EtapeSimon.TEMPS) "TEMPS ÉCOULÉ !" else "À VOUS DE JOUER !",
        "Suite de ${r.suite} · tapez puis validez", lignes, r.suite, null,
        chronoReste = vue.reste.takeIf { vue.etape == EtapeSimon.JOUE }, chronoTotal = total,
    )
}

/**
 * La vérification, colonne par colonne (cedric, 27/10) : la bonne suite se dévoile en haut ; sur chaque ligne,
 * ce que l'équipe a tapé ; la première erreur d'une équipe est cerclée de rouge, et l'équipe est éliminée.
 */
@Composable
private fun BoxScope.Verification(r: SimonRound, colonne: Int, nom: (String) -> String, couleur: (String) -> Color) {
    val v = r.verdict ?: return
    val solution = r.sequence.take(v.suite)
    val haut = Ligne(
        "La bonne suite", OrNeon,
        List(v.suite) { j -> if (j <= colonne) Case.Vue(solution[j], false) else Case.Cachee(OrNeon) }, "", Creme, coches = colonne,
    )
    val equipes = r.teams.map { uid ->
        val c = couleur(uid)
        val a = v.answers[uid] ?: return@map Ligne(nom(uid), c, List(v.suite) { Case.Vide }, "déjà éliminés", Creme, eteinte = true)
        val erreur = erreurSimon(a.items, solution)
        val cases = List(v.suite) { j ->
            when {
                j > colonne || (erreur != null && j > erreur) -> if (j < a.items.size) Case.Cachee(c) else Case.Vide
                j < a.items.size -> Case.Vue(a.items[j], j == erreur)
                else -> Case.Vide
            }
        }
        val etat = when {
            erreur != null && colonne >= erreur -> if (uid in v.wrong) "✕ Éliminés" else "✕ Une erreur"
            colonne >= v.suite -> "✓ Tout juste"
            else -> "en vérification…"
        }
        Ligne(nom(uid), c, cases, etat, if (etat.startsWith("✕")) GS.Faux else if (etat.startsWith("✓")) GS.Juste else Creme)
    }
    Lignes("VÉRIFICATION…", if (colonne < v.suite) "élément n° ${colonne + 1}" else "", listOf(haut) + equipes, v.suite, colonne.takeIf { it < v.suite })
}

/** Le bandeau après la vérification : « Bah alors ?! », la gagnante du tour, les éliminées, ou tout le monde continue. */
@Composable
private fun BoxScope.Bilan(r: SimonRound, nom: (String) -> String, couleur: (String) -> Color, cle: Any?) {
    val v = r.verdict ?: return
    val solution = r.sequence.take(v.suite)
    val l = LargeurTableau.current
    val texte = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 50.sp, color = Creme, textAlign = TextAlign.Center)
    Column(
        Modifier.align(Alignment.Center).fillMaxWidth().apparition(0, cle),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        when {
            v.bahAlors -> {
                Text("Toutes les équipes se sont trompées…", maxLines = 1, style = texte)
                TexteNeon("BAH ALORS,", GS.Orange, 110f, PoliceGsTitre, largeurMax = (l - 40f).dp)
                TexteNeon("QU'EST-CE QUI VOUS ARRIVE ?!", GS.Orange, 96f, PoliceGsTitre, largeurMax = (l - 40f).dp)
                Text("On recommence la même suite.", maxLines = 1, style = texte)
            }
            v.winners.isNotEmpty() -> {
                val toutesFausses = v.winners.all { w -> v.answers[w]?.let { erreurSimon(it.items, solution) } != null }
                Text(
                    when {
                        toutesFausses -> "Toutes se sont trompées : la plus avancée gagne !"
                        v.winners.size > 1 -> "Suite géante réussie !"
                        else -> "Dernière équipe en jeu"
                    },
                    maxLines = 1, style = texte,
                )
                val c = couleur(v.winners.first())
                TexteNeon(v.winners.joinToString(" et ") { nom(it) }.uppercase(), c, 120f, PoliceGsTitre, largeurMax = (l - 40f).dp)
                TexteNeon(if (v.winners.size > 1) "REMPORTENT LE TOUR" else "REMPORTE LE TOUR", c, 96f, PoliceGsTitre, largeurMax = (l - 40f).dp)
                if (v.points > 0) Text(
                    "+${v.points} POINTS", maxLines = 1,
                    modifier = Modifier.padding(top = 10.dp).drawBehind { halo(c, 50.dp.toPx(), 2) }.background(c, RoundedCornerShape(50.dp)).padding(horizontal = 40.dp, vertical = 8.dp),
                    style = TextStyle(fontFamily = PoliceGsTitre, fontSize = 54.sp, color = Color(0xFF120818)),
                )
            }
            v.wrong.isNotEmpty() -> {
                Text("Une erreur dans la suite…", maxLines = 1, style = texte)
                if (v.wrong.size <= 2) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    v.wrong.forEachIndexed { i, uid ->
                        if (i > 0) Text("et", maxLines = 1, style = texte)
                        TexteNeon(nom(uid).uppercase(), couleur(uid), 110f, PoliceGsTitre, largeurMax = if (v.wrong.size == 1) (l - 40f).dp else ((l - 120f) / 2).dp)
                    }
                } else TexteNeon(v.wrong.joinToString(", ") { nom(it) }.uppercase(), GS.Faux, 90f, PoliceGsTitre, largeurMax = (l - 40f).dp)
                TexteNeon("ÉLIMINÉS DU TOUR", GS.Faux, 90f, PoliceGsTitre, largeurMax = (l - 40f).dp)
                Text("Les autres équipes continuent : la prochaine suite aura un élément de plus.", maxLines = 2, style = texte.copy(fontSize = 42.sp))
            }
            else -> {
                Text("Tout juste pour tout le monde !", maxLines = 1, style = texte)
                TexteNeon("ON CONTINUE !", GS.Juste, 120f, PoliceGsTitre, largeurMax = (l - 40f).dp)
                Text("La prochaine suite aura un élément de plus.", maxLines = 1, style = texte.copy(fontSize = 42.sp))
            }
        }
    }
}

/** « Attention ! Les chiffres débarquent ! » : les tuiles des chiffres arrivent de partout autour du titre. */
@Composable
private fun BoxScope.ChiffresDebarquent(cle: Any?) {
    val k = LargeurTableau.current / 1676f
    val p = remember(cle) { Animatable(0f) }
    LaunchedEffect(cle) { p.animateTo(1f, tween(1_800, easing = FastOutSlowInEasing)) }
    // Place (au tableau, 1676 × 690), taille et inclinaison de chaque tuile.
    val tuiles = listOf(
        Triple("4", Offset(200f, 120f), 150f to -12f), Triple("1", Offset(620f, 60f), 100f to -6f), Triple("7", Offset(1080f, 90f), 130f to 10f),
        Triple("3", Offset(1500f, 170f), 110f to -14f), Triple("8", Offset(110f, 420f), 96f to -4f), Triple("2", Offset(1540f, 520f), 150f to 8f),
        Triple("9", Offset(380f, 600f), 140f to -8f), Triple("5", Offset(900f, 620f), 120f to 6f), Triple("6", Offset(1210f, 640f), 96f to -10f),
    )
    tuiles.forEachIndexed { i, (chiffre, place, forme) ->
        val (taille, angle) = forme
        Box(
            Modifier.offset(x = (place.x * k - taille / 2).dp, y = (place.y - taille / 2).dp).size(taille.dp).graphicsLayer {
                val e = ((p.value * 1.6f - i * 0.06f)).coerceIn(0f, 1f)
                val dx = (place.x - 838f) * k * 1.6f
                val dy = (place.y - 345f) * 1.6f
                translationX = (1 - e) * dx.dp.toPx()
                translationY = (1 - e) * dy.dp.toPx()
                rotationZ = angle + (1 - e) * 90f
                alpha = e
            },
            contentAlignment = Alignment.Center,
        ) { Element(chiffre, taille.dp) }
    }
    Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TexteNeon("ATTENTION !", GS.Jaune, 80f, PoliceGsTitre, largeurMax = 1000.dp, modifier = Modifier.apparition(200, cle))
        TexteNeon("LES CHIFFRES", GS.Cyan, 130f, PoliceGsTitre, largeurMax = (1300f * k).dp, modifier = Modifier.apparition(500, cle))
        TexteNeon("DÉBARQUENT !", GS.Cyan, 130f, PoliceGsTitre, largeurMax = (1300f * k).dp, modifier = Modifier.apparition(800, cle))
    }
}

/** Les plaques des équipes du tour, sous le tableau : en jeu, joueur appelé, ou éliminées (pâlies). */
private class Plaque(val nom: String, val couleur: Color, val etat: String, val eteinte: Boolean)

@Composable
private fun Plaques(plaques: List<Plaque>, largeur: Float, modifier: Modifier) {
    if (plaques.isEmpty()) return
    val l = minOf(300f, (largeur - 14f * (plaques.size - 1)) / plaques.size).dp
    val forme = RoundedCornerShape(22.dp)
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        plaques.forEach { p ->
            Column(
                Modifier.width(l).height(112.dp).alpha(if (p.eteinte) 0.4f else 1f)
                    .drawBehind { if (!p.eteinte) halo(p.couleur, 22.dp.toPx(), 2) }
                    .background(Color(0xE60A0618), forme).border(4.dp, if (p.eteinte) Color.White.copy(alpha = 0.4f) else p.couleur, forme)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
            ) {
                TexteNeon(p.nom, p.couleur, 42f, PoliceGsTexte, largeurMax = l - 24.dp, force = 0.35f, tailleMin = 16f, graisse = FontWeight.Bold)
                Text(p.etat, maxLines = 1, softWrap = false, style = TextStyle(fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 28.sp, color = Creme))
            }
        }
    }
}
