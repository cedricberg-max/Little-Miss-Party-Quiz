package com.littlemissparty.quiz.tv.habillage

import android.os.SystemClock
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import com.littlemissparty.quiz.engine.LigneParole
import kotlinx.coroutines.delay

/*
 * Les écrans du blind test, façon jeu télévisé. Chaque composable ne fait que réagir à ce qu'on lui donne :
 * il ne décide rien de la partie et ne bloque aucune touche. Animations légères pour la Mi Box : calques
 * dessinés une fois, seules l'échelle, la rotation et l'opacité changent.
 *
 * Chaque scène est dessinée pour une surface de 1600 × 700 et mise à l'échelle de la place qu'on lui donne
 * ([Echelle]) : au-dessus des équipes et des boutons, de 1 à 8 équipes, rien ne déborde.
 */

private val LARGEUR = 1600.dp
private val HAUTEUR = 700.dp
/** Hauteur la plus basse où la scène des paroles tient entière (pochette au plus petit, paroles, égaliseur). */
internal val HAUTEUR_PAROLES = 460.dp

/** Millisecondes écoulées depuis l'arrivée de [cle], rafraîchies une vingtaine de fois par seconde. */
@Composable
internal fun horloge(cle: Any?): () -> Float {
    val depart = remember(cle) { SystemClock.elapsedRealtime() }
    val maintenant = remember(cle) { mutableLongStateOf(depart) }
    LaunchedEffect(cle) {
        while (true) {
            maintenant.longValue = SystemClock.elapsedRealtime()
            delay(50)
        }
    }
    return { (maintenant.longValue - depart).toFloat() }
}

/**
 * Fond de scène. Classique : un panneau aux coins arrondis qui borne les rayons. Game Show : aucun cadre sur le plateau
 * (cedric, 24 octobre), les rayons s'éteignent d'eux-mêmes dans la fumée.
 */
@Composable
private fun Scene(fond: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().then(if (Look.gs) Modifier.panneauJeu() else Modifier.clip(RoundedCornerShape(36.dp)).background(Color.White.copy(alpha = 0.05f)))) { fond() }
}

/**
 * Présentation du blind test : rayons dorés, la platine qui glisse en place, le bras qui se pose et le disque qui tourne, « BLIND TEST » en
 * grand, le nom de la playlist, le premier morceau et sa valeur. Accompagne le générique court (lmp_bt_generique) et reste
 * affichée jusqu'à « Lancer le morceau ».
 */
