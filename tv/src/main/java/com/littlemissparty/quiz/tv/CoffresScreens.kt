package com.littlemissparty.quiz.tv

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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
import androidx.compose.runtime.key
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.BOMB_ALERT_MS
import com.littlemissparty.quiz.engine.CHEST_SHOW_MS
import com.littlemissparty.quiz.engine.ChestOpen
import com.littlemissparty.quiz.engine.ChestRound
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.Ordre
import com.littlemissparty.quiz.tv.habillage.Son
import com.littlemissparty.quiz.tv.habillage.Sons
import com.littlemissparty.quiz.tv.habillage.styleCentre
import com.littlemissparty.quiz.tv.habillage.texteDelta
import kotlinx.coroutines.delay
import kotlin.math.ceil
import kotlin.math.sin

/*
 * La bombe cachée sur la TV. L'écran ne décide rien : les coffres sont choisis sur les tablettes et leur contenu est
 * tiré par la partie à l'ouverture. Ici : la scène des coffres, l'ouverture du dernier coffre, l'annonce de la bombe,
 * puis le bilan. Les animations se calent sur l'heure du serveur : une box qui se reconnecte ne les rejoue pas.
 */

/** Apparence de chaque coffre, la même sur la TV et les tablettes (web/public/coffres.js). */
private val MODELES = listOf(0, 3, 1, 5, 2, 4, 4, 1, 5, 0, 3, 2, 2, 5, 0, 4, 1, 3)
private fun modele(i: Int) = MODELES[i % MODELES.size]

/** Couleurs pastel des six modèles (haut du couvercle, corps, bas), et leur taille relative. */
private val TEINTES = listOf(
    Triple(Color(0xFFF7D9A8), Color(0xFFD9A86A), Color(0xFF8F5F2E)),
    Triple(Color(0xFFFFD1E3), Color(0xFFF29AC0), Color(0xFFA8507A)),
    Triple(Color(0xFFB9D3FF), Color(0xFF6F8FE0), Color(0xFF2B3F8A)),
    Triple(Color(0xFFC8F5E0), Color(0xFF6FD1A8), Color(0xFF23775A)),
    Triple(Color(0xFFE3D1FF), Color(0xFFA98AE6), Color(0xFF563A92)),
    Triple(Color(0xFFFFD9C7), Color(0xFFF2A07F), Color(0xFFA34F33)),
)
private val TAILLES = listOf(1f, 0.88f, 0.96f, 0.84f, 0.92f, 0.9f)

/** Le texte du contenu montre le chiffre une fois le coffre bien ouvert (même repère que la tablette). */
private const val TEXTE_MS = 1_500L

/** Heure du serveur, rafraîchie plusieurs fois par seconde pour caler animations et boutons. */
@Composable
private fun heureServeur(offset: Long): Long {
    val t by produceState(System.currentTimeMillis() + offset, offset) {
        while (true) {
            value = System.currentTimeMillis() + offset
            delay(200)
        }
    }
    return t
}

@Composable
fun CoffresScreen(state: UiState.Playing, actions: TvActions) {
    val r = state.coffres
    val maintenant = heureServeur(state.serverOffset)
    val equipe = { uid: String? -> state.teams.find { it.uid == uid } }
    val dernier = r?.opened?.lastOrNull()
    // Ouverture en cours (le dernier coffre, pendant son animation) et annonce de la bombe juste après le dernier tour sans danger.
    val ouverture = dernier?.takeIf { maintenant < it.at + CHEST_SHOW_MS }
    val alerte = r != null && dernier != null && r.turn == r.safe && !r.exploded &&
        maintenant >= dernier.at + CHEST_SHOW_MS && maintenant < dernier.at + CHEST_SHOW_MS + BOMB_ALERT_MS
    val bilan = r != null && r.exploded && ouverture == null

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 20.dp)) {
            EnteteCoffres(state, r, equipe(r?.team), bilan)
            Spacer(Modifier.height(12.dp))
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                when {
                    r == null -> Text("Les coffres arrivent…", style = styleCentre(40.sp, Neon.OrClair))
                    bilan -> BilanCoffres(r, state, Modifier.fillMaxSize())
                    else -> SceneCoffres(
                        r,
                        // Contenu montré dans la scène une fois l'animation d'ouverture terminée.
                        visibles = r.opened.filter { it !== ouverture }.associateBy { it.chest },
                        couleurs = { equipe(it)?.color?.toColor() ?: Color.White },
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth().height(64.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    when {
                        r == null || bilan -> ""
                        r.danger -> "💣 La bombe peut être dans n'importe quel coffre !"
                        else -> "Encore ${r.safe - r.turn} coffre${if (r.safe - r.turn > 1) "s" else ""} sans danger"
                    },
                    style = styleCentre(26.sp, Neon.OrClair),
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!state.paused) when {
                    state.phase == Phase.REVEAL -> NextButton("Voir les scores", actions.next, key = "coffres-bilan-${state.index}")
                    // Sans régie, à la télécommande : un coffre au hasard pour l'équipe qui joue (tablette en panne).
                    r?.team != null && state.regies == 0 && maintenant >= r.readyAt ->
                        TvButton("🎲 Coffre au hasard", actions.chestRandom, fontSize = 22.sp)
                }
            }
        }
        if (ouverture != null) key(ouverture.at, ouverture.chest) {
            val e = equipe(ouverture.team)
            OuvertureCoffre(ouverture, e?.name ?: "", e?.color?.toColor() ?: Color.White, maintenant - ouverture.at)
        }
        if (alerte) key(dernier?.at) { AlerteBombe() }
    }
}

