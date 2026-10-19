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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/*
 * Les écrans du blind test, façon jeu télévisé. Chaque composable ne fait que réagir à ce qu'on lui donne :
 * il ne décide rien de la partie et ne bloque aucune touche. Animations légères pour la Mi Box : calques
 * dessinés une fois, seules l'échelle, la rotation et l'opacité changent.
 */

/** Millisecondes écoulées depuis l'arrivée de [cle], rafraîchies une vingtaine de fois par seconde. */
@Composable
private fun horloge(cle: Any?): () -> Float {
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
 * Présentation du blind test : rayons dorés, la platine qui glisse en place, le bras qui se pose et le disque qui tourne, « BLIND TEST » en
 * grand, le nom de la playlist et le nombre de morceaux. Accompagne le générique court (lmp_bt_generique).
 */
@Composable
fun BlindIntro(playlist: String, morceaux: Int, modifier: Modifier = Modifier) {
    val ms = horloge(playlist)
    val arrivee = remember(playlist) { Animatable(0f) }
    val bras = remember(playlist) { Animatable(0f) }
    LaunchedEffect(playlist) {
        arrivee.animateTo(1f, tween(900, easing = FastOutSlowInEasing))
        bras.animateTo(1f, tween(450, easing = FastOutSlowInEasing))
    }
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Rayons(ms)
        Row(Modifier.fillMaxSize().padding(horizontal = 80.dp, vertical = 60.dp), verticalAlignment = Alignment.CenterVertically) {
            // La platine glisse en place, puis le bras vient se poser et le disque se met à tourner.
            Platine(
                angle = { (ms() - 1300f).coerceAtLeast(0f) / 1000f * 198f },
                leve = 1f - bras.value,
                or = 0f,
                modifier = Modifier.fillMaxHeight(0.8f).graphicsLayer {
                    translationX = -(1f - arrivee.value) * size.width * 0.6f
                    alpha = arrivee.value
                },
            )
            Spacer(Modifier.width(56.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    "BLIND TEST", color = Neon.Or, fontSize = 110.sp, lineHeight = 116.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                    modifier = Modifier.apparition(400, playlist),
                )
                if (playlist.isNotBlank()) {
                    Text(
                        playlist, color = Neon.Blanc, fontSize = 44.sp, lineHeight = 50.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.apparition(900, playlist),
                    )
                }
                Spacer(Modifier.height(24.dp))
                Text(
                    if (morceaux > 1) "$morceaux chansons à reconnaître" else "Une chanson à reconnaître",
                    color = Neon.Halo, fontSize = 34.sp, fontWeight = FontWeight.Black, modifier = Modifier.apparition(1300, playlist),
                )
                Text(
                    "Buzzez dès que vous reconnaissez la chanson !", color = Neon.Blanc.copy(alpha = 0.8f), fontSize = 30.sp,
                    fontWeight = FontWeight.Bold, modifier = Modifier.apparition(1700, playlist),
                )
            }
        }
    }
}

/**
 * Une équipe a buzzé : le panneau prend la couleur de l'équipe et flashe trois fois, « STOP ! » claque, puis le
 * nom de l'équipe et « On attend votre réponse… » avec trois points qui respirent.
 */
@Composable
fun BlindBuzz(equipe: String, couleur: Color, modifier: Modifier = Modifier) {
    val ms = horloge(equipe)
    val anim = rememberInfiniteTransition(label = "attente")
    val souffle by anim.animateFloat(0.3f, 1f, infiniteRepeatable(tween(600), RepeatMode.Reverse), label = "points")
    Box(
        modifier.clip(RoundedCornerShape(28.dp))
            .background(couleur.copy(alpha = 0.22f))
            .border(6.dp, couleur, RoundedCornerShape(28.dp)),
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
                "STOP !", color = couleur, fontSize = 120.sp, lineHeight = 124.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                modifier = Modifier.apparition(0, equipe),
            )
            Text(
                equipe, color = Neon.Blanc, fontSize = 54.sp, lineHeight = 60.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.apparition(250, equipe),
            )
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.apparition(500, equipe)) {
                Text("On attend votre réponse", color = Neon.Blanc.copy(alpha = 0.85f), fontSize = 32.sp, fontWeight = FontWeight.Bold)
                for (k in 0 until 3) {
                    Text(
                        ".", color = Neon.Blanc, fontSize = 32.sp, fontWeight = FontWeight.Black,
                        modifier = Modifier.graphicsLayer { alpha = ((souffle + k * 0.25f) % 1f).coerceIn(0.2f, 1f) },
                    )
                }
            }
        }
    }
}