@Composable
fun BlindIntro(playlist: String, morceaux: Int, points: Int, modifier: Modifier = Modifier) {
    val ms = horloge(playlist)
    val arrivee = remember(playlist) { Animatable(0f) }
    val bras = remember(playlist) { Animatable(0f) }
    LaunchedEffect(playlist) {
        arrivee.animateTo(1f, tween(900, easing = FastOutSlowInEasing))
        bras.animateTo(1f, tween(450, easing = FastOutSlowInEasing))
    }
    Box(modifier) {
    Echelle(LARGEUR, HAUTEUR, Modifier.matchParentSize()) {
        Scene { Rayons(ms) }
        Row(Modifier.fillMaxSize().padding(horizontal = 72.dp, vertical = 40.dp), verticalAlignment = Alignment.CenterVertically) {
            // La platine glisse en place, puis le bras vient se poser et le disque se met à tourner.
            val place = Modifier.fillMaxHeight(0.85f).graphicsLayer {
                translationX = -(1f - arrivee.value) * size.width * 0.6f
                alpha = arrivee.value
            }
            val classique: @Composable () -> Unit = {
                SideEffect { Habillage.platineIntroClassique = true }
                Platine(angle = { (ms() - 1300f).coerceAtLeast(0f) / 1000f * 198f }, leve = 1f - bras.value, or = 0f, modifier = place)
            }
            // Game Show : déjà la platine néon de l'écoute, à l'arrêt (cedric, 25/10 : l'ancienne platine passait juste
            // avant la nouvelle au premier morceau).
            if (Look.gs) PlatineNeonGs(joue = false, manquant = false, modifier = place.aspectRatio(PlatineNeon.LARGEUR / PlatineNeon.HAUTEUR), secours = classique)
            else classique()
            Spacer(Modifier.width(56.dp))
            // Game Show : les textes sont posés à leur place sur la planche, à leur vraie taille (calque ci-dessous).
            if (Look.gs) Spacer(Modifier.weight(1f))
            else Column(Modifier.weight(1f)) {
                TexteJauge(
                    "BLIND TEST", color = Neon.Or, fontSize = 100.sp, lineHeight = 106.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                    modifier = Modifier.apparition(400, playlist), echelle = ECHELLE_SCENE_BLIND,
                )
                if (playlist.isNotBlank()) {
                    TexteJauge(
                        playlist, color = Neon.Blanc, fontSize = 44.sp, lineHeight = 50.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.apparition(900, playlist), echelle = ECHELLE_SCENE_BLIND,
                    )
                }
                Spacer(Modifier.height(24.dp))
                TexteJauge(
                    "Morceau 1 / $morceaux · $points points", color = Neon.Halo, fontSize = 38.sp,
                    fontWeight = FontWeight.Black, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.apparition(1300, playlist), echelle = ECHELLE_SCENE_BLIND,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Prêts ? Écoutez bien…", color = Neon.Blanc, fontSize = 48.sp, lineHeight = 54.sp,
                    fontWeight = FontWeight.Black, modifier = Modifier.apparition(1700, playlist),
                )
            }
        }
    }
    // Game Show : planche des onglets d'appel (31/10), positions fixes d'un écran de 1280 × 720 et tailles de la
    // planche, quelle que soit la taille de la scène (avant, tout rapetissait avec elle : environ 60 %).
    if (Look.gs) CalquePlanche(Modifier.matchParentSize()) {
        // Le nom de la playlist (quand il y en a un) au-dessus du titre, la planche n'en a pas.
        if (playlist.isNotBlank()) TexteJauge(
            playlist, color = Neon.Blanc, fontSize = pxSp(30f), fontWeight = FontWeight.Bold, maxLines = 1, softWrap = false,
            modifier = Modifier.planche(400f, 112f, ancreX = 0f).apparition(900, playlist),
        )
        // Le titre en Bungee dégradé avec sa note jaune (validé par cedric le 31/10 à 11:12 à 76 px, centre y 222) : plus
        // d'onglet « Blind test 1 / 3 » au-dessus (cedric, 1/11 au soir), il remonte et grandit un peu : 88 px, centre y 178.
        TitreBlindTest(px(88f), Modifier.planche(400f, 178f, ancreX = 0f).apparition(400, playlist))
        // L'info en rose, 28 px : bord gauche x 406, centre y 268.
        TexteJauge(
            "Morceau 1 / $morceaux · $points points", color = RoseChante, fontSize = pxSp(28f),
            fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
            modifier = Modifier.planche(406f, 268f, ancreX = 0f).apparition(1300, playlist),
        )
        // L'onglet « PRÊTS ? » (299 × 116 à k, ici 12 % plus grand : 335 × 130) : bord gauche x 400, centre y 380.
        PlaqueAppel(GenrePlaque.BLIND, "PRÊTS ?", "Écoutez bien…", Modifier.planche(400f, 380f, ancreX = 0f).apparition(1700, playlist), k = k * 1.12f)
    }
    }
}

/** La scène fait 1600 dp de large pour un écran de 960 : les ombres du contour sont agrandies d'autant. */
internal const val ECHELLE_SCENE_BLIND = 1600f / 960f

/**
 * Une équipe a buzzé : panneau bleu nuit cerné d'un néon de la couleur de l'équipe, qui flashe trois fois,
 * « STOP ! » claque en néon, puis « X a buzzé ! » et « On attend sa réponse… » qui respire. Le fond ne mélange
 * jamais la couleur de l'équipe au violet : même rendu propre avec les 8 couleurs.
 */