/** « Au tour de l'équipe Licornes » dans la couleur de l'équipe, ou le titre du jeu. */
@Composable
private fun EnteteCoffres(state: UiState.Playing, r: ChestRound?, joue: Team?, bilan: Boolean) {
    Row(Modifier.fillMaxWidth().height(70.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        if (joue != null && !bilan && r != null) {
            val c = joue.color.toColor()
            Box(
                Modifier.clip(RoundedCornerShape(40.dp)).background(Neon.Nuit2.copy(alpha = 0.8f))
                    .border(3.dp, c, RoundedCornerShape(40.dp)).padding(horizontal = 30.dp, vertical = 8.dp),
            ) {
                Text(
                    "Au tour de l'équipe ${joue.name}",
                    style = styleCentre(40.sp, Color.White),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 900.dp),
                )
            }
        } else {
            Text(if (bilan) "BOUM ! Le bilan" else state.gameTitle ?: "La bombe cachée", style = styleCentre(44.sp, Neon.Or))
        }
    }
}

/** Les coffres posés sur le plateau, en 1 à 3 rangées, les rangées du fond un peu plus petites. */
@Composable
private fun SceneCoffres(r: ChestRound, visibles: Map<Int, ChestOpen>, couleurs: (String) -> Color, modifier: Modifier) {
    val danger = r.danger && !r.exploded
    val lueur by rememberInfiniteTransition(label = "danger").animateFloat(
        0.25f, 0.55f, infiniteRepeatable(tween(2_400, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "lueur",
    )
    BoxWithConstraints(modifier) {
        val rangs = ceil(r.count / 7f).toInt().coerceIn(1, 3)
        val parRang = ceil(r.count / rangs.toFloat()).toInt()
        // Sol : un halo doux sous les coffres, qui rougeoie lentement une fois la bombe cachée.
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().fillMaxHeight(0.55f).graphicsLayer { alpha = if (danger) lueur else 0.3f }
                .background(Brush.radialGradient(listOf(if (danger) Color(0xFFFF6A3D) else Neon.Or, Color.Transparent))),
        )
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.SpaceEvenly, horizontalAlignment = Alignment.CenterHorizontally) {
            for (rang in 0 until rangs) {
                val debut = rang * parRang
                val fin = minOf(r.count, debut + parRang)
                // Perspective : le rang du fond est le plus petit, celui de devant le plus grand.
                val echelle = 0.82f + 0.18f * (rang + 1) / rangs
                val largeur = (maxWidth / parRang - 16.dp) * echelle
                val hauteur = (maxHeight / rangs - 24.dp) * echelle
                val cote = minOf(largeur, hauteur * 1.25f).coerceAtMost(220.dp)
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Bottom) {
                    for (i in debut until fin) {
                        val o = visibles[i]
                        Coffre(i, cote, ouvert = r.opened.any { it.chest == i }, contenu = o, couleur = o?.let { couleurs(it.team) })
                    }
                }
            }
        }
    }
}