/**
 * Révélation du morceau : la pochette se retourne au centre (la platine au disque doré s'il n'y en a pas), le titre et
 * l'artiste apparaissent en toutes lettres, puis le badge des points tombe en rebondissant dans la couleur de
 * l'équipe gagnante. Sans gagnant, même mise en scène sans points. La durée de la séquence est celle que le
 * moteur garde l'écran affiché : rien ici n'attend ni ne déclenche la suite.
 *
 * @param cle identifiant du morceau, pour rejouer l'entrée à chaque nouvelle révélation
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
) {
    val ms = horloge(cle)
    val retourne = remember(cle) { Animatable(0f) }
    LaunchedEffect(cle) { retourne.animateTo(1f, spring(dampingRatio = 0.6f, stiffness = Spring.StiffnessLow)) }
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Rayons(ms)
        Row(Modifier.fillMaxSize().padding(horizontal = 72.dp, vertical = 40.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.fillMaxHeight(0.86f).aspectRatio(if (pochette != null) 1f else 1.2f, matchHeightConstraintsFirst = true)
                    .graphicsLayer {
                        rotationY = (1f - retourne.value) * 90f
                        val e = 0.7f + 0.3f * retourne.value
                        scaleX = e; scaleY = e
                        cameraDistance = 16f * density
                    },
                contentAlignment = Alignment.Center,
            ) {
                if (pochette != null) {
                    Image(
                        pochette, contentDescription = null, contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(18.dp)).border(6.dp, Neon.Or, RoundedCornerShape(18.dp)),
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
                if (gagnant != null && points > 0) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.apparition(1800, cle)) {
                        Box(
                            Modifier.size(150.dp).rebond(true, 0.06f).clip(CircleShape).background(gagnant.second),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("+$points", color = Neon.Nuit, fontSize = 64.sp, lineHeight = 64.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false)
                        }
                        Spacer(Modifier.width(28.dp))
                        Column {
                            Text(
                                "Bravo ${gagnant.first} !", color = gagnant.second, fontSize = 46.sp, lineHeight = 52.sp, fontWeight = FontWeight.Black,
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
        if (gagnant != null && points > 0) Gerbe(cle, actif = apres(1800, cle))
    }
}

/**
 * Annonce des derniers morceaux à double valeur : « DERNIERS MORCEAUX », un « × 2 » géant qui claque sur deux
 * temps, et la valeur d'un morceau. Accompagne lmp_bt_double ; s'affiche par-dessus l'écran du blind test.
 */
@Composable
fun BlindDouble(points: Int, restants: Int, modifier: Modifier = Modifier) {
    val ms = horloge(restants)
    Box(modifier.fillMaxSize().background(Neon.Nuit.copy(alpha = 0.88f)), contentAlignment = Alignment.Center) {
        Rayons(ms)
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
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
    val taille = if (serre) 26.sp else 38.sp
    Column(modifier.fillMaxSize().padding(horizontal = 120.dp, vertical = if (serre) 30.dp else 60.dp), verticalArrangement = Arrangement.Center) {
        Text(
            "BILAN DU BLIND TEST", color = Neon.Or, fontSize = 64.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
            modifier = Modifier.apparition(0, lignes),
        )
        Spacer(Modifier.height(if (serre) 16.dp else 36.dp))
        tri.forEachIndexed { k, (nom, couleur, pts) ->
            val remplir = remember(lignes) { Animatable(0f) }
            LaunchedEffect(lignes) {
                delay(500L + k * 350L)
                remplir.animateTo(pts.toFloat() / max, tween(700, easing = FastOutSlowInEasing))
            }
            Row(Modifier.fillMaxWidth().padding(vertical = if (serre) 4.dp else 10.dp).apparition(300L + k * 350L, lignes), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(if (serre) 20.dp else 28.dp).clip(CircleShape).background(couleur))
                Spacer(Modifier.width(18.dp))
                Text(nom, color = Neon.Blanc, fontSize = taille, fontWeight = FontWeight.Black, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(380.dp))
                Box(Modifier.weight(1f).height(if (serre) 26.dp else 40.dp).clip(RoundedCornerShape(20.dp)).background(Color.White.copy(alpha = 0.08f))) {
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
                    modifier = Modifier.width(140.dp), textAlign = TextAlign.End,
                )
            }
        }
    }
}