@Composable
fun BlindBuzz(equipe: String, couleur: Color, modifier: Modifier = Modifier) {
    val ms = horloge(equipe)
    if (Look.gs) {
        // Game Show (proposition D) : lasers qui convergent, anneau à la couleur de l'équipe, « STOP ! » en glitch.
        Echelle(LARGEUR, HAUTEUR, modifier) {
            AlerteBuzz(ms, couleur, { 1f }, Modifier.fillMaxSize())
            // Lu d'un seul bloc (lecteur d'écran, tests) : la pastille et la ligne disent « X a buzzé ! ».
            Column(
                Modifier.align(Alignment.Center).clearAndSetSemantics { contentDescription = "$equipe a buzzé ! On attend sa réponse…" },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                StopGlitch(ms, 120.sp)
                Spacer(Modifier.height(14.dp))
                PastilleNom(equipe, couleur, 84f, 640.dp, Modifier.apparition(180, equipe))
                Spacer(Modifier.height(22.dp))
                LigneBuzz("A BUZZÉ · ON ÉCOUTE SA RÉPONSE", 22.sp, Modifier.apparition(420, equipe))
            }
        }
        return
    }
    val anim = rememberInfiniteTransition(label = "attente")
    val souffle by anim.animateFloat(0.45f, 1f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "attente")
    Echelle(LARGEUR, HAUTEUR, modifier) { Box(
        Modifier.fillMaxSize()
            .drawBehind {
                // Halo du néon autour du cadre : quelques contours de plus en plus larges et transparents.
                for (k in 1..4) {
                    val e = k * 7.dp.toPx()
                    drawRoundRect(
                        couleur.copy(alpha = 0.16f / k), Offset(-e / 2, -e / 2), Size(size.width + e, size.height + e),
                        CornerRadius(28.dp.toPx() + e / 2), style = Stroke(e),
                    )
                }
            }
            .clip(RoundedCornerShape(28.dp))
            .background(Brush.linearGradient(listOf(Color(0xFF1D0C40), Color(0xFF0B041F))))
            .border(5.dp, couleur, RoundedCornerShape(28.dp)),
        contentAlignment = Alignment.Center,
    ) {
        // Trois flashs blancs au moment du buzz.
        Box(
            Modifier.fillMaxSize().graphicsLayer {
                val t = ms()
                alpha = if (t < 900f && (t / 150f).toInt() % 2 == 0) 0.35f else 0f
            }.background(Neon.Blanc),
        )
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
            Text(
                "STOP !", fontSize = 150.sp, lineHeight = 156.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                style = TextStyle(fontFamily = PoliceLmp, lineHeight = 1.2.em, lineHeightStyle = LIGNE_LMP, color = couleur, shadow = Shadow(couleur.copy(alpha = 0.85f), Offset.Zero, 40f)),
                modifier = Modifier.apparition(0, equipe),
            )
            Text(
                "$equipe a buzzé !", color = Neon.Blanc, fontSize = 70.sp, lineHeight = 78.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.apparition(250, equipe),
            )
            Spacer(Modifier.height(20.dp))
            Text(
                "On attend sa réponse…", color = Neon.Blanc, fontSize = 44.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.apparition(500, equipe).graphicsLayer { alpha = souffle },
            )
        }
    } }
}

/**
 * Révélation du morceau : la pochette se retourne au centre (la platine au disque doré s'il n'y en a pas), le titre et
 * l'artiste apparaissent en toutes lettres, puis le badge des points tombe en rebondissant dans la couleur de
 * l'équipe gagnante. Sans gagnant, même mise en scène sans points. La durée de la séquence est celle que le
 * moteur garde l'écran affiché : rien ici n'attend ni ne déclenche la suite.
 *
 * @param cle identifiant du morceau, pour rejouer l'entrée à chaque nouvelle révélation
 * @param chantons refrain préparé en boucle : « 🎤 Tous ensemble, on chante ! » en bas de la scène, trouvé ou non
 * @param paroles paroles du refrain, synchronisées : avec [chantons], la scène des paroles ([SceneParoles]) remplace
 *   la révélation classique ; vides, la pochette et son vinyle (ou le vinyle seul) restent au centre
 * @param positionMs position du refrain qu'on entend (ms depuis le début de l'extrait), null s'il ne joue pas
 * @param gagnants Quiz musical : les équipes qui ont trouvé (vide : personne), à la place de [gagnant] et de [points]
 */