/** Un coffre : couvercle bombé, corps cerclé d'or, plaque numérotée ; ouvert, le contenu au-dessus. */
@Composable
private fun Coffre(index: Int, largeur: Dp, ouvert: Boolean, contenu: ChestOpen?, couleur: Color?, modifier: Modifier = Modifier) {
    val m = modele(index)
    val (haut, corps, bas) = TEINTES[m]
    val l = largeur * TAILLES[m]
    val h = l * 0.8f
    val or = Neon.OrProfond
    val bombe = contenu?.bomb == true
    Box(modifier.size(largeur, largeur * 0.8f), contentAlignment = Alignment.BottomCenter) {
        Box(Modifier.size(l, h)) {
            // Ombre posée au sol : le coffre ne flotte jamais.
            Box(Modifier.align(Alignment.BottomCenter).offset(y = h * 0.06f).size(l * 1.1f, h * 0.14f).clip(CircleShape).background(Color.Black.copy(alpha = 0.35f)))
            Box(
                Modifier.align(Alignment.BottomCenter).size(l, h * 0.6f).clip(RoundedCornerShape(l * 0.04f, l * 0.04f, l * 0.07f, l * 0.07f))
                    .background(Brush.verticalGradient(listOf(corps, bas))).border(l * 0.018f, if (couleur != null) couleur else or, RoundedCornerShape(l * 0.05f))
                    .graphicsLayer { if (bombe) alpha = 0.55f },
            ) {
                Box(Modifier.align(Alignment.CenterStart).padding(start = l * 0.12f).size(l * 0.06f, h * 0.6f).background(or))
                Box(Modifier.align(Alignment.CenterEnd).padding(end = l * 0.12f).size(l * 0.06f, h * 0.6f).background(or))
                Box(
                    Modifier.align(Alignment.Center).size(l * 0.26f).clip(RoundedCornerShape(l * 0.06f))
                        .background(Brush.radialGradient(listOf(Color(0xFFFFF3D1), Color(0xFFE9C27A), Color(0xFFA8782F)))),
                    contentAlignment = Alignment.Center,
                ) { Text("${index + 1}", style = styleCentre((l.value * 0.16f).sp, Neon.Nuit)) }
            }
            // Couvercle : fermé sur le corps, relevé et basculé quand le coffre est ouvert.
            Box(
                Modifier.align(Alignment.TopCenter).offset(y = h * 0.02f).size(l * 1.03f, h * 0.42f)
                    .graphicsLayer {
                        if (ouvert) {
                            translationY = -size.height * 0.25f
                            rotationZ = -12f
                            scaleY = 0.6f
                        }
                        if (bombe) alpha = 0.55f
                    }
                    .clip(RoundedCornerShape(topStart = l * 0.4f, topEnd = l * 0.4f, bottomStart = l * 0.02f, bottomEnd = l * 0.02f))
                    .background(Brush.verticalGradient(listOf(haut, corps))).border(l * 0.018f, or, RoundedCornerShape(topStart = l * 0.4f, topEnd = l * 0.4f)),
            )
            if (contenu != null) {
                val texte = if (bombe) "💣" else signe(contenu.delta)
                val c = when {
                    bombe -> Color.White
                    contenu.delta > 0 -> Neon.JusteClair
                    else -> Neon.Faux
                }
                Text(
                    texte,
                    style = styleCentre((l.value * if (bombe) 0.34f else 0.22f).sp, c),
                    modifier = Modifier.align(Alignment.TopCenter).offset(y = -h * 0.06f),
                )
            }
        }
    }
}

/** « +150 », « −100 » (vrai signe moins). */
private fun signe(v: Int) = "${if (v < 0) "−" else "+"}${kotlin.math.abs(v)}"

/**
 * Ouverture du dernier coffre, par-dessus la scène : le coffre arrive, tremble, s'ouvre, puis ce qu'il contenait.
 * [depuisMs] : temps déjà écoulé depuis l'ouverture (heure du serveur), pour ne pas rejouer le début à la reconnexion.
 */