@Composable
fun BlindRevelation(
    cle: Any?,
    pochette: ImageBitmap?,
    titre: String,
    artiste: String?,
    gagnant: Pair<String, Color>?,
    points: Int,
    double: Boolean,
    modifier: Modifier = Modifier,
    chantons: Boolean = false,
    paroles: List<LigneParole> = emptyList(),
    positionMs: () -> Long? = { null },
    gagnants: List<Pair<String, Color>>? = null,
) {
    val ms = horloge(cle)
    val fete = if (gagnants != null) gagnants.isNotEmpty() else gagnant != null && points > 0
    if (chantons && paroles.isNotEmpty()) {
        // La scène des paroles se tasse en hauteur (pochette plus petite) au lieu de tout rapetisser : avec 8 équipes,
        // le plateau est bas, et « Bravo … ! » et « TOUT LE MONDE CHANTE ! » devenaient minuscules (cedric, 30/10).
        Echelle(LARGEUR, HAUTEUR_PAROLES, modifier) {
            Scene { Rayons(ms) }
            SceneParoles(cle, pochette, titre, artiste, gagnant, points, double, paroles, positionMs, gagnants)
            if (fete) Gerbe(cle, actif = apres(500, cle))
        }
        return
    }
    val retourne = remember(cle) { Animatable(0f) }
    val sortie = remember(cle) { Animatable(0f) }
    LaunchedEffect(cle) {
        retourne.animateTo(1f, spring(dampingRatio = 0.6f, stiffness = Spring.StiffnessLow))
        sortie.animateTo(1f, tween(800, easing = FastOutSlowInEasing))
    }
    Echelle(LARGEUR, HAUTEUR, modifier) {
        Scene { Rayons(ms) }
        // Avec « Tous ensemble, on chante ! » en bas, le contenu remonte pour ne jamais passer dessous.
        Row(
            Modifier.fillMaxSize().padding(start = 72.dp, end = 72.dp, top = 40.dp, bottom = if (chantons) 84.dp else 40.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.fillMaxHeight(0.8f).aspectRatio(if (pochette != null) 1.26f else 1.2f, matchHeightConstraintsFirst = true)
                    .graphicsLayer {
                        rotationY = (1f - retourne.value) * 90f
                        val e = 0.7f + 0.3f * retourne.value
                        scaleX = e; scaleY = e
                        cameraDistance = 16f * density
                    },
                contentAlignment = Alignment.CenterStart,
            ) {
                if (pochette != null) {
                    // Le vinyle sort de derrière la pochette une fois retournée, et tourne.
                    Vinyle(
                        angle = { ms() / 1000f * 198f },
                        modifier = Modifier.fillMaxHeight(0.94f).align(Alignment.CenterEnd).graphicsLayer {
                            translationX = -(1f - sortie.value) * size.width * 0.3f
                        },
                    )
                    Image(
                        pochette, contentDescription = null, contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxHeight().aspectRatio(1f, matchHeightConstraintsFirst = true)
                            .clip(RoundedCornerShape(18.dp)).border(6.dp, Neon.Or, RoundedCornerShape(18.dp)),
                    )
                } else {
                    // Pas de pochette : le disque à l'étiquette dorée tourne sous le bras posé.
                    Platine(angle = { ms() / 1000f * 198f }, leve = 0f, or = 1f, modifier = Modifier.fillMaxSize())
                }
            }
            Spacer(Modifier.width(56.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.Center) {
                Text("C'était…", color = Neon.Blanc.copy(alpha = 0.75f), fontSize = 34.sp, fontWeight = FontWeight.Bold, modifier = Modifier.apparition(300, cle))
                Text(
                    titre, color = Neon.Or, fontSize = 72.sp, lineHeight = 78.sp, fontWeight = FontWeight.Black, maxLines = 3, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.apparition(600, cle),
                )
                if (!artiste.isNullOrBlank()) {
                    Text(
                        artiste, color = Neon.Blanc, fontSize = 44.sp, lineHeight = 50.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.apparition(1000, cle),
                    )
                }
                Spacer(Modifier.height(36.dp))
                if (!gagnants.isNullOrEmpty()) {
                    BravoEquipes(gagnants, 46.sp, Modifier.apparition(1800, cle))
                } else if (gagnants == null && gagnant != null && points > 0) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.apparition(1800, cle)) {
                        Box(
                            Modifier.size(170.dp).rebond(true, 0.06f).clip(CircleShape).background(gagnant.second),
                            contentAlignment = Alignment.Center,
                        ) {
                            // « +1000 » tient aussi dans la pastille.
                            val chiffres = "+$points".length
                            Text(
                                "+$points", color = Neon.Nuit, fontSize = if (chiffres > 4) 40.sp else if (chiffres > 3) 50.sp else 62.sp,
                                lineHeight = 64.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                            )
                        }
                        Spacer(Modifier.width(28.dp))
                        Column {
                            Text(
                                "Bonne réponse ! Bravo ${gagnant.first}", color = gagnant.second, fontSize = 46.sp, lineHeight = 52.sp, fontWeight = FontWeight.Black,
                                maxLines = 2, overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                when {
                                    points > 1 && double -> "$points points (points doublés !)"
                                    points > 1 -> "$points points"
                                    else -> "1 point"
                                },
                                color = Neon.Blanc.copy(alpha = 0.85f), fontSize = 30.sp, fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                } else {
                    Text(
                        "Personne n'a trouvé, ce n'est pas grave !", color = Neon.Blanc.copy(alpha = 0.85f), fontSize = 34.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.apparition(1400, cle),
                    )
                }
            }
        }
        if (fete) Gerbe(cle, actif = apres(1800, cle))
        // Le moment le plus festif : toute la salle chante le refrain jusqu'au « Titre suivant ». Sous la platine et le
        // titre (bande libre du bas de la scène), jamais par-dessus.
        if (chantons) {
            if (Look.gs) ToutLeMondeChante(40.sp, Modifier.align(Alignment.BottomCenter).padding(bottom = 14.dp).apparition(2_200, cle))
            else Text(
                "🎤 Tous ensemble, on chante !", color = Neon.Or, fontSize = 40.sp, fontWeight = FontWeight.Black, maxLines = 1,
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 14.dp).apparition(2_200, cle),
            )
        }
    }
}

/**
 * Annonce des derniers morceaux à double valeur : « DERNIERS MORCEAUX », un « × 2 » géant qui claque sur deux
 * temps, et la valeur d'un morceau. Accompagne lmp_bt_double ; s'affiche par-dessus l'écran du blind test.
 */
@Composable
fun BlindDouble(points: Int, restants: Int, modifier: Modifier = Modifier) {
    val ms = horloge(restants)
    Echelle(LARGEUR, HAUTEUR, modifier.fillMaxSize().background(Neon.Fond.copy(alpha = 0.92f))) {
        Rayons(ms)
        Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                "DERNIERS MORCEAUX", color = Neon.Halo, fontSize = 44.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                modifier = Modifier.apparition(0, restants),
            )
            Text(
                "× 2", color = Neon.Or, fontSize = 260.sp, lineHeight = 260.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                modifier = Modifier.apparition(2000, restants).rebond(apres(2400, restants), 0.05f),
            )
            Text(
                "POINTS DOUBLÉS !", color = Neon.Blanc, fontSize = 64.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                modifier = Modifier.apparition(2500, restants),
            )
            Spacer(Modifier.height(16.dp))
            Text(
                (if (restants > 1) "Encore $restants chansons" else "Dernière chanson") + " · $points points chacune",
                color = Neon.Blanc.copy(alpha = 0.8f), fontSize = 34.sp, fontWeight = FontWeight.Bold, modifier = Modifier.apparition(3000, restants),
            )
        }
    }
}