@Composable
private fun OuvertureCoffre(o: ChestOpen, nom: String, couleur: Color, depuisMs: Long) {
    val t = remember { Animatable(depuisMs.coerceIn(0L, CHEST_SHOW_MS).toFloat()) }
    val debut = remember { t.value }
    LaunchedEffect(Unit) {
        val reste = CHEST_SHOW_MS - t.value
        if (reste > 0) t.animateTo(CHEST_SHOW_MS.toFloat(), tween(reste.toInt(), easing = LinearEasing))
    }
    // Sons : le grincement à l'arrivée, puis le contenu quand le couvercle s'ouvre (rien de rejoué à la reconnexion).
    LaunchedEffect(Unit) {
        if (debut < 400f) Sons.executer(listOf(Ordre.Jouer(Son.PORTES_OUVRE)))
        if (debut < 1_100f) {
            delay((1_100f - debut).toLong())
            Sons.executer(listOf(Ordre.Jouer(if (o.bomb) Son.IMPACT else if (o.delta > 0) Son.PORTES_JACKPOT else Son.PORTES_TUILE)))
        }
    }
    val ms = t.value
    val ouvert = ms >= 1_100f
    val entree = (ms / 400f).coerceIn(0f, 1f)
    val sortie = ((ms - (CHEST_SHOW_MS - 350f)) / 350f).coerceIn(0f, 1f)
    Box(
        Modifier.fillMaxSize().graphicsLayer { alpha = entree * (1f - sortie) }
            .background(Brush.radialGradient(listOf(Neon.Nuit.copy(alpha = 0.92f), Neon.Nuit.copy(alpha = 0.6f)))),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(nom, style = styleCentre(40.sp, couleur), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 1000.dp))
            Spacer(Modifier.height(12.dp))
            Box(
                Modifier.graphicsLayer {
                    // Le coffre tremble avant de s'ouvrir.
                    rotationZ = if (ms in 400f..1_100f) 4f * sin(ms / 30f) else 0f
                    val s = 0.6f + 0.4f * entree
                    scaleX = s
                    scaleY = s
                },
            ) { Coffre(o.chest, 300.dp, ouvert = ouvert, contenu = null, couleur = couleur) }
            Spacer(Modifier.height(18.dp))
            val texte = ms >= TEXTE_MS
            Column(Modifier.height(170.dp).graphicsLayer { alpha = if (texte) ((ms - TEXTE_MS) / 250f).coerceIn(0f, 1f) else 0f }, horizontalAlignment = Alignment.CenterHorizontally) {
                val (titre, couleurTitre) = when {
                    o.bomb -> "BOUM ! La bombe !" to Color(0xFFFF8A4D)
                    o.delta > 0 -> (if (o.delta >= 300) "JACKPOT !" else "BONUS !") to Neon.Or
                    o.delta < 0 -> "Oups !" to Neon.Faux
                    else -> "Oups… rien à perdre !" to Neon.OrClair
                }
                Text(titre, style = styleCentre(64.sp, couleurTitre))
                if (o.delta != 0) {
                    Spacer(Modifier.height(10.dp))
                    Text(texteDelta(o.delta), style = styleCentre(56.sp, if (o.delta > 0) Neon.JusteClair else Neon.Faux))
                }
            }
        }
    }
}

/** Annonce plein écran : une bombe se cache désormais dans un des coffres. */
@Composable
private fun AlerteBombe() {
    LaunchedEffect(Unit) { Sons.executer(listOf(Ordre.Jouer(Son.TENSION))) }
    val battement by rememberInfiniteTransition(label = "alerte").animateFloat(
        1f, 1.08f, infiniteRepeatable(tween(600, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "battement",
    )
    Box(
        Modifier.fillMaxSize().background(Brush.radialGradient(listOf(Color(0xFF4A1206).copy(alpha = 0.92f), Neon.Nuit.copy(alpha = 0.9f)))),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("💣", style = styleCentre(140.sp, Color.White), modifier = Modifier.graphicsLayer { scaleX = battement; scaleY = battement })
            Spacer(Modifier.height(20.dp))
            Text("Attention…", style = styleCentre(48.sp, Neon.OrClair))
            Spacer(Modifier.height(12.dp))
            Text("Une bombe se cache dans un des coffres !", style = styleCentre(54.sp, Color(0xFFFF8A4D)), textAlign = TextAlign.Center)
        }
    }
}

/** Bilan : ce que chaque équipe a gagné ou perdu dans ce jeu, de la meilleure à la moins chanceuse. */
@Composable
private fun BilanCoffres(r: ChestRound, state: UiState.Playing, modifier: Modifier) {
    val gains = r.gains()
    val bombe = r.opened.lastOrNull { it.bomb }
    val lignes = state.teams.map { it to (gains[it.uid] ?: 0) }.sortedByDescending { it.second }
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        state.teams.find { it.uid == bombe?.team }?.let {
            Text("💣 ${it.name} a trouvé la bombe !", style = styleCentre(34.sp, it.color.toColor()), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(18.dp))
        }
        val hauteur = (56 - 3 * (lignes.size - 4).coerceAtLeast(0)).dp
        lignes.forEach { (team, gain) ->
            Row(
                Modifier.width(820.dp).height(hauteur).padding(vertical = 4.dp).clip(RoundedCornerShape(16.dp))
                    .background(Neon.Nuit2.copy(alpha = 0.7f)).padding(horizontal = 24.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(18.dp).clip(CircleShape).background(team.color.toColor()))
                Spacer(Modifier.width(16.dp))
                Text(team.name, style = styleCentre(30.sp, Color.White), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    if (gain == 0) "0" else "${signe(gain)} points",
                    style = styleCentre(32.sp, if (gain > 0) Neon.JusteClair else if (gain < 0) Neon.Faux else Neon.OrClair),
                )
            }
        }
    }
}