/**
 * Bilan du blind test : les équipes classées par points gagnés pendant le blind test, chaque barre se remplit
 * l'une après l'autre. Accompagne lmp_bt_outro, avant le classement général ou le jeu suivant.
 */
@Composable
fun BlindBilan(lignes: List<Triple<String, Color, Int>>, modifier: Modifier = Modifier) {
    val tri = remember(lignes) { lignes.sortedByDescending { it.third } }
    val max = (tri.firstOrNull()?.third ?: 0).coerceAtLeast(1)
    // De 1 à 8 équipes : au-delà de 4, les lignes se resserrent pour tenir dans l'écran.
    val serre = tri.size > 4
    val taille = if (serre) 32.sp else 40.sp
    Echelle(LARGEUR, HAUTEUR, modifier) { Column(Modifier.fillMaxSize().padding(horizontal = 80.dp, vertical = if (serre) 20.dp else 40.dp), verticalArrangement = Arrangement.Center) {
        Text(
            "Bilan du blind test", color = Neon.Or, fontSize = 64.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
            modifier = Modifier.apparition(0, lignes),
        )
        Spacer(Modifier.height(if (serre) 16.dp else 36.dp))
        tri.forEachIndexed { k, (nom, couleur, pts) ->
            val remplir = remember(lignes) { Animatable(0f) }
            LaunchedEffect(lignes) {
                delay(500L + k * 350L)
                remplir.animateTo(pts.toFloat() / max, tween(700, easing = FastOutSlowInEasing))
            }
            Row(Modifier.fillMaxWidth().padding(vertical = if (serre) 5.dp else 10.dp).apparition(300L + k * 350L, lignes), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(if (serre) 20.dp else 28.dp).clip(CircleShape).background(couleur))
                Spacer(Modifier.width(18.dp))
                Text(nom, color = Neon.Blanc, fontSize = taille, fontWeight = FontWeight.Black, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(500.dp))
                Box(Modifier.weight(1f).height(if (serre) 30.dp else 40.dp).clip(RoundedCornerShape(20.dp)).background(Color.White.copy(alpha = 0.08f))) {
                    Box(
                        Modifier.fillMaxHeight().fillMaxWidth().graphicsLayer {
                            scaleX = remplir.value.coerceAtLeast(0.02f)
                            transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, 0.5f)
                        }.background(Brush.horizontalGradient(listOf(couleur.copy(alpha = 0.6f), couleur))),
                    )
                }
                Spacer(Modifier.width(18.dp))
                Text(
                    if (pts > 1) "$pts pts" else "$pts pt", color = couleur, fontSize = taille, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                    modifier = Modifier.width(220.dp), textAlign = TextAlign.End,
                )
            }
        }
    } }
}
